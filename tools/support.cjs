// v0.7C TACTICAL SUPPORT: acceptance checks against a served build (headless Chromium).
//
//   npm run build && npx vite preview --port 4173 &  node tools/support.cjs      (OUT=dir saves screenshots)
//   BASE=http://localhost:4174/   a v0.7B.1 build: rewards / XP / KIA prices / training / Elite numbers compared to it
//
// Six-soldier squads can't be deployed in the live campaign before Mission 13 (deployment caps are
// unchanged), so the six-Elite Nuclear Strike flow uses the existing dev harness: a 'temp' deployment
// of six roster soldiers (?squad= style, never rewarded). Every other check uses real roster
// deployments. Numbers 1-44 refer to the v0.7C brief's test list.
//  A. Data: radius / delay / countdown / price / catalog, live caps (no six-soldier mission before 13)
//  B. Eligibility [1-7]
//  C. Airstrike [8-18] (+ armored / falloff, support ignores soldier modifiers, no kill credit)
//  D. Nuclear Strike [19-35]
//  E. Compatibility [36-39, 43]: v0.7B.1 save fixture, rewards / XP, KIA + resurrection, training / Elite
//     (against BASE when given), victory / failure transitions with support
//  F. Frame rate + performance [41, 42]: seeded real frame loop 60 Hz/cap 60 vs 120 Hz/cap 30 vs 60 Hz/cap 30 with
//     both strikes, identical hashes; detonation step / render cost (headless, CPU x4 throttled)
//  G. Phones [40, 44]: iPhone SE / iPhone 14 / Pixel 7 landscape: touch flows, no overlaps, Support Shop
// PASS/FAIL per check; exits 1 on any failure.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const { installPilot } = require('./perf-lib.cjs');
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const OUT = process.env.OUT || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });

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
    lv(id, level) { const P = window.__progression, p = this.R.get(id).progression; p.xp = P.xpForLevel(level); p.level = P.levelForXp(p.xp); },
    /** Test setup only (bypasses the economy): make a soldier an Elite of `spec`. */
    spec(id, spec) { const p = this.R.get(id).progression; this.lv(id, 25); p.tier = 'elite'; p.elitePath = spec; p.specialization = spec; p.eliteLevel = 1; },
    SPEC: { ace: 'inf-trooper', ranger: 'inf-recon', tank: 'hvy-juggernaut', havoc: 'hvy-weapons', doc: 'med-surgeon', patch: 'med-commander' },
    elites(ids) { for (const id of ids) this.spec(id, this.SPEC[id]); },
    /** Real roster deployment (capacity + unlock rules apply). */
    deploy(ids, mission, calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.calm();
      return r;
    },
    /** Dev harness: six roster soldiers as a temporary squad (the only way to field six before Mission 13). */
    temp(ids, mission, calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'temp');
      if (r.ok && calm) this.calm();
      return r;
    },
    six(mission = 'iron-fist', calm = true) { this.elites(['ace', 'ranger', 'tank', 'havoc', 'doc', 'patch']); return this.temp(['ace', 'ranger', 'tank', 'havoc', 'doc', 'patch'], mission, calm); },
    /** A stationary enemy at an exact world point (never shoots). */
    foe(x, y, kind = 'rifleman', hp = null) {
      const e = window.game.spawnEnemy({ x, y }, kind); e.fireCooldown = 1e9; e.reactionTime = 1e9;
      if (hp !== null) { e.hpOverride = hp; e.hp = hp; }
      return e;
    },
    /** Pin units at their current spots (and keep enemies silent). */
    pinAll(units) { const at = units.map((u) => [u, { ...u.pos }]); return () => { for (const [u, p] of at) { u.pos = { ...p }; u.vel = { x: 0, y: 0 }; if (u.team === 'enemy') u.fireCooldown = 1e9; } }; },
    /** Camera on a world point (the screen <-> world conversion follows it). */
    look(p) { const g = window.game; g.cam = { x: p.x, y: p.y }; },
    /** Aim an airstrike at a world point through the real screen conversion. */
    aimAt(p) { const g = window.game; g.onSupportAim(g.worldToScreen(p)); },
    bossUp() {
      const g = window.game, m = g.mission;
      m.current = 2; m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.primaries[2].activate(m, g); m.phase = 'boss';
      return m.boss.unit;
    },
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
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(104)} ${String(detail).replace(/\s+/g, ' ').slice(0, 300)}`); };
  const fresh = async (raw = null, url = URL) => {
    await page.goto(url); await page.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await page.goto(url); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(50);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. DATA =================
  await fresh();
  const data = await ev(() => {
    const C = T.C, cp = window.__campaign;
    const items = window.__supportItems ?? null;
    return {
      air: [C.airstrike.radius, C.airstrike.delay], nuke: C.nuke.countdown, floors: [C.support.bossFloor, C.support.objectiveFloor],
      caps: Array.from({ length: 14 }, (_, i) => cp.capacityFor(i + 1)).join(), live: cp.CAMPAIGN.filter((m) => m.playable).map((m) => cp.capacityFor(m.number)),
      label: document.title, items,
    };
  });
  check('A1 airstrike radius 120 world px (a radius), ~2 s delay; nuke 30 s countdown; floors boss 10% / objective 1 HP', data.air.join() === '120,2' && data.nuke === 30 && data.floors.join() === '0.1,1', JSON.stringify(data));
  check('A2 deployment caps unchanged (M1-12 at most 5, six from Mission 13); every playable mission <= 5', data.caps === '2,2,3,3,3,4,5,5,5,5,5,5,6,6' && Math.max(...data.live) === 5, data.caps);

  // ================= B. ELIGIBILITY =================
  const elig = await ev(() => {
    const out = {}, g = T.g;
    window.__debugUnlockAll();
    // [1] two deployed Elites (Mission 3, capacity 3)
    T.elites(['ace', 'tank']);
    T.deploy(['ace', 'tank', 'doc'], 'field-medicine');
    out.two = { elites: g.support.elites, air: g.support.air, nuke: g.support.nuke, use: g.useAirstrike(), notice: g.notice?.text ?? '' };
    // [3] three Elites in the Barracks, only two deployed
    T.elites(['havoc']);
    T.deploy(['ace', 'tank', 'ranger'], 'field-medicine');
    out.bench = { owned: g.roster.owned().filter((s) => s.progression.tier === 'elite').length, elites: g.support.elites, air: g.support.air };
    // [2] three deployed Elites
    T.deploy(['ace', 'tank', 'havoc'], 'field-medicine');
    out.three = { elites: g.support.elites, air: g.support.air, nuke: g.support.nuke, use: g.useAirstrike(), aiming: g.support.aiming };
    g.cancelAirstrike();
    // [6] class mixes: 2 Heavy + 1 Medic, 1 of each, 2 Medics + 1 Infantry, 3 Elites of the same class? (only two per class exist: tested via the rule itself)
    const mixes = [['tank', 'havoc', 'doc'], ['ace', 'tank', 'doc'], ['doc', 'patch', 'ranger']];
    T.elites(['ace', 'ranger', 'tank', 'havoc', 'doc', 'patch']);
    out.mixes = mixes.map((m) => { T.deploy(m, 'field-medicine'); return `${m.map((id) => g.roster.get(id).classId).join('+')}:${g.support.air}`; });
    const S = window.__support.Support;
    out.rule = [0, 1, 2, 3, 4, 5, 6].map((n) => { const s = new S(n); return `${n}:${s.airEligible ? 'A' : '-'}${s.nukeEligible ? 'N' : '-'}`; }).join(' ');
    // [4] five deployed Elites (Mission 10, capacity 5)
    T.a.support.nukes = 3;
    T.deploy(['ace', 'ranger', 'tank', 'havoc', 'doc'], 'iron-fist');
    out.five = { elites: g.support.elites, air: g.support.air, nuke: g.support.nuke, open: g.useNuke(), state: g.support.nuke, notice: g.notice?.text ?? '' };
    // live campaign: six can't deploy into Mission 10
    out.sixRoster = T.deploy(['ace', 'ranger', 'tank', 'havoc', 'doc', 'patch'], 'iron-fist');
    // [5] six deployed Elites (dev harness)
    T.six();
    out.six = { n: g.soldiers.length, elites: g.support.elites, air: g.support.air, nuke: g.support.nuke, open: g.useNuke(), state: g.support.nuke };
    g.cancelNuke();
    // [7] an Elite downed / killed mid-mission keeps the abilities; nothing unlocks mid-mission
    g.downSoldier(g.soldiers[0]); g.soldiers[1].state = 'kia';
    T.step(0.5);
    out.downed = { air: g.support.air, nuke: g.support.nuke, use: g.useAirstrike() };
    g.cancelAirstrike();
    // two Elites + one Recruit at the start (Patch fielded as a Recruit for this check)
    { const p = T.R.get('patch').progression; p.tier = 'recruit'; p.elitePath = null; p.specialization = null; p.eliteLevel = 0; p.eliteXp = 0; T.deploy(['ace', 'tank', 'patch'], 'field-medicine'); }
    const before = g.support.air;
    g.spawnSoldier(undefined, structuredClone(T.R.get('havoc'))); // a fourth soldier (dev key F) mid-mission
    out.midJoin = { before, after: g.support.air, eliteCount: g.eliteCount };
    return out;
  });
  check('B1 [1] two deployed Elites: no airstrike (button refuses, says why)', elig.two.elites === 2 && elig.two.air === 'locked' && !elig.two.use && /3 deployed Elites/.test(elig.two.notice), JSON.stringify(elig.two));
  check('B2 [2] three deployed Elites: airstrike ready, AIRSTRIKE starts aiming', elig.three.elites === 3 && elig.three.air === 'ready' && elig.three.use && elig.three.aiming && elig.three.nuke === 'locked', JSON.stringify(elig.three));
  check('B3 [3] three Elites in the Barracks, two deployed: no airstrike', elig.bench.owned >= 3 && elig.bench.elites === 2 && elig.bench.air === 'locked', JSON.stringify(elig.bench));
  check('B4 [4] five deployed Elites (with 3 nukes owned): no nuke', elig.five.elites === 5 && elig.five.air === 'ready' && elig.five.nuke === 'locked' && !elig.five.open && elig.five.state === 'locked' && /6 deployed Elites/.test(elig.five.notice), JSON.stringify(elig.five));
  check('B5 [5] six deployed Elites (sixth slot via the dev harness): nuke ready; the live Mission 10 still refuses six', elig.six.n === 6 && elig.six.elites === 6 && elig.six.nuke === 'ready' && elig.six.open && elig.six.state === 'confirm' && !elig.sixRoster.ok && /allows 5/.test(elig.sixRoster.reason), JSON.stringify({ six: elig.six, roster: elig.sixRoster }));
  check('B6 [6] no class requirement: any mix of 3 Elites qualifies; rule depends on the count only', elig.mixes.every((m) => /:ready$/.test(m)) && elig.rule === '0:-- 1:-- 2:-- 3:A- 4:A- 5:A- 6:AN', `${elig.mixes.join(' ')} | ${elig.rule}`);
  check('B7 [7] Elites downed / KIA mid-mission: abilities stay; a soldier joining mid-mission unlocks nothing', elig.downed.air === 'ready' && elig.downed.nuke === 'ready' && elig.downed.use && elig.midJoin.before === 'locked' && elig.midJoin.after === 'locked', JSON.stringify(elig));

  // ================= C. AIRSTRIKE =================
  const air = await ev(() => {
    const out = {}, g = T.g, A = T.C.airstrike;
    window.__debugUnlockAll(); T.elites(['ace', 'tank', 'doc']);
    T.deploy(['ace', 'tank', 'doc'], 'field-medicine');
    const sq = g.soldiers[0].pos;
    // target 600 px east of the squad (no soldier inside)
    const c = { x: Math.min(g.map.w - 300, sq.x + 600), y: sq.y };
    T.look({ x: c.x - 200, y: c.y + 100 }); // camera off-centre from the target: conversion must still be exact
    // [8] target selection: tap -> world point under the finger; a drag adjusts it
    g.useAirstrike();
    const s1 = g.worldToScreen({ x: c.x - 40, y: c.y + 30 });
    g.onSupportAim(s1);
    out.first = { ...g.support.aim };
    T.aimAt(c);
    out.aim = { ...g.support.aim };
    out.aimOk = Math.abs(out.first.x - (c.x - 40)) < 1e-6 && Math.abs(out.first.y - (c.y + 30)) < 1e-6 && Math.abs(out.aim.x - c.x) < 1e-6 && Math.abs(out.aim.y - c.y) < 1e-6;
    // [9] cancel: nothing used, AIRSTRIKE works again
    g.cancelAirstrike();
    out.cancel = { air: g.support.air, again: g.useAirstrike(), aim: g.support.aim };
    T.aimAt(c);
    // enemies at exact distances (+ an Armored Trooper at the centre and the rim)
    const mk = (d, kind = 'rifleman', hp = 10000) => T.foe(c.x + d, c.y, kind, hp);
    const ring = [0, 60, 119, 121, 200].map((d) => mk(d));
    const arm0 = T.foe(c.x, c.y + 4, 'armored'), armR = T.foe(c.x, c.y - 119, 'armored', 10000);
    const kill = [T.foe(c.x - 50, c.y + 50), T.foe(c.x + 30, c.y - 70), T.foe(c.x - 90, c.y + 10, 'sniper'), T.foe(c.x + 80, c.y + 60, 'tower')];
    const pin = T.pinAll([...ring, arm0, armR, ...kill, ...g.soldiers]);
    const kills0 = [...g.stats.bySoldier.values()].reduce((a, r) => a + r.kills, 0);
    const hp0 = g.soldiers.map((s) => s.hp);
    // [10] confirm uses it
    out.confirm = g.confirmAirstrike();
    out.afterConfirm = { air: g.support.air, again: g.useAirstrike(), notice: g.notice?.text ?? '' };
    // [11] ~2 s delay (simulation time)
    const t0 = g.time;
    T.step(1.95, pin);
    out.before = { hp: ring[0].hp, air: g.support.air };
    const dt = T.stepUntil(() => g.support.air === 'used', 1, pin);
    out.delay = +(g.time - t0).toFixed(3);
    void dt;
    // [12] [13] inside the radius only, falloff to edgeFrac at the rim
    out.dmg = ring.map((e) => Math.round(10000 - e.hp));
    // spawning nudges a unit out of walls / other units by a few px: expected values use each unit's real distance
    const fall = (e) => { const d = Math.hypot(e.pos.x - c.x, e.pos.y - c.y); return d > A.radius ? 0 : 1 - (d / A.radius) * (1 - A.edgeFrac); };
    out.dist = ring.map((e) => +Math.hypot(e.pos.x - c.x, e.pos.y - c.y).toFixed(1));
    out.expect = ring.map((e) => Math.round(A.damage * fall(e)));
    out.arm = { centre: arm0.state, rim: Math.round(10000 - armR.hp), expect: Math.round(A.damage * A.armoredMul * fall(armR)) };
    out.killed = kill.map((e) => e.state).join();
    // [14] friendly soldiers untouched (the squad is 600 px away; a captive / soldier INSIDE the circle below)
    out.friendly = g.soldiers.every((s, i) => s.hp === hp0[i] && s.state === 'active');
    out.kills = [...g.stats.bySoldier.values()].reduce((a, r) => a + r.kills, 0) - kills0;
    out.log = g.support.log.map((l) => l.what);
    // [17] no second airstrike in the same mission
    out.second = { use: g.useAirstrike(), air: g.support.air, notice: g.notice?.text ?? '' };
    return out;
  });
  check('C1 [8] target selection: a tap / drag sets the target at the world point under it (camera off-centre)', air.aimOk, JSON.stringify({ first: air.first, aim: air.aim }));
  check('C2 [9] CANCEL before CONFIRM costs nothing: AIRSTRIKE can be aimed again', air.cancel.air === 'ready' && air.cancel.again && air.cancel.aim === null, JSON.stringify(air.cancel));
  check('C3 [10] CONFIRM uses the airstrike (INCOMING; AIRSTRIKE refuses meanwhile)', air.confirm && air.afterConfirm.air === 'incoming' && !air.afterConfirm.again && /INCOMING/.test(air.afterConfirm.notice), JSON.stringify(air.afterConfirm));
  check('C4 [11] impact ~2 s after CONFIRM (simulation time), nothing before', air.before.hp === 10000 && air.before.air === 'incoming' && Math.abs(air.delay - 2) <= 1 / 60 + 1e-9, `impact after ${air.delay}s`);
  check('C5 [12] damage inside the 120 px radius, linear falloff to 50% at the rim (exact values)', air.dmg.join() === air.expect.join() && air.dist[0] < 15 && air.dist[2] > 100 && air.dist[2] <= 120, `${air.dmg.join()} vs ${air.expect.join()} at ${air.dist.join()} px`);
  check('C6 [13] enemies outside the radius are untouched (121 px, 200 px)', air.dmg[3] === 0 && air.dmg[4] === 0, air.dmg.join());
  check('C7 clustered infantry / sniper / watchtower wiped; Armored Trooper dead at the centre, heavily hit at the rim', air.killed === 'dead,dead,dead,dead' && air.arm.centre === 'dead' && air.arm.rim === air.arm.expect, JSON.stringify({ killed: air.killed, arm: air.arm }));
  check('C8 support gets no kill credit; squad untouched; log', air.kills === 0 && air.friendly && air.log.join() === 'airstrike-confirm,airstrike-impact', JSON.stringify({ kills: air.kills, log: air.log }));
  check('C9 [17] a second airstrike in the same mission is refused (USED)', !air.second.use && air.second.air === 'used' && /USED/.test(air.second.notice), JSON.stringify(air.second));

  const air2 = await ev(() => {
    const out = {}, g = T.g;
    window.__debugUnlockAll(); T.elites(['ace', 'tank', 'doc']);
    // [14] soldiers + a freed captive INSIDE the blast (Mission 5 rescue)
    T.deploy(['ace', 'tank', 'doc'], 'bring-them-home');
    const c = { ...g.soldiers[0].pos };
    const npc = g.npcs[0]; npc.escorting = true; npc.pos = { x: c.x + 30, y: c.y + 20 };
    g.soldiers.forEach((s, i) => { s.pos = { x: c.x + i * 25 - 25, y: c.y - 10 }; });
    const pin = T.pinAll([...g.soldiers, npc]);
    const hp0 = [...g.soldiers, npc].map((u) => u.hp);
    const foe = T.foe(c.x + 50, c.y, 'rifleman', 10000);
    T.look(c); g.useAirstrike(); T.aimAt(c); g.confirmAirstrike();
    T.step(2.1, pin);
    out.inside = { hp: [...g.soldiers, npc].map((u) => u.hp), hp0, states: [...g.soldiers, npc].map((u) => u.state).join(), foe: Math.round(10000 - foe.hp), npcLog: g.mission.optionals.map((o) => o.state).join() };
    // [15] boss: never below 10% (Mission 10)
    T.elites(['ace', 'tank', 'doc', 'ranger', 'havoc']);
    T.deploy(['ace', 'tank', 'doc', 'ranger', 'havoc'], 'iron-fist');
    const b = T.bossUp(); const bp = { ...b.pos };
    const pinB = () => { b.pos = { ...bp }; b.vel = { x: 0, y: 0 }; };
    g.invuln = true;
    T.look(bp); g.useAirstrike(); T.aimAt(bp); g.confirmAirstrike(); T.step(2.05, pinB);
    out.bossFull = { lost: Math.round(b.maxHp - b.hp), frac: +(b.hp / b.maxHp).toFixed(4) };
    // retry from a weakened boss: 12% -> 10% (not lower), the boss is still alive
    g.reset(); T.calm();
    const b2 = T.bossUp(); const bp2 = { ...b2.pos }; b2.hp = b2.maxHp * 0.12; g.invuln = true;
    T.look(bp2); g.useAirstrike(); T.aimAt(bp2); g.confirmAirstrike(); T.step(2.05, () => { b2.pos = { ...bp2 }; });
    out.bossLow = { frac: +(b2.hp / b2.maxHp).toFixed(6), state: b2.state, phase: g.phase };
    // [18] a new attempt (Retry) has the airstrike again
    out.retry = { air: g.support.air };
    g.reset(); T.calm();
    out.retry.after = g.support.air;
    // [16] objectives: the Mission 2 depot (600 HP) and Mission 8 trucks keep >= 1 HP
    T.elites(['ace', 'tank', 'doc']);
    T.deploy(['ace', 'tank'], 'heavy-support'); // capacity 2 -> no airstrike here; use the dev harness on the same map
    out.m2cap = g.support.air;
    T.temp(['ace', 'tank', 'doc'], 'heavy-support');
    const dep = g.enemies.find((e) => e.structure);
    const full = dep.hp; T.look(dep.pos); g.useAirstrike(); T.aimAt(dep.pos); g.confirmAirstrike(); T.step(2.05);
    out.depFull = { lost: Math.round(full - dep.hp), max: dep.maxHp };
    g.reset(); T.calm();
    const dep2 = g.enemies.find((e) => e.structure); dep2.hp = 40;
    T.look(dep2.pos); g.useAirstrike(); T.aimAt(dep2.pos); g.confirmAirstrike(); T.step(2.05);
    out.depLow = { hp: dep2.hp, state: dep2.state, obj: g.mission.primaries.map((o) => o.state).join() };
    // grenades still finish it (the squad must destroy it themselves)
    window.__CFG.grenade.flightTime = 0.65;
    g.explodeTest = null;
    return out;
  });
  check('C10 [14] soldiers and a freed captive inside the blast take no damage (enemy beside them does)', JSON.stringify(air2.inside.hp) === JSON.stringify(air2.inside.hp0) && air2.inside.states === 'active,active,active,active' && air2.inside.foe > 200, JSON.stringify(air2.inside));
  check('C11 [15] Iron Warden: a full-HP boss loses 15% (360 at the centre, falloff); from 12% it stops at exactly 10% and lives', air2.bossFull.lost >= 355 && air2.bossFull.lost <= 360 && air2.bossLow.frac === 0.1 && air2.bossLow.state === 'active' && air2.bossLow.phase === 'playing', JSON.stringify({ full: air2.bossFull, low: air2.bossLow }));
  check('C12 [18] Retry (new attempt) has the airstrike ready again', air2.retry.air === 'used' && air2.retry.after === 'ready', JSON.stringify(air2.retry));
  check('C13 [16] required objective: depot takes 130 at the centre; from 40 HP it is left at 1 HP, objective still open', air2.depFull.lost === 130 && air2.depLow.hp === 1 && air2.depLow.state === 'active' && /active/.test(air2.depLow.obj), JSON.stringify(air2));
  check('C14 Mission 2 roster squad (capacity 2) never gets the airstrike', air2.m2cap === 'locked', air2.m2cap);

  // support damage ignores soldier modifiers: a fully trained Elite 30 squad deals exactly the configured numbers
  const pure = await ev(() => {
    const g = T.g, out = {};
    window.__debugUnlockAll(); T.elites(['ace', 'tank', 'doc']);
    for (const id of ['ace', 'tank', 'doc']) { const s = T.R.get(id); for (const k of Object.keys(s.training)) s.training[k] = 10; s.progression.eliteXp = 1e6; s.progression.eliteLevel = 30; }
    for (const k of Object.keys(T.a.squadTraining)) T.a.squadTraining[k] = 5;
    T.R.get('doc').progression.elitePath = 'med-commander'; T.R.get('doc').progression.specialization = 'med-commander';
    T.deploy(['ace', 'tank', 'doc'], 'field-medicine');
    const sq = g.soldiers[0].pos, c = { x: sq.x + 500, y: sq.y };
    const foes = [T.foe(c.x, c.y, 'rifleman', 10000), T.foe(c.x + 60, c.y, 'armored', 10000)];
    const pin = T.pinAll([...foes, ...g.soldiers]);
    T.look(c); g.useAirstrike(); T.aimAt(c); g.confirmAirstrike(); T.step(2.05, pin);
    out.dmg = foes.map((e) => Math.round(10000 - e.hp));
    const A = T.C.airstrike, k = (e) => 1 - (Math.hypot(e.pos.x - c.x, e.pos.y - c.y) / A.radius) * (1 - A.edgeFrac);
    out.expect = [Math.round(A.damage * k(foes[0])), Math.round(A.damage * A.armoredMul * k(foes[1]))];
    out.dealt = g.soldiers.map((s) => s.dealt);
    return out;
  });
  check('C15 support damage ignores training / Elite levels / Rally / passives (exact config numbers, no credit)', pure.dmg.join() === pure.expect.join() && pure.dealt.every((d) => d === 0), JSON.stringify(pure));

  // ================= D. NUCLEAR STRIKE =================
  const shop = await ev(() => {
    const out = {}, a = T.a, E = T.E, P = window.__persist;
    a.support = { nukes: 0, purchased: 0, launched: 0 }; a.credits = 7000; P();
    // [19] exactly 3,000
    const r1 = E.buySupport(a, 'nuke', 0, P);
    out.one = { ok: r1.ok, cost: r1.cost, cr: a.credits, stock: a.support.nukes, saved: T.store().account.support };
    // [21] several purchases stack; a stale / repeated tap (old stock) is refused
    const r2 = E.buySupport(a, 'nuke', 1, P);
    const dup = E.buySupport(a, 'nuke', 1, P);
    out.two = { ok: r2.ok, cr: a.credits, stock: a.support.nukes, dup: dup.ok, dupReason: dup.reason };
    // [20] 1,000 CR left: refused, nothing changes
    const r3 = E.buySupport(a, 'nuke', 2, P);
    out.poor = { ok: r3.ok, reason: r3.reason, cr: a.credits, stock: a.support.nukes };
    // a failed save write rolls back; never during a mission; unknown item
    a.credits = 3000;
    const rb = E.buySupport(a, 'nuke', 2, () => 'error');
    out.rollback = { ok: rb.ok, reason: rb.reason, cr: a.credits, stock: a.support.nukes, purchased: a.support.purchased };
    out.inMission = E.buySupport(a, 'nuke', 2, P, { inMission: true }).ok;
    out.unknown = E.buySupport(a, 'tank', 2, P).ok;
    a.credits = 9000; E.buySupport(a, 'nuke', 2, P);
    out.final = { cr: a.credits, ...a.support };
    return out;
  });
  check('D1 [19] one Nuclear Strike costs exactly 3,000 CR (7,000 -> 4,000), stock 1, saved at once', shop.one.ok && shop.one.cost === 3000 && shop.one.cr === 4000 && shop.one.stock === 1 && shop.one.saved.nukes === 1, JSON.stringify(shop.one));
  check('D2 [21] multiple purchases stack (stock 2); a repeated tap for the old stock is refused', shop.two.ok && shop.two.cr === 1000 && shop.two.stock === 2 && !shop.two.dup, JSON.stringify(shop.two));
  check('D3 [20] not enough Credits: refused, Credits and stock unchanged', !shop.poor.ok && /Not enough Credits/.test(shop.poor.reason) && shop.poor.cr === 1000 && shop.poor.stock === 2, JSON.stringify(shop.poor));
  check('D4 failed save write rolls the purchase back; not in a mission; unknown items refused', !shop.rollback.ok && shop.rollback.cr === 3000 && shop.rollback.stock === 2 && shop.rollback.purchased === 2 && !shop.inMission && !shop.unknown, JSON.stringify(shop.rollback));
  // [22] reload
  await page.reload(); await page.waitForFunction(() => !!window.game);
  const rl = await ev(() => ({ inv: { ...T.a.support }, cr: T.a.credits, st: window.__loadStatus.status, notes: window.__loadStatus.notes }));
  check('D5 [22] stock survives a reload (3 nukes, counters, Credits); status loaded, no notes', rl.inv.nukes === 3 && rl.inv.purchased === 3 && rl.inv.launched === 0 && rl.cr === 6000 && rl.st === 'loaded' && rl.notes.length === 0, JSON.stringify(rl));

  const nk = await ev(() => {
    const out = {}, g = T.g, a = T.a;
    window.__debugUnlockAll();
    T.six('iron-fist', false);
    // [24] cancel: nothing deducted
    out.open = g.useNuke();
    out.state = g.support.nuke;
    g.cancelNuke();
    out.cancel = { state: g.support.nuke, stock: a.support.nukes, saved: T.store().account.support.nukes };
    // full map: enemies everywhere (on screen / far off screen / dormant guards / armored / snipers)
    const far = [T.foe(80, 80), T.foe(g.map.w - 80, 80, 'armored'), T.foe(80, g.map.h - 80, 'sniper'), T.foe(g.map.w - 80, g.map.h - 80, 'tower')];
    const onScreen = g.enemies.filter((e) => e.active && g.isOnScreen(e.pos)).length;
    const offBefore = g.enemies.filter((e) => e.active && !g.isOnScreen(e.pos)).length;
    const guards = g.enemies.filter((e) => e.active && e.guard).length;
    const objs = g.enemies.filter((e) => e.structure);
    const b = T.bossUp();
    const enemies0 = g.enemies.filter((e) => e.active).length;
    // [23] launch: exactly one deducted and saved before anything else happens
    g.useNuke();
    out.launch = g.launchNuke();
    out.afterLaunch = { stock: a.support.nukes, launched: a.support.launched, saved: T.store().account.support, state: g.support.nuke, left: g.support.nukeLeft };
    // [32] no second nuke (stock 2 left)
    out.second = { open: g.useNuke(), state: g.support.nuke, notice: g.notice?.text ?? '' };
    // [26] combat and movement go on during the countdown
    g.invuln = true;
    const shots0 = g.soldiers.reduce((s, u) => s + u.shots, 0), eshots0 = g.enemies.reduce((s, u) => s + u.shots, 0), anchor0 = { ...g.anchor };
    g.input.move = () => ({ x: 1, y: 0 });
    // the six Elites clear nearby infantry fast: a sturdy rifleman alongside keeps the enemy side firing
    for (const dy of [-160, 160]) { const sh = g.spawnEnemy({ x: g.anchor.x + 220, y: g.anchor.y + dy }, 'rifleman'); sh.hpOverride = 1e6; sh.hp = 1e6; }
    T.step(10);
    out.during = { moved: Math.round(Math.hypot(g.anchor.x - anchor0.x, g.anchor.y - anchor0.y)), shots: g.soldiers.reduce((s, u) => s + u.shots, 0) - shots0, eshots: g.enemies.reduce((s, u) => s + u.shots, 0) - eshots0, left: +g.support.nukeLeft.toFixed(3) };
    g.input.move = () => ({ x: 0, y: 0 });
    for (const e of g.enemies) if (e.hp > 1e5) e.hp = 40; // the two sturdy riflemen go back to normal HP
    // [27] pause freezes the countdown
    g.paused = true; const leftP = g.support.nukeLeft, timeP = g.time;
    T.step(5);
    out.paused = { before: leftP, after: g.support.nukeLeft, time: g.time === timeP };
    g.paused = false;
    // [25] 30 s of simulation time in all
    T.step(19.9);
    out.at299 = { state: g.support.nuke, left: +g.support.nukeLeft.toFixed(3) };
    const objHp = objs.map((o) => o.hp), bossBefore = b.hp;
    const hp0 = [...g.soldiers, ...g.npcs].map((u) => u.hp);
    const tStart = g.support.log.find((l) => l.what === 'nuke-launch').t;
    out.activeAtDet = g.enemies.filter((e) => e.active).length; // some fell to the squad during the countdown
    T.stepUntil(() => g.support.nuke === 'used', 1);
    const det = g.support.log.find((l) => l.what === 'nuke-detonate');
    out.countdown = +(det.t - tStart).toFixed(3);
    // [28] whole map, off screen too
    out.far = far.map((e) => e.state).join();
    out.left = g.enemies.filter((e) => e.active && !e.structure && e.kind !== 'boss').length;
    out.hitN = det.n; out.enemies0 = enemies0; out.onScreen = onScreen; out.offBefore = offBefore; out.guards = guards;
    // [29] friendly units untouched by the blast
    out.friendly = [...g.soldiers, ...g.npcs].every((u, i) => u.hp >= hp0[i]);
    // [30] [31] floors
    out.boss = { before: +(bossBefore / b.maxHp).toFixed(4), after: +(b.hp / b.maxHp).toFixed(4), state: b.state };
    out.objs = objs.map((o, i) => `${o.structure}:${Math.round(objHp[i])}->${Math.round(o.hp)}:${o.state}`).join(' ');
    out.objOk = objs.every((o) => o.state === 'active' && o.hp >= 1);
    out.phase = g.phase;
    return out;
  });
  check('D6 [24] cancelling the confirmation deducts nothing (stock 3, saved 3)', nk.open && nk.state === 'confirm' && nk.cancel.state === 'ready' && nk.cancel.stock === 3 && nk.cancel.saved === 3, JSON.stringify(nk.cancel));
  check('D7 [23] LAUNCH deducts exactly one and saves it at once (3 -> 2, launched 1); countdown 30 s starts', nk.launch.ok && nk.afterLaunch.stock === 2 && nk.afterLaunch.launched === 1 && nk.afterLaunch.saved.nukes === 2 && nk.afterLaunch.saved.launched === 1 && nk.afterLaunch.state === 'countdown' && nk.afterLaunch.left === 30, JSON.stringify(nk.afterLaunch));
  check('D8 [32] a second nuke in the same mission is refused even with stock left', !nk.second.open && nk.second.state === 'countdown' && /ALREADY LAUNCHED/.test(nk.second.notice), JSON.stringify(nk.second));
  check('D9 [26] the squad keeps moving and both sides keep firing during the countdown', nk.during.moved > 300 && nk.during.shots > 20 && nk.during.eshots > 5 && Math.abs(nk.during.left - 20) < 1e-6, JSON.stringify(nk.during));
  check('D10 [27] pause freezes the countdown and the mission clock', nk.paused.before === nk.paused.after && nk.paused.time, JSON.stringify(nk.paused));
  check('D11 [25] detonation exactly 30 s of simulation time after launch (not at 29.9 s)', nk.at299.state === 'countdown' && Math.abs(nk.countdown - 30) <= 1 / 60 + 1e-9, `at 29.9: ${JSON.stringify(nk.at299)}, detonated after ${nk.countdown}s`);
  check('D12 [28] every enemy on the map is hit, off-screen and dormant ones included (none of them survive)', nk.far === 'dead,dead,dead,dead' && nk.left === 0 && nk.hitN === nk.activeAtDet && nk.offBefore > 10, JSON.stringify({ far: nk.far, left: nk.left, hit: nk.hitN, active: nk.activeAtDet, enemies: nk.enemies0, onScreen: nk.onScreen, off: nk.offBefore, guards: nk.guards }));
  check('D13 [29] soldiers and allies take no nuke damage', nk.friendly, '');
  check('D14 [30] the boss loses 40% and keeps >= 10% (alive)', nk.boss.after >= 0.1 && Math.abs(nk.boss.before - nk.boss.after - 0.4) < 0.001 && nk.boss.state === 'active', JSON.stringify(nk.boss));
  check('D15 [31] mission objectives keep >= 1 HP (installations not destroyed)', nk.objOk && nk.objs.length > 0, nk.objs);

  // [31] objectives near death + boss near the floor; [33] failure; [34] win keeps stock; [35] both in one mission
  const nk2 = await ev(() => {
    const out = {}, g = T.g, a = T.a;
    a.support.nukes = 2; window.__persist();
    // objectives at low HP (Mission 9 relays, Mission 8 trucks) and a boss at 11%
    T.six('blackout');
    const relays = g.enemies.filter((e) => e.structure); relays.forEach((r) => { r.hp = 30; });
    g.useNuke(); g.launchNuke(); g.invuln = true; T.step(30.05);
    out.relays = relays.map((r) => `${r.hp}:${r.state}`).join();
    out.stockM9 = a.support.nukes;
    // [33] mission lost before detonation: the launched nuke stays spent (also after a reload)
    T.six('iron-fist');
    g.useNuke(); g.launchNuke(); T.step(5);
    out.failBefore = a.support.nukes;
    g.fail();
    T.step(30);
    out.fail = { phase: g.phase, stock: a.support.nukes, saved: T.store().account.support.nukes, nuke: g.support.nuke, log: g.support.log.map((l) => l.what).join() };
    // [34] a won mission leaves unused stock alone (Mission 1 via a roster squad: no nuke possible there)
    a.support.nukes = 1; window.__persist();
    T.elites(['ace', 'ranger']);
    T.deploy(['ace', 'ranger'], 'first-contact');
    g.win();
    out.win = { phase: g.phase, stock: a.support.nukes, saved: T.store().account.support.nukes };
    // [35] six Elites: airstrike and nuke in the same mission, tracked separately
    a.support.nukes = 1; window.__persist();
    T.six('iron-fist');
    g.invuln = true;
    const sq = g.soldiers[0].pos; const c = { x: sq.x + 450, y: sq.y }; T.foe(c.x, c.y, 'armored');
    g.useNuke(); out.both = { launch: g.launchNuke().ok };
    out.both.air = g.useAirstrike(); T.look(c); T.aimAt(c); out.both.confirm = g.confirmAirstrike();
    T.step(2.1);
    out.both.mid = { air: g.support.air, nuke: g.support.nuke };
    T.step(28);
    out.both.end = { air: g.support.air, nuke: g.support.nuke, stock: a.support.nukes, log: g.support.log.map((l) => l.what).join() };
    // trucks (Mission 8)
    T.six('convoy-crusher', false);
    const cv = g.mission.convoy; cv.launch(g); cv.trucks.forEach((t, i) => { t.launchAt = i * 0.6; });
    g.invuln = true;
    T.step(3);
    const trucks = g.enemies.filter((e) => e.vehicle);
    trucks.forEach((t) => { t.hp = 20; });
    a.support.nukes = 1; g.useNuke(); g.launchNuke(); g.invuln = true;
    T.step(30.05, () => { for (const t of trucks) t.hp = Math.min(t.hp, 20); });
    out.trucks = trucks.map((t) => `${t.hp}:${t.state}`).join();
    return out;
  });
  check('D16 [31] low-HP relays (30 HP) end at exactly 1 HP and stand', nk2.relays.split(',').every((x) => x === '1:active'), nk2.relays);
  check('D17 [31] low-HP convoy trucks end at 1 HP, not destroyed', nk2.trucks.length > 0 && nk2.trucks.split(',').every((x) => x === '1:active'), nk2.trucks);
  check('D18 [33] mission lost during the countdown: the nuke stays spent (saved), never detonates afterwards', nk2.failBefore === 0 && nk2.fail.phase === 'failed' && nk2.fail.stock === 0 && nk2.fail.saved === 0 && nk2.fail.log === 'nuke-launch', JSON.stringify(nk2.fail));
  check('D19 [34] a completed mission leaves unused nukes in stock', nk2.win.phase === 'won' && nk2.win.stock === 1 && nk2.win.saved === 1, JSON.stringify(nk2.win));
  check('D20 [35] six Elites: airstrike and nuke both used in one mission, independently', nk2.both.launch && nk2.both.air && nk2.both.confirm && nk2.both.mid.air === 'used' && nk2.both.mid.nuke === 'countdown' && nk2.both.end.nuke === 'used' && nk2.both.end.stock === 0 && nk2.both.end.log === 'nuke-launch,airstrike-confirm,airstrike-impact,nuke-detonate', JSON.stringify(nk2.both));

  // reload during the countdown: abandoned mission, the nuke stays spent; a new attempt can launch another
  await fresh();
  const rl1 = await ev(() => { window.__debugUnlockAll(); T.a.support = { nukes: 2, purchased: 2, launched: 0 }; window.__persist(); T.six('iron-fist'); T.g.useNuke(); T.g.launchNuke(); T.step(3); return T.a.support.nukes; });
  await page.reload(); await page.waitForFunction(() => !!window.game);
  const rl2 = await ev(() => { const s = { ...T.a.support }; T.six('iron-fist'); const open = T.g.useNuke(); const l = T.g.launchNuke(); return { s, open, ok: l.ok, after: T.a.support.nukes }; });
  check('D21 save/reload mid-countdown: still spent (2 -> 1 after reload); the next attempt may launch another (-> 0)', rl1 === 1 && rl2.s.nukes === 1 && rl2.s.launched === 1 && rl2.open && rl2.ok && rl2.after === 0, JSON.stringify({ rl1, rl2 }));
  const fsave = await ev(() => { T.a.support = { nukes: 1, purchased: 1, launched: 0 }; T.six('iron-fist'); T.g.useNuke(); const r = T.g.support.launchNuke(T.g, T.a, () => 'error'); return { ok: r.ok, reason: r.reason, stock: T.a.support.nukes, state: T.g.support.nuke }; });
  check('D22 a launch whose save write fails is cancelled (stock untouched, no countdown)', !fsave.ok && fsave.stock === 1 && fsave.state === 'ready', JSON.stringify(fsave));
  const stockless = await ev(() => { T.a.support.nukes = 0; T.six('iron-fist'); const o = T.g.useNuke(); return { o, notice: T.g.notice?.text ?? '', state: T.g.support.nuke }; });
  check('D23 six Elites with 0 stock: NUKE refuses with "0 STOCK"', !stockless.o && /0 STOCK/.test(stockless.notice) && stockless.state === 'ready', JSON.stringify(stockless));

  // ================= E. COMPATIBILITY =================
  const fx = fs.readFileSync(path.join(__dirname, 'fixtures', 'v0.7B.1-save.json'), 'utf8');
  // v0.7B.1 itself re-sorts the named-soldier lists on load: the reference is what the old build writes for the same save
  let ref = fx;
  if (BASE) { await fresh(fx, BASE); ref = await ev(() => localStorage.getItem('minisquad.save')); }
  await fresh(fx);
  const mig = await ev(() => ({ st: window.__loadStatus.status, from: window.__loadStatus.fromVersion, notes: window.__loadStatus.notes, saved: localStorage.getItem('minisquad.save') }));
  {
    const a = JSON.parse(ref), b = JSON.parse(mig.saved);
    const sup = b.account.support; delete b.account.support;
    const same = JSON.stringify(a) === JSON.stringify(b);
    check('E1 [36] genuine v0.7B.1 save: loads with no notes, nothing changed except Nuclear Strike stock 0 added', mig.st === 'loaded' && mig.notes.length === 0 && same && sup.nukes === 0 && sup.purchased === 0 && sup.launched === 0, `${mig.st} notes ${mig.notes.length} same ${same} ${JSON.stringify(sup)}`);
    const tags = await ev(() => T.R.soldiers.map((s) => `${s.id}:${window.__elite.levelTag(s)}:${s.status}`).join() + ` | memorial ${T.a.memorial.map((m) => m.soldier.id + ':' + m.soldier.progression.elitePath).join()} | ${T.a.credits}`);
    check('E2 [36] soldiers, Elite levels / specializations, Memorial and Credits as saved', /ace:ELITE \d+:active/.test(tags) && /memorial havoc:hvy-weapons/.test(tags) && / 33100$/.test(tags), tags);
  }
  const repair = await ev(() => {
    const P = window.__parseSave, base = JSON.parse(localStorage.getItem('minisquad.save'));
    const w = (sup) => { const d = structuredClone(base); d.account.support = sup; return P(JSON.stringify(d)); };
    const r1 = w({ nukes: 'x', purchased: 4, launched: 1 }), r2 = w(7), r3 = w({ nukes: 2, purchased: 2, launched: 0 }), r4 = w({ nukes: -1 });
    return { bad: [r1.account.support.nukes, r1.status, r1.notes.length], junk: [r2.account.support.nukes, r2.account.credits, r2.status], ok: [r3.account.support.nukes, r3.status, r3.notes.length], neg: [r4.account.support.nukes, r4.account.credits] };
  });
  check('E3 save repair: unreadable stock restored from purchased - launched; junk never touches Credits / soldiers', repair.bad.join() === '3,repaired,1' && repair.junk.join() === '0,33100,repaired' && repair.ok.join() === '2,loaded,0' && repair.neg.join() === '0,33100', JSON.stringify(repair));

  const sig = async (url) => {
    await fresh(null, url);
    return ev(() => {
      const P = window.__progression, CS = window.__casualties, EL = window.__elite, out = {};
      const cp = window.__campaign;
      out.rewards = cp.CAMPAIGN.filter((m) => m.playable).map((m) => [true, false].map((fc) => JSON.stringify(P.computeMissionRewards({ missionId: m.id, runId: 'x', won: true, deployed: [{ id: 'a', status: 'Standing', downs: 0 }, { id: 'b', status: 'Downed', downs: 1 }], optional: { total: 2, completed: 1 } }, fc))).join('|')).join('#');
      out.xp = Array.from({ length: 25 }, (_, i) => P.xpForLevel(i + 1)).join() + '/' + Array.from({ length: 30 }, (_, i) => EL.eliteXpForLevel(i + 1)).join();
      out.kia = ['infantry', 'heavy', 'medic', 'sniper'].flatMap((c) => [1, 10, 25].map((l) => { try { return CS.costFor({ classId: c, progression: { level: l, tier: 'recruit', eliteLevel: 0 }, resurrections: 0 }); } catch (e) { return 'n/a'; } })).join();
      window.__debugUnlockAll();
      const g = window.game;
      const stats = (id, elite) => { const s = structuredClone(g.roster.get(id)); s.progression.xp = P.xpForLevel(25); s.progression.level = 25; for (const k of Object.keys(s.training)) s.training[k] = 7; if (elite) { s.progression.tier = 'elite'; s.progression.elitePath = elite; s.progression.specialization = elite; s.progression.eliteXp = 20000; s.progression.eliteLevel = EL.eliteLevelForXp(20000); } return JSON.stringify(window.__effectiveStats(s)); };
      out.train = [stats('ace'), stats('tank', 'hvy-juggernaut'), stats('doc', 'med-surgeon')].join('|');
      out.training = JSON.stringify([P.TRAINING, P.SQUAD_TRAINING]);
      out.enemies = JSON.stringify(['enemy', 'enemySniper', 'armored', 'tower', 'boss', 'truck', 'grenade', 'revive', 'elite'].map((k) => window.__CFG[k]));
      return out;
    });
  };
  if (BASE) {
    const a = await sig(URL), b = await sig(BASE);
    check('E4 [37] mission rewards (XP + Credits, first clear / replay, M1-M10) identical to v0.7B.1', a.rewards === b.rewards, a.rewards.slice(0, 120));
    check('E5 [37][39] XP curves (Recruit 1-25, Elite 1-30) identical to v0.7B.1', a.xp === b.xp, a.xp.slice(0, 80));
    check('E6 [38] resurrection prices identical to v0.7B.1', a.kia === b.kia, a.kia);
    check('E7 [39] trained / Elite effective stats and training tables identical to v0.7B.1', a.train === b.train && a.training === b.training, a.train.slice(0, 100));
    check('E8 enemy, boss, grenade, revive and Elite passive numbers identical to v0.7B.1 (no unrelated balance change)', a.enemies === b.enemies, '');
  } else console.log('SKIP  E4-E8 (set BASE= to a v0.7B.1 build to compare rewards, XP, KIA prices, training and enemy numbers)');

  // [38] KIA with support in play; [43] victory / failure transitions
  await fresh();
  const trans = await ev(() => {
    const out = {}, g = T.g, a = T.a;
    window.__debugUnlockAll(); T.elites(['ace', 'tank', 'doc']);
    a.credits = 0;
    // Mission 3: the airstrike finishes the last outpost defenders -> the mission goes on normally
    // KIA rules: a soldier bleeding out while an airstrike lands is still KIA and queued for a decision
    T.deploy(['ace', 'tank', 'doc'], 'field-medicine', false);
    const victim = g.soldiers[2];
    g.downSoldier(victim); victim.bleed = 1.5;
    const sq = g.soldiers[0].pos; const c = { x: sq.x + 400, y: sq.y }; T.foe(c.x, c.y);
    g.useAirstrike(); T.look(c); T.aimAt(c); g.confirmAirstrike();
    g.soldiers[0].state = 'downed'; g.soldiers[0].bleed = 1e9; g.soldiers[1].state = 'downed'; g.soldiers[1].bleed = 1e9; // nobody can revive
    T.step(2.5);
    // (the mission may already have ended here: with everyone else down it fails at once and the journal is settled)
    out.kia = { id: victim.identity.id, state: victim.state, journal: (a.activeRun?.kia ?? []).map((k) => k.id).join(), phase: g.phase };
    g.fail();
    out.fail = { phase: g.phase, results: document.querySelector('#menu')?.className, pending: (a.pendingDecision?.queue ?? []).map((q) => q.id).join() };
    // resolve the casualties the normal way (Memorial: free) before the next deployment
    for (const q of [...(a.pendingDecision?.queue ?? [])]) T.E.memorialize(T.R, a, q.id, window.__persist);
    // Mission 1 cleared by support: nuke-less roster squad -> airstrike can't exist (2 slots); use a 3-Elite dev squad on Mission 1
    // (a failed mission turns the downed soldiers into casualties too: use three soldiers who were not deployed)
    T.elites(['ranger', 'havoc', 'patch']);
    T.temp(['ranger', 'havoc', 'patch'], 'first-contact', false);
    const sq2 = g.soldiers[0].pos;
    const alive = () => g.enemies.filter((e) => e.active);
    for (const e of alive()) { e.pos = { x: sq2.x + 500 + Math.random() * 20, y: sq2.y + Math.random() * 20 }; e.guard = true; }
    const pin = T.pinAll([...alive(), ...g.soldiers]);
    const c2 = { x: sq2.x + 510, y: sq2.y + 10 };
    g.useAirstrike(); T.look(c2); T.aimAt(c2); g.confirmAirstrike();
    T.step(3, pin);
    out.win = { left: alive().length, obj: g.mission.primaries.map((o) => o.state).join(), phase: g.phase };
    return out;
  });
  check('E9 [38] KIA rules unchanged with support in play: bleed-out -> KIA (journaled), failure queues the decision', trans.kia.state === 'kia' && (trans.kia.journal.includes(trans.kia.id) || trans.kia.phase === 'failed') && trans.fail.phase === 'failed' && trans.fail.pending.split(',').includes(trans.kia.id), JSON.stringify(trans));
  check('E10 [43] an airstrike that kills the last enemies completes the objective like any kill (mission flow intact)', trans.win.left === 0 && /complete/.test(trans.win.obj), JSON.stringify(trans.win));

  // ================= F. FRAME RATE + PERFORMANCE =================
  {
    const seeded = ({ seed }) => {
      let s = seed >>> 0;
      Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      let q = [], now = 1000;
      window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
      window.__drive = (period, until) => { let n = 0; while (!until() && n < 1e6) { now += period; const cbs = q; q = []; for (const cb of cbs) cb(now); n++; } return n; };
    };
    const run = async (hz, cap) => {
      const c = await browser.newContext({ viewport: { width: 844, height: 390 } });
      await c.addInitScript(installHelpers); await c.addInitScript(seeded, { seed: 777 });
      const p = await c.newPage();
      await p.goto(URL + `?fps=${cap}`); await p.evaluate(() => localStorage.clear()); await p.goto(URL + `?fps=${cap}`); await p.waitForFunction(() => !!window.game);
      await p.evaluate(() => { window.__debugUnlockAll(); T.a.support = { nukes: 1, purchased: 1, launched: 0 }; T.six('iron-fist', false); });
      await p.evaluate(installPilot);
      const r = await p.evaluate(({ hz }) => {
        const g = window.game, P = window.__pilot, u0 = g.update.bind(g), out = [];
        let steps = 0;
        const h = () => { const r = (x) => Math.round(x * 1000); let s = JSON.stringify([r(g.time), g.support.air, g.support.nuke, r(g.support.nukeLeft), g.soldiers.map((u) => [r(u.pos.x), r(u.pos.y), r(u.hp), u.state, u.shots]), g.enemies.map((e) => [r(e.pos.x), r(e.pos.y), r(e.hp), e.state])]); let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16); };
        g.update = (dt) => {
          if (g.phase === 'playing' && !g.paused) {
            P.step(); steps++;
            if (steps === 120) { g.useAirstrike(); const e = g.enemies.find((x) => x.active && !x.structure) ?? g.soldiers[0]; g.support.aim = { x: e.pos.x, y: e.pos.y }; g.confirmAirstrike(); }
            if (steps === 180) { g.useNuke(); g.launchNuke(); }
          }
          u0(dt);
          if (steps % 300 === 0 && out.length < steps / 300) out.push(h());
        };
        g.invuln = true;
        const frames = window.__drive(1000 / hz, () => steps >= 45 * 60 || g.phase !== 'playing');
        return { hashes: out, frames, steps, log: g.support.log.map((l) => `${l.what}@${l.t.toFixed(3)}`).join(' '), phase: g.phase };
      }, { hz });
      await c.close();
      return r;
    };
    const ref = await run(60, 60), r30 = await run(60, 30), r120 = await run(120, 30);
    const same = (x) => x.hashes.length === ref.hashes.length && x.hashes.every((h, i) => h === ref.hashes[i]);
    check('F1 [41] 30 FPS and 60 FPS (60 / 120 Hz displays): identical simulation with an airstrike + nuke (hash every 5 s)', ref.hashes.length >= 8 && same(r30) && same(r120) && /nuke-detonate/.test(ref.log), `${ref.hashes.length} checkpoints; ${ref.log}`);
  }
  {
    const c = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3 });
    await c.addInitScript(installHelpers);
    const p = await c.newPage();
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.goto(URL); await p.waitForFunction(() => !!window.game);
    const cdp = await c.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // run 1 is cold (the detonation / shockwave code runs for the first time: JIT), run 2 is the steady state
    const perfRun = () => p.evaluate(() => {
      window.__debugUnlockAll(); T.a.support = { nukes: 1, purchased: 1, launched: 0 };
      T.six('iron-fist', false);
      const g = T.g; g.invuln = true;
      // extra enemies all over the map (a busy battlefield)
      for (let i = 0; i < 30; i++) T.foe(200 + (i * 97) % (g.map.w - 400), 200 + (i * 61) % (g.map.h - 400), i % 5 ? 'rifleman' : 'armored');
      const frame = () => { const t0 = performance.now(); g.update(1 / 60); g.update(1 / 60); window.__render(); return performance.now() - t0; };
      const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
      const base = Array.from({ length: 30 }, frame);
      g.useNuke(); g.launchNuke(); g.support.nukeLeft = 1 / 60 * 3;
      const n0 = g.enemies.filter((e) => e.active).length;
      const det = [frame(), frame()];
      const after = Array.from({ length: 30 }, frame);
      return { base: med(base), detonation: +Math.max(...det).toFixed(2), after: med(after), afterMax: +Math.max(...after).toFixed(2), enemies: n0, particles: g.fx.particles.length, texts: g.fx.texts.length };
    });
    // headless timings are noisy (GC): the warm detonation figure is the median of three runs
    const cold = await perfRun(), warm = [await perfRun(), await perfRun(), await perfRun()];
    warm.sort((x, y) => x.detonation - y.detonation);
    const perf = { ...warm[1], cold: cold.detonation, runs: warm.map((w) => w.detonation).join('/') };
    await c.close();
    check('F2 [42] nuke detonation frame (update + render, 4x CPU throttle, 30 extra enemies) under 33 ms warm (median of 3), one hitch at most cold; effects bounded', perf.detonation < 33 && perf.afterMax < 33 && perf.cold < 100 && perf.particles < 400, JSON.stringify(perf));
  }

  // ================= G. PHONES =================
  const devices = [
    ['iphone-se', { viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['iphone-14', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['pixel-7', { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true }],
  ];
  for (const [name, opts] of devices) {
    const c = await browser.newContext(opts);
    await c.addInitScript(installHelpers);
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.goto(URL); await p.waitForFunction(() => !!window.game);
    const box = async (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }, sel);
    const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const tapAt = async (b) => p.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
    const shot = async (f) => { if (OUT) await p.screenshot({ path: path.join(OUT, `${name}-${f}.png`) }); };
    // six Elites (both buttons) with a full HUD: 6 compact tiles
    await p.evaluate(() => { window.__debugUnlockAll(); T.a.support = { nukes: 2, purchased: 2, launched: 0 }; window.__persist(); T.six('iron-fist'); T.g.invuln = true; });
    await p.waitForTimeout(150);
    const hud = { sup: await box('#support'), air: await box('[data-s="air"]'), nuke: await box('[data-s="nuke"]'), panels: await box('#panels'), top: await box('#topbtns'), obj: await box('#objective'), timer: await box('#timer'), stage: await box('#stage') };
    const s = hud.stage;
    const quarter = hud.sup && (hud.sup.y + hud.sup.h - s.y) / s.h < 0.26;
    const noOverlap = !overlap(hud.sup, hud.panels) && !overlap(hud.sup, hud.top) && !overlap(hud.sup, hud.obj) && !overlap(hud.sup, hud.timer);
    const big = hud.air && hud.air.h >= 18 && hud.air.w >= 44;
    check(`G1 [44] ${name}: AIRSTRIKE / NUKE top-left under the timer, clear of panels, top buttons, objective (top quarter: joystick zone stays free)`, !!hud.sup && noOverlap && quarter && big, JSON.stringify({ sup: hud.sup, air: hud.air }));
    await shot('hud-six-elites');
    // airstrike by touch: AIRSTRIKE -> a tap on the LEFT half (joystick zone) aims, the squad does not move -> CONFIRM
    const anchor0 = await p.evaluate(() => ({ ...T.g.anchor }));
    await tapAt(hud.air);
    const aimPt = { x: s.x + s.w * 0.3, y: s.y + s.h * 0.55 };
    await p.touchscreen.tap(aimPt.x, aimPt.y);
    await p.waitForTimeout(100);
    const asb = await box('#asbar');
    const st1 = await p.evaluate(() => ({ air: T.g.support.air, aim: T.g.support.aim, joy: !!T.g.input.joy, hint: getComputedStyle(document.querySelector('#hint')).display }));
    await shot('airstrike-aiming');
    const asOk = asb && !overlap(asb, hud.panels) && !overlap(asb, hud.sup) && (asb.x - s.x) / s.w > 0.45;
    check(`G2 [40] ${name}: AIRSTRIKE + a tap in the joystick zone aims (no joystick); CONFIRM / CANCEL bar on the right, above the panels`, st1.air === 'targeting' && !!st1.aim && !st1.joy && asOk && st1.hint === 'none', JSON.stringify({ st1, asb, panels: hud.panels, sup: hud.sup, stage: s }));
    // drag adjusts
    const before = st1.aim;
    // a real touch drag (CDP touch events: the browser creates genuine touch pointers)
    const cdp = await c.newCDPSession(p);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', aimPt.x, aimPt.y);
    for (let i = 1; i <= 6; i++) await touch('touchMove', aimPt.x + i * 10, aimPt.y + i * 2);
    await touch('touchEnd');
    await p.waitForTimeout(50);
    const dragged = await p.evaluate(() => T.g.support.aim);
    await tapAt(await box('[data-as="go"]'));
    await p.waitForTimeout(80);
    const st2 = await p.evaluate(() => ({ air: T.g.support.air, moved: 0 }));
    await shot('airstrike-incoming');
    await p.waitForTimeout(2300);
    await shot('airstrike-impact');
    const anchor1 = await p.evaluate(() => ({ ...T.g.anchor }));
    check(`G3 [40] ${name}: drag moves the circle, CONFIRM tap launches; the squad never moved while aiming`, dragged.x > before.x + 20 && st2.air === 'incoming' && Math.hypot(anchor1.x - anchor0.x, anchor1.y - anchor0.y) < 40, JSON.stringify({ before, dragged, st2 }));
    // nuke by touch: NUKE -> confirmation (LAUNCH arms after a moment) -> LAUNCH -> countdown on the button
    await tapAt(hud.nuke);
    await p.waitForTimeout(80);
    const nb = await box('#nkbox');
    const early = await p.evaluate(() => document.querySelector('[data-nk="go"]').disabled);
    await shot('nuke-confirm');
    const nbOk = nb && !overlap(nb, hud.sup) && !overlap(nb, hud.panels) && !overlap(nb, hud.top);
    await p.waitForTimeout(600);
    const go = await box('[data-nk="go"]');
    const goRight = go && (go.x - s.x) / s.w > 0.45;
    await tapAt(go);
    await p.waitForTimeout(150);
    const st3 = await p.evaluate(() => ({ nuke: T.g.support.nuke, stock: T.a.support.nukes, label: document.querySelector('[data-s="nuke"] .sp-st').textContent }));
    await shot('nuke-countdown');
    check(`G4 [40][44] ${name}: nuke confirmation clear of the HUD, LAUNCH disarmed at first and outside the joystick zone; countdown shown`, nbOk && early && goRight && st3.nuke === 'countdown' && st3.stock === 1 && /^\d+s$/.test(st3.label), JSON.stringify({ nb, early, go, st3 }));
    await p.evaluate(() => { T.g.support.nukeLeft = 3; });
    await p.waitForTimeout(400);
    await shot('nuke-final-seconds');
    await p.waitForFunction(() => T.g.support.nuke === 'used', null, { timeout: 8000 });
    await p.waitForTimeout(250);
    await shot('nuke-detonation');
    await p.waitForTimeout(1500);
    await shot('nuke-after');
    const used = await p.evaluate(() => ({ air: document.querySelector('[data-s="air"] .sp-st').textContent, nuke: document.querySelector('[data-s="nuke"] .sp-st').textContent }));
    check(`G5 ${name}: after both strikes the buttons read USED`, used.air === 'USED' && used.nuke === 'USED', JSON.stringify(used));
    // three Elites (full panels, Mission 3): only AIRSTRIKE (no stock shown when none owned), CONFIRM bar clear of the 3 big panels
    await p.evaluate(() => { T.a.support.nukes = 0; T.g.toBarracks(); T.deploy(['ace', 'tank', 'doc'], 'field-medicine'); T.g.useAirstrike(); });
    await p.waitForTimeout(150);
    const three = { air: await box('[data-s="air"]'), nuke: await box('[data-s="nuke"]'), as: await box('#asbar'), panels: await box('#panels') };
    await shot('three-elites-aiming');
    check(`G6 [44] ${name}: three Elites: AIRSTRIKE only; CONFIRM bar clear of the three full panels`, !!three.air && !three.nuke && !!three.as && !overlap(three.as, three.panels), JSON.stringify(three));
    // Support Shop (Barracks > SUPPORT)
    await p.evaluate(() => { T.g.cancelAirstrike(); T.a.credits = 7500; T.g.toBarracks(); });
    await p.waitForTimeout(100);
    await p.tap('[data-a="tab"][data-tab="support"]');
    await p.waitForTimeout(100);
    const shopUi = await p.evaluate(() => ({ rows: document.querySelectorAll('.sp-row').length, stock: document.querySelector('.sp-row[data-item="nuke"] .sp-n')?.textContent, req: document.querySelector('.sp-row[data-item="nuke"] .sp-req')?.textContent ?? '', btn: document.querySelector('[data-a="supbuy"]')?.textContent, tabs: [...document.querySelectorAll('.m-tab')].map((t) => { const r = t.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.width > 20; }).every(Boolean) }));
    await shot('support-shop');
    await p.tap('[data-a="supbuy"]');
    await p.waitForTimeout(400);
    await p.tap('[data-a="supbuy"]');
    await p.waitForTimeout(150);
    const after = await p.evaluate(() => ({ stock: document.querySelector('.sp-row[data-item="nuke"] .sp-n')?.textContent, cr: T.a.credits, disabled: document.querySelector('[data-a="supbuy"]').disabled, notice: document.querySelector('.m-notice')?.textContent ?? '' }));
    await shot('support-shop-bought');
    check(`G7 ${name}: Support Shop tab: one product, stock, price, 6-Elite requirement shown; two taps buy two (7,500 -> 1,500), then disabled`, shopUi.rows === 2 && shopUi.stock === '0' && /6 deployed Elite/.test(shopUi.req) && shopUi.btn === '3,000 CR' && shopUi.tabs && after.stock === '2' && after.cr === 1500 && after.disabled, JSON.stringify({ shopUi, after }));
    await c.close();
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n${total - fails}/${total} passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
