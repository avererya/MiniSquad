// v0.8B.1 SUITE: Mission 13 difficulty (waves, timing, siege share), Mission 14 extended escort (route, Ambushes 4-5)
// and Ability Capacity (per-soldier charges, training row, HUD, keys / touch, saves).
// The collision stress tests are tools/v081-collision.cjs; the balance runs tools/v081-sim.cjs.
//
// Usage: npx vite preview --port 4173 &  node tools/v081.cjs
//   BASE=http://localhost:4174/   an unchanged v0.8B build: Mission 13 caches / turrets and Mission 14 depots,
//                                 Ambushes 1-3, the first route section and the gun are compared against it
//   OUT=/dir                      screenshots (HUD with six portraits, Training tab; three phones)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const OUT = process.env.OUT || '';

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
    deploy(ids, mission, calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.calm();
      g.input.move = () => ({ x: 0, y: 0 });
      return r;
    },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    centre(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; },
    pinAt(p, spread = 30) { const g = window.game; let i = 0; for (const s of g.soldiers) if (s.active && !s.mount) { s.pos = { x: p.x + ((i % 3) - 1) * spread, y: p.y + (Math.floor(i / 3) - 0.5) * spread }; s.vel = { x: 0, y: 0 }; i++; } g.anchor = { ...p }; },
    kill(e) { window.game.damage(e, 1e12); },
    byClass(c) { return window.game.soldiers.find((s) => s.identity.classId === c); },
    /** Recruit one soldier of a class through the office (class unlocked first); returns the id. */
    recruit(cls) {
      const a = this.a;
      if (!a.classUnlocks.unlocked.includes(cls)) { a.classUnlocks.unlocked.push(cls); a.classUnlocks.notified.push(cls); }
      this.E.openOffice(this.R, a, null);
      let o = null; for (let i = 0; i < 400 && !o; i++) { o = a.recruitment.offers.find((x) => x.classId === cls); if (!o) { a.credits += 100; this.E.refreshOffers(this.R, a, null, null); } }
      a.credits += o.price ?? 5000; return this.E.recruit(this.R, a, o.id, null).soldier.id;
    },
    /** Six soldiers covering all five classes: Infantry, Heavy, Medic, Sniper, Commando, Infantry. */
    five() { if (!this._five) this._five = ['ace', 'tank', 'doc', this.recruit('sniper'), this.recruit('commando'), 'ranger']; return this._five; },
    /** The ability's charges and timers. */
    ab(s) { const a = s.ability; return { ch: a.charges, cap: a.capacity, cd: +a.cooldownLeft.toFixed(2), act: +a.activeLeft.toFixed(2) }; },
    /** Make a valid use possible for s (someone hurt for the Medic; an enemy in sight for the rest). */
    prime(s) {
      const g = window.game;
      if (s.ability.id === 'fieldTreatment') { for (const o of g.soldiers) if (o !== s && o.active) { o.hp = Math.max(1, o.maxHp * 0.5); break; } }
    },
    /** Use s's ability like the button does (ground abilities: aim at a point 120 px ahead and confirm). */
    use(s) {
      const g = window.game;
      if (s.ability.targetingMode === 'ground') { if (!g.useAbility(s)) return false; if (g.targeting !== s) return false; g.onTargetConfirm(g.worldToScreen({ x: s.pos.x + 120, y: s.pos.y })); return true; }
      return g.useAbility(s);
    },
    /** Reach the waves: everybody in the command zone for 5.5 s (caches skipped). */
    toWaves() {
      const g = window.game, m = g.mission, prep = m.currentObjective, zc = this.centre(prep.zone);
      this.stepUntil(() => m.currentObjective.id !== 'prepare', 12, () => this.pinAt(zc));
      return m.currentObjective;
    },
    /** M14: straight to the escort (depots and capture marked done), gunner by class or null. */
    escort(gunnerCls) {
      const g = window.game;
      this.deploy(this.SIX, 'supply-line');
      const m = g.mission;
      m.primaries[0].state = 'complete'; m.primaries[1].state = 'complete'; m.current = 2; m.escort.capture();
      m.primaries[2].activate(m, g); m.phase = 'escort';
      g.modal = 'gunner'; g.chooseGunner(gunnerCls ? this.byClass(gunnerCls).id : null);
      return { m, v: m.escort, esc: m.primaries[2] };
    },
  };
}

