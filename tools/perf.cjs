// v0.6.3 PERFORMANCE PROFILE (headless Chromium, automated). NOT a real-phone measurement:
// no battery, temperature or physical-device numbers come out of this tool.
//
//   npx vite preview --port 4173 &  node tools/perf.cjs
//   URL=http://localhost:4174/ LABEL=baseline OUT=/path/perf.json node tools/perf.cjs
//   MODES=steps,loop,menu  MISSIONS=prison-break,blackout,iron-fist  HZ=120,60  THROTTLE=4  FPS=60
//
// Modes:
//   steps  per simulation step: update() time, and render()+HUD time (via window.__render), with
//          the scripted autopilot playing the mission (fixed 1/60 s steps, up to SECS game s).
//   loop   the REAL frame loop on an emulated HZ display (requestAnimationFrame replaced by a
//          timer at HZ): fast-forwards FF game seconds into the mission, then measures WIN real
//          seconds: canvas frames drawn per second, rAF callbacks, and main-thread busy time
//          (CDP Performance metrics: TaskDuration, Script, Layout, RecalcStyle).
//   menu   the Campaign screen idling for WIN seconds (same metrics).
// Viewport: iPhone 14 landscape (844x390, DPR 3, touch). THROTTLE = CDP CPU slowdown factor.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const { setupMission, installPilot, counts, stats } = require('./perf-lib.cjs');

const URL = process.env.URL || 'http://localhost:4173/';
const LABEL = process.env.LABEL || 'current';
const MODES = (process.env.MODES || 'steps,loop,menu').split(',');
const MISSIONS = (process.env.MISSIONS || 'prison-break,blackout,iron-fist').split(',');
const HZS = (process.env.HZ || '120,60').split(',').map(Number);
const THROTTLE = +(process.env.THROTTLE || 4);
const SECS = +(process.env.SECS || 150);
const FF = +(process.env.FF || 45);
const WIN = +(process.env.WIN || 8);
const LEVEL = +(process.env.LEVEL || 6);
const FPS = process.env.FPS || ''; // optional ?fps= cap for the build under test
const OUT = process.env.OUT || '';

/** Init script: fake display refresh + frame counters (works on any build). */
function displayShim(hz) {
  if (hz > 0) {
    let q = [], id = 0;
    window.requestAnimationFrame = (cb) => { q.push(cb); return ++id; };
    window.cancelAnimationFrame = () => {};
    const period = 1000 / hz;
    let t0 = performance.now(), k = 0;
    const tick = () => {
      // a real display drops refreshes while the page is busy, it never replays them: resync
      if (performance.now() - (t0 + k * period) > period) { t0 = performance.now(); k = 0; }
      const cbs = q; q = [];
      window.__rafCalls = (window.__rafCalls || 0) + cbs.length;
      const now = performance.now();
      window.__tick = k; // v0.8B.1: a frame may blit several ground strips; count it once
      for (const cb of cbs) cb(now);
      k++;
      setTimeout(tick, Math.max(0, t0 + k * period - performance.now()));
    };
    setTimeout(tick, period);
  }
  // a frame-loop tick with a 9-argument drawImage on the game canvas (the ground blit) = one rendered frame
  const di = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...a) {
    if (a.length === 9 && this.canvas && this.canvas.id === 'game' && window.__tick !== window.__lastTick) { window.__lastTick = window.__tick; window.__canvasFrames = (window.__canvasFrames || 0) + 1; }
    return di.apply(this, a);
  };
}

async function newPage(browser, hz) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(displayShim, hz);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const url = URL + (FPS ? `?fps=${FPS}` : '');
  await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.goto(url);
  await page.waitForFunction(() => !!window.game);
  return { ctx, page, cdp };
}

