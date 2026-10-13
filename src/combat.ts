// Aiming, firing, physical projectiles, damage and hit effects.
import { CFG } from './config';
import type { Game } from './game';
import type { Team, Unit } from './unit';
import { DEG, dist, rand, segCircle, turnToward, angleDiff, type Vec } from './util';
import { sfx } from './audio';
import { sniperShouldSwitch } from './targeting';
import { closeQuartersMul, onFire, onHit, penetrate } from './elite';

export interface Projectile {
  pos: Vec;
  vel: Vec;
  team: Team;
  damage: number;
  life: number;
  trail: Vec; // previous position, for drawing a streak
  owner?: Unit; // shooter, for hit statistics
  width?: number; // tracer width (class visual)
  len?: number; // tracer length
  hot?: boolean; // fired under Suppressive Fire (drawn hotter)
  /** v0.6.2: precision round (squad / enemy Sniper): long bright tracer. */
  precise?: boolean;
  /** v0.7A: fire-time Elite multiplier already in `damage` (Rally, Perfect Aim); 1 / absent otherwise. */
  mul?: number;
  /** v0.7A: a Perfect Aim charged shot (drawn brighter). */
  charged?: boolean;
  /** v0.8A: where the shooter stood when the round left the barrel (enemy group awareness). */
  from?: Vec;
  /** v0.8B: a round of the escort truck's machine gun (fixed stats: no Elite / class on-hit effects). */
  mounted?: boolean;
}

export interface Particle { pos: Vec; vel: Vec; life: number; maxLife: number; color: string; size: number; z?: number; vz?: number }
export interface Ring { pos: Vec; r: number; maxR: number; life: number; maxLife: number; color: string; width: number }
export interface FloatText { pos: Vec; text: string; life: number; color: string }
export interface Pulse { pos: Vec; r: number; life: number; maxLife: number }

export class Effects {
  particles: Particle[] = [];
  rings: Ring[] = [];
  texts: FloatText[] = [];
  pulses: Pulse[] = []; // filled area flashes (Field Treatment)
  shake = 0;

  burst(pos: Vec, n: number, color: string, speed: number, life = 0.35, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * rand(0.3, 1);
      this.particles.push({ pos: { ...pos }, vel: { x: Math.cos(a) * s, y: Math.sin(a) * s }, life, maxLife: life, color, size: size * rand(0.6, 1.2) });
    }
  }
  ring(pos: Vec, maxR: number, color: string, life = 0.3, width = 3) {
    this.rings.push({ pos: { ...pos }, r: 0, maxR, life, maxLife: life, color, width });
  }
  text(pos: Vec, text: string, color: string) {
    this.texts.push({ pos: { x: pos.x + rand(-6, 6), y: pos.y - 30 }, text, life: 0.7, color });
  }
  update(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.pos.x += p.vel.x * dt; p.pos.y += p.vel.y * dt;
      p.vel.x *= 1 - 4 * dt; p.vel.y *= 1 - 4 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) { r.life -= dt; r.r = r.maxR * (1 - r.life / r.maxLife); }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) { t.life -= dt; t.pos.y -= 40 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const p of this.pulses) p.life -= dt;
    this.pulses = this.pulses.filter((p) => p.life > 0);
    this.shake = Math.max(0, this.shake - CFG.feel.shakeDecay * dt);
  }
}

/** Held-aim time a soldier needs before each shot (Sniper; 0 for every other class). */
export function aimTimeOf(u: Unit): number {
  const base = (u.stats as { aimTime?: number }).aimTime ?? 0;
  return base * (u.ability?.aimMul?.() ?? 1);
}

/** Retarget, turn to aim, and fire if possible. */
/** Targets an enemy may engage while itself off screen (stationary assets). */
const offscreenTarget = (u: Unit) => u.target?.asset === 'command' || u.target?.asset === 'turret';

