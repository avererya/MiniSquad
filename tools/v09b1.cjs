// v0.9B.1 rule checks: Combat Pacing & Extraction Pressure.
//  A. Extraction pressure: tier per mission (M1 none, M2 intro, M4-5 / M7 / M17 light, M6 / M8 / M9 / M16 standard,
//     M11 restrained, M12 / M18 intense; M3 / M10 keep their scripted wave; M13-15 none), countdowns, never both a
//     scripted wave and pressure; for every pressure mission: groups enter at their share of the countdown (staggered,
//     escalating toward the helicopter), finite, from more than one edge, off screen / open ground / 500+ px away, no
//     shot in the first second, the helicopter on time, the squad extracts the step it is ready with reinforcements
//     still alive (no boarding timer, never a kill-all)
//  B. Concealed rooftop snipers (Mission 18): hidden after the ambush springs (not in Game.enemies: no sprite, HP bar,
//     marker or target), revealed on a firing opportunity already aiming (laser at once, first shot 2.5-3 s later), not
//     revealed without a line, revealed for good, one reveal at a time, a stretch never stalls (revealed once the rest
//     is cleared, or after 30 s), a support strike flushes them; geometry: the perch is the street edge of a building,
//     drawn on that building's roof, its own building never blocks its line, other buildings still do; a frame renders
//  C. Mission 17: 45 placed (pickets on the approaches, reachable), the counterattack before the last installation
//     (cue, 7 enemies 4 s later, off screen, 520+ px, once), skipped when the last installations fall together, the
//     enemy budget (45 + 7 + 12, then light pressure)
//  D. Mission 18: the enemy budget (20 placed + 45 ambush = 65, mostly Riflemen), staggered stretches
//  E. BASE (v0.9B, 2d09342): every CFG group but `extractionPressure` identical; Missions 1-16 identical but for the
//     countdowns V09B1 lists; SAVE_VERSION 9
//  F. Phones: an iPhone SE screenshot of a revealed rooftop sniper (OUT=, for the report)
// Usage: npm test -- v09b1   (or: npx vite preview --port 4173 & BASE=<v0.9B url> node tools/v09b1.cjs)
const fs = require('fs');
const { chromium, URL, BASE, OUT, createChecks, runSuite, openPage, missionSnapshot, V09B1, V09C } = require('./lib.cjs');

