// Shared helpers for the tools/*.cjs suites and the test runner (tools/test.cjs). Phase 2 (test infrastructure).
//
// Suites keep their own console format (one `PASS  name  detail` / `FAIL  name  detail` line per check) and add one
// machine-readable line at the end, so the runner reads real totals instead of guessing from the log:
//   ##minisquad-result {"checks":86,"failed":0,"errors":0}
// Exit codes: 0 every check passed, 1 a check failed or the page threw, 2 the suite crashed before finishing.
//
// Usage in a suite:
//   const { chromium, URL, OUT, createChecks, runSuite } = require('./lib.cjs');
//   runSuite(async () => {
//     const { check, finish } = createChecks({ pad: 74 });
//     ... check('name', ok, detail) ...
//     return finish(pageErrors);   // prints errors + the result line, returns the exit code
//   });
const fs = require('fs');
const path = require('path');
const http = require('http');

const RESULT_TAG = '##minisquad-result ';
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const OUT = process.env.OUT || '';

/** Playwright: $PLAYWRIGHT_PATH, a local install, or the global one the cloud image ships at /opt/node22. */
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* next */ } }
  throw new Error(`Playwright not found (tried ${tries.join(', ')}). Install it globally or set PLAYWRIGHT_PATH.`);
}

/** check(name, ok, detail) prints one PASS / FAIL line; finish(errors) prints page errors and the result line. */
function createChecks({ pad = 90, detailMax = 300 } = {}) {
  const st = { checks: 0, failed: 0, failures: [] };
  const check = (name, ok, detail = '') => {
    st.checks++;
    if (!ok) { st.failed++; st.failures.push(name); }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(pad)} ${String(detail ?? '').replace(/\s+/g, ' ').slice(0, detailMax)}`);
    return !!ok;
  };
  const finish = (errors = []) => {
    for (const e of errors) console.log(`ERROR ${String(e).slice(0, 500)}`);
    emitResult({ checks: st.checks, failed: st.failed, errors: errors.length });
    return st.failed || errors.length ? 1 : 0;
  };
  return { check, finish, state: st };
}

function emitResult(obj) { console.log(RESULT_TAG + JSON.stringify(obj)); }

/** The last result line in a suite's output, or null. */
function parseResult(text) {
  let last = null;
  for (const line of String(text).split('\n')) if (line.startsWith(RESULT_TAG)) { try { last = JSON.parse(line.slice(RESULT_TAG.length)); } catch { /* ignore */ } }
  return last;
}

/** Runs an async suite body that resolves to an exit code; a throw prints the stack and exits 2 (crash, not a failed check). */
function runSuite(main) {
  Promise.resolve().then(main).then((code) => process.exit(code ?? 0), (e) => {
    console.error(e && e.stack ? e.stack : e);
    emitResult({ crashed: String(e && e.message ? e.message : e).slice(0, 300) });
    process.exit(2);
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

/** Static server for a built dist/ on a free port (127.0.0.1). Resolves { url, close() }. */
function serveDir(dir, port = 0) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new globalThis.URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ url: `http://127.0.0.1:${p}/`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 3 shared PAGE helpers for mission suites (Chapter 4-5 suites should start here instead of copying the
// step / pin / kill helpers every chapter suite defines for itself). All of them are page-side functions:
//   await ctx.addInitScript(seedRandom, 12345);     // optional: deterministic Math.random before the game boots
//   await ctx.addInitScript(installPageHelpers);     // window.T (getters only: safe before window.game exists)
//   const page = await openPage(browser, URL, { seed: 12345 });   // the same in one call, fresh save, game booted
//   await page.evaluate(() => { const m = T.start('field-medicine', ['infantry', 'demolitions']); T.step(2); });
//   const snap = await page.evaluate(missionSnapshot);   // CFG + every playable mission as data (compare with BASE)
// Older suites keep their own copies (not migrated: no behaviour change in Phase 3).

/** Page-side: replace Math.random with a seeded generator (the same one fps-parity uses). Install before boot. */
function seedRandom(seed) {
  let s = (seed ?? 12345) >>> 0;
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Page-side: window.T, fixed-step helpers that drive window.game (the same 1/60 s step the game uses). */
function installPageHelpers() {
  window.T = {
    get g() { return window.game; },
    /** Unlock everything and start `missionId` with a generic squad (class ids) or roster soldiers (`{ roster: [ids] }`). */
    start(missionId, squad = ['infantry', 'heavy', 'medic']) {
      const g = window.game;
      window.__debugUnlockAll();
      g.selectMission(missionId, true);
      if (squad && squad.roster) { const r = g.deploy(squad.roster.map((id) => g.roster.get(id)), 'roster'); if (!r.ok) throw new Error(r.reason); } else g.reset(squad);
      return g.mission;
    },
    /** `sec` seconds of fixed steps; `each(i)` runs before every step (pin units, steer input). */
    step(sec, each) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (each) each(i); window.game.update(1 / 60); } },
    /** Steps until `cond()` or `maxSec`; returns the seconds stepped. */
    stepUntil(cond, maxSec, each) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (each) each(n); window.game.update(1 / 60); n++; } return n / 60; },
    /** Standing soldiers placed in a 3-wide block at `p` (velocity cleared, formation anchor moved). */
    pinAt(p, spread = 30) { const g = window.game; let i = 0; for (const s of g.soldiers) if (s.active) { s.pos = { x: p.x + ((i % 3) - 1) * spread, y: p.y + (Math.floor(i / 3) - 0.5) * spread }; s.vel = { x: 0, y: 0 }; i++; } g.anchor = { ...p }; },
    /** Kill matching enemies through Game.damage (credited to the first soldier), then 0.1 s so objectives react. */
    kill(pred) { const g = window.game; for (const e of g.enemies.filter((x) => x.active && pred(x))) g.damage(e, 1e6, g.soldiers[0]); this.step(0.1); },
    /** Remove every enemy that is not kept by `keep` (no events, no kills: an empty field for a scripted check). */
    calm(keep = () => false) { const g = window.game; for (const e of g.enemies) if (!keep(e)) e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.state !== 'dead'); },
    /** World point -> screen point (what Game.onTargetConfirm / a tap expects). */
    screenOf(p) { const g = window.game; return { x: p.x - g.cam.x + 640, y: p.y - g.cam.y + 360 }; },
    /** FNV hash of the units, projectiles and objective states: equal hashes = the same simulation. */
    hash() {
      const g = window.game, m = g.mission, r = (x) => Math.round(x * 1000);
      const u = (x) => [r(x.pos.x), r(x.pos.y), r(x.hp), x.state, r(x.aim), r(x.fireCooldown), x.ability ? [r(x.ability.cooldownLeft), x.ability.charges] : 0, x.shots, x.hits, r(x.dealt)];
      const st = JSON.stringify([r(g.time), g.phase, m.phase, g.soldiers.map(u), g.npcs.map(u), g.enemies.map(u), g.projectiles.map((p) => [r(p.pos.x), r(p.pos.y), r(p.damage)]), g.grenades.length, m.primaries.map((o) => o.state), m.optionals.map((o) => o.state)]);
      let h = 2166136261; for (let i = 0; i < st.length; i++) { h ^= st.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    },
  };
}

