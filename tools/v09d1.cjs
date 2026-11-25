// v0.9D.1 UI POLISH & SQUAD INTELLIGENCE (no new missions, classes or numbers that change balance):
//  A. Campaign screen: one-sentence summaries for all 20 missions, squad readiness (n / the mission's own cap), the
//     MISSION DETAILS expander (collapsed whenever a mission is selected; objectives, optionals + rewards, stars, tip,
//     first clear inside), locks unchanged, three phones in landscape (no sideways overflow, buttons on screen)
//  B. READY TO DEPLOY?: full squad, an empty slot with a spare soldier (warning + DEPLOY ANYWAY), an empty slot with
//     nobody to add (no warning), a lower-cap mission then a higher one, EDIT SQUAD and back, cancel three ways,
//     mission switching, double tap = one mission, revalidation, no auto-selection, Enter, phones
//  C. Objectives HUD: collapsed at every start, tap to open / close, a movement command collapses it (auto-fire
//     doesn't), the summary follows the objective, the boss bar separate and never covered, phones (touch area,
//     joystick half free, no overlap with the top buttons / timer / support)
//  D. Role-based formation: off until the first move, every class in its band (Heavies lead, Medics / Snipers at the
//     rear), no Heavy, several Heavies / Medics, sizes 1-6, turn hysteresis, slots reassigned only when the standing
//     set changes (downs / revives), the Medic's Field Treatment still reaches the front, seeded route walks on six maps
//     as fast as on v0.9D with no extra spread, stalls or mine blasts
//  E. The Warlord's phase 1 under-fire response: the v0.9D cause (squad 400-560 px away or off screen: no shot), he now
//     steps out and fires, stays on his leash in the arena, ignores a stray hit, doesn't react when he can already
//     fire or nobody can hit him, walks back after the calm, phases 2 / 3 unchanged; stats / mortar CFG = v0.9D
//  F. Mortar warning: no big banner, no yellow objective line, one pulsing boss-bar warning, timing unchanged
//  G. Version 0.9.6 / 0.9D.1, SAVE_VERSION 9; BASE v0.9D: every CFG group but the two new ones and every mission
//     (maps, enemies, objectives, campaign rows) identical
const fs = require('fs');
const path = require('path');
const { chromium, URL, BASE, OUT, createChecks, runSuite, openPage, missionSnapshot, V09D1 } = require('./lib.cjs');

const PHONES = [{ name: 'iphoneSE', w: 667, h: 375 }, { name: 'iphone14', w: 844, h: 390 }, { name: 'pixel7', w: 915, h: 412 }];
const SIX = ['medic', 'sniper', 'infantry', 'heavy', 'commando', 'demolitions'];

