// Game state + fixed-step update. Rendering lives in render.ts, DOM HUD in hud.ts.
import { CFG } from './config';
import { World } from './world';
import type { MapDef } from './map';
import { Unit } from './unit';
import { NearestVisible } from './targeting';
import { Effects, updateProjectiles, updateWeapon, type Projectile } from './combat';
import { updateGrenades, type Grenade } from './abilities';
import { ABILITY_FACTORIES, CLASSES, CLASS_IDS, PRESETS, cloneIdentity, createGeneric, type SoldierClassId, type SoldierIdentity } from './classes';
import { MissionStats } from './missionstats';
import { Roster } from './roster';
import { Medkit, RapidFire, updatePickups, type Pickup } from './pickups';
import { updateSquad, updateEscort, squadCentre } from './squad';
import { updateEnemyMovement } from './enemy';
import { Mission } from './mission';
import { scriptFor } from './missions';
import type { MissionEvent } from './objectives';
import { FIRST_MISSION, campaignMission, capacityOf, computeStars, type StarResult } from './campaign';
import { Input, type InputHandler } from './input';
import { VIEW_W, VIEW_H } from './view';
import { clamp, dist, rand, type Vec } from './util';
import { sfx, setMuted, isMuted } from './audio';
import { getAccount, type MissionReward } from './progression';
import { newRunId, settleMission, type PersistFn } from './economy';

export type GamePhase = 'start' | 'playing' | 'failed' | 'won';

export interface Banner { text: string; color: string; life: number; maxLife: number }
export interface Objective { text: string; sub?: string; progress?: number }

/**
 * What a mission was started with, so Retry can repeat it exactly.
 *  - 'roster': saved Barracks soldiers (copies of their identities)
 *  - 'temp':   roster soldiers deployed by a dev shortcut (?squad=ace,doc); selection not saved
 *  - 'generic': anonymous class-only soldiers (dev presets, tools); never saved
 */
export interface Deployment { kind: 'roster' | 'temp' | 'generic'; identities: SoldierIdentity[]; classes: SoldierClassId[] }

export interface GameUI {
  rebuildPanels(): void;
  /** Mission ended (won/failed): show the Results screen. */
  showEnd(): void;
  /** Show the Barracks (squad selection for the selected mission). */
  showStart(notice?: string): void;
  /** Show the Campaign screen (launch, Results -> Campaign). */
  showCampaign(notice?: string): void;
  /** The roster object was replaced (dev save reset / unlock all). */
  rosterChanged(notice?: string): void;
  hideOverlay(): void;
  toggleTuning(): void;
  refreshTuning(): void;
}

export type DeployResult = { ok: true } | { ok: false; reason: string };

export class Game implements InputHandler {
  private static worlds = new Map<string, World>();
  /** Nav grid / collision for a map (built once per map). */
  static worldFor(map: MapDef): World {
    let w = Game.worlds.get(map.id);
    if (!w) { w = new World(map.obstacles, map.w, map.h); Game.worlds.set(map.id, w); }
    return w;
  }
  /** Campaign mission the next deployment plays (Campaign screen selection; saved). */
  missionId = FIRST_MISSION;
  mission = new Mission(scriptFor(FIRST_MISSION)!);
  world = Game.worldFor(this.mission.map);
  soldiers: Unit[] = [];
  /** Escort NPCs (Mission 5 captive). Team 'squad' but not soldiers: no panel, no rewards. */
  npcs: Unit[] = [];
  enemies: Unit[] = [];
  projectiles: Projectile[] = [];
  grenades: Grenade[] = [];
  pickups: Pickup[] = [];
  scorches: { x: number; y: number; r: number }[] = [];
  fx = new Effects();
  anchor: Vec = { ...this.mission.map.start };
  spread = 1;
  squadMoving = false;
  cam: Vec = { ...this.mission.map.start };
  phase: GamePhase = 'start';
  time = 0; // mission time
  clock = 0; // real animation clock
  paused = false;
  targeting: Unit | null = null;
  invuln = false;
  hurtFlash = 0;
  banners: Banner[] = [];
  objective: Objective = { text: '' };
  /** The persistent roster + squad selection (Barracks). Replaced by a dev save reset. */
  roster = new Roster();
  /** Last deployment; reset() with no argument (Retry) repeats it. Defaults to 2 generic Infantry. */
  deployment: Deployment = Game.generic(PRESETS[0].classes);
  /** Dev hook (set by main.ts): wipe the save back to the default roster. */
  resetRosterSave: (() => void) | null = null;
  /** Dev hook (set by main.ts): unlock every mission + soldier and SAVE it (two-tap in the tuning panel). */
  debugUnlockAll: (() => void) | null = null;
  /** Per-soldier mission statistics (Results screen). */
  stats = new MissionStats();
  /** Id of the current mission run (new on every deploy / retry). Rewards are settled once per id. */
  runId = '';
  /** Rewards of the mission that just ended (null: defeat, dev deployment, or nothing yet). */
  lastReward: MissionReward | null = null;
  /** Stars of the mission that just ended (also for dev deployments, which are never saved). */
  lastStars: StarResult | null = null;
  /** Save hook (set by main.ts): writes roster + account. */
  persist: PersistFn | null = null;
  /** Times the escort safety net had to move a stuck captive (should stay 0; reported by tools). */
  escortRescues = 0;
  /** Short feedback line (e.g. why an ability can't be used). */
  notice: { text: string; life: number } | null = null;
  input: Input;
  ui!: GameUI;
  private flowTimer = 0;

