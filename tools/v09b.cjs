// v0.9B rule checks: the Mission 16 follow-ups, Mission 17 "Fuel for the Fire" with the reusable FuelDepot (src/fuel.ts)
// and Mission 18 "Ambush Alley" with the urban AmbushDirector (src/urban.ts).
//  A. Campaign: Chapter 2 is "Hostile Territory", Chapter 4 "Behind Enemy Lines" (indices and ranges unchanged);
//     Missions 17-18 rows; Mission 16 -> 17 -> 18 unlock chain (first win only, never a failure / replay); no 19+
//  B. Tactical Support vs mines: an airstrike sets off every armed mine in its circle (hidden or revealed), none
//     outside it, each once, with its normal blast (both teams); the nuke every armed mine on the map; no mine is left
//     at 1 HP; genuine objective structures keep their 1 HP floor
//  C. Fuel tanks: visible from the start, destroyed by rounds / grenades / mines / airstrikes / the nuke, explode
//     once, hurt both teams with falloff and cover, chain within chainRadius in sight (never through a wall, each tank
//     once, chains end), never an automatic target while the squad is inside the blast, auto-shot when safe, rounds
//     aimed elsewhere pass over, tap orders, kills credited to the shooter, the fuel-kills optional
//  D. Mission 17 flow: objectives, installations in any order (out of sequence / indirect never softlocks), a finite
//     response from off-screen points 520+ px from every soldier, extraction, rewards, map safety, enemy kinds
//  E. Mission 18 flow: objectives, a quiet entry, the first ambush, the crossfire (posts held), rooftop snipers (a
//     warning, a perch, a long first telegraph, killable from the street), the rear ambush (far, off screen), the
//     courtyard, the final intersection, extraction; supply caches; map safety (reachability, a second route, solid
//     buildings); rewards
//  F. Saves: SAVE_VERSION 9, every fixture loads, a save that cleared Mission 16 / 17 gets the next mission on load,
//     nothing about tanks / ambushes is saved
//  G. BASE (v0.9A, 550fcb8): every CFG group but the new `fuel` identical; Missions 1-15 identical; Mission 16
//     identical but for its unlock list
//  H. Phones (iPhone SE / 14 / Pixel 7 landscape): the tank tap area is at least 44 CSS px; a touch tap orders a tank
// Usage: npm test -- v09b   (or: npx vite preview --port 4173 & BASE=<v0.9A url> node tools/v09b.cjs)
const fs = require('fs');
const { chromium, URL, BASE, createChecks, runSuite, openPage, missionSnapshot, installPageHelpers, V09B1, V09C } = require('./lib.cjs');

