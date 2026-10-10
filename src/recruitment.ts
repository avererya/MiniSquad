// v0.5 Recruitment Office: data tables + pure rules (candidate generation, names, levels,
// class / trait eligibility, one-time class introductions). The money-moving transactions
// (recruit, refresh, dismiss, rename) live in economy.ts next to the other purchases, and the
// persisted state (RecruitmentState) is declared in progression.ts.
//
// RULES (all tunable in the tables below)
//  - Three offers at a time. Each offer: unique name, one class from the recruitable pool, one
//    class-appropriate trait from the trait pool, a starting level from campaign progress.
//    Stats are never rolled: they come from class + level + trait (+ squad training, which
//    applies to every soldier) exactly like the roster.
//  - Recruitable classes: RECRUIT_CLASSES (Infantry from the start; Heavy Gunner from Tank's
//    milestone, Mission 1; Medic from Doc's milestone, Mission 2). Havoc / Patch add no class.
//    v0.6.1: these CAMPAIGN FLAGS (campaignFlags) come from the milestones, not from owning the
//    named soldier (a player who never buys Tank still recruits Heavy Gunners after Mission 1). Random class per offer,
//    duplicates allowed, no guaranteed spread.
//  - One-time introduction: when a class first becomes recruitable, the next lineup the player
//    sees holds at least one offer of it. Offers already on the table: the LAST offer(s) are
//    swapped for the new class(es), free, when the office is next shown. Saves from before
//    v0.5 treat the classes they already had as introduced (their first lineup is random).
//  - Trait pool: a trait can be rolled once the milestone of the named soldier carrying it is
//    reached (v0.6.1; also when that soldier was owned before v0.6.1, so no legacy player loses a
//    trait). Dismissing / losing the soldier never removes it. Healer: Medics only.
//  - Named campaign recruits (v0.6.1) are NOT offers here: they have their own permanent section
//    (economy.namedOffers) and never count toward the one-time class introduction.
//  - Names: NAME_POOL, never equal (case-insensitive) to a reserved campaign name, a roster
//    soldier, a current offer, or any name in the used-name registry (every recruited name,
//    dismissed soldiers' names, names given up by a rename). When the pool is exhausted:
//    "Ghost II", "Ghost III", ... then "Ghost 14" (deterministic, always within 12 chars).
//  - Starting level: highest unlocked mission number -> RECRUIT_LEVELS. Fixed at generation.
import { CLASSES, type SoldierClassId } from './classes';
import { TRAITS, type TraitId } from './traits';
import { CAMPAIGN, STARTING_SOLDIERS } from './campaign';
import type { AccountData, CandidateRecord, RecruitmentState } from './progression';

/** Recruitable classes: price, dismissal refund, and the named soldier whose MILESTONE unlocks it. */
export interface RecruitClassDef { classId: SoldierClassId; price: number; refund: number; requires: string | null }
export const RECRUIT_CLASSES: RecruitClassDef[] = [
  { classId: 'infantry', price: 750, refund: 200, requires: null },
  { classId: 'heavy', price: 1000, refund: 250, requires: 'tank' },
  { classId: 'medic', price: 1000, refund: 250, requires: 'doc' },
];
export const recruitClass = (c: SoldierClassId) => RECRUIT_CLASSES.find((x) => x.classId === c);
export const priceOf = (c: SoldierClassId) => recruitClass(c)?.price ?? Infinity;
export const refundOf = (c: SoldierClassId) => recruitClass(c)?.refund ?? 0;

/** Cost to replace all three offers. */
export const REFRESH_COST = 100;
/** Refresh anti-accident: the first tap arms the button ("Tap again — 100 CR") for this long. */
export const REFRESH_ARM_MS = 3000;
/** After a Recruit / Refresh / Dismiss, every menu tap is ignored this long (double-tap guard). */
export const RECRUIT_LOCK_MS = 450;

/**
 * Trait pool for recruits: the named soldier whose JOIN (unlock flag) makes the trait available,
 * and which classes may roll it (null = every class; each of these traits works for any class).
 */
export const RECRUIT_TRAITS: { traitId: TraitId; requires: string; classes: SoldierClassId[] | null }[] = [
  { traitId: 'sharpshooter', requires: 'ace', classes: null },
  { traitId: 'quickReflexes', requires: 'ranger', classes: null },
  { traitId: 'tough', requires: 'tank', classes: null },
  { traitId: 'firstResponder', requires: 'doc', classes: null },
  { traitId: 'triggerHappy', requires: 'havoc', classes: null },
  { traitId: 'healer', requires: 'patch', classes: ['medic'] },
];