  constructor(stage: HTMLElement, canvas: HTMLCanvasElement) {
    this.input = new Input(stage, canvas, this);
  }

  /** Class mix of the current deployment (tuning panel preset display, tests). */
  get composition(): SoldierClassId[] { return this.deployment.classes; }
  get map(): MapDef { return this.mission.map; }
  /** Max soldiers the selected mission allows. */
  get capacity() { return capacityOf(this.missionId); }

  /**
   * Choose the mission for the next deployment (Campaign screen). Only unlocked, playable
   * missions unless `force` (dev tools / tests). Persists the selection via onMissionSelected.
   */
  selectMission(id: string, force = false): boolean {
    const def = campaignMission(id), script = scriptFor(id);
    if (!def || !script || !def.playable) return false;
    if (!force && !getAccount().campaign.unlockedMissions.includes(id)) return false;
    this.missionId = id;
    if (getAccount().campaign.selectedMission !== id) { getAccount().campaign.selectedMission = id; this.persist?.(); }
    if (this.phase === 'start') { this.mission = new Mission(script); this.world = Game.worldFor(script.map); }
    return true;
  }

  static generic(classes: SoldierClassId[]): Deployment {
    return { kind: 'generic', identities: [], classes: [...classes] };
  }

  // ---------------- lifecycle ----------------
  /** Why the Barracks selection can't deploy into the selected mission (null = it can). */
  deployBlock(): string | null {
    const def = campaignMission(this.missionId);
    if (!def || !scriptFor(this.missionId)) return 'No mission selected';
    if (!getAccount().campaign.unlockedMissions.includes(this.missionId)) return `Mission ${def.number} is locked`;
    return this.roster.deployBlock(this.capacity);
  }

  /** Deploy the Barracks selection (exactly those soldiers, in slot order) into the selected mission. */
  deploySelected(): DeployResult {
    const why = this.deployBlock();
    if (why) return { ok: false, reason: why };
    return this.deploy(this.roster.squad(), 'roster');
  }

  /**
   * Start the selected mission with these roster identities (copied, so the mission never
   * touches the roster). Roster deployments must respect the mission's capacity and use
   * unlocked soldiers only; 'temp' (dev ?squad=) deployments may use up to 6 of anyone.
   */
  deploy(identities: SoldierIdentity[], kind: 'roster' | 'temp' = 'roster'): DeployResult {
    if (!identities.length) return { ok: false, reason: 'Select at least one soldier to deploy.' };
    if (kind === 'roster') {
      if (identities.length > this.capacity) return { ok: false, reason: `This mission allows ${this.capacity} soldiers` };
      const locked = identities.find((i) => !this.roster.isUnlocked(i.id));
      if (locked) return { ok: false, reason: `${locked.name} is not unlocked yet` };
      if (new Set(identities.map((i) => i.id)).size !== identities.length) return { ok: false, reason: 'A soldier can only deploy once' };
    }
    const ids = identities.slice(0, CFG.squad.maxSize).map(cloneIdentity);
    this.deployment = { kind, identities: ids, classes: ids.map((i) => i.classId) };
    this.startMission();
    return { ok: true };
  }

  /**
   * Restart the mission. No argument = Retry the last deployment (same soldiers, fresh state).
   * A number = that many generic Infantry (v0.1 API); an array = generic class mix (dev presets).
   */
  reset(squad?: number | SoldierClassId[]) {
    if (squad !== undefined) {
      const classes: SoldierClassId[] = typeof squad === 'number'
        ? Array.from({ length: clamp(squad, 1, CFG.squad.maxSize) }, () => 'infantry' as const)
        : squad.slice(0, CFG.squad.maxSize);
      if (!classes.length) classes.push('infantry');
      this.deployment = Game.generic(classes);
    }
    this.startMission();
  }

