// v0.8B.2 gameplay polish rule checks (against the live build; BASE = v0.8B.1 for the release-delta checks).
//  A. enemy Sniper rebalance: 65 damage (65% of a fresh Infantry), round 15% slower, cadence / aim / lock / accuracy /
//     range unchanged, two unmitigated hits down an untrained Infantry, Elite mitigation through Game.damage, cover,
//     stepping off the locked laser dodges at every range (and gives at least the v0.8B.1 window), simultaneous
//     spawns still telegraph the full aim time, friendly Sniper and every other enemy unchanged
//  B. Mission 14 suspense: no route-progress bar, distance or ambush count on the HUD, no FINAL banner, truck HP /
//     objective / ambush warnings kept, route / ambushes / truck identical to v0.8B.1, escort -> extraction works
//  C. Settings: no HP / damage (or any other CFG) sliders for players, developer tuning only with ?dev=1 and never
//     saved, CFG at the shipped defaults in normal play, saves with stray multiplier fields load with no effect,
//     frame-cap / overlay preferences and the save survive a reload
// Usage: npm test -- v082   (or: npx vite preview --port 4173 & BASE=<v0.8B.1 url> node tools/v082.cjs)
const { chromium, URL, BASE, createChecks, runSuite } = require('./lib.cjs');
const fs = require('fs');
const FIX = fs.readFileSync(__dirname + '/fixtures-v08b/v0.8B-m12-cleared.json', 'utf8');

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get P() { return window.__progression; },
    get R() { return window.game.roster; },
    get C() { return window.__CFG; },
    SIX: ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'],
    step(sec, pin) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (pin) pin(i); window.game.update(1 / 60); } },
    stepUntil(cond, maxSec, pin) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (pin) pin(n); window.game.update(1 / 60); n++; } return n / 60; },
    calm() { const g = window.game; for (const e of g.enemies) if (!e.structure && !e.vehicle && e.kind !== 'boss') e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active); g.input.move = () => ({ x: 0, y: 0 }); },
    generic(classes, mission) { const g = window.game; g.selectMission(mission, true); g.reset(classes); this.calm(); return g.soldiers; },
    deploy(ids, mission, calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.calm();
      g.input.move = () => ({ x: 0, y: 0 });
      return r;
    },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    pinAt(p, spread = 30) { const g = window.game; let i = 0; for (const s of g.soldiers) if (s.active && !s.mount) { s.pos = { x: p.x + ((i % 3) - 1) * spread, y: p.y + (Math.floor(i / 3) - 0.5) * spread }; s.vel = { x: 0, y: 0 }; i++; } g.anchor = { ...p }; },
    /** An open lane on the Mission 14 map (x 1000-1700, y 190-730: no obstacles) for the sniper duels. */
    LANE: { x: 1650, y: 460 },
    /** One generic soldier `d` px west of an enemy Sniper on the open lane; camera between them. */
    duel(d, cls = 'infantry', dy = 0) {
      const g = window.game, L = this.LANE;
      this.generic([cls], 'supply-line');
      const s = g.soldiers[0], y = L.y + dy;
      s.pos = { x: L.x - d, y }; s.vel = { x: 0, y: 0 }; g.anchor = { ...s.pos }; g.cam = { x: L.x - d / 2, y };
      const e = g.spawnEnemy({ x: L.x, y }, 'sniper'); e.guard = true;
      s.fireCooldown = 1e9; // the soldier holds fire: the duel measures the enemy Sniper alone
      return { s, e };
    },
    /**
     * Stepping off the locked line: the player starts moving perpendicular `react` s after the laser locks.
     * Returns whether the first round hit (and whether it was fired at all).
     */
    dodge(d, react, dir, dy) {
      const g = window.game, { s, e } = this.duel(d, 'infantry', dy);
      const hp0 = s.hp; let lockT = null, t = 0, moving = false;
      for (let i = 0; i < 60 * 6; i++) {
        if (e.lockAim !== null && lockT === null) lockT = t;
        if (lockT !== null && !moving && t >= lockT + react - 1e-9) { moving = true; g.input.move = () => ({ x: 0, y: dir }); }
        g.update(1 / 60); t += 1 / 60;
        if (e.shots > 0 && !g.projectiles.some((q) => q.owner === e)) break;
      }
      g.input.move = () => ({ x: 0, y: 0 });
      return { fired: e.shots > 0, hit: s.hp < hp0 };
    },
    /** Latest reaction after the lock (s, 0.05 steps) that still dodges in all four tries, per distance. */
    window(d) {
      let best = -1;
      for (let r = 0; r <= 1.2 + 1e-9; r += 0.05) {
        const tries = [[1, 0], [-1, 0], [1, 40], [-1, -40]].map(([dir, dy]) => this.dodge(d, r, dir, dy));
        if (tries.some((x) => !x.fired)) return { d, best, err: 'no shot' };
        if (tries.some((x) => x.hit)) break;
        best = +r.toFixed(2);
      }
      return best;
    },
    /** Enemy Sniper shot times at an invulnerable, standing soldier `d` px away for `sec` s. */
    cadence(d, sec) {
      const g = window.game, { s, e } = this.duel(d);
      g.invuln = true;
      const times = []; let n = e.shots;
      this.step(sec, () => { s.vel = { x: 0, y: 0 }; if (e.shots > n) { times.push(+g.time.toFixed(3)); n = e.shots; } });
      g.invuln = false;
      return times;
    },
    /** M14: straight to the escort (depots and capture marked done), gunner by class or null. */
    escort(gunnerCls) {
      const g = window.game;
      this.deploy(this.SIX, 'supply-line');
      const m = g.mission;
      m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; m.escort.capture();
      m.primaries[2].activate(m, g); m.phase = 'escort';
      g.modal = 'gunner'; g.chooseGunner(gunnerCls ? g.soldiers.find((s) => s.identity.classId === gunnerCls).id : null);
      return { m, v: m.escort, esc: m.primaries[2] };
    },
    /** Everything the HUD shows about the objective right now (DOM + the objective line). */
    hudNow() {
      const g = window.game; window.__render();
      const q = (s) => document.querySelector(s);
      const vis = (el) => !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
      const o = g.objective;
      return {
        text: o.text, sub: o.sub || '', progress: o.progress, chips: (o.chips || []).map((c) => c.label), meter: o.meter ? o.meter.label : null,
        bar: vis(q('#objective .obj-bar')), dom: `${q('#objective .obj-text').textContent} ${q('#objective .obj-sub').textContent} ${q('#objective .obj-chips').textContent}`, banners: g.banners.map((b) => b.text),
      };
    },
  };
}

