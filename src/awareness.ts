// v0.8A ENEMY GROUP AWARENESS. Enemies react when a nearby ally is shot or killed, or when one of them
// spots the squad, instead of waiting in place to be picked off one by one.
//
// RULES (numbers in CFG.awareness, live-tunable)
//  - Triggers (event-driven, never a per-frame search): an enemy takes damage from the squad (soldier,
//    resistance ally, grenade, airstrike), an enemy is killed (one-shot kills included), an objective
//    structure is shot, or a dormant guard detects the squad (the existing proximity rule) / an alerted
//    enemy sees a soldier. The hit / dead / spotting enemy alerts every eligible enemy within
//    CFG.awareness.radius (300 px) of it, ONCE: alerted enemies never re-broadcast a received alert, and
//    the same enemy broadcasts at most once per CFG.awareness.repeat s, so nothing cascades across the map.
//  - Knowledge: the alert carries the threat's position AT THE TIME (the shooter where the round left the
//    barrel, the thrower where the grenade left the hand). Alerted enemies walk to that point; they only
//    learn where the squad is now by SEEING it (clear line, CFG.awareness.sightRange, checked every
//    sightEvery s) or by getting a target in weapon range. They never home in on a squad they can't see.
//  - Reaction: after a short per-enemy delay in [reactMin, reactMax] (0.3-0.8 s; deterministic from the
//    unit id, so it draws no random numbers). Armored Troopers react at reactMin.
//  - Behaviour by kind: Riflemen detour through nearby cover on the way (if any) and advance to the last
//    known position; Armored Troopers push straight at it; enemy Snipers move to a firing position about
//    sniperStandoff x their range from it with a clear line, and hold there. Once at the last known
//    position the enemy SEARCHES around it (a few points, searchTime s), then settles as a dormant guard
//    where it stands (bounded: no endless wandering; a leg that makes no progress for stuckTime s is
//    dropped, an unreachable one is skipped). Getting shot again or spotting the squad starts over.
//  - Scope: placed guards / patrols of every mission. Scripted waves (they already advance on the squad),
//    convoy escorts walking with their truck, towers, trucks and the boss keep their own behaviour.
//  - Separate from the Mission 12 artillery: nothing here can raise an artillery alert (artillery.ts reads
//    spotlights only).
import { CFG } from './config';
import type { Game } from './game';
import { isBoss, type Unit } from './unit';
import { dist, type Vec } from './util';
import { nearCover } from './targeting';

export type AlertStage = 'pending' | 'move' | 'search' | 'hold' | 'settled';
export interface AlertState {
  stage: AlertStage;
  /** Last known threat position (where the squad was seen / shot from). */
  at: Vec;
  /** pending: seconds left before the enemy reacts. */
  wait: number;
  /** Remaining waypoints of the current stage. */
  legs: Vec[];
  /** Seconds in the current stage. */
  t: number;
  /** Progress watchdog for the current leg. */
  best: number;
  stuck: number;
  /** Countdown to the next sight check. */
  sightT: number;
  /** Was a soldier in sight at the last check. */
  seen: boolean;
  /** game.time when this enemy last alerted its neighbours (-1: never). */
  spreadAt: number;
}

/** Tests / balance: alert broadcasts and received alerts this mission (Game.alertLog is reset per mission). */
export interface AlertLog { broadcasts: number; received: number }

/** Enemies the awareness system moves: placed (dormant) guards and the ones it already woke. Scripted waves (never guards) keep homing in. */
export function awareEligible(e: Unit): boolean {
  return e.team === 'enemy' && e.active && (e.guard || e.alert !== null) && !e.structure && !e.vehicle && !e.fixed && !e.routed && !e.escortOf && !isBoss(e) && e.kind !== 'truck';
}

/** Deterministic reaction delay in [reactMin, reactMax] from the unit id (no Math.random). */
export function reactDelay(e: Unit): number {
  const A = CFG.awareness;
  if (e.kind === 'armored') return A.reactMin;
  const f = (e.id * 0.6180339887) % 1;
  return A.reactMin + (A.reactMax - A.reactMin) * f;
}

/**
 * Something happened to `victim` (hit, killed, or it spotted the squad) with the threat at `threat`.
 * The victim reacts (if it can) and alerts its neighbours once. Never called from an alert itself.
 */
