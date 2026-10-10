// v0.6.2 Mission 10 boss: THE IRON WARDEN. An oversized armoured machine gunner with a rocket
// launcher on his back. All numbers live in CFG.boss.
//
// ATTACKS (never two at once):
//  1. Machine-gun barrage: picks a target, WINDS UP (barrel spins, a red firing cone shows where
//     he aims) for `windup` s, then fires a sustained `burst`. During the burst the barrel can
//     only follow a moving target at `burstTurn` rad/s, so running sideways or ducking behind cover
//     (bullets stop at walls) gets you out of it. Then he rests.
//  2. Rocket: every `rocketEvery` (+/- jitter) s he stops the machine gun and shoulders the
//     launcher. A red circle appears on a soldier (the one with the most squadmates around him);
//     it FOLLOWS that soldier for `rocketTrack` s, then LOCKS in place; at `rocketWarn` s
//     (2.5 s total) the rocket lands there. Blast damage falls off to the edge; a solid obstacle
//     between the impact and a soldier blocks it (cover). The circle never tracks after the lock.
//  3. Reinforcements: once at <= 65% and once at <= 30% HP (each threshold fires exactly once,
//     even if a big hit skips past both) he calls a small mixed wave that enters through the
//     arena's north / south gates, out of view.
// Damage taken is modified by source in combat.modifyDamage (hidden Sniper weakness).
// On defeat the surviving enemies rout (stop shooting, flee and leave), so the squad can finish
// revives and extract without a surprise wipe.
import { CFG } from './config';
import type { Game } from './game';
import type { Unit, EnemyKind } from './unit';
import { angleDiff, clamp, DEG, dist, pointInRect, rand, turnToward, type Rect, type Vec } from './util';
import { sfx } from './audio';

export type BossPhase = 'intro' | 'idle' | 'windup' | 'burst' | 'rest' | 'rocket' | 'dead';
export interface Rocket { pos: Vec; t: number; target: Unit | null; locked: boolean; lockedAt: Vec | null }

/** Reinforcement calls: HP fraction threshold and the wave it brings. */
export const BOSS_CALLS: { at: number; kinds: EnemyKind[] }[] = [
  { at: 0.65, kinds: ['rifleman', 'rifleman', 'armored', 'sniper'] },
  // v0.6.2 tuning: the final call is lighter (it came while the boss was still firing and caused
  // late squad wipes in the automated sims with the boss under 7% HP)
  { at: 0.30, kinds: ['rifleman', 'rifleman', 'armored'] },
];

export class BossFight {
  phase: BossPhase = 'intro';
  t = 0;
  target: Unit | null = null;
  fireAim = Math.PI;
  shotT = 0;
  rocketT: number;
  rocket: Rocket | null = null;
  /** Thresholds already called (indices into BOSS_CALLS). */
  called: number[] = [];
  /** Log for tools: what happened when. */
  log: { t: number; what: string }[] = [];
  rockets = 0;
  bursts = 0;
  private path: Vec[] | null = null;
  private pathT = 0;
  private fightT = 0;

  constructor(readonly unit: Unit, readonly arena: Rect, readonly gates: Vec[]) {
    this.rocketT = 20; // first rocket after ~20 s (then every 21-27 s: CFG.boss.rocketEvery ± rocketJitter)
  }

  get hpFrac() { return clamp(this.unit.hp / this.unit.maxHp, 0, 1); }

  private enter(p: BossPhase, game: Game) { this.phase = p; this.t = 0; this.log.push({ t: +game.time.toFixed(2), what: p }); }

  private victims(game: Game) { return game.enemyVictims().filter((s) => s.targetable); }

  private pickTarget(game: Game): Unit | null {
    const u = this.unit, r = CFG.boss.range;
    let best: Unit | null = null, bd = Infinity;
    for (const s of this.victims(game)) {
      const d = dist(u.pos, s.pos);
      if (d > r || !game.world.clear(u.pos, s.pos)) continue;
      const score = d + (s.npc ? 400 : 0);
      if (score < bd) { bd = score; best = s; }
    }
    return best;
  }

  /** Rocket target: the soldier with the most squadmates inside the blast radius (ties: nearest). */
  private pickRocketTarget(game: Game): Unit | null {
    const u = this.unit, R = CFG.boss.rocketRadius;
    const cands = this.victims(game).filter((s) => !s.npc && dist(u.pos, s.pos) <= CFG.boss.range + 120 && game.isOnScreen(s.pos, -10));
    let best: Unit | null = null, bn = -1, bd = Infinity;
    for (const s of cands) {
      const n = cands.filter((o) => dist(o.pos, s.pos) < R).length, d = dist(u.pos, s.pos);
      if (n > bn || (n === bn && d < bd)) { best = s; bn = n; bd = d; }
    }
    return best;
  }

