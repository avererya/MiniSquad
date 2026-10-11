// v0.7C TACTICAL SUPPORT: two once-per-mission abilities unlocked by the Elites DEPLOYED in the
// mission (counted once, when the mission starts; Elites in the Barracks never count, and a soldier
// downed or killed later doesn't take an ability away; nothing unlocks mid-mission).
//
//  - TACTICAL AIRSTRIKE (3+ deployed Elites, free): AIRSTRIKE -> tap / click the battlefield (drag
//    to adjust; the circle is the real blast radius in world px) -> CONFIRM -> INCOMING for
//    CFG.airstrike.delay s -> impact. CANCEL before CONFIRM costs nothing; CONFIRM uses it up.
//  - NUCLEAR STRIKE (6 deployed Elites, one item of stock from the Support Shop): NUKE -> confirmation
//    -> LAUNCH deducts one Nuclear Strike and SAVES at once -> CFG.nuke.countdown s of simulation
//    time (combat goes on; pause pauses it) -> every enemy on the map is hit. A launch can't be
//    cancelled or refunded; it stays spent if the mission ends before the detonation.
//
// Both may be used in the same mission. Damage goes through Game.damage with `support` set: explicit
// numbers per target class (CFG.airstrike / CFG.nuke), never a soldier's weapon, training, trait or
// Elite modifiers, no kill credit. Friendly units are never in the victim list. Game.damage applies
// the floors: a boss keeps CFG.support.bossFloor of its max HP and a mission objective keeps
// CFG.support.objectiveFloor HP (Unit.protectedObjective), so the squad must finish both itself.
// No randomness in the rules (effects use the shared effect helpers only when a strike lands).
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import { clamp, dist, type Vec } from './util';
import { sfx } from './audio';
import type { AccountData, SupportInventory } from './progression';
import type { PersistFn } from './economy';

export const AIRSTRIKE_ELITES = 3;
export const NUKE_ELITES = 6;
export const NUKE_COST = 3000;

/** Support Shop catalog (v0.7C sells exactly one item; a new product is one more entry + its stock field). */
export interface SupportItem { id: 'nuke'; name: string; short: string; cost: number; desc: string; requirement: string; stock: (s: SupportInventory) => number }
export const SUPPORT_ITEMS: SupportItem[] = [
  {
    id: 'nuke', name: 'Nuclear Strike', short: 'NUKE', cost: NUKE_COST,
    desc: `Battlefield-wide strike, ${CFG.nuke.countdown} s after launch. Wipes out most enemies on the map, badly damages armor and vehicles, weakens bosses (never below ${Math.round(CFG.support.bossFloor * 100)}% HP). Never hurts your squad or allies and never destroys mission objectives. One per mission.`,
    requirement: `Requires ${NUKE_ELITES} deployed Elite soldiers (a full six-soldier squad, from Mission 13).`,
    stock: (s) => s.nukes,
  },
];
export const supportItem = (id: string) => SUPPORT_ITEMS.find((i) => i.id === id) ?? null;

export type AirstrikeState = 'locked' | 'ready' | 'targeting' | 'incoming' | 'used';
export type NukeState = 'locked' | 'ready' | 'confirm' | 'countdown' | 'used';

/** Per-mission support state (new on every mission start / retry). */
export class Support {
  /** Elite soldiers deployed when the mission started. */
  readonly elites: number;
  readonly airEligible: boolean;
  readonly nukeEligible: boolean;
  air: AirstrikeState;
  nuke: NukeState;
  /** Airstrike target while aiming (world px; null until the first tap). */
  aim: Vec | null = null;
  /** Locked airstrike: impact point and seconds until impact. */
  strike: { pos: Vec; t: number } | null = null;
  /** Seconds until the nuke detonates (while 'countdown'). */
  nukeLeft = 0;
  /** Visuals (real seconds since the event; -1 = not happened). */
  airFx = -1;
  airFxAt: Vec | null = null;
  nukeFx = -1;
  /** Event log for tools (simulation time). */
  log: { t: number; what: string; n?: number }[] = [];
  private lastBeep = Infinity;

  constructor(elites: number) {
    this.elites = elites;
    this.airEligible = elites >= AIRSTRIKE_ELITES;
    this.nukeEligible = elites >= NUKE_ELITES;
    this.air = this.airEligible ? 'ready' : 'locked';
    this.nuke = this.nukeEligible ? 'ready' : 'locked';
  }

  get aiming() { return this.air === 'targeting'; }

