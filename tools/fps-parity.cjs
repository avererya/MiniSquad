// v0.6.3 FRAME-RATE PARITY + SIMULATION EQUIVALENCE (headless Chromium, automated).
//
//   npx vite preview --port 4173 &  node tools/fps-parity.cjs
//   BASE=http://localhost:4174/  also compares the simulation against another build (e.g. v0.6.2)
//
// Math.random is replaced by a seeded generator before the game boots, the scripted autopilot
// (tools/perf-lib.cjs) plays the mission, and the game state is hashed every 5 game seconds
// (positions, HP, states, bleed-out timers, cooldowns, projectiles, mission / boss phase,
// stats). Two runs that hash the same at every checkpoint played the mission identically.
//
//  1. fps:  the REAL frame loop (main.ts) driven with synthetic display refreshes of
//           60 Hz / 120 Hz / 90 Hz and the render cap at 60 / 30. Every combination must give the
//           same hashes: changing the frame rate changes nothing in the simulation.
//  2. sim:  (with BASE) the simulation stepped directly in this build and in BASE: the v0.6.3
//           optimizations (flow field, allocations) must not change a single outcome.
// Exits 1 on any mismatch.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { setupMission, installPilot } = require('./perf-lib.cjs');

const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const MISSIONS = (process.env.MISSIONS || 'prison-break,blackout,iron-fist').split(',');
const SECS = +(process.env.SECS || 60);
const SEED = +(process.env.SEED || 12345);

function init({ seed, drive }) {
  let s = seed >>> 0;
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  if (drive) {
    let q = [], now = 1000;
    window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
    window.__drive = (period, until) => { let n = 0; while (!until() && n < 1e6) { now += period; const cbs = q; q = []; for (const cb of cbs) cb(now); n++; } return n; };
  }
}

