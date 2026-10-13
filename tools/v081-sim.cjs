// v0.8B.1 AUTOMATED BALANCE SIMULATIONS (Missions 13 and 14 after the difficulty / extended-escort / Ability
// Capacity patch). Headless, accelerated fixed-step runs (1/60 s) with scripted player policies. These are
// automated simulations, NOT human playtests. Built on tools/chapter3b-sim.cjs (same "attentive player" core).
//
//   node tools/v081-sim.cjs                          all scenarios (RUNS per scenario, default 3)
//   SCEN=m13-mod-none,m14-mod-heavy RUNS=5 node ...  selected scenarios
//   THROTTLE=4 SCEN=m13-elite-both RUNS=1 node ...   CPU throttle (perf: also renders every step)
//   OUT=/path/sims.json                              also write every run as JSON
//
// Squads (six named soldiers unless `size` says otherwise):
//   mod    level 12, individual Accuracy / Damage / HP 2, Fire Rate 1; squad HP / Damage / Accuracy 1
//   well   level 20, individual 5 in every stat; squad 4 in every stat
//   elite  level 25 Elites, individual 8; squad 7
// Ability Capacity rank per scenario (`cap`, default 0 = 1 use per mission).
// Mission 13 policies: hold (stay south of the command center, step out toward unseen attackers near it),
// aggressive (go out and meet the nearest attacker anywhere), slow (park in the command zone, never step out,
// abilities only every 6 s: lets the waves overlap).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const RUNS = +(process.env.RUNS || 3);
const THROTTLE = +(process.env.THROTTLE || 0);
const SCEN = (process.env.SCEN || Object.keys(SCENARIOSDEF()).join(',')).split(',');
const OUT = process.env.OUT || '';

function SCENARIOSDEF() {
  const m13 = (squad, caches, extra = {}) => ({ mission: 'hold-the-line', squad, caches, policy: 'hold', ...extra });
  const m14 = (squad, gunner, extra = {}) => ({ mission: 'supply-line', squad, gunner, ...extra });
  return {
    'm13-mod-none': m13('mod', []), 'm13-mod-both': m13('mod', ['a', 'b']),
    'm13-mod-none-cap2': m13('mod', [], { cap: 2 }), 'm13-mod-both-cap1': m13('mod', ['a', 'b'], { cap: 1 }),
    'm13-well-none': m13('well', [], { cap: 1 }), 'm13-well-both': m13('well', ['a', 'b'], { cap: 1 }),
    'm13-elite-none': m13('elite', [], { cap: 2 }), 'm13-elite-both': m13('elite', ['a', 'b'], { cap: 2 }),
    'm13-mod-five': m13('mod', ['a', 'b'], { size: 5, cap: 1 }),
    'm13-mod-slow': m13('mod', ['a', 'b'], { policy: 'slow', cap: 1 }),
    'm13-mod-aggr': m13('mod', ['a', 'b'], { policy: 'aggressive', cap: 1 }),
    'm13-well-aggr-none': m13('well', [], { policy: 'aggressive', cap: 1 }),
    'm13-mod-aggr-none': m13('mod', [], { policy: 'aggressive', cap: 1 }),
    'm14-mod-heavy': m14('mod', 'heavy'), 'm14-mod-heavy-cap2': m14('mod', 'heavy', { cap: 2 }), 'm14-mod-none': m14('mod', null, { cap: 1 }),
    'm14-mod-medic': m14('mod', 'medic', { cap: 1 }), 'm14-well-none': m14('well', null, { cap: 1 }), 'm14-mod-heavy-cap1': m14('mod', 'heavy', { cap: 1 }), 'm14-well-heavy': m14('well', 'heavy', { cap: 1 }), 'm14-elite-heavy': m14('elite', 'heavy', { cap: 2 }),
  };
}
const SCENARIOS = SCENARIOSDEF();

