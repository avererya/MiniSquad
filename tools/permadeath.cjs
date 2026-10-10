// v0.6 permanent death: rule checks against the live game (combat timers, extraction warning,
// SimClock / backgrounding, mission-end transaction, casualty decisions, restricted dismissal,
// Memorial, Operation Phoenix, save v5 migration + repairs) and the 12 end-to-end scenarios.
// Prints PASS/FAIL per check (scenarios tagged [S1]..[S12]) and exits 1 on any failure.
// Usage: npx vite preview --port 4173 & node tools/permadeath.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const FIXTURE_V05 = fs.readFileSync(__dirname + '/fixtures/v0.5-save.json', 'utf8');

// page-side helpers (window.T), installed before the game boots
function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get C() { return window.__casualties; },
    /** Advance the simulation `sec` seconds in fixed 1/60 s steps; `pin` runs before every step. */
    step(sec, pin) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (pin) pin(); window.game.update(1 / 60); } return n; },
    stepUntil(cond, maxSec, pin) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (pin) pin(); window.game.update(1 / 60); n++; } return n; },
    clearEnemies() { const g = window.game; g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.mission.defenders = [{ active: true }]; g.invuln = false; g.input.move = () => ({ x: 0, y: 0 }); },
    unit(id) { return window.game.soldiers.find((s) => s.identity?.id === id); },
    /** Roster deployment on Field Medicine (capacity 3), enemies removed. */
    roster(ids, mission = 'field-medicine') {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok) this.clearEnemies();
      return r;
    },
    temp(ids, mission = 'field-medicine') { const g = window.game; g.selectMission(mission, true); const r = g.deploy(ids.map((id) => g.roster.get(id)), 'temp'); this.clearEnemies(); return r; },
    generic(classes, mission = 'field-medicine') { const g = window.game; g.selectMission(mission, true); g.reset(classes); this.clearEnemies(); },
    /** Keep a unit at a fixed spot (pins happen before every step). */
    /** Keep units at fixed spots before every step; also removes enemies the mission spawns (waves) unless T.calm = false. */
    calm: true,
    pinner(list) { return () => { for (const [u, p] of list) { u.pos = { ...p }; u.vel = { x: 0, y: 0 }; } if (this.calm) { for (const e of window.game.enemies) e.state = 'dead'; window.game.enemies = []; } }; },
    far(p, d = 700) { return { x: p.x + d, y: p.y }; },
    /** Bleed a roster soldier out (squad-mates pinned far away). */
    bleedOut(id) {
      const g = window.game, d = this.unit(id); g.downSoldier(d);
      const others = g.soldiers.filter((s) => s !== d && s.active);
      const spot = { x: d.pos.x + 900, y: d.pos.y };
      g.anchor = { ...spot };
      const pin = this.pinner(others.map((o, i) => [o, { x: spot.x, y: spot.y + i * 30 }]));
      this.stepUntil(() => d.state === 'kia', 25, pin);
      return d.state;
    },
    store() { return JSON.parse(localStorage.getItem(window.__SAVE_KEY)); },
    resolveAll(policy = 'resurrect') {
      const g = window.game, a = window.__account(), E = window.__economy; let d;
      while ((d = a.pendingDecision) && d.queue.length) {
        const s = g.roster.get(d.queue[0].id);
        if (policy === 'resurrect') { a.credits += window.__casualties.costFor(s); E.resurrect(g.roster, a, s.id, window.__persist); } else E.memorialize(g.roster, a, s.id, window.__persist);
      }
    },
    snap(id) { const s = window.game.roster.get(id); return s ? JSON.stringify({ ...s, status: undefined, resurrections: undefined, service: { ...s.service, deaths: undefined } }) : null; },
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const results = [];
  const add = (list) => { for (const r of list) { results.push(r); console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  -> ' + r.detail}`); } };
  const fresh = async (unlock = true) => {
    await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL);
    if (unlock) await page.evaluate(() => window.__debugUnlockAll());
  };
  const reload = async () => { await page.reload(); await page.waitForFunction(() => !!window.game); };
  const run = (fn, arg) => page.evaluate(fn, arg);

  // ======================= A. pricing =======================
  await fresh();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const C = window.__casualties;
    const reg = [0, 1, 2, 3, 4, 5, 6, 7, 12, 99].map((n) => C.resurrectionCost(n));
    check('pricing: 1st-7th = 1000/2000/3500/5000/7000/8500/10000, 8th+ capped at 10000', reg.join(',') === '1000,2000,3500,5000,7000,8500,10000,10000,10000,10000', reg);
    const el = [0, 1, 2, 3, 4, 6].map((n) => C.resurrectionCost(n, 'elite'));
    check('pricing: Elite = regular x2, capped at 10000', el.join(',') === '2000,4000,7000,10000,10000,10000', el);
    const g = window.game, ace = g.roster.get('ace');
    const base = C.costFor(ace); ace.progression.xp = 99999; ace.progression.level = 10; const hi = C.costFor(ace); ace.progression.xp = 0; ace.progression.level = 1;
    check('pricing: level / XP is irrelevant (same soldier at L1 and L10)', base === 1000 && hi === 1000, `${base} ${hi}`);
    check('pricing: bad inputs are safe (NaN / negative -> first price)', C.resurrectionCost(NaN) === 1000 && C.resurrectionCost(-3) === 1000, `${C.resurrectionCost(NaN)} ${C.resurrectionCost(-3)}`);
    return out;
  }));

  // ======================= B. combat: bleed-out, revives =======================
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g } = T, R = window.__CFG.revive;
    check('config: bleed-out 20 s, revive radius 55, revive HP 30%', R.bleedOut === 20 && R.radius === 55 && R.hpFrac === 0.3, JSON.stringify({ b: R.bleedOut, r: R.radius, h: R.hpFrac }));

    // [S2] exact 20 s bleed-out (= 1200 fixed steps)
    T.generic(['infantry', 'infantry']);
    let [d, o] = g.soldiers; g.downSoldier(d);
    let spot = T.far(d.pos); g.anchor = { ...spot };
    let pin = T.pinner([[o, spot]]);
    const n = T.stepUntil(() => d.state !== 'downed', 30, pin);
    check('[S2] bleed-out: exactly 20 s of simulation (1200 fixed steps) -> KIA', n >= 1199 && n <= 1201 && d.state === 'kia' && d.kiaCause === 'bleedout', `${n} steps, ${d.state} ${d.kiaCause}`);
    // KIA is final in the mission
    o.pos = { ...d.pos }; g.anchor = { ...d.pos }; T.step(15, T.pinner([[o, d.pos]]));
    check('KIA cannot be revived in the mission (reviver adjacent for 15 s)', d.state === 'kia' && d.reviveProgress === 0, `${d.state} ${d.reviveProgress}`);

    // [S1] revive pauses the bleed-out, interrupt keeps progress and resumes the timer
    T.generic(['infantry', 'infantry']);
    [d, o] = g.soldiers; g.downSoldier(d);
    T.step(4, T.pinner([[o, T.far(d.pos)]]));
    const b0 = d.bleed;
    T.step(5, T.pinner([[o, d.pos]]));
    const b1 = d.bleed, p1 = d.reviveProgress, pausedFlag = d.reviving;
    T.step(3, T.pinner([[o, T.far(d.pos)]]));
    const b2 = d.bleed, p2 = d.reviveProgress;
    const back = T.stepUntil(() => d.state === 'active', 10, T.pinner([[o, d.pos]]));
    check('valid revive pauses the bleed-out (5 s of reviving: timer unchanged, progress 50%)', Math.abs(b0 - 16) < 0.02 && Math.abs(b1 - b0) < 1e-9 && Math.abs(p1 - 0.5) < 0.01 && pausedFlag, `bleed ${b0.toFixed(2)} -> ${b1.toFixed(2)}, progress ${p1.toFixed(3)}`);
    check('interrupted revive: progress kept, remaining bleed-out resumes (no reset, no extension)', Math.abs(p2 - p1) < 1e-9 && Math.abs(b2 - (b1 - 3)) < 0.02, `progress ${p2.toFixed(3)}, bleed ${b2.toFixed(2)}`);
    check('[S1] downed + revived: completes the remaining 50% (5 s) -> active at 30% HP', d.state === 'active' && Math.abs(back - 300) <= 2 && Math.round(d.hp) === 30 && d.bleed > 0, `${back} steps, ${d.state}, hp ${d.hp}`);

    // proximity just outside the radius does NOT pause; just inside does
    T.generic(['infantry', 'infantry']);
    [d, o] = g.soldiers; g.downSoldier(d);
    const outP = { x: d.pos.x + R.radius + 4, y: d.pos.y };
    g.anchor = { ...outP };
    T.step(2, T.pinner([[o, outP]]));
    const outB = d.bleed, outProg = d.reviveProgress;
    const inP = { x: d.pos.x + R.radius - 4, y: d.pos.y };
    T.step(2, T.pinner([[o, inP]]));
    check('proximity outside the 55 px radius does not pause (2 s -> 18 s left, no progress)', Math.abs(outB - 18) < 0.02 && outProg === 0, `${outB.toFixed(2)} ${outProg}`);
    check('inside the radius with a clear line: revive progresses, timer paused', Math.abs(d.bleed - outB) < 1e-9 && d.reviveProgress > 0.19, `${d.bleed.toFixed(2)} ${d.reviveProgress.toFixed(2)}`);

    // blocked line of sight within the radius: no pause, no progress
    T.generic(['infantry', 'infantry']);
    const w = g.world; let pair = null;
    const offs = [[40, 0], [0, 40], [36, 30], [30, 36], [-36, 30], [-30, 36], [48, 20], [20, 48]];
    for (let y = 60; y < w.h - 60 && !pair; y += 6) for (let x = 60; x < w.w - 60 && !pair; x += 6) for (const [dx, dy] of offs) {
      const p = { x, y }, q = { x: x + dx, y: y + dy };
      if (Math.hypot(dx, dy) < R.radius - 2 && !w.insideObstacle(p, 14) && !w.insideObstacle(q, 14) && [-6, 0, 6].every((jx) => [-6, 0, 6].every((jy) => !w.clear(p, { x: q.x + jx, y: q.y + jy })))) { pair = [p, q]; break; }
    }
    [d, o] = g.soldiers;
    if (pair) {
      d.pos = { ...pair[0] }; g.downSoldier(d); g.anchor = { ...pair[1] };
      T.step(3, T.pinner([[d, pair[0]], [o, pair[1]]]));
    }
    check('blocked line of sight inside the radius: not a valid revive (timer runs, no progress)', pair && Math.abs(d.bleed - 17) < 0.02 && d.reviveProgress === 0 && !d.reviving, pair ? `${JSON.stringify(pair)} bleed ${d.bleed.toFixed(2)} prog ${d.reviveProgress}` : 'no wall pair found');

    // class durations (generic soldiers, no traits) + First Responder (Doc) + 30% HP of the revived class
    const dur = {};
    for (const cls of ['infantry', 'heavy', 'medic']) {
      T.generic([cls, 'heavy']);
      const [rv, dn] = g.soldiers; g.downSoldier(dn); g.anchor = { ...dn.pos };
      dur[cls] = { steps: T.stepUntil(() => dn.state === 'active', 20, T.pinner([[rv, dn.pos]])), hp: dn.hp, max: dn.maxHp, rt: rv.soldierStats.reviveTime };
    }
    check('revive duration by class: Infantry 10 s / Heavy 12 s / Medic 5 s', Math.abs(dur.infantry.steps - 600) <= 2 && Math.abs(dur.heavy.steps - 720) <= 2 && Math.abs(dur.medic.steps - 300) <= 2, JSON.stringify(dur));
    check('revive restores 30% of max HP (Heavy 150 -> 45)', Object.values(dur).every((x) => Math.abs(x.hp - x.max * 0.3) < 1e-6), JSON.stringify(Object.values(dur).map((x) => `${x.hp}/${x.max}`)));
    T.temp(['doc', 'ace']);
    const doc = T.unit('doc'), ace = T.unit('ace'); g.downSoldier(ace); g.anchor = { ...ace.pos };
    const fr = T.stepUntil(() => ace.state === 'active', 20, T.pinner([[doc, ace.pos]]));
    check('First Responder intact: Doc (Medic, -10%) revives in 4.5 s', Math.abs(doc.soldierStats.reviveTime - 4.5) < 1e-9 && Math.abs(fr - 270) <= 2, `${doc.soldierStats.reviveTime} s, ${fr} steps`);
    // fastest reviver counts, no stacking
    T.generic(['medic', 'infantry', 'infantry']);
    const [md, inf, dn2] = g.soldiers; g.downSoldier(dn2); g.anchor = { ...dn2.pos };
    const both = T.stepUntil(() => dn2.state === 'active', 20, T.pinner([[md, dn2.pos], [inf, { x: dn2.pos.x + 10, y: dn2.pos.y }]]));
    check('two revivers: the fastest counts, they do not stack (Medic + Infantry = 5 s)', Math.abs(both - 300) <= 2, `${both} steps`);

    // multiple downed: independent timers; reviving one doesn't pause the other
    T.generic(['infantry', 'infantry', 'infantry']);
    const [x1, x2, rv] = g.soldiers; x2.pos = { x: x1.pos.x + 400, y: x1.pos.y };
    g.downSoldier(x1); g.downSoldier(x2); g.anchor = { ...x1.pos };
    const calm = T.pinner([]);
    const pinM = () => { x2.pos = { x: x1.pos.x + 400, y: x1.pos.y }; rv.pos = { ...x1.pos }; calm(); };
    T.step(5, pinM);
    const m1 = [x1.bleed, x2.bleed];
    T.stepUntil(() => x2.state !== 'downed', 20, pinM);
    check('multiple downed: separate timers; reviving one does not pause the other', Math.abs(m1[0] - 20) < 1e-9 && Math.abs(m1[1] - 15) < 0.02 && x1.state === 'active' && x2.state === 'kia', `after 5 s ${m1.map((v) => v.toFixed(2))}, final ${x1.state}/${x2.state}`);
    // squad wipe fails the mission, nobody else bleeds
    return out;
  }));

  // ======================= C. extraction warning =======================
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g } = T;
    const zone = () => g.mission.extraction.zone;
    const inZ = (i = 0) => ({ x: zone().x + zone().w / 2 + i * 14, y: zone().y + zone().h / 2 });
    const setup = (classes = ['infantry', 'infantry']) => { T.generic(classes); g.mission.debugReadyExtraction(g); };

    // extraction hold during a valid revive (v0.4 kept), then extraction completes with everyone
    setup();
    let [a, b] = g.soldiers;
    b.pos = inZ(); g.downSoldier(b); g.anchor = inZ();
    let pin = T.pinner([[a, inZ(1)], [b, inZ()]]);
    T.step(3, pin);
    const held = g.phase === 'playing' && g.mission.attempt === 'idle' && b.reviving;
    T.stepUntil(() => g.phase !== 'playing', 15, pin);
    check('[S1] extraction holds while a valid revive runs (no warning), then completes with everyone', held && g.phase === 'won' && b.state === 'active', `${held} ${g.phase} ${b.state}`);

    // warning: non-pausing, armed after 0.6 s, no invulnerability
    setup();
    [a, b] = g.soldiers; b.pos = { x: zone().x - 900, y: zone().y + 200 }; g.downSoldier(b); g.anchor = inZ();
    const downAt = { ...b.pos };
    pin = T.pinner([[a, inZ()], [b, downAt]]);
    T.step(0.2, pin);
    const w0 = g.mission.extractWarning(g);
    const early = g.confirmExtraction() || g.stayAndRescue();
    const bl0 = b.bleed, t0 = g.time;
    const e = g.spawnEnemy({ x: a.pos.x + 150, y: a.pos.y }); e.guard = true;
    const hp0 = a.hp;
    T.calm = false; T.step(2, pin); T.calm = true;
    check('warning opens when the squad is in the zone with a soldier downed elsewhere', w0 && w0.downed.length === 1 && !w0.armed && g.mission.attempt === 'warning' && g.phase === 'playing', JSON.stringify({ attempt: g.mission.attempt, armed: w0?.armed }));
    check('warning buttons ignore taps for the first 0.6 s (no tap-through)', !early, early);
    check('warning does not pause: bleed-out, game time and enemy fire keep running; no invulnerability', Math.abs(bl0 - b.bleed - 2) < 0.02 && Math.abs(g.time - t0 - 2) < 0.02 && !g.paused && !g.invuln && a.hp < hp0, `bleed ${bl0.toFixed(2)}->${b.bleed.toFixed(2)} time +${(g.time - t0).toFixed(2)} hp ${hp0}->${a.hp.toFixed(1)}`);
    e.state = 'dead'; g.enemies = [];

    // Stay and Rescue: cancels the attempt, timers untouched, no re-warning while staying in the zone
    const bStay = b.bleed;
    const stay = g.stayAndRescue();
    T.step(3, pin);
    const stayed = g.mission.attempt === 'stayed' && !g.mission.extractWarning(g) && g.phase === 'playing';
    check('Stay and Rescue: attempt cancelled, bleed-out NOT reset or extended, no re-warning in the zone', stay && stayed && Math.abs(bStay - b.bleed - 3) < 0.02, `${stay} ${g.mission.attempt} ${bStay.toFixed(2)}->${b.bleed.toFixed(2)}`);
    // leave the zone >= 1.5 s and come back: a new attempt (a new warning), still the same timer
    const outside = { x: zone().x - 200, y: zone().y + zone().h / 2 };
    g.anchor = outside; T.step(1.7, T.pinner([[a, outside], [b, downAt]]));
    const bRe = b.bleed;
    g.anchor = inZ(); T.step(0.1, pin);
    check('re-entering the zone after leaving it starts a new attempt (warning again), same timer', g.mission.attempt === 'warning' && b.bleed < bRe && b.bleed < bStay - 4.5, `${g.mission.attempt} bleed ${b.bleed.toFixed(2)}`);

    // [S3] Confirm -> the downed soldier is left behind (KIA, abandoned), the rest extracts
    T.step(0.7, pin);
    const conf = g.confirmExtraction();
    check('[S3] Confirm Extraction: downed soldier left behind = KIA (abandoned), squad extracts (victory)', conf && g.phase === 'won' && b.state === 'kia' && b.kiaCause === 'abandoned' && a.state === 'active', `${conf} ${g.phase} ${b.state} ${b.kiaCause}`);

    // ignoring the warning: extraction stays on hold; the soldier bleeds out at exactly 20 s, then the squad extracts
    setup();
    [a, b] = g.soldiers; b.pos = { x: zone().x - 900, y: zone().y + 200 }; const dp = { ...b.pos }; g.downSoldier(b); g.anchor = inZ();
    const nIgn = T.stepUntil(() => g.phase !== 'playing', 30, T.pinner([[a, inZ()], [b, dp]]));
    check('ignored warning (documented default): holds; no extra time; soldier bleeds out at 20 s, then extraction completes', g.phase === 'won' && b.state === 'kia' && b.kiaCause === 'bleedout' && nIgn >= 1199 && nIgn <= 1203, `${g.phase} ${b.state} ${b.kiaCause} after ${nIgn} steps`);

    // healthy soldier slightly outside the zone: never KIA, extraction just waits
    setup();
    [a, b] = g.soldiers; g.anchor = inZ();
    const edge = { x: zone().x - 6, y: zone().y + zone().h / 2 };
    T.step(30, T.pinner([[a, inZ()], [b, edge]]));
    const waited = g.phase === 'playing' && g.soldiers.every((s) => s.state === 'active') && !g.mission.extractWarning(g);
    T.stepUntil(() => g.phase !== 'playing', 2, T.pinner([[a, inZ()], [b, inZ(1)]]));
    check('healthy soldier slightly outside the zone: not KIA, no warning; extraction waits, then completes with everyone', waited && g.phase === 'won' && g.soldiers.every((s) => s.state === 'active'), `${waited} ${g.phase}`);

    // two downed: Confirm abandons both; the warning lists both
    setup(['infantry', 'infantry', 'infantry']);
    const [s0, s1, s2] = g.soldiers; s1.pos = { x: zone().x - 900, y: zone().y + 100 }; s2.pos = { x: zone().x - 900, y: zone().y + 300 };
    const p1 = { ...s1.pos }, p2 = { ...s2.pos }; g.downSoldier(s1); g.downSoldier(s2); g.anchor = inZ();
    T.step(0.7, T.pinner([[s0, inZ()], [s1, p1], [s2, p2]]));
    const w2 = g.mission.extractWarning(g);
    const c2 = g.confirmExtraction();
    check('two soldiers downed: warning lists both; Confirm leaves both behind (KIA abandoned)', w2?.downed.length === 2 && c2 && s1.kiaCause === 'abandoned' && s2.kiaCause === 'abandoned' && g.phase === 'won', `${w2?.downed.length} ${c2} ${s1.kiaCause} ${s2.kiaCause}`);
    return out;
  }));

  // HUD: the warning element (non-blocking box, re-rendered only on change)
  add(await run(async () => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g } = T;
    T.generic(['infantry', 'infantry']); g.mission.debugReadyExtraction(g);
    const z = g.mission.extraction.zone, inZ = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    const [a, b] = g.soldiers; b.pos = { x: z.x - 900, y: z.y + 200 }; const dp = { ...b.pos }; g.downSoldier(b); g.anchor = { ...inZ };
    const pin = T.pinner([[a, inZ], [b, dp]]);
    T.step(0.2, pin); window.__hud.update();
    const el = document.getElementById('xwarn');
    const title = el.querySelector('.xw-title').textContent, body = el.querySelector('.xw-body').textContent;
    const disabled = [...el.querySelectorAll('button')].every((x) => x.disabled);
    let mutations = 0; const mo = new MutationObserver((l) => (mutations += l.length)); mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
    for (let i = 0; i < 20; i++) { g.update(1 / 60); pin(); window.__hud.update(); } // same second: no re-render
    await new Promise((r) => setTimeout(r, 0));
    const sameSecond = mutations;
    T.step(0.7, pin); window.__hud.update();
    const armed = [...el.querySelectorAll('button')].every((x) => !x.disabled);
    mo.disconnect();
    const cs = getComputedStyle(el);
    check('HUD warning: "SOLDIER LEFT BEHIND!", live countdown, "Extracting now will mark … as KIA."', el.style.display !== 'none' && title === 'SOLDIER LEFT BEHIND!' && /is downed — \d+ seconds? remaining/.test(body) && /Extracting now will mark .* as KIA/.test(body), `${title} | ${body}`);
    check('HUD warning: buttons disabled until armed (0.6 s), then enabled; box itself is click-through', disabled && armed && cs.pointerEvents === 'none', `${disabled} ${armed} ${cs.pointerEvents}`);
    check('HUD warning: no per-frame re-render (only when a number changes)', sameSecond <= 4, `${sameSecond} mutations in 20 frames`);
    // a click on STAY goes through the HUD buttons
    el.querySelector('[data-x="stay"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.__hud.update();
    check('HUD warning: STAY AND RESCUE button works and the warning closes', g.mission.attempt === 'stayed' && el.style.display === 'none', `${g.mission.attempt} ${el.style.display}`);
    return out;
  }));

  // ======================= D. timing: SimClock, frame drops, backgrounding =======================
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const sim = (fps, secs) => { const c = new window.__SimClock(1 / 60, 0.1); let t = 1000, n = 0; c.advance(t); const f = 1000 / fps; for (let i = 0; i < Math.round(secs * fps); i++) { t += f; n += c.advance(t); } return n; };
    const r = { 144: sim(144, 20), 60: sim(60, 20), 30: sim(30, 20), 10: sim(10, 20), 5: sim(5, 20) };
    check('SimClock: 20 real seconds = 1200 steps at 144/60/30/10 fps (identical timers)', [r[144], r[60], r[30], r[10]].every((n) => Math.abs(n - 1200) <= 1), JSON.stringify(r));
    check('SimClock: below 10 fps the game slows down (5 fps: 600 steps), never fast-forwards', r[5] === 600, r[5]);
    const c = new window.__SimClock(1 / 60, 0.1); c.advance(0); const a1 = c.advance(5000);
    check('SimClock: a 5 s frame stall advances at most 0.1 s (6 steps)', a1 === 6, a1);
    const h = new window.__SimClock(1 / 60, 0.1); h.advance(0); h.advance(16.7); const hid = h.advance(30000, true); h.resume(30000); const after = h.advance(30016.7);
    check('SimClock: hidden for 30 s -> 0 steps; on resume no catch-up burst (1 step)', hid === 0 && after === 1, `${hid} ${after}`);
    const s = new window.__SimClock(1 / 60, 0.1); s.advance(0); s.suspend(); const sus = s.advance(10000); s.resume(20000); const sus2 = s.advance(20100);
    check('SimClock: suspended -> nothing; resume restarts from now', sus === 0 && sus2 === 6, `${sus} ${sus2}`);
    return out;
  }));
  // real page: background (visibilitychange) pauses the mission; rotation / resize doesn't affect timers
  await run(() => {
    T.generic(['infantry', 'infantry']); const g = T.g, [d, o] = g.soldiers; g.downSoldier(d); window.__pdDown = d; T.g.anchor = T.far(d.pos);
    // the real frame loop drives the game here: keep the squad-mate away from the downed soldier on every step
    const spot = T.far(d.pos), orig = g.update.bind(g);
    window.__restoreUpdate = () => { g.update = orig; };
    g.update = (dt) => { o.pos = { ...spot }; g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; orig(dt); };
  });
  await page.waitForTimeout(500);
  const vis = await run(async () => {
    const d = window.__pdDown, g = T.g;
    const before = d.bleed, tBefore = g.time;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 1500));
    const hiddenBleed = d.bleed, paused = g.paused, hiddenTime = g.time - tBefore;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 300));
    const stillPaused = g.paused, afterShow = d.bleed;
    g.paused = false;
    const t0 = performance.now(), b0 = d.bleed;
    await new Promise((r) => setTimeout(r, 1000));
    const realS = (performance.now() - t0) / 1000, simS = b0 - d.bleed;
    return { before, hiddenBleed, paused, hiddenTime, stillPaused, afterShow, realS, simS };
  });
  add([
    { name: 'backgrounding (visibilitychange hidden) pauses the mission: 1.5 s hidden, bleed-out unchanged', ok: vis.paused && Math.abs(vis.hiddenBleed - vis.before) < 0.12 && vis.hiddenTime < 0.12 && Math.abs(vis.afterShow - vis.hiddenBleed) < 1e-9, detail: JSON.stringify(vis) },
    { name: 'returning to the page keeps the mission paused (player resumes); then timers run at real speed, no burst', ok: vis.stillPaused && vis.simS <= vis.realS + 0.05 && vis.simS > 0.5, detail: JSON.stringify(vis) },
  ]);
  const rot = [];
  for (const vp of [{ width: 667, height: 375 }, { width: 375, height: 667 }, { width: 844, height: 390 }, { width: 1280, height: 720 }]) {
    const t0 = await run(() => ({ b: window.__pdDown.bleed, t: performance.now() }));
    await page.setViewportSize(vp); await page.waitForTimeout(400);
    const t1 = await run(() => ({ b: window.__pdDown.bleed, t: performance.now(), st: window.__pdDown.state }));
    rot.push({ vp: `${vp.width}x${vp.height}`, sim: +(t0.b - t1.b).toFixed(3), real: +((t1.t - t0.t) / 1000).toFixed(3), st: t1.st });
  }
  add([{ name: 'orientation / resize during a bleed-out: no reset, no acceleration (sim time <= real time)', ok: rot.every((r) => r.sim <= r.real + 0.05 && r.sim >= 0 && r.st === 'downed'), detail: JSON.stringify(rot) }]);
  await run(() => { T.g.paused = true; window.__restoreUpdate(); });

  // ======================= E. mission-end transaction, decisions, economy =======================
  await fresh();
  add(await run(async () => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E, C } = T;
    a.credits = 0;
    // [S4] two deaths in one mission (bleed-out + abandoned at extraction), mission won
    const r = T.roster(['ace', 'ranger', 'doc']);
    T.bleedOut('ace');
    const journal = JSON.parse(JSON.stringify(a.activeRun)), saved = T.store().account.activeRun;
    g.mission.debugReadyExtraction(g);
    const z = g.mission.extraction.zone, inZ = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    const rg = T.unit('ranger'), dc = T.unit('doc'); rg.pos = { x: z.x - 900, y: z.y + 200 }; const rp = { ...rg.pos }; g.downSoldier(rg); g.anchor = { ...inZ };
    T.step(0.8, T.pinner([[dc, inZ], [rg, rp]]));
    g.confirmExtraction();
    const rw = g.lastReward, d = a.pendingDecision;
    check('KIA is journaled and SAVED immediately (before the mission ends)', r.ok && journal?.kia?.[0]?.id === 'ace' && saved?.kia?.[0]?.id === 'ace', JSON.stringify(saved));
    check('[S4] two deaths in one mission: both KIA, one decision batch "1 of 2"', g.phase === 'won' && d && d.queue.map((x) => x.id).join() === 'ace,ranger' && d.total === 2 && d.queue[1].cause === 'abandoned' && C.casualtyPosition(d).index === 1 && C.casualtyPosition(d).total === 2, JSON.stringify(d));
    const labels = rw.creditLines.map((l) => l.label).join(' | ');
    check('credits applied BEFORE decisions; no full-extraction / flawless bonus with a KIA', rw.credits > 0 && a.credits === rw.credits && !/whole|flawless|nobody|full/i.test(labels), `${rw.credits} cr: ${labels}`);
    check('mission-end transaction saved: KIA status, deaths, pending decision, credits; journal cleared', (() => { const s = T.store(); const ace = s.roster.find((x) => x.id === 'ace'); return ace.status === 'kia' && ace.service.deaths === 1 && s.account.pendingDecision.queue.length === 2 && s.account.credits === a.credits && !s.account.activeRun; })(), JSON.stringify(T.store().account.pendingDecision));
    const again = E.settleMission(g.roster, a, { missionId: 'field-medicine', runId: rw.runId, won: true, deployed: [{ id: 'ace', status: 'KIA' }], optional: { total: 0, completed: 0, list: [] }, stars: 3 }, {});
    check('idempotent: settling the same run again changes nothing (no double credits / deaths)', again === null && a.credits === rw.credits && g.roster.get('ace').service.deaths === 1, `${again} ${a.credits}`);
    check('career: Doc mission + victory counted once; Ace downs 1, deaths 1', (() => { const ace = g.roster.get('ace'), doc = g.roster.get('doc'); return ace.service.downs === 1 && ace.service.deaths === 1 && ace.service.missions === 1 && doc.service.missions === 1 && doc.service.victories === 1 && doc.service.deaths === 0; })(), JSON.stringify(g.roster.get('ace').service));

    // blocks while pending
    const blocks = {
      deploy: g.deploy([g.roster.get('doc')], 'roster').ok,
      deployBlock: !!g.deployBlock(),
      recruit: !!E.recruitBlock(g.roster, a),
      refresh: E.refreshOffers(g.roster, a, null, null).ok,
      train: E.buyTraining(g.roster, a, 'doc', 'hp', null, null).ok,
      squadTrain: E.buySquadTraining(a, 'hp', null, null).ok,
      rename: E.rename(g.roster, a, 'doc', 'Docky', null).ok,
    };
    window.__hud.showCampaign(); const s1 = window.__hud.menus?.screen ?? document.getElementById('menu').className;
    window.__hud.showStart(); const s2 = window.__hud.menus?.screen ?? document.getElementById('menu').className;
    check('pending decisions block deploy / recruit / refresh / training / squad training / rename', !blocks.deploy && blocks.deployBlock && blocks.recruit && !blocks.refresh && !blocks.train && !blocks.squadTrain && !blocks.rename, JSON.stringify(blocks));
    check('no bypass: Campaign and Barracks redirect to the casualty flow', /decisions/.test(s1) && /decisions/.test(s2), `${s1} ${s2}`);
    check('a fallen soldier cannot be dismissed; the casualty is not refunded', !!E.dismissBlock(g.roster, 'ace') && /fallen/.test(E.dismissBlock(g.roster, 'ace')), E.dismissBlock(g.roster, 'ace'));
    check('resurrect only the soldier at the head of the queue (Ranger first is refused)', !E.resurrect(g.roster, a, 'ranger', null).ok, '');
    // insufficient credits
    a.credits = 999;
    const poor = E.resurrect(g.roster, a, 'ace', window.__persist);
    check('insufficient credits: refused, nothing changes (999 < 1000)', !poor.ok && a.credits === 999 && g.roster.get('ace').status === 'kia' && /short/.test(poor.reason), poor.reason);
    // save failure rolls back everything
    a.credits = 5000;
    const before = JSON.stringify({ s: g.roster.soldiers, p: a.pendingDecision, c: a.credits, m: a.memorial });
    const fail = E.resurrect(g.roster, a, 'ace', () => 'error');
    const failM = E.memorialize(g.roster, a, 'ace', () => 'error');
    check('save failure during Resurrect / Memorial: rolled back completely (credits, status, queue, Memorial)', !fail.ok && !failM.ok && JSON.stringify({ s: g.roster.soldiers, p: a.pendingDecision, c: a.credits, m: a.memorial }) === before, `${fail.reason} / ${failM.reason}`);
    // double tap: second resurrect of the same id is refused, pays nothing
    const one = E.resurrect(g.roster, a, 'ace', window.__persist), two = E.resurrect(g.roster, a, 'ace', window.__persist);
    check('double-tap Resurrect: second tap refused, paid once (5000 -> 4000)', one.ok && !two.ok && a.credits === 4000 && g.roster.get('ace').resurrections === 1 && g.roster.get('ace').service.deaths === 1, `${two.reason} ${a.credits}`);
    check('after one decision the next casualty is shown ("2 of 2", Ranger)', a.pendingDecision.queue[0].id === 'ranger' && C.casualtyPosition(a.pendingDecision).index === 2, JSON.stringify(C.casualtyPosition(a.pendingDecision)));
    return out;
  }));
  // [S10] reload during casualty resolution: still pending, Ranger next, no bypass
  await reload();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a } = T;
    const scr = document.getElementById('menu').className;
    check('[S10] reload during resolution: flow reopens on launch at "Fallen Soldier 2 of 2" (Ranger); Ace stays resurrected', /decisions/.test(scr) && a.pendingDecision?.queue[0]?.id === 'ranger' && /FALLEN SOLDIER 2 OF 2/.test(document.getElementById('menu').textContent) && g.roster.get('ace').status === 'active' && a.credits === 4000, `${scr} ${JSON.stringify(a.pendingDecision?.queue)} ${a.credits}`);
    return out;
  }));
  // UI: Memorial via the confirmation screen (armed after 1.5 s)
  await page.click('[data-a="mem-open"]');
  const memUi = await run(() => { const b = document.querySelector('[data-a="mem-confirm"]'); return { disabled: b?.disabled, text: document.getElementById('menu').textContent }; });
  await page.click('[data-a="mem-confirm"]', { force: true }).catch(() => {});
  const stillThere = await run(() => T.g.roster.get('ranger')?.status);
  await page.waitForTimeout(1600);
  await run(() => window.__hud.menus?.rerender?.());
  const armedNow = await run(() => !document.querySelector('[data-a="mem-confirm"]')?.disabled);
  await page.click('[data-a="mem-confirm"]');
  await page.waitForTimeout(100);
  add(await run(([memUi, stillThere, armedNow]) => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a } = T;
    check('Memorial confirm screen: "This decision is permanent. This soldier cannot be resurrected later."; confirm disabled at first', memUi.disabled && /This decision is permanent\. This soldier cannot be resurrected later\./.test(memUi.text), memUi.text.slice(0, 200));
    check('rapid tap on the unarmed confirm does nothing', stillThere === 'kia', stillThere);
    const m = a.memorial[0];
    check('[S6] Memorial after the arm delay: Ranger removed from roster + squad, full record kept, no credits, flow closes', armedNow && !g.roster.get('ranger') && !g.roster.slots.includes('ranger') && m?.soldier.id === 'ranger' && m.soldier.service.deaths === 1 && a.credits === 4000 && !a.pendingDecision, JSON.stringify({ armedNow, m: m?.soldier?.name, cr: a.credits }));
    check('Memorial name stays reserved', a.recruitment.usedNames.some((n) => n.toLowerCase() === 'ranger'), a.recruitment.usedNames);
    return out;
  }, [memUi, stillThere, armedNow]));
  await reload();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E } = T;
    check('reload after Memorial: Ranger stays gone (not restored from defaults), record kept, nothing pending', !g.roster.get('ranger') && !g.roster.isUnlocked('ranger') && a.memorial.length === 1 && !a.pendingDecision, JSON.stringify(g.roster.owned().map((s) => s.id)));
    check('no resurrection from the Memorial (no pending entry, transaction refused)', !E.resurrect(g.roster, a, 'ranger', null).ok, '');
    check('Memorial does not count toward the 12-soldier cap', E.recruitBlock(g.roster, a) === null || !/full/i.test(E.recruitBlock(g.roster, a) ?? ''), E.recruitBlock(g.roster, a));
    // Memorial grid
    window.__hud.menus?.showMemorial?.('barracks');
    const card = document.querySelector('.mm-card');
    check('Memorial grid: grayscale portrait, name, final level, kills, resurrections', card && card.querySelector('canvas.gray') && /Ranger/i.test(card.textContent) && /LV \d/.test(card.textContent) && /kills/.test(card.textContent) && /res\./.test(card.textContent), card?.textContent);
    // dismissal never creates a Memorial record
    const n0 = a.memorial.length; a.credits += 0;
    const dm = E.dismiss(g.roster, a, 'havoc', window.__persist);
    check('dismissal never enters the Memorial (refund paid instead)', dm.ok && a.memorial.length === n0 && dm.refund === 250, `${dm.ok} ${a.memorial.length} ${dm.refund}`);
    return out;
  }));

  // [S5] veteran resurrected with upgrades intact; [S12] recruit dies and is resurrected keeping identity
  await fresh();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E } = T;
    const ace = g.roster.get('ace');
    ace.progression.xp = 1200; ace.progression.level = window.__progression.levelForXp(1200);
    ace.training = { accuracy: 2, damage: 3, hp: 1, fireRate: 1, moveSpeed: 0 }; ace.service.kills = 40;
    a.squadTraining.hp = 2;
    // a recruit
    a.credits = 5000; E.openOffice(g.roster, a, null);
    const off = a.recruitment.offers[0]; const rc = E.recruit(g.roster, a, off.id, window.__persist);
    const rid = rc.soldier.id; g.roster.get(rid).progression.xp = 300; g.roster.get(rid).progression.level = window.__progression.levelForXp(300); g.roster.get(rid).training.damage = 1;
    window.__persist();
    const eff0 = JSON.stringify(window.__effectiveStats(g.roster.get('ace')));
    g.roster.slots = ['ace', rid, 'doc', null, null, null];
    T.roster(['ace', rid, 'doc']);
    T.bleedOut('ace'); T.bleedOut(rid);
    g.fail();
    const snap0 = T.snap('ace'), rsnap0 = T.snap(rid); // everything as it stood at death (career includes this mission)
    const fail = { phase: g.phase, q: a.pendingDecision?.queue.map((x) => x.id), doc: g.roster.get('doc').status, lr: g.lastReward };
    check('[S9] failed mission with a survivor + KIA: survivor returns, legit KIA stay KIA (queued), no victory rewards', fail.phase === 'failed' && fail.q.join() === `ace,${rid}` && fail.doc === 'active' && (fail.lr === null || fail.lr.credits === 0 || !fail.lr.creditLines.some((l) => /victory|first/i.test(l.label))), JSON.stringify({ ...fail, lr: fail.lr?.creditLines }));
    a.credits = 3000;
    const r1 = E.resurrect(g.roster, a, 'ace', window.__persist), r2 = E.resurrect(g.roster, a, rid, window.__persist);
    const eff1 = JSON.stringify(window.__effectiveStats(g.roster.get('ace')));
    check('[S5] veteran resurrected: level, XP, training, career and effective stats identical; resurrections 1, deaths kept', r1.ok && T.snap('ace') === snap0 && eff1 === eff0 && g.roster.get('ace').resurrections === 1 && g.roster.get('ace').service.deaths === 1, `${T.snap('ace') === snap0} ${eff1 === eff0}`);
    check('[S12] recruit resurrected keeping id, name, class, trait, XP, training (1000 CR each, level irrelevant)', r2.ok && T.snap(rid) === rsnap0 && a.credits === 1000 && g.roster.get(rid).status === 'active', `${a.credits}`);
    check('resurrected soldiers return to the saved squad and can deploy again', g.roster.squad().map((s) => s.id).join() === `ace,${rid},doc` && g.deployBlock() === null, g.roster.slots.join());
    // second resurrection costs 2000
    check('next resurrection of the same soldier costs 2000 (1st resurrection already used)', window.__casualties.costFor(g.roster.get('ace')) === 2000, window.__casualties.costFor(g.roster.get('ace')));
    return out;
  }));

  // [S7] restricted dismissal finances a resurrection (1650 + 2 x 200 = 2050 >= 2000)
  await fresh();
  add(await run(async () => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E } = T;
    a.credits = 10000; E.openOffice(g.roster, a, null);
    const inf = [];
    for (let i = 0; i < 40 && inf.length < 2; i++) { const o = a.recruitment.offers.find((x) => x.classId === 'infantry'); if (o) { inf.push(E.recruit(g.roster, a, o.id, null).soldier.id); } else E.refreshOffers(g.roster, a, null, null); }
    g.roster.get('ace').resurrections = 1; // next price 2000
    T.roster(['ace', 'ranger', 'doc']); T.bleedOut('ace'); g.fail();
    a.credits = 1650; window.__persist();
    g.toCampaign(); // Results -> RESOLVE CASUALTIES
    const btn = () => document.querySelector('[data-a="resurrect"]');
    const dis0 = btn().disabled, short0 = /350/.test(document.getElementById('menu').textContent);
    return { inf, dis0, short0, out };
  }).then(async ({ inf, dis0, short0, out }) => {
    await page.click('[data-a="manage"]');
    const listed = await run(() => [...document.querySelectorAll('.k-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    for (const id of inf) {
      await page.click(`.k-row [data-a="dismiss"][data-id="${id}"]`);
      await page.waitForTimeout(50);
      const confirmSel = await run(() => { const b = [...document.querySelectorAll('[data-a]')].find((x) => /dismiss-(confirm|yes|ok)/.test(x.dataset.a)); return b ? `[data-a="${b.dataset.a}"]` : null; });
      if (confirmSel) await page.click(confirmSel);
      await page.waitForTimeout(700);
    }
    const after = await run(() => ({ cr: T.a.credits, text: document.getElementById('menu').textContent.replace(/\s+/g, ' '), screen: document.getElementById('menu').className }));
    await page.click('[data-a="manage-back"]'); await page.waitForTimeout(650);
    const enabled = await run(() => !document.querySelector('[data-a="resurrect"]').disabled);
    await page.click('[data-a="resurrect"]'); await page.waitForTimeout(100);
    const fin = await run(() => ({ cr: T.a.credits, ace: T.g.roster.get('ace').status, res: T.g.roster.get('ace').resurrections, pend: !!T.a.pendingDecision, mem: T.a.memorial.length }));
    out.push({ name: 'restricted roster: Resurrect disabled while short (1650 < 2000, 350 short)', ok: dis0 && short0, detail: `${dis0} ${short0}` });
    out.push({ name: 'restricted roster lists the fallen soldier (FALLEN, no dismiss) and living soldiers with refunds', ok: listed.some((t) => /Ace.*FALLEN/.test(t)) && listed.some((t) => /DISMISS · \+200/.test(t)), detail: listed.join(' / ') });
    out.push({ name: '[S7] dismiss 2 Infantry reserves (+200 each): 1650 -> 2050, Resurrect enabled, Ace resurrected for 2000 -> 50', ok: after.cr === 2050 && enabled && fin.cr === 50 && fin.ace === 'active' && fin.res === 2 && !fin.pend && fin.mem === 0, detail: JSON.stringify({ after: after.cr, enabled, fin }) });
    return out;
  }));
  // last living soldier rule
  await fresh(false);
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E } = T;
    T.roster(['ace', 'ranger'], 'first-contact'); T.bleedOut('ace'); g.fail();
    const blk = E.dismissBlock(g.roster, 'ranger');
    check('[S11] one survivor: no Phoenix; the last living soldier cannot be dismissed during resolution', /at least one/.test(blk ?? '') && !a.phoenix.pending, blk);
    a.credits = 0;
    const m = E.memorialize(g.roster, a, 'ace', window.__persist);
    check('[S11] survivor keeps playing: Memorial while unaffordable with one survivor -> no Phoenix grant', m.ok && !m.phoenix && !a.phoenix.pending && a.phoenix.grants.length === 0 && g.roster.living().length === 1, JSON.stringify(a.phoenix));
    return out;
  }));

  // ======================= F. Operation Phoenix =======================
  await fresh(false);
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E, C } = T;
    // A total collapse can't come out of combat (the last soldier to go down fails the mission and is
    // recovered), so the batch is produced by the mission-end transaction directly: every owned
    // soldier reported KIA (as the engine would report a total loss).
    a.credits = 300; a.squadTraining.hp = 1;
    const out0 = { missionId: 'first-contact', runId: 'px-test-1', won: false, deployed: [{ id: 'ace', status: 'KIA', downs: 1 }, { id: 'ranger', status: 'KIA', downs: 1 }], optional: { total: 0, completed: 0, list: [] }, stars: 0 };
    E.settleMission(g.roster, a, out0, {}); window.__persist();
    check('Phoenix: none while decisions are pending', !a.phoenix.pending && C.phoenixEligible(g.roster, a, a.pendingDecision).ok === false, C.phoenixEligible(g.roster, a, a.pendingDecision).reason);
    const m1 = E.memorialize(g.roster, a, 'ace', window.__persist);
    check('Phoenix: none after the first Memorial (Ranger still pending)', m1.ok && !m1.phoenix && !a.phoenix.pending, '');
    const m2 = E.memorialize(g.roster, a, 'ranger', window.__persist);
    const px = a.phoenix.pending;
    check('[S8] entire squad lost (all unaffordable) -> Operation Phoenix opens with 6 L1 Infantry candidates', m2.ok && m2.phoenix && px && px.candidates.length === 6 && px.candidates.every((c) => c.classId === 'infantry' && c.level === 1) && new Set(px.candidates.map((c) => c.name.toLowerCase())).size === 6, JSON.stringify(px?.candidates?.map((c) => `${c.name}/${c.traitId}`)));
    check('Phoenix candidates: unique names, not reusing Memorial names', px.candidates.every((c) => !/^(ace|ranger)$/i.test(c.name)), px.candidates.map((c) => c.name).join());
    check('Phoenix blocks normal play until the picks are made', /Phoenix/.test(C.decisionBlock(a) ?? '') && !g.deploy([], 'roster').ok, C.decisionBlock(a));
    return out;
  }));
  await reload();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E } = T;
    const screen = document.getElementById('menu').className, text = document.getElementById('menu').textContent;
    check('Phoenix survives a reload and reopens: "OPERATION PHOENIX" + the authorized text', /decisions/.test(screen) && /OPERATION PHOENIX/.test(text) && /Your squad has fallen\. Command has authorized three emergency recruits\./.test(text) && /Rebuild\. Regroup\. Fight back\./.test(text), text.slice(0, 160));
    const c = a.phoenix.pending.candidates;
    const two = E.enlistPhoenix(g.roster, a, [c[0].id, c[1].id], null), dup = E.enlistPhoenix(g.roster, a, [c[0].id, c[0].id, c[1].id], null);
    check('Phoenix: exactly three distinct picks required', !two.ok && !dup.ok, `${two.reason} / ${dup.reason}`);
    return out;
  }));
  // pick 3 through the UI
  for (let i = 0; i < 3; i++) { await page.locator('[data-a="px-pick"]').nth(i * 2).click(); await page.waitForTimeout(30); }
  await page.waitForTimeout(650);
  await page.click('[data-a="px-enlist"]'); await page.waitForTimeout(100);
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E } = T;
    const px = g.roster.owned().filter((s) => s.origin === 'phoenix');
    const eff = px[0] && window.__effectiveStats(px[0]);
    check('[S8] three free L1 Infantry enlisted (0 training, origin phoenix), credits unchanged, squad filled', px.length === 3 && px.every((s) => s.classId === 'infantry' && s.progression.level === 1 && Object.values(s.training).every((v) => v === 0)) && a.credits === 300 && g.roster.squad().length === Math.min(3, g.capacity) , `${px.length} ${a.credits} ${g.roster.slots.join()}`);
    check('Phoenix: squad training applies to the recruits', eff && eff.hp > 100, eff?.hp);
    check('Phoenix: grant recorded once; no second grant (repeat enlist refused)', a.phoenix.grants.length === 1 && !a.phoenix.pending && !E.enlistPhoenix(g.roster, a, ['x', 'y', 'z'], null).ok, JSON.stringify(a.phoenix.grants));
    check('Phoenix recruit dismissal refunds 0', E.dismissRefund(px[0]) === 0, E.dismissRefund(px[0]));
    check('after Phoenix: Barracks shown, the Campaign keeps earlier missions playable (replay)', /barracks|start/.test(document.getElementById('menu').className) && a.campaign.unlockedMissions.includes('first-contact') && g.deployBlock() === null, document.getElementById('menu').className);
    return out;
  }));
  await reload();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a } = T;
    check('reload after Phoenix: no duplicate grant, 3 recruits kept, Memorial kept', a.phoenix.grants.length === 1 && !a.phoenix.pending && g.roster.owned().filter((s) => s.origin === 'phoenix').length === 3 && a.memorial.length === 2, JSON.stringify(a.phoenix));
    // replay Mission 1 with the Phoenix recruits
    const r = T.roster(g.roster.squad().map((s) => s.id).slice(0, g.capacity), 'first-contact');
    g.mission.debugReadyExtraction(g);
    const z = g.mission.extraction.zone; const inZ = { x: z.x + z.w / 2, y: z.y + z.h / 2 }; g.anchor = inZ;
    T.stepUntil(() => g.phase !== 'playing', 2, T.pinner(g.soldiers.map((s, i) => [s, { x: inZ.x + i * 10, y: inZ.y }])));
    check('Phoenix recruits can replay Mission 1 and earn rewards', r.ok && g.phase === 'won' && g.lastReward?.credits > 0, `${r.reason ?? ''} ${g.phase} ${g.lastReward?.credits}`);
    return out;
  }));
  // no Phoenix when a resurrection was affordable; none from dismissals
  await fresh(false);
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E } = T;
    a.credits = 1000;
    E.settleMission(g.roster, a, { missionId: 'first-contact', runId: 'px-test-2', won: false, deployed: [{ id: 'ace', status: 'KIA' }, { id: 'ranger', status: 'KIA' }], optional: { total: 0, completed: 0, list: [] }, stars: 0 }, {});
    E.memorialize(g.roster, a, 'ace', null); E.memorialize(g.roster, a, 'ranger', null);
    check('Phoenix: none when a resurrection was affordable at the Memorial (1000 CR)', !a.phoenix.pending && a.phoenix.grants.length === 0, JSON.stringify(a.phoenix));
    window.__hud.showStart();
    check('zero living soldiers without Phoenix (chose Memorial while affordable): Barracks still renders, Recruitment Office open', /barracks|start/.test(document.getElementById('menu').className) && E.recruitBlock(g.roster, a) === null, `${document.getElementById('menu').className} ${E.recruitBlock(g.roster, a)}`);
    return out;
  }));

  // ======================= G. save v5: migration, repairs, New Campaign =======================
  await page.goto(URL);
  await run((fx) => { localStorage.clear(); localStorage.setItem(window.__SAVE_KEY, fx); }, FIXTURE_V05);
  await reload();
  add(await run((fx) => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a } = T, src = JSON.parse(fx), ls = window.__loadStatus;
    check('v0.5 fixture: migrated from v4 to v5', ls.status === 'migrated' && ls.fromVersion === 4 && T.store().version === 5, `${ls.status} ${ls.fromVersion}`);
    check('v0.5 fixture: exact pre-v0.6 backup written', localStorage.getItem('minisquad.save.pre-v0.6') === fx, '');
    const lost = [];
    for (const s of src.roster) {
      const n = g.roster.get(s.id);
      if (!n) { lost.push(s.id + ' missing'); continue; }
      for (const k of ['name', 'classId', 'traitId', 'resurrections']) if (JSON.stringify(n[k]) !== JSON.stringify(s[k])) lost.push(`${s.id}.${k}`);
      if (JSON.stringify(n.progression) !== JSON.stringify(s.progression)) lost.push(s.id + '.progression');
      if (JSON.stringify(n.training) !== JSON.stringify(s.training)) lost.push(s.id + '.training');
      for (const k of ['missions', 'victories', 'kills']) if (n.service[k] !== s.service[k]) lost.push(`${s.id}.service.${k}`);
      if (n.service.downs !== 0 || n.service.revives !== 0 || n.service.deaths !== 0 || n.status !== 'active') lost.push(s.id + ' new fields');
    }
    const A = src.account;
    if (a.credits !== A.credits) lost.push('credits');
    if (JSON.stringify(a.squadTraining) !== JSON.stringify(A.squadTraining)) lost.push('squadTraining');
    if (JSON.stringify(a.missions) !== JSON.stringify(A.missions)) lost.push('missions/stars');
    if (JSON.stringify(a.campaign) !== JSON.stringify(A.campaign)) lost.push('campaign');
    for (const k of Object.keys(A.recruitment)) if (k !== 'usedNames' && JSON.stringify(a.recruitment[k]) !== JSON.stringify(A.recruitment[k])) lost.push('recruitment.' + k);
    // name registry: everything kept; the load also registers current recruit names (v0.5 load rule: "Lt Biscuit")
    const extra = a.recruitment.usedNames.filter((n) => !A.recruitment.usedNames.includes(n));
    if (!A.recruitment.usedNames.every((n) => a.recruitment.usedNames.includes(n)) || extra.some((n) => !g.roster.owned().some((s) => s.name === n))) lost.push('usedNames');
    if (JSON.stringify(g.roster.slots) !== JSON.stringify(src.squad)) lost.push('squad');
    if (JSON.stringify([...g.roster.unlocked].sort()) !== JSON.stringify([...src.unlockedSoldiers].sort())) lost.push('unlocks');
    if (JSON.stringify(a.settledRuns) !== JSON.stringify(A.settledRuns)) lost.push('settledRuns');
    check('v0.5 fixture: zero data loss (soldiers, renames, XP, training, career, credits, squad training, stars, campaign, offers, refreshes, name registry, dismissals, squad, unlocks)', lost.length === 0, lost.join(', '));
    check('v0.5 fixture: nobody retroactively KIA (v0.5 temporary KIA is not converted); new state empty', g.roster.owned().every((s) => s.status === 'active') && !a.pendingDecision && a.memorial.length === 0 && a.phoenix.grants.length === 0 && !a.activeRun, '');
    check('v0.5 fixture: launch notice explains permanent KIA', /v0\.6/.test(document.getElementById('menu').textContent) && /permanent/i.test(document.getElementById('menu').textContent), '');
    return out;
  }, FIXTURE_V05));
  // repairs
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const P = window.__parseSave, base = T.store();
    const mk = (f) => { const s = JSON.parse(JSON.stringify(base)); f(s); return P(JSON.stringify(s)); };
    let r = mk((s) => { s.account.pendingDecision = { kind: 'casualties', runId: 'x', missionId: 'field-medicine', at: 1, queue: [{ id: 'ghost-404', cause: 'bleedout' }, { id: 'ace', cause: 'bleedout' }], total: 2, resolved: [] }; });
    check('repair: pending decision referencing a missing soldier -> dropped; remaining fallen kept KIA', r.account.pendingDecision.queue.map((q) => q.id).join() === 'ace' && r.roster.get('ace').status === 'kia', JSON.stringify(r.account.pendingDecision.queue));
    r = mk((s) => { const ace = s.roster.find((x) => x.id === 'ace'); s.account.memorial = [{ eventId: 'mm-1', soldier: { ...ace }, missionId: 'red-canyon', runId: 'r', cause: 'bleedout', at: 1, cost: 1000, affordable: false }]; });
    check('repair: Memorial id also in the roster -> Memorial wins (removed from roster and squad)', !r.roster.get('ace') && r.account.memorial.length === 1 && !r.roster.slots.includes('ace'), r.roster.slots.join());
    r = mk((s) => { s.roster.find((x) => x.id === 'tank').status = 'kia'; s.account.pendingDecision = null; });
    check('repair: KIA soldier with no pending decision -> queued for a decision (never silently lost or revived)', r.account.pendingDecision?.queue.some((q) => q.id === 'tank') && r.roster.get('tank').status === 'kia', JSON.stringify(r.account.pendingDecision));
    r = mk((s) => { const src = { ...s.roster.find((x) => x.id === 'rc-3'), id: 'rc-90', name: 'Dup', status: 'kia' }; const rec = { eventId: 'mm-1', soldier: src, missionId: 'red-canyon', runId: 'r', cause: 'bleedout', at: 1, cost: 1000, affordable: false }; s.account.memorial = [rec, { ...rec }]; });
    check('repair: duplicate Memorial records -> one', r.account.memorial.length === 1 && r.account.recruitment.usedNames.includes('Dup'), r.account.memorial.length);
    r = mk((s) => { s.account.pendingDecision = { kind: 'casualties', runId: 'x', missionId: 'm', at: 1, queue: 'garbage', total: 'x', resolved: 5 }; });
    check('repair: malformed pending decision -> cleaned without crashing', r && r.roster && (r.account.pendingDecision === null || Array.isArray(r.account.pendingDecision.queue)), JSON.stringify(r.account.pendingDecision));
    r = mk((s) => { s.roster.find((x) => x.id === 'ace').service = { missions: -3, kills: 'many', deaths: 2.5 }; s.roster.find((x) => x.id === 'ace').resurrections = -1; });
    check('repair: invalid career / resurrection values -> safe defaults', r.roster.get('ace').service.missions === 0 && r.roster.get('ace').service.kills === 0 && r.roster.get('ace').service.deaths === 0 && r.roster.get('ace').resurrections === 0, JSON.stringify(r.roster.get('ace').service));
    return out;
  }));
  // New Campaign resets the new state too (and backs up)
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, E } = T; let a = T.a;
    T.roster(['ace', 'ranger', 'tank']); T.bleedOut('ace'); g.fail();
    window.__persist();
    const before = localStorage.getItem(window.__SAVE_KEY);
    const ok = window.__resetRosterSave();
    a = T.a;
    const bak = JSON.parse(localStorage.getItem('minisquad.save.pre-reset') || 'null');
    check('New Campaign: clears pending decisions, Memorial, Phoenix and the journal; backs up the old save', ok && !a.pendingDecision && a.memorial.length === 0 && a.phoenix.grants.length === 0 && !a.phoenix.pending && !a.activeRun && bak?.save === before && T.g.roster.owned().every((s) => s.status === 'active'), `${ok} ${JSON.stringify(a.pendingDecision)}`);
    return out;
  }));

  // interrupted mission (app closed mid-mission): KIA kept, survivors home, exactly once
  await fresh();
  await run(() => { T.a.credits = 0; T.roster(['ace', 'ranger', 'doc']); T.bleedOut('ace'); });
  await reload();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a } = T;
    const txt = document.getElementById('menu').textContent;
    check('interrupted mission (reload mid-run): fallen soldier stays KIA and queued, survivors home, no rewards, notice shown', g.roster.get('ace').status === 'kia' && a.pendingDecision?.queue[0]?.id === 'ace' && g.roster.get('ranger').status === 'active' && a.credits === 0 && !a.activeRun && /interrupted/.test(txt), txt.slice(0, 200));
    return out;
  }));
  await reload();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a } = T;
    check('interrupted mission: a second reload does not add a second death or batch', g.roster.get('ace').service.deaths === 1 && a.pendingDecision.queue.length === 1 && a.pendingDecision.total === 1, JSON.stringify(g.roster.get('ace').service));
    return out;
  }));
  // leaving a running mission from the dev panel: deaths are not lost
  await fresh();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a } = T;
    T.roster(['ace', 'ranger', 'doc']); T.bleedOut('ace');
    g.toBarracks();
    check('leaving a running mission (dev panel Barracks): the death is settled at once, not lost', g.roster.get('ace').status === 'kia' && a.pendingDecision?.queue[0]?.id === 'ace' && !a.activeRun && /decisions/.test(document.getElementById('menu').className), JSON.stringify(a.pendingDecision));
    return out;
  }));

  // career record panel (Barracks details)
  await fresh();
  add(await run(() => {
    const out = [], check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const { g, a, E } = T;
    // one real mission: Doc revives Ace, Ace kills an enemy, victory
    T.roster(['ace', 'doc']);
    const ace = T.unit('ace'), doc = T.unit('doc');
    g.downSoldier(ace); g.anchor = { ...ace.pos };
    T.stepUntil(() => ace.state === 'active', 10, T.pinner([[doc, ace.pos]]));
    for (const e of g.enemies) e.state = 'dead'; g.enemies = [];
    const en = g.spawnEnemy({ x: ace.pos.x + 80, y: ace.pos.y }); en.hp = 1; en.reactionTime = 99;
    T.stepUntil(() => en.state === 'dead', 5, () => { for (const e of g.enemies) if (e !== en) e.state = 'dead'; g.enemies = g.enemies.filter((e) => e === en || e.state !== 'dead'); });
    g.mission.debugReadyExtraction(g);
    const z = g.mission.extraction.zone, inZ = { x: z.x + z.w / 2, y: z.y + z.h / 2 }; g.anchor = inZ;
    T.stepUntil(() => g.phase !== 'playing', 2, T.pinner([[ace, inZ], [doc, { x: inZ.x + 10, y: inZ.y }]]));
    window.__hud.showEnd?.(); window.__hud.showEnd?.(); // results re-shown: no double counting
    const sa = g.roster.get('ace').service, sd = g.roster.get('doc').service;
    check('career: counted exactly once at mission end (Ace: 1 mission, 1 down; the kill credited once; Doc: 1 revive)', g.phase === 'won' && sa.missions === 1 && sa.victories === 1 && sa.downs === 1 && sa.kills + sd.kills === 1 && sa.deaths === 0 && sd.revives === 1 && sd.missions === 1 && sd.downs === 0, JSON.stringify({ sa, sd }));
    g.toBarracks();
    return out;
  }));
  await page.click('.s-card[data-id="ace"]');
  add(await run(() => {
    const card = document.querySelector('.d-career');
    return [{ name: 'Barracks details: career record shows the six lifetime stats (Ace: 1 mission, 1 kill, downed 1, 0 deaths)', ok: !!card && ['Missions', 'Kills', 'Downed', 'Revives', 'Deaths', 'Resurrect'].every((w) => new RegExp(w, 'i').test(card.textContent)), detail: card?.textContent }];
  }));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ', FAILED: ' + failed.map((f) => f.name).join(' | ') : ''}`);
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})();
