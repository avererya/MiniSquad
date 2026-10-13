// v0.8B DEFENSE SYSTEMS (Mission 13 "Hold the Line"; built to be reused by later defense missions).
//
//  - Friendly mission assets (Game.spawnAsset): the command center and automated turrets are team 'squad' units
//    that are not soldiers (no XP, training, casualty record or deployment slot). Enemies shoot them, squad rounds
//    pass through them, they never move and push movers out. Turrets fire through the ordinary updateWeapon with
//    CFG.turret stats (nearest visible enemy, line of sight, no friendly fire). A destroyed asset leaves a wreck.
//  - PrepareDefenseObjective: optional turret caches (clear the defenders, stand in the zone CFG.defense.cacheTime
//    s: progress kept, like the M11 zones). Each secured cache installs exactly one turret at a fixed slot near the
//    command center and sends one finite response group, once. No time limit: the assault starts only when a
//    standing soldier stays in the command zone for CFG.defense.zoneTime CONTINUOUS seconds (leaving resets it).
//    Then the gates close (Mission.closeGates) and the caches lock.
//  - WaveController / WaveDefenseObjective: finite waves, each announced CFG.defense.warn s ahead (banner, edge
//    marker, HUD countdown), arriving in staggered groups from off-screen points of its direction. v0.8B.1: waves
//    OVERLAP. Wave-start intervals run start to start: at least CFG.defense.minGap s, early once at most
//    CFG.defense.nextWhenLeft attackers of the current wave remain, at most CFG.defense.maxGap s whatever is left.
//    About CFG.defense.siegeShare (80%) of riflemen / armored troopers press the command center (SiegeTargeting).
//    Complete when every wave has spawned and every wave attacker is down.
//  - AssetHpOptional: an asset must finish with at least a share of its max HP (no healing exists, so it fails
//    the moment it drops below).
import { CFG } from './config';
import type { Game } from './game';
import type { Mission } from './mission';
import type { Unit, EnemyKind } from './unit';
import { Objective, type HudChip, type HudLine, type HudMeter, type MissionEvent, type ObjPoint } from './objectives';
import { clamp, dist, pointInRect, type Rect, type Vec } from './util';
import { squadCentre } from './squad';
import { sfx } from './audio';
import { NearestVisible, SiegeTargeting } from './targeting';

const centreOf = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** HUD meter of a protected asset (command center, truck): % and "hp/max". */
export function assetMeter(u: Unit | null, label: string): HudMeter | undefined {
  if (!u) return undefined;
  const frac = u.state === 'dead' ? 0 : clamp(u.hp / u.maxHp, 0, 1);
  return { label, frac, hot: frac < 0.5, value: `${Math.max(0, Math.ceil(u.state === 'dead' ? 0 : u.hp))}/${Math.round(u.maxHp)}` };
}

/** Standing soldiers on foot (a mounted gunner can't hold a zone). */
export const footSoldiers = (g: Game) => g.soldiers.filter((s) => s.active && !s.mount);

// =======================================================================================
// Preparation: optional turret caches + the command zone that starts the assault
// =======================================================================================

export interface TurretCache {
  id: string; name: string; short: string; rect: Rect;
  /** Group tag of its defenders (script groups). */
  tag: string;
  /** Where its turret is installed (near the command center). */
  slot: Vec;
  /** The finite response group sent once when it is secured (from another direction). */
  response: { points: Vec[]; kinds: EnemyKind[] };
}

