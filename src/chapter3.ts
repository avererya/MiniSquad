// v0.8A Chapter 3 objectives: Mission 11 "Resistance Rising" (village liberation + safehouse defence with the
// resistance allies) and Mission 12 "Artillery Hunt" (three guns under searchlights). Same Objective state
// machine as objectives.ts (complete / fail only act on an active objective).
import { CFG } from './config';
import type { Game } from './game';
import type { Mission } from './mission';
import type { Unit, EnemyKind } from './unit';
import { MultiDestroyObjective, Objective, type HudChip, type HudLine, type MissionEvent, type ObjPoint } from './objectives';
import { clamp, dist, pointInRect, type Rect, type Vec } from './util';
import { squadCentre } from './squad';
import { sfx } from './audio';

const centreOf = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// =======================================================================================
// Mission 11
// =======================================================================================

export interface VillageZone { id: string; name: string; short: string; rect: Rect; tag: string }
/** Seconds a soldier must stand in a cleared zone to liberate it (progress kept when leaving). */
export const SECURE_TIME = 3;

/**
 * Liberate the village zones, any order. A zone is liberated once its defenders (group tag) are all dead AND a
 * standing soldier has spent SECURE_TIME s inside it (the same "clear, then stand in it" rule as Mission 3's
 * outpost; progress is kept). HUD: "Zones liberated: x/3" with a chip per zone.
 */
export class LiberateZonesObjective extends Objective {
  liberated = new Set<string>();
  progress = new Map<string, number>();
  constructor(id: string, label: string, readonly zones: VillageZone[]) { super(id, label); this.phase = 'liberate'; }
  defendersLeft(g: Game, z: VillageZone) { let n = 0; for (const e of g.enemies) if (e.active && e.tag === z.tag) n++; return n; }
  inside(g: Game, z: VillageZone) { return g.soldiers.some((s) => s.active && pointInRect(s.pos, z.rect)); }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    for (const z of this.zones) {
      if (this.liberated.has(z.id) || this.defendersLeft(g, z) > 0 || !this.inside(g, z)) continue;
      const p = (this.progress.get(z.id) ?? 0) + dt;
      this.progress.set(z.id, p);
      if (p < SECURE_TIME) continue;
      this.liberated.add(z.id);
      const left = this.zones.length - this.liberated.size;
      g.banner(left ? `${z.name.toUpperCase()} LIBERATED — ${left} TO GO` : `${z.name.toUpperCase()} LIBERATED — THE VILLAGE IS FREE`, '#7dff8a', 3);
      g.fx.ring(centreOf(z.rect), 120, 'rgba(120,255,140,0.9)', 0.6, 5);
      sfx('pickup');
    }
    if (this.liberated.size === this.zones.length) this.complete(m, g);
  }
  chips(g: Game): HudChip[] {
    return this.zones.map((z) => {
      const done = this.liberated.has(z.id);
      return { label: z.short, frac: done ? 1 : this.defendersLeft(g, z) ? 0 : clamp((this.progress.get(z.id) ?? 0) / SECURE_TIME, 0, 1), state: done ? 'done' : 'live' };
    });
  }
  hud(_m: Mission, g: Game): HudLine {
    const here = this.zones.find((z) => !this.liberated.has(z.id) && this.inside(g, z));
    let sub = `Zones liberated: ${this.liberated.size}/${this.zones.length}`;
    if (here) sub += this.defendersLeft(g, here) ? ` · ${here.name}: clear ${this.defendersLeft(g, here)} defenders` : ` · securing ${here.name}…`;
    return { text: this.label, sub, chips: this.chips(g) };
  }
  point(_m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const z = this.zones.filter((x) => !this.liberated.has(x.id)).sort((a, b) => dist(centreOf(a.rect), c) - dist(centreOf(b.rect), c))[0];
    return z ? { pos: centreOf(z.rect), label: z.short, color: '#ffd84a' } : null;
  }
  draw(ctx: CanvasRenderingContext2D, _m: Mission, g: Game) {
    for (const z of this.zones) {
      const r = z.rect, done = this.liberated.has(z.id), held = !done && this.defendersLeft(g, z) > 0;
      ctx.setLineDash([10, 8]);
      ctx.fillStyle = done ? 'rgba(120,255,140,0.08)' : held ? 'rgba(255,90,60,0.08)' : 'rgba(255,216,74,0.12)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const p = clamp((this.progress.get(z.id) ?? 0) / SECURE_TIME, 0, 1);
      if (!done && !held && p > 0) { ctx.fillStyle = 'rgba(255,216,74,0.25)'; ctx.fillRect(r.x, r.y, r.w * p, r.h); }
      ctx.strokeStyle = done ? '#7dff8a' : held ? '#ff7a5a' : '#ffd84a'; ctx.lineWidth = 3;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
      // flag: red (occupied) / green (liberated)
      const fx = r.x + 16, fy = r.y + 14;
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(fx, fy + 40); ctx.lineTo(fx, fy - 6); ctx.stroke();
      ctx.fillStyle = done ? '#5fd36a' : '#d84a3a'; ctx.fillRect(fx, fy - 6, 22, 14);
      ctx.fillStyle = done ? '#7dff8a' : '#ffd84a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(z.name.toUpperCase(), fx + 28, fy + 1);
    }
  }
}

