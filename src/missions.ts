// v0.4 mission scripts: map + enemy groups + reinforcement triggers + objective chain +
// extraction, per campaign mission id (campaign.ts holds names, capacity, unlocks, stars).
// Enemy counts are tuned for the squad size and soldier levels expected at that point of
// the campaign (see README "Campaign"); there is no enemy level scaling.
import { CFG } from './config';
import type { Game } from './game';
import {
  ARENA, BLACKOUT_MAP, BRIDGE_MAP, BRIDGE_ZONE, CONVOY_MAP, CONVOY_ROUTE, INSTALLATIONS, PRISON_CAPTIVE, PRISON_MAP, PRISON_TOWERS,
  RELAY_POINTS, STRONGHOLD_MAP,
  CANYON_MAP, CAPTIVE_POS, DEFENDER_POINTS, DEPOT_POS, EXTRACTION_ZONE, FIELD_MAP, FINAL_WAVE_POINTS, OUTPOST_MAP,
  OUTPOST_TRIGGERS, OUTPOST_ZONE, VALLEY_MAP, VILLAGE_MAP,
} from './map';
import type { Mission, MissionScript, TriggerSpec } from './mission';
import {
  AlarmOptional, BossObjective, CaptiveNeverDownedOptional, ConvoyAllOptional, ConvoyObjective, HoldObjective,
  MultiDestroyObjective, NoKiaOptional, RelaysObjective,
  AllExtractedOptional, CaptiveUnharmedOptional, CaptureObjective, DestroyObjective, EliminateObjective, EliminateOptional,
  FreeCaptiveObjective, ReachObjective, SurviveObjective,
} from './objectives';
import { squadCentre } from './squad';
import type { Vec } from './util';
import type { EnemyKind } from './unit';

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


// =====================================================================================
// v0.6.2 CHAPTER 2 — BEHIND ENEMY LINES (Missions 6-10)
// =====================================================================================
const k = (x: number, y: number, kind: EnemyKind) => ({ x, y, kind });

// ---- Mission 6: Bridgehead (Capture & Hold, 4 soldiers) ----
const EAST_BANK: Vec[] = [{ x: 3150, y: 720 }, { x: 3120, y: 300 }, { x: 3120, y: 1250 }];
const WEST_BANK: Vec[] = [{ x: 60, y: 300 }, { x: 60, y: 1200 }, { x: 700, y: 1460 }, { x: 700, y: 40 }];
const BRIDGEHEAD: MissionScript = {
  id: 'bridgehead', map: BRIDGE_MAP,
  groups: () => [
    { tag: 'west-patrol', points: [{ x: 1120, y: 700 }, { x: 1170, y: 770 }, { x: 1090, y: 830 }], aggro: 450 },
    {
      tag: 'bridge-guards', aggro: 620,
      points: [{ x: 1960, y: 660 }, { x: 1975, y: 785 }, { x: 2150, y: 690 }, { x: 2170, y: 600 }, { x: 2160, y: 840 }, k(2720, 740, 'sniper'), k(2600, 330, 'sniper')],
    },
  ],
  triggers: [
    pastX('far-bank', 2100, [{ x: 3150, y: 400 }, { x: 3150, y: 1100 }], () => 3),
  ],
  primaries: () => [
    new EliminateObjective('bridgehead', 'Clear the bridgehead defenders', ['bridge-guards'], 'BRIDGE'),
    new HoldObjective('hold', 'Hold the bridge', BRIDGE_ZONE, 45, [
      { at: 0, points: EAST_BANK, size: 3 },
      { at: 4, points: WEST_BANK, size: 2 },
      { at: 12, points: EAST_BANK, size: 3, kinds: ['sniper', 'rifleman', 'rifleman'] },
      { at: 20, points: WEST_BANK, size: 3 },
      { at: 28, points: EAST_BANK, size: 4, second: true },
      { at: 36, points: WEST_BANK, size: 3, kinds: ['rifleman', 'sniper', 'rifleman'] },
    ], 'COUNTERATTACK FROM BOTH BANKS — HOLD THE BRIDGE', 'BRIDGE'),
  ],
  optionals: () => [new NoKiaOptional('no-kia', 'No soldier KIA')],
  extraction: {
    zone: { x: 2880, y: 120, w: 260, h: 220 }, countdown: () => 10,
    finalWave: { points: [{ x: 3150, y: 900 }, { x: 2400, y: 40 }, { x: 3150, y: 1300 }], size: () => 4 },
  },
};