export class PrepareDefenseObjective extends Objective {
  secured = new Set<string>();
  progress = new Map<string, number>();
  /** Continuous seconds a standing soldier has been in the command zone (reset on leaving). */
  zoneT = 0;
  turrets: Unit[] = [];
  responses = 0;
  responseUnits: Unit[] = [];
  constructor(id: string, label: string, readonly caches: TurretCache[], readonly zone: Rect, readonly onBegin: (m: Mission, g: Game) => void) { super(id, label); this.phase = 'prepare'; }
  defendersLeft(g: Game, c: TurretCache) { let n = 0; for (const e of g.enemies) if (e.active && e.tag === c.tag) n++; return n; }
  cacheInside(g: Game, c: TurretCache) { return footSoldiers(g).some((s) => pointInRect(s.pos, c.rect)); }
  zoneInside(g: Game) { return footSoldiers(g).some((s) => pointInRect(s.pos, this.zone)); }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    for (const c of this.caches) {
      if (this.secured.has(c.id) || this.defendersLeft(g, c) > 0 || !this.cacheInside(g, c)) continue;
      const p = (this.progress.get(c.id) ?? 0) + dt;
      this.progress.set(c.id, p);
      if (p >= CFG.defense.cacheTime) this.secure(m, g, c);
    }
    this.zoneT = this.zoneInside(g) ? this.zoneT + dt : 0;
    if (this.zoneT >= CFG.defense.zoneTime) {
      this.complete(m, g);
      this.onBegin(m, g);
    }
  }
  /** One cache, once: install its turret and send its response group. */
  private secure(m: Mission, g: Game, c: TurretCache) {
    if (this.secured.has(c.id)) return;
    this.secured.add(c.id);
    const t = g.spawnAsset('turret', c.slot, `TURRET ${c.id.toUpperCase()}`);
    this.turrets.push(t);
    g.fx.ring(centreOf(c.rect), 120, 'rgba(120,200,255,0.9)', 0.6, 5);
    g.fx.ring(t.pos, 70, 'rgba(120,200,255,0.9)', 0.6, 4);
    const units = m.spawnWave(g, c.response.points, c.response.kinds.length, false, c.response.kinds);
    for (const u of units) u.tag = `${c.tag}-response`;
    this.responseUnits.push(...units);
    this.responses++;
    if (units.length) m.incoming.push({ pos: { ...units[0].pos }, life: 5 });
    g.banner(`${c.name.toUpperCase()} SECURED — TURRET INSTALLED AT THE COMMAND CENTER`, '#7dd3ff', 3.2);
    g.banner('ENEMY RESPONSE TEAM INBOUND', '#ffb347', 3);
    sfx('pickup');
  }
  chips(g: Game): HudChip[] {
    const out: HudChip[] = this.caches.map((c) => {
      const done = this.secured.has(c.id);
      return { label: c.short, frac: done ? 1 : this.defendersLeft(g, c) ? 0 : clamp((this.progress.get(c.id) ?? 0) / CFG.defense.cacheTime, 0, 1), state: done ? 'done' : 'idle' };
    });
    out.push({ label: 'START', frac: clamp(this.zoneT / CFG.defense.zoneTime, 0, 1), state: this.zoneT > 0 ? 'live' : 'idle' });
    return out;
  }
  hud(m: Mission, g: Game): HudLine {
    const here = this.caches.find((c) => !this.secured.has(c.id) && this.cacheInside(g, c));
    let sub: string;
    if (this.zoneT > 0) sub = `Starting the assault… ${Math.ceil(CFG.defense.zoneTime - this.zoneT)}s — stay in the command zone`;
    else if (here) sub = this.defendersLeft(g, here) ? `${here.name}: clear ${this.defendersLeft(g, here)} defenders` : `Securing ${here.name}…`;
    else sub = `Turret caches (optional): ${this.secured.size}/${this.caches.length} · stand in the command zone ${CFG.defense.zoneTime}s to start the assault`;
    return { text: this.label, sub, chips: this.chips(g), meter: assetMeter(m.protected, 'COMMAND') };
  }
  point(_m: Mission, g: Game): ObjPoint | null {
    // the arrow leads to the nearest open cache, then to the command zone (both optional caches can be skipped)
    const c = squadCentre(g.soldiers) ?? g.cam;
    const open = this.caches.filter((x) => !this.secured.has(x.id)).sort((a, b) => dist(centreOf(a.rect), c) - dist(centreOf(b.rect), c))[0];
    if (open && dist(centreOf(open.rect), c) < 900) return { pos: centreOf(open.rect), label: open.short, color: '#7dd3ff' };
    return { pos: centreOf(this.zone), label: 'START', color: '#ffd84a' };
  }
  draw(ctx: CanvasRenderingContext2D, _m: Mission, g: Game) {
    const live = this.state === 'active';
    for (const c of this.caches) {
      const r = c.rect, done = this.secured.has(c.id), held = !done && this.defendersLeft(g, c) > 0;
      if (!live && !done) continue; // locked once the assault starts
      ctx.setLineDash([10, 8]);
      ctx.fillStyle = done ? 'rgba(125,211,255,0.08)' : held ? 'rgba(255,90,60,0.08)' : 'rgba(125,211,255,0.14)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const p = clamp((this.progress.get(c.id) ?? 0) / CFG.defense.cacheTime, 0, 1);
      if (!done && !held && p > 0) { ctx.fillStyle = 'rgba(125,211,255,0.25)'; ctx.fillRect(r.x, r.y, r.w * p, r.h); }
      ctx.strokeStyle = done ? '#7dd3ff' : held ? '#ff7a5a' : '#7dd3ff'; ctx.lineWidth = 3;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
      // the cache: a crate stack with a turret silhouette
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      if (!done) {
        ctx.fillStyle = '#5b6a7a'; ctx.fillRect(cx - 22, cy - 18, 44, 26);
        ctx.fillStyle = '#7a8b9c'; ctx.fillRect(cx - 22, cy - 26, 44, 9);
        ctx.strokeStyle = '#2b3138'; ctx.lineWidth = 2; ctx.strokeRect(cx - 22, cy - 26, 44, 34);
        ctx.fillStyle = '#2b3138'; ctx.fillRect(cx - 4, cy - 40, 8, 14); ctx.fillRect(cx, cy - 40, 22, 5);
      }
      ctx.fillStyle = done ? '#7dd3ff' : held ? '#ff9a7a' : '#bfe8ff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(done ? `${c.short} · SECURED` : held ? `${c.short} · GUARDED` : `${c.short} · SECURE IT`, cx, r.y - 12);
    }
    if (!live) return;
    // command zone: progress fills left to right; a bright frame while someone is in it
    const z = this.zone, f = clamp(this.zoneT / CFG.defense.zoneTime, 0, 1), on = this.zoneT > 0;
    const pulse = 0.5 + 0.5 * Math.sin(g.clock * 4);
    ctx.fillStyle = `rgba(255,216,74,${0.1 + 0.08 * pulse})`; ctx.fillRect(z.x, z.y, z.w, z.h);
    if (f > 0) { ctx.fillStyle = 'rgba(255,216,74,0.35)'; ctx.fillRect(z.x, z.y, z.w * f, z.h); }
    ctx.setLineDash(on ? [] : [10, 8]); ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = on ? 4 : 3; ctx.strokeRect(z.x, z.y, z.w, z.h); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(on ? `STARTING ASSAULT ${Math.ceil(CFG.defense.zoneTime - this.zoneT)}s` : `COMMAND ZONE · HOLD ${CFG.defense.zoneTime}s`, z.x + z.w / 2, z.y + z.h + 14);
  }
}

