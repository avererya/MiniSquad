// v0.7A Elite Promotions: the eight specializations (data), promotion eligibility rules, and the
// combat passives (runtime, simulation-step only). The money-moving promotion transaction lives in
// economy.ts (promote), the persisted fields in classes.ts (ProgressionRecord tier / elitePath /
// eliteLevel / eliteXp) and progression.ts (account.promotions ledger), the screens in menus.ts,
// the uniforms in render.ts.
//
// RULES
//  - A living, owned Recruit at Recruit Level 25 (the level cap) may be promoted by the player for
//    PROMOTION_COST Credits into one of the two specializations of their class. Once, permanently:
//    no respec, no second promotion, no refund.
//  - Promotion keeps everything (id, name, class, trait, training, Recruit XP / level 25, career,
//    resurrections) and adds tier 'elite', elitePath (stable spec id), eliteLevel 1, eliteXp 0.
//    The stat pipeline keeps reading the Recruit level (25), so Elite Level 1 is never weaker than
//    Recruit Level 25.
//  - v0.7B Elite levels 2-30: mission XP earned after the promotion accumulates in eliteXp
//    (cumulative, the source of truth); eliteLevel is derived from it with the ELITE_PROGRESSION
//    curve at mission settlement (never per frame). Each Elite level above 1 adds a small, linear
//    share of the Level-30 bonuses (see ELITE LEVEL BONUSES below).
//
// PASSIVES (numbers in CFG.elite, live-tunable). Each is automatic and has no button. Counters and
// charges live on the mission Unit (EliteState), so they reset at every mission start and Retry.
// Everything here runs in the fixed 1/60 s simulation step (never per drawn frame), so 30 and 60
// FPS play identically. None of it draws random numbers, so a squad without Elites (and without a
// Field Commander) simulates bit-identically to v0.6.4.
//
// STACKING CONTROL
//  - Incoming damage reduction (Adrenaline Rush, Ironclad) is capped at CFG.elite.maxDamageReduction
//    (40%); the two never meet on one soldier (different classes) and no trait or training reduces
//    damage, so nothing approaches invulnerability.
//  - Outgoing per-shot multipliers (Rally x1.1, Deadeye x1.5, Perfect Aim x1.75) multiply, then are
//    capped at CFG.elite.maxShotMul (x2.0). Phantom Shot only removes armor; it adds no damage.
//  - Overdrive adds +25% of the base fire rate ON TOP of Suppressive Fire / Rapid Fire additively
//    (x1.75 -> x2.0), never multiplicatively.
//  - Perfect Aim charges on time, not on shots: Sniper Focus (faster aim + fire rate) gives more
//    ordinary shots but never more charged ones (at most one per charge time of stationary aim).
import { CFG } from './config';
import type { SoldierClassId, SoldierIdentity } from './classes';
import type { StatModifiers } from './traits';
import type { Unit } from './unit';
import type { Game } from './game';
import { dist } from './util';

export type EliteSpecId = 'inf-trooper' | 'inf-recon' | 'hvy-juggernaut' | 'hvy-weapons' | 'med-surgeon' | 'med-commander' | 'snp-ghost' | 'snp-deadeye';

export interface EliteSpecDef {
  /** Stable save id (never shown; display names can change). */
  id: EliteSpecId;
  classId: SoldierClassId;
  /** Elite title, e.g. "Elite Trooper". */
  title: string;
  /** Combat identity, e.g. "Frontline Survivor". */
  role: string;
  /** Passive ability name. */
  passive: string;
  /** Practical one-line combat benefit (promotion cards, profile). */
  desc: string;
  /** Short tag for tight places (squad slots, compact HUD). */
  short: string;
}

