// Local save (localStorage only, no cloud). Versioned, validated, and forgiving.
//
// v2 (v0.3) stores: roster identities (id, name, class, trait id, legacy mods, progression
// with total XP, individual training ranks, future-proof status/resurrections/service record),
// the selected squad slots, and the account (credits, squad training ranks, per-mission
// records, recently settled mission-run ids). NOT stored: HP, cooldowns, mission state or
// effective stats (always recomputed, so nothing can stack).
//
// MIGRATION: a v1 save (v0.2.2) is upgraded IN PLACE: soldiers, traits and the squad are kept,
// new fields get their defaults (0 XP / level 1, no training, 0 credits). Formats are never
// reset just because they are old. Each field is repaired on its own (bad XP -> derived from
// level, bad ranks -> clamped, negative credits -> 0) instead of throwing a soldier away.
import { CLASSES, newProgression, newService, type ProgressionRecord, type ServiceRecord, type SoldierIdentity } from './classes';
import { MODIFIER_KEYS, TRAITS, type StatModifiers } from './traits';
import { DEFAULT_SQUAD, Roster, defaultRoster } from './roster';
import {
  LEVEL_CAP, MAX_XP, PROGRESSION, SQUAD_TRAINING, SQUAD_TRAINING_IDS, TRAINING, TRAINING_IDS, cleanRank, levelForXp, newAccount,
  newSquadTraining, newTraining, xpForLevel, type AccountData, type MissionRecord, type SquadTrainingRanks, type TrainingRanks,
} from './progression';

export const SAVE_KEY = 'minisquad.save';
export const SAVE_BACKUP_KEY = 'minisquad.save.invalid';
export const SAVE_VERSION = 2;

export interface SaveFileV2 {
  version: 2;
  roster: SoldierIdentity[];
  squad: (string | null)[];
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

function cleanAccount(v: unknown, notes: string[]): AccountData {
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
      const rec: MissionRecord = { completions: isInt(r.completions) && r.completions >= 0 ? r.completions : 0, firstClearRun: typeof r.firstClearRun === 'string' ? r.firstClearRun : null };
      if (rec.completions === 0 && rec.firstClearRun) rec.completions = 1;
      a.missions[id] = rec;
    }
  }
  if (Array.isArray(v.settledRuns)) {
    a.settledRuns = [...new Set(v.settledRuns.filter((x): x is string => typeof x === 'string' && x.length <= 64))].slice(-PROGRESSION.rememberRuns);
  }
  return a;
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function serialize(r: Roster, a: AccountData): SaveFileV2 {
  return {
    version: SAVE_VERSION,
    roster: r.soldiers.map((s) => ({ ...s, progression: s.progression ?? newProgression() })),
    squad: [...r.slots],
    account: { ...a, squadTraining: { ...a.squadTraining }, missions: { ...a.missions }, settledRuns: [...a.settledRuns] },
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
 *  - no save -> defaults ('new')
 *  - unparseable JSON / not an object / no roster array -> raw text backed up under
 *    SAVE_BACKUP_KEY, defaults restored ('reset'). This is the ONLY reset path.
 *  - version 1 -> migrated in place ('migrated', or 'repaired' if something was also wrong)
 *  - version 2 -> loaded, every field validated ('loaded' / 'repaired')
 *  - unknown version (e.g. a newer build's save) -> raw text backed up, then read best-effort
 *    as v2 ('repaired'), so progress is kept wherever it can be understood
 * Unknown soldier ids are dropped (no recruitment yet); missing soldiers are restored.
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
  const known = version === 1 || version === 2;
  if (!known) notes.push(`Save version ${String(data.version)} not recognised: read best-effort (backup kept).`);

  const saved = new Map<string, Record<string, unknown>>();
  for (const entry of data.roster) {
    if (!isObj(entry) || typeof entry.id !== 'string') { notes.push('Unreadable roster entry dropped.'); continue; }
    if (saved.has(entry.id)) { notes.push(`Duplicate soldier "${entry.id}" ignored.`); continue; }
    saved.set(entry.id, entry);
  }
  const soldiers = defaultRoster().map((d) => {
    const v = saved.get(d.id);
    if (!v) { notes.push(`${d.name}: missing in save, restored.`); return d; }
    return mergeSoldier(d, v, notes);
  });
  for (const id of saved.keys()) if (!soldiers.some((s) => s.id === id)) notes.push(`Unknown soldier "${id}" dropped.`);
  const rawSquad = Array.isArray(data.squad) ? data.squad : DEFAULT_SQUAD;
  const roster = new Roster(soldiers, rawSquad);
  const kept = roster.slots.filter(Boolean).length, asked = Array.isArray(data.squad) ? data.squad.filter((x) => x !== null).length : 0;
  if (!Array.isArray(data.squad)) notes.push('Squad selection missing: default squad selected.');
  else if (kept !== asked) notes.push('Invalid squad entries removed.');
  const account = cleanAccount(version === 1 ? undefined : data.account, notes);

  const status: LoadStatus = !known || notes.length ? 'repaired' : version === 1 ? 'migrated' : 'loaded';
  return { roster, account, notes, status, fromVersion: version };
}

/** Load from localStorage (and write back the normalised result). */
export function loadSave(): LoadResult {
  const ls = storage();
  let raw: string | null = null;
  try { raw = ls ? ls.getItem(SAVE_KEY) : null; } catch { raw = null; }
  const res = parseSave(raw);
  const backup = res.status === 'reset' || (res.fromVersion !== null && res.fromVersion !== 1 && res.fromVersion !== SAVE_VERSION)
    || (res.status === 'repaired' && res.fromVersion === null);
  if (backup && ls && raw !== null) { try { ls.setItem(SAVE_BACKUP_KEY, raw); } catch { /* full */ } }
  if (res.notes.length) console.warn('[MiniSquad save]', res.notes.join(' '));
  writeSave(res.roster, res.account);
  return res;
}

/** Dev (two-tap confirm in the tuning panel): wipe the save -> default roster, 0 credits. */
export function resetSave(): { roster: Roster; account: AccountData } {
  const ls = storage();
  try { ls?.removeItem(SAVE_KEY); } catch { /* ignore */ }
  const roster = new Roster(), account = newAccount();
  writeSave(roster, account);
  return { roster, account };
}
