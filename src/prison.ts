// v0.9C Mission 19 "PRISON BREAK" (Chapter 4): the PrisonBreak mission mechanic (id 'prison') and its objectives.
//
// PRISONERS. Three captured allied specialists sit in wire cells (map.ts CAMP_CELLS). Until freed each is a HELD
// escort NPC (Game.npcs, escorting = false): never a target, never hit by rounds or blasts (Unit.targetable,
// Game.enemyVictims), drawn as a captive with "(HELD)". A standing soldier within CFG.prison.freeRadius of a cell, with
// a clear line, frees it over CFG.prison.freeTime s (progress kept while nobody is there). Any order.
// On release the NPC leaves Game.npcs and the same body becomes a RESCUED SPECIALIST in Game.allies (Unit.special):
// follows the squad (squad.ts updateAllies; the flame specialist closes in on nearby enemies), fights with its own
// weapon (combat.ts: rocket = the Demolitions rocket, flame = flameBurst, star = fast throwing stars), can be downed,
// revived by a soldier and lost (bleed-out). A specialist is never a soldier: no deployment slot, roster entry, XP,
// casualty record or save field, and its death never touches the account (Game.kia only journals roster soldiers).
//
// ESCALATION (trigger-based on the number freed, never on which cell): the 1st release mobilises a small response, the
// 2nd a larger one with Armored Troopers (smaller if the ALARM TOWER was destroyed before it), the 3rd starts the
// lockdown (alarm, radio, a third response). Each response fires once, `delay` s after its radio cue, from the safest
// staging point (chapter4.ts safeSpawnPoint: off screen, CFG-distance from every soldier) and hunts the squad.
//
// LAST STAND. When the extraction countdown starts (a soldier in the landing zone, every primary done) the camp's
// assault begins: four timed waves of ordinary Riflemen (global stats untouched) from named routes around the
// clearing (map.ts CAMP_ASSAULT), each group at the nearest route point that is off screen and waveMinDist from every
// soldier and specialist. Scaled for the force that arrives: soldiers not KIA plus 0.6 per specialist still alive,
// weighted by health (forceScale), less one attacker per hostile already near the clearing (carried, e.g. a
// rescue response that chased the squad there; never below 45%). No generic extraction-pressure tier runs on top (the script sets none).
// Enemies need not be killed: the helicopter lands when the countdown ends and extraction is immediate.
//
// Fixed step only; the only Math.random draws are findOpenNear's (spawns), inside the step in a stable order.
// Nothing here is saved: every attempt (Retry) builds a fresh instance.
import { CFG } from './config';
import type { Game } from './game';
import type { Mission, MissionMechanic } from './mission';
import { Objective, type HudChip, type HudLine, type MissionEvent, type ObjPoint } from './objectives';
import type { EnemyKind, SpecialistKind, Unit } from './unit';
import { safeSpawnPoint, spawnSafe } from './chapter4';
import { squadCentre } from './squad';
import { clamp, dist, type Vec } from './util';
import { sfx } from './audio';
import type { StoryCue } from './story';

export interface PrisonerDef { kind: SpecialistKind; name: string; role: string; cell: Vec }
/** A response to the n-th release (`after` = n): `kinds`, or `reduced` when the alarm tower was down before it. */
export interface RescueResponse { after: number; delay: number; kinds: EnemyKind[]; reduced?: EnemyKind[]; banner: string }
/** One last-stand wave: `at` s after the countdown starts; each group `size` Riflemen down `route`. */
export interface AssaultWave { at: number; groups: { route: string; size: number }[]; banner: string }
export interface PrisonSpec {
  prisoners: PrisonerDef[];
  alarm: Vec | null;
  staging: Vec[];
  responses: RescueResponse[];
  routes: Record<string, Vec[]>;
  assault: AssaultWave[];
  /** Spawn distance of the rescue responses (default 480). */
  responseDist?: number;
}