// ---- Mission 7: Prison Break (Rescue / Escort, 5 soldiers) ----
const PRISON_BREAK: MissionScript = {
  id: 'prison-break', map: PRISON_MAP,
  groups: () => [
    { tag: 'towers', points: PRISON_TOWERS.map((p) => k(p.x, p.y, 'tower')), aggro: 560 },
    {
      tag: 'guards', aggro: 520,
      points: [
        { x: 1900, y: 700 }, { x: 1960, y: 620 }, { x: 2150, y: 560 }, { x: 2350, y: 700 }, { x: 2400, y: 900 },
        { x: 2100, y: 1180 }, { x: 2420, y: 650 }, { x: 2420, y: 560 }, { x: 2650, y: 880 },
        { x: 2300, y: 1180 }, { x: 1800, y: 1150 }, { x: 2700, y: 470 }, k(2050, 380, 'sniper'),
      ],
    },
    { tag: 'outer-patrol', points: [{ x: 1200, y: 1000 }, { x: 1250, y: 1060 }, { x: 1150, y: 1080 }], aggro: 430 },
    { tag: 'outer-post', points: [{ x: 700, y: 560 }, { x: 760, y: 500 }, { x: 650, y: 470 }], aggro: 430 },
  ],
  triggers: [
    { id: 'approach', when: (m, g) => !freed(m) && cx(g) > 1300, points: [{ x: 1700, y: 60 }, { x: 1300, y: 1580 }], size: () => 3 },
    { id: 'breakout', when: (m) => freed(m), points: [{ x: 3150, y: 800 }, { x: 3150, y: 250 }, { x: 2300, y: 1580 }], size: () => 4, banner: 'PRISON ALARM — GUARDS INBOUND' },
    { id: 'yard', when: (m, g) => freed(m) && cx(g) < 2300, points: [{ x: 2300, y: 1580 }, { x: 2300, y: 60 }, { x: 3150, y: 1200 }], size: () => 3, second: true },
    { id: 'cutoff', when: (m, g) => freed(m) && cx(g) < 1500, points: [{ x: 1300, y: 60 }, { x: 60, y: 760 }, { x: 900, y: 1580 }], size: () => 4, kinds: ['rifleman', 'rifleman', 'sniper', 'rifleman'] },
  ],
  primaries: () => [
    new EliminateObjective('guards', 'Break into the camp and clear the guards', ['guards'], 'GUARDS'),
    new FreeCaptiveObjective('free', 'Free the captured medic'),
  ],
  optionals: () => [new CaptiveNeverDownedOptional('prisoner-safe', 'The prisoner is never downed')],
  extraction: {
    zone: { x: 110, y: 110, w: 270, h: 230 }, countdown: () => 10, requireNpc: true,
    finalWave: { points: [{ x: 1300, y: 60 }, { x: 60, y: 760 }, { x: 900, y: 900 }], size: () => 4 },
  },
  captive: PRISON_CAPTIVE,
  captiveLabel: 'POW MEDIC',
};

// ---- Mission 8: Convoy Crusher (Interception, 5 soldiers) ----
const CONVOY_CRUSHER: MissionScript = {
  id: 'convoy-crusher', map: CONVOY_MAP,
  groups: () => [
    { tag: 'pickets-e', points: [{ x: 2520, y: 1000 }, { x: 2570, y: 1060 }], aggro: 450 },
    { tag: 'pickets-w', points: [{ x: 950, y: 1230 }, { x: 1000, y: 1180 }], aggro: 450 },
  ],
  triggers: [],
  primaries: () => [new ConvoyObjective('convoy', 'Destroy at least 2 of the 3 supply trucks', 2)],
  optionals: () => [new ConvoyAllOptional('all-trucks', 'Destroy all three trucks')],
  convoy: {
    route: CONVOY_ROUTE, gap: 14, delay: 10,
    escorts: [['rifleman', 'rifleman', 'rifleman'], ['armored', 'rifleman', 'rifleman'], ['armored', 'armored', 'rifleman', 'rifleman']],
  },
  extraction: {
    zone: { x: 1750, y: 110, w: 260, h: 180 }, countdown: () => 10,
    finalWave: { points: [{ x: 2600, y: 160 }, { x: 1000, y: 160 }, { x: 3350, y: 600 }], size: () => 4 },
  },
};

