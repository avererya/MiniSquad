// v0.9A Mission 16 AUTOMATED GAMEPLAY SIMULATIONS (Jungle Sweep). Headless, accelerated fixed-step runs (1/60 s) with
// the v08c-sim "attentive player" policy (walk to the objective, hold while fighting, revive, medkits, abilities on a
// schedule, step off a locked sniper laser) plus a MINE POLICY:
//   naive   ignores mines entirely (never steers around one, never shoots one): the blind upper bound of mine damage
//   aware   a player who reacts to revealed mines: stops when the squad is about to walk into one, backs off out of
//           its blast ring and orders it shot (a tap through Game.onTap), then moves on; taps a revealed mine when an
//           enemy stands next to it (offensive use)
// These are automated simulations, NOT human playtests: the policy never uses cover on purpose and reacts instantly.
//
//   node tools/v09a-sim.cjs                       all scenarios (RUNS per scenario, default 3)
//   SCEN=ordinary,elite POLICY=naive RUNS=5 node ...
//   OUT=/path/sims.json                           also write every run as JSON
// Scenarios (six soldiers, Mission 16 capacity):
//   fresh      the six named soldiers at level 8 (what Mission 16's recruits start at)
//   ordinary   the six named soldiers at LEVEL (default 12) + a recruited Demolitions Expert in place of Patch
//   trained    ordinary at level 18 with Individual Training (rank 2) and Squad Training (rank 2)
//   elite      six level-25 Elites
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const { setup } = require('./v08c-sim.cjs');
const URL = process.env.URL || 'http://localhost:4173/';
const RUNS = +(process.env.RUNS || 3);
const LEVEL = +(process.env.LEVEL || 12);
const SCEN = (process.env.SCEN || 'fresh,ordinary,trained,elite').split(',');
const POLICY = (process.env.POLICY || 'aware').split(',');
const OUT = process.env.OUT || '';

const SCENARIOS = {
  fresh: { demo: false, level: 8 },
  ordinary: { demo: true, level: LEVEL },
  trained: { demo: true, level: 18, train: true },
  elite: { demo: true, level: 25, elite: true },
};

