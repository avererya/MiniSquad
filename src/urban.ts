// v0.9B URBAN AMBUSHES: reusable MissionMechanics for Mission 18 "Ambush Alley" and later street fights.
//
// AmbushDirector (id 'ambush') springs scripted ambushes, each ONCE per attempt:
//  - An ambush arms when its condition holds: the squad's centre enters `zone`, and/or every ambush in `after` has
//    sprung and been cleared, and/or the current primary is `onObjective`. Its radio `cue` plays at once (a warning
//    before anything shoots); `delay` s later (simulation time) its groups appear.
//  - Ground groups appear at the safest of their `from` points (chapter4.ts safeSpawnPoint: off screen, at least
//    minDist from every soldier, standing or downed) on open ground and either walk to their `posts` and hold them
//    (crossfire positions: Unit.holdPos, they turn and fire but never advance) or pursue the squad.
//  - Rooftop groups (`roof`) are enemy Snipers posted on 'roof' perches: the narrow strip at the street-facing foot of
//    a building (a low obstacle: blocks walking, never sight or rounds). v0.9B.1 CONCEALED ROOFTOP SNIPERS: when the
//    ambush springs they stay hidden (out of Game.enemies: no sprite, HP bar, marker, never a target). A hidden sniper
//    reveals itself the moment it has a firing opportunity (its own targeting picks a soldier: in range, clear line,
//    its perch on screen): it joins Game.enemies already aiming at that soldier, so its red laser, its sprite and its
//    HP bar appear together, and its first telegraph is `glint` s longer (Unit.aimBonus: aimTime 1.6 + 1.2 = 2.8 s
//    before the first shot). Once revealed it stays revealed. A sniper that never gets a chance reveals `revealAfter`
//    s after its ambush sprang, or as soon as the rest of its stretch is cleared (AmbushObjective), so it can never
//    stall an objective; an airstrike over its perch (or the nuke) flushes it out before the strike lands. Rendering:
//    its position is the street edge of the building, so sight and rounds use the normal rules (its own building is
//    behind it, other buildings still block it); it is drawn `roofLift` px higher, on the roof, with a sandbag nest
//    on the parapet (drawAbove, after the buildings). Global sniper numbers are untouched.
//  - Units are tagged with the ambush id and counted in Mission.spawned, so ClearGroupsObjective / AmbushObjective
//    can wait for them. Nothing respawns; every ambush is finite.
// SupplyCaches (id 'caches'): optional crates off the main route; a standing soldier within openRadius opens one and
// it drops existing pickups (medkits / Rapid Fire). Nothing is saved, no new currency or inventory.
// Fixed step only; the only Math.random draws are findOpenNear's, inside the step in a stable order.
import type { Game } from './game';
import type { Mission, MissionMechanic } from './mission';
import type { StoryCue } from './story';
import { Objective, type HudLine, type ObjPoint } from './objectives';
import type { EnemyKind, Unit } from './unit';
import { safeSpawnPoint } from './chapter4';
import { squadCentre } from './squad';
import { Medkit, RapidFire, type PickupType } from './pickups';
import { dist, pointInRect, type Rect, type Vec } from './util';
import { sfx } from './audio';

export interface StreetAmbushGroup {
  kinds: EnemyKind[];
  /** Ground groups: candidate entry points (the safest is used). */
  from?: Vec[];
  /** Ground groups: posts to walk to and hold (one per unit, cycled); none = pursue the squad. */
  posts?: Vec[];
  /** Rooftop snipers: exact perch positions (one per unit). */
  roof?: Vec[];
}
export interface StreetAmbushDef {
  id: string;
  zone?: Rect;
  after?: string[];
  onObjective?: string;
  delay?: number;
  cue?: StoryCue;
  banner?: string;
  groups: StreetAmbushGroup[];
  /** Spawn distance from every soldier (default 560). */
  minDist?: number;
}
export interface AmbushState { def: StreetAmbushDef; armedAt: number; sprungAt: number; units: Unit[] }
/** v0.9B.1 a rooftop perch as drawn: the building it stands on and the side of the roof facing the street. */
export interface RoofPerch { pos: Vec; lift: number; side: 'front' | 'back' | 'none'; edge: number; x0: number; x1: number }