export interface DefenseWave { at: number; points: Vec[]; kinds: EnemyKind[]; from: string }
export const ALLY_NAMES = ['MARA', 'ELIAS', 'TESSA'] as const;

/**
 * Return to the safehouse, then defend it with the three resistance allies. Stage 'regroup': the squad centre
 * must reach the safehouse zone (the allies come out to meet it). Stage 'defend': waves at DEFENSE_WAVES[i].at
 * (0 / 20 / 40 s), each from its own direction with a warning banner + edge marker a few seconds before (the
 * first with the start banner). The defence completes at `duration` (60) s, or earlier once all waves have
 * spawned and every attacker is down; never before the last wave has spawned. Attackers carry tag 'attack'.
 */
export class SafehouseDefenseObjective extends Objective {
  stage: 'regroup' | 'defend' = 'regroup';
  t = 0;
  spawned = 0;
  attackers: Unit[] = [];
  private warned = 0;
  constructor(id: string, label: string, readonly zone: Rect, readonly posts: Vec[], readonly waves: DefenseWave[], readonly duration = 60) { super(id, label); this.phase = 'safehouse'; }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    if (this.stage === 'regroup') {
      const c = squadCentre(g.soldiers);
      if (!c || !pointInRect(c, this.zone)) return;
      this.stage = 'defend'; this.phase = 'defend'; m.phase = 'defend';
      // the resistance joins (a fresh trio every attempt; they never carry anything between missions)
      ALLY_NAMES.forEach((n, i) => { const a = g.spawnAlly(this.posts[i], n); a.post = { ...this.posts[i] }; });
      g.banner('THE RESISTANCE JOINS YOU — HOLD THE SAFEHOUSE', '#c9e08a', 3.2);
      sfx('alarm');
    }
    this.t += dt;
    // warnings 3 s ahead (the first wave is announced with the defence itself)
    while (this.warned < this.waves.length && this.t >= this.waves[this.warned].at - 3) {
      const w = this.waves[this.warned++];
      if (w.at > 0) { g.banner(`ATTACK WAVE ${this.warned} INBOUND FROM THE ${w.from}`, '#ffb347', 3); sfx('alarm'); }
      else g.banner(`COUNTERATTACK! WAVE 1 FROM THE ${w.from}`, '#ff6040', 3);
      m.incoming.push({ pos: { ...w.points[0] }, life: 5 });
    }
    while (this.spawned < this.waves.length && this.t >= this.waves[this.spawned].at) {
      const w = this.waves[this.spawned++];
      const units = m.spawnWave(g, w.points, w.kinds.length, false, w.kinds);
      for (const u of units) u.tag = 'attack';
      this.attackers.push(...units);
      m.spawned.set('attack', (m.spawned.get('attack') ?? 0) + units.length);
    }
    const left = this.attackersLeft;
    if (this.spawned >= this.waves.length && (this.t >= this.duration || left === 0)) {
      for (const a of g.allies) a.post = null; // they follow the squad to the helicopter
      this.complete(m, g);
    }
  }
  get attackersLeft() { let n = 0; for (const a of this.attackers) if (a.active) n++; return n; }
  hud(_m: Mission, g: Game): HudLine {
    if (this.stage === 'regroup') return { text: 'Return to the resistance safehouse', sub: 'Regroup before the counterattack' };
    const left = Math.max(0, this.duration - this.t);
    const allies = g.allies.filter((a) => a.active).length;
    const wave = this.spawned < this.waves.length ? `Wave ${this.spawned + 1} in ${Math.ceil(this.waves[this.spawned].at - this.t)}s` : `All ${this.waves.length} waves in · attackers left: ${this.attackersLeft}`;
    return { text: `${this.label}: ${Math.ceil(left)}s`, sub: `${wave} · resistance standing: ${allies}/3`, progress: this.t / this.duration };
  }
  point(): ObjPoint | null { return this.stage === 'regroup' ? { pos: centreOf(this.zone), label: 'SAFEHOUSE', color: '#c9e08a' } : null; }
  draw(ctx: CanvasRenderingContext2D) {
    if (this.state === 'complete') return;
    const z = this.zone;
    ctx.setLineDash([10, 8]);
    ctx.fillStyle = this.state === 'active' ? 'rgba(201,224,138,0.14)' : 'rgba(201,224,138,0.05)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    if (this.stage === 'defend') { ctx.fillStyle = 'rgba(201,224,138,0.22)'; ctx.fillRect(z.x, z.y, z.w * clamp(this.t / this.duration, 0, 1), z.h); }
    ctx.strokeStyle = '#c9e08a'; ctx.lineWidth = 3; ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([]);
  }
}

