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
loaded.roster.onChange = () => { persist(); };
function useRoster(r: Roster) { r.onChange = () => { persist(); }; game.replaceRoster(r); }
/** Dev: wipe the save back to the six default soldiers, 0 credits (tuning panel, two-step confirm). */
function resetRosterSave() { const fresh = resetSave(); setAccount(fresh.account); useRoster(fresh.roster); }

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
else if (tempIds.length) game.deploy([...new Set(tempIds)].slice(0, 3), 'temp');
else hud.showStart(loaded.status === 'reset' || loaded.status === 'repaired' ? 'Save data was invalid and has been repaired.' : loaded.status === 'migrated' ? 'Save updated for v0.3: your soldiers and squad were kept.' : undefined);

// fixed-step simulation, render every frame
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
function frame(now: number) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= STEP) { game.update(STEP); acc -= STEP; }
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
  __progression: progression, __economy: economy, __account: getAccount, __persist: persist });
game.resetRosterSave = resetRosterSave;
