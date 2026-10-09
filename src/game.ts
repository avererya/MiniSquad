// Game state + fixed-step update. Rendering lives in render.ts, DOM HUD in hud.ts.
import { CFG } from './config';
import { World } from './world';
import { OBSTACLES, SQUAD_START, MEDKITS, RAPIDFIRE, WORLD_W, WORLD_H } from './map';
import { Unit } from './unit';
import { NearestVisible } from './targeting';
import { Effects, updateProjectiles, updateWeapon, type Projectile } from './combat';
import { updateGrenades, type Grenade } from './abilities';
import { ABILITY_FACTORIES, CLASSES, CLASS_IDS, PRESETS, createIdentity, type SoldierClassId } from './classes';
import { Medkit, RapidFire, updatePickups, type Pickup } from './pickups';
import { updateSquad, squadCentre } from './squad';
import { updateEnemyMovement } from './enemy';
import { Mission } from './mission';
import { Input, type InputHandler } from './input';
import { VIEW_W, VIEW_H } from './view';
import { clamp, dist, rand, type Vec } from './util';
import { sfx, setMuted, isMuted } from './audio';

export type GamePhase = 'start' | 'playing' | 'failed' | 'won';

export interface Banner { text: string; color: string; life: number; maxLife: number }
export interface Objective { text: string; sub?: string; progress?: number }

export interface GameUI {
  rebuildPanels(): void;
  showEnd(): void;
  showStart(): void;
  hideOverlay(): void;
  toggleTuning(): void;
  refreshTuning(): void;
}

export class Game implements InputHandler {
  world = new World(OBSTACLES);
  soldiers: Unit[] = [];
  enemies: Unit[] = [];
  projectiles: Projectile[] = [];
  grenades: Grenade[] = [];
  pickups: Pickup[] = [];
  scorches: { x: number; y: number; r: number }[] = [];
  fx = new Effects();
  anchor: Vec = { ...SQUAD_START };
  spread = 1;
  squadMoving = false;
  cam: Vec = { ...SQUAD_START };
  mission = new Mission();
  phase: GamePhase = 'start';
  time = 0; // mission time
  clock = 0; // real animation clock
  paused = false;
  targeting: Unit | null = null;
  invuln = false;
  hurtFlash = 0;
  banners: Banner[] = [];
  objective: Objective = { text: '' };
  /** Class mix used by reset(); set by the preset picker. Defaults to 2 Infantry. */
  composition: SoldierClassId[] = [...PRESETS[0].classes];
  /** Short feedback line (e.g. why an ability can't be used). */
  notice: { text: string; life: number } | null = null;
  input: Input;
  ui!: GameUI;
  private flowTimer = 0;

  constructor(stage: HTMLElement, canvas: HTMLCanvasElement) {
    this.input = new Input(stage, canvas, this);
  }

  // ---------------- lifecycle ----------------
  /** Restart the mission. A number = that many Infantry (v0.1 API); an array = class mix. */
  reset(squad: number | SoldierClassId[] = this.composition) {
    const classes: SoldierClassId[] = typeof squad === 'number'
      ? Array.from({ length: clamp(squad, 1, CFG.squad.maxSize) }, () => 'infantry' as const)
      : squad.slice(0, CFG.squad.maxSize);
    if (!classes.length) classes.push('infantry');
    this.composition = [...classes];
    this.soldiers = []; this.enemies = []; this.projectiles = []; this.grenades = [];
    this.scorches = []; this.fx = new Effects(); this.banners = [];
    this.anchor = { ...SQUAD_START }; this.cam = { ...SQUAD_START }; this.spread = 1;
    this.mission = new Mission();
    this.time = 0; this.targeting = null; this.paused = false;
    this.pickups = [
      ...MEDKITS.map((p) => ({ type: Medkit, pos: { ...p }, bob: Math.random() * 6 })),
      ...RAPIDFIRE.map((p) => ({ type: RapidFire, pos: { ...p }, bob: 0 })),
    ];
    this.notice = null;
    for (const c of classes) this.spawnSoldier(c);
    this.mission.start(this);
    this.world.computeFlow(this.soldiers.map((s) => s.pos));
    this.phase = 'playing';
    this.ui.hideOverlay();
    this.ui.rebuildPanels();
  }

  win() { this.phase = 'won'; this.targeting = null; this.ui.showEnd(); }
  fail() { this.phase = 'failed'; this.targeting = null; this.ui.showEnd(); }

