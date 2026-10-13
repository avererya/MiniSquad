// Mission runtime (v0.4): runs one campaign mission script (missions.ts):
//   primary objectives in order -> extraction (reach the zone -> hold out for the countdown
//   -> everyone into the zone) -> victory. Optional objectives run alongside from the start.
// Extraction only opens once every primary objective is complete. Objectives are modules
// (objectives.ts) fed by gameplay events (emit) and per-step updates.
// Extraction is behind a small interface so a vehicle can be slotted in.
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import type { MapDef } from './map';
import { campaignMission, type CampaignMission } from './campaign';
import type { MissionEvent, ObjPoint, Objective } from './objectives';
import { Convoy } from './convoy';
import { BossFight } from './boss';
import { Artillery, type SpotlightDef } from './artillery';
import type { EnemyKind } from './unit';
import { pointInRect, type Rect, type Vec } from './util';
import { squadCentre } from './squad';
import { sfx } from './audio';
import { EXTRACT_REARM_S, EXTRACT_WARN_ARM_S } from './casualties';
import { EscortVehicle } from './escort';
import { assetMeter } from './defense';
import { drawGates } from './render';

/** Anything that can extract the squad (timer + helicopter now; trucks/boats later). */
export interface Extraction {
  readonly zone: Rect;
  begin(game: Game, seconds?: number): void;
  update(game: Game, dt: number): void;
  /** Seconds until extraction is available (0 when available). */
  timeLeft(): number;
  /** Countdown length this extraction started with. */
  total(): number;
  isAvailable(): boolean;
  draw(ctx: CanvasRenderingContext2D, game: Game): void;
}

