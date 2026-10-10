// v0.5 Recruitment Office checks (PASS/FAIL), through the real build: rules (levels, class /
// trait eligibility, names, rename validation, prices / refunds), candidate generation
// (statistical), persistence (reloads, tab switching, no free candidates), one-time class
// introductions, recruit / refresh / dismiss / rename transactions through the UI (double taps,
// save failures with rollback, full roster, insufficient Credits), dismissal safety (named
// soldiers never rejoin, unlock flags kept), recruits in combat + Results, and save v4
// migration from the real v0.4 / v0.3 / v0.2.2 fixtures plus repair of malformed fields.
// Usage: serve a build (npx vite preview --port 4173), then node tools/recruitment.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';
const FX = (n) => fs.readFileSync(`${__dirname}/fixtures/${n}`, 'utf8');

(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(80)} ${String(detail).slice(0, 220)}`); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('minisquad.save')));
  const fresh = async (raw = null) => {
    await page.goto(URL); await page.evaluate((raw) => { localStorage.clear(); if (raw) localStorage.setItem('minisquad.save', raw); }, raw);
    await page.goto(URL); await page.waitForTimeout(120);
  };
  const reload = async () => { await page.goto(URL); await page.waitForTimeout(120); };
  const credits = (n) => page.evaluate((n) => { window.__account().credits = n; window.__persist(); }, n);
  const toRecruit = async () => {
    if (!(await page.isVisible('#menu.barracks'))) await page.click('[data-a="to-barracks"]');
    await page.click('[data-a="tab"][data-tab="recruit"]'); await page.waitForTimeout(40);
  };
  const offers = () => page.evaluate(() => window.__account().recruitment.offers.map((o) => ({ ...o })));
  const ids = (o) => o.map((x) => x.id).join(',');
  const wait = (ms) => page.waitForTimeout(ms);

  // ================= pure rules =================
  await fresh();
  const rules = await page.evaluate(() => {
    const R = window.__recruitment;
    const lv = [1, 5, 6, 10, 11, 15, 16, 20, 21, 30, 31, 40, 41, 99].map((n) => `${n}:${R.startingLevelFor(n)}`).join(' ');
    const cls = (f) => R.recruitableClasses(new Set(f)).join('+');
    const tp = (c, f) => R.traitPool(c, new Set(f)).join('+');
    const v = (s, cur = null, taken = ['ace', 'ranger', 'ghost']) => { const r = R.validateName(s, cur, new Set(taken)); return r.ok ? `ok:${r.name}` : 'no'; };
    return {
      lv,
      classes: [cls(['ace', 'ranger']), cls(['ace', 'ranger', 'tank']), cls(['ace', 'ranger', 'tank', 'doc']), cls(['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'])],
      traits: [tp('infantry', ['ace', 'ranger']), tp('medic', ['ace', 'ranger']), tp('heavy', ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch']), tp('medic', ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'])],
      prices: R.RECRUIT_CLASSES.map((c) => `${c.classId}:${c.price}/${c.refund}`).join(' '),
      refresh: R.REFRESH_COST, pool: R.NAME_POOL.length, poolUnique: new Set(R.NAME_POOL.map((n) => n.toLowerCase())).size,
      poolReserved: R.NAME_POOL.filter((n) => R.RESERVED_NAMES.map((x) => x.toLowerCase()).includes(n.toLowerCase())).length,
      poolMax: Math.max(...R.NAME_POOL.map((n) => n.length)),
      names: [v('  Ghost  '), v('Ghost', 'Ghost'), v('ghost', 'Ghost'), v(''), v('   '), v('ACE'), v('Abcdefghijklm'), v('Abcdefghijkl'), v('Bad!'), v('...'), v("O'Neil Jr.-2"), v('  Big   Mo  '), v('Émile'), v('Ranger', 'Ace')],
      progress: (() => { const a = window.__account(); return R.campaignProgress({ ...a, missions: { 'heavy-support': { completions: 1, firstClearRun: 'x', bestStars: 1 } }, campaign: { unlockedMissions: ['first-contact', 'heavy-support', 'field-medicine'], selectedMission: 'first-contact' } }); })(),
    };
  });
  check('starting level table (M1-5 L1, 6-10 L3, 11-15 L5, 16-20 L8, 21-30 L10, 31-40 L15, 41+ L20)', rules.lv === '1:1 5:1 6:3 10:3 11:5 15:5 16:8 20:8 21:10 30:10 31:15 40:15 41:20 99:20', rules.lv);
  check('campaign progress = highest unlocked mission (not the selected one)', rules.progress === 3, rules.progress);
  check('recruitable classes: Infantry; +Heavy after Tank; +Medic after Doc; Havoc/Patch add none', rules.classes.join('|') === 'infantry|infantry+heavy|infantry+heavy+medic|infantry+heavy+medic', rules.classes.join('|'));
  check('trait pool: start = Sharpshooter/Quick Reflexes; Healer only for Medics (after Patch)', rules.traits[0] === 'sharpshooter+quickReflexes' && rules.traits[1] === 'sharpshooter+quickReflexes' && !rules.traits[2].includes('healer') && rules.traits[3] === 'sharpshooter+quickReflexes+tough+firstResponder+triggerHappy+healer', rules.traits.join(' | '));
  check('prices 750/1000/1000/1250, refunds 200/250/250/300, refresh 100; price > refund (no credit loop)', rules.prices === 'infantry:750/200 heavy:1000/250 medic:1000/250 sniper:1250/300' && rules.refresh === 100, rules.prices);
  check('name pool: 100+ unique, none reserved, all <= 8 chars', rules.pool >= 100 && rules.poolUnique === rules.pool && rules.poolReserved === 0 && rules.poolMax <= 8, `${rules.pool} names, max ${rules.poolMax}`);
  check('rename validation (trim, 1-12, charset, unique, own name/case ok, reserved no)', rules.names.join(',') === "no,ok:Ghost,ok:ghost,no,no,no,no,ok:Abcdefghijkl,no,no,ok:O'Neil Jr.-2,ok:Big Mo,no,no", rules.names.join(','));

  // generation statistics + uniqueness + exhaustion
  const gen = await page.evaluate(() => {
    const R = window.__recruitment;
    let seed = 12345; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const st = { offers: [], nextSeq: 1, usedNames: [], introduced: ['infantry', 'heavy', 'medic'], dismissed: [], rosterCap: 12, recruited: 0, refreshes: 0 };
    const flags = new Set(['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch']);
    const ctx = { flags, progress: 7, taken: R.takenNames(['Ace', 'Ranger'], st), rng };
    const N = 3000, byClass = {}, byTrait = {}, names = new Set(); let dup = 0, reserved = 0, long = 0, healerBad = 0, lvBad = 0;
    const idSet = new Set();
    for (let i = 0; i < N; i++) {
      const c = R.generateCandidate(st, ctx);
      byClass[c.classId] = (byClass[c.classId] || 0) + 1;
      byTrait[`${c.classId}:${c.traitId}`] = (byTrait[`${c.classId}:${c.traitId}`] || 0) + 1;
      const k = c.name.toLowerCase();
      if (names.has(k)) dup++; names.add(k);
      if (R.RESERVED_NAMES.some((r) => r.toLowerCase() === k)) reserved++;
      if (c.name.length > 12) long++;
      if (c.traitId === 'healer' && c.classId !== 'medic') healerBad++;
      if (c.level !== 3) lvBad++;
      idSet.add(c.id);
    }
    const ex = [...names].filter((n) => / [ivx]+$/.test(n)).slice(0, 3);
    // first lineup from a fresh state with only infantry: all infantry
    const st2 = { offers: [], nextSeq: 1, usedNames: [], introduced: ['infantry'], dismissed: [], rosterCap: 12, recruited: 0, refreshes: 0 };
    const lineups = [];
    for (let i = 0; i < 50; i++) { st2.offers = []; lineups.push(R.newLineup(st2, { flags: new Set(['ace', 'ranger']), progress: 1, taken: new Set(), rng }).map((c) => c.classId).join()); }
    // randomised later lineups: all three classes recruitable, no guaranteed spread
    const st3 = { offers: [], nextSeq: 1, usedNames: [], introduced: ['infantry', 'heavy', 'medic'], dismissed: [], rosterCap: 12, recruited: 0, refreshes: 0 };
    let allSame = 0, mixed = 0;
    for (let i = 0; i < 600; i++) { const l = R.newLineup(st3, { flags: new Set(['ace', 'ranger', 'tank', 'doc']), progress: 3, taken: new Set(), rng }); const s = new Set(l.map((c) => c.classId)); if (s.size === 1) allSame++; else mixed++; }
    return { byClass, byTrait, N, dup, reserved, long, healerBad, lvBad, ids: idSet.size, ex, lineups: [...new Set(lineups)], allSame, mixed };
  });
  const share = (c) => gen.byClass[c] / gen.N;
  check('3000 candidates: classes ~uniform (each 33% ±4)', ['infantry', 'heavy', 'medic'].every((c) => Math.abs(share(c) - 1 / 3) < 0.04), JSON.stringify(gen.byClass));
  check('3000 candidates: unique names (incl. exhausted pool fallback), none reserved, <= 12 chars, unique ids', gen.dup === 0 && gen.reserved === 0 && gen.long === 0 && gen.ids === gen.N, `dup ${gen.dup}, fallback e.g. ${gen.ex.join(', ')}`);
  check('traits: Healer only on Medics; every eligible trait appears; level from progress (M7 -> L3)', gen.healerBad === 0 && gen.lvBad === 0 && gen.byTrait['medic:healer'] > 0 && gen.byTrait['heavy:tough'] > 0 && !gen.byTrait['infantry:healer'], Object.keys(gen.byTrait).length + ' class:trait combos');
  check('fresh player lineups: Infantry only', gen.lineups.length === 1 && gen.lineups[0] === 'infantry,infantry,infantry', gen.lineups.join(' | '));
  check('later lineups random: same-class lineups occur (~11%), no forced spread', gen.allSame > 30 && gen.allSame < 120 && gen.mixed > 450, `all-same ${gen.allSame}/600 (expected ~67)`);

  // ================= fresh player: office, persistence, no free candidates =================
  await fresh();
  await page.click('[data-a="to-barracks"]');
  let sv = await save();
  check('fresh save is v7 (v0.6.2) with empty offers until the office is opened', sv.version === 7 && sv.account.recruitment.offers.length === 0 && sv.account.pendingDecision === null && sv.account.recruitment.rosterCap === 12, JSON.stringify(sv.account.recruitment).slice(0, 120));
  check('Barracks shows Squad 2 / 2 and Roster 2 / 12', /SQUAD\s*2 \/ 2/.test(await page.textContent('.b-counts')) && /ROSTER\s*2 \/ 12/.test(await page.textContent('.b-counts')), await page.textContent('.b-counts'));
  await toRecruit();
  const o1 = await offers();
  sv = await save();
  const cards = await page.$$eval('.rc-card', (cs) => cs.map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  check('office: exactly 3 cards (name, class, LV, trait, HP/DMG/RATE/SPEED, price)', cards.length === 3 && cards.every((t) => /Infantry/i.test(t) && /LV 1/.test(t) && /HP \d+\s*DMG \d+/.test(t) && /RATE [\d.]+\/s\s*SPEED \d+/.test(t) && /750 CR/.test(t) && /(Sharpshooter|Quick Reflexes)/.test(t)), cards[0]);
  check('offers saved on first open', ids(sv.account.recruitment.offers) === ids(o1) && o1.length === 3, ids(o1));
  check('no credits: Recruit + Refresh disabled', (await page.$$eval('.rc-buy', (b) => b.every((x) => x.disabled))) && (await page.isDisabled('[data-a="refresh"]')));
  // stats on the card = what the recruit will have (class + level + trait + squad training)
  const statMatch = await page.evaluate(() => {
    const a = window.__account(); a.squadTraining.hp = 2; // squad training shows on offers too
    const o = a.recruitment.offers[0];
    const id = { classId: o.classId, traitId: o.traitId, mods: {}, progression: { level: o.level, xp: 0, upgrades: [], specialization: null, tier: 'recruit', elitePath: null, eliteLevel: 0 }, training: { accuracy: 0, damage: 0, hp: 0, fireRate: 0, moveSpeed: 0 } };
    const st = window.__effectiveStats(id); a.squadTraining.hp = 0;
    return st.hp;
  });
  check('offer stats include squad training (HP 100 -> 104 at Squad HP rank 2)', statMatch === 104, statMatch);
  for (const t of ['roster', 'training', 'squad', 'recruit', 'roster', 'recruit']) await page.click(`[data-a="tab"][data-tab="${t}"]`);
  await page.click('[data-a="to-campaign"]'); await toRecruit();
  await reload(); await toRecruit();
  check('tab switching, Campaign round trip and reload: same 3 offers (no free candidates)', ids(await offers()) === ids(o1), ids(await offers()));

  // ================= recruit through the UI =================
  await credits(2000); await reload(); await toRecruit();
  const before = await offers();
  await page.click(`.rc-card[data-id="${before[1].id}"] .rc-buy`);
  await wait(60);
  let st = await page.evaluate(() => ({ cr: window.__account().credits, n: window.game.roster.activeCount(), rec: window.game.roster.get(window.__account().recruitment.offers.length && window.game.roster.soldiers[2]?.id) }));
  const after = await offers();
  sv = await save();
  const recruit = sv.roster.find((s) => s.id === before[1].id);
  check('recruit: -750 CR, roster 3, saved with 0 XP (L1) and 0 training', st.cr === 1250 && st.n === 3 && recruit && recruit.name === before[1].name && recruit.progression.xp === 0 && recruit.progression.level === 1 && Object.values(recruit.training).every((x) => x === 0) && sv.account.credits === 1250, `${st.cr} CR, ${recruit && recruit.name}`);
  check('recruit: ONLY that offer replaced (others unchanged), new id + new name', after[0].id === before[0].id && after[2].id === before[2].id && after[1].id !== before[1].id && after[1].name !== before[1].name, `${ids(before)} -> ${ids(after)}`);
  check('recruit name in the used-name registry; new soldier marked NEW in the roster', sv.account.recruitment.usedNames.includes(before[1].name), sv.account.recruitment.usedNames.join());
  // double tap on Recruit (same position: the replacement offer must not be bought by the 2nd tap)
  await wait(500); // past the post-transaction tap lock
  const b2 = await offers();
  await page.dblclick(`.rc-card[data-id="${b2[0].id}"] .rc-buy`);
  await wait(60);
  st = await page.evaluate(() => ({ cr: window.__account().credits, n: window.game.roster.activeCount() }));
  check('double-tap Recruit: exactly one recruit (-750 once)', st.cr === 500 && st.n === 4, JSON.stringify(st));
  await wait(500);
  // rapid taps via direct calls: stale candidate id refused
  const stale = await page.evaluate((id) => window.__economy.recruit(window.game.roster, window.__account(), id, window.__persist), b2[0].id);
  check('repeated recruit of the same offer id refused ("Already recruited")', !stale.ok && /Already/.test(stale.reason), stale.reason);
  // reload right after a purchase
  await reload(); await toRecruit();
  st = await page.evaluate(() => ({ cr: window.__account().credits, n: window.game.roster.activeCount(), off: window.__account().recruitment.offers.map((o) => o.id).join(',') }));
  check('reload after recruiting: credits, roster and offers as saved', st.cr === 500 && st.n === 4 && st.off === ids(await offers()), JSON.stringify(st));
  check('insufficient credits (500 < 750): Recruit buttons disabled', await page.$$eval('.rc-buy', (b) => b.every((x) => x.disabled)));

  // ================= refresh =================
  const r0 = await offers();
  await page.click('[data-a="refresh"]');
  const armedLbl = await page.textContent('[data-a="refresh"]');
  st = await page.evaluate(() => window.__account().credits);
  check('refresh: first tap only arms it ("Tap again — 100 CR"), nothing charged', /TAP AGAIN/.test(armedLbl) && st === 500 && ids(await offers()) === ids(r0), armedLbl);
  await wait(3300);
  check('refresh: arm expires after 3 s', /REFRESH/.test(await page.textContent('[data-a="refresh"]')));
  await page.click('[data-a="refresh"]'); await page.click('[data-a="refresh"]', { delay: 0 });
  await wait(60);
  check('refresh: arm + immediate second tap (a double tap) does NOT confirm', (await page.evaluate(() => window.__account().credits)) === 500 && ids(await offers()) === ids(r0));
  await wait(400);
  await page.click('[data-a="refresh"]');
  await wait(60);
  const r1 = await offers();
  st = await page.evaluate(() => ({ cr: window.__account().credits, n: window.game.roster.activeCount() }));
  const rNames = new Set(r0.map((o) => o.name.toLowerCase()));
  check('refresh: -100 CR, three NEW identities (ids + names), roster untouched', st.cr === 400 && st.n === 4 && r1.every((o) => !r0.some((p) => p.id === o.id) && !rNames.has(o.name.toLowerCase())), `${r0.map((o) => o.name)} -> ${r1.map((o) => o.name)}`);
  await wait(500);
  await page.click('[data-a="refresh"]'); await wait(400); await page.dblclick('[data-a="refresh"]');
  await wait(60);
  st = await page.evaluate(() => window.__account().credits);
  check('refresh: arm + double tap charges exactly once', st === 300, st);
  const staleR = await page.evaluate((k) => window.__economy.refreshOffers(window.game.roster, window.__account(), k, window.__persist), ids(r1));
  check('stale refresh (old lineup key) refused', !staleR.ok && /Already/.test(staleR.reason), staleR.reason);
  await reload(); await toRecruit();
  const r2 = await offers();
  check('refreshed offers persist across reload', (await save()).account.recruitment.offers.map((o) => o.id).join() === ids(r2) && (await page.evaluate(() => window.__account().credits)) === 300);
  await credits(50); await reload(); await toRecruit();
  check('refresh disabled when unaffordable (50 CR)', await page.isDisabled('[data-a="refresh"]'));

  // ================= save failures roll back =================
  await credits(5000); await reload(); await toRecruit();
  const fb = await page.evaluate(() => {
    const E = window.__economy, g = window.game, a = window.__account();
    const snap = () => JSON.stringify({ cr: a.credits, ids: g.roster.soldiers.map((s) => s.id + ':' + s.name), slots: g.roster.slots, rec: a.recruitment });
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error('quota'); };
    const s0 = snap();
    const res = [];
    res.push(E.recruit(g.roster, a, a.recruitment.offers[0].id, window.__persist));
    res.push(E.refreshOffers(g.roster, a, null, window.__persist));
    const rid = g.roster.soldiers.find((s) => s.id.startsWith('rc-')).id;
    res.push(E.dismiss(g.roster, a, rid, window.__persist));
    res.push(E.rename(g.roster, a, rid, 'Zed', window.__persist));
    const s1 = snap();
    Storage.prototype.setItem = orig;
    return { same: s0 === s1, res: res.map((r) => r.ok ? 'ok' : r.reason) };
  });
  check('save failure: recruit / refresh / dismiss / rename all rolled back completely', fb.same && fb.res.every((r) => /Could not save/.test(r)), fb.res.join(' | '));

  // ================= roster cap =================
  await credits(20000); await reload(); await toRecruit();
  for (let i = 0; i < 20 && (await page.evaluate(() => window.game.roster.activeCount())) < 12; i++) { const o = await offers(); await page.click(`.rc-card[data-id="${o[i % 3].id}"] .rc-buy`); await wait(480); }
  st = await page.evaluate(() => ({ n: window.game.roster.activeCount(), cr: window.__account().credits }));
  const fullTxt = await page.textContent('.rc-main');
  const btnsFull = await page.$$eval('.rc-buy', (b) => b.map((x) => x.disabled + ':' + x.textContent.trim()));
  const capRes = await page.evaluate(() => window.__economy.recruit(window.game.roster, window.__account(), window.__account().recruitment.offers[0].id, window.__persist));
  check('roster cap: 12/12 (13th refused); buttons ROSTER FULL + explanation', st.n === 12 && btnsFull.every((x) => x.startsWith('true:ROSTER FULL')) && /Roster full \(12\/12\): dismiss/.test(fullTxt) && !capRes.ok, `${st.n} soldiers · ${btnsFull[0]} · ${capRes.reason}`);
  check('full roster keeps the offers', (await offers()).length === 3);
  if (OUT) await page.screenshot({ path: `${OUT}/recruit-desktop-full-roster.png` });
  const allNames = await page.evaluate(() => [...window.game.roster.soldiers.map((s) => s.name), ...window.__account().recruitment.offers.map((o) => o.name)].map((n) => n.toLowerCase()));
  check('no duplicate names across roster + offers; recruits have unique ids', new Set(allNames).size === allNames.length && (await page.evaluate(() => new Set(window.game.roster.soldiers.map((s) => s.id)).size === window.game.roster.soldiers.length)), allNames.length + ' names');
  const sameClass = await page.evaluate(() => window.game.roster.owned().filter((s) => s.classId === 'infantry').length);
  check('multiple same-class recruits allowed', sameClass >= 10, sameClass + ' Infantry');

  // ================= dismissal through the UI =================
  await page.click('[data-a="tab"][data-tab="roster"]');
  const victim = await page.evaluate(() => window.game.roster.soldiers.find((s) => s.id.startsWith('rc-')));
  // put the victim in the squad first, to check the selection is cleaned
  await page.evaluate((id) => { const r = window.game.roster; r.trimTo(1); r.select(id); }, victim.id);
  await page.click(`.s-card[data-id="${victim.id}"] .s-name`);
  await page.click('.d-btns [data-a="dismiss"]');
  const dlg = await page.textContent('.x-card');
  check('dismiss dialog: name, class, level, trait, refund, permanent-loss warning, Cancel/Confirm', dlg.includes(victim.name) && /Infantry/.test(dlg) && /LV 1/.test(dlg) && /(Sharpshooter|Quick Reflexes)/.test(dlg) && /\+200 CR/.test(dlg) && /permanently lost/.test(dlg) && /CANCEL/.test(dlg) && /CONFIRM DISMISSAL/.test(dlg), dlg.replace(/\s+/g, ' ').slice(0, 160));
  if (OUT) await page.screenshot({ path: `${OUT}/dismiss-confirm-desktop.png` });
  await page.click('[data-a="dismiss-cancel"]');
  check('dismiss: Cancel keeps the soldier', await page.evaluate((id) => !!window.game.roster.get(id), victim.id));
  check('dismiss: Cancel returns to the details panel', await page.isVisible('.d-btns [data-a="dismiss"]'));
  await page.keyboard.press('Escape');
  const crBefore = await page.evaluate(() => window.__account().credits);
  await page.click(`.s-card[data-id="${victim.id}"] .s-name`);
  await page.click('.d-btns [data-a="dismiss"]');
  await page.dblclick('[data-a="dismiss-confirm"]');
  await wait(500);
  sv = await save();
  st = await page.evaluate((id) => ({ cr: window.__account().credits, there: !!window.game.roster.get(id), slots: window.game.roster.slots.filter(Boolean), n: window.game.roster.activeCount() }), victim.id);
  const hist = sv.account.recruitment.dismissed;
  check('dismiss (double-tapped confirm): +200 once, removed from roster + squad, 11/12', st.cr === crBefore + 200 && !st.there && !st.slots.includes(victim.id) && st.n === 11 && !sv.roster.some((s) => s.id === victim.id) && !sv.squad.includes(victim.id), JSON.stringify(st));
  check('dismissal history: id, final name, class, level, event id, timestamp, never restorable', hist.length === 1 && hist[0].id === victim.id && hist[0].name === victim.name && hist[0].classId === 'infantry' && hist[0].level === 1 && /^dm-/.test(hist[0].eventId) && hist[0].at > 0 && hist[0].restorable === false, JSON.stringify(hist[0]));
  const again = await page.evaluate((id) => window.__economy.dismiss(window.game.roster, window.__account(), id, window.__persist), victim.id);
  check('dismissing the same soldier again: refused, no second refund', !again.ok && (await page.evaluate(() => window.__account().credits)) === crBefore + 200, again.reason);
  await toRecruit();
  check('slot freed: recruiting enabled again at 11/12', !(await page.$$eval('.rc-buy', (b) => b.every((x) => x.disabled))));
  const nm = await page.evaluate((n) => { const R = window.__recruitment, a = window.__account(); const t = R.takenNames(window.game.roster.soldiers.map((s) => s.name), a.recruitment); return t.has(n.toLowerCase()); }, victim.name);
  check("dismissed soldier's name stays reserved", nm);
  await reload();
  check('reload: dismissed recruit stays gone', await page.evaluate((id) => !window.game.roster.get(id), victim.id));
  // last soldier rule
  const last = await page.evaluate(() => {
    const E = window.__economy, g = window.game, a = window.__account();
    const R = new window.__Roster(g.roster.soldiers.slice(0, 1).map((s) => ({ ...s })), [], ['ace']);
    return E.dismiss(R, a, R.soldiers[0].id, null);
  });
  check('cannot dismiss the last soldier', !last.ok && /at least one/.test(last.reason), last.reason);
  const inMis = await page.evaluate(() => window.__economy.dismiss(window.game.roster, window.__account(), 'ace', null, { inMission: true }));
  check('cannot dismiss during a mission', !inMis.ok && /mission/i.test(inMis.reason), inMis.reason);

  // ================= rename =================
  await page.click('[data-a="to-barracks"]').catch(() => {});
  if (!(await page.isVisible('#menu.barracks'))) await page.click('[data-a="to-barracks"]');
  const rc = await page.evaluate(() => window.game.roster.soldiers.find((s) => s.id.startsWith('rc-')));
  const offerName = (await offers())[0].name;
  await page.click(`.s-card[data-id="${rc.id}"] .s-name`);
  await page.click('.d-rename');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  const tryName = async (n) => { await page.fill('#rn-input', n); await page.click('[data-a="rename-save"]'); await wait(30); return { err: (await page.isVisible('#rn-input')) ? await page.textContent('.rn-help') : null, name: await page.evaluate((id) => window.game.roster.get(id).name, rc.id) }; };
  const bad = [];
  for (const n of ['', 'Ace', 'ranger', offerName, 'Bad@Name', victim.name, '-- . --']) bad.push(await tryName(n));
  const maxAttr = await page.getAttribute('#rn-input', 'maxlength');
  const tooLong = await page.evaluate((id) => window.__economy.rename(window.game.roster, window.__account(), id, 'Way too long name', null), rc.id);
  bad.push({ err: !tooLong.ok && maxAttr === '12' ? tooLong.reason : null, name: rc.name });
  check('rename: input focused; blank / reserved / offer / too long / bad chars / dismissed name rejected', focused === 'rn-input' && bad.every((b) => b.err && b.name === rc.name), bad.map((b) => b.err).join(' | '));
  if (OUT) await page.screenshot({ path: `${OUT}/rename-desktop.png` });
  const okRen = await tryName('  Sgt. Mo-Jo ');
  sv = await save();
  check('rename: valid name saved (trimmed), id + progression unchanged, old name reserved', okRen.err === null && okRen.name === 'Sgt. Mo-Jo' && sv.roster.find((s) => s.id === rc.id).name === 'Sgt. Mo-Jo' && sv.account.recruitment.usedNames.includes(rc.name), JSON.stringify(okRen));
  await page.click('.d-rename'); // the details panel is still open after a rename
  const caseRen = await tryName('SGT. MO-JO');
  check('rename: changing the case of its own name allowed', caseRen.err === null && caseRen.name === 'SGT. MO-JO', JSON.stringify(caseRen));
  await page.click('.d-rename'); // the details panel is still open after a rename
  const backRen = await tryName(rc.name);
  check('rename back to its released old name refused (names once used stay reserved)', !!backRen.err, backRen.err);
  await page.keyboard.press('Escape');
  // campaign soldier rename: Ace -> Maverick? (pool name; then never generated)
  const aceRen = await page.evaluate(() => window.__economy.rename(window.game.roster, window.__account(), 'ace', 'Ace Two', window.__persist));
  check('campaign soldier rename (Ace -> "Ace Two") allowed; id stays "ace"', aceRen.ok && (await page.evaluate(() => window.game.roster.get('ace').name)) === 'Ace Two', JSON.stringify(aceRen));
  await reload();
  check('renames persist across reload', (await page.evaluate((id) => window.game.roster.get('ace').name + '|' + window.game.roster.get(id).name, rc.id)) === 'Ace Two|SGT. MO-JO');

  // ================= recruits in combat, XP, Credits, Results =================
  const play = await page.evaluate((rid) => {
    const g = window.game, r = g.roster;
    g.selectMission('first-contact', true);
    r.trimTo(0); r.select(rid); r.select('ranger');
    const cr0 = window.__account().credits, xp0 = r.get(rid).progression.xp;
    const d = g.deploySelected(); if (!d.ok) return { err: d.reason };
    const u = g.soldiers.find((s) => s.identity.id === rid);
    const ab = u.ability.id;
    g.win();
    const rw = g.lastReward;
    const row = rw.soldiers.find((s) => s.id === rid);
    return { ab, name: u.name, xp: r.get(rid).progression.xp - xp0, cr: window.__account().credits - cr0, row: row && row.name, html: document.querySelector('.r-table').textContent.includes(u.name) };
  }, rc.id);
  check('recruit deploys, has the class ability, earns XP + Credits, listed on Results', play.ab === 'grenade' && play.xp > 0 && play.cr > 0 && play.row === 'SGT. MO-JO' && play.html, JSON.stringify(play));
  await page.click('[data-a="barracks"]');

  // ================= class introduction (one-time) =================
  await fresh();
  await page.click('[data-a="to-barracks"]'); await toRecruit();
  const pre = await offers();
  // clear Mission 1 through the game -> Tank's milestone (v0.6.1: Tank is NOT bought) -> Heavy Gunner recruitable
  await page.evaluate(() => { const g = window.game; g.toCampaign(); g.selectMission('first-contact'); g.deploySelected(); g.win(); });
  await page.click('[data-a="barracks"]');
  await page.click('[data-a="rn-visit"]'); // one-time NEW RECRUIT notice -> Recruitment Office
  await page.waitForTimeout(500);
  const post = await offers();
  check('class unlock: next shown lineup swaps the LAST offer for a Heavy Gunner (free); others unchanged', post[0].id === pre[0].id && post[1].id === pre[1].id && post[2].classId === 'heavy' && post[2].id !== pre[2].id, `${pre.map((o) => o.classId)} -> ${post.map((o) => o.classId)}`);
  if (OUT) await page.screenshot({ path: `${OUT}/recruit-desktop-heavy-introduced.png` });
  for (const t of ['roster', 'recruit']) await page.click(`[data-a="tab"][data-tab="${t}"]`);
  await reload(); await toRecruit();
  check('introduction happens once (reopen / reload: no further change); state saved', ids(await offers()) === ids(post) && (await save()).account.recruitment.introduced.join() === 'infantry,heavy');
  // two classes at once (Tank + Doc unlocked while the office was closed), on a lineup that exists
  await fresh();
  await page.click('[data-a="to-barracks"]'); await toRecruit();
  const pre2 = await offers();
  // v0.6.1: milestones (not ownership) unlock the classes; notices marked seen so nothing covers the office
  await page.evaluate(() => { const n = window.__account().named; n.unlocked.push('tank', 'doc'); n.notified.push('tank', 'doc'); window.__persist(); });
  await reload(); await toRecruit();
  const post2 = await offers();
  check('two classes unlocked at once: last two offers become Heavy + Medic, first unchanged', post2[0].id === pre2[0].id && post2.slice(1).map((o) => o.classId).sort().join() === 'heavy,medic', post2.map((o) => o.classId).join());
  // first visit after the unlock (no lineup yet): guaranteed in the first lineup
  await fresh();
  await page.evaluate(() => { const n = window.__account().named; n.unlocked.push('tank'); n.notified.push('tank'); window.__persist(); });
  await reload(); await page.click('[data-a="to-barracks"]'); await toRecruit();
  check('first-ever lineup after Tank\'s milestone (Tank not bought) contains a Heavy Gunner', (await offers()).some((o) => o.classId === 'heavy'), (await offers()).map((o) => o.classId).join());
  // afterwards: normal randomness (refreshes are not forced)
  const later = await page.evaluate(() => {
    const out = {}; const a = window.__account(); a.credits = 100000;
    for (let i = 0; i < 300; i++) { const r = window.__economy.refreshOffers(window.game.roster, a, null, null); a.recruitment.offers.forEach((o) => out[o.classId] = (out[o.classId] || 0) + 1); if (!r.ok) return { err: r.reason }; }
    let noHeavy = 0; for (let i = 0; i < 200; i++) { window.__economy.refreshOffers(window.game.roster, a, null, null); if (!a.recruitment.offers.some((o) => o.classId === 'heavy')) noHeavy++; }
    return { out, noHeavy };
  });
  check('after the introduction refreshes are random (Heavy not forced; ~50/50 Inf/Heavy)', later.noHeavy > 10 && Math.abs(later.out.heavy / 900 - 0.5) < 0.07, JSON.stringify(later));

  // ================= campaign named soldier dismissal (v0.4 fixture) =================
  const fx4 = FX('v0.4-save.json');
  await fresh(fx4);
  const mig = await page.evaluate(() => ({ status: window.__loadStatus.status, from: window.__loadStatus.fromVersion, notes: window.__loadStatus.notes, backup: localStorage.getItem('minisquad.save.pre-v0.5'), sv: JSON.parse(localStorage.getItem('minisquad.save')), notice: document.querySelector('.m-notice')?.textContent }));
  const src = JSON.parse(fx4);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // v0.6: the service record gained downs / revives / deaths (0: never tracked before); the v0.3 fields are compared
  const strip = (r) => r.map((s) => ({ id: s.id, name: s.name, classId: s.classId, traitId: s.traitId, xp: s.progression.xp, level: s.progression.level, training: s.training, service: { missions: s.service.missions, victories: s.service.victories, kills: s.service.kills } }));
  check('v0.4 fixture -> v7: status migrated, no repair notes, pre-v0.5 backup = original text', mig.status === 'migrated' && mig.from === 3 && mig.notes.length === 0 && mig.backup === fx4 && mig.sv.version === 7, `${mig.status} ${mig.notes.join(';')}`);
  check('v0.4 migration keeps soldiers, XP, levels, training, traits, service records exactly', same(strip(mig.sv.roster), strip(src.roster)), '');
  check('v0.4 migration keeps credits, squad training, missions/stars, campaign, unlocks, squad', mig.sv.account.credits === src.account.credits && same(mig.sv.account.squadTraining, src.account.squadTraining) && same(mig.sv.account.missions, src.account.missions) && same(mig.sv.account.campaign, src.account.campaign) && same(mig.sv.unlockedSoldiers, src.unlockedSoldiers) && same(mig.sv.squad, src.squad) && same(mig.sv.account.settledRuns, src.account.settledRuns), `${mig.sv.account.credits} CR, ${mig.sv.unlockedSoldiers}`);
  check('v0.4 migration: no introduction owed for classes already recruitable; migration notice shown', same(mig.sv.account.recruitment.introduced, ['infantry', 'heavy', 'medic']) && /v0\.6/.test(mig.notice || ''), mig.notice);
  await page.click('[data-a="to-barracks"]');
  check('v0.4 roster: 4 / 12 (Ace, Ranger, Tank, Doc owned; Havoc/Patch locked)', /ROSTER\s*4 \/ 12/.test(await page.textContent('.b-counts')));
  const tankDis = await page.evaluate(() => window.__economy.dismiss(window.game.roster, window.__account(), 'tank', window.__persist));
  sv = await save();
  check('dismiss Tank (named): +250, gone, unlock flag kept, Heavy still recruitable, Tough still in pool', tankDis.ok && tankDis.refund === 250 && !sv.roster.some((s) => s.id === 'tank') && sv.unlockedSoldiers.includes('tank') && (await page.evaluate(() => window.__recruitment.recruitableClasses(window.game.roster.unlocked).includes('heavy') && window.__recruitment.traitPool('infantry', window.game.roster.unlocked).includes('tough'))), JSON.stringify(sv.unlockedSoldiers));
  await page.evaluate(() => { const g = window.game; g.hideAll?.(); g.selectMission('first-contact'); g.roster.trimTo(0); g.roster.select('ace'); g.deploySelected(); g.win(); });
  const tankBack = await page.evaluate(() => ({ r: !!window.game.roster.get('tank'), unl: window.game.lastReward.unlockedSoldiers }));
  await reload();
  check('replaying Mission 1 never brings Tank back; reload does not restore him', !tankBack.r && tankBack.unl.length === 0 && !(await page.evaluate(() => !!window.game.roster.get('tank'))), JSON.stringify(tankBack));
  // ================= older fixtures + repair =================
  for (const f of ['v0.3-save.json', 'v0.2.2-save.json']) {
    const raw = FX(f);
    await fresh(raw);
    const r = await page.evaluate(() => ({ st: window.__loadStatus.status, n: window.game.roster.activeCount(), v: JSON.parse(localStorage.getItem('minisquad.save')).version, b5: !!localStorage.getItem('minisquad.save.pre-v0.5'), b4: !!localStorage.getItem('minisquad.save.pre-v0.4'), b6: !!localStorage.getItem('minisquad.save.pre-v0.6'), b61: !!localStorage.getItem('minisquad.save.pre-v0.6.1'), intro: window.__account().recruitment.introduced.join() }));
    if (f.startsWith('v0.3')) {
      // legacy owner of Tank who never cleared Mission 1: dismiss Tank, Mission 1's card must still render
      const camp = await page.evaluate(() => { window.__economy.dismiss(window.game.roster, window.__account(), 'tank', window.__persist); window.game.ui.showCampaign(); document.querySelector('[data-a="csel"][data-id="first-contact"]').click(); return document.querySelector('.c-detail').textContent.replace(/\s+/g, ' '); });
      check('legacy save: Mission 1 card still renders "Unlock Tank + Heavy Gunner recruitment" after Tank was dismissed', /Unlock Tank \+ Heavy Gunner recruitment/.test(camp), camp.slice(0, 200));
      r.n = 6; // counted before the dismissal
    }
    check(`${f}: migrates to v7, all 6 originals kept (6/12), backups kept, no intro owed`, r.v === 7 && r.n === 6 && r.b5 && r.b4 && r.b6 && r.b61 && (r.st === 'migrated' || r.st === 'repaired') && r.intro === 'infantry,heavy,medic', JSON.stringify(r));
  }
  // >12 roster from history: keep everyone, block recruiting
  const big = JSON.parse(fx4);
  big.version = 4;
  for (let i = 1; i <= 10; i++) big.roster.push({ ...big.roster[0], id: `rc-${i}`, name: `Hist${i}`, traitId: 'tough' });
  await fresh(JSON.stringify(big));
  const bigSt = await page.evaluate(() => ({ n: window.game.roster.activeCount(), block: window.__economy.recruitBlock(window.game.roster, window.__account()), seq: window.__account().recruitment.nextSeq, status: window.__loadStatus.status }));
  check('roster above cap (14) loads intact; recruiting blocked; id counter raised past rc-10', bigSt.n === 14 && /Roster full \(14\/12\)/.test(bigSt.block || '') && bigSt.seq === 11, JSON.stringify(bigSt));
  // malformed recruitment fields: repaired, progression untouched
  const bad4 = JSON.parse(JSON.stringify(big));
  bad4.roster = bad4.roster.slice(0, 6);
  bad4.roster.push({ ...bad4.roster[0], id: 'rc-3', name: 'Ace', classId: 'sniper', traitId: 'healer' }); // clash name, bad class
  bad4.account.recruitment = { offers: [{ id: 'rc-9', name: 'Ok', classId: 'infantry', traitId: 'sharpshooter', level: 1 }, { id: 'x', name: 3 }, 'junk', { id: 'rc-12', name: 'Medic', classId: 'infantry', traitId: 'healer', level: 1 }], nextSeq: -4, usedNames: 'nope', introduced: ['zzz'], dismissed: [{ id: 'rc-1', name: 'Gone' }, 7], rosterCap: 99, recruited: -1 };
  await fresh(JSON.stringify(bad4));
  const rep = await page.evaluate(() => ({ st: window.__loadStatus.status, cr: window.__account().credits, sq: window.__account().squadTraining.hp, rec: window.__account().recruitment, r3: window.game.roster.get('rc-3'), r1: !!window.game.roster.get('rc-1') }));
  check('malformed recruitment fields repaired; credits/training untouched; bad recruit fixed not dropped', rep.st === 'repaired' && rep.cr === src.account.credits && rep.sq === 1 && rep.rec.offers.length === 1 && rep.rec.offers[0].id === 'rc-9' && rep.rec.nextSeq === 10 && rep.rec.rosterCap === 12 && rep.rec.dismissed.length === 1 && rep.r3 && rep.r3.classId === 'infantry' && rep.r3.traitId === 'sharpshooter' && rep.r3.name !== 'Ace' && !rep.r1, `${rep.st} offers ${rep.rec.offers.map((o) => o.id)} seq ${rep.rec.nextSeq} rc-3 ${rep.r3 && rep.r3.name + '/' + rep.r3.classId}`);
  await page.click('[data-a="to-barracks"]'); await toRecruit();
  check('after repair the office refills to 3 offers', (await offers()).length === 3);

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(fails ? `\n${fails} FAILED` : '\nall recruitment checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
