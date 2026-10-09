// Screenshot a live firefight: squad moving vs standing.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '.';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.click('[data-a="start"]');
  await page.evaluate(() => {
    const g = window.game; g.invuln = true;
    const p = { x: 1000, y: 760 };
    g.anchor = { ...p }; g.cam = { ...p };
    g.soldiers.forEach((s, i) => { s.pos = { x: p.x + i * 30, y: p.y + i * 40 }; });
    for (let i = 0; i < 6; i++) g.spawnEnemy({ x: 1350 + (i % 3) * 30, y: 640 + i * 40 });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/f1-standing.png` });
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/f2-retreat-south.png` });
  await page.keyboard.up('KeyS');
  console.log('ERRORS', errors);
  await browser.close();
})();
