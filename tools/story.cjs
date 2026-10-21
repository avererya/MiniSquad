// v0.8C.1 rule checks: the story / cinematic system (src/story.ts, src/storyview.ts) and its Mission 15 scenes.
// Headless Chromium, fixed 1/60 s steps through window.game (the live frame loop is paused with game.paused where a
// check taps the real DOM, so nothing advances between two taps on its own).
//  A. Data: the approved lines, speakers, no recruit names, Missions 1-14 have no story, text-only (no artwork)
//  B. Pre-boss cinematic: opens when the assault completes (Voss's encounter), once per attempt, blocks the
//     simulation (no damage, no shots, no bleed-out, no mission time, abilities / support refused), auto-advance
//     8-12 s, the 1.5 s entrance still runs after it, tap-through (DOM), keys (Enter / Space / Esc), SKIP at
//     every panel resumes the fight, tap guard, pause freezes the auto-advance
//  C. Phase lines: 70% / 35% thresholds, once each, never pause combat, one big hit queues both in order without
//     overlap, the boss phases still progress, the radio strip clears the boss bar / banners / controls
//  D. Post-boss cinematic: waits for the defenders-clear objective (not Voss's death), blocks, auto-advance or
//     Skip, then the normal extraction (no auto-win), rewards / stars / Demolitions unlock identical either way
//  E. Replay / restart / reload reset the per-attempt cues; no save fields
//  F. BASE (v0.8C): every CFG group and Missions 1-15 (groups, objectives, extraction) unchanged; the same scripted
//     Mission 15 win pays the same XP / Credits / stars and unlocks the Demolitions Expert
//  G. Phones (iPhone SE / 14 / Pixel 7 landscape): panel, text and SKIP fit (SKIP >= 44 CSS px), touch advances
//     and skips, enemy panel, radio strip clear of the HUD
// Usage: npm test -- story   (or: npx vite preview --port 4173 & BASE=<v0.8C url> node tools/story.cjs)
const { chromium, URL, BASE, OUT, createChecks, runSuite } = require('./lib.cjs');
const fs = require('fs');

function installHelpers() {
  window.S = {
    get g() { return window.game; },
    get st() { return window.__story; },
    SQUAD: ['infantry', 'infantry', 'heavy', 'medic', 'heavy', 'demolitions'],
    SIX: ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'],
    step(sec, pin) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (pin) pin(i); window.game.update(1 / 60); } },
    stepUntil(cond, maxSec, pin) { let n = 0; const max = Math.round(maxSec * 60); while (n < max && !cond()) { if (pin) pin(n); window.game.update(1 / 60); n++; } return n / 60; },
    pinAt(p, spread = 30) { const g = window.game; let i = 0; for (const s of g.soldiers) if (s.active) { s.pos = { x: p.x + ((i % 3) - 1) * spread, y: p.y + (Math.floor(i / 3) - 0.5) * spread }; s.vel = { x: 0, y: 0 }; i++; } g.anchor = { ...p }; },
    kill(pred) { const g = window.game; for (const e of g.enemies.filter((x) => x.active && pred(x))) g.damage(e, 1e6, g.soldiers[0]); this.step(0.1); },
    /** Every standing enemy soldier (not Voss) removed. */
    calm() { const g = window.game; for (const e of g.enemies) if (!e.structure && !e.vehicle && e.kind !== 'general') e.state = 'dead'; g.enemies = g.enemies.filter((e) => e.active); },
    /**
     * Mission 15 through the real objective chain (Game.damage kills, invulnerable squad) up to the arena's front
     * guard; `last` = also kill the front guard, so the Voss objective starts (and with it the pre-boss cinematic).
     */
    toArena({ roster = null, at = { x: 3600, y: 1200 }, last = true } = {}) {
      const g = window.game;
      g.selectMission('last-stand', true);
      if (roster) { const r = g.deploy(roster.map((id) => g.roster.get(id)), 'roster'); if (!r.ok) throw new Error(r.reason); } else g.reset(this.SQUAD);
      const m = g.mission; g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
      const log = [];
      const note = () => log.push(`${m.currentObjective ? m.currentObjective.id : m.phase}:${g.modal}:${g.story.log.length}`);
      this.kill((e) => e.tag === 'outer-field' || e.tag === 'outer-wall'); note();
      this.kill((e) => e.structure === 'generator'); note();
      this.kill((e) => e.structure === 'relay'); note();
      this.pinAt(at); g.cam = { ...at };
      if (last) this.kill((e) => e.tag === 'arena-front');
      return { g, m, log };
    },
    /** Hit-box helpers for DOM checks (CSS px). */
    rect(el) { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; },
    overlap(a, b) { return a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5; },
    store() { return localStorage.getItem(window.__SAVE_KEY); },
  };
}

/** Page-side: CFG groups and Missions 1-15 as data (compared against BASE). */
function snapshot() {
  const C = window.__CFG, g = window.game, out = { cfg: {}, missions: {} };
  for (const k of Object.keys(C).sort()) out.cfg[k] = JSON.stringify(C[k]);
  window.__debugUnlockAll();
  for (const d of window.__campaign.CAMPAIGN.filter((x) => x.playable)) {
    g.selectMission(d.id, true); g.reset(['infantry', 'heavy', 'medic']);
    const m = g.mission;
    out.missions[d.id] = JSON.stringify({
      map: m.map.obstacles.length + ':' + m.map.w + 'x' + m.map.h,
      enemies: g.enemies.map((e) => `${e.kind}:${e.tag}:${e.maxHp}:${e.structure || ''}`).sort(),
      obj: m.primaries.map((o) => o.id + ':' + o.label), opt: m.optionals.map((o) => o.id), triggers: m.script.triggers.map((t) => t.id),
      zone: JSON.stringify(m.script.extraction.zone), cd: m.script.extraction.countdown(), general: JSON.stringify(m.script.general || null),
      lockdown: JSON.stringify(m.script.lockdown || null), def: JSON.stringify({ ...d, brief: undefined }),
    });
  }
  return out;
}

/**
 * Page-side: Mission 15 won through the real chain from a fresh save where it is unlocked but not cleared (the
 * Demolitions Expert locked). `story`: 'skip' closes each cinematic at once, 'auto' lets it play out, null = a build
 * without the story system (BASE). Returns the settlement.
 */
