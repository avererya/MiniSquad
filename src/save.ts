// Local save (localStorage only, no cloud). Versioned, validated, and forgiving.
//
// v2 (v0.3) stores: roster identities (id, name, class, trait id, legacy mods, progression
// with total XP, individual training ranks, future-proof status/resurrections/service record),
// the selected squad slots, and the account (credits, squad training ranks, per-mission
// records, recently settled mission-run ids). NOT stored: HP, cooldowns, mission state or
// effective stats (always recomputed, so nothing can stack).
//
// v3 (v0.4) adds: which soldiers are unlocked, campaign progress (unlocked missions, selected
// mission) and best stars per mission record. The squad selection holds up to 6 slots.
//
// MIGRATION: v1 (v0.2.2) and v2 (v0.3) saves are upgraded IN PLACE: soldiers, traits, XP,
// training, credits, squad training and the squad are kept; new fields get their defaults.
// Legacy players owned all six soldiers, so all six stay unlocked; the campaign starts at
// Mission 1. The v0.3 'comms-outpost' mission record is kept as history (it is not a
// campaign mission id, so it never counts as a campaign first clear). The raw legacy save is
// also copied once to SAVE_LEGACY_KEY before the upgraded save is written.
//
// v4 (v0.5) adds recruits to the roster array (ids "rc-<n>"; class + trait are their own, not
// fixed defaults), account.recruitment (current offers, used-name registry, next id, one-time
// class introductions, dismissal history, roster cap, counters) and account.pendingDecision
// (future, always null). Dismissed named soldiers are listed in the dismissal history and are
// NOT restored from the defaults. v3 saves (and v1/v2 through the same path) are upgraded in
// place: nothing in the roster or account is dropped; classes already recruitable count as
// introduced. The raw pre-v4 save is copied once to SAVE_PRE_V05_KEY before the upgrade.
//
// v5 (v0.6, permanent death) adds per soldier: status 'kia' (fell, awaiting a decision), the
// career fields service.downs / revives / deaths (0 for older saves: never tracked, nothing is
// invented; missions, victories and kills were tracked since v0.3 and are kept), resurrections
// (already stored, 0) and origin 'phoenix'; and in the account: pendingDecision (the casualty
// decision queue, was always null), memorial (honored soldiers' final records), phoenix (grants)
// and activeRun (KIA journal of the mission in progress). Older soldiers are always 'active'
// (KIA was temporary before v0.6, so nobody is converted to KIA by the upgrade). The raw pre-v5
// save is copied once to SAVE_PRE_V06_KEY before the upgrade.
//
// v6 (v0.6.1, deliberate recruitment) adds account.named: named campaign recruit offers by stable
// key (= named soldier id): `unlocked` (milestone reached), `claimed` (one-time offer used up),
// `notified` (unlock notice shown) and a purchase `history`. From v6 on, `unlockedSoldiers`
// means OWNED named soldiers only and is never re-derived from mission records (a first clear no
// longer awards anyone); the milestones are re-derived into `named.unlocked` instead.
// MIGRATION from v1-v5 (older versions awarded named soldiers for free): every named soldier
// those versions gave the player is kept, uncharged, and its offer is CLAIMED (owned, KIA awaiting
// a decision, dismissed or in the Memorial alike), so nobody is duplicated or charged; a claimed
// soldier gets a 'legacy' history entry. Milestones already reached are unlocked; an offer is only
// opened for a milestone whose soldier was never acquired. Notices are not owed for claimed
// offers. Ownership is decided by soldier id + the old unlock flags / dismissal list / Memorial,
// never by display name. The raw pre-v6 save is copied once to SAVE_PRE_V061_KEY.
//
// v7 (v0.6.2, Chapter 2) adds account.classUnlocks {unlocked, notified}: classes unlocked by a
// campaign milestone (the Sniper, Mission 9's first clear), re-derived from mission records on
// load. Nothing else changes: an older save keeps every soldier, credit, star and unlock, a
// Mission 5 clear now also unlocks Mission 6 (no repair note), and no Sniper is ever granted.
// The raw pre-v7 save is copied once to SAVE_PRE_V062_KEY.
// Formats are never reset just because they are old. Each field is repaired on its own (bad
// XP -> derived from level, bad ranks -> clamped, negative credits -> 0, unknown mission ids
// in the campaign lists dropped) instead of throwing a soldier away.
import { CLASSES, CLASS_IDS, newProgression, newService, type ProgressionRecord, type ServiceRecord, type SoldierIdentity } from './classes';
import { MODIFIER_KEYS, TRAITS, type StatModifiers } from './traits';
import { ALL_SOLDIER_IDS, DEFAULT_SQUAD, LEGACY_DEFAULT_SQUAD, Roster, defaultRoster } from './roster';
import {
  LEVEL_CAP, MAX_XP, PROGRESSION, SQUAD_TRAINING, SQUAD_TRAINING_IDS, TRAINING, TRAINING_IDS, cleanRank, levelForXp, newAccount,
  newCampaign, newSquadTraining, newTraining, xpForLevel, type AccountData, type CampaignProgress, type MissionRecord, type SquadTrainingRanks, type TrainingRanks,
} from './progression';
import { CAMPAIGN, CLASS_UNLOCK_TEXT, FIRST_MISSION, NAMED_RECRUITS, STARTING_SOLDIERS, derivedClassUnlocks, derivedMissionUnlocks, derivedRecruitUnlocks, derivedSoldierUnlocks } from './campaign';
import { type CandidateRecord, type DismissalRecord, type RecruitmentState, ROSTER_CAP, newRecruitment } from './progression';
import { RECRUIT_ID, campaignFlags, generateCandidate, generateName, isTraitValidFor, nameKey, recruitClass, recruitableClasses, takenNames } from './recruitment';
import { newClassUnlocks, newNamedRecruits, newPhoenix, type NamedRecruitState, type ActiveRun, type CasualtyDecision, type FallenEntry, type KiaCause, type MemorialRecord, type PhoenixState } from './progression';
import { PHOENIX_CANDIDATES, PHOENIX_LEVEL } from './casualties';

