// v0.8B Chapter 3B rule checks against the live build (headless Chromium, fixed 1/60 s steps):
//  A. Sixth slot: capacity table, M13 / M14 unlock chain (M15 locked), deploy 1-6 (never forced), 7 refused,
//     six HUD tiles + key 6, formation spacing, revive, six-Elite Tactical Support
//  B. Mission 13 Hold the Line: briefing, command center (HP, HUD, attacked off screen, no healing, failure,
//     optional), caches (guarded, progress, one turret each at its slot, one response each), turrets (stats, fire,
//     line of sight, no friendly fire, destructible, never soldiers), unlimited preparation, 5 s continuous command
//     zone (allies / downed don't count), gates close without trapping anyone, caches lock, four finite waves
//     (sizes, kinds, directions, warnings, staggering), allies (down / revive / no permadeath), squad wipe, victory,
//     unlocks once
//  C. Mission 14 Supply Line Sabotage: briefing, depots + HUD count, truck capture (3 s continuous, depots
//     first), gunner selection (pauses, any standing soldier or none, explicit, locked), mounted gunner (no weapon /
//     ability, in the status systems), machine gun (fixed stats, no Elite modifiers, range, cone, no friendly
//     fire), truck HP (no regen / healing), follow / wait / off-road, never runs anyone over, roadblock stop and
//     resume, side fire doesn't stop it, three ambushes once each, gunner downed (ejected, revivable, no remount),
//     truck destroyed (gunner downed not killed, ceasefire aftermath, failure, no rewards), victory, route clearance
//  D. Saves: every fixture loads with no repair notes; a v0.8A-era save with Mission 12 cleared opens Mission 13
//  E. Phones (iPhone SE / 14 / Pixel 7 landscape): briefings fit, six portraits fit with 44 CSS px areas, the
//     gunner selection fits / scrolls / confirms, screenshots of both missions
// Prints PASS/FAIL per check, exits 1 on any failure. Usage: npx vite preview --port 4173 & node tools/chapter3b.cjs
//   OUT=/dir  also saves screenshots
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get R() { return window.game.roster; },
    get C() { return window.__CFG; },
    SIX: ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'],
    step(sec, pin) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (pin) pin(); window.game.update(1 / 60); } },
    stepUntil(cond, maxSec, pin) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (pin) pin(); window.game.update(1 / 60); n++; } return n / 60; },
    calm() { const g = window.game; for (const e of g.enemies) if (!e.structure && !e.vehicle && e.kind !== 'boss') e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active); g.input.move = () => ({ x: 0, y: 0 }); },
    deploy(ids, mission, calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.calm();
      g.input.move = () => ({ x: 0, y: 0 });
      return r;
    },
    extract(maxSec = 40, calm = true) {
      const g = window.game, m = g.mission, z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      if (calm) this.calm();
      const put = () => [...g.soldiers, ...g.allies].forEach((s, i) => { if (s.active && !s.mount) { s.pos = { x: c.x - 60 + (i % 4) * 40, y: c.y - 40 + Math.floor(i / 4) * 40 }; s.vel = { x: 0, y: 0 }; } });
      put(); g.anchor = { ...c };
      return this.stepUntil(() => g.phase !== 'playing', maxSec, put);
    },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    centre(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; },
    /** Pin every soldier on foot around a point (formation off). */
    pinAt(p, spread = 30) { const g = window.game; let i = 0; for (const s of g.soldiers) if (s.active && !s.mount) { s.pos = { x: p.x + ((i % 3) - 1) * spread, y: p.y + (Math.floor(i / 3) - 0.5) * spread }; s.vel = { x: 0, y: 0 }; i++; } g.anchor = { ...p }; },
    kill(e) { window.game.damage(e, 1e6); },
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
  // a failed mission pays nothing: no win, no Credits / XP, nothing unlocked
  const noReward = (r) => !r || (!r.won && !r.credits && !r.xp && !r.unlocked);
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(104)} ${String(detail).slice(0, 300)}`); };
  const fresh = async (raw = null) => {
    await page.goto(URL); await page.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await page.goto(URL); await page.waitForTimeout(150);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. SIXTH SLOT =================
  await fresh();
  const A = await ev(() => {
    const out = {}, C = window.__campaign;
    const ids = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home', 'bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist', 'resistance-rising', 'artillery-hunt', 'hold-the-line', 'supply-line'];
    out.caps = ids.map((id) => C.capacityOf(id)).join('');
    out.chain = [C.campaignMission('artillery-hunt').unlocks.missions.join(), C.campaignMission('hold-the-line').unlocks.missions.join(), C.campaignMission('supply-line').unlocks.missions.join()].join('|');
    out.nums = [C.campaignMission('hold-the-line').number, C.campaignMission('supply-line').number].join();
    const m15 = C.campaignMission('last-stand');
    out.m15 = { exists: !!m15, playable: m15 && m15.playable, placeholder: !!C.campaignMission('mission-15'), script: !!window.game.selectMission('last-stand', true) };
    // fresh save: M13 / M14 locked
    out.lockedFresh = !window.game.selectMission('hold-the-line') && !window.game.selectMission('supply-line') && !T.a.campaign.unlockedMissions.includes('hold-the-line');
    window.__debugUnlockAll();
    const g = T.g;
    out.d6 = T.deploy(T.SIX, 'hold-the-line').ok && g.soldiers.length === 6;
    out.cap = g.capacity;
    out.d4 = T.deploy(['ace', 'ranger', 'tank', 'doc'], 'hold-the-line').ok && g.soldiers.length === 4;
    out.d1 = T.deploy(['ace'], 'supply-line').ok && g.soldiers.length === 1;
    // seven: there is no seventh roster soldier by default: recruit one
    const E = T.E, a = T.a;
    E.openOffice(T.R, a, null); const o = a.recruitment.offers[0]; a.credits += 10000; const rec = E.recruit(T.R, a, o.id, null);
    const seven = [...T.SIX.map((id) => T.R.get(id)), T.R.get(rec.soldier.id)];
    g.selectMission('hold-the-line', true);
    const r7 = g.deploy(seven, 'roster');
    out.d7 = { ok: r7.ok, reason: r7.reason };
    g.selectMission('artillery-hunt', true);
    out.m12six = g.deploy(T.SIX.map((id) => T.R.get(id)), 'roster');
    // roster selection: six slots for Mission 13, five for 12
    g.selectMission('hold-the-line', true);
    T.R.trimTo(0); for (const id of T.SIX) T.R.select(id, undefined, g.capacity);
    out.sel6 = { n: T.R.count(), block: g.deployBlock() };
    g.selectMission('artillery-hunt', true);
    out.sel6m12 = g.deployBlock();
    // six HUD tiles + key 6
    T.deploy(T.SIX, 'hold-the-line');
    out.panels = { n: document.querySelectorAll('#panels .panel').length, cls: document.getElementById('panels').className };
    const sixth = g.soldiers[5];
    g.soldiers[0].hp = Math.round(g.soldiers[0].maxHp * 0.5); // the sixth (Medic) needs someone to treat
    g.onKey('Digit6', new KeyboardEvent('keydown'));
    out.key6 = { cls: sixth.identity.classId, used: sixth.ability.cooldownLeft > 0 || sixth.ability.activeLeft > 0 || g.targeting === sixth };
    g.targeting = null;
    // formation: six soldiers settle apart, around the anchor
    T.step(4);
    let minD = 1e9, maxA = 0;
    for (let i = 0; i < 6; i++) { maxA = Math.max(maxA, T.near(g.soldiers[i].pos, g.anchor)); for (let j = i + 1; j < 6; j++) minD = Math.min(minD, T.near(g.soldiers[i].pos, g.soldiers[j].pos)); }
    out.form = { minD: Math.round(minD), maxA: Math.round(maxA) };
    // walking six: nobody left behind
    g.input.move = () => ({ x: 0, y: -1 }); T.step(4); g.input.move = () => ({ x: 0, y: 0 }); T.step(1.5);
    out.walk = Math.round(Math.max(...g.soldiers.map((s) => T.near(s.pos, g.anchor))));
    // revive with six
    g.damage(g.soldiers[5], 1e4);
    const dn = g.soldiers[5];
    out.revive = T.stepUntil(() => dn.state === 'active', 25, () => { g.soldiers[2].pos = { x: dn.pos.x + 25, y: dn.pos.y }; });
    out.reviveState = dn.state;
    return out;
  });
  check('A1 capacity: M1-2 = 2, M3-5 = 3, M6 = 4, M7-12 = 5, M13 / M14 = 6', A.caps === '22333455555566', A.caps);
  check('A2 M12 unlocks M13 (number 13), M13 unlocks M14 (14), M14 unlocks M15 (v0.8C: General\'s Last Stand, playable; the placeholder is gone)', A.chain === 'hold-the-line|supply-line|last-stand' && A.nums === '13,14' && A.m15.exists && A.m15.playable && A.m15.script && !A.m15.placeholder, JSON.stringify({ c: A.chain, n: A.nums, m15: A.m15 }));
  check('A3 a fresh save cannot select M13 / M14', A.lockedFresh);
  check('A4 deploy 6 into M13 (capacity 6); 4 and 1 also deploy (no forced sixth)', A.d6 && A.cap === 6 && A.d4 && A.d1, JSON.stringify({ d6: A.d6, cap: A.cap, d4: A.d4, d1: A.d1 }));
  check('A5 seven soldiers refused in M13; six refused in M12 (5)', !A.d7.ok && /allows 6/.test(A.d7.reason) && !A.m12six.ok, JSON.stringify([A.d7, A.m12six]));
  check('A6 Barracks selection: six slots fill for M13 and deploy; M12 asks to remove one', A.sel6.n === 6 && A.sel6.block === null && /allows 5/.test(A.sel6m12 || ''), JSON.stringify([A.sel6, A.sel6m12]));
  check('A7 six HUD tiles (two rows of three); key 6 uses the sixth soldier\'s ability', A.panels.n === 6 && /compact rows2/.test(A.panels.cls) && A.key6.used, JSON.stringify([A.panels, A.key6]));
  check('A8 six-soldier formation: >= 18 px apart, within 140 px of the anchor; nobody left behind walking', A.form.minD >= 18 && A.form.maxA <= 140 && A.walk <= 170, JSON.stringify({ ...A.form, walk: A.walk }));
  check('A9 revive works in a six-soldier squad', A.reviveState === 'active' && A.revive < 20, `${A.revive}s`);

  // six Elites: Tactical Support eligibility and a nuke in M13 (stress, step time)
  const A2 = await ev(() => {
    const g = T.g, a = T.a, P = window.__progression, E = T.E;
    const SPEC = { infantry: 'inf-trooper', heavy: 'hvy-weapons', medic: 'med-surgeon', sniper: 'snp-deadeye', commando: 'com-assault' };
    const res = [];
    for (const id of T.SIX) { const s = T.R.get(id); s.progression.xp = P.xpForLevel(25); s.progression.level = 25; a.credits += 5000; res.push(E.promote(T.R, a, id, SPEC[s.classId], null).ok); }
    T.deploy(T.SIX, 'hold-the-line', false);
    const out = { promoted: res.every(Boolean), elites: g.eliteCount, air: g.support.airEligible, nuke: g.support.nukeEligible };
    return out;
  });
  check('A10 six Elites in M13: Tactical Support eligible (airstrike + nuke, six-Elite rule kept)', A2.promoted && A2.elites === 6 && A2.air && A2.nuke, JSON.stringify(A2));

  // ================= B. MISSION 13 =================
  const B = await ev(() => {
    const out = {}, C = window.__campaign, cm = C.campaignMission('hold-the-line'), g = T.g;
    out.brief = cm.brief; out.primary = cm.primary; out.optional = cm.optional.map((o) => o.label); out.type = cm.type; out.stars = cm.stars;
    // ---- start state ----
    T.deploy(T.SIX, 'hold-the-line', false);
    const m = g.mission, cc = m.protected;
    out.start = {
      cc: cc && [cc.asset, cc.hp, cc.maxHp, cc.team, cc.live, g.soldiers.includes(cc)].join(),
      allies: g.allies.map((x) => x.name).join(), allyHp: g.allies[0].maxHp, resHp: T.C.resistance.hp,
      guards: ['cache-a', 'cache-b'].map((t) => g.enemies.filter((e) => e.tag === t).map((e) => e.kind[0]).sort().join('')).join('|'),
      phase: m.phase, enemies: g.enemies.length,
    };
    T.step(0.2);
    out.start.hud = JSON.stringify(g.objective.meter);
    // ---- unlimited preparation (idle 4 game minutes: nothing starts, no wave spawns) ----
    g.invuln = true;
    T.step(240);
    out.prepIdle = { phase: m.phase, wave: m.spawned.get('wave') || 0, cur: m.currentObjective.id };
    // ---- command zone: continuous 5 s, leaving resets; allies and downed soldiers don't count ----
    const prep = m.currentObjective, zc = T.centre(prep.zone), away = { x: 1600, y: 1900 };
    const s0 = g.soldiers[0];
    const pinOthersAway = () => { g.soldiers.forEach((s, i) => { if (i > 0 && s.state === 'active') { s.pos = { x: away.x + i * 30, y: away.y }; s.vel = { x: 0, y: 0 }; } }); };
    // allies alone in the zone
    T.step(3, () => { pinOthersAway(); s0.pos = { ...away }; for (const al of g.allies) { al.pos = { ...zc }; al.vel = { x: 0, y: 0 }; } });
    out.zoneAllies = +prep.zoneT.toFixed(2);
    // a downed soldier in the zone
    g.invuln = false; g.damage(s0, 1e4); g.invuln = true;
    T.step(2, () => { pinOthersAway(); s0.pos = { ...zc }; });
    out.zoneDowned = +prep.zoneT.toFixed(2);
    s0.state = 'active'; s0.hp = s0.maxHp;
    for (const al of g.allies) { al.pos = { ...al.post }; }
    T.step(3.5, () => { pinOthersAway(); s0.pos = { ...zc }; s0.vel = { x: 0, y: 0 }; });
    out.zone35 = { t: +prep.zoneT.toFixed(2), chip: prep.chips(g).find((c) => c.label === 'START').frac.toFixed(2), sub: g.objective.sub };
    T.step(0.5, () => { pinOthersAway(); s0.pos = { ...away }; });
    out.zoneLeft = { t: prep.zoneT, phase: m.phase };
    // ---- caches ----
    const ca = prep.caches[0], cb = prep.caches[1];
    const inA = T.centre(ca.rect);
    T.step(2, () => { T.pinAt(inA); });
    out.cacheGuarded = { prog: prep.progress.get('a') || 0, secured: prep.secured.size };
    for (const e of g.enemies.filter((e) => e.tag === 'cache-a')) T.kill(e);
    T.step(1.5, () => T.pinAt(inA));
    const p15 = prep.progress.get('a');
    T.step(2, () => T.pinAt(away));
    out.cacheKept = { p15: +p15.toFixed(2), after: +prep.progress.get('a').toFixed(2) };
    const en0 = g.enemies.length;
    T.step(1.6, () => T.pinAt(inA));
    const tA = prep.turrets[0];
    out.cacheA = { secured: [...prep.secured].join(), turrets: g.assets.filter((x) => x.asset === 'turret').length, at: tA && T.near(tA.pos, ca.slot), resp: prep.responseUnits.length, respKinds: prep.responseUnits.map((u) => u.kind[0]).join(''), newEnemies: g.enemies.length - en0, respDist: Math.round(Math.min(...prep.responseUnits.map((u) => T.near(u.pos, inA)))), tag: prep.responseUnits[0] && prep.responseUnits[0].tag };
    T.step(4, () => T.pinAt(inA));
    out.cacheAOnce = { turrets: g.assets.filter((x) => x.asset === 'turret').length, resp: prep.responseUnits.length };
    for (const e of g.enemies.filter((e) => e.tag === 'cache-a-response')) T.kill(e);
    // turret stats
    out.turret = tA && { hp: tA.maxHp, dmg: tA.stats.damage, rate: tA.stats.fireRate, range: tA.stats.range, team: tA.team, soldier: g.soldiers.includes(tA), stats: g.stats.rows(g.soldiers).length, label: tA.label };
    // turret fires at an enemy in line of sight, never at the squad
    T.pinAt(away);
    const vic = g.spawnEnemy({ x: tA.pos.x - 60, y: tA.pos.y + 300 });
    vic.guard = true; vic.aggro = 1; vic.setMaxHp(1e6);
    const sh0 = tA.shots;
    let sawT = null;
    T.step(2.5, () => { T.pinAt(away); if (tA.target) sawT = tA.target.team; });
    out.turretFire = { shots: tA.shots - sh0, vicHp: Math.round(vic.hp), target: sawT };
    if (vic.active) T.kill(vic);
    // no line of sight: an enemy behind the supply hut wall is not shot
    const hidden = g.spawnEnemy({ x: 1425, y: 1300 }); hidden.guard = true; hidden.aggro = 1;
    const losBlocked = !g.world.clear(tA.pos, hidden.pos);
    const sh1 = tA.shots; T.step(1.5, () => T.pinAt(away));
    out.turretLos = { blocked: losBlocked, shots: losBlocked ? tA.shots - sh1 : -1 };
    T.kill(hidden);
    // squad rounds pass through the turret (no friendly fire)
    const hp0 = tA.hp;
    for (let i = 0; i < 20; i++) g.projectiles.push({ pos: { x: tA.pos.x - 80, y: tA.pos.y }, vel: { x: 700, y: 0 }, team: 'squad', damage: 50, life: 0.5, trail: { x: tA.pos.x - 80, y: tA.pos.y }, owner: g.soldiers[0] });
    T.step(0.5, () => T.pinAt(away));
    out.turretFF = tA.hp === hp0;
    // cache B: four responders (R, A, R, R)
    const inB = T.centre(cb.rect);
    for (const e of g.enemies.filter((e) => e.tag === 'cache-b')) T.kill(e);
    T.step(3.4, () => T.pinAt(inB));
    out.cacheB = { secured: [...prep.secured].sort().join(), turrets: g.assets.filter((x) => x.asset === 'turret').length, at: prep.turrets[1] && T.near(prep.turrets[1].pos, cb.slot), resp: prep.responseUnits.length - 3, kinds: prep.responseUnits.slice(3).map((u) => u.kind[0]).join('') };
    for (const e of prep.responseUnits) if (e.active) T.kill(e);
    // the command center is attacked from off screen; there is no healing
    T.pinAt(away);
    const ccHp0 = cc.hp;
    // south of it, inside the wire: the turrets (north) are out of its range; the allies step away
    const allyAway = () => g.allies.forEach((al, i) => { al.pos = { x: away.x - 200 - i * 30, y: away.y }; al.vel = { x: 0, y: 0 }; });
    allyAway(); g.invuln = false; // the squad is far away and safe; the command center can take damage
    const att = g.spawnEnemy({ x: cc.pos.x, y: cc.pos.y + 350 }); att.guard = true; att.aggro = 1;
    out.ccOnScreen = g.isOnScreen(att.pos, -8);
    T.step(6, () => { T.pinAt(away); allyAway(); });
    out.ccAttacked = { lost: Math.round(ccHp0 - cc.hp), target: att.target && att.target.asset };
    T.kill(att); g.invuln = true;
    const ccHp1 = cc.hp;
    // medic Field Treatment next to it and a medkit do not repair it
    const doc = g.soldiers.find((s) => s.identity.classId === 'medic');
    T.pinAt({ x: cc.pos.x, y: cc.pos.y - 110 });
    doc.ability.cooldownLeft = 0; g.useAbility(doc);
    T.step(8, () => T.pinAt({ x: cc.pos.x, y: cc.pos.y - 110 }));
    out.prepStill = m.currentObjective === prep;
    for (const al of g.allies) { al.pos = { ...al.post }; }
    out.ccNoHeal = cc.hp === ccHp1;
    out.optStatus = m.optionals[0].status(m);
    // ---- the assault starts: gates close, nobody left inside a gate, caches lock ----
    // a soldier stands in the south gate
    const gate = m.script.gated.obstacles.filter((o) => o.kind === 'gate')[2];
    const inGate = { x: gate.x + gate.w / 2, y: gate.y + gate.h / 2 };
    const s5 = g.soldiers[5];
    T.stepUntil(() => m.currentObjective !== prep, 8, () => { g.soldiers.forEach((s, i) => { s.vel = { x: 0, y: 0 }; s.pos = i === 5 ? { ...inGate } : { x: zc.x + (i % 3) * 20 - 20, y: zc.y }; }); });
    out.begin = { cur: m.currentObjective && m.currentObjective.id, gates: m.gatesClosed, world: g.world === window.game.constructor.worldFor(m.script.gated), s5in: g.world.insideObstacle(s5.pos, s5.radius) || !g.world.isOpen(s5.pos.x, s5.pos.y), s5moved: Math.round(T.near(s5.pos, inGate)) };
    T.step(0.5);
    out.begin.s5after = g.world.insideObstacle(s5.pos, s5.radius);
    out.begin.banner = g.banners.map((b) => b.text).join(' | ');
    out.lockSecured = prep.state;
    return out;
  });
  const BR = 'The resistance command center is under threat. Secure automated defenses if you can, then hold the command center against four enemy assaults. The resistance is counting on you.';
  check('B1 M13 briefing: exact story, primaries Prepare / Protect / Survive four waves / Extract, optional >= 50% HP', B.brief.story === BR && B.brief.objectives.join('|') === 'Prepare the defenses|Protect the command center|Survive four waves|Extract' && B.primary.join('|') === 'Prepare the defenses|Protect the command center|Survive four waves|Extract' && B.optional.join() === 'Command center finishes with at least 50% HP' && B.type === 'defense', JSON.stringify(B.brief).slice(0, 200));
  check('B2 command center: 1000 HP friendly asset, not a soldier; HUD meter 1000/1000', B.start.cc === 'command,1000,1000,squad,true,false' && /"value":"1000\/1000"/.test(B.start.hud), `${B.start.cc} ${B.start.hud}`);
  check('B3 allies Mara / Elias / Tessa with resistance (M11) stats; cache A 4R+1A, cache B 5R+2A', B.start.allies === 'MARA,ELIAS,TESSA' && B.start.allyHp === B.start.resHp && B.start.guards === 'arrrr|aarrrrr', JSON.stringify(B.start));
  check('B4 preparation is unlimited: 4 game minutes idle, still preparing, no wave', B.prepIdle.phase === 'prepare' && B.prepIdle.wave === 0 && B.prepIdle.cur === 'prepare', JSON.stringify(B.prepIdle));
  check('B5 command zone: allies alone / a downed soldier do not count', B.zoneAllies === 0 && B.zoneDowned === 0, `${B.zoneAllies} ${B.zoneDowned}`);
  check('B6 command zone: 3.5 s shows progress (chip, HUD countdown); leaving resets it, nothing starts', B.zone35.t >= 3.4 && B.zone35.chip > 0.6 && /Starting the assault/.test(B.zone35.sub) && B.zoneLeft.t === 0 && B.zoneLeft.phase === 'prepare', JSON.stringify([B.zone35, B.zoneLeft]));
  check('B7 cache: no progress while guarded; progress kept when leaving after the guards fall', B.cacheGuarded.prog === 0 && B.cacheGuarded.secured === 0 && B.cacheKept.p15 > 1.4 && B.cacheKept.after === B.cacheKept.p15, JSON.stringify([B.cacheGuarded, B.cacheKept]));
  check('B8 cache A secured: exactly one turret at its slot; one response of 3 from another direction, once', B.cacheA.secured === 'a' && B.cacheA.turrets === 1 && B.cacheA.at < 1 && B.cacheA.resp === 3 && B.cacheA.respKinds === 'rrr' && B.cacheA.respDist > 700 && B.cacheA.tag === 'cache-a-response' && B.cacheAOnce.turrets === 1 && B.cacheAOnce.resp === 3, JSON.stringify([B.cacheA, B.cacheAOnce]));
  check('B9 turret: 300 HP, 9 dmg, 4 shots/s, 420 px; team squad, never a soldier or a stats row', B.turret && B.turret.hp === 300 && B.turret.dmg === 9 && B.turret.rate === 4 && B.turret.range === 420 && B.turret.team === 'squad' && !B.turret.soldier && B.turret.stats === 6, JSON.stringify(B.turret));
  check('B10 turret fires at an enemy in sight (~4/s), not through walls; squad rounds pass through it', B.turretFire.shots >= 7 && B.turretFire.target === 'enemy' && B.turretLos.blocked && B.turretLos.shots === 0 && B.turretFF, JSON.stringify([B.turretFire, B.turretLos, B.turretFF]));
  check('B11 cache B secured: second turret at its slot, one response of 4 (R, A, R, R)', B.cacheB.secured === 'a,b' && B.cacheB.turrets === 2 && B.cacheB.at < 1 && B.cacheB.resp === 4 && B.cacheB.kinds === 'rarr', JSON.stringify(B.cacheB));
  check('B12 the command center is shot by an enemy off screen; no healing (Field Treatment, time)', !B.ccOnScreen && B.ccAttacked.lost > 20 && B.ccAttacked.target === 'command' && B.ccNoHeal, JSON.stringify([B.ccOnScreen, B.ccAttacked, B.ccNoHeal]));
  check('B13 assault start: gates close (gated world), a soldier in a gate is moved out, banner', B.begin.cur === 'waves' && B.begin.gates && B.begin.world && !B.begin.s5in && !B.begin.s5after && B.begin.s5moved > 0 && /GATES CLOSED/.test(B.begin.banner), JSON.stringify(B.begin));
  check('B14 caches lock once the assault starts (preparation complete)', B.lockSecured === 'complete');

  // waves: sizes, kinds, directions, warnings, staggering, completion only after the last attacker
  const W = await ev(() => {
    const g = T.g, m = g.mission, def = m.currentObjective, W = def.waves, cc = m.protected;
    g.invuln = true;
    const out = { waves: [], banners: [], maxAlive: 0, doneEarly: false };
    const seen = new Set();
    const spawnT = new Map();
    const seenB = new Set();
    // kill each attacker 4 s after it appears (keeps the waves moving); log banners, positions, kinds, times
    T.stepUntil(() => def.state !== 'active', 400, () => {
      for (const b of g.banners) if (/INBOUND/.test(b.text) && !seenB.has(b.text)) { out.banners.push({ t: +g.time.toFixed(1), text: b.text, alive: W.totalLeft, incoming: m.incoming.length }); seenB.add(b.text); }
      W.units.forEach((us, i) => us.forEach((u) => {
        if (!seen.has(u)) { seen.add(u); spawnT.set(u, g.time); (out.waves[i] ||= []).push({ k: u.kind[0], x: Math.round(u.pos.x), y: Math.round(u.pos.y), t: +g.time.toFixed(1), siege: u.targeting !== window.game.soldiers[0].targeting && u.kind !== 'sniper' }); }
        if (u.active && g.time - spawnT.get(u) > 4) T.kill(u);
      }));
      out.maxAlive = Math.max(out.maxAlive, g.enemies.filter((e) => e.active && !e.structure).length);
      if (W.allSpawned && W.totalLeft > 0 && def.state !== 'active') out.doneEarly = true;
      g.soldiers.forEach((s) => { s.pos = { x: cc.pos.x + 200, y: cc.pos.y + 200 }; s.vel = { x: 0, y: 0 }; });
    });
    out.state = def.state; out.phase = m.phase; out.spawned = W.spawnedCount; out.planned = W.plannedCount;
    out.sizes = out.waves.map((w) => w.length).join();
    out.kinds = out.waves.map((w) => w.map((u) => u.k).sort().join('')).join('|');
    const dir = (u) => u.y < 400 ? 'N' : u.x < 400 ? 'W' : u.x > 2800 ? 'E' : '?';
    out.dirs = out.waves.map((w) => [...new Set(w.map(dir))].sort().join('')).join('|');
    out.stagger = out.waves.map((w) => new Set(w.map((u) => u.t)).size);
    out.flowExtra = m.flowExtra.length;
    out.total = [...m.spawned.entries()].reduce((a, [, n]) => a + n, 0);
    out.budget = (m.spawned.get('cache-a') || 0) + (m.spawned.get('cache-b') || 0) + 7 + W.plannedCount;
    return out;
  });
  // v0.8B.1: waves of 10 / 14 / 16 / 20 (60) replace v0.8B's 8 / 10 / 12 / 14 (tools/v081.cjs has the timing)
  check('B15 four waves of 10 / 14 / 16 / 20 (60 total, all spawned, the defense completes)', W.sizes === '10,14,16,20' && W.spawned === 60 && W.planned === 60 && W.state === 'complete' && W.phase === 'toExtraction', JSON.stringify({ s: W.sizes, sp: W.spawned, st: W.state, ph: W.phase }));
  check('B16 wave kinds: W1 8R+2A, W2 8R+6A, W3 7R+6A+3S, W4 8R+9A+3S', W.kinds === 'aarrrrrrrr|aaaaaarrrrrrrr|aaaaaarrrrrrrsss|aaaaaaaaarrrrrrrrsss', W.kinds);
  check('B17 directions: W1 north, W2 west, W3 east, W4 north + west + east', W.dirs === 'N|W|E|ENW', W.dirs);
  check('B18 each wave announced (banner + edge markers) before it arrives; arrivals staggered', W.banners.length === 4 && W.banners.every((b) => b.incoming > 0) && /WAVE 1 OF 4 INBOUND FROM THE NORTH/.test(W.banners[0].text) && /FINAL ASSAULT/.test(W.banners[3].text) && W.stagger.every((n) => n >= 2), JSON.stringify({ b: W.banners.map((b) => b.text), st: W.stagger }));
  check('B19 the defense never completes while an attacker is alive; budget = 79 max (12 + 7 + 60), never all at once', !W.doneEarly && W.budget === 79 && W.maxAlive < 79, JSON.stringify({ budget: W.budget, maxAlive: W.maxAlive, total: W.total }));

  // failures, optional, allies, victory + unlocks
  const B2 = await ev(() => {
    const out = {}, g = T.g;
    g.invuln = false;
    T.rewardOf = (r) => r && { won: r.won, credits: r.credits, xp: (r.xpLines || []).reduce((a, l) => a + (l.amount || 0), 0), unlocked: [...r.unlockedMissions, ...r.unlockedSoldiers, ...r.unlockedRecruits].length };
    const rewardOf = T.rewardOf;
    // command center destroyed -> failed
    T.deploy(T.SIX, 'hold-the-line');
    g.damage(g.mission.protected, 1e5); T.step(0.1);
    out.ccFail = { phase: g.phase, why: g.mission.failReason, reward: rewardOf(g.lastReward) };
    // optional fails the moment the command center drops below 50%
    T.deploy(T.SIX, 'hold-the-line');
    const cc = g.mission.protected;
    g.damage(cc, 501); T.step(0.1);
    out.opt499 = g.mission.optionals[0].state;
    T.deploy(T.SIX, 'hold-the-line');
    g.damage(g.mission.protected, 500); T.step(0.1);
    out.opt500 = g.mission.optionals[0].state;
    // squad wipe -> failed
    T.deploy(T.SIX, 'hold-the-line');
    for (const s of g.soldiers) g.damage(s, 1e5);
    T.step(0.1);
    out.wipe = { phase: g.phase };
    T.resolveAll = () => { const a = T.a; let d; while ((d = a.pendingDecision) && d.queue.length) { const s = T.R.get(d.queue[0].id); a.credits += window.__casualties.costFor(s); T.E.resurrect(T.R, a, s.id, window.__persist); } };
    T.resolveAll();
    // allies: downed + revived, bleed out without permadeath / Memorial
    T.deploy(T.SIX, 'hold-the-line');
    g.invuln = true;
    const [mara, elias] = g.allies;
    g.invuln = false; g.damage(mara, 1e4); g.invuln = true;
    out.allyDown = mara.state;
    T.stepUntil(() => mara.state === 'active', 25, () => { T.pinAt({ x: mara.pos.x + 30, y: mara.pos.y }); });
    out.allyRevived = mara.state;
    g.invuln = false; g.damage(elias, 1e4); g.invuln = true;
    T.stepUntil(() => elias.state === 'kia', 30, () => T.pinAt({ x: 1600, y: 2050 }));
    out.allyKia = elias.state;
    const mem0 = T.a.memorial.length, own0 = T.R.owned().length;
    // full victory: complete the chain, extract
    const m = g.mission;
    m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; m.phase = 'toExtraction';
    g.invuln = false;
    // fresh unlock record: pretend M13 was never cleared and M14 locked
    const a = T.a; a.campaign.unlockedMissions = a.campaign.unlockedMissions.filter((x) => x !== 'supply-line'); delete a.missions['hold-the-line'];
    out.end = T.extract(40);
    out.win = { phase: g.phase, stars: g.lastStars && g.lastStars.stars, xp: g.lastReward && g.lastReward.xpLines ? g.lastReward.xpLines[0].amount : (g.lastReward && g.lastReward.rows ? null : null), unlocked: g.lastReward && g.lastReward.unlockedMissions.join(), m14: a.campaign.unlockedMissions.filter((x) => x === 'supply-line').length, mem: T.a.memorial.length - mem0, own: T.R.owned().length - own0, pending: a.pendingDecision ? a.pendingDecision.queue.length : 0, rewardRows: g.lastReward ? Object.keys(g.lastReward).join() : '' };
    // replay: no second unlock
    T.deploy(T.SIX, 'hold-the-line');
    const m2 = g.mission; m2.primaries.forEach((o) => (o.state = 'complete')); m2.current = 2; m2.phase = 'toExtraction';
    T.extract(40);
    out.replay = { phase: g.phase, unlocked: g.lastReward && g.lastReward.unlockedMissions.join(), m14: a.campaign.unlockedMissions.filter((x) => x === 'supply-line').length };
    return out;
  });
  check('B20 command center destroyed: mission failed ("The command center was destroyed."), no reward', B2.ccFail.phase === 'failed' && /command center was destroyed/.test(B2.ccFail.why) && noReward(B2.ccFail.reward), JSON.stringify(B2.ccFail));
  check('B21 optional: 501 damage (< 50%) fails it at once; exactly 50% keeps it', B2.opt499 === 'failed' && B2.opt500 === 'active', `${B2.opt499} ${B2.opt500}`);
  check('B22 whole squad down: mission failed', B2.wipe.phase === 'failed', JSON.stringify(B2.wipe));
  check('B23 allies: downed, revived by a soldier; bleed out without Memorial / roster change', B2.allyDown === 'downed' && B2.allyRevived === 'active' && B2.allyKia === 'kia' && B2.win.mem === 0 && B2.win.own === 0, JSON.stringify({ d: B2.allyDown, r: B2.allyRevived, k: B2.allyKia, mem: B2.win.mem, own: B2.win.own }));
  check('B24 victory: helicopter extraction, M14 unlocked once; a replay unlocks nothing again', B2.win.phase === 'won' && B2.win.unlocked === 'supply-line' && B2.win.m14 === 1 && B2.replay.phase === 'won' && !B2.replay.unlocked && B2.replay.m14 === 1, JSON.stringify([B2.win, B2.replay]));

  // ================= C. MISSION 14 =================
  const Cc = await ev(() => {
    const out = {}, C = window.__campaign, cm = C.campaignMission('supply-line'), g = T.g;
    out.brief = cm.brief; out.primary = cm.primary; out.optional = cm.optional.map((o) => o.label); out.type = cm.type;
    T.deploy(T.SIX, 'supply-line', false);
    const m = g.mission, v = m.escort, tr = v.unit;
    T.step(0.2);
    out.start = { phase: m.phase, sub: g.objective.text + ' / ' + g.objective.sub, depots: m.primaries[0].targets.length, depotHp: m.primaries[0].targets[0].maxHp, truck: [tr.asset, tr.maxHp, tr.live, tr.targetable, v.state].join() };
    g.invuln = true;
    // capture before the depots: nothing happens
    T.step(4, () => T.pinAt({ x: tr.pos.x, y: tr.pos.y + 70 }));
    out.capEarly = { cap: m.primaries[1].state, live: tr.live, modal: g.modal };
    // a guard right next to the parked truck doesn't shoot it
    // depots: one at a time, HUD count
    const dep = m.primaries[0];
    g.damage(dep.targets[0], 1e5); T.step(0.1);
    out.sub1 = g.objective.text + ' / ' + g.objective.sub;
    g.damage(dep.targets[1], 1e5); g.damage(dep.targets[2], 1e5); T.step(0.1);
    out.depDone = { dep: dep.state, phase: m.phase };
    // capture: 3 s continuous; leaving at 2 s resets
    const cap = m.primaries[1], near = { x: tr.pos.x, y: tr.pos.y + 70 }, far = { x: tr.pos.x - 400, y: tr.pos.y + 300 };
    for (const e of g.enemies.filter((e) => !e.structure)) T.kill(e);
    T.step(2, () => T.pinAt(near));
    out.cap2 = { t: +cap.t.toFixed(2), prog: +(g.objective.progress || 0).toFixed(2) };
    T.step(0.3, () => T.pinAt(far));
    out.capReset = cap.t;
    const t0 = g.time;
    T.stepUntil(() => g.modal === 'gunner', 5, () => T.pinAt(near));
    out.capT = +(g.time - t0).toFixed(2);
    out.cap = { state: cap.state, live: tr.live, modal: g.modal };
    // gunner modal: the simulation waits
    const gt = g.time, bleed = g.soldiers[0].hp;
    T.step(3);
    out.modalPaused = g.time === gt;
    out.candidates = g.gunnerCandidates().length;
    const rows = document.querySelectorAll('#gunsel .gs-row');
    out.dom = { open: document.getElementById('gunsel').style.display !== 'none', rows: rows.length, none: rows[rows.length - 1] && rows[rows.length - 1].textContent, go: document.querySelector('#gunsel [data-g="go"]').disabled };
    window.__render();
    out.dom2 = { open: document.getElementById('gunsel').style.display !== 'none', rows: document.querySelectorAll('#gunsel .gs-row').length, go: document.querySelector('#gunsel [data-g="go"]').disabled, txt: [...document.querySelectorAll('#gunsel .gs-row')].map((r) => r.textContent.replace(/\s+/g, ' ')).slice(0, 2).join(' / ') };
    out.badPick = g.chooseGunner(999999);
    const medic = g.soldiers.find((s) => s.identity.classId === 'medic');
    out.pick = g.chooseGunner(medic.id);
    out.pickAgain = g.chooseGunner(g.soldiers[0].id);
    out.after = { modal: g.modal, gunner: v.gun.gunner === medic, mount: medic.mount === v.gun, started: m.escortStarted, inSoldiers: g.soldiers.includes(medic), rows: g.stats.rows(g.soldiers).some((r) => r.id === medic.identity.id), phase: m.phase };
    // mounted: rides on the truck seat, no weapon or ability
    out.mounted = { seat: Math.round(T.near(medic.pos, v.seat())), ability: g.useAbility(medic), notice: g.notice && g.notice.text };
    return out;
  });
  const BR14 = 'The resistance needs supplies. Destroy the enemy depots, capture their transport truck, and escort it through hostile territory. Keep the cargo moving—and keep that truck alive.';
  check('C1 M14 briefing: exact story, primaries Destroy three depots / Capture the truck / Escort it to extraction, optional >= 50% HP', Cc.brief.story === BR14 && Cc.brief.objectives.join('|') === 'Destroy three depots|Capture the truck|Escort it to extraction' && Cc.optional.join() === 'Truck finishes with at least 50% HP' && Cc.type === 'escort', JSON.stringify(Cc.brief).slice(0, 200));
  check('C2 start: 3 depots, HUD "Depots destroyed: 0/3"; parked truck 600 HP, not attackable', Cc.start.depots === 3 && /Depots destroyed: 0\/3/.test(Cc.start.sub) && Cc.start.truck === 'truck,600,false,false,parked', JSON.stringify(Cc.start));
  check('C3 the truck cannot be captured before every depot is down; HUD count updates', Cc.capEarly.cap === 'pending' && !Cc.capEarly.live && !Cc.capEarly.modal && /Depots destroyed: 1\/3/.test(Cc.sub1) && Cc.depDone.dep === 'complete' && Cc.depDone.phase === 'capture', JSON.stringify([Cc.capEarly, Cc.sub1, Cc.depDone]));
  check('C4 capture: progress shown, leaving resets, 3 s continuous captures it', Cc.cap2.t >= 1.95 && Cc.cap2.prog > 0.6 && Cc.capReset === 0 && Cc.capT >= 2.95 && Cc.capT <= 3.1 && Cc.cap.state === 'complete' && Cc.cap.live, JSON.stringify([Cc.cap2, Cc.capReset, Cc.capT, Cc.cap]));
  check('C5 gunner selection opens and the simulation waits; every standing soldier + NO GUNNER; CONFIRM needs a pick', Cc.cap.modal === 'gunner' && Cc.modalPaused && Cc.candidates === 6 && Cc.dom2.open && Cc.dom2.rows === 7 && Cc.dom2.go, JSON.stringify([Cc.dom, Cc.dom2]));
  check('C6 gunner choice: invalid refused, the Medic accepted (no class restriction), locked (no second choice)', !Cc.badPick && Cc.pick && !Cc.pickAgain && Cc.after.modal === null && Cc.after.gunner && Cc.after.mount && Cc.after.started && Cc.after.phase === 'escort', JSON.stringify(Cc.after));
  check('C7 the gunner stays a deployed soldier (status rows), rides the seat, ability refused', Cc.after.inSoldiers && Cc.after.rows && Cc.mounted.seat <= 2 && Cc.mounted.ability === false && /MOUNTED/.test(Cc.mounted.notice || ''), JSON.stringify(Cc.mounted));

  // machine gun, no personal weapon, truck HP, follow / wait / off-road / yield / roadblock / side fire
  const C2 = await ev(() => {
    const out = {}, g = T.g, m = g.mission, v = m.escort, tr = v.unit, gun = v.gun, s = gun.gunner, M = T.C.mountedGun;
    g.invuln = true;
    // hold the squad ahead on the road (so the truck waits there) and test the gun on a stationary target
    const hold = (sAlong) => () => T.pinAt(v.at(sAlong).p);
    // the truck closes up to its follow distance, then stops
    T.step(6, hold(400));
    out.follow = { s: Math.round(v.s), state: v.state, v: +v.v.toFixed(1), want: Math.round(v.squadS - T.C.escortTruck.behind) };
    // the gun: an enemy 300 px from the truck with a clear line
    const from = v.seat();
    const e1 = g.spawnEnemy(g.findOpenNear({ x: from.x, y: from.y - 300 }, 10)); e1.guard = true; e1.aggro = 1; e1.setMaxHp(1e6);
    const own0 = s.shots;
    const sh0 = gun.shots, p0 = g.projectiles.length;
    const angles = [];
    const watch = () => { for (const p of g.projectiles) if (p.mounted && !p._seen) { p._seen = 1; const a = Math.atan2(p.vel.y, p.vel.x) - gun.aim; angles.push(Math.atan2(Math.sin(a), Math.cos(a)) * 180 / Math.PI); out.dmg = p.damage; } };
    T.step(3, () => { hold(400)(); watch(); });
    out.gun = { shots: gun.shots - sh0, perSec: +((gun.shots - sh0) / 3).toFixed(1), ownShots: s.shots - own0, target: gun.target === e1 };
    // spread (standing): widest pair of angles to the target
    const offs = angles;
    out.cone = { min: +Math.min(...offs).toFixed(1), max: +Math.max(...offs).toFixed(1), n: offs.length };
    T.kill(e1);
    // range: an enemy at 470 px is not engaged
    const e2 = g.spawnEnemy(g.findOpenNear({ x: from.x + 470, y: from.y }, 4)); e2.guard = true; e2.aggro = 1;
    const sh2 = gun.shots; T.step(1.5, hold(400));
    out.range = { d: Math.round(T.near(e2.pos, v.seat())), shots: gun.shots - sh2, clear: g.world.clear(v.seat(), e2.pos) };
    T.kill(e2);
    // fixed stats regardless of the gunner: same damage for an Elite / trained soldier
    out.cfg = [M.damage, M.fireRate, M.range, M.spread].join();
    // the truck: 600 HP, no regeneration
    g.invuln = false; g.damage(tr, 100); g.invuln = true;
    const hpA = tr.hp; T.step(10, hold(400));
    out.noRegen = { a: hpA, b: tr.hp };
    // squad walks on along the road: the truck follows; squad stops: the truck stops
    let sq = 400;
    T.step(6, () => { sq += 120 / 60; hold(sq)(); });
    out.moving = { s: Math.round(v.s), state: v.state };
    T.step(6, hold(sq));
    out.stopped = { s: Math.round(v.s), v: +v.v.toFixed(1), state: v.state, gap: Math.round(v.squadS - v.s) };
    // squad leaves the road: off-road wait
    const offP = (() => { const { p, a } = v.at(sq + 100); return { x: p.x - Math.sin(a) * 420, y: p.y + Math.cos(a) * 420 }; })();
    const sOff = v.s;
    T.step(4, () => T.pinAt(g.world.isOpen(offP.x, offP.y) ? offP : g.findOpenNear(offP, 40)));
    out.offroad = { state: v.state, moved: Math.round(v.s - sOff) };
    // never runs over a soldier: one stands right in front of the bumper, the squad far ahead
    sq = v.s + 600;
    const blocker = g.soldiers.find((x) => x.active && !x.mount);
    const inFront = () => { const q = v.at(v.s + T.C.escortTruck.halfLen + 30).p; return q; };
    let fixedFront = inFront();
    const sY = v.s;
    T.step(5, () => { hold(sq)(); blocker.pos = { ...fixedFront }; blocker.vel = { x: 0, y: 0 }; });
    out.yield = { state: v.state, moved: Math.round(v.s - sY), gap: Math.round(v.project(blocker.pos).s - v.s - T.C.escortTruck.halfLen) };
    T.step(3, () => { hold(sq)(); blocker.pos = { ...fixedFront }; });
    out.yieldNudge = { nudges: v.nudges, state: v.state };
    // roadblock: an enemy on the road ahead stops it (the gun keeps firing); cleared -> it rolls on
    T.step(2, hold(sq));
    const rb = g.spawnEnemy(v.at(v.s + T.C.escortTruck.halfLen + 40).p); rb.holdPos = { ...rb.pos }; rb.setMaxHp(1e6);
    const shR = gun.shots, sR = v.s;
    T.step(4, hold(sq));
    out.roadblock = { state: v.state, moved: Math.round(v.s - sR), fired: gun.shots - shR, n: v.roadblocks, hud: g.objective.sub };
    T.kill(rb);
    const sR2 = v.s;
    T.step(3, hold(sq));
    out.resume = { state: v.state, moved: Math.round(v.s - sR2) };
    // side fire doesn't stop it: an enemy beside the road
    sq = v.s + 700;
    const { p: sp, a: sa } = v.at(v.s + 60);
    const side = g.spawnEnemy(g.findOpenNear({ x: sp.x - Math.sin(sa) * 130, y: sp.y + Math.cos(sa) * 130 }, 10)); side.guard = true; side.aggro = 1; side.setMaxHp(1e6);
    const sS = v.s;
    T.step(3, hold(sq));
    out.side = { state: v.state, moved: Math.round(v.s - sS) };
    T.kill(side);
    return out;
  });
  check('C8 the truck follows to its follow distance behind the squad and waits there', Math.abs(C2.follow.s - C2.follow.want) <= 6 && C2.follow.v < 1, JSON.stringify(C2.follow));
  check('C9 machine gun: ~10 rounds/s at 7 damage on the nearest enemy; the gunner fires no personal weapon', C2.gun.target && C2.gun.perSec >= 9 && C2.gun.perSec <= 10.5 && C2.dmg === 7 && C2.gun.ownShots === 0, JSON.stringify({ ...C2.gun, dmg: C2.dmg }));
  check('C10 machine gun cone: standing within +/-12.5 deg (25 deg full), clearly spread', C2.cone.n > 10 && C2.cone.min >= -12.6 && C2.cone.max <= 12.6 && C2.cone.max - C2.cone.min > 12, JSON.stringify(C2.cone));
  check('C11 machine gun range 450: an enemy at 470 px in plain sight is not engaged; fixed config 7 / 10 / 450 / 25', C2.range.clear && C2.range.d > 455 && C2.range.shots === 0 && C2.cfg === '7,10,450,25', JSON.stringify([C2.range, C2.cfg]));
  check('C12 truck: no regeneration (500/600 stays 500)', C2.noRegen.a === 500 && C2.noRegen.b === 500, JSON.stringify(C2.noRegen));
  check('C13 squad advances: truck moves; squad stops: truck stops behind it', C2.moving.state === 'moving' && C2.stopped.v < 1 && Math.abs(C2.stopped.gap - 200) <= 8, JSON.stringify([C2.moving, C2.stopped]));
  check('C14 squad leaves the road: the truck waits (off-road)', C2.offroad.state === 'offroad' && C2.offroad.moved <= 2, JSON.stringify(C2.offroad));
  check('C15 a soldier standing in its path: the truck yields (never runs anyone over), then they step aside', C2.yield.state === 'yield' && C2.yield.gap >= 0 && C2.yieldNudge.nudges >= 1, JSON.stringify([C2.yield, C2.yieldNudge]));
  check('C16 roadblock: an enemy on the road stops the truck (HUD says so), the gun keeps firing; cleared -> it rolls on', C2.roadblock.state === 'roadblock' && C2.roadblock.moved <= 2 && C2.roadblock.fired > 10 && C2.roadblock.n >= 1 && /ROADBLOCK/.test(C2.roadblock.hud) && C2.resume.state === 'moving' && C2.resume.moved > 20, JSON.stringify([C2.roadblock, C2.resume]));
  check('C17 an enemy beside the road (side fire) does not stop the truck', C2.side.state === 'moving' && C2.side.moved > 50, JSON.stringify(C2.side));

  // ambushes (progress-keyed, once each), gunner downed, wreck aftermath, victory
  const C3 = await ev(() => {
    const out = {}, g = T.g;
    // a fresh escort, then drive the truck's progress past each trigger
    T.deploy(T.SIX, 'supply-line');
    const m = g.mission, v = m.escort;
    m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; m.escort.capture();
    m.primaries[2].activate(m, g); m.phase = 'escort';
    g.modal = 'gunner'; g.chooseGunner(g.soldiers.find((s) => s.identity.classId === 'heavy').id);
    g.invuln = true;
    const esc = m.primaries[2], A = esc.ambushes;
    const fired = [];
    const runTo = (sTarget) => {
      // the squad walks just ahead of the truck: truck progress follows
      T.stepUntil(() => v.s >= sTarget, 120, () => { const ahead = v.s + 320, q = v.at(Math.min(v.total, ahead)); T.pinAt(ahead > v.total - 80 ? g.findOpenNear({ x: q.p.x - Math.sin(q.a) * 150, y: q.p.y + Math.cos(q.a) * 150 }, 40) : q.p); for (const e of g.enemies) if (e.active && !e.structure && e.hp > 0 && e._seen && g.time - e._seen > 3) T.kill(e); for (const e of g.enemies) if (!e._seen) e._seen = g.time; });
    };
    const info = [];
    for (let i = 0; i < A.defs.length; i++) {
      const at = A.defs[i].at;
      runTo(at - 5);
      const n0 = A.units[i].length, f0 = A.fired.length;
      runTo(at + 2);
      const warnT = g.time; const banner = g.banners.map((b) => b.text).join(' | ');
      const firedNow = A.fired.length - f0;
      T.stepUntil(() => A.units[i].length > 0, 10, () => T.pinAt(v.at(Math.min(v.total, v.s + 320)).p));
      const us = A.units[i];
      const friends = g.soldiers.filter((s) => s.active && !s.mount);
      info.push({ at, fired: firedNow, delay: +(g.time - warnT).toFixed(1), n: us.length, kinds: us.map((u) => u.kind[0]).sort().join(''), banner, hold: us.filter((u) => u.holdPos).length, hunt: us.filter((u) => u.targeting && u.targeting.select && u.targeting !== window.game.soldiers[0].targeting && u.kind !== 'sniper').length, open: us.every((u) => g.world.isOpen(u.pos.x, u.pos.y)), minD: Math.round(Math.min(...us.map((u) => Math.min(...friends.map((f) => T.near(f.pos, u.pos)), T.near(v.unit.pos, u.pos))))), before: n0 });
    }
    out.amb = info;
    runTo(v.total);
    out.once = { fired: A.fired.length, spawned: A.spawnedCount, planned: A.plannedCount };
    out.arrived = { state: v.state, esc: esc.state, phase: m.phase };
    // gunner still mounted at arrival; extraction completes
    T.calm();
    out.end = T.extract(40);
    out.win = { phase: g.phase, gunner: g.soldiers.find((s) => s.identity.classId === 'heavy').state, opt: m.optionals[0].state };
    return out;
  });
  // v0.8B.1: two more ambushes follow on the extended road (their staggered groups: tools/v081.cjs E2-E5)
  check('C18 ambush 1 / 2 / 3: once each at the truck\'s progress, 6 / 9 / 12 enemies, warning then a short delay', C3.amb.length === 5 && C3.amb.slice(0, 3).map((a) => a.n).join() === '6,9,12' && C3.amb.every((a) => a.fired === 1 && a.before === 0 && a.delay >= 2 && /AMBUSH|ROADBLOCK|GAUNTLET/.test(a.banner)), JSON.stringify(C3.amb.map((a) => ({ n: a.n, f: a.fired, d: a.delay, b: a.banner.slice(0, 40) }))));
  check('C19 ambush kinds: A1 riflemen, A2 riflemen + armored (a roadblock that holds), A3 mixed with a sniper', C3.amb[0].kinds === 'rrrrrr' && C3.amb[1].kinds === 'aaarrrrrr' && C3.amb[1].hold >= 6 && /s/.test(C3.amb[2].kinds) && /a/.test(C3.amb[2].kinds), C3.amb.map((a) => `${a.kinds}/${a.hold}`).join(' '));
  check('C20 ambush spawns on open ground, never on top of the squad or the truck; some prefer the truck', C3.amb.every((a) => a.open && a.minD >= 200) && C3.amb[0].hunt >= 3, C3.amb.map((a) => `${a.open}/${a.minD}/${a.hunt}`).join(' '));
  check('C21 no ambush repeats (54 total in v0.8B.1); the truck arriving completes the escort; extraction wins with the gunner standing', C3.once.fired === 5 && C3.once.spawned === 54 && C3.once.planned === 54 && C3.arrived.state === 'arrived' && C3.arrived.esc === 'complete' && C3.win.phase === 'won' && C3.win.gunner === 'active' && C3.win.opt === 'complete', JSON.stringify([C3.once, C3.arrived, C3.win]));

  const C4 = await ev(() => {
    const out = {}, g = T.g;
    const escort = (gunnerCls = 'heavy') => {
      g.invuln = false;
      T.deploy(T.SIX, 'supply-line');
      const m = g.mission;
      m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; m.escort.capture();
      m.primaries[2].activate(m, g); m.phase = 'escort';
      g.modal = 'gunner'; g.chooseGunner(gunnerCls ? g.soldiers.find((s) => s.identity.classId === gunnerCls).id : null);
      return { m, v: m.escort, gun: m.escort.gun };
    };
    // ---- gunner downed: the gun stops for good, ejected beside the truck, normal revive, no remount ----
    {
      const { m, v, gun } = escort();
      const s = gun.gunner;
      T.step(3, () => T.pinAt(v.at(v.s + 320).p));
      g.damage(s, 1e5);
      const box = (() => { const u = v.unit, c = Math.cos(u.aim), sn = Math.sin(u.aim), dx = s.pos.x - u.pos.x, dy = s.pos.y - u.pos.y; return { lx: Math.abs(dx * c + dy * sn), ly: Math.abs(-dx * sn + dy * c) }; })();
      out.gd = { state: s.state, mount: s.mount ? 'mounted' : null, lost: gun.lost, gunner: gun.gunner ? gun.gunner.name : null, open: g.world.isOpen(s.pos.x, s.pos.y) && !g.world.insideObstacle(s.pos, s.radius), outside: box.lx > T.C.escortTruck.halfLen || box.ly > T.C.escortTruck.halfWidth, banner: g.banners.map((b) => b.text).join(' | ') };
      const e = g.spawnEnemy(g.findOpenNear({ x: v.seat().x, y: v.seat().y - 250 }, 10)); e.guard = true; e.aggro = 1; e.setMaxHp(1e6);
      const sh = gun.shots; g.invuln = true;
      T.step(2, () => T.pinAt({ x: s.pos.x + 30, y: s.pos.y + 10 }));
      out.gd.shotsAfter = gun.shots - sh;
      T.stepUntil(() => s.state === 'active', 25, () => T.pinAt({ x: s.pos.x + 30, y: s.pos.y + 10 }));
      out.gd.revived = s.state;
      out.gd.remount = g.chooseGunner(s.id);
      g.modal = 'gunner'; out.gd.remount2 = g.chooseGunner(s.id); g.modal = null;
      T.kill(e);
      const p0 = { ...s.pos };
      g.input.move = () => ({ x: 1, y: 0 }); T.step(2); g.input.move = () => ({ x: 0, y: 0 });
      out.gd.walks = Math.round(T.near(p0, s.pos)); out.gd.mountAfter = s.mount ? 'mounted' : null;
      g.invuln = false;
    }
    // ---- truck destroyed with the gunner on it: thrown clear DOWNED, ceasefire aftermath, a revive, then failure ----
    {
      const { m, v, gun } = escort();
      const s = gun.gunner;
      T.step(2, () => T.pinAt(v.at(v.s + 320).p));
      const shooter = g.spawnEnemy(g.findOpenNear({ x: v.unit.pos.x, y: v.unit.pos.y - 260 }, 10)); shooter.guard = true; shooter.aggro = 1; shooter.setMaxHp(1e6);
      const xp0 = s.identity.progression.xp, cr0 = T.a.credits;
      g.damage(v.unit, 1e5);
      out.wr = { truck: v.unit.state, vstate: v.state, gunner: s.state, mount: s.mount ? 'mounted' : null, after: !!m.aftermath, phase: g.phase, wreck: m.wrecks.some((w) => w.kind === 'truck') };
      const es = shooter.shots, sq = g.soldiers.reduce((a, x) => a + x.shots, 0);
      T.step(3, () => T.pinAt({ x: s.pos.x + 200, y: s.pos.y + 150 }));
      out.wr.ceasefire = { enemyShots: shooter.shots - es, squadShots: g.soldiers.reduce((a, x) => a + x.shots, 0) - sq, ability: g.useAbility(g.soldiers.find((x) => x.active && x !== s)) };
      g.damage(v.unit, 100);
      out.wr.noMore = v.unit.hp <= 0 && v.unit.state === 'dead';
      // revive the gunner, then the aftermath ends -> failure
      T.stepUntil(() => g.phase !== 'playing', 40, () => { if (s.state === 'downed') T.pinAt({ x: s.pos.x + 25, y: s.pos.y }); });
      out.wr.end = { phase: g.phase, why: m.failReason, gunner: s.state, t: +m.aftermath.t.toFixed(1), reward: T.rewardOf(g.lastReward), xp: s.identity.progression.xp === xp0 };
      const rows = g.stats.rows(g.soldiers);
      out.wr.kia = rows.filter((r) => r.status === 'kia').length;
    }
    // ---- truck destroyed and nobody revives the gunner: aftermath times out, established rule (still downed -> KIA) ----
    {
      const { m, v, gun } = escort();
      const s = gun.gunner;
      T.step(1, () => T.pinAt(v.at(v.s + 320).p));
      g.damage(v.unit, 1e5);
      const far = { x: v.unit.pos.x - 500, y: v.unit.pos.y + 500 };
      const t = T.stepUntil(() => g.phase !== 'playing', 60, () => T.pinAt(g.world.isOpen(far.x, far.y) ? far : g.findOpenNear(far, 50)));
      out.wr2 = { phase: g.phase, t: +t.toFixed(1), gunner: s.state, cause: s.kiaCause };
      // the casualty is resolved by the normal decision flow (no special exception)
      out.wr2.pending = T.a.pendingDecision ? T.a.pendingDecision.queue.map((q) => q.id).join() : '';
      T.resolveAll && T.resolveAll();
      const a = T.a; let d;
      while ((d = a.pendingDecision) && d.queue.length) { const x = T.R.get(d.queue[0].id); a.credits += window.__casualties.costFor(x); T.E.resurrect(T.R, a, x.id, window.__persist); }
    }
    // ---- No Gunner: the gun stays silent, the escort still works ----
    {
      const { m, v, gun } = escort(null);
      T.step(4, () => T.pinAt(v.at(v.s + 320).p));
      out.none = { gunner: gun.gunner, assigned: gun.assigned, shots: gun.shots, moving: v.s > 20, mounted: g.soldiers.filter((x) => x.mount).length };
    }
    // ---- last soldier standing is the gunner: he jumps down (somebody must be able to revive) ----
    {
      const { m, v, gun } = escort();
      const s = gun.gunner;
      for (const x of g.soldiers) if (x !== s) g.damage(x, 1e5);
      T.step(0.1);
      out.last = { mount: !!s.mount, lost: gun.lost, state: s.state, phase: g.phase };
    }
    return out;
  });
  check('C22 gunner downed: thrown clear beside the truck (open ground), the gun goes silent at once', C4.gd.state === 'downed' && C4.gd.mount === null && C4.gd.lost && C4.gd.gunner === null && C4.gd.open && C4.gd.outside && C4.gd.shotsAfter === 0 && /GUN IS SILENT/.test(C4.gd.banner), JSON.stringify(C4.gd));
  check('C23 downed gunner: normal revive, back on foot in the formation, never remounts', C4.gd.revived === 'active' && C4.gd.remount === false && C4.gd.remount2 === false && C4.gd.walks > 100 && C4.gd.mountAfter === null, JSON.stringify(C4.gd));
  check('C24 truck destroyed: wreck, the gunner is thrown clear DOWNED (not killed), aftermath starts', C4.wr.truck === 'dead' && C4.wr.vstate === 'wrecked' && C4.wr.gunner === 'downed' && C4.wr.mount === null && C4.wr.after && C4.wr.phase === 'playing' && C4.wr.wreck, JSON.stringify(C4.wr));
  check('C25 aftermath: both sides hold fire, abilities refused, the wreck takes no more damage', C4.wr.ceasefire.enemyShots === 0 && C4.wr.ceasefire.squadShots === 0 && C4.wr.ceasefire.ability === false && C4.wr.noMore, JSON.stringify(C4.wr.ceasefire));
  check('C26 revived during the aftermath: mission fails ("The supply truck was destroyed."), the gunner survives, no reward', C4.wr.end.phase === 'failed' && /supply truck was destroyed/.test(C4.wr.end.why) && C4.wr.end.gunner === 'active' && noReward(C4.wr.end.reward) && C4.wr.end.xp && C4.wr.kia === 0, JSON.stringify(C4.wr.end));
  check('C27 nobody revives: the aftermath ends (wreckTime), the established rule applies (still downed -> KIA "failed", decision flow)', C4.wr2.phase === 'failed' && C4.wr2.t >= 14 && C4.wr2.t <= 16 && C4.wr2.gunner === 'kia' && C4.wr2.cause === 'failed' && C4.wr2.pending.length > 0, JSON.stringify(C4.wr2));
  check('C28 No Gunner: the gun never fires, nobody mounted, the truck still follows', C4.none.gunner === null && C4.none.assigned && C4.none.shots === 0 && C4.none.mounted === 0 && C4.none.moving, JSON.stringify(C4.none));
  check('C29 the gunner is the last soldier standing: he jumps down (gun lost) so the squad isn\'t stuck', C4.last.mount === false && C4.last.lost && C4.last.state === 'active' && C4.last.phase === 'playing', JSON.stringify(C4.last));

  // route clearance + frame-rate consistency of the escort
  const C5 = await ev(() => {
    const g = T.g, out = {};
    T.deploy(T.SIX, 'supply-line');
    const v = g.mission.escort, w = g.world, H = T.C.escortTruck;
    let worst = 1e9, blockedAt = null;
    for (let s = 0; s <= v.total; s += 8) {
      const { p, a } = v.at(s);
      for (const [lx, ly] of [[H.halfLen, H.halfWidth], [H.halfLen, -H.halfWidth], [-H.halfLen, H.halfWidth], [-H.halfLen, -H.halfWidth], [0, 0], [H.halfLen, 0], [-H.halfLen, 0]]) {
        const q = { x: p.x + lx * Math.cos(a) - ly * Math.sin(a), y: p.y + lx * Math.sin(a) + ly * Math.cos(a) };
        if (!w.isOpen(q.x, q.y) || w.insideObstacle(q, 6)) { blockedAt = blockedAt ?? Math.round(s); }
      }
      for (const o of g.map.obstacles) { const dx = Math.max(o.x - p.x, 0, p.x - (o.x + o.w)), dy = Math.max(o.y - p.y, 0, p.y - (o.y + o.h)); worst = Math.min(worst, Math.hypot(dx, dy)); }
    }
    out.route = { blockedAt, clearance: Math.round(worst), end: g.map.id };
    const z = g.mission.extraction.zone, end = v.at(v.total).p;
    out.endInZone = end.x > z.x && end.x < z.x + z.w && end.y > z.y && end.y < z.y + z.h;
    // the same escort stepped at 60 and at 30 updates per second of game time (dt 1/60 vs 2 x 1/60 per frame):
    // the simulation is fixed-step, so the truck's progress must match exactly
    const runEscort = () => {
      T.deploy(T.SIX, 'supply-line');
      const m = g.mission, vv = m.escort;
      m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; vv.capture(); m.primaries[2].activate(m, g); m.phase = 'escort';
      g.modal = 'gunner'; g.chooseGunner(null); g.invuln = true;
      const trace = [];
      for (let i = 0; i < 60 * 20; i++) { T.pinAt(vv.at(Math.min(vv.total, 200 + i * 1.5)).p); g.update(1 / 60); if (i % 60 === 0) trace.push(Math.round(vv.s * 100)); }
      return trace.join();
    };
    out.parity = runEscort() === runEscort();
    return out;
  });
  check('C30 truck route: the truck body clears every obstacle along the whole road; it ends inside the extraction zone', C5.route.blockedAt === null && C5.route.clearance >= H_MIN() && C5.endInZone, JSON.stringify(C5.route));
  function H_MIN() { return 23; }
  check('C31 escort progress is deterministic step for step (fixed-step simulation)', C5.parity);

  // ================= D. SAVES =================
  const fx = fs.readdirSync(path.join(__dirname, 'fixtures')).filter((f) => f.endsWith('.json'));
  for (const f of fx) {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
    await fresh(raw);
    const r = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes, unl: T.a.campaign.unlockedMissions.filter((x) => x === 'hold-the-line' || x === 'supply-line').join(), n: T.R.owned().length }));
    check(`D1 ${f}: loads without repair notes; no Chapter 3B mission unlocked without its clear`, (r.st === 'loaded' || r.st === 'migrated') && r.notes.length === 0 && r.unl === '', JSON.stringify(r));
  }
  {
    // a v0.8A-era save that cleared Mission 12 (v9, made with this build's own writer): Mission 13 opens, no notes
    await fresh();
    const raw = await ev(() => { window.__debugUnlockAll(); window.__persist(); const s = JSON.parse(localStorage.getItem(window.__SAVE_KEY)); s.account.campaign.unlockedMissions = s.account.campaign.unlockedMissions.filter((x) => x !== 'hold-the-line' && x !== 'supply-line'); delete s.account.missions['hold-the-line']; s.account.missions['artillery-hunt'] = { completions: 1, firstClearRun: 'm12-run', bestStars: 2 }; delete s.account.missions['supply-line']; if (s.account.campaign.selectedMission === 'hold-the-line' || s.account.campaign.selectedMission === 'supply-line') s.account.campaign.selectedMission = 'artillery-hunt'; return JSON.stringify(s); });
    await fresh(raw);
    const r = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes, m13: T.a.campaign.unlockedMissions.includes('hold-the-line'), m14: T.a.campaign.unlockedMissions.includes('supply-line'), v: JSON.parse(localStorage.getItem(window.__SAVE_KEY)).version }));
    check('D2 save with Mission 12 cleared (v0.8A state): Mission 13 unlocked on load, Mission 14 still locked, no notes, save v9', r.m13 && !r.m14 && r.notes.length === 0 && r.v === 9, JSON.stringify(r));
  }

  // ================= E. PHONES =================
  const DEVICES = [{ name: 'iphoneSE', land: [667, 375], dpr: 2 }, { name: 'iphone14', land: [844, 390], dpr: 3 }, { name: 'pixel7', land: [915, 412], dpr: 2.625 }];
  for (const dev of DEVICES) {
    const c2 = await browser.newContext({ viewport: { width: dev.land[0], height: dev.land[1] }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    await c2.addInitScript(installHelpers);
    const p = await c2.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(URL); await p.evaluate(() => { localStorage.clear(); }); await p.goto(URL); await p.waitForTimeout(200);
    await p.evaluate(() => { window.__debugUnlockAll(); window.__persist(); });
    await p.reload(); await p.waitForTimeout(200);
    for (const mid of ['hold-the-line', 'supply-line']) {
      await p.tap('[data-a="cchap"][data-ch="3"]'); await p.waitForTimeout(60);
      await p.tap(`[data-a="csel"][data-id="${mid}"]`); await p.waitForTimeout(60);
      await p.tap('.c-btns [data-a="deploy"]'); await p.waitForTimeout(150);
      const L = await p.evaluate(() => {
        const vw = window.innerWidth, vh = window.innerHeight, el = document.querySelector('.brief');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const btns = [...el.querySelectorAll('[data-a="brief-deploy"], [data-a="brief-back"]')].map((b) => { const q = b.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { h: Math.round(q.height), inside: q.top >= -0.5 && q.bottom <= vh + 0.5 && q.left >= -0.5 && q.right <= vw + 0.5, aligned: !!hit && (hit === b || b.contains(hit)) }; });
        const clipped = [...el.querySelectorAll('*')].filter((e) => e.offsetParent && e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY === 'hidden').length;
        const texts = [...el.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
        return { inside: r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5, scroll: el.scrollHeight > el.clientHeight + 1, btns, clipped, minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))), text: el.textContent.replace(/\s+/g, ' ').slice(0, 400) };
      });
      if (OUT) await p.screenshot({ path: `${OUT}/c3b-${dev.name}-${mid}-briefing.png` });
      check(`E ${dev.name}: ${mid} briefing fits (no scroll / clipping), DEPLOY / BACK >= 44 CSS px, objectives listed`, L && L.inside && !L.scroll && L.clipped === 0 && L.btns.length === 2 && L.btns.every((b) => b.inside && b.aligned && b.h >= 43.5) && L.minFont >= 11 && /Extract|Escort it to extraction/.test(L.text), JSON.stringify(L && { ...L, text: L.text.slice(0, 80) }));
      await p.tap('[data-a="brief-back"]'); await p.waitForTimeout(80);
    }
    // six portraits in Mission 13
    await p.evaluate(() => { T.deploy(T.SIX, 'hold-the-line', false); });
    await p.waitForTimeout(300);
    const P6 = await p.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const btns = [...document.querySelectorAll('#panels .ability')];
      const rs = btns.map((b) => b.getBoundingClientRect());
      const inside = rs.every((r) => r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh);
      const areas = btns.map((b, i) => { const r = rs[i], cx = r.left + r.width / 2, cy = r.top + r.height / 2; return [[-21.5, 0], [21.5, 0], [0, -21.5], [0, 21.5]].every(([dx, dy]) => { const h = document.elementFromPoint(cx + dx, cy + dy); return !!h && h.closest('.ability') === b; }); });
      // the joystick half stays free: no tile in the left 45% of the screen
      const leftFree = rs.every((r) => r.left > vw * 0.45);
      const meter = document.querySelector('.obj-meter'), mr = meter.getBoundingClientRect();
      return { n: btns.length, inside, areas: areas.filter(Boolean).length, leftFree, w: Math.round(rs[0].width), meter: meter.textContent, meterIn: mr.right <= vw && mr.left >= 0 };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/c3b-${dev.name}-m13-hud.png` });
    check(`E ${dev.name}: six portraits on screen, each with a 44 CSS px touch area, clear of the joystick half; COMMAND meter shows HP`, P6.n === 6 && P6.inside && P6.areas === 6 && P6.leftFree && /1000\/1000/.test(P6.meter) && P6.meterIn, JSON.stringify(P6));
    // a tap on the sixth portrait uses the sixth soldier's ability
    await p.evaluate(() => { const s0 = window.game.soldiers[0]; s0.hp = Math.round(s0.maxHp * 0.5); }); // the Medic needs someone to treat
    await p.tap('#panels .panel:nth-child(6) .ability'); await p.waitForTimeout(80);
    const tap6 = await p.evaluate(() => { const s = window.game.soldiers[5]; return { cls: s.identity.classId, used: s.ability.cooldownLeft > 0 || s.ability.activeLeft > 0 || window.game.targeting === s }; });
    check(`E ${dev.name}: tapping the sixth portrait uses the sixth soldier's ability`, tap6.used, JSON.stringify(tap6));
    await p.evaluate(() => { window.game.targeting = null; });
    // mid-assault screenshot (turrets, walls, gates, a wave)
    if (OUT) {
      await p.evaluate(() => { const g = T.g, m = g.mission, prep = m.currentObjective; g.invuln = true; for (const e of g.enemies.filter((e) => e.tag === 'cache-a' || e.tag === 'cache-b')) T.kill(e); for (const c of prep.caches) { T.step(3.2, () => T.pinAt(T.centre(c.rect))); } for (const e of g.enemies) if (e.active) T.kill(e); T.stepUntil(() => m.currentObjective !== prep, 8, () => T.pinAt(T.centre(prep.zone))); T.stepUntil(() => g.enemies.filter((e) => e.active).length >= 6, 30, () => T.pinAt({ x: 1600, y: 760 })); T.step(5, () => T.pinAt({ x: 1600, y: 760 })); g.paused = true; });
      await p.waitForTimeout(200);
      await p.evaluate(() => { window.game.paused = false; window.__render(); window.game.paused = true; });
      await p.screenshot({ path: `${OUT}/c3b-${dev.name}-m13-wave.png` });
      await p.evaluate(() => { window.game.paused = false; });
    }
    // Mission 14: the gunner selection
    await p.evaluate(() => {
      const g = T.g; T.deploy(T.SIX, 'supply-line'); const m = g.mission; g.invuln = true;
      for (const t of m.primaries[0].targets) g.damage(t, 1e6);
      T.step(0.2); const tr = m.escort.unit;
      T.stepUntil(() => g.modal === 'gunner', 5, () => T.pinAt({ x: tr.pos.x, y: tr.pos.y + 70 }));
    });
    await p.waitForTimeout(250);
    const G = await p.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight, el = document.getElementById('gunsel'), r = el.getBoundingClientRect();
      const list = el.querySelector('.gs-list'), rows = [...el.querySelectorAll('.gs-row')], go = el.querySelector('[data-g="go"]'), gr = go.getBoundingClientRect();
      return { open: el.style.display !== 'none', inside: r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5, rows: rows.length, rowH: Math.round(rows[0].getBoundingClientRect().height), scrolls: list.scrollHeight > list.clientHeight + 1, goH: Math.round(gr.height), goIn: gr.bottom <= vh + 0.5 && gr.top >= 0, disabled: go.disabled, time: window.game.time };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/c3b-${dev.name}-gunner-select.png` });
    // scroll to NO GUNNER, pick the Medic row (scroll back), confirm
    await p.evaluate(() => { const l = document.querySelector('#gunsel .gs-list'); l.scrollTop = l.scrollHeight; });
    await p.waitForTimeout(60);
    const noneVisible = await p.evaluate(() => { const r = document.querySelector('#gunsel .gs-row.none').getBoundingClientRect(), l = document.querySelector('#gunsel .gs-list').getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; });
    await p.evaluate(() => { const l = document.querySelector('#gunsel .gs-list'); l.scrollTop = 0; });
    const medId = await p.evaluate(() => window.game.soldiers.find((s) => s.identity.classId === 'medic').id);
    await p.evaluate((id) => document.querySelector(`#gunsel [data-u="${id}"]`).scrollIntoView({ block: 'nearest' }), medId);
    await p.tap(`#gunsel [data-u="${medId}"]`); await p.waitForTimeout(60);
    const sel = await p.evaluate(() => ({ sel: document.querySelectorAll('#gunsel .gs-row.sel').length, disabled: document.querySelector('#gunsel [data-g="go"]').disabled, modal: window.game.modal }));
    await p.tap('#gunsel [data-g="go"]'); await p.waitForTimeout(120);
    const done = await p.evaluate(() => ({ modal: window.game.modal, gunner: window.game.mission.escort.gun.gunner && window.game.mission.escort.gun.gunner.identity.classId, hidden: document.getElementById('gunsel').style.display === 'none' }));
    check(`E ${dev.name}: gunner selection fits, rows >= 44 CSS px, list scrolls to NO GUNNER, CONFIRM >= 44 px and needs a pick`, G.open && G.inside && G.rows === 7 && G.rowH >= 43.5 && G.goH >= 43.5 && G.goIn && G.disabled && noneVisible && sel.sel === 1 && !sel.disabled && sel.modal === 'gunner', JSON.stringify({ G, noneVisible, sel }));
    check(`E ${dev.name}: a row tap selects, CONFIRM commits the Medic and closes the prompt`, done.modal === null && done.gunner === 'medic' && done.hidden, JSON.stringify(done));
    if (OUT) {
      await p.evaluate(() => { const g = T.g, v = g.mission.escort; T.step(6, () => T.pinAt(v.at(v.s + 320).p)); const e = g.spawnEnemy(g.findOpenNear({ x: v.unit.pos.x + 150, y: v.unit.pos.y - 260 }, 20)); e.setMaxHp(1e6); T.step(1.2, () => T.pinAt(v.at(v.s + 320).p)); g.damage(v.unit, 180); });
      await p.waitForTimeout(250);
      await p.screenshot({ path: `${OUT}/c3b-${dev.name}-m14-escort.png` });
    }
    check(`E ${dev.name}: no page errors`, errs.length === 0, errs.join(' | '));
    await c2.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(fails ? `\n${fails}/${total} FAILED` : `\nall ${total} Chapter 3B checks passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