/** Page-side: the v0.8B data both builds share (compared against BASE). */
function snapshot() {
  const g = window.game, C = window.__CFG;
  window.__debugUnlockAll();
  const out = {};
  // Mission 13 caches, response groups and turrets
  g.selectMission('hold-the-line', true); g.deploy(T.SIX.map((id) => g.roster.get(id)), 'roster');
  let m = g.mission;
  out.m13 = {
    guards: ['cache-a', 'cache-b'].map((t) => g.enemies.filter((e) => e.tag === t).map((e) => `${e.kind}@${Math.round(e.pos.x)},${Math.round(e.pos.y)}`).sort().join(';')).join('|'),
    caches: JSON.stringify(m.primaries[0].caches.map((c) => ({ id: c.id, rect: c.rect, time: c.time, response: c.response }))),
    turret: JSON.stringify(C.turret), cc: m.protected.maxHp, zone: JSON.stringify(m.primaries[0].zone), zoneTime: C.defense.zoneTime,
    allies: g.allies.map((a) => `${a.name}:${a.maxHp}`).join(),
  };
  // Mission 14 depots, Ambushes 1-3, gun, truck, first route section
  g.selectMission('supply-line', true); g.deploy(T.SIX.map((id) => g.roster.get(id)), 'roster');
  m = g.mission;
  const amb = m.primaries[2].ambushes ?? m.primaries.find((o) => o.id === 'escort').ambushes;
  out.m14 = {
    depots: g.enemies.filter((e) => e.structure).map((e) => `${e.kind}:${e.tag}:${Math.round(e.pos.x)},${Math.round(e.pos.y)}:${e.maxHp}`).sort().join(';'),
    groups: g.enemies.filter((e) => !e.structure && !e.vehicle).map((e) => `${e.kind}:${e.tag}:${Math.round(e.pos.x)},${Math.round(e.pos.y)}`).sort().join(';'),
    amb13: JSON.stringify(amb.defs.slice(0, 3).map((d) => ({ at: d.at, delay: d.delay, groups: d.groups }))),
    gun: JSON.stringify(C.mountedGun), truck: JSON.stringify({ hp: C.escortTruck.hp, speed: C.escortTruck.moveSpeed, accel: C.escortTruck.accel, behind: C.escortTruck.behind, capture: C.escortTruck.captureTime }),
    route: m.escort.route.map((p) => `${p.x},${p.y}`),
    total: Math.round(m.escort.total),
  };
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(104)} ${String(detail).slice(0, 320)}`); };
  const fresh = async (p = page, url = URL, raw = null) => {
    await p.goto(url); await p.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await p.goto(url); await p.waitForFunction(() => !!window.game); await p.waitForTimeout(100);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= 0. unchanged v0.8B content (against an unchanged v0.8B build) =================
  await fresh();
  const NOW = await ev(snapshot);
  if (BASE) {
    const bctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await bctx.addInitScript(installHelpers);
    const bp = await bctx.newPage();
    await fresh(bp, BASE);
    const B = await bp.evaluate(snapshot);
    await bctx.close();
    check('0.1 M13 caches, guards, response groups, command zone, allies identical to v0.8B', NOW.m13.guards === B.m13.guards && NOW.m13.caches === B.m13.caches && NOW.m13.zone === B.m13.zone && NOW.m13.zoneTime === B.m13.zoneTime && NOW.m13.allies === B.m13.allies, NOW.m13.guards);
    check('0.2 M13 turret stats and command center HP identical to v0.8B', NOW.m13.turret === B.m13.turret && NOW.m13.cc === B.m13.cc && NOW.m13.cc === 1000, NOW.m13.turret);
    check('0.3 M14 depots and starting enemy groups identical to v0.8B', NOW.m14.depots === B.m14.depots && NOW.m14.groups === B.m14.groups, NOW.m14.depots.slice(0, 120));
    check('0.4 M14 Ambushes 1-3: trigger, delay, groups, positions, roles identical to v0.8B', NOW.m14.amb13 === B.m14.amb13, NOW.m14.amb13.slice(0, 160));
    check('0.5 M14 mounted gun, truck HP / speed / capture identical to v0.8B', NOW.m14.gun === B.m14.gun && NOW.m14.truck === B.m14.truck, NOW.m14.gun + ' ' + NOW.m14.truck);
    const prefix = B.m14.route.every((p, i) => i === B.m14.route.length - 1 || NOW.m14.route[i] === p);
    check('0.6 M14 route: the v0.8B road kept point for point (its last point now leads on), about twice as long', prefix && NOW.m14.total / B.m14.total >= 1.9 && NOW.m14.total / B.m14.total <= 2.3, `${B.m14.total} -> ${NOW.m14.total} px (x${(NOW.m14.total / B.m14.total).toFixed(2)})`);
  } else console.log('(BASE not set: v0.8B comparison checks skipped)');

  // ================= A. ABILITY CAPACITY: model, purchase =================
  const A = await ev(() => {
    const out = {}, P = T.P, E = T.E, a = T.a, R = T.R;
    window.__debugUnlockAll();
    out.def = { costs: P.ABILITY_CAPACITY.costs.join(), uses: P.ABILITY_CAPACITY.uses.join(), max: P.ABILITY_CAPACITY_MAX, label: P.ABILITY_CAPACITY.label };
    out.defaults = R.owned().map((s) => P.capacityRank(s)).join('');
    out.uses = [0, 1, 2, 3, -1, 9].map((r) => P.abilityUses(r)).join();
    // purchase rules
    a.credits = 1499;
    const poor = E.buyAbilityCapacity(R, a, 'doc', 0, null);
    out.poor = { ok: poor.ok, reason: poor.reason, credits: a.credits, rank: P.capacityRank(R.get('doc')) };
    a.credits = 1500;
    const r1 = E.buyAbilityCapacity(R, a, 'doc', 0, null);
    out.r1 = { ok: r1.ok, rank: r1.rank, cost: r1.cost, credits: a.credits };
    const stale = E.buyAbilityCapacity(R, a, 'doc', 0, null);
    out.stale = { ok: stale.ok, reason: stale.reason };
    a.credits = 2999;
    out.poor2 = E.buyAbilityCapacity(R, a, 'doc', 1, null).ok;
    a.credits = 3000;
    const r2 = E.buyAbilityCapacity(R, a, 'doc', 1, null);
    out.r2 = { ok: r2.ok, rank: r2.rank, cost: r2.cost, credits: a.credits };
    a.credits = 1e6;
    const r3 = E.buyAbilityCapacity(R, a, 'doc', 2, null);
    out.r3 = { ok: r3.ok, reason: r3.reason, credits: a.credits, rank: P.capacityRank(R.get('doc')) };
    out.others = R.owned().filter((s) => s.id !== 'doc').map((s) => P.capacityRank(s)).join('');
    out.trainingUntouched = JSON.stringify(R.get('doc').training);
    // an in-mission purchase is refused (training happens in the Barracks)
    T.deploy(T.SIX, 'hold-the-line');
    const inm = E.buyAbilityCapacity(R, a, 'ace', 0, null, { inMission: true });
    out.inMission = { ok: inm.ok, reason: inm.reason };
    window.game.toBarracks();
    return out;
  });
  check('A1 Ability Capacity: costs 1,500 / 3,000 CR, 1 / 2 / 3 uses, max rank 2 (clamped beyond)', A.def.costs === '1500,3000' && A.def.uses === '1,2,3' && A.def.max === 2 && A.uses === '1,2,3,3,1,3', JSON.stringify([A.def, A.uses]));
  check('A2 every existing soldier starts at rank 0 (one use)', /^0+$/.test(A.defaults), A.defaults);
  check('A3 not enough Credits: refused, nothing spent', !A.poor.ok && A.poor.credits === 1499 && A.poor.rank === 0 && !A.poor2, JSON.stringify(A.poor));
  check('A4 rank 1 for exactly 1,500 CR, rank 2 for 3,000 CR; a stale rank is refused (double tap)', A.r1.ok && A.r1.rank === 1 && A.r1.cost === 1500 && A.r1.credits === 0 && !A.stale.ok && A.r2.ok && A.r2.rank === 2 && A.r2.cost === 3000 && A.r2.credits === 0, JSON.stringify([A.r1, A.stale, A.r2]));
  check('A5 no rank above 2 (refused, nothing spent)', !A.r3.ok && A.r3.credits === 1e6 && A.r3.rank === 2, JSON.stringify(A.r3));
  check('A6 the upgrade belongs to the purchased soldier only; the other training is untouched', /^0+$/.test(A.others) && A.trainingUntouched === JSON.stringify({ accuracy: 0, damage: 0, hp: 0, fireRate: 0, moveSpeed: 0 }), `${A.others} ${A.trainingUntouched}`);
  check('A7 no purchase during a mission', !A.inMission.ok, JSON.stringify(A.inMission));

  // ================= B. ABILITY CAPACITY: charges in a mission =================
  const B = await ev(() => {
    const out = {}, g = T.g, R = T.R;
    window.__debugUnlockAll();
    const FIVE = T.five();
    for (const id of FIVE) delete R.get(id).abilityCapacity;
    R.get('doc').abilityCapacity = 2; R.get(FIVE[4]).abilityCapacity = 1;
    T.deploy(FIVE, 'hold-the-line');
    g.invuln = true;
    out.classes = g.soldiers.map((s) => `${s.identity.classId}:${s.ability.id}`).join();
    out.start = g.soldiers.map((s) => `${s.ability.charges}/${s.ability.capacity}`).join();
    // every class: one valid use spends exactly one charge, starts the cooldown; the running effect doesn't spend more
    const per = {};
    for (const s of g.soldiers) {
      T.prime(s);
      const before = T.ab(s);
      const ok = T.use(s);
      const after = T.ab(s);
      T.step(1.5);
      const mid = T.ab(s);
      per[s.identity.classId] = { ok, before: before.ch, after: after.ch, mid: mid.ch, cd: after.cd > 0 || after.act > 0 };
    }
    out.per = per;
    // cooldown still works: an attempt while recharging (or running) spends nothing
    const doc = T.byClass('medic');
    T.prime(doc);
    const c0 = doc.ability.charges, cdTry = g.useAbility(doc);
    out.cooling = { tried: cdTry, ch: doc.ability.charges, c0, notice: g.notice && g.notice.text };
    // wait out every cooldown: rank-0 soldiers now have nothing left; tapping spends nothing and says so
    T.step(60);
    const ace = g.soldiers[0];
    T.prime(ace);
    const spentTry = T.use(ace);
    out.spent = { tried: spentTry, ch: ace.ability.charges, ready: ace.ability.ready(ace), why: ace.ability.blockReason(g, ace), notice: g.notice && g.notice.text, targeting: g.targeting === ace };
    // the Medic (rank 2) has 2 left: invalid use (nobody hurt) spends nothing
    for (const s of g.soldiers) s.hp = s.maxHp;
    const inv = g.useAbility(doc);
    out.invalid = { tried: inv, ch: doc.ability.charges, why: doc.ability.blockReason(g, doc) };
    // waiting does not regenerate (5 more game minutes)
    T.step(300);
    out.wait = g.soldiers.map((s) => s.ability.charges).join();
    // medkits do not regenerate charges (a hurt squad walks onto a map medkit)
    const pk = g.pickups[0];
    for (const s of g.soldiers) s.hp = s.maxHp * 0.4;
    const n0 = g.pickups.length, hp0 = g.soldiers[0].hp, ch0 = g.soldiers.map((s) => s.ability.charges).join();
    T.step(1, () => T.pinAt(pk.pos, 6));
    out.medkit = { used: g.pickups.length < n0, healed: g.soldiers[0].hp > hp0, ch0, ch: g.soldiers.map((s) => s.ability.charges).join() };
    // downed: no activation, no charge spent
    const havoc = T.byClass('commando');
    g.invuln = false; g.damage(havoc, 1e5); g.invuln = true;
    const hc = havoc.ability.charges, ht = g.useAbility(havoc);
    out.downed = { state: havoc.state, tried: ht, ch: havoc.ability.charges, hc };
    // revives stay unlimited and free: the rank-0 Infantry (no charges left) revives three times in a row
    const reviver = g.soldiers[0];
    const revs = [];
    for (let k = 0; k < 3; k++) {
      if (havoc.state !== 'downed') { g.invuln = false; g.damage(havoc, 1e5); g.invuln = true; }
      const t = T.stepUntil(() => havoc.state === 'active', 30, () => { for (const s of g.soldiers) if (s !== havoc && s.active) { s.pos = s === reviver ? { x: havoc.pos.x + 22, y: havoc.pos.y } : { x: havoc.pos.x + 400, y: havoc.pos.y + 300 }; s.vel = { x: 0, y: 0 }; } });
      revs.push({ t: +t.toFixed(1), st: havoc.state });
    }
    out.revives = { revs, reviverCh: reviver.ability.charges, all: g.soldiers.map((s) => s.ability.charges).join() };
    return out;
  });
  const classes = ['infantry', 'heavy', 'medic', 'sniper', 'commando'];
  check('B1 six soldiers start full: rank 0 -> 1/1, rank 1 -> 2/2, rank 2 -> 3/3 (per soldier)', /1\/1/.test(B.start) && /3\/3/.test(B.start) && /2\/2/.test(B.start), `${B.classes} ${B.start}`);
  check('B2 every class ability (Grenade, Suppressive Fire, Field Treatment, Focus, Bullet Storm) spends exactly one charge', classes.every((c) => B.per[c] && B.per[c].ok && B.per[c].after === B.per[c].before - 1 && B.per[c].cd), JSON.stringify(B.per));
  check('B3 an effect with a duration spends one charge per activation, not per tick', classes.every((c) => B.per[c].mid === B.per[c].after), JSON.stringify(Object.fromEntries(classes.map((c) => [c, `${B.per[c].after}->${B.per[c].mid}`]))));
  check('B4 cooldowns still work: a use while recharging is refused and spends nothing', !B.cooling.tried && B.cooling.ch === B.cooling.c0, JSON.stringify(B.cooling));
  check('B5 zero charges: refused ("NO USES LEFT"), nothing spent, no grenade aiming starts', !B.spent.tried && B.spent.ch === 0 && !B.spent.ready && /NO USES LEFT \(0\/1\)/.test(B.spent.why) && /NO USES LEFT/.test(B.spent.notice || '') && !B.spent.targeting, JSON.stringify(B.spent));
  check('B6 an invalid use (Field Treatment with nobody hurt) spends nothing', !B.invalid.tried && B.invalid.ch === 2 && /NOBODY HURT/.test(B.invalid.why), JSON.stringify(B.invalid));
  check('B7 waiting five game minutes regenerates nothing', B.wait === B.medkit.ch0, `${B.wait}`);
  check('B8 a medkit heals but restores no charges', B.medkit.used && B.medkit.healed && B.medkit.ch === B.medkit.ch0, JSON.stringify(B.medkit));
  check('B9 downed: no activation, no charge spent', B.downed.state === 'downed' && !B.downed.tried && B.downed.ch === B.downed.hc, JSON.stringify(B.downed));
  check('B10 revives unlimited and free: a soldier with 0 charges revives three times; no charge moves', B.revives.revs.every((r) => r.st === 'active' && r.t < 15) && B.revives.reviverCh === 0 && B.revives.all === B.wait, JSON.stringify(B.revives));

  // mounted gunner, keys 1-6, touch, HUD, reset on deployment / replay, Tactical Support
  const B2 = await ev(async () => {
    const out = {}, g = T.g, R = T.R;
    for (const id of T.SIX) delete R.get(id).abilityCapacity;
    R.get('tank').abilityCapacity = 2;
    // mounted gunner
    const { v } = T.escort('heavy');
    const gun = v.gun.gunner;
    const gc = gun.ability.charges, gt = g.useAbility(gun);
    g.onKey(`Digit${g.soldiers.indexOf(gun) + 1}`, new KeyboardEvent('keydown'));
    out.mounted = { tried: gt, ch: gun.ability.charges, gc, notice: g.notice && g.notice.text };
    // keys 1-6: each key uses its soldier's ability once (ground ability: the key starts aiming)
    T.deploy(T.SIX, 'hold-the-line'); g.invuln = true;
    const keys = [];
    for (let i = 0; i < 6; i++) {
      const s = g.soldiers[i]; T.prime(s);
      const c0 = s.ability.charges;
      g.onKey(`Digit${i + 1}`, new KeyboardEvent('keydown'));
      if (g.targeting === s) g.onTargetConfirm(g.worldToScreen({ x: s.pos.x + 120, y: s.pos.y }));
      keys.push(`${c0}>${s.ability.charges}`);
    }
    out.keys = keys.join(' ');
    T.step(60);
    // pressing the keys again: the rank-0 soldiers are spent, the rank-2 Heavy still has two
    const again = [];
    for (let i = 0; i < 6; i++) { const s = g.soldiers[i]; T.prime(s); g.onKey(`Digit${i + 1}`, new KeyboardEvent('keydown')); if (g.targeting === s) g.onTargetConfirm(g.worldToScreen({ x: s.pos.x + 120, y: s.pos.y })); again.push(s.ability.charges); g.targeting = null; }
    out.again = again.join('');
    // HUD: counter text, spent state vs cooldown state
    window.__render();
    const pan = [...document.querySelectorAll('#panels .panel')];
    out.hud = pan.map((p) => ({ uses: p.querySelector('.uses').textContent, spent: p.querySelector('.ability').classList.contains('spent'), cls: p.className.replace('panel ', ''), state: p.querySelector('.state').textContent }));
    // touch: a pointerdown on the Heavy's button spends one (2 -> 1 after the key use above: 3 -> 2 -> 1)
    const hv = T.byClass('heavy'), hi = g.soldiers.indexOf(hv);
    T.step(40);
    const btn = document.querySelectorAll('#panels .panel .ability')[hi];
    const t0 = hv.ability.charges;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    window.__render();
    out.touch = { before: t0, after: hv.ability.charges, uses: btn.querySelector('.uses').textContent, cooling: btn.closest('.panel').className };
    // touching a spent soldier's button: nothing
    const sp = g.soldiers.find((s) => s.ability.charges === 0), si = g.soldiers.indexOf(sp);
    document.querySelectorAll('#panels .panel .ability')[si].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    out.touchSpent = { ch: sp.ability.charges, targeting: g.targeting === sp };
    // a new deployment and a replay (Retry) start with full charges again
    const d = T.deploy(T.SIX, 'hold-the-line');
    out.redeploy = g.soldiers.map((s) => `${s.ability.charges}/${s.ability.capacity}`).join();
    T.use(g.soldiers[0]); out.usedBeforeRetry = g.soldiers[0].ability.charges;
    g.reset(); T.calm();
    out.replay = g.soldiers.map((s) => `${s.ability.charges}/${s.ability.capacity}`).join();
    // a failed mission (squad wiped) then a retry: full charges, never extra
    g.invuln = false; for (const s of g.soldiers) T.use(s); for (const s of g.soldiers) g.damage(s, 1e6); T.step(0.2);
    out.failPhase = g.phase;
    const pd = T.a.pendingDecision; if (pd) { let q; while ((q = T.a.pendingDecision) && q.queue.length) { const s = T.R.get(q.queue[0].id); T.a.credits += window.__casualties.costFor(s); T.E.resurrect(T.R, T.a, s.id, window.__persist); } }
    T.deploy(T.SIX, 'hold-the-line');
    out.afterFail = g.soldiers.map((s) => `${s.ability.charges}/${s.ability.capacity}`).join();
    // Tactical Support unaffected: six Elites with every charge spent still call the airstrike
    const SPEC = { infantry: 'inf-trooper', heavy: 'hvy-weapons', medic: 'med-surgeon', sniper: 'snp-deadeye', commando: 'com-assault' };
    for (const id of T.SIX) { const s = T.R.get(id); s.progression.xp = T.P.xpForLevel(25); s.progression.level = 25; if (!s.elite) { T.a.credits += 5000; T.E.promote(T.R, T.a, id, SPEC[s.classId], null); } }
    T.deploy(T.SIX, 'hold-the-line'); g.invuln = true;
    for (const s of g.soldiers) { s.ability.charges = 0; }
    const air0 = g.support.air;
    const began = g.useAirstrike();
    g.onSupportAim(g.worldToScreen({ x: g.anchor.x + 200, y: g.anchor.y }));
    const conf = g.confirmAirstrike();
    out.support = { eligible: g.support.airEligible, air0, began, conf, state: g.support.air };
    out.elitesCap = T.R.get('tank').abilityCapacity;
    return out;
  });
  check('B11 the mounted truck gunner cannot activate (button or key) and spends nothing', !B2.mounted.tried && B2.mounted.ch === B2.mounted.gc && /MOUNTED/.test(B2.mounted.notice || ''), JSON.stringify(B2.mounted));
  check('B12 keys 1-6: each key uses its own soldier\'s ability once (one charge each)', B2.keys.split(' ').every((k) => { const [a, b] = k.split('>').map(Number); return b === a - 1; }), B2.keys);
  check('B13 keys 1-6 again: spent soldiers refuse, the rank-2 Heavy uses its second charge', B2.again.split('').filter((c) => c === '0').length === 5 && B2.again.includes('1'), B2.again);
  check('B14 HUD: each portrait shows uses/capacity; spent buttons marked "spent" with "NO USES" (not a cooldown)', B2.hud.length === 6 && B2.hud.every((h) => /^\d\/\d$/.test(h.uses)) && B2.hud.filter((h) => h.spent).length === 5 && B2.hud.filter((h) => h.spent).every((h) => /spent/.test(h.cls) && /NO USES/.test(h.state) && h.uses === '0/1'), JSON.stringify(B2.hud.map((h) => `${h.uses}:${h.spent}:${h.state}`)));
  check('B15 touch: a tap uses the ability, the counter updates at once (1/3 -> 0/3), the panel shows it running', B2.touch.before === 1 && B2.touch.after === 0 && B2.touch.uses === '0/3' && /cooling|active/.test(B2.touch.cooling), JSON.stringify(B2.touch));
  check('B16 touch on a spent soldier does nothing', B2.touchSpent.ch === 0 && !B2.touchSpent.targeting, JSON.stringify(B2.touchSpent));
  check('B17 charges reset to full on a new deployment, on Retry and after a failed mission (never extra)', B2.redeploy === '1/1,1/1,3/3,1/1,1/1,1/1' && B2.usedBeforeRetry === 0 && B2.replay === B2.redeploy && B2.failPhase === 'failed' && B2.afterFail === B2.redeploy, JSON.stringify([B2.redeploy, B2.replay, B2.failPhase, B2.afterFail]));
  check('B18 Tactical Support unaffected: six Elites with no charges left still call the airstrike', B2.support.eligible && B2.support.began && B2.support.conf && B2.support.state !== B2.support.air0, JSON.stringify(B2.support));
  check('B19 Elite promotion keeps the Ability Capacity rank', B2.elitesCap === 2, String(B2.elitesCap));

  // ================= C. ABILITY CAPACITY: Training UI, saves =================
  await fresh();
  const C = await ev(async () => {
    const out = {}, g = T.g, a = T.a;
    window.__debugUnlockAll();
    a.credits = 4600;
    const show = () => { g.toBarracks(); g.ui.menus.trainId = 'ranger'; g.ui.menus.tab = 'training'; g.ui.menus.showBarracks(); return document.querySelector('.t-row.t-cap'); };
    let row = show();
    out.row0 = row ? row.textContent.replace(/\s+/g, ' ').trim() : null;
    out.stats = document.querySelectorAll('.t-row:not(.t-cap)').length;
    const click = async () => { const b = document.querySelector('.t-row.t-cap .t-buy:not([disabled])'); if (!b) return false; b.click(); await new Promise((r) => setTimeout(r, 40)); const c = document.querySelector('[data-a="confirm-buy"], .m-modal [data-a="yes"]'); if (c) { c.click(); await new Promise((r) => setTimeout(r, 40)); } return true; };
    out.c1 = await click(); row = show(); out.row1 = row.textContent.replace(/\s+/g, ' ').trim(); out.cr1 = a.credits;
    await new Promise((r) => setTimeout(r, 400)); // the double-tap guard
    out.c2 = await click(); row = show(); out.row2 = row.textContent.replace(/\s+/g, ' ').trim(); out.cr2 = a.credits;
    out.maxBtn = !!document.querySelector('.t-row.t-cap .t-buy:not([disabled])');
    out.rank = T.P.capacityRank(T.R.get('ranger'));
    // a poor soldier: the button is disabled
    a.credits = 100; g.ui.menus.trainId = 'ace'; g.ui.menus.showBarracks();
    const pb = document.querySelector('.t-row.t-cap .t-buy');
    out.poor = { disabled: pb ? pb.disabled : null, text: pb ? pb.textContent : null };
    out.saved = JSON.parse(localStorage.getItem('minisquad.save'));
    return out;
  });
  const savedRanger = C.saved && (C.saved.roster || C.saved.soldiers || []).find ? (C.saved.roster || C.saved.soldiers).find((s) => s.id === 'ranger') : null;
  check('C1 Training tab: an Ability Capacity row under the five training rows (rank, uses now -> next, 1,500 CR)', C.stats === 5 && /Ability Capacity/.test(C.row0) && /1 use/.test(C.row0) && /1,500 CR/.test(C.row0), C.row0);
  check('C2 buying through the row: rank 1 (2 uses, 3,000 CR next), rank 2 (3 uses, MAX); Credits spent', C.c1 && C.cr1 === 3100 && /2 uses/.test(C.row1) && /3,000 CR/.test(C.row1) && C.c2 && C.cr2 === 100 && /MAX/.test(C.row2) && !C.maxBtn && C.rank === 2, JSON.stringify([C.row1, C.cr1, C.row2, C.cr2]));
  check('C3 not enough Credits: the buy button is disabled', C.poor.disabled === true, JSON.stringify(C.poor));
  check('C4 the purchase is written to the save (v9), on the soldier', !!C.saved && C.saved.version === 9 && !!savedRanger && savedRanger.abilityCapacity === 2, JSON.stringify({ v: C.saved && C.saved.version, r: savedRanger && savedRanger.abilityCapacity }));
  await page.reload(); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(100);
  const C2 = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes, ranger: T.P.capacityRank(T.R.get('ranger')), ace: T.P.capacityRank(T.R.get('ace')), deployed: (() => { window.__debugUnlockAll(); T.deploy(T.SIX, 'hold-the-line'); return T.g.soldiers.map((s) => `${s.ability.charges}/${s.ability.capacity}`).join(); })() }));
  check('C5 after a reload: rank 2 kept (deploys 3/3), the others still rank 0, no repair notes', C2.ranger === 2 && C2.ace === 0 && C2.notes.length === 0 && /3\/3/.test(C2.deployed), JSON.stringify(C2));
  // damaged / foreign values are cleaned on load
  const bad = await ev(() => { const s = JSON.parse(localStorage.getItem('minisquad.save')); const list = s.roster || s.soldiers; list.find((x) => x.id === 'ace').abilityCapacity = 7; list.find((x) => x.id === 'tank').abilityCapacity = -2; list.find((x) => x.id === 'doc').abilityCapacity = 'x'; return JSON.stringify(s); });
  await fresh(page, URL, bad);
  const C3 = await ev(() => ({ st: window.__loadStatus.status, notes: window.__loadStatus.notes.join(' | '), ace: T.P.capacityRank(T.R.get('ace')), tank: T.P.capacityRank(T.R.get('tank')), doc: T.P.capacityRank(T.R.get('doc')), ranger: T.P.capacityRank(T.R.get('ranger')) }));
  check('C6 damaged capacity values are clamped (7 -> 2, -2 / "x" -> 0) with a repair note; valid ones kept', C3.ace === 2 && C3.tank === 0 && C3.doc === 0 && C3.ranger === 2 && C3.notes.length > 0, JSON.stringify(C3));
  // fixtures: every older save loads clean, everybody rank 0
  const fx = fs.readdirSync(path.join(__dirname, 'fixtures')).filter((f) => f.endsWith('.json'));
  const fxr = [];
  for (const f of fx) {
    await fresh(page, URL, fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
    fxr.push(await ev((f) => ({ f, st: window.__loadStatus.status, notes: window.__loadStatus.notes.length, ranks: T.R.owned().map((s) => T.P.capacityRank(s)).join(''), n: T.R.owned().length }), f));
  }
  check(`C7 ${fx.length} save fixtures (v0.2.2 ... v0.8B) load without repair notes; every soldier rank 0`, fxr.every((r) => (r.st === 'loaded' || r.st === 'migrated') && r.notes === 0 && /^0*$/.test(r.ranks)), fxr.map((r) => `${r.f}:${r.st}/${r.notes}`).join(' '));

  // ================= D. MISSION 13 =================
  await fresh();
  const D = await ev(() => {
    const out = {}, g = T.g, C = T.C;
    window.__debugUnlockAll();
    out.cfg = { warn: C.defense.warn, minGap: C.defense.minGap, nextWhenLeft: C.defense.nextWhenLeft, maxGap: C.defense.maxGap, share: C.defense.siegeShare };
    // ---- 1. nothing killed: the hard maximum (35 s, start to start); waves overlap; each wave once ----
    T.deploy(T.SIX, 'hold-the-line'); g.invuln = true;
    const m = g.mission, cc = m.protected; cc.setMaxHp(1e9); cc.hp = 1e9;
    const def = T.toWaves(), W = def.waves;
    const away = { x: cc.pos.x, y: cc.pos.y + 150 };
    const comp = [], siege = [], seen = new Set();
    let overlap = 0;
    const SIEGE = window.__targeting.SiegeTargeting;
    const record = () => W.units.forEach((us, i) => us.forEach((u) => { if (!seen.has(u)) { seen.add(u); u.setMaxHp(1e9); u.hp = 1e9; /* nobody dies in this run */ (comp[i] ||= []).push(u.kind[0]); (siege[i] ||= [0, 0]); if (u.kind !== 'sniper') { siege[i][1]++; if (u.targeting === SIEGE) siege[i][0]++; } else if (u.targeting === SIEGE) siege[i][0] += 100; } }));
    T.stepUntil(() => W.allSpawned, 200, () => {
      T.pinAt(away);
      overlap = Math.max(overlap, W.liveWaves);
      record();
    });
    record();
    out.maxGap = { starts: W.starts.map((t) => +t.toFixed(1)), overlap, spawned: W.spawnedCount, planned: W.plannedCount };
    out.comp = comp.map((w) => w.sort().join('')).join('|');
    out.sizes = comp.map((w) => w.length).join();
    out.siege = siege.map((s) => s.join('/')).join(' ');
    out.siegeStrategy = W.units.flat().filter((u) => u.targeting === SIEGE).every((u) => u.advancer === false);
    // no more spawns afterwards (two game minutes), the defense still waits for the last attacker
    const n1 = W.spawnedCount;
    T.step(120, () => T.pinAt(away));
    out.noMore = { spawned: W.spawnedCount - n1, starts: W.starts.length, state: def.state };
    // ---- 2. everything killed on arrival: the minimum (12 s) ----
    T.deploy(T.SIX, 'hold-the-line'); g.invuln = true;
    const m2 = g.mission; m2.protected.setMaxHp(1e9); m2.protected.hp = 1e9;
    const def2 = T.toWaves(), W2 = def2.waves;
    T.stepUntil(() => def2.state !== 'active', 300, () => { T.pinAt({ x: m2.protected.pos.x, y: m2.protected.pos.y + 150 }); for (const us of W2.units) for (const u of us) if (u.active) T.kill(u); });
    out.minGap = { starts: W2.starts.map((t) => +t.toFixed(1)), state: def2.state, phase: m2.phase };
    // ---- 3. the early start: 5 attackers of the current wave left -> no start; 4 left -> starts (after 12 s) ----
    T.deploy(T.SIX, 'hold-the-line'); g.invuln = true;
    const m3 = g.mission; m3.protected.setMaxHp(1e9); m3.protected.hp = 1e9;
    const def3 = T.toWaves(), W3 = def3.waves;
    // let wave 1 arrive in full (10), then keep 5 alive
    T.stepUntil(() => W3.units[0].length === W3.planned(0), 40, () => T.pinAt({ x: m3.protected.pos.x, y: m3.protected.pos.y + 150 }));
    let alive = W3.units[0].filter((u) => u.active);
    for (const u of alive.slice(5)) T.kill(u);
    for (const u of alive.slice(0, 5)) { u.setMaxHp(1e9); u.hp = 1e9; } // the squad and allies keep shooting: these five must stay
    const t5 = W3.since(0);
    T.step(Math.max(0, 14 - t5), () => T.pinAt({ x: m3.protected.pos.x, y: m3.protected.pos.y + 150 }));
    out.five = { left: W3.remaining(0), started2: W3.starts[1] >= 0, since: +W3.since(0).toFixed(1) };
    alive = W3.units[0].filter((u) => u.active); T.kill(alive[0]);
    T.step(1 / 30);
    out.four = { left: W3.remaining(0), started2: W3.starts[1] >= 0, at: +(W3.starts[1] - W3.starts[0]).toFixed(2) };
    // ---- 4. the whole mission budget: caches (12) + their responses (7) + 60 = 79 ----
    T.deploy(T.SIX, 'hold-the-line', false);
    const caches = T.g.mission.primaries[0].caches;
    out.budget = { guards: ['cache-a', 'cache-b'].map((t) => g.enemies.filter((e) => e.tag === t).length).reduce((a, b) => a + b, 0), response: caches.reduce((a, c) => a + (c.response ? (c.response.kinds || c.response.groups || []).length : 0), 0), responseRaw: JSON.stringify(caches.map((c) => c.response)).slice(0, 200) };
    return out;
  });
  check('D1 timing config: warning 7 s, next wave >= 12 s after the last start, early at <= 4 left, hard max 35 s, 80% siege', D.cfg.minGap === 12 && D.cfg.nextWhenLeft === 4 && D.cfg.maxGap === 35 && D.cfg.share === 0.8, JSON.stringify(D.cfg));
  check('D2 wave sizes 10 / 14 / 16 / 20 = 60 attackers (all spawned, planned 60)', D.sizes === '10,14,16,20' && D.maxGap.spawned === 60 && D.maxGap.planned === 60, `${D.sizes} spawned ${D.maxGap.spawned}`);
  check('D3 compositions: W1 8R+2A, W2 8R+6A, W3 7R+6A+3S, W4 8R+9A+3S', D.comp === 'aarrrrrrrr|aaaaaarrrrrrrr|aaaaaarrrrrrrsss|aaaaaaaaarrrrrrrrsss', D.comp);
  const gaps = (s) => s.slice(1).map((t, i) => +(t - s[i]).toFixed(1));
  check('D4 nobody killed: each next wave starts at the hard maximum, 35 s after the previous start', gaps(D.maxGap.starts).every((x) => Math.abs(x - 35) <= 0.1), JSON.stringify(D.maxGap.starts));
  check('D5 waves overlap: attackers of earlier waves still in the field when the next starts (up to 4 live waves)', D.maxGap.overlap >= 3, `max live waves ${D.maxGap.overlap}`);
  // (W1 / W2 have all arrived by 12 s: the next wave waits for the 12 s minimum; W3's last group lands at 19 s, so W4
  // starts once only that group (4) is left: about 15 s)
  check('D6 every attacker killed on arrival: the next wave still waits the minimum 12 s (start to start)', gaps(D.minGap.starts).slice(0, 2).every((x) => x >= 12 - 0.05 && x <= 12.1) && gaps(D.minGap.starts).every((x) => x >= 12 - 0.05 && x < 35) && D.minGap.state === 'complete' && D.minGap.phase === 'toExtraction', JSON.stringify(D.minGap));
  check('D7 early start: 5 of wave 1 left at 14 s -> no wave 2; the 4th-left kill starts it at once', !D.five.started2 && D.five.left === 5 && D.four.started2 && D.four.left === 4 && D.four.at >= 12, JSON.stringify([D.five, D.four]));
  check('D8 each wave once, no infinite spawning: 2 more minutes add nobody; defense waits for the last attacker', D.noMore.spawned === 0 && D.noMore.starts === 4 && D.noMore.state === 'active', JSON.stringify(D.noMore));
  const sg = D.siege.split(' ').map((x) => x.split('/').map(Number));
  check('D9 siege share ~80% of riflemen / armored per wave (8/10, 11/14, 10/13, 14/17); snipers never; siege targeting', sg.map((x) => x.join('/')).join(' ') === '8/10 11/14 10/13 14/17' && D.siegeStrategy, D.siege);
  check('D10 mission budget: 12 cache guards + 7 response + 60 assault = 79', D.budget.guards === 12 && D.budget.response === 7 && D.budget.guards + D.budget.response + 60 === 79, JSON.stringify(D.budget));

  // ================= E. MISSION 14 =================
  await fresh();
  const E = await ev(() => {
    const out = {}, g = T.g, C = T.C;
    window.__debugUnlockAll();
    const { m, v, esc } = T.escort('heavy');
    g.invuln = true;
    const A = esc.ambushes;
    out.defs = A.defs.map((d) => ({ at: d.at, n: d.groups.reduce((a, gr) => a + gr.kinds.length, 0), kinds: d.groups.flatMap((gr) => gr.kinds).map((k) => k[0]).sort().join(''), hunters: d.groups.filter((gr) => gr.hunter).reduce((a, gr) => a + gr.kinds.length, 0), hold: d.groups.filter((gr) => gr.hold).reduce((a, gr) => a + gr.kinds.length, 0), banner: d.banner }));
    out.route = { total: Math.round(v.total), map: [g.map.w, g.map.h] };
    const z = m.extraction.zone, end = v.at(v.total).p;
    out.endInZone = end.x > z.x && end.x < z.x + z.w && end.y > z.y && end.y < z.y + z.h;
    out.inMap = v.route.every((p) => p.x > 0 && p.y > 0 && p.x < g.map.w && p.y < g.map.h);
    // drive the truck along the whole road with the squad just ahead; each ambush fires once at its progress point
    const fired = [];
    const killOld = () => { for (const e of g.enemies) { if (!e._seen) e._seen = g.time; if (e.active && !e.structure && g.time - e._seen > 3) T.kill(e); } };
    const lead = () => { const ahead = v.s + 320, q = v.at(Math.min(v.total, ahead)); T.pinAt(ahead > v.total - 80 ? g.findOpenNear({ x: q.p.x - Math.sin(q.a) * 150, y: q.p.y + Math.cos(q.a) * 150 }, 40) : q.p); };
    let lastFired = 0, hp0 = v.unit.hp;
    const t0 = g.time;
    T.stepUntil(() => v.state === 'arrived', 400, () => {
      lead(); killOld();
      if (A.fired.length > lastFired) { fired.push({ i: A.fired.length - 1, s: Math.round(v.s), t: +(g.time - t0).toFixed(1) }); lastFired = A.fired.length; }
    });
    out.fired = fired;
    T.step(25, () => { lead(); killOld(); }); // the last staggered groups of Ambush 5 land after the truck arrives
    out.once = { fired: A.fired.length, spawned: A.spawnedCount, planned: A.plannedCount };
    out.arrive = { state: v.state, esc: esc.state, phase: m.phase, t: +(g.time - t0).toFixed(1), s: Math.round(v.s) };
    out.speed = C.escortTruck.moveSpeed;
    out.hp = { max: v.unit.maxHp, now: v.unit.hp, start: hp0 };
    // no repair / healing: damage, wait a minute, a Field Treatment nearby
    v.unit.hp = 400; g.invuln = false;
    T.step(30, () => lead());
    const doc = T.byClass('medic'); for (const s of g.soldiers) if (s.active && !s.mount) s.hp = s.maxHp * 0.5; doc.pos = { x: v.unit.pos.x + 60, y: v.unit.pos.y + 60 }; T.use(doc);
    T.step(20);
    out.noHeal = v.unit.hp;
    // extraction at the new end of the road: the optional (>= 50%) is judged there
    T.calm();
    const zc = T.centre(z);
    const put = () => g.soldiers.forEach((s, i) => { if (s.active && !s.mount) { s.pos = { x: zc.x - 60 + (i % 4) * 40, y: zc.y - 40 + Math.floor(i / 4) * 40 }; s.vel = { x: 0, y: 0 }; } });
    g.anchor = { ...zc };
    T.stepUntil(() => g.phase !== 'playing', 40, put);
    out.win = { phase: g.phase, opt: m.optionals[0].state, truck: v.unit.hp };
    // No Gunner: the escort starts and the truck rolls
    const r2 = T.escort(null); g.invuln = true;
    T.step(6, () => { const q = r2.v.at(Math.min(r2.v.total, r2.v.s + 320)); T.pinAt(q.p); });
    out.noGunner = { started: r2.m.escortStarted, gunner: r2.v.gun.gunner, moved: Math.round(r2.v.s), modal: g.modal };
    // gunner downed beside an obstacle: thrown clear to a valid, reachable spot; revived; no remount
    const r3 = T.escort('heavy'); g.invuln = true;
    r3.v.s = 4480; const q3 = r3.v.at(4480); r3.v.unit.pos = { ...q3.p }; r3.v.unit.aim = q3.a; r3.m.escortStarted = false;
    T.pinAt(r3.v.at(4700).p);
    T.step(0.5);
    const gs = r3.v.gun.gunner;
    g.invuln = false; g.damage(gs, 1e5); g.invuln = true;
    const u = r3.v.unit, c = Math.cos(u.aim), sn = Math.sin(u.aim), dx = gs.pos.x - u.pos.x, dy = gs.pos.y - u.pos.y;
    const lx = Math.abs(dx * c + dy * sn), ly = Math.abs(-dx * sn + dy * c);
    out.eject = { state: gs.state, mount: !!gs.mount, open: g.world.isOpen(gs.pos.x, gs.pos.y) && !g.world.insideObstacle(gs.pos, gs.radius - 1), outside: lx >= C.escortTruck.halfLen + gs.radius - 1 || ly >= C.escortTruck.halfWidth + gs.radius - 1, reach: !!g.world.findPath(g.anchor, gs.pos, 12) || g.world.passable(g.anchor, gs.pos, 10), lost: r3.v.gun.lost };
    out.eject.revive = +T.stepUntil(() => gs.state === 'active', 30, () => T.pinAt({ x: gs.pos.x + 26, y: gs.pos.y })).toFixed(1);
    out.eject.after = gs.state; out.eject.remount = g.chooseGunner(gs.id);
    // the truck destroyed: wreck aftermath, then failure (no reward)
    const r4 = T.escort('heavy'); g.invuln = false;
    g.damage(r4.v.unit, 1e6);
    out.wreck = { state: r4.v.state, after: r4.m.aftermath ? 'aftermath' : null };
    T.stepUntil(() => g.phase !== 'playing', 60, () => T.pinAt({ x: r4.v.unit.pos.x + 200, y: r4.v.unit.pos.y + 200 }));
    out.wreck.phase = g.phase; out.wreck.why = r4.m.failReason; out.wreck.won = !!(g.lastReward && g.lastReward.won);
    return out;
  });
  check('E1 five ambushes; Ambushes 1-3 still 6 / 9 / 12 at 480 / 1230 / 2030 px', E.defs.length === 5 && E.defs.slice(0, 3).map((d) => `${d.n}@${d.at}`).join() === '6@480,9@1230,12@2030', E.defs.map((d) => `${d.n}@${d.at}`).join());
  check('E2 Ambush 4: 12 (5 riflemen, 7 armored), an armored roadblock that holds, truck hunters', E.defs[3].n === 12 && E.defs[3].kinds === 'aaaaaaarrrrr' && E.defs[3].hold >= 4 && E.defs[3].hunters >= 2, JSON.stringify(E.defs[3]));
  check('E3 Ambush 5: 15 (7 riflemen, 6 armored, 2 snipers), a final roadblock, hunters from behind', E.defs[4].n === 15 && E.defs[4].kinds === 'aaaaaarrrrrrrss' && E.defs[4].hold >= 3 && E.defs[4].hunters >= 2, JSON.stringify(E.defs[4]));
  check('E4 54 escort ambushers in all (6 + 9 + 12 + 12 + 15)', E.defs.reduce((a, d) => a + d.n, 0) === 54 && E.once.planned === 54, String(E.once.planned));
  check('E5 driving the whole road: each ambush fires once, in order, at its progress point (never early)', E.fired.length === 5 && E.fired.every((f, i) => f.i === i && f.s >= E.defs[i].at && f.s < E.defs[i].at + 40) && E.once.fired === 5 && E.once.spawned === 54, JSON.stringify([E.fired, E.once]));
  check('E6 the road is ~5,865 px inside the 6300 x 2000 map; it ends inside the extraction zone; the truck arrives', E.route.total > 5700 && E.route.total < 6000 && E.route.map.join() === '6300,2000' && E.inMap && E.endInZone && E.arrive.state === 'arrived' && E.arrive.esc === 'complete', JSON.stringify([E.route, E.arrive]));
  check('E7 truck speed (72 px/s) and HP (600) unchanged; no repair or healing (time, Field Treatment)', E.speed === 72 && E.hp.max === 600 && E.noHeal <= 400, JSON.stringify([E.speed, E.hp, E.noHeal]));
  check('E8 extraction at the new road end wins; the optional is judged on the truck HP (>= 50% kept)', E.win.phase === 'won' && E.win.opt === 'complete', JSON.stringify(E.win));
  check('E9 No Gunner: the escort starts, the truck rolls, nobody on the gun', E.noGunner.started && !E.noGunner.gunner && E.noGunner.moved > 50 && !E.noGunner.modal, JSON.stringify(E.noGunner));
  check('E10 gunner downed next to the tightest obstacle: thrown clear (open ground, outside the truck, reachable), revived, no remount', E.eject.state === 'downed' && !E.eject.mount && E.eject.open && E.eject.outside && E.eject.reach && E.eject.lost && E.eject.after === 'active' && E.eject.revive < 20 && !E.eject.remount, JSON.stringify(E.eject));
  check('E11 truck destroyed: wreck aftermath, then mission failed, no reward', E.wreck.state === 'wrecked' && E.wreck.after === 'aftermath' && E.wreck.phase === 'failed' && /truck was destroyed/i.test(E.wreck.why) && !E.wreck.won, JSON.stringify(E.wreck));

  // ================= F. phones: HUD with six portraits, Training tab =================
  for (const dev of [{ name: 'iphoneSE', w: 667, h: 375, dpr: 2 }, { name: 'iphone14', w: 844, h: 390, dpr: 3 }, { name: 'pixel7', w: 915, h: 412, dpr: 2.625 }]) {
    const c2 = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: true, hasTouch: true });
    await c2.addInitScript(installHelpers);
    const p = await c2.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await fresh(p);
    const hud = await p.evaluate(() => {
      window.__debugUnlockAll(); T.R.get('tank').abilityCapacity = 2;
      T.deploy(T.SIX, 'hold-the-line'); const g = T.g; g.invuln = true;
      T.use(g.soldiers[0]); T.use(T.byClass('heavy')); T.step(30);
      window.__render();
      const pan = [...document.querySelectorAll('#panels .panel')];
      const rect = (el) => el.getBoundingClientRect();
      const res = pan.map((pn) => {
        const u = pn.querySelector('.uses'), btn = pn.querySelector('.ability'), hp = pn.querySelector('.hp'), ic = pn.querySelector('.icon');
        const ru = rect(u), rb = rect(btn), rh = rect(hp), ri = rect(ic);
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return { t: u.textContent, font: parseFloat(getComputedStyle(u).fontSize) * (window.visualViewport ? 1 : 1), inBtn: ru.left >= rb.left - 1 && ru.right <= rb.right + 1 && ru.top >= rb.top - 1, hpClear: !overlap(ru, rh), iconClear: !overlap(ru, ri), w: ru.width };
      });
      return { n: pan.length, res, over: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/${dev.name}-v081-hud.png` });
    check(`F1 ${dev.name}: six portraits each show uses (inside the button, clear of the HP bar and icon)`, hud.n === 6 && hud.res.every((r) => /^\d\/\d$/.test(r.t) && r.inBtn && r.hpClear && r.iconClear && r.w > 0) && !hud.over && errs.length === 0, JSON.stringify(hud.res.map((r) => `${r.t}:${r.font.toFixed(1)}`)));
    const tr = await p.evaluate(() => {
      const g = T.g; T.a.credits = 2000; g.toBarracks(); g.ui.menus.trainId = 'ace'; g.ui.menus.tab = 'training'; g.ui.menus.showBarracks();
      const row = document.querySelector('.t-row.t-cap'), b = row.getBoundingClientRect(), btn = row.querySelector('.t-buy');
      return { row: !!row, right: b.right, vw: window.innerWidth, over: document.documentElement.scrollWidth > window.innerWidth + 1, btn: btn ? btn.getBoundingClientRect().height : 0, font: Math.min(...[...row.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))) };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/${dev.name}-v081-training.png` });
    check(`F2 ${dev.name}: Training tab with the Ability Capacity row fits (no overflow, text >= 10 px)`, tr.row && tr.right <= tr.vw + 1 && !tr.over && tr.font >= 10 && errs.length === 0, JSON.stringify(tr));
    await c2.close();
  }

  if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '));
  check('Z no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n${total - fails}/${total} passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
