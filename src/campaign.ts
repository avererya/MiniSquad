// v0.4 campaign: data-driven mission list, deployment capacity, unlock rules and star rules.
// Pure data + pure functions (no game runtime): save.ts, economy.ts and menus.ts read it;
// the playable scripts (maps, enemies, objective chains) live in missions.ts, keyed by id.
//
// RULES
//  - Missions unlock sequentially: Mission 1 is always unlocked; clearing a mission (first
//    clear) unlocks what its `unlocks` lists (next mission, soldiers, a 4th slot, ...).
//    Completed missions can be replayed forever (replay rewards, see progression.ts).
//  - Deployment capacity is per mission NUMBER (table below), independent of roster size.
//  - Soldiers (v0.6.1): a new save owns ONLY Ace + Ranger. A first clear never adds a soldier:
//    it unlocks a named campaign RECRUIT OFFER (Tank: Mission 1, Doc: Mission 2, Havoc: Mission 5,
//    Patch: Mission 7) that the player may buy in the Recruitment Office
//    (NAMED_RECRUITS below). The same milestone unlocks the generic class / trait for random
//    recruits, whether or not the named soldier is ever bought.
//  - Stars (best kept, never lowered; not a currency): 0 defeat, 1 primary complete,
//    2 = mission's 2-star rule, 3 = 2-star rule + mission's 3-star rule (see STAR RULES).

export type MissionType = 'elimination' | 'sabotage' | 'capture' | 'survival' | 'rescue' | 'interception' | 'night' | 'assault';
export const MISSION_TYPE_LABEL: Record<MissionType, string> = {
  elimination: 'Elimination', sabotage: 'Sabotage', capture: 'Capture & Hold', survival: 'Survival / Extraction', rescue: 'Rescue / Escort',
  interception: 'Convoy Interception', night: 'Night Sabotage', assault: 'Assault / Boss',
};

/** v0.6.2 campaign chapters (by mission number; the campaign screen groups missions under them). */
export const CHAPTERS: { number: number; name: string; from: number; to: number }[] = [
  { number: 1, name: '', from: 1, to: 5 }, // (Chapter 1 was never given a name)
  { number: 2, name: 'Behind Enemy Lines', from: 6, to: 10 },
  { number: 3, name: 'Coming soon', from: 11, to: Infinity },
];
export const chapterOf = (missionNumber: number) => CHAPTERS.find((c) => missionNumber >= c.from && missionNumber <= c.to) ?? CHAPTERS[0];

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

