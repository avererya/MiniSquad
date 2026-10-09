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
  onCollect(game, collector) {
    let who: Unit | null = collector.hp < collector.maxHp ? collector : null;
    if (!who) {
      // most injured active squadmate
      for (const s of game.soldiers) {
        if (s.active && s.hp < s.maxHp && (!who || s.hp / s.maxHp < who.hp / who.maxHp)) who = s;
      }
    }
    if (!who) return false;
    const before = who.hp;
    who.hp = Math.min(who.maxHp, who.hp + CFG.pickups.medkitHeal);
    game.fx.text(who.pos, `+${Math.round(who.hp - before)}`, '#7dff8a');
    game.fx.ring(who.pos, 30, 'rgba(120,255,140,0.9)', 0.4);
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
