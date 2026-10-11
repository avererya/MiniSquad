// v0.6.3 mobile performance: render frame-rate cap, frame pacing and the developer-only
// performance overlay. The SIMULATION is untouched by any of this: it always runs fixed 1/60 s
// steps through SimClock (clock.ts), so the render cap only decides how often the loop wakes
// up to draw. At 30 FPS each drawn frame simply runs two simulation steps instead of one, and
// movement, fire rates, enemy attacks, bleed-out, cooldowns, mission timers and boss attacks
// are identical (tools/fps-parity.cjs checks this step for step).
//
// Settings → Performance (⚙ panel), or ?fps=30 / ?perf=1 in the URL for testing. Stored under
// their own localStorage key, never in the save.
//
// v0.6.4 default frame cap: 30 FPS on mobile (phone playtests: no visible difference, less
// heat), 60 FPS on desktop. A cap the player picked in Settings is stored and always wins; with
// no explicit pick, the device default applies (so it follows the device, not an old default).
// Storage v2: { v: 2, fpsCap?: 30 | 60 (only when explicitly picked), overlay }. The v0.6.3
// format wrote fpsCap whenever ANY performance option changed, so its 60 (the old default) is
// indistinguishable from "never chose": only its 30, which had to be picked, counts as a choice.

export type FpsCap = 30 | 60;
export interface PerfSettings { fpsCap: FpsCap; overlay: boolean }

const KEY = 'minisquad.dev.perf';

/** Phones and tablets: touch is the primary input, or a mobile browser. Desktop touchscreens with a mouse are desktop. */
export function isMobileDevice(): boolean {
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch { /* no matchMedia */ }
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
export const DEFAULT_FPS_CAP: FpsCap = isMobileDevice() ? 30 : 60;

/** The player's explicit frame-cap pick, or null (device default applies). */
let chosenCap: FpsCap | null = null;
let overlay = false;
let urlCap: FpsCap | null = null;
let urlOverlay = false;
(() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (s.v === 2) { if (s.fpsCap === 30 || s.fpsCap === 60) chosenCap = s.fpsCap; }
    else if (s.fpsCap === 30) chosenCap = 30; // v0.6.3: only 30 was necessarily a deliberate pick
    if (typeof s.overlay === 'boolean') overlay = s.overlay;
  } catch { /* storage unavailable: defaults */ }
  // URL overrides for testing (not stored)
  const q = new URLSearchParams(location.search);
  if (q.get('fps') === '30' || q.get('fps') === '60') urlCap = +q.get('fps')! as FpsCap;
  if (q.get('perf') === '1') urlOverlay = true;
})();

/** Active settings: URL override, else the explicit pick, else the device default. */
export function perfSettings(): Readonly<PerfSettings> {
  return { fpsCap: urlCap ?? chosenCap ?? DEFAULT_FPS_CAP, overlay: urlOverlay || overlay };
}
/** Is the frame cap the player's own pick (stored) rather than the device default? */
export function fpsCapChosen(): boolean { return chosenCap !== null; }
/** Is a ?fps= URL override active (testing; not stored)? */
export function fpsCapFromUrl(): boolean { return urlCap !== null; }
export function setPerfSettings(p: Partial<PerfSettings>) {
  if (p.fpsCap !== undefined) { chosenCap = p.fpsCap; urlCap = null; }
  if (p.overlay !== undefined) { overlay = p.overlay; urlOverlay = false; }
  const out: { v: 2; fpsCap?: FpsCap; overlay: boolean } = { v: 2, overlay };
  if (chosenCap !== null) out.fpsCap = chosenCap;
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* not persisted */ }
}

/** Frame rate for screens where nothing moves much (paused, Results behind the menu). */
export const IDLE_FPS = 15;
/** Menus (Barracks, Campaign...) are plain DOM: the loop only polls a few times a second. */
export const MENU_FPS = 10;

/**
 * Decides which display refreshes get a frame. Keeps a target time that advances by exactly one
 * interval per drawn frame (so a 120 Hz display drawing at 60 alternates cleanly, and a 60 Hz
 * display with a little timer jitter still draws every refresh), with half a refresh of slack.
 */
export class FramePacer {
  private next = 0;
  private fps = 0;
  due(now: number, fps: number): boolean {
    if (fps !== this.fps) { this.fps = fps; this.next = 0; } // mode change: draw at once
    if (this.next && now < this.next - 4) return false;
    const iv = 1000 / fps;
    this.next = this.next && now - this.next < iv ? this.next + iv : now + iv; // resync after a stall
    return true;
  }
}

/** Live counters for the overlay. Cheap enough to always run (a few adds per frame). */
export const counters = { los: 0, paths: 0, flows: 0 };

interface Sample { t: number; frameMs: number; simMs: number; renderMs: number; steps: number }

export class PerfStats {
  private samples: Sample[] = [];
  private lastFrame = 0;
  rafCalls = 0;
  private rafWindow: number[] = [];
  /** Every requestAnimationFrame callback (drawn or skipped). */
  raf(now: number) { this.rafWindow.push(now); this.rafCalls++; }
  frame(now: number, simMs: number, renderMs: number, steps: number) {
    const frameMs = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    this.samples.push({ t: now, frameMs, simMs, renderMs, steps });
  }
  /** Stats over the last second. */
  summary(now: number) {
    const s = this.samples = this.samples.filter((x) => now - x.t <= 1000);
    this.rafWindow = this.rafWindow.filter((t) => now - t <= 1000);
    const n = s.length || 1;
    const sum = (f: (x: Sample) => number) => s.reduce((a, x) => a + f(x), 0);
    const max = (f: (x: Sample) => number) => s.reduce((a, x) => Math.max(a, f(x)), 0);
    return {
      fps: s.length, rafHz: this.rafWindow.length,
      frameMs: sum((x) => x.frameMs) / n, frameMax: max((x) => x.frameMs),
      simMs: sum((x) => x.simMs) / n, simMax: max((x) => x.simMs),
      renderMs: sum((x) => x.renderMs) / n, renderMax: max((x) => x.renderMs),
      steps: sum((x) => x.steps), slow: s.filter((x) => x.frameMs > 40).length,
    };
  }
}
