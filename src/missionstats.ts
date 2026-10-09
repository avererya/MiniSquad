// Per-mission, per-soldier statistics for the Results screen. Keyed by the stable soldier id.
// Attribution rules (all fed from real gameplay events in game.ts / abilities.ts / pickups.ts):
//  - damage:  HP actually removed from enemies (overkill excluded). Bullets -> the shooter,
//             grenade blasts -> the thrower (even if he is down by the time it explodes).
//  - kills:   the soldier whose hit took the enemy from >0 to <=0 HP. Each enemy dies once.
//  - healing: HP actually restored (overheal excluded). Field Treatment -> the Medic who used it,
//             medkit -> the soldier who walked over it (it heals the whole squad).
//             HP given back by a revive is NOT healing; it counts as a revive.
//  - revives: the reviver whose revive tick completed the revive.
//  - status:  final state when the mission ends (Standing / Downed / KIA). Not permanent.
import type { SoldierClassId } from './classes';
import type { TraitId } from './traits';
import type { Unit } from './unit';

export type FinalStatus = 'Standing' | 'Downed' | 'KIA';

export interface SoldierMissionStats {
  id: string;
  name: string;
  classId: SoldierClassId;
  traitId: TraitId | null;
  kills: number;
  damage: number;
  healing: number;
  revives: number;
  /** Times this soldier went down (any revive afterwards included). Drives the "nobody downed" bonus. */
  downs: number;
}

export class MissionStats {
  readonly bySoldier = new Map<string, SoldierMissionStats>();

  register(u: Unit) {
    const id = u.identity;
    if (!id || this.bySoldier.has(id.id)) return;
    this.bySoldier.set(id.id, { id: id.id, name: id.name, classId: id.classId, traitId: id.traitId, kills: 0, damage: 0, healing: 0, revives: 0, downs: 0 });
  }

  private of(u: Unit | null | undefined) {
    return u && u.team === 'squad' && u.identity ? this.bySoldier.get(u.identity.id) ?? null : null;
  }

  damage(src: Unit | null | undefined, amount: number) { const r = this.of(src); if (r && amount > 0) r.damage += amount; }
  kill(src: Unit | null | undefined) { const r = this.of(src); if (r) r.kills++; }
  heal(src: Unit | null | undefined, amount: number) { const r = this.of(src); if (r && amount > 0) r.healing += amount; }
  revive(src: Unit | null | undefined) { const r = this.of(src); if (r) r.revives++; }
  down(u: Unit) { const r = this.of(u); if (r) r.downs++; }

  static status(u: Unit): FinalStatus { return u.state === 'active' ? 'Standing' : u.state === 'downed' ? 'Downed' : 'KIA'; }

  /** Rows in deployment order with final status. */
  rows(soldiers: Unit[]) {
    return soldiers.filter((s) => s.identity).map((s) => ({ ...this.bySoldier.get(s.identity!.id)!, status: MissionStats.status(s) }));
  }
}
