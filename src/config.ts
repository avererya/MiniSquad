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
  moveSpeed: number; projectileSpeed: number; reviveTime: number; range?: number; aimTime?: number;
}) {
  return {
    hp: o.hp,
    damage: o.damage,
    accuracy: o.accuracy, // full cone angle (deg) when standing still
    movePenalty: o.movePenalty, // extra full-cone angle (deg) at full move speed
    fireRate: o.fireRate, // shots per second
    range: o.range ?? 420, // viewport is 1280 wide; keep < 640
    moveSpeed: o.moveSpeed, // px/s
    projectileSpeed: o.projectileSpeed, // px/s, independent of enemy.projectileSpeed
    reviveTime: o.reviveTime, // s for THIS soldier to revive a downed squadmate
    turnRate: 14, // aim turn speed, rad/s
    aimTolerance: 12, // deg: fires only when aim is within this of the target
    radius: 12, // collision radius (visual bulk is separate)
    aimTime: o.aimTime ?? 0, // v0.6.2: s the aim must be held on a target before a shot (Sniper only)
  };
}
export type SoldierStats = ReturnType<typeof soldierClassStats>;

function makeDefaults() {
  return {
    // v0.1.2 Infantry: fireRate 4, accuracy 7, movePenalty 18 (25 moving), projectileSpeed 950.
    infantry: soldierClassStats({ hp: 100, damage: 10, fireRate: 3, accuracy: 12, movePenalty: 18, moveSpeed: 150, projectileSpeed: 700, reviveTime: 10 }),
    heavy: soldierClassStats({ hp: 150, damage: 6, fireRate: 7, accuracy: 15, movePenalty: 25, moveSpeed: 120, projectileSpeed: 700, reviveTime: 12 }),
    medic: soldierClassStats({ hp: 80, damage: 7, fireRate: 2.5, accuracy: 10, movePenalty: 18, moveSpeed: 157.5, projectileSpeed: 700, reviveTime: 5 }),
    // v0.6.2 Sniper: long range, slow, hard-hitting, fragile. Shots need a brief held aim (aimTime).
    sniper: soldierClassStats({ hp: 75, damage: 32, fireRate: 0.8, accuracy: 2.5, movePenalty: 16, moveSpeed: 145, projectileSpeed: 1500, reviveTime: 10, range: 560, aimTime: 0.45 }),
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
    // ---- v0.6.2 enemy kinds (same fields as the rifleman above; missing behaviour = rifleman) ----
    enemySniper: {
      hp: 45, damage: 30, accuracy: 0.6, movePenalty: 10, fireRate: 0.28, range: 600, moveSpeed: 70, projectileSpeed: 1100,
      turnRate: 4, aimTolerance: 4, radius: 12, speedVariance: 0.1, reactionMin: 0.4, reactionMax: 0.8, advanceChance: 0, advanceMinDist: 0.9, aggroRadius: 700,
      aimTime: 1.6, // telegraph: the laser tracks the target for aimTime - lockTime, then holds still
      lockTime: 0.45, // s the line is frozen (bright) before the shot: step aside to dodge
    },
    armored: {
      hp: 140, damage: 8, accuracy: 10, movePenalty: 14, fireRate: 1.1, range: 330, moveSpeed: 58, projectileSpeed: 380,
      turnRate: 2.6, aimTolerance: 18, radius: 14, speedVariance: 0.08, reactionMin: 0.4, reactionMax: 0.8, advanceChance: 1, advanceMinDist: 0.3, aggroRadius: 600,
      frontArc: 65, // deg either side of facing that counts as "frontal"
      frontMul: 0.35, // damage taken from the front (bullets)
      rearMul: 1.25, // damage taken from behind (outside 120 deg of facing)
    },
    tower: {
      hp: 80, damage: 8, accuracy: 6, movePenalty: 0, fireRate: 1.0, range: 520, moveSpeed: 0, projectileSpeed: 430,
      turnRate: 5, aimTolerance: 10, radius: 20, speedVariance: 0, reactionMin: 0.5, reactionMax: 0.9, advanceChance: 0, advanceMinDist: 1, aggroRadius: 560,
    },
    boss: {
      hp: 2400, damage: 4, accuracy: 7, movePenalty: 0, fireRate: 9, range: 560, moveSpeed: 42, projectileSpeed: 470,
      turnRate: 1.6, aimTolerance: 30, radius: 26, speedVariance: 0, reactionMin: 0.3, reactionMax: 0.3, advanceChance: 0, advanceMinDist: 1, aggroRadius: 2000,
      windup: 0.9, // s machine-gun windup (telegraph)
      burst: 2.2, // s sustained burst
      burstTurn: 0.35, // rad/s the barrel can follow a moving target during the burst
      rest: 1.5, // s between bursts
      rocketEvery: 24, // s between rocket attacks (+/- rocketJitter)
      rocketJitter: 3,
      rocketTrack: 1.0, // s the red circle follows its target...
      rocketWarn: 2.5, // ...out of this total warning (then it is locked in place)
      rocketRadius: 95,
      rocketDamage: 55, // at centre (edge: rocketEdge x this); cover between blast and soldier blocks it
      rocketEdge: 0.4,
      // hidden damage modifiers by source (never shown in game text)
      modInfantry: 0.75, modHeavy: 0.65, modMedic: 0.75, modGrenade: 1.0, modSniper: 1.6,
    },
    truck: {
      hp: 1000, damage: 0, accuracy: 0, movePenalty: 0, fireRate: 0, range: 0, moveSpeed: 52, projectileSpeed: 1,
      turnRate: 2, aimTolerance: 0, radius: 26, speedVariance: 0, reactionMin: 0, reactionMax: 0, advanceChance: 0, advanceMinDist: 1, aggroRadius: 0,
      grenadeMul: 1.3, // trucks take extra blast damage
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
    focus: {
      duration: 5, // s (Sniper ability)
      cooldown: 20, // s, starts on activation
      fireRateMul: 1.5, // own fire rate while focused (does not stack with Rapid Fire: the larger applies)
      aimMul: 0.35, // aim time while focused
    },
    fieldTreatment: {
      healFrac: 0.25, // fraction of each healed soldier's own max HP
      radius: 140, // world px around the Medic (Medic included)
      cooldown: 25, // s
    },
    revive: {
      radius: 55,
      // revive duration is per class now: infantry/heavy/medic.reviveTime
      // v0.4 rescue rules: bleed-out 20 s (v0.1-v0.3: 30 s); revived at 30% max HP (v0.1-v0.3: 40%).
      // Bleed-out pauses only while a VALID revive runs (standing squadmate in radius with a
      // clear line to the downed soldier, so revive progress is accruing).
      bleedOut: 20,
      hpFrac: 0.3,
      criticalTime: 5, // last seconds of bleed-out shown as CRITICAL
      assistRadius: 140, // squad anchor this close to a downed soldier: nearest soldier steps in to revive
    },
    escort: {
      hp: 150, // rescued captive (Mission 5)
      moveSpeed: 150, // px/s (+ catch-up when left behind)
      followDist: 60, // legacy (v0.4-v0.6.1 trailing escort); v0.6.2 uses the formation below
      ringMoving: 62, // v0.6.2 protective formation: soldier ring radius around the captive while moving
      ringIdle: 54, // ... and when the squad is stopped
      freeTime: 3, // s standing next to the captive to cut them loose
      strayHitRadius: 5, // v0.6.2: an escorted captive keeps their head down: rounds aimed at a soldier only hit them inside this radius (aimed rounds use the full body)
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
