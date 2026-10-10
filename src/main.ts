import { Game } from './game';
import { Hud } from './hud';
import { render } from './render';
import { VIEW_W, VIEW_H } from './view';
import { unlockAudio } from './audio';
import { findPreset, effectiveStats } from './classes';
import { CFG, applyConfigJSON, resetConfig } from './config';
import { loadSave, parseSave, resetSave, writeSave, SAVE_KEY } from './save';
import * as progression from './progression';
import { getAccount, setAccount } from './progression';
import * as economy from './economy';
import { Roster } from './roster';
import { TRAITS } from './traits';
import * as campaign from './campaign';
import * as recruitment from './recruitment';
import * as casualties from './casualties';
import { SimClock } from './clock';
import { CAMPAIGN, namedRecruit } from './campaign';

const stage = document.getElementById('stage')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const game = new Game(stage, canvas);
const hud = new Hud(document.getElementById('hud')!, document.getElementById('tuning')!, document.getElementById('menu')!, game);
game.ui = hud;

// Saved roster + squad selection + account (credits, squad training, mission records).
// Written on Barracks selection changes, purchases and mission settlement; dev presets and
// ?squad= deployments never save or earn rewards.
const loaded = loadSave();
setAccount(loaded.account);
game.roster = loaded.roster;
const persist = () => writeSave(game.roster, getAccount());
game.persist = persist;
// v0.6: a roster mission that never reached its mission-end transaction (app closed / reloaded
// mid-mission) is resolved now: soldiers who had already fallen in it stay KIA (decision queued).
const hadJournal = !!loaded.account.activeRun;
const interrupted = economy.recoverInterruptedRun(loaded.roster, loaded.account);
if (hadJournal) persist();
loaded.roster.onChange = () => { persist(); };
game.selectMission(loaded.account.campaign.selectedMission);
function useRoster(r: Roster, notice?: string) { r.onChange = () => { persist(); }; game.replaceRoster(r, notice); }
/** Dev: wipe the save back to a new player (Ace + Ranger, Mission 1, 0 credits) (tuning panel, two-step confirm). */
function resetRosterSave(notice?: string): boolean {
  const fresh = resetSave();
  if (!fresh) return false; // backup failed: nothing wiped
  setAccount(fresh.account); game.selectMission(fresh.account.campaign.selectedMission); useRoster(fresh.roster, notice);
  return true;
}
/**
 * Dev: unlock every playable mission and every soldier, and SAVE it (tuning panel, two-step
 * confirm, clearly labelled). XP, training, credits and mission records are not touched.
 */
function debugUnlockAll() {
  const a = getAccount();
  a.campaign.unlockedMissions = CAMPAIGN.filter((m) => m.playable).map((m) => m.id);
  for (const s of game.roster.soldiers) {
    // dev: every named soldier joins and their offer counts as claimed (no Credits, no notice)
    if (game.roster.unlock(s.id) && namedRecruit(s.id)) for (const l of [a.named.unlocked, a.named.claimed, a.named.notified]) if (!l.includes(s.id)) l.push(s.id);
  }
  persist();
  useRoster(game.roster, 'DEBUG: all missions and soldiers unlocked (saved).');
}
game.debugUnlockAll = debugUnlockAll;

// Fit the 1280x720 stage into the visible viewport, minus safe areas (notch, home bar).
// Mobile browsers often report stale sizes right after a rotation and may leave the
// page scrolled, so layout re-runs on every viewport signal and again after a delay.
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
  'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(safeProbe);

function viewportSize() {
  const vv = window.visualViewport;
  // visualViewport tracks the real visible area; ignore it while pinch-zoomed
  if (vv && vv.width > 0 && vv.height > 0 && Math.abs(vv.scale - 1) < 0.01) return { w: vv.width, h: vv.height };
  return { w: window.innerWidth, h: window.innerHeight };
}

