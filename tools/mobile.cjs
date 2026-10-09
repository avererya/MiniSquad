// Mobile checks (touch emulation): rotation, HUD visibility, hitbox alignment, no scroll,
// joystick, and every ability via touch, with a 3-soldier squad (Infantry + Heavy + Medic).
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
    await page.goto((process.env.URL || 'http://localhost:4173/') + '?squad=ihm');
    await page.tap('[data-a="start"]'); // start in portrait, then rotate
    await page.waitForTimeout(200);
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
    check(`${dev.name}: Suppressive Fire via one tap`, sp.active > 3.5 && sp.rate === 12.25 && !sp.targeting, JSON.stringify(sp));
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
    check(`${dev.name}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall mobile checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
