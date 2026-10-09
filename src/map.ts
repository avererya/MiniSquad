// Mission map: "Secure the Communications Outpost".
// Every obstacle is a solid rectangle footprint that blocks movement, bullets and line of sight.
// `height` is purely visual (front-face height for the faked angle).
import type { Rect, Vec } from './util';

export type ObstacleKind = 'building' | 'wall' | 'crate' | 'hut';
export interface Obstacle extends Rect { kind: ObstacleKind; height: number }

export interface SpawnTrigger {
  id: string;
  triggerX: number; // fires when the squad centre passes this x
  sizeKey: 'wave1Size' | 'wave2Size' | 'wave3Size';
  candidates: Vec[]; // spawn points; an off-screen one is chosen
}

export const WORLD_W = 3400;
export const WORLD_H = 1500;

const B = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'building', height: 52 });
const W = (x: number, y: number, w: number, h: number): Obstacle => ({ x, y, w, h, kind: 'wall', height: 18 });
const C = (x: number, y: number): Obstacle => ({ x, y, w: 36, h: 36, kind: 'crate', height: 24 });

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

export const TRIGGERS: SpawnTrigger[] = [
  { id: 'wave1', triggerX: 650, sizeKey: 'wave1Size', candidates: [{ x: 1500, y: 760 }, { x: 1450, y: 1360 }, { x: 1350, y: 110 }] },
  { id: 'wave2', triggerX: 1350, sizeKey: 'wave2Size', candidates: [{ x: 2250, y: 1360 }, { x: 2300, y: 170 }, { x: 2200, y: 780 }] },
  { id: 'wave3', triggerX: 1950, sizeKey: 'wave3Size', candidates: [{ x: 2700, y: 1390 }, { x: 3000, y: 420 }, { x: 3260, y: 1000 }] },
];

export const FINAL_WAVE_POINTS: Vec[] = [
  { x: 3320, y: 920 }, { x: 3300, y: 1360 }, { x: 2600, y: 1420 }, { x: 3350, y: 520 }, { x: 2300, y: 120 },
];