export function updateWeapon(u: Unit, game: Game, dt: number, hostiles: Unit[]) {
  u.fireCooldown -= dt;
  u.reactionLeft -= dt;
  u.muzzle -= dt;
  const prevTarget = u.target;
  if (u.target && !u.targeting.isValid(u, u.target, game)) u.target = null;
  // v0.6.2 squad Sniper: may trade up to a higher-priority target before committing to a shot
  if (u.target && u.classDef?.id === 'sniper' && !u.target.structure) {
    const t = u.targeting.select(u, hostiles, game);
    if (t && t !== u.target && sniperShouldSwitch(u, u.target, t)) { u.target = t; u.reactionLeft = squadReaction(u); }
  }
  // an objective structure is only shot when no enemy soldier is in sight: re-check each step
  if (u.target?.structure) {
    const t = u.targeting.select(u, hostiles, game);
    if (t && t !== u.target && !t.structure) { u.target = t; u.reactionLeft = squadReaction(u); }
  }
  if (!u.target) {
    const t = u.targeting.select(u, hostiles, game);
    if (t) {
      u.target = t;
      u.reactionLeft = u.team === 'enemy' ? u.reactionTime : squadReaction(u);
    }
  }
  if (u.target !== prevTarget) u.aimHeld = 0;
  const st = u.stats;
  let desired = u.aim;
  if (u.target) desired = Math.atan2(u.target.pos.y - u.pos.y, u.target.pos.x - u.pos.x);
  else if (Math.hypot(u.vel.x, u.vel.y) > 20) desired = Math.atan2(u.vel.y, u.vel.x);
  u.aim = turnToward(u.aim, desired, st.turnRate * turnMul(u) * dt);

  const aimNeed = aimTimeOf(u);
  // held aim (Sniper): accrues while the barrel is on the target (also during the cooldown)
  if (aimNeed > 0) {
    if (u.target && u.reactionLeft <= 0 && Math.abs(angleDiff(u.aim, desired)) <= st.aimTolerance * DEG) u.aimHeld += dt;
    else if (!u.target) u.aimHeld = 0;
  }
  if (!u.target || u.reactionLeft > 0 || u.fireCooldown > 0) return;
  // never fire from off screen (range alone can't guarantee it vertically: view half-height is 360)
  // (v0.8B: except at a mission asset: a command center or truck left alone is still under fire)
  // v0.8B.1: off-screen enemies may only shell stationary assets (command
  // centre, turrets); the escort truck is attacked from on screen only.
  if (u.team === 'enemy' && !offscreenTarget(u) && !game.isOnScreen(u.pos, -8)) return;
  if (Math.abs(angleDiff(u.aim, desired)) > st.aimTolerance * DEG) return;
  if (aimNeed > 0 && u.aimHeld < aimNeed) return;

  // Fire: direction randomized uniformly inside the current cone. No shot leading.
  const half = (u.cone * DEG) / 2;
  const a = u.aim + rand(-half, half);
  const dx = Math.cos(a), dy = Math.sin(a);
  const speed = st.projectileSpeed;
  // v0.8A Commando: the right-hand pistol fires from the right side of the body
  const side = u.offhand ? 5 : 0, sx = -Math.sin(u.aim) * side, sy = Math.cos(u.aim) * side;
  const vis = u.classDef?.visual;
  // v0.7A Elite passives decided when the round leaves the barrel (Rally, Perfect Aim charge)
  const el = u.team === 'squad' && (u.elite || u.rallied) ? onFire(u) : null;
  game.projectiles.push({
    pos: { x: u.pos.x + dx * 6 + sx, y: u.pos.y + dy * 6 + sy },
    vel: { x: dx * speed, y: dy * speed },
    team: u.team,
    damage: el ? st.damage * el.mul : st.damage,
    ...(el ? { mul: el.mul, charged: el.charged } : {}),
    life: (st.range * 1.25) / speed,
    trail: { x: u.pos.x, y: u.pos.y },
    owner: u,
    width: vis?.tracerWidth,
    len: vis?.tracerLen,
    hot: u.suppressing,
    precise: aimNeed > 0,
    ...(u.team === 'squad' ? { from: { x: u.pos.x, y: u.pos.y } } : {}),
  });
  u.aimHeld = 0;
  u.shots++;
  u.fireCooldown = (1 / u.fireRate) * (u.team === 'enemy' ? rand(0.85, 1.2) : rand(0.95, 1.05));
  u.muzzle = CFG.feel.muzzleFlash;
  if (u.team === 'squad') sfx(aimNeed > 0 ? 'snipe' : 'shot'); else sfx('eshot');
}

