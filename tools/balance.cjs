// Balance experiments (headless, sim stepped directly).
//   MODE=accuracy  controlled hit-rate tests: one shooter vs one dummy target at fixed distances
//   MODE=missions  autopilot mission runs per squad preset, N runs each
// CONFIG=old applies the v0.1.2 weapon values (projectile 950, Infantry 7° still / +18° moving)
// on top of the current build; CONFIG=new (default) uses the build's defaults.
// Works against the v0.1.2 build too (URL=...), where only 'infantry' and squad sizes exist.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const MODE = process.env.MODE || 'accuracy';
const CONFIG = process.env.CONFIG || 'new';
const RUNS = +(process.env.RUNS || 6);
const CLASSES = (process.env.CLASSES || 'infantry,heavy,medic').split(',');
const PRESETS = (process.env.PRESETS || 'infantry+infantry,infantry+heavy,infantry+medic,infantry+heavy+medic').split(',');
const OLD_RATE = process.env.OLD_RATE === '1'; // also restore Infantry fire rate 4/s
// STYLE=push (default): keeps advancing ~37% of the time under fire. STYLE=careful: stops whenever anyone has a target.
const STYLE = process.env.STYLE || 'push';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.click('[data-a="deploy"]');
  const out = await page.evaluate(async ({ MODE, CONFIG, RUNS, CLASSES, PRESETS, OLD_RATE, STYLE }) => {
    const g = window.game;
    const v2 = typeof g.useAbility === 'function';
    const CFG = window.__CFG; // undefined on the v0.1.2 build
    const groupOf = (cls) => (CFG ? CFG[cls] : null);
    if (CONFIG === 'old' && CFG) {
      for (const c of ['infantry', 'heavy', 'medic']) CFG[c].projectileSpeed = 950;
      CFG.infantry.accuracy = 7; CFG.infantry.movePenalty = 18;
      if (OLD_RATE) CFG.infantry.fireRate = 4;
    }
    if (CONFIG === 'speedonly' && CFG) { CFG.infantry.accuracy = 7; CFG.infantry.movePenalty = 18; } // 700 px/s, old spread
    if (CONFIG === 'spreadonly' && CFG) { for (const c of ['infantry', 'heavy', 'medic']) CFG[c].projectileSpeed = 950; } // new spread, old speed
    const resetSquad = (classes) => { if (v2) g.reset(classes); else g.reset(classes.length); };
    // bullet damage per class (to tell bullets from grenade blasts in g.damage)
    const bulletDmg = new Set([6, 7, 10]);
    const r1 = (x) => Math.round(x * 10) / 10;

    if (MODE === 'accuracy') {
      const rows = [];
      const DIST = [150, 250, 350, 410];
      const SCEN = ['still_vs_still', 'still_vs_strafe', 'moving_vs_still', 'moving_vs_strafe'];
      for (const cls of CLASSES) {
        for (const D of DIST) {
          for (const sc of SCEN) {
            resetSquad([cls]);
            g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.pickups = [];
            g.mission.update = () => {};
            g.invuln = true;
            const s = g.soldiers[0];
            const home = { x: 300, y: 1400 };
            s.pos = { ...home }; g.anchor = { ...home }; g.cam = { ...home };
            if (s.ability) s.ability.cooldownLeft = 1e9;
            const e = g.spawnEnemy({ x: home.x, y: home.y - D });
            e.hp = 1e9; e.reactionTime = 1e9; e.guard = true;
            const shooterMoves = sc.startsWith('moving'), targetMoves = sc.endsWith('strafe');
            g.input.move = () => (shooterMoves ? { x: Math.floor(g.time / 1.5) % 2 ? -1 : 1, y: 0 } : { x: 0, y: 0 });
            let shots = 0, hits = 0, dmg = 0, ex = home.x, dir = 1;
            const seen = new Set();
            const origDamage = g.damage.bind(g);
            g.damage = (u, amount) => { if (u === e) { hits++; dmg += amount; } origDamage(u, amount); };
            const T = +(window.__T || 60);
            for (let i = 0; i < T * 60; i++) {
              g.update(1 / 60);
              for (const p of g.projectiles) if (p.team === 'squad' && !seen.has(p)) { seen.add(p); shots++; }
              if (targetMoves) { ex += dir * 95 / 60; if (Math.abs(ex - home.x) > 71) dir = -dir; }
              e.pos = { x: targetMoves ? ex : s.pos.x, y: home.y - D }; e.vel = { x: 0, y: 0 };
            }
            g.damage = origDamage;
            rows.push({ cls, D, sc, shots, hits, pct: shots ? r1((hits / shots) * 100) : 0, dps: r1(dmg / T), los: g.world.clear(home, { x: home.x, y: home.y - D }) });
          }
        }
      }
      return { rows };
    }

    // ---------------- missions ----------------
    const results = [];
    for (const preset of PRESETS) {
      const classes = preset.split('+');
      for (let run = 0; run < RUNS; run++) {
        resetSquad(classes);
        g.invuln = false;
        let mv = { x: 0, y: 0 };
        g.input.move = () => mv;
        let path = null, pathT = 0, kills = 0, nades = 0, supp = 0, treats = 0;
        let shots = 0, hits = 0, bulletDmg_ = 0, taken = 0, downs = 0;
        const seen = new Set();
        const origDamage = g.damage.bind(g);
        g.damage = (u, amount) => {
          if (u.active) {
            if (u.team === 'enemy' && bulletDmg.has(amount)) { hits++; bulletDmg_ += Math.min(amount, Math.max(0, u.hp)); }
            if (u.team === 'squad' && !g.invuln) { taken += amount; if (u.hp - amount <= 0) downs++; }
          }
          origDamage(u, amount);
        };
        const outpost = { x: 2610, y: 780 }, extract = { x: 3210, y: 250 };
        let prevEnemies = g.enemies.length;
        for (let step = 0; step < 60 * 400 && g.phase === 'playing'; step++) {
          const m = g.mission;
          // go revive downed squadmates first, like a player would; else push the objective
          const downed = g.soldiers.find((s) => s.state === 'downed');
          let goal = downed ? downed.pos : (m.phase === 'outpost' || m.phase === 'hold') ? outpost : extract;
          const fighting = g.soldiers.some((s) => s.active && s.target);
          pathT -= 1 / 60;
          if (pathT <= 0) { path = g.world.findPath(g.anchor, goal, 12); pathT = 0.5; }
          if (path && path.length) {
            while (path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 20) path.shift();
            const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
            const pause = fighting && !downed && (STYLE === 'careful' || step % 240 < 150); // stop and shoot
            mv = d > 8 && !pause ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
          }
          if (step % 30 === 0) {
            for (const s of g.soldiers) {
              const ab = s.ability;
              if (!ab || !s.active || !ab.ready(s)) continue;
              if ((ab.id ?? 'grenade') === 'grenade') {
                if (step % 90 === 0 && s.target) { g.targeting = s; g.onTargetConfirm(g.worldToScreen(s.target.pos)); nades++; }
              } else if (ab.id === 'suppressive') {
                if (s.target) { if (g.useAbility(s)) supp++; }
              } else if (ab.id === 'fieldTreatment') {
                const hurt = g.soldiers.some((o) => o.active && o.hp < o.maxHp * 0.7 && Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y) <= window.__CFG.fieldTreatment.radius);
                if (hurt && g.useAbility(s)) treats++;
              }
            }
          }
          g.update(1 / 60);
          for (const p of g.projectiles) if (p.team === 'squad' && !seen.has(p)) { seen.add(p); shots++; }
          const living = g.enemies.length;
          if (living < prevEnemies) kills += prevEnemies - living;
          prevEnemies = living;
        }
        g.damage = origDamage;
        // v0.2.1 counts shots at the gun (exact); the v0.1.2 build only allows counting projectiles seen after a step
        const seenShots = shots;
        if (g.soldiers[0] && typeof g.soldiers[0].shots === 'number') shots = g.soldiers.reduce((a, s) => a + s.shots, 0);
        results.push({
          preset, run, phase: g.phase, time: r1(g.time), kills, nades, supp, treats,
          kia: g.soldiers.filter((s) => s.state !== 'active').length, downs,
          shots, seenShots, hits, hitPct: shots ? r1((hits / shots) * 100) : 0, bulletDmg: Math.round(bulletDmg_), taken: Math.round(taken),
          final: g.soldiers.map((s) => `${s.name}:${s.state}`).join(' '),
        });
      }
    }
    return { results };
  }, { MODE, CONFIG, RUNS, CLASSES, PRESETS, OLD_RATE, STYLE });
  console.log(JSON.stringify(out));
  if (errors.length) console.error('ERRORS', errors);
  await browser.close();
})();
