// Mission maps (v0.4: one per campaign mission). A map is pure geometry + decoration:
// every obstacle is a solid rectangle footprint that blocks movement, bullets and line of
// sight; `height` is purely visual (front-face height for the faked angle). Enemies,
// objectives and triggers live in missions.ts, so a map can be reused by another mission.
import type { Rect, Vec } from './util';

export type ObstacleKind = 'building' | 'wall' | 'crate' | 'hut' | 'rock' | 'sandbag' | 'water' | 'fence' | 'concrete' | 'wire' | 'gate' | 'tree';
export interface Obstacle extends Rect { kind: ObstacleKind; height: number }
export type MapTheme = 'grass' | 'farm' | 'canyon' | 'dusk' | 'river' | 'prison' | 'desert' | 'night' | 'fortress' | 'jungle';
/**
 * v0.6.2: water blocks movement and navigation but not bullets or line of sight (you can shoot across a river).
 * v0.8B: so do barbed-wire perimeters and defensive gates (you can shoot through them, not walk through them).
 */
export const isLowObstacle = (o: Obstacle) => o.kind === 'water' || o.kind === 'wire' || o.kind === 'gate';
/** Decoration only (never collides): floodlights light the night map, radar dishes / flags dress the set. */
export interface MapProp { kind: 'flood' | 'radar' | 'flag' | 'tent'; x: number; y: number; dir?: number }

export interface MapDef {
  id: string;
  w: number;
  h: number;
  theme: MapTheme;
  obstacles: Obstacle[];
  /** Squad spawn point (anchor) and the dashed start box drawn around it. */
  start: Vec;
  startZone: Rect;
  medkits: Vec[];
  rapidFire: Vec[];
  /** Dirt roads drawn into the ground (decoration only). */
  roads: Vec[][];
  /** v0.6.2: bridge decks drawn over water gaps (decoration; the gap itself is what makes it walkable). */
  bridges?: Rect[];
  props?: MapProp[];
}

const B = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'building', height: 52 });
const W = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'wall', height: 18 });
const C = (x: number, y: number): Obstacle => ({ x, y, w: 36, h: 36, kind: 'crate', height: 24 });
const R = (x: number, y: number, w: number, h: number, height = 40): Obstacle => ({ x, y, w, h, kind: 'rock', height });
const S = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'sandbag', height: 14 });
const Wt = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'water', height: 0 });
const F = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'fence', height: 26 });
const K = (x: number, y: number, w: number, h: number, height = 30): Obstacle => ({ x, y, w, h, kind: 'concrete', height });
const Wr = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'wire', height: 0 });
const G = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'gate', height: 0 });
/** v0.9A jungle canopy: solid like a building (blocks movement, rounds and line of sight). */
const Tr = (x: number, y: number, w: number, h: number, height = 44): Obstacle => ({ x, y, w, h, kind: 'tree', height });

// =====================================================================================
// "Comms Outpost" map (v0.1-v0.3 "Secure the Communications Outpost"; now Mission 3).
// Geometry unchanged, so the v0.3 rule checks and tuning carry over.
// =====================================================================================
export const WORLD_W = 3400;
export const WORLD_H = 1500;

export const OBSTACLES: Obstacle[] = [
  // buildings
  B(420, 260, 230, 170),
  B(480, 1000, 200, 190),
  B(1080, 560, 170, 250),
  B(1480, 180, 280, 150),
  B(1560, 1020, 250, 190),
  B(2060, 400, 190, 170),
  B(2980, 600, 200, 300),
  B(2880, 1130, 240, 190),
  // outpost compound walls (gaps on every side)
  W(2400, 600, 150, 18), W(2670, 600, 150, 18),
  W(2400, 942, 150, 18), W(2670, 942, 150, 18),
  W(2400, 600, 18, 120), W(2400, 840, 18, 120),
  W(2802, 600, 18, 120), W(2802, 840, 18, 120),
  { x: 2580, y: 740, w: 70, h: 60, kind: 'hut', height: 64 },
  // field walls
  W(820, 680, 18, 170),
  W(880, 420, 150, 18),
  W(1300, 920, 170, 18),
  W(1880, 680, 18, 190),
  W(1860, 1300, 210, 18),
  W(2220, 1120, 18, 170),
  W(1280, 300, 18, 140),
  W(2600, 300, 200, 18),
  // crate clutter
  C(700, 760), C(736, 760), C(700, 796),
  C(980, 1180), C(1016, 1180),
  C(1360, 420),
  C(1720, 640), C(1720, 676),
  C(2040, 960), C(2076, 960), C(2040, 996),
  C(2300, 300), C(2336, 300),
  C(2860, 440), C(2896, 440),
  C(3050, 1020),
  C(1180, 960),
  C(350, 560),
  C(2480, 1100), C(2516, 1100),
  C(3250, 700),
  C(2700, 1250),
];

export const SQUAD_START: Vec = { x: 170, y: 760 };
export const START_ZONE: Rect = { x: 40, y: 640, w: 240, h: 240 };
export const OUTPOST_ZONE: Rect = { x: 2430, y: 630, w: 360, h: 300 };
export const EXTRACTION_ZONE: Rect = { x: 3080, y: 140, w: 260, h: 220 };

export const DEFENDER_POINTS: Vec[] = [
  { x: 2480, y: 680 }, { x: 2730, y: 680 }, { x: 2480, y: 880 }, { x: 2730, y: 880 },
  { x: 2700, y: 780 }, { x: 2520, y: 780 }, { x: 2610, y: 880 },
];

export const MEDKITS: Vec[] = [{ x: 1300, y: 1060 }, { x: 2140, y: 820 }, { x: 2850, y: 1050 }];
export const RAPIDFIRE: Vec[] = [{ x: 1680, y: 560 }];

export const OUTPOST_TRIGGERS = [
  { id: 'wave1', triggerX: 650, sizeKey: 'wave1Size' as const, candidates: [{ x: 1500, y: 760 }, { x: 1450, y: 1360 }, { x: 1350, y: 110 }] },
  { id: 'wave2', triggerX: 1350, sizeKey: 'wave2Size' as const, candidates: [{ x: 2250, y: 1360 }, { x: 2300, y: 170 }, { x: 2200, y: 780 }] },
  { id: 'wave3', triggerX: 1950, sizeKey: 'wave3Size' as const, candidates: [{ x: 2700, y: 1390 }, { x: 3000, y: 420 }, { x: 3260, y: 1000 }] },
];

export const FINAL_WAVE_POINTS: Vec[] = [
  { x: 3320, y: 920 }, { x: 3300, y: 1360 }, { x: 2600, y: 1420 }, { x: 3350, y: 520 }, { x: 2300, y: 120 },
];

export const OUTPOST_MAP: MapDef = {
  id: 'outpost', w: WORLD_W, h: WORLD_H, theme: 'grass', obstacles: OBSTACLES,
  start: SQUAD_START, startZone: START_ZONE, medkits: MEDKITS, rapidFire: RAPIDFIRE,
  roads: [[{ x: 0, y: 760 }, { x: 900, y: 790 }, { x: 1500, y: 680 }, { x: 2400, y: 780 }, { x: 2900, y: 780 }, { x: 3050, y: 450 }, { x: 3200, y: 250 }]],
};

// =====================================================================================
// Mission 1 "First Contact": small, open farmland. Three patrols in sequence, extraction
// at the top right. Cover is generous; sight lines are short.
// =====================================================================================
export const FIELD_MAP: MapDef = {
  id: 'field', w: 2400, h: 1200, theme: 'grass',
  obstacles: [
    B(480, 220, 220, 150), B(500, 880, 200, 170),
    W(860, 500, 18, 150), C(1000, 720), C(1036, 720),
    B(1120, 220, 180, 190), B(1180, 840, 240, 160),
    W(1300, 560, 18, 120),
    C(1600, 470), C(1636, 470), C(1600, 506),
    W(1520, 720, 170, 18),
    B(1900, 720, 200, 190), W(1780, 280, 18, 150), C(2020, 520),
    B(2260, 600, 120, 200),
    C(330, 330), W(700, 1080, 160, 18),
  ],
  start: { x: 170, y: 620 }, startZone: { x: 40, y: 500, w: 250, h: 240 },
  medkits: [{ x: 1250, y: 720 }, { x: 1950, y: 1020 }],
  rapidFire: [{ x: 930, y: 380 }],
  roads: [[{ x: 0, y: 620 }, { x: 700, y: 650 }, { x: 1200, y: 600 }, { x: 1700, y: 620 }, { x: 2050, y: 430 }, { x: 2230, y: 200 }]],
};

