// One character type for both sides. Enemy stats are CFG.enemy by reference; squad
// soldiers' stats are computed on every read (class base from CFG -> trait -> individual
// modifiers), so tuning panel changes apply live and traits never stack or mutate CFG.
import { CFG } from './config';
import type { Ability } from './abilities';
import { CLASSES, effectiveStats, type SoldierClassDef, type SoldierIdentity } from './classes';
import type { EffectiveStats } from './traits';
import type { TargetingStrategy } from './targeting';
import type { Vec } from './util';
import { eliteStateFor, overdriveAdd, type EliteState } from './elite';
import type { AlertState } from './awareness';

export type Team = 'squad' | 'enemy';
export type UnitState = 'active' | 'downed' | 'kia' | 'dead';
/** v0.6.2 enemy kinds; each reads its own CFG group (missing behaviour = rifleman). */
export type EnemyKind = 'rifleman' | 'sniper' | 'armored' | 'tower' | 'boss' | 'truck';
type EnemyStats = typeof CFG.enemy;
export type StatBlock = EffectiveStats | EnemyStats;
const KIND_CFG: Record<EnemyKind, () => EnemyStats> = {
  rifleman: () => CFG.enemy,
  sniper: () => CFG.enemySniper,
  armored: () => CFG.armored,
  tower: () => CFG.tower,
  boss: () => CFG.boss,
  truck: () => CFG.truck,
};

let nextId = 1;