export interface Prisoner { def: PrisonerDef; npc: Unit; progress: number; ally: Unit | null; freedAt: number; order: number }

export class PrisonBreak implements MissionMechanic {
  readonly id = 'prison';
  prisoners: Prisoner[] = [];
  alarm: Unit | null = null;
  /** Prisoners freed at the moment the alarm tower fell (-1 = standing). */
  alarmDownAfter = -1;
  private pending: { r: RescueResponse; at: number; reduced: boolean }[] = [];
  /** Game.time the last stand started (-1 = not yet). */
  assaultT = -1;
  /** Assault waves fired so far; the scale applied (0.45..1). */
  wavesFired = 0;
  scale = 1;
  /** Hostiles already within CFG.prison.carryRadius of the landing zone when the last stand started. */
  carried = 0;
  readonly assaultUnits: Unit[] = [];
  readonly responseUnits: Unit[] = [];
  private intelCued = false;
  log: {
    rescues: { kind: SpecialistKind; t: number }[];
    responses: { after: number; t: number; n: number; reduced: boolean; at: Vec; minSoldierDist: number; onScreen: boolean }[];
    waves: { i: number; t: number; route: string; n: number; at: Vec; minDist: number; onScreen: boolean }[];
  } = { rescues: [], responses: [], waves: [] };

  constructor(readonly spec: PrisonSpec) {}

  get freed() { return this.prisoners.filter((p) => p.ally).length; }
  get specialists() { return this.prisoners.map((p) => p.ally).filter((u): u is Unit => !!u); }
  get alarmDown() { return this.alarmDownAfter >= 0; }

  start(_m: Mission, g: Game) {
    this.prisoners = this.spec.prisoners.map((def) => {
      const npc = g.spawnNpc(def.cell, def.name);
      return { def, npc, progress: 0, ally: null, freedAt: -1, order: 0 };
    });
    if (this.spec.alarm) {
      const t = g.spawnEnemy(this.spec.alarm);
      t.structure = 'relay'; t.label = 'ALARM TOWER'; t.guard = true; t.fixed = true; t.tag = 'alarm';
      t.setMaxHp(CFG.prison.alarmHp);
      this.alarm = t;
    }
  }

  /** The prisoner a standing soldier is freeing right now (the one with most progress), or null. */
  freeing(g: Game): Prisoner | null {
    return this.prisoners.filter((p) => !p.ally && this.near(g, p)).sort((a, b) => b.progress - a.progress)[0] ?? null;
  }
  private near(g: Game, p: Prisoner) {
    const R = CFG.prison.freeRadius;
    return g.soldiers.some((s) => s.active && dist(s.pos, p.npc.pos) <= R && g.world.clear(s.pos, p.npc.pos));
  }

  step(m: Mission, g: Game, dt: number) {
    for (const p of this.prisoners) {
      if (p.ally || !this.near(g, p)) continue;
      p.progress = Math.min(1, p.progress + dt / Math.max(0.1, CFG.prison.freeTime));
      if (p.progress >= 1) this.free(m, g, p);
    }
    while (this.pending.length && g.time + 1e-9 >= this.pending[0].at) this.respond(m, g, this.pending.shift()!);
    // the last stand: from the step the extraction countdown starts
    if (this.assaultT < 0 && m.phase === 'countdown') this.beginAssault(m, g);
    if (this.assaultT >= 0) {
      const t = g.time - this.assaultT;
      while (this.wavesFired < this.spec.assault.length && t + 1e-9 >= this.spec.assault[this.wavesFired].at) this.wave(m, g, this.wavesFired++);
      if (!this.intelCued && m.phase === 'countdown' && m.extraction.timeLeft() <= 6 && this.specialists.some((u) => u.active)) { this.intelCued = true; m.cue(g, 'cue:intel'); }
    }
  }

