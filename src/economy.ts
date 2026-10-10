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
import { CLASS_UNLOCK_TEXT, NAMED_RECRUITS, campaignMission, namedRecruit, type NamedRecruitDef } from './campaign';
import {
  PROGRESSION, SQUAD_TRAINING, TRAINING, addXp, computeMissionRewards, levelForXp, newTraining, nextCost, xpForLevel,
  type AccountData, type CandidateRecord, type CasualtyDecision, type DismissalRecord, type FallenEntry, type KiaCause, type MemorialRecord, type MissionOutcome, type MissionReward,
  type SoldierReward, type SquadTrainingStat, type TrainingStat,
} from './progression';
import { newProgression, newService, type SoldierIdentity } from './classes';
import {
  REFRESH_COST, campaignFlags, campaignProgress, ensureOffers, generateCandidate, nameKey, newLineup, pendingIntroductions, priceOf, refundOf, startingLevelFor, takenNames, validateName,
  type GenContext,
} from './recruitment';
import { PHOENIX_CANDIDATES, PHOENIX_LEVEL, PHOENIX_RECRUITS, costFor, decisionBlock, pendingCasualties, phoenixEligible } from './casualties';
import { SQUAD_SLOTS } from './roster';

export type PersistFn = () => 'ok' | 'nostorage' | 'error';

export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * THE MISSION-END TRANSACTION (runs before the Results screen is drawn, saved by the caller right
 * after): XP + Credits (v0.5 rules: victory, optionals, whole squad, nobody downed, first clear,
 * replay; nothing on defeat), the career record of every deployed soldier (missions, victories,
 * kills, downs, revives, deaths), permanent KIA (status 'kia') and the pending casualty decision
 * for every fallen soldier. Credits are applied BEFORE any decision exists. Exactly once per run
 * id: returns null (and changes nothing) for a run that was already settled.
 * `rewards: false` (a mission force-started while locked, dev tools): no XP / Credits / stars /
 * unlocks, but deaths and the career record still count (a roster soldier really fought).
 *
 * v0.6.1 MISSION FAILURE: when the mission is lost (`won: false`: total squad defeat, a failed
 * objective such as a lost captive, a timer failure), every soldier still DOWNED becomes KIA
 * (cause 'failed'); standing soldiers (revived ones included) come home; soldiers already KIA stay
 * KIA (one death, one casualty entry). This transaction only runs for a mission that really ended
 * in play: closing / reloading the app mid-mission goes through recoverInterruptedRun instead,
 * which keeps the v0.6 behaviour (only soldiers who had already fallen are lost).
 * v0.6.1 first clears unlock named recruit OFFERS (account.named), never a free soldier.
 */