/** Page-side: one Mission 16 run with the autopilot and a mine policy. */
function play({ ids, policy, tweak }) {
  const g = window.game;
  if (tweak) for (const [grp, v] of Object.entries(tweak)) Object.assign(window.__CFG[grp], v);
  g.selectMission('jungle-sweep', true);
  const dep = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
  if (!dep.ok) return { error: dep.reason };
  let mv = { x: 0, y: 0 };
  g.input.move = () => mv;
  let path = null, pathT = 0, pathGoal = null, wait = null;
  const st = { downs: 0, revives: 0, phases: {}, downsBy: {}, taps: 0, offensiveTaps: 0, reaction: [], mineDowns: 0, maxEnemies: 0, stepMs: [] };
  const prev = new Map();
  const MAXT = 60 * 60 * 20;
  let lastPhase = '';
  const C = window.__CFG.mine;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const revealSeen = new Set();
  for (let step = 0; step < MAXT && g.phase === 'playing'; step++) {
    const m = g.mission, F = m.mechanic('mines');
    const key = m.currentObjective ? m.currentObjective.id : m.phase;
    if (key !== lastPhase) { st.phases[key] = +g.time.toFixed(1); lastPhase = key; }
    const downed = g.soldiers.find((s) => s.state === 'downed');
    const fighting = g.soldiers.some((s) => s.active && s.target && !s.target.structure);
    const hurt = g.soldiers.filter((s) => s.active).reduce((a, s) => a + s.hp / s.maxHp, 0) / Math.max(1, g.soldiers.filter((s) => s.active).length);
    const kit = hurt < 0.6 && !fighting ? g.pickups.filter((p) => p.type.kind === 'medkit').sort((p, q) => near(p.pos, g.anchor) - near(q.pos, g.anchor))[0] : null;
    let goal = null;
    if (downed) goal = downed.pos;
    else if (kit && near(kit.pos, g.anchor) < 1400) goal = kit.pos;
    else { const p = m.objectivePoint(g); goal = p ? p.pos : null; }
    pathT -= 1 / 60;
    if (goal && (pathT <= 0 || !pathGoal || near(goal, pathGoal) > 80)) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; pathGoal = { ...goal }; }
    mv = { x: 0, y: 0 };
    if (goal && path && path.length) {
      while (path.length > 1 && near(path[0], g.anchor) < 20) path.shift();
      const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
      const hold = fighting && !downed && step % 240 < 150;
      if (d > 8 && !hold) mv = { x: dx / d, y: dy / d };
    }
    const lock = !downed && g.enemies.find((e) => e.active && e.kind === 'sniper' && e.lockAim !== null && e.target && e.target.team === 'squad');
    if (lock) { const a = lock.lockAim, side = Math.floor(g.time / 3) % 2 ? 1 : -1; mv = { x: -Math.sin(a) * side, y: Math.cos(a) * side }; }
    // ---- mine policy ----
    if (F) for (const x of F.mines) if (x.state === 'revealed' && !revealSeen.has(x.id)) {
      revealSeen.add(x.id);
      const d = Math.min(...g.soldiers.filter((s) => s.active).map((s) => near(s.pos, x.pos)));
      st.reaction.push(+d.toFixed(0)); // nearest soldier's distance at the moment it was revealed
    }
    if (F && policy === 'aware') {
      const live = F.mines.filter((x) => x.state === 'revealed');
      // offensive: an enemy beside a revealed mine
      const bait = live.find((x) => g.enemies.some((e) => e.active && !e.structure && near(e.pos, x.pos) < 50) && !g.soldiers.some((s) => s.active && near(s.pos, x.pos) < C.blastRadius + 10));
      if (bait && F.order?.mine !== bait) { g.onTap(g.worldToScreen(bait.pos)); st.taps++; st.offensiveTaps++; }
      // defensive: a revealed mine near the squad's way: back out of its ring, then shoot it
      const block = live.filter((x) => near(x.pos, g.anchor) < 200).sort((a, b) => near(a.pos, g.anchor) - near(b.pos, g.anchor))[0];
      if (block && !downed) {
        const close = g.soldiers.filter((s) => s.active && near(s.pos, block.pos) < C.blastRadius + 15);
        const dx = g.anchor.x - block.pos.x, dy = g.anchor.y - block.pos.y, d = Math.hypot(dx, dy) || 1;
        if (close.length && g.world.passable(g.anchor, { x: g.anchor.x + (dx / d) * 30, y: g.anchor.y + (dy / d) * 30 }, 12)) mv = { x: dx / d, y: dy / d };
        else mv = { x: 0, y: 0 };
        if (F.order?.mine !== block && !close.length) { g.onTap(g.worldToScreen(block.pos)); st.taps++; }
        if (!wait || wait.mine !== block) wait = { mine: block, t: g.time };
        if (g.time - wait.t > 8) { /* give up: walk on */ const p2 = path && path[0]; if (p2) { const ex = p2.x - g.anchor.x, ey = p2.y - g.anchor.y, ed = Math.hypot(ex, ey) || 1; mv = { x: ex / ed, y: ey / ed }; } }
      }
    }
    if (step % 90 === 0) {
      for (const s of g.soldiers) {
        if (!s.active || !s.ability.ready(s)) continue;
        if (s.ability.targetingMode === 'instant') {
          const hurt2 = g.soldiers.some((o) => (o.active && o.hp < o.maxHp * 0.7) || o.state === 'downed');
          const nearT = s.target && !s.target.structure && near(s.target.pos, s.pos) < 170;
          if (((s.ability.id === 'suppressive' || s.ability.id === 'bulletStorm') && s.target && !s.target.structure) || (s.ability.id === 'fieldTreatment' && hurt2) || (s.ability.id === 'focus' && s.target && !s.target.structure) || (s.ability.id === 'inferno' && nearT)) g.useAbility(s);
        } else if (s.target && !s.target.structure && near(s.target.pos, s.pos) <= s.ability.range()) { g.targeting = s; g.onTargetConfirm(g.worldToScreen(s.target.pos)); break; }
      }
    }
    const t0 = performance.now();
    const blasts0 = F ? F.log.soldierBlasts : 0;
    g.update(1 / 60);
    st.stepMs.push(performance.now() - t0);
    st.maxEnemies = Math.max(st.maxEnemies, g.enemies.filter((e) => e.active && !e.structure).length);
    for (const s of g.soldiers) {
      const p = prev.get(s);
      if (p !== s.state) {
        if (s.state === 'downed') { st.downs++; st.downsBy[lastPhase] = (st.downsBy[lastPhase] || 0) + 1; if (F && F.log.soldierBlasts > blasts0) st.mineDowns++; }
        if (p === 'downed' && s.state === 'active') st.revives++;
        prev.set(s, s.state);
      }
    }
  }
  const m = g.mission, F = m.mechanic('mines');
  const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  return {
    phase: g.phase, time: +g.time.toFixed(0), failReason: m.failReason, phases: st.phases,
    stars: g.lastStars?.stars ?? 0, optional: m.optional.map((o) => `${o.id}:${o.completed ? 'Y' : 'N'}`).join(' '),
    downs: st.downs, downsBy: st.downsBy, mineDowns: st.mineDowns, revives: st.revives, kia: g.soldiers.filter((s) => s.state === 'kia').length,
    mines: F ? { ...F.log, byCause: F.log.byCause, left: F.mines.filter((x) => x.state !== 'detonated').length, squadDamage: Math.round(F.log.squadDamage), enemyDamage: Math.round(F.log.enemyDamage) } : null,
    taps: st.taps, offensiveTaps: st.offensiveTaps, revealDist: st.reaction,
    spawned: [...m.spawned.values()].reduce((a, b) => a + b, 0), maxEnemies: st.maxEnemies,
    step: { p50: q(st.stepMs, 0.5), p95: q(st.stepMs, 0.95), max: q(st.stepMs, 1) },
  };
}

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const all = [];
  for (const policy of POLICY) for (const name of SCEN) {
    const sc = SCENARIOS[name];
    if (!sc) { console.log('unknown scenario', name); continue; }
    for (let r = 0; r < RUNS; r++) {
      await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(100);
      const su = await page.evaluate(setup, sc);
      if (su.error) { console.log(name, 'setup error', su.error); continue; }
      const res = await page.evaluate(play, { ids: su.ids, policy, tweak: process.env.TWEAK ? JSON.parse(process.env.TWEAK) : null });
      res.scenario = name; res.policy = policy; res.run = r + 1; res.classes = su.classes.join(',');
      all.push(res);
      console.log(JSON.stringify(res));
    }
  }
  if (errors.length) console.log('PAGE ERRORS', errors.slice(0, 5));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  await browser.close();
})();

module.exports = { play };
