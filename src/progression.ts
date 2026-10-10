// v0.3 progression: XP + levels (automatic growth), Credits (one account-wide currency),
// individual training (per soldier) and squad training (account-wide).
// Everything tunable lives in PROGRESSION below; the rules are pure functions so tools can
// check them. The Account (credits, squad training, mission records) is a module singleton
// because effective stats are computed on every read (Unit.stats) and squad training applies
// to every roster soldier.
//
// EFFECTIVE STAT PIPELINE (classes.ts effectiveStats, computed fresh on every read, nothing
// is ever written back, so nothing can stack on reload / respawn / retry):
//   1. class base          CFG[class] (live; the tuning panel edits it)
//   2. level growth        +pct of class base per level gained   \
//   3. individual training +pct of class base per rank            } summed ADDITIVELY: base x (1 + sum)
//   4. squad training      +pct of class base per rank            /
//   5. trait (+ legacy per-soldier `mods`)  multiplier on the result
//   6. temporary effects   Suppressive Fire / Rapid Fire on fire rate (Unit.fireRate), at runtime
// Spread (accuracy) uses the same model with negative percentages, then the trait multiplier,
// then the floor (PROGRESSION.spreadFloorDeg) on the standing cone. The moving penalty is
// scaled by the same factor, so the moving cone = standing + penalty is never below the floor.
import type { SoldierStats } from './config';
import type { SoldierClassId, SoldierIdentity } from './classes';
import type { TraitId } from './traits';
import { FIRST_MISSION } from './campaign';

export const PROGRESSION = {
  /** XP is per soldier, equal for every eligible (extracted) soldier. No XP for kills etc. */
  xp: { victory: 100, perOptionalObjective: 25, fullExtraction: 25, flawless: 25, replayMul: 0.75 },
  /** XP to go from level L to L+1 = base + step x (L - 1). Cap: no progress beyond it. */
  levels: { cap: 25, base: 150, step: 25 },
  /** Automatic growth per level GAINED (L1 = +0), as a fraction of the class base stat. */
  growth: { hp: 0.01, damage: 0.0075, fireRate: 0.005 },
  /** Credits: once per mission, account-wide. Replays pay replayVictory instead of victory. */
  credits: { victory: 500, replayVictory: 400, perOptionalObjective: 150, fullExtraction: 150, flawless: 100, firstClear: 250 },
  /** Minimum standing cone (degrees, full cone) that upgrades can reach. */
  spreadFloorDeg: 1,
  /** Repeated purchase taps within this window are ignored (double-tap guard). */
  purchaseLockMs: 350,
  /** How many settled mission-run ids the save remembers (duplicate-reward guard). */
  rememberRuns: 50,
};

// ---------------- levels ----------------
export const LEVEL_CAP = PROGRESSION.levels.cap;
/** XP needed to go from `level` to `level + 1` (0 at the cap). */
export function xpToNext(level: number): number {
  const L = PROGRESSION.levels;
  return level >= L.cap ? 0 : L.base + L.step * (level - 1);
}
/** Total XP needed to REACH `level` from level 1 (level 1 = 0). */
export function xpForLevel(level: number): number {
  let t = 0;
  for (let l = 1; l < Math.min(level, LEVEL_CAP); l++) t += xpToNext(l);
  return t;
}
export const MAX_XP = (): number => xpForLevel(LEVEL_CAP);
/** Level for a total XP amount (clamped to 1..cap). */
export function levelForXp(xp: number): number {
  let l = 1;
  while (l < LEVEL_CAP && xp >= xpForLevel(l + 1)) l++;
  return l;
}
/** Progress inside the current level, for the XP bar. */
export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  if (level >= LEVEL_CAP) return { level, into: 0, need: 0, frac: 1, max: true };
  const into = xp - xpForLevel(level), need = xpToNext(level);
  return { level, into, need, frac: into / need, max: false };
}

// ---------------- training ----------------
export type TrainingStat = 'accuracy' | 'damage' | 'hp' | 'fireRate' | 'moveSpeed';
export type SquadTrainingStat = 'hp' | 'damage' | 'accuracy' | 'fireRate';
export type TrainingRanks = Record<TrainingStat, number>;
export type SquadTrainingRanks = Record<SquadTrainingStat, number>;

export interface TrainingDef<K extends string> {
  id: K;
  label: string;
  /** Fraction of the class base per rank (negative = smaller is better, spread). */
  perRank: number;
  /** Cost of rank i+1 is costs[i]; max rank = costs.length. */
  costs: number[];
  desc: string;
}
const INDIVIDUAL_COSTS = [250, 400, 550, 700, 900, 1150, 1450, 1750, 2100, 2500];
const SQUAD_COSTS = [1000, 1500, 2000, 2750, 3500];