  update(game: Game, dt: number) {
    const u = this.unit, B = CFG.boss;
    if (this.phase === 'dead') return;
    if (!u.active) { this.defeated(game); return; }
    this.t += dt;
    this.fightT += dt;
    u.muzzle -= dt;

    // reinforcement calls (each threshold once; a big hit past both fires both, in order)
    BOSS_CALLS.forEach((c, i) => {
      if (this.hpFrac <= c.at && !this.called.includes(i)) {
        this.called.push(i);
        const half = Math.ceil(c.kinds.length / 2);
        game.mission.spawnWave(game, this.gates, half, false, c.kinds.slice(0, half));
        game.mission.spawnWave(game, this.gates, c.kinds.length - half, true, c.kinds.slice(half));
        game.banner('THE WARDEN CALLS REINFORCEMENTS!', '#ffb347', 3);
        // he radios instead of shooting: a short MG pause (a telegraphed rocket still lands)
        if (this.phase === 'idle' || this.phase === 'windup' || this.phase === 'burst' || this.phase === 'rest') {
          this.enter('rest', game); this.t = -CFG.boss.callPause;
        }
        this.log.push({ t: +game.time.toFixed(2), what: `call${Math.round(c.at * 100)}` });
        sfx('alarm');
      }
    });

    if (this.phase !== 'rocket' && this.phase !== 'intro') this.rocketT -= dt;

    switch (this.phase) {
      case 'intro':
        if (this.t >= 1.8) this.enter('idle', game);
        break;
      case 'idle': {
        if (this.rocketT <= 0 && this.startRocket(game)) break;
        this.target = this.pickTarget(game);
        if (this.target && game.isOnScreen(u.pos, -8)) {
          this.fireAim = Math.atan2(this.target.pos.y - u.pos.y, this.target.pos.x - u.pos.x);
          this.enter('windup', game);
          sfx('lock');
        }
        break;
      }
      case 'windup': {
        const t = this.target;
        // committed once the windup starts (no idle/windup flapping): ducking behind cover is the counter
        if (!t || !t.targetable) { this.enter('idle', game); break; }
        this.fireAim = turnToward(this.fireAim, Math.atan2(t.pos.y - u.pos.y, t.pos.x - u.pos.x), B.turnRate * dt);
        if (this.t >= B.windup) { this.enter('burst', game); this.shotT = 0; this.bursts++; }
        break;
      }
      case 'burst': {
        const t = this.target;
        if (t && t.targetable) this.fireAim = turnToward(this.fireAim, Math.atan2(t.pos.y - u.pos.y, t.pos.x - u.pos.x), B.burstTurn * dt);
        this.shotT -= dt;
        while (this.shotT <= 0) { this.shotT += 1 / B.fireRate; this.fire(game); }
        if (this.t >= B.burst) this.enter('rest', game);
        break;
      }
      case 'rest':
        if (this.t >= B.rest) this.enter('idle', game);
        break;
      case 'rocket':
        this.updateRocket(game, dt);
        break;
    }
    u.aim = this.phase === 'windup' || this.phase === 'burst' ? this.fireAim : this.rocket ? Math.atan2(this.rocket.pos.y - u.pos.y, this.rocket.pos.x - u.pos.x) : u.aim;
    this.move(game, dt);
  }

  private fire(game: Game) {
    const u = this.unit, B = CFG.boss;
    if (!game.isOnScreen(u.pos, -8)) return;
    const a = this.fireAim + rand(-B.accuracy / 2, B.accuracy / 2) * DEG;
    const dx = Math.cos(a), dy = Math.sin(a);
    game.projectiles.push({
      pos: { x: u.pos.x + dx * 34, y: u.pos.y + dy * 34 }, vel: { x: dx * B.projectileSpeed, y: dy * B.projectileSpeed },
      team: 'enemy', damage: B.damage, life: (B.range * 1.25) / B.projectileSpeed, trail: { ...u.pos }, owner: u, width: 4.5, len: 18,
    });
    u.shots++;
    u.muzzle = CFG.feel.muzzleFlash;
    sfx('eshot');
  }

  private startRocket(game: Game): boolean {
    const t = this.pickRocketTarget(game);
    if (!t || !game.isOnScreen(this.unit.pos, -8)) { this.rocketT = 2; return false; }
    this.rocket = { pos: { ...t.pos }, t: 0, target: t, locked: false, lockedAt: null };
    this.rockets++;
    this.enter('rocket', game);
    game.banner('ROCKET! MOVE!', '#ff4040', 1.6);
    sfx('rocket');
    return true;
  }

