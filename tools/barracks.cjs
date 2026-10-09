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
  check('first launch: Campaign shown, save v3 written with 6 soldiers', await page.isVisible('#menu.campaign') && sv.version === 3 && sv.account && sv.account.credits === 0 && sv.roster.length === 6, `version ${sv.version}, roster ${sv.roster.map((s) => s.id)}`);
  check('first launch: Ace + Ranger unlocked and selected; Mission 1 only', sv.squad.filter(Boolean).join() === 'ace,ranger' && sv.unlockedSoldiers.join() === 'ace,ranger' && sv.account.campaign.unlockedMissions.join() === 'first-contact' && sv.account.campaign.selectedMission === 'first-contact', `${sv.squad} · ${sv.unlockedSoldiers} · ${JSON.stringify(sv.account.campaign)}`);
  check('save holds no runtime/effective stats', sv.roster.every((s) => Object.keys(s).sort().join() === 'classId,id,mods,name,progression,resurrections,service,status,training,traitId'), Object.keys(sv.roster[0]).join());
  await toBarracks();
  if (OUT) await page.screenshot({ path: `${OUT}/barracks-desktop-new-player.png` });
  const locked = await page.evaluate(() => [...document.querySelectorAll('.s-card.locked')].map((c) => c.dataset.id + ':' + c.textContent.replace(/\s+/g, ' ').trim()));
  check('locked soldiers shown as LOCKED with how to unlock them', locked.length === 4 && /tank.*Mission 1/.test(locked.join('|')) && /doc.*Mission 2/.test(locked.join('|')) && /havoc.*Mission 5/.test(locked.join('|')) && /patch.*Mission 7/.test(locked.join('|')), locked.map((x) => x.slice(0, 70)).join(' | '));
  await page.click('.s-card[data-id="tank"] .pick');
  check('tapping a locked soldier never selects them (notice instead)', (await slots()) === 'ace,ranger' && /locked/i.test(await page.textContent('.m-notice')), await page.textContent('.m-notice'));
  check('Mission 1: 2 slots shown (SQUAD 2/2)', (await page.evaluate(() => document.querySelectorAll('.slot').length)) === 2, '');

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
  for (let i = 0; i < 2; i++) await page.click('.slot-x');
  check('removing all: Deploy disabled', await page.isDisabled('[data-a="deploy"]') && (await slots()) === '');
  for (const id of ['havoc', 'patch', 'ranger']) await page.click(`.s-card[data-id="${id}"] .pick`);
  const fullBtn = await page.textContent('.s-card[data-id="ace"] .pick');
  await page.click('.s-card[data-id="ace"] .pick'); // refused
  const notice = await page.textContent('.m-notice');
  check('UI: 3 picks fill Mission 3\'s slots; a 4th is refused with feedback', (await slots()) === 'havoc,patch,ranger' && /FULL/.test(fullBtn) && /full/i.test(notice), `${await slots()} · button "${fullBtn}" · notice "${notice}"`);
  await page.click('.s-card[data-id="havoc"] .pick'); // remove havoc
  await page.click('.s-card[data-id="havoc"] .pick'); // re-add: appended (packed list)
  check('UI: removed soldier re-added at the end, no duplicates', (await slots()) === 'patch,ranger,havoc', await slots());
  await page.click('.slot[data-slot="1"]'); // choose slot 2 for replacement
  const hint = await page.textContent('.m-hint');
  await page.click('.s-card[data-id="ace"] .pick');
  check('UI: tap slot 2, then Ace -> replaces Ranger', (await slots()) === 'patch,ace,havoc' && /slot 2/.test(hint), `${await slots()} · hint "${hint}"`);
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
  await page.evaluate(() => { const g = window.game; g.soldiers[1].state = 'kia'; g.win(); });
  await page.waitForTimeout(100);
  if (OUT) await page.screenshot({ path: `${OUT}/results-victory-desktop.png` });
  await page.keyboard.press('Enter');
  const afterRetry = await page.evaluate(() => ({ phase: window.game.phase, st: window.game.soldiers.map((s) => s.state).join(), m: window.game.missionId }));
  check('results: Enter = Retry the same mission (fresh squad)', afterRetry.phase === 'playing' && afterRetry.st === 'active,active,active' && afterRetry.m === 'field-medicine', JSON.stringify(afterRetry));
  await page.evaluate(() => { const g = window.game; g.soldiers.forEach((s) => g.downSoldier(s)); g.soldiers[0].state = 'kia'; });
  await page.waitForTimeout(100);
  if (OUT) await page.screenshot({ path: `${OUT}/results-defeat-desktop.png` });
  await page.click('[data-a="campaign"]');
  check('results: Campaign button', await page.isVisible('#menu.campaign') && (await page.evaluate(() => window.game.phase)) === 'start');
  await page.click('[data-a="deploy"]');
  await page.evaluate(() => { const g = window.game; g.soldiers.forEach((s) => g.downSoldier(s)); g.soldiers[0].state = 'kia'; });
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
    const okBase = st.status === expectStatus && st.n === 6 && st.cards === 6 && st.traits === 'sharpshooter,quickReflexes,tough,triggerHappy,firstResponder,healer' && st.tankHp === 165 && st.saved.version === 3;
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

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(fails ? `\n${fails} FAILED` : '\nall barracks checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
