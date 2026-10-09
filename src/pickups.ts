// Pickups: a type with an "on collect" effect. Medkit (+ Rapid Fire, cheap tier).
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import type { Vec } from './util';
import { sfx } from './audio';

export interface PickupType {
  readonly kind: string;
  readonly color: string;
  readonly label: string;
  /** Apply the effect. Return false to leave the pickup on the ground (e.g. nobody needs healing). */
  onCollect(game: Game, collector: Unit): boolean;
}

export interface Pickup { type: PickupType; pos: Vec; bob: number }

export const Medkit: PickupType = {
  kind: 'medkit', color: '#f4f4f4', label: '+',
  onCollect(game) {
    // Squad-wide: every standing soldier heals a fraction of their own max HP.
    // Downed soldiers are not revived and KIA soldiers get nothing.
    const living = game.soldiers.filter((s) => s.active);
    if (!living.some((s) => s.hp < s.maxHp)) return false;
    for (const s of living) {
      const before = s.hp;
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * CFG.pickups.medkitHealFrac);
      const healed = Math.round(s.hp - before);
      s.healFlash = 0.8;
      game.fx.ring(s.pos, 30, 'rgba(120,255,140,0.9)', 0.5);
      game.fx.burst({ x: s.pos.x, y: s.pos.y - 20 }, 6, '#7dff8a', 70, 0.5, 2.5);
      if (healed > 0) game.fx.text(s.pos, `+${healed}`, '#7dff8a');
    }
    return true;
  },
};

export const RapidFire: PickupType = {
  kind: 'rapidfire', color: '#ffcc33', label: '»',
  onCollect(game, collector) {
    collector.rapidFire = CFG.pickups.rapidFireDuration;
    game.fx.text(collector.pos, 'RAPID FIRE', '#ffd84a');
    game.fx.ring(collector.pos, 30, 'rgba(255,210,60,0.9)', 0.4);
    return true;
  },
};

export function updatePickups(game: Game, dt: number) {
  game.pickups = game.pickups.filter((p) => {
    p.bob += dt;
    for (const s of game.soldiers) {
      if (!s.active) continue;
      if (Math.hypot(s.pos.x - p.pos.x, s.pos.y - p.pos.y) < s.radius + 14) {
        if (p.type.onCollect(game, s)) { sfx('pickup'); return false; }
      }
    }
    return true;
  });
}
