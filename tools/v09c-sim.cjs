// v0.9C Mission 19 "Prison Break" SIMULATIONS. Headless, accelerated fixed-step runs (1/60 s), seeded. These are
// automated simulations, NOT human playtests.
//
//  MODE=stand (default): the LAST STAND only. Each run starts with the camp cleared, the three specialists freed (or
//    only some of them: scenario `spec`), the squad at the head of the trail into the extraction clearing; the
//    v09b2-sim "attentive player" walks into the landing zone and holds there (revives the downed, steps off a locked
//    sniper laser, abilities on the v08c-sim schedule; no premium support). Per run, for the assault Riflemen:
//      spawned / inRange (came within their own firing range of a standing soldier or specialist with a clear line
//      before the helicopter landed) / fired (fired at least one round) / alive (still standing at extraction) /
//      peak (most standing at once) / at[t] standing at 8 / 15 / 22 / 29 s; damage taken by the soldiers and by the
//      specialists, downs, KIA, specialists still standing, extracted, step-time percentiles, max projectiles.
//  MODE=full: the whole mission with the v08c-sim autopilot (goes to the current objective point: the nearest held
//    prisoner, then the landing zone), reporting duration, phase times, rescue order, responses, downs, KIA, stars,
//    optionals and specialist survival.
//
//   node tools/v09c-sim.cjs                          (URL=http://localhost:4173/ RUNS=5 SCEN=strong,weak,four,nospec MODE=stand)
//   TWEAK='{"prison":{"countdown":30}}'                 experiments only
//   OUT=/path/runs.json                               also write every run as JSON
// Scenarios: strong = the six named soldiers at level 14 with a recruited Demolitions Expert in place of Patch; weak =
// the six named soldiers at level 8, no Demolitions Expert; four = four level-10 soldiers; worn = strong arriving at half
// health; nospec = strong with only one specialist left (two lost before the clearing); fourone = four level-10 soldiers
// with one specialist.
const fs = require('fs');
const { chromium, URL, OUT, openPage } = require('./lib.cjs');
const { setup, play: playFull } = require('./v08c-sim.cjs');
const RUNS = +(process.env.RUNS || 5);
const MODE = process.env.MODE || 'stand';
const SCEN = (process.env.SCEN || 'strong,weak,four,nospec').split(',');
const SCENARIOS = {
  strong: { demo: true, level: 14 },
  weak: { demo: false, level: 8 },
  four: { demo: false, level: 10, take: ['ace', 'tank', 'doc', 'havoc'] },
  worn: { demo: true, level: 14, hp: 0.5 },
  nospec: { demo: true, level: 14, spec: ['flame'] },
  fourone: { demo: false, level: 10, take: ['ace', 'tank', 'doc', 'havoc'], spec: ['rocket'] },
};

