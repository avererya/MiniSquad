// v0.8C rule checks: Mission 15 "General's Last Stand" and the Demolitions Expert (against the live build; BASE =
// v0.8B.2 for the "Missions 1-14 unchanged" checks). Headless Chromium, fixed 1/60 s steps through window.game.
//  A. Campaign: Mission 15 row (number, capacity 6, optional, unlocks), Mission 14 unlocks it, Chapter 3 closes, no M16+
//  B. Fortress: enemy budget (48 + Voss, 7 snipers), placed spawns open / reachable / away from the start, main gate
//     blocks passage until the generator falls, relays only after it, inner gate until both relays fall, the
//     arena's front guard, Voss's entry, clear-the-rest, extraction, the win
//  C. General Voss: stats, cadence 1.5 -> 1.95 shots/s, ordinary projectiles, line of sight, intro / reaction,
//     phases once each and forward only (also on a big hit and after healing), reinforcements 5 + 7 off screen and
//     away from the squad, the resistance in phase 3 (allies, not soldiers), Rally (+20%, 8 s, 25 s, no stacking,
//     never Voss or the squad), leash, HUD boss bar, defeat -> clear waits for radioed troops, reload never resumes
//  D. Victory / unlock: a failure unlocks nothing, the first win unlocks the class (no free soldier), a replay
//     nothing; the resistance optional; stars
//  E. Demolitions Expert: class stats, rocket direct + splash falloff, +30% vs armored, Siege Breaker, Pyrotechnic,
//     no friendly fire, cover, no double hit; Inferno cone / DPS / burn / bypass / duration / cooldown after the
//     effect / Ability Capacity, failed activations free; recruitment (locked before the unlock, guaranteed
//     introduction, 1500 / 350), unique names, caps, training, Elite, KIA / resurrection / Memorial, persistence,
//     save guard
//  F. Saves: SAVE_VERSION 9, every fixture loads
//  G. BASE (v0.8B.2): Missions 1-14 scripts and every pre-v0.8C CFG group identical
//  H. Phones (iPhone SE / 14 / Pixel 7 landscape): briefing fits, boss bar clear of the controls, Inferno button,
//     six soldier panels
// Usage: npm test -- v08c   (or: npx vite preview --port 4173 & BASE=<v0.8B.2 url> node tools/v08c.cjs)
const { chromium, URL, BASE, OUT, createChecks, runSuite } = require('./lib.cjs');
const fs = require('fs');

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get P() { return window.__progression; },
    get R() { return window.game.roster; },
    get C() { return window.__CFG; },
    SQUAD: ['infantry', 'infantry', 'heavy', 'medic', 'heavy', 'demolitions'],
    step(sec, pin) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (pin) pin(i); window.game.update(1 / 60); } },
    stepUntil(cond, maxSec, pin) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (pin) pin(n); window.game.update(1 / 60); n++; } return n / 60; },
    /** Remove every placed enemy soldier (structures, vehicles and both bosses stay). */
    calm() { const g = window.game; for (const e of g.enemies) if (!e.structure && !e.vehicle && e.kind !== 'boss' && e.kind !== 'general') e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active); g.input.move = () => ({ x: 0, y: 0 }); },
    generic(classes, mission, calm = true) { const g = window.game; g.selectMission(mission, true); g.reset(classes); if (calm) this.calm(); g.input.move = () => ({ x: 0, y: 0 }); return g.soldiers; },
    deploy(ids, mission, calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.calm();
      g.input.move = () => ({ x: 0, y: 0 });
      return r;
    },
    pinAt(p, spread = 30, list) { const g = window.game; let i = 0; for (const s of list || g.soldiers) if (s.active) { s.pos = { x: p.x + ((i % 3) - 1) * spread, y: p.y + (Math.floor(i / 3) - 0.5) * spread }; s.vel = { x: 0, y: 0 }; i++; } g.anchor = { ...p }; },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    /** Mission 15 straight to General Voss (gates open, objectives 1-4 done, the placed enemies removed). */
    voss(classes = this.SQUAD, at = { x: 3600, y: 1200 }) {
      const g = window.game; g.selectMission('last-stand', true); g.reset(classes);
      const m = g.mission;
      m.openGate(g, 'test'); m.openGate(g, 'test');
      for (let i = 0; i < 4; i++) m.primaries[i].state = 'complete';
      m.current = 4; this.calm();
      this.pinAt(at); g.cam = { ...at };
      m.primaries[4].activate(m, g); m.phase = m.primaries[4].phase;
      g.banners = [];
      return { g, m, f: m.general, V: m.general.unit };
    },
    /** The rocket mechanics on an open lane (Mission 14 map, x 1000-1700, y 190-730): a Demolitions Expert at the west end. */
    LANE: { x: 1500, y: 460 },
    demo(spec = null) {
      const g = window.game; this.generic(['demolitions'], 'supply-line');
      const s = g.soldiers[0]; s.pos = { x: this.LANE.x - 300, y: this.LANE.y }; s.vel = { x: 0, y: 0 }; s.fireCooldown = 1e9;
      if (spec) s.elite = { id: spec, overdrive: 0, charge: 0, ready: false, effect: 0 };
      g.anchor = { ...s.pos }; g.cam = { x: this.LANE.x - 150, y: this.LANE.y }; g.invuln = true;
      return s;
    },
    /** Is b connected to a on world W's nav grid (flood fill; findPath gives up on very long routes)? */
    reach(W, a, b) {
      const seen = new Uint8Array(W.cols * W.rows), q = [W.idx(a.x, a.y)]; seen[q[0]] = 1;
      while (q.length) { const i = q.pop(), c = i % W.cols, r = (i - c) / W.cols; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= W.cols || nr >= W.rows) continue; const j = nr * W.cols + nc; if (!seen[j] && !W.blocked[j]) { seen[j] = 1; q.push(j); } } }
      return W.isOpen(b.x, b.y) && !!seen[W.idx(b.x, b.y)];
    },
    dummy(p, kind = 'rifleman') { const e = window.game.spawnEnemy({ ...p }, kind); e.hpOverride = 1e5; e.hp = 1e5; e.guard = true; e.aggro = 1; e.fireCooldown = 1e9; e.aim = Math.PI; return e; },
    /** Fire one rocket from `s` that meets `target` 20 px short of it (real projectile, real impact code). */
    rocketAt(s, target, dmg) {
      const g = window.game, dx = target.x - s.pos.x, dy = target.y - s.pos.y, d = Math.hypot(dx, dy), v = 560;
      g.projectiles.push({ pos: { x: target.x - (dx / d) * 30, y: target.y - (dy / d) * 30 }, vel: { x: (dx / d) * v, y: (dy / d) * v }, team: 'squad', damage: dmg ?? s.stats.damage, life: 1, trail: { ...s.pos }, owner: s, rocket: true });
    },
    extract(maxSec = 40) {
      const g = window.game, m = g.mission, z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      this.calm();
      const put = () => [...g.soldiers, ...g.allies].forEach((s, i) => { if (s.active) { s.pos = { x: c.x - 60 + (i % 4) * 40, y: c.y - 40 + Math.floor(i / 4) * 40 }; s.vel = { x: 0, y: 0 }; } });
      put(); g.anchor = { ...c };
      return this.stepUntil(() => g.phase !== 'playing', maxSec, put);
    },
    resolve(policy = 'resurrect') {
      const a = window.__account(); let d;
      while ((d = a.pendingDecision) && d.queue.length) {
        const s = this.R.get(d.queue[0].id);
        if (policy === 'resurrect') { a.credits += window.__casualties.costFor(s); this.E.resurrect(this.R, a, s.id, window.__persist); } else this.E.memorialize(this.R, a, s.id, window.__persist);
      }
    },
    recruitDemo() {
      const a = this.a;
      if (!a.classUnlocks.unlocked.includes('demolitions')) { a.classUnlocks.unlocked.push('demolitions'); a.classUnlocks.notified.push('demolitions'); }
      this.E.openOffice(this.R, a, null);
      let o = null; for (let i = 0; i < 400 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === 'demolitions'); if (!o) { a.credits += 100; this.E.refreshOffers(this.R, a, null, null); } }
      if (!o) return null;
      const price = window.__recruitment.priceOf('demolitions'); a.credits += price; const cr0 = a.credits;
      const r = this.E.recruit(this.R, a, o.id, null);
      return r.ok ? { soldier: r.soldier, paid: cr0 - a.credits, price } : null;
    },
    store() { return JSON.parse(localStorage.getItem(window.__SAVE_KEY)); },
  };
}