  /** Leave the mission screen and go back to the Barracks. Mission state is dropped; KIA is not permanent. */
  toBarracks() { this.leaveMission(); this.ui.showStart(); }
  /** Leave the mission screen for the Campaign screen. */
  toCampaign() { this.leaveMission(); this.ui.showCampaign(); }
  private leaveMission() {
    this.phase = 'start';
    this.paused = false; this.targeting = null;
    this.soldiers = []; this.npcs = []; this.enemies = []; this.projectiles = []; this.grenades = [];
    this.ui.rebuildPanels();
  }

  /** Dev: swap in a new roster (save reset). Never called by gameplay. */
  replaceRoster(r: Roster, notice?: string) { this.roster = r; this.ui.rosterChanged(notice); }

  private startMission() {
    const dep = this.deployment;
    const script = scriptFor(this.missionId)!;
    this.mission = new Mission(script);
    this.world = Game.worldFor(script.map);
    this.phase = 'start';
    this.stats = new MissionStats();
    this.runId = newRunId();
    this.lastReward = null; this.lastStars = null; this.escortRescues = 0;
    this.soldiers = []; this.npcs = []; this.enemies = []; this.projectiles = []; this.grenades = [];
    this.scorches = []; this.fx = new Effects(); this.banners = [];
    const start = script.map.start;
    this.anchor = { ...start }; this.cam = { ...start }; this.spread = 1;
    this.time = 0; this.targeting = null; this.paused = false;
    this.pickups = [
      ...script.map.medkits.map((p) => ({ type: Medkit, pos: { ...p }, bob: Math.random() * 6 })),
      ...script.map.rapidFire.map((p) => ({ type: RapidFire, pos: { ...p }, bob: 0 })),
    ];
    this.notice = null;
    if (dep.kind === 'generic') for (const c of dep.classes) this.spawnSoldier(c);
    else for (const id of dep.identities) this.spawnSoldier(id.classId, cloneIdentity(id));
    this.mission.start(this);
    this.world.computeFlow(this.soldiers.map((s) => s.pos));
    this.phase = 'playing';
    this.ui.hideOverlay();
    this.ui.rebuildPanels();
  }

  win() { if (this.phase !== 'playing') return; this.phase = 'won'; this.end(true); }
  fail() { if (this.phase !== 'playing') return; this.phase = 'failed'; this.end(false); }
  private end(won: boolean) {
    this.targeting = null;
    this.mission.finalize(this, won);
    const rows = this.stats.rows(this.soldiers);
    const opt = this.mission.optional;
    this.lastStars = computeStars(this.mission.def.stars, {
      won, optionalTotal: opt.length, optionalCompleted: opt.filter((o) => o.completed).length,
      statuses: rows.map((r) => r.status), downs: rows.map((r) => r.downs),
    });
    this.settle();
    this.ui.showEnd();
  }

  /**
   * Mission over: settle XP + Credits for ROSTER deployments (Barracks Deploy / Retry), once
   * per run id, and save immediately. Dev deployments (presets, ?squad=) never earn rewards.
   */
  private settle() {
    if (this.deployment.kind !== 'roster') { this.lastReward = null; return; }
    // a mission force-started by dev tools while still locked never pays or unlocks anything
    if (!getAccount().campaign.unlockedMissions.includes(this.mission.id)) { this.lastReward = null; return; }
    const won = this.phase === 'won';
    const rows = this.stats.rows(this.soldiers);
    const opt = this.mission.optional;
    const reward = settleMission(this.roster, getAccount(), {
      missionId: this.mission.id, runId: this.runId, won,
      deployed: rows.map((r) => ({ id: r.id, status: r.status, downs: r.downs })),
      optional: { total: opt.length, completed: opt.filter((x) => x.completed).length, list: opt },
      stars: this.lastStars?.stars ?? 0,
    }, Object.fromEntries(rows.map((r) => [r.id, r.kills])));
    if (reward) {
      this.lastReward = reward;
      // the Campaign screen moves on to a newly unlocked mission (Retry still replays this one)
      if (reward.unlockedMissions.length) getAccount().campaign.selectedMission = reward.unlockedMissions[0];
      this.persist?.();
    }
  }

