// ALL gameplay numbers live here. The tuning panel edits CFG live;
// "Reset" copies DEFAULTS back in place, "Export" dumps CFG as JSON.
// Units: pixels, seconds, degrees (for cone angles), HP points.

export interface RosterEntry {
  name: string;
  speedMul: number; // per-soldier speed multiplier on top of the class move speed
  offset: [number, number]; // preferred offset around the squad anchor, in slot-spacing units
}

/**
 * Per-class soldier stats (one group per class in CFG: infantry, heavy, medic).
 *
 * SPREAD CONVENTION (unchanged since v0.1): `accuracy` is the FULL cone width in
 * degrees while standing still; each shot's direction is drawn uniformly from
 * [-accuracy/2, +accuracy/2] around the aim. `movePenalty` is extra full-cone
 * width added at full move speed (scaled by actual speed), so the cone while
 * moving at full speed is `accuracy + movePenalty` (the "moving total").
 *
 * MOVE SPEED: absolute px/s. 100% = 150 px/s (the v0.1 Infantry speed).
 */
function soldierClassStats(o: {
  hp: number; damage: number; fireRate: number; accuracy: number; movePenalty: number;
  moveSpeed: number; projectileSpeed: number; reviveTime: number;
}) {
  return {
    hp: o.hp,
    damage: o.damage,
    accuracy: o.accuracy, // full cone angle (deg) when standing still
    movePenalty: o.movePenalty, // extra full-cone angle (deg) at full move speed
    fireRate: o.fireRate, // shots per second
    range: 420, // viewport is 1280 wide; keep < 640
    moveSpeed: o.moveSpeed, // px/s
    projectileSpeed: o.projectileSpeed, // px/s, independent of enemy.projectileSpeed
    reviveTime: o.reviveTime, // s for THIS soldier to revive a downed squadmate
    turnRate: 14, // aim turn speed, rad/s
    aimTolerance: 12, // deg: fires only when aim is within this of the target
    radius: 12, // collision radius (visual bulk is separate)
  };
}
export type SoldierStats = ReturnType<typeof soldierClassStats>;

function makeDefaults() {
  return {
    // v0.1.2 Infantry: fireRate 4, accuracy 7, movePenalty 18 (25 moving), projectileSpeed 950.
    infantry: soldierClassStats({ hp: 100, damage: 10, fireRate: 3, accuracy: 12, movePenalty: 18, moveSpeed: 150, projectileSpeed: 700, reviveTime: 10 }),
    heavy: soldierClassStats({ hp: 150, damage: 6, fireRate: 7, accuracy: 15, movePenalty: 25, moveSpeed: 120, projectileSpeed: 700, reviveTime: 12 }),
    medic: soldierClassStats({ hp: 80, damage: 7, fireRate: 2.5, accuracy: 10, movePenalty: 18, moveSpeed: 157.5, projectileSpeed: 700, reviveTime: 5 }),
    enemy: {
      hp: 40,
      damage: 7,
      accuracy: 9, // full cone (deg), same convention as the soldier classes
      movePenalty: 16,
      fireRate: 1.4,
      range: 380, // must stay <= every soldier class range (never fires from off screen)
      moveSpeed: 95,
      projectileSpeed: 390, // px/s; slow enough to sidestep (v0.1: 600)
      turnRate: 6,
      aimTolerance: 15,
      radius: 12,
      speedVariance: 0.15, // +/- fraction
      reactionMin: 0.3, // s from acquiring a target to first shot
      reactionMax: 0.8,
      advanceChance: 0.5, // chance a rifleman is "advance while firing" instead of "stop and shoot"
      advanceMinDist: 0.45, // advancers stop closing in at this fraction of range
      aggroRadius: 600, // guards (outpost defenders) wake up when a soldier is this close
    },
    squad: {
      startSize: 2, // used by the legacy "N Infantry" restart; presets set the class mix
      slotSpacing: 44, // px per offset unit
      spreadMoving: 1.3, // offset scale while moving
      spreadIdle: 0.8, // offset scale when stopped
      looseness: 0.5, // 0 = tight/stiff, 1 = lazy/wandering
      followAccel: 1500, // px/s^2 steering acceleration
      separationRadius: 38,
      separationStrength: 700,
      leash: 110, // anchor can't get further than this from the squad centre
      anchorSpeedFactor: 0.92, // anchor speed relative to the reference squad speed below
      anchorSpeedBlend: 1, // reference speed: 0 = slowest soldier (v0.1 behaviour), 1 = squad average
      catchUpDist: 70, // px behind its slot before a soldier starts to hurry
      catchUpRange: 120, // px over which the hurry ramps to the full boost
      catchUpBoost: 0.25, // max extra speed fraction while catching up (0 = off)
      maxSize: 6,
      roster: [
        { name: 'ROOK', speedMul: 1.0, offset: [0.35, -0.8] },
        { name: 'DUKE', speedMul: 0.96, offset: [-0.45, 0.8] },
        { name: 'MAX', speedMul: 1.04, offset: [-1.1, -0.35] },
        { name: 'JINX', speedMul: 1.0, offset: [-1.5, 0] },
        { name: 'BEAR', speedMul: 0.95, offset: [0.3, -1.3] },
        { name: 'ACE', speedMul: 1.05, offset: [0.3, 1.3] },
      ] as RosterEntry[],
    },
    grenade: {
      cooldown: 8, // s (was infantry.abilityCooldown in v0.1.x)
      range: 300,
      radius: 95,
      damage: 90, // at centre
      edgeDamageFrac: 0.4, // fraction of damage at the blast edge
      flightTime: 0.65,
      fuse: 0.35, // after landing
      arcHeight: 70,
      shake: 12,
    },
    suppressive: {
      duration: 5, // s
      cooldown: 20, // s, starts on activation
      fireRateMul: 1.75, // only the activating Heavy Gunner; does not stack with Rapid Fire (the larger applies)
    },
    fieldTreatment: {
      healFrac: 0.25, // fraction of each healed soldier's own max HP
      radius: 140, // world px around the Medic (Medic included)
      cooldown: 25, // s
    },
    revive: {
      radius: 55,
      // revive duration is per class now: infantry/heavy/medic.reviveTime
      bleedOut: 30,
      hpFrac: 0.4,
    },
    pickups: {
      medkitHealFrac: 0.2, // each living, standing soldier heals this fraction of max HP
      rapidFireMul: 1.8,
      rapidFireDuration: 8,
    },
    mission: {
      outpostHold: 5,
      extractionCountdown: 20,
      wave1Size: 4,
      wave2Size: 6,
      wave3Size: 5,
      defenders: 5,
      finalWaveSize: 8,
      heliArriveTime: 3.5, // helicopter starts its approach this long before the countdown ends
    },
    feel: {
      cameraSmoothing: 6, // higher = snappier
      hitFlash: 0.1,
      muzzleFlash: 0.05,
      shakeDecay: 30, // px/s
      showCones: 1, // 1 = draw accuracy cones for squad soldiers
    },
  };
}

