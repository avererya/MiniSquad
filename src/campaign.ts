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

export type MissionType = 'elimination' | 'sabotage' | 'capture' | 'survival' | 'rescue' | 'interception' | 'night' | 'assault' | 'liberation' | 'artillery';
export const MISSION_TYPE_LABEL: Record<MissionType, string> = {
  elimination: 'Elimination', sabotage: 'Sabotage', capture: 'Capture & Hold', survival: 'Survival / Extraction', rescue: 'Rescue / Escort',
  interception: 'Convoy Interception', night: 'Night Sabotage', assault: 'Assault / Boss',
  liberation: 'Liberation & Defense', artillery: 'Search & Destroy',
};

/** v0.6.2 campaign chapters (by mission number; the campaign screen groups missions under them). */
export const CHAPTERS: { number: number; name: string; from: number; to: number }[] = [
  { number: 1, name: '', from: 1, to: 5 }, // (Chapter 1 was never given a name)
  { number: 2, name: 'Behind Enemy Lines', from: 6, to: 10 },
  { number: 3, name: 'The Resistance', from: 11, to: Infinity },
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
  /**
   * v0.8A pre-deployment briefing (DEPLOY on the Campaign screen opens it): one or two sentences of story, the
   * primary objective in one line and a short tactical tip. Optional objectives come from `optional`.
   */
  brief?: { story: string; objective: string; tip?: string };
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
    brief: {
      story: 'Enemy patrols are probing the valley. Push them back before they report our position, then get out.',
      objective: 'Eliminate the three enemy patrols, then reach the extraction zone.',
      tip: 'Your soldiers aim and fire on their own: you steer the squad. Tap a portrait to throw a grenade into a group.',
    },
    unlocks: { missions: ['heavy-support'], recruits: ['tank'] },
  },
  {
    id: 'heavy-support', number: 2, name: 'Heavy Support', type: 'sabotage', playable: true,
    briefing: 'An enemy supply depot feeds the front. Blow it up.',
    primary: ['Destroy the enemy supply depot', 'Reach the extraction zone'],
    optional: [{ id: 'mg-nest', label: 'Eliminate the guarded MG nest' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Heavy Gunner: Suppressive Fire',
    brief: {
      story: 'An enemy supply depot is feeding the front line. Take it out.',
      objective: 'Destroy the enemy supply depot, then reach the extraction zone.',
      tip: "The Heavy Gunner's Suppressive Fire raises his fire rate by 75% for 5 seconds. Save it for when the guards engage.",
    },
    unlocks: { missions: ['field-medicine'], recruits: ['doc'] },
  },
  {
    id: 'field-medicine', number: 3, name: 'Field Medicine', type: 'capture', playable: true,
    briefing: 'Take the enemy communications outpost and hold it.',
    primary: ['Clear the outpost defenders', 'Hold the outpost', 'Survive until extraction'],
    optional: [{ id: 'all-extracted', label: 'Extract every soldier', replaces: 'fullExtraction' }], stars: { two: 'optionals', three: 'noDowns' },
    teaches: 'Medic: Field Treatment and fast revives',
    brief: {
      story: 'The enemy communications outpost watches the whole sector. Take it and hold it until the helicopter arrives.',
      objective: 'Clear the outpost defenders, hold the outpost, then survive until extraction.',
      tip: "The Medic's Field Treatment heals everyone close to them, and Medics revive faster. Keep the squad together while you hold.",
    },
    unlocks: { missions: ['red-canyon'], recruits: [] },
    legacyId: 'comms-outpost',
  },
  {
    id: 'red-canyon', number: 4, name: 'Red Canyon Ambush', type: 'survival', playable: true,
    briefing: 'The canyon road is the only way out. Expect company.',
    primary: ['Advance into the canyon', 'Survive the ambush', 'Reach the extraction zone'],
    optional: [], stars: { two: 'fullExtraction', three: 'noDowns' },
    teaches: 'Revive under fire: 20 s bleed-out',
    brief: {
      story: 'The canyon road is the only way out of the valley, and the enemy knows it.',
      objective: 'Advance into the canyon, survive the ambush, then reach the extraction zone.',
      tip: 'A downed soldier bleeds out in 20 seconds. The revive only runs while a squadmate stays next to them.',
    },
    unlocks: { missions: ['bring-them-home'], recruits: [] },
  },
  {
    id: 'bring-them-home', number: 5, name: 'Bring Them Home', type: 'rescue', playable: true,
    briefing: 'A captured scout is held in the village compound. Bring them home.',
    primary: ['Clear the compound guards', 'Free the captive', 'Escort the captive to extraction'],
    optional: [{ id: 'captive-unharmed', label: 'The captive takes no damage' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Escort and positioning',
    brief: {
      story: 'One of our scouts was captured and is being held in the village compound.',
      objective: 'Clear the compound guards, free the captive, then escort them to the extraction zone.',
      tip: 'Once freed, the captive walks in the middle of the squad. Clear the way ahead before you move them.',
    },
    unlocks: { missions: ['bridgehead'], recruits: ['havoc'], capacityNote: 'Squad size 4 for Mission 6' },
  },
  // ---- v0.6.2 Chapter 2: Behind Enemy Lines ----
  {
    id: 'bridgehead', number: 6, name: 'Bridgehead', type: 'capture', playable: true,
    briefing: 'Seize the only bridge over the river and hold it against the counterattack.',
    primary: ['Clear the bridgehead defenders', 'Hold the bridge', 'Reach the extraction zone'],
    optional: [{ id: 'no-kia', label: 'No soldier KIA', replaces: 'fullExtraction' }], stars: { two: 'optionals', three: 'noDowns' },
    teaches: 'Chokepoints and enemy Snipers (watch the red laser)',
    brief: {
      story: "The only bridge over the river is the key to the enemy's rear. Seize it and hold it against the counterattack.",
      objective: 'Clear the bridgehead defenders, hold the bridge, then reach the extraction zone.',
      tip: 'A red laser means an enemy Sniper is aiming. Step off the line or break line of sight before it fires.',
    },
    unlocks: { missions: ['prison-break'], recruits: [], capacityNote: 'Squad size 5 from Mission 7' },
  },
  {
    id: 'prison-break', number: 7, name: 'Prison Break', type: 'rescue', playable: true,
    briefing: 'A captured field medic is held in a guarded camp. Break in and bring them out.',
    primary: ['Clear the camp guards', 'Free the captured medic', 'Escort the medic to extraction'],
    optional: [{ id: 'prisoner-safe', label: 'The prisoner is never downed' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Watchtowers and protective escort formation',
    brief: {
      story: 'A captured field medic is held in a guarded prison camp. Break in and bring them out alive.',
      objective: 'Clear the camp guards, free the captured medic, then escort them to the extraction zone.',
      tip: 'Watchtower guards never leave their towers. Use the walls to break their line of sight, or come at them from the side.',
    },
    unlocks: { missions: ['convoy-crusher'], recruits: ['patch'] },
  },
  {
    id: 'convoy-crusher', number: 8, name: 'Convoy Crusher', type: 'interception', playable: true,
    briefing: 'Three supply trucks are crossing the canyon. Stop them before they get through.',
    primary: ['Destroy at least 2 of the 3 supply trucks', 'Reach the extraction zone'],
    optional: [{ id: 'all-trucks', label: 'Destroy all three trucks' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Moving targets and Armored Troopers (flank them)',
    brief: {
      story: 'Three supply trucks are crossing the canyon under escort. Stop them before they get through.',
      objective: 'Destroy at least 2 of the 3 supply trucks, then reach the extraction zone.',
      tip: 'Armored Troopers shrug off rounds to their front plate. Flank them, or use grenades.',
    },
    unlocks: { missions: ['blackout'], recruits: [] },
  },
  {
    id: 'blackout', number: 9, name: 'Blackout', type: 'night', playable: true,
    briefing: 'Knock out the communications relays at night before the alarm brings the whole garrison.',
    primary: ['Destroy the 3 communication relays', 'Reach the extraction zone'],
    optional: [{ id: 'alarm', label: 'Destroy every relay before the alarm maxes out' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Reinforcement pressure and the alarm',
    brief: {
      story: "Under cover of night, cut the garrison's communications before the alarm brings every soldier in the area.",
      objective: 'Destroy the 3 communication relays, then reach the extraction zone.',
      tip: 'Every relay still standing pushes the alarm and its reinforcements faster. Move quickly from relay to relay.',
    },
    unlocks: { missions: ['iron-fist'], recruits: [], classes: ['sniper'] },
  },
  {
    id: 'iron-fist', number: 10, name: 'Operation Iron Fist', type: 'assault', playable: true,
    briefing: 'Destroy the stronghold installations, then take down its commander: the Iron Warden.',
    primary: ['Destroy the 2 enemy installations', 'Storm the stronghold', 'Defeat the Iron Warden', 'Reach the extraction zone'],
    optional: [{ id: 'no-kia', label: 'No soldier KIA', replaces: 'fullExtraction' }], stars: { two: 'optionals', three: 'noDowns' },
    teaches: 'Boss fight: dodge the machine gun and the rocket circle',
    brief: {
      story: "The stronghold is the heart of the enemy's defences, and its commander leads from the front.",
      objective: 'Destroy the 2 installations, storm the stronghold, defeat the Iron Warden, then reach the extraction zone.',
      tip: "Watch the Iron Warden's tells: a sweeping machine-gun line and a red rocket circle. Keep moving out of both.",
    },
    unlocks: { missions: ['resistance-rising'], recruits: [] },
  },
  // ---- v0.8A Chapter 3: The Resistance ----
  {
    id: 'resistance-rising', number: 11, name: 'Resistance Rising', type: 'liberation', playable: true,
    briefing: 'Liberate an occupied village and help the local resistance hold its safehouse.',
    primary: ['Liberate the 3 village zones (any order)', 'Defend the resistance safehouse', 'Reach the extraction zone'],
    optional: [{ id: 'allies-alive', label: 'Keep all three resistance allies alive through extraction' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Resistance allies fight beside you and can be revived',
    brief: {
      story: 'An occupied village has become a rallying point for local resistance fighters. Liberate its key positions and help the resistance hold off the enemy counterattack.',
      objective: 'Liberate three village zones, then defend the resistance safehouse.',
      tip: 'Clear the village in any order, but regroup before the counterattack begins.',
    },
    unlocks: { missions: ['artillery-hunt'], recruits: [] },
  },
  {
    id: 'artillery-hunt', number: 12, name: 'Artillery Hunt', type: 'artillery', playable: true,
    briefing: 'Destroy three artillery guns at night without being caught in the searchlights.',
    primary: ['Destroy the 3 artillery guns (any order)', 'Reach the extraction zone'],
    optional: [{ id: 'no-artillery', label: 'Complete the mission without triggering an artillery alert' }], stars: { two: 'optionals', three: 'noKia' },
    teaches: 'Searchlights and artillery: keep moving, use solid cover',
    brief: {
      story: 'Enemy artillery is threatening resistance positions across the region. Infiltrate the gun emplacements, avoid the searchlights, and destroy all three artillery pieces.',
      objective: 'Destroy three enemy artillery guns.',
      tip: 'Keep moving when artillery marks your position. Solid cover reduces incoming blast damage.',
    },
    unlocks: { missions: [], recruits: [], classes: ['commando'] },
  },
  {
    id: 'mission-13', number: 13, name: 'Coming soon', type: 'elimination', playable: false,
    briefing: 'The next part of Chapter 3 is coming in a future update.', primary: ['Not available yet'], optional: [],
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
  commando: {
    title: 'NEW CLASS UNLOCKED! COMMANDO',
    body: 'Fast dual-pistol close-assault specialists are now available in the Recruitment Office.',
    unlockText: 'Unlock the Commando class for recruitment',
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