  /** A prisoner walks out of the cell: the held NPC becomes a rescued specialist (same body, same spot). */
  free(m: Mission, g: Game, p: Prisoner) {
    if (p.ally) return;
    g.npcs = g.npcs.filter((n) => n !== p.npc);
    const a = g.spawnAlly(p.npc.pos, p.def.name);
    a.special = p.def.kind; a.hp = a.maxHp; a.aim = p.npc.aim;
    p.ally = a; p.freedAt = g.time; p.order = this.freed;
    p.npc.state = 'dead';
    this.log.rescues.push({ kind: p.def.kind, t: g.time });
    g.fx.ring(a.pos, 60, 'rgba(120,255,140,0.95)', 0.6, 5);
    g.fx.burst(a.pos, 18, '#7dff8a', 220, 0.5, 4);
    const n = this.freed, left = this.prisoners.length - n;
    g.banner(`${p.def.name} FREED — ${p.def.role.toUpperCase()} JOINS THE SQUAD${left ? ` · ${left} STILL HELD` : ''}`, '#7dff8a', 3.2);
    sfx('pickup');
    m.cue(g, `cue:rescue${n}` as StoryCue);
    for (const r of this.spec.responses) {
      if (r.after !== n) continue;
      // the alarm tower: down before this release = the smaller response (decided now, at the release)
      this.pending.push({ r, at: g.time + r.delay, reduced: !!r.reduced && this.alarmDown });
    }
    this.pending.sort((x, y) => x.at - y.at);
    if (n === this.prisoners.length) { g.banner('PRISON LOCKDOWN — THE WHOLE CAMP IS COMING', '#ff5a4a', 3.5); sfx('alarm'); }
  }

  private respond(m: Mission, g: Game, x: { r: RescueResponse; reduced: boolean }) {
    const kinds = x.reduced && x.r.reduced ? x.r.reduced : x.r.kinds;
    if (!kinds.length) return;
    const D = this.spec.responseDist ?? 480, tag = `response-${x.r.after}`;
    const at = safeSpawnPoint(g, this.spec.staging, D);
    const us = spawnSafe(g, this.spec.staging, kinds, D, tag);
    for (const u of us) { u.guard = false; u.reinforcement = true; }
    this.responseUnits.push(...us);
    m.spawned.set(tag, us.length);
    m.incoming.push({ pos: { ...at }, life: 4 });
    const live = g.soldiers.filter((s) => s.state === 'active' || s.state === 'downed');
    this.log.responses.push({ after: x.r.after, t: g.time, n: us.length, reduced: x.reduced, at: { ...at }, minSoldierDist: Math.round(Math.min(...live.map((s) => dist(s.pos, at)), 1e9)), onScreen: g.isOnScreen(at, 0) });
    g.banner(x.reduced ? `${x.r.banner} (ALARM DOWN: FEWER)` : x.r.banner, '#ff7a5a', 2.8);
    sfx('alarm');
  }

  /**
   * Strength of the force at the clearing, for the last stand: each soldier not KIA counts 0.5 + 0.5 x its health
   * share (a downed one 0.5), each specialist still alive 0.6 the same way; against six healthy soldiers and three
   * healthy specialists (never below 45%). A full-strength squad meets all 60.
   */
  forceScale(g: Game) {
    const w = (u: Unit) => (u.state === 'active' ? 0.5 + 0.5 * clamp(u.hp / u.maxHp, 0, 1) : u.state === 'downed' ? 0.5 : 0);
    const soldiers = g.soldiers.reduce((a, s) => a + w(s), 0);
    const spec = this.specialists.reduce((a, u) => a + 0.6 * w(u), 0);
    return clamp((soldiers + spec) / (6 + 0.6 * this.prisoners.length), 0.45, 1);
  }