/** Reaction before a squad unit's first shot on a new target (0.08 s; v0.8A Quick Draw / Enhanced Bullet Storm: faster). */
function squadReaction(u: Unit): number {
  if (u.elite?.id === 'com-gunslinger') return u.ability?.activeLeft && u.ability.id === 'bulletStorm' ? 0 : CFG.elite.quickDrawReaction;
  return 0.08;
}
/** Turn-rate multiplier (v0.8A Quick Draw: x1.4; 1 for everyone else). */
function turnMul(u: Unit): number { return u.elite?.id === 'com-gunslinger' ? CFG.elite.quickDrawTurn : 1; }

/** Widest angle between the body's aim and the left-hand pistol (arms can't point backwards). */
const OFFHAND_ARC = 75 * DEG;

/**
 * v0.8A COMMANDO LEFT-HAND PISTOL. The right-hand pistol is the ordinary weapon (updateWeapon); this second
 * pistol has its own target, aim, reaction and cooldown (offset half a period at spawn so the two alternate).
 * It prefers a DIFFERENT visible enemy than the right hand and falls back to the same one (both may focus a
 * target). Same stats as the right hand (damage, fire rate incl. Bullet Storm, cone incl. the moving penalty,
 * range, projectile). It only fires within OFFHAND_ARC of where the body aims.
 */
export function updateOffhand(u: Unit, game: Game, dt: number, hostiles: Unit[]) {
  const o = u.offhand!;
  o.cooldown -= dt; o.reaction -= dt; o.muzzle -= dt;
  if (o.target && (!u.targeting.isValid(u, o.target, game) || (o.target === u.target && o.cooldown <= 0 && o.reaction <= 0 && offhandPick(u, hostiles, game, true)))) o.target = null;
  if (!o.target) {
    const t = offhandPick(u, hostiles, game, false);
    if (t) { o.target = t; o.reaction = squadReaction(u); }
  }
  const st = u.stats;
  let desired = u.aim;
  if (o.target) desired = Math.atan2(o.target.pos.y - u.pos.y, o.target.pos.x - u.pos.x);
  // the arm stays within the arc of the body's aim
  const off = angleDiff(u.aim, desired);
  if (Math.abs(off) > OFFHAND_ARC) desired = u.aim + Math.sign(off) * OFFHAND_ARC;
  o.aim = turnToward(o.aim, desired, st.turnRate * turnMul(u) * dt);
  if (!o.target || o.reaction > 0 || o.cooldown > 0) return;
  if (Math.abs(angleDiff(o.aim, Math.atan2(o.target.pos.y - u.pos.y, o.target.pos.x - u.pos.x))) > st.aimTolerance * DEG) return;
  const half = (u.cone * DEG) / 2;
  const a = o.aim + rand(-half, half);
  const dx = Math.cos(a), dy = Math.sin(a);
  const sx = Math.sin(u.aim) * 5, sy = -Math.cos(u.aim) * 5; // left side of the body
  const vis = u.classDef?.visual;
  const el = u.elite || u.rallied ? onFire(u) : null;
  game.projectiles.push({
    pos: { x: u.pos.x + dx * 6 + sx, y: u.pos.y + dy * 6 + sy },
    vel: { x: dx * st.projectileSpeed, y: dy * st.projectileSpeed },
    team: 'squad',
    damage: el ? st.damage * el.mul : st.damage,
    ...(el ? { mul: el.mul, charged: el.charged } : {}),
    life: (st.range * 1.25) / st.projectileSpeed,
    trail: { x: u.pos.x, y: u.pos.y },
    owner: u, width: vis?.tracerWidth, len: vis?.tracerLen,
    from: { x: u.pos.x, y: u.pos.y },
  });
  u.shots++;
  o.cooldown = (1 / u.fireRate) * rand(0.95, 1.05);
  o.muzzle = CFG.feel.muzzleFlash;
  sfx('shot');
}

