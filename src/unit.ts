// One character type for both sides. Enemy stats are CFG.enemy by reference; squad
// soldiers' stats are computed on every read (class base from CFG -> trait -> individual
// modifiers), so tuning panel changes apply live and traits never stack or mutate CFG.
import { CFG } from './config';
import type { Ability } from './abilities';
import { CLASSES, effectiveStats, type SoldierClassDef, type SoldierIdentity } from './classes';
import type { EffectiveStats } from './traits';
import type { TargetingStrategy } from './targeting';
import type { Vec } from './util';

export type Team = 'squad' | 'enemy';
export type UnitState = 'active' | 'downed' | 'kia' | 'dead';
export type StatBlock = EffectiveStats | typeof CFG.enemy;

let nextId = 1;

export class Unit {
  id = nextId++;
  pos: Vec;
  vel: Vec = { x: 0, y: 0 };
  hp: number;
  state: UnitState = 'active';
  aim = 0; // facing / aim angle, independent of movement
  target: Unit | null = null;
  fireCooldown = 0;
  reactionLeft = 0; // delay before first shot on a new target
  moveFrac = 0; // smoothed speed / max speed, drives the movement accuracy penalty
  walkPhase = Math.random() * 10;
  hitFlash = 0;
  muzzle = 0;
  rapidFire = 0; // seconds of Rapid Fire boost remaining
  healFlash = 0; // seconds of medkit glow on the overhead health bar
  // combat statistics (tests / balance reports)
  shots = 0;
  hits = 0;
  dealt = 0;

  // squad-only
  identity: SoldierIdentity | null = null;
  name = '';
  catchUp = 1; // >1 while hurrying back to its slot (squad.ts)
  speedMul = 1;
  slot: [number, number] = [0, 0];
  ability: Ability | null = null;
  bleed = 0;
  reviveProgress = 0; // fraction 0..1 (rate depends on the reviver's class)
  reviving = false;
  reviver: Unit | null = null; // who is reviving this soldier right now
  path: Vec[] | null = null;
  pathTimer = 0;
  wander = Math.random() * 100;

  // enemy-only
  advancer = false; // "advance while firing" vs "stop and shoot"
  speedRand = 1;
  reactionTime = 0.5;
  guard = false; // dormant until a soldier comes close or it gets shot
  defender = false;
  /** Wake-up radius for a dormant guard (null: CFG.enemy.aggroRadius). */
  aggro: number | null = null;
  /** Mission group tag (objectives count kills per tag). */
  tag: string | null = null;
  /**
   * Destructible objective structure (team 'enemy'): never moves or shoots, soldiers shoot it
   * only when no enemy soldier is in sight, grenades damage it. Not counted as a kill.
   */
  structure: string | null = null;

  // escort NPC (team 'squad', not a soldier: no identity, no weapon, no ability)
  npc = false;
  /** False while the captive is still held: enemies ignore it and it can't be hit. */
  escorting = false;
  label = '';
  /** Max HP override (structures, NPCs). */
  hpOverride: number | null = null;
  stuckT = 0;
  prevPos: Vec | null = null;

  constructor(public team: Team, pos: Vec, public targeting: TargetingStrategy, identity: SoldierIdentity | null = null) {
    this.pos = { x: pos.x, y: pos.y };
    this.identity = identity;
    if (identity) this.name = identity.name.toUpperCase();
    this.hp = this.stats.hp;
  }

  /** Class definition (squad soldiers only). */
  get classDef(): SoldierClassDef | null { return this.identity ? CLASSES[this.identity.classId] : null; }
  /** Live stats: the soldier's EFFECTIVE stats (class + trait + individual mods), or CFG.enemy. */
  get stats(): StatBlock { return this.identity ? effectiveStats(this.identity) : CFG.enemy; }
  /** Squad soldier's effective stats (throws for enemies). */
  get soldierStats(): EffectiveStats { return effectiveStats(this.identity!); }
  get maxHp() { return this.hpOverride ?? this.stats.hp; }
  get radius() { return this.stats.radius; }
  get maxSpeed() {
    if (this.npc) return CFG.escort.moveSpeed * this.catchUp;
    if (this.structure) return 0;
    return this.team === 'squad' ? this.stats.moveSpeed * this.speedMul * this.catchUp : CFG.enemy.moveSpeed * this.speedRand;
  }
  /** Rapid Fire pickup and Suppressive Fire do not stack: the larger multiplier applies. */
  get fireRate() {
    const pickup = this.rapidFire > 0 ? CFG.pickups.rapidFireMul : 1;
    const ability = this.ability?.fireRateMul?.() ?? 1;
    return this.stats.fireRate * Math.max(pickup, ability);
  }
  get suppressing() { return (this.ability?.fireRateMul?.() ?? 1) > 1; }

  /** Identity + current runtime status, e.g. for HUD, tests and a future roster. */
  snapshot() {
    return {
      id: this.identity?.id ?? `E${this.id}`,
      name: this.name,
      classId: this.identity?.classId ?? 'enemy',
      traitId: this.identity?.traitId ?? null,
      hp: this.hp,
      maxHp: this.maxHp,
      status: this.state === 'active' ? 'alive' : this.state,
      npc: this.npc,
      ability: this.ability?.name ?? null,
      abilityCooldown: this.ability?.cooldownLeft ?? 0,
      abilityActive: this.ability?.activeLeft ?? 0,
    };
  }
  /** Current full cone angle in degrees. */
  get cone() { return this.stats.accuracy + this.stats.movePenalty * this.moveFrac; }

  /** Can act: move, shoot, be targeted, take damage. */
  get active() { return this.state === 'active'; }
  /** Can be shot at right now (a held captive can't). */
  get targetable() { return this.state === 'active' && (!this.npc || this.escorting); }

  /** Set a fixed max HP (structures, NPCs) and fill it. */
  setMaxHp(hp: number) { this.hpOverride = hp; this.hp = hp; }
}
