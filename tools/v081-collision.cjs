// v0.8B.1 TRUCK / SQUAD COLLISION STRESS TESTS (Mission 14 escort truck, six deployed soldiers).
//
// Each scenario drives the squad like a player does (the joystick moves the anchor; nobody is placed by hand once
// a scenario starts) around the escort truck, and samples every 1/60 s step:
//   pinned   longest time (s) any living soldier on foot stayed inside the truck's body (oriented box, 3 px slack)
//   wall     steps a soldier overlapped an obstacle by > 3 px (pushed into / through a wall)
//   jump     largest single-step move of a soldier (px; walking is ~2.8 px / step: a big jump is a teleport)
//   runOver  steps the truck drove (> 5 px/s) while a soldier was inside its body (> 6 px deep)
//   rejoin   at the end the anchor walks to open ground clear of the truck and waits: every living soldier on foot
//            must be back in formation (within 150 px of the anchor, a walkable line to it)
// A scenario passes with pinned <= 1.5 s, wall = 0, jump <= 16 px, runOver = 0 and rejoin true (plus its own check).
//
// BASE=http://localhost:4174/ also runs the same scripts against an unchanged v0.8B build and prints its numbers
// (no pass / fail: that is the original failure pattern the fix is measured against).
//
// Usage: npx vite preview --port 4173 &  node tools/v081-collision.cjs   [BASE=http://localhost:4174/]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';