export const TRAINING: Record<TrainingStat, TrainingDef<TrainingStat>> = {
  accuracy: { id: 'accuracy', label: 'Accuracy', perRank: -0.05, costs: INDIVIDUAL_COSTS, desc: '-5% of class spread per rank (standing and moving)' },
  damage: { id: 'damage', label: 'Damage', perRank: 0.03, costs: INDIVIDUAL_COSTS, desc: '+3% of class damage per rank' },
  hp: { id: 'hp', label: 'Max HP', perRank: 0.05, costs: INDIVIDUAL_COSTS, desc: '+5% of class max HP per rank' },
  fireRate: { id: 'fireRate', label: 'Fire Rate', perRank: 0.03, costs: INDIVIDUAL_COSTS, desc: '+3% of class fire rate per rank' },
  moveSpeed: { id: 'moveSpeed', label: 'Move Speed', perRank: 0.02, costs: INDIVIDUAL_COSTS, desc: '+2% of class move speed per rank' },
};
export const TRAINING_IDS = Object.keys(TRAINING) as TrainingStat[];

export const SQUAD_TRAINING: Record<SquadTrainingStat, TrainingDef<SquadTrainingStat>> = {
  hp: { id: 'hp', label: 'Squad HP', perRank: 0.02, costs: SQUAD_COSTS, desc: '+2% of class max HP per rank, every soldier' },
  damage: { id: 'damage', label: 'Squad Damage', perRank: 0.015, costs: SQUAD_COSTS, desc: '+1.5% of class damage per rank, every soldier' },
  accuracy: { id: 'accuracy', label: 'Squad Accuracy', perRank: -0.02, costs: SQUAD_COSTS, desc: '-2% of class spread per rank, every soldier' },
  fireRate: { id: 'fireRate', label: 'Squad Fire Rate', perRank: 0.01, costs: SQUAD_COSTS, desc: '+1% of class fire rate per rank, every soldier' },
};
export const SQUAD_TRAINING_IDS = Object.keys(SQUAD_TRAINING) as SquadTrainingStat[];

export const newTraining = (): TrainingRanks => ({ accuracy: 0, damage: 0, hp: 0, fireRate: 0, moveSpeed: 0 });
export const newSquadTraining = (): SquadTrainingRanks => ({ hp: 0, damage: 0, accuracy: 0, fireRate: 0 });
export const maxRank = (d: TrainingDef<string>) => d.costs.length;
/** Cost of the NEXT rank, or null when maxed. */
export const nextCost = (d: TrainingDef<string>, rank: number): number | null => (rank >= d.costs.length ? null : d.costs[rank]);
/** Clamp a stored rank: integers 0..max, anything else -> 0 / clamped. */
export function cleanRank(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(max, Math.floor(v)));
}

// ---------------- account ----------------
/** Per mission id. `bestStars` (v0.4) only ever goes up. */
export interface MissionRecord { completions: number; firstClearRun: string | null; bestStars: number }
/** v0.4 campaign progress. */
export interface CampaignProgress {
  /** Missions the player may deploy into (Mission 1 always; others by first clears). */
  unlockedMissions: string[];
  /** Mission chosen on the Campaign screen (next Deploy goes there). */
  selectedMission: string;
}
// ---------------- recruitment (v0.5) ----------------
// Rules + tables live in recruitment.ts; the persisted state is declared here (plain data, no
// imports) so the account can be created at module load without an import cycle.
/** A Recruitment Office offer. Level is fixed when the offer is generated (what you see is what you get). */
export interface CandidateRecord { id: string; name: string; classId: SoldierClassId; traitId: TraitId; level: number }
/** Minimal record of a dismissed soldier. Dismissed soldiers can never be restored. */
export interface DismissalRecord { eventId: string; id: string; name: string; classId: SoldierClassId; level: number; at: number; refund: number; restorable: false }
export interface RecruitmentState {
  /** The current three offers (empty until the office is first opened). */
  offers: CandidateRecord[];
  /** Next permanent soldier id number ("rc-<n>"); never reused. */
  nextSeq: number;
  /** Used-name registry (lowercase compare): every recruited name and every name given up by a rename. */
  usedNames: string[];
  /** Classes whose one-time "new class" introduction has happened (or was not needed). */
  introduced: SoldierClassId[];
  /** Dismissal history (also feeds the used-name registry and a future Memorial's exclusion list). */
  dismissed: DismissalRecord[];
  /** Active roster cap. */
  rosterCap: number;
  /** Lifetime counters (stats only). */
  recruited: number;
  refreshes: number;
}
export const ROSTER_CAP = 12;
export const newRecruitment = (introduced: SoldierClassId[] = ['infantry']): RecruitmentState =>
  ({ offers: [], nextSeq: 1, usedNames: [], introduced: [...introduced], dismissed: [], rosterCap: ROSTER_CAP, recruited: 0, refreshes: 0 });

