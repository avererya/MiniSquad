// v0.6.1 Mission Failure Consequences & Deliberate Recruitment: rule checks against the live game.
//  A. mission failure: downed soldiers become KIA on a legitimate failure (total defeat, failed
//     objective, any fail()), standing / revived soldiers come home, already-KIA stay KIA once,
//     mandatory casualty flow, no rewards, reload safety, interrupted sessions unchanged (v0.6),
//     Operation Phoenix through real combat (and when it must NOT open). Tagged [F1]..[F14].
//  B. named campaign recruits: milestones open permanent offers (Tank M1, Doc M2, Havoc M5, Patch
//     M7) instead of awarding soldiers; purchase, persistence, one-time claims by id, roster cap,
//     notices, class / trait unlocks independent of ownership, random office untouched, slots,
//     save migration (genuine v0.6 fixture + older fixtures), New Campaign. Tagged [R1]..[R25].
// Prints PASS/FAIL per check and exits 1 on any failure.
// Usage: npx vite preview --port 4173 & node tools/failure-recruit.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const FX = (f) => fs.readFileSync(__dirname + '/fixtures/' + f, 'utf8');

function installHelpers() {
  window.T = {
    get g() { return window.game; },
    get a() { return window.__account(); },
    get E() { return window.__economy; },
    get R() { return window.game.roster; },
    step(sec, pin) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (pin) pin(); window.game.update(1 / 60); } },
    stepUntil(cond, maxSec, pin) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (pin) pin(); window.game.update(1 / 60); n++; } return n / 60; },
    clearEnemies() { const g = window.game; g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = []; g.mission.defenders = [{ active: true }]; g.invuln = false; g.input.move = () => ({ x: 0, y: 0 }); },
    calm() { const g = window.game; for (const e of g.enemies) e.state = 'dead'; g.enemies = []; },
    unit(id) { return window.game.soldiers.find((s) => s.identity?.id === id); },
    deploy(ids, mission = 'field-medicine', calm = true) {
      const g = window.game; g.selectMission(mission, true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (r.ok && calm) this.clearEnemies();
      return r;
    },
    /** Win a campaign mission through the mission-end transaction (enemies removed). */
    clear(mission, ids = ['ace', 'ranger']) { const r = this.deploy(ids, mission); if (!r.ok) return r; window.game.win(); return { ok: true, rw: window.game.lastReward }; },
    /** Keep everyone except `id` far away so nobody revives it. */
    isolate(id) { const g = window.game, d = this.unit(id); const others = g.soldiers.filter((s) => s !== d); const spot = { x: d.pos.x + 900, y: d.pos.y }; return () => { others.forEach((o, i) => { o.pos = { x: spot.x, y: spot.y + i * 30 }; o.vel = { x: 0, y: 0 }; }); g.anchor = { ...spot }; this.calm(); }; },
    resolve(policy = 'resurrect') {
      const a = window.__account(); let d;
      while ((d = a.pendingDecision) && d.queue.length) {
        const s = this.R.get(d.queue[0].id);
        if (policy === 'resurrect') { a.credits += window.__casualties.costFor(s); this.E.resurrect(this.R, a, s.id, window.__persist); } else this.E.memorialize(this.R, a, s.id, window.__persist);
      }
    },
    offers() { return this.E.namedOffers(this.R, this.a).map((o) => o.def.key); },
    store() { return JSON.parse(localStorage.getItem(window.__SAVE_KEY)); },
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let fails = 0, total = 0;
  const check = (name, ok, detail = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(96)} ${String(detail).slice(0, 220)}`); };
  const fresh = async (raw = null) => {
    await page.goto(URL); await page.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await page.goto(URL); await page.waitForTimeout(150);
  };
  const reload = async () => { await page.reload(); await page.waitForTimeout(150); };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. MISSION FAILURE =================
  // bleed-out rules untouched
  await fresh();
  const rules = await ev(() => ({ b: window.__CFG.revive.bleedOut, hp: window.__CFG.revive.hpFrac, rt: ['infantry', 'heavy', 'medic'].map((c) => window.__CFG[c].reviveTime) }));
  check('bleed-out rules unchanged: 20 s, revive restores 30% HP, revive 10 / 12 / 5 s', rules.b === 20 && rules.hp === 0.3 && rules.rt.join() === '10,12,5', JSON.stringify(rules));

  // [F1][F2][F11] genuine total defeat in real combat on Mission 1 -> all KIA -> Memorial (unaffordable) -> Phoenix
  await fresh();
  const f1 = await ev(() => {
    const g = T.g, a = T.a;
    const before = { cr: a.credits, xp: T.R.get('ace').progression.xp, missions: JSON.stringify(a.missions), unlocked: [...a.campaign.unlockedMissions], named: JSON.stringify(a.named) };
    const r = T.deploy(['ace', 'ranger'], 'first-contact', false);
    // real combat: weakened squad, enemies spawned beside it, nobody moves (no test shortcut on the outcome)
    g.input.move = () => ({ x: 0, y: 0 });
    for (const s of g.soldiers) s.hp = 4;
    const c = g.soldiers[0].pos;
    for (let i = 0; i < 4; i++) g.spawnEnemy(g.findOpenNear({ x: c.x + 140, y: c.y + (i - 1.5) * 40 }, 60));
    const t = T.stepUntil(() => g.phase !== 'playing', 90);
    const q = a.pendingDecision?.queue ?? [];
    return {
      r, phase: g.phase, t, q: q.map((x) => `${x.id}:${x.cause}`).join(), st: ['ace', 'ranger'].map((id) => T.R.get(id).status).join(), deaths: ['ace', 'ranger'].map((id) => T.R.get(id).service.deaths).join(),
      rw: g.lastReward && { cr: g.lastReward.credits, xp: g.lastReward.xpEach, first: g.lastReward.firstClear, unl: g.lastReward.unlockedRecruits.concat(g.lastReward.unlockedMissions), surv: g.lastReward.survivors },
      cr: a.credits, xp: T.R.get('ace').progression.xp, missions: JSON.stringify(a.missions), unlocked: [...a.campaign.unlockedMissions], named: JSON.stringify(a.named), before,
      title: document.querySelector('.r-title')?.textContent, tally: document.querySelector('.r-tally')?.textContent, btns: [...document.querySelectorAll('.r-btns button')].map((b) => b.dataset.a).join(),
      status: [...document.querySelectorAll('.r-status')].map((x) => x.textContent).join(), runId: g.runId,
    };
  });
  check('[F1] real combat: the whole deployed squad goes down -> MISSION FAILED (defeat), Results 0 Survivors · 2 KIA', f1.r.ok && f1.phase === 'failed' && /MISSION FAILED/.test(f1.title) && /0 Survivors · 2 KIA/.test(f1.tally) && f1.status === 'KIA,KIA', `${f1.phase} after ${f1.t.toFixed(1)} s · ${f1.tally} · ${f1.status}`);
  check('[F2] every downed soldier became KIA at the failure (cause "failed"), one death each, both queued', f1.q === 'ace:failed,ranger:failed' && f1.st === 'kia,kia' && f1.deaths === '1,1', `${f1.q} · ${f1.st} · deaths ${f1.deaths}`);
  check('[F8] mandatory casualty resolution: Results offer only RESOLVE CASUALTIES', f1.btns === 'resolve', f1.btns);
  check('[F10] no victory-only rewards: 0 CR, 0 XP, no first clear / unlocks / mission record / named offers', f1.rw && f1.rw.cr === 0 && f1.rw.xp === 0 && !f1.rw.first && f1.rw.unl.length === 0 && f1.cr === f1.before.cr && f1.xp === f1.before.xp && f1.missions === f1.before.missions && f1.unlocked.join() === f1.before.unlocked.join() && f1.named === f1.before.named, JSON.stringify(f1.rw));
  // [F9] reload: no duplicate casualty, decision persisted, redirect to the decision screen
  await reload();
  const f9 = await ev(() => ({ q: T.a.pendingDecision?.queue.map((x) => x.id).join(), total: T.a.pendingDecision?.total, deaths: ['ace', 'ranger'].map((id) => T.R.get(id).service.deaths).join(), menu: document.getElementById('menu').className, dep: T.g.deploySelected().ok }));
  check('[F9] reload after the failure: same 2 casualties (no duplicates), deaths unchanged, decision screen, deploy blocked', f9.q === 'ace,ranger' && f9.total === 2 && f9.deaths === '1,1' && f9.menu === 'decisions' && !f9.dep, JSON.stringify(f9));
  // [F13] Phoenix never opens while a decision is pending; [F11] it opens after the genuine collapse is fully resolved
  const f11a = await ev(() => { const a = T.a; a.credits = 0; const r1 = T.E.memorialize(T.R, a, 'ace', window.__persist); return { r1: r1.ok, phoenix: !!a.phoenix.pending, pending: a.pendingDecision?.queue.map((x) => x.id).join() }; });
  check('[F13] after the first Memorial (Ranger still pending): no Operation Phoenix yet', f11a.r1 && !f11a.phoenix && f11a.pending === 'ranger', JSON.stringify(f11a));
  // the last decision through the real UI (delayed confirm)
  await reload();
  await page.click('[data-a="mem-open"]'); await page.waitForTimeout(1700);
  await page.click('[data-a="mem-confirm"]'); await page.waitForTimeout(700);
  const f11 = await ev(() => ({ px: T.a.phoenix.pending && T.a.phoenix.pending.candidates.length, living: T.R.living().length, mem: T.a.memorial.map((m) => m.soldier.id + ':' + m.cause).join(), menu: document.getElementById('menu').className, cards: document.querySelectorAll('[data-a="px-pick"]').length }));
  check('[F11] genuine total roster collapse (combat -> KIA -> unaffordable Memorial) -> Operation Phoenix opens', f11.px === 6 && f11.living === 0 && f11.mem === 'ace:failed,ranger:failed' && f11.menu === 'decisions' && f11.cards === 6, JSON.stringify(f11));
  for (let i = 0; i < 3; i++) { await page.click(`[data-a="px-pick"] >> nth=${i}`); await page.waitForTimeout(50); }
  await page.click('[data-a="px-enlist"]'); await page.waitForTimeout(700);
  const f11b = await ev(() => ({ owned: T.R.owned().map((s) => s.classId + ':' + s.progression.level + ':' + (s.origin || '')).join(), grants: T.a.phoenix.grants.length, missions: T.a.campaign.unlockedMissions.join() }));
  check('[F11] Phoenix: three free Level 1 Infantry enlisted, campaign progress kept', f11b.owned === 'infantry:1:phoenix,infantry:1:phoenix,infantry:1:phoenix' && f11b.grants === 1 && f11b.missions === 'first-contact', JSON.stringify(f11b));

  // [F3][F6] spec example: Tank KIA in combat, Doc downed with 12 s left, Ace standing, the mission fails (captive lost)
  await fresh();
  await ev(() => { window.__debugUnlockAll(); });
  const f3 = await ev(() => {
    const g = T.g;
    T.deploy(['ace', 'tank', 'doc'], 'bring-them-home');
    const tank = T.unit('tank'); g.downSoldier(tank);
    const pinT = T.isolate('tank');
    T.stepUntil(() => tank.state === 'kia', 25, pinT);
    const doc = T.unit('doc'); g.downSoldier(doc);
    const pinD = T.isolate('doc');
    T.step(8, pinD);
    const bleedAtFail = doc.bleed;
    const npc = g.mission.npc; g.invuln = false; g.downSoldier(npc); g.kia(npc); // the captive is lost -> mission fails
    const a = T.a, q = a.pendingDecision?.queue ?? [];
    return { phase: g.phase, reason: g.mission.failReason, bleedAtFail, q: q.map((x) => `${x.id}:${x.cause}`).join(), st: ['ace', 'tank', 'doc'].map((id) => T.R.get(id).status).join(), deaths: ['ace', 'tank', 'doc'].map((id) => T.R.get(id).service.deaths).join(), tally: document.querySelector('.r-tally')?.textContent, rows: [...document.querySelectorAll('.r-table tbody tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()), surv: g.lastReward.survivors, fallen: g.lastReward.fallen.map((f) => f.id).join() };
  });
  check('[F3] partial defeat (captive lost): Ace (standing) returns safely; 1 Survivor · 2 KIA on Results', f3.phase === 'failed' && /captive/i.test(f3.reason) && f3.st === 'active,kia,kia' && /1 Survivor · 2 KIA/.test(f3.tally) && f3.surv === 1, `${f3.st} · ${f3.tally}`);
  check('[F4] failed objective with a downed soldier (Doc, ~12 s of bleed-out left): Doc KIA, cause failed', Math.abs(f3.bleedAtFail - 12) < 0.1 && /doc:failed/.test(f3.q), `bleed left at failure ${f3.bleedAtFail.toFixed(2)} s · ${f3.q}`);
  check('[F6] Tank (already KIA, bled out) stays KIA: one death, one casualty entry, cause kept', f3.q === 'tank:bleedout,doc:failed' && f3.deaths === '0,1,1' && f3.fallen === 'tank,doc', `${f3.q} · deaths ${f3.deaths}`);

  // [F5] previously revived, standing soldier survives a failure; [F7] no free rescue by failing on purpose
  const f5 = await ev(() => {
    T.resolve('resurrect');
    const g = T.g;
    T.deploy(['ace', 'ranger', 'doc'], 'field-medicine');
    const rn = T.unit('ranger'), doc = T.unit('doc'); g.downSoldier(rn);
    doc.pos = { x: rn.pos.x + 15, y: rn.pos.y };
    T.stepUntil(() => rn.state === 'active', 10, () => { doc.pos = { x: rn.pos.x + 15, y: rn.pos.y }; T.calm(); });
    const revived = rn.state;
    // Ace goes down with plenty of bleed-out left; the player deliberately lets the objective fail
    const ace = T.unit('ace'); g.downSoldier(ace); T.step(2, T.isolate('ace'));
    g.mission.failReason = 'Objective failed.'; g.fail();
    return { revived, st: ['ace', 'ranger', 'doc'].map((id) => T.R.get(id).status).join(), q: T.a.pendingDecision?.queue.map((x) => `${x.id}:${x.cause}`).join(), rev: T.R.get('doc').service.revives };
  });
  check('[F5] Ranger revived earlier and standing at the failure returns safely', f5.revived === 'active' && f5.st.split(',')[1] === 'active' && f5.rev >= 1, JSON.stringify(f5));
  check('[F7] no free rescue: failing on purpose with Ace downed (18 s left) kills Ace', f5.st === 'kia,active,active' && f5.q === 'ace:failed', JSON.stringify(f5));
  // a dev deployment (generic) never touches the roster; a failure with nobody downed kills nobody
  const f7b = await ev(() => { T.resolve('resurrect'); T.deploy(['ace', 'ranger'], 'field-medicine'); T.g.mission.failReason = 'Objective failed.'; T.g.fail(); return { st: T.R.living().length, pend: !!T.a.pendingDecision, btns: [...document.querySelectorAll('.r-btns button')].map((b) => b.dataset.a).join(), tally: document.querySelector('.r-tally')?.textContent }; });
  check('failure with everyone standing: nobody dies, Results "2 Survivors · 0 KIA", Retry / Campaign / Barracks', !f7b.pend && f7b.btns === 'retry,campaign,barracks' && /2 Survivors · 0 KIA/.test(f7b.tally), JSON.stringify(f7b));

  // interrupted session (reload mid-mission) keeps v0.6 behaviour: downed soldiers come home, journaled KIA stay KIA
  const intr = await ev(() => {
    const g = T.g; T.deploy(['ace', 'ranger', 'doc'], 'field-medicine');
    const ace = T.unit('ace'); g.downSoldier(ace); T.stepUntil(() => ace.state === 'kia', 25, T.isolate('ace'));
    g.downSoldier(T.unit('ranger')); T.step(1, T.isolate('ranger'));
    return { journal: T.a.activeRun?.kia.map((k) => k.id).join() };
  });
  await reload();
  const intr2 = await ev(() => ({ st: ['ace', 'ranger', 'doc'].map((id) => T.R.get(id).status).join(), q: T.a.pendingDecision?.queue.map((x) => `${x.id}:${x.cause}`).join() }));
  check('interrupted session (reload mid-mission) unchanged: journaled KIA stays KIA, downed Ranger comes home', intr.journal === 'ace' && intr2.st === 'kia,active,active' && intr2.q === 'ace:bleedout', `${JSON.stringify(intr)} ${JSON.stringify(intr2)}`);

  // [F12] no Phoenix while healthy reserves exist; [F14] no Phoenix from voluntary dismissal
  await fresh();
  const f12 = await ev(() => {
    const a = T.a, g = T.g; a.credits = 750; T.E.openOffice(T.R, a, null); T.E.recruit(T.R, a, a.recruitment.offers[0].id, null);
    T.deploy(['ace', 'ranger'], 'first-contact');
    g.soldiers.forEach((s) => g.downSoldier(s));
    T.step(0.05);
    a.credits = 0; T.resolve('memorial');
    return { living: T.R.living().length, phoenix: !!a.phoenix.pending, q: !!a.pendingDecision };
  });
  check('[F12] deployed squad wiped while a healthy reserve waits in the Barracks: no Operation Phoenix', f12.living === 1 && !f12.phoenix && !f12.q, JSON.stringify(f12));
  const f14 = await ev(() => {
    const a = T.a; a.credits = 750; T.E.openOffice(T.R, a, null); T.E.recruit(T.R, a, a.recruitment.offers[0].id, null);
    const ids = T.R.owned().map((s) => s.id);
    const d1 = T.E.dismiss(T.R, a, ids[0], null), d2 = T.E.dismiss(T.R, a, ids[1], null);
    return { d1: d1.ok, d2: d2.ok ? 'ok' : d2.reason, living: T.R.living().length, phoenix: !!a.phoenix.pending };
  });
  check('[F14] voluntary dismissal can never empty the roster -> never Operation Phoenix', f14.d1 && /keep at least one/.test(f14.d2) && f14.living === 1 && !f14.phoenix, JSON.stringify(f14));

  // ================= B. NAMED CAMPAIGN RECRUITS =================
  await fresh();
  const r1 = await ev(() => ({ owned: T.R.owned().map((s) => s.id).join(), named: JSON.stringify(T.a.named), offers: T.offers(), cards: (T.g.toBarracks(), [...document.querySelectorAll('.s-card')].map((c) => c.dataset.id).join()) }));
  await page.click('[data-a="tab"][data-tab="recruit"]');
  const r1b = await ev(() => ({ sec: !!document.querySelector('.nr-sec'), cards: document.querySelectorAll('.rc-card').length }));
  check('[R1] fresh campaign owns only Ace + Ranger; all four named offers locked; office shows only the 3 random cards', r1.owned === 'ace,ranger' && r1.cards === 'ace,ranger' && r1.named === '{"unlocked":[],"claimed":[],"notified":[],"history":[]}' && r1.offers.length === 0 && !r1b.sec && r1b.cards === 3, `${r1.owned} ${r1.named}`);
  const r2 = await ev(() => { const x = T.clear('first-contact'); return { unl: x.rw.unlockedRecruits.join(), sold: x.rw.unlockedSoldiers.length, tank: T.R.isUnlocked('tank'), owned: T.R.activeCount(), offers: T.offers().join(), squad: T.R.slots.filter(Boolean).join() }; });
  check('[R2] Mission 1 unlocks the Tank offer but does not award Tank (roster 2, squad untouched)', r2.unl === 'tank' && r2.sold === 0 && !r2.tank && r2.owned === 2 && r2.offers === 'tank' && r2.squad === 'ace,ranger', JSON.stringify(r2));
  // notice: once, celebratory, dismissible; the offer stays
  await page.click('[data-a="campaign"]'); await page.waitForTimeout(100);
  const n1 = await ev(() => document.querySelector('.rn-notice')?.textContent.replace(/\s+/g, ' ').trim());
  check('notice after Mission 1: "NEW RECRUIT AVAILABLE! Tank — Heavy Gunner · Heavy Gunners can now be recruited · Visit Recruitment Office"', /NEW RECRUIT AVAILABLE!/.test(n1) && /Tank — Heavy Gunner/.test(n1) && /Heavy Gunners can now be recruited\./.test(n1) && /VISIT RECRUITMENT OFFICE/.test(n1), n1);
  await page.click('[data-a="rn-later"]'); await page.waitForTimeout(500);
  await reload();
  const n2 = await ev(() => ({ notice: !!document.querySelector('.rn-notice'), offers: T.offers().join(), notified: T.a.named.notified.join() }));
  const n3 = await ev(() => { T.clear('first-contact'); T.g.toCampaign(); return { notice: !!document.querySelector('.rn-notice'), unl: T.g.lastReward.unlockedRecruits.length }; });
  check('notice shown once: dismissed -> not shown after reload or a replay; the Tank offer stays', !n2.notice && n2.offers === 'tank' && n2.notified === 'tank' && !n3.notice && n3.unl === 0, `${JSON.stringify(n2)} ${JSON.stringify(n3)}`);
  const r16 = await ev(() => { const f = window.__recruitment.campaignFlags(T.a); return { cls: window.__recruitment.recruitableClasses(f).join(), tough: window.__recruitment.traitPool('infantry', f).includes('tough'), fr: window.__recruitment.traitPool('infantry', f).includes('firstResponder') }; });
  check('[R16] generic Heavy Gunner recruitable after M1 without buying Tank (Tough trait unlocked too)', r16.cls === 'infantry,heavy' && r16.tough && !r16.fr, JSON.stringify(r16));
  // [R19][R20] class guarantee (named Tank offer does not satisfy it); refresh independent of named offers
  const r19 = await ev(() => { T.E.openOffice(T.R, T.a, null); return { cls: T.a.recruitment.offers.map((o) => o.classId).join(), intro: T.a.recruitment.introduced.join(), named: T.a.recruitment.offers.some((o) => ['tank', 'doc', 'havoc', 'patch'].includes(o.id) || /^(tank|doc|havoc|patch)$/i.test(o.name)) }; });
  check('[R19] next random lineup contains the guaranteed Heavy Gunner although only the named Tank offer exists', r19.cls.split(',').includes('heavy') && r19.intro === 'infantry,heavy' && !r19.named, JSON.stringify(r19));
  const r6 = await ev(() => { const a = T.a; a.credits = 100000; const before = T.offers().join(); const ids = a.recruitment.offers.map((o) => o.id).join(); const r = T.E.refreshOffers(T.R, a, null, window.__persist); return { ok: r.ok, before, after: T.offers().join(), changed: a.recruitment.offers.map((o) => o.id).join() !== ids, cr: a.credits }; });
  check('[R6][R20] Refresh replaces only the 3 random candidates (-100); the Tank offer survives it', r6.ok && r6.before === 'tank' && r6.after === 'tank' && r6.changed && r6.cr === 99900, JSON.stringify(r6));
  await reload();
  check('[R7] the named offer persists through a reload', (await ev(() => T.offers().join())) === 'tank');
  const r3 = await ev(() => { const x = T.clear('heavy-support'); const f = window.__recruitment.campaignFlags(T.a); return { unl: x.rw.unlockedRecruits.join(), doc: T.R.isUnlocked('doc'), offers: T.offers().join(), cls: window.__recruitment.recruitableClasses(f).join(), fr: window.__recruitment.traitPool('heavy', f).includes('firstResponder') }; });
  check('[R3] Mission 2 unlocks the Doc offer but does not award Doc', r3.unl === 'doc' && !r3.doc && r3.offers === 'tank,doc', JSON.stringify(r3));
  check('[R17] generic Medic recruitable after M2 without buying Doc (First Responder unlocked too)', r3.cls === 'infantry,heavy,medic' && r3.fr, r3.cls);
  // [R8][R9][R10][R11] buy Tank through the UI (rapid double tap), then deploy him
  await ev(() => { T.a.credits = 3000; T.a.named.notified.push('doc'); window.__persist(); T.g.toBarracks(); });
  await page.click('[data-a="tab"][data-tab="recruit"]'); await page.waitForTimeout(100);
  const ui = await ev(() => { const row = document.querySelector('.nr-row[data-id="tank"]'); return row && row.textContent.replace(/\s+/g, ' ').trim(); });
  check('[R8] Campaign Recruits row: name, class, trait, stats, price, "Unlocked by completing Mission 1."', /TANK|Tank/.test(ui) && /Heavy Gunner/.test(ui) && /Tough/.test(ui) && /HP \d+/.test(ui) && /1,000 CR/.test(ui) && /Unlocked by completing Mission 1\./.test(ui), ui);
  await page.dblclick('[data-a="recruit-named"][data-id="tank"]'); await page.waitForTimeout(600);
  const r8 = await ev(() => ({ cr: T.a.credits, tank: T.R.isUnlocked('tank'), claimed: T.a.named.claimed.join(), hist: T.a.named.history.map((h) => `${h.key}:${h.cost}`).join(), offers: T.offers().join(), lvl: T.R.get('tank').progression.level, notice: document.querySelector('.m-notice').textContent }));
  check('[R8] buying Tank (double-tapped) deducts 1,000 CR exactly once, offer claimed, history recorded', r8.cr === 2000 && r8.tank && r8.claimed === 'tank' && r8.hist === 'tank:1000' && r8.offers === 'doc' && /Tank joined the roster/.test(r8.notice), JSON.stringify(r8));
  const r11 = await ev(() => { const r = T.E.recruitNamed(T.R, T.a, 'tank', null); return { r: r.ok ? 'ok' : r.reason, cr: T.a.credits }; });
  check('[R11] Tank cannot be bought twice (refused, no charge)', r11.r === 'Already recruited' && r11.cr === 2000, JSON.stringify(r11));
  await page.click('[data-a="tab"][data-tab="roster"]');
  const r9 = await ev(() => ({ card: !!document.querySelector('.s-card[data-id="tank"]'), lvl: T.R.get('tank').progression.level, trait: T.R.get('tank').traitId, count: T.R.activeCount() }));
  check('[R9] purchased Tank appears in the Barracks roster (LV 1 = current recruit level, natural Tough trait)', r9.card && r9.lvl === 1 && r9.trait === 'tough' && r9.count === 3, JSON.stringify(r9));
  const r10 = await ev(() => { T.R.trimTo(0); T.R.select('tank'); T.R.select('ace'); T.g.selectMission('field-medicine'); const d = T.g.deploySelected(); const ids = T.g.soldiers.map((s) => s.identity.id).join(); T.g.win(); return { ok: d.ok, ids, xp: T.R.get('tank').progression.xp }; });
  check('[R10] purchased Tank deploys and earns XP like any soldier', r10.ok && r10.ids === 'tank,ace' && r10.xp > 0, JSON.stringify(r10));
  // [R12] renaming never reopens the offer
  const r12 = await ev(() => { const r = T.E.rename(T.R, T.a, 'tank', 'Bulldozer', window.__persist); return r.ok; });
  await reload();
  const r12b = await ev(() => ({ name: T.R.get('tank').name, offers: T.offers().join(), claimed: T.a.named.claimed.join() }));
  check('[R12] renaming Tank to "Bulldozer" (reload) does not reopen the Tank offer', r12 && r12b.name === 'Bulldozer' && r12b.offers === 'doc' && r12b.claimed === 'tank', JSON.stringify(r12b));
  // [R13] dismissal never reopens it (also after replaying Mission 1)
  const r13 = await ev(() => { const d = T.E.dismiss(T.R, T.a, 'tank', window.__persist); T.R.trimTo(0); T.R.select('ace'); T.clear('first-contact', ['ace']); return { d: d.ok, offers: T.offers().join(), tank: !!T.R.get('tank') }; });
  await reload();
  check('[R13] dismissing Tank + replaying Mission 1 + reload: no Tank offer again; Heavy Gunners still recruitable', r13.d && r13.offers === 'doc' && !r13.tank && (await ev(() => T.offers().join())) === 'doc' && (await ev(() => window.__recruitment.recruitableClasses(window.__recruitment.campaignFlags(T.a)).includes('heavy'))), JSON.stringify(r13));
  // [R14] Memorial never reopens it
  const r14 = await ev(() => {
    const a = T.a; a.credits += 1000; const b = T.E.recruitNamed(T.R, a, 'doc', window.__persist);
    const g = T.g; T.deploy(['doc', 'ace'], 'field-medicine'); const d = T.unit('doc'); g.downSoldier(d); T.stepUntil(() => d.state === 'kia', 25, T.isolate('doc')); g.win();
    a.credits = 0; T.resolve('memorial');
    T.R.trimTo(0); T.R.select('ace'); T.clear('heavy-support', ['ace']);
    return { b: b.ok, mem: a.memorial.some((m) => m.soldier.id === 'doc'), offers: T.offers().join() };
  });
  await reload();
  check('[R14] Doc bought, killed, honored in the Memorial; replaying Mission 2 + reload: no Doc offer again', r14.b && r14.mem && r14.offers === '' && (await ev(() => T.offers().join())) === '', JSON.stringify(r14));
  // [R4][R21] Mission 5 unlocks Havoc (not awarded); the slot table never depends on the roster
  const r4 = await ev(() => {
    T.clear('field-medicine', ['ace']); T.clear('red-canyon', ['ace']);
    const x = T.clear('bring-them-home', ['ace']);
    const f = window.__recruitment.campaignFlags(T.a), C = window.__campaign;
    return { unl: x.rw.unlockedRecruits.join(), havoc: T.R.isUnlocked('havoc'), offers: T.offers().join(), th: window.__recruitment.traitPool('medic', f).includes('triggerHappy'), healer: window.__recruitment.traitPool('medic', f).includes('healer'), cap6: C.capacityFor(6), owned: T.R.activeCount(), slots: T.R.slots.filter(Boolean).length, note: x.rw && C.campaignMission('bring-them-home').unlocks.capacityNote };
  });
  check('[R4] Mission 5 unlocks the Havoc offer but does not award Havoc', r4.unl === 'havoc' && !r4.havoc && r4.offers === 'havoc', JSON.stringify(r4));
  check('[R18] traits unlock at milestones without ownership (Trigger Happy after M5; Healer not before M7)', r4.th && !r4.healer, JSON.stringify(r4));
  check('[R21] 4-soldier squads still unlock after Mission 5 with only 2 soldiers owned; nothing auto-filled', r4.cap6 === 4 && /Squad size 4/.test(r4.note) && r4.owned === 2 && r4.slots === 1, JSON.stringify(r4));
  // Campaign screen wording
  const camp = await ev(() => { T.g.ui.showCampaign(); const out = {}; for (const id of ['first-contact', 'heavy-support', 'bring-them-home', 'prison-break']) { document.querySelector(`[data-a="cchap"][data-ch="${id === 'prison-break' ? 2 : 1}"]`).click(); document.querySelector(`[data-a="csel"][data-id="${id}"]`).click(); out[id] = document.querySelector('.c-first').textContent.replace(/\s+/g, ' '); } return out; });
  await fresh();
  const campNew = await ev(() => { const out = {}; for (const id of ['first-contact', 'heavy-support', 'bring-them-home', 'prison-break']) { document.querySelector(`[data-a="cchap"][data-ch="${id === 'prison-break' ? 2 : 1}"]`).click(); document.querySelector(`[data-a="csel"][data-id="${id}"]`).click(); out[id] = document.querySelector('.c-first').textContent.replace(/\s+/g, ' '); } return out; });
  check('Campaign first-clear text: "Unlock Tank + Heavy Gunner recruitment", "Unlock Doc + Medic recruitment", "Unlock Havoc + Trigger Happy trait", "Unlock Patch + Healer trait"', /Unlock Tank \+ Heavy Gunner recruitment/.test(campNew['first-contact']) && /Unlock Doc \+ Medic recruitment/.test(campNew['heavy-support']) && /Unlock Havoc \+ Trigger Happy trait/.test(campNew['bring-them-home']) && /Unlock Patch \+ Healer trait/.test(campNew['prison-break']), JSON.stringify(campNew).slice(0, 220));
  check('Campaign text never says a soldier joins / is added / is free', ![...Object.values(camp), ...Object.values(campNew)].some((t) => /joins|added|free heavy|awarded/i.test(t)), '');
  // [R5] Mission 7 (v0.6.2: Prison Break): its first clear is Patch's milestone
  const r5 = await ev(() => {
    const C = window.__campaign;
    const def = C.namedRecruit('patch');
    const rw = T.E.settleMission(T.R, T.a, { missionId: 'prison-break', runId: 'test-m7', won: true, deployed: [{ id: 'ace', status: 'Standing', downs: 0 }], optional: { total: 0, completed: 0 } });
    const f = window.__recruitment.campaignFlags(T.a);
    return { milestone: def.milestone, unl: rw.unlockedRecruits.join(), patch: T.R.isUnlocked('patch'), offers: T.offers().join(), healerMedic: window.__recruitment.traitPool('medic', f).includes('healer'), healerInf: window.__recruitment.traitPool('infantry', f).includes('healer'), owned: T.R.activeCount() };
  });
  check('[R5] Mission 7 milestone unlocks the Patch offer (not Patch); Healer for Medic recruits only', r5.milestone === 'prison-break' && r5.unl === 'patch' && !r5.patch && r5.offers === 'patch' && r5.healerMedic && !r5.healerInf && r5.owned === 2, JSON.stringify(r5));
  // [R15] full roster blocks the purchase without charging
  await fresh();
  const r15 = await ev(() => {
    const a = T.a; T.clear('first-contact'); a.named.notified.push('tank'); a.credits = 100000;
    T.E.openOffice(T.R, a, null);
    while (T.R.activeCount() < 12) { const r = T.E.recruit(T.R, a, a.recruitment.offers[0].id, null); if (!r.ok) return { err: r.reason }; }
    const cr = a.credits; const r = T.E.recruitNamed(T.R, a, 'tank', window.__persist);
    T.g.toBarracks();
    return { r: r.ok ? 'ok' : r.reason, charged: cr - a.credits, offers: T.offers().join(), n: T.R.activeCount() };
  });
  await page.click('[data-a="tab"][data-tab="recruit"]'); await page.waitForTimeout(100);
  const r15b = await ev(() => { const b = document.querySelector('.nr-row[data-id="tank"] .rc-buy'); return { dis: b.disabled, txt: b.textContent }; });
  const r15c = await ev(() => { const a = T.a; const id = T.R.owned().find((s) => s.id.startsWith('rc-')).id; T.E.dismiss(T.R, a, id, null); const r = T.E.recruitNamed(T.R, a, 'tank', null); return { ok: r.ok, n: T.R.activeCount() }; });
  check('[R15] roster 12/12: Tank purchase refused (no charge), offer kept, button "ROSTER FULL"; after freeing a slot it works', /Roster full \(12\/12\)/.test(r15.r) && r15.charged === 0 && r15.offers === 'tank' && r15b.dis && /ROSTER FULL/.test(r15b.txt) && r15c.ok && r15c.n === 12, `${JSON.stringify(r15)} ${JSON.stringify(r15b)} ${JSON.stringify(r15c)}`);
  // pending casualties block the purchase too (no charge)
  const blk = await ev(() => { const g = T.g, a = T.a; T.clear('heavy-support'); a.named.notified.push('doc'); T.R.trimTo(0); T.R.select('ace'); T.deploy(['ace'], 'field-medicine'); g.downSoldier(T.unit('ace')); T.step(0.05); const cr = a.credits; const r = T.E.recruitNamed(T.R, a, 'doc', null); return { r: r.ok ? 'ok' : r.reason, charged: cr - a.credits }; });
  check('named purchase blocked while a casualty decision is pending (no charge)', /Resolve your fallen/.test(blk.r) && blk.charged === 0, JSON.stringify(blk));

  // ================= C. SAVE MIGRATION =================
  const fx6 = FX('v0.6-save.json');
  await fresh(fx6);
  const m6 = await ev(() => ({
    st: window.__loadStatus.status, from: window.__loadStatus.fromVersion, notes: window.__loadStatus.notes, bk: localStorage.getItem('minisquad.save.pre-v0.6.1'), v: T.store().version,
    owned: T.R.owned().map((s) => `${s.id}:${s.name}:${s.status}`).join(), q: T.a.pendingDecision?.queue.map((x) => x.id).join(), mem: T.a.memorial.map((m) => m.soldier.id).join(), cr: T.a.credits,
    named: T.a.named, offers: T.offers().join(), menu: document.getElementById('menu').className,
  }));
  const src6 = JSON.parse(fx6);
  check('[R22] genuine v0.6 save -> v7: migrated, no repair notes, raw save backed up under pre-v0.6.1', m6.st === 'migrated' && m6.from === 5 && m6.notes.length === 0 && m6.bk === fx6 && m6.v === 7, `${m6.st} ${m6.from} ${m6.notes.join(';')}`);
  check('[R22] previously awarded soldiers kept as they were (renamed Tank "Bulldozer" KIA awaiting a decision, recruits), Credits unchanged (no charge)', m6.owned === 'ace:Ace:active,ranger:Ranger:active,tank:Bulldozer:kia,rc-1:Lt Biscuit:active,rc-3:Ghost:active' && m6.cr === src6.account.credits && m6.q === 'tank' && m6.mem === 'doc' && m6.menu === 'decisions', `${m6.owned} · ${m6.cr} CR`);
  check('[R23][R24] claimed: Tank (pending KIA, renamed), Doc (Memorial), Havoc (dismissed); Patch locked; no duplicate offers', m6.named.claimed.join() === 'tank,doc,havoc' && m6.named.unlocked.join() === 'tank,doc,havoc' && m6.offers === '' && !m6.named.claimed.includes('patch') && m6.named.history.every((h) => h.legacy && h.cost === 0), JSON.stringify(m6.named).slice(0, 220));
  const m6b = await ev(() => { T.a.credits = 0; T.resolve('memorial'); return { offers: T.offers().join(), claimed: T.a.named.claimed.join() }; });
  await reload();
  check('[R24] the pending KIA Tank honored in the Memorial: still no Tank offer (also after reload)', m6b.offers === '' && (await ev(() => T.offers().join())) === '' && m6b.claimed === 'tank,doc,havoc', JSON.stringify(m6b));
  // older fixtures: everything previously awarded stays owned and claimed
  for (const [f, owned, claimed] of [['v0.5-save.json', 'ace,ranger,tank,doc,rc-1,rc-3', 'tank,doc'], ['v0.4-save.json', null, null], ['v0.3-save.json', 'ace,ranger,tank,havoc,doc,patch', 'tank,doc,havoc,patch'], ['v0.2.2-save.json', 'ace,ranger,tank,havoc,doc,patch', 'tank,doc,havoc,patch']]) {
    await fresh(FX(f));
    const m = await ev(() => ({ owned: T.R.owned().map((s) => s.id).join(), claimed: T.a.named.claimed.join(), offers: T.offers().join(), v: T.store().version, notice: !!document.querySelector('.rn-notice'), healer: window.__recruitment.traitPool('medic', window.__recruitment.campaignFlags(T.a)).includes('healer'), patch: T.R.isUnlocked('patch') }));
    const okOwned = owned ? m.owned === owned && m.claimed === claimed : m.offers === '' && m.claimed.split(',').every((k) => m.owned.split(',').includes(k));
    check(`[R23] ${f}: previously awarded named soldiers kept + claimed, no duplicate offers, no notice${m.patch ? ', Healer kept' : ''}`, okOwned && m.offers === '' && m.v === 7 && !m.notice && (!m.patch || m.healer), JSON.stringify(m));
  }
  // ambiguous / damaged v6 data: milestone done, never acquired -> the offer exists (no free soldier)
  await fresh();
  await ev(() => { T.clear('first-contact'); });
  const raw = await ev(() => { const s = T.store(); delete s.account.named; return JSON.stringify(s); });
  await fresh(raw);
  const amb = await ev(() => ({ st: window.__loadStatus.status, offers: T.offers().join(), tank: T.R.isUnlocked('tank'), notes: window.__loadStatus.notes.join(' ') }));
  check('v6 save missing its named data: rebuilt from mission records -> Tank offer open (milestone done, never bought)', amb.st === 'repaired' && amb.offers === 'tank' && !amb.tank, JSON.stringify(amb));
  const tamper = await ev(() => { const s = T.store(); s.unlockedSoldiers = ['ace', 'ranger', 'tank']; return JSON.stringify(s); });
  await fresh(tamper);
  const tp = await ev(() => ({ tank: T.R.isUnlocked('tank'), claimed: T.a.named.claimed.join(), offers: T.offers().join() }));
  check('a v6 save listing Tank as owned is treated as claimed (never sold again)', tp.tank && tp.claimed === 'tank' && tp.offers === '', JSON.stringify(tp));
  // [R25] New Campaign reset
  await fresh(fx6);
  await ev(() => { T.a.credits = 0; T.resolve('memorial'); T.g.ui.showCampaign(); });
  await page.click('[data-a="reset-open"]'); await page.click('[data-a="reset-confirm"]'); await page.waitForTimeout(150);
  const r25 = await ev(() => ({ owned: T.R.owned().map((s) => s.id).join(), named: JSON.stringify(T.store().account.named), offers: T.offers().join(), v: T.store().version, bk: !!localStorage.getItem('minisquad.save.pre-reset') }));
  check('[R25] New Campaign: Ace + Ranger only, all named offers locked / unclaimed, previous save backed up', r25.owned === 'ace,ranger' && r25.named === '{"unlocked":[],"claimed":[],"notified":[],"history":[]}' && r25.offers === '' && r25.v === 7 && r25.bk, JSON.stringify(r25));

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${total - fails}/${total} passed${fails ? `, ${fails} FAILED` : ''}`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
