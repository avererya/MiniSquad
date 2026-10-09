// Close-up lineup of the three classes at several facings (paused sim, 3x pixel density).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '.';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
  await page.goto((process.env.URL || 'http://localhost:4173/') + '?squad=ihm');
  await page.waitForTimeout(200); // ?squad= deploys immediately (dev shortcut)
  const clip = await page.evaluate(() => {
    const g = window.game;
    g.reset(['infantry', 'heavy', 'medic', 'infantry', 'heavy', 'medic']);
    g.enemies.forEach(e => e.state = 'dead'); g.enemies = []; g.pickups = [];
    const c = { x: 1300, y: 1080 }; g.cam = { ...c }; g.anchor = { ...c };
    const aims = [0, 0, 0, Math.PI / 2, Math.PI / 2, Math.PI / 2];
    g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 150 + (i % 3) * 70 + (i >= 3 ? 230 : 0), y: c.y }; s.aim = aims[i]; s.vel = { x: 0, y: 0 }; });
    const e = g.spawnEnemy({ x: c.x + 330, y: c.y }); e.aim = Math.PI;
    g.update = () => {}; // freeze the sim without the pause overlay
    const p = g.worldToScreen({ x: c.x - 190, y: c.y - 85 });
    return { x: p.x, y: p.y, width: 600, height: 110 };
  });
  await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/c2-classes-lineup.png`, clip });
  await page.evaluate(() => { const g = window.game; g.soldiers.forEach(s => s.aim = -Math.PI / 2); });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/c5-classes-facing-away.png`, clip });
  await browser.close();
})();
