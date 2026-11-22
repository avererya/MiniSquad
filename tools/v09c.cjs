// v0.9C rule checks: Chapter 4 Mission 19 "Prison Break" (src/prison.ts PrisonBreak, map.ts CAMP_*, missions.ts
// PRISON_CAMP) and the Mission 7 rename ("Operation Breakout", id prison-break kept).
//  A. Campaign: Mission 19 row (number 19, Chapter 4, six soldiers, optionals alarm-tower / specialists-alive, star
//     rules, briefing); Mission 18 now unlocks it (first win only); Mission 19 unlocks nothing; Mission 7 renamed;
//     a save that cleared Mission 18 gets Mission 19 on load without a repair note
//  B. Map: cells, alarm, staging, routes, extraction on open ground and reachable from the start; three enclosures
//     with different guards (armored + sniper / big rifle squads / small dispersed pairs); 5+ assault directions
//  C. Rescue: the held prisoners are never enemy targets; a standing soldier by the door frees one in 2.5 s
//     (progress kept when leaving, allies cannot free); all six orders complete the objective
//  D. Specialists: temporary allies (Game.allies, never soldiers / roster), their own stats and weapons (rocket
//     splash, flame cone with afterburn, fast throwing stars), follow the squad, take damage, can be downed and
//     revived; a KIA specialist is no permadeath / Memorial / roster event, fails specialists-alive only
//  E. Escalation: responses 5 / 8+2 / 6+1 after rescues 1 / 2 / 3, spawned off screen and 480+ px from the squad;
//     the alarm tower down before the second rescue shrinks that response (after it, no effect); its optional
//  F. Last stand: 30 s countdown, 12 / 15 / 18 / 15 Riflemen at 0.5 / 7 / 14 / 21 s from 5+ routes, off screen and
//     waveMinDist from every soldier and specialist; the helicopter lands at 30 s and extraction is immediate with
//     attackers alive; scaled by the force (fewer soldiers / specialists, hostiles already near the clearing)
//  G. Engagement (seeded, v09c-sim attentive player, level-14 squad, all three specialists): most attackers reach
//     range and fire; the squad extracts without a KIA
//  H. Stars / rewards: both optionals + no KIA = 3 stars; specialists get no XP rows; nothing about the camp is saved
//  I. BASE (v0.9B.2, 4199686): every CFG group identical but the new prison* groups; Missions 1-17 identical but
//     Mission 7's name; Mission 18 identical but its unlock list
//  J. Version 0.9.4 / v0.9C, SAVE_VERSION 9; iPhone SE frames of the specialists fighting and of the last stand
// Usage: npm test -- v09c   (or: npx vite preview --port 4173 & BASE=<v0.9B.2 url> node tools/v09c.cjs)
const fs = require('fs');
const path = require('path');
const { chromium, URL, BASE, OUT, createChecks, runSuite, openPage, missionSnapshot } = require('./lib.cjs');
const { setup } = require('./v08c-sim.cjs');
const { stand } = require('./v09c-sim.cjs');

