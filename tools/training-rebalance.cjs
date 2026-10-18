// v0.7B.1 PROGRESSION & TRAINING REBALANCE: acceptance checks against a served build (headless Chromium).
//
//   npx vite preview --port 4173 &  node tools/training-rebalance.cjs
//   BASE=http://localhost:4174/   a v0.7B build: prices, thresholds, Credits, enemies and untrained
//                                 stats must match it; trained stats must never be lower than it;
//                                 a v0.7B save with training loads with every rank kept
//   OUT=dir                       screenshots (Training tab on three phones)
//   QUICK=1                       skips the long autopilot runs (Missions 1-10, 30 / 60 FPS parity)
//
//  A. Training tables: prices / rank limits unchanged, each rank adds more than the one before,
//     no rank weaker than v0.7B, Sniper damage path, max damage / HP totals, caps on the others
//  B. Stat pipeline: training applied once, stacks with level, trait, squad training and the Elite
//     level bonus (one multiplier), no stacking across deploy / retry / reload, combat caps
//  C. Training preview (UI) = the stat after the purchase, for Recruits, traits and Elites
//  D. Mission XP: curve 1-50 (M1 125 ... M40 500, M50 600), replay pays the replayed mission's XP,
//     Credits unchanged, Recruit / Elite thresholds unchanged
//  E. Saves: v0.7B save with training loads with every rank kept and the new benefits; save /
//     reload; KIA + resurrection keeps training
//  F. Mobile: Training tab on iPhone SE / iPhone 14 / Pixel 7 landscape
//  G. Fully trained Elite 30 squads: Missions 1-10 won (autopilot); 30 / 60 FPS caps simulate identically
// PASS/FAIL per check; exits 1 on any failure.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const { installPilot } = require('./perf-lib.cjs');
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const OUT = process.env.OUT || '';
const QUICK = !!process.env.QUICK;
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const MISSIONS = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home', 'bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist'];

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get R() { return window.game.roster; },
    get P() { return window.__progression; },
    get EL() { return window.__elite; },
    lv(id, level) { const P = window.__progression, p = this.R.get(id).progression; p.xp = P.xpForLevel(level); p.level = P.levelForXp(p.xp); },
    spec(id, spec, el = 1) { const p = this.R.get(id).progression; this.lv(id, 25); p.tier = 'elite'; p.elitePath = spec; p.specialization = spec; p.eliteXp = this.EL.eliteXpForLevel(el); p.eliteLevel = el; },
    recruit(id) { const p = this.R.get(id).progression; p.tier = 'recruit'; p.elitePath = null; p.specialization = null; p.eliteLevel = 0; p.eliteXp = 0; },
    sniper() {
      const a = this.a;
      if (!a.classUnlocks.unlocked.includes('sniper')) { a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper'); }
      this.E.openOffice(this.R, a, null);
      let o = null; for (let i = 0; i < 300 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'sniper'); if (!o) { a.credits += 100; this.E.refreshOffers(this.R, a, null, null); } }
      a.credits += 5000; return this.E.recruit(this.R, a, o.id, null).soldier;
    },
    store() { return JSON.parse(localStorage.getItem(window.__SAVE_KEY)); },
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(100)} ${String(detail).replace(/\s+/g, ' ').slice(0, 300)}`); };
  const fresh = async (p = page, url = URL, raw = null) => {
    await p.goto(url); await p.evaluate((raw) => { localStorage.clear(); if (raw) localStorage.setItem('minisquad.save', raw); }, raw);
    await p.goto(url); await p.waitForFunction(() => !!window.game); await p.waitForTimeout(50);
  };

  // optional v0.7B reference build
  let basePage = null;
  if (BASE) { const bctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); await bctx.addInitScript(installHelpers); basePage = await bctx.newPage(); await fresh(basePage, BASE); }

  // ================= A. training tables =================
  await fresh();
  const tab = await page.evaluate(() => {
    const P = window.__progression;
    const dump = (D) => Object.fromEntries(Object.entries(D).map(([k, d]) => [k, { costs: d.costs, bonus: d.bonus, max: P.maxRank(d) }]));
    return { ind: dump(P.TRAINING), sqd: dump(P.SQUAD_TRAINING) };
  });
  const OLD_PER_RANK = { ind: { accuracy: -0.05, damage: 0.03, hp: 0.05, fireRate: 0.03, moveSpeed: 0.02 }, sqd: { hp: 0.02, damage: 0.015, accuracy: -0.02, fireRate: 0.01 } };
  const indCosts = '250,400,550,700,900,1150,1450,1750,2100,2500', sqdCosts = '1000,1500,2000,2750,3500,4500,5500,7000,8500,10000'; // v0.7D: squad ranks 6-10 added
  check('A1 training prices unchanged (individual 250..2500, squad 1000..3500 + v0.7D ranks 6-10), every category', Object.values(tab.ind).every((d) => d.costs.join() === indCosts) && Object.values(tab.sqd).every((d) => d.costs.join() === sqdCosts), indCosts + ' / ' + sqdCosts);
  check('A2 rank limits (10 individual; squad 10 since v0.7D); same five + four categories', Object.values(tab.ind).every((d) => d.max === 10) && Object.values(tab.sqd).every((d) => d.max === 10) && Object.keys(tab.ind).join() === 'accuracy,damage,hp,fireRate,moveSpeed' && Object.keys(tab.sqd).join() === 'hp,damage,accuracy,fireRate', '');
  const steps = (b) => b.slice(1).map((v, i) => Math.abs(v - b[i]));
  const incr = (b) => steps(b).every((d, i, a) => i === 0 || d > a[i - 1] + 1e-9);
  // v0.7D: squad tables accelerate within each five-rank tier (rank 6 restarts the step; tools/squad-training.cjs A6)
  const incrTiers = (b) => [b.slice(0, 6), b.slice(5)].every(incr);
  check('A3 every category: each later rank adds MORE than the one before (accelerating; squad per 5-rank tier)', Object.values(tab.ind).every((d) => incr(d.bonus)) && Object.values(tab.sqd).every((d) => incrTiers(d.bonus)),
    Object.entries(tab.ind).map(([k, d]) => `${k} ${steps(d.bonus).map((x) => (x * 100).toFixed(2)).join('/')}`).join(' · '));
  const noLower = (grp) => Object.entries(tab[grp]).every(([k, d]) => d.bonus.every((v, r) => Math.abs(v) >= Math.abs(OLD_PER_RANK[grp][k] * r) - 1e-9 && Math.sign(v || OLD_PER_RANK[grp][k]) === Math.sign(OLD_PER_RANK[grp][k])));
  check('A4 no rank of any category is weaker than in v0.7B (rank 1 identical, later ranks stronger)', noLower('ind') && noLower('sqd') && Object.entries(tab.ind).every(([k, d]) => Math.abs(d.bonus[1] - OLD_PER_RANK.ind[k]) < 1e-9), '');
  const snp = await page.evaluate(() => {
    const P = window.__progression, e = window.__effectiveStats;
    const id = (r, level = 1) => ({ classId: 'sniper', traitId: null, mods: {}, progression: { level, xp: P.xpForLevel(level), upgrades: [], specialization: null, tier: 'recruit', elitePath: null, eliteLevel: 0, eliteXp: 0 }, training: { ...P.newTraining(), damage: r } });
    const sq = P.newSquadTraining();
    return { l1: Array.from({ length: 11 }, (_, r) => e(id(r), { level: 1, training: id(r).training, squad: sq }).damage), l25: Array.from({ length: 11 }, (_, r) => e(id(r, 25), { level: 25, training: id(r, 25).training, squad: sq }).damage) };
  });
  const r2 = (x) => Math.round(x * 100) / 100;
  check('A5 Sniper damage path 32 -> 48 (+50%); final rank +2.24 (v0.7B: +0.96); every step bigger', snp.l1[0] === 32 && Math.abs(snp.l1[10] - 48) < 1e-6 && Math.abs(snp.l1[10] - snp.l1[9] - 2.2400) < 1e-3 && incr(snp.l1), snp.l1.map(r2).join(' → '));
  const dmgMax = { l1: snp.l1[10] / snp.l1[0] - 1, l25: snp.l25[10] / snp.l25[0] - 1 };
  check('A6 max damage training ≈ +40-50% vs the same soldier untrained (L1 +50%, L25 +42%)', dmgMax.l1 >= 0.40 && dmgMax.l1 <= 0.5 + 1e-9 && dmgMax.l25 >= 0.40 && dmgMax.l25 <= 0.5, `L1 +${(dmgMax.l1 * 100).toFixed(1)}%, L25 +${(dmgMax.l25 * 100).toFixed(1)}% (Sniper L25 ${r2(snp.l25[0])} -> ${r2(snp.l25[10])})`);
  const hpMax = await page.evaluate(() => {
    const P = window.__progression, e = window.__effectiveStats;
    const at = (cls, level, hp, sq = 0) => e({ classId: cls, traitId: null, mods: {}, progression: { level, xp: 0, upgrades: [], specialization: null, tier: 'recruit', elitePath: null, eliteLevel: 0, eliteXp: 0 }, training: P.newTraining() }, { level, training: { ...P.newTraining(), hp }, squad: { ...P.newSquadTraining(), hp: sq } }).hp;
    return { l25: at('heavy', 25, 10) / at('heavy', 25, 0) - 1, l25sq: at('heavy', 25, 10, 5) / at('heavy', 25, 0, 5) - 1, l1: at('heavy', 1, 10) / at('heavy', 1, 0) - 1,
      steps: Array.from({ length: 10 }, (_, r) => at('heavy', 25, r + 1) - at('heavy', 25, r)),
      max: { infantry: at('infantry', 25, 10, 5), heavy: at('heavy', 25, 10, 5), medic: at('medic', 25, 10, 5), sniper: at('sniper', 25, 10, 5) } };
  });
  check('A7 max HP training ≈ +35-45% on a Level 25 soldier (+46.4%; +42.1% with max Squad HP; +57.5% at L1)', hpMax.l25 >= 0.35 && hpMax.l25 <= 0.47 && hpMax.l25sq >= 0.35 && hpMax.l25sq <= 0.45, `L25 +${(hpMax.l25 * 100).toFixed(1)}%, L25+squad +${(hpMax.l25sq * 100).toFixed(1)}%, L1 +${(hpMax.l1 * 100).toFixed(1)}%; Heavy steps ${hpMax.steps.map((x) => x.toFixed(2)).join('/')}`);
  check('A8 class identity kept: fully trained Heavy far tougher than Sniper / Medic', hpMax.max.heavy > 1.8 * hpMax.max.sniper && hpMax.max.heavy > 1.8 * hpMax.max.medic, JSON.stringify(Object.fromEntries(Object.entries(hpMax.max).map(([k, v]) => [k, r2(v)]))));
  const caps = { acc: tab.ind.accuracy.bonus[10], rate: tab.ind.fireRate.bonus[10], move: tab.ind.moveSpeed.bonus[10], sAcc: tab.sqd.accuracy.bonus[10], sRate: tab.sqd.fireRate.bonus[10], sHp: tab.sqd.hp.bonus[10], sDmg: tab.sqd.damage.bonus[10] };
  check('A9 caps: fire rate ≤ +35% (+25% squad, v0.7D), move speed ≤ +22.5%, spread ≥ -55% (-50% squad, v0.7D)', caps.rate <= 0.35 + 1e-9 && caps.sRate <= 0.25 + 1e-9 && caps.move <= 0.225 + 1e-9 && caps.acc >= -0.55 - 1e-9 && caps.sAcc >= -0.5 - 1e-9, JSON.stringify(caps));
  const flo = await page.evaluate(() => {
    const P = window.__progression, e = window.__effectiveStats;
    const s = { classId: 'sniper', traitId: 'sharpshooter', mods: {}, progression: { level: 25, xp: P.xpForLevel(25), upgrades: [], specialization: 'snp-deadeye', tier: 'elite', elitePath: 'snp-deadeye', eliteLevel: 30, eliteXp: window.__elite.eliteXpForLevel(30) }, training: { accuracy: 10, damage: 10, hp: 10, fireRate: 10, moveSpeed: 10 } };
    const r = e(s, { level: 25, training: s.training, squad: { hp: 10, damage: 10, accuracy: 10, fireRate: 10 } });
    return { acc: r.accuracy, mp: r.movePenalty, rate: r.fireRate, move: r.moveSpeed };
  });
  check('A10 spread floor (1°) still holds for a fully trained Elite 30 Sharpshooter Sniper', flo.acc >= 1 - 1e-9 && flo.mp > 0, JSON.stringify(flo));

  // ================= B. stat pipeline =================
  const pipe = await page.evaluate(() => {
    const g = window.game, P = window.__progression, e = window.__effectiveStats, C = window.__CFG;
    window.__debugUnlockAll();
    const a = T.a; a.squadTraining = { hp: 3, damage: 2, accuracy: 1, fireRate: 4 };
    // Ace: Sharpshooter Infantry, Elite 30 Recon; Tank: Tough Heavy L17; both trained
    T.spec('ace', 'inf-recon', 30); T.R.get('ace').training = { accuracy: 6, damage: 10, hp: 7, fireRate: 3, moveSpeed: 9 };
    T.recruit('tank'); T.lv('tank', 17); T.R.get('tank').training = { accuracy: 2, damage: 4, hp: 10, fireRate: 8, moveSpeed: 0 };
    const B = (d, r) => d.bonus[r];
    const TR = P.TRAINING, SQ = P.SQUAD_TRAINING, G = P.PROGRESSION.growth, TRAITS = window.__TRAITS;
    const exp = (id) => {
      const s = T.R.get(id), b = C[s.classId], lvl = s.progression.level, t = TRAITS[s.traitId].mods, el = window.__elite.eliteLevelModifiers ? null : null;
      const f = { hp: G.hp * (lvl - 1) + B(TR.hp, s.training.hp) + B(SQ.hp, a.squadTraining.hp), damage: G.damage * (lvl - 1) + B(TR.damage, s.training.damage) + B(SQ.damage, a.squadTraining.damage), fireRate: G.fireRate * (lvl - 1) + B(TR.fireRate, s.training.fireRate) + B(SQ.fireRate, a.squadTraining.fireRate) };
      return { hp: b.hp * (1 + f.hp), damage: b.damage * (1 + f.damage), fireRate: b.fireRate * (1 + f.fireRate), tm: t };
    };
    const out = {};
    for (const id of ['ace', 'tank']) {
      const s = T.R.get(id), real = e(s), x = exp(id);
      // remove the trait and Elite multipliers by comparing with the same soldier at rank 0 of everything and the same multipliers
      const zero = e(s, { level: s.progression.level, training: P.newTraining(), squad: P.newSquadTraining() });
      const mulHp = zero.hp / (C[s.classId].hp * (1 + G.hp * (s.progression.level - 1)));
      const mulDmg = zero.damage / (C[s.classId].damage * (1 + G.damage * (s.progression.level - 1)));
      const mulRate = zero.fireRate / (C[s.classId].fireRate * (1 + G.fireRate * (s.progression.level - 1)));
      out[id] = { hp: [real.hp, x.hp * mulHp], damage: [real.damage, x.damage * mulDmg], fireRate: [real.fireRate, x.fireRate * mulRate], mul: [mulHp, mulDmg, mulRate] };
    }
    // no stacking across deploy / retry / re-read
    g.selectMission('bridgehead', true);
    const reads = [];
    for (let i = 0; i < 3; i++) { if (i === 0) g.deploy([T.R.get('ace'), T.R.get('tank')], 'roster'); else g.reset(); reads.push(g.soldiers.map((u) => `${u.maxHp.toFixed(4)}/${u.stats.damage.toFixed(4)}`).join(',')); }
    g.toBarracks();
    const cfgSame = C.infantry.damage === 10 && C.heavy.hp === 150 && C.sniper.damage === 32 && C.medic.hp === 80;
    return { out, reads, cfgSame, eliteCaps: [C.elite.maxDamageReduction, C.elite.maxShotMul], acePath: T.R.get('ace').progression.elitePath };
  });
  const close = (p) => Math.abs(p[0] - p[1]) < 1e-6;
  check('B1 training enters once: (1 + growth + training + squad) x trait x Elite level (Elite 30 Recon, Recruit L17 Tough)', ['ace', 'tank'].every((id) => close(pipe.out[id].hp) && close(pipe.out[id].damage) && close(pipe.out[id].fireRate)),
    `ace hp ${pipe.out.ace.hp.map(r2)} dmg ${pipe.out.ace.damage.map(r2)} mul ${pipe.out.ace.mul.map((x) => x.toFixed(4))}; tank hp ${pipe.out.tank.hp.map(r2)} mul ${pipe.out.tank.mul.map((x) => x.toFixed(4))}`);
  check('B2 Elite 30 bonus still +25% HP / +15% damage on top of training (Recon, Sharpshooter trait = spread only; fire rate not Elite-scaled)', Math.abs(pipe.out.ace.mul[0] - 1.25) < 1e-6 && Math.abs(pipe.out.ace.mul[1] - 1.15) < 1e-6 && Math.abs(pipe.out.ace.mul[2] - 1) < 1e-6, pipe.out.ace.mul.map((x) => x.toFixed(4)).join(' / '));
  check('B3 no stacking across deploy + retry + re-read (identical max HP / damage)', pipe.reads.every((x) => x === pipe.reads[0]), pipe.reads.join(' | '));
  check('B4 class base (CFG) never mutated; combat caps unchanged (reduction 40%, per shot x2)', pipe.cfgSame && pipe.eliteCaps.join() === '0.4,2', pipe.eliteCaps.join());
  // caps hold in combat with a fully trained Elite 30 Deadeye + Rally (per-shot multiplier) and Juggernaut + Adrenaline (reduction)
  const capRun = await page.evaluate(() => {
    const g = window.game, C = window.__CFG;
    const s = T.sniper(); T.spec(s.id, 'snp-deadeye', 30); s.training = { accuracy: 10, damage: 10, hp: 10, fireRate: 10, moveSpeed: 10 };
    T.spec('tank', 'hvy-juggernaut', 30); T.R.get('tank').training.hp = 10;
    g.selectMission('bridgehead', true);
    g.deploy([s, T.R.get('tank')], 'roster');
    const [u, tk] = g.soldiers;
    const out = {};
    // incoming: Juggernaut under Adrenaline-like conditions is reported by the game's own damage path
    tk.hp = tk.maxHp; const h0 = tk.hp; g.damage(tk, 100, null); out.reduction = 1 - (h0 - tk.hp) / 100;
    out.maxHp = tk.maxHp;
    out.shotDmg = u.stats.damage;
    g.toBarracks();
    return { ...out, cap: C.elite.maxDamageReduction };
  }).catch((e) => ({ err: String(e) }));
  check('B5 fully trained Elite 30 Juggernaut: incoming reduction within the 40% cap; finite HP', !capRun.err && capRun.reduction <= capRun.cap + 1e-9 && capRun.reduction >= 0 && Number.isFinite(capRun.maxHp), JSON.stringify(capRun));

  // ================= C. preview = post-purchase =================
  const pv = await page.evaluate(async () => {
    const g = window.game, a = T.a;
    window.__debugUnlockAll();
    T.recruit('havoc'); T.lv('havoc', 13); T.R.get('havoc').training = { accuracy: 9, damage: 4, hp: 0, fireRate: 9, moveSpeed: 3 };
    T.spec('doc', 'med-surgeon', 12); T.R.get('doc').training = { accuracy: 0, damage: 9, hp: 4, fireRate: 0, moveSpeed: 0 };
    a.credits = 100000;
    const rows = [];
    for (const id of ['havoc', 'doc']) {
      for (const stat of ['damage', 'hp', 'fireRate', 'accuracy', 'moveSpeed']) {
        g.toBarracks(); g.ui.menus.trainId = id; g.ui.menus.tab = 'training'; g.ui.menus.showBarracks();
        const row = document.querySelector(`.t-row[data-stat="${stat}"]`);
        const shown = row.querySelector('.t-val b')?.textContent ?? '';
        const gain = row.querySelector('.t-gain')?.textContent ?? '';
        const btn = row.querySelector('.t-buy:not([disabled])');
        if (!btn) { rows.push({ id, stat, shown, max: true }); continue; }
        const r0 = T.R.get(id).training[stat];
        btn.click(); await new Promise((r) => setTimeout(r, 30));
        const confirm = document.querySelector('[data-a="confirm-buy"], .m-modal [data-a="yes"]');
        if (confirm) { confirm.click(); await new Promise((r) => setTimeout(r, 30)); }
        g.ui.menus.trainId = id; g.ui.menus.tab = 'training'; g.ui.menus.showBarracks();
        const after = document.querySelector(`.t-row[data-stat="${stat}"] .t-val`).childNodes[0].textContent.replace('→', '').trim();
        rows.push({ id, stat, shown, after, gain, bought: T.R.get(id).training[stat] === r0 + 1 });
      }
    }
    return rows;
  });
  check('C1 Training preview = the value shown after buying (Recruit L13 Trigger Happy, Elite 12 Surgeon; all 5 stats)', pv.length === 10 && pv.every((r) => r.max || (r.bought && r.shown === r.after)), pv.map((r) => `${r.id}.${r.stat} ${r.shown}${r.after !== undefined ? `=${r.after}` : ''}`).join(' · '));
  check('C2 preview shows the real improvement and the rank being bought ("+x damage · rank n")', pv.filter((r) => !r.max).every((r) => /^[+−][\d.]+.* · rank \d+$/.test(r.gain)), pv.map((r) => r.gain).join(' | '));
  const pvExact = await page.evaluate(() => {
    const g = window.game, e = window.__effectiveStats, P = window.__progression, a = T.a;
    const s = T.R.get('havoc'); s.training.damage = 9; g.toBarracks(); g.ui.menus.trainId = 'havoc'; g.ui.menus.tab = 'training'; g.ui.menus.showBarracks();
    const row = document.querySelector('.t-row[data-stat="damage"]');
    const next = e(s, { level: s.progression.level, training: { ...s.training, damage: 10 }, squad: a.squadTraining }).damage;
    const cur = e(s).damage;
    return { shown: row.querySelector('.t-val b').textContent, gain: row.querySelector('.t-gain').textContent, cost: row.querySelector('.t-buy').textContent, next, cur, rank: row.querySelector('.t-rk').textContent };
  });
  check('C3 rank 9 -> 10 row: current / next / +gain / 2,500 CR match the pipeline', pvExact.shown === String(Math.round(pvExact.next * 100) / 100) && pvExact.gain.startsWith(`+${Math.round((pvExact.next - pvExact.cur) * 100) / 100} damage`) && pvExact.cost === '2,500 CR' && /RANK 9\/10/.test(pvExact.rank), JSON.stringify(pvExact));

  // ================= D. mission XP =================
  const xp = await page.evaluate(() => {
    const P = window.__progression, C = window.__campaign;
    const curve = Array.from({ length: 50 }, (_, i) => P.missionXp(i + 1));
    const oc = (missionId, statuses = ['Standing', 'Standing'], downs = [0, 0], optional = { total: 0, completed: 0 }) => ({ missionId, runId: 'r', won: true, deployed: statuses.map((s, i) => ({ id: 'a' + i, status: s, downs: downs[i] })), optional });
    const played = C.CAMPAIGN.map((m) => ({ id: m.id, n: m.number, first: P.computeMissionRewards(oc(m.id, ['Standing'], [1]), true), replay: P.computeMissionRewards(oc(m.id, ['Standing'], [1]), false) }));
    const allCredits = [];
    for (const m of C.CAMPAIGN.filter((x) => x.number <= 12)) for (const fc of [true, false]) for (const [st, dn] of [[['Standing', 'Standing'], [0, 0]], [['Standing', 'KIA'], [0, 1]], [['Standing', 'Standing'], [1, 0]]]) for (const opt of [{ total: 0, completed: 0 }, { total: 2, completed: 1 }, { total: 1, completed: 1 }]) allCredits.push(P.computeMissionRewards(oc(m.id, st, dn, opt), fc).credits);
    return { curve, played, allCredits, lines: P.computeMissionRewards(oc('iron-fist', ['Standing', 'Standing'], [0, 0], { total: 1, completed: 1 }), true).xpLines };
  });
  const c = xp.curve;
  check('D1 mission XP rises with every mission 1 -> 50 (never flat, never down)', c.every((v, i) => i === 0 || v > c[i - 1]) && c.every((v) => v % 5 === 0), [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((n) => `M${n} ${c[n - 1]}`).join(' · '));
  check('D2 targets: M1 125, M5 150, M10 200, M15 250, M20 300, M25 350, M30 400, M35 450, M40 500, M45 550, M50 600', [125, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600].every((v, i) => c[[1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50][i] - 1] === v), '');
  check('D3 Mission 40 ≈ 500 base XP, Mission 50 ≈ 600 (exact)', c[39] === 500 && c[49] === 600, `${c[39]} / ${c[49]}`);
  check('D4 Missions 1-10 in play pay their own number (Victory line), applied once', xp.played.every((m) => m.first.xpLines[0].label === 'Victory' && m.first.xpLines[0].amount === c[m.n - 1] && m.first.xpLines.filter((l) => l.label === 'Victory').length === 1), xp.played.map((m) => `M${m.n} ${m.first.xpEach}`).join(' '));
  check('D5 replays: the replayed mission\'s own XP x 0.75 (Mission 4: (145 + 25 whole squad) x 0.75 = 128, below its first clear 170)', xp.played.every((m) => m.replay.xpLines[0].amount === c[m.n - 1] && m.replay.xpEach === Math.floor(m.first.xpEach * 0.75 + 0.5) && m.replay.xpEach < m.first.xpEach) && xp.played[3].replay.xpEach === 128 && xp.played[3].first.xpEach === 170, xp.played.map((m) => `M${m.n} ${m.replay.xpEach}`).join(' '));
  check('D6 bonus lines unchanged (+25 per optional / whole squad / nobody downed), not scaled', xp.lines.map((l) => `${l.label}:${l.amount}`).join() === 'Victory:200,Optional objectives 1/1:25,Whole squad extracted:25,Nobody downed:25', xp.lines.map((l) => `${l.label}:${l.amount}`).join());
  const settle = await page.evaluate(() => {
    const g = window.game, E = T.E, P = T.P, a = T.a;
    window.__debugUnlockAll();
    T.recruit('ace'); T.lv('ace', 1); T.R.get('ace').progression.xp = 0;
    const o = (missionId, runId) => ({ missionId, runId, won: true, deployed: [{ id: 'ace', status: 'Standing', downs: 1 }], optional: { total: 0, completed: 0 }, stars: 1 });
    a.missions = {};
    const r1 = E.settleMission(T.R, a, o('red-canyon', 'x1'));
    const r2 = E.settleMission(T.R, a, o('red-canyon', 'x2'));
    const r3 = E.settleMission(T.R, a, o('red-canyon', 'x2'));
    // an Elite banks the same scaled XP into eliteXp
    T.spec('tank', 'hvy-juggernaut', 1); const e0 = T.R.get('tank').progression.eliteXp;
    const r4 = E.settleMission(T.R, a, { ...o('iron-fist', 'x4'), deployed: [{ id: 'tank', status: 'Standing', downs: 1 }] });
    return { r1: [r1.firstClear, r1.xpEach, r1.credits], r2: [r2.firstClear, r2.xpEach, r2.credits], r3, ace: T.R.get('ace').progression.xp, elite: T.R.get('tank').progression.eliteXp - e0, r4: r4.xpEach, r4first: r4.firstClear };
  });
  check('D7 settlement: Mission 4 first clear 145 + 25 = 170 XP, replay 128 XP (Mission 4\'s own value), same run never paid twice', settle.r1[0] && settle.r1[1] === 170 && !settle.r2[0] && settle.r2[1] === 128 && settle.r3 === null && settle.ace === 298, JSON.stringify(settle));
  check('D8 Elite soldiers bank the scaled XP (Mission 10 first clear: 200 + 25 = 225 Elite XP)', settle.elite === 225 && settle.r4 === 225 && settle.r4first, `${settle.elite}`);
  if (basePage) {
    const bx = await basePage.evaluate(() => {
      const P = window.__progression, C = window.__campaign, EL = window.__elite;
      const oc = (missionId, statuses, downs, optional) => ({ missionId, runId: 'r', won: true, deployed: statuses.map((s, i) => ({ id: 'a' + i, status: s, downs: downs[i] })), optional });
      const allCredits = [];
      for (const m of C.CAMPAIGN.filter((x) => x.number <= 12)) for (const fc of [true, false]) for (const [st, dn] of [[['Standing', 'Standing'], [0, 0]], [['Standing', 'KIA'], [0, 1]], [['Standing', 'Standing'], [1, 0]]]) for (const opt of [{ total: 0, completed: 0 }, { total: 2, completed: 1 }, { total: 1, completed: 1 }]) allCredits.push(P.computeMissionRewards(oc(m.id, st, dn, opt), fc).credits);
      return { allCredits, credits: JSON.stringify(P.PROGRESSION.credits), recruit: Array.from({ length: 26 }, (_, l) => P.xpForLevel(l)), elite: Array.from({ length: 31 }, (_, l) => EL.eliteXpForLevel(l)), growth: JSON.stringify(P.PROGRESSION.growth), promo: EL.PROMOTION_COST ?? null };
    });
    const nx = await page.evaluate(() => { const P = window.__progression, EL = window.__elite; return { credits: JSON.stringify(P.PROGRESSION.credits), recruit: Array.from({ length: 26 }, (_, l) => P.xpForLevel(l)), elite: Array.from({ length: 31 }, (_, l) => EL.eliteXpForLevel(l)), growth: JSON.stringify(P.PROGRESSION.growth), promo: EL.PROMOTION_COST ?? null }; });
    check('D9 Credit rewards identical to v0.7B for every mission x first / replay x outcome x optionals (54 x 2 cases)', JSON.stringify(xp.allCredits) === JSON.stringify(bx.allCredits) && nx.credits === bx.credits, `${xp.allCredits.length} cases`);
    check('D10 Recruit (L25 = 10,500) and Elite (E30 = 35,670) thresholds, level growth and promotion cost identical to v0.7B', JSON.stringify(nx.recruit) === JSON.stringify(bx.recruit) && JSON.stringify(nx.elite) === JSON.stringify(bx.elite) && nx.growth === bx.growth && nx.promo === bx.promo && nx.recruit[25] === 10500 && nx.elite[30] === 35670, `L25 ${nx.recruit[25]}, E30 ${nx.elite[30]}, promo ${nx.promo}`);
  } else {
    const nx = await page.evaluate(() => ({ r: window.__progression.xpForLevel(25), e: window.__elite.eliteXpForLevel(30) }));
    check('D10 Recruit L25 = 10,500 XP and Elite 30 = 35,670 XP (no BASE: absolute values only)', nx.r === 10500 && nx.e === 35670, JSON.stringify(nx));
  }

  // ================= E. stats vs v0.7B, saves =================
  if (basePage) {
    // a v0.7B save with training on Recruits, an Elite and squad training
    const mk = () => {
      window.__debugUnlockAll(); const a = T.a;
      T.recruit('havoc'); T.lv('havoc', 18); T.R.get('havoc').training = { accuracy: 3, damage: 10, hp: 5, fireRate: 7, moveSpeed: 2 };
      T.spec('ace', 'inf-trooper', 9); T.R.get('ace').training = { accuracy: 10, damage: 6, hp: 10, fireRate: 1, moveSpeed: 10 };
      T.recruit('ranger'); T.lv('ranger', 4);
      a.squadTraining = { hp: 5, damage: 3, accuracy: 2, fireRate: 1 }; a.credits = 12345;
      window.__persist();
      const st = (id) => { const e = window.__effectiveStats(T.R.get(id)); return { hp: e.hp, damage: e.damage, fireRate: e.fireRate, accuracy: e.accuracy, moveSpeed: e.moveSpeed }; };
      return { raw: localStorage.getItem(window.__SAVE_KEY), stats: { havoc: st('havoc'), ace: st('ace'), ranger: st('ranger') } };
    };
    await fresh(basePage, BASE);
    const old = await basePage.evaluate(mk);
    await fresh(page, URL, old.raw);
    const now = await page.evaluate(() => {
      const st = (id) => { const e = window.__effectiveStats(T.R.get(id)); return { hp: e.hp, damage: e.damage, fireRate: e.fireRate, accuracy: e.accuracy, moveSpeed: e.moveSpeed }; };
      const ls = window.__loadStatus;
      return { st: ls && ls.status, notes: ls && ls.notes ? ls.notes.length : -1, training: Object.fromEntries(T.R.soldiers.map((s) => [s.id, s.training])), squad: T.a.squadTraining, credits: T.a.credits, stats: { havoc: st('havoc'), ace: st('ace'), ranger: st('ranger') }, raw: localStorage.getItem(window.__SAVE_KEY) };
    });
    const oldSave = JSON.parse(old.raw);
    const rankSame = oldSave.roster.every((s) => JSON.stringify(s.training) === JSON.stringify(now.training[s.id])) && JSON.stringify(oldSave.account.squadTraining) === JSON.stringify(now.squad);
    check('E1 v0.7B save loads as-is (v9, no migration): every training rank, squad rank and Credit kept', now.st === 'loaded' && now.notes === 0 && rankSame && now.credits === 12345 && JSON.parse(now.raw).version === 9, `${now.st}, notes ${now.notes}, credits ${now.credits}`);
    // Phase 2: the v0.7B side is the recorded output of mk() on the v0.7B build (095bba2). It used to be old.stats from BASE, so E2 only
    // passed with BASE=<v0.7B> and failed against any newer base (same stats on both sides: the v0.8B.1 "E2" failure), while D9 / E5
    // need the latest release as BASE.
    const v07b = { havoc: { hp: 228, damage: 8.835, fireRate: 9.59175, accuracy: 12.15, moveSpeed: 124.8 }, ace: { hp: 196.689655, damage: 14.631379, fireRate: 3.48, accuracy: 4.830952, moveSpeed: 180 } };
    const better = ['havoc', 'ace'].every((id) => now.stats[id].hp > v07b[id].hp && now.stats[id].damage > v07b[id].damage && now.stats[id].accuracy < v07b[id].accuracy && now.stats[id].moveSpeed >= v07b[id].moveSpeed && now.stats[id].fireRate >= v07b[id].fireRate);
    check('E2 previously trained soldiers get the new benefits automatically (every stat ≥ v0.7B, no repurchase)', better, `havoc dmg ${r2(v07b.havoc.damage)} -> ${r2(now.stats.havoc.damage)}, hp ${r2(v07b.havoc.hp)} -> ${r2(now.stats.havoc.hp)}; ace (Elite 9) hp ${r2(v07b.ace.hp)} -> ${r2(now.stats.ace.hp)}, cone ${r2(v07b.ace.accuracy)} -> ${r2(now.stats.ace.accuracy)}`);
    // only squad training applies to Ranger: rank 0 individual
    const same0 = await (async () => {
      await fresh(basePage, BASE); await fresh(page, URL);
      const f = () => { window.__debugUnlockAll(); const out = {}; for (const s of T.R.soldiers) for (const L of [1, 9, 25]) { T.lv(s.id, L); const e = window.__effectiveStats(s); out[`${s.id}${L}`] = [e.hp, e.damage, e.fireRate, e.accuracy, e.movePenalty, e.moveSpeed, e.reviveTime, e.healMul, e.aimTime ?? 0].join(); } return out; };
      return JSON.stringify(await basePage.evaluate(f)) === JSON.stringify(await page.evaluate(f));
    })();
    check('E3 untrained Recruits (L1 / 9 / 25, every trait) identical to v0.7B', same0, '');
    const r1same = await (async () => {
      const f = () => { window.__debugUnlockAll(); const out = {}; for (const s of T.R.soldiers) { T.lv(s.id, 12); s.training = { accuracy: 1, damage: 1, hp: 1, fireRate: 1, moveSpeed: 1 }; T.a.squadTraining = { hp: 0, damage: 0, accuracy: 0, fireRate: 0 }; const e = window.__effectiveStats(s); out[s.id] = [e.hp, e.damage, e.fireRate, e.accuracy, e.moveSpeed].join(); } return out; };
      return JSON.stringify(await basePage.evaluate(f)) === JSON.stringify(await page.evaluate(f));
    })();
    check('E4 rank 1 of every individual category identical to v0.7B (v0.7D squad rank 1 is stronger by design)', r1same, '');
    const enemies = async (p) => p.evaluate(() => { const C = window.__CFG; return JSON.stringify(Object.fromEntries(Object.entries(C).filter(([k]) => !['infantry', 'heavy', 'medic', 'sniper', 'debug', 'perf', 'airstrike', 'nuke', 'support', 'turret', 'commandCenter', 'defense', 'escortTruck', 'mountedGun'].includes(k)))); });
    check('E5 enemies, bosses, abilities and Elite passives tuning identical to v0.7B (no Mission 1-10 difficulty change)', (await enemies(page)) === (await enemies(basePage)), '');
  }
  await fresh();
  const sv = await page.evaluate(async () => {
    window.__debugUnlockAll();
    const s = T.R.get('doc'); s.training = { accuracy: 4, damage: 7, hp: 10, fireRate: 2, moveSpeed: 5 };
    T.a.squadTraining = { hp: 4, damage: 1, accuracy: 0, fireRate: 3 };
    window.__persist();
    return { tr: JSON.stringify(s.training), hp: window.__effectiveStats(s).hp };
  });
  await page.reload(); await page.waitForFunction(() => !!window.game);
  const sv2 = await page.evaluate(() => ({ tr: JSON.stringify(T.R.get('doc').training), hp: window.__effectiveStats(T.R.get('doc')).hp, sq: JSON.stringify(T.a.squadTraining) }));
  check('E6 save / reload keeps training ranks and the resulting stats', sv.tr === sv2.tr && sv.hp === sv2.hp && sv2.sq === '{"hp":4,"damage":1,"accuracy":0,"fireRate":3}', `${sv2.tr} hp ${sv2.hp}`);
  const kia = await page.evaluate(() => {
    const g = window.game, E = T.E, a = T.a;
    const s = T.R.get('doc'); const tr0 = JSON.stringify(s.training), hp0 = window.__effectiveStats(s).hp;
    E.settleMission(T.R, a, { missionId: 'first-contact', runId: 'kia-1', won: false, deployed: [{ id: 'doc', status: 'KIA', downs: 1, cause: 'bleedout' }], optional: { total: 0, completed: 0 } });
    const st = s.status;
    a.credits += 50000; const r = E.resurrect(T.R, a, 'doc', null);
    return { st, ok: r.ok, after: s.status, same: JSON.stringify(s.training) === tr0, hp: window.__effectiveStats(s).hp === hp0 };
  });
  check('E7 KIA + resurrection keeps every training rank and the trained stats', kia.st === 'kia' && kia.ok && kia.after === 'active' && kia.same && kia.hp, JSON.stringify(kia));

  // ================= F. mobile =================
  for (const dev of [{ name: 'iphoneSE', w: 667, h: 375, dpr: 2 }, { name: 'iphone14', w: 844, h: 390, dpr: 3 }, { name: 'pixel7', w: 915, h: 412, dpr: 2.625 }]) {
    const c2 = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: true, hasTouch: true });
    await c2.addInitScript(installHelpers);
    const p = await c2.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await fresh(p);
    const m = await p.evaluate(() => {
      window.__debugUnlockAll(); T.spec('ace', 'inf-trooper', 14); T.R.get('ace').training = { accuracy: 9, damage: 4, hp: 10, fireRate: 0, moveSpeed: 6 }; T.a.credits = 3000;
      const g = window.game; g.toBarracks(); g.ui.menus.trainId = 'ace'; g.ui.menus.tab = 'training'; g.ui.menus.showBarracks();
      // v0.8B.1: the Ability Capacity row (.t-cap) sits under the five stat rows; it must exist and fit too.
      const all = [...document.querySelectorAll('.t-row')], rows = all.filter((r) => !r.classList.contains('t-cap')), cap = all.length - rows.length;
      const over = document.documentElement.scrollWidth > window.innerWidth + 1;
      const clipped = all.some((r) => { const b = r.getBoundingClientRect(); return b.right > window.innerWidth + 1; });
      const gains = rows.map((r) => r.querySelector('.t-gain')).filter(Boolean);
      const vis = gains.every((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.right <= window.innerWidth + 1; });
      return { rows: rows.length, cap, over, clipped, gains: gains.length, vis, minFont: Math.min(...gains.map((x) => parseFloat(getComputedStyle(x).fontSize))) };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/${dev.name}-landscape-training.png` });
    check(`F ${dev.name} landscape: Training tab fits (no horizontal overflow), every non-max row shows its gain (≥ 11px)`, m.rows === 5 && m.cap === 1 && !m.over && !m.clipped && m.gains === 4 && m.vis && m.minFont >= 11 && errs.length === 0, JSON.stringify(m));
    await c2.close();
  }

  // ================= G. long runs =================
  if (!QUICK) {
    const SEED = 4242;
    const init = ({ seed }) => {
      let s = seed >>> 0;
      Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      let q = [], now = 1000;
      window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
      window.__drive = (period, until) => { let n = 0; while (!until() && n < 1e6) { now += period; const cbs = q; q = []; for (const cb of cbs) cb(now); n++; } return n; };
    };
    const setup = ({ mission, squad: sq0 }) => {
      const g = window.game, P = window.__progression, EL = window.__elite;
      window.__debugUnlockAll();
      const a = window.__account(), E = window.__economy;
      a.squadTraining = { hp: 10, damage: 10, accuracy: 10, fireRate: 10 }; // v0.7D max
      const squad = sq0.map(([id, sp]) => {
        if (!id.startsWith('sniper')) return [id, sp];
        if (!a.classUnlocks.unlocked.includes('sniper')) { a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper'); }
        E.openOffice(g.roster, a, null);
        let o = null; for (let i = 0; i < 300 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'sniper'); if (!o) { a.credits += 100; E.refreshOffers(g.roster, a, null, null); } }
        a.credits += 5000; return [E.recruit(g.roster, a, o.id, null).soldier.id, sp];
      });
      for (const [id, sp] of squad) {
        const s = g.roster.get(id); if (!s) continue;
        s.progression.xp = P.xpForLevel(25); s.progression.level = 25; s.training = { accuracy: 10, damage: 10, hp: 10, fireRate: 10, moveSpeed: 10 };
        if (sp) { s.progression.tier = 'elite'; s.progression.elitePath = sp; s.progression.specialization = sp; s.progression.eliteLevel = 30; s.progression.eliteXp = EL.eliteXpForLevel(30); }
      }
      g.selectMission(mission, true);
      const r = g.deploy(squad.map(([id]) => g.roster.get(id)).filter(Boolean).slice(0, g.capacity), 'roster');
      return r.ok ? g.soldiers.map((s) => s.elite ? s.elite.id : s.classDef.id).join() : r.reason;
    };
    const hashState = () => {
      const g = window.game, m = g.mission, r = (x) => Math.round(x * 1000);
      const u = (x) => [r(x.pos.x), r(x.pos.y), r(x.hp), x.state, r(x.bleed ?? 0), r(x.reviveProgress ?? 0), r(x.aim), r(x.fireCooldown), x.ability ? r(x.ability.cooldownLeft) : 0, x.shots, x.hits];
      const st = JSON.stringify([r(g.time), g.phase, m.phase, g.soldiers.map(u), g.npcs.map(u), g.enemies.map(u), g.projectiles.map((p) => [r(p.pos.x), r(p.pos.y), r(p.damage)]), g.grenades.length, m.primaries.map((o) => o.state)]);
      let h = 2166136261; for (let i = 0; i < st.length; i++) { h ^= st.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    };
    const SQUADS = {
      a: [['ace', 'inf-trooper'], ['havoc', 'hvy-weapons'], ['doc', 'med-surgeon'], ['patch', 'med-commander'], ['tank', 'hvy-juggernaut'], ['ranger', 'inf-recon']],
      c: [['sniper1', 'snp-deadeye'], ['sniper2', 'snp-ghost'], ['patch', 'med-commander'], ['tank', 'hvy-juggernaut'], ['ace', 'inf-trooper']],
      b: [['ace', 'inf-recon'], ['tank', 'hvy-weapons'], ['patch', 'med-commander'], ['doc', 'med-commander'], ['havoc', 'hvy-juggernaut'], ['ranger', null]],
    };
    const run = async (mission, squadKey, hz, cap, secs) => {
      const c3 = await browser.newContext({ viewport: { width: 844, height: 390 } });
      const p = await c3.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      await p.addInitScript(init, { seed: SEED });
      await p.goto(URL + `?fps=${cap}`); await p.evaluate(() => localStorage.clear());
      await p.goto(URL + `?fps=${cap}`); await p.waitForFunction(() => !!window.game);
      const squad = await p.evaluate(setup, { mission, squad: SQUADS[squadKey] });
      await p.evaluate(installPilot);
      const res = await p.evaluate(({ hz, secs, hashSrc }) => {
        const hash = eval(`(${hashSrc})`);
        const g = window.game, P = window.__pilot, u0 = g.update.bind(g); let steps = 0; const out = [];
        g.update = (dt) => { if (g.phase === 'playing') { P.step(); steps++; } u0(dt); if (steps % 300 === 0 && out.length < steps / 300) out.push(hash()); };
        window.__drive(1000 / hz, () => steps >= secs * 60 || g.phase !== 'playing');
        return { hashes: out, steps, phase: g.phase, t: +g.time.toFixed(2), projectiles: g.projectiles.length };
      }, { hz, secs, hashSrc: hashState.toString() });
      await c3.close();
      return { ...res, squad, errs };
    };
    for (const [mission, sq, secs] of [['iron-fist', 'a', 90], ['red-canyon', 'c', 75]]) {
      const ref = await run(mission, sq, 60, 60, secs);
      let ok = true; const notes = [];
      for (const [hz, cap] of [[120, 30], [60, 30], [90, 60]]) {
        const r = await run(mission, sq, hz, cap, secs);
        const d = r.hashes.findIndex((h, i) => h !== ref.hashes[i]);
        if (d >= 0 || r.hashes.length !== ref.hashes.length) { ok = false; notes.push(`${hz}Hz/cap${cap} differs at ${(d + 1) * 5}s`); }
        if (r.errs.length) { ok = false; notes.push(r.errs[0]); }
      }
      check(`G ${mission}: fully trained Elite 30 squad; 30 / 60 FPS caps (60 / 90 / 120 Hz) simulate identically`, ok && ref.errs.length === 0 && ref.hashes.length >= 5, notes.join('; ') || `${ref.hashes.length} checkpoints`);
    }
    const rows = []; let bad = 0;
    for (const [i, mission] of MISSIONS.entries()) {
      const r = await run(mission, i % 2 ? 'b' : 'c', 60, 60, 420);
      const ok = r.errs.length === 0 && r.phase === 'won';
      if (!ok) bad++;
      rows.push(`M${i + 1} ${r.phase} t=${r.t}`);
      console.log(`  G M${i + 1} ${mission} (fully trained Elite 30: ${r.squad}): ${r.phase} at t=${r.t}${r.errs.length ? ' ERROR ' + r.errs[0] : ''}`);
    }
    check('G Missions 1-10 all won by fully trained Elite 30 squads (autopilot), no errors', bad === 0, rows.join(' · '));
  }

  check('no page errors (main page)', errors.length === 0, errors[0]);
  await browser.close();
  console.log(fails ? `${fails} of ${total} FAILED` : `ALL ${total} PASS`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
