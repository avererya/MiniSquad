// v0.9B FUEL TANKS: a reusable MissionMechanic (MissionScript.mechanics), the second explosive after the v0.9A mines.
// Mission 17 "Fuel for the Fire" is the first user; a later mission reuses it with its own tanks:
// `mechanics: () => [new FuelDepot({ tanks: MY_TANKS })]` (each tank has a position and the installation it belongs to).
//
// RULES (numbers in CFG.fuel; a depot may override any of them with `tuning`):
//  - States: intact -> burning (a short fuse) -> exploded. Nothing goes back: a tank explodes exactly once.
//  - Visible from the start: every tank is a 'fuel' structure unit in Game.enemies (an HP bar, an obstacle for
//    movement, never for sight or rounds). Rounds aimed at it, grenades, rockets, flames, mine blasts and Tactical
//    Support damage it; at 0 HP (structureDestroyed) its fuse is lit and it explodes on the next step.
//  - Targeting: a tank is an automatic target (lowest priority, like every structure: only when no enemy is in
//    sight) only while nobody on the squad's side (soldiers, downed ones included, allies, captives) stands within
//    safeDist of it (fuelSafe, Game.update). Otherwise only a player order aims at it: tap / click a tank and every
//    soldier gets it as `Unit.order` for orderTime s (shot while in range and sight, ahead of enemies). Rounds aimed
//    elsewhere pass over a tank (isHazard), so the squad never blows one up by accident.
//  - Blast: the shared blastDamage on BOTH teams with solid cover and linear falloff, DamageOpts.grenade. Enemies'
//    damage and kills are credited to the soldier who set the tank off (its last hit, carried along a chain), so
//    environmental kills count in mission stats; the squad's own damage has no source. A blast lights a chainDelay
//    fuse on every other intact tank within chainRadius in sight (each once, so a chain always ends) and damages
//    revealed mines like any explosion (a mine field then sets them off).
//  - Tactical Support (supportStrike): an airstrike sets off every tank in its circle, the nuke every tank.
//  - Fixed step only (simulation time); no Math.random. Per attempt: Retry / a reload builds a fresh depot.
import { CFG } from './config';
import type { Game } from './game';
import type { Mission, MissionMechanic } from './mission';
import type { MissionEvent } from './objectives';
import type { StoryCue } from './story';
import { NearestVisible } from './targeting';
import { Unit } from './unit';
import { blastDamage } from './combat';
import { dist2, type Vec } from './util';
import { sfx } from './audio';

export type TankState = 'intact' | 'burning' | 'exploded';
export type TankCause = 'shot' | 'chain' | 'support';
export interface TankSpec { x: number; y: number; /** Installation id (objectives count tanks per group). */ group: string }
export interface FuelTank {
  readonly id: number;
  readonly pos: Vec;
  readonly group: string;
  state: TankState;
  unit: Unit;
  /** Seconds until a burning tank explodes (-1: not lit). */
  fuse: number;
  cause: TankCause | null;
  /** The soldier its blast is credited to (whoever set it, or the tank that chained it, off). */
  credit: Unit | null;
  explodedAt: number;
}
export interface FuelDepotSpec {
  tanks: TankSpec[];
  /** Story cue played once when a standing soldier first comes within warnRadius of an intact tank. */
  warnCue?: StoryCue;
  warnRadius?: number;
  tuning?: Partial<typeof CFG.fuel>;
}
export interface FuelLog {
  explosions: number;
  /** Enemies killed by fuel blasts (any cause), squad soldiers hurt, blasts that hurt at least one soldier. */
  enemyKills: number;
  soldierHits: number;
  soldierBlasts: number;
  enemyDamage: number;
  squadDamage: number;
  orders: number;
  /** Longest chain (tanks that went off from one first explosion, that one included). */
  longestChain: number;
  byCause: Record<TankCause, number>;
}