function hashState() {
  const g = window.game, m = g.mission, r = (x) => Math.round(x * 1000);
  const u = (x) => [r(x.pos.x), r(x.pos.y), r(x.hp), x.state, r(x.bleed ?? 0), r(x.reviveProgress ?? 0), r(x.aim), r(x.fireCooldown), x.ability ? r(x.ability.cooldownLeft) : 0, x.shots, x.hits];
  const st = JSON.stringify([r(g.time), g.phase, m.phase, m.boss ? [m.boss.phase, m.boss.rockets, m.boss.bursts] : 0,
    g.soldiers.map(u), g.npcs.map(u), g.enemies.map(u), g.projectiles.map((p) => [r(p.pos.x), r(p.pos.y)]), g.grenades.length,
    m.primaries.map((o) => o.state), m.optionals.map((o) => o.state),
    // v0.8B (absent on older builds: hashes the same there): mission assets, the escort truck's progress
    (g.assets || []).map(u), m.escort ? [r(m.escort.s), r(m.escort.v), m.escort.state, m.escort.gun.shots] : 0]);
  let h = 2166136261; for (let i = 0; i < st.length; i++) { h ^= st.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

async function open(browser, url, drive) {
  const page = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  await page.addInitScript(init, { seed: SEED, drive });
  await page.goto(url); await page.evaluate(() => localStorage.clear());
  await page.goto(url); await page.waitForFunction(() => !!window.game);
  return page;
}

/** Real frame loop at `hz` (cap from ?fps=); returns hashes every 5 game s. */
async function loopRun(browser, url, mission, hz) {
  const page = await open(browser, url, true);
  await page.evaluate(setupMission, { missionId: mission, level: 6 });
  await page.evaluate(installPilot);
  const res = await page.evaluate(({ hz, SECS, hashSrc }) => {
    const hash = eval(`(${hashSrc})`);
    const g = window.game, P = window.__pilot, u0 = g.update.bind(g);
    let steps = 0, frames = 0; const out = [];
    g.update = (dt) => { if (g.phase === 'playing') { P.step(); steps++; } u0(dt); if (steps % 300 === 0 && out.length < steps / 300) out.push(hash()); };
    const canvasDraws = { n: 0 };
    const di = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (a.length === 9) canvasDraws.n++; return di.apply(this, a); };
    frames = window.__drive(1000 / hz, () => steps >= SECS * 60 || g.phase !== 'playing');
    return { hashes: out, steps, frames, draws: canvasDraws.n, phase: g.phase, time: +g.time.toFixed(3) };
  }, { hz, SECS, hashSrc: hashState.toString() });
  await page.context().close();
  return res;
}

/** Simulation stepped directly (no frame loop). */
async function simRun(browser, url, mission) {
  const page = await open(browser, url, true); // frame loop frozen: only these direct steps run
  await page.evaluate(setupMission, { missionId: mission, level: 6 });
  await page.evaluate(installPilot);
  const res = await page.evaluate(({ SECS, hashSrc }) => {
    const hash = eval(`(${hashSrc})`);
    const g = window.game, P = window.__pilot, out = [];
    for (let i = 1; i <= SECS * 60 && g.phase === 'playing'; i++) { P.step(); g.update(1 / 60); if (i % 300 === 0) out.push(hash()); }
    return { hashes: out, phase: g.phase, time: +g.time.toFixed(3) };
  }, { SECS, hashSrc: hashState.toString() });
  await page.context().close();
  return res;
}

(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  const check = (name, a, b) => {
    const n = Math.min(a.hashes.length, b.hashes.length);
    const firstDiff = a.hashes.findIndex((h, i) => i < n && h !== b.hashes[i]);
    const ok = n > 0 && firstDiff < 0 && a.hashes.length === b.hashes.length;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${n} checkpoints${firstDiff >= 0 ? `, first difference at ${(firstDiff + 1) * 5}s` : ''}${a.hashes.length !== b.hashes.length ? ` (lengths ${a.hashes.length}/${b.hashes.length})` : ''}`);
  };
  for (const m of MISSIONS) {
    const ref = await loopRun(browser, URL + '?fps=60', m, 60);
    console.log(`  ${m} reference 60 Hz display, cap 60: ${ref.frames} refreshes, ${ref.draws} frames drawn, ${ref.steps} steps, phase ${ref.phase}, t=${ref.time}`);
    for (const [hz, cap] of [[120, 60], [90, 60], [60, 30], [120, 30]]) {
      const r = await loopRun(browser, URL + `?fps=${cap}`, m, hz);
      console.log(`  ${m} ${hz} Hz display, cap ${cap}: ${r.frames} refreshes, ${r.draws} frames drawn (${(r.draws / (r.steps / 60)).toFixed(1)} fps), ${r.steps} steps, phase ${r.phase}, t=${r.time}`);
      check(`${m} ${hz}Hz/cap${cap} == 60Hz/cap60`, r, ref);
    }
    if (BASE) {
      const a = await simRun(browser, URL, m), b = await simRun(browser, BASE, m);
      check(`${m} simulation this build == ${BASE} (${a.phase}, t=${a.time})`, a, b);
      const b60 = await loopRun(browser, BASE, m, 60), b120 = await loopRun(browser, BASE, m, 120);
      const n = Math.min(b60.hashes.length, b120.hashes.length), d = b60.hashes.findIndex((h, i) => i < n && h !== b120.hashes[i]);
      console.log(`  INFO ${BASE} frame loop 60 Hz vs 120 Hz display: ${d < 0 ? 'identical' : `diverges at ${(d + 1) * 5}s (render consumed gameplay randomness)`}; frames drawn ${b60.draws} vs ${b120.draws}`);
    }
  }
  // focus loss and idle screens (real frame loop, synthetic 120 Hz refreshes)
  {
    const page = await open(browser, URL, true);
    const r = await page.evaluate(({ setupSrc }) => {
      const setup = eval(`(${setupSrc})`);
      const g = window.game;
      let draws = 0;
      const di = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (a.length === 9) draws++; return di.apply(this, a); };
      const sec = (s) => { let t = 0; window.__drive(1000 / 120, () => ++t > s * 120); };
      sec(1); const menuDraws = draws; // Campaign screen: no canvas frames
      setup({ missionId: 'iron-fist', level: 6 });
      draws = 0; sec(1); const playDraws = draws;
      g.soldiers[0].hp = 1; g.downSoldier(g.soldiers[0]);
      const before = g.soldiers[0].bleed;
      window.dispatchEvent(new Event('blur'));
      draws = 0; sec(2); const pausedDraws = draws;
      return { menuDraws, playDraws, paused: g.paused, before, after: g.soldiers[0].bleed, pausedDraws, t: g.time };
    }, { setupSrc: setupMission.toString() });
    await page.context().close();
    const checks = [
      ['menus draw no canvas frames', r.menuDraws === 0],
      ['playing at a 120 Hz display draws ~60 frames a second', r.playDraws >= 58 && r.playDraws <= 61],
      ['window blur (focus loss) pauses the mission', r.paused === true],
      ['bleed-out does not run while paused after focus loss', Math.abs(r.after - r.before) < 1e-9],
      ['paused screen redraws at the idle rate (<= 16 fps)', r.pausedDraws <= 32],
    ];
    for (const [name, ok] of checks) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); }
    console.log('  ' + JSON.stringify(r));
  }
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
