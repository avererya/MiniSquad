// v0.4 campaign autopilot: plays the campaign missions headlessly (accelerated fixed-step sim)
// with a simple "competent new player" policy, and reports per-mission balance numbers.
//
//   MODE=new     fresh save; plays M1 -> M5 in order like a new player (retrying a failed
//                mission), choosing the best unlocked soldiers for each mission's cap.
//                Repeated CAMPAIGNS times. XP carries between missions (real progression).
//   MODE=legacy  the real v0.3 fixture save (upgraded roster: L4 soldiers + training); every
//                mission force-unlocked via the debug tool; RUNS runs per mission.
//   MODE=fixed   SQUAD=infantry+heavy (generic L1, no rewards), MISSIONS=..., RUNS=n
//
// Policy: walk to the current objective marker along A* paths, pause while fighting part of the
// time, walk to a downed soldier (squad AI then revives it), grenade visible targets, use
// Suppressive Fire / Field Treatment when useful. Usage: node tools/campaign.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const MODE = process.env.MODE || 'new';
const RUNS = +(process.env.RUNS || 5);
const CAMPAIGNS = +(process.env.CAMPAIGNS || 4);
const MISSIONS = (process.env.MISSIONS || 'first-contact,heavy-support,field-medicine,red-canyon,bring-them-home').split(',');
const JSON_OUT = process.env.JSON_OUT || '';
const OPT = process.env.OPT !== '0'; // detour for located optional objectives (default on)

// soldier preference per mission (first unlocked ones up to the cap)
const PREF = {
  'first-contact': ['ace', 'ranger'],
  'heavy-support': ['tank', 'ace', 'ranger', 'havoc'],
  'field-medicine': ['doc', 'tank', 'ace', 'ranger', 'havoc', 'patch'],
  'red-canyon': ['doc', 'tank', 'ace', 'ranger', 'havoc', 'patch'],
  'bring-them-home': ['doc', 'tank', 'ace', 'ranger', 'havoc', 'patch'],
};

async function playOne(page, missionId, squadSpec) {
  return page.evaluate(async ({ missionId, squadSpec, PREF, OPT }) => {
    const g = window.game;
    g.selectMission(missionId, true);
    if (squadSpec) g.reset(squadSpec);
    else {
      const cap = g.capacity;
      const ids = PREF[missionId].filter((id) => g.roster.isUnlocked(id)).slice(0, cap);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (!r.ok) return { error: r.reason };
    }
    const squadNames = g.soldiers.map((s) => `${s.name}(${s.identity?.progression ? 'L' + (window.__progression?.levelForXp?.(s.identity.progression.xp) ?? '?') : ''})`);
    let mv = { x: 0, y: 0 };
    g.input.move = () => mv;
    let path = null, pathT = 0, pathGoal = null;
    const bleedNotes = []; let minHp = 1, downs = 0, revives = 0, bleedouts = 0, maxNpcStuck = 0, extractionAt = null, firstObjAt = null;
    const prev = new Map();
    const MAXT = 60 * 60 * 9; // 9 game minutes
    for (let step = 0; step < MAXT && g.phase === 'playing'; step++) {
      const m = g.mission;
      // downed soldier -> go to them (the squad AI performs the revive)
      const downed = g.soldiers.find((s) => s.state === 'downed');
      let goal = null;
      if (downed) goal = downed.pos;
      else {
        // go for an optional objective first when it has a location (a star-hunting player)
        const opt = OPT ? m.optionals.find((o) => o.state === 'active' && o.point(m, g)) : null;
        const p = opt ? opt.point(m, g) : m.objectivePoint(g);
        goal = p ? p.pos : null;
      }
      // keep the captive close: if they fall behind, wait for them
      const npc = g.npcs?.[0];
      if (npc && npc.escorting && Math.hypot(npc.pos.x - g.anchor.x, npc.pos.y - g.anchor.y) > 260) goal = null;
      const fighting = g.soldiers.some((s) => s.active && s.target && !s.target.structure);
      pathT -= 1 / 60;
      if (goal && (pathT <= 0 || !pathGoal || Math.hypot(goal.x - pathGoal.x, goal.y - pathGoal.y) > 80)) {
        path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; pathGoal = { ...goal };
      }
      mv = { x: 0, y: 0 };
      if (goal && path && path.length) {
        while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 20) path.shift();
        const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
        const hold = fighting && !downed && step % 240 < 150;
        if (d > 8 && !hold) mv = { x: dx / d, y: dy / d };
      }
      if (step % 90 === 0) {
        for (const s of g.soldiers) {
          if (!s.ability.ready(s)) continue;
          if (s.ability.targetingMode === 'instant') {
            const hurt = g.soldiers.some((o) => (o.active && o.hp < o.maxHp * 0.7) || o.state === 'downed');
            if ((s.ability.id === 'suppressive' && s.target && !s.target.structure) || (s.ability.id === 'fieldTreatment' && hurt)) g.useAbility(s);
          } else if (s.target) {
            const t = s.target;
            if (npc && npc.escorting && Math.hypot(t.pos.x - npc.pos.x, t.pos.y - npc.pos.y) < 120) continue;
            g.targeting = s; g.onTargetConfirm(g.worldToScreen(t.pos)); break;
          }
        }
      }
      g.update(1 / 60);
      for (const s of g.soldiers) {
        const p = prev.get(s);
        if (p !== s.state) {
          if (s.state === 'downed') downs++;
          if (p === 'downed' && s.state === 'active') revives++;
          if (p === 'downed' && s.state === 'kia') {
            bleedouts++;
            const act = g.soldiers.filter((o) => o.state === 'active');
            const near = act.length ? Math.min(...act.map((o) => Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y))) : -1;
            const nObj = act.sort((a, b) => Math.hypot(a.pos.x - s.pos.x, a.pos.y - s.pos.y) - Math.hypot(b.pos.x - s.pos.x, b.pos.y - s.pos.y))[0];
            const los = nObj ? g.world.clear(nObj.pos, s.pos) : null;
            bleedNotes.push(`${s.name}@${g.time.toFixed(0)}s active=${act.length} nearest=${Math.round(near)} los=${los} pos=${Math.round(s.pos.x)},${Math.round(s.pos.y)} rpos=${nObj ? Math.round(nObj.pos.x) + ',' + Math.round(nObj.pos.y) : ''} anchorD=${Math.round(Math.hypot(g.anchor.x - s.pos.x, g.anchor.y - s.pos.y))} enemiesNear=${g.enemies.filter((e) => e.active && Math.hypot(e.pos.x - s.pos.x, e.pos.y - s.pos.y) < 400).length}`);
          }
          prev.set(s, s.state);
        }
      }
      { const tot = g.soldiers.reduce((a, s) => a + s.maxHp, 0), cur = g.soldiers.reduce((a, s) => a + (s.state === 'active' ? s.hp : 0), 0); minHp = Math.min(minHp, cur / tot); }
      if (npc) maxNpcStuck = Math.max(maxNpcStuck, npc.stuckT || 0);
      if (firstObjAt === null && m.primaries[0]?.state === 'complete') firstObjAt = g.time;
      if (extractionAt === null && m.inExtraction) extractionAt = g.time;
    }
    const m = g.mission;
    const rw = g.lastReward;
    return {
      squad: squadNames,
      phase: g.phase, time: +g.time.toFixed(1), failReason: m.failReason,
      primaries: m.primaries.map((o) => `${o.id}:${o.state}`).join(' '),
      optional: m.optional.map((o) => `${o.id}:${o.completed ? 'Y' : 'N'}`).join(' '),
      stars: g.lastStars?.stars ?? 0,
      bleedNotes: bleedNotes.join(' | '), downs, revives, bleedouts, minHp: +minHp.toFixed(2),
      kia: g.soldiers.filter((s) => s.state === 'kia').length,
      extracted: g.soldiers.filter((s) => s.state === 'active').length + '/' + g.soldiers.length,
      extractionAt: extractionAt === null ? null : +extractionAt.toFixed(0),
      xp: rw ? rw.soldiers.reduce((a, s) => a + s.xp, 0) : 0,
      credits: rw ? rw.credits : 0,
      firstClear: rw?.firstClear ?? false,
      unlocked: rw ? [...rw.unlockedMissions, ...rw.unlockedSoldiers].join(',') : '',
      escortRescues: g.escortRescues, maxNpcStuck: +maxNpcStuck.toFixed(1),
      npcHp: g.npcs?.[0] ? Math.round(g.npcs[0].hp) : null,
    };
  }, { missionId, squadSpec, PREF, OPT });
}

