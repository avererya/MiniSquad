// v0.7D SQUAD TRAINING EXPANSION & MOBILE POLISH: acceptance checks against a served build (headless Chromium).
//
//   npm run build && npx vite preview --port 4173 &  node tools/squad-training.cjs
//   BASE=http://localhost:4174/   a v0.7C build: individual training, XP curves, Credits, enemies, missions,
//                                 support numbers and resurrection prices must match it; the six-Elite
//                                 performance scenario is measured on both builds
//   OUT=dir                       screenshots (Squad Training on three phones, HUD touch areas)
//   QUICK=1                       skips the long runs (Missions 1-10 autopilot, 30 / 60 FPS parity, perf)
//
// Numbers [1-38] refer to the v0.7D brief's test list.
//  A. Rank tables [1-7]          D. Persistence [24-30] (genuine v0.7C save: tools/fixtures/v0.7C-save.json)
//  B. Economy [8-14]             E. Mobile UI + HUD [31-34]
//  C. Stats [15-23]              F. Regression + performance [35-38]
// Six-soldier squads can't be deployed in the live campaign before Mission 13, so the fully upgraded
// six-Elite squad uses the dev harness ('temp' deployment, never rewarded) like tools/support.cjs.
// PASS/FAIL per check; exits 1 on any failure.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const { installPilot } = require('./perf-lib.cjs');
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const OUT = process.env.OUT || '';
const QUICK = !!process.env.QUICK;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'v0.7C-save.json'), 'utf8');

const MISSIONS = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home', 'bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist'];
// the locked v0.7D tables (fractions of the class base; accuracy = spread)
const TABLE = {
  hp: [0, 0.03, 0.07, 0.12, 0.18, 0.25, 0.29, 0.335, 0.385, 0.44, 0.5],
  damage: [0, 0.02, 0.05, 0.09, 0.14, 0.2, 0.23, 0.265, 0.305, 0.35, 0.4],
  accuracy: [0, -0.03, -0.07, -0.12, -0.18, -0.25, -0.29, -0.335, -0.385, -0.44, -0.5],
  fireRate: [0, 0.015, 0.035, 0.06, 0.09, 0.125, 0.145, 0.1675, 0.1925, 0.22, 0.25],
};
const COSTS = [1000, 1500, 2000, 2750, 3500, 4500, 5500, 7000, 8500, 10000];
const V07C = { hp: 0.125, damage: 0.1, accuracy: -0.125, fireRate: 0.0625 }; // v0.7B.1 / v0.7C rank 5

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get R() { return window.game.roster; },
    get P() { return window.__progression; },
    get EL() { return window.__elite; },
    lv(id, level) { const P = window.__progression, p = this.R.get(id).progression; p.xp = P.xpForLevel(level); p.level = P.levelForXp(p.xp); },
    /** Test fixture only (bypasses the economy): an Elite of `spec` at Elite level `el`. */
    spec(id, spec, el = 30) { const p = this.R.get(id).progression; this.lv(id, 25); p.tier = 'elite'; p.elitePath = spec; p.specialization = spec; p.eliteXp = this.EL.eliteXpForLevel(el); p.eliteLevel = el; },
    maxTrain(id) { this.R.get(id).training = { accuracy: 10, damage: 10, hp: 10, fireRate: 10, moveSpeed: 10 }; },
    /** Recruit one more soldier of `cls` through the real Recruitment Office (Credits topped up). */
    hire(cls) {
      const a = this.a, E = this.E;
      if (!a.classUnlocks.unlocked.includes(cls)) { a.classUnlocks.unlocked.push(cls); a.classUnlocks.notified.push(cls); }
      a.recruitment.rosterCap = Math.max(a.recruitment.rosterCap, this.R.soldiers.length + 2);
      E.openOffice(this.R, a, null);
      let o = null; for (let i = 0; i < 400 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === cls); if (!o) { a.credits += 100; E.refreshOffers(this.R, a, null, null); } }
      a.credits += 20000; const r = E.recruit(this.R, a, o.id, null); if (!r.ok) throw new Error(r.reason); return r.soldier;
    },
    /** The fully upgraded six: Elite 30, max individual + squad training, offensive specs, three Heavy Gunners. */
    six() {
      window.__debugUnlockAll();
      const a = this.a; a.squadTraining = { hp: 10, damage: 10, accuracy: 10, fireRate: 10 };
      const h3 = this.R.soldiers.find((s) => s.id.startsWith('rc-') && s.classId === 'heavy') ?? this.hire('heavy');
      const plan = [['ace', 'inf-trooper'], ['havoc', 'hvy-weapons'], ['tank', 'hvy-weapons'], [h3.id, 'hvy-weapons'], ['patch', 'med-commander'], ['ranger', 'inf-recon']];
      for (const [id, sp] of plan) { this.spec(id, sp, 30); this.maxTrain(id); }
      return plan.map(([id]) => id);
    },
    deploySix(mission = 'iron-fist') {
      const ids = this.six(), g = this.g; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'temp'); if (!r.ok) throw new Error(r.reason);
      return ids;
    },
    calm() { const g = window.game; for (const e of g.enemies) if (!e.structure && !e.vehicle && e.kind !== 'boss') e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active); g.input.move = () => ({ x: 0, y: 0 }); },
    foe(x, y, kind = 'rifleman') { const e = window.game.spawnEnemy({ x, y }, kind); return e; },
    step(sec, fn) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (fn) fn(i); window.game.update(1 / 60); } },
    store() { return JSON.parse(localStorage.getItem(window.__SAVE_KEY)); },
  };
}