/** Page-side helpers (window.X) on top of window.T. */
function helpers() {
  window.X = {
    /** Mission 19 with roster soldiers `ids` (or generic classes), story skipped, field calmed (alarm tower kept). */
    m19(squad = ['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], calm = true) {
      const m = T.start('jungle-prison', squad), g = window.game;
      if (g.story) g.story.skip(g);
      if (calm) T.calm((e) => e.structure === 'relay');
      g.input.move = () => ({ x: 0, y: 0 });
      return { g, m, P: m.mechanic('prison') };
    },
    skip() { const g = window.game; if (g.story) { g.story.skip(g); if (g.story.queue) g.story.queue.length = 0; } },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    at(p) { const g = window.game; T.pinAt(p); g.cam = { ...p }; },
    /** Free prisoner `kind` by standing the squad next to its cell (calm, invulnerable); returns seconds. */
    free(kind) {
      const g = window.game, P = g.mission.mechanic('prison'), p = P.prisoners.find((q) => q.def.kind === kind);
      const spot = g.findOpenNear({ x: p.npc.pos.x, y: p.npc.pos.y + 60 }, 40);
      return T.stepUntil(() => !!p.ally, 8, () => { this.at(spot); if (g.modal === 'story') this.skip(); });
    },
    /** All primaries done, specialists freed beside the zone, squad in the landing zone (countdown starts next step). */
    toStand(keep = ['rocket', 'flame', 'star']) {
      const g = window.game, m = g.mission, P = m.mechanic('prison'), z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      for (const p of P.prisoners) { p.npc.pos = { x: c.x - 80 + 40 * P.prisoners.indexOf(p), y: c.y + 70 }; P.free(m, g, p); }
      for (const p of P.prisoners) if (!keep.includes(p.def.kind)) { p.ally.state = 'kia'; p.ally.hp = 0; }
      P.pending.length = 0;
      T.calm((e) => e.structure === 'relay'); this.skip();
      for (const o of m.primaries) o.state = 'complete';
      m.current = m.primaries.length; m.phase = 'toExtraction';
      return c;
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
  const page = await openPage(browser, URL, { seed: 1919 });
  await page.evaluate(helpers);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const PC = await ev(() => window.__CFG.prison);

  // ================= A. CAMPAIGN =================
  const camp = await ev(() => {
    const Cm = window.__campaign, row = (id) => Cm.CAMPAIGN.find((x) => x.id === id), r = row('jungle-prison');
    return {
      r19: r && { n: r.number, name: r.name, playable: r.playable, ch: Cm.chapterOf(19).number, cap: Cm.capacityOf('jungle-prison'), opt: r.optional.map((o) => o.id).join(), stars: JSON.stringify(r.stars), brief: !!(r.brief && r.brief.story && r.brief.objectives && r.brief.tip), unl: r.unlocks.missions.join(), note: r.unlocks.capacityNote || '' },
      m7: row('prison-break') && { n: row('prison-break').number, name: row('prison-break').name },
      m18unl: row('ambush-alley').unlocks.missions.join(),
      maxPlayable: Math.max(...Cm.CAMPAIGN.filter((x) => x.playable).map((x) => x.number)),
      after: Cm.CAMPAIGN.filter((x) => x.number > 19).map((x) => `${x.id}:${x.playable}`),
      names: Cm.CAMPAIGN.map((x) => x.name),
    };
  });
  check('A1 Mission 19 "Prison Break" (jungle-prison): number 19, playable, Chapter 4, six soldiers, optionals alarm-tower + specialists-alive, 2 stars = optionals / 3 = no KIA, briefing', camp.r19 && camp.r19.n === 19 && camp.r19.name === 'Prison Break' && camp.r19.playable && camp.r19.ch === 4 && camp.r19.cap === 6 && camp.r19.opt === 'alarm-tower,specialists-alive' && /"two":"optionals"/.test(camp.r19.stars) && /"three":"noKia"/.test(camp.r19.stars) && camp.r19.brief, JSON.stringify(camp.r19));
  check('A2 Mission 7 keeps its id and number, renamed "Operation Breakout"; no two missions share a name', camp.m7 && camp.m7.n === 7 && camp.m7.name === 'Operation Breakout' && new Set(camp.names).size === camp.names.length, JSON.stringify(camp.m7));
  check('A3 Mission 18 unlocks Mission 19; Mission 19 unlocks nothing (Mission 20 not playable yet, the note says so)', camp.m18unl === 'jungle-prison' && camp.r19.unl === '' && camp.maxPlayable === 19 && camp.after.every((x) => x.endsWith(':false')) && /future update/i.test(camp.r19.note), JSON.stringify({ m18: camp.m18unl, m19: camp.r19.unl, max: camp.maxPlayable, after: camp.after }));
  const unl = await ev(() => {
    const g = window.game, a = window.__account(), R = g.roster, out = {};
    for (const id of ['ambush-alley']) if (!a.campaign.unlockedMissions.includes(id)) a.campaign.unlockedMissions.push(id);
    const ids = R.owned().map((s) => s.id).slice(0, 2);
    const has = (id) => a.campaign.unlockedMissions.includes(id);
    const win = (id) => { g.selectMission(id, true); g.deploy(ids.map((x) => R.get(x)), 'roster'); X.skip(); g.invuln = true; g.mission.debugReadyExtraction(g); const zc = (() => { const z = g.mission.extraction.zone; return { x: z.x + z.w / 2, y: z.y + z.h / 2 }; })(); T.stepUntil(() => g.phase !== 'playing', 60, () => { T.calm((e) => e.structure === 'relay'); T.pinAt(zc); for (const al of g.allies) { al.pos = { ...zc }; } }); g.invuln = false; return g.phase; };
    out.before = has('jungle-prison');
    out.win18 = win('ambush-alley'); out.after18 = has('jungle-prison');
    out.win18b = win('ambush-alley'); out.n = a.campaign.unlockedMissions.filter((x) => x === 'jungle-prison').length;
    out.win19 = win('jungle-prison'); out.list = a.campaign.unlockedMissions.join();
    out.rec = a.missions['jungle-prison'] ? a.missions['jungle-prison'].completions : 0;
    window.__persist();
    out.raw = localStorage.getItem('minisquad.save');
    return out;
  });
  check('A4 the first Mission 18 win unlocks Mission 19 (once, not on a replay); winning Mission 19 unlocks nothing new; completions recorded', !unl.before && unl.win18 === 'won' && unl.after18 && unl.win18b === 'won' && unl.n === 1 && unl.win19 === 'won' && unl.rec === 1 && unl.list.split(',').pop() === 'jungle-prison', JSON.stringify({ ...unl, raw: undefined }));
  const load = await ev((raw) => {
    // a v0.9B.2-era save: Mission 18 cleared, Mission 19 not listed (it did not exist yet)
    const s = JSON.parse(raw), acc = s.account || s;
    const camp = acc.campaign; camp.unlockedMissions = camp.unlockedMissions.filter((x) => x !== 'jungle-prison');
    delete (acc.missions || {})['jungle-prison'];
    localStorage.setItem('minisquad.save', JSON.stringify(s));
    return true;
  }, unl.raw);
  await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T); await page.evaluate(helpers);
  const loaded = await ev(() => ({ has: window.__account().campaign.unlockedMissions.includes('jungle-prison'), notes: JSON.stringify(window.__loadStatus.notes) }));
  check('A5 a save that cleared Mission 18 before v0.9C gets Mission 19 on load, without a repair note', load && loaded.has && !/jungle-prison/.test(loaded.notes), JSON.stringify(loaded));
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => !!window.game && !!window.T); await page.evaluate(helpers);

  // ================= B. MAP =================
  const map = await ev(() => {
    const { g, m, P } = X.m19(['infantry'], false), W = g.world, C = window.__camp;
    const seen = X.fill(W, m.map.start ?? g.anchor);
    const ok = (p) => W.isOpen(p.x, p.y) && !!seen[W.idx(p.x, p.y)];
    const z = C.CAMP_EXTRACTION, zc = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    const pts = { cells: Object.values(C.CAMP_CELLS), staging: C.CAMP_STAGING, routes: Object.values(C.CAMP_ASSAULT).flat(), zone: [zc] };
    const bad = Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, v.filter((p) => !ok(p)).map((p) => `${p.x},${p.y}`)]));
    const near = (c, r) => g.enemies.filter((e) => !e.structure && X.near(e.pos, c) < r);
    const enc = {};
    for (const [k, c] of Object.entries(C.CAMP_CELLS)) { const es = near(c, 420); enc[k] = { n: es.length, armored: es.filter((e) => e.kind === 'armored').length, sniper: es.filter((e) => e.kind === 'sniper').length, rifle: es.filter((e) => e.kind === 'rifleman').length, tags: [...new Set(es.map((e) => e.tag))].length }; }
    const dirs = new Set(Object.values(C.CAMP_ASSAULT).map((r) => { const p = r[0], a = Math.atan2(p.y - zc.y, p.x - zc.x); return Math.round(a / (Math.PI / 4)); }));
    return { bad, enc, dirs: dirs.size, routes: Object.keys(C.CAMP_ASSAULT).length, alarm: P.alarm && { hp: P.alarm.maxHp, label: P.alarm.label, open: ok(P.alarm.pos) || true }, held: g.npcs.length, placed: g.enemies.filter((e) => !e.structure).length, size: `${m.map.w}x${m.map.h}`, cellZone: Object.values(C.CAMP_CELLS).map((c) => Math.round(X.near(c, zc))) };
  });
  check('B1 every cell, staging point, assault route point and the landing zone on open ground, reachable from the start', Object.values(map.bad).every((v) => v.length === 0), JSON.stringify(map.bad));
  const E = map.enc;
  check('B2 three distinct enclosures: Rocket fortified (3+ Armored and a Sniper), Flamethrower big rifle groups (10+ Riflemen), Shadow dispersed small groups (3+ groups, few per group)', E.rocket.armored >= 3 && E.rocket.sniper >= 1 && E.flame.rifle >= 10 && E.star.tags >= 3 && E.star.n <= 2.5 * E.star.tags, JSON.stringify(E));
  check('B3 the alarm tower stands (a structure, its CFG HP) and three prisoners are held; 5+ assault directions around the clearing', map.alarm && map.alarm.hp === PC.alarmHp && map.alarm.label === 'ALARM TOWER' && map.held === 3 && map.dirs >= 5 && map.routes >= 7, JSON.stringify({ alarm: map.alarm, held: map.held, dirs: map.dirs, routes: map.routes, placed: map.placed, size: map.size }));

  // ================= C. RESCUE =================
  const res = await ev((PC) => {
    const out = {};
    {
      const { g, m, P } = X.m19(['infantry', 'heavy', 'medic'], true);
      const victims = g.enemyVictims();
      out.untargetable = P.prisoners.every((p) => !victims.includes(p.npc) && !g.allies.includes(p.npc));
      // enemies shooting near a cell never hurt a held prisoner (not a victim): a rifleman beside the rocket cell
      const p = P.prisoners[0], e = g.spawnEnemy({ x: p.npc.pos.x + 120, y: p.npc.pos.y }, 'rifleman');
      T.step(3, () => { T.pinAt({ x: 300, y: 2500 }); });
      out.prisonerHp = p.npc.hp === p.npc.maxHp; e.state = 'dead'; g.enemies = g.enemies.filter((x) => x.active);
      // partial progress is kept when the squad leaves, an ally alone cannot free, a soldier finishes it
      const spot = g.findOpenNear({ x: p.npc.pos.x, y: p.npc.pos.y + 60 }, 40);
      T.step(1, () => X.at(spot));
      out.partial = +p.progress.toFixed(2);
      T.step(1, () => X.at({ x: 300, y: 2500 }));
      out.kept = +p.progress.toFixed(2);
      out.hud = m.primaries[m.current] && m.primaries[m.current].id;
      const t = X.free('rocket');
      out.rest = +(t + 1).toFixed(2); // total seconds at the door (1 s before leaving + the rest)
      out.first = { ally: !!p.ally, special: p.ally && p.ally.special, inAllies: g.allies.includes(p.ally), notSoldier: !g.soldiers.includes(p.ally), npcs: g.npcs.length };
      // the rocket specialist stands by the flame cell: nothing happens
      const f = P.prisoners.find((q) => q.def.kind === 'flame');
      T.step(3, () => { X.at({ x: 300, y: 2500 }); p.ally.pos = { x: f.npc.pos.x, y: f.npc.pos.y + 40 }; });
      out.allyFrees = f.progress;
    }
    const orders = [['rocket', 'flame', 'star'], ['rocket', 'star', 'flame'], ['flame', 'rocket', 'star'], ['flame', 'star', 'rocket'], ['star', 'rocket', 'flame'], ['star', 'flame', 'rocket']];
    out.orders = orders.map((o) => {
      const { g, m, P } = X.m19(['infantry', 'heavy', 'medic'], true);
      g.invuln = true;
      m.primaries[0].state = 'complete'; m.current = 1; m.primaries[1].activate(m, g); m.phase = m.primaries[1].phase;
      const chips = [];
      for (const k of o) { X.free(k); chips.push(m.primaries[1].status(m)); T.step(0.2, () => { T.calm((e) => e.structure === 'relay'); X.skip(); }); }
      T.step(0.5, () => T.calm((e) => e.structure === 'relay'));
      g.invuln = false;
      return { order: P.log.rescues.map((r) => r.kind).join(), chips: chips.join(' '), state: m.primaries[1].state, phase: m.phase, allies: g.allies.map((a) => a.special).join() };
    });
    return out;
  }, PC);
  check('C1 held prisoners are never enemy targets and take no fire before their rescue', res.untargetable && res.prisonerHp, JSON.stringify({ u: res.untargetable, hp: res.prisonerHp }));
  check(`C2 a soldier at the door frees a prisoner in ${PC.freeTime} s; leaving keeps the progress; an ally alone frees nobody`, Math.abs(res.partial - 1 / PC.freeTime) < 0.03 && res.kept === res.partial && Math.abs(res.rest - PC.freeTime) < 0.3 && res.allyFrees === 0, JSON.stringify({ partial: res.partial, kept: res.kept, rest: res.rest, ally: res.allyFrees }));
  check('C3 a freed prisoner becomes a specialist ally (Game.allies, never Game.soldiers), the held NPC is gone', res.first.ally && res.first.special === 'rocket' && res.first.inAllies && res.first.notSoldier && res.first.npcs === 2, JSON.stringify(res.first));
  check('C4 all six rescue orders free the three and complete "Rescue the three specialists" (1/3, 2/3, 3/3), then extraction', res.orders.every((r, i) => r.order === ['rocket,flame,star', 'rocket,star,flame', 'flame,rocket,star', 'flame,star,rocket', 'star,rocket,flame', 'star,flame,rocket'][i] && r.chips === '1/3 2/3 3/3' && r.state === 'complete' && r.phase === 'toExtraction' && r.allies.split(',').length === 3), res.orders.map((r) => `${r.order}:${r.state}:${r.phase}`).join(' | '));

  // ================= D. SPECIALISTS =================
  const sp = await ev(() => {
    const out = {};
    const C = window.__CFG;
    const { g, m, P } = X.m19(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], true);
    g.invuln = false;
    const c = { x: 3950, y: 1400 };
    for (const p of P.prisoners) { p.npc.pos = { x: c.x - 60 + 40 * P.prisoners.indexOf(p), y: c.y + 50 }; P.free(m, g, p); }
    P.pending.length = 0; T.calm((e) => e.structure === 'relay'); X.skip();
    const S = Object.fromEntries(P.specialists.map((u) => [u.special, u]));
    out.stats = Object.fromEntries(Object.entries(S).map(([k, u]) => [k, { hp: u.maxHp, range: u.stats.range, dmg: u.stats.damage, team: u.team }]));
    out.cfg = { rocket: C.prisonRocket.hp, flame: C.prisonFlame.hp, star: C.prisonStar.hp, res: C.resistance.hp };
    out.distinctFromRoster = g.roster.owned().every((s) => !['KRAKEN', 'TORCH', 'WRAITH'].includes(s.name));
    // weapons: one specialist at a time vs dummies (others far away)
    const park = () => { g.soldiers.forEach((s, i) => { s.pos = { x: 600 + i * 30, y: 2600 }; s.vel = { x: 0, y: 0 }; s.fireCooldown = 1; }); g.anchor = { x: 3950, y: 1400 }; };
    const lab = (kind, offs) => {
      T.calm((e) => e.structure === 'relay');
      for (const u of P.specialists) { u.pos = { x: 4700, y: 2600 }; u.vel = { x: 0, y: 0 }; }
      const u = S[kind]; u.pos = { x: 3950, y: 1400 }; u.hp = u.maxHp; u.shots = 0; u.dealt = 0;
      const ds = offs.map((o) => { const e = g.spawnEnemy({ x: u.pos.x + o.x, y: u.pos.y + o.y }, o.kind || 'rifleman'); e.setMaxHp(5000); e.guard = true; e.aggro = 1; e.fireCooldown = 1e9; return e; });
      let stars = 0, big = 0;
      T.step(3, () => { park(); u.pos = { x: 3950, y: 1400 }; u.vel = { x: 0, y: 0 }; for (const e of ds) { e.vel = { x: 0, y: 0 }; e.fireCooldown = 1e9; } for (const p of g.projectiles) if (p.owner === u) { if (p.star) stars++; if (p.big) big++; } });
      const r = { shots: u.shots, hit: ds.map((e) => Math.round(e.maxHp - e.hp)), burning: ds.filter((e) => e.burn && e.burn.t > 0).length, stars, big };
      for (const e of ds) e.state = 'dead'; g.enemies = g.enemies.filter((x) => x.active);
      return r;
    };
    // rocket: two Riflemen side by side at 300 px (splash hits both)
    out.rocket = lab('rocket', [{ x: 300, y: 0 }, { x: 300, y: 36 }]);
    // flame: three Riflemen inside the cone at 120 px, one outside its range
    out.flame = lab('flame', [{ x: 120, y: 0 }, { x: 130, y: 20 }, { x: 125, y: -20 }, { x: 260, y: 0 }]);
    // stars: one Rifleman at 250 px, one beyond the range at 400 px
    out.star = lab('star', [{ x: 250, y: 0 }, { x: 400, y: 120 }]);
    // follow: the squad walks 600 px away, the specialists come along
    T.calm((e) => e.structure === 'relay');
    for (const u of P.specialists) { u.pos = { x: 3950, y: 1400 }; u.vel = { x: 0, y: 0 }; }
    const goal = { x: 3350, y: 1400 };
    T.step(8, () => { g.soldiers.forEach((s, i) => { s.pos = { x: goal.x + (i % 3) * 30, y: goal.y + Math.floor(i / 3) * 30 }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...goal }; });
    out.follow = P.specialists.map((u) => Math.round(X.near(u.pos, goal)));
    // damage, downed, revived by a soldier; then a KIA
    const w = S.star; const h0 = w.hp;
    g.damage(w, 30, g.spawnEnemy({ x: 100, y: 100 }, 'rifleman')); out.took = Math.round(h0 - w.hp);
    g.damage(w, 1e4); out.downed = w.state;
    const medic = g.soldiers[2];
    T.stepUntil(() => w.state === 'active', 20, () => { T.calm((e) => e.structure === 'relay'); medic.pos = { x: w.pos.x + 20, y: w.pos.y }; medic.vel = { x: 0, y: 0 }; });
    out.revived = w.state;
    const a = window.__account(), roster0 = g.roster.owned().length, mem0 = a.memorial.length;
    const k = S.flame; g.damage(k, 1e4);
    T.stepUntil(() => k.state === 'kia', 40, () => { T.calm((e) => e.structure === 'relay'); for (const s of g.soldiers) if (X.near(s.pos, k.pos) < 300) s.pos = { x: k.pos.x - 600, y: k.pos.y }; });
    out.kia = k.state; out.optional = m.optionals.find((o) => o.id === 'specialists-alive').state;
    out.inSoldiersEver = g.soldiers.some((s) => s.special);
    return { ...out, roster0, mem0 };
  });
  const ST = sp.stats;
  check('D1 three specialists with their own CFG stats (Rocket 150 HP, Flamethrower 170, Shadow 120; sturdier than resistance allies), squad team, not roster soldiers', ST.rocket.hp === sp.cfg.rocket && ST.flame.hp === sp.cfg.flame && ST.star.hp === sp.cfg.star && Math.min(ST.rocket.hp, ST.flame.hp) > sp.cfg.res && Object.values(ST).every((s) => s.team === 'squad') && sp.distinctFromRoster && !sp.inSoldiersEver, JSON.stringify({ ST, cfg: sp.cfg }));
  check('D2 Rocket Specialist: slow big rockets whose splash hurts two enemies side by side', sp.rocket.shots >= 1 && sp.rocket.big >= 1 && sp.rocket.hit.every((x) => x > 0), JSON.stringify(sp.rocket));
  check('D3 Flamethrower: a short cone hits every enemy inside it and sets them burning; nothing beyond its range', sp.flame.shots >= 4 && sp.flame.hit.slice(0, 3).every((x) => x > 0) && sp.flame.hit[3] === 0 && sp.flame.burning >= 3, JSON.stringify(sp.flame));
  check('D4 Shadow Operative: fast spinning throwing stars, short range (the far enemy untouched)', sp.star.shots >= 8 && sp.star.stars >= 1 && sp.star.hit[0] > 0 && sp.star.hit[1] === 0 && ST.star.range < 400, JSON.stringify(sp.star));
  check('D5 the specialists follow the squad (all within 260 px of it after 8 s)', sp.follow.every((d) => d < 260), sp.follow.join('/'));
  check('D6 a specialist takes damage, can be downed and revived by a soldier', sp.took > 0 && sp.downed === 'downed' && sp.revived === 'active', JSON.stringify({ took: sp.took, downed: sp.downed, revived: sp.revived }));
  const after = await ev(({ roster0, mem0 }) => {
    const g = window.game, a = window.__account(), m = g.mission;
    for (const o of m.primaries) o.state = 'complete'; m.current = m.primaries.length; m.phase = 'toExtraction';
    g.invuln = true;
    const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    T.stepUntil(() => g.phase !== 'playing', 60, () => { T.calm((e) => e.structure === 'relay'); T.pinAt(c); for (const al of g.allies) if (al.active) al.pos = { ...c }; X.skip(); });
    g.invuln = false;
    const rw = g.lastReward;
    return { phase: g.phase, pending: a.pendingDecision ? a.pendingDecision.queue.length : 0, memorial: a.memorial.length - mem0, roster: g.roster.owned().length - roster0, opt: m.optionals.map((o) => `${o.id}:${o.state}`).join(), rows: rw ? JSON.stringify((rw.soldiers || rw.rows || []).map((x) => x.id || x.name)) : 'none', stars: g.lastStars && g.lastStars.stars, saved: localStorage.getItem('minisquad.save') || '' };
  }, { roster0: sp.roster0, mem0: sp.mem0 });
  check('D7 a specialist KIA: specialists-alive fails, but no permadeath decision, Memorial entry or roster change; the mission is still won', sp.kia === 'kia' && sp.optional === 'failed' && after.phase === 'won' && after.pending === 0 && after.memorial === 0 && after.roster === 0 && /specialists-alive:failed/.test(after.opt), JSON.stringify({ kia: sp.kia, opt: sp.optional, ...after, saved: undefined, rows: undefined }));
  check('D8 specialists get no XP / reward rows and are never saved', !/KRAKEN|TORCH|WRAITH/.test(after.rows) && !/KRAKEN|TORCH|WRAITH|prisonRocket|specialists/.test(after.saved), after.rows);

  // ================= E. ESCALATION =================
  const esc = await ev(() => {
    const run = (alarmBefore) => {
      const { g, m, P } = X.m19(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], true);
      g.invuln = true;
      if (alarmBefore === 0) g.damage(P.alarm, 1e5, g.soldiers[0]);
      const n = [];
      for (const k of ['rocket', 'flame', 'star']) {
        X.free(k);
        if (alarmBefore === P.freed) g.damage(P.alarm, 1e5, g.soldiers[0]);
        const r0 = P.log.responses.length;
        T.stepUntil(() => P.log.responses.length > r0, 8, () => { X.skip(); });
        const r = P.log.responses[P.log.responses.length - 1];
        const units = P.responseUnits.filter((u) => u.tag === `response-${P.freed}`);
        n.push({ after: r && r.after, n: r && r.n, kinds: units.map((u) => u.kind).sort().join(), reduced: r && r.reduced, minD: r && r.minSoldierDist, on: r && r.onScreen, delay: r ? +(r.t - P.log.rescues[P.freed - 1].t).toFixed(2) : null });
        T.calm((e) => e.structure === 'relay');
      }
      g.invuln = false;
      const opt = m.optionals.find((o) => o.id === 'alarm-tower');
      return { n, alarmDownAfter: P.alarmDownAfter, opt: opt.state };
    };
    return { none: run(-1), early: run(0), afterSecond: run(2), afterFirst: run(1) };
  });
  const cnt = (r) => r.n.map((x) => x.n).join('/');
  check('E1 escalation by rescue count: 5 Riflemen after the 1st, 8 Riflemen + 2 Armored after the 2nd, 6 Riflemen + 1 Armored lockdown after the 3rd (any order)', cnt(esc.none) === '5/10/7' && esc.none.n[1].kinds.split(',').filter((k) => k === 'armored').length === 2 && esc.none.n[2].kinds.split(',').filter((k) => k === 'armored').length === 1 && esc.none.n.map((x) => x.after).join() === '1,2,3', JSON.stringify(esc.none.n));
  check('E2 responses come off screen and 480+ px from every soldier (scatter 70), a few seconds after the release', esc.none.n.every((x) => !x.on && x.minD >= 480 - 70 && x.delay >= 2.9 && x.delay <= 5.1), JSON.stringify(esc.none.n.map((x) => ({ minD: x.minD, on: x.on, delay: x.delay }))));
  check('E3 alarm tower down before the 2nd rescue (at the start, or after the 1st): that response shrinks to 4 Riflemen + 1 Armored; after the 2nd rescue it changes nothing; the optional completes either way', cnt(esc.early) === '5/5/7' && esc.early.n[1].reduced && cnt(esc.afterFirst) === '5/5/7' && cnt(esc.afterSecond) === '5/10/7' && ['early', 'afterFirst', 'afterSecond'].every((k) => esc[k].opt === 'complete'), `early ${cnt(esc.early)} afterFirst ${cnt(esc.afterFirst)} afterSecond ${cnt(esc.afterSecond)} opts ${esc.early.opt}/${esc.afterFirst.opt}/${esc.afterSecond.opt}`);
  const altFail = await ev(() => {
    const { g, m } = X.m19(['infantry', 'heavy', 'medic'], true);
    g.invuln = true; m.debugReadyExtraction(g);
    const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    T.stepUntil(() => g.phase !== 'playing', 60, () => { T.calm((e) => e.structure === 'relay'); T.pinAt(c); for (const al of g.allies) if (al.active) al.pos = { ...c }; X.skip(); });
    return { phase: g.phase, opt: m.optionals.map((o) => `${o.id}:${o.state}`).join(), stars: g.lastStars && g.lastStars.stars };
  });
  check('E4 leaving the alarm tower standing fails its optional at the end (the mission is still won)', altFail.phase === 'won' && /alarm-tower:failed/.test(altFail.opt), JSON.stringify(altFail));

  // ================= F. LAST STAND =================
  const ls = await ev(() => {
    const W = window.__CFG.prison;
    const run = (squad, keep, extra) => {
      const { g, m, P } = X.m19(squad, true);
      const c = X.toStand(keep);
      if (extra) for (let i = 0; i < extra; i++) { const e = g.spawnEnemy({ x: c.x - 700, y: c.y + (i - extra / 2) * 30 }, 'rifleman'); e.fireCooldown = 1e9; }
      g.invuln = true;
      const put = () => { g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 45 + (i % 3) * 45, y: c.y - 25 + Math.floor(i / 3) * 50 }; s.vel = { x: 0, y: 0 }; }); g.anchor = { ...c }; for (const u of P.specialists) if (u.active) { u.pos = { x: c.x + 60, y: c.y + 60 }; u.vel = { x: 0, y: 0 }; } };
      let cd = -1, ready = -1, won = -1, firstShot = null; const t0 = g.time;
      T.stepUntil(() => g.phase !== 'playing', 45, () => {
        put(); X.skip();
        if (cd < 0 && m.phase === 'countdown') cd = g.time;
        if (ready < 0 && m.phase === 'available') ready = g.time;
        if (firstShot === null && P.assaultUnits.some((e) => e.shots > 0)) firstShot = +(g.time - P.assaultT).toFixed(2);
      });
      won = g.time; g.invuln = false;
      const kinds = {}; for (const e of P.assaultUnits) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
      const waves = []; for (const w of P.log.waves) { const b = waves.find((x) => x.t === w.t); if (b) b.n += w.n; else waves.push({ t: w.t, n: w.n }); }
      return {
        spawned: P.assaultUnits.length, kinds, scale: +P.scale.toFixed(2), carried: P.carried, waves: waves.map((w) => `${w.t}:${w.n}`).join(' '),
        routes: [...new Set(P.log.waves.map((w) => w.route))].join(), minD: Math.min(...P.log.waves.map((w) => w.minDist)), on: P.log.waves.filter((w) => w.onScreen).length,
        cd: cd >= 0 ? +(m.extraction.countdownTotal ?? W.countdown) : -1, readyAfter: ready >= 0 ? +(ready - P.assaultT).toFixed(2) : -1, end: g.phase, wonAfterReady: ready >= 0 ? +(won - ready).toFixed(3) : -1,
        alive: P.assaultUnits.filter((e) => e.active).length, firstShot, pressure: m.pressureSpawned ?? 0, t: +(g.time - t0).toFixed(1),
      };
    };
    return {
      full: run(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']),
      four: run(['infantry', 'heavy', 'medic', 'sniper']),
      noSpec: run(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], []),
      carried: run(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], undefined, 10),
      two: run(['infantry', 'heavy'], []),
    };
  });
  const F0 = ls.full;
  check('F1 full strength (six soldiers, three specialists): 60 attackers, all ordinary Riflemen; no generic extraction pressure on top', F0.spawned === 60 && F0.kinds.rifleman === 60 && Object.keys(F0.kinds).length === 1 && F0.pressure === 0 && F0.scale === 1, JSON.stringify({ n: F0.spawned, kinds: F0.kinds, scale: F0.scale, pressure: F0.pressure }));
  check('F2 four waves: 12 at 0.5 s, 15 at 7 s, 18 at 14 s, 15 at 21 s of the countdown', F0.waves === '0.5:12 7:15 14:18 21:15', F0.waves);
  check('F3 from 5+ different routes around the clearing; every group off screen and waveMinDist from every soldier and specialist (scatter 70); no shot in the first second', F0.routes.split(',').length >= 5 && F0.on === 0 && F0.minD >= PC.waveMinDist - 70 && (F0.firstShot === null || F0.firstShot >= 1), JSON.stringify({ routes: F0.routes, minD: F0.minD, on: F0.on, firstShot: F0.firstShot }));
  check(`F4 the helicopter lands ${PC.countdown} s after the countdown starts and the squad extracts that step, attackers still standing (no kill-all)`, Math.abs(F0.readyAfter - PC.countdown) < 0.05 && F0.end === 'won' && F0.wonAfterReady < 0.05 && F0.alive > 0, JSON.stringify({ ready: F0.readyAfter, end: F0.end, won: F0.wonAfterReady, alive: F0.alive }));
  check('F5 scaled for the force: four soldiers, no specialists, or hostiles already near the clearing each meet fewer attackers (same waves and routes); never below 45% (2 per group minimum)', ls.four.spawned < 60 && ls.noSpec.spawned < 60 && ls.carried.carried >= 10 && ls.carried.spawned <= 60 - ls.carried.carried + 3 && ls.two.scale === 0.45 && ls.two.spawned >= 20 && ls.four.routes === F0.routes && ls.four.waves.split(' ').map((w) => w.split(':')[0]).join() === '0.5,7,14,21', JSON.stringify({ four: [ls.four.spawned, ls.four.scale], noSpec: [ls.noSpec.spawned, ls.noSpec.scale], carried: [ls.carried.spawned, ls.carried.carried, ls.carried.scale], two: [ls.two.spawned, ls.two.scale] }));

  // ================= G. ENGAGEMENT =================
  const eng = [];
  for (const seed of [19000, 26919]) {
    const p = await openPage(browser, URL, { seed });
    const s = await p.evaluate(setup, { demo: true, level: 14 });
    eng.push(s.error ? { error: s.error } : await p.evaluate(stand, { ids: s.ids }));
    await p.context().close();
  }
  const fmt = (xs) => xs.map((r) => r.error || `${r.spawned}/${r.inRange}/${r.fired}/${r.alive} dmg ${r.dmg} kia ${r.kia} spec ${r.specAlive} ${r.extracted ? 'out' : 'LOST'}`).join(' | ');
  check('G1 most attackers fight: 70%+ reach firing range of a standing soldier or specialist and 60%+ fire before the helicopter lands (spawned/in range/fired/alive)', eng.every((r) => !r.error && r.inRange >= 0.7 * r.spawned && r.fired >= 0.6 * r.spawned), fmt(eng));
  check('G2 an attentive level-14 squad with its specialists takes real fire (150+ damage) and still extracts without a KIA', eng.every((r) => !r.error && r.dmg >= 150 && r.extracted && r.kia === 0), fmt(eng));

  // ================= H. STARS =================
  const stars = await ev(() => {
    const { g, m, P } = X.m19(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], true);
    g.invuln = true;
    g.damage(P.alarm, 1e5, g.soldiers[0]);
    for (const k of ['star', 'rocket', 'flame']) { X.free(k); T.step(0.2, () => { T.calm((e) => e.structure === 'relay'); X.skip(); }); }
    P.pending.length = 0;
    const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    for (const o of m.primaries) o.state = 'complete'; m.current = m.primaries.length; m.phase = 'toExtraction';
    T.stepUntil(() => g.phase !== 'playing', 60, () => { T.calm((e) => e.structure === 'relay'); T.pinAt(c); for (const al of g.allies) if (al.active) { al.pos = { ...c }; al.hp = al.maxHp; } X.skip(); });
    return { phase: g.phase, stars: g.lastStars && g.lastStars.stars, opt: m.optionals.map((o) => `${o.id}:${o.state}`).join(), story: g.story ? g.story.log.map((x) => x.id || x).join() : '' };
  });
  check('H1 both optionals (alarm tower, all three specialists alive) and no KIA: 3 stars; one optional missed: below 3', stars.phase === 'won' && stars.stars === 3 && /alarm-tower:complete/.test(stars.opt) && /specialists-alive:complete/.test(stars.opt) && altFail.stars < 3, JSON.stringify({ stars, alt: altFail.stars }));
  const story = await ev(() => {
    const S = window.__story.SCENES, sc = window.__missions['jungle-prison'].story;
    const ids = ['m19-intro', 'm19-rescue1', 'm19-rescue2', 'm19-rescue3', 'm19-assault', 'm19-intel', 'm19-extract'];
    return { missing: ids.filter((id) => !S[id]), wired: ids.filter((id) => !Object.values(sc).includes(id)), intel: S['m19-intel'] ? JSON.stringify(S['m19-intel']).match(/headquarters|HQ/i) !== null : false };
  });
  check('H2 story radio beats: intro, each rescue (the third is the lockdown), assault warning, intel pointing to the Warlord HQ, extraction; all wired to the mission', story.missing.length === 0 && story.wired.length === 0 && story.intel, JSON.stringify(story));

  // ================= I. BASE (v0.9B.2) =================
  if (BASE) {
    const pb = await openPage(browser, BASE, { seed: 4242 }), pn = await openPage(browser, URL, { seed: 4242 });
    const before = await pb.evaluate(missionSnapshot), nowS = await pn.evaluate(missionSnapshot);
    await pb.context().close(); await pn.context().close();
    const cfgDiff = Object.keys(nowS.cfg).filter((k) => nowS.cfg[k] !== before.cfg[k]);
    const NEW = ['prison', 'prisonFlame', 'prisonRocket', 'prisonStar'];
    check('I1 every CFG group identical to v0.9B.2 but the four new prison* groups (no global class, enemy or economy number moved)', cfgDiff.sort().join() === NEW.join() && NEW.every((k) => before.cfg[k] === undefined), cfgDiff.join() || 'none');
    const ids = Object.keys(before.missions).filter((id) => id !== 'ambush-alley');
    const norm = (id, s) => (id === 'prison-break' ? s.replace(/\\"name\\":\\"[^\\]*\\"/, '"name":"M7"') : s);
    const misDiff = ids.filter((id) => norm(id, before.missions[id]) !== norm(id, nowS.missions[id]));
    const b18 = JSON.parse(before.missions['ambush-alley']), n18 = JSON.parse(nowS.missions['ambush-alley']);
    const d18 = Object.keys(n18).filter((k) => JSON.stringify(b18[k]) !== JSON.stringify(n18[k]));
    const defB = JSON.parse(b18.def), defN = JSON.parse(n18.def);
    const defDiff = Object.keys(defN).filter((k) => JSON.stringify(defB[k]) !== JSON.stringify(defN[k]));
    const m7 = [JSON.parse(JSON.parse(before.missions['prison-break']).def).name, JSON.parse(JSON.parse(nowS.missions['prison-break']).def).name];
    check('I2 Missions 1-17 identical to v0.9B.2 (maps, enemies, objectives, extraction, story, campaign rows) but Mission 7\'s name', ids.length === 17 && misDiff.length === 0 && m7[1] === 'Operation Breakout' && m7[0] !== m7[1], `${misDiff.join() || `${ids.length} missions`} M7 ${m7.join(' -> ')}`);
    check('I3 Mission 18 identical to v0.9B.2 but its unlock list (now Mission 19)', d18.join() === 'def' && defDiff.join() === 'unlocks' && defN.unlocks.missions.join() === 'jungle-prison', `${d18.join()} / ${defDiff.join()}`);
  } else check('I BASE build available', false, 'BASE not set (npm test serves v0.9B.2)');

  // ================= J. VERSION, SAVE, PHONES =================
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const saveSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'save.ts'), 'utf8');
  check('J1 package 0.9.4, label 0.9C; SAVE_VERSION 9 (nothing new is saved)', pkg.version === '0.9.4' && pkg.versionLabel === '0.9C' && /SAVE_VERSION = 9;/.test(saveSrc), `${pkg.version} ${pkg.versionLabel}`);
  {
    const p2 = await openPage(browser, URL, { seed: 1919, viewport: { width: 667, height: 375 }, context: { deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    await p2.evaluate(helpers);
    const shot = async (name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p2.screenshot({ path: `${OUT}/${name}.png` }); } };
    const r1 = await p2.evaluate(async () => {
      const { g, m, P } = X.m19(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], true);
      g.invuln = true;
      const c = { x: 2700, y: 1500 };
      for (const p of P.prisoners) { p.npc.pos = { x: c.x - 40 + 40 * P.prisoners.indexOf(p), y: c.y + 50 }; P.free(m, g, p); }
      P.pending.length = 0; X.skip();
      for (let i = 0; i < 5; i++) { const e = g.spawnEnemy({ x: c.x + 150 + (i % 2) * 40, y: c.y - 60 + i * 30 }, 'rifleman'); e.setMaxHp(3000); }
      T.step(1.5, () => { T.pinAt(c); g.cam = { ...c }; X.skip(); });
      g.paused = false; await new Promise((res) => setTimeout(res, 400));
      return { allies: g.allies.filter((a) => a.active).length, shots: g.allies.reduce((a, u) => a + u.shots, 0) };
    });
    await shot('v09c-iphoneSE-specialists');
    const r2 = await p2.evaluate(async () => {
      const { g, m } = X.m19(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions'], true);
      const c = X.toStand(); g.invuln = true;
      T.step(16, () => { T.pinAt(c, 40); g.cam = { ...c }; X.skip(); });
      g.paused = false; await new Promise((res) => setTimeout(res, 400));
      return { live: g.enemies.filter((e) => e.reinforcement && e.active).length, phase: m.phase };
    });
    await shot('v09c-iphoneSE-last-stand');
    check('J2 iPhone SE: the three specialists fighting and the last stand render without page errors', r1.allies === 3 && r1.shots > 0 && r2.live >= 10 && r2.phase === 'countdown' && p2.errors.length === 0, JSON.stringify({ r1, r2 }) + (p2.errors[0] || ''));
    await p2.context().close();
  }

  const code = finish(page.errors);
  await browser.close();
  return code;
});
