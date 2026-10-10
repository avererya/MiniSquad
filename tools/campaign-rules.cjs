// v0.4 campaign rule checks (PASS/FAIL, exit 1 on any failure):
//   A. in page, fresh save: mission + soldier unlocks, capacity table, stars (incl. M1/M4 rules,
//      best never lowered), optional objectives (real events, no auto-complete, no double pay),
//      objectives never complete twice, extraction gated by primaries, escort follow + captive
//      rules, rescue rules (20 s bleed-out, valid-revive pause, interruption, 30% HP, LOS),
//      squad scaling 2-6 incl. repeated classes and keys 1-6.
//   B. UI with the real v0.3 fixture save: migration, over-limit handling (never trimmed
//      silently), Keep first N, legacy first-clear (no double grant on Mission 3).
//   C. UI new player: first clear -> NEW SOLDIER JOINED + NEW badge, locked missions.
//   URL=http://localhost:4173/  OUT=dir (screenshots, optional)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || '';
const V03 = fs.readFileSync(path.join(__dirname, 'fixtures/v0.3-save.json'), 'utf8').trim();

(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(80)} ${detail}`); };

  // ================= A. rules in page =================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL);
    const res = await page.evaluate(() => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail ?? '') });
      const g = window.game, A = window.__account, C = window.__campaign, CFG = window.__CFG;
      const R = () => g.roster;
      const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) g.update(1 / 60); };
      // removes reinforcement waves (untagged) without kill events; tagged objective groups stay (killTag kills them for real)
      const clearEnemies = (all = false) => { const gone = (e) => !e.structure && (all || !e.tag); g.enemies.filter(gone).forEach((e) => (e.state = 'dead')); g.enemies = g.enemies.filter((e) => !gone(e)); };
      const killTag = (tag) => { for (const e of g.enemies.filter((x) => x.active && x.tag === tag)) g.damage(e, 1e6, g.soldiers[0]); };
      const deployIds = (ids, kind = 'roster') => { const r = g.deploy(ids.map((id) => R().get(id)), kind); g.invuln = false; return r; };
      const centre = (z) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 });
      // v0.6: a KIA is permanent and blocks the next deploy until decided; these v0.4 star checks resolve it for
      // free (top up exactly the resurrection price, then resurrect: Credits unchanged)
      const resolveFree = () => { let d; while ((d = A().pendingDecision) && d.queue.length) { const s = R().get(d.queue[0].id); A().credits += window.__casualties.costFor(s); window.__economy.resurrect(R(), A(), s.id, null); } };
      const allTo = (p) => { g.soldiers.forEach((s, i) => { s.pos = g.findOpenNear({ x: p.x + (i % 3) * 20 - 20, y: p.y + Math.floor(i / 3) * 20 }, 10); }); g.anchor = { ...p }; };

      // ---- capacity table ----
      const caps = [1, 2, 3, 4, 5, 6, 7, 12, 13, 20].map(C.capacityFor);
      check('capacity: M1-2 = 2, M3-5 = 3, M6 = 4, M7-12 = 5, M13+ = 6', caps.join() === '2,2,3,3,3,4,5,5,6,6', caps.join());
      // ---- fresh save ----
      check('new save: Mission 1 only, Ace + Ranger only', A().campaign.unlockedMissions.join() === 'first-contact' && [...R().unlocked].join() === 'ace,ranger', `${A().campaign.unlockedMissions} / ${[...R().unlocked]}`);
      check('locked mission cannot be selected', g.selectMission('heavy-support') === false && g.missionId === 'first-contact', g.missionId);
      g.selectMission('heavy-support', true);
      const blk = g.deployBlock(), dr = g.deploySelected();
      check('dev-forced locked mission: Deploy blocked with a reason', /locked/i.test(blk) && !dr.ok && g.phase === 'start', blk);
      g.selectMission('first-contact');
      check('locked soldier cannot be selected or deployed', !R().select('tank').ok && !deployIds(['ace', 'tank']).ok && g.phase === 'start', '');
      check('roster deploy above the cap is refused (never deploys 3 into M1)', !g.deploy(['ace', 'ranger', 'ace'].map((id) => R().get(id))).ok && g.phase === 'start', '');

      // ---- M1 first clear: unlocks, 3 stars (full extraction + nobody downed) ----
      let r = g.deploySelected();
      clearEnemies();
      const m1 = g.mission;
      check('M1: deploys Ace + Ranger, 2 soldiers', r.ok && g.soldiers.map((s) => s.identity.id).join() === 'ace,ranger', JSON.stringify(r));
      // extraction is gated by the primary objective
      allTo(centre(m1.script.extraction.zone)); step(1);
      check('extraction stays closed while the primary is not done', m1.phase === 'eliminate' && !m1.inExtraction, m1.phase);
      for (const t of ['patrol-a', 'patrol-b', 'patrol-c']) killTag(t);
      const elim = m1.primaries[0];
      check('Eliminate completes from kill events (10 kills)', elim.state === 'complete' && elim.kills === 10, `${elim.state} ${elim.kills}`);
      check('objective never completes twice', elim.complete(m1, g) === false && m1.current === 1, '');
      step(0.5); step(7);
      check('M1: walk in -> countdown -> extraction -> win', g.phase === 'won', `${g.phase} ${m1.phase}`);
      let rw = g.lastReward;
      check('M1 first clear: 3 stars, unlocks Tank + Mission 2', rw && rw.firstClear && rw.stars === 3 && rw.unlockedSoldiers.join() === 'tank' && rw.unlockedMissions.join() === 'heavy-support' && R().isUnlocked('tank') && A().campaign.unlockedMissions.includes('heavy-support'), rw && JSON.stringify({ s: rw.stars, u: rw.unlockedSoldiers, m: rw.unlockedMissions }));
      check('Campaign moves on to Mission 2 after the first clear', A().campaign.selectedMission === 'heavy-support', A().campaign.selectedMission);
      check('M1 has no optional objectives; 1000 CR first clear', m1.optional.length === 0 && rw.credits === 1000, rw.credits);
      // replay with a revive: 2 stars, nothing unlocked again
      g.selectMission('first-contact');
      g.deploySelected(); clearEnemies();
      const [a1, b1] = g.soldiers;
      g.downSoldier(b1); a1.pos = { x: b1.pos.x + 15, y: b1.pos.y }; g.anchor = { ...a1.pos };
      let t = 0; while (b1.state === 'downed' && t < 12) { g.update(1 / 60); t += 1 / 60; }
      g.win();
      rw = g.lastReward;
      check('M1 replay, one revive: 2 stars (full extraction), best stays 3, nothing re-unlocked', rw.stars === 2 && rw.bestStars === 3 && A().missions['first-contact'].bestStars === 3 && !rw.firstClear && rw.unlockedSoldiers.length === 0 && rw.unlockedMissions.length === 0, `stars ${rw.stars}, best ${rw.bestStars}`);
      g.reset(); clearEnemies(); g.soldiers[1].state = 'kia'; g.win();
      check('M1 replay with a KIA: 1 star', g.lastReward.stars === 1 && A().missions['first-contact'].bestStars === 3, g.lastReward.stars);
      resolveFree();
      g.reset(); clearEnemies(); g.soldiers.forEach((s) => g.downSoldier(s)); step(0.05);
      check('defeat: 0 stars, best never lowered, no reward', g.phase === 'failed' && g.lastStars.stars === 0 && A().missions['first-contact'].bestStars === 3 && g.lastReward.credits === 0, `${g.phase} ${g.lastStars.stars}`);
      const runs = A().settledRuns.length; g.win(); g.ui.showEnd();
      check('settled once per run (no double reward on repeated end)', A().settledRuns.length === runs, '');

      // ---- M2: sabotage + optional MG nest ----
      check('Mission 2 selectable now', g.selectMission('heavy-support'), '');
      R().select('tank', 1, 2); // replace Ranger
      r = g.deploySelected();
      const m2 = g.mission;
      check('M2: Tank + Ace, depot structure spawned', r.ok && g.soldiers.map((s) => s.identity.id).join() === 'ace,tank' && g.enemies.some((e) => e.structure === 'depot'), JSON.stringify(r));
      const opt = m2.optionals[0];
      check('M2 optional not auto-completed at start', opt.state === 'active' && !m2.optional[0].completed, opt.state);
      killTag('mg-nest');
      check('M2 optional completes from real kills', opt.state === 'complete' && m2.optional[0].completed, opt.state);
      check('optional cannot complete twice', opt.complete(m2, g) === false, '');
      const depot = g.enemies.find((e) => e.structure === 'depot');
      allTo(centre(m2.script.extraction.zone)); step(0.5);
      check('M2 extraction closed until the depot is destroyed', m2.phase === 'destroy', m2.phase);
      g.damage(depot, 1e6, g.soldiers[0]);
      check('Destroy objective completes once from the structure event', m2.primaries[0].state === 'complete' && m2.current === 1 && m2.wrecks.length === 1, `${m2.primaries[0].state} wrecks ${m2.wrecks.length}`);
      g.damage(depot, 1e6, g.soldiers[0]);
      check('damaging the wreck again does nothing', m2.wrecks.length === 1 && m2.current === 1, '');
      clearEnemies(); g.win();
      rw = g.lastReward;
      const optXp = rw.xpLines.find((l) => /Optional/.test(l.label)), optCr = rw.creditLines.find((l) => /Optional/.test(l.label));
      check('M2 optional pays +25 XP / +150 CR, 3 stars, unlocks Doc + Mission 3', optXp?.amount === 25 && optCr?.amount === 150 && rw.stars === 3 && rw.unlockedSoldiers.join() === 'doc' && rw.unlockedMissions.join() === 'field-medicine', `${optXp?.amount} XP ${optCr?.amount} CR stars ${rw.stars}`);
      g.reset(); clearEnemies(); g.win();
      rw = g.lastReward;
      check('M2 replay without the nest: optional 0/1 pays nothing, 1 star', rw.stars === 1 && rw.xpLines.find((l) => /Optional/.test(l.label)).amount === 0 && g.mission.optional[0].completed === false, `stars ${rw.stars}`);

      // ---- M3: overlap rule ----
      g.selectMission('field-medicine');
      R().select('doc', 2, 3);
      g.deploySelected(); clearEnemies(); g.win();
      rw = g.lastReward;
      check('M3 overlap: "Extract every soldier" pays as the optional, no whole-squad line', rw.xpLines.map((l) => l.label).join() === 'Victory,Optional objectives 1/1,Nobody downed' && rw.creditLines.every((l) => !/Whole squad/.test(l.label)) && rw.stars === 3, rw.xpLines.map((l) => l.label).join());
      g.reset(); clearEnemies(); g.soldiers[2].state = 'kia'; g.win();
      check('M3 with a KIA: optional failed, 1 star', g.lastReward.stars === 1 && !g.mission.optional[0].completed, g.lastReward.stars);
      resolveFree();
      check('M3 first clear unlocks Mission 4 only', A().campaign.unlockedMissions.join() === 'first-contact,heavy-support,field-medicine,red-canyon', A().campaign.unlockedMissions.join());

      // ---- M4: stars without optionals ----
      g.selectMission('red-canyon');
      g.deploySelected(); clearEnemies();
      const m4 = g.mission;
      check('M4 primaries: advance -> survive', m4.primaries.map((o) => o.id).join() === 'advance,ambush' && m4.phase === 'advance', m4.phase);
      allTo(centre({ x: 1650, y: 200, w: 260, h: 700 })); step(0.2);
      check('M4: reaching the canyon starts the ambush (waves spawn)', m4.phase === 'survive' && g.enemies.length >= 4, `${m4.phase} enemies ${g.enemies.length}`);
      g.invuln = true; for (let i = 0; i < 52 * 60 && m4.phase === 'survive'; i++) { clearEnemies(); g.update(1 / 60); }
      check('M4: survive timer completes, extraction opens', m4.primaries[1].state === 'complete' && m4.inExtraction, m4.phase);
      g.invuln = false; clearEnemies(); g.downSoldier(g.soldiers[0]); g.soldiers[0].state = 'active'; g.soldiers[0].hp = 30; g.win();
      check('M4 (no optionals): downed but all extracted = 2 stars', g.lastReward.stars === 2 && g.lastReward.unlockedMissions.join() === 'bring-them-home', g.lastReward.stars);
      g.reset(); clearEnemies(); g.win();
      check('M4: nobody downed = 3 stars', g.lastReward.stars === 3, g.lastReward.stars);

      // ---- M5: escort ----
      g.selectMission('bring-them-home');
      g.deploySelected(); clearEnemies(); g.invuln = true;
      const m5 = g.mission, npc = m5.npc;
      check('M5: captive spawned, held, not targetable', npc && !npc.escorting && !npc.targetable, '');
      killTag('compound');
      check('M5: clear the guards -> free the captive', m5.primaries[0].state === 'complete' && m5.phase === 'free', m5.phase);
      allTo({ x: npc.pos.x - 40, y: npc.pos.y + 30 });
      step(CFG.escort.freeTime + 0.3);
      check('M5: standing next to the captive frees them (escorting)', npc.escorting && m5.inExtraction, `${npc.escorting} ${m5.phase}`);
      // walk the squad to extraction along A*; the captive must follow without getting stuck
      const goal = centre(m5.script.extraction.zone);
      let mv = { x: 0, y: 0 }; g.input.move = () => mv;
      let maxGap = 0, path = null, pt = 0, steps = 0;
      for (; steps < 60 * 60 && !(m5.phase === 'countdown' || m5.phase === 'available' || g.phase !== 'playing'); steps++) {
        clearEnemies();
        pt -= 1 / 60; if (pt <= 0) { path = g.world.findPath(g.anchor, goal, 12); pt = 0.5; }
        while (path && path.length > 1 && Math.hypot(path[0].x - g.anchor.x, path[0].y - g.anchor.y) < 20) path.shift();
        const gap = Math.hypot(npc.pos.x - g.anchor.x, npc.pos.y - g.anchor.y);
        maxGap = Math.max(maxGap, gap);
        if (path && path.length && gap < 220) { const dx = path[0].x - g.anchor.x, dy = path[0].y - g.anchor.y, d = Math.hypot(dx, dy) || 1; mv = { x: dx / d, y: dy / d }; } else mv = { x: 0, y: 0 };
        g.update(1 / 60);
      }
      check('M5 escort: captive follows across the village to extraction (no teleport rescue)', m5.phase === 'countdown' && g.escortRescues === 0 && maxGap < 320, `${(steps / 60).toFixed(1)}s, max gap ${Math.round(maxGap)}px, rescues ${g.escortRescues}`);
      mv = { x: 0, y: 0 };
      g.invuln = false; const hp0 = npc.hp; g.damage(npc, 5, null); g.invuln = true;
      check('M5 optional fails when the captive is hurt', m5.optionals[0].state === 'failed' && npc.hp < hp0, m5.optionals[0].state);
      for (let i = 0; i < 14 * 60 && g.phase === 'playing'; i++) {
        clearEnemies();
        const dx = goal.x - g.anchor.x, dy = goal.y - g.anchor.y, d = Math.hypot(dx, dy);
        mv = d > 10 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
        g.update(1 / 60);
      }
      const zz = m5.script.extraction.zone, inZ = (u) => u.pos.x >= zz.x && u.pos.x <= zz.x + zz.w && u.pos.y >= zz.y && u.pos.y <= zz.y + zz.h;
      check('M5: everyone + captive in the zone -> win, unlocks Havoc + squad size 4', g.phase === 'won' && g.lastReward.unlockedSoldiers.join() === 'havoc' && g.lastReward.stars === 1, `${g.phase} ${m5.phase} ${g.lastReward?.unlockedSoldiers} npc in zone ${inZ(npc)} soldiers ${g.soldiers.map(inZ)} npc ${Math.round(npc.pos.x)},${Math.round(npc.pos.y)}`);
      g.reset(); clearEnemies(); killTag('compound');
      const n2 = g.mission.npc; allTo({ x: n2.pos.x - 40, y: n2.pos.y + 30 }); step(CFG.escort.freeTime + 0.3);
      g.invuln = false; g.downSoldier(n2); n2.bleed = 0.01; g.soldiers.forEach((s) => (s.pos = { x: s.pos.x - 400, y: s.pos.y + 600 })); step(0.1);
      check('M5: captive bleeds out -> mission failed with a reason', g.phase === 'failed' && /captive/i.test(g.mission.failReason), `${g.phase} "${g.mission.failReason}"`);
      check('Patch stays locked after M5 (reserved for Mission 7)', !R().isUnlocked('patch') && R().unlockText('patch').includes('Mission 7'), R().unlockText('patch'));

      // ---- rescue rules ----
      g.selectMission('field-medicine');
      g.reset(['infantry', 'infantry']); clearEnemies(true); g.invuln = false;
      const [rv, dn] = g.soldiers;
      g.downSoldier(dn);
      check('bleed-out timer starts at 20 s (was 30)', dn.bleed === 20 && CFG.revive.bleedOut === 20, dn.bleed);
      rv.pos = { x: dn.pos.x + 400, y: dn.pos.y }; g.anchor = { ...rv.pos }; g.input.move = () => ({ x: 0, y: 0 });
      const far = () => { rv.pos = { x: dn.pos.x + 400, y: dn.pos.y }; g.anchor = { ...rv.pos }; };
      for (let i = 0; i < 300; i++) { far(); g.update(1 / 60); }
      const b5 = dn.bleed;
      for (let i = 0; i < 240; i++) { rv.pos = { x: dn.pos.x + 20, y: dn.pos.y }; g.update(1 / 60); }
      const b9 = dn.bleed, p9 = dn.reviveProgress;
      check('valid revive pauses the bleed-out', Math.abs(b5 - 15) < 0.05 && Math.abs(b9 - b5) < 1e-9 && Math.abs(p9 - 0.4) < 0.01, `bleed ${b5.toFixed(2)} -> ${b9.toFixed(2)}, progress ${p9.toFixed(2)}`);
      for (let i = 0; i < 120; i++) { far(); g.update(1 / 60); }
      check('interrupted revive: timer resumes from the remaining time, progress kept', Math.abs(dn.bleed - (b9 - 2)) < 0.05 && Math.abs(dn.reviveProgress - p9) < 1e-9, `bleed ${dn.bleed.toFixed(2)}, progress ${dn.reviveProgress.toFixed(2)}`);
      for (let i = 0; i < 400 && dn.state === 'downed'; i++) { rv.pos = { x: dn.pos.x + 20, y: dn.pos.y }; g.update(1 / 60); }
      check('revive completes; restores 30% HP (was 40%)', dn.state === 'active' && Math.round(dn.hp) === 30, `${dn.state} hp ${Math.round(dn.hp)}`);
      // LOS: a wall between them blocks the revive even inside the radius
      const W = g.world.obstacles.find((o) => o.w <= 24 && o.h >= 80) || g.world.obstacles.find((o) => o.h <= 24 && o.w >= 80);
      if (W) {
        g.downSoldier(dn);
        const vert = W.w <= 24;
        const mid = vert ? { x: W.x + W.w / 2, y: W.y + W.h / 2 } : { x: W.x + W.w / 2, y: W.y + W.h / 2 };
        const p1 = vert ? { x: W.x - 14, y: mid.y } : { x: mid.x, y: W.y - 14 }, p2 = vert ? { x: W.x + W.w + 14, y: mid.y } : { x: mid.x, y: W.y + W.h + 14 };
        const bl = dn.bleed;
        for (let i = 0; i < 60; i++) { dn.pos = { ...p1 }; rv.pos = { ...p2 }; g.anchor = { ...p2 }; g.update(1 / 60); }
        check('no revive through a wall (line of sight required); bleed keeps running', !dn.reviving && dn.bleed < bl - 0.9, `dist ${Math.round(Math.hypot(p1.x - p2.x, p1.y - p2.y))}px, bleed ${bl.toFixed(1)} -> ${dn.bleed.toFixed(1)}`);
      } else check('no thin wall found for the LOS check', false, '');
      // revive assist: under player control a nearby soldier walks over by itself
      g.reset(['infantry', 'infantry', 'medic']); clearEnemies(true);
      const [x1, x2, x3] = g.soldiers; g.downSoldier(x1); g.anchor = { x: x1.pos.x + 90, y: x1.pos.y };
      let tt = 0; while (x1.state === 'downed' && tt < 15) { g.anchor = { x: x1.pos.x + 90, y: x1.pos.y }; g.update(1 / 60); tt += 1 / 60; }
      check('revive assist: squad walks to a downed soldier near the squad and revives', x1.state === 'active' && tt < 9, `${x1.state} after ${tt.toFixed(1)}s`);
      // extraction waits while a revive is in progress
      g.reset(['infantry', 'infantry']); clearEnemies(true);
      g.mission.debugReadyExtraction(g);
      const z = centre(g.mission.script.extraction.zone);
      g.downSoldier(g.soldiers[1]); g.soldiers[1].pos = { ...z }; g.soldiers[0].pos = { x: z.x + 20, y: z.y }; g.anchor = { x: z.x + 20, y: z.y };
      const stepClear = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) { clearEnemies(true); g.update(1 / 60); } };
      stepClear(0.3);
      const held = g.phase;
      stepClear(10.5);
      check('extraction waits for a revive in progress inside the zone', held === 'playing' && g.phase === 'won' && g.soldiers[1].state === 'active', `${held} -> ${g.phase}, ${g.soldiers[1].state}`);

      // ---- squad scaling 2-6, repeated classes, keys 1-6 ----
      window.__debugUnlockAll();
      g.selectMission('red-canyon');
      const sizes = [['ace', 'tank'], ['ace', 'tank', 'doc'], ['ace', 'tank', 'doc', 'havoc'], ['ace', 'ranger', 'tank', 'havoc', 'doc'], ['ace', 'ranger', 'tank', 'havoc', 'doc', 'patch']];
      let scaleLog = [], scaleOk = true;
      for (const ids of sizes) {
        deployIds(ids, 'temp');
        const slots = new Set(g.soldiers.map((s) => s.slot.join()));
        const panels = document.querySelectorAll('.panel').length;
        let keysOk = true;
        g.soldiers.forEach((s) => { s.hp = s.maxHp * 0.5; });
        g.soldiers.forEach((s, i) => { s.ability.cooldownLeft = 0; g.targeting = null; g.onKey('Digit' + (i + 1), {}); keysOk = keysOk && (g.targeting === s || s.ability.cooldownLeft > 0 || s.ability.activeLeft > 0); g.targeting = null; });
        g.debugSpawnGroup(); step(3);
        const ok = g.soldiers.length === ids.length && slots.size === ids.length && panels === ids.length && keysOk;
        scaleOk = scaleOk && ok; scaleLog.push(`${ids.length}:${ok ? 'ok' : `BAD(slots ${slots.size}, panels ${panels}, keys ${keysOk})`}`);
      }
      check('squads of 2-6: distinct formation slots, one HUD tile each, keys 1-N fire abilities', scaleOk, scaleLog.join(' '));
      const presets = [['infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry'], ['medic', 'medic', 'medic', 'medic'], ['heavy', 'heavy', 'heavy', 'heavy', 'heavy']];
      let repOk = true; const repLog = [];
      for (const p of presets) {
        g.reset(p); g.invuln = true; g.soldiers.forEach((s) => { s.hp = s.maxHp * 0.5; });
        const ids = new Set(g.soldiers.map((s) => s.identity.id)), abil = new Set(g.soldiers.map((s) => s.ability));
        g.useAbility(g.soldiers[1]);
        const indep = g.soldiers.filter((s) => s.ability.cooldownLeft > 0 || s.ability.activeLeft > 0 || g.targeting === s).length === 1;
        g.targeting = null; g.debugSpawnGroup(); step(4);
        const ok = ids.size === p.length && abil.size === p.length && indep && g.soldiers.every((s) => s.state !== 'kia');
        repOk = repOk && ok; repLog.push(`${p.length}x${p[0]}:${ok ? 'ok' : 'BAD'}`);
      }
      check('repeated classes (6 Infantry, 4 Medic, 5 Heavy): own identities + ability instances', repOk, repLog.join(' '));
      g.toCampaign();
      return out;
    });
    for (const r of res) check(r.name, r.ok, r.detail);
    check('A: no page errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ================= B. v0.3 fixture: migration, over-limit, legacy first clear =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('minisquad.save')));
    await page.goto(URL);
    await page.evaluate((raw) => { localStorage.clear(); localStorage.setItem('minisquad.save', raw); }, V03);
    await page.goto(URL); await page.waitForTimeout(200);
    const old = JSON.parse(V03);
    let sv = await save();
    const st = await page.evaluate(() => ({ status: window.__loadStatus.status, from: window.__loadStatus.fromVersion, notice: document.querySelector('.m-notice')?.textContent || '' }));
    check('v0.3 save migrated to v5 in place (status, notice on Campaign)', st.status === 'migrated' && st.from === 2 && sv.version === 5 && await page.isVisible('#menu.campaign') && /kept/.test(st.notice), `${st.status} from v${st.from}: "${st.notice}"`);
    const xpSame = old.roster.every((s) => { const n = sv.roster.find((x) => x.id === s.id); return n.progression.xp === s.progression.xp && JSON.stringify(n.training) === JSON.stringify(s.training); });
    check('v0.3 save: credits, XP, training, squad training, settled runs kept', sv.account.credits === old.account.credits && xpSame && JSON.stringify(sv.account.squadTraining) === JSON.stringify(old.account.squadTraining) && sv.account.settledRuns.length === old.account.settledRuns.length, `credits ${sv.account.credits}`);
    check('v0.3 save: all 6 soldiers unlocked, campaign starts at Mission 1', sv.unlockedSoldiers.length === 6 && sv.account.campaign.unlockedMissions.join() === 'first-contact' && sv.account.campaign.selectedMission === 'first-contact', `${sv.unlockedSoldiers} ${JSON.stringify(sv.account.campaign)}`);
    check('v0.3 save: legacy comms-outpost record kept as history', JSON.stringify(sv.account.missions['comms-outpost']).includes(String(old.account.missions['comms-outpost'].completions)) && sv.account.missions['comms-outpost'].firstClearRun === old.account.missions['comms-outpost'].firstClearRun, JSON.stringify(sv.account.missions['comms-outpost']));
    check('v0.3 save: original text backed up once (pre-v0.4)', (await page.evaluate(() => localStorage.getItem('minisquad.save.pre-v0.4'))) === V03, '');
    // over-limit: squad of 3 vs Mission 1 cap 2
    const det = await page.textContent('.c-detail');
    check('over limit: Campaign shows it, Deploy disabled', /over the limit, remove 1/.test(det) && await page.isDisabled('.c-btns [data-a="deploy"]'), det.replace(/\s+/g, ' ').match(/Selected:[^.]*?(?=FIRST|$)/)?.[0]);
    await page.keyboard.press('Enter');
    check('over limit: Enter does not deploy', (await page.evaluate(() => window.game.phase)) === 'start', '');
    await page.click('[data-a="to-barracks"]');
    const ov = await page.evaluate(() => ({ over: document.querySelectorAll('.slot.over').length, slots: document.querySelectorAll('.slot').length, trim: !!document.querySelector('[data-a="trim"]'), dis: document.querySelector('[data-a="deploy"]').disabled }));
    if (OUT) await page.screenshot({ path: `${OUT}/barracks-over-limit.png` });
    check('over limit: Barracks marks the extra slot, offers KEEP FIRST 2, Deploy disabled', ov.over === 1 && ov.slots === 3 && ov.trim && ov.dis, JSON.stringify(ov));
    await page.reload(); await page.waitForTimeout(200);
    sv = await save();
    check('over limit: the saved squad is never trimmed silently (after reload)', sv.squad.filter(Boolean).join() === 'ranger,havoc,patch', sv.squad.join());
    await page.click('[data-a="to-barracks"]');
    await page.click('[data-a="trim"]');
    sv = await save();
    check('KEEP FIRST 2 trims only on request, saved', sv.squad.filter(Boolean).join() === 'ranger,havoc' && !(await page.isDisabled('[data-a="deploy"]')), sv.squad.join());
    // legacy player replays the campaign; Mission 3 first clear does not pay the outpost bonus twice
    const leg = await page.evaluate(() => {
      const g = window.game, o = [];
      for (const [id, squad] of [['first-contact', ['ranger', 'havoc']], ['heavy-support', ['ranger', 'havoc']], ['field-medicine', ['ranger', 'havoc', 'patch']]]) {
        g.selectMission(id);
        const r = g.deploy(squad.map((x) => g.roster.get(x)));
        g.enemies.forEach((e) => (e.state = 'dead')); g.enemies = [];
        g.win();
        o.push({ id, ok: r.ok, first: g.lastReward.firstClear, legacy: g.lastReward.legacyFirstClearPaid, lines: g.lastReward.creditLines.map((l) => l.label), cr: g.lastReward.credits, unl: g.lastReward.unlockedMissions });
      }
      return o;
    });
    check('legacy roster: M1 first clear pays the first-clear bonus (new mission)', leg[0].ok && leg[0].first && leg[0].lines.includes('First-time completion'), JSON.stringify(leg[0]));
    check('legacy roster: M3 first clear skips the already-paid outpost bonus, still unlocks M4', leg[2].ok && leg[2].first && leg[2].legacy && !leg[2].lines.includes('First-time completion') && leg[2].unl.join() === 'red-canyon', JSON.stringify(leg[2]));
    const rtext = await page.textContent('#menu');
    check('Results explain the legacy first-clear rule', /already paid for this map in v0\.3/.test(rtext), '');
    check('B: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ================= C. new player through the UI =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(200);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.c-row')].map((r) => r.dataset.id + ':' + r.className.replace('c-row', '').trim()));
    check('Campaign lists M1-M5 + a future slot; M1 available, M2-M5 locked', rows.length === 6 && /first-contact:available/.test(rows[0]) && rows.slice(1, 5).every((r) => /locked/.test(r)) && /soon/.test(rows[5]), rows.join(' '));
    await page.click('[data-a="csel"][data-id="red-canyon"]');
    const lockTxt = await page.textContent('.c-detail');
    check('locked mission shows how to unlock it, Deploy disabled', /Clear Mission 3/.test(lockTxt) && await page.isDisabled('.c-btns [data-a="deploy"]'), lockTxt.replace(/\s+/g, ' ').slice(0, 80));
    if (OUT) await page.screenshot({ path: `${OUT}/campaign-locked-desktop.png` });
    await page.click('[data-a="csel"][data-id="first-contact"]');
    if (OUT) await page.screenshot({ path: `${OUT}/campaign-desktop-new-player.png` });
    await page.click('.c-btns [data-a="deploy"]');
    await page.evaluate(() => window.game.win());
    await page.waitForTimeout(100);
    const unl = await page.evaluate(() => [...document.querySelectorAll('.r-unl')].map((e) => e.textContent.trim()));
    if (OUT) await page.screenshot({ path: `${OUT}/results-first-clear-unlocks-desktop.png` });
    check('Results: NEW SOLDIER JOINED: TANK + Mission 2 unlocked', unl.some((x) => /NEW SOLDIER JOINED: TANK/.test(x)) && unl.some((x) => /MISSION 2 UNLOCKED/.test(x)), unl.join(' | '));
    await page.click('[data-a="campaign"]');
    const sel = await page.evaluate(() => document.querySelector('.c-row.on')?.dataset.id);
    check('Campaign after the first clear: Mission 2 selected, M1 completed', sel === 'heavy-support' && await page.isVisible('.c-row.completed[data-id="first-contact"]'), sel);
    if (OUT) await page.screenshot({ path: `${OUT}/campaign-desktop-after-m1.png` });
    await page.click('[data-a="to-barracks"]');
    check('Barracks: Tank card unlocked with a NEW badge', await page.isVisible('.s-card.new[data-id="tank"] .s-new') && !(await page.isVisible('.s-card.locked[data-id="tank"]')), '');
    if (OUT) await page.screenshot({ path: `${OUT}/barracks-desktop-tank-joined.png` });
    check('C: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log(fails ? `\n${fails} FAILED` : '\nall campaign checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
