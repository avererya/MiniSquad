// v0.8B Chapter 3B AUTOMATED GAMEPLAY SIMULATIONS (Missions 13 and 14). Headless, accelerated fixed-step runs
// (1/60 s) with a scripted "attentive player" policy. These are automated simulations, NOT human playtests: the
// policy walks to objectives, fights (holding while it has targets), revives, uses abilities on a schedule,
// takes the optional turret caches it is told to, holds near the command center during the waves, picks the
// truck gunner it is told to and walks the road ahead of the truck.
//
//   node tools/chapter3b-sim.cjs                    all scenarios (RUNS per scenario, default 3)
//   SCEN=m13-both,m14-heavy RUNS=5 node ...         selected scenarios
//   THROTTLE=4 SCEN=m13-elite RUNS=1 node ...       CPU throttle (perf: also renders every step)
//   OUT=/path/sims.json                             also write every run as JSON
//
// Scenarios:
//   m13-both / m13-a / m13-none   Mission 13, six named soldiers at LEVEL (default 12), caches both / A / none
//   m13-elite                      Mission 13, six level-25 Elites (stress: 63 enemies, two turrets)
//   m14-heavy / m14-medic / m14-none   Mission 14, six named soldiers at LEVEL, gunner Heavy / Medic / No Gunner
//   m14-elite                      Mission 14, six level-25 Elites, Heavy gunner (stress: MG + 46 enemies)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const RUNS = +(process.env.RUNS || 3);
const LEVEL = +(process.env.LEVEL || 12);
const THROTTLE = +(process.env.THROTTLE || 0);
const SCEN = (process.env.SCEN || 'm13-both,m13-a,m13-none,m13-elite,m14-heavy,m14-medic,m14-none,m14-elite').split(',');
const OUT = process.env.OUT || '';

const SCENARIOS = {
  'm13-both': { mission: 'hold-the-line', caches: ['a', 'b'] },
  'm13-a': { mission: 'hold-the-line', caches: ['a'] },
  'm13-none': { mission: 'hold-the-line', caches: [] },
  'm13-elite': { mission: 'hold-the-line', caches: ['a', 'b'], elite: true },
  'm14-heavy': { mission: 'supply-line', gunner: 'heavy' },
  'm14-medic': { mission: 'supply-line', gunner: 'medic' },
  'm14-none': { mission: 'supply-line', gunner: null },
  'm14-elite': { mission: 'supply-line', gunner: 'heavy', elite: true },
};

/** Page-side: fresh save, six named soldiers at a level (Elites: level 25, promoted). */
function setup({ level, elite }) {
  const g = window.game, a = window.__account(), P = window.__progression, E = window.__economy;
  window.__debugUnlockAll();
  const ids = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'];
  const SPEC = { infantry: 'inf-trooper', heavy: 'hvy-weapons', medic: 'med-surgeon', sniper: 'snp-deadeye', commando: 'com-assault' };
  for (const id of ids) {
    const s = g.roster.get(id);
    const L = elite ? 25 : level;
    s.progression.xp = P.xpForLevel(L); s.progression.level = L;
    if (elite) { a.credits += 5000; const r = E.promote(g.roster, a, id, SPEC[s.classId], null); if (!r.ok) return { error: `${id}: ${r.reason}` }; }
  }
  a.credits = 0;
  return { ids, classes: ids.map((id) => g.roster.get(id).classId) };
}