  // ---------------- airstrike ----------------
  /** AIRSTRIKE button / Q: start aiming (or stop aiming if already). */
  beginAirstrike(g: Game): boolean {
    if (g.phase !== 'playing' || g.paused) return false;
    if (this.air === 'targeting') { this.cancelAirstrike(); return true; }
    const why = this.air === 'locked' ? `needs ${AIRSTRIKE_ELITES} deployed Elites` : this.air === 'incoming' ? 'INCOMING' : this.air === 'used' ? 'USED THIS MISSION' : null;
    if (why) { g.say(`AIRSTRIKE — ${why}`); sfx('deny'); return false; }
    g.targeting = null; // a grenade being aimed is put down
    if (this.nuke === 'confirm') this.nuke = 'ready';
    this.air = 'targeting'; this.aim = null;
    return true;
  }
  /** A tap / click / drag on the battlefield while aiming (screen px). */
  aimAirstrike(g: Game, screen: Vec) {
    if (this.air !== 'targeting') return;
    const w = g.screenToWorld(screen);
    this.aim = { x: clamp(w.x, 0, g.map.w), y: clamp(w.y, 0, g.map.h) };
  }
  cancelAirstrike() { if (this.air === 'targeting') { this.air = 'ready'; this.aim = null; } }
  /** CONFIRM / Enter: lock the target; the airstrike is used from here on. */
  confirmAirstrike(g: Game): boolean {
    if (this.air !== 'targeting' || !this.aim || g.phase !== 'playing' || g.paused) return false;
    this.strike = { pos: { ...this.aim }, t: CFG.airstrike.delay };
    this.air = 'incoming'; this.aim = null;
    this.log.push({ t: g.time, what: 'airstrike-confirm' });
    g.banner('AIRSTRIKE INCOMING', '#ffb347', 2);
    sfx('jet');
    return true;
  }

  // ---------------- nuke ----------------
  /** NUKE button / N: open the launch confirmation (nothing is spent yet). */
  openNuke(g: Game, stock: number): boolean {
    if (g.phase !== 'playing' || g.paused) return false;
    if (this.nuke === 'confirm') { this.nuke = 'ready'; return true; }
    const why = this.nuke === 'locked' ? `needs ${NUKE_ELITES} deployed Elites` : this.nuke === 'countdown' ? 'ALREADY LAUNCHED' : this.nuke === 'used' ? 'USED THIS MISSION' : stock < 1 ? '0 STOCK (Barracks › Support)' : null;
    if (why) { g.say(`NUKE — ${why}`); sfx('deny'); return false; }
    this.cancelAirstrike();
    this.nuke = 'confirm';
    return true;
  }
  cancelNuke() { if (this.nuke === 'confirm') this.nuke = 'ready'; }
  /**
   * LAUNCH (from the confirmation only): one Nuclear Strike is deducted and saved first; a failed
   * save write cancels the launch (stock untouched). Then the countdown starts.
   */
  launchNuke(g: Game, account: AccountData, persist: PersistFn | null): { ok: true; saved: boolean } | { ok: false; reason: string } {
    if (this.nuke !== 'confirm' || g.phase !== 'playing' || g.paused) return { ok: false, reason: 'Not ready' };
    const r = spendNuke(account, persist);
    if (!r.ok) { this.nuke = 'ready'; g.say(`NUKE — ${r.reason}`); sfx('deny'); return r; }
    this.nuke = 'countdown'; this.nukeLeft = CFG.nuke.countdown; this.lastBeep = Infinity;
    this.log.push({ t: g.time, what: 'nuke-launch' });
    g.banner(`NUCLEAR STRIKE LAUNCHED — ${Math.ceil(this.nukeLeft)}s`, '#ff5a3a', 3);
    sfx('siren');
    return r;
  }

  // ---------------- simulation (fixed step, inside Game.update: nothing runs while paused) ----------------
  update(g: Game, dt: number) {
    if (this.strike) {
      this.strike.t -= dt;
      if (this.strike.t <= 1e-6) {
        const pos = this.strike.pos;
        this.strike = null; this.air = 'used';
        airstrikeImpact(g, pos, this);
      }
    }
    if (this.nuke === 'countdown') {
      this.nukeLeft -= dt;
      const s = Math.ceil(this.nukeLeft);
      if (s <= CFG.nuke.warnAt && s < this.lastBeep && s > 0) { this.lastBeep = s; sfx(s <= CFG.nuke.finalAt ? 'siren' : 'beep'); if (s === CFG.nuke.warnAt) g.banner(`NUCLEAR STRIKE IN ${s}`, '#ff5a3a', 2); }
      if (this.nukeLeft <= 1e-6) { this.nukeLeft = 0; this.nuke = 'used'; nukeDetonate(g, this); }
    }
  }
  /** Real-time visual timers (also while paused / after the mission ends). */
  tickFx(dt: number) {
    if (this.airFx >= 0) { this.airFx += dt; if (this.airFx > 1.2) this.airFx = -1; }
    if (this.nukeFx >= 0) { this.nukeFx += dt; if (this.nukeFx > 3.5) this.nukeFx = -1; }
  }
}

