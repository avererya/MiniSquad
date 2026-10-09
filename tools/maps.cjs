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
  for (const id of ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home']) {
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
      const bad = [];
      for (const [name, p] of pts) {
        const open = w.isOpen(p.x, p.y) || name.startsWith('objective depot') || name === 'objective outpost'; // structure / building markers
        const inMap = p.x > 0 && p.y > 0 && p.x < map.w && p.y < map.h;
        const path = w.findPath(map.start, p, 12);
        if (!inMap || !path || (!open && !name.startsWith('zone'))) bad.push(`${name} (${Math.round(p.x)},${Math.round(p.y)}) open=${open} path=${!!path}`);
      }
      // overview image
      const k = 1200 / map.w, c = document.createElement('canvas'); c.width = 1200; c.height = Math.round(map.h * k);
      const x = c.getContext('2d'); x.scale(k, k);
      x.fillStyle = { grass: '#5d8a3a', farm: '#7a8a3a', canyon: '#b8743c', dusk: '#4a5a48' }[map.theme] || '#666'; x.fillRect(0, 0, map.w, map.h);
      x.strokeStyle = 'rgba(230,210,160,0.6)'; x.lineWidth = 40; for (const road of map.roads || []) { x.beginPath(); road.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.stroke(); }
      for (const o of map.obstacles) { x.fillStyle = { rock: '#6b4a32', sandbag: '#b8a070', wall: '#555', building: '#3c3c46', crate: '#8a6a3a' }[o.kind] || '#333'; x.fillRect(o.x, o.y, o.w, o.h); }
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
