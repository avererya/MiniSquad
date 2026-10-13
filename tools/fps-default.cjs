// v0.6.4 default frame cap: 30 FPS on mobile, 60 on desktop; an explicit Settings pick is kept.
// Checks the active cap, what Settings → Performance shows, frames actually drawn (real frame
// loop on a synthetic 120 Hz display), stored preferences (v2 and the v0.6.3 format) and that
// the save is never touched. PASS/FAIL per check, exit 1 on any failure.
//   npx vite preview --port 4173 &  node tools/fps-default.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = process.env.URL || 'http://localhost:4173/';
const KEY = 'minisquad.dev.perf';

const DESKTOP = { viewport: { width: 1280, height: 720 } };
const MOBILE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const ANDROID = { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' };

function shim() {
  let q = [], now = 1000;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.__drive = (ms, hz) => { let n = 0; const end = now + ms; while (now < end) { now += 1000 / hz; const cbs = q; q = []; window.__tick = n; for (const cb of cbs) cb(now); n++; } return n; };
}

/** Opens the game with `stored` (string or null) in the perf key; returns the page. */
async function open(browser, ctxOpts, stored, query = '') {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.addInitScript(shim);
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.clear(); if (v !== null) localStorage.setItem(k, v); } }, [KEY, stored]);
  await page.goto(URL + query);
  await page.waitForFunction(() => !!window.game);
  return page;
}

/** Active cap, Settings display, frames drawn in 1 s of play at 120 Hz, stored value. */
async function probe(page) {
  return page.evaluate(() => {
    const g = window.game, s = window.__perf.settings();
    window.__hud.toggleTuning();
    const sel = document.querySelector('#tuning select[data-k="fps"]'), note = document.querySelector('#tuning [data-k="fpsnote"]');
    const shown = { value: sel.value, text: sel.options[sel.selectedIndex].text, note: note.textContent, overlay: document.querySelector('#tuning input[data-k="perfov"]').checked };
    window.__hud.toggleTuning();
    window.__debugUnlockAll();
    g.selectMission('first-contact', true);
    g.deploy(['ace', 'ranger'].map((id) => g.roster.get(id)), 'temp');
    let draws = 0;
    const di = CanvasRenderingContext2D.prototype.drawImage;
    let last = -1; // v0.8B.1: the ground is drawn in strips; one count per frame-loop tick
    CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (a.length === 9 && window.__tick !== last) { last = window.__tick; draws++; } return di.apply(this, a); };
    window.__drive(200, 120); draws = 0; window.__drive(1000, 120);
    CanvasRenderingContext2D.prototype.drawImage = di;
    return { cap: s.fpsCap, overlay: s.overlay, shown, draws, stored: localStorage.getItem('minisquad.dev.perf'), coarse: matchMedia('(pointer: coarse)').matches };
  });
}