export function raiseAlert(game: Game, victim: Unit, threat: Vec) {
  if (game.phase !== 'playing') return;
  const A = CFG.awareness;
  const log = game.alertLog;
  if (victim.active && awareEligible(victim)) {
    alertUnit(game, victim, threat);
    const st = victim.alert!;
    if (st.spreadAt >= 0 && game.time - st.spreadAt < A.repeat) return; // already told its group just now
    st.spreadAt = game.time;
  }
  log.broadcasts++;
  const r2 = A.radius * A.radius;
  for (const e of game.enemies) {
    if (e === victim || !awareEligible(e)) continue;
    const dx = e.pos.x - victim.pos.x, dy = e.pos.y - victim.pos.y;
    if (dx * dx + dy * dy > r2) continue;
    alertUnit(game, e, threat);
    log.received++;
  }
}

/** One enemy learns of a threat at `threat` (no broadcast). */
export function alertUnit(game: Game, e: Unit, threat: Vec) {
  const st = e.alert;
  if (!st || st.stage === 'settled') {
    e.alert = { stage: 'pending', at: { ...threat }, wait: reactDelay(e), legs: [], t: 0, best: Infinity, stuck: 0, sightT: 0, seen: false, spreadAt: st?.spreadAt ?? -1 };
    return;
  }
  if (st.stage === 'pending') { st.at = { ...threat }; return; }
  // already reacting: a clearly different report re-routes it (no new delay)
  if (dist(st.at, threat) > 120) { st.at = { ...threat }; plan(game, e, st); }
  else if (st.stage === 'search' || st.stage === 'hold') st.t = 0; // keeps looking a while longer
}

/** Route for the current knowledge, by enemy kind. */
function plan(game: Game, e: Unit, st: AlertState) {
  st.t = 0; st.best = Infinity; st.stuck = 0; e.path = null;
  if (e.kind === 'sniper') {
    const p = sniperPost(game, e, st.at);
    st.stage = 'move'; st.legs = p ? [p] : [];
    return;
  }
  const legs: Vec[] = [];
  if (e.kind === 'rifleman' && !e.advancer && !nearCover(game, e)) {
    const c = coverOnRoute(game, e, st.at);
    if (c) legs.push(c);
  }
  legs.push({ ...st.at });
  st.stage = 'move'; st.legs = legs;
}

/** A spot next to solid cover roughly on the way to the threat (null = none close by). */
function coverOnRoute(game: Game, e: Unit, threat: Vec): Vec | null {
  const D = CFG.awareness.coverDist;
  const dx = threat.x - e.pos.x, dy = threat.y - e.pos.y, d = Math.hypot(dx, dy) || 1;
  if (d < 140) return null;
  let best: Vec | null = null, bs = Infinity;
  for (const o of game.world.solid) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const ox = cx - e.pos.x, oy = cy - e.pos.y;
    const along = (ox * dx + oy * dy) / d; // must be ahead of the enemy, short of the threat
    if (along < 20 || along > Math.min(d - 80, D + 80)) continue;
    const side = Math.abs(ox * dy - oy * dx) / d;
    if (side > D) continue;
    // stand on the enemy's side of the obstacle, facing the threat (the obstacle between)
    const tx = threat.x - cx, ty = threat.y - cy, tl = Math.hypot(tx, ty) || 1;
    const half = Math.abs((tx / tl) * o.w / 2) + Math.abs((ty / tl) * o.h / 2);
    const p = { x: cx - (tx / tl) * (half + 22), y: cy - (ty / tl) * (half + 22) };
    if (!game.world.isOpen(p.x, p.y)) continue;
    const score = along + side * 1.5;
    if (score < bs) { bs = score; best = p; }
  }
  return best;
}

/** Enemy sniper: a firing position at standoff range from the threat with a clear line to it. */
function sniperPost(game: Game, e: Unit, threat: Vec): Vec | null {
  const R = CFG.enemySniper.range * CFG.awareness.sniperStandoff;
  const base = Math.atan2(e.pos.y - threat.y, e.pos.x - threat.x);
  let best: Vec | null = null, bd = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 6;
    const p = { x: threat.x + Math.cos(a) * R, y: threat.y + Math.sin(a) * R };
    if (p.x < 30 || p.y < 30 || p.x > game.map.w - 30 || p.y > game.map.h - 30 || !game.world.isOpen(p.x, p.y)) continue;
    if (!game.world.clear(p, threat)) continue;
    const d = dist(p, e.pos);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Search points around the last known position (deterministic per unit). */
function searchLegs(game: Game, e: Unit, at: Vec): Vec[] {
  const S = CFG.awareness.searchSpread, out: Vec[] = [];
  const a0 = (e.id * 2.39996) % (Math.PI * 2);
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * Math.PI * 2) / 3;
    const p = { x: at.x + Math.cos(a) * S, y: at.y + Math.sin(a) * S };
    if (p.x > 30 && p.y > 30 && p.x < game.map.w - 30 && p.y < game.map.h - 30 && game.world.isOpen(p.x, p.y)) out.push(p);
  }
  return out;
}

