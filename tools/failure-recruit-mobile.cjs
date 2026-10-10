// v0.6.1 phone checks (touch emulation, landscape): the mission-failure Results (survivor / KIA
// tally, per-soldier outcomes), the casualty decision after a failure, the one-time NEW RECRUIT
// notice, the Recruitment Office with the CAMPAIGN RECRUITS section above the three random
// candidates, the Refresh confirmation, and full-roster purchase blocking. Checks text size
// (>= 11px), tap targets, no sideways overflow, and that every button can be reached (scrolling the
// menu when the screen is short) and actually works by tapping.
// Devices: iPhone SE, iPhone 14, Pixel 7. Screenshots go to $OUT when set.
// Usage: npx vite preview --port 4173 & OUT=/some/dir node tools/failure-recruit-mobile.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '';
const URL = process.env.URL || 'http://localhost:4173/';
const DEVICES = [
  { name: 'iphoneSE', land: [667, 375], dpr: 2 },
  { name: 'iphone14', land: [844, 390], dpr: 3 },
  { name: 'pixel7', land: [915, 412], dpr: 2.625 },
];
(async () => {
  const browser = await chromium.launch();
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(84)} ${String(detail).slice(0, 220)}`); };
  for (const dev of DEVICES) {
    const [W, H] = dev.land;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(250);
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${dev.name}-${n}.png` }); };
    /** Layout of the given controls: reachable (inside the viewport after scrolling them into view), tappable, big enough. */
    const layout = (sel) => page.evaluate((sel) => {
      const vw = window.innerWidth, vh = window.innerHeight, m = document.getElementById('menu');
      const boxes = [...document.querySelectorAll(sel)].map((el) => {
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, aligned: !!hit && (hit === el || el.contains(hit)), h: Math.round(r.height), w: Math.round(r.width) };
      });
      const texts = [...m.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      const clipped = [...m.querySelectorAll('.nr-row *, .rc-card *, .x-card *, .m-head *, .r-card *')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && !['CANVAS', 'INPUT', 'TABLE', 'TBODY', 'THEAD', 'TR'].includes(e.tagName)).map((e) => e.className + ':' + e.textContent.trim().slice(0, 20));
      m.scrollTop = 0;
      return { n: boxes.length, boxes, minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))), clipped, vscroll: m.scrollHeight > m.clientHeight + 1, hOverflow: document.documentElement.scrollWidth > vw + 1 || m.scrollWidth > m.clientWidth + 1 };
    }, sel);
    const okBoxes = (L, minH = 34) => L.n > 0 && L.boxes.every((b) => b.inside && b.aligned && b.h >= minH);
    const desc = (L) => `n ${L.n} out ${L.boxes.filter((b) => !b.inside).length} misaligned ${L.boxes.filter((b) => !b.aligned).length} min h ${Math.min(...L.boxes.map((b) => b.h))} font ${L.minFont} clipped ${L.clipped.join('|')} vscroll ${L.vscroll}`;

    // ---------- the spec example: Ace standing, Tank KIA, Doc downed with ~12 s left; the captive is lost ----------
    await page.evaluate(() => {
      window.__debugUnlockAll();
      const g = window.game, a = window.__account(); a.credits = 1500;
      g.selectMission('bring-them-home', true);
      g.deploy(['ace', 'tank', 'doc'].map((id) => g.roster.get(id)), 'roster');
      g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.mission.defenders = [{ active: true }]; g.invuln = false; g.input.move = () => ({ x: 0, y: 0 });
      const u = (id) => g.soldiers.find((s) => s.identity.id === id);
      const away = (keep) => () => { g.soldiers.filter((s) => s !== keep).forEach((o, i) => { o.pos = { x: keep.pos.x + 900, y: keep.pos.y + i * 30 }; }); g.anchor = { x: keep.pos.x + 900, y: keep.pos.y }; g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; };
      const tank = u('tank'); g.downSoldier(tank); for (let i = 0; i < 25 * 60 && tank.state !== 'kia'; i++) { away(tank)(); g.update(1 / 60); }
      const doc = u('doc'); g.downSoldier(doc); for (let i = 0; i < 8 * 60; i++) { away(doc)(); g.update(1 / 60); }
      const npc = g.mission.npc; g.downSoldier(npc); g.kia(npc);
    });
    await page.waitForTimeout(200);
    const RL = await layout('#menu [data-a="resolve"]');
    const res = await page.evaluate(() => ({ title: document.querySelector('.r-title').textContent, tally: document.querySelector('.r-tally').textContent, status: [...document.querySelectorAll('.r-status')].map((x) => x.textContent).join(), fallen: document.querySelector('.r-fallen').textContent.replace(/\s+/g, ' ') }));
    check(`${dev.name}: failure Results "MISSION FAILED · 1 Survivor · 2 KIA", per-soldier outcomes`, /MISSION FAILED/.test(res.title) && /1 Survivor · 2 KIA/.test(res.tally) && res.status === 'Standing,KIA,KIA' && /Downed when the mission failed/.test(res.fallen) && /Bled out/.test(res.fallen), `${res.tally} · ${res.status} · ${res.fallen.slice(0, 90)}`);
    check(`${dev.name}: failure Results fit; RESOLVE CASUALTIES reachable + tappable; text >= 11px`, okBoxes(RL, 36) && !RL.hOverflow && RL.minFont >= 11 && RL.clipped.length === 0, desc(RL));
    await shot('failure-results');
    await page.tap('[data-a="resolve"]'); await page.waitForTimeout(300);
    const DL = await layout('[data-a="resurrect"], [data-a="mem-open"], [data-a="manage"]');
    const dec = await page.evaluate(() => ({ menu: document.getElementById('menu').className, txt: document.querySelector('#menu').textContent.replace(/\s+/g, ' ') }));
    check(`${dev.name}: casualty resolution after the failure: Fallen Soldier 1 of 2, buttons reachable + tappable`, dec.menu === 'decisions' && /1 OF 2/i.test(dec.txt) && okBoxes(DL, 36) && !DL.hOverflow && DL.minFont >= 11, desc(DL));
    await shot('failure-casualty-1of2');
    await page.tap('[data-a="resurrect"]'); await page.waitForTimeout(700);
    const dec2 = await page.evaluate(() => ({ txt: document.querySelector('#menu').textContent.replace(/\s+/g, ' '), cause: document.querySelector('.k-cause')?.textContent }));
    check(`${dev.name}: Tank resurrected by tap; Doc next (2 of 2, "Downed when the mission failed")`, /2 OF 2/i.test(dec2.txt) && /Downed when the mission failed/.test(dec2.cause || ''), dec2.cause);
    await shot('failure-casualty-2of2');
    await page.evaluate(() => { const a = window.__account(); a.credits += 2000; window.__economy.resurrect(window.game.roster, a, 'doc', window.__persist); window.game.toCampaign(); });

    // ---------- the one-time NEW RECRUIT notice (fresh campaign, Mission 1 first clear) ----------
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(URL); await page.waitForTimeout(250);
    await page.evaluate(() => { const g = window.game; g.selectMission('first-contact', true); g.deploy(['ace', 'ranger'].map((id) => g.roster.get(id)), 'roster'); g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.win(); });
    await page.waitForTimeout(150);
    await shot('m1-results-recruit-unlocked');
    await page.tap('[data-a="campaign"]'); await page.waitForTimeout(300);
    const NL = await layout('[data-a="rn-later"], [data-a="rn-visit"]');
    const ntxt = await page.evaluate(() => document.querySelector('.rn-notice')?.textContent.replace(/\s+/g, ' ').trim());
    check(`${dev.name}: NEW RECRUIT notice (Tank — Heavy Gunner) fits; Later / Visit tappable`, /NEW RECRUIT AVAILABLE/.test(ntxt || '') && /Heavy Gunners can now be recruited/.test(ntxt || '') && okBoxes(NL, 36) && NL.minFont >= 11 && NL.clipped.length === 0, desc(NL));
    await shot('recruit-notice');
    await page.tap('[data-a="rn-visit"]'); await page.waitForTimeout(500);
    const vis = await page.evaluate(() => ({ menu: document.getElementById('menu').className, tab: document.querySelector('.m-tab.on')?.dataset.tab, row: !!document.querySelector('.nr-row[data-id="tank"]') }));
    check(`${dev.name}: "Visit Recruitment Office" opens the office at the Tank campaign recruit`, vis.menu === 'barracks' && vis.tab === 'recruit' && vis.row, JSON.stringify(vis));

    // ---------- Recruitment Office: Campaign Recruits (Tank + Doc) + the 3 random candidates ----------
    await page.evaluate(() => {
      const g = window.game, a = window.__account();
      g.selectMission('heavy-support', true); g.deploy(['ace', 'ranger'].map((id) => g.roster.get(id)), 'roster'); g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.win();
      a.named.notified.push('doc'); a.credits = 5000; window.__persist(); g.toBarracks();
    });
    await page.tap('[data-a="tab"][data-tab="recruit"]'); await page.waitForTimeout(150);
    const OL = await layout('.nr-row .rc-buy, .rc-card .rc-buy, [data-a="refresh"], .m-tab, [data-a="to-campaign"]');
    const sep = await page.evaluate(() => { const s = document.querySelector('.nr-sec').getBoundingClientRect(), c = document.querySelector('.rc-cards').getBoundingClientRect(); return { rows: document.querySelectorAll('.nr-row').length, cards: document.querySelectorAll('.rc-card').length, above: s.bottom <= c.top, title: document.querySelector('.nr-title').textContent }; });
    check(`${dev.name}: office: CAMPAIGN RECRUITS (Tank, Doc) above the 3 random cards, clearly separated`, sep.rows === 2 && sep.cards === 3 && sep.above && /CAMPAIGN RECRUITS/.test(sep.title), JSON.stringify(sep));
    check(`${dev.name}: office: every Recruit / Refresh / tab button reachable + tappable (>=34px), no clipping, text >= 11px`, OL.n === 2 + 3 + 1 + 4 + 1 && okBoxes(OL) && !OL.hOverflow && OL.clipped.length === 0 && OL.minFont >= 11, desc(OL));
    await shot('office-campaign-recruits');
    await page.evaluate(() => { document.getElementById('menu').scrollTop = 1e6; });
    await shot('office-scrolled');
    await page.evaluate(() => { document.getElementById('menu').scrollTop = 0; });
    // Refresh confirmation (two taps), named offers untouched
    await page.tap('[data-a="refresh"]'); await page.waitForTimeout(150);
    const armed = await page.textContent('[data-a="refresh"]');
    await shot('office-refresh-armed');
    await page.waitForTimeout(400); // a deliberate second tap (repeats inside the 350 ms double-tap guard are ignored by design)
    await page.tap('[data-a="refresh"]'); await page.waitForTimeout(500);
    const rf = await page.evaluate(() => ({ cr: window.__account().credits, rows: [...document.querySelectorAll('.nr-row')].map((r) => r.dataset.id).join() }));
    check(`${dev.name}: Refresh needs "TAP AGAIN" then charges 100; Campaign Recruits unchanged`, /TAP AGAIN/.test(armed) && rf.cr === 4900 && rf.rows === 'tank,doc', `${armed} · ${JSON.stringify(rf)}`);
    // buy Tank by tapping (scrolled into view if needed)
    await page.locator('.nr-row[data-id="tank"] .rc-buy').scrollIntoViewIfNeeded();
    await page.tap('.nr-row[data-id="tank"] .rc-buy'); await page.waitForTimeout(600);
    const bt = await page.evaluate(() => ({ cr: window.__account().credits, owned: window.game.roster.isUnlocked('tank'), rows: [...document.querySelectorAll('.nr-row')].map((r) => r.dataset.id).join() }));
    check(`${dev.name}: tap RECRUIT · 1,000 CR on Tank -> joins, -1,000, row gone (Doc stays)`, bt.owned && bt.cr === 3900 && bt.rows === 'doc', JSON.stringify(bt));
    await shot('office-after-tank');

    // ---------- full roster: purchase blocked, nothing charged ----------
    await page.evaluate(() => {
      const g = window.game, a = window.__account(); a.credits = 100000;
      while (g.roster.activeCount() < 12) { const r = window.__economy.recruit(g.roster, a, a.recruitment.offers[0].id, null); if (!r.ok) break; }
      window.__persist(); g.toBarracks();
    });
    await page.tap('[data-a="tab"][data-tab="roster"]'); await page.tap('[data-a="tab"][data-tab="recruit"]'); await page.waitForTimeout(150);
    const FL = await layout('.nr-row .rc-buy, .rc-full');
    const fb = await page.evaluate(() => { const b = document.querySelector('.nr-row[data-id="doc"] .rc-buy'); return { dis: b.disabled, txt: b.textContent, full: document.querySelector('.rc-full')?.textContent, n: window.game.roster.activeCount(), cr: window.__account().credits }; });
    await page.tap('.nr-row[data-id="doc"] .rc-buy', { force: true }).catch(() => {}); await page.waitForTimeout(400);
    const fb2 = await page.evaluate(() => ({ cr: window.__account().credits, doc: window.game.roster.isUnlocked('doc'), rows: document.querySelectorAll('.nr-row').length }));
    check(`${dev.name}: roster 12/12: Doc's button "ROSTER FULL" (disabled), reason shown, tap charges nothing`, fb.n === 12 && fb.dis && /ROSTER FULL/.test(fb.txt) && /Roster full \(12\/12\)/.test(fb.full) && fb2.cr === fb.cr && !fb2.doc && fb2.rows === 1 && FL.boxes.every((b) => b.inside) && !FL.hOverflow, `${JSON.stringify(fb)} ${JSON.stringify(fb2)}`);
    await shot('office-roster-full');

    check(`${dev.name}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  console.log(`\n${total - fails}/${total} passed${fails ? `, ${fails} FAILED` : ''}`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
