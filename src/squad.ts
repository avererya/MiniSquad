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

  // --- revive assist: with the squad anchor near a downed soldier (or captive), the nearest
  // standing soldier steps up to them so the revive starts reliably (still player-driven:
  // the player has to bring the squad there; leaving the area cancels the assist) ---
  const assist = new Map<Unit, Vec>();
  const R = CFG.revive;
  for (const d of [...game.soldiers, ...game.npcs]) {
    if (d.state !== 'downed' || dist(a, d.pos) > R.assistRadius) continue;
    let best: Unit | null = null;
    for (const s of active) if (!assist.has(s) && (!best || dist(s.pos, d.pos) < dist(best.pos, d.pos))) best = s;
    if (!best) break;
    const dd = dist(best.pos, d.pos);
    const k = dd > 1 ? Math.min(1, (R.radius * 0.45) / dd) : 0;
    assist.set(best, { x: d.pos.x + (best.pos.x - d.pos.x) * k, y: d.pos.y + (best.pos.y - d.pos.y) * k });
  }

  // --- v0.6.2 protective escort formation (Missions 5 and 7): with a freed captive standing, the
  // captive walks at the anchor and the soldiers hold a ring around it, the ring's front facing
  // the movement direction (or, when stopped, the nearest visible threat) ---
  const vip = game.npcs.find((n) => n.escorting && n.active) ?? null;
  const ring = vip ? escortRing(game, active, mv, moving, dt) : null;

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
    if (ring) {
      const slot = ring.get(s);
      if (slot) goal = slot;
    }
    if (game.world.insideObstacle(goal, s.radius) || !game.world.isOpen(goal.x, goal.y)) goal = { x: a.x, y: a.y };
    const rv = assist.get(s);
    if (rv) goal = rv;

    // --- catch-up: a soldier well behind his slot hurries a little (ramped, never a snap) ---
    const behind = dist(s.pos, goal) - S.catchUpDist;
    const want = 1 + Math.max(0, S.catchUpBoost) * clamp(behind / Math.max(1, S.catchUpRange), 0, 1);
    s.catchUp += (want - s.catchUp) * (1 - Math.exp(-4 * dt));

    // --- direct steer, or follow an A* path when the straight line is blocked ---
    let steerTo = goal;
    let isFinal = true;
    if (game.world.passable(s.pos, goal, s.radius - 1)) {
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

/** Ring slot angles (relative to the facing) for n soldiers: front-first, evenly spread. */
export function ringAngles(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  if (n === 2) return [-0.9, 0.9]; // front-left / front-right: the captive between / slightly behind the pair
  // 3: triangle; 4: front, left, rear, right; 5-6: a fuller perimeter (one soldier always straight ahead)
  const step = (Math.PI * 2) / n;
  return Array.from({ length: n }, (_, i) => i * step).map((x) => Math.atan2(Math.sin(x), Math.cos(x)));
}

/**
 * v0.6.2 protective formation: goal per soldier on a ring around the anchor (the captive walks at
 * the anchor). Slots are reassigned only when the number of standing soldiers changes (nearest
 * free slot, so nobody crosses through the VIP); the facing turns smoothly. A slot blocked by an
 * obstacle pulls in toward the centre.
 */
function escortRing(game: Game, active: Unit[], mv: Vec, moving: boolean, dt: number): Map<Unit, Vec> {
  const E = CFG.escort, a = game.anchor, F = game.formation;
  let want = F.heading;
  if (moving) want = Math.atan2(mv.y, mv.x);
  else {
    let best: Unit | null = null, bd = 520;
    for (const e of game.enemies) {
      if (!e.active || e.structure || e.vehicle || e.routed) continue;
      const d = dist(e.pos, a);
      if (d < bd && game.world.clear(a, e.pos)) { bd = d; best = e; }
    }
    if (best) want = Math.atan2(best.pos.y - a.y, best.pos.x - a.x);
  }
  let diff = want - F.heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  F.heading += diff * (1 - Math.exp(-(moving ? 5 : 3) * dt));
  const angles = ringAngles(active.length);
  const key = active.map((s) => s.id).join(',');
  if (key !== F.key) {
    // (re)assign: each soldier takes the free slot nearest to where they stand
    F.key = key; F.slots.clear();
    const free = angles.map((_, i) => i);
    const R0 = moving ? E.ringMoving : E.ringIdle;
    for (const s of [...active].sort((p, q) => p.id - q.id)) {
      let bi = 0, bd = Infinity;
      for (const [j, i] of free.entries()) {
        const t = F.heading + angles[i];
        const d = Math.hypot(a.x + Math.cos(t) * R0 - s.pos.x, a.y + Math.sin(t) * R0 - s.pos.y);
        if (d < bd) { bd = d; bi = j; }
      }
      F.slots.set(s.id, free.splice(bi, 1)[0]);
    }
  }
  const R = (moving ? E.ringMoving : E.ringIdle) + Math.max(0, active.length - 4) * 6;
  const out = new Map<Unit, Vec>();
  for (const s of active) {
    const t = F.heading + angles[F.slots.get(s.id) ?? 0];
    let g: Vec = { x: a.x + Math.cos(t) * R, y: a.y + Math.sin(t) * R };
    if (game.world.insideObstacle(g, s.radius) || !game.world.isOpen(g.x, g.y)) g = { x: a.x + Math.cos(t) * R * 0.5, y: a.y + Math.sin(t) * R * 0.5 };
    out.set(s, g);
  }
  return out;
}

/**
 * Escorted captive: walks at the squad anchor (v0.6.2: the centre of the protective ring; it
 * trailed at CFG.escort.followDist before), pathing around
 * obstacles with the same A* as the soldiers, hurrying when left behind. Safety net: if it
 * makes no progress toward a far goal for 4 s it is moved next to the squad (counted in
 * game.escortRescues, reported by tools/campaign.cjs). A held or downed captive stays put.
 */
export function updateEscort(game: Game, n: Unit, dt: number) {
  if (!n.escorting || !n.active) { n.vel.x = 0; n.vel.y = 0; return; }
  const a = game.anchor;
  const away = dist(n.pos, a);
  // v0.6.2: the captive walks at the centre of the squad's protective ring (the anchor)
  let goal: Vec = { ...a };
  if (!game.world.isOpen(goal.x, goal.y) || game.world.insideObstacle(goal, n.radius)) goal = { ...a };
  const want = 1 + 0.4 * clamp((away - 160) / 160, 0, 1);
  n.catchUp += (want - n.catchUp) * (1 - Math.exp(-4 * dt));

  let steer = goal;
  let isFinal = true;
  if (game.world.passable(n.pos, goal, n.radius - 1)) n.path = null;
  else {
    n.pathTimer -= dt;
    if (!n.path || n.pathTimer <= 0) { n.path = game.world.findPath(n.pos, goal, n.radius); n.pathTimer = 0.3; }
    if (n.path && n.path.length) {
      while (n.path.length > 1 && dist(n.pos, n.path[0]) < 10) n.path.shift();
      steer = n.path[0];
      isFinal = n.path.length === 1;
    }
  }
  const dx = steer.x - n.pos.x, dy = steer.y - n.pos.y, dd = Math.hypot(dx, dy);
  let speed = n.maxSpeed;
  if (isFinal) speed *= clamp((dd - 6) / 40, 0, 1);
  let vx = dd > 0.01 ? (dx / dd) * speed : 0, vy = dd > 0.01 ? (dy / dd) * speed : 0;
  for (const o of game.soldiers) {
    if (!o.active) continue;
    const sx = n.pos.x - o.pos.x, sy = n.pos.y - o.pos.y, sd = Math.hypot(sx, sy);
    if (sd < CFG.squad.separationRadius && sd > 0.01) { const k = (1 - sd / CFG.squad.separationRadius) * CFG.squad.separationStrength * 0.25; vx += (sx / sd) * k; vy += (sy / sd) * k; }
  }
  const ex = vx - n.vel.x, ey = vy - n.vel.y, el = Math.hypot(ex, ey), maxDv = 1200 * dt;
  if (el > maxDv) { n.vel.x += (ex / el) * maxDv; n.vel.y += (ey / el) * maxDv; } else { n.vel.x = vx; n.vel.y = vy; }

  // stuck safety net
  // (actual displacement since the last step, so pushing against a wall counts as stuck)
  const far = dist(n.pos, goal) > 90;
  const moved = n.prevPos ? dist(n.pos, n.prevPos) / Math.max(1e-6, dt) : 999;
  n.prevPos = { ...n.pos };
  n.stuckT = far && moved < 20 ? n.stuckT + dt : Math.max(0, n.stuckT - dt * 2);
  if (n.stuckT > 1.5 && n.path) n.pathTimer = 0;
  if (n.stuckT > 4) {
    const p = game.findOpenNear(a, 50);
    n.pos.x = p.x; n.pos.y = p.y; n.vel.x = 0; n.vel.y = 0; n.path = null; n.stuckT = 0;
    game.escortRescues++;
  }
}