// =====================================================================================
// Mission 2 "Heavy Support": farm valley. The enemy supply depot sits in a sandbag ring at
// the top right; an MG nest guards the north-west field (optional). Extract bottom right.
// =====================================================================================
export const DEPOT_POS: Vec = { x: 2320, y: 440 };
export const VALLEY_MAP: MapDef = {
  id: 'valley', w: 2800, h: 1400, theme: 'farm',
  obstacles: [
    // depot sandbag ring (gaps top, bottom and left)
    S(2180, 330, 110, 16), S(2360, 330, 106, 16),
    S(2180, 530, 110, 16), S(2360, 530, 106, 16),
    S(2180, 346, 16, 64), S(2180, 470, 16, 60), S(2450, 346, 16, 184),
    C(2230, 480), C(2400, 370),
    // MG nest (open to the east)
    W(1060, 190, 190, 18), W(1060, 190, 18, 150), S(1110, 350, 110, 16),
    // farm buildings, walls, crates
    B(480, 480, 220, 160), B(720, 1190, 200, 140), B(1400, 1060, 240, 160),
    B(1650, 260, 200, 150), B(1900, 900, 180, 190), B(2560, 640, 170, 150),
    W(1000, 800, 18, 160), W(1300, 600, 160, 18), W(1800, 690, 18, 150), W(2100, 1010, 180, 18),
    C(900, 1000), C(936, 1000), C(1600, 950), C(2000, 700), C(2036, 700), C(2650, 950),
    C(300, 820), W(2300, 1180, 18, 140),
  ],
  start: { x: 180, y: 1150 }, startZone: { x: 40, y: 1030, w: 260, h: 250 },
  medkits: [{ x: 1250, y: 980 }, { x: 2060, y: 830 }, { x: 1300, y: 320 }],
  rapidFire: [{ x: 1600, y: 520 }],
  roads: [
    [{ x: 0, y: 1150 }, { x: 800, y: 1020 }, { x: 1500, y: 820 }, { x: 2100, y: 600 }, { x: 2320, y: 440 }],
    [{ x: 2320, y: 440 }, { x: 2420, y: 800 }, { x: 2620, y: 1240 }],
  ],
};

// =====================================================================================
// Mission 4 "Red Canyon Ambush": a long west-east canyon with side ravines (top ~2025,
// bottom ~1975) the ambushers pour out of. Rock pillars are the only cover.
// =====================================================================================
export const CANYON_MAP: MapDef = {
  id: 'canyon', w: 3800, h: 1100, theme: 'canyon',
  obstacles: [
    // north cliffs (ravine gap 1950-2100)
    R(0, 0, 700, 200, 60), R(700, 0, 500, 150, 60), R(1200, 0, 400, 230, 60), R(1600, 0, 350, 170, 60),
    R(2100, 0, 600, 190, 60), R(2700, 0, 450, 150, 60), R(3150, 0, 650, 170, 60),
    // south cliffs (ravine gap 1900-2050)
    R(0, 900, 800, 200, 60), R(800, 950, 600, 150, 60), R(1400, 880, 500, 220, 60),
    R(2050, 920, 700, 180, 60), R(2750, 900, 1050, 200, 60),
    // pillars and boulders (cover)
    R(900, 450, 90, 110), R(1350, 300, 120, 80), R(1500, 650, 100, 100), R(1800, 420, 80, 140),
    R(2200, 580, 140, 90), R(2450, 300, 90, 90), R(2700, 650, 100, 110), R(3000, 420, 120, 100),
    R(3300, 680, 90, 90), R(620, 700, 80, 70),
    S(1660, 560, 16, 90), S(2080, 380, 100, 16), S(2560, 520, 16, 90),
    C(1150, 720), C(2350, 760), C(2900, 300),
  ],
  start: { x: 150, y: 560 }, startZone: { x: 30, y: 440, w: 240, h: 250 },
  medkits: [{ x: 1100, y: 640 }, { x: 2300, y: 470 }, { x: 3100, y: 620 }],
  rapidFire: [{ x: 1960, y: 760 }],
  roads: [[{ x: 0, y: 560 }, { x: 900, y: 600 }, { x: 1700, y: 520 }, { x: 2600, y: 560 }, { x: 3600, y: 460 }]],
};

// =====================================================================================
// Mission 5 "Bring Them Home": a village at dusk. The captive is held in a walled compound
// at the top right; the helicopter lands at the top left, across the whole village.
// =====================================================================================
export const CAPTIVE_POS: Vec = { x: 2520, y: 400 };
export const VILLAGE_MAP: MapDef = {
  id: 'village', w: 3000, h: 1600, theme: 'dusk',
  obstacles: [
    // compound walls (gaps top 2530-2620, bottom 2530-2620, left 318-420)
    W(2350, 180, 180, 18), W(2620, 180, 180, 18),
    W(2350, 542, 180, 18), W(2620, 542, 180, 18),
    W(2350, 198, 18, 120), W(2350, 420, 18, 122), W(2782, 198, 18, 344),
    B(2620, 250, 120, 90),
    // village
    B(500, 900, 220, 180), B(900, 1150, 200, 160), B(1300, 850, 180, 200), B(800, 500, 200, 160),
    B(1250, 250, 220, 150), B(1700, 1050, 220, 170), B(1750, 560, 180, 180), B(2200, 900, 200, 160),
    B(2600, 1000, 200, 200), B(520, 380, 160, 140),
    W(1050, 700, 160, 18), W(1550, 350, 18, 160), W(2050, 650, 18, 160), W(1950, 1300, 200, 18),
    W(700, 1250, 18, 140), W(400, 650, 160, 18),
    C(1100, 1000), C(1500, 700), C(2100, 400), C(2136, 400), C(1820, 300), C(650, 760), C(2300, 1250),
  ],
  start: { x: 200, y: 1400 }, startZone: { x: 40, y: 1280, w: 260, h: 260 },
  medkits: [{ x: 1000, y: 1010 }, { x: 2000, y: 820 }, { x: 1150, y: 600 }],
  rapidFire: [{ x: 2260, y: 1130 }],
  roads: [
    [{ x: 0, y: 1400 }, { x: 800, y: 1080 }, { x: 1550, y: 800 }, { x: 2300, y: 620 }, { x: 2575, y: 560 }],
    [{ x: 2575, y: 560 }, { x: 1600, y: 450 }, { x: 900, y: 300 }, { x: 250, y: 230 }],
  ],
};

// =====================================================================================
// v0.6.2 CHAPTER 2 — BEHIND ENEMY LINES
// =====================================================================================