function scriptedWin(story) {
  const g = window.game, a = window.__account();
  window.__debugUnlockAll();
  a.classUnlocks.unlocked = a.classUnlocks.unlocked.filter((c) => c !== 'demolitions');
  const SIX = ['ace', 'ranger', 'tank', 'doc', 'havoc', 'patch'];
  g.selectMission('last-stand', true);
  const r = g.deploy(SIX.map((id) => g.roster.get(id)), 'roster');
  if (!r.ok) return { err: r.reason };
  const m = g.mission; g.invuln = true; g.input.move = () => ({ x: 0, y: 0 });
  const step = (sec) => { for (let i = 0, n = Math.round(sec * 60); i < n; i++) g.update(1 / 60); };
  const until = (cond, sec) => { let n = 0; while (n < sec * 60 && !cond()) { g.update(1 / 60); n++; } return n; };
  const close = () => { if (!g.story) return; if (story === 'skip') g.story.skip(g); else until(() => !g.story.scene, 20); };
  const kill = (pred) => { for (const e of g.enemies.filter((x) => x.active && pred(x))) g.damage(e, 1e6, g.soldiers[0]); step(0.1); };
  const pin = (p) => { let i = 0; for (const s of g.soldiers) { s.pos = { x: p.x + (i % 3) * 30 - 30, y: p.y + Math.floor(i / 3) * 30 - 15 }; s.vel = { x: 0, y: 0 }; i++; } g.anchor = { ...p }; };
  kill((e) => e.tag === 'outer-field' || e.tag === 'outer-wall');
  kill((e) => e.structure === 'generator');
  kill((e) => e.structure === 'relay');
  pin({ x: 3600, y: 1200 }); g.cam = { x: 3600, y: 1200 };
  kill((e) => e.tag === 'arena-front');
  const opened = g.story ? g.story.log.slice() : [];
  close();
  const V = m.general.unit;
  g.damage(V, V.maxHp * 0.8, g.soldiers[0]); step(7);
  kill((e) => e === V);
  for (let i = 0; i < 6 && m.currentObjective; i++) { kill((e) => e.team === 'enemy' && !e.structure && !e.vehicle); step(1); }
  close();
  const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
  const put = () => [...g.soldiers, ...g.allies].forEach((s, i) => { if (s.active) { s.pos = { x: c.x - 60 + (i % 4) * 40, y: c.y - 40 + Math.floor(i / 4) * 40 }; s.vel = { x: 0, y: 0 }; } });
  let n = 0; while (g.phase === 'playing' && n < 60 * 60) { put(); g.anchor = { ...c }; g.update(1 / 60); n++; }
  const rw = g.lastReward;
  return {
    phase: g.phase, opened, log: g.story ? g.story.log.slice() : [],
    stars: g.lastStars && JSON.stringify(g.lastStars),
    reward: rw && JSON.stringify({ won: rw.won, xpEach: rw.xpEach, credits: rw.credits, xpLines: rw.xpLines, creditLines: rw.creditLines, unlockedClasses: rw.unlockedClasses, unlocked: rw.unlocked }),
    demo: a.classUnlocks.unlocked.includes('demolitions'), opt: m.optionals[0].state,
    credits: a.credits, cleared: !!(a.missions['last-stand'] && a.missions['last-stand'].completions),
  };
}

