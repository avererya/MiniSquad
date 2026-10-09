// v0.4 campaign: data-driven mission list, deployment capacity, unlock rules and star rules.
// Pure data + pure functions (no game runtime): save.ts, economy.ts and menus.ts read it;
// the playable scripts (maps, enemies, objective chains) live in missions.ts, keyed by id.
//
// RULES
//  - Missions unlock sequentially: Mission 1 is always unlocked; clearing a mission (first
//    clear) unlocks what its `unlocks` lists (next mission, soldiers, a 4th slot, ...).
//    Completed missions can be replayed forever (replay rewards, see progression.ts).
//  - Deployment capacity is per mission NUMBER (table below), independent of roster size.
//  - Soldiers: a new save owns Ace + Ranger; Tank joins when Mission 2 becomes available
//    (first clear of Mission 1), Doc when Mission 3 does (clear of Mission 2), Havoc on clearing
//    Mission 5. Patch is reserved for the Mission 7 milestone (not in v0.4).
//  - Stars (best kept, never lowered; not a currency): 0 defeat, 1 primary complete,
//    2 = mission's 2-star rule, 3 = 2-star rule + mission's 3-star rule (see STAR RULES).

export type MissionType = 'elimination' | 'sabotage' | 'capture' | 'survival' | 'rescue';
export const MISSION_TYPE_LABEL: Record<MissionType, string> = {
  elimination: 'Elimination', sabotage: 'Sabotage', capture: 'Capture & Hold', survival: 'Survival / Extraction', rescue: 'Rescue / Escort',
};

/**
 * STAR RULES. two: 'optionals' = every optional objective completed; 'fullExtraction' = the
 * whole squad extracted (for missions without optional objectives). three (on top of the
 * 2-star condition): 'noKia' = no soldier KIA; 'noDowns' = nobody was ever downed (used where
 * "no KIA" is already implied by the 2-star condition, so the third star stays distinct).
 */
export interface StarRule { two: 'optionals' | 'fullExtraction'; three: 'noKia' | 'noDowns' }
export const STAR_TEXT = {
  one: 'Complete the primary objectives',
  optionals: 'Complete every optional objective',
  fullExtraction: 'Extract the whole squad',
  noKia: 'No soldier KIA',
  noDowns: 'Nobody downed',
} as const;

export interface OptionalDef {
  id: string;
  label: string;
  /** Same achievement as a global bonus: that bonus is not paid again (see progression.ts). */
  replaces?: 'fullExtraction';
}

export interface Unlocks { missions: string[]; soldiers: string[]; capacityNote?: string }

export interface CampaignMission {
  id: string; // stable: records, first clears, stars and unlocks are keyed by it
  number: number;
  name: string;
  type: MissionType;
  /** One-line briefing (the only story text). */
  briefing: string;
  primary: string[];
  optional: OptionalDef[];
  stars: StarRule;
  /** What the FIRST clear unlocks. */
  unlocks: Unlocks;
  /** Introduced mechanic, shown on the campaign card. */
  teaches: string;
  playable: boolean;
  /**
   * v0.1-v0.3 mission id this campaign mission replaces (same map). A legacy first clear of it
   * means the one-time first-clear CREDIT bonus was already paid: it is not paid again here
   * (no double grant). Unlocks, XP and the record still work as a normal first clear.
   */
  legacyId?: string;
}

/** Deployment capacity by mission number (future missions included). */
export const CAPACITY_TABLE: { from: number; to: number; max: number }[] = [
  { from: 1, to: 2, max: 2 },
  { from: 3, to: 5, max: 3 },
  { from: 6, to: 6, max: 4 },
  { from: 7, to: 12, max: 5 },
  { from: 13, to: Infinity, max: 6 },
];
export const MAX_DEPLOY_ENGINE = 6;
export function capacityFor(missionNumber: number): number {
  return CAPACITY_TABLE.find((r) => missionNumber >= r.from && missionNumber <= r.to)?.max ?? MAX_DEPLOY_ENGINE;
}

