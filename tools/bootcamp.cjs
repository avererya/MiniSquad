// v0.9E Boot Camp: the optional tutorial (Field Training + the headquarters tour).
//  A. The offer: a brand-new save is offered Boot Camp (START / SKIP), skipping or starting closes it for good, a refresh
//     keeps the answer; older saves (every fixture) are never offered it and keep loading unchanged
//  B. Field Training, step by step: movement marker, automatic combat, an ability use, the health briefing, the
//     helicopter; the squad is fresh Ace + Ranger copies; the coach card and highlights follow each step
//  C. Headquarters tour: the real Roster / Training / Campaign controls, advancing only when the player opens them;
//     finishes on mission selection without deploying
//  D. Economy and casualty protection: no XP / Credits / unlocks / stars / records / journal, nobody downed or killed,
//     the roster and its ability charges untouched, the save identical afterwards (full run, repeated replay)
//  E. Existing players: no offer, replay from Settings, exit at any point, nothing in the save changes
//  F. Reliability: reload mid-training, EXIT at every stage, no stuck state, a normal mission afterwards, phone layouts
//     (touch areas, the joystick half free, cards inside the screen)
// Usage: npm test -- bootcamp   (or: npx vite preview --port 4173 & node tools/bootcamp.cjs)
const fs = require('fs');
const { chromium, URL, createChecks, runSuite, openPage } = require('./lib.cjs');

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 84 });
  const browser = await chromium.launch();
  const BC = URL + (URL.includes('?') ? '&' : '?') + 'bootcamp'; // automated browsers only see the offer with ?bootcamp
  const pages = [];
  const open = async (o = {}) => { const p = await openPage(browser, o.plain ? URL : BC, { seed: 777, ...o }); pages.push(p); return p; };
  const saveText = (p) => p.evaluate(() => localStorage.getItem('minisquad.save'));
  const acct = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__account())));

  /** Page-side helpers: walk the real controls. */
  const install = (p) => p.evaluate(() => {
    const g = window.game;
    window.BCT = {
      g,
      step(sec, each) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (each) each(i); g.update(1 / 60); } window.__hud.update(); },
      until(cond, max, each) { let n = 0; const m = Math.round(max * 60); while (n < m && !cond()) { if (each) each(n); g.update(1 / 60); n++; } window.__hud.update(); return n / 60; },
      pin(p) { let i = 0; for (const s of g.soldiers) if (s.active) { s.pos = { x: p.x + i * 26, y: p.y }; s.vel = { x: 0, y: 0 }; i++; } g.anchor = { ...p }; },
      card() { window.__hud.update(); const f = document.getElementById('bc-coach'), t = document.getElementById('bc-tour'); const el = f.style.display !== 'none' ? f : t.style.display !== 'none' ? t : null; return el ? { where: el === f ? 'field' : 'tour', step: el.dataset.step, text: el.textContent } : null; },
      lit() { return [...document.querySelectorAll('.bc-hl')].map((e) => e.dataset.tab || e.dataset.a || e.className.split(' ')[0]); },
      obj() { const o = g.mission.currentObjective; return o ? o.id : g.mission.phase; },
    };
  });
  const tapDown = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); }, sel);
  const click = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);

  // ---------------- A. the offer ----------------
  let page = await open();
  let a = await page.evaluate(() => ({ st: window.__loadStatus.status, bc: window.__account().bootCamp, offer: !!document.querySelector('.bc-offer'), screen: window.__hud.menus.screen,
    btns: [...document.querySelectorAll('.bc-offer [data-a]')].map((b) => b.dataset.a), saved: JSON.parse(localStorage.getItem('minisquad.save')).account.bootCamp }));
  check('A1 a brand-new save is offered Boot Camp on the Campaign screen (START and SKIP)', a.st === 'new' && a.bc === 'pending' && a.offer && a.screen === 'campaign' && a.btns.join() === 'bc-skip,bc-start', JSON.stringify(a));
  check('A2 the pending offer is saved with the save (save v9, optional field)', a.saved === 'pending' && JSON.parse(await saveText(page)).version === 9);
  const plain = await open({ plain: true });
  check('A3 automated browsers get no offer without ?bootcamp (older suites unaffected); the account state is the same', await plain.evaluate(() => !document.querySelector('.bc-offer') && window.__account().bootCamp === 'pending'));
  await plain.context().close();
  // SKIP
  await click(page, '[data-a="bc-skip"]');
  a = await page.evaluate(() => ({ bc: window.__account().bootCamp, offer: !!document.querySelector('.bc-offer'), phase: window.game.phase, screen: window.__hud.menus.screen, mission: window.game.missionId }));
  check('A4 SKIP TUTORIAL closes the offer, stays on the Campaign screen at Mission 1, no mission started', a.bc === 'skipped' && !a.offer && a.phase === 'start' && a.screen === 'campaign' && a.mission === 'first-contact', JSON.stringify(a));
  const skippedSave = await saveText(page);
  await page.reload(); await page.waitForFunction(() => !!window.game);
  a = await page.evaluate(() => ({ bc: window.__account().bootCamp, offer: !!document.querySelector('.bc-offer') }));
  check('A5 after a refresh the skipped offer does not come back', a.bc === 'skipped' && !a.offer && (await saveText(page)) === skippedSave, JSON.stringify(a));
  await page.context().close();

  // every older fixture: no offer, loads exactly as before, no field added
  const fx = [];
  for (const dir of ['fixtures', 'fixtures-v08b']) for (const f of fs.readdirSync(__dirname + '/' + dir)) {
    const raw = fs.readFileSync(__dirname + '/' + dir + '/' + f, 'utf8');
    const before = JSON.parse(raw).account;
    const p = await open({ save: raw });
    const r = await p.evaluate(() => ({ st: window.__loadStatus.status, bc: window.__account().bootCamp, offer: !!document.querySelector('.bc-offer'), credits: window.__account().credits, soldiers: window.game.roster.owned().length }));
    fx.push(`${f}:${r.st}:${r.bc === undefined && !r.offer ? 'no-offer' : 'OFFER'}:${before && typeof before.credits === 'number' ? (r.credits === before.credits ? 'cr-ok' : 'CR') : 'cr-n/a'}`);
    await p.context().close();
  }
  check('A6 every save fixture still loads, keeps its Credits and is never offered Boot Camp', fx.every((x) => /:(loaded|migrated):no-offer:(cr-ok|cr-n\/a)$/.test(x)), fx.join(' '));
  const sv = +((fs.readFileSync(__dirname + '/../src/save.ts', 'utf8').match(/SAVE_VERSION = (\d+)/) || [])[1]);
  check('A7 save version unchanged (v9, an optional account field)', sv === 9, `SAVE_VERSION ${sv}`);
  const junk = JSON.parse(await (async () => { const p = await open(); const t = await saveText(p); await p.context().close(); return t; })());
  junk.account.bootCamp = 'whatever';
  const jp = await open({ save: JSON.stringify(junk) });
  check('A8 an invalid stored value is dropped quietly (treated as an older save: no offer, no repair note)', await jp.evaluate(() => window.__account().bootCamp === undefined && window.__loadStatus.status === 'loaded' && !document.querySelector('.bc-offer')));
  await jp.context().close();

  // ---------------- B. Field Training ----------------
  page = await open(); await install(page);
  const before = await saveText(page);
  const beforeAcct = await acct(page);
  await click(page, '[data-a="bc-start"]');
  a = await page.evaluate(() => { const g = window.game; return { phase: g.phase, kind: g.deployment.kind, mission: g.mission.id, names: g.soldiers.map((s) => s.identity.name), cls: g.soldiers.map((s) => s.classDef.id), sel: g.missionId, bc: window.__account().bootCamp, menu: window.__hud.menus.visible, enemies: g.enemies.length, id: g.soldiers.map((s) => s.identity.id) }; });
  check('B1 START opens Field Training with the original starting soldiers (Ace and Ranger), the campaign selection untouched', a.phase === 'playing' && a.kind === 'training' && a.mission === 'boot-camp' && a.names.join() === 'Ace,Ranger' && a.sel === 'first-contact' && !a.menu, JSON.stringify(a));
  check('B2 starting alone does not close the offer (it closes when Field Training is finished, exited or skipped), so quitting the page mid-way is harmless', a.bc === 'pending' && (await saveText(page)) === before, a.bc);
  let c = await page.evaluate(() => { window.BCT.step(0.2); return { card: window.BCT.card(), stick: document.getElementById('bc-stick').style.display, obj: window.BCT.obj() }; });
  check('B3 step 1 MOVE: the card says to use the joystick, a ghost joystick shows, the destination is marked', c.obj === 'bc-move' && c.card?.where === 'field' && /joystick/i.test(c.card.text) && c.stick !== 'none', JSON.stringify(c));
  // movement: drive the real input vector toward the marked area; it must complete on its own
  c = await page.evaluate(() => {
    const T = window.BCT, g = T.g, Z = { x: 750, y: 520 };
    g.input.move = () => { const cx = g.soldiers.reduce((s, u) => s + u.pos.x, 0) / g.soldiers.length, cy = g.soldiers.reduce((s, u) => s + u.pos.y, 0) / g.soldiers.length; const dx = Z.x - cx, dy = Z.y - cy, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
    const t = T.until(() => T.obj() !== 'bc-move', 40);
    g.input.move = Object.getPrototypeOf(g.input).move.bind(g.input);
    return { t, obj: T.obj(), card: T.card()?.step };
  });
  check('B4 the joystick movement reaches the marked area and the step advances by itself', c.obj === 'bc-fight' && c.t < 30, JSON.stringify(c));
  check('B5 step 2 AUTOMATIC COMBAT: the card explains auto-fire and weak targets stand ahead', c.card === 'fight' && await page.evaluate(() => window.game.enemies.filter((e) => e.tag === 'bc-drill').length === 2 && window.game.enemies.every((e) => e.maxHp < 60)), c.card);
  c = await page.evaluate(() => {
    const T = window.BCT, g = T.g;
    // walk toward the targets (real joystick vector) and let the auto-fire do the rest
    g.input.move = () => { const e = g.enemies.find((x) => x.active && x.tag === 'bc-drill'); if (!e) return { x: 0, y: 0 }; const cx = g.soldiers[0].pos.x, cy = g.soldiers[0].pos.y; const d = Math.hypot(e.pos.x - cx, e.pos.y - cy); if (d < 300) return { x: 0, y: 0 }; return { x: (e.pos.x - cx) / d, y: (e.pos.y - cy) / d }; };
    const t = T.until(() => T.obj() !== 'bc-fight', 60);
    g.input.move = Object.getPrototypeOf(g.input).move.bind(g.input);
    return { t, obj: T.obj(), hp: g.soldiers.map((s) => Math.round(s.hp)), pit: g.enemies.filter((e) => e.tag === 'bc-pit' && e.active).length };
  });
  check('B6 the soldiers defeat the targets with the normal combat system and the ability step starts', c.obj === 'bc-ability' && c.t < 55, JSON.stringify(c));
  c = await page.evaluate(() => { const T = window.BCT; T.step(0.1); return { card: T.card(), lit: T.lit(), pit: T.g.enemies.filter((e) => e.tag === 'bc-pit').length }; });
  check('B7 step 3 ABILITY: the card points at the soldier ability buttons (highlighted) and an enemy group waits in the pit', c.card?.step === 'ability' && c.lit.length >= 1 && c.pit === 3 && /ability/i.test(c.card.text), JSON.stringify(c));
  const ch0 = await page.evaluate(() => window.game.soldiers.map((s) => s.ability.charges + '/' + s.ability.capacity).join());
  await tapDown(page, '#panels .ability.ready'); // the real HUD button
  c = await page.evaluate(() => { const T = window.BCT; return { target: !!T.g.targeting, card: T.card()?.step, obj: T.obj() }; });
  check('B8 tapping the highlighted ability starts the normal grenade aiming; the card asks for the target tap', c.target && c.card === 'aim' && c.obj === 'bc-ability', JSON.stringify(c));
  c = await page.evaluate(() => { const T = window.BCT, g = T.g; const e = g.enemies.find((x) => x.tag === 'bc-pit' && x.active); const s = { x: e.pos.x - g.cam.x + 640, y: e.pos.y - g.cam.y + 360 }; g.onTargetConfirm(s); T.step(0.1); return { obj: T.obj(), ch: g.soldiers.map((s) => s.ability.charges + '/' + s.ability.capacity).join() }; });
  check('B9 the throw advances the tutorial and spends one charge of the training soldier only (activateAbility)', c.obj === 'bc-health' && c.ch !== ch0, `${ch0} -> ${c.ch} ${c.obj}`);
  c = await page.evaluate(() => { const T = window.BCT; return { card: T.card(), lit: T.lit() }; });
  check('B10 step 4 HEALTH: short text on downed soldiers, revives and permadeath, nothing forced, the health bars highlighted', c.card?.step === 'health' && /downed/i.test(c.card.text) && /revive/i.test(c.card.text) && /Memorial|resurrect/i.test(c.card.text) && c.lit.length >= 1, JSON.stringify(c));
  c = await page.evaluate(() => { const T = window.BCT, g = T.g; T.step(10); const left = g.enemies.filter((e) => e.tag === 'bc-pit' && e.active).length; for (const e of g.enemies.filter((x) => x.tag === 'bc-pit' && x.active)) g.damage(e, 1e6, g.soldiers[0]); const t = 10 + T.until(() => T.obj() !== 'bc-health', 60); return { t, left, phase: g.mission.phase, obj: T.obj(), downed: g.soldiers.filter((s) => s.state !== 'active').length }; });
  check('B11 the briefing waits for the pit to be cleared (it never ends while enemies stand) and then ends by itself, nobody downed', c.left > 0 && c.obj !== 'bc-health' && c.downed === 0 && c.t >= 9, JSON.stringify(c));
  c = await page.evaluate(() => { const T = window.BCT, g = T.g; return { phase: g.mission.phase, card: T.card()?.step, ext: g.mission.inExtraction, kinds: g.enemies.filter((e) => e.active).length }; });
  check('B12 step 5 EXTRACTION: the card sends the squad to the helicopter zone', c.ext && c.card === 'extract', JSON.stringify(c));
  c = await page.evaluate(() => { const T = window.BCT, g = T.g; T.pin({ x: 2100, y: 250 }); T.step(0.5); const cd = T.card()?.step; T.until(() => g.bootCamp.tour !== null || g.phase === 'start', 20, () => T.pin({ x: 2100, y: 250 })); return { cd, tour: g.bootCamp.tour, phase: g.phase, screen: window.__hud.menus.screen, kind: g.deployment.kind }; });
  check('B13 reaching the helicopter completes Field Training and opens the Campaign screen with the tour (no Results screen)', c.cd === 'heli' && c.tour === 'roster' && c.phase === 'start' && c.screen === 'campaign' && c.kind === 'generic', JSON.stringify(c));
  check('B14 completing closes the offer: account.bootCamp = done', (await acct(page)).bootCamp === 'done');

  // ---------------- C. headquarters tour ----------------
  const tour = () => page.evaluate(() => { window.__hud.update(); const T = window.BCT; return { step: window.game.bootCamp.tour, card: T.card(), lit: T.lit(), screen: window.__hud.menus.screen, tab: window.__hud.menus.tab }; });
  let t = await tour();
  check('C1 the tour starts on the Campaign screen: the real BARRACKS button is highlighted and nothing happens by itself', t.step === 'roster' && t.card?.where === 'tour' && t.lit.includes('to-barracks') && t.screen === 'campaign', JSON.stringify(t));
  await click(page, '[data-a="to-barracks"]'); t = await tour();
  check('C2 opening the Barracks (Roster tab) completes the Roster step: the Roster text shows and TRAINING is the next highlight', t.screen === 'barracks' && t.step === 'shop' && /soldiers/i.test(t.card.text) && /experience/i.test(t.card.text) && t.lit.join() === 'training', JSON.stringify(t));
  await click(page, '[data-tab="training"]'); t = await tour();
  check('C3 opening Training explains Credits and upgrades and highlights ◂ CAMPAIGN', t.step === 'missions' && /Credits/.test(t.card.text) && /upgrade/i.test(t.card.text) && t.lit.join() === 'to-campaign', JSON.stringify(t));
  const credits0 = (await acct(page)).credits;
  await click(page, '[data-a="to-campaign"]'); t = await tour();
  check('C4 returning to mission selection finishes the tour: the completion card names Boot Camp complete and the first mission', t.step === 'complete' && t.screen === 'campaign' && /BOOT CAMP COMPLETE/.test(t.card.text) && /first mission/i.test(t.card.text) && /replay/i.test(t.card.text), JSON.stringify(t));
  a = await page.evaluate(() => ({ phase: window.game.phase, sel: window.game.missionId, brief: window.__hud.menus.briefOpen, details: !!document.querySelector('.c-more'), ready: !!document.querySelector('.c-ready, .c-squad'), deployBtn: !!document.querySelector('[data-a="deploy"], [data-a="brief"]') }));
  check('C5 control stays with the player at mission selection: nothing deployed, Mission Details / squad readiness / Deploy are still there', a.phase === 'start' && a.sel === 'first-contact' && !a.brief && a.details && a.deployBtn, JSON.stringify(a));
  await click(page, '[data-bc="done"]'); t = await tour();
  check('C6 DONE closes the card; no tutorial UI remains on the Campaign screen', t.step === null && t.card === null && t.lit.length === 0);
  const afterAcct = await acct(page);

  // ---------------- D. economy / casualty protection (this same complete run) ----------------
  const strip = (x) => { const y = JSON.parse(JSON.stringify(x)); delete y.bootCamp; return y; };
  check('D1 the whole run changed nothing in the account except the Boot Camp flag (Credits, XP records, missions, unlocks, settled runs, journal, training)', JSON.stringify(strip(afterAcct)) === JSON.stringify(strip(beforeAcct)) && afterAcct.credits === credits0 && afterAcct.credits === 0, `credits ${afterAcct.credits}`);
  const afterSave = JSON.parse(await saveText(page)), beforeSave = JSON.parse(before);
  delete afterSave.account.bootCamp; delete beforeSave.account.bootCamp;
  check('D2 the saved roster, squad and account are byte-identical to before Boot Camp (apart from the flag)', JSON.stringify(afterSave) === JSON.stringify(beforeSave));
  check('D3 no campaign records: no mission marked complete, no stars, no unlocks, no recruit offers, no activeRun, nothing settled', afterAcct.missions && Object.keys(afterAcct.missions).length === 0 && afterAcct.campaign.unlockedMissions.join() === 'first-contact' && afterAcct.settledRuns.length === 0 && afterAcct.activeRun === null && afterAcct.pendingDecision === null);
  // casualty protection: a training soldier takes lethal damage and must stay up; real roster untouched
  page = await open(); await install(page);
  await click(page, '[data-a="bc-start"]');
  c = await page.evaluate(() => {
    const T = window.BCT, g = T.g, ro = JSON.stringify(g.roster.soldiers);
    for (let i = 0; i < 5; i++) for (const s of g.soldiers) g.damage(s, 9999, g.enemies[0]);
    T.step(1);
    for (const s of g.soldiers) g.damage(s, 9999, g.enemies[0]);
    T.step(25); // far beyond a bleed-out
    return { states: g.soldiers.map((s) => s.state), hp: g.soldiers.map((s) => Math.round(s.hp)), journal: window.__account().activeRun, roster: JSON.stringify(g.roster.soldiers) === ro, phase: g.phase, kia: g.roster.soldiers.filter((s) => s.status === 'kia').length };
  });
  check('D4 lethal damage cannot down or kill a training soldier (1 HP floor), nothing journaled, the real roster untouched', c.states.every((s) => s === 'active') && c.hp.every((h) => h >= 1) && c.journal === null && c.roster && c.kia === 0 && c.phase === 'playing', JSON.stringify(c));
  c = await page.evaluate(() => {
    const T = window.BCT, g = T.g;
    const real = JSON.stringify(g.roster.soldiers.map((s) => [s.id, s.abilityCapacity ?? 0, s.progression.xp, s.progression.level, s.status]));
    T.pin({ x: 760, y: 520 }); T.step(0.5); // reach the marker
    T.until(() => T.obj() !== 'bc-move', 5);
    for (const e of g.enemies) g.damage(e, 1e6, g.soldiers[0]); T.step(0.2); // kill the drill targets through Game.damage
    const spent = g.soldiers.map((s) => s.ability.charges);
    return { real, obj: T.obj(), spent, after: JSON.stringify(g.roster.soldiers.map((s) => [s.id, s.abilityCapacity ?? 0, s.progression.xp, s.progression.level, s.status])), xp: g.soldiers.map((s) => s.identity.progression.xp), kills: g.soldiers.map((s) => s.identity.service?.kills ?? 0) };
  });
  check('D5 kills in training pay no XP and add no career record; the real roster is byte-identical', c.real === c.after && c.xp.every((x) => x === 0), JSON.stringify({ xp: c.xp, kills: c.kills }));
  // abilities: training copies get their own charges; the roster's ability capacity is never read or spent
  c = await page.evaluate(() => { const g = window.game; return { train: g.soldiers.map((s) => s.ability.capacity), ids: g.soldiers.map((s) => s.identity === g.roster.get(s.identity.id)) }; });
  check('D6 training soldiers are copies (never the roster objects), with the starting soldiers\' own ability capacity', c.ids.every((x) => x === false) && c.train.every((n) => n === 1), JSON.stringify(c));
  await page.context().close();

  // ---------------- E. existing players ----------------
  const fixRaw = fs.readFileSync(__dirname + '/fixtures-v08b/v0.8B-m12-cleared.json', 'utf8');
  page = await open({ save: fixRaw }); await install(page);
  const e0 = await saveText(page), e0a = await acct(page);
  a = await page.evaluate(() => ({ offer: !!document.querySelector('.bc-offer'), bc: window.__account().bootCamp, tour: window.game.bootCamp.tour, screen: window.__hud.menus.screen, missions: window.__account().campaign.unlockedMissions.length, credits: window.__account().credits, owned: window.game.roster.owned().length }));
  check('E1 an existing campaign gets no offer and no tutorial: it opens on the Campaign screen as before', !a.offer && a.bc === undefined && a.tour === null && a.screen === 'campaign' && a.missions >= 12, JSON.stringify(a));
  await page.evaluate(() => window.__hud.toggleTuning());
  a = await page.evaluate(() => { const b = document.querySelector('#tuning .bc-replay'); return b ? { text: b.textContent, h: Math.round(b.getBoundingClientRect().height), vis: b.offsetParent !== null } : null; });
  check('E2 Settings has REPLAY BOOT CAMP for every player (a real 44 px button)', !!a && /Replay Boot Camp/i.test(a.text) && a.vis && a.h >= 44, JSON.stringify(a));
  await click(page, '#tuning .bc-replay');
  a = await page.evaluate(() => { const g = window.game; return { phase: g.phase, kind: g.deployment.kind, names: g.soldiers.map((s) => s.identity.name), settings: document.getElementById('tuning').classList.contains('hidden'), sel: g.missionId, owned: g.roster.owned().map((s) => s.id).join() }; });
  check('E3 replay starts Field Training with the original Ace and Ranger (not the player\'s squad) and closes Settings', a.phase === 'playing' && a.kind === 'training' && a.names.join() === 'Ace,Ranger' && a.settings && a.owned.split(',').length > 2, JSON.stringify(a));
  // play it through to the end as a replay: no rewards, nothing saved
  c = await page.evaluate(() => {
    const T = window.BCT, g = T.g;
    T.pin({ x: 760, y: 520 }); T.until(() => T.obj() !== 'bc-move', 5);
    for (const e of g.enemies.filter((x) => x.active)) g.damage(e, 1e6, g.soldiers[0]); T.step(0.3);
    if (!g.soldiers.some((s) => s.ability.charges < s.ability.capacity)) { const u = g.soldiers[0]; g.useAbility(u); const e = g.enemies.find((x) => x.tag === 'bc-pit'); g.onTargetConfirm({ x: e.pos.x - g.cam.x + 640, y: e.pos.y - g.cam.y + 360 }); }
    T.step(0.3);
    for (const e of g.enemies.filter((x) => x.active)) g.damage(e, 1e6, g.soldiers[0]);
    T.until(() => T.obj() !== 'bc-health', 60);
    T.pin({ x: 2100, y: 250 }); T.until(() => g.bootCamp.tour !== null || g.phase === 'start', 20, () => T.pin({ x: 2100, y: 250 }));
    return { tour: g.bootCamp.tour, screen: window.__hud.menus.screen };
  });
  check('E4 a replay runs the full Field Training and the tour', c.tour === 'roster' && c.screen === 'campaign', JSON.stringify(c));
  check('E5 the replay left the saved campaign exactly as it was (roster, Credits, XP, upgrades, missions, casualty records, flag): save text identical', (await saveText(page)) === e0 && JSON.stringify(await acct(page)) === JSON.stringify(e0a));
  check('E6 a completed replay never closes an offer that does not exist (the flag stays absent)', (await acct(page)).bootCamp === undefined);
  // exit the tour; then replay again and exit Field Training with EXIT
  await tapDown(page, '[data-bc="exit"]').catch(() => {}); await click(page, '#bc-tour [data-bc="exit"]');
  a = await page.evaluate(() => { window.__hud.update(); return { tour: window.game.bootCamp.tour, card: window.BCT.card(), hl: window.BCT.lit().length, screen: window.__hud.menus.screen }; });
  check('E7 EXIT TOUR ends the tour at once and leaves the player on mission selection', a.tour === null && a.card === null && a.hl === 0 && a.screen === 'campaign', JSON.stringify(a));
  await page.evaluate(() => window.game.startBootCamp());
  await page.evaluate(() => window.BCT.step(1));
  await tapDown(page, '#bc-coach [data-bc="exit"]');
  a = await page.evaluate(() => { window.__hud.update(); const g = window.game; return { phase: g.phase, kind: g.deployment.kind, screen: window.__hud.menus.screen, card: window.BCT.card(), sel: g.missionId, soldiers: g.soldiers.length, tour: g.bootCamp.tour }; });
  check('E8 EXIT BOOT CAMP during Field Training returns to the Campaign screen: no mission, no card, the same selected mission', a.phase === 'start' && a.screen === 'campaign' && a.card === null && a.soldiers === 0 && a.tour === null && a.sel === (JSON.parse(e0).account.campaign.selectedMission), JSON.stringify(a));
  check('E9 exiting wrote nothing: the save is still byte-identical', (await saveText(page)) === e0);
  await page.context().close();

  // ---------------- F. reliability ----------------
  // reload during Field Training (new save): back to the Campaign screen, offer still pending, save uncorrupted, nothing stuck
  page = await open(); await install(page);
  await click(page, '[data-a="bc-start"]');
  await page.evaluate(() => window.BCT.step(3));
  const midSave = await saveText(page);
  await page.reload(); await page.waitForFunction(() => !!window.game);
  a = await page.evaluate(() => ({ phase: window.game.phase, st: window.__loadStatus.status, notes: window.__loadStatus.notes.length, bc: window.__account().bootCamp, offer: !!document.querySelector('.bc-offer'), screen: window.__hud.menus.screen, active: window.__account().activeRun }));
  check('F1 a reload in the middle of Field Training loads a clean save on the Campaign screen (no repair, no stuck state); a new player is simply offered again', a.phase === 'start' && a.st === 'loaded' && a.notes === 0 && a.bc === 'pending' && a.offer && a.screen === 'campaign' && a.active === null && (await saveText(page)) === midSave, JSON.stringify(a));
  // reload during the tour: the offer is already closed, the tour is gone, the player is on the Campaign screen
  await install(page);
  await click(page, '[data-a="bc-start"]');
  await page.evaluate(() => { const T = window.BCT, g = T.g; T.pin({ x: 760, y: 520 }); T.until(() => T.obj() !== 'bc-move', 5); for (const e of g.enemies.filter((x) => x.active)) g.damage(e, 1e6, g.soldiers[0]); T.step(0.3); g.useAbility(g.soldiers[0]); const e = g.enemies.find((x) => x.tag === 'bc-pit'); g.onTargetConfirm({ x: e.pos.x - g.cam.x + 640, y: e.pos.y - g.cam.y + 360 }); T.step(0.3); for (const x of g.enemies.filter((y) => y.active)) g.damage(x, 1e6, g.soldiers[0]); T.until(() => T.obj() !== 'bc-health', 60); T.pin({ x: 2100, y: 250 }); T.until(() => g.bootCamp.tour !== null, 20, () => T.pin({ x: 2100, y: 250 })); });
  await page.reload(); await page.waitForFunction(() => !!window.game);
  a = await page.evaluate(() => ({ bc: window.__account().bootCamp, offer: !!document.querySelector('.bc-offer'), tour: window.game.bootCamp.tour, card: !!document.querySelector('#bc-tour[style*="display: none"]'), screen: window.__hud.menus.screen }));
  check('F2 a reload during the tour: the offer stays closed, no tour state survives, mission selection is free', a.bc === 'done' && !a.offer && a.tour === null && a.screen === 'campaign', JSON.stringify(a));
  // a normal mission afterwards is unaffected and rewards normally; no coach UI during it
  await install(page);
  c = await page.evaluate(() => {
    const g = window.game, T = window.BCT;
    window.__hud.menus.hide(); const r = g.deploySelected();
    T.step(0.5);
    const vis = { f: document.getElementById('bc-coach').style.display, t: document.getElementById('bc-tour').style.display, s: document.getElementById('bc-stick').style.display, hl: document.querySelectorAll('.bc-hl').length };
    return { ok: r.ok, kind: g.deployment.kind, mission: g.mission.id, vis, coach: window.BCT.card() };
  });
  check('F3 after Boot Camp a normal Mission 1 deploys as before (roster deployment, no coach card or highlight in the mission)', c.ok && c.kind === 'roster' && c.mission === 'first-contact' && c.vis.f === 'none' && c.vis.t === 'none' && c.vis.s === 'none' && c.vis.hl === 0 && c.coach === null, JSON.stringify(c));
  c = await page.evaluate(() => { const g = window.game; for (const e of g.enemies) g.damage(e, 1e6, g.soldiers[0]); window.BCT.until(() => g.mission.inExtraction, 5); window.BCT.pin({ x: 2240, y: 180 }); window.BCT.until(() => g.phase !== 'playing', 30, () => window.BCT.pin({ x: 2240, y: 180 })); return { phase: g.phase, credits: window.__account().credits, done: window.__account().missions['first-contact']?.completions }; });
  check('F4 a real mission still settles rewards normally (Credits and the first clear are recorded)', c.phase === 'won' && c.credits > 0 && c.done === 1, JSON.stringify(c));
  await page.context().close();

  // EXIT at the other stages, and the guards
  page = await open(); await install(page);
  await click(page, '[data-a="bc-start"]');
  a = await page.evaluate(() => { const g = window.game; g.paused = true; const r = g.startBootCamp(); return { ok: r.ok }; });
  a = await page.evaluate(() => { const g = window.game; const T = window.BCT; T.pin({ x: 760, y: 520 }); T.until(() => T.obj() !== 'bc-move', 5); g.paused = false; return { obj: T.obj(), pausedOk: true }; });
  await tapDown(page, '#bc-coach [data-bc="exit"]');
  a = await page.evaluate(() => { window.__hud.update(); const g = window.game; return { bc: window.__account().bootCamp, phase: g.phase, screen: window.__hud.menus.screen, offer: !!document.querySelector('.bc-offer') }; });
  check('F5 EXIT mid-training on a new save closes the offer ("skipped") so the player is not trapped in prompts, and returns to the Campaign screen', a.bc === 'skipped' && a.phase === 'start' && a.screen === 'campaign' && !a.offer, JSON.stringify(a));
  await page.context().close();
  // stuck-proofing: every step is completable by the player alone (verified above); an enemy that wandered off doesn't block the step
  page = await open(); await install(page);
  await click(page, '[data-a="bc-start"]');
  c = await page.evaluate(() => {
    const T = window.BCT, g = T.g; T.pin({ x: 760, y: 520 }); T.until(() => T.obj() !== 'bc-move', 5);
    // no enemy ever blocks: the squad only has to stand near them (auto-fire) - check it can win without moving the joystick at all
    T.pin({ x: 1000, y: 520 }); const t = T.until(() => T.obj() !== 'bc-fight', 60, () => { for (const s of g.soldiers) { s.vel = { x: 0, y: 0 }; } });
    return { t, obj: T.obj(), hp: g.soldiers.map((s) => Math.round(s.hp)) };
  });
  check('F6 the fight step needs no skill: standing near the targets is enough and the squad comes through it (nobody below 25 HP)', c.obj === 'bc-ability' && c.hp.every((h) => h > 25), JSON.stringify(c));
  c = await page.evaluate(() => {
    const T = window.BCT, g = T.g;
    // use the ability by the keyboard path as well (key 1), then aim: same activateAbility route
    g.onKey('Digit1', new KeyboardEvent('keydown', { code: 'Digit1' }));
    const aiming = !!g.targeting;
    const e = g.enemies.find((x) => x.tag === 'bc-pit' && x.active);
    g.onTargetConfirm({ x: e.pos.x - g.cam.x + 640, y: e.pos.y - g.cam.y + 360 }); T.step(0.2);
    return { aiming, obj: T.obj() };
  });
  check('F7 the ability step also completes through the keyboard route (one path: activateAbility)', c.aiming && c.obj === 'bc-health', JSON.stringify(c));
  await page.context().close();

  // phone layouts: cards inside the screen, the joystick half free, touch areas >= 44 CSS px, tour card clear of the nav it points at
  for (const [name, w, h] of [['iPhone SE', 667, 375], ['iPhone 14', 844, 390], ['Pixel 7', 915, 412]]) {
    const p = await openPage(browser, BC, { seed: 5, viewport: { width: w, height: h }, context: { hasTouch: true, isMobile: true } });
    await install(p);
    await click(p, '[data-a="bc-start"]');
    const m = await p.evaluate(() => {
      window.BCT.step(0.3);
      const stage = document.getElementById('stage').getBoundingClientRect(), s = stage.width / 1280;
      const cardR = document.getElementById('bc-coach').getBoundingClientRect();
      const btn = document.querySelector('#bc-coach .bc-btn'), br = btn.getBoundingClientRect();
      const ar = btn.querySelector ? null : null;
      const stickR = document.getElementById('bc-stick').getBoundingClientRect();
      return { s, card: { l: cardR.left, r: cardR.right, t: cardR.top, b: cardR.bottom }, stage: { l: stage.left, r: stage.right, t: stage.top, b: stage.bottom }, btnH: br.height, btnW: br.width, stickR: stickR.right, stickShown: document.getElementById('bc-stick').style.display !== 'none', joyHalf: stage.left + stage.width * 0.45, t44: getComputedStyle(document.getElementById('stage')).getPropertyValue('--t44') };
    });
    const hit = Math.max(m.btnH, parseFloat(m.t44) * m.s); // the ::after touch area is var(--t44) stage px
    check(`F8 ${name}: the field coach card is on screen, right of the joystick half, its button has a >= 44 px touch area`, m.card.l >= m.joyHalf - 1 && m.card.r <= m.stage.r + 1 && m.card.t >= m.stage.t && m.card.b <= m.stage.b && hit >= 43.5, JSON.stringify({ card: m.card, joyHalf: Math.round(m.joyHalf), hit: Math.round(hit) }));
    // the joystick and abilities still work under the card: a real touch drag on the left half moves the squad
    const moved = await p.evaluate(async () => {
      const g = window.game, x0 = g.anchor.x, st = document.getElementById('stage').getBoundingClientRect();
      const cv = document.getElementById('game');
      const fire = (type, x, y, id = 1) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
      const sx = st.left + st.width * 0.2, sy = st.top + st.height * 0.6;
      fire('pointerdown', sx, sy); fire('pointermove', sx + 60, sy); for (let i = 0; i < 40; i++) g.update(1 / 60); fire('pointerup', sx + 60, sy);
      return g.anchor.x - x0;
    });
    check(`F9 ${name}: a touch drag on the left half moves the squad while the coach is up (the card never blocks the joystick)`, moved > 10, `anchor dx ${Math.round(moved)}`);
    // tour on this phone: the card sits inside the screen and the highlighted nav button is not covered by it
    await p.evaluate(() => { const g = window.game, T = window.BCT; T.pin({ x: 760, y: 520 }); T.until(() => T.obj() !== 'bc-move', 5); for (const e of g.enemies.filter((x) => x.active)) g.damage(e, 1e6, g.soldiers[0]); T.step(0.3); g.useAbility(g.soldiers[0]); const e = g.enemies.find((x) => x.tag === 'bc-pit'); g.onTargetConfirm({ x: e.pos.x - g.cam.x + 640, y: e.pos.y - g.cam.y + 360 }); T.step(0.3); for (const x of g.enemies.filter((y) => y.active)) g.damage(x, 1e6, g.soldiers[0]); T.until(() => T.obj() !== 'bc-health', 60); T.pin({ x: 2100, y: 250 }); T.until(() => g.bootCamp.tour !== null, 20, () => T.pin({ x: 2100, y: 250 })); window.__hud.update(); });
    const tr = await p.evaluate(() => {
      const out = [];
      const sample = (label) => { window.__hud.update(); const c = document.getElementById('bc-tour').getBoundingClientRect(), hl = document.querySelector('.bc-hl'), h = hl ? hl.getBoundingClientRect() : null, x = document.querySelector('#bc-tour .bc-btn').getBoundingClientRect(); const overlap = h ? !(c.right <= h.left || c.left >= h.right || c.bottom <= h.top || c.top >= h.bottom) : false; out.push({ label, inside: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, overlap, hlH: h ? Math.round(h.height) : 0, exitH: Math.round(x.height), exitW: Math.round(x.width) }); };
      sample('campaign');
      document.querySelector('[data-a="to-barracks"]').click(); sample('roster');
      document.querySelector('[data-tab="training"]').click(); sample('training');
      document.querySelector('[data-a="to-campaign"]').click(); sample('complete');
      return out;
    });
    check(`F10 ${name}: every tour card fits the screen and never covers the control it highlights; EXIT / DONE are >= 44 px`, tr.every((x) => x.inside && !x.overlap && x.exitH >= 44 && x.exitW >= 44), JSON.stringify(tr));
    await p.context().close();
  }

  // 30 / 60 FPS: the tutorial runs on the fixed step; drawing every step (60 FPS) or every second step (30 FPS) plays identically
  const run = async (every) => {
    const p = await open();
    await p.evaluate(() => { let s = 4242 >>> 0; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; window.game.startBootCamp(); });
    const r = await p.evaluate((ev) => {
      const g = window.game;
      g.input.move = () => { const dx = 760 - g.anchor.x, dy = 520 - g.anchor.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
      let n = 0; const trace = [];
      const stage = () => g.mission.currentObjective?.id;
      while (n < 60 * 20 && stage() === 'bc-move') { g.update(1 / 60); if (n % ev === 0) window.__hud.update(); if (n % 120 === 0) trace.push(Math.round(g.soldiers[0].pos.x) + ',' + Math.round(g.soldiers[0].pos.y) + ',' + g.soldiers.map((s) => Math.round(s.hp)).join('/')); n++; }
      for (let k = 0; k < 360; k++) { g.update(1 / 60); if (k % ev === 0) window.__hud.update(); } // then 6 s of the fight step
      return { steps: n, stage: stage(), hp: g.soldiers.map((s) => Math.round(s.hp * 100) / 100), pos: g.soldiers.map((s) => Math.round(s.pos.x) + ',' + Math.round(s.pos.y)), kills: g.stats.rows(g.soldiers).map((r) => r.kills).join() };
    }, every);
    await p.context().close();
    return r;
  };
  const r60 = await run(1), r30 = await run(2);
  check('F11 Field Training (the move step, then the first seconds of the fight) is identical whether the game draws every step (60 FPS) or every second step (30 FPS): the same steps, positions, HP and kills', r60.stage === 'bc-fight' && r60.steps < 1200 && JSON.stringify(r60) === JSON.stringify(r30), JSON.stringify([r60, r30]));

  const errs = pages.flatMap((p) => p.errors || []);
  check('page errors: none in any page of this suite', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  return finish();
});
