// v0.4 mission scripts: map + enemy groups + reinforcement triggers + objective chain +
// extraction, per campaign mission id (campaign.ts holds names, capacity, unlocks, stars).
// Enemy counts are tuned for the squad size and soldier levels expected at that point of
// the campaign (see README "Campaign"); there is no enemy level scaling.
import { CFG } from './config';
import type { Game } from './game';
import {
  CANYON_MAP, CAPTIVE_POS, DEFENDER_POINTS, DEPOT_POS, EXTRACTION_ZONE, FIELD_MAP, FINAL_WAVE_POINTS, OUTPOST_MAP,
  OUTPOST_TRIGGERS, OUTPOST_ZONE, VALLEY_MAP, VILLAGE_MAP,
} from './map';
import type { Mission, MissionScript, TriggerSpec } from './mission';
import {
  AllExtractedOptional, CaptiveUnharmedOptional, CaptureObjective, DestroyObjective, EliminateObjective, EliminateOptional,
  FreeCaptiveObjective, ReachObjective, SurviveObjective,
} from './objectives';
import { squadCentre } from './squad';
import type { Vec } from './util';

const cx = (g: Game) => squadCentre(g.soldiers)?.x ?? 0;
const pastX = (id: string, x: number, points: Vec[], size: () => number, extra: Partial<TriggerSpec> = {}): TriggerSpec =>
  ({ id, when: (_m, g) => cx(g) > x, points, size, ...extra });
const freed = (m: Mission) => !!m.npc?.escorting;

// ---- Mission 1: First Contact (Elimination, 2 soldiers) ----
const FIRST_CONTACT: MissionScript = {
  id: 'first-contact', map: FIELD_MAP,
  groups: () => [
    { tag: 'patrol-a', points: [{ x: 1010, y: 580 }, { x: 1070, y: 640 }, { x: 990, y: 660 }], aggro: 430 },
    { tag: 'patrol-b', points: [{ x: 1700, y: 560 }, { x: 1745, y: 605 }, { x: 1690, y: 630 }, { x: 1735, y: 520 }], aggro: 430 },
    { tag: 'patrol-c', points: [{ x: 2070, y: 330 }, { x: 2120, y: 290 }, { x: 2010, y: 290 }], aggro: 430 },
  ],
  triggers: [],
  primaries: () => [new EliminateObjective('patrols', 'Eliminate the enemy patrols', ['patrol-a', 'patrol-b', 'patrol-c'], 'PATROL')],
  optionals: () => [],
  extraction: { zone: { x: 2110, y: 70, w: 260, h: 220 }, countdown: () => 6 },
  hint: 'Soldiers fire on their own. Grenade: press 1 or tap a portrait, then tap the ground.',
};

// ---- Mission 2: Heavy Support (Sabotage, 2 soldiers) ----
const HEAVY_SUPPORT: MissionScript = {
  id: 'heavy-support', map: VALLEY_MAP,
  groups: () => [
    { tag: 'depot-guards', points: [{ x: 2250, y: 410 }, { x: 2395, y: 455 }, { x: 2330, y: 375 }, { x: 2290, y: 505 }], aggro: 500 },
    { tag: 'mg-nest', points: [{ x: 1120, y: 250 }, { x: 1185, y: 250 }, { x: 1150, y: 305 }, { x: 1210, y: 305 }], aggro: 400 },
  ],
  triggers: [
    pastX('w1', 800, [{ x: 1500, y: 150 }, { x: 1750, y: 1350 }, { x: 1300, y: 120 }], () => 4),
    pastX('w2', 1650, [{ x: 2700, y: 820 }, { x: 2200, y: 1360 }, { x: 2000, y: 120 }], () => 4),
  ],
  primaries: () => [new DestroyObjective('depot', 'Destroy the enemy supply depot', DEPOT_POS, 'depot', 600, 'DEPOT')],
  optionals: () => [new EliminateOptional('mg-nest', 'Eliminate the guarded MG nest', ['mg-nest'], 'MG NEST')],
  extraction: {
    zone: { x: 2490, y: 1110, w: 270, h: 240 }, countdown: () => 12,
    finalWave: { points: [{ x: 2760, y: 600 }, { x: 1900, y: 1380 }, { x: 2780, y: 1380 }, { x: 1700, y: 1250 }], size: () => 5 },
  },
};

