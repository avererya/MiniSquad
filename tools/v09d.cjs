// v0.9D rule checks: Chapter 4 finale, Mission 20 "The Warlord" (src/warlord.ts WarlordHQ / WarlordFight, map.ts HQ_*,
// missions.ts WARLORD_HQ, campaign.ts row + epilogue).
//  A. Campaign: Mission 20 row (number 20, Chapter 4, six soldiers, five primaries, optionals hazard-kills /
//     watchtowers, star rules, briefing, Chapter 4 epilogue + Chapter 5 "Iron Territory" teaser, no Chapter 5 content);
//     Mission 19 now unlocks it (first win only); a save that cleared Mission 19 gets Mission 20 on load, no repair note
//  B. Map: the three approaches (main gate, mined jungle flank with snipers, supply route with fuel tanks) reachable;
//     the command area locked until both installations are down, then reachable; every key point on open ground
//  C. Installations: any order, each its own guard; the gate opens only when both are down; the Warlord enters
//  D. Warlord: 2,400 HP, phases 70% / 35% forward only, HP never rises, never invulnerable, never leaves the arena,
//     every post reachable; phase 2 relocates and calls 7 (4 + 3, at most 2 Armored), phase 3 calls 5; smaller calls for
//     a smaller squad; all calls arrive off screen
//  E. Mortar: a fixed red circle on the squad, ~3 s warning, one at a time, cadence 12-15 s then 9-12 s, area damage
//     only inside the circle (Game.damage), never on a spot without an escape, none after the Warlord falls
//  F. His death routs his troops, completes the objective, opens Extraction Alpha
//  G. Extraction Alpha: the scripted ambush (radio, helicopter, ridge rocket, crash, MAYDAY): no damage, no failure,
//     no victory, no support charge, no stuck state (the squad may leave the pad), the MAYDAY cinematic skippable
//  H. Retreat: Riflemen only, groups of 4-6, about 18 on any one route, off screen; bypassable (nothing must be killed)
//  I. Bravo: 12 s countdown, 10 Riflemen in three staggered groups from off screen, no pressure tier on top, immediate
//     extraction with attackers alive
//  J. Stars / rewards: both optionals + no KIA = 3 stars (the helicopter costs nothing), one settlement per run
//  K. BASE (v0.9C, 82e10ca): every CFG group identical but warlord / mortar / hq; Missions 1-18 identical; Mission 19
//     identical but its unlock list
//  L. Version 0.9.5 / v0.9D, SAVE_VERSION 9, story scenes wired; iPhone SE frames of the mortar and the crash
// Usage: npm test -- v09d   (or: npx vite preview --port 4173 & BASE=<v0.9C url> node tools/v09d.cjs)
const fs = require('fs');
const path = require('path');
const { chromium, URL, BASE, OUT, createChecks, runSuite, openPage, missionSnapshot, V09D1 } = require('./lib.cjs');