// ---- Mission 9: Blackout (Night Sabotage, 5 soldiers) ----
let relays: RelaysObjective | null = null;
const BLACKOUT: MissionScript = {
  id: 'blackout', map: BLACKOUT_MAP,
  groups: () => [
    { tag: 'relay-a', points: [{ x: 1000, y: 490 }, { x: 900, y: 510 }, { x: 1110, y: 420 }, { x: 1150, y: 600 }, { x: 800, y: 420 }], aggro: 430 },
    { tag: 'relay-b', points: [{ x: 2350, y: 760 }, { x: 2380, y: 900 }, { x: 2600, y: 620 }, { x: 2300, y: 620 }, k(2650, 960, 'sniper')], aggro: 460 },
    { tag: 'relay-c', points: [{ x: 1550, y: 1310 }, { x: 1440, y: 1330 }, { x: 1700, y: 1340 }, { x: 1750, y: 1500 }, k(1300, 1450, 'sniper')], aggro: 430 },
    { tag: 'yard', points: [{ x: 1800, y: 1000 }, { x: 1850, y: 1060 }, { x: 1200, y: 1100 }, k(1780, 600, 'sniper')], aggro: 480 },
    { tag: 'gate', points: [{ x: 600, y: 900 }, { x: 650, y: 980 }], aggro: 420 },
  ],
  triggers: [],
  primaries: () => {
    relays = new RelaysObjective('relays', 'Destroy the 3 communication relays', RELAY_POINTS, 900,
      [{ x: 2960, y: 1000 }, { x: 2900, y: 60 }, { x: 1500, y: 1770 }, { x: 1500, y: 40 }, { x: 40, y: 300 }, { x: 40, y: 1650 }]);
    return [relays];
  },
  optionals: () => [new AlarmOptional('alarm', 'Destroy every relay before the alarm maxes out', () => relays)],
  extraction: {
    zone: { x: 2650, y: 110, w: 270, h: 220 }, countdown: () => 10,
    finalWave: { points: [{ x: 2960, y: 700 }, { x: 2000, y: 40 }, { x: 2960, y: 1200 }], size: () => 3 },
  },
};

// ---- Mission 10: Operation Iron Fist (Assault + Boss, 5 soldiers) ----
const IRON_FIST: MissionScript = {
  id: 'iron-fist', map: STRONGHOLD_MAP,
  groups: () => [
    { tag: 'inst-a', points: [{ x: 1100, y: 760 }, { x: 1230, y: 900 }, { x: 1300, y: 620 }, k(1050, 600, 'sniper')], aggro: 480 },
    { tag: 'inst-b', points: [{ x: 1650, y: 1350 }, { x: 1800, y: 1380 }, { x: 1520, y: 1500 }, k(1850, 1500, 'armored')], aggro: 480 },
    { tag: 'yard', points: [{ x: 2000, y: 1120 }, { x: 2060, y: 950 }, { x: 2100, y: 800 }, k(1950, 520, 'sniper')], aggro: 460 },
    { tag: 'gate-guards', points: [{ x: 2200, y: 900 }, { x: 2220, y: 1120 }, k(2150, 1000, 'armored')], aggro: 460 },
  ],
  triggers: [
    pastX('outer', 900, [{ x: 900, y: 40 }, { x: 40, y: 700 }, { x: 1500, y: 1980 }], () => 3),
    pastX('yard', 1600, [{ x: 1700, y: 40 }, { x: 2600, y: 1980 }, { x: 2400, y: 300 }], () => 4, { kinds: ['armored', 'rifleman', 'rifleman', 'rifleman'] }),
  ],
  primaries: () => [
    new MultiDestroyObjective('installations', 'Destroy the 2 enemy installations', INSTALLATIONS, 'bunker', 700, 'INSTALLATION'),
    new ReachObjective('arena', 'Storm the stronghold', { x: 2330, y: 880, w: 220, h: 240 }, 'STRONGHOLD'),
    new BossObjective('warden', 'Defeat the Iron Warden', { x: 2980, y: 1000 }),
  ],
  optionals: () => [new NoKiaOptional('no-kia', 'No soldier KIA')],
  boss: { arena: ARENA, gates: [{ x: 2200, y: 1000 }, { x: 2800, y: 1570 }, { x: 2800, y: 420 }] },
  extraction: {
    zone: { x: 1840, y: 760, w: 260, h: 200 }, countdown: () => 8,
    finalWave: { points: [{ x: 1700, y: 40 }, { x: 900, y: 1980 }], size: () => 2 },
  },
};

export const MISSION_SCRIPTS: Record<string, MissionScript> = Object.fromEntries(
  [FIRST_CONTACT, HEAVY_SUPPORT, FIELD_MEDICINE, RED_CANYON, BRING_THEM_HOME, BRIDGEHEAD, PRISON_BREAK, CONVOY_CRUSHER, BLACKOUT, IRON_FIST].map((s) => [s.id, s]),
);
export const scriptFor = (id: string): MissionScript | undefined => MISSION_SCRIPTS[id];
