// Touch test via CDP: joystick drag on the left, ability button tap, ground tap.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '.';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.tap('[data-a="deploy"]');
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i })) });
  const before = await page.evaluate(() => ({ ...window.game.anchor }));
  await touch('touchStart', [[150, 380, 1]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[150 + i * 6, 380, 1]]); await page.waitForTimeout(16); }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/t1-joystick.png` });
  await touch('touchEnd', []);
  const after = await page.evaluate(() => ({ ...window.game.anchor }));
  console.log('joystick moved anchor by', Math.round(after.x - before.x), Math.round(after.y - before.y));
  // ability button
  await page.tap('.panel:nth-child(1) .ability');
  const targeting = await page.evaluate(() => !!window.game.targeting);
  console.log('targeting after button tap:', targeting);
  const nadesBefore = await page.evaluate(() => window.game.soldiers[0].ability.cooldownLeft);
  await touch('touchStart', [[700, 200, 2]]);
  await page.waitForTimeout(50);
  await page.screenshot({ path: `${OUT}/t2-touch-target.png` });
  await touch('touchEnd', []);
  await page.waitForTimeout(100);
  const st = await page.evaluate(() => ({ targeting: !!window.game.targeting, cd: window.game.soldiers[0].ability.cooldownLeft, grenades: window.game.grenades.length }));
  console.log('after ground tap:', JSON.stringify(st), 'cd before', nadesBefore);
  console.log('ERRORS', errors);
  await browser.close();
})();