export const ELITE_SPECS: Record<EliteSpecId, EliteSpecDef> = {
  'inf-trooper': {
    id: 'inf-trooper', classId: 'infantry', title: 'Elite Trooper', role: 'Frontline Survivor', passive: 'Adrenaline Rush', short: 'TRP',
    desc: 'Below 35% HP, takes 25% less damage from every attack. Turns off again once healed above 35%.',
  },
  'inf-recon': {
    id: 'inf-recon', classId: 'infantry', title: 'Recon Commando', role: 'Mobile Precision Fighter', passive: 'Deadeye', short: 'RCN',
    desc: 'Every 5th rifle hit deals +50% damage. Misses don\'t count; grenades are not affected.',
  },
  'hvy-juggernaut': {
    id: 'hvy-juggernaut', classId: 'heavy', title: 'Juggernaut', role: 'Defensive Tank', passive: 'Ironclad', short: 'JUG',
    desc: 'Always takes 20% less damage from bullets, rockets and boss attacks.',
  },
  'hvy-weapons': {
    id: 'hvy-weapons', classId: 'heavy', title: 'Weapons Specialist', role: 'Sustained Firepower', passive: 'Overdrive', short: 'WPN',
    desc: 'Keeps firing to spin up: fire rate builds to +25% over 4 s of sustained fire, and cools down after a pause.',
  },
  'med-surgeon': {
    id: 'med-surgeon', classId: 'medic', title: 'Combat Surgeon', role: 'Emergency Specialist', passive: 'Miracle Worker', short: 'SRG',
    desc: 'Revives 30% faster, and revived soldiers get up with 50% HP instead of 30%.',
  },
  'med-commander': {
    id: 'med-commander', classId: 'medic', title: 'Field Commander', role: 'Squad Support Leader', passive: 'Rally', short: 'CMD',
    desc: 'Squadmates near the Commander deal +10% weapon damage and move 10% faster. Stops while the Commander is down.',
  },
  'snp-ghost': {
    id: 'snp-ghost', classId: 'sniper', title: 'Ghost', role: 'Armor-Piercing Precision', passive: 'Phantom Shot', short: 'GST',
    desc: 'Every 4th hit is a precision round that ignores 60% of enemy armor (Armored Troopers, the Iron Warden).',
  },
  'snp-deadeye': {
    id: 'snp-deadeye', classId: 'sniper', title: 'Deadeye', role: 'Deliberate Marksman', passive: 'Perfect Aim', short: 'DED',
    desc: 'Holding still with a target in sight for 3 s charges the next shot: +75% damage. Moving resets the charge.',
  },
};
export const ELITE_SPEC_IDS = Object.keys(ELITE_SPECS) as EliteSpecId[];
/** The two branches of each class, in display order. */
export const CLASS_BRANCHES: Record<SoldierClassId, [EliteSpecId, EliteSpecId]> = {
  infantry: ['inf-trooper', 'inf-recon'],
  heavy: ['hvy-juggernaut', 'hvy-weapons'],
  medic: ['med-surgeon', 'med-commander'],
  sniper: ['snp-ghost', 'snp-deadeye'],
};
export const eliteSpec = (id: unknown): EliteSpecDef | null => (typeof id === 'string' && id in ELITE_SPECS ? ELITE_SPECS[id as EliteSpecId] : null);
/** A valid spec id for this class (save validation, promotion). */
export const isSpecFor = (id: unknown, classId: SoldierClassId) => !!eliteSpec(id) && CLASS_BRANCHES[classId]?.includes(id as EliteSpecId);

// ---------------- promotion rules ----------------
export const PROMOTION_COST = 3000;
/** Recruit level that opens the promotion (the Recruit level cap). */
export const PROMOTION_LEVEL = 25;
/** Elite level cap (permanent). */
export const ELITE_LEVEL_CAP = 30;