(async () => {
  const browser = await chromium.launch();
  const _newContext = browser.newContext.bind(browser);
  browser.newContext = async (o) => { const c = await _newContext(o); await c.addInitScript(`window.__pilotInstall = ${installPilot.toString()};`); return c; };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(104)} ${String(detail).replace(/\s+/g, ' ').slice(0, 320)}`); };
  const fresh = async (p = page, url = URL, raw = null) => {
    await p.goto(url); await p.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await p.goto(url); await p.waitForFunction(() => !!window.game); await p.waitForTimeout(50);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

  let basePage = null;
  if (BASE) { const bctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); await bctx.addInitScript(installHelpers); basePage = await bctx.newPage(); await fresh(basePage, BASE); }
  const both = async (fn, arg) => ({ now: await page.evaluate(fn, arg), base: basePage ? await basePage.evaluate(fn, arg) : null });

  // ================= A. RANK TABLES [1-7] =================
  await fresh();
  const tab = await ev(() => {
    const P = window.__progression;
    return { ids: P.SQUAD_TRAINING_IDS, defs: Object.fromEntries(Object.entries(P.SQUAD_TRAINING).map(([k, d]) => [k, { max: P.maxRank(d), bonus: Array.from({ length: 11 }, (_, r) => P.rankBonus(d, r)), raw: d.bonus, costs: d.costs, label: d.label }])), clamp: P.rankBonus(P.SQUAD_TRAINING.damage, 14) };
  });
  check('A1 [1] four categories (HP, Damage, Accuracy, Fire Rate), exactly ten ranks each', tab.ids.join() === 'hp,damage,accuracy,fireRate' && tab.ids.every((k) => tab.defs[k].max === 10 && tab.defs[k].raw.length === 11), tab.ids.map((k) => `${k}:${tab.defs[k].max}`).join(' '));
  const tableOk = tab.ids.every((k) => TABLE[k].every((v, r) => near(tab.defs[k].bonus[r], v)));
  check('A2 [2] every cumulative bonus matches the locked table (ranks 0-10, all four)', tableOk, tab.ids.map((k) => `${k} ${tab.defs[k].bonus.map((x) => +(x * 100).toFixed(2)).join('/')}`).join(' | '));
  check('A3 [3] rank 5: HP +25%, damage +20%, spread -25%, fire rate +12.5% (double v0.7C rank 5)', near(tab.defs.hp.bonus[5], 0.25) && near(tab.defs.damage.bonus[5], 0.2) && near(tab.defs.accuracy.bonus[5], -0.25) && near(tab.defs.fireRate.bonus[5], 0.125) && tab.ids.every((k) => near(tab.defs[k].bonus[5], 2 * V07C[k])), '');
  check('A4 [4] rank 10: HP +50%, damage +40%, spread -50%, fire rate +25%', near(tab.defs.hp.bonus[10], 0.5) && near(tab.defs.damage.bonus[10], 0.4) && near(tab.defs.accuracy.bonus[10], -0.5) && near(tab.defs.fireRate.bonus[10], 0.25), '');
  const incs = Object.fromEntries(tab.ids.map((k) => [k, tab.defs[k].bonus.slice(1).map((v, i) => Math.abs(v - tab.defs[k].bonus[i]))]));
  check('A5 [5] every purchase increases its bonus (all 40 ranks)', tab.ids.every((k) => incs[k].every((d) => d > 1e-9)), '');
  const dmgLate = incs.damage.slice(5).map((d) => +(d * 100).toFixed(4));
  const tierGrow = tab.ids.every((k) => [0, 5].every((s) => incs[k].slice(s, s + 5).every((d, i, arr) => i === 0 || d > arr[i - 1] - 1e-12)));
  check('A6 [6] late ranks meaningful: Damage 6-10 add +3 / +3.5 / +4 / +4.5 / +5 pts; each 5-rank tier grows; ranks 6-10 ≥ +1.5 pts (HP / dmg / spread ≥ +3)', dmgLate.join() === '3,3.5,4,4.5,5' && tierGrow && tab.ids.every((k) => incs[k].slice(5).every((d) => d >= (k === 'fireRate' ? 0.015 : 0.03) - 1e-9)), `damage 6-10: ${dmgLate.join(' / ')}; fire rate 6-10: ${incs.fireRate.slice(5).map((d) => +(d * 100).toFixed(2)).join(' / ')}`);
  const beyond = await ev(() => {
    const a = T.a; a.squadTraining = { hp: 10, damage: 10, accuracy: 10, fireRate: 10 }; a.credits = 1e6;
    const r = ['hp', 'damage', 'accuracy', 'fireRate'].map((k) => T.E.buySquadTraining(a, k, null, null));
    return { r: r.map((x) => x.ok ? 'BOUGHT' : x.reason), cr: a.credits, ranks: Object.values(a.squadTraining).join(), next: window.__progression.nextCost(window.__progression.SQUAD_TRAINING.hp, 10) };
  });
  check('A7 [7] no purchase beyond rank 10 (refused "maxed", no Credits taken); table clamps above 10', beyond.r.every((x) => /maxed/.test(x)) && beyond.cr === 1e6 && beyond.ranks === '10,10,10,10' && beyond.next === null && near(tab.clamp, 0.4), JSON.stringify(beyond));

  // ================= B. ECONOMY [8-14] =================
  check('B1 [8] ranks 1-5 keep their prices (1,000 / 1,500 / 2,000 / 2,750 / 3,500), every category', tab.ids.every((k) => tab.defs[k].costs.slice(0, 5).join() === '1000,1500,2000,2750,3500'), '');
  check('B2 [9] ranks 6-10 cost 4,500 / 5,500 / 7,000 / 8,500 / 10,000', tab.ids.every((k) => tab.defs[k].costs.join() === COSTS.join()), tab.defs.hp.costs.join(' / '));
  const sum = (k) => tab.defs[k].costs.reduce((x, y) => x + y, 0);
  check('B3 [10] total 46,250 CR per category, 185,000 CR for all four', tab.ids.every((k) => sum(k) === 46250) && tab.ids.reduce((s, k) => s + sum(k), 0) === 185000, `${sum('hp')} x 4 = ${tab.ids.reduce((s, k) => s + sum(k), 0)}`);
  await fresh();
  const buy = await ev(() => {
    const a = T.a, E = T.E, out = { steps: [] };
    a.credits = 46250;
    for (let r = 0; r < 10; r++) { const before = a.credits; const x = E.buySquadTraining(a, 'damage', r, window.__persist); out.steps.push([x.ok, before - a.credits, a.squadTraining.damage]); }
    out.after = a.credits;
    a.credits = 4499; a.squadTraining.hp = 5;
    const poor = E.buySquadTraining(a, 'hp', 5, window.__persist);
    out.poor = { ok: poor.ok, reason: poor.reason, cr: a.credits, rank: a.squadTraining.hp };
    const stale = E.buySquadTraining(a, 'hp', 4, window.__persist);
    out.stale = { ok: stale.ok, reason: stale.reason, cr: a.credits };
    a.credits = 4500; const ok6 = E.buySquadTraining(a, 'hp', 5, window.__persist);
    out.ok6 = { ok: ok6.ok, cost: ok6.cost, cr: a.credits, rank: a.squadTraining.hp, saved: T.store().account.squadTraining.hp };
    return out;
  });
  check('B4 [12] every purchase deducts exactly its price (Squad Damage 0 -> 10 spends 46,250 to 0)', buy.steps.every(([ok, spent, rank], i) => ok && spent === COSTS[i] && rank === i + 1) && buy.after === 0, buy.steps.map((s) => s[1]).join(','));
  check('B5 [11][13] insufficient Credits (4,499 for 4,500) refused, nothing deducted; stale rank refused', !buy.poor.ok && /Not enough Credits/.test(buy.poor.reason) && buy.poor.cr === 4499 && buy.poor.rank === 5 && !buy.stale.ok && buy.stale.cr === 4499, JSON.stringify({ poor: buy.poor, stale: buy.stale }));
  check('B6 [12] rank 6 bought with exactly 4,500 -> 0 Credits, rank 6, saved', buy.ok6.ok && buy.ok6.cost === 4500 && buy.ok6.cr === 0 && buy.ok6.rank === 6 && buy.ok6.saved === 6, JSON.stringify(buy.ok6));
  const rewards = await both(() => {
    const P = window.__progression;
    const o = (won, first) => P.computeMissionRewards({ missionId: 'red-canyon', runId: 'r1', won, deployed: [{ id: 'ace', status: 'Standing', downs: 0 }, { id: 'tank', status: 'Downed', downs: 1 }], optional: { total: 1, completed: 1 }, stars: 3 }, first);
    return JSON.stringify({ credits: P.PROGRESSION.credits, first: o(true, true), replay: o(true, false), lost: o(false, false) });
  });
  check('B7 [14] mission Credit rewards unchanged (table + a first clear / replay / defeat settlement) vs v0.7C', !BASE || rewards.now === rewards.base, BASE ? (rewards.now === rewards.base ? 'identical' : 'DIFFERS') : 'no BASE: skipped');

  // ================= C. STATS [15-23] =================
  await fresh();
  const stats = await ev(() => {
    const P = window.__progression, R = T.R, a = T.a, eff = window.__effectiveStats;
    window.__debugUnlockAll();
    T.lv('tank', 17); T.lv('doc', 9); T.spec('havoc', 'hvy-weapons', 30); T.spec('ace', 'inf-trooper', 12);
    R.get('tank').training = { accuracy: 3, damage: 6, hp: 10, fireRate: 2, moveSpeed: 0 };
    const sq = { hp: 7, damage: 9, accuracy: 4, fireRate: 10 };
    const G = P.PROGRESSION.growth, B = P.rankBonus, TR = P.TRAINING, SQ = P.SQUAD_TRAINING;
    const rows = [];
    // every roster soldier: effective = class base x (1 + growth + individual + squad) x trait x Elite level (spread: then the floor)
    for (const s of R.soldiers) {
      a.squadTraining = { ...sq };
      const withSq = eff(s);
      const without = eff(s, { level: s.progression.level, training: s.training, squad: P.newSquadTraining() });
      const base = window.__CFG[s.classId];
      const g = s.progression.level - 1;
      const fWith = { hp: G.hp * g + B(TR.hp, s.training.hp) + B(SQ.hp, sq.hp), damage: G.damage * g + B(TR.damage, s.training.damage) + B(SQ.damage, sq.damage), fireRate: G.fireRate * g + B(TR.fireRate, s.training.fireRate) + B(SQ.fireRate, sq.fireRate) };
      const fWo = { hp: G.hp * g + B(TR.hp, s.training.hp), damage: G.damage * g + B(TR.damage, s.training.damage), fireRate: G.fireRate * g + B(TR.fireRate, s.training.fireRate) };
      const ratio = (k) => withSq[k] / without[k];
      const want = (k) => (1 + fWith[k]) / (1 + fWo[k]);
      rows.push({ id: s.id, cls: s.classId, ok: ['hp', 'damage', 'fireRate'].every((k) => Math.abs(ratio(k) - want(k)) < 1e-5), hp: [without.hp, withSq.hp], baseHp: base.hp });
    }
    // a soldier recruited AFTER the purchases gets the same squad bonus
    const n = T.hire('heavy');
    const nw = eff(n), nwo = eff(n, { level: n.progression.level, training: n.training, squad: P.newSquadTraining() });
    const gN = n.progression.level - 1, base = window.__CFG.heavy;
    const recruitOk = Math.abs(nw.damage / nwo.damage - (1 + G.damage * gN + 0.35) / (1 + G.damage * gN)) < 1e-5 && Math.abs(nw.fireRate / nwo.fireRate - (1 + G.fireRate * gN + 0.25) / (1 + G.fireRate * gN)) < 1e-5;
    // applied once: Level 1, no training, no trait -> exactly base x (1 + squad), however often it is read / deployed
    const plain = { classId: 'infantry', traitId: null, mods: {}, progression: { level: 1, xp: 0, upgrades: [], specialization: null, tier: 'recruit', elitePath: null, eliteLevel: 0, eliteXp: 0 }, training: P.newTraining() };
    a.squadTraining = { hp: 10, damage: 10, accuracy: 10, fireRate: 10 };
    const reads = Array.from({ length: 5 }, () => eff(plain));
    const ci = window.__CFG.infantry;
    const once = reads.every((r) => Math.abs(r.hp - ci.hp * 1.5) < 1e-6 && Math.abs(r.damage - ci.damage * 1.4) < 1e-6 && Math.abs(r.fireRate - ci.fireRate * 1.25) < 1e-6 && Math.abs(r.accuracy - ci.accuracy * 0.5) < 1e-6);
    // deploy -> retry -> redeploy: the unit stats equal the effective stats (no stacking at mission start)
    T.g.selectMission('red-canyon', true);
    const d1 = T.g.deploy([R.get('tank'), R.get('doc'), R.get('ace')], 'roster');
    const u1 = T.g.soldiers.map((u) => [u.maxHp, u.stats.damage, u.stats.fireRate].join());
    T.g.toBarracks(); T.g.selectMission('red-canyon', true); T.g.deploy([R.get('tank'), R.get('doc'), R.get('ace')], 'roster');
    const u2 = T.g.soldiers.map((u) => [u.maxHp, u.stats.damage, u.stats.fireRate].join());
    const e1 = [R.get('tank'), R.get('doc'), R.get('ace')].map((s) => { const e = eff(s); return [e.hp, e.damage, e.fireRate].join(); });
    return { rows, recruitOk, recruit: { id: n.id, lvl: n.progression.level }, once, onceVal: [reads[0].hp, reads[0].damage, reads[0].fireRate, reads[0].accuracy], deployed: d1.ok && u1.join('|') === e1.join('|') && u2.join('|') === e1.join('|') };
  });
  check('C1 [15] squad bonus applies to every roster soldier: (1+growth+training+squad) / (1+growth+training), trait + Elite untouched', stats.rows.length >= 6 && stats.rows.every((r) => r.ok), stats.rows.map((r) => `${r.id}:${r.ok ? 'ok' : 'BAD'}`).join(' '));
  check('C2 [16] a soldier recruited after the purchases gets the same bonuses (Heavy, +35% dmg / +25% fire rate of base)', stats.recruitOk, JSON.stringify(stats.recruit));
  check('C3 [17] applied exactly once: Level 1 untrained Infantry at squad 10/10/10/10 = base x 1.5 HP / x1.4 dmg / x1.25 rate / x0.5 spread, every read; deploy + retry equal', stats.once && stats.deployed, `${stats.onceVal.join(' / ')}; deployed ${stats.deployed}`);
  const curves = await both(() => {
    const P = window.__progression, EL = window.__elite;
    return JSON.stringify({
      ind: Object.fromEntries(Object.entries(P.TRAINING).map(([k, d]) => [k, [d.costs, d.bonus]])),
      lv: Array.from({ length: 26 }, (_, i) => P.xpForLevel(i + 1)), growth: P.PROGRESSION.growth, missionXp: Array.from({ length: 50 }, (_, i) => P.missionXp(i + 1)),
      elite: Array.from({ length: 31 }, (_, i) => EL.eliteXpForLevel(i + 1)), eliteProg: EL.ELITE_PROGRESSION, floor: P.PROGRESSION.spreadFloorDeg,
    });
  });
  check('C4 [18][19] individual training (prices, ranks, tables), Recruit / Elite level curves, growth, mission XP, spread floor unchanged vs v0.7C', !BASE || curves.now === curves.base, BASE ? (curves.now === curves.base ? 'identical' : 'DIFFERS') : 'no BASE: skipped');
  // [20] passives and buffs read the trained stats once: runtime multipliers are the same at squad 0 and squad 10
  await fresh();
  const pas = await ev(() => {
    const g = T.g, out = {};
    const run = (rank) => {
      T.a.squadTraining = { hp: rank, damage: rank, accuracy: rank, fireRate: rank };
      T.deploySix('iron-fist'); g.invuln = true;
      const units = g.soldiers;
      const mul = { rate: [], shot: [], hp: units.map((u) => +(u.maxHp / u.stats.hp).toFixed(6)).join() };
      const seen = new Set(), cap = window.__CFG.elite.maxShotMul ?? 2;
      // the squad fights its way in for 25 s with abilities (Overdrive builds, Rally aura, Suppressive Fire)
      window.__pilotInstall();
      T.step(25, () => {
        window.__pilot.step();
        for (const u of units) if (u.active) mul.rate.push(u.fireRate / u.stats.fireRate);
        for (const p of g.projectiles) if (p.team === 'squad' && !seen.has(p) && p.owner) { seen.add(p); mul.shot.push(p.damage / p.owner.stats.damage); }
      });
      const r = (xs) => [Math.min(...xs), Math.max(...xs)].map((x) => +x.toFixed(4));
      const C = window.__CFG, bound = Math.max(C.pickups.rapidFireMul, C.suppressive.fireRateMul, C.focus?.fireRateMul ?? 1, 1) + C.elite.overdriveMax;
      return { bound, rateOk: mul.rate.every((m) => m >= 1 - 1e-9 && m <= bound + 1e-9), rate: r(mul.rate), shot: r(mul.shot), shots: mul.shot.length, hp: mul.hp, capOk: mul.shot.every((m) => m <= 2 + 1e-9 && m >= 1 - 1e-9), od: units.some((u) => u.elite && u.fireRate / u.stats.fireRate > 1.0001) };
    };
    out.r0 = run(0); g.toBarracks(); out.r10 = run(10);
    return out;
  });
  check('C5 [20] passives / buffs unchanged by squad rank: fire-rate multipliers (Rapid Fire / Suppressive + Overdrive ≤ x2.05) and per-shot multipliers (Rally etc., ≤ x2) same range at squad 0 and 10', pas.r10.capOk && pas.r0.capOk && pas.r10.rateOk && pas.r0.rateOk && pas.r10.shot[1] <= 2 + 1e-9 && pas.r10.shots > 100 && pas.r10.hp === pas.r0.hp, JSON.stringify(pas));
  // [21] floor: max individual + max squad accuracy (-105% of base) -> 1 deg standing, moving penalty kept (scaled, never 0)
  await fresh();
  const floor = await both(() => {
    const P = window.__progression, eff = window.__effectiveStats, C = window.__CFG, out = {};
    window.__debugUnlockAll();
    for (const cls of ['infantry', 'heavy', 'medic', 'sniper']) {
      const s = { classId: cls, traitId: null, mods: {}, progression: { level: 25, xp: 0, upgrades: [], specialization: null, tier: 'recruit', elitePath: null, eliteLevel: 0, eliteXp: 0 }, training: { ...P.newTraining(), accuracy: 10 } };
      const sqMax = P.maxRank(P.SQUAD_TRAINING.accuracy);
      out[cls] = Array.from({ length: sqMax + 1 }, (_, r) => { const e = eff(s, { level: 25, training: s.training, squad: { ...P.newSquadTraining(), accuracy: r } }); return [+e.accuracy.toFixed(4), +e.movePenalty.toFixed(4)]; });
      out[cls + 'Base'] = [C[cls].accuracy, C[cls].movePenalty];
    }
    return out;
  });
  const fl = floor.now;
  // v0.7D.1 soft floors: standing eases into 1° (above it, never below), the moving penalty keeps shrinking (never 0, never above the v0.7D frozen value)
  const floorOk = ['infantry', 'heavy', 'medic', 'sniper'].every((c) => fl[c].every(([a, m]) => a > 1 && m > 0) && fl[c][10][0] < 1.03 && fl[c][10][1] <= fl[c + 'Base'][1] / fl[c + 'Base'][0] + 1e-4 && fl[c].every(([a, m], i) => i === 0 || (a < fl[c][i - 1][0] - 1e-9 && m < fl[c][i - 1][1] - 1e-9)));
  check('C6 [21] soft spread floor (v0.7D.1): max individual + squad accuracy -> standing just above 1° (never below), moving penalty > 0; EVERY squad rank narrows both cones', floorOk, ['infantry', 'heavy', 'medic', 'sniper'].map((c) => `${c} ${fl[c].map(([a]) => a).join('/')} moving+${fl[c][10][1]}`).join(' | '));
  if (BASE) {
    // v0.7D.1: Infantry / Heavy / Medic at squad rank 0 are identical to v0.7D (their standing cone is far above the soft zone); the Sniper
    // (2.5° base, I10/S0 = 1.13° in v0.7D) is inside the soft zone and eases to 1.24° / 8.44° (documented, no hit loss)
    const same3 = ['infantry', 'heavy', 'medic'].every((c) => near(floor.base[c][0][0], fl[c][0][0], 1e-6) && near(floor.base[c][0][1], fl[c][0][1], 1e-6));
    check('C6b squad accuracy rank 0 with max individual training: Infantry / Heavy / Medic identical to v0.7D; Sniper 1.125°/8.325° -> 1.236°/8.436° (soft zone)', same3 && near(floor.base.sniper[0][0], 1.125, 2e-3) && near(fl.sniper[0][0], 1.24, 0.01) && near(fl.sniper[0][0] + fl.sniper[0][1], 8.44, 0.02), JSON.stringify({ base: floor.base.sniper[0], now: fl.sniper[0] }));
  }
  // [22] fire-rate / projectile stability: fully upgraded Heavy Gunners
  await fresh();
  const heavy = await ev(() => {
    const g = T.g, ids = T.deploySix('iron-fist'); g.invuln = true;
    const hv = g.soldiers.filter((u) => u.identity.classId === 'heavy');
    const rate = hv.map((u) => +u.stats.fireRate.toFixed(3));
    window.__pilotInstall();
    let maxProj = 0, nan = 0;
    T.step(40, () => { window.__pilot.step(); maxProj = Math.max(maxProj, g.projectiles.length); for (const p of g.projectiles) if (!Number.isFinite(p.damage) || !Number.isFinite(p.pos.x)) nan++; });
    const shots = hv.map((u) => u.shots);
    return { ids, rate, peakRate: hv.map((u) => +(u.stats.fireRate * 1.75).toFixed(2)), maxProj, nan, shots, t: +g.time.toFixed(1), phase: g.phase };
  });
  check('C7 [22] three Elite 30 Heavy Gunners, full training + squad: fire rate finite and bounded (≤ 7 x 1.72 x 1.1 trait), projectile count bounded, no NaN over 40 s', heavy.rate.every((r) => r > 7 && r <= 7 * 1.72 * 1.1 + 1e-6) && heavy.nan === 0 && heavy.maxProj < 400 && heavy.shots.every((s) => s > 50), JSON.stringify(heavy));
  // [23] previews: the squad tab's next value = the soldier's real stat after the purchase
  await fresh();
  const pv = await ev(async () => {
    window.__debugUnlockAll(); T.spec('havoc', 'hvy-weapons', 20); T.R.get('havoc').training = { accuracy: 4, damage: 7, hp: 2, fireRate: 9, moveSpeed: 0 };
    const a = T.a; a.credits = 200000; a.squadTraining = { hp: 4, damage: 6, accuracy: 9, fireRate: 0 };
    const M = window.game.ui.menus;
    M.trainId = 'havoc';
    const out = [];
    for (const k of ['hp', 'damage', 'accuracy', 'fireRate']) {
      M.tab = 'squad'; M.showBarracks();
      const row = document.querySelector(`.q-row[data-stat="${k}"]`);
      if (!row) { out.push({ k, missing: true }); continue; }
      const shown = row.querySelector('.q-ex')?.dataset.next, cur = row.querySelector('.q-now').textContent, nxt = row.querySelector('.q-next')?.textContent, gain = row.querySelector('.q-gain').textContent, cost = row.querySelector('.t-buy').textContent;
      const r = T.E.buySquadTraining(a, k, null, null);
      const e = window.__effectiveStats(T.R.get('havoc'));
      const real = k === 'accuracy' ? `${Math.round(e.accuracy * 100) / 100}°/${Math.round((e.accuracy + e.movePenalty) * 100) / 100}°` : k === 'hp' ? String(Math.round(Math.round(e.hp * 10) / 10 * 100) / 100) : k === 'fireRate' ? `${Math.round(e.fireRate * 100) / 100}/s` : String(Math.round(e.damage * 100) / 100);
      out.push({ k, shown, real, cur, nxt, gain, cost, ok: r.ok });
    }
    return out;
  });
  check('C8 [23] Squad Training preview = the stat after the purchase (Elite Heavy, real pipeline), all four rows', pv.every((r) => !r.missing && r.ok && r.shown === r.real), pv.map((r) => `${r.k}: ${r.shown} vs ${r.real}`).join(' | '));
  const dRow = pv.find((r) => r.k === 'damage');
  check('C9 [3] row text: Current +23% -> Next +26.5%, "Upgrade gain: +3.5 pts of class base damage for every soldier", 5,500 CR', dRow && /\+23%/.test(dRow.cur) && /\+26\.5%/.test(dRow.nxt) && /\+3\.5 pts of class base damage for every soldier/.test(dRow.gain) && dRow.cost === '5,500 CR', JSON.stringify(dRow));

  // ================= D. PERSISTENCE [24-30] =================
  const fx = JSON.parse(FIXTURE);
  await fresh(page, URL, FIXTURE);
  const ld = await ev(() => {
    const a = T.a, ls = window.__loadStatus, R = T.R;
    return {
      st: ls && ls.status, notes: ls && ls.notes ? ls.notes : [], credits: a.credits, squad: { ...a.squadTraining }, nukes: a.support.nukes,
      soldiers: R.soldiers.map((s) => ({ id: s.id, level: s.progression?.level, xp: s.progression?.xp, tier: s.progression?.tier, spec: s.progression?.specialization, el: s.progression?.eliteLevel, tr: JSON.stringify(s.training), st: s.status })),
      damage: window.__effectiveStats(R.get('tank')).damage, base: window.__CFG.heavy.damage, tankLvl: R.get('tank').progression.level,
    };
  });
  const fxSold = Object.fromEntries(fx.roster.map((s) => [s.id, s]));
  const kept = ld.soldiers.every((s) => { const o = fxSold[s.id]; return !o || (o.progression.level === s.level && o.progression.xp === s.xp && (o.progression.tier ?? 'recruit') === s.tier && (o.progression.specialization ?? null) === (s.spec ?? null) && JSON.stringify(o.training) === s.tr); });
  check('D1 [24] genuine v0.7C save loads (v9, no repair notes, no migration)', ld.st === 'loaded' && ld.notes.length === 0, `${ld.st}; notes ${JSON.stringify(ld.notes)}`);
  check('D2 [25][26] purchased squad ranks kept (HP 3, Damage 5, Accuracy 1, Fire Rate 2), Credits 21,550 kept, 2 nukes kept', JSON.stringify(ld.squad) === JSON.stringify(fx.account.squadTraining) && ld.credits === fx.account.credits && ld.credits === 21550 && ld.nukes === 2, JSON.stringify({ squad: ld.squad, credits: ld.credits, nukes: ld.nukes }));
  check('D3 [27] soldiers, levels, XP, Elite tier / spec, individual training intact', kept && ld.soldiers.length === fx.roster.length, ld.soldiers.map((s) => `${s.id} L${s.level}${s.tier === 'elite' ? ' ★' + s.spec + ' ' + s.el : ''}`).join(', '));
  const g25 = 0.0075 * (ld.tankLvl - 1);
  check('D4 [25] the stronger benefit applies automatically: Squad Damage rank 5 is now +20% (was +10%) on the loaded roster', near(ld.damage, ld.base * (1 + g25 + 0.2), 1e-5), `Tank damage ${ld.damage} = ${ld.base} x (1 + ${g25.toFixed(4)} + 0.20)`);
  const rel = await ev(async () => {
    const a = T.a, E = T.E; a.credits += 60000;
    for (let r = a.squadTraining.damage; r < 10; r++) E.buySquadTraining(a, 'damage', r, window.__persist);
    return { damage: a.squadTraining.damage, credits: a.credits, stored: T.store().account.squadTraining };
  });
  await page.reload(); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(50);
  const rel2 = await ev(() => ({ squad: { ...T.a.squadTraining }, credits: T.a.credits, st: window.__loadStatus.status }));
  check('D5 [28] ranks 6-10 persist through save / reload (Damage 5 -> 10 bought, 35,500 CR spent)', rel.damage === 10 && rel2.squad.damage === 10 && rel2.credits === rel.credits && rel.credits === 21550 + 60000 - 35500 && rel2.st === 'loaded', JSON.stringify({ rel, rel2 }));
  await fresh();
  const full = await ev(() => {
    const ids = T.six(); T.a.credits = 777; T.a.support = { nukes: 3, purchased: 3, launched: 0 }; window.__persist();
    return { raw: localStorage.getItem(window.__SAVE_KEY), ids };
  });
  await fresh(page, URL, full.raw);
  const full2 = await ev((ids) => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes?.length ?? 0, squad: Object.values(T.a.squadTraining).join(), cr: T.a.credits, nukes: T.a.support.nukes, sold: ids.map((id) => { const s = T.R.get(id); return `${s.progression.eliteLevel}:${Object.values(s.training).join('')}`; }), version: JSON.parse(localStorage.getItem(window.__SAVE_KEY)).version }), full.ids);
  check('D6 [29] fully upgraded account (squad 10/10/10/10, six Elite 30 max trained, 3 nukes) reloads unchanged, save v9', full2.st === 'loaded' && full2.notes === 0 && full2.squad === '10,10,10,10' && full2.cr === 777 && full2.nukes === 3 && full2.sold.every((x) => x === '30:1010101010') && full2.version === 9, JSON.stringify(full2));
  const junk = await ev(() => {
    const raw = JSON.parse(localStorage.getItem(window.__SAVE_KEY)); raw.account.squadTraining = { hp: 14, damage: -2, accuracy: 7.6, fireRate: 'x' };
    const r = window.__parseSave(JSON.stringify(raw)); const a = r.data?.account ?? r.account ?? null;
    return { sq: a ? a.squadTraining : null, notes: (r.notes ?? []).length };
  });
  check('D7 save repair clamps squad ranks to 0..10 (14 -> 10, -2 -> 0, 7.6 -> 7, junk -> 0)', !!junk.sq && JSON.stringify(junk.sq) === JSON.stringify({ hp: 10, damage: 0, accuracy: 7, fireRate: 0 }), JSON.stringify(junk));
  // [30] KIA, resurrection and Memorial unchanged (prices vs v0.7C; flow keeps the squad bonus)
  const kiaP = await both(() => { const C = window.__casualties; return JSON.stringify([0, 1, 2, 3, 5].map((n) => [C.resurrectionCost(n, 'recruit'), C.resurrectionCost(n, 'elite')])); });
  await fresh();
  const kia = await ev(() => {
    const g = T.g, a = T.a, E = T.E; window.__debugUnlockAll(); a.squadTraining = { hp: 8, damage: 8, accuracy: 8, fireRate: 8 };
    g.selectMission('red-canyon', true); g.deploy([T.R.get('ace'), T.R.get('tank'), T.R.get('doc')], 'roster');
    T.calm(); const v = g.soldiers[1]; g.downSoldier(v); v.bleed = 0.5; g.soldiers[0].state = 'downed'; g.soldiers[0].bleed = 1e9; g.soldiers[2].state = 'downed'; g.soldiers[2].bleed = 1e9;
    T.step(1.5); if (g.phase === 'playing') g.fail();
    const q = (a.pendingDecision?.queue ?? []).map((x) => x.id);
    const before = window.__effectiveStats(T.R.get('tank'));
    a.credits = 100000;
    // decisions one soldier at a time, in queue order: resurrect Tank, honor the others in the Memorial
    let res = { ok: false, reason: 'not queued' }, guard = 0, expect = null;
    while (a.pendingDecision && guard++ < 10) {
      const id = a.pendingDecision.queue[0].id;
      if (id === 'tank') { expect = window.__casualties.resurrectionCost(T.R.get('tank').resurrections, T.R.get('tank').progression.tier); res = E.resurrect(T.R, a, id, window.__persist); }
      else E.memorialize(T.R, a, id, window.__persist);
    }
    const after = window.__effectiveStats(T.R.get('tank'));
    return { expect, q, res: res.ok ? { ok: true, cost: res.cost } : res, status: T.R.get('tank').status, same: before.hp === after.hp && before.damage === after.damage, sq: Object.values(a.squadTraining).join(), memorial: (a.memorial ?? []).length, pending: !!a.pendingDecision };
  });
  check('D8 [30] KIA -> decision -> resurrection (v0.7C prices) -> active with the squad bonus; Memorial for the rest; squad ranks untouched', kia.q.includes('tank') && kia.res.ok && kia.res.cost === kia.expect && kia.status === 'active' && kia.same && kia.sq === '8,8,8,8' && !kia.pending && (!BASE || kiaP.now === kiaP.base), JSON.stringify({ kia, prices: kiaP.now, base: BASE ? kiaP.now === kiaP.base : 'n/a' }));

  // ================= E. MOBILE UI + HUD [31-34] =================
  const devices = [
    ['iphone-se', { viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['iphone-14', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['pixel-7', { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true }],
    ['desktop', { viewport: { width: 1280, height: 720 } }],
  ];
  const touchReport = [];
  for (const [name, opts] of devices) {
    const c = await browser.newContext(opts);
    await c.addInitScript(installHelpers);
    const p = await c.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await fresh(p);
    const shot = async (f) => { if (OUT) await p.screenshot({ path: path.join(OUT, `${name}-${f}.png`) }); };
    const box = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }, sel);
    const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    // ---- Squad Training tab [31]
    await p.evaluate(() => { window.__debugUnlockAll(); T.a.credits = 12000; T.a.squadTraining = { hp: 10, damage: 7, accuracy: 4, fireRate: 0 }; T.g.toBarracks(); });
    await p.waitForTimeout(100);
    if (opts.hasTouch) await p.tap('[data-a="tab"][data-tab="squad"]'); else await p.click('[data-a="tab"][data-tab="squad"]');
    await p.waitForTimeout(150);
    const ui = await p.evaluate(() => {
      const de = document.documentElement, m = document.getElementById('menu');
      const rows = [...document.querySelectorAll('.q-row')].map((r) => {
        const b = r.querySelector('.t-buy').getBoundingClientRect(), rr = r.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { k: r.dataset.stat, txt: r.textContent.replace(/\s+/g, ' ').trim(), inside: rr.left >= -0.5 && rr.right <= innerWidth + 0.5, btn: [Math.round(b.width), Math.round(b.height)], hit: !!hit && (hit === r.querySelector('.t-buy') || r.querySelector('.t-buy').contains(hit) || b.top > innerHeight) };
      });
      const texts = [...m.querySelectorAll('.q-row *')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      return { rows, over: de.scrollWidth > innerWidth + 1 || m.scrollWidth > m.clientWidth + 1, minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))) };
    });
    await shot('squad-training');
    const r = Object.fromEntries(ui.rows.map((x) => [x.k, x.txt]));
    const textOk = /RANK 10\/10/.test(r.hp) && /MAXED/.test(r.hp) && /RANK 7\/10/.test(r.damage) && /\+26\.5%/.test(r.damage) && /\+30\.5%/.test(r.damage) && /\+4 pts/.test(r.damage) && /7,000 CR/.test(r.damage) && /RANK 4\/10/.test(r.accuracy) && /−18%/.test(r.accuracy) && /−25%/.test(r.accuracy) && /RANK 0\/10/.test(r.fireRate) && /1,000 CR/.test(r.fireRate);
    check(`E1 [31] ${name}: Squad Training shows rank /10, current, next, gain, cost, MAXED; four rows fit, no horizontal overflow, buttons ≥ 36 px, text ≥ 11 px`, ui.rows.length === 4 && textOk && !ui.over && ui.rows.every((x) => x.inside && x.btn[1] >= 36 && x.btn[0] >= 44 && x.hit) && ui.minFont >= 11 && errs.length === 0, JSON.stringify({ over: ui.over, minFont: ui.minFont, btn: ui.rows.map((x) => x.btn.join('x')).join(' '), textOk }));
    // buy by tap / click
    if (opts.hasTouch) await p.tap('.q-row[data-stat="damage"] .t-buy'); else await p.click('.q-row[data-stat="damage"] .t-buy');
    await p.waitForTimeout(450);
    const bought = await p.evaluate(() => ({ rank: T.a.squadTraining.damage, cr: T.a.credits, row: document.querySelector('.q-row[data-stat="damage"]').textContent.replace(/\s+/g, ' ') }));
    check(`E2 [31] ${name}: tapping 7,000 CR buys Squad Damage rank 8 (12,000 -> 5,000), row updates to 8/10 and +30.5% -> +35%`, bought.rank === 8 && bought.cr === 5000 && /RANK 8\/10/.test(bought.row) && /\+30\.5%/.test(bought.row) && /\+35%/.test(bought.row), JSON.stringify(bought));
    // ---- HUD touch targets [32], airstrike [33], nuke [34]
    await p.evaluate(() => { T.a.support = { nukes: 2, purchased: 2, launched: 0 }; window.__persist(); T.deploySix('iron-fist'); T.calm(); T.g.invuln = true; });
    await p.waitForTimeout(200);
    const hud = await p.evaluate(() => {
      const q = (s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      // effective touch area: scan the button's neighbourhood with elementFromPoint (the visible box + the invisible extension)
      const area = (sel) => {
        const el = document.querySelector(sel), r = el.getBoundingClientRect();
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (let y = r.top - 40; y <= r.bottom + 40; y += 0.5) for (let x = r.left - 20; x <= r.right + 20; x += 2) { const h = document.elementFromPoint(x, y); if (h && (h === el || el.contains(h))) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
        return { vis: [+r.width.toFixed(1), +r.height.toFixed(1)], touch: [+(maxX - minX + 2).toFixed(1), +(maxY - minY + 0.5).toFixed(1)], box: { x: minX, y: minY, w: maxX - minX + 2, h: maxY - minY + 0.5 } };
      };
      return { air: area('[data-s="air"]'), nuke: area('[data-s="nuke"]'), panels: q('#panels'), top: q('#topbtns'), obj: q('#objective'), stage: q('#stage'), btns: [...document.querySelectorAll('#panels button')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }) };
    });
    const others = [hud.panels, hud.top, hud.obj];
    const clear = [hud.air.box, hud.nuke.box].every((b) => others.every((o) => !overlap(b, o))) && !overlap(hud.air.box, hud.nuke.box);
    const big = opts.hasTouch ? [hud.air, hud.nuke].every((x) => x.touch[0] >= 44 && x.touch[1] >= 44) : [hud.air, hud.nuke].every((x) => x.touch[1] >= x.vis[1]);
    const topZone = (hud.air.box.y + hud.air.box.h - hud.stage.y) / hud.stage.h < 0.26 && (hud.air.box.x + hud.air.box.w - hud.stage.x) / hud.stage.w < 0.3;
    touchReport.push(`${name}: AIRSTRIKE visible ${hud.air.vis.join('x')} / touch ${hud.air.touch.join('x')}, NUKE visible ${hud.nuke.vis.join('x')} / touch ${hud.nuke.touch.join('x')}`);
    check(`E3 [32] ${name}: AIRSTRIKE / NUKE touch areas ≥ 44x44 CSS px, clear of panels (grenade / revive), pause row, objective and each other; top-left corner only`, big && clear && topZone, touchReport[touchReport.length - 1]);
    await shot('hud-six-elites');
    // airstrike: tap AIRSTRIKE near the bottom edge of its touch area (outside the visible button on small phones), aim, CONFIRM
    const anchor0 = await p.evaluate(() => ({ ...T.g.anchor }));
    const tapX = hud.air.box.x + hud.air.box.w / 2, tapY = hud.air.box.y + hud.air.box.h - 1.5;
    if (opts.hasTouch) await p.touchscreen.tap(tapX, tapY); else await p.mouse.click(tapX, tapY);
    await p.waitForTimeout(80);
    const s = hud.stage, aimPt = { x: s.x + s.w * 0.3, y: s.y + s.h * 0.6 };
    if (opts.hasTouch) await p.touchscreen.tap(aimPt.x, aimPt.y); else await p.mouse.click(aimPt.x, aimPt.y);
    await p.waitForTimeout(80);
    const as = await p.evaluate(() => {
      const q = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      return { air: T.g.support.air, aim: T.g.support.aim, joy: !!T.g.input.joy, go: q('[data-as="go"]'), cancel: q('[data-as="cancel"]'), bar: q('#asbar') };
    });
    await shot('airstrike-aiming');
    const asBig = !opts.hasTouch || [as.go, as.cancel].every((b) => b.w >= 44 && b.h >= 44);
    touchReport.push(`${name}: CONFIRM ${Math.round(as.go.w)}x${Math.round(as.go.h)}, CANCEL ${Math.round(as.cancel.w)}x${Math.round(as.cancel.h)}`);
    if (opts.hasTouch) await p.touchscreen.tap(as.go.x + as.go.w / 2, as.go.y + as.go.h / 2); else await p.mouse.click(as.go.x + as.go.w / 2, as.go.y + as.go.h / 2);
    await p.waitForTimeout(80);
    const as2 = await p.evaluate(() => ({ air: T.g.support.air, delay: T.g.support.strike?.t, anchor: { ...T.g.anchor } }));
    check(`E4 [33] ${name}: AIRSTRIKE via its touch area -> aim tap (no joystick, squad still) -> CONFIRM (≥ 44 px, clear of panels) -> incoming`, as.air === 'targeting' && !!as.aim && !as.joy && asBig && !overlap(as.bar, hud.panels) && as2.air === 'incoming' && Math.hypot(as2.anchor.x - anchor0.x, as2.anchor.y - anchor0.y) < 30, JSON.stringify({ as: { air: as.air, joy: as.joy, go: as.go }, as2: as2.air }));
    // nuke: NUKE -> confirm box (LAUNCH arms after 0.5 s) -> LAUNCH -> countdown, stock 2 -> 1
    const nk = hud.nuke.box;
    if (opts.hasTouch) await p.touchscreen.tap(nk.x + nk.w / 2, nk.y + nk.h / 2); else await p.mouse.click(nk.x + nk.w / 2, nk.y + nk.h / 2);
    await p.waitForTimeout(650);
    const nb = await p.evaluate(() => { const q = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }; return { state: T.g.support.nuke, box: q('#nkbox'), go: q('[data-nk="go"]'), cancel: q('[data-nk="cancel"]') }; });
    await shot('nuke-confirm');
    touchReport.push(`${name}: LAUNCH ${Math.round(nb.go.w)}x${Math.round(nb.go.h)}, nuke CANCEL ${Math.round(nb.cancel.w)}x${Math.round(nb.cancel.h)}`);
    if (opts.hasTouch) await p.touchscreen.tap(nb.go.x + nb.go.w / 2, nb.go.y + nb.go.h / 2); else await p.mouse.click(nb.go.x + nb.go.w / 2, nb.go.y + nb.go.h / 2);
    await p.waitForTimeout(150);
    const n2 = await p.evaluate(() => ({ nuke: T.g.support.nuke, stock: T.a.support.nukes, left: T.g.support.nukeLeft }));
    const nbOk = nb.state === 'confirm' && (!opts.hasTouch || (nb.go.h >= 44 && nb.cancel.h >= 44)) && !overlap(nb.box, hud.panels) && !overlap(nb.box, hud.air.box) && !overlap(nb.box, hud.top);
    check(`E5 [34] ${name}: NUKE -> confirmation (LAUNCH / CANCEL ≥ 44 px, clear of the HUD) -> LAUNCH -> 30 s countdown, stock 2 -> 1`, nbOk && n2.nuke === 'countdown' && n2.stock === 1 && n2.left > 29, JSON.stringify({ nb: { st: nb.state, go: nb.go, box: nb.box }, n2 }));
    // panels unchanged: ability / revive buttons in the soldier panels still hit-test as themselves
    const panelHit = await p.evaluate(() => [...document.querySelectorAll('#panels button')].every((b) => { const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === b || b.contains(h); }));
    check(`E6 [32] ${name}: every soldier-panel button (abilities, grenade, revive) still receives its own touches`, panelHit && errs.length === 0, errs[0] ?? '');
    await c.close();
  }
  console.log('  touch areas (CSS px): ' + touchReport.join(' · '));

  // ================= F. REGRESSION + PERFORMANCE [35-38] =================
  const data = await both(() => {
    const C = window.__CFG, cp = window.__campaign;
    // v0.8B only ADDS (friendly asset config, Missions 13 / 14, the M12 -> M13 unlock): compare everything older
    const NEW_8B = ['turret', 'commandCenter', 'defense', 'escortTruck', 'mountedGun']; const m12 = (m) => (m.id === 'artillery-hunt' ? { ...m, unlocks: { ...m.unlocks, missions: [], capacityNote: undefined } } : m);
    const enemyCfg = Object.fromEntries(Object.entries(C).filter(([k]) => !NEW_8B.includes(k) && /enemy|boss|sniper_|armored|turret|mortar|rifleman|grenadier|bunker|escort/i.test(k)));
    return JSON.stringify({ enemyCfg, enemy: C.enemy, missions: cp.CAMPAIGN.filter((m) => m.number <= 12).map((m) => JSON.stringify(m12(m))), caps: Array.from({ length: 14 }, (_, i) => cp.capacityFor(i + 1)), air: C.airstrike, nuke: C.nuke, support: C.support, elite: C.elite, items: window.__supportItems.map((i) => [i.id, i.cost]) });
  });
  check('F1 [36] no mission difficulty change: enemy / boss config, Missions 1-10 data, deployment caps, airstrike / nuke / Elite numbers identical to v0.7C', !BASE || data.now === data.base, BASE ? (data.now === data.base ? 'identical' : 'DIFFERS') : 'no BASE: skipped');

  if (!QUICK) {
    const SEED = 777;
    const seeded = ({ seed }) => {
      let s = seed >>> 0;
      Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      let q = [], now = 1000;
      window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
      window.__drive = (period, until) => { let n = 0; while (!until() && n < 1e6) { now += period; const cbs = q; q = []; for (const cb of cbs) cb(now); n++; } return n; };
    };
    // [37] fully upgraded six Elites: 30 / 60 FPS caps on 60 / 120 Hz displays simulate identically (airstrike + nuke included)
    const parity = async (hz, cap) => {
      const c = await browser.newContext({ viewport: { width: 844, height: 390 } });
      await c.addInitScript(installHelpers); await c.addInitScript(seeded, { seed: SEED });
      const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(URL + `?fps=${cap}`); await p.evaluate(() => localStorage.clear()); await p.goto(URL + `?fps=${cap}`); await p.waitForFunction(() => !!window.game);
      await p.evaluate(() => { T.a.support = { nukes: 1, purchased: 1, launched: 0 }; T.deploySix('iron-fist'); });
      await p.evaluate(installPilot);
      const r = await p.evaluate((hz) => {
        const g = window.game, P = window.__pilot, u0 = g.update.bind(g), out = []; let steps = 0;
        const h = () => { const r = (x) => Math.round(x * 1000); const s = JSON.stringify([r(g.time), g.support.air, g.support.nuke, g.soldiers.map((u) => [r(u.pos.x), r(u.pos.y), r(u.hp), u.state, u.shots, u.hits]), g.enemies.map((e) => [r(e.pos.x), r(e.pos.y), r(e.hp), e.state]), g.projectiles.map((q) => [r(q.pos.x), r(q.pos.y), r(q.damage)])]); let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16); };
        g.update = (dt) => {
          if (g.phase === 'playing' && !g.paused) {
            P.step(); steps++;
            if (steps === 240) { g.useAirstrike(); const e = g.enemies.find((x) => x.active && !x.structure) ?? g.soldiers[0]; g.support.aim = { x: e.pos.x, y: e.pos.y }; g.confirmAirstrike(); }
            if (steps === 300) { g.useNuke(); g.launchNuke(); }
          }
          u0(dt);
          if (steps % 300 === 0 && out.length < steps / 300) out.push(h());
        };
        g.invuln = true;
        window.__drive(1000 / hz, () => steps >= 50 * 60 || g.phase !== 'playing');
        return { hashes: out, steps, phase: g.phase, log: g.support.log.map((l) => l.what).join(',') };
      }, hz);
      await c.close();
      return { ...r, errs };
    };
    const ref = await parity(60, 60), p30 = await parity(60, 30), p120 = await parity(120, 30);
    const same = (x) => x.hashes.length === ref.hashes.length && x.hashes.every((h, i) => h === ref.hashes[i]);
    check('F2 [37] fully upgraded six Elites (squad 10, Elite 30, max training): cap 30 / cap 60 on 60 and 120 Hz displays simulate identically with airstrike + nuke', ref.hashes.length >= 8 && same(p30) && same(p120) && /nuke-detonate/.test(ref.log) && ref.errs.length === 0 && p30.errs.length === 0, `${ref.hashes.length} checkpoints, ${ref.steps} steps, ${ref.log}`);

    // [35] Missions 1-10 still playable: the fully upgraded squad (capped to each mission's deployment) wins each by autopilot
    const runMission = async (mission) => {
      const c = await browser.newContext({ viewport: { width: 844, height: 390 } });
      await c.addInitScript(installHelpers); await c.addInitScript(seeded, { seed: 4242 });
      const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.goto(URL); await p.waitForFunction(() => !!window.game);
      const sq = await p.evaluate((m) => { const ids = T.six(); const g = T.g; g.selectMission(m, true); const r = g.deploy(ids.slice(0, g.capacity).map((id) => g.roster.get(id)), 'roster'); return r.ok ? g.soldiers.length : r.reason; }, mission);
      await p.evaluate(installPilot);
      const r = await p.evaluate(() => { const g = window.game, P = window.__pilot, u0 = g.update.bind(g); let steps = 0; g.update = (dt) => { if (g.phase === 'playing') { P.step(); steps++; } u0(dt); }; window.__drive(1000 / 60, () => steps >= 420 * 60 || g.phase !== 'playing'); return { phase: g.phase, t: +g.time.toFixed(1) }; });
      await c.close();
      return { ...r, sq, errs };
    };
    const rows = []; let bad = 0;
    for (const [i, m] of MISSIONS.entries()) { const r = await runMission(m); if (r.phase !== 'won' || r.errs.length) bad++; rows.push(`M${i + 1} ${r.phase} ${r.t}s (${r.sq})`); }
    check('F3 [35] Missions 1-10 playable: fully upgraded squads (deployment caps applied) win every mission by autopilot, no errors', bad === 0, rows.join(' · '));

    // [38] performance: six fully upgraded Elites (three Heavy Gunners) vs ~40 enemies, abilities, airstrike impact, nuke detonation
    const perfRun = async (url, label) => {
      const c = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await c.addInitScript(installHelpers); await c.addInitScript(seeded, { seed: 99 });
      const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.goto(url); await p.waitForFunction(() => !!window.game);
      await p.evaluate(installPilot);
      const cdp = await c.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      // frames yield to the browser between them (a real frame loop does; rendering hundreds of frames in one
      // synchronous call makes the headless rasterizer stall for ~1-2.5 s every ~35 frames, on any build)
      const one = () => p.evaluate(async () => {
        const g = T.g; T.a.support = { nukes: 1, purchased: 1, launched: 0 };
        T.deploySix('iron-fist'); g.invuln = true; window.__pilotInstall();
        const sq = g.soldiers[0].pos;
        // a controlled crowd: ~40 enemies around the squad (some armored), the mission's own included
        let i = 0; while (g.enemies.filter((e) => e.active).length < 40) { const a = i * 2.4, d = 260 + (i % 5) * 70; const e = T.foe(Math.max(80, Math.min(g.map.w - 80, sq.x + Math.cos(a) * d)), Math.max(80, Math.min(g.map.h - 80, sq.y + Math.sin(a) * d)), i % 6 ? 'rifleman' : 'armored'); e.hpOverride = 400; e.hp = 400; i++; }
        const frame = async () => { await new Promise((r) => setTimeout(r, 10)); const t0 = performance.now(); window.__pilot.step(); g.update(1 / 60); window.__pilot.step(); g.update(1 / 60); const t1 = performance.now(); window.__render(); return [t1 - t0, performance.now() - t1]; };
        for (let k = 0; k < 20; k++) await frame(); // warm-up
        const fight = [], peak = { proj: 0, enemies: 0, fx: 0 };
        const take = async (arr, n) => { for (let k = 0; k < n; k++) { arr.push(await frame()); peak.proj = Math.max(peak.proj, g.projectiles.length); peak.enemies = Math.max(peak.enemies, g.enemies.filter((e) => e.active).length); peak.fx = Math.max(peak.fx, g.fx.particles.length); } };
        await take(fight, 120);
        for (const s of g.soldiers) if (s.ability.ready(s) && s.ability.targetingMode === 'instant') g.useAbility(s);
        const abil = []; await take(abil, 45);
        g.useAirstrike(); const tgt = g.enemies.find((e) => e.active && !e.structure); g.support.aim = { x: tgt.pos.x, y: tgt.pos.y }; g.confirmAirstrike();
        g.support.strike.t = 2 / 60 * 2; const air = []; await take(air, 20);
        g.useNuke(); g.launchNuke(); g.support.nukeLeft = 3 / 60; const nuke = []; await take(nuke, 30);
        const st = (xs) => { const tot = xs.map(([u, r]) => u + r).sort((a, b) => a - b); const q = (f) => +tot[Math.min(tot.length - 1, Math.floor(f * tot.length))].toFixed(2); return { p50: q(0.5), p95: q(0.95), max: +tot[tot.length - 1].toFixed(2), upd50: +xs.map((x) => x[0]).sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(2), over33: tot.filter((x) => x > 33.3).length, n: tot.length }; };
        return { fight: st(fight), abilities: st(abil), airstrike: st(air), nuke: st(nuke), peak, log: g.support.log.map((l) => l.what).join(','), rate: g.soldiers.filter((u) => u.identity.classId === 'heavy').map((u) => +u.stats.fireRate.toFixed(2)) };
      });
      const runs = [await one(), await one(), await one()];
      await c.close();
      // median of the three runs, metric by metric (headless timings are noisy)
      const med = (f) => { const v = runs.map(f).sort((x, y) => x - y); return v[1]; };
      const agg = (k) => ({ p50: med((r) => r[k].p50), p95: med((r) => r[k].p95), max: med((r) => r[k].max), over33: med((r) => r[k].over33), n: runs[0][k].n });
      return { label, fight: agg('fight'), abilities: agg('abilities'), airstrike: agg('airstrike'), nuke: agg('nuke'), peak: runs[1].peak, log: runs[1].log, rate: runs[1].rate, errs, runsFightP95: runs.map((r) => r.fight.p95).join('/') };
    };
    const now = await perfRun(URL, 'v0.7D');
    console.log(`  perf ${now.label} (2 updates + 1 render per 30 FPS frame, 4x CPU throttle, iPhone 14 viewport DPR 3, headless): ${JSON.stringify(now)}`);
    let baseP = null;
    if (BASE) { baseP = await perfRun(BASE, 'v0.7C'); console.log(`  perf ${baseP.label} same scenario: ${JSON.stringify(baseP)}`); }
    // pass: every phase's median frame fits 30 FPS, the detonation frame fits, and (with BASE) the fight p95 is
    // within 25% of v0.7C in the same scenario (v0.7D soldiers fire up to ~12% faster)
    const okPerf = now.errs.length === 0 && ['fight', 'abilities', 'airstrike', 'nuke'].every((k) => now[k].p50 < 33.3) && now.nuke.max < 66.7 && /nuke-detonate/.test(now.log) && now.peak.enemies >= 40 && (!baseP || now.fight.p95 <= baseP.fight.p95 * 1.25 + 2);
    const fmt = (r) => ['fight', 'abilities', 'airstrike', 'nuke'].map((k) => `${k} p50 ${r[k].p50} / p95 ${r[k].p95} / max ${r[k].max} ms (${r[k].over33}/${r[k].n} > 33 ms)`).join('; ');
    check('F4 [38] six fully upgraded Elites (3 Heavy Gunners) vs 40 enemies, abilities, airstrike, nuke (2 steps + render per 30 FPS frame, 4x CPU throttle): median frames < 33 ms, detonation < 67 ms, fight p95 within 25% of v0.7C', okPerf, `v0.7D ${fmt(now)}; peak ${JSON.stringify(now.peak)}${baseP ? ` || v0.7C ${fmt(baseP)}` : ''}`.slice(0, 2000));
  }

  check('no page errors (main page)', errors.length === 0, errors[0]);
  console.log(`\n${total - fails}/${total} passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