  // ---------------- spawning ----------------
  /** Add a soldier of the given class (debug spawn without a class cycles through the classes). */
  spawnSoldier(classId?: SoldierClassId): Unit | null {
    if (this.soldiers.length >= CFG.squad.maxSize) return null;
    const i = this.soldiers.length;
    const r = CFG.squad.roster[i % CFG.squad.roster.length];
    const cls = classId ?? CLASS_IDS[i % CLASS_IDS.length];
    const base = this.phase === 'playing' && this.soldiers.length ? this.anchor : SQUAD_START;
    const pos = this.findOpenNear({ x: base.x + r.offset[0] * 34, y: base.y + r.offset[1] * 34 }, 40);
    const s = new Unit('squad', pos, NearestVisible, createIdentity(r.name, cls));
    s.speedMul = r.speedMul; s.slot = r.offset;
    s.ability = ABILITY_FACTORIES[CLASSES[cls].abilityId]();
    this.soldiers.push(s);
    this.ui?.rebuildPanels();
    return s;
  }

  spawnEnemy(pos: Vec): Unit {
    const E = CFG.enemy;
    const e = new Unit('enemy', pos, NearestVisible);
    e.advancer = Math.random() < E.advanceChance;
    e.speedRand = 1 + rand(-E.speedVariance, E.speedVariance);
    e.reactionTime = rand(E.reactionMin, E.reactionMax);
    e.aim = Math.PI;
    this.enemies.push(e);
    return e;
  }

  findOpenNear(p: Vec, radius: number): Vec {
    for (let i = 0; i < 40; i++) {
      const q = { x: p.x + rand(-radius, radius), y: p.y + rand(-radius, radius) };
      if (q.x > 20 && q.y > 20 && q.x < WORLD_W - 20 && q.y < WORLD_H - 20 && this.world.isOpen(q.x, q.y)) return q;
    }
    return this.world.center(this.world.nearestOpen(this.world.idx(p.x, p.y)));
  }

  isOnScreen(p: Vec, margin = 60) {
    return Math.abs(p.x - this.cam.x) < VIEW_W / 2 + margin && Math.abs(p.y - this.cam.y) < VIEW_H / 2 + margin;
  }

  /** Spawn n riflemen at the nearest candidate point that is outside the camera view. */
  spawnGroupOffscreen(candidates: Vec[], n: number, second = false) {
    if (n <= 0) return;
    const c = squadCentre(this.soldiers) ?? this.cam;
    const off = candidates.filter((p) => !this.isOnScreen(p, 80)).sort((a, b) => dist(a, c) - dist(b, c));
    const pt = (second ? off[1] : undefined) ?? off[0] ?? [...candidates].sort((a, b) => dist(b, c) - dist(a, c))[0];
    for (let i = 0; i < n; i++) this.spawnEnemy(this.findOpenNear(pt, 70));
  }

  /** Debug: a group of 4 from a random off-screen direction around the squad. */
  debugSpawnGroup() {
    const c = squadCentre(this.soldiers) ?? this.cam;
    const cands: Vec[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p = { x: c.x + Math.cos(a) * 760, y: c.y + Math.sin(a) * 480 };
      if (p.x > 40 && p.y > 40 && p.x < WORLD_W - 40 && p.y < WORLD_H - 40 && this.world.isOpen(p.x, p.y)) cands.push(p);
    }
    const off = cands.filter((p) => !this.isOnScreen(p, 40));
    const pt = off[Math.floor(Math.random() * off.length)] ?? cands[0];
    if (pt) for (let i = 0; i < 4; i++) this.spawnEnemy(this.findOpenNear(pt, 60));
  }

  debugDownSoldier() {
    const s = this.soldiers.find((x) => x.active);
    if (s) this.downSoldier(s);
  }

  // ---------------- damage / states ----------------
  damage(u: Unit, amount: number) {
    if (!u.active) return;
    u.hitFlash = CFG.feel.hitFlash;
    if (u.team === 'squad') {
      this.hurtFlash = 0.25;
      if (this.invuln) return;
    }
    u.hp -= amount;
    sfx('hit');
    if (u.hp > 0) return;
    if (u.team === 'squad') this.downSoldier(u);
    else {
      u.state = 'dead';
      this.fx.burst(u.pos, 14, '#e0453a', 200, 0.4, 4);
      this.fx.burst(u.pos, 8, '#ffffff', 140, 0.3, 3);
      this.fx.ring(u.pos, 28, 'rgba(255,255,255,0.8)', 0.25, 3);
    }
  }

  downSoldier(s: Unit) {
    if (!s.active) return;
    s.state = 'downed';
    s.hp = 0;
    s.bleed = CFG.revive.bleedOut;
    s.reviveProgress = 0;
    s.reviver = null;
    s.target = null;
    s.vel = { x: 0, y: 0 };
    s.path = null;
    if (this.targeting === s) this.targeting = null;
    this.banner(`${s.name} DOWN!`, '#ff4040', 2.8);
    sfx('down');
  }

