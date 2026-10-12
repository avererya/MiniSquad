// v0.8A MISSION 12 ARTILLERY + SPOTLIGHTS ("Artillery Hunt").
//
// RULES (numbers in CFG.artillery, live-tunable)
//  - Spotlights sweep on fixed, deterministic arcs (simulation time; no Math.random). A squad soldier or
//    resistance ally is LIT when inside a beam (beamRange, +-beamHalf deg of its direction) with a clear line
//    from the lamp. The squad's EXPOSURE builds while anyone is lit and drains `exposureDecay` times faster
//    when nobody is: about 1 s (CFG.artillery.exposure) of continuous light raises the ARTILLERY ALERT, a
//    quick dash across a beam never does. Exposure shows as a meter on the objective HUD and a ring on the
//    lit soldier.
//  - ONLY spotlights raise it. Enemy group awareness (awareness.ts), guards spotting the squad and firefights
//    never touch it, and nothing here alerts enemies either.
//  - While alerted: a red danger circle is placed at the LAST DETECTED position (where the light last saw the
//    squad; fixed: it never follows anyone) and the shell lands `warn` (2.5) s later. A new shell is placed
//    every `interval` s (alternating interval - 1 / + 1: 10 / 12), at most `maxMarkers` (2) circles at once.
//    Impact: `damage` (40) to every squad soldier and ally inside `radius`, falling to `edge` x at the rim;
//    x `coverMul` (0.4: -60%) when solid cover is between the impact and the soldier (world.clear). Enemies are
//    never hurt (no friendly fire).
//  - The alert clears after `clearAfter` (20) s without spotlight detection. Once raised it stays on the record
//    for this attempt (the optional objective "no artillery alert" fails at once).
//  - Destroying a gun silences it for good; with all three gone the artillery is disabled: pending circles are
//    cancelled and nothing can be fired again (the spotlights keep sweeping).
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import { DEG, angleDiff, clamp, dist, type Vec } from './util';
import { sfx } from './audio';

export interface SpotlightDef { pos: Vec; /** centre direction (rad) */ dir: number; /** half sweep (rad) */ sweep: number; /** s per full sweep */ period: number; phase: number }
export interface Marker { pos: Vec; left: number; total: number }

export class Artillery {
  exposure = 0;
  alerted = false;
  /** An alert was raised at some point this attempt (optional objective). */
  everAlerted = false;
  alerts = 0;
  lastSeen: Vec | null = null;
  lastSeenAt = -1;
  markers: Marker[] = [];
  shells = 0;
  impacts = 0;
  /** Seconds to the next shell while alerted. */
  private shellT = 0;
  disabled = false;
  /** Squad units lit this step (render ring). */
  lit = new Set<Unit>();
  constructor(readonly lights: SpotlightDef[], readonly guns: () => Unit[]) {}

  /** Beam direction of light `i` at simulation time `t`. */
  angle(i: number, t: number) {
    const L = this.lights[i];
    return L.dir + L.sweep * Math.sin((t / L.period) * Math.PI * 2 + L.phase);
  }

  /** Is the point inside light i's beam with a clear line (no exposure through walls)? */
  inBeam(game: Game, i: number, p: Vec): boolean {
    const A = CFG.artillery, L = this.lights[i];
    const d = dist(L.pos, p);
    if (d > A.beamRange || d < 4) return false;
    const a = Math.atan2(p.y - L.pos.y, p.x - L.pos.x);
    if (Math.abs(angleDiff(this.angle(i, game.time), a)) > A.beamHalf * DEG) return false;
    return game.world.clear(L.pos, p);
  }

  get gunsLeft() { return this.guns().filter((g) => g.active).length; }

  update(game: Game, dt: number) {
    const A = CFG.artillery;
    // silenced for good once every gun is down
    if (!this.disabled && this.guns().length && this.gunsLeft === 0) {
      this.disabled = true; this.alerted = false; this.markers = []; this.exposure = 0;
      game.banner('ALL ARTILLERY SILENCED', '#7dff8a', 3);
    }
    for (const gun of this.guns()) if (gun.muzzle > 0) gun.muzzle -= dt;
    // spotlights
    this.lit.clear();
    let sx = 0, sy = 0;
    for (const u of [...game.soldiers, ...game.allies]) {
      if (!u.active) continue;
      for (let i = 0; i < this.lights.length; i++) if (this.inBeam(game, i, u.pos)) { this.lit.add(u); sx += u.pos.x; sy += u.pos.y; break; }
    }
    if (this.disabled) { this.exposure = 0; return; }
    if (this.lit.size) {
      this.exposure = Math.min(A.exposure, this.exposure + dt);
      if (this.exposure >= A.exposure) {
        this.lastSeen = { x: sx / this.lit.size, y: sy / this.lit.size };
        this.lastSeenAt = game.time;
        if (!this.alerted) {
          this.alerted = true; this.everAlerted = true; this.alerts++;
          this.shellT = 0; // the first circle goes down at once
          game.banner('SPOTTED — ARTILLERY INCOMING! KEEP MOVING', '#ff5040', 3);
          sfx('siren');
        }
      }
    } else this.exposure = Math.max(0, this.exposure - dt * A.exposureDecay);

    if (this.alerted && game.time - this.lastSeenAt >= A.clearAfter) {
      this.alerted = false;
      game.banner('ARTILLERY ALERT CLEARED', '#7dff8a', 2.5);
    }
    // shells already marked land even if the alert clears meanwhile (the circle is a promise)
    for (const m of this.markers) {
      m.left -= dt;
      if (m.left <= 0) this.impact(game, m.pos);
    }
    this.markers = this.markers.filter((m) => m.left > 0);
    if (!this.alerted) return;
    this.shellT -= dt;
    if (this.shellT <= 0 && this.lastSeen && this.markers.length < A.maxMarkers) {
      this.markers.push({ pos: { ...this.lastSeen }, left: A.warn, total: A.warn });
      this.shells++;
      this.shellT = A.interval + (this.shells % 2 ? -1 : 1); // 10 / 12 s
      sfx('lock');
      const gun = this.guns().filter((g) => g.active).sort((a, b) => dist(a.pos, this.lastSeen!) - dist(b.pos, this.lastSeen!))[0];
      if (gun) { game.fx.burst({ x: gun.pos.x, y: gun.pos.y - 30 }, 10, '#ffd38a', 200, 0.3, 4); gun.muzzle = 0.25; }
    }
  }

