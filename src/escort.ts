// v0.8B VEHICLE ESCORT SYSTEMS (Mission 14 "Supply Line Sabotage"; built to be reused by later escort missions).
//
//  - EscortVehicle: a friendly truck (Game asset 'truck', CFG.escortTruck) that drives a fixed road route with no
//    driving UI. It follows the squad's progress ALONG THE ROAD: it rolls up to CFG.escortTruck.behind px behind the
//    squad's position projected on the route, and waits when the squad stops, falls behind it or leaves the road
//    (> maxOff px). Before every step it checks the road ahead of its front bumper (lookahead px, its own width):
//    an enemy body there is a ROADBLOCK (it stops; the gun keeps firing; it resumes on its own once the road is
//    clear and the squad is ahead); a soldier / ally there makes it yield (never runs anyone over), and a friendly
//    who keeps standing in the way for yieldNudge s while the squad is ahead steps aside. Enemies firing from the
//    sides never stop it. Kinematic on a route that keeps clear of every obstacle (tools/chapter3b.cjs checks it),
//    so it can't get stuck on terrain; it pushes bodies beside it out like a structure. Damage is ordinary
//    Game.damage (fixed step: identical at 30 / 60 FPS); there is no healing, repair or regeneration.
//  - MountedGun: the truck's machine gun. Fixed stats (CFG.mountedGun) whoever mans it: no class, level, training,
//    trait or Elite modifier; automatic nearest visible enemy, wide cone (wider while the truck moves), no friendly
//    fire. The gunner is a deployed soldier who leaves the formation and can't use their weapon or ability while
//    mounted; if they are downed the gun goes silent for the rest of the mission (no remount, no reassignment) and
//    they lie beside the truck for the normal revive. Gunner choice: Game.chooseGunner (any standing soldier or none).
//  - Wreck: a destroyed truck fails the mission after a short aftermath (Mission.aftermath): the gunner is thrown
//    clear DOWNED (never killed outright), both sides hold fire, and the mission waits while anyone downed can be
//    revived (see Mission.startAftermath). Failure then follows the established rule (whoever is still downed is KIA).
//  - ProgressAmbushes: finite ambushes keyed to the truck's distance along the route (never time), each once, with
//    a warning and a short delay; groups can hold the road (roadblock) or prefer the truck (hunters).
import { CFG } from './config';
import type { Game } from './game';
import type { Mission } from './mission';
import type { Unit, EnemyKind } from './unit';
import { MultiDestroyObjective, Objective, type HudChip, type HudLine, type ObjPoint } from './objectives';
import { DEG, angleDiff, clamp, dist, rand, turnToward, type Vec } from './util';
import { squadCentre } from './squad';
import { VehicleHunterTargeting } from './targeting';
import { assetMeter, footSoldiers } from './defense';
import { sfx } from './audio';

export type TruckState = 'parked' | 'waiting' | 'moving' | 'roadblock' | 'yield' | 'offroad' | 'arrived' | 'wrecked';

export class EscortVehicle {
  unit: Unit | null = null;
  readonly len: number[];
  readonly total: number;
  /** Distance travelled along the route (px) and current speed (px/s). */
  s = 0;
  v = 0;
  state: TruckState = 'parked';
  gun: MountedGun;
  /** Seconds a friendly has been blocking while the squad is ahead (yield nudge). */
  private yieldT = 0;
  /** Roadblocks seen (each announced once). */
  roadblocks = 0;
  private blockedPrev = false;
  /** Times a friendly had to step aside (should stay rare). */
  nudges = 0;
  /** Squad progress along the route at the last step (tests / HUD). */
  squadS = 0;
  squadOff = 0;
  constructor(readonly route: Vec[]) {
    this.len = [0];
    for (let i = 1; i < route.length; i++) this.len.push(this.len[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y));
    this.total = this.len[this.len.length - 1];
    this.gun = new MountedGun(this);
  }

