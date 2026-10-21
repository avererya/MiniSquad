// v0.8C Mission 15 boss: GENERAL VOSS. A commander, not a war machine: a rifle on a fixed cadence, three phases by HP,
// a Rally that hardens the troops around him, reinforcements once per phase and, in the last phase, the resistance
// (Mara, Elias, Tessa) arrives to help the squad. All numbers live in CFG.general.
//
// FAIRNESS (the same rules as every enemy round):
//  - He fires only from on screen, at a target he can see (clear line inside his range) and only once his aim is on
//    it; his rounds are ordinary projectiles (walls and cover stop them, they can be sidestepped). No instant damage.
//  - A new target gets a short reaction delay before his first shot; while he radios a phase's reinforcements he
//    holds fire for CFG.general.callPause s.
//
// PHASES (each transition fires exactly once and only moves forward; a big hit past both thresholds runs both, in order):
//  1. 100% -> 70%: rifle at fireRate, Rally every rallyCooldown s.
//  2. below 70%: VOSS_CALLS[0] (3 riflemen, 2 armored) through the arena gates, out of view.
//  3. below 35%: VOSS_CALLS[1] (3 riflemen, 3 armored, 1 sniper), his rifle speeds up to fireRate3, and the three
//     resistance allies arrive from the arena's entrance (off screen) and follow the squad.
// Each call is split in two groups, the second `CALL_STAGGER` s after the first, at the two nearest off-screen gates.
// The mission is never saved mid-run (an interrupted run settles as a defeat), so nothing here can be re-entered on load.
//
// RALLY: every rallyCooldown s (first after rallyFirst s) every other living enemy soldier within rallyRadius gets
// +rallyBonus weapon damage until rallyDuration s later (Unit.rallyUntil: refreshed, never stacked; read in combat.ts
// when a round is fired). Voss himself, structures, vehicles and the squad are never rallied. With nobody in reach he
// tries again 2 s later. A ring, a banner and a marker over each rallied enemy show it.
//
// On defeat the fight ends (no rout: the mission's next objective asks the squad to clear the remaining defenders).
import { CFG } from './config';
import type { Game } from './game';
import type { Unit, EnemyKind } from './unit';
import { clamp, DEG, angleDiff, dist, pointInRect, rand, turnToward, type Rect, type Vec } from './util';
import { ALLY_NAMES } from './chapter3';
import { sfx } from './audio';

const R: EnemyKind = 'rifleman', A: EnemyKind = 'armored', SN: EnemyKind = 'sniper';
/** Reinforcements per phase (spawned once each): phase 2 = 3 riflemen + 2 armored, phase 3 = 3 riflemen + 3 armored + 1 sniper. */
export const VOSS_CALLS: { phase: 2 | 3; kinds: EnemyKind[] }[] = [
  { phase: 2, kinds: [R, A, R, A, R] },
  { phase: 3, kinds: [R, A, SN, R, A, R, A] },
];
/** Seconds between the two halves of a reinforcement call. */
export const CALL_STAGGER = 6;

export class GeneralFight {
  stage: 'intro' | 'fight' | 'dead' = 'intro';
  /** Current boss phase (1-3), never lowered. */
  phase = 1;
  t = 0;
  target: Unit | null = null;
  /** Rally: seconds until the next one, how many Rallies, the last one (time, enemies rallied). */
  rallyT: number;
  rallies = 0;
  lastRally: { at: number; count: number } | null = null;
  /** Reinforcement calls made (phase numbers) and their spawned units (tests). */
  called: number[] = [];
  reinforcements: Unit[] = [];
  /** Halves still to arrive: [game.time due, phase, kinds]. */
  pending: { at: number; phase: number; kinds: EnemyKind[] }[] = [];
  alliesArrived = false;
  /** Log for tools: what happened when. */
  log: { t: number; what: string }[] = [];
  shots = 0;
  private shotT = 0;
  private react = 0;
  private hold = 0;
  private path: Vec[] | null = null;
  private pathT = 0;

  constructor(readonly unit: Unit, readonly arena: Rect, readonly gates: Vec[], readonly allyEntry: Vec[]) {
    this.rallyT = CFG.general.rallyFirst;
  }

  get hpFrac() { return clamp(this.unit.hp / this.unit.maxHp, 0, 1); }
  /** Shots per second right now. */
  get fireRate() { return this.phase >= 3 ? CFG.general.fireRate3 : CFG.general.fireRate; }
  /** Rally running on at least one enemy right now (HUD / render). */
  rallyActive(game: Game) { return !!this.lastRally && game.time - this.lastRally.at < CFG.general.rallyDuration && this.lastRally.count > 0; }

  private note(game: Game, what: string) { this.log.push({ t: +game.time.toFixed(2), what }); }

  private victims(game: Game) { return game.enemyVictims().filter((s) => s.targetable); }

