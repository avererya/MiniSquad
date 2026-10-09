// Abilities as a small interface: cooldown, targeting mode, execute.
// 'ground' abilities (Grenade) enter targeting mode and execute on a ground tap.
// 'instant' abilities (Suppressive Fire, Field Treatment) execute on one button press.
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import { explode } from './combat';
import { dist, type Vec } from './util';
import { sfx } from './audio';

export type TargetingMode = 'ground' | 'instant';

export interface Ability {
  readonly id: string;
  readonly name: string;
  readonly icon: string; // short glyph for the HUD button
  readonly targetingMode: TargetingMode;
  cooldownLeft: number;
  /** Seconds the ability's effect is still running (0 for one-shot abilities). */
  activeLeft: number;
  cooldown(): number;
  /** Max throw/cast range (for 'ground' targeting). */
  range(): number;
  /** Radius of the area preview shown at the cursor. */
  previewRadius(): number;
  ready(owner: Unit): boolean;
  /** Why it can't be used right now (null = usable). Shown to the player. */
  blockReason(game: Game, owner: Unit): string | null;
  execute(game: Game, owner: Unit, target: Vec): void;
  /** Per-step upkeep for running effects (cooldown ticking is done by the game). */
  tick(game: Game, owner: Unit, dt: number): void;
  /** Optional fire-rate multiplier the ability currently grants its owner. */
  fireRateMul?(): number;
}

abstract class BaseAbility {
  cooldownLeft = 0;
  activeLeft = 0;
  range() { return 0; }
  previewRadius() { return 0; }
  ready(owner: Unit) { return owner.active && this.cooldownLeft <= 0 && this.activeLeft <= 0; }
  blockReason(_game: Game, owner: Unit): string | null {
    if (!owner.active) return owner.state === 'downed' ? 'DOWNED' : 'KIA';
    if (this.activeLeft > 0) return 'ALREADY ACTIVE';
    if (this.cooldownLeft > 0) return `RECHARGING ${Math.ceil(this.cooldownLeft)}s`;
    return null;
  }
  tick(_game: Game, _owner: Unit, _dt: number) {}
}

/** Heavy Gunner: own fire rate x1.75 for 5 s. Accuracy, damage, targeting unchanged. */
export class SuppressiveFireAbility extends BaseAbility implements Ability {
  readonly id = 'suppressive';
  readonly name = 'Suppressive Fire';
  readonly icon = '≫';
  readonly targetingMode = 'instant' as const;
  cooldown() { return CFG.suppressive.cooldown; }
  execute(game: Game, owner: Unit) {
    if (this.blockReason(game, owner)) return;
    this.activeLeft = CFG.suppressive.duration;
    this.cooldownLeft = this.cooldown(); // cooldown starts on activation
    game.fx.text(owner.pos, 'SUPPRESSING!', '#ffb347');
    game.fx.ring(owner.pos, 34, 'rgba(255,170,60,0.95)', 0.35, 4);
    sfx('suppress');
  }
  tick(_game: Game, owner: Unit, dt: number) {
    if (!owner.active) this.activeLeft = 0; // ends if the gunner goes down
    this.activeLeft = Math.max(0, this.activeLeft - dt);
  }
  /** Fire-rate multiplier this ability currently gives its owner. */
  fireRateMul() { return this.activeLeft > 0 ? CFG.suppressive.fireRateMul : 1; }
}

/**
 * Medic: instant heal of healFrac x (the Medic's healMul: Healer trait 1.1) x max HP for every standing squad soldier within
 * radius of the Medic (Medic included). Capped at max HP. Never revives downed
 * soldiers, does nothing for KIA. Refuses (no cooldown spent) if nobody in range is hurt.
 */
export class FieldTreatmentAbility extends BaseAbility implements Ability {
  readonly id = 'fieldTreatment';
  readonly name = 'Field Treatment';
  readonly icon = '✚';
  readonly targetingMode = 'instant' as const;
  cooldown() { return CFG.fieldTreatment.cooldown; }
  previewRadius() { return CFG.fieldTreatment.radius; }
  /** Fraction of each target's max HP this Medic heals (Healer: 0.25 x 1.1 = 0.275). */
  healFrac(owner: Unit) { return CFG.fieldTreatment.healFrac * ((owner.stats as { healMul?: number }).healMul ?? 1); }
  /** Standing soldiers inside the heal radius. */
  affected(game: Game, owner: Unit) {
    const r = CFG.fieldTreatment.radius;
    return game.soldiers.filter((s) => s.active && dist(s.pos, owner.pos) <= r);
  }
  blockReason(game: Game, owner: Unit): string | null {
    const base = super.blockReason(game, owner);
    if (base) return base;
    if (!this.affected(game, owner).some((s) => s.hp < s.maxHp)) return 'NOBODY HURT IN RANGE';
    return null;
  }
  execute(game: Game, owner: Unit) {
    if (this.blockReason(game, owner)) return;
    const F = CFG.fieldTreatment;
    const frac = this.healFrac(owner);
    for (const s of this.affected(game, owner)) {
      const before = s.hp;
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * frac);
      game.stats.heal(owner, s.hp - before); // actual HP restored, no overheal
      const healed = Math.round(s.hp - before);
      s.healFlash = 0.8;
      game.fx.burst({ x: s.pos.x, y: s.pos.y - 20 }, 8, '#7dff8a', 70, 0.5, 2.5);
      game.fx.text(s.pos, healed > 0 ? `+${healed}` : 'FULL', '#7dff8a');
    }
    game.fx.pulses.push({ pos: { ...owner.pos }, r: F.radius, life: 0.6, maxLife: 0.6 });
    this.cooldownLeft = this.cooldown();
    sfx('heal');
  }
}

export interface Grenade {
  from: Vec;
  to: Vec;
  t: number; // flight progress time
  flight: number;
  fuse: number; // remaining after landing
  landed: boolean;
  owner?: Unit; // thrower: gets the damage + kills
}

/** Infantry: thrown grenade (unchanged since v0.1 apart from where its cooldown lives). */
export class GrenadeAbility extends BaseAbility implements Ability {
  readonly id = 'grenade';
  readonly name = 'Grenade';
  readonly icon = '●';
  readonly targetingMode = 'ground' as const;
  cooldown() { return CFG.grenade.cooldown; }
  range() { return CFG.grenade.range; }
  previewRadius() { return CFG.grenade.radius; }
  execute(game: Game, owner: Unit, target: Vec) {
    const d = dist(owner.pos, target);
    const r = this.range();
    const to = d > r
      ? { x: owner.pos.x + ((target.x - owner.pos.x) / d) * r, y: owner.pos.y + ((target.y - owner.pos.y) / d) * r }
      : { ...target };
    game.grenades.push({ from: { ...owner.pos }, to, t: 0, flight: CFG.grenade.flightTime, fuse: CFG.grenade.fuse, landed: false, owner });
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
        explode(game, g.to, G.radius, G.damage, G.edgeDamageFrac, game.enemies, g.owner);
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
