// v0.9D Mission 20 "The Warlord" SIMULATIONS. Headless, accelerated fixed-step runs (1/60 s), seeded. These are
// automated simulations, NOT human playtests: the policy is the v08c-sim "attentive player" (walks to the current
// objective point, holds while fighting, revives, picks up a medkit when hurt and not fighting, abilities on a schedule, backs off the boss inside 280 px and
// sidesteps his rounds) plus a mortar rule: while a red circle covers any soldier it walks the squad out of it, away
// from the centre (DODGE=0: it never does, the stationary comparison). No premium support is used.
//
//  MODE=boss (default): starts with both installations down and the squad in the yard in front of the open command
//    gate (the approach guards cleared), then plays the boss fight, Extraction Alpha, the retreat and Bravo.
//  MODE=full: the whole mission from the start, by ROUTE=gate (default) | flank | supply.
//
//   node tools/v09d-sim.cjs                (URL=http://localhost:4173/ RUNS=3 SCEN=strong,weak,four,worn MODE=boss)
//   DODGE=0                                 the squad never steps out of a mortar circle
//   BYPASS=1                                the retreat: never stop to fight, run for Bravo
//   TWEAK='{"mortar":{"damage":40}}'        experiments only
//   OUT=/path/runs.json                     also write every run as JSON
// Scenarios: strong = the six named soldiers at level 14 with a recruited Demolitions Expert in place of Patch; weak =
// the six named soldiers at level 9, no Demolitions Expert; four = four level-14 soldiers (two lost); worn = strong arriving at the
// boss at half health.
const fs = require('fs');
const { chromium, URL, OUT, openPage } = require('./lib.cjs');
const { setup } = require('./v08c-sim.cjs');
const RUNS = +(process.env.RUNS || 3);
const MODE = process.env.MODE || 'boss';
const SCEN = (process.env.SCEN || 'strong,weak,four,worn').split(',');
const SCENARIOS = {
  strong: { demo: true, level: 14 },
  weak: { demo: false, level: 9 },
  four: { demo: false, level: 14, take: ['ace', 'tank', 'doc', 'havoc'] },
  worn: { demo: true, level: 14, hp: 0.5 },
};
const ROUTES = { gate: [{ x: 1950, y: 1720 }, { x: 2700, y: 1520 }], flank: [{ x: 880, y: 1450 }, { x: 1650, y: 720 }, { x: 2650, y: 640 }], supply: [{ x: 2100, y: 2600 }, { x: 2600, y: 2500 }] };