/** Is a fuel tank safe to shoot automatically: nobody on the squad's side inside its safe distance? */
export function fuelSafe(g: Game, tank: Unit): boolean {
  const r2 = CFG.fuel.safeDist ** 2;
  for (const s of g.soldiers) if ((s.state === 'active' || s.state === 'downed') && dist2(s.pos, tank.pos) < r2) return false;
  for (const a of g.allies) if (a.state !== 'dead' && a.state !== 'kia' && dist2(a.pos, tank.pos) < r2) return false;
  for (const n of g.npcs) if (n.escorting && n.state !== 'kia' && dist2(n.pos, tank.pos) < r2) return false;
  return true;
}

export class FuelDepot implements MissionMechanic {
  readonly id = 'fuel';
  readonly tanks: FuelTank[] = [];
  order: { tank: FuelTank; until: number } | null = null;
  warned = false;
  /** Chain bookkeeping: tank id -> the first tank of its chain. */
  private root = new Map<number, number>();
  log: FuelLog = { explosions: 0, enemyKills: 0, soldierHits: 0, soldierBlasts: 0, enemyDamage: 0, squadDamage: 0, orders: 0, longestChain: 0, byCause: { shot: 0, chain: 0, support: 0 } };

  constructor(readonly spec: FuelDepotSpec) {}

  num<K extends keyof typeof CFG.fuel>(k: K): number { return this.spec.tuning?.[k] ?? CFG.fuel[k]; }
  intact(group?: string) { return this.tanks.filter((t) => t.state !== 'exploded' && (!group || t.group === group)); }
  groups(): string[] { return [...new Set(this.spec.tanks.map((t) => t.group))]; }

  start(_m: Mission, g: Game) {
    this.spec.tanks.forEach((p, id) => {
      const u = new Unit('enemy', { x: p.x, y: p.y }, NearestVisible);
      u.structure = 'fuel'; u.label = 'FUEL'; u.guard = true; u.fixed = true;
      u.radiusOverride = this.num('radius');
      u.setMaxHp(this.num('hp'));
      g.enemies.push(u);
      this.tanks.push({ id, pos: u.pos, group: p.group, state: 'intact', unit: u, fuse: -1, cause: null, credit: null, explodedAt: -1 });
    });
  }

  step(m: Mission, g: Game, dt: number) {
    // fuses in tank order; a fuse lit by a blast in this loop starts counting next step (every chain link waits chainDelay)
    for (const t of this.tanks.filter((k) => k.state === 'burning')) {
      t.fuse -= dt;
      if (t.fuse <= 1e-9) this.explode(g, t);
    }
    const o = this.order;
    if (o && (o.tank.state !== 'intact' || g.time >= o.until)) this.clearOrder(g);
    if (!this.warned && this.spec.warnCue) {
      const w2 = (this.spec.warnRadius ?? 600) ** 2;
      if (this.tanks.some((t) => t.state === 'intact' && g.soldiers.some((s) => s.active && dist2(s.pos, t.pos) <= w2))) {
        this.warned = true;
        m.cue(g, this.spec.warnCue);
      }
    }
  }

  /** Light a tank's fuse (once). */
  ignite(t: FuelTank, cause: TankCause, delay: number, credit: Unit | null, root?: number) {
    if (t.state !== 'intact') return;
    t.state = 'burning'; t.fuse = delay; t.cause = cause; t.credit = credit;
    this.root.set(t.id, root ?? t.id);
  }

