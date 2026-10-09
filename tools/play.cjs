// Accelerated autopilot playthrough: drives the squad along A* paths to each
// objective by stepping the sim directly, logging phase changes and squad state.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '.';
const INVULN = process.env.INVULN === '1';
const SIZE = +(process.env.SIZE || 2);
const SQUAD = process.env.SQUAD ? process.env.SQUAD.split('+') : null; // e.g. SQUAD=infantry+heavy+medic
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  // v0.4: this tool plays the comms-outpost map, now Mission 3 (Field Medicine); unlock all (debug) first
  await page.evaluate(() => { window.__debugUnlockAll(); window.game.selectMission('field-medicine', true); });
  await page.click('[data-a="deploy"]');
  const result = await page.evaluate(async ({ INVULN, SIZE, SQUAD }) => {
    const g = window.game;
    g.reset(SQUAD || SIZE);
    g.invuln = INVULN;
    const log = [];
    let lastPhase = '';
    let mv = { x: 0, y: 0 };
    g.input.move = () => mv;
    let path = null, pathT = 0, kills = 0, prevEnemies = g.enemies.length, nades = 0;
    const outpost = { x: 2610, y: 780 }, extract = { x: 3210, y: 250 };
    for (let step = 0; step < 60 * 400 && g.phase === 'playing'; step++) {
      const m = g.mission;
      const goal = (m.phase === 'outpost' || m.phase === 'hold') ? outpost : extract;
      // stop and fight when enemies are visible; advance otherwise
      const fighting = g.soldiers.some((s) => s.active && s.target);
      pathT -= 1 / 60;
      if (pathT <= 0) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; }
      if (path && path.length) {
        while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 20) path.shift();
        const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
        mv = d > 8 && !(fighting && step % 240 < 150) ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
      }
      // throw grenades at clusters; instant abilities (Suppressive Fire, Field Treatment) when useful
      if (step % 90 === 0) {
        for (const s of g.soldiers) {
          if (!s.ability.ready(s)) continue;
          if (s.ability.targetingMode === 'instant') {
            const hurt = g.soldiers.some((o) => o.active && o.hp < o.maxHp * 0.7);
            if ((s.ability.id === 'suppressive' && s.target) || (s.ability.id === 'fieldTreatment' && hurt)) g.useAbility(s);
          } else if (s.target) {
            g.targeting = s; g.onTargetConfirm(g.worldToScreen(s.target.pos)); nades++; break;
          }
        }
      }
      g.update(1 / 60);
      const living = g.enemies.length;
      if (living < prevEnemies) kills += prevEnemies - living;
      prevEnemies = living;
      const key = m.phase + '|' + g.soldiers.map((s) => s.state).join(',');
      if (key !== lastPhase) {
        lastPhase = key;
        log.push(`${g.time.toFixed(1)}s ${m.phase} [${g.soldiers.map((s) => `${s.name}:${s.state}:${Math.round(s.hp)}`).join(' ')}] enemies=${g.enemies.length}`);
      }
      if (step % 600 === 0) log.push(`  t=${g.time.toFixed(0)} anchor=${Math.round(g.anchor.x)},${Math.round(g.anchor.y)} enemies=${g.enemies.length} proj=${g.projectiles.length}`);
    }
    return { phase: g.phase, time: g.time.toFixed(1), kills, nades, log, final: g.soldiers.map((s) => `${s.name}:${s.state}`) };
  }, { INVULN, SIZE, SQUAD });
  console.log(result.log.join('\n'));
  console.log('RESULT', result.phase, result.time, 'kills', result.kills, 'nades', result.nades, result.final.join(' '));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/end-${INVULN ? 'inv' : 'real'}-${SQUAD ? SQUAD.join('-') : SIZE}.png` });
  console.log('ERRORS', errors);
  await browser.close();
})();
