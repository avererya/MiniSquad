// v0.9A LAND MINES: a reusable MissionMechanic (MissionScript.mechanics). Mission 16 "Jungle Sweep" is the first user;
// a later mission reuses it with its own positions: `mechanics: () => [new MineField({ mines: MY_MINES })]`.
//
// RULES (numbers in CFG.mine; a field may override any of them with `tuning`):
//  - States: hidden -> revealed -> detonated (a mine can also go hidden -> detonated). Nothing goes back, so a
//    detonated mine never triggers, shows or explodes again, and a revealed one stays revealed.
//  - Detection: a hidden mine is revealed the first time a standing squad soldier comes within detectRadius. It then
//    shows a ground marker with its blast ring until it goes off. Mines are never all revealed at the start.
//  - Trigger: anyone on foot (soldier, ally, escorted captive, enemy) whose centre comes within triggerRadius sets it
//    off, hidden or revealed. Nobody paths around mines, before or after they are revealed: steering is the player's.
//  - Shooting: a revealed mine becomes a 'mine' structure unit in Game.enemies (hp, no HP bar, never an obstacle), so
//    rounds aimed at it, grenades, rockets and flames can set it off. It is NEVER an automatic target (Game.update
//    leaves mines out of the squad's candidates, and rounds aimed elsewhere pass over it). The player orders it shot
//    by tapping / clicking it (tap): every soldier gets it as `Unit.order` for orderTime s; a soldier shoots it while
//    it is in weapon range and line of sight (ahead of enemies), and fights normally otherwise. The order ends when
//    the mine goes off or the time runs out, so nobody is left aiming at a mine that is gone.
//  - Blast: the shared blastDamage (combat.ts) on BOTH teams (soldiers, allies, captives, assets and enemies), solid
//    cover shelters, linear falloff, DamageOpts.grenade (no Armored Trooper frontal plate; Elite reductions apply).
//    No source: no kill credit, no stats. A blast arms a short fuse (chainDelay) on every other armed mine within
//    chainRadius in sight; each mine goes off once, so a chain always ends.
//  - Fixed step only (simulation time); no Math.random. Per attempt: Retry / a reload builds a fresh field (nothing
//    is saved).
import { CFG } from './config';
import type { Game } from './game';
import type { Mission, MissionMechanic } from './mission';
import type { MissionEvent } from './objectives';
import type { StoryCue } from './story';
import { NearestVisible } from './targeting';
import { Unit, isMine } from './unit';
import { blastDamage } from './combat';
import { dist2, type Vec } from './util';
import { sfx } from './audio';

export type MineState = 'hidden' | 'revealed' | 'detonated';
export type MineCause = 'soldier' | 'ally' | 'enemy' | 'shot' | 'chain';
export interface Mine {
  readonly id: number;
  readonly pos: Vec;
  state: MineState;
  /** The shootable structure unit while revealed (null while hidden / after the blast). */
  unit: Unit | null;
  /** Seconds until a chained / shot mine goes off (-1: none pending). */
  fuse: number;
  fuseCause: MineCause;
  revealedAt: number;
  detonatedAt: number;
  cause: MineCause | null;
}
export interface MineFieldSpec {
  /** Mine positions (open ground). */
  mines: Vec[];
  /** Story cue played once when a standing soldier first comes within warnRadius of an armed mine (a radio warning). */
  warnCue?: StoryCue;
  warnRadius?: number;
  /** Per-field overrides of CFG.mine (a later mission's heavier mines, a wider detection). */
  tuning?: Partial<typeof CFG.mine>;
}
/** What happened in this attempt (objectives and tests read it). */
export interface MineLog {
  revealed: number;
  detonations: number;
  /** Enemies killed by mine blasts / squad soldiers hurt by them / the blasts that hurt at least one soldier. */
  enemyKills: number;
  soldierHits: number;
  soldierBlasts: number;
  /** Damage dealt to each team by mine blasts. */
  enemyDamage: number;
  squadDamage: number;
  orders: number;
  byCause: Record<MineCause, number>;
}

/** A floating word over a mine (no jitter: FxSystem.text would draw from Math.random, and a tap is input time). */
function label(g: Game, x: Mine, text: string, color: string) {
  g.fx.texts.push({ pos: { x: x.pos.x, y: x.pos.y - 50 }, text, life: 0.9, color });
}

export class MineField implements MissionMechanic {
  readonly id = 'mines';
  readonly mines: Mine[];
  /** The current "shoot this mine" order (one at a time; a new tap replaces it). */
  order: { mine: Mine; until: number } | null = null;
  warned = false;
  log: MineLog = { revealed: 0, detonations: 0, enemyKills: 0, soldierHits: 0, soldierBlasts: 0, enemyDamage: 0, squadDamage: 0, orders: 0, byCause: { soldier: 0, ally: 0, enemy: 0, shot: 0, chain: 0 } };

  constructor(readonly spec: MineFieldSpec) {
    this.mines = spec.mines.map((p, id) => ({ id, pos: { x: p.x, y: p.y }, state: 'hidden', unit: null, fuse: -1, fuseCause: 'chain', revealedAt: -1, detonatedAt: -1, cause: null }));
  }