/** Page-side: what Missions 1-14 and every pre-v0.8C number look like (compared against BASE). */
function snapshot() {
  const C = window.__CFG, g = window.game;
  const keys = Object.keys(C).filter((k) => !['demolitions', 'general', 'rocket', 'inferno'].includes(k)).sort();
  const out = { cfg: {} };
  for (const k of keys) out.cfg[k] = JSON.stringify(C[k]);
  window.__debugUnlockAll();
  out.missions = {};
  const ids = ['first-contact', 'heavy-support', 'field-medicine', 'red-canyon', 'bring-them-home', 'bridgehead', 'prison-break', 'convoy-crusher', 'blackout', 'iron-fist', 'resistance-rising', 'artillery-hunt', 'hold-the-line', 'supply-line'];
  for (const id of ids) {
    g.selectMission(id, true); g.reset(['infantry', 'heavy', 'medic']);
    const m = g.mission;
    out.missions[id] = JSON.stringify({
      map: m.map.obstacles.length + ':' + m.map.w + 'x' + m.map.h,
      enemies: g.enemies.map((e) => `${e.kind}:${e.tag}:${e.maxHp}:${e.structure || ''}`).sort(),
      obj: m.primaries.map((o) => o.id + ':' + o.label), opt: m.optionals.map((o) => o.id),
      zone: JSON.stringify(m.script.extraction.zone), cd: m.script.extraction.countdown(),
    });
  }
  return out;
}

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 108, detailMax: 360 });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const fresh = async (p = page, url = URL, raw = null) => {
    await p.goto(url); await p.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await p.goto(url); await p.waitForFunction(() => !!window.game); await p.waitForTimeout(100);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. CAMPAIGN =================
  await fresh();
  const camp = await ev(() => {
    const Cm = window.__campaign, d = Cm.campaignMission('last-stand'), m14 = Cm.campaignMission('supply-line');
    return {
      n: d.number, name: d.name, playable: d.playable, cap: Cm.capacityOf('last-stand'), type: d.type, opt: d.optional.map((o) => o.id).join(),
      classes: (d.unlocks.classes || []).join(), missions: d.unlocks.missions.join(), note: d.unlocks.capacityNote, m14: m14.unlocks.missions.join(),
      ids: Cm.CAMPAIGN.map((m) => m.id), max: Math.max(...Cm.CAMPAIGN.map((m) => m.number)), ch: Cm.chapterOf(15).number, brief: !!d.brief, stars: JSON.stringify(d.stars),
      unlockText: !!Cm.CLASS_UNLOCK_TEXT.demolitions,
    };
  });
  check('A1 Mission 15 "General\'s Last Stand": number 15, playable, assault, 6 soldiers, Chapter 3', camp.n === 15 && camp.name === "General's Last Stand" && camp.playable && camp.type === 'assault' && camp.cap === 6 && camp.ch === 3 && camp.brief, JSON.stringify(camp));
  check('A2 the Mission 15 placeholder is gone and nothing past Mission 15 exists (no Chapter 4)', !camp.ids.includes('mission-15') && camp.max === 15 && camp.ids.length === 15, camp.ids.join());
  check('A3 Mission 14\'s first clear unlocks Mission 15; Mission 15 unlocks the Demolitions Expert class and closes Chapter 3', camp.m14 === 'last-stand' && camp.classes === 'demolitions' && camp.missions === '' && /Chapter 3 complete/.test(camp.note) && camp.unlockText, JSON.stringify(camp));
  check('A4 one optional ("allies-alive"), stars: optionals / no KIA', camp.opt === 'allies-alive' && camp.stars === '{"two":"optionals","three":"noKia"}', camp.opt + ' ' + camp.stars);

  // ================= B. FORTRESS =================
  const fort = await ev(() => {
    const g = T.g, out = {};
    g.selectMission('last-stand', true); g.reset(T.SQUAD);
    const m = g.mission;
    const by = {}; for (const e of g.enemies) if (!e.structure) { const k = `${e.tag}`; by[k] = by[k] || { R: 0, A: 0, SN: 0 }; by[k][e.kind === 'armored' ? 'A' : e.kind === 'sniper' ? 'SN' : 'R']++; }
    out.by = by;
    const sum = (tags) => tags.reduce((a, t) => { const x = by[t] || { R: 0, A: 0, SN: 0 }; return { R: a.R + x.R, A: a.A + x.A, SN: a.SN + x.SN }; }, { R: 0, A: 0, SN: 0 });
    out.outer = sum(['outer-field', 'outer-wall', 'generator']); out.inner = sum(['relay-n', 'relay-s', 'courtyard']); out.arena = sum(['arena-front', 'arena-guard']);
    out.placed = g.enemies.filter((e) => !e.structure).length;
    out.structures = g.enemies.filter((e) => e.structure).length;
    out.general = !!m.general || g.enemies.some((e) => e.kind === 'general');
    out.objs = m.primaries.map((o) => o.id);
    out.labels = m.primaries.map((o) => o.label);
    // spawns: open ground, reachable once the gates are open, none near the start
    const start = m.map.start;
    out.near = g.enemies.filter((e) => T.near(e.pos, start) < 700).length;
    out.world0 = g.world === undefined ? null : g.world.obstacles.filter((o) => o.kind === 'gate').length;
    const W = window.game.constructor.worldFor(m.map);
    const bad = (p) => !T.reach(W, start, p);
    out.unreachList = g.enemies.filter((e) => bad(e.pos)).map((e) => `${e.tag}@${Math.round(e.pos.x)},${Math.round(e.pos.y)}`);
    out.unreach = out.unreachList.length;
    out.pointsList = [...m.script.general.gates, ...m.script.general.allyEntry, m.script.general.spawn].filter(bad).map((p) => `${p.x},${p.y}:${W.isOpen(p.x, p.y)}`);
    out.points = out.pointsList.length;
    out.extract = T.reach(W, start, { x: m.extraction.zone.x + m.extraction.zone.w / 2, y: m.extraction.zone.y + m.extraction.zone.h / 2 });
    out.snipers = g.enemies.filter((e) => e.kind === 'sniper').map((e) => `${e.stats.damage}/${e.stats.projectileSpeed}`);
    out.kits = m.map.medkits.filter((p) => p.x > 3020).length;
    return out;
  });
  check('B1 enemy budget: outer 12 (6 R / 4 A / 2 SN), inner 16 (7 / 6 / 3), arena 8 (3 / 4 / 1) = 36 placed, no Voss yet', JSON.stringify(fort.outer) === '{"R":6,"A":4,"SN":2}' && JSON.stringify(fort.inner) === '{"R":7,"A":6,"SN":3}' && JSON.stringify(fort.arena) === '{"R":3,"A":4,"SN":1}' && fort.placed === 36 && !fort.general && fort.structures === 0, JSON.stringify({ o: fort.outer, i: fort.inner, a: fort.arena, n: fort.placed, s: fort.structures }));
  check('B1b all placed Snipers (6, plus 1 in Voss\'s phase 3 call = 7) use the v0.8B.2 Sniper: 65 damage, 935 px/s', fort.snipers.length === 6 && fort.snipers.every((x) => x === '65/935'), fort.snipers.join());
  check('B2 objective chain: outer -> generator -> relays -> command area -> Voss -> clear', fort.objs.join() === 'outer,generator,relays,assault,voss,clear', fort.labels.join(' | '));
  check('B3 every placed enemy and Voss / reinforcement / ally point is open ground reachable from the start; none within 700 px of it', fort.unreach === 0 && fort.points === 0 && fort.near === 0 && fort.extract, JSON.stringify({ unreach: fort.unreachList, pts: fort.pointsList, near: fort.near, ext: fort.extract }));
  check('B4 both gates shut at the start (lockdown world), no medkit past the inner gate (no heal before the boss)', fort.world0 === 2 && fort.kits === 0, JSON.stringify({ gates: fort.world0, kits: fort.kits }));

  const gates = await ev(() => {
    const g = T.g, out = {};
    g.selectMission('last-stand', true); g.reset(['infantry', 'heavy']); g.invuln = true;
    const m = g.mission;
    const start = m.map.start, court = { x: 2400, y: 1300 }, arena = { x: 3500, y: 1200 };
    const pathTo = (p) => T.reach(g.world, start, p);
    out.p0 = [pathTo(court), pathTo(arena)];
    out.genBefore = g.enemies.filter((e) => e.structure).length;
    out.cur0 = m.currentObjective && m.currentObjective.id;
    // walk at the main gate for 6 s: nobody gets through
    const push = (x0, y) => { T.pinAt({ x: x0, y }, 20); let max = 0; g.input.move = () => ({ x: 1, y: 0 }); T.step(6, () => { for (const s of g.soldiers) max = Math.max(max, s.pos.x); }); g.input.move = () => ({ x: 0, y: 0 }); return Math.round(max); };
    T.calm();
    out.mainX = push(1700, 1200);
    // the outer defenders were removed: the next step completes "outer" and the generator appears
    T.step(0.1);
    const gen = g.enemies.find((e) => e.structure === 'generator');
    out.cur1 = m.currentObjective && m.currentObjective.id; out.gen = gen ? { hp: gen.maxHp, x: Math.round(gen.pos.x), y: Math.round(gen.pos.y) } : null;
    out.hud1 = `${g.objective.text} · ${g.objective.sub}`;
    out.relays0 = g.enemies.filter((e) => e.structure === 'relay').length;
    out.p1 = [pathTo(court), pathTo(arena)];
    g.damage(gen, gen.maxHp * 0.5, g.soldiers[0]); T.step(0.1);
    out.p1b = pathTo(court);
    g.damage(gen, 1e5, g.soldiers[0]); T.step(0.1);
    out.cur2 = m.currentObjective && m.currentObjective.id; out.opened = m.gatesOpened;
    out.banner = g.banners.map((b) => b.text).join(' | ');
    out.p2 = [pathTo(court), pathTo(arena)];
    out.mainX2 = push(1700, 1200);
    const relays = g.enemies.filter((e) => e.structure === 'relay');
    out.relays = relays.length; out.hud2 = `${g.objective.text} · ${g.objective.sub} · ${(g.objective.chips || []).map((c) => c.label).join('')}`;
    out.innerX = push(2900, 1200);
    g.damage(relays[0], 1e5, g.soldiers[0]); T.step(0.1);
    out.hud3 = g.objective.sub; out.p3 = pathTo(arena); out.innerX2 = push(2900, 1200);
    // the arena's front guard killed BEFORE the relays fall still counts (live count, not kill events)
    for (const e of g.enemies.filter((e) => e.tag === 'arena-front')) g.damage(e, 1e5, g.soldiers[0]);
    T.step(0.1);
    out.front = g.enemies.filter((e) => e.tag === 'arena-front' && e.active).length;
    g.damage(relays[1], 1e5, g.soldiers[0]); T.step(0.1);
    out.cur3 = m.currentObjective && m.currentObjective.id; out.opened2 = m.gatesOpened;
    out.banner2 = g.banners.map((b) => b.text).join(' | ');
    out.p4 = pathTo(arena); out.innerX3 = push(2900, 1200);
    g.invuln = false;
    return out;
  });
  check('B5 main gate shut: no path into the fortress, a squad pushing east for 6 s stays outside (x < 1800)', !gates.p0[0] && !gates.p0[1] && gates.mainX < 1800, JSON.stringify({ p0: gates.p0, x: gates.mainX }));
  check('B6 no generator before the outer defenses fall; then the generator (1200 HP) in the north-west annex, gate still shut', gates.genBefore === 0 && gates.cur0 === 'outer' && gates.cur1 === 'generator' && gates.gen && gates.gen.hp === 1200 && gates.gen.x < 1800 && gates.gen.y < 700 && !gates.p1[0] && !gates.p1b && /LOCKED/.test(gates.hud1), JSON.stringify({ gen: gates.gen, hud: gates.hud1, g0: gates.genBefore, c: [gates.cur0, gates.cur1], p1: gates.p1, p1b: gates.p1b }));
  check('B7 relays never exist before the generator falls (cannot be skipped)', gates.relays0 === 0, String(gates.relays0));
  check('B8 generator destroyed: the main gate opens (banner, path, the squad walks in), the inner gate stays shut', gates.cur2 === 'relays' && gates.opened === 1 && /MAIN GATE IS OPEN/.test(gates.banner) && gates.p2[0] && !gates.p2[1] && gates.mainX2 > 1830 && gates.innerX < 3000, JSON.stringify({ opened: gates.opened, p2: gates.p2, x: gates.mainX2, inner: gates.innerX }));
  check('B9 two relays with clear status ("Relays destroyed: 0/2", chips R1 R2); one down: 1/2 and the inner gate still shut', gates.relays === 2 && /Relays destroyed: 0\/2/.test(gates.hud2) && /R1R2/.test(gates.hud2) && /1\/2/.test(gates.hud3) && !gates.p3 && gates.innerX2 < 3000, JSON.stringify({ h2: gates.hud2, h3: gates.hud3 }));
  check('B10 both relays down: the inner gate opens; the command-area objective completes at once when its guard is already dead', gates.opened2 === 2 && gates.p4 && gates.innerX3 > 3030 && /INNER GATE IS OPEN/.test(gates.banner2) && gates.front === 0 && (gates.cur3 === 'voss'), JSON.stringify({ opened: gates.opened2, cur: gates.cur3, x: gates.innerX3, p4: gates.p4, front: gates.front, b: gates.banner2 }));

  // ================= C. GENERAL VOSS =================
  const vs = await ev(() => {
    const out = {};
    const { g, m, f, V } = T.voss();
    out.stats = { hp: V.maxHp, label: V.label, kind: V.kind, inSoldiers: g.soldiers.includes(V) };
    out.C = T.C.general; out.soldierRange = Math.min(...['infantry', 'heavy', 'medic', 'demolitions'].map((c) => T.C[c].range));
    g.invuln = true;
    for (const s of g.soldiers) s.fireCooldown = 1e9;
    const hold = () => { T.pinAt({ x: 3750, y: 1200 }); for (const s of g.soldiers) s.fireCooldown = 1e9; };
    // intro: no shot for 1.5 s; then shots on a fixed cadence
    const shotTimes = []; let n = 0, t0 = g.time;
    T.step(22, () => { hold(); if (f.shots > n) { n = f.shots; shotTimes.push(+(g.time - t0).toFixed(3)); } });
    out.first = shotTimes[0]; out.phase1 = shotTimes.slice(2, 14);
    out.proj = g.projectiles.filter((p) => p.owner === V).map((p) => ({ d: p.damage, v: Math.round(Math.hypot(p.vel.x, p.vel.y)) }))[0] || null;
    out.hud = (() => { window.__render(); const b = document.querySelector('.obj-boss'); return { shown: getComputedStyle(b).display !== 'none', name: b.querySelector('.ob-name').textContent, t1: b.querySelector('.ob-t1').style.left, t2: b.querySelector('.ob-t2').style.left, st: b.querySelector('.ob-state').textContent, fill: b.querySelector('.ob-fill').style.width }; })();
    // phase 2 below 70%
    g.damage(V, V.maxHp * 0.31, g.soldiers[0]);
    T.step(0.05, hold);
    out.p2 = { phase: f.phase, called: f.called.join(), pending: f.pendingCount, hold: g.banners.some((b) => /REINFORCEMENTS/.test(b.text)) };
    const seen = new Map();
    T.step(6.2, () => { hold(); for (const e of g.enemies) if (e.tag === 'voss-r2' && !seen.has(e)) seen.set(e, Math.min(...g.soldiers.map((s) => T.near(s.pos, e.pos)))); });
    const r2 = g.enemies.filter((e) => e.tag === 'voss-r2');
    out.r2 = { n: r2.length, kinds: r2.map((e) => e.kind[0]).sort().join(''), spawned: m.spawned.get('voss-r2'), minD: Math.round(Math.min(...seen.values())), onScreen: f.log.filter((l) => /^call/.test(l.what)).length, guard: r2.some((e) => e.guard) };
    // heal him back to full: the phase never goes back, nothing is called again
    V.hp = V.maxHp; T.step(8, hold);
    out.healed = { phase: f.phase, called: f.called.join(), r2: g.enemies.filter((e) => e.tag === 'voss-r2').length + 0, spawned: m.spawned.get('voss-r2') };
    // phase 3 below 35% (straight from full: phase 2 is already done, phase 3 runs once)
    g.damage(V, V.maxHp * 0.66, g.soldiers[0]);
    T.step(0.05, hold);
    out.p3 = { phase: f.phase, called: f.called.join(), allies: g.allies.map((a) => `${a.name}:${a.ally}:${g.soldiers.includes(a)}`).join(), notice: g.notice && g.notice.text, rate: f.fireRate };
    const s3 = []; n = f.shots; t0 = g.time;
    T.step(16, () => { hold(); for (const e of g.enemies) if (e !== V) e.fireCooldown = 1e9; for (const a of g.allies) a.fireCooldown = 1e9; if (f.shots > n) { n = f.shots; s3.push(+(g.time - t0).toFixed(3)); } });
    out.phase3 = s3.slice(2, 16);
    const r3 = g.enemies.filter((e) => e.tag === 'voss-r3');
    out.r3 = { n: r3.length, kinds: r3.map((e) => e.kind[0]).sort().join(''), spawned: m.spawned.get('voss-r3') };
    out.alliesDist = Math.round(Math.min(...g.allies.map((a) => T.near(a.pos, V.pos))));
    out.log = f.log.map((l) => l.what).filter((w) => !/^rally/.test(w)).join(' ');
    g.invuln = false;
    return out;
  });
  check('C1 General Voss: 2200 HP, GENERAL VOSS, an enemy (never in the squad), phases at 70% / 35%', vs.stats.hp === 2200 && vs.stats.label === 'GENERAL VOSS' && vs.stats.kind === 'general' && !vs.stats.inSoldiers && vs.C.phase2 === 0.7 && vs.C.phase3 === 0.35, JSON.stringify(vs.stats));
  check('C2 rifle: 20 damage per round, an ordinary projectile (430 px/s), range 400 <= every soldier\'s range (never out-ranges the squad)', vs.C.damage === 20 && vs.proj && vs.proj.d === 20 && vs.proj.v === vs.C.projectileSpeed && vs.C.range <= vs.soldierRange, JSON.stringify({ proj: vs.proj, range: vs.C.range, soldiers: vs.soldierRange }));
  const gaps = (t) => t.slice(1).map((x, i) => +(x - t[i]).toFixed(3));
  const g1 = gaps(vs.phase1), g3 = gaps(vs.phase3);
  check('C3 measured cadence 1.5 shots/s (a round every 0.667 s), first shot only after the 1.5 s entrance', g1.length >= 8 && g1.every((x) => Math.abs(x - 1 / 1.5) < 0.02) && vs.first >= 1.5, `first ${vs.first}s · gaps ${g1.join()}`);
  check('C4 phase 3: 1.95 shots/s (a round every 0.513 s)', vs.p3.rate === 1.95 && g3.length >= 8 && g3.every((x) => Math.abs(x - 1 / 1.95) < 0.02), g3.join());
  check('C5 boss HP bar: GENERAL VOSS, phase ticks at 70% / 35%, state, fill', vs.hud.shown && vs.hud.name === 'GENERAL VOSS' && vs.hud.t1 === '70%' && vs.hud.t2 === '35%' && /PHASE 1|RALLY/.test(vs.hud.st) && vs.hud.fill === '100%', JSON.stringify(vs.hud));
  check('C6 below 70%: phase 2 once, reinforcements radioed (banner), 5 arrive (3 R + 2 A) in two halves', vs.p2.phase === 2 && vs.p2.called === '2' && vs.p2.pending === 2 && vs.p2.hold && vs.r2.n === 5 && vs.r2.kinds === 'aarrr' && vs.r2.spawned === 5 && !vs.r2.guard, JSON.stringify({ p2: vs.p2, r2: vs.r2 }));
  check('C7 reinforcements arrive out of view and well away from the squad (>= 600 px)', vs.r2.minD >= 600, `nearest ${vs.r2.minD} px`);
  check('C8 healed back to full: still phase 2, no second call (no retrigger)', vs.healed.phase === 2 && vs.healed.called === '2' && vs.healed.spawned === 5, JSON.stringify(vs.healed));
  check('C9 below 35%: phase 3 once, 7 reinforcements (3 R + 3 A + 1 SN), budget 5 + 7 = 12', vs.p3.phase === 3 && vs.p3.called === '2,3' && vs.r3.n === 7 && vs.r3.kinds === 'aaarrrs' && vs.r3.spawned === 7, JSON.stringify({ p3: vs.p3, r3: vs.r3 }));
  check('C10 phase 3: Mara, Elias and Tessa arrive as resistance allies (not soldiers), announced without a pause', vs.p3.allies === 'MARA:true:false,ELIAS:true:false,TESSA:true:false' && /RESISTANCE ARRIVES/.test(vs.p3.notice || ''), JSON.stringify({ allies: vs.p3.allies, notice: vs.p3.notice }));
  check('C11 the fight log: fight, phase2, both halves, phase3, allies, both halves (each once)', /^fight phase2 call2:3 call2:2 phase3 allies call3:4 call3:3$/.test(vs.log), vs.log);

  const big = await ev(() => {
    const { g, f, V } = T.voss(); g.invuln = true;
    T.step(2, () => T.pinAt({ x: 3750, y: 1200 }));
    g.damage(V, V.maxHp * 0.7, g.soldiers[0]); // 100% -> 30% in one hit
    T.step(0.05);
    const out = { phase: f.phase, called: f.called.join(), log: f.log.map((l) => l.what).filter((w) => !/^rally/.test(w)).join(' '), pending: f.pendingCount };
    // kill him with troops still on their way: they arrive anyway, and the clean-up waits for them
    g.damage(V, 1e5, g.soldiers[0]); T.step(0.05);
    const m = g.mission;
    out.after = { dead: V.state, cur: m.currentObjective && m.currentObjective.id, pending: f.pendingCount, r: g.enemies.filter((e) => /^voss-r/.test(e.tag || '') && e.active).length, wreck: m.wrecks.some((w) => w.kind === 'voss') };
    out.hud = g.objective.text + ' · ' + g.objective.sub;
    T.calm(); T.step(0.1);
    out.done = { cur: m.currentObjective ? m.currentObjective.id : m.phase };
    g.invuln = false;
    return out;
  });
  check('C12 a big hit past both thresholds runs phase 2 then phase 3 in order, each once', big.phase === 3 && big.called === '2,3' && /phase2 phase3 allies call2:3 call3:4/.test(big.log) && big.pending === 2 + 3, JSON.stringify(big));
  check('C13 Voss falls: his objective completes, radioed troops still arrive (budget kept), "clear the remaining defenders" counts them', big.after.dead !== 'active' && big.after.cur === 'clear' && big.after.pending === 0 && big.after.r === 12 && big.after.wreck && /Clear the remaining defenders/.test(big.hud) && /12/.test(big.hud), JSON.stringify({ after: big.after, hud: big.hud }));
  check('C14 nothing left standing: on to extraction', big.done.cur === 'toExtraction', JSON.stringify(big.done));

  const rally = await ev(() => {
    const { g, f, V } = T.voss(); g.invuln = true;
    const out = {};
    const near = g.spawnEnemy({ x: V.pos.x - 150, y: V.pos.y + 60 }), far = g.spawnEnemy({ x: V.pos.x - 150, y: V.pos.y + 420 });
    for (const e of [near, far]) { e.guard = true; e.aggro = 1; }
    const hold = () => { T.pinAt({ x: 3700, y: 1200 }); V.pos = { x: 4100, y: 1200 }; near.pos = { x: 3950, y: 1260 }; far.pos = { x: 3600, y: 1500 }; for (const s of g.soldiers) s.fireCooldown = 1e9; };
    const t0 = g.time; const ral = [];
    let last = f.rallies;
    T.step(60, () => { hold(); if (f.rallies > last) { last = f.rallies; ral.push(+(g.time - t0).toFixed(2)); } });
    out.times = ral; out.cfg = { r: T.C.general.rallyRadius, b: T.C.general.rallyBonus, d: T.C.general.rallyDuration, c: T.C.general.rallyCooldown };
    out.nearUntil = +(near.rallyUntil - t0).toFixed(2); out.far = far.rallyUntil; out.voss = V.rallyUntil; out.squad = g.soldiers.every((s) => !(s.rallyUntil > 0)) && g.allies.every((s) => !(s.rallyUntil > 0));
    // damage of a round fired by a rallied / unrallied rifleman (same base 7)
    const fire = (e) => { g.projectiles = []; e.fireCooldown = 0; e.target = null; let p = null; T.stepUntil(() => (p = g.projectiles.find((q) => q.owner === e)), 4, hold); return p ? +p.damage.toFixed(3) : null; };
    near.rallyUntil = g.time + 8; far.rallyUntil = -1;
    out.dmgNear = fire(near); out.dmgFar = fire(far);
    // a second Rally while the first runs refreshes, never stacks
    near.rallyUntil = g.time + 3; f.rallyT = 0; T.step(0.05, hold);
    out.refresh = +(near.rallyUntil - g.time).toFixed(2); out.dmgAgain = fire(near);
    out.banner = g.banners.map((b) => b.text).find((t) => /RALL/.test(t)) || '';
    g.invuln = false;
    return out;
  });
  const rg = gaps(rally.times);
  check('C15 Rally: first 6 s into the fight, then every 25 s (radius 300 px, +20%, 8 s), with a banner', rally.cfg.r === 300 && rally.cfg.b === 0.2 && rally.cfg.d === 8 && rally.cfg.c === 25 && Math.abs(rally.times[0] - 7.5) < 0.1 && rg.length >= 1 && rg.every((x) => Math.abs(x - 25) < 0.05) && /RALLIES/.test(rally.banner), `rallies at ${rally.times.join()} s (fight starts 1.5 s in) · ${rally.banner}`);
  check('C16 Rally reaches enemies within 300 px only, never Voss himself, never the squad or allies', rally.nearUntil > 0 && rally.far < 0 && rally.voss < 0 && rally.squad, JSON.stringify({ near: rally.nearUntil, far: rally.far, voss: rally.voss, squad: rally.squad }));
  check('C17 a rallied rifleman\'s round: 7 x 1.2 = 8.4 damage (unrallied 7); a second Rally refreshes to 8 s, never stacks', rally.dmgNear === 8.4 && rally.dmgFar === 7 && rally.dmgAgain === 8.4 && Math.abs(rally.refresh - 8) < 0.06, JSON.stringify({ near: rally.dmgNear, far: rally.dmgFar, again: rally.dmgAgain, refresh: rally.refresh }));

  const los = await ev(() => {
    const { g, f, V } = T.voss(); g.invuln = true;
    const out = {};
    // a soldier behind the arena's north-east cover block (K 3980,760 100x60): Voss pinned south of it
    const vp = { x: 4030, y: 900 }, sp = { x: 4030, y: 640 };
    const hold = () => { V.pos = { ...vp }; for (const s of g.soldiers) { s.pos = { ...sp }; s.vel = { x: 0, y: 0 }; s.fireCooldown = 1e9; } g.anchor = { ...sp }; };
    hold(); out.blocked = !g.world.clear(vp, sp); out.dist = Math.round(T.near(vp, sp));
    const n0 = f.shots; T.step(10, hold); out.shots = f.shots - n0;
    // leash: the squad retreats into the courtyard; Voss never leaves his arena
    let out1 = 0; const A = f.arena;
    T.pinAt({ x: 2700, y: 1200 });
    T.step(30, () => { T.pinAt({ x: 2700, y: 1200 }); if (V.pos.x < A.x || V.pos.x > A.x + A.w || V.pos.y < A.y || V.pos.y > A.y + A.h) out1++; });
    out.left = out1; out.vx = Math.round(V.pos.x);
    g.invuln = false;
    return out;
  });
  check('C18 line of sight: no round at a soldier behind cover (10 s, 260 px away, inside his range)', los.blocked && los.dist < 400 && los.shots === 0, JSON.stringify(los));
  check('C19 leash: Voss never leaves his command area while the squad falls back (30 s)', los.left === 0 && los.vx >= 3260, JSON.stringify({ left: los.left, x: los.vx }));

  // reload mid-fight: the run is never resumed (interrupted run settles as a defeat); a new attempt starts clean
  await fresh();
  await ev(() => { window.__debugUnlockAll(); window.__persist(); });
  await ev(() => {
    const g = T.g; T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'], 'last-stand');
    const m = g.mission; m.openGate(g, 't'); m.openGate(g, 't'); for (let i = 0; i < 4; i++) m.primaries[i].state = 'complete'; m.current = 4; m.primaries[4].activate(m, g);
    g.damage(m.general.unit, 2000, g.soldiers[0]); T.step(0.1);
    return m.general.phase;
  });
  await page.reload(); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(150);
  const rel = await ev(() => {
    const g = T.g, out = { phase: g.phase, status: window.__loadStatus.status };
    T.deploy(['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'], 'last-stand', false);
    out.again = { general: g.mission.general === null, gates: g.mission.gatesOpened, cur: g.mission.currentObjective.id, enemies: g.enemies.length };
    return out;
  });
  check('C20 reload during the Voss fight: nothing resumes; a new attempt starts at the outer defenses, gates shut, no Voss', rel.phase !== 'playing' && rel.again.general && rel.again.gates === 0 && rel.again.cur === 'outer' && rel.again.enemies === 36, JSON.stringify(rel));

  // ================= D. VICTORY / UNLOCK =================
  await fresh();
  const vic = await ev(() => {
    window.__debugUnlockAll();
    const a = T.a, g = T.g, out = {};
    a.classUnlocks.unlocked = a.classUnlocks.unlocked.filter((c) => c !== 'demolitions');
    const SIX = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'];
    // failure first: nothing unlocked
    T.deploy(SIX, 'last-stand');
    for (const s of g.soldiers) g.damage(s, 1e4);
    T.stepUntil(() => g.phase !== 'playing', 30);
    out.fail = { phase: g.phase, unl: a.classUnlocks.unlocked.includes('demolitions'), reward: !!(g.lastReward && (g.lastReward.unlockedClasses || []).length) };
    T.resolve('resurrect');
    // the real chain, fast: the outer groups / generator / relays / front guard through Game.damage, then Voss
    T.deploy(SIX, 'last-stand', false);
    const m = g.mission; g.invuln = true;
    const kill = (pred) => { for (const e of g.enemies.filter((x) => x.active && pred(x))) g.damage(e, 1e6, g.soldiers[0]); T.step(0.1); };
    out.opt0 = m.optionals[0].status(m);
    kill((e) => e.tag === 'outer-field' || e.tag === 'outer-wall');
    kill((e) => e.structure === 'generator');
    kill((e) => e.structure === 'relay');
    kill((e) => e.tag === 'arena-front');
    out.chain = m.currentObjective && m.currentObjective.id;
    const V = m.general.unit;
    g.damage(V, V.maxHp * 0.8, g.soldiers[0]); T.step(7);
    out.opt1 = m.optionals[0].status(m);
    kill((e) => e === V);
    T.step(0.1);
    out.cur = m.currentObjective && m.currentObjective.id;
    g.invuln = false;
    T.extract();
    out.win = { phase: g.phase, unl: (g.lastReward && g.lastReward.unlockedClasses || []).join(), has: a.classUnlocks.unlocked.includes('demolitions'), owned: T.R.owned().filter((s) => s.classId === 'demolitions').length, opt: m.optionals[0].state, stars: g.lastStars && g.lastStars.stars };
    T.deploy(SIX, 'last-stand'); g.mission.debugReadyExtraction(g); T.extract();
    out.replay = (g.lastReward && g.lastReward.unlockedClasses || []).join();
    out.unlockedNow = a.classUnlocks.unlocked.filter((c) => c === 'demolitions').length;
    window.__persist();
    return out;
  });
  check('D1 a failed attempt unlocks nothing', vic.fail.phase === 'failed' && !vic.fail.unl && !vic.fail.reward, JSON.stringify(vic.fail));
  check('D2 the whole chain plays through (outer, generator, relays, front guard -> Voss)', vic.chain === 'voss' && vic.cur === 'clear' || vic.cur === null, JSON.stringify({ chain: vic.chain, cur: vic.cur }));
  check('D3 first win: the Demolitions Expert class unlocks (no free soldier); a replay unlocks nothing, no duplicate', vic.win.phase === 'won' && vic.win.unl === 'demolitions' && vic.win.has && vic.win.owned === 0 && vic.replay === '' && vic.unlockedNow === 1, JSON.stringify({ win: vic.win, replay: vic.replay }));
  check('D4 optional: "Not arrived yet" before phase 3, "Keep them standing" after; all three standing at the end completes it', vic.opt0 === 'Not arrived yet' && vic.opt1 === 'Keep them standing' && vic.win.opt === 'complete' && vic.win.stars >= 2, JSON.stringify({ o0: vic.opt0, o1: vic.opt1, opt: vic.win.opt, stars: vic.win.stars }));

  // ================= E. DEMOLITIONS EXPERT =================
  const dc = await ev(() => {
    const C = T.C, cd = window.__classes ? window.__classes.CLASSES.demolitions : null;
    const s = T.demo();
    return { cls: s.classDef && { id: s.classDef.id, label: s.classDef.label, short: s.classDef.short, ability: s.ability.id, weapon: s.classDef.visual.weapon, branches: (s.classDef.eliteBranches || []).join() }, d: C.demolitions, r: C.rocket, i: C.inferno, hp: s.maxHp, cd: !!cd };
  });
  check('E1 Demolitions Expert: HP 115, rocket 42 direct, 0.55 shots/s, Inferno, two Elite branches', dc.cls && dc.cls.label === 'Demolitions Expert' && dc.cls.short === 'DEM' && dc.cls.ability === 'inferno' && dc.cls.weapon === 'rocket' && dc.hp === 115 && dc.d.damage === 42 && dc.d.fireRate === 0.55 && dc.cls.branches === 'demo-siege,demo-pyro', JSON.stringify(dc.cls));
  check('E2 rocket / Inferno numbers: splash 55 (Pyro 70), +30% armor, Siege +20%; Inferno 10 s, 155 px, 65°, 16 DPS, burn 4 DPS x 3 s, bypass 35% (Siege 60%), cooldown 50 s (Pyro 14 s, burn 6)', dc.r.splashRadius === 55 && dc.r.pyroRadius === 70 && dc.r.armorBonus === 0.3 && dc.r.siegeBonus === 0.2 && dc.i.duration === 10 && dc.i.range === 155 && dc.i.cone === 65 && dc.i.dps === 16 && dc.i.burnDps === 4 && dc.i.burnTime === 3 && dc.i.bypass === 0.35 && dc.i.siegeBypass === 0.6 && dc.i.cooldown === 50 && dc.i.pyroDuration === 14 && dc.i.pyroBurnDps === 6, JSON.stringify({ r: dc.r, i: dc.i }));

  const blast = await ev(() => {
    const g = T.g, out = {}, L = T.LANE;
    const s = T.demo();
    const t = T.dummy({ x: L.x, y: L.y }), half = T.dummy({ x: L.x + 4, y: L.y + 27.5 }), edge = T.dummy({ x: L.x, y: L.y - 55 }), out1 = T.dummy({ x: L.x, y: L.y + 75 });
    const hp = (e) => e.maxHp - e.hp;
    let hitPos = null;
    T.rocketAt(s, t.pos); T.step(0.2, () => { s.fireCooldown = 1e9; if (!hitPos && half.hp < half.maxHp) hitPos = { ...half.pos }; });
    // the blast falls off from the impact point (where the rocket met the target's body), measured where the
    // neighbour stood at that moment (the dummies drift apart afterwards)
    const at = g.scorches[g.scorches.length - 1]; out.halfD = at && hitPos ? +T.near(at, hitPos).toFixed(1) : null;
    out.direct = +hp(t).toFixed(2); out.half = +hp(half).toFixed(2); out.edge = +hp(edge).toFixed(2); out.out = +hp(out1).toFixed(2);
    // armored: from the front (it faces the shooter) the rocket still does 42 x 1.3
    for (const e of [t, half, edge, out1]) e.state = 'dead';
    g.enemies = g.enemies.filter((e) => e.active);
    const ar = T.dummy({ x: L.x, y: L.y }, 'armored'); ar.aim = Math.PI;
    T.rocketAt(s, ar.pos); T.step(0.2, () => { s.fireCooldown = 1e9; });
    out.armored = +hp(ar).toFixed(2);
    // friendly fire: a soldier and an ally beside the impact; cover: an enemy behind a wall from the blast
    ar.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active);
    g.invuln = false;
    const t2 = T.dummy({ x: L.x, y: L.y });
    const ally = g.spawnAlly({ x: L.x + 30, y: L.y + 30 }, 'MARA'); ally.pos = { x: L.x + 30, y: L.y + 30 };
    const buddy = g.soldiers[0];
    const sHp = buddy.hp, aHp = ally.hp;
    // put the Demolitions Expert himself right next to the impact too
    const sp = { x: L.x - 40, y: L.y }; buddy.pos = { ...sp };
    T.rocketAt(buddy, t2.pos); T.step(0.2, () => { buddy.pos = { ...sp }; buddy.vel = { x: 0, y: 0 }; buddy.fireCooldown = 1e9; ally.pos = { x: L.x + 30, y: L.y + 30 }; ally.fireCooldown = 1e9; });
    out.ff = { soldier: +(sHp - buddy.hp).toFixed(2), ally: +(aHp - ally.hp).toFixed(2), target: +hp(t2).toFixed(2) };
    return out;
  });
  check('E3 measured rocket: direct hit 42 (once), about 30 halfway (falloff from the impact point), about 15 at the edge (55 px), nothing beyond', blast.direct === 42 && blast.halfD > 20 && blast.halfD < 35 && Math.abs(blast.half - 42 * (1 - (blast.halfD / 55) * 0.64)) < 0.3 && blast.half > 25 && blast.half < 33 && Math.abs(blast.edge - 15.12) < 0.5 && blast.out === 0, JSON.stringify(blast));
  check('E4 +30% against an Armored Trooper even from the front: 54.6', Math.abs(blast.armored - 54.6) < 0.01, String(blast.armored));
  check('E5 no friendly fire: the Demolitions Expert and a resistance ally beside the blast take nothing', blast.ff.soldier === 0 && blast.ff.ally === 0 && blast.ff.target === 42, JSON.stringify(blast.ff));

  const cover = await ev(() => {
    const g = T.g;
    // Mission 15's outer field: the wall W(700, 900, 180, 18) between the blast and an enemy just north of it
    T.generic(['demolitions'], 'last-stand'); g.invuln = true;
    const s = g.soldiers[0]; s.pos = { x: 790, y: 1060 }; s.fireCooldown = 1e9; g.anchor = { ...s.pos }; g.cam = { ...s.pos };
    const t = T.dummy({ x: 790, y: 930 }), behind = T.dummy({ x: 800, y: 880 });
    const clear = g.world.clear(t.pos, behind.pos);
    T.rocketAt(s, t.pos); T.step(0.2, () => { s.fireCooldown = 1e9; });
    return { direct: t.maxHp - t.hp, behind: behind.maxHp - behind.hp, clear, d: Math.round(T.near(t.pos, behind.pos)) };
  });
  check('E6 cover: a wall between the impact and an enemy inside the radius shelters it', cover.direct === 42 && cover.behind === 0 && !cover.clear && cover.d < 55, JSON.stringify(cover));

  const spec = await ev(() => {
    const g = T.g, L = T.LANE, out = {};
    const run = (sp, kind, d = 0) => { const s = T.demo(sp); const t = T.dummy({ x: L.x, y: L.y }, kind); const n = d ? T.dummy({ x: L.x, y: L.y + d }) : null; T.rocketAt(s, t.pos); T.step(0.2, () => { s.fireCooldown = 1e9; }); return { t: +(t.maxHp - t.hp).toFixed(2), n: n ? +(n.maxHp - n.hp).toFixed(2) : null }; };
    out.siegeA = run('demo-siege', 'armored').t; out.siegeR = run('demo-siege', 'rifleman').t;
    out.pyro65 = run('demo-pyro', 'rifleman', 75).n; out.base65 = run(null, 'rifleman', 75).n;
    // vs Voss (a boss): Siege Breaker +20%, plain +0%
    const vossHit = (sp) => { const { g: gg, V } = T.voss(['demolitions'], { x: 3700, y: 1200 }); gg.invuln = true; const s = gg.soldiers[0]; if (sp) s.elite = { id: sp, overdrive: 0, charge: 0, ready: false, effect: 0 }; s.fireCooldown = 1e9; const h0 = V.hp; T.rocketAt(s, V.pos); T.step(0.1, () => { s.fireCooldown = 1e9; }); return +(h0 - V.hp).toFixed(2); };
    out.vossSiege = vossHit('demo-siege'); out.vossBase = vossHit(null);
    return out;
  });
  check('E7 Siege Breaker: +20% on top of +30% vs armored (63), +20% vs a boss (Voss 50.4), plain rifleman 42; plain rocket vs Voss 42', spec.siegeA === 63 && spec.siegeR === 42 && Math.abs(spec.vossSiege - 50.4) < 0.01 && spec.vossBase === 42, JSON.stringify(spec));
  check('E8 Pyrotechnic: 70 px splash (an enemy 75 px from the target, its body inside 70 px, is caught; the 55 px base splash misses it)', spec.pyro65 > 0 && spec.base65 === 0, JSON.stringify({ pyro: spec.pyro65, base: spec.base65 }));

  const inf = await ev(() => {
    const g = T.g, L = T.LANE, out = {};
    const s = T.demo();
    s.aim = 0; // facing east
    const inCone = T.dummy({ x: s.pos.x + 120, y: s.pos.y }), side = T.dummy({ x: s.pos.x, y: s.pos.y + 120 }), farE = T.dummy({ x: s.pos.x + 230, y: s.pos.y + 0 });
    const armor = T.dummy({ x: s.pos.x + 100, y: s.pos.y + 40 }, 'armored'); armor.aim = Math.PI; // its plate faces the flamer
    const ally = g.spawnAlly({ x: s.pos.x + 80, y: s.pos.y - 20 }, 'ELIAS');
    const hold = () => { s.pos = { x: L.x - 300, y: L.y }; s.vel = { x: 0, y: 0 }; ally.pos = { x: L.x - 220, y: L.y - 20 }; ally.fireCooldown = 1e9; };
    hold();
    const ch0 = s.ability.charges, cap = s.ability.capacity;
    out.used = g.useAbility(s); out.charges = [ch0, s.ability.charges, cap];
    out.blocked = g.useAbility(s); out.chargesAfterBlocked = s.ability.charges; // already active: refused, free
    const t0 = g.time; let endAt = null;
    T.step(11, () => { hold(); s.aim = 0; if (endAt === null && !s.ability.flaming) endAt = +(g.time - t0).toFixed(2); });
    out.len = endAt; out.cdAtEnd = +s.ability.cooldownLeft.toFixed(2);
    const d = (e) => +(e.maxHp - e.hp).toFixed(2);
    out.cone = d(inCone); out.side = d(side); out.far = d(farE); out.armor = d(armor); out.ally = +(ally.maxHp - ally.hp).toFixed(2); out.squad = +(s.maxHp - s.hp).toFixed(2);
    // the afterburn: 3 s at 4 DPS once out of the flames
    out.burn = inCone.burn ? { t: +inCone.burn.t.toFixed(2), dps: inCone.burn.dps } : null;
    const c0 = d(inCone); T.step(4, hold); out.after = +(d(inCone) - c0).toFixed(2); out.burnGone = !inCone.burn;
    // cooldown runs after the effect: ready again 50 s after it ended (not after activation)
    const r = T.stepUntil(() => s.ability.cooldownLeft <= 0, 60, hold);
    out.readyAfter = +(r + 4 + (11 - endAt)).toFixed(1);
    out.noCharge = s.ability.charges === 0 && !s.ability.ready(s);
    out.refused = g.useAbility(s); out.reason = g.notice && g.notice.text;
    return out;
  });
  check('E9 Inferno: an activation spends one charge (1 -> 0); a refused tap while it runs spends nothing', inf.used && inf.charges[0] === 1 && inf.charges[1] === 0 && !inf.blocked && inf.chargesAfterBlocked === 0, JSON.stringify(inf.charges));
  check('E10 Inferno runs 10 s; 16 DPS in the 65° / 155 px cone (~160 over 10 s), nothing outside the cone or beyond its reach', Math.abs(inf.len - 10) < 0.05 && Math.abs(inf.cone - 160) < 6 && inf.side === 0 && inf.far === 0, JSON.stringify({ len: inf.len, cone: inf.cone, side: inf.side, far: inf.far }));
  check('E11 armor bypass 35%: the Armored Trooper\'s plate (x0.35) lets 57.75% of the flames through (~92 over 10 s)', Math.abs(inf.armor - 160 * 0.5775) < 6, String(inf.armor));
  check('E12 afterburn: 4 DPS for 3 s once out of the flames (12 in all; measured 1 s after the flames end), then it stops', inf.burn && inf.burn.dps === 4 && Math.abs(inf.burn.t + (11 - inf.len) - 3) <= 0.3 && Math.abs(inf.after - inf.burn.t * 4) < 0.6 && inf.burnGone, JSON.stringify({ burn: inf.burn, after: inf.after }));
  check('E13 the flames never hurt the squad or an ally in the cone', inf.ally === 0 && inf.squad === 0, JSON.stringify({ ally: inf.ally, squad: inf.squad }));
  check('E14 cooldown 50 s starts when the flames end; with no charge left Inferno is refused', Math.abs(inf.cdAtEnd + (11 - inf.len) - 50) < 0.05 && inf.noCharge && !inf.refused && /NO USES LEFT/.test(inf.reason || ''), JSON.stringify({ cdAt11s: inf.cdAtEnd, ended: inf.len, reason: inf.reason }));

  const inf2 = await ev(() => {
    const g = T.g, L = T.LANE, out = {};
    const run = (sp) => {
      const s = T.demo(sp); s.aim = 0;
      const a = T.dummy({ x: s.pos.x + 100, y: s.pos.y }, 'armored'); a.aim = Math.PI;
      const hold = () => { s.pos = { x: L.x - 300, y: L.y }; s.vel = { x: 0, y: 0 }; s.aim = 0; };
      g.useAbility(s); const t0 = g.time; let end = null, flames = null;
      T.step(15, () => { hold(); if (end === null && !s.ability.flaming) { end = +(g.time - t0).toFixed(2); flames = +(a.maxHp - a.hp).toFixed(1); } });
      return { end, flames, dmg: +(a.maxHp - a.hp).toFixed(1), burn: s.ability.burnDps, bypass: s.ability.bypass };
    };
    out.siege = run('demo-siege'); out.pyro = run('demo-pyro');
    // Ability Capacity rank 2: two uses this deployment
    window.__debugUnlockAll();
    const r = T.recruitDemo(); const id = r.soldier.id; const a = T.a; a.credits += 1e5;
    out.cap1 = T.E.buyAbilityCapacity(T.R, a, id, null, null).ok; out.cap2 = T.E.buyAbilityCapacity(T.R, a, id, null, null).ok;
    T.deploy([id], 'supply-line'); const s = g.soldiers[0]; g.invuln = true;
    out.charges = [s.ability.charges, s.ability.capacity];
    let uses = 0; for (let k = 0; k < 4; k++) { if (g.useAbility(s)) uses++; T.step(61, () => { s.vel = { x: 0, y: 0 }; }); }
    out.uses = uses; out.left = s.ability.charges;
    return out;
  });
  check('E15 Siege Breaker Inferno: 60% armor bypass (x0.74 through the plate); Pyrotechnic: 14 s, 6 DPS burn', inf2.siege.bypass === 0.6 && Math.abs(inf2.siege.flames - 160 * 0.74) < 6 && Math.abs(inf2.siege.dmg - 172 * 0.74) < 6 && Math.abs(inf2.pyro.end - 14) < 0.05 && Math.abs(inf2.pyro.flames - 224 * 0.5775) < 6 && inf2.pyro.burn === 6, JSON.stringify(inf2));
  check('E16 Ability Capacity: rank 2 gives 3 Inferno uses this deployment, then none (only real activations spend)', inf2.cap1 && inf2.cap2 && inf2.charges.join() === '3,3' && inf2.uses === 3 && inf2.left === 0, JSON.stringify({ c: inf2.charges, uses: inf2.uses }));

  await fresh();
  const rec = await ev(() => {
    window.__debugUnlockAll();
    const out = {}, Rc = window.__recruitment, a = T.a;
    a.classUnlocks.unlocked = a.classUnlocks.unlocked.filter((c) => c !== 'demolitions');
    out.before = Rc.recruitableClasses(Rc.campaignFlags(a)).join();
    T.E.openOffice(T.R, a, null);
    let n = 0; for (let i = 0; i < 200; i++) { a.credits += 100; T.E.refreshOffers(T.R, a, null, null); n += a.recruitment.offers.filter((o) => o.classId === 'demolitions').length; }
    out.offersBefore = n;
    out.price = Rc.priceOf('demolitions'); out.refund = Rc.refundOf('demolitions');
    // the unlock as the first win grants it: the next lineup introduces the class (guaranteed, once)
    T.E.unlockClass(a, 'demolitions');
    out.pending = Rc.pendingIntroductions(a.recruitment, Rc.campaignFlags(a)).join();
    T.E.openOffice(T.R, a, null);
    out.intro = a.recruitment.offers.map((o) => o.classId).join();
    out.introduced = a.recruitment.introduced.includes('demolitions');
    // recruit it: 1500 CR, the starting level, a unique name
    const o = a.recruitment.offers.find((x) => x.classId === 'demolitions');
    a.credits = 1499; out.poor = T.E.recruit(T.R, a, o.id, null).ok;
    a.credits = 1500; const r = T.E.recruit(T.R, a, o.id, null);
    out.recruit = r.ok && { paid: 1500 - a.credits, cls: r.soldier.classId, lv: r.soldier.progression.level, name: r.soldier.name };
    out.names = T.R.owned().map((s) => s.name); out.unique = new Set(out.names).size === out.names.length;
    out.start = Rc.startingLevelFor(Rc.campaignProgress(a));
    const id = r.soldier.id;
    // effective stats, training and squad training
    a.credits += 1e5;
    const s0 = window.__effectiveStats(T.R.get(id));
    out.base = { hp: s0.hp, damage: s0.damage, fireRate: s0.fireRate };
    const raw = window.__effectiveStats({ classId: 'demolitions', traitId: null, mods: {}, progression: null, training: {} });
    out.raw = { hp: raw.hp, damage: raw.damage, fireRate: raw.fireRate };
    T.E.buyTraining(T.R, a, id, 'damage', null, null); T.E.buySquadTraining(a, 'fireRate', null, null);
    const s1 = window.__effectiveStats(T.R.get(id));
    out.trained = { damage: s1.damage, fireRate: s1.fireRate };
    // leveling and Elite: Recruit 25 -> Siege Breaker / Pyrotechnic
    const rs = T.R.get(id); rs.progression.xp = T.P.xpForLevel(25); rs.progression.level = 25;
    const p = T.E.promote(T.R, a, id, 'demo-siege', null);
    out.promote = p.ok && { spec: p.spec.id, name: p.spec.title, passive: p.spec.passive, cls: p.spec.classId };
    out.specs = ['demo-siege', 'demo-pyro'].map((k) => { const sp = window.__elite.ELITE_SPECS[k]; return sp && `${sp.title}/${sp.passive}/${sp.classId}`; });
    out.wrong = T.E.promote(T.R, a, 'ace', 'demo-pyro', null).ok;
    // deploy caps: 6 including the Demolitions Expert, a 7th is refused
    out.id = id;
    const SIX = ['ace', 'ranger', 'tank', 'doc', 'havoc', id];
    const d6 = T.g.deploy(SIX.map((x) => T.R.get(x)), 'roster'); T.g.selectMission('last-stand', true);
    T.g.phase = 'start';
    T.g.selectMission('last-stand', true);
    const d6b = T.g.deploy(SIX.map((x) => T.R.get(x)), 'roster');
    T.g.phase = 'start';
    T.g.selectMission('last-stand', true);
    const d7 = T.g.deploy([...SIX, 'patch'].map((x) => T.R.get(x)), 'roster');
    out.caps = { six: d6b.ok, seven: d7.ok };
    window.__persist();
    return out;
  });
  check('E17 never offered before the unlock (200 lineups); price 1500 CR, refund 350 (never free)', !/demolitions/.test(rec.before) && rec.offersBefore === 0 && rec.price === 1500 && rec.refund === 350 && !rec.poor, JSON.stringify({ before: rec.before, n: rec.offersBefore, price: rec.price, refund: rec.refund }));
  check('E18 the unlock owes one introduction: the next lineup has a Demolitions Expert, then it counts as introduced', rec.pending === 'demolitions' && /demolitions/.test(rec.intro) && rec.introduced, JSON.stringify({ pending: rec.pending, intro: rec.intro }));
  check('E19 recruited for 1500 at the starting level with a unique name', rec.recruit && rec.recruit.paid === 1500 && rec.recruit.cls === 'demolitions' && rec.recruit.lv === rec.start && rec.unique, JSON.stringify(rec.recruit));
  check('E20 base stats 115 HP / 42 / 0.55 (untrained, no trait, level 1); level growth, Individual and Squad Training apply on top', rec.raw.hp === 115 && rec.raw.damage === 42 && rec.raw.fireRate === 0.55 && rec.base.hp >= 115 && rec.base.damage >= 42 && rec.trained.damage > rec.base.damage && rec.trained.fireRate > rec.base.fireRate, JSON.stringify({ raw: rec.raw, recruit: rec.base, trained: rec.trained }));
  check('E21 Elite at Recruit 25: Siege Breaker (Breach) and Pyrotechnic (Wildfire), Demolitions only', rec.promote && rec.promote.spec === 'demo-siege' && rec.specs[0] === 'Siege Breaker/Breach/demolitions' && rec.specs[1] === 'Pyrotechnic/Wildfire/demolitions' && !rec.wrong, JSON.stringify({ p: rec.promote, specs: rec.specs }));
  check('E22 deploy cap: six soldiers with the Demolitions Expert deploy to Mission 15, seven are refused', rec.caps.six && !rec.caps.seven, JSON.stringify(rec.caps));

  // persistence + KIA / resurrection / Memorial
  await page.reload(); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(150);
  const per = await ev((id) => { const s = T.R.get(id); return s && { cls: s.classId, elite: s.progression.elitePath, st: window.__loadStatus.status, notes: window.__loadStatus.notes.length }; }, rec.id);
  check('E23 the recruited (promoted) Demolitions Expert survives a reload', per && per.cls === 'demolitions' && per.elite === 'demo-siege' && per.st === 'loaded' && per.notes === 0, JSON.stringify(per));
  const kia = await ev((id) => {
    const a = T.a, g = T.g;
    T.deploy(['ace', id], 'supply-line');
    const u = g.soldiers.find((s) => s.identity && s.identity.id === id);
    g.damage(u, 1e4);
    const far = () => { for (const s of g.soldiers) if (s !== u) { s.pos = { x: u.pos.x + 500, y: u.pos.y }; s.vel = { x: 0, y: 0 }; } };
    T.stepUntil(() => u.state === 'kia', 30, far);
    T.calm(); g.mission.debugReadyExtraction(g); T.extract();
    const q = a.pendingDecision ? a.pendingDecision.queue.map((x) => x.id) : [];
    const cost = window.__casualties.costFor(T.R.get(id));
    a.credits += cost; const res = T.E.resurrect(T.R, a, id, window.__persist);
    const back = T.R.get(id).status;
    T.deploy(['ace', id], 'supply-line');
    const u2 = g.soldiers.find((s) => s.identity && s.identity.id === id);
    g.damage(u2, 1e4); T.stepUntil(() => u2.state === 'kia', 30, () => { for (const s of g.soldiers) if (s !== u2) { s.pos = { x: u2.pos.x + 500, y: u2.pos.y }; } });
    T.calm(); g.mission.debugReadyExtraction(g); T.extract();
    const m0 = a.memorial.length; T.E.memorialize(T.R, a, id, window.__persist);
    return { q: q.includes(id), cost, res: res.ok, back, mem: a.memorial.length - m0, memCls: a.memorial[a.memorial.length - 1] && a.memorial[a.memorial.length - 1].soldier.classId };
  }, rec.id);
  check('E24 KIA -> resurrection decision (class price) -> back in service; Memorial on a later death', kia.q && kia.cost > 0 && kia.res && kia.back === 'active' && kia.mem === 1 && kia.memCls === 'demolitions', JSON.stringify(kia));
  // save guard: a Demolitions Expert in a save without the unlock (Mission 15 never cleared) loads as Infantry
  await fresh();
  const raw0 = await ev(() => { window.__debugUnlockAll(); const r = T.recruitDemo(); window.__persist(); return { raw: JSON.stringify(T.store()), id: r.soldier.id }; });
  const edit = (clear) => { const raw = JSON.parse(raw0.raw); raw.account.classUnlocks.unlocked = raw.account.classUnlocks.unlocked.filter((c) => c !== 'demolitions'); raw.account.missions = raw.account.missions || {}; if (clear) { const any = Object.values(raw.account.missions)[0] || { completions: 1 }; raw.account.missions['last-stand'] = { ...any, completions: 1 }; } else delete raw.account.missions['last-stand']; return JSON.stringify(raw); };
  await fresh(page, URL, edit(false));
  const gd1 = await ev((id) => ({ st: window.__loadStatus.status, cls: T.R.get(id) && T.R.get(id).classId }), raw0.id);
  await fresh(page, URL, edit(true));
  const gd2 = await ev((id) => ({ st: window.__loadStatus.status, cls: T.R.get(id) && T.R.get(id).classId }), raw0.id);
  check('E25 save guard: a Demolitions Expert without the unlock loads as Infantry; with Mission 15 cleared it is kept', gd1.cls === 'infantry' && gd2.cls === 'demolitions' && gd2.st === 'loaded', JSON.stringify({ gd1, gd2 }));

  // ================= F. SAVES =================
  const sv = await ev(() => window.__saveVersion ?? null);
  const src = fs.readFileSync(__dirname + '/../src/save.ts', 'utf8');
  const ver = +((src.match(/SAVE_VERSION = (\d+)/) || [])[1]);
  check('F1 save format unchanged: SAVE_VERSION 9 (new data is optional / derived)', ver === 9, `SAVE_VERSION ${ver}${sv !== null ? ` (page ${sv})` : ''}`);
  const fx = [];
  for (const dir of ['fixtures', 'fixtures-v08b']) for (const f of fs.readdirSync(__dirname + '/' + dir)) {
    await fresh(page, URL, fs.readFileSync(__dirname + '/' + dir + '/' + f, 'utf8'));
    const r = await ev(() => ({ st: window.__loadStatus.status, n: T.R.owned().length, m15: T.a.campaign.unlockedMissions.includes('last-stand'), m14done: !!(T.a.missions['supply-line'] && T.a.missions['supply-line'].completions) }));
    fx.push(`${f}:${r.st}:${r.n}:${r.m15 === r.m14done ? 'ok' : 'M15?'}`);
  }
  check('F2 every save fixture loads; Mission 15 is open exactly when Mission 14 was cleared', fx.every((x) => /:loaded:\d+:ok$/.test(x) || /:migrated:\d+:ok$/.test(x)), fx.join(' '));

  // ================= G. BASE (v0.8B.2) =================
  if (BASE) {
    const bp = await ctx.newPage(); bp.on('pageerror', (e) => errors.push('BASE: ' + String(e)));
    await fresh(bp, BASE);
    await fresh();
    const a = await ev(snapshot), b = await bp.evaluate(snapshot);
    const cfgDiff = Object.keys(b.cfg).filter((k) => a.cfg[k] !== b.cfg[k]);
    const misDiff = Object.keys(b.missions).filter((k) => a.missions[k] !== b.missions[k]);
    check('G1 every pre-v0.8C CFG group identical to v0.8B.2 (enemies, classes, bosses, training, Elite, support, M13 / M14 assets)', cfgDiff.length === 0 && Object.keys(b.cfg).length > 20, cfgDiff.length ? `changed: ${cfgDiff.join()}` : `${Object.keys(b.cfg).length} groups`);
    check('G2 Missions 1-14 identical to v0.8B.2 (maps, enemy groups, objectives, optionals, extraction)', misDiff.length === 0, misDiff.length ? `changed: ${misDiff.join()}` : '14 missions');
    await bp.close();
  } else console.log('NOTE  BASE not set: G (Missions 1-14 unchanged) skipped');

  // ================= H. PHONES =================
  const DEVICES = [{ name: 'iphoneSE', land: [667, 375], dpr: 2 }, { name: 'iphone14', land: [844, 390], dpr: 3 }, { name: 'pixel7', land: [915, 412], dpr: 2.625 }];
  for (const dev of DEVICES) {
    const c2 = await browser.newContext({ viewport: { width: dev.land[0], height: dev.land[1] }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    await c2.addInitScript(installHelpers);
    const p = await c2.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(URL); await p.evaluate(() => { localStorage.clear(); }); await p.goto(URL); await p.waitForTimeout(200);
    await p.evaluate(() => { window.__debugUnlockAll(); window.__persist(); });
    await p.reload(); await p.waitForTimeout(200);
    await p.tap('[data-a="cchap"][data-ch="3"]'); await p.waitForTimeout(60);
    await p.tap('[data-a="csel"][data-id="last-stand"]'); await p.waitForTimeout(60);
    await p.tap('.c-btns [data-a="deploy"]'); await p.waitForTimeout(120);
    const L = await p.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight, el = document.querySelector('.brief');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const btns = [...el.querySelectorAll('[data-a="brief-deploy"], [data-a="brief-back"]')].map((b) => { const q = b.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { h: Math.round(q.height), inside: q.top >= -0.5 && q.bottom <= vh + 0.5 && q.left >= -0.5 && q.right <= vw + 0.5, aligned: !!hit && (hit === b || b.contains(hit)) }; });
      const texts = [...el.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      const clipped = [...el.querySelectorAll('*')].filter((e) => e.offsetParent && e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY === 'hidden').length;
      return { inside: r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5, scroll: el.scrollHeight > el.clientHeight + 1, btns, minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))), clipped, text: el.textContent.slice(0, 80) };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/v08c-${dev.name}-briefing.png` });
    check(`H ${dev.name}: Mission 15 briefing fits (no scroll, nothing clipped), DEPLOY / BACK >= 44 CSS px`, L && L.inside && !L.scroll && L.clipped === 0 && L.btns.length === 2 && L.btns.every((b) => b.inside && b.aligned && b.h >= 43.5) && L.minFont >= 11, JSON.stringify(L));
    await p.evaluate(() => { const { g, V } = T.voss(); g.invuln = true; g.damage(V, V.maxHp * 0.3, g.soldiers[0]); T.step(2, () => T.pinAt({ x: 3750, y: 1200 })); });
    await p.waitForTimeout(300);
    const H = await p.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const boss = document.querySelector('.obj-boss'), obj = document.querySelector('#objective');
      const bb = rect(boss);
      const panels = [...document.querySelectorAll('.panel')].filter((e) => e.offsetParent);
      const abil = [...document.querySelectorAll('.panel .ability')].filter((e) => e.offsetParent);
      const overlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      const hitsCtl = abil.some((e) => overlap(bb, rect(e))) || panels.some((e) => overlap(bb, rect(e)));
      const i = window.game.soldiers.findIndex((s) => s.classDef && s.classDef.id === 'demolitions');
      const b = abil[i]; const r = b ? b.getBoundingClientRect() : null;
      const cx = r ? r.left + r.width / 2 : 0, cy = r ? r.top + r.height / 2 : 0;
      const area = !!b && [[-21.5, 0], [21.5, 0], [0, -21.5], [0, 21.5], [-21, -21], [21, 21]].every(([dx, dy]) => { const h = document.elementFromPoint(cx + dx, cy + dy); return !!h && h.closest('.ability') === b; });
      return {
        shown: getComputedStyle(boss).display !== 'none', inside: bb.l >= 0 && bb.r <= vw && bb.t >= 0 && bb.b <= vh, bottomHalf: bb.b > vh * 0.6, hitsCtl, name: boss.querySelector('.ob-name').textContent,
        panels: panels.length, abilityArea: area, abilityTxt: b ? b.textContent.replace(/\s+/g, ' ').trim() : '', i, vw, vh, bb: [Math.round(bb.l), Math.round(bb.t), Math.round(bb.r), Math.round(bb.b)],
      };
    });
    if (H.i >= 0) await p.tap(`.panel:nth-child(${H.i + 1}) .ability`);
    await p.waitForTimeout(80);
    const fl = await p.evaluate(() => { const u = window.game.soldiers.find((s) => s.classDef && s.classDef.id === 'demolitions'); return { flaming: u.ability.flaming, charges: u.ability.charges }; });
    if (OUT) await p.screenshot({ path: `${OUT}/v08c-${dev.name}-voss.png` });
    check(`H ${dev.name}: GENERAL VOSS bar on screen in the objective panel, clear of the soldier panels / ability buttons`, H.shown && H.inside && !H.bottomHalf && !H.hitsCtl && H.name === 'GENERAL VOSS', JSON.stringify({ bb: H.bb, vw: H.vw, vh: H.vh }));
    check(`H ${dev.name}: six soldier panels; Inferno button has a 44 x 44 CSS px touch area and a tap starts it`, H.panels === 6 && H.abilityArea && fl.flaming && fl.charges === 0, JSON.stringify({ panels: H.panels, area: H.abilityArea, txt: H.abilityTxt, fl }));
    check(`H ${dev.name}: no page errors`, errs.length === 0, errs.join(' | '));
    await c2.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  return finish();
});