export function settleMission(roster: Roster, account: AccountData, o: MissionOutcome, kills: Record<string, number> = {}, opts: { rewards?: boolean; now?: number } = {}): MissionReward | null {
  if (account.settledRuns.includes(o.runId)) return null;
  const pay = opts.rewards !== false;
  const rec = account.missions[o.missionId] ?? { completions: 0, firstClearRun: null, bestStars: 0 };
  const prevBest = rec.bestStars;
  const firstClear = pay && o.won && rec.completions === 0;
  // no double grant: a v0.3 first clear of the same map (legacy 'comms-outpost' record) already
  // paid the first-clear Credit bonus, so Mission 3's first clear skips that one line
  const def = campaignMission(o.missionId);
  const legacyPaid = !!def?.legacyId && (account.missions[def.legacyId]?.firstClearRun ?? null) !== null;
  const calc = pay ? computeMissionRewards(o, firstClear, legacyPaid) : computeMissionRewards({ ...o, won: false }, false);
  const soldiers: SoldierReward[] = [];
  const fallen: FallenEntry[] = [];
  let survivors = 0;
  for (const d0 of o.deployed) {
    // a legitimate failure never rescues a downed soldier
    const d = !o.won && d0.status === 'Downed' ? { ...d0, status: 'KIA' as const, cause: 'failed' as const } : d0;
    const s = roster.get(d.id);
    if (!s || !s.progression) continue;
    if (d.status === 'Standing') survivors++;
    const p = s.progression;
    const before = { level: p.level, xp: p.xp };
    const eligible = pay && o.won && d.status === 'Standing';
    const xp = eligible ? calc.xpEach : 0;
    const res = addXp(p.xp, xp);
    p.xp = res.xp; p.level = res.level;
    s.service.missions++;
    if (o.won) s.service.victories++;
    s.service.kills += kills[d.id] ?? 0;
    s.service.downs += Math.max(0, d.downs | 0);
    s.service.revives += Math.max(0, (d.revives ?? 0) | 0);
    if (d.status === 'KIA' && s.status !== 'kia') {
      s.status = 'kia';
      s.service.deaths++;
      fallen.push({ id: s.id, cause: d.cause ?? 'bleedout' });
    }
    soldiers.push({ id: s.id, name: s.name, status: d.status, eligible, xp, gained: res.gained, before, after: { level: p.level, xp: p.xp }, levelsGained: p.level - before.level, capped: res.gained < xp });
  }
  account.credits += calc.credits;
  const unlockedSoldiers: string[] = [], unlockedMissions: string[] = [], unlockedRecruits: string[] = [], unlockedClasses: string[] = [];
  if (pay && o.won) {
    rec.completions++;
    if (firstClear) rec.firstClearRun = o.runId;
    rec.bestStars = Math.max(rec.bestStars, Math.max(0, Math.min(3, Math.floor(o.stars ?? 1)))); // never lowered
    account.missions[o.missionId] = rec;
    // campaign unlocks (idempotent: only what is new is reported)
    if (def) {
      for (const m of def.unlocks.missions) if (!account.campaign.unlockedMissions.includes(m)) { account.campaign.unlockedMissions.push(m); unlockedMissions.push(m); }
      for (const key of def.unlocks.recruits) if (unlockRecruitOffer(account, key)) unlockedRecruits.push(key);
      for (const c of def.unlocks.classes ?? []) if (unlockClass(account, c)) unlockedClasses.push(c);
    }
  }
  addCasualties(account, o.runId, o.missionId, fallen, opts.now);
  if (account.activeRun?.runId === o.runId) account.activeRun = null; // the journal is now part of the settled outcome
  markSettled(account, o.runId);
  return {
    runId: o.runId, missionId: o.missionId, won: o.won, firstClear, legacyFirstClearPaid: firstClear && legacyPaid,
    stars: pay && o.won ? Math.max(0, Math.min(3, o.stars ?? 1)) : 0, prevBest, bestStars: rec.bestStars, unlockedSoldiers, unlockedRecruits, unlockedClasses, unlockedMissions,
    xpLines: calc.xpLines, xpMul: calc.xpMul, xpEach: calc.xpEach,
    creditLines: calc.creditLines, credits: calc.credits, creditsAfter: account.credits, soldiers, fallen, survivors, rewarded: pay,
  };
}

/** Milestone reached: open the named recruit offer (true only the first time; never adds a soldier). */
export function unlockRecruitOffer(account: AccountData, key: string): boolean {
  if (!namedRecruit(key) || account.named.unlocked.includes(key)) return false;
  account.named.unlocked.push(key);
  return true;
}

/** v0.6.2 class milestone reached (Sniper): recruitable from now on (true only the first time; never adds a soldier). */
export function unlockClass(account: AccountData, classId: string): boolean {
  if (!CLASS_UNLOCK_TEXT[classId] || account.classUnlocks.unlocked.includes(classId)) return false;
  account.classUnlocks.unlocked.push(classId);
  return true;
}
/** The next class unlock whose one-time notice has not been shown (null = none). */
export function pendingClassNotice(account: AccountData): string | null {
  return account.classUnlocks.unlocked.find((c) => !account.classUnlocks.notified.includes(c)) ?? null;
}
export function markClassNotified(account: AccountData, classId: string, persist: PersistFn | null = null) {
  if (account.classUnlocks.notified.includes(classId)) return;
  account.classUnlocks.notified.push(classId);
  persist?.();
}

