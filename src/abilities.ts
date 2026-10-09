// Abilities as a small interface: cooldown, targeting mode, execute.
// Only Grenade exists for now.
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import { explode } from './combat';
import { dist, type Vec } from './util';
import { sfx } from './audio';

export type TargetingMode = 'ground' | 'instant';

export interface Ability {
  readonly name: string;
  readonly targetingMode: TargetingMode;
  cooldownLeft: number;
  cooldown(): number;
  /** Max throw/cast range (for 'ground' targeting). */
  range(): number;
  /** Radius of the area preview shown at the cursor. */
  previewRadius(): number;
  ready(owner: Unit): boolean;
  execute(game: Game, owner: Unit, target: Vec): void;
}

export interface Grenade {
  from: Vec;
  to: Vec;
  t: number; // flight progress time
  flight: number;
  fuse: number; // remaining after landing
  landed: boolean;
}

export class GrenadeAbility implements Ability {
  readonly name = 'Grenade';
  readonly targetingMode = 'ground' as const;
  cooldownLeft = 0;
  cooldown() { return CFG.infantry.abilityCooldown; }
  range() { return CFG.grenade.range; }
  previewRadius() { return CFG.grenade.radius; }
  ready(owner: Unit) { return owner.active && this.cooldownLeft <= 0; }
  execute(game: Game, owner: Unit, target: Vec) {
    const d = dist(owner.pos, target);
    const r = this.range();
    const to = d > r
      ? { x: owner.pos.x + ((target.x - owner.pos.x) / d) * r, y: owner.pos.y + ((target.y - owner.pos.y) / d) * r }
      : { ...target };
    game.grenades.push({ from: { ...owner.pos }, to, t: 0, flight: CFG.grenade.flightTime, fuse: CFG.grenade.fuse, landed: false });
    this.cooldownLeft = this.cooldown();
    sfx('throw');
  }
}

export function updateGrenades(game: Game, dt: number) {
  for (const g of game.grenades) {
    if (!g.landed) {
      g.t += dt;
      if (g.t >= g.flight) { g.landed = true; g.t = g.flight; }
    } else {
      g.fuse -= dt;
      if (g.fuse <= 0) {
        const G = CFG.grenade;
        explode(game, g.to, G.radius, G.damage, G.edgeDamageFrac, game.enemies);
      }
    }
  }
  game.grenades = game.grenades.filter((g) => !g.landed || g.fuse > 0);
}

/** Current drawn position of a grenade (ground pos + height). */
export function grenadePos(g: Grenade): { x: number; y: number; z: number } {
  const k = g.t / g.flight;
  return {
    x: g.from.x + (g.to.x - g.from.x) * k,
    y: g.from.y + (g.to.y - g.from.y) * k,
    z: 4 * CFG.grenade.arcHeight * k * (1 - k),
  };
}