  update(game: Game, dt: number) {
    const u = this.unit, G = CFG.general;
    if (this.stage === 'dead') return;
    if (!u.active) { this.defeated(game); return; }
    this.t += dt;
    u.muzzle -= dt;
    // phase transitions (forward only, each once)
    const want = this.hpFrac < G.phase3 ? 3 : this.hpFrac < G.phase2 ? 2 : 1;
    while (this.phase < want) this.enterPhase(game, ++this.phase);
    this.flushCalls(game, false);
    if (this.stage === 'intro') {
      if (this.t >= 1.5) { this.stage = 'fight'; this.note(game, 'fight'); }
      this.move(game, dt);
      return;
    }
    // Rally
    this.rallyT -= dt;
    if (this.rallyT <= 0) this.rally(game);
    // rifle
    this.hold = Math.max(0, this.hold - dt);
    this.shoot(game, dt);
    this.move(game, dt);
  }

  private enterPhase(game: Game, p: number) {
    const call = VOSS_CALLS.find((c) => c.phase === p);
    this.note(game, `phase${p}`);
    if (call && !this.called.includes(p)) {
      this.called.push(p);
      const half = Math.ceil(call.kinds.length / 2);
      this.pending.push({ at: game.time, phase: p, kinds: call.kinds.slice(0, half) }, { at: game.time + CALL_STAGGER, phase: p, kinds: call.kinds.slice(half) });
      this.hold = CFG.general.callPause; // he radios instead of shooting
      sfx('alarm');
    }
    game.mission.cue(game, p === 2 ? 'bossPhase2' : 'bossPhase3'); // v0.8C.1 his radio line (non-blocking, queued)
    if (p === 2) game.banner('VOSS CALLS FOR REINFORCEMENTS!', '#ffb347', 3);
    if (p === 3) {
      game.banner('VOSS IS DESPERATE: LAST RESERVES INBOUND!', '#ff6040', 3);
      this.alliesArrive(game);
    }
  }

  /** Spawn the reinforcement halves that are due (all of them when `all`, e.g. once Voss falls). */
  private flushCalls(game: Game, all: boolean) {
    if (!this.pending.length) return;
    const due = this.pending.filter((c) => all || game.time >= c.at - 1e-9);
    if (!due.length) return;
    this.pending = this.pending.filter((c) => !due.includes(c));
    for (const c of due) {
      const units = game.spawnGroupOffscreen(this.gates, c.kinds.length, this.reinforcements.length % 2 === 1, c.kinds);
      const tag = `voss-r${c.phase}`;
      for (const e of units) { e.tag = tag; e.guard = false; }
      game.mission.spawned.set(tag, (game.mission.spawned.get(tag) ?? 0) + units.length);
      this.reinforcements.push(...units);
      if (units[0]) game.mission.incoming.push({ pos: { ...units[0].pos }, life: 5 });
      this.note(game, `call${c.phase}:${units.length}`);
    }
  }
  /** Reinforcement halves not spawned yet (the clean-up objective waits for them). */
  get pendingCount() { return this.pending.reduce((a, c) => a + c.kinds.length, 0); }

  /** Phase 3: Mara, Elias and Tessa come in through the arena entrance (off screen) and follow the squad. */
  private alliesArrive(game: Game) {
    if (this.alliesArrived) return;
    this.alliesArrived = true;
    const c = game.anchor;
    const off = this.allyEntry.filter((p) => !game.isOnScreen(p, 60)).sort((a, b) => dist(a, c) - dist(b, c));
    const at = off[0] ?? [...this.allyEntry].sort((a, b) => dist(b, c) - dist(a, c))[0];
    ALLY_NAMES.forEach((n, i) => { const a = game.spawnAlly({ x: at.x + (i - 1) * 30, y: at.y }, n); a.post = null; });
    game.mission.incoming.push({ pos: { ...at }, life: 6 });
    game.say('THE RESISTANCE ARRIVES! Mara, Elias and Tessa join the fight', 5);
    this.note(game, 'allies');
  }

  private rally(game: Game) {
    const u = this.unit, G = CFG.general;
    const near = game.enemies.filter((e) => e !== u && e.active && !e.structure && !e.vehicle && e.kind !== 'tower' && e.team === 'enemy' && dist(e.pos, u.pos) <= G.rallyRadius);
    if (!near.length) { this.rallyT = 2; return; }
    for (const e of near) e.rallyUntil = game.time + G.rallyDuration;
    this.rallies++;
    this.lastRally = { at: game.time, count: near.length };
    this.rallyT = G.rallyCooldown;
    if (game.isOnScreen(u.pos, 120)) {
      game.fx.ring(u.pos, G.rallyRadius, 'rgba(255,150,60,0.85)', 0.7, 5);
      game.fx.text(u.pos, 'RALLY!', '#ffb347');
    }
    game.banner(`VOSS RALLIES HIS TROOPS: +${Math.round(G.rallyBonus * 100)}% DAMAGE FOR ${G.rallyDuration} s`, '#ffb347', 2.6);
    sfx('suppress');
    this.note(game, `rally:${near.length}`);
  }

