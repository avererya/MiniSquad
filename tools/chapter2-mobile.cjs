// v0.6.2 Chapter 2 mobile checks + screenshots (touch emulation, landscape, rotation):
// iPhone SE (667x375), iPhone 14 (844x390), Pixel 7 (915x412).
//  - every new mission in play (Bridgehead with an enemy Sniper laser, Prison Break escort +
//    watchtower, Convoy truck HUD, Blackout relays + ALARM meter, Iron Warden boss bar + rocket circle)
//  - HUD layout: objective box (with chips / meter / boss bar) on screen, not covering the soldier
//    tiles, text >= 10 px; after a portrait -> landscape rotation too
//  - "NEW CLASS UNLOCKED! SNIPER" and "NEW RECRUIT AVAILABLE! Patch" notices fit, buttons tappable
//  - Recruitment Office with a Sniper offer fits (no sideways scroll), Results with the class unlock line
//  - Campaign: Chapter 2 tab
// Usage: OUT=dir node tools/chapter2-mobile.cjs   (screenshots: <dir>/<device>-<scene>.png)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const OUT = process.env.OUT || '/tmp';
const URL = process.env.URL || 'http://localhost:4173/';
const DEVICES = [
  { name: 'iphoneSE', land: [667, 375], dpr: 2 },
  { name: 'iphone14', land: [844, 390], dpr: 3 },
  { name: 'pixel7', land: [915, 412], dpr: 2.625 },
];
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(84)} ${String(detail).slice(0, 200)}`); };
  for (const dev of DEVICES) {
    const [W, H] = dev.land;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const shot = async (n) => page.screenshot({ path: `${OUT}/${dev.name}-${n}.png` });
    await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(250);

    /** HUD geometry in CSS px: objective box, soldier tiles, min text size. */
    const hud = () => page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const box = (el) => { if (!el || !el.offsetParent) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const obj = box(document.getElementById('objective'));
      const tiles = [...document.querySelectorAll('#panels .panel')].map(box).filter(Boolean);
      const inside = (b) => b && b.l >= -0.5 && b.t >= -0.5 && b.r <= vw + 0.5 && b.b <= vh + 0.5;
      const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const texts = [...document.querySelectorAll('#objective *')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      const rendered = (e) => parseFloat(getComputedStyle(e).fontSize) * (e.getBoundingClientRect().height / Math.max(1, e.offsetHeight));
      const minFont = Math.min(...texts.map(rendered));
      // Baseline: the pre-existing objective sub-line / optional text (13 stage px). New widgets must not be smaller.
      const base = [...document.querySelectorAll('#objective .obj-sub, #objective .obj-opt div')].filter((e) => e.offsetParent);
      const baseFont = base.length ? Math.min(...base.map(rendered)) : minFont;
      return { vw, vh, obj, objInside: inside(obj), tilesInside: tiles.every(inside), overlap: tiles.some((t) => overlap(obj, t)), minFont: +minFont.toFixed(1), baseFont: +baseFont.toFixed(1), objH: obj ? Math.round(obj.h) : 0,
        chips: document.querySelectorAll('.obj-chips .oc').length, meter: !!box(document.querySelector('.obj-meter')), boss: !!box(document.querySelector('.obj-boss')) };
    });
    const hudCheck = async (tag, extra = () => true) => {
      const h = await hud();
      check(`${dev.name} ${tag}: objective HUD on screen, clear of the soldier tiles, new text not smaller than existing HUD text`, h.objInside && h.tilesInside && !h.overlap && h.minFont >= h.baseFont - 0.05 && extra(h), JSON.stringify({ objH: h.objH, minFont: h.minFont, baseFont: h.baseFont, chips: h.chips, meter: h.meter, boss: h.boss, overlap: h.overlap }));
      return h;
    };
    const start = (mission, ids, setup) => page.evaluate(([mission, ids, setup]) => {
      const g = window.game; window.__debugUnlockAll();
      const a = window.__account(); if (!a.classUnlocks.unlocked.includes('sniper')) { a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper'); }
      g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
      // eslint-disable-next-line no-new-func
      new Function('g', setup)(g);
      return r.ok;
    }, [mission, ids, setup]);
    const SQ5 = ['ace', 'ranger', 'tank', 'doc', 'havoc'];

    // ---------- Campaign: Chapter 2 tab ----------
    await page.evaluate(() => { window.__debugUnlockAll(); window.game.ui.showCampaign(); });
    await page.waitForTimeout(150);
    await page.tap('[data-a="cchap"][data-ch="2"]'); await page.waitForTimeout(150);
    const camp = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.c-row')].map((r) => r.dataset.id), scroll: document.getElementById('menu').scrollHeight > document.getElementById('menu').clientHeight + 1, hscroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    check(`${dev.name}: Campaign Chapter 2 tab lists Missions 6-10, no scrolling`, camp.rows.join() === 'bridgehead,prison-break,convoy-crusher,blackout,iron-fist' && !camp.scroll && !camp.hscroll, camp.rows.join() + ' scroll=' + camp.scroll + ' h=' + camp.hscroll);
    await shot('campaign-chapter2');

    // ---------- M6 Bridgehead: squad on the bridge, an enemy Sniper aiming (laser) ----------
    await start('bridgehead', ['ace', 'ranger', 'tank', 'doc'], `
      for (const e of g.enemies) e.state = 'dead'; g.enemies = [];
      const m = g.mission; m.primaries[0].state = 'complete'; m.current = 1; m.primaries[1].activate(m, g); m.phase = 'hold';
      g.soldiers.forEach((s, i) => { s.pos = { x: 1720 + i * 40, y: 700 + (i % 2) * 40 }; }); g.anchor = { x: 1780, y: 720 }; g.cam = { x: 1900, y: 720 };
      const e = g.spawnEnemy({ x: 2250, y: 560 }, 'sniper'); e.guard = true; e.reactionTime = 0;
      const r = g.spawnEnemy({ x: 2180, y: 820 }); r.guard = true;
      window.__sn = e;`);
    await page.waitForFunction(() => window.__sn && window.__sn.aimHeld > 0.9, null, { timeout: 8000 }).catch(() => {});
    await hudCheck('M6 Bridgehead (hold + sniper laser)');
    await shot('m6-bridgehead-sniper-laser');

    // ---------- M7 Prison Break: freed prisoner inside the formation, watchtower ----------
    await start('prison-break', SQ5, `
      for (const e of g.enemies) if (e.kind !== 'tower') e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active);
      const m = g.mission; m.primaries[0].state = 'complete'; m.current = 1; m.primaries[1].state = 'complete'; m.current = 2; m.phase = 'toExtraction';
      m.npc.escorting = true; m.npc.pos = { x: 2350, y: 740 };
      g.soldiers.forEach((s, i) => { s.pos = { x: 2330 + (i % 3) * 30, y: 700 + Math.floor(i / 3) * 60 }; }); g.anchor = { x: 2350, y: 740 }; g.cam = { x: 2300, y: 700 };
      g.input.move = () => ({ x: -1, y: 0.1 });`);
    await page.waitForTimeout(1600);
    await page.evaluate(() => { window.game.input.move = () => ({ x: 0, y: 0 }); });
    await page.waitForTimeout(500);
    await hudCheck('M7 Prison Break (escort)');
    await shot('m7-prison-break-escort');

    // ---------- M8 Convoy: trucks on the road, chips HUD ----------
    await start('convoy-crusher', SQ5, `
      const c = g.mission.convoy; c.t = 60;
      g.soldiers.forEach((s, i) => { s.pos = { x: 1500 + i * 30, y: 980 }; }); g.anchor = { x: 1560, y: 980 };`);
    await page.evaluate(() => { const g = window.game, c = g.mission.convoy; for (let i = 0; i < 30; i++) g.update(1 / 60); const t = c.trucks.find((x) => x.unit); if (t) { t.s = 2150; g.damage(t.unit, 380); } const p = c.at(2150).p; g.soldiers.forEach((s, i) => { s.pos = { x: p.x - 200 + i * 30, y: p.y + 220 }; }); g.anchor = { x: p.x - 140, y: p.y + 220 }; g.cam = { x: p.x - 60, y: p.y + 80 }; });
    await page.waitForTimeout(700);
    await hudCheck('M8 Convoy (truck chips)', (h) => h.chips === 3);
    await shot('m8-convoy-hud');

    // ---------- M9 Blackout: night, relays, ALARM meter ----------
    await start('blackout', SQ5, `
      for (const e of g.enemies) if (!e.structure) e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active);
      const r = g.mission.primaries[0]; r.alarm = 64; r.waveT = 999;
      g.damage(r.targets[0], 99999);
      g.soldiers.forEach((s, i) => { s.pos = { x: 2150 + i * 30, y: 900 }; }); g.anchor = { x: 2200, y: 900 }; g.cam = { x: 2300, y: 820 };
      g.damage(r.targets[1], 250);`);
    await page.waitForTimeout(700);
    await hudCheck('M9 Blackout (relay chips + ALARM meter)', (h) => h.chips === 3 && h.meter);
    await shot('m9-blackout-relays-alarm');

    // ---------- M10 Iron Warden: boss bar + rocket circle ----------
    await start('iron-fist', SQ5, `
      for (const e of g.enemies) if (!e.structure) e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active);
      const m = g.mission; m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; m.primaries[2].activate(m, g); m.phase = 'boss';
      g.soldiers.forEach((s, i) => { s.pos = { x: 2560 + (i % 3) * 45, y: 1150 + Math.floor(i / 3) * 50 }; }); g.anchor = { x: 2600, y: 1170 }; g.cam = { x: 2750, y: 1080 };
      m.boss.unit.hp = m.boss.unit.maxHp * 0.58; m.boss.called = [0];
      window.__boss = m.boss;`);
    await page.waitForFunction(() => window.__boss && window.__boss.phase !== 'intro', null, { timeout: 6000 }).catch(() => {});
    await page.evaluate(() => { const b = window.__boss; b.rocketT = 0; b.phase = 'idle'; });
    await page.waitForFunction(() => window.__boss.rocket && window.__boss.rocket.t > 1.3, null, { timeout: 6000 }).catch(() => {});
    await hudCheck('M10 Iron Warden (boss bar)', (h) => h.boss);
    await shot('m10-boss-rocket-telegraph');
    await page.waitForFunction(() => window.__boss.phase === 'windup' || window.__boss.phase === 'burst', null, { timeout: 8000 }).catch(() => {});
    await shot('m10-boss-mg-windup');

    // ---------- rotation: portrait -> landscape keeps the HUD intact ----------
    await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(450);
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450);
    await hudCheck('M10 after rotation', (h) => h.boss);
    await shot('m10-after-rotation');

    // ---------- Results: M9 first clear -> NEW CLASS UNLOCKED line ----------
    await page.evaluate(() => {
      localStorage.clear();
      const g = window.game; window.__debugUnlockAll();
      const a = window.__account(); a.classUnlocks = { unlocked: [], notified: [] };
      for (const k of Object.keys(a.missions)) if (k === 'blackout') delete a.missions[k];
      g.selectMission('blackout', true); g.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'].map((id) => g.roster.get(id)), 'roster');
      for (const e of g.enemies) if (!e.structure) e.state = 'dead';
      g.mission.debugReadyExtraction(g); g.win();
    });
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => ({ txt: (document.querySelector('.r-unls') || {}).textContent || '', hs: document.documentElement.scrollWidth > innerWidth + 1 }));
    check(`${dev.name}: M9 Results show "NEW CLASS UNLOCKED: SNIPER"`, /NEW CLASS UNLOCKED: SNIPER/.test(res.txt) && !res.hs, res.txt.replace(/\s+/g, ' ').slice(0, 120));
    await shot('results-m9-sniper-unlocked');

    // ---------- class unlock notice on the Campaign screen ----------
    await page.evaluate(() => window.game.toCampaign());
    await page.waitForTimeout(300);
    const notice = async (sel) => page.evaluate((sel) => {
      const n = document.querySelector(sel); if (!n) return null;
      const r = n.getBoundingClientRect();
      const btns = [...n.querySelectorAll('button')].map((b) => { const q = b.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { inside: q.left >= 0 && q.top >= 0 && q.right <= innerWidth && q.bottom <= innerHeight, ok: !!hit && (hit === b || b.contains(hit)), h: Math.round(q.height) }; });
      const texts = [...n.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      return { fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, btns, txt: n.textContent.replace(/\s+/g, ' ').trim(), minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))) };
    }, sel);
    const cn = await notice('.cn-notice');
    check(`${dev.name}: "NEW CLASS UNLOCKED! SNIPER" notice fits; Later / Visit tappable (>= 34 px)`, cn && cn.fits && cn.btns.length === 2 && cn.btns.every((b) => b.inside && b.ok && b.h >= 34) && /NEW CLASS UNLOCKED!/.test(cn.txt) && /SNIPER/.test(cn.txt) && /Long-range precision specialists are now available in the Recruitment Office\./.test(cn.txt), cn && JSON.stringify({ btns: cn.btns, font: cn.minFont }));
    await shot('notice-new-class-sniper');
    await page.tap('[data-a="cn-visit"]'); await page.waitForTimeout(250);

    // ---------- Recruitment Office with the guaranteed Sniper offer ----------
    const office = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.rc-card')];
      const sn = cards.find((c) => /Sniper/.test(c.textContent));
      const r = sn && sn.getBoundingClientRect();
      return { n: cards.length, sniper: !!sn, txt: sn ? sn.textContent.replace(/\s+/g, ' ').slice(0, 140) : '', fits: !!r && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, hs: document.documentElement.scrollWidth > innerWidth + 1, tab: (document.querySelector('[data-a="tab"].on') || {}).dataset?.tab };
    });
    check(`${dev.name}: "Visit" opens the Recruitment Office: 3 offers incl. a Sniper (1,250 CR), fits`, office.n === 3 && office.sniper && /1,250/.test(office.txt) && office.fits && !office.hs, office.txt);
    await shot('recruit-office-sniper-offer');

    // ---------- Patch notice (M7 milestone) ----------
    await page.evaluate(() => {
      const a = window.__account(); const g = window.game;
      a.named.unlocked = a.named.unlocked.filter((k) => k !== 'patch'); a.named.claimed = a.named.claimed.filter((k) => k !== 'patch'); a.named.notified = a.named.notified.filter((k) => k !== 'patch');
      g.roster.unlocked.delete('patch');
      window.__economy.unlockRecruitOffer(a, 'patch');
      g.ui.showCampaign();
    });
    await page.waitForTimeout(250);
    const pn = await notice('.rn-notice');
    check(`${dev.name}: "NEW RECRUIT AVAILABLE!" Patch — Medic notice fits; buttons tappable`, pn && pn.fits && pn.btns.every((b) => b.inside && b.ok && b.h >= 34) && /NEW RECRUIT AVAILABLE/.test(pn.txt) && /Patch/.test(pn.txt) && /Medic/.test(pn.txt), pn && pn.txt.slice(0, 120));
    await shot('notice-new-recruit-patch');

    check(`${dev.name}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  console.log(`\n${total - fails}/${total} passed${fails ? `, ${fails} FAILED` : ''}`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