export class HelicopterExtraction implements Extraction {
  private left = 0;
  private len = 0;
  private started = false;
  private t = 0;
  constructor(readonly zone: Rect) {}
  begin(_g?: Game, seconds = CFG.mission.extractionCountdown) { this.left = this.len = Math.max(0, seconds); this.started = true; }
  update(_g: Game, dt: number) { if (this.started) { this.left = Math.max(0, this.left - dt); this.t += dt; } }
  timeLeft() { return this.left; }
  total() { return this.len; }
  isAvailable() { return this.started && this.left <= 0; }
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.started) return;
    const arrive = Math.min(CFG.mission.heliArriveTime, Math.max(0.5, this.len));
    if (this.left > arrive) return;
    const k = 1 - this.left / arrive; // 0 -> 1 approach progress
    const ease = 1 - (1 - k) ** 3;
    const tx = this.zone.x + this.zone.w / 2, ty = this.zone.y + this.zone.h / 2;
    const x = tx + (1 - ease) * 700, y = ty - (1 - ease) * 200;
    const alt = 70 * (1 - ease) + 18;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 10, 46, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(x, y - alt);
    ctx.fillStyle = '#4c5a3a';
    ctx.fillRect(10, -6, 70, 10); // tail boom
    ctx.fillRect(74, -18, 8, 20); // tail fin
    ctx.beginPath(); ctx.ellipse(0, 0, 40, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9fd3e6';
    ctx.beginPath(); ctx.ellipse(-22, -4, 14, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-26, 24); ctx.lineTo(26, 24); ctx.stroke(); // skid
    const rot = this.t * 30;
    ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 4;
    for (let i = 0; i < 2; i++) {
      const a = rot + (i * Math.PI) / 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * -70, Math.sin(a) * -22 - 24); ctx.lineTo(Math.cos(a) * 70, Math.sin(a) * 22 - 24); ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------- mission scripts (data, see missions.ts) ----------------
/** A group point may carry an enemy kind (v0.6.2: sniper, armored, tower...; default rifleman). */
export type SpawnPoint = Vec & { kind?: EnemyKind };
export interface GroupSpec { tag: string; points: SpawnPoint[]; guard?: boolean; aggro?: number; defender?: boolean }
export interface TriggerSpec {
  id: string;
  when: (m: Mission, g: Game) => boolean;
  points: Vec[];
  size: () => number;
  /** Use the second-nearest off-screen point (flanking). */
  second?: boolean;
  banner?: string;
  /** v0.6.2: enemy kinds of the wave in order (missing = rifleman). */
  kinds?: EnemyKind[];
}
/** v0.8A extraction pressure tiers (sizes in CFG.extractionPressure; see pressureGroups). */
export type PressureTier = 'light' | 'small' | 'moderate' | 'restrained' | 'strong';
export interface PressureGroup { size: number; delay: number; kinds?: EnemyKind[] }
/** Reinforcement groups of a tier: sizes / delays read live from CFG.extractionPressure. */
export function pressureGroups(tier: PressureTier): PressureGroup[] {
  const P = CFG.extractionPressure;
  switch (tier) {
    case 'light': return [{ size: P.light, delay: 0 }];
    case 'small': return [{ size: P.small, delay: 0 }];
    case 'moderate': return [{ size: P.moderateA, delay: 0 }, { size: P.moderateB, delay: P.moderateDelay }];
    case 'restrained': return [{ size: P.restrained, delay: P.restrainedDelay }];
    case 'strong': return [{ size: P.strongA, delay: 0 }, { size: P.strongB, delay: P.strongDelay, kinds: Array.from({ length: P.strongArmored }, () => 'armored' as const) }];
  }
}
export interface ExtractionSpec {
  zone: Rect;
  countdown: () => number;
  /** A scripted final wave (Missions 3 and 10 keep theirs; split over the two nearest off-screen points). */
  finalWave?: { points: Vec[]; size: () => number };
  /**
   * v0.8A extraction pressure (instead of a scripted final wave, never both): finite groups from these map-edge
   * points once extraction is called (see Mission.updatePressure).
   */
  pressure?: { tier: PressureTier; points: Vec[] };
  /** The escorted captive must be in the zone (and standing) too. */
  requireNpc?: boolean;
}
export interface MissionScript {
  id: string;
  map: MapDef;
  groups: () => GroupSpec[];
  triggers: TriggerSpec[];
  primaries: () => Objective[];
  /** Ids must match the campaign's optional objective ids. */
  optionals: () => Objective[];
  extraction: ExtractionSpec;
  captive?: Vec;
  /** v0.6.2: overhead label of the captive (default CAPTIVE). */
  captiveLabel?: string;
  /** One-line tips shown under the first objective (Mission 1 only). */
  hint?: string;
  /** v0.6.2 Mission 8: the convoy (route, escorts per truck, seconds between trucks, launch delay). */
  convoy?: { route: Vec[]; escorts: EnemyKind[][]; gap: number; delay: number };
  /** v0.6.2 Mission 10: boss arena and the reinforcement gates. */
  boss?: { arena: Rect; gates: Vec[] };
  /** v0.8A Mission 12: searchlights; the guns are the 'artillery' structures of the primary objective (artillery.ts). */
  artillery?: { lights: SpotlightDef[] };
  /** v0.8B resistance allies placed at mission start (Mission 13), each holding its post until the defense is over. */
  allies?: { posts: Vec[]; names: string[] };
  /** v0.8B a protected asset spawned at mission start (Mission 13 command center): destroyed = mission failed. */
  protect?: { pos: Vec; label: string; failReason: string };
  /** v0.8B the map's collision / nav world once the gates close (Mission.closeGates); drawn by the gates' objective. */
  gated?: MapDef;
  /** v0.8B escort vehicle route (Mission 14 truck; escort.ts). */
  escort?: { route: Vec[] };
}

export type Phase = string; // current primary's phase, then 'toExtraction' | 'countdown' | 'available' | 'done'

export class Mission {
  readonly id: string;
  readonly name: string;
  readonly def: CampaignMission;
  phase: Phase = 'start';
  primaries: Objective[];
  optionals: Objective[];
  current = 0;
  fired = new Set<string>();
  /** Enemies spawned per group tag (objectives count kills against it). */
  spawned = new Map<string, number>();
  /** Capture missions: the units that must die before the hold starts. */
  defenders: Unit[] = [];
  /** Escort mission: the captive (null elsewhere). */
  npc: Unit | null = null;
  wrecks: { id: string; pos: Vec; kind: string }[] = [];
  extraction: Extraction;
  /** v0.6.2: Mission 8 convoy (null elsewhere). */
  convoy: Convoy | null = null;
  /** v0.6.2: Mission 10 boss fight (null until it starts). */
  boss: BossFight | null = null;
  /** v0.8A: Mission 12 searchlights + artillery (null elsewhere). */
  artillery: Artillery | null = null;
  failReason = '';
  private ended = false;
  /**
   * v0.6 EXTRACTION ATTEMPT (abandonment warning). An attempt starts when extraction is ready
   * and every standing soldier (and the captive, where required) is in the zone.
   *  - nobody downed: extraction completes (unchanged);
   *  - a valid revive is running: extraction waits (v0.4 hold, unchanged);
   *  - someone is downed and not being revived: the attempt HOLDS and the non-pausing
   *    "SOLDIER LEFT BEHIND" warning opens ('warning'). Combat, bleed-out and everything else keep
   *    running. The player chooses:
   *      Confirm Extraction -> the downed soldiers are KIA (abandoned), the squad extracts;
   *      Stay and Rescue    -> the attempt is cancelled ('stayed'): no warning, extraction stays on
   *                            hold until every downed soldier is resolved (revived or bled out),
   *                            or the squad leaves the zone (EXTRACT_REARM_S) and comes back, which
   *                            starts a new attempt (and a new warning if someone is still down).
   *    Ignoring the warning = extraction keeps holding; if the downed soldier bleeds out the warning
   *    closes and extraction completes on its own. Nothing here ever pauses or extends a bleed-out.
   */
  attempt: 'idle' | 'warning' | 'stayed' = 'idle';
  /** game.clock when the current warning opened (its buttons arm EXTRACT_WARN_ARM_S later). */
  warnAt = 0;
  /** Seconds the squad has not been all in the zone (an attempt ends after EXTRACT_REARM_S). */
  private outT = 0;
  /**
   * v0.8A EXTRACTION PRESSURE. Once extraction is called (countdown starts) the tier's groups enter, each ONCE,
   * at its delay (simulation time): never more, never again (no farming), never for a retried attempt. Each
   * spawns at a map-edge point that is off screen and at least CFG.extractionPressure.minDist from every
   * standing squad member and resistance ally (open ground: findOpenNear), a different point than the group
   * before when possible, and advances on the squad (flow field). Untagged: no objective counts them; the
   * helicopter keeps its countdown. A banner, the alarm and an edge marker announce each group.
   */
  pressureT = -1;
  pressureSpawned = 0;
  pressureGroupsFired = 0;
  private pressureUsed: Vec[] = [];
  /** Edge markers for incoming groups (render.ts: off-screen arrows). */
  incoming: { pos: Vec; life: number }[] = [];
  /** v0.8B the protected asset (Mission 13 command center; null elsewhere). */
  protected: Unit | null = null;
  /** v0.8B extra flow-field sources (enemies converge on them as well as on the squad): the asset under attack. */
  flowExtra: Vec[] = [];
  /** v0.8B the gates are closed (Mission 13 assault). */
  gatesClosed = false;
  /** v0.8B Mission 14 escort truck (null elsewhere). */
  escort: EscortVehicle | null = null;
  /** v0.8B the gunner was chosen: the truck starts following the squad. */
  escortStarted = false;
  /**
   * v0.8B WRECK AFTERMATH. The escort truck was destroyed: the mission has failed, but the gunner was thrown clear
   * downed (never killed outright), so the failure is held for a short, controlled aftermath (both sides hold fire,
   * no ambush fires) in which downed soldiers can still be revived. It ends as soon as nobody is downed (after
   * CFG.escortTruck.wreckEarly s), or after wreckTime s while no revive is running (hard cap wreckCap s); then the
   * mission fails ('The supply truck was destroyed.') and the established failure rule applies (whoever is still
   * downed is KIA). Nothing can repeat it, pay for it or damage the truck again.
   */
  aftermath: { t: number } | null = null;

  constructor(readonly script: MissionScript) {
    this.id = script.id;
    this.def = campaignMission(script.id)!;
    this.name = this.def.name;
    this.primaries = script.primaries();
    this.optionals = script.optionals();
    this.extraction = new HelicopterExtraction(script.extraction.zone);
    if (script.convoy) this.convoy = new Convoy(script.convoy.route, script.convoy.escorts, script.convoy.gap, script.convoy.delay);
  }

  get map() { return this.script.map; }
  /** Optional objectives with their state (settlement reads this once at the end). */
  get optional() {
    return this.optionals.map((o) => ({ id: o.id, label: o.label, completed: o.state === 'complete', replaces: this.def.optional.find((d) => d.id === o.id)?.replaces }));
  }
  get currentObjective(): Objective | null { return this.primaries[this.current] ?? null; }
  get primariesDone() { return this.current >= this.primaries.length; }
  get inExtraction() { return this.phase === 'toExtraction' || this.phase === 'countdown' || this.phase === 'available'; }

  start(game: Game) {
    for (const grp of this.script.groups()) {
      const units = this.spawnGroup(game, grp);
      if (grp.defender) this.defenders.push(...units);
    }
    if (this.script.captive) this.npc = game.spawnNpc(this.script.captive, this.script.captiveLabel ?? 'CAPTIVE');
    if (this.script.protect) this.protected = game.spawnAsset('command', this.script.protect.pos, this.script.protect.label);
    if (this.script.allies) {
      const A = this.script.allies;
      A.posts.forEach((p, i) => { const a = game.spawnAlly(p, A.names[i % A.names.length]); a.post = { ...p }; });
    }
    if (this.script.escort) { this.escort = new EscortVehicle(this.script.escort.route); this.escort.spawn(game); }
    if (this.script.artillery) {
      const guns = () => this.primaries.flatMap((o) => ('targets' in o && (o as unknown as { kind: string }).kind === 'artillery' ? (o as unknown as { targets: Unit[] }).targets : []));
      this.artillery = new Artillery(this.script.artillery.lights, guns);
    }
    for (const o of this.optionals) o.activate(this, game);
    this.activateCurrent(game);
  }

  spawnGroup(game: Game, grp: GroupSpec): Unit[] {
    const out: Unit[] = [];
    for (const p of grp.points) {
      const e = game.spawnEnemy(p.kind === 'tower' || game.world.isOpen(p.x, p.y) ? { x: p.x, y: p.y } : game.findOpenNear(p, 24), p.kind);
      e.tag = grp.tag; e.guard = grp.guard ?? true; e.defender = !!grp.defender; e.aggro = grp.aggro ?? null;
      out.push(e);
    }
    this.spawned.set(grp.tag, (this.spawned.get(grp.tag) ?? 0) + out.length);
    return out;
  }

  /** Reinforcements from the nearest off-screen point (untagged: they don't count for objectives). */
  spawnWave(game: Game, points: Vec[], size: number, second = false, kinds?: EnemyKind[]) {
    return game.spawnGroupOffscreen(points, size, second, kinds);
  }

  /** v0.6.2: mission-driven units (convoy trucks, the boss) set their intent / act each step. */
  unitStep(game: Game, dt: number) {
    if (this.ended) return;
    this.convoy?.update(game, dt);
    this.boss?.update(game, dt);
    this.artillery?.update(game, dt);
    this.escort?.update(game, dt);
  }

  /** v0.8B Mission 13: the gates close (collision / nav switch to the gated map; nobody is left inside a gate). */
  closeGates(game: Game) {
    if (this.gatesClosed || !this.script.gated) return;
    this.gatesClosed = true;
    game.swapWorld(this.script.gated);
  }

  /** v0.8B the escort truck was wrecked: hold the failure for the aftermath (see `aftermath`). */
  private startAftermath(game: Game) {
    if (this.aftermath || this.ended) return;
    this.aftermath = { t: 0 };
    this.failReason = 'The supply truck was destroyed.';
    game.banner('THE SUPPLY TRUCK IS DESTROYED — MISSION FAILED', '#ff4040', 4);
    sfx('alarm');
  }
  private updateAftermath(game: Game, dt: number) {
    const A = this.aftermath!, T = CFG.escortTruck;
    A.t += dt;
    const downed = game.soldiers.filter((s) => s.state === 'downed');
    const reviving = downed.some((s) => s.reviving);
    const done = (A.t >= T.wreckEarly && !downed.length) || (A.t >= T.wreckTime && !reviving) || A.t >= T.wreckCap;
    game.setObjective('The supply truck was destroyed.', downed.length ? `Revive ${downed.map((s) => s.name).join(', ')} before the squad pulls out` : 'Pulling out…');
    if (done) game.fail();
  }

  /** v0.6.2 Mission 10: the Iron Warden enters. */
  startBoss(game: Game, at: Vec) {
    const spec = this.script.boss;
    if (!spec || this.boss) return;
    const u = game.spawnEnemy(at, 'boss');
    u.label = 'IRON WARDEN'; u.tag = 'boss'; u.guard = false;
    this.boss = new BossFight(u, spec.arena, spec.gates);
    game.banner('THE IRON WARDEN', '#ff7a5a', 3);
  }

  private activateCurrent(game: Game) {
    const o = this.currentObjective;
    if (o) { o.activate(this, game); this.phase = o.phase; }
    else { this.phase = 'toExtraction'; }
  }

  /** Called by an objective when it completes (exactly once per objective). */
  objectiveDone(o: Objective, game: Game) {
    if (this.optionals.includes(o)) {
      if (!this.ended) { game.banner(`OPTIONAL COMPLETE: ${o.label.toUpperCase()}`, '#7dd3ff', 3); sfx('pickup'); }
      return;
    }
    if (o !== this.currentObjective) return;
    this.current++;
    if (this.primariesDone) game.banner('OBJECTIVE COMPLETE — PROCEED TO EXTRACTION', '#7dff8a', 3.5);
    else game.banner(`OBJECTIVE COMPLETE — ${this.currentObjective!.label.toUpperCase()}`, '#7dff8a', 3);
    this.activateCurrent(game);
  }
  objectiveFailed(o: Objective, game: Game) {
    if (this.optionals.includes(o) && !this.ended) game.banner(`OPTIONAL FAILED: ${o.label.toUpperCase()}`, '#ffb347', 2.5);
  }

  emit(game: Game, ev: MissionEvent) {
    if (this.ended) return;
    if (ev.type === 'vehicleDestroyed') this.convoy?.onDestroyed(game, ev.unit);
    for (const o of [...this.primaries, ...this.optionals]) if (o.state === 'active') o.onEvent(this, game, ev);
    if (ev.type === 'npcKia') { this.failReason = 'The captive was lost.'; game.fail(); }
    if (ev.type === 'assetDestroyed') {
      if (ev.unit === this.protected) { this.failReason = this.script.protect?.failReason ?? 'The command center was destroyed.'; game.fail(); }
      else if (this.escort && ev.unit === this.escort.unit) { this.escort.onDestroyed(game); this.startAftermath(game); }
    }
  }

  /** Mission over: end-evaluated optionals decide now (once). */
  finalize(game: Game, won: boolean) {
    if (this.ended) return;
    for (const o of this.optionals) o.finalize(this, game, won);
    this.ended = true;
  }

  update(game: Game, dt: number) {
    if (this.phase === 'done') return;
    for (const m of this.incoming) m.life -= dt;
    if (this.incoming.length) this.incoming = this.incoming.filter((m) => m.life > 0);
    if (this.aftermath) { this.updateAftermath(game, dt); return; }
    for (const o of this.primaries) if (o.state === 'complete') o.afterComplete(this, game, dt);
    const centre = squadCentre(game.soldiers);
    for (const t of this.script.triggers) {
      if (this.fired.has(t.id) || !centre || !t.when(this, game)) continue;
      this.fired.add(t.id);
      this.spawnWave(game, t.points, t.size(), t.second, t.kinds);
      if (t.banner) game.banner(t.banner, '#ffb347', 3);
    }
    for (const o of this.optionals) if (o.state === 'active') o.update(this, game, dt);
    const cur = this.currentObjective;
    if (cur) {
      cur.update(this, game, dt);
      const now = this.currentObjective;
      if (now) {
        const h = now.hud(this, game);
        const tip = this.current === 0 && this.script.hint && game.time < 14 ? this.script.hint : undefined;
        const sub = tip ?? h.sub;
        game.setObjective(h.text, sub, h.progress, h.chips, h.meter);
      }
      return;
    }
    this.updateExtraction(game, dt);
  }

  private updatePressure(game: Game, dt: number) {
    const P = this.script.extraction.pressure;
    if (!P || this.pressureT < 0) return;
    this.pressureT += dt;
    const groups = pressureGroups(P.tier);
    while (this.pressureGroupsFired < groups.length && groups[this.pressureGroupsFired].delay <= this.pressureT) {
      const g = groups[this.pressureGroupsFired++];
      if (g.size <= 0) continue;
      const pt = this.pressurePoint(game, P.points);
      if (!pt) continue;
      for (let i = 0; i < g.size; i++) {
        const e = game.spawnEnemy(game.findOpenNear(pt, 70), g.kinds?.[i] ?? 'rifleman');
        e.reinforcement = true;
        this.pressureSpawned++;
      }
      this.pressureUsed.push(pt);
      this.incoming.push({ pos: { ...pt }, life: 5 });
      const dir = compass(squadCentre(game.soldiers) ?? game.cam, pt);
      game.banner(this.pressureGroupsFired === 1 ? `ENEMY REINFORCEMENTS INBOUND FROM THE ${dir} — HOLD UNTIL EXTRACTION` : `MORE ENEMIES INBOUND FROM THE ${dir}`, '#ffb347', 3);
      sfx('alarm');
    }
  }

  /** A map-edge spawn point for the next pressure group (see pressureT), or null if the list is empty. */
  private pressurePoint(game: Game, points: Vec[]): Vec | null {
    if (!points.length) return null;
    const squad = [...game.soldiers, ...game.allies].filter((s) => s.active);
    const c = squadCentre(game.soldiers) ?? game.cam;
    const minD = CFG.extractionPressure.minDist;
    const far = (p: Vec) => squad.every((s) => Math.hypot(s.pos.x - p.x, s.pos.y - p.y) >= minD);
    const ok = points.filter((p) => !game.isOnScreen(p, 80) && far(p));
    const fresh = ok.filter((p) => !this.pressureUsed.some((u) => u.x === p.x && u.y === p.y));
    const byNear = (a: Vec, b: Vec) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y);
    return [...fresh].sort(byNear)[0] ?? [...ok].sort(byNear)[0] ?? [...points].sort((a, b) => -byNear(a, b))[0];
  }

  private updateExtraction(game: Game, dt: number) {
    this.updatePressure(game, dt);
    const X = this.script.extraction;
    const active = game.soldiers.filter((s) => s.active);
    const npc = X.requireNpc ? this.npc : null;
    switch (this.phase) {
      case 'toExtraction': {
        game.setObjective(npc ? 'Escort the captive to the extraction zone.' : 'Proceed to extraction.', npc && npc.state === 'downed' ? `${npc.label} DOWN — revive them!` : undefined);
        if (active.some((s) => pointInRect(s.pos, this.extraction.zone))) {
          this.phase = 'countdown';
          this.extraction.begin(game, X.countdown());
          const fw = X.finalWave;
          if (fw) {
            const n = fw.size(), a = Math.ceil(n / 2);
            const units = [...this.spawnWave(game, fw.points, a), ...this.spawnWave(game, fw.points, n - a, true)];
            for (const u of units) u.reinforcement = true;
            if (n > 0) { game.banner('ENEMY REINFORCEMENTS INBOUND — HOLD UNTIL EXTRACTION', '#ffb347', 3); sfx('alarm'); }
          }
          if (X.pressure && this.pressureT < 0) this.pressureT = 0;
        }
        break;
      }
      case 'countdown': {
        this.extraction.update(game, dt);
        game.setObjective(`Hold out until extraction: ${Math.ceil(this.extraction.timeLeft())}s`, undefined,
          this.extraction.total() > 0 ? 1 - this.extraction.timeLeft() / this.extraction.total() : 1);
        if (this.extraction.isAvailable()) {
          this.phase = 'available';
          game.banner(npc ? 'EXTRACTION READY — EVERYONE AND THE CAPTIVE INTO THE ZONE' : 'EXTRACTION READY — EVERYONE INTO THE ZONE', '#7dff8a', 3);
        }
        break;
      }
      case 'available': {
        this.extraction.update(game, dt);
        const downed = game.soldiers.filter((s) => s.state === 'downed');
        const names = downed.map((s) => s.name).join(', ');
        const npcOk = !npc || (npc.active && pointInRect(npc.pos, this.extraction.zone));
        // v0.4: the helicopter waits while a downed soldier (or the captive) is being revived
        const reviving = [...downed, ...(npc && npc.state === 'downed' ? [npc] : [])].some((s) => s.reviving);
        const allIn = active.length > 0 && npcOk && active.every((s) => pointInRect(s.pos, this.extraction.zone));
        this.outT = allIn ? 0 : this.outT + dt;
        if (this.attempt !== 'idle' && (!downed.length || this.outT >= EXTRACT_REARM_S)) this.attempt = 'idle';
        const warn = [
          downed.length && this.attempt === 'stayed' ? `EXTRACTION ON HOLD: rescue ${names}, or leave the zone and come back to extract without them` : '',
          downed.length && this.attempt !== 'stayed' ? `WARNING: ${names} DOWN — revive first or they will be lost!` : '',
          npc && npc.state === 'downed' ? `${npc.label} DOWN — revive them before extracting!` : '',
          npc && npc.active && !pointInRect(npc.pos, this.extraction.zone) ? `Bring the ${npc.label.toLowerCase()} into the zone` : '',
        ].filter(Boolean).join(' · ');
        game.setObjective(npc ? 'Extraction ready: get everyone and the captive into the zone.' : 'Extraction ready: get everyone into the zone.', warn || undefined);
        if (!allIn || reviving) break; // hold (v0.4: a running revive keeps the helicopter waiting)
        if (!downed.length) { this.complete(game); break; }
        if (this.attempt === 'idle') { this.attempt = 'warning'; this.warnAt = game.clock; sfx('deny'); }
        // 'warning' / 'stayed': hold until the player chooses or the downed soldiers' timers resolve
        break;
      }
    }
    // v0.8B: the protected asset's / truck's HP stays on screen through extraction
    const asset = this.protected ?? this.escort?.unit ?? null;
    if (asset && this.phase !== 'done') game.objective.meter = assetMeter(asset, this.protected ? 'COMMAND' : 'TRUCK');
  }

  private complete(game: Game) {
    this.attempt = 'idle';
    this.phase = 'done';
    game.win();
  }

  /** The abandonment warning (HUD): who would be left behind, or null when it is not open. */
  extractWarning(game: Game): { downed: Unit[]; reviving: boolean; armed: boolean } | null {
    if (this.phase !== 'available' || this.attempt !== 'warning') return null;
    const downed = game.soldiers.filter((s) => s.state === 'downed');
    if (!downed.length) return null;
    return { downed, reviving: downed.some((s) => s.reviving), armed: game.clock - this.warnAt >= EXTRACT_WARN_ARM_S };
  }

  /** "Confirm Extraction": every downed soldier is left behind (KIA, abandoned) and the squad extracts. */
  confirmExtraction(game: Game): boolean {
    const w = this.extractWarning(game);
    if (!w || !w.armed || game.phase !== 'playing') return false;
    for (const s of w.downed) game.abandonSoldier(s);
    if (game.phase !== 'playing') return true;
    this.complete(game);
    return true;
  }

  /** "Stay and Rescue": cancel this extraction attempt (timers are untouched). */
  stayAndRescue(game: Game): boolean {
    const w = this.extractWarning(game);
    if (!w || !w.armed) return false;
    this.attempt = 'stayed';
    return true;
  }

  /** Dev / tests: complete every primary objective and make extraction available now. */
  debugReadyExtraction(game: Game) {
    for (const o of this.primaries) if (o.state === 'pending') o.state = 'active';
    for (const o of this.primaries) if (o.state === 'active') o.state = 'complete';
    this.current = this.primaries.length;
    this.phase = 'available';
    this.extraction.begin(game, 0);
    this.extraction.update(game, 0);
  }

  /** Where off-screen arrows should point, if anywhere. */
  objectivePoint(game: Game): ObjPoint | null {
    if (this.phase === 'done') return null;
    const cur = this.currentObjective;
    if (cur) return cur.point(this, game);
    const z = this.extraction.zone;
    return { pos: { x: z.x + z.w / 2, y: z.y + z.h / 2 }, label: 'EXTRACT', color: '#7dff8a' };
  }

  /** Ground-level mission drawing: objective zones, wrecks. */
  draw(ctx: CanvasRenderingContext2D, game: Game) {
    if (this.script.gated) drawGates(ctx, this.script.gated.obstacles.filter((o) => o.kind === 'gate'), this.gatesClosed);
    for (const o of this.primaries) o.draw(ctx, this, game);
    for (const w of this.wrecks) drawWreck(ctx, w.pos, w.kind);
    this.artillery?.drawGround(ctx, game);
  }
}

