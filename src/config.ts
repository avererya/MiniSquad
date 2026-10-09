// ALL gameplay numbers live here. The tuning panel edits CFG live;
// "Reset" copies DEFAULTS back in place, "Export" dumps CFG as JSON.
// Units: pixels, seconds, degrees (for cone angles), HP points.

export interface RosterEntry {
  name: string;
  speedMul: number; // per-soldier speed multiplier on top of the class move speed
  offset: [number, number]; // preferred offset around the squad anchor, in slot-spacing units
}

function makeDefaults() {
  return {
    infantry: {
      hp: 100,
      damage: 10,
      accuracy: 7, // full cone angle (deg) when standing still (v0.1: 4)
      movePenalty: 18, // extra cone angle (deg) at full move speed
      fireRate: 4, // shots per second
      range: 420, // viewport is 1280 wide; keep < 640
      moveSpeed: 150,
      projectileSpeed: 950, // px/s, independent of enemy.projectileSpeed
      abilityCooldown: 8,
      turnRate: 14, // aim turn speed, rad/s
      aimTolerance: 12, // deg: fires only when aim is within this of the target
      radius: 12,
    },
    enemy: {
      hp: 40,
      damage: 7,
      accuracy: 9, // keep wider than infantry.accuracy
      movePenalty: 16,
      fireRate: 1.4,
      range: 380, // must stay <= infantry.range (never fires from off screen)
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
      startSize: 2,
      slotSpacing: 44, // px per offset unit
      spreadMoving: 1.3, // offset scale while moving
      spreadIdle: 0.8, // offset scale when stopped
      looseness: 0.5, // 0 = tight/stiff, 1 = lazy/wandering
      followAccel: 1500, // px/s^2 steering acceleration
      separationRadius: 38,
      separationStrength: 700,
      leash: 110, // anchor can't get further than this from the squad centre
      anchorSpeedFactor: 0.92, // anchor speed relative to the slowest soldier
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
      range: 300,
      radius: 95,
      damage: 90, // at centre
      edgeDamageFrac: 0.4, // fraction of damage at the blast edge
      flightTime: 0.65,
      fuse: 0.35, // after landing
      arcHeight: 70,
      shake: 12,
    },
    revive: {
      radius: 55,
      time: 10,
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

export function applyConfigJSON(json: string) {
  const data = JSON.parse(json);
  for (const group of Object.keys(data)) {
    const target = (CFG as any)[group];
    if (!target || typeof data[group] !== 'object') continue;
    for (const key of Object.keys(data[group])) {
      if (key in target) target[key] = data[group][key];
    }
  }
}

export function getPath(path: string): number {
  const [g, k] = path.split('.');
  return (CFG as any)[g][k];
}
export function setPath(path: string, v: number) {
  const [g, k] = path.split('.');
  (CFG as any)[g][k] = v;
}