export const SAVE_KEY = 'minisquad.save';
export const SAVE_BACKUP_KEY = 'minisquad.save.invalid';
/** One-time copy of a v1/v2 save, taken before it is upgraded to v3. */
export const SAVE_LEGACY_KEY = 'minisquad.save.pre-v0.4';
/** One-time copy of any pre-v4 save (v1/v2/v3), taken before it is upgraded to v4 (v0.5). */
export const SAVE_PRE_V05_KEY = 'minisquad.save.pre-v0.5';
/** One-time copy of any pre-v5 save (v1-v4), taken before it is upgraded to v5 (v0.6). */
export const SAVE_PRE_V06_KEY = 'minisquad.save.pre-v0.6';
/** One-time copy of any pre-v6 save (v1-v5), taken before it is upgraded to v6 (v0.6.1). */
export const SAVE_PRE_V061_KEY = 'minisquad.save.pre-v0.6.1';
/** One-time copy of any pre-v7 save (v1-v6), taken before it is upgraded to v7 (v0.6.2). */
export const SAVE_PRE_V062_KEY = 'minisquad.save.pre-v0.6.2';
export const SAVE_VERSION = 7;

export interface SaveFileV7 {
  version: 7;
  roster: SoldierIdentity[];
  squad: (string | null)[];
  /** Named soldiers the player has owned (bought, or awarded before v0.6.1; kept after a dismissal). */
  unlockedSoldiers: string[];
  account: AccountData;
}

export type LoadStatus = 'new' | 'loaded' | 'migrated' | 'repaired' | 'reset';
export interface LoadResult { roster: Roster; account: AccountData; notes: string[]; status: LoadStatus; fromVersion: number | null }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Legacy multipliers: invalid entries are dropped (never a soldier). */
function cleanMods(v: unknown, notes: string[], who: string): StatModifiers {
  if (v === undefined) return {};
  const out: StatModifiers = {};
  if (!isObj(v)) { notes.push(`${who}: invalid modifiers removed.`); return out; }
  for (const [k, x] of Object.entries(v)) {
    if ((MODIFIER_KEYS as readonly string[]).includes(k) && typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 10) (out as any)[k] = x;
    else notes.push(`${who}: invalid modifier ${k} removed.`);
  }
  return out;
}

/** Progression: total XP is the source of truth; level is derived from it. */
function cleanProgression(v: unknown, notes: string[], who: string): ProgressionRecord {
  const p = newProgression();
  if (!isObj(v)) { if (v !== undefined) notes.push(`${who}: progression invalid, reset to level 1.`); return p; }
  const lvl = isInt(v.level) && v.level >= 1 ? Math.min(LEVEL_CAP, v.level) : null;
  let xp: number;
  if (typeof v.xp === 'number' && Number.isFinite(v.xp) && v.xp >= 0) {
    xp = Math.floor(v.xp);
    // a level above what the XP explains (e.g. a hand-edited level): keep the higher level's XP
    if (lvl !== null && xp < xpForLevel(lvl)) { xp = xpForLevel(lvl); notes.push(`${who}: XP below level ${lvl}, raised to its threshold.`); }
  } else {
    xp = lvl !== null ? xpForLevel(lvl) : 0;
    notes.push(`${who}: XP missing or invalid, set from level ${lvl ?? 1}.`);
  }
  if (xp > MAX_XP()) { xp = MAX_XP(); notes.push(`${who}: XP above the level cap, clamped.`); }
  p.xp = xp;
  p.level = levelForXp(xp);
  if ((lvl !== null && lvl !== p.level) || (v.level !== undefined && v.level !== p.level)) notes.push(`${who}: level ${String(v.level)} corrected to ${p.level} (from XP).`);
  if (Array.isArray(v.upgrades)) p.upgrades = v.upgrades.filter((u): u is string => typeof u === 'string');
  if (typeof v.specialization === 'string') p.specialization = v.specialization;
  if (v.tier === 'elite' || v.tier === 'recruit') p.tier = v.tier;
  if (typeof v.elitePath === 'string') p.elitePath = v.elitePath;
  if (isInt(v.eliteLevel) && v.eliteLevel >= 0 && v.eliteLevel <= 30) p.eliteLevel = v.eliteLevel;
  return p;
}

function cleanRanks<K extends string>(v: unknown, ids: K[], defs: Record<K, { costs: number[] }>, fresh: Record<K, number>, notes: string[], who: string): Record<K, number> {
  const out = { ...fresh };
  if (v === undefined) return out;
  if (!isObj(v)) { notes.push(`${who}: training ranks invalid, reset.`); return out; }
  for (const k of ids) {
    if (v[k] === undefined) continue;
    const r = cleanRank(v[k], defs[k].costs.length);
    if (r !== v[k]) notes.push(`${who}: ${k} rank ${String(v[k])} -> ${r}.`);
    out[k] = r;
  }
  return out;
}

function cleanService(v: unknown): ServiceRecord {
  const s = newService();
  if (!isObj(v)) return s;
  for (const k of ['missions', 'victories', 'kills', 'downs', 'revives', 'deaths'] as const) if (isInt(v[k]) && v[k] >= 0) s[k] = v[k];
  return s;
}

/**
 * One saved soldier merged onto its default identity (roster soldiers are fixed: class and
 * trait come from the defaults if the save disagrees). Returns null for unknown ids.
 */
export function mergeSoldier(def: SoldierIdentity, v: Record<string, unknown>, notes: string[], keepKia = false): SoldierIdentity {
  const who = def.name;
  const s: SoldierIdentity = { ...def };
  if (typeof v.name === 'string' && v.name.trim() && v.name.length <= 20) s.name = v.name.trim();
  else if (v.name !== undefined) notes.push(`${who}: invalid name restored.`);
  if (v.classId !== def.classId) notes.push(`${who}: class ${String(v.classId)} invalid, restored to ${CLASSES[def.classId].label}.`);
  if (v.traitId !== def.traitId) notes.push(`${who}: trait ${String(v.traitId)} invalid, restored to ${def.traitId ? TRAITS[def.traitId].name : '-'}.`);
  s.mods = cleanMods(v.mods, notes, who);
  s.progression = cleanProgression(v.progression, notes, who);
  s.training = cleanRanks(v.training, TRAINING_IDS, TRAINING, newTraining(), notes, who) as TrainingRanks;
  // KIA was temporary before v0.6: only a v5 save can hold a fallen soldier (checked against the decision queue later)
  s.status = keepKia && v.status === 'kia' ? 'kia' : 'active';
  s.resurrections = isInt(v.resurrections) && v.resurrections >= 0 ? v.resurrections : 0;
  s.service = cleanService(v.service);
  if (v.origin === 'phoenix') s.origin = 'phoenix'; else delete s.origin;
  return s;
}

