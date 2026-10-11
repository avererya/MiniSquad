// Shared helpers for the v0.6.3 performance tools (tools/perf.cjs, tools/fps-parity.cjs).
// Automated HEADLESS-BROWSER profiling only: no real phone, battery or temperature data.

/** Page-side: fresh save, everything unlocked, named soldiers at `level`, then deploy `missionId`. */
function setupMission({ missionId, level }) {
  const g = window.game, a = window.__account(), P = window.__progression;
  window.__debugUnlockAll();
  const PREF = ['doc', 'tank', 'ace', 'ranger', 'havoc', 'patch'];
  for (const id of PREF) { const s = g.roster.get(id); if (s) { s.progression.xp = P.xpForLevel(level); s.progression.level = level; } }
  g.selectMission(missionId, true);
  const pick = PREF.filter((id) => g.roster.isUnlocked(id) && g.roster.get(id)?.status !== 'kia').slice(0, g.capacity);
  const r = g.deploy(pick.map((id) => g.roster.get(id)), 'roster');
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