  private beginAssault(m: Mission, g: Game) {
    this.assaultT = g.time;
    // guards still chasing the squad into the clearing (rescue responses, stragglers) take part of the assault's place:
    // each takes one attacker off the budget, so a squad that ran from a fight is not met by both at once
    const z = m.extraction.zone, zc = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    this.carried = g.enemies.filter((e) => e.active && !e.structure && dist(e.pos, zc) <= CFG.prison.carryRadius).length;
    const total = this.spec.assault.reduce((a, w) => a + w.groups.reduce((b, x) => b + x.size, 0), 0) || 1;
    this.scale = clamp(this.forceScale(g) - this.carried / total, 0.45, 1);
    m.cue(g, 'cue:assault');
  }

  /** Group size after scaling (at least 2 per group). */
  sized(size: number) { return Math.max(2, Math.round(size * this.scale)); }

  private wave(m: Mission, g: Game, i: number) {
    const w = this.spec.assault[i], dirs: string[] = [];
    const friends = [...g.soldiers.filter((s) => s.state === 'active' || s.state === 'downed'), ...this.specialists.filter((u) => u.state === 'active' || u.state === 'downed')];
    const minD = CFG.prison.waveMinDist;
    for (const grp of w.groups) {
      const pts = this.spec.routes[grp.route] ?? [];
      if (!pts.length) continue;
      const far = (p: Vec) => friends.every((s) => dist(s.pos, p) >= minD);
      // nearest safe point of the route (they are listed nearest first), else the route's farthest point
      const at = pts.find((p) => !g.isOnScreen(p, 80) && far(p)) ?? pts[pts.length - 1];
      const n = this.sized(grp.size);
      for (let k = 0; k < n; k++) {
        const e = g.spawnEnemy(g.findOpenNear(at, 70), 'rifleman');
        e.reinforcement = true; e.guard = false; e.tag = `assault-${i + 1}`;
        this.assaultUnits.push(e);
      }
      m.spawned.set(`assault-${i + 1}`, (m.spawned.get(`assault-${i + 1}`) ?? 0) + n);
      m.incoming.push({ pos: { ...at }, life: 5 });
      this.log.waves.push({ i, t: +(g.time - this.assaultT).toFixed(2), route: grp.route, n, at: { ...at }, minDist: Math.round(Math.min(...friends.map((s) => dist(s.pos, at)), 1e9)), onScreen: g.isOnScreen(at, 0) });
      if (!dirs.includes(compassName(grp.route))) dirs.push(compassName(grp.route));
    }
    const dir = dirs.length > 1 ? `${dirs.slice(0, -1).join(', ')} AND ${dirs[dirs.length - 1]}` : dirs[0] ?? '';
    g.banner(`${w.banner}${dir ? ` — FROM THE ${dir}` : ''}`, i === this.spec.assault.length - 1 ? '#ff5a4a' : '#ff7a5a', 3);
    sfx('alarm');
  }

  onEvent(_m: Mission, g: Game, ev: MissionEvent) {
    if (ev.type === 'structureDestroyed' && ev.unit === this.alarm && this.alarmDownAfter < 0) {
      this.alarmDownAfter = this.freed;
      const p = ev.unit.pos;
      g.fx.ring(p, 90, 'rgba(255,200,90,0.95)', 0.5, 6); g.fx.burst(p, 30, '#ffb347', 320, 0.6, 5); g.scorches.push({ ...p, r: 40 });
      g.banner(this.freed < 2 ? 'ALARM TOWER DOWN — THEIR RESPONSE WILL BE WEAKER' : 'ALARM TOWER DOWN', '#7dd3ff', 3);
      sfx('boom');
    }
  }

