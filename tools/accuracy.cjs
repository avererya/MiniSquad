// v0.7D.1 ACCURACY SOFT FLOOR + TOP-BUTTON TOUCH AREAS: acceptance checks against a served build (headless Chromium).
//
//   npm run build && npx vite preview --port 4173 &  node tools/accuracy.cjs
//   BASE=http://localhost:4174/   a v0.7D build: unchanged-cone (bit-identical), no-loss and unchanged-table checks
//                                 compare against it, and the desktop top-button layout must match it
//   OUT=dir                       screenshots (Training / Squad Training previews, HUD top buttons on three phones)
//
//  A. Spread pipeline: every Individual and Squad Accuracy rank improves the standing AND moving cone up to rank 10
//     (every class, Sharpshooter / Eagle Eye / Dead Calm, Elite 30 Infantry / Heavy), standing never below 1°,
//     moving > standing, cones >= 1.5° bit-identical to v0.7D, nobody loses more than 0.2° standing, no moving
//     penalty above v0.7D, no hit-chance loss > 3.5 pts (math, still Rifleman; worst is a Dead Calm Sniper moving), tables / prices / floor unchanged.
//  B. Previews: Training and Squad Training show a non-zero standing + moving gain at the top ranks, matching the pipeline.
//  C. Combat: a deployed soldier's cone is the effective stat (standing and at full speed).
//  D. Mobile HUD: mute / pause / settings touch areas >= 44 x 44 CSS px on iPhone SE / 14 / Pixel 7, no overlap with
//     each other or the objective box (all ten missions), timer, support buttons, panels, warnings; taps on the
//     enlarged edge work; visible buttons unchanged; desktop layout identical to v0.7D.
// PASS/FAIL per check; exits 1 on any failure.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const OUT = process.env.OUT || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'v0.7C-save.json'), 'utf8');
const CLS = ['infantry', 'heavy', 'medic', 'sniper'];
const MISSIONS = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home', 'bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist'];