  /** Point and heading at distance s along the route. */
  at(s: number): { p: Vec; a: number } {
    const R = this.route;
    s = clamp(s, 0, this.total);
    let i = 1;
    while (i < R.length - 1 && this.len[i] < s) i++;
    const a = R[i - 1], b = R[i], seg = this.len[i] - this.len[i - 1] || 1, k = (s - this.len[i - 1]) / seg;
    return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /** Closest route position to p within [lo, hi]: distance along the route and distance from it. */
  project(p: Vec, lo = 0, hi = this.total): { s: number; d: number } {
    let best = { s: lo, d: Infinity };
    for (let i = 1; i < this.route.length; i++) {
      const s0 = this.len[i - 1], s1 = this.len[i];
      if (s1 < lo || s0 > hi) continue;
      const a = this.route[i - 1], b = this.route[i], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
      t = clamp(t, (lo - s0) / (s1 - s0 || 1), (hi - s0) / (s1 - s0 || 1));
      t = clamp(t, 0, 1);
      const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best.d) best = { s: s0 + t * (s1 - s0), d };
    }
    return best;
  }

  /** The parked truck (not targetable until captured). */
  spawn(g: Game) {
    if (this.unit) return;
    const { p, a } = this.at(0);
    const u = g.spawnAsset('truck', p, 'SUPPLY TRUCK');
    u.aim = a; u.live = false;
    this.unit = u;
  }
  /** Captured: the enemy can now attack it; it waits for the escort to start. */
  capture() { if (this.unit) { this.unit.live = true; this.state = 'waiting'; } }
  get live() { return !!this.unit && this.unit.live && this.unit.active && this.state !== 'parked' && this.state !== 'wrecked'; }
  get moving() { return this.state === 'moving'; }
  /** Gunner seat on the cargo bed (behind the truck centre). */
  seat(): Vec { const u = this.unit!; return { x: u.pos.x - Math.cos(u.aim) * 16, y: u.pos.y - Math.sin(u.aim) * 16 + 1 }; }

  /** Bodies on the road ahead of the front bumper: enemies (roadblock) and friendlies (yield). */
  blockers(g: Game): { enemies: Unit[]; friends: Unit[] } {
    const T = CFG.escortTruck, out = { enemies: [] as Unit[], friends: [] as Unit[] };
    const samples: Vec[] = [];
    for (let k = T.halfLen; k <= T.halfLen + T.lookahead; k += 14) samples.push(this.at(this.s + k).p);
    if (this.s + T.halfLen >= this.total) return out;
    const hit = (u: Unit) => samples.some((p) => Math.hypot(u.pos.x - p.x, u.pos.y - p.y) < T.halfWidth + u.radius);
    for (const e of g.enemies) if (e.active && !e.structure && !e.vehicle && hit(e)) out.enemies.push(e);
    for (const s of [...g.soldiers, ...g.allies, ...g.npcs]) if ((s.state === 'active' || s.state === 'downed') && !s.mount && hit(s)) out.friends.push(s);
    return out;
  }

