// v0.6.2 Chapter 2 AUTOMATED GAMEPLAY SIMULATIONS (spec section 14). Headless, accelerated
// fixed-step runs with a scripted "attentive player" policy. These are automated simulations,
// NOT human playtests: the policy walks to objectives, fights, revives, dodges telegraphed boss
// attacks (rocket circle, MG windup) and uses abilities on a simple schedule.
//
//   node tools/chapter2-sim.cjs                 all scenarios (RUNS per scenario, default 5)
//   SCEN=campaign,m10-sniper RUNS=3 node ...    selected scenarios
//   OUT=/path/sims.json                         also write every run as JSON
//
// Scenarios (spec numbering):
//   campaign      fresh save, M1 -> M10 in order like a new player (buys named recruits when
//                 affordable, a Sniper after M9 when affordable); covers 1 (M6 with a modest
//                 4-soldier squad), 2 (balanced 5-soldier squads, M7-M10) and 3 (new Sniper).
//   no-sniper     4: M8-M10, five named soldiers at level 6, no Sniper.
//   recruits      5: M6-M8 with lower-level recruits (level 3 = the recruit starting level here).
//   downed-extract 6: M6; a soldier is downed as extraction opens (forced), the squad must revive.
//   m5-escort     7: Mission 5 hostage escort (3 soldiers, level 4).
//   m7-escort     8: Mission 7 prisoner escort (5 soldiers, level 5).
//   m10-sniper    9: Mission 10, 4 named level 6 + a fresh level 3 Sniper recruit.
//   m10-nosniper 10: Mission 10, 5 named level 6, no Sniper.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const RUNS = +(process.env.RUNS || 5);
const SCEN = (process.env.SCEN || 'campaign,no-sniper,recruits,downed-extract,m5-escort,m7-escort,m10-sniper,m10-nosniper').split(',');
const OUT = process.env.OUT || '';

const CH1 = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home'];
const CH2 = ['bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist'];
const PREF = ['doc', 'tank', 'ace', 'ranger', 'havoc', 'patch'];

/** Page-side setup: fresh save, then soldiers at the given levels (named ids or recruit classes). */
async function setup(page, spec) {
  await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL);
  return page.evaluate((spec) => {
    const g = window.game, a = window.__account(), E = window.__economy, P = window.__progression;
    window.__debugUnlockAll();
    if (spec.sniper) { if (!a.classUnlocks.unlocked.includes('sniper')) a.classUnlocks.unlocked.push('sniper'); a.classUnlocks.notified.push('sniper'); }
    const ids = [];
    const setLvl = (s, L) => { s.progression.xp = P.xpForLevel(L); s.progression.level = L; };
    for (const e of spec.squad) {
      if (e.id) { const s = g.roster.get(e.id); setLvl(s, e.level); if (e.train) for (const k of Object.keys(s.training)) s.training[k] = e.train; ids.push(s.id); continue; }
      // a recruit of this class, bought through the real Recruitment Office (Credits granted for the sim)
      E.openOffice(g.roster, a, null);
      let id = null;
      for (let i = 0; i < 80 && !id; i++) {
        const o = a.recruitment.offers.find((x) => x.classId === e.cls);
        if (o) { a.credits += 5000; const r = E.recruit(g.roster, a, o.id, null); if (r.ok) id = r.soldier.id; else return { error: r.reason }; }
        else { a.credits += 100; E.refreshOffers(g.roster, a, null, null); }
      }
      if (!id) return { error: 'no offer for ' + e.cls };
      const s = g.roster.get(id); setLvl(s, e.level); ids.push(id);
    }
    if (spec.squadTrain) for (const k of Object.keys(a.squadTraining)) a.squadTraining[k] = spec.squadTrain;
    a.credits = 0;
    return { ids };
  }, spec);
}