  /** Shell lands: squad + allies only (no friendly fire), cover -60%. */
  private impact(game: Game, p: Vec) {
    const A = CFG.artillery;
    this.impacts++;
    for (const u of [...game.soldiers, ...game.allies]) {
      if (!u.active) continue;
      const d = dist(p, u.pos);
      if (d > A.radius + u.radius) continue;
      const f = clamp(d / A.radius, 0, 1);
      const covered = !game.world.clear(p, u.pos);
      game.damage(u, A.damage * (1 - f * (1 - A.edge)) * (covered ? A.coverMul : 1), undefined, { grenade: true });
    }
    game.fx.ring(p, A.radius, 'rgba(255,170,90,0.95)', 0.4, 7);
    game.fx.burst(p, 34, '#ffb347', 420, 0.5, 6);
    game.fx.burst(p, 18, '#5a5a5a', 170, 0.9, 8);
    game.fx.shake = Math.max(game.fx.shake, 14);
    game.scorches.push({ ...p, r: A.radius * 0.4 });
    sfx('boom');
  }

  /** Ground layer: danger circles (filling as the shell comes in). */
  drawGround(ctx: CanvasRenderingContext2D, game: Game) {
    const A = CFG.artillery;
    for (const m of this.markers) {
      const k = 1 - m.left / m.total, pulse = 0.5 + 0.5 * Math.sin(game.clock * (10 + 14 * k));
      ctx.fillStyle = `rgba(255,40,30,${0.12 + 0.18 * k})`;
      ctx.beginPath(); ctx.ellipse(m.pos.x, m.pos.y, A.radius, A.radius * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,60,40,${0.25 + 0.2 * pulse})`;
      ctx.beginPath(); ctx.ellipse(m.pos.x, m.pos.y, A.radius * k, A.radius * 0.8 * k, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,70,50,${0.7 + 0.3 * pulse})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(m.pos.x, m.pos.y, A.radius, A.radius * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,180,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(m.pos.x - 14, m.pos.y); ctx.lineTo(m.pos.x + 14, m.pos.y); ctx.moveTo(m.pos.x, m.pos.y - 11); ctx.lineTo(m.pos.x, m.pos.y + 11); ctx.stroke();
    }
  }

  /** Over the night darkness: beams, lamps, rings on lit soldiers. */
  drawLights(ctx: CanvasRenderingContext2D, game: Game) {
    const A = CFG.artillery;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      if (Math.abs(L.pos.x - game.cam.x) > 1100 || Math.abs(L.pos.y - game.cam.y) > 800) continue;
      const a = this.angle(i, game.time), h = A.beamHalf * DEG;
      const g = ctx.createRadialGradient(L.pos.x, L.pos.y, 10, L.pos.x, L.pos.y, A.beamRange);
      const hot = this.alerted && !this.disabled;
      g.addColorStop(0, hot ? 'rgba(255,170,150,0.42)' : 'rgba(255,245,190,0.4)');
      g.addColorStop(1, 'rgba(255,245,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(L.pos.x, L.pos.y); ctx.arc(L.pos.x, L.pos.y, A.beamRange, a - h, a + h); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    for (const L of this.lights) {
      ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(L.pos.x, L.pos.y + 14); ctx.lineTo(L.pos.x, L.pos.y - 26); ctx.stroke();
      ctx.fillStyle = '#3a3a3a'; ctx.fillRect(L.pos.x - 10, L.pos.y - 34, 20, 12);
      ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(L.pos.x, L.pos.y - 28, 5, 0, Math.PI * 2); ctx.fill();
    }
    const f = this.exposure / Math.max(0.01, A.exposure);
    for (const u of this.lit) {
      ctx.strokeStyle = `rgba(255,${Math.round(220 - 160 * f)},60,0.95)`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(u.pos.x, u.pos.y, 22, 10, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.stroke();
    }
  }
}