  update(g: Game, dt: number) {
    const u = this.unit;
    if (!u || !u.active || this.state === 'parked' || this.state === 'wrecked') return;
    const T = CFG.escortTruck;
    if (this.state === 'arrived') { this.v = 0; u.vel = { x: 0, y: 0 }; this.placeGunner(); return; }
    const foot = footSoldiers(g);
    const c = squadCentre(foot);
    let want = false, reason: TruckState = 'waiting';
    if (c && g.mission.escortStarted) {
      const pr = this.project(c, Math.max(0, this.s - 500), this.s + 1400);
      this.squadS = pr.s; this.squadOff = pr.d;
      if (pr.d > T.maxOff) reason = 'offroad';
      // near the end of the road the squad can't get further ahead: the truck rolls on to the extraction point
      else if (pr.s >= this.total - T.behind - 40 || pr.s - T.behind > this.s + 4) { want = true; reason = 'moving'; if (pr.s >= this.total - T.behind - 40) this.squadS = this.total + T.behind + 30; } // (+30: no slow crawl onto the end point)
    }
    let stop = !want;
    if (want) {
      const b = this.blockers(g);
      if (b.enemies.length) {
        stop = true; reason = 'roadblock';
        if (!this.blockedPrev) { this.roadblocks++; g.banner('ROADBLOCK! CLEAR THE ROAD AHEAD OF THE TRUCK', '#ff6040', 2.8); sfx('deny'); }
      } else if (b.friends.length) {
        stop = true; reason = 'yield';
        this.yieldT += dt;
        if (this.yieldT >= T.yieldNudge) { this.stepAside(g, b.friends); this.yieldT = 0; }
      }
      this.blockedPrev = reason === 'roadblock';
      if (reason !== 'yield') this.yieldT = 0;
    } else { this.blockedPrev = false; this.yieldT = 0; }
    // speed: ramp toward the target (no overshoot past the squad), brake at once for a body on the road
    const gap = want ? this.squadS - T.behind - this.s : 0;
    const vWant = stop ? 0 : Math.min(T.moveSpeed, Math.max(0, gap) * 1.6);
    if (reason === 'roadblock' || reason === 'yield') this.v = Math.max(0, Math.min(this.v, vWant) - T.accel * 2 * dt);
    else this.v = this.v < vWant ? Math.min(vWant, this.v + T.accel * dt) : Math.max(vWant, this.v - T.accel * 1.5 * dt);
    this.s = Math.min(this.total, this.s + this.v * dt);
    const { p, a } = this.at(this.s);
    u.vel = { x: (p.x - u.pos.x) / Math.max(dt, 1e-6), y: (p.y - u.pos.y) / Math.max(dt, 1e-6) };
    u.pos = p;
    u.aim = turnToward(u.aim, a, 2.2 * dt);
    u.moveFrac = this.v / T.moveSpeed;
    this.state = this.s >= this.total - 0.5 ? 'arrived' : this.v > 1 ? 'moving' : reason === 'moving' ? 'moving' : reason;
    if (this.state === 'arrived') { this.v = 0; g.banner('THE SUPPLY TRUCK REACHED THE EXTRACTION POINT', '#7dff8a', 3); }
    this.placeGunner();
  }

  /**
   * Make way: a goal for a soldier on foot that keeps them off the road just ahead of a live truck (Game ->
   * updateSquad bends formation slots that fall in the truck's lane out to the roadside, on the side they stand),
   * so the truck rarely has to wait for its own squad. Returns the goal unchanged when it is clear.
   */
  makeWay(u: Unit, goal: Vec): Vec {
    if (!this.live || this.state === 'arrived') return goal;
    const T = CFG.escortTruck, lo = this.s - T.halfLen, hi = this.s + T.halfLen + T.lookahead + 90;
    const check = (p: Vec) => { const pr = this.project(p, lo, hi); return pr.d < T.halfWidth + u.radius + 14 && pr.s > lo + 1 && pr.s < hi - 1 ? pr : null; };
    const pr = check(goal) ?? check(u.pos);
    if (!pr) return goal;
    const { p, a } = this.at(pr.s);
    const nx = -Math.sin(a), ny = Math.cos(a);
    const side = Math.sign((u.pos.x - p.x) * nx + (u.pos.y - p.y) * ny) || 1;
    const off = T.halfWidth + u.radius + 30;
    return { x: p.x + nx * off * side, y: p.y + ny * off * side };
  }

  /** A friendly who keeps standing in the truck's way steps to the roadside (the truck never runs anyone over). */
  private stepAside(g: Game, friends: Unit[]) {
    for (const f of friends) {
      if (f.state !== 'active') continue; // a downed soldier on the road: the truck waits for the revive
      const pr = this.project(f.pos, this.s, this.s + 300);
      const { p, a } = this.at(pr.s);
      const side = Math.sign((f.pos.x - p.x) * -Math.sin(a) + (f.pos.y - p.y) * Math.cos(a)) || 1;
      const off = CFG.escortTruck.halfWidth + f.radius + 26;
      const q = g.findOpenNear({ x: p.x - Math.sin(a) * off * side, y: p.y + Math.cos(a) * off * side }, 10);
      f.pos.x = q.x; f.pos.y = q.y; f.vel = { x: 0, y: 0 }; f.path = null;
      this.nudges++;
    }
  }

  placeGunner() {
    const s = this.gun.gunner;
    if (!s || !this.unit) return;
    const p = this.seat();
    s.pos.x = p.x; s.pos.y = p.y; s.vel = { x: 0, y: 0 }; s.aim = this.gun.aim; s.moveFrac = 0;
  }

