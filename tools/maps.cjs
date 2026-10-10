// v0.4 map checks: every mission map is navigable (A* path from the squad start to every enemy
// group point, reinforcement point, objective and extraction zone, none inside an obstacle),
// plus a top-down overview image per map (OUT=dir) with zones, spawns and the start marked.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const OUT = process.env.OUT || '';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  let fails = 0;
  for (const id of ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home', 'bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist']) {
    const r = await page.evaluate((id) => {
      const g = window.game; g.selectMission(id, true); g.reset(['infantry', 'infantry', 'infantry']);
      const m = g.mission, sc = m.script, map = sc.map, w = g.world;
      const pts = [];
      for (const grp of sc.groups()) grp.points.forEach((p, i) => pts.push([`${grp.tag}#${i}`, p]));
      for (const t of sc.triggers) t.points.forEach((p, i) => pts.push([`trigger ${t.id}#${i}`, p]));
      if (sc.extraction.finalWave) sc.extraction.finalWave.points.forEach((p, i) => pts.push([`final#${i}`, p]));
      const z = sc.extraction.zone; pts.push(['extraction', { x: z.x + z.w / 2, y: z.y + z.h / 2 }]);
      if (sc.captive) pts.push(['captive', sc.captive]);
      for (const o of m.primaries) { const p = o.point(m, g); if (p) pts.push([`objective ${o.id}`, p.pos]); if (o.zone) pts.push([`zone ${o.id}`, { x: o.zone.x + o.zone.w / 2, y: o.zone.y + o.zone.h / 2 }]); }
      for (const o of m.primaries) if (o.waves) o.waves.forEach((wv, i) => wv.points.forEach((p, j) => pts.push([`wave${i}#${j}`, p])));
      // v0.6.2: multi-target structures (relays, installations), relay reinforcement points, boss gates / spawn
      for (const o of m.primaries) if (o.points && o.kind) o.points.forEach((p, i) => pts.push([`objective ${o.id}#${i}`, p]));
      for (const o of m.primaries) if (o.spawnPoints) o.spawnPoints.forEach((p, i) => pts.push([`alarm ${o.id}#${i}`, p]));
      for (const o of m.primaries) if (o.spawn) pts.push([`boss spawn`, o.spawn]);
      if (sc.boss) sc.boss.gates.forEach((p, i) => pts.push([`gate#${i}`, p]));
      const bad = [];
      w.computeFlow([map.start]);
      const flood = Float32Array.from(w.flow);
      // v0.6.2 convoy: every route point open and every segment clear for a truck (radius 26)
      if (sc.convoy) {
        const R = sc.convoy.route;
        for (let i = 1; i < R.length; i++) if (!w.passable(R[i - 1], R[i], 26)) bad.push(`convoy segment ${i - 1}->${i} blocked`);
      }
      for (const [name, p] of pts) {
        const open = w.isOpen(p.x, p.y) || name.startsWith('objective depot') || name === 'objective outpost' || /^objective (relays|installations)/.test(name); // structure / building markers
        const inMap = p.x > 0 && p.y > 0 && p.x < map.w && p.y < map.h;
        // A* (capped at 6000 expansions) or, for long detours on the big Chapter 2 maps, the flood fill
        const path = w.findPath(map.start, p, 12) || isFinite(flood[w.nearestOpen(w.idx(p.x, p.y))]);
        if (!inMap || !path || (!open && !name.startsWith('zone'))) bad.push(`${name} (${Math.round(p.x)},${Math.round(p.y)}) open=${open} path=${!!path}`);
      }
      // overview image
      const k = 1200 / map.w, c = document.createElement('canvas'); c.width = 1200; c.height = Math.round(map.h * k);
      const x = c.getContext('2d'); x.scale(k, k);
      x.fillStyle = { grass: '#5d8a3a', farm: '#7a8a3a', canyon: '#b8743c', dusk: '#4a5a48', river: '#5d8a3a', prison: '#6d7a4a', desert: '#c8a060', night: '#2a3440', fortress: '#6a6a60' }[map.theme] || '#666'; x.fillRect(0, 0, map.w, map.h);
      x.strokeStyle = 'rgba(230,210,160,0.6)'; x.lineWidth = 40; for (const road of map.roads || []) { x.beginPath(); road.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.stroke(); }
      for (const o of map.obstacles) { x.fillStyle = { rock: '#6b4a32', sandbag: '#b8a070', wall: '#555', building: '#3c3c46', crate: '#8a6a3a', water: '#3a78b8', fence: '#999', concrete: '#7a7a7a' }[o.kind] || '#333'; x.fillRect(o.x, o.y, o.w, o.h); }
      if (sc.convoy) { x.strokeStyle = '#ff4040'; x.lineWidth = 10; x.beginPath(); sc.convoy.route.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.stroke(); }
      x.fillStyle = 'rgba(125,255,138,0.35)'; x.fillRect(z.x, z.y, z.w, z.h);
      for (const o of m.primaries) if (o.zone) { x.fillStyle = 'rgba(255,216,74,0.3)'; x.fillRect(o.zone.x, o.zone.y, o.zone.w, o.zone.h); }
      for (const [name, p] of pts) { x.fillStyle = /^(trigger|final|wave)/.test(name) ? '#ffb347' : name === 'captive' ? '#7dd3ff' : /^objective|zone|extraction/.test(name) ? '#ffd84a' : '#ff4040'; x.beginPath(); x.arc(p.x, p.y, 22, 0, 7); x.fill(); }
      x.fillStyle = '#2f7ff0'; x.beginPath(); x.arc(map.start.x, map.start.y, 34, 0, 7); x.fill();
      g.toCampaign();
      return { n: pts.length, bad, png: c.toDataURL('image/png').split(',')[1], size: `${map.w}x${map.h}`, obstacles: map.obstacles.length };
    }, id);
    const ok = r.bad.length === 0; if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(16)} ${r.size}, ${r.obstacles} obstacles, ${r.n} points reachable from the start${ok ? '' : ': ' + r.bad.join('; ')}`);
    if (OUT) fs.writeFileSync(`${OUT}/map-${id}.png`, Buffer.from(r.png, 'base64'));
  }
  console.log('ERRORS', errors);
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