export class AmbushDirector implements MissionMechanic {
  readonly id = 'ambush';
  readonly states: AmbushState[];
  /** v0.9B.1 rooftop snipers not revealed yet (not in Game.enemies). */
  readonly hidden: Unit[] = [];
  /** v0.9B.1 every perch (sniper or decoy nest) as drawn on its roof (built at start). */
  perches: RoofPerch[] = [];
  readonly revealAfter: number;
  /** v0.9B.1 seconds between two rooftop reveals on sight. */
  readonly revealGap: number;
  private lastReveal = -1e9;
  readonly decoys: Vec[];
  log: {
    sprung: string[]; spawns: { id: string; at: Vec; minSoldierDist: number; onScreen: boolean }[]; glints: number;
    reveals: { id: string; t: number; aimed: boolean; why: 'sight' | 'timer' | 'cleared' | 'support' }[];
  } = { sprung: [], spawns: [], glints: 0, reveals: [] };
  constructor(readonly defs: StreetAmbushDef[], readonly glint = 1.2, opts: { decoys?: Vec[]; revealAfter?: number; revealGap?: number } = {}) {
    this.states = defs.map((def) => ({ def, armedAt: -1, sprungAt: -1, units: [] }));
    this.decoys = opts.decoys ?? [];
    this.revealAfter = opts.revealAfter ?? 30;
    this.revealGap = opts.revealGap ?? 1.5;
  }
  state(id: string) { return this.states.find((s) => s.def.id === id) ?? null; }
  sprung(id: string) { return (this.state(id)?.sprungAt ?? -1) >= 0; }
  cleared(id: string) { const s = this.state(id); return !!s && s.sprungAt >= 0 && s.units.every((u) => !u.active); }
  get rooftop() { return this.states.flatMap((s) => s.units.filter((u) => u.rooftop)); }
  isHidden(u: Unit) { return this.hidden.includes(u); }
  /** Hidden rooftop snipers of these ambushes. */
  hiddenOf(ids: string[]) { return this.hidden.filter((u) => !!u.tag && ids.includes(u.tag)); }

  start(_m: Mission, g: Game) {
    const spots = [...this.defs.flatMap((d) => d.groups.flatMap((gr) => gr.roof ?? [])), ...this.decoys];
    this.perches = spots.map((p) => roofPerch(g, p));
  }

  private ready(m: Mission, g: Game, d: StreetAmbushDef) {
    if (d.zone) { const c = squadCentre(g.soldiers); if (!c || !pointInRect(c, d.zone)) return false; }
    if (d.after && !d.after.every((id) => this.cleared(id))) return false;
    if (d.onObjective && m.currentObjective?.id !== d.onObjective) return false;
    return true;
  }

  step(m: Mission, g: Game) {
    for (const s of this.states) {
      if (s.sprungAt >= 0) continue;
      if (s.armedAt < 0) {
        if (!this.ready(m, g, s.def)) continue;
        s.armedAt = g.time;
        if (s.def.cue) m.cue(g, s.def.cue);
      }
      if (g.time - s.armedAt + 1e-9 >= (s.def.delay ?? 0)) this.spring(m, g, s);
    }
    // v0.9B.1 concealed rooftop snipers: reveal on a firing opportunity (or once their time is up)
    if (!this.hidden.length) return;
    // (one at a time: a second sniper with a shot waits until revealGap s after the last reveal, so two lasers never
    // start together)
    const victims = g.enemyVictims();
    for (const u of [...this.hidden]) {
      const st = this.states.find((x) => x.units.includes(u));
      const spaced = g.time - this.lastReveal + 1e-9 >= this.revealGap;
      const t = spaced && g.isOnScreen(u.pos, -8) ? u.targeting.select(u, victims, g) : null;
      if (t) this.reveal(g, u, 'sight', t);
      else if (st && g.time - st.sprungAt + 1e-9 >= this.revealAfter) this.reveal(g, u, 'timer');
    }
  }

  /** A hidden rooftop sniper shows itself (once): into Game.enemies, aiming at `target` if it has one. */
  reveal(g: Game, u: Unit, why: 'sight' | 'timer' | 'cleared' | 'support', target: Unit | null = null) {
    const i = this.hidden.indexOf(u);
    if (i < 0) return;
    this.hidden.splice(i, 1);
    g.enemies.push(u);
    this.lastReveal = g.time;
    u.aimBonus = this.glint; u.aimHeld = 0; u.lockAim = null;
    if (target) { u.target = target; u.aim = Math.atan2(target.pos.y - u.pos.y, target.pos.x - u.pos.x); }
    this.log.glints++;
    this.log.reveals.push({ id: u.tag ?? '', t: g.time, aimed: !!target, why });
    g.fx.texts.push({ pos: { x: u.pos.x, y: u.pos.y - u.roofLift - 62 }, text: 'ROOFTOP SNIPER!', life: 1.6, color: '#ff5a4a' });
    if (target) sfx('lock');
  }

