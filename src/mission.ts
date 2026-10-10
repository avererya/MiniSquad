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
import { pointInRect, type Rect, type Vec } from './util';
import { squadCentre } from './squad';
import { sfx } from './audio';
import { EXTRACT_REARM_S, EXTRACT_WARN_ARM_S } from './casualties';

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
export interface GroupSpec { tag: string; points: Vec[]; guard?: boolean; aggro?: number; defender?: boolean }
export interface TriggerSpec {
  id: string;
  when: (m: Mission, g: Game) => boolean;
  points: Vec[];
  size: () => number;
  /** Use the second-nearest off-screen point (flanking). */
  second?: boolean;
  banner?: string;
}
export interface ExtractionSpec {
  zone: Rect;
  countdown: () => number;
  finalWave?: { points: Vec[]; size: () => number };
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
  /** One-line tips shown under the first objective (Mission 1 only). */
  hint?: string;
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

  constructor(readonly script: MissionScript) {
    this.id = script.id;
    this.def = campaignMission(script.id)!;
    this.name = this.def.name;
    this.primaries = script.primaries();
    this.optionals = script.optionals();
    this.extraction = new HelicopterExtraction(script.extraction.zone);
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
    if (this.script.captive) this.npc = game.spawnNpc(this.script.captive, 'CAPTIVE');
    for (const o of this.optionals) o.activate(this, game);
    this.activateCurrent(game);
  }

  spawnGroup(game: Game, grp: GroupSpec): Unit[] {
    const out: Unit[] = [];
    for (const p of grp.points) {
      const e = game.spawnEnemy(game.world.isOpen(p.x, p.y) ? p : game.findOpenNear(p, 24));
      e.tag = grp.tag; e.guard = grp.guard ?? true; e.defender = !!grp.defender; e.aggro = grp.aggro ?? null;
      out.push(e);
    }
    this.spawned.set(grp.tag, (this.spawned.get(grp.tag) ?? 0) + out.length);
    return out;
  }

  /** Reinforcements from the nearest off-screen point (untagged: they don't count for objectives). */
  spawnWave(game: Game, points: Vec[], size: number, second = false) {
    return game.spawnGroupOffscreen(points, size, second);
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
    for (const o of [...this.primaries, ...this.optionals]) if (o.state === 'active') o.onEvent(this, game, ev);
    if (ev.type === 'npcKia') { this.failReason = 'The captive was lost.'; game.fail(); }
  }

  /** Mission over: end-evaluated optionals decide now (once). */
  finalize(game: Game, won: boolean) {
    if (this.ended) return;
    for (const o of this.optionals) o.finalize(this, game, won);
    this.ended = true;
  }

  update(game: Game, dt: number) {
    if (this.phase === 'done') return;
    const centre = squadCentre(game.soldiers);
    for (const t of this.script.triggers) {
      if (this.fired.has(t.id) || !centre || !t.when(this, game)) continue;
      this.fired.add(t.id);
      this.spawnWave(game, t.points, t.size(), t.second);
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
        game.setObjective(h.text, sub, h.progress);
      }
      return;
    }
    this.updateExtraction(game, dt);
  }

  private updateExtraction(game: Game, dt: number) {
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
            this.spawnWave(game, fw.points, a);
            this.spawnWave(game, fw.points, n - a, true);
            if (n > 0) game.banner('ENEMY REINFORCEMENTS INBOUND — HOLD UNTIL EXTRACTION', '#ffb347', 3);
          }
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
    for (const o of this.primaries) o.draw(ctx, this, game);
    for (const w of this.wrecks) drawWreck(ctx, w.pos);
  }
}

function drawWreck(ctx: CanvasRenderingContext2D, p: Vec) {
  ctx.fillStyle = 'rgba(30,25,20,0.55)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 46, 26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3a2c';
  ctx.fillRect(p.x - 26, p.y - 10, 18, 12); ctx.fillRect(p.x + 6, p.y - 4, 22, 10); ctx.fillRect(p.x - 6, p.y + 6, 14, 8);
}