/** `recruits`: named campaign recruit offers (NAMED_RECRUITS keys) this first clear unlocks (never a free soldier). */
export interface Unlocks {
  missions: string[];
  recruits: string[];
  capacityNote?: string;
  /** v0.6.2: soldier classes this first clear makes recruitable (Mission 9: Sniper). Never a free soldier. */
  classes?: string[];
}

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
    unlocks: { missions: ['heavy-support'], recruits: ['tank'] },
  },
  {
    id: 'heavy-support', number: 2, name: 'Heavy Support', type: 'sabotage', playable: true,
    briefing: 'An enemy supply depot feeds the front. Blow it up.',
    primary: ['Destroy the enemy supply depot', 'Reach the extraction zone'],
    optional: [{ id: 'mg-nest', label: 'Eliminate the guarded MG nest' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Heavy Gunner: Suppressive Fire',
    unlocks: { missions: ['field-medicine'], recruits: ['doc'] },
  },
  {
    id: 'field-medicine', number: 3, name: 'Field Medicine', type: 'capture', playable: true,
    briefing: 'Take the enemy communications outpost and hold it.',
    primary: ['Clear the outpost defenders', 'Hold the outpost', 'Survive until extraction'],
    optional: [{ id: 'all-extracted', label: 'Extract every soldier', replaces: 'fullExtraction' }], stars: { two: 'optionals', three: 'noDowns' },
    teaches: 'Medic: Field Treatment and fast revives',
    unlocks: { missions: ['red-canyon'], recruits: [] },
    legacyId: 'comms-outpost',
  },
  {
    id: 'red-canyon', number: 4, name: 'Red Canyon Ambush', type: 'survival', playable: true,
    briefing: 'The canyon road is the only way out. Expect company.',
    primary: ['Advance into the canyon', 'Survive the ambush', 'Reach the extraction zone'],
    optional: [], stars: { two: 'fullExtraction', three: 'noDowns' },
    teaches: 'Revive under fire: 20 s bleed-out',
    unlocks: { missions: ['bring-them-home'], recruits: [] },
  },
  {
    id: 'bring-them-home', number: 5, name: 'Bring Them Home', type: 'rescue', playable: true,
    briefing: 'A captured scout is held in the village compound. Bring them home.',
    primary: ['Clear the compound guards', 'Free the captive', 'Escort the captive to extraction'],
    optional: [{ id: 'captive-unharmed', label: 'The captive takes no damage' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Escort and positioning',
    unlocks: { missions: ['bridgehead'], recruits: ['havoc'], capacityNote: 'Squad size 4 for Mission 6' },
  },
  // ---- v0.6.2 Chapter 2: Behind Enemy Lines ----
  {
    id: 'bridgehead', number: 6, name: 'Bridgehead', type: 'capture', playable: true,
    briefing: 'Seize the only bridge over the river and hold it against the counterattack.',
    primary: ['Clear the bridgehead defenders', 'Hold the bridge', 'Reach the extraction zone'],
    optional: [{ id: 'no-kia', label: 'No soldier KIA', replaces: 'fullExtraction' }], stars: { two: 'optionals', three: 'noDowns' },
    teaches: 'Chokepoints and enemy Snipers (watch the red laser)',
    unlocks: { missions: ['prison-break'], recruits: [], capacityNote: 'Squad size 5 from Mission 7' },
  },
  {
    id: 'prison-break', number: 7, name: 'Prison Break', type: 'rescue', playable: true,
    briefing: 'A captured field medic is held in a guarded camp. Break in and bring them out.',
    primary: ['Clear the camp guards', 'Free the captured medic', 'Escort the medic to extraction'],
    optional: [{ id: 'prisoner-safe', label: 'The prisoner is never downed' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Watchtowers and protective escort formation',
    unlocks: { missions: ['convoy-crusher'], recruits: ['patch'] },
  },
  {
    id: 'convoy-crusher', number: 8, name: 'Convoy Crusher', type: 'interception', playable: true,
    briefing: 'Three supply trucks are crossing the canyon. Stop them before they get through.',
    primary: ['Destroy at least 2 of the 3 supply trucks', 'Reach the extraction zone'],
    optional: [{ id: 'all-trucks', label: 'Destroy all three trucks' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Moving targets and Armored Troopers (flank them)',
    unlocks: { missions: ['blackout'], recruits: [] },
  },
  {
    id: 'blackout', number: 9, name: 'Blackout', type: 'night', playable: true,
    briefing: 'Knock out the communications relays at night before the alarm brings the whole garrison.',
    primary: ['Destroy the 3 communication relays', 'Reach the extraction zone'],
    optional: [{ id: 'alarm', label: 'Destroy every relay before the alarm maxes out' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Reinforcement pressure and the alarm',
    unlocks: { missions: ['iron-fist'], recruits: [], classes: ['sniper'] },
  },
  {
    id: 'iron-fist', number: 10, name: 'Operation Iron Fist', type: 'assault', playable: true,
    briefing: 'Destroy the stronghold installations, then take down its commander: the Iron Warden.',
    primary: ['Destroy the 2 enemy installations', 'Storm the stronghold', 'Defeat the Iron Warden', 'Reach the extraction zone'],
    optional: [{ id: 'no-kia', label: 'No soldier KIA', replaces: 'fullExtraction' }], stars: { two: 'optionals', three: 'noDowns' },
    teaches: 'Boss fight: dodge the machine gun and the rocket circle',
    unlocks: { missions: [], recruits: [] },
  },
  {
    id: 'mission-11', number: 11, name: 'Coming soon', type: 'elimination', playable: false,
    briefing: 'Chapter 3 is being planned.', primary: ['Not available in v0.6.2'], optional: [],
    stars: { two: 'fullExtraction', three: 'noDowns' }, teaches: 'Chapter 3', unlocks: { missions: [], recruits: [] },
  },
];

export const PLAYABLE = CAMPAIGN.filter((m) => m.playable);
export const MISSION_IDS = CAMPAIGN.map((m) => m.id);
export const FIRST_MISSION = CAMPAIGN[0].id;
export const campaignMission = (id: string): CampaignMission | undefined => CAMPAIGN.find((m) => m.id === id);
export const capacityOf = (id: string): number => capacityFor(campaignMission(id)?.number ?? 1);

/**
 * v0.6.1 NAMED CAMPAIGN RECRUITS. A milestone (first clear of `milestone`) unlocks a permanent
 * Recruitment Office offer for this named soldier (`key` = their stable soldier id, also the
 * offer key: claims are tracked by it, never by the display name). The same milestone unlocks the
 * generic class (`newClass`) and the soldier's trait for random recruits, independently of the
 * purchase. Patch's milestone is Mission 7 (Prison Break, v0.6.2).
 */
export interface NamedRecruitDef {
  key: string;
  /** Mission id whose first clear unlocks the offer. */
  milestone: string;
  missionNumber: number;
  price: number;
  /** True when this milestone also makes the soldier's class recruitable (Tank, Doc). */
  newClass: boolean;
  /** Campaign screen first-clear text. */
  unlockText: string;
  /** Second line of the unlock notification. */
  notice: string;
}
export const NAMED_RECRUIT_PRICE = 1000;
export const NAMED_RECRUITS: NamedRecruitDef[] = [
  { key: 'tank', milestone: 'first-contact', missionNumber: 1, price: NAMED_RECRUIT_PRICE, newClass: true, unlockText: 'Unlock Tank + Heavy Gunner recruitment', notice: 'Heavy Gunners can now be recruited.' },
  { key: 'doc', milestone: 'heavy-support', missionNumber: 2, price: NAMED_RECRUIT_PRICE, newClass: true, unlockText: 'Unlock Doc + Medic recruitment', notice: 'Medics can now be recruited.' },
  { key: 'havoc', milestone: 'bring-them-home', missionNumber: 5, price: NAMED_RECRUIT_PRICE, newClass: false, unlockText: 'Unlock Havoc + Trigger Happy trait', notice: 'New named recruit · Trigger Happy trait now available for recruits.' },
  { key: 'patch', milestone: 'prison-break', missionNumber: 7, price: NAMED_RECRUIT_PRICE, newClass: false, unlockText: 'Unlock Patch + Healer trait', notice: 'New named recruit · Healer trait now available for Medic recruits.' },
];
export const namedRecruit = (key: string) => NAMED_RECRUITS.find((n) => n.key === key);

/** Soldiers a brand-new save owns (the only free soldiers). */
export const STARTING_SOLDIERS = ['ace', 'ranger'];
/** How each named soldier becomes available (locked named soldiers are never shown as roster cards). */
export const SOLDIER_UNLOCK: Record<string, { by: string | null; text: string }> = {
  ace: { by: null, text: 'Starting soldier' },
  ranger: { by: null, text: 'Starting soldier' },
  tank: { by: 'first-contact', text: 'Recruit in the Recruitment Office after clearing Mission 1' },
  doc: { by: 'heavy-support', text: 'Recruit in the Recruitment Office after clearing Mission 2' },
  havoc: { by: 'bring-them-home', text: 'Recruit in the Recruitment Office after clearing Mission 5' },
  patch: { by: 'prison-break', text: 'Recruit in the Recruitment Office after clearing Mission 7' },
};

/** v0.6.2: soldier classes unlocked by these completions (Sniper after Mission 9). */
export function derivedClassUnlocks(completed: (id: string) => boolean): string[] {
  const out = new Set<string>();
  for (const m of CAMPAIGN) if (completed(m.id)) (m.unlocks.classes ?? []).forEach((c) => out.add(c));
  return [...out];
}
/** v0.6.2 class unlock notification text. */
export const CLASS_UNLOCK_TEXT: Record<string, { title: string; body: string; unlockText: string }> = {
  sniper: {
    title: 'NEW CLASS UNLOCKED! SNIPER',
    body: 'Long-range precision specialists are now available in the Recruitment Office.',
    unlockText: 'Unlock the Sniper class for recruitment',
  },
};

/** Mission ids unlocked by clearing `cleared` (the campaign's own rules, used for repair). */
export function derivedMissionUnlocks(completed: (id: string) => boolean): string[] {
  const out = new Set<string>([FIRST_MISSION]);
  for (const m of CAMPAIGN) if (completed(m.id)) m.unlocks.missions.forEach((x) => out.add(x));
  return [...out];
}
/**
 * PRE-v0.6.1 rule, used only to migrate older saves: soldiers those versions AWARDED (joined the
 * roster for free) for these completions (starting soldiers included).
 */
export function derivedSoldierUnlocks(completed: (id: string) => boolean): string[] {
  const out = new Set<string>(STARTING_SOLDIERS);
  for (const m of CAMPAIGN) if (completed(m.id)) m.unlocks.recruits.forEach((x) => out.add(x));
  return [...out];
}
/** v0.6.1: named recruit offers (keys) whose milestone these completions reached. */
export function derivedRecruitUnlocks(completed: (id: string) => boolean): string[] {
  return NAMED_RECRUITS.filter((n) => completed(n.milestone)).map((n) => n.key);
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