/** Page-side: every CFG group and every playable mission (map, spawned enemies, objectives, extraction, campaign row) as strings. */
function missionSnapshot() {
  const C = window.__CFG, g = window.game, out = { cfg: {}, missions: {} };
  for (const k of Object.keys(C).sort()) out.cfg[k] = JSON.stringify(C[k]);
  window.__debugUnlockAll();
  for (const d of window.__campaign.CAMPAIGN.filter((x) => x.playable)) {
    g.selectMission(d.id, true); g.reset(['infantry', 'heavy', 'medic']);
    const m = g.mission;
    out.missions[d.id] = JSON.stringify({
      map: m.map.obstacles.length + ':' + m.map.w + 'x' + m.map.h,
      enemies: g.enemies.map((e) => `${e.kind}:${e.tag}:${e.maxHp}:${e.structure || ''}:${Math.round(e.pos.x)},${Math.round(e.pos.y)}`).sort(),
      obj: m.primaries.map((o) => o.id + ':' + o.label), opt: m.optionals.map((o) => o.id), triggers: m.script.triggers.map((t) => t.id),
      zone: JSON.stringify(m.script.extraction.zone), cd: m.script.extraction.countdown(), general: JSON.stringify(m.script.general || null),
      lockdown: JSON.stringify(m.script.lockdown || null), story: JSON.stringify(m.script.story || null), def: JSON.stringify({ ...d, brief: undefined }),
    });
  }
  return out;
}

/** A fresh page on `url` (empty save, or `save` as the raw minisquad.save), optional seed, window.T installed, game booted. */
async function openPage(browser, url, { seed = null, save = null, viewport = { width: 1280, height: 720 }, context = {} } = {}) {
  const ctx = await browser.newContext({ viewport, ...context });
  if (seed !== null) await ctx.addInitScript(seedRandom, seed);
  await ctx.addInitScript(installPageHelpers);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(url); await page.evaluate((raw) => { localStorage.clear(); if (raw) localStorage.setItem('minisquad.save', raw); }, save);
  await page.goto(url); await page.waitForFunction(() => !!window.game);
  return page;
}

module.exports = { RESULT_TAG, URL, BASE, OUT, loadPlaywright, get chromium() { return loadPlaywright().chromium; }, createChecks, emitResult, parseResult, runSuite, serveDir,
  seedRandom, installPageHelpers, missionSnapshot, openPage };