/** Left-hand target: a visible enemy other than the right hand's (or, unless `otherOnly`, the same one). */
function offhandPick(u: Unit, hostiles: Unit[], game: Game, otherOnly: boolean): Unit | null {
  const main = u.target;
  if (main) {
    const other = u.targeting.select(u, hostiles.filter((h) => h !== main), game);
    if (other && !other.structure) return other;
    if (otherOnly) return null;
  }
  return otherOnly ? null : u.targeting.select(u, hostiles, game);
}

/**
 * v0.6.2 ENEMY SNIPER. Slow, long range, telegraphed: once it has a clear lane to a target it
 * shows a laser that TRACKS the target for (aimTime - lockTime) s, then FREEZES (brighter line)
 * for lockTime s and fires a fast round along the frozen line. Stepping off the frozen line, or
 * breaking line of sight at any point (cover), makes it miss / cancels the shot. It only aims while
 * on screen (the telegraph is always visible) and re-picks its target after every shot.
 */
export function updateEnemySniper(u: Unit, game: Game, dt: number, victims: Unit[]) {
  const C = CFG.enemySniper;
  u.fireCooldown -= dt;
  u.muzzle -= dt;
  const drop = () => { u.target = null; u.aimHeld = 0; u.lockAim = null; };
  if (u.target && !u.targeting.isValid(u, u.target, game)) drop();
  if (!u.target && u.fireCooldown <= 0) {
    const t = u.targeting.select(u, victims, game);
    if (t) { u.target = t; u.aimHeld = 0; u.lockAim = null; }
  }
  if (!u.target) {
    if (Math.hypot(u.vel.x, u.vel.y) > 20) u.aim = turnToward(u.aim, Math.atan2(u.vel.y, u.vel.x), C.turnRate * dt);
    return;
  }
  if (!game.isOnScreen(u.pos, -8) && !offscreenTarget(u)) { u.aimHeld = 0; u.lockAim = null; return; }
  const desired = Math.atan2(u.target.pos.y - u.pos.y, u.target.pos.x - u.pos.x);
  if (u.lockAim === null) u.aim = turnToward(u.aim, desired, C.turnRate * dt);
  if (u.fireCooldown > 0) return;
  u.aimHeld += dt;
  if (u.lockAim === null && u.aimHeld >= C.aimTime - C.lockTime) { u.lockAim = u.aim; sfx('lock'); }
  if (u.aimHeld < C.aimTime || u.lockAim === null) return;
  const half = (C.accuracy * DEG) / 2;
  const a = u.lockAim + rand(-half, half);
  const dx = Math.cos(a), dy = Math.sin(a);
  game.projectiles.push({
    pos: { x: u.pos.x + dx * 8, y: u.pos.y + dy * 8 }, vel: { x: dx * C.projectileSpeed, y: dy * C.projectileSpeed },
    team: 'enemy', damage: C.damage, life: (C.range * 1.3) / C.projectileSpeed, trail: { x: u.pos.x, y: u.pos.y }, owner: u,
    width: 4, len: 44, precise: true,
  });
  u.shots++;
  u.muzzle = CFG.feel.muzzleFlash * 2;
  u.fireCooldown = 1 / C.fireRate;
  sfx('snipe');
  drop();
}

