// v0.7B ELITE PROGRESSION (Elite Levels 2-30): acceptance checks against a served build (headless Chromium).
//
//   npx vite preview --port 4173 &  node tools/elite-progression.cjs
//   BASE=http://localhost:4174/   a v0.7A build: Elite Level 1 and Recruit stats must match it exactly
//   OUT=dir                       screenshots (Results, profile, Barracks on three phones)
//   QUICK=1                       skips the long autopilot runs (Missions 1-10, 30 / 60 FPS parity)
//
//  A. XP curve: 600 + 45 x (L - 1), 35,670 XP Elite 1 -> 30, level derived from cumulative Elite XP
//  B. Stats: Elite 1 = v0.7A; Elite 30 = +25% max HP, +15% damage, class extra; linear; no fire-rate /
//     move-speed growth; stacks with training / traits / squad training as one multiplier
//  C. Settlement: XP accumulates, thresholds, several levels from one award, cap, no duplicate grant
//  D. Passives at Elite 1 / 15 / 30 (same triggers and ratios), caps (40% reduction, x2 per shot)
//  E. Recruits identical to v0.7A (stats; the simulation is covered by fps-parity.cjs BASE=)
//  F. Save: v9 round trip, genuine v0.7A (v8) save -> v9 (banked XP converts, nothing else changes),
//     invalid / missing values, reload can't grant twice or undo a promotion
//  G. KIA, resurrection and the Memorial keep Elite level and XP
//  H. UI: Results (ELITE LEVEL UP!, several levels, MAX), profile (XP / next / MAX LEVEL, stats,
//     passive), Barracks badge + squad slot, on iPhone SE / iPhone 14 / Pixel 7 landscape
//  I. Elite 30 squads: Missions 1-10 won by the autopilot; 30 / 60 FPS caps simulate identically
// PASS/FAIL per check; exits 1 on any failure.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const { installPilot } = require('./perf-lib.cjs');
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const OUT = process.env.OUT || '';
const QUICK = !!process.env.QUICK;
if (OUT) fs.mkdirSync(OUT, { recursive: true });

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get R() { return window.game.roster; },
    get C() { return window.__CFG; },
    get EL() { return window.__elite; },
    get P() { return window.__progression; },
    step(sec, pin) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (pin) pin(); window.game.update(1 / 60); } },
    stepUntil(cond, maxSec, pin) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (pin) pin(); window.game.update(1 / 60); n++; } return n / 60; },
    calm() { const g = window.game; for (const e of g.enemies) if (!e.structure && !e.vehicle && e.kind !== 'boss') e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active); g.input.move = () => ({ x: 0, y: 0 }); },
    deploy(ids, mission = 'bridgehead', calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.calm();
      return r;
    },
    lv(id, level) { const P = window.__progression, p = this.R.get(id).progression; p.xp = P.xpForLevel(level); p.level = P.levelForXp(p.xp); },
    recruit(id) { const p = this.R.get(id).progression; p.tier = 'recruit'; p.elitePath = null; p.specialization = null; p.eliteLevel = 0; p.eliteXp = 0; },
    /** Test setup only (bypasses the economy): a specialization at an Elite level (XP = that level's threshold). */
    spec(id, spec, el = 1) { const p = this.R.get(id).progression; this.lv(id, 25); p.tier = 'elite'; p.elitePath = spec; p.specialization = spec; p.eliteXp = this.EL.eliteXpForLevel(el); p.eliteLevel = el; },
    unit(id) { return window.game.soldiers.find((s) => s.identity && s.identity.id === id); },
    sniper() {
      const a = this.a;
      if (!a.classUnlocks.unlocked.includes('sniper')) { a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper'); }
      this.E.openOffice(this.R, a, null);
      let o = null; for (let i = 0; i < 300 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'sniper'); if (!o) { a.credits += 100; this.E.refreshOffers(this.R, a, null, null); } }
      a.credits += o.price ?? 5000; return this.E.recruit(this.R, a, o.id, null).soldier;
    },
    dummy(u, d = 220, kind = 'rifleman') {
      const g = window.game;
      const pos = g.findOpenNear({ x: u.pos.x + d, y: u.pos.y }, 40);
      const e = g.spawnEnemy(pos, kind); e.guard = true; e.hp = 1e9; e.maxHp = 1e9; e.fireCooldown = 1e9;
      return e;
    },
    pin(units, enemies = []) { return () => { for (const [u, p] of units) { u.pos = { ...p }; u.vel = { x: 0, y: 0 }; } for (const e of enemies) { e.fireCooldown = 1e9; e.hp = 1e9; } }; },
    store() { return JSON.parse(localStorage.getItem(window.__SAVE_KEY)); },
    /** A real won mission for these soldiers (extraction), through the normal end-of-mission path. */
    win(ids, mission = 'bridgehead') {
      const g = window.game;
      this.deploy(ids, mission);
      g.mission.debugReadyExtraction(g);
      const c = g.mission.extraction.zone; const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
      this.calm(); g.soldiers.forEach((s, i) => { s.pos = { x: cc.x - 20 + i * 30, y: cc.y }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...cc };
      this.stepUntil(() => g.phase !== 'playing', 30, () => { for (const s of g.soldiers) s.vel = { x: 0, y: 0 }; });
      return g.phase;
    },
    /** settleMission with a chosen per-soldier XP award (PROGRESSION.xp.victory swapped for the call). */
    award(ids, xp, runId) {
      const X = this.P.PROGRESSION.xp, v0 = X.victory, m0 = X.replayMul, f0 = X.fullExtraction;
      X.victory = xp; X.replayMul = 1; X.fullExtraction = 0;
      try {
        return this.E.settleMission(this.R, this.a, { missionId: 'first-contact', runId, won: true, deployed: ids.map((id) => ({ id, status: 'Standing', downs: 1 })), optional: { total: 0, completed: 0 }, stars: 1 }, {}, {});
      } finally { X.victory = v0; X.replayMul = m0; X.fullExtraction = f0; }
    },
  };
}