/** Page-side: every scenario; returns { name: metrics }. */
function runAll() {
  const g = window.game, C = window.__CFG, T = C.escortTruck;
  window.__debugUnlockAll();
  const SIX = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'];
  const out = {};
  let mv = { x: 0, y: 0 };
  const setup = (S, { started = true, gunner = null } = {}) => {
    g.selectMission('supply-line', true);
    const r = g.deploy(SIX.map((id) => g.roster.get(id)), 'roster');
    if (!r.ok) throw new Error(r.reason);
    for (const e of g.enemies) if (!e.structure && !e.vehicle) e.state = 'dead';
    g.enemies = g.enemies.filter((e) => e.active);
    const m = g.mission, v = m.escort;
    m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; v.capture();
    m.primaries[2].activate(m, g); m.phase = 'escort';
    g.modal = 'gunner'; g.chooseGunner(gunner ? g.soldiers.find((s) => s.identity.classId === gunner).id : null);
    m.escortStarted = started;
    // no ambushes in these tests (the roadblock scenario places its own enemy)
    const A = m.primaries[2].ambushes; if (A) { A.defs.forEach((d) => { d.at = 1e9; }); }
    g.invuln = true;
    v.s = S; const q = v.at(S); v.unit.pos = { ...q.p }; v.unit.aim = q.a;
    g.input.move = () => mv;
    return { m, v };
  };
  /** Truck-local |x|, |y| of p. */
  const local = (v, p) => { const u = v.unit, c = Math.cos(u.aim), sn = Math.sin(u.aim), dx = p.x - u.pos.x, dy = p.y - u.pos.y; return { x: Math.abs(dx * c + dy * sn), y: Math.abs(-dx * sn + dy * c) }; };
  const depth = (v, s) => { const l = local(v, s.pos); return Math.min(T.halfLen + s.radius - l.x, T.halfWidth + s.radius - l.y); };
  const placeSquad = (p) => { g.anchor = { ...p }; let i = 0; for (const s of g.soldiers) if (s.active && !s.mount) { const q = g.findOpenNear({ x: p.x + ((i % 3) - 1) * 40, y: p.y + (Math.floor(i / 3) - 0.5) * 40 }, 20); s.pos = q; s.vel = { x: 0, y: 0 }; s.path = null; i++; } };
  /** Force the truck to drive toward route progress sTarget whatever the squad does (the squad projection is replaced). */
  const drive = (v, sTarget) => {
    const P = v.project, U = v.update;
    v.update = function (gg, dt) { let first = true; this.project = (p, lo, hi) => { if (first) { first = false; return { s: sTarget + T.behind, d: 0 }; } return P.call(this, p, lo, hi); }; U.call(this, gg, dt); this.project = P; };
    return () => { v.update = U; };
  };
  /** Run fn(step) for sec seconds of game time, sampling the collision metrics into M. */
  const run = (M, v, sec, fn) => {
    const n = Math.round(sec * 60);
    for (let i = 0; i < n; i++) {
      const before = new Map(g.soldiers.map((s) => [s, { ...s.pos }]));
      fn && fn(i);
      g.update(1 / 60);
      if (M._warm > 0) M._warm--;
      const live = v.unit && v.unit.active;
      for (const s of g.soldiers) {
        if (!s.active || s.mount) { M._pin.delete(s); continue; }
        const b = before.get(s); const j = M._warm > 0 ? 0 : Math.hypot(s.pos.x - b.x, s.pos.y - b.y); if (j > M.jump) M.jump = j;
        if (j > 12 && (M._j = M._j || []).length < 4) M._j.push({ n: s.name, b: [Math.round(b.x), Math.round(b.y)], a: [Math.round(s.pos.x), Math.round(s.pos.y)], tr: live ? [Math.round(v.unit.pos.x), Math.round(v.unit.pos.y), +v.unit.aim.toFixed(2)] : null, st: s.state, t: +g.time.toFixed(2) });
        if (inWall(s)) M.wall++;
        const d = live ? depth(v, s) : -1;
        if (d > 3) { const t = (M._pin.get(s) || 0) + 1 / 60; M._pin.set(s, t); if (t > M.pinned) M.pinned = t; } else M._pin.delete(s);
        if (d > 6 && v.v > 5) M.runOver++;
      }
    }
  };
  // (_warm: the first steps after a scenario places the squad are not sampled for jumps: the setup itself puts
  // bodies on the truck, and the first collision pass separates them)
  /** A body overlapping an obstacle by more than 3 px (true circle / rectangle distance, not the padded box). */
  const inWall = (s) => g.world.obstacles.some((o) => { const dx = Math.max(o.x - s.pos.x, 0, s.pos.x - (o.x + o.w)), dy = Math.max(o.y - s.pos.y, 0, s.pos.y - (o.y + o.h)); return Math.hypot(dx, dy) < s.radius - 3; });
  const metrics = () => ({ pinned: 0, wall: 0, jump: 0, runOver: 0, _pin: new Map(), _warm: 6 });
  /** Walk the anchor to open ground clear of the truck and wait: everybody standing back in formation? */
  const rejoin = (M, v) => {
    const u = v.unit, nx = -Math.sin(u.aim), ny = Math.cos(u.aim);
    let goal = null;
    for (const k of [1, -1]) for (const r of [260, 200, 320]) { const p = { x: u.pos.x + nx * r * k, y: u.pos.y + ny * r * k }; if (!goal && g.world.isOpen(p.x, p.y) && !g.world.insideObstacle(p, 40) && g.world.findPath(g.anchor, p, 12)) goal = p; }
    goal = goal || g.findOpenNear({ x: u.pos.x + nx * 260, y: u.pos.y + ny * 260 }, 60);
    let path = g.world.findPath(g.anchor, goal, 12) || [goal];
    run(M, v, 14, () => {
      while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 16) path.shift();
      const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
      mv = d > 8 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
    });
    mv = { x: 0, y: 0 };
    run(M, v, 4);
    const far = g.soldiers.filter((s) => s.active && !s.mount).map((s) => ({ n: s.name, d: Math.round(Math.hypot(s.pos.x - g.anchor.x, s.pos.y - g.anchor.y)), line: g.world.passable(s.pos, g.anchor, s.radius - 2) || !!g.world.findPath(s.pos, g.anchor, s.radius) })).filter((x) => x.d > 150 || !x.line);
    M.rejoin = far.length === 0; M.far = far.map((x) => { const s = g.soldiers.find((o) => o.name === x.n); return { ...x, p: [Math.round(s.pos.x), Math.round(s.pos.y)], st: s.state, cg: !!s.clearGoal, path: s.path ? s.path.length : null, slot: s.slot, sp: +g.spread.toFixed(2), live: v.live, vstate: v.state }; }); M.anc = [Math.round(g.anchor.x), Math.round(g.anchor.y)];
  };
  const finish = (name, M, v, extra = {}) => {
    rejoin(M, v);
    delete M._pin; delete M._warm;
    M.pinned = +M.pinned.toFixed(2); M.jump = +M.jump.toFixed(1);
    M.rescues = v.rescues ?? null; M.nudges = v.nudges;
    out[name] = { ...M, ...extra };
  };
  const toward = (p) => { const dx = p.x - g.anchor.x, dy = p.y - g.anchor.y, d = Math.hypot(dx, dy); return d > 6 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }; };

  // clearance of the road: per route sample, distance from the road centre to the nearest obstacle on each side
  const sideClear = (v, s) => {
    const { p, a } = v.at(s), nx = -Math.sin(a), ny = Math.cos(a), r = {};
    for (const k of [1, -1]) { let d = 0; while (d < 200 && g.world.isOpen(p.x + nx * d * k, p.y + ny * d * k) && !g.world.insideObstacle({ x: p.x + nx * d * k, y: p.y + ny * d * k }, 0)) d += 2; r[k] = d; }
    return r;
  };

  // 1. circles the stationary truck (tight circle, the anchor brushing the body)
  {
    const { v } = setup(700, { started: false });
    const c = { ...v.unit.pos }; placeSquad({ x: c.x, y: c.y - 120 });
    const M = metrics(); let ang = -Math.PI / 2;
    run(M, v, 22, () => { ang += 0.012; const t = { x: c.x + Math.cos(ang) * 75, y: c.y + Math.sin(ang) * 75 }; mv = toward(t); });
    finish('1 circles the stationary truck', M, v, { truckMoved: Math.round(Math.hypot(v.unit.pos.x - c.x, v.unit.pos.y - c.y)) });
  }
  // 2. approaches the truck head-on along the road, walks into it and through to the far side
  {
    const { v } = setup(700, { started: false });
    placeSquad(v.at(1000).p);
    const M = metrics(); const goal = v.at(400).p;
    run(M, v, 14, () => { mv = toward(goal); });
    finish('2 approaches the truck head-on', M, v);
  }
  // 3. runs beside the moving truck (anchor 45 px off the road centre, level with the cab)
  {
    const { v } = setup(500); const stop = drive(v, 1600);
    const side = (s) => { const q = v.at(s); return { x: q.p.x - Math.sin(q.a) * 45, y: q.p.y + Math.cos(q.a) * 45 }; };
    placeSquad(side(520));
    const M = metrics(); const s0 = v.s;
    run(M, v, 14, () => { mv = toward(side(v.s + 10)); });
    stop();
    finish('3 runs beside the moving truck', M, v, { truckMoved: Math.round(v.s - s0) });
  }
  // 4. crosses in front of the moving truck, back and forth, ~70 px ahead of the bumper
  {
    const { v } = setup(500); const stop = drive(v, 1700);
    const M = metrics(); let dir = 1; const s0 = v.s;
    const across = (k) => { const q = v.at(v.s + T.halfLen + 70); return { x: q.p.x - Math.sin(q.a) * 130 * k, y: q.p.y + Math.cos(q.a) * 130 * k }; };
    placeSquad(across(-1));
    run(M, v, 16, () => { const t = across(dir); if (Math.hypot(t.x - g.anchor.x, t.y - g.anchor.y) < 20) dir = -dir; mv = toward(across(dir)); });
    stop();
    finish('4 crosses in front of the moving truck', M, v, { truckMoved: Math.round(v.s - s0) });
  }
  // 5. reverses direction while surrounding the truck (anchor on the truck, forward / back along the road)
  {
    const { v } = setup(700, { started: false });
    placeSquad(v.unit.pos);
    const M = metrics(); const a = v.at(560).p, b = v.at(840).p; let tgt = b;
    run(M, v, 18, () => { if (Math.hypot(tgt.x - g.anchor.x, tgt.y - g.anchor.y) < 12) tgt = tgt === b ? a : b; mv = toward(tgt); });
    finish('5 reverses direction around the truck', M, v);
  }
  // 6 / 7. the truck stops at an enemy roadblock with the squad around it; the squad clears it, the truck resumes
  {
    const { v } = setup(900); const stop = drive(v, 2000);
    const e = g.spawnEnemy(v.at(1100).p); e.holdPos = true; e.guard = true; e.setMaxHp(1e6);
    placeSquad(v.at(950).p);
    const M = metrics(); const s0 = v.s;
    run(M, v, 8, () => { mv = toward(v.at(v.s + 30).p); });
    const rb = { state: v.state, moved: Math.round(v.s - s0), gap: Math.round(1100 - v.s) };
    finish('6 truck stops at an enemy roadblock', M, v, { rb, ok: rb.state === 'roadblock' && rb.gap > T.halfLen });
    // 7: (fresh metrics) kill the roadblock, keep walking ahead: the truck rolls on with the squad
    const M2 = metrics(); g.damage(e, 1e7); const s1 = v.s;
    run(M2, v, 10, () => { mv = toward(v.at(v.s + 260).p); });
    const res = { state: v.state, moved: Math.round(v.s - s1) };
    stop();
    finish('7 roadblock cleared, the truck resumes', M2, v, { res, ok: res.moved > 150 });
  }
  // 8. crowds the truck on the narrowest stretch of road while it drives (anchor riding on the cab)
  {
    const { v } = setup(100, { started: false });
    let best = { s: 0, w: 1e9 };
    for (let s = 300; s < v.total - 300; s += 20) { const c = sideClear(v, s); if (c[1] + c[-1] < best.w) best = { s, w: c[1] + c[-1] }; }
    const S = best.s - 200;
    const r = setup(S); const stop = drive(r.v, best.s + 300);
    placeSquad(r.v.unit.pos);
    const M = metrics(); const s0 = r.v.s;
    run(M, r.v, 14, () => { mv = toward(r.v.at(r.v.s + 20).p); });
    stop();
    finish('8 crowds the truck on a narrow road', M, r.v, { at: best, truckMoved: Math.round(r.v.s - s0) });
  }
  // 9. walks between the truck and solid terrain (the closest obstacle to the road), the truck rolling up on them
  {
    const { v } = setup(100, { started: false });
    let best = { s: 0, d: 1e9, k: 1 };
    for (let s = 300; s < v.total - 300; s += 10) { const c = sideClear(v, s); for (const k of [1, -1]) if (c[k] < best.d) best = { s, d: c[k], k }; }
    const r = setup(best.s - 160); const stop = drive(r.v, best.s + 260);
    const gapPt = (s) => { const q = r.v.at(s); return { x: q.p.x - Math.sin(q.a) * (best.d - 14) * best.k, y: q.p.y + Math.cos(q.a) * (best.d - 14) * best.k }; };
    placeSquad(gapPt(best.s - 60));
    const M = metrics(); const s0 = r.v.s;
    run(M, r.v, 16, (i) => { mv = toward(gapPt(best.s + (i < 480 ? 0 : 80))); });
    stop();
    finish('9 between the truck and solid terrain', M, r.v, { at: best, truckMoved: Math.round(r.v.s - s0) });
  }
  // 10. the gunner is ejected beside the truck parked next to that obstacle, and must be revived
  {
    const { v } = setup(100, { started: false });
    let best = { s: 0, d: 1e9, k: 1 };
    for (let s = 300; s < v.total - 300; s += 10) { const c = sideClear(v, s); for (const k of [1, -1]) if (c[k] < best.d) best = { s, d: c[k], k }; }
    const r = setup(best.s, { started: false, gunner: 'heavy' });
    const gun = r.v.gun, s = gun.gunner;
    placeSquad(r.v.at(best.s + 160).p);
    const M = metrics();
    run(M, r.v, 1);
    g.invuln = false; g.damage(s, 1e5); g.invuln = true;
    const l = local(r.v, s.pos);
    const ej = { state: s.state, open: g.world.isOpen(s.pos.x, s.pos.y) && !g.world.insideObstacle(s.pos, s.radius - 1), outside: l.x >= T.halfLen + s.radius - 1 || l.y >= T.halfWidth + s.radius - 1, reach: !!g.world.findPath(g.anchor, s.pos, 12) };
    run(M, r.v, 30, () => { mv = s.state === 'active' ? { x: 0, y: 0 } : toward(s.pos); });
    ej.revived = s.state === 'active';
    finish('10 gunner ejected and revived', M, r.v, { ej, ok: ej.open && ej.outside && ej.reach && ej.revived });
  }
  // 11. the truck is destroyed while the squad surrounds it
  {
    const { v } = setup(700, { started: false });
    placeSquad(v.unit.pos);
    const M = metrics();
    run(M, v, 3, () => { mv = { x: 0, y: 0 }; });
    g.invuln = false; g.damage(v.unit, 1e6); g.invuln = true;
    run(M, v, 3);
    finish('11 truck destroyed while surrounded', M, v, { state: v.state });
  }
  // 12. leaves the road and rejoins it, six times, while the truck follows
  {
    const { v } = setup(300); const M = metrics(); const s0 = v.s;
    placeSquad(v.at(520).p);
    for (let k = 0; k < 6; k++) {
      const q = v.at(Math.min(v.total - 50, v.s + 260)), sd = k % 2 ? 1 : -1;
      const off = g.findOpenNear({ x: q.p.x - Math.sin(q.a) * 330 * sd, y: q.p.y + Math.cos(q.a) * 330 * sd }, 60);
      let path = g.world.findPath(g.anchor, off, 12) || [off];
      run(M, v, 5, () => { while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 16) path.shift(); mv = toward(path[0]); });
      const back = v.at(Math.min(v.total - 50, v.s + 300)).p;
      path = g.world.findPath(g.anchor, back, 12) || [back];
      run(M, v, 5, () => { while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 16) path.shift(); mv = toward(path[0]); });
    }
    finish('12 leaves and rejoins the road (x6)', M, v, { truckMoved: Math.round(v.s - s0), ok: v.s - s0 > 300 });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  let fails = 0, total = 0;
  const results = {};
  for (const [label, url] of [["v0.8B.1", URL], ...(BASE ? [['v0.8B base', BASE]] : [])]) {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.goto(url); await page.waitForTimeout(150);
    results[label] = await page.evaluate(runAll);
    if (errors.length) console.log(`${label} page errors: ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
  const R = results['v0.8B.1'];
  if (process.env.DEBUG) console.log(JSON.stringify(R));
  for (const [name, M] of Object.entries(R)) {
    const ok = M.pinned <= 1.5 && M.wall === 0 && M.jump <= 16 && M.runOver === 0 && M.rejoin && (M.ok === undefined || M.ok);
    total++; if (!ok) fails++;
    const b = results['v0.8B base'] && results['v0.8B base'][name];
    const fmt = (x) => `pinned ${x.pinned}s wall ${x.wall} jump ${x.jump} runOver ${x.runOver} rejoin ${x.rejoin}${x.ok === undefined ? '' : ` ok ${x.ok}`}`;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${fmt(M)} rescues ${M.rescues} nudges ${M.nudges} ${JSON.stringify({ ...M, pinned: undefined, wall: undefined, jump: undefined, runOver: undefined, rejoin: undefined, ok: undefined, rescues: undefined, nudges: undefined }).slice(0, 220)}`);
    if (b) console.log(`      base v0.8B: ${fmt(b)} ${b.far && b.far.length ? 'far=' + JSON.stringify(b.far).slice(0, 160) : ''}`);
  }
  console.log(`\n${total - fails}/${total} collision stress tests passed`);
  if (results['v0.8B base']) {
    const bf = Object.entries(results['v0.8B base']).filter(([, M]) => !(M.pinned <= 1.5 && M.wall === 0 && M.jump <= 16 && M.runOver === 0 && M.rejoin && (M.ok === undefined || M.ok))).map(([n]) => n.split(' ')[0]);
    console.log(`v0.8B base under the same criteria: ${12 - bf.length}/12 (fails: ${bf.join(', ') || 'none'})`);
  }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