  banner(text: string, color: string, dur: number) {
    this.banners = this.banners.filter((b) => b.text !== text);
    this.banners.push({ text, color, life: dur, maxLife: dur });
    if (this.banners.length > 3) this.banners.shift();
  }

  setObjective(text: string, sub?: string, progress?: number) {
    this.objective = { text, sub, progress };
  }

  say(text: string, dur = 1.6) { this.notice = { text, life: dur }; }

  // ---------------- abilities ----------------
  /**
   * The ability button / number key. Ground abilities (Grenade) toggle targeting mode;
   * instant abilities fire immediately. Returns true if something happened.
   */
  useAbility(s: Unit): boolean {
    if (this.phase !== 'playing' || !s.ability) return false;
    const ab = s.ability;
    if (ab.targetingMode === 'ground') return this.beginTargeting(s);
    this.targeting = null;
    const why = ab.blockReason(this, s);
    if (why) { this.say(`${s.name}: ${ab.name.toUpperCase()} — ${why}`); sfx('deny'); return false; }
    ab.execute(this, s, s.pos);
    return true;
  }

  // ---------------- grenade targeting ----------------
  isTargeting() { return this.phase === 'playing' && !!this.targeting; }
  beginTargeting(s: Unit): boolean {
    if (this.phase !== 'playing' || !s.ability) return false;
    if (this.targeting === s) { this.targeting = null; return true; }
    if (s.ability.targetingMode !== 'ground') return this.useAbility(s);
    if (!s.ability.ready(s)) {
      const why = s.ability.blockReason(this, s);
      if (why) { this.say(`${s.name}: ${s.ability.name.toUpperCase()} — ${why}`); sfx('deny'); }
      return false;
    }
    this.targeting = s;
    return true;
  }
  onTargetCancel() { this.targeting = null; }
  onTargetConfirm(screen: Vec) {
    const s = this.targeting;
    if (!s || !s.ability || !s.ability.ready(s)) { this.targeting = null; return; }
    s.ability.execute(this, s, this.screenToWorld(screen));
    this.targeting = null;
  }
  onAnyInput() { /* audio unlock handled in main */ }

  onKey(code: string, e: KeyboardEvent) {
    if (code === 'Backquote') { this.ui.toggleTuning(); return; }
    if (code === 'KeyM') { setMuted(!isMuted()); this.ui.rebuildPanels(); return; }
    if (code === 'Enter' && this.phase !== 'playing') { this.reset(); return; }
    if (this.phase !== 'playing') return;
    if (code === 'Escape') { this.targeting = null; return; }
    if (code === 'KeyP') { this.paused = !this.paused; return; }
    const m = /^Digit([1-6])$/.exec(code);
    if (m) { const s = this.soldiers[+m[1] - 1]; if (s) this.useAbility(s); return; }
    // debug hotkeys
    if (code === 'KeyF') this.spawnSoldier();
    else if (code === 'KeyG') this.debugSpawnGroup();
    else if (code === 'KeyK') this.debugDownSoldier();
    else if (code === 'KeyI') { this.invuln = !this.invuln; this.ui.refreshTuning(); }
    else if (code === 'KeyR' && e.shiftKey) this.reset();
  }

  screenToWorld(p: Vec): Vec { return { x: p.x + this.cam.x - VIEW_W / 2, y: p.y + this.cam.y - VIEW_H / 2 }; }
  worldToScreen(p: Vec): Vec { return { x: p.x - this.cam.x + VIEW_W / 2, y: p.y - this.cam.y + VIEW_H / 2 }; }

  /** Clamped grenade target for the current pointer, in world coords. */
  targetPoint(): Vec | null {
    const s = this.targeting;
    if (!s || !s.ability) return null;
    const w = this.screenToWorld(this.input.pointer);
    const d = dist(s.pos, w), r = s.ability.range();
    return d <= r ? w : { x: s.pos.x + ((w.x - s.pos.x) / d) * r, y: s.pos.y + ((w.y - s.pos.y) / d) * r };
  }

  // ---------------- update ----------------
  update(dt: number) {
    this.clock += dt;
    this.fx.update(dt);
    for (const b of this.banners) b.life -= dt;
    this.banners = this.banners.filter((b) => b.life > 0);
    if (this.notice && (this.notice.life -= dt) <= 0) this.notice = null;
    if (this.phase !== 'playing' || this.paused) return;
    this.time += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);