(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  const check = (name, ok, detail) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(86)} ${detail ?? ''}`); };
  const near = (n, f) => Math.abs(n - f) <= 1;

  // 1. defaults, nothing stored
  let p = await open(browser, DESKTOP, null); let r = await probe(p);
  check('desktop, no preference: 60 FPS, Settings shows "60 FPS (default)", ~60 frames/s drawn', r.cap === 60 && r.shown.value === '60' && r.shown.text === '60 FPS (default)' && /desktop default/.test(r.shown.note) && near(r.draws, 60) && !r.coarse, JSON.stringify(r));
  check('desktop: nothing written to storage just by playing', r.stored === null, String(r.stored));
  await p.context().close();
  p = await open(browser, MOBILE, null); r = await probe(p);
  check('iPhone, no preference: 30 FPS, Settings shows "30 FPS (default)", ~30 frames/s drawn', r.cap === 30 && r.shown.value === '30' && r.shown.text === '30 FPS (default)' && /mobile default/.test(r.shown.note) && near(r.draws, 30) && r.coarse, JSON.stringify(r));
  await p.context().close();
  p = await open(browser, ANDROID, null); r = await probe(p);
  check('Android, no preference: 30 FPS, ~30 frames/s drawn', r.cap === 30 && r.shown.value === '30' && near(r.draws, 30), JSON.stringify(r));
  await p.context().close();

  // 2. explicit picks (v2) win on every device
  p = await open(browser, MOBILE, JSON.stringify({ v: 2, fpsCap: 60, overlay: false })); r = await probe(p);
  check('iPhone, saved pick 60: stays 60, Settings shows "60 FPS" (your choice), ~60 frames/s', r.cap === 60 && r.shown.value === '60' && r.shown.text === '60 FPS' && /your choice/.test(r.shown.note) && near(r.draws, 60), JSON.stringify(r));
  await p.context().close();
  p = await open(browser, DESKTOP, JSON.stringify({ v: 2, fpsCap: 30, overlay: false })); r = await probe(p);
  check('desktop, saved pick 30: stays 30, Settings shows "30 FPS" (your choice), ~30 frames/s', r.cap === 30 && r.shown.value === '30' && /your choice/.test(r.shown.note) && near(r.draws, 30), JSON.stringify(r));
  await p.context().close();

  // 3. v0.6.3 stored format
  p = await open(browser, MOBILE, JSON.stringify({ fpsCap: 30, overlay: false })); r = await probe(p);
  check('iPhone, v0.6.3 stored 30 (a deliberate pick): kept as the player\'s choice', r.cap === 30 && /your choice/.test(r.shown.note), JSON.stringify(r));
  await p.context().close();
  p = await open(browser, MOBILE, JSON.stringify({ fpsCap: 60, overlay: true })); r = await probe(p);
  check('iPhone, v0.6.3 stored 60 (old default, written with the overlay): 30 default, overlay kept on', r.cap === 30 && /mobile default/.test(r.shown.note) && r.overlay === true && r.shown.overlay === true, JSON.stringify(r));
  await p.context().close();
  p = await open(browser, DESKTOP, JSON.stringify({ fpsCap: 60, overlay: false })); r = await probe(p);
  check('desktop, v0.6.3 stored 60: 60 FPS (desktop default unchanged)', r.cap === 60, JSON.stringify(r));
  await p.context().close();
  p = await open(browser, MOBILE, '{not json'); r = await probe(p);
  check('iPhone, corrupt preference: falls back to the 30 default, no errors', r.cap === 30, JSON.stringify(r));
  await p.context().close();

  // 4. picking in Settings saves the pick, survives reload; overlay alone never saves a cap
  p = await open(browser, MOBILE, null);
  const saveBefore = await p.evaluate(() => localStorage.getItem(window.__SAVE_KEY));
  await p.evaluate(() => { window.__hud.toggleTuning(); const s = document.querySelector('#tuning select[data-k="fps"]'); s.value = '60'; s.dispatchEvent(new Event('change')); });
  const saveMid = await p.evaluate(() => localStorage.getItem(window.__SAVE_KEY));
  check('the save (minisquad.save) is not touched by picking a frame cap', saveBefore === saveMid && saveBefore !== null, '');
  let picked = await p.evaluate(() => ({ cap: window.__perf.settings().fpsCap, note: document.querySelector('#tuning [data-k="fpsnote"]').textContent, stored: localStorage.getItem('minisquad.dev.perf') }));
  check('iPhone: selecting 60 in Settings applies at once and stores {v:2,fpsCap:60}', picked.cap === 60 && /60 FPS \(your choice\)/.test(picked.note) && JSON.parse(picked.stored).fpsCap === 60 && JSON.parse(picked.stored).v === 2, JSON.stringify(picked));
  await p.reload(); await p.waitForFunction(() => !!window.game); r = await probe(p);
  check('iPhone: the 60 pick survives a reload', r.cap === 60 && r.shown.value === '60' && near(r.draws, 60), JSON.stringify(r));
  await p.context().close();
  p = await open(browser, MOBILE, null);
  await p.evaluate(() => { window.__hud.toggleTuning(); const b = document.querySelector('#tuning input[data-k="perfov"]'); b.checked = true; b.dispatchEvent(new Event('change')); });
  const st = JSON.parse(await p.evaluate(() => localStorage.getItem('minisquad.dev.perf')));
  check('toggling the overlay stores no frame cap (the device default keeps applying)', st.v === 2 && !('fpsCap' in st) && st.overlay === true, JSON.stringify(st));
  await p.context().close();

  // 5. URL override (testing) is shown and not stored
  p = await open(browser, MOBILE, null, '?fps=60'); r = await probe(p);
  check('iPhone ?fps=60: active 60, Settings shows the URL override, nothing stored', r.cap === 60 && r.shown.value === '60' && /URL/.test(r.shown.note) && r.stored === null, JSON.stringify(r));
  await p.context().close();

  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
