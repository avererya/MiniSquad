// v0.9E BOOT CAMP: the optional introductory tutorial.
//
// Part one, FIELD TRAINING, is a miniature mission built from existing systems: a MissionScript (map, groups,
// objectives, helicopter extraction) played by a 'training' deployment of fresh copies of the starting soldiers Ace
// and Ranger. A training deployment never settles (no XP, Credits, records, unlocks or stars), never journals a KIA
// and never touches the roster (Game.settle / Game.kia only act on 'roster' deployments); soldiers can't drop below
// 1 HP in it (Game.damage), so nobody is ever downed or killed. Its numbers live here, not in CFG.
//
// Part two, the HEADQUARTERS TOUR, guides the player through the real Campaign / Barracks screens (BootCamp.tour):
// BARRACKS → ROSTER tab, TRAINING tab (where Credits buy upgrades), ◂ CAMPAIGN (mission selection). It only reads which
// screen is open (polled by the coach view, bootcampview.ts); nothing is bought, selected or changed for the player.
//
// Persistence: one optional account field, `bootCamp` (save v9 unchanged). A brand-new save starts 'pending' (the
// offer is shown); starting, skipping, completing or exiting ends it ('done' / 'skipped'). Saves from before v0.9E
// have no field and are never offered Boot Camp; Settings → REPLAY BOOT CAMP works for everyone.
import type { Game } from './game';
import type { Mission, MissionMechanic, MissionScript } from './mission';
import type { CampaignMission } from './campaign';
import { EliminateObjective, Objective, ReachObjective, type HudLine, type ObjPoint } from './objectives';
import { BOOT_CAMP_MAP, BOOT_DRILL, BOOT_EXTRACTION, BOOT_MOVE_ZONE, BOOT_PIT } from './map';
import type { AccountData } from './progression';
import { Roster } from './roster';
import { STARTING_SOLDIERS } from './campaign';
import { cloneIdentity, type SoldierIdentity } from './classes';
import type { Unit } from './unit';


/** Tutorial tuning (kept out of CFG: Boot Camp is not a campaign mission, so CFG comparisons with older builds hold). */
export const BOOT = {
  /** Drill and pit Riflemen keep this share of their normal HP ("weak enemies"). */
  enemyHpMul: 0.6,
  /** Seconds the health / casualty briefing stays up (simulation time, after the pit is clear). */
  briefTime: 9,
  /** Extraction countdown: the helicopter flies in while the squad holds the landing zone. */
  extractionCountdown: 4,
} as const;

/** The pseudo campaign row Mission needs (name, stars); not in CAMPAIGN, so it is never listed, unlocked or recorded. */
export const BOOT_CAMP_DEF: CampaignMission = {
  id: 'boot-camp', number: 0, name: 'Boot Camp', type: 'elimination', playable: false,
  briefing: 'Field Training: movement, automatic fire, abilities, casualties and extraction.',
  primary: ['Move to the marked area', 'Defeat the training targets', 'Use a soldier ability', 'Keep your squad alive', 'Reach the helicopter'],
  optional: [], stars: { two: 'fullExtraction', three: 'noDowns' },
  teaches: 'The basics', unlocks: { missions: [], recruits: [] },
};

/** Fresh copies of the original starting soldiers (Ace, Ranger) as a new campaign has them: the player's roster is never read or changed. */
export function trainingSquad(): SoldierIdentity[] {
  const r = new Roster();
  return STARTING_SOLDIERS.map((id) => cloneIdentity(r.get(id)!));
}

const weaken = (units: Unit[]) => { for (const e of units) e.setMaxHp(Math.round(e.maxHp * BOOT.enemyHpMul)); };
const chargesLeft = (g: Game) => g.soldiers.reduce((a, s) => a + (s.active && s.ability ? s.ability.charges : 0), 0);

/** Step 3: use any soldier ability once (a charge spent by activateAbility); the pit group arrives as it starts. */
export class AbilityDrillObjective extends Objective {
  private base = -1;
  constructor() { super('bc-ability', 'Use a soldier ability'); this.phase = 'ability'; }
  protected onStart(m: Mission, g: Game) {
    weaken(m.spawnGroup(g, { tag: 'bc-pit', points: BOOT_PIT, hold: true, aggro: 520 }));
    this.base = chargesLeft(g);
    if (this.base <= 0) this.complete(m, g); // both grenades already thrown earlier: the lesson is learned
  }
  update(m: Mission, g: Game) { if (this.state === 'active' && chargesLeft(g) < this.base) this.complete(m, g); }
  hud(_m: Mission, g: Game): HudLine { return { text: this.label, sub: g.targeting ? 'Tap near the enemies to throw' : 'Tap a soldier portrait (bottom right)' }; }
  point(): ObjPoint { return { pos: BOOT_PIT[1], label: 'ENEMY', color: '#ff7a5a' }; }
}