  /** v0.9B.1 a support strike flushes hidden rooftop snipers inside it out before the damage lands. */
  supportStrike(_m: Mission, g: Game, at: Vec | null, radius: number) {
    for (const u of [...this.hidden]) if (!at || dist(u.pos, at) <= radius) this.reveal(g, u, 'support');
  }

  spring(m: Mission, g: Game, s: AmbushState) {
    const d = s.def, min = d.minDist ?? 560;
    s.sprungAt = g.time;
    for (const grp of d.groups) {
      if (grp.roof) {
        grp.kinds.forEach((k, i) => {
          const p = grp.roof![i % grp.roof!.length];
          const e = g.spawnEnemy({ x: p.x, y: p.y }, k);
          e.fixed = true; e.rooftop = true; e.tag = d.id; e.guard = false;
          const perch = roofPerch(g, p);
          e.roofLift = perch.lift; e.aim = perch.side === 'back' ? -Math.PI / 2 : Math.PI / 2; // facing the street
          g.enemies.splice(g.enemies.indexOf(e), 1); // v0.9B.1 concealed until it has a shot (reveal)
          this.hidden.push(e);
          s.units.push(e);
          this.note(g, d.id, e.pos);
        });
        continue;
      }
      const at = safeSpawnPoint(g, grp.from ?? [], min);
      grp.kinds.forEach((k, i) => {
        const e = g.spawnEnemy(g.findOpenNear(at, 50), k);
        e.tag = d.id; e.guard = false;
        if (grp.posts?.length) e.holdPos = { ...grp.posts[i % grp.posts.length] };
        s.units.push(e);
        this.note(g, d.id, e.pos);
      });
      m.incoming.push({ pos: { ...at }, life: 4 });
    }
    m.spawned.set(d.id, s.units.length);
    this.log.sprung.push(d.id);
    if (d.banner) g.banner(d.banner, '#ff7a5a', 2.5);
    sfx('alarm');
  }
  private note(g: Game, id: string, at: Vec) {
    const live = g.soldiers.filter((x) => x.state === 'active' || x.state === 'downed');
    this.log.spawns.push({ id, at: { ...at }, minSoldierDist: Math.round(Math.min(Infinity, ...live.map((x) => dist(x.pos, at)))), onScreen: g.isOnScreen(at, 0) });
  }