export function updateProjectiles(game: Game, dt: number) {
  const out: Projectile[] = [];
  for (const p of game.projectiles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    const x1 = p.pos.x, y1 = p.pos.y;
    const x2 = x1 + p.vel.x * dt, y2 = y1 + p.vel.y * dt;
    let bestT = game.world.raycast(x1, y1, x2, y2);
    let hitWall = bestT < 1;
    let hitUnit: Unit | null = null;
    // first hostile character along the path; allies and downed soldiers are passed through
    const victims = p.team === 'squad' ? game.enemies : game.enemyVictims();
    for (const u of victims) {
      if (!u.targetable) continue;
      // v0.6.2 hostage protection: an escorted captive inside the ring ducks rounds meant for the
      // soldiers around them (smaller profile); a round aimed at the captive uses the full body.
      const hitR = u.npc && u.escorting && p.owner?.target !== u ? CFG.escort.strayHitRadius : u.radius + 2;
      const t = segCircle(x1, y1, x2, y2, u.pos.x, u.pos.y, hitR);
      if (t >= 0 && t < bestT) { bestT = t; hitUnit = u; hitWall = false; }
    }
    const hx = x1 + (x2 - x1) * bestT, hy = y1 + (y2 - y1) * bestT;
    if (hitUnit && p.team === 'enemy') hitUnit = mountedHit(game, hitUnit, p.owner?.target ?? null);
    if (hitUnit) {
      if (p.owner) p.owner.hits++;
      // v0.7A Deadeye / Phantom Shot: decided per successful hit (misses never count; never the truck's gun)
      const eh = p.owner?.elite && p.team === 'squad' && !p.mounted ? onHit(p.owner, p.mul ?? 1) : null;
      const dmg = eh && eh.mul !== 1 ? p.damage * eh.mul : p.damage;
      if (eh && eh.mul !== 1 && p.owner?.elite) p.owner.elite.effect += dmg - p.damage;
      // v0.8A Commando Close Quarters (+15% inside 160 px, within the Elite shot cap) / Assault Storm heal on hit
      const cq = p.owner?.elite?.id === 'com-assault' && !p.mounted ? closeQuartersMul(p.owner, hitUnit, (p.mul ?? 1) * (eh?.mul ?? 1)) : 1;
      const dmg2 = cq !== 1 ? dmg * cq : dmg;
      if (cq !== 1 && p.owner?.elite) p.owner.elite.effect += dmg2 - dmg;
      game.damage(hitUnit, dmg2, p.owner, { dir: p.vel, precise: p.precise, at: { x: hx, y: hy }, ...(p.from ? { origin: p.from } : {}), ...(eh && eh.pen ? { pen: eh.pen } : {}) });
      if (p.team === 'squad' && !p.mounted && p.owner?.ability?.heal && hitUnit.team === 'enemy' && !hitUnit.structure) { const h = p.owner.ability.heal(p.owner); if (h > 0) p.owner.healFlash = 0.3; }
      if (eh && (eh.mul !== 1 || eh.pen)) game.fx.burst({ x: hx, y: hy }, 6, eh.pen ? '#bfe8ff' : '#9fd0ff', 170, 0.25, 3);
      game.fx.burst({ x: hx, y: hy }, 4, hitUnit.team === 'squad' ? '#ffd1a0' : '#ffe08a', 120, 0.2, 2.5);
      continue;
    }
    if (hitWall) {
      game.fx.burst({ x: hx, y: hy }, 3, '#e8e2c8', 90, 0.18, 2);
      continue;
    }
    p.trail = { x: x1, y: y1 };
    p.pos.x = x2; p.pos.y = y2;
    out.push(p);
  }
  game.projectiles = out;
}

/**
 * v0.8B the truck's gunner rides on the cargo bed: a round meant for the gunner that strikes the truck hits the
 * gunner, and a round meant for the truck (or anyone else) that strikes the gunner hits the truck.
 */
function mountedHit(game: Game, hit: Unit, aimedAt: Unit | null): Unit {
  const gun = game.mission.escort?.gun;
  const g = gun?.gunner, truck = gun?.vehicle.unit;
  if (!g || !truck || !g.active || !truck.active) return hit;
  if (hit === truck && aimedAt === g) return g;
  if (hit === g && aimedAt !== g) return truck;
  return hit;
}

/** Area damage to one team only (grenades never hurt friendlies). */
export function explode(game: Game, pos: Vec, radius: number, damage: number, edgeFrac: number, victims: Unit[], source?: Unit, grenade = false, origin?: Vec) {
  for (const u of victims) {
    if (!u.active) continue;
    const d = dist(pos, u.pos);
    if (d > radius + u.radius) continue;
    const f = Math.min(1, d / radius);
    game.damage(u, damage * (1 - f * (1 - edgeFrac)), source, origin ? { grenade, origin } : { grenade });
  }
  game.fx.ring(pos, radius, 'rgba(255,220,120,0.9)', 0.35, 6);
  game.fx.burst(pos, 26, '#ffb347', 380, 0.45, 5);
  game.fx.burst(pos, 14, '#6b6b6b', 160, 0.8, 7);
  game.fx.shake = Math.max(game.fx.shake, CFG.grenade.shake);
  game.scorches.push({ ...pos, r: radius * 0.45 });
  sfx('boom');
}

