// Barracks / save / flow checks through the real UI, with page reloads:
// selection via taps, persistence, invalid-save recovery, dev tools not touching the save,
// no trait stacking across reloads, results -> retry / barracks, dev reset with confirmation.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';
(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(70)} ${detail}`); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('minisquad.save')));
  const slots = () => page.evaluate(() => [...window.game.roster.slots]);
  const reload = async (q = '') => { await page.goto(URL + q); await page.waitForTimeout(150); };

  await reload();
  let sv = await save();
  check('first launch: Barracks shown, save v1 written with 6 soldiers', await page.isVisible('#menu.barracks') && sv.version === 1 && sv.roster.length === 6, `version ${sv.version}, roster ${sv.roster.map((s) => s.id)}`);
  check('first launch: default squad Ace / Tank / Doc', sv.squad.join() === 'ace,tank,doc', sv.squad.join());
  check('save holds no runtime/effective stats', sv.roster.every((s) => Object.keys(s).sort().join() === 'classId,id,mods,name,progression,traitId'), Object.keys(sv.roster[0]).join());
  if (OUT) await page.screenshot({ path: `${OUT}/barracks-desktop.png` });

  // selection via the UI
  for (let i = 0; i < 3; i++) await page.click('.slot-x');
  check('removing all: Deploy disabled', await page.isDisabled('[data-a="deploy"]') && (await slots()).every((x) => x === null));
  for (const id of ['havoc', 'patch', 'ranger']) await page.click(`.s-card[data-id="${id}"] .pick`);
  const fullBtn = await page.textContent('.s-card[data-id="ace"] .pick');
  await page.click('.s-card[data-id="ace"] .pick'); // refused
  const notice = await page.textContent('.m-notice');
  check('UI: 3 picks fill the slots; a 4th is refused with feedback', (await slots()).join() === 'havoc,patch,ranger' && /FULL/.test(fullBtn) && /full/i.test(notice), `${(await slots()).join()} · button "${fullBtn}" · notice "${notice}"`);
  await page.click('.s-card[data-id="havoc"] .pick'); // remove havoc
  await page.click('.s-card[data-id="havoc"] .pick'); // re-add: goes to the first empty slot (1)
  check('UI: removed soldier re-added into the free slot, no duplicates', (await slots()).join() === 'havoc,patch,ranger', (await slots()).join());
  await page.click('.slot[data-slot="1"]'); // choose slot 2 for replacement
  const hint = await page.textContent('.m-hint');
  await page.click('.s-card[data-id="ace"] .pick');
  check('UI: tap slot 2, then Ace -> replaces Patch', (await slots()).join() === 'havoc,ace,ranger' && /slot 2/.test(hint), `${(await slots()).join()} · hint "${hint}"`);
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
  check('selection persists after reload', (await slots()).join() === 'havoc,ace,ranger', (await slots()).join());
  // dev tools must not overwrite the saved squad
  await page.keyboard.press('Backquote');
  await page.selectOption('#tuning select', 'hh');
  const genericIds = await page.evaluate(() => window.game.soldiers.map((s) => s.identity.id + ':' + (s.identity.traitId || '-')));
  check('dev preset deploys generic soldiers (no traits)', genericIds.length === 2 && genericIds.every((x) => /^G\d+:-$/.test(x)), genericIds.join());
  await page.keyboard.press('Backquote');
  await reload();
  check('dev preset did not change the saved squad', (await slots()).join() === 'havoc,ace,ranger', (await slots()).join());
  await reload('?squad=doc,tank');
  const tmp = await page.evaluate(() => ({ ids: window.game.soldiers.map((s) => s.identity.id), kind: window.game.deployment.kind, saved: JSON.parse(localStorage.getItem('minisquad.save')).squad }));
  check('?squad=doc,tank deploys roster soldiers temporarily, save untouched', tmp.ids.join() === 'doc,tank' && tmp.kind === 'temp' && tmp.saved.join() === 'havoc,ace,ranger', JSON.stringify(tmp));
  await reload('?squad=ihm');
  check('?squad=ihm preset still works (generic Inf+Heavy+Medic)', (await page.evaluate(() => window.game.soldiers.map((s) => s.identity.classId).join())) === 'infantry,heavy,medic');

  // deploy via UI, no trait stacking across reloads / retries
  const stacks = [];
  for (let i = 0; i < 3; i++) {
    await reload();
    await page.click('[data-a="deploy"]');
    for (let k = 0; k < 2; k++) await page.evaluate(() => window.game.reset());
    stacks.push(await page.evaluate(() => window.game.soldiers.map((s) => `${s.identity.id}:${s.maxHp}:${Math.round(s.fireRate * 1000) / 1000}:${s.stats.accuracy}`).join(' ')));
  }
  check('Deploy (UI) uses the saved squad; no stacking across 3 reloads x 3 deploys', stacks.every((x) => x === stacks[0]) && stacks[0] === 'havoc:150:7.35:15 ace:100:3:10.8 ranger:100:3:12', stacks[0]);
  sv = await save();
  check('a mission writes no combat state into the save', JSON.stringify(sv).match(/"hp"|"state"|"kills"|"cooldown"/) === null && sv.squad.join() === 'havoc,ace,ranger');

  // results: victory -> retry via Enter; defeat -> Return to Barracks
  await page.evaluate(() => { const g = window.game; g.soldiers[1].state = 'kia'; g.win(); });
  await page.waitForTimeout(100);
  if (OUT) await page.screenshot({ path: `${OUT}/results-victory-desktop.png` });
  await page.keyboard.press('Enter');
  const afterRetry = await page.evaluate(() => ({ phase: window.game.phase, st: window.game.soldiers.map((s) => s.state).join() }));
  check('results: Enter = Retry Mission (fresh squad)', afterRetry.phase === 'playing' && afterRetry.st === 'active,active,active', JSON.stringify(afterRetry));
  await page.evaluate(() => { const g = window.game; g.soldiers.forEach((s) => g.downSoldier(s)); g.soldiers[0].state = 'kia'; });
  await page.waitForTimeout(100);
  if (OUT) await page.screenshot({ path: `${OUT}/results-defeat-desktop.png` });
  await page.click('[data-a="barracks"]');
  check('results: Return to Barracks', await page.isVisible('#menu.barracks') && (await page.evaluate(() => window.game.phase)) === 'start');

  // invalid save recovery
  const cases = [
    ['garbage text', 'not json {', 'reset'],
    ['future version', JSON.stringify({ version: 99, roster: [], squad: [] }), 'reset'],
    ['roster not an array', JSON.stringify({ version: 1, roster: 'x', squad: [] }), 'reset'],
    ['bad trait + bad class + crazy mods', null, 'repaired'],
    ['duplicate + unknown squad ids', null, 'repaired'],
  ];
  const good = sv;
  cases[3][1] = JSON.stringify({ ...good, roster: good.roster.map((s, i) => i === 0 ? { ...s, traitId: 'godmode' } : i === 1 ? { ...s, classId: 'sniper' } : i === 2 ? { ...s, mods: { hpMul: 1e9 } } : s) });
  cases[4][1] = JSON.stringify({ ...good, squad: ['tank', 'tank', 'ghost'] });
  for (const [name, raw, expectStatus] of cases) {
    await page.evaluate((r) => localStorage.setItem('minisquad.save', r), raw);
    await reload();
    const st = await page.evaluate(() => ({
      status: window.__loadStatus.status, n: window.game.roster.soldiers.length, slots: window.game.roster.slots.join(),
      traits: window.game.roster.soldiers.map((s) => s.traitId).join(), tankHp: window.__effectiveStats(window.game.roster.get('tank')).hp,
      cards: document.querySelectorAll('.s-card').length, backup: localStorage.getItem('minisquad.save.invalid'), saved: JSON.parse(localStorage.getItem('minisquad.save')),
    }));
    const okBase = st.status === expectStatus && st.n === 6 && st.cards === 6 && st.traits === 'sharpshooter,quickReflexes,tough,triggerHappy,firstResponder,healer' && st.tankHp === 165 && st.saved.version === 1;
    const okSlots = name.startsWith('duplicate') ? st.slots === 'tank,,' : true;
    const okBackup = expectStatus === 'reset' ? st.backup === raw : true;
    check(`invalid save recovers: ${name}`, okBase && okSlots && okBackup, `status ${st.status}, slots ${st.slots}, tank hp ${st.tankHp}${expectStatus === 'reset' ? ', backup kept' : ''}`);
  }
  check('no page errors during save recovery', errors.length === 0, errors.join(' | '));

  // dev reset with confirmation
  await page.evaluate(() => localStorage.setItem('minisquad.save', JSON.stringify({ version: 1, roster: [], squad: ['patch', null, null] })));
  await reload();
  await page.keyboard.press('Backquote');
  await page.click('[data-a="resetSave"]');
  const armed = { slots: (await slots()).join(), label: await page.textContent('[data-a="resetSave"]') };
  await page.click('[data-a="resetSave"]');
  const after = { slots: (await slots()).join(), saved: (await save()).squad.join() };
  check('dev reset: first tap only arms it; second tap resets to defaults', armed.slots === 'patch,,' && /again/i.test(armed.label) && after.slots === 'ace,tank,doc' && after.saved === 'ace,tank,doc', `${armed.slots} "${armed.label}" -> ${after.slots}`);

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(fails ? `\n${fails} FAILED` : '\nall barracks checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