export type Config = ReturnType<typeof makeDefaults>;
export const DEFAULTS: Config = makeDefaults();
export const CFG: Config = makeDefaults();

export function resetConfig() {
  const fresh = makeDefaults() as any;
  for (const k of Object.keys(fresh)) Object.assign((CFG as any)[k], fresh[k]);
}

/**
 * Deprecated keys from older exports, mapped to their v0.2.1 home. Applied before
 * the normal merge, and only when the new key is not also present in the JSON.
 *  - infantry.abilityCooldown (v0.1.x)  -> grenade.cooldown
 *  - revive.time (v0.1.x, global)       -> infantry.reviveTime (Heavy/Medic keep their defaults)
 * Any other unknown key is ignored; any key missing from the JSON keeps its current value.
 */
const DEPRECATED: [from: string, to: string][] = [
  ['infantry.abilityCooldown', 'grenade.cooldown'],
  ['revive.time', 'infantry.reviveTime'],
];

export function applyConfigJSON(json: string): string[] {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object') throw new Error('expected a JSON object');
  const notes: string[] = [];
  for (const [from, to] of DEPRECATED) {
    const [fg, fk] = from.split('.'), [tg, tk] = to.split('.');
    const v = data[fg]?.[fk];
    if (typeof v !== 'number') continue;
    if (typeof data[tg]?.[tk] === 'number') { notes.push(`ignored deprecated ${from}`); continue; }
    (CFG as any)[tg][tk] = v;
    notes.push(`mapped deprecated ${from} -> ${to}`);
  }
  for (const group of Object.keys(data)) {
    const target = (CFG as any)[group];
    if (!target || typeof data[group] !== 'object' || data[group] === null) continue;
    for (const key of Object.keys(data[group])) {
      if (!(key in target)) continue;
      // only accept values of the same type as the default (guards against garbage in old files)
      if (typeof target[key] === typeof data[group][key]) target[key] = data[group][key];
    }
  }
  return notes;
}

export function getPath(path: string): number {
  const [g, k] = path.split('.');
  return (CFG as any)[g][k];
}
export function setPath(path: string, v: number) {
  const [g, k] = path.split('.');
  (CFG as any)[g][k] = v;
}