/** One mission with the autopilot. ids = roster ids to deploy (null: best owned up to the cap). */
async function playOne(page, missionId, ids, opts = {}) {
  return page.evaluate(async ({ missionId, ids, PREF, opts }) => {
    const g = window.game;
    g.selectMission(missionId, true);
    const cap = g.capacity;
    const pick = ids ?? [...new Set([...(opts.prefer || []), ...PREF, ...g.roster.owned().map((s) => s.id)])].filter((id) => g.roster.isUnlocked(id) && g.roster.get(id)?.status !== 'kia').slice(0, cap);
    const dep = g.deploy(pick.map((id) => g.roster.get(id)), 'roster');
    if (!dep.ok) return { error: dep.reason, pick };
    const squad = g.soldiers.map((s) => `${s.name}/${s.identity.classId[0].toUpperCase()}${s.identity.progression?.level ?? '?'}`);
    let mv = { x: 0, y: 0 };
    g.input.move = () => mv;
    let path = null, pathT = 0, pathGoal = null;
    const st = { downs: 0, revives: 0, bleedouts: 0, npcDamage: 0, npcDowns: 0, bossStart: null, bossEnd: null, extractionAt: null, dodges: 0, rocketHits: 0, mgHits: 0, forcedDown: false };
    const prev = new Map();
    // squad damage taken by source (boss rocket / boss MG / enemy kind) and the source of each down
    const taken = {}, downBy = {}, lastHit = new Map();
    const dmg0 = g.damage;
    g.damage = function (u, amount, source, o = {}) {
      if (u.team === 'squad' && !u.npc && u.active && source) {
        const k = source.kind === 'boss' ? (o.grenade ? 'boss-rocket' : 'boss-mg') : (source.kind || 'rifleman');
        const before = u.hp;
        dmg0.call(this, u, amount, source, o);
        taken[k] = (taken[k] ?? 0) + Math.max(0, before - Math.max(0, u.hp));
        lastHit.set(u, k);
        return;
      }
      return dmg0.call(this, u, amount, source, o);
    };
    const npcHp0 = () => g.npcs?.[0]?.hp ?? 0;
    let npcLast = null;
    const MAXT = 60 * 60 * 10; // 10 game minutes
    for (let step = 0; step < MAXT && g.phase === 'playing'; step++) {
      const m = g.mission, b = m.boss;
      if (b && st.bossStart === null) st.bossStart = g.time;
      // scenario 6: force a soldier down the moment extraction is ready
      if (opts.downAtExtraction && !st.forcedDown && m.phase === 'available') {
        const s = g.soldiers.find((x) => x.active); if (s) { g.debugDownSoldier(); st.forcedDown = true; }
      }
      const downed = g.soldiers.find((s) => s.state === 'downed');
      const npc = g.npcs?.[0];
      let goal = null;
      if (downed) goal = downed.pos;
      else if (npc && npc.state === 'downed') goal = npc.pos;
      else {
        const opt = m.optionals.find((o) => o.state === 'active' && o.point(m, g));
        const p = opt ? opt.point(m, g) : m.objectivePoint(g);
        goal = p ? p.pos : null;
        // the boss: keep ~300 px (the policy fights from range; no point walking into the Warden)
        if (b && b.unit.active && goal) {
          const d = Math.hypot(b.unit.pos.x - g.anchor.x, b.unit.pos.y - g.anchor.y);
          if (d < 360) goal = null;
        }
        // convoy: intercept the nearest truck ahead on its route instead of chasing it
        if (m.convoy && goal && m.currentObjective?.id === 'convoy' || (m.convoy && opt && opt.id === 'all-trucks')) {
          const c = m.convoy, tr = c.trucks.filter((t) => t.state === 'moving' && t.unit).sort((p, q) => Math.hypot(p.unit.pos.x - g.anchor.x, p.unit.pos.y - g.anchor.y) - Math.hypot(q.unit.pos.x - g.anchor.x, q.unit.pos.y - g.anchor.y))[0];
          if (tr) { const d = Math.hypot(tr.unit.pos.x - g.anchor.x, tr.unit.pos.y - g.anchor.y); goal = d > 300 ? c.at(tr.s + Math.min(500, d * 0.5)).p : tr.unit.pos; }
          else if (c.trucks.some((t) => t.state === 'waiting')) goal = c.at(900).p; // wait near the route
        }
      }
      if (npc && npc.escorting && npc.active && Math.hypot(npc.pos.x - g.anchor.x, npc.pos.y - g.anchor.y) > 200) goal = npc.pos;
      const fighting = g.soldiers.some((s) => s.active && s.target && !s.target.structure && !s.target.vehicle);
      pathT -= 1 / 60;
      if (goal && (pathT <= 0 || !pathGoal || Math.hypot(goal.x - pathGoal.x, goal.y - pathGoal.y) > 80)) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; pathGoal = { ...goal }; }
      mv = { x: 0, y: 0 };
      if (goal && path && path.length) {
        while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 20) path.shift();
        const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
        const hold = fighting && !downed && !m.convoy && step % 240 < 150;
        if (d > 8 && !hold) mv = { x: dx / d, y: dy / d };
      }
      // dodge: the rocket circle (move straight out of it) and the MG windup (step sideways)
      if (b && b.rocket) {
        const r = b.rocket, R = window.__CFG.boss.rocketRadius + 45;
        const dx = g.anchor.x - r.pos.x, dy = g.anchor.y - r.pos.y, d = Math.hypot(dx, dy) || 1;
        const anyIn = g.soldiers.some((s) => s.active && Math.hypot(s.pos.x - r.pos.x, s.pos.y - r.pos.y) < R);
        if (anyIn && d < R + 60) { mv = { x: dx / d, y: dy / d }; if (step % 30 === 0) st.dodges++; }
      } else if (b && b.phase === 'windup' && b.unit.active) {
        const a = b.fireAim, px = -Math.sin(a), py = Math.cos(a);
        const side = ((Math.floor(g.time / 6)) % 2) ? 1 : -1;
        mv = { x: px * side, y: py * side };
      }
      if (step % 90 === 0) {
        for (const s of g.soldiers) {
          if (!s.ability.ready(s)) continue;
          if (s.ability.targetingMode === 'instant') {
            const hurt = g.soldiers.some((o) => (o.active && o.hp < o.maxHp * 0.7) || o.state === 'downed');
            if ((s.ability.id === 'suppressive' && s.target && !s.target.structure) || (s.ability.id === 'fieldTreatment' && hurt) || (s.ability.id === 'focus' && s.target)) g.useAbility(s);
          } else if (s.target) {
            const t = s.target;
            if (npc && npc.escorting && Math.hypot(t.pos.x - npc.pos.x, t.pos.y - npc.pos.y) < 120) continue;
            if (Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y) > s.ability.range()) continue;
            g.targeting = s; g.onTargetConfirm(g.worldToScreen(t.pos)); break;
          }
        }
      }
      const hp0 = npc ? npc.hp : 0;
      g.update(1 / 60);
      if (npc && npc.escorting) st.npcDamage += Math.max(0, hp0 - npc.hp);
      if (npc && npcLast !== npc.state) { if (npc.state === 'downed') st.npcDowns++; npcLast = npc.state; }
      for (const s of g.soldiers) {
        const p = prev.get(s);
        if (p !== s.state) {
          if (s.state === 'downed') { st.downs++; const k = lastHit.get(s) ?? '?'; downBy[k] = (downBy[k] ?? 0) + 1; }
          if (p === 'downed' && s.state === 'active') st.revives++;
          if (p === 'downed' && s.state === 'kia') st.bleedouts++;
          prev.set(s, s.state);
        }
      }
      if (b && !b.unit.active && st.bossEnd === null) st.bossEnd = g.time;
      if (st.extractionAt === null && m.inExtraction) st.extractionAt = g.time;
    }
    g.damage = dmg0;
    const m = g.mission, rw = g.lastReward;
    const rows = g.stats.rows(g.soldiers);
    const dmg = Object.fromEntries(rows.map((r) => [r.classId, 0]));
    for (const r of rows) dmg[r.classId] += r.damage;
    const tot = rows.reduce((a, r) => a + r.damage, 0) || 1;
    const bossTot = [...g.bossDamage.values()].reduce((a, x) => a + x, 0) || 0;
    const bossBy = {};
    for (const [id, v] of g.bossDamage) { const c = g.roster.get(id)?.classId ?? '?'; bossBy[c] = (bossBy[c] ?? 0) + Math.round(v); }
    return {
      mission: missionId, squad, phase: g.phase, time: +g.time.toFixed(0), failReason: m.failReason,
      primaries: m.primaries.map((o) => `${o.id}:${o.state[0]}`).join(' '),
      optional: m.optional.map((o) => `${o.id}:${o.completed ? 'Y' : 'N'}`).join(' '),
      stars: g.lastStars?.stars ?? 0, downs: st.downs, revives: st.revives, kia: g.soldiers.filter((s) => s.state === 'kia').length,
      extracted: g.soldiers.filter((s) => s.state === 'active').length + '/' + g.soldiers.length,
      extractionAt: st.extractionAt === null ? null : +st.extractionAt.toFixed(0),
      npcDamage: g.npcs?.[0] ? Math.round(st.npcDamage) : null, npcDowns: g.npcs?.[0] ? st.npcDowns : null, escortRescues: g.escortRescues,
      boss: st.bossStart === null ? null : { duration: st.bossEnd === null ? null : +(st.bossEnd - st.bossStart).toFixed(0), rockets: m.boss?.rockets ?? 0, bursts: m.boss?.bursts ?? 0, hpLeft: m.boss?.unit.active ? Math.round(m.boss.unit.hp) : 0, damageByClass: bossBy, sniperShare: bossTot ? +((bossBy.sniper ?? 0) / bossTot).toFixed(2) : 0, log: (m.boss?.log ?? []).slice(0, 8) },
      sniperDamageShare: dmg.sniper !== undefined ? +(dmg.sniper / tot).toFixed(2) : null,
      convoy: m.convoy ? { destroyed: m.convoy.destroyed, escaped: m.convoy.escaped } : null,
      relays: m.primaries[0]?.alarm !== undefined ? { alarm: Math.round(m.primaries[0].alarm), waves: m.primaries[0].waves } : null,
      forcedDown: st.forcedDown || undefined, taken: Object.fromEntries(Object.entries(taken).map(([k, v]) => [k, Math.round(v)])), downBy,
      credits: rw ? rw.credits : 0, creditsAfter: rw ? rw.creditsAfter : null, unlocked: rw ? [...rw.unlockedMissions, ...(rw.unlockedRecruits ?? []), ...(rw.unlockedClasses ?? [])].join(',') : '',
    };
  }, { missionId, ids, PREF, opts });
}