// Mission 6 "Bridgehead": a river runs north-south through the middle; one narrow bridge
// (y 660-780) is the only crossing. The squad comes from the west bank; the enemy holds the
// east bank (sandbag nests, a bunker, snipers on the rise). The control zone is the bridge.
export const BRIDGE_ZONE: Rect = { x: 1640, y: 640, w: 300, h: 160 };
export const BRIDGE_MAP: MapDef = {
  id: 'bridge', w: 3200, h: 1500, theme: 'river',
  obstacles: [
    // the river (gap = the bridge)
    Wt(1700, 0, 160, 660), Wt(1700, 780, 160, 720),
    // west bank: farm buildings, walls, crates (cover on the approach)
    B(420, 250, 220, 160), B(500, 1050, 200, 170), B(1000, 420, 180, 150), B(1050, 1000, 200, 150),
    W(800, 700, 18, 160), W(1250, 560, 150, 18), W(1300, 900, 150, 18), W(250, 640, 140, 18),
    C(1450, 640), C(1450, 676), C(1460, 820), C(700, 500), C(900, 1200), C(1550, 380), C(1580, 1080),
    S(1600, 600, 16, 50), S(1600, 820, 16, 50),
    // east bank bridgehead: sandbag nests either side of the road, then the bunker and the rise
    S(1920, 600, 90, 16), S(1920, 824, 90, 16), S(2100, 560, 16, 80), S(2100, 800, 16, 80),
    K(2350, 380, 160, 110, 40), K(2380, 980, 140, 110, 40),
    R(2650, 560, 110, 90), R(2700, 860, 120, 80), R(2550, 220, 100, 80),
    C(2250, 700), C(2250, 736), C(2900, 650), W(2950, 900, 18, 160), W(2600, 1250, 180, 18),
    B(2900, 1100, 200, 160),
  ],
  start: { x: 170, y: 720 }, startZone: { x: 40, y: 600, w: 250, h: 240 },
  medkits: [{ x: 1150, y: 780 }, { x: 2250, y: 1000 }, { x: 2800, y: 420 }],
  rapidFire: [{ x: 1350, y: 1200 }],
  roads: [[{ x: 0, y: 720 }, { x: 900, y: 730 }, { x: 1700, y: 720 }, { x: 1860, y: 720 }, { x: 2500, y: 740 }, { x: 2850, y: 450 }, { x: 3000, y: 230 }]],
  bridges: [{ x: 1690, y: 656, w: 180, h: 128 }],
};

// Mission 7 "Prison Break": a fenced POW camp. Outer watchtowers cover the approach, the fence has
// west, north and east gates, the holding pen (east) has its own gate. Extraction is at the top left.
export const PRISON_CAPTIVE: Vec = { x: 2640, y: 640 };
export const PRISON_TOWERS: Vec[] = [{ x: 1420, y: 470 }, { x: 1420, y: 1080 }, { x: 2300, y: 380 }, { x: 2800, y: 1150 }];
export const PRISON_MAP: MapDef = {
  id: 'prison', w: 3200, h: 1600, theme: 'prison',
  obstacles: [
    // perimeter fence x 1700-2900, y 300-1260 (gates: west y 700-830, north x 2120-2250, east y 860-980)
    F(1700, 300, 420, 16), F(2250, 300, 650, 16), F(1700, 1244, 1200, 16),
    F(1700, 316, 16, 384), F(1700, 830, 16, 414), F(2884, 316, 16, 544), F(2884, 980, 16, 264),
    // holding pen x 2480-2780, y 520-780 (gate on the west side y 600-700)
    F(2480, 520, 300, 14), F(2480, 766, 300, 14), F(2766, 534, 14, 232), F(2480, 534, 14, 66), F(2480, 700, 14, 66),
    // barracks and the guard house inside the camp
    B(1850, 420, 220, 120), B(1880, 960, 240, 130), B(2250, 1000, 200, 140), B(2550, 980, 180, 120),
    K(2200, 600, 120, 80, 36),
    S(2000, 720, 16, 90), S(2380, 830, 100, 16), C(2150, 820), C(2186, 820), C(2420, 460), C(2600, 420),
    // outside: approach cover, sheds, the treeline rocks
    B(500, 1150, 200, 150), B(600, 300, 180, 150), B(1050, 760, 160, 140),
    W(900, 520, 18, 160), W(1150, 1150, 160, 18), W(1300, 300, 150, 18),
    R(1250, 900, 90, 80, 34), R(1500, 700, 80, 70, 34), R(450, 750, 90, 70, 34), R(800, 1000, 80, 80, 34),
    C(1550, 1000), C(1586, 1000), C(1200, 560), C(350, 520), C(1550, 300),
  ],
  start: { x: 200, y: 1420 }, startZone: { x: 40, y: 1300, w: 260, h: 250 },
  medkits: [{ x: 1150, y: 980 }, { x: 2300, y: 900 }, { x: 900, y: 420 }],
  rapidFire: [{ x: 1950, y: 1150 }],
  roads: [
    [{ x: 0, y: 1420 }, { x: 700, y: 1250 }, { x: 1300, y: 900 }, { x: 1700, y: 765 }, { x: 2300, y: 740 }, { x: 2480, y: 650 }],
    [{ x: 1700, y: 765 }, { x: 1200, y: 500 }, { x: 600, y: 230 }, { x: 250, y: 220 }],
  ],
  props: [{ kind: 'flag', x: 2310, y: 590 }, { kind: 'tent', x: 2050, y: 1150 }],
};

// Mission 8 "Convoy Crusher": a desert canyon road. The convoy enters at the top right and winds
// west, south and back east to exit at the bottom right; the squad starts in the middle.
export const CONVOY_ROUTE: Vec[] = [
  { x: 3390, y: 230 }, { x: 2650, y: 230 }, { x: 2350, y: 420 }, { x: 2350, y: 760 }, { x: 1650, y: 820 },
  { x: 1300, y: 600 }, { x: 700, y: 600 }, { x: 450, y: 900 }, { x: 700, y: 1300 }, { x: 2000, y: 1350 }, { x: 3390, y: 1350 },
];
export const CONVOY_MAP: MapDef = {
  id: 'convoy', w: 3400, h: 1600, theme: 'desert',
  obstacles: [
    // canyon walls (north and south rims, with breaks)
    R(0, 0, 900, 120, 60), R(900, 0, 1300, 90, 60), R(2900, 0, 500, 120, 60),
    R(0, 1500, 1400, 100, 60), R(1400, 1460, 1200, 140, 60), R(2900, 1500, 500, 100, 60),
    // rock islands between the road loops (cover; the road stays clear)
    R(1500, 300, 260, 160), R(800, 820, 220, 160), R(2700, 520, 220, 200), R(1300, 1000, 260, 140),
    R(2000, 1000, 160, 120), R(2900, 900, 180, 160), R(150, 300, 160, 120),
    // roadside barriers and cover
    S(1050, 500, 140, 16), S(1050, 690, 140, 16), S(2420, 560, 16, 120), S(2240, 860, 120, 16),
    S(1150, 1240, 160, 16), S(2350, 1260, 160, 16), S(1800, 690, 16, 70),
    C(1950, 560), C(1986, 560), C(1700, 1150), C(2600, 1150), C(760, 1120), C(3100, 400), C(1100, 360),
    K(2050, 220, 120, 70, 30), K(500, 380, 100, 70, 30),
  ],
  start: { x: 1650, y: 1080 }, startZone: { x: 1520, y: 980, w: 260, h: 220 },
  medkits: [{ x: 1000, y: 1000 }, { x: 2600, y: 900 }, { x: 1700, y: 450 }],
  rapidFire: [{ x: 2150, y: 1180 }],
  roads: [CONVOY_ROUTE],
};

