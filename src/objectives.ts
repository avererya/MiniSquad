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
import type { EnemyKind } from './unit';

export type ObjState = 'pending' | 'active' | 'complete' | 'failed';

export type MissionEvent =
  | { type: 'enemyKilled'; unit: Unit }
  | { type: 'structureDestroyed'; unit: Unit }
  | { type: 'soldierDowned'; unit: Unit }
  | { type: 'soldierKia'; unit: Unit }
  | { type: 'npcDamaged'; unit: Unit; amount: number }
  | { type: 'npcDowned'; unit: Unit }
  | { type: 'npcKia'; unit: Unit }
  | { type: 'vehicleDestroyed'; unit: Unit }
  | { type: 'vehicleEscaped'; unit: Unit }
  | { type: 'bossDefeated'; unit: Unit };

/** v0.6.2 compact HUD widgets under the objective line (trucks, relays) and a meter (alarm). */
export interface HudChip { label: string; frac: number; state: 'idle' | 'live' | 'done' | 'lost' }
export interface HudMeter { label: string; frac: number; hot: boolean }
export interface HudLine { text: string; sub?: string; progress?: number; chips?: HudChip[]; meter?: HudMeter }
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
export interface Wave { at: number; points: Vec[]; size: number; second?: boolean; kinds?: EnemyKind[] }
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
      m.spawnWave(g, w.points, w.size, w.second, w.kinds);
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

// =======================================================================================
// v0.6.2 Chapter 2 objectives
// =======================================================================================

/**
 * Hold a zone for `duration` seconds of presence (time inside accumulates, kept when nobody is
 * inside) while a timed counterattack arrives (waves keyed to time since the hold began, spawned
 * out of view, from both ends where the script says so). Mission 6's bridge.
 */
export class HoldObjective extends Objective {
  held = 0;
  t = 0;
  private next = 0;
  constructor(id: string, label: string, readonly zone: Rect, readonly duration: number, readonly waves: Wave[], readonly startBanner: string, readonly pointLabel = 'HOLD') { super(id, label); this.phase = 'hold'; }
  protected onStart(_m: Mission, g: Game) { g.banner(this.startBanner, '#ff6040', 3.2); sfx('down'); }
  inside(g: Game) { return g.soldiers.some((s) => s.active && pointInRect(s.pos, this.zone)); }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    this.t += dt;
    while (this.next < this.waves.length && this.t >= this.waves[this.next].at) {
      const w = this.waves[this.next++];
      m.spawnWave(g, w.points, w.size, w.second, w.kinds);
    }
    if (this.inside(g)) this.held += dt;
    if (this.held >= this.duration) this.complete(m, g);
  }
  hud(_m: Mission, g: Game) {
    const left = Math.max(0, this.duration - this.held);
    return { text: `${this.label}: ${Math.ceil(left)}s`, sub: this.inside(g) ? 'Counterattack from both banks — hold your ground' : 'Get a soldier into the zone to keep the hold going', progress: this.held / this.duration };
  }
  point(): ObjPoint { return { pos: centreOf(this.zone), label: this.pointLabel, color: '#ffd84a' }; }
  draw(ctx: CanvasRenderingContext2D) {
    const z = this.zone, live = this.state === 'active';
    if (this.state === 'complete') return;
    ctx.setLineDash([10, 8]);
    ctx.fillStyle = live ? 'rgba(255,216,74,0.14)' : 'rgba(255,216,74,0.06)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    if (live) { ctx.fillStyle = 'rgba(255,216,74,0.25)'; ctx.fillRect(z.x, z.y, z.w * clamp(this.held / this.duration, 0, 1), z.h); }
    ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 3; ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([]);
  }
}

/** Optional: no soldier becomes KIA (a downed soldier who is revived still counts). Decided at the end (or `doneOn` event). */
export class NoKiaOptional extends Objective {
  constructor(id: string, label: string, readonly doneOn: MissionEvent['type'] | null = null) { super(id, label); }
  onEvent(m: Mission, g: Game, ev: MissionEvent) {
    if (ev.type === 'soldierKia') this.fail(m, g);
    else if (this.doneOn && ev.type === this.doneOn) this.complete(m, g);
  }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    if (won && !g.soldiers.some((s) => s.state === 'kia')) this.complete(m, g); else this.fail(m, g);
  }
  status(m: Mission): string { return this.state === 'active' ? 'No KIA so far' : super.status(m); }
}

/** Optional: the escorted prisoner is never downed (tracked independently of whether they survive). */
export class CaptiveNeverDownedOptional extends Objective {
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'npcDowned') this.fail(m, g); }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    if (won && m.npc && m.npc.escorting) this.complete(m, g); else this.fail(m, g);
  }
  status(m: Mission): string { return this.state === 'active' ? (m.npc?.escorting ? 'Never downed so far' : 'Not freed yet') : super.status(m); }
}

/**
 * Destroy several structures in any order (Mission 10's installations; base of the relays).
 * Each target is a structure Unit (shoot it when no enemy soldier is in sight, or grenade it).
 */
