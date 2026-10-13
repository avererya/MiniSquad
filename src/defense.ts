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
//    marker, HUD countdown), arriving in staggered groups from off-screen points of its direction. The next wave
//    is announced once at most CFG.defense.nextWhenLeft attackers of the current one are left (and at least
//    CFG.defense.minGap s after its last group arrived: a short breather), or CFG.defense.maxGap s after its last
//    group arrived. Two in three riflemen / armored troopers press the command center (SiegeTargeting). Complete
//    when every wave has spawned and every wave attacker is down.
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
import { SiegeTargeting } from './targeting';

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

export class WaveController {
  index = -1;
  stage: WaveStage = 'idle';
  /** Stage clock (warning: seconds left; arriving: since arrival began; fighting: since the last group arrived). */
  t = 0;
  private nextGroup = 0;
  /** Attackers per wave (spawned so far). */
  units: Unit[][];
  constructor(readonly waves: DefenseWaveDef[], readonly tag = 'wave') { this.units = waves.map(() => []); }
  get spawnedCount() { return this.units.reduce((a, u) => a + u.length, 0); }
  get plannedCount() { return this.waves.reduce((a, w) => a + w.groups.reduce((b, gr) => b + gr.kinds.length, 0), 0); }
  get allSpawned() { return this.index === this.waves.length - 1 && (this.stage === 'fighting' || this.stage === 'done'); }
  left(i = this.index) { let n = 0; for (const u of this.units[i] ?? []) if (u.active) n++; return n; }
  get totalLeft() { let n = 0; for (const w of this.units) for (const u of w) if (u.active) n++; return n; }
  get done() { return this.stage === 'done'; }
  start(m: Mission, g: Game) { if (this.stage === 'idle') this.announce(m, g, 0); }
  private announce(m: Mission, g: Game, i: number) {
    this.index = i; this.stage = 'warning'; this.t = CFG.defense.warn; this.nextGroup = 0;
    const w = this.waves[i];
    const last = i === this.waves.length - 1;
    g.banner(last ? `FINAL ASSAULT INBOUND FROM ${w.from}` : `WAVE ${i + 1} OF ${this.waves.length} INBOUND FROM THE ${w.from}`, last ? '#ff6040' : '#ffb347', 3.2);
    sfx('alarm');
    const seen = new Set<string>();
    for (const gr of w.groups) { const p = gr.points[0], k = `${p.x},${p.y}`; if (!seen.has(k)) { seen.add(k); m.incoming.push({ pos: { ...p }, life: CFG.defense.warn + 1 }); } }
  }
  update(m: Mission, g: Game, dt: number) {
    if (this.stage === 'idle' || this.stage === 'done') return;
    const D = CFG.defense, w = this.waves[this.index];
    if (this.stage === 'warning') {
      this.t -= dt;
      if (this.t > 0) return;
      this.stage = 'arriving'; this.t = 0;
    }
    if (this.stage === 'arriving') {
      this.t += dt;
      while (this.nextGroup < w.groups.length && this.t >= w.groups[this.nextGroup].at) {
        const gr = w.groups[this.nextGroup++];
        const us = m.spawnWave(g, gr.points, gr.kinds.length, false, gr.kinds);
        // two in three riflemen / armored troopers go for the command center first and stop to fire once it is in
        // range (from outside the compound: the squad has to go out and meet them); snipers pick exposed soldiers
        us.forEach((u, k) => { u.tag = this.tag; if (k % 3 !== 2 && u.kind !== 'sniper') { u.targeting = SiegeTargeting; u.advancer = false; } });
        this.units[this.index].push(...us);
        m.spawned.set(this.tag, (m.spawned.get(this.tag) ?? 0) + us.length);
      }
      if (this.nextGroup >= w.groups.length) { this.stage = 'fighting'; this.t = 0; }
      return;
    }
    // fighting
    this.t += dt;
    const lastWave = this.index >= this.waves.length - 1;
    if (!lastWave) {
      if ((this.left() <= D.nextWhenLeft && this.t >= D.minGap) || this.t >= D.maxGap) this.announce(m, g, this.index + 1);
    } else if (this.totalLeft === 0) {
      this.stage = 'done';
    }
  }
  /** Nearest living attacker (arrows / autopilot). */
  nearest(c: Vec): Unit | null {
    let best: Unit | null = null, bd = Infinity;
    for (const w of this.units) for (const u of w) if (u.active) { const d = dist(u.pos, c); if (d < bd) { bd = d; best = u; } }
    return best;
  }
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
    return W.waves.map((_, i) => ({
      label: `W${i + 1}`,
      frac: i < W.index || W.done ? 1 : i === W.index && W.stage !== 'warning' ? 1 - W.left(i) / Math.max(1, W.units[i].length) : 0,
      state: i < W.index || W.done ? (W.left(i) ? 'live' : 'done') : i === W.index ? (W.stage === 'warning' ? 'idle' : 'live') : 'idle',
    }));
  }
  hud(m: Mission): HudLine {
    const W = this.waves, n = W.waves.length, i = W.index;
    let sub: string;
    if (W.stage === 'warning') sub = `Wave ${i + 1}/${n} from the ${W.waves[i].from.toLowerCase()} in ${Math.ceil(W.t)}s${i > 0 && W.left(i - 1) ? ` · ${W.left(i - 1)} still attacking` : ''}`;
    else if (W.stage === 'arriving') sub = `Wave ${i + 1}/${n} arriving from the ${W.waves[i].from.toLowerCase()} · attackers: ${W.totalLeft}`;
    else sub = i === n - 1 ? `Final wave · attackers left: ${W.totalLeft}` : `Wave ${i + 1}/${n} · attackers left: ${W.totalLeft}`;
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