  // ---------------- spawning ----------------
  /**
   * Add a soldier. With an identity: that soldier (roster deploy). Without: an anonymous
   * generic of the given class (debug spawn without a class cycles through the classes).
   * Formation slot, slot speed jitter and generic names come from CFG.squad.roster[slot].
   */
  spawnSoldier(classId?: SoldierClassId, identity?: SoldierIdentity): Unit | null {
    if (this.soldiers.length >= CFG.squad.maxSize) return null;
    const i = this.soldiers.length;
    const r = CFG.squad.roster[i % CFG.squad.roster.length];
    const cls = identity?.classId ?? classId ?? CLASS_IDS[i % CLASS_IDS.length];
    const base = this.phase === 'playing' && this.soldiers.length ? this.anchor : this.map.start;
    const pos = this.findOpenNear({ x: base.x + r.offset[0] * 34, y: base.y + r.offset[1] * 34 }, 40);
    const s = new Unit('squad', pos, NearestVisible, identity ?? createGeneric(r.name, cls));
    s.speedMul = r.speedMul; s.slot = r.offset;
    s.ability = ABILITY_FACTORIES[CLASSES[cls].abilityId]();
    this.soldiers.push(s);
    this.stats.register(s);
    this.ui?.rebuildPanels();
    return s;
  }

  /** Escort NPC (held captive until an objective frees it). */
  spawnNpc(pos: Vec, label: string): Unit {
    const n = new Unit('squad', pos, NearestVisible);
    n.npc = true; n.escorting = false; n.label = label; n.name = label;
    n.setMaxHp(CFG.escort.hp);
    n.aim = Math.PI / 2;
    this.npcs.push(n);
    return n;
  }