function markSettled(account: AccountData, runId: string) {
  account.settledRuns.push(runId);
  if (account.settledRuns.length > PROGRESSION.rememberRuns) account.settledRuns.splice(0, account.settledRuns.length - PROGRESSION.rememberRuns);
}

/** Queue fallen soldiers for the post-mission decision (one batch per run; merged if one is somehow still open). */
function addCasualties(account: AccountData, runId: string, missionId: string, fallen: FallenEntry[], now = Date.now()) {
  if (!fallen.length) return;
  const d = account.pendingDecision;
  if (d && d.queue.length) {
    for (const f of fallen) if (!d.queue.some((x) => x.id === f.id)) { d.queue.push(f); d.total++; }
    return;
  }
  account.pendingDecision = { kind: 'casualties', runId, missionId, at: now, queue: [...fallen], total: fallen.length, resolved: [] };
}

/**
 * Mission journal (v0.6): a soldier fell in the running mission. Saved at once (the caller
 * persists), so closing / reloading the app mid-mission can never undo a death. The roster is
 * NOT touched here; the mission-end transaction (or recoverInterruptedRun on the next launch)
 * applies it exactly once.
 */
export function journalKia(account: AccountData, runId: string, missionId: string, id: string, cause: KiaCause) {
  if (account.settledRuns.includes(runId)) return;
  if (!account.activeRun || account.activeRun.runId !== runId) account.activeRun = { runId, missionId, kia: [] };
  if (!account.activeRun.kia.some((k) => k.id === id)) account.activeRun.kia.push({ id, cause });
}

/**
 * A roster mission ended without its mission-end transaction (app closed / reloaded / restarted
 * mid-mission): it counts as a failed mission. Soldiers who had already fallen in it (journal)
 * are KIA and need a decision; everyone else simply comes home. No XP, no Credits. Exactly once
 * per run id. Returns the fallen entries applied (empty when there was nothing to do).
 */
