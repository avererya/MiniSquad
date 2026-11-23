// v0.9D Mission 20 "THE WARLORD" (Chapter 4 finale): the WarlordHQ mission mechanic (id 'warlord'), the Warlord boss
// fight (WarlordFight) with its telegraphed mortar strikes, the scripted helicopter ambush at Extraction Alpha, the
// final push at Extraction Bravo, and the mission's objectives.
//
// FLOW. Destroy the Communications Array and the Vehicle Depot (any order; HqInstallationsObjective) -> the command
// area's lockdown gate opens and the Warlord fights (WarlordObjective, boss bar) -> reach Extraction Alpha
// (AlphaObjective: the helicopter is shot down, a guaranteed story event) -> fall back to Extraction Bravo (a
// ReachObjective; the retreat's interceptions are an AmbushDirector in the script) -> Bravo's 12 s countdown with a
// modest final push -> immediate extraction.
//
// THE WARLORD (CFG.warlord; an enemy kind of its own, isBoss: moved and fired here, boss floors, the HUD bar).
//  Phase 1 (100-70%): holds his fortified command post (posts[0]) behind sandbags, his guard beside him; mortar
//    strikes every CFG.mortar.every1 s.
//  Phase 2 (below 70%, once): radios a call (two halves, CALL_STAGGER s apart: Riflemen and two Armored Troopers from
//    the nearest off-screen call points; cut to callScale for a squad under six, as are the command guard's Riflemen
//    at the start), then RELOCATES between his posts: every relocateEvery s, or sooner when a
//    soldier closes to relocateNear px, he walks (A* path, never through walls) to the post farthest from the squad;
//    mortars every every2 s.
//  Phase 3 (below 35%, once): the final guard comes in, he stops relocating and pushes toward the squad (keepMin -
//    keepMax px, Voss's movement), rifle at fireRate3, mortars every every3 s.
//  Transitions only move forward (a big hit past both thresholds runs both in order) and never touch his HP; there is
//  no invulnerability window. He never leaves HQ_ARENA (hard leash) and his posts are open ground inside it.
//  His rifle follows Voss's rules: on screen only, a target in range with a clear line, a reaction delay, ordinary
//  projectiles that walls and cover stop.
// MORTARS. Target = the centre of the standing soldiers at that moment (snapped to open ground); a red circle of
//  CFG.mortar.radius appears there and NEVER moves; CFG.mortar.warn s later the shell lands: blastDamage (linear
//  falloff, wall cover, every hit through Game.damage: Elite caps, downs, revives, permadeath unchanged) to soldiers
//  and allies only. Fairness: one circle at a time; none before CFG.mortar.first s into the fight; a target needs at
//  least escapeDirs of 8 directions open just outside the ring (no strike on a spot without a way out; it retries
//  retry s later); none once he falls (a circle still up is cancelled). Log: launched / soldiers hit / dodged / damage.
// ON HIS DEATH every remaining enemy soldier routs (Mission 10's rule: no shooting, they flee and leave once out of
//  view; watchtowers, structures and hazards stay), pending calls are dropped, and the squad is sent to Alpha.
//
// EXTRACTION ALPHA (CFG.hq timeline, simulation time). The first soldier in HQ_ALPHA starts it ONCE: radio (Overwatch,
//  the pilot), the helicopter flies in (drawn, not a unit), a rocket soldier appears on the ridge (art only: never a
//  unit, never targetable, outside every soldier's reach), fires a visible rocket that hits the helicopter, which
//  explodes and falls into the jungle away from the squad. Nothing in it deals damage, spends support, counts as a
//  loss or touches stars. The camera leans toward the helicopter while it lasts (Mission.camFocus). At doneAt the
//  objective completes (the next primary, Bravo, is live before anything else) and the MAYDAY cinematic plays (SKIP
//  closes it; the state is already applied). The timeline runs whatever the squad does, so it can never stall.
// THE RETREAT (missions.ts HQ_RETREAT, an AmbushDirector armed by the Bravo objective): a group from the arena, one in
//  the yard, ONE route group (road, supply or flank: the first to arm spends the other two, oneRouteOnly) and one at
//  the landing clearing; Riflemen only, 18 in all on any route, bypassable.
// EXTRACTION BRAVO. The mission's real extraction zone (HQ_BRAVO). When its countdown starts the final push walks in:
//  BravoWave groups of Riflemen at `at` s, each from the nearest point of its route that is off screen and
//  CFG.hq.pushMinDist from every soldier; no generic extraction-pressure tier on top (the script sets none). The
//  helicopter lands at the end of the countdown and extraction is immediate (Mission's existing rule).
//
// Fixed step only; the only Math.random draws are findOpenNear's (spawns) and the Warlord's rifle spread, inside the
// step in a stable order. Nothing here is saved: every attempt (Retry) builds a fresh instance.
import { CFG } from './config';
import type { Game } from './game';
import type { Mission, MissionMechanic } from './mission';
import { Objective, type HudChip, type HudLine, type MissionEvent, type ObjPoint } from './objectives';
import type { EnemyKind, Unit } from './unit';
import type { MineField } from './mines';
import type { FuelDepot } from './fuel';
import type { AmbushDirector } from './urban';
import { blastDamage } from './combat';
import { squadCentre } from './squad';
import { clamp, DEG, angleDiff, dist, pointInRect, rand, turnToward, type Rect, type Vec } from './util';
import { sfx } from './audio';

const R: EnemyKind = 'rifleman', A: EnemyKind = 'armored';
/** The Warlord's radioed responses: phase 2 (7: two halves), phase 3 (the final guard, 5 at once); cut for squads under six (callScale). */
export const WARLORD_CALLS: { phase: 2 | 3; kinds: EnemyKind[]; split: boolean }[] = [
  { phase: 2, kinds: [R, R, A, R, R, A, R], split: true },
  { phase: 3, kinds: [R, R, A, R, R], split: false },
];
/** Seconds between the two halves of the phase 2 call. */
export const CALL_STAGGER = 6;
/** The retreat's route interceptions (missions.ts HQ_RETREAT): only the first to arm fires (WarlordHQ.oneRouteOnly). */
export const RETREAT_ROUTES = ['fall-road', 'fall-supply', 'fall-flank'];

