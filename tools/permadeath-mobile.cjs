// v0.6 permanent death on phones (touch emulation, landscape + rotation): HUD downed timers and
// revive progress, the non-pausing extraction warning (inside the viewport, big enough, clear of
// the joystick zone and the ability buttons; joystick + abilities keep working while it shows),
// the casualty screens (multi-casualty navigation, Memorial confirmation that is disabled at
// first, restricted roster), the Memorial grid, the career record and Operation Phoenix.
// Screenshots go to OUT (default /mnt/project-files/minisquad/v0.6).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT ?? '/mnt/project-files/minisquad/v0.6';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const DEVICES = [
  { name: 'iphoneSE', land: [667, 375], dpr: 2 },
  { name: 'iphone14', land: [844, 390], dpr: 3 },
  { name: 'pixel7', land: [915, 412], dpr: 2.625 },
];

(async () => {
  const browser = await chromium.launch();
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); };
  for (const dev of DEVICES) {
    const [W, H] = dev.land;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(250);
    await page.evaluate(() => window.__debugUnlockAll());
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/pd-${dev.name}-${n}.png` }); };
    const rotate = async () => { await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(450); await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450); };
    const layout = (sel) => page.evaluate((sel) => {
      const vw = window.innerWidth, vh = window.innerHeight, m = document.getElementById('menu');
      const boxes = [...document.querySelectorAll(sel)].map((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { sel: el.dataset.a || el.className, inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, aligned: !!hit && (hit === el || el.contains(hit)), h: Math.round(r.height), w: Math.round(r.width) };
      });
      const texts = [...m.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      const clipped = [...m.querySelectorAll('.k-card *, .k-btns *, .k-row *, .k-bar *, .m-head *, .mm-card *, .px-card *, .px-text *, .d-card *')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.tagName !== 'CANVAS').map((e) => e.className + ':' + e.textContent.trim().slice(0, 24));
      const headOut = [...m.querySelectorAll('.m-head > *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > vw + 0.5).map((e) => e.className);
      return { n: boxes.length, boxes, minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))), clipped, headOut, vscroll: m.scrollHeight > m.clientHeight + 1, hOverflow: document.documentElement.scrollWidth > vw + 1 || m.scrollWidth > m.clientWidth + 1, text: m.textContent.replace(/\s+/g, ' ') };
    }, sel);
    const okBoxes = (L, minH = 34) => L.n > 0 && L.boxes.every((b) => b.inside && b.aligned && b.h >= minH);
    const fit = (L) => L.clipped.length === 0 && L.headOut.length === 0 && L.minFont >= 11 && !L.hOverflow;
    const desc = (L) => `n ${L.n} ${JSON.stringify(L.boxes.map((b) => `${b.sel}:${b.w}x${b.h}${b.inside ? '' : ' OUT'}${b.aligned ? '' : ' HIDDEN'}`))} clipped ${L.clipped.join('|')} head ${L.headOut.join('|')} font ${L.minFont} vscroll ${L.vscroll} hOver ${L.hOverflow}`;

    // ---------- HUD: downed timer + revive progress ----------
    await page.evaluate(() => {
      const g = window.game; g.selectMission('field-medicine', true);
      g.deploy(['ace', 'tank', 'doc'].map((id) => g.roster.get(id)), 'roster');
      g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.mission.defenders = [{ active: true }];
      const ace = g.soldiers[0]; g.downSoldier(ace);
      g.paused = true;
      for (const s of g.soldiers.slice(1)) s.pos = { x: ace.pos.x + 600, y: ace.pos.y };
      g.anchor = { x: ace.pos.x + 600, y: ace.pos.y };
      ace.bleed = 13.2; // mid bleed-out
    });
    await page.waitForTimeout(120);
    const hud = () => page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const p = document.querySelector('.panel.downed');
      if (!p) return null;
      const r = p.getBoundingClientRect(), st = p.querySelector('.state, .p-state, .st') || p;
      const clipped = [...p.querySelectorAll('*')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.tagName !== 'CANVAS').map((e) => e.className);
      return { text: p.textContent.replace(/\s+/g, ' ').trim(), cls: p.className, inside: r.left >= 0 && r.top >= 0 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, clipped, minFont: Math.min(...[...p.querySelectorAll('*')].filter((e) => e.offsetParent && e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))) };
    });
    const h1 = await hud();
    check(`${dev.name}: HUD shows the downed soldier's bleed-out countdown (no new popup)`, h1 && /(DOWN|CRITICAL)\D*14s/.test(h1.text) && h1.inside && h1.clipped.length === 0, JSON.stringify(h1));
    await shot('hud-downed');
    await page.evaluate(() => { const g = window.game, ace = g.soldiers[0], doc = g.soldiers[2]; doc.pos = { ...ace.pos }; g.paused = false; for (let i = 0; i < 90; i++) { doc.pos = { ...ace.pos }; g.update(1 / 60); } g.paused = true; });
    await page.waitForTimeout(120);
    const h2 = await hud();
    check(`${dev.name}: HUD shows revive progress with a clear paused-timer mark (⏸)`, h2 && /REV\w*\s*\d+%/.test(h2.text) && /⏸/.test(h2.text) && /reviving/.test(h2.cls) && h2.inside && h2.clipped.length === 0, JSON.stringify(h2));
    await shot('hud-reviving');
    await rotate();
    const h3 = await hud();
    check(`${dev.name}: after rotation the downed panel still fits`, h3 && h3.inside && h3.clipped.length === 0, JSON.stringify(h3));

    // ---------- extraction warning ----------
    await page.evaluate(() => {
      const g = window.game; g.mission.debugReadyExtraction(g);
      const z = g.mission.extraction.zone, inZ = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      const [ace, tank, doc] = g.soldiers;
      ace.reviveProgress = 0; ace.pos = { x: z.x - 900, y: z.y + 200 }; ace.bleed = 12.4;
      tank.pos = { ...inZ }; doc.pos = { x: inZ.x + 20, y: inZ.y }; g.anchor = { ...inZ };
      window.__aceSpot = { ...ace.pos };
      g.paused = false;
      for (let i = 0; i < 45; i++) { ace.pos = { ...window.__aceSpot }; tank.pos = { ...inZ }; doc.pos = { x: inZ.x + 20, y: inZ.y }; g.update(1 / 60); }
      window.__hud.update();
      g.paused = true;
    });
    await page.waitForTimeout(150);
    const xw = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const box = document.getElementById('xwarn'), cv = document.getElementById('game').getBoundingClientRect();
      const joyRight = cv.left + cv.width * 0.45;
      const abil = [...document.querySelectorAll('.panel .ability, .panel')].map((e) => e.getBoundingClientRect());
      const btns = [...box.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { t: b.textContent, w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= 0 && r.top >= 0 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, aligned: hit === b, clearJoy: r.left >= joyRight, clearAbil: abil.every((a) => r.right <= a.left || a.right <= r.left || r.bottom <= a.top || a.bottom <= r.top), clipped: b.scrollWidth > b.clientWidth + 1 };
      });
      const br = box.getBoundingClientRect();
      return { shown: box.style.display !== 'none', title: box.querySelector('.xw-title').textContent, body: box.querySelector('.xw-body').textContent, btns, boxInside: br.left >= 0 && br.right <= vw + 0.5 && br.top >= 0 && br.bottom <= vh + 0.5, joyRight: Math.round(joyRight), pe: getComputedStyle(box).pointerEvents };
    });
    check(`${dev.name}: extraction warning shown: "SOLDIER LEFT BEHIND!" + live countdown`, xw.shown && xw.title === 'SOLDIER LEFT BEHIND!' && /Ace is downed — \d+ seconds remaining/.test(xw.body) && /mark Ace as KIA/.test(xw.body), `${xw.title} | ${xw.body}`);
    check(`${dev.name}: warning buttons inside the viewport, >= 34 px tall, tappable, text not clipped`, xw.boxInside && xw.btns.length === 2 && xw.btns.every((b) => b.inside && b.aligned && b.h >= 34 && !b.clipped), JSON.stringify(xw.btns));
    check(`${dev.name}: warning buttons clear of the joystick zone (left 45%) and every ability panel`, xw.btns.every((b) => b.clearJoy && b.clearAbil) && xw.pe === 'none', `joyRight ${xw.joyRight} ${JSON.stringify(xw.btns.map((b) => [b.clearJoy, b.clearAbil]))}`);
    await shot('extraction-warning');
    // the game keeps running while the warning shows: joystick + ability still work
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p[0], y: p[1], id: p[2] })) });
    const s0 = await page.evaluate(() => { const g = window.game; g.paused = false; g.invuln = true; const ace = g.soldiers[0]; const keep = () => { ace.pos = { ...window.__aceSpot }; }; const orig = g.update.bind(g); window.__restore = () => { g.update = orig; }; g.update = (dt) => { keep(); orig(dt); }; return { a: { ...g.anchor }, bleed: ace.bleed, t: g.time }; });
    await touch('touchStart', [[W * 0.15, H * 0.6, 1]]);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[W * 0.15 - i * 5, H * 0.6, 1]]); await page.waitForTimeout(16); }
    await page.waitForTimeout(600);
    await touch('touchEnd', []);
    await page.evaluate(() => { const d = window.game.soldiers[2]; window.game.soldiers.forEach((s) => { if (s.active) s.hp = s.maxHp * 0.5; }); });
    await page.tap('.panel:nth-child(3) .ability');
    const s1 = await page.evaluate(() => { const g = window.game; return { a: { ...g.anchor }, bleed: g.soldiers[0].bleed, t: g.time, cd: g.soldiers[2].ability.cooldownLeft, warn: g.mission.attempt }; });
    check(`${dev.name}: while the warning shows, the joystick moves the squad and the bleed-out keeps running`, Math.abs(s1.a.x - s0.a.x) > 20 && s1.bleed < s0.bleed - 0.3 && s1.t > s0.t + 0.3, `anchor dx ${Math.round(s1.a.x - s0.a.x)} bleed ${s0.bleed.toFixed(1)}->${s1.bleed.toFixed(1)}`);
    check(`${dev.name}: while the warning shows, an ability button still works (Field Treatment)`, s1.cd > 20, `cd ${s1.cd}`);
    // back in the zone, warning again, then tap STAY AND RESCUE
    await page.evaluate(() => { const g = window.game, z = g.mission.extraction.zone, inZ = { x: z.x + z.w / 2, y: z.y + z.h / 2 }; g.paused = false; g.anchor = { ...inZ }; g.soldiers[1].pos = { ...inZ }; g.soldiers[2].pos = { x: inZ.x + 20, y: inZ.y }; for (let i = 0; i < 100; i++) { g.soldiers[1].pos = { ...inZ }; g.soldiers[2].pos = { x: inZ.x + 20, y: inZ.y }; g.update(1 / 60); } g.paused = true; window.__hud.update(); });
    await page.waitForTimeout(100);
    const shownAgain = await page.evaluate(() => document.getElementById('xwarn').style.display !== 'none' && window.game.mission.attempt === 'warning');
    await page.tap('#xwarn [data-x="stay"]');
    await page.waitForTimeout(80);
    const st = await page.evaluate(() => ({ attempt: window.game.mission.attempt, shown: document.getElementById('xwarn').style.display !== 'none', ace: window.game.soldiers[0].state }));
    check(`${dev.name}: tapping STAY AND RESCUE closes the warning at once (no re-appearance), soldier still downed`, shownAgain && st.attempt === 'stayed' && !st.shown && st.ace === 'downed', JSON.stringify({ shownAgain, ...st }));
    await page.evaluate(() => window.__restore());

    // ---------- casualty screens ----------
    await page.evaluate(() => {
      const g = window.game, a = window.__account();
      const [ace, tank, doc] = g.soldiers;
      g.paused = false;
      // tank goes down far from everyone: both bleed out with Doc kept away
      tank.pos = { x: ace.pos.x + 60, y: ace.pos.y + 300 }; const tp = { ...tank.pos };
      g.downSoldier(tank);
      const far = { x: ace.pos.x + 1200, y: ace.pos.y }; g.anchor = { ...far };
      for (let i = 0; i < 60 * 22 && (ace.state === 'downed' || tank.state === 'downed'); i++) { doc.pos = { ...far }; ace.pos = { ...window.__aceSpot }; tank.pos = { ...tp }; g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.update(1 / 60); }
      g.fail();
      a.credits = 1200; window.__persist();
      g.toCampaign();
    });
    await page.waitForTimeout(150);
    let L = await layout('.k-btns .m-big');
    check(`${dev.name}: casualty screen "FALLEN SOLDIER 1 OF 2": portrait, class, level, trait, cost, credits, 3 actions fit`, /FALLEN SOLDIER 1 OF 2/.test(L.text) && /Ace/.test(L.text) && /Infantry/.test(L.text) && /LV \d/.test(L.text) && /Sharpshooter/.test(L.text) && /Resurrected before/.test(L.text) && /1,?000 CR/.test(L.text) && L.n === 3 && okBoxes(L, 40) && fit(L) && !L.vscroll, desc(L));
    await shot('fallen-1of2');
    await rotate();
    L = await layout('.k-btns .m-big');
    check(`${dev.name}: casualty screen survives rotation (same soldier, layout fits)`, /FALLEN SOLDIER 1 OF 2/.test(L.text) && okBoxes(L, 40) && fit(L) && !L.vscroll, desc(L));
    // Memorial confirmation: disabled at first; an instant tap does nothing
    await page.tap('[data-a="mem-open"]');
    await page.waitForTimeout(30);
    L = await layout('.k-btns .m-big');
    const dis = await page.evaluate(() => document.querySelector('[data-a="mem-confirm"]').disabled);
    await page.tap('[data-a="mem-confirm"]', { force: true }).catch(() => {});
    const aceStill = await page.evaluate(() => window.game.roster.get('ace')?.status);
    check(`${dev.name}: Memorial confirmation: permanent-loss text, confirm DISABLED at first, rapid tap ignored`, dis && aceStill === 'kia' && /This decision is permanent\. This soldier cannot be resurrected later\./.test(L.text) && L.n === 2 && L.boxes.every((b) => b.inside && b.h >= 40) && fit(L), desc(L));
    await shot('memorial-confirm');
    await page.tap('[data-a="mem-back"]'); await page.waitForTimeout(650);
    // restricted roster
    await page.tap('[data-a="manage"]'); await page.waitForTimeout(120);
    L = await layout('.k-row [data-a="dismiss"], [data-a="manage-back"]');
    check(`${dev.name}: restricted roster: back + dismiss buttons tappable, fallen marked, no clipping`, /MANAGE ROSTER/.test(L.text) && /FALLEN/.test(L.text) && /DISMISS · \+/.test(L.text) && L.boxes.every((b) => b.inside && b.h >= 30) && fit(L), desc(L));
    await shot('restricted-roster');
    await page.tap('[data-a="manage-back"]'); await page.waitForTimeout(650);
    // resurrect Ace -> 2 of 2 (Tank)
    await page.tap('[data-a="resurrect"]'); await page.waitForTimeout(650);
    L = await layout('.k-btns .m-big');
    check(`${dev.name}: after Resurrect the next casualty is shown ("FALLEN SOLDIER 2 OF 2", Tank, shortfall shown)`, /FALLEN SOLDIER 2 OF 2/.test(L.text) && /Tank/.test(L.text) && /Shortfall/.test(L.text) && okBoxes(L.n ? { ...L, boxes: L.boxes.filter((b) => b.sel !== 'resurrect') } : L, 40) && fit(L), desc(L));
    await shot('fallen-2of2-short');
    await page.tap('[data-a="mem-open"]'); await page.waitForTimeout(1650);
    await page.evaluate(() => window.__hud.menus.rerender?.());
    await page.tap('[data-a="mem-confirm"]'); await page.waitForTimeout(700); // menus ignore taps for 600 ms after a decision
    const after = await page.evaluate(() => ({ screen: document.getElementById('menu').className, mem: window.__account().memorial.length, pend: !!window.__account().pendingDecision }));
    check(`${dev.name}: Memorial confirmed after the arm delay -> flow closes`, after.mem === 1 && !after.pend && /campaign/.test(after.screen), JSON.stringify(after));
    // Memorial grid
    await page.tap('[data-a="memorial"]'); await page.waitForTimeout(150);
    L = await layout('[data-a="memorial-back"]');
    const grid = await page.evaluate(() => { const c = document.querySelector('.mm-card'); const r = c?.getBoundingClientRect(); return c ? { text: c.textContent.replace(/\s+/g, ' ').trim(), gray: !!c.querySelector('canvas.gray'), inside: r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5 } : null; });
    check(`${dev.name}: Memorial grid: grayscale portrait, name, level, kills, resurrections; back button tappable`, grid && grid.gray && grid.inside && /Tank/.test(grid.text) && /LV \d/.test(grid.text) && /kills/.test(grid.text) && okBoxes(L, 30) && fit(L), `${JSON.stringify(grid)} ${desc(L)}`);
    await shot('memorial-grid');
    await page.tap('[data-a="memorial-back"]'); await page.waitForTimeout(150);
    // career record in the Barracks details
    await page.evaluate(() => window.__hud.showStart());
    await page.waitForTimeout(100);
    await page.tap('.s-card[data-id="ace"]'); await page.waitForTimeout(150);
    L = await layout('.d-card .d-btns button, .d-card [data-a]');
    const car = await page.evaluate(() => { const c = document.querySelector('.d-career'); if (!c) return null; const r = c.getBoundingClientRect(); const cut = [...c.querySelectorAll('*')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').length; return { text: c.textContent.replace(/\s+/g, ' ').trim(), inside: r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5, cut, oneLine: r.height < 40 }; });
    check(`${dev.name}: career record (6 stats) fits in the details panel, compact`, car && car.inside && car.cut === 0 && car.oneLine && /1/.test(car.text) && L.boxes.every((b) => b.inside), `${JSON.stringify(car)} ${desc(L)}`);
    await shot('career-record');

    // ---------- Operation Phoenix ----------
    await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(200);
    await page.evaluate(() => {
      const g = window.game, a = window.__account(), E = window.__economy;
      E.settleMission(g.roster, a, { missionId: 'first-contact', runId: 'px-mobile', won: false, deployed: [{ id: 'ace', status: 'KIA' }, { id: 'ranger', status: 'KIA' }], optional: { total: 0, completed: 0, list: [] }, stars: 0 }, {});
      E.memorialize(g.roster, a, 'ace', window.__persist); E.memorialize(g.roster, a, 'ranger', window.__persist);
    });
    await page.reload(); await page.waitForTimeout(250);
    L = await layout('.px-card, [data-a="px-enlist"]');
    check(`${dev.name}: Operation Phoenix screen: 6 candidates + Enlist, all tappable, text fits`, /OPERATION PHOENIX/.test(L.text) && /Rebuild\. Regroup\. Fight back\./.test(L.text) && L.n === 7 && L.boxes.every((b) => b.inside && b.aligned && b.h >= 34) && fit(L), desc(L));
    await shot('phoenix');
    for (const i of [0, 1, 2]) { await page.locator('[data-a="px-pick"]').nth(i).tap(); await page.waitForTimeout(40); }
    const pk = await page.evaluate(() => ({ on: document.querySelectorAll('.px-card.on').length, en: !document.querySelector('[data-a="px-enlist"]').disabled }));
    await shot('phoenix-picked');
    await rotate();
    L = await layout('.px-card, [data-a="px-enlist"]');
    check(`${dev.name}: Phoenix picks by tap (3 selected, Enlist enabled); layout fits after rotation`, pk.on === 3 && pk.en && L.boxes.every((b) => b.inside && b.aligned) && fit(L), `${JSON.stringify(pk)} ${desc(L)}`);
    await page.waitForTimeout(650);
    await page.tap('[data-a="px-enlist"]'); await page.waitForTimeout(200);
    const px = await page.evaluate(() => ({ screen: document.getElementById('menu').className, n: window.game.roster.owned().filter((s) => s.origin === 'phoenix').length }));
    check(`${dev.name}: Enlist -> 3 recruits join, Barracks shown`, px.n === 3 && /barracks|start/.test(px.screen), JSON.stringify(px));
    await shot('phoenix-barracks');
    check(`${dev.name}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  console.log(`\n${total - fails}/${total} passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
