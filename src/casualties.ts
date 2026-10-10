// v0.6 permanent death: rules, prices and the pure helpers around the post-mission casualty
// decision, the Memorial and Operation Phoenix. The money-moving transactions (resurrect,
// memorialize, enlist Phoenix recruits) live in economy.ts; the persisted state is declared in
// progression.ts; the screens in menus.ts.
//
// LIFECYCLE (by stable soldier id): Active -> Downed -> (Revived -> Active) | KIA.
//  - KIA comes from a bleed-out (20 s, see game.ts), from being left behind at extraction
//    (the player confirmed extraction while they were downed), or from a mission abandoned
//    mid-run (app closed / restarted) for soldiers who had ALREADY fallen in it.
//  - A failed mission kills nobody by itself: soldiers standing or downed when it ends are
//    recovered; only soldiers who had already fallen stay KIA.
//  - Every KIA needs a decision before the next mission: Resurrect (Credits) or Memorial
//    (permanent). Nothing is decided automatically; Credits shortage never auto-memorializes.
//  - Death is not dismissal: KIA pays nothing and may end in the Memorial; dismissal pays the
//    v0.5 refund, is permanent and never creates a Memorial record.
//
// ROSTER SLOTS: a KIA soldier awaiting a decision stays in the roster and occupies a roster slot
// (recruiting is blocked while decisions are pending anyway). Memorial records never count
// toward the 12-soldier cap.
import type { AccountData, CasualtyDecision } from './progression';
import type { Roster } from './roster';
import type { SoldierIdentity } from './classes';

/** Price of the NEXT resurrection by how many times THIS soldier was resurrected before (1st, 2nd, ... 7th+). */
export const RESURRECTION_PRICES = [1000, 2000, 3500, 5000, 7000, 8500, 10000];
export const RESURRECTION_CAP = 10000;
/** Future Elite soldiers pay this multiple of the regular price (still capped). */
export const ELITE_RESURRECTION_MUL = 2;
export type SoldierTier = 'recruit' | 'elite';

/**
 * Resurrection price. Depends ONLY on the soldier's own previous resurrection count (level,
 * class and training never matter). Elite (future): regular x2, capped at 10,000. The count
 * carries through a promotion, so a promoted soldier keeps their history.
 */
export function resurrectionCost(previous: number, tier: SoldierTier = 'recruit'): number {
  const n = Math.max(0, Math.floor(Number.isFinite(previous) ? previous : 0));
  const regular = RESURRECTION_PRICES[Math.min(n, RESURRECTION_PRICES.length - 1)];
  const price = tier === 'elite' ? regular * ELITE_RESURRECTION_MUL : regular;
  return Math.min(RESURRECTION_CAP, price);
}
export const tierOf = (s: Pick<SoldierIdentity, 'progression'>): SoldierTier => (s.progression?.tier === 'elite' ? 'elite' : 'recruit');
export const costFor = (s: Pick<SoldierIdentity, 'progression' | 'resurrections'>) => resurrectionCost(s.resurrections, tierOf(s));

/** Memorial confirmation: the confirm button arms only after this delay (no accidental / rapid-tap confirmation). */
export const MEMORIAL_ARM_MS = 1500;
/** Extraction warning: its buttons ignore taps for this long after it appears (no tap-through). */
export const EXTRACT_WARN_ARM_S = 0.6;
/** Extraction attempt: the squad must be out of the zone this long before a new attempt starts (no flicker at the edge). */
export const EXTRACT_REARM_S = 1.5;

/** Operation Phoenix: how many free soldiers, and from how many generated candidates. */
export const PHOENIX_RECRUITS = 3;
export const PHOENIX_CANDIDATES = 6;
/** Phoenix recruits are always level 1 Infantry (whatever the campaign-scaled recruit level is). */
export const PHOENIX_LEVEL = 1;

/** The current casualty decision batch (null = nothing pending). */
export const pendingCasualties = (a: AccountData): CasualtyDecision | null => (a.pendingDecision && a.pendingDecision.queue.length ? a.pendingDecision : null);

/**
 * Why normal play is blocked right now (null = it isn't). While fallen soldiers await a decision,
 * or an Operation Phoenix grant is waiting for its three picks, the player can't deploy, recruit,
 * refresh offers, buy training or rename; only the casualty flow (review, restricted dismissals,
 * resurrect, Memorial) or the Phoenix pick is available.
 */
export function decisionBlock(a: AccountData): string | null {
  if (pendingCasualties(a)) return 'Resolve your fallen soldiers first (Resurrect or Memorial).';
  if (a.phoenix.pending) return 'Choose your Operation Phoenix recruits first.';
  return null;
}

/** Soldiers who can fight: owned and not KIA. */
export const livingSoldiers = (r: Roster): SoldierIdentity[] => r.owned().filter((s) => s.status !== 'kia');

/** "Fallen Soldier n of N" for the first queued casualty. */
export function casualtyPosition(d: CasualtyDecision): { index: number; total: number } {
  return { index: Math.min(d.total, d.resolved.length + 1), total: Math.max(d.total, d.resolved.length + d.queue.length) };
}

/**
 * OPERATION PHOENIX eligibility, checked when a casualty batch is fully resolved:
 *  - no usable living soldier remains (every owned soldier was lost), AND
 *  - every soldier of this batch was decided (nothing pending), AND
 *  - at least one soldier went to the Memorial in this batch and EVERY Memorial decision of the
 *    batch was made while that resurrection was unaffordable (credits < price at confirmation), AND
 *  - the roster got to zero through KIA -> Memorial (dismissal can never remove the last living
 *    soldier, so a collapse can't be triggered by voluntary dismissals), AND
 *  - this batch has not been granted before (grant id = "px-" + the batch's run id).
 */
export function phoenixEligible(r: Roster, a: AccountData, batch: CasualtyDecision): { ok: boolean; reason: string; grantId: string } {
  const grantId = `px-${batch.runId}`;
  if (batch.queue.length) return { ok: false, reason: 'decisions still pending', grantId };
  if (livingSoldiers(r).length > 0) return { ok: false, reason: 'usable soldiers remain', grantId };
  const mem = batch.resolved.filter((x) => x.outcome === 'memorial');
  if (!mem.length) return { ok: false, reason: 'no soldier was lost', grantId };
  if (mem.some((x) => x.affordable)) return { ok: false, reason: 'a resurrection was affordable', grantId };
  if (a.phoenix.grants.some((g) => g.id === grantId) || a.phoenix.pending?.id === grantId) return { ok: false, reason: 'already granted', grantId };
  return { ok: true, reason: '', grantId };
}
