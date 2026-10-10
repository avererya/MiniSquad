// Barracks / save / flow checks through the real UI, with page reloads (v0.4 campaign flow):
// first launch (Campaign, Ace + Ranger, locked cards), selection via taps against the mission's
// squad cap, persistence, invalid-save recovery, dev tools not touching the saved squad, the
// two-tap debug "unlock all", no trait stacking across reloads, Results -> Retry / Campaign /
// Barracks, dev reset with confirmation.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';
(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(74)} ${detail}`); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('minisquad.save')));
  const slots = () => page.evaluate(() => window.game.roster.slots.filter(Boolean).join());
  const reload = async (q = '') => { await page.goto(URL + q); await page.waitForTimeout(150); };
  const toBarracks = async () => { await page.click('[data-a="to-barracks"]'); await page.waitForTimeout(50); };

  await reload();
  let sv = await save();
  check('first launch: Campaign shown, save v5 written with 6 named soldier records', await page.isVisible('#menu.campaign') && sv.version === 5 && sv.account && sv.account.credits === 0 && sv.roster.length === 6, `version ${sv.version}, roster ${sv.roster.map((s) => s.id)}`);
  check('first launch: Ace + Ranger unlocked and selected; Mission 1 only', sv.squad.filter(Boolean).join() === 'ace,ranger' && sv.unlockedSoldiers.join() === 'ace,ranger' && sv.account.campaign.unlockedMissions.join() === 'first-contact' && sv.account.campaign.selectedMission === 'first-contact', `${sv.squad} · ${sv.unlockedSoldiers} · ${JSON.stringify(sv.account.campaign)}`);
  check('save holds no runtime/effective stats', sv.roster.every((s) => Object.keys(s).sort().join() === 'classId,id,mods,name,progression,resurrections,service,status,training,traitId'), Object.keys(sv.roster[0]).join());
  await toBarracks();
  if (OUT) await page.screenshot({ path: `${OUT}/barracks-desktop-new-player.png` });
  // v0.5: the Barracks lists only soldiers the player owns; upcoming soldiers are previewed on the Campaign screen
  const shown = await page.evaluate(() => [...document.querySelectorAll('.s-card')].map((c) => c.dataset.id).join());
  check('fresh Barracks: only Ace + Ranger cards (no locked preview cards)', shown === 'ace,ranger' && (await page.$$('.s-card.locked')).length === 0, shown);
  const lockedSel = await page.evaluate(() => window.game.roster.select('tank'));
  check('a locked soldier can never be selected (API)', !lockedSel.ok && /locked/i.test(lockedSel.reason) && (await slots()) === 'ace,ranger', lockedSel.reason);
  await page.click('[data-a="to-campaign"]');
  const previews = [];
  for (const id of ['first-contact', 'heavy-support', 'bring-them-home', 'mission-6']) { await page.click(`[data-a="csel"][data-id="${id}"]`); previews.push(await page.textContent('.c-first')); }
  check('Campaign previews upcoming soldiers (Tank M1, Doc M2, Havoc M5, Patch at M7)', /Tank joins/.test(previews[0]) && /Doc joins/.test(previews[1]) && /Havoc joins/.test(previews[2]) && /Patch \(Medic\) joins at the Mission 7/.test(previews[3]), previews.map((x) => x.replace(/\s+/g, ' ').slice(0, 60)).join(' | '));
  await page.click('[data-a="csel"][data-id="first-contact"]');
  await toBarracks();
  const sq = await page.evaluate(() => ({ all: document.querySelectorAll('.b-slots .slot').length, open: document.querySelectorAll('.b-slots .slot:not(.locked)').length, locked: document.querySelectorAll('.b-slots .slot.locked').length, deploy: document.querySelectorAll('[data-a="deploy"]').length }));
  check('Mission 1: 6 squares, 2 open + 4 locked; no Deploy in the Barracks (v0.6.1)', sq.all === 6 && sq.open === 2 && sq.locked === 4 && sq.deploy === 0, JSON.stringify(sq));

  // dev: two-tap "unlock all" (clearly says it modifies the save)
  await page.keyboard.press('Backquote');
  const lbl0 = await page.textContent('[data-a="unlockAll"]');
  await page.click('[data-a="unlockAll"]');
  const armedTxt = await page.textContent('[data-a="unlockAll"]');
  const stillLocked = await page.evaluate(() => window.game.roster.unlocked.size);
  await page.click('[data-a="unlockAll"]');
  await page.keyboard.press('Backquote');
  sv = await save();
  check('debug unlock all: labelled "modifies save", 2 taps, saved', /modifies save/i.test(lbl0) && /again/i.test(armedTxt) && stillLocked === 2 && sv.unlockedSoldiers.length === 6 && sv.account.campaign.unlockedMissions.length === 5, `${lbl0} / ${armedTxt} / ${sv.unlockedSoldiers.length} soldiers, ${sv.account.campaign.unlockedMissions.length} missions`);
  // pick Mission 3 (squad cap 3) on the Campaign screen, then back to the Barracks
  await page.click('[data-a="to-campaign"]');
  await page.click('[data-a="csel"][data-id="field-medicine"]');
  await toBarracks();

  // selection via the UI (cap 3)
  for (let i = 0; i < 2; i++) await page.click('.b-slots button.slot');
  check('removing all (tap squares): empty squad, 3 empty + 3 locked squares', (await slots()) === '' && (await page.evaluate(() => document.querySelectorAll('.b-slots .slot.empty').length + ':' + document.querySelectorAll('.b-slots .slot.locked').length)) === '3:3');
  await page.click('.b-go');
  check('removing all: Campaign Deploy disabled', await page.isDisabled('.c-btns [data-a="deploy"]'));
  await page.click('.c-btns [data-a="to-barracks"]');
  for (const id of ['havoc', 'patch', 'ranger']) await page.click(`.s-card[data-id="${id}"] .pick`);
  const fullBtn = await page.textContent('.s-card[data-id="ace"] .pick');
  await page.click('.s-card[data-id="ace"] .pick'); // refused
  const notice = await page.textContent('.m-notice');
  check('UI: 3 picks fill Mission 3\'s slots; a 4th is refused with feedback', (await slots()) === 'havoc,patch,ranger' && /FULL/.test(fullBtn) && /full/i.test(notice), `${await slots()} · button "${fullBtn}" · notice "${notice}"`);
  await page.click('.s-card[data-id="havoc"] .pick'); // remove havoc
  await page.click('.s-card[data-id="havoc"] .pick'); // re-add: appended (packed list)
  check('UI: removed soldier re-added at the end, no duplicates', (await slots()) === 'patch,ranger,havoc', await slots());
  const hint = await page.textContent('.m-hint');
  await page.click('.b-slots .slot[data-slot="1"]'); // v0.6.1: tapping a square removes that soldier
  const afterTap = await slots();
  await page.click('.b-slots .slot[data-slot="1"]'); // remove Havoc too, then re-add in order
  await page.click('.s-card[data-id="ace"] .pick');
  await page.click('.s-card[data-id="havoc"] .pick');
  check('UI: tap square 2 removes Ranger; re-pick -> Patch, Ace, Havoc', afterTap === 'patch,havoc' && (await slots()) === 'patch,ace,havoc' && /remove/i.test(hint), `${afterTap} -> ${await slots()} · hint "${hint}"`);
  // details panel
  await page.click('.s-card[data-id="tank"] .s-name');
  const det = await page.evaluate(() => [...document.querySelectorAll('.d-stats tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' ')));
  check('details: base vs effective stats (Tank 150 -> 165 Tough)', det.some((r) => /Max HP 150 165 Tough/.test(r)) && det.some((r) => /Fire rate 7\/s 7\/s/.test(r)), det.slice(0, 3).join(' | '));
  if (OUT) await page.screenshot({ path: `${OUT}/details-desktop.png` });
  await page.keyboard.press('Escape');
  check('details: Esc closes', !(await page.isVisible('.m-modal')));
  await page.click('.s-card[data-id="patch"] .s-name');
  const patchRow = await page.evaluate(() => [...document.querySelectorAll('.d-stats tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' ')).find((r) => /Field Treatment/.test(r)));
  check('details: Patch Field Treatment 25 -> 27.5% max HP', /25% max HP 27\.5% max HP Healer/.test(patchRow || ''), patchRow);
  await page.click('.d-btns [data-a="close"]');

  // persistence
  await reload();
  check('selection + selected mission persist after reload', (await slots()) === 'patch,ace,havoc' && (await page.evaluate(() => window.game.missionId)) === 'field-medicine', await slots());
  // dev tools must not overwrite the saved squad
  await page.keyboard.press('Backquote');
  await page.selectOption('#tuning select:not([data-k])', 'hh');
  const genericIds = await page.evaluate(() => window.game.soldiers.map((s) => s.identity.id + ':' + (s.identity.traitId || '-')));
  check('dev preset deploys generic soldiers (no traits)', genericIds.length === 2 && genericIds.every((x) => /^G\d+:-$/.test(x)), genericIds.join());
  await page.keyboard.press('Backquote');
  await reload();
  check('dev preset did not change the saved squad', (await slots()) === 'patch,ace,havoc', await slots());
  await reload('?squad=doc,tank');
  const tmp = await page.evaluate(() => ({ ids: window.game.soldiers.map((s) => s.identity.id), kind: window.game.deployment.kind, saved: JSON.parse(localStorage.getItem('minisquad.save')).squad }));
  check('?squad=doc,tank deploys roster soldiers temporarily, save untouched', tmp.ids.join() === 'doc,tank' && tmp.kind === 'temp' && tmp.saved.filter(Boolean).join() === 'patch,ace,havoc', JSON.stringify(tmp));
  await reload('?squad=ihm');
  check('?squad=ihm preset still works (generic Inf+Heavy+Medic)', (await page.evaluate(() => window.game.soldiers.map((s) => s.identity.classId).join())) === 'infantry,heavy,medic');
  await reload('?squad=iiiiii');
  check('?squad=iiiiii: six generic soldiers (engine max)', (await page.evaluate(() => window.game.soldiers.length)) === 6);

  // deploy via UI, no trait stacking across reloads / retries
  const stacks = [];
  for (let i = 0; i < 3; i++) {
    await reload();
    await page.click('[data-a="deploy"]');
    for (let k = 0; k < 2; k++) await page.evaluate(() => window.game.reset());
    stacks.push(await page.evaluate(() => window.game.soldiers.map((s) => `${s.identity.id}:${s.maxHp}:${Math.round(s.fireRate * 1000) / 1000}:${s.stats.accuracy}`).join(' ')));
  }
  check('Deploy (Campaign) uses the saved squad; no stacking across 3 reloads x 3 deploys', stacks.every((x) => x === stacks[0]) && /^patch:80:2\.5:\S+ ace:100:3:10\.8 havoc:150:7\.35:15$/.test(stacks[0]), stacks[0]);
  sv = await save();
  check('a mission writes no combat state into the save', JSON.stringify(sv).match(/"state"|"cooldown"|"maxHp"|"pos"|"fireRate":\d+\./) === null && sv.roster.every((s) => !('hp' in s) && Object.values(s.training).every(Number.isInteger)) && sv.squad.filter(Boolean).join() === 'patch,ace,havoc');

  // results: victory -> retry via Enter; defeat -> Campaign / Barracks
  // (v0.6: KIA is permanent and needs a decision before a Retry; that flow is covered by tools/permadeath.cjs,
  // so these Results-navigation checks use a wounded soldier / a squad wipe of downed soldiers instead)
  await page.evaluate(() => { const g = window.game; g.soldiers[1].hp = 5; g.win(); });
  await page.waitForTimeout(100);
  if (OUT) await page.screenshot({ path: `${OUT}/results-victory-desktop.png` });
  await page.keyboard.press('Enter');
  const afterRetry = await page.evaluate(() => ({ phase: window.game.phase, st: window.game.soldiers.map((s) => s.state).join(), m: window.game.missionId }));
  check('results: Enter = Retry the same mission (fresh squad)', afterRetry.phase === 'playing' && afterRetry.st === 'active,active,active' && afterRetry.m === 'field-medicine', JSON.stringify(afterRetry));
  await page.evaluate(() => { const g = window.game; g.soldiers.forEach((s) => g.downSoldier(s)); });
  await page.waitForTimeout(100);
  if (OUT) await page.screenshot({ path: `${OUT}/results-defeat-desktop.png` });
  await page.click('[data-a="campaign"]');
  check('results: Campaign button', await page.isVisible('#menu.campaign') && (await page.evaluate(() => window.game.phase)) === 'start');
  await page.click('[data-a="deploy"]');
  await page.evaluate(() => { const g = window.game; g.soldiers.forEach((s) => g.downSoldier(s)); });
  await page.waitForTimeout(100);
  await page.click('[data-a="barracks"]');
  check('results: Barracks button', await page.isVisible('#menu.barracks') && (await page.evaluate(() => window.game.phase)) === 'start');

  // invalid save recovery
  const cases = [
    ['garbage text', 'not json {', 'reset'],
    ['future version (best-effort, backup kept)', JSON.stringify({ version: 99, roster: [], squad: [] }), 'repaired'],
    ['roster not an array', JSON.stringify({ version: 1, roster: 'x', squad: [] }), 'reset'],
    ['bad trait + bad class + crazy mods', null, 'repaired'],
    ['duplicate + unknown squad ids', null, 'repaired'],
    ['unknown soldier + mission ids in the unlock lists (unknown dropped, known kept)', null, 'repaired'],
  ];
  const good = sv;
  cases[3][1] = JSON.stringify({ ...good, roster: good.roster.map((s, i) => i === 0 ? { ...s, traitId: 'godmode' } : i === 1 ? { ...s, classId: 'sniper' } : i === 2 ? { ...s, mods: { hpMul: 1e9 } } : s) });
  cases[4][1] = JSON.stringify({ ...good, squad: ['tank', 'tank', 'ghost'] });
  cases[5][1] = JSON.stringify({ ...good, unlockedSoldiers: ['ace', 'ranger', 'ghost'], squad: ['ace', 'patch'], account: { ...good.account, campaign: { unlockedMissions: ['first-contact', 'mission-99', 'red-canyon'], selectedMission: 'mission-99' } } });
  for (const [name, raw, expectStatus] of cases) {
    await page.evaluate((r) => localStorage.setItem('minisquad.save', r), raw);
    await reload();
    await toBarracks();
    const st = await page.evaluate(() => ({
      status: window.__loadStatus.status, n: window.game.roster.soldiers.length, slots: window.game.roster.slots.filter(Boolean).join(),
      traits: window.game.roster.soldiers.map((s) => s.traitId).join(), tankHp: window.__effectiveStats(window.game.roster.get('tank')).hp,
      cards: document.querySelectorAll('.s-card').length, backup: localStorage.getItem('minisquad.save.invalid'), saved: JSON.parse(localStorage.getItem('minisquad.save')),
    }));
    const okBase = st.status === expectStatus && st.n === 6 && st.cards === (name.startsWith('unknown') || expectStatus === 'reset' ? 2 : 6) && st.traits === 'sharpshooter,quickReflexes,tough,triggerHappy,firstResponder,healer' && st.tankHp === 165 && st.saved.version === 5;
    const okSlots = name.startsWith('duplicate') ? st.slots === 'tank' : name.startsWith('unknown') ? st.slots === 'ace' && st.saved.unlockedSoldiers.join() === 'ace,ranger' && st.saved.account.campaign.unlockedMissions.join() === 'first-contact,red-canyon' && st.saved.account.campaign.selectedMission === 'first-contact' : true;
    const okBackup = expectStatus === 'reset' || name.startsWith('future') ? st.backup === raw : true;
    check(`invalid save recovers: ${name}`, okBase && okSlots && okBackup, `status ${st.status}, slots ${st.slots}, tank hp ${st.tankHp}${expectStatus === 'reset' ? ', backup kept' : ''}${name.startsWith('unknown') ? ' ' + JSON.stringify(st.saved.account.campaign) : ''}`);
  }
  check('no page errors during save recovery', errors.length === 0, errors.join(' | '));

  // dev reset with confirmation (legacy v1 save -> everything unlocked -> reset = new player)
  await page.evaluate(() => localStorage.setItem('minisquad.save', JSON.stringify({ version: 1, roster: [], squad: ['patch', null, null] })));
  await reload();
  await page.keyboard.press('Backquote');
  await page.click('[data-a="resetSave"]');
  const armed = { slots: await slots(), label: await page.textContent('[data-a="resetSave"]') };
  await page.click('[data-a="resetSave"]');
  const after = { slots: await slots(), saved: (await save()).squad.filter(Boolean).join(), unl: (await save()).unlockedSoldiers.join() };
  check('dev reset: first tap only arms it; second tap resets to a new player', armed.slots === 'patch' && /again/i.test(armed.label) && after.slots === 'ace,ranger' && after.saved === 'ace,ranger' && after.unl === 'ace,ranger', `${armed.slots} "${armed.label}" -> ${JSON.stringify(after)}`);

  // player-facing New Campaign (Campaign screen): explicit confirm dialog, backup first, double-tap safe
  const fx4 = require('fs').readFileSync(__dirname + '/fixtures/v0.4-save.json', 'utf8');
  await page.evaluate((r) => { localStorage.clear(); localStorage.setItem('minisquad.save', r); }, fx4);
  await reload();
  await page.evaluate(() => { const a = window.__account(); a.credits = 5000; window.__economy.openOffice(window.game.roster, a, null); window.__economy.recruit(window.game.roster, a, a.recruitment.offers[0].id, window.__persist); });
  await reload();
  const beforeReset = await page.evaluate(() => localStorage.getItem('minisquad.save'));
  await page.click('[data-a="reset-open"]');
  const dlgTxt = (await page.textContent('.x-card')).replace(/\s+/g, ' ');
  check('New Campaign: dialog states what is wiped (roster, recruits, XP, training, squad training, Credits, campaign, stars, shop)', ['roster', 'recruit', 'XP', 'individual training', 'squad training', 'Credits', 'campaign progress', 'stars', 'Recruitment Office'].every((w) => dlgTxt.includes(w)) && /CANCEL/.test(dlgTxt) && /WIPE/.test(dlgTxt), dlgTxt.slice(0, 200));
  if (OUT) await page.screenshot({ path: `${OUT}/new-campaign-confirm-desktop.png` });
  await page.click('[data-a="reset-cancel"]');
  check('New Campaign: Cancel changes nothing', (await page.evaluate(() => localStorage.getItem('minisquad.save'))) === beforeReset && !(await page.isVisible('.x-card')));
  // backup failure: nothing wiped
  await page.click('[data-a="reset-open"]');
  await page.evaluate(() => { window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'minisquad.save.pre-reset') throw new Error('quota'); return window.__origSet.call(this, k, v); }; });
  await page.click('[data-a="reset-confirm"]');
  const failNotice = await page.textContent('.m-notice');
  await page.evaluate(() => { Storage.prototype.setItem = window.__origSet; });
  check('New Campaign: if the backup cannot be written, nothing is wiped', (await page.evaluate(() => localStorage.getItem('minisquad.save'))) === beforeReset && /nothing was wiped/.test(failNotice), failNotice);
  await page.waitForTimeout(500);
  await page.click('[data-a="reset-open"]');
  await page.dblclick('[data-a="reset-confirm"]');
  await page.waitForTimeout(100);
  const rs = await page.evaluate(() => ({ sv: JSON.parse(localStorage.getItem('minisquad.save')), bk: JSON.parse(localStorage.getItem('minisquad.save.pre-reset')), notice: document.querySelector('.m-notice').textContent, owned: window.game.roster.owned().map((s) => s.id).join() }));
  check('New Campaign (double-tapped): genuine fresh save: Ace + Ranger, M1, 0 CR, no recruits/offers/stars', rs.owned === 'ace,ranger' && rs.sv.version === 5 && rs.sv.account.credits === 0 && rs.sv.roster.length === 6 && rs.sv.unlockedSoldiers.join() === 'ace,ranger' && rs.sv.account.campaign.unlockedMissions.join() === 'first-contact' && Object.keys(rs.sv.account.missions).length === 0 && rs.sv.account.recruitment.offers.length === 0 && rs.sv.account.recruitment.usedNames.length === 0 && rs.sv.account.squadTraining.hp === 0 && rs.sv.roster.every((s) => s.progression.xp === 0) && /New campaign started/.test(rs.notice), JSON.stringify(rs.sv.account).slice(0, 160));
  check('New Campaign: old save backed up once under minisquad.save.pre-reset (not overwritten by the 2nd tap)', rs.bk && rs.bk.save === beforeReset && rs.bk.at > 0, rs.bk ? rs.bk.save.length + ' chars' : 'none');

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(fails ? `\n${fails} FAILED` : '\nall barracks checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
