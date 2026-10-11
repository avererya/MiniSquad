// v0.7A ELITE PROMOTIONS & SPECIALIZATIONS: acceptance checks against a served build (headless Chromium).
//
//   npx vite preview --port 4173 &  node tools/elite.cjs        (OUT=dir saves screenshots)
//
// (v0.7B: save expectations moved to v9; Elite levels 2-30 are covered by tools/elite-progression.cjs.)
//  A. Data: eight specializations, two per class, stable ids, cost 3,000 CR at Recruit Level 25
//  B. Promotion rules (economy): level 24 / 25, Credits, wrong branch, atomic, no double promotion,
//     no respec, failed save rolls everything back, blocked while KIA / in a mission / a decision is
//     pending; identity kept; Elite Level 1 never weaker than Recruit Level 25
//  C. Save: v8 round trip, ledger repair, stray / tampered Elite data, pre-v0.7A saves (no free
//     promotion, backup written), reload can't undo a promotion
//  D. The eight passives, measured in the real simulation (fixed 1/60 s steps), plus stacking caps
//  E. Permadeath with Elites: down / revive, KIA, resurrection (x2 cost) keeps the specialization,
//     Memorial keeps it, mission XP banked as Elite XP
//  F. Multiple Elites together: a full Elite squad plays Missions with the autopilot, no errors;
//     30 FPS and 60 FPS caps (and 60 / 90 / 120 Hz displays) give identical simulation hashes
//  G. UI: promotion box, confirmation, cancel, ceremony, Elite profile on iPhone SE / iPhone 14 /
//     Pixel 7 landscape; Elite uniforms in the field (screenshots)
// PASS/FAIL per check; exits 1 on any failure.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const { installPilot } = require('./perf-lib.cjs');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get R() { return window.game.roster; },
    get C() { return window.__CFG; },
    get EL() { return window.__elite; },
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
    /** Test setup only (bypasses the economy): give a soldier a specialization. */
    spec(id, spec) { const p = this.R.get(id).progression; this.lv(id, 25); p.tier = 'elite'; p.elitePath = spec; p.specialization = spec; p.eliteLevel = 1; },
    unit(id) { return window.game.soldiers.find((s) => s.identity && s.identity.id === id); },
    /** Recruit a Sniper through the office (Sniper class unlocked first). */
    sniper() {
      const a = this.a;
      if (!a.classUnlocks.unlocked.includes('sniper')) { a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper'); }
      this.E.openOffice(this.R, a, null);
      let o = null; for (let i = 0; i < 300 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'sniper'); if (!o) { a.credits += 100; this.E.refreshOffers(this.R, a, null, null); } }
      a.credits += o.price ?? 5000; return this.E.recruit(this.R, a, o.id, null).soldier;
    },
    /** A stationary, unkillable target in clear view of `u`, `d` px away along +x. */
    dummy(u, d = 220, kind = 'rifleman') {
      const g = window.game;
      const pos = g.findOpenNear({ x: u.pos.x + d, y: u.pos.y }, 40);
      const e = g.spawnEnemy(pos, kind); e.guard = true; e.hp = 1e9; e.maxHp = 1e9; e.fireCooldown = 1e9;
      return e;
    },
    /** Pin a list of units in place and keep enemies from shooting back. */
    pin(units, enemies = []) { return () => { for (const [u, p] of units) { u.pos = { ...p }; u.vel = { x: 0, y: 0 }; } for (const e of enemies) { e.fireCooldown = 1e9; e.hp = 1e9; } }; },
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
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(100)} ${String(detail).replace(/\s+/g, " ").slice(0, 260)}`); };
  const fresh = async (raw = null) => {
    await page.goto(URL); await page.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await page.goto(URL); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(100);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. DATA =================
  await fresh();
  const data = await ev(() => {
    const EL = T.EL;
    return { ids: EL.ELITE_SPEC_IDS.join(), branches: JSON.stringify(EL.CLASS_BRANCHES), cost: EL.PROMOTION_COST, lvl: EL.PROMOTION_LEVEL, cap: EL.ELITE_LEVEL_CAP,
      complete: EL.ELITE_SPEC_IDS.every((id) => { const s = EL.ELITE_SPECS[id]; return s.title && s.role && s.passive && s.desc && s.short && EL.CLASS_BRANCHES[s.classId].includes(id); }) };
  });
  check('A1 eight specializations with stable ids, two per class, all fields filled', data.ids === 'inf-trooper,inf-recon,hvy-juggernaut,hvy-weapons,med-surgeon,med-commander,snp-ghost,snp-deadeye' && data.complete, data.branches);
  check('A2 promotion: 3,000 CR at Recruit Level 25; Elite levels modelled up to 30', data.cost === 3000 && data.lvl === 25 && data.cap === 30, JSON.stringify(data));

  // ================= B. PROMOTION RULES =================
  const rules = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a, R = T.R, E = T.E, P = window.__persist, out = {};
    a.credits = 10000;
    T.lv('ace', 24);
    out.l24 = E.promotionBlock(R, a, 'ace');
    out.l24Tx = E.promote(R, a, 'ace', 'inf-trooper', P).ok;
    out.l24Ready = T.EL.promotionReady(R.get('ace'));
    T.lv('ace', 25);
    out.l25Ready = T.EL.promotionReady(R.get('ace'));
    a.credits = 2999;
    out.poor = E.promotionBlock(R, a, 'ace');
    out.poorTx = E.promote(R, a, 'ace', 'inf-trooper', P).ok;
    a.credits = 3000;
    out.wrong = E.promote(R, a, 'ace', 'hvy-juggernaut', P);
    out.bogus = E.promote(R, a, 'ace', 'inf-ninja', P).ok;
    out.afterWrong = { cr: a.credits, tier: R.get('ace').progression.tier, led: a.promotions.length };
    // in a mission / KIA / pending decision
    out.inMission = E.promote(R, a, 'ace', 'inf-trooper', P, { inMission: true }).ok;
    const before = JSON.parse(JSON.stringify(R.get('ace')));
    const ok = E.promote(R, a, 'ace', 'inf-trooper', P, { now: 1700000000000 });
    const s = R.get('ace'), p = s.progression;
    out.ok = ok.ok; out.cr = a.credits; out.p = { tier: p.tier, path: p.elitePath, spec: p.specialization, el: p.eliteLevel, ex: p.eliteXp, xp: p.xp, lv: p.level };
    out.kept = ['id', 'name', 'classId', 'traitId', 'training', 'service', 'resurrections', 'status'].every((k) => JSON.stringify(s[k]) === JSON.stringify(before[k])) && p.xp === before.progression.xp && p.level === 25;
    out.ledger = a.promotions.map((r) => `${r.soldierId}:${r.spec}:${r.cost}`).join();
    out.tag = T.EL.levelTag(s);
    // double promotion / respec
    a.credits = 9000;
    out.again = E.promote(R, a, 'ace', 'inf-trooper', P);
    out.respec = E.promote(R, a, 'ace', 'inf-recon', P).ok;
    out.afterAgain = { cr: a.credits, path: p.elitePath, led: a.promotions.length };
    out.readyAfter = T.EL.promotionReady(s);
    // a failed save write rolls EVERYTHING back
    T.lv('ranger', 25);
    const rb = E.promote(R, a, 'ranger', 'inf-recon', () => 'error');
    const rp = R.get('ranger').progression;
    out.rollback = { ok: rb.ok, reason: rb.reason, cr: a.credits, tier: rp.tier, path: rp.elitePath, el: rp.eliteLevel, led: a.promotions.length };
    // KIA / pending decision
    R.get('ranger').status = 'kia';
    out.kia = E.promotionBlock(R, a, 'ranger');
    R.get('ranger').status = 'active';
    a.pendingDecision = { queue: [{ id: 'tank', cause: 'bleedout' }], runId: 'x', missionId: 'first-contact', resolved: [] };
    T.lv('tank', 25);
    out.pending = E.promotionBlock(R, a, 'tank');
    a.pendingDecision = null;
    // Elite Level 1 vs Recruit Level 25: every class, every spec
    const eff = window.__effectiveStats, cmp = [];
    for (const id of ['ace', 'tank', 'doc']) {
      for (const sp of T.EL.CLASS_BRANCHES[R.get(id).classId]) {
        const rec = JSON.parse(JSON.stringify(R.get(id))); rec.progression.xp = window.__progression.xpForLevel(25); rec.progression.level = 25; rec.progression.tier = 'recruit'; rec.progression.elitePath = null; rec.progression.specialization = null; rec.progression.eliteLevel = 0;
        const el = JSON.parse(JSON.stringify(rec)); el.progression.tier = 'elite'; el.progression.elitePath = sp; el.progression.specialization = sp; el.progression.eliteLevel = 1;
        const a1 = eff(rec), b1 = eff(el), worse = [];
        for (const k of Object.keys(a1)) if (typeof a1[k] === 'number' && a1[k] !== b1[k]) worse.push(`${k}:${a1[k]}->${b1[k]}`);
        cmp.push(`${sp}[${worse.join(' ')}]`);
      }
    }
    out.cmp = cmp.join(' ');
    return out;
  });
  check('B1 Recruit Level 24: promotion refused, no offer', /Level 25/.test(rules.l24) && !rules.l24Tx && !rules.l24Ready && rules.l25Ready, rules.l24);
  check('B2 2,999 CR: refused with the shortfall', /Not enough Credits/.test(rules.poor) && /1 short/.test(rules.poor) && !rules.poorTx, rules.poor);
  check('B3 wrong-class / unknown specialization refused, nothing changed', !rules.wrong.ok && !rules.bogus && rules.afterWrong.cr === 3000 && rules.afterWrong.tier === 'recruit' && rules.afterWrong.led === 0, rules.wrong.reason);
  check('B4 refused during a mission', !rules.inMission);
  check('B5 promote at exactly 3,000 CR: 0 CR left, Elite Level 1, chosen spec stored by stable id', rules.ok && rules.cr === 0 && rules.p.tier === 'elite' && rules.p.path === 'inf-trooper' && rules.p.spec === 'inf-trooper' && rules.p.el === 1 && rules.p.ex === 0, JSON.stringify(rules.p));
  check('B6 identity kept: name, class, trait, training, career, XP / Recruit LV 25, status', rules.kept);
  check('B7 promotion ledger entry; level shown as "ELITE 1" (never "LV 1")', rules.ledger === 'ace:inf-trooper:3000' && rules.tag === 'ELITE 1', `${rules.ledger} ${rules.tag}`);
  check('B8 no second promotion, no respec; Credits untouched; offer gone', !rules.again.ok && /already an Elite/.test(rules.again.reason) && !rules.respec && rules.afterAgain.cr === 9000 && rules.afterAgain.path === 'inf-trooper' && rules.afterAgain.led === 1 && !rules.readyAfter, rules.again.reason);
  check('B9 failed save write: promotion cancelled, Credits / rank / ledger rolled back', !rules.rollback.ok && /Could not save/.test(rules.rollback.reason) && rules.rollback.cr === 9000 && rules.rollback.tier === 'recruit' && rules.rollback.path === null && rules.rollback.el === 0 && rules.rollback.led === 1, JSON.stringify(rules.rollback));
  check('B10 blocked while the soldier is KIA, or a casualty decision is pending', /fallen/.test(rules.kia) && !!rules.pending && !/Level|Credits/.test(rules.pending), `${rules.kia} | ${rules.pending}`);
  check('B11 Elite Level 1 never weaker than Recruit Level 25 (only Surgeon revive time changes, faster)', rules.cmp === 'inf-trooper[] inf-recon[] hvy-juggernaut[] hvy-weapons[] med-surgeon[reviveTime:' + rules.cmp.split('med-surgeon[reviveTime:')[1]?.split(']')[0] + '] med-commander[]' && /reviveTime:([\d.]+)->([\d.]+)/.test(rules.cmp) && (() => { const m = rules.cmp.match(/reviveTime:([\d.]+)->([\d.]+)/); return +m[2] < +m[1]; })(), rules.cmp);

  // ================= C. SAVE =================
  const sv1 = await ev(() => { const s = T.store(); return { v: s.version, tier: s.roster.find((x) => x.id === 'ace').progression.tier, led: s.account.promotions.length, cr: s.account.credits }; });
  await page.reload(); await page.waitForFunction(() => !!window.game);
  const sv2 = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes, cr: T.a.credits, p: T.R.get('ace').progression, led: T.a.promotions.length, tag: T.EL.levelTag(T.R.get('ace')) }));
  check('C1 promotion saved at once (v9 since v0.7B): reload keeps the Elite, the ledger, and the Credits spent', sv1.v === 9 && sv1.tier === 'elite' && sv2.st === 'loaded' && sv2.notes.length === 0 && sv2.p.tier === 'elite' && sv2.p.elitePath === 'inf-trooper' && sv2.p.eliteLevel === 1 && sv2.led === 1 && sv2.cr === sv1.cr && sv2.tag === 'ELITE 1', JSON.stringify({ sv1, st: sv2.st, cr: sv2.cr }));
  const tamper = await ev(() => {
    const base = localStorage.getItem('minisquad.save'), parse = window.__parseSave, out = {};
    const mod = (f) => { const d = JSON.parse(base); f(d); return parse(JSON.stringify(d)); };
    const P = (r, id) => r.roster.get(id).progression;
    // tier stripped but the ledger says promoted -> restored
    let r = mod((d) => { const p = d.roster.find((x) => x.id === 'ace').progression; p.tier = 'recruit'; p.elitePath = null; p.specialization = null; p.eliteLevel = 0; });
    out.restored = { st: r.status, tier: P(r, 'ace').tier, path: P(r, 'ace').elitePath, el: P(r, 'ace').eliteLevel };
    // path changed to the other branch: the ledger wins (no respec through the save)
    r = mod((d) => { const p = d.roster.find((x) => x.id === 'ace').progression; p.elitePath = 'inf-recon'; p.specialization = 'inf-recon'; });
    out.respec = { st: r.status, path: P(r, 'ace').elitePath };
    // Elite level out of range -> clamped; Elite below Recruit LV 25 -> raised
    r = mod((d) => { const p = d.roster.find((x) => x.id === 'ace').progression; p.eliteLevel = 99; p.xp = 0; p.level = 1; });
    out.clamp = { st: r.status, el: P(r, 'ace').eliteLevel, lv: P(r, 'ace').level };
    r = mod((d) => { d.roster.find((x) => x.id === 'ace').progression.eliteLevel = 7; });
    out.clamp.valid = P(r, 'ace').eliteLevel; out.clamp.validSt = r.status;
    // stray Elite fields on a Recruit -> cleared
    r = mod((d) => { const p = d.roster.find((x) => x.id === 'tank').progression; p.elitePath = 'hvy-juggernaut'; p.eliteLevel = 3; });
    out.stray = { st: r.status, tier: P(r, 'tank').tier, path: P(r, 'tank').elitePath, el: P(r, 'tank').eliteLevel };
    // invalid path for the class, no ledger -> back to Recruit
    r = mod((d) => { const p = d.roster.find((x) => x.id === 'tank').progression; p.tier = 'elite'; p.elitePath = 'snp-ghost'; p.eliteLevel = 1; });
    out.invalid = { st: r.status, tier: P(r, 'tank').tier, path: P(r, 'tank').elitePath };
    // pre-v0.7A (v7) save carrying Elite data (hand edit): cleared, no free promotion
    r = mod((d) => { d.version = 7; delete d.account.promotions; const p = d.roster.find((x) => x.id === 'tank').progression; p.tier = 'elite'; p.elitePath = 'hvy-juggernaut'; p.eliteLevel = 1; });
    out.v7 = { st: r.status, from: r.fromVersion, tier: P(r, 'tank').tier };
    // unreadable ledger -> dropped, the Elite keeps the rank
    r = mod((d) => { d.account.promotions = 'garbage'; });
    out.badLedger = { st: r.status, tier: P(r, 'ace').tier, led: r.account.promotions.length };
    return out;
  });
  check('C2 ledger restores a stripped Elite rank (repaired, not lost)', tamper.restored.st === 'repaired' && tamper.restored.tier === 'elite' && tamper.restored.path === 'inf-trooper' && tamper.restored.el === 1, JSON.stringify(tamper.restored));
  check('C3 specialization edited in the save: the paid one is restored (no respec via save)', tamper.respec.path === 'inf-trooper', JSON.stringify(tamper.respec));
  check('C4 Elite level outside 1..30 reset to 1 (v0.7B: a valid 7 kept, Elite XP raised to it); Elite below Recruit LV 25 raised to 25', tamper.clamp.el === 1 && tamper.clamp.valid === 7 && tamper.clamp.validSt === 'repaired' && tamper.clamp.lv === 25 && tamper.clamp.st === 'repaired', JSON.stringify(tamper.clamp));
  check('C5 stray Elite data on a Recruit cleared', tamper.stray.tier === 'recruit' && tamper.stray.path === null && tamper.stray.el === 0, JSON.stringify(tamper.stray));
  check('C6 Elite with a specialization from another class and no ledger: back to Recruit', tamper.invalid.tier === 'recruit' && tamper.invalid.path === null, JSON.stringify(tamper.invalid));
  check('C7 pre-v0.7A save with Elite data: cleared (no free promotion)', tamper.v7.from === 7 && tamper.v7.tier === 'recruit', JSON.stringify(tamper.v7));
  check('C8 unreadable promotion ledger dropped, Elites keep their rank', tamper.badLedger.tier === 'elite' && tamper.badLedger.led === 0, JSON.stringify(tamper.badLedger));
  // genuine v7 save made by v0.6.4 (fixture): migrated, backup, nothing lost
  const fx7 = fs.existsSync(__dirname + '/fixtures/v0.6.4-save.json') ? fs.readFileSync(__dirname + '/fixtures/v0.6.4-save.json', 'utf8') : null;
  if (fx7) {
    await fresh(fx7);
    const m = await ev(() => { const s = T.store(); return { st: window.__loadStatus.status, from: window.__loadStatus.fromVersion, notes: window.__loadStatus.notes, v: s.version, bk: localStorage.getItem('minisquad.save.pre-v0.7'), elites: s.roster.filter((x) => x.progression.tier === 'elite').length, led: s.account.promotions.length }; });
    const src = JSON.parse(fx7);
    const same = await ev((src) => src.roster.every((s) => { const n = T.R.get(s.id); const { eliteXp, ...np } = n.progression; return n && n.name === s.name && JSON.stringify(np) === JSON.stringify(s.progression) && eliteXp === 0 && JSON.stringify(n.training) === JSON.stringify(s.training); }) && T.a.credits === src.account.credits, src);
    check('C9 genuine v0.6.4 (v7) save -> v9: migrated, no notes, backup pre-v0.7 = original, nobody Elite', m.st === 'migrated' && m.from === 7 && m.notes.length === 0 && m.v === 9 && m.bk === fx7 && m.elites === 0 && m.led === 0, JSON.stringify({ ...m, bk: !!m.bk }));
    check('C10 v7 -> v9: soldiers, XP, training and Credits identical', same);
  } else check('C9 v0.6.4 fixture present (tools/fixtures/v0.6.4-save.json)', false);

  // ================= D. PASSIVES (real simulation) =================
  await fresh();
  await ev(() => { window.__debugUnlockAll(); T.a.credits = 0; window.__persist(); });
  // D1 Adrenaline Rush / Ironclad: incoming damage
  const inc = await ev(() => {
    T.spec('ace', 'inf-trooper'); T.spec('tank', 'hvy-juggernaut'); T.lv('ranger', 25); T.lv('havoc', 25);
    T.deploy(['ace', 'tank', 'ranger', 'havoc']);
    const g = T.g, out = {};
    const take = (u, hpFrac, dmg = 10) => { u.hp = u.maxHp * hpFrac; const h = u.hp; g.damage(u, dmg); return +(h - u.hp).toFixed(4); };
    const ace = T.unit('ace'), tank = T.unit('tank'), ranger = T.unit('ranger'), havoc = T.unit('havoc');
    out.trooperHigh = take(ace, 0.5); out.trooperEdge = take(ace, 0.36); out.trooperLow = take(ace, 0.3); out.trooperLow2 = take(ace, 0.1);
    out.recruitLow = take(ranger, 0.3);
    out.jugHigh = take(tank, 0.9); out.jugLow = take(tank, 0.2); out.recruitHeavy = take(havoc, 0.9);
    // healed back above 35% -> off at once
    ace.hp = ace.maxHp * 0.3; out.lowFlag = T.EL.adrenalineActive(ace); ace.hp = ace.maxHp * 0.4; out.healedFlag = T.EL.adrenalineActive(ace);
    // cap: even a tuned 90% Ironclad stops at 40%
    T.C.elite.ironcladReduction = 0.9; out.capped = take(tank, 0.9); T.C.elite.ironcladReduction = 0.2;
    // enemy hits in the field go through the same path
    T.deploy(['tank', 'havoc'], 'first-contact'); const tank2 = T.unit('tank');
    return { ...out, field: ((tank) => { const e = T.dummy(tank, 160); e.fireCooldown = 0; e.guard = true; e.hp = 1e9;
    const h0 = tank.hp; let n = 0; const d0 = g.damage.bind(g); g.damage = (u, amt, src, o) => { if (u === tank && src === e) n++; return d0(u, amt, src, o); };
    T.step(4, () => { e.hp = 1e9; });
    g.damage = d0; return { hits: n, lost: +(h0 - tank.hp).toFixed(2), per: n ? +((h0 - tank.hp) / n).toFixed(3) : 0, edmg: T.C.enemy.damage }; })(tank2) };
  });
  check('D1 Adrenaline Rush: under 35% HP takes 25% less (7.5 of 10); 36% / 50% full damage', inc.trooperLow === 7.5 && inc.trooperLow2 === 7.5 && inc.trooperHigh === 10 && inc.trooperEdge === 10 && inc.recruitLow === 10, JSON.stringify(inc));
  check('D2 Adrenaline Rush switches off as soon as HP is back above 35%', inc.lowFlag === true && inc.healedFlag === false);
  check('D3 Ironclad: always 20% less (8 of 10) at any HP; Recruit Heavy full', inc.jugHigh === 8 && inc.jugLow === 8 && inc.recruitHeavy === 10);
  check('D4 damage-reduction cap 40% (a tuned 90% Ironclad still takes 6 of 10)', inc.capped === 6, inc.capped);
  check('D5 Ironclad in the field: enemy rounds deal 80% to the Juggernaut', inc.field.hits > 0 && Math.abs(inc.field.per - inc.field.edmg * 0.8) < 0.01, JSON.stringify(inc.field));

  // D6 Deadeye (Recon Commando): every 5th hit +50%; grenades excluded
  const dead = await ev(() => {
    T.spec('ranger', 'inf-recon'); T.lv('ace', 25);
    const pa = T.R.get('ace').progression; pa.tier = 'recruit'; pa.elitePath = null; pa.specialization = null; pa.eliteLevel = 0;
    T.deploy(['ranger', 'ace']);
    const g = T.g, r = T.unit('ranger'), a = T.unit('ace'), out = {};
    g.invuln = true;
    const e = T.dummy(r, 200), e2 = T.dummy(a, 200);
    const rp = { ...r.pos }, ap = { ...a.pos };
    const seq = [], seqA = []; const d0 = g.damage.bind(g);
    g.damage = (u, amt, src, o) => { if (src === r && !o.grenade) seq.push(+amt.toFixed(3)); if (src === a && !o.grenade) seqA.push(+amt.toFixed(3)); return d0(u, amt, src, o); };
    T.step(8, T.pin([[r, rp], [a, ap]], [e, e2]));
    out.hits = r.elite.hits; out.procs = r.elite.procs;
    // a grenade from the Recon: full grenade damage, the hit counter does not move
    const hitsBefore = r.elite.hits; let gren = null;
    g.damage = (u, amt, src, o) => { if (src === r && o.grenade) gren = +amt.toFixed(3); return d0(u, amt, src, o); };
    if (r.ability.id === 'grenade' || r.ability.targetingMode !== 'instant') { r.ability.cooldownLeft = 0; g.targeting = r; g.onTargetConfirm(g.worldToScreen(e.pos)); T.step(3, T.pin([[r, rp], [a, ap]], [e, e2])); }
    g.damage = d0; g.invuln = false;
    const base = Math.min(...seq);
    out.n = seq.length; out.pattern = seq.slice(0, 15).map((x) => +(x / base).toFixed(3)).join(',');
    out.ok5 = seq.every((x, i) => Math.abs(x / base - ((i + 1) % 5 === 0 ? 1.5 : 1)) < 1e-6);
    out.recruitFlat = seqA.length > 4 && seqA.every((x) => x === seqA[0]);
    out.gren = gren; out.grenHitsSame = r.elite.hits === hitsBefore + (r.elite.hits - hitsBefore);
    out.shots = r.shots;
    out.ability = r.ability.id;
    out.avg = +(seq.reduce((s, x) => s + x, 0) / seq.length / base).toFixed(3);
    return out;
  });
  check('D6 Deadeye: hits 5, 10, 15... deal +50%, all others unchanged', dead.n >= 10 && dead.ok5, `${dead.n} hits: ${dead.pattern}`);
  check('D7 Deadeye counts successful hits only (counter = hits landed)', dead.hits === dead.n && dead.procs === Math.floor(dead.n / 5), `hits ${dead.hits}, shots ${dead.shots}, procs ${dead.procs}`);
  check('D8 Deadeye average gain about +10% sustained (one rifle in five), Recruit rifle flat', dead.avg > 1.07 && dead.avg <= 1.1 && dead.recruitFlat, `x${dead.avg}`);

  // D9 Overdrive (Weapons Specialist)
  const od = await ev(() => {
    T.spec('havoc', 'hvy-weapons'); T.lv('tank', 25);
    const pt = T.R.get('tank').progression; pt.tier = 'recruit'; pt.elitePath = null; pt.specialization = null; pt.eliteLevel = 0;
    T.deploy(['havoc', 'tank']);
    const g = T.g, h = T.unit('havoc'), t = T.unit('tank'), out = {};
    g.invuln = true;
    const e = T.dummy(h, 200), e2 = T.dummy(t, 200);
    const pin = T.pin([[h, { ...h.pos }], [t, { ...t.pos }]], [e, e2]);
    const rate = (u) => +(u.fireRate / u.soldierStats.fireRate).toFixed(3);
    out.r0 = rate(h);
    let shotsH = 0, shotsT = 0; const s0h = h.shots, s0t = t.shots;
    T.step(2, pin); out.r2 = rate(h); out.od2 = +h.elite.overdrive.toFixed(3);
    T.step(3, pin); out.r5 = rate(h); out.t5 = rate(t); out.od5 = +h.elite.overdrive.toFixed(3);
    shotsH = h.shots - s0h; shotsT = t.shots - s0t; out.shots5 = [shotsH, shotsT];
    // with Suppressive Fire: added on top (x1.75 -> x2.0 of base), not multiplied
    g.useAbility(h); g.useAbility(t); T.step(0.1, pin);
    out.supp = +(h.fireRate / t.fireRate).toFixed(4); out.suppAbs = +(h.fireRate / h.soldierStats.fireRate).toFixed(3); out.suppRec = +(t.fireRate / t.soldierStats.fireRate).toFixed(3);
    T.step(8, pin);
    // stop firing: target removed -> grace, then decay
    e.state = 'dead'; e2.state = 'dead'; g.enemies = g.enemies.filter((x) => x.active);
    const odStop = h.elite.overdrive;
    T.step(0.5, pin); out.grace = +h.elite.overdrive.toFixed(3); out.odStop = +odStop.toFixed(3);
    T.step(2.5, pin); out.cooled = +h.elite.overdrive.toFixed(3);
    g.invuln = false;
    return out;
  });
  check('D9 Overdrive builds over 4 s of sustained fire to +25% fire rate', od.r0 === 1 && od.od2 > 0.45 && od.od2 < 0.55 && od.od5 === 1 && od.r5 === 1.25 && od.t5 === 1, JSON.stringify(od));
  check('D10 Overdrive measured: more rounds fired than a Recruit Heavy in the same 5 s', od.shots5[0] > od.shots5[1] * 1.12, JSON.stringify(od.shots5));
  check('D11 Overdrive + Suppressive Fire stack additively (x2.0 of base, not x2.19)', Math.abs(od.suppAbs - (od.suppRec + 0.25)) < 0.01, `elite x${od.suppAbs}, recruit x${od.suppRec}`);
  check('D12 Overdrive holds through a short pause, then cools to 0', od.grace >= od.odStop - 0.01 * 0 - 0.15 && od.cooled === 0, JSON.stringify({ stop: od.odStop, grace: od.grace, cooled: od.cooled }));

  // D13 Miracle Worker (Combat Surgeon) vs a Recruit Medic of the same trait
  const mw = await ev(() => {
    const out = {};
    const run = (surgeon) => {
      const p = T.R.get('patch').progression; T.lv('patch', 25);
      if (surgeon) { p.tier = 'elite'; p.elitePath = 'med-surgeon'; p.specialization = 'med-surgeon'; p.eliteLevel = 1; } else { p.tier = 'recruit'; p.elitePath = null; p.specialization = null; p.eliteLevel = 0; }
      T.deploy(['patch', 'tank']);
      const g = T.g, m = T.unit('patch'), v = T.unit('tank');
      g.invuln = false; g.damage(v, 1e6); g.invuln = true;
      const t = T.stepUntil(() => v.state !== 'downed', 20, () => { m.pos = { x: v.pos.x + 22, y: v.pos.y }; m.vel = { x: 0, y: 0 }; g.anchor = { ...v.pos }; });
      g.invuln = false;
      return { t: +t.toFixed(3), hp: +(v.hp / v.maxHp).toFixed(3), rt: +m.soldierStats.reviveTime.toFixed(3) };
    };
    out.rec = run(false); out.sur = run(true);
    return out;
  });
  check('D13 Miracle Worker: revive 30% faster (time / 1.3), measured in the field', Math.abs(mw.sur.rt - mw.rec.rt / 1.3) < 0.01 && Math.abs(mw.sur.t - mw.rec.t / 1.3) < 0.05, JSON.stringify(mw));
  check('D14 Miracle Worker: revived soldier stands up at 50% HP (Recruit Medic: 30%)', mw.sur.hp === 0.5 && mw.rec.hp === 0.3, JSON.stringify(mw));

  // D15 Rally (Field Commander)
  const ral = await ev(() => {
    T.spec('doc', 'med-commander'); T.lv('patch', 25);
    const pp = T.R.get('patch').progression; pp.tier = 'recruit'; pp.elitePath = null; pp.specialization = null; pp.eliteLevel = 0;
    T.lv('ace', 25); const pa = T.R.get('ace').progression; pa.tier = 'recruit'; pa.elitePath = null; pa.specialization = null; pa.eliteLevel = 0;
    T.deploy(['doc', 'ace', 'patch']);
    const g = T.g, c = T.unit('doc'), a = T.unit('ace'), p = T.unit('patch'), out = {};
    const base = { x: c.pos.x, y: c.pos.y };
    const place = (ad, pd) => () => { c.pos = { ...base }; a.pos = { x: base.x + ad, y: base.y }; p.pos = { x: base.x, y: base.y + pd }; for (const u of [c, a, p]) u.vel = { x: 0, y: 0 }; };
    T.step(0.1, place(100, 400));
    out.near = a.rallied; out.far = p.rallied; out.self = c.rallied;
    out.spd = +a.rallyMul.toFixed(3); out.spdFar = p.rallyMul;
    out.maxSpd = +(a.maxSpeed / (a.maxSpeed / a.rallyMul)).toFixed(3);
    const fire = T.EL.onFire(a); out.mul = fire.mul;
    // edge of the radius
    T.step(0.05, place(169, 400)); out.edgeIn = a.rallied;
    T.step(0.05, place(172, 400)); out.edgeOut = a.rallied;
    // damage of Ace's rounds near / not near the Commander
    g.invuln = true;
    const e = T.dummy(a, 200); const seq = []; const d0 = g.damage.bind(g);
    g.damage = (u, amt, src, o) => { if (src === a) seq.push({ amt, r: a.rallied }); return d0(u, amt, src, o); };
    const ap = { ...a.pos }; T.step(3, () => { place(100, 400)(); a.pos = { ...ap }; c.pos = { x: ap.x - 100, y: ap.y }; e.hp = 1e9; e.fireCooldown = 1e9; });
    const n1 = seq.length; T.step(3, () => { place(100, 400)(); a.pos = { ...ap }; c.pos = { x: ap.x - 400, y: ap.y + 200 }; e.hp = 1e9; e.fireCooldown = 1e9; });
    g.damage = d0; g.invuln = false;
    const inR = seq.slice(0, n1).filter((x) => x.r).map((x) => x.amt), outR = seq.slice(n1).filter((x) => !x.r).map((x) => x.amt);
    out.dmgRatio = inR.length && outR.length ? +(inR[inR.length - 1] / outR[outR.length - 1]).toFixed(4) : 0;
    // speed: the squad anchor moves 10% faster while the whole squad is rallied
    // Commander down -> nobody rallied
    g.damage(c, 1e6);
    T.step(0.05, () => { a.pos = { x: c.pos.x + 60, y: c.pos.y }; });
    out.downed = a.rallied;
    return out;
  });
  check('D15 Rally: teammate within 170 px rallied; Commander not self-rallied; far teammate not', ral.near && !ral.far && !ral.self && ral.edgeIn && !ral.edgeOut, JSON.stringify(ral));
  check('D16 Rally: +10% weapon damage (measured on hits) and +10% move speed', Math.abs(ral.mul - 1.1) < 1e-9 && Math.abs(ral.dmgRatio - 1.1) < 1e-3 && Math.abs(ral.spd - 1.1) < 1e-3 && ral.spdFar === 1, `dmg x${ral.dmgRatio}, speed x${ral.spd}`);
  check('D17 Rally stops while the Commander is down', ral.downed === false);
  const ral2 = await ev(() => {
    T.spec('doc', 'med-commander'); T.spec('patch', 'med-commander'); T.lv('ace', 25);
    T.deploy(['doc', 'patch', 'ace']);
    const c1 = T.unit('doc'), c2 = T.unit('patch'), a = T.unit('ace');
    T.step(0.1, () => { c2.pos = { x: c1.pos.x + 40, y: c1.pos.y }; a.pos = { x: c1.pos.x, y: c1.pos.y + 40 }; for (const u of [c1, c2, a]) u.vel = { x: 0, y: 0 }; });
    return { mul: T.EL.onFire(a).mul, spd: +(a.rallyMul).toFixed(3), c1: c1.rallied, c2: c2.rallied, count: T.g.eliteCommanders };
  });
  check('D18 Rally: two Commanders don\'t stack (x1.1); each rallies the other, never itself', Math.abs(ral2.mul - 1.1) < 1e-9 && ral2.spd === 1.1 && ral2.c1 && ral2.c2 && ral2.count === 2, JSON.stringify(ral2));

  // D19 Phantom Shot (Ghost) vs an Armored Trooper's front plate, and the Iron Warden
  await ev(() => { window.__sn1 = T.sniper().id; window.__sn2 = T.sniper().id; });
  const ph = await ev(() => {
    const s1 = window.__sn1; T.spec(s1, 'snp-ghost');
    T.deploy([s1]);
    const g = T.g, u = T.unit(s1), out = {};
    g.invuln = true;
    const e = T.dummy(u, 260, 'armored');
    const up = { ...u.pos }; const seq = []; const d0 = g.damage.bind(g);
    g.damage = (x, amt, src, o) => { if (src === u) { const hp = x.hp; const r = d0(x, amt, src, o); seq.push(+((hp - x.hp) / amt).toFixed(4)); x.hp = 1e9; return r; } return d0(x, amt, src, o); };
    T.step(14, () => { u.pos = { ...up }; u.vel = { x: 0, y: 0 }; e.aim = Math.atan2(u.pos.y - e.pos.y, u.pos.x - e.pos.x); e.fireCooldown = 1e9; });
    g.damage = d0; g.invuln = false;
    out.seq = seq.join(','); out.n = seq.length;
    out.ok = seq.length >= 8 && seq.every((k, i) => Math.abs(k - ((i + 1) % 4 === 0 ? 1 - (1 - T.C.armored.frontMul) * (1 - 0.6) : T.C.armored.frontMul)) < 1e-3);
    out.front = T.C.armored.frontMul;
    // boss modifier (pure function through modifyDamage)
    return out;
  });
  check('D19 Phantom Shot: every 4th hit ignores 60% of the plate (x0.35 -> x0.74); others x0.35', ph.ok, `${ph.n} hits: ${ph.seq}`);
  const boss = await ev(() => {
    const s1 = window.__sn1; T.deploy([s1], 'iron-fist');
    const g = T.g, u = T.unit(s1), out = {};
    const b = g.spawnEnemy(g.findOpenNear({ x: u.pos.x + 200, y: u.pos.y }, 60), 'boss'); b.hp = 1e6;
    const hp0 = b.hp; g.damage(b, 100, u, { dir: { x: 1, y: 0 } }); out.plain = +(hp0 - b.hp).toFixed(3);
    const hp1 = b.hp; g.damage(b, 100, u, { dir: { x: 1, y: 0 }, pen: 0.6 }); out.pen = +(hp1 - b.hp).toFixed(3);
    return out;
  });
  check('D20 Phantom Shot vs the Iron Warden: Sniper x1.6 -> x2.12 on a precision hit (60% of the 35% plating ignored)', boss.plain === 160 && Math.abs(boss.pen - 100 * 1.6 * (1 - 0.35 * 0.4) / 0.65) < 0.01, JSON.stringify(boss));

  // D21 Perfect Aim (Deadeye)
  const pa = await ev(() => {
    const s2 = window.__sn2; T.spec(s2, 'snp-deadeye');
    T.deploy([s2]);
    const g = T.g, u = T.unit(s2), out = {};
    g.invuln = true;
    const e = T.dummy(u, 260);
    const up = { ...u.pos }; let seq = []; const d0 = g.damage.bind(g);
    g.damage = (x, amt, src, o) => { if (src === u) seq.push({ amt: +amt.toFixed(3), t: +g.time.toFixed(2) }); return d0(x, amt, src, o); };
    const still = () => { u.pos = { ...up }; u.vel = { x: 0, y: 0 }; e.hp = 1e9; e.fireCooldown = 1e9; };
    T.step(1.0, still); out.ready1 = u.elite.ready; out.charge1 = +u.elite.charge.toFixed(2);
    T.step(2.2, still); out.ready3 = u.elite.charge >= 3 || u.elite.procs > 0;
    T.step(9, still);
    const base = Math.min(...seq.map((x) => x.amt));
    out.stillSeq = seq.map((x) => +(x.amt / base).toFixed(3)).join(',');
    out.charged = seq.filter((x) => Math.abs(x.amt / base - 1.75) < 1e-6).length; out.shots = seq.length; out.procs = u.elite.procs;
    out.gaps = seq.filter((x) => Math.abs(x.amt / base - 1.75) < 1e-6).map((x) => x.t);
    // moving resets the charge: walk back and forth, no charged shot
    seq = []; u.elite.charge = 0;
    let k = 0; T.step(8, () => { k++; u.pos = { x: up.x + ((k % 120) < 60 ? (k % 60) : 60 - (k % 60)), y: up.y }; u.vel = { x: (k % 120) < 60 ? 60 : -60, y: 0 }; u.moveFrac = 1; e.hp = 1e9; e.fireCooldown = 1e9; });
    out.moveCharged = seq.filter((x) => Math.abs(x.amt / base - 1.75) < 1e-6).length; out.moveShots = seq.length; out.moveCharge = u.elite.charge;
    // Focus: still works; charged shots stay at most one per 3 s of stationary aim
    seq = []; u.elite.charge = 0; u.moveFrac = 0; T.step(0.5, still);
    u.ability.cooldownLeft = 0; out.focus = g.useAbility(u) && u.ability.id;
    const t0 = g.time; T.step(6.5, still);
    out.focusShots = seq.length; out.focusCharged = seq.filter((x) => Math.abs(x.amt / base - 1.75) < 1e-6).length; out.focusSecs = +(g.time - t0).toFixed(2);
    g.damage = d0; g.invuln = false;
    out.avgGain = 0;
    return out;
  });
  check('D21 Perfect Aim: no charge before 3 s; a ready indicator once charged', pa.ready1 === false && pa.ready3, JSON.stringify({ ready1: pa.ready1, charge1: pa.charge1, ready3: pa.ready3 }));
  check('D22 Perfect Aim: standing still, one +75% shot per ~3 s of aim, ordinary shots in between', pa.charged >= 3 && pa.charged <= 5 && pa.charged === pa.procs, `${pa.shots} shots, ${pa.charged} charged: ${pa.stillSeq}`);
  check('D23 Perfect Aim: moving resets the charge (no charged shot while repositioning)', pa.moveShots > 0 && pa.moveCharged === 0, JSON.stringify({ shots: pa.moveShots, charged: pa.moveCharged }));
  check('D24 Sniper Focus still works with Perfect Aim: faster shots, charged shots still one per 3 s', pa.focus === 'focus' && pa.focusCharged >= 1 && pa.focusCharged <= 3 && pa.focusShots > pa.focusCharged, JSON.stringify({ shots: pa.focusShots, charged: pa.focusCharged, secs: pa.focusSecs }));

  // D25 per-shot cap
  const cap = await ev(() => {
    const u = { rallied: true, elite: new (T.EL.EliteState)(T.EL.ELITE_SPECS['snp-deadeye']) }; u.elite.charge = 99;
    T.C.elite.perfectAimBonus = 3; const f = T.EL.onFire(u); T.C.elite.perfectAimBonus = 0.75;
    const v = { elite: new (T.EL.EliteState)(T.EL.ELITE_SPECS['inf-recon']) }; v.elite.hits = 4;
    const h = T.EL.onHit(v, 1.1);
    return { fire: f.mul, hit: +(1.1 * h.mul).toFixed(4) };
  });
  check('D25 per-shot multiplier cap x2.0 (tuned extremes clamp); Rally + Deadeye = x1.65', cap.fire === 2 && cap.hit === 1.65, JSON.stringify(cap));

  // ================= E. PERMADEATH / XP =================
  const pd = await ev(() => {
    const a = T.a, R = T.R, out = {};
    a.credits = 0;
    T.spec('ace', 'inf-trooper');
    T.R.get('ace').resurrections = 0;
    T.deploy(['ace', 'ranger']);
    const g = T.g, u = T.unit('ace');
    g.damage(u, 1e6); u.bleed = 0.01; T.step(0.3);
    g.fail();
    out.kia = R.get('ace').status; out.pending = a.pendingDecision && a.pendingDecision.queue.map((q) => q.id).join();
    out.cost = window.__casualties.costFor(R.get('ace')); out.recCost = window.__casualties.resurrectionCost(0, 'recruit');
    a.credits = out.cost;
    const rs = T.E.resurrect(R, a, 'ace', window.__persist);
    out.res = rs.ok; out.cr = a.credits; const p = R.get('ace').progression;
    out.after = { st: R.get('ace').status, tier: p.tier, path: p.elitePath, el: p.eliteLevel, tag: T.EL.levelTag(R.get('ace')) };
    // second death -> Memorial keeps the Elite identity
    T.deploy(['ace', 'ranger']);
    const u2 = T.unit('ace'); g.damage(u2, 1e6); u2.bleed = 0.01; T.step(0.3); g.fail();
    T.E.memorialize(R, a, 'ace', window.__persist);
    const m = a.memorial.find((x) => x.soldier.id === 'ace');
    out.mem = m && { tier: m.soldier.progression.tier, path: m.soldier.progression.elitePath };
    out.memTag = m && T.EL.levelTag(m.soldier);
    // XP after promotion is banked as Elite XP; Recruit XP stays at level 25
    T.spec('tank', 'hvy-juggernaut'); const tp = R.get('tank').progression; tp.eliteXp = 0; const xp0 = tp.xp;
    T.deploy(['tank', 'ranger']);
    g.mission.debugReadyExtraction(g);
    const c = g.mission.extraction.zone; const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
    T.calm(); g.soldiers.forEach((s, i) => { s.pos = { x: cc.x - 20 + i * 40, y: cc.y }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...cc };
    T.stepUntil(() => g.phase !== 'playing', 30, () => { for (const s of g.soldiers) s.vel = { x: 0, y: 0 }; });
    out.won = g.phase; out.xp = { recruit: tp.xp - xp0, elite: tp.eliteXp, lv: tp.level, el: tp.eliteLevel };
    const rw = g.lastReward || null; out.reward = rw ? JSON.stringify((rw.soldiers || []).find((s) => s.id === 'tank')) : null;
    return out;
  });
  check('E1 Elite KIA is permanent and queues the casualty decision', pd.kia === 'kia' && pd.pending === 'ace', JSON.stringify({ kia: pd.kia, pending: pd.pending }));
  check('E2 Elite resurrection costs twice a Recruit\'s', pd.cost === pd.recCost * 2, `${pd.cost} vs ${pd.recCost}`);
  check('E3 resurrected Elite keeps the specialization and Elite Level 1', pd.res && pd.cr === 0 && pd.after.st === 'active' && pd.after.tier === 'elite' && pd.after.path === 'inf-trooper' && pd.after.tag === 'ELITE 1', JSON.stringify(pd.after));
  check('E4 Memorial keeps the Elite identity (specialization, ELITE 1)', pd.mem && pd.mem.tier === 'elite' && pd.mem.path === 'inf-trooper' && pd.memTag === 'ELITE 1', JSON.stringify(pd.mem));
  check('E5 mission XP after promotion: goes to Elite XP, Recruit XP / level unchanged (one mission < 600 XP: still Elite 1)', pd.won === 'won' && pd.xp.recruit === 0 && pd.xp.elite > 0 && pd.xp.lv === 25 && pd.xp.el === 1, JSON.stringify(pd.xp));

  // ================= F. FULL ELITE SQUADS, 30 / 60 FPS =================
  {
    const SEED = 4242;
    const init = ({ seed }) => {
      let s = seed >>> 0;
      Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      let q = [], now = 1000;
      window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
      window.__drive = (period, until) => { let n = 0; while (!until() && n < 1e6) { now += period; const cbs = q; q = []; for (const cb of cbs) cb(now); n++; } return n; };
    };
    const setup = ({ mission, squad: sq0 }) => {
      let squad = sq0;
      const g = window.game, P = window.__progression;
      window.__debugUnlockAll();
      // 'sniper1' / 'sniper2': Snipers recruited through the office (seeded, so every run gets the same ones)
      const a = window.__account(), E = window.__economy;
      squad = squad.map(([id, sp]) => {
        if (!id.startsWith('sniper')) return [id, sp];
        if (!a.classUnlocks.unlocked.includes('sniper')) { a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper'); }
        E.openOffice(g.roster, a, null);
        let o = null; for (let i = 0; i < 300 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'sniper'); if (!o) { a.credits += 100; E.refreshOffers(g.roster, a, null, null); } }
        a.credits += 5000; return [E.recruit(g.roster, a, o.id, null).soldier.id, sp];
      });
      for (const [id, sp] of squad) { const s = g.roster.get(id); if (!s) continue; s.progression.xp = P.xpForLevel(25); s.progression.level = 25; if (sp) { s.progression.tier = 'elite'; s.progression.elitePath = sp; s.progression.specialization = sp; s.progression.eliteLevel = 1; } }
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
    const run = async (mission, squadKey, hz, cap, secs) => {
      const c = await browser.newContext({ viewport: { width: 844, height: 390 } });
      const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
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
        const procs = g.soldiers.filter((s) => s.elite).map((s) => `${s.elite.id}:${s.elite.procs}`).join(' ');
        return { hashes: out, steps, phase: g.phase, t: +g.time.toFixed(2), procs };
      }, { hz, secs, hashSrc: hashState.toString() });
      if (OUT && hz === 60 && cap === 60) await p.screenshot({ path: `${OUT}/field-${mission}-${squadKey}.png` });
      await c.close();
      return { ...res, squad, errs };
    };
    for (const [mission, sq, secs] of [['prison-break', 'a', 75], ['iron-fist', 'b', 90], ['blackout', 'c', 90], ['iron-fist', 'c', 90], ['bridgehead', 'a', 75], ['first-contact', 'a', 60]]) {
      const ref = await run(mission, sq, 60, 60, secs);
      console.log(`  ${mission} squad ${ref.squad}: ${ref.steps} steps, phase ${ref.phase}, t=${ref.t}; passives fired: ${ref.procs}`);
      let same = true; const notes = [];
      for (const [hz, cap] of [[120, 30], [60, 30], [90, 60]]) {
        const r = await run(mission, sq, hz, cap, secs);
        const d = r.hashes.findIndex((h, i) => h !== ref.hashes[i]);
        if (d >= 0 || r.hashes.length !== ref.hashes.length) { same = false; notes.push(`${hz}Hz/cap${cap} differs at ${(d + 1) * 5}s`); }
        if (r.errs.length) { same = false; notes.push(r.errs[0]); }
      }
      check(`F ${mission}: full Elite squad plays without errors; 30 / 60 FPS caps simulate identically`, same && ref.errs.length === 0 && ref.hashes.length >= 5, notes.join('; ') || `${ref.hashes.length} checkpoints`);
    }

  // ================= H. MISSIONS 1-10 WITH ELITE SQUADS (autopilot) =================
    {
      const all = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home', 'bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist'];
      const rows = []; let bad = 0;
      for (const [i, mission] of all.entries()) {
        const r = await run(mission, i % 2 ? 'b' : 'c', 60, 60, 420);
        const ok = r.errs.length === 0 && r.phase === 'won';
        if (!ok) bad++;
        rows.push(`M${i + 1} ${r.phase} t=${r.t}`);
        console.log(`  H M${i + 1} ${mission} (${r.squad}): ${r.phase} at t=${r.t}; passives: ${r.procs}${r.errs.length ? ' ERROR ' + r.errs[0] : ''}`);
      }
      check('H Missions 1-10 all playable and won by Elite squads (autopilot, Recruit Level 25), no errors', bad === 0, rows.join(' · '));
    }
  }

  // ================= G. UI (phones, landscape) =================
  const PHONES = [
    ['iphone-se', { viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['iphone-14', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['pixel-7', { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true }],
  ];
  for (const [name, opts] of PHONES) {
    const c = await browser.newContext(opts); await c.addInitScript(installHelpers);
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.goto(URL); await p.waitForFunction(() => !!window.game);
    await p.evaluate(() => { window.__debugUnlockAll(); window.game.debugPromotionReady(); T.a.credits = 5000; window.__persist(); });
    await p.evaluate(() => { document.querySelectorAll('.m-modal [data-a$="-later"], .m-modal [data-a="close"]').forEach((b) => b.click()); });
    await p.click('[data-a="to-barracks"]');
    await p.waitForSelector('.s-card[data-id="ace"]');
    const ribbon = await p.isVisible('.s-card[data-id="ace"] .s-promo');
    await p.click('.s-card[data-id="ace"] .s-name');
    await p.waitForSelector('.pr-box');
    const box = await p.evaluate(() => {
      const b = document.querySelector('.pr-box'), t = b.textContent;
      const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1; };
      return { t, opts: [...b.querySelectorAll('.pr-opt')].map((o) => o.dataset.spec).join(), btns: [...b.querySelectorAll('[data-a="promo-pick"]')].every(inView), noLv1: !/LV 1\b/.test(document.querySelector('.d-card').textContent) };
    });
    if (OUT) { await p.evaluate(() => document.querySelector('.pr-box').scrollIntoView({ block: 'start' })); await p.screenshot({ path: `${OUT}/promo-${name}.png` }); }
    check(`G ${name}: roster ribbon + "ELITE PROMOTION AVAILABLE" with 3,000 CR, both choices, passives, permanent notice`,
      ribbon && /ELITE PROMOTION AVAILABLE/.test(box.t) && /3,000 CR/.test(box.t) && box.opts === 'inf-trooper,inf-recon' && /Adrenaline Rush/.test(box.t) && /Deadeye/.test(box.t) && /permanent/i.test(box.t) && box.btns, box.t.slice(0, 120));
    await p.click('[data-a="promo-pick"][data-spec="inf-recon"]');
    await p.waitForSelector('.pr-confirm');
    const conf = await p.evaluate(() => { const d = document.querySelector('.pr-confirm'); const b = d.querySelector('[data-a="promo-confirm"]'); const r = b.getBoundingClientRect(); return { t: d.textContent, armed: !b.disabled, inView: r.bottom <= innerHeight + 1 || d.scrollHeight > d.clientHeight }; });
    if (OUT) await p.screenshot({ path: `${OUT}/confirm-${name}.png` });
    check(`G ${name}: confirmation shows name, class, specialization, passive, cost, Credits after, warning; confirm not armed instantly`,
      /Ace/.test(conf.t) && /Infantry/.test(conf.t) && /RECON COMMANDO/.test(conf.t) && /Deadeye/.test(conf.t) && /3,000 CR/.test(conf.t) && /2,000 CR/.test(conf.t) && /permanent/.test(conf.t) && !conf.armed, conf.t.slice(0, 140));
    await p.click('[data-a="promo-cancel"]');
    const cancel = await p.evaluate(() => ({ cr: T.a.credits, tier: T.R.get('ace').progression.tier, modal: !!document.querySelector('.pr-confirm'), box: !!document.querySelector('.pr-box') }));
    check(`G ${name}: Cancel changes nothing (Credits, rank), back to the profile`, cancel.cr === 5000 && cancel.tier === 'recruit' && !cancel.modal && cancel.box, JSON.stringify(cancel));
    await p.click('[data-a="promo-pick"][data-spec="inf-recon"]');
    await p.waitForTimeout(800);
    await p.click('[data-a="promo-confirm"]');
    await p.click('[data-a="promo-confirm"]', { timeout: 300 }).catch(() => {}); // a double tap must not promote twice
    await p.waitForSelector('.cer-card');
    await p.waitForTimeout(700);
    const cer = await p.evaluate(() => ({ t: document.querySelector('.cer-card').textContent, cr: T.a.credits, led: T.a.promotions.length, path: T.R.get('ace').progression.elitePath, saved: T.store().roster.find((s) => s.id === 'ace').progression.elitePath }));
    if (OUT) await p.screenshot({ path: `${OUT}/ceremony-${name}.png` });
    check(`G ${name}: ceremony shows name, title, specialization; 3,000 CR charged once; saved`, /ACE/.test(cer.t) && /RECON COMMANDO/.test(cer.t) && /Mobile Precision Fighter/.test(cer.t) && cer.cr === 2000 && cer.led === 1 && cer.path === 'inf-recon' && cer.saved === 'inf-recon', JSON.stringify({ ...cer, t: cer.t.slice(0, 80) }));
    await p.click('[data-a="ceremony-close"]');
    await p.waitForSelector('.el-box');
    const prof = await p.evaluate(() => { const d = document.querySelector('.d-card'); return { t: d.textContent, promo: !!document.querySelector('.pr-box') }; });
    if (OUT) await p.screenshot({ path: `${OUT}/profile-${name}.png` });
    check(`G ${name}: Elite profile: ELITE 1, specialization, passive, trait, training, stats; never "LV 1"; no second offer`,
      /ELITE 1/.test(prof.t) && /RECON COMMANDO/.test(prof.t) && /Deadeye/.test(prof.t) && /Sharpshooter/i.test(prof.t) && /Training:/.test(prof.t) && /Max HP/.test(prof.t) && !/\bLV 1\b/.test(prof.t) && !prof.promo, prof.t.slice(0, 160));
    if (OUT && name === 'iphone-14') {
      await p.click('[data-a="close"]');
      await p.evaluate(() => { for (const [id, sp] of [['ranger', 'inf-trooper'], ['tank', 'hvy-juggernaut'], ['havoc', 'hvy-weapons'], ['doc', 'med-surgeon'], ['patch', 'med-commander']]) { T.a.credits += 3000; T.E.promote(T.R, T.a, id, sp, window.__persist); } window.game.menus?.renderBarracks?.(); });
      await p.click('[data-a="to-campaign"]').catch(() => {}); await p.click('[data-a="to-barracks"]').catch(() => {});
      await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/barracks-elites-${name}.png` });
    }
    check(`G ${name}: no page errors`, errs.length === 0, errs[0]);
    await c.close();
  }

  check('no page errors (main page)', errors.length === 0, errors[0]);
  await browser.close();
  console.log(fails ? `${fails} of ${total} FAILED` : `ALL ${total} PASS`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