/** Between missions (campaign scenario): resolve casualties like a thrifty player, buy named recruits / a Sniper when affordable. */
async function between(page) {
  return page.evaluate(() => {
    const g = window.game, a = window.__account(), E = window.__economy, C = window.__casualties;
    const out = { bought: [], res: [], mem: [] };
    let d;
    while ((d = a.pendingDecision) && d.queue.length) {
      const s = g.roster.get(d.queue[0].id), cost = C.costFor(s);
      if (a.credits >= cost) { E.resurrect(g.roster, a, s.id, null); out.res.push(s.name); } else { E.memorialize(g.roster, a, s.id, null); out.mem.push(s.name); }
    }
    if (a.phoenix.pending) E.enlistPhoenix(g.roster, a, a.phoenix.pending.candidates.slice(0, 3).map((c) => c.id), null, { cap: 6 });
    // named recruits first (Tank, Doc, Havoc, Patch), then a Sniper once unlocked
    for (const k of ['tank', 'doc', 'havoc', 'patch']) {
      if (a.named.unlocked.includes(k) && !a.named.claimed.includes(k) && a.credits >= 1000) { const r = E.recruitNamed(g.roster, a, k, null); if (r.ok) out.bought.push(k); }
    }
    if (a.classUnlocks.unlocked.includes('sniper') && !g.roster.owned().some((s) => s.classId === 'sniper')) {
      E.openOffice(g.roster, a, null);
      const o = a.recruitment.offers.find((x) => x.classId === 'sniper');
      out.sniperOffered = !!o;
      if (o && a.credits >= 1250) { const r = E.recruit(g.roster, a, o.id, null); if (r.ok) out.bought.push('sniper:' + r.soldier.name); }
    }
    out.credits = a.credits;
    out.levels = g.roster.owned().map((s) => `${s.name}${s.progression.level}`).join(' ');
    return out;
  });
}