  /** What enemy riflemen can shoot at: soldiers and an escorted (freed) captive. */
  enemyVictims(): Unit[] { return this.npcs.length ? [...this.soldiers, ...this.npcs.filter((n) => n.escorting)] : this.soldiers; }

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
      if (q.x > 20 && q.y > 20 && q.x < this.map.w - 20 && q.y < this.map.h - 20 && this.world.isOpen(q.x, q.y)) return q;
    }
    return this.world.center(this.world.nearestOpen(this.world.idx(p.x, p.y)));
  }

  isOnScreen(p: Vec, margin = 60) {
    return Math.abs(p.x - this.cam.x) < VIEW_W / 2 + margin && Math.abs(p.y - this.cam.y) < VIEW_H / 2 + margin;
  }

  /** Spawn n riflemen at the nearest candidate point that is outside the camera view. */
  spawnGroupOffscreen(candidates: Vec[], n: number, second = false): Unit[] {
    if (n <= 0 || !candidates.length) return [];
    const c = squadCentre(this.soldiers) ?? this.cam;
    const off = candidates.filter((p) => !this.isOnScreen(p, 80)).sort((a, b) => dist(a, c) - dist(b, c));
    const pt = (second ? off[1] : undefined) ?? off[0] ?? [...candidates].sort((a, b) => dist(b, c) - dist(a, c))[0];
    const out: Unit[] = [];
    for (let i = 0; i < n; i++) out.push(this.spawnEnemy(this.findOpenNear(pt, 70)));
    return out;
  }

  /** Debug: a group of 4 from a random off-screen direction around the squad. */
  debugSpawnGroup() {
    const c = squadCentre(this.soldiers) ?? this.cam;
    const cands: Vec[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p = { x: c.x + Math.cos(a) * 760, y: c.y + Math.sin(a) * 480 };
      if (p.x > 40 && p.y > 40 && p.x < this.map.w - 40 && p.y < this.map.h - 40 && this.world.isOpen(p.x, p.y)) cands.push(p);
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
  /**
   * Apply damage. `source` (shooter / grenade thrower) gets credit for the HP actually
   * removed (overkill excluded) and for the kill. Inactive targets take nothing, so a
   * bullet and a blast landing on the same frame can't both count.
   */
  damage(u: Unit, amount: number, source?: Unit) {
    if (!u.active) return;
    u.hitFlash = CFG.feel.hitFlash;
    if (u.team === 'squad') {
      this.hurtFlash = 0.25;
      if (this.invuln) return;
    }
    const removed = Math.min(Math.max(0, amount), Math.max(0, u.hp));
    u.hp -= amount;
    if (source) {
      source.dealt += removed;
      if (u.team === 'enemy' && !u.structure) this.stats.damage(source, removed); // structures aren't enemy soldiers
    }
    if (u.npc && removed > 0) this.mission.emit(this, { type: 'npcDamaged', unit: u, amount: removed });
    sfx('hit');
    if (u.hp > 0) return;
    if (u.team === 'squad') this.downSoldier(u);
    else if (u.structure) {
      u.state = 'dead';
      this.mission.emit(this, { type: 'structureDestroyed', unit: u });
    } else {
      this.stats.kill(source);
      u.state = 'dead';
      this.mission.emit(this, { type: 'enemyKilled', unit: u });
      this.fx.burst(u.pos, 14, '#e0453a', 200, 0.4, 4);
      this.fx.burst(u.pos, 8, '#ffffff', 140, 0.3, 3);
      this.fx.ring(u.pos, 28, 'rgba(255,255,255,0.8)', 0.25, 3);
    }
  }

  downSoldier(s: Unit) {
    if (!s.active) return;
    s.state = 'downed';
    if (!s.npc) this.stats.down(s);
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
    this.mission.emit(this, s.npc ? { type: 'npcDowned', unit: s } : { type: 'soldierDowned', unit: s });
  }

  /** Bleed-out ran out (or left behind): KIA for this mission only. */
  private kia(s: Unit) {
    s.state = 'kia';
    s.bleed = 0;
    s.reviving = false; s.reviver = null;
    this.banner(`${s.name} KIA`, '#ff4040', 3);
    const ev: MissionEvent = s.npc ? { type: 'npcKia', unit: s } : { type: 'soldierKia', unit: s };
    this.mission.emit(this, ev);
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
    if (this.phase === 'start') return; // Campaign / Barracks keys are handled by the menu
    if (this.phase === 'won' || this.phase === 'failed') {
      if (code === 'Enter' || code === 'KeyR') this.reset(); // Retry
      else if (code === 'KeyB' || code === 'Escape') this.toBarracks();
      else if (code === 'KeyC') this.toCampaign();
      return;
    }
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
    for (const n of this.npcs) updateEscort(this, n, dt);
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      const src = this.soldiers.filter((s) => s.active).map((s) => s.pos);
      if (src.length) this.world.computeFlow(src);
      this.flowTimer = 0.3;
    }
    for (const e of this.enemies) if (e.active && !e.structure) updateEnemyMovement(this, e, dt);

    // integrate + collide (structures never move; they push others out)
    const movers = [...this.soldiers, ...this.npcs, ...this.enemies].filter((u) => u.active && !u.structure);
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
    for (const st of this.enemies) {
      if (!st.active || !st.structure) continue;
      for (const u of movers) {
        const dx = u.pos.x - st.pos.x, dy = u.pos.y - st.pos.y, min = u.radius + st.radius, d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 1e-6) { const d = Math.sqrt(d2); u.pos.x = st.pos.x + (dx / d) * min; u.pos.y = st.pos.y + (dy / d) * min; }
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
    const victims = this.enemyVictims();
    for (const e of this.enemies) if (e.active && !e.structure) updateWeapon(e, this, dt, victims);
    updateProjectiles(this, dt);
    updateGrenades(this, dt);
    updatePickups(this, dt);

    for (const u of [...this.soldiers, ...this.npcs, ...this.enemies]) {
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
    this.cam.x = clamp(this.cam.x, VIEW_W / 2, this.map.w - VIEW_W / 2);
    this.cam.y = clamp(this.cam.y, VIEW_H / 2, this.map.h - VIEW_H / 2);
  }

  /**
   * RESCUE RULES (v0.4, game-wide). A downed soldier (or escorted captive) bleeds out in
   * CFG.revive.bleedOut (20 s) -> KIA for this mission. A VALID revive pauses the bleed-out:
   * a standing squad soldier inside the revive radius with a clear line to the downed one,
   * i.e. exactly when revive progress is accruing. Progress is a FRACTION (0..1), so it
   * survives a change of reviver: each second adds 1 / reviveTime of the reviver's class (as
   * modified by traits). Several revivers don't stack (the fastest counts). Interrupting
   * keeps the progress and resumes the remaining bleed-out. A finished revive restores
   * CFG.revive.hpFrac (30%) of max HP.
   */
  private updateDowned(dt: number) {
    const R = CFG.revive;
    for (const s of [...this.soldiers, ...this.npcs]) {
      if (s.state !== 'downed') continue;
      let best: Unit | null = null;
      for (const o of this.soldiers) {
        if (o === s || !o.active || dist(o.pos, s.pos) > R.radius || !this.world.clear(o.pos, s.pos)) continue;
        if (!best || o.soldierStats.reviveTime < best.soldierStats.reviveTime) best = o;
      }
      s.reviver = best;
      s.reviving = !!best;
      if (best) {
        s.reviveProgress += dt / Math.max(0.1, best.soldierStats.reviveTime); // bleed-out paused while reviving
        if (s.reviveProgress >= 1) {
          this.stats.revive(best); // whoever completes it gets the revive
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
        if (s.bleed <= 0) this.kia(s);
      }
    }
  }
}
