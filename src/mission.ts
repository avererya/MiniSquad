// Mission flow: advance (triggered waves) -> clear outpost defenders -> hold
// -> go to extraction -> final wave + countdown -> extraction available -> done.
// Extraction is behind a small interface so a vehicle can be slotted in.
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import { DEFENDER_POINTS, EXTRACTION_ZONE, FINAL_WAVE_POINTS, OUTPOST_ZONE, TRIGGERS } from './map';
import { pointInRect, type Rect, type Vec } from './util';
import { squadCentre } from './squad';

export type Phase = 'outpost' | 'hold' | 'toExtraction' | 'countdown' | 'available' | 'done';

/** Anything that can extract the squad (timer + helicopter now; trucks/boats later). */
export interface Extraction {
  readonly zone: Rect;
  begin(game: Game): void;
  update(game: Game, dt: number): void;
  /** Seconds until extraction is available (0 when available). */
  timeLeft(): number;
  isAvailable(): boolean;
  draw(ctx: CanvasRenderingContext2D, game: Game): void;
}

export class HelicopterExtraction implements Extraction {
  readonly zone = EXTRACTION_ZONE;
  private left = 0;
  private started = false;
  private t = 0;
  begin() { this.left = CFG.mission.extractionCountdown; this.started = true; }
  update(_g: Game, dt: number) { if (this.started) { this.left = Math.max(0, this.left - dt); this.t += dt; } }
  timeLeft() { return this.left; }
  isAvailable() { return this.started && this.left <= 0; }
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.started) return;
    const arrive = CFG.mission.heliArriveTime;
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

/** An optional (secondary) objective. Secure the Communications Outpost has none yet. */
export interface OptionalObjective { id: string; label: string; completed: boolean }

export class Mission {
  /** Stable mission id: first-completion records and replay rewards are keyed by it. */
  static readonly ID = 'comms-outpost';
  static readonly NAME = 'Secure the Communications Outpost';
  readonly id = Mission.ID;
  /** Optional objectives (rewarded with XP + Credits when completed). None in this mission. */
  optional: OptionalObjective[] = [];
  phase: Phase = 'outpost';
  fired = new Set<string>();
  defenders: Unit[] = [];
  holdProgress = 0;
  extraction: Extraction = new HelicopterExtraction();
  warnedDowned = false;

  start(game: Game) {
    const pts = DEFENDER_POINTS.slice(0, CFG.mission.defenders);
    for (const p of pts) {
      const e = game.spawnEnemy(p);
      e.guard = true; e.defender = true;
      this.defenders.push(e);
    }
    game.setObjective('Secure the communications outpost.');
  }

  defendersLeft() { return this.defenders.filter((d) => d.active).length; }

  update(game: Game, dt: number) {
    const centre = squadCentre(game.soldiers);
    const active = game.soldiers.filter((s) => s.active);

    // position-triggered waves, spawned out of camera view
    if (centre) {
      for (const t of TRIGGERS) {
        if (!this.fired.has(t.id) && centre.x > t.triggerX) {
          this.fired.add(t.id);
          game.spawnGroupOffscreen(t.candidates, CFG.mission[t.sizeKey]);
        }
      }
    }

    switch (this.phase) {
      case 'outpost': {
        const left = this.defendersLeft();
        game.setObjective('Secure the communications outpost.', left ? `Defenders: ${left}` : undefined);
        if (left === 0) this.phase = 'hold';
        break;
      }
      case 'hold': {
        const inside = active.some((s) => pointInRect(s.pos, OUTPOST_ZONE));
        if (inside) this.holdProgress += dt; // progress pauses (is kept) when nobody is inside
        const need = CFG.mission.outpostHold;
        game.setObjective(inside ? 'Securing outpost...' : 'Get inside the outpost to secure it.', undefined, this.holdProgress / need);
        if (this.holdProgress >= need) {
          this.phase = 'toExtraction';
          game.banner('OBJECTIVE COMPLETE — PROCEED TO EXTRACTION', '#7dff8a', 3.5);
        }
        break;
      }
      case 'toExtraction': {
        game.setObjective('Proceed to extraction.');
        if (active.some((s) => pointInRect(s.pos, this.extraction.zone))) {
          this.phase = 'countdown';
          this.extraction.begin(game);
          const n = CFG.mission.finalWaveSize;
          const a = Math.ceil(n / 2);
          game.spawnGroupOffscreen(FINAL_WAVE_POINTS, a);
          game.spawnGroupOffscreen(FINAL_WAVE_POINTS, n - a, true);
          game.banner('ENEMY REINFORCEMENTS INBOUND — HOLD UNTIL EXTRACTION', '#ffb347', 3);
        }
        break;
      }
      case 'countdown': {
        this.extraction.update(game, dt);
        game.setObjective(`Hold out until extraction: ${Math.ceil(this.extraction.timeLeft())}s`, undefined,
          1 - this.extraction.timeLeft() / CFG.mission.extractionCountdown);
        if (this.extraction.isAvailable()) {
          this.phase = 'available';
          game.banner('EXTRACTION READY — EVERYONE INTO THE ZONE', '#7dff8a', 3);
        }
        break;
      }
      case 'available': {
        this.extraction.update(game, dt);
        const downed = game.soldiers.filter((s) => s.state === 'downed');
        game.setObjective('Extraction ready: get everyone into the zone.',
          downed.length ? `WARNING: ${downed.map((s) => s.name).join(', ')} DOWN — revive first or they will be lost!` : undefined);
        if (active.length && active.every((s) => pointInRect(s.pos, this.extraction.zone))) {
          for (const s of downed) s.state = 'kia';
          this.phase = 'done';
          game.win();
        }
        break;
      }
    }
  }

  /** Where off-screen arrows should point, if anywhere. */
  objectivePoint(): { pos: Vec; label: string; color: string } | null {
    const z = this.phase === 'outpost' || this.phase === 'hold' ? OUTPOST_ZONE : this.extraction.zone;
    const label = this.phase === 'outpost' || this.phase === 'hold' ? 'OUTPOST' : 'EXTRACT';
    const color = label === 'OUTPOST' ? '#ffd84a' : '#7dff8a';
    if (this.phase === 'done') return null;
    return { pos: { x: z.x + z.w / 2, y: z.y + z.h / 2 }, label, color };
  }
}
