// Mission maps (v0.4: one per campaign mission). A map is pure geometry + decoration:
// every obstacle is a solid rectangle footprint that blocks movement, bullets and line of
// sight; `height` is purely visual (front-face height for the faked angle). Enemies,
// objectives and triggers live in missions.ts, so a map can be reused by another mission.
import type { Rect, Vec } from './util';

export type ObstacleKind = 'building' | 'wall' | 'crate' | 'hut' | 'rock' | 'sandbag' | 'water' | 'fence' | 'concrete';
export interface Obstacle extends Rect { kind: ObstacleKind; height: number }
export type MapTheme = 'grass' | 'farm' | 'canyon' | 'dusk' | 'river' | 'prison' | 'desert' | 'night' | 'fortress';
/** v0.6.2: water blocks movement and navigation but not bullets or line of sight (you can shoot across a river). */
export const isLowObstacle = (o: Obstacle) => o.kind === 'water';
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