let scale = 1;
function resize() {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  const { w, h } = viewportSize();
  document.documentElement.style.setProperty('--app-h', `${h}px`);
  const cs = getComputedStyle(safeProbe);
  const st = parseFloat(cs.paddingTop) || 0, sr = parseFloat(cs.paddingRight) || 0;
  const sb = parseFloat(cs.paddingBottom) || 0, sl = parseFloat(cs.paddingLeft) || 0;
  const aw = Math.max(1, w - sl - sr), ah = Math.max(1, h - st - sb);
  scale = Math.min(aw / VIEW_W, ah / VIEW_H);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  stage.style.transform = `translate(${sl + (aw - VIEW_W * scale) / 2}px, ${st + (ah - VIEW_H * scale) / 2}px) scale(${scale})`;
  const cw = Math.round(VIEW_W * scale * dpr), ch = Math.round(VIEW_H * scale * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  ctx.setTransform((canvas.width / VIEW_W), 0, 0, (canvas.height / VIEW_H), 0, 0);
}

let relayoutTimers: number[] = [];
function scheduleResize() {
  resize();
  relayoutTimers.forEach((t) => clearTimeout(t));
  relayoutTimers = [100, 350].map((ms) => window.setTimeout(resize, ms));
}
window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
window.addEventListener('pageshow', scheduleResize);
window.visualViewport?.addEventListener('resize', scheduleResize);
window.visualViewport?.addEventListener('scroll', scheduleResize);
screen.orientation?.addEventListener?.('change', scheduleResize);
scheduleResize();

window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// Dev shortcuts (deploy immediately, never saved):
//   ?squad=ihm          generic class preset (ids: ii, ih, im, ihm, hh, mm, i, iii)
//   ?squad=ace,tank,doc roster soldiers by id, as a temporary squad
const sq = new URLSearchParams(location.search).get('squad');
const preset = findPreset(sq);
const tempIds = sq ? sq.split(/[,+ ]/).map((x) => game.roster.get(x.toLowerCase())).filter((x) => !!x) : [];
hud.rebuildPanels();
if (preset) game.reset(preset.classes);
else if (tempIds.length) game.deploy([...new Set(tempIds)].slice(0, 6), 'temp');
else {
  const msg = loaded.status === 'reset' || loaded.status === 'repaired' ? 'Save data was invalid and has been repaired.'
    : loaded.status === 'migrated' ? (loaded.fromVersion === 6
      ? 'Save updated for v0.6.2: everything was kept. New: Chapter 2 — Behind Enemy Lines (Missions 6-10) and, after Mission 9, the Sniper class.'
      : loaded.fromVersion === 5
      ? 'Save updated for v0.6.1: every soldier you have was kept (nothing charged). New: campaign milestones now unlock named recruits you choose to buy in the Recruitment Office.'
      : loaded.fromVersion === 4
      ? 'Save updated for v0.6: everything was kept. New: KIA is now permanent — fallen soldiers can be resurrected or honored in the Memorial.'
      : loaded.fromVersion === 3
        ? 'Save updated for v0.6: all your soldiers, XP, training, Credits and campaign progress were kept. New: the Recruitment Office and permanent KIA.'
        : 'Save updated: all your soldiers, XP, training and credits were kept. The campaign starts at Mission 1. New: the Recruitment Office and permanent KIA.') : undefined;
  const why = interrupted.length ? `The last mission was interrupted: ${interrupted.map((f) => game.roster.get(f.id)?.name ?? f.id).join(', ')} fell before it ended.` : msg;
  if (casualties.decisionBlock(getAccount())) hud.showDecisions(why);
  else hud.showCampaign(why);
}

// Fixed-step simulation, render every frame. SimClock (clock.ts): 1/60 s steps, each frame's
// real delta clamped to 0.1 s (a frame drop or slow device slows the game down, it never
// fast-forwards it), and nothing advances while the page is hidden. v0.6: hiding the page
// (app switch, lock screen, tab change) also PAUSES a running mission, so backgrounding can never
// bleed a soldier out; on return the player resumes with ⏸ / P and the clock restarts cleanly.
const clock = new SimClock(1 / 60, 0.1);
function onHidden() {
  clock.suspend();
  if (game.phase === 'playing') game.paused = true;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); else clock.resume(performance.now()); });
window.addEventListener('pagehide', onHidden);
window.addEventListener('pageshow', () => clock.resume(performance.now()));
function frame(now: number) {
  const steps = clock.advance(now, document.hidden);
  for (let i = 0; i < steps; i++) game.update(clock.step);
  ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);
  if (game.phase !== 'start') render(ctx, game); // the Barracks covers the whole screen
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handy in the console while tuning
(window as any).game = game;
// config hooks for the headless checks in tools/ (same functions the tuning panel uses)
Object.assign(window as any, { __CFG: CFG, __applyConfigJSON: applyConfigJSON, __resetConfig: resetConfig });
// roster / save hooks for tools/ (read-only helpers + the same reset the tuning panel uses)
Object.assign(window as any, { __TRAITS: TRAITS, __effectiveStats: effectiveStats, __parseSave: parseSave, __SAVE_KEY: SAVE_KEY, __resetRosterSave: resetRosterSave, __loadStatus: loaded,
  __progression: progression, __economy: economy, __account: getAccount, __persist: persist, __campaign: campaign, __debugUnlockAll: debugUnlockAll, __recruitment: recruitment, __Roster: Roster,
  __casualties: casualties, __clock: clock, __SimClock: SimClock, __hud: hud });
game.resetRosterSave = resetRosterSave;