/** Step 4: a short, timed briefing on health, downs and permadeath; it waits until the pit is clear. Never downs anyone. */
export class CasualtyBriefObjective extends Objective {
  t = 0;
  constructor() { super('bc-health', 'Keep your squad alive'); this.phase = 'brief'; }
  private left(g: Game) { return g.enemies.filter((e) => e.active && e.tag === 'bc-pit').length; }
  update(m: Mission, g: Game, dt: number) {
    if (this.state !== 'active') return;
    this.t += dt;
    if (this.t >= BOOT.briefTime && this.left(g) === 0) this.complete(m, g);
  }
  hud(_m: Mission, g: Game): HudLine {
    const n = this.left(g);
    return { text: this.label, sub: n ? `Clear the pit: ${n} left` : undefined, progress: Math.min(1, this.t / BOOT.briefTime) };
  }
  point(_m: Mission, g: Game): ObjPoint | null {
    const e = g.enemies.find((x) => x.active && x.tag === 'bc-pit');
    return e ? { pos: e.pos, label: 'ENEMY', color: '#ff7a5a' } : null;
  }
}

/** Presentation for the training ground: a pulsing marker on the movement area; drill targets start weakened. */
class TrainingGround implements MissionMechanic {
  readonly id = 'boot-camp';
  start(_m: Mission, g: Game) { weaken(g.enemies.filter((e) => e.tag === 'bc-drill')); }
  draw(ctx: CanvasRenderingContext2D, m: Mission, g: Game) {
    const o = m.currentObjective;
    if (!(o instanceof ReachObjective)) return;
    const z = o.zone, p = 0.5 + 0.5 * Math.sin(g.clock * 5);
    const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
    ctx.fillStyle = `rgba(255,216,74,${0.1 + p * 0.14})`;
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 4;
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.beginPath(); ctx.arc(cx, cy, 34 + p * 10, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MOVE HERE', cx, z.y - 22);
  }
}

export const BOOT_CAMP_SCRIPT: MissionScript = {
  id: 'boot-camp', def: BOOT_CAMP_DEF, map: BOOT_CAMP_MAP,
  groups: () => [{ tag: 'bc-drill', points: BOOT_DRILL, aggro: 430 }],
  triggers: [],
  primaries: () => [
    new ReachObjective('bc-move', 'Move to the marked area', BOOT_MOVE_ZONE, 'MOVE HERE'),
    new EliminateObjective('bc-fight', 'Defeat the training targets', ['bc-drill'], 'ENEMY'),
    new AbilityDrillObjective(),
    new CasualtyBriefObjective(),
  ],
  optionals: () => [],
  extraction: { zone: BOOT_EXTRACTION, countdown: () => BOOT.extractionCountdown },
  mechanics: () => [new TrainingGround()],
};

// ---------------- coaching (what the coach card says and points at) ----------------
/** One coaching card: a short title, one to three lines, and the element (CSS selector) to highlight. */
export interface CoachCard { key: string; title: string; lines: string[]; target?: string; final?: boolean }

/** Field Training: the card for the current step (null outside a training mission). */
export function fieldCoach(g: Game): CoachCard | null {
  if (g.deployment.kind !== 'training' || g.phase !== 'playing') return null;
  const m = g.mission, o = m.currentObjective;
  switch (o?.id) {
    case 'bc-move': return { key: 'move', title: 'MOVE', lines: ['Use the joystick to move your squad to the marked area.'], target: '#bc-stick' };
    case 'bc-fight': return { key: 'fight', title: 'AUTOMATIC COMBAT', lines: ['Your soldiers automatically attack nearby enemies.', 'Move into range to engage.'] };
    case 'bc-ability': return g.targeting
      ? { key: 'aim', title: 'ABILITY', lines: ['Now tap near the enemies to throw the grenade.'] }
      : { key: 'ability', title: 'ABILITY', lines: ["Tap a soldier's ability to activate a powerful combat advantage."], target: '#panels .ability.ready' };
    case 'bc-health': return {
      key: 'health', title: 'KEEP YOUR SQUAD ALIVE', target: '#panels .hp',
      lines: ['At 0 health a soldier is downed. A squadmate standing beside them can revive them.', 'Soldiers who die must be resurrected or honored in the Memorial.'],
    };
  }
  if (m.phase === 'countdown') return { key: 'heli', title: 'EXTRACTION', lines: ['The helicopter is coming in. Hold the landing zone.'] };
  if (m.inExtraction) return { key: 'extract', title: 'EXTRACTION', lines: ['Move your squad to the helicopter to complete your training.'] };
  return null;
}

/** Headquarters tour steps, in order. 'roster' and 'shop' wait for the tab to be seen, 'missions' for the Campaign screen. */
export type TourStep = 'roster' | 'shop' | 'missions' | 'complete';

/** Headquarters tour: the card for the open screen (`screen` / `tab` are Menus.screen / Menus.tab). */
export function tourCoach(step: TourStep, screen: string, tab: string): CoachCard | null {
  if (screen !== 'campaign' && screen !== 'barracks') return null; // casualty flow, Memorial, Results: stay out of the way
  const inB = screen === 'barracks';
  switch (step) {
    case 'roster': return inB
      ? { key: 'roster-tab', title: 'HEADQUARTERS', lines: ['Tap ROSTER.'], target: '[data-tab="roster"]' }
      : { key: 'roster-open', title: 'FIELD TRAINING COMPLETE', lines: ['Now a quick look around headquarters.', 'Tap BARRACKS to open your Roster.'], target: '[data-a="to-barracks"]' };
    case 'shop': return inB
      ? { key: 'shop', title: 'ROSTER', lines: ['Manage your soldiers here and pick who deploys in the squad slots.', 'Soldiers gain experience on missions and can be upgraded over time.', 'Next: tap TRAINING.'], target: '[data-tab="training"]' }
      : { key: 'shop-open', title: 'HEADQUARTERS', lines: ['Tap BARRACKS, then TRAINING.'], target: '[data-a="to-barracks"]' };
    case 'missions': return inB
      ? { key: 'missions', title: 'TRAINING', lines: ['Missions earn Credits. Spend them here on upgrades, or on recruits and support in the other tabs.', 'Improving soldiers prepares the squad for harder missions.', 'Next: tap ◂ CAMPAIGN.'], target: '[data-a="to-campaign"]' }
      : null;
    case 'complete': return screen === 'campaign'
      ? { key: 'complete', title: 'BOOT CAMP COMPLETE!', final: true,
        lines: ['Complete missions to advance the campaign. Replay earlier ones to earn XP and Credits.', 'Prepare your squad before attempting harder missions.', 'Your squad is ready for its first mission.'] }
      : null;
  }
}

/** Tour step after the player looked at `screen` / `tab` (the tour only moves forward). */
export function tourAdvance(step: TourStep, screen: string, tab: string): TourStep {
  if (step === 'roster' && screen === 'barracks' && tab === 'roster') return 'shop';
  if (step === 'shop' && screen === 'barracks' && tab === 'training') return 'missions';
  if (step === 'missions' && screen === 'campaign') return 'complete';
  return step;
}

/** Boot Camp state on the Game (never saved; the account only keeps whether the offer is still due). */
export class BootCamp {
  /** Headquarters tour in progress (null = none). */
  tour: TourStep | null = null;
  /** Field Training was started (tests / tools). */
  runs = 0;
  /** Field Training just ended (won?): Game.update opens the tour on its next call, outside the step that ended it. */
  finished: boolean | null = null;
}

/**
 * The offer is shown to people. Automated browsers (navigator.webdriver: the headless regression suites, which start
 * from a fresh save) don't get it unless the URL asks with `?bootcamp`, so the older suites drive the Campaign screen
 * as before; the account state is the same either way (tools/bootcamp.cjs opens it with `?bootcamp`).
 */
export function bootCampOfferShown(): boolean {
  if (typeof navigator === 'undefined' || !navigator.webdriver) return true;
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('bootcamp');
}
/** The offer is due for this account (brand-new v0.9E saves only, until started, skipped or completed). */
export const bootCampDue = (a: AccountData) => a.bootCamp === 'pending';
/**
 * Starting, skipping, completing or exiting closes a pending offer for good ('done' after the field training, 'skipped'
 * otherwise); every other state is left alone, so replaying or exiting on an older save never writes to it.
 */
export function closeBootCampOffer(a: AccountData, how: 'done' | 'skipped'): boolean {
  if (a.bootCamp !== 'pending') return false;
  a.bootCamp = how;
  return true;
}
