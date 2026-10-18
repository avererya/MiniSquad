// v0.8C Mission 15 "General's Last Stand" objectives (the fight itself is general.ts; the gates are Mission.lockdown).
//  1. Break through the outer defenses (ClearGroupsObjective: the field and wall groups).
//  2. GeneratorObjective: the gate generator in the side annex; destroying it opens the MAIN GATE (once).
//  3. FortressRelaysObjective: two communications relays in the courtyard, any order; both down opens the INNER GATE.
//  4. Storm the command area (ClearGroupsObjective: the arena's front guard past the inner gate).
//  5. GeneralObjective: General Voss enters; completes when he falls (bossDefeated).
//  6. ClearRemainingObjective: every enemy still standing (none of them respawn), and any reinforcements Voss already
//     radioed for; then the normal helicopter extraction.
// Optional: ResistanceSurvivesOptional (Mara, Elias and Tessa arrive in Voss's phase 3; all three standing at the end).
import type { Game } from './game';
import type { Mission } from './mission';
import type { Unit } from './unit';
import { clamp, dist, type Vec } from './util';
import { squadCentre } from './squad';
import { DestroyObjective, MultiDestroyObjective, Objective, type HudLine, type MissionEvent, type ObjPoint } from './objectives';
import { ALLY_NAMES } from './chapter3';

/**
 * Clear the named groups: completes once none of their units is standing (counted live, so kills made before it
 * starts, e.g. through an open gate, still count; nothing in these groups respawns).
 */
export class ClearGroupsObjective extends Objective {
  constructor(id: string, label: string, readonly tags: string[], readonly pointLabel = 'ENEMY') { super(id, label); this.phase = 'eliminate'; }
  alive(g: Game): Unit[] { return g.enemies.filter((e) => e.active && !!e.tag && this.tags.includes(e.tag)); }
  total(m: Mission) { return this.tags.reduce((a, t) => a + (m.spawned.get(t) ?? 0), 0); }
  update(m: Mission, g: Game) { if (this.state === 'active' && this.total(m) > 0 && this.alive(g).length === 0) this.complete(m, g); }
  hud(m: Mission, g: Game): HudLine { const n = this.alive(g).length, t = this.total(m); return { text: this.label, sub: n ? `Enemies left: ${n}` : undefined, progress: t ? 1 - n / t : 0 }; }
  point(_m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const e = this.alive(g).sort((a, b) => dist(a.pos, c) - dist(b.pos, c))[0];
    return e ? { pos: e.pos, label: this.pointLabel, color: '#ff7a5a' } : null;
  }
}

/** The gate generator: shoot it or blow it up; the main gate opens the moment it falls. */
export class GeneratorObjective extends DestroyObjective {
  constructor(id: string, label: string, pos: Vec, hp: number) { super(id, label, pos, 'generator', hp, 'GENERATOR'); }
  onEvent(m: Mission, g: Game, ev: MissionEvent) {
    const was = this.state;
    super.onEvent(m, g, ev);
    if (was === 'active' && this.state === 'complete') m.openGate(g, 'GENERATOR DESTROYED: THE MAIN GATE IS OPEN');
  }
  hud() {
    const t = this.target, f = t ? clamp(t.hp / t.maxHp, 0, 1) : 1;
    return { text: this.label, sub: `Main gate: LOCKED · ${t && t.hp < t.maxHp ? `generator ${Math.round(f * 100)}%` : 'the generator is in the north-west annex'}`, progress: 1 - f };
  }
}