  /** A CFG.mine number, or this field's override. */
  num<K extends keyof typeof CFG.mine>(k: K): number { return this.spec.tuning?.[k] ?? CFG.mine[k]; }
  get armed() { return this.mines.filter((x) => x.state !== 'detonated'); }

  step(m: Mission, g: Game, dt: number) {
    // 1. fuses (a chained or shot mine), in mine order; a fuse lit by a blast in this loop starts counting next step,
    //    so every link of a chain waits exactly chainDelay whatever the mines' order
    for (const x of this.mines.filter((k) => k.state !== 'detonated' && k.fuse >= 0)) {
      if (x.state === 'detonated') continue;
      x.fuse -= dt;
      if (x.fuse <= 1e-9) this.detonate(g, x, x.fuseCause);
    }
    // 2. detection (standing soldiers), then 3. triggers (anyone on foot)
    const det2 = this.num('detectRadius') ** 2, trg2 = this.num('triggerRadius') ** 2;
    for (const x of this.mines) {
      if (x.state !== 'hidden') continue;
      if (g.soldiers.some((s) => s.active && dist2(s.pos, x.pos) <= det2)) this.reveal(g, x);
    }
    for (const x of this.mines) {
      if (x.state === 'detonated') continue;
      const by = this.triggeredBy(g, x, trg2);
      if (by) this.detonate(g, x, by);
    }
    // 4. the order ends with its mine or its time
    const o = this.order;
    if (o && (o.mine.state !== 'revealed' || g.time >= o.until)) this.clearOrder(g);
    // 5. the radio warning, once
    if (!this.warned && this.spec.warnCue) {
      const w2 = (this.spec.warnRadius ?? 500) ** 2;
      if (this.mines.some((x) => x.state !== 'detonated' && g.soldiers.some((s) => s.active && dist2(s.pos, x.pos) <= w2))) {
        this.warned = true;
        m.cue(g, this.spec.warnCue);
      }
    }
  }

  /** Who (if anyone) stands on this mine: soldiers, allies, captives, then enemies on foot. */
  private triggeredBy(g: Game, x: Mine, r2: number): MineCause | null {
    for (const s of g.soldiers) if (s.active && !s.mount && dist2(s.pos, x.pos) < r2) return 'soldier';
    for (const a of g.allies) if (a.active && dist2(a.pos, x.pos) < r2) return 'ally';
    for (const n of g.npcs) if (n.active && dist2(n.pos, x.pos) < r2) return 'ally';
    for (const e of g.enemies) if (e.active && !e.structure && !e.fixed && dist2(e.pos, x.pos) < r2) return 'enemy';
    return null;
  }

  reveal(g: Game, x: Mine) {
    if (x.state !== 'hidden') return;
    x.state = 'revealed';
    x.revealedAt = g.time;
    const u = new Unit('enemy', x.pos, NearestVisible);
    u.structure = 'mine'; u.label = 'MINE'; u.guard = true; u.fixed = true;
    u.setMaxHp(this.num('hp'));
    g.enemies.push(u);
    x.unit = u;
    this.log.revealed++;
    label(g, x, 'MINE!', '#ff5a4a');
    if (this.log.revealed === 1) g.say('MINE SPOTTED — STEER AROUND IT, OR TAP IT TO SHOOT IT', 4);
    sfx('beep');
  }

  /** Sets the mine off now (once). Its blast hurts both teams and lights a short fuse on the armed mines around it. */
  detonate(g: Game, x: Mine, cause: MineCause) {
    if (x.state === 'detonated') return;
    x.state = 'detonated';
    x.cause = cause; x.fuse = -1; x.detonatedAt = g.time;
    if (x.unit) { x.unit.hp = 0; x.unit.state = 'dead'; }
    if (this.order?.mine === x) this.clearOrder(g);
    x.unit = null;
    this.log.detonations++;
    this.log.byCause[cause]++;
    const R = this.num('blastRadius');
    const victims = [...g.enemies.filter((e) => !isMine(e)), ...g.enemyVictims()];
    const before = victims.map((u) => (u.active ? u.hp : -1));
    blastDamage(g, x.pos, { radius: R, damage: this.num('damage'), edgeFrac: this.num('edgeFrac'), victims, cover: true, opts: { grenade: true, at: x.pos } });
    let squadHit = false;
    victims.forEach((u, i) => {
      if (before[i] < 0) return;
      const lost = Math.max(0, before[i] - Math.max(0, u.hp));
      if (!(lost > 0) && u.active) return;
      if (u.team === 'enemy') {
        this.log.enemyDamage += lost;
        if (!u.active && !u.structure && !u.vehicle) this.log.enemyKills++;
      } else if (u.identity) {
        this.log.squadDamage += lost; this.log.soldierHits++; squadHit = true;
      }
    });
    if (squadHit) this.log.soldierBlasts++;
    // the explosion: a dirt column, fire, smoke, a scorch
    g.fx.ring(x.pos, R, 'rgba(255,170,80,0.95)', 0.4, 6);
    g.fx.burst(x.pos, 30, '#ffb347', 420, 0.5, 5);
    g.fx.burst(x.pos, 18, '#6a5236', 260, 0.9, 7);
    g.fx.burst(x.pos, 12, '#5e5e5e', 140, 1.1, 8);
    g.fx.shake = Math.max(g.fx.shake, this.num('shake'));
    g.scorches.push({ x: x.pos.x, y: x.pos.y, r: R * 0.5 });
    sfx('boom');
    // chain: every other armed mine in reach and in sight goes off after a short delay (once each)
    const c2 = this.num('chainRadius') ** 2;
    for (const o of this.mines) {
      if (o === x || o.state === 'detonated' || o.fuse >= 0) continue;
      if (dist2(o.pos, x.pos) <= c2 && g.world.clear(x.pos, o.pos)) { o.fuse = this.num('chainDelay'); o.fuseCause = 'chain'; }
    }
  }