// ---------------- v0.7B Elite levels ----------------
// ELITE XP CURVE: XP to advance from Elite Level L to L+1 = base + step x (L - 1), i.e. 600, 645,
// 690 ... 1,860 (L29 -> L30). Total from Elite 1 to Elite 30: 35,670 XP. eliteXp is cumulative
// since the promotion; XP earned at the cap is still recorded but grants nothing.
//
// ELITE LEVEL BONUSES: measured against the soldier's OWN Elite Level 1 stats (= their Recruit
// Level 25 stats with training, squad training and trait), growing linearly from +0 at Elite 1 to
// the `atCap` values at Elite 30. They enter the stat pipeline as ONE multiplier per stat (the
// eliteModifiers set, next to the trait), so they never compound per level and Elite Level 1 is
// exactly the v0.7A soldier. Fire rate and move speed are deliberately not touched. Per-shot
// passive multipliers (Rally / Deadeye / Perfect Aim, cap x2) and incoming damage reduction (cap
// 40%) are separate layers and keep their caps unchanged.
export const ELITE_PROGRESSION = {
  xp: { base: 600, step: 45 },
  /** Elite 30 vs Elite 1, every class. */
  atCap: { hp: 0.25, damage: 0.15 },
  /** Class-appropriate extra at Elite 30 (multiplier reached at the cap; linear in between). */
  classAtCap: {
    infantry: { spreadMul: 0.9 }, // -10% weapon spread
    heavy: { spreadMul: 0.9 }, // -10% weapon spread (tighter bursts)
    medic: { healMul: 1.1 }, // +10% Field Treatment healing
    sniper: { aimTimeMul: 0.9 }, // -10% held-aim time before each shot
  } as Record<SoldierClassId, StatModifiers>,
};

/** XP needed to go from Elite `level` to `level + 1` (0 at the cap). */
export function eliteXpToNext(level: number): number {
  const X = ELITE_PROGRESSION.xp;
  return level >= ELITE_LEVEL_CAP ? 0 : X.base + X.step * (Math.max(1, level) - 1);
}
/** Cumulative Elite XP needed to REACH Elite `level` (Elite 1 = 0). */
export function eliteXpForLevel(level: number): number {
  let t = 0;
  for (let l = 1; l < Math.min(level, ELITE_LEVEL_CAP); l++) t += eliteXpToNext(l);
  return t;
}
export const ELITE_MAX_XP = (): number => eliteXpForLevel(ELITE_LEVEL_CAP);
/** Elite level for a cumulative Elite XP amount (1..cap; anything invalid counts as 0 XP). */
export function eliteLevelForXp(xp: number): number {
  const x = Number.isFinite(xp) ? xp : 0;
  let l = 1;
  while (l < ELITE_LEVEL_CAP && x >= eliteXpForLevel(l + 1)) l++;
  return l;
}
/** Progress inside the current Elite level, for the XP bar. */
export function eliteProgress(xp: number) {
  const level = eliteLevelForXp(xp);
  if (level >= ELITE_LEVEL_CAP) return { level, into: 0, need: 0, frac: 1, max: true };
  const into = xp - eliteXpForLevel(level), need = eliteXpToNext(level);
  return { level, into, need, frac: into / need, max: false };
}
/** Share of the Level-30 bonuses an Elite level gives: 0 at Elite 1, 1 at Elite 30. */
export const eliteBonusFrac = (level: number) => Math.max(0, Math.min(ELITE_LEVEL_CAP, Math.floor(level)) - 1) / (ELITE_LEVEL_CAP - 1);
/** The Elite-level bonus as stat multipliers (null at Elite 1: exactly the v0.7A soldier). */
export function eliteLevelModifiers(classId: SoldierClassId, level: number): StatModifiers | null {
  const t = eliteBonusFrac(level);
  if (t <= 0) return null;
  const A = ELITE_PROGRESSION.atCap;
  const out: StatModifiers = { hpMul: 1 + A.hp * t, damageMul: 1 + A.damage * t };
  const extra = ELITE_PROGRESSION.classAtCap[classId] ?? {};
  for (const [k, v] of Object.entries(extra) as [keyof StatModifiers, number][]) out[k] = 1 + (v - 1) * t;
  return out;
}

type Promotable = Pick<SoldierIdentity, 'progression' | 'status' | 'classId'>;
export const isElite = (s: Pick<SoldierIdentity, 'progression'> | null | undefined) => s?.progression?.tier === 'elite' && !!eliteSpec(s.progression.elitePath);
export const specOf = (s: Pick<SoldierIdentity, 'progression'> | null | undefined): EliteSpecDef | null => (isElite(s) ? eliteSpec(s!.progression!.elitePath) : null);
/** Recruit at the promotion level (ignores Credits and other blocks: the profile shows the offer). */
export const promotionReady = (s: Promotable) => !!s.progression && s.progression.tier !== 'elite' && s.progression.level >= PROMOTION_LEVEL && s.status === 'active';

