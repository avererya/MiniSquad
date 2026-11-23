// v0.9D.2 mission credit scaling: the Victory credit line grows with the mission number (first clear 500 + 25 (n - 1),
// replay 400 + 25 (n - 1)); every other reward rule is unchanged.
//  A. Pure reward math (computeMissionRewards / victoryCredits): Mission 1 unchanged, Missions 5 / 10 / 15 / 20 / 25 by
//     the formula, bonus lines flat, overlap rule (M3 / M6 / M10), applied once, unknown ids = Mission 1, failures pay 0
//  B. XP and every price unchanged (Victory XP curve, replay x0.75, training / squad / capacity / recruit /
//     resurrection / promotion prices)
//  C. Settlement (settleMission): first clear pays the one-time +250 exactly once, a replay never does, a failure pays 0
//  D. A real mission end through the game (Mission 20 first clear + replay): Results breakdown = awarded = saved
//  E. Saves: every fixture loads with its Credits intact, SAVE_VERSION unchanged
// Usage: npm test -- v09d2   (or: npx vite preview --port 4173 & node tools/v09d2.cjs)
const fs = require('fs');
const { chromium, URL, createChecks, runSuite, openPage } = require('./lib.cjs');

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 84 });
  const browser = await chromium.launch();
  const page = await openPage(browser, URL, { seed: 4242 });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ---------------- A. pure reward math ----------------
  const a = await ev(() => {
    const P = window.__progression, C = window.__campaign;
    const id = (n) => C.CAMPAIGN.find((m) => m.number === n)?.id;
    const out = (mid, o = {}) => ({
      missionId: mid, runId: 'x', won: o.won ?? true,
      deployed: (o.statuses ?? ['Standing', 'Standing']).map((s, i) => ({ id: 's' + i, status: s, downs: o.downs?.[i] ?? 0 })),
      optional: { total: o.total ?? 0, completed: o.done ?? 0, list: o.list },
    });
    const r = (mid, first, o, paid) => { const x = P.computeMissionRewards(out(mid, o), first, paid); return { credits: x.credits, lines: x.creditLines.map((l) => `${l.label}=${l.amount}`).join(', '), sum: x.creditLines.reduce((s, l) => s + l.amount, 0), xp: x.xpEach }; };
    const kia = { statuses: ['Standing', 'KIA'] }; // no whole-squad / nobody-downed lines
    const res = { table: {}, perfect: {}, misc: {} };
    for (const n of [1, 5, 10, 15, 20]) {
      res.table[n] = { firstBase: r(id(n), true, kia), replayBase: r(id(n), false, kia), vFirst: P.victoryCredits(id(n), true), vReplay: P.victoryCredits(id(n), false) };
    }
    // Mission 25 does not exist yet: the formula itself (perMission x 24) and the unknown-id fallback
    res.misc.m25 = { first: P.PROGRESSION.credits.victory + P.PROGRESSION.credits.perMission * 24, replay: P.PROGRESSION.credits.replayVictory + P.PROGRESSION.credits.perMission * 24 };
    res.misc.unknown = [P.victoryCredits('no-such-mission', true), P.victoryCredits('no-such-mission', false)];
    // perfect runs: every optional, whole squad, nobody downed
    res.perfect.m1First = r(id(1), true, {});
    res.perfect.m1Replay = r(id(1), false, {});
    res.perfect.m20First = r(id(20), true, { total: 2, done: 2 });
    res.perfect.m20Replay = r(id(20), false, { total: 2, done: 2 });
    res.perfect.m15Replay1of1 = r(id(15), false, { total: 1, done: 1 });
    res.perfect.m20Downed = r(id(20), false, { total: 2, done: 1, downs: [1, 0] }); // whole squad yes, nobody downed no
    // overlap rule: Mission 10's optional replaces the whole-squad line
    res.perfect.m10Replay = r(id(10), false, { total: 1, done: 1, list: [{ id: 'no-kia', label: 'No soldier KIA', completed: true, replaces: 'fullExtraction' }] });
    res.perfect.m10ReplayNoOpt = r(id(10), false, { total: 1, done: 0, list: [{ id: 'no-kia', label: 'No soldier KIA', completed: false, replaces: 'fullExtraction' }] });
    // first clear whose first-time bonus was already paid (legacy Mission 3 rule)
    res.perfect.m3LegacyPaid = r(id(3), true, kia, true);
    res.fail = [1, 10, 20].map((n) => r(id(n), true, { won: false, total: 1, done: 1 }));
    res.failReplay = r(id(20), false, { won: false });
    res.const = { ...P.PROGRESSION.credits };
    return res;
  });
  const T = a.table;
  check('A1 Mission 1 unchanged: first clear 750 (500 + 250), replay 400, Victory line 500 / 400', T[1].firstBase.credits === 750 && T[1].replayBase.credits === 400 && T[1].vFirst === 500 && T[1].vReplay === 400, JSON.stringify(T[1]));
  check('A2 Mission 1 perfect unchanged: first 1,000 (500+100+150+250), replay 650 (400+150+100)', a.perfect.m1First.credits === 1000 && a.perfect.m1Replay.credits === 650, `${a.perfect.m1First.lines} | ${a.perfect.m1Replay.lines}`);
  const want = { 5: [850, 500], 10: [975, 625], 15: [1100, 750], 20: [1225, 875] };
  for (const n of [5, 10, 15, 20]) {
    const [f, rp] = want[n];
    check(`A3 Mission ${n}: first clear before bonuses ${f} (Victory ${f - 250} + 250), replay base ${rp}`, T[n].firstBase.credits === f && T[n].replayBase.credits === rp && T[n].vFirst === f - 250 && T[n].vReplay === rp, `${T[n].firstBase.lines} | ${T[n].replayBase.lines}`);
  }
  check('A4 formula at Mission 25: Victory 1,100 first clear (1,350 with the bonus), replay 1,000', a.misc.m25.first === 1100 && a.misc.m25.first + 250 === 1350 && a.misc.m25.replay === 1000, JSON.stringify(a.misc.m25));
  check('A5 unknown mission id = Mission 1 values', a.misc.unknown.join() === '500,400', a.misc.unknown.join());
  check('A6 Mission 20 perfect: first 1,225 + 300 + 150 + 100 = 1,775; replay 875 + 300 + 150 + 100 = 1,425', a.perfect.m20First.credits === 1775 && a.perfect.m20Replay.credits === 1425, `${a.perfect.m20First.lines} | ${a.perfect.m20Replay.lines}`);
  check('A7 bonus lines flat: optional +150 each, whole squad +150, nobody downed +100 (Missions 15 / 20)', a.perfect.m15Replay1of1.lines === 'Victory (replay)=750, Optional objectives 1/1=150, Whole squad extracted=150, Nobody downed=100' && a.perfect.m20Downed.lines === 'Victory (replay)=875, Optional objectives 1/2=150, Whole squad extracted=150', `${a.perfect.m15Replay1of1.lines} | ${a.perfect.m20Downed.lines}`);
  check('A8 overlap rule kept: Mission 10 optional replaces the whole-squad line (replay 625 + 150 + 100 = 875; without it 625 + 100)', a.perfect.m10Replay.credits === 875 && !/Whole squad/.test(a.perfect.m10Replay.lines) && a.perfect.m10ReplayNoOpt.credits === 725, `${a.perfect.m10Replay.lines} | ${a.perfect.m10ReplayNoOpt.lines}`);
  check('A9 scaling applied once: exactly one Victory line, the total equals the sum of the lines', Object.values(T).every((t) => [t.firstBase, t.replayBase].every((x) => x.sum === x.credits && (x.lines.match(/Victory/g) || []).length === 1)) && [a.perfect.m20First, a.perfect.m20Replay].every((x) => x.sum === x.credits), JSON.stringify(T[20]));
  check('A10 the legacy "first-time bonus already paid" rule still skips only the +250 (Mission 3: 550)', a.perfect.m3LegacyPaid.credits === 550 && !/First-time/.test(a.perfect.m3LegacyPaid.lines), a.perfect.m3LegacyPaid.lines);
  check('A11 failed missions pay 0 CR and no credit lines (Missions 1 / 10 / 20, first clear or replay)', a.fail.every((x) => x.credits === 0 && x.lines === '') && a.failReplay.credits === 0, JSON.stringify(a.fail));
  check('A12 the other credit constants are unchanged (victory 500, replay 400, optional 150, whole squad 150, nobody downed 100, first clear 250; step 25)', JSON.stringify(a.const) === JSON.stringify({ victory: 500, replayVictory: 400, perMission: 25, perOptionalObjective: 150, fullExtraction: 150, flawless: 100, firstClear: 250 }), JSON.stringify(a.const));

  // ---------------- B. XP and prices unchanged ----------------
  const b = await ev(() => {
    const P = window.__progression, R = window.__recruitment, K = window.__casualties, C = window.__campaign;
    const id = (n) => C.CAMPAIGN.find((m) => m.number === n)?.id;
    const o = (mid) => ({ missionId: mid, runId: 'x', won: true, deployed: [{ id: 'a', status: 'Standing', downs: 0 }], optional: { total: 0, completed: 0 } });
    return {
      vxp: [1, 5, 10, 15, 20].map((n) => P.victoryXp(id(n))),
      xpFirst: P.computeMissionRewards(o(id(20)), true).xpEach, xpReplay: P.computeMissionRewards(o(id(20)), false).xpEach,
      xpCfg: JSON.stringify(P.PROGRESSION.xp), levels: JSON.stringify(P.PROGRESSION.levels), growth: JSON.stringify(P.PROGRESSION.growth),
      train: P.TRAINING.damage.costs.join(), squad: P.SQUAD_TRAINING.hp.costs.join(), cap: P.ABILITY_CAPACITY.costs.join(),
      recruit: R.RECRUIT_CLASSES.map((c) => `${c.classId}:${c.price}`).join(), refresh: R.REFRESH_COST,
      res: K.RESURRECTION_PRICES.join(), resElite: K.resurrectionCost(0, 'elite'),
    };
  });
  check('B1 Victory XP curve unchanged (125 / 150 / 200 / 250 / 300) and replay x0.75 (M20 first 300 + 25 + 25 = 350, replay 263)', b.vxp.join() === '125,150,200,250,300' && b.xpFirst === 350 && b.xpReplay === 263 && b.xpCfg === JSON.stringify({ victory: null, perOptionalObjective: 25, fullExtraction: 25, flawless: 25, replayMul: 0.75 }), `${b.vxp} ${b.xpFirst}/${b.xpReplay} ${b.xpCfg}`);
  check('B2 levels and growth unchanged', b.levels === '{"cap":25,"base":150,"step":25}' && b.growth === '{"hp":0.01,"damage":0.0075,"fireRate":0.005}', `${b.levels} ${b.growth}`);
  check('B3 training, squad training and Ability Capacity prices unchanged', b.train === '250,400,550,700,900,1150,1450,1750,2100,2500' && b.squad === '1000,1500,2000,2750,3500,4500,5500,7000,8500,10000' && b.cap === '1500,3000', `${b.train} | ${b.squad} | ${b.cap}`);
  check('B4 recruit, refresh and resurrection prices unchanged', b.recruit === 'infantry:750,heavy:1000,medic:1000,sniper:1250,commando:1250,demolitions:1500' && b.refresh === 100 && b.res === '1000,2000,3500,5000,7000,8500,10000' && b.resElite === 2000, `${b.recruit} | ${b.res} | elite ${b.resElite}`);

  // ---------------- C. settlement: first clear once, replay never, failure 0 ----------------
  const c = await ev(() => {
    const g = window.game, A = window.__account(), E = window.__economy;
    window.__debugUnlockAll();
    const run = (mid, won, n) => {
      const before = A.credits;
      const rw = E.settleMission(g.roster, A, { missionId: mid, runId: `v09d2-${mid}-${n}`, won, deployed: [{ id: 'ace', status: 'Standing', downs: 0 }, { id: 'ranger', status: 'Standing', downs: 0 }], optional: { total: 0, completed: 0 }, stars: won ? 2 : 0 });
      return { paid: A.credits - before, credits: rw.credits, first: rw.firstClear, lines: rw.creditLines.map((l) => l.label).join(', ') };
    };
    const fail = run('iron-fist', false, 0);
    const first = run('iron-fist', true, 1);
    const replay = run('iron-fist', true, 2);
    const replay2 = run('iron-fist', true, 3);
    const failAfter = run('iron-fist', false, 4);
    const dup = E.settleMission(g.roster, A, { missionId: 'iron-fist', runId: 'v09d2-iron-fist-1', won: true, deployed: [], optional: { total: 0, completed: 0 } });
    return { fail, first, replay, replay2, failAfter, dup, completions: A.missions['iron-fist'].completions };
  });
  check('C1 a failed attempt before the first clear pays 0 and does not use up the first clear', c.fail.paid === 0 && c.fail.credits === 0 && !c.fail.first, JSON.stringify(c.fail));
  check('C2 Mission 10 first clear, whole squad and nobody downed: 725 + 150 + 100 + 250 = 1,225, with the +250', c.first.first && c.first.paid === 1225 && /First-time completion/.test(c.first.lines), JSON.stringify(c.first));
  check('C3 replays pay 625 + 150 + 100 = 875 and never the first-time bonus', !c.replay.first && !c.replay2.first && c.replay.paid === 875 && c.replay2.paid === 875 && !/First-time/.test(c.replay.lines + c.replay2.lines) && /Victory \(replay\)/.test(c.replay.lines), `${JSON.stringify(c.replay)} ${JSON.stringify(c.replay2)}`);
  check('C4 a failed replay pays 0; a settled run id never pays twice', c.failAfter.paid === 0 && c.dup === null && c.completions === 3, `${JSON.stringify(c.failAfter)} dup ${c.dup} completions ${c.completions}`);

  // ---------------- D. a real mission end (Mission 20) ----------------
  const d = await ev(() => {
    const g = window.game, A = window.__account(), P = window.__progression;
    window.__debugUnlockAll();
    const ids = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'];
    for (const id of ids) { const s = g.roster.get(id); s.progression.xp = P.xpForLevel(14); s.progression.level = 14; }
    const play = () => {
      g.selectMission('warlord-hq', true);
      const r = g.deploy(ids.map((id) => g.roster.get(id)), 'roster');
      if (!r.ok) return { error: r.reason };
      if (g.modal === 'story') g.story.skip(g);
      const before = A.credits;
      g.win();
      const rw = g.lastReward;
      const saved = JSON.parse(localStorage.getItem('minisquad.save') || '{}').account?.credits;
      const text = (document.getElementById('menu')?.textContent || '').replace(/\s+/g, ' ');
      return { paid: A.credits - before, credits: rw.credits, lines: rw.creditLines.map((l) => `${l.label}=${l.amount}`).join(', '), first: rw.firstClear, saved, now: A.credits, text };
    };
    return { first: play(), replay: play() };
  });
  // a win() with nobody downed: whole squad + nobody downed; Mission 20's two optionals are not done
  const m20f = 1225 + 150 + 100, m20r = 875 + 150 + 100;
  check(`D1 Mission 20 first clear through the game pays ${m20f} (Victory 975 + 150 + 100 + First-time 250) and saves it`, d.first.first && d.first.paid === m20f && d.first.credits === m20f && d.first.saved === d.first.now && /Victory=975/.test(d.first.lines) && /First-time completion=250/.test(d.first.lines), `${d.first.error || ''} ${d.first.lines} paid ${d.first.paid} saved ${d.first.saved}/${d.first.now}`);
  check(`D2 Mission 20 replay through the game pays ${m20r} (Victory (replay) 875 + 150 + 100), no first-time bonus`, !d.replay.first && d.replay.paid === m20r && d.replay.saved === d.replay.now && /Victory \(replay\)=875/.test(d.replay.lines) && !/First-time/.test(d.replay.lines), `${d.replay.lines} paid ${d.replay.paid}`);
  const shows = (x, v, total) => x.text && x.text.replace(/[ ,]/g, '').includes(`+${v}`) && x.text.replace(/[ ,]/g, '').includes(String(total));
  check('D3 the Results screen shows the scaled Victory amount and the awarded total', shows(d.first, 975, m20f) && shows(d.replay, 875, m20r), d.replay.text ? d.replay.text.slice(0, 220) : 'no Results text');

  // ---------------- E. saves ----------------
  const fx = [];
  for (const dir of ['fixtures', 'fixtures-v08b']) for (const f of fs.readdirSync(__dirname + '/' + dir)) {
    const raw = fs.readFileSync(__dirname + '/' + dir + '/' + f, 'utf8');
    let want; try { want = JSON.parse(raw).account?.credits; } catch { want = undefined; }
    const p = await openPage(browser, URL, { save: raw });
    const r = await p.evaluate(() => ({ st: window.__loadStatus.status, cr: window.__account().credits }));
    fx.push(`${f}:${r.st}:${typeof want === 'number' ? (r.cr === Math.max(0, Math.floor(want)) ? 'cr-ok' : `cr ${want}->${r.cr}`) : 'cr-n/a'}`);
    await p.context().close();
  }
  check('E1 every save fixture loads and keeps its Credits', fx.every((x) => /:(loaded|migrated):(cr-ok|cr-n\/a)$/.test(x)), fx.join(' '));
  const sv = +((fs.readFileSync(__dirname + '/../src/save.ts', 'utf8').match(/SAVE_VERSION = (\d+)/) || [])[1]);
  check('E2 save format unchanged: SAVE_VERSION 9', sv === 9, `SAVE_VERSION ${sv}`);

  check('page errors: none', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await browser.close();
  return finish();
});