export interface DamageOpts {
  /** Direction the round travelled (bullets): drives Armored Trooper frontal armour. */
  dir?: Vec;
  /** Grenade / blast damage. */
  grenade?: boolean;
  /** Precision round (Sniper). */
  precise?: boolean;
  /** Impact point (effects). */
  at?: Vec;
  /** v0.7A Phantom Shot: share of the target's armor this round ignores (0..1). */
  pen?: number;
  /** v0.7C tactical support (support.ts): the amount is already final (explicit per target class); Game.damage applies the boss / objective floors. */
  support?: 'airstrike' | 'nuke';
  /** v0.8A: where the attack came from (the shooter at firing time / the thrower); enemy group awareness. */
  origin?: Vec;
}

/**
 * v0.6.2 damage modifiers, applied to the intended damage before it is removed:
 *  - Armored Trooper: bullets hitting the FRONT (within frontArc of where it faces) x frontMul,
 *    from BEHIND (outside 180 - frontArc... i.e. the rear 120 deg) x rearMul; flanks x1; blasts x1.
 *  - Iron Warden (boss): by source: Infantry 75%, Heavy Gunner 65%, Medic 75%, grenades 100%,
 *    Sniper 160% (hidden; only the hit effects and the HP bar tell).
 *  - Supply truck: blasts x grenadeMul.
 * Returns the modified amount (effects are spawned here too).
 */
export function modifyDamage(game: Game, u: Unit, amount: number, source: Unit | undefined, o: DamageOpts): number {
  if (u.team !== 'enemy' || o.support) return amount;
  const at = o.at ?? u.pos;
  if (u.kind === 'armored' && o.dir && !o.grenade) {
    const A = CFG.armored;
    const from = Math.atan2(-o.dir.y, -o.dir.x); // direction from the trooper toward the shooter
    const off = Math.abs(angleDiff(u.aim, from)) / DEG;
    if (off <= A.frontArc) {
      game.fx.burst(at, 5, '#dfe6ee', 160, 0.18, 2.5); // sparks off the plate
      if (Math.random() < 0.3) sfx('clank');
      return amount * penetrate(A.frontMul, o.pen ?? 0);
    }
    if (off >= 180 - (180 - A.frontArc) / 2) return amount * A.rearMul;
    return amount;
  }
  if (u.kind === 'boss') {
    const B = CFG.boss;
    if (o.grenade) return amount * B.modGrenade;
    const cls = source?.classDef?.id;
    if (cls === 'sniper') {
      // armour-cracking hit: bright shards + a crack ring (no text: the weakness stays hidden)
      game.fx.burst(at, 14, '#e8f6ff', 260, 0.35, 3.5);
      game.fx.burst(at, 6, '#7fd0ff', 140, 0.5, 4);
      game.fx.ring(at, 26, 'rgba(200,240,255,0.95)', 0.3, 3);
      return amount * pierceBoss(B.modSniper, o.pen);
    }
    if (Math.random() < 0.5) game.fx.burst(at, 3, '#ffe9a0', 110, 0.14, 2); // ordinary rounds spark off the armour
    return amount * pierceBoss(cls === 'heavy' ? B.modHeavy : cls === 'medic' ? B.modMedic : B.modInfantry, o.pen);
  }
  if (u.vehicle && o.grenade) return amount * CFG.truck.grenadeMul;
  return amount;
}

/**
 * v0.7A Phantom Shot vs the Iron Warden: each class modifier = weakness x (1 - plating). A
 * precision round keeps only (1 - pen) of the plating: mod x (1 - plating x (1 - pen)) / (1 - plating).
 * Sniper (1.6, plating 0.35, pen 0.6): 1.6 -> 2.12 on that hit (+32%; about +8% averaged over every 4th hit). No pen: the modifier, unchanged.
 */
function pierceBoss(mod: number, pen: number | undefined): number {
  const P = CFG.boss.plating;
  if (!pen || P <= 0 || P >= 1) return mod;
  return mod * (1 - P * (1 - pen)) / (1 - P);
}