export interface BravoWave { at: number; route: string; size: number; banner: string }
export interface WarlordSpec {
  /** posts[0] = the fortified command post (his spawn); the others are fall-back posts (phase 2). */
  posts: Vec[];
  arena: Rect;
  calls: Vec[];
  alpha: Rect;
  ridge: Vec;
  heliFrom: Vec;
  crash: Vec;
  bravoRoutes: Record<string, Vec[]>;
  bravoWaves: BravoWave[];
}

export interface Mortar { pos: Vec; t: number; n: number }

export class WarlordFight {
  stage: 'intro' | 'fight' | 'dead' = 'intro';
  /** Current phase (1-3), never lowered. */
  phase = 1;
  t = 0;
  target: Unit | null = null;
  /** Index of the post he holds / walks to. */
  post = 0;
  moving = false;
  relocations = 0;
  private postT = 0;
  /** The mortar circle on the ground (null = none); seconds to the next one. */
  mortar: Mortar | null = null;
  mortarT: number;
  mortars = { launched: 0, hitSoldiers: 0, dodged: 0, damage: 0, skipped: 0, cancelled: 0, perStrike: [] as { n: number; hit: number; dmg: number; at: Vec; t: number }[] };
  called: number[] = [];
  callSizes: number[] = [];
  reinforcements: Unit[] = [];
  pending: { at: number; phase: number; kinds: EnemyKind[] }[] = [];
  log: { t: number; what: string }[] = [];
  shots = 0;
  private shotT = 0;
  private react = 0;
  private hold = 0;
  private path: Vec[] | null = null;
  private pathT = 0;
  private pathGoal: Vec | null = null;

  constructor(readonly unit: Unit, readonly spec: WarlordSpec) { this.mortarT = CFG.mortar.first; }

  get hpFrac() { return clamp(this.unit.hp / this.unit.maxHp, 0, 1); }
  get fireRate() { return this.phase >= 3 ? CFG.warlord.fireRate3 : CFG.warlord.fireRate; }
  get mortarEvery() { const M = CFG.mortar; return this.phase >= 3 ? M.every3 : this.phase === 2 ? M.every2 : M.every1; }
  get pendingCount() { return this.pending.reduce((a, c) => a + c.kinds.length, 0); }
  /** Share of a full call for this squad: soldiers not KIA / 6, clamped to [0.5, 1]. */
  callScale(g: Game) { return clamp(g.soldiers.filter((x) => x.state !== 'kia').length / 6, 0.5, 1); }
  private note(g: Game, what: string) { this.log.push({ t: +g.time.toFixed(2), what }); }
  private victims(g: Game) { return g.enemyVictims().filter((s) => s.targetable); }

  update(m: Mission, g: Game, dt: number) {
    const u = this.unit, W = CFG.warlord;
    if (this.stage === 'dead') return;
    if (!u.active) { this.defeated(m, g); return; }
    this.t += dt;
    u.muzzle -= dt;
    const want = this.hpFrac < W.phase3 ? 3 : this.hpFrac < W.phase2 ? 2 : 1;
    while (this.phase < want) this.enterPhase(m, g, ++this.phase);
    this.flushCalls(m, g);
    if (this.stage === 'intro') {
      if (this.t >= 1.5) { this.stage = 'fight'; this.note(g, 'fight'); }
      u.vel.x = 0; u.vel.y = 0;
      return;
    }
    this.updateMortar(g, dt);
    this.hold = Math.max(0, this.hold - dt);
    this.shoot(g, dt);
    this.move(g, dt);
  }

  private enterPhase(m: Mission, g: Game, p: number) {
    this.note(g, `phase${p}`);
    const call = WARLORD_CALLS.find((c) => c.phase === p);
    if (call && !this.called.includes(p)) {
      this.called.push(p);
      // a squad under six (soldiers not KIA) meets a smaller call: the list cut to its share, never below half
      const kinds = call.kinds.slice(0, Math.max(1, Math.round(call.kinds.length * this.callScale(g))));
      this.callSizes.push(kinds.length);
      if (call.split) {
        const half = Math.ceil(kinds.length / 2);
        this.pending.push({ at: g.time, phase: p, kinds: kinds.slice(0, half) }, { at: g.time + CALL_STAGGER, phase: p, kinds: kinds.slice(half) });
      } else this.pending.push({ at: g.time, phase: p, kinds });
      this.hold = CFG.warlord.callPause;
      sfx('alarm');
    }
    m.cue(g, p === 2 ? 'bossPhase2' : 'bossPhase3'); // his radio line (non-blocking)
    if (p === 2) { g.banner('THE WARLORD FALLS BACK — REINFORCEMENTS INBOUND', '#ffb347', 3); this.postT = 0; this.relocate(g); }
    if (p === 3) { g.banner('THE WARLORD MAKES HIS LAST STAND', '#ff6040', 3); this.moving = false; this.path = null; }
  }

  private flushCalls(m: Mission, g: Game) {
    if (!this.pending.length) return;
    const due = this.pending.filter((c) => g.time >= c.at - 1e-9);
    if (!due.length) return;
    this.pending = this.pending.filter((c) => !due.includes(c));
    for (const c of due) {
      const units = g.spawnGroupOffscreen(this.spec.calls, c.kinds.length, this.reinforcements.length % 2 === 1, c.kinds);
      const tag = `warlord-r${c.phase}`;
      for (const e of units) { e.tag = tag; e.guard = false; e.reinforcement = true; }
      m.spawned.set(tag, (m.spawned.get(tag) ?? 0) + units.length);
      this.reinforcements.push(...units);
      if (units[0]) m.incoming.push({ pos: { ...units[0].pos }, life: 5 });
      this.note(g, `call${c.phase}:${units.length}`);
    }
  }