  /** Truck destroyed (Game.damage -> assetDestroyed): the gunner is thrown clear, downed (never killed outright). */
  onDestroyed(g: Game) {
    if (this.state === 'wrecked' || !this.unit) return;
    this.state = 'wrecked'; this.v = 0;
    const p = this.unit.pos;
    g.mission.wrecks.push({ id: 'escort-truck', pos: { ...p }, kind: 'truck' });
    g.fx.ring(p, 130, 'rgba(255,190,80,0.95)', 0.55, 8);
    g.fx.burst(p, 40, '#ffb347', 420, 0.8, 6);
    g.fx.burst(p, 20, '#444', 200, 1.2, 9);
    g.fx.shake = Math.max(g.fx.shake, 18);
    g.scorches.push({ ...p, r: 70 });
    sfx('boom');
    const s = this.gun.gunner;
    if (s) { this.gun.release(g, s); if (s.active) g.downSoldier(s); }
    this.gun.lost = true;
  }
}

/** The truck's machine gun (fixed stats; see the file header). */
export class MountedGun {
  gunner: Unit | null = null;
  /** True once a gunner was assigned (or No Gunner chosen): the assignment is locked for the escort. */
  assigned = false;
  /** The gun is silent for the rest of the mission (gunner downed / dismounted, or the truck wrecked). */
  lost = false;
  target: Unit | null = null;
  aim = 0;
  cooldown = 0;
  muzzle = 0;
  shots = 0;
  hits = 0;
  constructor(readonly vehicle: EscortVehicle) {}
  get manned() { return !!this.gunner && !this.lost; }

  /** Assign (once): a standing deployed soldier, or null for No Gunner. */
  assign(g: Game, s: Unit | null): boolean {
    if (this.assigned) return false;
    if (s && (!s.active || !g.soldiers.includes(s))) return false;
    this.assigned = true;
    if (!s) return true;
    this.gunner = s;
    s.mount = this;
    s.target = null; s.path = null; s.vel = { x: 0, y: 0 };
    if (s.offhand) s.offhand.target = null;
    if (g.targeting === s) g.targeting = null;
    this.aim = this.vehicle.unit?.aim ?? 0;
    this.vehicle.placeGunner();
    return true;
  }

  /** The gunner leaves the gun for good (downed, or the last soldier on foot fell): thrown clear beside the truck. */
  release(g: Game, s: Unit) {
    if (this.gunner !== s) return;
    this.gunner = null; this.lost = true; this.target = null;
    s.mount = null;
    const u = this.vehicle.unit;
    if (u) {
      // the side of the truck with open ground, clear of its body
      const a = u.aim, off = (u.radius + s.radius + 8);
      const cands = [1, -1].map((side) => ({ x: u.pos.x - Math.sin(a) * off * side, y: u.pos.y + Math.cos(a) * off * side }));
      const q = cands.find((p) => g.world.isOpen(p.x, p.y) && !g.world.insideObstacle(p, s.radius)) ?? g.findOpenNear(cands[0], 30);
      s.pos.x = q.x; s.pos.y = q.y; s.vel = { x: 0, y: 0 }; s.path = null;
    }
    g.banner(`${s.name} OFF THE GUN — THE TRUCK GUN IS SILENT`, '#ffb347', 2.6);
  }

