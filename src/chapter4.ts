// v0.9A Chapter 4 "Behind Enemy Lines" objectives. Mission 16 Jungle Sweep reuses ReachObjective and
// ClearGroupsObjective (fortress.ts) for its primaries; the mines are the MineField mechanic (mines.ts).
import type { Game } from './game';
import type { Mission } from './mission';
import { Objective } from './objectives';
import type { MineField } from './mines';

/** Optional: enemies killed by mine blasts (set off by anyone: a lured patrol, a shot mine, a chain) reach `need`. */
export class MineKillsOptional extends Objective {
  constructor(id: string, label: string, readonly need: number) { super(id, label); }
  kills(m: Mission) { return m.mechanic<MineField>('mines')?.log.enemyKills ?? 0; }
  update(m: Mission, g: Game) { if (this.state === 'active' && this.kills(m) >= this.need) this.complete(m, g); }
  status(m: Mission): string { return this.state === 'complete' ? 'DONE' : `${Math.min(this.need, this.kills(m))}/${this.need}`; }
}