// =======================================================================================
// Finite defense waves
// =======================================================================================

/** One staggered group of a wave: `at` s after the wave's warning ends, from off-screen points of the wave's direction. */
export interface WaveGroup { at: number; points: Vec[]; kinds: EnemyKind[] }
export interface DefenseWaveDef { from: string; groups: WaveGroup[] }
export type WaveStage = 'idle' | 'warning' | 'arriving' | 'fighting' | 'done';

/**
 * v0.8B.1 OVERLAPPING FINITE WAVES. A wave STARTS when it is announced (banner, edge markers); its groups arrive
 * CFG.defense.warn s later, staggered by their `at`. Wave-start intervals are measured start to start on one clock
 * (never from the last spawn): the next wave starts at least minGap s after the current one started, early once at
 * most nextWhenLeft of the current wave's attackers remain (alive + not yet arrived), and at the latest maxGap s
 * after it started, whatever is still alive. Attackers of earlier waves keep fighting (never despawned), so a slow
 * defense faces several waves at once. Every wave starts exactly once; nothing respawns. Complete when every wave
 * has started, every group has arrived and every wave attacker is down. About CFG.defense.siegeShare of each
 * wave's riflemen / armored troopers are siege attackers (SiegeTargeting: the command center first).
 */
export class WaveController {
  /** Latest wave that has started (-1 before the first). */
  index = -1;
  /** Controller clock (s since the defense started; simulation time). */
  clock = 0;
  /** Clock time each wave started (-1 = not yet). */
  starts: number[];
  /** Groups of each wave that have arrived. */
  private arrived: number[];
  /** Riflemen / armored troopers spawned per wave so far (siege share bookkeeping). */
  private melee: number[];
  /** Attackers per wave (spawned so far). */
  units: Unit[][];
  private finished = false;
  constructor(readonly waves: DefenseWaveDef[], readonly tag = 'wave') {
    this.units = waves.map(() => []);
    this.starts = waves.map(() => -1);
    this.arrived = waves.map(() => 0);
    this.melee = waves.map(() => 0);
  }
  planned(i: number) { return this.waves[i].groups.reduce((b, gr) => b + gr.kinds.length, 0); }
  get spawnedCount() { return this.units.reduce((a, u) => a + u.length, 0); }
  get plannedCount() { return this.waves.reduce((a, _w, i) => a + this.planned(i), 0); }
  /** Every group of wave i has arrived. */
  arrivedAll(i: number) { return this.arrived[i] >= this.waves[i].groups.length; }
  get allSpawned() { return this.waves.every((_w, i) => this.starts[i] >= 0 && this.arrivedAll(i)); }
  left(i = this.index) { let n = 0; for (const u of this.units[i] ?? []) if (u.active) n++; return n; }
  /** Attackers of wave i still to beat: alive plus not yet arrived. */
  remaining(i = this.index) { return i < 0 ? 0 : this.left(i) + this.planned(i) - this.units[i].length; }
  get totalLeft() { let n = 0; for (const w of this.units) for (const u of w) if (u.active) n++; return n; }
  /** Waves started whose attackers are still fighting. */
  get liveWaves() { let n = 0; this.units.forEach((_u, i) => { if (this.starts[i] >= 0 && this.remaining(i) > 0) n++; }); return n; }
  get done() { return this.finished; }
  /** Seconds since wave i started. */
  since(i = this.index) { return i < 0 || this.starts[i] < 0 ? 0 : this.clock - this.starts[i]; }
  /** Stage of the latest wave (HUD / tools). */
  get stage(): WaveStage {
    if (this.finished) return 'done';
    if (this.index < 0) return 'idle';
    if (this.since() < CFG.defense.warn) return 'warning';
    return this.arrivedAll(this.index) ? 'fighting' : 'arriving';
  }
  /** Warning: seconds until the latest wave arrives; otherwise seconds since it started. */
  get t() { return this.stage === 'warning' ? CFG.defense.warn - this.since() : this.since(); }
  /** Seconds until the next wave starts at the latest (the hard maximum), null when none is left. */
  get nextAtLatest(): number | null { return this.index < 0 || this.index >= this.waves.length - 1 ? null : Math.max(0, CFG.defense.maxGap - this.since()); }
  start(m: Mission, g: Game) { if (this.index < 0) this.begin(m, g, 0); }
  private begin(m: Mission, g: Game, i: number) {
    if (this.starts[i] >= 0) return; // each wave starts exactly once
    this.index = i; this.starts[i] = this.clock;
    const w = this.waves[i];
    const last = i === this.waves.length - 1;
    const still = i > 0 ? this.totalLeft : 0;
    g.banner(last ? `FINAL ASSAULT INBOUND FROM ${w.from}` : `WAVE ${i + 1} OF ${this.waves.length} INBOUND FROM THE ${w.from}${still ? ` — ${still} ATTACKERS STILL IN THE FIELD` : ''}`, last ? '#ff6040' : '#ffb347', 3.2);
    sfx('alarm');
    const seen = new Set<string>();
    for (const gr of w.groups) { const p = gr.points[0], k = `${p.x},${p.y}`; if (!seen.has(k)) { seen.add(k); m.incoming.push({ pos: { ...p }, life: CFG.defense.warn + 1 }); } }
  }
  update(m: Mission, g: Game, dt: number) {
    if (this.index < 0 || this.finished) return;
    const D = CFG.defense;
    this.clock += dt;
    // arrivals of every started wave (an earlier wave may still be arriving when the next one starts)
    for (let i = 0; i <= this.index; i++) {
      const w = this.waves[i], t = this.since(i) - D.warn;
      while (t >= 0 && this.arrived[i] < w.groups.length && t >= w.groups[this.arrived[i]].at) {
        const gr = w.groups[this.arrived[i]++];
        const us = m.spawnWave(g, gr.points, gr.kinds.length, false, gr.kinds);
        for (const u of us) {
          u.tag = this.tag;
          if (u.kind === 'sniper') continue; // snipers pick exposed soldiers from range
          // siege share by cumulative rounding: after n riflemen / armored, round(n x share) of them are siege attackers
          const n = ++this.melee[i];
          if (Math.round(n * D.siegeShare) > Math.round((n - 1) * D.siegeShare)) { u.targeting = SiegeTargeting; u.advancer = false; }
        }
        this.units[i].push(...us);
        m.spawned.set(this.tag, (m.spawned.get(this.tag) ?? 0) + us.length);
      }
    }
    // the next wave: never sooner than minGap after the current one started; early when few of it remain; at maxGap regardless
    const i = this.index;
    if (i < this.waves.length - 1) {
      const el = this.since(i);
      if ((el >= D.minGap && this.remaining(i) <= D.nextWhenLeft) || el >= D.maxGap) this.begin(m, g, i + 1);
    } else if (this.allSpawned && this.totalLeft === 0) {
      this.finished = true;
    }
  }
  /** Nearest living attacker (arrows / autopilot). */
  nearest(c: Vec): Unit | null {
    let best: Unit | null = null, bd = Infinity;
    for (const w of this.units) for (const u of w) if (u.active) { const d = dist(u.pos, c); if (d < bd) { bd = d; best = u; } }
    return best;
  }
}