/** Page-side: one Mission 19 last stand with the attentive-player policy. */
function stand({ ids, tweak, hp, spec }) {
  const g = window.game;
  if (tweak) for (const [grp, v] of Object.entries(tweak)) Object.assign(window.__CFG[grp], v); // experiments only (TWEAK env)
  g.selectMission('jungle-prison', true);
  const dep = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
  if (!dep.ok) return { error: dep.reason };
  if (g.story) g.story.skip(g);
  const m = g.mission, P = m.mechanic('prison');
  T.calm((e) => e.structure === 'relay');
  const start = { x: 3950, y: 1400 };
  T.pinAt(start, 34);
  // free the specialists the scenario keeps (the rest were lost on the way: freed, then KIA)
  const keep = spec || ['rocket', 'flame', 'star'];
  for (const p of P.prisoners) { p.npc.pos = { x: start.x - 60 - 30 * P.prisoners.indexOf(p), y: start.y + 40 }; P.free(m, g, p); }
  for (const p of P.prisoners) if (!keep.includes(p.def.kind)) { p.ally.state = 'kia'; p.ally.hp = 0; }
  P.pending = [];
  T.calm((e) => e.structure === 'relay');
  g.story.skip(g); g.story.queue && (g.story.queue.length = 0);
  for (const o of m.primaries) o.state = 'complete';
  m.current = m.primaries.length; m.phase = 'toExtraction';
  if (hp) for (const s of g.soldiers) s.hp = s.maxHp * hp; // arrives worn
  const z = m.extraction.zone, zc = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
  let mv = { x: 0, y: 0 };
  g.input.move = () => mv;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const st = { dmg: 0, dmgSpec: 0, downs: 0, specDowns: 0, revives: 0, peak: 0, at: {}, stepMs: [], maxProj: 0 };
  const dmg0 = g.damage;
  let counting = false;
  g.damage = function (u, amount, source, o = {}) {
    const h = u.hp;
    dmg0.call(this, u, amount, source, o);
    if (counting && u.team === 'squad' && source && source.team === 'enemy') {
      const x = Math.max(0, h - Math.max(0, u.hp));
      if (u.ally) st.dmgSpec += x; else st.dmg += x;
    }
  };
  const info = new Map();
  let t0 = -1, landed = -1;
  const prev = new Map();
  let path = null, pathT = 0;
  for (let step = 0; step < 60 * 70 && g.phase === 'playing'; step++) {
    const downed = g.soldiers.find((s) => s.state === 'downed') || g.allies.find((a) => a.state === 'downed' && near(a.pos, g.anchor) < 260);
    const goal = downed ? downed.pos : zc;
    pathT -= 1 / 60;
    if (pathT <= 0) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; }
    mv = { x: 0, y: 0 };
    if (path && path.length) {
      while (path.length > 1 && near(path[0], g.anchor) < 20) path.shift();
      const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, dd = Math.hypot(dx, dy);
      if (dd > 24) mv = { x: dx / dd, y: dy / dd };
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
    if (m.attempt === 'warning' && g.clock - m.warnAt > 1.2) g.stayAndRescue();
    const c0 = performance.now();
    g.update(1 / 60);
    st.stepMs.push(performance.now() - c0);
    if (t0 < 0 && m.phase === 'countdown') { t0 = g.time - 1 / 60; counting = true; }
    if (landed < 0 && (m.phase === 'available' || g.phase === 'won')) landed = g.time - t0;
    const live = [...g.soldiers, ...g.allies].filter((s) => s.active);
    for (const e of P.assaultUnits) {
      let r = info.get(e);
      if (!r) { r = { t: +(g.time - t0).toFixed(2), inRange: -1, fired: -1 }; info.set(e, r); }
      if (!e.active || landed >= 0) continue;
      if (r.inRange < 0 && live.some((s) => near(s.pos, e.pos) <= e.stats.range && g.world.clear(e.pos, s.pos))) r.inRange = +(g.time - t0).toFixed(2);
      if (r.fired < 0 && e.shots > 0) r.fired = +(g.time - t0).toFixed(2);
    }
    if (t0 >= 0 && landed < 0) {
      const alive = P.assaultUnits.filter((e) => e.active).length;
      st.peak = Math.max(st.peak, alive);
      for (const k of [8, 15, 22, 29]) if (st.at[k] === undefined && g.time - t0 >= k) st.at[k] = alive;
    }
    st.maxProj = Math.max(st.maxProj, g.projectiles.length);
    for (const s of [...g.soldiers, ...g.allies]) {
      const p = prev.get(s);
      if (p !== s.state) { if (s.state === 'downed' && t0 >= 0) { if (s.ally) st.specDowns++; else st.downs++; } if (p === 'downed' && s.state === 'active') st.revives++; prev.set(s, s.state); }
    }
  }
  g.damage = dmg0;
  const rs = [...info.values()];
  const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  return {
    spawned: P.assaultUnits.length, scale: +P.scale.toFixed(2), inRange: rs.filter((r) => r.inRange >= 0).length, fired: rs.filter((r) => r.fired >= 0).length,
    alive: P.assaultUnits.filter((e) => e.active).length,
    dmg: Math.round(st.dmg), dmgSpec: Math.round(st.dmgSpec), downs: st.downs, specDowns: st.specDowns, revives: st.revives,
    kia: g.soldiers.filter((s) => s.state === 'kia').length, specKept: keep.length,
    specAlive: P.specialists.filter((u) => u.state !== 'kia').length, specStanding: P.specialists.filter((u) => u.state === 'active').length,
    extracted: g.phase === 'won', landed: +landed.toFixed(2), peak: st.peak, at: st.at,
    medianInRange: q(rs.filter((r) => r.inRange >= 0).map((r) => r.inRange), 0.5),
    waves: P.log.waves.map((w) => `${w.t}s ${w.route} ${w.n} @${w.minDist}px`).join(' | '),
    kills: Object.fromEntries(g.allies.map((a) => [a.name, Math.round(a.dealt)])),
    step: { p50: q(st.stepMs, 0.5), p95: q(st.stepMs, 0.95), max: q(st.stepMs, 1) }, maxProj: st.maxProj,
    hpLeft: g.soldiers.filter((s) => s.state === 'active').map((s) => Math.round((100 * s.hp) / s.maxHp)),
  };
}