// ---------------- permanent death (v0.6) ----------------
// Rules + prices live in casualties.ts, the transactions in economy.ts; the persisted state is
// declared here (plain data) like the recruitment state above.
/**
 * Why a soldier fell: bled out, left behind at extraction, the mission was abandoned (app closed /
 * restarted mid-mission) after they had fallen, or (v0.6.1) they were downed when the mission
 * FAILED (a legitimate gameplay failure never rescues a downed soldier).
 */
export type KiaCause = 'bleedout' | 'abandoned' | 'interrupted' | 'failed';
export interface FallenEntry { id: string; cause: KiaCause }
/**
 * The blocking post-mission decision (v0.5 reserved `pendingDecision` for it). Created in the
 * mission-end transaction for every KIA soldier; resolved one soldier at a time (Resurrect or
 * Memorial). While it exists: no deploying, recruiting, refreshing or training.
 */
export interface CasualtyDecision {
  kind: 'casualties';
  /** Mission run that produced these casualties (settled exactly once). */
  runId: string;
  missionId: string;
  at: number;
  /** Soldiers still awaiting a decision, in order (the first one is shown). */
  queue: FallenEntry[];
  /** Casualties in this batch ("Fallen Soldier n of total"). */
  total: number;
  /** Decisions taken so far in this batch (affordable: credits >= cost at that moment). */
  resolved: { id: string; name: string; outcome: 'resurrected' | 'memorial'; cost: number; affordable: boolean }[];
}
/** A fallen soldier honored in the Memorial: the full final record (never resurrectable). */
export interface MemorialRecord {
  eventId: string;
  /** Final snapshot: id, name, class, trait, XP/level, training, career, resurrections. */
  soldier: SoldierIdentity;
  missionId: string;
  runId: string;
  cause: KiaCause;
  at: number;
  /** Resurrection price at confirmation and whether it was affordable then (Operation Phoenix rule). */
  cost: number;
  affordable: boolean;
}
/** Operation Phoenix: emergency recruits after a total, unaffordable collapse. */
export interface PhoenixState {
  /** Grants already paid (one per collapse; the id is derived from the casualty batch). */
  grants: { id: string; at: number; recruits: string[] }[];
  /** An open grant: candidates to pick three from (persisted, so a reload shows the same people). */
  pending: { id: string; at: number; candidates: CandidateRecord[] } | null;
}
/** Mission journal: KIA that happened in the running mission, saved immediately (a reload can't undo a death). */
export interface ActiveRun { runId: string; missionId: string; kia: FallenEntry[] }
export const newPhoenix = (): PhoenixState => ({ grants: [], pending: null });

// ---------------- named campaign recruits (v0.6.1) ----------------
/**
 * Named campaign recruit offers, keyed by the named soldier's stable id (NAMED_RECRUITS in
 * campaign.ts). `unlocked`: milestone reached (offer exists, generic class / trait unlocked).
 * `claimed`: the one-time offer is used up for good (bought, or owned / dismissed / honored in
 * the Memorial before v0.6.1); never removed, so renames, dismissals and the Memorial can't bring
 * an offer back. `notified`: the one-time "NEW RECRUIT AVAILABLE!" notice was shown.
 */
export interface NamedRecruitState {
  unlocked: string[];
  claimed: string[];
  notified: string[];
  /** Purchases (legacy: owned before v0.6.1, never charged). */
  history: { key: string; soldierId: string; at: number; cost: number; level: number; legacy?: boolean }[];
}
export const newNamedRecruits = (): NamedRecruitState => ({ unlocked: [], claimed: [], notified: [], history: [] });

/**
 * v0.6.2 class unlocks (Unlocks.classes in campaign.ts: the Sniper after Mission 9). `unlocked`:
 * the class is recruitable for good (campaign flag `class:<id>`). `notified`: the one-time
 * "NEW CLASS UNLOCKED!" notice was shown. Never grants a soldier.
 */
export interface ClassUnlockState { unlocked: string[]; notified: string[] }
export const newClassUnlocks = (): ClassUnlockState => ({ unlocked: [], notified: [] });

