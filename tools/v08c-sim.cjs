// v0.8C Mission 15 AUTOMATED GAMEPLAY SIMULATIONS (General's Last Stand). Headless, accelerated fixed-step runs
// (1/60 s) with a scripted "attentive player" policy (the tools/chapter3b-sim.cjs policy): walk to the current
// objective, hold while fighting, revive, use abilities on a schedule (Inferno when an enemy is within its reach).
// These are automated simulations, NOT human playtests: the policy never kites, never uses cover on purpose and
// never pulls groups apart, so its times are a rough pace and its downs an upper bound for an attentive player.
//
//   node tools/v08c-sim.cjs                       all scenarios (RUNS per scenario, default 3)
//   SCEN=ordinary,no-demo RUNS=5 node ...         selected scenarios
//   OUT=/path/sims.json                           also write every run as JSON
//
// Scenarios (six soldiers each, Mission 15 capacity):
//   ordinary   five named soldiers at LEVEL (default 12) + a recruited Demolitions Expert at LEVEL
//   no-demo    the six named soldiers at LEVEL (no Demolitions Expert: the mission must be winnable without one)
//   trained    ordinary at level 18 with Individual Training (rank 2 in every stat) and Squad Training (rank 2)
//   trained-no-demo   the same without the Demolitions Expert
//   elite      six level-25 Elites (a Siege Breaker among them)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const RUNS = +(process.env.RUNS || 3);
const LEVEL = +(process.env.LEVEL || 12);
const SCEN = (process.env.SCEN || 'ordinary,no-demo,trained,trained-no-demo,elite').split(',');
const OUT = process.env.OUT || '';

const SCENARIOS = {
  ordinary: { demo: true, level: LEVEL },
  'no-demo': { demo: false, level: LEVEL },
  trained: { demo: true, level: 18, train: true },
  'trained-no-demo': { demo: false, level: 18, train: true },
  elite: { demo: true, level: 25, elite: true },
};

/** Page-side: fresh save, the squad (a Demolitions Expert recruited through the office when asked). */
function setup({ level, elite, demo, train }) {
  const g = window.game, a = window.__account(), P = window.__progression, E = window.__economy;
  window.__debugUnlockAll();
  let ids = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'];
  if (demo) {
    if (!a.classUnlocks.unlocked.includes('demolitions')) { a.classUnlocks.unlocked.push('demolitions'); a.classUnlocks.notified.push('demolitions'); }
    E.openOffice(g.roster, a, null);
    let o = null;
    for (let i = 0; i < 400 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'demolitions'); if (!o) { a.credits += 100; E.refreshOffers(g.roster, a, null, null); } }
    if (!o) return { error: 'no Demolitions offer' };
    a.credits += 5000;
    const r = E.recruit(g.roster, a, o.id, null);
    if (!r.ok) return { error: `recruit: ${r.reason}` };
    ids = ['ace', 'ranger', 'tank', 'doc', 'havoc', r.soldier.id];
  }
  const SPEC = { infantry: 'inf-trooper', heavy: 'hvy-weapons', medic: 'med-surgeon', sniper: 'snp-deadeye', commando: 'com-assault', demolitions: 'demo-siege' };
  for (const id of ids) {
    const s = g.roster.get(id);
    s.progression.xp = P.xpForLevel(level); s.progression.level = level;
    if (elite) { a.credits += 9000; const r = E.promote(g.roster, a, id, SPEC[s.classId], null); if (!r.ok) return { error: `${id}: ${r.reason}` }; }
    if (train) for (const stat of ['hp', 'damage', 'fireRate', 'accuracy', 'moveSpeed']) for (let k = 0; k < 2; k++) { a.credits += 9000; E.buyTraining(g.roster, a, id, stat, null, null); }
  }
  if (train) for (const stat of ['hp', 'damage', 'accuracy', 'fireRate']) for (let k = 0; k < 2; k++) { a.credits += 9000; E.buySquadTraining(a, stat, null, null); }
  a.credits = 0;
  return { ids, classes: ids.map((id) => g.roster.get(id).classId) };
}

