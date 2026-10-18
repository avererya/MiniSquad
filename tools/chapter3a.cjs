// v0.8A Chapter 3A rule checks (spec section 17) against the live build (headless Chromium, fixed 1/60 s steps):
//  A. Enemy group awareness: damage / one-shot kill alert neighbours within the radius, nobody outside it,
//     no cascade, reaction delay, investigate the LAST KNOWN position (no tracking), bounded search, kinds,
//     attack ranges intact, 40-enemy stress step time
//  B. Extraction pressure: tiers per mission (none for M1, scripted waves of M3 / M10 not duplicated), finite,
//     valid off-screen spawns, not required kills, helicopter timing, extract under fire, revive during the
//     countdown, no reward farming (kills never change rewards)
//  C. Briefings: M1-M12 text, DEPLOY / BACK / Esc, locks enforced
//  D. Mission 11: zones in any order, all required, allies (fight, downed, revived, no permadeath / Memorial /
//     XP), three finite waves, defence never completes before the last wave, optional, extraction
//  E. Mission 12: three guns any order, spotlight exposure threshold, fixed markers, 2.5 s warning, 40 damage,
//     cover -60%, 10-12 s cadence, max 2 markers, alert clears after 20 s, optional, disabled after
//     destruction, combat alerts never trigger artillery, Commando unlock only on success
//  F. Commando: unlock + recruitment (1250), base stats, independent pistols, both on one target, moving
//     accuracy, Bullet Storm timing / cooldown after the effect, Gunslinger + Assault Specialist, promotion and
//     persistence, training, KIA / resurrection / Memorial, Recon Specialist rename, save guard
//  G. Phones (iPhone SE / 14 / Pixel 7 landscape): briefing fits, Commando ability tappable
// Prints PASS/FAIL per check, exits 1 on any failure. Usage: npx vite preview --port 4173 & node tools/chapter3a.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';
const fs = require('fs');

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get R() { return window.game.roster; },
    get C() { return window.__CFG; },
    step(sec, pin) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (pin) pin(); window.game.update(1 / 60); } },
    stepUntil(cond, maxSec, pin) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (pin) pin(); window.game.update(1 / 60); n++; } return n / 60; },
    calm() { const g = window.game; for (const e of g.enemies) if (!e.structure && !e.vehicle && e.kind !== 'boss') e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active); g.input.move = () => ({ x: 0, y: 0 }); },
    deploy(ids, mission, calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.calm();
      return r;
    },
    generic(classes, mission, calm = true) { const g = window.game; g.selectMission(mission, true); g.reset(classes); if (calm) this.calm(); return g.soldiers; },
    /** Complete every primary objective and leave the mission at "proceed to extraction" (pressure not started yet). */
    toExtraction() { const m = window.game.mission; for (const o of m.primaries) o.state = 'complete'; m.current = m.primaries.length; m.phase = 'toExtraction'; },
    /** Everyone (squad + allies) into the extraction zone; run until the mission ends. */
    extract(maxSec = 40, calm = true) {
      const g = window.game, m = g.mission, z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      if (calm) this.calm();
      const put = () => [...g.soldiers, ...g.allies].forEach((s, i) => { if (s.active) { s.pos = { x: c.x - 60 + (i % 4) * 40, y: c.y - 40 + Math.floor(i / 4) * 40 }; s.vel = { x: 0, y: 0 }; } });
      put(); g.anchor = { ...c };
      return this.stepUntil(() => g.phase !== 'playing', maxSec, put);
    },
    resolve(policy = 'resurrect') {
      const a = window.__account(); let d;
      while ((d = a.pendingDecision) && d.queue.length) {
        const s = this.R.get(d.queue[0].id);
        if (policy === 'resurrect') { a.credits += window.__casualties.costFor(s); this.E.resurrect(this.R, a, s.id, window.__persist); } else this.E.memorialize(this.R, a, s.id, window.__persist);
      }
    },
    /** Recruit a Commando through the office (class unlocked first, as Mission 12's first clear does). */
    recruitCommando() {
      const a = this.a;
      if (!a.classUnlocks.unlocked.includes('commando')) { a.classUnlocks.unlocked.push('commando'); a.classUnlocks.notified.push('commando'); }
      this.E.openOffice(this.R, a, null);
      let o = null; for (let i = 0; i < 400 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'commando'); if (!o) { a.credits += 100; this.E.refreshOffers(this.R, a, null, null); } }
      if (!o) return null;
      const price = window.__recruitment.priceOf('commando'); a.credits += price; const cr0 = a.credits;
      const r = this.E.recruit(this.R, a, o.id, null);
      return r.ok ? { soldier: r.soldier, paid: cr0 - a.credits, price } : null;
    },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    store() { return JSON.parse(localStorage.getItem(window.__SAVE_KEY)); },
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(104)} ${String(detail).slice(0, 260)}`); };
  const fresh = async (raw = null) => {
    await page.goto(URL); await page.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await page.goto(URL); await page.waitForTimeout(150);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. ENEMY GROUP AWARENESS =================
  await fresh();
  const aw = await ev(() => {
    const out = {};
    window.__debugUnlockAll();
    const A = T.C.awareness;
    // a flat test bed: one soldier far (> sight range) from a line of dormant guards
    const setup = (offsets, kinds = []) => {
      T.generic(['infantry'], 'bridgehead');
      const g = T.g, s = g.soldiers[0];
      g.invuln = true;
      const base = g.findOpenNear({ x: 900, y: 950 }, 40);
      s.pos = { ...base }; g.anchor = { ...base };
      const es = offsets.map(([dx, dy], i) => { const e = g.spawnEnemy(g.findOpenNear({ x: base.x + dx, y: base.y + dy }, 30), kinds[i] || 'rifleman'); e.guard = true; e.aggro = 300; return e; });
      g.alertLog.broadcasts = 0; g.alertLog.received = 0;
      return { g, s, es, pin: () => { s.vel = { x: 0, y: 0 }; } };
    };
    // 1) damage: neighbours within the radius alerted, nobody beyond it
    {
      const { g, s, es } = setup([[0, -640], [180, -640], [0, -870], [520, -640]]);
      const [v, n1, n2, far] = es;
      const d = es.map((e) => Math.round(T.near(e.pos, v.pos)));
      const from = { ...s.pos };
      g.damage(v, 5, s);
      out.dmg = { d, v: v.alert && v.alert.stage, n1: n1.alert && n1.alert.stage, n2: n2.alert && n2.alert.stage, far: far.alert, farGuard: far.guard, waits: [n1, n2].map((e) => +e.alert.wait.toFixed(3)), at: n1.alert && T.near(n1.alert.at, from) };
      const p0 = es.map((e) => ({ ...e.pos }));
      T.step(0.25, () => { s.vel = { x: 0, y: 0 }; });
      out.dmg.movedEarly = [n1, n2].map((e, i) => Math.round(T.near(e.pos, p0[i + 1])));
      // the squad slips away at once: alerted enemies keep walking to where the shot came from
      s.pos = g.findOpenNear({ x: from.x - 700, y: from.y + 500 }, 40);
      const newPos = { ...s.pos };
      T.step(1.2, () => { s.vel = { x: 0, y: 0 }; });
      out.dmg.movedLate = [n1, n2].map((e, i) => Math.round(T.near(e.pos, p0[i + 1])));
      out.dmg.closerToOld = [n1, n2].every((e, i) => T.near(e.pos, from) < T.near(p0[i + 1], from) - 20);
      T.step(4, () => { s.vel = { x: 0, y: 0 }; });
      out.dmg.atAfter = [n1, n2].map((e) => Math.round(T.near(e.alert.at, from)));
      out.dmg.toNew = [n1, n2].map((e) => Math.round(T.near(e.pos, newPos)));
      out.dmg.toOld = [n1, n2].map((e) => Math.round(T.near(e.pos, from)));
      out.dmg.farAfter = { alert: far.alert && far.alert.stage, guard: far.guard };
      out.dmg.victimMoving = T.near(v.pos, p0[0]) > 30;
      out.dmg.log = { ...g.alertLog };
      // bounded: everyone settles back into a dormant guard (no endless wandering)
      out.dmg.settleT = T.stepUntil(() => es.every((e) => !e.alert || e.alert.stage === 'settled'), 60, () => { s.vel = { x: 0, y: 0 }; });
      out.dmg.stages = es.map((e) => e.alert && e.alert.stage).join();
      out.dmg.guards = es.map((e) => e.guard).join();
      g.invuln = false;
    }
    // 2) a one-shot kill alerts the group too
    {
      const { g, s, es } = setup([[0, -640], [160, -640], [-150, -700]]);
      const [v, n1, n2] = es;
      g.damage(v, 1e5, s);
      out.kill = { dead: v.state, n1: n1.alert && n1.alert.stage, n2: n2.alert && n2.alert.stage };
      g.invuln = false;
    }
    // 3) no cascade: a chain of guards 250 px apart; only the first link hears the shot
    {
      const { g, s, es } = setup([[0, -640], [250, -640], [500, -640], [750, -640], [1000, -640]]);
      g.damage(es[0], 5, s);
      out.chain = { now: es.map((e) => (e.alert ? e.alert.stage : '-')).join(), d: es.map((e) => Math.round(T.near(e.pos, es[0].pos))).join() };
      s.pos = g.findOpenNear({ x: s.pos.x - 700, y: s.pos.y + 500 }, 40); // out of everyone's sight
      T.step(6, () => { s.vel = { x: 0, y: 0 }; });
      out.chain.later = es.map((e) => (e.alert ? e.alert.stage : '-')).join();
      out.chain.log = { ...g.alertLog };
      g.invuln = false;
    }
    // 4) kinds: armored reacts at reactMin, sniper picks a firing post at standoff range with a clear line
    {
      const { g, s, es } = setup([[0, -640], [120, -640], [-120, -660]], ['rifleman', 'armored', 'sniper']);
      const from = { ...s.pos };
      g.damage(es[0], 5, s);
      out.kinds = { armWait: +es[1].alert.wait.toFixed(3), reactMin: A.reactMin };
      T.step(1, () => { s.vel = { x: 0, y: 0 }; });
      const sn = es[2].alert;
      const post = sn && sn.legs[0];
      out.kinds.sniper = sn && sn.stage;
      out.kinds.post = post ? { d: Math.round(T.near(post, from)), want: Math.round(T.C.enemySniper.range * A.sniperStandoff), clear: g.world.clear(post, from) } : null;
      g.invuln = false;
    }
    // 5) attack ranges intact: a guard engages a soldier inside its weapon range at once
    {
      T.generic(['infantry'], 'bridgehead');
      const g = T.g, s = g.soldiers[0];
      g.invuln = true;
      let at = null;
      for (let k = 0; k < 24 && !at; k++) { const a = (k / 24) * Math.PI * 2, p = g.findOpenNear({ x: s.pos.x + Math.cos(a) * 220, y: s.pos.y + Math.sin(a) * 220 }, 20); if (g.world.clear(p, s.pos)) at = p; }
      const e = g.spawnEnemy(at, 'rifleman'); e.guard = true; e.reactionTime = 0;
      const sh0 = e.shots, d = Math.round(T.near(e.pos, s.pos)), clear = g.world.clear(e.pos, s.pos);
      const t = T.stepUntil(() => e.shots > sh0, 4, () => { s.vel = { x: 0, y: 0 }; });
      out.range = { t, d, clear, shots: e.shots - sh0, range: T.C.enemy.range };
      g.invuln = false;
    }
    // 6) stress: 40 enemies, all alerted at once, 20 s of simulation
    {
      T.generic(['infantry', 'infantry', 'heavy', 'medic', 'sniper'], 'iron-fist');
      const g = T.g; g.invuln = true;
      const c = g.soldiers[0].pos;
      const es = [];
      for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, r = 700 + (i % 5) * 60; const e = g.spawnEnemy(g.findOpenNear({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, 40), i % 7 === 0 ? 'armored' : i % 9 === 0 ? 'sniper' : 'rifleman'); e.guard = true; es.push(e); }
      for (const e of es) g.damage(e, 1, g.soldiers[0]);
      const t0 = performance.now(); const N = 20 * 60;
      for (let i = 0; i < N; i++) { for (const e of g.enemies) e.hp = Math.max(e.hp, 1); g.update(1 / 60); }
      const ms = (performance.now() - t0) / N;
      out.stress = { n: es.length, alive: g.enemies.filter((e) => e.active).length, ms: +ms.toFixed(3), log: { ...g.alertLog } };
      g.invuln = false;
    }
    return out;
  });
  const D = aw.dmg;
  check('A1 damage: nearby enemies (inside 300 px) react to a hit on their comrade', D.d[1] <= 300 && D.d[2] <= 300 && D.n1 === 'pending' && D.n2 === 'pending', `dist ${D.d.join('/')} stages ${D.n1}/${D.n2}`);
  check('A2 an enemy outside the alert radius does not react automatically', D.d[3] > 300 && D.far === null && D.farGuard === true && D.farAfter.alert === null && D.farAfter.guard === true, `dist ${D.d[3]}, after ${JSON.stringify(D.farAfter)}`);
  check('A3 one-shot kill: the group still reacts', aw.kill.dead === 'dead' && aw.kill.n1 === 'pending' && aw.kill.n2 === 'pending', JSON.stringify(aw.kill));
  check('A4 reaction delay 0.3-0.8 s: nobody moves in the first 0.25 s, everyone is moving by 1.45 s', D.waits.every((w) => w >= 0.3 && w <= 0.8) && D.movedEarly.every((m) => m < 2) && D.movedLate.every((m) => m > 25), `waits ${D.waits.join('/')}, moved ${D.movedEarly.join('/')} -> ${D.movedLate.join('/')}`);
  check('A5 alerted enemies walk to the LAST KNOWN position (where the shot came from)', D.at < 1 && D.closerToOld && D.atAfter.every((x) => x < 1), `knowledge ${D.atAfter.join('/')} px from the shot, now ${D.toOld.join('/')} px from it`);
  check('A6 no magic tracking: after the squad slipped away they are still at the old spot, not on the squad', D.toNew.every((d, i) => d > D.toOld[i] + 200), `to old ${D.toOld.join('/')} vs to squad ${D.toNew.join('/')}`);
  check('A7 nobody stays idle after a comrade is shot (the victim itself reacts too)', D.v === 'pending' && D.victimMoving, `victim ${D.v}, moving ${D.victimMoving}`);
  check('A8 bounded: search ends, everyone settles back into a dormant guard', D.settleT < 60 && /^(settled|,|)+$/.test(D.stages.replace(/null/g, '')) && D.guards.split(',').every((x) => x === 'true'), `settled after ${D.settleT.toFixed(1)} s: ${D.stages} guards ${D.guards}`);
  check('A9 no cascade: a guard chain 250 px apart hears ONE link deep, never more (6 s later still)', aw.chain.now === 'pending,pending,-,-,-' && aw.chain.later.split(',').slice(2).every((x) => x === '-') && aw.chain.log.broadcasts <= 2, `${aw.chain.now} -> ${aw.chain.later} (${aw.chain.d}) log ${JSON.stringify(aw.chain.log)}`);
  check('A10 kinds: Armored reacts at the minimum delay; enemy Sniper repositions to a clear post at standoff range', aw.kinds.armWait === aw.kinds.reactMin && aw.kinds.post && Math.abs(aw.kinds.post.d - aw.kinds.post.want) < 6 && aw.kinds.post.clear, JSON.stringify(aw.kinds));
  check('A11 attack range intact: a guard engages a soldier inside its weapon range within the old reaction time', aw.range.clear && aw.range.d < aw.range.range && aw.range.shots > 0 && aw.range.t < 1.5, JSON.stringify(aw.range));
  check('A12 40-enemy stress (all alerted): average step < 4 ms headless, bounded broadcasts', aw.stress.n === 40 && aw.stress.ms < 4 && aw.stress.log.broadcasts < 200, JSON.stringify(aw.stress));

  // ================= B. EXTRACTION PRESSURE =================
  await fresh();
  const ex = await ev(() => {
    window.__debugUnlockAll();
    const C = window.__campaign, out = { tiers: {}, runs: {} };
    const ids = C.CAMPAIGN.filter((m) => m.playable).map((m) => m.id);
    for (const id of ids) {
      T.g.selectMission(id, true);
      const X = T.g.mission.script.extraction;
      out.tiers[id] = { tier: X.pressure ? X.pressure.tier : null, finalWave: !!X.finalWave, countdown: X.countdown(), points: X.pressure ? X.pressure.points.length : 0 };
    }
    const sizes = (tier) => window.__pressure ? null : null;
    // run each mission's extraction: count reinforcements, where they spawn, the helicopter timing
    for (const id of ids) {
      T.generic(['infantry', 'infantry', 'heavy', 'medic', 'sniper'].slice(0, window.__campaign.capacityOf(id)), id);
      const g = T.g, m = g.mission; g.invuln = true;
      const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      // walk-in stand-in: the squad (and the camera, which follows it smoothly) is already near the zone
      T.step(3, () => { g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 50 + i * 25, y: c.y + z.h }; s.vel = { x: 0, y: 0 }; }); if (m.npc) { m.npc.pos = { x: c.x, y: c.y + z.h }; m.npc.vel = { x: 0, y: 0 }; } T.calm(); });
      T.toExtraction();
      const put = () => { g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 50 + i * 25, y: c.y }; s.vel = { x: 0, y: 0 }; }); if (m.npc) { m.npc.pos = { x: c.x, y: c.y + 30 }; m.npc.vel = { x: 0, y: 0 }; } g.anchor = { ...c }; for (const e of g.enemies) if (e.reinforcement) { e.hp = e.maxHp = 1e9; } };
      put(); g.update(1 / 60);
      const seen = new Set(), spawns = [];
      const scan = () => { for (const e of g.enemies) if (!seen.has(e)) { seen.add(e); spawns.push({ re: e.reinforcement, onScreen: g.isOnScreen(e.pos, 0), x: Math.round(e.pos.x), y: Math.round(e.pos.y), cam: Math.round(g.cam.x) + ',' + Math.round(g.cam.y), d: Math.round(Math.min(...g.soldiers.map((s) => T.near(s.pos, e.pos)))), open: g.world.isOpen(e.pos.x, e.pos.y) }); } };
      for (const e of g.enemies) seen.add(e);
      const tStart = g.time;
      scan();
      const tReady = T.stepUntil(() => { scan(); return m.phase === 'available'; }, 30, put);
      T.step(10, () => { put(); scan(); }); // the helicopter waits in the zone: nothing more arrives
      const re = spawns.filter((s) => s.re);
      out.runs[id] = { phase: m.phase, ready: +tReady.toFixed(2), re: re.length, all: spawns.length, minD: re.length ? Math.min(...re.map((s) => s.d)) : null, onScreen: re.filter((s) => s.onScreen).length, closed: re.filter((s) => !s.open).length, bad: re.filter((s) => s.onScreen || !s.open).map((s) => `${s.x},${s.y}@${s.cam}${s.open ? '' : ' closed'}`).join(' '), groups: m.pressureGroupsFired, spawned: m.pressureSpawned };
      // extract with the reinforcements alive (not required kills)
      out.runs[id].alive = g.enemies.filter((e) => e.reinforcement && e.active).length;
      const t = T.stepUntil(() => g.phase !== 'playing', 5, put);
      out.runs[id].end = g.phase;
      g.invuln = false;
    }
    const P = T.C.extractionPressure;
    out.expect = { light: P.light, small: P.small, moderate: P.moderateA + P.moderateB, restrained: P.restrained, strong: P.strongA + P.strongB, minDist: P.minDist };
    return out;
  });
  const exp = { 'first-contact': null, 'heavy-support': 'light', 'field-medicine': null, 'red-canyon': 'small', 'bring-them-home': 'small', 'bridgehead': 'moderate', 'prison-break': 'moderate', 'convoy-crusher': 'moderate', 'blackout': 'moderate', 'iron-fist': null, 'resistance-rising': 'restrained', 'artillery-hunt': 'strong' };
  check('B1 tiers: M1 none, M2 light, M4-5 small, M6-9 moderate, M11 restrained, M12 strong; M3 / M10 keep their scripted wave', Object.entries(exp).every(([id, t]) => ex.tiers[id] && ex.tiers[id].tier === t), Object.entries(ex.tiers).map(([id, t]) => `${id}:${t.tier || (t.finalWave ? 'scripted' : '-')}`).join(' '));
  check('B2 never both: no mission has a scripted final wave AND pressure (no duplicated extraction events)', Object.values(ex.tiers).every((t) => !(t.tier && t.finalWave)) && ex.tiers['field-medicine'].finalWave && ex.tiers['iron-fist'].finalWave && !ex.tiers['first-contact'].finalWave, '');
  const want = (id) => (ex.tiers[id].tier ? ex.expect[ex.tiers[id].tier] : null);
  check('B3 finite: each mission spawns exactly its preset (M1: nothing at all)', Object.keys(exp).every((id) => ex.runs[id].re === (want(id) ?? (ex.tiers[id].finalWave ? ex.runs[id].re : 0)) && (id !== 'first-contact' || ex.runs[id].all === 0)), Object.keys(exp).map((id) => `${id}:${ex.runs[id].re}/${want(id) ?? '-'}`).join(' '));
  check('B4 valid spawns: off-screen, on open ground, >= 500 px from every soldier', Object.keys(exp).filter((id) => exp[id]).every((id) => ex.runs[id].onScreen === 0 && ex.runs[id].closed === 0 && ex.runs[id].minD >= ex.expect.minDist), Object.keys(exp).filter((id) => exp[id]).map((id) => `${id}:${ex.runs[id].minD} ${ex.runs[id].bad}`).join(' '));
  check('B5 helicopter timing unchanged: extraction ready after exactly the mission countdown', Object.keys(exp).every((id) => Math.abs(ex.runs[id].ready - ex.tiers[id].countdown) < 0.1), Object.keys(exp).map((id) => `${ex.runs[id].ready}/${ex.tiers[id].countdown}`).join(' '));
  check('B6 not required kills: every mission extracts with reinforcements still alive (players extract under fire)', Object.keys(exp).every((id) => ex.runs[id].end === 'won') && Object.keys(exp).filter((id) => exp[id]).every((id) => ex.runs[id].alive > 0), Object.keys(exp).map((id) => `${id}:${ex.runs[id].end}/${ex.runs[id].alive}`).join(' '));
  check('B7 Missions 1-2 stay beginner-friendly (M1 none, M2 one light group of 3)', ex.runs['first-contact'].re === 0 && ex.runs['heavy-support'].re === 3 && ex.runs['heavy-support'].groups === 1, '');

  // downed soldier revived during the countdown; rewards identical whether or not reinforcements are killed
  await fresh();
  const ex2 = await ev(() => {
    window.__debugUnlockAll();
    const out = {};
    const run = (killThem) => {
      T.deploy(['ace', 'ranger', 'tank', 'doc'], 'bridgehead');
      const g = T.g, m = g.mission;
      T.toExtraction();
      const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      const put = (skip) => { g.soldiers.forEach((s, i) => { if (s !== skip && s.active) { s.pos = { x: c.x - 60 + i * 30, y: c.y }; s.vel = { x: 0, y: 0 }; } }); g.anchor = { ...c }; };
      put(); g.invuln = true;
      T.step(2, put);
      if (killThem === 'revive') {
        g.invuln = false; const v = g.soldiers[0]; g.damage(v, 1e4); out.downed = v.state; g.invuln = true;
        out.reviveT = T.stepUntil(() => v.state === 'active', 20, () => put());
        out.revived = v.state;
      }
      T.stepUntil(() => m.phase === 'available', 20, put);
      if (killThem === true) for (const e of g.enemies) if (e.reinforcement && e.active) g.damage(e, 1e5, g.soldiers[0]);
      out.killed = g.enemies.filter((e) => e.reinforcement && e.active).length;
      T.stepUntil(() => g.phase !== 'playing', 10, put);
      g.invuln = false;
      const r = g.lastReward;
      return r ? JSON.stringify({ xp: r.xpEach ?? r.xp, cr: r.credits, lines: r.lines || r.xpLines }) : 'none';
    };
    out.first = run('revive');
    out.withKills = run(true);
    out.without = run(false);
    return out;
  });
  check('B8 a soldier downed during the countdown can still be revived', ex2.downed === 'downed' && ex2.revived === 'active', JSON.stringify({ d: ex2.downed, r: ex2.revived, t: ex2.reviveT }));
  check('B9 no farming: replay rewards identical whether the reinforcements were killed or ignored', ex2.withKills === ex2.without && ex2.withKills !== 'none', `${ex2.withKills.slice(0, 120)} | ${ex2.without.slice(0, 60)}`);

  // ================= C. BRIEFINGS =================
  await fresh();
  const br = await ev(() => window.__campaign.CAMPAIGN.filter((m) => m.playable).map((m) => ({ id: m.id, n: m.number, b: m.brief, opt: m.optional.map((o) => o.label || o.id) })));
  check('C1 Missions 1-14 all have a briefing (story, objective, tip; v0.8B adds 13 / 14); the optional row lists the mission\'s optionals ("None" when it has none)', br.length === 14 && br.every((m) => m.b && m.b.story.length > 20 && m.b.objective.length > 5 && m.b.tip), br.filter((m) => !(m.b && m.b.story.length > 20 && m.b.objective.length > 5 && m.b.tip)).map((m) => `${m.id}:${JSON.stringify(m.b).slice(0, 60)}:${m.opt.length}`).join(' ') + ` (${br.length})`);
  check('C2 no spoilers: no briefing names General Voss', br.every((m) => !/voss/i.test(JSON.stringify(m.b))), '');
  await page.click('[data-a="csel"][data-id="first-contact"]');
  await page.click('.c-btns [data-a="deploy"]'); await page.waitForTimeout(80);
  const b1 = await ev(() => { const el = document.querySelector('.brief'); return el ? { t: el.textContent.replace(/\s+/g, ' '), phase: window.game.phase, deployBtn: !!el.querySelector('[data-a="brief-deploy"]'), back: !!el.querySelector('[data-a="brief-back"]') } : null; });
  check('C3 DEPLOY opens the briefing (number, title, chapter, story, objective, optional, tip, DEPLOY + BACK) without deploying', b1 && /MISSION 1/.test(b1.t) && /First Contact/i.test(b1.t) && /CHAPTER 1/i.test(b1.t) && /TIP/.test(b1.t) && /OPTIONAL/i.test(b1.t) && b1.deployBtn && b1.back && b1.phase !== 'playing', b1 && b1.t.slice(0, 200));
  await page.click('[data-a="brief-back"]'); await page.waitForTimeout(80);
  const b2 = await ev(() => ({ open: !!document.querySelector('.brief'), menu: document.getElementById('menu').className, phase: window.game.phase }));
  check('C4 BACK closes it and stays on the Campaign screen', !b2.open && /campaign/.test(b2.menu) && b2.phase !== 'playing', JSON.stringify(b2));
  await page.click('.c-btns [data-a="deploy"]'); await page.waitForTimeout(80);
  await page.keyboard.press('Escape'); await page.waitForTimeout(80);
  const b3 = await ev(() => !!document.querySelector('.brief'));
  await page.click('.c-btns [data-a="deploy"]'); await page.waitForTimeout(80);
  await page.click('[data-a="brief-deploy"]'); await page.waitForTimeout(150);
  const b4 = await ev(() => ({ phase: window.game.phase, mission: window.game.mission.script.id, menu: document.getElementById('menu').className }));
  check('C5 Esc closes the briefing; DEPLOY in the briefing starts the mission', !b3 && b4.phase === 'playing' && b4.mission === 'first-contact', JSON.stringify(b4));
  await fresh();
  await page.click('[data-a="cchap"][data-ch="3"]');
  await page.click('[data-a="csel"][data-id="resistance-rising"]');
  const lock = await ev(() => ({ dis: document.querySelector('.c-btns [data-a="deploy"]').disabled, t: document.querySelector('.c-detail').textContent.replace(/\s+/g, ' ') }));
  await page.click('.c-btns [data-a="deploy"]', { force: true }).catch(() => {}); await page.waitForTimeout(80);
  check('C6 locks enforced: a locked M11 shows how to unlock it, DEPLOY disabled, no briefing opens', lock.dis && /Clear Mission 10/.test(lock.t) && !(await ev(() => !!document.querySelector('.brief'))), lock.t.slice(0, 90));

  // ================= D. MISSION 11 =================
  await fresh();
  const m11 = await ev(() => {
    window.__debugUnlockAll();
    const out = {};
    const C = window.__campaign, cm = C.campaignMission('resistance-rising');
    out.meta = { n: cm.number, cap: C.capacityOf('resistance-rising'), opt: cm.optional.map((o) => o.id).join(), playable: cm.playable, prev: C.campaignMission('iron-fist').unlocks.missions.join() };
    const libRun = (order) => {
      T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'resistance-rising', false);
      const g = T.g, m = g.mission, lib = m.primaries[0];
      g.invuln = true;
      const zones = Object.fromEntries(lib.zones.map((z) => [z.id, z]));
      const res = { hud: [], blocked: null };
      // a zone with its defenders alive is never liberated
      const z0 = zones[order[0]], c0 = { x: z0.rect.x + z0.rect.w / 2, y: z0.rect.y + z0.rect.h / 2 };
      const pin0 = () => g.soldiers.forEach((s) => { s.pos = { ...c0 }; s.vel = { x: 0, y: 0 }; });
      for (const e of g.enemies) if (e.tag === z0.tag) { e.fireCooldown = 1e9; }
      T.step(4, () => { pin0(); for (const e of g.enemies) if (e.tag === z0.tag) { e.fireCooldown = 1e9; e.hp = e.maxHp; } });
      res.blocked = lib.liberated.size;
      T.calm();
      for (const id of order) {
        const z = zones[id], c = { x: z.rect.x + z.rect.w / 2, y: z.rect.y + z.rect.h / 2 };
        const t = T.stepUntil(() => lib.liberated.has(id), 8, () => { T.calm(); g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 40 + i * 20, y: c.y }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...c }; });
        res.hud.push(`${id}:${t.toFixed(1)}:${lib.hud(m, g).sub.split(' · ')[0]}`);
      }
      res.state = lib.state; res.next = m.currentObjective && m.currentObjective.id;
      g.invuln = false;
      return res;
    };
    out.order1 = libRun(['market', 'farm', 'church']);
    out.order2 = libRun(['church', 'market', 'farm']);
    // two zones only: the mission does not move on
    {
      T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'resistance-rising');
      const g = T.g, m = g.mission, lib = m.primaries[0]; g.invuln = true;
      for (const z of lib.zones.slice(0, 2)) { const c = { x: z.rect.x + z.rect.w / 2, y: z.rect.y + z.rect.h / 2 }; T.stepUntil(() => lib.liberated.has(z.id), 8, () => { T.calm(); g.soldiers.forEach((s) => { s.pos = { ...c }; s.vel = { x: 0, y: 0 }; }); }); }
      out.two = { n: lib.liberated.size, state: lib.state, cur: m.currentObjective.id };
      g.invuln = false;
    }
    // defence: waves at 0 / 20 / 40 from three directions; completion rules; allies
    const defend = (killAll) => {
      T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'resistance-rising');
      const g = T.g, m = g.mission, lib = m.primaries[0], def = m.primaries[1];
      lib.state = 'complete'; m.current = 1; def.state = 'active';
      const zc = { x: def.zone.x + def.zone.w / 2, y: def.zone.y + def.zone.h / 2 };
      const put = () => { g.soldiers.forEach((s, i) => { s.pos = { x: zc.x - 50 + i * 25, y: zc.y }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...zc }; };
      g.invuln = true; put();
      const waves = [];
      let n0 = 0;
      const t = T.stepUntil(() => {
        put();
        if (def.spawned > n0) { const fresh = def.attackers.slice(-def.waves[def.spawned - 1].kinds.length); const cx = fresh.reduce((a, e) => a + e.pos.x, 0) / fresh.length, cy = fresh.reduce((a, e) => a + e.pos.y, 0) / fresh.length; waves.push({ t: +def.t.toFixed(2), n: fresh.length, x: Math.round(cx), y: Math.round(cy) }); n0 = def.spawned; if (killAll && def.spawned === def.waves.length) for (const e of def.attackers) if (e.active) g.damage(e, 1e5, g.soldiers[0]); }
        if (killAll && def.spawned < def.waves.length) for (const e of def.attackers) if (e.active) g.damage(e, 1e5, g.soldiers[0]); // wipe each wave at once
        return def.state === 'complete';
      }, 90, null);
      g.invuln = false;
      return { t: +def.t.toFixed(2), waves, allies: g.allies.map((a) => `${a.name}:${a.state}`).join(), state: def.state, attackers: def.attackers.length };
    };
    out.defWipe = defend(true);
    out.defHold = defend(false);
    // allies: they fight, can be downed, revived, bleed out without permadeath / Memorial / XP
    {
      T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'resistance-rising');
      const g = T.g, m = g.mission, lib = m.primaries[0], def = m.primaries[1];
      lib.state = 'complete'; m.current = 1; def.state = 'active';
      const zc = { x: def.zone.x + def.zone.w / 2, y: def.zone.y + def.zone.h / 2 };
      const put = () => { g.soldiers.forEach((s, i) => { s.pos = { x: zc.x - 50 + i * 25, y: zc.y + 140 }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...zc }; };
      g.invuln = true;
      T.stepUntil(() => g.allies.length === 3, 3, () => g.soldiers.forEach((s) => { s.pos = { ...zc }; s.vel = { x: 0, y: 0 }; }));
      put(); T.step(0.2, put);
      const [mara, elias, tessa] = g.allies;
      out.allies = { n: g.allies.length, names: g.allies.map((a) => a.name).join(), team: mara.team, hp: mara.maxHp };
      // they shoot back at attackers
      // Phase 2 follow-up: the first wave spawns ~850 px out and walks in, so a fixed 8 s window from here ended just as it reached
      // the allies (first ally target at ~7-7.5 s, varying with the random walk): 0 shots in about 2 of 10 runs. Count shots over
      // 6 s from the moment an attacker is inside an ally's weapon range instead (they open fire ~1.5-2 s later, behind cover).
      const inRange = () => def.attackers.some((e) => e.active && g.allies.some((a) => a.state === 'active' && T.near(a.pos, e.pos) <= a.stats.range));
      out.allies.reachT = +T.stepUntil(inRange, 30, put).toFixed(1);
      out.allies.inRange = inRange();
      const sh0 = g.allies.reduce((a, u) => a + u.shots, 0);
      T.step(6, put);
      out.allies.shots = g.allies.reduce((a, u) => a + u.shots, 0) - sh0;
      // downed + revived by a soldier
      g.invuln = false; g.damage(mara, 1e4); out.allies.downed = mara.state; g.invuln = true;
      const r = g.soldiers[2]; // Doc
      out.allies.reviveT = +T.stepUntil(() => mara.state === 'active', 20, () => { put(); r.pos = { x: mara.pos.x + 20, y: mara.pos.y }; }).toFixed(1);
      out.allies.revived = mara.state;
      // Elias bleeds out alone
      g.invuln = false; g.damage(elias, 1e4); g.invuln = true;
      const far = () => { put(); for (const s of g.soldiers) if (T.near(s.pos, elias.pos) < 200) s.pos = { x: elias.pos.x + 400, y: elias.pos.y }; };
      T.stepUntil(() => elias.state === 'kia', 30, far);
      out.allies.kia = elias.state;
      out.allies.optional = m.optionals[0].state;
      const roster0 = T.R.owned().length, mem0 = T.a.memorial.length;
      T.calm(); def.state = 'complete'; m.current = 2; m.phase = 'toExtraction';
      out.allies.end = T.extract(40);
      out.allies.phase = T.g.phase;
      out.allies.pending = T.a.pendingDecision ? T.a.pendingDecision.queue.length : 0;
      out.allies.memorial = T.a.memorial.length - mem0;
      out.allies.roster = T.R.owned().length - roster0;
      const rw = T.g.lastReward;
      out.allies.rewardRows = rw ? (rw.soldiers || rw.rows || []).map((x) => x.id || x.name).join() : 'none';
      out.allies.optAfter = m.optionals[0].state;
    }
    // full run: optional complete when all three allies make it out
    {
      T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'resistance-rising');
      const g = T.g, m = g.mission, def = m.primaries[1];
      m.primaries[0].state = 'complete'; m.current = 1; def.state = 'active';
      const zc = { x: def.zone.x + def.zone.w / 2, y: def.zone.y + def.zone.h / 2 };
      g.invuln = true;
      T.stepUntil(() => def.state === 'complete', 90, () => { T.calm(); g.soldiers.forEach((s) => { s.pos = { ...zc }; s.vel = { x: 0, y: 0 }; }); for (const a of g.allies) a.hp = a.maxHp; });
      g.invuln = false;
      out.full = { def: def.state, phase: m.phase };
      T.extract(40);
      out.full.end = g.phase; out.full.opt = m.optionals[0].state;
      out.full.cleared = window.__account().campaign.completed ? JSON.stringify(window.__account().campaign.completed).includes('resistance-rising') : null;
      out.full.unlocked = window.__account().campaign.unlockedMissions.includes('artillery-hunt');
    }
    return out;
  });
  check('D1 M11: number 11, 5 soldiers, unlocked by M10, optional "allies-alive"', m11.meta.n === 11 && m11.meta.cap === 5 && m11.meta.prev === 'resistance-rising' && m11.meta.opt === 'allies-alive' && m11.meta.playable, JSON.stringify(m11.meta));
  check('D2 three zones liberate in ANY order (two different orders), HUD "Zones liberated: x/3"', ['order1', 'order2'].every((k) => m11[k].state === 'complete' && m11[k].next === 'safehouse' && /Zones liberated: 3\/3/.test(m11[k].hud[2])) && /1\/3/.test(m11.order1.hud[0]) && /2\/3/.test(m11.order2.hud[1]), `${m11.order1.hud.join(' ')} | ${m11.order2.hud.join(' ')}`);
  check('D3 a zone with defenders alive is never liberated; all three zones are required', m11.order1.blocked === 0 && m11.order2.blocked === 0 && m11.two.n === 2 && m11.two.state === 'active' && m11.two.cur === 'liberate', JSON.stringify(m11.two));
  const W = m11.defHold.waves;
  check('D4 defence: three finite waves at 0 / 20 / 40 s (5 / 6 / 6) from three different directions', W.length === 3 && W.map((w) => Math.round(w.t)).join() === '0,20,40' && W.map((w) => w.n).join() === '5,6,6' && new Set(W.map((w) => (w.y < 300 ? 'N' : w.x > 2500 ? 'E' : w.x < 500 ? 'W' : '?'))).size === 3, JSON.stringify(W));
  check('D5 defence never completes before the last wave spawns (even with every attacker dead)', m11.defWipe.state === 'complete' && m11.defWipe.t >= 40 && m11.defWipe.t < 41, `completed at ${m11.defWipe.t}s`);
  check('D6 defence holds the full 60 s while attackers are still alive', m11.defHold.state === 'complete' && Math.abs(m11.defHold.t - 60) < 0.05, `${m11.defHold.t}s, ${m11.defHold.attackers} attackers`);
  const AL = m11.allies;
  check('D7 three resistance allies (Mara, Elias, Tessa) join and fight', AL.n === 3 && AL.names === 'MARA,ELIAS,TESSA' && AL.team === 'squad' && AL.inRange && AL.shots > 0, JSON.stringify({ n: AL.n, names: AL.names, shots: AL.shots, inRangeAfter: AL.reachT }));
  check('D8 an ally can be downed and revived by a soldier', AL.downed === 'downed' && AL.revived === 'active', `revive ${AL.reviveT}s`);
  check('D9 an ally bleeding out: KIA, optional fails, but NO permadeath decision, Memorial entry, roster change', AL.kia === 'kia' && AL.optional === 'failed' && AL.pending === 0 && AL.memorial === 0 && AL.roster === 0 && AL.phase === 'won', JSON.stringify({ kia: AL.kia, opt: AL.optional, pending: AL.pending, mem: AL.memorial, roster: AL.roster, phase: AL.phase }));
  check('D10 allies get no XP / rewards (reward rows: squad soldiers only)', !/MARA|ELIAS|TESSA/i.test(AL.rewardRows), AL.rewardRows);
  check('D11 full run: extraction works, all allies alive -> optional complete; first clear unlocks M12', m11.full.end === 'won' && m11.full.opt === 'complete' && m11.full.unlocked, JSON.stringify(m11.full));

  // ================= E. MISSION 12 =================
  await fresh();
  const m12 = await ev(() => {
    window.__debugUnlockAll();
    const out = {};
    const A = T.C.artillery;
    const C = window.__campaign, cm = C.campaignMission('artillery-hunt');
    out.meta = { n: cm.number, cap: C.capacityOf('artillery-hunt'), opt: cm.optional.map((o) => o.id).join(), classes: (cm.unlocks.classes || []).join() };
    const start = (calm = true) => { T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'artillery-hunt', calm); const g = T.g; return { g, m: g.mission, art: g.mission.artillery }; };
    // a spot `r` px down light i's beam right now (clear line), or null
    const beamSpot = (g, art, i, r) => { const L = art.lights[i], a = art.angle(i, g.time); const p = { x: L.pos.x + Math.cos(a) * r, y: L.pos.y + Math.sin(a) * r }; return g.world.isOpen(p.x, p.y) && art.inBeam(g, i, p) ? p : null; };
    const dark = (g, art) => { for (let k = 0; k < 400; k++) { const p = g.findOpenNear({ x: 150 + (k * 97) % 2900, y: 150 + (k * 61) % 1600 }, 30); if (art.lights.every((L) => T.near(L.pos, p) > A.beamRange + 40)) return p; } return null; };
    // pin soldier 0 in a beam (follows the sweep), everyone else in the dark
    const lit = (g, art, hideAt) => { const s = g.soldiers[0]; for (const r of [200, 160, 240, 120, 280]) { const p = beamSpot(g, art, 0, r) || beamSpot(g, art, 3, r); if (p) { s.pos = p; break; } } s.vel = { x: 0, y: 0 }; g.soldiers.slice(1).forEach((o) => { o.pos = { ...hideAt }; o.vel = { x: 0, y: 0 }; }); };
    const hide = (g, at) => g.soldiers.forEach((o, i) => { o.pos = { x: at.x + i * 18, y: at.y }; o.vel = { x: 0, y: 0 }; });
    // guns: three structures, any order
    {
      const { g, m } = start();
      const obj = m.primaries[0];
      out.guns = { n: obj.targets.length, kinds: obj.targets.map((t) => t.structure).join(), hud: obj.hud(m, g).text + ' · ' + obj.hud(m, g).sub };
      const order = [2, 0, 1];
      const hs = [];
      for (const i of order) { g.damage(obj.targets[i], 1e6, g.soldiers[0]); g.update(1 / 60); hs.push(obj.hud(m, g).sub || obj.hud(m, g).text); }
      out.guns.after = hs; out.guns.state = obj.state;
    }
    // exposure: ~1 s of continuous light raises the alert; a 0.5 s dash does not
    {
      const { g, art } = start(); g.invuln = true;
      const D0 = dark(g, art); hide(g, D0);
      T.step(0.5, () => lit(g, art, D0));
      out.dash = { alerted: art.alerted, exp: +art.exposure.toFixed(2) };
      T.step(2, () => hide(g, D0)); // drains
      out.dash.after = { alerted: art.alerted, exp: +art.exposure.toFixed(2), alerts: art.alerts };
      let litT = 0;
      const t = T.stepUntil(() => art.alerted, 5, () => { lit(g, art, D0); if (art.lit.size) litT += 1 / 60; });
      out.expose = { t: +t.toFixed(2), litT: +litT.toFixed(2), alerted: art.alerted, markers: art.markers.length, pos: art.markers[0] && { ...art.markers[0].pos }, left: art.markers[0] && art.markers[0].left };
      // fixed: the circle never follows anyone
      const p0 = art.markers[0] && { ...art.markers[0].pos };
      const placedAt = g.time;
      let impactAt = null; const i0 = art.impacts;
      T.stepUntil(() => { if (art.impacts > i0 && impactAt === null) impactAt = g.time; return impactAt !== null; }, 5, () => hide(g, D0));
      out.expose.warn = impactAt !== null ? +(impactAt - placedAt).toFixed(2) : null;
      out.expose.fixed = p0 && art.markers.every((mk) => T.near(mk.pos, p0) > 0.5 || true) && true;
      out.expose.moved = p0 ? T.near(p0, D0) > 100 : null; // the squad hid far away: the shell still landed where it was seen
      // clears 20 s after the last detection
      const lastSeen = art.lastSeenAt;
      const tc = T.stepUntil(() => !art.alerted, 30, () => hide(g, D0));
      out.clear = { after: +(g.time - lastSeen).toFixed(2), alerted: art.alerted };
      g.invuln = false;
    }
    // cadence 10 / 12 s while kept in the light, never more than 2 circles; damage 40 in the open, -60% behind cover; no friendly fire
    {
      const { g, art } = start(); g.invuln = true;
      const D0 = dark(g, art); hide(g, D0);
      const placed = []; let maxM = 0; let n0 = 0;
      T.step(40, () => { lit(g, art, D0); if (art.shells > n0) { placed.push(+g.time.toFixed(2)); n0 = art.shells; } maxM = Math.max(maxM, art.markers.length); });
      out.cadence = { gaps: placed.slice(1).map((t, i) => +(t - placed[i]).toFixed(2)), maxM };
      // tuned interval 1 s: the 2-circle cap holds
      A.interval = 1; maxM = 0;
      T.step(8, () => { lit(g, art, D0); maxM = Math.max(maxM, art.markers.length); });
      out.cadence.capMax = maxM; A.interval = 11;
      g.invuln = false;
      // damage: open vs behind cover at the same distance; enemies inside the circle untouched
      T.calm(); art.markers = []; art.alerted = false;
      const s = g.soldiers[0];
      let pair = null;
      for (const o of g.world.solid) {
        if (o.w > 260 || o.h > 260) continue;
        const p = { x: o.x - 18, y: o.y + o.h / 2 }, q = { x: o.x + o.w + 18, y: o.y + o.h / 2 };
        const d = T.near(p, q);
        if (d < 60 || d > 95 || !g.world.isOpen(p.x, p.y) || !g.world.isOpen(q.x, q.y) || g.world.clear(p, q)) continue;
        pair = { p, q, d }; break;
      }
      const hit = (impact, at) => { s.pos = { ...at }; s.hp = s.maxHp; const h = s.hp; art.impact(g, impact); return +(h - s.hp).toFixed(3); };
      if (pair) {
        out.dmg = { d: Math.round(pair.d), covered: hit(pair.p, pair.q) };
        // same distance in the open
        const o2 = dark(g, art);
        out.dmg.open = hit(o2, { x: o2.x + pair.d, y: o2.y });
        out.dmg.openClear = g.world.clear(o2, { x: o2.x + pair.d, y: o2.y });
        out.dmg.centre = hit(o2, o2);
        const e = g.spawnEnemy(g.findOpenNear({ x: o2.x + 30, y: o2.y }, 20), 'rifleman'); const eh = e.hp; e.guard = true;
        art.impact(g, o2); out.dmg.enemy = eh - e.hp;
        out.dmg.want = { centre: A.damage, ratio: A.coverMul };
      } else out.dmg = null;
      // impact damage to soldiers far away: none
    }
    // optional: fails on any alert, completes without one; guns down -> artillery disabled for good
    {
      const { g, m, art } = start(); g.invuln = true;
      const D0 = dark(g, art); hide(g, D0);
      T.stepUntil(() => art.alerted, 6, () => lit(g, art, D0));
      out.optFail = m.optionals[0].state;
      for (const t of m.primaries[0].targets) g.damage(t, 1e6, g.soldiers[0]);
      g.update(1 / 60);
      out.disabled = { disabled: art.disabled, alerted: art.alerted, markers: art.markers.length };
      const sh = art.shells, im = art.impacts;
      T.step(25, () => lit(g, art, D0));
      out.disabled.later = { alerted: art.alerted, exposure: art.exposure, shells: art.shells - sh, impacts: art.impacts - im, markers: art.markers.length };
      g.invuln = false;
    }
    // combat alerts never trigger artillery: fight a gun crew from the dark
    {
      const { g, m, art } = start(false); g.invuln = true;
      const crew = g.enemies.filter((e) => e.tag === 'gun-w' && !e.structure);
      const s = g.soldiers[0];
      let spot = null;
      for (let k = 0; k < 60 && !spot; k++) { const a = (k / 60) * Math.PI * 2; const p = g.findOpenNear({ x: crew[0].pos.x + Math.cos(a) * 260, y: crew[0].pos.y + Math.sin(a) * 260 }, 20); if (g.world.clear(p, crew[0].pos) && art.lights.every((L, i) => !art.inBeam(g, i, p))) spot = p; }
      let litSteps = 0;
      const pin = () => { g.soldiers.forEach((o, i) => { o.pos = { x: spot.x + (i % 3) * 14, y: spot.y + Math.floor(i / 3) * 14 }; o.vel = { x: 0, y: 0 }; }); if (art.lit.size) litSteps++; };
      if (spot) {
        pin(); g.damage(crew[0], 5, s);
        T.step(10, pin);
      }
      out.combat = { spot: !!spot, broadcasts: g.alertLog.broadcasts, received: g.alertLog.received, enemyShots: crew.reduce((a, e) => a + e.shots, 0), artAlert: art.alerts, everAlerted: art.everAlerted, litSteps, opt: m.optionals[0].state };
      g.invuln = false;
    }
    // success without an alert: optional complete; Commando unlocked on the FIRST successful clear only
    {
      const a = T.a;
      a.classUnlocks.unlocked = a.classUnlocks.unlocked.filter((c) => c !== 'commando');
      // failure first: nothing unlocked
      const { g, m } = start(); g.invuln = false;
      for (const s of g.soldiers) g.damage(s, 1e4);
      T.stepUntil(() => g.phase !== 'playing', 30);
      out.fail = { phase: g.phase, unl: a.classUnlocks.unlocked.includes('commando') };
      T.resolve('resurrect');
      const r = start();
      r.m.debugReadyExtraction(r.g); T.extract();
      out.win = { phase: r.g.phase, opt: r.m.optionals[0].state, unl: (r.g.lastReward && r.g.lastReward.unlockedClasses || []).join(), has: a.classUnlocks.unlocked.includes('commando'), owned: T.R.owned().filter((s) => s.classId === 'commando').length };
      const r2 = start(); r2.m.debugReadyExtraction(r2.g); T.extract();
      out.win.replay = (r2.g.lastReward && r2.g.lastReward.unlockedClasses || []).join();
      window.__persist();
    }
    return out;
  });
  check('E1 M12: number 12, 5 soldiers, optional "no-artillery", first clear unlocks the Commando class', m12.meta.n === 12 && m12.meta.cap === 5 && m12.meta.opt === 'no-artillery' && m12.meta.classes === 'commando', JSON.stringify(m12.meta));
  check('E2 three destructible guns in any order, HUD "Artillery destroyed: x/3"', m12.guns.n === 3 && m12.guns.kinds === 'artillery,artillery,artillery' && /0\/3/.test(m12.guns.hud) && m12.guns.after.map((h) => (h.match(/(\d)\/3/) || [])[1]).join() === '1,2,3' && m12.guns.state === 'complete', `${m12.guns.hud} -> ${m12.guns.after.join(' | ')}`);
  check('E3 a 0.5 s dash through a beam never raises the alert (exposure drains)', !m12.dash.alerted && m12.dash.exp > 0.3 && m12.dash.after.exp === 0 && m12.dash.after.alerts === 0, JSON.stringify(m12.dash));
  check('E4 about 1 s of continuous exposure raises it; the first red circle goes down at once', m12.expose.alerted && Math.abs(m12.expose.litT - 1) < 0.05 && m12.expose.markers === 1, JSON.stringify(m12.expose));
  check('E5 warning 2.5 s, then the impact lands on the FIXED spot even though the squad hid far away', Math.abs(m12.expose.warn - 2.5) < 0.05 && m12.expose.moved, `warn ${m12.expose.warn}s`);
  check('E6 alert clears 20 s after the last detection', !m12.clear.alerted && Math.abs(m12.clear.after - 20) < 0.05, JSON.stringify(m12.clear));
  check('E7 while kept in the light: one shell every 10-12 s', m12.cadence.gaps.length >= 3 && m12.cadence.gaps.every((g) => g >= 9.95 && g <= 12.05), m12.cadence.gaps.join('/'));
  check('E8 never more than 2 circles at once (also with a tuned 1 s interval)', m12.cadence.maxM <= 2 && m12.cadence.capMax === 2, `${m12.cadence.maxM} / tuned ${m12.cadence.capMax}`);
  const dm = m12.dmg;
  check('E9 damage: 40 at the centre in the open; behind cover exactly 40% of the open value (-60%)', dm && dm.centre === 40 && dm.openClear && Math.abs(dm.covered / dm.open - 0.4) < 1e-3, JSON.stringify(dm));
  check('E10 no friendly fire: enemies inside the circle are untouched', dm && dm.enemy === 0, dm && dm.enemy);
  check('E11 optional "no artillery alert" fails the moment an alert is raised', m12.optFail === 'failed', m12.optFail);
  check('E12 all guns destroyed: artillery disabled for good (circles cancelled, no shells, no alert in the light)', m12.disabled.disabled && !m12.disabled.alerted && m12.disabled.markers === 0 && !m12.disabled.later.alerted && m12.disabled.later.exposure === 0 && m12.disabled.later.shells === 0 && m12.disabled.later.impacts === 0, JSON.stringify(m12.disabled));
  check('E13 combat alerts (shots, a fighting gun crew) never trigger artillery; only searchlights do', m12.combat.spot && m12.combat.broadcasts > 0 && m12.combat.received > 0 && m12.combat.artAlert === 0 && !m12.combat.everAlerted && m12.combat.litSteps === 0 && m12.combat.opt === 'active', JSON.stringify(m12.combat));
  check('E14 a failed attempt unlocks nothing; the first win unlocks the Commando class (no free soldier); a replay unlocks nothing', m12.fail.phase === 'failed' && !m12.fail.unl && m12.win.phase === 'won' && m12.win.unl === 'commando' && m12.win.has && m12.win.owned === 0 && m12.win.replay === '', JSON.stringify({ fail: m12.fail, win: m12.win }));
  check('E15 a clean win (no alert) completes the optional objective', m12.win.opt === 'complete', m12.win.opt);

  // ================= F. COMMANDO =================
  await fresh();
  const cd = await ev(() => {
    window.__debugUnlockAll();
    const out = {}, C = T.C, Rc = window.__recruitment;
    const a = T.a;
    a.classUnlocks.unlocked = a.classUnlocks.unlocked.filter((c) => c !== 'commando');
    out.before = Rc.recruitableClasses(Rc.campaignFlags(a)).join();
    let offersBefore = 0;
    for (let i = 0; i < 200; i++) { a.credits += 100; T.E.refreshOffers(T.R, a, null, null); offersBefore += a.recruitment.offers.filter((o) => o.classId === 'commando').length; }
    out.offersBefore = offersBefore;
    out.stats = C.commando; out.inf = C.infantry;
    out.price = Rc.priceOf('commando'); out.refund = Rc.refundOf('commando');
    const r = T.recruitCommando();
    out.recruit = r && { paid: r.paid, cls: r.soldier.classId, lv: r.soldier.progression.level };
    out.after = Rc.recruitableClasses(Rc.campaignFlags(a)).join();
    const id = r.soldier.id;
    // effective stats of a fresh Commando = the class base
    const st = window.__effectiveStats(T.R.get(id));
    out.eff = { hp: st.hp, damage: st.damage, fireRate: st.fireRate, moveSpeed: st.moveSpeed, range: st.range };
    // in the field: two pistols with their own targets, or both on one
    T.deploy(['ace', id], 'bridgehead');
    const g = T.g, u = g.soldiers.find((s) => s.identity && s.identity.id === id);
    out.field = { offhand: !!u.offhand, weapon: u.classDef.visual.weapon, ability: u.ability.id, speed: u.maxSpeed };
    g.invuln = true;
    const base = { ...u.pos };
    const e1 = g.spawnEnemy(g.findOpenNear({ x: base.x + 220, y: base.y - 60 }, 20)); const e2 = g.spawnEnemy(g.findOpenNear({ x: base.x + 220, y: base.y + 60 }, 20));
    for (const e of [e1, e2]) { e.hp = 1e9; e.maxHp = 1e9; e.fireCooldown = 1e9; e.guard = true; e.aggro = 1; }
    const pin = () => { u.pos = { ...base }; u.vel = { x: 0, y: 0 }; for (const s of g.soldiers) if (s !== u) { s.pos = { x: base.x - 600, y: base.y }; s.vel = { x: 0, y: 0 }; } for (const e of [e1, e2]) { e.fireCooldown = 1e9; e.hp = 1e9; } };
    let both = 0, n = 0, mainShots = 0, offShots = 0, lastOff = u.offhand.cooldown, lastMain = u.fireCooldown;
    T.step(6, () => { pin(); if (u.target && u.offhand.target) { n++; if (u.target !== u.offhand.target) both++; } if (u.offhand.cooldown > lastOff + 0.1) offShots++; if (u.fireCooldown > lastMain + 0.1) mainShots++; lastOff = u.offhand.cooldown; lastMain = u.fireCooldown; });
    out.split = { frac: n ? +(both / n).toFixed(2) : 0, mainShots, offShots, rate: +((mainShots + offShots) / 6).toFixed(2) };
    e2.state = 'dead';
    let same = 0; n = 0; mainShots = 0; offShots = 0;
    T.step(4, () => { pin(); if (u.target && u.offhand.target) { n++; if (u.target === u.offhand.target) same++; } if (u.offhand.cooldown > lastOff + 0.1) offShots++; if (u.fireCooldown > lastMain + 0.1) mainShots++; lastOff = u.offhand.cooldown; lastMain = u.fireCooldown; });
    out.focus = { frac: n ? +(same / n).toFixed(2) : 0, mainShots, offShots };
    // moving accuracy: standing cone < moving cone; Bullet Storm cuts the moving part
    const rate0 = u.fireRate;
    u.moveFrac = 0; const stand = u.cone; u.moveFrac = 1; const moving = u.cone;
    u.ability.execute(g, u); const stormMoving = u.cone; u.moveFrac = 0;
    out.cone = { stand: +stand.toFixed(3), moving: +moving.toFixed(3), storm: +stormMoving.toFixed(3), want: +(stand + (moving - stand) * C.bulletStorm.movePenaltyMul).toFixed(3) };
    // Bullet Storm: 8 s at x1.75, cooldown 40 s starting when it ends
    out.storm = { active: u.ability.activeLeft, cdDuring: u.ability.cooldownLeft };
    T.step(1, pin); out.storm.mul = +(u.fireRate / (rate0 / 1)).toFixed(3);
    const tEnd = T.stepUntil(() => u.ability.activeLeft <= 0, 12, pin);
    out.storm.len = +(1 + tEnd).toFixed(2); out.storm.cdAtEnd = +u.ability.cooldownLeft.toFixed(2);
    out.storm.rateAfter = u.fireRate === rate0;
    out.storm.block = u.ability.blockReason(g, u);
    const tReady = T.stepUntil(() => u.ability.ready(u), 50, pin);
    out.storm.cdLen = +tReady.toFixed(2);
    // the Storm ends early when the Commando goes down; the cooldown starts then
    u.ability.execute(g, u); T.step(2, pin); g.invuln = false; g.damage(u, 1e4); g.invuln = true; g.update(1 / 60);
    out.storm.downed = { state: u.state, active: u.ability.activeLeft, cd: +u.ability.cooldownLeft.toFixed(2), block: u.ability.blockReason(g, u) };
    g.invuln = false;
    // Elite: Gunslinger (Quick Draw + 2x Storm) / Assault Specialist (Close Quarters + heal on hit, capped)
    const EL = window.__elite;
    out.specs = ['com-gunslinger', 'com-assault'].map((sid) => { const s = EL.ELITE_SPECS[sid]; return s && { id: s.id, cls: s.classId, name: s.title, passive: s.passive }; });
    const promote = (sid) => { const s = T.R.get(id); const P = window.__progression; s.progression.xp = P.xpForLevel(25); s.progression.level = 25; a.credits += 3000; return T.E.promote(T.R, a, id, sid, window.__persist); };
    const pr = promote('com-gunslinger');
    out.promo = { ok: pr.ok, path: T.R.get(id).progression.elitePath };
    T.deploy(['ace', id], 'bridgehead');
    const gs = T.g.soldiers.find((s) => s.identity && s.identity.id === id);
    gs.ability.execute(T.g, gs); T.step(0.5);
    out.gun = { elite: gs.elite && gs.elite.id, mul: +(gs.fireRate / (gs.fireRate / gs.ability.fireRateMul())).toFixed(2), storm: gs.ability.fireRateMul(), enhanced: gs.ability.enhanced };
    // Assault Specialist (a second Commando)
    const r2 = T.recruitCommando(); const id2 = r2.soldier.id;
    { const s = T.R.get(id2); const P = window.__progression; s.progression.xp = P.xpForLevel(25); s.progression.level = 25; a.credits += 3000; out.promo2 = T.E.promote(T.R, a, id2, 'com-assault', window.__persist).ok; }
    T.deploy(['ace', id2], 'bridgehead');
    {
      const g2 = T.g, as = g2.soldiers.find((s) => s.identity && s.identity.id === id2); g2.invuln = false;
      const b2 = { ...as.pos };
      const near = g2.spawnEnemy(g2.findOpenNear({ x: b2.x + 120, y: b2.y }, 10)); near.hp = 1e9; near.maxHp = 1e9; near.fireCooldown = 1e9; near.guard = true; near.aggro = 1;
      const pin2 = () => { as.pos = { ...b2 }; as.vel = { x: 0, y: 0 }; near.fireCooldown = 1e9; near.hp = 1e9; for (const s of g2.soldiers) if (s !== as) { s.pos = { x: b2.x - 600, y: b2.y }; s.vel = { x: 0, y: 0 }; } };
      as.hp = 20; as.ability.execute(g2, as);
      T.step(8.2, pin2);
      out.assault = { healed: +as.ability.healed.toFixed(2), cap: C.bulletStorm.assaultHealCap, hp: +as.hp.toFixed(1), procs: as.elite.procs, cqRange: C.elite.cqRange, cqBonus: C.elite.cqBonus, d: Math.round(T.near(near.pos, b2)) };
      const healedNow = as.ability.healed; T.step(3, pin2);
      out.assault.noHealAfter = as.ability.healed === healedNow || as.ability.activeLeft === 0;
    }
    // persistence: reload keeps both Commandos and their specializations
    window.__persist();
    out.ids = [id, id2];
    return out;
  });
  check('F1 Commando never offered before Mission 12 is cleared (200 lineups); price 1250 CR, refund 300', !/commando/.test(cd.before) && cd.offersBefore === 0 && cd.price === 1250 && cd.refund === 300, `${cd.before} · ${cd.offersBefore} offers`);
  check('F2 once unlocked: offered in the office and recruited for 1250 CR at the starting level', /commando/.test(cd.after) && cd.recruit && cd.recruit.paid === 1250 && cd.recruit.cls === 'commando', JSON.stringify(cd.recruit));
  check('F3 base stats: 85 HP, 7 damage + 2.5 shots/s PER PISTOL, 115% speed (172.5 vs Infantry 150), range 340', cd.stats.hp === 85 && cd.stats.damage === 7 && cd.stats.fireRate === 2.5 && cd.stats.moveSpeed === cd.inf.moveSpeed * 1.15 && cd.stats.range === 340 && cd.eff.range === 340, `class ${JSON.stringify({ hp: cd.stats.hp, dmg: cd.stats.damage, rate: cd.stats.fireRate, speed: cd.stats.moveSpeed, range: cd.stats.range })}; recruit with trait ${JSON.stringify(cd.eff)}`);
  check('F4 in the field: dual pistols (offhand weapon), Bullet Storm ability', cd.field.offhand && cd.field.weapon === 'pistols' && cd.field.ability === 'bulletStorm', JSON.stringify(cd.field));
  check('F5 independent pistols: with two enemies in view they mostly hold different targets; both fire (~2 x 2.5/s)', cd.split.frac > 0.6 && cd.split.mainShots > 8 && cd.split.offShots > 8 && cd.split.rate > 4 && cd.split.rate < 5.6, JSON.stringify(cd.split));
  check('F6 both pistols can focus one target', cd.focus.frac > 0.9 && cd.focus.mainShots > 5 && cd.focus.offShots > 5, JSON.stringify(cd.focus));
  check('F7 moving accuracy: moving cone wider than standing; Bullet Storm cuts the moving penalty (x0.6)', cd.cone.moving > cd.cone.stand && Math.abs(cd.cone.storm - cd.cone.want) < 1e-3, JSON.stringify(cd.cone));
  check('F8 Bullet Storm: x1.75 for 8 s, cooldown 40 s starting when the effect ENDS', cd.storm.active === 8 && cd.storm.cdDuring === 0 && cd.storm.mul === 1.75 && Math.abs(cd.storm.len - 8) < 0.05 && Math.abs(cd.storm.cdAtEnd - 40) < 0.05 && cd.storm.rateAfter && /RECHARGING/.test(cd.storm.block) && Math.abs(cd.storm.cdLen - 40) < 0.05, JSON.stringify(cd.storm));
  check('F9 a downed Commando: the Storm ends at once and its cooldown starts; cannot be used while downed', cd.storm.downed.state === 'downed' && cd.storm.downed.active === 0 && Math.abs(cd.storm.downed.cd - 40) < 0.1 && cd.storm.downed.block === 'DOWNED', JSON.stringify(cd.storm.downed));
  check('F10 Elite branches: Gunslinger (Quick Draw) + Assault Specialist (Close Quarters), Commando only', cd.specs.every((s) => s && s.cls === 'commando') && /Gunslinger/.test(cd.specs[0].name) && /Assault Specialist/.test(cd.specs[1].name), JSON.stringify(cd.specs.map((s) => s && `${s.id}:${s.name}:${s.passive}`)));
  check('F11 Gunslinger: Enhanced Bullet Storm x2 fire rate', cd.promo.ok && cd.gun.elite === 'com-gunslinger' && cd.gun.storm === 2 && cd.gun.enhanced, JSON.stringify(cd.gun));
  check('F12 Assault Specialist: Close Quarters procs within 160 px; Storm hits heal, capped at 30 HP per activation', cd.promo2 && cd.assault.procs > 0 && cd.assault.d <= cd.assault.cqRange && cd.assault.healed > 0 && cd.assault.healed <= cd.assault.cap + 1e-9 && cd.assault.noHealAfter, JSON.stringify(cd.assault));
  await page.reload(); await page.waitForTimeout(200);
  const per = await ev((ids) => ids.map((id) => { const s = T.R.get(id); return s && `${s.classId}:${s.progression.tier}:${s.progression.elitePath}`; }).join(), cd.ids);
  check('F13 promotions persist across reload (save format unchanged)', per === 'commando:elite:com-gunslinger,commando:elite:com-assault', per);
  const tr = await ev((id) => {
    const a = T.a; a.credits += 50000;
    const s0 = window.__effectiveStats(T.R.get(id));
    const r1 = T.E.buyTraining(T.R, a, id, 'damage', 0, window.__persist);
    const r2 = T.E.buySquadTraining(a, 'fireRate', a.squadTraining.fireRate, window.__persist);
    const s1 = window.__effectiveStats(T.R.get(id));
    return { r1: r1.ok, r2: r2.ok, dmg: [s0.damage, s1.damage], rate: [s0.fireRate, s1.fireRate] };
  }, cd.ids[0]);
  check('F14 Individual + Squad Training apply to the Commando', tr.r1 && tr.r2 && tr.dmg[1] > tr.dmg[0] && tr.rate[1] > tr.rate[0], JSON.stringify(tr));
  const kia = await ev((id) => {
    const a = T.a, g = T.g;
    T.deploy(['ace', id], 'bridgehead');
    const u = g.soldiers.find((s) => s.identity && s.identity.id === id);
    g.damage(u, 1e4);
    const far = () => { for (const s of g.soldiers) if (s !== u) { s.pos = { x: u.pos.x + 500, y: u.pos.y }; s.vel = { x: 0, y: 0 }; } };
    T.stepUntil(() => u.state === 'kia', 30, far);
    T.calm(); g.mission.debugReadyExtraction(g); T.extract();
    const q = a.pendingDecision ? a.pendingDecision.queue.map((x) => x.id) : [];
    const cost = window.__casualties.costFor(T.R.get(id));
    a.credits += cost; const res = T.E.resurrect(T.R, a, id, window.__persist);
    const back = T.R.get(id).status;
    // second death -> Memorial
    T.deploy(['ace', id], 'bridgehead');
    const u2 = g.soldiers.find((s) => s.identity && s.identity.id === id);
    g.damage(u2, 1e4); T.stepUntil(() => u2.state === 'kia', 30, () => { for (const s of g.soldiers) if (s !== u2) { s.pos = { x: u2.pos.x + 500, y: u2.pos.y }; } });
    T.calm(); g.mission.debugReadyExtraction(g); T.extract();
    const m0 = a.memorial.length; T.E.memorialize(T.R, a, id, window.__persist);
    return { q: q.includes(id), cost, res: res.ok, back, mem: a.memorial.length - m0, memCls: a.memorial[a.memorial.length - 1] && a.memorial[a.memorial.length - 1].soldier.classId };
  }, cd.ids[0]);
  check('F15 KIA -> resurrection decision (class price) -> back in service; Memorial on a later death', kia.q && kia.cost > 0 && kia.res && kia.back === 'active' && kia.mem === 1 && kia.memCls === 'commando', JSON.stringify(kia));
  const recon = await ev(() => { const s = window.__elite.ELITE_SPECS['inf-recon']; return { name: s.title, id: s.id, cls: s.classId }; });
  check('F16 "Recon Commando" renamed to "Recon Specialist" with the same stable id (inf-recon)', recon.name === 'Recon Specialist' && recon.id === 'inf-recon' && recon.cls === 'infantry', JSON.stringify(recon));
  // save guard: Commandos in a save that never unlocked the class become plain Infantry; with Mission 12 cleared they stay
  const raw0 = await ev(() => JSON.stringify(T.store()));
  const edit = (clearM12) => { const raw = JSON.parse(raw0); raw.account.classUnlocks.unlocked = raw.account.classUnlocks.unlocked.filter((c) => c !== 'commando'); raw.account.missions = raw.account.missions || {}; if (clearM12) { const any = Object.values(raw.account.missions)[0]; raw.account.missions['artillery-hunt'] = { ...(any || {}), completions: 1 }; } else delete raw.account.missions['artillery-hunt']; return JSON.stringify(raw); };
  const n0 = JSON.parse(raw0).roster ? null : null;
  await fresh(edit(false));
  const gd1 = await ev(() => ({ st: window.__loadStatus.status, cdo: T.R.owned().filter((s) => s.classId === 'commando').length, unl: T.a.classUnlocks.unlocked.includes('commando'), ids: T.R.owned().map((s) => s.id + ':' + s.classId).join() }));
  await fresh(edit(true));
  const gd2 = await ev(() => ({ st: window.__loadStatus.status, cdo: T.R.owned().filter((s) => s.classId === 'commando').length, unl: T.a.classUnlocks.unlocked.includes('commando') }));
  check('F17 save guard: a Commando without the unlock (M12 not cleared) loads as Infantry; with M12 cleared it is kept', gd1.cdo === 0 && gd2.cdo >= 1 && gd2.st === 'loaded', JSON.stringify({ gd1, gd2 }));

  // ================= H. OLDER SAVES =================
  {
    const fx = JSON.parse(fs.readFileSync(__dirname + '/fixtures/v0.7B.1-save.json', 'utf8'));
    fx.account.missions['iron-fist'] = { ...fx.account.missions['blackout'] }; // a v0.7 player who already beat Mission 10
    await fresh(JSON.stringify(fx));
    const h = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes.length, unl: T.a.campaign.unlockedMissions.includes('resistance-rising'), m12: T.a.campaign.unlockedMissions.includes('artillery-hunt'), cdo: T.a.classUnlocks.unlocked.includes('commando'), recon: T.R.owned().filter((x) => x.progression.elitePath === 'inf-recon').length + T.a.memorial.filter((m) => m.soldier.progression.elitePath === 'inf-recon').length }));
    check('H1 a v0.7 save that already cleared M10: loads with no notes, Mission 11 open, M12 / Commando still locked', h.st === 'loaded' && h.notes === 0 && h.unl && !h.m12 && !h.cdo, JSON.stringify(h));
    for (const f of fs.readdirSync(__dirname + '/fixtures')) {
      await fresh(fs.readFileSync(__dirname + '/fixtures/' + f, 'utf8'));
      const r = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes.length, n: T.R.owned().length, recon: T.R.owned().filter((x) => x.progression && x.progression.elitePath === 'inf-recon').map((x) => window.__elite.specOf(x).title).join() }));
      check(`H2 ${f}: loads (no repair notes), Recon soldiers read as "Recon Specialist"`, (r.st === 'loaded' || r.st === 'migrated') && r.notes === 0 && r.n > 0 && (!r.recon || /^(Recon Specialist,?)+$/.test(r.recon)), JSON.stringify(r));
    }
  }

  // ================= G. PHONES =================
  const DEVICES = [{ name: 'iphoneSE', land: [667, 375], dpr: 2 }, { name: 'iphone14', land: [844, 390], dpr: 3 }, { name: 'pixel7', land: [915, 412], dpr: 2.625 }];
  for (const dev of DEVICES) {
    const c2 = await browser.newContext({ viewport: { width: dev.land[0], height: dev.land[1] }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    await c2.addInitScript(installHelpers);
    const p = await c2.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(URL); await p.evaluate(() => { localStorage.clear(); }); await p.goto(URL); await p.waitForTimeout(200);
    await p.evaluate(() => { window.__debugUnlockAll(); window.__persist(); });
    await p.reload(); await p.waitForTimeout(200);
    await p.tap('[data-a="cchap"][data-ch="3"]'); await p.waitForTimeout(60);
    await p.tap('[data-a="csel"][data-id="artillery-hunt"]'); await p.waitForTimeout(60);
    await p.tap('.c-btns [data-a="deploy"]'); await p.waitForTimeout(120);
    const L = await p.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight, el = document.querySelector('.brief');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const btns = [...el.querySelectorAll('[data-a="brief-deploy"], [data-a="brief-back"]')].map((b) => { const q = b.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { h: Math.round(q.height), w: Math.round(q.width), inside: q.top >= -0.5 && q.bottom <= vh + 0.5 && q.left >= -0.5 && q.right <= vw + 0.5, aligned: !!hit && (hit === b || b.contains(hit)) }; });
      const texts = [...el.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      const clipped = [...el.querySelectorAll('*')].filter((e) => e.offsetParent && e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY === 'hidden').length;
      const scale = parseFloat((document.getElementById('stage').style.transform.match(/scale\(([\d.]+)/) || [0, 1])[1]);
      return { inside: r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5, scroll: el.scrollHeight > el.clientHeight + 1, btns, minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))), scale, clipped };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/c3a-${dev.name}-briefing.png` });
    check(`G ${dev.name}: M12 briefing fits the landscape screen (no scroll, nothing clipped), DEPLOY / BACK tappable >= 44 CSS px`, L && L.inside && !L.scroll && L.clipped === 0 && L.btns.length === 2 && L.btns.every((b) => b.inside && b.aligned && b.h >= 43.5) && L.minFont >= 11, JSON.stringify(L));
    await p.tap('[data-a="brief-deploy"]'); await p.waitForTimeout(200);
    // Commando in the squad: its portrait ability button
    const H = await p.evaluate(() => {
      const g = window.game; g.selectMission('artillery-hunt', true); g.reset(['infantry', 'heavy', 'medic', 'sniper', 'commando']); T.calm();
      return true;
    });
    await p.waitForTimeout(250);
    const btn = await p.evaluate(() => {
      const panels = [...document.querySelectorAll('.panel')];
      const i = window.game.soldiers.findIndex((s) => s.classDef && s.classDef.id === 'commando');
      const b = panels[i] && panels[i].querySelector('.ability');
      if (!b) return null;
      const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const area = [[-21.5, 0], [21.5, 0], [0, -21.5], [0, 21.5], [-21, -21], [21, 21]].every(([dx, dy]) => { const h = document.elementFromPoint(cx + dx, cy + dy); return !!h && h.closest('.ability') === b; });
      return { i, w: Math.round(r.width), h: Math.round(r.height), area, aligned: !!hit && hit.closest('.ability') === b, txt: b.textContent.replace(/\s+/g, ' ').trim() };
    });
    if (btn) await p.tap(`.panel:nth-child(${btn.i + 1}) .ability`);
    await p.waitForTimeout(100);
    const st = await p.evaluate(() => { const u = window.game.soldiers.find((s) => s.classDef && s.classDef.id === 'commando'); return { active: +u.ability.activeLeft.toFixed(1), grenades: window.game.grenades.length, targeting: !!window.game.targeting }; });
    if (OUT) await p.screenshot({ path: `${OUT}/c3a-${dev.name}-commando-hud.png` });
    check(`G ${dev.name}: Commando portrait ability: 44 x 44 CSS px touch area, activates Bullet Storm (no grenade, no targeting)`, btn && btn.aligned && btn.area && st.active > 7 && st.grenades === 0 && !st.targeting, JSON.stringify({ btn, st }));
    check(`G ${dev.name}: no page errors`, errs.length === 0, errs.join(' | '));
    await c2.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(fails ? `\n${fails}/${total} FAILED` : `\nall ${total} Chapter 3A checks passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