// Mission 9 "Blackout": a communications compound at night. Three relays (north-west, east, south),
// floodlights, a radar building. Start at the west edge, extraction at the top right.
export const RELAY_POINTS: Vec[] = [{ x: 950, y: 420 }, { x: 2500, y: 760 }, { x: 1550, y: 1430 }];
export const BLACKOUT_MAP: MapDef = {
  id: 'blackout', w: 3000, h: 1800, theme: 'night',
  obstacles: [
    // relay pads (sandbag horseshoes, open toward the middle)
    S(860, 330, 180, 16), S(860, 346, 16, 120), S(1024, 346, 16, 120),
    S(2410, 670, 16, 180), S(2410, 670, 180, 16), S(2410, 834, 180, 16),
    S(1460, 1510, 180, 16), S(1460, 1380, 16, 130), S(1624, 1380, 16, 130),
    // radar building, control rooms, generators
    K(1500, 700, 240, 180, 50), B(2100, 300, 220, 150), B(600, 1100, 200, 150), B(2350, 1250, 220, 150),
    K(1950, 1050, 120, 80, 34), K(1100, 900, 120, 80, 34),
    // perimeter walls and cover
    W(400, 600, 18, 250), W(1300, 300, 180, 18), W(2000, 600, 18, 200), W(1000, 1350, 18, 200), W(2700, 1050, 18, 200),
    W(1800, 450, 180, 18), W(800, 800, 160, 18),
    C(1250, 560), C(1286, 560), C(2200, 900), C(1850, 1300), C(700, 600), C(2650, 500), C(1300, 1200), C(2800, 1500),
  ],
  start: { x: 180, y: 1000 }, startZone: { x: 40, y: 880, w: 250, h: 240 },
  medkits: [{ x: 1300, y: 1000 }, { x: 2200, y: 1000 }, { x: 1200, y: 450 }],
  rapidFire: [{ x: 1900, y: 900 }],
  roads: [[{ x: 0, y: 1000 }, { x: 900, y: 1000 }, { x: 1600, y: 1000 }, { x: 2400, y: 1000 }, { x: 2700, y: 450 }, { x: 2800, y: 220 }]],
  props: [
    { kind: 'flood', x: 1000, y: 520 }, { kind: 'flood', x: 2380, y: 760 }, { kind: 'flood', x: 1550, y: 1330 },
    { kind: 'flood', x: 1620, y: 640 }, { kind: 'flood', x: 2200, y: 260 }, { kind: 'flood', x: 700, y: 1060 },
    { kind: 'radar', x: 1620, y: 760 },
  ],
};

// Mission 10 "Operation Iron Fist": the enemy stronghold. Two installations guard the outer yard;
// the central arena (x 2300-3300, y 500-1500; gates west, north and south) is the Iron Warden's.
export const ARENA: Rect = { x: 2316, y: 516, w: 968, h: 968 };
export const ARENA_GATE: Rect = { x: 2150, y: 860, w: 220, h: 280 };
export const INSTALLATIONS: Vec[] = [{ x: 1250, y: 760 }, { x: 1700, y: 1500 }];
export const STRONGHOLD_MAP: MapDef = {
  id: 'stronghold', w: 3600, h: 2000, theme: 'fortress',
  obstacles: [
    // arena walls (west gate y 900-1100, north gate and south gate x 2700-2900)
    K(2300, 500, 400, 16, 44), K(2900, 500, 400, 16, 44), K(2300, 1484, 400, 16, 44), K(2900, 1484, 400, 16, 44),
    K(2300, 516, 16, 384, 44), K(2300, 1100, 16, 384, 44), K(3284, 516, 16, 968, 44),
    // arena cover blocks (rockets respect cover)
    K(2550, 700, 90, 60), K(2950, 700, 90, 60), K(2550, 1240, 90, 60), K(2950, 1240, 90, 60), K(2760, 960, 80, 80, 36),
    // outer yard: installation emplacements (sandbag rings) and defences
    S(1150, 680, 200, 16), S(1150, 840, 200, 16), S(1350, 680, 16, 176),
    S(1600, 1420, 16, 160), S(1600, 1420, 200, 16), S(1600, 1580, 200, 16),
    K(1500, 300, 220, 140, 44), B(800, 1000, 200, 160), B(2000, 300, 200, 140), B(1000, 1700, 220, 140), B(2400, 1700, 220, 140),
    W(1900, 1000, 18, 220), W(1600, 1050, 150, 18), W(600, 600, 160, 18), W(2050, 1600, 18, 200),
    C(1450, 1000), C(1486, 1000), C(1900, 650), C(950, 450), C(2150, 1350), C(2186, 1350), C(700, 1400),
  ],
  start: { x: 220, y: 1500 }, startZone: { x: 60, y: 1380, w: 260, h: 250 },
  medkits: [{ x: 1500, y: 1250 }, { x: 2100, y: 1150 }, { x: 2200, y: 700 }, { x: 900, y: 800 }],
  rapidFire: [{ x: 1700, y: 900 }],
  roads: [[{ x: 0, y: 1500 }, { x: 900, y: 1350 }, { x: 1500, y: 1150 }, { x: 2200, y: 1000 }, { x: 2800, y: 1000 }]],
  props: [{ kind: 'flag', x: 2800, y: 560 }, { kind: 'flag', x: 1550, y: 330 }],
};

// =====================================================================================
// v0.8A CHAPTER 3 — THE RESISTANCE
// =====================================================================================

// Mission 11 "Resistance Rising": an occupied farming village. Three liberation zones (west farmstead, north
// church square, east market) sit 900+ px apart (well beyond the 300 px enemy alert radius, so freeing one
// never wakes the others); the resistance safehouse is in the middle, sandbagged, with the safehouse building
// on its north side. The helicopter lands in the north-east field.
export const SAFEHOUSE_ZONE: Rect = { x: 1350, y: 830, w: 300, h: 220 };
export const SAFEHOUSE_POSTS: Vec[] = [{ x: 1420, y: 900 }, { x: 1580, y: 900 }, { x: 1500, y: 1000 }];
export const VILLAGE_ZONES: { id: string; name: string; short: string; rect: Rect; tag: string }[] = [
  { id: 'farm', name: 'Farmstead', short: 'FARM', rect: { x: 380, y: 560, w: 340, h: 260 }, tag: 'zone-farm' },
  { id: 'church', name: 'Church Square', short: 'CHURCH', rect: { x: 1330, y: 220, w: 340, h: 240 }, tag: 'zone-church' },
  { id: 'market', name: 'Market', short: 'MARKET', rect: { x: 2280, y: 640, w: 340, h: 260 }, tag: 'zone-market' },
];
export const RESISTANCE_MAP: MapDef = {
  id: 'resistance', w: 3000, h: 1800, theme: 'farm',
  obstacles: [
    // safehouse (building north, sandbags with gaps west / east / south)
    B(1400, 700, 200, 110),
    S(1340, 1066, 120, 16), S(1540, 1066, 120, 16), S(1324, 860, 16, 120), S(1660, 860, 16, 120),
    // west farmstead: farmhouse, barn, fences
    B(290, 380, 180, 140), B(760, 600, 150, 170), F(400, 850, 220, 12), F(240, 600, 12, 200), C(470, 640), C(506, 640),
    // north church square: church, walls with gaps
    B(1380, 50, 240, 130), W(1250, 240, 18, 160), W(1750, 240, 18, 160), C(1440, 330), C(1560, 380),
    // east market: stalls and houses
    B(2250, 450, 200, 140), B(2680, 620, 170, 190), B(2300, 960, 180, 130), C(2400, 720), C(2500, 820), C(2436, 720),
    // village houses and walls between the zones
    B(900, 1150, 180, 150), B(1900, 1150, 200, 150), B(950, 250, 170, 130), B(2000, 330, 160, 130), B(600, 1350, 160, 130),
    W(1100, 650, 18, 180), W(1900, 650, 18, 180), W(1150, 1450, 220, 18), W(2200, 1350, 18, 200), W(2650, 1150, 200, 18),
    C(1250, 1000), C(1750, 1000), C(1100, 450), C(2150, 700), C(800, 950), C(2550, 1450),
  ],
  start: { x: 220, y: 1620 }, startZone: { x: 40, y: 1500, w: 260, h: 260 },
  medkits: [{ x: 1000, y: 1000 }, { x: 1950, y: 760 }, { x: 1500, y: 1250 }],
  rapidFire: [{ x: 2100, y: 1100 }],
  roads: [
    [{ x: 0, y: 1620 }, { x: 700, y: 1300 }, { x: 1500, y: 1100 }, { x: 2400, y: 900 }, { x: 3000, y: 800 }],
    [{ x: 550, y: 700 }, { x: 1500, y: 930 }, { x: 1500, y: 340 }],
    [{ x: 1500, y: 930 }, { x: 2200, y: 600 }, { x: 2750, y: 200 }],
  ],
  props: [{ kind: 'tent', x: 1200, y: 1300 }, { kind: 'tent', x: 1760, y: 1240 }],
};

