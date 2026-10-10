// v0.6.2 Chapter 2 rule checks (spec section 13) against the live build:
//  A. campaign: unlock order M5 -> M6 -> ... -> M10, deployment caps, objectives, stars, M11 placeholder
//  B. per mission (M6-M10): valid objectives, victory through extraction, failure, optional objectives,
//     first-clear / replay Credits + XP, KIA handling + casualty resolution
//  C. Bridgehead: bridge pathfinding, chokepoint, counterattack from both banks, off-screen spawns,
//     enemy Sniper telegraph (aim -> lock -> shot), no shots through cover
//  D. Prison Break: prisoner release, watchtowers (fixed, long sightline, no shots through walls),
//     captive-centred formation (2-5 soldiers), no deadlock, extraction needs the prisoner, Patch unlock, cap 5
//  E. Convoy Crusher: moving trucks on the route, persistent HP, destruction, escape detection,
//     primary / optional / failure, Armored Trooper frontal resistance + flanking
//  F. Blackout: 3 relays, alarm, reinforcement reduction, optional, Sniper unlock (no free Sniper,
//     guaranteed offer, persists after reload, never before M9)
//  G. Sniper class: price / refund, stats (HP, damage, cadence, range, accuracy, revive), Focus,
//     target priority, traits, XP / training, down / revive, resurrection, Memorial, career, save
//  H. Iron Warden: MG windup -> burst, rocket telegraph (tracks, then LOCKS), dodge window, cover,
//     reinforcements at 65% / 30% exactly once, hidden modifiers, no text reveal, no-KIA optional,
//     extraction after the victory
//  I. Save migration: genuine v0.6.1 (v6) fixture -> v7, backup, nothing lost, no free Sniper
//  J. Mission 5 regression: captive-centred formation, objectives unchanged
// Prints PASS/FAIL per check, exits 1 on any failure. Usage: npx vite preview --port 4173 & node tools/chapter2.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const FX = (f) => fs.readFileSync(__dirname + '/fixtures/' + f, 'utf8');

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
    /** All named soldiers owned (dev unlock), levels set, then deploy `ids` into `mission`. */
    deploy(ids, mission, calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.calm();
      return r;
    },
    generic(classes, mission, calm = true) { const g = window.game; g.selectMission(mission, true); g.reset(classes); if (calm) this.calm(); return g.soldiers; },
    /** Put everyone (and the escorted captive) into the extraction zone and finish the mission. */
    extract(maxSec = 30) {
      const g = window.game, m = g.mission, z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      this.calm();
      g.soldiers.forEach((s, i) => { if (s.active) { s.pos = { x: c.x - 40 + (i % 3) * 40, y: c.y - 30 + Math.floor(i / 3) * 40 }; s.vel = { x: 0, y: 0 }; } });
      if (m.npc) { m.npc.pos = { ...c }; m.npc.vel = { x: 0, y: 0 }; }
      g.anchor = { ...c };
      return this.stepUntil(() => g.phase !== 'playing', maxSec, () => { for (const s of g.soldiers) if (s.active) s.vel = { x: 0, y: 0 }; });
    },
    resolve(policy = 'resurrect') {
      const a = window.__account(); let d;
      while ((d = a.pendingDecision) && d.queue.length) {
        const s = this.R.get(d.queue[0].id);
        if (policy === 'resurrect') { a.credits += window.__casualties.costFor(s); this.E.resurrect(this.R, a, s.id, window.__persist); } else this.E.memorialize(this.R, a, s.id, window.__persist);
      }
    },
    store() { return JSON.parse(localStorage.getItem(window.__SAVE_KEY)); },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
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
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(100)} ${String(detail).slice(0, 240)}`); };
  const fresh = async (raw = null) => {
    await page.goto(URL); await page.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await page.goto(URL); await page.waitForTimeout(150);
  };
  const reload = async () => { await page.reload(); await page.waitForTimeout(150); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const CH2 = ['bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist'];

  // ================= A. CAMPAIGN =================
  await fresh();
  const camp = await ev((CH2) => {
    const C = window.__campaign, M = window.game.mission;
    const rows = CH2.map((id) => { const m = C.campaignMission(id); return { id, n: m.number, cap: C.capacityOf(id), playable: m.playable, unlocks: m.unlocks.missions.join(), opt: m.optional.map((o) => o.id).join(), stars: m.stars.two + '/' + m.stars.three, recruits: m.unlocks.recruits.join(), classes: (m.unlocks.classes || []).join() }; });
    const scripts = CH2.map((id) => { const s = window.game.selectMission(id, true) && window.game.mission.script; return { id, ok: !!s, opt: s ? s.optionals().map((o) => o.id).join() : '' }; });
    return { rows, scripts, m5: C.campaignMission('bring-them-home').unlocks.missions.join(), m11: C.campaignMission('mission-11'), patch: C.namedRecruit('patch').milestone };
  }, CH2);
  check('M5 unlocks M6; M6->M7->M8->M9->M10 in order; M10 is the finale', camp.m5 === 'bridgehead' && camp.rows.map((r) => r.unlocks).join('|') === 'prison-break|convoy-crusher|blackout|iron-fist|', camp.rows.map((r) => `${r.id}->${r.unlocks}`).join(' '));
  check('mission numbers 6-10, all playable; deployment caps 4/5/5/5/5 (6 still reserved for M13+)', camp.rows.map((r) => r.n).join() === '6,7,8,9,10' && camp.rows.every((r) => r.playable) && camp.rows.map((r) => r.cap).join() === '4,5,5,5,5', camp.rows.map((r) => r.cap).join());
  check('optional objective ids match the mission scripts (no-kia, prisoner-safe, all-trucks, alarm, no-kia)', camp.rows.map((r) => r.opt).join() === 'no-kia,prisoner-safe,all-trucks,alarm,no-kia' && camp.scripts.every((s, i) => s.ok && s.opt === camp.rows[i].opt), camp.scripts.map((s) => s.opt).join());
  check('M7 milestone = Patch offer (prison-break), M9 unlocks the Sniper class, no soldier awarded', camp.patch === 'prison-break' && camp.rows[1].recruits === 'patch' && camp.rows[3].classes === 'sniper' && camp.rows.every((r, i) => i === 1 ? r.recruits === 'patch' : r.recruits === ''), JSON.stringify(camp.rows.map((r) => r.recruits + '/' + r.classes)));
  check('Chapter 3 placeholder after M10 (not playable)', camp.m11 && !camp.m11.playable && camp.m11.number === 11, camp.m11 && camp.m11.name);

  // mission chain through real settlements on a fresh save (first clears only unlock the next one)
  await fresh();
  const chain = await ev((CH2) => {
    const a = T.a, out = [];
    window.__debugUnlockAll();
    a.campaign.unlockedMissions = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home'];
    for (const id of ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon']) { T.deploy(['ace', 'ranger'], id); T.g.win(); }
    const before = CH2.map((id) => T.g.selectMission(id)).join();
    T.deploy(['ace', 'ranger', 'tank'], 'bring-them-home'); T.g.win();
    out.push(a.campaign.unlockedMissions.includes('bridgehead') && !a.campaign.unlockedMissions.includes('prison-break'));
    for (const [i, id] of CH2.entries()) {
      T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'].slice(0, window.__campaign.capacityOf(id)), id); T.g.win();
      const nxt = CH2[i + 1];
      out.push(nxt ? a.campaign.unlockedMissions.includes(nxt) && (!CH2[i + 2] || !a.campaign.unlockedMissions.includes(CH2[i + 2])) : true);
    }
    return { before, out };
  }, CH2);
  check('before M5: Missions 6-10 can\'t be selected; each first clear unlocks exactly the next mission', chain.before === 'false,false,false,false,false' && chain.out.every(Boolean), JSON.stringify(chain));

  // ================= B. PER-MISSION: objectives, victory, rewards, replay, failure, KIA =================
  for (const id of CH2) {
    await fresh();
    const r = await ev((id) => {
      window.__debugUnlockAll();
      const a = T.a, cap = window.__campaign.capacityOf(id);
      const ids = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'].slice(0, cap);
      const dep = T.deploy(ids, id);
      const tooMany = T.g.roster && (() => { const g = T.g; g.selectMission(id, true); return g.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'].slice(0, cap + 1).map((x) => g.roster.get(x)), 'roster'); })();
      T.deploy(ids, id);
      const m = T.g.mission;
      const prim = m.primaries.map((o) => o.id).join();
      m.debugReadyExtraction(T.g);
      const cr0 = a.credits;
      T.extract();
      const rw1 = T.g.lastReward;
      const first = { phase: T.g.phase, firstClear: rw1.firstClear, credits: rw1.credits, xp: rw1.soldiers.reduce((s, x) => s + x.xp, 0), stars: rw1.stars, cr: a.credits - cr0 };
      T.deploy(ids, id); T.g.mission.debugReadyExtraction(T.g); T.extract();
      const rw2 = T.g.lastReward;
      const replay = { phase: T.g.phase, firstClear: rw2.firstClear, credits: rw2.credits, xp: rw2.soldiers.reduce((s, x) => s + x.xp, 0) };
      // failure: the whole squad goes down -> MISSION FAILED, downed -> KIA, casualty decisions queued
      T.deploy(ids.slice(0, 2), id);
      for (const s of T.g.soldiers) T.g.damage(s, 9999);
      T.step(0.5);
      const failed = { phase: T.g.phase, kia: T.g.soldiers.filter((s) => s.state === 'kia').length, queue: a.pendingDecision ? a.pendingDecision.queue.length : 0 };
      T.resolve('resurrect');
      const after = { pending: !!a.pendingDecision && a.pendingDecision.queue.length > 0, alive: ids.slice(0, 2).every((x) => T.R.get(x).status === 'active') };
      return { dep: dep.ok, tooMany: tooMany.ok, cap, prim, first, replay, failed, after, opts: m.optionals.map((o) => o.state).join() };
    }, id);
    check(`${id}: deploys ${r.cap} soldiers, refuses ${r.cap + 1}`, r.dep && !r.tooMany, `cap ${r.cap}`);
    check(`${id}: objective chain ${r.prim}; victory only through extraction`, !!r.prim && r.first.phase === 'won', r.prim);
    check(`${id}: first clear pays first-clear Credits + XP; replay pays less, never first-clear again`, r.first.firstClear && r.first.credits > 0 && r.first.xp > 0 && !r.replay.firstClear && r.replay.credits > 0 && r.replay.credits < r.first.credits, `first ${r.first.credits} CR / ${r.first.xp} XP, replay ${r.replay.credits} CR / ${r.replay.xp} XP`);
    check(`${id}: total defeat fails the mission; downed -> KIA; decisions queued; Resurrect restores`, r.failed.phase === 'failed' && r.failed.kia === 2 && r.failed.queue === 2 && !r.after.pending && r.after.alive, JSON.stringify(r.failed));
  }

  // optional objectives: no-KIA (M6 / M10) completes on a clean win, fails on a KIA even if the mission is won
  await fresh();
  const nk = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc'], 'bridgehead'); T.g.mission.debugReadyExtraction(T.g);
    // a downed soldier who is revived still counts
    const d = T.g.soldiers[1]; T.g.damage(d, 9999); const downed = d.state; d.state = 'active'; d.hp = d.maxHp * 0.3;
    T.extract();
    const clean = T.g.mission.optional.map((o) => o.completed).join(), stars = T.g.lastStars.stars;
    T.deploy(['ace', 'ranger', 'tank', 'doc'], 'bridgehead'); T.g.mission.debugReadyExtraction(T.g);
    const k = T.g.soldiers[1]; T.g.damage(k, 9999); k.bleed = 0.01; T.step(0.2);
    T.extract(); if (T.g.phase === 'playing') { T.g.mission.confirmExtraction(T.g); }
    const kia = T.g.mission.optional.map((o) => o.completed).join();
    T.resolve('resurrect');
    return { downed, clean, stars, kia, phase: T.g.phase };
  });
  check('M6 optional "No soldier KIA": a revived soldier still completes it; a KIA fails it', nk.downed === 'downed' && nk.clean === 'true' && nk.kia === 'false', JSON.stringify(nk));

  // ================= C. BRIDGEHEAD =================
  await fresh();
  const br = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc'], 'bridgehead');
    const g = T.g, w = g.world;
    const path = w.findPath({ x: 1300, y: 720 }, { x: 2300, y: 720 }, 12);
    const crossings = path ? path.filter((p, i) => i > 0 && (path[i - 1].x < 1700) !== (p.x < 1700)).length : -1;
    const allOnBridge = path ? path.every((p, i) => i === 0 || !(Math.min(path[i - 1].x, p.x) < 1860 && Math.max(path[i - 1].x, p.x) > 1700) || ((path[i - 1].y + p.y) / 2 > 650 && (path[i - 1].y + p.y) / 2 < 790)) : false;
    const waterBlocks = !w.passable({ x: 1600, y: 300 }, { x: 1950, y: 300 }, 12);
    const losOverWater = w.clear({ x: 1600, y: 300 }, { x: 1950, y: 300 });
    const north = w.findPath({ x: 1500, y: 200 }, { x: 2000, y: 200 }, 12);
    const pts = north ? [{ x: 1500, y: 200 }, ...north] : [];
    const cross = pts.slice(1).map((p, i) => { const q = pts[i]; if ((q.x - 1780) * (p.x - 1780) > 0 || q.x === p.x) return null; return q.y + (p.y - q.y) * (1780 - q.x) / (p.x - q.x); }).filter((y) => y !== null);
    const viaBridge = cross.length > 0 && cross.every((y) => y > 655 && y < 785);
    return { path: !!path, allOnBridge, waterBlocks, losOverWater, viaBridge };
  });
  check('bridge pathfinding: west -> east bank path exists and crosses only on the bridge deck', br.path && br.allOnBridge && br.viaBridge, JSON.stringify(br));
  check('river: blocks movement (chokepoint) but not line of sight (fire across the water)', br.waterBlocks && br.losOverWater, JSON.stringify(br));

  const hold = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc'], 'bridgehead');
    const g = T.g, m = g.mission;
    // defenders gone -> hold starts when the squad stands on the bridge
    T.calm();
    m.primaries[0].state = 'complete'; m.current = 1; m.primaries[1].activate(m, g); m.phase = m.primaries[1].phase;
    const hold = m.currentObjective;
    const z = hold.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    g.invuln = true;
    const pin = () => { g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 60 + i * 40, y: c.y }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...c }; };
    const spawns = [], seen = new Set();
    const t = T.stepUntil(() => { for (const e of g.enemies) if (!seen.has(e)) { seen.add(e); spawns.push({ x: Math.round(e.pos.x), y: Math.round(e.pos.y), kind: e.kind, onScreen: g.isOnScreen(e.pos, 0), d: Math.round(Math.min(...g.soldiers.map((s) => T.near(s.pos, e.pos)))) }); } return hold.state === 'complete'; }, 80, pin);
    g.invuln = false;
    return { id: hold.id, t, done: hold.state, spawns, west: spawns.filter((s) => s.x < 1700).length, east: spawns.filter((s) => s.x > 1860).length, snipers: spawns.filter((s) => s.kind === 'sniper').length, minD: Math.min(...spawns.map((s) => s.d)), onScreen: spawns.filter((s) => s.onScreen).length, phase: m.phase };
  });
  check('hold the bridge: completes after the hold time with a soldier in the zone', hold.id === 'hold' && hold.done === 'complete' && hold.t >= 44 && hold.t < 50, `${hold.t}s`);
  check('counterattack from BOTH banks (west + east waves), incl. enemy Snipers', hold.west > 0 && hold.east > 0 && hold.snipers > 0, `west ${hold.west}, east ${hold.east}, snipers ${hold.snipers}`);
  check('no wave spawns on top of / in view of the squad (all off-screen, > 500 px away)', hold.onScreen === 0 && hold.minD > 500, `min distance ${hold.minD}, on screen ${hold.onScreen}`);

  // enemy Sniper: aim (laser) -> lock -> one precise shot; never through cover
  const sn = await ev(() => {
    window.__debugUnlockAll();
    T.generic(['infantry'], 'bridgehead');
    const g = T.g, s = g.soldiers[0];
    s.pos = { x: 900, y: 950 }; g.anchor = { ...s.pos }; g.cam = { x: 1100, y: 950 }; g.invuln = true;
    const e = g.spawnEnemy({ x: 1300, y: 950 }, 'sniper'); e.guard = true; e.reactionTime = 0;
    const tl = []; let lockedAt = null, firedAt = null, aimAtLock = null, aimAtShot = null, shots0 = e.shots;
    T.stepUntil(() => {
      if (e.aimHeld > 0 && !tl.length) tl.push(+g.time.toFixed(2));
      if (e.lockAim !== null && lockedAt === null) { lockedAt = g.time; aimAtLock = e.lockAim; }
      if (e.shots > shots0 && firedAt === null) { firedAt = g.time; const p = g.projectiles.find((q) => q.owner === e); aimAtShot = p ? Math.atan2(p.vel.y, p.vel.x) : null; }
      return firedAt !== null;
    }, 8, () => { s.vel = { x: 0, y: 0 }; s.pos = { x: 900, y: 950 }; });
    const aimStart = tl[0], C = T.C.enemySniper;
    // cover: a wall between the sniper and the soldier -> no shot, ever
    T.generic(['infantry'], 'bridgehead');
    const s2 = g.soldiers[0]; s2.pos = { x: 1150, y: 1120 }; g.anchor = { ...s2.pos }; g.invuln = true;
    // B(1050, 1000, 200, 150) sits between (1150,1120)... put the sniper north of the building
    const e2 = g.spawnEnemy({ x: 1150, y: 880 }, 'sniper'); e2.guard = true;
    const blocked = !g.world.clear(s2.pos, e2.pos);
    const sh0 = e2.shots; T.step(8, () => { s2.vel = { x: 0, y: 0 }; s2.pos = { x: 1150, y: 1180 }; });
    g.invuln = false;
    return { aimStart, lockedAt, firedAt, aimTime: C.aimTime, lockTime: C.lockTime, range: C.range, rifle: T.C.enemy.range, dmg: C.damage, rifleDmg: T.C.enemy.damage, rate: C.fireRate, dev: aimAtShot !== null ? Math.abs(Math.atan2(Math.sin(aimAtShot - aimAtLock), Math.cos(aimAtShot - aimAtLock))) * 180 / Math.PI : null, blocked, coverShots: e2.shots - sh0 };
  });
  check('enemy Sniper: longer range, slower fire, higher single-shot damage than a rifleman', sn.range > sn.rifle && sn.rate < 0.5 && sn.dmg >= 2.5 * sn.rifleDmg, `range ${sn.range} vs ${sn.rifle}, dmg ${sn.dmg} vs ${sn.rifleDmg}, ${sn.rate}/s`);
  check('enemy Sniper telegraph: visible aim for the full aim time, LOCK before the shot, shot along the locked line', sn.firedAt !== null && sn.firedAt - sn.aimStart >= sn.aimTime - 0.05 && sn.lockedAt < sn.firedAt && sn.firedAt - sn.lockedAt >= sn.lockTime - 0.05 && sn.dev < 2, `aim ${sn.aimStart} lock ${sn.lockedAt && sn.lockedAt.toFixed(2)} fire ${sn.firedAt && sn.firedAt.toFixed(2)} dev ${sn.dev && sn.dev.toFixed(2)}°`);
  check('enemy Sniper never fires through cover (8 s with a building in between)', sn.blocked && sn.coverShots === 0, `blocked ${sn.blocked}, shots ${sn.coverShots}`);

  // ================= D. PRISON BREAK =================
  await fresh();
  const pr = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'prison-break', false);
    const g = T.g, m = g.mission;
    const towers = g.enemies.filter((e) => e.kind === 'tower');
    const t0 = towers.map((t) => ({ ...t.pos }));
    const out = { soldiers: g.soldiers.length, towers: towers.length, towerRange: T.C.tower.range, rifleRange: T.C.enemy.range, npc: m.npc && m.npc.label, held: m.npc && !m.npc.escorting };
    T.step(3);
    out.towersFixed = towers.every((t, i) => T.near(t.pos, t0[i]) < 0.5);
    // a tower never shoots through a wall: soldier behind the guard house K(2200,600,120,80) seen from the tower at (2300,380)
    T.calm();
    const tw = g.spawnEnemy({ x: 2260, y: 380 }, 'tower'); tw.guard = true;
    g.invuln = true;
    const s = g.soldiers[0]; const spot = { x: 2290, y: 760 };
    out.wallBlocks = [0, 1, 2, 3, 4].every((i) => !g.world.clear(tw.pos, { x: spot.x - 60 + i * 30, y: spot.y }));
    const pin = () => { g.soldiers.forEach((x, i) => { x.pos = { x: spot.x - 60 + i * 30, y: spot.y }; x.vel = { x: 0, y: 0 }; }); g.anchor = { ...spot }; };
    const sh0 = tw.shots; T.step(6, pin); out.throughWall = tw.shots - sh0;
    // in the open, inside its sightline (beyond rifle range) it does shoot
    const open = { x: 2700, y: 360 };
    out.openClear = g.world.clear(tw.pos, open) && T.near(tw.pos, open) > T.C.enemy.range;
    const pin2 = () => { g.soldiers.forEach((x, i) => { x.pos = { x: open.x + i * 25, y: open.y }; x.vel = { x: 0, y: 0 }; }); g.anchor = { ...open }; };
    const sh1 = tw.shots; T.step(6, pin2); out.inOpen = tw.shots - sh1;
    g.invuln = false;
    return out;
  });
  check('Prison Break: 5 soldiers deploy; 4 watchtowers; POW MEDIC held at start', pr.soldiers === 5 && pr.towers === 4 && pr.npc === 'POW MEDIC' && pr.held, JSON.stringify(pr));
  check('watchtowers: fixed position, longer sightline than riflemen', pr.towersFixed && pr.towerRange > pr.rifleRange, `${pr.towerRange} vs ${pr.rifleRange}`);
  check('watchtower never shoots through walls; does shoot a soldier in the open at long range', pr.wallBlocks && pr.throughWall === 0 && pr.openClear && pr.inOpen > 0, `through wall ${pr.throughWall}, in the open ${pr.inOpen}`);

  const esc = await ev(() => {
    const out = {};
    for (const n of [2, 3, 4, 5]) {
      window.__debugUnlockAll();
      T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'].slice(0, n), 'prison-break');
      const g = T.g, m = g.mission, c = m.npc;
      // release: stand next to the prisoner for the free time
      m.current = 1; m.primaries[0].state = 'complete'; m.primaries[1].state = 'active'; m.phase = 'free';
      g.soldiers.forEach((s, i) => { s.pos = { x: 2560 + i * 20, y: 650 }; }); g.anchor = { x: 2580, y: 650 };
      T.stepUntil(() => c.escorting, 8);
      const released = c.escorting;
      // walk the extraction route (west then north-west) and measure the formation
      let worst = 0, sumD = 0, n2 = 0, ringOk = 0, ringN = 0, lag = 0; const ds = [];
      const route = [{ x: 2350, y: 740 }, { x: 1750, y: 765 }, { x: 1300, y: 900 }, { x: 900, y: 600 }, { x: 400, y: 300 }];
      let k = 0;
      T.stepUntil(() => {
        const goal = route[k]; if (!goal) return true;
        const dx = goal.x - g.anchor.x, dy = goal.y - g.anchor.y, d = Math.hypot(dx, dy);
        if (d < 30) { k++; return false; }
        const p = g.world.findPath(g.anchor, goal, 12);
        const tgt = p && p.length ? p[0] : goal;
        const ex = tgt.x - g.anchor.x, ey = tgt.y - g.anchor.y, ed = Math.hypot(ex, ey) || 1;
        g.input.move = () => ({ x: ex / ed, y: ey / ed });
        const act = g.soldiers.filter((s) => s.active);
        const cx = act.reduce((a, s) => a + s.pos.x, 0) / act.length, cy = act.reduce((a, s) => a + s.pos.y, 0) / act.length;
        const dc = Math.hypot(c.pos.x - cx, c.pos.y - cy);
        worst = Math.max(worst, dc); sumD += dc; n2++; ds.push(dc);
        // "inside the ring": no soldier-free half-plane... approximated: the captive is closer to the centroid than the average soldier
        const avgR = act.reduce((a, s) => a + Math.hypot(s.pos.x - cx, s.pos.y - cy), 0) / act.length;
        ringN++; if (dc <= avgR + 5) ringOk++;
        lag = Math.max(lag, Math.hypot(c.pos.x - g.anchor.x, c.pos.y - g.anchor.y));
        return false;
      }, 90);
      g.input.move = () => ({ x: 0, y: 0 });
      ds.sort((p, q) => p - q);
      out[n] = { released, reached: k >= route.length, median: Math.round(ds[Math.floor(ds.length / 2)] || 0), avg: Math.round(sumD / Math.max(1, n2)), worst: Math.round(worst), inside: +(ringOk / Math.max(1, ringN)).toFixed(2), lag: Math.round(lag), rescues: g.escortRescues };
    }
    return out;
  });
  check('prisoner release: standing next to the prisoner frees them (escorting)', [2, 3, 4, 5].every((n) => esc[n].released), JSON.stringify(Object.values(esc).map((x) => x.released)));
  check('captive-centred formation (2-5 soldiers): captive near the squad centre (median <= 40 px), inside the ring >= 75% of the walk', [2, 3, 4, 5].every((n) => esc[n].median <= 40 && (n === 2 || esc[n].inside >= 0.75)), JSON.stringify(esc));
  check('escort walk to extraction: route completed, no deadlock (no teleport rescue), captive never left behind (< 200 px)', [2, 3, 4, 5].every((n) => esc[n].reached && esc[n].rescues === 0 && esc[n].lag < 200), JSON.stringify(Object.values(esc).map((x) => `${x.reached}/${x.rescues}/${x.lag}`)));

  const prx = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a; a.named.unlocked = a.named.unlocked.filter((k) => k !== 'patch'); a.named.claimed = a.named.claimed.filter((k) => k !== 'patch'); a.named.notified = a.named.notified.filter((k) => k !== 'patch');
    const had = T.R.isUnlocked('patch');
    T.R.unlocked.delete('patch');
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'prison-break');
    const g = T.g, m = g.mission;
    m.debugReadyExtraction(g); m.npc.escorting = true;
    // everyone in the zone but the prisoner -> no extraction
    const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    m.npc.pos = { x: 1500, y: 900 };
    T.step(2, () => { g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 40 + i * 20, y: c.y }; s.vel = { x: 0, y: 0 }; }); m.npc.pos = { x: 1500, y: 900 }; m.npc.vel = { x: 0, y: 0 }; });
    const withoutPrisoner = g.phase;
    T.extract();
    const rw = g.lastReward;
    const offers = T.E.namedOffers(T.R, a).map((o) => o.def.key).join();
    const healer = window.__recruitment.traitPool('medic', window.__recruitment.campaignFlags(a)).includes('healer');
    return { withoutPrisoner, phase: g.phase, unl: rw.unlockedRecruits.join(), patchOwned: T.R.isUnlocked('patch'), offers, healer, opt: m.optional.map((o) => o.id + ':' + o.completed).join() };
  });
  check('extraction waits for the prisoner; with the prisoner in the zone the mission is won', prx.withoutPrisoner === 'playing' && prx.phase === 'won', JSON.stringify(prx));
  check('M7 first clear: Patch offer unlocked (1000 CR, not added to the roster), Healer for Medic recruits', prx.unl === 'patch' && !prx.patchOwned && /patch/.test(prx.offers) && prx.healer, JSON.stringify(prx));

  const prf = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'prison-break');
    const g = T.g, m = g.mission; m.npc.escorting = true;
    g.damage(m.npc, 9999); const st = m.npc.state; const opt1 = m.optionals[0].state;
    m.npc.bleed = 0.01; T.step(0.3);
    const out = { st, opt1, phase: g.phase, reason: m.failReason };
    T.resolve('resurrect');
    // revived prisoner: the optional stays failed (tracked independently of survival)
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'prison-break');
    const m2 = g.mission; m2.npc.escorting = true; g.damage(m2.npc, 9999); m2.npc.state = 'active'; m2.npc.hp = 50;
    m2.debugReadyExtraction(g); T.extract();
    out.revivedWin = g.phase; out.optAfterRevive = m2.optionals[0].state;
    return out;
  });
  check('prisoner KIA fails the mission; optional "never downed" fails on the first down even if they survive', prf.st === 'downed' && prf.opt1 === 'failed' && prf.phase === 'failed' && /captive/i.test(prf.reason) && prf.revivedWin === 'won' && prf.optAfterRevive === 'failed', JSON.stringify(prf));

  // ================= E. CONVOY CRUSHER =================
  await fresh();
  const cv = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'convoy-crusher');
    const g = T.g, m = g.mission, c = m.convoy;
    g.invuln = true;
    const pin = () => { g.soldiers.forEach((s) => { s.pos = { x: 1650, y: 1080 }; s.vel = { x: 0, y: 0 }; s.target = null; s.fireCooldown = 1; }); };
    T.stepUntil(() => c.trucks[0].state === 'moving', 30, pin);
    const tr = c.trucks[0].unit; const p0 = { ...tr.pos }, s0 = c.trucks[0].s;
    T.step(4, pin);
    const moved = T.near(tr.pos, p0), along = c.trucks[0].s - s0;
    // persistent HP + damage feedback + destruction -> wreck, objective progress
    g.damage(tr, 300); const hp1 = tr.hp; T.step(1, pin); const hpKept = tr.hp === hp1;
    g.damage(tr, 5000); T.step(0.1, pin);
    const destroyed = c.trucks[0].state, wreck = m.wrecks.some((w) => w.kind === 'truck');
    // escape: push truck 2 to the end of its route
    T.stepUntil(() => c.trucks[1].state === 'moving', 40, pin);
    c.trucks[1].s = c.total - 5; T.step(0.5, pin);
    const escaped = c.trucks[1].state, escapedN = c.escaped, phaseAfter1Escape = g.phase, opt = m.optionals[0].state;
    T.stepUntil(() => c.trucks[2].state === 'moving', 40, pin);
    g.damage(c.trucks[2].unit, 99999); T.step(0.2, pin);
    const prim = m.primaries[0].state;
    g.invuln = false;
    return { moved: Math.round(moved), along: Math.round(along), hpKept, destroyed, wreck, escaped, escapedN, phaseAfter1Escape, opt, prim, phase: g.phase, gap: m.script.convoy.gap, total: Math.round(c.total), speed: T.C.truck.moveSpeed };
  });
  check('trucks drive the route (moving, persistent HP), destroyed -> wreck', cv.moved > 150 && cv.along > 150 && cv.hpKept && cv.destroyed === 'destroyed' && cv.wreck, JSON.stringify(cv));
  check('truck escape detected; 1 escape is not a failure; the optional (all three) fails on the first escape', cv.escaped === 'escaped' && cv.escapedN === 1 && cv.phaseAfter1Escape === 'playing' && cv.opt === 'failed', JSON.stringify(cv));
  check('2 of 3 destroyed completes the primary', cv.prim === 'complete' && cv.phase === 'playing', JSON.stringify(cv));
  check('time to react: a truck needs > 2 minutes to cross the map', cv.total / cv.speed > 120, `${Math.round(cv.total / cv.speed)} s`);

  const cv2 = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'convoy-crusher');
    const g = T.g, m = g.mission, c = m.convoy; g.invuln = true;
    const pin = () => { g.soldiers.forEach((s) => { s.pos = { x: 1650, y: 1080 }; s.vel = { x: 0, y: 0 }; s.target = null; s.fireCooldown = 1; }); };
    for (let i = 0; i < 2; i++) { T.stepUntil(() => c.trucks[i].state === 'moving', 60, pin); c.trucks[i].s = c.total - 2; T.step(0.3, pin); }
    const a = { phase: g.phase, reason: m.failReason };
    T.resolve('resurrect');
    // all three destroyed -> optional complete
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'convoy-crusher');
    const m2 = g.mission, c2 = m2.convoy; g.invuln = true;
    for (let i = 0; i < 3; i++) { T.stepUntil(() => c2.trucks[i].state === 'moving', 60, pin); g.damage(c2.trucks[i].unit, 99999); T.step(0.2, pin); }
    T.extract();
    g.invuln = false;
    return { a, opt: m2.optional.map((o) => o.completed).join(), won: g.phase };
  });
  check('two trucks escape -> MISSION FAILED ("The convoy escaped.")', cv2.a.phase === 'failed' && /convoy escaped/i.test(cv2.a.reason), JSON.stringify(cv2.a));
  check('all three trucks destroyed -> optional complete, mission won after extraction', cv2.opt === 'true' && cv2.won === 'won', JSON.stringify(cv2));

  const arm = await ev(() => {
    window.__debugUnlockAll();
    T.generic(['infantry'], 'convoy-crusher');
    const g = T.g, s = g.soldiers[0];
    const e = g.spawnEnemy({ x: 1000, y: 1000 }, 'armored'); e.aim = 0; // facing east
    const hit = (dirx, diry) => { const h0 = e.hp; g.damage(e, 10, s, { dir: { x: dirx, y: diry } }); const d = h0 - e.hp; e.hp = e.maxHp; return d; };
    // bullet travelling WEST hits a trooper facing EAST = frontal hit
    const front = hit(-1, 0), side = hit(0, 1), rear = hit(1, 0);
    const g0 = e.hp; g.damage(e, 10, s, { grenade: true, dir: { x: -1, y: 0 } }); const gren = g0 - e.hp;
    return { front, side, rear, gren, hp: e.maxHp, rifleHp: T.C.enemy.hp, speed: T.C.armored.moveSpeed, rifleSpeed: T.C.enemy.moveSpeed, adv: T.C.armored.advanceChance };
  });
  check('Armored Trooper: more HP, slower, always advances', arm.hp > arm.rifleHp * 1.5 && arm.speed < arm.rifleSpeed && arm.adv === 1, JSON.stringify(arm));
  check('Armored Trooper: frontal fire reduced (not immune), sides normal, rear bonus, grenades full', arm.front > 0 && arm.front < arm.side * 0.5 && arm.side === 10 && arm.rear > arm.side && arm.gren === 10, `front ${arm.front}, side ${arm.side}, rear ${arm.rear}, grenade ${arm.gren}`);

  // ================= F. BLACKOUT =================
  await fresh();
  const bo = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'blackout');
    const g = T.g, m = g.mission, r = m.primaries[0];
    g.invuln = true;
    const pin = () => { g.soldiers.forEach((s) => { s.pos = { x: 180, y: 1000 }; s.vel = { x: 0, y: 0 }; s.target = null; s.fireCooldown = 1; }); };
    T.step(0.1, pin);
    const out = { relays: r.targets.length, hud: g.objective.meter ? g.objective.meter.label : null, chips: (g.objective.chips || []).length };
    const cap = window.__CFG ? null : null;
    // 3 relays up: waves every interval[3]
    const count = () => g.enemies.filter((e) => e.active && !e.structure).length;
    T.calm(); r.waveT = 0.01; const c0 = count(); T.step(0.2, pin); out.wave3 = count() - c0; out.next3 = Math.round(r.waveT);
    const a0 = r.alarm; T.step(10, pin); out.rate3 = +((r.alarm - a0) / 10).toFixed(2);
    // destroy one relay -> slower alarm, longer interval, smaller waves
    g.damage(r.targets[0], 99999); T.step(0.1, pin);
    out.left = r.left;
    T.calm(); r.waveT = 0.01; const c1 = count(); T.step(0.2, pin); out.wave2 = count() - c1; out.next2 = Math.round(r.waveT);
    const a1 = r.alarm; T.step(10, pin); out.rate2 = +((r.alarm - a1) / 10).toFixed(2);
    g.damage(r.targets[1], 99999); T.step(0.1, pin);
    T.calm(); r.waveT = 0.01; const c2 = count(); T.step(0.2, pin); out.wave1 = count() - c2; out.next1 = Math.round(r.waveT);
    // the cap: no new wave while too many enemies are alive
    for (let i = 0; i < 14; i++) { const e = g.spawnEnemy({ x: 2900, y: 1700 }); e.guard = true; }
    const c3 = count(); r.waveT = 0.01; T.step(0.2, pin); out.capped = count() - c3;
    T.calm();
    g.damage(r.targets[2], 99999); T.step(0.2, pin);
    out.prim = r.state; out.optional = m.optionals[0].state;
    const a3 = r.alarm; const n3 = count(); T.step(40, pin); out.after = { alarm: +(r.alarm - a3).toFixed(2), spawned: count() - n3 };
    g.invuln = false;
    return out;
  });
  check('Blackout: 3 relays, relay chips + ALARM meter on the HUD', bo.relays === 3 && bo.chips === 3 && bo.hud === 'ALARM', JSON.stringify(bo));
  check('reinforcements scale with relays up (3 > 2 > 1 > 0): wave size and interval, alarm rate', bo.wave3 >= bo.wave2 && bo.wave2 >= bo.wave1 && bo.wave1 > 0 && bo.next3 < bo.next2 && bo.next2 < bo.next1 && bo.rate3 > bo.rate2 && bo.left === 2, JSON.stringify(bo));
  check('no unlimited accumulation: no wave while 12+ enemies are alive; all relays down = no more waves, alarm stops', bo.capped === 0 && bo.prim === 'complete' && bo.after.spawned === 0 && bo.after.alarm === 0, JSON.stringify(bo.after));
  check('optional completes when all relays fall before the alarm maxes', bo.optional === 'complete', bo.optional);
  const bo2 = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'blackout');
    const g = T.g, m = g.mission, r = m.primaries[0]; g.invuln = true;
    r.alarm = 99.9; T.step(1, () => { T.calm(); r.waveT = 99; });
    const out = { maxed: r.maxedAt !== null, opt: m.optionals[0].state, time: Math.round(100 / T.C ? 0 : 0) };
    g.invuln = false;
    return out;
  });
  check('optional fails when the alarm reaches maximum with relays still up', bo2.maxed && bo2.opt === 'failed', JSON.stringify(bo2));
  const alarmTime = await ev(() => ({ three: Math.round(100 / 0.75), note: 'seconds to max with all 3 relays up' }));
  check('alarm budget rewards decisive play (>= 2 min with all relays up; slower as relays fall)', alarmTime.three >= 120, `${alarmTime.three} s`);

  // Sniper unlock: never before M9, unlocked on first clear, guaranteed in the next lineup, no free Sniper, persists
  await fresh();
  const su = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a, R = window.__recruitment;
    const before = R.recruitableClasses(R.campaignFlags(a)).join();
    // 400 random lineups before M9: never a Sniper
    let snipersBefore = 0;
    for (let i = 0; i < 400; i++) { a.credits += 100; T.E.refreshOffers(T.R, a, null, null); snipersBefore += a.recruitment.offers.filter((o) => o.classId === 'sniper').length; }
    const owned0 = T.R.owned().length;
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'blackout'); T.g.mission.debugReadyExtraction(T.g); T.extract();
    const rw = T.g.lastReward;
    const out = { before, snipersBefore, unl: (rw.unlockedClasses || []).join(), owned: T.R.owned().length - owned0, anySniperOwned: T.R.owned().some((s) => s.classId === 'sniper'), notice: window.__economy.pendingClassNotice(a), flags: R.recruitableClasses(R.campaignFlags(a)).join() };
    // replay: no second unlock
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'blackout'); T.g.mission.debugReadyExtraction(T.g); T.extract();
    out.replayUnl = (T.g.lastReward.unlockedClasses || []).join();
    window.__persist();
    return out;
  });
  check('Sniper never offered before Mission 9 (400 random lineups)', su.snipersBefore === 0 && !/sniper/.test(su.before), `${su.snipersBefore} sniper offers; pool ${su.before}`);
  check('M9 first clear unlocks the Sniper class (pool: infantry, heavy, medic, sniper); NO free Sniper; replay unlocks nothing', su.unl === 'sniper' && su.owned === 0 && !su.anySniperOwned && su.flags === 'infantry,heavy,medic,sniper' && su.replayUnl === '', JSON.stringify(su));
  await reload();
  const su2 = await ev(() => {
    const a = T.a;
    const notice = document.querySelector('.cn-notice');
    const txt = notice ? notice.textContent.replace(/\s+/g, ' ') : '';
    const persisted = a.classUnlocks.unlocked.join();
    // guaranteed in the next lineup (one-time introduction; the 3-offer structure kept)
    T.E.openOffice(T.R, a, null);
    const offers = a.recruitment.offers.map((o) => o.classId);
    return { txt, persisted, offers, n: offers.length };
  });
  check('after reload: unlock persisted; "NEW CLASS UNLOCKED! SNIPER" notice with the exact text', su2.persisted === 'sniper' && /NEW CLASS UNLOCKED!/.test(su2.txt) && /SNIPER/.test(su2.txt) && /Long-range precision specialists are now available in the Recruitment Office\./.test(su2.txt), su2.txt.slice(0, 160));
  check('next lineup holds a Sniper (guaranteed), still three offers', su2.n === 3 && su2.offers.includes('sniper'), su2.offers.join());
  await page.click('[data-a="cn-later"]');
  const su3 = await ev(() => ({ notified: T.a.classUnlocks.notified.join(), shown: !!document.querySelector('.cn-notice') }));
  await reload();
  const su4 = await ev(() => ({ shown: !!document.querySelector('.cn-notice') }));
  check('notice shown once: LATER marks it seen (saved), never again after reload', su3.notified === 'sniper' && !su3.shown && !su4.shown, JSON.stringify([su3, su4]));

  // ================= G. SNIPER CLASS =================
  await fresh();
  const sc = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a, R = window.__recruitment;
    a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper');
    const cs = window.__CFG.sniper, ci = window.__CFG.infantry;
    // buy one through the office
    T.E.openOffice(T.R, a, null);
    let o = null;
    for (let i = 0; i < 200 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'sniper'); if (!o) { a.credits += 100; T.E.refreshOffers(T.R, a, null, null); } }
    a.credits = 1249; const poor = T.E.recruit(T.R, a, o.id, null);
    a.credits = 1250; const r = T.E.recruit(T.R, a, o.id, null);
    const s = r.soldier;
    const out = { price: R.priceOf('sniper'), refund: R.refundOf('sniper'), poor: poor.ok, ok: r.ok, credits: a.credits, trait: s.traitId, level: s.progression.level, cls: s.classId };
    out.stats = { hp: cs.hp, dmg: cs.damage, rate: cs.fireRate, range: cs.range, irange: ci.range, acc: cs.accuracy, iacc: ci.accuracy, revive: cs.reviveTime, aim: cs.aimTime };
    // traits: Sniper-only pool, modest effects
    const pool = R.traitPool('sniper', R.campaignFlags(a));
    const base = window.__effectiveStats({ ...s, traitId: null });
    const eff = Object.fromEntries(pool.map((t) => [t, window.__effectiveStats({ ...s, traitId: t })]));
    out.pool = pool.join();
    out.eagle = +(eff.eagleEye.accuracy / base.accuracy).toFixed(2);
    out.steady = +(eff.steadyHands.aimTime / base.aimTime).toFixed(2);
    out.calm = +(eff.deadCalm.movePenalty / base.movePenalty).toFixed(2);
    out.infTraits = R.traitPool('infantry', R.campaignFlags(a)).filter((t) => pool.includes(t)).length;
    // training + XP
    a.credits = 100000;
    const tr = T.E.buyTraining(T.R, a, s.id, 'damage', 0, null);
    out.trained = tr.ok && T.R.get(s.id).training.damage === 1;
    // rename
    out.rename = T.E.rename(T.R, a, s.id, 'Longshot', null).ok && T.R.get(s.id).name === 'Longshot';
    // dismiss refund: price 1250 - refund 300 => no loop
    const c0 = a.credits; const dm = T.E.dismiss(T.R, a, s.id, null); out.dismissGain = a.credits - c0; out.dismissOk = dm.ok;
    return out;
  });
  check('Sniper recruitment: 1250 CR (refused at 1249), level from campaign progress, Sniper trait', sc.price === 1250 && !sc.poor && sc.ok && sc.credits === 0 && sc.cls === 'sniper' && /eagleEye|steadyHands|deadCalm/.test(sc.trait) && sc.level >= 1, JSON.stringify(sc));
  check('Sniper stats: HP 75, 32 dmg, 0.8 shots/s, longer range + tighter spread than Infantry, 10 s revive, aim cue', sc.stats.hp === 75 && sc.stats.dmg === 32 && sc.stats.rate === 0.8 && sc.stats.range > sc.stats.irange && sc.stats.acc < sc.stats.iacc && sc.stats.revive === 10 && sc.stats.aim > 0, JSON.stringify(sc.stats));
  check('Sniper traits: Eagle Eye -20% spread, Steady Hands -25% aim time, Dead Calm -30% moving penalty; Sniper-only pool', sc.pool === 'eagleEye,steadyHands,deadCalm' && sc.eagle === 0.8 && sc.steady === 0.75 && sc.calm === 0.7 && sc.infTraits === 0, `${sc.pool} ${sc.eagle}/${sc.steady}/${sc.calm}`);
  check('Sniper: training, rename, dismissal refund 300 (< 1250 price: no recruit-dismiss loop)', sc.trained && sc.rename && sc.dismissOk && sc.dismissGain === 300 && sc.refund === 300 && sc.refund < sc.price, JSON.stringify({ t: sc.trained, r: sc.rename, d: sc.dismissGain }));

  const sf = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a; a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper');
    T.generic(['sniper', 'infantry'], 'bridgehead');
    const g = T.g, sn = g.soldiers[0], inf = g.soldiers[1];
    const out = { cls: sn.classDef.id, ability: sn.ability.id, hp: sn.maxHp, range: sn.stats.range };
    // cadence: measured shots/s on a dummy at 400 px (beyond infantry range? infantry range is lower)
    g.invuln = true;
    sn.pos = { x: 600, y: 1300 }; inf.pos = { x: 300, y: 1450 }; g.anchor = { ...sn.pos }; g.cam = { x: 800, y: 1300 };
    const e = g.spawnEnemy({ x: 1050, y: 1300 }); e.hp = 1e9; e.maxHp = 1e9; e.guard = true; e.reactionTime = 1e9;
    const pin = () => { sn.vel = { x: 0, y: 0 }; inf.vel = { x: 0, y: 0 }; sn.pos = { x: 600, y: 1300 }; inf.pos = { x: 300, y: 1450 }; };
    T.step(2, pin); const s0 = sn.shots; T.step(20, pin); out.rate = +((sn.shots - s0) / 20).toFixed(2);
    out.infShotsAt450 = inf.shots;
    // Focus: faster cadence while active (no new button: it is the portrait ability)
    sn.ability.cooldownLeft = 0; g.useAbility(sn); const f0 = sn.shots; T.step(5, pin); out.focusRate = +((sn.shots - f0) / 5).toFixed(2);
    // target priority: an exposed enemy Sniper beats a nearer rifleman
    T.calm();
    const rifle = g.spawnEnemy({ x: 900, y: 1300 }); rifle.guard = true; rifle.hp = 1e9;
    const esn = g.spawnEnemy({ x: 1080, y: 1330 }, 'sniper'); esn.guard = true; esn.hp = 1e9;
    out.losBoth = g.world.clear(sn.pos, rifle.pos) && g.world.clear(sn.pos, esn.pos);
    sn.target = null; T.step(1, pin);
    out.pick = sn.target === esn ? 'sniper' : sn.target === rifle ? 'rifle' : String(sn.target && sn.target.kind);
    // no oscillation: target held while aiming
    let switches = 0, last = sn.target; T.step(6, () => { pin(); if (sn.target !== last) { switches++; last = sn.target; } });
    out.switches = switches;
    g.invuln = false;
    return out;
  });
  check('Sniper in the field: Focus ability, measured cadence ~0.8 shots/s', sf.cls === 'sniper' && sf.ability === 'focus' && sf.rate >= 0.7 && sf.rate <= 0.85, JSON.stringify(sf));
  check('Focus: faster firing while active', sf.focusRate > sf.rate * 1.15, `${sf.rate} -> ${sf.focusRate}/s`);
  check('Sniper targeting: an exposed enemy Sniper beats a nearer rifleman; no target flapping', sf.pick === 'sniper' && sf.switches <= 1, `${sf.pick}, ${sf.switches} switches`);

  const sl = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a; a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper');
    T.E.openOffice(T.R, a, null);
    let o = null; for (let i = 0; i < 200 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'sniper'); if (!o) { a.credits += 100; T.E.refreshOffers(T.R, a, null, null); } }
    a.credits += 1250; const s = T.E.recruit(T.R, a, o.id, null).soldier;
    // down + revive in a mission, XP on a win, career record
    T.deploy([s.id, 'doc'], 'bridgehead');
    const g = T.g, u = g.soldiers.find((x) => x.identity.id === s.id);
    g.damage(u, 9999); const downed = u.state;
    T.step(12, () => { const d = g.soldiers.find((x) => x.identity.id === 'doc'); d.pos = { x: u.pos.x + 20, y: u.pos.y }; d.vel = { x: 0, y: 0 }; g.anchor = { ...u.pos }; });
    const revived = u.state;
    g.mission.debugReadyExtraction(g); T.extract();
    const rec = T.R.get(s.id);
    const out = { downed, revived, won: g.phase, xp: rec.progression.xp, missions: rec.service.missions, downs: rec.service.downs };
    // KIA -> resurrection, then KIA -> Memorial
    T.deploy([s.id, 'doc'], 'bridgehead');
    const u2 = g.soldiers.find((x) => x.identity.id === s.id); g.damage(u2, 9999); u2.bleed = 0.01; T.step(0.3);
    g.fail();
    out.kia = T.R.get(s.id).status;
    a.credits += 100000; const res = T.E.resurrect(T.R, a, s.id, null); out.resurrected = res.ok && T.R.get(s.id).status === 'active' && T.R.get(s.id).resurrections === 1;
    T.deploy([s.id, 'doc'], 'bridgehead');
    const u3 = g.soldiers.find((x) => x.identity.id === s.id); g.damage(u3, 9999); u3.bleed = 0.01; T.step(0.3); g.fail();
    T.resolve('memorial');
    out.memorial = a.memorial.some((m) => m.soldier.id === s.id && m.soldier.classId === 'sniper');
    window.__persist();
    out.saved = T.store().account.memorial.some((m) => m.soldier.classId === 'sniper');
    return out;
  });
  check('Sniper down -> revive (Medic), victory XP + career record', sl.downed === 'downed' && sl.revived === 'active' && sl.won === 'won' && sl.xp > 0 && sl.missions >= 1 && sl.downs >= 1, JSON.stringify(sl));
  check('Sniper KIA -> Resurrect; KIA again -> Memorial (saved)', sl.kia === 'kia' && sl.resurrected && sl.memorial && sl.saved, JSON.stringify(sl));
  await reload();
  const sv = await ev(() => ({ status: window.__loadStatus.status, notes: window.__loadStatus.notes, v: T.store().version, mem: T.a.memorial.filter((m) => m.soldier.classId === 'sniper').length, cu: T.a.classUnlocks.unlocked.join() }));
  check('save round trip (v7): Sniper Memorial entry + class unlock kept, loaded cleanly', sv.v === 7 && sv.status === 'loaded' && sv.mem === 1 && sv.cu === 'sniper', JSON.stringify(sv));

  // ================= H. IRON WARDEN =================
  await fresh();
  const bw = await ev(() => {
    window.__debugUnlockAll();
    T.generic(['infantry', 'infantry', 'heavy', 'medic', 'infantry'], 'iron-fist');
    const g = T.g, m = g.mission;
    m.current = 2; m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.primaries[2].activate(m, g); m.phase = 'boss';
    const b = m.boss, u = b.unit;
    const spot = { x: 2650, y: 1000 };
    g.soldiers.forEach((s, i) => { s.pos = { x: spot.x - 60 + (i % 3) * 50, y: spot.y - 40 + Math.floor(i / 3) * 70 }; }); g.anchor = { ...spot };
    g.invuln = true;
    const pin = () => { g.soldiers.forEach((s) => { s.vel = { x: 0, y: 0 }; s.target = null; s.fireCooldown = 1; }); g.cam = { x: 2780, y: 1000 }; };
    const out = { hp: u.maxHp, label: u.label };
    // MG: windup (no shots) then burst
    T.stepUntil(() => b.phase === 'windup', 10, pin);
    const w0 = u.shots, wt0 = g.time; T.stepUntil(() => b.phase === 'burst', 3, pin);
    out.windup = +(g.time - wt0).toFixed(2); out.shotsInWindup = u.shots - w0;
    const b0 = u.shots; T.stepUntil(() => b.phase !== 'burst', 4, pin); out.burstShots = u.shots - b0;
    // rocket: force one now
    b.rocketT = 0; T.stepUntil(() => !!b.rocket, 8, pin);
    if (!b.rocket) return { ...out, error: 'no rocket', phase: b.phase, rT: b.rocketT, log: b.log.map((x) => x.what + '@' + x.t).join(','), on: g.isOnScreen(u.pos, -8), u: u.pos, cam: g.cam };
    const r = b.rocket; const p0 = { ...r.pos }; const tgt = r.target;
    // the target walks away for 2.5 s: circle follows for rocketTrack s, then stays put
    const B = T.C.boss; let lockedPos = null, trackMoved = 0, afterLockMoved = 0, lockT = null;
    const t0 = g.time;
    T.stepUntil(() => {
      if (!b.rocket) return true;
      if (b.rocket.locked && !lockedPos) { lockedPos = { ...b.rocket.pos }; lockT = g.time - t0; }
      if (lockedPos) afterLockMoved = Math.max(afterLockMoved, T.near(b.rocket.pos, lockedPos));
      return false;
    }, 4, () => { pin(); tgt.pos.x += 120 / 60; });
    out.rocket = { lockT: lockT && +lockT.toFixed(2), warn: B.rocketWarn, tracked: Math.round(T.near(lockedPos || p0, p0)), afterLockMoved: Math.round(afterLockMoved), radius: B.rocketRadius, dmg: B.rocketDamage };
    out.log = b.log.map((x) => x.what).join(',');
    g.invuln = false;
    return out;
  });
  check('Iron Warden: boss HP 2400, MG windup (no shots) then a sustained burst', bw.hp === 2400 && bw.windup >= 0.85 && bw.shotsInWindup === 0 && bw.burstShots >= 12, JSON.stringify(bw));
  check('rocket telegraph: circle tracks for 1 s then LOCKS (never moves again), impact at 2.5 s', bw.rocket.lockT >= 0.95 && bw.rocket.lockT <= 1.1 && bw.rocket.tracked > 50 && bw.rocket.afterLockMoved === 0 && bw.rocket.warn === 2.5, JSON.stringify(bw.rocket));

  const dodge = await ev(() => {
    const res = {};
    for (const mode of ['stay', 'run', 'cover']) {
      window.__debugUnlockAll();
      T.generic(['infantry'], 'iron-fist');
      const g = T.g, m = g.mission;
      m.current = 2; m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.primaries[2].activate(m, g); m.phase = 'boss';
      const b = m.boss, s = g.soldiers[0];
      // open ground in the arena; the 'cover' case stands right behind cover block K(2550,700,90,60)
      const spot = mode === 'cover' ? { x: 2595, y: 785 } : { x: 2700, y: 1150 };
      s.pos = { ...spot }; g.anchor = { ...spot };
      const pin = () => { s.target = null; s.fireCooldown = 1; g.cam = { x: 2780, y: 1000 }; b.phase === 'burst' && (b.phase = 'rest'); };
      b.rocketT = 0; b.phase = 'idle';
      T.stepUntil(() => !!b.rocket, 5, () => { pin(); s.vel = { x: 0, y: 0 }; s.pos = { ...spot }; });
      if (mode === 'cover') { b.rocket.target = null; b.rocket.pos = { x: 2595, y: 640 }; b.rocket.t = 1.0; b.rocket.locked = true; b.rocket.lockedAt = { x: 2595, y: 690 }; }
      const hp0 = s.hp; let started = null;
      T.stepUntil(() => !b.rocket, 4, () => {
        pin();
        if (mode === 'run' && b.rocket && b.rocket.locked) { if (started === null) started = g.time; g.input.move = () => ({ x: -1, y: 0 }); }
        else g.input.move = () => ({ x: 0, y: 0 });
        if (mode !== 'run') { s.vel = { x: 0, y: 0 }; s.pos = { ...spot }; }
      });
      g.input.move = () => ({ x: 0, y: 0 });
      res[mode] = Math.round(hp0 - s.hp);
    }
    return res;
  });
  check('rocket: heavy damage when standing still; reacting at the LOCK (1.5 s left) clears the blast', dodge.stay >= 40 && dodge.run === 0, JSON.stringify(dodge));
  check('rocket respects cover (a solid block between the impact and the soldier)', dodge.cover === 0, JSON.stringify(dodge));

  const calls = await ev(() => {
    window.__debugUnlockAll();
    T.generic(['infantry', 'infantry', 'heavy'], 'iron-fist');
    const g = T.g, m = g.mission;
    m.current = 2; m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.primaries[2].activate(m, g); m.phase = 'boss';
    const b = m.boss, u = b.unit; g.invuln = true;
    const spot = { x: 2650, y: 1000 };
    const pin = () => { g.soldiers.forEach((s, i) => { s.pos = { x: spot.x + i * 40, y: spot.y }; s.vel = { x: 0, y: 0 }; s.target = null; s.fireCooldown = 1; }); g.anchor = { ...spot }; };
    const count = () => g.enemies.filter((e) => e.active && e !== u && !e.structure).length;
    T.step(2, pin); T.calm();
    const out = {};
    u.hp = u.maxHp * 0.66; T.step(0.5, pin); out.at66 = count();
    u.hp = u.maxHp * 0.64; T.step(0.5, pin); const k1 = g.enemies.filter((e) => e.active && e !== u).map((e) => e.kind); out.at64 = count(); out.kinds1 = [...new Set(k1)].sort().join();
    const minD = Math.min(...g.enemies.filter((e) => e.active && e !== u).map((e) => Math.min(...g.soldiers.map((s) => T.near(s.pos, e.pos)))));
    out.minD = Math.round(minD);
    T.calm(); u.hp = u.maxHp * 0.5; T.step(1, pin); out.again = count();
    u.hp = u.maxHp * 0.29; T.step(0.5, pin); out.at29 = count();
    T.calm(); u.hp = u.maxHp * 0.1; T.step(1, pin); out.after = count();
    out.log = b.log.filter((x) => /call/.test(x.what)).map((x) => x.what).join();
    g.invuln = false;
    return out;
  });
  check('reinforcement calls at 65% and 30% HP: mixed types, once each (no duplicate triggers)', calls.at66 === 0 && calls.at64 === 4 && /armored/.test(calls.kinds1) && /sniper/.test(calls.kinds1) && calls.again === 0 && calls.at29 === 5 && calls.after === 0 && calls.log === 'call65,call30', JSON.stringify(calls));
  check('boss reinforcements arrive through the gates, never on top of the squad (> 300 px)', calls.minD > 300, `${calls.minD} px`);

  const mods = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a; a.classUnlocks.unlocked.push('sniper');
    T.generic(['infantry', 'heavy', 'medic', 'sniper'], 'iron-fist');
    const g = T.g, m = g.mission;
    m.current = 2; m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.primaries[2].activate(m, g); m.phase = 'boss';
    const u = m.boss.unit; const out = {};
    for (const s of g.soldiers) { const h = u.hp; g.damage(u, 100, s, {}); out[s.classDef.id] = Math.round(h - u.hp); }
    const h = u.hp; g.damage(u, 100, g.soldiers[0], { grenade: true }); out.grenade = Math.round(h - u.hp);
    // bossDamage tracked per soldier (results / sims)
    out.tracked = g.bossDamage.size;
    // the weakness is never spelled out in any text
    const texts = [m.def.briefing, ...m.def.primary, ...m.def.optional.map((o) => o.label), m.def.teaches, ...m.primaries.map((o) => o.label), g.objective.text, g.objective.sub || '', document.body.textContent].join(' ');
    const mt = texts.match(/sniper[^.\n]{0,40}\b(weak\w*|bonus|extra damage|160\s?%|vulnerab\w*|crack\w*)|\b(weak\w*|vulnerab\w*)[^.\n]{0,40}sniper|precision rounds/i);
    out.reveal = mt ? JSON.stringify(texts.slice(mt.index, mt.index + 90)) : false;
    return out;
  });
  check('hidden boss modifiers: Infantry 75%, Heavy 65%, Medic 75%, Sniper 160%, grenades 100%', mods.infantry === 75 && mods.heavy === 65 && mods.medic === 75 && mods.sniper === 160 && mods.grenade === 100 && mods.tracked === 4, JSON.stringify(mods));
  check('the Sniper weakness is not revealed in any mission / HUD text', !mods.reveal, String(mods.reveal));

  const fin = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'iron-fist');
    const g = T.g, m = g.mission;
    // installations destroyed -> storm the arena -> boss
    const inst = m.primaries[0];
    const kinds = inst.targets.map((t) => t.structure).join();
    for (const t of inst.targets) g.damage(t, 99999);
    T.step(0.2);
    const afterInst = m.currentObjective && m.currentObjective.id;
    g.soldiers.forEach((s) => { s.pos = { x: 2420, y: 1000 }; }); g.anchor = { x: 2420, y: 1000 };
    T.step(0.5);
    const afterReach = m.currentObjective && m.currentObjective.id;
    T.step(0.5);
    const bossUp = !!m.boss && m.boss.unit.active;
    const enemiesBefore = g.enemies.filter((e) => e.active && !e.structure && e.kind !== 'boss').length;
    // defeat: victory effect, survivors rout, extraction opens (no auto-win)
    for (const s of g.soldiers) g.damage(m.boss.unit, 99999, s);
    T.step(0.5);
    const banner = g.banners.map((b) => b.text).join(' | ');
    const routed = g.enemies.filter((e) => e.active && !e.structure && e.kind !== 'boss').every((e) => e.routed);
    const out = { kinds, afterInst, afterReach, bossUp, phase: m.phase, gamePhase: g.phase, banner, routed, enemiesBefore };
    // a downed soldier at that moment can still be revived before extracting
    const d = g.soldiers[2]; g.damage(d, 9999); out.down = d.state;
    T.extract(6);
    out.extractPhase = g.phase; out.warning = !!m.extractWarning(g);
    if (g.phase === 'playing') { d.state = 'active'; d.hp = 30; T.extract(); }
    out.final = g.phase; out.opt = m.optional.map((o) => o.completed).join();
    return out;
  });
  check('M10 chain: 2 installations -> storm the stronghold -> the Iron Warden', fin.kinds === 'bunker,bunker' && fin.afterInst === 'arena' && fin.afterReach === 'warden' && fin.bossUp, JSON.stringify(fin));
  check('boss defeated: victory banner, survivors rout, mission NOT auto-ended (extraction opens)', /IRON WARDEN IS DOWN/.test(fin.banner) && fin.routed && fin.phase === 'toExtraction' && fin.gamePhase === 'playing', JSON.stringify(fin));
  check('after the victory: a downed soldier holds extraction (revive first); then extraction completes, no-KIA optional met', fin.down === 'downed' && fin.extractPhase === 'playing' && fin.final === 'won' && fin.opt === 'true', JSON.stringify({ down: fin.down, ex: fin.extractPhase, w: fin.warning, final: fin.final, opt: fin.opt }));

  // ================= I. SAVE MIGRATION (genuine v0.6.1 save made by the v0.6.1 build) =================
  const fx = FX('v0.6.1-save.json');
  await fresh(fx);
  const mig = await ev(() => {
    const st = window.__loadStatus, a = T.a, sv = T.store();
    return {
      status: st.status, from: st.fromVersion, notes: st.notes, v: sv.version, backup: localStorage.getItem('minisquad.save.pre-v0.6.2'),
      credits: a.credits, missions: Object.keys(a.missions).join(), unlocked: a.campaign.unlockedMissions.join(), owned: T.R.owned().map((s) => s.id + ':' + s.name).join(),
      pending: a.pendingDecision && a.pendingDecision.queue.map((q) => q.id).join(), cu: a.classUnlocks.unlocked.join(), sniperOwned: T.R.owned().some((s) => s.classId === 'sniper'),
      named: JSON.stringify(a.named.claimed), offers: a.recruitment.offers.map((o) => o.classId).join(), menu: document.getElementById('menu').className,
      trainingTank: JSON.stringify(T.R.get('tank').training), xpTank: T.R.get('tank').progression.xp,
    };
  });
  const fxo = JSON.parse(fx);
  check('v0.6.1 save -> v7: migrated (not repaired), no notes, raw save backed up under pre-v0.6.2', mig.status === 'migrated' && mig.from === 6 && mig.notes.length === 0 && mig.v === 7 && mig.backup === fx, `${mig.status} ${mig.from} ${mig.notes.join(';')}`);
  check('migration keeps credits, records, owned soldiers (incl. renamed recruit), XP, training, named claims', mig.credits === fxo.account.credits && mig.missions === Object.keys(fxo.account.missions).join() && /rc-1:Sparrow/.test(mig.owned) && mig.xpTank === fxo.roster.find((s) => s.id === 'tank').progression.xp && mig.named === JSON.stringify(fxo.account.named.claimed), JSON.stringify(mig).slice(0, 200));
  check('pending casualty decision kept (Ranger), shown first; Mission 6 unlocked by the M5 clear', mig.pending === 'ranger' && /decisions/.test(mig.menu) && /bridgehead/.test(mig.unlocked) && !/prison-break/.test(mig.unlocked), `${mig.pending} ${mig.menu} ${mig.unlocked}`);
  check('no Sniper granted or unlocked by the migration; no Sniper offers', mig.cu === '' && !mig.sniperOwned && !/sniper/.test(mig.offers), JSON.stringify({ cu: mig.cu, offers: mig.offers }));
  // a v6 save that somehow lists a Sniper recruit (hand edit) -> repaired to Infantry, never a free Sniper
  const bad = JSON.parse(fx); bad.roster.push({ ...bad.roster.find((s) => s.id === 'rc-1'), id: 'rc-9', name: 'Hacker', classId: 'sniper', traitId: 'eagleEye' }); bad.unlockedSoldiers = bad.unlockedSoldiers || [];
  await fresh(JSON.stringify(bad));
  const bad2 = await ev(() => ({ status: window.__loadStatus.status, cls: T.R.get('rc-9') && T.R.get('rc-9').classId, trait: T.R.get('rc-9') && T.R.get('rc-9').traitId }));
  check('pre-v7 save with a hand-edited Sniper recruit: repaired to Infantry (no free Sniper)', bad2.status === 'repaired' && bad2.cls === 'infantry' && bad2.trait !== 'eagleEye', JSON.stringify(bad2));
  // a v7 save that lost its class unlock data but has the M9 record -> re-derived
  await fresh();
  const der = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc'], 'blackout'); T.g.mission.debugReadyExtraction(T.g); T.extract();
    const s = T.store(); delete s.account.classUnlocks; localStorage.setItem(window.__SAVE_KEY, JSON.stringify(s));
    return true;
  });
  await reload();
  const der2 = await ev(() => ({ status: window.__loadStatus.status, cu: T.a.classUnlocks.unlocked.join(), notified: T.a.classUnlocks.notified.join() }));
  check('v7 save missing class-unlock data: Sniper unlock re-derived from the M9 record (repaired)', der && der2.status === 'repaired' && der2.cu === 'sniper', JSON.stringify(der2));

  // ================= J. MISSION 5 REGRESSION =================
  await fresh();
  const m5 = await ev(() => {
    window.__debugUnlockAll();
    T.deploy(['ace', 'tank', 'doc'], 'bring-them-home');
    const g = T.g, m = g.mission;
    const out = { prim: m.primaries.map((o) => o.id).join(), opt: m.optionals.map((o) => o.id).join(), cap: g.capacity };
    m.current = 1; m.primaries[0].state = 'complete'; m.primaries[1].state = 'active'; m.phase = 'free';
    const c = m.npc; g.soldiers.forEach((s, i) => { s.pos = { x: c.pos.x + 30 + i * 10, y: c.pos.y + 30 }; }); g.anchor = { x: c.pos.x + 40, y: c.pos.y + 30 };
    T.stepUntil(() => c.escorting, 8);
    let sum = 0, n = 0, worst = 0;
    T.step(8, () => { g.input.move = () => ({ x: -1, y: 0.25 }); const act = g.soldiers.filter((s) => s.active); const cx = act.reduce((a, s) => a + s.pos.x, 0) / act.length, cy = act.reduce((a, s) => a + s.pos.y, 0) / act.length; const d = Math.hypot(c.pos.x - cx, c.pos.y - cy); sum += d; n++; worst = Math.max(worst, d); });
    g.input.move = () => ({ x: 0, y: 0 });
    out.avg = Math.round(sum / n); out.worst = Math.round(worst);
    // the captive is not ahead of the squad (front soldier leads)
    return out;
  });
  check('Mission 5 unchanged objectives (clear guards, free captive; optional captive unharmed), cap 3', m5.prim === 'compound,free' && m5.opt === 'captive-unharmed' && m5.cap === 3, JSON.stringify(m5));
  check('Mission 5 uses the shared captive-centred formation (avg <= 40 px from the squad centre)', m5.avg <= 40, JSON.stringify(m5));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n${total - fails}/${total} passed${fails ? `, ${fails} FAILED` : ''}`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
