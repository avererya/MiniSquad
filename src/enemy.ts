// Enemy Rifleman AI: individual, uncoordinated. Pursue via flow field,
// shoot the nearest visible soldier in range. Two temperaments:
// "stop and shoot" halts while it has a target; "advance while firing"
// keeps closing in (and eats the movement accuracy penalty).
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import { dist, type Vec } from './util';
import { alertSteer, raiseAlert, steerToward } from './awareness';

// v0.6.2 kinds: Snipers hold back at long range; Armored Troopers always advance on the nearest
// (frontline) soldier; convoy escorts walk with their truck until soldiers come close; tower
// guards, trucks and the boss are moved elsewhere (fixed / convoy / boss controllers).
export function updateEnemyMovement(game: Game, e: Unit, dt: number) {
  const E = e.stats as typeof CFG.enemy;
  if (e.routed) {
    // flee away from the squad
    const c = game.soldiers.find((s) => s.active)?.pos ?? game.cam;
    const dx = e.pos.x - c.x, dy = e.pos.y - c.y, d = Math.hypot(dx, dy) || 1;
    let gx = e.pos.x + (dx / d) * 120, gy = e.pos.y + (dy / d) * 120;
    if (!game.world.passable(e.pos, { x: gx, y: gy }, e.radius)) { gx = e.pos.x - (dy / d) * 120; gy = e.pos.y + (dx / d) * 120; }
    const vx = gx - e.pos.x, vy = gy - e.pos.y, vl = Math.hypot(vx, vy) || 1;
    e.vel.x = (vx / vl) * e.maxSpeed * 1.2; e.vel.y = (vy / vl) * e.maxSpeed * 1.2;
    return;
  }
  // v0.8B roadblock: hold this spot on the road (still turns and fires; updateWeapon)
  if (e.holdPos) {
    const dx = e.holdPos.x - e.pos.x, dy = e.holdPos.y - e.pos.y, d = Math.hypot(dx, dy);
    steer(game, e, d > 24 ? { x: (dx / d) * e.maxSpeed, y: (dy / d) * e.maxSpeed } : { x: 0, y: 0 }, dt);
    return;
  }
  if (e.guard) {
    const R = e.aggro ?? E.aggroRadius;
    let near: Unit | null = null;
    for (const s of game.soldiers) if (s.active && dist(s.pos, e.pos) < R) { near = s; break; }
    if (near) {
      // v0.8A: a guard that detects the squad alerts its group (awareness.ts) and engages at once
      if (game.phase === 'playing' && !e.escortOf) raiseAlert(game, e, near.pos);
      e.guard = false;
    } else if (e.hp < e.maxHp && !e.alert) e.guard = false; // hit without awareness (escorts): wakes as before
  }

  // v0.8A group awareness: an alerted enemy with nobody in its sights investigates instead of homing in
  const st = e.alert;
  if (st && st.stage !== 'settled' && !e.escortOf) {
    if (!e.target) {
      const goal = alertSteer(game, e, dt);
      const dir = goal ? steerToward(game, e, goal, dt) : null;
      // armored troopers push straight in, everyone else a little more carefully
      const sp = e.maxSpeed * (e.kind === 'armored' || !dir ? 1 : 0.9);
      steer(game, e, dir ? { x: dir.x * sp, y: dir.y * sp } : { x: 0, y: 0 }, dt);
      return;
    }
    if (st.stage === 'pending') alertSteer(game, e, dt); // in a fight already: the reaction delay still runs out
  }

  let wantMove = !e.guard;
  if (wantMove && e.target) {
    if (!e.advancer) wantMove = false;
    else if (dist(e.pos, e.target.pos) < E.range * E.advanceMinDist) wantMove = false;
  }
  if (wantMove && e.kind === 'sniper') {
    // a sniper never walks into close quarters: it stops once anyone is inside 80% of its range
    if (game.soldiers.some((s) => s.active && dist(s.pos, e.pos) < E.range * 0.8)) wantMove = false;
  }
  // convoy escort: keep pace with the truck while the squad is far away
  const truck = e.escortOf && e.escortOf.active ? e.escortOf : null;
  if (truck && !e.guard && !e.target && e.hp >= e.maxHp && !game.soldiers.some((s) => s.active && dist(s.pos, e.pos) < 430)) {
    const goal = { x: truck.pos.x + e.escortOffset.x, y: truck.pos.y + e.escortOffset.y };
    const dx = goal.x - e.pos.x, dy = goal.y - e.pos.y, d = Math.hypot(dx, dy);
    const sp = d > 6 ? Math.min(e.maxSpeed, Math.max(truck.maxSpeed, d * 1.5)) : 0;
    const vx = d > 6 ? (dx / d) * sp : 0, vy = d > 6 ? (dy / d) * sp : 0;
    const k = 1 - Math.exp(-6 * dt);
    e.vel.x += (vx - e.vel.x) * k; e.vel.y += (vy - e.vel.y) * k;
    return;
  }

  let vx = 0, vy = 0;
  if (wantMove) {
    const t = game.world.flowTarget(e.pos, e.radius);
    if (t) {
      const dx = t.x - e.pos.x, dy = t.y - e.pos.y;
      const d = Math.hypot(dx, dy);
      // don't walk into the squad: stop at a polite distance if they have no target yet
      const closest = Math.min(...game.soldiers.filter((s) => s.active).map((s) => dist(s.pos, e.pos)), Infinity);
      if (d > 0.5 && closest > 40) {
        vx = (dx / d) * e.maxSpeed;
        vy = (dy / d) * e.maxSpeed;
      }
    }
  }

  steer(game, e, { x: vx, y: vy }, dt);
}

/** Separation from other enemies + acceleration-limited velocity change toward `want`. */
function steer(game: Game, e: Unit, want: Vec, dt: number) {
  let vx = want.x, vy = want.y;
  // separation from other riflemen
  for (const o of game.enemies) {
    if (o === e || !o.active || o.vehicle || o.structure) continue;
    const sx = e.pos.x - o.pos.x, sy = e.pos.y - o.pos.y;
    const sd = Math.hypot(sx, sy);
    if (sd < 40 && sd > 0.01) {
      const k = (1 - sd / 40) * 160;
      vx += (sx / sd) * k; vy += (sy / sd) * k;
    }
  }

  const accel = 700 * dt;
  const ex = vx - e.vel.x, ey = vy - e.vel.y;
  const el = Math.hypot(ex, ey);
  if (el > accel) { e.vel.x += (ex / el) * accel; e.vel.y += (ey / el) * accel; }
  else { e.vel.x = vx; e.vel.y = vy; }
}
