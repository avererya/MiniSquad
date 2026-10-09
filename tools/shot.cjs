// Headless smoke test: load the built game, play a bit, screenshot, report errors.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '.';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.screenshot({ path: `${OUT}/0-start.png` });
  await page.click('[data-a="start"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/1-begin.png` });
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/2-moving.png` });
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/3-fight.png` });
  const st = await page.evaluate(() => {
    const g = window.game;
    return { phase: g.phase, soldiers: g.soldiers.map(s => [s.name, s.state, Math.round(s.hp), Math.round(s.pos.x), Math.round(s.pos.y)]), enemies: g.enemies.length, proj: g.projectiles.length, obj: g.objective };
  });
  console.log(JSON.stringify(st));
  console.log('ERRORS', errors);
  await browser.close();
})();
