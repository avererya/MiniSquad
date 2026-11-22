// v0.9A Chapter 4 "Behind Enemy Lines" objectives (v0.9B: Missions 17-18 below). Mission 16 Jungle Sweep reuses ReachObjective and
// ClearGroupsObjective (fortress.ts) for its primaries; the mines are the MineField mechanic (mines.ts).
import type { Game } from './game';
import type { Mission, MissionMechanic } from './mission';
import type { StoryCue } from './story';
import { Objective, type HudChip, type HudLine, type ObjPoint } from './objectives';
import type { MineField } from './mines';
import type { FuelDepot } from './fuel';
import type { EnemyKind, Unit } from './unit';
import { squadCentre } from './squad';
import { dist, type Vec } from './util';
import { sfx } from './audio';

/** Optional: enemies killed by mine blasts (set off by anyone: a lured patrol, a shot mine, a chain) reach `need`. */
export class MineKillsOptional extends Objective {
  constructor(id: string, label: string, readonly need: number) { super(id, label); }
  kills(m: Mission) { return m.mechanic<MineField>('mines')?.log.enemyKills ?? 0; }
  update(m: Mission, g: Game) { if (this.state === 'active' && this.kills(m) >= this.need) this.complete(m, g); }
  status(m: Mission): string { return this.state === 'complete' ? 'DONE' : `${Math.min(this.need, this.kills(m))}/${this.need}`; }
}

// =====================================================================================
// v0.9B Mission 17 "Fuel for the Fire" (FuelDepot, fuel.ts) and shared ambush spawning (Mission 18 too)
// =====================================================================================

/**
 * v0.9B fair spawning for scripted groups: the nearest candidate point that is off screen and at least `minDist`
 * from every soldier still on the field (standing or downed), else the candidate farthest from the squad. Units
 * appear on open ground around it (findOpenNear). Fixed step only (findOpenNear draws Math.random in a stable order).
 */
export function safeSpawnPoint(g: Game, points: Vec[], minDist: number): Vec {
  const c = squadCentre(g.soldiers) ?? g.cam;
  const live = g.soldiers.filter((s) => s.state === 'active' || s.state === 'downed');
  const far = (p: Vec) => live.every((s) => dist(s.pos, p) >= minDist);
  const ok = points.filter((p) => !g.isOnScreen(p, 80) && far(p)).sort((a, b) => dist(a, c) - dist(b, c));
  return ok[0] ?? [...points].sort((a, b) => Math.min(...live.map((s) => dist(s.pos, b)), Infinity) - Math.min(...live.map((s) => dist(s.pos, a)), Infinity))[0];
}
export function spawnSafe(g: Game, points: Vec[], kinds: EnemyKind[], minDist: number, tag: string): Unit[] {
  const at = safeSpawnPoint(g, points, minDist);
  return kinds.map((k) => { const e = g.spawnEnemy(g.findOpenNear(at, 70), k); e.tag = tag; return e; });
}

/** Destroy every fuel tank of each installation, any order; counted live from the depot (indirect / early kills count). */
export class FuelInstallationsObjective extends Objective {
  private done = new Set<string>();
  constructor(id: string, label: string, readonly sites: { group: string; name: string; short: string }[]) { super(id, label); this.phase = 'destroy'; }
  depot(m: Mission) { return m.mechanic<FuelDepot>('fuel'); }
  left(m: Mission) { return this.sites.filter((s) => (this.depot(m)?.intact(s.group).length ?? 0) > 0); }
  update(m: Mission, g: Game) {
    if (this.state !== 'active') return;
    const d = this.depot(m);
    if (!d) return;
    for (const s of this.sites) {
      if (this.done.has(s.group) || d.intact(s.group).length) continue;
      this.done.add(s.group);
      const n = this.left(m).length;
      if (n > 0) g.banner(`INSTALLATION ${s.short} DESTROYED — ${n} LEFT`, '#7dff8a', 2.5);
    }
    if (this.done.size === this.sites.length) this.complete(m, g);
  }
  chips(m: Mission): HudChip[] {
    const d = this.depot(m);
    return this.sites.map((s) => {
      const all = d?.tanks.filter((t) => t.group === s.group).length ?? 1, n = d?.intact(s.group).length ?? 0;
      return { label: s.short, frac: all ? n / all : 0, state: n ? 'live' : 'done' };
    });
  }
  hud(m: Mission): HudLine {
    return { text: `${this.label} · ${this.done.size}/${this.sites.length}`, sub: 'Fuel tanks explode: tap one to have the squad shoot it, and keep clear of the blast', chips: this.chips(m) };
  }
  status(m: Mission) { return `${this.sites.length - this.left(m).length}/${this.sites.length}`; }
  point(m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam, d = this.depot(m);
    const t = d?.intact().sort((a, b) => dist(a.pos, c) - dist(b.pos, c))[0];
    return t ? { pos: t.pos, label: 'FUEL', color: '#ffb347' } : null;
  }
}