export interface AccountData {
  credits: number;
  squadTraining: SquadTrainingRanks;
  /** Per stable mission id (v0.3 'comms-outpost' records are kept as history). */
  missions: Record<string, MissionRecord>;
  /** Recently settled mission-run ids: a run is rewarded at most once. */
  settledRuns: string[];
  campaign: CampaignProgress;
  /** v0.5 Recruitment Office state (offers, names, introductions, dismissals). */
  recruitment: RecruitmentState;
  /** v0.6: fallen soldiers awaiting Resurrect / Memorial (null = nothing pending). */
  pendingDecision: CasualtyDecision | null;
  /** v0.6: the Memorial (honored soldiers, oldest first). Never counts toward the roster cap. */
  memorial: MemorialRecord[];
  /** v0.6: Operation Phoenix grants. */
  phoenix: PhoenixState;
  /** v0.6: journal of the mission in progress (null outside a roster mission with a KIA). */
  activeRun: ActiveRun | null;
  /** v0.6.1: named campaign recruit offers (unlocked / claimed / notified / purchases). */
  named: NamedRecruitState;
  /** v0.6.2: classes unlocked by campaign milestones (Sniper). */
  classUnlocks: ClassUnlockState;
}
export const newCampaign = (): CampaignProgress => ({ unlockedMissions: [FIRST_MISSION], selectedMission: FIRST_MISSION });
export const newAccount = (): AccountData => ({
  credits: 0, squadTraining: newSquadTraining(), missions: {}, settledRuns: [], campaign: newCampaign(), recruitment: newRecruitment(),
  pendingDecision: null, memorial: [], phoenix: newPhoenix(), activeRun: null, named: newNamedRecruits(),
  classUnlocks: newClassUnlocks(),
});

let account: AccountData = newAccount();
export const getAccount = () => account;
export function setAccount(a: AccountData) { account = a; }

// ---------------- stat pipeline ----------------
export interface ProgressionInputs {
  level: number;
  training: TrainingRanks;
  squad: SquadTrainingRanks;
}
const ZERO_T = newTraining(), ZERO_S = newSquadTraining();
export const NO_PROGRESSION: ProgressionInputs = { level: 1, training: ZERO_T, squad: ZERO_S };

/** Summed additive fractions of class base for each stat (steps 2-4 of the pipeline). */
export function bonusFractions(p: ProgressionInputs) {
  const G = PROGRESSION.growth, T = TRAINING, S = SQUAD_TRAINING, gained = Math.max(0, p.level - 1);
  return {
    hp: G.hp * gained + T.hp.perRank * p.training.hp + S.hp.perRank * p.squad.hp,
    damage: G.damage * gained + T.damage.perRank * p.training.damage + S.damage.perRank * p.squad.damage,
    fireRate: G.fireRate * gained + T.fireRate.perRank * p.training.fireRate + S.fireRate.perRank * p.squad.fireRate,
    spread: T.accuracy.perRank * p.training.accuracy + S.accuracy.perRank * p.squad.accuracy,
    moveSpeed: T.moveSpeed.perRank * p.training.moveSpeed,
  };
}

// strips float noise (150 x 1.1 = 165.00000000000003) without hiding real values
export const clean = (v: number) => Math.round(v * 1e6) / 1e6;

/** Steps 1-4: class base with additive bonuses. Returns a NEW object; `base` is never touched. */
export function grownStats(base: SoldierStats, p: ProgressionInputs): SoldierStats {
  const f = bonusFractions(p);
  const spreadK = Math.max(0, 1 + f.spread);
  return {
    ...base,
    hp: base.hp * (1 + f.hp),
    damage: base.damage * (1 + f.damage),
    fireRate: base.fireRate * (1 + f.fireRate),
    accuracy: base.accuracy * spreadK,
    movePenalty: base.movePenalty * spreadK,
    moveSpeed: base.moveSpeed * (1 + f.moveSpeed),
  };
}

