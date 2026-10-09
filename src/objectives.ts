// v0.4 objective modules. Each objective is a small self-contained state machine:
//   pending -> active -> complete | failed
// It reacts to gameplay EVENTS (kills, downs, KIA, captive damage...) emitted by game.ts
// through Mission.emit(), and/or polls positions in update() (zones, timers). complete()
// and fail() only act on an ACTIVE objective, so nothing can complete twice, complete after
// failing, or complete before it started. Rewards are never paid here: the Mission reports
// the final state of each optional objective once, at settlement (economy.ts).
import { CFG } from './config';
import type { Game } from './game';
import type { Mission } from './mission';
import type { Unit } from './unit';
import { clamp, dist, pointInRect, type Rect, type Vec } from './util';
import { squadCentre } from './squad';
import { sfx } from './audio';

export type ObjState = 'pending' | 'active' | 'complete' | 'failed';

export type MissionEvent =
  | { type: 'enemyKilled'; unit: Unit }
  | { type: 'structureDestroyed'; unit: Unit }
  | { type: 'soldierDowned'; unit: Unit }
  | { type: 'soldierKia'; unit: Unit }
  | { type: 'npcDamaged'; unit: Unit; amount: number }
  | { type: 'npcDowned'; unit: Unit }
  | { type: 'npcKia'; unit: Unit };

export interface HudLine { text: string; sub?: string; progress?: number }
export interface ObjPoint { pos: Vec; label: string; color: string }

export abstract class Objective {
  state: ObjState = 'pending';
  /** Mission.phase while this objective is the current primary (tools / tests read it). */
  phase = 'objective';
  constructor(readonly id: string, readonly label: string) {}

  activate(m: Mission, g: Game) {
    if (this.state !== 'pending') return;
    this.state = 'active';
    this.onStart(m, g);
  }
  protected onStart(_m: Mission, _g: Game) {}
  update(_m: Mission, _g: Game, _dt: number) {}
  onEvent(_m: Mission, _g: Game, _ev: MissionEvent) {}
  /** Mission end (victory or defeat): end-evaluated optionals decide here. */
  finalize(_m: Mission, _g: Game, _won: boolean) {}
  /** Primary objectives: the HUD line while current. */
  hud(_m: Mission, _g: Game): HudLine { return { text: this.label }; }
  /** Optional objectives: short live status ("2 left", "FAILED"...). */
  status(_m: Mission): string { return this.state === 'complete' ? 'DONE' : this.state === 'failed' ? 'FAILED' : ''; }
  point(_m: Mission, _g: Game): ObjPoint | null { return null; }
  draw(_ctx: CanvasRenderingContext2D, _m: Mission, _g: Game) {}

  complete(m: Mission, g: Game): boolean {
    if (this.state !== 'active') return false;
    this.state = 'complete';
    m.objectiveDone(this, g);
    return true;
  }
  fail(m: Mission, g: Game): boolean {
    if (this.state !== 'active') return false;
    this.state = 'failed';
    m.objectiveFailed(this, g);
    return true;
  }
}

const centreOf = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// ---------------------------------------------------------------------------------------
/** Eliminate every enemy of the given group tag(s). Counts kill EVENTS against the number spawned. */
export class EliminateObjective extends Objective {
  kills = 0;
  constructor(id: string, label: string, readonly tags: string[], readonly pointLabel = 'ENEMY') { super(id, label); this.phase = 'eliminate'; }
  total(m: Mission) { return this.tags.reduce((a, t) => a + (m.spawned.get(t) ?? 0), 0); }
  left(m: Mission) { return Math.max(0, this.total(m) - this.kills); }
  onEvent(m: Mission, g: Game, ev: MissionEvent) {
    if (this.state !== 'active' || ev.type !== 'enemyKilled' || !ev.unit.tag || !this.tags.includes(ev.unit.tag)) return;
    this.kills++;
    if (this.total(m) > 0 && this.left(m) === 0) this.complete(m, g);
  }
  hud(m: Mission) { const n = this.left(m); return { text: this.label, sub: n ? `Enemies left: ${n}` : undefined, progress: this.total(m) ? this.kills / this.total(m) : 0 }; }
  status(m: Mission): string { return this.state === 'complete' ? 'DONE' : this.total(m) ? `${this.left(m)} left` : ''; }
  point(_m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers);
    const alive = g.enemies.filter((e) => e.active && e.tag && this.tags.includes(e.tag));
    if (!alive.length || !c) return null;
    alive.sort((a, b) => dist(a.pos, c) - dist(b.pos, c));
    return { pos: alive[0].pos, label: this.pointLabel, color: '#ff7a5a' };
  }
}

