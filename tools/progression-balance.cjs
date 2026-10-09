// v0.3 balance: autopilot playthroughs of the real mission with ROSTER soldiers at different
// levels / training, reporting outcome, time, damage, survival and the XP + Credits each run
// pays. No enemy scaling exists; the mission is identical in every run. Also prints the XP
// curve and the Credits pacing math.
//   RUNS=3 node tools/progression-balance.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const RUNS = +(process.env.RUNS || 3);
const all = (n) => ({ accuracy: n, damage: n, hp: n, fireRate: n, moveSpeed: n });
const sq = (n) => ({ hp: n, damage: n, accuracy: n, fireRate: n });
const SCENARIOS = [
  { name: 'L1, no upgrades', squad: ['ace', 'tank', 'doc'], level: { ace: 1, tank: 1, doc: 1 }, training: {}, squadT: sq(0) },
  { name: 'L10, modest (rank 2 all, squad 1 all)', squad: ['ace', 'tank', 'doc'], level: { ace: 10, tank: 10, doc: 10 }, training: { ace: all(2), tank: all(2), doc: all(2) }, squadT: sq(1) },
  { name: 'L20, substantial (rank 6 all, squad 3 all)', squad: ['ace', 'tank', 'doc'], level: { ace: 20, tank: 20, doc: 20 }, training: { ace: all(6), tank: all(6), doc: all(6) }, squadT: sq(3) },
  { name: 'mixed: Ace L20 r6 / Tank L8 r2 / Doc L1', squad: ['ace', 'tank', 'doc'], level: { ace: 20, tank: 8, doc: 1 }, training: { ace: all(6), tank: all(2) }, squadT: sq(1) },
  { name: 'L1 + squad training maxed (5 all)', squad: ['ace', 'tank', 'doc'], level: { ace: 1, tank: 1, doc: 1 }, training: {}, squadT: sq(5) },
  { name: 'L1 duo Ranger+Havoc, no upgrades', squad: ['ranger', 'havoc'], level: { ranger: 1, havoc: 1 }, training: {}, squadT: sq(0) },
  { name: 'L20 duo Ranger+Havoc (r6, squad 3)', squad: ['ranger', 'havoc'], level: { ranger: 20, havoc: 20 }, training: { ranger: all(6), havoc: all(6) }, squadT: sq(3) },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  // v0.4: this tool plays the comms-outpost map, now Mission 3 (Field Medicine); unlock all (debug) first
  await page.evaluate(() => { window.__debugUnlockAll(); window.game.selectMission('field-medicine', true); });
  const summary = [];
  for (const sc of SCENARIOS) {
    const runs = [];
    for (let run = 1; run <= RUNS; run++) {
      const r = await page.evaluate(({ sc, run }) => {
        const g = window.game, P = window.__progression, A = window.__account;
        if (run === 1) window.__resetRosterSave(); // first run of a scenario = first clear
        for (const id of sc.squad) {
          const s = g.roster.get(id);
          s.progression.xp = P.xpForLevel(sc.level[id] || 1); s.progression.level = sc.level[id] || 1;
          s.training = { ...P.newTraining(), ...(sc.training[id] || {}) };
        }
        Object.assign(A().squadTraining, sc.squadT);
        const stats = sc.squad.map((id) => { const e = window.__effectiveStats(g.roster.get(id)); return `${id} hp ${Math.round(e.hp * 10) / 10} dmg ${Math.round(e.damage * 100) / 100} rate ${Math.round(e.fireRate * 100) / 100} cone ${Math.round(e.accuracy * 100) / 100}`; });
        const cr0 = A().credits;
        g.deploy(sc.squad.map((id) => g.roster.get(id)));
        let taken = 0;
        const orig = g.damage.bind(g);
        g.damage = (u, amount, source) => { if (u.team === 'squad' && u.active && !g.invuln) taken += Math.min(amount, Math.max(0, u.hp)); orig(u, amount, source); };
        let mv = { x: 0, y: 0 };
        g.input.move = () => mv;
        let path = null, pathT = 0;
        const outpost = { x: 2610, y: 780 }, extract = { x: 3210, y: 250 };
        for (let step = 0; step < 60 * 420 && g.phase === 'playing'; step++) {
          const m = g.mission;
          const goal = (m.phase === 'outpost' || m.phase === 'hold') ? outpost : extract;
          const fighting = g.soldiers.some((s) => s.active && s.target);
          pathT -= 1 / 60;
          if (pathT <= 0) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; }
          if (path && path.length) {
            while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 20) path.shift();
            const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
            mv = d > 8 && !(fighting && step % 240 < 150) ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
          }
          if (step % 90 === 0) {
            for (const s of g.soldiers) {
              if (!s.ability.ready(s)) continue;
              if (s.ability.targetingMode === 'instant') {
                const hurt = g.soldiers.some((o) => o.active && o.hp < o.maxHp * 0.7);
                if ((s.ability.id === 'suppressive' && s.target) || (s.ability.id === 'fieldTreatment' && hurt)) g.useAbility(s);
              } else if (s.target) { g.targeting = s; g.onTargetConfirm(g.worldToScreen(s.target.pos)); break; }
            }
          }
          g.update(1 / 60);
        }
        g.damage = orig;
        g.input.move = Object.getPrototypeOf(g.input).move.bind(g.input);
        const rows = g.stats.rows(g.soldiers);
        const rw = g.lastReward;
        const out = {
          phase: g.phase, time: g.time, dmg: rows.reduce((a, x) => a + x.damage, 0), kills: rows.reduce((a, x) => a + x.kills, 0),
          downs: rows.reduce((a, x) => a + x.downs, 0), kia: rows.filter((x) => x.status !== 'Standing').length, taken,
          credits: A().credits - cr0, xp: rw ? rw.xpEach : 0, first: rw ? rw.firstClear : false, stats,
        };
        if (g.phase !== 'playing') g.toBarracks();
        return out;
      }, { sc, run });
      runs.push(r);
      if (run === 1) console.log(`\n== ${sc.name}\n   ${r.stats.join('\n   ')}`);
      console.log(`   run ${run}: ${r.phase.toUpperCase().padEnd(6)} ${r.time.toFixed(1)}s  dmg ${Math.round(r.dmg)}  kills ${r.kills}  dmg taken ${Math.round(r.taken)}  downs ${r.downs}  lost ${r.kia}  -> +${r.xp} XP each, +${r.credits} CR${r.first ? ' (first clear)' : ''}`);
    }
    const n = runs.length, avg = (f) => runs.reduce((a, r) => a + f(r), 0) / n;
    summary.push({ name: sc.name, win: runs.filter((r) => r.phase === 'won').length, n, time: avg((r) => r.time), dmgps: avg((r) => r.dmg / r.time), taken: avg((r) => r.taken), downs: avg((r) => r.downs), kia: avg((r) => r.kia), cr: avg((r) => r.credits), xp: avg((r) => r.xp) });
  }
  console.log('\nSUMMARY (averages)');
  console.log('scenario'.padEnd(46), 'wins  time   dmg/s  taken  downs lost  CR    XP');
  for (const s of summary) console.log(s.name.padEnd(46), `${s.win}/${s.n}`.padEnd(5), s.time.toFixed(1).padStart(5), s.dmgps.toFixed(1).padStart(7), Math.round(s.taken).toString().padStart(6), s.downs.toFixed(1).padStart(5), s.kia.toFixed(1).padStart(4), Math.round(s.cr).toString().padStart(5), Math.round(s.xp).toString().padStart(5));

  // XP curve + pacing (pure math from the build's own tables)
  const pace = await page.evaluate(() => {
    const P = window.__progression;
    const lv = [2, 5, 10, 15, 20, 25].map((l) => ({ l, need: P.xpToNext(l - 1), total: P.xpForLevel(l) }));
    const missions = (total, first, replay) => (total <= first ? 1 : 1 + Math.ceil((total - first) / replay));
    const table = lv.map((x) => ({ ...x, at150: Math.ceil(x.total / 150), at125: Math.ceil(x.total / 125), realistic: missions(x.total, 150, 113), poor: missions(x.total, 100, 75) }));
    const ind = P.TRAINING.damage.costs.reduce((a, b) => a + b, 0), sqd = P.SQUAD_TRAINING.hp.costs.reduce((a, b) => a + b, 0);
    const wins = (cost, first, rep) => (cost <= first ? 1 : 1 + Math.ceil((cost - first) / rep));
    const goals = [['first upgrade (250)', 250], ['first squad upgrade (1000)', 1000], ['rank 5 in one stat (2800)', 2800], ['max one stat, one soldier (11,750)', ind],
      ['all 4 squad trainings maxed (43,000)', sqd * 4], ['one soldier fully trained (58,750)', ind * 5], ['everything: 6 soldiers + squad (395,500)', ind * 30 + sqd * 4]];
    return { table, goals: goals.map(([g, c]) => ({ g, c, perfect: wins(c, 1000, 650), typical: wins(c, 1000, 550), poor: wins(c, 750, 400) })) };
  });
  console.log('\nXP CURVE (XP to reach level; missions needed)');
  console.log('level  step  total   @150/msn  @125/msn  first150+replays113  first100+replays75');
  for (const x of pace.table) console.log(String(x.l).padStart(5), String(x.need).padStart(5), String(x.total).padStart(6), String(x.at150).padStart(9), String(x.at125).padStart(9), String(x.realistic).padStart(14), String(x.poor).padStart(18));
  console.log('\nCREDITS PACING (wins needed; first clear then replays)');
  console.log('goal'.padEnd(44), 'perfect(1000/650) typical(1000/550) rough(750/400)');
  for (const x of pace.goals) console.log(x.g.padEnd(44), String(x.perfect).padStart(8), String(x.typical).padStart(17), String(x.poor).padStart(15));
  console.log('ERRORS', errors);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