    // movement intents
    updateSquad(this, this.input.move(), dt);
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      const src = this.soldiers.filter((s) => s.active).map((s) => s.pos);
      if (src.length) this.world.computeFlow(src);
      this.flowTimer = 0.3;
    }
    for (const e of this.enemies) if (e.active) updateEnemyMovement(this, e, dt);

    // integrate + collide
    const movers = [...this.soldiers, ...this.enemies].filter((u) => u.active);
    for (const u of movers) { u.pos.x += u.vel.x * dt; u.pos.y += u.vel.y * dt; }
    for (let i = 0; i < movers.length; i++) {
      for (let j = i + 1; j < movers.length; j++) {
        const a = movers[i], b = movers[j];
        const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
        const min = a.radius + b.radius - 2;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (min - d) / 2;
          a.pos.x -= (dx / d) * push; a.pos.y -= (dy / d) * push;
          b.pos.x += (dx / d) * push; b.pos.y += (dy / d) * push;
        }
      }
    }
    for (const u of movers) {
      this.world.resolveCircle(u.pos, u.radius);
      const sp = Math.hypot(u.vel.x, u.vel.y);
      const frac = clamp(sp / Math.max(1, u.maxSpeed), 0, 1);
      u.moveFrac += (frac - u.moveFrac) * (1 - Math.exp(-10 * dt));
      if (u.moveFrac < 0.02) u.moveFrac = 0;
      u.walkPhase += sp * dt * 0.09;
    }

    // weapons
    for (const s of this.soldiers) if (s.active) updateWeapon(s, this, dt, this.enemies);
    for (const e of this.enemies) if (e.active) updateWeapon(e, this, dt, this.soldiers);
    updateProjectiles(this, dt);
    updateGrenades(this, dt);
    updatePickups(this, dt);

    for (const u of [...this.soldiers, ...this.enemies]) {
      u.hitFlash = Math.max(0, u.hitFlash - dt);
      u.rapidFire = Math.max(0, u.rapidFire - dt);
      u.healFlash = Math.max(0, u.healFlash - dt);
      if (u.ability) {
        u.ability.cooldownLeft = Math.max(0, u.ability.cooldownLeft - dt);
        u.ability.tick(this, u, dt);
      }
    }
    this.enemies = this.enemies.filter((e) => e.state !== 'dead');

    this.updateDowned(dt);
    if (this.phase !== 'playing') return;
    this.mission.update(this, dt);
    if (this.phase !== 'playing') return;
    if (this.soldiers.length && this.soldiers.every((s) => !s.active)) { this.fail(); return; }

    // camera: squad centre with light smoothing
    const c = squadCentre(this.soldiers);
    if (c) {
      const k = 1 - Math.exp(-CFG.feel.cameraSmoothing * dt);
      this.cam.x += (c.x - this.cam.x) * k;
      this.cam.y += (c.y - this.cam.y) * k;
    }
    this.cam.x = clamp(this.cam.x, VIEW_W / 2, WORLD_W - VIEW_W / 2);
    this.cam.y = clamp(this.cam.y, VIEW_H / 2, WORLD_H - VIEW_H / 2);
  }

  /**
   * Revive: progress is a FRACTION (0..1) so it survives a change of reviver. Each
   * second adds 1 / reviveTime of the reviver's class. With several standing soldiers
   * in range the fastest one counts (revivers don't stack, as in v0.1). Leaving the
   * radius pauses (keeps) progress; bleed-out runs only while nobody is reviving.
   */
  private updateDowned(dt: number) {
    const R = CFG.revive;
    for (const s of this.soldiers) {
      if (s.state !== 'downed') continue;
      let best: Unit | null = null;
      for (const o of this.soldiers) {
        if (o === s || !o.active || dist(o.pos, s.pos) > R.radius) continue;
        if (!best || o.soldierStats.reviveTime < best.soldierStats.reviveTime) best = o;
      }
      s.reviver = best;
      s.reviving = !!best;
      if (best) {
        s.reviveProgress += dt / Math.max(0.1, best.soldierStats.reviveTime); // bleed-out paused while reviving
        if (s.reviveProgress >= 1) {
          s.state = 'active';
          s.hp = Math.max(1, s.maxHp * R.hpFrac);
          s.reviveProgress = 0;
          s.reviving = false;
          s.reviver = null;
          this.banner(`${s.name} REVIVED`, '#7dff8a', 2);
          this.fx.ring(s.pos, 40, 'rgba(120,255,140,0.9)', 0.5, 4);
        }
      } else {
        s.bleed -= dt; // progress is kept, not reset
        if (s.bleed <= 0) {
          s.state = 'kia';
          s.bleed = 0;
          this.banner(`${s.name} KIA`, '#ff4040', 3);
        }
      }
    }
  }
}
