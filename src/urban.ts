// v0.9B URBAN AMBUSHES: reusable MissionMechanics for Mission 18 "Ambush Alley" and later street fights.
//
// AmbushDirector (id 'ambush') springs scripted ambushes, each ONCE per attempt:
//  - An ambush arms when its condition holds: the squad's centre enters `zone`, and/or every ambush in `after` has
//    sprung and been cleared, and/or the current primary is `onObjective`. Its radio `cue` plays at once (a warning
//    before anything shoots); `delay` s later (simulation time) its groups appear.
//  - Ground groups appear at the safest of their `from` points (chapter4.ts safeSpawnPoint: off screen, at least
//    minDist from every soldier, standing or downed) on open ground and either walk to their `posts` and hold them
//    (crossfire positions: Unit.holdPos, they turn and fire but never advance) or pursue the squad.
//  - Rooftop groups (`roof`) are stationary enemy Snipers placed exactly on 'roof' perches (low obstacles: they block
//    walking, never sight or rounds), so they can be shot from the street and never reached on foot. Each one's first
//    aim is a glint: `glint` s are added to its normal laser telegraph (CFG.enemySniper aimTime), so the first shot
//    of a rooftop sniper always gives at least aimTime + glint to step out of the line. Global sniper numbers are
//    untouched (the existing ExposedTargeting, laser, lock and round).
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

export class AmbushDirector implements MissionMechanic {
  readonly id = 'ambush';
  readonly states: AmbushState[];
  /** Rooftop snipers whose first aim already got its glint. */
  private glinted = new Set<Unit>();
  log: { sprung: string[]; spawns: { id: string; at: Vec; minSoldierDist: number; onScreen: boolean }[]; glints: number } = { sprung: [], spawns: [], glints: 0 };
  constructor(readonly defs: StreetAmbushDef[], readonly glint = 1.0) {
    this.states = defs.map((def) => ({ def, armedAt: -1, sprungAt: -1, units: [] }));
  }
  state(id: string) { return this.states.find((s) => s.def.id === id) ?? null; }
  sprung(id: string) { return (this.state(id)?.sprungAt ?? -1) >= 0; }
  cleared(id: string) { const s = this.state(id); return !!s && s.sprungAt >= 0 && s.units.every((u) => !u.active); }
  get rooftop() { return this.states.flatMap((s) => s.units.filter((u) => u.rooftop)); }

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
    // the glint: a rooftop sniper's first aim holds longer (its laser shows for aimTime + glint before the first shot)
    for (const s of this.states) for (const u of s.units) {
      if (!u.rooftop || !u.active || !u.target || this.glinted.has(u)) continue;
      this.glinted.add(u);
      u.aimHeld -= this.glint;
      this.log.glints++;
      g.fx.texts.push({ pos: { x: u.pos.x, y: u.pos.y - 46 }, text: 'ROOFTOP SNIPER!', life: 1.4, color: '#ff5a4a' });
    }
  }

  spring(m: Mission, g: Game, s: AmbushState) {
    const d = s.def, min = d.minDist ?? 560;
    s.sprungAt = g.time;
    for (const grp of d.groups) {
      if (grp.roof) {
        grp.kinds.forEach((k, i) => {
          const p = grp.roof![i % grp.roof!.length];
          const e = g.spawnEnemy({ x: p.x, y: p.y }, k);
          e.fixed = true; e.rooftop = true; e.tag = d.id; e.guard = false; e.aim = Math.PI / 2;
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

  /** Rooftop snipers: a sandbag nest under them and a red chevron over them (ground level, before the units). */
  draw(ctx: CanvasRenderingContext2D, _m: Mission, g: Game) {
    for (const u of this.rooftop) {
      if (!u.active || Math.abs(u.pos.x - g.cam.x) > 700 || Math.abs(u.pos.y - g.cam.y) > 420) continue;
      const { x, y } = u.pos;
      ctx.fillStyle = '#9b8656'; ctx.strokeStyle = '#5b4a2a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y + 4, 22, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + 4, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      const b = Math.sin(g.clock * 4) * 2;
      ctx.fillStyle = '#ff5a4a'; ctx.strokeStyle = '#3a0d08'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 7, y - 52 + b); ctx.lineTo(x + 7, y - 52 + b); ctx.lineTo(x, y - 43 + b); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
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
  update(m: Mission, g: Game) { if (this.state === 'active' && this.pending(m).length === 0 && this.alive(g).length === 0) this.complete(m, g); }
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