export class MultiDestroyObjective extends Objective {
  targets: Unit[] = [];
  destroyed = 0;
  constructor(id: string, label: string, readonly points: Vec[], readonly kind: string, readonly hp: number, readonly pointLabel: string) { super(id, label); this.phase = 'destroy'; }
  protected onStart(m: Mission, g: Game) {
    this.targets = this.points.map((p, i) => {
      const t = g.spawnEnemy(p);
      t.structure = this.kind; t.guard = true; t.setMaxHp(this.hp); t.tag = `${this.id}-target`; t.label = `${this.pointLabel} ${i + 1}`;
      return t;
    });
    m.wrecks = m.wrecks.filter((w) => !w.id.startsWith(this.id));
  }
  get left() { return this.targets.filter((t) => t.active).length; }
  onEvent(m: Mission, g: Game, ev: MissionEvent) {
    if (this.state !== 'active' || ev.type !== 'structureDestroyed' || !this.targets.includes(ev.unit)) return;
    this.destroyed++;
    const p = ev.unit.pos;
    m.wrecks.push({ id: `${this.id}-${this.targets.indexOf(ev.unit)}`, pos: { ...p }, kind: this.kind });
    g.fx.ring(p, 120, 'rgba(255,200,90,0.95)', 0.5, 7);
    g.fx.burst(p, 40, '#ffb347', 420, 0.7, 6);
    g.fx.burst(p, 20, '#555', 180, 1.1, 8);
    g.fx.shake = Math.max(g.fx.shake, 16);
    g.scorches.push({ ...p, r: 60 });
    sfx('boom');
    this.onTargetDown(m, g, ev.unit);
    if (this.left === 0) this.complete(m, g);
  }
  protected onTargetDown(_m: Mission, g: Game, _u: Unit) {
    if (this.left > 0) g.banner(`${this.pointLabel} DESTROYED — ${this.left} LEFT`, '#7dff8a', 2.5);
  }
  chips(): HudChip[] { return this.targets.map((t, i) => ({ label: `${this.pointLabel[0]}${i + 1}`, frac: t.active ? clamp(t.hp / t.maxHp, 0, 1) : 0, state: t.active ? 'live' : 'done' })); }
  hud() { return { text: this.label, sub: `${this.left} of ${this.targets.length} left · shoot or grenade them`, chips: this.chips() }; }
  point(_m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const alive = this.targets.filter((t) => t.active).sort((a, b) => dist(a.pos, c) - dist(b.pos, c));
    return alive[0] ? { pos: alive[0].pos, label: this.pointLabel, color: '#ffd84a' } : null;
  }
}

/**
 * Mission 9: three communications relays, any order. While relays stay up the facility calls
 * reinforcements: the fewer relays, the slower and smaller the waves (none once all are down). An
 * ALARM meter rises faster with more relays up (the optional objective: finish before it maxes).
 * Living reinforcements are capped so enemies never pile up without limit.
 */
export const ALARM = {
  /** Alarm points per second by relays still up [0, 1, 2, 3]; the meter maxes at 100. */
  rate: [0, 0.3, 0.5, 0.75],
  /** Seconds between reinforcement waves by relays still up. */
  interval: [Infinity, 32, 22, 15],
  /** Wave size by relays still up (+1 above 60 alarm while 2+ relays are up). */
  size: [0, 2, 3, 3],
  firstWave: 14,
  /** No new wave while this many enemy soldiers are alive. */
  cap: 12,
};
export class RelaysObjective extends MultiDestroyObjective {
  alarm = 0;
  waveT = ALARM.firstWave;
  waves = 0;
  maxedAt: number | null = null;
  constructor(id: string, label: string, points: Vec[], hp: number, readonly spawnPoints: Vec[]) { super(id, label, points, 'relay', hp, 'RELAY'); }
  get up() { return this.targets.length ? this.left : 3; }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    const up = this.up;
    this.alarm = Math.min(100, this.alarm + ALARM.rate[up] * dt);
    if (this.alarm >= 100 && this.maxedAt === null) { this.maxedAt = g.time; g.banner('ALARM AT MAXIMUM', '#ff6040', 2.5); sfx('alarm'); }
    if (up <= 0) return;
    this.waveT -= dt;
    if (this.waveT > 0) return;
    const alive = g.enemies.filter((e) => e.active && !e.structure && !e.vehicle).length;
    if (alive >= ALARM.cap) { this.waveT = 5; return; }
    const n = ALARM.size[up] + (up >= 2 && this.alarm > 60 ? 1 : 0);
    m.spawnWave(g, this.spawnPoints, n);
    this.waves++;
    this.waveT = ALARM.interval[up];
    sfx('alarm');
  }
  protected onTargetDown(_m: Mission, g: Game) {
    const up = this.left;
    if (up > 0) g.banner(`RELAY DOWN — ${up} LEFT · REINFORCEMENTS REDUCED`, '#7dff8a', 3);
    else g.banner('ALL RELAYS DOWN — THE ALARM IS SILENT', '#7dff8a', 3);
    this.waveT = Math.max(this.waveT, 6);
  }
  hud() {
    return {
      text: this.label, sub: `Relays up: ${this.left}/3 · ${this.left === 3 ? 'heavy' : this.left === 2 ? 'moderate' : 'light'} reinforcements`,
      chips: this.chips(), meter: { label: 'ALARM', frac: this.alarm / 100, hot: this.alarm >= 70 },
    };
  }
}
/** Optional (Mission 9): every relay down before the alarm reaches maximum. */
export class AlarmOptional extends Objective {
  constructor(id: string, label: string, readonly relays: () => RelaysObjective | null) { super(id, label); }
  update(m: Mission, g: Game) {
    const r = this.relays();
    if (this.state !== 'active' || !r) return;
    if (r.maxedAt !== null && r.left > 0) this.fail(m, g);
    else if (r.state === 'complete' && r.maxedAt === null) this.complete(m, g);
  }
  finalize(m: Mission, g: Game) { if (this.state === 'active') this.fail(m, g); }
  status(m: Mission): string {
    const r = this.relays();
    return this.state === 'active' && r ? `alarm ${Math.floor(r.alarm)}%` : super.status(m);
  }
}