/** Starting level by campaign progress (highest unlocked mission number). */
export const RECRUIT_LEVELS: { from: number; to: number; level: number }[] = [
  { from: 1, to: 5, level: 1 },
  { from: 6, to: 10, level: 3 },
  { from: 11, to: 15, level: 5 },
  { from: 16, to: 20, level: 8 },
  { from: 21, to: 30, level: 10 },
  { from: 31, to: 40, level: 15 },
  { from: 41, to: Infinity, level: 20 },
];
export function startingLevelFor(missionNumber: number): number {
  return RECRUIT_LEVELS.find((r) => missionNumber >= r.from && missionNumber <= r.to)?.level ?? 1;
}
/** Campaign progress = highest mission number unlocked (completed missions are unlocked too). Never the selected mission. */
export function campaignProgress(a: AccountData): number {
  const done = Object.entries(a.missions).filter(([, r]) => r.completions > 0).map(([id]) => id);
  const ids = new Set([...a.campaign.unlockedMissions, ...done]);
  return Math.max(1, ...CAMPAIGN.filter((m) => ids.has(m.id)).map((m) => m.number));
}

/** Campaign soldiers' names: never generated, never usable by a rename. */
export const RESERVED_NAMES = ['Ace', 'Ranger', 'Tank', 'Havoc', 'Doc', 'Patch'];
export const NAME_MAX = 12;
/** Curated recruit names: short, readable, lighthearted. */
export const NAME_POOL = [
  'Ghost', 'Brick', 'Stitch', 'Viper', 'Flint', 'Echo', 'Scout', 'Rook', 'Dash', 'Bolt',
  'Shadow', 'Trigger', 'Hawk', 'Atlas', 'Knox', 'Maverick', 'Bandit', 'Blaze', 'Copper', 'Wolf',
  'Moose', 'Tiny', 'Sarge', 'Biscuit', 'Pickle', 'Rocket', 'Sparky', 'Jinx', 'Lucky', 'Gizmo',
  'Nugget', 'Tater', 'Badger', 'Bulldog', 'Cobra', 'Falcon', 'Raven', 'Fox', 'Bear', 'Bison',
  'Mako', 'Shark', 'Rhino', 'Hornet', 'Wasp', 'Gator', 'Mustang', 'Bronco', 'Comet', 'Nova',
  'Orbit', 'Sparrow', 'Finch', 'Puck', 'Chip', 'Buzz', 'Duke', 'Rusty', 'Smokey', 'Tex',
  'Grit', 'Hammer', 'Anvil', 'Spike', 'Tusk', 'Fang', 'Diesel', 'Turbo', 'Jet', 'Hopper',
  'Domino', 'Dice', 'Joker', 'Jester', 'Pepper', 'Ginger', 'Mango', 'Waffles', 'Noodle', 'Taco',
  'Pretzel', 'Muffin', 'Scooter', 'Bingo', 'Buckshot', 'Boomer', 'Crash', 'Thunder', 'Storm', 'Frost',
  'Ember', 'Cinder', 'Granite', 'Slate', 'Iron', 'Steel', 'Sling', 'Arrow', 'Sprocket', 'Widget',
  'Radar', 'Sonar', 'Pixel', 'Ziggy', 'Bramble', 'Cactus', 'Pebble', 'Boulder', 'Gravel', 'Socks',
];