/** Page-side: one Mission 20 run with the attentive-player policy. */
function play({ ids, tweak, mode, hp, dodge, bypass, route }) {
  const g = window.game;
  if (tweak) for (const [grp, v] of Object.entries(tweak)) Object.assign(window.__CFG[grp], v); // experiments only (TWEAK env)
  g.selectMission('warlord-hq', true);
  const dep = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
  if (!dep.ok) return { error: dep.reason };
  const m = g.mission, X = m.mechanic('warlord');
  const skip = () => { if (g.modal === 'story') g.story.skip(g); };
  skip();
  const wps = mode === 'full' ? [...route] : [];
  if (mode === 'boss') {
    T.calm((e) => e.structure === 'relay' || e.structure === 'vdepot' || /^cmd-/.test(e.tag || ''));
    T.pinAt({ x: 3350, y: 1450 }, 34);
    T.kill((e) => e.structure === 'relay' || e.structure === 'vdepot');
    skip();
    if (hp) for (const s of g.soldiers) s.hp = s.maxHp * hp; // arrives worn
  }
  let mv = { x: 0, y: 0 };
  g.input.move = () => mv;
  let path = null, pathT = 0, pathGoal = null;
  const st = { downs: 0, revives: 0, maxEnemies: 0, maxProj: 0, stepMs: [], phases: {}, taken: {}, downsBy: {}, dodgeSteps: 0, bossBy: {}, bossHits: 0, kills: {} };
  const prev = new Map();
  const dmg0 = g.damage;
  let lastPhase = '';
  g.damage = function (u, amount, source, o = {}) {
    const h = u.hp;
    dmg0.call(this, u, amount, source, o);
    const d = Math.max(0, h - Math.max(0, u.hp));
    if (u.team === 'squad' && !u.ally && source && source.team === 'enemy' && d > 0) {
      const k = `${lastPhase}:${source.kind === 'warlord' ? (o.grenade ? 'mortar' : 'warlord') : source.kind}`;
      st.taken[k] = Math.round((st.taken[k] || 0) + d);
    }
    if (u.team === 'enemy' && u.kind === 'warlord' && source && source.identity) st.bossBy[source.identity.classId] = Math.round((st.bossBy[source.identity.classId] || 0) + d);
  };
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const MAXT = 60 * 60 * 20;
  const skipKits = new Set(); let kitT = 0;
  let bossT0 = -1, bossT1 = -1, hpAtAlpha = null, retreatT0 = -1;
  for (let step = 0; step < MAXT && g.phase === 'playing'; step++) {
    skip();
    const key = m.currentObjective ? m.currentObjective.id : m.phase;
    if (key !== lastPhase) {
      st.phases[key] = +g.time.toFixed(1); lastPhase = key;
      if (key === 'warlord') bossT0 = g.time;
      if (key === 'alpha') { bossT1 = g.time; hpAtAlpha = g.soldiers.map((s) => s.state === 'active' ? Math.round((100 * s.hp) / s.maxHp) : s.state[0]).join('/'); }
      if (key === 'bravo') retreatT0 = g.time;
    }
    const downed = g.soldiers.find((s) => s.state === 'downed');
    const fighting = g.soldiers.some((s) => s.active && s.target && !s.target.structure);
    let goal = null;
    if (wps.length && near(g.anchor, wps[0]) < 140) wps.shift();
    // an attentive player picks up a medkit (squad-wide heal) when the squad is hurt and nothing is shooting
    const live = g.soldiers.filter((s) => s.active), hurt = live.reduce((a, s) => a + s.hp / s.maxHp, 0) / Math.max(1, live.length);
    const kit = hurt < 0.6 && !fighting ? g.pickups.filter((p) => p.type.kind === 'medkit' && !skipKits.has(p)).sort((p, q2) => near(p.pos, g.anchor) - near(q2.pos, g.anchor))[0] : null;
    if (downed) goal = downed.pos;
    else if (kit && near(kit.pos, g.anchor) < 1400) {
      goal = kit.pos;
      // the formation can stand around a kit without touching it: after 2 s on top of it, the player walks on (skips it)
      if (near(kit.pos, g.anchor) < 30) { kitT += 1 / 60; if (kitT > 2) { skipKits.add(kit); kitT = 0; } } else kitT = 0;
    }
    else if (wps.length) goal = wps[0];
    else { const p = m.objectivePoint(g); goal = p ? p.pos : null; }
    pathT -= 1 / 60;
    if (goal && (pathT <= 0 || !pathGoal || near(goal, pathGoal) > 80)) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; pathGoal = { ...goal }; if (!path && kit && goal === kit.pos) skipKits.add(kit); } // a kit behind the locked gate: skip it
    mv = { x: 0, y: 0 };
    if (goal && path && path.length) {
      while (path.length > 1 && near(path[0], g.anchor) < 20) path.shift();
      const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
      const hold = fighting && !downed && step % 240 < 150 && !(bypass && key === 'bravo');
      if (d > 8 && !hold) mv = { x: dx / d, y: dy / d };
    }
    const lock = !downed && g.enemies.find((e) => e.active && e.kind === 'sniper' && e.lockAim !== null && e.target && e.target.team === 'squad');
    if (lock) { const a = lock.lockAim, side = Math.floor(g.time / 3) % 2 ? 1 : -1; mv = { x: -Math.sin(a) * side, y: Math.cos(a) * side }; }
    const F = X.fight, B = F && F.unit.active ? F.unit : null;
    if (B && !downed) {
      const dx = g.anchor.x - B.pos.x, dy = g.anchor.y - B.pos.y, d = Math.hypot(dx, dy) || 1;
      const incoming = g.projectiles.some((q) => q.owner === B && near(q.pos, g.anchor) < 260);
      const side = Math.floor(g.time / 2.5) % 2 ? 1 : -1;
      if (d < 280 && g.world.passable(g.anchor, { x: g.anchor.x + (dx / d) * 40, y: g.anchor.y + (dy / d) * 40 }, 12)) mv = { x: dx / d, y: dy / d };
      else if (incoming) mv = { x: (-dy / d) * side, y: (dx / d) * side };
    }
    // the mortar rule: walk out of a red circle that covers the squad (the open direction nearest "away")
    if (dodge && F && F.mortar && (near(g.anchor, F.mortar.pos) < window.__CFG.mortar.radius + 45 || g.soldiers.some((s) => s.active && near(s.pos, F.mortar.pos) < window.__CFG.mortar.radius + 25))) {
      const c = F.mortar.pos; let best = null, bs = -Infinity;
      const ax = g.anchor.x - c.x, ay = g.anchor.y - c.y, ad = Math.hypot(ax, ay);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
        const q = { x: c.x + ux * (window.__CFG.mortar.radius + 60), y: c.y + uy * (window.__CFG.mortar.radius + 60) };
        if (!g.world.isOpen(q.x, q.y) || !g.world.passable(g.anchor, q, 12)) continue;
        const s = ad > 1 ? (ux * ax + uy * ay) / ad : 0;
        if (s > bs) { bs = s; best = q; }
      }
      if (best) { const dx = best.x - g.anchor.x, dy = best.y - g.anchor.y, d = Math.hypot(dx, dy) || 1; mv = { x: dx / d, y: dy / d }; st.dodgeSteps++; }
    }
    if (step % 90 === 0) {
      for (const s of g.soldiers) {
        if (!s.active || !s.ability.ready(s)) continue;
        if (s.ability.targetingMode === 'instant') {
          const hurt = g.soldiers.some((o) => (o.active && o.hp < o.maxHp * 0.7) || o.state === 'downed');
          const close = s.target && !s.target.structure && near(s.target.pos, s.pos) < 170;
          if (((s.ability.id === 'suppressive' || s.ability.id === 'bulletStorm') && s.target && !s.target.structure) || (s.ability.id === 'fieldTreatment' && hurt) || (s.ability.id === 'focus' && s.target) || (s.ability.id === 'inferno' && close)) g.useAbility(s);
        } else if (s.target && near(s.target.pos, s.pos) <= s.ability.range()) { g.targeting = s; g.onTargetConfirm(g.worldToScreen(s.target.pos)); break; }
      }
    }
    const t0 = performance.now();
    g.update(1 / 60);
    st.stepMs.push(performance.now() - t0);
    st.maxEnemies = Math.max(st.maxEnemies, g.enemies.filter((e) => e.active && !e.structure).length);
    st.maxProj = Math.max(st.maxProj, g.projectiles.length);
    for (const s of g.soldiers) {
      const p = prev.get(s);
      if (p !== s.state) { if (s.state === 'downed') { st.downs++; (st.downAt = st.downAt || []).push(`${Math.round(g.time)}:${s.identity ? s.identity.classId : '?'}:${X.fight && X.fight.unit.active ? Math.round(X.fight.unit.hp) : '-'}`); st.downsBy[lastPhase] = (st.downsBy[lastPhase] || 0) + 1; } if (p === 'downed' && s.state === 'active') st.revives++; prev.set(s, s.state); }
    }
  }
  g.damage = dmg0;
  const stuckInfo = g.phase === 'playing' ? { anchor: { x: Math.round(g.anchor.x), y: Math.round(g.anchor.y) }, obj: m.currentObjective && m.currentObjective.id, point: m.objectivePoint(g) && m.objectivePoint(g).pos, targets: (m.primaries[0].targets || []).map((t) => `${t.structure}:${Math.round(t.hp)}@${Math.round(t.pos.x)},${Math.round(t.pos.y)}`).join(' '), soldiers: g.soldiers.map((s) => `${s.state}@${Math.round(s.pos.x)},${Math.round(s.pos.y)}:${s.target ? s.target.kind + (s.target.structure || '') : '-'}`).join(' '), wps: wps.length, near: g.enemies.filter((e) => e.active && near(e.pos, g.anchor) < 600).map((e) => `${e.kind}${e.structure || ''}:${e.tag}@${Math.round(e.pos.x)},${Math.round(e.pos.y)}`).join(' ') } : null;
  const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const F = X.fight, M = F ? F.mortars : null;
  const fall = g.enemies.filter((e) => /^fall/.test(e.tag || ''));
  const spawned = Object.fromEntries(m.spawned);
  return {
    phase: g.phase, time: +g.time.toFixed(0), failReason: m.failReason, phases: st.phases, stars: g.lastStars?.stars ?? 0,
    optional: m.optionals.map((o) => `${o.id}:${o.state}`).join(' '), downs: st.downs, revives: st.revives, downsBy: st.downsBy, kia: g.soldiers.filter((s) => s.state === 'kia').length,
    taken: st.taken, bossTime: bossT0 >= 0 && bossT1 >= 0 ? +(bossT1 - bossT0).toFixed(1) : null, hpAtAlpha,
    boss: F ? { log: F.log.map((l) => `${l.what}@${Math.round(l.t)}`).join(' '), shots: F.shots, by: st.bossBy, relocations: F.relocations, hpLeft: Math.round(F.unit.active ? F.unit.hp : 0) } : null,
    mortars: M ? { launched: M.launched, hitSoldiers: M.hitSoldiers, dodged: M.dodged, dmg: Math.round(M.damage), skipped: M.skipped, cancelled: M.cancelled, per: M.perStrike.map((p) => `${p.hit}/${p.dmg}`).join(' ') } : null,
    alpha: X.log.alpha.map((a) => a.stage).join('>'), alphaDmg: X.log.damageDuringAlpha,
    retreat: { spawned: Object.entries(spawned).filter(([k]) => /^fall/.test(k)).reduce((a, [, n]) => a + n, 0), byTag: Object.fromEntries(Object.entries(spawned).filter(([k]) => /^fall|^bravo|^warlord/.test(k))), aliveAtEnd: fall.filter((e) => e.active).length, time: retreatT0 >= 0 && st.phases.bravo !== undefined ? +(g.time - retreatT0).toFixed(1) : null },
    push: X.log.push.map((p) => `${p.route}:${p.n}@${Math.round(p.minDist)}`).join(' '),
    maxEnemies: st.maxEnemies, maxProj: st.maxProj, dodgeSteps: st.dodgeSteps,
    step: { p50: q(st.stepMs, 0.5), p95: q(st.stepMs, 0.95), max: q(st.stepMs, 1) },
    downAt: (st.downAt || []).join(' '), kiaAt: g.soldiers.filter((s) => s.state === 'kia').length,
    stuckInfo,
    hpLeft: g.soldiers.map((s) => s.state === 'active' ? Math.round((100 * s.hp) / s.maxHp) : s.state[0]).join('/'),
  };
}