/** Optional: eliminate a group (detour). Live count shown; completes on the last kill. */
export class EliminateOptional extends EliminateObjective {}

// ---------------------------------------------------------------------------------------
/** Destroy a structure (depot / relay): shoot it or grenade it. */
export class DestroyObjective extends Objective {
  target: Unit | null = null;
  constructor(id: string, label: string, readonly pos: Vec, readonly kind: string, readonly hp: number, readonly pointLabel: string) { super(id, label); this.phase = 'destroy'; }
  protected onStart(m: Mission, g: Game) {
    const t = g.spawnEnemy(this.pos);
    t.structure = this.kind; t.guard = true; t.setMaxHp(this.hp); t.tag = `${this.id}-target`; t.label = this.pointLabel;
    this.target = t;
    m.wrecks = m.wrecks.filter((w) => w.id !== this.id);
  }
  onEvent(m: Mission, g: Game, ev: MissionEvent) {
    if (ev.type !== 'structureDestroyed' || ev.unit !== this.target) return;
    if (!this.complete(m, g)) return;
    const p = ev.unit.pos;
    m.wrecks.push({ id: this.id, pos: { ...p }, kind: this.kind });
    g.fx.ring(p, 140, 'rgba(255,200,90,0.95)', 0.6, 8);
    g.fx.burst(p, 50, '#ffb347', 460, 0.8, 6);
    g.fx.burst(p, 26, '#555', 200, 1.2, 9);
    g.fx.shake = Math.max(g.fx.shake, 20);
    g.scorches.push({ ...p, r: 70 });
    sfx('boom');
  }
  hud() {
    const t = this.target;
    const f = t ? clamp(t.hp / t.maxHp, 0, 1) : 1;
    return { text: this.label, sub: t && t.hp < t.maxHp ? `${this.pointLabel}: ${Math.round(f * 100)}%` : 'Shoot it or use grenades', progress: 1 - f };
  }
  point(): ObjPoint | null { return this.target && this.target.active ? { pos: this.target.pos, label: this.pointLabel, color: '#ffd84a' } : null; }
}

// ---------------------------------------------------------------------------------------
/** Clear the defenders, then hold the zone (time inside accumulates; kept when nobody is inside). */
export class CaptureObjective extends Objective {
  holdProgress = 0;
  stage: 'clear' | 'hold' = 'clear';
  constructor(id: string, label: string, readonly zone: Rect, readonly hold: () => number, readonly pointLabel = 'OUTPOST') { super(id, label); this.phase = 'outpost'; }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    if (this.stage === 'clear') {
      if (m.defenders.filter((d) => d.active).length === 0) { this.stage = 'hold'; this.phase = 'hold'; m.phase = 'hold'; }
      return;
    }
    const inside = g.soldiers.some((s) => s.active && pointInRect(s.pos, this.zone));
    if (inside) this.holdProgress += dt; // progress pauses (is kept) when nobody is inside
    if (this.holdProgress >= this.hold()) this.complete(m, g);
  }
  hud(m: Mission, g: Game) {
    if (this.stage === 'clear') {
      const left = m.defenders.filter((d) => d.active).length;
      return { text: this.label, sub: left ? `Defenders: ${left}` : undefined };
    }
    const inside = g.soldiers.some((s) => s.active && pointInRect(s.pos, this.zone));
    return { text: inside ? 'Securing outpost...' : 'Get inside the outpost to secure it.', progress: this.holdProgress / this.hold() };
  }
  point(): ObjPoint { return { pos: centreOf(this.zone), label: this.pointLabel, color: '#ffd84a' }; }
  draw(ctx: CanvasRenderingContext2D) {
    const op = this.zone, live = this.state === 'active';
    ctx.setLineDash([10, 8]);
    ctx.fillStyle = live ? 'rgba(255,216,74,0.12)' : 'rgba(120,255,140,0.08)';
    ctx.fillRect(op.x, op.y, op.w, op.h);
    if (live && this.stage === 'hold') {
      ctx.fillStyle = 'rgba(255,216,74,0.25)';
      ctx.fillRect(op.x, op.y, op.w * clamp(this.holdProgress / this.hold(), 0, 1), op.h);
    }
    ctx.strokeStyle = live ? '#ffd84a' : '#7dff8a'; ctx.lineWidth = 3;
    ctx.strokeRect(op.x, op.y, op.w, op.h);
    ctx.setLineDash([]);
  }
}