/** v0.6.3: bumped at the start of every simulation step (Game.update): soldier stat caches expire. */
let statEpoch = 0;
export function nextStatEpoch() { statEpoch++; }

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
  /** v0.6: how this soldier became KIA ('bleedout' / 'abandoned'), null while alive. */
  kiaCause: 'bleedout' | 'abandoned' | 'failed' | null = null;
  /** v0.7A: Elite specialization passive state (null for Recruits, generics, enemies). New every mission. */
  elite: EliteState | null = null;
  /** v0.7A: inside a standing Field Commander's Rally aura this step (elite.eliteAuras). */
  rallied = false;
  path: Vec[] | null = null;
  pathTimer = 0;
  wander = Math.random() * 100;

  // enemy-only
  /** v0.6.2: enemy type (stats + behaviour). */
  kind: EnemyKind = 'rifleman';
  /** Never moves (watchtower guard, objective structures); pushes movers out like a structure. */
  fixed = false;
  /** v0.6.2 convoy: a moving destructible vehicle (normal-priority target, never shoots). */
  vehicle = false;
  /** Convoy escort: walks with this truck until soldiers come close. */
  escortOf: Unit | null = null;
  escortOffset: Vec = { x: 0, y: 0 };
  /**
   * v0.6.2 held aim (enemy Sniper telegraph / squad Sniper aim cue): seconds the aim has been held
   * on the current target; `lockAim` is the frozen firing direction once the enemy sniper locks.
   */
  aimHeld = 0;
  lockAim: number | null = null;
  /** v0.6.2: after the boss falls the survivors rout: no shooting, they flee and leave. */
  routed = false;
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
   * v0.8A enemy group awareness (awareness.ts): null = never alerted. Placed guards are managed by it once
   * woken (they investigate and search instead of homing in on the squad); scripted waves are not.
   */
  alert: AlertState | null = null;
  /** v0.8A: spawned by extraction pressure (finite, never required kills). */
  reinforcement = false;
  /**
   * Destructible objective structure (team 'enemy'): never moves or shoots, soldiers shoot it
   * only when no enemy soldier is in sight, grenades damage it. Not counted as a kill.
   */
  structure: string | null = null;
  /**
   * v0.7C: a mission-critical unit the squad must deal with itself (objective structures and convoy
   * trucks set it; any future objective unit can). Tactical support never takes it below
   * CFG.support.objectiveFloor HP. Structures and vehicles always count (protectedObjective).
   */
  objective = false;

  // v0.8A Commando: the second pistol (independent target and cooldown; see combat.updateOffhand)
  offhand: { target: Unit | null; cooldown: number; reaction: number; aim: number; muzzle: number } | null = null;

  // v0.8A resistance ally (team 'squad', not a soldier: no identity, no XP; has a rifle, can be downed / revived)
  ally = false;
  /** Ally: where to hold during a defence (null = follow the squad). */
  post: Vec | null = null;

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
    if (identity) { this.name = identity.name.toUpperCase(); this.elite = eliteStateFor(identity); }
    this.hp = this.stats.hp;
  }

  /** Class definition (squad soldiers only). */
  get classDef(): SoldierClassDef | null { return this.identity ? CLASSES[this.identity.classId] : null; }
  /** Live stats: the soldier's EFFECTIVE stats (class + trait + individual mods), or CFG.enemy. */
  get stats(): StatBlock { return this.identity ? this.soldierStats : this.team === 'enemy' ? KIND_CFG[this.kind]() : this.ally ? (CFG.resistance as EffectiveStats) : CFG.enemy; }
  /**
   * Squad soldier's effective stats (throws for enemies). v0.6.3: computed once per simulation
   * step (statEpoch) instead of on every read (radius / fireRate / cone are read many times a
   * step); still live, so tuning-panel changes apply from the next step.
   */
  get soldierStats(): EffectiveStats {
    if (this.statCache === null || this.statCacheEpoch !== statEpoch || this.statCacheId !== this.identity) {
      this.statCache = effectiveStats(this.identity!);
      this.statCacheEpoch = statEpoch; this.statCacheId = this.identity;
    }
    return this.statCache;
  }
  private statCache: EffectiveStats | null = null;
  private statCacheEpoch = -1;
  private statCacheId: SoldierIdentity | null = null;
  get maxHp() { return this.hpOverride ?? this.stats.hp; }
  get radius() { return this.stats.radius; }
  get maxSpeed() {
    if (this.npc) return CFG.escort.moveSpeed * this.catchUp;
    if (this.ally) return CFG.resistance.moveSpeed * this.catchUp;
    if (this.structure || this.fixed) return 0;
    return this.team === 'squad' ? this.stats.moveSpeed * this.speedMul * this.rallyMul * this.catchUp : this.stats.moveSpeed * this.speedRand;
  }
  /** v0.7A Rally: move-speed multiplier while inside a Field Commander's aura (1 otherwise). */
  get rallyMul() { return this.rallied ? 1 + CFG.elite.rallySpeed : 1;
  }
  /**
   * Rapid Fire pickup and Suppressive Fire do not stack: the larger multiplier applies. v0.7A
   * Overdrive (Weapons Specialist) ADDS up to +25% of base on top of that (never multiplies).
   */
  get fireRate() {
    const pickup = this.rapidFire > 0 ? CFG.pickups.rapidFireMul : 1;
    const ability = this.ability?.fireRateMul?.() ?? 1;
    return this.stats.fireRate * (Math.max(pickup, ability) + (this.elite ? overdriveAdd(this) : 0));
  }
  get suppressing() { return this.ability?.id === 'suppressive' && (this.ability.fireRateMul?.() ?? 1) > 1; }
  /** Sniper Focus running. */
  get focusing() { return this.ability?.id === 'focus' && this.ability.activeLeft > 0; }

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
  /** Current full cone angle in degrees. v0.8A: Bullet Storm cuts the moving part (x1 for everyone else). */
  get cone() {
    const k = this.ability?.movePenaltyMul?.() ?? 1;
    return this.stats.accuracy + (k === 1 ? this.stats.movePenalty * this.moveFrac : this.stats.movePenalty * k * this.moveFrac);
  }

  /** Can act: move, shoot, be targeted, take damage. */
  get active() { return this.state === 'active'; }
  /** Can be shot at right now (a held captive can't). */
  get targetable() { return this.state === 'active' && (!this.npc || this.escorting); }

  /** v0.7C: protected from being destroyed by tactical support (see `objective`). */
  get protectedObjective() { return this.objective || !!this.structure || this.vehicle; }

  /** Set a fixed max HP (structures, NPCs) and fill it. */
  setMaxHp(hp: number) { this.hpOverride = hp; this.hp = hp; }
}
