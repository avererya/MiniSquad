// v0.9B.2 Mission 18 EXTRACTION EFFECTIVENESS SIMULATION (Ambush Alley). Headless, accelerated fixed-step runs
// (1/60 s), seeded. Each run starts with Mission 18's stretches cleared and the squad, full health, at the final
// intersection just west of the plaza; an "attentive player" policy walks into the landing zone and holds there
// (revives the downed, steps off a locked sniper laser, abilities on the v08c-sim schedule; no premium support).
// Soldiers fire on their own. These are automated simulations, NOT human playtests.
// Per run it reports, for the extraction reinforcements:
//   spawned       total reinforcements that entered
//   inRange       how many came within their own firing range of a standing soldier, with a clear line, before the
//                 helicopter landed (an "effective firing position")
//   fired         how many fired at least one round
//   alive         how many were still standing when the squad extracted
//   dmg           damage the squad took during the countdown (from any enemy), downs, KIA, and whether it extracted
//   peak          most reinforcements standing at once; at[t] standing reinforcements at 5 / 10 / 15 / 19 s
//
//   node tools/v09b2-sim.cjs                        (URL=http://localhost:4173/ RUNS=5 SCEN=strong,weak)
//   TWEAK='{"extractionPressure":{"assaultFinalAt":0.6}}'   experiments only
//   OUT=/path/runs.json                              also write every run as JSON
// Scenarios: strong = the six named soldiers at level 14 with a recruited Demolitions Expert in place of Patch (the
// representative late-campaign squad); weak = the six named soldiers at level 8, no Demolitions Expert; four = four
// level-10 soldiers (an under-strength squad: the assault scales down for it); worn = strong arriving at half health.
const fs = require('fs');
const { chromium, URL, OUT, openPage } = require('./lib.cjs');
const { setup } = require('./v08c-sim.cjs');
const RUNS = +(process.env.RUNS || 5);
const SCEN = (process.env.SCEN || 'strong,weak').split(',');
const SCENARIOS = {
  strong: { demo: true, level: 14 },
  weak: { demo: false, level: 8 },
  four: { demo: false, level: 10, take: ['ace', 'tank', 'doc', 'havoc'] },
  worn: { demo: true, level: 14, hp: 0.5 },
};

