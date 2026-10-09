// Target selection as a swappable strategy (future classes can prefer
// weakest, farthest, highest threat, etc.).
import type { Game } from './game';
import type { Unit } from './unit';
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
      // an escorted captive is a lower-priority target than the soldiers guarding them (v0.4)
      .map((e) => (e.c.npc ? { c: e.c, d: e.d * 2.5 } : e))
      .sort((a, b) => a.d - b.d);
    let structure: Unit | null = null; // objective structures (depot) only when no enemy soldier is visible
    for (const e of sorted) {
      if (!game.world.clear(shooter.pos, e.c.pos)) continue;
      if (!e.c.structure) return e.c;
      structure ??= e.c;
    }
    return structure;
  },
};
