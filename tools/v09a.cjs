// v0.9A rule checks: Chapter 4, Mission 16 "Jungle Sweep" and the reusable MineField mechanic (src/mines.ts).
//  A. Campaign: Chapter 4 "Behind Enemy Lines" holds Mission 16 only; it unlocks on the first Mission 15 win (not a
//     failure, not a replay); its row (objectives, optional, stars, briefing); no Mission 17+
//  B. Map safety: no mine near the landing zone, every mine on open ground the squad can reach, a route from the
//     landing zone to every checkpoint defender and the helicopter that never enters a mine's blast ring
//  C. Mine states: hidden at the start, revealed at CFG.mine.detectRadius by a standing soldier, stays revealed
//  D. Triggers: soldiers and enemies on foot set a mine off, hidden or revealed; structures never; no path avoidance
//  E. Blast: both teams, falloff, cover, Armored Troopers take it in full (no frontal plate), Elite reduction, never a
//     one-hit kill from full HP, no kill credit / stats, the mine-ambush optional counts the enemies it kills
//  F. Targeting: a revealed mine is never an automatic target (rounds aimed elsewhere pass over it); a tap / click
//     orders the squad to shoot it (range and sight), it then goes off once; the order ends with the mine or its time;
//     Game.onTap, a mouse click, a touch tap on either half; a drag / the joystick never orders
//  G. Detonation: once per mine; chains reach armed mines in sight within chainRadius, after chainDelay, and end;
//     no chain through a wall; a grenade sets a revealed mine off
//  H. Mission flow: objectives in order, the radio warning, the checkpoint cue, extraction, rewards, stars, replay
//  I. Attempts: Retry / a reload builds a fresh field (nothing about mines is saved); every save fixture loads
//  J. BASE (v0.8C.1, 924dc13): every CFG group but `mine` and Missions 1-15 identical (only Mission 15's unlock list
//     names Mission 16 now)
//  K. Phones (iPhone SE / 14 / Pixel 7 landscape): the mine tap area is at least 44 CSS px; a real touch tap orders
// Usage: npm test -- v09a   (or: npx vite preview --port 4173 & BASE=<v0.8C.1 url> node tools/v09a.cjs)
const fs = require('fs');
const { chromium, URL, BASE, createChecks, runSuite, openPage, missionSnapshot } = require('./lib.cjs');