/** v0.6.2: set by parseSave: the save predates the Sniper class (v1-v6), so a 'sniper' recruit is invalid (no free Sniper). */
let preSniper = false;

/** A saved recruit: own class + trait (validated), progression, training. Never dropped for a bad field. */
function cleanRecruit(v: Record<string, unknown>, notes: string[], keepKia = false): SoldierIdentity {
  const id = v.id as string;
  let classId = v.classId as SoldierIdentity['classId'];
  if (!(CLASS_IDS as string[]).includes(classId) || (preSniper && classId === 'sniper')) { notes.push(`Recruit ${id}: class ${String(v.classId)} invalid, set to Infantry.`); classId = 'infantry'; }
  let traitId = v.traitId as SoldierIdentity['traitId'];
  if (!isTraitValidFor(traitId, classId)) { notes.push(`Recruit ${id}: trait ${String(v.traitId)} invalid, set to Sharpshooter.`); traitId = 'sharpshooter'; }
  const base: SoldierIdentity = { id, name: '', classId, traitId, mods: {}, progression: newProgression(), training: newTraining(), status: 'active', resurrections: 0, service: newService() };
  const s = mergeSoldier(base, { ...v, classId, traitId }, notes, keepKia);
  return s;
}

function cleanCandidate(v: unknown): CandidateRecord | null {
  if (!isObj(v) || typeof v.id !== 'string' || !RECRUIT_ID.test(v.id) || typeof v.name !== 'string') return null;
  const name = v.name.trim();
  if (!name || name.length > 20) return null;
  const classId = v.classId as CandidateRecord['classId'];
  if (!recruitClass(classId) || !isTraitValidFor(v.traitId, classId)) return null;
  const level = isInt(v.level) && v.level >= 1 ? Math.min(LEVEL_CAP, v.level) : null;
  if (level === null) return null;
  return { id: v.id, name, classId, traitId: v.traitId as CandidateRecord['traitId'], level };
}

function cleanDismissal(v: unknown): DismissalRecord | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null;
  const classId = (CLASS_IDS as string[]).includes(v.classId as string) ? v.classId as DismissalRecord['classId'] : 'infantry';
  return {
    eventId: typeof v.eventId === 'string' ? v.eventId : `dm-${v.id}`, id: v.id, name: v.name, classId,
    level: isInt(v.level) && v.level >= 1 ? Math.min(LEVEL_CAP, v.level) : 1, at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0,
    refund: isInt(v.refund) && v.refund >= 0 ? v.refund : 0, restorable: false,
  };
}

/**
 * Recruitment state. Each field is repaired on its own; nothing here touches soldiers,
 * credits or campaign progress. `introducedDefault` = classes recruitable right now (used when
 * the save predates v0.5 or the field is missing: no introduction is owed for them).
 */
function cleanRecruitment(v: unknown, notes: string[], introducedDefault: SoldierRecord['classId'][]): RecruitmentState {
  const r = newRecruitment(introducedDefault);
  if (v === undefined) return r;
  if (!isObj(v)) { notes.push('Recruitment data invalid: offers reset (soldiers and Credits kept).'); return r; }
  if (Array.isArray(v.offers)) {
    const seen = new Set<string>();
    for (const o of v.offers.slice(0, 3)) {
      const c = cleanCandidate(o);
      if (!c || seen.has(c.id) || seen.has(nameKey(c.name))) { notes.push('Invalid recruitment offer dropped.'); continue; }
      seen.add(c.id); seen.add(nameKey(c.name));
      r.offers.push(c);
    }
    if (v.offers.length > 3) notes.push('Extra recruitment offers dropped.');
  } else if (v.offers !== undefined) notes.push('Recruitment offers invalid: they will be regenerated.');
  if (isInt(v.nextSeq) && v.nextSeq >= 1) r.nextSeq = v.nextSeq; else if (v.nextSeq !== undefined) notes.push('Recruit id counter repaired.');
  if (Array.isArray(v.usedNames)) r.usedNames = [...new Set(v.usedNames.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 40))];
  if (Array.isArray(v.introduced)) r.introduced = [...new Set([...v.introduced.filter((x): x is SoldierRecord['classId'] => !!recruitClass(x as SoldierRecord['classId'])), 'infantry' as const])];
  if (Array.isArray(v.dismissed)) r.dismissed = v.dismissed.map(cleanDismissal).filter((x): x is DismissalRecord => !!x);
  r.rosterCap = ROSTER_CAP;
  for (const k of ['recruited', 'refreshes'] as const) if (isInt(v[k]) && v[k] >= 0) r[k] = v[k];
  return r;
}
type SoldierRecord = SoldierIdentity;

const PLAYABLE_IDS = new Set(CAMPAIGN.filter((m) => m.playable).map((m) => m.id));

/** Campaign lists: known playable ids only, plus whatever the completed missions unlock (repair). */
/** `expected`: ids an older format could not list yet (v0.6.2: Mission 6 after a Mission 5 clear), unlocked without a repair note. */
function cleanCampaign(v: unknown, missions: Record<string, MissionRecord>, notes: string[], legacy: boolean, expected: string[] = []): CampaignProgress {
  const c = newCampaign();
  const done = (id: string) => (missions[id]?.completions ?? 0) > 0;
  const derived = derivedMissionUnlocks(done);
  if (legacy || v === undefined) { c.unlockedMissions = derived; return c; }
  if (!isObj(v)) { notes.push('Campaign progress invalid: rebuilt from mission records.'); c.unlockedMissions = derived; return c; }
  const listed = Array.isArray(v.unlockedMissions) ? v.unlockedMissions.filter((x): x is string => typeof x === 'string') : [];
  if (!Array.isArray(v.unlockedMissions)) notes.push('Unlocked missions missing: rebuilt from mission records.');
  const bad = listed.filter((x) => !PLAYABLE_IDS.has(x));
  if (bad.length) notes.push(`Unknown missions ${bad.join(', ')} removed from the campaign.`);
  const merged = [...new Set([...listed.filter((x) => PLAYABLE_IDS.has(x)), ...derived])];
  const missing = derived.filter((x) => !listed.includes(x) && !expected.includes(x));
  if (missing.length && Array.isArray(v.unlockedMissions)) notes.push(`Missions ${missing.join(', ')} re-unlocked from mission records.`);
  c.unlockedMissions = CAMPAIGN.map((m) => m.id).filter((id) => merged.includes(id)); // campaign order
  if (typeof v.selectedMission === 'string' && c.unlockedMissions.includes(v.selectedMission)) c.selectedMission = v.selectedMission;
  else { if (v.selectedMission !== undefined) notes.push('Selected mission invalid: Mission 1 selected.'); c.selectedMission = FIRST_MISSION; }
  return c;
}