/** Page-side helpers on top of window.T (tools/lib.cjs). */
function installHelpers() {
  const add = () => {
    if (!window.T || window.T.m17) return;
    const more = {
      get a() { return window.__account(); },
      get R() { return window.game.roster; },
      /** The middle of Installation A's clearing (r 340; its own tanks are replaced by lab()). */
      LAB: { x: 1500, y: 1500 },
      still() { window.game.input.move = () => ({ x: 0, y: 0 }); },
      m17(squad = ['infantry', 'heavy', 'medic'], calm = true) {
        const m = this.start('fuel-for-the-fire', squad), g = window.game;
        if (calm) this.calm();
        this.still();
        if (g.story) g.story.skip(g);
        return { g, m, d: m.mechanic('fuel') };
      },
      m18(squad = ['infantry', 'heavy', 'medic'], calm = true) {
        const m = this.start('ambush-alley', squad), g = window.game;
        if (calm) this.calm();
        this.still();
        if (g.story) g.story.skip(g);
        return { g, m, A: m.mechanic('ambush'), C: m.mechanic('caches') };
      },
      centre(z) { return { x: z.x + z.w / 2, y: z.y + z.h / 2 }; },
      /** v0.9B.1 show every concealed rooftop sniper now (so a scripted check can kill it). */
      reveal() { const g = window.game, A = g.mission.mechanic('ambush'); if (A) for (const u of [...A.hidden]) A.reveal(g, u, 'timer'); },
      /** Stand the squad at `p` for `sec` s (pinned there, story lines skipped). */
      hold(p, sec, each) { const g = window.game; this.at(p); this.step(sec, (i) => { this.pinAt(p); if (g.modal === 'story' && g.story) g.story.skip(g); if (each) each(i); }); },
      /** Replace this attempt's depot with tanks at `points` (same class, so the same rules); old tank units removed. */
      lab(points, tuning) {
        const g = window.game, m = g.mission, D = m.mechanic('fuel').constructor;
        for (const e of g.enemies) if (e.structure === 'fuel') e.state = 'dead';
        g.enemies = g.enemies.filter((e) => e.state !== 'dead');
        const bad = points.filter((p) => !g.world.isOpen(p.x, p.y));
        if (bad.length) throw new Error('lab tank off open ground: ' + JSON.stringify(bad));
        const d = new D({ tanks: points.map((p) => ({ group: 'L', ...p })), tuning });
        m.mechanics = m.mechanics.map((x) => (x.id === 'fuel' ? d : x));
        d.start(m, g);
        return d;
      },
      /** Mission 16's mine field replaced with mines at `points` (Mission 16 started, calm). */
      m16lab(points, squad = ['infantry', 'heavy', 'medic']) {
        const m = this.start('jungle-sweep', squad), g = window.game; this.calm(); this.still(); if (g.story) g.story.skip(g);
        const F = m.mechanic('mines').constructor, f = new F({ mines: points });
        m.mechanics = m.mechanics.map((x) => (x.id === 'mines' ? f : x));
        return { g, m, f };
      },
      at(p, list) { const g = window.game; this.pinAt(p, 30, list); g.cam = { ...p }; },
      /** Soldiers placed at exact points (others far away), velocity cleared. */
      place(pts) { const g = window.game; g.soldiers.forEach((s, i) => { s.pos = { ...(pts[i] || { x: pts[0].x - 900, y: pts[0].y }) }; s.vel = { x: 0, y: 0 }; }); },
      dummy(p, kind = 'rifleman', hp = 1e5) { const e = window.game.spawnEnemy({ ...p }, kind); e.setMaxHp(hp); e.guard = true; e.aggro = 1; e.fireCooldown = 1e9; return e; },
      client(p) {
        const r = document.getElementById('stage').getBoundingClientRect(), s = this.screenOf(p);
        return { x: r.left + (s.x / 1280) * r.width, y: r.top + (s.y / 720) * r.height, scale: r.width / 1280 };
      },
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
      /** Win `mission` once with roster soldiers `ids` (objectives skipped, extraction run). */
      win(ids, mission) { const g = window.game; this.deploy(ids, mission); if (g.story) g.story.skip(g); g.mission.debugReadyExtraction(g); this.extract(60); return g.phase; },
    };
    Object.defineProperties(window.T, Object.getOwnPropertyDescriptors(more));
  };
  add();
  if (!window.T) document.addEventListener('DOMContentLoaded', add);
}

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 100, detailMax: 360 });
  const browser = await chromium.launch();
  const errors = [];
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 720 }, ...(opts.context || {}) });
    await ctx.addInitScript(installPageHelpers);
    await ctx.addInitScript(installHelpers);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(opts.url || URL); await page.evaluate((raw) => { localStorage.clear(); if (raw) localStorage.setItem('minisquad.save', raw); }, opts.save || null);
    await page.goto(opts.url || URL); await page.waitForFunction(() => !!window.game && !!window.T);
    return page;
  };
  const page = await open();
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const F = await ev(() => window.__CFG.fuel);
  const MC = await ev(() => window.__CFG.mine);

  // ================= A. CAMPAIGN =================
  const camp = await ev(() => {
    const Cm = window.__campaign, row = (id) => Cm.CAMPAIGN.find((x) => x.id === id);
    const ch = Cm.CHAPTERS.map((c) => `${c.number}:${c.name}:${c.from}-${c.to === Infinity ? 'inf' : c.to}`);
    const r17 = row('fuel-for-the-fire'), r18 = row('ambush-alley');
    const brief = (d) => !!(d && d.brief && d.brief.story && d.brief.objectives && d.brief.tip);
    return {
      ch, names: Cm.CHAPTERS.map((c) => c.name).filter(Boolean),
      ch7: Cm.chapterOf(7).name, ch17: Cm.chapterOf(17).number, ch18: Cm.chapterOf(18).number,
      r17: r17 && { n: r17.number, playable: r17.playable, type: r17.type, opt: r17.optional.map((o) => o.id).join(), stars: JSON.stringify(r17.stars), brief: brief(r17), unl: r17.unlocks.missions.join() },
      r18: r18 && { n: r18.number, playable: r18.playable, type: r18.type, opt: r18.optional.map((o) => o.id).join(), stars: JSON.stringify(r18.stars), brief: brief(r18), unl: r18.unlocks.missions.join(), note: r18.unlocks.capacityNote },
      m16unl: row('jungle-sweep').unlocks.missions.join(),
      after: Cm.CAMPAIGN.filter((x) => x.number > 18).map((x) => `${x.id}:${x.playable}`),
      maxPlayable: Math.max(...Cm.CAMPAIGN.filter((x) => x.playable).map((x) => x.number)),
      cap17: Cm.capacityOf('fuel-for-the-fire'), cap18: Cm.capacityOf('ambush-alley'),
    };
  });
  check('A1 Chapter 2 is "Hostile Territory", Chapter 4 "Behind Enemy Lines"; no two chapters share a name', camp.ch.includes('2:Hostile Territory:6-10') && camp.ch.includes('4:Behind Enemy Lines:16-inf') && new Set(camp.names).size === camp.names.length && camp.ch7 === 'Hostile Territory', camp.ch.join(' | '));
  check('A2 chapter numbers and mission ranges unchanged (1: 1-5, 2: 6-10, 3: 11-15, 4: from 16)', camp.ch.map((c) => c.replace(/:[^:]*:/, ':')).join() === '1:1-5,2:6-10,3:11-15,4:16-inf', camp.ch.join(' | '));
  check('A3 Mission 17 "fuel-for-the-fire": number 17, playable, Sabotage, Chapter 4, six soldiers, the fuel-kills optional, briefing', camp.r17 && camp.r17.n === 17 && camp.r17.playable && camp.r17.type === 'sabotage' && camp.ch17 === 4 && camp.cap17 === 6 && camp.r17.opt === 'fuel-kills' && camp.r17.brief, JSON.stringify(camp.r17));
  const HAS18 = !!camp.r18; // checkpoint 1 (Mission 17 only) runs the Mission 17 checks alone
  check('A4 Mission 18 "ambush-alley": number 18, playable, Urban Ambush, Chapter 4, six soldiers, optional caches, briefing', camp.r18 && camp.r18.n === 18 && camp.r18.playable && camp.r18.type === 'urban' && camp.ch18 === 4 && camp.cap18 === 6 && camp.r18.opt === 'caches' && camp.r18.brief, JSON.stringify(camp.r18));
  check('A5 unlock chain: Mission 16 unlocks 17, 17 unlocks 18 (v0.9C: 18 unlocks Mission 19, the last playable; Mission 20 not playable)', camp.m16unl === 'fuel-for-the-fire' && (HAS18 ? camp.r17.unl === 'ambush-alley' && camp.r18.unl === 'jungle-prison' && camp.maxPlayable === 19 : camp.r17.unl === '' && camp.maxPlayable === 17) && camp.after.every((x) => x.endsWith(x.startsWith('jungle-prison:') ? ':true' : ':false')), JSON.stringify({ m16: camp.m16unl, m17: camp.r17.unl, m18: camp.r18 && camp.r18.unl, max: camp.maxPlayable, after: camp.after }));

  // unlocks through real settlements: a failure unlocks nothing, the first win unlocks the next, a replay adds nothing
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T);
  const unl = await ev((HAS18) => {
    const g = window.game, a = T.a, out = {};
    for (const id of ['last-stand', 'jungle-sweep']) if (!a.campaign.unlockedMissions.includes(id)) a.campaign.unlockedMissions.push(id);
    const ids = T.R.owned().map((s) => s.id).slice(0, 2);
    const has = (id) => a.campaign.unlockedMissions.includes(id);
    T.deploy(ids, 'jungle-sweep'); for (const s of g.soldiers) g.damage(s, 1e4); T.stepUntil(() => g.phase !== 'playing', 30);
    out.fail16 = { phase: g.phase, m17: has('fuel-for-the-fire') };
    for (const d of (a.pendingDecision ? a.pendingDecision.queue : [])) a.credits += window.__casualties.costFor(T.R.get(d.id));
    while (a.pendingDecision && a.pendingDecision.queue.length) window.__economy.resurrect(T.R, a, a.pendingDecision.queue[0].id, window.__persist);
    out.win16 = { phase: T.win(ids, 'jungle-sweep'), m17: has('fuel-for-the-fire'), m18: has('ambush-alley') };
    out.replay16 = { phase: T.win(ids, 'jungle-sweep'), n: a.campaign.unlockedMissions.filter((x) => x === 'fuel-for-the-fire').length, m18: has('ambush-alley') };
    out.win17 = { phase: T.win(ids, 'fuel-for-the-fire'), m18: has('ambush-alley'), unlocked: JSON.stringify(g.lastReward && g.lastReward.unlocked) };
    out.replay17 = { phase: T.win(ids, 'fuel-for-the-fire'), n: a.campaign.unlockedMissions.filter((x) => x === 'ambush-alley').length };
    out.win18 = HAS18 ? { phase: T.win(ids, 'ambush-alley'), list: a.campaign.unlockedMissions.slice(-3).join() } : null;
    out.rec = ['jungle-sweep', 'fuel-for-the-fire', 'ambush-alley'].map((id) => `${id}:${a.missions[id] ? a.missions[id].completions : 0}`).join();
    window.__persist();
    return out;
  }, HAS18);
  check('A6 a failed Mission 16 unlocks nothing; its first win unlocks Mission 17 (not 18); a replay adds nothing', unl.fail16.phase === 'failed' && !unl.fail16.m17 && unl.win16.phase === 'won' && unl.win16.m17 && !unl.win16.m18 && unl.replay16.n === 1 && !unl.replay16.m18, JSON.stringify({ f: unl.fail16, w: unl.win16, r: unl.replay16 }));
  if (HAS18) check('A7 the first Mission 17 win unlocks Mission 18 (once); Mission 18 unlocks nothing; completions recorded', unl.win17.phase === 'won' && unl.win17.m18 && unl.replay17.n === 1 && unl.win18.phase === 'won' && !/mission-19/.test(unl.win18.list) && /fuel-for-the-fire:2/.test(unl.rec) && /ambush-alley:1/.test(unl.rec), JSON.stringify({ w17: unl.win17, r17: unl.replay17, w18: unl.win18, rec: unl.rec }));
  await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T);
  const kept = await ev((HAS18) => ['fuel-for-the-fire', ...(HAS18 ? ['ambush-alley'] : [])].every((id) => window.__account().campaign.unlockedMissions.includes(id)), HAS18);
  check('A8 the unlocks survive a reload', kept);

  // ================= B. TACTICAL SUPPORT vs MINES =================
  const sup = await ev((MC) => {
    const S = window.__support, out = {};
    // airstrike: a revealed and a hidden mine inside the circle, a hidden one outside; a soldier and an enemy beside the inner ones
    {
      const P = { x: 1000, y: 2150 };
      const { g, f } = T.m16lab([{ x: P.x - 60, y: P.y }, { x: P.x + 60, y: P.y }, { x: P.x + 400, y: P.y }]);
      T.at({ x: P.x - 1500, y: P.y + 100 });
      f.reveal(g, f.mines[0]);
      g.soldiers[0].pos = { x: P.x - 60, y: P.y + 45 };
      const e = T.dummy({ x: P.x + 60, y: P.y + 40 }, 'rifleman', 1e4);
      const hp0 = g.soldiers[0].hp, eh0 = e.hp;
      S.airstrikeImpact(g, P, g.support);
      out.sameStep = f.mines.map((x) => x.state).join();
      out.unitHp = f.mines[0].unit ? f.mines[0].unit.hp : 'gone';
      T.step(1 / 60);
      out.after = f.mines.map((x) => `${x.state}:${x.cause}`).join();
      T.step(1);
      out.det = f.log.detonations; out.support = f.log.byCause.support;
      out.soldierLost = Math.round(hp0 - g.soldiers[0].hp); out.enemyLost = Math.round(eh0 - e.hp);
      out.noFloor = f.mines.filter((x) => x.state !== 'detonated' && x.unit && x.unit.hp <= 1).length;
      out.units = g.enemies.filter((x) => x.structure === 'mine' && x.active).length;
    }
    // nuke: every armed mine on the map (hidden, revealed), each once
    {
      const { g, f } = T.m16lab([{ x: 1000, y: 2150 }, { x: 1700, y: 1062 }, { x: 2600, y: 1450 }, { x: 3300, y: 820 }, { x: 3740, y: 1120 }]);
      T.at({ x: 240, y: 2290 });
      f.reveal(g, f.mines[1]);
      S.nukeDetonate(g, g.support);
      T.step(1);
      out.nuke = { det: f.log.detonations, all: f.mines.every((x) => x.state === 'detonated'), support: f.log.byCause.support, n: f.mines.length };
      S.nukeDetonate(g, g.support); T.step(0.5);
      out.nukeAgain = f.log.detonations;
    }
    // genuine objective structures keep their floor: an objective structure in the circle / under the nuke
    {
      const { g } = T.m16lab([]);
      T.at({ x: 240, y: 2290 });
      const o = g.spawnEnemy({ x: 1000, y: 2150 }); o.structure = 'relay'; o.objective = true; o.guard = true; o.setMaxHp(100);
      S.airstrikeImpact(g, { x: 1000, y: 2150 }, g.support); out.objAir = o.hp;
      S.nukeDetonate(g, g.support); out.objNuke = o.hp; out.objActive = o.active;
    }
    return out;
  }, MC);
  check('B1 an airstrike sets off the revealed and the hidden mine inside its circle on the next step (cause "support"); the mine outside stays hidden', sup.after === 'detonated:support,detonated:support,hidden:null' && sup.det === 2 && sup.support === 2, `${sup.sameStep} -> ${sup.after}`);
  check('B2 no mine is ever left at 1 HP (a revealed mine in the strike goes to 0 and detonates)', (sup.unitHp === 'gone' || sup.unitHp <= 0) && sup.noFloor === 0 && sup.units === 0, `unit hp ${sup.unitHp}`);
  check('B3 their blasts are normal mine blasts: the soldier and the enemy beside them are hurt (both teams, below a full-HP kill)', sup.soldierLost > 0 && sup.soldierLost < MC.damage + 1 && sup.enemyLost > 0, `soldier -${sup.soldierLost}, enemy -${sup.enemyLost}`);
  check('B4 the nuke sets off every armed mine on the map, hidden or revealed, each exactly once (a second nuke adds nothing)', sup.nuke.all && sup.nuke.det === sup.nuke.n && sup.nuke.support === sup.nuke.n && sup.nukeAgain === sup.nuke.n, JSON.stringify({ ...sup.nuke, again: sup.nukeAgain }));
  check('B5 genuine objective structures keep the 1 HP floor under an airstrike and the nuke', sup.objAir >= 1 && sup.objNuke >= 1 && sup.objActive, `airstrike -> ${sup.objAir}, nuke -> ${sup.objNuke}`);

  // ================= C. FUEL TANKS =================
  const tanks = await ev(() => {
    const { g, d } = T.m17(undefined, false), W = g.world;
    const units = g.enemies.filter((e) => e.structure === 'fuel');
    const by = {}; for (const t of d.tanks) by[t.group] = (by[t.group] || 0) + 1;
    return { n: d.tanks.length, units: units.length, open: d.tanks.filter((t) => !W.isOpen(t.pos.x, t.pos.y)).length, by: JSON.stringify(by), intact: d.tanks.every((t) => t.state === 'intact' && t.unit.active), hp: units[0] && units[0].maxHp, r: units[0] && units[0].radius };
  });
  check('C1 every tank is visible from the start: 16 fuel structures (A 4, B 5, C 7) on open ground, intact', tanks.n === 16 && tanks.units === 16 && tanks.open === 0 && tanks.by === '{"A":4,"B":5,"C":7}' && tanks.intact && tanks.hp === F.hp && tanks.r === F.radius, JSON.stringify(tanks));
  check('C2 fuel blast stronger than a mine but below the lowest class HP (75): wider radius, more damage', F.damage > MC.damage && F.damage < 75 && F.blastRadius > MC.blastRadius && F.chainRadius > F.blastRadius, JSON.stringify(F));

  const blast = await ev((F) => {
    const out = {}, L = T.LAB;
    // falloff + both teams + once: a soldier and an enemy at the same distance, another enemy out of reach
    {
      const { g } = T.m17(); const d = T.lab([{ x: L.x, y: L.y }]); const t = d.tanks[0];
      T.place([{ x: L.x - 60, y: L.y }]); g.cam = { ...L };
      const e1 = T.dummy({ x: L.x + 60, y: L.y }, 'rifleman', 1e4), e2 = T.dummy({ x: L.x + F.blastRadius + 40, y: L.y }, 'rifleman', 1e4), arm = T.dummy({ x: L.x, y: L.y - 30 }, 'armored', 1e4);
      arm.aim = Math.PI / 2; // facing the tank: no frontal plate against a blast
      const s = g.soldiers[0], s0 = s.hp, e0 = e1.hp;
      g.damage(t.unit, 1e4, s);
      out.sameStep = t.state;
      T.step(1 / 60); out.next = t.state;
      const armNow = arm.hp, eNow = e1.hp; // measured on the blast step (the soldier starts shooting the dummies afterwards)
      T.step(1);
      const exp = (dd) => F.damage * (1 - Math.min(1, dd / F.blastRadius) * (1 - F.edgeFrac));
      out.soldier = +(s0 - s.hp).toFixed(1); out.enemy = +(e0 - eNow).toFixed(1); out.expect = +exp(60).toFixed(1);
      out.far = e2.hp === e2.maxHp; out.armored = +(1e4 - armNow).toFixed(1); out.armExp = +exp(30).toFixed(1);
      out.n = d.log.explosions; out.unit = g.enemies.includes(t.unit); out.alive = s.active;
      g.damage(t.unit, 1e4, s); d.supportStrike(g.mission, g, null, Infinity); T.step(0.5); out.again = d.log.explosions;
    }
    // full-HP soldier at the centre survives one tank (never a one-hit kill)
    {
      const { g } = T.m17(['sniper']); const d = T.lab([{ x: L.x, y: L.y }]);
      T.place([{ x: L.x + 1, y: L.y + 22 }]); g.cam = { ...L };
      g.damage(d.tanks[0].unit, 1e4); T.step(0.5);
      out.sniper = { hp: Math.round(g.soldiers[0].hp), max: g.soldiers[0].maxHp, active: g.soldiers[0].active };
    }
    // cover: the B compound's west sandbag (x 2060-2076, y 470-600) between the tank and a soldier
    {
      const { g } = T.m17(); const d = T.lab([{ x: 2020, y: 535 }]);
      T.place([{ x: 2110, y: 535 }, { x: 2020, y: 620 }]); g.cam = { x: 2060, y: 560 };
      const a0 = g.soldiers[0].hp, b0 = g.soldiers[1].hp;
      g.damage(d.tanks[0].unit, 1e4); T.step(0.5);
      out.cover = { behind: Math.round(a0 - g.soldiers[0].hp), open: Math.round(b0 - g.soldiers[1].hp), clear: g.world.clear({ x: 2020, y: 535 }, { x: 2110, y: 535 }) };
    }
    return out;
  }, F);
  check('C3 a destroyed tank explodes on the next step (never inside the hit), exactly once, and its unit is removed', blast.sameStep === 'burning' && blast.next === 'exploded' && blast.n === 1 && !blast.unit && blast.again === 1, JSON.stringify({ s: blast.sameStep, n: blast.next, c: blast.n, again: blast.again }));
  check('C4 the blast hurts both teams with linear falloff (same distance, same damage); nobody outside the radius', Math.abs(blast.soldier - blast.expect) < 0.6 && Math.abs(blast.enemy - blast.expect) < 0.6 && blast.far, `soldier -${blast.soldier}, enemy -${blast.enemy}, expected ${blast.expect}`);
  check('C5 Armored Troopers take the blast in full (no frontal plate)', Math.abs(blast.armored - blast.armExp) < 0.6, `-${blast.armored} vs ${blast.armExp}`);
  check('C6 a full-HP Sniper (75 HP, the lowest class) at the centre survives one tank', blast.sniper.active && blast.sniper.hp > 0 && blast.sniper.hp < blast.sniper.max, JSON.stringify(blast.sniper));
  check('C7 solid cover shelters: a sandbag between the tank and a soldier blocks the blast; an open soldier is hit', !blast.cover.clear && blast.cover.behind === 0 && blast.cover.open > 0, JSON.stringify(blast.cover));

  const chain = await ev((F) => {
    const out = {}, L = T.LAB;
    {
      const { g } = T.m17(); const Y = L.y + 100; const d = T.lab([{ x: L.x - 150, y: Y }, { x: L.x, y: Y }, { x: L.x + 150, y: Y }, { x: L.x + 150 + F.chainRadius + 40, y: Y }]);
      T.at({ x: 240, y: 2260 }); g.cam = { ...L };
      g.damage(d.tanks[0].unit, 1e4);
      const times = [];
      const t = T.stepUntil(() => { d.tanks.forEach((k, i) => { if (k.state === 'exploded' && times[i] === undefined) times[i] = +g.time.toFixed(3); }); return false; }, 3);
      out.states = d.tanks.map((k) => k.state).join(); out.times = times; out.n = d.log.explosions; out.chain = d.log.byCause.chain; out.longest = d.log.longestChain; void t;
      out.gap = times[1] !== undefined && times[2] !== undefined ? +(times[2] - times[1]).toFixed(3) : null;
    }
    // no chain through a wall (the west sandbag of B)
    {
      const { g } = T.m17(); const d = T.lab([{ x: 2020, y: 535 }, { x: 2110, y: 535 }]);
      T.at({ x: 1400, y: 1300 }); g.cam = { x: 2060, y: 560 };
      g.damage(d.tanks[0].unit, 1e4); T.step(2);
      out.wall = d.tanks.map((k) => k.state).join();
    }
    // a cluster that chains end to end ends after every tank went off once
    {
      const { g } = T.m17(); const ring = [0, 1, 2, 3, 4, 5].map((k) => ({ x: L.x + 20 + Math.cos(k * Math.PI / 3) * 120, y: L.y + 60 + Math.sin(k * Math.PI / 3) * 120 }));
      const d = T.lab(ring); T.at({ x: 240, y: 2260 }); g.cam = { ...L };
      g.damage(d.tanks[3].unit, 1e4); T.step(4);
      out.ring = { n: d.log.explosions, all: d.tanks.every((k) => k.state === 'exploded'), burning: d.tanks.filter((k) => k.state === 'burning').length };
    }
    return out;
  }, F);
  check(`C8 chains: tanks ${F.chainRadius} px or closer in sight go off one after another (${F.chainDelay} s apart); one farther away does not`, chain.states === 'exploded,exploded,exploded,intact' && chain.n === 3 && chain.chain === 2 && chain.longest === 3 && Math.abs(chain.gap - F.chainDelay) < 0.03, JSON.stringify(chain));
  check('C9 no chain through a wall (a sandbag between two close tanks)', chain.wall === 'exploded,intact', chain.wall);
  check('C10 a chain always ends: a six-tank cluster explodes once each, nothing keeps burning', chain.ring.n === 6 && chain.ring.all && chain.ring.burning === 0, JSON.stringify(chain.ring));

  const sources = await ev((F) => {
    const out = {}, L = T.LAB, S = window.__support, Cb = window.__combat;
    const one = (fn) => { const { g } = T.m17(); const d = T.lab([{ x: L.x, y: L.y }]); T.at({ x: 240, y: 2260 }); g.cam = { ...L }; fn(g, d.tanks[0], d); T.step(1); return `${d.tanks[0].state}:${d.tanks[0].cause}`; };
    out.grenade = one((g, t) => Cb.explode(g, { x: t.pos.x + 20, y: t.pos.y }, window.__CFG.grenade.radius, window.__CFG.grenade.damage, window.__CFG.grenade.edgeDamageFrac, g.enemies, g.soldiers[0], true));
    out.airstrike = one((g, t) => S.airstrikeImpact(g, { x: t.pos.x + 90, y: t.pos.y }, g.support));
    out.nuke = one((g) => S.nukeDetonate(g, g.support));
    out.airMiss = one((g, t) => S.airstrikeImpact(g, { x: t.pos.x + 300, y: t.pos.y }, g.support));
    // a mine blast (Mission 16 mine fields next to tanks): one right beside a tank sets it off, one 60 px away only damages it
    {
      const { g, m, f } = T.m16lab([{ x: 1000, y: 2150 }, { x: 1000, y: 1880 }]);
      const D = window.__fuelDepot;
      const d = new D({ tanks: [{ x: 1006, y: 2150, group: 'X' }, { x: 1060, y: 1880, group: 'X' }] }); m.mechanics.push(d); d.start(m, g);
      T.at({ x: 240, y: 2290 }); g.cam = { x: 1000, y: 2150 };
      f.detonate(g, f.mines[0], 'shot'); f.detonate(g, f.mines[1], 'shot'); T.step(1);
      out.mine = `${d.tanks[0].state}:${d.tanks[0].cause}`;
      out.mineFar = `${d.tanks[1].state}:${Math.round(d.tanks[1].unit.hp)}/${d.tanks[1].unit.maxHp}`;
    }
    // a tank blast sets off a revealed mine beside it
    {
      const { g, m, f } = T.m16lab([{ x: 1000, y: 2150 }]);
      const d = new window.__fuelDepot({ tanks: [{ x: 1060, y: 2150, group: 'X' }] }); m.mechanics.push(d); d.start(m, g);
      T.at({ x: 240, y: 2290 }); g.cam = { x: 1000, y: 2150 }; f.reveal(g, f.mines[0]);
      g.damage(d.tanks[0].unit, 1e4); T.step(1);
      out.tankMine = `${f.mines[0].state}:${f.mines[0].cause}`;
    }
    return out;
  }, F);
  check('C11 a grenade, an airstrike (inside its circle) and the nuke destroy a tank; an airstrike that misses does not', /^exploded:shot$/.test(sources.grenade) && /^exploded:support$/.test(sources.airstrike) && /^exploded:support$/.test(sources.nuke) && /^intact/.test(sources.airMiss), JSON.stringify(sources));
  check('C12 a mine blast right beside a tank sets it off (one 60 px away only damages it); a tank blast sets off a revealed mine beside it', /^exploded/.test(sources.mine) && /^intact:(\d+)\/50$/.test(sources.mineFar) && +sources.mineFar.split(':')[1].split('/')[0] < 50 && /^detonated:shot$/.test(sources.tankMine), `${sources.mine} / ${sources.mineFar} / ${sources.tankMine}`);

  const tgt = await ev((F) => {
    const out = {}, L = T.LAB;
    const watch = (g, t, sec) => { let aimed = 0; T.step(sec, () => { for (const s of g.soldiers) if (s.target === t.unit) aimed++; }); return aimed; };
    // inside the safe distance: never shot automatically
    {
      const { g } = T.m17(['infantry', 'heavy', 'medic']); const d = T.lab([{ x: L.x + 130, y: L.y }]); const t = d.tanks[0];
      T.at({ ...L }); T.step(0.05, () => T.pinAt(L));
      out.close = { aimed: watch(g, t, 5), state: t.state, hp: t.unit.hp };
    }
    // a downed soldier beside the tank counts too
    {
      const { g } = T.m17(['infantry', 'heavy', 'medic']); const d = T.lab([{ x: L.x + 300, y: L.y }]); const t = d.tanks[0];
      T.at({ ...L }); g.soldiers[2].pos = { x: L.x + 330, y: L.y + 40 }; g.downSoldier(g.soldiers[2]);
      out.downed = { aimed: watch(g, t, 4), state: t.state };
    }
    // everyone outside: auto-shot (lowest priority, no enemy in sight)
    {
      const { g } = T.m17(['infantry', 'heavy', 'medic']); const d = T.lab([{ x: L.x + 300, y: L.y }]); const t = d.tanks[0];
      T.at({ ...L });
      const tt = T.stepUntil(() => t.state !== 'intact', 8);
      out.safe = { state: t.state, t: +tt.toFixed(2) };
    }
    // an enemy in sight comes first; the tank waits
    {
      const { g } = T.m17(['infantry', 'heavy', 'medic']); const d = T.lab([{ x: L.x + 300, y: L.y - 40 }]); const t = d.tanks[0];
      T.at({ ...L }); const e = T.dummy({ x: L.x + 260, y: L.y + 60 });
      let first = null; T.step(2, () => { if (!first) for (const s of g.soldiers) if (s.target) { first = s.target === e ? 'enemy' : s.target === t.unit ? 'tank' : 'other'; break; } });
      out.priority = { first, state: t.state };
    }
    // rounds aimed at an enemy pass over a tank in the line of fire
    {
      const { g } = T.m17(['infantry']); const d = T.lab([{ x: L.x + 120, y: L.y }]); const t = d.tanks[0];
      T.place([{ x: L.x, y: L.y }]); g.cam = { ...L };
      const e = T.dummy({ x: L.x + 260, y: L.y });
      T.step(3, () => { g.soldiers[0].pos = { x: L.x, y: L.y }; g.soldiers[0].vel = { x: 0, y: 0 }; });
      out.through = { hp: t.unit.hp, max: t.unit.maxHp, enemyHit: e.hp < e.maxHp };
    }
    // tap orders: Game.onTap on a tank orders it (even inside the safe distance), a ground tap does not; the order ends with the tank
    {
      const { g } = T.m17(['infantry', 'heavy', 'medic']); const d = T.lab([{ x: L.x + 150, y: L.y }]); const t = d.tanks[0];
      T.at({ ...L }); T.step(0.05, () => T.pinAt(L)); g.invuln = true;
      const miss = g.onTap(T.screenOf({ x: L.x + 150, y: L.y + F.tapRadius + 30 }));
      out.miss = { took: miss, orders: d.log.orders };
      g.onTap(T.screenOf({ x: t.pos.x + 10, y: t.pos.y - 15 }));
      out.ordered = { orders: d.log.orders, all: g.soldiers.every((s) => s.order === t.unit) };
      const tt = T.stepUntil(() => t.state === 'exploded', 6, () => T.pinAt(L));
      T.step(0.1);
      out.done = { state: t.state, t: +tt.toFixed(2), order: d.order, cleared: g.soldiers.every((s) => s.order === null && s.target !== t.unit) };
      g.invuln = false;
    }
    return out;
  }, F);
  check(`C13 never an automatic target while a soldier stands within ${F.safeDist} px (idle squad 130 px away, 5 s)`, tgt.close.aimed === 0 && tgt.close.state === 'intact' && tgt.close.hp === F.hp, JSON.stringify(tgt.close));
  check('C14 a downed soldier inside the safe distance also keeps the squad from shooting it', tgt.downed.aimed === 0 && tgt.downed.state === 'intact', JSON.stringify(tgt.downed));
  check('C15 with nobody near it and no enemy in sight the squad shoots it automatically', tgt.safe.state !== 'intact', JSON.stringify(tgt.safe));
  check('C16 an enemy in sight is shot before a tank (structures last)', tgt.priority.first === 'enemy', JSON.stringify(tgt.priority));
  check('C17 rounds aimed at an enemy pass over a tank in the line of fire', tgt.through.hp === tgt.through.max && tgt.through.enemyHit, JSON.stringify(tgt.through));
  check('C18 a tap on a tank orders the squad to shoot it (even up close); a tap beside it does not; the order ends when it explodes', !tgt.miss.took && tgt.miss.orders === 0 && tgt.ordered.orders === 1 && tgt.ordered.all && tgt.done.state === 'exploded' && !tgt.done.order && tgt.done.cleared, JSON.stringify(tgt));

  const credit = await ev(() => {
    const out = {}, L = T.LAB;
    const { g, m } = T.m17(['infantry', 'heavy', 'medic']); const d = T.lab([{ x: L.x + 300, y: L.y }, { x: L.x + 420, y: L.y }]);
    T.at({ ...L }); g.cam = { x: L.x + 300, y: L.y };
    const foes = [0, 1, 2, 3, 4, 5].map((k) => { const e = T.dummy({ x: L.x + 300 + (k % 3) * 30 - 30 + (k > 2 ? 120 : 0), y: L.y + 30 + (k % 2) * 20 }, 'rifleman', 40); return e; });
    const s = g.soldiers[1], id = s.identity.id;
    const k0 = g.stats.bySoldier.get(id).kills;
    g.damage(d.tanks[0].unit, 1e4, s); T.step(1.5);
    out.kills = g.stats.bySoldier.get(id).kills - k0; out.log = d.log.enemyKills; out.dead = foes.filter((e) => !e.active).length;
    out.opt = m.optionals.map((o) => `${o.id}:${o.state}:${o.status(m)}`).join();
    out.credit = d.tanks.map((t) => (t.credit === s ? 'S' : t.credit ? 'other' : '-')).join();
    return out;
  });
  check('C19 environmental kills are credited: the soldier who shot the tank gets the kills of its blast (and of the chain)', credit.kills === credit.dead && credit.dead >= 5 && credit.log === credit.dead && credit.credit === 'S,S', JSON.stringify(credit));
  check('C20 the optional "Take out 5 enemies with fuel explosions" counts them and completes', /fuel-kills:complete:DONE/.test(credit.opt), credit.opt);

  // ================= D. MISSION 17 FLOW =================
  const flow = await ev(() => {
    const out = {};
    const { g, m, d } = T.m17(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], false);
    out.prim = m.primaries.map((o) => o.id).join(); out.mech = m.mechanics.map((x) => x.id).join(); out.story = JSON.stringify(m.script.story);
    const kinds = {}; for (const e of g.enemies) if (!e.structure) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    out.kinds = JSON.stringify(kinds); out.placed = g.enemies.filter((e) => !e.structure).length;
    // out of sequence: Installation C's tanks burn first (during the approach), then B, then A
    T.calm((e) => e.structure === 'fuel'); g.invuln = true;
    for (const t of d.tanks.filter((k) => k.group === 'C')) d.explode(g, t);
    T.step(0.5);
    out.cur0 = m.currentObjective && m.currentObjective.id;
    const z = m.primaries[0].zone; T.at({ x: z.x + z.w / 2, y: z.y + z.h / 2 }); T.step(0.5, () => T.pinAt({ x: z.x + z.w / 2, y: z.y + z.h / 2 }));
    out.cur1 = m.currentObjective.id; out.chips1 = m.currentObjective.chips(m).map((c) => `${c.label}:${c.state}`).join();
    for (const t of d.tanks.filter((k) => k.group === 'B')) d.explode(g, t); T.step(0.5);
    out.cur2 = m.currentObjective.id;
    // one A tank by the nuke-style support path, the rest by rounds
    d.supportStrike(m, g, null, Infinity); T.step(1);
    out.cur3 = m.currentObjective && m.currentObjective.id;
    // the response: waves spawn off screen, 520+ px from every soldier, finite
    const R = m.currentObjective; const spawnInfo = [];
    T.at({ x: 3500, y: 1450 });
    const seen = new Set();
    T.step(40, () => {
      T.pinAt({ x: 3500, y: 1450 });
      for (const u of R.units) if (!seen.has(u)) { seen.add(u); spawnInfo.push({ on: g.isOnScreen(u.pos, 0), d: Math.min(...g.soldiers.filter((s) => s.state === 'active' || s.state === 'downed').map((s) => Math.hypot(s.pos.x - u.pos.x, s.pos.y - u.pos.y))) }); }
    });
    out.resp = { fired: R.fired, n: R.units.length, total: R.total, onScreen: spawnInfo.filter((x) => x.on).length, minD: Math.round(Math.min(...spawnInfo.map((x) => x.d))), kinds: [...new Set(R.units.map((u) => u.kind))].sort().join() };
    const before = R.units.length; T.kill(() => true); T.step(1);
    out.cur4 = m.phase; out.more = R.units.length - before;
    T.step(20); out.extra = g.enemies.filter((e) => e.active && !e.structure).length;
    out.ext = T.extract(60); out.phase = g.phase;
    g.invuln = false;
    return out;
  });
  check('D1 Mission 17 objectives: approach -> installations -> response (then extraction); the "fuel" mechanic (v0.9B.1: + "counterattack"); radio cues', flow.prim === 'approach,installations,response' && flow.mech === 'fuel,counterattack' && /cue:fuel/.test(flow.story) && /start:response/.test(flow.story), `${flow.prim} / ${flow.mech} / ${flow.story}`);
  check('D2 existing enemy kinds only (Riflemen, Armored Troopers, Snipers; no Scout), 45 placed (v0.9B.1: 34 + 11 on the approaches)', /^\{("(armored|rifleman|sniper)":\d+,?){3}\}$/.test(flow.kinds) && flow.placed === 45, `${flow.placed}: ${flow.kinds}`);
  check('D3 installations destroyed out of order and indirectly (C before the approach, B, then a support strike on A) never softlock: each is counted, the objective completes', flow.cur0 === 'approach' && flow.cur1 === 'installations' && /C:done/.test(flow.chips1) && /A:live/.test(flow.chips1) && flow.cur2 === 'installations' && flow.cur3 === 'response', JSON.stringify({ c0: flow.cur0, c1: flow.cur1, chips: flow.chips1, c2: flow.cur2, c3: flow.cur3 }));
  check('D4 the enemy response is finite: 3 waves, 12 enemies, all spawned off screen and 520+ px from every soldier', flow.resp.fired === 3 && flow.resp.n === 12 && flow.resp.total === 12 && flow.resp.onScreen === 0 && flow.resp.minD >= 520 && flow.resp.kinds === 'armored,rifleman,sniper', JSON.stringify(flow.resp));
  check('D5 once the response is down: extraction opens, nothing else spawns, the helicopter extracts the squad', flow.cur4 === 'toExtraction' && flow.more === 0 && flow.extra === 0 && flow.phase === 'won', JSON.stringify({ phase: flow.cur4, more: flow.more, extra: flow.extra, end: flow.phase }));

  const map17 = await ev((F) => {
    const { g, d } = T.m17(undefined, false), W = g.world, st = g.map.start, free = T.fill(W, st);
    const z = g.mission.extraction.zone, sz = g.map.startZone;
    const dStart = Math.min(...d.tanks.map((t) => Math.max(0, Math.max(sz.x - t.pos.x, t.pos.x - sz.x - sz.w, sz.y - t.pos.y, t.pos.y - sz.y - sz.h))));
    // every tank reachable within weapon range: an open cell within 200 px with a clear line to it
    const shootable = d.tanks.filter((t) => { for (let a = 0; a < 16; a++) for (const r of [140, 200, 260]) { const p = { x: t.pos.x + Math.cos(a / 16 * Math.PI * 2) * r, y: t.pos.y + Math.sin(a / 16 * Math.PI * 2) * r }; if (p.x > 0 && p.y > 0 && p.x < g.map.w && p.y < g.map.h && W.isOpen(p.x, p.y) && free[W.idx(p.x, p.y)] && W.clear(p, t.pos)) return true; } return false; }).length;
    return {
      enemies: g.enemies.filter((e) => !e.structure).length, unreach: g.enemies.filter((e) => !e.structure && !free[W.idx(e.pos.x, e.pos.y)]).map((e) => e.tag),
      ext: !!free[W.idx(z.x + z.w / 2, z.y + z.h / 2)], dStart: Math.round(dStart), shootable, tanks: d.tanks.length,
      approach: !!free[W.idx(g.mission.primaries[0].zone.x + 100, g.mission.primaries[0].zone.y + 140)],
      theme: g.map.theme, w: g.map.w, h: g.map.h,
    };
  }, F);
  check('D6 map safety: every placed enemy, the approach zone and the helicopter are reachable from the landing zone', map17.unreach.length === 0 && map17.ext && map17.approach, JSON.stringify(map17));
  check('D7 every tank can be shot from reachable open ground; no tank blast ring reaches the start zone', map17.shootable === map17.tanks && map17.dStart > F.blastRadius + 200, `${map17.shootable}/${map17.tanks} shootable, nearest tank ${map17.dStart} px from the start zone`);

  const cue = await ev(() => {
    const { g, m } = T.m17(); g.story.log.length = 0;
    T.at({ x: 880, y: 1910 }); T.step(0.5, () => T.pinAt({ x: 880, y: 1910 }));
    const early = g.story.log.join();
    T.at({ x: 1150, y: 1650 }); T.step(0.5, () => T.pinAt({ x: 1150, y: 1650 }));
    T.at({ x: 1250, y: 1650 }); T.step(0.5, () => T.pinAt({ x: 1250, y: 1650 }));
    return { early, log: g.story.log.join(), cur: m.currentObjective.id };
  });
  check('D8 Overwatch explains the fuel tanks once on the way into Installation A, then names the three installations', !/m17-fuel/.test(cue.early) && (cue.log.match(/m17-fuel/g) || []).length === 1 && /m17-depot/.test(cue.log), JSON.stringify(cue));

  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T);
  const rw = await ev(() => {
    const g = window.game, a = T.a; window.__debugUnlockAll();
    const ids = T.R.owned().map((s) => s.id).slice(0, 3), out = {};
    const run = () => { T.deploy(ids, 'fuel-for-the-fire'); if (g.story) g.story.skip(g); const m = g.mission; m.optionals[0].complete(m, g); m.debugReadyExtraction(g); T.extract(60); const r = g.lastReward; return { phase: g.phase, first: r && r.firstClear, credits: r && r.credits, lines: r && JSON.stringify(r.lines || r.creditLines || ''), stars: g.lastStars && g.lastStars.stars }; };
    out.first = run(); out.replay = run(); out.rec = a.missions['fuel-for-the-fire'];
    return out;
  });
  check('D9 first clear pays first-time Credits with 3 stars (optional, no KIA); a replay pays less, no second first-clear bonus, best stars kept', rw.first.phase === 'won' && rw.first.first && rw.first.stars === 3 && rw.replay.phase === 'won' && !rw.replay.first && rw.replay.credits < rw.first.credits && rw.rec.completions === 2 && rw.rec.bestStars === 3, JSON.stringify({ f: rw.first.credits, r: rw.replay, rec: rw.rec }));

  // ================= E. MISSION 18 =================
  const f18 = await ev(() => {
    const out = {};
    const { g, m, A } = T.m18(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], false);
    const Z = window.__alley.ALLEY_ZONES;
    g.invuln = true; g.story.log.length = 0;
    out.prim = m.primaries.map((o) => o.id).join(); out.mech = m.mechanics.map((x) => x.id).join(); out.story = JSON.stringify(m.script.story);
    const kinds = {}; for (const e of g.enemies) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    for (const d of A.defs) for (const gr of d.groups) for (const k of gr.kinds) kinds[k] = (kinds[k] || 0) + 1;
    out.kinds = JSON.stringify(Object.fromEntries(Object.entries(kinds).sort())); out.placed = g.enemies.length;
    out.ambushTotal = A.defs.reduce((n, d) => n + d.groups.reduce((k, gr) => k + gr.kinds.length, 0), 0);
    const ambushTags = A.defs.map((d) => d.id);
    out.start = { sprung: A.log.sprung.length, units: g.enemies.filter((e) => ambushTags.includes(e.tag)).length };
    // quiet entry: the district, Overwatch's warning, nothing sprung
    T.hold(T.centre(Z.district), 1);
    out.c1 = m.currentObjective.id; out.quiet = g.story.log.join(); out.sprung1 = A.log.sprung.join();
    // the first ambush: arms in its zone, its radio line at once, its enemies `delay` s later
    T.hold(T.centre(Z.first), 1);
    out.first = { armed: A.state('first').armedAt >= 0, sprung: A.sprung('first'), cue: /m18-first/.test(g.story.log.join()) };
    T.hold(T.centre(Z.first), 1);
    out.first.after = A.sprung('first'); out.first.n = A.state('first').units.length;
    T.kill((e) => e.tag === 'first' || e.tag === 'street-post');
    out.c2 = m.currentObjective.id;
    // v0.9B.1 the flankers: 6.5 s after the first ambush armed, from V1 behind the squad
    T.hold(T.centre(Z.first), 5); out.flank = { sprung: A.sprung('first-flank'), n: A.state('first-flank').units.length };
    T.kill((e) => e.tag === 'first-flank');
    // the crossfire: two groups to posts either side of V2, holding them; v0.9B.1 a late group 8 s in
    T.hold(T.centre(Z.cross), 2.5);
    const cf = A.state('crossfire');
    out.cross = { sprung: A.sprung('crossfire'), n: cf.units.length, held: cf.units.filter((u) => u.holdPos).length, north: cf.units.filter((u) => u.holdPos && u.holdPos.y < 1310).length, south: cf.units.filter((u) => u.holdPos && u.holdPos.y > 1490).length, late: A.sprung('crossfire-late') };
    const hp = cf.units.map((u) => u.maxHp); for (const u of cf.units) u.setMaxHp(1e6); // they survive the walk to their posts
    T.hold(T.centre(Z.cross), 20);
    out.cross.atPosts = cf.units.filter((u) => u.active && u.holdPos && Math.hypot(u.pos.x - u.holdPos.x, u.pos.y - u.holdPos.y) < 90).length;
    out.cross.lateN = A.state('crossfire-late').units.length;
    out.c3 = m.currentObjective.id;
    cf.units.forEach((u, i) => u.setMaxHp(hp[i]));
    T.kill((e) => e.tag === 'crossfire' || e.tag === 'crossfire-late'); T.step(0.2);
    out.c4 = m.currentObjective.id;
    // the rooftops: the warning first, the snipers 2.5 s later, each on a roof perch (v0.9B.1: concealed until they have a shot)
    g.story.log.length = 0;
    const rz = T.centre(Z.rooftops); let cueAt = -1, sprungAt = -1; const t0 = g.time;
    T.hold(rz, 5, () => { if (cueAt < 0 && /m18-rooftops/.test(g.story.log.join())) cueAt = g.time; if (sprungAt < 0 && A.sprung('rooftops')) sprungAt = g.time; });
    const roofs = g.map.obstacles.filter((o) => o.kind === 'roof');
    const ru = A.state('rooftops').units;
    out.roof = { cue: +(cueAt - t0).toFixed(2), lead: +(sprungAt - cueAt).toFixed(2), n: ru.length, kinds: [...new Set(ru.map((u) => u.kind))].join(), onPerch: ru.filter((u) => roofs.some((o) => u.pos.x > o.x && u.pos.x < o.x + o.w && u.pos.y > o.y && u.pos.y < o.y + o.h)).length, fixed: ru.filter((u) => u.fixed && u.rooftop).length, hidden: ru.filter((u) => A.isHidden(u) && !g.enemies.includes(u)).length, shown: ru.filter((u) => !A.isHidden(u) && g.enemies.includes(u)).length, sighted: A.log.reveals.filter((r) => r.id === 'rooftops' && r.why === 'sight' && r.aimed).length };
    T.reveal(); T.kill((e) => e.tag === 'rooftops' || e.tag === 'sniper-street');
    out.c5 = m.currentObjective.id; out.rearEarly = A.sprung('rear');
    // the rear ambush: once the squad pushes east, from behind, far and off screen (v0.9B.1: a second group 5 s later)
    T.hold({ x: 2800, y: 1400 }, 3);
    out.rear = { sprung: A.sprung('rear'), n: A.state('rear').units.length, second: A.sprung('rear-2') };
    T.kill((e) => e.tag === 'rear');
    T.hold({ x: 2800, y: 1400 }, 5); out.rear.n2 = A.state('rear-2').units.length;
    T.kill((e) => e.tag === 'rear-2');
    out.c6 = m.currentObjective.id;
    // v0.9B.1 the courtyard: its garrison, a concealed sniper across Main Street and three from North Avenue 10 s in
    T.hold({ x: 3060, y: 1400 }, 11);
    out.court = { roof: A.sprung('courtyard-roof'), wave: A.state('courtyard-wave').units.length };
    T.reveal(); T.kill((e) => e.tag === 'courtyard' || e.tag === 'courtyard-roof' || e.tag === 'courtyard-wave');
    out.c7 = m.currentObjective.id; out.finalCue = /m18-final/.test(g.story.log.join());
    T.hold({ x: 3700, y: 1400 }, 2);
    out.fin = { roof: A.sprung('final-roof'), wave: A.sprung('final-wave') };
    T.hold({ x: 3700, y: 1400 }, 9);
    out.fin.wave2 = A.sprung('final-wave'); out.fin.n = A.state('final-wave').units.length;
    T.hold({ x: 3700, y: 1400 }, 14); out.fin.n2 = A.state('final-wave-2').units.length;
    T.reveal(); T.kill((e) => /^final/.test(e.tag || ''));
    out.c8 = m.phase;
    T.step(20); out.extra = g.enemies.filter((e) => e.active).length;
    out.spawns = A.log.spawns.filter((x) => !/roof/.test(x.id)).map((x) => ({ id: x.id, d: x.minSoldierDist, on: x.onScreen }));
    out.ext = T.extract(60); out.phase = g.phase;
    return out;
  });
  const minFor = (id) => Math.min(...f18.spawns.filter((x) => x.id === id).map((x) => x.d));
  check('E1 Mission 18 objectives: district -> street -> rooftops -> courtyard -> final (then extraction); "ambush" + "caches" mechanics; radio lines', f18.prim === 'district,street,rooftops,courtyard,final' && f18.mech === 'ambush,caches' && ['start:street', 'cue:first', 'cue:crossfire', 'cue:rooftops', 'cue:rear', 'start:courtyard', 'start:final', 'victory'].every((k) => f18.story.includes(`"${k}"`)), `${f18.prim} / ${f18.mech} / ${f18.story}`);
  // v0.9B.1 (on purpose): 65 enemies in staggered groups (rifleman swarms), concealed rooftop snipers; see v09b1 for the rest
  // v0.9B.2 (on purpose): + two isolated rooftop snipers (avenue-roof, cache-roof; tools/v09b2.cjs)
  check('E2 existing enemy kinds only (Riflemen, Armored Troopers, Snipers): 20 placed + 47 from ambushes = 67 (v0.9B.2; v0.9B.1 65, v0.9B 43), finite', f18.kinds === '{"armored":9,"rifleman":49,"sniper":9}' && f18.placed === 20 && f18.ambushTotal === 47, `${f18.placed} + ${f18.ambushTotal}: ${f18.kinds}`);
  check('E3 a quiet entry: no ambush unit at the start; reaching the district plays Overwatch\'s warning; nothing springs there', f18.start.sprung === 0 && f18.start.units === 0 && f18.c1 === 'street' && /m18-quiet/.test(f18.quiet) && f18.sprung1 === '', JSON.stringify({ start: f18.start, c1: f18.c1, log: f18.quiet, sprung: f18.sprung1 }));
  check('E4 the first ambush: its radio line as it arms, its 6 riflemen 1.5 s later, then 3 flankers; off screen and 420+ px from every soldier', f18.first.armed && !f18.first.sprung && f18.first.cue && f18.first.after && f18.first.n === 6 && f18.flank.sprung && f18.flank.n === 3 && minFor('first') >= 420 && minFor('first-flank') >= 420 && f18.spawns.filter((x) => /^first/.test(x.id)).every((x) => !x.on), JSON.stringify({ ...f18.first, flank: f18.flank, min: minFor('first'), minF: minFor('first-flank') }));
  check('E5 the crossfire: 8 enemies, 4 posted north and 4 south of the intersection, they reach their posts and hold, then 5 more 8 s in; off screen, 420+ px', f18.cross.sprung && f18.cross.n === 8 && f18.cross.north === 4 && f18.cross.south === 4 && f18.cross.atPosts === 8 && !f18.cross.late && f18.cross.lateN === 5 && minFor('crossfire') >= 420 && minFor('crossfire-late') >= 420 && f18.spawns.filter((x) => /^crossfire/.test(x.id)).every((x) => !x.on) && f18.c3 === 'street' && f18.c4 === 'rooftops', JSON.stringify({ ...f18.cross, min: minFor('crossfire'), c3: f18.c3, c4: f18.c4 }));
  check('E6 the rooftops: Overwatch warns first, 2.5 s later the 3 snipers take their roof perches (fixed), concealed: not in the enemy list unless one already has a shot (revealed on sight, aiming)', f18.roof.cue >= 0 && Math.abs(f18.roof.lead - 2.5) < 0.05 && f18.roof.n === 3 && f18.roof.kinds === 'sniper' && f18.roof.onPerch === 3 && f18.roof.fixed === 3 && f18.roof.hidden >= 1 && 3 - f18.roof.hidden === f18.roof.sighted, JSON.stringify(f18.roof));
  check('E7 the rear ambush springs only after the rooftops, once the squad pushes east: 5 enemies, then 3 more, off screen, 600+ px from every soldier', !f18.rearEarly && f18.rear.sprung && f18.rear.n === 5 && !f18.rear.second && f18.rear.n2 === 3 && minFor('rear') >= 600 && minFor('rear-2') >= 600 && f18.spawns.filter((x) => /^rear/.test(x.id)).every((x) => !x.on) && f18.c5 === 'rooftops' && f18.c6 === 'courtyard', JSON.stringify({ ...f18.rear, early: f18.rearEarly, min: minFor('rear'), c5: f18.c5, c6: f18.c6 }));
  check('E8 the courtyard (a rooftop sniper, 3 more 10 s in), then the final intersection: its line, a rooftop sniper at once, 4 more 10 s in and 3 more 24 s in (off screen, 560+ px); then extraction, nothing more, the helicopter', f18.court.roof && f18.court.wave === 3 && f18.c7 === 'final' && f18.finalCue && f18.fin.roof && !f18.fin.wave && f18.fin.wave2 && f18.fin.n === 4 && f18.fin.n2 === 3 && minFor('final-wave') >= 560 && minFor('final-wave-2') >= 560 && f18.c8 === 'toExtraction' && f18.extra === 0 && f18.phase === 'won', JSON.stringify({ court: f18.court, c7: f18.c7, cue: f18.finalCue, ...f18.fin, min: minFor('final-wave'), c8: f18.c8, extra: f18.extra, end: f18.phase }));

  // rooftop snipers: a readable first shot, killable from the street, never reachable on foot
  const roofT = await ev(() => {
    const { g, m, A } = T.m18(['infantry', 'heavy', 'medic']); g.invuln = true;
    const C = window.__CFG.enemySniper, st = A.state('rooftops'), street = { x: 2440, y: 1400 };
    T.at(street); A.spring(m, g, st);
    const us = st.units, first = new Map(), shot = new Map(), hp0 = us.map((u) => u.maxHp);
    for (const u of us) u.setMaxHp(1e6);
    T.step(8, (i) => { T.pinAt(street); for (const u of us) { if (u.target && !first.has(u)) first.set(u, g.time); if (u.shots > 0 && !shot.has(u)) shot.set(u, g.time); } });
    const waits = us.filter((u) => first.has(u) && shot.has(u)).map((u) => +(shot.get(u) - first.get(u)).toFixed(2));
    const W = g.world;
    const walk = us.filter((u) => W.isOpen(u.pos.x, u.pos.y)).length;
    const sight = us.filter((u) => W.clear(street, u.pos)).length;
    us.forEach((u, i) => u.setMaxHp(hp0[i]));
    // each one from Main Street below it: the first open street spot 160-300 px away with a clear line
    const tK = [], lanes = [];
    for (const u of us) {
      let p = null;
      for (const y of [1400, 1360, 1440]) for (let x = u.pos.x - 300; x <= u.pos.x + 300 && !p; x += 20) { const q = { x, y }, dd = Math.hypot(x - u.pos.x, y - u.pos.y); if (dd >= 160 && dd <= 300 && W.isOpen(x, y) && W.clear(q, u.pos)) p = q; }
      lanes.push(!!p); if (!p) continue;
      tK.push(+T.stepUntil(() => !u.active, 30, () => T.pinAt(p)).toFixed(1));
    }
    return { aim: C.aimTime, glint: A.glint, waits, glints: A.log.glints, walk, sight, lanes: lanes.filter(Boolean).length, dead: us.filter((u) => !u.active).length, tK, n: us.length };
  });
  check('E9 a rooftop sniper\'s first shot comes at least aimTime + glint (v0.9B.1: 1.2 s) after it takes aim (its laser shows the whole time)', roofT.waits.length === roofT.n && roofT.waits.every((w) => w >= roofT.aim + roofT.glint - 0.02) && roofT.glints === roofT.n, JSON.stringify(roofT));
  check('E10 rooftop snipers are shot down from the street (each from a Main Street spot with a clear line, normal HP; v0.9B.1: the corner perch is past the one fixed spot) and stand where no soldier can walk', roofT.sight >= 1 && roofT.lanes === roofT.n && roofT.dead === roofT.n && roofT.walk === 0, JSON.stringify(roofT));

  const caches = await ev(() => {
    const { g, m, C } = T.m18(['infantry', 'heavy', 'medic']); g.invuln = true;
    const o = m.optionals[0], p0 = g.pickups.length, out = { n: C.caches.length };
    const c0 = C.caches[0].pos; T.hold({ x: c0.x, y: c0.y + 20 }, 0.5);
    out.one = { opened: C.opened, drops: C.log.drops.length, types: C.log.drops.join(), opt: o.status(m) };
    T.hold({ x: c0.x, y: c0.y + 20 }, 0.5); out.again = C.opened;
    const c2 = C.caches[2].pos; T.hold({ x: c2.x, y: c2.y + 20 }, 0.5);
    out.two = { opened: C.opened, opt: `${o.id}:${o.state}:${o.status(m)}` };
    return out;
  });
  check('E11 supply caches: 3 off the route; walking up opens one once and it drops existing pickups; 2 complete the optional', caches.n === 3 && caches.one.opened === 1 && caches.one.drops === 2 && caches.one.types === 'medkit,rapidfire' && caches.again === 1 && caches.two.opened === 2 && /caches:complete:DONE/.test(caches.two.opt), JSON.stringify(caches));

  const map18 = await ev(() => {
    const { g, m, A, C } = T.m18(undefined, false), W = g.world, st = g.map.start, free = T.fill(W, st), P = window.__alley.ALLEY_POINTS;
    const ok = (p) => !!free[W.idx(p.x, p.y)];
    const z = m.extraction.zone;
    const ground = A.defs.flatMap((d) => d.groups.filter((gr) => !gr.roof).flatMap((gr) => [...(gr.from || []), ...(gr.posts || [])]));
    const zones = A.defs.filter((d) => d.zone).map((d) => T.centre(d.zone));
    // two routes: Main Street blocked between V2 and V3, the plaza is still reachable (north / south avenues, alleys)
    const block = new Uint8Array(W.cols * W.rows);
    for (let y = 1290; y <= 1510; y += 10) for (let x = 2150; x <= 2950; x += 10) block[W.idx(x, y)] = 1;
    const alt = T.fill(W, st, block);
    const bld = g.map.obstacles.find((o) => o.kind === 'building' && o.x === 2140 && o.y === 820);
    return {
      unreach: g.enemies.filter((e) => !ok(e.pos)).map((e) => e.tag), ground: ground.filter((p) => !ok(p)).length, groundBad: ground.filter((p) => !ok(p)), zones: zones.filter((p) => !ok(p)).length,
      caches: C.caches.filter((c) => !ok({ x: c.pos.x, y: c.pos.y + 30 })).length, ext: ok(T.centre(z)), alt: !!alt[W.idx(z.x + z.w / 2, z.y + z.h / 2)],
      wall: { sight: W.clear({ x: bld.x - 40, y: bld.y + 200 }, { x: bld.x + bld.w + 40, y: bld.y + 200 }), walk: W.isOpen(bld.x + bld.w / 2, bld.y + bld.h / 2) },
      theme: g.map.theme, mainStreetDist: Math.min(...C.caches.map((c) => Math.abs(c.pos.y - 1400))),
    };
  });
  check('E12 map safety: every placed enemy, ambush entry / post, trigger zone, cache and the helicopter reachable from the start; a second route when Main Street is blocked', map18.unreach.length === 0 && map18.ground === 0 && map18.zones === 0 && map18.caches === 0 && map18.ext && map18.alt, JSON.stringify(map18));
  check('E13 buildings are solid: they block sight / rounds and walking (no interiors); urban theme; caches sit off Main Street', !map18.wall.sight && !map18.wall.walk && map18.theme === 'urban' && map18.mainStreetDist >= 400, JSON.stringify(map18));

  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T);
  const rw18 = await ev(() => {
    const g = window.game, a = T.a; window.__debugUnlockAll();
    const ids = T.R.owned().map((s) => s.id).slice(0, 3), out = {};
    const run = () => { T.deploy(ids, 'ambush-alley'); if (g.story) g.story.skip(g); const m = g.mission; m.optionals[0].complete(m, g); m.debugReadyExtraction(g); T.extract(60); const r = g.lastReward; return { phase: g.phase, first: r && r.firstClear, credits: r && r.credits, stars: g.lastStars && g.lastStars.stars }; };
    out.first = run(); out.replay = run(); out.rec = a.missions['ambush-alley'];
    return out;
  });
  check('E14 Mission 18 first clear pays first-time Credits with 3 stars; a replay pays less, no second first-clear bonus', rw18.first.phase === 'won' && rw18.first.first && rw18.first.stars === 3 && rw18.replay.phase === 'won' && !rw18.replay.first && rw18.replay.credits < rw18.first.credits && rw18.rec.completions === 2 && rw18.rec.bestStars === 3, JSON.stringify({ f: rw18.first.credits, r: rw18.replay, rec: rw18.rec }));

  // ================= F. SAVES =================
  const fx = [];
  for (const dir of ['fixtures', 'fixtures-v08b']) for (const f of fs.readdirSync(__dirname + '/' + dir)) {
    const p = await open({ save: fs.readFileSync(__dirname + '/' + dir + '/' + f, 'utf8') });
    const r = await p.evaluate(() => { const a = window.__account(); return { st: window.__loadStatus.status, m17: a.campaign.unlockedMissions.includes('fuel-for-the-fire'), m18: a.campaign.unlockedMissions.includes('ambush-alley') }; });
    fx.push(`${f}:${r.st}:${!r.m17 && !r.m18 ? 'ok' : 'M17?'}`);
    await p.context().close();
  }
  check('F1 every save fixture loads unchanged (none of them opens Mission 17 / 18)', fx.every((x) => /:(loaded|migrated):ok$/.test(x)), fx.join(' '));
  const sv = +((fs.readFileSync(__dirname + '/../src/save.ts', 'utf8').match(/SAVE_VERSION = (\d+)/) || [])[1]);
  check('F2 save format unchanged: SAVE_VERSION 9', sv === 9, `SAVE_VERSION ${sv}`);
  const repaired = await ev(() => {
    const raw = JSON.parse(localStorage.getItem('minisquad.save'));
    raw.account.missions['jungle-sweep'] = raw.account.missions['jungle-sweep'] || { completions: 1, best: 1, firstClearAt: 1 };
    raw.account.campaign.unlockedMissions = raw.account.campaign.unlockedMissions.filter((x) => x !== 'fuel-for-the-fire' && x !== 'ambush-alley');
    return JSON.stringify(raw);
  });
  const p2 = await open({ save: repaired });
  const rep = await p2.evaluate(() => { const a = window.__account(); return { st: window.__loadStatus.status, notes: (window.__loadStatus.notes || []).join('|'), m17: a.campaign.unlockedMissions.includes('fuel-for-the-fire'), m18: a.campaign.unlockedMissions.includes('ambush-alley'), m17done: !!(a.missions['fuel-for-the-fire'] && a.missions['fuel-for-the-fire'].completions), saved: /fuel|ambush-state|cache/i.test(JSON.stringify(a.missions['fuel-for-the-fire'] || {})) }; });
  await p2.context().close();
  check('F3 a save that cleared Mission 16 (and 17) but lacks the unlocks gets Missions 17 (and 18) back on load, without a repair note', rep.m17 && (!HAS18 || rep.m18 === rep.m17done) && !/repair|unlock/i.test(rep.notes), JSON.stringify(rep));
  check('F4 nothing about fuel tanks is written to the save', !rep.saved && !/"fuel"|tanks/.test(await ev(() => localStorage.getItem('minisquad.save') || '')));

  // ================= G. BASE =================
  if (BASE) {
    const bp = await openPage(browser, BASE, { seed: 4242 });
    const before = await bp.evaluate(missionSnapshot);
    await bp.context().close();
    const np = await openPage(browser, URL, { seed: 4242 });
    const now = await np.evaluate(missionSnapshot);
    await np.context().close();
    const cfgDiff = V09C.cfgDiff(V09B1.cfgDiff(Object.keys({ ...before.cfg, ...now.cfg }).filter((k) => before.cfg[k] !== now.cfg[k]))); // v0.9B.1: extraction pressure, v0.9C: prison* set aside
    check('G1 every CFG group identical to v0.9A except the new `fuel` group (v0.9C prison* set aside)', cfgDiff.join() === 'fuel', cfgDiff.join() || 'none');
    // v0.9B.1: the countdowns it changed are set aside (V09B1.normCd)
    const norm = (s, id) => { s = V09B1.normCd(id, V09C.norm(id, s)); // v0.9C: Mission 7's name set aside
      if (!s || id !== 'jungle-sweep') return s; const o = JSON.parse(s), d = JSON.parse(o.def); d.unlocks = {}; o.def = JSON.stringify(d); return JSON.stringify(o); };
    const ids = Object.keys(before.missions);
    const misDiff = ids.filter((id) => norm(before.missions[id], id) !== norm(now.missions[id], id));
    const m16 = JSON.parse(JSON.parse(now.missions['jungle-sweep']).def).unlocks.missions.join();
    check('G2 Missions 1-16 identical to v0.9A (maps, enemies, objectives, extraction, story, campaign rows; v0.9C: Mission 7 renamed)', ids.length === 16 && misDiff.length === 0, misDiff.length ? `changed: ${misDiff.join()}` : `${ids.length} missions`);
    check('G3 Mission 16\'s only change: its unlock list names Mission 17; two new missions (v0.9C: and Mission 19)', m16 === 'fuel-for-the-fire' && Object.keys(now.missions).length === (HAS18 ? 19 : 17), `${m16}, ${Object.keys(now.missions).length} missions`);
  } else check('G BASE build available', false, 'BASE not set (npm test serves v0.9A)');

  // ================= H. PHONES =================
  const phones = [['iPhone SE', 667, 375], ['iPhone 14', 844, 390], ['Pixel 7', 915, 412]];
  for (const [name, w, h] of phones) {
    const p = await open({ viewport: { width: w, height: h }, context: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } });
    const cdp = await p.context().newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: q.x, y: q.y, id: 1 })) });
    const q = await p.evaluate(() => {
      const { g } = T.m17(); const d = T.lab([{ x: T.LAB.x + 260, y: T.LAB.y }]); T.at({ ...T.LAB }); g.invuln = true; window.__tapDepot = d;
      return { ...T.client(d.tanks[0].pos), tap: d.num('tapRadius') };
    });
    await touch('touchStart', [q]); await touch('touchEnd', []);
    const orders = await p.evaluate(() => window.__tapDepot.log.orders);
    const css = 2 * q.tap * q.scale;
    check(`H1 ${name}: the fuel tank tap area is at least 44 CSS px across and a touch tap orders the tank`, css >= 44 && orders === 1, `${css.toFixed(1)} CSS px, ${orders} order(s)`);
    await p.context().close();
  }

  await browser.close();
  return finish(errors);
});