// Mission 12 "Artillery Hunt": a night gun line. Three sandbagged artillery emplacements (west, south-centre,
// east), each watched by searchlights that sweep the approaches; concrete blocks, bunkers and walls give
// alternate routes in the dark. The helicopter lands in the south-east.
export const ARTILLERY_GUNS: Vec[] = [{ x: 800, y: 420 }, { x: 1750, y: 1110 }, { x: 2650, y: 520 }];
export const ARTILLERY_MAP: MapDef = {
  id: 'artillery', w: 3200, h: 1900, theme: 'night',
  obstacles: [
    // gun 1 (west): open to the south
    S(680, 320, 240, 16), S(680, 336, 16, 150), S(904, 336, 16, 150), B(460, 230, 160, 120), W(1100, 300, 18, 220), C(650, 620), C(686, 620),
    // gun 2 (south-centre): open to the north
    S(1630, 1220, 240, 16), S(1630, 1030, 16, 190), S(1854, 1030, 16, 190), K(1400, 1160, 120, 90), B(2000, 1260, 200, 150),
    // gun 3 (east): open to the east
    S(2530, 410, 16, 220), S(2530, 410, 240, 16), S(2530, 614, 240, 16), B(2300, 240, 180, 140), K(2820, 720, 140, 90, 34),
    // cover between the guns
    K(1200, 800, 140, 80, 34), W(1500, 620, 200, 18), B(1300, 330, 200, 140), K(880, 1300, 120, 80, 34), W(600, 1350, 18, 200),
    C(1100, 1500), C(2300, 1000), C(2336, 1000), K(2500, 1350, 140, 90, 34), W(2200, 800, 18, 180), B(2880, 1240, 180, 130),
    W(1950, 500, 18, 200), C(1600, 850), C(2050, 1000), K(400, 900, 120, 80, 34), C(1400, 1600),
  ],
  start: { x: 220, y: 1700 }, startZone: { x: 40, y: 1580, w: 260, h: 260 },
  medkits: [{ x: 1250, y: 1100 }, { x: 2150, y: 1150 }, { x: 1050, y: 650 }],
  rapidFire: [{ x: 2250, y: 650 }],
  roads: [[{ x: 0, y: 1700 }, { x: 900, y: 1500 }, { x: 1750, y: 1450 }, { x: 2600, y: 1500 }, { x: 3200, y: 1700 }], [{ x: 1750, y: 1450 }, { x: 1750, y: 900 }, { x: 2650, y: 700 }]],
  props: [{ kind: 'flood', x: 1750, y: 1500 }, { kind: 'radar', x: 1500, y: 470 }],
};

// =====================================================================================
// v0.8B CHAPTER 3B
// =====================================================================================

// Mission 13 "Hold the Line": the resistance command center in a barbed-wire compound (wire blocks movement,
// not fire). Three openings stay open (north / west / east: the assault routes); three gates (north-west,
// north-east, south) close when the assault starts (HOLD_GATED_MAP: same ground, the gates added as obstacles).
// Turret caches: A in the south-west fields, B on the north-east ridge. The helicopter lands south-east.
export const HOLD_CC: Vec = { x: 1600, y: 940 };
export const HOLD_COMMAND_ZONE: Rect = { x: 1530, y: 1040, w: 140, h: 100 };
export const HOLD_TURRET_SLOTS: Vec[] = [{ x: 1300, y: 790 }, { x: 1900, y: 790 }];
export const HOLD_ALLY_POSTS: Vec[] = [{ x: 1440, y: 860 }, { x: 1760, y: 860 }, { x: 1600, y: 1230 }];
export const HOLD_CACHES: { id: string; name: string; short: string; rect: Rect; tag: string }[] = [
  { id: 'a', name: 'Cache A', short: 'CACHE A', rect: { x: 430, y: 1600, w: 220, h: 180 }, tag: 'cache-a' },
  { id: 'b', name: 'Cache B', short: 'CACHE B', rect: { x: 2590, y: 400, w: 220, h: 190 }, tag: 'cache-b' },
];
export const HOLD_GATES: Obstacle[] = [G(1300, 650, 120, 14), G(1780, 650, 120, 14), G(1520, 1336, 160, 14)];
export const HOLD_WAVE_POINTS = {
  north: [{ x: 1600, y: 40 }, { x: 1250, y: 40 }, { x: 1950, y: 40 }],
  west: [{ x: 40, y: 1000 }, { x: 40, y: 760 }, { x: 40, y: 1240 }],
  east: [{ x: 3160, y: 1000 }, { x: 3160, y: 760 }, { x: 3160, y: 1240 }],
};
const HOLD_OBSTACLES: Obstacle[] = [
  // compound wire (openings: N 1530-1670, W / E 930-1070; gate gaps NW 1300-1420, NE 1780-1900, S 1520-1680)
  Wr(1150, 650, 150, 14), Wr(1420, 650, 110, 14), Wr(1670, 650, 110, 14), Wr(1900, 650, 150, 14),
  Wr(1150, 664, 14, 266), Wr(1150, 1070, 14, 280), Wr(2036, 664, 14, 266), Wr(2036, 1070, 14, 280),
  Wr(1164, 1336, 356, 14), Wr(1680, 1336, 356, 14),
  // compound cover: sandbag nests behind the openings, crates, the supply hut
  S(1430, 760, 80, 16), S(1690, 760, 80, 16), S(1230, 1110, 70, 16), S(1900, 1110, 70, 16),
  C(1260, 1210), C(1296, 1210), C(1900, 1230), { x: 1380, y: 1180, w: 90, h: 70, kind: 'hut', height: 56 },
  // northern approach
  R(1280, 300, 150, 90), R(1790, 330, 130, 80), C(1560, 420), C(1596, 420), W(980, 440, 18, 170), W(2200, 440, 18, 170),
  B(560, 260, 200, 150), K(2350, 220, 120, 70, 30),
  // western approach
  W(880, 880, 18, 220), C(1000, 1150), C(1000, 780), B(520, 900, 170, 140), R(300, 1250, 140, 90),
  // eastern approach
  W(2300, 860, 18, 220), C(2180, 1180), C(2180, 760), B(2560, 940, 170, 140), R(2850, 1250, 140, 90),
  // cache A (south-west): sandbags and a shed
  S(400, 1560, 130, 16), S(680, 1620, 16, 120), B(220, 1680, 130, 110), C(520, 1820),
  // cache B (north-east ridge)
  S(2560, 370, 16, 130), S(2840, 430, 16, 120), B(2900, 200, 160, 120), C(2700, 620),
  // southern fields
  W(1100, 1650, 220, 18), W(2050, 1550, 18, 160), C(1400, 1800), C(2300, 1850), R(800, 1950, 160, 90),
];
export const HOLD_MAP: MapDef = {
  id: 'hold', w: 3200, h: 2200, theme: 'grass',
  obstacles: HOLD_OBSTACLES,
  start: { x: 1600, y: 2050 }, startZone: { x: 1470, y: 1930, w: 260, h: 240 },
  medkits: [{ x: 1600, y: 1250 }, { x: 900, y: 1480 }, { x: 2420, y: 720 }],
  rapidFire: [{ x: 1600, y: 560 }],
  roads: [
    [{ x: 1600, y: 2200 }, { x: 1600, y: 1350 }],
    [{ x: 1600, y: 650 }, { x: 1600, y: 0 }],
    [{ x: 1150, y: 1000 }, { x: 0, y: 1000 }],
    [{ x: 2050, y: 1000 }, { x: 3200, y: 1000 }],
    [{ x: 1600, y: 1500 }, { x: 900, y: 1600 }, { x: 560, y: 1690 }],
    [{ x: 2050, y: 1000 }, { x: 2500, y: 700 }, { x: 2700, y: 500 }],
  ],
  props: [{ kind: 'flag', x: 1660, y: 880 }, { kind: 'tent', x: 1820, y: 1220 }, { kind: 'radar', x: 1540, y: 860 }],
};
/** The same compound with its three gates closed (Mission 13 once the assault starts): collision / nav only; the ground bitmap stays HOLD_MAP's. */
export const HOLD_GATED_MAP: MapDef = { ...HOLD_MAP, id: 'hold-gated', obstacles: [...HOLD_OBSTACLES, ...HOLD_GATES] };