function cleanAccount(v: unknown, notes: string[], legacy: boolean, expected: string[] = []): AccountData {
  const a = newAccount();
  if (v === undefined) return a;
  if (!isObj(v)) { notes.push('Account invalid: credits and squad training reset.'); return a; }
  if (typeof v.credits === 'number' && Number.isFinite(v.credits)) {
    a.credits = Math.max(0, Math.min(1e9, Math.floor(v.credits)));
    if (a.credits !== v.credits) notes.push(`Credits ${v.credits} corrected to ${a.credits}.`);
  } else if (v.credits !== undefined) notes.push('Credits invalid, set to 0.');
  a.squadTraining = cleanRanks(v.squadTraining, SQUAD_TRAINING_IDS, SQUAD_TRAINING, newSquadTraining(), notes, 'Squad') as SquadTrainingRanks;
  if (isObj(v.missions)) {
    for (const [id, r] of Object.entries(v.missions)) {
      if (!/^[a-z0-9_-]{1,40}$/.test(id) || !isObj(r)) { notes.push(`Mission record ${id} dropped.`); continue; }
      const rec: MissionRecord = { completions: isInt(r.completions) && r.completions >= 0 ? r.completions : 0, firstClearRun: typeof r.firstClearRun === 'string' ? r.firstClearRun : null, bestStars: 0 };
      if (rec.completions === 0 && rec.firstClearRun) rec.completions = 1;
      if (r.bestStars !== undefined) {
        const b = cleanRank(r.bestStars, 3);
        if (b !== r.bestStars) notes.push(`Mission ${id}: best stars ${String(r.bestStars)} -> ${b}.`);
        rec.bestStars = b;
      }
      if (rec.completions > 0 && rec.bestStars === 0 && PLAYABLE_IDS.has(id) && !legacy) rec.bestStars = 1; // a clear is at least 1 star
      a.missions[id] = rec;
    }
  }
  if (Array.isArray(v.settledRuns)) {
    a.settledRuns = [...new Set(v.settledRuns.filter((x): x is string => typeof x === 'string' && x.length <= 64))].slice(-PROGRESSION.rememberRuns);
  }
  a.campaign = cleanCampaign(v.campaign, a.missions, notes, legacy, expected);
  return a;
}

// ---------------- v5 (v0.6) permanent-death state ----------------
const CAUSES: KiaCause[] = ['bleedout', 'abandoned', 'interrupted', 'failed'];
const cleanCause = (v: unknown): KiaCause => (CAUSES.includes(v as KiaCause) ? v as KiaCause : 'bleedout');
const cleanFallen = (v: unknown): FallenEntry | null => (isObj(v) && typeof v.id === 'string' && v.id ? { id: v.id, cause: cleanCause(v.cause) } : null);
const str = (v: unknown, d = '') => (typeof v === 'string' && v.length <= 80 ? v : d);
const num0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

function cleanPending(v: unknown, notes: string[]): CasualtyDecision | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v) || !Array.isArray(v.queue)) { notes.push('Pending casualty decision unreadable: rebuilt from fallen soldiers.'); return null; }
  const seen = new Set<string>();
  const queue = v.queue.map(cleanFallen).filter((x): x is FallenEntry => !!x && !seen.has(x.id) && !!seen.add(x.id));
  const resolved = Array.isArray(v.resolved) ? v.resolved.filter(isObj).filter((x) => typeof x.id === 'string' && (x.outcome === 'resurrected' || x.outcome === 'memorial')).map((x) => ({
    id: x.id as string, name: str(x.name, x.id as string), outcome: x.outcome as 'resurrected' | 'memorial', cost: num0(x.cost), affordable: x.affordable === true,
  })) : [];
  return { kind: 'casualties', runId: str(v.runId, 'unknown-run'), missionId: str(v.missionId, ''), at: num0(v.at), queue, total: Math.max(isInt(v.total) ? v.total : 0, queue.length + resolved.length), resolved };
}

function cleanPhoenix(v: unknown, notes: string[]): PhoenixState {
  const p = newPhoenix();
  if (v === undefined) return p;
  if (!isObj(v)) { notes.push('Operation Phoenix data invalid: reset.'); return p; }
  if (Array.isArray(v.grants)) p.grants = v.grants.filter(isObj).filter((g) => typeof g.id === 'string').map((g) => ({ id: g.id as string, at: num0(g.at), recruits: Array.isArray(g.recruits) ? g.recruits.filter((x): x is string => typeof x === 'string') : [] }));
  if (isObj(v.pending) && typeof v.pending.id === 'string') {
    const seen = new Set<string>();
    const candidates = (Array.isArray(v.pending.candidates) ? v.pending.candidates : []).map(cleanCandidate)
      .filter((c): c is CandidateRecord => !!c && c.classId === 'infantry' && !seen.has(c.id) && !!seen.add(c.id)).map((c) => ({ ...c, level: PHOENIX_LEVEL }));
    if (!p.grants.some((g) => g.id === (v.pending as Record<string, unknown>).id)) p.pending = { id: v.pending.id, at: num0(v.pending.at), candidates };
    else notes.push('Operation Phoenix grant already paid: duplicate pending grant dropped.');
  }
  return p;
}

function cleanActiveRun(v: unknown): ActiveRun | null {
  if (!isObj(v) || typeof v.runId !== 'string' || !Array.isArray(v.kia)) return null;
  return { runId: v.runId, missionId: str(v.missionId, ''), kia: v.kia.map(cleanFallen).filter((x): x is FallenEntry => !!x) };
}

