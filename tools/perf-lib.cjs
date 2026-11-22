// Shared helpers for the v0.6.3 performance tools (tools/perf.cjs, tools/fps-parity.cjs).
// Automated HEADLESS-BROWSER profiling only: no real phone, battery or temperature data.

/** Page-side: fresh save, everything unlocked, named soldiers at `level`, then deploy `missionId`. */
function setupMission({ missionId, level }) {
  const g = window.game, a = window.__account(), P = window.__progression;
  // v0.8C 'last-stand@voss': Mission 15 straight to General Voss (both gates open, objectives 1-4 done, only the
  // arena's guard left standing), so a short run covers the boss fight, Rally, the radioed calls and the allies
  // v0.8C.1 'last-stand@story': the same, but the pre-boss cinematic plays out on its own (auto-advance) first;
  // '@voss' skips it, so its run still covers the fight as in v0.8C.
  // v0.9A 'jungle-sweep@field': Mission 16 from the ravine (the trail reached, the first three patrols gone), so a short
  // run walks the squad through the minefield middle: reveals, the pilot's mine orders, blasts, chains
  const field = missionId === 'jungle-sweep@field';
  if (field) missionId = 'jungle-sweep';
  // v0.9B 'fuel-for-the-fire@reserve': Mission 17 at the central reserve (A and B already burnt, their guards and the
  // patrols gone), so a short run covers the five-tank chain, the guards inside the ring and the enemy response
  const reserve = missionId === 'fuel-for-the-fire@reserve';
  if (reserve) missionId = 'fuel-for-the-fire';
  // v0.9B 'ambush-alley@rooftops': Mission 18 past the crossfire (the first ambush, the Main Street post and the
  // crossfire already beaten), so a short run covers the rooftop snipers, the rear ambush and the courtyard streets
  const rooftops = missionId === 'ambush-alley@rooftops';
  if (rooftops) missionId = 'ambush-alley';
  // v0.9B.1 '<mission>@extract': every primary done, the field cleared and the squad in the extraction zone, so a short
  // run covers the countdown, the staggered extraction pressure and the helicopter (no captive missions)
  const extract = /@extract$/.test(missionId);
  if (extract) missionId = missionId.replace(/@extract$/, '');
  const story = missionId === 'last-stand@story';
  const voss = missionId === 'last-stand@voss' || story;
  if (voss) { missionId = 'last-stand'; level = Math.max(level, 20); }
  window.__debugUnlockAll();
  const PREF = ['doc', 'tank', 'ace', 'ranger', 'havoc', 'patch'];
  for (const id of PREF) { const s = g.roster.get(id); if (s) { s.progression.xp = P.xpForLevel(level); s.progression.level = level; } }
  g.selectMission(missionId, true);
  const pick = PREF.filter((id) => g.roster.isUnlocked(id) && g.roster.get(id)?.status !== 'kia').slice(0, g.capacity);
  const r = g.deploy(pick.map((id) => g.roster.get(id)), 'roster');
  if (voss && r.ok) {
    const m = g.mission;
    m.openGate(g, ''); m.openGate(g, '');
    for (const e of g.enemies) if (e.tag !== 'arena-guard' && !e.structure) e.state = 'dead';
    g.enemies = g.enemies.filter((e) => e.active);
    for (let i = 0; i < 4; i++) m.primaries[i].state = 'complete';
    m.current = 4;
    g.soldiers.forEach((s, i) => { s.pos = { x: 3400 + (i % 3) * 30, y: 1170 + Math.floor(i / 3) * 30 }; s.vel = { x: 0, y: 0 }; });
    g.anchor = { x: 3430, y: 1200 }; g.cam = { x: 3430, y: 1200 };
    m.primaries[4].activate(m, g); m.phase = m.primaries[4].phase;
    if (!story && g.story) g.story.skip(g);
    g.invuln = true; // the squad stands for the whole run, so it reaches phases 2 / 3, the calls and the allies
  }
  if (field && r.ok) {
    const m = g.mission;
    for (const e of g.enemies) if (/^patrol-(a|b|n)$/.test(e.tag)) e.state = 'dead';
    g.enemies = g.enemies.filter((e) => e.active);
    g.soldiers.forEach((s, i) => { s.pos = { x: 1540 + (i % 3) * 30, y: 1110 + Math.floor(i / 3) * 30 }; s.vel = { x: 0, y: 0 }; });
    g.anchor = { x: 1570, y: 1125 }; g.cam = { x: 1570, y: 1125 };
    if (g.story) g.story.skip(g);
    void m;
  }
  if (reserve && r.ok) {
    const m = g.mission, d = m.mechanic('fuel');
    for (const t of d.tanks) if (t.group !== 'C') { t.state = 'exploded'; t.unit.state = 'dead'; }
    for (const e of g.enemies) if (e.tag && !/^site-c/.test(e.tag)) e.state = 'dead';
    g.enemies = g.enemies.filter((e) => e.state !== 'dead');
    g.soldiers.forEach((s, i) => { s.pos = { x: 3000 + (i % 3) * 30, y: 1480 + Math.floor(i / 3) * 30 }; s.vel = { x: 0, y: 0 }; });
    g.anchor = { x: 3030, y: 1495 }; g.cam = { x: 3030, y: 1495 };
    if (g.story) g.story.skip(g);
  }
  if (rooftops && r.ok) {
    const m = g.mission, A = m.mechanic('ambush');
    // v0.9B.1: the first ambush's flankers and the crossfire's late group count as beaten too
    for (const id of ['first', 'first-flank', 'crossfire', 'crossfire-late']) { const st = A.state(id); if (st) { st.armedAt = 0; st.sprungAt = 0; } }
    for (const e of g.enemies) if (e.tag === 'street-post') e.state = 'dead';
    g.enemies = g.enemies.filter((e) => e.state !== 'dead');
    for (let i = 0; i < 2; i++) m.primaries[i].state = 'complete';
    m.current = 2; m.primaries[2].activate(m, g); m.phase = m.primaries[2].phase;
    g.soldiers.forEach((s, i) => { s.pos = { x: 2130 + (i % 3) * 30, y: 1380 + Math.floor(i / 3) * 30 }; s.vel = { x: 0, y: 0 }; });
    g.anchor = { x: 2160, y: 1395 }; g.cam = { x: 2160, y: 1395 };
    if (g.story) g.story.skip(g);
  }
  if (extract && r.ok) {
    const m = g.mission;
    if (g.story) g.story.skip(g);
    for (const o of m.primaries) o.state = 'complete';
    m.current = m.primaries.length; m.phase = 'toExtraction';
    for (const e of g.enemies) if (!e.structure) e.state = 'dead';
    g.enemies = g.enemies.filter((e) => e.state !== 'dead');
    const z = m.extraction.zone, c = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    g.soldiers.forEach((s, i) => { s.pos = { x: c.x - 45 + (i % 3) * 45, y: c.y - 25 + Math.floor(i / 3) * 50 }; s.vel = { x: 0, y: 0 }; });
    g.anchor = { ...c }; g.cam = { ...c };
  }
  void a;
  return r.ok ? { ok: true, squad: g.soldiers.map((s) => s.name) } : { ok: false, reason: r.reason };
}

