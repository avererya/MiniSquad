// One character type for both sides. Stats come from CFG by reference, so
// tuning panel changes apply live.
import { CFG } from './config';
import type { Ability } from './abilities';
import type { TargetingStrategy } from './targeting';
import type { Vec } from './util';

export type Team = 'squad' | 'enemy';
export type UnitState = 'active' | 'downed' | 'kia' | 'dead';
export type StatBlock = typeof CFG.infantry | typeof CFG.enemy;

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

  // squad-only
  name = '';
  speedMul = 1;
  slot: [number, number] = [0, 0];
  ability: Ability | null = null;
  bleed = 0;
  reviveProgress = 0;
  reviving = false;
  path: Vec[] | null = null;
  pathTimer = 0;
  wander = Math.random() * 100;

  // enemy-only
  advancer = false; // "advance while firing" vs "stop and shoot"
  speedRand = 1;
  reactionTime = 0.5;
  guard = false; // dormant until a soldier comes close or it gets shot
  defender = false;

  constructor(public team: Team, pos: Vec, public targeting: TargetingStrategy) {
    this.pos = { x: pos.x, y: pos.y };
    this.hp = this.stats.hp;
  }

  get stats(): StatBlock { return this.team === 'squad' ? CFG.infantry : CFG.enemy; }
  get maxHp() { return this.stats.hp; }
  get radius() { return this.stats.radius; }
  get maxSpeed() {
    return this.team === 'squad' ? CFG.infantry.moveSpeed * this.speedMul : CFG.enemy.moveSpeed * this.speedRand;
  }
  get fireRate() { return this.stats.fireRate * (this.rapidFire > 0 ? CFG.pickups.rapidFireMul : 1); }
  /** Current full cone angle in degrees. */
  get cone() { return this.stats.accuracy + this.stats.movePenalty * this.moveFrac; }

  /** Can act: move, shoot, be targeted, take damage. */
  get active() { return this.state === 'active'; }
}
