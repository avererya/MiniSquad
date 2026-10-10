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
import { CAMPAIGN, FIRST_MISSION, derivedMissionUnlocks, derivedSoldierUnlocks } from './campaign';
import { type CandidateRecord, type DismissalRecord, type RecruitmentState, ROSTER_CAP, newRecruitment } from './progression';
import { RECRUIT_ID, generateName, isTraitValidFor, nameKey, recruitClass, recruitableClasses, takenNames } from './recruitment';

export const SAVE_KEY = 'minisquad.save';
export const SAVE_BACKUP_KEY = 'minisquad.save.invalid';
/** One-time copy of a v1/v2 save, taken before it is upgraded to v3. */
export const SAVE_LEGACY_KEY = 'minisquad.save.pre-v0.4';
/** One-time copy of any pre-v4 save (v1/v2/v3), taken before it is upgraded to v4 (v0.5). */
export const SAVE_PRE_V05_KEY = 'minisquad.save.pre-v0.5';
export const SAVE_VERSION = 4;

export interface SaveFileV4 {
  version: 4;
  roster: SoldierIdentity[];
  squad: (string | null)[];
  /** Campaign unlock flags of the named soldiers (kept after a dismissal). */
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
  for (const k of ['missions', 'victories', 'kills'] as const) if (isInt(v[k]) && v[k] >= 0) s[k] = v[k];
  return s;
}

/**
 * One saved soldier merged onto its default identity (roster soldiers are fixed: class and
 * trait come from the defaults if the save disagrees). Returns null for unknown ids.
 */
export function mergeSoldier(def: SoldierIdentity, v: Record<string, unknown>, notes: string[]): SoldierIdentity {
  const who = def.name;
  const s: SoldierIdentity = { ...def };
  if (typeof v.name === 'string' && v.name.trim() && v.name.length <= 20) s.name = v.name.trim();
  else if (v.name !== undefined) notes.push(`${who}: invalid name restored.`);
  if (v.classId !== def.classId) notes.push(`${who}: class ${String(v.classId)} invalid, restored to ${CLASSES[def.classId].label}.`);
  if (v.traitId !== def.traitId) notes.push(`${who}: trait ${String(v.traitId)} invalid, restored to ${def.traitId ? TRAITS[def.traitId].name : '-'}.`);
  s.mods = cleanMods(v.mods, notes, who);
  s.progression = cleanProgression(v.progression, notes, who);
  s.training = cleanRanks(v.training, TRAINING_IDS, TRAINING, newTraining(), notes, who) as TrainingRanks;
  s.status = 'active'; // v0.3: KIA is never permanent
  s.resurrections = isInt(v.resurrections) && v.resurrections >= 0 ? v.resurrections : 0;
  s.service = cleanService(v.service);
  return s;
}