/** Page-side: one Mission 15 run with the autopilot. */
function play({ ids, tweak, healAtVoss }) {
  const g = window.game;
  if (tweak) for (const [grp, v] of Object.entries(tweak)) Object.assign(window.__CFG[grp], v); // experiments only (TWEAK env)
  g.selectMission(window.__simMission || 'last-stand', true);
  const dep = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
  if (!dep.ok) return { error: dep.reason };
  let mv = { x: 0, y: 0 };
  g.input.move = () => mv;
  let path = null, pathT = 0, pathGoal = null;
  const st = { downs: 0, revives: 0, maxEnemies: 0, maxProj: 0, stepMs: [], phases: {}, rocket: 0, flame: 0, vossBy: {}, taken: {}, downsBy: {}, kits: 0 };
  const prev = new Map();
  const dmg0 = g.damage;
  g.damage = function (u, amount, source, o = {}) {
    const hp = u.hp;
    dmg0.call(this, u, amount, source, o);
    const d = Math.max(0, hp - Math.max(0, u.hp));
    if (u.team === 'enemy' && source && source.identity && source.identity.classId === 'demolitions') {
      if (o.flame) st.flame += d; else if (o.grenade) st.rocket += d;
    }
    if (source && source.kind === 'general' && d > 0) st.vossHits = (st.vossHits || 0) + 1;
    if (u.team === 'squad' && !u.ally && source && source.team === 'enemy') { const k = `${lastPhase}:${source.kind}`; st.taken[k] = Math.round((st.taken[k] || 0) + d); }
    if (u.team === 'enemy' && u.kind === 'general' && source && source.identity) st.vossBy[source.identity.classId] = Math.round((st.vossBy[source.identity.classId] || 0) + d);
  };
  const MAXT = 60 * 60 * 20;
  let lastPhase = '';
  for (let step = 0; step < MAXT && g.phase === 'playing'; step++) {
    const m = g.mission;
    const key = m.currentObjective ? m.currentObjective.id : m.phase;
    if (key !== lastPhase) {
      st.phases[key] = +g.time.toFixed(1); lastPhase = key;
      if (healAtVoss && key === 'voss') for (const s of g.soldiers) if (s.active) s.hp = s.maxHp; // experiment only (HEAL env)
      const by = {}; for (const e of g.enemies) if (e.active && !e.structure) by[e.tag || '-'] = (by[e.tag || '-'] || 0) + 1;
      st.at = st.at || {}; st.at[key] = { hp: g.soldiers.map((s) => s.state === 'active' ? Math.round(s.hp) : s.state[0]).join('/'), alive: by };
    }
    const downed = g.soldiers.find((s) => s.state === 'downed');
    let goal = null;
    const fighting = g.soldiers.some((s) => s.active && s.target && !s.target.structure);
    // an attentive player picks up a medkit (squad-wide heal) when the squad is hurt and nothing is shooting
    const hurt = g.soldiers.filter((s) => s.active).reduce((a, s) => a + s.hp / s.maxHp, 0) / Math.max(1, g.soldiers.filter((s) => s.active).length);
    const kit = hurt < 0.6 && !fighting ? g.pickups.filter((p) => p.type.kind === 'medkit').sort((p, q) => Math.hypot(p.pos.x - g.anchor.x, p.pos.y - g.anchor.y) - Math.hypot(q.pos.x - g.anchor.x, q.pos.y - g.anchor.y))[0] : null;
    if (downed) goal = downed.pos;
    else if (kit && Math.hypot(kit.pos.x - g.anchor.x, kit.pos.y - g.anchor.y) < 1400) goal = kit.pos;
    else { const p = m.objectivePoint(g); goal = p ? p.pos : null; }
    pathT -= 1 / 60;
    if (goal && (pathT <= 0 || !pathGoal || Math.hypot(goal.x - pathGoal.x, goal.y - pathGoal.y) > 80)) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; pathGoal = { ...goal }; }
    mv = { x: 0, y: 0 };
    if (goal && path && path.length) {
      while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 20) path.shift();
      const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
      const hold = fighting && !downed && step % 240 < 150;
      if (d > 8 && !hold) mv = { x: dx / d, y: dy / d };
    }
    // an enemy Sniper's laser has locked on a soldier: the squad steps off the line (what the telegraph is for)
    const lock = !downed && g.enemies.find((e) => e.active && e.kind === 'sniper' && e.lockAim !== null && e.target && e.target.team === 'squad');
    if (lock) { const a = lock.lockAim, side = Math.floor(g.time / 3) % 2 ? 1 : -1; mv = { x: -Math.sin(a) * side, y: Math.cos(a) * side }; if (step % 30 === 0) st.laserDodges = (st.laserDodges || 0) + 1; }
    // Voss (the chapter2-sim boss rule): fight him from range (back off inside 280 px) and sidestep his rounds
    const V = m.general && m.general.unit.active ? m.general.unit : null;
    if (V && !downed) {
      const dx = g.anchor.x - V.pos.x, dy = g.anchor.y - V.pos.y, d = Math.hypot(dx, dy) || 1;
      const incoming = g.projectiles.some((q) => q.owner === V && Math.hypot(q.pos.x - g.anchor.x, q.pos.y - g.anchor.y) < 260);
      const side = Math.floor(g.time / 2.5) % 2 ? 1 : -1;
      if (d < 280 && g.world.passable(g.anchor, { x: g.anchor.x + (dx / d) * 40, y: g.anchor.y + (dy / d) * 40 }, 12)) mv = { x: dx / d, y: dy / d };
      else if (incoming) mv = { x: (-dy / d) * side, y: (dx / d) * side };
      if (incoming && step % 30 === 0) st.dodges = (st.dodges || 0) + 1;
    }
    if (step % 90 === 0) {
      for (const s of g.soldiers) {
        if (!s.active || !s.ability.ready(s)) continue;
        if (s.ability.targetingMode === 'instant') {
          const hurt = g.soldiers.some((o) => (o.active && o.hp < o.maxHp * 0.7) || o.state === 'downed');
          const near = s.target && !s.target.structure && Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.y - s.pos.y) < 170;
          if (((s.ability.id === 'suppressive' || s.ability.id === 'bulletStorm') && s.target && !s.target.structure) || (s.ability.id === 'fieldTreatment' && hurt) || (s.ability.id === 'focus' && s.target) || (s.ability.id === 'inferno' && near)) g.useAbility(s);
        } else if (s.target && Math.hypot(s.target.pos.x - s.pos.x, s.target.pos.y - s.pos.y) <= s.ability.range()) { g.targeting = s; g.onTargetConfirm(g.worldToScreen(s.target.pos)); break; }
      }
    }
    const t0 = performance.now();
    g.update(1 / 60);
    st.stepMs.push(performance.now() - t0);
    const live = g.enemies.filter((e) => e.active && !e.structure).length;
    st.maxEnemies = Math.max(st.maxEnemies, live);
    st.maxProj = Math.max(st.maxProj, g.projectiles.length);
    for (const s of g.soldiers) {
      const p = prev.get(s);
      if (p !== s.state) { if (s.state === 'downed') { st.downs++; st.downsBy[lastPhase] = (st.downsBy[lastPhase] || 0) + 1; } if (p === 'downed' && s.state === 'active') st.revives++; prev.set(s, s.state); }
    }
  }
  g.damage = dmg0;
  const m = g.mission, f = m.general;
  const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const demo = g.soldiers.find((s) => s.identity && s.identity.classId === 'demolitions');
  return {
    phase: g.phase, time: +g.time.toFixed(0), failReason: m.failReason, phases: st.phases, at: st.at,
    stars: g.lastStars?.stars ?? 0, optional: m.optional.map((o) => `${o.id}:${o.completed ? 'Y' : 'N'}`).join(' '),
    downsBy: st.downsBy, taken: st.taken, kitsLeft: g.pickups.filter((p) => p.type.kind === 'medkit').length, downs: st.downs, revives: st.revives, dodges: st.dodges || 0, kia: g.soldiers.filter((s) => s.state === 'kia').length,
    allies: g.allies.map((a) => `${a.name}:${a.state}`).join(' '),
    maxEnemies: st.maxEnemies, maxProjectiles: st.maxProj,
    spawned: Object.values(Object.fromEntries(m.spawned)).reduce((a, b) => a + b, 0),
    voss: f ? { log: f.log.filter((l) => !/^rally/.test(l.what)).map((l) => `${l.what}@${l.t}`).join(' '), rallies: f.rallies, shots: f.shots, hits: st.vossHits || 0, hpLeft: Math.round(f.unit.active ? f.unit.hp : 0), by: st.vossBy } : null,
    demo: demo ? { inferno: demo.ability.uses, flame: Math.round(st.flame), rocket: Math.round(st.rocket), state: demo.state } : null,
    step: { p50: q(st.stepMs, 0.5), p95: q(st.stepMs, 0.95), max: q(st.stepMs, 1) },
  };
}

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const all = [];
  for (const name of SCEN) {
    const sc = SCENARIOS[name];
    if (!sc) { console.log('unknown scenario', name); continue; }
    for (let r = 0; r < RUNS; r++) {
      await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(100);
      const su = await page.evaluate(setup, sc);
      if (su.error) { console.log(name, 'setup error', su.error); continue; }
      const res = await page.evaluate(play, { ids: su.ids, tweak: process.env.TWEAK ? JSON.parse(process.env.TWEAK) : null, healAtVoss: !!process.env.HEAL });
      res.scenario = name; res.run = r + 1; res.classes = su.classes.join(',');
      all.push(res);
      console.log(JSON.stringify(res));
    }
  }
  if (errors.length) console.log('PAGE ERRORS', errors.slice(0, 5));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  await browser.close();
})();

module.exports = { setup, play };