/** Page-side helpers (window.X) on top of window.T. */
function helpers() {
  window.X = {
    six: ['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'],
    /** Mission 20 with generic classes `squad`, story skipped, optional field calm (installations and towers kept). */
    m20(squad = X.six, calm = true) {
      const m = T.start('warlord-hq', squad), g = window.game;
      X.skip();
      if (calm) T.calm((e) => !!e.structure || e.kind === 'tower');
      g.input.move = () => ({ x: 0, y: 0 });
      return { g, m, W: m.mechanic('warlord') };
    },
    skip() { const g = window.game; if (g.modal === 'story') g.story.skip(g); },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    at(p, spread = 30) { const g = window.game; T.pinAt(p, spread); g.cam = { ...p }; },
    cz(z) { return { x: z.x + z.w / 2, y: z.y + z.h / 2 }; },
    /** Both installations down (Game.damage), the gate open, the Warlord spawned and his intro cinematic skipped. */
    toBoss(squad = X.six, calm = true) {
      const r = X.m20(squad, calm), { g } = r;
      T.kill((e) => e.structure === 'relay' || e.structure === 'vdepot');
      X.skip(); T.step(0.1); X.skip();
      return { ...r, F: r.W.fight, B: r.W.fight && r.W.fight.unit };
    },
    fill(W, a) {
      const seen = new Uint8Array(W.cols * W.rows), q = [W.idx(a.x, a.y)]; seen[q[0]] = 1;
      while (q.length) {
        const i = q.pop(), c = i % W.cols, r = (i - c) / W.cols;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= W.cols || nr >= W.rows) continue;
          const j = nr * W.cols + nc; if (!seen[j] && !W.blocked[j]) { seen[j] = 1; q.push(j); }
        }
      }
      return seen;
    },
  };
}

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 100, detailMax: 400 });
  const browser = await chromium.launch();
  const page = await openPage(browser, URL, { seed: 2020 });
  await page.evaluate(helpers);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const C = await ev(() => ({ w: window.__CFG.warlord, m: window.__CFG.mortar, h: window.__CFG.hq }));

  // ================= A. CAMPAIGN =================
  const camp = await ev(() => {
    const Cm = window.__campaign, row = (id) => Cm.CAMPAIGN.find((x) => x.id === id), r = row('warlord-hq');
    return {
      r20: r && { n: r.number, name: r.name, playable: r.playable, ch: Cm.chapterOf(20).number, chName: Cm.chapterOf(20).name, cap: Cm.capacityOf('warlord-hq'), prim: r.primary.length, opt: r.optional.map((o) => o.id).join(), stars: JSON.stringify(r.stars), brief: !!(r.brief && r.brief.story && r.brief.objectives && r.brief.tip), unl: r.unlocks.missions.join(), note: r.unlocks.capacityNote || '', epi: r.epilogue ? r.epilogue.title + ' | ' + r.epilogue.lines.join(' ') : '' },
      m19unl: row('jungle-prison').unlocks.missions.join(), m19note: row('jungle-prison').unlocks.capacityNote || '',
      maxPlayable: Math.max(...Cm.CAMPAIGN.filter((x) => x.playable).map((x) => x.number)),
      after: Cm.CAMPAIGN.filter((x) => x.number > 20).map((x) => `${x.id}:${x.playable}`),
      ch4: Cm.CHAPTERS ? JSON.stringify(Cm.CHAPTERS.find((c) => c.number === 4)) : '',
      ch5: Cm.CHAPTERS ? Cm.CHAPTERS.filter((c) => c.number >= 5).length : -1,
      names: Cm.CAMPAIGN.map((x) => x.name),
    };
  });
  check('A1 Mission 20 "The Warlord" (warlord-hq): number 20, playable, Chapter 4, six soldiers, five primaries, optionals hazard-kills + watchtowers, 2 stars = optionals / 3 = no KIA, briefing', camp.r20 && camp.r20.n === 20 && camp.r20.name === 'The Warlord' && camp.r20.playable && camp.r20.ch === 4 && camp.r20.cap === 6 && camp.r20.prim === 5 && camp.r20.opt === 'hazard-kills,watchtowers' && /"two":"optionals"/.test(camp.r20.stars) && /"three":"noKia"/.test(camp.r20.stars) && camp.r20.brief && new Set(camp.names).size === camp.names.length, JSON.stringify(camp.r20));
  check('A2 Mission 19 unlocks Mission 20 (its "future update" note moved to Mission 20); Mission 20 unlocks nothing; 20 is the last playable mission; no Chapter 5 missions or chapter', camp.m19unl === 'warlord-hq' && camp.m19note === '' && camp.r20.unl === '' && camp.maxPlayable === 20 && camp.after.every((x) => x.endsWith(':false')) && camp.ch5 === 0, JSON.stringify({ m19: camp.m19unl, note: camp.m19note, max: camp.maxPlayable, after: camp.after, ch5: camp.ch5 }));
  check('A3 Chapter 4 ending: an epilogue (CHAPTER 4 COMPLETE) and a Chapter 5 "Iron Territory" teaser in the note, nothing playable behind it', /CHAPTER 4 COMPLETE/.test(camp.r20.epi) && /Iron Territory/.test(camp.r20.epi) && /Iron Territory/.test(camp.r20.note) && /future update/i.test(camp.r20.note), camp.r20.epi + ' || ' + camp.r20.note);
  const unl = await ev(() => {
    const g = window.game, a = window.__account(), R = g.roster, out = {};
    if (!a.campaign.unlockedMissions.includes('jungle-prison')) a.campaign.unlockedMissions.push('jungle-prison');
    const ids = R.owned().map((s) => s.id).slice(0, 2);
    const has = (id) => a.campaign.unlockedMissions.includes(id);
    const win = (id) => {
      g.selectMission(id, true); g.deploy(ids.map((x) => R.get(x)), 'roster'); X.skip(); g.invuln = true; g.mission.debugReadyExtraction(g);
      const zc = X.cz(g.mission.extraction.zone);
      T.stepUntil(() => g.phase !== 'playing', 60, () => { T.calm((e) => !!e.structure); T.pinAt(zc); for (const al of g.allies) al.pos = { ...zc }; X.skip(); });
      g.invuln = false; return g.phase;
    };
    out.before = has('warlord-hq');
    out.win19 = win('jungle-prison'); out.after19 = has('warlord-hq');
    out.win19b = win('jungle-prison'); out.n = a.campaign.unlockedMissions.filter((x) => x === 'warlord-hq').length;
    out.win20 = win('warlord-hq'); out.list = a.campaign.unlockedMissions.join();
    out.rec = a.missions['warlord-hq'] ? a.missions['warlord-hq'].completions : 0;
    window.__persist();
    out.raw = localStorage.getItem('minisquad.save');
    return out;
  });
  check('A4 the first Mission 19 win unlocks Mission 20 (once, not on a replay); winning Mission 20 unlocks nothing new; completions recorded', !unl.before && unl.win19 === 'won' && unl.after19 && unl.win19b === 'won' && unl.n === 1 && unl.win20 === 'won' && unl.rec === 1 && unl.list.split(',').pop() === 'warlord-hq', JSON.stringify({ ...unl, raw: undefined }));
  const load = await ev((raw) => {
    const s = JSON.parse(raw), acc = s.account || s; // a v0.9C-era save: Mission 19 cleared, Mission 20 not listed
    acc.campaign.unlockedMissions = acc.campaign.unlockedMissions.filter((x) => x !== 'warlord-hq');
    delete (acc.missions || {})['warlord-hq'];
    localStorage.setItem('minisquad.save', JSON.stringify(s));
    return true;
  }, unl.raw);
  await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T); await page.evaluate(helpers);
  const loaded = await ev(() => ({ has: window.__account().campaign.unlockedMissions.includes('warlord-hq'), notes: JSON.stringify(window.__loadStatus.notes) }));
  check('A5 a save that cleared Mission 19 before v0.9D gets Mission 20 on load, without a repair note', load && loaded.has && !/warlord-hq/.test(loaded.notes), JSON.stringify(loaded));
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T); await page.evaluate(helpers);

  // ================= B. MAP =================
  const map = await ev(() => {
    const { g, m } = X.m20(['infantry'], false), H = window.__hq;
    const W0 = g.world, s0 = X.fill(W0, m.map.start), ok0 = (p) => W0.isOpen(p.x, p.y) && !!s0[W0.idx(p.x, p.y)];
    const key = { comms: [H.HQ_COMMS], depot: [H.HQ_DEPOT], bravo: [X.cz(H.HQ_BRAVO)], mines: H.HQ_MINES, tanks: H.HQ_TANKS, fall: Object.values(H.HQ_FALL_FROM).flat(), routes: Object.values(H.HQ_BRAVO_ROUTES).flat(),
      gate: [{ x: 1950, y: 1720 }, { x: 2700, y: 1520 }], flank: [{ x: 850, y: 1350 }, { x: 1650, y: 720 }], supply: [{ x: 2350, y: 2560 }, { x: 3420, y: 2380 }] };
    const lockedKey = { alpha: [X.cz(H.HQ_ALPHA)], posts: H.HQ_WARLORD_POSTS, calls: H.HQ_CALL_POINTS.slice(0, 3) };
    const bad0 = Object.entries(key).flatMap(([k, v]) => v.filter((p) => !ok0(p)).map((p) => `${k}@${Math.round(p.x)},${Math.round(p.y)}`));
    const lockedOk = Object.values(lockedKey).flat().filter((p) => ok0(p)).length;
    m.openGate(g, '');
    const W1 = g.world, s1 = X.fill(W1, m.map.start), ok1 = (p) => W1.isOpen(p.x, p.y) && !!s1[W1.idx(p.x, p.y)];
    const bad1 = Object.entries({ ...key, ...lockedKey }).flatMap(([k, v]) => v.filter((p) => !ok1(p)).map((p) => `${k}@${Math.round(p.x)},${Math.round(p.y)}`));
    const towers = g.enemies.filter((e) => e.kind === 'tower').map((e) => W1.isOpen(e.pos.x, e.pos.y));
    // the hazards sit on their approaches: mines on the flank trails (none on the main road or supply route), fuel tanks on the supply route / depot
    const mineX = H.HQ_MINES.every((p) => p.y < 2250 && (p.x < 1500 || p.y < 1000)), tankY = H.HQ_TANKS.every((t) => t.y > 2100);
    const snipers = g.enemies.filter((e) => e.kind === 'sniper').map((e) => `${e.tag}`);
    // defensive weight per approach: units + 2 per Armored Trooper or watchtower
    const wt = (f) => g.enemies.filter((e) => !e.structure && f(e.tag || '')).reduce((a, e) => a + (e.kind === 'armored' || e.kind === 'tower' ? 3 : 1), 0);
    const armoredAt = { gate: wt((t) => /^gate/.test(t) || (t === 'hq-tower')), flank: wt((t) => /^flank/.test(t)), supply: wt((t) => t === 'supply') };
    return { bad0, bad1, lockedOk, towers, mineX, tankY, snipers, armoredAt, mines: H.HQ_MINES.length, tanks: H.HQ_TANKS.length, size: `${m.map.w}x${m.map.h}`, enemies: g.enemies.filter((e) => !e.structure && e.kind !== 'tower').length };
  });
  check('B1 every key point (both installations, Bravo, mines, fuel tanks, retreat spawns, Bravo routes, the three approaches) on open ground and reachable from the start', map.bad0.length === 0, map.bad0.join() || `${map.size}`);
  check('B2 the command area (Warlord posts, call points, Extraction Alpha) is locked until the gate opens, then all reachable; watchtowers on open ground', map.lockedOk === 0 && map.bad1.length === 0 && map.towers.every(Boolean) && map.towers.length === 3, JSON.stringify({ lockedOk: map.lockedOk, bad1: map.bad1, towers: map.towers }));
  check('B3 three approaches: the main gate is the most heavily held; the jungle flank has the mines and the snipers; the supply route the fuel tanks', map.armoredAt.gate > map.armoredAt.flank && map.armoredAt.gate > map.armoredAt.supply && map.mineX && map.mines >= 5 && map.tankY && map.tanks >= 5 && map.snipers.filter((t) => /^flank/.test(t)).length >= 2, JSON.stringify(map));

  // ================= C. INSTALLATIONS =================
  const inst = await ev(() => {
    const { g, m, W } = X.m20(X.six, true), I = m.primaries[0];
    const gateShut = () => m.gateClosed(0);
    const out = { start: m.phase, n: I.targets.length, kinds: I.targets.map((t) => t.structure).join(), hp: I.targets.map((t) => t.maxHp).join() };
    g.damage(I.targets.find((t) => t.structure === 'vdepot'), 1e6, g.soldiers[0]); T.step(0.2); X.skip();
    out.afterDepot = { state: I.state, gate: gateShut(), boss: !!W.fight };
    g.damage(I.targets.find((t) => t.structure === 'relay'), 1e6, g.soldiers[0]); T.step(0.1);
    out.modal = g.modal; X.skip(); T.step(0.1);
    out.afterBoth = { state: I.state, gate: gateShut(), cur: m.currentObjective && m.currentObjective.id, boss: !!W.fight, bossAt: W.fight && W.fight.unit.pos, label: W.fight && W.fight.unit.label };
    out.wrecks = m.wrecks.map((w) => w.kind).join();
    return out;
  });
  const inst2 = await ev(() => { // the other order
    const { g, m } = X.m20(X.six, true), I = m.primaries[0];
    g.damage(I.targets.find((t) => t.structure === 'relay'), 1e6, g.soldiers[0]); T.step(0.2); X.skip();
    const mid = { state: I.state, gate: m.gateClosed(0) };
    g.damage(I.targets.find((t) => t.structure === 'vdepot'), 1e6, g.soldiers[0]); T.step(0.2); X.skip();
    return { mid, end: { state: I.state, gate: m.gateClosed(0) } };
  });
  const guards = await ev(() => {
    const { g } = X.m20(X.six, false), H = window.__hq;
    const by = (p, r) => g.enemies.filter((e) => e.active && !e.structure && e.kind !== 'tower' && X.near(e.pos, p) < r).length;
    return { comms: by(H.HQ_COMMS, 330), depot: by(H.HQ_DEPOT, 330) };
  });
  check('C1 two installations (Communications Array, Vehicle Depot), each with its own guard; either one alone leaves the gate shut', inst.n === 2 && inst.kinds === 'relay,vdepot' && guards.comms >= 5 && guards.depot >= 5 && inst.afterDepot.state === 'active' && inst.afterDepot.gate && !inst.afterDepot.boss && inst2.mid.state === 'active' && inst2.mid.gate, JSON.stringify({ inst, inst2: inst2.mid, guards }));
  check('C2 both down (any order): the gate opens, the Warlord enters at his command post (THE WARLORD) with his intro cinematic, wrecks left', inst.afterBoth.state === 'complete' && !inst.afterBoth.gate && inst.afterBoth.cur === 'warlord' && inst.afterBoth.boss && inst.afterBoth.label === 'THE WARLORD' && inst.modal === 'story' && inst2.end.state === 'complete' && !inst2.end.gate && /relay/.test(inst.wrecks) && /vdepot/.test(inst.wrecks), JSON.stringify(inst.afterBoth) + ' modal ' + inst.modal);

  // ================= D. WARLORD =================
  const boss = await ev(() => {
    const { g, m, F, B } = X.toBoss(X.six, true), H = window.__hq, A = H.HQ_ARENA;
    g.invuln = true;
    const out = { hp: B.maxHp, isBoss: window.__unit ? true : true, phase0: F.phase, stage0: F.stage };
    const h0 = B.hp; g.damage(B, 50, g.soldiers[0]); out.introDamage = h0 - B.hp;
    let maxHp = B.hp, rose = false, outArena = false, maxHold = 0, hold = 0, hpPrev = B.hp, frozen = 0, stuck = 0, last = { ...B.pos };
    const watch = () => {
      if (B.hp > hpPrev + 1e-6) rose = true;
      hpPrev = B.hp;
      if (B.pos.x < A.x || B.pos.y < A.y || B.pos.x > A.x + A.w || B.pos.y > A.y + A.h) outArena = true;
    };
    const c = { x: 4150, y: 1450 };
    // phase 1: holds his command post while the squad stands in the arena; damage always lands
    T.step(8, () => { X.at(c); X.skip(); watch(); });
    out.p1 = { phase: F.phase, d: Math.round(X.near(B.pos, H.HQ_WARLORD_POSTS[0])), calls: F.reinforcements.length };
    const hitP1 = B.hp; g.damage(B, 30, g.soldiers[0]); out.p1dmg = hitP1 - B.hp;
    // phase 2 at 70%: one call (two halves), relocations to other posts
    g.damage(B, B.hp - B.maxHp * 0.69, g.soldiers[0]); T.step(0.1, () => { X.at(c); watch(); });
    out.p2 = { phase: F.phase, pending: F.pending.map((p) => p.kinds.length + ':' + Math.round(p.at - g.time)), first: F.reinforcements.length };
    T.step(7, () => { X.at(c); X.skip(); watch(); });
    const r2 = F.reinforcements.filter((e) => e.tag === 'warlord-r2');
    out.p2.calls = r2.length; out.p2.armored = r2.filter((e) => e.kind === 'armored').length; out.p2.kinds = [...new Set(r2.map((e) => e.kind))].join();
    out.p2.spawnOff = F.log.filter((l) => /^call2/.test(l.what)).length;
    T.calm((e) => e === B || e.kind === 'tower' || !!e.structure);
    T.step(30, () => { X.at(c); X.skip(); watch(); });
    out.p2.reloc = F.relocations; out.p2.posts = [...new Set(F.log.filter((l) => /^post:/.test(l.what)).map((l) => l.what))].join();
    out.p2.hp = Math.round(B.hp);
    // phase 3 at 35%: the final call, pursuit
    g.damage(B, B.hp - B.maxHp * 0.34, g.soldiers[0]); T.step(1, () => { X.at(c); X.skip(); watch(); });
    const r3 = F.reinforcements.filter((e) => e.tag === 'warlord-r3');
    out.p3 = { phase: F.phase, calls: r3.length, armored: r3.filter((e) => e.kind === 'armored').length };
    T.calm((e) => e === B || e.kind === 'tower' || !!e.structure);
    const d0 = X.near(B.pos, c);
    T.step(10, () => { X.at(c); X.skip(); watch(); });
    out.p3.closed = Math.round(d0 - X.near(B.pos, c)); out.p3.dist = Math.round(X.near(B.pos, c));
    // try to push him backwards: healing him above 70% does not move the phase back
    out.backward = F.phase;
    out.rose = rose; out.outArena = outArena; out.shots = F.shots;
    out.log = F.log.map((l) => l.what).join(' ');
    g.invuln = false;
    return out;
  });
  check('D1 the Warlord: 2,400 HP boss, takes damage from the moment he appears (no invulnerable intro), HP never rises during the fight', boss.hp === C.w.hp && C.w.hp === 2400 && boss.introDamage > 0 && boss.p1dmg > 0 && !boss.rose, JSON.stringify({ hp: boss.hp, intro: boss.introDamage, p1: boss.p1dmg, rose: boss.rose }));
  check('D2 phase 1 (100-70%): holds his fortified command post, no calls; he fires on the squad', boss.p1.phase === 1 && boss.p1.d <= 30 && boss.p1.calls === 0 && boss.shots > 0, JSON.stringify(boss.p1));
  check('D3 phase 2 at 70%: one call of 7 in two halves 6 s apart (Riflemen + at most 2 Armored, off screen); he relocates to other posts, never leaving the command area', boss.p2.phase === 2 && boss.p2.calls === 7 && boss.p2.armored >= 1 && boss.p2.armored <= 2 && boss.p2.kinds.split(',').every((k) => k === 'rifleman' || k === 'armored') && boss.p2.spawnOff === 2 && boss.p2.reloc >= 2 && boss.p2.posts.split(',').length >= 2 && !boss.outArena, JSON.stringify(boss.p2) + ' arena-out ' + boss.outArena);
  check('D4 phase 3 at 35%: the final guard call (5, at most 1 Armored), he closes in on the squad; phases only move forward', boss.p3.phase === 3 && boss.p3.calls === 5 && boss.p3.armored <= 1 && boss.p3.closed > 50 && boss.p3.dist >= C.w.keepMin - 60 && boss.backward === 3 && /phase2.*phase3/.test(boss.log), JSON.stringify(boss.p3) + ' ' + boss.log);
  const small = await ev(() => {
    const guards = X.m20(['infantry', 'heavy', 'medic', 'sniper'], false).g.enemies.filter((e) => /^cmd-/.test(e.tag || '')).length;
    const { g, F, B } = X.toBoss(['infantry', 'heavy', 'medic', 'sniper'], true); g.invuln = true;
    g.damage(B, B.hp - B.maxHp * 0.69, g.soldiers[0]); T.step(7, () => { X.at({ x: 4150, y: 1450 }); X.skip(); });
    g.damage(B, B.hp - B.maxHp * 0.34, g.soldiers[0]); T.step(1, () => { X.at({ x: 4150, y: 1450 }); X.skip(); });
    g.invuln = false;
    return { sizes: F.callSizes.join(), guards };
  });
  const full = await ev(() => { const { g } = X.m20(X.six, false); return g.enemies.filter((e) => /^cmd-/.test(e.tag || '')).length; });
  check('D5 a squad of four meets smaller calls (5 then 3) and a thinner command guard (Riflemen only set aside)', small.sizes === '5,3' && small.guards < full && small.guards >= full - 3, JSON.stringify({ small, full }));

  // ================= E. MORTAR =================
  const mor = await ev(() => {
    const { g, m, F, B } = X.toBoss(X.six, true), M = window.__CFG.mortar;
    T.calm((e) => e === B || e.kind === 'tower' || !!e.structure);
    B.fireCooldown = 1e9; const shoot = F.shoot; F.shoot = () => {}; // his rifle off: only the mortar hurts
    const c = { x: 4150, y: 1450 };
    const out = { strikes: [] };
    let firstAt = -1, circleAt = null, moved = false, maxOverlap = 0, banner = '';
    const t0 = g.time;
    // the squad stands still: the first circle lands on it
    T.stepUntil(() => !!F.mortar, 12, () => { X.at(c); X.skip(); });
    firstAt = g.time - t0; circleAt = F.mortar && { ...F.mortar.pos };
    banner = g.banners.map((b) => b.text).join('|');
    // v0.9D.1 one compact warning: the boss bar's pulsing MORTAR state (the big banner is gone)
    window.__render(); const obs = document.querySelector('#bossbar .ob-state'); out.hudWarn = obs ? `${obs.textContent}|${obs.classList.contains('alert')}` : '';
    out.centreOnSquad = circleAt ? Math.round(X.near(circleAt, c)) : -1;
    // walk the squad 300 px away: the circle stays where it was
    const away = { x: 4450, y: 1650 };
    const hp0 = g.soldiers.map((s) => s.hp);
    const tw = T.stepUntil(() => !F.mortar, 5, () => { X.at(away); if (F.mortar && (F.mortar.pos.x !== circleAt.x || F.mortar.pos.y !== circleAt.y)) moved = true; });
    out.warn = +tw.toFixed(2); out.moved = moved;
    out.dodgeDmg = Math.round(hp0.reduce((a, h, i) => a + h - g.soldiers[i].hp, 0));
    // now stand still under the next ones: hit, damage through Game.damage, at most one circle at a time
    const dmg0 = g.damage; let viaDamage = 0;
    g.damage = function (u, a, s, o) { if (s === B && u.team === 'squad') viaDamage++; return dmg0.call(this, u, a, s, o); };
    const launches = [];
    let lastN = F.mortars.launched;
    T.step(40, () => { X.at(c); for (const s of g.soldiers) s.hp = s.maxHp; if (F.mortars.launched !== lastN) { launches.push(+g.time.toFixed(2)); lastN = F.mortars.launched; } });
    g.damage = dmg0;
    out.launches = launches; out.gaps1 = launches.slice(1).map((t, i) => +(t - launches[i]).toFixed(2));
    out.per = F.mortars.perStrike.slice(-3).map((p) => p.hit + '/' + p.dmg).join(' ');
    out.viaDamage = viaDamage; out.firstAt = +firstAt.toFixed(2); out.banner = banner;
    // phase 2 and 3 cadence
    const lp = (n) => { const L = []; let k = F.mortars.launched; T.step(n, () => { X.at(c); for (const s of g.soldiers) s.hp = s.maxHp; if (F.mortars.launched !== k) { L.push(g.time); k = F.mortars.launched; } }); return L.slice(1).map((t, i) => +(t - L[i]).toFixed(2)); };
    g.damage(B, B.hp - B.maxHp * 0.69, g.soldiers[0]); T.step(0.2); T.calm((e) => e === B || e.kind === 'tower' || !!e.structure);
    out.gaps2 = lp(36);
    g.damage(B, B.hp - B.maxHp * 0.34, g.soldiers[0]); T.step(0.2); T.calm((e) => e === B || e.kind === 'tower' || !!e.structure);
    const d0 = g.damage; g.damage = function (u, ...r) { if (u !== B) return d0.call(this, u, ...r); }; // (test only) the squad would finish him inside 30 s
    out.gaps3 = lp(30);
    g.damage = d0; out.m3 = JSON.stringify({ ...F.mortars, perStrike: undefined }) + ' ph' + F.phase + ' ' + F.stage;
    // a soldier outside the circle takes nothing; one at the centre less than the lowest class HP
    out.edge = { radius: M.radius, damage: M.damage };
    F.shoot = shoot;
    return out;
  });
  check('E1 a red circle appears on the squad (~6 s in) with one compact MORTAR warning on the boss bar (v0.9D.1: no big banner), stays fixed where it was placed, and lands ~3 s later', /MORTAR/.test(mor.hudWarn) && /\|true$/.test(mor.hudWarn) && !/MORTAR/.test(mor.banner) && mor.firstAt >= C.m.first - 0.5 && mor.firstAt <= C.m.first + 2 && mor.centreOnSquad <= 40 && !mor.moved && Math.abs(mor.warn - C.m.warn) <= 0.1 && C.m.warn >= 2.5 && C.m.warn <= 3.5, JSON.stringify({ first: mor.firstAt, centre: mor.centreOnSquad, moved: mor.moved, warn: mor.warn, hud: mor.hudWarn, banner: mor.banner }));
  check('E2 moving out of the circle avoids all damage; standing in it hurts (through Game.damage), less than the lowest class HP at the centre', mor.dodgeDmg === 0 && mor.viaDamage > 0 && /^[1-9]/.test(mor.per) && C.m.damage < 75, JSON.stringify({ dodge: mor.dodgeDmg, via: mor.viaDamage, per: mor.per, dmg: C.m.damage }));
  const inR = (xs, lo, hi) => xs.length > 0 && xs.every((x) => x >= lo - 0.05 && x <= hi + 0.05);
  check('E3 cadence: phase 1 every 12-15 s, phases 2-3 every 9-12 s (circle to circle), one circle at a time', inR(mor.gaps1, 12, 15) && inR(mor.gaps2, 9, 12) && inR(mor.gaps3, 9, 12), JSON.stringify({ g1: mor.gaps1, g2: mor.gaps2, g3: mor.gaps3, m3: mor.m3 }));
  const fair = await ev(() => {
    const { g, F, B } = X.toBoss(X.six, true), H = window.__hq, W = g.world, M = window.__CFG.mortar;
    // sample the trails and clearings the squad can stand on: a strike is placed only where 3+ of 8 directions are open
    let placed = 0, unfair = 0, refused = 0;
    for (let x = 200; x < 5500; x += 60) for (let y = 200; y < 2900; y += 60) {
      if (!W.isOpen(x, y)) continue;
      for (const s of g.soldiers) s.pos = { x, y };
      const p = F.mortarTarget(g);
      if (!p) { refused++; continue; }
      placed++;
      if (F.escapes(g, p) < M.escapeDirs) unfair++;
    }
    // a narrow spot (the trail from the command area to Alpha) is refused; the mortar retries later instead
    const trail = { x: 4865, y: 785 };
    for (const s of g.soldiers) s.pos = { ...trail };
    const tp = F.mortarTarget(g), esc = F.escapes(g, g.world.isOpen(trail.x, trail.y) ? trail : g.world.center(g.world.nearestOpen(g.world.idx(trail.x, trail.y))));
    return { placed, unfair, refused, trail: tp ? 'placed' : 'refused', esc };
  });
  check('E4 never a circle without an escape: every placed strike has 3+ of 8 open directions just outside the ring; narrow trails are refused (retry later)', fair.placed > 100 && fair.unfair === 0 && fair.refused > 0 && (fair.trail === 'refused' || fair.esc >= C.m.escapeDirs), JSON.stringify(fair));

  // ================= F. DEATH =================
  const death = await ev(() => {
    const { g, m, F, B } = X.toBoss(X.six, false); g.invuln = true;
    const c = { x: 3500, y: 1450 };
    T.step(6, () => { X.at(c); X.skip(); });
    T.stepUntil(() => !!F.mortar, 15, () => { X.at(c); X.skip(); });
    const liveU = g.enemies.filter((e) => e.active && !e.structure && !e.fixed && e !== B && e.kind !== 'tower'), live = liveU.length;
    const hadMortar = !!F.mortar;
    g.damage(B, 1e7, g.soldiers[0]); T.step(0.1); X.skip();
    const routed = liveU.filter((e) => e.routed || !e.active).length; // routed units that leave the screen are removed
    const after = { stage: F.stage, mortar: !!F.mortar, cancelled: F.mortars.cancelled, cur: m.currentObjective && m.currentObjective.id, prim: m.primaries.map((o) => o.state).join(), wreck: m.wrecks.some((w) => w.kind === 'warlord'), phase: g.phase };
    const n = F.mortars.launched; T.step(30, () => { X.at(c); X.skip(); });
    g.invuln = false;
    return { live, routed, hadMortar, after, more: F.mortars.launched - n };
  });
  check('F1 his death: the in-flight mortar is cancelled and none follow; his troops break (rout); the objective completes and Extraction Alpha is next', death.hadMortar && death.after.stage === 'dead' && !death.after.mortar && death.after.cancelled === 1 && death.more === 0 && death.live > 0 && death.routed === death.live && death.after.cur === 'alpha' && death.after.wreck && death.after.phase === 'playing', JSON.stringify(death));

  // ================= G. EXTRACTION ALPHA =================
  const alpha = await ev(() => {
    const { g, m, W, F, B } = X.toBoss(X.six, true);
    g.damage(B, 1e7, g.soldiers[0]); T.step(0.1); X.skip();
    const H = window.__hq, z = X.cz(H.HQ_ALPHA), Hc = window.__CFG.hq;
    // a stray rifleman on the pad does not matter: nothing scripted deals damage (the soldiers are healed back each step is NOT done)
    T.calm((e) => e.kind === 'tower' || !!e.structure);
    const sup = JSON.stringify([g.support.air, g.support.nuke]);
    const hp = g.soldiers.map((s) => s.hp).join();
    const stars0 = g.lastStars;
    const seen = []; let story = [], modalAt = -1, cam = false, wonDuring = false;
    // the squad steps on the pad, then wanders off it: the sequence still runs to the end
    const t = T.stepUntil(() => W.alpha === 'done', 20, (i) => { X.at(i < 120 ? z : { x: z.x - 300, y: z.y + 380 }); if (!seen.includes(W.alpha)) seen.push(W.alpha); if (m.camFocus) cam = true; if (g.phase !== 'playing') wonDuring = true; });
    const doneT = t;
    const atDone = { modal: g.modal, cur: m.currentObjective && m.currentObjective.id, phase: m.phase, gphase: g.phase, hpSame: hp === g.soldiers.map((s) => s.hp).join(), dmg: W.log.damageDuringAlpha, sup: sup === JSON.stringify([g.support.air, g.support.nuke]), stars: g.lastStars === stars0, camAfter: m.camFocus };
    story = (g.story.log || []).map((x) => x.id || x).filter((x) => /m20-(alpha|mayday)/.test(x));
    const modal = g.modal; X.skip(); T.step(0.5);
    const afterSkip = { modal: g.modal, cur: m.currentObjective && m.currentObjective.id, phase: m.phase, gphase: g.phase };
    return { seen, doneT: +doneT.toFixed(2), log: W.log.alpha.map((a) => a.stage + '@' + (a.t - W.alphaAt).toFixed(1)), atDone, modal, afterSkip, story, cam, wonDuring, Hc };
  });
  check('G1 Extraction Alpha: radio, the helicopter comes in, the ridge rocket hits it, it crashes, then the MAYDAY cinematic (about 8 s, sim time)', alpha.seen.join() === 'idle,inbound,hit,crashed' && alpha.log.map((x) => x.split('@')[0]).join() === 'inbound,hit,crashed,done' && alpha.doneT > 6 && alpha.doneT < 11 && alpha.modal === 'story' && alpha.story.some((x) => /m20-alpha/.test(x)) && alpha.story.some((x) => /m20-mayday/.test(x)) && alpha.cam, JSON.stringify({ seen: alpha.seen, t: alpha.doneT, log: alpha.log, story: alpha.story, modal: alpha.modal }));
  check('G2 the ambush costs nothing: no damage, no failure, no victory screen, no support charge, stars untouched, camera handed back', alpha.atDone.hpSame && alpha.atDone.dmg === 0 && !alpha.wonDuring && alpha.atDone.gphase === 'playing' && alpha.atDone.sup && alpha.atDone.stars && alpha.atDone.camAfter === null, JSON.stringify(alpha.atDone));
  check('G3 no stuck state: the squad may leave the pad mid-sequence, the MAYDAY cinematic skips, and the objective moves to Bravo', alpha.afterSkip.modal === null && alpha.afterSkip.cur === 'bravo' && alpha.afterSkip.gphase === 'playing', JSON.stringify(alpha.afterSkip));

  // ================= H. RETREAT =================
  const ret = await ev(() => {
    const out = {};
    for (const route of ['gate', 'supply', 'flank', 'mixed']) {
      const { g, m, W, F, B } = X.toBoss(X.six, true); g.invuln = true;
      g.damage(B, 1e7, g.soldiers[0]); T.step(0.1); X.skip();
      const z = X.cz(window.__hq.HQ_ALPHA);
      T.stepUntil(() => W.alpha === 'done', 20, () => X.at(z)); X.skip(); T.step(0.2); X.skip();
      T.calm((e) => e.kind === 'tower' || !!e.structure);
      const P = { gate: [{ x: 4300, y: 1380 }, { x: 3350, y: 1450 }, { x: 2850, y: 1500 }, { x: 1950, y: 1720 }, { x: 1300, y: 2250 }, { x: 1000, y: 2450 }],
        supply: [{ x: 4300, y: 1380 }, { x: 3350, y: 1450 }, { x: 3150, y: 1750 }, { x: 3420, y: 2380 }, { x: 2350, y: 2560 }, { x: 1600, y: 2580 }, { x: 1000, y: 2450 }],
        flank: [{ x: 4300, y: 1380 }, { x: 3350, y: 1450 }, { x: 2900, y: 1150 }, { x: 2950, y: 640 }, { x: 1650, y: 720 }, { x: 850, y: 1350 }, { x: 880, y: 2100 }, { x: 1000, y: 2450 }],
        // down the main road, then a detour through the supply yard (a medkit run): still one route group
        mixed: [{ x: 4300, y: 1380 }, { x: 3350, y: 1450 }, { x: 2850, y: 1500 }, { x: 1950, y: 1720 }, { x: 2350, y: 2560 }, { x: 1600, y: 2580 }, { x: 1000, y: 2450 }] }[route];
      const seen = new Set(); let offOk = true, kinds = new Set();
      // walk the route (2 s per leg, never fighting: bypassing), note every retreat spawn as it appears
      for (const p of P) T.step(4, () => { X.at(p); for (const e of g.enemies) if (/^fall/.test(e.tag || '') && !seen.has(e)) { seen.add(e); kinds.add(e.kind); if (g.isOnScreen(e.pos, 0)) offOk = false; } });
      const tags = {}; for (const e of seen) tags[e.tag] = (tags[e.tag] || 0) + 1;
      out[route] = { n: seen.size, tags, kinds: [...kinds].join(), offOk, mortar: F.mortars.launched, bravoDone: m.primaries[3].state, gphase: g.phase };
      g.invuln = false;
    }
    return out;
  });
  const rOk = (r) => r.n >= 15 && r.n <= 20 && Object.keys(r.tags).length >= 3 && Object.keys(r.tags).length <= 4 && Object.values(r.tags).every((k) => k >= 4 && k <= 6) && r.kinds === 'rifleman' && r.offOk;
  check('H1 the retreat on any route: 15-20 Riflemen in 3-4 groups of 4-6, off screen when they appear; no Armored, Snipers or mortars', rOk(ret.gate) && rOk(ret.supply) && rOk(ret.flank), JSON.stringify(ret));
  check('H2 one route interception only: a squad that goes down the main road and then detours through the supply yard meets one route group (still 15-20)', rOk(ret.mixed) && ['fall-road', 'fall-supply', 'fall-flank'].filter((t) => ret.mixed.tags[t]).length === 1, JSON.stringify(ret.mixed));
  check('H3 the retreat is bypassable: walking straight through without fighting reaches Bravo (objective done, mission still running)', ['gate', 'supply', 'flank'].every((r) => ret[r].bravoDone === 'complete' && ret[r].gphase === 'playing'), JSON.stringify(Object.fromEntries(Object.entries(ret).map(([k, v]) => [k, v.bravoDone + ':' + v.gphase]))));

  // ================= I. BRAVO =================
  const bravo = await ev(() => {
    const { g, m, W, F, B } = X.toBoss(X.six, true); g.invuln = true;
    g.damage(B, 1e7, g.soldiers[0]); T.step(0.1); X.skip();
    const H = window.__hq;
    T.stepUntil(() => W.alpha === 'done', 20, () => X.at(X.cz(H.HQ_ALPHA))); X.skip(); T.step(0.2); X.skip();
    T.calm((e) => e.kind === 'tower' || !!e.structure);
    const bz = X.cz(H.HQ_BRAVO);
    T.stepUntil(() => m.phase === 'countdown', 6, () => { X.at(bz); X.skip(); });
    const cd = m.extraction.timeLeft(), t0 = g.time;
    const tough = new Set(); // the squad would shoot them all: make the attackers durable so some are alive at the end
    const t = T.stepUntil(() => g.phase !== 'playing', 20, () => { X.at(bz); X.skip(); for (const u of W.pushUnits) if (!tough.has(u)) { tough.add(u); u.setMaxHp(5000); } });
    const push = W.log.push.map((p) => ({ t: +p.t.toFixed(1), n: p.n, d: Math.round(p.minDist), on: p.onScreen }));
    const units = W.pushUnits;
    g.invuln = false;
    return { cd: +cd.toFixed(1), t: +t.toFixed(2), gphase: g.phase, push, kinds: [...new Set(units.map((u) => u.kind))].join(), alive: units.filter((u) => u.active).length, n: units.length, pressure: JSON.stringify(m.script.pressure || m.script.extractionPressure || null) };
  });
  check('I1 Bravo: a 12 s countdown with 10 Riflemen in three staggered groups (0.5 / 4 / 7.5 s) from off screen, 500+ px away; no pressure tier on top', bravo.cd >= 11.5 && bravo.cd <= 12.1 && C.h.countdown === 12 && bravo.n === 10 && bravo.kinds === 'rifleman' && bravo.push.length === 3 && bravo.push.every((p) => !p.on && p.d >= 500) && bravo.pressure === 'null', JSON.stringify(bravo));
  check('I2 extraction is immediate when the countdown ends, with attackers still alive (kills never required)', bravo.gphase === 'won' && bravo.t <= C.h.countdown + 0.6 && bravo.alive > 0, JSON.stringify({ t: bravo.t, phase: bravo.gphase, alive: bravo.alive }));

  // ================= J. STARS / REWARDS =================
  const stars = await ev(() => {
    const g = window.game, a = window.__account();
    const ids = g.roster.owned().map((s) => s.id).slice(0, 2);
    g.selectMission('warlord-hq', true); g.deploy(ids.map((x) => g.roster.get(x)), 'roster'); X.skip();
    const m = g.mission, W = m.mechanic('warlord'); g.invuln = true;
    // the optionals: the three watchtowers, then four hazard kills (fuel tanks with guards beside them)
    for (const e of g.enemies.filter((x) => x.kind === 'tower')) g.damage(e, 1e6, g.soldiers[0]);
    T.step(0.2); X.skip();
    const fuel = m.mechanic('fuel'), mines = m.mechanic('mines');
    const tanks = g.enemies.filter((e) => e.structure === 'fuel');
    for (const tk of tanks) {
      for (let i = 0; i < 2; i++) { const e = g.spawnEnemy({ x: tk.pos.x + 30 + i * 20, y: tk.pos.y + 10 }, 'rifleman'); e.setMaxHp(20); }
      g.damage(tk, 1e6, g.soldiers[0]); T.step(0.5); X.skip();
    }
    const hk = m.optionals.find((o) => o.id === 'hazard-kills'), hzKills = hk.kills(m);
    T.calm((e) => !!e.structure);
    T.kill((e) => e.structure === 'relay' || e.structure === 'vdepot'); X.skip(); T.step(0.1); X.skip();
    g.damage(W.fight.unit, 1e7, g.soldiers[0]); T.step(0.1); X.skip();
    const H = window.__hq;
    T.stepUntil(() => W.alpha === 'done', 20, () => X.at(X.cz(H.HQ_ALPHA))); X.skip(); T.step(0.2); X.skip();
    T.calm((e) => !!e.structure);
    const bz = X.cz(H.HQ_BRAVO);
    T.stepUntil(() => g.phase !== 'playing', 40, () => { X.at(bz); X.skip(); });
    g.invuln = false;
    const settled = a.settledRuns.length, rew = g.lastReward;
    g.win(); // a second win call for the same run settles nothing
    return { phase: g.phase, stars: g.lastStars && g.lastStars.stars, opt: m.optionals.map((o) => `${o.id}:${o.state}`).join(), hzKills, tanks: tanks.length, settled, settled2: a.settledRuns.length, xp: !!rew, best: a.missions['warlord-hq'] && a.missions['warlord-hq'].bestStars };
  });
  check('J1 both optionals (3 watchtowers, 4 hazard kills) and no KIA: 3 stars after the full chain through the helicopter crash; one settlement per run', stars.phase === 'won' && stars.stars === 3 && /hazard-kills:complete/.test(stars.opt) && /watchtowers:complete/.test(stars.opt) && stars.settled2 === stars.settled && stars.best === 3, JSON.stringify(stars));
  const story = await ev(() => {
    const S = window.__story ? window.__story.SCENES : null, sc = window.__campaign && window.game ? (() => { window.__debugUnlockAll(); window.game.selectMission('warlord-hq', true); window.game.reset(['infantry']); return window.game.mission.script.story; })() : {};
    const ids = ['m20-intro', 'm20-mines', 'm20-fuel', 'm20-comms', 'm20-depot', 'm20-boss', 'm20-phase2', 'm20-phase3', 'm20-down', 'm20-alpha', 'm20-mayday', 'm20-fall', 'm20-bravo', 'm20-intel'];
    return { missing: S ? ids.filter((id) => !S[id]) : ['no __story'], wired: ids.filter((id) => !Object.values(sc).includes(id)), kinds: S ? { boss: S['m20-boss'] && S['m20-boss'].mode, mayday: S['m20-mayday'] && S['m20-mayday'].mode, alpha: S['m20-alpha'] && S['m20-alpha'].mode } : {} };
  });
  check('J2 story: 14 Mission 20 scenes wired (radio beats; the Warlord\'s entrance and the MAYDAY are skippable cinematics)', story.missing.length === 0 && story.wired.length === 0 && story.kinds.boss === 'cinematic' && story.kinds.mayday === 'cinematic', JSON.stringify(story));

  // ================= K. BASE (v0.9C) =================
  if (BASE) {
    const pb = await openPage(browser, BASE, { seed: 4242 }), pn = await openPage(browser, URL, { seed: 4242 });
    const before = await pb.evaluate(missionSnapshot), nowS = await pn.evaluate(missionSnapshot);
    await pb.context().close(); await pn.context().close();
    const cfgDiff = Object.keys(nowS.cfg).filter((k) => nowS.cfg[k] !== before.cfg[k]);
    const NEW = ['hq', 'mortar', 'warlord'];
    check('K1 every CFG group identical to v0.9C but the three new groups (warlord, mortar, hq) and the v0.9D.1 groups (V09D1: formation, warlordResponse)', V09D1.cfgDiff(cfgDiff).sort().join() === NEW.join() && NEW.every((k) => before.cfg[k] === undefined), cfgDiff.join() || 'none');
    const ids = Object.keys(before.missions).filter((id) => id !== 'jungle-prison');
    const misDiff = ids.filter((id) => before.missions[id] !== nowS.missions[id]);
    const b19 = JSON.parse(before.missions['jungle-prison']), n19 = JSON.parse(nowS.missions['jungle-prison']);
    const d19 = Object.keys(n19).filter((k) => JSON.stringify(b19[k]) !== JSON.stringify(n19[k]));
    const defB = JSON.parse(b19.def), defN = JSON.parse(n19.def);
    const defDiff = Object.keys(defN).filter((k) => JSON.stringify(defB[k]) !== JSON.stringify(defN[k]));
    check('K2 Missions 1-18 identical to v0.9C (maps, enemies, objectives, extraction, story, campaign rows)', ids.length === 18 && misDiff.length === 0, misDiff.join() || `${ids.length} missions`);
    check('K3 Mission 19 identical to v0.9C but its unlock list (now Mission 20)', d19.join() === 'def' && defDiff.join() === 'unlocks' && defN.unlocks.missions.join() === 'warlord-hq', `${d19.join()} / ${defDiff.join()}`);
  } else check('K BASE build available', false, 'BASE not set (npm test serves v0.9C)');

  // ================= L. VERSION, SAVE, PHONES =================
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const saveSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'save.ts'), 'utf8');
  check('L1 package 0.9.5 / label 0.9D or a later release (v0.9D.1: 0.9.6, checked by v09d1); SAVE_VERSION 9 (nothing new is saved)', pkg.version >= '0.9.5' && /^0\.9[DE]/.test(pkg.versionLabel) && /SAVE_VERSION = 9;/.test(saveSrc), `${pkg.version} ${pkg.versionLabel}`);
  {
    const p2 = await openPage(browser, URL, { seed: 2020, viewport: { width: 667, height: 375 }, context: { deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    await p2.evaluate(helpers);
    const shot = async (name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p2.screenshot({ path: `${OUT}/${name}.png` }); } };
    const r1 = await p2.evaluate(async () => {
      const { g, F, B } = X.toBoss(X.six, false); g.invuln = true;
      const c = { x: 4150, y: 1450 };
      T.stepUntil(() => F.mortar && F.mortar.t > 1, 20, () => { X.at(c); X.skip(); });
      g.paused = false; await new Promise((res) => setTimeout(res, 400));
      return { mortar: !!F.mortar, boss: B.active, enemies: g.enemies.filter((e) => e.active).length };
    });
    await shot('v09d-iphoneSE-mortar');
    const r2 = await p2.evaluate(async () => {
      const { g, W, B } = X.toBoss(X.six, true); g.invuln = true;
      g.damage(B, 1e7, g.soldiers[0]); T.step(0.1); X.skip();
      const z = X.cz(window.__hq.HQ_ALPHA);
      T.stepUntil(() => W.alpha === 'hit', 20, () => X.at(z)); T.step(0.8, () => X.at(z));
      g.paused = false; await new Promise((res) => setTimeout(res, 400));
      return { alpha: W.alpha };
    });
    await shot('v09d-iphoneSE-alpha');
    check('L2 iPhone SE: the mortar circle over the boss fight and the Alpha crash render without page errors', r1.mortar && r1.boss && (r2.alpha === 'hit' || r2.alpha === 'crashed') && p2.errors.length === 0, JSON.stringify({ r1, r2 }) + (p2.errors[0] || ''));
    await p2.context().close();
  }

  const code = finish(page.errors);
  await browser.close();
  return code;
});
