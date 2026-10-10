// Rule checks run against the live game object. Prints PASS/FAIL per check and exits 1 on any failure.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.click('[data-a="deploy"]');
  const res = await page.evaluate(async () => {
    const g = window.game; const out = [];
    // v0.4: these rule checks use the comms-outpost map, which is now Mission 3 (Field Medicine)
    // (fresh browser profile: unlock everything first so roster checks can use all six soldiers)
    window.__debugUnlockAll();
    g.selectMission('field-medicine', true);
    const check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: String(detail) });
    const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) g.update(1 / 60); };
    const clearEnemies = () => { g.enemies.forEach(e => e.state = 'dead'); g.enemies = []; g.mission.defenders = [{ active: true }]; };
    const fresh = (squad = 2) => { g.reset(squad); clearEnemies(); g.invuln = false; };
    const r1 = (x) => Math.round(x * 10) / 10;

    // ============ v0.1 rule checks (kept) ============
    // medkit: squad-wide heal of 20% max HP, capped, no revive for downed, nothing for KIA
    fresh();
    let [a, b] = g.soldiers;
    a.hp = 40; b.hp = 95; a.pos = { x: 1300, y: 1060 }; g.anchor = { x: 1300, y: 1060 }; b.pos = { x: 1300, y: 1000 };
    step(0.1);
    check('medkit heals squad 20%, capped', Math.round(a.hp) === 60 && Math.round(b.hp) === 100, `A 40 -> ${Math.round(a.hp)}, B 95 -> ${Math.round(b.hp)}`);
    g.reset(3); clearEnemies();
    const [c, dn, k] = g.soldiers;
    c.hp = 70; g.downSoldier(dn); k.state = 'kia';
    dn.pos = { x: 600, y: 300 }; k.pos = { x: 600, y: 360 };
    c.pos = { x: 1300, y: 1060 }; g.anchor = { x: 1300, y: 1060 };
    step(0.1);
    check('medkit: no revive / nothing for KIA', Math.round(c.hp) === 90 && dn.state === 'downed' && dn.hp === 0 && k.state === 'kia', `living 70 -> ${Math.round(c.hp)}, downed ${dn.state} hp ${dn.hp}, kia ${k.state}`);
    fresh(); g.soldiers[0].pos = { x: 1300, y: 1060 }; g.anchor = { x: 1300, y: 1060 }; step(0.1);
    check('medkit stays when squad is full HP', g.pickups.filter(p => p.type.kind === 'medkit').length === 3, 'medkits left ' + g.pickups.filter(p => p.type.kind === 'medkit').length);
    // revive (Infantry reviver: 10 s)
    fresh();
    g.downSoldier(g.soldiers[0]);
    g.soldiers[1].pos = { ...g.soldiers[0].pos }; g.anchor = { ...g.soldiers[0].pos };
    step(9.5); const mid = g.soldiers[0].state; step(0.7);
    check('revive by Infantry takes 10 s, restores 30% HP (v0.4; was 40%)', mid === 'downed' && g.soldiers[0].state === 'active' && Math.round(g.soldiers[0].hp) === 30, `9.5s ${mid}, 10.2s ${g.soldiers[0].state} hp ${Math.round(g.soldiers[0].hp)}`);
    // bleed-out -> KIA, progress kept when reviver leaves
    fresh();
    let d = g.soldiers[0]; g.downSoldier(d);
    g.soldiers[1].pos = { ...d.pos }; g.anchor = { ...d.pos };
    step(3); const prog = d.reviveProgress;
    g.anchor = { x: d.pos.x + 400, y: d.pos.y }; g.soldiers[1].pos = { x: d.pos.x + 400, y: d.pos.y };
    step(1); const kept = d.reviveProgress;
    step(30);
    check('revive progress kept on leave; bleed-out -> KIA', Math.abs(prog - 0.3) < 0.01 && Math.abs(kept - prog) < 1e-9 && d.state === 'kia', `progress 3s ${prog.toFixed(2)}, after leaving ${kept.toFixed(2)}, final ${d.state}`);
    // squad wipe -> mission failed
    fresh(); g.soldiers.forEach(s => g.downSoldier(s)); step(0.05);
    check('squad wipe fails mission', g.phase === 'failed', g.phase);
    // LOS for every class: enemy behind a building is not targeted; visible one is
    for (const cls of ['infantry', 'heavy', 'medic']) {
      fresh([cls, 'infantry']);
      const s = g.soldiers[0]; s.pos = { x: 1000, y: 680 }; g.soldiers[1].pos = { x: 100, y: 100 }; g.anchor = { ...s.pos };
      const e = g.spawnEnemy({ x: 1300, y: 680 }); e.guard = true;
      step(0.5);
      const blocked = !s.target && !e.target;
      e.pos = { x: 1000, y: 900 }; step(0.3);
      check(`LOS + auto-target (${cls})`, blocked && s.target === e, `blocked=${blocked}, clear target=${s.target === e ? 'enemy' : 'none'}`);
    }
    // bullets stop at walls
    fresh();
    g.projectiles.push({ pos: { x: 780, y: 760 }, vel: { x: 900, y: 0 }, team: 'enemy', damage: 5, life: 2, trail: { x: 780, y: 760 } });
    g.projectiles.push({ pos: { x: 780, y: 700 }, vel: { x: 700, y: 0 }, team: 'squad', damage: 5, life: 2, trail: { x: 780, y: 700 } });
    step(0.2);
    check('bullets stop at walls (both teams)', g.projectiles.length === 0, 'left ' + g.projectiles.length);
    // grenade: unchanged, no friendly damage
    fresh();
    const t = g.soldiers[0]; const hp0 = g.soldiers.map(x => x.hp);
    const en = g.spawnEnemy({ x: t.pos.x + 60, y: t.pos.y }); en.reactionTime = 99; // it never fires: any friendly HP loss would be the grenade
    const sc0 = g.scorches.length;
    const began = g.useAbility(t); const tm = !!g.targeting;
    g.onTargetConfirm(g.worldToScreen({ x: t.pos.x + 30, y: t.pos.y }));
    step(1.2);
    check('grenade: targeted input, explodes, spares friendlies, 8 s cooldown', began && tm && g.scorches.length === sc0 + 1 && en.state === 'dead' && g.soldiers.every((x, i) => x.hp === hp0[i]) && Math.abs(t.ability.cooldownLeft - (8 - 1.2)) < 0.05,
      `targeting=${tm}, explosions ${g.scorches.length - sc0}, enemy ${en.state}, friendly ${g.soldiers.map(x => Math.round(x.hp))}, cd ${t.ability.cooldownLeft.toFixed(2)}`);
    // extraction with a downed soldier -> KIA
    fresh();
    g.mission.debugReadyExtraction(g);
    g.downSoldier(g.soldiers[1]); g.soldiers[1].pos = { x: 2000, y: 700 };
    g.soldiers[0].pos = { x: 3200, y: 250 }; g.anchor = { x: 3200, y: 250 };
    step(0.2);
    // v0.6: the extraction HOLDS and the "soldier left behind" warning opens (nothing pauses); Confirm
    // (armed after 0.6 s) leaves the downed soldier behind = KIA (abandoned)
    const held = g.phase === 'playing' && g.mission.attempt === 'warning' && !g.confirmExtraction();
    step(0.5);
    const conf = g.confirmExtraction();
    check('extraction with a downed soldier: holds + warning, Confirm -> win, left behind = KIA', held && conf && g.phase === 'won' && g.soldiers[1].state === 'kia' && g.soldiers[1].kiaCause === 'abandoned', `held ${held} confirm ${conf} ${g.phase} ${g.soldiers.map(x => x.state)}`);

    // ============ v0.2.1: classes ============
    const expect = {
      infantry: { hp: 100, damage: 10, fireRate: 3, accuracy: 12, moving: 30, moveSpeed: 150, projectileSpeed: 700, reviveTime: 10, ability: 'grenade' },
      heavy: { hp: 150, damage: 6, fireRate: 7, accuracy: 15, moving: 40, moveSpeed: 120, projectileSpeed: 700, reviveTime: 12, ability: 'suppressive' },
      medic: { hp: 80, damage: 7, fireRate: 2.5, accuracy: 10, moving: 28, moveSpeed: 157.5, projectileSpeed: 700, reviveTime: 5, ability: 'fieldTreatment' },
    };
    fresh(['infantry', 'heavy', 'medic']);
    for (const s of g.soldiers) {
      const e = expect[s.identity.classId], st = s.stats;
      s.moveFrac = 0; const still = s.cone; s.moveFrac = 1; const mov = s.cone; s.moveFrac = 0;
      const ok = s.hp === e.hp && s.maxHp === e.hp && st.damage === e.damage && st.fireRate === e.fireRate && still === e.accuracy && mov === e.moving
        && st.moveSpeed === e.moveSpeed && st.projectileSpeed === e.projectileSpeed && st.reviveTime === e.reviveTime && s.ability.id === e.ability;
      check(`class stats: ${s.identity.classId}`, ok, `hp ${s.hp}/${s.maxHp} dmg ${st.damage} rate ${st.fireRate} cone ${still}°/${mov}° speed ${st.moveSpeed} proj ${st.projectileSpeed} revive ${st.reviveTime}s ability ${s.ability.id}`);
    }
    // identity: unique ids, names; snapshot
    const ids = g.soldiers.map(s => s.identity.id), names = g.soldiers.map(s => s.name);
    check('identity: unique ids + names', new Set(ids).size === ids.length && new Set(names).size === names.length, `${ids} ${names}`);
    const snap = g.soldiers[1].snapshot();
    check('identity snapshot has id/name/class/hp/status/cooldown', snap.classId === 'heavy' && snap.maxHp === 150 && snap.status === 'alive' && snap.ability === 'Suppressive Fire' && 'abilityCooldown' in snap, JSON.stringify(snap));
    // multiple of the same class: independent abilities
    fresh(['heavy', 'heavy']);
    const [h1, h2] = g.soldiers;
    g.useAbility(h1);
    check('2 Heavy: separate identities + ability instances', h1.ability !== h2.ability && h1.identity.id !== h2.identity.id && h1.ability.activeLeft > 0 && h2.ability.activeLeft === 0 && h2.fireRate === 7,
      `h1 active ${h1.ability.activeLeft}, h2 active ${h2.ability.activeLeft}, h2 rate ${h2.fireRate}`);
    // preset switching resets cleanly
    const presets = [['infantry','infantry'],['infantry','heavy'],['infantry','medic'],['infantry','heavy','medic'],['heavy','heavy'],['medic','medic']];
    let presetOk = true, presetLog = [];
    for (const p of presets) {
      g.soldiers.forEach(s => { s.hp = 1; if (s.ability) s.ability.cooldownLeft = 9; });
      g.reset(p);
      const ok = g.soldiers.length === p.length && g.soldiers.every((s, i) => s.identity.classId === p[i] && s.hp === s.maxHp && s.ability.cooldownLeft === 0 && s.ability.activeLeft === 0 && s.state === 'active' && s.ability.id === expect[p[i]].ability)
        && g.phase === 'playing' && g.time === 0 && g.projectiles.length === 0 && document.querySelectorAll('.panel').length === p.length;
      presetOk = presetOk && ok; presetLog.push(`${p.join('+')}:${ok ? 'ok' : 'BAD'}`);
    }
    check('preset switching restarts with correct squads', presetOk, presetLog.join(' '));
    // projectile speeds: per class 700, enemy 390, independently configurable
    const measure = (cls) => {
      fresh([cls]); clearEnemies();
      const sh = g.soldiers[0]; sh.pos = { x: 1000, y: 900 }; g.anchor = { ...sh.pos }; g.cam = { ...sh.pos };
      const e = g.spawnEnemy({ x: 1250, y: 900 }); e.hp = 1e6; g.projectiles = [];
      let es = 0, fs = 0;
      for (let i = 0; i < 600 && !(es && fs); i++) { g.update(1 / 60); for (const p of g.projectiles) { const v = Math.round(Math.hypot(p.vel.x, p.vel.y)); if (p.team === 'enemy') es = v; else fs = v; } }
      return [fs, es];
    };
    const sp = { infantry: measure('infantry'), heavy: measure('heavy'), medic: measure('medic') };
    check('projectile speed: friendly 700 (all classes), enemy 390', ['infantry', 'heavy', 'medic'].every(c => sp[c][0] === 700 && sp[c][1] === 390), JSON.stringify(sp));
    // (soldier stats are computed per read since v0.2.2, so tune the CLASS group in CFG)
    const hs = window.__CFG.heavy; hs.projectileSpeed = 900;
    const hv = measure('heavy')[0], iv = measure('infantry')[0];
    hs.projectileSpeed = 700;
    check('projectile speed is per class', hv === 900 && iv === 700, `heavy set to 900 -> ${hv}, infantry ${iv}`);
    // spread: empirical distribution matches the full-cone convention (uniform in +/- cone/2)
    const spread = (cls, moving) => {
      fresh([cls]); g.invuln = true;
      const sh = g.soldiers[0]; sh.pos = { x: 1000, y: 1250 }; g.anchor = { ...sh.pos }; g.cam = { ...sh.pos };
      const e = g.spawnEnemy({ x: 1300, y: 1250 }); e.hp = 1e9; e.guard = true; e.speedRand = 0;
      sh.ability.cooldownLeft = 1e9;
      const devs = []; let n = 0;
      g.input.move = () => moving ? { x: 0, y: (Math.floor(g.time / 1.5) % 2) ? 1 : -1 } : { x: 0, y: 0 };
      for (let i = 0; i < 60 * 120 && devs.length < 1500; i++) {
        const before = new Set(g.projectiles);
        g.update(1 / 60);
        e.pos = { x: 1300, y: sh.pos.y };
        for (const p of g.projectiles) if (!before.has(p) && p.owner === sh) {
          let dv = Math.atan2(p.vel.y, p.vel.x) - sh.aim; while (dv > Math.PI) dv -= 2 * Math.PI; while (dv < -Math.PI) dv += 2 * Math.PI;
          devs.push({ dv: dv * 180 / Math.PI, cone: sh.cone });
        }
      }
      g.input.move = Object.getPrototypeOf(g.input).move.bind(g.input);
      const maxDev = Math.max(...devs.map(x => Math.abs(x.dv)));
      const coneAvg = devs.reduce((a, x) => a + x.cone, 0) / devs.length;
      const sd = Math.sqrt(devs.reduce((a, x) => a + x.dv * x.dv, 0) / devs.length);
      const overHalf = devs.filter(x => Math.abs(x.dv) > x.cone / 2 + 1e-6).length;
      return { n: devs.length, maxDev: r1(maxDev), coneAvg: r1(coneAvg), sd: r1(sd), uniformSd: r1(coneAvg / Math.sqrt(12)), overHalf };
    };
    for (const cls of ['infantry', 'heavy', 'medic']) {
      const st = spread(cls, false);
      check(`spread still (${cls}): within ±cone/2, uniform`, st.overHalf === 0 && st.coneAvg === expect[cls].accuracy && Math.abs(st.sd - st.uniformSd) < 0.6 && st.maxDev > st.coneAvg / 2 * 0.9,
        `${st.n} shots, cone ${st.coneAvg}°, max dev ${st.maxDev}° (half-cone ${st.coneAvg / 2}), sd ${st.sd} vs uniform ${st.uniformSd}`);
    }
    const mv = spread('infantry', true);
    check('spread moving (infantry) widens toward 30°', mv.overHalf === 0 && mv.coneAvg > 20 && mv.maxDev <= 15.01, `${mv.n} shots, avg cone ${mv.coneAvg}°, max dev ${mv.maxDev}°`);
    // enemy spread unchanged
    fresh(); const en9 = g.spawnEnemy({ x: 100, y: 100 }); en9.moveFrac = 0;
    check('enemy rifleman spread unchanged (9°)', en9.cone === 9, en9.cone);

    // ============ abilities ============
    // Suppressive Fire
    fresh(['heavy', 'infantry']); g.invuln = true;
    let H = g.soldiers[0]; H.pos = { x: 1000, y: 1250 }; g.soldiers[1].pos = { x: 960, y: 1300 }; g.anchor = { ...H.pos }; g.cam = { ...H.pos };
    let tgt = g.spawnEnemy({ x: 1250, y: 1250 }); tgt.hp = 1e9; tgt.guard = true;
    step(1); let s0 = H.shots; step(4); const baseRate = (H.shots - s0) / 4;
    const coneBefore = H.cone;
    const act = g.useAbility(H);
    const st0 = { active: H.ability.activeLeft, cd: H.ability.cooldownLeft, rate: H.fireRate };
    s0 = H.shots; step(4); const supRate = (H.shots - s0) / 4; const coneDuring = H.cone;
    const again = g.useAbility(H);
    step(1.2); const after = { active: H.ability.activeLeft, rate: H.fireRate };
    check('Suppressive: activates (5 s, 20 s cd from activation, x1.75 rate)', act && st0.active === 5 && st0.cd === 20 && Math.abs(st0.rate - 12.25) < 1e-9, JSON.stringify(st0));
    check('Suppressive: measured fire rate rises ~1.75x, accuracy unchanged', supRate / baseRate > 1.55 && supRate / baseRate < 1.95 && coneBefore === coneDuring, `${r1(baseRate)}/s -> ${r1(supRate)}/s (x${(supRate / baseRate).toFixed(2)}), cone ${coneBefore}° -> ${coneDuring}°`);
    check('Suppressive: no re-activation while active/cooling; expires after 5 s', !again && after.active === 0 && after.rate === 7 && g.soldiers[1].fireRate === 3, `again=${again}, after ${JSON.stringify(after)}, infantry rate ${g.soldiers[1].fireRate}`);
    step(20 - 5.2 - 0.3); const notYet = H.ability.ready(H); step(0.4);
    check('Suppressive: ready again 20 s after activation', !notYet && H.ability.ready(H), `at 19.7s ready=${notYet}, at 20.1s ready=${H.ability.ready(H)}`);
    // Field Treatment
    fresh(['medic', 'infantry', 'heavy', 'infantry', 'infantry']);
    const [M, near, nearFull, far, dnear] = g.soldiers;
    const P = { x: 1300, y: 1250 };
    M.pos = { ...P }; near.pos = { x: P.x + 100, y: P.y }; nearFull.pos = { x: P.x, y: P.y + 130 }; far.pos = { x: P.x + 200, y: P.y }; dnear.pos = { x: P.x - 60, y: P.y };
    M.hp = 40; near.hp = 30; nearFull.hp = 140; far.hp = 30;
    g.downSoldier(dnear);
    const ft = g.useAbility(M);
    check('Field Treatment: heals 25% max HP in radius incl. Medic', ft && M.hp === 60 && near.hp === 55, `medic 40 -> ${M.hp}, infantry@100px 30 -> ${near.hp}`);
    check('Field Treatment: capped at max HP', nearFull.hp === 150, `heavy@130px 140 -> ${nearFull.hp}`);
    check('Field Treatment: nobody outside 140 px', far.hp === 30, `infantry@200px 30 -> ${far.hp}`);
    check('Field Treatment: never revives downed', dnear.state === 'downed' && dnear.hp === 0, `${dnear.state} hp ${dnear.hp}`);
    check('Field Treatment: 25 s cooldown, blocked while cooling', M.ability.cooldownLeft === 25 && !g.useAbility(M) && M.ability.cooldownLeft === 25 && /RECHARGING/.test(g.notice?.text || ''), `cd ${M.ability.cooldownLeft}, notice "${g.notice?.text}"`);
    fresh(['medic', 'infantry']); g.soldiers[1].state = 'kia'; g.soldiers[1].hp = 50; g.soldiers[1].pos = { ...g.soldiers[0].pos };
    const noHurt = g.useAbility(g.soldiers[0]);
    check('Field Treatment: KIA ignored; nobody hurt -> refused, no cooldown spent', !noHurt && g.soldiers[1].hp === 50 && g.soldiers[0].ability.cooldownLeft === 0 && /NOBODY HURT/.test(g.notice?.text || ''), `used=${noHurt}, kia hp ${g.soldiers[1].hp}, notice "${g.notice?.text}"`);
    fresh(['medic', 'infantry']); g.downSoldier(g.soldiers[0]);
    check('ability blocked while the owner is downed', !g.useAbility(g.soldiers[0]) && /DOWNED/.test(g.notice?.text || ''), g.notice?.text);
    check('medkits still squad-wide', true, 'covered by the medkit checks above');

    // ============ revive per class ============
    const reviveTime = (reviverCls) => {
      fresh(['infantry', reviverCls]);
      const v = g.soldiers[0]; g.downSoldier(v);
      g.soldiers[1].pos = { x: v.pos.x + 15, y: v.pos.y }; g.anchor = { ...g.soldiers[1].pos };
      let tt = 0; while (v.state === 'downed' && tt < 40) { g.update(1 / 60); tt += 1 / 60; }
      return r1(tt);
    };
    const rt = { infantry: reviveTime('infantry'), heavy: reviveTime('heavy'), medic: reviveTime('medic') };
    check('revive duration by reviver class (10 / 12 / 5 s)', Math.abs(rt.infantry - 10) <= 0.1 && Math.abs(rt.heavy - 12) <= 0.1 && Math.abs(rt.medic - 5) <= 0.1, JSON.stringify(rt));
    // reviver switch: Infantry 5 s (50%), leaves, Medic finishes the remaining 50% in 2.5 s
    fresh(['infantry', 'infantry', 'medic']);
    const v = g.soldiers[0]; g.downSoldier(v);
    const [, ri, rm] = g.soldiers; const away = { x: v.pos.x + 500, y: v.pos.y + 200 };
    ri.pos = { x: v.pos.x + 15, y: v.pos.y }; rm.pos = { ...away };
    let fr = [];
    for (let i = 0; i < 300; i++) { g.update(1 / 60); ri.pos = { x: v.pos.x + 15, y: v.pos.y }; rm.pos = { ...away }; }
    fr.push(v.reviveProgress);
    for (let i = 0; i < 60; i++) { g.update(1 / 60); ri.pos = { ...away }; rm.pos = { ...away }; }
    fr.push(v.reviveProgress);
    rm.pos = { x: v.pos.x - 15, y: v.pos.y };
    g.update(1 / 60); const notInstant = v.state === 'downed';
    let tt = 1 / 60; while (v.state === 'downed' && tt < 10) { g.update(1 / 60); rm.pos = { x: v.pos.x - 15, y: v.pos.y }; ri.pos = { ...away }; tt += 1 / 60; }
    check('reviver switch keeps fractional progress, no instant revive', Math.abs(fr[0] - 0.5) < 0.01 && Math.abs(fr[1] - fr[0]) < 0.003 && notInstant && Math.abs(tt - 2.5) < 0.1,
      `after 5s Infantry ${fr[0].toFixed(2)}, paused ${fr[1].toFixed(2)}, Medic finished in ${tt.toFixed(2)}s`);
    // two revivers: fastest counts, no stacking
    fresh(['infantry', 'infantry', 'medic']);
    const v2 = g.soldiers[0]; g.downSoldier(v2);
    let t2 = 0; while (v2.state === 'downed' && t2 < 20) { g.soldiers[1].pos = { x: v2.pos.x + 15, y: v2.pos.y }; g.soldiers[2].pos = { x: v2.pos.x - 15, y: v2.pos.y }; g.update(1 / 60); t2 += 1 / 60; }
    check('two revivers: fastest (Medic) counts, no stacking', Math.abs(t2 - 5) < 0.1, `${t2.toFixed(2)}s`);
    // downed Medic bleeds out normally
    fresh(['medic', 'infantry']); g.invuln = true; const dm = g.soldiers[0]; g.downSoldier(dm); g.soldiers[1].pos = { x: dm.pos.x + 600, y: dm.pos.y }; g.anchor = { ...g.soldiers[1].pos };
    step(19.5); const stillDown = dm.state; step(0.6);
    check('downed Medic bleeds out at 20 s -> KIA (v0.4; was 30 s)', stillDown === 'downed' && dm.state === 'kia', `${stillDown} -> ${dm.state}`);

    // ============ movement ============
    const run = (squad) => {
      fresh(squad); g.invuln = true; g.pickups = [];
      const start = { x: 300, y: 1350 }; g.anchor = { ...start };
      g.soldiers.forEach((s, i) => s.pos = { x: start.x - 20 * i, y: start.y + (i % 2 ? 30 : -30) });
      g.input.move = () => ({ x: 1, y: 0 });
      let maxJump = 0, maxLag = 0; const prev = g.soldiers.map(s => ({ ...s.pos }));
      for (let i = 0; i < 60 * 6; i++) {
        g.update(1 / 60);
        g.soldiers.forEach((s, j) => { maxJump = Math.max(maxJump, Math.hypot(s.pos.x - prev[j].x, s.pos.y - prev[j].y)); prev[j] = { ...s.pos }; });
        const cx = g.soldiers.reduce((a, s) => a + s.pos.x, 0) / g.soldiers.length;
        if (i > 120) maxLag = Math.max(maxLag, ...g.soldiers.map(s => cx - s.pos.x));
      }
      g.input.move = Object.getPrototypeOf(g.input).move.bind(g.input);
      const cx = g.soldiers.reduce((a, s) => a + s.pos.x, 0) / g.soldiers.length;
      return { speed: Math.round((cx - start.x) / 6), maxJump: r1(maxJump * 60), maxLag: Math.round(maxLag), boost: r1(Math.max(...g.soldiers.map(s => s.catchUp))) };
    };
    const mvII = run(['infantry', 'infantry']), mvIH = run(['infantry', 'heavy']), mvHH = run(['heavy', 'heavy']), mvIHM = run(['infantry', 'heavy', 'medic']);
    check('movement: Heavy slows a mixed squad only modestly', mvIH.speed >= mvII.speed * 0.85 && mvHH.speed < mvIH.speed,
      `squad speed px/s: 2 Inf ${mvII.speed}, Inf+Heavy ${mvIH.speed}, Inf+Heavy+Medic ${mvIHM.speed}, 2 Heavy ${mvHH.speed}`);
    check('movement: no snapping (max per-step speed <= 1.1 x boosted class speed)', Math.max(mvII.maxJump, mvIH.maxJump, mvIHM.maxJump) <= 150 * 1.05 * 1.25 * 1.1 + 5,
      `max soldier speed seen px/s: ${mvII.maxJump}, ${mvIH.maxJump}, ${mvIHM.maxJump}; max lag behind centre ${mvII.maxLag}/${mvIH.maxLag}/${mvIHM.maxLag}px`);

    // ============ tuning JSON compatibility ============
    const old = { infantry: { hp: 100, damage: 10, accuracy: 7, movePenalty: 18, fireRate: 4, range: 420, moveSpeed: 150, projectileSpeed: 950, abilityCooldown: 6, turnRate: 14, aimTolerance: 12, radius: 12 },
      enemy: { projectileSpeed: 390 }, revive: { radius: 55, time: 8, bleedOut: 30, hpFrac: 0.4 }, squad: { startSize: 2 }, bogus: { x: 1 } };
    const H0 = JSON.stringify({ h: g.soldiers[0].stats });
    const notes = window.__applyConfigJSON ? window.__applyConfigJSON(JSON.stringify(old)) : null;
    fresh(['infantry', 'heavy']);
    const inf = g.soldiers[0].stats, hv2 = g.soldiers[1].stats;
    const okOld = notes && inf.accuracy === 7 && inf.fireRate === 4 && inf.projectileSpeed === 950 && inf.reviveTime === 8 && hv2.reviveTime === 12 && hv2.projectileSpeed === 700 && window.__CFG.grenade.cooldown === 6;
    check('old v0.1.x tuning JSON loads; deprecated keys mapped; new fields keep defaults', okOld, `notes ${JSON.stringify(notes)}; infantry acc ${inf.accuracy} rate ${inf.fireRate} proj ${inf.projectileSpeed} revive ${inf.reviveTime}; heavy revive ${hv2.reviveTime}; grenade cd ${window.__CFG?.grenade.cooldown}`);
    window.__resetConfig && window.__resetConfig();
    fresh(['infantry']);
    check('reset to defaults restores v0.2.1 values', g.soldiers[0].stats.accuracy === 12 && g.soldiers[0].stats.projectileSpeed === 700 && window.__CFG.grenade.cooldown === 8, `${g.soldiers[0].stats.accuracy} ${g.soldiers[0].stats.projectileSpeed}`);

    // ============ v0.2.2: roster, traits, selection, mission stats ============
    const CFG = window.__CFG, eff = window.__effectiveStats;
    const cfgSnapshot = JSON.stringify(CFG);
    const R = g.roster;
    const savedSlots = [...R.slots];
    const byId = (id) => R.get(id);
    const deployIds = (ids) => { g.deploy(ids.map(byId)); clearEnemies(); g.invuln = false; };

    // roster
    const want = [['ace', 'Ace', 'infantry', 'sharpshooter'], ['ranger', 'Ranger', 'infantry', 'quickReflexes'], ['tank', 'Tank', 'heavy', 'tough'],
      ['havoc', 'Havoc', 'heavy', 'triggerHappy'], ['doc', 'Doc', 'medic', 'firstResponder'], ['patch', 'Patch', 'medic', 'healer']];
    const rosterOk = R.soldiers.length === 6 && want.every(([id, name, cls, tr], i) => {
      const s = R.soldiers[i];
      return s.id === id && s.name === name && s.classId === cls && s.traitId === tr && Object.keys(s.mods).length === 0
        && s.progression && s.progression.level === 1 && s.progression.xp === 0 && s.progression.upgrades.length === 0 && s.progression.specialization === null;
    });
    check('roster: six default soldiers (name/class/trait/progression)', rosterOk, R.soldiers.map(s => `${s.id}:${s.classId}:${s.traitId}:L${s.progression?.level}/${s.progression?.xp}xp`).join(' '));
    check('roster: stable unique ids, exactly one trait each', new Set(R.soldiers.map(s => s.id)).size === 6 && R.soldiers.every(s => typeof s.traitId === 'string' && window.__TRAITS[s.traitId]), R.soldiers.map(s => s.id).join(','));

    // effective stats (class base -> trait), all six
    const E = Object.fromEntries(R.soldiers.map(s => [s.id, eff(s)]));
    const row = (st) => `hp ${st.hp} rate ${st.fireRate} cone ${st.accuracy}/${r1(st.accuracy + st.movePenalty)} speed ${st.moveSpeed} revive ${st.reviveTime} heal x${st.healMul}`;
    const expectEff = {
      ace: { hp: 100, fireRate: 3, accuracy: 10.8, moving: 27, moveSpeed: 150, reviveTime: 10, healMul: 1 },
      ranger: { hp: 100, fireRate: 3, accuracy: 12, moving: 30, moveSpeed: 157.5, reviveTime: 10, healMul: 1 },
      tank: { hp: 165, fireRate: 7, accuracy: 15, moving: 40, moveSpeed: 120, reviveTime: 12, healMul: 1 },
      havoc: { hp: 150, fireRate: 7.35, accuracy: 15, moving: 40, moveSpeed: 120, reviveTime: 12, healMul: 1 },
      doc: { hp: 80, fireRate: 2.5, accuracy: 10, moving: 28, moveSpeed: 157.5, reviveTime: 4.5, healMul: 1 },
      patch: { hp: 80, fireRate: 2.5, accuracy: 10, moving: 28, moveSpeed: 157.5, reviveTime: 5, healMul: 1.1 },
    };
    for (const [id, x] of Object.entries(expectEff)) {
      const st = E[id];
      const ok = st.hp === x.hp && st.fireRate === x.fireRate && st.accuracy === x.accuracy && r1(st.accuracy + st.movePenalty) === x.moving
        && st.moveSpeed === x.moveSpeed && st.reviveTime === x.reviveTime && st.healMul === x.healMul;
      check(`trait effect: ${id} (${byId(id).traitId})`, ok, row(st));
    }
    check('traits do not mutate shared class defaults (CFG unchanged)', JSON.stringify(CFG) === cfgSnapshot && CFG.infantry.accuracy === 12 && CFG.heavy.hp === 150 && CFG.heavy.fireRate === 7 && CFG.medic.reviveTime === 5, `infantry acc ${CFG.infantry.accuracy}, heavy hp ${CFG.heavy.hp} rate ${CFG.heavy.fireRate}, medic revive ${CFG.medic.reviveTime}`);
    // tuning panel edits class defaults; traits apply on top, live
    CFG.heavy.hp = 200; CFG.infantry.accuracy = 20;
    const tuned = [eff(byId('tank')).hp, eff(byId('havoc')).hp, eff(byId('ace')).accuracy, eff(byId('ranger')).accuracy];
    CFG.heavy.hp = 150; CFG.infantry.accuracy = 12;
    check('tuning edits class base; traits apply on top', tuned.join() === '220,200,18,20', `heavy hp 200 -> Tank ${tuned[0]}, Havoc ${tuned[1]}; infantry spread 20 -> Ace ${tuned[2]}, Ranger ${tuned[3]}`);
    // individual modifiers: upgrading Ace does not touch Ranger or the class
    byId('ace').mods.fireRateMul = 1.2;
    const indiv = [eff(byId('ace')).fireRate, eff(byId('ranger')).fireRate, CFG.infantry.fireRate];
    delete byId('ace').mods.fireRateMul;
    check('individual modifiers are per soldier (Ace x1.2 rate, Ranger unchanged)', indiv.join() === '3.6,3,3' && eff(byId('ace')).fireRate === 3, `Ace ${indiv[0]}, Ranger ${indiv[1]}, class ${indiv[2]}, Ace after removal ${eff(byId('ace')).fireRate}`);

    // no stacking across deploy / retry
    let stackLog = [];
    for (let i = 0; i < 4; i++) {
      if (i === 0) deployIds(['tank', 'havoc', 'ace']); else { g.reset(); clearEnemies(); }
      const [t, h, a] = g.soldiers;
      stackLog.push(`${t.maxHp}/${t.hp},${h.fireRate},${a.cone}`);
    }
    check('traits never stack on deploy + retry (x4)', stackLog.every(x => x === '165/165,7.35,10.8'), stackLog.join(' | '));
    check('deployed units copy identities (mission never shares roster objects)', g.soldiers[0].identity !== byId('tank') && g.soldiers[0].identity.id === 'tank', `same object: ${g.soldiers[0].identity === byId('tank')}`);

    // selection rules (on the live roster; restored afterwards)
    R.slots = Array(6).fill(null);
    const sel = [R.select('ace', undefined, 3), R.select('ranger', undefined, 3), R.select('ace', undefined, 3), R.select('tank', undefined, 3), R.select('doc', undefined, 3)];
    check('selection: up to the cap (3), 4th refused, duplicates impossible', sel[0].ok && sel[1].ok && sel[2].ok && sel[2].slot === 0 && sel[3].ok && !sel[4].ok && R.slots.join() === 'ace,ranger,tank,,,',
      `results ${sel.map(x => x.ok ? 'ok@' + x.slot : 'refused').join(' ')}, slots ${R.slots.join()}`);
    R.select('doc', 1); // replace slot 2
    const afterReplace = R.slots.join();
    R.select('doc', 2); // move doc to slot 3: never in two slots
    // v0.4: the selection is a packed list, so moving Doc onto Tank's slot leaves 'ace,doc'
    check('selection: replace a slot; moving never duplicates', afterReplace === 'ace,doc,tank,,,' && R.slots.join() === 'ace,doc,,,,' && R.slots.filter(x => x === 'doc').length === 1, `${afterReplace} -> ${R.slots.join()}`);
    g.roster.slots = ['ace', 'ranger', null]; g.deploySelected(); clearEnemies();
    const [sa, sr] = g.soldiers;
    check('deploy: two Infantry with their own identity + traits', g.soldiers.length === 2 && sa.identity.id === 'ace' && sr.identity.id === 'ranger' && sa.cone === 10.8 && sr.cone === 12 && sa.ability !== sr.ability && sr.stats.moveSpeed === 157.5 && sa.stats.moveSpeed === 150,
      `${g.soldiers.map(s => `${s.name}/${s.identity.traitId} cone ${s.cone} speed ${s.stats.moveSpeed}`).join(', ')}`);
    R.slots = Array(6).fill(null);
    const ph = g.phase, n0 = g.soldiers.length;
    const deployedEmpty = g.deploySelected();
    check('deploy needs at least one soldier', !deployedEmpty.ok && g.phase === ph && g.soldiers.length === n0, `deploySelected() -> ${JSON.stringify(deployedEmpty)}`);
    R.slots = ['havoc', null, 'patch'];
    g.deploySelected(); clearEnemies();
    check('deploy uses exactly the selected soldiers, in slot order (no generic fallback)', g.soldiers.map(s => s.identity.id).join() === 'havoc,patch' && g.soldiers.every(s => s.identity.traitId && !/^G/.test(s.identity.id)) && g.deployment.kind === 'roster',
      g.soldiers.map(s => `${s.identity.id}:${s.identity.classId}:${s.identity.traitId}`).join(' '));

    // traits in combat
    const hv3 = g.soldiers[0];
    const rates = [hv3.fireRate]; g.useAbility(hv3); rates.push(hv3.fireRate); hv3.ability.activeLeft = 0; hv3.rapidFire = 5; rates.push(hv3.fireRate); hv3.rapidFire = 0;
    check('Trigger Happy x Suppressive: 7.35 base, x1.75 on top = 12.8625', r1(rates[0] * 100) / 100 === 7.35 && Math.abs(rates[1] - 12.8625) < 1e-9 && Math.abs(rates[2] - 13.23) < 1e-9, `base ${rates[0]}, suppressing ${rates[1]}, rapid fire ${rates[2]}`);
    const measureRate = (id) => {
      deployIds([id]); g.invuln = true; g.pickups = [];
      const sh = g.soldiers[0]; sh.pos = { x: 1000, y: 1250 }; g.anchor = { ...sh.pos }; g.cam = { ...sh.pos }; sh.ability.cooldownLeft = 1e9;
      const e = g.spawnEnemy({ x: 1250, y: 1250 }); e.hp = 1e9; e.guard = true; e.reactionTime = 1e9;
      step(1); const s0 = sh.shots; step(40); return (sh.shots - s0) / 40;
    };
    const rH = measureRate('havoc'), rT = measureRate('tank');
    check('Trigger Happy measured in combat: Havoc fires ~5% faster than Tank', rH / rT > 1.02 && rH / rT < 1.09, `Havoc ${r1(rH * 10) / 10}/s vs Tank ${r1(rT * 10) / 10}/s (x${(rH / rT).toFixed(3)})`);
    // Sharpshooter measured: shots stay inside ±5.4° still
    const devsOf = (id) => {
      deployIds([id]); g.invuln = true; g.pickups = [];
      const sh = g.soldiers[0]; sh.pos = { x: 1000, y: 1250 }; g.anchor = { ...sh.pos }; g.cam = { ...sh.pos }; sh.ability.cooldownLeft = 1e9;
      const e = g.spawnEnemy({ x: 1300, y: 1250 }); e.hp = 1e9; e.guard = true; e.reactionTime = 1e9;
      const devs = [];
      for (let i = 0; i < 60 * 90 && devs.length < 300; i++) {
        const before = new Set(g.projectiles); g.update(1 / 60);
        for (const p of g.projectiles) if (!before.has(p) && p.owner === sh) { let dv = Math.atan2(p.vel.y, p.vel.x) - sh.aim; while (dv > Math.PI) dv -= 2 * Math.PI; while (dv < -Math.PI) dv += 2 * Math.PI; devs.push(Math.abs(dv * 180 / Math.PI)); }
      }
      return devs;
    };
    const dAce = devsOf('ace'), dRanger = devsOf('ranger');
    check('Sharpshooter in combat: Ace shots within ±5.4°, Ranger uses ±6°', Math.max(...dAce) <= 5.4 + 1e-6 && Math.max(...dAce) > 4.8 && Math.max(...dRanger) > 5.4,
      `Ace max dev ${r1(Math.max(...dAce))}° (${dAce.length} shots), Ranger max dev ${r1(Math.max(...dRanger))}° (${dRanger.length} shots)`);
    // Quick Reflexes: Ranger alone moves 5% faster than Ace alone
    const soloSpeed = (id) => {
      deployIds([id]); g.invuln = true; g.pickups = [];
      const st = { x: 300, y: 1350 }; g.anchor = { ...st }; g.soldiers[0].pos = { ...st };
      g.input.move = () => ({ x: 1, y: 0 }); step(2); const x0 = g.soldiers[0].pos.x, a0 = g.anchor.x; step(5);
      g.input.move = Object.getPrototypeOf(g.input).move.bind(g.input);
      return [(g.soldiers[0].pos.x - x0) / 5, (g.anchor.x - a0) / 5, g.soldiers[0].stats.moveSpeed];
    };
    const vA = soloSpeed('ace'), vR = soloSpeed('ranger');
    check('Quick Reflexes in combat: Ranger moves ~5% faster than Ace', vR[2] === 157.5 && vA[2] === 150 && vR[0] / vA[0] > 1.03 && vR[0] / vA[0] < 1.07,
      `class speed ${vA[2]} vs ${vR[2]}; measured soldier ${Math.round(vA[0])} vs ${Math.round(vR[0])} px/s (x${(vR[0] / vA[0]).toFixed(3)}), anchor ${Math.round(vA[1])} vs ${Math.round(vR[1])}`);
    // Tough: Tank starts at 165/165, Field Treatment heals 25% of 165
    deployIds(['tank', 'doc']);
    const [tk, dc] = g.soldiers; const tk0 = `${tk.hp}/${tk.maxHp}`;
    tk.hp = 50; tk.pos = { ...dc.pos, x: dc.pos.x + 30 };
    g.useAbility(dc);
    check('Tough in combat: Tank 165 HP; Doc heals 25% of it (41.25)', tk0 === '165/165' && tk.hp === 91.25, `start ${tk0}, 50 -> ${tk.hp}`);
    // First Responder: Doc revives in 4.5 s, Patch in 5 s
    const reviveBy = (rid) => {
      deployIds(['ace', rid]); const v = g.soldiers[0]; g.downSoldier(v);
      g.soldiers[1].pos = { x: v.pos.x + 15, y: v.pos.y }; g.anchor = { ...g.soldiers[1].pos };
      let tt = 0; while (v.state === 'downed' && tt < 20) { g.update(1 / 60); tt += 1 / 60; } return r1(tt);
    };
    const tDoc = reviveBy('doc'), tPatch = reviveBy('patch');
    check('First Responder in combat: Doc revives in 4.5 s (Patch 5 s)', Math.abs(tDoc - 4.5) <= 0.05 && Math.abs(tPatch - 5) <= 0.05, `Doc ${tDoc}s, Patch ${tPatch}s`);
    // Healer: Patch heals 27.5%, Doc 25%; medkits unaffected (20%)
    const ftBy = (mid) => { deployIds([mid, 'ace']); const [m, a] = g.soldiers; a.pos = { ...m.pos, x: m.pos.x + 30 }; a.hp = 30; m.hp = 40; g.useAbility(m); return [a.hp, m.hp]; };
    const fP = ftBy('patch'), fD = ftBy('doc');
    deployIds(['patch', 'ace']); { const [m, a] = g.soldiers; a.hp = 30; m.hp = 40; a.pos = { x: 1300, y: 1060 }; m.pos = { x: 1310, y: 1000 }; g.anchor = { x: 1300, y: 1060 }; }
    step(0.1); const mk = g.soldiers.map(s => r1(s.hp));
    check('Healer in combat: Patch Field Treatment 27.5% (Doc 25%), medkit stays 20%', fP[0] === 57.5 && fP[1] === 62 && fD[0] === 55 && fD[1] === 60 && mk.join() === '56,50',
      `Patch: Ace 30 -> ${fP[0]}, self 40 -> ${fP[1]}; Doc: Ace 30 -> ${fD[0]}, self 40 -> ${fD[1]}; medkit (Patch 40/80, Ace 30/100) -> ${mk}`);

    // mission stats attribution
    deployIds(['ace', 'tank', 'patch']); g.invuln = true;
    let [ace, tank, patch] = g.soldiers;
    const statOf = (id) => g.stats.bySoldier.get(id);
    // overkill excluded: a 10-damage bullet on a 4 HP enemy counts 4
    const e1 = g.spawnEnemy({ x: ace.pos.x + 200, y: ace.pos.y }); e1.hp = 4; e1.guard = true; e1.reactionTime = 1e9;
    g.projectiles.push({ pos: { x: e1.pos.x - 30, y: e1.pos.y }, vel: { x: 700, y: 0 }, team: 'squad', damage: 10, life: 1, trail: { ...e1.pos }, owner: ace });
    g.soldiers.forEach(s => s.fireCooldown = 99); step(0.1);
    check('stats: bullet damage = HP removed (overkill excluded) + kill', e1.state === 'dead' && statOf('ace').damage === 4 && statOf('ace').kills === 1, `ace dmg ${statOf('ace').damage}, kills ${statOf('ace').kills}`);
    // grenade kills go to the thrower, even if he goes down before it explodes
    const gx = { x: ace.pos.x + 120, y: ace.pos.y };
    const ga = g.spawnEnemy({ ...gx }), gb = g.spawnEnemy({ x: gx.x + 10, y: gx.y + 10 });
    [ga, gb].forEach(e => { e.guard = true; e.reactionTime = 1e9; });
    g.soldiers.forEach(s => s.fireCooldown = 1e9);
    g.useAbility(ace); g.onTargetConfirm(g.worldToScreen(gx));
    g.invuln = false; g.downSoldier(ace); g.invuln = true;
    for (let i = 0; i < 90; i++) { g.soldiers.forEach(s => s.fireCooldown = 1e9); g.update(1 / 60); }
    check('stats: grenade kills + damage credited to the thrower (even when downed)', ga.state === 'dead' && gb.state === 'dead' && statOf('ace').kills === 3 && statOf('ace').damage === 84 && statOf('tank').kills === 0,
      `ace kills ${statOf('ace').kills}, dmg ${statOf('ace').damage} (4 + 40 + 40), tank kills ${statOf('tank').kills}`);
    // no double counting: two hits on the same frame, second target already dead
    const e2 = g.spawnEnemy({ x: 100, y: 100 }); e2.hp = 5;
    g.damage(e2, 10, tank); g.damage(e2, 50, patch);
    check('stats: one kill per enemy, no damage on a dead target', statOf('tank').kills === 1 && statOf('tank').damage === 5 && statOf('patch').kills === 0 && statOf('patch').damage === 0, `tank ${statOf('tank').kills}k/${statOf('tank').damage}dmg, patch ${statOf('patch').kills}k/${statOf('patch').damage}dmg`);
    // revive credited to the reviver; revive HP is not healing
    const h0 = statOf('patch').healing;
    patch.pos = { x: ace.pos.x + 15, y: ace.pos.y }; tank.pos = { x: ace.pos.x + 400, y: ace.pos.y }; g.anchor = { ...patch.pos };
    let tr = 0; while (ace.state === 'downed' && tr < 10) { g.update(1 / 60); tr += 1 / 60; patch.pos = { x: ace.pos.x + 15, y: ace.pos.y }; tank.pos = { x: ace.pos.x + 400, y: ace.pos.y }; }
    check('stats: revive credited to the reviver; revive HP is not healing', ace.state === 'active' && statOf('patch').revives === 1 && statOf('tank').revives === 0 && statOf('patch').healing === h0, `patch revives ${statOf('patch').revives}, healing ${h0} -> ${statOf('patch').healing}`);
    // overheal excluded: Field Treatment (Patch) and medkit (collector)
    ace.hp = 95; tank.hp = 160; patch.hp = 80;
    ace.pos = { ...patch.pos, x: patch.pos.x + 20 }; tank.pos = { ...patch.pos, y: patch.pos.y + 20 };
    patch.ability.cooldownLeft = 0; g.useAbility(patch);
    check('stats: Field Treatment healing = HP actually restored (overheal excluded)', statOf('patch').healing === 10 && ace.hp === 100 && tank.hp === 165, `ace 95 -> 100, tank 160 -> 165, patch full: credited ${statOf('patch').healing}`);
    ace.hp = 90; tank.hp = 165; patch.hp = 80;
    // medkit collected by Tank: Ace +10 (to 100), Tank/Patch full -> credit 10 to Tank
    deployIds(['ace', 'tank', 'patch']); [ace, tank, patch] = g.soldiers;
    ace.hp = 90; ace.pos = { x: 1000, y: 700 }; patch.pos = { x: 1000, y: 760 };
    tank.pos = { x: 1300, y: 1060 }; g.anchor = { x: 1300, y: 1060 };
    step(0.1);
    check('stats: medkit healing credited to the collector, overheal excluded', Math.round(ace.hp) === 100 && statOf('tank').healing === 10 && statOf('ace').healing === 0 && g.pickups.filter(p => p.type.kind === 'medkit').length === 2,
      `ace 90 -> ${Math.round(ace.hp)}, tank credited ${statOf('tank').healing}, ace ${statOf('ace').healing}`);

    // results flow, retry, KIA reset
    deployIds(['ace', 'havoc']);
    [ace] = g.soldiers; g.damage(g.spawnEnemy({ x: 100, y: 100 }), 5, ace);
    ace.state = 'kia';
    g.win();
    const res1 = { menu: document.getElementById('menu').className, rows: [...document.querySelectorAll('.r-table tbody tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim()) };
    check('results: shown on victory with per-soldier rows + KIA status', res1.menu === 'results' && res1.rows.length === 2 && /^Ace.*KIA.*no XP$/i.test(res1.rows[0]) && /^Havoc.*Standing.*\+\d+ XP$/i.test(res1.rows[1]) && /MISSION COMPLETE/.test(document.querySelector('.r-title').textContent),
      `${res1.menu}: ${res1.rows.join(' | ')}`);
    // v0.6: Ace's KIA is permanent -> Results offer only RESOLVE CASUALTIES; Retry is blocked until decided
    const resBtns = [...document.querySelectorAll('.r-btns button')].map((b) => b.dataset.a).join();
    check('v0.6 results with a KIA: only "Resolve casualties" (no Retry / Campaign / Barracks)', resBtns === 'resolve' && window.__account().pendingDecision?.queue[0]?.id === 'ace', resBtns);
    window.__account().credits += 1000;
    document.querySelector('[data-a="resolve"]').click();
    const decScreen = document.getElementById('menu').className;
    document.querySelector('[data-a="resurrect"]').click();
    check('v0.6: casualty screen -> Resurrect (1000 CR) -> Ace active again, nothing pending', decScreen === 'decisions' && byId('ace').status === 'active' && byId('ace').resurrections === 1 && !window.__account().pendingDecision, `${decScreen} ace ${byId('ace').status}`);
    g.reset();
    check('retry: same squad, fresh HP/state/stats/cooldowns', g.phase === 'playing' && g.time === 0 && g.soldiers.map(s => s.identity.id).join() === 'ace,havoc' && g.soldiers.every(s => s.state === 'active' && s.hp === s.maxHp && s.ability.cooldownLeft === 0) && statOf('ace').damage === 0 && document.getElementById('menu').className === 'hidden',
      `${g.phase} ${g.soldiers.map(s => `${s.name}:${s.state}:${s.hp}`).join(' ')} stats ace dmg ${statOf('ace').damage}`);
    g.soldiers.forEach(s => g.downSoldier(s)); step(0.05);
    const failed = g.phase === 'failed' && /MISSION FAILED/.test(document.querySelector('.r-title')?.textContent || '') && [...document.querySelectorAll('.r-status')].every(x => x.textContent === 'Downed');
    await new Promise((r) => setTimeout(r, 700)); // v0.6: menu taps are ignored for 600 ms after a resurrection (double-tap guard)
    document.querySelector('[data-a="barracks"]').click();
    const cards = [...document.querySelectorAll('.s-card')];
    check('defeat -> results (Downed) -> Return to Barracks', failed && g.phase === 'start' && document.getElementById('menu').className === 'barracks' && cards.length === 6, `failed ok ${failed}, phase ${g.phase}, cards ${cards.length}`);
    check('v0.6: soldiers downed when a mission fails are recovered (no KIA, no decision)', !window.__account().pendingDecision && cards.every(c => /AVAILABLE|IN SQUAD|TRAINED/.test(c.textContent)) && R.soldiers.every(s => s.status === 'active'), cards.map(c => c.querySelector('.s-status').textContent).join(','));
    const dep = g.deploy([byId('ace')]);
    check('resurrected soldier redeploys at full health', dep.ok && g.soldiers[0]?.state === 'active' && g.soldiers[0]?.hp === 100, `${JSON.stringify(dep)} ${g.soldiers[0]?.state} ${g.soldiers[0]?.hp}`);

    check('CFG still equals the defaults after all trait checks', JSON.stringify(CFG) === cfgSnapshot, '');
    R.slots = savedSlots;
    return out;
  });
  let fails = 0;
  for (const r of res) { if (!r.ok) fails++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(70)} ${r.detail}`); }
  console.log(`\n${res.length - fails}/${res.length} passed`);
  console.log('ERRORS', errors);
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
