// Natural traits: one per roster soldier, stored by id only (never as modified numbers).
//
// EFFECTIVE STATS are always COMPUTED, never written back (full pipeline: progression.ts):
//     class base (CFG[class], live, edited by the tuning panel)
//   + level growth + individual training + squad training (additive % of class base, v0.3)
//   x trait modifiers (this registry)
//   x legacy individual multipliers (SoldierIdentity.mods; empty, kept for dev/tests)
// Because nothing is mutated, a trait can't stack on restart, redeploy or reload, and
// changing one soldier's individual modifiers never touches another soldier of his class.
//
// Interactions (decided for v0.2.2):
//  - fireRateMul scales the soldier's BASE fire rate. Suppressive Fire / Rapid Fire multiply
//    on top of the effective rate (Havoc: 7 -> 7.35/s, suppressing 7.35 x 1.75 = 12.8625/s).
//  - spreadMul scales the WHOLE cone: the still cone and the moving penalty, so the moving
//    cone shrinks by the same 10% (Ace: 12 -> 10.8 deg still, 30 -> 27 deg at full speed).
//  - healMul scales Field Treatment only (25% -> 27.5% of each target's max HP), not medkits.
//  - reviveTimeMul scales the time THIS soldier needs to revive someone (as the reviver).
import type { SoldierStats } from './config';

/** Multiplicative modifiers. A missing key means x1. */
export interface StatModifiers {
  hpMul?: number;
  damageMul?: number;
  fireRateMul?: number;
  spreadMul?: number;
  moveSpeedMul?: number;
  reviveTimeMul?: number;
  healMul?: number;
}
export const MODIFIER_KEYS = ['hpMul', 'damageMul', 'fireRateMul', 'spreadMul', 'moveSpeedMul', 'reviveTimeMul', 'healMul'] as const;

export type TraitId = 'sharpshooter' | 'quickReflexes' | 'tough' | 'triggerHappy' | 'firstResponder' | 'healer';

export interface TraitDef {
  id: TraitId;
  name: string;
  /** One-line description for the Barracks card. */
  desc: string;
  mods: StatModifiers;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  sharpshooter: { id: 'sharpshooter', name: 'Sharpshooter', desc: '-10% weapon spread, standing and moving', mods: { spreadMul: 0.9 } },
  quickReflexes: { id: 'quickReflexes', name: 'Quick Reflexes', desc: '+5% movement speed', mods: { moveSpeedMul: 1.05 } },
  tough: { id: 'tough', name: 'Tough', desc: '+10% max health', mods: { hpMul: 1.1 } },
  triggerHappy: { id: 'triggerHappy', name: 'Trigger Happy', desc: '+5% normal fire rate', mods: { fireRateMul: 1.05 } },
  firstResponder: { id: 'firstResponder', name: 'First Responder', desc: '-10% time to revive a squadmate', mods: { reviveTimeMul: 0.9 } },
  healer: { id: 'healer', name: 'Healer', desc: '+10% Field Treatment healing', mods: { healMul: 1.1 } },
};
export const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

/** Effective soldier stats: the class stat block plus multipliers that live outside it. */
export type EffectiveStats = SoldierStats & { healMul: number };

/** Product of several modifier sets (all multiplicative, so order does not matter). */
export function combineModifiers(...sets: (StatModifiers | null | undefined)[]): Required<StatModifiers> {
  const out = { hpMul: 1, damageMul: 1, fireRateMul: 1, spreadMul: 1, moveSpeedMul: 1, reviveTimeMul: 1, healMul: 1 };
  for (const s of sets) if (s) for (const k of MODIFIER_KEYS) if (typeof s[k] === 'number') out[k] *= s[k]!;
  return out;
}

// strips float noise (150 x 1.1 = 165.00000000000003) without hiding real tuning values
const clean = (v: number) => Math.round(v * 1e6) / 1e6;

/** Returns a NEW stat block; `base` (a live CFG group) is never modified. */
export function applyModifiers(base: SoldierStats, m: Required<StatModifiers>): EffectiveStats {
  return {
    ...base,
    hp: clean(base.hp * m.hpMul),
    damage: clean(base.damage * m.damageMul),
    fireRate: clean(base.fireRate * m.fireRateMul),
    accuracy: clean(base.accuracy * m.spreadMul),
    movePenalty: clean(base.movePenalty * m.spreadMul),
    moveSpeed: clean(base.moveSpeed * m.moveSpeedMul),
    reviveTime: clean(base.reviveTime * m.reviveTimeMul),
    healMul: clean(m.healMul),
  };
}