/** Optional (Mission 11): all three resistance allies are standing when the squad extracts (fails on an ally's death). */
export class AlliesAliveOptional extends Objective {
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'allyKia') this.fail(m, g); }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    if (won && g.allies.length === ALLY_NAMES.length && g.allies.every((a) => a.state === 'active')) this.complete(m, g);
    else this.fail(m, g);
  }
  status(_m: Mission): string {
    if (this.state !== 'active') return super.status(_m);
    return 'Keep them standing';
  }
}

// =======================================================================================
// Mission 12
// =======================================================================================

/** Three artillery guns, any order ("Artillery destroyed: x/3"); the alert state rides along on the HUD. */
export class ArtilleryObjective extends MultiDestroyObjective {
  constructor(id: string, label: string, points: Vec[], hp: number) { super(id, label, points, 'artillery', hp, 'GUN'); }
  protected onTargetDown(_m: Mission, g: Game) {
    if (this.left > 0) g.banner(`GUN DESTROYED — ${this.left} LEFT`, '#7dff8a', 2.5);
  }
  hud(m: Mission, g: Game): HudLine {
    const a = m.artillery;
    const alert = a && !a.disabled && a.alerted ? `ARTILLERY ALERT — clears in ${Math.max(0, Math.ceil(CFG.artillery.clearAfter - (g.time - a.lastSeenAt)))}s out of the lights` : 'Stay out of the searchlights';
    const meter = a && !a.disabled ? { label: a.alerted ? 'ALERT' : 'LIGHT', frac: a.alerted ? 1 : a.exposure, hot: a.alerted || a.exposure > 0.5 } : undefined;
    return { text: this.label, sub: `Artillery destroyed: ${this.destroyed}/${this.targets.length} · ${alert}`, chips: this.chips(), meter };
  }
}

/** Optional (Mission 12): no artillery alert in this attempt (fails the moment one is raised). */
export class NoArtilleryAlertOptional extends Objective {
  update(m: Mission, g: Game) { if (this.state === 'active' && m.artillery?.everAlerted) this.fail(m, g); }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    if (won && !m.artillery?.everAlerted) this.complete(m, g); else this.fail(m, g);
  }
  status(m: Mission): string { return this.state === 'active' ? 'Unseen so far' : super.status(m); }
}
