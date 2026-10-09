// Screenshots of each soldier class, abilities and the landscape HUD.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '.';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto((process.env.URL || 'http://localhost:4173/') + '?squad=ihm');
  await page.screenshot({ path: `${OUT}/c0-start-screen.png` });
  await page.click('[data-a="start"]');
  await page.evaluate(() => {
    const g = window.game; g.invuln = true;
    const p = { x: 1000, y: 760 };
    g.anchor = { ...p }; g.cam = { ...p };
    g.soldiers.forEach((s, i) => { s.pos = { x: p.x - 30 + i * 45, y: p.y + (i - 1) * 50 }; });
    for (let i = 0; i < 5; i++) g.spawnEnemy({ x: 1330 + (i % 2) * 30, y: 650 + i * 45 });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/c1-squad-firefight.png` });
  // close-up crop of the three classes facing right / down
  const crop = async (name) => {
    const box = await page.evaluate(() => {
      const g = window.game; const xs = g.soldiers.map(s => g.worldToScreen(s.pos));
      const minX = Math.min(...xs.map(p => p.x)) - 60, maxX = Math.max(...xs.map(p => p.x)) + 60;
      const minY = Math.min(...xs.map(p => p.y)) - 90, maxY = Math.max(...xs.map(p => p.y)) + 30;
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    });
    await page.screenshot({ path: `${OUT}/${name}`, clip: box });
  };
  await crop('c2-classes-closeup.png');
  // Suppressive Fire + Field Treatment
  await page.evaluate(() => { const g = window.game; g.soldiers.forEach(s => s.hp = s.maxHp * 0.5); });
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(250);
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/c3-suppress-and-heal.png` });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/c4-suppressing-hud.png` });
  // facing away (aim up) to show packs
  await page.evaluate(() => { const g = window.game; g.enemies.forEach(e => e.state = 'dead'); g.enemies = []; g.spawnEnemy({ x: 1030, y: 420 }).hp = 1e6; });
  await page.waitForTimeout(900);
  await crop('c5-classes-facing-away.png');
  // denied feedback: Field Treatment on cooldown
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/c6-ability-denied.png` });
  // downed medic being revived
  await page.evaluate(() => { const g = window.game; g.invuln = false; g.downSoldier(g.soldiers[2]); g.soldiers[1].pos = { ...g.soldiers[2].pos, x: g.soldiers[2].pos.x + 20 }; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/c7-revive.png` });
  console.log('ERRORS', errors);
  await browser.close();
})();