/** Page-side: summary of a finished full Mission 19 run (after v08c-sim play). */
function fullSummary() {
  const g = window.game, m = g.mission, P = m.mechanic('prison');
  return {
    rescues: P.log.rescues.map((r) => `${r.kind}@${Math.round(r.t)}`).join(' '), responses: P.log.responses.map((r) => `${r.after}:${r.n}${r.reduced ? 'r' : ''}@${Math.round(r.t)}`).join(' '),
    alarmDownAfter: P.alarmDownAfter, assault: P.assaultUnits.length, scale: +P.scale.toFixed(2),
    specialists: P.specialists.map((u) => `${u.name}:${u.state}:${Math.round(u.dealt)}`).join(' '),
  };
}

module.exports = { stand, SCENARIOS };

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const all = [];
  for (const name of SCEN) {
    const sc = SCENARIOS[name];
    if (!sc) { console.log('unknown scenario', name); continue; }
    for (let r = 0; r < RUNS; r++) {
      const page = await openPage(browser, URL, { seed: 19000 + r * 7919 });
      const s = await page.evaluate(setup, sc);
      if (s.error) { console.log(name, 'setup error', s.error); await page.context().close(); continue; }
      const ids = sc.take ? sc.take : s.ids;
      const tweak = process.env.TWEAK ? JSON.parse(process.env.TWEAK) : null;
      let res;
      if (MODE === 'full') {
        await page.evaluate(() => { window.__simMission = 'jungle-prison'; });
        res = await page.evaluate(playFull, { ids, tweak });
        Object.assign(res, await page.evaluate(fullSummary));
        delete res.voss;
        console.log(`${name}#${r} ${res.phase} ${res.time}s stars ${res.stars} opt ${res.optional} downs ${res.downs} kia ${res.kia} rescues ${res.rescues} responses ${res.responses} assault ${res.assault}x${res.scale} spec ${res.specialists} phases ${JSON.stringify(res.phases)} maxE ${res.maxEnemies} at ${JSON.stringify(res.at)} taken ${JSON.stringify(res.taken)} step p95 ${res.step.p95} max ${res.step.max}${res.failReason ? ' fail: ' + res.failReason : ''}`);
      } else {
        res = await page.evaluate(stand, { ids, hp: sc.hp, spec: sc.spec, tweak });
        if (res.error) { console.log(name, 'error', res.error); await page.context().close(); continue; }
        console.log(`${name}#${r} spawned ${res.spawned}x${res.scale} inRange ${res.inRange} fired ${res.fired} alive ${res.alive} peak ${res.peak} at ${JSON.stringify(res.at)} dmg ${res.dmg} spec dmg ${res.dmgSpec} downs ${res.downs}+${res.specDowns} kia ${res.kia} spec ${res.specAlive}/${res.specKept} extracted ${res.extracted} hp ${res.hpLeft.join('/')} kills ${JSON.stringify(res.kills)} step p95 ${res.step.p95} max ${res.step.max} proj ${res.maxProj}`);
      }
      res.scen = name; res.run = r; res.errors = page.errors.length;
      if (page.errors.length) console.log('  ERRORS', page.errors.slice(0, 3).join(' | '));
      all.push(res);
      await page.context().close();
    }
    const xs = all.filter((x) => x.scen === name), avg = (k) => +(xs.reduce((a, x) => a + (x[k] || 0), 0) / Math.max(1, xs.length)).toFixed(1);
    if (MODE === 'full') console.log(`== ${name}: won ${xs.filter((x) => x.phase === 'won').length}/${xs.length} time ${avg('time')} downs ${avg('downs')} kia ${avg('kia')} stars ${avg('stars')}`);
    else console.log(`== ${name}: spawned ${avg('spawned')} inRange ${avg('inRange')} fired ${avg('fired')} alive ${avg('alive')} peak ${avg('peak')} dmg ${avg('dmg')} specDmg ${avg('dmgSpec')} downs ${avg('downs')} specDowns ${avg('specDowns')} kia ${avg('kia')} specAlive ${avg('specAlive')} extracted ${xs.filter((x) => x.extracted).length}/${xs.length}`);
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
  await browser.close();
})();