// Mission 14 "Supply Line Sabotage": an enemy supply road at dusk. Three depots (north-west, south, north), the
// truck yard in the west, then the road winds east. Roadside cover sits off the road (the route keeps clear of
// every obstacle; tools/chapter3b.cjs checks it). v0.8B.1: the road no longer ends after the third ambush: past
// the old end (x 3550) it bends south-east through a narrow rocky pass, runs a long southern straight (Ambush 4,
// armored roadblock), then climbs north-east between two ridges (Ambush 5, the final gauntlet) to the new
// extraction field in the far east. The original section (yard to x 3550, Ambushes 1-3) is unchanged.
export const SUPPLY_DEPOTS: Vec[] = [{ x: 700, y: 640 }, { x: 1500, y: 1560 }, { x: 1950, y: 440 }];
export const SUPPLY_ROUTE: Vec[] = [
  // original road (v0.8B), unchanged up to x 3550
  { x: 1250, y: 1000 }, { x: 1700, y: 1000 }, { x: 2050, y: 1250 }, { x: 2550, y: 1250 }, { x: 2850, y: 950 },
  { x: 3150, y: 700 }, { x: 3550, y: 700 },
  // v0.8B.1 extension: east, the rocky pass south, the southern straight, the climb north-east, extraction
  { x: 3900, y: 700 }, { x: 4250, y: 950 }, { x: 4350, y: 1350 }, { x: 4750, y: 1550 }, { x: 5200, y: 1550 },
  { x: 5550, y: 1250 }, { x: 5750, y: 900 }, { x: 6050, y: 800 },
];
/** v0.8B road length (capture point to its old end point at 3800, 700), for the escort-distance comparison. */
export const SUPPLY_ROUTE_V08B = 2845;
export const SUPPLY_EXTRACTION: Rect = { x: 5900, y: 660, w: 300, h: 280 };
export const SUPPLY_MAP: MapDef = {
  id: 'supply', w: 6300, h: 2000, theme: 'dusk',
  obstacles: [
    // depot 1 (north-west)
    S(590, 540, 220, 16), B(400, 420, 150, 120), C(830, 720), C(866, 720),
    // depot 2 (south)
    S(1380, 1450, 16, 130), W(1580, 1660, 220, 18), B(1180, 1640, 150, 120), C(1620, 1450),
    // depot 3 (north)
    B(2080, 280, 180, 130), S(1830, 350, 200, 16), C(1780, 520), C(1816, 520),
    // truck yard (west): sheds and fences around the parked truck, open to the east
    B(980, 860, 120, 110), F(1100, 870, 300, 12), F(1100, 1130, 300, 12), C(1050, 1060),
    // between the depots
    W(1000, 1250, 18, 200), R(300, 1100, 160, 100), K(1650, 760, 120, 70, 30), W(2350, 600, 18, 180),
    // ambush 1 roadside cover (north wall, south rocks)
    W(2080, 1090, 200, 18), R(2200, 1370, 170, 80), C(2420, 1110),
    // roadblock area (cover beside the bend)
    K(2560, 1010, 80, 50, 30), S(2900, 1080, 120, 16), C(2680, 860),
    // ambush 3: ridge rocks north and south of the last straight
    R(3200, 330, 200, 120), R(3260, 960, 170, 100), W(2950, 520, 18, 120), C(3420, 860),
    // the south and the far east
    R(2700, 1600, 220, 120), B(3300, 1400, 180, 130), W(600, 1350, 200, 18), C(150, 1500),
    // v0.8B.1 extension. East of the old end: ridge rocks north of the bend, a shed and crates south of it
    R(3930, 500, 210, 110), B(3700, 900, 150, 110), C(4060, 920), K(4450, 700, 110, 60, 30),
    // the rocky pass (the road runs south between these; about 190 px wide)
    R(4060, 1060, 140, 180, 46), R(4390, 1020, 150, 190, 46), R(4150, 1320, 110, 110, 40),
    // Ambush 4, the southern straight: a wall and rocks on the north side, rocks and a wrecked barrier on the south,
    // a burnt-out car narrowing the road
    W(4800, 1420, 220, 18), R(5060, 1370, 150, 90), C(4720, 1400), R(4830, 1660, 160, 90), C(5110, 1650), C(5146, 1650),
    K(5010, 1596, 90, 36, 26),
    // Ambush 5, the climb: a western ridge and an eastern ridge, a crate line by the final roadblock
    R(5250, 1050, 150, 100, 46), W(5420, 900, 18, 150), C(5440, 1170), R(5780, 1180, 160, 100, 46), W(5900, 960, 18, 150), C(5700, 1290),
    // the far east: a farmhouse, field walls, the extraction field
    B(4600, 250, 200, 140), W(4900, 600, 200, 18), R(5600, 1720, 200, 110), W(6000, 1250, 18, 220), B(6050, 300, 160, 130), C(5650, 620),
  ],
  start: { x: 200, y: 1800 }, startZone: { x: 40, y: 1680, w: 260, h: 260 },
  // v0.8B.1: two more medkits on the extension (one before Ambush 4, one between Ambushes 4 and 5); no truck repairs exist
  medkits: [{ x: 1000, y: 1450 }, { x: 2300, y: 980 }, { x: 3050, y: 1100 }, { x: 4560, y: 1240 }, { x: 5380, y: 1700 }],
  rapidFire: [{ x: 1700, y: 680 }],
  roads: [SUPPLY_ROUTE, [{ x: 0, y: 1850 }, { x: 700, y: 1400 }, { x: 1250, y: 1000 }]],
  props: [{ kind: 'tent', x: 900, y: 1200 }, { kind: 'flag', x: 1130, y: 950 }, { kind: 'radar', x: 2200, y: 250 }, { kind: 'tent', x: 4700, y: 480 }, { kind: 'flag', x: 6080, y: 700 }],
};