  // ---------------- mortar ----------------
  /** Where a strike would land now (the standing soldiers' centre on open ground), or null if none is fair. */
  mortarTarget(g: Game): Vec | null {
    const live = g.soldiers.filter((s) => s.active);
    if (!live.length) return null;
    let p: Vec = { x: live.reduce((a, s) => a + s.pos.x, 0) / live.length, y: live.reduce((a, s) => a + s.pos.y, 0) / live.length };
    if (!g.world.isOpen(p.x, p.y)) p = g.world.center(g.world.nearestOpen(g.world.idx(p.x, p.y)));
    return this.escapes(g, p) >= CFG.mortar.escapeDirs ? p : null;
  }
  /** Directions (of 8) with open, straight-line reachable ground just outside the ring around `p`. */
  escapes(g: Game, p: Vec) {
    const d = CFG.mortar.radius + 50;
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, q = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
      if (q.x > 20 && q.y > 20 && q.x < g.map.w - 20 && q.y < g.map.h - 20 && g.world.isOpen(q.x, q.y) && g.world.passable(p, q, 12)) n++;
    }
    return n;
  }
  private updateMortar(g: Game, dt: number) {
    const M = CFG.mortar;
    if (this.mortar) {
      this.mortar.t += dt;
      if (this.mortar.t + 1e-9 >= M.warn) this.impact(g);
      return;
    }
    this.mortarT -= dt;
    if (this.mortarT > 0) return;
    const p = this.mortarTarget(g);
    if (!p) { this.mortarT = M.retry; this.mortars.skipped++; return; }
    this.mortar = { pos: p, t: 0, n: ++this.mortars.launched };
    g.banner('INCOMING MORTAR! MOVE!', '#ff4040', 1.8);
    sfx('rocket');
    this.note(g, 'mortar');
  }
  private impact(g: Game) {
    const r = this.mortar!, M = CFG.mortar, at = r.pos;
    const before = new Map(g.soldiers.map((s) => [s, s.hp] as const));
    blastDamage(g, at, { radius: M.radius, damage: M.damage, edgeFrac: M.edgeFrac, victims: g.enemyVictims(), source: this.unit, cover: true, opts: { grenade: true } });
    let hit = 0, dmg = 0;
    for (const s of g.soldiers) { const d = (before.get(s) ?? s.hp) - s.hp; if (d > 0.01) { hit++; dmg += d; } }
    this.mortars.hitSoldiers += hit; this.mortars.damage += dmg;
    if (!hit) this.mortars.dodged++;
    this.mortars.perStrike.push({ n: r.n, hit, dmg: Math.round(dmg), at: { x: Math.round(at.x), y: Math.round(at.y) }, t: +g.time.toFixed(2) });
    g.fx.ring(at, M.radius, 'rgba(255,120,60,0.95)', 0.45, 8);
    g.fx.burst(at, 36, '#ffb347', 430, 0.6, 6);
    g.fx.burst(at, 18, '#5a5a5a', 190, 1.0, 8);
    g.fx.shake = Math.max(g.fx.shake, M.shake);
    g.scorches.push({ ...at, r: M.radius * 0.45 });
    sfx('boom');
    this.mortar = null;
    this.mortarT = Math.max(1, this.mortarEvery - M.warn); // circle-to-circle cadence = mortarEvery
  }

  // ---------------- rifle ----------------
  private pickTarget(g: Game): Unit | null {
    const u = this.unit, r = CFG.warlord.range;
    let best: Unit | null = null, bd = Infinity;
    for (const s of this.victims(g)) {
      const d = dist(u.pos, s.pos);
      if (d > r || !g.world.clear(u.pos, s.pos)) continue;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  private shoot(g: Game, dt: number) {
    const u = this.unit, W = CFG.warlord;
    const t = this.target;
    if (t && (!t.targetable || dist(u.pos, t.pos) > W.range || !g.world.clear(u.pos, t.pos))) this.target = null;
    if (!this.target) { this.target = this.pickTarget(g); if (this.target) this.react = W.reactionMin; }
    this.react = Math.max(0, this.react - dt);
    this.shotT -= dt;
    const tg = this.target;
    if (!tg) { if (this.shotT < 0) this.shotT = 0; return; }
    const desired = Math.atan2(tg.pos.y - u.pos.y, tg.pos.x - u.pos.x);
    u.aim = turnToward(u.aim, desired, W.turnRate * dt);
    if (this.shotT > 0) return;
    const ready = this.hold <= 0 && this.react <= 0 && g.isOnScreen(u.pos, -8) && Math.abs(angleDiff(u.aim, desired)) <= W.aimTolerance * DEG;
    if (!ready) { this.shotT = 0; return; }
    const a = u.aim + rand(-W.accuracy / 2, W.accuracy / 2) * DEG, dx = Math.cos(a), dy = Math.sin(a);
    g.projectiles.push({
      pos: { x: u.pos.x + dx * 14, y: u.pos.y + dy * 14 }, vel: { x: dx * W.projectileSpeed, y: dy * W.projectileSpeed },
      team: 'enemy', damage: W.damage, life: (W.range * 1.25) / W.projectileSpeed, trail: { ...u.pos }, owner: u, width: 4.5, len: 20,
    });
    u.shots++; this.shots++;
    u.muzzle = CFG.feel.muzzleFlash * 1.5;
    sfx('eshot');
    this.shotT += 1 / this.fireRate;
  }

  // ---------------- movement ----------------
  /** Phase 2: walk to the post farthest from the squad (never the current one). */
  private relocate(g: Game) {
    const c = squadCentre(g.soldiers) ?? this.unit.pos, P = this.spec.posts;
    let best = this.post, bd = -1;
    for (let i = 0; i < P.length; i++) { if (i === this.post) continue; const d = dist(P[i], c); if (d > bd) { bd = d; best = i; } }
    this.post = best; this.moving = true; this.path = null; this.relocations++;
    this.note(g, `relocate:${best}`);
  }
  private steerTo(g: Game, goal: Vec, dt: number, speed: number) {
    const u = this.unit;
    let steer = goal;
    if (!g.world.passable(u.pos, goal, u.radius)) {
      this.pathT -= dt;
      if (!this.path || this.pathT <= 0 || !this.pathGoal || dist(this.pathGoal, goal) > 40) { this.path = g.world.findPath(u.pos, goal, u.radius); this.pathT = 1; this.pathGoal = { ...goal }; }
      if (this.path && this.path.length) { while (this.path.length > 1 && dist(u.pos, this.path[0]) < 14) this.path.shift(); steer = this.path[0]; }
    }
    const dx = steer.x - u.pos.x, dy = steer.y - u.pos.y, dd = Math.hypot(dx, dy) || 1;
    u.vel.x = (dx / dd) * speed; u.vel.y = (dy / dd) * speed;
  }
  private move(g: Game, dt: number) {
    const u = this.unit, W = CFG.warlord;
    u.vel.x = 0; u.vel.y = 0;
    const vs = this.victims(g);
    let near: Unit | null = null, nd = Infinity;
    for (const v of vs) { const d = dist(v.pos, u.pos); if (d < nd) { nd = d; near = v; } }
    if (this.phase === 1) {
      const p = this.spec.posts[0];
      if (dist(u.pos, p) > 10) this.steerTo(g, p, dt, u.maxSpeed * 0.6);
    } else if (this.phase === 2) {
      this.postT += dt;
      if (!this.moving && (this.postT >= W.relocateEvery || nd < W.relocateNear)) { this.postT = 0; this.relocate(g); }
      const p = this.spec.posts[this.post];
      if (dist(u.pos, p) > 12) this.steerTo(g, p, dt, u.maxSpeed);
      else if (this.moving) { this.moving = false; this.postT = 0; this.note(g, `post:${this.post}`); }
    } else if (near) {
      // phase 3: Voss's pursuit (close in without a clear shot, keep keepMin-keepMax px from the nearest soldier)
      const los = vs.some((v) => dist(v.pos, u.pos) <= W.range && g.world.clear(u.pos, v.pos));
      const want = !los ? 1 : nd > W.keepMax ? 1 : nd < W.keepMin ? -1 : 0;
      if (want !== 0) {
        const Ar = this.spec.arena, mg = 60;
        const goal = { x: clamp(u.pos.x + ((near.pos.x - u.pos.x) / nd) * 80 * want, Ar.x + mg, Ar.x + Ar.w - mg), y: clamp(u.pos.y + ((near.pos.y - u.pos.y) / nd) * 80 * want, Ar.y + mg, Ar.y + Ar.h - mg) };
        if (dist(goal, u.pos) > 8) this.steerTo(g, goal, dt, u.maxSpeed);
      }
    }
    if (!this.target && Math.hypot(u.vel.x, u.vel.y) > 5) u.aim = turnToward(u.aim, Math.atan2(u.vel.y, u.vel.x), W.turnRate * dt);
    const Ar = this.spec.arena;
    if (!pointInRect(u.pos, Ar)) { u.pos.x = clamp(u.pos.x, Ar.x + 30, Ar.x + Ar.w - 30); u.pos.y = clamp(u.pos.y, Ar.y + 30, Ar.y + Ar.h - 30); }
  }

  private defeated(m: Mission, g: Game) {
    if (this.stage === 'dead') return;
    this.stage = 'dead';
    this.note(g, 'dead');
    if (this.mortar) { this.mortar = null; this.mortars.cancelled++; } // no mortar after he falls
    this.pending = []; // a call not yet arrived never comes
    const p = this.unit.pos;
    g.fx.ring(p, 180, 'rgba(255,230,120,1)', 0.8, 10);
    g.fx.burst(p, 60, '#ffb347', 480, 1.0, 7);
    g.fx.burst(p, 26, '#4a4a4a', 220, 1.4, 10);
    g.fx.shake = Math.max(g.fx.shake, 22);
    g.scorches.push({ ...p, r: 70 });
    m.wrecks.push({ id: 'warlord', pos: { ...p }, kind: 'warlord' });
    sfx('boom');
    // his troops break: every enemy soldier routs (watchtowers, structures and hazards stay)
    for (const e of g.enemies) if (e.active && !e.structure && !e.vehicle && !e.fixed && e !== this.unit) { e.routed = true; e.target = null; e.guard = false; }
    m.emit(g, { type: 'bossDefeated', unit: this.unit });
    g.banner('THE WARLORD IS DEAD — HIS TROOPS ARE BREAKING', '#7dff8a', 4);
  }
}

export type AlphaStage = 'idle' | 'inbound' | 'hit' | 'crashed' | 'done';

export class WarlordHQ implements MissionMechanic {
  readonly id = 'warlord';
  fight: WarlordFight | null = null;
  /** Alpha's scripted ambush: stage, seconds since it began (-1 = not yet), when it began. */
  alpha: AlphaStage = 'idle';
  alphaT = -1;
  alphaAt = -1;
  /** Bravo's final push: when the countdown started (-1 = not yet), groups sent, units. */
  pushAt = -1;
  pushFired = 0;
  readonly pushUnits: Unit[] = [];
  private intelCued = false;
  log: { alpha: { stage: string; t: number }[]; push: { i: number; t: number; route: string; n: number; at: Vec; minDist: number; onScreen: boolean }[]; damageDuringAlpha: number } = { alpha: [], push: [], damageDuringAlpha: 0 };
  private hpAtAlpha = 0;

  constructor(readonly spec: WarlordSpec) {}

  /** A squad deployed under six meets a thinner command guard: Riflemen of the `cmd-*` groups set aside, by share. */
  start(_m: Mission, g: Game) {
    const n = g.soldiers.length;
    if (n >= 6) return;
    const R = g.enemies.filter((e) => /^cmd-/.test(e.tag ?? '') && e.kind === 'rifleman');
    const drop = Math.round(R.length * (1 - clamp(n / 6, 0.5, 1)));
    const out = new Set(R.slice(0, drop));
    g.enemies = g.enemies.filter((e) => !out.has(e));
    this.guardsDropped = out.size;
  }
  guardsDropped = 0;

  /** The Warlord enters (once) at his command post: the boss bar shows, the intro cinematic plays. */
  startFight(m: Mission, g: Game) {
    if (this.fight) return;
    const u = g.spawnEnemy({ ...this.spec.posts[0] }, 'warlord');
    u.label = 'THE WARLORD'; u.tag = 'warlord'; u.guard = false; u.aim = Math.PI;
    this.fight = new WarlordFight(u, this.spec);
    g.banner('THE WARLORD', '#ff7a5a', 3);
    m.cue(g, 'bossIntro');
  }

  step(m: Mission, g: Game, dt: number) {
    this.fight?.update(m, g, dt);
    this.oneRouteOnly(m, g);
    if (this.alpha !== 'idle' && this.alpha !== 'done') this.updateAlpha(m, g, dt);
    if (this.pushAt < 0 && m.phase === 'countdown') { this.pushAt = g.time; m.cue(g, 'cue:bravo'); }
    if (this.pushAt >= 0) {
      const t = g.time - this.pushAt, W = this.spec.bravoWaves;
      while (this.pushFired < W.length && t + 1e-9 >= W[this.pushFired].at) this.pushWave(m, g, this.pushFired++);
      if (!this.intelCued && m.phase === 'countdown' && m.extraction.timeLeft() <= 7) { this.intelCued = true; m.cue(g, 'cue:intel'); }
    }
  }

  /** The retreat meets one route interception only: the first of the road / supply / flank groups to arm spends the other two. */
  private oneRouteOnly(m: Mission, g: Game) {
    const d = m.mechanic<AmbushDirector>('ambush');
    if (!d || this.routeFall) return;
    const armed = RETREAT_ROUTES.find((id) => (d.state(id)?.armedAt ?? -1) >= 0);
    if (!armed) return;
    this.routeFall = armed;
    for (const id of RETREAT_ROUTES) { const st = d.state(id); if (id !== armed && st && st.armedAt < 0) { st.armedAt = g.time; st.sprungAt = g.time; } }
  }
  routeFall: string | null = null;

  // ---------------- Extraction Alpha ----------------
  beginAlpha(m: Mission, g: Game) {
    if (this.alpha !== 'idle') return;
    this.alpha = 'inbound'; this.alphaT = 0; this.alphaAt = g.time;
    this.hpAtAlpha = this.squadHp(g);
    this.log.alpha.push({ stage: 'inbound', t: g.time });
    m.cue(g, 'cue:alpha');
    g.banner('EXTRACTION ALPHA — HELICOPTER INBOUND', '#7dff8a', 3);
  }
  private squadHp(g: Game) { return [...g.soldiers, ...g.allies].reduce((a, s) => a + Math.max(0, s.hp), 0); }
  private updateAlpha(m: Mission, g: Game, dt: number) {
    const H = CFG.hq, was = this.alphaT;
    this.alphaT += dt;
    const t = this.alphaT, crossed = (at: number) => was < at - 1e-9 && t + 1e-9 >= at;
    if (crossed(H.shooterAt)) { g.banner('ROCKET INBOUND!', '#ff3030', 2.2); sfx('lock'); }
    if (crossed(H.fireAt)) sfx('rocket');
    if (crossed(H.hitAt)) {
      this.alpha = 'hit'; this.log.alpha.push({ stage: 'hit', t: g.time });
      const p = this.heliPos(H.hitAt);
      g.fx.ring(p.pos, 120, 'rgba(255,220,120,1)', 0.6, 9);
      g.fx.burst({ x: p.pos.x, y: p.pos.y - p.alt }, 70, '#ffb347', 520, 1.0, 7);
      g.fx.burst({ x: p.pos.x, y: p.pos.y - p.alt }, 30, '#3a3a3a', 260, 1.6, 10);
      g.fx.shake = Math.max(g.fx.shake, 22);
      sfx('boom');
    }
    if (crossed(H.crashAt)) {
      this.alpha = 'crashed'; this.log.alpha.push({ stage: 'crashed', t: g.time });
      const c = this.spec.crash;
      g.fx.ring(c, 150, 'rgba(255,160,70,1)', 0.7, 10);
      g.fx.burst(c, 80, '#ff9a3a', 560, 1.1, 8);
      g.fx.burst(c, 40, '#2e2e2e', 260, 2.0, 12);
      g.fx.shake = Math.max(g.fx.shake, 26);
      g.scorches.push({ ...c, r: 90 });
      sfx('boom');
    }
    // the camera leans toward the helicopter while it is in the air (presentation; the squad keeps control)
    m.camFocus = t < H.crashAt + 0.4 ? (t < H.hitAt ? { x: (this.heliPos(t).pos.x + this.spec.ridge.x) / 2, y: (this.heliPos(t).pos.y + this.spec.ridge.y) / 2 } : this.spec.crash) : null;
    if (t + 1e-9 >= H.doneAt) {
      this.alpha = 'done'; m.camFocus = null;
      this.log.alpha.push({ stage: 'done', t: g.time });
      this.log.damageDuringAlpha = Math.max(0, this.hpAtAlpha - this.squadHp(g));
    }
  }
  /** Alpha: the pad's centre. */
  get pad(): Vec { const z = this.spec.alpha; return { x: z.x + z.w / 2, y: z.y + z.h / 2 }; }
  /**
   * Where the first helicopter is `t` s into the Alpha sequence (ground point + drawn altitude, heading, spin):
   * flying in on an eased path toward the pad until hitAt, then falling and spinning onto the crash site by crashAt.
   */
  heliPos(t: number): { pos: Vec; alt: number; spin: number; down: number } {
    const H = CFG.hq, F = this.spec.heliFrom, P = { x: this.pad.x - 40, y: this.pad.y - 20 };
    const along = (s: number) => { const k = clamp(s / H.heliTime, 0, 1), e = 1 - (1 - k) ** 2.2; return { x: F.x + (P.x - F.x) * e, y: F.y + (P.y - F.y) * e, alt: 120 * (1 - e) + 46 }; };
    if (t < H.hitAt) { const p = along(t); return { pos: { x: p.x, y: p.y }, alt: p.alt, spin: 0, down: 0 }; }
    const h = along(H.hitAt), C = this.spec.crash, k = clamp((t - H.hitAt) / (H.crashAt - H.hitAt), 0, 1);
    return { pos: { x: h.x + (C.x - h.x) * k, y: h.y + (C.y - h.y) * k }, alt: h.alt * (1 - k * k), spin: k * 9, down: k };
  }
  /** Alpha: the rocket's position `t` s into the sequence (null when not in flight). */
  rocketPos(t: number): Vec | null {
    const H = CFG.hq;
    if (t < H.fireAt || t >= H.hitAt) return null;
    const k = (t - H.fireAt) / (H.hitAt - H.fireAt), to = this.heliPos(H.hitAt), S = this.spec.ridge;
    const tx = to.pos.x, ty = to.pos.y - to.alt, sy = S.y - 24;
    return { x: S.x + (tx - S.x) * k, y: sy + (ty - sy) * k - Math.sin(k * Math.PI) * 40 };
  }

  // ---------------- Extraction Bravo ----------------
  private pushWave(m: Mission, g: Game, i: number) {
    const w = this.spec.bravoWaves[i], pts = this.spec.bravoRoutes[w.route] ?? [];
    if (!pts.length) return;
    const friends = [...g.soldiers, ...g.allies].filter((s) => s.state === 'active' || s.state === 'downed');
    const far = (p: Vec) => friends.every((s) => dist(s.pos, p) >= CFG.hq.pushMinDist);
    const at = pts.find((p) => !g.isOnScreen(p, 80) && far(p)) ?? pts[pts.length - 1];
    for (let k = 0; k < w.size; k++) {
      const e = g.spawnEnemy(g.findOpenNear(at, 60), 'rifleman');
      e.reinforcement = true; e.guard = false; e.tag = `bravo-${i + 1}`;
      this.pushUnits.push(e);
    }
    m.spawned.set(`bravo-${i + 1}`, w.size);
    m.incoming.push({ pos: { ...at }, life: 5 });
    this.log.push.push({ i, t: +(g.time - this.pushAt).toFixed(2), route: w.route, n: w.size, at: { ...at }, minDist: Math.round(Math.min(...friends.map((s) => dist(s.pos, at)), 1e9)), onScreen: g.isOnScreen(at, 0) });
    g.banner(w.banner, i === this.spec.bravoWaves.length - 1 ? '#ff5a4a' : '#ff7a5a', 2.6);
    sfx('alarm');
  }

  // ---------------- drawing ----------------
  /** Ground: Alpha's pad (live while it is the objective, scorched once the helicopter is lost). */
  draw(ctx: CanvasRenderingContext2D, m: Mission, g: Game) {
    const z = this.spec.alpha, cx = z.x + z.w / 2, cy = z.y + z.h / 2;
    const live = m.currentObjective?.id === 'alpha' && this.alpha !== 'crashed' && this.alpha !== 'done';
    const lost = this.alpha === 'crashed' || this.alpha === 'done';
    const pulse = live ? 0.5 + 0.5 * Math.sin(g.clock * 5) : 0;
    ctx.fillStyle = live ? `rgba(120,255,140,${0.1 + pulse * 0.14})` : lost ? 'rgba(120,30,20,0.22)' : 'rgba(80,80,80,0.15)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = live ? '#7dff8a' : lost ? 'rgba(255,90,70,0.6)' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = live ? 4 : 2;
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 50px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lost ? 'X' : 'A', cx, cy + 2);
    ctx.textBaseline = 'alphabetic';
  }

  /** Above the scene (over the canopy): the mortar circle, the helicopter, the rocket and its shooter, the wreck. */
  drawAbove(ctx: CanvasRenderingContext2D, _m: Mission, g: Game) {
    const f = this.fight;
    if (f?.mortar) drawMortar(ctx, f.mortar, g.clock);
    if (this.alpha === 'idle') return;
    const H = CFG.hq, t = this.alphaT;
    if (t >= H.crashAt || this.alpha === 'done') drawCrashSite(ctx, this.spec.crash, g.clock);
    if (t < H.crashAt) drawHeli(ctx, this.heliPos(t), g.clock, t >= H.hitAt);
    if (t >= H.shooterAt - 0.2 && t < H.doneAt) drawRidgeShooter(ctx, this.spec.ridge, t - H.shooterAt, t >= H.fireAt);
    const rp = this.rocketPos(t);
    if (rp) drawRocket(ctx, rp, this.heliPos(H.hitAt), t);
  }
}