/** Canonical form for the uniqueness rules. */
export const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Everything a new name must not collide with (lowercase). */
export function takenNames(soldierNames: string[], state: RecruitmentState, extra: string[] = []): Set<string> {
  return new Set([
    ...RESERVED_NAMES, ...soldierNames, ...state.offers.map((o) => o.name), ...state.usedNames,
    ...state.dismissed.map((d) => d.name), ...extra,
  ].map(nameKey));
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
/** A random free pool name, else the deterministic numbered fallback. Never a duplicate, never throws. */
export function generateName(taken: Set<string>, rng: () => number = Math.random): string {
  const free = NAME_POOL.filter((n) => !taken.has(nameKey(n)));
  if (free.length) return free[Math.floor(rng() * free.length) % free.length];
  for (let n = 2; n < 100000; n++) {
    for (const base of NAME_POOL) {
      const name = `${base} ${n < ROMAN.length ? ROMAN[n] : n}`;
      if (name.length <= NAME_MAX && !taken.has(nameKey(name))) return name;
    }
  }
  for (let n = 1; ; n++) if (!taken.has(nameKey(`R-${n}`))) return `R-${n}`;
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };
/**
 * Rename / name rules: trimmed (inner spaces collapsed), 1-12 characters, letters, digits,
 * space, hyphen, apostrophe, period; at least one letter or digit; unique (case-insensitive)
 * against reserved campaign names, the roster, current offers and the used-name registry.
 * A soldier may keep its own current name or change its capitalisation.
 */
export function validateName(raw: string, currentName: string | null, taken: Set<string>): NameCheck {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, reason: 'Name cannot be blank.' };
  if (name.length > NAME_MAX) return { ok: false, reason: `Name is too long (max ${NAME_MAX} characters).` };
  if (!/^[A-Za-z0-9 '.-]+$/.test(name)) return { ok: false, reason: 'Use letters, digits, space, - \' or . only.' };
  if (!/[A-Za-z0-9]/.test(name)) return { ok: false, reason: 'Name needs at least one letter or digit.' };
  if (currentName !== null && nameKey(name) === nameKey(currentName)) return { ok: true, name };
  if (taken.has(nameKey(name))) return { ok: false, reason: `"${name}" is already taken or reserved.` };
  return { ok: true, name };
}

/**
 * v0.6.1 campaign flags for the class / trait pools: the starting soldiers, every named recruit
 * whose milestone was reached, and every named offer already claimed (pre-v0.6.1 ownership).
 * Never derived from who is in the roster right now.
 */
export function campaignFlags(a: Pick<AccountData, 'named'>): Set<string> {
  return new Set([...STARTING_SOLDIERS, ...a.named.unlocked, ...a.named.claimed]);
}
/** Classes recruitable with these campaign flags (see campaignFlags). */
export function recruitableClasses(flags: Set<string>): SoldierClassId[] {
  return RECRUIT_CLASSES.filter((c) => !c.requires || flags.has(c.requires)).map((c) => c.classId);
}
/** Traits a recruit of this class may roll with these unlock flags. */
export function traitPool(classId: SoldierClassId, flags: Set<string>): TraitId[] {
  return RECRUIT_TRAITS.filter((t) => flags.has(t.requires) && (!t.classes || t.classes.includes(classId))).map((t) => t.traitId);
}
export const isTraitValidFor = (traitId: unknown, classId: SoldierClassId) =>
  typeof traitId === 'string' && traitId in TRAITS && RECRUIT_TRAITS.some((t) => t.traitId === traitId && (!t.classes || t.classes.includes(classId)));

export const RECRUIT_ID = /^rc-(\d{1,9})$/;
export const isRecruitId = (id: string) => RECRUIT_ID.test(id);

/** Inputs for generating offers (rng injectable for tests). */
export interface GenContext {
  flags: Set<string>;
  /** Highest unlocked mission number (campaign progress). */
  progress: number;
  /** Lowercase names that may not be used (mutated as names are handed out). */
  taken: Set<string>;
  rng: () => number;
}

/** One new offer. Consumes a permanent id from the state. */
export function generateCandidate(state: RecruitmentState, ctx: GenContext, forced?: SoldierClassId): CandidateRecord {
  const classes = recruitableClasses(ctx.flags);
  const classId = forced ?? classes[Math.floor(ctx.rng() * classes.length) % classes.length];
  const traits = traitPool(classId, ctx.flags);
  const traitId = traits.length ? traits[Math.floor(ctx.rng() * traits.length) % traits.length] : 'sharpshooter';
  const name = generateName(ctx.taken, ctx.rng);
  ctx.taken.add(nameKey(name));
  const id = `rc-${state.nextSeq++}`;
  return { id, name, classId, traitId, level: startingLevelFor(ctx.progress) };
}

/** Classes that are recruitable but have not had their one-time introduction yet. */
export function pendingIntroductions(state: RecruitmentState, flags: Set<string>): SoldierClassId[] {
  return recruitableClasses(flags).filter((c) => !state.introduced.includes(c));
}
function markIntroduced(state: RecruitmentState, flags: Set<string>) {
  for (const c of recruitableClasses(flags)) if (!state.introduced.includes(c)) state.introduced.push(c);
}

/** Three brand-new offers (Refresh, first visit), pending introductions placed first. */
export function newLineup(state: RecruitmentState, ctx: GenContext): CandidateRecord[] {
  const forced = pendingIntroductions(state, ctx.flags).slice(0, 3);
  const out = Array.from({ length: 3 }, (_, i) => generateCandidate(state, ctx, forced[i]));
  markIntroduced(state, ctx.flags);
  return out;
}

/**
 * Called whenever the office is shown. Generates offers ONLY when there are fewer than three
 * (first visit, or offers dropped by save repair) and performs pending one-time class
 * introductions by swapping the LAST offer(s) (free). Otherwise changes nothing, so reopening,
 * reloading or switching tabs never produces free candidates. Returns true if anything changed.
 */
export function ensureOffers(state: RecruitmentState, ctx: GenContext): boolean {
  let changed = false;
  const pending = pendingIntroductions(state, ctx.flags).filter((c) => !state.offers.some((o) => o.classId === c));
  if (state.offers.length > 3) { state.offers = state.offers.slice(0, 3); changed = true; }
  // fill empty slots first (new offers take the pending classes)
  while (state.offers.length < 3) { state.offers.push(generateCandidate(state, ctx, pending.shift())); changed = true; }
  // remaining pending classes replace existing offers from the last slot backwards
  for (let slot = 2; pending.length && slot >= 0; slot--) {
    const keep = state.offers[slot];
    if (pendingIntroductions(state, ctx.flags).includes(keep.classId) && !pending.includes(keep.classId)) continue; // already an introduction
    state.offers[slot] = generateCandidate(state, ctx, pending.shift());
    changed = true;
  }
  if (pendingIntroductions(state, ctx.flags).length) { markIntroduced(state, ctx.flags); changed = true; }
  return changed;
}

export const classLabel = (c: SoldierClassId) => CLASSES[c].label;