  private updateRocket(game: Game, dt: number) {
    const r = this.rocket, B = CFG.boss;
    if (!r) { this.enter('idle', game); return; }
    r.t += dt;
    if (!r.locked) {
      if (r.target && r.target.active) { r.pos.x = r.target.pos.x; r.pos.y = r.target.pos.y; }
      if (r.t >= B.rocketTrack) { r.locked = true; r.lockedAt = { ...r.pos }; sfx('lock'); }
    }
    if (r.t < B.rocketWarn) return;
    // impact: locked position only
    const at = r.lockedAt ?? r.pos;
    for (const s of [...game.soldiers, ...game.npcs.filter((n) => n.escorting)]) {
      if (!s.active) continue;
      const d = dist(at, s.pos);
      if (d > B.rocketRadius + s.radius) continue;
      if (!game.world.clear(at, s.pos)) continue; // cover between the blast and the soldier
      const f = Math.min(1, d / B.rocketRadius);
      game.damage(s, B.rocketDamage * (1 - f * (1 - B.rocketEdge)), this.unit, { grenade: true });
    }
    game.fx.ring(at, B.rocketRadius, 'rgba(255,120,60,0.95)', 0.45, 8);
    game.fx.burst(at, 34, '#ffb347', 420, 0.6, 6);
    game.fx.burst(at, 16, '#5a5a5a', 180, 1.0, 8);
    game.fx.shake = Math.max(game.fx.shake, 16);
    game.scorches.push({ ...at, r: B.rocketRadius * 0.5 });
    sfx('boom');
    this.log.push({ t: +game.time.toFixed(2), what: 'impact' });
    this.rocket = null;
    this.rocketT = B.rocketEvery + rand(-B.rocketJitter, B.rocketJitter);
    this.enter('rest', game);
  }

  /** Slow advance: keep ~300 px from the nearest soldier (closer when cover blocks every shot), never leave the arena, stand still while firing. */
  private move(game: Game, dt: number) {
    const u = this.unit;
    let vx = 0, vy = 0;
    if (this.phase === 'idle' || this.phase === 'rest' || this.phase === 'intro') {
      const vs = this.victims(game);
      const near = vs.sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos))[0];
      if (near) {
        const d = dist(near.pos, u.pos);
        // no clear shot at anyone (cover between): close in until he has one (he never camps behind a block)
        const los = this.victims(game).some((v) => dist(v.pos, u.pos) <= CFG.boss.range && game.world.clear(u.pos, v.pos));
        const want = !los ? 1 : d > 340 ? 1 : d < 220 ? -1 : 0;
        let goal: Vec = { x: u.pos.x + ((near.pos.x - u.pos.x) / d) * 80 * want, y: u.pos.y + ((near.pos.y - u.pos.y) / d) * 80 * want };
        const A = this.arena, m = 70;
        goal = { x: clamp(goal.x, A.x + m, A.x + A.w - m), y: clamp(goal.y, A.y + m, A.y + A.h - m) };
        if (want !== 0 && dist(goal, u.pos) > 8) {
          let steer = goal;
          if (!game.world.passable(u.pos, goal, u.radius)) {
            this.pathT -= dt;
            if (!this.path || this.pathT <= 0) { this.path = game.world.findPath(u.pos, goal, u.radius); this.pathT = 1; }
            if (this.path && this.path.length) { while (this.path.length > 1 && dist(u.pos, this.path[0]) < 12) this.path.shift(); steer = this.path[0]; }
          }
          const dx = steer.x - u.pos.x, dy = steer.y - u.pos.y, dd = Math.hypot(dx, dy) || 1;
          vx = (dx / dd) * u.maxSpeed; vy = (dy / dd) * u.maxSpeed;
        }
      }
    }
    u.vel.x = vx; u.vel.y = vy;
    // hard leash: the Warden never leaves his arena
    if (!pointInRect(u.pos, this.arena)) { const A = this.arena; u.pos.x = clamp(u.pos.x, A.x + 30, A.x + A.w - 30); u.pos.y = clamp(u.pos.y, A.y + 30, A.y + A.h - 30); }
  }

  private defeated(game: Game) {
    if (this.phase === 'dead') return;
    this.enter('dead', game);
    this.rocket = null;
    const p = this.unit.pos;
    game.fx.ring(p, 180, 'rgba(255,230,120,1)', 0.8, 10);
    game.fx.ring(p, 110, 'rgba(255,140,60,0.95)', 0.6, 8);
    game.fx.burst(p, 70, '#ffb347', 520, 1.0, 7);
    game.fx.burst(p, 30, '#4a4a4a', 220, 1.5, 10);
    game.fx.burst(p, 24, '#cfe6ff', 300, 0.8, 4);
    game.fx.shake = Math.max(game.fx.shake, 26);
    game.scorches.push({ ...p, r: 90 });
    game.mission.wrecks.push({ id: 'warden', pos: { ...p }, kind: 'warden' });
    sfx('boom');
    // survivors rout: they stop fighting and leave (no surprise wipe while extracting)
    for (const e of game.enemies) if (e.active && !e.structure && !e.vehicle && e !== this.unit) { e.routed = true; e.target = null; e.guard = false; }
    game.mission.emit(game, { type: 'bossDefeated', unit: this.unit });
    // (after the objective's own banner, so this one is what the player sees)
    game.banner('THE IRON WARDEN IS DOWN! — PROCEED TO EXTRACTION', '#7dff8a', 4.5);
  }

  /** Where the windup cone points (render): null when not winding up / firing. */
  get firingLine(): { a: number; firing: boolean } | null {
    return this.phase === 'windup' || this.phase === 'burst' ? { a: this.fireAim, firing: this.phase === 'burst' } : null;
  }
  /** Seconds left before the current burst starts (render / tests). */
  get windupLeft() { return this.phase === 'windup' ? Math.max(0, CFG.boss.windup - this.t) : 0; }
}

/** angleDiff re-export for render helpers. */
export const bossAngleDiff = angleDiff;