  private pickTarget(game: Game): Unit | null {
    const u = this.unit, r = CFG.general.range;
    let best: Unit | null = null, bd = Infinity;
    for (const s of this.victims(game)) {
      const d = dist(u.pos, s.pos);
      if (d > r || !game.world.clear(u.pos, s.pos)) continue;
      const score = d + (s.asset ? 600 : 0);
      if (score < bd) { bd = score; best = s; }
    }
    return best;
  }

  private shoot(game: Game, dt: number) {
    const u = this.unit, G = CFG.general;
    const t = this.target;
    if (t && (!t.targetable || dist(u.pos, t.pos) > G.range || !game.world.clear(u.pos, t.pos))) this.target = null;
    if (!this.target) {
      this.target = this.pickTarget(game);
      if (this.target) this.react = G.reactionMin;
    }
    this.react = Math.max(0, this.react - dt);
    this.shotT -= dt;
    const tg = this.target;
    if (!tg) { if (this.shotT < 0) this.shotT = 0; return; }
    const desired = Math.atan2(tg.pos.y - u.pos.y, tg.pos.x - u.pos.x);
    u.aim = turnToward(u.aim, desired, G.turnRate * dt);
    if (this.shotT > 0) return;
    const ready = this.hold <= 0 && this.react <= 0 && game.isOnScreen(u.pos, -8) && Math.abs(angleDiff(u.aim, desired)) <= G.aimTolerance * DEG;
    if (!ready) { this.shotT = 0; return; }
    this.fire(game);
    this.shotT += 1 / this.fireRate;
  }

  private fire(game: Game) {
    const u = this.unit, G = CFG.general;
    const a = u.aim + rand(-G.accuracy / 2, G.accuracy / 2) * DEG;
    const dx = Math.cos(a), dy = Math.sin(a);
    game.projectiles.push({
      pos: { x: u.pos.x + dx * 14, y: u.pos.y + dy * 14 }, vel: { x: dx * G.projectileSpeed, y: dy * G.projectileSpeed },
      team: 'enemy', damage: G.damage, life: (G.range * 1.25) / G.projectileSpeed, trail: { ...u.pos }, owner: u, width: 4.5, len: 20,
    });
    u.shots++; this.shots++;
    u.muzzle = CFG.feel.muzzleFlash * 1.5;
    sfx('eshot');
  }

  /** Keep keepMin-keepMax px from the nearest soldier (close in without a clear shot), never leave the arena. */
  private move(game: Game, dt: number) {
    const u = this.unit, G = CFG.general;
    let vx = 0, vy = 0;
    const vs = this.victims(game);
    let near: Unit | null = null, nd = Infinity;
    for (const v of vs) { const d = dist(v.pos, u.pos); if (d < nd) { nd = d; near = v; } }
    if (near) {
      const los = vs.some((v) => dist(v.pos, u.pos) <= G.range && game.world.clear(u.pos, v.pos));
      const want = !los ? 1 : nd > G.keepMax ? 1 : nd < G.keepMin ? -1 : 0;
      let goal: Vec = { x: u.pos.x + ((near.pos.x - u.pos.x) / nd) * 80 * want, y: u.pos.y + ((near.pos.y - u.pos.y) / nd) * 80 * want };
      const Ar = this.arena, m = 60;
      goal = { x: clamp(goal.x, Ar.x + m, Ar.x + Ar.w - m), y: clamp(goal.y, Ar.y + m, Ar.y + Ar.h - m) };
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
    u.vel.x = vx; u.vel.y = vy;
    if (!this.target && Math.hypot(vx, vy) > 5) u.aim = turnToward(u.aim, Math.atan2(vy, vx), G.turnRate * dt);
    // hard leash: Voss never leaves his command area
    if (!pointInRect(u.pos, this.arena)) { const Ar = this.arena; u.pos.x = clamp(u.pos.x, Ar.x + 30, Ar.x + Ar.w - 30); u.pos.y = clamp(u.pos.y, Ar.y + 30, Ar.y + Ar.h - 30); }
  }

  private defeated(game: Game) {
    if (this.stage === 'dead') return;
    this.stage = 'dead';
    this.note(game, 'dead');
    this.flushCalls(game, true); // a call already radioed still arrives (the enemy budget stays exactly as designed)
    const p = this.unit.pos;
    game.fx.ring(p, 160, 'rgba(255,230,120,1)', 0.8, 9);
    game.fx.burst(p, 50, '#ffb347', 420, 0.9, 6);
    game.fx.burst(p, 20, '#4a4a4a', 200, 1.3, 9);
    game.fx.shake = Math.max(game.fx.shake, 18);
    game.mission.wrecks.push({ id: 'voss', pos: { ...p }, kind: 'voss' });
    sfx('boom');
    game.mission.emit(game, { type: 'bossDefeated', unit: this.unit });
  }
}