  /** The tank explodes now (once): both teams, cover, credit to its shooter, chains. */
  explode(g: Game, t: FuelTank) {
    if (t.state === 'exploded') return;
    t.state = 'exploded'; t.fuse = -1; t.explodedAt = g.time;
    if (t.unit.state !== 'dead') { t.unit.hp = 0; t.unit.state = 'dead'; }
    if (this.order?.tank === t) this.clearOrder(g);
    this.log.explosions++;
    this.log.byCause[t.cause ?? 'shot']++;
    const R = this.num('blastRadius'), D = this.num('damage'), E = this.num('edgeFrac');
    const src = t.credit && t.credit.identity ? t.credit : undefined;
    const foes = g.enemies.filter((e) => e.structure !== 'fuel');
    const friends = g.enemyVictims();
    const victims = [...foes, ...friends];
    const before = victims.map((u) => (u.active ? u.hp : -1));
    blastDamage(g, t.pos, { radius: R, damage: D, edgeFrac: E, victims: foes, source: src, cover: true, opts: { grenade: true, origin: t.pos } });
    blastDamage(g, t.pos, { radius: R, damage: D, edgeFrac: E, victims: friends, cover: true, opts: { grenade: true } });
    let squadHit = false;
    victims.forEach((u, i) => {
      if (before[i] < 0) return;
      const lost = Math.max(0, before[i] - Math.max(0, u.hp));
      if (!(lost > 0) && u.active) return;
      if (u.team === 'enemy') {
        this.log.enemyDamage += lost;
        if (!u.active && !u.structure && !u.vehicle) this.log.enemyKills++;
      } else if (u.identity) { this.log.squadDamage += lost; this.log.soldierHits++; squadHit = true; }
    });
    if (squadHit) this.log.soldierBlasts++;
    // a fireball, a black smoke column, burning debris, a big scorch
    g.fx.ring(t.pos, R, 'rgba(255,150,60,0.95)', 0.45, 8);
    g.fx.ring(t.pos, R * 0.55, 'rgba(255,240,170,0.95)', 0.25, 6);
    g.fx.burst(t.pos, 36, '#ff9a2e', 480, 0.6, 6);
    g.fx.burst(t.pos, 20, '#ffd36a', 300, 0.4, 4);
    g.fx.burst(t.pos, 16, '#2e2a26', 160, 1.4, 10);
    g.fx.shake = Math.max(g.fx.shake, this.num('shake'));
    g.scorches.push({ x: t.pos.x, y: t.pos.y, r: R * 0.6 });
    sfx('boom');
    // chain: every other intact tank in reach and in sight
    const c2 = this.num('chainRadius') ** 2, root = this.root.get(t.id) ?? t.id;
    for (const o of this.tanks) {
      if (o === t || o.state !== 'intact') continue;
      if (dist2(o.pos, t.pos) <= c2 && g.world.clear(t.pos, o.pos)) this.ignite(o, 'chain', this.num('chainDelay'), t.credit, root);
    }
    const n = this.tanks.filter((k) => k.state !== 'intact' && this.root.get(k.id) === root).length;
    this.log.longestChain = Math.max(this.log.longestChain, n);
  }

  onEvent(_m: Mission, _g: Game, ev: MissionEvent) {
    // shot / blown / burnt to 0 HP: explodes on the next step (never inside the damage that destroyed it)
    if (ev.type !== 'structureDestroyed' || ev.unit.structure !== 'fuel') return;
    const t = this.tanks.find((k) => k.unit === ev.unit);
    if (t) this.ignite(t, 'shot', 0, ev.unit.lastHitBy);
  }

  supportStrike(_m: Mission, _g: Game, at: Vec | null, radius: number) {
    const r2 = radius * radius;
    for (const t of this.tanks) if (t.state === 'intact' && (!at || dist2(at, t.pos) <= r2)) this.ignite(t, 'support', 0, null);
  }

  tap(_m: Mission, g: Game, at: Vec): boolean {
    let best: FuelTank | null = null, bd = this.num('tapRadius') ** 2;
    for (const t of this.tanks) {
      if (t.state !== 'intact') continue;
      const d = dist2(at, t.pos);
      if (d <= bd) { bd = d; best = t; }
    }
    if (!best) return false;
    this.orderTank(g, best);
    return true;
  }

  /** Every soldier shoots this tank while it is in range and sight (replaces any earlier order). */
  orderTank(g: Game, t: FuelTank) {
    if (t.state !== 'intact') return false;
    if (this.order) this.clearOrder(g);
    this.order = { tank: t, until: g.time + this.num('orderTime') };
    for (const s of g.soldiers) s.order = t.unit;
    this.log.orders++;
    g.fx.texts.push({ pos: { x: t.pos.x, y: t.pos.y - 70 }, text: 'TARGET', life: 0.9, color: '#ffd84a' });
    if (!g.soldiers.some((s) => s.active && s.targeting.isValid(s, t.unit, g))) g.say('FUEL TANK TARGETED — MOVE INTO RANGE AND SIGHT');
    sfx('lock');
    return true;
  }