runSuite(async () => {
  const { check, finish } = createChecks({ pad: 104, detailMax: 380 });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(installHelpers);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const images = []; page.on('request', (r) => { if (r.resourceType() === 'image') images.push(r.url()); });
  const fresh = async (p = page, url = URL, raw = null) => {
    await p.goto(url); await p.evaluate((r) => { localStorage.clear(); if (r) localStorage.setItem('minisquad.save', r); }, raw);
    await p.goto(url); await p.waitForFunction(() => !!window.game); await p.waitForTimeout(100);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ================= A. DATA =================
  await fresh();
  const data = await ev(() => {
    const st = S.st, sc = st.SCENES;
    const lines = (id) => sc[id].lines.map((l) => `${st.SPEAKERS[l.speaker].name}: ${l.text}`);
    const all = Object.values(sc).flatMap((s) => s.lines);
    const names = [...window.__recruitment.RESERVED_NAMES, ...S.g.roster.owned().map((s) => s.name)];
    const scripts = window.__campaign.CAMPAIGN.filter((d) => d.playable && d.id !== 'last-stand').filter((d) => S.g.selectMission(d.id, true) && S.g.mission.script.story);
    return {
      intro: lines('m15-intro'), p2: lines('m15-phase2'), p3: lines('m15-phase3'), victory: lines('m15-victory'),
      modes: ['m15-intro', 'm15-phase2', 'm15-phase3', 'm15-victory'].map((id) => sc[id].mode).join(),
      cues: JSON.stringify((S.g.selectMission('last-stand', true), S.g.mission.script.story)),
      named: all.filter((l) => names.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(l.text))).map((l) => l.text),
      art: all.filter((l) => st.portraitOf(l)).length + Object.values(st.SPEAKERS).filter((s) => s.portrait).length,
      others: scripts.map((d) => d.id), tones: `${st.SPEAKERS.overwatch.tone},${st.SPEAKERS.voss.tone}`,
      read: ['m15-intro', 'm15-victory'].map((id) => +sc[id].lines.reduce((a, l) => a + st.readTime(l.text), 0).toFixed(2)),
    };
  });
  check('A1 pre-boss lines exactly as approved (OVERWATCH / GENERAL VOSS / OVERWATCH)', JSON.stringify(data.intro) === JSON.stringify([
    'OVERWATCH: Squad, you’ve reached the command bunker. General Voss is inside. Finish this.',
    'GENERAL VOSS: You’ve destroyed my supply lines, my defenses… but you won’t leave this fortress alive.',
    'OVERWATCH: He’s all yours, Squad. Make it count.']), data.intro.join(' | '));
  check('A2 phase lines exactly as approved (70%: "Reinforcements! Defend your general!", 35%: "I will not surrender this fortress!")', data.p2.join() === 'GENERAL VOSS: Reinforcements! Defend your general!' && data.p3.join() === 'GENERAL VOSS: I will not surrender this fortress!', `${data.p2} | ${data.p3}`);
  check('A3 post-boss lines exactly as approved (three OVERWATCH panels)', JSON.stringify(data.victory) === JSON.stringify([
    'OVERWATCH: Voss is down. Fortress secured. Outstanding work, Squad.',
    'OVERWATCH: We’ve recovered his communications. Turns out the General was taking orders from someone else.',
    'OVERWATCH: Get to extraction. We’re going behind enemy lines.']), data.victory.join(' | '));
  check('A4 modes: intro / victory are blocking cinematics, the phase lines non-blocking radio; Command vs enemy tones', data.modes === 'cinematic,radio,radio,cinematic' && data.tones === 'command,enemy', `${data.modes} · ${data.tones}`);
  check('A5 Mission 15 cues: bossIntro, bossPhase2, bossPhase3, victory; no other mission has story cues (Missions 1-14 untouched)', data.cues === '{"bossIntro":"m15-intro","bossPhase2":"m15-phase2","bossPhase3":"m15-phase3","victory":"m15-victory"}' && data.others.length === 0, `${data.cues} · others: ${data.others.join() || 'none'}`);
  check('A6 no scripted line names a recruit (named recruits, the roster)', data.named.length === 0, data.named.join(' | ') || 'none');
  check('A7 text-only: no portrait is set anywhere (no artwork shipped)', data.art === 0, String(data.art));
  check('A8 reading time: intro and victory 8-12 s when left to auto-advance', data.read.every((t) => t >= 8 && t <= 12), data.read.join(' s, ') + ' s');

  // ================= B. PRE-BOSS CINEMATIC =================
  await fresh();
  const pre = await ev(() => {
    const out = {};
    const { g, m, log } = S.toArena({ last: false });
    out.chain = log.join(' ');
    out.beforeFront = { log: g.story.log.length, modal: g.modal, cur: m.currentObjective.id, general: !!m.general };
    // one soldier downed before the cinematic: its bleed-out must not run while it is open
    g.invuln = false; const dn = g.soldiers[1]; g.damage(dn, 1e4); g.invuln = true;
    S.kill((e) => e.tag === 'arena-front');
    const f = m.general;
    out.open = { modal: g.modal, scene: g.story.scene && g.story.scene.id, index: g.story.index, cur: m.currentObjective.id, stage: f && f.stage, ft: f && f.t, log: g.story.log.join(), t0: g.story.t };
    // block: 8 s of steps with the squad exposed (invulnerability off), next to Voss and his guard
    g.invuln = false;
    const snap = () => JSON.stringify({
      hp: g.soldiers.map((s) => Math.round(s.hp * 100)), pos: [...g.soldiers, ...g.enemies].map((u) => [Math.round(u.pos.x), Math.round(u.pos.y)]),
      bleed: Math.round(dn.bleed * 1000), shots: g.enemies.reduce((a, e) => a + e.shots, 0) + g.soldiers.reduce((a, s) => a + s.shots, 0),
      proj: g.projectiles.map((p) => [Math.round(p.pos.x), Math.round(p.pos.y)]), time: g.time, f: [f.t, f.shots, f.stage, f.phase],
    });
    const s0 = snap(), t0 = g.time;
    out.dn = dn.state;
    out.abil = g.soldiers.filter((s) => s.active).map((s) => g.useAbility(s)).filter(Boolean).length;
    out.charges = g.soldiers.map((s) => s.ability.charges).join();
    out.air = !!g.useAirstrike(); out.nuke = !!g.useNuke();
    S.step(4);
    const mid = { modal: g.modal, index: g.story.index };
    S.step(1.5);
    out.blocked = { same: snap() === s0, time: g.time - t0, mid, end: { modal: g.modal, index: g.story.index } };
    out.chargesAfter = g.soldiers.map((s) => s.ability.charges).join();
    // auto-advance: finish without input
    const left = S.stepUntil(() => !g.story.scene, 20);
    out.auto = { total: +(out.open.t0 + 5.5 + left).toFixed(3), log: g.story.log.join(), modal: g.modal, stage: f.stage, ft: f.t, shots: f.shots };
    out.expected = +S.st.SCENES['m15-intro'].lines.reduce((a, l) => a + S.st.readTime(l.text), 0).toFixed(3);
    // after it: the 1.5 s entrance, then the fight
    const tClose = g.time;
    S.stepUntil(() => f.stage === 'fight', 5);
    out.entrance = +(g.time - tClose).toFixed(3);
    g.invuln = true;
    S.step(3, () => S.pinAt({ x: 3750, y: 1200 }));
    out.fight = { shots: f.shots, modal: g.modal, time: +(g.time - tClose).toFixed(2), bleedRuns: dn.state === 'downed' ? dn.bleed < 20 : true };
    // once per attempt: the cue cannot fire again; standing in the arena for 20 s opens nothing
    out.again = m.cue(g, 'bossIntro');
    m.startGeneral(g);
    S.step(20, () => S.pinAt({ x: 3700, y: 1200 }));
    out.opens = g.story.log.filter((x) => x === 'open:m15-intro').length;
    g.invuln = false;
    return out;
  });
  check('B1 no story before Voss\'s encounter: the outer defenses, generator and relays play as before', pre.beforeFront.log === 0 && pre.beforeFront.modal === null && pre.beforeFront.cur === 'assault' && !pre.beforeFront.general && /^generator:null:0 relays:null:0 assault:null:0$/.test(pre.chain), JSON.stringify({ c: pre.chain, b: pre.beforeFront }));
  check('B2 the front guard falls: Voss enters and the pre-boss cinematic opens at once (panel 1, his 1.5 s entrance not started)', pre.open.modal === 'story' && pre.open.scene === 'm15-intro' && pre.open.index === 0 && pre.open.cur === 'voss' && pre.open.stage === 'intro' && pre.open.ft < 0.02 && pre.open.log === 'open:m15-intro', JSON.stringify(pre.open));
  check('B3 while it is open nothing moves, fires, hits or bleeds out and the mission clock stops (5.5 s, squad exposed)', pre.blocked.same && pre.blocked.time === 0 && pre.dn === 'downed', JSON.stringify(pre.blocked));
  check('B4 abilities, Airstrike and Nuke are refused while it is open (no charge spent)', pre.abil === 0 && !pre.air && !pre.nuke && pre.charges === pre.chargesAfter, JSON.stringify({ a: pre.abil, air: pre.air, nuke: pre.nuke, c: pre.charges, c2: pre.chargesAfter }));
  check('B5 auto-advance: panel 2 after the first reading interval, closes on its own after 8-12 s (= the sum of the reading times)', pre.blocked.mid.index === 1 && pre.auto.modal === null && /close:m15-intro:auto@2/.test(pre.auto.log) && pre.auto.total >= 8 && pre.auto.total <= 12 && Math.abs(pre.auto.total - pre.expected) <= 2 / 60, JSON.stringify({ mid: pre.blocked.mid, auto: pre.auto, expected: pre.expected }));
  check('B6 after it closes Voss still has his whole 1.5 s entrance (no shot before), then fights', pre.auto.stage === 'intro' && pre.auto.shots === 0 && Math.abs(pre.entrance - 1.5) < 0.03 && pre.fight.shots > 0 && pre.fight.modal === null, JSON.stringify({ e: pre.entrance, auto: pre.auto, fight: pre.fight }));
  check('B7 once per attempt: the cue never fires again (re-cue, re-entry, 20 s in the arena)', pre.again === false && pre.opens === 1, JSON.stringify({ again: pre.again, opens: pre.opens }));

  // tap-through on the real DOM (frame loop paused: only taps move the panels on)
  await fresh();
  // a tap the same instant the panel appears (meant for the game) is ignored by the tap guard
  const guard = await ev(() => { S.toArena(); S.g.paused = true; return { now: S.g.story.advance(S.g), idx: S.g.story.index }; });
  await page.waitForTimeout(150);
  const shown = async () => ev(() => { const c = document.querySelector('#cine'); return { vis: getComputedStyle(c).display !== 'none', name: c.querySelector('.cine-name').textContent, text: c.querySelector('.cine-text').textContent, cls: c.className, idx: S.g.story.index, modal: S.g.modal, pips: c.querySelectorAll('.cine-pips i').length, art: getComputedStyle(c.querySelector('.cine-art')).display, img: c.querySelector('.cine-art img').getAttribute('src') }; });
  const t0 = await shown();
  await page.waitForTimeout(350);
  await page.mouse.click(640, 300); await page.waitForTimeout(350);
  const t1 = await shown();
  await page.mouse.click(400, 600); await page.waitForTimeout(350);
  const t2 = await shown();
  await page.mouse.click(900, 200); await page.waitForTimeout(350);
  const t3 = await shown();
  const tlog = await ev(() => { const g = S.g; const o = { log: g.story.log.join(), modal: g.modal, stage: g.mission.general.stage }; g.paused = false; return o; });
  check('B8 the panel shows speaker, text, 3 pips, Command styling; text only (no artwork element, no image src)', t0.vis && t0.name === 'OVERWATCH' && /command bunker/.test(t0.text) && t0.pips === 3 && /cine-command/.test(t0.cls) && t0.art === 'none' && !t0.img, JSON.stringify(t0));
  check('B9 tap guard: a tap in the first 0.25 s after a panel appears is ignored', guard.now === false && guard.idx === 0, JSON.stringify(guard));
  check('B10 tap / click advances every panel (GENERAL VOSS panel uses the enemy styling), the last tap closes it', t1.idx === 1 && t1.name === 'GENERAL VOSS' && /cine-enemy/.test(t1.cls) && /fortress alive/.test(t1.text) && t2.idx === 2 && /Make it count/.test(t2.text) && !t3.vis && t3.modal === null && /close:m15-intro:tap@2/.test(tlog.log), JSON.stringify({ t1: [t1.idx, t1.name, t1.cls], t2: t2.idx, t3: [t3.vis, t3.modal], log: tlog.log }));
  check('B11 no image was requested for the text-only panels', images.length === 0, images.join() || 'none');

  // keys: Enter and Space advance, Esc skips; SKIP at each panel resumes the fight
  const keys = [];
  for (const k of [['Enter', 'Space', 'Escape'], ['Escape'], ['Space', 'Escape'], ['Enter', 'Enter', 'Enter']]) {
    await fresh();
    await ev(() => { S.toArena(); S.g.paused = true; });
    const seq = [];
    for (const key of k) { await page.waitForTimeout(320); await page.keyboard.press(key); seq.push(await ev(() => `${S.g.story.index}:${S.g.modal}`)); }
    keys.push({ keys: k.join('+'), seq: seq.join(' '), log: await ev(() => S.g.story.log.join()) });
  }
  check('B12 keyboard: Enter / Space advance a panel, Esc skips the rest, three Enters read it through', keys[0].seq === '1:story 2:story 0:null' && /skip@2/.test(keys[0].log) && keys[1].seq === '0:null' && /skip@0/.test(keys[1].log) && keys[2].seq === '1:story 0:null' && /skip@1/.test(keys[2].log) && keys[3].seq === '1:story 2:story 0:null' && /tap@2/.test(keys[3].log), JSON.stringify(keys));

  const skips = [];
  for (const at of [0, 1, 2]) {
    await fresh();
    await ev((n) => { S.toArena(); S.g.paused = true; for (let i = 0; i < n; i++) S.g.story.advance(S.g, true); }, at);
    await page.waitForTimeout(200);
    const btn = await ev(() => { const b = document.querySelector('#cine .cine-skip'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });
    await page.mouse.click(btn.x, btn.y); await page.waitForTimeout(120);
    skips.push(await ev(() => {
      const g = S.g, f = g.mission.general; g.paused = false;
      const o = { at: g.story.index, modal: g.modal, log: g.story.log.join(), vis: getComputedStyle(document.querySelector('#cine')).display !== 'none', stage0: f.stage };
      const t = S.stepUntil(() => f.stage === 'fight', 5); o.entrance = +t.toFixed(3);
      g.invuln = true; S.step(3, () => S.pinAt({ x: 3750, y: 1200 })); o.shots = f.shots; o.cur = g.mission.currentObjective.id; g.invuln = false;
      return o;
    }));
  }
  check('B13 SKIP on panel 1, 2 or 3 closes it at once; Voss\'s fight starts normally after his 1.5 s entrance every time', skips.every((s, i) => s.modal === null && !s.vis && new RegExp(`close:m15-intro:skip@${i}`).test(s.log) && s.stage0 === 'intro' && Math.abs(s.entrance - 1.5) < 0.03 && s.shots > 0 && s.cur === 'voss'), JSON.stringify(skips));

  const pz = await ev(() => {
    const { g } = S.toArena();
    S.step(1); const a = +g.story.t.toFixed(3);
    g.paused = true; S.step(6); const b = +g.story.t.toFixed(3); const idx = g.story.index;
    g.paused = false; S.step(1);
    return { a, b, idx, c: +(g.story.t - b).toFixed(3), open: g.modal };
  });
  check('B14 pause (P / page hidden) freezes the auto-advance; it resumes where it stopped', pz.a === pz.b && pz.idx === 0 && pz.open === 'story' && Math.abs(pz.c - 1) < 0.02, JSON.stringify(pz));

  // ================= C. PHASE LINES =================
  const ph = await ev(() => {
    const out = {};
    const { g, m } = S.toArena(); g.story.skip(g);
    const f = m.general, V = f.unit, G = window.__CFG.general;
    S.step(2, () => S.pinAt({ x: 3750, y: 1200 }));
    V.hp = V.maxHp * (G.phase2 + 0.004); S.step(0.2);
    out.above70 = { phase: f.phase, radio: !!g.story.radio, q: g.story.queue.length, log: g.story.log.join() };
    g.damage(V, V.maxHp * 0.008, g.soldiers[0]); S.step(2 / 60); // the cue queues the line, the next step shows it
    out.at70 = { phase: f.phase, frac: +f.hpFrac.toFixed(3), text: g.story.radio && g.story.radio.line.text, who: g.story.radio && g.story.radio.line.speaker, modal: g.modal };
    // combat keeps running under the line
    const t0 = g.time, sq0 = g.soldiers.reduce((a, s) => a + s.shots, 0), hp0 = V.hp, v0 = f.shots;
    let shown = 0;
    g.input.move = () => ({ x: 0, y: 1 }); const y0 = g.anchor.y;
    S.step(5, () => { if (g.story.radio && g.story.radio.line.text.startsWith('Reinforcements')) shown++; });
    g.input.move = () => ({ x: 0, y: 0 });
    out.during = { dt: +(g.time - t0).toFixed(3), squadShots: g.soldiers.reduce((a, s) => a + s.shots, 0) - sq0, vossShots: f.shots - v0, vossHit: hp0 - V.hp > 0 || V.hp <= 0, moved: Math.round(g.anchor.y - y0), shownFor: +(shown / 60).toFixed(2), modal: g.modal };
    V.hp = V.maxHp * (G.phase3 + 0.004); S.step(0.2);
    out.above35 = { phase: f.phase, radio: !!g.story.radio, log: g.story.log.join() };
    V.hp = V.maxHp * (G.phase3 - 0.004); S.step(2 / 60);
    out.at35 = { phase: f.phase, text: g.story.radio && g.story.radio.line.text, modal: g.modal };
    // healed back up and down again: no repeat
    V.hp = V.maxHp; S.step(4); V.hp = V.maxHp * 0.2; S.step(6);
    out.repeat = { radios: g.story.log.filter((x) => /^radio:/.test(x)).join(), says: g.story.log.filter((x) => /^say:/.test(x)).length, called: f.called.join() };
    return out;
  });
  check('C1 phase 2 line: nothing at 70.4% HP, "Reinforcements! Defend your general!" (Voss) the step he drops below 70%', ph.above70.phase === 1 && !ph.above70.radio && ph.above70.q === 0 && !/radio/.test(ph.above70.log) && ph.at70.phase === 2 && ph.at70.text === 'Reinforcements! Defend your general!' && ph.at70.who === 'voss' && ph.at70.modal === null, JSON.stringify({ a: ph.above70, b: ph.at70 }));
  check('C2 the line never pauses combat: mission time, squad fire, Voss\'s rifle and movement all run under it (shown 3-4 s)', ph.during.dt === 5 && ph.during.squadShots > 0 && ph.during.vossShots > 0 && ph.during.moved > 20 && ph.during.shownFor >= 3 && ph.during.shownFor <= 4 && ph.during.modal === null, JSON.stringify(ph.during));
  check('C3 phase 3 line: nothing at 35.4%, "I will not surrender this fortress!" below 35%', ph.above35.phase === 2 && !ph.above35.radio && ph.at35.phase === 3 && ph.at35.text === 'I will not surrender this fortress!' && ph.at35.modal === null, JSON.stringify({ a: ph.above35, b: ph.at35 }));
  check('C4 each line once: healing back to full and dropping again repeats nothing (boss phases unchanged too)', ph.repeat.radios === 'radio:m15-phase2,radio:m15-phase3' && ph.repeat.says === 2 && ph.repeat.called === '2,3', JSON.stringify(ph.repeat));

  const big = await ev(() => {
    const { g, m } = S.toArena(); g.story.skip(g);
    const f = m.general, V = f.unit;
    S.step(2, () => S.pinAt({ x: 3750, y: 1200 }));
    g.damage(V, V.maxHp * 0.7, g.soldiers[0]); // 100% -> 30% in one hit
    const seq = []; let maxQ = 0;
    S.step(10, () => { const r = g.story.radio; seq.push(r ? (r.line.text.startsWith('Reinforcements') ? 2 : 3) : 0); maxQ = Math.max(maxQ, g.story.queue.length); });
    const runs = seq.reduce((a, x, i) => (x && x !== seq[i - 1] ? [...a, x] : a), []);
    return { phase: f.phase, called: f.called.join(), log: f.log.map((l) => l.what).filter((w) => !/^rally/.test(w)).slice(0, 4).join(' '), runs: runs.join(), t2: seq.filter((x) => x === 2).length / 60, t3: seq.filter((x) => x === 3).length / 60, maxQ, modal: g.modal, allies: g.allies.length, story: g.story.log.join() };
  });
  check('C5 one big hit past both thresholds: phase 2 then 3 (calls, allies) exactly as before, both lines queued in order and shown one at a time, in full', big.phase === 3 && big.called === '2,3' && /^fight phase2 phase3 allies/.test(big.log) && big.runs === '2,3' && big.t2 >= 3 && big.t3 >= 3 && big.maxQ <= 2 && big.allies === 3 && big.modal === null, JSON.stringify(big));

  // the radio strip on the real HUD (desktop): clear of the boss bar, the banners, the support buttons and panels
  await fresh();
  await ev(() => { const { g, m } = S.toArena(); g.story.skip(g); S.step(2, () => S.pinAt({ x: 3750, y: 1200 })); m.general.unit.hp = m.general.unit.maxHp * 0.69; S.step(0.1); g.paused = true; });
  await page.waitForTimeout(250);
  const rd = await ev(() => {
    const el = document.querySelector('#radio'), r = S.rect(el);
    const hits = ['#objective', '#panels', '#support', '#topbtns', '#hint', '#timer'].map((q) => document.querySelector(q)).filter((e) => e && e.offsetParent && getComputedStyle(e).display !== 'none').filter((e) => S.overlap(r, S.rect(e))).map((e) => e.id);
    const o = { vis: getComputedStyle(el).display !== 'none', pe: getComputedStyle(el).pointerEvents, text: el.textContent, top: Math.round(r.t), r: Math.round(r.r), hits, cine: getComputedStyle(document.querySelector('#cine')).display };
    S.g.paused = false; return o;
  });
  check('C6 radio strip: shown with the speaker and the line, never takes a touch, below the banners (y >= 315) and clear of the objective / boss bar, panels, support and top buttons', rd.vis && rd.pe === 'none' && /GENERAL VOSS/.test(rd.text) && /Defend your general/.test(rd.text) && rd.top >= 315 && rd.r <= 640 && rd.hits.length === 0 && rd.cine === 'none', JSON.stringify(rd));

  // ================= D. POST-BOSS CINEMATIC =================
  const post = await ev(() => {
    const out = {};
    const { g, m } = S.toArena(); g.story.skip(g);
    const f = m.general, V = f.unit;
    S.step(2, () => S.pinAt({ x: 3750, y: 1200 }));
    g.damage(V, V.maxHp * 0.8, g.soldiers[0]); S.step(3);
    g.damage(V, 1e6, g.soldiers[0]); S.step(0.2);
    out.vossDown = { dead: V.state !== 'active', cur: m.currentObjective && m.currentObjective.id, modal: g.modal, left: m.currentObjective && m.currentObjective.left(m, g), log: g.story.log.filter((x) => /victory/.test(x)).length };
    S.step(12);
    out.still = { cur: m.currentObjective && m.currentObjective.id, modal: g.modal, log: g.story.log.filter((x) => /victory/.test(x)).length };
    // the last defenders fall: now the fortress is secured
    let opened = null;
    for (let i = 0; i < 8 && m.currentObjective; i++) {
      for (const e of g.enemies.filter((x) => x.active && x.team === 'enemy' && !x.structure && !x.vehicle)) g.damage(e, 1e6, g.soldiers[0]);
      S.step(1 / 60);
      if (!opened && g.modal === 'story') opened = { scene: g.story.scene.id, phase: m.phase, banner: g.banners.map((b) => b.text).join('|') };
      S.step(1, () => {});
    }
    out.open = opened;
    out.open2 = { modal: g.modal, index: g.story.index, phase: m.phase };
    // blocking: in the extraction zone for 6 s, nothing happens (no countdown, no win)
    const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    const put = () => g.soldiers.forEach((s, i) => { if (s.active) { s.pos = { x: c.x - 60 + (i % 4) * 40, y: c.y - 30 + Math.floor(i / 4) * 40 }; s.vel = { x: 0, y: 0 }; } });
    const t0 = g.time; S.step(6, put);
    out.block = { phase: m.phase, game: g.phase, dt: g.time - t0, modal: g.modal, index: g.story.index };
    const left = S.stepUntil(() => !g.story.scene, 20, put);
    out.auto = { total: +(6 + left).toFixed(2), log: g.story.log.join(), modal: g.modal, phase: m.phase, game: g.phase };
    out.banner = g.banners.map((b) => b.text).join('|');
    S.step(1, put);
    out.afterOne = { phase: m.phase, game: g.phase };
    const ext = S.stepUntil(() => g.phase !== 'playing', 30, put);
    out.extract = { game: g.phase, secs: +ext.toFixed(2), opens: g.story.log.filter((x) => x === 'open:m15-victory').length };
    return out;
  });
  check('D1 Voss down with defenders still standing: no "fortress secured" (clear-the-rest objective, no cinematic for 12 s)', post.vossDown.dead && post.vossDown.cur === 'clear' && post.vossDown.left > 0 && post.vossDown.modal === null && post.vossDown.log === 0 && post.still.cur === 'clear' && post.still.modal === null && post.still.log === 0, JSON.stringify({ a: post.vossDown, b: post.still }));
  check('D2 the last defender falls: the victory cinematic opens the same step, before extraction (phase toExtraction, banner kept)', post.open && post.open.scene === 'm15-victory' && post.open.phase === 'toExtraction' && /PROCEED TO EXTRACTION/.test(post.open.banner), JSON.stringify(post.open));
  check('D3 while it is open the mission waits: squad in the zone for 6 s, no countdown, no win, mission time stopped', post.block.phase === 'toExtraction' && post.block.game === 'playing' && post.block.dt === 0 && post.block.modal === 'story', JSON.stringify(post.block));
  check('D4 auto-advance closes it after 8-12 s; the mission is NOT completed by it (extraction starts as usual, still playing)', post.auto.modal === null && /close:m15-victory:auto@2/.test(post.auto.log) && post.auto.total >= 8 && post.auto.total <= 12 && post.auto.game === 'playing' && ['toExtraction', 'countdown'].includes(post.auto.phase) && /PROCEED TO EXTRACTION/.test(post.banner), JSON.stringify({ auto: post.auto, banner: post.banner }));
  check('D5 then the normal helicopter extraction: countdown, then the win (and the cinematic played once)', post.afterOne.phase === 'countdown' && post.extract.game === 'won' && post.extract.secs >= 9 && post.extract.opens === 1, JSON.stringify({ a: post.afterOne, e: post.extract }));

  const postSkip = await ev(() => {
    const { g, m } = S.toArena(); g.story.skip(g);
    const V = m.general.unit; g.damage(V, 1e6, g.soldiers[0]); S.step(0.2);
    for (let i = 0; i < 8 && m.currentObjective; i++) { S.calm(); S.step(1); }
    const o = { open: g.modal, scene: g.story.scene && g.story.scene.id };
    g.story.advance(g, true); g.story.skip(g);
    o.after = { modal: g.modal, log: g.story.log.filter((x) => /victory/.test(x)).join(), phase: m.phase };
    const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    const put = () => g.soldiers.forEach((s, i) => { if (s.active) { s.pos = { x: c.x - 60 + (i % 4) * 40, y: c.y - 30 + Math.floor(i / 4) * 40 }; s.vel = { x: 0, y: 0 }; } });
    o.secs = +S.stepUntil(() => g.phase !== 'playing', 30, put).toFixed(2); o.game = g.phase;
    return o;
  });
  check('D6 SKIP on the victory cinematic: extraction proceeds normally and the mission is won', postSkip.open === 'story' && postSkip.scene === 'm15-victory' && postSkip.after.modal === null && /skip@1/.test(postSkip.after.log) && postSkip.after.phase === 'toExtraction' && postSkip.game === 'won' && postSkip.secs >= 9, JSON.stringify(postSkip));

  // rewards: the same scripted win with the cinematics skipped and with them played out
  await fresh();
  const wSkip = await ev(scriptedWin, 'skip');
  await fresh();
  const wAuto = await ev(scriptedWin, 'auto');
  check('D7 a full win with the cinematics played out pays exactly what it pays with them skipped (XP, Credits, stars, unlocks)', wSkip.phase === 'won' && wAuto.phase === 'won' && wSkip.reward === wAuto.reward && wSkip.stars === wAuto.stars && wSkip.credits === wAuto.credits && wSkip.opt === wAuto.opt, JSON.stringify({ skip: [wSkip.reward, wSkip.stars], auto: [wAuto.reward, wAuto.stars] }));
  check('D8 the first win unlocks the Demolitions Expert (both runs); intro and victory each played once', wSkip.demo && wAuto.demo && wSkip.cleared && /demolitions/.test(wAuto.reward) && wAuto.log.filter((x) => /^open:/.test(x)).join() === 'open:m15-intro,open:m15-victory' && /close:m15-victory:auto/.test(wAuto.log.join()) && /close:m15-intro:skip/.test(wSkip.log.join()), JSON.stringify({ a: wAuto.log, s: wSkip.log, demo: [wSkip.demo, wAuto.demo] }));

  // ================= E. REPLAY / RESTART / RELOAD =================
  const rs = await ev(() => {
    const out = {};
    const { g } = S.toArena();
    out.first = g.story.log.join();
    g.reset(); // Retry
    out.reset = { modal: g.modal, log: g.story.log.length, cues: g.mission.storyCues.size, cur: g.mission.currentObjective.id };
    S.toArena();
    out.second = { log: g.story.log.join(), modal: g.modal };
    return out;
  });
  check('E1 Retry / restart: the cinematic closes, the per-attempt cues reset, reaching Voss again plays it again (once)', rs.first === 'open:m15-intro' && rs.reset.modal === null && rs.reset.log === 0 && rs.reset.cues === 0 && rs.reset.cur === 'outer' && rs.second.log === 'open:m15-intro' && rs.second.modal === 'story', JSON.stringify(rs));
  await fresh();
  await ev(() => { window.__debugUnlockAll(); window.__persist(); });
  const saved0 = await ev(() => { S.toArena({ roster: S.SIX }); return { modal: S.g.modal, run: !!window.__account().activeRun, raw: S.store() }; });
  await page.reload(); await page.waitForFunction(() => !!window.game); await page.waitForTimeout(150);
  const rl = await ev(() => {
    const g = S.g, a = window.__account(), o = { phase: g.phase, modal: g.modal, cine: getComputedStyle(document.querySelector('#cine')).display, status: window.__loadStatus.status, run: !!a.activeRun, kia: g.roster.owned().filter((s) => s.status === 'kia').length };
    S.toArena({ roster: S.SIX, last: false });
    o.again = { cur: g.mission.currentObjective.id, cues: g.mission.storyCues.size, log: g.story.log.length };
    S.kill((e) => e.tag === 'arena-front'); o.again.open = g.story.log.join();
    return o;
  });
  check('E2 closing the page during the cinematic: the normal interrupted-run rules apply (nothing resumes, nobody lost); a new attempt plays it again', saved0.modal === 'story' && rl.phase !== 'playing' && rl.modal === null && rl.cine === 'none' && !rl.run && rl.kia === 0 && rl.again.cues === 0 && rl.again.log === 0 && rl.again.open === 'open:m15-intro', JSON.stringify(rl));
  const keysInSave = (raw) => /"(story|storyCues|cues|cinematic|scene)"\s*:/i.test(raw || '');
  const src = fs.readFileSync(__dirname + '/../src/save.ts', 'utf8');
  const ver = +((src.match(/SAVE_VERSION = (\d+)/) || [])[1]);
  check('E3 no save fields: SAVE_VERSION 9, nothing story-related written to the save', ver === 9 && !keysInSave(saved0.raw) && !keysInSave(await ev(() => S.store())), `SAVE_VERSION ${ver}`);
  const fx = [];
  for (const dir of ['fixtures', 'fixtures-v08b']) for (const f of fs.readdirSync(__dirname + '/' + dir)) {
    await fresh(page, URL, fs.readFileSync(__dirname + '/' + dir + '/' + f, 'utf8'));
    fx.push(`${f}:${await ev(() => window.__loadStatus.status)}`);
  }
  check('E4 every save fixture still loads', fx.every((x) => /:(loaded|migrated)$/.test(x)), fx.join(' '));

  // ================= F. BASE (v0.8C) =================
  if (BASE) {
    const bctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const bp = await bctx.newPage(); bp.on('pageerror', (e) => errors.push('BASE: ' + String(e)));
    await fresh(bp, BASE);
    await fresh();
    const a = await ev(snapshot), b = await bp.evaluate(snapshot);
    const cfgDiff = [...new Set([...Object.keys(a.cfg), ...Object.keys(b.cfg)])].filter((k) => a.cfg[k] !== b.cfg[k]);
    const misDiff = [...new Set([...Object.keys(a.missions), ...Object.keys(b.missions)])].filter((k) => a.missions[k] !== b.missions[k]);
    check('F1 every CFG group identical to v0.8C (Voss, enemies, classes, training, Elite, support)', cfgDiff.length === 0 && Object.keys(b.cfg).length > 20, cfgDiff.length ? `changed: ${cfgDiff.join()}` : `${Object.keys(b.cfg).length} groups`);
    check('F2 Missions 1-15 identical to v0.8C (maps, enemy groups, objectives, optionals, gates, Voss, extraction, campaign rows)', misDiff.length === 0 && Object.keys(a.missions).length === 15, misDiff.length ? `changed: ${misDiff.join()}` : `${Object.keys(a.missions).length} missions`);
    await fresh(bp, BASE);
    const wBase = await bp.evaluate(scriptedWin, null);
    check('F3 the scripted Mission 15 win pays the same as v0.8C (XP, Credits, stars, Demolitions unlock, optional)', wBase.phase === 'won' && wBase.reward === wAuto.reward && wBase.stars === wAuto.stars && wBase.demo && wBase.opt === wAuto.opt && wBase.credits === wAuto.credits, JSON.stringify({ base: [wBase.reward, wBase.stars, wBase.credits], now: [wAuto.reward, wAuto.stars, wAuto.credits] }));
    await bctx.close();
  } else console.log('NOTE  BASE not set: F (unchanged against v0.8C) skipped');

  // ================= G. PHONES =================
  const DEVICES = [{ name: 'iphoneSE', land: [667, 375], dpr: 2 }, { name: 'iphone14', land: [844, 390], dpr: 3 }, { name: 'pixel7', land: [915, 412], dpr: 2.625 }];
  for (const dev of DEVICES) {
    const c2 = await browser.newContext({ viewport: { width: dev.land[0], height: dev.land[1] }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    await c2.addInitScript(installHelpers);
    const p = await c2.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await fresh(p);
    const layout = () => p.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight, c = document.querySelector('#cine');
      const panel = S.rect(c.querySelector('.cine-panel')), skip = S.rect(c.querySelector('.cine-skip')), text = c.querySelector('.cine-text');
      const inside = (r) => r.l >= -0.5 && r.t >= -0.5 && r.r <= vw + 0.5 && r.b <= vh + 0.5;
      const sb = c.querySelector('.cine-skip').getBoundingClientRect();
      const hit = document.elementFromPoint(sb.left + sb.width / 2, sb.top + sb.height / 2);
      const clipped = [...c.querySelectorAll('.cine-body, .cine-text, .cine-who, .cine-foot')].filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className);
      const texts = [...c.querySelectorAll('.cine-text, .cine-name, .cine-next, .cine-skip')].map((e) => parseFloat(getComputedStyle(e).fontSize) * (vw / 1280));
      return { vis: getComputedStyle(c).display !== 'none', panelIn: inside(panel), skipIn: inside(skip), skipW: Math.round(skip.w), skipH: Math.round(skip.h), skipHit: !!hit && !!hit.closest('.cine-skip'), skipOverPanel: S.overlap(skip, panel), clipped, minFont: +Math.min(...texts).toFixed(1), idx: S.g.story.index, name: c.querySelector('.cine-name').textContent, lines: Math.round(text.getBoundingClientRect().height / (parseFloat(getComputedStyle(text).lineHeight) * (vw / 1280))) };
    });
    // the longest panel (victory, line 2) and the enemy panel
    await p.evaluate(() => { const { g } = S.toArena(); g.paused = true; g.story.advance(g, true); });
    await p.waitForTimeout(700); // the panel's entry animation
    const Lv = await layout();
    if (OUT) await p.screenshot({ path: `${OUT}/story-${dev.name}-voss.png` });
    await p.evaluate(() => { const g = S.g; g.story.skip(g); g.story.play(g, 'm15-victory'); g.story.advance(g, true); });
    await p.waitForTimeout(700);
    const Lo = await layout();
    if (OUT) await p.screenshot({ path: `${OUT}/story-${dev.name}-overwatch.png` });
    // touch: a tap advances, a tap on SKIP closes
    await p.waitForTimeout(100);
    await p.touchscreen.tap(Math.round(dev.land[0] * 0.4), Math.round(dev.land[1] * 0.45)); await p.waitForTimeout(320);
    const tapIdx = await p.evaluate(() => S.g.story.index);
    const sk = await p.evaluate(() => { const r = document.querySelector('#cine .cine-skip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.touchscreen.tap(Math.round(sk.x), Math.round(sk.y)); await p.waitForTimeout(150);
    const afterSkip = await p.evaluate(() => ({ modal: S.g.modal, vis: getComputedStyle(document.querySelector('#cine')).display !== 'none', log: S.g.story.log.slice(-1)[0] }));
    const fits = (L) => L.vis && L.panelIn && L.skipIn && L.skipHit && !L.skipOverPanel && L.clipped.length === 0 && L.minFont >= 11 && L.skipW >= 44 && L.skipH >= 43.5 && L.lines <= 3;
    check(`G ${dev.name}: GENERAL VOSS panel and the longest OVERWATCH panel fit (nothing clipped, text >= 11 CSS px, <= 3 lines), SKIP >= 44 CSS px, clear of the panel`, fits(Lv) && fits(Lo) && Lv.name === 'GENERAL VOSS' && Lo.name === 'OVERWATCH', JSON.stringify({ voss: Lv, ow: Lo }));
    check(`G ${dev.name}: a touch on the panel advances it, a touch on SKIP closes it`, tapIdx === 2 && afterSkip.modal === null && !afterSkip.vis && /close:m15-victory:skip@2/.test(afterSkip.log), JSON.stringify({ tapIdx, afterSkip }));
    // radio strip on the phone HUD (six soldier panels, boss bar)
    await p.evaluate(() => { const g = S.g; g.paused = false; S.step(2, () => S.pinAt({ x: 3750, y: 1200 })); g.mission.general.unit.hp = g.mission.general.unit.maxHp * 0.69; S.step(0.1); g.paused = true; });
    await p.waitForTimeout(250);
    const R = await p.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight, el = document.querySelector('#radio'), r = S.rect(el);
      const others = ['.obj-boss', '#objective', '#panels', '#support', '#topbtns', '#hint', '#timer'].map((q) => document.querySelector(q)).filter((e) => e && e.offsetParent && getComputedStyle(e).display !== 'none');
      return { vis: getComputedStyle(el).display !== 'none', inside: r.l >= 0 && r.t >= 0 && r.r <= vw && r.b <= vh, hits: others.filter((e) => S.overlap(r, S.rect(e))).map((e) => e.id || e.className), leftHalf: r.r <= vw / 2 + 1, belowBanners: r.t >= (315 / 720) * vh - 1, font: +(parseFloat(getComputedStyle(el.querySelector('.rd-text')).fontSize) * vw / 1280).toFixed(1), pe: getComputedStyle(el).pointerEvents, panels: document.querySelectorAll('.panel').length };
    });
    if (OUT) await p.screenshot({ path: `${OUT}/story-${dev.name}-radio.png` });
    check(`G ${dev.name}: radio strip on screen, clear of the boss bar / objective / six panels / buttons, below the banners, no touch capture`, R.vis && R.inside && R.hits.length === 0 && R.leftHalf && R.belowBanners && R.font >= 11 && R.pe === 'none' && R.panels === 6, JSON.stringify(R));
    check(`G ${dev.name}: no page errors`, errs.length === 0, errs.join(' | '));
    await c2.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  return finish();
});