  /** Cells: a pulsing dashed ring around each held prisoner's cell, the release progress in green. */
  draw(ctx: CanvasRenderingContext2D, _m: Mission, g: Game) {
    const R = CFG.prison.freeRadius, pulse = 0.5 + 0.5 * Math.sin(g.clock * 4);
    for (const p of this.prisoners) {
      if (p.ally) continue;
      const c = p.npc.pos;
      ctx.strokeStyle = `rgba(125,211,255,${0.45 + 0.4 * pulse})`; ctx.lineWidth = 3; ctx.setLineDash([8, 7]);
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (p.progress > 0) {
        ctx.strokeStyle = '#7dff8a'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(c.x, c.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.progress); ctx.stroke();
      }
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#000';
      ctx.fillText(p.def.role.toUpperCase(), c.x + 1, c.y + 44 + 1); ctx.fillStyle = '#7dd3ff'; ctx.fillText(p.def.role.toUpperCase(), c.x, c.y + 44);
    }
  }
}

const COMPASS: Record<string, string> = { north: 'NORTH', south: 'SOUTH', east: 'EAST', west: 'WEST', northEast: 'NORTHEAST', southEast: 'SOUTHEAST', northWest: 'NORTHWEST', southWest: 'SOUTHWEST' };
const compassName = (route: string) => COMPASS[route] ?? route.toUpperCase();

const mech = (m: Mission) => m.mechanic<PrisonBreak>('prison');

/** Free every prisoner (any order); counted live from the mechanic. */
export class RescuePrisonersObjective extends Objective {
  constructor(id: string, label: string) { super(id, label); this.phase = 'rescue'; }
  update(m: Mission, g: Game) {
    const x = mech(m);
    if (this.state === 'active' && x && x.prisoners.length && x.freed === x.prisoners.length) this.complete(m, g);
  }
  chips(m: Mission): HudChip[] {
    return (mech(m)?.prisoners ?? []).map((p) => ({ label: p.def.name, frac: p.ally ? 0 : 1 - p.progress, state: p.ally ? (p.ally.state === 'kia' ? 'lost' : 'done') : 'live' }));
  }
  hud(m: Mission, g: Game): HudLine {
    const x = mech(m), n = x?.freed ?? 0, all = x?.prisoners.length ?? 3, f = x?.freeing(g) ?? null;
    return {
      text: f ? `Freeing ${f.def.name} (${f.def.role})...` : `${this.label} · ${n}/${all}`,
      sub: f ? 'Stay by the cell door' : 'Stand by a cell door to free a prisoner (any order)',
      progress: f ? f.progress : n / all, chips: this.chips(m),
    };
  }
  status(m: Mission) { const x = mech(m); return `${x?.freed ?? 0}/${x?.prisoners.length ?? 3}`; }
  point(m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const p = (mech(m)?.prisoners ?? []).filter((q) => !q.ally).sort((a, b) => dist(a.npc.pos, c) - dist(b.npc.pos, c))[0];
    return p ? { pos: p.npc.pos, label: p.def.name, color: '#7dd3ff' } : null;
  }
}

/** Optional: destroy the camp's alarm tower (any time; before the second release it also weakens that response). */
export class AlarmTowerOptional extends Objective {
  update(m: Mission, g: Game) { if (this.state === 'active' && mech(m)?.alarmDown) this.complete(m, g); }
  finalize(m: Mission, g: Game) { if (this.state === 'active') this.fail(m, g); }
  status(m: Mission): string { return this.state === 'active' ? (mech(m)?.alarm?.active ? 'Standing' : '') : super.status(m); }
}

/** Optional: all three specialists freed and none lost (KIA) by the end of a won mission. */
export class SpecialistsAliveOptional extends Objective {
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'allyKia' && ev.unit.special) this.fail(m, g); }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    const x = mech(m);
    if (won && x && x.freed === x.prisoners.length && x.specialists.every((u) => u.state !== 'kia')) this.complete(m, g);
    else this.fail(m, g);
  }
  status(m: Mission): string {
    if (this.state !== 'active') return super.status(m);
    const x = mech(m);
    return x && x.freed < x.prisoners.length ? `${x.freed}/${x.prisoners.length} freed` : 'Keep them standing';
  }
}