async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function window_(page, cdp, secs) {
  const c0 = await page.evaluate(() => ({ f: window.__canvasFrames || 0, r: window.__rafCalls || 0 }));
  const m0 = await metrics(cdp);
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < secs * 1000) { await page.waitForTimeout(1000); samples.push(await page.evaluate(counts)); }
  const m1 = await metrics(cdp);
  const c1 = await page.evaluate(() => ({ f: window.__canvasFrames || 0, r: window.__rafCalls || 0, phase: window.game.phase, time: window.game.time }));
  const wall = (Date.now() - t0) / 1000;
  const d = (k) => +(((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000 / wall).toFixed(1); // ms of main-thread work per real second
  return {
    wallSec: +wall.toFixed(2), canvasFps: +((c1.f - c0.f) / wall).toFixed(1), rafPerSec: +((c1.r - c0.r) / wall).toFixed(1),
    busyMsPerSec: d('TaskDuration'), scriptMsPerSec: d('ScriptDuration'), layoutMsPerSec: d('LayoutDuration'), styleMsPerSec: d('RecalcStyleDuration'),
    layoutsPerSec: +(((m1.LayoutCount ?? 0) - (m0.LayoutCount ?? 0)) / wall).toFixed(1), styleRecalcsPerSec: +(((m1.RecalcStyleCount ?? 0) - (m0.RecalcStyleCount ?? 0)) / wall).toFixed(1),
    heapMB: +((m1.JSHeapUsedSize ?? 0) / 1048576).toFixed(1),
    peak: samples.reduce((a, s) => ({ enemies: Math.max(a.enemies, s.enemies), projectiles: Math.max(a.projectiles, s.projectiles), effects: Math.max(a.effects, s.effects) }), { enemies: 0, projectiles: 0, effects: 0 }),
    phase: c1.phase, gameTime: +c1.time.toFixed(1),
  };
}

async function stepsMode(browser, mission) {
  const { ctx, page } = await newPage(browser, 0);
  const setup = await page.evaluate(setupMission, { missionId: mission, level: LEVEL });
  if (!setup.ok) { await ctx.close(); return { error: setup.reason }; }
  await page.evaluate(installPilot);
  const r = await page.evaluate((SECS) => {
    const g = window.game, P = window.__pilot, upd = [], ren = [], cnt = [];
    const hasRender = typeof window.__render === 'function';
    if (hasRender) window.__render(); // warm-up: the first frame builds the map's ground bitmap
    const max = SECS * 60;
    let peak = { enemies: 0, projectiles: 0, effects: 0 };
    for (let i = 0; i < max && g.phase === 'playing'; i++) {
      P.step();
      const t0 = performance.now(); g.update(1 / 60); const t1 = performance.now();
      if (hasRender) { window.__render(); ren.push(performance.now() - t1); }
      upd.push(t1 - t0);
      if (i % 30 === 0) {
        const fx = g.fx, c = { enemies: g.enemies.filter((e) => e.active).length, projectiles: g.projectiles.length, effects: fx.particles.length + fx.rings.length + fx.texts.length + fx.pulses.length };
        cnt.push(c);
        peak = { enemies: Math.max(peak.enemies, c.enemies), projectiles: Math.max(peak.projectiles, c.projectiles), effects: Math.max(peak.effects, c.effects) };
      }
    }
    return { upd, ren, peak, phase: g.phase, time: g.time, hasRender };
  }, SECS);
  await ctx.close();
  return { phase: r.phase, gameTime: +r.time.toFixed(1), steps: r.upd.length, updateMs: stats(r.upd), renderMs: r.hasRender ? stats(r.ren) : null, peak: r.peak };
}

async function loopMode(browser, mission, hz) {
  const { ctx, page, cdp } = await newPage(browser, hz);
  const setup = await page.evaluate(setupMission, { missionId: mission, level: LEVEL });
  if (!setup.ok) { await ctx.close(); return { error: setup.reason }; }
  await page.evaluate(installPilot);
  // fast-forward into the fight (direct fixed steps), then let the real loop + pilot run
  await page.evaluate((FF) => {
    const g = window.game, P = window.__pilot;
    for (let i = 0; i < FF * 60 && g.phase === 'playing'; i++) { P.step(); g.update(1 / 60); }
    const u = g.update.bind(g);
    g.update = (dt) => { if (g.phase === 'playing' && !g.paused) P.step(); u(dt); };
  }, FF);
  await page.waitForTimeout(500);
  const w = await window_(page, cdp, WIN);
  await ctx.close();
  return { hz, ...w };
}

async function menuMode(browser, hz) {
  const { ctx, page, cdp } = await newPage(browser, hz);
  await page.waitForTimeout(800);
  const w = await window_(page, cdp, Math.min(WIN, 5));
  await ctx.close();
  return { hz, ...w };
}

(async () => {
  const browser = await chromium.launch();
  const out = { label: LABEL, url: URL, throttle: THROTTLE, fpsParam: FPS || null, steps: {}, loop: {}, menu: {} };
  for (const m of MISSIONS) {
    if (MODES.includes('steps')) { out.steps[m] = await stepsMode(browser, m); console.log(LABEL, 'steps', m, JSON.stringify(out.steps[m])); }
    if (MODES.includes('loop')) for (const hz of HZS) { out.loop[`${m}@${hz}`] = await loopMode(browser, m, hz); console.log(LABEL, 'loop', m, hz, JSON.stringify(out.loop[`${m}@${hz}`])); }
  }
  if (MODES.includes('menu')) for (const hz of HZS) { out.menu[hz] = await menuMode(browser, hz); console.log(LABEL, 'menu', hz, JSON.stringify(out.menu[hz])); }
  await browser.close();
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