/** Launch transaction: deduct one Nuclear Strike and save at once (rolled back if the write fails). */
export function spendNuke(account: AccountData, persist: PersistFn | null): { ok: true; saved: boolean } | { ok: false; reason: string } {
  const s = account.support;
  if (s.nukes < 1) return { ok: false, reason: '0 STOCK' };
  s.nukes--; s.launched++;
  const w = persist ? persist() : 'ok';
  if (w === 'error') { s.nukes++; s.launched--; return { ok: false, reason: 'Could not save: launch cancelled' }; }
  return { ok: true, saved: w === 'ok' };
}

// ---------------- damage ----------------
type Kind = 'airstrike' | 'nuke';

/** Support damage to one enemy before the floors (`k` = falloff factor 0..1, nuke always 1). */
export function supportDamageFor(kind: Kind, u: Unit, k = 1): number {
  const S = kind === 'airstrike' ? CFG.airstrike : CFG.nuke;
  if (u.kind === 'boss') return u.maxHp * S.bossFrac * k;
  const base = S.damage * k;
  if (u.protectedObjective) return base * S.objectiveMul;
  if (u.vehicle) return base * S.vehicleMul;
  if (u.kind === 'armored') return base * S.armoredMul;
  return base;
}

/** Most support damage `u` can take right now (Game.damage): bosses and objectives keep their floor. */
export function supportRoom(u: Unit): number {
  if (u.team !== 'enemy') return 0;
  if (u.kind === 'boss') return Math.max(0, u.hp - u.maxHp * CFG.support.bossFloor);
  if (u.protectedObjective) return Math.max(0, u.hp - CFG.support.objectiveFloor);
  return Infinity;
}

/** Hit one enemy and show the HP actually removed (damage numbers on screen only). */
function hit(g: Game, u: Unit, kind: Kind, k: number): number {
  const before = Math.max(0, u.hp);
  g.damage(u, supportDamageFor(kind, u, k), undefined, { support: kind });
  const removed = Math.max(0, before - Math.max(0, u.hp));
  if (removed >= 1 && g.isOnScreen(u.pos, 20)) g.fx.text(u.pos, `-${Math.round(removed)}`, kind === 'nuke' ? '#ffe08a' : '#ffb347');
  return removed;
}

/**
 * Airstrike impact: every active enemy whose centre is inside the radius (the same world-px circle the
 * player saw), linear falloff to edgeFrac at the rim. One damage pass; the extra blasts are visual only.
 */
export function airstrikeImpact(g: Game, pos: Vec, sup: Support): { hit: number; removed: number } {
  const A = CFG.airstrike;
  let n = 0, total = 0;
  for (const u of [...g.enemies]) {
    if (!u.active) continue;
    const d = dist(pos, u.pos);
    if (d > A.radius) continue;
    const f = d / A.radius;
    total += hit(g, u, 'airstrike', 1 - f * (1 - A.edgeFrac));
    n++;
  }
  sup.log.push({ t: g.time, what: 'airstrike-impact', n });
  // a short run of blasts across the circle (cheap: a few rings + two bursts each)
  for (const [dx, dy, r] of [[0, 0, 1], [-0.45, -0.2, 0.55], [0.45, 0.25, 0.55], [0.1, -0.5, 0.45]] as const) {
    const p = { x: pos.x + dx * A.radius, y: pos.y + dy * A.radius };
    g.fx.ring(p, A.radius * r, 'rgba(255,220,120,0.95)', 0.4, 6);
    g.fx.burst(p, r === 1 ? 26 : 10, '#ffb347', 420 * r, 0.5, 6);
  }
  g.fx.burst(pos, 14, '#5e5e5e', 180, 1.1, 9);
  g.fx.ring(pos, A.radius, 'rgba(255,255,255,0.9)', 0.25, 4);
  g.scorches.push({ ...pos, r: A.radius * 0.6 });
  g.fx.shake = Math.max(g.fx.shake, A.shake);
  sup.airFx = 0; sup.airFxAt = { ...pos };
  sfx('strike'); sfx('boom');
  return { hit: n, removed: total };
}

/** Nuclear detonation: every active enemy on the map (on screen or not), one pass. */
export function nukeDetonate(g: Game, sup: Support): { hit: number; removed: number } {
  let n = 0, total = 0;
  for (const u of [...g.enemies]) {
    if (!u.active) continue;
    total += hit(g, u, 'nuke', 1);
    n++;
  }
  sup.log.push({ t: g.time, what: 'nuke-detonate', n });
  const c = { x: g.cam.x, y: g.cam.y + 40 };
  g.fx.ring(c, 520, 'rgba(255,240,200,0.9)', 0.9, 10);
  g.fx.burst(c, 40, '#ffb347', 700, 0.9, 8);
  g.fx.burst(c, 20, '#6b6b6b', 260, 1.6, 12);
  g.fx.shake = Math.max(g.fx.shake, CFG.nuke.shake);
  sup.nukeFx = 0;
  sfx('nuke');
  return { hit: n, removed: total };
}
