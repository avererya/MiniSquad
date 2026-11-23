// v0.9B.2 rule checks: Ambush Alley, Rooftop Threats & Extraction Assault (Mission 18 only).
//  A. Two isolated rooftop snipers (avenue-roof over South Avenue, cache-roof over North Avenue facing the cache
//     courtyard): 7 concealed snipers in Mission 18, each new one springs hidden when the squad walks into its avenue
//     (Main Street never arms them), reveals already aiming (laser at once, first shot 2.5-3 s later), is a target the
//     moment it shows, stays revealed, and a squad on the street kills it; drawn on its roof; isolated: no line to
//     Main Street, no placed enemy or ambush post within 600 px, no street point where it and another rooftop sniper
//     both have a shot; the v0.9B.1 decoy nests are still there
//  B. The extraction assault ('assault' tier, Mission 18 only): 26 (24 Riflemen, 2 Armored Troopers, no Snipers) in six
//     groups from three sides (north, south, west), two pairs entering together, 20 s countdown unchanged; spawn
//     safety with a straggler at the final intersection; extraction the step the helicopter lands, attackers alive;
//     sized for six (a smaller squad, or soldiers lost before the countdown, scale every group down)
//  C. Engagement (seeded, level-14 six-soldier squad, the v09b2-sim attentive player): most attackers reach firing
//     range and fire before the helicopter lands, several are still standing when it does, the squad takes far more
//     fire than in v0.9B.1 (BASE) and still extracts without a KIA
//  D. BASE (v0.9B.1, f4cf5e0): every CFG group identical but `extractionPressure`, whose v0.9B.1 keys are unchanged
//     (only assault* added); every other mission's extraction (tier, points, countdown) and Missions 1-17 identical
//  E. Version 0.9.3 / v0.9B.2, SAVE_VERSION 9; an iPhone SE frame of a revealed new sniper and of the assault renders
//     without page errors (OUT= writes the screenshots for the report)
// Usage: npm test -- v09b2   (or: npx vite preview --port 4173 & BASE=<v0.9B.1 url> node tools/v09b2.cjs)
const fs = require('fs');
const { chromium, URL, BASE, OUT, createChecks, runSuite, openPage, missionSnapshot, V09C } = require('./lib.cjs');
const { setup } = require('./v08c-sim.cjs');
const { play } = require('./v09b2-sim.cjs');

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 100, detailMax: 360 });
  const browser = await chromium.launch();
  const page = await openPage(browser, URL, { seed: 9292 });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. ISOLATED ROOFTOP SNIPERS =================
  const roof = await ev(() => {
    const g = window.game, R = window.__alley.ALLEY_ROOFS, out = { runs: {} };
    let m = T.start('ambush-alley', ['infantry', 'heavy', 'medic']);
    let A = m.mechanic('ambush');
    const roofs = A.defs.flatMap((d) => d.groups.filter((gr) => gr.roof).map((gr) => ({ id: d.id, roof: gr.roof })));
    out.count = roofs.reduce((n, r) => n + r.roof.length, 0);
    out.decoys = A.decoys.length; out.perches = A.perches.length;
    // Main Street never arms them: walk the squad centre along Main Street from the outskirts to the plaza
    out.mainArms = [];
    for (let x = 300; x <= 4600; x += 40) for (const id of ['avenue-roof', 'cache-roof']) { const z = A.defs.find((d) => d.id === id).zone; if (x >= z.x && x <= z.x + z.w && 1400 >= z.y && 1400 <= z.y + z.h) out.mainArms.push(id); }
    // isolation: lines and distances
    const W = g.world, others = Object.entries(R).filter(([k]) => !['avenue', 'cache'].includes(k)).map(([, p]) => p);
    const placed = g.enemies.map((e) => e.pos);
    const posts = A.defs.flatMap((d) => d.groups.flatMap((gr) => gr.posts ?? []));
    const R6 = window.__CFG.enemySniper.range;
    const seen = (p, qs) => qs.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= R6 && W.clear(p, q)).length;
    const shotAt = (p) => { const s = new Set(); for (let x = 20; x < g.map.w; x += 40) for (let y = 20; y < g.map.h; y += 40) { if (!W.isOpen(x, y)) continue; const q = { x, y }; if (Math.hypot(q.x - p.x, q.y - p.y) <= window.__CFG.enemySniper.range && W.clear(p, q)) s.add(`${x},${y}`); } return s; };
    out.iso = {};
    for (const key of ['avenue', 'cache']) {
      const p = R[key], mine = shotAt(p);
      let shared = 0; for (const o of others) { const os = shotAt(o); for (const k of mine) if (os.has(k)) shared++; }
      let main = 0; for (let x = 900; x <= 4400; x += 20) for (let y = 1330; y <= 1470; y += 35) if (Math.hypot(x - p.x, y - p.y) <= window.__CFG.enemySniper.range && W.clear(p, { x, y })) main++;
      out.iso[key] = { street: mine.size, shared, main, nearPlaced: Math.round(Math.min(...placed.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))), nearPost: Math.round(Math.min(...posts.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))), inSight: seen(p, [...placed, ...posts]) };
    }
    // the two new snipers in play: walk in, spring hidden, reveal on a shot, stay revealed, killed from the street
    const plan = {
      'avenue-roof': { at: { x: 1450, y: 2110 }, away: { x: 1080, y: 2110 }, p: R.avenue },
      'cache-roof': { at: { x: 2560, y: 520 }, away: { x: 2380, y: 360 }, p: R.cache },
    };
    for (const [id, P] of Object.entries(plan)) {
      m = T.start('ambush-alley', ['infantry', 'heavy', 'medic']); A = m.mechanic('ambush');
      if (g.story) g.story.skip(g); T.calm(); g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
      const pin = (q) => { T.pinAt(q); g.cam = { ...q }; };
      const st = A.state(id), r = { id };
      // the squad walks into its avenue out of its line first (the far end of the stretch)
      T.step(0.4, () => pin(P.away)); r.armed = st.armedAt >= 0; r.sprungEarly = st.sprungAt >= 0;
      T.step(0.3, () => pin(P.away));
      const u = st.units[0];
      r.spring = { n: st.units.length, hidden: !!u && A.isHidden(u), inEnemies: !!u && g.enemies.includes(u), others: A.log.sprung.filter((x) => x !== id).length };
      if (!u) { out.runs[id] = r; continue; }
      r.side = (A.perches.find((q) => q.pos.x === P.p.x && q.pos.y === P.p.y) || {}).side;
      r.lift = Math.round(u.roofLift);
      // into its line
      const t0 = g.time; let rev = -1, laser = -1, shot = -1, targeted = -1;
      T.stepUntil(() => shot >= 0, 8, () => {
        pin(P.at);
        if (rev < 0 && !A.isHidden(u)) rev = g.time;
        if (rev >= 0 && laser < 0 && u.target && u.aimHeld > 0) laser = g.time;
        if (rev >= 0 && targeted < 0 && g.soldiers.some((s) => s.target === u)) targeted = g.time;
        if (rev >= 0 && shot < 0 && u.shots > 0) shot = g.time;
        if (rev >= 0) u.hp = u.maxHp; // keep it standing until its first shot (the squad shoots back at once)
      });
      const log = A.log.reveals.find((x) => x.id === id) || {};
      r.reveal = { after: +(rev - t0).toFixed(2), why: log.why, aimed: !!log.aimed, laser: +(laser - rev).toFixed(3), first: +(shot - rev).toFixed(2), targeted: +(targeted - rev).toFixed(2), inEnemies: g.enemies.includes(u) };
      T.step(1, () => pin(P.away)); r.stays = !A.isHidden(u) && g.enemies.includes(u) && u.active;
      const kt = T.stepUntil(() => !u.active, 10, () => pin(P.at));
      r.killed = !u.active; r.killT = +kt.toFixed(1); r.byDamage = u.state === 'dead';
      g.invuln = false;
      out.runs[id] = r;
    }
    return out;
  });
  check('A1 Mission 18 has 7 concealed rooftop snipers (was 5) and keeps its 3 decoy nests (10 perches drawn)', roof.count === 7 && roof.decoys === 3 && roof.perches === 10, JSON.stringify({ count: roof.count, decoys: roof.decoys, perches: roof.perches }));
  check('A2 the new snipers belong to the quiet avenues: walking Main Street never arms them', roof.mainArms.length === 0, roof.mainArms.join());
  const iso = roof.iso;
  check('A3 isolated: no line onto Main Street, every placed enemy and crossfire post 400+ px away and none in its sight, no street point where another rooftop sniper also has a shot (no stacked lasers)', ['avenue', 'cache'].every((k) => iso[k].main === 0 && iso[k].shared === 0 && iso[k].nearPlaced >= 400 && iso[k].nearPost >= 400 && iso[k].inSight === 0 && iso[k].street > 40), JSON.stringify(iso));
  for (const id of ['avenue-roof', 'cache-roof']) {
    const r = roof.runs[id] || {};
    check(`A4 ${id}: springs concealed as the squad enters its avenue (no other ambush), on its roof (${r.side}, lifted)`, r.armed && r.spring && r.spring.n === 1 && r.spring.hidden && !r.spring.inEnemies && r.spring.others === 0 && ['front', 'back'].includes(r.side) && r.lift > 10, JSON.stringify({ armed: r.armed, spring: r.spring, side: r.side, lift: r.lift }));
    check(`A5 ${id}: a soldier in its line reveals it already aiming (laser the same step), first shot 2.5-3 s later, targeted by the squad at once`, r.reveal && r.reveal.why === 'sight' && r.reveal.aimed && r.reveal.laser <= 0.02 && r.reveal.first >= 2.5 && r.reveal.first <= 3.0 && r.reveal.targeted >= 0 && r.reveal.targeted <= 0.5 && r.reveal.inEnemies, JSON.stringify(r.reveal));
    check(`A6 ${id}: stays revealed out of its line, and the squad kills it from the street`, r.stays && r.killed && r.byDamage && r.killT < 6, JSON.stringify({ stays: r.stays, killed: r.killed, t: r.killT }));
  }

  // ================= B. EXTRACTION ASSAULT =================
  const ex = await ev(() => {
    const g = window.game, out = {};
    const run = (straggler, squad = ['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], kia = 0) => {
      const m = T.start('ambush-alley', squad);
      if (g.story) g.story.skip(g);
      const A = m.mechanic('ambush'); for (const s of A.states) s.armedAt = s.sprungAt = 0; A.hidden.length = 0;
      T.calm(); g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
      const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      const put = () => { g.soldiers.forEach((s, i) => { s.pos = straggler && i === 5 ? { x: 4060, y: 1400 } : { x: c.x - 50 + (i % 3) * 45, y: c.y - 25 + Math.floor(i / 3) * 50 }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...c }; for (const e of g.enemies) if (e.reinforcement) e.hp = e.maxHp = 1e9; };
      T.step(3, () => { put(); T.calm(); });
      for (const o of m.primaries) o.state = 'complete';
      m.current = m.primaries.length; m.phase = 'toExtraction';
      put();
      for (let i = 0; i < kia; i++) g.soldiers[g.soldiers.length - 1 - i].state = 'kia'; // lost earlier in the mission
      const seen = new Map(), groups = [], banners = [];
      const b0 = g.banner.bind(g); g.banner = (t, ...rest) => { if (/INBOUND|ASSAULT/.test(t)) banners.push(t); return b0(t, ...rest); };
      let t0 = -1, ready = -1, won = -1, firstShot = Infinity;
      for (let i = 0; i < 60 * 30 && g.phase === 'playing'; i++) {
        put(); g.update(1 / 60);
        if (t0 < 0 && m.phase === 'countdown') t0 = g.time - 1 / 60;
        for (const e of g.enemies) {
          if (!e.reinforcement) continue;
          if (!seen.has(e)) {
            seen.set(e, g.time);
            const at = +(g.time - t0).toFixed(2);
            const live = g.soldiers.filter((s) => s.active);
            groups.push({ t: at, kind: e.kind, x: e.pos.x, y: e.pos.y, d: Math.round(Math.min(...live.map((s) => Math.hypot(s.pos.x - e.pos.x, s.pos.y - e.pos.y)))), on: g.isOnScreen(e.pos, 0), open: g.world.isOpen(e.pos.x, e.pos.y) });
          }
          if (e.shots > 0) firstShot = Math.min(firstShot, g.time - seen.get(e));
        }
        if (ready < 0 && m.phase === 'available') ready = g.time - t0;
        if (g.phase === 'won') won = g.time - t0;
      }
      g.banner = b0; g.invuln = false;
      const cd = m.extraction.total();
      const dirOf = (p) => (p.y < z.y - 150 ? 'N' : p.y > z.y + z.h + 150 ? 'S' : p.x < z.x ? 'W' : 'E');
      return { cd, ready: +ready.toFixed(2), won: +won.toFixed(2), end: g.phase, alive: g.enemies.filter((e) => e.reinforcement && e.active).length, spawned: m.pressureSpawned, firstShot: firstShot === Infinity ? null : +firstShot.toFixed(2),
        kinds: groups.reduce((a, x) => { a[x.kind] = (a[x.kind] || 0) + 1; return a; }, {}),
        times: [...new Set(groups.map((x) => x.t))], batches: [...new Set(groups.map((x) => x.t))].map((t) => [...new Set(groups.filter((x) => x.t === t).map(dirOf))].join('')),
        dirs: [...new Set(groups.map(dirOf))].sort().join(''), minD: Math.min(...groups.map((x) => x.d)), on: groups.filter((x) => x.on).length, closed: groups.filter((x) => !x.open).length, banners, tier: m.script.extraction.pressure.tier };
    };
    out.normal = run(false); out.straggler = run(true);
    const n4 = run(false, ['infantry', 'heavy', 'medic', 'sniper']), k2 = run(false, undefined, 2), n5 = run(false, ['infantry', 'heavy', 'medic', 'sniper', 'commando']);
    out.scaled = { four: n4.spawned, fourKinds: n4.kinds, sixLostTwo: k2.spawned, five: n5.spawned, fiveKinds: n5.kinds, fourTimes: n4.times.join('/') };
    return out;
  });
  const P = await ev(() => window.__CFG.extractionPressure);
  const n = ex.normal;
  check('B1 Mission 18 extraction: its own assault tier, 20 s countdown unchanged', n.tier === 'assault' && n.cd === 20, `${n.tier} ${n.cd} s`);
  check('B2 26 attackers: 24 Riflemen and 2 Armored Troopers, no Snipers (existing classes, global stats untouched)', n.spawned === 26 && n.kinds.rifleman === 24 && n.kinds.armored === 2 && !n.kinds.sniper, JSON.stringify(n.kinds) + ` ${n.spawned}`);
  const want = [P.assaultAt, P.assaultWestAt, P.assaultFlankAt, P.assaultFinalAt].map((a) => +(a * 20).toFixed(2));
  check('B3 timing: north + south together as the countdown starts, west at 3 s, both V4 flanks together at 8 s, the final group at 12 s', JSON.stringify(n.times.map((t) => Math.round(t))) === JSON.stringify(want.map((t) => Math.round(t))) && n.batches[0].length >= 2 && n.batches[2].length >= 1, `${n.times.join('/')} want ${want.join('/')} dirs ${n.batches.join('/')}`);
  check('B4 three directions (north, south, west), and simultaneous groups announced in one banner', /N/.test(n.dirs) && /S/.test(n.dirs) && /W/.test(n.dirs) && n.banners.length === 4 && / AND /.test(n.banners[0]), `${n.dirs} | ${n.banners.join(' | ')}`);
  check('B5 fair spawns: off screen, on open ground, 500+ px from every soldier (scatter 70 px), also with a straggler at the final intersection; no shot in the first second', [ex.normal, ex.straggler].every((r) => r.on === 0 && r.closed === 0 && r.minD >= P.minDist - 70 && (r.firstShot === null || r.firstShot >= 1)), `minD ${ex.normal.minD} / straggler ${ex.straggler.minD}, first shot ${ex.normal.firstShot}`);
  check('B6 the helicopter lands at 20 s and the squad extracts that step with attackers still standing (no boarding timer, no kill-all)', Math.abs(n.ready - 20) < 0.05 && n.end === 'won' && Math.abs(n.won - n.ready) < 0.02 && n.alive > 0, `${n.ready}/${n.won} alive ${n.alive}`);

  const sc = ex.scaled;
  check('B7 sized for six: a smaller squad (or two KIA before the countdown) faces proportionally fewer attackers, same timing and directions, troopers kept (5 -> 20, 4 -> 18)', sc.five === 20 && sc.four === 18 && sc.sixLostTwo === 18 && sc.fourKinds.armored === 2 && sc.fiveKinds.armored === 2 && sc.fourTimes === n.times.join('/'), JSON.stringify(sc));

  // ================= C. ENGAGEMENT (seeded, level 14) =================
  const sim = async (url, seed) => {
    const p = await openPage(browser, url, { seed });
    const s = await p.evaluate(setup, { demo: true, level: 14 });
    const r = s.error ? { error: s.error } : await p.evaluate(play, { ids: s.ids });
    r.errors = p.errors.length;
    await p.context().close();
    return r;
  };
  const seeds = [18000, 25919];
  const now = []; for (const sd of seeds) now.push(await sim(URL, sd));
  const avg = (xs, k) => +(xs.reduce((a, x) => a + (x[k] || 0), 0) / xs.length).toFixed(1);
  const fmt = (xs) => xs.map((r) => `${r.spawned}/${r.inRange}/${r.fired}/${r.alive} dmg ${r.dmg} kia ${r.kia} ${r.extracted ? 'out' : 'NO'}`).join('; ');
  check('C1 most attackers fight: 70%+ reach firing range of a standing soldier and 60%+ fire before the helicopter lands (spawned/in range/fired/alive)', now.every((r) => !r.error && r.inRange >= 0.7 * r.spawned && r.fired >= 0.6 * r.spawned), fmt(now));
  check('C2 still attacking at the end: 2+ attackers standing as the helicopter lands, the squad extracts without a KIA', now.every((r) => r.alive >= 2 && r.extracted && r.kia === 0 && r.errors === 0), fmt(now));
  if (BASE) {
    const before = []; for (const sd of seeds) before.push(await sim(BASE, sd));
    check('C3 vs v0.9B.1 (same seeds and squad): at least twice the attackers in firing range and twice the damage taken', avg(now, 'inRange') >= 2 * avg(before, 'inRange') && avg(now, 'dmg') >= 2 * avg(before, 'dmg'), `now ${fmt(now)} | v0.9B.1 ${fmt(before)}`);
  } else check('C3 BASE build available', false, 'BASE not set (npm test serves v0.9B.1)');

  // ================= D. BASE (v0.9B.1) =================
  if (BASE) {
    const pb = await openPage(browser, BASE, { seed: 4242 }), pn = await openPage(browser, URL, { seed: 4242 });
    const before = await pb.evaluate(missionSnapshot), nowS = await pn.evaluate(missionSnapshot);
    const pres = async (pp) => pp.evaluate(() => { const g = window.game, out = {}; window.__debugUnlockAll(); for (const d of window.__campaign.CAMPAIGN.filter((x) => x.playable)) { g.selectMission(d.id, true); g.reset(["infantry"]); const X = g.mission.script.extraction; out[d.id] = JSON.stringify({ p: X.pressure || null, f: X.finalWave ? X.finalWave.points : null, cd: X.countdown(), z: X.zone }); } return out; });
    const pB = await pres(pb), pN = await pres(pn);
    await pb.context().close(); await pn.context().close();
    const cfgDiff = V09C.cfgDiff(Object.keys(nowS.cfg).filter((k) => nowS.cfg[k] !== before.cfg[k])); // v0.9C: prison* set aside
    const EPb = JSON.parse(before.cfg.extractionPressure), EPn = JSON.parse(nowS.cfg.extractionPressure);
    const epChanged = Object.keys(EPb).filter((k) => EPb[k] !== EPn[k]), added = Object.keys(EPn).filter((k) => !(k in EPb));
    check('D1 every CFG group identical to v0.9B.1 but `extractionPressure` (v0.9C prison* set aside), where every v0.9B.1 key is unchanged and only assault* keys are new (other tiers untouched)', cfgDiff.join() === 'extractionPressure' && epChanged.length === 0 && added.every((k) => /^assault/.test(k)), `${cfgDiff.join() || 'none'} changed ${epChanged.join() || '-'} added ${added.join()}`);
    const xDiff = Object.keys(pB).filter((id) => id !== 'ambush-alley' && pB[id] !== pN[id]); // v0.9C: Mission 19 (new) is not in BASE
    check('D2 every other mission\'s extraction (pressure tier and points, scripted waves, countdown, zone) identical to v0.9B.1 (v0.9C / v0.9D add Missions 19 / 20)', Object.keys(pB).every((id) => id in pN) && Object.keys(pN).length - Object.keys(pB).length <= 2 && xDiff.length === 0, xDiff.length ? `${xDiff.join()} e.g. ${pB[xDiff[0]]} vs ${pN[xDiff[0]]}` : `${Object.keys(pN).length} missions`);
    const ids = Object.keys(before.missions).filter((id) => id !== 'ambush-alley');
    const misDiff = ids.filter((id) => V09C.norm(id, before.missions[id]) !== V09C.norm(id, nowS.missions[id])); // v0.9C: Mission 7's name set aside
    check('D3 Missions 1-17 identical to v0.9B.1 (maps, enemies, objectives, story, campaign rows; v0.9C: Mission 7 renamed); Mission 18 keeps its map size, placed enemies, objectives and campaign row (v0.9C: its unlock list set aside)', ids.length === 17 && misDiff.length === 0 && ['enemies', 'obj', 'def', 'zone', 'cd'].every((k) => JSON.stringify(JSON.parse(V09C.norm('ambush-alley', before.missions['ambush-alley']))[k]) === JSON.stringify(JSON.parse(V09C.norm('ambush-alley', nowS.missions['ambush-alley']))[k])), misDiff.join() || `${ids.length} missions`);
  } else check('D BASE build available', false, 'BASE not set');

  // ================= E. VERSION, SAVE, PHONES =================
  const pkg = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8'));
  const saveSrc = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'save.ts'), 'utf8');
  check('E1 package 0.9.3 / label 0.9B.2 or a later release (v0.9C: 0.9.4, checked by v09c J1); SAVE_VERSION 9 (nothing new is saved)', pkg.version >= '0.9.3' && /^0\.9(B\.2|[C-Z])/.test(pkg.versionLabel) && /SAVE_VERSION = 9;/.test(saveSrc) && !/assault|avenue-roof|cache-roof/.test(await ev(() => localStorage.getItem('minisquad.save') || '')), `${pkg.version} ${pkg.versionLabel}`);
  {
    const p2 = await openPage(browser, URL, { seed: 9292, viewport: { width: 667, height: 375 }, context: { deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    const shot = async (name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p2.screenshot({ path: `${OUT}/${name}.png` }); } };
    const r1 = await p2.evaluate(async () => {
      const m = T.start('ambush-alley', ['infantry', 'heavy', 'medic']), g = window.game, A = m.mechanic('ambush');
      if (g.story) g.story.skip(g); T.calm(); g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
      const at = { x: 1450, y: 2110 };
      T.step(1, () => { T.pinAt(at); g.cam = { x: 1600, y: 2050 }; });
      const u = A.state('avenue-roof').units[0]; if (u) u.setMaxHp(1e6);
      T.step(1.2, () => { T.pinAt(at); g.cam = { x: 1600, y: 2050 }; });
      g.paused = false; await new Promise((res) => setTimeout(res, 400));
      return { revealed: !!u && !A.isHidden(u), aiming: !!u && u.aimHeld > 0 };
    });
    await shot('v09b2-iphoneSE-avenue-sniper');
    const r2 = await p2.evaluate(async () => {
      const m = T.start('ambush-alley', ['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']), g = window.game, A = m.mechanic('ambush');
      if (g.story) g.story.skip(g); for (const s of A.states) s.armedAt = s.sprungAt = 0; A.hidden.length = 0; T.calm(); g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
      for (const o of m.primaries) o.state = 'complete';
      m.current = m.primaries.length; m.phase = 'toExtraction';
      T.step(12, () => T.pinAt({ x: 4600, y: 1390 }, 40));
      g.paused = false; await new Promise((res) => setTimeout(res, 400));
      return { live: g.enemies.filter((e) => e.reinforcement && e.active).length, phase: m.phase };
    });
    await shot('v09b2-iphoneSE-extraction-assault');
    check('E2 iPhone SE: a revealed avenue sniper and the extraction assault render without page errors', r1.revealed && r1.aiming && r2.live >= 5 && r2.phase === 'countdown' && p2.errors.length === 0, JSON.stringify({ r1, r2 }) + (p2.errors[0] || ''));
    await p2.context().close();
  }

  const code = finish(page.errors);
  await browser.close();
  return code;
});