export const CAMPAIGN: CampaignMission[] = [
  {
    id: 'first-contact', number: 1, name: 'First Contact', type: 'elimination', playable: true,
    briefing: 'Enemy patrols are probing the valley. Push them back and get out.',
    primary: ['Eliminate the three enemy patrols', 'Reach the extraction zone'],
    optional: [], stars: { two: 'fullExtraction', three: 'noDowns' },
    teaches: 'Movement, auto-fire, Grenade, extraction',
    unlocks: { missions: ['heavy-support'], soldiers: ['tank'] },
  },
  {
    id: 'heavy-support', number: 2, name: 'Heavy Support', type: 'sabotage', playable: true,
    briefing: 'An enemy supply depot feeds the front. Blow it up.',
    primary: ['Destroy the enemy supply depot', 'Reach the extraction zone'],
    optional: [{ id: 'mg-nest', label: 'Eliminate the guarded MG nest' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Heavy Gunner: Suppressive Fire',
    unlocks: { missions: ['field-medicine'], soldiers: ['doc'] },
  },
  {
    id: 'field-medicine', number: 3, name: 'Field Medicine', type: 'capture', playable: true,
    briefing: 'Take the enemy communications outpost and hold it.',
    primary: ['Clear the outpost defenders', 'Hold the outpost', 'Survive until extraction'],
    optional: [{ id: 'all-extracted', label: 'Extract every soldier', replaces: 'fullExtraction' }], stars: { two: 'optionals', three: 'noDowns' },
    teaches: 'Medic: Field Treatment and fast revives',
    unlocks: { missions: ['red-canyon'], soldiers: [] },
    legacyId: 'comms-outpost',
  },
  {
    id: 'red-canyon', number: 4, name: 'Red Canyon Ambush', type: 'survival', playable: true,
    briefing: 'The canyon road is the only way out. Expect company.',
    primary: ['Advance into the canyon', 'Survive the ambush', 'Reach the extraction zone'],
    optional: [], stars: { two: 'fullExtraction', three: 'noDowns' },
    teaches: 'Revive under fire: 20 s bleed-out',
    unlocks: { missions: ['bring-them-home'], soldiers: [] },
  },
  {
    id: 'bring-them-home', number: 5, name: 'Bring Them Home', type: 'rescue', playable: true,
    briefing: 'A captured scout is held in the village compound. Bring them home.',
    primary: ['Clear the compound guards', 'Free the captive', 'Escort the captive to extraction'],
    optional: [{ id: 'captive-unharmed', label: 'The captive takes no damage' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Escort and positioning',
    unlocks: { missions: [], soldiers: ['havoc'], capacityNote: 'Squad size 4 for Mission 6' },
  },
  {
    id: 'mission-6', number: 6, name: 'Coming soon', type: 'elimination', playable: false,
    briefing: 'The next operation is being planned.', primary: ['Not available in v0.4'], optional: [],
    stars: { two: 'fullExtraction', three: 'noDowns' }, teaches: 'Four-soldier squads', unlocks: { missions: [], soldiers: [] },
  },
];

export const PLAYABLE = CAMPAIGN.filter((m) => m.playable);
export const MISSION_IDS = CAMPAIGN.map((m) => m.id);
export const FIRST_MISSION = CAMPAIGN[0].id;
export const campaignMission = (id: string): CampaignMission | undefined => CAMPAIGN.find((m) => m.id === id);
export const capacityOf = (id: string): number => capacityFor(campaignMission(id)?.number ?? 1);

/** Soldiers a brand-new save owns. */
export const STARTING_SOLDIERS = ['ace', 'ranger'];
/** How each other soldier is unlocked (shown on locked Barracks cards). */
export const SOLDIER_UNLOCK: Record<string, { by: string | null; text: string }> = {
  ace: { by: null, text: 'Starting soldier' },
  ranger: { by: null, text: 'Starting soldier' },
  tank: { by: 'first-contact', text: 'Joins when Mission 2 unlocks (clear Mission 1)' },
  doc: { by: 'heavy-support', text: 'Joins when Mission 3 unlocks (clear Mission 2)' },
  havoc: { by: 'bring-them-home', text: 'Joins after clearing Mission 5' },
  patch: { by: null, text: 'Joins at the Mission 7 milestone (future update)' },
};

/** Mission ids unlocked by clearing `cleared` (the campaign's own rules, used for repair). */
export function derivedMissionUnlocks(completed: (id: string) => boolean): string[] {
  const out = new Set<string>([FIRST_MISSION]);
  for (const m of CAMPAIGN) if (completed(m.id)) m.unlocks.missions.forEach((x) => out.add(x));
  return [...out];
}
/** Soldier ids the campaign has unlocked for these completions (starting soldiers included). */
export function derivedSoldierUnlocks(completed: (id: string) => boolean): string[] {
  const out = new Set<string>(STARTING_SOLDIERS);
  for (const m of CAMPAIGN) if (completed(m.id)) m.unlocks.soldiers.forEach((x) => out.add(x));
  return [...out];
}

// ---------------- stars ----------------
export interface StarInputs {
  won: boolean;
  optionalTotal: number;
  optionalCompleted: number;
  /** Final status of every deployed soldier. */
  statuses: ('Standing' | 'Downed' | 'KIA')[];
  /** Times each deployed soldier went down. */
  downs: number[];
}
export interface StarResult { stars: number; criteria: { label: string; met: boolean }[] }

export function computeStars(rule: StarRule, s: StarInputs): StarResult {
  const full = s.statuses.length > 0 && s.statuses.every((x) => x === 'Standing');
  const noKia = s.statuses.every((x) => x !== 'KIA');
  const noDowns = s.downs.every((d) => d === 0) && full;
  const two = rule.two === 'optionals' ? s.optionalTotal > 0 && s.optionalCompleted >= s.optionalTotal : full;
  const three = rule.three === 'noKia' ? noKia : noDowns;
  const criteria = [
    { label: STAR_TEXT.one, met: s.won },
    { label: STAR_TEXT[rule.two], met: s.won && two },
    { label: STAR_TEXT[rule.three], met: s.won && two && three },
  ];
  const stars = !s.won ? 0 : two ? (three ? 3 : 2) : 1;
  return { stars, criteria };
}
