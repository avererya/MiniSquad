// v0.3 progression checks: XP + levels, stat growth pipeline, credits, individual + squad
// training, anti-duplication, save v2 + migration from a real v0.2.2 save, and the Barracks
// tabs / Results on phones. PASS/FAIL per check, exit 1 on any failure.
//   OUT=dir (screenshots, optional)  URL=http://localhost:4173/
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';
const V022 = fs.readFileSync(path.join(__dirname, 'fixtures/v0.2.2-save.json'), 'utf8').trim();

(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(74)} ${detail}`); };

  // ================= A. rules, in page =================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL);
    const res = await page.evaluate((V022) => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
      const g = window.game, P = window.__progression, E = window.__economy, A = window.__account, eff = window.__effectiveStats, CFG = window.__CFG;
      let R = g.roster; const byId = (id) => R.get(id);
      const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) g.update(1 / 60); };
      const clearEnemies = () => { g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.mission.defenders = [{ active: true }]; };
      const deploy = (ids) => { g.deploy(ids.map(byId)); clearEnemies(); g.invuln = false; };
      const setXp = (id, xp) => { const p = byId(id).progression; p.xp = xp; p.level = P.levelForXp(xp); };
      // v0.4: a fresh save only has Ace + Ranger and Mission 1; these v0.3 economy checks run on the
      // comms-outpost map (now Mission 3) with every soldier, so unlock all (debug) after each reset
      const resetAll = () => { window.__resetRosterSave(); window.__debugUnlockAll(); g.selectMission('field-medicine'); R = g.roster; };
      window.__debugUnlockAll(); g.selectMission('field-medicine');
      const r3 = (x) => Math.round(x * 1000) / 1000;

      // ---- XP curve ----
      const thr = [1, 2, 5, 10, 15, 20, 25].map((l) => P.xpForLevel(l));
      check('XP curve: thresholds L2 150, L5 750, L10 2250, L15 4375, L20 7125, L25 10500', thr.join() === '0,150,750,2250,4375,7125,10500', thr.join());
      check('XP curve: per-level step 150 + 25 x (L-1); 0 at the cap', P.xpToNext(1) === 150 && P.xpToNext(2) === 175 && P.xpToNext(24) === 725 && P.xpToNext(25) === 0, [1, 2, 24, 25].map(P.xpToNext).join());
      check('levelForXp boundaries (149 -> 1, 150 -> 2, 10499 -> 24, 10500/99999 -> 25)', P.levelForXp(149) === 1 && P.levelForXp(150) === 2 && P.levelForXp(10499) === 24 && P.levelForXp(10500) === 25 && P.levelForXp(99999) === 25, '');
      const m = P.addXp(0, 800);
      check('multiple level-ups in one award (0 + 800 XP -> L5)', m.level === 5 && m.xp === 800, JSON.stringify(m));
      const cap = P.addXp(10450, 150), cap2 = P.addXp(10500, 150);
      check('L25 cap: XP stops at 10500 (gained 50, then 0)', cap.xp === 10500 && cap.gained === 50 && cap.level === 25 && cap2.gained === 0 && cap2.xp === 10500, `${JSON.stringify(cap)} ${JSON.stringify(cap2)}`);

      // ---- reward math ----
      const oc = (statuses, downs, optional = { total: 0, completed: 0 }, won = true) => ({ missionId: 'x', runId: 'r', won, deployed: statuses.map((s, i) => ({ id: 'a' + i, status: s, downs: downs[i] })), optional });
      const c1 = P.computeMissionRewards(oc(['Standing', 'Standing', 'Standing'], [0, 0, 0]), true);
      const c2 = P.computeMissionRewards(oc(['Standing', 'Standing', 'Standing'], [0, 0, 0]), false);
      const c3 = P.computeMissionRewards(oc(['Standing', 'Standing', 'KIA'], [0, 1, 1]), true);
      const c4 = P.computeMissionRewards(oc(['Standing', 'Standing', 'Standing'], [0, 1, 0]), false);
      const c5 = P.computeMissionRewards(oc(['Standing', 'KIA'], [0, 1]), false);
      const c6 = P.computeMissionRewards(oc(['Standing'], [0], { total: 2, completed: 1 }), true);
      const c7 = P.computeMissionRewards(oc(['Downed', 'Downed'], [1, 1], undefined, false), true);
      check('first clear, perfect: 150 XP each, 1000 Credits (500+150+100+250)', c1.xpEach === 150 && c1.credits === 1000, `${c1.xpEach} XP, ${c1.credits} CR`);
      check('replay, perfect: 150 x 0.75 = 112.5 -> 113 XP, 650 Credits (400+150+100)', c2.xpEach === 113 && c2.credits === 650, `${c2.xpEach} XP, ${c2.credits} CR`);
      check('first clear with a KIA: no extraction/flawless bonus: 100 XP, 750 CR', c3.xpEach === 100 && c3.credits === 750, `${c3.xpEach} XP, ${c3.credits} CR`);
      check('replay, all out but one revived: 125 x 0.75 = 93.75 -> 94 XP, 550 CR', c4.xpEach === 94 && c4.credits === 550, `${c4.xpEach} XP, ${c4.credits} CR`);
      check('replay with a KIA: 75 XP, 400 CR (minimum win)', c5.xpEach === 75 && c5.credits === 400, `${c5.xpEach} XP, ${c5.credits} CR`);
      check('optional objectives (model): +25 XP / +150 CR each completed', c6.xpEach === 175 && c6.credits === 1150, `${c6.xpEach} XP, ${c6.credits} CR`);
      check('defeat: no XP, no Credits', c7.xpEach === 0 && c7.credits === 0 && c7.creditLines.length === 0, `${c7.xpEach} XP, ${c7.credits} CR`);
      check('Mission 3 has exactly one optional objective (Extract every soldier)', g.mission.optional.length === 1 && g.mission.optional[0].id === 'all-extracted' && g.mission.id === 'field-medicine', `${g.mission.id}: ${g.mission.optional.map((o) => o.id)}`);

      // ---- settlement in a real mission ----
      resetAll();
      deploy(['ace', 'tank', 'doc']);
      const [ace, tank, doc] = g.soldiers;
      g.downSoldier(tank); // downed ...
      doc.pos = { x: tank.pos.x + 15, y: tank.pos.y }; ace.pos = { x: tank.pos.x - 15, y: tank.pos.y }; g.anchor = { ...doc.pos };
      let t = 0; while (tank.state === 'downed' && t < 10) { g.update(1 / 60); t += 1 / 60; } // ... revived by Doc (real revive)
      const revived = tank.state === 'active';
      ace.pos = { x: doc.pos.x + 400, y: doc.pos.y }; tank.pos = { x: doc.pos.x + 420, y: doc.pos.y + 30 }; g.anchor = { ...ace.pos };
      g.downSoldier(doc); doc.bleed = 0.01; step(0.1); // nobody near: Doc bleeds out -> KIA
      const run1 = g.runId;
      g.win();
      const xp1 = R.soldiers.map((s) => `${s.id}:${s.progression.xp}`).join(' ');
      check('equal XP for eligible survivors; revived+extracted gets XP; KIA gets 0', revived && byId('ace').progression.xp === 100 && byId('tank').progression.xp === 100 && byId('doc').progression.xp === 0 && doc.state === 'kia', xp1);
      check('first clear credits with a KIA: 750 (no bonuses)', A().credits === 750 && A().missions['field-medicine'].completions === 1 && A().missions['field-medicine'].firstClearRun === run1, `credits ${A().credits}`);
      const cr1 = A().credits;
      g.win(); g.ui.showEnd(); g.ui.showEnd(); // re-render / repeated end
      const again = E.settleMission(R, A(), { missionId: 'field-medicine', runId: run1, won: true, deployed: [{ id: 'ace', status: 'Standing', downs: 0 }], optional: { total: 0, completed: 0 } });
      check('no double award: win() again, Results re-render, same run id settled again', A().credits === cr1 && again === null && byId('ace').progression.xp === 100, `credits ${A().credits}, settle again -> ${again}`);
      const resultsText = document.getElementById('menu').textContent;
      check('Results show XP per soldier, credit breakdown and total', /\+100 XP/.test(resultsText) && /no XP/.test(resultsText) && /Victory\+500/.test(resultsText.replace(/\s+/g, '')) && /First-time completion/.test(resultsText) && /750/.test(resultsText), resultsText.replace(/\s+/g, ' ').slice(0, 160));
      // retry: new run, replay rewards; full extraction + flawless
      g.reset(); clearEnemies();
      const run2 = g.runId;
      g.win();
      check('Retry = new run id; replay perfect: +113 XP each, +650 CR', run2 !== run1 && byId('ace').progression.xp === 213 && byId('doc').progression.xp === 113 && A().credits === cr1 + 650 && g.lastReward.firstClear === false, `ace ${byId('ace').progression.xp}, doc ${byId('doc').progression.xp}, credits ${A().credits}`);
      // OVERLAP RULE (Mission 3): the optional 'Extract every soldier' pays instead of the whole-squad line, same totals
      check('M3: optional (= whole squad extracted) + flawless listed, no double whole-squad line', g.lastReward.xpLines.map((l) => l.label).join() === 'Victory,Optional objectives 1/1,Nobody downed' && g.lastReward.creditLines.map((l) => l.label).join() === 'Victory (replay),Optional objectives 1/1,Nobody downed', g.lastReward.xpLines.map((l) => `${l.label} ${l.amount}`).join(', '));
      check('level-up from the award (Ace 100 -> 213 XP = LV 1 -> LV 2)', byId('ace').progression.level === 2 && g.lastReward.soldiers[0].before.level === 1 && g.lastReward.soldiers[0].after.level === 2, JSON.stringify(g.lastReward.soldiers[0]));
      // defeat: nothing (service record only)
      const crBefore = A().credits, xpBefore = byId('ace').progression.xp;
      g.reset(); clearEnemies(); g.soldiers.forEach((s) => g.downSoldier(s)); step(0.05);
      check('defeat: no XP, no Credits, Results say so', g.phase === 'failed' && A().credits === crBefore && byId('ace').progression.xp === xpBefore && /No XP or Credits/.test(document.getElementById('menu').textContent), `${g.phase}, credits ${A().credits}`);
      // dev deployments never earn
      g.reset(['infantry', 'heavy']); clearEnemies(); g.win();
      const crGen = A().credits;
      g.deploy([byId('ace')], 'temp'); clearEnemies(); g.win();
      check('dev presets / temporary squads earn nothing', crGen === crBefore && A().credits === crBefore && g.lastReward === null, `credits ${A().credits}`);
      // multi-level-up shown on Results
      setXp('ace', 0);
      const saveVic = P.PROGRESSION.xp.victory; P.PROGRESSION.xp.victory = 1000;
      deploy(['ace']); g.win(); P.PROGRESSION.xp.victory = saveVic;
      const lv = document.querySelector('.r-lvl')?.textContent || '';
      check('multi-level-up on Results ("ACE — LV 1 → LV 5 — +XXX XP")', /ACE — LV 1 → LV 5 — \+\d+ XP/.test(lv) && byId('ace').progression.level === 5, lv);
      // cap on Results
      setXp('ace', 10450); deploy(['ace']); g.win();
      const capRow = g.lastReward.soldiers[0];
      check('L25 cap: award capped, Results row marked MAX', byId('ace').progression.level === 25 && byId('ace').progression.xp === 10500 && capRow.capped && /MAX/.test(document.querySelector('.r-xp').textContent), `${byId('ace').progression.xp} xp, ${document.querySelector('.r-xp').textContent}`);
      g.toBarracks();

      // ---- stat growth + pipeline ----
      resetAll();
      const at = (id, level, training = {}, squad = {}) => eff(byId(id), { level, training: { ...P.newTraining(), ...training }, squad: { ...P.newSquadTraining(), ...squad } });
      const a10 = at('ace', 10), t10 = at('tank', 10), h10 = at('havoc', 10);
      check('growth L10 Ace: HP 109, dmg 10.675 (fraction kept), rate 3.135', a10.hp === 109 && a10.damage === 10.675 && a10.fireRate === 3.135 && a10.accuracy === 10.8, `hp ${a10.hp} dmg ${a10.damage} rate ${a10.fireRate} cone ${a10.accuracy}`);
      check('growth x trait: Tank L10 (Tough) HP 150 x 1.09 x 1.1 = 179.85', t10.hp === 179.85 && t10.damage === 6.405, `hp ${t10.hp} dmg ${t10.damage}`);
      check('growth x trait: Havoc L10 (Trigger Happy) rate 7 x 1.045 x 1.05 = 7.68075', h10.fireRate === 7.68075, h10.fireRate);
      check('growth is from level, not compounded (L25 Ace HP 124, not 100 x 1.01^24)', at('ace', 25).hp === 124 && at('ace', 25).damage === 11.8, `${at('ace', 25).hp} / ${at('ace', 25).damage}`);
      // Havoc L20 + training + squad + Suppressive (worked example)
      setXp('havoc', P.xpForLevel(20)); byId('havoc').training.fireRate = 5; A().squadTraining.fireRate = 3;
      deploy(['havoc']); const hv = g.soldiers[0];
      const hvRate = hv.fireRate; g.useAbility(hv); const hvSup = hv.fireRate;
      check('Havoc L20 + Fire Rate 5 + Squad Fire Rate 3, x Trigger Happy, x Suppressive', r3(hvRate) === r3(7 * (1 + 0.095 + 0.15 + 0.03) * 1.05) && r3(hvSup) === r3(hvRate * 1.75), `base rate ${r3(hvRate)} (7 x 1.275 x 1.05), suppressing ${r3(hvSup)}`);
      g.toBarracks(); resetAll();
      // no stacking on redeploy/retry/reload-like re-reads
      setXp('tank', P.xpForLevel(6)); byId('tank').training.hp = 2;
      const reads = [];
      for (let i = 0; i < 3; i++) { if (i === 0) deploy(['tank']); else { g.reset(); clearEnemies(); } reads.push(g.soldiers[0].maxHp); }
      check('no stacking across deploy + retry (Tank L6 + HP rank 2: 150 x 1.15 x 1.1 = 189.75)', reads.every((x) => x === 189.75), reads.join());
      g.toBarracks();
      check('pipeline never mutates CFG', CFG.heavy.hp === 150 && CFG.infantry.damage === 10 && CFG.heavy.fireRate === 7, '');
      // tuning still edits class base under everything
      CFG.heavy.hp = 200; const tuned = eff(byId('tank')).hp; CFG.heavy.hp = 150;
      check('tuning edits class base; level + training + trait apply on top', tuned === 253, `heavy 200 -> Tank ${tuned} (200 x 1.15 x 1.1)`);
      // spread floor
      byId('ace').training.accuracy = 10; A().squadTraining.accuracy = 5;
      const aMax = eff(byId('ace'));
      CFG.infantry.accuracy = 2; const aFloor = eff(byId('ace')); CFG.infantry.accuracy = 12;
      check('accuracy: 12 x (1 - 0.5 - 0.1) x 0.9 = 4.32° standing, moving 4.32 + 6.48 = 10.8 (max ranks)', aMax.accuracy === 4.32 && r3(aMax.accuracy + aMax.movePenalty) === 10.8, `${aMax.accuracy} / ${r3(aMax.accuracy + aMax.movePenalty)}`);
      check('spread floor 1°: tuned 2° base x 0.36 = 0.72 -> 1°', aFloor.accuracy === 1 && aFloor.movePenalty > 0, `${aFloor.accuracy} (+${r3(aFloor.movePenalty)})`);
      resetAll();

      // ---- purchases ----
      const T = P.TRAINING;
      check('individual costs 250..2500 (10 ranks), squad 1000..3500 (5 ranks)', T.damage.costs.join() === '250,400,550,700,900,1150,1450,1750,2100,2500' && P.SQUAD_TRAINING.hp.costs.join() === '1000,1500,2000,2750,3500' && P.TRAINING_IDS.every((k) => P.maxRank(T[k]) === 10), '');
      const persist = window.__persist;
      let r = E.buyTraining(R, A(), 'ace', 'damage', 0, persist);
      check('insufficient credits: refused, nothing changes', !r.ok && A().credits === 0 && byId('ace').training.damage === 0, r.reason);
      A().credits = 1000;
      const seq = [];
      for (let i = 0; i < 3; i++) { r = E.buyTraining(R, A(), 'ace', 'damage', byId('ace').training.damage, persist); seq.push(r.ok ? r.cost : r.reason); }
      check('escalating cost: 250, 400, then 550 refused with 350 left', seq[0] === 250 && seq[1] === 400 && /Not enough/.test(seq[2]) && A().credits === 350 && byId('ace').training.damage === 2, seq.join(' | '));
      A().credits = 5000;
      r = E.buyTraining(R, A(), 'ace', 'damage', 0, persist);
      check('stale / duplicate purchase event (expected rank 0, actual 2) refused', !r.ok && byId('ace').training.damage === 2 && A().credits === 5000, r.reason);
      byId('ace').training.hp = 10; r = E.buyTraining(R, A(), 'ace', 'hp', 10, persist);
      check('max rank: refused at 10/10', !r.ok && /maxed/.test(r.reason) && byId('ace').training.hp === 10, r.reason);
      check('individual training is per soldier (Ranger untouched)', eff(byId('ranger')).damage === 10 && eff(byId('ace')).damage === 10.6 && eff(byId('ace')).hp === 150, `Ace dmg ${eff(byId('ace')).damage} hp ${eff(byId('ace')).hp}, Ranger dmg ${eff(byId('ranger')).damage}`);
      const saved1 = JSON.parse(localStorage.getItem('minisquad.save'));
      check('purchase persisted atomically (credits + rank in the save)', saved1.account.credits === 350 && saved1.roster[0].training.damage === 2, `${saved1.account.credits} / ${saved1.roster[0].training.damage}`);
      // failed write rolls back
      const before = [A().credits, byId('ace').training.fireRate];
      r = E.buyTraining(R, A(), 'ace', 'fireRate', 0, () => 'error');
      check('failed save rolls the purchase back', !r.ok && A().credits === before[0] && byId('ace').training.fireRate === before[1], r.reason);
      // squad training
      r = E.buySquadTraining(A(), 'hp', 0, persist); const r2 = E.buySquadTraining(A(), 'hp', 1, persist); const r3b = E.buySquadTraining(A(), 'hp', 1, persist);
      const hpAll = R.soldiers.map((s) => `${s.id}:${eff(s).hp}`).join(' ');
      g.reset(['infantry']); const genHp = g.soldiers[0].maxHp; g.toBarracks();
      check('squad HP 2 ranks (1000 + 1500): +4% of class base for every roster soldier', r.ok && r2.ok && !r3b.ok && eff(byId('ranger')).hp === 104 && eff(byId('tank')).hp === 171.6 && eff(byId('doc')).hp === 83.2 && eff(byId('ace')).hp === 154 && A().credits === 2500, hpAll);
      check('squad training does not apply to dev generics (class base only)', genHp === 100, genHp);
      A().squadTraining.hp = 5; const sq5 = eff(byId('ranger')).hp; A().squadTraining.hp = 9;
      const sqClamp = window.__parseSave(JSON.stringify({ ...JSON.parse(localStorage.getItem('minisquad.save')), account: { ...A(), squadTraining: { hp: 9, damage: -2, accuracy: 2.6, fireRate: 'x' } } }));
      check('squad ranks validated on load (9 -> 5, -2 -> 0, 2.6 -> 2, "x" -> 0)', sq5 === 110 && JSON.stringify(sqClamp.account.squadTraining) === '{"hp":5,"damage":0,"accuracy":2,"fireRate":0}', JSON.stringify(sqClamp.account.squadTraining));
      resetAll();

      // ---- save: migration + validation ----
      const mig = window.__parseSave(V022);
      check('migration: real v0.2.2 save (custom squad Patch/Havoc/Ranger) -> v3 in place, all 6 unlocked, campaign at M1', mig.status === 'migrated' && mig.fromVersion === 1 && mig.roster.slots.join() === 'patch,havoc,ranger,,,' && mig.roster.unlocked.size === 6 && mig.account.campaign.unlockedMissions.join() === 'first-contact' && mig.roster.soldiers.length === 6 && mig.roster.soldiers.every((s) => s.progression.level === 1 && s.progression.xp === 0 && s.progression.tier === 'recruit' && s.status === 'active' && s.resurrections === 0) && mig.account.credits === 0, `${mig.status} ${mig.roster.slots.join()} notes ${mig.notes.length}`);
      const v1 = JSON.parse(V022);
      v1.roster[0].progression = { level: 4, upgrades: [], specialization: null }; // xp missing
      v1.roster[1].progression.xp = 99999;
      v1.roster.push({ ...v1.roster[2], id: 'ghost' });
      v1.roster.push({ ...v1.roster[3] }); // duplicate id
      const rep = window.__parseSave(JSON.stringify(v1));
      check('validation: missing XP -> from level (L4 = 525), XP above cap clamped, unknown + duplicate ids dropped', rep.status === 'repaired' && rep.roster.get('ace').progression.xp === 525 && rep.roster.get('ace').progression.level === 4 && rep.roster.get('ranger').progression.xp === 10500 && rep.roster.get('ranger').progression.level === 25 && !rep.roster.get('ghost') && rep.roster.soldiers.length === 6, rep.notes.join(' '));
      const v2 = JSON.parse(localStorage.getItem('minisquad.save'));
      v2.account.credits = -500; v2.roster[0].training = { damage: 3.7, hp: 99, accuracy: -1, fireRate: 'x', moveSpeed: 2 };
      v2.account.settledRuns = ['a', 'a', 'b', 5]; v2.roster[2].progression.level = 9; v2.roster[2].progression.xp = 100;
      const rep2 = window.__parseSave(JSON.stringify(v2));
      const tr = rep2.roster.get('ace').training;
      check('validation: negative credits -> 0, ranks clamped / floored, run ids deduped', rep2.account.credits === 0 && tr.damage === 3 && tr.hp === 10 && tr.accuracy === 0 && tr.fireRate === 0 && tr.moveSpeed === 2 && rep2.account.settledRuns.join() === 'a,b', `${rep2.account.credits} ${JSON.stringify(tr)} ${rep2.account.settledRuns}`);
      check('validation: level above its XP -> XP raised to that level (L9)', rep2.roster.get('tank').progression.level === 9 && rep2.roster.get('tank').progression.xp === P.xpForLevel(9), JSON.stringify(rep2.roster.get('tank').progression));
      const good = window.__parseSave(localStorage.getItem('minisquad.save'));
      check('a clean v2 save loads as "loaded" with no notes', good.status === 'loaded' && good.notes.length === 0, good.notes.join(' '));
      return out;
    }, V022);
    for (const r of res) check(r.name, r.ok, r.detail);
    check('A: no page errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ================= B. UI flows (desktop): duplicates, reload, rapid taps, migration =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('minisquad.save')));
    await page.goto(URL); await page.waitForTimeout(200);
    await page.click('[data-a="deploy"]');
    await page.evaluate(() => window.game.win());
    await page.waitForTimeout(100);
    const credUI = await page.textContent('.r-cr');
    if (OUT) await page.screenshot({ path: `${OUT}/desktop-results-first-clear.png` });
    let sv = await save();
    check('UI: first clear pays 1000 CR, shown on Results and saved at once', credUI === '1,000' && sv.account.credits === 1000 && sv.roster.find((s) => s.id === 'ace').progression.xp === 150, `results ${credUI}, saved ${sv.account.credits}`);
    await page.reload(); await page.waitForTimeout(200); // reload while on Results
    sv = await save();
    check('UI: reload on Results: no duplicate reward, back on the Campaign screen', sv.account.credits === 1000 && sv.roster.find((s) => s.id === 'ace').progression.xp === 150 && await page.isVisible('#menu.campaign'), `credits ${sv.account.credits}`);
    check('UI: Campaign header shows credits + version "MiniSquad v0.4 · <hash>"', (await page.textContent('.m-cr')) === '1,000' && /^MiniSquad v0\.4 · [0-9a-f]{7,}$|^MiniSquad v0\.4 · dev$/.test((await page.textContent('.m-ver')).trim()), (await page.textContent('.m-ver')).trim());
    await page.click('[data-a="csel"][data-id="first-contact"]'); // the campaign moved on to M2: replay M1
    await page.click('[data-a="deploy"]');
    await page.evaluate(() => window.game.win());
    await page.keyboard.press('Enter'); // Retry from Results
    await page.evaluate(() => window.game.win());
    await page.click('[data-a="retry"]');
    await page.evaluate(() => window.game.win());
    sv = await save();
    check('UI: 3 replays via Enter / Retry button: exactly +650 each (1000 + 1950)', sv.account.credits === 2950 && sv.account.missions['first-contact'].completions === 4, `credits ${sv.account.credits}, completions ${sv.account.missions['first-contact'].completions}`);
    await page.click('[data-a="barracks"]');
    // training tab: rapid taps
    await page.click('[data-tab="training"]');
    await page.click('.t-pick[data-id="tank"]');
    const btn = '.t-row[data-stat="damage"] .t-buy';
    await page.dblclick(btn);
    for (let i = 0; i < 4; i++) await page.click(btn, { delay: 0, force: true }).catch(() => {});
    let tk = await page.evaluate(() => ({ r: window.game.roster.get('tank').training.damage, c: window.__account().credits }));
    check('UI: double-click + 4 rapid clicks on Buy = exactly ONE rank, 250 CR', tk.r === 1 && tk.c === 2700, JSON.stringify(tk));
    await page.waitForTimeout(400);
    await page.click(btn);
    tk = await page.evaluate(() => ({ r: window.game.roster.get('tank').training.damage, c: window.__account().credits, btn: document.querySelector('.t-row[data-stat="damage"] .t-buy').textContent }));
    check('UI: next deliberate tap buys rank 2 for 400; button shows next cost 550', tk.r === 2 && tk.c === 2300 && /550/.test(tk.btn), JSON.stringify(tk));
    const rowText = await page.textContent('.t-row[data-stat="damage"]');
    check('UI: row shows rank, current -> after-purchase value', /RANK 2\/10/.test(rowText) && /6\.\d+ → 6\.\d+/.test(rowText), rowText.replace(/\s+/g, ' ').trim());
    await page.evaluate(() => { window.__account().credits = 100; window.game.ui.showStart(); });
    await page.click('[data-tab="training"]');
    const dis = await page.evaluate(() => [...document.querySelectorAll('.t-buy')].every((b) => b.disabled));
    check('UI: all Buy buttons disabled when unaffordable', dis);
    if (OUT) await page.screenshot({ path: `${OUT}/desktop-training.png` });
    await page.evaluate(() => { window.__account().credits = 3000; window.game.ui.showStart(); });
    await page.click('[data-tab="squad"]');
    await page.click('.t-row[data-stat="fireRate"] .t-buy');
    await page.click('.t-row[data-stat="fireRate"] .t-buy', { force: true }).catch(() => {});
    sv = await save();
    check('UI: squad training purchase (1000), repeated tap ignored, saved', sv.account.squadTraining.fireRate === 1 && sv.account.credits === 2000, JSON.stringify(sv.account.squadTraining));
    if (OUT) await page.screenshot({ path: `${OUT}/desktop-squad-training.png` });
    await page.reload(); await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ tank: window.game.roster.get('tank').training.damage, sq: window.__account().squadTraining.fireRate, cr: window.__account().credits, tankDmg: window.__effectiveStats(window.game.roster.get('tank')).damage }));
    check('UI: everything persists across reload (ranks, squad rank, credits)', after.tank === 2 && after.sq === 1 && after.cr === 2000, JSON.stringify(after));
    // squad change keeps upgrades (v0.4: reload lands on the Campaign screen; squad is Ace + Ranger)
    await page.click('[data-a="to-barracks"]');
    await page.click('[data-tab="roster"]');
    await page.click('.slot[data-slot="1"] .slot-x');
    await page.click('.s-card[data-id="ranger"] .pick');
    await page.click('[data-a="deploy"]');
    const hasTank = await page.evaluate(() => window.game.soldiers.some((s) => s.identity.id === 'tank'));
    await page.evaluate(() => window.game.toBarracks());
    check('UI: squad change keeps Tank\'s training', !hasTank && (await page.evaluate(() => window.game.roster.get('tank').training.damage)) === 2);
    // migration through the real loader
    await page.evaluate((raw) => { localStorage.setItem('minisquad.save', raw); localStorage.removeItem('minisquad.save.pre-v0.4'); }, V022);
    const V022raw = V022;
    await page.reload(); await page.waitForTimeout(250);
    const onCampaign = await page.isVisible('#menu.campaign');
    const notice = await page.textContent('.m-notice').catch(() => '');
    await page.click('[data-a="to-barracks"]');
    const m = await page.evaluate(() => ({ status: window.__loadStatus.status, slots: window.game.roster.slots.join(), saved: JSON.parse(localStorage.getItem('minisquad.save')), notice: document.querySelector('.m-notice').textContent, cards: document.querySelectorAll('.s-card').length }));
    check('UI: v0.2.2 save migrated in place on load (squad kept, v3 written, notice on Campaign)', onCampaign && m.status === 'migrated' && m.slots === 'patch,havoc,ranger,,,' && m.saved.version === 3 && m.saved.squad.filter(Boolean).join() === 'patch,havoc,ranger' && m.saved.unlockedSoldiers.length === 6 && m.cards === 6 && /kept/.test(notice), `${m.status} ${m.slots} "${notice}"`);
    const backup = await page.evaluate(() => localStorage.getItem('minisquad.save.pre-v0.4'));
    check('UI: the original v0.2.2 save text is kept once as a pre-v0.4 backup', backup === V022raw, `backup ${backup ? backup.length : 0} chars`);
    check('B: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ================= C. phones (landscape + rotation): all tabs + Results =================
  const DEVICES = [
    { name: 'iphone14', land: [844, 390], dpr: 3 },
    { name: 'iphoneSE', land: [667, 375], dpr: 2 },
    { name: 'pixel7', land: [915, 412], dpr: 2.625 },
  ];
  for (const dev of DEVICES) {
    const [W, H] = dev.land;
    const ctx = await browser.newContext({ viewport: { width: H, height: W }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(200);
    await page.evaluate(() => { window.__debugUnlockAll(); const a = window.__account(); a.credits = 4200; const r = window.game.roster; r.get('ace').progression.xp = 600; r.get('ace').progression.level = 4; r.get('ace').training.damage = 3; a.squadTraining.hp = 2; window.__persist(); });
    await page.reload(); await page.waitForTimeout(200);
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450);
    await page.tap('[data-a="to-barracks"]'); await page.waitForTimeout(100); // v0.4: launch lands on the Campaign screen
    const layout = (sel) => page.evaluate((sel) => {
      const vw = window.innerWidth, vh = window.innerHeight, m = document.getElementById('menu');
      const els = [...document.querySelectorAll(sel)];
      const boxes = els.map((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, aligned: !!hit && (hit === el || el.contains(hit)), h: Math.round(r.height) }; });
      const texts = [...m.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      const minFont = Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize)));
      const smallest = texts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11).slice(0, 3).map((e) => e.className + ':' + e.textContent.trim().slice(0, 20));
      const clipped = [...m.querySelectorAll('.slot-id span, .s-cls, .t-pick span, .m-tab')].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
      return { n: els.length, boxes, minFont, smallest, clipped, scroll: m.scrollHeight > m.clientHeight + 1, hOverflow: document.documentElement.scrollWidth > vw + 1 || m.scrollWidth > m.clientWidth + 1 };
    }, sel);
    const tabCheck = async (tab, sel, n) => {
      const L = await layout(`.m-tab, .m-credits, ${sel}`);
      check(`${dev.name} ${tab}: tabs, credits and ${n} controls on screen + tappable`, L.n === 4 + n && L.boxes.every((b) => b.inside && b.aligned) && L.boxes.slice(4).every((b) => b.h >= 30) && !L.hOverflow && !L.scroll, `min font ${L.minFont}px, scroll ${L.scroll}, out ${L.boxes.filter((b) => !b.inside).length}, misaligned ${L.boxes.filter((b) => !b.aligned).length}`);
      check(`${dev.name} ${tab}: no text under 11px, no clipped labels`, L.minFont >= 11 && L.clipped === 0, `min ${L.minFont}px ${L.smallest.join(' | ')}, clipped ${L.clipped}`);
    };
    // Mission 1 allows 2 soldiers: 2 slots shown
    await tabCheck('Roster', '.s-card .pick, .slot, [data-a="deploy"]', 6 + 2 + 1);
    if (OUT) await page.screenshot({ path: `${OUT}/${dev.name}-landscape-roster.png` });
    await page.tap('[data-tab="training"]'); await page.waitForTimeout(100);
    await tabCheck('Training', '.t-pick, .t-buy, [data-a="deploy"]', 6 + 5 + 1);
    if (OUT) await page.screenshot({ path: `${OUT}/${dev.name}-landscape-training.png` });
    await page.tap('.t-row[data-stat="hp"] .t-buy');
    const bought = await page.evaluate(() => [window.game.roster.get('ace').training.hp, window.__account().credits]);
    check(`${dev.name}: Training purchase by tap`, bought[0] === 1 && bought[1] === 3950, bought.join());
    // rotate to portrait and back while on Training
    await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(400);
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450);
    await tabCheck('Training after rotation', '.t-pick, .t-buy, [data-a="deploy"]', 6 + 5 + 1);
    await page.tap('[data-tab="squad"]'); await page.waitForTimeout(100);
    await tabCheck('Squad Training', '.t-buy, [data-a="deploy"]', 4 + 1);
    if (OUT) await page.screenshot({ path: `${OUT}/${dev.name}-landscape-squad-training.png` });
    await page.tap('[data-tab="roster"]'); await page.waitForTimeout(100);
    await page.tap('.s-card[data-id="ace"] .s-name');
    const D = await layout('.d-card, .d-btns .m-big');
    check(`${dev.name}: details panel fits with level/XP/training`, D.n === 4 && D.boxes.every((b) => b.inside && b.aligned), '');
    await page.tap('.d-btns [data-a="close"]');
    // deploy straight from the Training tab header (quick deploy)
    await page.tap('[data-tab="training"]');
    await page.tap('.m-deploy');
    const dep = await page.evaluate(() => window.game.phase);
    check(`${dev.name}: Deploy straight from the Training tab`, dep === 'playing', dep);
    await page.evaluate(() => { window.game.roster.get('ace').progression.xp = 740; window.game.win(); });
    // (the deployed copy is what was deployed; set the roster XP so the award crosses LV 4 -> 5)
    await page.waitForTimeout(150);
    const R = await layout('#menu .r-card, #menu [data-a="retry"], #menu [data-a="barracks"]');
    const lvl = await page.evaluate(() => document.querySelector('.r-lvl')?.textContent || '');
    check(`${dev.name}: Results with level-up fit landscape, buttons tappable`, R.n === 3 && R.boxes.every((b) => b.inside && b.aligned) && !R.scroll && R.minFont >= 11, `min font ${R.minFont}px, scroll ${R.scroll}, inside ${R.boxes.map((b) => +b.inside)}, aligned ${R.boxes.map((b) => +b.aligned)}`);
    check(`${dev.name}: level-up notice "ACE — LV 4 → LV 5 — +150 XP"`, /ACE — LV 4 → LV 5 — \+150 XP/.test(lvl), lvl);
    if (OUT) await page.screenshot({ path: `${OUT}/${dev.name}-landscape-results-levelup.png` });
    await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(400);
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450);
    const R2 = await layout('#menu .r-card, #menu [data-a="retry"], #menu [data-a="barracks"]');
    const cr = await page.evaluate(() => window.__account().credits);
    check(`${dev.name}: Results after rotation: still fits, no duplicate payout`, R2.boxes.every((b) => b.inside && b.aligned) && cr === 3950 + 1000, `credits ${cr}`);
    await page.tap('[data-a="barracks"]');
    check(`${dev.name}: Return to Barracks`, await page.isVisible('#menu.barracks'));
    check(`${dev.name}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log(fails ? `\n${fails} FAILED` : '\nall progression checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