  /**
   * v0.9B.1 on top of the buildings: a sandbag nest on the parapet of every perch (decoys too, so a nest alone gives
   * nothing away), the revealed snipers standing behind it, lifted onto the roof, and a red chevron over each.
   */
  drawAbove(ctx: CanvasRenderingContext2D, _m: Mission, g: Game, drawUnit: (u: Unit) => void) {
    const near = (p: Vec) => Math.abs(p.x - g.cam.x) < 720 && Math.abs(p.y - g.cam.y) < 470;
    const units = this.rooftop.filter((u) => u.active && !this.isHidden(u));
    for (const p of this.perches) {
      if (!near(p.pos)) continue;
      if (p.side === 'back') drawNest(ctx, p); // the parapet is behind (north of) the sniper
      const u = units.find((x) => Math.abs(x.pos.x - p.pos.x) < 2 && Math.abs(x.pos.y - p.pos.y) < 2);
      if (u) { ctx.save(); ctx.translate(0, -u.roofLift); drawUnit(u); ctx.restore(); }
      if (p.side !== 'back') drawNest(ctx, p); // the parapet in front of (south of) the sniper hides its legs
      if (u) {
        const x = u.pos.x, y = u.pos.y - u.roofLift, b = Math.sin(g.clock * 4) * 2;
        ctx.fillStyle = '#ff5a4a'; ctx.strokeStyle = '#3a0d08'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - 7, y - 76 + b); ctx.lineTo(x + 7, y - 76 + b); ctx.lineTo(x, y - 67 + b); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
  }
}

/**
 * v0.9B.1 where a perch sits on its building: a perch just below a building's footprint (the street south of it) is on
 * that roof's front (south) parapet, one just above a footprint on its back (north) parapet. `lift` raises the sniper
 * from the street edge to stand a step inside the roof edge as the building is drawn (its roof is `height` px up).
 */
export function roofPerch(g: Game, p: Vec): RoofPerch {
  for (const o of g.map.obstacles) {
    if (o.kind !== 'building' || p.x < o.x || p.x > o.x + o.w) continue;
    const H = o.height;
    if (Math.abs(p.y - (o.y + o.h)) <= 24) { const edge = o.y + o.h - H; return { pos: { ...p }, lift: p.y - (edge - 12), side: 'front', edge, x0: o.x, x1: o.x + o.w }; }
    if (Math.abs(p.y - o.y) <= 24) { const edge = o.y - H; return { pos: { ...p }, lift: p.y - (edge + 16), side: 'back', edge, x0: o.x, x1: o.x + o.w }; }
  }
  return { pos: { ...p }, lift: 0, side: 'none', edge: p.y, x0: p.x - 30, x1: p.x + 30 };
}

/** A rooftop sandbag nest: a short arc of bags on the parapet over the perch (kept inside the roof). */
function drawNest(ctx: CanvasRenderingContext2D, p: RoofPerch) {
  const w = 58, x0 = Math.max(p.x0 + 2, p.pos.x - w / 2), x1 = Math.min(p.x1 - 2, p.pos.x + w / 2);
  const y = p.side === 'front' ? p.edge - 9 : p.side === 'back' ? p.edge + 1 : p.pos.y - 6;
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0, y + 2, x1 - x0, 9);
  ctx.strokeStyle = '#5b4a2a'; ctx.lineWidth = 1.5;
  for (let x = x0, i = 0; x < x1 - 4; x += 12, i++) {
    ctx.fillStyle = i % 2 ? '#a48f5d' : '#9b8656';
    ctx.beginPath(); ctx.ellipse(Math.min(x + 6, x1 - 6), y + 4, 6.5, 4.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#8f8a80'; ctx.fillRect(x0 - 1, y - 1, 3, 9); ctx.fillRect(x1 - 2, y - 1, 3, 9); // parapet posts
}

/**
 * Clear a stretch of the route: every ambush in `ambushes` has sprung and none of its units stands, and nobody of
 * the placed `tags` groups stands. Before an ambush springs, the marker points at its zone ("advance") and the HUD
 * gives no count, so the ambush stays a surprise.
 */
export class AmbushObjective extends Objective {
  constructor(id: string, label: string, readonly ambushes: string[], readonly tags: string[] = [], readonly pointLabel = 'ADVANCE') { super(id, label); this.phase = 'ambush'; }
  dir(m: Mission) { return m.mechanic<AmbushDirector>('ambush'); }
  alive(g: Game) { const all = [...this.ambushes, ...this.tags]; return g.enemies.filter((e) => e.active && !!e.tag && all.includes(e.tag)); }
  pending(m: Mission) { const d = this.dir(m); return this.ambushes.filter((id) => !d?.sprung(id)); }
  update(m: Mission, g: Game) {
    if (this.state !== 'active' || this.pending(m).length || this.alive(g).length) return;
    // v0.9B.1 a concealed rooftop sniper never stalls the stretch: with everyone else down it shows itself
    const d = this.dir(m), hid = d?.hiddenOf(this.ambushes) ?? [];
    for (const u of hid) d!.reveal(g, u, 'cleared');
    if (!hid.length) this.complete(m, g);
  }
  hud(m: Mission, g: Game): HudLine {
    const n = this.alive(g).length;
    return { text: this.label, sub: n ? `Enemies in sight of the route: ${n}` : this.pending(m).length ? 'Advance carefully: watch the side streets and the rooftops' : undefined };
  }
  point(m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const e = this.alive(g).sort((a, b) => dist(a.pos, c) - dist(b.pos, c))[0];
    if (e) return { pos: e.pos, label: e.rooftop ? 'ROOF' : 'ENEMY', color: '#ff7a5a' };
    const d = this.dir(m), next = this.pending(m).map((id) => d?.state(id)?.def.zone).find((z) => !!z);
    return next ? { pos: { x: next.x + next.w / 2, y: next.y + next.h / 2 }, label: this.pointLabel, color: '#ffd84a' } : null;
  }
}

export interface CacheDef { pos: Vec; loot: ('medkit' | 'rapidfire')[] }
export interface SupplyCache { readonly id: number; readonly pos: Vec; opened: boolean; openedAt: number }
/** Optional supply caches: a soldier walking up to one opens it and it spills existing pickups. */
export class SupplyCaches implements MissionMechanic {
  readonly id = 'caches';
  readonly caches: SupplyCache[];
  constructor(readonly defs: CacheDef[], readonly openRadius = 55) { this.caches = defs.map((d, id) => ({ id, pos: { ...d.pos }, opened: false, openedAt: -1 })); }
  get opened() { return this.caches.filter((c) => c.opened).length; }
  /** What the caches dropped, in order (tests). */
  log: { drops: ('medkit' | 'rapidfire')[] } = { drops: [] };
  step(_m: Mission, g: Game) {
    const r2 = this.openRadius ** 2;
    for (const c of this.caches) {
      if (c.opened || !g.soldiers.some((s) => s.active && (s.pos.x - c.pos.x) ** 2 + (s.pos.y - c.pos.y) ** 2 <= r2)) continue;
      c.opened = true; c.openedAt = g.time;
      const loot = this.defs[c.id].loot;
      loot.forEach((k, i) => {
        this.log.drops.push(k);
        const type: PickupType = k === 'medkit' ? Medkit : RapidFire;
        const a = (i / Math.max(1, loot.length)) * Math.PI * 2 + 0.6;
        g.pickups.push({ type, pos: { x: c.pos.x + Math.cos(a) * 34, y: c.pos.y + Math.sin(a) * 26 }, bob: 0 });
      });
      g.banner(`SUPPLY CACHE RECOVERED (${this.opened}/${this.caches.length})`, '#7dd3ff', 2.5);
      g.fx.ring(c.pos, 40, 'rgba(125,211,255,0.9)', 0.5, 4);
      sfx('pickup');
    }
  }
  draw(ctx: CanvasRenderingContext2D, _m: Mission, g: Game) {
    for (const c of this.caches) {
      const { x, y } = c.pos;
      if (Math.abs(x - g.cam.x) > 700 || Math.abs(y - g.cam.y) > 420) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 6, 22, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c.opened ? '#5a5a46' : '#55703f'; ctx.strokeStyle = '#26301c'; ctx.lineWidth = 2;
      ctx.fillRect(x - 18, y - 12, 36, 18); ctx.strokeRect(x - 18, y - 12, 36, 18);
      if (c.opened) { ctx.fillStyle = '#3e4a30'; ctx.fillRect(x - 18, y - 22, 36, 8); continue; }
      ctx.fillStyle = '#6d8c50'; ctx.fillRect(x - 18, y - 18, 36, 7); ctx.strokeRect(x - 18, y - 18, 36, 7);
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x - 2, y - 9, 4, 12); ctx.fillRect(x - 6, y - 5, 12, 4);
      const p = 0.5 + 0.5 * Math.sin(g.clock * 3 + c.id);
      ctx.strokeStyle = `rgba(125,211,255,${0.35 + 0.35 * p})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 4, 30 + p * 4, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

/** Optional: open `need` supply caches. The marker shows a closed cache only once the squad is within `reveal` px. */
export class CachesOptional extends Objective {
  constructor(id: string, label: string, readonly need: number, readonly reveal = 760) { super(id, label); }
  caches(m: Mission) { return m.mechanic<SupplyCaches>('caches'); }
  update(m: Mission, g: Game) { if (this.state === 'active' && (this.caches(m)?.opened ?? 0) >= this.need) this.complete(m, g); }
  status(m: Mission): string { return this.state === 'complete' ? 'DONE' : `${Math.min(this.need, this.caches(m)?.opened ?? 0)}/${this.need}`; }
  point(m: Mission, g: Game): ObjPoint | null {
    if (this.state !== 'active') return null;
    const c = squadCentre(g.soldiers) ?? g.cam;
    const k = this.caches(m)?.caches.filter((x) => !x.opened && dist(x.pos, c) <= this.reveal).sort((a, b) => dist(a.pos, c) - dist(b.pos, c))[0];
    return k ? { pos: k.pos, label: 'CACHE', color: '#7dd3ff' } : null;
  }
}