/** Compass word for the direction from `from` to `to` (screen up = NORTH). */
function compass(from: Vec, to: Vec): string {
  const a = Math.atan2(to.y - from.y, to.x - from.x) / Math.PI * 4; // -4..4, 0 = east
  const k = ((Math.round(a) % 8) + 8) % 8;
  return ['EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST', 'NORTH', 'NORTHEAST'][k];
}

function drawWreck(ctx: CanvasRenderingContext2D, p: Vec, kind = '') {
  if (kind === 'truck') {
    ctx.fillStyle = 'rgba(25,20,15,0.6)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 52, 28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b3530'; ctx.fillRect(p.x - 34, p.y - 16, 50, 26);
    ctx.fillStyle = '#2a2622'; ctx.fillRect(p.x + 16, p.y - 12, 18, 20);
    ctx.fillStyle = '#1c1a18';
    for (const dx of [-26, -4, 22]) { ctx.beginPath(); ctx.arc(p.x + dx, p.y + 12, 6, 0, Math.PI * 2); ctx.fill(); }
    return;
  }
  ctx.fillStyle = 'rgba(30,25,20,0.55)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 46, 26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3a2c';
  ctx.fillRect(p.x - 26, p.y - 10, 18, 12); ctx.fillRect(p.x + 6, p.y - 4, 22, 10); ctx.fillRect(p.x - 6, p.y + 6, 14, 8);
}