/** In page: standing / moving-penalty for every class x variant x Individual 0-10 x Squad 0-10. */
function grid() {
  const P = window.__progression, EL = window.__elite, eff = window.__effectiveStats;
  const variants = [['plain', null, null], ['sharpshooter', 'sharpshooter', null], ['eagleEye', 'eagleEye', null], ['deadCalm', 'deadCalm', null], ['elite-inf', null, 'inf-recon'], ['elite-hvy', null, 'hvy-weapons']];
  const out = {};
  for (const cls of ['infantry', 'heavy', 'medic', 'sniper']) for (const [vn, trait, spec] of variants) {
    if (spec && !EL.isSpecFor(spec, cls)) continue;
    const prog = spec
      ? { level: 25, xp: P.xpForLevel(25), upgrades: [], specialization: spec, tier: 'elite', elitePath: spec, eliteLevel: 30, eliteXp: EL.eliteXpForLevel(30) }
      : { level: 25, xp: P.xpForLevel(25), upgrades: [], specialization: null, tier: 'recruit', elitePath: null, eliteLevel: 0, eliteXp: 0 };
    const rows = [];
    for (let ti = 0; ti <= 10; ti++) for (let si = 0; si <= 10; si++) {
      const s = { classId: cls, traitId: trait, mods: {}, progression: prog, training: { ...P.newTraining(), accuracy: ti } };
      const e = eff(s, { level: 25, training: s.training, squad: { ...P.newSquadTraining(), accuracy: si } });
      rows.push([ti, si, e.accuracy, e.movePenalty]);
    }
    out[`${cls}/${vn}`] = rows;
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(104)} ${String(detail).replace(/\s+/g, ' ').slice(0, 400)}`); };
  const fresh = async (p = page, url = URL, raw = null) => {
    await p.goto(url); await p.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await p.goto(url); await p.waitForFunction(() => !!window.game); await p.waitForTimeout(50);
  };
  let basePage = null;
  if (BASE) { const bctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); basePage = await bctx.newPage(); await fresh(basePage, BASE); }

  // ================= A. SPREAD PIPELINE =================
  await fresh();
  const G = await page.evaluate(grid);
  const B = basePage ? await basePage.evaluate(grid) : null;
  const at = (rows, ti, si) => rows[ti * 11 + si];
  const keys = Object.keys(G);
  // A1 every rank improves (standing and moving), up to rank 10, both tracks, whatever the other track is
  let minStand = 1e9, minMove = 1e9, worstS = '', worstM = '', mono = true;
  for (const k of keys) for (let o = 0; o <= 10; o++) for (let r = 1; r <= 10; r++) {
    for (const [a, b] of [[at(G[k], r - 1, o), at(G[k], r, o)], [at(G[k], o, r - 1), at(G[k], o, r)]]) {
      const ds = a[2] - b[2], dm = a[2] + a[3] - b[2] - b[3];
      if (!(ds > 1e-9) || !(dm > 1e-9)) mono = false;
      if (ds < minStand) { minStand = ds; worstS = `${k} I${b[0]}/S${b[1]}`; }
      if (dm < minMove) { minMove = dm; worstM = `${k} I${b[0]}/S${b[1]}`; }
    }
  }
  check('A1 every Individual and Squad Accuracy rank (1-10, at every rank of the other track) narrows the standing AND moving cone; all classes, traits, Elite 30', mono, `smallest standing step ${minStand.toFixed(4)}° (${worstS}), smallest moving step ${minMove.toFixed(4)}° (${worstM}); ${keys.length} soldier types x 121 combos`);
  const flat = keys.flatMap((k) => G[k].map((r) => [k, ...r]));
  const lowS = Math.min(...flat.map((r) => r[3])), minRatio = Math.min(...flat.map((r) => (r[3] + r[4]) / r[3]));
  check('A2 standing cone never below the 1° floor (never reaches it either); moving penalty > 0, moving cone > standing', flat.every((r) => r[3] > 1 && r[4] > 0) && minRatio > 1, `lowest standing ${lowS.toFixed(4)}°, lowest moving/standing ratio ${minRatio.toFixed(3)}`);
  const pick = (k, ti, si) => { const r = at(G[k], ti, si); return `${r[2].toFixed(2)}/${(r[2] + r[3]).toFixed(2)}`; };
  const keyVals = { inf: pick('infantry/plain', 10, 10), hvy8: pick('heavy/plain', 10, 8), hvy: pick('heavy/plain', 10, 10), med: pick('medic/plain', 10, 10), snp: pick('sniper/plain', 10, 10), snp2: pick('sniper/plain', 10, 2), inf55: pick('infantry/plain', 5, 5), raw: pick('infantry/plain', 0, 0) };
  check('A3 approved values: max-trained Infantry 1.01/1.79, Heavy 1.01/1.86 (I10/S8 1.17/2.80), Medic 1.01/1.95, Sniper 1.02/4.56 (I10/S2 1.17/7.26); untrained and I5/S5 unchanged',
    keyVals.inf === '1.01/1.79' && keyVals.hvy === '1.01/1.86' && keyVals.hvy8 === '1.17/2.80' && keyVals.med === '1.01/1.95' && keyVals.snp === '1.02/4.56' && keyVals.snp2 === '1.17/7.26' && keyVals.raw === '12.00/30.00' && keyVals.inf55 === '5.87/14.67', JSON.stringify(keyVals));
  if (B) {
    let same = 0, kept = 0, worse = 0, maxUpS = 0, maxUpMP = 0, maxLoss = 0, lossAt = '';
    const P = (cone, d) => Math.min(1, (2 * Math.asin(14 / d) * 180) / Math.PI / cone);
    for (const k of keys) for (let i = 0; i < 121; i++) {
      const n = G[k][i], b = B[k][i];
      if (b[2] >= 1.5) { kept++; if (n[2] === b[2] && n[3] === b[3]) same++; }
      maxUpS = Math.max(maxUpS, n[2] - b[2]); maxUpMP = Math.max(maxUpMP, n[3] - b[3]);
      if (n[2] > b[2] + 1e-9) worse++;
      for (const d of k.startsWith('sniper') ? [150, 300, 540] : [150, 300, 400]) for (const mv of [0, 1]) {
        const l = P(b[2] + mv * b[3], d) - P(n[2] + mv * n[3], d);
        if (l > maxLoss) { maxLoss = l; lossAt = `${k} I${n[0]}/S${n[1]} ${mv ? 'moving' : 'standing'} @${d}`; }
      }
    }
    check('A4 bit-identical to v0.7D wherever the v0.7D standing cone is >= 1.5° (untrained, early and mid builds)', same === kept && kept > 0, `${same}/${kept} identical`);
    check('A5 no loss vs v0.7D: standing at most +0.2° (near-floor builds only), moving penalty never larger, hit chance vs a still Rifleman never > 3.5 pts lower (math; worst case is a Dead Calm Sniper moving, 3.0 pts)', maxUpS <= 0.2 && maxUpMP <= 1e-9 && maxLoss <= 0.035,
      `${worse} builds wider standing, max +${maxUpS.toFixed(3)}°; max move-penalty change ${maxUpMP.toFixed(4)}°; worst hit loss ${(maxLoss * 100).toFixed(2)} pts (${lossAt})`);
    const tabs = async (p) => p.evaluate(() => { const P = window.__progression; return JSON.stringify({ t: P.TRAINING, s: P.SQUAD_TRAINING, f: P.PROGRESSION.spreadFloorDeg, cfg: ['infantry', 'heavy', 'medic', 'sniper'].map((c) => [window.__CFG[c].accuracy, window.__CFG[c].movePenalty]) }); });
    check('A6 training tables, prices, rank counts, the 1° floor and class base spreads identical to v0.7D', (await tabs(page)) === (await tabs(basePage)), '');
  } else check('A4-A6 v0.7D comparisons', false, 'BASE not set');
  const consts = await page.evaluate(() => ({ w: window.__progression.PROGRESSION.spreadSoftness, sh: window.__progression.PROGRESSION.moveFloorShare, f: window.__progression.PROGRESSION.spreadFloorDeg }));
  check('A7 constants: soft-floor width 0.5°, moving-floor share 0.5, floor 1°', consts.w === 0.5 && consts.sh === 0.5 && consts.f === 1, JSON.stringify(consts));
  // tuned bases at / under the floor: never above the class cone, never rising with a rank
  const tuned = await page.evaluate(() => {
    const P = window.__progression, C = window.__CFG.infantry, keep = [C.accuracy, C.movePenalty], out = {};
    for (const b of [0.8, 1.2, 2]) {
      C.accuracy = b;
      const s = { classId: 'infantry', traitId: null, mods: {}, progression: { level: 1, xp: 0, upgrades: [], specialization: null, tier: 'recruit', elitePath: null, eliteLevel: 0, eliteXp: 0 }, training: P.newTraining() };
      out[b] = Array.from({ length: 11 }, (_, r) => { const e = window.__effectiveStats(s, { level: 1, training: { ...P.newTraining(), accuracy: r }, squad: { ...P.newSquadTraining(), accuracy: r } }); return +e.accuracy.toFixed(4); });
    }
    [C.accuracy, C.movePenalty] = keep;
    return out;
  });
  const tunedOk = Object.entries(tuned).every(([b, row]) => row[0] === +b && row.every((v, i) => v <= +b + 1e-9 && v >= Math.min(1, +b) - 1e-9 && (i === 0 || v <= row[i - 1] + 1e-9)));
  check('A8 tuning-panel bases at / under the floor (0.8°, 1.2°, 2°): untrained = base, never above it, never below min(1°, base), never widening', tunedOk, JSON.stringify(tuned));
  // genuine v0.7C save: loads, ranks kept, nothing migrated
  await fresh(page, URL, FIXTURE);
  const ld = await page.evaluate(() => ({ st: window.__loadStatus?.status ?? window.__loadStatus, notes: window.__loadStatus?.notes ?? [], sq: window.__account().squadTraining, tr: window.game.roster.soldiers.map((s) => s.training.accuracy).join(), v: JSON.parse(localStorage.getItem(window.__SAVE_KEY)).version }));
  const fx = JSON.parse(FIXTURE);
  check('A9 genuine v0.7C save loads unchanged: save v9, squad + individual accuracy ranks kept, no repair notes (no migration needed)', JSON.stringify(ld.sq) === JSON.stringify(fx.account.squadTraining) && ld.tr === fx.roster.map((s) => s.training.accuracy).join() && ld.v === 9 && (!ld.notes || ld.notes.length === 0), JSON.stringify(ld));

  // ================= B. PREVIEWS =================
  await fresh();
  await page.evaluate(() => { window.__debugUnlockAll(); const a = window.__account(); a.credits = 50000; a.squadTraining = { hp: 0, damage: 0, accuracy: 10, fireRate: 0 }; window.game.roster.get('ace').training.accuracy = 9; window.game.toBarracks(); });
  await page.waitForTimeout(100);
  await page.click('[data-a="tab"][data-tab="training"]'); await page.waitForTimeout(120);
  const tv = await page.evaluate(() => {
    const row = document.querySelector('.t-row[data-stat="accuracy"]'), s = window.game.roster.get('ace'), P = window.__progression, a = window.__account();
    const cur = window.__effectiveStats(s), nxt = window.__effectiveStats(s, { level: s.progression.level, training: { ...s.training, accuracy: 10 }, squad: a.squadTraining });
    return { txt: row.querySelector('.t-val').textContent.replace(/\s+/g, ' ').trim(), foot: document.querySelector('.t-foot')?.textContent ?? '', cur: [cur.accuracy, cur.accuracy + cur.movePenalty], nxt: [nxt.accuracy, nxt.accuracy + nxt.movePenalty] };
  });
  if (OUT) await page.screenshot({ path: path.join(OUT, 'training-accuracy-preview.png') });
  const r2 = (v) => String(Math.round(v * 100) / 100);
  const gainS = Math.round((tv.cur[0] - tv.nxt[0]) * 1000) / 1000, gainM = Math.round((tv.cur[1] - tv.nxt[1]) * 1000) / 1000;
  check('B1 Training, Ace at Individual 9 / Squad 10: rank 10 preview shows real standing/moving values and a non-zero gain for both (was "−0° spread" in v0.7D)',
    tv.txt.includes(`${r2(tv.cur[0])}°/${r2(tv.cur[1])}°`) && tv.txt.includes(`${r2(tv.nxt[0])}°/${r2(tv.nxt[1])}°`) && gainS > 0 && gainM > 0 && tv.txt.includes(`−${gainS}° / −${r2(gainM)}° moving spread`), tv.txt);
  check('B2 Training footer explains the taper (floor tapers off but never stops; never below 1°)', /tapers off but never stops/.test(tv.foot) && /never goes below 1°/.test(tv.foot), tv.foot.slice(0, 200));
  await page.evaluate(() => { const a = window.__account(); a.squadTraining.accuracy = 9; window.game.roster.get('ace').training.accuracy = 10; window.game.ui.menus.trainId = 'ace'; });
  await page.click('[data-a="tab"][data-tab="squad"]'); await page.waitForTimeout(120);
  const qv = await page.evaluate(() => ({ ex: document.querySelector('.q-row[data-stat="accuracy"] .q-ex')?.textContent.replace(/\s+/g, ' ').trim() ?? '', foot: document.querySelector('.q-panel .t-foot')?.textContent ?? '' }));
  if (OUT) await page.screenshot({ path: path.join(OUT, 'squad-training-accuracy-preview.png') });
  const qm = /: ([\d.]+)°\/([\d.]+)° → ([\d.]+)°\/([\d.]+)° \(−([\d.]+)° \/ −([\d.]+)° moving spread\)/.exec(qv.ex);
  check('B3 Squad Training, Squad Accuracy 9 -> 10 with a max-trained soldier: example shows the real before -> after and a non-zero standing + moving gain (v0.7D: no change)', !!qm && +qm[1] > +qm[3] && +qm[2] > +qm[4] && +qm[5] > 0 && +qm[6] > 0 && /tapers off but never stops/.test(qv.foot), qv.ex);

  // ================= C. COMBAT =================
  await fresh();
  const cone = await page.evaluate(() => {
    const g = window.game; window.__debugUnlockAll(); window.__account().squadTraining.accuracy = 10;
    const ace = g.roster.get('ace'); ace.training.accuracy = 10;
    g.selectMission('first-contact', true); const r = g.deploy([ace], 'temp'); if (!r.ok) return { err: r.reason };
    const u = g.soldiers[0], e = window.__effectiveStats(ace);
    const still = u.cone; u.moveFrac = 1; const moving = u.cone; u.moveFrac = 0;
    return { still, moving, acc: e.accuracy, mp: e.movePenalty };
  });
  check('C1 deployed max-trained soldier: combat cone = effective standing (still) and standing + penalty (full speed)', !cone.err && Math.abs(cone.still - cone.acc) < 1e-9 && Math.abs(cone.moving - cone.acc - cone.mp) < 1e-9 && cone.moving > cone.still, JSON.stringify(cone));

  // ================= D. MOBILE HUD: mute / pause / settings =================
  const devices = [
    ['iphone-se', { viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['iphone-14', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['pixel-7', { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true }],
    ['desktop', { viewport: { width: 1280, height: 720 } }],
  ];
  const measure = () => {
    const q = (s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
    const area = (el) => {
      const r = el.getBoundingClientRect();
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let y = r.top - 40; y <= r.bottom + 40; y += 0.5) for (let x = r.left - 40; x <= r.right + 40; x += 0.5) { const h = document.elementFromPoint(x, y); if (h && (h === el || el.contains(h))) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
      return { vis: { x: r.left, y: r.top, w: r.width, h: r.height }, box: { x: minX, y: minY, w: maxX - minX + 0.5, h: maxY - minY + 0.5 } };
    };
    const btns = [...document.querySelectorAll('#topbtns button')].map((b) => ({ a: b.dataset.a, ...area(b) }));
    return { btns, obj: q('#objective'), timer: q('#timer'), support: q('#support'), panels: q('#panels'), hint: q('#hint'), vw: innerWidth, vh: innerHeight };
  };
  let deskNow = null;
  for (const [name, opts] of devices) {
    const c = await browser.newContext(opts);
    const p = await c.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await fresh(p);
    const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w - 0.25 && b.x < a.x + a.w - 0.25 && a.y < b.y + b.h - 0.25 && b.y < a.y + a.h - 0.25;
    let worstObj = null, objClear = true, objNote = '';
    let m0 = null;
    for (const mid of MISSIONS) {
      await p.evaluate((id) => { const g = window.game; window.__debugUnlockAll(); const a = window.__account(); a.support = { nukes: 1, purchased: 1, launched: 0 }; g.selectMission(id, true); const ids = g.roster.owned().slice(0, 6); const r = g.deploy(ids, 'temp'); if (!r.ok) throw new Error(r.reason); }, mid);
      await p.waitForTimeout(120);
      const m = await p.evaluate(measure);
      if (!m0) m0 = m;
      for (const b of m.btns) if (overlap(b.box, m.obj)) { objClear = false; objNote = `${mid}: ${b.a} overlaps objective`; }
      if (m.obj && (!worstObj || m.obj.x + m.obj.w > worstObj.x + worstObj.w)) worstObj = { ...m.obj, mid };
      await p.evaluate(() => window.game.toBarracks());
    }
    // full check on Iron Fist (boss bar, support buttons, six-soldier panels)
    await p.evaluate(() => { const g = window.game; g.selectMission('iron-fist', true); g.deploy(g.roster.owned().slice(0, 6), 'temp'); });
    await p.waitForTimeout(150);
    const m = await p.evaluate(measure);
    const boxes = m.btns.map((b) => b.box);
    const pairwise = !overlap(boxes[0], boxes[1]) && !overlap(boxes[1], boxes[2]) && !overlap(boxes[0], boxes[2]);
    const others = { timer: m.timer, support: m.support, panels: m.panels, hint: m.hint };
    const clearOthers = Object.entries(others).filter(([, o]) => boxes.some((b) => overlap(b, o))).map(([k]) => k);
    // the abandonment warning and the nuke confirmation (shown briefly to measure them)
    const pop = await p.evaluate(() => { const out = {}; for (const id of ['xwarn', 'nkbox']) { const e = document.getElementById(id), d = e.style.display; e.style.display = 'block'; const r = e.getBoundingClientRect(); out[id] = { x: r.left, y: r.top, w: r.width, h: r.height }; e.style.display = d; } return out; });
    const clearPop = Object.values(pop).every((o) => boxes.every((b) => !overlap(b, o)));
    const onScreen = boxes.every((b) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= m.vw + 0.5 && b.y + b.h <= m.vh + 0.5);
    const big = opts.hasTouch ? boxes.every((b) => b.w >= 44 && b.h >= 44) : true;
    const sz = m.btns.map((b) => `${b.a} ${b.vis.w.toFixed(1)}→${b.box.w.toFixed(1)}x${b.box.h.toFixed(1)}`).join(', ');
    check(`D1 ${name}: mute / pause / settings touch areas ${opts.hasTouch ? '≥ 44x44 CSS px' : '≥ the visible button'}, on screen, not overlapping each other`, big && onScreen && pairwise && m.btns.every((b) => b.box.w >= b.vis.w - 0.5 && b.box.h >= b.vis.h - 0.5), sz);
    check(`D2 ${name}: touch areas clear of the objective box in all ten missions (widest: ${worstObj?.mid}), timer, support buttons, soldier panels, hint, warnings`, objClear && clearOthers.length === 0 && clearPop, `${objNote}${clearOthers.join(',')} widest objective right edge ${worstObj ? (worstObj.x + worstObj.w).toFixed(1) : '-'} vs touch areas from ${Math.min(...boxes.map((b) => b.x)).toFixed(1)}; popups ${JSON.stringify(Object.fromEntries(Object.entries(pop).map(([k, v]) => [k, Math.round(v.y)])))}`);
    // taps on the enlarged edge (outside the visible button on phones)
    const tapAt = async (b, fx, fy) => { const x = b.box.x + b.box.w * fx, y = b.box.y + b.box.h * fy; if (opts.hasTouch) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y); await p.waitForTimeout(80); };
    const bt = Object.fromEntries(m.btns.map((b) => [b.a, b]));
    const st = () => p.evaluate(() => ({ paused: window.game.paused, mute: document.querySelector('[data-a="mute"]').textContent, tune: !document.getElementById('tuning').classList.contains('hidden') }));
    const s0 = await st();
    await tapAt(bt.pause, 0.5, 0.06); const s1 = await st();
    await tapAt(bt.pause, 0.5, 0.5); const s2 = await st();
    await tapAt(bt.mute, 0.04, 0.5); const s3 = await st();
    await tapAt(bt.mute, 0.5, 0.5); const s4 = await st();
    await tapAt(bt.tune, 0.96, 0.94); const s5 = await st();
    await p.evaluate(() => window.game.ui.toggleTuning()); const s6 = await st();
    const tapsOk = !s0.paused && s1.paused && !s2.paused && s3.mute !== s0.mute && s4.mute === s0.mute && s5.tune && !s6.tune;
    check(`D3 ${name}: tapping the edge of each enlarged area works (pause on/off, mute on/off, settings opens) and only that button reacts`, tapsOk && errs.length === 0, JSON.stringify([s0, s1, s2, s3, s4, s5]).slice(0, 300));
    const visOk = m.btns.every((b) => Math.abs(b.vis.w - b.vis.h) < 0.5) && (opts.hasTouch ? m.btns.every((b) => b.vis.w < 30) : m.btns.every((b) => Math.abs(b.vis.w - 44) < 0.5));
    check(`D4 ${name}: visible buttons unchanged (44 stage px, square)`, visOk, m.btns.map((b) => b.vis.w.toFixed(1)).join(' / '));
    if (name === 'desktop') deskNow = m.btns.map((b) => [b.vis.x, b.vis.y, b.vis.w].map((v) => v.toFixed(1)).join(',')).join(' | ');
    if (OUT) await p.screenshot({ path: path.join(OUT, `${name}-hud-topbuttons.png`) });
    await c.close();
  }
  if (BASE) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await c.newPage(); await fresh(p, BASE);
    await p.evaluate(() => { const g = window.game; window.__debugUnlockAll(); g.selectMission('iron-fist', true); g.deploy(g.roster.owned().slice(0, 6), 'temp'); });
    await p.waitForTimeout(150);
    const baseDesk = await p.evaluate(() => [...document.querySelectorAll('#topbtns button')].map((b) => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.width].map((v) => v.toFixed(1)).join(','); }).join(' | '));
    check('D5 desktop: top buttons at exactly the v0.7D positions and sizes', baseDesk === deskNow, `${deskNow} vs ${baseDesk}`);
    await c.close();
  }
  check('no page errors (main page)', errors.length === 0, errors[0]);
  console.log(`\n${total - fails}/${total} passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