/**
 * Page-side: installs window.__pilot, a scripted "attentive player" (same shape as
 * tools/chapter2-sim.cjs): walks to the objective / optional / downed soldier, holds while
 * fighting, dodges boss telegraphs, uses abilities every 1.5 s. It reads only game state, so it
 * gives the same input for the same state whatever the frame rate. pilot.step() runs it once
 * (call it once per simulation step).
 */
function installPilot() {
  const g = window.game;
  const P = { mv: { x: 0, y: 0 }, path: null, pathT: 0, pathGoal: null, n: 0 };
  g.input.move = () => P.mv;
  P.step = () => {
    const m = g.mission, b = m.boss, n = P.n++;
    // v0.8B Mission 14: the gunner prompt (first candidate: deterministic)
    if (g.modal === 'gunner') { const c = g.gunnerCandidates(); g.chooseGunner(c.length ? c[0].id : null); }
    const downed = g.soldiers.find((s) => s.state === 'downed');
    const npc = g.npcs?.[0];
    let goal = null;
    if (downed) goal = downed.pos;
    else if (npc && npc.state === 'downed') goal = npc.pos;
    else {
      const opt = m.optionals.find((o) => o.state === 'active' && o.point(m, g));
      const p = opt ? opt.point(m, g) : m.objectivePoint(g);
      goal = p ? p.pos : null;
      if (b && b.unit.active && goal && Math.hypot(b.unit.pos.x - g.anchor.x, b.unit.pos.y - g.anchor.y) < 360) goal = null;
    }
    if (npc && npc.escorting && npc.active && Math.hypot(npc.pos.x - g.anchor.x, npc.pos.y - g.anchor.y) > 200) goal = npc.pos;
    // v0.9A mines (Mission 16): every 2 s, order the nearest revealed mine within 320 px shot (a tap, like a player)
    const mf = m.mechanic ? m.mechanic('mines') : null;
    if (mf && n % 120 === 0) {
      let best = null, bd = 320 * 320;
      for (const x of mf.mines) { if (x.state !== 'revealed') continue; const d = (x.pos.x - g.anchor.x) ** 2 + (x.pos.y - g.anchor.y) ** 2; if (d < bd) { bd = d; best = x; } }
      if (best && !(mf.order && mf.order.mine === best)) g.onTap({ x: best.pos.x - g.cam.x + 640, y: best.pos.y - g.cam.y + 360 });
    }
    // v0.9B fuel tanks (Mission 17): every second, tap an intact tank within 450 px whose blast ring holds no soldier
    // (one with an enemy beside it first); stop short of the tank the objective points at once a soldier sees it
    const fd = m.mechanic ? m.mechanic('fuel') : null;
    if (fd) {
      const F = window.__CFG.fuel, R2 = (F.blastRadius + 25) ** 2, d2 = (p) => (p.x - g.anchor.x) ** 2 + (p.y - g.anchor.y) ** 2;
      if (n % 60 === 30) {
        const ok = fd.tanks.filter((t) => t.state === 'intact' && d2(t.pos) < 450 * 450 && !g.soldiers.some((s) => (s.active || s.state === 'downed') && (s.pos.x - t.pos.x) ** 2 + (s.pos.y - t.pos.y) ** 2 < R2));
        const bait = (t) => g.enemies.some((e) => e.active && !e.structure && (e.pos.x - t.pos.x) ** 2 + (e.pos.y - t.pos.y) ** 2 < 90 * 90);
        ok.sort((a, b) => (bait(b) ? 1 : 0) - (bait(a) ? 1 : 0) || d2(a.pos) - d2(b.pos));
        const best = ok[0];
        if (best && !(fd.order && fd.order.tank === best)) g.onTap({ x: best.pos.x - g.cam.x + 640, y: best.pos.y - g.cam.y + 360 });
      }
      const tk = goal && fd.tanks.find((t) => t.state === 'intact' && t.pos.x === goal.x && t.pos.y === goal.y);
      if (tk && d2(tk.pos) < 240 * 240 && g.soldiers.some((s) => s.active && g.world.clear(s.pos, tk.pos))) goal = null;
    }
    const fighting = g.soldiers.some((s) => s.active && s.target && !s.target.structure && !s.target.vehicle);
    P.pathT -= 1 / 60;
    if (goal && (P.pathT <= 0 || !P.pathGoal || Math.hypot(goal.x - P.pathGoal.x, goal.y - P.pathGoal.y) > 80)) { P.path = g.world.findPath(g.anchor, goal, 12); P.pathT = 0.5; P.pathGoal = { ...goal }; }
    let mv = { x: 0, y: 0 };
    if (goal && P.path && P.path.length) {
      while (P.path.length > 1 && Math.hypot(P.path[0].x - g.anchor.x, P.path[0].y - g.anchor.y) < 20) P.path.shift();
      const dx = P.path[0].x - g.anchor.x, dy = P.path[0].y - g.anchor.y, d = Math.hypot(dx, dy);
      const hold = fighting && !downed && !m.convoy && n % 240 < 150;
      if (d > 8 && !hold) mv = { x: dx / d, y: dy / d };
    }
    if (b && b.rocket) {
      const r = b.rocket, R = window.__CFG.boss.rocketRadius + 45;
      const dx = g.anchor.x - r.pos.x, dy = g.anchor.y - r.pos.y, d = Math.hypot(dx, dy) || 1;
      if (g.soldiers.some((s) => s.active && Math.hypot(s.pos.x - r.pos.x, s.pos.y - r.pos.y) < R) && d < R + 60) mv = { x: dx / d, y: dy / d };
    } else if (b && b.phase === 'windup' && b.unit.active) {
      const a = b.fireAim, side = Math.floor(g.time / 6) % 2 ? 1 : -1;
      mv = { x: -Math.sin(a) * side, y: Math.cos(a) * side };
    }
    if (n % 90 === 0) {
      for (const s of g.soldiers) {
        if (!s.ability.ready(s)) continue;
        if (s.ability.targetingMode === 'instant') {
          const hurt = g.soldiers.some((o) => (o.active && o.hp < o.maxHp * 0.7) || o.state === 'downed');
          if ((s.ability.id === 'suppressive' && s.target && !s.target.structure) || (s.ability.id === 'fieldTreatment' && hurt) || (s.ability.id === 'focus' && s.target)) g.useAbility(s);
        } else if (s.target) {
          const t = s.target;
          if (npc && npc.escorting && Math.hypot(t.pos.x - npc.pos.x, t.pos.y - npc.pos.y) < 120) continue;
          if (Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y) > s.ability.range()) continue;
          g.targeting = s; g.onTargetConfirm(g.worldToScreen(t.pos)); break;
        }
      }
    }
    P.mv = mv;
  };
  window.__pilot = P;
  return true;
}

/** Page-side live counts (works on any build). */
function counts() {
  const g = window.game, fx = g.fx;
  return {
    enemies: g.enemies.filter((e) => e.active).length, projectiles: g.projectiles.length,
    effects: fx.particles.length + fx.rings.length + fx.texts.length + fx.pulses.length + g.grenades.length,
  };
}

const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (x) => +x.toFixed(3);
  return { n: xs.length, mean: r(xs.reduce((a, b) => a + b, 0) / xs.length), p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]) };
};

module.exports = { setupMission, installPilot, counts, stats };