// ---------------------------------------------------------------------------------------
/** Move the squad (centre) into a zone. */
export class ReachObjective extends Objective {
  constructor(id: string, label: string, readonly zone: Rect, readonly pointLabel: string) { super(id, label); this.phase = 'advance'; }
  update(m: Mission, g: Game) {
    const c = squadCentre(g.soldiers);
    if (this.state === 'active' && c && pointInRect(c, this.zone)) this.complete(m, g);
  }
  point(): ObjPoint { return { pos: centreOf(this.zone), label: this.pointLabel, color: '#ffd84a' }; }
  draw(ctx: CanvasRenderingContext2D) {
    if (this.state !== 'active') return;
    const z = this.zone;
    ctx.setLineDash([12, 10]); ctx.strokeStyle = 'rgba(255,216,74,0.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(z.x, z.y, z.w, z.h); ctx.setLineDash([]);
  }
}

// ---------------------------------------------------------------------------------------
export interface Wave { at: number; points: Vec[]; size: number; second?: boolean }
/** Survive for `duration` seconds while scheduled waves arrive (spawned out of view). */
export class SurviveObjective extends Objective {
  t = 0;
  private next = 0;
  constructor(id: string, label: string, readonly duration: number, readonly waves: Wave[], readonly startBanner: string) { super(id, label); this.phase = 'survive'; }
  protected onStart(_m: Mission, g: Game) { g.banner(this.startBanner, '#ff6040', 3.5); sfx('down'); }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    this.t += dt;
    while (this.next < this.waves.length && this.t >= this.waves[this.next].at) {
      const w = this.waves[this.next++];
      m.spawnWave(g, w.points, w.size, w.second);
    }
    if (this.t >= this.duration) this.complete(m, g);
  }
  hud() { const left = Math.max(0, this.duration - this.t); return { text: `${this.label}: ${Math.ceil(left)}s`, sub: 'Keep everyone alive: revive downed soldiers fast', progress: this.t / this.duration }; }
}

// ---------------------------------------------------------------------------------------
/** Stand next to the held captive for CFG.escort.freeTime seconds (progress kept when leaving). */
export class FreeCaptiveObjective extends Objective {
  progress = 0;
  constructor(id: string, label: string) { super(id, label); this.phase = 'free'; }
  update(m: Mission, g: Game, dt: number) {
    const c = m.npc;
    if (this.state !== 'active' || !c) return;
    const near = g.soldiers.some((s) => s.active && dist(s.pos, c.pos) < 70 && g.world.clear(s.pos, c.pos));
    if (near) this.progress += dt / CFG.escort.freeTime;
    if (this.progress >= 1) {
      this.progress = 1;
      c.escorting = true;
      g.fx.ring(c.pos, 50, 'rgba(120,255,140,0.9)', 0.5, 4);
      this.complete(m, g);
    }
  }
  hud(m: Mission, g: Game) {
    const c = m.npc;
    const near = !!c && g.soldiers.some((s) => s.active && dist(s.pos, c.pos) < 70);
    return { text: near ? 'Freeing the captive...' : this.label, sub: near ? undefined : 'Stand next to the captive', progress: this.progress };
  }
  point(m: Mission): ObjPoint | null { return m.npc ? { pos: m.npc.pos, label: 'CAPTIVE', color: '#7dd3ff' } : null; }
  draw(ctx: CanvasRenderingContext2D, m: Mission, g: Game) {
    const c = m.npc;
    if (this.state !== 'active' || !c) return;
    const pulse = 0.5 + 0.5 * Math.sin(g.clock * 4);
    ctx.strokeStyle = `rgba(125,211,255,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(c.pos.x, c.pos.y, 70, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if (this.progress > 0) {
      ctx.strokeStyle = '#7dff8a'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(c.pos.x, c.pos.y, 70, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.progress); ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------------------
/** Optional: every deployed soldier extracts (fails on the first KIA; decided at the end). */
export class AllExtractedOptional extends Objective {
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'soldierKia') this.fail(m, g); }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    if (won && g.soldiers.length > 0 && g.soldiers.every((s) => s.state === 'active')) this.complete(m, g);
    else this.fail(m, g);
  }
  status(m: Mission): string { return this.state === 'active' ? 'Everyone alive so far' : super.status(m); }
}

/** Optional: the escorted captive takes no damage (fails on the first hit; decided at the end). */
export class CaptiveUnharmedOptional extends Objective {
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'npcDamaged') this.fail(m, g); }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    if (won && m.npc && m.npc.escorting && m.npc.hp >= m.npc.maxHp) this.complete(m, g);
    else this.fail(m, g);
  }
  status(m: Mission): string { return this.state === 'active' ? (m.npc?.escorting ? 'Unharmed so far' : 'Not freed yet') : super.status(m); }
}