/** Level shown to the player: "ELITE 12" / "LV 12". Never "LV n" for a promoted soldier. */
export function levelTag(s: Pick<SoldierIdentity, 'progression'>): string {
  const p = s.progression;
  if (isElite(s)) return `ELITE ${Math.max(1, p!.eliteLevel)}`;
  return `LV ${p?.level ?? 1}`;
}

/**
 * Static stat modifiers an Elite adds to the effective-stat pipeline (classes.ts): the
 * specialization's (Combat Surgeon revive speed) and, v0.7B, the Elite-level bonus. Both are plain
 * multipliers combined once with the trait; null for Recruits.
 */
export function eliteModifiers(s: Pick<SoldierIdentity, 'progression' | 'classId'>): StatModifiers | null {
  const sp = specOf(s);
  if (!sp) return null;
  const lv = eliteLevelModifiers(sp.classId, s.progression!.eliteLevel);
  if (sp.id === 'med-surgeon') return { ...lv, reviveTimeMul: 1 / CFG.elite.miracleReviveSpeed };
  return lv;
}

// ---------------- combat passives (runtime) ----------------
/** Per-mission passive state of one Elite soldier (lives on the Unit; new every mission). */
export class EliteState {
  /** Successful weapon hits this mission (Deadeye / Phantom Shot counters). */
  hits = 0;
  /** Overdrive spin-up 0..1. */
  overdrive = 0;
  /** Seconds since this soldier last fired. */
  sinceShot = 99;
  /** Perfect Aim charge, seconds of stationary aim. */
  charge = 0;
  /** Times the passive triggered this mission (tests / balance): Deadeye / Phantom / Perfect Aim shots,
   *  reduced hits, completed Surgeon revives, Overdrive reaching full, teammates entering a Rally aura. */
  procs = 0;
  /** Extra damage this passive produced (Deadeye / Perfect Aim bonus; damage avoided for Adrenaline / Ironclad). */
  effect = 0;
  constructor(public spec: EliteSpecDef) {}
  get id() { return this.spec.id; }
  /** Perfect Aim charged and ready (visual indicator). */
  get ready() { return this.spec.id === 'snp-deadeye' && this.charge >= CFG.elite.perfectAimCharge; }
}

export function eliteStateFor(identity: SoldierIdentity | null): EliteState | null {
  const sp = specOf(identity);
  return sp ? new EliteState(sp) : null;
}

/**
 * Start of every simulation step: Rally auras (Field Commander). A living squad soldier inside the
 * radius of a standing Field Commander other than themself is rallied; several Commanders don't
 * stack. Skipped entirely when no Commander is deployed.
 */
export function eliteAuras(game: Game) {
  if (!game.eliteCommanders) return;
  const R = CFG.elite.rallyRadius;
  const cmd = game.soldiers.filter((s) => s.active && s.elite?.id === 'med-commander');
  for (const s of game.soldiers) {
    const by = s.active ? cmd.find((c) => c !== s && dist(c.pos, s.pos) <= R) : undefined;
    if (by && !s.rallied) by.elite!.procs++; // counts teammates entering the aura (tests / balance)
    s.rallied = !!by;
  }
}

/** After weapons, every step: Overdrive spin-up / cool-down and Perfect Aim charge. */
export function eliteTick(game: Game, dt: number) {
  if (!game.eliteCount) return;
  const E = CFG.elite;
  for (const u of game.soldiers) {
    const e = u.elite;
    if (!e) continue;
    e.sinceShot += dt;
    if (e.id === 'hvy-weapons') {
      if (!u.active) e.overdrive = 0;
      else if (e.sinceShot <= E.overdriveGrace && u.target) { const was = e.overdrive; e.overdrive = Math.min(1, e.overdrive + dt / E.overdriveBuild); if (was < 1 && e.overdrive === 1) e.procs++; }
      else if (e.sinceShot > E.overdriveGrace) e.overdrive = Math.max(0, e.overdrive - dt / E.overdriveDecay);
    } else if (e.id === 'snp-deadeye') {
      if (!u.active || u.moveFrac > E.perfectAimMoveTol) e.charge = 0;
      else if (u.target) e.charge = Math.min(E.perfectAimCharge, e.charge + dt);
    }
  }
}