/** Page-side helpers on top of window.T. */
function helpers() {
  window.Y = {
    /** Mission 20 boss fight: installations down, gate open, the Warlord spawned, cinematics skipped, field calm. */
    toBoss(squad) {
      const g = window.game; T.start('warlord-hq', squad); Y.skip(); T.calm((e) => !!e.structure || e.kind === 'tower');
      g.input.move = () => ({ x: 0, y: 0 });
      T.kill((e) => e.structure === 'relay' || e.structure === 'vdepot'); Y.skip(); T.step(0.1); Y.skip();
      const W = g.mission.mechanic('warlord'); return { g, W, F: W.fight, B: W.fight.unit };
    },
    skip() { const g = window.game; if (g.modal === 'story') g.story.skip(g); },
    near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    /** Pin the squad at `p` (camera on it) for `sec` seconds; returns his shots, damage taken, max distance from his post. */
    hold(F, B, p, sec, post) {
      const g = window.game, s0 = F.shots, hp0 = B.hp; let far = 0, out = 0; const Ar = { x: 3960, y: 900, w: 1040, h: 920 };
      T.step(sec, () => { T.pinAt(p, 26); g.cam = { ...p }; Y.skip(); far = Math.max(far, Y.near(B.pos, post)); if (B.pos.x < Ar.x || B.pos.x > Ar.x + Ar.w || B.pos.y < Ar.y || B.pos.y > Ar.y + Ar.h) out++; });
      return { shots: F.shots - s0, dmg: Math.round(hp0 - B.hp), far: Math.round(far), out };
    },
    /** Seeded route walk along the map's first road (enemies cleared, hazards kept). */
    walk(id, squad, secs = 75) {
      const g = window.game; T.start(id, squad); Y.skip();
      T.calm((e) => !!e.structure && /fuel|mine/.test(e.structure) || e.kind === 'mine');
      const road = g.map.roads[0].filter((p) => p.x >= 0 && p.y >= 0 && p.x <= g.map.w && p.y <= g.map.h);
      let wi = 0, d0 = Infinity; road.forEach((p, i) => { const d = Y.near(p, g.anchor); if (d < d0) { d0 = d; wi = i; } });
      let t = 0, stall = 0, maxSpread = 0, last = null, i = 0;
      for (; i < secs * 60 && wi < road.length; i++) {
        const a = g.anchor, w = road[wi]; let dx = w.x - a.x, dy = w.y - a.y; const dd = Math.hypot(dx, dy);
        if (dd < 80) { wi++; continue; }
        g.input.move = () => ({ x: dx / dd, y: dy / dd });
        g.update(1 / 60); t += 1 / 60; Y.skip();
        if (g.phase !== 'playing') break;
        const act = g.soldiers.filter((s) => s.active && !s.mount);
        const c = { x: act.reduce((q, s) => q + s.pos.x, 0) / act.length, y: act.reduce((q, s) => q + s.pos.y, 0) / act.length };
        if (i % 30 === 0) { if (last && Y.near(c, last) < 10) stall += 0.5; last = c; }
        for (const s of act) maxSpread = Math.max(maxSpread, Y.near(s.pos, c));
      }
      const mines = g.mission.mechanic('mines');
      return { done: wi >= road.length, t: +t.toFixed(1), stall, maxSpread: Math.round(maxSpread), blasts: mines ? mines.log.detonations ?? 0 : 0, alive: g.soldiers.filter((s) => s.active).length };
    },
  };
}

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 110, detailMax: 420 });
  const browser = await chromium.launch();
  const errors = [];
  const page = await openPage(browser, URL, { seed: 9001 });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluate(helpers);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const notices = async (p = page) => { for (let i = 0; i < 6; i++) { const b = await p.$('[data-a="cn-later"], [data-a="rn-later"]'); if (!b) break; await b.click(); await p.waitForTimeout(450); } };
  /** Unlock everything, select exactly `ids` (roster soldiers), show the Campaign on `missionId`. */
  const campaign = async (missionId, ids, p = page) => {
    await p.evaluate(([missionId, ids]) => {
      const g = window.game; window.__debugUnlockAll();
      if (ids) { g.roster.trimTo(0); for (const x of ids) g.roster.select(x, undefined, 6); }
      window.__account().campaign.selectedMission = missionId; g.selectMission(missionId); window.__persist(); g.ui.showCampaign();
    }, [missionId, ids]);
    await notices(p);
    await p.evaluate((id) => { const g = window.game; window.__account().campaign.selectedMission = id; g.ui.showCampaign(); }, missionId);
    await p.waitForTimeout(60);
  };
  const owned = await ev(() => { window.__debugUnlockAll(); return window.game.roster.owned().map((s) => s.id); });

  // ================= A. CAMPAIGN SCREEN =================
  const sums = await ev(() => { const C = window.__campaign; return C.CAMPAIGN.filter((m) => m.playable).map((m) => ({ id: m.id, n: m.number, s: C.missionSummary(m) })); });
  const GIVEN = { 16: 'Sweep the jungle and eliminate enemy defenses.', 17: 'Destroy enemy fuel supplies.', 18: 'Fight through an enemy-held urban district.', 19: 'Rescue three captured specialists.', 20: 'Defeat the Warlord and escape his headquarters.' };
  check('A1 all 20 missions have a one-sentence summary (distinct, <= 75 characters, one full stop); Missions 16-20 use the requested lines', sums.length === 20 && new Set(sums.map((x) => x.s)).size === 20 && sums.every((x) => x.s.length <= 75 && /^[A-Z][^.]*\.$/.test(x.s)) && Object.entries(GIVEN).every(([n, t]) => sums.find((x) => x.n === +n).s === t), sums.filter((x) => !(x.s.length <= 75 && /^[A-Z][^.]*\.$/.test(x.s))).map((x) => x.id).join() || `${sums.length} summaries`);
  await campaign('first-contact', ['ace', 'ranger']);
  const rows = [];
  for (const m of sums) {
    await page.click(`[data-a="cchap"][data-ch="${Math.ceil(m.n / 5)}"]`);
    await page.click(`[data-a="csel"][data-id="${m.id}"]`);
    rows.push(await ev((id) => {
      const d = document.querySelector('.c-detail'), C = window.__campaign, def = C.campaignMission(id);
      const body = d.querySelector('.c-more-body');
      return { id, title: d.querySelector('.c-title').textContent.includes(def.name), sum: d.querySelector('.c-sum').textContent === C.missionSummary(def), ready: (d.querySelector('.c-ready') || {}).textContent || '', cap: C.capacityFor(def.number),
        hidden: body.hidden && getComputedStyle(body).display === 'none', on: !!document.querySelector(`.c-row.on[data-id="${id}"]`), deploy: !document.querySelector('.c-btns [data-a="deploy"]').disabled };
    }, m.id));
  }
  check('A2 every mission (all 20): title, its summary, "Squad: 2/<its own cap> ready", the row highlighted, MISSION DETAILS collapsed, DEPLOY enabled', rows.every((r) => r.title && r.sum && r.on && r.hidden && r.deploy && r.ready.replace(/\s+/g, ' ').trim() === `Squad: 2/${r.cap} ready`), rows.filter((r) => !(r.title && r.sum && r.on && r.hidden && r.deploy && r.ready.replace(/\s+/g, ' ').trim() === `Squad: 2/${r.cap} ready`)).map((r) => JSON.stringify(r)).join(' ').slice(0, 300) || '20 ok');
  // Mission 20's details: everything the old panel showed
  await page.click('[data-a="cchap"][data-ch="4"]'); await page.click('[data-a="csel"][data-id="warlord-hq"]');
  const before = await ev(() => getComputedStyle(document.querySelector('.c-more-body')).display);
  await page.click('[data-a="cdetails"]');
  const det = await ev(() => {
    const b = document.querySelector('.c-more-body'), def = window.__campaign.campaignMission('warlord-hq');
    const t = b.innerText.replace(/\s+/g, ' ');
    return { vis: getComputedStyle(b).display !== 'none', aria: document.querySelector('[data-a="cdetails"]').getAttribute('aria-expanded'),
      objs: (def.brief.objectives || def.primary).every((o) => t.includes(o)), opts: def.optional.every((o) => t.includes(o.label)), rewards: /\+\d+ XP · \+\d+ CR each/.test(t), stars: (t.match(/★/g) || []).length >= 6, first: /FIRST CLEAR/.test(t), tip: /TIP/.test(t) && t.includes(def.brief.tip), story: t.includes(def.brief.story.slice(0, 40)), cap: /Up to 6 soldiers/.test(t) };
  });
  check('A3 MISSION DETAILS opens on tap: primary objectives, optionals with their XP / CR rewards, star rules, squad limit, the tip, the briefing story and the first-clear line', before === 'none' && det.vis && det.aria === 'true' && det.objs && det.opts && det.rewards && det.stars && det.first && det.tip && det.story && det.cap, JSON.stringify(det));
  await page.click('[data-a="csel"][data-id="jungle-prison"]');
  const coll = await ev(() => document.querySelector('.c-more-body').hidden);
  await page.click('[data-a="cdetails"]'); await page.click('[data-a="cdetails"]');
  const coll2 = await ev(() => document.querySelector('.c-more-body').hidden);
  check('A4 selecting another mission collapses the details; a second tap closes them', coll && coll2, `${coll} ${coll2}`);
  // locks unchanged on a fresh campaign
  {
    const p = await openPage(browser, URL, { seed: 3 });
    await p.waitForTimeout(150); await notices(p);
    await p.click('[data-a="cchap"][data-ch="4"]'); await p.click('[data-a="csel"][data-id="warlord-hq"]');
    const L = await p.evaluate(() => ({ dis: document.querySelector('.c-btns [data-a="deploy"]').disabled, edit: document.querySelector('.c-btns [data-a="to-barracks"]').disabled, t: document.querySelector('.c-detail').innerText.replace(/\s+/g, ' '), rows: [...document.querySelectorAll('.c-row')].map((r) => /locked/.test(r.className)).filter(Boolean).length, sel: window.game.missionId }));
    await p.click('.c-btns [data-a="deploy"]', { force: true }).catch(() => {}); await p.waitForTimeout(60);
    const open = await p.evaluate(() => !!document.querySelector('.brief'));
    check('A5 fresh campaign: Mission 20 locked (how to unlock shown, no squad line), Chapter 4 rows locked, DEPLOY / EDIT SQUAD disabled, no deploy check opens', L.dis && L.edit && /Clear Mission 19/.test(L.t) && !/Squad:/.test(L.t) && L.rows === 5 && !open && L.sel === 'first-contact', JSON.stringify({ ...L, t: L.t.slice(0, 90), open }));
    await p.context().close();
  }
  // phones
  for (const dev of PHONES) {
    const p = await openPage(browser, URL, { seed: 5, viewport: { width: dev.w, height: dev.h }, context: { isMobile: true, hasTouch: true } });
    await campaign('warlord-hq', ['ace', 'ranger', 'tank', 'doc', 'havoc'], p);
    const lay = () => p.evaluate(() => {
      const vw = innerWidth, vh = innerHeight, menu = document.getElementById('menu');
      const box = (el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { inside: r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5 && r.bottom <= vh + 0.5, aligned: !!hit && (hit === el || el.contains(hit)), h: Math.round(r.height) }; };
      const texts = [...document.querySelectorAll('.c-detail *')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      return { hOver: menu.scrollWidth > menu.clientWidth + 1, vScroll: menu.scrollHeight > menu.clientHeight + 1, deploy: box(document.querySelector('.c-btns [data-a="deploy"]')), edit: box(document.querySelector('.c-btns [data-a="to-barracks"]')), more: box(document.querySelector('[data-a="cdetails"]')),
        minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))), sum: !!document.querySelector('.c-sum').offsetParent, ready: document.querySelector('.c-ready').innerText };
    });
    const L1 = await lay();
    if (OUT) await p.screenshot({ path: `${OUT}/v09d1-${dev.name}-campaign.png` });
    await p.tap('[data-a="cdetails"]'); await p.waitForTimeout(80);
    const L2 = await lay();
    const scrolls = await p.evaluate(() => { const b = document.querySelector('.c-more-body'); return { can: b.scrollHeight >= b.clientHeight, vis: getComputedStyle(b).display !== 'none' }; });
    if (OUT) await p.screenshot({ path: `${OUT}/v09d1-${dev.name}-campaign-details.png` });
    const ok = (L) => !L.hOver && !L.vScroll && [L.deploy, L.edit, L.more].every((b) => b.inside && b.aligned && b.h >= 43.5) && L.minFont >= 11;
    check(`A6 ${dev.name}: default view (summary, "Squad: 5/6 ready", MISSION DETAILS, EDIT SQUAD, DEPLOY) and opened details both fit: no page scroll either way, buttons on screen and tappable (>= 44 CSS px), text >= 11 px`, ok(L1) && ok(L2) && L1.sum && /5\/6/.test(L1.ready) && scrolls.vis, JSON.stringify({ L1, L2: { ...L2, ready: undefined }, scrolls }));
    await p.context().close();
  }

  // ================= B. READY TO DEPLOY? =================
  const modal = () => ev(() => {
    const el = document.querySelector('.brief');
    if (!el) return null;
    return { t: el.innerText.replace(/\s+/g, ' '), count: (el.querySelector('.dc-count') || {}).innerText || '', slots: el.querySelectorAll('.dc-slot:not(.dc-empty)').length, empty: el.querySelectorAll('.dc-empty').length, ports: el.querySelectorAll('.dc-slot canvas').length,
      warn: (el.querySelector('.dc-warn') || {}).innerText || '', note: !!el.querySelector('.dc-note'), go: el.querySelector('[data-a="brief-deploy"]').innerText.trim(), edit: !!el.querySelector('[data-a="brief-edit"]'), x: !!el.querySelector('.dc-x[data-a="brief-back"]'), phase: window.game.phase, mission: window.game.missionId };
  });
  const six = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'].filter((x) => owned.includes(x));
  await campaign('first-contact', ['ace', 'ranger']);
  await page.click('.c-btns [data-a="deploy"]');
  const b1 = await modal();
  check('B1 full squad (Mission 1, 2/2): READY TO DEPLOY?, the mission, "YOUR SQUAD: 2/2", two soldiers with portrait / name / class, no empty slot or warning, DEPLOY, EDIT SQUAD, a close button; nothing deployed yet', b1 && /READY TO DEPLOY\?/.test(b1.t) && /Mission 1 — First Contact/.test(b1.t) && /2\/2/.test(b1.count) && b1.slots === 2 && b1.ports === 2 && /ACE/i.test(b1.t) && /Infantry/.test(b1.t) && b1.empty === 0 && !b1.warn && b1.go === 'DEPLOY' && b1.edit && b1.x && b1.phase !== 'playing', JSON.stringify(b1));
  await page.click('.dc-x');
  await campaign('warlord-hq', six.slice(0, 5));
  await page.click('.c-btns [data-a="deploy"]');
  const b2 = await modal();
  check('B2 Mission 20 with five selected and spare soldiers: "YOUR SQUAD: 5/6", one empty slot, "1 deployment slot is empty.", DEPLOY ANYWAY', b2 && /5\/6/.test(b2.count) && b2.slots === 5 && b2.empty === 1 && /1 deployment slot is empty\./.test(b2.warn) && b2.go === 'DEPLOY ANYWAY' && b2.mission === 'warlord-hq', JSON.stringify(b2));
  const auto = await ev(() => window.game.roster.count());
  check('B3 nothing is auto-selected: still five selected with the check open', auto === 5, String(auto));
  // cancel three ways
  await page.click('.dc-x'); const c1 = await modal();
  await page.click('.c-btns [data-a="deploy"]'); await page.mouse.click(5, 5); const c2 = await modal();
  await page.click('.c-btns [data-a="deploy"]'); await page.keyboard.press('Escape'); const c3 = await modal();
  const st = await ev(() => ({ phase: window.game.phase, sel: window.game.ui.menus.campaignSel, menu: document.getElementById('menu').className }));
  check('B4 ✕, a tap outside and Esc each close it without deploying; the mission stays selected', !c1 && !c2 && !c3 && st.phase !== 'playing' && st.sel === 'warlord-hq' && /campaign/.test(st.menu), JSON.stringify(st));
  // EDIT SQUAD and back
  await page.click('.c-btns [data-a="deploy"]'); await page.click('[data-a="brief-edit"]'); await page.waitForTimeout(60);
  const inB = await ev(() => ({ menu: document.getElementById('menu').className, tab: !!document.querySelector('.b-slots') }));
  await ev((id) => { window.game.roster.select(id, undefined, 6); }, six[5]);
  await page.click('.b-go[data-a="to-campaign"]'); await page.waitForTimeout(60);
  const b5 = await modal();
  check('B5 EDIT SQUAD opens the Barracks roster (no editor in the modal); back to the Campaign reopens READY TO DEPLOY? for the same mission with the edited squad (6/6, DEPLOY)', /barracks/.test(inB.menu) && inB.tab && b5 && b5.mission === 'warlord-hq' && /6\/6/.test(b5.count) && b5.empty === 0 && b5.go === 'DEPLOY' && b5.phase !== 'playing', JSON.stringify({ inB, b5 }));
  await page.click('.dc-x');
  // lower-cap mission then a higher one
  await campaign('prison-break', six.slice(0, 5));
  await page.click('.c-btns [data-a="deploy"]'); const lo = await modal(); await page.click('.dc-x');
  await page.click('[data-a="cchap"][data-ch="3"]'); await page.click('[data-a="csel"][data-id="hold-the-line"]');
  await page.click('.c-btns [data-a="deploy"]'); const hi = await modal(); await page.click('.dc-x');
  check('B6 per-mission caps: Mission 7 (cap 5) with five shows 5/5 DEPLOY; switching to Mission 13 (cap 6) shows 5/6 with the empty-slot warning', lo && /5\/5/.test(lo.count) && lo.go === 'DEPLOY' && !lo.warn && lo.mission === 'prison-break' && hi && /5\/6/.test(hi.count) && /1 deployment slot is empty/.test(hi.warn) && hi.mission === 'hold-the-line', JSON.stringify({ lo: lo && [lo.count, lo.go, lo.mission], hi: hi && [hi.count, hi.go, hi.mission] }));
  // nobody to add: a roster of five living soldiers
  {
    const p = await openPage(browser, URL, { seed: 4 });
    await p.waitForTimeout(150); await notices(p);
    await p.evaluate(() => { const g = window.game; window.__debugUnlockAll(); const keep = g.roster.owned().slice(0, 5).map((s) => s.id); for (const s of [...g.roster.owned()]) if (!keep.includes(s.id)) g.roster.remove(s.id); g.roster.trimTo(0); for (const x of keep) g.roster.select(x, undefined, 6); window.__account().campaign.selectedMission = 'warlord-hq'; g.ui.showCampaign(); });
    await notices(p);
    await p.click('.c-btns [data-a="deploy"]');
    const m = await p.evaluate(() => { const el = document.querySelector('.brief'); return el && { count: el.querySelector('.dc-count').innerText, empty: el.querySelectorAll('.dc-empty').length, warn: !!el.querySelector('.dc-warn'), note: !!el.querySelector('.dc-note'), go: el.querySelector('[data-a="brief-deploy"]').innerText.trim(), owned: window.game.roster.living().length }; });
    check('B7 no eligible soldier left (five in the roster): 5/6 and the empty slot shown, no warning, plain DEPLOY', m && /5\/6/.test(m.count) && m.empty === 1 && !m.warn && m.note && m.go === 'DEPLOY' && m.owned === 5, JSON.stringify(m));
    await p.click('[data-a="brief-deploy"]'); await p.waitForTimeout(80);
    const d = await p.evaluate(() => ({ phase: window.game.phase, n: window.game.soldiers.length }));
    check('B8 an under-strength deployment is allowed (five deploy into Mission 20)', d.phase === 'playing' && d.n === 5, JSON.stringify(d));
    await p.context().close();
  }
  // revalidation and double tap
  await campaign('warlord-hq', six);
  await page.click('.c-btns [data-a="deploy"]');
  await ev(() => { const s = window.game.roster.squad()[2]; window.__saved = s.status; s.status = 'kia'; });
  await page.click('[data-a="brief-deploy"]'); await page.waitForTimeout(60);
  const rv = await ev(() => ({ phase: window.game.phase, notice: (document.querySelector('.m-notice') || {}).textContent || '' }));
  await ev(() => { window.game.roster.squad()[2].status = window.__saved; });
  check('B9 the squad is revalidated on confirm: a soldier who fell meanwhile blocks the launch with the reason', rv.phase !== 'playing' && /fallen/.test(rv.notice), JSON.stringify(rv));
  await campaign('warlord-hq', six);
  await ev(() => { const g = window.game, d0 = g.deploy.bind(g); window.__deploys = 0; g.deploy = (...a) => { window.__deploys++; return d0(...a); }; });
  await page.click('.c-btns [data-a="deploy"]');
  await page.dblclick('[data-a="brief-deploy"]').catch(() => {});
  await page.mouse.click(640, 360); await page.waitForTimeout(100);
  const dbl = await ev(() => ({ n: window.__deploys, phase: window.game.phase, sol: window.game.soldiers.length, run: window.game.runId }));
  check('B10 a double tap on DEPLOY launches exactly one mission (six soldiers)', dbl.n === 1 && dbl.phase === 'playing' && dbl.sol === 6, JSON.stringify(dbl));
  await ev(() => { const g = window.game; delete g.deploy; g.toCampaign(); });
  await campaign('warlord-hq', six);
  await ev(() => { const g = window.game, d0 = g.deploy.bind(g); window.__deploys = 0; g.deploy = (...a) => { window.__deploys++; return d0(...a); }; });
  await page.keyboard.press('Enter'); await page.waitForTimeout(60); const kOpen = await modal();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  const kb = await ev(() => ({ n: window.__deploys, phase: window.game.phase }));
  check('B11 keyboard: Enter opens the check, Enter deploys (once, even when pressed twice)', kOpen && kb.n === 1 && kb.phase === 'playing', JSON.stringify(kb));
  await ev(() => { const g = window.game; delete g.deploy; g.toCampaign(); });
  // phones: the check fits
  for (const dev of PHONES) {
    const p = await openPage(browser, URL, { seed: 6, viewport: { width: dev.w, height: dev.h }, context: { isMobile: true, hasTouch: true } });
    await campaign('warlord-hq', six.slice(0, 5), p);
    await p.tap('.c-btns [data-a="deploy"]'); await p.waitForTimeout(100);
    const L = await p.evaluate(() => {
      const vw = innerWidth, vh = innerHeight, el = document.querySelector('.brief'); if (!el) return null;
      const r = el.getBoundingClientRect();
      const bt = [...el.querySelectorAll('[data-a="brief-deploy"], [data-a="brief-edit"], .dc-x')].map((b) => { const q = b.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { h: Math.round(q.height), w: Math.round(q.width), inside: q.top >= -0.5 && q.bottom <= vh + 0.5 && q.left >= -0.5 && q.right <= vw + 0.5, aligned: !!hit && (hit === b || b.contains(hit)) }; });
      const texts = [...el.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      return { inside: r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5, scroll: el.scrollHeight > el.clientHeight + 1, bt, minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))) };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/v09d1-${dev.name}-deploy-check.png` });
    check(`B12 ${dev.name}: READY TO DEPLOY? fits (no scroll), DEPLOY ANYWAY / EDIT SQUAD / ✕ on screen and >= 44 CSS px, text >= 11 px`, L && L.inside && !L.scroll && L.bt.length === 3 && L.bt.every((b) => b.inside && b.aligned && b.h >= 43.5 && b.w >= 43.5) && L.minFont >= 11, JSON.stringify(L));
    await p.context().close();
  }

  // ================= C. OBJECTIVES HUD =================
  const hud = () => ev(() => {
    window.__render();
    const o = document.getElementById('objective'), body = o.querySelector('.obj-body');
    return { collapsed: o.classList.contains('collapsed'), open: o.classList.contains('open'), body: getComputedStyle(body).display !== 'none', text: o.querySelector('.obj-text').textContent, main: o.querySelector('.ot-m').textContent, prog: o.querySelector('.ot-p').textContent, opt: (o.querySelector('.obj-opt').offsetParent ? o.querySelector('.obj-opt').innerText : ''), prim: o.querySelector('.obj-prim').offsetParent ? o.querySelector('.obj-prim').innerText : '', game: window.game.objective.text, aria: o.querySelector('.obj-head').getAttribute('aria-expanded') };
  });
  await ev(() => { T.start('warlord-hq', ['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']); Y.skip(); window.game.input.move = () => ({ x: 0, y: 0 }); T.step(0.2); });
  const h0 = await hud();
  check('C1 a mission starts with the objectives collapsed: one line (☑ objective · progress), no details, no optional list', h0.collapsed && !h0.body && !h0.opt && h0.text === h0.game && /· 0\/2$/.test(h0.text) && h0.prog === ' · 0/2' && h0.aria === 'false', JSON.stringify(h0));
  await page.click('.obj-head'); const h1 = await hud();
  check('C2 a tap opens it: the objective details, the primary list (current ▸) and the optionals with progress', h1.open && h1.body && /▸/.test(h1.prim) && /Destroy the Communications Array/.test(h1.prim) && /watchtowers/.test(h1.opt) && /0\/3/.test(h1.opt) && h1.aria === 'true', JSON.stringify(h1));
  await page.click('.obj-head'); const h2 = await hud();
  check('C3 a second tap collapses it', h2.collapsed && !h2.body, JSON.stringify(h2));
  // auto-collapse
  await page.click('.obj-head');
  await ev(() => { T.step(2); }); const h3 = await hud(); // standing still, the squad auto-fires at whatever is in range
  await ev(() => { window.game.input.move = () => ({ x: 1, y: 0 }); T.step(0.3); }); const h4 = await hud();
  check('C4 it stays open while the squad stands (auto-fire / enemies moving) and collapses on a movement command', h3.open && h4.collapsed, `${h3.open} ${h4.collapsed}`);
  await page.click('.obj-head'); await ev(() => { T.step(0.5); }); const h5 = await hud();
  await ev(() => { window.game.input.move = () => ({ x: 0, y: 0 }); T.step(0.5); window.__render(); window.game.input.move = () => ({ x: 0, y: -1 }); T.step(0.3); }); const h6 = await hud();
  check('C5 opened while the joystick is held, it stays open until the next movement command (stop, then move)', h5.open && h6.collapsed, `${h5.open} ${h6.collapsed}`);
  await ev(() => { window.game.input.move = () => ({ x: 0, y: 0 }); T.kill((e) => e.structure === 'relay'); });
  const h7 = await hud();
  check('C6 the collapsed summary follows the objective at once (one installation down: · 1/2)', h7.collapsed && /· 1\/2$/.test(h7.text) && h7.prog === ' · 1/2', JSON.stringify(h7));
  // boss bar separate
  await ev(() => { Y.toBoss(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']); T.step(0.5); });
  await page.click('.obj-head');
  const bb = await ev(() => {
    window.__render();
    const r = (q) => { const e = document.querySelector(q); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, vis: getComputedStyle(e).display !== 'none' }; };
    const o = r('#objective'), b = r('#bossbar'), ov = o.l < b.r && b.l < o.r && o.t < b.b && b.t < o.b;
    return { o, b, ov, inside: !document.getElementById('objective').contains(document.getElementById('bossbar')), name: document.querySelector('#bossbar .ob-name').textContent, below: b.t >= o.b - 0.5 };
  });
  check('C7 the boss bar is its own element below the objectives control; the opened details push it down and never cover it', bb.b.vis && bb.inside && !bb.ov && bb.below && /WARLORD/.test(bb.name), JSON.stringify(bb));
  await page.click('.obj-head');
  // phones
  for (const dev of PHONES) {
    const p = await openPage(browser, URL, { seed: 8, viewport: { width: dev.w, height: dev.h }, context: { isMobile: true, hasTouch: true } });
    await p.evaluate(helpers);
    await p.evaluate(() => { Y.toBoss(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']); T.step(0.3); window.__render(); });
    await p.waitForTimeout(250);
    const geo = () => p.evaluate(() => {
      window.__render();
      const vw = innerWidth, vh = innerHeight, rect = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const ov = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const head = document.querySelector('.obj-head'), hr = rect(head), cx = (hr.l + hr.r) / 2, cy = (hr.t + hr.b) / 2;
      const area = [[0, -21.5], [0, 21.5], [-21.5, 0], [21.5, 0]].every(([dx, dy]) => { const h = document.elementFromPoint(cx + dx, Math.max(0, cy + dy)); return !!h && head.contains(h); });
      const o = rect(document.getElementById('objective')), b = rect(document.getElementById('bossbar'));
      const others = ['#topbtns', '#timer', '#support', '#panels'].map((q) => document.querySelector(q)).filter((e) => e && e.offsetParent && getComputedStyle(e).display !== 'none');
      return { inside: o.l >= 0 && o.r <= vw && o.t >= 0 && b.r <= vw && b.b <= vh, area, joyFree: o.l >= vw * 0.45 - 1 && b.l >= vw * 0.45 - 1, hits: others.filter((e) => ov(rect(e), o) || ov(rect(e), b)).map((e) => e.id), bossClear: !ov(o, b), oBottom: Math.round(o.b / vh * 100) };
    });
    const G1 = await geo();
    if (OUT) await p.screenshot({ path: `${OUT}/v09d1-${dev.name}-hud-collapsed.png` });
    await p.tap('.obj-head'); await p.waitForTimeout(60);
    const tapped = await p.evaluate(() => ({ open: document.getElementById('objective').classList.contains('open'), joy: !!window.game.input.joy, moving: window.game.squadMoving }));
    const G2 = await geo();
    if (OUT) await p.screenshot({ path: `${OUT}/v09d1-${dev.name}-hud-open.png` });
    check(`C8 ${dev.name}: the control has a 44 CSS px touch area, sits right of the joystick half, clear of the top buttons / timer / support / panels, the boss bar below it; a tap opens it without starting the joystick; open it stays on screen and above the bottom quarter`, G1.inside && G1.area && G1.joyFree && G1.hits.length === 0 && G1.bossClear && tapped.open && !tapped.joy && !tapped.moving && G2.inside && G2.hits.length === 0 && G2.bossClear && G2.oBottom <= 75, JSON.stringify({ G1, tapped, G2 }));
    await p.context().close();
  }
  // every mission starts collapsed, and its one-line summary is the live objective
  const starts = await ev(() => window.__campaign.CAMPAIGN.filter((m) => m.playable).map((m) => m.id).map((id) => { T.start(id, ['infantry', 'heavy', 'medic']); Y.skip(); window.__render(); const o = document.getElementById('objective'); return { id, c: o.classList.contains('collapsed') && getComputedStyle(o.querySelector('.obj-body')).display === 'none', same: o.querySelector('.obj-text').textContent === window.game.objective.text }; })
    .filter((x) => !(x.c && x.same)).map((x) => x.id));
  check('C9 all 20 missions start with the objectives collapsed (reopened state never carried over) and show the live objective', starts.length === 0, starts.join() || '20 ok');

  // ================= D. ROLE-BASED FORMATION =================
  const form = await ev(() => {
    const g = window.game, out = {};
    const band = (dirs, squad, secs = 4) => {
      T.start('first-contact', squad); T.calm();
      const res = [];
      const order = (ux, uy) => { const act = g.soldiers.filter((s) => s.active);
        const c = { x: act.reduce((a, s) => a + s.pos.x, 0) / act.length, y: act.reduce((a, s) => a + s.pos.y, 0) / act.length };
        return act.map((s) => ({ c: s.identity.classId, f: (s.pos.x - c.x) * ux + (s.pos.y - c.y) * uy })).sort((a, b) => b.f - a.f).map((x) => x.c); };
      res.moving = [];
      for (const [dx, dy] of dirs) {
        const n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n;
        g.input.move = () => ({ x: dx, y: dy }); T.step(secs); res.moving.push(order(ux, uy));
        // a short halt: the formation keeps its facing and every soldier settles into his slot
        g.input.move = () => ({ x: 0, y: 0 }); T.step(1.5); res.push(order(ux, uy));
      }
      return res;
    };
    out.start = (() => { T.start('first-contact', ['medic', 'heavy', 'infantry']); T.calm(); g.input.move = () => ({ x: 0, y: 0 }); T.step(1); return { on: g.march.on, assigns: g.march.assigns }; })();
    out.six = band([[1, 0], [0, -1], [-1, 1], [1, 0.2]], ['medic', 'sniper', 'infantry', 'heavy', 'commando', 'demolitions']); out.sixMoving = out.six.moving;
    out.noHeavy = band([[1, 0], [0, -1]], ['medic', 'sniper', 'infantry', 'commando']);
    out.many = band([[1, 0], [0, -1]], ['medic', 'medic', 'heavy', 'heavy', 'infantry', 'sniper']);
    // sizes 1-6: every standing soldier has a slot, distinct slots
    out.sizes = [1, 2, 3, 4, 5, 6].map((n) => { T.start('first-contact', ['heavy', 'medic', 'infantry', 'sniper', 'commando', 'demolitions'].slice(0, n)); T.calm(); g.input.move = () => ({ x: 1, y: 0 }); T.step(0.5); const s = [...g.march.slots.values()].map((v) => v.join()); return g.march.slots.size === n && new Set(s).size === n; });
    // hysteresis
    T.start('first-contact', ['medic', 'heavy', 'infantry', 'sniper']); T.calm();
    g.input.move = () => ({ x: 1, y: 0 }); T.step(1);
    const h0 = g.march.heading, a0 = g.march.assigns;
    g.input.move = () => ({ x: 0, y: 1 }); T.step(0.15); const jink = g.march.heading;
    g.input.move = () => ({ x: 1, y: 0 }); T.step(0.5);
    g.input.move = () => ({ x: Math.cos(0.3), y: Math.sin(0.3) }); T.step(0.1); const small = g.march.heading;
    g.input.move = () => ({ x: 0, y: 1 }); T.step(0.5); const turned = g.march.heading;
    out.hyst = { h0: +h0.toFixed(2), jink: +jink.toFixed(2), small: +small.toFixed(2), turned: +turned.toFixed(2), assigns: g.march.assigns - a0 };
    // downs / revives reassign, nothing else does
    T.start('first-contact', ['medic', 'heavy', 'infantry', 'sniper']); T.calm(); g.input.move = () => ({ x: 1, y: 0 }); T.step(1);
    const b0 = g.march.assigns; for (let k = 0; k < 8; k++) { g.input.move = () => ({ x: Math.cos(k), y: Math.sin(k) }); T.step(0.6); } const b1 = g.march.assigns;
    const hv = g.soldiers.find((s) => s.identity.classId === 'heavy'); g.damage(hv, hv.hp + 1); T.step(0.2); const downed = hv.state, b2 = g.march.assigns, inf = g.march.slots.get(g.soldiers.find((s) => s.identity.classId === 'infantry').id);
    hv.state = 'active'; hv.hp = 50; T.step(0.2); const b3 = g.march.assigns, hvSlot = g.march.slots.get(hv.id);
    out.re = { turns: b1 - b0, downed, onDown: b2 - b1, infFront: inf && inf[0] > 0.5, onRevive: b3 - b2, hvFront: hvSlot && hvSlot[0] > 0.5 };
    // the Medic still reaches the front with Field Treatment when the squad stops
    T.start('first-contact', ['heavy', 'infantry', 'commando', 'demolitions', 'sniper', 'medic']); T.calm(); g.input.move = () => ({ x: 1, y: 0 }); T.step(3); g.input.move = () => ({ x: 0, y: 0 }); T.step(2);
    const md = g.soldiers.find((s) => s.identity.classId === 'medic'), R = window.__CFG.fieldTreatment.radius;
    out.medic = { far: Math.round(Math.max(...g.soldiers.map((s) => Y.near(s.pos, md.pos)))), R };
    return out;
  });
  const front = (o, cls) => o.slice(0, Math.ceil(o.length / 2)).includes(cls), rear = (o, cls) => o.slice(Math.floor(o.length / 2)).includes(cls);
  check('D1 the formation is off until the squad first moves (deploy offsets kept, nothing assigned)', !form.start.on && form.start.assigns === 0, JSON.stringify(form.start));
  const roleOk = (o) => front(o, 'heavy') && rear(o, 'medic') && rear(o, 'sniper');
  check('D2 six classes, east / north / south-west / east again, each leg 4 s then a 1.5 s halt: settled, the Heavy in the front half, the Medic and the Sniper in the rear half every time (front is the direction of travel)', form.six.every(roleOk), form.six.map((o) => o.join('>')).join(' | '));
  check('D2b ...and on the move (4 s into each leg, the reversal included): the Medic and the Sniper behind every time, the Heavy in front on at least 3 of the 4 legs (a Heavy slower than the squad can lag after a full reversal)', form.sixMoving.every((o) => rear(o, 'medic') && rear(o, 'sniper')) && form.sixMoving.filter((o) => front(o, 'heavy')).length >= 3, form.sixMoving.map((o) => o.join('>')).join(' | '));
  check('D3 no Heavy: Infantry or Commando lead, the Medic last; two Heavies + two Medics: both Heavies in front, both Medics behind', form.noHeavy.every((o) => ['infantry', 'commando'].includes(o[0]) && o[o.length - 1] === 'medic') && form.many.every((o) => o.slice(0, 3).filter((c) => c === 'heavy').length === 2 && o.slice(3).filter((c) => c === 'medic').length === 2), [...form.noHeavy, ...form.many].map((o) => o.join('>')).join(' | '));
  check('D4 squads of 1-6: every standing soldier holds its own slot', form.sizes.every(Boolean), form.sizes.join());
  check('D5 hysteresis: a 0.15 s jink does not turn the formation; a small (17°) change is followed gently; a held 90° turn swings it; turning never reassigns slots', form.hyst.jink === form.hyst.h0 && Math.abs(form.hyst.small - form.hyst.h0) < 0.15 && Math.abs(form.hyst.turned - Math.PI / 2) < 0.05 && form.hyst.assigns === 0, JSON.stringify(form.hyst));
  check('D6 slots are reassigned only when the standing set changes: none for eight direction changes, once when the Heavy goes down (Infantry takes the front), once when he is back (front again)', form.re.turns === 0 && form.re.downed === 'downed' && form.re.onDown === 1 && form.re.infFront && form.re.onRevive === 1 && form.re.hvFront, JSON.stringify(form.re));
  check('D7 stopped, the rear Medic is within Field Treatment reach of every soldier', form.medic.far <= form.medic.R, JSON.stringify(form.medic));
  // seeded route walks vs v0.9D
  const ROUTES = ['ambush-alley', 'fuel-for-the-fire', 'warlord-hq', 'supply-line', 'iron-fist', 'bring-them-home'];
  if (BASE) {
    const pb = await openPage(browser, BASE, { seed: 11 });
    await pb.evaluate(helpers);
    const rows2 = [];
    for (const id of ROUTES) {
      const sq = id === 'bring-them-home' ? ['medic', 'heavy', 'infantry'] : SIX;
      const pn = await openPage(browser, URL, { seed: 11 }); await pn.evaluate(helpers);
      const n = await pn.evaluate(([id, sq]) => Y.walk(id, sq), [id, sq]);
      await pn.context().close();
      const pb2 = await openPage(browser, BASE, { seed: 11 }); await pb2.evaluate(helpers);
      const b = await pb2.evaluate(([id, sq]) => Y.walk(id, sq), [id, sq]);
      await pb2.context().close();
      rows2.push({ id, n, b });
    }
    await pb.context().close();
    const ok = (r) => r.n.done === r.b.done && r.n.t <= r.b.t * 1.05 + 0.5 && r.n.stall <= r.b.stall + 2 && r.n.maxSpread <= Math.max(160, r.b.maxSpread * 1.25) && r.n.blasts <= r.b.blasts + 1 && r.n.alive >= r.b.alive;
    // mined trails, walked blind (the squad steered straight down the trail over every mine, nobody steering round a
    // revealed one): blasts depend on who happens to step where, so four seeds are summed per build
    const MINED = { 'jungle-sweep': null, 'warlord-hq': [{ x: 900, y: 2200 }, { x: 850, y: 1550 }, { x: 950, y: 1150 }, { x: 1450, y: 800 }, { x: 1850, y: 680 }, { x: 2650, y: 640 }] };
    const mined = { n: { blasts: 0, lost: 0 }, b: { blasts: 0, lost: 0 } };
    for (const [id, route] of Object.entries(MINED)) for (const seed of [11, 12, 13, 14]) for (const [k, url] of [['n', URL], ['b', BASE]]) {
      const pm = await openPage(browser, url, { seed });
      const r = await pm.evaluate(([id, route, sq]) => {
        const g = window.game; T.start(id, sq); if (g.modal === 'story') g.story.skip(g); T.calm();
        const road = route || g.map.roads[0]; let wi = 0; const M = g.mission.mechanic('mines');
        for (let i = 0; i < 45 * 60 && wi < road.length; i++) { const a = g.anchor, w = road[wi]; const dx = w.x - a.x, dy = w.y - a.y, dd = Math.hypot(dx, dy); if (dd < 80) { wi++; continue; } g.input.move = () => ({ x: dx / dd, y: dy / dd }); g.update(1 / 60); if (g.modal === 'story') g.story.skip(g); }
        return { blasts: M.log.detonations, lost: g.soldiers.filter((s) => !s.active).length };
      }, [id, route, SIX]);
      await pm.context().close();
      mined[k].blasts += r.blasts; mined[k].lost += r.lost;
    }
    check('D9 mined trails walked blind (Mission 16 road, Mission 20 flank; 4 seeds each, summed): mine blasts within 25% of v0.9D and no more than 2 extra soldiers down / lost in total (no systematic detours onto mines)', mined.n.blasts <= Math.ceil(mined.b.blasts * 1.25) && mined.n.lost <= mined.b.lost + 2, JSON.stringify(mined));
    check('D8 seeded route walks (narrow streets, the jungle depot, the HQ, the long supply road, the stronghold, the captive escort ring): same arrival and time as v0.9D (+5%), no extra stalls or mine blasts, spread within bounds', rows2.every(ok), rows2.map((r) => `${r.id}:${ok(r) ? 'ok' : 'BAD'} n${JSON.stringify(r.n)} b${JSON.stringify(r.b)}`).join(' ').slice(0, 420));
  } else check('D8 BASE build available', false, 'BASE not set (npm test serves v0.9D)');

  // ================= E. THE WARLORD UNDER FIRE =================
  const POST = { x: 4730, y: 1130 };
  const scen = async (url) => {
    const p = await openPage(browser, url, { seed: 2020 }); await p.evaluate(helpers);
    const r = await p.evaluate((POST) => {
      const out = {};
      const run = (label, at, sec = 20, setup) => {
        const { g, F, B } = Y.toBoss(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']);
        if (setup) setup(g, F, B);
        const h = Y.hold(F, B, at, sec, POST);
        out[label] = { ...h, resp: F.responses ? { ...F.responses } : null, phase: F.phase, notes: F.log.filter((l) => /respond/.test(l.what)).length, at: { x: Math.round(B.pos.x), y: Math.round(B.pos.y) } };
        return { g, F, B };
      };
      // phase 1 throughout (the phase thresholds untouched in CFG: his HP is topped up instead)
      const keep = (g, F, B) => { const d0 = g.damage.bind(g); g.damage = (u, amt, ...a) => { const r = d0(u, amt, ...a); if (u === B && B.hp < B.maxHp * 0.72) B.hp = B.maxHp * 0.72; return r; }; };
      run('inRange', { x: 4400, y: 1130 }, 15, keep);
      run('west450', { x: 4280, y: 1130 }, 20, keep);
      { const { g, F, B } = Y.toBoss(['sniper']); keep(g, F, B); const h = Y.hold(F, B, { x: 4225, y: 1175 }, 20, POST); out.sniper520 = { ...h, resp: F.responses ? { ...F.responses } : null, phase: F.phase, notes: F.log.filter((l) => /respond/.test(l.what)).length }; }
      run('offscreenSouth', { x: 4650, y: 1600 }, 20, keep);
      run('blocked', { x: 4400, y: 1360 }, 15, keep);
      // a single stray hit: no reaction
      { const { g, F, B } = Y.toBoss(['infantry', 'heavy', 'medic']); const h = Y.hold(F, B, { x: 3900, y: 1400 }, 1, POST); g.damage(B, 40, g.soldiers[0]); const h2 = Y.hold(F, B, { x: 3900, y: 1400 }, 8, POST); out.stray = { resp: F.responses ? { ...F.responses } : null, far: Math.max(h.far, h2.far) }; }
      // he walks back after the calm
      { const { g, F, B } = Y.toBoss(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']); keep(g, F, B);
        const h = Y.hold(F, B, { x: 4280, y: 1130 }, 12, POST); const away = Y.hold(F, B, { x: 3700, y: 1450 }, 16, POST);
        out.back = { moved: h.far, end: Math.round(Y.near(B.pos, POST)), resp: F.responses ? { ...F.responses } : null, notes: F.log.filter((l) => /respond/.test(l.what)).map((l) => l.what).join(' ') }; }
      // phases 2 / 3 untouched
      { const { g, F, B } = Y.toBoss(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']); g.invuln = true;
        g.damage(B, B.maxHp * 0.31, g.soldiers[0]); const h2 = Y.hold(F, B, { x: 4280, y: 1130 }, 8, POST); const p2 = { phase: F.phase, reloc: F.relocations, goal: F.respondGoal };
        g.damage(B, B.hp - B.maxHp * 0.33, g.soldiers[0]); T.step(0.1); out.phases = { p2, p3: F.phase, log: F.log.map((l) => l.what).filter((w) => /phase|relocate|call/.test(w)).join(' '), stage: F.stage }; }
      out.cfg = { w: JSON.stringify(window.__CFG.warlord), m: JSON.stringify(window.__CFG.mortar) };
      return out;
    }, POST);
    await p.context().close();
    return r;
  };
  const N = await scen(URL), B0 = BASE ? await scen(BASE) : null;
  check('E1 the v0.9D cause, reproduced on v0.9D: squad 424 px west (outside his 400 px rifle, inside 420-560 px squad ranges), a lone Sniper at 520 px, or 470 px south (he is off screen and his rifle never fires there): the squad hits him, he fires no shot and never moves', !B0 || ['west450', 'sniper520', 'offscreenSouth'].every((k) => B0[k].shots === 0 && B0[k].dmg > 0 && B0[k].far <= 12), B0 ? JSON.stringify({ w: B0.west450, s: B0.sniper520, o: B0.offscreenSouth }) : 'no BASE');
  check('E2 now he answers: in each of those cases he steps out from his post (one response) and returns rifle fire', ['west450', 'sniper520', 'offscreenSouth'].every((k) => N[k].resp.triggered >= 1 && N[k].shots >= 5), JSON.stringify({ w: [N.west450.shots, N.west450.resp], s: [N.sniper520.shots, N.sniper520.resp], o: [N.offscreenSouth.shots, N.offscreenSouth.resp] }));
  const R = await ev(() => window.__CFG.warlordResponse);
  check('E3 he stays on his leash (<= 240 px from the command post) and inside the arena, and settles (at most 3 spot changes in 20 s)', ['west450', 'sniper520', 'offscreenSouth', 'inRange', 'blocked'].every((k) => N[k].far <= R.leash + 12 && N[k].out === 0 && N[k].notes <= 3), JSON.stringify(Object.fromEntries(['west450', 'sniper520', 'offscreenSouth'].map((k) => [k, [N[k].far, N[k].out, N[k].notes]]))));
  check('E4 no reaction when he can already fire back (330 px: same shots as v0.9D, never leaves the post) or when the barriers block both sides (nobody hits him)', N.inRange.resp.triggered === 0 && N.inRange.far <= 12 && (!B0 || N.inRange.shots === B0.inRange.shots) && N.blocked.resp.triggered === 0 && N.blocked.dmg === 0 && N.blocked.far <= 12, JSON.stringify({ inRange: N.inRange, blocked: N.blocked, base: B0 && B0.inRange.shots }));
  check('E5 a single stray hit (40 HP, under 5% of his HP) gets no reaction', N.stray.resp.triggered === 0 && N.stray.far <= 12, JSON.stringify(N.stray));
  check('E6 when the squad pulls back out of reach he walks back to his command post after the calm', N.back.moved > 15 && N.back.end <= 12 && N.back.resp.returned >= 1 && /respond:back/.test(N.back.notes), JSON.stringify(N.back));
  check('E7 phases unchanged: below 70% he relocates (phase 2, no under-fire spot), below 35% phase 3; calls as before', N.phases.p2.phase === 2 && N.phases.p2.reloc >= 1 && !N.phases.p2.goal && N.phases.p3 === 3 && /phase2/.test(N.phases.log) && /phase3/.test(N.phases.log) && /relocate/.test(N.phases.log), JSON.stringify(N.phases));
  check('E8 his stats and the mortar are v0.9D\'s (HP 2,400, damage, fire rates, range, phase thresholds; mortar warn / radius / damage / cadence)', !B0 || (N.cfg.w === B0.cfg.w && N.cfg.m === B0.cfg.m), N.cfg.w.slice(0, 120));

  // ================= F. MORTAR WARNING =================
  const mor = await ev(() => {
    const { g, F } = Y.toBoss(['infantry', 'heavy', 'medic']);
    F.shoot = () => {};
    const c = { x: 4150, y: 1450 };
    const t0 = g.time; T.stepUntil(() => !!F.mortar, 14, () => { T.pinAt(c); g.cam = { ...c }; Y.skip(); });
    const firstAt = +(g.time - t0).toFixed(2);
    T.step(0.5, () => { T.pinAt(c); g.cam = { ...c }; });
    window.__render();
    const st = document.querySelector('#bossbar .ob-state'), sub = document.querySelector('#objective .obj-sub').textContent;
    const out = { firstAt, circle: !!F.mortar, banners: g.banners.map((b) => b.text).join('|'), state: st.textContent, alert: st.classList.contains('alert'), sub };
    const t1 = g.time; T.stepUntil(() => !F.mortar, 5, () => { T.pinAt({ x: 4450, y: 1650 }); });
    out.land = +(g.time - t1 + 0.5).toFixed(2);
    window.__render(); out.after = st.textContent; out.afterAlert = st.classList.contains('alert');
    return out;
  });
  check('F1 a mortar shows one compact warning: the pulsing boss-bar state "MORTAR INCOMING — MOVE!" with the red circle; no big banner and no yellow objective line', mor.circle && /MORTAR INCOMING/.test(mor.state) && mor.alert && !/MORTAR/i.test(mor.banners) && !/INCOMING|red circle/i.test(mor.sub), JSON.stringify(mor));
  check('F2 timing unchanged: the first circle ~6 s into the fight, the shell ~3 s after it appears; the warning clears after the impact', mor.firstAt >= 5.5 && mor.firstAt <= 8 && Math.abs(mor.land - 3) <= 0.1 && !/MORTAR/.test(mor.after) && !mor.afterAlert, JSON.stringify({ first: mor.firstAt, land: mor.land, after: mor.after }));
  for (const dev of PHONES.slice(0, 1)) {
    const p = await openPage(browser, URL, { seed: 12, viewport: { width: dev.w, height: dev.h }, context: { isMobile: true, hasTouch: true } });
    await p.evaluate(helpers);
    await p.evaluate(() => { const { g, F } = Y.toBoss(['infantry', 'heavy', 'medic', 'sniper', 'commando', 'demolitions']); F.shoot = () => {}; const c = { x: 4150, y: 1450 }; T.stepUntil(() => !!F.mortar, 14, () => { T.pinAt(c); g.cam = { ...c }; Y.skip(); }); T.step(0.6, () => { T.pinAt(c); g.cam = { ...c }; }); window.__render(); });
    await p.waitForTimeout(200);
    const M = await p.evaluate(() => { const vw = innerWidth, vh = innerHeight, b = document.querySelector('#bossbar .ob-state').getBoundingClientRect(); return { inside: b.left >= 0 && b.right <= vw && b.top >= 0 && b.bottom <= vh, text: document.querySelector('#bossbar .ob-state').textContent, topThird: b.bottom <= vh / 3 }; });
    if (OUT) await p.screenshot({ path: `${OUT}/v09d1-${dev.name}-mortar.png` });
    check(`F3 ${dev.name}: the mortar warning is on screen in the top third (clear of the squad in the middle)`, M.inside && M.topThird && /MORTAR/.test(M.text), JSON.stringify(M));
    await p.context().close();
  }

  // ================= G. VERSION, SAVE, BASE =================
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const saveSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'save.ts'), 'utf8');
  check('G1 package 0.9.6 / label 0.9D.1 or a later release (v0.9D.2: 0.9.7, checked by v09d2 / package.json); SAVE_VERSION 9 (nothing new is saved: the details / objectives states are per screen and per mission)', pkg.version >= '0.9.6' && /^0\.9(D\.\d|E)/.test(pkg.versionLabel) && /SAVE_VERSION = 9;/.test(saveSrc), `${pkg.version} ${pkg.versionLabel}`);
  if (BASE) {
    const pb = await openPage(browser, BASE, { seed: 4242 }), pn = await openPage(browser, URL, { seed: 4242 });
    const before = await pb.evaluate(missionSnapshot), nowS = await pn.evaluate(missionSnapshot);
    await pb.context().close(); await pn.context().close();
    const cfgDiff = Object.keys(nowS.cfg).filter((k) => nowS.cfg[k] !== before.cfg[k]);
    check('G2 every CFG group identical to v0.9D but the two new groups (formation, warlordResponse)', cfgDiff.sort().join() === [...V09D1.cfgGroups].sort().join() && V09D1.cfgGroups.every((k) => before.cfg[k] === undefined), cfgDiff.join() || 'none');
    const ids = Object.keys(before.missions), misDiff = ids.filter((id) => before.missions[id] !== nowS.missions[id]);
    check('G3 all 20 missions identical to v0.9D (maps, enemies, objectives, extraction, story, campaign rows)', ids.length === 20 && misDiff.length === 0, misDiff.join() || `${ids.length} missions`);
  } else check('G2 BASE build available', false, 'BASE not set (npm test serves v0.9D)');

  await page.context().close();
  await browser.close();
  return finish([...errors, ...page.errors]);

});