function summarise(rows) {
  const by = {};
  for (const r of rows) (by[`${r.scenario}|${r.mission}`] ||= []).push(r);
  const out = [];
  for (const [k, rs] of Object.entries(by)) {
    const [scenario, mission] = k.split('|');
    const wins = rs.filter((r) => r.phase === 'won');
    const avg = (f, l = rs) => (l.length ? l.reduce((a, r) => a + f(r), 0) / l.length : 0);
    const boss = rs.filter((r) => r.boss && r.boss.duration !== null);
    out.push({
      scenario, mission, runs: rs.length, wins: `${wins.length}/${rs.length}`, avgWinTime: wins.length ? +avg((r) => r.time, wins).toFixed(0) : '-',
      downs: +avg((r) => r.downs).toFixed(2), revives: +avg((r) => r.revives).toFixed(2), kia: +avg((r) => r.kia).toFixed(2),
      optional: `${wins.filter((r) => r.optional && !r.optional.includes(':N')).length}/${wins.length}`, stars: wins.length ? +avg((r) => r.stars, wins).toFixed(2) : 0,
      npcDmg: rs[0].npcDamage === null ? '-' : +avg((r) => r.npcDamage).toFixed(0),
      bossTime: boss.length ? +avg((r) => r.boss.duration, boss).toFixed(0) : '-',
      sniperBossShare: boss.length && rs[0].squad.some((x) => /\/S/.test(x)) ? +avg((r) => r.boss.sniperShare, boss).toFixed(2) : '-',
    });
  }
  return out;
}