export function recoverInterruptedRun(roster: Roster, account: AccountData, now = Date.now()): FallenEntry[] {
  const j = account.activeRun;
  if (!j) return [];
  account.activeRun = null;
  if (account.settledRuns.includes(j.runId)) return [];
  const fallen: FallenEntry[] = [];
  for (const k of j.kia) {
    const s = roster.get(k.id);
    if (!s || !roster.isUnlocked(k.id) || s.status === 'kia') continue;
    s.status = 'kia';
    s.service.deaths++;
    s.service.missions++;
    fallen.push({ ...k });
  }
  addCasualties(account, j.runId, j.missionId, fallen, now);
  markSettled(account, j.runId);
  return fallen;
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
  const blocked = decisionBlock(account);
  if (blocked) return { ok: false, reason: blocked };
  if (s.status === 'kia') return { ok: false, reason: `${s.name} has fallen` };
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
  const blocked = decisionBlock(account);
  if (blocked) return { ok: false, reason: blocked };
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

/**
 * Everything a roster / recruitment / casualty transaction may touch, for rollback (v0.6: the
 * soldiers are deep-copied, so status, resurrection count and service record roll back too).
 */
function snapshot(roster: Roster, account: AccountData) {
  return {
    credits: account.credits, soldiers: structuredClone(roster.soldiers), slots: [...roster.slots], rec: structuredClone(account.recruitment),
    pending: structuredClone(account.pendingDecision), memorial: [...account.memorial], phoenix: structuredClone(account.phoenix),
    named: structuredClone(account.named), unlocked: new Set(roster.unlocked),
  };
}
function restore(roster: Roster, account: AccountData, s: ReturnType<typeof snapshot>) {
  account.credits = s.credits; roster.soldiers = s.soldiers; roster.slots = s.slots; account.recruitment = s.rec;
  account.pendingDecision = s.pending; account.memorial = s.memorial; account.phoenix = s.phoenix;
  account.named = s.named; roster.unlocked = s.unlocked;
}
function commit(roster: Roster, account: AccountData, snap: ReturnType<typeof snapshot>, persist: PersistFn | null, what: string): { ok: true; saved: boolean } | { ok: false; reason: string } {
  const w = persist ? persist() : 'ok';
  if (w === 'error') { restore(roster, account, snap); return { ok: false, reason: `Could not save: ${what} cancelled` }; }
  return { ok: true, saved: w === 'ok' };
}

/** Generation context for the current roster/account (rng injectable for tests). */
export function genContext(roster: Roster, account: AccountData, rng: () => number = Math.random, extraTaken: string[] = []): GenContext {
  return { flags: campaignFlags(account), progress: campaignProgress(account), taken: takenNames(roster.soldiers.map((s) => s.name), account.recruitment, extraTaken), rng };
}

/** Office shown: make sure three offers exist and pending class introductions happened (free). Saves if anything changed. */
export function openOffice(roster: Roster, account: AccountData, persist: PersistFn | null, rng: () => number = Math.random): boolean {
  const changed = ensureOffers(account.recruitment, genContext(roster, account, rng));
  if (changed) persist?.();
  return changed;
}

/** Why recruiting is blocked right now (null = allowed), independent of the offer. */
export function recruitBlock(roster: Roster, account: AccountData): string | null {
  const blocked = decisionBlock(account);
  if (blocked) return blocked;
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
  const next = generateCandidate(rec, genContext(roster, account, opts.rng, [c.name]), pendingIntroductions(rec, campaignFlags(account))[0]);
  rec.offers.splice(slot, 0, next);
  const r = commit(roster, account, snap, persist, 'recruitment');
  return r.ok ? { ...r, soldier, cost } : r;
}

// ---------------- v0.6.1: named campaign recruits ----------------
// One permanent offer per named soldier (Tank, Doc, Havoc, Patch), opened by its milestone,
// separate from the three random offers (a Refresh never touches it and it never counts as a
// class introduction). Bought at most once, enforced by the offer key (the soldier's stable id),
// never by a display name: a rename, dismissal or Memorial can't reopen it.

export interface NamedOffer { def: NamedRecruitDef; soldier: SoldierIdentity; level: number }

/** Offers on the table right now: milestone reached, not claimed, the (locked) named soldier still exists. */
export function namedOffers(roster: Roster, account: AccountData): NamedOffer[] {
  const level = startingLevelFor(campaignProgress(account));
  return NAMED_RECRUITS.filter((n) => account.named.unlocked.includes(n.key) && !account.named.claimed.includes(n.key))
    .map((n) => ({ def: n, soldier: roster.get(n.key)!, level }))
    .filter((o) => !!o.soldier && !roster.isUnlocked(o.def.key));
}
/** Named recruits whose milestone has not been reached yet (and that were never claimed). */
export const lockedNamedRecruits = (account: AccountData): NamedRecruitDef[] =>
  NAMED_RECRUITS.filter((n) => !account.named.unlocked.includes(n.key) && !account.named.claimed.includes(n.key));

/**
 * Buy a named campaign recruit: offer open -> no pending decision -> roster not full -> Credits ->
 * deduct -> the soldier joins (owned) at the current recruit starting level (recruitment.ts
 * level scaling), keeping their name, class and natural trait -> offer claimed for good -> save.
 * Refused without any change (no charge) when blocked.
 */
export function recruitNamed(roster: Roster, account: AccountData, key: string, persist: PersistFn | null, opts: { inMission?: boolean; now?: number } = {}): TxResult<{ soldier: SoldierIdentity; cost: number }> {
  if (opts.inMission) return { ok: false, reason: 'Not during a mission' };
  const def = namedRecruit(key);
  if (!def) return { ok: false, reason: 'Unknown recruit' };
  if (account.named.claimed.includes(key) || roster.isUnlocked(key)) return { ok: false, reason: 'Already recruited' };
  if (!account.named.unlocked.includes(key)) return { ok: false, reason: `Not available yet: clear Mission ${def.missionNumber}` };
  const s = roster.get(key);
  if (!s) return { ok: false, reason: 'Already recruited' };
  const block = recruitBlock(roster, account);
  if (block) return { ok: false, reason: block };
  const cost = def.price;
  if (account.credits < cost) return { ok: false, reason: `Not enough Credits (${cost} needed)` };
  const snap = snapshot(roster, account);
  const level = startingLevelFor(campaignProgress(account));
  account.credits -= cost;
  const p = s.progression ?? newProgression();
  if (p.xp < xpForLevel(level)) { p.xp = xpForLevel(level); p.level = levelForXp(p.xp); }
  s.progression = p;
  s.status = 'active';
  roster.unlock(key);
  account.named.claimed.push(key);
  if (!account.named.notified.includes(key)) account.named.notified.push(key);
  account.named.history.push({ key, soldierId: s.id, at: opts.now ?? Date.now(), cost, level: p.level });
  account.recruitment.recruited++;
  const r = commit(roster, account, snap, persist, 'recruitment');
  return r.ok ? { ...r, soldier: s, cost } : r;
}

/** The one-time unlock notice was shown (dismissed or followed): never shown again. */
export function markRecruitNotified(account: AccountData, key: string, persist: PersistFn | null) {
  if (account.named.notified.includes(key)) return;
  account.named.notified.push(key);
  persist?.();
}
/** The first named recruit whose unlock notice is still owed (null = none). */
export const pendingRecruitNotice = (account: AccountData): NamedRecruitDef | null =>
  NAMED_RECRUITS.find((n) => account.named.unlocked.includes(n.key) && !account.named.notified.includes(n.key) && !account.named.claimed.includes(n.key)) ?? null;

/** Key of the lineup a Refresh button was drawn for (stale / repeated taps are refused). */
export const lineupKey = (rec: AccountData['recruitment']) => rec.offers.map((o) => o.id).join(',');

/** Replace all three offers for REFRESH_COST. Never touches the roster. */
export function refreshOffers(roster: Roster, account: AccountData, expectedKey: string | null, persist: PersistFn | null, opts: { inMission?: boolean; rng?: () => number } = {}): TxResult<{ cost: number }> {
  if (opts.inMission) return { ok: false, reason: 'Not during a mission' };
  const rec = account.recruitment;
  if (expectedKey !== null && expectedKey !== lineupKey(rec)) return { ok: false, reason: 'Already refreshed' };
  const blocked = decisionBlock(account);
  if (blocked) return { ok: false, reason: blocked };
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

/**
 * Why this soldier can't be dismissed (null = allowed). v0.6: a fallen soldier (KIA awaiting a
 * decision) can't be dismissed, and the last LIVING soldier can't be dismissed either, also during
 * casualty resolution (so a total collapse can only come from combat losses, never dismissals).
 */
export function dismissBlock(roster: Roster, id: string, inMission = false): string | null {
  const s = roster.get(id);
  if (!s || !roster.isUnlocked(id)) return 'Unknown or already dismissed soldier';
  if (inMission) return 'Not during a mission';
  if (s.status === 'kia') return `${s.name} has fallen: resurrect them or honor them in the Memorial.`;
  if (roster.living().length <= 1) return 'You must keep at least one soldier.';
  return null;
}
/** Refund for dismissing this soldier: class refund (v0.5), 0 for an Operation Phoenix recruit. */
export const dismissRefund = (s: Pick<SoldierIdentity, 'classId' | 'origin'>) => (s.origin === 'phoenix' ? 0 : refundOf(s.classId));

/** Dismiss a soldier for good: fixed class refund, removed from roster + squad, recorded, saved. */
export function dismiss(roster: Roster, account: AccountData, id: string, persist: PersistFn | null, opts: { inMission?: boolean; now?: number } = {}): TxResult<{ refund: number; record: DismissalRecord }> {
  const block = dismissBlock(roster, id, opts.inMission);
  if (block) return { ok: false, reason: block };
  const s = roster.get(id)!;
  const rec = account.recruitment;
  const snap = snapshot(roster, account);
  const refund = dismissRefund(s);
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
  const blocked = decisionBlock(account);
  if (blocked) return { ok: false, reason: blocked };
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

// ---------------- v0.6: casualty decisions, Memorial, Operation Phoenix ----------------
// Same transaction pattern: validate -> apply -> persist -> roll EVERYTHING back if the write
// throws. Repeats are refused by state: only the casualty at the head of the queue can be
// decided, and once decided it is no longer there (a double tap can't pay twice or decide the
// next soldier). The UI adds the usual tap lock on top.

/** The casualty at the head of the queue, or why there is none. */
function headCasualty(roster: Roster, account: AccountData, id: string): { d: CasualtyDecision; s: SoldierIdentity; cause: KiaCause } | { reason: string } {
  const d = pendingCasualties(account);
  if (!d) return { reason: 'No fallen soldier awaits a decision' };
  if (d.queue[0].id !== id) return { reason: 'Already decided' };
  const s = roster.get(id);
  if (!s || s.status !== 'kia') return { reason: 'Unknown fallen soldier' };
  return { d, s, cause: d.queue[0].cause };
}

/** Batch done: close it, and open an Operation Phoenix grant when the collapse qualifies. */
function finishBatch(roster: Roster, account: AccountData, d: CasualtyDecision, rng: () => number, now: number): boolean {
  if (d.queue.length) return false;
  account.pendingDecision = null;
  const el = phoenixEligible(roster, account, d);
  if (!el.ok) return false;
  const ctx = genContext(roster, account, rng);
  const candidates: CandidateRecord[] = [];
  for (let i = 0; i < PHOENIX_CANDIDATES; i++) {
    const c = generateCandidate(account.recruitment, ctx, 'infantry');
    candidates.push({ ...c, classId: 'infantry', level: PHOENIX_LEVEL });
  }
  account.phoenix.pending = { id: el.grantId, at: now, candidates };
  return true;
}

export type DecisionResult = TxResult<{ cost: number; phoenix: boolean; next: string | null }>;

/**
 * Resurrect the fallen soldier at the head of the queue: price from THEIR previous resurrection
 * count (casualties.ts) -> deduct -> back to 'active' with everything they had (id, name, class,
 * trait, level, XP, training, career record; squad training applies as to everyone) -> +1
 * resurrection (deaths are kept) -> next casualty -> save. Refused (nothing changes) if Credits
 * are short.
 */
export function resurrect(roster: Roster, account: AccountData, id: string, persist: PersistFn | null, opts: { rng?: () => number; now?: number } = {}): DecisionResult {
  const h = headCasualty(roster, account, id);
  if ('reason' in h) return { ok: false, reason: h.reason };
  const { d, s } = h;
  const cost = costFor(s);
  if (account.credits < cost) return { ok: false, reason: `Not enough Credits (${cost} needed, ${cost - account.credits} short)` };
  const snap = snapshot(roster, account);
  account.credits -= cost;
  s.status = 'active';
  s.resurrections++;
  d.queue.shift();
  d.resolved.push({ id: s.id, name: s.name, outcome: 'resurrected', cost, affordable: true });
  const phoenix = finishBatch(roster, account, d, opts.rng ?? Math.random, opts.now ?? Date.now());
  const r = commit(roster, account, snap, persist, 'resurrection');
  return r.ok ? { ...r, cost, phoenix, next: pendingCasualties(account)?.queue[0]?.id ?? null } : r;
}

/**
 * Honor the fallen soldier at the head of the queue in the Memorial (permanent): the full final
 * record is kept, the soldier leaves the roster (and the saved squad) and frees their roster
 * slot; their name stays reserved. Records whether the resurrection was affordable right now
 * (Operation Phoenix rule). Never pays anything.
 */
export function memorialize(roster: Roster, account: AccountData, id: string, persist: PersistFn | null, opts: { rng?: () => number; now?: number } = {}): DecisionResult {
  const h = headCasualty(roster, account, id);
  if ('reason' in h) return { ok: false, reason: h.reason };
  const { d, s, cause } = h;
  const cost = costFor(s);
  const at = opts.now ?? Date.now();
  const affordable = account.credits >= cost;
  const snap = snapshot(roster, account);
  const record: MemorialRecord = { eventId: `mm-${at.toString(36)}-${s.id}`, soldier: structuredClone(s), missionId: d.missionId, runId: d.runId, cause, at, cost, affordable };
  roster.remove(s.id);
  account.memorial.push(record);
  if (!account.recruitment.usedNames.some((n) => nameKey(n) === nameKey(s.name))) account.recruitment.usedNames.push(s.name);
  d.queue.shift();
  d.resolved.push({ id: s.id, name: s.name, outcome: 'memorial', cost, affordable });
  const phoenix = finishBatch(roster, account, d, opts.rng ?? Math.random, at);
  const r = commit(roster, account, snap, persist, 'Memorial');
  return r.ok ? { ...r, cost: 0, phoenix, next: pendingCasualties(account)?.queue[0]?.id ?? null } : r;
}

/**
 * Operation Phoenix: enlist exactly three of the offered candidates, free: level 1 Infantry,
 * training 0, marked origin 'phoenix' (dismissal refunds 0). They join the saved squad (up to
 * `cap`). The grant id is recorded, so the same collapse can never pay twice (reload, double tap).
 */
export function enlistPhoenix(roster: Roster, account: AccountData, picks: string[], persist: PersistFn | null, opts: { cap?: number; now?: number } = {}): TxResult<{ soldiers: SoldierIdentity[] }> {
  const g = account.phoenix.pending;
  if (!g) return { ok: false, reason: 'No Operation Phoenix grant is open' };
  if (pendingCasualties(account)) return { ok: false, reason: 'Resolve your fallen soldiers first' };
  const ids = [...new Set(picks)];
  if (ids.length !== PHOENIX_RECRUITS || ids.length !== picks.length) return { ok: false, reason: `Choose exactly ${PHOENIX_RECRUITS} recruits` };
  const chosen = ids.map((id) => g.candidates.find((c) => c.id === id));
  if (chosen.some((c) => !c)) return { ok: false, reason: 'Unknown candidate' };
  if (account.phoenix.grants.some((x) => x.id === g.id)) return { ok: false, reason: 'Already granted' };
  if (roster.activeCount() + PHOENIX_RECRUITS > account.recruitment.rosterCap) return { ok: false, reason: 'Roster full' };
  const snap = snapshot(roster, account);
  const soldiers: SoldierIdentity[] = [];
  for (const c of chosen as CandidateRecord[]) {
    if (roster.get(c.id)) continue;
    const p = newProgression();
    p.xp = xpForLevel(PHOENIX_LEVEL); p.level = levelForXp(p.xp);
    const soldier: SoldierIdentity = { id: c.id, name: c.name, classId: 'infantry', traitId: c.traitId, mods: {}, progression: p, training: newTraining(), status: 'active', resurrections: 0, service: newService(), origin: 'phoenix' };
    roster.add(soldier);
    soldiers.push(soldier);
    if (!account.recruitment.usedNames.some((n) => nameKey(n) === nameKey(c.name))) account.recruitment.usedNames.push(c.name);
  }
  const cap = Math.max(1, Math.min(SQUAD_SLOTS, opts.cap ?? SQUAD_SLOTS));
  const keep = roster.slots.filter((x): x is string => !!x && roster.isUnlocked(x) && !roster.isFallen(x));
  const squad = [...keep, ...soldiers.map((x) => x.id)].slice(0, cap);
  roster.slots = [...squad, ...Array(SQUAD_SLOTS - squad.length).fill(null)];
  account.phoenix.grants.push({ id: g.id, at: opts.now ?? Date.now(), recruits: soldiers.map((x) => x.id) });
  account.phoenix.pending = null;
  const r = commit(roster, account, snap, persist, 'Operation Phoenix');
  return r.ok ? { ...r, soldiers } : r;
}