/** Fire-rate addition (fraction of base) Overdrive gives right now. */
export const overdriveAdd = (u: Unit) => (u.elite?.id === 'hvy-weapons' ? CFG.elite.overdriveMax * u.elite.overdrive : 0);

/**
 * A squad soldier fires: the shot's fire-time multiplier (Rally, Perfect Aim). Consumes a full
 * Perfect Aim charge. Returns 1 for ordinary soldiers (and nothing else changes).
 */
export function onFire(u: Unit): { mul: number; charged: boolean } {
  let mul = u.rallied ? 1 + CFG.elite.rallyDamage : 1;
  let charged = false;
  const e = u.elite;
  if (e) {
    e.sinceShot = 0;
    if (e.ready) { mul *= 1 + CFG.elite.perfectAimBonus; e.charge = 0; e.procs++; charged = true; }
  }
  return { mul: Math.min(CFG.elite.maxShotMul, mul), charged };
}

/**
 * A squad soldier's round hit an enemy: advances Deadeye / Phantom Shot counters (misses never
 * reach here). Returns the extra damage multiplier for THIS hit and the armor penetration.
 */
export function onHit(u: Unit | undefined, fireMul: number): { mul: number; pen: number } {
  const e = u?.elite;
  if (!e) return { mul: 1, pen: 0 };
  const E = CFG.elite;
  if (e.id === 'inf-recon') {
    e.hits++;
    if (e.hits % Math.max(1, Math.round(E.deadeyeEvery)) === 0) {
      e.procs++;
      return { mul: Math.min(E.maxShotMul, fireMul * (1 + E.deadeyeBonus)) / fireMul, pen: 0 };
    }
  } else if (e.id === 'snp-ghost') {
    e.hits++;
    if (e.hits % Math.max(1, Math.round(E.phantomEvery)) === 0) { e.procs++; return { mul: 1, pen: E.phantomPen }; }
  }
  return { mul: 1, pen: 0 };
}

/**
 * Incoming damage multiplier for a squad soldier (Adrenaline Rush, Ironclad). Adrenaline Rush is
 * decided by the HP BEFORE the hit: the hit that takes a soldier under 35% is not reduced, every
 * hit while under it is; healing above it switches it off at once. 1 for everyone else.
 */
export function incomingMul(u: Unit): number {
  const e = u.elite;
  if (!e) return 1;
  const E = CFG.elite;
  let red = 0;
  if (e.id === 'hvy-juggernaut') red += E.ironcladReduction;
  if (e.id === 'inf-trooper' && adrenalineActive(u)) red += E.adrenalineReduction;
  return 1 - Math.min(E.maxDamageReduction, red);
}
export const adrenalineActive = (u: Unit) => u.elite?.id === 'inf-trooper' && u.active && u.hp < CFG.elite.adrenalineThreshold * u.maxHp;

/** Fraction of max HP a completed revive restores, by the reviver (Combat Surgeon: 50%). */
export const reviveHpFrac = (reviver: Unit) => (reviver.elite?.id === 'med-surgeon' ? CFG.elite.miracleHpFrac : CFG.revive.hpFrac);

/**
 * Armor after Phantom Shot penetration: a hit that would be scaled by `mul` < 1 (armor) keeps
 * only (1 - pen) of the armor: mul' = 1 - (1 - mul) x (1 - pen). Armor-free hits are unchanged.
 */
export const penetrate = (mul: number, pen: number) => (pen > 0 && mul < 1 ? 1 - (1 - mul) * (1 - pen) : mul);
