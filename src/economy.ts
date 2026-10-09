// Stateful progression rules: settling a mission (XP + Credits, exactly once per run) and
// buying training (atomic: check -> deduct -> grant -> persist, rolled back if the save fails).
//
// ANTI-DUPLICATION
//  - Every mission start gets a fresh run id (Game.startMission). settleMission() records the id
//    in account.settledRuns and refuses an id it has seen, so re-rendering Results, pressing
//    keys twice, or calling win() again can never pay twice. Retry starts a NEW run (new id).
//  - Rewards are applied and saved the moment the mission ends (before Results is drawn), so a
//    reload on the Results screen neither loses nor repeats them (the mission itself is gone).
//  - Purchases carry the rank the button was drawn for (expectedRank): a stale or repeated event
//    for an already-bought rank is refused. The UI also ignores taps within purchaseLockMs.
import type { Roster } from './roster';
import {
  PROGRESSION, SQUAD_TRAINING, TRAINING, addXp, computeMissionRewards, nextCost,
  type AccountData, type MissionOutcome, type MissionReward, type SoldierReward, type SquadTrainingStat, type TrainingStat,
} from './progression';

export type PersistFn = () => 'ok' | 'nostorage' | 'error';

export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Apply a finished mission's rewards to the roster + account. Returns the reward record for the
 * Results screen, or null if this run was already settled (no change at all in that case).
 * Defeat: no XP and no Credits (the service record still counts the mission).
 */
export function settleMission(roster: Roster, account: AccountData, o: MissionOutcome, kills: Record<string, number> = {}): MissionReward | null {
  if (account.settledRuns.includes(o.runId)) return null;
  const rec = account.missions[o.missionId] ?? { completions: 0, firstClearRun: null };
  const firstClear = o.won && rec.completions === 0;
  const calc = computeMissionRewards(o, firstClear);
  const soldiers: SoldierReward[] = [];
  for (const d of o.deployed) {
    const s = roster.get(d.id);
    if (!s || !s.progression) continue;
    const p = s.progression;
    const before = { level: p.level, xp: p.xp };
    const eligible = o.won && d.status === 'Standing';
    const xp = eligible ? calc.xpEach : 0;
    const res = addXp(p.xp, xp);
    p.xp = res.xp; p.level = res.level;
    s.service.missions++;
    if (o.won) s.service.victories++;
    s.service.kills += kills[d.id] ?? 0;
    soldiers.push({ id: s.id, name: s.name, status: d.status, eligible, xp, gained: res.gained, before, after: { level: p.level, xp: p.xp }, levelsGained: p.level - before.level, capped: res.gained < xp });
  }
  account.credits += calc.credits;
  if (o.won) {
    rec.completions++;
    if (firstClear) rec.firstClearRun = o.runId;
    account.missions[o.missionId] = rec;
  }
  account.settledRuns.push(o.runId);
  if (account.settledRuns.length > PROGRESSION.rememberRuns) account.settledRuns.splice(0, account.settledRuns.length - PROGRESSION.rememberRuns);
  return {
    runId: o.runId, missionId: o.missionId, won: o.won, firstClear,
    xpLines: calc.xpLines, xpMul: calc.xpMul, xpEach: calc.xpEach,
    creditLines: calc.creditLines, credits: calc.credits, creditsAfter: account.credits, soldiers,
  };
}

export type BuyResult = { ok: true; cost: number; rank: number; saved: boolean } | { ok: false; reason: string };

function transact(account: AccountData, cost: number, grant: () => void, undo: () => void, persist: PersistFn | null): { ok: true; saved: boolean } | { ok: false; reason: string } {
  account.credits -= cost;
  grant();
  const w = persist ? persist() : 'ok';
  if (w === 'error') { undo(); account.credits += cost; return { ok: false, reason: 'Could not save: purchase cancelled' }; }
  return { ok: true, saved: w === 'ok' };
}

/** Buy the next individual training rank for one soldier. */
export function buyTraining(roster: Roster, account: AccountData, soldierId: string, stat: TrainingStat, expectedRank: number | null, persist: PersistFn | null): BuyResult {
  const s = roster.get(soldierId);
  const def = TRAINING[stat];
  if (!s || !s.progression || !def) return { ok: false, reason: 'Unknown soldier or training' };
  const rank = s.training[stat];
  if (expectedRank !== null && rank !== expectedRank) return { ok: false, reason: 'Already bought' };
  const cost = nextCost(def, rank);
  if (cost === null) return { ok: false, reason: `${def.label} is maxed` };
  if (account.credits < cost) return { ok: false, reason: `Not enough Credits (${cost} needed)` };
  const r = transact(account, cost, () => { s.training[stat] = rank + 1; }, () => { s.training[stat] = rank; }, persist);
  return r.ok ? { ok: true, cost, rank: rank + 1, saved: r.saved } : r;
}

/** Buy the next squad-wide training rank (applies to every roster soldier). */
export function buySquadTraining(account: AccountData, stat: SquadTrainingStat, expectedRank: number | null, persist: PersistFn | null): BuyResult {
  const def = SQUAD_TRAINING[stat];
  if (!def) return { ok: false, reason: 'Unknown training' };
  const rank = account.squadTraining[stat];
  if (expectedRank !== null && rank !== expectedRank) return { ok: false, reason: 'Already bought' };
  const cost = nextCost(def, rank);
  if (cost === null) return { ok: false, reason: `${def.label} is maxed` };
  if (account.credits < cost) return { ok: false, reason: `Not enough Credits (${cost} needed)` };
  const r = transact(account, cost, () => { account.squadTraining[stat] = rank + 1; }, () => { account.squadTraining[stat] = rank; }, persist);
  return r.ok ? { ok: true, cost, rank: rank + 1, saved: r.saved } : r;
}