const NAMED_KEYS = NAMED_RECRUITS.map((n) => n.key);
function cleanNamed(v: unknown, notes: string[]): NamedRecruitState {
  const n = newNamedRecruits();
  if (v === undefined) return n;
  if (!isObj(v)) { notes.push('Named recruit data invalid: rebuilt from campaign progress and ownership.'); return n; }
  const keys = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((k): k is string => typeof k === 'string' && NAMED_KEYS.includes(k)))] : []);
  n.unlocked = keys(v.unlocked); n.claimed = keys(v.claimed); n.notified = keys(v.notified);
  if (Array.isArray(v.history)) n.history = v.history.filter(isObj).filter((h) => typeof h.key === 'string' && NAMED_KEYS.includes(h.key)).map((h) => ({
    key: h.key as string, soldierId: str(h.soldierId, h.key as string), at: num0(h.at), cost: num0(h.cost), level: isInt(h.level) && h.level >= 1 ? Math.min(LEVEL_CAP, h.level) : 1, ...(h.legacy === true ? { legacy: true } : {}),
  }));
  return n;
}

/** Highest recruit id number in use anywhere (so the id counter can never hand out an old id). */
function maxRecruitSeq(ids: string[]): number {
  let m = 0;
  for (const id of ids) { const x = RECRUIT_ID.exec(id); if (x) m = Math.max(m, +x[1]); }
  return m;
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function serialize(r: Roster, a: AccountData): SaveFileV7 {
  return {
    version: SAVE_VERSION,
    roster: r.soldiers.map((s) => ({ ...s, progression: s.progression ?? newProgression() })),
    squad: [...r.slots],
    unlockedSoldiers: ALL_SOLDIER_IDS.filter((id) => r.unlocked.has(id)),
    account: {
      ...a, squadTraining: { ...a.squadTraining }, missions: Object.fromEntries(Object.entries(a.missions).map(([k, m]) => [k, { ...m }])), settledRuns: [...a.settledRuns],
      campaign: { unlockedMissions: [...a.campaign.unlockedMissions], selectedMission: a.campaign.selectedMission },
      recruitment: structuredClone(a.recruitment),
      pendingDecision: structuredClone(a.pendingDecision),
      memorial: structuredClone(a.memorial),
      phoenix: structuredClone(a.phoenix),
      activeRun: structuredClone(a.activeRun),
      named: structuredClone(a.named),
      classUnlocks: structuredClone(a.classUnlocks),
    },
  };
}

/** 'ok' saved; 'nostorage' no localStorage at all (session only); 'error' the write threw. */
export type WriteResult = 'ok' | 'nostorage' | 'error';
export function writeSave(r: Roster, a: AccountData): WriteResult {
  const ls = storage();
  if (!ls) return 'nostorage';
  try { ls.setItem(SAVE_KEY, JSON.stringify(serialize(r, a))); return 'ok'; } catch { return 'error'; }
}

/**
 * Parse + validate + migrate.
 *  - no save -> defaults ('new'): Ace + Ranger, Mission 1
 *  - unparseable JSON / not an object / no roster array -> raw text backed up under
 *    SAVE_BACKUP_KEY, defaults restored ('reset'). This is the ONLY reset path.
 *  - version 1 / 2 -> migrated in place ('migrated', or 'repaired' if something was also wrong):
 *    all six soldiers unlocked (legacy players owned them), campaign at Mission 1
 *  - version 3 -> migrated to v4 in place ('migrated'): every soldier, credit, rank, star and
 *    unlock kept; empty recruitment state (classes already recruitable count as introduced)
 *  - unknown version (e.g. a newer build's save) -> raw text backed up, then read best-effort
 *    as v3 ('repaired'), so progress is kept wherever it can be understood
 *  - version 4 (v0.5) -> migrated to v5 in place: every soldier is 'active', career fields not
 *    tracked before start at 0, empty Memorial / no pending decision / no Phoenix grant
 *  - version 5 (v0.6) -> migrated to v6: named recruit offers derived (see the v6 notes above)
 *  - version 6 (v0.6.1) -> loaded; fallen soldiers, the decision queue, Memorial, Phoenix grants
 *    and the mission journal validated against each other (see the repairs below)
 * Unknown (non-recruit) soldier ids are dropped; missing named soldiers are restored unless
 * they were dismissed; recruits are kept (bad fields repaired), never dropped.
 */
export function parseSave(raw: string | null): LoadResult {
  const notes: string[] = [];
  if (raw === null) return { roster: new Roster(), account: newAccount(), notes, status: 'new', fromVersion: null };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { data = undefined; }
  if (!isObj(data) || !Array.isArray(data.roster)) {
    notes.push(`Save ${!isObj(data) ? 'unreadable' : 'has no roster'}: roster reset to defaults.`);
    return { roster: new Roster(), account: newAccount(), notes, status: 'reset', fromVersion: null };
  }
  const version = typeof data.version === 'number' ? data.version : null;
  preSniper = version !== null && version < 7;
  const known = version === 1 || version === 2 || version === 3 || version === 4 || version === 5 || version === 6 || version === 7;
  const legacy = version === 1 || version === 2;
  const preRecruit = version !== 4 && version !== 5 && version !== 6 && version !== 7; // v1-v3 (and unknown): no recruitment state yet
  const v5 = version === 5 || version === 6 || version === 7; // permanent-death state (only a v5+ save can hold a fallen soldier)
  const v6 = version === 6 || version === 7; // v0.6.1 named recruit offers: owned named soldiers are never re-derived from missions
  const v7 = version === 7; // v0.6.2 class unlocks (Sniper)
  if (!known) notes.push(`Save version ${String(data.version)} not recognised: read best-effort (backup kept).`);

  const rawAccount = version === 1 ? undefined : data.account;
  const rawRec = isObj(rawAccount) ? rawAccount.recruitment : undefined;
  const dismissedIds = new Set(isObj(rawRec) && Array.isArray(rawRec.dismissed) ? rawRec.dismissed.filter(isObj).map((d) => d.id).filter((x): x is string => typeof x === 'string') : []);
  // v5 Memorial: honored soldiers never come back (not restored from the defaults, a roster copy is dropped)
  const memorial: MemorialRecord[] = [];
  if (v5 && isObj(rawAccount) && rawAccount.memorial !== undefined) {
    if (!Array.isArray(rawAccount.memorial)) notes.push('Memorial unreadable: dropped.');
    else for (const m of rawAccount.memorial) {
      if (!isObj(m) || !isObj(m.soldier) || typeof m.soldier.id !== 'string') { notes.push('Unreadable Memorial record dropped.'); continue; }
      const sid = m.soldier.id;
      if (memorial.some((x) => x.soldier.id === sid)) { notes.push(`Duplicate Memorial record for ${sid} dropped.`); continue; }
      if (dismissedIds.has(sid)) { notes.push(`Dismissed soldier ${sid} removed from the Memorial (dismissed soldiers are never memorialized).`); continue; }
      const named = defaultRoster().find((d) => d.id === sid);
      if (!named && !RECRUIT_ID.test(sid)) { notes.push(`Unknown soldier ${sid} removed from the Memorial.`); continue; }
      const soldier = named ? mergeSoldier(named, m.soldier, [], false) : cleanRecruit(m.soldier, [], false);
      soldier.status = 'kia';
      memorial.push({
        eventId: str(m.eventId, `mm-${sid}`), soldier, missionId: str(m.missionId), runId: str(m.runId), cause: cleanCause(m.cause),
        at: num0(m.at), cost: num0(m.cost), affordable: m.affordable === true,
      });
    }
  }
  const memorialIds = new Set(memorial.map((m) => m.soldier.id));

  const saved = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  for (const entry of data.roster) {
    if (!isObj(entry) || typeof entry.id !== 'string') { notes.push('Unreadable roster entry dropped.'); continue; }
    if (saved.has(entry.id)) { notes.push(`Duplicate soldier "${entry.id}" ignored.`); continue; }
    saved.set(entry.id, entry); order.push(entry.id);
  }
  // named campaign soldiers: merged onto their fixed defaults; restored if missing, unless dismissed
  const soldiers: SoldierIdentity[] = [];
  for (const d of defaultRoster()) {
    if (dismissedIds.has(d.id)) { if (saved.has(d.id)) notes.push(`${d.name}: dismissed, not restored.`); continue; }
    if (memorialIds.has(d.id)) { if (saved.has(d.id)) notes.push(`${d.name}: in the Memorial, roster copy dropped.`); continue; }
    const v = saved.get(d.id);
    if (!v) { notes.push(`${d.name}: missing in save, restored.`); soldiers.push(d); continue; }
    soldiers.push(mergeSoldier(d, v, notes, v5));
  }
  // recruits (any version: never thrown away for a bad field; a dismissed id is never revived)
  for (const id of order) {
    if (soldiers.some((s) => s.id === id)) continue;
    if (ALL_SOLDIER_IDS.includes(id)) continue; // dismissed named soldier
    if (!RECRUIT_ID.test(id)) { notes.push(`Unknown soldier "${id}" dropped.`); continue; }
    if (dismissedIds.has(id)) { notes.push(`Recruit ${id} was dismissed: not restored.`); continue; }
    if (memorialIds.has(id)) { notes.push(`Recruit ${id} is in the Memorial: roster copy dropped.`); continue; }
    soldiers.push(cleanRecruit(saved.get(id)!, notes, v5));
  }
  const account = cleanAccount(rawAccount, notes, legacy, version !== null && version < 7 ? ['bridgehead'] : []);
  account.memorial = memorial;
  if (v5 && isObj(rawAccount)) {
    account.pendingDecision = cleanPending(rawAccount.pendingDecision, notes);
    account.phoenix = cleanPhoenix(rawAccount.phoenix, notes);
    account.activeRun = cleanActiveRun(rawAccount.activeRun);
  }
  // decision queue <-> fallen soldiers: a queued id must be a fallen roster soldier; a fallen
  // soldier must be queued (a death is never silently undone, nothing is decided automatically)
  {
    const d = account.pendingDecision;
    if (d) {
      const before = d.queue.length;
      d.queue = d.queue.filter((q) => soldiers.some((s) => s.id === q.id));
      if (d.queue.length !== before) notes.push('Pending decision for a missing soldier dropped.');
      for (const q of d.queue) { const s = soldiers.find((x) => x.id === q.id)!; if (s.status !== 'kia') { s.status = 'kia'; notes.push(`${s.name}: awaiting a decision, marked fallen.`); } }
    }
    const orphans = soldiers.filter((s) => s.status === 'kia' && !account.pendingDecision?.queue.some((q) => q.id === s.id));
    if (orphans.length) {
      notes.push(`Fallen soldiers without a decision queued: ${orphans.map((s) => s.name).join(', ')}.`);
      if (!account.pendingDecision) account.pendingDecision = { kind: 'casualties', runId: 'repair', missionId: '', at: 0, queue: [], total: 0, resolved: [] };
      for (const s of orphans) { account.pendingDecision.queue.push({ id: s.id, cause: 'bleedout' }); account.pendingDecision.total++; }
    }
    if (account.pendingDecision && !account.pendingDecision.queue.length) account.pendingDecision = null;
    if (account.pendingDecision && account.phoenix.pending) { notes.push('Operation Phoenix grant opened before every decision was made: withdrawn.'); account.phoenix.pending = null; }
  }

  // owned named soldiers: legacy saves owned everyone; v3-v5 list them (repaired from mission
  // records: those versions awarded them for the clears); v6 lists them (purchases), never derived
  const done = (id: string) => (account.missions[id]?.completions ?? 0) > 0;
  let unlocked: string[];
  if (v6) {
    const listed = Array.isArray(data.unlockedSoldiers) ? data.unlockedSoldiers.filter((x): x is string => typeof x === 'string' && ALL_SOLDIER_IDS.includes(x)) : [];
    if (!Array.isArray(data.unlockedSoldiers)) notes.push('Owned soldiers list missing: starting soldiers kept, purchases restored from the claim history.');
    else if (listed.length !== data.unlockedSoldiers.length) notes.push('Unknown entries removed from owned soldiers.');
    unlocked = [...new Set([...STARTING_SOLDIERS, ...listed])];
  } else if (legacy || (!known && !Array.isArray(data.unlockedSoldiers))) unlocked = [...ALL_SOLDIER_IDS];
  else {
    const derived = derivedSoldierUnlocks(done);
    if (!Array.isArray(data.unlockedSoldiers)) { notes.push('Unlocked soldiers missing: rebuilt from mission records.'); unlocked = derived; }
    else {
      const listed = data.unlockedSoldiers.filter((x): x is string => typeof x === 'string' && ALL_SOLDIER_IDS.includes(x));
      if (listed.length !== data.unlockedSoldiers.length) notes.push('Unknown entries removed from unlocked soldiers.');
      const missing = derived.filter((x) => !listed.includes(x));
      if (missing.length) notes.push(`Soldiers ${missing.join(', ')} re-unlocked from mission records.`);
      unlocked = [...new Set([...listed, ...derived])];
    }
  }
  // a dismissed named soldier's unlock flag always stays set
  for (const id of dismissedIds) if (ALL_SOLDIER_IDS.includes(id) && !unlocked.includes(id)) unlocked.push(id);

  // v0.6.1 named recruit offers (by stable key, never by name)
  const named = v6 && isObj(rawAccount) ? cleanNamed(rawAccount.named, notes) : newNamedRecruits();
  if (v6 && isObj(rawAccount) && rawAccount.named === undefined) notes.push('Named recruit data missing: rebuilt from campaign progress and ownership.');
  if (v6) {
    // a v6 claim whose soldier is still on the roster but not owned (hand edit / lost flag): owned again, never re-sold
    for (const k of named.claimed) if (!unlocked.includes(k) && soldiers.some((s) => s.id === k)) { unlocked.push(k); notes.push(`${k}: claimed recruit restored to the roster.`); }
  }
  {
    const derived = derivedRecruitUnlocks(done);
    const missing = derived.filter((k) => !named.unlocked.includes(k));
    if (v6 && missing.length && rawAccount && isObj((rawAccount as Record<string, unknown>).named)) notes.push(`Recruit offers ${missing.join(', ')} re-unlocked from mission records.`);
    named.unlocked = NAMED_KEYS.filter((k) => named.unlocked.includes(k) || derived.includes(k));
    // claimed: owned (incl. KIA awaiting a decision), dismissed or honored: one soldier, never twice
    const before = new Set(named.claimed);
    const owned = unlocked.filter((k) => NAMED_KEYS.includes(k));
    const gone = NAMED_KEYS.filter((k) => dismissedIds.has(k) || memorialIds.has(k));
    named.claimed = NAMED_KEYS.filter((k) => before.has(k) || owned.includes(k) || gone.includes(k));
    for (const k of named.claimed) {
      if (!before.has(k)) {
        if (v6) notes.push(`${k}: owned, dismissed or honored, offer marked claimed.`);
        if (!named.history.some((h) => h.key === k)) named.history.push({ key: k, soldierId: k, at: 0, cost: 0, level: 1, legacy: true });
      }
      if (!named.notified.includes(k)) named.notified.push(k); // nothing to announce for a soldier already had
    }
    named.notified = NAMED_KEYS.filter((k) => named.notified.includes(k));
  }
  account.named = named;

  // v0.6.2 class unlocks: re-derived from mission records (never a free soldier); notices for
  // classes a migrated save already had are never owed (no older version could clear Mission 9)
  {
    const raw = v7 && isObj(rawAccount) ? rawAccount.classUnlocks : undefined;
    if (v7 && isObj(rawAccount) && raw === undefined) notes.push('Class unlock data missing: rebuilt from campaign progress.');
    const cu = newClassUnlocks();
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((c): c is string => typeof c === 'string' && c in CLASS_UNLOCK_TEXT) : []);
    const stored = isObj(raw) ? list(raw.unlocked) : [];
    const derived = derivedClassUnlocks(done);
    for (const c of stored) if (!derived.includes(c)) notes.push(`Class ${c}: unlocked without its milestone, kept.`);
    cu.unlocked = [...new Set([...stored, ...derived])];
    cu.notified = isObj(raw) ? list(raw.notified).filter((c) => cu.unlocked.includes(c)) : [...cu.unlocked];
    account.classUnlocks = cu;
  }

  // recruitment: pre-v0.5 saves owe no introduction for classes they can already recruit
  const flags = campaignFlags(account);
  const rec = cleanRecruitment(preRecruit ? undefined : rawRec, notes, recruitableClasses(flags));
  if (!preRecruit && rawRec === undefined) notes.push('Recruitment data missing: starts empty.');
  {
    // v0.6.2: an offer of a class that is not recruitable (yet) is dropped (e.g. a Sniper before Mission 9)
    const ok = recruitableClasses(flags), n0 = rec.offers.length;
    rec.offers = rec.offers.filter((o) => ok.includes(o.classId));
    if (rec.offers.length !== n0) notes.push('Recruitment offers of locked classes dropped.');
  }
  const seq = maxRecruitSeq([...soldiers.map((s) => s.id), ...rec.offers.map((o) => o.id), ...rec.dismissed.map((d) => d.id), ...memorial.map((m) => m.soldier.id), ...(account.phoenix.pending?.candidates.map((c) => c.id) ?? [])]);
  if (rec.nextSeq <= seq) { if (!preRecruit && rec.nextSeq !== 1) notes.push('Recruit id counter raised past existing ids.'); rec.nextSeq = seq + 1; }
  // offers can't collide with the roster (id or name) or reuse a registered name
  const rosterNames = new Set(soldiers.map((s) => nameKey(s.name)));
  const before = rec.offers.length;
  rec.offers = rec.offers.filter((o) => !soldiers.some((s) => s.id === o.id) && !rosterNames.has(nameKey(o.name)) && !rec.usedNames.some((n) => nameKey(n) === nameKey(o.name)));
  if (rec.offers.length !== before) notes.push('Recruitment offers clashing with the roster dropped.');
  // recruits whose names clash (hand-edited saves) get a fresh unique name; progress is kept
  const seen = new Set<string>(ALL_SOLDIER_IDS.map((id) => nameKey(defaultRoster().find((d) => d.id === id)!.name)));
  for (const s of soldiers) {
    if (ALL_SOLDIER_IDS.includes(s.id)) { seen.add(nameKey(s.name)); continue; }
    if (s.name && !seen.has(nameKey(s.name)) && s.name.length <= 20) { seen.add(nameKey(s.name)); continue; }
    const taken = takenNames([...seen], rec);
    const nn = generateName(taken, () => 0);
    notes.push(`Recruit ${s.id}: duplicate or invalid name, renamed ${nn}.`);
    s.name = nn; seen.add(nameKey(nn));
  }
  for (const s of soldiers) if (!ALL_SOLDIER_IDS.includes(s.id) && !rec.usedNames.some((n) => nameKey(n) === nameKey(s.name))) rec.usedNames.push(s.name);
  // Memorial names stay reserved forever
  for (const m of memorial) if (!rec.usedNames.some((n) => nameKey(n) === nameKey(m.soldier.name))) rec.usedNames.push(m.soldier.name);
  // an open Phoenix grant: candidates can't clash with the roster / registry; top up to the full set
  const px = account.phoenix.pending;
  if (px) {
    const before2 = px.candidates.length;
    px.candidates = px.candidates.filter((c) => !soldiers.some((s) => s.id === c.id || nameKey(s.name) === nameKey(c.name)) && !rec.usedNames.some((n) => nameKey(n) === nameKey(c.name)));
    if (px.candidates.length !== before2) notes.push('Operation Phoenix candidates clashing with the roster dropped.');
    if (px.candidates.length < PHOENIX_CANDIDATES) {
      if (px.candidates.length < 3) notes.push('Operation Phoenix candidates topped up.');
      const ctx = { flags: campaignFlags(account), progress: 1, taken: takenNames([...soldiers.map((s) => s.name), ...px.candidates.map((c) => c.name)], rec), rng: () => 0 };
      while (px.candidates.length < PHOENIX_CANDIDATES) px.candidates.push({ ...generateCandidate(rec, ctx, 'infantry'), classId: 'infantry', level: PHOENIX_LEVEL });
    }
  }
  account.recruitment = rec;

  const rawSquad = Array.isArray(data.squad) ? data.squad : legacy ? LEGACY_DEFAULT_SQUAD : DEFAULT_SQUAD;
  const roster = new Roster(soldiers, rawSquad, unlocked);
  const kept = roster.slots.filter(Boolean).length, asked = Array.isArray(data.squad) ? data.squad.filter((x) => x !== null).length : 0;
  if (!Array.isArray(data.squad)) notes.push('Squad selection missing: default squad selected.');
  else if (kept !== asked) notes.push('Invalid or locked squad entries removed.');

  const status: LoadStatus = !known || notes.length ? 'repaired' : version !== SAVE_VERSION ? 'migrated' : 'loaded';
  return { roster, account, notes, status, fromVersion: version };
}