/** A saved recruit: own class + trait (validated), progression, training. Never dropped for a bad field. */
function cleanRecruit(v: Record<string, unknown>, notes: string[]): SoldierIdentity {
  const id = v.id as string;
  let classId = v.classId as SoldierIdentity['classId'];
  if (!(CLASS_IDS as string[]).includes(classId)) { notes.push(`Recruit ${id}: class ${String(v.classId)} invalid, set to Infantry.`); classId = 'infantry'; }
  let traitId = v.traitId as SoldierIdentity['traitId'];
  if (!isTraitValidFor(traitId, classId)) { notes.push(`Recruit ${id}: trait ${String(v.traitId)} invalid, set to Sharpshooter.`); traitId = 'sharpshooter'; }
  const base: SoldierIdentity = { id, name: '', classId, traitId, mods: {}, progression: newProgression(), training: newTraining(), status: 'active', resurrections: 0, service: newService() };
  const s = mergeSoldier(base, { ...v, classId, traitId }, notes);
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
function cleanCampaign(v: unknown, missions: Record<string, MissionRecord>, notes: string[], legacy: boolean): CampaignProgress {
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
  const missing = derived.filter((x) => !listed.includes(x));
  if (missing.length && Array.isArray(v.unlockedMissions)) notes.push(`Missions ${missing.join(', ')} re-unlocked from mission records.`);
  c.unlockedMissions = CAMPAIGN.map((m) => m.id).filter((id) => merged.includes(id)); // campaign order
  if (typeof v.selectedMission === 'string' && c.unlockedMissions.includes(v.selectedMission)) c.selectedMission = v.selectedMission;
  else { if (v.selectedMission !== undefined) notes.push('Selected mission invalid: Mission 1 selected.'); c.selectedMission = FIRST_MISSION; }
  return c;
}

function cleanAccount(v: unknown, notes: string[], legacy: boolean): AccountData {
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
  a.campaign = cleanCampaign(v.campaign, a.missions, notes, legacy);
  return a;
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

export function serialize(r: Roster, a: AccountData): SaveFileV4 {
  return {
    version: SAVE_VERSION,
    roster: r.soldiers.map((s) => ({ ...s, progression: s.progression ?? newProgression() })),
    squad: [...r.slots],
    unlockedSoldiers: ALL_SOLDIER_IDS.filter((id) => r.unlocked.has(id)),
    account: {
      ...a, squadTraining: { ...a.squadTraining }, missions: Object.fromEntries(Object.entries(a.missions).map(([k, m]) => [k, { ...m }])), settledRuns: [...a.settledRuns],
      campaign: { unlockedMissions: [...a.campaign.unlockedMissions], selectedMission: a.campaign.selectedMission },
      recruitment: structuredClone(a.recruitment),
      pendingDecision: null,
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
 *  - version 4 (v0.5) -> loaded, recruits + recruitment state validated
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
  const known = version === 1 || version === 2 || version === 3 || version === 4;
  const legacy = version === 1 || version === 2;
  const preRecruit = version !== 4; // v1-v3 (and unknown): no recruitment state yet
  if (!known) notes.push(`Save version ${String(data.version)} not recognised: read best-effort (backup kept).`);

  const rawAccount = version === 1 ? undefined : data.account;
  const rawRec = isObj(rawAccount) ? rawAccount.recruitment : undefined;
  const dismissedIds = new Set(isObj(rawRec) && Array.isArray(rawRec.dismissed) ? rawRec.dismissed.filter(isObj).map((d) => d.id).filter((x): x is string => typeof x === 'string') : []);

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
    const v = saved.get(d.id);
    if (!v) { notes.push(`${d.name}: missing in save, restored.`); soldiers.push(d); continue; }
    soldiers.push(mergeSoldier(d, v, notes));
  }
  // recruits (any version: never thrown away for a bad field; a dismissed id is never revived)
  for (const id of order) {
    if (soldiers.some((s) => s.id === id)) continue;
    if (ALL_SOLDIER_IDS.includes(id)) continue; // dismissed named soldier
    if (!RECRUIT_ID.test(id)) { notes.push(`Unknown soldier "${id}" dropped.`); continue; }
    if (dismissedIds.has(id)) { notes.push(`Recruit ${id} was dismissed: not restored.`); continue; }
    soldiers.push(cleanRecruit(saved.get(id)!, notes));
  }
  const account = cleanAccount(rawAccount, notes, legacy);

  // unlocked soldiers: legacy saves owned everyone; v3+ lists them (repaired from mission records)
  const done = (id: string) => (account.missions[id]?.completions ?? 0) > 0;
  let unlocked: string[];
  if (legacy || (!known && !Array.isArray(data.unlockedSoldiers))) unlocked = [...ALL_SOLDIER_IDS];
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

  // recruitment: pre-v0.5 saves owe no introduction for classes they can already recruit
  const flags = new Set(unlocked);
  const rec = cleanRecruitment(preRecruit ? undefined : rawRec, notes, recruitableClasses(flags));
  if (!preRecruit && rawRec === undefined) notes.push('Recruitment data missing: starts empty.');
  const seq = maxRecruitSeq([...soldiers.map((s) => s.id), ...rec.offers.map((o) => o.id), ...rec.dismissed.map((d) => d.id)]);
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
  const backup = res.status === 'reset' || (v !== null && v !== 1 && v !== 2 && v !== 3 && v !== SAVE_VERSION)
    || (res.status === 'repaired' && v === null);
  if (backup && ls && raw !== null) { try { ls.setItem(SAVE_BACKUP_KEY, raw); } catch { /* full */ } }
  // never lose a legacy roster: keep the original v1/v2 text once, before the upgrade
  if ((v === 1 || v === 2) && ls && raw !== null) { try { if (ls.getItem(SAVE_LEGACY_KEY) === null) ls.setItem(SAVE_LEGACY_KEY, raw); } catch { /* full */ } }
  // v0.5: keep the pre-v4 text once (v1/v2/v3), before the v4 write
  if ((v === 1 || v === 2 || v === 3) && ls && raw !== null) { try { if (ls.getItem(SAVE_PRE_V05_KEY) === null) ls.setItem(SAVE_PRE_V05_KEY, raw); } catch { /* full */ } }
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