  update(g: Game, dt: number) {
    this.cooldown -= dt; this.muzzle -= dt;
    const s = this.gunner, u = this.vehicle.unit;
    if (!s || this.lost || !u || !u.active) return;
    const M = CFG.mountedGun, from = this.vehicle.seat(), r2 = M.range * M.range;
    const valid = (e: Unit) => e.active && e.targetable && !e.structure && !e.vehicle && (e.pos.x - from.x) ** 2 + (e.pos.y - from.y) ** 2 <= r2 && g.world.clear(from, e.pos);
    if (this.target && !valid(this.target)) this.target = null;
    if (!this.target) {
      let best: Unit | null = null, bd = Infinity;
      for (const e of g.enemies) {
        if (!e.active || !e.targetable || e.structure || e.vehicle) continue;
        const d = (e.pos.x - from.x) ** 2 + (e.pos.y - from.y) ** 2;
        if (d < bd && d <= r2 && g.world.clear(from, e.pos)) { bd = d; best = e; }
      }
      this.target = best;
    }
    const t = this.target;
    const desired = t ? Math.atan2(t.pos.y - from.y, t.pos.x - from.x) : u.aim;
    this.aim = turnToward(this.aim, desired, M.turnRate * dt);
    s.aim = this.aim;
    if (!t || this.cooldown > 0 || Math.abs(angleDiff(this.aim, desired)) > M.aimTolerance * DEG) return;
    // deliberately inaccurate: a wide cone, wider while the truck rolls
    const cone = M.spread + (M.movingSpread - M.spread) * clamp(this.vehicle.v / CFG.escortTruck.moveSpeed, 0, 1);
    const a = this.aim + rand(-cone / 2, cone / 2) * DEG;
    const dx = Math.cos(a), dy = Math.sin(a);
    g.projectiles.push({
      pos: { x: from.x + dx * 16, y: from.y + dy * 16 }, vel: { x: dx * M.projectileSpeed, y: dy * M.projectileSpeed },
      team: 'squad', damage: M.damage, life: (M.range * 1.15) / M.projectileSpeed, trail: { ...from }, owner: s,
      width: 3, len: 24, hot: true, mounted: true, from: { ...from },
    });
    this.shots++;
    this.cooldown += 1 / M.fireRate;
    if (this.cooldown < -0.05) this.cooldown = 0;
    this.muzzle = 0.06;
    if (this.shots % 2 === 0) sfx('shot');
    if (this.shots % 4 === 0) g.fx.burst({ x: from.x + dx * 18, y: from.y + dy * 18 }, 1, '#ffd27a', 90, 0.12, 3); // bounded flash sparks
  }
}

// =======================================================================================
// Objectives
// =======================================================================================

/**
 * Capture the truck: a standing soldier on foot inside its capture zone for CFG.escortTruck.captureTime
 * CONTINUOUS seconds (leaving resets). Then the gunner selection opens (the simulation waits for it).
 */