/** Page-side: one mission with the autopilot. */
function play({ mission, ids, caches, gunner, render, deployed }) {
  const g = window.game, C = window.__CFG;
  // deployed: the mission is already running (tools/chapter3b-e2e.cjs deploys through the UI)
  if (!deployed) {
    g.selectMission(mission, true);
    const dep = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
    if (!dep.ok) return { error: dep.reason };
  }
  let mv = { x: 0, y: 0 };
  g.input.move = () => mv;
  let path = null, pathT = 0, pathGoal = null;
  const st = { downs: 0, revives: 0, maxEnemies: 0, steps: 0, stepMs: [], renderMs: [], phases: {}, gunnerDowned: false, mgDamage: 0, mgKills: 0, roadblockT: 0, yieldT: 0, offroadT: 0, waitT: 0, ccMin: 1e9, truckMin: 1e9, maxProj: 0 };
  const prev = new Map();
  const dmg0 = g.damage;
  g.damage = function (u, amount, source, o = {}) {
    const mg = source && source.mount && u.team === 'enemy';
    const hp = u.hp, was = u.active;
    dmg0.call(this, u, amount, source, o);
    if (mg) { st.mgDamage += Math.max(0, hp - Math.max(0, u.hp)); if (was && !u.active && !u.structure) st.mgKills++; }
  };
  const MAXT = 60 * 60 * 14;
  let lastPhase = '';
  for (let step = 0; step < MAXT && g.phase === 'playing'; step++) {
    const m = g.mission;
    if (m.phase !== lastPhase) { st.phases[m.phase] = +g.time.toFixed(1); lastPhase = m.phase; }
    // the gunner prompt: pick by class (or No Gunner)
    if (g.modal === 'gunner') {
      if (gunner === 'ui') { g.damage = dmg0; return { modal: 'gunner', time: +g.time.toFixed(1) }; } // the caller answers through the DOM
      const c = g.gunnerCandidates();
      const s = gunner ? (c.find((u) => u.identity.classId === gunner) ?? c[0]) : null;
      g.chooseGunner(s ? s.id : null);
      st.gunner = s ? `${s.name}/${s.identity.classId}` : 'none';
    }
    const downed = g.soldiers.find((s) => s.state === 'downed' && !s.mount);
    let goal = null;
    const prep = m.currentObjective && m.currentObjective.id === 'prepare' ? m.currentObjective : null;
    const waves = m.currentObjective && m.currentObjective.id === 'waves' ? m.currentObjective : null;
    const esc = m.currentObjective && m.currentObjective.id === 'escort' ? m.currentObjective : null;
    if (downed) goal = downed.pos;
    else if (prep) {
      const c = prep.caches.find((x) => caches.includes(x.id) && !prep.secured.has(x.id));
      if (c) {
        const left = g.enemies.filter((e) => e.active && e.tag === c.tag).sort((p, q) => Math.hypot(p.pos.x - g.anchor.x, p.pos.y - g.anchor.y) - Math.hypot(q.pos.x - g.anchor.x, q.pos.y - g.anchor.y));
        goal = left.length && Math.hypot(left[0].pos.x - g.anchor.x, left[0].pos.y - g.anchor.y) < 500 ? left[0].pos : { x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.h / 2 };
      } else {
        // response groups still alive near the squad: fight them first
        goal = { x: prep.zone.x + prep.zone.w / 2, y: prep.zone.y + prep.zone.h / 2 };
      }
    } else if (waves) {
      // hold just south of the command center; step out toward an attacker that is out of sight but close to it
      const cc = m.protected.pos, home = { x: cc.x, y: cc.y + 120 };
      goal = home;
      const near = waves.waves.nearest(cc);
      const seen = g.soldiers.some((s) => s.active && s.target && !s.target.structure);
      if (near && !seen && Math.hypot(near.pos.x - cc.x, near.pos.y - cc.y) < 900) goal = { x: (near.pos.x + cc.x) / 2, y: (near.pos.y + cc.y) / 2 };
    } else if (esc) {
      const v = m.escort;
      goal = v.at(Math.min(v.total, v.s + C.escortTruck.behind + 140)).p;
    } else {
      const p = m.objectivePoint(g);
      goal = p ? p.pos : null;
    }
    const fighting = g.soldiers.some((s) => s.active && !s.mount && s.target && !s.target.structure);
    pathT -= 1 / 60;
    if (goal && (pathT <= 0 || !pathGoal || Math.hypot(goal.x - pathGoal.x, goal.y - pathGoal.y) > 80)) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; pathGoal = { ...goal }; }
    mv = { x: 0, y: 0 };
    if (goal && path && path.length) {
      while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 20) path.shift();
      const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
      const hold = fighting && !downed && step % 240 < 150 && !(prep && prep.zoneT > 0);
      if (d > 8 && !hold) mv = { x: dx / d, y: dy / d };
    }
    if (step % 90 === 0) {
      for (const s of g.soldiers) {
        if (!s.active || s.mount || !s.ability.ready(s)) continue;
        if (s.ability.targetingMode === 'instant') {
          const hurt = g.soldiers.some((o) => (o.active && o.hp < o.maxHp * 0.7) || o.state === 'downed');
          if (((s.ability.id === 'suppressive' || s.ability.id === 'bulletStorm') && s.target && !s.target.structure) || (s.ability.id === 'fieldTreatment' && hurt) || (s.ability.id === 'focus' && s.target)) g.useAbility(s);
        } else if (s.target && Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.y - s.pos.y) <= s.ability.range()) { g.targeting = s; g.onTargetConfirm(g.worldToScreen(s.target.pos)); break; }
      }
    }
    const t0 = performance.now();
    g.update(1 / 60);
    const t1 = performance.now();
    st.stepMs.push(t1 - t0);
    if (render) { window.__render(); st.renderMs.push(performance.now() - t1); }
    st.steps++;
    const live = g.enemies.filter((e) => e.active && !e.structure).length;
    st.maxEnemies = Math.max(st.maxEnemies, live);
    st.maxProj = Math.max(st.maxProj, g.projectiles.length);
    if (m.protected) st.ccMin = Math.min(st.ccMin, m.protected.hp);
    const v = m.escort;
    if (v && v.unit) {
      if (v.live) st.truckMin = Math.min(st.truckMin, v.unit.hp);
      if (v.state === 'roadblock') st.roadblockT += 1 / 60;
      else if (v.state === 'yield') st.yieldT += 1 / 60;
      else if (v.state === 'offroad') st.offroadT += 1 / 60;
      else if (v.state === 'waiting' && m.escortStarted) st.waitT += 1 / 60;
      if (v.gun.lost && v.gun.assigned && !st.gunnerDowned && st.gunner && st.gunner !== 'none') st.gunnerDowned = +g.time.toFixed(0);
    }
    for (const s of g.soldiers) {
      const p = prev.get(s);
      if (p !== s.state) { if (s.state === 'downed') st.downs++; if (p === 'downed' && s.state === 'active') st.revives++; prev.set(s, s.state); }
    }
  }
  g.damage = dmg0;
  const m = g.mission;
  const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const W = m.primaries.find((o) => o.id === 'waves');
  const P = m.primaries.find((o) => o.id === 'prepare');
  const A = m.primaries.find((o) => o.id === 'escort');
  return {
    mission, phase: g.phase, time: +g.time.toFixed(0), failReason: m.failReason, phases: st.phases,
    stars: g.lastStars?.stars ?? 0, optional: m.optional.map((o) => `${o.id}:${o.completed ? 'Y' : 'N'}`).join(' '),
    downs: st.downs, revives: st.revives, kia: g.soldiers.filter((s) => s.state === 'kia').length,
    maxEnemies: st.maxEnemies, maxProjectiles: st.maxProj,
    spawned: Object.fromEntries(m.spawned),
    cc: m.protected ? { end: Math.round(m.protected.state === 'dead' ? 0 : m.protected.hp), min: Math.round(st.ccMin) } : undefined,
    turrets: P ? { secured: [...P.secured].join(','), responses: P.responseUnits.length, alive: g.assets.filter((a) => a.asset === 'turret' && a.active).length, shots: P.turrets.reduce((a, t) => a + t.shots, 0), dealt: Math.round(P.turrets.reduce((a, t) => a + t.dealt, 0)) } : undefined,
    waves: W ? { index: W.waves.index, spawned: W.waves.spawnedCount, planned: W.waves.plannedCount } : undefined,
    truck: m.escort ? { end: Math.round(m.escort.unit.state === 'dead' ? 0 : m.escort.unit.hp), min: Math.round(st.truckMin), state: m.escort.state, s: Math.round(m.escort.s), roadblocks: m.escort.roadblocks, nudges: m.escort.nudges, roadblockT: +st.roadblockT.toFixed(1), yieldT: +st.yieldT.toFixed(1), offroadT: +st.offroadT.toFixed(1), waitT: +st.waitT.toFixed(1) } : undefined,
    gun: m.escort ? { gunner: st.gunner, shots: m.escort.gun.shots, damage: Math.round(st.mgDamage), kills: st.mgKills, gunnerDowned: st.gunnerDowned } : undefined,
    ambush: A ? { fired: A.ambushes.fired.length, spawned: A.ambushes.spawnedCount } : undefined,
    step: { p50: q(st.stepMs, 0.5), p95: q(st.stepMs, 0.95), max: q(st.stepMs, 1) },
    render: st.renderMs.length ? { p50: q(st.renderMs, 0.5), p95: q(st.renderMs, 0.95), max: q(st.renderMs, 1) } : undefined,
  };
}

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (THROTTLE) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  const all = [];
  for (const name of SCEN) {
    const sc = SCENARIOS[name];
    if (!sc) { console.log('unknown scenario', name); continue; }
    for (let r = 0; r < RUNS; r++) {
      await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(100);
      const su = await page.evaluate(setup, { level: LEVEL, elite: !!sc.elite });
      if (su.error) { console.log(name, 'setup error', su.error); continue; }
      const res = await page.evaluate(play, { mission: sc.mission, ids: su.ids, caches: sc.caches || [], gunner: sc.gunner ?? null, render: !!THROTTLE });
      res.scenario = name; res.run = r + 1;
      all.push(res);
      console.log(JSON.stringify(res));
    }
  }
  if (errors.length) console.log('PAGE ERRORS', errors.slice(0, 5));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  await browser.close();
})();

module.exports = { setup, play };
