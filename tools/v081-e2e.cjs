// v0.8B.1 END-TO-END through the real menus, from a save written by an unchanged v0.8B build (Mission 12 cleared,
// Mission 13 open; tools/fixtures-v08b/v0.8B-m12-cleared.json):
//   load (no repair notes, every soldier Ability Capacity rank 0) -> Barracks: buy Ability Capacity for the Medic
//   through the Training row -> Campaign -> Mission 13 briefing -> DEPLOY six -> caches, four overlapping waves,
//   helicopter (autopilot) -> Mission 14 -> depots, capture, gunner by tapping a row + CONFIRM, five ambushes on the
//   long road, truck extraction (autopilot) -> Mission 15 still "coming soon" -> reload: progress and the purchase kept.
// Failure paths through the same menus: Mission 13 command center destroyed; Mission 14 truck destroyed (aftermath),
// each followed by Retry with full charges.
// Usage: npx vite preview --port 4173 & node tools/v081-e2e.cjs   (OUT=/dir for screenshots)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const { play } = require('./v081-sim.cjs');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';
const SAVE = fs.readFileSync(path.join(__dirname, 'fixtures-v08b', 'v0.8B-m12-cleared.json'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(96)} ${String(detail).slice(0, 300)}`); };
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/v081-e2e-${n}.png` }); };
  const IDS = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'];
  // one-time notices (new class / recruit available): LATER (closing one briefly locks taps: no tap-through)
  const notices = async () => { for (let i = 0; i < 4; i++) { const b = await page.$('[data-a="cn-later"]'); if (!b) break; await b.click(); await page.waitForTimeout(800); } };

  await page.goto(URL); await page.evaluate((r) => { localStorage.clear(); localStorage.setItem('minisquad.save', r); }, SAVE); await page.goto(URL); await page.waitForTimeout(200);
  const load = await page.evaluate(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes, un: window.__account().campaign.unlockedMissions, ranks: window.game.roster.owned().map((s) => window.__progression.capacityRank(s)).join(''), cr: window.__account().credits, lv: window.game.roster.owned().map((s) => s.progression.level).join(), tr: JSON.stringify(window.game.roster.get('ace').training) }));
  check('1 the v0.8B save loads without repair notes: M13 open, M14 locked, everybody Ability Capacity 0, training kept', load.notes.length === 0 && load.un.includes('hold-the-line') && !load.un.includes('supply-line') && /^0+$/.test(load.ranks) && load.cr === 9500 && load.tr === '{"accuracy":4,"damage":4,"hp":4,"fireRate":3,"moveSpeed":2}', JSON.stringify({ st: load.st, notes: load.notes, ranks: load.ranks, lv: load.lv }));

  // ---- Barracks: buy Ability Capacity rank 1 for the Medic (Doc) through the Training row ----
  await page.evaluate(() => { const g = window.game; g.toBarracks(); g.ui.menus.trainId = 'doc'; g.ui.menus.tab = 'training'; g.ui.menus.showBarracks(); });
  await page.waitForTimeout(80);
  await notices();
  await page.evaluate(() => { const g = window.game; g.ui.menus.trainId = 'doc'; g.ui.menus.tab = 'training'; g.ui.menus.showBarracks(); });
  await shot('training');
  await page.click('.t-row.t-cap .t-buy');
  await page.waitForTimeout(80);
  const conf = await page.$('[data-a="confirm-buy"], .m-modal [data-a="yes"]'); if (conf) { await conf.click(); await page.waitForTimeout(80); }
  const bought = await page.evaluate(() => ({ rank: window.__progression.capacityRank(window.game.roster.get('doc')), cr: window.__account().credits, row: document.querySelector('.t-row.t-cap').textContent.replace(/\s+/g, ' '), saved: JSON.parse(localStorage.getItem('minisquad.save')).version }));
  check('2 Ability Capacity rank 1 bought for Doc through the Training row (-1,500 CR, saved as v9)', bought.rank === 1 && bought.cr === 8000 && bought.saved === 9 && /2 uses/.test(bought.row), JSON.stringify({ rank: bought.rank, cr: bought.cr }));
  await page.evaluate(() => window.game.toCampaign());
  await page.waitForTimeout(100);

  /** Campaign -> mission row -> DEPLOY -> briefing -> DEPLOY: six in. */
  const deployVia = async (id) => {
    await notices();
    await page.click('[data-a="cchap"][data-ch="3"]');
    await page.evaluate((ids) => { const g = window.game; g.roster.trimTo(0); for (const x of ids) g.roster.select(x, undefined, 6); window.__persist(); }, IDS);
    await page.click(`[data-a="csel"][data-id="${id}"]`);
    await page.waitForTimeout(80);
    await page.click('.c-btns [data-a="deploy"]');
    await page.waitForTimeout(100);
    const brief = await page.evaluate(() => { const b = document.querySelector('.brief'); return b ? b.textContent.replace(/\s+/g, ' ') : ''; });
    await page.click('[data-a="brief-deploy"]');
    await page.waitForTimeout(100);
    return { brief, dep: await page.evaluate(() => ({ phase: window.game.phase, n: window.game.soldiers.length, mission: window.game.mission && window.game.mission.id, charges: window.game.soldiers.map((s) => `${s.ability.charges}/${s.ability.capacity}`).join() })) };
  };
  const results = async () => { await page.waitForTimeout(150); return page.evaluate(() => ({ phase: window.game.phase, reward: window.game.lastReward && { won: window.game.lastReward.won, unlocked: window.game.lastReward.unlockedMissions.join(), credits: window.game.lastReward.credits } })); };

  // ---- failure path first: Mission 13, the command center destroyed; Retry starts with full charges ----
  {
    const d = await deployVia('hold-the-line');
    await page.evaluate(() => { const g = window.game; g.useAbility(g.soldiers.find((s) => s.identity.classId === 'heavy')); g.damage(g.mission.protected, 1e6); for (let i = 0; i < 30; i++) g.update(1 / 60); });
    const r = await results();
    await shot('m13-failed');
    const retry = await page.evaluate(() => { window.game.reset(); return { phase: window.game.phase, charges: window.game.soldiers.map((s) => `${s.ability.charges}/${s.ability.capacity}`).join() }; });
    check('3 M13 failure: command center destroyed -> failed, no reward, M14 still locked; Retry: full charges', d.dep.n === 6 && r.phase === 'failed' && r.reward && !r.reward.won && !r.reward.credits && !r.reward.unlocked && retry.phase === 'playing' && retry.charges === d.dep.charges, JSON.stringify({ r, retry: retry.charges }));
    await page.evaluate(() => window.game.toCampaign());
    await page.waitForTimeout(100);
  }

  // ---- Mission 13 ----
  const m13 = await deployVia('hold-the-line');
  check('4 M13 briefing (exact story), DEPLOY six; Doc deploys with 2/2, the rest 1/1', /The resistance command center is under threat\./.test(m13.brief) && m13.dep.phase === 'playing' && m13.dep.n === 6 && m13.dep.charges === '1/1,1/1,1/1,2/2,1/1,1/1', JSON.stringify(m13.dep));
  const r13 = await page.evaluate(play, { mission: 'hold-the-line', ids: IDS, caches: ['a', 'b'], gunner: null, deployed: true, policy: 'aggressive' });
  await shot('m13-results');
  const o13 = await results();
  check('5 M13 cache preparation: both caches secured, turrets built', r13.turrets && r13.turrets.secured === 'a,b' && r13.turrets.responses === 7, JSON.stringify(r13.turrets));
  check('6 M13 four overlapping waves (60 attackers), each started once', r13.waves && r13.waves.starts && r13.waves.starts.length === 4 && r13.waves.maxOverlap >= 2 && (r13.spawned.wave || 0) === 60, JSON.stringify({ w: r13.waves, sp: r13.spawned }));
  check('7 M13 won by helicopter extraction, unlocks Mission 14', o13.phase === 'won' && o13.reward && o13.reward.won && o13.reward.unlocked === 'supply-line', JSON.stringify({ t: r13.time, cc: r13.cc, reward: o13.reward, charges: r13.charges }));
  await page.click('[data-a="campaign"]');
  await page.waitForTimeout(100);

  // ---- failure path: Mission 14, the truck destroyed (wreck aftermath, then failed) ----
  {
    await deployVia('supply-line');
    const f = await page.evaluate(() => {
      const g = window.game, m = g.mission;
      m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; m.escort.capture(); m.primaries[2].activate(m, g); m.phase = 'escort';
      g.modal = 'gunner'; g.chooseGunner(g.soldiers.find((s) => s.identity.classId === 'heavy').id);
      g.damage(m.escort.unit, 1e6);
      const aft = !!m.aftermath;
      for (let i = 0; i < 60 * 45 && g.phase === 'playing'; i++) g.update(1 / 60);
      return { aft, phase: g.phase, why: m.failReason };
    });
    const r = await results();
    check('8 M14 failure: truck destroyed -> wreck aftermath -> failed, no reward', f.aft && f.phase === 'failed' && /truck/i.test(f.why) && r.reward && !r.reward.won && !r.reward.credits, JSON.stringify({ f, r }));
    // casualties of a failure: resolve them (resurrect) so the six can deploy again
    await page.evaluate(() => { const a = window.__account(); let d; while ((d = a.pendingDecision) && d.queue.length) { const s = window.game.roster.get(d.queue[0].id); a.credits += window.__casualties.costFor(s); window.__economy.resurrect(window.game.roster, a, s.id, window.__persist); } window.game.toCampaign(); });
    await page.waitForTimeout(100);
  }

  // ---- Mission 14 ----
  const m14 = await deployVia('supply-line');
  check('9 M14 briefing (exact story), DEPLOY six with full charges', /The resistance needs supplies\./.test(m14.brief) && m14.dep.phase === 'playing' && m14.dep.n === 6 && m14.dep.charges === '1/1,1/1,1/1,2/2,1/1,1/1', JSON.stringify(m14.dep));
  let r14 = await page.evaluate(play, { mission: 'supply-line', ids: IDS, caches: [], gunner: 'ui', deployed: true });
  let gunnerPick = null;
  if (r14.modal) {
    await page.waitForTimeout(100);
    await shot('m14-gunner');
    const rows = await page.$$('#gunsel .gs-row');
    const disabledBefore = await page.$eval('#gunsel [data-g="go"]', (b) => b.disabled);
    const pick = await page.evaluate(() => [...document.querySelectorAll('#gunsel .gs-row')].findIndex((r) => /Heavy|HVY/i.test(r.textContent)));
    await rows[Math.max(0, pick)].click();
    await page.click('#gunsel [data-g="go"]');
    await page.waitForTimeout(80);
    gunnerPick = { disabledBefore, ...(await page.evaluate(() => ({ modal: window.game.modal, gunner: window.game.mission.escort.gun.gunner && window.game.mission.escort.gun.gunner.name, depots: window.game.mission.primaries[0].state, captured: window.game.mission.primaries[1].state }))) };
    r14 = await page.evaluate(play, { mission: 'supply-line', ids: IDS, caches: [], gunner: null, deployed: true });
  }
  await shot('m14-results');
  const o14 = await results();
  check('10 M14 depots destroyed and truck captured, gunner chosen by tapping a row + CONFIRM', gunnerPick && gunnerPick.disabledBefore && gunnerPick.modal === null && !!gunnerPick.gunner && gunnerPick.depots === 'complete' && gunnerPick.captured === 'complete', JSON.stringify(gunnerPick));
  check('11 M14 the long road: all five ambushes fired (54 ambushers), the truck reached the new end', r14.ambush && r14.ambush.fired === 5 && r14.ambush.spawned === 54 && r14.truck && r14.truck.s >= 5860 && r14.truck.state === 'arrived', JSON.stringify({ amb: r14.ambush, truck: r14.truck, truckAt: r14.truckAt }));
  check('12 M14 won by extraction at the road end; nothing unlocked (Mission 15 not built)', o14.phase === 'won' && o14.reward && o14.reward.won && o14.reward.unlocked === '', JSON.stringify({ t: r14.time, phases: r14.phases, reward: o14.reward }));
  await page.click('[data-a="campaign"]');
  await page.waitForTimeout(100);
  await notices(); await page.click('[data-a="cchap"][data-ch="3"]');
  const fin = await page.evaluate(() => [...document.querySelectorAll('.c-row')].map((r) => r.dataset.id + ':' + r.className.replace('c-row', '').trim()));
  check('13 Campaign: Missions 13 / 14 completed, Mission 15 "coming soon" and not playable', fin.some((r) => /^hold-the-line:.*completed/.test(r)) && fin.some((r) => /^supply-line:.*completed/.test(r)) && fin.some((r) => /^mission-15:.*soon/.test(r)) && !(await page.evaluate(() => !!window.game.selectMission('mission-15'))), fin.filter((r) => /hold|supply|mission-15/.test(r)).join(' '));
  // ---- reload: progress and the purchase survive ----
  await page.reload(); await page.waitForTimeout(250);
  const re = await page.evaluate(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes.length, v: JSON.parse(localStorage.getItem('minisquad.save')).version, doc: window.__progression.capacityRank(window.game.roster.get('doc')), m: ['hold-the-line', 'supply-line'].map((id) => (window.__account().missions[id] || {}).completions || 0).join(), un: window.__account().campaign.unlockedMissions.includes('supply-line') }));
  check('14 reload: save v9, no notes, M13 / M14 cleared, M14 unlocked, Doc keeps Ability Capacity rank 1', re.v === 9 && re.notes === 0 && re.doc === 1 && re.m === '1,1' && re.un, JSON.stringify(re));
  check('15 no page errors', errors.length === 0, errors[0] || '');
  console.log(fails ? `${fails} FAILED` : 'all v0.8B.1 e2e checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