  onEvent(_m: Mission, _g: Game, ev: MissionEvent) {
    // a revealed mine shot / blown / burnt to 0 HP goes off on the next step (never inside the damage that killed it)
    if (ev.type !== 'structureDestroyed' || !isMine(ev.unit)) return;
    const x = this.mines.find((k) => k.unit === ev.unit);
    if (x && x.state === 'revealed' && x.fuse < 0) { x.fuse = 0; x.fuseCause = 'shot'; }
  }

  /** Tap / click: the nearest revealed mine within tapRadius becomes the squad's order. */
  tap(_m: Mission, g: Game, at: Vec): boolean {
    let best: Mine | null = null, bd = this.num('tapRadius') ** 2;
    for (const x of this.mines) {
      if (x.state !== 'revealed' || !x.unit) continue;
      const d = dist2(at, x.pos);
      if (d <= bd) { bd = d; best = x; }
    }
    if (!best) return false;
    this.orderMine(g, best);
    return true;
  }

  /** Order every soldier to shoot this revealed mine (replaces any earlier order). */
  orderMine(g: Game, x: Mine) {
    if (x.state !== 'revealed' || !x.unit) return false;
    if (this.order) this.clearOrder(g);
    this.order = { mine: x, until: g.time + this.num('orderTime') };
    for (const s of g.soldiers) s.order = x.unit;
    this.log.orders++;
    const can = g.soldiers.some((s) => s.active && s.targeting.isValid(s, x.unit!, g));
    label(g, x, 'TARGET', '#ffd84a');
    if (!can) g.say('MINE TARGETED — MOVE INTO RANGE AND SIGHT');
    sfx('lock');
    return true;
  }

  clearOrder(g: Game) {
    const u = this.order?.mine.unit ?? null;
    this.order = null;
    for (const s of g.soldiers) {
      if (s.order && (s.order === u || !u)) s.order = null;
      if (u && s.target === u) s.target = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, _m: Mission, g: Game) {
    const t = g.clock, R = this.num('blastRadius'), TR = this.num('triggerRadius');
    for (const x of this.mines) {
      if (x.state !== 'revealed') continue;
      const { x: px, y: py } = x.pos;
      if (Math.abs(px - g.cam.x) > 720 || Math.abs(py - g.cam.y) > 440) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5 + x.id);
      // the blast ring (faint, dashed) and the danger zone under the mine
      ctx.fillStyle = 'rgba(255,60,40,0.07)';
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash([8, 7]); ctx.strokeStyle = `rgba(255,70,50,${0.35 + 0.2 * pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(255,60,40,${0.55 + 0.35 * pulse})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(px, py, TR, 0, Math.PI * 2); ctx.stroke();
      // the mine: a dull plate half in the dirt, three prongs, a red light
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(px + 1, py + 2, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4c5338'; ctx.strokeStyle = '#23271a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(px, py, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#8f8f7a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px - 4, py - 2); ctx.lineTo(px - 5, py - 6); ctx.moveTo(px, py - 3); ctx.lineTo(px, py - 8); ctx.moveTo(px + 4, py - 2); ctx.lineTo(px + 5, py - 6); ctx.stroke();
      ctx.fillStyle = pulse > 0.5 ? '#ff3b2a' : '#8a1a12'; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
      // a small warning triangle beside it (to the right, so it never sits on a soldier walking past the mine)
      const wx = px + 16, wy = py - 18;
      ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(wx, wy - 8); ctx.lineTo(wx + 8, wy + 6); ctx.lineTo(wx - 8, wy + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a1a0a'; ctx.fillRect(wx - 1, wy - 3, 2, 5); ctx.fillRect(wx - 1, wy + 3, 2, 2);
      // the current order: a turning reticle
      if (this.order?.mine === x) {
        const a = t * 2;
        ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2;
        for (let k = 0; k < 4; k++) { const b = a + (k * Math.PI) / 2; ctx.beginPath(); ctx.arc(px, py, 16, b, b + 0.9); ctx.stroke(); }
      }
    }
  }
}
