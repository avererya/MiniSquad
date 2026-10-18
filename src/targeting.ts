// Target selection as a swappable strategy (future classes can prefer
// weakest, farthest, highest threat, etc.).
import type { Game } from './game';
import { isBoss, type Unit } from './unit';
import { dist2 } from './util';

export interface TargetingStrategy {
  /** Is `target` still a legal target for `shooter`? */
  isValid(shooter: Unit, target: Unit, game: Game): boolean;
  /** Pick the best target from `candidates`, or null. */
  select(shooter: Unit, candidates: Unit[], game: Game): Unit | null;
}

/** Nearest hostile within weapon range with clear line of sight. */
export const NearestVisible: TargetingStrategy = {
  isValid(shooter, target, game) {
    if (!target.targetable) return false;
    const r = shooter.stats.range;
    if (dist2(shooter.pos, target.pos) > r * r) return false;
    return game.world.clear(shooter.pos, target.pos);
  },
  select(shooter, candidates, game) {
    const r2 = shooter.stats.range ** 2;
    const sorted = candidates
      .filter((c) => c.targetable)
      .map((c) => ({ c, d: dist2(shooter.pos, c.pos) }))
      .filter((e) => e.d <= r2)
      .sort((a, b) => a.d - b.d);
    // v0.6.2: an escorted captive is only targeted when no guarding soldier is in view (it was a
    // distance-weighted lower priority before, which still let flankers pick it out of the ring).
    // Stray rounds can still hit them, so the captive stays vulnerable, not invincible.
    let captive: Unit | null = null;
    let structure: Unit | null = null; // objective structures (depot) only when no enemy soldier is visible
    for (const e of sorted) {
      if (!game.world.clear(shooter.pos, e.c.pos)) continue;
      if (e.c.npc) { captive ??= e.c; continue; }
      if (!e.c.structure) return e.c;
      structure ??= e.c;
    }
    return captive ?? structure;
  },
};

// ---------------------------------------------------------------------------------------
// v0.6.2 specialised targeting. All strategies keep the generic contract: a target is only
// selected / kept with a clear line of sight inside weapon range (never through walls), and
// updateWeapon keeps the current target while it stays valid, so nobody oscillates.

/** Is something solid right next to this unit (it is "in cover")? */
export function nearCover(game: Game, u: Unit, pad = 30): boolean {
  for (const o of game.world.solid) {
    if (u.pos.x > o.x - pad && u.pos.x < o.x + o.w + pad && u.pos.y > o.y - pad && u.pos.y < o.y + o.h + pad) return true;
  }
  return false;
}

/** Squad Sniper: priority by threat class, then distance. Enemy snipers > heavy targets > others > structures. */
export function sniperPriority(t: Unit): number {
  if (t.structure) return 4;
  if (t.kind === 'sniper') return 0;
  if (isBoss(t) || t.kind === 'tower' || t.kind === 'armored') return 1;
  if (t.vehicle) return 2;
  return 3;
}
export const SniperTargeting: TargetingStrategy = {
  isValid: NearestVisible.isValid,
  select(shooter, candidates, game) {
    const r2 = shooter.stats.range ** 2;
    let best: Unit | null = null, bp = 9, bd = Infinity;
    for (const c of candidates) {
      if (!c.targetable) continue;
      const d = dist2(shooter.pos, c.pos);
      if (d > r2) continue;
      const p = sniperPriority(c);
      if (p > bp || (p === bp && d >= bd)) continue;
      if (!game.world.clear(shooter.pos, c.pos)) continue;
      best = c; bp = p; bd = d;
    }
    return best;
  },
};
/**
 * The squad Sniper may drop its current target for a strictly higher-priority one, but only
 * before it has aimed for long (no switching mid-shot, no ping-pong between equals).
 */
export function sniperShouldSwitch(shooter: Unit, cur: Unit, next: Unit): boolean {
  return sniperPriority(next) < sniperPriority(cur) && shooter.aimHeld < 0.15;
}

/**
 * Enemy Sniper: prefers EXPOSED soldiers (no solid cover within ~30 px) with a clear lane; a
 * soldier hugging cover is picked only when nobody is exposed. Never the held captive.
 */
export const ExposedTargeting: TargetingStrategy = {
  isValid: NearestVisible.isValid,
  select(shooter, candidates, game) {
    const r2 = shooter.stats.range ** 2;
    let best: Unit | null = null, bs = Infinity;
    for (const c of candidates) {
      if (!c.targetable) continue;
      const d = dist2(shooter.pos, c.pos);
      if (d > r2 || !game.world.clear(shooter.pos, c.pos)) continue;
      const score = Math.sqrt(d) + (nearCover(game, c) ? 400 : 0) + (c.npc ? 600 : 0);
      if (score < bs) { bs = score; best = c; }
    }
    return best;
  },
};

/** Convoy escort: soldiers who are shooting at a truck are the first to be punished. */
export const EscortTargeting: TargetingStrategy = {
  isValid: NearestVisible.isValid,
  select(shooter, candidates, game) {
    const r2 = shooter.stats.range ** 2;
    let best: Unit | null = null, bs = Infinity;
    for (const c of candidates) {
      if (!c.targetable) continue;
      const d = dist2(shooter.pos, c.pos);
      if (d > r2 || !game.world.clear(shooter.pos, c.pos)) continue;
      const score = d * (c.target?.vehicle ? 0.45 : 1) * (c.npc ? 2.5 : 1);
      if (score < bs) { bs = score; best = c; }
    }
    return best;
  },
};

/**
 * v0.8B attackers that go for a mission asset: a friendly asset of `kind` (the escort truck, the command center)
 * counts as `k` times closer than it is (distance-weighted, line of sight and range as always), else the nearest.
 */
export function assetHunter(kind: 'truck' | 'command', k: number, assetReach = 1): TargetingStrategy {
  return {
    isValid: NearestVisible.isValid,
    select(shooter, candidates, game) {
      const r2 = shooter.stats.range ** 2;
      let best: Unit | null = null, bs = Infinity;
      for (const c of candidates) {
        if (!c.targetable) continue;
        const d = dist2(shooter.pos, c.pos);
        if (d > r2 || !game.world.clear(shooter.pos, c.pos)) continue;
        if (c.asset === kind && d > r2 * assetReach * assetReach) continue; // v0.8B.1: assets only inside assetReach x range
        const score = d * (c.asset === kind ? k * k : 1);
        if (score < bs) { bs = score; best = c; }
      }
      return best;
    },
  };
}
/** Ambush hunters (Mission 14): prefer the escort truck. */
export const VehicleHunterTargeting = assetHunter('truck', 0.6);
/**
 * v0.8B.1 Mission 14 Ambushes 4-5 roadblock troopers: they hold the road against the ESCORT, so a soldier in sight
 * comes first; the truck counts as 3 x farther than it is, and they only open up on it inside half their range
 * (they close in on it, into the squad's guns, instead of plinking it from the ridge while it waits for the squad).
 */
export const RoadblockTargeting = assetHunter('truck', 3, 0.5);
/** Siege attackers (Mission 13 waves): prefer the command center. */
export const SiegeTargeting = assetHunter('command', 0.5); // v0.8B.1: 0.35 -> 0.5 (a soldier at half the distance is shot first)