/** Nearest squad unit this enemy can see (clear line, sight range), or null. */
function sighted(game: Game, e: Unit): Unit | null {
  const R = CFG.awareness.sightRange;
  let best: Unit | null = null, bd = R;
  for (const s of game.enemyVictims()) {
    if (!s.targetable) continue;
    const d = dist(s.pos, e.pos);
    if (d < bd && game.world.clear(e.pos, s.pos)) { bd = d; best = s; }
  }
  return best;
}

/**
 * Per-step steering for an alerted enemy without a target. Returns the point to walk toward, or null to
 * stand still. Updates the alert state (reaction delay, sight checks, legs, search, settling).
 */
export function alertSteer(game: Game, e: Unit, dt: number): Vec | null {
  const st = e.alert!, A = CFG.awareness;
  if (st.stage === 'settled') return null;
  if (st.stage === 'pending') {
    st.wait -= dt;
    if (st.wait > 0) return null;
    e.guard = false;
    plan(game, e, st);
  }
  st.t += dt;
  // sight: an alerted enemy that sees the squad updates its knowledge (and tells its group once)
  st.sightT -= dt;
  if (st.sightT <= 0) {
    st.sightT = A.sightEvery;
    const s = sighted(game, e);
    if (s) {
      const fresh = !st.seen;
      st.seen = true;
      if (dist(st.at, s.pos) > 40) { st.at = { ...s.pos }; plan(game, e, st); }
      if (fresh) raiseAlert(game, e, s.pos);
    } else st.seen = false;
  }
  if (st.stage === 'hold') {
    if (st.t >= A.searchTime) settle(e, st);
    return null;
  }
  // next leg
  while (st.legs.length) {
    const leg = st.legs[0], d = dist(e.pos, leg);
    if (d < 34) { st.legs.shift(); st.best = Infinity; st.stuck = 0; e.path = null; continue; }
    if (d < st.best - 8) { st.best = d; st.stuck = 0; } else st.stuck += dt;
    if (st.stuck > A.stuckTime) { st.legs.shift(); st.best = Infinity; st.stuck = 0; e.path = null; continue; }
    return leg;
  }
  // legs done
  if (st.stage === 'move') {
    st.t = 0;
    if (e.kind === 'sniper') { st.stage = 'hold'; return null; }
    st.stage = 'search'; st.legs = searchLegs(game, e, st.at);
    return st.legs[0] ?? null;
  }
  if (st.stage === 'search' && st.t >= A.searchTime) settle(e, st);
  else if (st.stage === 'search') st.legs = searchLegs(game, e, st.at); // keep circling until the time is up
  return null;
}

/** Search over: a dormant guard again where it stands (re-alerted by the usual triggers). */
function settle(e: Unit, st: AlertState) {
  st.stage = 'settled'; st.legs = []; e.path = null;
  e.guard = true;
}

/** Walking direction toward `goal` (A* path when the straight line is blocked). */
export function steerToward(game: Game, e: Unit, goal: Vec, dt: number): Vec | null {
  let to = goal;
  if (!game.world.passable(e.pos, goal, e.radius - 1)) {
    e.pathTimer -= dt;
    if (!e.path || e.pathTimer <= 0 || (e.path.length && dist(e.path[e.path.length - 1], goal) > 40)) {
      e.path = game.world.findPath(e.pos, goal, e.radius);
      e.pathTimer = 1.2;
    }
    if (!e.path || !e.path.length) return null;
    while (e.path.length > 1 && dist(e.pos, e.path[0]) < 12) e.path.shift();
    to = e.path[0];
  } else e.path = null;
  const dx = to.x - e.pos.x, dy = to.y - e.pos.y, d = Math.hypot(dx, dy);
  return d > 0.5 ? { x: dx / d, y: dy / d } : null;
}