/** Page-side: one Mission 18 extraction with the attentive-player policy. */
function play({ ids, tweak, hp }) {
  const g = window.game;
  if (tweak) for (const [grp, v] of Object.entries(tweak)) Object.assign(window.__CFG[grp], v); // experiments only (TWEAK env)
  g.selectMission('ambush-alley', true);
  const dep = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
  if (!dep.ok) return { error: dep.reason };
  if (g.story) g.story.skip(g);
  const m = g.mission, d = m.mechanic('ambush');
  // every stretch cleared: nothing placed, nothing scripted left to spring
  for (const s of d.states) { s.armedAt = s.sprungAt = 0; }
  d.hidden.length = 0;
  T.calm();
  for (const o of m.primaries) o.state = 'complete';
  m.current = m.primaries.length; m.phase = 'toExtraction';
  const start = { x: 4300, y: 1400 };
  T.pinAt(start, 34);
  if (hp) for (const s of g.soldiers) s.hp = s.maxHp * hp; // arrives worn from the final intersection
  const z = m.extraction.zone, zc = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
  let mv = { x: 0, y: 0 };
  g.input.move = () => mv;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const st = { dmg: 0, dmgBy: {}, downs: 0, revives: 0, peak: 0, at: {}, stepMs: [], maxProj: 0, dodges: 0 };
  const dmg0 = g.damage;
  let counting = false;
  g.damage = function (u, amount, source, o = {}) {
    const hp = u.hp;
    dmg0.call(this, u, amount, source, o);
    if (counting && u.team === 'squad' && !u.ally && source && source.team === 'enemy') {
      const x = Math.max(0, hp - Math.max(0, u.hp));
      st.dmg += x; st.dmgBy[source.kind] = (st.dmgBy[source.kind] || 0) + x;
    }
  };
  const info = new Map(); // reinforcement -> { t, inRange, fired }
  let t0 = -1, landed = -1, won = -1;
  const prev = new Map();
  let path = null, pathT = 0;
  for (let step = 0; step < 60 * 60 && g.phase === 'playing'; step++) {
    const downed = g.soldiers.find((s) => s.state === 'downed');
    const goal = downed ? downed.pos : zc;
    pathT -= 1 / 60;
    if (pathT <= 0) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; }
    mv = { x: 0, y: 0 };
    if (path && path.length) {
      while (path.length > 1 && near(path[0], g.anchor) < 20) path.shift();
      const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, dd = Math.hypot(dx, dy);
      if (dd > 24) mv = { x: dx / dd, y: dy / dd };
    }
    const lock = !downed && g.enemies.find((e) => e.active && e.kind === 'sniper' && e.lockAim !== null && e.target && e.target.team === 'squad');
    if (lock) { const a = lock.lockAim, side = Math.floor(g.time / 3) % 2 ? 1 : -1; mv = { x: -Math.sin(a) * side, y: Math.cos(a) * side }; if (step % 30 === 0) st.dodges++; }
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
    // a left-behind warning: stay and rescue (the attentive player never abandons a soldier who can be reached)
    if (m.attempt === 'warning' && g.clock - m.warnAt > 1.2) g.stayAndRescue();
    const c0 = performance.now();
    g.update(1 / 60);
    st.stepMs.push(performance.now() - c0);
    if (t0 < 0 && m.phase === 'countdown') { t0 = g.time - 1 / 60; counting = true; }
    if (landed < 0 && (m.phase === 'available' || g.phase === 'won')) landed = g.time - t0;
    if (g.phase === 'won') won = g.time - t0;
    const live = g.soldiers.filter((s) => s.active);
    for (const e of g.enemies) {
      if (!e.reinforcement) continue;
      let r = info.get(e);
      if (!r) { r = { t: +(g.time - t0).toFixed(2), kind: e.kind, inRange: -1, fired: -1, from: `${Math.round(e.pos.x / 100)},${Math.round(e.pos.y / 100)}` }; info.set(e, r); }
      if (!e.active || landed >= 0) continue;
      if (r.inRange < 0 && live.some((s) => near(s.pos, e.pos) <= e.stats.range && g.world.clear(e.pos, s.pos))) r.inRange = +(g.time - t0).toFixed(2);
      if (r.fired < 0 && e.shots > 0) r.fired = +(g.time - t0).toFixed(2);
    }
    if (t0 >= 0 && landed < 0) {
      const alive = g.enemies.filter((e) => e.reinforcement && e.active).length;
      st.peak = Math.max(st.peak, alive);
      for (const k of [5, 10, 15, 19]) if (st.at[k] === undefined && g.time - t0 >= k) st.at[k] = alive;
    }
    st.maxProj = Math.max(st.maxProj, g.projectiles.length);
    for (const s of g.soldiers) {
      const p = prev.get(s);
      if (p !== s.state) { if (s.state === 'downed' && t0 >= 0) st.downs++; if (p === 'downed' && s.state === 'active') st.revives++; prev.set(s, s.state); }
    }
  }
  g.damage = dmg0;
  const rs = [...info.values()];
  const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const hpLeft = g.soldiers.filter((s) => s.state === 'active').map((s) => Math.round((100 * s.hp) / s.maxHp));
  return {
    spawned: m.pressureSpawned, inRange: rs.filter((r) => r.inRange >= 0).length, fired: rs.filter((r) => r.fired >= 0).length,
    alive: g.enemies.filter((e) => e.reinforcement && e.active).length,
    dmg: Math.round(st.dmg), dmgBy: Object.fromEntries(Object.entries(st.dmgBy).map(([k, v]) => [k, Math.round(v)])),
    downs: st.downs, revives: st.revives, kia: g.soldiers.filter((s) => s.state === 'kia').length, extracted: g.phase === 'won',
    landed: +landed.toFixed(2), won: +won.toFixed(2), peak: st.peak, at: st.at, hpLeft, dodges: st.dodges,
    firstInRange: q(rs.filter((r) => r.inRange >= 0).map((r) => r.inRange), 0), medianInRange: q(rs.filter((r) => r.inRange >= 0).map((r) => r.inRange), 0.5),
    groups: Object.entries(rs.reduce((a, r) => { const k = `${r.t}@${r.from}`; a[k] = (a[k] || 0) + 1; return a; }, {})).map(([k, n]) => `${n}x${k}`).join(' '),
    step: { p50: q(st.stepMs, 0.5), p95: q(st.stepMs, 0.95), max: q(st.stepMs, 1) }, maxProj: st.maxProj,
  };
}

module.exports = { play, SCENARIOS };

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const all = [];
  for (const name of SCEN) {
    const sc = SCENARIOS[name];
    for (let r = 0; r < RUNS; r++) {
      const page = await openPage(browser, URL, { seed: 18000 + r * 7919 });
      const s = await page.evaluate(setup, sc);
      if (s.error) { console.log(name, 'setup error', s.error); await page.context().close(); continue; }
      const ids = sc.take ? sc.take : s.ids;
      const res = await page.evaluate(play, { ids, hp: sc.hp, tweak: process.env.TWEAK ? JSON.parse(process.env.TWEAK) : null });
      res.scen = name; res.run = r; res.errors = page.errors.length;
      all.push(res);
      console.log(`${name}#${r} spawned ${res.spawned} inRange ${res.inRange} fired ${res.fired} alive ${res.alive} dmg ${res.dmg} downs ${res.downs} kia ${res.kia} extracted ${res.extracted} landed ${res.landed} peak ${res.peak} at ${JSON.stringify(res.at)} hp ${res.hpLeft.join('/')} by ${JSON.stringify(res.dmgBy)} step p95 ${res.step.p95} max ${res.step.max}${res.errors ? ' ERRORS ' + res.errors : ''}`);
      console.log(`   groups ${res.groups}`);
      await page.context().close();
    }
    const xs = all.filter((x) => x.scen === name), avg = (k) => +(xs.reduce((a, x) => a + x[k], 0) / Math.max(1, xs.length)).toFixed(1);
    console.log(`== ${name}: spawned ${avg('spawned')} inRange ${avg('inRange')} fired ${avg('fired')} alive ${avg('alive')} dmg ${avg('dmg')} downs ${avg('downs')} kia ${avg('kia')} extracted ${xs.filter((x) => x.extracted).length}/${xs.length} peak ${avg('peak')}`);
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  await browser.close();
})();