  clearOrder(g: Game) {
    const u = this.order?.tank.unit ?? null;
    this.order = null;
    for (const s of g.soldiers) {
      if (s.order && (s.order === u || !u)) s.order = null;
      if (u && s.target === u) s.target = null;
    }
  }

  /** Ground level: the blast ring of a tank someone is standing near / that is ordered or burning, and the wrecks. */
  draw(ctx: CanvasRenderingContext2D, _m: Mission, g: Game) {
    const R = this.num('blastRadius'), t0 = g.clock;
    for (const t of this.tanks) {
      const { x, y } = t.pos;
      if (Math.abs(x - g.cam.x) > 760 || Math.abs(y - g.cam.y) > 480) continue;
      if (t.state === 'exploded') {
        // a burnt-out shell
        ctx.fillStyle = 'rgba(20,16,12,0.55)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 24, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2c2824'; ctx.fillRect(x - 15, y - 14, 30, 16);
        ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 15, y - 14); ctx.lineTo(x - 6, y - 22); ctx.lineTo(x + 3, y - 14); ctx.stroke();
        continue;
      }
      const near = g.soldiers.some((s) => s.active && dist2(s.pos, t.pos) < (R + 60) ** 2);
      const hot = t.state === 'burning' || this.order?.tank === t;
      if (!near && !hot) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t0 * 6 + t.id);
      ctx.fillStyle = hot ? 'rgba(255,90,30,0.12)' : 'rgba(255,120,40,0.06)';
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash([10, 8]); ctx.strokeStyle = `rgba(255,120,40,${(hot ? 0.6 : 0.3) + 0.2 * pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (this.order?.tank === t) {
        const a = t0 * 2; ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2.5;
        for (let k = 0; k < 4; k++) { const b = a + (k * Math.PI) / 2; ctx.beginPath(); ctx.arc(x, y - 14, 30, b, b + 0.9); ctx.stroke(); }
      }
    }
  }
}

/** A fuel tank (render.ts drawStructure, depth-sorted): a squat red cylinder with a hazard band and a valve. */
export function drawFuelTank(ctx: CanvasRenderingContext2D, u: Unit, game: Game) {
  const { x, y } = u.pos, flash = u.hitFlash > 0, f = Math.max(0, u.hp / u.maxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 4, 24, 11, 0, 0, Math.PI * 2); ctx.fill();
  const body = flash ? '#ffffff' : '#a8342a', side = flash ? '#eeeeee' : '#7c231c', top = flash ? '#ffffff' : '#c4493c';
  ctx.fillStyle = side; ctx.fillRect(x - 18, y - 30, 36, 32);
  ctx.fillStyle = body; ctx.fillRect(x - 18, y - 30, 24, 32);
  ctx.fillStyle = top; ctx.beginPath(); ctx.ellipse(x, y - 30, 18, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a110d'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(x, y - 30, 18, 8, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(x - 18, y - 30, 36, 32);
  // hazard band
  ctx.fillStyle = '#ffd23a'; ctx.fillRect(x - 18, y - 16, 36, 6);
  ctx.fillStyle = '#2a1a0a'; for (let k = -16; k < 18; k += 8) ctx.fillRect(x + k, y - 16, 4, 6);
  // valve and a flame symbol
  ctx.fillStyle = '#555'; ctx.fillRect(x - 3, y - 41, 6, 6);
  ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.moveTo(x + 8, y - 2); ctx.lineTo(x + 12, y - 9); ctx.lineTo(x + 16, y - 2); ctx.closePath(); ctx.fill();
  // a damaged tank leaks and sparks
  if (f < 0.999) {
    const k = Math.sin(game.clock * 14 + x) > 0;
    ctx.fillStyle = k ? '#ffb347' : '#ff6a2e'; ctx.beginPath(); ctx.arc(x - 8, y - 22, 2.5 + (1 - f) * 3, 0, Math.PI * 2); ctx.fill();
  }
}