const TIERS = {
  'first-contact': null, 'heavy-support': 'intro', 'field-medicine': 'scripted', 'red-canyon': 'light', 'bring-them-home': 'light',
  'bridgehead': 'standard', 'prison-break': 'light', 'convoy-crusher': 'standard', 'blackout': 'standard', 'iron-fist': 'scripted',
  'resistance-rising': 'restrained', 'artillery-hunt': 'intense', 'hold-the-line': null, 'supply-line': null, 'last-stand': null,
  'jungle-sweep': 'standard', 'fuel-for-the-fire': 'light', 'ambush-alley': 'assault', // v0.9B.2 (on purpose): Mission 18's own assault tier (tools/v09b2.cjs)
};

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 100, detailMax: 360 });
  const browser = await chromium.launch();
  const page = await openPage(browser, URL, { seed: 9191 });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. EXTRACTION PRESSURE =================
  const ex = await ev(() => {
    window.__debugUnlockAll();
    const g = window.game, C = window.__campaign, out = { tiers: {}, runs: {} };
    const ids = C.CAMPAIGN.filter((m) => m.playable).map((m) => m.id);
    for (const id of ids) {
      g.selectMission(id, true);
      const X = g.mission.script.extraction;
      out.tiers[id] = { tier: X.pressure ? X.pressure.tier : X.finalWave ? 'scripted' : null, both: !!(X.pressure && X.finalWave), cd: X.countdown(), points: X.pressure ? X.pressure.points.length : 0 };
    }
    for (const id of ids.filter((x) => out.tiers[x].tier && out.tiers[x].tier !== 'scripted')) {
      const m = T.start(id, ['infantry', 'infantry', 'heavy', 'medic', 'sniper', 'commando'].slice(0, C.capacityOf(id)));
      if (g.story) g.story.skip(g);
      g.invuln = true;
      T.calm();
      const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      const put = () => { g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 50 + (i % 3) * 45, y: c.y - 25 + Math.floor(i / 3) * 50 }; s.vel = { x: 0, y: 0 }; }); if (m.npc) { m.npc.escorting = true; m.npc.pos = { x: c.x, y: c.y + 30 }; m.npc.vel = { x: 0, y: 0 }; } g.anchor = { ...c }; for (const e of g.enemies) if (e.reinforcement) { e.hp = e.maxHp = 1e9; } };
      // the squad (and the camera, which follows it and stays inside the map) settles at the pad first
      T.step(3, () => { put(); T.calm(); });
      for (const o of m.primaries) o.state = 'complete';
      m.current = m.primaries.length; m.phase = 'toExtraction';
      put();
      const seen = new Map(), groups = [];
      let t0 = -1, ready = -1, won = -1, firstShot = Infinity;
      for (let i = 0; i < 60 * 45 && g.phase === 'playing'; i++) {
        put(); g.update(1 / 60);
        if (t0 < 0 && m.phase === 'countdown') t0 = g.time - 1 / 60;
        for (const e of g.enemies) {
          if (!e.reinforcement) continue;
          if (!seen.has(e)) {
            seen.set(e, g.time);
            const at = +(g.time - t0).toFixed(3);
            let grp = groups.find((x) => Math.abs(x.t - at) < 0.02);
            if (!grp) { grp = { t: at, n: 0, kinds: [], d: Infinity, on: 0, closed: 0, x: 0, y: 0 }; groups.push(grp); }
            grp.n++; grp.kinds.push(e.kind); grp.x += e.pos.x; grp.y += e.pos.y;
            grp.d = Math.min(grp.d, ...g.soldiers.map((s) => Math.hypot(s.pos.x - e.pos.x, s.pos.y - e.pos.y)));
            if (g.isOnScreen(e.pos, 0)) grp.on++;
            if (!g.world.isOpen(e.pos.x, e.pos.y)) grp.closed++;
          }
          if (e.shots > 0) firstShot = Math.min(firstShot, g.time - seen.get(e));
        }
        if (ready < 0 && m.phase === 'available') ready = g.time - t0;
        if (g.phase === 'won') won = g.time - t0;
      }
      const alive = g.enemies.filter((e) => e.reinforcement && e.active).length;
      out.runs[id] = {
        len: m.extraction.total(), ready: +ready.toFixed(3), won: +won.toFixed(3), alive, firstShot: firstShot === Infinity ? null : +firstShot.toFixed(2),
        groups: groups.map((x) => ({ t: x.t, n: x.n, kinds: x.kinds.sort().join(), d: Math.round(x.d), on: x.on, closed: x.closed, c: `${Math.round(x.x / x.n / 100)},${Math.round(x.y / x.n / 100)}` })),
        spawned: m.pressureSpawned, end: g.phase,
      };
      g.invuln = false;
    }
    const P = window.__CFG.extractionPressure;
    out.P = P;
    return out;
  });
  const tierOk = Object.entries(TIERS).filter(([id, t]) => !ex.tiers[id] || ex.tiers[id].tier !== t);
  check('A1 tiers: M1 none, M2 intro, M4 / M5 / M7 / M17 light, M6 / M8 / M9 / M16 standard, M11 restrained, M12 intense, M18 assault (v0.9B.2); M3 / M10 scripted; M13-15 none (v0.9C: M19 none, its own last stand)', tierOk.length === 0 && Object.keys(ex.tiers).length === 19 && !!ex.tiers['jungle-prison'] && !ex.tiers['jungle-prison'].tier, tierOk.map(([id, t]) => `${id}:${ex.tiers[id] && ex.tiers[id].tier}!=${t}`).join(' ') || Object.entries(ex.tiers).map(([id, t]) => `${id}:${t.tier || '-'}`).join(' '));
  check('A2 never both a scripted final wave and pressure', Object.values(ex.tiers).every((t) => !t.both));
  const cds = { 'first-contact': 6, 'heavy-support': 12, 'field-medicine': 20, 'iron-fist': 8, 'resistance-rising': 12, 'hold-the-line': 10, 'supply-line': 12, 'last-stand': 10, ...V09B1.countdowns };
  check('A3 countdowns: light keeps the mission\'s own (12 s), standard 15 s, intense 20 s; the others unchanged', Object.entries(cds).every(([id, c]) => ex.tiers[id].cd === c), Object.entries(ex.tiers).map(([id, t]) => `${id}:${t.cd}`).join(' '));
  const P = ex.P;
  const plan = {
    intro: [[0, P.intro]], restrained: [[P.restrainedDelay, P.restrained]],
    light: [[P.lightAAt, P.lightA], [P.lightBAt, P.lightB]],
    standard: [[P.standardAAt, P.standardA], [P.standardBAt, P.standardB], [P.standardCAt, P.standardC]],
    intense: [[P.intenseAAt, P.intenseA], [P.intenseBAt, P.intenseB], [P.intenseCAt, P.intenseC]],
    // v0.9B.2 Mission 18: groups entering together count as one here (north + south, then both V4 flanks)
    assault: [[P.assaultAt, P.assaultNorth + P.assaultSouth], [P.assaultWestAt, P.assaultWest], [P.assaultFlankAt, 2 * P.assaultFlank], [P.assaultFinalAt, P.assaultFinal]],
  };
  const runs = Object.entries(ex.runs);
  const timing = runs.filter(([id, r]) => {
    const t = ex.tiers[id].tier, want = plan[t];
    if (r.groups.length !== want.length) return true;
    return want.some(([at, n], i) => { const sec = t === 'intro' || t === 'restrained' ? at : at * r.len; return Math.abs(r.groups[i].t - sec) > 0.05 || r.groups[i].n !== n; });
  });
  check('A4 staggered: every group enters at its share of the countdown with its size (light 15% / 55%, standard 15 / 45 / 75%, intense 20 / 45 / 75%, M18 assault 0 / 15 / 40 / 60%; intro / restrained as in v0.8A)', timing.length === 0, (timing.length ? 'wrong: ' + timing.map(([id]) => id).join() + ' ' : '') + runs.map(([id, r]) => `${id}:${r.groups.map((x) => `${x.n}@${x.t}`).join('/')}`).join(' '));
  const esc = runs.filter(([id]) => ['standard', 'intense'].includes(ex.tiers[id].tier));
  check('A5 escalation: standard / intense put their last group in the final quarter of the countdown (the final assault), intense brings snipers and armored troopers', esc.every(([, r]) => r.groups[r.groups.length - 1].t >= 0.7 * r.len) && runs.filter(([id]) => ex.tiers[id].tier === 'intense').every(([, r]) => /sniper/.test(r.groups.map((x) => x.kinds).join()) && /armored/.test(r.groups[2].kinds)), esc.map(([id, r]) => `${id}:${r.groups.map((x) => x.kinds).join('|')}`).join(' '));
  const sum = (t) => plan[t].reduce((a, [, n]) => a + n, 0);
  check('A6 finite: each mission spawns exactly its tier (intro 3, light 5, standard 8, intense 13, restrained 3, M18 assault 26), nothing more while the helicopter waits', runs.every(([id, r]) => r.spawned === sum(ex.tiers[id].tier)), runs.map(([id, r]) => `${id}:${r.spawned}`).join(' '));
  const dirs = runs.filter(([, r]) => r.groups.length >= 2);
  check('A7 more than one approach: every multi-group tier uses at least two different edges', dirs.every(([, r]) => new Set(r.groups.map((x) => x.c)).size >= 2), dirs.map(([id, r]) => `${id}:${[...new Set(r.groups.map((x) => x.c))].join('/')}`).join(' '));
  check('A8 fair spawns: off screen, on open ground, each group\'s point 500+ px from every soldier (units scatter up to 70 px around it); no reinforcement fires within its first second', runs.every(([, r]) => r.groups.every((x) => x.on === 0 && x.closed === 0 && x.d >= P.minDist - 70)) && runs.every(([, r]) => r.firstShot === null || r.firstShot >= 1), runs.map(([id, r]) => `${id}:${Math.min(...r.groups.map((x) => x.d))}/${r.firstShot}${r.groups.some((x) => x.on || x.closed) ? ' BAD ' + JSON.stringify(r.groups.filter((x) => x.on || x.closed)) : ''}`).join(' '));
  check('A9 the helicopter arrives on time and the squad (all in the zone) extracts the same step, with reinforcements still alive: no boarding timer, never a kill-all', runs.every(([, r]) => Math.abs(r.ready - r.len) < 0.05 && r.end === 'won' && Math.abs(r.won - r.ready) < 0.02 && r.alive > 0), runs.map(([id, r]) => `${id}:${r.ready}/${r.won}/${r.alive}`).join(' '));

  // ================= B. CONCEALED ROOFTOP SNIPERS =================
  const roof = await ev(() => {
    const out = {};
    const m = T.start('ambush-alley', ['infantry', 'heavy', 'medic']), g = window.game, A = m.mechanic('ambush'), C = window.__CFG.enemySniper;
    if (g.story) g.story.skip(g); T.calm(); g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
    const R = window.__alley.ALLEY_ROOFS;
    // out of every sniper's line: the street west of V2 (buildings in between)
    const safe = { x: 2020, y: 1100 };
    const pin = (p) => { T.pinAt(p); g.cam = { ...p }; };
    pin(safe);
    const st = A.state('rooftops');
    A.spring(m, g, st);
    const us = st.units;
    for (const u of us) u.setMaxHp(1e6); // they live long enough to fire (the squad shoots back)
    out.spring = { n: us.length, hidden: us.filter((u) => A.isHidden(u)).length, inEnemies: us.filter((u) => g.enemies.includes(u)).length };
    T.step(3, () => pin(safe));
    out.noLine = { hidden: A.hidden.length, targeted: g.soldiers.filter((s) => s.target && us.includes(s.target)).length, marker: (() => { const p = m.objectivePoint(g); return !!p && us.some((u) => Math.hypot(u.pos.x - p.pos.x, u.pos.y - p.pos.y) < 2); })() };
    // a soldier steps into the north sniper's line on Main Street
    const spot = { x: 2470, y: 1400 };
    const t0 = g.time; let revealAt = -1, laserAt = -1, shotAt = -1, second = -1; const order = [];
    const north = us.find((u) => u.pos.x === R.north.x && u.pos.y === R.north.y);
    T.step(12, () => {
      pin(spot);
      for (const u of us) if (!A.isHidden(u) && !order.includes(u)) { order.push(u); if (order.length === 2) second = g.time; }
      if (revealAt < 0 && order.length) revealAt = g.time;
      const f = order[0];
      if (f && laserAt < 0 && f.target && f.aimHeld > 0) laserAt = g.time;
      if (f && shotAt < 0 && f.shots > 0) shotAt = g.time;
    });
    const f = order[0];
    out.reveal = { after: +(revealAt - t0).toFixed(2), laser: +(laserAt - revealAt).toFixed(3), first: +(shotAt - revealAt).toFixed(2), gap: +(second - revealAt).toFixed(2), inEnemies: f ? g.enemies.includes(f) : false, aimedAtSoldier: !!(f && A.log.reveals[0] && A.log.reveals[0].aimed), bonus: A.glint, aim: C.aimTime, n: order.length };
    // walk away out of its line: it stays revealed
    T.step(3, () => pin(safe));
    out.stays = { revealed: order.every((u) => !A.isHidden(u) && g.enemies.includes(u)) };
    // geometry: the perch is at the street edge of a building and the sniper is drawn on that roof
    out.geo = A.perches.map((p) => {
      const b = g.map.obstacles.find((o) => o.kind === 'building' && p.pos.x >= o.x && p.pos.x <= o.x + o.w && (Math.abs(p.pos.y - (o.y + o.h)) <= 24 || Math.abs(p.pos.y - o.y) <= 24));
      if (!b) return { ok: false, p: p.pos };
      const feet = p.pos.y - p.lift, top = b.y - b.height, bottom = b.y + b.h - b.height;
      const below = p.side === 'front' ? { x: p.pos.x, y: p.pos.y + 140 } : { x: p.pos.x, y: p.pos.y - 140 };
      const sniper = Object.values(R).some((q) => q.x === p.pos.x && q.y === p.pos.y); // decoy nests have no perch strip
      return { ok: feet > top && feet < bottom && (!sniper || !g.world.isOpen(p.pos.x, p.pos.y)) && g.world.clear(p.pos, below), side: p.side, lift: p.lift, sniper, p: p.pos, feet, top, bottom, walk: g.world.isOpen(p.pos.x, p.pos.y), line: g.world.clear(p.pos, below) };
    });
    // an unrelated building blocks it: north perch vs a point behind the block west of V3 on South Avenue
    out.blocked = !g.world.clear(R.north, { x: 2300, y: 2110 }) && !g.world.clear(R.south, { x: 2300, y: 690 });
    // a stretch never stalls: everything else of the final intersection down -> its hidden sniper shows itself
    const fs = A.state('final-roof');
    A.spring(m, g, fs);
    for (const o of m.primaries.slice(0, 4)) o.state = 'complete';
    m.current = 4; m.primaries[4].activate(m, g); m.phase = m.primaries[4].phase;
    for (const id of ['final-wave', 'final-wave-2']) A.spring(m, g, A.state(id));
    pin({ x: 2600, y: 690 }); // far away, no line
    T.kill((e) => /^final/.test(e.tag || ''));
    T.step(0.5, () => pin({ x: 2600, y: 690 }));
    out.stall = { hiddenLeft: A.hiddenOf(['final-roof']).length, why: (A.log.reveals.find((r) => r.id === 'final-roof') || {}).why, cur: m.currentObjective && m.currentObjective.id };
    // a support strike over a perch flushes a hidden sniper out
    const cs = A.state('courtyard-roof'); A.spring(m, g, cs);
    const before = A.hiddenOf(['courtyard-roof']).length;
    A.supportStrike(m, g, { ...R.court }, 140);
    out.support = { before, after: A.hiddenOf(['courtyard-roof']).length, why: (A.log.reveals.find((r) => r.id === 'courtyard-roof') || {}).why };
    g.invuln = false;
    return out;
  });
  check('B1 concealed: when the rooftop ambush springs its 3 snipers are not in the enemy list (no sprite, HP bar or marker, never a target)', roof.spring.n === 3 && roof.spring.hidden === 3 && roof.spring.inEnemies === 0 && roof.noLine.targeted === 0 && !roof.noLine.marker, JSON.stringify({ ...roof.spring, ...roof.noLine }));
  check('B2 no line, no reveal: with every soldier out of their lines they stay hidden', roof.noLine.hidden === 3, JSON.stringify(roof.noLine));
  check('B3 a firing opportunity reveals a sniper already aiming at that soldier: laser and sprite in the same step, first shot 2.5-3 s later', roof.reveal.n >= 1 && roof.reveal.inEnemies && roof.reveal.aimedAtSoldier && roof.reveal.laser <= 0.02 && roof.reveal.first >= 2.5 && roof.reveal.first <= 3.0, JSON.stringify(roof.reveal));
  check('B4 one reveal at a time: a second sniper with a shot shows itself 1.5 s or more after the first', roof.reveal.n >= 2 && roof.reveal.gap >= 1.5 - 0.02, JSON.stringify(roof.reveal));
  check('B5 revealed for good: stepping back out of its line does not hide it again', roof.stays.revealed, JSON.stringify(roof.stays));
  check('B6 geometry: every perch (snipers and decoy nests) is the street edge of a building, unwalkable, drawn inside that building\'s roof; its own building never blocks its line to the street', roof.geo.length >= 5 && roof.geo.every((x) => x.ok), JSON.stringify(roof.geo.filter((x) => !x.ok)) + ` ${roof.geo.length} perches`);
  check('B7 other buildings still block a rooftop sniper (no shots through unrelated blocks)', roof.blocked);
  check('B8 a stretch never stalls: with the rest of the final intersection down its hidden sniper shows itself (and must be beaten)', roof.stall.hiddenLeft === 0 && roof.stall.why === 'cleared' && roof.stall.cur === 'final', JSON.stringify(roof.stall));
  check('B9 an airstrike over a perch flushes its hidden sniper out before the damage lands', roof.support.before === 1 && roof.support.after === 0 && roof.support.why === 'support', JSON.stringify(roof.support));

  // the timer fallback: nobody ever gets a line -> shown 30 s after its ambush sprang
  const timer = await ev(() => {
    const m = T.start('ambush-alley', ['infantry']), g = window.game, A = m.mechanic('ambush');
    if (g.story) g.story.skip(g); T.calm(); g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
    const p = { x: 2020, y: 1100 }; T.pinAt(p); g.cam = { ...p };
    A.spring(m, g, A.state('rooftops'));
    T.step(29.5, () => { T.pinAt(p); g.cam = { ...p }; }); const at29 = A.hidden.length;
    T.step(1, () => { T.pinAt(p); g.cam = { ...p }; });
    return { at29, at31: A.hidden.length, why: [...new Set(A.log.reveals.map((r) => r.why))].join() };
  });
  check('B10 a sniper that never gets a shot shows itself 30 s after its ambush sprang', timer.at29 === 3 && timer.at31 === 0 && timer.why === 'timer', JSON.stringify(timer));

  // render: a revealed rooftop sniper, its laser and nest draw without errors (and an iPhone SE shot for the report)
  {
    const p2 = await openPage(browser, URL, { seed: 9191, viewport: { width: 667, height: 375 }, context: { deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    const r = await p2.evaluate(async () => {
      const m = T.start('ambush-alley', ['infantry', 'heavy', 'medic']), g = window.game, A = m.mechanic('ambush');
      if (g.story) g.story.skip(g); T.calm(); g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
      const spot = { x: 2470, y: 1400 };
      A.spring(m, g, A.state('rooftops'));
      for (const u of A.state('rooftops').units) u.setMaxHp(1e6); // the screenshot needs them alive
      T.step(1.2, () => { T.pinAt(spot); g.cam = { x: 2600, y: 1360 }; });
      const out = { revealed: 3 - A.hidden.length, aiming: g.enemies.filter((e) => e.rooftop && e.aimHeld > 0).length };
      g.paused = false; // a few real frames through the normal render loop
      await new Promise((res) => setTimeout(res, 400));
      return out;
    });
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p2.screenshot({ path: `${OUT}/v09b1-iphoneSE-rooftop-sniper.png` }); }
    check('B11 a frame with a revealed, aiming rooftop sniper renders on an iPhone SE without page errors', r.revealed >= 1 && r.aiming >= 1 && p2.errors.length === 0, JSON.stringify(r) + (p2.errors[0] || ''));
    await p2.context().close();
  }

  // ================= C. MISSION 17 =================
  const m17 = await ev(() => {
    const out = {};
    let m = T.start('fuel-for-the-fire', ['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']), g = window.game;
    if (g.story) g.story.skip(g);
    const W = g.world, free = (() => { const seen = new Uint8Array(W.cols * W.rows), st = g.map.start, q = [W.idx(st.x, st.y)]; seen[q[0]] = 1; while (q.length) { const i = q.pop(), c = i % W.cols, r = (i - c) / W.cols; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= W.cols || nr >= W.rows) continue; const j = nr * W.cols + nc; if (!seen[j] && !W.blocked[j]) { seen[j] = 1; q.push(j); } } } return seen; })();
    const placed = g.enemies.filter((e) => !e.structure);
    out.placed = placed.length; out.pickets = placed.filter((e) => /^picket/.test(e.tag)).length;
    out.unreach = placed.filter((e) => !free[W.idx(e.pos.x, e.pos.y)]).map((e) => e.tag);
    out.from = m.mechanic('counterattack').def.from.filter((p) => !free[W.idx(p.x, p.y)]).length;
    out.pressure = m.script.extraction.pressure.points.filter((p) => !free[W.idx(p.x, p.y)]).length;
    // the counterattack: C and B burn, the squad near A
    T.calm((e) => e.structure === 'fuel'); g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
    const d = m.mechanic('fuel'), CA = m.mechanic('counterattack');
    const at = { x: 600, y: 2100 }; const pin = () => { T.pinAt(at); g.cam = { ...at }; };
    pin(); const z = m.primaries[0].zone; T.pinAt({ x: z.x + 100, y: z.y + 140 }); T.step(0.5, () => T.pinAt({ x: z.x + 100, y: z.y + 140 }));
    g.story.log.length = 0;
    for (const t of d.tanks.filter((k) => k.group === 'C')) d.explode(g, t); T.step(0.5, pin);
    out.afterOne = { armed: CA.armedAt >= 0 };
    for (const t of d.tanks.filter((k) => k.group === 'B')) d.explode(g, t); T.step(0.5, pin);
    out.armed = { armed: CA.armedAt >= 0, site: CA.site, cue: /m17-counter/.test(g.story.log.join()), sprung: CA.sprungAt >= 0 };
    T.step(4, pin);
    const live = g.soldiers;
    out.wave = { sprung: CA.sprungAt >= 0, lead: +(CA.sprungAt - CA.armedAt).toFixed(2), n: CA.units.length, kinds: CA.units.map((u) => u.kind).sort().join(), on: CA.units.filter((u) => g.isOnScreen(u.pos, 0)).length, d: Math.round(Math.min(...CA.units.map((u) => Math.min(...live.map((s) => Math.hypot(s.pos.x - u.pos.x, s.pos.y - u.pos.y)))))) };
    T.step(10, pin); out.once = CA.units.length;
    // skipped when the last two installations fall together
    m = T.start('fuel-for-the-fire', ['infantry']); if (g.story) g.story.skip(g); T.calm((e) => e.structure === 'fuel'); g.invuln = true;
    const d2 = m.mechanic('fuel'), CA2 = m.mechanic('counterattack');
    T.pinAt({ x: z.x + 100, y: z.y + 140 }); T.step(0.5, () => T.pinAt({ x: z.x + 100, y: z.y + 140 }));
    for (const t of d2.tanks.filter((k) => k.group === 'A')) d2.explode(g, t); T.step(0.5);
    d2.supportStrike(m, g, null, Infinity); T.step(6);
    out.skip = { armed: CA2.armedAt >= 0, sprung: CA2.units.length, cur: m.currentObjective && m.currentObjective.id };
    g.invuln = false;
    return out;
  });
  check('C1 Mission 17: 45 placed (11 on pickets along the approaches), every placed enemy, counterattack entry and pressure point reachable', m17.placed === 45 && m17.pickets === 11 && m17.unreach.length === 0 && m17.from === 0 && m17.pressure === 0, JSON.stringify({ placed: m17.placed, pickets: m17.pickets, unreach: m17.unreach, from: m17.from, pressure: m17.pressure }));
  check('C2 the counterattack arms only once two installations are down (Overwatch warns at once) and names the last one', !m17.afterOne.armed && m17.armed.armed && m17.armed.site === 'A' && m17.armed.cue && !m17.armed.sprung, JSON.stringify({ one: m17.afterOne, two: m17.armed }));
  check('C3 4 s later 7 enemies (Riflemen and an Armored Trooper) come in off screen and 520+ px from every soldier, once', m17.wave.sprung && Math.abs(m17.wave.lead - 4) < 0.05 && m17.wave.n === 7 && m17.wave.kinds === 'armored,rifleman,rifleman,rifleman,rifleman,rifleman,rifleman' && m17.wave.on === 0 && m17.wave.d >= 520 && m17.once === 7, JSON.stringify(m17.wave));
  check('C4 no softlock / no orphan wave: when the last two installations fall together the counterattack never comes', !m17.skip.armed && m17.skip.sprung === 0 && m17.skip.cur === 'response', JSON.stringify(m17.skip));
  check('C5 Mission 17 enemy budget: 45 placed + 7 counterattack + 12 response = 64 required at most, then 5 (light pressure, never required)', m17.placed + 7 + 12 === 64 && ex.runs['fuel-for-the-fire'].spawned === 5, `${m17.placed} + 7 + 12, pressure ${ex.runs['fuel-for-the-fire'].spawned}`);

  // ================= D. MISSION 18 =================
  const m18 = await ev(() => {
    const m = T.start('ambush-alley', ['infantry']), g = window.game, A = m.mechanic('ambush');
    const kinds = {}; const add = (k) => { kinds[k] = (kinds[k] || 0) + 1; };
    for (const e of g.enemies) add(e.kind);
    const stretch = {};
    for (const d of A.defs) for (const gr of d.groups) for (const k of gr.kinds) add(k);
    const amb = (ids) => A.defs.filter((d) => ids.includes(d.id)).reduce((n, d) => n + d.groups.reduce((a, gr) => a + gr.kinds.length, 0), 0);
    const tag = (t) => g.enemies.filter((e) => e.tag === t).length;
    stretch.first = amb(['first', 'first-flank']) + tag('street-post');
    stretch.cross = amb(['crossfire', 'crossfire-late']);
    stretch.roofs = amb(['rooftops']) + tag('sniper-street');
    stretch.rear = amb(['rear', 'rear-2']);
    stretch.court = amb(['courtyard-roof', 'courtyard-wave']) + tag('courtyard');
    stretch.final = amb(['final-roof', 'final-wave', 'final-wave-2']) + tag('final');
    const roofs = A.defs.flatMap((d) => d.groups.filter((gr) => gr.roof)).reduce((n, gr) => n + gr.kinds.length, 0);
    return { placed: g.enemies.length, total: g.enemies.length + amb(A.defs.map((d) => d.id)), kinds, stretch, roofs, delays: A.defs.map((d) => `${d.id}:${d.delay}`).join(' ') };
  });
  // v0.9B.2 (on purpose): + two isolated rooftop snipers off Main Street (67, 7 concealed; tools/v09b2.cjs)
  check('D1 Mission 18 enemy budget: 20 placed + 47 from ambushes = 67 (v0.9B.1 65, v0.9B 43), 49 of them Riflemen, 7 concealed rooftop snipers', m18.total === 67 && m18.placed === 20 && m18.kinds.rifleman === 49 && m18.roofs === 7, JSON.stringify({ total: m18.total, kinds: m18.kinds, roofs: m18.roofs }));
  check('D2 stretches near the design targets: opening 12, crossfire 13, rooftops 6, rear 8, courtyard 12, final 14', JSON.stringify(m18.stretch) === JSON.stringify({ first: 12, cross: 13, roofs: 6, rear: 8, court: 12, final: 14 }), JSON.stringify(m18.stretch) + ' ' + m18.delays);

  // ================= E. BASE (v0.9B) =================
  const sv = +((fs.readFileSync(__dirname + '/../src/save.ts', 'utf8').match(/SAVE_VERSION = (\d+)/) || [])[1]);
  check('E1 save format unchanged: SAVE_VERSION 9 (nothing about pressure or snipers is saved)', sv === 9 && !/pressure|hidden|reveal/i.test(await ev(() => localStorage.getItem('minisquad.save') || '')), `SAVE_VERSION ${sv}`);
  if (BASE) {
    const bp = await openPage(browser, BASE, { seed: 4242 });
    const before = await bp.evaluate(missionSnapshot);
    await bp.context().close();
    const np = await openPage(browser, URL, { seed: 4242 });
    const now = await np.evaluate(missionSnapshot);
    await np.context().close();
    const cfgDiff = V09C.cfgDiff(Object.keys({ ...before.cfg, ...now.cfg }).filter((k) => before.cfg[k] !== now.cfg[k])); // v0.9C: prison* set aside
    check('E2 every CFG group identical to v0.9B except `extractionPressure` (v0.9C prison* set aside)', cfgDiff.join() === 'extractionPressure', cfgDiff.join() || 'none');
    const ids = Object.keys(before.missions).filter((id) => id !== 'fuel-for-the-fire' && id !== 'ambush-alley');
    const misDiff = ids.filter((id) => V09B1.normCd(id, V09C.norm(id, before.missions[id])) !== V09B1.normCd(id, V09C.norm(id, now.missions[id]))); // v0.9C: Mission 7's name set aside
    const cdDiff = ids.filter((id) => V09C.norm(id, before.missions[id]) !== V09C.norm(id, now.missions[id]));
    check('E3 Missions 1-16 identical to v0.9B but for the countdowns of the missions whose pressure changed (maps, enemies, objectives, story, campaign rows)', ids.length === 16 && misDiff.length === 0 && cdDiff.every((id) => V09B1.countdowns[id] !== undefined), misDiff.length ? `changed: ${misDiff.join()}` : `countdowns changed: ${cdDiff.join()}`);
    const m17 = (x) => JSON.parse(x).enemies.length;
    check('E4 Missions 17-18: more enemies placed than in v0.9B (pickets; the courtyard and final keep theirs), campaign rows unchanged (v0.9C: Mission 18\'s unlock list set aside)', m17(now.missions['fuel-for-the-fire']) > m17(before.missions['fuel-for-the-fire']) && JSON.parse(V09C.norm('ambush-alley', now.missions['ambush-alley'])).def === JSON.parse(V09C.norm('ambush-alley', before.missions['ambush-alley'])).def && JSON.parse(now.missions['fuel-for-the-fire']).def === JSON.parse(before.missions['fuel-for-the-fire']).def, `${m17(before.missions['fuel-for-the-fire'])} -> ${m17(now.missions['fuel-for-the-fire'])}`);
  } else check('E BASE build available', false, 'BASE not set (npm test serves v0.9B)');

  const errs = [...page.errors];
  await browser.close();
  return finish(errs);
});