function summarise(rows) {
  const by = {};
  for (const r of rows) (by[r.mission] ||= []).push(r);
  const out = [];
  for (const [mission, rs] of Object.entries(by)) {
    const wins = rs.filter((r) => r.phase === 'won');
    const avg = (f, list = rs) => list.length ? (list.reduce((a, r) => a + f(r), 0) / list.length) : 0;
    out.push({
      mission, runs: rs.length, wins: wins.length, winRate: Math.round(100 * wins.length / rs.length) + '%',
      avgTimeWin: avg((r) => r.time, wins).toFixed(0), avgDowns: avg((r) => r.downs).toFixed(2), avgMinHp: avg((r) => r.minHp).toFixed(2),
      revives: rs.reduce((a, r) => a + r.revives, 0), bleedouts: rs.reduce((a, r) => a + r.bleedouts, 0),
      kiaRuns: rs.filter((r) => r.kia > 0).length, fullExtract: wins.filter((r) => r.kia === 0).length,
      optional: wins.filter((r) => r.optional && !r.optional.includes(':N')).length + '/' + wins.length,
      avgStars: avg((r) => r.stars, wins).toFixed(2), avgXp: avg((r) => r.xp, wins).toFixed(0), avgCr: avg((r) => r.credits, wins).toFixed(0),
      escortRescues: rs.reduce((a, r) => a + (r.escortRescues || 0), 0),
    });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const rows = [];
  if (MODE === 'new') {
    for (let c = 0; c < CAMPAIGNS; c++) {
      await page.goto(URL);
      await page.evaluate(() => { localStorage.clear(); });
      await page.goto(URL);
      for (const id of MISSIONS) {
        for (let attempt = 1; attempt <= 4; attempt++) {
          const r = await playOne(page, id, null);
          r.mission = id; r.campaign = c + 1; r.attempt = attempt;
          rows.push(r);
          console.log(JSON.stringify(r));
          if (r.phase === 'won' || r.error) break;
        }
      }
    }
  } else {
    if (MODE === 'legacy') {
      const fx = fs.readFileSync(__dirname + '/fixtures/v0.3-save.json', 'utf8');
      await page.goto(URL);
      await page.evaluate((fx) => { localStorage.clear(); localStorage.setItem(window.__SAVE_KEY, fx); }, fx);
      await page.goto(URL);
      await page.evaluate(() => window.__debugUnlockAll());
    } else await page.goto(URL);
    const spec = MODE === 'fixed' ? (process.env.SQUAD || 'infantry+infantry').split('+') : null;
    for (const id of MISSIONS) for (let i = 0; i < RUNS; i++) {
      const r = await playOne(page, id, spec);
      r.mission = id; r.run = i + 1;
      rows.push(r);
      console.log(JSON.stringify(r));
    }
  }
  const sum = summarise(rows);
  console.table(sum);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ mode: MODE, rows, summary: sum, errors }, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