/** Page-side: fresh save, six named soldiers trained to a squad profile, Ability Capacity rank `cap`. */
function setup({ squad, cap, size }) {
  const g = window.game, a = window.__account(), P = window.__progression, E = window.__economy;
  window.__debugUnlockAll();
  const ids = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'].slice(0, size || 6);
  const SPEC = { infantry: 'inf-trooper', heavy: 'hvy-weapons', medic: 'med-surgeon', sniper: 'snp-deadeye', commando: 'com-assault' };
  const PROF = {
    mod: { level: 12, ind: { accuracy: 2, damage: 2, hp: 2, fireRate: 1, moveSpeed: 0 }, sq: { hp: 1, damage: 1, accuracy: 1, fireRate: 0 } },
    well: { level: 20, ind: { accuracy: 5, damage: 5, hp: 5, fireRate: 5, moveSpeed: 5 }, sq: { hp: 4, damage: 4, accuracy: 4, fireRate: 4 } },
    elite: { level: 25, elite: true, ind: { accuracy: 8, damage: 8, hp: 8, fireRate: 8, moveSpeed: 8 }, sq: { hp: 7, damage: 7, accuracy: 7, fireRate: 7 } },
  }[squad];
  for (const id of ids) {
    const s = g.roster.get(id);
    s.progression.xp = P.xpForLevel(PROF.level); s.progression.level = PROF.level;
    Object.assign(s.training, PROF.ind);
    if (cap) s.abilityCapacity = cap; else delete s.abilityCapacity;
    if (PROF.elite) { a.credits += 5000; const r = E.promote(g.roster, a, id, SPEC[s.classId], null); if (!r.ok) return { error: `${id}: ${r.reason}` }; }
  }
  Object.assign(a.squadTraining, PROF.sq);
  a.credits = 0;
  return { ids, classes: ids.map((id) => g.roster.get(id).classId) };
}

