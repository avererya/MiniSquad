// Autopilot mission playthroughs with ROSTER soldiers (traits included), reporting outcome,
// time, casualties and the Results-screen stats per soldier. An independent ledger wraps
// game.damage to cross-check that per-soldier damage/kills equal the HP actually removed
// from enemies (no overkill, no double counting).
//   SQUADS="ace+ranger,tank+havoc,ace+tank+doc,ranger+havoc+patch" RUNS=3 node tools/squads.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SQUADS = (process.env.SQUADS || 'ace+ranger,tank+havoc,ace+tank+doc,ranger+havoc+patch').split(',').map((s) => s.split('+'));
const RUNS = +(process.env.RUNS || 3);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  // v0.4: this tool plays the comms-outpost map, now Mission 3 (Field Medicine); unlock all (debug) first
  await page.evaluate(() => { window.__debugUnlockAll(); window.game.selectMission('field-medicine', true); });
  let ledgerFails = 0;
  for (const ids of SQUADS) {
    for (let run = 1; run <= RUNS; run++) {
      const r = await page.evaluate(({ ids }) => {
        const g = window.game;
        // v0.6: KIA is permanent; this attribution tool resolves earlier casualties for free (top-up + resurrect)
        // so every run deploys the same squad
        let d; while ((d = window.__account().pendingDecision) && d.queue.length) { const s = g.roster.get(d.queue[0].id); window.__account().credits += window.__casualties.costFor(s); window.__economy.resurrect(g.roster, window.__account(), s.id, null); }
        g.deploy(ids.map((id) => g.roster.get(id)));
        const ledger = { dmg: 0, kills: 0 };
        const orig = g.damage.bind(g);
        g.damage = (u, amount, source) => {
          const before = u.active ? Math.max(0, u.hp) : 0;
          const wasActive = u.active;
          orig(u, amount, source);
          if (u.team === 'enemy' && wasActive && source && source.team === 'squad') {
            ledger.dmg += before - Math.max(0, u.hp);
            if (u.state === 'dead') ledger.kills++;
          }
        };
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
        const sum = rows.reduce((a, x) => ({ dmg: a.dmg + x.damage, kills: a.kills + x.kills }), { dmg: 0, kills: 0 });
        const resultsShown = document.getElementById('menu').className === 'results' && document.querySelectorAll('.r-table tbody tr').length === rows.length;
        const out = { phase: g.phase, time: g.time, rows, ledger, sum, resultsShown };
        if (g.phase !== 'playing') g.toBarracks();
        return out;
      }, { ids });
      const ledgerOk = Math.abs(r.ledger.dmg - r.sum.dmg) < 1e-6 && r.ledger.kills === r.sum.kills;
      if (!ledgerOk || !r.resultsShown) ledgerFails++;
      const cas = r.rows.filter((x) => x.status !== 'Standing').map((x) => `${x.name} ${x.status}`).join(', ') || 'none';
      console.log(`${ids.join('+').padEnd(20)} run ${run}: ${r.phase.toUpperCase().padEnd(7)} ${r.time.toFixed(1)}s  casualties: ${cas}  | ledger ${ledgerOk ? 'OK' : 'MISMATCH'} (dmg ${Math.round(r.ledger.dmg)} = ${Math.round(r.sum.dmg)}, kills ${r.ledger.kills} = ${r.sum.kills}) results screen ${r.resultsShown ? 'OK' : 'MISSING'}`);
      for (const x of r.rows) console.log(`    ${x.name.padEnd(7)} K ${String(x.kills).padStart(2)}  dmg ${String(Math.round(x.damage)).padStart(5)}  heal ${String(Math.round(x.healing)).padStart(4)}  rev ${x.revives}  ${x.status}`);
    }
  }
  console.log(ledgerFails ? `\n${ledgerFails} run(s) with attribution mismatches` : '\nattribution ledger matched in every run');
  console.log('ERRORS', errors);
  await browser.close();
  process.exit(ledgerFails || errors.length ? 1 : 0);
})();