/** Two courtyard relays, any order; both down opens the inner gate (once). */
export class FortressRelaysObjective extends MultiDestroyObjective {
  constructor(id: string, label: string, points: Vec[], hp: number) { super(id, label, points, 'relay', hp, 'RELAY'); }
  onEvent(m: Mission, g: Game, ev: MissionEvent) {
    const was = this.state;
    super.onEvent(m, g, ev);
    if (was === 'active' && this.state === 'complete') m.openGate(g, 'RELAYS DOWN: THE INNER GATE IS OPEN');
  }
  protected onTargetDown(_m: Mission, g: Game) {
    if (this.left > 0) g.banner(`RELAY DESTROYED: ${this.left} LEFT`, '#7dff8a', 2.5);
  }
  hud(): HudLine { return { text: this.label, sub: `Relays destroyed: ${this.destroyed}/${this.targets.length} · inner gate LOCKED`, chips: this.chips() }; }
}

/** General Voss enters when this starts; completes when he falls. */
export class GeneralObjective extends Objective {
  constructor(id: string, label: string) { super(id, label); this.phase = 'boss'; }
  protected onStart(m: Mission, g: Game) { m.startGeneral(g); }
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'bossDefeated' && ev.unit === m.general?.unit) this.complete(m, g); }
  hud(m: Mission, g: Game): HudLine {
    const f = m.general;
    if (!f) return { text: this.label };
    const sub = f.rallyActive(g) ? 'RALLY: his troops hit harder for a few seconds. Fall back to cover or pull them away from him'
      : f.pendingCount > 0 ? 'Reinforcements are coming through the barracks doors'
      : f.phase >= 3 ? 'Phase 3: he fires faster. The resistance is here'
      : `Phase ${f.phase} · ${Math.ceil(clamp(f.hpFrac, 0, 1) * 100)}% HP`;
    return { text: this.label, sub };
  }
  point(m: Mission): ObjPoint | null { const u = m.general?.unit; return u && u.active ? { pos: u.pos, label: 'VOSS', color: '#ff7a5a' } : null; }
}

/** Clear every enemy still standing (finite: nobody respawns) once Voss's radioed reinforcements have all arrived. */
export class ClearRemainingObjective extends Objective {
  constructor(id: string, label: string) { super(id, label); this.phase = 'clear'; }
  alive(g: Game): Unit[] { return g.enemies.filter((e) => e.active && !e.structure && !e.vehicle && e.team === 'enemy'); }
  left(m: Mission, g: Game) { return this.alive(g).length + (m.general?.pendingCount ?? 0); }
  update(m: Mission, g: Game) { if (this.state === 'active' && this.left(m, g) === 0) this.complete(m, g); }
  hud(m: Mission, g: Game): HudLine { const n = this.left(m, g); return { text: this.label, sub: n ? `Enemies left: ${n}` : undefined }; }
  point(_m: Mission, g: Game): ObjPoint | null {
    const c = squadCentre(g.soldiers) ?? g.cam;
    const e = this.alive(g).sort((a, b) => dist(a.pos, c) - dist(b.pos, c))[0];
    return e ? { pos: e.pos, label: 'ENEMY', color: '#ff7a5a' } : null;
  }
}

/** Optional: Mara, Elias and Tessa (they arrive in Voss's phase 3) are all standing at the end; fails on an ally's death or if they never came. */
export class ResistanceSurvivesOptional extends Objective {
  onEvent(m: Mission, g: Game, ev: MissionEvent) { if (ev.type === 'allyKia') this.fail(m, g); }
  finalize(m: Mission, g: Game, won: boolean) {
    if (this.state !== 'active') return;
    if (won && m.general?.alliesArrived && g.allies.length === ALLY_NAMES.length && g.allies.every((a) => a.state === 'active')) this.complete(m, g);
    else this.fail(m, g);
  }
  status(m: Mission): string {
    if (this.state !== 'active') return super.status(m);
    return m.general?.alliesArrived ? 'Keep them standing' : 'Not arrived yet';
  }
}

/** Enemy budget of Mission 15 (tests / docs): placed groups + Voss's two calls. */
export const LAST_STAND_BUDGET = { outer: 12, inner: 16, arena: 8, phase2: 5, phase3: 7, total: 48 } as const;