const SPECS = [['ace', 'inf-trooper'], ['ranger', 'inf-recon'], ['tank', 'hvy-juggernaut'], ['havoc', 'hvy-weapons'], ['doc', 'med-surgeon'], ['patch', 'med-commander'], ['sniper', 'snp-ghost'], ['sniper', 'snp-deadeye']];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(100)} ${String(detail).replace(/\s+/g, ' ').slice(0, 260)}`); };
  const fresh = async (raw = null, p = page, url = URL) => {
    await p.goto(url); await p.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await p.goto(url); await p.waitForFunction(() => !!window.game); await p.waitForTimeout(100);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. XP CURVE =================
  await fresh();
  const curve = await ev(() => {
    const EL = T.EL;
    const steps = []; for (let l = 1; l <= 30; l++) steps.push(EL.eliteXpToNext(l));
    const lvAt = (x) => EL.eliteLevelForXp(x);
    let mono = true; for (let l = 2; l <= 30; l++) if (EL.eliteXpForLevel(l) <= EL.eliteXpForLevel(l - 1)) mono = false;
    let formula = true; for (let l = 1; l < 30; l++) if (EL.eliteXpToNext(l) !== 600 + 45 * (l - 1)) formula = false;
    return { first: steps[0], l29: steps[28], l30: steps[29], total: EL.ELITE_MAX_XP(), mono, formula,
      edges: [lvAt(0), lvAt(599), lvAt(600), lvAt(1244), lvAt(1245), lvAt(35669), lvAt(35670), lvAt(1e9), lvAt(NaN), lvAt(-5)].join(),
      prog: JSON.stringify(EL.eliteProgress(700)), progMax: JSON.stringify(EL.eliteProgress(40000)), cfg: JSON.stringify(EL.ELITE_PROGRESSION.xp) };
  });
  check('A1 XP to advance from Elite L = 600 + 45 x (L - 1): 600 at Elite 1, 1,860 at Elite 29, 0 at the cap', curve.formula && curve.first === 600 && curve.l29 === 1860 && curve.l30 === 0, curve.cfg);
  check('A2 cumulative Elite XP Elite 1 -> 30 = 35,670 (strictly increasing thresholds)', curve.total === 35670 && curve.mono, curve.total);
  check('A3 level from cumulative XP: 0/599 -> 1, 600 -> 2, 1,244 -> 2, 1,245 -> 3, 35,669 -> 29, 35,670+ -> 30; NaN / negative -> 1', curve.edges === '1,1,2,2,3,29,30,30,1,1', curve.edges);
  check('A4 progress inside a level (700 XP: 100 / 645 to Elite 3) and MAX at the cap', curve.prog === JSON.stringify({ level: 2, into: 100, need: 645, frac: 100 / 645, max: false }) && JSON.parse(curve.progMax).max === true && JSON.parse(curve.progMax).level === 30, `${curve.prog} ${curve.progMax}`);

  // ================= B. STATS =================
  const statsAt = () => {
    window.__debugUnlockAll();
    const sn = T.sniper(), out = {};
    const pick = (st) => ({ hp: st.hp, damage: st.damage, fireRate: st.fireRate, accuracy: st.accuracy, movePenalty: st.movePenalty, moveSpeed: st.moveSpeed, reviveTime: st.reviveTime, aimTime: st.aimTime, healMul: st.healMul, range: st.range });
    for (const [id0, spec] of [['ace', 'inf-trooper'], ['ranger', 'inf-recon'], ['tank', 'hvy-juggernaut'], ['havoc', 'hvy-weapons'], ['doc', 'med-surgeon'], ['patch', 'med-commander'], ['sniper', 'snp-ghost'], ['sniper', 'snp-deadeye']]) {
      const id = id0 === 'sniper' ? sn.id : id0;
      const s = T.R.get(id); if (id0 === 'sniper') s.traitId = 'eagleEye'; // the recruited Sniper's trait is random: fix it
      s.training.hp = 2; s.training.damage = 3; s.training.accuracy = 1;
      T.a.squadTraining.hp = 1; T.a.squadTraining.damage = 2;
      T.lv(id, 25); T.recruit(id);
      const r25 = pick(window.__effectiveStats(s));
      const p = s.progression; p.tier = 'elite'; p.elitePath = spec; p.specialization = spec; p.eliteLevel = 1; p.eliteXp = 0;
      const e1 = pick(window.__effectiveStats(s));
      const at = {};
      for (const l of [2, 15, 30]) { p.eliteLevel = l; p.eliteXp = T.EL.eliteXpForLevel(l); at[l] = pick(window.__effectiveStats(s)); }
      out[spec] = { r25, e1, at, trait: s.traitId, cls: s.classId };
      T.recruit(id);
    }
    return out;
  };
  const st = await ev(statsAt);
  let baseSt = null;
  if (BASE) {
    // v0.7A has no Elite levels: its Elite Level 1 (eliteLevel 1) is the reference
    const bp = await ctx.newPage();
    await fresh(null, bp, BASE);
    baseSt = await bp.evaluate(() => {
      window.__debugUnlockAll();
      const sn = T.sniper(), out = {};
      const pick = (st) => ({ hp: st.hp, damage: st.damage, fireRate: st.fireRate, accuracy: st.accuracy, movePenalty: st.movePenalty, moveSpeed: st.moveSpeed, reviveTime: st.reviveTime, aimTime: st.aimTime, healMul: st.healMul, range: st.range });
      for (const [id0, spec] of [['ace', 'inf-trooper'], ['ranger', 'inf-recon'], ['tank', 'hvy-juggernaut'], ['havoc', 'hvy-weapons'], ['doc', 'med-surgeon'], ['patch', 'med-commander'], ['sniper', 'snp-ghost'], ['sniper', 'snp-deadeye']]) {
        const id = id0 === 'sniper' ? sn.id : id0;
        const s = T.R.get(id); if (id0 === 'sniper') s.traitId = 'eagleEye'; // the recruited Sniper's trait is random: fix it
        s.training.hp = 2; s.training.damage = 3; s.training.accuracy = 1;
        T.a.squadTraining.hp = 1; T.a.squadTraining.damage = 2;
        T.lv(id, 25); T.recruit(id);
        const r25 = pick(window.__effectiveStats(s));
        const p = s.progression; p.tier = 'elite'; p.elitePath = spec; p.specialization = spec; p.eliteLevel = 1; p.eliteXp = 0;
        out[spec] = { r25, e1: pick(window.__effectiveStats(s)) };
        T.recruit(id);
      }
      return out;
    });
    await bp.close();
    const sameE1 = Object.keys(baseSt).every((k) => JSON.stringify(baseSt[k].e1) === JSON.stringify(st[k].e1));
    const sameR = Object.keys(baseSt).every((k) => JSON.stringify(baseSt[k].r25) === JSON.stringify(st[k].r25));
    check('B1 Elite Level 1 stats identical to the v0.7A build, all eight specializations (with training + squad training)', sameE1, Object.keys(baseSt).filter((k) => JSON.stringify(baseSt[k].e1) !== JSON.stringify(st[k].e1)).join() || 'all equal');
    check('E1 Recruit Level 25 stats identical to the v0.7A build (Recruit progression untouched)', sameR, sameR ? 'all equal' : 'differs');
  } else check('B1 Elite Level 1 = Recruit Level 25 (+ Surgeon revive) (set BASE= to compare with v0.7A)', Object.values(st).every((x) => Object.keys(x.r25).every((k) => k === 'reviveTime' || x.r25[k] === x.e1[k])));
  const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
  const ratio = (x, l, k) => x.at[l][k] / x.e1[k];
  const B = Object.entries(st);
  check('B2 Elite 30: +25% max HP and +15% weapon damage vs the soldier\'s own Elite 1 (every spec, trait / training included)',
    B.every(([, x]) => near(ratio(x, 30, 'hp'), 1.25) && near(ratio(x, 30, 'damage'), 1.15)), B.map(([k, x]) => `${k} x${ratio(x, 30, 'hp').toFixed(4)}/x${ratio(x, 30, 'damage').toFixed(4)}`).join(' '));
  check('B3 linear growth: Elite 2 = 1/29 and Elite 15 = 14/29 of the Elite 30 bonus',
    B.every(([, x]) => near(ratio(x, 2, 'hp'), 1 + 0.25 / 29) && near(ratio(x, 15, 'hp'), 1 + 0.25 * 14 / 29) && near(ratio(x, 15, 'damage'), 1 + 0.15 * 14 / 29)), `Elite 15 HP x${ratio(st['inf-trooper'], 15, 'hp').toFixed(4)}`);
  check('B4 no fire-rate, move-speed, range or revive-time growth from Elite levels',
    B.every(([, x]) => [2, 15, 30].every((l) => x.at[l].fireRate === x.e1.fireRate && x.at[l].moveSpeed === x.e1.moveSpeed && x.at[l].range === x.e1.range && x.at[l].reviveTime === x.e1.reviveTime)));
  const cls = (spec) => st[spec];
  check('B5 class extra at Elite 30: Infantry / Heavy -10% spread, Medic +10% Field Treatment healing, Sniper -10% aim time',
    ['inf-trooper', 'inf-recon', 'hvy-juggernaut', 'hvy-weapons'].every((k) => near(ratio(cls(k), 30, 'accuracy'), 0.9) && near(ratio(cls(k), 30, 'movePenalty'), 0.9))
    && ['med-surgeon', 'med-commander'].every((k) => near(ratio(cls(k), 30, 'healMul'), 1.1) && cls(k).at[30].accuracy === cls(k).e1.accuracy)
    && ['snp-ghost', 'snp-deadeye'].every((k) => near(ratio(cls(k), 30, 'aimTime'), 0.9) && cls(k).at[30].accuracy === cls(k).e1.accuracy),
    `INF spread x${ratio(cls('inf-trooper'), 30, 'accuracy').toFixed(3)} MED heal x${ratio(cls('med-surgeon'), 30, 'healMul').toFixed(3)} SNP aim x${ratio(cls('snp-ghost'), 30, 'aimTime').toFixed(3)}`);
  check('B6 Combat Surgeon keeps Miracle Worker revive speed at every Elite level', [2, 15, 30].every((l) => st['med-surgeon'].at[l].reviveTime === st['med-surgeon'].e1.reviveTime && st['med-surgeon'].e1.reviveTime < st['med-surgeon'].r25.reviveTime));
  const stack = await ev(() => {
    // the Elite bonus is ONE multiplier on the whole Elite-1 stat: trait x training x level never compounds per level
    const s = T.R.get('ace'), p = s.progression; T.lv('ace', 25);
    p.tier = 'elite'; p.elitePath = 'inf-trooper'; p.specialization = 'inf-trooper';
    const hp = (l, tr) => { s.training.hp = tr; p.eliteLevel = l; return window.__effectiveStats(s).hp; };
    const out = { a: hp(30, 0) / hp(1, 0), b: hp(30, 10) / hp(1, 10), d1: hp(30, 10) - hp(29, 10), d2: hp(3, 10) - hp(2, 10) };
    T.recruit('ace'); s.training.hp = 0;
    return out;
  });
  check('B7 stacks cleanly: same +25% with 0 or 10 HP training ranks; every Elite level adds the same HP step (no compounding)', near(stack.a, 1.25) && near(stack.b, 1.25) && near(stack.d1, stack.d2), JSON.stringify(stack));

  // ================= C. SETTLEMENT =================
  await fresh();
  const sett = await ev(() => {
    window.__debugUnlockAll();
    const out = {}, R = T.R, P = () => R.get('tank').progression;
    T.spec('tank', 'hvy-juggernaut', 1);
    const r1 = T.award(['tank'], 500, 'c-1');
    out.r1 = { xp: P().eliteXp, lv: P().eliteLevel, s: r1.soldiers[0] };
    const r2 = T.award(['tank'], 100, 'c-2'); // 600 = Elite 2 exactly
    out.r2 = { xp: P().eliteXp, lv: P().eliteLevel, gained: r2.soldiers[0].eliteLevelsGained, before: r2.soldiers[0].eliteBefore, after: r2.soldiers[0].eliteAfter };
    out.recruit = { xp: P().xp, lv: P().level };
    const r3 = T.award(['tank'], 10000, 'c-3'); // 10,600 -> several levels at once
    out.r3 = { xp: P().eliteXp, lv: P().eliteLevel, gained: r3.soldiers[0].eliteLevelsGained, expect: T.EL.eliteLevelForXp(10600) };
    out.dup = T.award(['tank'], 10000, 'c-3'); // the same run again
    out.afterDup = P().eliteXp;
    const r4 = T.award(['tank'], 30000, 'c-4'); // past the cap
    out.r4 = { xp: P().eliteXp, lv: P().eliteLevel, gained: r4.soldiers[0].eliteLevelsGained };
    let err = null; try { T.award(['tank'], 5000, 'c-5'); } catch (e) { err = String(e); }
    out.r5 = { xp: P().eliteXp, lv: P().eliteLevel, err, tag: T.EL.levelTag(R.get('tank')) };
    window.__persist(); out.saved = T.store().roster.find((x) => x.id === 'tank').progression;
    // a Recruit in the same award still levels the Recruit way
    T.lv('ace', 3); T.recruit('ace');
    const r6 = T.award(['ace', 'tank'], 400, 'c-6');
    out.rec = { lv: R.get('ace').progression.level, el: R.get('ace').progression.eliteLevel, ex: R.get('ace').progression.eliteXp, elite: !!r6.soldiers[0].elite };
    return out;
  });
  check('C1 Elite XP accumulates (500 -> Elite 1, banked), Recruit XP / Level 25 untouched', sett.r1.xp === 500 && sett.r1.lv === 1 && sett.r1.s.elite && sett.r1.s.banked === 500 && sett.recruit.lv === 25, JSON.stringify(sett.r1));
  check('C2 reaching the threshold exactly (600) levels up to Elite 2, reported before / after', sett.r2.xp === 600 && sett.r2.lv === 2 && sett.r2.gained === 1 && sett.r2.before.level === 1 && sett.r2.after.level === 2, JSON.stringify(sett.r2));
  check('C3 one large award (10,000 XP) gains several levels at once, final level = level for the total', sett.r3.lv === sett.r3.expect && sett.r3.gained === sett.r3.expect - 2 && sett.r3.gained >= 5, JSON.stringify(sett.r3));
  check('C4 the same mission run settled twice pays once', sett.dup === null && sett.afterDup === 10600, String(sett.afterDup));
  check('C5 cap: Elite 30 reached and held; XP past the cap recorded, no error, no level beyond 30', sett.r4.lv === 30 && sett.r5.lv === 30 && sett.r5.xp === 45600 && !sett.r5.err && sett.r5.tag === 'ELITE 30', JSON.stringify(sett.r5));
  check('C6 persisted: level and cumulative XP in the save', sett.saved.eliteLevel === 30 && sett.saved.eliteXp === 45600 && sett.saved.tier === 'elite');
  check('C7 Recruits in the same award level normally, never gain Elite data', sett.rec.lv > 3 && sett.rec.el === 0 && sett.rec.ex === 0 && !sett.rec.elite, JSON.stringify(sett.rec));
  const real = await ev(() => {
    T.spec('doc', 'med-surgeon', 4); const p = T.R.get('doc').progression; p.eliteXp = T.EL.eliteXpForLevel(5) - 20;
    const ph = T.win(['doc', 'ranger']);
    const rw = T.g.lastReward, x = rw && rw.soldiers.find((s) => s.id === 'doc');
    return { ph, x, el: p.eliteLevel, ex: p.eliteXp, saved: T.store().roster.find((y) => y.id === 'doc').progression.eliteLevel };
  });
  check('C8 a real mission victory awards Elite XP through the normal path (Elite 4 -> 5) and saves it at once', real.ph === 'won' && real.x && real.x.elite && real.x.xp > 20 && real.el === 5 && real.x.eliteLevelsGained === 1 && real.saved === 5, JSON.stringify({ ph: real.ph, el: real.el, xp: real.x && real.x.xp }));

  // ================= D. PASSIVES AT ELITE 1 / 15 / 30, CAPS =================
  await fresh();
  const pas = await ev(() => {
    window.__debugUnlockAll();
    const EL = T.EL, E = T.C.elite, out = {};
    for (const L of [1, 15, 30]) {
      const o = out[L] = {};
      // Adrenaline Rush / Ironclad incoming multipliers
      T.spec('ace', 'inf-trooper', L); T.spec('tank', 'hvy-juggernaut', L);
      T.deploy(['ace', 'tank']);
      const a = T.unit('ace'), t = T.unit('tank');
      a.hp = a.maxHp * 0.3; o.adrLow = EL.incomingMul(a); a.hp = a.maxHp * 0.5; o.adrHigh = EL.incomingMul(a);
      o.iron = EL.incomingMul(t); o.maxHp = a.maxHp;
      // Deadeye (Recon): every 5th hit x1.5 measured on real hits
      T.spec('ranger', 'inf-recon', L);
      T.deploy(['ranger']);
      const g = T.g, r = T.unit('ranger'); g.invuln = true;
      const e = T.dummy(r, 200); const rp = { ...r.pos }; const seq = []; const d0 = g.damage.bind(g);
      g.damage = (u, amt, src, op) => { if (src === r && !op.grenade) seq.push(amt); return d0(u, amt, src, op); };
      T.step(14, T.pin([[r, rp]], [e])); g.damage = d0; g.invuln = false;
      const b = Math.min(...seq);
      o.dead = { n: seq.length, ok: seq.length >= 10 && seq.every((x, i) => Math.abs(x / b - ((i + 1) % 5 === 0 ? 1.5 : 1)) < 1e-6), base: b, dmg: r.stats.damage };
      // Phantom Shot: every 4th hit penetrates; Perfect Aim charged +75%; Rally x1.1; caps
      const gh = { elite: new EL.EliteState(EL.ELITE_SPECS['snp-ghost']) };
      o.phantom = [1, 2, 3, 4, 5, 6, 7, 8].map(() => EL.onHit(gh, 1).pen).join();
      const de = { elite: new EL.EliteState(EL.ELITE_SPECS['snp-deadeye']), rallied: true }; de.elite.charge = E.perfectAimCharge;
      o.aim = EL.onFire(de).mul; // 1.1 x 1.75 = 1.925
      // Overdrive and Miracle Worker, Elite level does not change them
      T.spec('doc', 'med-surgeon', L); T.spec('havoc', 'hvy-weapons', L); T.deploy(['doc', 'havoc']);
      o.revive = EL.reviveHpFrac(T.unit('doc')); const hv = T.unit('havoc'); hv.elite.overdrive = 1; o.od = EL.overdriveAdd(hv);
      o.revTime = T.unit('doc').stats.reviveTime;
    }
    // caps with tuned extremes on an Elite 30 soldier
    const saved = { ...T.C.elite };
    T.C.elite.ironcladReduction = 0.9; T.spec('tank', 'hvy-juggernaut', 30); T.deploy(['tank']); out.capRed = EL.incomingMul(T.unit('tank'));
    T.C.elite.perfectAimBonus = 5; const de = { elite: new EL.EliteState(EL.ELITE_SPECS['snp-deadeye']), rallied: true }; de.elite.charge = T.C.elite.perfectAimCharge; out.capShot = EL.onFire(de).mul;
    Object.assign(T.C.elite, saved);
    return out;
  });
  const same = (k) => pas[1][k] === pas[15][k] && pas[15][k] === pas[30][k];
  check('D1 Adrenaline Rush (25% under 35% HP) and Ironclad (20%) identical at Elite 1, 15, 30', same('adrLow') && same('adrHigh') && same('iron') && pas[1].adrLow === 0.75 && pas[1].adrHigh === 1 && pas[1].iron === 0.8, `${pas[1].adrLow}/${pas[1].iron}`);
  check('D2 Deadeye: every 5th hit +50% at Elite 1, 15 and 30 (measured), on a higher damage base at Elite 30', [1, 15, 30].every((l) => pas[l].dead.ok) && Math.abs(pas[30].dead.base / pas[1].dead.base - 1.15) < 1e-3, `L1 ${pas[1].dead.base.toFixed(3)} -> L30 ${pas[30].dead.base.toFixed(3)} (${pas[30].dead.n} hits)`);
  check('D3 Phantom Shot every 4th hit, Perfect Aim x1.75 (+ Rally = x1.925), Overdrive +25%, Miracle Worker 50% HP: unchanged by Elite level', same('phantom') && pas[1].phantom === '0,0,0,0.6,0,0,0,0.6' && same('aim') && Math.abs(pas[1].aim - 1.925) < 1e-9 && same('od') && pas[1].od === 0.25 && same('revive') && pas[1].revive === 0.5 && same('revTime'), `${pas[1].phantom} x${pas[1].aim}`);
  check('D4 caps hold at Elite 30: incoming reduction <= 40%, per-shot multiplier <= x2', pas.capRed === 0.6 && pas.capShot === 2, `${pas.capRed} ${pas.capShot}`);
  check('D5 Elite 30 max HP in the field = 1.25 x Elite 1', Math.abs(pas[30].maxHp / pas[1].maxHp - 1.25) < 1e-6, `${pas[1].maxHp} -> ${pas[30].maxHp}`);

  // ================= F. SAVE =================
  await fresh();
  await ev(() => { window.__debugUnlockAll(); T.spec('ace', 'inf-recon', 12); T.a.promotions.push({ eventId: 'pr-x-ace', soldierId: 'ace', name: 'Ace', classId: 'infantry', spec: 'inf-recon', cost: 3000, at: 1, recruitXp: T.R.get('ace').progression.xp }); window.__persist(); });
  await page.reload(); await page.waitForFunction(() => !!window.game);
  const rt = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes, v: T.store().version, p: T.R.get('ace').progression, tag: T.EL.levelTag(T.R.get('ace')) }));
  check('F1 v9 round trip: Elite 12 and its XP reload unchanged (status loaded, no notes)', rt.v === 9 && rt.st === 'loaded' && rt.notes.length === 0 && rt.p.eliteLevel === 12 && rt.p.eliteXp === 11 * 600 + 45 * 55 && rt.tag === 'ELITE 12', JSON.stringify({ v: rt.v, st: rt.st, el: rt.p.eliteLevel, xp: rt.p.eliteXp }));
  const tam = await ev(() => {
    const base = localStorage.getItem('minisquad.save'), parse = window.__parseSave, out = {};
    const mod = (f) => { const d = JSON.parse(base); f(d.roster.find((x) => x.id === 'ace').progression, d); const r = parse(JSON.stringify(d)); const p = r.roster.get('ace').progression; return { st: r.status, el: p.eliteLevel, xp: p.eliteXp, tier: p.tier, path: p.elitePath }; };
    out.high = mod((p) => { p.eliteLevel = 20; });          // level above XP: level kept, XP raised to its threshold
    out.low = mod((p) => { p.eliteLevel = 3; });            // level below XP: derived from XP
    out.badXp = mod((p) => { p.eliteXp = 'lots'; });        // invalid XP: the stored level is kept, XP = its threshold
    out.negXp = mod((p) => { p.eliteXp = -50; p.eliteLevel = 1; });
    out.noXp = mod((p) => { delete p.eliteXp; delete p.eliteLevel; });
    out.huge = mod((p) => { p.eliteXp = 1e12; });
    out.v8 = mod((p, d) => { d.version = 8; p.eliteLevel = 1; p.eliteXp = 5000; }); // v8: level always 1 -> derived from banked XP
    out.v8tamper = mod((p, d) => { d.version = 8; p.eliteLevel = 25; p.eliteXp = 0; }); // v8 level never meant anything: no free XP
    out.noLedgerTier = mod((p) => { p.tier = 'recruit'; });  // the ledger restores the promotion, the level comes back from the XP
    return out;
  });
  const th = (l) => { let t = 0; for (let i = 1; i < l; i++) t += 600 + 45 * (i - 1); return t; };
  check('F2 v9 level above its XP: level kept, XP raised to the threshold (a load never removes a level)', tam.high.el === 20 && tam.high.xp === th(20) && tam.high.st === 'repaired', JSON.stringify(tam.high));
  check('F3 v9 level below its XP: corrected up from the XP', tam.low.el === 12 && tam.low.xp === th(12) && tam.low.st === 'repaired', JSON.stringify(tam.low));
  check('F4 invalid / negative / missing Elite XP handled safely (no crash; level from what is readable)', tam.badXp.el === 12 && tam.badXp.xp === th(12) && tam.negXp.el === 1 && tam.negXp.xp === 0 && tam.noXp.el === 1 && tam.noXp.xp === 0 && tam.noXp.tier === 'elite', JSON.stringify([tam.badXp, tam.negXp, tam.noXp]));
  check('F5 absurd Elite XP: level 30, no error', tam.huge.el === 30 && tam.huge.tier === 'elite', JSON.stringify(tam.huge));
  check('F6 v8 save: banked XP converts (5,000 -> Elite ' + (() => { let l = 1; while (l < 30 && 5000 >= th(l + 1)) l++; return l; })() + '), status migrated; a v8 level gives no free XP', tam.v8.el === 7 && tam.v8.xp === 5000 && tam.v8.st === 'migrated' && tam.v8tamper.el === 1 && tam.v8tamper.xp === 0, JSON.stringify([tam.v8, tam.v8tamper]));
  check('F7 a stripped tier is restored from the ledger with the level from XP (migration never undoes a promotion)', tam.noLedgerTier.tier === 'elite' && tam.noLedgerTier.path === 'inf-recon' && tam.noLedgerTier.el === 12, JSON.stringify(tam.noLedgerTier));
  // genuine v0.7A (v8) save, made by the v0.7A build: promotions through the economy, Elite XP banked by settleMission,
  // one Elite KIA awaiting a decision, one Elite in the Memorial, training, squad training, career
  const fx8 = fs.existsSync(__dirname + '/fixtures/v0.7A-save.json') ? fs.readFileSync(__dirname + '/fixtures/v0.7A-save.json', 'utf8') : null;
  if (fx8) {
    await fresh(fx8);
    const m = await ev(() => {
      const s = T.store(), L = window.__loadStatus;
      return { st: L.status, from: L.fromVersion, notes: L.notes, v: s.version, bk: localStorage.getItem('minisquad.save.pre-v0.7b'), saved: s,
        levels: s.roster.filter((x) => x.progression.tier === 'elite').map((x) => `${x.id}:${x.progression.eliteLevel}:${x.progression.eliteXp}:${x.status}`).join(' '),
        mem: s.account.memorial.map((r) => `${r.soldier.id}:${r.soldier.progression.eliteLevel}:${T.EL.levelTag(r.soldier)}`).join(),
        tags: T.R.soldiers.filter((x) => x.progression.tier === 'elite').map((x) => T.EL.levelTag(x)).join() };
    });
    const src = JSON.parse(fx8);
    // eliteLevel is what v9 derives; the named-recruit lists are re-derived on every load (v0.6.1), order only (v0.7A does the same)
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'eliteLevel' ? undefined : (k === 'unlocked' || k === 'claimed' || k === 'notified') && Array.isArray(v) ? [...v].sort() : v)));
    const { version: _v1, ...a1 } = strip(src), { version: _v2, ...a2 } = strip(m.saved);
    const diff = [];
    for (const k of Object.keys(a1)) if (JSON.stringify(a1[k]) !== JSON.stringify(a2[k])) diff.push(k);
    const exp = (x) => { let l = 1; while (l < 30 && x >= th(l + 1)) l++; return l; };
    const levelsOk = src.roster.filter((x) => x.progression.tier === 'elite').every((x) => m.saved.roster.find((y) => y.id === x.id).progression.eliteLevel === exp(x.progression.eliteXp) && m.saved.roster.find((y) => y.id === x.id).progression.eliteXp === x.progression.eliteXp);
    check('F8 genuine v0.7A (v8) save -> v9: migrated, no notes, pre-v0.7b backup = original text', m.st === 'migrated' && m.from === 8 && m.notes.length === 0 && m.v === 9 && m.bk === fx8, JSON.stringify({ st: m.st, from: m.from, notes: m.notes, v: m.v, bk: !!m.bk }));
    check('F9 v8 -> v9: every banked Elite XP point kept; levels derived from it (incl. one past the cap -> 30)', levelsOk && /tank:30:/.test(m.levels), m.levels);
    check('F10 v8 -> v9: everything except eliteLevel byte-identical (soldiers, specializations, ledger, Credits, training, traits, career, resurrections, Memorial, decision queue, missions)', diff.length === 0, diff.join() || 'identical');
    check('F11 v8 -> v9: KIA Elite awaiting a decision and the Memorial Elite keep identity and level ("ELITE n")', /havoc:3:1350:kia/.test(m.levels) && /ranger:3:ELITE 3/.test(m.mem) && !/LV /.test(m.tags), `${m.mem} | ${m.tags}`);
    await page.reload(); await page.waitForFunction(() => !!window.game);
    const again = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes, text: localStorage.getItem('minisquad.save') }));
    check('F12 second load of the migrated save: loaded, no notes, no change (no double conversion)', again.st === 'loaded' && again.notes.length === 0 && again.text === JSON.stringify(m.saved), again.st);
  } else check('F8 v0.7A fixture present (tools/fixtures/v0.7A-save.json)', false);

  // ================= G. KIA / RESURRECTION / MEMORIAL =================
  await fresh();
  const pd = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a, R = T.R, out = {};
    T.spec('ace', 'inf-trooper', 14); const p = R.get('ace').progression; p.eliteXp += 77; const xp0 = p.eliteXp;
    a.promotions.push({ eventId: 'pr-t', soldierId: 'ace', name: 'Ace', classId: 'infantry', spec: 'inf-trooper', cost: 3000, at: 1, recruitXp: p.xp });
    T.deploy(['ace', 'ranger']);
    const g = T.g, u = T.unit('ace');
    g.damage(u, 1e6); u.bleed = 0.01; T.step(0.3); g.fail();
    out.kia = { st: R.get('ace').status, el: p.eliteLevel, xp: p.eliteXp, tag: T.EL.levelTag(R.get('ace')) };
    a.credits = window.__casualties.costFor(R.get('ace'));
    out.res = T.E.resurrect(R, a, 'ace', window.__persist).ok;
    out.after = { st: R.get('ace').status, el: R.get('ace').progression.eliteLevel, xp: R.get('ace').progression.eliteXp, xp0 };
    T.deploy(['ace', 'ranger']);
    const u2 = T.unit('ace'); g.damage(u2, 1e6); u2.bleed = 0.01; T.step(0.3); g.fail();
    T.E.memorialize(R, a, 'ace', window.__persist);
    const m = a.memorial.find((x) => x.soldier.id === 'ace');
    out.mem = m && { el: m.soldier.progression.eliteLevel, xp: m.soldier.progression.eliteXp, tag: T.EL.levelTag(m.soldier), path: m.soldier.progression.elitePath };
    return out;
  });
  check('G1 Elite KIA keeps Elite level and XP (ELITE 14)', pd.kia.st === 'kia' && pd.kia.el === 14 && pd.kia.tag === 'ELITE 14', JSON.stringify(pd.kia));
  check('G2 resurrection restores the Elite with the same level and XP', pd.res && pd.after.st === 'active' && pd.after.el === 14 && pd.after.xp === pd.after.xp0, JSON.stringify(pd.after));
  check('G3 Memorial record keeps specialization, Elite level and XP', pd.mem && pd.mem.el === 14 && pd.mem.xp === pd.after.xp0 && pd.mem.tag === 'ELITE 14' && pd.mem.path === 'inf-trooper', JSON.stringify(pd.mem));
  await page.reload(); await page.waitForFunction(() => !!window.game);
  const memReload = await ev(() => { const m = T.a.memorial.find((x) => x.soldier.id === 'ace'); return { st: window.__loadStatus.status, tag: m && T.EL.levelTag(m.soldier) }; });
  check('G4 Memorial Elite level survives a reload', memReload.tag === 'ELITE 14' && memReload.st === 'loaded', JSON.stringify(memReload));

  // ================= H. UI (phones, landscape) =================
  const PHONES = [
    ['iphone-se', { viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['iphone-14', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['pixel-7', { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true }],
  ];
  for (const [name, opts] of PHONES) {
    const c = await browser.newContext(opts); await c.addInitScript(installHelpers);
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.goto(URL); await p.waitForFunction(() => !!window.game);
    // Results: Doc one level up, Tank several levels from one big award, Ace already at the cap
    const res = await p.evaluate(() => {
      window.__debugUnlockAll();
      T.spec('doc', 'med-surgeon', 6); T.R.get('doc').progression.eliteXp = T.EL.eliteXpForLevel(7) - 10;
      T.spec('tank', 'hvy-juggernaut', 3);
      T.spec('ace', 'inf-recon', 30); T.R.get('ace').progression.eliteXp += 500;
      const X = T.P.PROGRESSION.xp, v0 = X.victory; X.victory = 3000;
      const ph = T.win(['doc', 'tank', 'ace']); X.victory = v0;
      const c = document.querySelector('.r-card');
      return { ph, t: c ? c.textContent : '', ups: [...document.querySelectorAll('.r-lvl.elite')].map((x) => x.textContent) };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/results-${name}.png` });
    check(`H ${name}: Results show Elite XP, "ELITE LEVEL UP!", final level + levels gained, MAX at the cap`,
      res.ph === 'won' && res.ups.length === 2 && res.ups.some((x) => /ELITE LEVEL UP! DOC — ELITE \d+/.test(x)) && res.ups.some((x) => /TANK — ELITE \d+ \(\+\d+ levels\)/.test(x)) && /ELITE 30/.test(res.t) && /\(MAX\)/.test(res.t) && /\+\d+ XP/.test(res.t) && !/banked/.test(res.t),
      res.ups.join(' | '));
    const rOv = await p.evaluate(() => { const c = document.querySelector('.r-card'); return { w: document.documentElement.scrollWidth <= innerWidth + 1, card: c && c.getBoundingClientRect().right <= innerWidth + 1 }; });
    check(`H ${name}: Results fit the screen width`, rOv.w && rOv.card, JSON.stringify(rOv));
    // Profile and Barracks
    await p.evaluate(() => { T.g.toMenu ? T.g.toMenu() : null; });
    await p.goto(URL); await p.waitForFunction(() => !!window.game);
    await p.evaluate(() => { document.querySelectorAll('.m-modal [data-a$="-later"], .m-modal [data-a="close"]').forEach((b) => b.click()); });
    await p.evaluate(() => { const r = T.R; r.slots = ['doc', 'tank', 'ace', null, null, null].slice(0, r.slots.length); window.__persist(); });
    await p.goto(URL); await p.waitForFunction(() => !!window.game);
    await p.evaluate(() => { document.querySelectorAll('.m-modal [data-a$="-later"], .m-modal [data-a="close"]').forEach((b) => b.click()); });
    await p.click('[data-a="to-barracks"]');
    await p.waitForSelector('.s-card[data-id="tank"]');
    const bar = await p.evaluate(() => {
      const card = (id) => document.querySelector(`.s-card[data-id="${id}"]`);
      const lv = (id) => card(id).querySelector('.s-lv').textContent;
      const slots = [...document.querySelectorAll('.b-slots .slot .slot-lv')].map((x) => ({ t: x.textContent, fit: x.scrollWidth <= x.clientWidth + 1 && x.getBoundingClientRect().right <= x.closest('.slot').getBoundingClientRect().right + 1 && x.getBoundingClientRect().height < 1.6 * parseFloat(getComputedStyle(x).fontSize) }));
      return { doc: lv('doc'), tank: lv('tank'), ace: lv('ace'), recruit: lv('ranger'), slots, wide: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/barracks-${name}.png` });
    const lvl = await p.evaluate(() => ['doc', 'tank', 'ace'].map((id) => T.R.get(id).progression.eliteLevel));
    check(`H ${name}: Barracks cards show ELITE n (Recruits LV n); squad slots show ★n + spec on one line`, bar.doc === `ELITE ${lvl[0]}` && bar.tank === `ELITE ${lvl[1]}` && bar.ace === 'ELITE 30' && /^LV \d+$/.test(bar.recruit) && bar.slots.length >= 3 && bar.slots.slice(0, 3).every((x) => /^★\d+ [A-Z]{3}$/.test(x.t) && x.fit) && bar.wide, JSON.stringify(bar));
    await p.click('.s-card[data-id="tank"] .s-name');
    await p.waitForSelector('.el-box');
    const prof = await p.evaluate(() => { const d = document.querySelector('.d-card'); return { t: d.textContent, bar: d.querySelector('.d-xp .xp i').style.width, fit: d.getBoundingClientRect().right <= innerWidth + 1 }; });
    if (OUT) await p.screenshot({ path: `${OUT}/profile-${name}.png` });
    check(`H ${name}: profile: specialization, ELITE n, Elite XP x / next-level need, progress bar, bonus, stats, passive text`,
      /JUGGERNAUT/.test(prof.t) && new RegExp(`ELITE ${lvl[1]} · Elite XP [\\d,]+ / [\\d,]+ to ELITE ${lvl[1] + 1}`).test(prof.t) && /Ironclad/.test(prof.t) && /20% less damage/.test(prof.t) && /Elite level bonus: \+[\d.]+% max HP/.test(prof.t) && /Max HP/.test(prof.t) && /ELITE \d+/.test(prof.t) && /^\d+%$/.test(prof.bar) && prof.fit && !/\bLV \d/.test(prof.t.replace(/Recruit LV \d+/, '')),
      prof.t.slice(0, 200));
    await p.click('[data-a="close"]');
    await p.click('.s-card[data-id="ace"] .s-name');
    await p.waitForSelector('.el-box');
    const max = await p.evaluate(() => document.querySelector('.d-card').textContent);
    if (OUT) await p.screenshot({ path: `${OUT}/profile-max-${name}.png` });
    check(`H ${name}: Elite 30 profile shows MAX LEVEL (no next-level requirement) and the full +25% / +15% bonus`, /ELITE 30 · MAX LEVEL/.test(max) && !/to ELITE 31/.test(max) && /\+25% max HP · \+15% damage · -10% spread/.test(max) && /Deadeye/.test(max), max.slice(0, 160));
    check(`H ${name}: no page errors`, errs.length === 0, errs[0]);
    await c.close();
  }

  // ================= I. ELITE 30 SQUADS: MISSIONS 1-10, 30 / 60 FPS =================
  if (!QUICK) {
    const SEED = 7070;
    const init = ({ seed }) => {
      let s = seed >>> 0;
      Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      let q = [], now = 1000;
      window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
      window.__drive = (period, until) => { let n = 0; while (!until() && n < 1e6) { now += period; const cbs = q; q = []; for (const cb of cbs) cb(now); n++; } return n; };
    };
    const setup = ({ mission, squad: sq0, level }) => {
      let squad = sq0;
      const g = window.game, P = window.__progression, EL = window.__elite;
      window.__debugUnlockAll();
      const a = window.__account(), E = window.__economy;
      squad = squad.map(([id, sp]) => {
        if (!id.startsWith('sniper')) return [id, sp];
        if (!a.classUnlocks.unlocked.includes('sniper')) { a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper'); }
        E.openOffice(g.roster, a, null);
        let o = null; for (let i = 0; i < 300 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'sniper'); if (!o) { a.credits += 100; E.refreshOffers(g.roster, a, null, null); } }
        a.credits += 5000; return [E.recruit(g.roster, a, o.id, null).soldier.id, sp];
      });
      for (const [id, sp] of squad) { const s = g.roster.get(id); if (!s) continue; s.progression.xp = P.xpForLevel(25); s.progression.level = 25; if (sp) { s.progression.tier = 'elite'; s.progression.elitePath = sp; s.progression.specialization = sp; s.progression.eliteLevel = level; s.progression.eliteXp = EL.eliteXpForLevel(level); } }
      g.selectMission(mission, true);
      const r = g.deploy(squad.map(([id]) => g.roster.get(id)).filter(Boolean).slice(0, g.capacity), 'roster');
      return r.ok ? g.soldiers.map((s) => s.elite ? s.elite.id : s.classDef.id).join() : r.reason;
    };
    const hashState = () => {
      const g = window.game, m = g.mission, r = (x) => Math.round(x * 1000);
      const u = (x) => [r(x.pos.x), r(x.pos.y), r(x.hp), x.state, r(x.bleed ?? 0), r(x.reviveProgress ?? 0), r(x.aim), r(x.fireCooldown), x.ability ? r(x.ability.cooldownLeft) : 0, x.shots, x.hits, x.rallied ? 1 : 0,
        x.elite ? [x.elite.hits, r(x.elite.overdrive), r(x.elite.charge), x.elite.procs, r(x.elite.effect)] : 0];
      const st = JSON.stringify([r(g.time), g.phase, m.phase, m.boss ? [m.boss.phase, m.boss.rockets, m.boss.bursts] : 0, g.soldiers.map(u), g.npcs.map(u), g.enemies.map(u), g.projectiles.map((p) => [r(p.pos.x), r(p.pos.y), r(p.damage)]), g.grenades.length, m.primaries.map((o) => o.state)]);
      let h = 2166136261; for (let i = 0; i < st.length; i++) { h ^= st.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    };
    const SQUADS = {
      a: [['ace', 'inf-trooper'], ['havoc', 'hvy-weapons'], ['doc', 'med-surgeon'], ['patch', 'med-commander'], ['tank', 'hvy-juggernaut'], ['ranger', 'inf-recon']],
      c: [['sniper1', 'snp-deadeye'], ['sniper2', 'snp-ghost'], ['patch', 'med-commander'], ['tank', 'hvy-juggernaut'], ['ace', 'inf-trooper']],
      b: [['ace', 'inf-recon'], ['tank', 'hvy-weapons'], ['patch', 'med-commander'], ['doc', 'med-commander'], ['havoc', 'hvy-juggernaut'], ['ranger', null]],
    };
    const run = async (mission, squadKey, hz, cap, secs, level = 30) => {
      const c = await browser.newContext({ viewport: { width: 844, height: 390 } });
      const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      await p.addInitScript(init, { seed: SEED });
      await p.goto(URL + `?fps=${cap}`); await p.evaluate(() => localStorage.clear());
      await p.goto(URL + `?fps=${cap}`); await p.waitForFunction(() => !!window.game);
      const squad = await p.evaluate(setup, { mission, squad: SQUADS[squadKey], level });
      await p.evaluate(installPilot);
      const res = await p.evaluate(({ hz, secs, hashSrc }) => {
        const hash = eval(`(${hashSrc})`);
        const g = window.game, P = window.__pilot, u0 = g.update.bind(g); let steps = 0; const out = [];
        g.update = (dt) => { if (g.phase === 'playing') { P.step(); steps++; } u0(dt); if (steps % 300 === 0 && out.length < steps / 300) out.push(hash()); };
        window.__drive(1000 / hz, () => steps >= secs * 60 || g.phase !== 'playing');
        return { hashes: out, steps, phase: g.phase, t: +g.time.toFixed(2) };
      }, { hz, secs, hashSrc: hashState.toString() });
      await c.close();
      return { ...res, squad, errs };
    };
    for (const [mission, sq, secs] of [['iron-fist', 'a', 90], ['blackout', 'c', 75]]) {
      const ref = await run(mission, sq, 60, 60, secs);
      let ok = true; const notes = [];
      for (const [hz, cap] of [[120, 30], [60, 30], [90, 60]]) {
        const r = await run(mission, sq, hz, cap, secs);
        const d = r.hashes.findIndex((h, i) => h !== ref.hashes[i]);
        if (d >= 0 || r.hashes.length !== ref.hashes.length) { ok = false; notes.push(`${hz}Hz/cap${cap} differs at ${(d + 1) * 5}s`); }
        if (r.errs.length) { ok = false; notes.push(r.errs[0]); }
      }
      check(`I ${mission}: Elite 30 squad; 30 / 60 FPS caps (60 / 90 / 120 Hz) simulate identically`, ok && ref.errs.length === 0 && ref.hashes.length >= 5, notes.join('; ') || `${ref.hashes.length} checkpoints`);
    }
    const all = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home', 'bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist'];
    const rows = []; let bad = 0; const times = [];
    for (const [i, mission] of all.entries()) {
      const r = await run(mission, i % 2 ? 'b' : 'c', 60, 60, 420);
      const ok = r.errs.length === 0 && r.phase === 'won';
      if (!ok) bad++;
      rows.push(`M${i + 1} ${r.phase} t=${r.t}`); times.push(r.t);
      console.log(`  I M${i + 1} ${mission} (Elite 30: ${r.squad}): ${r.phase} at t=${r.t}${r.errs.length ? ' ERROR ' + r.errs[0] : ''}`);
    }
    check('I Missions 1-10 all won by Elite 30 squads (autopilot), no errors', bad === 0, rows.join(' · '));
  }

  check('no page errors (main page)', errors.length === 0, errors[0]);
  await browser.close();
  console.log(fails ? `${fails} of ${total} FAILED` : `ALL ${total} PASS`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