/** Page-side: one mission with the autopilot. */
function play({ mission, ids, caches, gunner, render, deployed, policy = 'hold', maxT = 0 }) {
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
  const st = { downs: 0, revives: 0, maxEnemies: 0, steps: 0, stepMs: [], renderMs: [], phases: {}, gunnerDowned: false, mgDamage: 0, mgKills: 0, roadblockT: 0, yieldT: 0, offroadT: 0, waitT: 0, ccMin: 1e9, truckMin: 1e9, maxProj: 0, maxWaves: 0, abilityUses: 0, stuck: 0 };
  const prev = new Map();
  const dmg0 = g.damage;
  g.damage = function (u, amount, source, o = {}) {
    const mg = source && source.mount && u.team === 'enemy';
    const hp = u.hp, was = u.active;
    dmg0.call(this, u, amount, source, o);
    if (mg) { st.mgDamage += Math.max(0, hp - Math.max(0, u.hp)); if (was && !u.active && !u.structure) st.mgKills++; }
    // a player turns on whoever is shooting the truck: that enemy's chase budget starts over
    if (u.asset === 'truck' && source && st.chase) st.chase.delete(source);
  };
  const MAXT = 60 * (maxT || 60 * 18);
  const pz = g.mission.primaries.find((o) => o.id === 'prepare');
  const prep0 = pz ? { x: pz.zone.x + pz.zone.w / 2, y: pz.zone.y + pz.zone.h / 2 } : { x: 0, y: 0 };
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
      const cc = m.protected.pos, home = { x: cc.x, y: cc.y + 120 };
      goal = home;
      const near = waves.waves.nearest(cc);
      const seen = g.soldiers.some((s) => s.active && s.target && !s.target.structure);
      if (policy === 'aggressive') {
        // go out and meet the nearest attacker (from the squad), wherever it is
        // forward defense: meet the attacker nearest the command center up to 480 px out (fights from there)
        if (near) { const dx = near.pos.x - cc.x, dy = near.pos.y - cc.y, d = Math.hypot(dx, dy) || 1, r = Math.max(0, Math.min(480, d - 200)); goal = { x: cc.x + (dx / d) * r, y: cc.y + (dy / d) * r }; }
      } else if (policy === 'slow') {
        goal = { x: prep0.x, y: prep0.y }; // park in the command zone
      } else if (near && !seen && Math.hypot(near.pos.x - cc.x, near.pos.y - cc.y) < 900) goal = { x: (near.pos.x + cc.x) / 2, y: (near.pos.y + cc.y) / 2 };
      // nobody has had a target for a while (an attacker out of sight behind cover): go to it, like a player would
      st.idleT = seen ? 0 : (st.idleT || 0) + 1 / 60;
      if (st.idleT > 8) { const n3 = waves.waves.nearest(g.anchor); if (n3) goal = n3.pos; }
    } else if (esc) {
      const v = m.escort;
      goal = v.at(Math.min(v.total, v.s + C.escortTruck.behind + 140)).p;
      // v0.8B.1 pilot: defend the truck. An enemy within 450 px of it that nobody is shooting: go between them
      // (a player turns back for the stragglers behind the truck instead of walking on)
      // (only enemies that can see the truck; a straggler is chased for 12 s at most, renewed whenever it hits the truck)
      const tp = v.unit.pos;
      st.chase ||= new Map();
      let th = null, td = 450;
      for (const e of g.enemies) if (e.active && !e.structure && !e.vehicle && (st.chase.get(e) || 0) < 12) { const d = Math.hypot(e.pos.x - tp.x, e.pos.y - tp.y); if (d < td && g.world.clear(e.pos, tp)) { td = d; th = e; } }
      const engaged = th && g.soldiers.some((s) => s.active && s.target === th);
      if (th && !engaged) { goal = th.pos; st.chase.set(th, (st.chase.get(th) || 0) + 1 / 60); }
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
    // charges are limited (Ability Capacity): before the big fight (M13 preparation, M14 depots) only heal in an emergency
    const saving = m.phase === 'prepare' || m.phase === 'destroy' || m.phase === 'capture';
    if (step % (policy === 'slow' ? 360 : 90) === 0) {
      for (const s of g.soldiers) {
        if (!s.active || s.mount || !s.ability.ready(s)) continue;
        if (saving && !(s.ability.id === 'fieldTreatment' && g.soldiers.filter((o) => (o.active && o.hp < o.maxHp * 0.5) || o.state === 'downed').length >= 2)) continue;
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
    if (waves) st.maxWaves = Math.max(st.maxWaves, waves.waves.liveWaves);
    st.maxEnemies = Math.max(st.maxEnemies, live);
    st.maxProj = Math.max(st.maxProj, g.projectiles.length);
    if (m.protected) st.ccMin = Math.min(st.ccMin, m.protected.hp);
    const v = m.escort;
    if (v && v.unit) {
      if (v.live) st.truckMin = Math.min(st.truckMin, v.unit.hp);
      // truck HP when each ambush fires (where the damage happens)
      const Aobj = m.primaries.find((o) => o.id === 'escort');
      if (Aobj) { st.truckAt ||= []; while (st.truckAt.length < Aobj.ambushes.fired.length) st.truckAt.push(Math.round(v.unit.hp)); }
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
    waves: W ? { index: W.waves.index, spawned: W.waves.spawnedCount, planned: W.waves.plannedCount, starts: W.waves.starts.map((x) => +x.toFixed(1)), maxOverlap: st.maxWaves } : undefined,
    charges: g.soldiers.map((s) => `${s.ability.charges}/${s.ability.capacity}`).join(' '),
    rescues: m.escort ? m.escort.rescues ?? 0 : undefined,
    truck: m.escort ? { end: Math.round(m.escort.unit.state === 'dead' ? 0 : m.escort.unit.hp), min: Math.round(st.truckMin), state: m.escort.state, s: Math.round(m.escort.s), roadblocks: m.escort.roadblocks, nudges: m.escort.nudges, roadblockT: +st.roadblockT.toFixed(1), yieldT: +st.yieldT.toFixed(1), offroadT: +st.offroadT.toFixed(1), waitT: +st.waitT.toFixed(1) } : undefined,
    truckAt: st.truckAt, squadHp: g.soldiers.map((s) => Math.round(s.active ? (100 * s.hp) / s.maxHp : 0)).join(' '),
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
      const su = await page.evaluate(setup, { squad: sc.squad, cap: sc.cap || 0, size: sc.size || 6 });
      if (su.error) { console.log(name, 'setup error', su.error); continue; }
      const res = await page.evaluate(play, { mission: sc.mission, ids: su.ids, caches: sc.caches || [], gunner: sc.gunner ?? null, render: !!THROTTLE, policy: sc.policy || 'hold' });
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