const L = (ids, level, train = 0) => ids.map((id) => ({ id, level, train }));
const SCENARIOS = {
  'no-sniper': { spec: { squad: L(['doc', 'tank', 'ace', 'ranger', 'havoc'], 6, 1), squadTrain: 1 }, missions: ['convoy-crusher', 'blackout', 'iron-fist'] },
  recruits: { spec: { squad: [...L(['ace', 'doc'], 4), { cls: 'infantry', level: 3 }, { cls: 'heavy', level: 3 }, { cls: 'medic', level: 3 }] }, missions: ['bridgehead', 'prison-break', 'convoy-crusher'] },
  'downed-extract': { spec: { squad: L(['doc', 'tank', 'ace', 'ranger'], 4, 1) }, missions: ['bridgehead'], opts: { downAtExtraction: true } },
  'm5-escort': { spec: { squad: L(['doc', 'tank', 'ace'], 4) }, missions: ['bring-them-home'] },
  'm7-escort': { spec: { squad: L(['doc', 'tank', 'ace', 'ranger', 'havoc'], 5) }, missions: ['prison-break'] },
  'm10-sniper': { spec: { sniper: true, squad: [...L(['doc', 'tank', 'ace', 'havoc'], 6, 1), { cls: 'sniper', level: 3 }], squadTrain: 1 }, missions: ['iron-fist'] },
  'm10-nosniper': { spec: { squad: L(['doc', 'tank', 'ace', 'ranger', 'havoc'], 6, 1), squadTrain: 1 }, missions: ['iron-fist'] },
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const rows = [], notes = [];
  for (const sc of SCEN) {
    if (sc === 'campaign') {
      for (let c = 1; c <= Math.max(1, Math.ceil(RUNS / 2)); c++) {
        await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL);
        for (const id of [...CH1, ...CH2]) {
          for (let attempt = 1; attempt <= 4; attempt++) {
            const prefer = await page.evaluate(() => window.game.roster.owned().filter((s) => s.classId === 'sniper').map((s) => s.id));
            const r = await playOne(page, id, null, { prefer });
            r.scenario = 'campaign'; r.run = c; r.attempt = attempt;
            const b = await between(page); r.after = b;
            rows.push(r);
            console.log(JSON.stringify({ sc, c, id, attempt, phase: r.phase, t: r.time, stars: r.stars, downs: r.downs, kia: r.kia, squad: r.squad.join(' '), opt: r.optional, boss: r.boss && { d: r.boss.duration, share: r.boss.sniperShare, by: r.boss.damageByClass }, after: b, err: r.error }));
            if (r.phase === 'won' || r.error) break;
          }
        }
      }
      continue;
    }
    const S = SCENARIOS[sc];
    for (let i = 1; i <= RUNS; i++) {
      const s = await setup(page, S.spec);
      if (s.error) { console.log(sc, 'setup error', s.error); notes.push(`${sc}: ${s.error}`); break; }
      for (const id of S.missions) {
        const r = await playOne(page, id, s.ids.slice(0, 5), S.opts || {});
        r.scenario = sc; r.run = i;
        rows.push(r);
        console.log(JSON.stringify({ sc, i, id, phase: r.phase, t: r.time, stars: r.stars, downs: r.downs, revives: r.revives, kia: r.kia, opt: r.optional, npc: r.npcDamage, boss: r.boss && { d: r.boss.duration, share: r.boss.sniperShare, by: r.boss.damageByClass, hpLeft: r.boss.hpLeft }, downBy: r.downBy, taken: r.taken, convoy: r.convoy, relays: r.relays, fail: r.failReason, err: r.error }));
        // fallen soldiers come back for the next mission of the scenario (fixed-squad scenarios)
        await page.evaluate(() => { const g = window.game, a = window.__account(); a.pendingDecision = null; for (const x of g.roster.soldiers) if (x.status === 'kia') x.status = 'active'; });
      }
    }
  }
  const sum = summarise(rows);
  console.table(sum);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), runsPerScenario: RUNS, rows, summary: sum, errors, notes }, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
