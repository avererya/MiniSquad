// Squad movement: one input vector drives a virtual anchor; soldiers loosely
// steer toward their preferred offset around it, separate from each other,
// and pathfind around obstacles when the direct line to their slot is blocked.
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import { clamp, dist, lerp, type Vec } from './util';

export function squadCentre(soldiers: Unit[]): Vec | null {
  let x = 0, y = 0, n = 0;
  for (const s of soldiers) if (s.active) { x += s.pos.x; y += s.pos.y; n++; }
  return n ? { x: x / n, y: y / n } : null;
}

/** Move the anchor with collision; near an obstacle's corner, nudge sideways around it instead of snagging. */
function moveAnchor(game: Game, a: Vec, dx: number, dy: number) {
  const r = CFG.infantry.radius;
  const step = Math.hypot(dx, dy);
  if (step < 1e-6) return;
  const p = { x: a.x + dx, y: a.y + dy };
  game.world.resolveCircle(p, r);
  const progress = ((p.x - a.x) * dx + (p.y - a.y) * dy) / step;
  if (progress < step * 0.5) {
    const CORNER = 70; // only nudge when the obstacle's end is this close
    for (const o of game.world.obstacles) {
      const touching = a.x > o.x - r - 2 && a.x < o.x + o.w + r + 2 && a.y > o.y - r - 2 && a.y < o.y + o.h + r + 2;
      if (!touching) continue;
      const sideFace = a.x <= o.x || a.x >= o.x + o.w; // pushing against a left/right face
      if (sideFace && Math.abs(dx) > Math.abs(dy) * 0.5) {
        const up = a.y - (o.y - r), down = o.y + o.h + r - a.y;
        if (Math.min(up, down) < CORNER) { p.x = a.x; p.y = a.y + (up < down ? -step : step); }
      } else if (!sideFace && Math.abs(dy) > Math.abs(dx) * 0.5) {
        const left = a.x - (o.x - r), right = o.x + o.w + r - a.x;
        if (Math.min(left, right) < CORNER) { p.x = a.x + (left < right ? -step : step); p.y = a.y; }
      }
      game.world.resolveCircle(p, r);
      break;
    }
  }
  a.x = p.x; a.y = p.y;
}

export function updateSquad(game: Game, mv: Vec, dt: number) {
  const S = CFG.squad;
  const active = game.soldiers.filter((s) => s.active);
  if (!active.length) return;

  // --- anchor ---
  // Reference speed blends slowest soldier and squad average (class speeds, without
  // catch-up), so one slow Heavy Gunner doesn't drag the whole squad down to his pace.
  const base = active.map((s) => s.stats.moveSpeed * s.speedMul);
  const slowest = Math.min(...base);
  const avg = base.reduce((a, b) => a + b, 0) / base.length;
  const anchorSpeed = lerp(slowest, avg, clamp(S.anchorSpeedBlend, 0, 1)) * S.anchorSpeedFactor;
  const a = game.anchor;
  moveAnchor(game, a, mv.x * anchorSpeed * dt, mv.y * anchorSpeed * dt);
  const c = squadCentre(game.soldiers)!;
  const d = dist(a, c);
  if (d > S.leash) {
    a.x = c.x + ((a.x - c.x) / d) * S.leash;
    a.y = c.y + ((a.y - c.y) / d) * S.leash;
    game.world.resolveCircle(a, CFG.infantry.radius);
  }
  const moving = Math.hypot(mv.x, mv.y) > 0.1;
  game.squadMoving = moving;
  game.spread = lerp(game.spread, moving ? S.spreadMoving : S.spreadIdle, 1 - Math.exp(-3 * dt));

  const loose = clamp(S.looseness, 0, 1);
  const accel = S.followAccel * (1 - 0.55 * loose);

  for (const s of active) {
    // --- goal: slot around anchor, plus a little organic wander ---
    s.wander += dt;
    const solo = active.length === 1;
    const ox = solo ? 0 : s.slot[0] * S.slotSpacing * game.spread;
    const oy = solo ? 0 : s.slot[1] * S.slotSpacing * game.spread;
    const wob = loose * 12;
    let goal: Vec = {
      x: a.x + ox + Math.sin(s.wander * 0.7 + s.id * 1.7) * wob,
      y: a.y + oy + Math.cos(s.wander * 0.9 + s.id * 2.3) * wob,
    };
    if (game.world.insideObstacle(goal, s.radius) || !game.world.isOpen(goal.x, goal.y)) goal = { x: a.x, y: a.y };

    // --- catch-up: a soldier well behind his slot hurries a little (ramped, never a snap) ---
    const behind = dist(s.pos, goal) - S.catchUpDist;
    const want = 1 + Math.max(0, S.catchUpBoost) * clamp(behind / Math.max(1, S.catchUpRange), 0, 1);
    s.catchUp += (want - s.catchUp) * (1 - Math.exp(-4 * dt));

    // --- direct steer, or follow an A* path when the straight line is blocked ---
    let steerTo = goal;
    let isFinal = true;
    if (game.world.clear(s.pos, goal, s.radius - 1)) {
      s.path = null;
    } else {
      s.pathTimer -= dt;
      const stale = !s.path || s.pathTimer <= 0 || (s.path.length && dist(s.path[s.path.length - 1], goal) > 40);
      if (stale) { s.path = game.world.findPath(s.pos, goal, s.radius); s.pathTimer = 0.3; }
      if (s.path && s.path.length) {
        while (s.path.length > 1 && dist(s.pos, s.path[0]) < 10) s.path.shift();
        steerTo = s.path[0];
        isFinal = s.path.length === 1;
      }
    }

    const dx = steerTo.x - s.pos.x, dy = steerTo.y - s.pos.y;
    const dd = Math.hypot(dx, dy);
    const deadzone = 3 + loose * 12;
    let speed = s.maxSpeed;
    if (isFinal) speed *= clamp((dd - deadzone) / 45, 0, 1);
    let vx = dd > 0.01 ? (dx / dd) * speed : 0;
    let vy = dd > 0.01 ? (dy / dd) * speed : 0;

    // --- separation: never stack ---
    for (const o of active) {
      if (o === s) continue;
      const sx = s.pos.x - o.pos.x, sy = s.pos.y - o.pos.y;
      const sd = Math.hypot(sx, sy);
      if (sd < S.separationRadius && sd > 0.01) {
        const k = (1 - sd / S.separationRadius) * S.separationStrength;
        vx += (sx / sd) * k * 0.25; vy += (sy / sd) * k * 0.25;
      } else if (sd <= 0.01) { vx += Math.random() - 0.5; vy += Math.random() - 0.5; }
    }

    // --- accelerate toward desired velocity ---
    const ex = vx - s.vel.x, ey = vy - s.vel.y;
    const el = Math.hypot(ex, ey);
    const maxDv = accel * dt;
    if (el > maxDv) { s.vel.x += (ex / el) * maxDv; s.vel.y += (ey / el) * maxDv; }
    else { s.vel.x = vx; s.vel.y = vy; }
    const sp = Math.hypot(s.vel.x, s.vel.y), cap = s.maxSpeed * 1.1;
    if (sp > cap) { s.vel.x *= cap / sp; s.vel.y *= cap / sp; }
  }
}