/** Load from localStorage (and write back the normalised result). */
export function loadSave(): LoadResult {
  const ls = storage();
  let raw: string | null = null;
  try { raw = ls ? ls.getItem(SAVE_KEY) : null; } catch { raw = null; }
  const res = parseSave(raw);
  const v = res.fromVersion;
  const backup = res.status === 'reset' || (v !== null && v !== 1 && v !== 2 && v !== 3 && v !== 4 && v !== 5 && v !== 6 && v !== SAVE_VERSION)
    || (res.status === 'repaired' && v === null);
  if (backup && ls && raw !== null) { try { ls.setItem(SAVE_BACKUP_KEY, raw); } catch { /* full */ } }
  // never lose a legacy roster: keep the original v1/v2 text once, before the upgrade
  if ((v === 1 || v === 2) && ls && raw !== null) { try { if (ls.getItem(SAVE_LEGACY_KEY) === null) ls.setItem(SAVE_LEGACY_KEY, raw); } catch { /* full */ } }
  // v0.5: keep the pre-v4 text once (v1/v2/v3), before the v4 write
  if ((v === 1 || v === 2 || v === 3) && ls && raw !== null) { try { if (ls.getItem(SAVE_PRE_V05_KEY) === null) ls.setItem(SAVE_PRE_V05_KEY, raw); } catch { /* full */ } }
  // v0.6: keep the pre-v5 text once (v1-v4), before the v5 write
  if ((v === 1 || v === 2 || v === 3 || v === 4) && ls && raw !== null) { try { if (ls.getItem(SAVE_PRE_V06_KEY) === null) ls.setItem(SAVE_PRE_V06_KEY, raw); } catch { /* full */ } }
  // v0.6.1: keep the pre-v6 text once (v1-v5), before the v6 write
  if ((v === 1 || v === 2 || v === 3 || v === 4 || v === 5) && ls && raw !== null) { try { if (ls.getItem(SAVE_PRE_V061_KEY) === null) ls.setItem(SAVE_PRE_V061_KEY, raw); } catch { /* full */ } }
  // v0.6.2: keep the pre-v7 text once (v1-v6), before the v7 write
  if (v !== null && v >= 1 && v <= 6 && Number.isInteger(v) && ls && raw !== null) { try { if (ls.getItem(SAVE_PRE_V062_KEY) === null) ls.setItem(SAVE_PRE_V062_KEY, raw); } catch { /* full */ } }
  if (res.notes.length) console.warn('[MiniSquad save]', res.notes.join(' '));
  writeSave(res.roster, res.account);
  return res;
}

/** Single rotating backup of the save as it was just before the last "New Campaign" reset. */
export const SAVE_RESET_BACKUP_KEY = 'minisquad.save.pre-reset';

/**
 * Wipe the save -> new player (Ace + Ranger, Mission 1, 0 credits, no recruits, no offers).
 * Used by the player-facing "New Campaign" (Campaign screen, confirm dialog) and the dev panel
 * (two-tap). The current save text is copied first to SAVE_RESET_BACKUP_KEY as
 * {"at": <ms>, "save": "<raw text>"} (one rotating backup: the latest reset only). If that
 * backup can't be written, nothing is wiped and null is returned.
 */
export function resetSave(): { roster: Roster; account: AccountData } | null {
  const ls = storage();
  if (ls) {
    try {
      const raw = ls.getItem(SAVE_KEY);
      if (raw !== null) ls.setItem(SAVE_RESET_BACKUP_KEY, JSON.stringify({ at: Date.now(), save: raw }));
    } catch { return null; }
  }
  try { ls?.removeItem(SAVE_KEY); } catch { /* ignore */ }
  const roster = new Roster(), account = newAccount();
  writeSave(roster, account);
  return { roster, account };
}