// ---------------- drawings (pure; render-time flicker from game.clock only) ----------------
function drawMortar(ctx: CanvasRenderingContext2D, r: Mortar, clock: number) {
  const M = CFG.mortar, R = M.radius, k = clamp(r.t / M.warn, 0, 1), p = r.pos;
  const blink = 0.5 + 0.5 * Math.sin(clock * (k > 0.66 ? 26 : 12));
  ctx.fillStyle = `rgba(255,30,20,${0.14 + 0.18 * k})`;
  ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(255,40,20,${0.22 + 0.16 * blink})`;
  ctx.beginPath(); ctx.arc(p.x, p.y, R * k, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = k > 0.66 ? (blink > 0.5 ? '#ffffff' : '#ff2a1a') : '#ff3a2a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x - 18, p.y); ctx.lineTo(p.x + 18, p.y); ctx.moveTo(p.x, p.y - 18); ctx.lineTo(p.x, p.y + 18); ctx.stroke();
  const left = Math.max(0, M.warn - r.t);
  ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = '#000'; ctx.fillText(left.toFixed(1), p.x + 2, p.y - R - 10);
  ctx.fillStyle = '#ff4a3a'; ctx.fillText(left.toFixed(1), p.x, p.y - R - 12);
  if (k > 0.72) { // the shell coming down
    const h = (1 - k) / 0.28 * 260;
    ctx.fillStyle = '#2f2f2f'; ctx.fillRect(p.x - 4, p.y - h - 22, 8, 20);
    ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(p.x, p.y - h - 24, 5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHeli(ctx: CanvasRenderingContext2D, h: { pos: Vec; alt: number; spin: number; down: number }, clock: number, burning: boolean) {
  const x = h.pos.x, y = h.pos.y;
  ctx.fillStyle = `rgba(0,0,0,${0.25 * (1 - h.down * 0.5)})`;
  ctx.beginPath(); ctx.ellipse(x, y + 10, 50, 17, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(x, y - h.alt);
  ctx.rotate(h.spin);
  ctx.fillStyle = burning ? '#3a3a2e' : '#4c5a3a';
  ctx.fillRect(10, -6, 72, 10); ctx.fillRect(76, -18, 8, 20);
  ctx.beginPath(); ctx.ellipse(0, 0, 42, 23, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = burning ? '#ff8a3a' : '#9fd3e6';
  ctx.beginPath(); ctx.ellipse(-22, -4, 14, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-26, 25); ctx.lineTo(26, 25); ctx.stroke();
  ctx.fillStyle = '#e8e8e8'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BIRD 1', 4, 6);
  const rot = clock * (burning ? 12 : 30);
  ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 4;
  for (let i = 0; i < 2; i++) { const a = rot + (i * Math.PI) / 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * -72, Math.sin(a) * -22 - 25); ctx.lineTo(Math.cos(a) * 72, Math.sin(a) * 22 - 25); ctx.stroke(); }
  if (burning) {
    for (let k = 0; k < 5; k++) {
      const fl = 0.5 + 0.5 * Math.sin(clock * 20 + k * 1.7);
      ctx.fillStyle = k % 2 ? `rgba(255,200,80,${0.6 + 0.3 * fl})` : `rgba(255,90,30,${0.6 + 0.3 * fl})`;
      ctx.beginPath(); ctx.arc(-10 + k * 14, -16 - fl * 10, 9 + fl * 6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  if (burning) { // smoke trail
    for (let k = 0; k < 6; k++) { ctx.fillStyle = `rgba(40,40,40,${0.35 - k * 0.05})`; ctx.beginPath(); ctx.arc(x + 20 + k * 22, y - h.alt - 30 - k * 14, 14 + k * 5, 0, Math.PI * 2); ctx.fill(); }
  }
}

function drawRidgeShooter(ctx: CanvasRenderingContext2D, p: Vec, s: number, fired: boolean) {
  // a rocky outcrop on the ridge (art; the jungle around it is canopy) and the rocket soldier kneeling on it
  ctx.fillStyle = '#5a5246'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 8, 62, 24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6d6455'; ctx.beginPath(); ctx.ellipse(p.x - 6, p.y + 2, 46, 16, 0, 0, Math.PI * 2); ctx.fill();
  const a = clamp(s / 0.3 + 1, 0, 1);
  ctx.globalAlpha = a;
  ctx.fillStyle = '#3a2f26'; ctx.fillRect(p.x - 7, p.y - 30, 14, 26); // body
  ctx.fillStyle = '#c0281e'; ctx.fillRect(p.x - 8, p.y - 40, 16, 7); // red headband
  ctx.fillStyle = '#d9b08c'; ctx.beginPath(); ctx.arc(p.x, p.y - 36, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4b5a2a'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(p.x + 14, p.y - 34); ctx.lineTo(p.x - 26, p.y - 16); ctx.stroke(); // launcher
  if (fired && s < 1.0) { ctx.fillStyle = 'rgba(255,200,90,0.85)'; ctx.beginPath(); ctx.arc(p.x - 30, p.y - 14, 12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(160,160,160,0.6)'; ctx.beginPath(); ctx.arc(p.x + 22, p.y - 38, 16, 0, Math.PI * 2); ctx.fill(); }
  if (!fired) { ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#000'; ctx.fillText('!', p.x + 2, p.y - 54); ctx.fillStyle = '#ff3a2a'; ctx.fillText('!', p.x, p.y - 56); }
  ctx.globalAlpha = 1;
}

function drawRocket(ctx: CanvasRenderingContext2D, p: Vec, to: { pos: Vec; alt: number }, t: number) {
  const dx = to.pos.x - p.x, dy = to.pos.y - to.alt - p.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  for (let k = 1; k <= 6; k++) { ctx.fillStyle = `rgba(200,200,200,${0.4 - k * 0.055})`; ctx.beginPath(); ctx.arc(p.x - ux * k * 16, p.y - uy * k * 16, 5 + k * 2, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(p.x - ux * 18, p.y - uy * 18); ctx.lineTo(p.x, p.y); ctx.stroke();
  ctx.fillStyle = Math.sin(t * 60) > 0 ? '#ffe08a' : '#ff8a3a'; ctx.beginPath(); ctx.arc(p.x - ux * 20, p.y - uy * 20, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c0281e'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
}

function drawCrashSite(ctx: CanvasRenderingContext2D, c: Vec, clock: number) {
  ctx.fillStyle = 'rgba(20,15,10,0.6)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 70, 30, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f3328'; ctx.save(); ctx.translate(c.x, c.y - 6); ctx.rotate(0.5); ctx.fillRect(-34, -12, 60, 22); ctx.fillRect(20, -4, 46, 7); ctx.restore();
  for (let k = 0; k < 4; k++) {
    const fl = 0.5 + 0.5 * Math.sin(clock * 14 + k * 2.1);
    ctx.fillStyle = k % 2 ? `rgba(255,190,70,${0.55 + 0.3 * fl})` : `rgba(255,90,30,${0.55 + 0.3 * fl})`;
    ctx.beginPath(); ctx.arc(c.x - 24 + k * 16, c.y - 16 - fl * 12, 9 + fl * 5, 0, Math.PI * 2); ctx.fill();
  }
  for (let k = 0; k < 5; k++) {
    const ph = (clock * 0.5 + k / 5) % 1;
    ctx.fillStyle = `rgba(45,45,45,${0.45 * (1 - ph)})`;
    ctx.beginPath(); ctx.arc(c.x + Math.sin(clock + k) * 10 + ph * 40, c.y - 40 - ph * 160, 14 + ph * 26, 0, Math.PI * 2); ctx.fill();
  }
}

// =====================================================================================
// Objectives
// =====================================================================================
const mech = (m: Mission) => m.mechanic<WarlordHQ>('warlord');

export interface InstallationDef { pos: Vec; kind: string; label: string; short: string; cue: string }
/** Destroy both installations (any order); both down opens the command-area gate (Mission.openGate, once). */
export class HqInstallationsObjective extends Objective {
  targets: Unit[] = [];
  constructor(id: string, label: string, readonly defs: InstallationDef[]) { super(id, label); this.phase = 'destroy'; }
  protected onStart(_m: Mission, g: Game) {
    this.targets = this.defs.map((d) => {
      const t = g.spawnEnemy(d.pos);
      t.structure = d.kind; t.objective = true; t.guard = true; t.setMaxHp(CFG.hq.installationHp); t.tag = `${this.id}-target`; t.label = d.label;
      return t;
    });
  }
  get left() { return this.targets.filter((t) => t.active).length; }
  onEvent(m: Mission, g: Game, ev: MissionEvent) {
    if (this.state !== 'active' || ev.type !== 'structureDestroyed') return;
    const i = this.targets.indexOf(ev.unit);
    if (i < 0) return;
    const p = ev.unit.pos, d = this.defs[i];
    m.wrecks.push({ id: `${this.id}-${i}`, pos: { ...p }, kind: d.kind });
    g.fx.ring(p, 130, 'rgba(255,200,90,0.95)', 0.5, 7);
    g.fx.burst(p, 44, '#ffb347', 430, 0.7, 6);
    g.fx.burst(p, 22, '#555', 180, 1.1, 8);
    g.fx.shake = Math.max(g.fx.shake, 16);
    g.scorches.push({ ...p, r: 60 });
    sfx('boom');
    m.cue(g, d.cue as `cue:${string}`);
    if (this.left > 0) { g.banner(`${d.label} DESTROYED — 1 INSTALLATION LEFT`, '#7dff8a', 2.8); return; }
    m.openGate(g, 'BOTH INSTALLATIONS DOWN — THE COMMAND AREA GATE IS OPEN');
    this.complete(m, g);
  }
  chips(): HudChip[] { return this.targets.map((t, i) => ({ label: this.defs[i].short, frac: t.active ? clamp(t.hp / t.maxHp, 0, 1) : 0, state: t.active ? 'live' : 'done' })); }
  hud(): HudLine { return { text: `${this.label} · ${this.targets.length - this.left}/${this.targets.length}`, sub: 'Any order · the command area stays locked until both are down', chips: this.chips() }; }
  point(_m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const t = this.targets.filter((x) => x.active).sort((a, b) => dist(a.pos, c) - dist(b.pos, c))[0];
    return t ? { pos: t.pos, label: this.defs[this.targets.indexOf(t)].short, color: '#ffd84a' } : null;
  }
}

/** The Warlord enters when this starts; completes when he falls. */
export class WarlordObjective extends Objective {
  constructor(id: string, label: string) { super(id, label); this.phase = 'boss'; }
  protected onStart(m: Mission, g: Game) { mech(m)?.startFight(m, g); }
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'bossDefeated' && ev.unit === mech(m)?.fight?.unit) this.complete(m, g); }
  hud(m: Mission): HudLine {
    const f = mech(m)?.fight;
    if (!f) return { text: this.label };
    const sub = f.mortar ? 'INCOMING MORTAR: get the squad out of the red circle!'
      : f.pendingCount > 0 ? 'His reinforcements are coming in'
      : f.phase >= 3 ? 'Last stand: he is coming for you. Keep moving and finish him'
      : f.phase === 2 ? (f.moving ? 'He is falling back to another post: chase him down' : 'He holds a fall-back post. Mortars come faster')
      : 'He fights from his command post. Watch for red mortar circles';
    return { text: this.label, sub };
  }
  point(m: Mission): ObjPoint | null { const u = mech(m)?.fight?.unit; return u && u.active ? { pos: u.pos, label: 'WARLORD', color: '#ff7a5a' } : null; }
}

/** Reach Extraction Alpha: the first soldier in the zone starts the (scripted) pickup; completes when Alpha is lost. */
export class AlphaObjective extends Objective {
  constructor(id: string, label: string, readonly zone: Rect) { super(id, label); this.phase = 'alpha'; }
  update(m: Mission, g: Game) {
    const x = mech(m);
    if (this.state !== 'active' || !x) return;
    if (x.alpha === 'idle' && g.soldiers.some((s) => s.active && pointInRect(s.pos, this.zone))) x.beginAlpha(m, g);
    if (x.alpha === 'done') this.complete(m, g);
  }
  hud(m: Mission): HudLine {
    const x = mech(m), H = CFG.hq;
    if (!x || x.alpha === 'idle') return { text: this.label, sub: 'The helicopter meets you at the landing zone north-east of the command area' };
    if (x.alpha === 'inbound') return { text: 'Extraction Alpha: helicopter inbound', sub: x.alphaT >= H.shooterAt ? 'ROCKET INBOUND!' : 'Stand by for pickup', progress: clamp(x.alphaT / H.hitAt, 0, 1) };
    return { text: 'BIRD ONE IS DOWN', sub: 'Stand by: Overwatch is redirecting extraction' };
  }
  point(): ObjPoint { const z = this.zone; return { pos: { x: z.x + z.w / 2, y: z.y + z.h / 2 }, label: 'ALPHA', color: '#7dff8a' }; }
}

/** Optional: enemies killed by mine or fuel blasts (set off by anyone) reach `need`. */
export class HazardKillsOptional extends Objective {
  constructor(id: string, label: string, readonly need: number) { super(id, label); }
  kills(m: Mission) { return (m.mechanic<MineField>('mines')?.log.enemyKills ?? 0) + (m.mechanic<FuelDepot>('fuel')?.log.enemyKills ?? 0); }
  update(m: Mission, g: Game) { if (this.state === 'active' && this.kills(m) >= this.need) this.complete(m, g); }
  finalize(m: Mission, g: Game) { if (this.state === 'active') this.fail(m, g); }
  status(m: Mission): string { return this.state === 'complete' ? 'DONE' : this.state === 'failed' ? 'FAILED' : `${Math.min(this.need, this.kills(m))}/${this.need}`; }
}

/** Optional: destroy every watchtower of the headquarters (tag), any time. */
export class TowersOptional extends Objective {
  total = 0;
  standing = 0;
  constructor(id: string, label: string, readonly tag: string) { super(id, label); }
  private towers(g: Game) { return g.enemies.filter((e) => e.kind === 'tower' && e.tag === this.tag); }
  protected onStart(_m: Mission, g: Game) { this.total = this.standing = this.towers(g).length; }
  update(m: Mission, g: Game) {
    if (this.state !== 'active') return;
    this.standing = this.towers(g).filter((e) => e.active).length;
    if (this.total > 0 && this.standing === 0) this.complete(m, g);
  }
  finalize(m: Mission, g: Game) { if (this.state === 'active') this.fail(m, g); }
  status(m: Mission): string { return this.state === 'active' ? `${this.total - this.standing}/${this.total}` : super.status(m); }
}
