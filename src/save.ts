// Local save (localStorage only, no cloud). Versioned, validated, and forgiving:
// anything unreadable falls back to the default roster instead of breaking the game.
//
// Stored: roster identities (id, name, class, trait id, individual modifiers, progression)
// and the selected squad slots. NOT stored: HP, cooldowns, mission state, effective stats
// (those are always recomputed from class base + trait + modifiers, so nothing can stack).
import { CLASSES, newProgression, type ProgressionRecord, type SoldierIdentity } from './classes';
import { MODIFIER_KEYS, TRAITS, type StatModifiers } from './traits';
import { DEFAULT_SQUAD, Roster, defaultRoster } from './roster';

export const SAVE_KEY = 'minisquad.save';
export const SAVE_BACKUP_KEY = 'minisquad.save.invalid';
export const SAVE_VERSION = 1;

export interface SaveFileV1 {
  version: 1;
  roster: SoldierIdentity[];
  squad: (string | null)[];
}

export interface LoadResult { roster: Roster; notes: string[]; status: 'new' | 'loaded' | 'repaired' | 'reset' }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function validMods(v: unknown): StatModifiers | null {
  if (v === undefined) return {};
  if (!isObj(v)) return null;
  const out: StatModifiers = {};
  for (const [k, x] of Object.entries(v)) {
    if (!(MODIFIER_KEYS as readonly string[]).includes(k)) return null;
    if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x > 10) return null;
    (out as any)[k] = x;
  }
  return out;
}

function validProgression(v: unknown): ProgressionRecord | null {
  if (!isObj(v)) return null;
  const { level, xp, upgrades, specialization } = v;
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 99) return null;
  if (typeof xp !== 'number' || !Number.isFinite(xp) || xp < 0) return null;
  if (!Array.isArray(upgrades) || !upgrades.every((u) => typeof u === 'string')) return null;
  if (specialization !== null && typeof specialization !== 'string') return null;
  return { level, xp, upgrades: [...upgrades], specialization };
}

/** One saved soldier, or null if any field is wrong. */
export function validSoldier(v: unknown): SoldierIdentity | null {
  if (!isObj(v)) return null;
  const { id, name, classId, traitId } = v;
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(id)) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > 20) return null;
  if (typeof classId !== 'string' || !(classId in CLASSES)) return null;
  if (typeof traitId !== 'string' || !(traitId in TRAITS)) return null; // roster soldiers: exactly one trait
  const mods = validMods(v.mods);
  const progression = validProgression(v.progression);
  if (!mods || !progression) return null;
  return { id, name: name.trim(), classId: classId as SoldierIdentity['classId'], traitId: traitId as SoldierIdentity['traitId'], mods, progression };
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function serialize(r: Roster): SaveFileV1 {
  return { version: SAVE_VERSION, roster: r.soldiers.map((s) => ({ ...s, progression: s.progression ?? newProgression() })), squad: [...r.slots] };
}

export function writeSave(r: Roster): boolean {
  const ls = storage();
  if (!ls) return false;
  try { ls.setItem(SAVE_KEY, JSON.stringify(serialize(r))); return true; } catch { return false; }
}

/**
 * Parse + validate. Recovery rules:
 *  - no save -> defaults ('new')
 *  - unparseable JSON, not an object, or a version other than 1 -> raw text backed up under
 *    SAVE_BACKUP_KEY, defaults restored ('reset')
 *  - version 1 with some bad entries -> every default soldier whose saved entry is missing or
 *    invalid is restored from the defaults; unknown ids are dropped (no recruitment yet);
 *    bad/duplicate/unknown squad ids are removed ('repaired')
 */
export function parseSave(raw: string | null): LoadResult {
  const notes: string[] = [];
  if (raw === null) return { roster: new Roster(), notes, status: 'new' };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { data = undefined; }
  if (!isObj(data) || data.version !== SAVE_VERSION || !Array.isArray(data.roster)) {
    const why = !isObj(data) ? 'unreadable' : data.version !== SAVE_VERSION ? `unsupported version ${String(data.version)}` : 'missing roster';
    notes.push(`Save ${why}: roster reset to defaults.`);
    return { roster: new Roster(), notes, status: 'reset' };
  }
  const saved = new Map<string, SoldierIdentity>();
  for (const entry of data.roster) {
    const s = validSoldier(entry);
    if (s && !saved.has(s.id)) saved.set(s.id, s);
  }
  const soldiers = defaultRoster().map((d) => {
    const s = saved.get(d.id);
    if (!s) { notes.push(`${d.name}: missing or invalid in save, restored.`); return d; }
    return s;
  });
  for (const id of saved.keys()) if (!soldiers.some((s) => s.id === id)) notes.push(`Unknown soldier "${id}" dropped.`);
  const rawSquad = Array.isArray(data.squad) ? data.squad : DEFAULT_SQUAD;
  const roster = new Roster(soldiers, rawSquad);
  const kept = roster.slots.filter(Boolean).length, asked = Array.isArray(data.squad) ? data.squad.filter((x) => x !== null).length : 0;
  if (!Array.isArray(data.squad)) notes.push('Squad selection missing: default squad selected.');
  else if (kept !== asked) notes.push('Invalid squad entries removed.');
  return { roster, notes, status: notes.length ? 'repaired' : 'loaded' };
}

/** Load from localStorage (and write back the normalised result). */
export function loadSave(): LoadResult {
  const ls = storage();
  let raw: string | null = null;
  try { raw = ls ? ls.getItem(SAVE_KEY) : null; } catch { raw = null; }
  const res = parseSave(raw);
  if (res.status === 'reset' && ls && raw !== null) { try { ls.setItem(SAVE_BACKUP_KEY, raw); } catch { /* full */ } }
  if (res.notes.length) console.warn('[MiniSquad save]', res.notes.join(' '));
  writeSave(res.roster);
  return res;
}

/** Dev: wipe the save and return a default roster. */
export function resetSave(): Roster {
  const ls = storage();
  try { ls?.removeItem(SAVE_KEY); } catch { /* ignore */ }
  const r = new Roster();
  writeSave(r);
  return r;
}
