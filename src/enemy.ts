// Enemy Rifleman AI: individual, uncoordinated. Pursue via flow field,
// shoot the nearest visible soldier in range. Two temperaments:
// "stop and shoot" halts while it has a target; "advance while firing"
// keeps closing in (and eats the movement accuracy penalty).
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import { dist } from './util';

export function updateEnemyMovement(game: Game, e: Unit, dt: number) {
  const E = CFG.enemy;
  if (e.guard) {
    const near = game.soldiers.some((s) => s.active && dist(s.pos, e.pos) < (e.aggro ?? E.aggroRadius));
    if (near || e.hp < e.maxHp) e.guard = false;
  }

  let wantMove = !e.guard;
  if (wantMove && e.target) {
    if (!e.advancer) wantMove = false;
    else if (dist(e.pos, e.target.pos) < E.range * E.advanceMinDist) wantMove = false;
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

  // separation from other riflemen
  for (const o of game.enemies) {
    if (o === e || !o.active) continue;
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