export class CaptureVehicleObjective extends Objective {
  t = 0;
  constructor(id: string, label: string) { super(id, label); this.phase = 'capture'; }
  inside(m: Mission, g: Game) { const u = m.escort?.unit; return !!u && footSoldiers(g).some((s) => dist(s.pos, u.pos) <= CFG.escortTruck.captureRadius); }
  protected onStart(_m: Mission, g: Game) { g.banner('ALL DEPOTS DESTROYED — CAPTURE THE TRUCK', '#7dff8a', 3); }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active' || !m.escort) return;
    this.t = this.inside(m, g) ? this.t + dt : 0;
    if (this.t < CFG.escortTruck.captureTime) return;
    m.escort.capture();
    g.fx.ring(m.escort.unit!.pos, 90, 'rgba(120,255,140,0.9)', 0.5, 5);
    sfx('pickup');
    this.complete(m, g);
    g.openGunnerSelect();
  }
  hud(m: Mission, g: Game): HudLine {
    const on = this.inside(m, g);
    return { text: on ? 'Capturing the truck…' : this.label, sub: on ? `Stay next to the truck: ${Math.ceil(CFG.escortTruck.captureTime - this.t)}s` : `Stand next to the truck for ${CFG.escortTruck.captureTime}s (continuous)`, progress: this.t / CFG.escortTruck.captureTime };
  }
  point(m: Mission): ObjPoint | null { const u = m.escort?.unit; return u ? { pos: u.pos, label: 'TRUCK', color: '#7dd3ff' } : null; }
  draw(ctx: CanvasRenderingContext2D, m: Mission, g: Game) {
    const u = m.escort?.unit;
    if (!u || this.state === 'complete') return;
    const live = this.state === 'active', R = CFG.escortTruck.captureRadius, f = clamp(this.t / CFG.escortTruck.captureTime, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(g.clock * 4);
    ctx.strokeStyle = live ? `rgba(125,211,255,${0.5 + 0.4 * pulse})` : 'rgba(200,200,200,0.35)'; ctx.lineWidth = 3; ctx.setLineDash([8, 7]);
    ctx.beginPath(); ctx.ellipse(u.pos.x, u.pos.y, R, R * 0.8, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if (f > 0) { ctx.strokeStyle = '#7dff8a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(u.pos.x, u.pos.y, R, R * 0.8, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.stroke(); }
    ctx.fillStyle = live ? '#bfe8ff' : '#ddd'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(live ? 'CAPTURE THE TRUCK' : 'DESTROY THE DEPOTS FIRST', u.pos.x, u.pos.y + R * 0.8 + 16);
  }
}

/** One ambush group: per-unit points (or road positions), kinds; `hold` = stay put (roadblock), `hunter` = prefer the truck. */
export interface AmbushGroup { kinds: EnemyKind[]; points?: Vec[]; road?: { s: number; side: number }[]; hold?: boolean; hunter?: boolean }
export interface AmbushDef { at: number; delay: number; banner: string; groups: AmbushGroup[] }

/** Finite ambushes keyed to the truck's progress along the route (each once). */
const AMBUSH_CLEAR = 240;
function clearOfFriends(p: Vec, friends: Unit[]): Vec {
  for (let pass = 0; pass < 6; pass++) {
    let near: Unit | null = null, nd = AMBUSH_CLEAR;
    for (const f of friends) { const d = dist(f.pos, p); if (d < nd) { nd = d; near = f; } }
    if (!near) break;
    const dx = p.x - near.pos.x, dy = p.y - near.pos.y, L = Math.hypot(dx, dy) || 1;
    p = { x: near.pos.x + (dx / L) * (AMBUSH_CLEAR + 20), y: near.pos.y + (dy / L) * (AMBUSH_CLEAR + 20) };
  }
  return p;
}

export class ProgressAmbushes {
  fired: number[] = [];
  spawnedAt: number[] = [];
  pending: { i: number; t: number }[] = [];
  units: Unit[][];
  constructor(readonly defs: AmbushDef[]) { this.units = defs.map(() => []); }
  get spawnedCount() { return this.units.reduce((a, u) => a + u.length, 0); }
  get plannedCount() { return this.defs.reduce((a, d) => a + d.groups.reduce((b, gr) => b + gr.kinds.length, 0), 0); }
  left(i: number) { let n = 0; for (const u of this.units[i]) if (u.active) n++; return n; }
  update(m: Mission, g: Game, v: EscortVehicle, dt: number) {
    if (!v.live) return;
    this.defs.forEach((d, i) => {
      if (this.fired.includes(i) || v.s < d.at) return;
      this.fired.push(i);
      this.pending.push({ i, t: d.delay });
      g.banner(d.banner, '#ff6040', 3);
      sfx('alarm');
      for (const gr of d.groups) { const p = gr.points?.[0] ?? (gr.road ? v.at(gr.road[0].s).p : null); if (p) m.incoming.push({ pos: { ...p }, life: d.delay + 3 }); }
    });
    for (const p of this.pending) p.t -= dt;
    while (this.pending.length && this.pending[0].t <= 0) this.spawn(m, g, v, this.pending.shift()!.i);
  }
  private spawn(m: Mission, g: Game, v: EscortVehicle, i: number) {
    const d = this.defs[i];
    this.spawnedAt[i] = g.time;
    const friends = [...footSoldiers(g), ...(v.unit ? [v.unit] : [])];
    for (const gr of d.groups) {
      gr.kinds.forEach((kind, k) => {
        let p: Vec;
        if (gr.road) { const r = gr.road[k % gr.road.length], at = v.at(r.s); p = { x: at.p.x - Math.sin(at.a) * r.side, y: at.p.y + Math.cos(at.a) * r.side }; }
        else p = gr.points![k % gr.points!.length];
        // never on top of the squad or the truck: slide a too-close point away from the nearest of them (a few
        // passes: one slide can land next to another soldier), then onto open ground
        p = clearOfFriends(p, friends);
        let q = g.world.isOpen(p.x, p.y) && !g.world.insideObstacle(p, 14) ? p : g.findOpenNear(p, 30);
        if (friends.some((f) => dist(f.pos, q) < AMBUSH_CLEAR - 20)) q = g.findOpenNear(clearOfFriends(q, friends), 30);
        const e = g.spawnEnemy(q, kind);
        e.tag = `ambush-${i + 1}`;
        if (gr.hold) e.holdPos = { ...e.pos };
        if (gr.hunter) e.targeting = VehicleHunterTargeting;
        this.units[i].push(e);
      });
    }
    m.spawned.set('ambush', (m.spawned.get('ambush') ?? 0) + this.units[i].length);
  }
}

/** Escort the captured truck to the end of its route (the extraction point), through progress-keyed ambushes. */
export class EscortObjective extends Objective {
  readonly ambushes: ProgressAmbushes;
  constructor(id: string, label: string, ambushes: AmbushDef[]) { super(id, label); this.phase = 'escort'; this.ambushes = new ProgressAmbushes(ambushes); }
  protected onStart(_m: Mission, g: Game) { g.banner('ESCORT THE TRUCK — ADVANCE ALONG THE ROAD, IT FOLLOWS YOU', '#7dd3ff', 3.2); }
  update(m: Mission, g: Game, dt: number) {
    const v = m.escort;
    if (this.state !== 'active' || !v) return;
    this.ambushes.update(m, g, v, dt);
    if (v.state === 'arrived') this.complete(m, g);
  }
  hud(m: Mission): HudLine {
    const v = m.escort!;
    const st: Record<TruckState, string> = {
      parked: '', arrived: 'Arrived', wrecked: 'Destroyed',
      waiting: 'Truck waiting — advance along the road and it follows',
      moving: 'Truck moving — keep advancing',
      roadblock: 'ROADBLOCK — clear the enemies off the road ahead',
      yield: 'Truck waiting — someone is standing in its path',
      offroad: 'Truck waiting — get back to the road, it follows the squad along it',
    };
    const gun = v.gun.manned ? `gun: ${v.gun.gunner!.name}` : v.gun.gunner === null && !v.gun.lost ? 'no gunner' : 'gun silent';
    return {
      text: this.label, sub: `${st[v.state]} · ambushes ${this.ambushes.fired.length}/${this.ambushes.defs.length} · ${gun}`,
      progress: v.s / v.total, chips: this.chips(), meter: assetMeter(v.unit, 'TRUCK'),
    };
  }
  chips(): HudChip[] {
    const A = this.ambushes;
    return A.defs.map((_, i) => ({ label: `AMB ${i + 1}`, frac: A.fired.includes(i) ? (A.units[i].length ? 1 - A.left(i) / A.units[i].length : 0) : 0, state: !A.fired.includes(i) ? 'idle' : A.units[i].length && A.left(i) === 0 ? 'done' : 'live' }));
  }
  point(m: Mission): ObjPoint | null {
    const v = m.escort;
    if (!v) return null;
    return { pos: v.at(Math.min(v.total, Math.max(v.s + 300, v.squadS + 120))).p, label: 'ROAD', color: '#7dd3ff' };
  }
  draw(ctx: CanvasRenderingContext2D, m: Mission) {
    const v = m.escort;
    if (!v || this.state !== 'active') return;
    // the road ahead of the truck: a dashed guide to the extraction point
    ctx.strokeStyle = 'rgba(125,211,255,0.35)'; ctx.lineWidth = 4; ctx.setLineDash([14, 14]);
    ctx.beginPath();
    const s0 = v.s + CFG.escortTruck.halfLen;
    for (let s = s0; s <= v.total; s += 40) { const p = v.at(s).p; if (s === s0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
}

/** Destroy several structures in any order, HUD "<count label>: x/n" (Mission 14 "Depots destroyed: 0/3"). */
export class CountDestroyObjective extends MultiDestroyObjective {
  constructor(id: string, label: string, points: Vec[], kind: string, hp: number, pointLabel: string, readonly countLabel: string) { super(id, label, points, kind, hp, pointLabel); }
  /** The count rides on the headline so it shows even while the opening tip holds the sub line. */
  hud(): HudLine { return { text: `${this.label} · ${this.countLabel}: ${this.destroyed}/${this.targets.length}`, sub: 'Shoot or grenade them', chips: this.chips() }; }
  status(): string { return `${this.destroyed}/${this.targets.length}`; }
}