/**
 * v0.8B.1 a siege attacker that is shot by a soldier (or a resistance ally) while it is firing at the command
 * center turns on that shooter when it can see them in range (the normal targeting rules: no wall-hacks, no
 * map-wide knowledge). Once the shooter is out of sight, out of range or down, SiegeTargeting picks the command
 * center again. Going out to engage the siege line draws its fire: aggressive defense is rewarded.
 */
export function siegeAnswer(g: Game, u: Unit, source: Unit | undefined) {
  if (!source || source.asset || source.team !== 'squad' || u.targeting !== SiegeTargeting || !u.active) return;
  if (!u.target?.asset || !source.targetable || !NearestVisible.isValid(u, source, g)) return;
  u.target = source;
  u.reactionLeft = Math.max(u.reactionLeft, u.reactionTime);
}

export class WaveDefenseObjective extends Objective {
  readonly waves: WaveController;
  constructor(id: string, label: string, waves: DefenseWaveDef[], readonly protectLabel = 'COMMAND') { super(id, label); this.phase = 'defend'; this.waves = new WaveController(waves); }
  protected onStart(m: Mission, g: Game) {
    // enemies converge on the squad AND the protected asset
    if (m.protected) m.flowExtra = [m.protected.pos];
    this.waves.start(m, g);
  }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    this.waves.update(m, g, dt);
    if (this.waves.done) {
      m.flowExtra = [];
      g.banner('THE LINE HELD — ALL ASSAULTS REPELLED', '#7dff8a', 3.5);
      this.complete(m, g);
    }
  }
  chips(): HudChip[] {
    const W = this.waves;
    return W.waves.map((_, i) => {
      const started = W.starts[i] >= 0, rem = W.remaining(i), n = W.planned(i);
      return { label: `W${i + 1}`, frac: !started ? 0 : 1 - rem / Math.max(1, n), state: !started ? 'idle' : rem === 0 ? 'done' : 'live' };
    });
  }
  hud(m: Mission): HudLine {
    const W = this.waves, n = W.waves.length, i = W.index;
    const next = W.nextAtLatest;
    const tail = next !== null ? ` · wave ${i + 2} in ≤${Math.ceil(next)}s` : '';
    let sub: string;
    if (W.stage === 'warning') sub = `Wave ${i + 1}/${n} from the ${W.waves[i].from.toLowerCase()} in ${Math.ceil(W.t)}s${W.totalLeft ? ` · ${W.totalLeft} still attacking` : ''}`;
    else if (W.stage === 'arriving') sub = `Wave ${i + 1}/${n} arriving from the ${W.waves[i].from.toLowerCase()} · attackers: ${W.totalLeft}${tail}`;
    else sub = i === n - 1 ? `Final wave · attackers left: ${W.totalLeft}` : `Wave ${i + 1}/${n} · attackers left: ${W.totalLeft}${tail}`;
    return { text: `${this.label}: wave ${Math.max(1, i + 1)}/${n}`, sub, chips: this.chips(), meter: assetMeter(m.protected, this.protectLabel) };
  }
  point(m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const u = this.waves.nearest(c);
    if (u) return { pos: u.pos, label: 'ATTACKERS', color: '#ff7a5a' };
    return m.protected ? { pos: m.protected.pos, label: 'COMMAND', color: '#c9e08a' } : null;
  }
}

/** Optional: a protected asset (command center / truck) finishes with at least `frac` of its max HP. */
export class AssetHpOptional extends Objective {
  constructor(id: string, label: string, readonly asset: (m: Mission) => Unit | null, readonly frac = 0.5, readonly pending = 'Not in play yet') { super(id, label); }
  ok(m: Mission) { const u = this.asset(m); return !!u && u.state !== 'dead' && u.hp >= u.maxHp * this.frac; }
  update(m: Mission, g: Game) { const u = this.asset(m); if (this.state === 'active' && u && !this.ok(m)) this.fail(m, g); }
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'assetDestroyed' && ev.unit === this.asset(m)) this.fail(m, g); }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    if (won && this.ok(m)) this.complete(m, g); else this.fail(m, g);
  }
  status(m: Mission): string {
    if (this.state !== 'active') return super.status(m);
    const u = this.asset(m);
    return u ? `${Math.round((u.hp / u.maxHp) * 100)}% now` : this.pending;
  }
}