// =====================================================================================
// v0.8C Mission 15 "General's Last Stand": Voss's fortress, west to east.
//  - The outer field (x 400-1800): open ground with rocks and walls, the outer defenders by the fortress wall.
//  - The generator annex (north-west, outside the wall): a sandbagged compound whose generator powers the main gate.
//  - The fortress wall (x 1800-1820) runs the full map height: the only way in is the MAIN GATE (y 1100-1300).
//  - The courtyard (x 1820-3000): two communications relays (north, south), barricades and the inner defenders.
//  - The inner wall (x 3000-3020), full height again: the INNER GATE (y 1100-1300) opens once both relays are down.
//  - Voss's command area (x 3020-4400): the arena (cover blocks), barracks north and south whose doors the
//    reinforcements come through, the helipad in the far east.
// The gates are 'gate' obstacles (block movement, not fire); FORTRESS_MAP (the ground bitmap) has none of them, the
// lockdown worlds add them (Mission.lockdown); drawGates draws them live.
// =====================================================================================
export const FORTRESS_MAIN_GATE: Obstacle = G(1800, 1100, 20, 200);
export const FORTRESS_INNER_GATE: Obstacle = G(3000, 1100, 20, 200);
export const FORTRESS_GENERATOR: Vec = { x: 1460, y: 400 };
export const FORTRESS_RELAYS: Vec[] = [{ x: 2380, y: 520 }, { x: 2460, y: 1880 }];
/** Voss's leash (he never leaves it) and where he enters (his headquarters end of the arena). */
export const FORTRESS_ARENA: Rect = { x: 3260, y: 560, w: 1000, h: 1280 };
export const FORTRESS_VOSS: Vec = { x: 4100, y: 1200 };
/** Barracks doors (reinforcements arrive out of view through them). */
export const FORTRESS_CALL_POINTS: Vec[] = [{ x: 3500, y: 160 }, { x: 4100, y: 160 }, { x: 3500, y: 2240 }, { x: 4100, y: 2240 }];
/** The resistance comes in behind the squad, through the courtyard. */
export const FORTRESS_ALLY_ENTRY: Vec[] = [{ x: 2500, y: 1200 }, { x: 2150, y: 1200 }, { x: 1900, y: 1200 }];
export const FORTRESS_EXTRACTION: Rect = { x: 4060, y: 1080, w: 260, h: 240 };
const FORTRESS_OBSTACLES: Obstacle[] = [
  // fortress wall (main gate gap y 1100-1300) and inner wall (inner gate gap y 1100-1300)
  K(1800, 0, 20, 1100, 48), K(1800, 1300, 20, 1100, 48),
  K(3000, 0, 20, 1100, 48), K(3000, 1300, 20, 1100, 48),
  // gatehouse towers either side of both gates
  K(1760, 1040, 80, 60, 56), K(1760, 1300, 80, 60, 56), K(2960, 1040, 80, 60, 56), K(2960, 1300, 80, 60, 56),
  // outer field: rocks, field walls, crates (cover all the way to the wall)
  R(560, 1180, 150, 90), R(820, 1700, 170, 100), W(700, 900, 180, 18), W(1050, 1350, 18, 200), C(1000, 1080),
  R(1250, 1600, 140, 90), W(1300, 960, 200, 18), C(1450, 1250), C(1486, 1250), S(1560, 1120, 16, 140), S(1560, 1420, 16, 120),
  B(380, 600, 200, 150), R(1100, 2050, 200, 110), C(600, 2000),
  // generator annex (north-west, outside the wall): sandbag ring open to the south, a shed
  S(1260, 260, 16, 260), S(1660, 260, 16, 260), S(1276, 260, 384, 16), S(1276, 504, 120, 16), S(1540, 504, 120, 16),
  B(1060, 180, 150, 120), C(1330, 560), C(1600, 600),
  // courtyard: barricades behind the gate, cover around both relays, a central bunker
  S(1960, 1040, 16, 120), S(1960, 1240, 16, 120), K(2200, 1120, 110, 70, 32), K(2560, 1170, 110, 70, 32), S(2680, 1100, 16, 200), K(2880, 1560, 70, 50, 30),
  S(2260, 640, 240, 16), K(2180, 420, 80, 60, 32), C(2560, 420), C(2560, 456),
  S(2340, 1760, 240, 16), K(2640, 1920, 80, 60, 32), C(2280, 1980), C(2316, 1980),
  B(2000, 120, 200, 140), B(2000, 2140, 200, 140), W(2750, 760, 18, 200), W(2750, 1500, 18, 200), C(2150, 860), C(2150, 1560),
  // command area: barracks north and south (doors face the arena), arena cover blocks
  B(3300, 60, 160, 150), B(3700, 60, 300, 150), B(4140, 60, 160, 150),
  B(3300, 2190, 160, 150), B(3700, 2190, 300, 150), B(4140, 2190, 160, 150),
  K(3420, 820, 100, 60, 36), K(3420, 1520, 100, 60, 36), K(3720, 1000, 90, 60, 36), K(3720, 1340, 90, 60, 36),
  K(3980, 760, 100, 60, 36), K(3980, 1580, 100, 60, 36), S(3600, 1170, 16, 70), C(4200, 900), C(4200, 1480),
];
export const FORTRESS_MAP: MapDef = {
  id: 'fortress', w: 4400, h: 2400, theme: 'fortress',
  obstacles: FORTRESS_OBSTACLES,
  start: { x: 220, y: 1500 }, startZone: { x: 60, y: 1380, w: 260, h: 250 },
  // no medkit past the inner gate (no free heal before the boss): the field, the annex, the courtyard
  medkits: [{ x: 900, y: 1300 }, { x: 1460, y: 620 }, { x: 2400, y: 1300 }],
  rapidFire: [{ x: 2400, y: 760 }],
  roads: [[{ x: 0, y: 1500 }, { x: 900, y: 1250 }, { x: 1800, y: 1200 }, { x: 3000, y: 1200 }, { x: 4400, y: 1200 }], [{ x: 1200, y: 1220 }, { x: 1460, y: 560 }]],
  props: [{ kind: 'flag', x: 3900, y: 620 }, { kind: 'flag', x: 1780, y: 1000 }, { kind: 'radar', x: 2200, y: 300 }, { kind: 'tent', x: 3800, y: 1800 }],
};
/** Lockdown worlds (collision / nav only): both gates shut, then only the inner gate. Fully open = FORTRESS_MAP. */
export const FORTRESS_LOCKED: MapDef = { ...FORTRESS_MAP, id: 'fortress-locked', obstacles: [...FORTRESS_OBSTACLES, FORTRESS_MAIN_GATE, FORTRESS_INNER_GATE] };
export const FORTRESS_INNER_LOCKED: MapDef = { ...FORTRESS_MAP, id: 'fortress-inner', obstacles: [...FORTRESS_OBSTACLES, FORTRESS_INNER_GATE] };

// =====================================================================================
// v0.9A CHAPTER 4: Behind Enemy Lines
// =====================================================================================

/**
 * v0.9A dense jungle: the canopy is everything that is not a trail or a clearing. `open` lists the walkable shapes
 * (circles = clearings, capsules = trails); every JUNGLE_CELL px cell whose centre lies outside all of them is canopy,
 * merged into as few rectangles as possible (runs per row, then equal runs down the rows) so line of sight stays cheap.
 * Pure geometry, deterministic.
 */