// ---- Mission 3: Field Medicine (Capture & Hold, 3 soldiers): the v0.1-v0.3 outpost mission ----
const FIELD_MEDICINE: MissionScript = {
  id: 'field-medicine', map: OUTPOST_MAP,
  groups: () => [{ tag: 'defenders', points: DEFENDER_POINTS.slice(0, CFG.mission.defenders), defender: true }],
  triggers: OUTPOST_TRIGGERS.map((t) => pastX(t.id, t.triggerX, t.candidates, () => CFG.mission[t.sizeKey])),
  primaries: () => [new CaptureObjective('outpost', 'Secure the communications outpost.', OUTPOST_ZONE, () => CFG.mission.outpostHold)],
  optionals: () => [new AllExtractedOptional('all-extracted', 'Extract every soldier')],
  extraction: {
    zone: EXTRACTION_ZONE, countdown: () => CFG.mission.extractionCountdown,
    finalWave: { points: FINAL_WAVE_POINTS, size: () => CFG.mission.finalWaveSize },
  },
};

// ---- Mission 4: Red Canyon Ambush (Survival / Extraction, 3 soldiers) ----
const EAST: Vec[] = [{ x: 2520, y: 560 }, { x: 2600, y: 440 }];
const WEST: Vec[] = [{ x: 1020, y: 560 }, { x: 960, y: 640 }];
const TOP: Vec[] = [{ x: 2025, y: 70 }];
const BOTTOM: Vec[] = [{ x: 1975, y: 1040 }];
const RED_CANYON: MissionScript = {
  id: 'red-canyon', map: CANYON_MAP,
  groups: () => [
    { tag: 'scouts', points: [{ x: 1250, y: 520 }, { x: 1300, y: 640 }, { x: 1220, y: 430 }], aggro: 450 },
  ],
  triggers: [],
  primaries: () => [
    new ReachObjective('advance', 'Advance through the canyon', { x: 1650, y: 200, w: 260, h: 700 }, 'ADVANCE'),
    new SurviveObjective('ambush', 'Survive the ambush', 50, [
      { at: 0, points: EAST, size: 4 },
      { at: 1, points: WEST, size: 4 },
      { at: 10, points: TOP, size: 4 },
      { at: 16, points: EAST, size: 4 },
      { at: 22, points: BOTTOM, size: 4 },
      { at: 28, points: WEST, size: 5 },
      { at: 34, points: EAST, size: 4 },
      { at: 41, points: TOP, size: 4 },
    ], 'AMBUSH! HOLD OUT UNTIL THE ROAD CLEARS'),
  ],
  optionals: () => [],
  extraction: {
    zone: { x: 3480, y: 320, w: 260, h: 250 }, countdown: () => 10,
    finalWave: { points: [{ x: 3770, y: 700 }, { x: 2650, y: 560 }, { x: 3200, y: 230 }], size: () => 4 },
  },
};

// ---- Mission 5: Bring Them Home (Rescue / Escort, 3 soldiers) ----
const BRING_THEM_HOME: MissionScript = {
  id: 'bring-them-home', map: VILLAGE_MAP,
  groups: () => [
    { tag: 'compound', points: [{ x: 2440, y: 260 }, { x: 2700, y: 440 }, { x: 2480, y: 490 }, { x: 2660, y: 480 }, { x: 2420, y: 380 }], aggro: 520 },
    { tag: 'patrol', points: [{ x: 1620, y: 830 }, { x: 1665, y: 890 }, { x: 1580, y: 905 }], aggro: 450 },
  ],
  triggers: [
    { id: 'village', when: (m, g) => !freed(m) && cx(g) > 1000, points: [{ x: 1000, y: 150 }, { x: 1900, y: 1560 }, { x: 600, y: 700 }], size: () => 3 },
    { id: 'pursuit', when: (m) => freed(m), points: [{ x: 2950, y: 900 }, { x: 2950, y: 1500 }, { x: 2950, y: 200 }], size: () => 4, banner: 'ENEMY PURSUIT INBOUND' },
    { id: 'roadblock', when: (m, g) => freed(m) && cx(g) < 1700, points: [{ x: 1000, y: 120 }, { x: 400, y: 800 }, { x: 1200, y: 780 }], size: () => 4 },
  ],
  primaries: () => [
    new EliminateObjective('compound', 'Clear the compound guards', ['compound'], 'GUARDS'),
    new FreeCaptiveObjective('free', 'Free the captive'),
  ],
  optionals: () => [new CaptiveUnharmedOptional('captive-unharmed', 'The captive takes no damage')],
  extraction: {
    zone: { x: 110, y: 110, w: 270, h: 230 }, countdown: () => 10, requireNpc: true,
    finalWave: { points: [{ x: 1200, y: 120 }, { x: 900, y: 700 }, { x: 600, y: 1140 }], size: () => 4 },
  },
  captive: CAPTIVE_POS,
};

export const MISSION_SCRIPTS: Record<string, MissionScript> = Object.fromEntries(
  [FIRST_CONTACT, HEAVY_SUPPORT, FIELD_MEDICINE, RED_CANYON, BRING_THEM_HOME].map((s) => [s.id, s]),
);
export const scriptFor = (id: string): MissionScript | undefined => MISSION_SCRIPTS[id];
