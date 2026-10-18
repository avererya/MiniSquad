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
    // v0.8A Commando: dual pistols (each pistol fires on its own: 2 x 7 dmg x 2.5/s = 35 DPS in theory),
    // 115% of the Infantry move speed, short-medium range (340 px: inside the rifleman's 380, so he has to close in).
    commando: soldierClassStats({ hp: 85, damage: 7, fireRate: 2.5, accuracy: 10, movePenalty: 14, moveSpeed: 172.5, projectileSpeed: 760, reviveTime: 10, range: 340 }),
    // v0.8C Demolitions Expert: shoulder rocket launcher. `damage` is the direct hit; the blast around the impact
    // (CFG.rocket) falls off from that to the edge. Slow (0.55 shots/s), tough, a little slower on foot.
    demolitions: soldierClassStats({ hp: 115, damage: 42, fireRate: 0.55, accuracy: 4, movePenalty: 12, moveSpeed: 138, projectileSpeed: 560, reviveTime: 11, range: 460 }),
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
    // v0.8B.2 rebalance: a hit costs 65% of a fresh Infantry's 100 HP (was 30), the round flies 15% slower (was 1100
    // px/s) so stepping off the locked laser works at every range; cadence, aim / lock times and accuracy unchanged.
    enemySniper: {
      hp: 45, damage: 65, accuracy: 0.6, movePenalty: 10, fireRate: 0.28, range: 600, moveSpeed: 70, projectileSpeed: 935,
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
      callPause: 2, // s extra MG rest when he calls reinforcements (rest total = callPause + rest)
      // hidden damage modifiers by source (never shown in game text)
      modInfantry: 0.75, modHeavy: 0.65, modMedic: 0.75, modGrenade: 1.0, modSniper: 1.6,
      plating: 0.35, // v0.7A: armor share of those modifiers that a Ghost's Phantom Shot can pierce (precision rounds only)
    },
    // v0.8C Mission 15 boss: GENERAL VOSS (general.ts). A rifleman-sized commander: rifle shots on a fixed cadence (no
    // spread jitter on the timing), same projectiles / walls / line of sight as every enemy round. Phases by HP.
    general: {
      // accuracy / projectileSpeed / range: an ordinary enemy round (readable and sidestep-able like a rifleman's; v0.8C
      // sims: a 6 deg, 520 px/s, 500 px rifle hit ~75% of shots and out-ranged most soldiers), range <= the soldiers' 420
      hp: 2200, damage: 20, accuracy: 10, movePenalty: 0, fireRate: 1.5, range: 400, moveSpeed: 62, projectileSpeed: 430,
      turnRate: 3.2, aimTolerance: 10, radius: 17, speedVariance: 0, reactionMin: 0.4, reactionMax: 0.4, advanceChance: 0, advanceMinDist: 1, aggroRadius: 2000,
      fireRate3: 1.95, // shots/s in phase 3 (below phase3 of max HP)
      phase2: 0.7, // phase 2 below this share of max HP (reinforcements once)
      phase3: 0.35, // phase 3 below this share (reinforcements + the resistance once, faster rifle)
      callPause: 2.5, // s he holds fire while radioing a phase's reinforcements
      rallyRadius: 300, // Rally: enemies (not Voss) within this many px of him...
      rallyBonus: 0.2, // ...deal +20% weapon damage...
      rallyDuration: 8, // ...for this many s (a new Rally refreshes, never stacks)
      rallyCooldown: 25, // s from one Rally to the next
      rallyFirst: 6, // s into the fight before the first Rally
      keepMin: 220, keepMax: 340, // px he likes to keep from the nearest soldier (closes in without a clear shot)
    },
    // v0.8C Demolitions Expert rocket (combat.ts fireRocket / rocketImpact). The direct-hit target takes the soldier's
    // damage once; everyone else in the blast takes the falloff (centre = damage, edge = edgeFrac x damage). Enemies only.
    rocket: {
      splashRadius: 55, // px
      edgeFrac: 0.36, // 42 at the centre, ~29 halfway, ~15 at the edge
      armorBonus: 0.3, // +30% against Armored Troopers and vehicles (added to the multiplier, see rocketMul)
      siegeBonus: 0.2, // Siege Breaker: a further +20% against armored, vehicles and bosses
      pyroRadius: 70, // Pyrotechnic: blast radius
      length: 14, // drawn rocket length
    },
    // v0.8C Demolitions Expert ability: Inferno (abilities.ts InfernoAbility). A flame cone in front of the soldier.
    inferno: {
      duration: 10, // s
      cooldown: 50, // s, after the effect ends
      range: 155, // px
      cone: 65, // full cone angle (deg)
      dps: 16, // damage per second to every enemy in the cone (ticked every `tick` s)
      burnDps: 4, // after leaving the flames: burn damage per second...
      burnTime: 3, // ...for this many s (refreshed, never stacked)
      bypass: 0.35, // share of armor (Armored Trooper plate) the flames ignore
      tick: 0.25, // s between damage ticks (simulation time)
      siegeBypass: 0.6, // Siege Breaker
      pyroDuration: 14, // Pyrotechnic
      pyroBurnDps: 6, // Pyrotechnic
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
    // v0.8A Commando: Bullet Storm (both pistols). The cooldown starts when the effect ENDS.
    bulletStorm: {
      duration: 8, // s
      cooldown: 40, // s, after the effect ends
      fireRateMul: 1.75, // both pistols (Gunslinger's Enhanced Bullet Storm: gunslingerMul)
      gunslingerMul: 2,
      movePenaltyMul: 0.6, // moving-fire spread penalty x this while active
      assaultHealPerHit: 1.5, // Assault Specialist: HP per successful pistol hit while active...
      assaultHealCap: 30, // ...at most this much per activation (never above max HP)
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
    // v0.7A Elite specialization passives (elite.ts). Percentages are fractions.
    elite: {
      adrenalineThreshold: 0.35, // Elite Trooper: Adrenaline Rush below this fraction of max HP...
      adrenalineReduction: 0.25, // ...cuts incoming damage by this much
      deadeyeEvery: 5, // Recon Specialist: every Nth successful rifle hit...
      deadeyeBonus: 0.5, // ...deals this much extra damage
      ironcladReduction: 0.2, // Juggernaut: incoming damage cut, always on
      overdriveMax: 0.25, // Weapons Specialist: max fire-rate bonus (fraction of base, added on top of abilities)
      overdriveBuild: 4, // s of sustained fire from 0 to max
      overdriveGrace: 0.75, // s without a shot before it starts cooling down
      overdriveDecay: 2, // s from max back to 0 once cooling
      miracleReviveSpeed: 1.3, // Combat Surgeon: revive speed x this (time / 1.3)
      miracleHpFrac: 0.5, // revived soldiers get up with this fraction of max HP (normal: revive.hpFrac)
      rallyRadius: 170, // Field Commander aura radius (px)
      rallyDamage: 0.1, // rallied squadmates: weapon damage bonus
      rallySpeed: 0.1, // rallied squadmates: move speed bonus
      phantomEvery: 4, // Ghost: every Nth successful hit is a precision round...
      phantomPen: 0.6, // ...that ignores this share of enemy armor
      perfectAimCharge: 3, // Deadeye: s of stationary aim with a target to charge the next shot...
      perfectAimBonus: 0.75, // ...which deals this much extra damage
      perfectAimMoveTol: 0.15, // smoothed move fraction above which the soldier counts as moving (charge resets)
      // v0.8A Commando specializations
      quickDrawReaction: 0.03, // Gunslinger Quick Draw: s from a new target to the first shot (everyone else 0.08)
      quickDrawTurn: 1.4, // ...and aim turn speed x this
      quickDrawMovePenalty: 0.75, // ...and moving-fire spread penalty x this (always on)
      cqRange: 160, // Assault Specialist Close Quarters: targets within this many px...
      cqBonus: 0.15, // ...take this much extra pistol damage
      maxDamageReduction: 0.4, // cap on all incoming-damage reductions together
      maxShotMul: 2, // cap on all per-shot damage multipliers together
    },
    // v0.7C Tactical Support (support.ts). Damage is explicit per target class: no soldier weapon
    // modifiers, criticals, training or Elite passives apply. Bosses take a share of their own max HP.
    airstrike: {
      radius: 120, // world px blast RADIUS: the targeting circle and the damage use this same value
      delay: 2, // s from CONFIRM to impact (simulation time)
      damage: 260, // at the centre vs normal infantry (rifleman 40 HP, sniper 45, watchtower 80)
      edgeFrac: 0.5, // share of the damage at the rim (linear falloff; a unit centre outside the radius takes nothing)
      armoredMul: 0.6, // Armored Trooper (140 HP): 156 at the centre (dead), 78 at the rim
      vehicleMul: 0.5, // non-objective vehicles (none yet)
      objectiveMul: 0.5, // mission objectives (depots, relays, installations, convoy trucks): 130 at the centre, never destroyed
      bossFrac: 0.15, // boss: this share of its max HP at the centre (Iron Warden 2,400 -> 360)
      shake: 16,
    },
    nuke: {
      countdown: 30, // s of simulation time from launch to detonation
      damage: 1000, // every normal enemy on the map (all current kinds die)
      armoredMul: 1,
      vehicleMul: 0.65,
      objectiveMul: 0.5, // 500 to each objective (truck 1,000 / depot 600 / relay 900 / installation 700 HP), never destroyed
      bossFrac: 0.4, // boss: 40% of its max HP (Iron Warden 960), never below the support floor
      shake: 22,
      warnAt: 10, // countdown beeps from here
      finalAt: 5, // big on-screen warning from here
    },
    support: {
      bossFloor: 0.1, // tactical support never takes a boss below this share of its max HP
      objectiveFloor: 1, // ...nor a mission objective below this many HP
    },
    // v0.8A ENEMY GROUP AWARENESS (awareness.ts). A shot / kill / sighting alerts nearby enemies once.
    awareness: {
      radius: 300, // world px around the enemy that was hit / killed / that saw the squad
      reactMin: 0.3, // s before an alerted enemy reacts (per enemy, deterministic in this range)
      reactMax: 0.8,
      sightRange: 460, // an alerted enemy that sees a soldier this close (clear line) updates the last known position
      sightEvery: 0.25, // s between sight checks per alerted enemy
      searchTime: 12, // s spent searching around the last known position before settling again
      searchSpread: 130, // px: search points around the last known position
      coverDist: 150, // px: a rifleman looks for cover this far around its route
      sniperStandoff: 0.72, // enemy snipers reposition to this fraction of their range from the threat
      stuckTime: 3, // s without progress before an enemy gives up a leg of its route
      repeat: 0.5, // s: the same enemy re-alerts its neighbours at most this often
    },
    // v0.8A resistance fighters (Mission 11): friendly NPC riflemen. Same fields as a soldier class.
    resistance: soldierClassStats({ hp: 110, damage: 8, fireRate: 1.8, accuracy: 9, movePenalty: 14, moveSpeed: 140, projectileSpeed: 700, reviveTime: 10, range: 380 }),
    // v0.8A Mission 12 artillery + spotlights (artillery.ts)
    artillery: {
      exposure: 1, // s of continuous spotlight exposure that triggers an artillery alert
      exposureDecay: 3, // exposure drains this many times faster than it builds (brief crossings never trigger)
      warn: 2.5, // s between the red danger circle and the impact
      interval: 11, // s between shells while alerted (10-12: alternates interval -1 / +1)
      radius: 105, // px blast radius
      damage: 40, // exposed hit at the centre
      edge: 0.5, // share of the damage at the rim
      coverMul: 0.4, // solid cover between the blast and the soldier: -60%
      maxMarkers: 2,
      clearAfter: 20, // s without spotlight detection before the alert clears
      beamRange: 430, // spotlight reach
      beamHalf: 13, // deg, half-width of the beam
    },
    // v0.8A extraction pressure (mission.ts): finite reinforcement groups once extraction is called. They come
    // from map-edge points off screen and at least minDist from every squad member, advance on the squad and are
    // never required kills. Tier per mission (missions.ts): M1 none, M2 light, M3-5 small (M3 keeps its scripted
    // wave), M6-10 moderate (M10 keeps its boss-fight wave), M11 restrained, M12 strong.
    extractionPressure: {
      minDist: 500,
      light: 3, // one group
      small: 4, // one group
      moderateA: 3, moderateB: 2, moderateDelay: 6, // two groups, the second this many s later from another edge
      restrained: 3, restrainedDelay: 2, // M11: one small group (the defence was the fight)
      strongA: 4, strongB: 3, strongDelay: 7, strongArmored: 1, // M12: two groups, the second led by armored troopers
    },
    // v0.8B Chapter 3B (defense.ts / escort.ts). Friendly mission objects are team 'squad' units that are not
    // soldiers: no XP, no training, no casualty record, never counted toward the deployment cap.
    // Friendly automated turret (Mission 13 caches). Same fields as a soldier class (updateWeapon reads them).
    turret: { ...soldierClassStats({ hp: 300, damage: 9, fireRate: 4, accuracy: 7, movePenalty: 0, moveSpeed: 0, projectileSpeed: 760, reviveTime: 0, range: 420 }), radius: 20, turnRate: 6 },
    commandCenter: { hp: 1000, radius: 58 },
    defense: {
      zoneTime: 5, // s a standing soldier must stay in the command zone, continuously, to start the assault
      cacheTime: 3, // s standing in a cleared cache zone to secure it (progress kept, like the M11 zones)
      warn: 7, // s from a wave's start (banner + edge marker + HUD countdown) to its first group's arrival
      // v0.8B.1 wave-start intervals, measured START TO START (announcement to announcement, one clock):
      minGap: 12, // the next wave never starts sooner than this many s after the current one started...
      nextWhenLeft: 4, // ...and starts early once at most this many of the current wave remain (alive + not yet arrived)...
      maxGap: 35, // ...and at the latest this many s after the current one started, however many are still alive
      siegeShare: 0.8, // share of wave riflemen / armored troopers that go for the command center (SiegeTargeting)
    },
    escortTruck: {
      hp: 600,
      radius: 30,
      moveSpeed: 72, // px/s at full speed (the squad walks ~130-150)
      accel: 90, // px/s^2 (starting and braking)
      behind: 200, // the truck rolls up to this far behind the squad's position along the road
      maxOff: 300, // squad centre further than this from the road: the truck waits
      lookahead: 60, // px of road ahead of the front bumper checked for bodies (roadblocks / friendlies)
      halfLen: 44, // front bumper distance from the truck centre along the road
      halfWidth: 22, // body half-width used by the road check
      pinBackAfter: 1.2, // v0.8B.1 s a friendly may stay wedged against the truck before it backs off...
      pinBackMax: 40, // ...at most this many px per incident...
      pinBackSpeed: 30, // ...at this speed (px/s); never a teleport
      yieldNudge: 2.5, // s a friendly may stand in the truck's path while the squad is ahead before it is moved aside
      wreckTime: 15, // s of wreck aftermath before a destroyed truck fails the mission (both sides hold fire)...
      wreckEarly: 2, // ...it ends this early once nobody is left downed...
      wreckCap: 40, // ...and never lasts longer than this, even while a revive is running
      captureTime: 3, // s a standing soldier must stay, continuously, in the truck's capture zone
      captureRadius: 95,
    },
    // Truck machine gun: fixed stats, independent of whoever mans it (no class, training, level or Elite bonus).
    mountedGun: {
      damage: 7, fireRate: 10, range: 450, projectileSpeed: 760,
      spread: 25, // full cone (deg) while the truck stands still
      movingSpread: 34, // full cone (deg) at full truck speed (scaled by speed)
      turnRate: 7, // rad/s
      aimTolerance: 20, // deg
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
