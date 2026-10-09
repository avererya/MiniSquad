// Rule checks run against the live game object.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.click('[data-a="start"]');
  const res = await page.evaluate(() => {
    const g = window.game; const out = {};
    const step = (sec) => { for (let i = 0; i < sec * 60; i++) g.update(1 / 60); };
    const fresh = () => { g.reset(2); g.enemies.forEach(e => e.state = 'dead'); g.enemies = []; g.mission.defenders = [{ active: true }]; };
    // 1 medkit: damaged soldier walks over it
    fresh();
    const [a, b] = g.soldiers;
    a.hp = 30; a.pos = { x: 1300, y: 1060 }; g.anchor = { x: 1300, y: 1060 }; b.pos = { x: 1300, y: 1000 };
    step(0.1);
    out.medkit = `hp 30 -> ${Math.round(a.hp)}, medkits left ${g.pickups.filter(p => p.type.kind === 'medkit').length}`;
    // 2 revive
    fresh();
    g.downSoldier(g.soldiers[0]);
    g.soldiers[1].pos = { ...g.soldiers[0].pos }; g.anchor = { ...g.soldiers[0].pos };
    step(9.5); const mid = g.soldiers[0].state;
    step(0.7);
    out.revive = `at 9.5s ${mid}, at 10.2s ${g.soldiers[0].state} hp ${Math.round(g.soldiers[0].hp)} bleed ${g.soldiers[0].bleed.toFixed(1)}`;
    // 3 bleed-out -> KIA, with pause/keep progress
    fresh();
    const d = g.soldiers[0]; g.downSoldier(d);
    g.soldiers[1].pos = { ...d.pos }; g.anchor = { ...d.pos };
    step(3); const prog = d.reviveProgress;
    g.anchor = { x: d.pos.x + 400, y: d.pos.y }; g.soldiers[1].pos = { x: d.pos.x + 400, y: d.pos.y };
    step(1); const kept = d.reviveProgress;
    step(30);
    out.kia = `progress after 3s ${prog.toFixed(1)}, after leaving ${kept.toFixed(1)}, final state ${d.state}`;
    // 4 LOS: enemy behind a building is not targeted
    fresh();
    const s = g.soldiers[0]; s.pos = { x: 1000, y: 680 }; g.soldiers[1].pos = { x: 100, y: 100 }; g.anchor = { ...s.pos };
    const e = g.spawnEnemy({ x: 1300, y: 680 }); e.guard = true; // building at 1080..1250 between them
    step(0.5);
    out.los = `blocked target=${s.target ? 'YES (bad)' : 'none'}, enemy target=${e.target ? 'YES (bad)' : 'none'}`;
    e.pos = { x: 1000, y: 900 }; step(0.3);
    out.losClear = `clear target=${s.target === e ? 'enemy' : 'none (bad)'}`;
    // 5 bullets stop at walls
    fresh();
    g.projectiles.push({ pos: { x: 780, y: 760 }, vel: { x: 900, y: 0 }, team: 'enemy', damage: 5, life: 2, trail: { x: 780, y: 760 } });
    step(0.2);
    out.wall = `projectiles after hitting wall at x=820: ${g.projectiles.length}`;
    // 6 grenade: no friendly damage
    fresh();
    const t = g.soldiers[0]; const hp0 = g.soldiers.map(x => x.hp);
    const en = g.spawnEnemy({ x: t.pos.x + 60, y: t.pos.y });
    g.targeting = t; g.onTargetConfirm(g.worldToScreen({ x: t.pos.x + 30, y: t.pos.y }));
    step(1.2);
    out.grenade = `friendly hp ${hp0.join(',')} -> ${g.soldiers.map(x => Math.round(x.hp)).join(',')}, enemy ${en.state}`;
    // 7 extraction with a downed soldier -> KIA
    fresh();
    g.mission.phase = 'available'; g.mission.extraction.begin(g); g.mission.extraction.update(g, 999);
    g.downSoldier(g.soldiers[1]); g.soldiers[1].pos = { x: 2000, y: 700 };
    g.soldiers[0].pos = { x: 3200, y: 250 }; g.anchor = { x: 3200, y: 250 };
    step(0.2);
    out.extract = `phase ${g.phase}, states ${g.soldiers.map(x => x.state).join(',')}`;
    return out;
  });
  for (const [k, v] of Object.entries(res)) console.log(k.padEnd(9), v);
  console.log('ERRORS', errors);
  await browser.close();
})();
