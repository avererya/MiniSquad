// v0.8B end-to-end smoke through the real menus: a save that has just cleared Mission 12 -> Campaign shows Mission 13
// -> briefing -> DEPLOY six -> autopilot wins -> Results -> Campaign shows Mission 14 -> briefing -> DEPLOY -> the
// gunner is picked by tapping a row + CONFIRM -> autopilot escorts the truck -> win -> Mission 15 stays locked.
// Usage: npx vite preview --port 4173 & node tools/chapter3b-e2e.cjs   (LEVEL=12, OUT=/dir for screenshots)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { setup, play } = require('./chapter3b-sim.cjs');
const URL = process.env.URL || 'http://localhost:4173/';
const LEVEL = +(process.env.LEVEL || 12);
const OUT = process.env.OUT || '';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(90)} ${String(detail).slice(0, 300)}`); };
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/e2e-${n}.png` }); };

  // a save at the v0.8A finish line: Missions 1-12 open, Mission 12 cleared, six soldiers at LEVEL
  await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(150);
  const su = await page.evaluate(setup, { level: LEVEL, elite: false });
  await page.evaluate(() => {
    const a = window.__account();
    a.campaign.unlockedMissions = a.campaign.unlockedMissions.filter((x) => x !== 'hold-the-line' && x !== 'supply-line');
    a.missions['artillery-hunt'] = { completions: 1, firstClearRun: 'e2e-m12', bestStars: 2 };
    a.campaign.selectedMission = 'artillery-hunt';
    window.__persist();
  });
  await page.goto(URL); await page.waitForTimeout(200);
  const load = await page.evaluate(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes.length, un: window.__account().campaign.unlockedMissions }));
  check('save with Mission 12 cleared loads (no notes); Mission 13 open, 14 locked', load.notes === 0 && load.un.includes('hold-the-line') && !load.un.includes('supply-line'), JSON.stringify({ st: load.st, notes: load.notes }));

  // one-time notices on the Campaign screen (new class / recruit available): LATER
  const notices = async () => { for (let i = 0; i < 4; i++) { const b = await page.$('[data-a="cn-later"]'); if (!b) break; await b.click(); await page.waitForTimeout(800); } }; // (closing a notice briefly locks taps: no tap-through)
  const runMission = async (id, gunnerRow) => {
    await notices();
    await page.click('[data-a="cchap"][data-ch="3"]');
    if (OUT) await page.screenshot({ path: `${OUT}/e2e-${id}-campaign.png` });
    const row = await page.evaluate((id) => { const r = document.querySelector(`.c-row[data-id="${id}"]`); return r ? r.className : null; }, id);
    // six slots: the six soldiers are the selected squad (picked before the mission row, so the Campaign screen shows them)
    await page.evaluate((ids) => { const g = window.game; g.roster.trimTo(0); for (const x of ids) g.roster.select(x, undefined, 6); window.__persist(); }, su.ids);
    await page.click(`[data-a="csel"][data-id="${id}"]`);
    await page.waitForTimeout(80);
    await page.click('.c-btns [data-a="deploy"]');
    await page.waitForTimeout(100);
    if (!(await page.$('[data-a="brief-deploy"]'))) console.log('no briefing:', await page.evaluate(() => JSON.stringify({ block: window.game.deployBlock(), sel: window.game.roster.count(), cap: window.game.capacity, m: window.game.selectedMission || null, txt: document.querySelector('.c-detail') && document.querySelector('.c-detail').textContent.slice(0, 300) })));
    const brief = await page.evaluate(() => { const b = document.querySelector('.brief'); return b ? b.textContent.replace(/\s+/g, ' ') : ''; });
    await shot(`${id}-briefing`);
    await page.click('[data-a="brief-deploy"]');
    await page.waitForTimeout(100);
    const dep = await page.evaluate(() => ({ phase: window.game.phase, n: window.game.soldiers.length, mission: window.game.mission && window.game.mission.id }));
    let res = await page.evaluate(play, { mission: id, ids: su.ids, caches: ['a', 'b'], gunner: gunnerRow != null ? 'ui' : null, deployed: true });
    let gunnerPick = null;
    if (res.modal) {
      await page.waitForTimeout(100);
      await shot(`${id}-gunner`);
      const rows = await page.$$('#gunsel .gs-row');
      const disabledBefore = await page.$eval('#gunsel [data-g="go"]', (b) => b.disabled);
      await rows[gunnerRow].click();
      gunnerPick = await rows[gunnerRow].evaluate((r) => r.textContent.replace(/\s+/g, ' ').trim());
      await page.click('#gunsel [data-g="go"]');
      await page.waitForTimeout(80);
      const after = await page.evaluate(() => ({ modal: window.game.modal, gunner: window.game.mission.escort.gun.gunner && window.game.mission.escort.gun.gunner.name }));
      gunnerPick = { row: gunnerPick, disabledBefore, ...after };
      res = await page.evaluate(play, { mission: id, ids: su.ids, caches: [], gunner: null, deployed: true });
    }
    await page.waitForTimeout(150);
    await shot(`${id}-results`);
    const out = await page.evaluate(() => ({ phase: window.game.phase, reward: window.game.lastReward && { won: window.game.lastReward.won, unlocked: window.game.lastReward.unlockedMissions.join() } }));
    await page.click('[data-a="campaign"]');
    await page.waitForTimeout(100);
    return { row, brief, dep, res, gunnerPick, out };
  };

  const m13 = await runMission('hold-the-line');
  check('M13: Campaign row available, briefing has the exact story, DEPLOY puts six in', /available|current/.test(m13.row || '') && /The resistance command center is under threat\./.test(m13.brief) && m13.dep.phase === 'playing' && m13.dep.n === 6 && m13.dep.mission === 'hold-the-line', JSON.stringify({ row: m13.row, dep: m13.dep }));
  check('M13: won through the four waves, unlocks Mission 14', m13.res.phase === 'won' && m13.out.reward && m13.out.reward.won && m13.out.reward.unlocked === 'supply-line', JSON.stringify({ t: m13.res.time, cc: m13.res.cc, stars: m13.res.stars, reward: m13.out.reward }));
  const m14 = await runMission('supply-line', 2);
  check('M14: Campaign row available, briefing has the exact story, DEPLOY puts six in', /available|current/.test(m14.row || '') && /The resistance needs supplies\./.test(m14.brief) && m14.dep.phase === 'playing' && m14.dep.n === 6, JSON.stringify({ row: m14.row, dep: m14.dep }));
  check('M14: gunner chosen by tapping a row + CONFIRM (disabled until picked)', m14.gunnerPick && m14.gunnerPick.disabledBefore && m14.gunnerPick.modal === null && !!m14.gunnerPick.gunner && m14.gunnerPick.row.startsWith(m14.gunnerPick.gunner), JSON.stringify(m14.gunnerPick));
  check('M14: escort won (truck arrived), nothing unlocked (Mission 15 not built)', m14.res.phase === 'won' && m14.out.reward && m14.out.reward.won && m14.out.reward.unlocked === '', JSON.stringify({ t: m14.res.time, truck: m14.res.truck, gun: m14.res.gun, reward: m14.out.reward }));
  await notices(); await page.click('[data-a="cchap"][data-ch="3"]');
  const fin = await page.evaluate(() => { const rows = [...document.querySelectorAll('.c-row')].map((r) => r.dataset.id + ':' + r.className.replace('c-row', '').trim()); return { rows, saved: JSON.parse(localStorage.getItem(window.__SAVE_KEY)).version }; });
  check('Campaign after M14: Missions 13 / 14 completed, Mission 15 "coming soon" (not playable); save still v9', fin.saved === 9 && fin.rows.some((r) => /^hold-the-line:.*completed/.test(r)) && fin.rows.some((r) => /^supply-line:.*completed/.test(r)) && fin.rows.some((r) => /^mission-15:.*soon/.test(r)), fin.rows.join(' '));
  check('no page errors', errors.length === 0, errors[0] || '');
  console.log(fails ? `${fails} FAILED` : 'all Chapter 3B e2e checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
