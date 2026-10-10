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
import { campaignMission } from './campaign';
import {
  PROGRESSION, SQUAD_TRAINING, TRAINING, addXp, computeMissionRewards, levelForXp, newTraining, nextCost, xpForLevel,
  type AccountData, type DismissalRecord, type MissionOutcome, type MissionReward, type SoldierReward, type SquadTrainingStat, type TrainingStat,
} from './progression';
import { newProgression, newService, type SoldierIdentity } from './classes';
import {
  REFRESH_COST, campaignProgress, ensureOffers, generateCandidate, nameKey, newLineup, pendingIntroductions, priceOf, refundOf, takenNames, validateName,
  type GenContext,
} from './recruitment';

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
  const rec = account.missions[o.missionId] ?? { completions: 0, firstClearRun: null, bestStars: 0 };
  const prevBest = rec.bestStars;
  const firstClear = o.won && rec.completions === 0;
  // no double grant: a v0.3 first clear of the same map (legacy 'comms-outpost' record) already
  // paid the first-clear Credit bonus, so Mission 3's first clear skips that one line
  const def = campaignMission(o.missionId);
  const legacyPaid = !!def?.legacyId && (account.missions[def.legacyId]?.firstClearRun ?? null) !== null;
  const calc = computeMissionRewards(o, firstClear, legacyPaid);
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
  const unlockedSoldiers: string[] = [], unlockedMissions: string[] = [];
  if (o.won) {
    rec.completions++;
    if (firstClear) rec.firstClearRun = o.runId;
    rec.bestStars = Math.max(rec.bestStars, Math.max(0, Math.min(3, Math.floor(o.stars ?? 1)))); // never lowered
    account.missions[o.missionId] = rec;
    // campaign unlocks (idempotent: only what is new is reported)
    if (def) {
      for (const m of def.unlocks.missions) if (!account.campaign.unlockedMissions.includes(m)) { account.campaign.unlockedMissions.push(m); unlockedMissions.push(m); }
      for (const id of def.unlocks.soldiers) if (roster.unlock(id)) unlockedSoldiers.push(id);
    }
  }
  account.settledRuns.push(o.runId);
  if (account.settledRuns.length > PROGRESSION.rememberRuns) account.settledRuns.splice(0, account.settledRuns.length - PROGRESSION.rememberRuns);
  return {
    runId: o.runId, missionId: o.missionId, won: o.won, firstClear, legacyFirstClearPaid: firstClear && legacyPaid,
    stars: o.won ? Math.max(0, Math.min(3, o.stars ?? 1)) : 0, prevBest, bestStars: rec.bestStars, unlockedSoldiers, unlockedMissions,
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

// ---------------- v0.5: Recruitment Office ----------------
// Same pattern as training: validate -> apply -> persist -> roll EVERYTHING back if the save
// write throws. Repeats are refused by state, not timing: a recruited offer id no longer exists,
// a refresh carries the lineup it was drawn for, a dismissed soldier is gone. The UI also drops
// repeat taps within purchaseLockMs. None of these run while a mission is in progress.
export type TxResult<T = object> = ({ ok: true; saved: boolean } & T) | { ok: false; reason: string };

/** Everything a recruitment transaction may touch, for rollback. */
function snapshot(roster: Roster, account: AccountData) {
  return {
    credits: account.credits, soldiers: [...roster.soldiers], slots: [...roster.slots],
    names: new Map(roster.soldiers.map((s) => [s.id, s.name])), rec: structuredClone(account.recruitment),
  };
}
function restore(roster: Roster, account: AccountData, s: ReturnType<typeof snapshot>) {
  account.credits = s.credits; roster.soldiers = s.soldiers; roster.slots = s.slots; account.recruitment = s.rec;
  for (const x of roster.soldiers) { const n = s.names.get(x.id); if (n !== undefined) x.name = n; }
}
function commit(roster: Roster, account: AccountData, snap: ReturnType<typeof snapshot>, persist: PersistFn | null, what: string): { ok: true; saved: boolean } | { ok: false; reason: string } {
  const w = persist ? persist() : 'ok';
  if (w === 'error') { restore(roster, account, snap); return { ok: false, reason: `Could not save: ${what} cancelled` }; }
  return { ok: true, saved: w === 'ok' };
}

/** Generation context for the current roster/account (rng injectable for tests). */
export function genContext(roster: Roster, account: AccountData, rng: () => number = Math.random, extraTaken: string[] = []): GenContext {
  return { flags: roster.unlocked, progress: campaignProgress(account), taken: takenNames(roster.soldiers.map((s) => s.name), account.recruitment, extraTaken), rng };
}

/** Office shown: make sure three offers exist and pending class introductions happened (free). Saves if anything changed. */
export function openOffice(roster: Roster, account: AccountData, persist: PersistFn | null, rng: () => number = Math.random): boolean {
  const changed = ensureOffers(account.recruitment, genContext(roster, account, rng));
  if (changed) persist?.();
  return changed;
}

/** Why recruiting is blocked right now (null = allowed), independent of the offer. */
export function recruitBlock(roster: Roster, account: AccountData): string | null {
  const cap = account.recruitment.rosterCap;
  if (roster.activeCount() >= cap) return `Roster full (${roster.activeCount()}/${cap}): dismiss a soldier to free a slot.`;
  return null;
}

/** Recruit one offer: credits + capacity -> deduct -> join the roster -> save -> replace ONLY that offer. */
export function recruit(roster: Roster, account: AccountData, candidateId: string, persist: PersistFn | null, opts: { inMission?: boolean; rng?: () => number } = {}): TxResult<{ soldier: SoldierIdentity; cost: number }> {
  if (opts.inMission) return { ok: false, reason: 'Not during a mission' };
  const rec = account.recruitment;
  const slot = rec.offers.findIndex((o) => o.id === candidateId);
  if (slot < 0) return { ok: false, reason: 'Already recruited' };
  const c = rec.offers[slot];
  const block = recruitBlock(roster, account);
  if (block) return { ok: false, reason: block };
  const cost = priceOf(c.classId);
  if (!Number.isFinite(cost)) return { ok: false, reason: 'This class cannot be recruited' };
  if (account.credits < cost) return { ok: false, reason: `Not enough Credits (${cost} needed)` };
  if (roster.get(c.id)) return { ok: false, reason: 'Already recruited' };
  const snap = snapshot(roster, account);
  account.credits -= cost;
  const p = newProgression();
  p.xp = xpForLevel(c.level); p.level = levelForXp(p.xp);
  const soldier: SoldierIdentity = { id: c.id, name: c.name, classId: c.classId, traitId: c.traitId, mods: {}, progression: p, training: newTraining(), status: 'active', resurrections: 0, service: newService() };
  roster.add(soldier);
  rec.usedNames.push(c.name);
  rec.recruited++;
  // replace only this offer (the other two stay exactly as they are)
  rec.offers.splice(slot, 1);
  const next = generateCandidate(rec, genContext(roster, account, opts.rng, [c.name]), pendingIntroductions(rec, roster.unlocked)[0]);
  rec.offers.splice(slot, 0, next);
  const r = commit(roster, account, snap, persist, 'recruitment');
  return r.ok ? { ...r, soldier, cost } : r;
}

/** Key of the lineup a Refresh button was drawn for (stale / repeated taps are refused). */
export const lineupKey = (rec: AccountData['recruitment']) => rec.offers.map((o) => o.id).join(',');

/** Replace all three offers for REFRESH_COST. Never touches the roster. */
export function refreshOffers(roster: Roster, account: AccountData, expectedKey: string | null, persist: PersistFn | null, opts: { inMission?: boolean; rng?: () => number } = {}): TxResult<{ cost: number }> {
  if (opts.inMission) return { ok: false, reason: 'Not during a mission' };
  const rec = account.recruitment;
  if (expectedKey !== null && expectedKey !== lineupKey(rec)) return { ok: false, reason: 'Already refreshed' };
  if (account.credits < REFRESH_COST) return { ok: false, reason: `Not enough Credits (${REFRESH_COST} needed)` };
  const snap = snapshot(roster, account);
  account.credits -= REFRESH_COST;
  // the outgoing names are excluded too, so a refresh always shows new people
  const ctx = genContext(roster, account, opts.rng);
  rec.offers = [];
  rec.offers = newLineup(rec, ctx);
  rec.refreshes++;
  const r = commit(roster, account, snap, persist, 'refresh');
  return r.ok ? { ...r, cost: REFRESH_COST } : r;
}

/** Why this soldier can't be dismissed (null = allowed). */
export function dismissBlock(roster: Roster, id: string, inMission = false): string | null {
  const s = roster.get(id);
  if (!s || !roster.isUnlocked(id)) return 'Unknown or already dismissed soldier';
  if (inMission) return 'Not during a mission';
  if (roster.activeCount() <= 1) return 'You must keep at least one soldier.';
  return null;
}

/** Dismiss a soldier for good: fixed class refund, removed from roster + squad, recorded, saved. */
export function dismiss(roster: Roster, account: AccountData, id: string, persist: PersistFn | null, opts: { inMission?: boolean; now?: number } = {}): TxResult<{ refund: number; record: DismissalRecord }> {
  const block = dismissBlock(roster, id, opts.inMission);
  if (block) return { ok: false, reason: block };
  const s = roster.get(id)!;
  const rec = account.recruitment;
  const snap = snapshot(roster, account);
  const refund = refundOf(s.classId);
  const at = opts.now ?? Date.now();
  const record: DismissalRecord = { eventId: `dm-${at.toString(36)}-${id}`, id, name: s.name, classId: s.classId, level: s.progression?.level ?? 1, at, refund, restorable: false };
  roster.remove(id);
  rec.dismissed.push(record);
  if (!rec.usedNames.some((n) => nameKey(n) === nameKey(s.name))) rec.usedNames.push(s.name);
  account.credits += refund;
  const r = commit(roster, account, snap, persist, 'dismissal');
  return r.ok ? { ...r, refund, record } : r;
}

/** Rename (recruits and campaign soldiers; everything refers to soldiers by id). Old names stay reserved. */
export function rename(roster: Roster, account: AccountData, id: string, raw: string, persist: PersistFn | null): TxResult<{ name: string; old: string }> {
  const s = roster.get(id);
  if (!s || !roster.isUnlocked(id)) return { ok: false, reason: 'Unknown soldier' };
  const others = roster.soldiers.filter((x) => x.id !== id).map((x) => x.name);
  const taken = takenNames(others, account.recruitment);
  const chk = validateName(raw, s.name, taken);
  if (!chk.ok) return chk;
  const old = s.name;
  if (chk.name === old) return { ok: true, saved: true, name: old, old };
  const snap = snapshot(roster, account);
  s.name = chk.name;
  if (nameKey(old) !== nameKey(chk.name) && !account.recruitment.usedNames.some((n) => nameKey(n) === nameKey(old))) account.recruitment.usedNames.push(old);
  const r = commit(roster, account, snap, persist, 'rename');
  return r.ok ? { ...r, name: chk.name, old } : r;
}
