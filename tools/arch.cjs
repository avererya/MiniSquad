// Phase 3 (architecture optimization) rule checks: the new extension points work and change nothing that exists.
//  A. MissionScript.mechanics: Missions 1-15 declare none; a mechanic's start / step / onEvent / draw hooks run when
//     and as often as documented (start before the first objective, one step per fixed step, not while paused, not
//     after the end), Mission.mechanic(id) finds it, every attempt builds a fresh one
//  B. blastDamage (src/combat.ts): falloff, reach, wall cover, both-team victims (a mine), skip, mul, count; explode()
//     (grenades) still deals exactly the v0.8C.1 formula
//  C. Shared page helpers (tools/lib.cjs): fixed steps, seeded runs repeat exactly
//  D. BASE (v0.8C.1, 924dc13): every CFG group and Missions 1-15 identical as data; a seeded firefight with grenades
//     and Demolitions rockets (splash on Riflemen and Armored Troopers) hashes identically every 0.5 s
// Usage: npm test -- arch   (or: npx vite preview --port 4173 & BASE=<v0.8C.1 url> node tools/arch.cjs)
const { chromium, URL, BASE, createChecks, runSuite, openPage, missionSnapshot } = require('./lib.cjs');

/** Page-side: the seeded firefight of D2 (works on any build since v0.8C: only Game APIs). Hash every 0.5 s. */
function firefight() {
  const g = window.game;
  T.start('field-medicine', ['demolitions', 'infantry', 'demolitions', 'infantry']);
  T.calm();
  g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
  const at = { ...g.map.start };
  T.pinAt(at); g.cam = { ...at };
  const c = { x: at.x + 330, y: at.y };
  const kinds = ['rifleman', 'armored', 'rifleman', 'armored', 'rifleman', 'rifleman'];
  kinds.forEach((k, i) => { const e = g.spawnEnemy(g.findOpenNear({ x: c.x + (i % 3) * 26, y: c.y + (Math.floor(i / 3) - 0.5) * 34 }, 20), k); e.guard = false; });
  const hashes = [];
  const thrower = () => g.soldiers.find((s) => s.active && s.identity?.classId === 'infantry' && s.ability?.ready(s));
  for (let k = 0; k < 16; k++) {
    if (k === 1 || k === 9) { const s = thrower(); if (s) { g.targeting = s; g.onTargetConfirm(T.screenOf(c)); } }
    T.step(0.5, () => T.pinAt(at));
    hashes.push(T.hash());
  }
  const rockets = g.soldiers.filter((s) => s.identity?.classId === 'demolitions').reduce((n, s) => n + s.shots, 0);
  return { hashes, rockets, hp: g.enemies.map((e) => Math.round(e.hp)), alive: g.enemies.filter((e) => e.active).length };
}

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 80 });
  const browser = await chromium.launch();
  const errors = [];
  const page = await openPage(browser, URL, { seed: 4242 });

  // ---------------- A. mission mechanics ----------------
  const a = await page.evaluate(() => {
    const g = window.game, S = window.__missions, out = {};
    out.declared = Object.keys(S).filter((id) => S[id].mechanics);
    out.started = [];
    for (const d of window.__campaign.CAMPAIGN.filter((x) => x.playable)) { T.start(d.id); out.started.push(`${d.id}:${g.mission.mechanics.length}`); }
    // a recording mechanic on Mission 3
    const made = [];
    S['field-medicine'].mechanics = () => {
      const rec = { id: 'probe', log: [], steps: 0, dts: new Set(), events: [], draws: 0,
        start(m, gg) { this.log.push({ enemies: gg.enemies.length, primary: m.currentObjective && m.currentObjective.state, optionals: m.optionals.map((o) => o.state) }); this.spawned = gg.spawnEnemy(gg.findOpenNear({ x: gg.map.start.x + 900, y: gg.map.start.y }, 30), 'rifleman'); },
        step(_m, _g, dt) { this.steps++; this.dts.add(dt); },
        onEvent(_m, _g, ev) { this.events.push(ev.type + (ev.unit === this.spawned ? ':mine' : '')); },
        draw(ctx) { if (ctx && typeof ctx.fillRect === 'function') this.draws++; } };
      made.push(rec); return [rec];
    };
    try {
      const m = T.start('field-medicine');
      const rec = made[0];
      out.startLog = rec.log; out.spawnedListed = g.enemies.includes(rec.spawned);
      out.lookup = m.mechanic('probe') === rec && m.mechanic('nope') === null;
      T.step(1); out.steps = rec.steps; out.dts = [...rec.dts];
      g.paused = true; g.update(1 / 60); g.paused = false; out.pausedSteps = rec.steps;
      g.damage(rec.spawned, 1e6, g.soldiers[0]); out.events = [...rec.events];
      window.__render(); out.draws = rec.draws;
      T.start('field-medicine'); out.fresh = made.length === 2 && made[1] !== made[0] && made[1].steps === 0 && made[0].log.length === 1;
      const r2 = made[1]; T.step(0.5); const before = r2.steps;
      g.fail(); g.update(1 / 60); g.update(1 / 60); out.afterEnd = r2.steps - before;
    } finally { delete S['field-medicine'].mechanics; }
    T.start('field-medicine'); out.cleared = g.mission.mechanics.length === 0 && made.length === 2;
    return out;
  });
  check('A1 no mission script declares mechanics (Missions 1-15 unchanged)', a.declared.length === 0, a.declared.join(','));
  check('A1 every playable mission starts with an empty mechanic list', a.started.length === 15 && a.started.every((x) => x.endsWith(':0')), a.started.join(' '));
  const s0 = a.startLog[0] || {};
  check('A2 start runs once, after the groups spawned and before the first objective / optionals activate', a.startLog.length === 1 && s0.enemies > 0 && s0.primary === 'pending' && s0.optionals.every((x) => x === 'pending'), JSON.stringify(a.startLog));
  check('A2 a unit spawned in start is in game.enemies', a.spawnedListed);
  check('A3 Mission.mechanic(id) finds this attempt\'s mechanic, null otherwise', a.lookup);
  check('A4 step runs once per fixed step with dt = 1/60', a.steps === 60 && a.dts.length === 1 && Math.abs(a.dts[0] - 1 / 60) < 1e-12, `${a.steps} steps, dt ${a.dts}`);
  check('A4 step does not run while paused', a.pausedSteps === 60, `${a.pausedSteps}`);
  check('A5 onEvent hears the kill of its own unit', a.events.includes('enemyKilled:mine'), a.events.join(','));
  check('A6 draw runs in the ground pass of render()', a.draws >= 1, `${a.draws}`);
  check('A7 a new attempt builds a fresh mechanic', a.fresh);
  check('A8 nothing runs once the mission has ended', a.afterEnd === 0, `${a.afterEnd} steps after the end`);
  check('A9 removing the declaration leaves the mission without mechanics', a.cleared);

  // ---------------- B. blastDamage ----------------
  const b = await page.evaluate(() => {
    const g = window.game, C = window.__combat, out = {};
    T.start('field-medicine', ['infantry', 'heavy', 'medic']); T.calm();
    g.input.move = () => ({ x: 0, y: 0 });
    const P = { x: g.map.start.x + 500, y: g.map.start.y };
    const R = 80, D = 100, EDGE = 0.4;
    const put = (dx, dy, kind = 'rifleman') => { const e = g.spawnEnemy({ x: P.x + dx, y: P.y + dy }, kind); e.guard = false; return e; };
    // B1 grenade explode(): the same formula as v0.8C.1 (centre, half radius, just inside / outside the body reach)
    const e0 = put(0, 0), e1 = put(R / 2, 0), e2 = put(0, R + e0.radius - 1), e3 = put(0, -(R + e0.radius + 1));
    const hp = [e0, e1, e2, e3].map((e) => e.hp);
    C.explode(g, P, R, D, EDGE, g.enemies, g.soldiers[0], true, g.soldiers[0].pos);
    const want = (d) => D * (1 - Math.min(1, d / R) * (1 - EDGE));
    out.b1 = [e0, e1, e2, e3].map((e, i) => +(hp[i] - e.hp).toFixed(9));
    out.b1want = [want(0), want(R / 2), want(R + e0.radius - 1), 0].map((x) => +x.toFixed(9));
    T.calm();
    // B2 wall cover: a blast beside a building shelters exactly the units it cannot see
    const bld = g.map.obstacles.filter((o) => o.kind === 'building').sort((p, q) => q.w * q.h - p.w * p.h)[0];
    const Q = { x: bld.x - 20, y: bld.y + bld.h / 2 }, RR = bld.w + 70;
    const pts = [];
    for (let k = 0; k < 36; k++) { const ang = k / 36 * Math.PI * 2; const p = { x: Q.x + Math.cos(ang) * (RR - 30), y: Q.y + Math.sin(ang) * (RR - 30) }; if (g.world.isOpen(p.x, p.y)) pts.push(p); }
    const units = pts.map((p) => { const e = g.spawnEnemy(p, 'rifleman'); e.guard = false; return e; });
    const seen = units.map((e) => g.world.clear(Q, e.pos)), hp2 = units.map((e) => e.hp);
    const n2 = C.blastDamage(g, Q, { radius: RR, damage: 50, edgeFrac: 1, victims: g.enemies, cover: true, opts: { grenade: true, at: Q } });
    const hurt = units.map((e, i) => e.hp < hp2[i]);
    out.b2 = { units: units.length, blocked: seen.filter((x) => !x).length, match: hurt.every((h, i) => h === seen[i]), n: n2, seen: seen.filter(Boolean).length };
    T.calm();
    // B3 a hazard that hurts both teams (a Chapter 4 mine): no source, soldiers and enemies, held captives untouched
    g.invuln = false;
    const s = g.soldiers[0]; s.pos = { x: P.x + 20, y: P.y }; s.vel = { x: 0, y: 0 };
    const en = put(-20, 0), shp = s.hp, ehp = en.hp;
    const n3 = C.blastDamage(g, P, { radius: R, damage: 30, edgeFrac: 1, victims: [...g.enemies, ...g.enemyVictims()], opts: { grenade: true, at: P } });
    out.b3 = { n: n3, soldier: +(shp - s.hp).toFixed(6), enemy: +(ehp - en.hp).toFixed(6), standing: s.active };
    T.calm();
    // B4 skip and mul (rockets: the direct-hit unit is skipped, the anti-armor multiplier applies after the falloff)
    const k0 = put(0, 0), k1 = put(20, 0), k2 = put(-20, 0, 'armored');
    const h4 = [k0, k1, k2].map((e) => e.hp);
    const n4 = C.blastDamage(g, P, { radius: R, damage: 40, edgeFrac: 1, victims: g.enemies, skip: k0, mul: (u) => (u.kind === 'armored' ? 1.5 : 1), opts: { grenade: true, at: P } });
    out.b4 = { n: n4, d: [k0, k1, k2].map((e, i) => +(h4[i] - e.hp).toFixed(6)) };
    return out;
  });
  check('B1 grenade explode(): centre / half radius / edge / outside as the v0.8C.1 formula', JSON.stringify(b.b1) === JSON.stringify(b.b1want), `got ${b.b1} want ${b.b1want}`);
  check('B2 cover: the units hurt are exactly those in line of sight of the blast', b.b2.match && b.b2.blocked > 0 && b.b2.n === b.b2.seen, JSON.stringify(b.b2));
  check('B3 a both-team blast with no source hurts the soldier and the enemy', b.b3.n === 2 && b.b3.soldier === 30 && b.b3.enemy === 30 && b.b3.standing, JSON.stringify(b.b3));
  check('B4 skip excludes the direct hit; mul applies after the falloff', b.b4.n === 2 && b.b4.d[0] === 0 && b.b4.d[1] === 40 && b.b4.d[2] === 60, JSON.stringify(b.b4));

  // ---------------- C. shared page helpers ----------------
  const c1 = await page.evaluate(() => { const g = window.game; T.start('first-contact'); const t0 = g.time; T.step(2); const t1 = g.time; const w = T.stepUntil(() => g.time - t0 >= 3, 5); return { dt: +(t1 - t0).toFixed(9), w: +w.toFixed(6) }; });
  check('C1 T.step(2) advances 2 s of mission time; stepUntil stops at its condition', c1.dt === 2 && Math.abs(c1.w - 1) < 0.02, JSON.stringify(c1));
  const p2 = await openPage(browser, URL, { seed: 4242 }), p3 = await openPage(browser, URL, { seed: 4242 });
  const [f2, f3] = await Promise.all([p2.evaluate(firefight), p3.evaluate(firefight)]);
  check('C2 the same seed replays the same firefight (16 hashes)', JSON.stringify(f2.hashes) === JSON.stringify(f3.hashes), `${f2.hashes[15]} / ${f3.hashes[15]}`);
  check('C2 the firefight exercises rockets and kills', f2.rockets > 0 && f2.alive < 6, `rockets ${f2.rockets}, enemies left ${f2.alive}`);
  errors.push(...page.errors, ...p2.errors, ...p3.errors);

  // ---------------- D. BASE (v0.8C.1) ----------------
  if (BASE) {
    const pb = await openPage(browser, BASE, { seed: 4242 }), pc = await openPage(browser, URL, { seed: 4242 });
    const [sb, sc] = [await pb.evaluate(missionSnapshot), await pc.evaluate(missionSnapshot)];
    const cfgDiff = Object.keys({ ...sb.cfg, ...sc.cfg }).filter((k) => sb.cfg[k] !== sc.cfg[k]);
    const misDiff = Object.keys({ ...sb.missions, ...sc.missions }).filter((k) => sb.missions[k] !== sc.missions[k]);
    check('D1 every CFG group identical to v0.8C.1', cfgDiff.length === 0, cfgDiff.join(',') || `${Object.keys(sc.cfg).length} groups`);
    check('D1 Missions 1-15 identical to v0.8C.1 (map, enemies, objectives, extraction, story, campaign row)', misDiff.length === 0 && Object.keys(sc.missions).length === 15, misDiff.join(',') || `${Object.keys(sc.missions).length} missions`);
    const pb2 = await openPage(browser, BASE, { seed: 4242 }), pc2 = await openPage(browser, URL, { seed: 4242 });
    const [fb, fc] = await Promise.all([pb2.evaluate(firefight), pc2.evaluate(firefight)]);
    const first = fb.hashes.findIndex((h, i) => h !== fc.hashes[i]);
    check('D2 seeded grenade + rocket firefight identical to v0.8C.1 at every 0.5 s checkpoint', first < 0, first < 0 ? `16/16 equal, enemy HP ${fc.hp.join(',')}` : `first difference at ${(first + 1) * 0.5} s`);
    errors.push(...pc.errors, ...pc2.errors);
  } else console.log('SKIP  D (no BASE): run through npm test, or set BASE to a v0.8C.1 build');

  await browser.close();
  return finish(errors);
});