module.exports = { play, SCENARIOS, ROUTES };

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const all = [];
  const dodge = process.env.DODGE !== '0', bypass = process.env.BYPASS === '1', route = ROUTES[process.env.ROUTE || 'gate'];
  for (const name of SCEN) {
    const sc = SCENARIOS[name];
    if (!sc) { console.log('unknown scenario', name); continue; }
    for (let r = 0; r < RUNS; r++) {
      const page = await openPage(browser, URL, { seed: 20000 + r * 7919 });
      const s = await page.evaluate(setup, sc);
      if (s.error) { console.log(name, 'setup error', s.error); await page.context().close(); continue; }
      const ids = sc.take ? sc.take : s.ids;
      const tweak = process.env.TWEAK ? JSON.parse(process.env.TWEAK) : null;
      const res = await page.evaluate(play, { ids, tweak, mode: MODE, hp: sc.hp, dodge, bypass, route });
      if (res.error) { console.log(name, 'error', res.error); await page.context().close(); continue; }
      console.log(`${name}#${r} ${res.phase} ${res.time}s stars ${res.stars} downs ${res.downs} ${JSON.stringify(res.downsBy)} kia ${res.kia} boss ${res.bossTime}s hpAtAlpha ${res.hpAtAlpha} mortars ${JSON.stringify(res.mortars)} alpha ${res.alpha} dmg ${res.alphaDmg} retreat ${JSON.stringify(res.retreat)} push ${res.push} maxE ${res.maxEnemies} hp ${res.hpLeft} taken ${JSON.stringify(res.taken)} phases ${JSON.stringify(res.phases)} step p95 ${res.step.p95} max ${res.step.max}${res.failReason ? ' fail: ' + res.failReason : ''}`);
      if (res.stuckInfo) console.log('   STUCK', JSON.stringify(res.stuckInfo));
      if (process.env.V) console.log('   boss', JSON.stringify(res.boss), 'downs', res.downAt);
      res.scen = name; res.run = r; res.errors = page.errors.length;
      if (page.errors.length) console.log('  ERRORS', page.errors.slice(0, 3).join(' | '));
      all.push(res);
      await page.context().close();
    }
    const xs = all.filter((x) => x.scen === name), avg = (f) => +(xs.reduce((a, x) => a + (f(x) || 0), 0) / Math.max(1, xs.length)).toFixed(1);
    console.log(`== ${name}: won ${xs.filter((x) => x.phase === 'won').length}/${xs.length} time ${avg((x) => x.time)} boss ${avg((x) => x.bossTime)} downs ${avg((x) => x.downs)} kia ${avg((x) => x.kia)} mortarHits ${avg((x) => x.mortars && x.mortars.hitSoldiers)}/${avg((x) => x.mortars && x.mortars.launched)} retreatSpawned ${avg((x) => x.retreat.spawned)}`);
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  await browser.close();
})();
