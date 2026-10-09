// Mobile checks (touch emulation) for the full loop: Barracks (portrait + landscape, rotation,
// details panel, squad selection by tap) -> Deploy -> HUD rotation/hitboxes, joystick, every
// ability via touch -> Results (victory + defeat) -> Retry / Return to Barracks.
// Squad: Ace (Infantry) + Havoc (Heavy, Trigger Happy) + Doc (Medic), picked by tapping.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '.';
const DEVICES = [
  { name: 'iphone14', land: [844, 390], dpr: 3 },
  { name: 'iphoneSE', land: [667, 375], dpr: 2 },
  { name: 'pixel7', land: [915, 412], dpr: 2.625 },
];
(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} ${detail}`); };
  for (const dev of DEVICES) {
    const [W, H] = dev.land;
    const ctx = await browser.newContext({ viewport: { width: H, height: W }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(process.env.URL || 'http://localhost:4173/'); // opens in portrait
    await page.waitForTimeout(300);
    // ---------- Barracks ----------
    const menuLayout = async (sel) => page.evaluate((sel) => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const els = [...document.querySelectorAll(sel)];
      const boxes = els.map((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, aligned: !!hit && (hit === el || el.contains(hit)), h: Math.round(r.height), w: Math.round(r.width) };
      });
      const de = document.documentElement, m = document.getElementById('menu');
      const fontPx = parseFloat(getComputedStyle(m).fontSize);
      return { vw, vh, n: els.length, boxes, fontPx, menuScroll: m.scrollHeight > m.clientHeight + 1, hOverflow: de.scrollWidth > vw + 1 || m.scrollWidth > m.clientWidth + 1 };
    }, sel);
    const BARRACKS_SEL = '.s-card, .slot, [data-a="deploy"], .s-card .pick';
    let P = await menuLayout(BARRACKS_SEL);
    check(`${dev.name} portrait: Barracks usable (6 cards, no sideways scroll)`, P.n === 6 + 3 + 1 + 6 && !P.hOverflow && P.fontPx >= 11, `font ${P.fontPx}px, vertical scroll ${P.menuScroll}`);
    await page.screenshot({ path: `${OUT}/m-${dev.name}-portrait-barracks.png` });
    const barracksChecks = async (tag) => {
      const L = await menuLayout(BARRACKS_SEL);
      check(`${dev.name} ${tag}: all cards, slots, Deploy on screen`, L.n === 16 && L.boxes.every((b) => b.inside) && !L.menuScroll && !L.hOverflow, `font ${L.fontPx}px, out: ${L.boxes.filter((b) => !b.inside).length}, scroll ${L.menuScroll}`);
      check(`${dev.name} ${tag}: Barracks hitboxes aligned, buttons >= 28px`, L.boxes.every((b) => b.aligned) && L.boxes.slice(-6).every((b) => b.h >= 28), L.boxes.map((b) => b.aligned ? '' : 'X').join(''));
    };
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450);
    await barracksChecks('landscape');
    await page.screenshot({ path: `${OUT}/m-${dev.name}-landscape-barracks.png` });
    await page.tap('.s-card[data-id="havoc"] .s-name');
    await page.waitForTimeout(150);
    const D = await menuLayout('.d-card, .d-btns .m-big');
    check(`${dev.name} landscape: details panel fits, buttons tappable`, D.n === 3 && D.boxes.every((b) => b.inside && b.aligned), JSON.stringify(D.boxes.map((b) => `${b.w}x${b.h}`)));
    await page.screenshot({ path: `${OUT}/m-${dev.name}-landscape-details.png` });
    await page.tap('.d-btns [data-a="close"]');
    // rotate while in the Barracks
    await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(450);
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450);
    await barracksChecks('landscape after rotation');
    // pick Havoc instead of Tank by tapping: remove slot 2, then Havoc's button
    await page.tap('.slot[data-slot="1"] .slot-x');
    await page.tap('.s-card[data-id="havoc"] .pick');
    const picked = await page.evaluate(() => window.game.roster.slots.join());
    check(`${dev.name}: squad picked by tapping (Ace, Havoc, Doc)`, picked === 'ace,havoc,doc', picked);
    await page.screenshot({ path: `${OUT}/m-${dev.name}-landscape-selection.png` });
    await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(300); // deploy in portrait, then rotate
    await page.tap('[data-a="deploy"]');
    await page.waitForTimeout(200);
    const dep = await page.evaluate(() => window.game.soldiers.map((s) => s.identity.id).join());
    check(`${dev.name}: Deploy starts the mission with the picked soldiers`, dep === 'ace,havoc,doc', dep);
    const layout = async () => page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const btns = [...document.querySelectorAll('.panel .ability')].map((b) => {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return { inside: r.left >= 0 && r.top >= 0 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, aligned: !!hit && hit.closest('.ability') === b, w: Math.round(r.width), h: Math.round(r.height) };
      });
      const de = document.documentElement;
      return { vw, vh, btns, scroll: [window.scrollX, window.scrollY], overflow: de.scrollWidth > vw + 1 || de.scrollHeight > vh + 1 || document.body.scrollWidth > vw + 1 };
    });
    const rotations = [[W, H], [H, W], [W, H]];
    for (const [i, [w, h]] of rotations.entries()) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(450); // layout re-runs at 0/100/350 ms
      if (w > h) {
        const L = await layout();
        check(`${dev.name} landscape#${i}: 3 ability buttons visible`, L.btns.length === 3 && L.btns.every((b) => b.inside), JSON.stringify(L.btns.map((b) => `${b.w}x${b.h}${b.inside ? '' : ' OUT'}`)));
        check(`${dev.name} landscape#${i}: touch hitboxes aligned`, L.btns.every((b) => b.aligned), L.btns.map((b) => b.aligned).join(','));
        check(`${dev.name} landscape#${i}: no scroll / overflow`, !L.overflow && L.scroll[0] === 0 && L.scroll[1] === 0, `scroll ${L.scroll} overflow ${L.overflow}`);
      }
    }
    await page.screenshot({ path: `${OUT}/m-${dev.name}-landscape-hud.png` });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p[0], y: p[1], id: p[2] })) });
    // joystick on the left
    await page.evaluate(() => { window.game.invuln = true; });
    const a0 = await page.evaluate(() => ({ ...window.game.anchor }));
    await touch('touchStart', [[W * 0.15, H * 0.6, 1]]);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[W * 0.15 + i * 5, H * 0.6, 1]]); await page.waitForTimeout(16); }
    await page.waitForTimeout(800);
    await touch('touchEnd', []);
    const a1 = await page.evaluate(() => ({ ...window.game.anchor }));
    check(`${dev.name}: joystick drag moves the squad`, a1.x - a0.x > 40, `anchor dx ${Math.round(a1.x - a0.x)}`);
    // 1: Grenade (targeted): tap button, then tap ground
    await page.tap('.panel:nth-child(1) .ability');
    const tgt = await page.evaluate(() => !!window.game.targeting);
    await touch('touchStart', [[W * 0.7, H * 0.35, 2]]); await page.waitForTimeout(40); await touch('touchEnd', []);
    await page.waitForTimeout(80);
    const gr = await page.evaluate(() => ({ t: !!window.game.targeting, n: window.game.grenades.length, cd: window.game.soldiers[0].ability.cooldownLeft }));
    check(`${dev.name}: Grenade via touch (tap button, tap ground)`, tgt && !gr.t && gr.n === 1 && gr.cd > 7, `targeting ${tgt} -> ${gr.t}, grenades ${gr.n}, cd ${gr.cd.toFixed(1)}`);
    // 2: Suppressive Fire (instant)
    await page.tap('.panel:nth-child(2) .ability');
    const sp = await page.evaluate(() => { const h = window.game.soldiers[1]; return { active: h.ability.activeLeft, rate: h.fireRate, targeting: !!window.game.targeting }; });
    check(`${dev.name}: Suppressive Fire via one tap (Havoc 7.35 x 1.75)`, sp.active > 3.5 && Math.abs(sp.rate - 12.8625) < 1e-9 && !sp.targeting, JSON.stringify(sp));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/m-${dev.name}-suppressive.png` });
    // 3: Field Treatment (instant)
    await page.evaluate(() => { const g = window.game; const m = g.soldiers[2]; g.soldiers.forEach((s) => { s.hp = s.maxHp * 0.5; s.pos = { x: m.pos.x + (s === m ? 0 : 30), y: m.pos.y + (s === m ? 0 : 20 * s.id % 40) }; }); });
    const hp0 = await page.evaluate(() => window.game.soldiers.map((s) => s.hp));
    await page.tap('.panel:nth-child(3) .ability');
    const ft = await page.evaluate(() => ({ hp: window.game.soldiers.map((s) => s.hp), cd: window.game.soldiers[2].ability.cooldownLeft }));
    check(`${dev.name}: Field Treatment via one tap`, ft.cd > 24 && ft.hp.every((h, i) => h > hp0[i]), `hp ${hp0.map(Math.round)} -> ${ft.hp.map(Math.round)}, cd ${ft.cd.toFixed(1)}`);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${OUT}/m-${dev.name}-field-treatment.png` });
    // tapping it again gives visible feedback instead of silently failing
    await page.tap('.panel:nth-child(3) .ability');
    await page.waitForTimeout(120); // the HUD redraws on the next animation frame
    const hint = await page.evaluate(() => { const h = document.getElementById('hint'); return h.style.display !== 'none' ? h.textContent : ''; });
    check(`${dev.name}: unavailable ability shows feedback`, /RECHARGING/.test(hint), hint);
    // ---------- Results ----------
    const RESULT_SEL = '#menu .r-card, #menu [data-a="retry"], #menu [data-a="barracks"]';
    await page.evaluate(() => { const g = window.game; g.soldiers[2].state = 'kia'; g.win(); });
    await page.waitForTimeout(150);
    let Rl = await menuLayout(RESULT_SEL);
    check(`${dev.name} landscape: victory Results fit, buttons tappable`, Rl.n === 3 && Rl.boxes.every((b) => b.inside && b.aligned) && !Rl.menuScroll, `font ${Rl.fontPx}px ${JSON.stringify(Rl.boxes.map((b) => `${b.w}x${b.h}`))}`);
    await page.screenshot({ path: `${OUT}/m-${dev.name}-landscape-results-victory.png` });
    await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(450);
    Rl = await menuLayout(RESULT_SEL);
    check(`${dev.name} portrait: Results usable`, Rl.n === 3 && !Rl.hOverflow && Rl.boxes.slice(1).every((b) => b.aligned), `scroll ${Rl.menuScroll}`);
    await page.screenshot({ path: `${OUT}/m-${dev.name}-portrait-results.png` });
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450);
    await page.tap('[data-a="retry"]');
    await page.waitForTimeout(100);
    const rt = await page.evaluate(() => ({ phase: window.game.phase, ids: window.game.soldiers.map((s) => `${s.identity.id}:${s.state}:${s.hp}`).join() }));
    check(`${dev.name}: Retry restarts with the same squad, KIA cleared`, rt.phase === 'playing' && rt.ids === 'ace:active:100,havoc:active:150,doc:active:80', JSON.stringify(rt));
    await page.evaluate(() => { const g = window.game; g.invuln = false; g.soldiers.forEach((s) => g.downSoldier(s)); g.soldiers[1].state = 'kia'; });
    await page.waitForTimeout(150);
    Rl = await menuLayout(RESULT_SEL);
    check(`${dev.name} landscape: defeat Results fit`, Rl.n === 3 && Rl.boxes.every((b) => b.inside && b.aligned), '');
    await page.screenshot({ path: `${OUT}/m-${dev.name}-landscape-results-defeat.png` });
    await page.tap('#menu [data-a="barracks"]');
    await page.waitForTimeout(150);
    await barracksChecks('back in Barracks');
    check(`${dev.name}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall mobile checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