export type OpenShape = { c: Vec; r: number } | { a: Vec; b: Vec; r: number };
const JUNGLE_CELL = 80;
function segDist(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export const inOpen = (open: OpenShape[], p: Vec) => open.some((o) => ('c' in o ? Math.hypot(p.x - o.c.x, p.y - o.c.y) : segDist(p, o.a, o.b)) <= o.r);
export function jungleCanopy(w: number, h: number, open: OpenShape[]): Obstacle[] {
  const S = JUNGLE_CELL, cols = Math.ceil(w / S), rows = Math.ceil(h / S), out: Obstacle[] = [];
  let active = new Map<string, { c0: number; c1: number; r0: number; n: number }>();
  for (let r = 0; r <= rows; r++) {
    const next = new Map<string, { c0: number; c1: number; r0: number; n: number }>();
    if (r < rows) {
      let c = 0;
      while (c < cols) {
        if (inOpen(open, { x: c * S + S / 2, y: r * S + S / 2 })) { c++; continue; }
        const c0 = c;
        while (c < cols && !inOpen(open, { x: c * S + S / 2, y: r * S + S / 2 })) c++;
        const k = `${c0},${c}`, run = active.get(k);
        if (run) { run.n++; active.delete(k); next.set(k, run); } else next.set(k, { c0, c1: c, r0: r, n: 1 });
      }
    }
    for (const q of active.values()) out.push(Tr(q.c0 * S, q.r0 * S, Math.min(w, q.c1 * S) - q.c0 * S, Math.min(h, (q.r0 + q.n) * S) - q.r0 * S));
    active = next;
  }
  return out;
}

// Mission 16 "Jungle Sweep": the squad lands in the south-west and pushes north-east along winding trails. Clearing A
// (first patrol) -> the trail north to clearing B (second patrol, the first mine, Overwatch's warning) -> the ravine
// east (mines in the trail) -> clearing C (a mine belt in front of the third patrol) -> south-east to clearing D (mines
// between the trail and the fourth patrol) -> the fortified checkpoint (sandbag compound, two watchtowers; mines on its
// west road and north path, the south path is clean) -> the helicopter clearing north-east. A northern detour (clearing
// N, one mine, a small patrol) bypasses the ravine; a northern track joins clearing C to the checkpoint's north path.
// Trail stubs reach the map edges (where extraction pressure walks in).
const JUNGLE_OPEN: OpenShape[] = [
  // clearings: start, A, B, N, C, D, the checkpoint (two circles), the helicopter
  { c: { x: 230, y: 2290 }, r: 270 }, { c: { x: 1000, y: 2120 }, r: 300 }, { c: { x: 1250, y: 1230 }, r: 300 },
  { c: { x: 1750, y: 520 }, r: 250 }, { c: { x: 2300, y: 1120 }, r: 300 }, { c: { x: 3000, y: 1900 }, r: 300 },
  { c: { x: 3950, y: 1150 }, r: 430 }, { c: { x: 4280, y: 1150 }, r: 380 }, { c: { x: 4450, y: 430 }, r: 260 },
  // trails: start -> A -> B; the ravine B -> C; the northern detour B -> N -> C
  { a: { x: 230, y: 2290 }, b: { x: 1000, y: 2120 }, r: 140 }, { a: { x: 1050, y: 1950 }, b: { x: 1200, y: 1400 }, r: 140 },
  { a: { x: 1450, y: 1150 }, b: { x: 1850, y: 1010 }, r: 125 }, { a: { x: 1850, y: 1010 }, b: { x: 2100, y: 1080 }, r: 125 },
  { a: { x: 1250, y: 1000 }, b: { x: 1450, y: 650 }, r: 110 }, { a: { x: 1450, y: 650 }, b: { x: 1600, y: 560 }, r: 110 },
  { a: { x: 1900, y: 560 }, b: { x: 2350, y: 700 }, r: 110 }, { a: { x: 2350, y: 700 }, b: { x: 2330, y: 900 }, r: 110 },
  // C -> D, D -> the checkpoint's west road, the northern track C -> the checkpoint's north path, D -> its south path
  { a: { x: 2450, y: 1300 }, b: { x: 2700, y: 1550 }, r: 125 }, { a: { x: 2700, y: 1550 }, b: { x: 2850, y: 1750 }, r: 125 },
  { a: { x: 3200, y: 1800 }, b: { x: 3450, y: 1500 }, r: 125 }, { a: { x: 3450, y: 1500 }, b: { x: 3600, y: 1250 }, r: 130 },
  { a: { x: 2550, y: 1000 }, b: { x: 3100, y: 850 }, r: 110 }, { a: { x: 3100, y: 850 }, b: { x: 3620, y: 860 }, r: 110 },
  { a: { x: 3250, y: 2000 }, b: { x: 3800, y: 1680 }, r: 115 },
  // the checkpoint -> the helicopter; trail stubs to the edges (east, north, south-east, south)
  { a: { x: 4250, y: 800 }, b: { x: 4400, y: 560 }, r: 140 },
  { a: { x: 4450, y: 430 }, b: { x: 4800, y: 300 }, r: 100 }, { a: { x: 3950, y: 780 }, b: { x: 3950, y: 0 }, r: 100 },
  { a: { x: 4300, y: 1450 }, b: { x: 4800, y: 1800 }, r: 100 }, { a: { x: 3000, y: 1900 }, b: { x: 3000, y: 2600 }, r: 100 },
];
/** Mine positions (mines.ts; Mission 16). None within 900 px of the landing zone; every one sits on open ground. */
export const JUNGLE_MINES: Vec[] = [
  // the first mine: west side of clearing B, beside (not on) the trail's line into the clearing
  { x: 1080, y: 1330 },
  // the ravine: one in the middle of the trail, one by its south edge before clearing C
  { x: 1700, y: 1062 }, { x: 1960, y: 1100 },
  // clearing C: a belt across the ravine mouth, in front of the third patrol (lanes between them)
  { x: 2190, y: 990 }, { x: 2215, y: 1135 }, { x: 2185, y: 1275 },
  // the trail C -> D
  { x: 2600, y: 1450 },
  // clearing D: between the trail and the fourth patrol
  { x: 2960, y: 1860 }, { x: 3070, y: 1815 }, { x: 3030, y: 1965 },
  // the checkpoint: two on the west road, one on the north path (the south path is clean)
  { x: 3700, y: 1120 }, { x: 3770, y: 1215 }, { x: 3800, y: 860 },
  // the northern detour and the northern track
  { x: 2050, y: 640 }, { x: 3300, y: 820 },
];
export const JUNGLE_CHECKPOINT: Rect = { x: 3860, y: 940, w: 380, h: 420 };
export const JUNGLE_EXTRACTION: Rect = { x: 4330, y: 300, w: 260, h: 240 };
/** Extraction pressure walks in along the edge trails. */
export const JUNGLE_PRESSURE: Vec[] = [{ x: 3950, y: 40 }, { x: 4760, y: 1780 }, { x: 4760, y: 300 }, { x: 3000, y: 2560 }];
const JUNGLE_COVER: Obstacle[] = [
  // natural cover in the clearings: tree clumps, rocks, fallen logs (crates)
  Tr(900, 2000, 70, 60, 40), R(1120, 2200, 90, 50, 30), C(860, 2230), Tr(1300, 1300, 70, 70, 40), R(1140, 1120, 80, 50, 30),
  Tr(1680, 440, 80, 70, 40), R(1820, 600, 90, 50, 30), Tr(2380, 1030, 70, 60, 40), R(2420, 1250, 90, 50, 30), C(2260, 1210),
  Tr(2920, 2000, 70, 60, 40), R(3150, 1880, 80, 50, 30), C(3080, 2080), C(3116, 2080),
  // the checkpoint compound (x 3880-4220, y 960-1340): sandbags with gaps west (the road), north and south, a concrete
  // back wall, a bunker and crates inside; concrete blocks and rocks across the clearing in front of it
  S(3880, 960, 120, 16), S(4100, 960, 120, 16), S(3880, 1324, 120, 16), S(4100, 1324, 120, 16),
  S(3880, 976, 16, 110), S(3880, 1214, 16, 110), K(4204, 976, 16, 348, 34), B(4060, 1110, 100, 80), C(3960, 1060), C(3996, 1060), C(3980, 1250),
  K(3620, 1010, 90, 50, 32), K(3640, 1310, 90, 50, 32), R(3640, 820, 110, 60, 32), R(3700, 1520, 110, 60, 32), S(3760, 1600, 120, 16),
  // the helicopter clearing: a fuel drum stack and rocks at its edge
  C(4560, 560), C(4596, 560), R(4300, 330, 70, 50, 30),
];
export const JUNGLE_MAP: MapDef = {
  id: 'jungle', w: 4800, h: 2600, theme: 'jungle',
  obstacles: [...jungleCanopy(4800, 2600, JUNGLE_OPEN), ...JUNGLE_COVER],
  start: { x: 230, y: 2300 }, startZone: { x: 100, y: 2170, w: 260, h: 260 },
  medkits: [{ x: 1180, y: 2100 }, { x: 1300, y: 1420 }, { x: 2380, y: 1380 }, { x: 3180, y: 1720 }, { x: 3560, y: 1420 }],
  rapidFire: [{ x: 2330, y: 860 }],
  roads: [
    [{ x: 0, y: 2300 }, { x: 600, y: 2230 }, { x: 1000, y: 2120 }, { x: 1120, y: 1700 }, { x: 1250, y: 1300 }, { x: 1500, y: 1140 }, { x: 1850, y: 1010 }, { x: 2300, y: 1120 }, { x: 2650, y: 1500 }, { x: 3000, y: 1880 }, { x: 3400, y: 1560 }, { x: 3600, y: 1220 }, { x: 4050, y: 1150 }, { x: 4330, y: 800 }, { x: 4450, y: 430 }],
    [{ x: 1250, y: 1230 }, { x: 1450, y: 650 }, { x: 1750, y: 520 }, { x: 2350, y: 700 }, { x: 2300, y: 1120 }],
    [{ x: 2300, y: 1120 }, { x: 2800, y: 930 }, { x: 3600, y: 860 }, { x: 4000, y: 1050 }],
  ],
  props: [{ kind: 'flag', x: 4140, y: 1080 }, { kind: 'tent', x: 4120, y: 1280 }, { kind: 'radar', x: 4170, y: 1010 }],
};
/** Mission 16 rule checks: the open ground (inOpen) and the landing zone. */
export const JUNGLE_OPEN_SHAPES = JUNGLE_OPEN;