/** Optional: enemies killed by fuel explosions reach `need`. */
export class FuelKillsOptional extends Objective {
  constructor(id: string, label: string, readonly need: number) { super(id, label); }
  kills(m: Mission) { return m.mechanic<FuelDepot>('fuel')?.log.enemyKills ?? 0; }
  update(m: Mission, g: Game) { if (this.state === 'active' && this.kills(m) >= this.need) this.complete(m, g); }
  status(m: Mission): string { return this.state === 'complete' ? 'DONE' : `${Math.min(this.need, this.kills(m))}/${this.need}`; }
}

/** One wave of a finite enemy response: `at` s after the objective starts, from the safest of `points`. */
export interface ResponseWave { at: number; points: Vec[]; kinds: EnemyKind[]; banner?: string }
/**
 * Survive a finite enemy response: scheduled waves (each once, simulation time) walk in from off-screen edge points
 * (safeSpawnPoint) and pursue the squad; completes once every wave has arrived and none of them is standing.
 */
export class ResponseObjective extends Objective {
  t = 0;
  fired = 0;
  units: Unit[] = [];
  constructor(id: string, label: string, readonly waves: ResponseWave[], readonly minDist = 520) { super(id, label); this.phase = 'response'; }
  get total() { return this.waves.reduce((a, w) => a + w.kinds.length, 0); }
  alive() { return this.units.filter((u) => u.active); }
  protected onStart(_m: Mission, g: Game) { g.banner('ENEMY RESPONSE INBOUND — HOLD TOGETHER', '#ff7a5a', 3); sfx('alarm'); }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    this.t += dt;
    while (this.fired < this.waves.length && this.t >= this.waves[this.fired].at) {
      const w = this.waves[this.fired++];
      const us = spawnSafe(g, w.points, w.kinds, this.minDist, `${this.id}-${this.fired}`);
      for (const u of us) { u.guard = false; u.reinforcement = true; }
      this.units.push(...us);
      m.spawned.set(`${this.id}-${this.fired}`, us.length);
      m.incoming.push({ pos: { ...us[0].pos }, life: 4 });
      if (w.banner) g.banner(w.banner, '#ff7a5a', 2.5);
    }
    if (this.fired === this.waves.length && this.alive().length === 0) this.complete(m, g);
  }
  hud(): HudLine {
    const n = this.alive().length, pending = this.waves.slice(this.fired).reduce((a, w) => a + w.kinds.length, 0);
    return { text: this.label, sub: pending ? `Incoming: ${pending} more · enemies here: ${n}` : n ? `Enemies left: ${n}` : undefined, progress: this.total ? 1 - (n + pending) / this.total : 0 };
  }
  point(_m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const e = this.alive().sort((a, b) => dist(a.pos, c) - dist(b.pos, c))[0];
    return e ? { pos: e.pos, label: 'ENEMY', color: '#ff7a5a' } : null;
  }
}

/**
 * v0.9B.1 Mission 17 COUNTERATTACK (mechanic id 'counterattack'): once `after` installations of the
 * FuelInstallationsObjective `objective` are destroyed while it is still running (one or more left), the garrison
 * sends ONE finite group to the last one standing: a radio cue at once, then `delay` s later the group enters from
 * the safe point of `from` nearest the squad (off screen, `minDist` from every soldier; safeSpawnPoint) and hunts the
 * squad, which is on its way to that installation. Nothing respawns; the group is never required (the objective
 * counts tanks). If the last installations fall together (a chain, a nuke) it is skipped: nothing left to defend.
 */
export interface CounterattackDef {
  objective: string; after: number; kinds: EnemyKind[]; from: Vec[];
  delay?: number; minDist?: number; cue?: StoryCue; banner?: string;
}
export class InstallationCounterattack implements MissionMechanic {
  readonly id = 'counterattack';
  armedAt = -1;
  sprungAt = -1;
  site: string | null = null;
  /** True when the installations were all gone before it could spring. */
  skipped = false;
  units: Unit[] = [];
  constructor(readonly def: CounterattackDef) {}
  step(m: Mission, g: Game) {
    if (this.sprungAt >= 0) return;
    const o = m.currentObjective;
    if (this.armedAt < 0) {
      if (!(o instanceof FuelInstallationsObjective) || o.id !== this.def.objective || o.state !== 'active') return;
      const left = o.left(m);
      if (!left.length || o.sites.length - left.length < this.def.after) return;
      this.armedAt = g.time; this.site = left[0].group;
      if (this.def.cue) m.cue(g, this.def.cue);
    }
    if (g.time - this.armedAt + 1e-9 < (this.def.delay ?? 0)) return;
    this.sprungAt = g.time;
    // the last installation fell during the warning: nothing left to defend (skipped, never sprung)
    if (!(o instanceof FuelInstallationsObjective) || o.state !== 'active' || !o.left(m).length) { this.skipped = true; return; }
    this.units = spawnSafe(g, this.def.from, this.def.kinds, this.def.minDist ?? 560, this.id);
    for (const u of this.units) { u.guard = false; u.reinforcement = true; }
    m.spawned.set(this.id, this.units.length);
    if (this.units.length) m.incoming.push({ pos: { ...this.units[0].pos }, life: 4 });
    if (this.def.banner) g.banner(this.def.banner, '#ff7a5a', 2.5);
    sfx('alarm');
  }
}