// ---------------- rewards ----------------
export type FinalStatus = 'Standing' | 'Downed' | 'KIA';
export interface MissionOutcome {
  missionId: string;
  runId: string;
  won: boolean;
  /** Deployed roster soldiers in deployment order. */
  deployed: { id: string; status: FinalStatus; downs: number; revives?: number; cause?: KiaCause }[];
  /**
   * Optional objectives this mission offers. `list` (v0.4) names them; an entry with
   * replaces 'fullExtraction' IS the whole-squad-extracted achievement, so the global
   * full-extraction bonus is not paid a second time for that mission (see below).
   */
  optional: { total: number; completed: number; list?: { id: string; label: string; completed: boolean; replaces?: 'fullExtraction' }[] };
  /** Stars earned this run (0..3, v0.4). */
  stars?: number;
}
export interface RewardLine { label: string; amount: number }
export interface SoldierReward {
  id: string; name: string; status: FinalStatus; eligible: boolean;
  /** XP offered for this mission (0 if not eligible). */
  xp: number;
  /** XP actually added (less than xp only at the level cap). */
  gained: number;
  before: { level: number; xp: number };
  after: { level: number; xp: number };
  levelsGained: number;
  capped: boolean;
}
export interface MissionReward {
  runId: string;
  missionId: string;
  won: boolean;
  firstClear: boolean;
  /** First clear whose one-time Credit bonus was already paid by the v0.3 mission on this map. */
  legacyFirstClearPaid: boolean;
  /** v0.4 campaign: stars this run, best before / after, and what this clear unlocked NOW. */
  stars: number;
  prevBest: number;
  bestStars: number;
  /** Always empty since v0.6.1: no soldier ever joins the roster for free (kept for older tools). */
  unlockedSoldiers: string[];
  /** v0.6.1: named campaign recruit offers this clear unlocked NOW (keys; not owned). */
  unlockedRecruits: string[];
  /** v0.6.2: classes this clear made recruitable NOW (e.g. 'sniper'). */
  unlockedClasses: string[];
  unlockedMissions: string[];
  xpLines: RewardLine[];
  xpMul: number;
  xpEach: number;
  creditLines: RewardLine[];
  credits: number;
  creditsAfter: number;
  soldiers: SoldierReward[];
  /** v0.6: soldiers who fell in this run (now awaiting a decision). */
  fallen: FallenEntry[];
  /** v0.6.1: soldiers who came home standing (failed missions included). */
  survivors: number;
  /** false: a run that paid nothing by rule (mission force-started while locked). */
  rewarded: boolean;
}

/**
 * Pure reward math (no state). XP rounding: the per-soldier total is multiplied by the
 * replay multiplier and rounded to the nearest integer, halves up (150 x 0.75 = 112.5 -> 113).
 */
export function computeMissionRewards(o: MissionOutcome, firstClear: boolean, firstClearBonusPaid = false) {
  const X = PROGRESSION.xp, C = PROGRESSION.credits;
  if (!o.won) return { xpLines: [] as RewardLine[], xpMul: 1, xpEach: 0, creditLines: [] as RewardLine[], credits: 0 };
  const full = o.deployed.length > 0 && o.deployed.every((d) => d.status === 'Standing');
  const flawless = full && o.deployed.every((d) => d.downs === 0); // nobody downed (and so nobody lost)
  const opt = Math.max(0, Math.min(o.optional.completed, o.optional.total));
  // OVERLAP RULE: when an optional objective IS "whole squad extracted" (Mission 3), that
  // achievement pays once, as the optional objective (+25 XP / +150 CR); the global
  // whole-squad bonus line is left out for that mission.
  const fullPaid = full && !(o.optional.list ?? []).some((x) => x.replaces === 'fullExtraction');
  const xpLines: RewardLine[] = [{ label: 'Victory', amount: X.victory }];
  if (o.optional.total > 0) xpLines.push({ label: `Optional objectives ${opt}/${o.optional.total}`, amount: X.perOptionalObjective * opt });
  if (fullPaid) xpLines.push({ label: 'Whole squad extracted', amount: X.fullExtraction });
  if (flawless) xpLines.push({ label: 'Nobody downed', amount: X.flawless });
  const xpMul = firstClear ? 1 : X.replayMul;
  const xpEach = Math.floor(xpLines.reduce((a, l) => a + l.amount, 0) * xpMul + 0.5);
  const creditLines: RewardLine[] = [{ label: firstClear ? 'Victory' : 'Victory (replay)', amount: firstClear ? C.victory : C.replayVictory }];
  if (o.optional.total > 0) creditLines.push({ label: `Optional objectives ${opt}/${o.optional.total}`, amount: C.perOptionalObjective * opt });
  if (fullPaid) creditLines.push({ label: 'Whole squad extracted', amount: C.fullExtraction });
  if (flawless) creditLines.push({ label: 'Nobody downed', amount: C.flawless });
  if (firstClear && !firstClearBonusPaid) creditLines.push({ label: 'First-time completion', amount: C.firstClear });
  return { xpLines, xpMul, xpEach, creditLines, credits: creditLines.reduce((a, l) => a + l.amount, 0) };
}

/** Add XP to a total, respecting the cap. */
export function addXp(xp: number, gain: number) {
  const max = MAX_XP();
  const next = Math.min(max, Math.max(0, xp) + Math.max(0, gain));
  return { xp: next, gained: next - Math.min(max, Math.max(0, xp)), level: levelForXp(next) };
}