/** Page-side: the numbers both builds share (compared against BASE). */
function snapshot() {
  const C = window.__CFG, g = window.game;
  const out = {
    sniper: C.enemySniper, infantry: C.infantry, squadSniper: C.sniper,
    others: JSON.stringify(['enemy', 'armored', 'tower', 'boss', 'truck', 'heavy', 'medic', 'commando', 'elite'].map((k) => C[k])),
  };
  window.__debugUnlockAll();
  g.selectMission('supply-line', true); g.deploy(T.SIX.map((id) => g.roster.get(id)), 'roster');
  const m = g.mission, amb = m.primaries.find((o) => o.id === 'escort').ambushes;
  out.m14 = {
    defs: JSON.stringify(amb.defs.map((d) => ({ at: d.at, delay: d.delay, groups: d.groups }))), banners: amb.defs.map((d) => d.banner),
    route: m.escort.route.map((p) => `${p.x},${p.y}`).join(' '), total: Math.round(m.escort.total),
    truck: JSON.stringify(C.escortTruck), gun: JSON.stringify(C.mountedGun),
    groups: g.enemies.filter((e) => !e.vehicle).map((e) => `${e.kind}:${e.tag}:${Math.round(e.pos.x)},${Math.round(e.pos.y)}:${e.maxHp}`).sort().join(';'),
    extraction: JSON.stringify(m.script.extraction.zone),
  };
  return out;
}

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 104, detailMax: 360 });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const fresh = async (p = page, url = URL, raw = null, q = '') => {
    await p.goto(url); await p.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await p.goto(url + q); await p.waitForFunction(() => !!window.game); await p.waitForTimeout(100);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  let basePage = null;
  if (BASE) {
    basePage = await ctx.newPage(); basePage.on('pageerror', (e) => errors.push('BASE: ' + String(e)));
    await fresh(basePage, BASE);
  } else console.log('NOTE  BASE not set: the release-delta checks compare against the recorded v0.8B.1 numbers');

  // ================= A. enemy Sniper =================
  await fresh();
  const snap = await ev(snapshot);
  const bsnap = basePage ? await basePage.evaluate(snapshot) : null;
  // recorded v0.8B.1 values (c6ae985) when no BASE is served
  const was = bsnap ? bsnap.sniper : { hp: 45, damage: 30, accuracy: 0.6, movePenalty: 10, fireRate: 0.28, range: 600, moveSpeed: 70, projectileSpeed: 1100, aimTime: 1.6, lockTime: 0.45 };
  const S = snap.sniper, infHp = snap.infantry.hp;
  check('A1 enemy Sniper damage 65 = 65% of a fresh Infantry\'s max HP (v0.8B.1: 30)', S.damage === 65 && S.damage === Math.round(0.65 * infHp) && was.damage === 30, `damage ${was.damage} -> ${S.damage}, Infantry ${infHp} HP`);
  check('A2 enemy Sniper round 15% slower (1100 -> 935 px/s)', S.projectileSpeed === 935 && Math.abs(S.projectileSpeed - was.projectileSpeed * 0.85) < 1e-9, `${was.projectileSpeed} -> ${S.projectileSpeed} px/s`);
  const same = ['hp', 'accuracy', 'movePenalty', 'fireRate', 'range', 'moveSpeed', 'aimTime', 'lockTime', 'turnRate', 'aimTolerance', 'radius', 'aggroRadius'].filter((k) => k in was && S[k] !== was[k]);
  check('A3 cadence (0.28/s), aim 1.6 s, lock 0.45 s, 0.6° cone, 600 px range, HP and movement unchanged', same.length === 0 && S.fireRate === 0.28 && S.aimTime === 1.6 && S.lockTime === 0.45, same.length ? `changed: ${same.join()}` : `rate ${S.fireRate}/s, aim ${S.aimTime} s, lock ${S.lockTime} s, cone ${S.accuracy}°, range ${S.range}`);
  check('A4 player Sniper class untouched (32 dmg, 1500 px/s, 0.8/s, 0.45 s aim)', snap.squadSniper.damage === 32 && snap.squadSniper.projectileSpeed === 1500 && snap.squadSniper.fireRate === 0.8 && snap.squadSniper.aimTime === 0.45 && (!bsnap || JSON.stringify(bsnap.squadSniper) === JSON.stringify(snap.squadSniper)), JSON.stringify({ d: snap.squadSniper.damage, v: snap.squadSniper.projectileSpeed, r: snap.squadSniper.fireRate }));
  if (bsnap) check('A5 riflemen, Armored, towers, Iron Warden, convoy trucks, other classes and Elite rules identical to v0.8B.1', snap.others === bsnap.others, '');

  const hits = await ev(() => {
    const g = T.g, out = {};
    // a fresh, untrained, full-health Infantry (class stats only) at 400 px: one hit, then a second
    const { s, e } = T.duel(400);
    out.hp0 = s.hp; out.maxHp = s.maxHp;
    let n = 0; const shotHp = [];
    T.stepUntil(() => { if (e.shots > n && !g.projectiles.some((q) => q.owner === e)) { n = e.shots; shotHp.push([+s.hp.toFixed(2), s.state]); } return shotHp.length >= 2 || s.state !== 'active'; }, 20, () => { s.vel = { x: 0, y: 0 }; s.pos = { x: T.LANE.x - 400, y: T.LANE.y }; });
    T.step(0.2, () => { s.vel = { x: 0, y: 0 }; });
    out.after = shotHp; out.state = s.state;
    // the round in flight: its speed and time to cover 400 px
    const d2 = T.duel(500); let p = null, t0 = 0;
    T.stepUntil(() => { p = g.projectiles.find((q) => q.owner === d2.e); if (p) t0 = g.time; return !!p; }, 6, () => { d2.s.vel = { x: 0, y: 0 }; });
    out.speed = p ? +Math.hypot(p.vel.x, p.vel.y).toFixed(2) : null; out.damage = p ? p.damage : null; out.precise = p ? p.precise : null;
    const hp1 = d2.s.hp; T.stepUntil(() => d2.s.hp < hp1, 2, () => { d2.s.vel = { x: 0, y: 0 }; }); out.flight = +(g.time - t0).toFixed(3);
    // every class at level 1, untrained: hits to go down
    out.classes = {};
    for (const c of ['infantry', 'heavy', 'medic', 'sniper', 'commando']) {
      const d3 = T.duel(400, c); const u = d3.s; let k = 0, shots = d3.e.shots;
      T.stepUntil(() => { if (d3.e.shots > shots && !g.projectiles.some((q) => q.owner === d3.e)) { shots = d3.e.shots; k++; } return u.state !== 'active'; }, 40, () => { u.vel = { x: 0, y: 0 }; u.pos = { x: T.LANE.x - 400, y: T.LANE.y }; });
      out.classes[c] = `${u.maxHp}hp:${k}`;
    }
    return out;
  });
  check('A6 a fresh Infantry hit once by an enemy Sniper: 100 -> 35 HP, still fighting', hits.hp0 === 100 && hits.maxHp === 100 && hits.after[0] && hits.after[0][0] === 35 && hits.after[0][1] === 'active', JSON.stringify(hits.after));
  // (a lone soldier going down ends the mission, so the second hit may read KIA rather than downed)
  check('A7 two unmitigated hits down a healthy, untrained Infantry', hits.after.length === 2 && hits.after[1][0] <= 0 && hits.after[1][1] !== 'active' && hits.state !== 'active', JSON.stringify([hits.after, hits.state]));
  check('A8 measured round: 935 px/s, 65 damage, precision tracer; 500 px in ~0.53 s', hits.speed === 935 && hits.damage === 65 && hits.precise === true && hits.flight > 0.48 && hits.flight < 0.58, `${hits.speed} px/s, ${hits.damage} dmg, flight ${hits.flight} s`);
  check('A9 untrained level-1 classes: Infantry / Medic / Sniper / Commando down in 2 hits, Heavy Gunner (150 HP) in 3', hits.classes.infantry === '100hp:2' && hits.classes.medic === '80hp:2' && hits.classes.sniper === '75hp:2' && hits.classes.commando === '85hp:2' && hits.classes.heavy === '150hp:3', JSON.stringify(hits.classes));

  const cad = await ev(() => T.cadence(400, 22));
  const bcad = basePage ? await basePage.evaluate(() => T.cadence(400, 22)) : null;
  const gaps = (t) => t.slice(1).map((x, i) => +(x - t[i]).toFixed(3));
  const g1 = gaps(cad), g0 = bcad ? gaps(bcad) : null;
  check('A10 measured cadence unchanged: a shot every 1/0.28 + 1.6 s aim = 5.17 s (same shot times as v0.8B.1)', g1.length >= 3 && g1.every((x) => Math.abs(x - (1 / 0.28 + 1.6)) < 0.05) && (!bcad || JSON.stringify(cad) === JSON.stringify(bcad)), `gaps ${g1.join()}${g0 ? ` · v0.8B.1 ${g0.join()}` : ''}`);

  const mit = await ev(() => {
    const g = T.g, out = {};
    window.__debugUnlockAll();
    // Juggernaut (Ironclad -20%) takes the hit through Game.damage like any other round
    const tank = T.R.get('tank'); tank.progression.xp = T.P.xpForLevel(25); tank.progression.level = 25; T.a.credits += 5000;
    out.promoted = T.E.promote(T.R, T.a, 'tank', 'hvy-juggernaut', null).ok;
    g.selectMission('supply-line', true); g.deploy([T.R.get('tank')], 'roster'); T.calm();
    const s = g.soldiers[0]; s.pos = { x: T.LANE.x - 400, y: T.LANE.y }; g.anchor = { ...s.pos }; g.cam = { x: T.LANE.x - 200, y: T.LANE.y };
    const e = g.spawnEnemy({ ...T.LANE }, 'sniper'); e.guard = true;
    const hp0 = s.hp; T.stepUntil(() => s.hp < hp0, 8, () => { s.vel = { x: 0, y: 0 }; s.pos = { x: T.LANE.x - 400, y: T.LANE.y }; });
    out.jugg = +(hp0 - s.hp).toFixed(2); out.elite = s.elite && s.elite.id;
    // cover: a soldier behind the Mission 6 building (B 1050,1000) is never shot; the round stops on walls
    g.selectMission('bridgehead', true); g.reset(['infantry']); T.calm();
    const s2 = g.soldiers[0]; s2.pos = { x: 1150, y: 1180 }; g.anchor = { ...s2.pos };
    const e2 = g.spawnEnemy({ x: 1150, y: 880 }, 'sniper'); e2.guard = true;
    out.blocked = !g.world.clear(s2.pos, e2.pos);
    let sh = e2.shots, cover = 0; const hp2 = s2.hp;
    T.step(8, () => { s2.vel = { x: 0, y: 0 }; s2.pos = { x: 1150, y: 1180 }; if (e2.shots > sh) { if (!g.world.clear(s2.pos, e2.pos)) cover++; sh = e2.shots; } });
    out.cover = cover; out.coverDmg = hp2 - s2.hp;
    return out;
  });
  check('A11 Elite mitigation still applies through Game.damage: Juggernaut (Ironclad -20%) takes 52 of 65', mit.promoted && mit.elite === 'hvy-juggernaut' && Math.abs(mit.jugg - 52) < 1e-6, JSON.stringify(mit));
  check('A12 cover: no enemy Sniper shot through a building, no damage behind it (8 s)', mit.blocked && mit.cover === 0 && mit.coverDmg === 0, JSON.stringify({ blocked: mit.blocked, cover: mit.cover, dmg: mit.coverDmg }));

  const still = await ev(() => [300, 450, 580].map((d) => T.dodge(d, 99, 1, 0)));
  check('A13 a soldier who stays on the locked line is hit at 300 / 450 / 580 px (precision kept)', still.every((x) => x.fired && x.hit), JSON.stringify(still));
  const win = await ev(() => [300, 450, 580].map((d) => T.window(d)));
  const bwin = basePage ? await basePage.evaluate(() => [300, 450, 580].map((d) => T.window(d))) : null;
  check('A14 dodge: starting to move up to >= 0.3 s after the lock still dodges at 300 / 450 / 580 px', win.every((w) => typeof w === 'number' && w >= 0.3), `latest reaction after lock (s): ${win.join(' / ')}${bwin ? ` · v0.8B.1 ${bwin.join(' / ')}` : ''}`);
  if (bwin) check('A15 the slower round widens the dodge window vs v0.8B.1 (never shorter by more than one 0.05 s step)', win.every((w, i) => w >= bwin[i] - 0.05) && win.reduce((a, b) => a + b, 0) > bwin.reduce((a, b) => a + b, 0), `${bwin.join(' / ')} -> ${win.join(' / ')} s`);

  const spawn = await ev(() => {
    const g = T.g;
    T.generic(['infantry', 'infantry', 'infantry'], 'supply-line'); g.invuln = true;
    const L = T.LANE; T.pinAt({ x: L.x - 420, y: L.y }, 40); g.cam = { x: L.x - 200, y: L.y };
    const t0 = g.time, es = [0, 1, 2].map((i) => { const e = g.spawnEnemy({ x: L.x, y: L.y - 60 + i * 60 }, 'sniper'); e.guard = true; return e; });
    const first = es.map(() => null), aimed = es.map(() => null);
    T.step(4, () => { T.pinAt({ x: L.x - 420, y: L.y }, 40); es.forEach((e, i) => { if (aimed[i] === null && e.aimHeld > 0) aimed[i] = +(g.time - t0).toFixed(2); if (first[i] === null && e.shots > 0) first[i] = +(g.time - t0).toFixed(2); }); });
    g.invuln = false;
    return { first, aimed };
  });
  check('A16 snipers spawned together: each shows its laser for the full 1.6 s aim before its first shot (no instant hits)', spawn.first.every((t, i) => t !== null && spawn.aimed[i] !== null && t - spawn.aimed[i] >= 1.6 - 0.02), JSON.stringify(spawn));

  // ================= B. Mission 14 suspense =================
  await fresh();
  const m14 = await ev(() => {
    window.__debugUnlockAll();
    const g = T.g, out = {};
    const { m, v, esc } = T.escort('heavy'); g.invuln = true;
    T.step(0.1);
    out.start = T.hudNow();
    // drive the whole road: sample the HUD at every ambush and before the end
    const seen = { escorting: 0, extractBar: 0, progress: 0, bar: 0, count: 0, distance: 0, final: 0, numbered: 0, ambushChip: 0, truckMeter: 0, samples: 0 };
    const banners = new Set();
    const look = () => {
      const h = T.hudNow(); seen.samples++;
      // after the truck arrives the extraction countdown may show its own bar (extraction guidance, as before)
      if (esc.state !== 'active') { if (h.bar && /extract/i.test(h.text + h.sub)) seen.extractBar++; }
      else { seen.escorting++; if (h.progress !== undefined) seen.progress++; if (h.bar) seen.bar++; if (h.meter === 'TRUCK') seen.truckMeter++; }
      if (/ambush(es)? \d|\d\s*\/\s*5|amb \d/i.test(h.sub + ' ' + h.dom + ' ' + h.chips.join(' '))) seen.count++;
      if (/\d+\s*(%|px|m\b)|remaining|to go|left to/i.test(h.sub + ' ' + h.dom)) seen.distance++;
      if (h.chips.some((c) => /\d/.test(c))) seen.numbered++;
      if (h.chips.includes('AMBUSH')) seen.ambushChip++;
      for (const b of h.banners) banners.add(b);
      if (/FINAL/i.test(h.banners.join(' ') + ' ' + h.dom)) seen.final++;
    };
    let guard = 0;
    while (v.state !== 'arrived' && guard++ < 60 * 220) {
      // the squad leads 320 px ahead along the road; near the end it waits beside the road (not in the truck's path)
      const ahead = v.s + 320, q = v.at(Math.min(v.total, ahead));
      T.pinAt(ahead > v.total - 80 ? g.findOpenNear({ x: q.p.x - Math.sin(q.a) * 150, y: q.p.y + Math.cos(q.a) * 150 }, 40) : q.p);
      g.update(1 / 60);
      if (guard % 30 === 0) look();
      if (guard % 240 === 0) for (const e of g.enemies) if (e.active && !e.structure && !e.vehicle) g.damage(e, 1e9, g.soldiers[0]);
    }
    // the last staggered groups of Ambush 5 land after the truck arrives (keep watching the HUD meanwhile)
    const side = g.findOpenNear({ x: v.unit.pos.x - Math.sin(v.unit.aim) * 150, y: v.unit.pos.y + Math.cos(v.unit.aim) * 150 }, 40);
    T.step(25, (i) => { T.pinAt(side); if (i % 30 === 0) look(); if (i % 240 === 0) for (const e of g.enemies) if (e.active && !e.structure && !e.vehicle) g.damage(e, 1e9, g.soldiers[0]); });
    out.seen = seen; out.banners = [...banners];
    out.fired = esc.ambushes.fired.join(); out.spawned = esc.ambushes.spawnedCount; out.vstate = v.state; out.esc = esc.state;
    out.truckHp = Math.round(v.unit.hp); out.truckMax = v.unit.maxHp;
    // after the escort: extraction guidance as before (objective + countdown bar once the squad is in the zone)
    T.step(0.5);
    out.after = { phase: m.phase, obj: m.currentObjective ? m.currentObjective.id : null, text: g.objective.text };
    const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    T.calm(); T.pinAt(c); if (v.unit) { /* the truck stays where it arrived */ }
    let barDuringCountdown = false;
    T.stepUntil(() => { if (g.phase === 'playing' && T.hudNow().bar) barDuringCountdown = true; return g.phase !== 'playing'; }, 40, () => T.pinAt(c));
    out.end = { phase: g.phase, countdownBar: barDuringCountdown || seen.extractBar > 0 };
    g.invuln = false;
    return out;
  });
  const s0 = m14.start;
  check('B1 escort start: objective "Escort it to extraction", truck HP meter, no progress bar, no ambush count', s0.text === 'Escort it to extraction' && s0.meter === 'TRUCK' && s0.progress === undefined && !s0.bar && !/ambush/i.test(s0.sub) && s0.chips.length === 0, JSON.stringify(s0));
  check('B2 the whole road: never a progress bar, %, distance or ambush count (x/5, AMB n) on the HUD', m14.seen.escorting > 100 && m14.seen.progress === 0 && m14.seen.bar === 0 && m14.seen.count === 0 && m14.seen.distance === 0 && m14.seen.numbered === 0 && m14.seen.truckMeter === m14.seen.escorting, JSON.stringify(m14.seen));
  check('B3 no FINAL banner or text; every ambush still announced (AMBUSH / ROADBLOCK warnings)', m14.seen.final === 0 && m14.banners.filter((b) => /AMBUSH|ROADBLOCK/.test(b)).length >= 5, JSON.stringify(m14.banners));
  check('B4 a landed ambush shows one unnumbered AMBUSH chip while its fighters are up', m14.seen.ambushChip > 0, `${m14.seen.ambushChip} samples`);
  check('B5 all five ambushes fire once (54 ambushers), truck arrives, escort complete', m14.fired === '0,1,2,3,4' && m14.spawned === 54 && m14.vstate === 'arrived' && m14.esc === 'complete', JSON.stringify({ f: m14.fired, n: m14.spawned, v: m14.vstate, e: m14.esc, hp: `${m14.truckHp}/${m14.truckMax}` }));
  check('B6 extraction after the escort: guidance, countdown bar in the zone, mission won', m14.after.phase !== 'escort' && /extraction/i.test(m14.after.text) && m14.end.phase === 'won' && m14.end.countdownBar, JSON.stringify([m14.after, m14.end]));
  if (bsnap) {
    const a = snap.m14, b = bsnap.m14;
    check('B7 route, length, truck, gun, enemy groups and extraction identical to v0.8B.1', a.route === b.route && a.total === b.total && a.truck === b.truck && a.gun === b.gun && a.groups === b.groups && a.extraction === b.extraction, `road ${a.total} px (v0.8B.1 ${b.total})`);
    check('B8 ambushes identical to v0.8B.1 (progress points, delays, groups); only Ambush 5\'s banner changed (no FINAL)', a.defs === b.defs && a.banners.slice(0, 4).join('|') === b.banners.slice(0, 4).join('|') && /FINAL/.test(b.banners[4]) && !/FINAL/.test(a.banners[4]), `${b.banners[4]} -> ${a.banners[4]}`);
  }

  // ================= C. Settings =================
  await fresh();
  const def = await ev(() => {
    const t = document.getElementById('tuning');
    const settingsBtn = document.querySelector('#topbtns [data-a="tune"]');
    return {
      hidden: t.classList.contains('hidden'), head: t.querySelector('.tune-head').textContent, sliders: t.querySelectorAll('input[type="range"]').length,
      debug: t.querySelectorAll('[data-a="unlockAll"], [data-a="invuln"], [data-a="resetSave"], textarea, select[data-k="mission"]').length,
      hpLabels: [...t.querySelectorAll('.lbl')].filter((l) => /hp|damage/i.test(l.textContent)).length,
      fps: !!t.querySelector('select[data-k="fps"]'), overlay: !!t.querySelector('input[data-k="perfov"]'), version: t.querySelector('.tune-version').textContent,
      btn: !!settingsBtn,
    };
  });
  const cfgIsDefault = async (p = page) => p.evaluate(() => { const now = JSON.stringify(window.__CFG); window.__resetConfig(); return now === JSON.stringify(window.__CFG); });
  check('C1 normal Settings: no HP / damage (or any other tuning) slider, no debug actions, no config JSON', def.sliders === 0 && def.hpLabels === 0 && def.debug === 0 && /^SETTINGS/.test(def.head), JSON.stringify(def));
  check('C2 normal Settings keep the frame cap, performance overlay and the version label', def.fps && def.overlay && /0\.8B\.2/.test(def.version) && def.btn, def.version);
  check('C3 fresh save: gameplay numbers are the shipped defaults (all multipliers 1.0)', await cfgIsDefault(), '');
  // the main-menu ⚙ opens Settings (player view)
  const opened = await ev(() => {
    const b = document.querySelector('#menu [data-a="settings"]'); if (b) b.click();
    const r = { menuBtn: !!b, open: !document.getElementById('tuning').classList.contains('hidden'), sliders: document.querySelectorAll('#tuning input[type="range"]').length };
    if (r.open) window.__hud.toggleTuning();
    return r;
  });
  check('C4 the menu ⚙ opens Settings for players, still without tuning sliders', opened.menuBtn && opened.open && opened.sliders === 0, JSON.stringify(opened));

  // developer tuning: ?dev=1 only, live, never stored
  await fresh(page, URL, null, '?dev=1');
  const dev = await ev(() => {
    const t = document.getElementById('tuning');
    const paths = [...t.querySelectorAll('.lbl')].map((l) => (l.title || '').split(' ')[0]);
    const hp = [...t.querySelectorAll('.tune-row')].find((r) => r.querySelector('.lbl').title.startsWith('infantry.hp '));
    const inp = hp.querySelector('input'); inp.value = '300'; inp.dispatchEvent(new Event('input'));
    const dmg = [...t.querySelectorAll('.tune-row')].find((r) => r.querySelector('.lbl').title.startsWith('enemy.damage '));
    const i2 = dmg.querySelector('input'); i2.value = '1'; i2.dispatchEvent(new Event('input'));
    window.__persist && window.__persist();
    const g = T.g; T.generic(['infantry'], 'first-contact');
    return { head: t.querySelector('.tune-head').textContent, sliders: t.querySelectorAll('input[type="range"]').length, debug: !!t.querySelector('[data-a="unlockAll"]'), hasHp: paths.includes('infantry.hp') && paths.includes('enemy.damage'), cfg: [window.__CFG.infantry.hp, window.__CFG.enemy.damage], live: g.soldiers[0].maxHp, saved: localStorage.getItem('minisquad.save') || '' };
  });
  check('C5 ?dev=1: developer tuning (HP / damage sliders, debug actions) available and live', dev.sliders > 100 && dev.debug && dev.hasHp && dev.cfg.join() === '300,1' && dev.live === 300 && /DEV TUNING/.test(dev.head), JSON.stringify({ ...dev, saved: dev.saved.length }));
  check('C6 developer tuning never reaches the save', dev.saved.length > 0 && !/"hp":300|"infantry":\{|tuning|CFG|enemySniper/.test(dev.saved), dev.saved.slice(0, 120));
  await page.goto(URL); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(100);
  const back = await ev(() => ({ cfg: [window.__CFG.infantry.hp, window.__CFG.enemy.damage], sliders: document.querySelectorAll('#tuning input[type="range"]').length }));
  check('C7 reload without ?dev=1: tuned values gone (Infantry 100 HP, rifleman 7 damage), no sliders', back.cfg.join() === '100,7' && back.sliders === 0 && await cfgIsDefault(), JSON.stringify(back));

  // existing saves: default and with stray multiplier fields (no build ever stored any: they must do nothing)
  const loadWith = async (raw) => {
    await fresh(page, URL, raw);
    return ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes, cr: window.__account().credits, n: window.game.roster.owned().length, ace: (() => { const g = window.game; g.selectMission('first-contact', true); g.deploy([g.roster.get('ace')], 'roster'); return Math.round(g.soldiers[0].maxHp * 100) / 100; })(), stored: localStorage.getItem('minisquad.save') }));
  };
  const plain = await loadWith(FIX);
  check('C8 existing v0.8B save (default numbers) loads cleanly, CFG at defaults', plain.st === 'loaded' && plain.notes.length === 0 && await cfgIsDefault(), JSON.stringify({ st: plain.st, notes: plain.notes, cr: plain.cr, n: plain.n }));
  const fx = JSON.parse(FIX);
  Object.assign(fx, { settings: { friendlyHpMul: 2.5, friendlyDamageMul: 3, enemyHpMul: 0.2, enemyDamageMul: 0.1 }, tuning: { infantry: { hp: 400, damage: 60 }, enemySniper: { damage: 1 } }, multipliers: { hp: 2, damage: 2 } });
  if (fx.account) fx.account.settings = { friendlyHpMul: 2.5, enemyDamageMul: 0.1 };
  const stray = await loadWith(JSON.stringify(fx));
  check('C9 save carrying nondefault HP / damage multiplier fields: same roster, Credits and HP as without them; CFG at defaults', stray.st !== 'reset' && stray.cr === plain.cr && stray.n === plain.n && stray.ace === plain.ace && await cfgIsDefault(), JSON.stringify({ st: stray.st, notes: stray.notes, cr: stray.cr, ace: [plain.ace, stray.ace] }));
  check('C10 the stray multiplier fields are dropped on the normalising write (nothing invisible left in the save)', !/Mul"|"multipliers"|"tuning"/.test(stray.stored), stray.stored.slice(0, 100));

  // save / reload persistence and unrelated preferences
  const pref = await ev(() => {
    window.__hud.toggleTuning();
    const s = document.querySelector('#tuning select[data-k="fps"]'); s.value = '30'; s.dispatchEvent(new Event('change'));
    const b = document.querySelector('#tuning input[data-k="perfov"]'); b.checked = true; b.dispatchEvent(new Event('change'));
    window.__hud.toggleTuning();
    window.__account().credits += 123; window.__persist();
    return { cr: window.__account().credits, stored: localStorage.getItem('minisquad.dev.perf') };
  });
  await page.reload(); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(100);
  const after = await ev(() => ({ cr: window.__account().credits, perf: window.__perf.settings(), fps: document.querySelector('#tuning select[data-k="fps"]').value, ov: document.querySelector('#tuning input[data-k="perfov"]').checked, st: window.__loadStatus.status }));
  check('C11 save / reload: Credits kept; frame cap 30 and overlay kept and shown in Settings', after.cr === pref.cr && after.perf.fpsCap === 30 && after.perf.overlay === true && after.fps === '30' && after.ov && after.st === 'loaded' && await cfgIsDefault(), JSON.stringify({ pref, after }));
  const mute = await ev(() => {
    const g = T.g; g.selectMission('first-contact', true); g.deploy([g.roster.get('ace')], 'roster'); window.__render();
    const b = document.querySelector('#topbtns [data-a="mute"]'); const t0 = b.textContent;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); const t1 = b.textContent;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); const t2 = b.textContent;
    return [t0, t1, t2];
  });
  check('C12 mute still toggles from the HUD', mute[0] !== mute[1] && mute[0] === mute[2], mute.join(' '));

  await browser.close();
  return finish(errors);
});