/** Page-side: Mission 16 helpers on top of window.T (tools/lib.cjs). */
function installMineHelpers() {
  const add = () => {
    if (!window.T || window.T.m16) return;
    const more = {
      get a() { return window.__account(); },
      get R() { return window.game.roster; },
      /** A clear patch of clearing A (no placed mine within 700 px once the field is replaced). */
      LAB: { x: 860, y: 2120 },
      still() { window.game.input.move = () => ({ x: 0, y: 0 }); },
      /** Mission 16 with a generic squad; `calm` removes every placed enemy (towers too). */
      m16(squad = ['infantry', 'heavy', 'medic'], calm = true) {
        const m = this.start('jungle-sweep', squad), g = window.game;
        if (calm) this.calm();
        this.still();
        if (g.story) g.story.skip(g);
        return { g, m, mf: m.mechanic('mines') };
      },
      /** Replace this attempt's field with one at `points` (the same class, so the same rules). */
      lab(points, tuning) {
        const g = window.game, m = g.mission, F = m.mechanic('mines').constructor;
        const f = new F({ mines: points, tuning });
        m.mechanics = m.mechanics.map((x) => (x.id === 'mines' ? f : x));
        return f;
      },
      at(p, list) { const g = window.game; this.pinAt(p, 30, list); g.cam = { ...p }; },
      /** A target dummy (huge HP, never fires). */
      dummy(p, kind = 'rifleman') { const e = window.game.spawnEnemy({ ...p }, kind); e.setMaxHp(1e5); e.guard = true; e.aggro = 1; e.fireCooldown = 1e9; return e; },
      /** The checkpoint's concrete back wall (x 4204-4220, y 976-1324): a lane across it at y 1250, west / east of it. */
      WALL: { y: 1250, west: 4150, east: 4240 },
      /** World point -> client (CSS) point on the page, for real mouse / touch events. */
      client(p) {
        const r = document.getElementById('stage').getBoundingClientRect(), s = this.screenOf(p);
        return { x: r.left + (s.x / 1280) * r.width, y: r.top + (s.y / 720) * r.height, scale: r.width / 1280 };
      },
      /** Flood fill on world W's nav grid from `a`, with extra blocked cells (findPath gives up on long routes). */
      fill(W, a, extra) {
        const seen = new Uint8Array(W.cols * W.rows), q = [W.idx(a.x, a.y)]; seen[q[0]] = 1;
        while (q.length) {
          const i = q.pop(), c = i % W.cols, r = (i - c) / W.cols;
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= W.cols || nr >= W.rows) continue;
            const j = nr * W.cols + nc; if (!seen[j] && !W.blocked[j] && !(extra && extra[j])) { seen[j] = 1; q.push(j); }
          }
        }
        return seen;
      },
      extract(maxSec = 40) {
        const g = window.game, m = g.mission, z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
        this.calm(); this.still();
        const put = () => [...g.soldiers, ...g.allies].forEach((s, i) => { if (s.active) { s.pos = { x: c.x - 60 + (i % 4) * 40, y: c.y - 40 + Math.floor(i / 4) * 40 }; s.vel = { x: 0, y: 0 }; } });
        put(); g.anchor = { ...c };
        return this.stepUntil(() => g.phase !== 'playing', maxSec, put);
      },
      deploy(ids, mission) {
        const g = window.game; g.selectMission(mission, true);
        const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
        this.still();
        return r;
      },
    };
    Object.defineProperties(window.T, Object.getOwnPropertyDescriptors(more)); // keeps the getters live
  };
  add();
  // window.T is installed by lib.cjs's init script (registered before this one)
  if (!window.T) document.addEventListener('DOMContentLoaded', add);
}

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 100, detailMax: 360 });
  const browser = await chromium.launch();
  const errors = [];
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 720 }, ...(opts.context || {}) });
    await ctx.addInitScript(require('./lib.cjs').installPageHelpers);
    await ctx.addInitScript(installMineHelpers);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(opts.url || URL); await page.evaluate((raw) => { localStorage.clear(); if (raw) localStorage.setItem('minisquad.save', raw); }, opts.save || null);
    await page.goto(opts.url || URL); await page.waitForFunction(() => !!window.game && !!window.T);
    return page;
  };
  const page = await open();
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const C = await ev(() => window.__CFG.mine);

  // ================= A. CAMPAIGN =================
  const camp = await ev(() => {
    const locked = !window.__account().campaign.unlockedMissions.includes('jungle-sweep');
    const Cm = window.__campaign, d = Cm.CAMPAIGN.find((x) => x.id === 'jungle-sweep'), m15 = Cm.CAMPAIGN.find((x) => x.id === 'last-stand');
    const ch = Cm.CHAPTERS.map((c) => `${c.number}:${c.name}:${c.from}-${c.to === Infinity ? 'inf' : c.to}`);
    T.start('jungle-sweep'); const m = window.game.mission;
    return {
      d: d && { number: d.number, playable: d.playable, type: d.type, opt: d.optional.map((o) => o.id + ':' + o.label), stars: JSON.stringify(d.stars), brief: !!(d.brief && d.brief.story && d.brief.objectives && d.brief.tip), unlocks: JSON.stringify(d.unlocks) },
      ch, ch16: Cm.chapterOf(16).number, ch15: Cm.chapterOf(15).number, m15unlocks: m15.unlocks.missions.join(),
      after: Cm.CAMPAIGN.filter((x) => x.number > 16).map((x) => `${x.id}:${x.playable}`), maxPlayable: Math.max(...Cm.CAMPAIGN.filter((x) => x.playable).map((x) => x.number)),
      prim: m.primaries.map((o) => o.id), mech: m.mechanics.map((x) => x.id), locked,
    };
  });
  check('A1 Mission 16 "jungle-sweep" is playable, number 16, a Minefield Sweep, in Chapter 4; Mission 15 stays in Chapter 3', camp.d && camp.d.number === 16 && camp.d.playable && camp.d.type === 'minefield' && camp.ch16 === 4 && camp.ch15 === 3, JSON.stringify({ d: camp.d, ch16: camp.ch16, ch15: camp.ch15 }));
  check('A1 Chapter 4 "Behind Enemy Lines" starts at Mission 16; Chapter 3 ends at Mission 15', camp.ch.includes('4:Behind Enemy Lines:16-inf') && camp.ch.some((c) => /^3:.*:11-15$/.test(c)), camp.ch.join(' | '));
  check('A2 no Mission 17+ is playable (Chapter 4 continues later)', camp.maxPlayable === 16 && camp.after.every((x) => x.endsWith(':false')), JSON.stringify(camp.after));
  check('A3 objectives: advance -> approaches -> checkpoint (then extraction); the field is the "mines" mechanic', camp.prim.join() === 'advance,approaches,checkpoint' && camp.mech.join() === 'mines', camp.prim.join() + ' / ' + camp.mech.join());
  check('A4 one optional (3 enemies killed by mine blasts), stars optionals / no KIA, a full briefing, no class / recruit unlock', camp.d.opt.length === 1 && camp.d.opt[0].startsWith('mine-ambush:') && camp.d.stars === '{"two":"optionals","three":"noKia"}' && camp.d.brief && /"missions":\[\]/.test(camp.d.unlocks) && /"recruits":\[\]/.test(camp.d.unlocks), JSON.stringify(camp.d));
  check('A5 Mission 15 unlocks Mission 16; a new save has Mission 16 locked', camp.m15unlocks === 'jungle-sweep' && camp.locked, camp.m15unlocks);

  // unlock: a Mission 15 failure unlocks nothing, the first win unlocks Mission 16, a replay nothing more (a new save)
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T);
  const unl = await ev(() => {
    const g = window.game, a = T.a, out = {};
    if (!a.campaign.unlockedMissions.includes('last-stand')) a.campaign.unlockedMissions.push('last-stand');
    const ids = T.R.owned().map((s) => s.id).slice(0, 2);
    T.deploy(ids, 'last-stand');
    for (const s of g.soldiers) g.damage(s, 1e4);
    T.stepUntil(() => g.phase !== 'playing', 30);
    out.fail = { phase: g.phase, open: a.campaign.unlockedMissions.includes('jungle-sweep') };
    for (const d of (a.pendingDecision ? a.pendingDecision.queue : [])) { a.credits += window.__casualties.costFor(T.R.get(d.id)); }
    while (a.pendingDecision && a.pendingDecision.queue.length) window.__economy.resurrect(T.R, a, a.pendingDecision.queue[0].id, window.__persist);
    T.deploy(ids, 'last-stand'); g.mission.debugReadyExtraction(g); T.extract(60);
    out.win = { phase: g.phase, open: a.campaign.unlockedMissions.includes('jungle-sweep'), unlocked: JSON.stringify(g.lastReward && g.lastReward.unlocked) };
    T.deploy(ids, 'last-stand'); g.mission.debugReadyExtraction(g); T.extract(60);
    out.replay = { phase: g.phase, n: a.campaign.unlockedMissions.filter((x) => x === 'jungle-sweep').length, unlocked: JSON.stringify(g.lastReward && g.lastReward.unlocked) };
    out.selectable = g.selectMission('jungle-sweep');
    window.__persist();
    return out;
  });
  check('A6 a failed Mission 15 does not unlock Mission 16; the first win does; a replay adds nothing', unl.fail.phase === 'failed' && !unl.fail.open && unl.win.phase === 'won' && unl.win.open && unl.replay.phase === 'won' && unl.replay.n === 1 && unl.selectable, JSON.stringify(unl));
  await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T);
  const kept = await ev(() => window.__account().campaign.unlockedMissions.includes('jungle-sweep'));
  check('A7 the unlock survives a reload', kept);

  // ================= B. MAP SAFETY =================
  const map = await ev((C) => {
    const { g, mf } = T.m16(undefined, false), W = g.world, st = g.map.start;
    const near = mf.mines.map((x) => Math.hypot(x.pos.x - st.x, x.pos.y - st.y));
    const free = T.fill(W, st);
    // the same grid with every cell whose centre is inside a blast ring (plus a soldier's radius) closed
    const ring = new Uint8Array(W.cols * W.rows), R = C.blastRadius + 12;
    for (let r = 0; r < W.rows; r++) for (let c = 0; c < W.cols; c++) { const x = c * 16 + 8, y = r * 16 + 8; if (mf.mines.some((m) => Math.hypot(x - m.pos.x, y - m.pos.y) < R)) ring[r * W.cols + c] = 1; }
    const safe = T.fill(W, st, ring);
    const z = g.mission.extraction.zone, zc = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    const cp = g.enemies.filter((e) => /^cp-(front|inner|reserve)$/.test(e.tag));
    const sz = g.map.startZone;
    return {
      n: mf.mines.length, minNear: Math.round(Math.min(...near)),
      open: mf.mines.filter((x) => !W.isOpen(x.pos.x, x.pos.y)).length, reach: mf.mines.filter((x) => !free[W.idx(x.pos.x, x.pos.y)]).length,
      enemies: g.enemies.length, enemiesUnreach: g.enemies.filter((e) => !e.fixed && !free[W.idx(e.pos.x, e.pos.y)]).map((e) => e.tag),
      cp: cp.length, cpSafe: cp.filter((e) => safe[W.idx(e.pos.x, e.pos.y)]).length, extSafe: !!safe[W.idx(zc.x, zc.y)],
      inStart: mf.mines.filter((x) => x.pos.x >= sz.x - C.blastRadius && x.pos.x <= sz.x + sz.w + C.blastRadius && x.pos.y >= sz.y - C.blastRadius && x.pos.y <= sz.y + sz.h + C.blastRadius).length,
      kinds: [...new Set(g.enemies.map((e) => e.kind + (e.structure ? ':' + e.structure : '')))].sort().join(),
      trees: g.map.obstacles.filter((o) => o.kind === 'tree').length, obstacles: g.map.obstacles.length, theme: g.map.theme, w: g.map.w, h: g.map.h,
    };
  }, C);
  check('B1 no mine within 900 px of the landing zone, none whose blast ring touches the start zone', map.minNear >= 900 && map.inStart === 0, `nearest ${map.minNear} px`);
  check('B2 every mine sits on open ground the squad can walk to', map.n >= 10 && map.open === 0 && map.reach === 0, `${map.n} mines, ${map.open} blocked, ${map.reach} unreachable`);
  check('B3 every placed enemy on foot can be reached from the landing zone', map.enemiesUnreach.length === 0, `${map.enemies} enemies; ${map.enemiesUnreach.join()}`);
  check('B4 a mine-free route: every checkpoint defender and the helicopter can be reached without entering a blast ring', map.cp > 0 && map.cpSafe === map.cp && map.extSafe, `${map.cpSafe}/${map.cp} defenders, helicopter ${map.extSafe}`);
  check('B5 existing enemy types only (Riflemen, Armored, Snipers, towers; no new kind)', map.kinds === 'armored,rifleman,sniper,tower:tower' || /^armored,rifleman,sniper(,tower(:tower)?)?$/.test(map.kinds), map.kinds);
  check('B6 the jungle map: canopy trees, the jungle theme, a 4800x2600 world', map.theme === 'jungle' && map.trees > 40 && map.w === 4800 && map.h === 2600, `${map.trees} trees / ${map.obstacles} obstacles, ${map.w}x${map.h}`);

  // ================= C. MINE STATES =================
  const states = await ev((C) => {
    const { g, mf } = T.m16(), out = {};
    out.start = { hidden: mf.mines.every((x) => x.state === 'hidden' && !x.unit), units: g.enemies.filter((e) => e.structure === 'mine').length, revealed: mf.log.revealed };
    T.step(2); out.after2 = mf.mines.filter((x) => x.state !== 'hidden').length;
    const f = T.lab([{ x: T.LAB.x + 200, y: T.LAB.y }]); const x = f.mines[0];
    T.at({ x: x.pos.x - C.detectRadius - 6, y: x.pos.y }, [g.soldiers[0]]);
    for (const s of g.soldiers.slice(1)) { s.pos = { x: T.LAB.x - 300, y: T.LAB.y }; s.vel = { x: 0, y: 0 }; }
    const pin = (p) => () => { g.soldiers[0].pos = { ...p }; g.soldiers[0].vel = { x: 0, y: 0 }; };
    const out1 = { x: x.pos.x - C.detectRadius - 6, y: x.pos.y };
    T.step(1, pin(out1)); out.outside = x.state;
    T.step(0.2, pin({ x: x.pos.x - C.detectRadius + 4, y: x.pos.y })); out.inside = x.state;
    out.unit = !!x.unit && g.enemies.includes(x.unit) && x.unit.structure === 'mine' && !x.unit.vehicle && x.unit.fixed;
    T.step(3, pin({ x: x.pos.x - 600, y: x.pos.y })); out.away = x.state;
    out.log = f.log.revealed; out.say = (g.banners || []).length >= 0;
    return out;
  }, C);
  check('C1 every mine is hidden at the start (no shootable unit) and stays hidden with nobody near', states.start.hidden && states.start.units === 0 && states.start.revealed === 0 && states.after2 === 0, JSON.stringify(states.start));
  check(`C2 a standing soldier reveals a mine inside ${C.detectRadius} px, not outside`, states.outside === 'hidden' && states.inside === 'revealed' && states.unit, `${states.outside} -> ${states.inside}`);
  check('C3 a revealed mine stays revealed after the squad walks away (one reveal)', states.away === 'revealed' && states.log === 1, `${states.away}, revealed ${states.log}`);
  check('C4 detection 130 px, trigger 20 px, blast 65 px (CFG.mine)', C.detectRadius === 130 && C.triggerRadius === 20 && C.blastRadius === 65, JSON.stringify(C));

  // ================= D. TRIGGERS =================
  const trig = await ev((C) => {
    const out = {};
    const one = (setup, squad) => { const { g } = T.m16(squad); const f = T.lab([{ x: T.LAB.x + 200, y: T.LAB.y }]); const x = f.mines[0]; const r = setup(g, f, x); return { r, state: x.state, cause: x.cause, n: f.log.detonations }; };
    // a soldier walks onto a hidden mine (revealed on the way: it is still the walk that sets it off)
    out.soldierHidden = one((g, f, x) => { T.at({ x: x.pos.x, y: x.pos.y - 300 }); g.soldiers[0].pos = { x: x.pos.x + 10, y: x.pos.y }; T.step(1 / 60); return x.revealedAt; });
    out.soldierRevealed = one((g, f, x) => { T.at({ x: x.pos.x - 100, y: x.pos.y }); T.step(0.2); const was = x.state; g.soldiers[0].pos = { x: x.pos.x, y: x.pos.y + C.triggerRadius - 3 }; T.step(1 / 60); return was; });
    out.outsideTrigger = one((g, f, x) => { T.at({ x: x.pos.x, y: x.pos.y - 300 }); T.step(2, () => { g.soldiers[0].pos = { x: x.pos.x, y: x.pos.y + C.triggerRadius + 4 }; g.soldiers[0].vel = { x: 0, y: 0 }; }); return 0; });
    out.enemyHidden = one((g, f, x) => { T.at({ x: x.pos.x - 700, y: x.pos.y }); const e = g.spawnEnemy({ x: x.pos.x + 12, y: x.pos.y }, 'rifleman'); e.guard = true; T.step(1 / 60); return x.revealedAt; });
    out.enemyRevealed = one((g, f, x) => { T.at({ x: x.pos.x - 110, y: x.pos.y }); T.step(0.2); const was = x.state; T.at({ x: x.pos.x - 700, y: x.pos.y }); const e = g.spawnEnemy({ x: x.pos.x - 8, y: x.pos.y + 5 }, 'armored'); e.guard = true; T.step(1 / 60); return was; });
    out.structure = one((g, f, x) => { T.at({ x: x.pos.x - 700, y: x.pos.y }); const e = g.spawnEnemy({ x: x.pos.x, y: x.pos.y }, 'rifleman'); e.structure = 'tower'; e.fixed = true; T.step(2); return 0; });
    // no avoidance: the squad steered straight at a revealed mine walks onto it (and the nav grid never changes)
    out.walk = one((g, f, x) => {
      // one soldier (no formation spread), steered straight at the mine from 220 px
      T.at({ x: x.pos.x - 220, y: x.pos.y }); T.step(0.3, () => T.pinAt({ x: x.pos.x - 220, y: x.pos.y }));
      const W = g.world, before = W.blocked.join('');
      g.mission.mechanic('mines').reveal(g, x);
      const same = W.blocked.join('') === before;
      g.invuln = true;
      const u = g.soldiers[0];
      g.input.move = () => { const dx = x.pos.x - u.pos.x, dy = x.pos.y - u.pos.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; };
      const t = T.stepUntil(() => x.state === 'detonated', 6);
      g.invuln = false;
      return { same, t: +t.toFixed(2) };
    }, ['infantry']);
    // an enemy squad walking its route crosses a hidden mine and sets it off (enemy patrols do not avoid them)
    out.enemyWalk = one((g, f, x) => {
      T.at({ x: x.pos.x - 900, y: x.pos.y });
      const e = g.spawnEnemy({ x: x.pos.x + 160, y: x.pos.y }, 'rifleman'); e.guard = false; e.aggro = 2000; e.fireCooldown = 1e9;
      g.invuln = true;
      const t = T.stepUntil(() => x.state === 'detonated', 12, () => T.pinAt({ x: x.pos.x - 900, y: x.pos.y }));
      g.invuln = false;
      return +t.toFixed(2);
    });
    return out;
  }, C);
  check('D1 a soldier on a hidden mine sets it off at once', trig.soldierHidden.state === 'detonated' && trig.soldierHidden.cause === 'soldier', JSON.stringify(trig.soldierHidden));
  check('D2 a soldier on a revealed mine sets it off', trig.soldierRevealed.r === 'revealed' && trig.soldierRevealed.state === 'detonated' && trig.soldierRevealed.cause === 'soldier', JSON.stringify(trig.soldierRevealed));
  check('D3 a soldier just outside the trigger radius does not', trig.outsideTrigger.state === 'revealed' && trig.outsideTrigger.n === 0, JSON.stringify(trig.outsideTrigger));
  check('D4 an enemy on foot sets off a hidden mine (it stays unrevealed until then)', trig.enemyHidden.r === -1 && trig.enemyHidden.state === 'detonated' && trig.enemyHidden.cause === 'enemy', JSON.stringify(trig.enemyHidden));
  check('D5 an enemy sets off a revealed mine', trig.enemyRevealed.r === 'revealed' && trig.enemyRevealed.state === 'detonated' && trig.enemyRevealed.cause === 'enemy', JSON.stringify(trig.enemyRevealed));
  check('D6 a structure / fixed unit never sets one off', trig.structure.state === 'hidden' && trig.structure.n === 0, JSON.stringify(trig.structure));
  check('D7 no avoidance: the nav grid ignores mines and a squad steered at a revealed mine walks onto it', trig.walk.r.same && trig.walk.state === 'detonated' && trig.walk.cause === 'soldier', JSON.stringify(trig.walk));
  check('D8 an enemy closing in walks over a hidden mine in its way and sets it off', trig.enemyWalk.state === 'detonated' && trig.enemyWalk.cause === 'enemy', JSON.stringify(trig.enemyWalk));

  // ================= E. BLAST =================
  const blast = await ev((C) => {
    const out = {};
    const scene = (fn) => { const { g } = T.m16(['infantry', 'heavy', 'medic', 'infantry']); const f = T.lab([{ x: T.LAB.x + 200, y: T.LAB.y }]); const x = f.mines[0]; T.at({ x: x.pos.x - 600, y: x.pos.y }); return fn(g, f, x); };
    // falloff on four soldiers at 0, R/2, R-1 and R+40 (they are moved there and the mine is set off directly)
    out.fall = scene((g, f, x) => {
      const d = [0, C.blastRadius / 2, C.blastRadius - 1, C.blastRadius + 40];
      g.soldiers.forEach((s, i) => { s.pos = { x: x.pos.x + (i % 2 ? -1 : 1) * d[i], y: x.pos.y }; s.vel = { x: 0, y: 0 }; s.hp = s.maxHp; });
      const before = g.soldiers.map((s) => s.hp);
      f.detonate(g, x, 'shot');
      return { lost: g.soldiers.map((s, i) => +(before[i] - s.hp).toFixed(2)), down: g.soldiers.filter((s) => !s.active).length, log: { hits: f.log.soldierHits, blasts: f.log.soldierBlasts, dmg: Math.round(f.log.squadDamage) } };
    });
    out.expect = [C.damage, C.damage * (1 - 0.5 * (1 - C.edgeFrac)), C.damage * (1 - ((C.blastRadius - 1) / C.blastRadius) * (1 - C.edgeFrac))].map((v) => +v.toFixed(2));
    // cover: a soldier behind a wall from the mine takes nothing (find a wall on the map edge of clearing A)
    out.cover = (() => {
      const { g } = T.m16(['infantry', 'heavy']); const Wl = T.WALL;
      const f = T.lab([{ x: Wl.east - 5, y: Wl.y }]); const y = f.mines[0];
      T.at({ x: 3700, y: 1700 });
      const sol = g.soldiers[0], open = g.soldiers[1];
      sol.pos = { x: Wl.west + 40, y: Wl.y }; open.pos = { x: Wl.east + 25, y: Wl.y }; sol.vel = open.vel = { x: 0, y: 0 };
      const h0 = sol.hp, h1 = open.hp, d = Math.round(Math.hypot(sol.pos.x - y.pos.x, sol.pos.y - y.pos.y));
      f.detonate(g, y, 'shot');
      return { d, covered: +(h0 - sol.hp).toFixed(2), open: +(h1 - open.hp).toFixed(2), sight: g.world.clear(sol.pos, y.pos) };
    })();
    // enemies: a Rifleman and an Armored Trooper facing the mine and one facing away all take the same blast
    out.armor = scene((g, f, x) => {
      const p = (dx, dy) => ({ x: x.pos.x + dx, y: x.pos.y + dy });
      const r = T.dummy(p(20, 0)), a1 = T.dummy(p(-20, 0), 'armored'), a2 = T.dummy(p(0, 20), 'armored');
      a1.aim = 0; a2.aim = Math.PI / 2; // a1 faces the mine (it stands west, aims east); a2 faces away (south)
      const h = [r, a1, a2].map((e) => e.hp);
      f.detonate(g, x, 'shot');
      return { lost: [r, a1, a2].map((e, i) => +(h[i] - e.hp).toFixed(2)), enemyDamage: Math.round(f.log.enemyDamage) };
    });
    // Elite: Ironclad (Juggernaut) takes its reduction from a mine like from anything else
    out.elite = scene((g, f, x) => {
      const s = g.soldiers.find((u) => u.identity.classId === 'heavy'), o = g.soldiers.find((u) => u.identity.classId === 'infantry');
      s.elite = { id: 'hvy-juggernaut', overdrive: 0, charge: 0, ready: false, effect: 0, procs: 0 };
      s.pos = { x: x.pos.x, y: x.pos.y + 1 }; o.pos = { x: x.pos.x + 1, y: x.pos.y }; s.vel = o.vel = { x: 0, y: 0 };
      const hs = s.hp, ho = o.hp; f.detonate(g, x, 'shot');
      return { heavy: +(hs - s.hp).toFixed(2), plain: +(ho - o.hp).toFixed(2), red: window.__CFG.elite.ironcladReduction };
    });
    // kills: three Riflemen at the centre die (40 HP), no soldier gets credit, the optional counts them
    out.kills = (() => {
      const { g, m } = T.m16(['infantry', 'heavy', 'medic'], false);
      T.calm();
      const f = T.lab([{ x: T.LAB.x + 200, y: T.LAB.y }]); const x = f.mines[0]; T.at({ x: x.pos.x - 600, y: x.pos.y });
      const opt = m.optionals[0];
      opt.state === 'pending' && opt.activate && opt.activate(m, g);
      const s0 = opt.status(m);
      for (let i = 0; i < 3; i++) { const e = g.spawnEnemy({ x: x.pos.x + 10 * i, y: x.pos.y + 10 }, 'rifleman'); e.guard = true; e.fireCooldown = 1e9; }
      const dealt0 = g.soldiers.map((s) => s.dealt).join(), kills0 = [...g.stats.bySoldier.values()].reduce((n, r) => n + r.kills, 0);
      f.detonate(g, x, 'shot'); T.step(0.2);
      const kills1 = [...g.stats.bySoldier.values()].reduce((n, r) => n + r.kills, 0);
      return { s0, s1: opt.status(m), state: opt.state, enemyKills: f.log.enemyKills, credit: g.soldiers.map((s) => s.dealt).join() !== dealt0 || kills1 !== kills0 };
    })();
    return out;
  }, C);
  const [l0, l1, l2, l3] = blast.fall.lost, [e0, e1, e2] = blast.expect, near = (a, b) => Math.abs(a - b) < 0.05;
  check(`E1 falloff: ${e0} at the centre, ${e1} at half radius, ${e2} at the edge, nothing outside`, near(l0, e0) && near(l1, e1) && near(l2, e2) && l3 === 0, `lost ${blast.fall.lost.join(' / ')}`);
  check('E2 a blast from full HP never kills: the centre hit is 55-65% of an Infantry soldier\'s 100 HP and below every class\'s HP', C.damage >= 55 && C.damage <= 65 && blast.fall.down === 0, `damage ${C.damage}, downed ${blast.fall.down}`);
  check('E3 the log counts squad hits, blasts and damage', blast.fall.log.hits === 3 && blast.fall.log.blasts === 1 && Math.abs(blast.fall.log.dmg - (l0 + l1 + l2)) <= 1, JSON.stringify(blast.fall.log));
  check('E4 solid cover shelters a soldier from the blast; an exposed one takes it', !blast.cover.sight && blast.cover.d < C.blastRadius && blast.cover.covered === 0 && blast.cover.open > 0, JSON.stringify(blast.cover));
  const [ar, af, ab] = blast.armor.lost;
  check('E5 enemies take it too; an Armored Trooper takes the full blast whichever way it faces (no frontal plate)', ar > 0 && near(ar, af) && near(af, ab) && blast.armor.enemyDamage > 0, JSON.stringify(blast.armor));
  check('E6 Elite reductions apply (Juggernaut Ironclad)', near(blast.elite.heavy, blast.elite.plain * (1 - blast.elite.red)), JSON.stringify(blast.elite));
  check('E7 mine kills give no soldier credit (no kill / damage stats); the mine-ambush optional counts them (0/3 -> done)', blast.kills.enemyKills === 3 && !blast.kills.credit && blast.kills.s0 === '0/3' && blast.kills.state === 'complete', JSON.stringify(blast.kills));

  // ================= F. TARGETING / ORDERS =================
  const tgt = await ev((C) => {
    const out = {};
    // a revealed mine 160 px in front of an idle squad with no enemy: nobody fires at it in 4 s
    (() => {
      const { g } = T.m16(); const f = T.lab([{ x: T.LAB.x + 160, y: T.LAB.y }]); const x = f.mines[0];
      const P = { x: T.LAB.x, y: T.LAB.y }; T.at(P); f.reveal(g, x);
      const shots0 = g.soldiers.reduce((n, s) => n + s.shots, 0);
      let aimed = 0; T.step(4, () => { T.pinAt(P); if (g.soldiers.some((s) => s.target === x.unit)) aimed++; });
      out.idle = { state: x.state, aimed, shots: g.soldiers.reduce((n, s) => n + s.shots, 0) - shots0, hp: x.unit && x.unit.hp };
    })();
    // a mine right in the line of fire between the squad and an enemy: the rounds pass over it
    (() => {
      const { g } = T.m16(); const f = T.lab([{ x: T.LAB.x + 120, y: T.LAB.y }]); const x = f.mines[0];
      const P = { x: T.LAB.x, y: T.LAB.y }; T.at(P); f.reveal(g, x);
      const e = T.dummy({ x: T.LAB.x + 300, y: T.LAB.y });
      g.invuln = true;
      let aimed = 0; T.step(5, () => { T.pinAt(P); if (g.soldiers.some((s) => s.target === x.unit)) aimed++; });
      g.invuln = false;
      out.through = { state: x.state, aimed, enemyHit: e.hp < e.maxHp, hp: x.unit && x.unit.hp };
    })();
    // Game.onTap on a revealed mine in range and sight: every soldier gets the order, the mine goes off once (a shot)
    (() => {
      const { g } = T.m16(); const f = T.lab([{ x: T.LAB.x + 200, y: T.LAB.y }]); const x = f.mines[0];
      const P = { x: T.LAB.x, y: T.LAB.y }; T.at(P); f.reveal(g, x);
      const miss = g.onTap(T.screenOf({ x: x.pos.x + C.tapRadius + 30, y: x.pos.y }));
      const ok = g.onTap(T.screenOf({ x: x.pos.x + 20, y: x.pos.y - 15 }));
      const all = g.soldiers.every((s) => s.order === x.unit);
      const t = T.stepUntil(() => x.state === 'detonated', 6, () => T.pinAt(P));
      T.step(0.5, () => T.pinAt(P));
      out.tap = { miss, ok, all, state: x.state, cause: x.cause, t: +t.toFixed(2), n: f.log.detonations, orders: f.log.orders, cleared: g.soldiers.every((s) => !s.order && !(s.target && s.target.structure === 'mine')), field: !f.order, shotsAfter: 0 };
      // and the squad is back to fighting normally: a new enemy is engaged
      const e = T.dummy({ x: T.LAB.x + 260, y: T.LAB.y + 40 });
      T.step(2, () => T.pinAt(P));
      out.tap.after = e.hp < e.maxHp;
    })();
    // tapping a hidden mine (or with no mine) does nothing
    (() => {
      const { g } = T.m16(); const f = T.lab([{ x: T.LAB.x + 300, y: T.LAB.y }]); const x = f.mines[0];
      T.at({ x: T.LAB.x, y: T.LAB.y });
      out.hidden = { took: g.onTap(T.screenOf(x.pos)), orders: f.log.orders, state: x.state };
    })();
    // out of sight (behind the checkpoint wall): the order stands but nobody can fire; it expires after orderTime
    (() => {
      const { g } = T.m16(); const Wl = T.WALL, P = { x: Wl.west, y: Wl.y };
      const f = T.lab([{ x: Wl.east, y: Wl.y }]); const x = f.mines[0]; f.reveal(g, x);
      T.at(P);
      const sight = g.soldiers.filter((s) => g.world.clear(s.pos, x.pos)).length;
      g.onTap(T.screenOf(x.pos));
      const t0 = g.time;
      T.step(C.orderTime - 1, () => T.pinAt(P));
      const mid = { order: !!f.order, held: g.soldiers.every((s) => s.order === x.unit), state: x.state };
      T.step(1.5, () => T.pinAt(P));
      out.blind = { sight, mid, state: x.state, order: !!f.order, cleared: g.soldiers.every((s) => !s.order && s.target !== x.unit), full: !!x.unit && x.unit.hp === x.unit.maxHp, dt: +(g.time - t0).toFixed(2) };
    })();
    // a second tap on another mine replaces the order (one order at a time)
    (() => {
      const { g } = T.m16(); const f = T.lab([{ x: T.LAB.x + 220, y: T.LAB.y - 120 }, { x: T.LAB.x + 220, y: T.LAB.y + 120 }]);
      const [a, b] = f.mines; T.at({ x: T.LAB.x, y: T.LAB.y }); f.reveal(g, a); f.reveal(g, b);
      g.onTap(T.screenOf(a.pos)); g.onTap(T.screenOf(b.pos));
      out.second = { mine: f.order && f.order.mine === b, all: g.soldiers.every((s) => s.order === b.unit) };
    })();
    // a tap while paused / while aiming a grenade is not a mine order
    (() => {
      const { g } = T.m16(); const f = T.lab([{ x: T.LAB.x + 200, y: T.LAB.y }]); const x = f.mines[0];
      T.at({ x: T.LAB.x, y: T.LAB.y }); f.reveal(g, x);
      g.paused = true; const p = g.onTap(T.screenOf(x.pos)); g.paused = false;
      g.targeting = g.soldiers[0]; const t = g.onTap(T.screenOf(x.pos)); g.targeting = null;
      out.blocked = { p, t, orders: f.log.orders };
    })();
    return out;
  }, C);
  check('F1 no automatic targeting: an idle squad 160 px from a revealed mine never aims at or shoots it', tgt.idle.state === 'revealed' && tgt.idle.aimed === 0 && tgt.idle.shots === 0, JSON.stringify(tgt.idle));
  check('F2 rounds at an enemy pass over a revealed mine in the line of fire', tgt.through.state === 'revealed' && tgt.through.aimed === 0 && tgt.through.enemyHit && tgt.through.hp === C.hp, JSON.stringify(tgt.through));
  check('F3 a tap beside a mine (outside tapRadius) is not an order; a tap on it orders every soldier', !tgt.tap.miss && tgt.tap.ok && tgt.tap.all && tgt.tap.orders === 1, JSON.stringify(tgt.tap));
  check('F4 the ordered squad shoots the mine: it goes off once, as a shot', tgt.tap.state === 'detonated' && tgt.tap.cause === 'shot' && tgt.tap.n === 1 && tgt.tap.t < 3, JSON.stringify(tgt.tap));
  check('F5 the order ends with the mine: nobody keeps it as order / target, and the squad engages the next enemy', tgt.tap.cleared && tgt.tap.field && tgt.tap.after, JSON.stringify(tgt.tap));
  check('F6 a hidden mine cannot be tapped', !tgt.hidden.took && tgt.hidden.orders === 0 && tgt.hidden.state === 'hidden', JSON.stringify(tgt.hidden));
  check(`F7 a mine out of sight: the order holds without a shot, then expires after ${C.orderTime} s with nothing stuck`, tgt.blind.sight === 0 && tgt.blind.mid.order && tgt.blind.mid.held && tgt.blind.state === 'revealed' && !tgt.blind.order && tgt.blind.cleared && tgt.blind.full, JSON.stringify(tgt.blind));
  check('F8 a new tap replaces the order (one at a time)', tgt.second.mine && tgt.second.all, JSON.stringify(tgt.second));
  check('F9 no order while paused or while aiming an ability', tgt.blocked.p === false && tgt.blocked.t === false && tgt.blocked.orders === 0, JSON.stringify(tgt.blocked));

  // real input: a mouse click on the canvas
  const setupTap = (dx, dy) => ev(({ dx, dy }) => {
    const { g } = T.m16(); const f = T.lab([{ x: T.LAB.x + dx, y: T.LAB.y + dy }]); const x = f.mines[0];
    const P = { x: T.LAB.x, y: T.LAB.y }; T.at(P); f.reveal(g, x); g.invuln = true;
    window.__tapField = f;
    return T.client(x.pos);
  }, { dx, dy });
  const tapLog = () => ev(() => { const f = window.__tapField, g = window.game; return { orders: f.log.orders, state: f.mines[0].state, by: g.soldiers.filter((s) => s.order === f.mines[0].unit || f.mines[0].state === 'detonated').length }; });
  let c = await setupTap(260, 0);
  await page.mouse.click(c.x, c.y);
  const mouse = await tapLog();
  c = await setupTap(260, 0);
  await page.mouse.click(c.x + 100, c.y + 60);
  const mouseMiss = await tapLog();
  check('F10 a left click on a revealed mine orders it; a click on open ground does not', mouse.orders === 1 && mouseMiss.orders === 0, JSON.stringify({ mouse, mouseMiss }));
  await ev(() => { window.game.invuln = false; });

  // ================= G. DETONATION / CHAINS =================
  const chain = await ev((C) => {
    const out = {};
    // a chain: four mines 70 px apart in a line; the first goes off, each next one follows after chainDelay
    (() => {
      const { g } = T.m16(); T.at({ x: T.LAB.x - 500, y: T.LAB.y });
      const pts = [0, 1, 2, 3].map((i) => ({ x: T.LAB.x + i * 70, y: T.LAB.y }));
      const far = { x: T.LAB.x + 3 * 70 + C.chainRadius + 30, y: T.LAB.y };
      const f = T.lab([...pts, far]);
      f.detonate(g, f.mines[0], 'shot');
      T.step(2);
      out.line = { states: f.mines.map((x) => x.state), causes: f.mines.map((x) => x.cause), gaps: f.mines.slice(1, 4).map((x, i) => +(x.detonatedAt - f.mines[i].detonatedAt).toFixed(3)), n: f.log.detonations };
      f.detonate(g, f.mines[0], 'shot'); out.line.again = f.log.detonations;
    })();
    // a dense cluster (every mine in reach of every other): each goes off exactly once and the chain ends
    (() => {
      const { g } = T.m16(); T.at({ x: T.LAB.x - 500, y: T.LAB.y });
      const pts = []; for (let i = 0; i < 9; i++) pts.push({ x: T.LAB.x + (i % 3) * 30, y: T.LAB.y + Math.floor(i / 3) * 30 });
      const f = T.lab(pts);
      f.detonate(g, f.mines[4], 'shot');
      const t = T.stepUntil(() => f.mines.every((x) => x.state === 'detonated'), 5);
      T.step(1);
      out.cluster = { n: f.log.detonations, all: f.mines.every((x) => x.state === 'detonated'), t: +t.toFixed(2), fuses: f.mines.filter((x) => x.fuse >= 0).length, chained: f.log.byCause.chain };
    })();
    // no chain through a wall (the checkpoint's back wall between two mines 60 px apart)
    (() => {
      const { g } = T.m16(); const Wl = T.WALL;
      T.at({ x: 3700, y: 1700 });
      const a = { x: 4182, y: Wl.y }, b = { x: 4242, y: Wl.y };
      const f = T.lab([a, b]); f.detonate(g, f.mines[0], 'shot'); T.step(1);
      out.wall = { sight: g.world.clear(a, b), states: f.mines.map((x) => x.state) };
    })();
    // a grenade on a revealed mine sets it off (the revealed mine is a target for blasts too)
    (() => {
      const { g } = T.m16(['infantry', 'infantry', 'heavy']); const f = T.lab([{ x: T.LAB.x + 220, y: T.LAB.y }]); const x = f.mines[0];
      const P = { x: T.LAB.x, y: T.LAB.y }; T.at(P); f.reveal(g, x);
      const s = g.soldiers.find((u) => u.identity.classId === 'infantry' && u.ability && u.ability.ready(u));
      g.targeting = s; g.onTargetConfirm(T.screenOf(x.pos));
      const t = T.stepUntil(() => x.state === 'detonated', 4, () => T.pinAt(P));
      out.grenade = { state: x.state, cause: x.cause, t: +t.toFixed(2) };
    })();
    return out;
  }, C);
  const gapsOk = chain.line.gaps.every((d) => Math.abs(d - C.chainDelay) <= 1 / 60 + 1e-6);
  check(`G1 a chain: mines within ${C.chainRadius} px follow one by one ${C.chainDelay} s apart; one out of reach stays`, chain.line.states.slice(0, 4).every((s) => s === 'detonated') && chain.line.states[4] === 'hidden' && chain.line.causes.slice(1, 4).every((x) => x === 'chain') && gapsOk, JSON.stringify(chain.line));
  check('G2 a mine goes off once: detonating it again does nothing', chain.line.again === chain.line.n && chain.line.n === 4, `${chain.line.n} -> ${chain.line.again}`);
  check('G3 a dense cluster: every mine exactly once, the chain ends (no fuse left)', chain.cluster.all && chain.cluster.n === 9 && chain.cluster.fuses === 0 && chain.cluster.chained === 8, JSON.stringify(chain.cluster));
  check('G4 no chain through a wall', !chain.wall.sight && chain.wall.states.join() === 'detonated,hidden', JSON.stringify(chain.wall));
  check('G5 a grenade on a revealed mine sets it off', chain.grenade.state === 'detonated' && chain.grenade.cause === 'shot', JSON.stringify(chain.grenade));

  // ================= H. MISSION FLOW =================
  const flow = await ev(() => {
    const { g, m, mf } = T.m16(['infantry', 'heavy', 'medic'], false), out = {};
    const story = () => (g.story ? g.story.log.filter((l) => /^(radio|open):/.test(l)) : []);
    out.obj0 = m.currentObjective && m.currentObjective.id;
    // the radio warning plays once, when the squad first nears a mine
    const first = mf.mines[0].pos;
    g.invuln = true;
    T.at({ x: first.x - 600, y: first.y + 200 }); T.step(0.2, () => T.pinAt({ x: first.x - 600, y: first.y + 200 }));
    out.warn0 = mf.warned;
    T.at({ x: first.x - 400, y: first.y + 200 }); T.step(0.2, () => T.pinAt({ x: first.x - 400, y: first.y + 200 }));
    out.warn1 = { warned: mf.warned, story: story().join() };
    // advance: reach the trail zone
    T.at({ x: 1580, y: 1130 }); T.step(0.5, () => T.pinAt({ x: 1580, y: 1130 }));
    out.obj1 = m.currentObjective && m.currentObjective.id;
    out.adv = m.primaries[0].state;
    // the approaches: every patrol killed (through Game.damage)
    out.status1 = m.currentObjective.status ? m.currentObjective.status(m) : '';
    T.kill((e) => /^patrol-/.test(e.tag));
    out.obj2 = m.currentObjective && m.currentObjective.id;
    out.cpCue = story().join();
    T.kill((e) => /^cp-/.test(e.tag));
    T.step(0.5);
    out.obj3 = m.currentObjective ? m.currentObjective.id : null;
    out.phase = m.phase;
    g.invuln = false;
    T.extract(60);
    out.end = { phase: g.phase, story: story().join(), stars: g.lastStars && g.lastStars.stars };
    return out;
  });
  check('H1 the mission starts on "advance"', flow.obj0 === 'advance', flow.obj0);
  check('H2 the radio warning plays once the squad nears the first mines, not before', !flow.warn0 && flow.warn1.warned && /m16-mines/.test(flow.warn1.story), JSON.stringify(flow.warn1));
  check('H3 reaching the trail completes "advance"; the approaches follow; killing every patrol moves on to the checkpoint', flow.adv === 'complete' && flow.obj1 === 'approaches' && flow.obj2 === 'checkpoint', JSON.stringify({ adv: flow.adv, o1: flow.obj1, o2: flow.obj2, st: flow.status1 }));
  check('H4 the checkpoint cue plays when the checkpoint objective starts', /m16-checkpoint/.test(flow.cpCue), flow.cpCue);
  check('H5 clearing the checkpoint calls the helicopter; extraction wins the mission', flow.obj3 === null && flow.end.phase === 'won', JSON.stringify({ o3: flow.obj3, phase: flow.phase, end: flow.end }));
  check('H6 the victory radio line plays', /m16-extract/.test(flow.end.story), flow.end.story);

  // rewards / stars / replay (roster squad, Mission 16 unlocked by the Mission 15 win above)
  const rw = await ev(() => {
    const g = window.game, a = T.a, ids = T.R.owned().filter((s) => s.status !== 'kia').map((s) => s.id).slice(0, 2), out = {};
    const run = (opt) => {
      T.deploy(ids, 'jungle-sweep'); if (g.story) g.story.skip(g);
      const m = g.mission;
      if (opt) { m.optionals[0].state = 'complete'; }
      const c0 = a.credits;
      m.debugReadyExtraction(g); T.extract(60);
      const r = g.lastReward;
      return { phase: g.phase, credits: a.credits - c0, xpMul: r && r.xpMul, first: r && r.firstClear, lines: r && r.creditLines.map((l) => l.label).join('|'), stars: g.lastStars && g.lastStars.stars, unlocked: JSON.stringify(r && r.unlocked) };
    };
    out.first = run(true);
    out.replay = run(false);
    const rec = a.missions['jungle-sweep'];
    out.rec = rec && { completions: rec.completions, best: rec.bestStars };
    out.replayMul = window.__progression.PROGRESSION.xp.replayMul;
    window.__persist();
    return out;
  });
  check('H7 first clear: victory + first-time Credits, full XP, 3 stars with the optional and no KIA', rw.first.phase === 'won' && rw.first.first && rw.first.xpMul === 1 && /First-time/.test(rw.first.lines) && rw.first.stars === 3 && rw.first.credits > 0, JSON.stringify(rw.first));
  check('H8 a replay pays the replay rate (no second first-clear bonus), keeps the best stars, unlocks nothing', rw.replay.phase === 'won' && !rw.replay.first && rw.replay.xpMul === rw.replayMul && !/First-time/.test(rw.replay.lines) && rw.replay.credits < rw.first.credits && rw.rec.completions === 2 && rw.rec.best === 3, JSON.stringify({ replay: rw.replay, rec: rw.rec }));

  // ================= I. ATTEMPTS / SAVES =================
  const att = await ev(() => {
    const { g, m, mf } = T.m16(), out = {};
    const x = mf.mines[0]; mf.reveal(g, x); mf.detonate(g, mf.mines[1], 'shot');
    out.before = { revealed: mf.log.revealed, det: mf.log.detonations };
    g.reset(); // Retry
    const mf2 = g.mission.mechanic('mines');
    out.after = { fresh: mf2 !== mf, hidden: mf2.mines.every((k) => k.state === 'hidden'), units: g.enemies.filter((e) => e.structure === 'mine').length, log: mf2.log.detonations + mf2.log.revealed, order: mf2.order };
    out.saved = /mine/i.test(localStorage.getItem('minisquad.save') || '');
    // leave a mine revealed for the reload check
    mf2.reveal(g, mf2.mines[2]);
    return out;
  });
  check('I1 Retry builds a fresh field: every mine hidden again, no mine unit left, an empty log', att.after.fresh && att.after.hidden && att.after.units === 0 && att.after.log === 0 && !att.after.order, JSON.stringify(att));
  check('I2 nothing about mines is written to the save', !att.saved);
  await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T);
  const rel = await ev(() => { const { g, mf } = T.m16(); return { hidden: mf.mines.every((k) => k.state === 'hidden'), units: g.enemies.filter((e) => e.structure === 'mine').length }; });
  check('I3 after a reload a new attempt starts with every mine hidden', rel.hidden && rel.units === 0, JSON.stringify(rel));
  const fx = [];
  for (const dir of ['fixtures', 'fixtures-v08b']) for (const f of fs.readdirSync(__dirname + '/' + dir)) {
    const p = await open({ save: fs.readFileSync(__dirname + '/' + dir + '/' + f, 'utf8') });
    const r = await p.evaluate(() => { const a = window.__account(); return { st: window.__loadStatus.status, m16: a.campaign.unlockedMissions.includes('jungle-sweep'), m15done: !!(a.missions['last-stand'] && a.missions['last-stand'].completions) }; });
    fx.push(`${f}:${r.st}:${r.m16 === r.m15done ? 'ok' : 'M16?'}`);
    await p.context().close();
  }
  check('I4 every save fixture loads; Mission 16 is open exactly when Mission 15 was cleared', fx.every((x) => /:(loaded|migrated):ok$/.test(x)), fx.join(' '));
  const sv = +((fs.readFileSync(__dirname + '/../src/save.ts', 'utf8').match(/SAVE_VERSION = (\d+)/) || [])[1]);
  check('I5 save format unchanged: SAVE_VERSION 9', sv === 9, `SAVE_VERSION ${sv}`);
  // a v0.8C.1-shaped save that cleared Mission 15 (made by the run above) opens Mission 16 after a load, even if the list lost it
  const repaired = await ev(() => {
    const raw = JSON.parse(localStorage.getItem('minisquad.save'));
    raw.account.campaign.unlockedMissions = raw.account.campaign.unlockedMissions.filter((x) => x !== 'jungle-sweep');
    return JSON.stringify(raw);
  });
  const p2 = await open({ save: repaired });
  const rep = await p2.evaluate(() => ({ st: window.__loadStatus.status, m16: window.__account().campaign.unlockedMissions.includes('jungle-sweep') }));
  await p2.context().close();
  check('I6 a save that cleared Mission 15 but lacks the Mission 16 unlock gets it back on load', rep.m16 && /loaded|migrated|repaired/.test(rep.st), JSON.stringify(rep));

  // ================= J. BASE =================
  if (BASE) {
    const bp = await openPage(browser, BASE, { seed: 4242 }); // seeded: spawn jitter draws Math.random
    const before = await bp.evaluate(missionSnapshot);
    await bp.context().close();
    const np = await openPage(browser, URL, { seed: 4242 });
    const now = await np.evaluate(missionSnapshot);
    await np.context().close();
    const cfgDiff = Object.keys({ ...before.cfg, ...now.cfg }).filter((k) => before.cfg[k] !== now.cfg[k]);
    check('J1 every CFG group identical to v0.8C.1 except the new `mine` group', cfgDiff.join() === 'mine', cfgDiff.join() || 'none');
    const norm = (s, id) => { if (!s) return s; if (id !== 'last-stand') return s; const o = JSON.parse(s), d = JSON.parse(o.def); d.unlocks.missions = []; o.def = JSON.stringify(d); return JSON.stringify(o); };
    const ids = Object.keys(before.missions);
    const misDiff = ids.filter((id) => norm(before.missions[id], id) !== norm(now.missions[id], id));
    const m15 = JSON.parse(JSON.parse(now.missions['last-stand']).def).unlocks.missions.join();
    check('J2 Missions 1-15 identical to v0.8C.1 (maps, enemies, objectives, extraction, story, campaign rows)', ids.length === 15 && misDiff.length === 0, misDiff.length ? `changed: ${misDiff.join()}` : `${ids.length} missions`);
    check('J3 Mission 15\'s only change: its unlock list names Mission 16', m15 === 'jungle-sweep' && Object.keys(now.missions).length === 16, m15);
  } else check('J BASE build available', false, 'BASE not set (npm test serves v0.8C.1)');

  // ================= K. PHONES =================
  const phones = [['iPhone SE', 667, 375], ['iPhone 14', 844, 390], ['Pixel 7', 915, 412]];
  for (const [name, w, h] of phones) {
    const p = await open({ viewport: { width: w, height: h }, context: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } });
    const cdp = await p.context().newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: q.x, y: q.y, id: 1 })) });
    const setup = (dx, dy) => p.evaluate(({ dx, dy }) => {
      const { g } = T.m16(); const f = T.lab([{ x: T.LAB.x + dx, y: T.LAB.y + dy }]); const x = f.mines[0];
      T.at({ x: T.LAB.x, y: T.LAB.y }); f.reveal(g, x); g.invuln = true; window.__tapField = f;
      return { ...T.client(x.pos), tap: f.num('tapRadius') };
    }, { dx, dy });
    const orders = () => p.evaluate(() => ({ orders: window.__tapField.log.orders, joy: !!window.game.input.joy }));
    // right half: a quick tap orders; a drag does not
    let q = await setup(260, 0);
    const css = 2 * q.tap * q.scale;
    await touch('touchStart', [q]); await touch('touchEnd', []);
    const right = await orders();
    q = await setup(260, 0);
    await touch('touchStart', [q]); await touch('touchMove', [{ x: q.x + 40, y: q.y + 20 }]); await touch('touchMove', [{ x: q.x + 70, y: q.y + 30 }]); await touch('touchEnd', []);
    const drag = await orders();
    // left half (the joystick side): a quick tap orders; a joystick drag does not
    q = await setup(-290, -60);
    await touch('touchStart', [q]); await touch('touchEnd', []);
    const left = await orders();
    q = await setup(-290, -60);
    await touch('touchStart', [q]); await touch('touchMove', [{ x: q.x + 30, y: q.y }]); await touch('touchMove', [{ x: q.x + 50, y: q.y }]);
    const moving = await orders();
    await touch('touchEnd', []);
    const joy = await orders();
    check(`K1 ${name}: the mine tap area is at least 44 CSS px across`, css >= 44, `${css.toFixed(1)} CSS px`);
    check(`K2 ${name}: a touch tap on a revealed mine orders it (right half and joystick half); a drag / the joystick does not`, right.orders === 1 && drag.orders === 0 && left.orders === 1 && moving.joy && joy.orders === 0, JSON.stringify({ right, drag, left, moving, joy }));
    await p.context().close();
  }

  await browser.close();
  return finish(errors);
});