/**
 * Mission 8: stop the convoy. `need` trucks destroyed completes it; once more than total - need
 * have escaped the mission fails. The convoy itself (movement, escorts) lives on the Mission
 * (convoy.ts), so it keeps rolling after the primary is done (the optional third truck).
 */
export class ConvoyObjective extends Objective {
  constructor(id: string, label: string, readonly need: number) { super(id, label); this.phase = 'convoy'; }
  protected onStart(m: Mission, g: Game) { m.convoy?.launch(g); }
  update(m: Mission, g: Game) {
    const c = m.convoy;
    if (this.state !== 'active' || !c) return;
    if (c.destroyed >= this.need) { this.complete(m, g); return; }
    if (c.escaped > c.trucks.length - this.need) { m.failReason = 'The convoy escaped.'; g.fail(); }
  }
  hud(m: Mission) {
    const c = m.convoy!;
    const live = c.trucks.filter((t) => t.state === 'moving' || t.state === 'waiting').length;
    return {
      text: this.label, sub: `Destroyed ${c.destroyed}/${this.need} needed · ${c.escaped} escaped · ${live} on the road`,
      chips: c.trucks.map((t, i) => ({ label: `T${i + 1}`, frac: t.state === 'destroyed' ? 0 : t.unit ? clamp(t.unit.hp / t.unit.maxHp, 0, 1) : 1, state: t.state === 'destroyed' ? 'done' as const : t.state === 'escaped' ? 'lost' as const : t.state === 'waiting' ? 'idle' as const : 'live' as const })),
    };
  }
  point(m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const t = m.convoy?.trucks.filter((x) => x.state === 'moving' && x.unit).sort((a, b) => dist(a.unit!.pos, c) - dist(b.unit!.pos, c))[0];
    return t ? { pos: t.unit!.pos, label: 'TRUCK', color: '#ffd84a' } : null;
  }
}
/** Optional (Mission 8): destroy all three trucks (fails on the first escape). */
export class ConvoyAllOptional extends Objective {
  update(m: Mission, g: Game) {
    const c = m.convoy;
    if (this.state !== 'active' || !c) return;
    if (c.escaped > 0) this.fail(m, g);
    else if (c.destroyed >= c.trucks.length) this.complete(m, g);
  }
  finalize(m: Mission, g: Game) { if (this.state === 'active') this.fail(m, g); }
  status(m: Mission): string { const c = m.convoy; return this.state === 'active' && c ? `${c.trucks.length - c.destroyed} left` : super.status(m); }
  point(m: Mission, g: Game): ObjPoint | null {
    // only once the primary is done (then the autopilot / arrows chase the last truck)
    if (m.currentObjective) return null;
    const c = squadCentre(g.soldiers) ?? g.cam;
    const t = m.convoy?.trucks.filter((x) => x.state === 'moving' && x.unit).sort((a, b) => dist(a.unit!.pos, c) - dist(b.unit!.pos, c))[0];
    return t ? { pos: t.unit!.pos, label: 'TRUCK', color: '#7dd3ff' } : null;
  }
}

/** Mission 10: defeat the boss (the controller in boss.ts runs the fight). */
export class BossObjective extends Objective {
  constructor(id: string, label: string, readonly spawn: Vec) { super(id, label); this.phase = 'boss'; }
  protected onStart(m: Mission, g: Game) { m.startBoss(g, this.spawn); }
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'bossDefeated') this.complete(m, g); }
  hud(m: Mission) {
    const b = m.boss;
    return { text: this.label, sub: b?.rocket ? 'ROCKET INCOMING — get out of the red circle!' : b?.phase === 'windup' ? 'Machine gun winding up — move sideways or take cover' : undefined };
  }
  point(m: Mission): ObjPoint | null { const u = m.boss?.unit; return u && u.active ? { pos: u.pos, label: 'WARDEN', color: '#ff7a5a' } : null; }
}
