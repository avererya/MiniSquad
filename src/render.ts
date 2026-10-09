// Canvas rendering. Top-down with a faked slight angle: everything is
// depth-sorted by ground Y, buildings show a front face, characters have
// oversized heads.
import { CFG } from './config';
import type { Game } from './game';
import type { Unit } from './unit';
import type { MapDef, Obstacle } from './map';
import { grenadePos } from './abilities';
import { VIEW_W, VIEW_H } from './view';
import { DEG, clamp, type Rect } from './util';
import { CLASSES, type SoldierClassId } from './classes';

const CHAR_SCALE = 1.3; // visual only; collision radius comes from config
const COL = {
  squadHelmet: '#2f7ff0', squadBody: '#1d55b0',
  enemyHelmet: '#e3412f', enemyBody: '#9c2b20',
  skin: '#f3c99f', gun: '#2a2a2a',
  squadBullet: '#fff7a8', enemyBullet: '#ff6a3a',
};

// Ground palettes per map theme (reused art, recoloured; no new assets).
const THEMES = {
  grass: { base: '#86a35f', patchA: 'rgba(110,140,70,0.35)', patchB: 'rgba(160,170,95,0.3)', dirt: 'rgba(170,140,95,0.35)', road: 'rgba(176,150,105,0.55)', blade: 'rgba(60,90,40,0.25)', tint: '' },
  farm: { base: '#93a75e', patchA: 'rgba(150,150,70,0.35)', patchB: 'rgba(120,150,70,0.3)', dirt: 'rgba(160,125,80,0.4)', road: 'rgba(170,140,95,0.6)', blade: 'rgba(80,95,40,0.25)', tint: '' },
  canyon: { base: '#b7764c', patchA: 'rgba(160,90,55,0.4)', patchB: 'rgba(205,140,95,0.3)', dirt: 'rgba(120,70,45,0.35)', road: 'rgba(215,170,120,0.45)', blade: 'rgba(110,60,35,0.25)', tint: '' },
  dusk: { base: '#6f8a58', patchA: 'rgba(80,110,60,0.4)', patchB: 'rgba(120,130,80,0.3)', dirt: 'rgba(130,110,80,0.35)', road: 'rgba(150,130,95,0.55)', blade: 'rgba(40,60,30,0.3)', tint: 'rgba(40,30,80,0.18)' },
} as const;

const grounds = new Map<string, HTMLCanvasElement>();
function buildGround(map: MapDef): HTMLCanvasElement {
  const W = map.w, H = map.h, T = THEMES[map.theme];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = T.base;
  g.fillRect(0, 0, W, H);
  // deterministic patchy grass / dirt
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const k = (W * H) / (3400 * 1500);
  for (let i = 0; i < 900 * k; i++) {
    const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 70;
    g.fillStyle = rnd() < 0.5 ? T.patchA : T.patchB;
    g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 120 * k; i++) {
    const x = rnd() * W, y = rnd() * H, r = 30 + rnd() * 60;
    g.fillStyle = T.dirt;
    g.beginPath(); g.ellipse(x, y, r, r * 0.5, rnd(), 0, Math.PI * 2); g.fill();
  }
  // dirt roads (smoothed polylines)
  g.strokeStyle = T.road; g.lineWidth = 70; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const road of map.roads) {
    g.beginPath(); g.moveTo(road[0].x, road[0].y);
    for (let i = 1; i < road.length - 1; i++) {
      const mx = (road[i].x + road[i + 1].x) / 2, my = (road[i].y + road[i + 1].y) / 2;
      g.quadraticCurveTo(road[i].x, road[i].y, mx, my);
    }
    const last = road[road.length - 1]; g.lineTo(last.x, last.y);
    g.stroke();
  }
  for (let i = 0; i < 2500 * k; i++) {
    g.fillStyle = T.blade;
    g.fillRect(rnd() * W, rnd() * H, 2, 4);
  }
  if (T.tint) { g.fillStyle = T.tint; g.fillRect(0, 0, W, H); }
  // obstacle contact shadows
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (const o of map.obstacles) g.fillRect(o.x + 4, o.y + 4, o.w, o.h + 6);
  return c;
}

export function render(ctx: CanvasRenderingContext2D, game: Game) {
  const map = game.map;
  let ground = grounds.get(map.id);
  if (!ground) { ground = buildGround(map); grounds.set(map.id, ground); }
  const OBSTACLES = map.obstacles;
  const shake = game.fx.shake;
  const ox = Math.round(-game.cam.x + VIEW_W / 2 + (shake ? (Math.random() - 0.5) * shake : 0));
  const oy = Math.round(-game.cam.y + VIEW_H / 2 + (shake ? (Math.random() - 0.5) * shake : 0));

  ctx.save();
  ctx.translate(ox, oy);
  const vx = game.cam.x - VIEW_W / 2, vy = game.cam.y - VIEW_H / 2;
  ctx.drawImage(ground, vx - 20, vy - 20, VIEW_W + 40, VIEW_H + 40, vx - 20, vy - 20, VIEW_W + 40, VIEW_H + 40);

  drawZones(ctx, game);
  for (const s of game.scorches) {
    ctx.fillStyle = 'rgba(40,30,20,0.35)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  drawPickups(ctx, game);
  drawReviveCircles(ctx, game);
  if (CFG.feel.showCones) drawCones(ctx, game);
  drawTargetingGround(ctx, game);

  // depth-sorted scene
  type Item = { y: number; draw: () => void };
  const items: Item[] = [];
  const inView = (r: Rect) => r.x + r.w > vx - 80 && r.x < vx + VIEW_W + 80 && r.y + r.h > vy - 80 && r.y - 80 < vy + VIEW_H + 80;
  for (const o of OBSTACLES) if (inView(o)) items.push({ y: o.y + o.h, draw: () => drawObstacle(ctx, o, game.clock) });
  for (const u of [...game.soldiers, ...game.npcs, ...game.enemies]) items.push({ y: u.pos.y, draw: () => u.structure ? drawStructure(ctx, u, game) : u.npc ? drawCaptive(ctx, u, game) : drawUnit(ctx, u, game) });
  for (const g of game.grenades) {
    const p = grenadePos(g);
    items.push({ y: p.y, draw: () => drawGrenade(ctx, p.x, p.y, p.z, g.landed, game.clock) });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  // squad silhouettes so soldiers behind buildings stay visible
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 2;
  for (const s of game.soldiers) {
    if (s.state === 'kia') continue;
    const hidden = OBSTACLES.some((o) => o.y + o.h > s.pos.y && s.pos.x + 12 > o.x && s.pos.x - 12 < o.x + o.w && s.pos.y - 45 < o.y + o.h && s.pos.y > o.y - o.height);
    if (!hidden) continue;
    ctx.beginPath(); ctx.arc(s.pos.x, s.pos.y - 34, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(s.pos.x - 9, s.pos.y - 22, 18, 20);
  }
  ctx.restore();

  drawProjectiles(ctx, game);
  drawFx(ctx, game);
  game.mission.extraction.draw(ctx, game);
  drawOverheads(ctx, game);
  ctx.restore();

  // ---- screen space ----
  drawOffscreenArrows(ctx, game);
  if (game.hurtFlash > 0) {
    const a = game.hurtFlash * 1.4;
    const grd = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.65);
    grd.addColorStop(0, 'rgba(255,0,0,0)');
    grd.addColorStop(1, `rgba(220,0,0,${a * 0.5})`);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  game.input.drawJoystick(ctx);
  drawBanners(ctx, game);
  if (game.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    bigText(ctx, 'PAUSED (P)', VIEW_W / 2, VIEW_H / 2, 48, '#fff');
  }
}

// ---------------------------------------------------------------------------

function drawZones(ctx: CanvasRenderingContext2D, game: Game) {
  const t = game.clock;
  const m = game.mission;
  // start
  const sz = game.map.startZone;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2;
  ctx.strokeRect(sz.x, sz.y, sz.w, sz.h);
  ctx.setLineDash([]);
  // objective zones (outpost, advance line, captive ring), wrecks
  m.draw(ctx, game);
  // extraction (helipad): live only once every primary objective is complete
  const z = m.extraction.zone;
  const live = m.inExtraction;
  const pulse = live ? 0.5 + 0.5 * Math.sin(t * 5) : 0;
  ctx.fillStyle = live ? `rgba(120,255,140,${0.12 + pulse * 0.15})` : 'rgba(80,80,80,0.15)';
  ctx.fillRect(z.x, z.y, z.w, z.h);
  ctx.strokeStyle = live ? '#7dff8a' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = live ? 4 : 2;
  ctx.strokeRect(z.x, z.y, z.w, z.h);
  ctx.strokeStyle = live ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(z.x + z.w / 2, z.y + z.h / 2, 60, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('H', z.x + z.w / 2, z.y + z.h / 2 + 2);
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle, clock: number) {
  const H = o.height;
  let roof = '#b9a68a', face = '#8a755b', edge = '#5d4c3a';
  if (o.kind === 'wall') { roof = '#b4b0a6'; face = '#86827a'; edge = '#5b5852'; }
  else if (o.kind === 'rock') { roof = '#a8613d'; face = '#7b4026'; edge = '#4f2716'; }
  else if (o.kind === 'sandbag') { roof = '#c8b27a'; face = '#9b8656'; edge = '#6b5a35'; }
  else if (o.kind === 'crate') { roof = '#c99a55'; face = '#94683a'; edge = '#5e4020'; }
  else if (o.kind === 'hut') { roof = '#7f8c6a'; face = '#5d6a4c'; edge = '#38412c'; }
  // front face: from roof bottom down to footprint bottom
  ctx.fillStyle = face;
  ctx.fillRect(o.x, o.y + o.h - H, o.w, H);
  // roof (footprint lifted by H)
  ctx.fillStyle = roof;
  ctx.fillRect(o.x, o.y - H, o.w, o.h);
  ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.strokeRect(o.x + 1, o.y - H + 1, o.w - 2, o.h - 2);
  ctx.strokeRect(o.x + 1, o.y + o.h - H, o.w - 2, H - 1);
  if (o.kind === 'building') {
    // windows + door on the front face
    ctx.fillStyle = '#3d3a35';
    const n = Math.max(1, Math.floor(o.w / 60));
    for (let i = 0; i < n; i++) {
      const wx = o.x + ((i + 0.5) * o.w) / n - 10;
      ctx.fillRect(wx, o.y + o.h - H + 12, 20, 14);
    }
    ctx.fillStyle = '#5a3f2a';
    ctx.fillRect(o.x + o.w / 2 - 10, o.y + o.h - 26, 20, 26);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
    for (let yy = o.y - H + 12; yy < o.y + o.h - H; yy += 12) {
      ctx.beginPath(); ctx.moveTo(o.x + 3, yy); ctx.lineTo(o.x + o.w - 3, yy); ctx.stroke();
    }
  } else if (o.kind === 'rock') {
    // strata lines + a few cracks
    ctx.strokeStyle = 'rgba(60,25,10,0.35)'; ctx.lineWidth = 2;
    for (let yy = o.y + o.h - H + 10; yy < o.y + o.h - 4; yy += 13) { ctx.beginPath(); ctx.moveTo(o.x + 3, yy); ctx.lineTo(o.x + o.w - 3, yy + 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,220,180,0.18)';
    for (let xx = o.x + 14; xx < o.x + o.w - 8; xx += 37) { ctx.beginPath(); ctx.moveTo(xx, o.y - H + 6); ctx.lineTo(xx + 8, o.y - H + Math.min(o.h - 6, 30)); ctx.stroke(); }
  } else if (o.kind === 'sandbag') {
    ctx.strokeStyle = 'rgba(80,60,30,0.45)'; ctx.lineWidth = 1;
    const vertical = o.h > o.w;
    if (vertical) for (let yy = o.y - H + 10; yy < o.y + o.h - H; yy += 12) { ctx.beginPath(); ctx.moveTo(o.x + 2, yy); ctx.lineTo(o.x + o.w - 2, yy); ctx.stroke(); }
    else for (let xx = o.x + 12; xx < o.x + o.w; xx += 14) { ctx.beginPath(); ctx.moveTo(xx, o.y - H + 2); ctx.lineTo(xx, o.y + o.h - 2); ctx.stroke(); }
  } else if (o.kind === 'crate') {
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y - H); ctx.lineTo(o.x + o.w, o.y + o.h - H);
    ctx.moveTo(o.x + o.w, o.y - H); ctx.lineTo(o.x, o.y + o.h - H);
    ctx.stroke();
  } else if (o.kind === 'hut') {
    // comms antenna
    const ax = o.x + o.w / 2, ay = o.y + o.h / 2 - H;
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - 70); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ax - 14, ay); ctx.lineTo(ax, ay - 70); ctx.lineTo(ax + 14, ay); ctx.stroke();
    ctx.fillStyle = Math.sin(clock * 6) > 0 ? '#ff3b3b' : '#661111';
    ctx.beginPath(); ctx.arc(ax, ay - 72, 4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPickups(ctx: CanvasRenderingContext2D, game: Game) {
  for (const p of game.pickups) {
    const bob = Math.sin(p.bob * 3) * 3;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(p.pos.x, p.pos.y + 4, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    const y = p.pos.y - 10 + bob;
    ctx.fillStyle = p.type.color; ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    ctx.fillRect(p.pos.x - 12, y - 10, 24, 20); ctx.strokeRect(p.pos.x - 12, y - 10, 24, 20);
    if (p.type.kind === 'medkit') {
      ctx.fillStyle = '#e02828';
      ctx.fillRect(p.pos.x - 3, y - 7, 6, 14); ctx.fillRect(p.pos.x - 7, y - 3, 14, 6);
    } else {
      ctx.fillStyle = '#222'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.type.label, p.pos.x, y + 1);
    }
  }
}

function drawReviveCircles(ctx: CanvasRenderingContext2D, game: Game) {
  const R = CFG.revive;
  for (const s of [...game.soldiers, ...game.npcs]) {
    if (s.state !== 'downed') continue;
    const pulse = 0.5 + 0.5 * Math.sin(game.clock * 8);
    ctx.fillStyle = s.reviving ? 'rgba(120,255,140,0.15)' : `rgba(255,60,60,${0.08 + 0.1 * pulse})`;
    ctx.beginPath(); ctx.ellipse(s.pos.x, s.pos.y, R.radius, R.radius, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = s.reviving ? 'rgba(120,255,140,0.8)' : 'rgba(255,90,90,0.8)';
    ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.pos.x, s.pos.y, R.radius, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawCones(ctx: CanvasRenderingContext2D, game: Game) {
  for (const s of game.soldiers) {
    if (!s.active || !s.target) continue;
    const half = (s.cone * DEG) / 2;
    const L = s.stats.range * 0.55;
    const moving = s.moveFrac > 0.15;
    ctx.fillStyle = moving ? 'rgba(255,150,60,0.16)' : 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(s.pos.x, s.pos.y);
    ctx.arc(s.pos.x, s.pos.y, L, s.aim - half, s.aim + half);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = moving ? 'rgba(255,150,60,0.35)' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawTargetingGround(ctx: CanvasRenderingContext2D, game: Game) {
  const s = game.targeting;
  const tp = game.targetPoint();
  if (!s || !s.ability || !tp) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.arc(s.pos.x, s.pos.y, s.ability.range(), 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s.pos.x, s.pos.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
  ctx.setLineDash([]);
  const r = s.ability.previewRadius();
  ctx.fillStyle = 'rgba(255,90,40,0.22)'; ctx.strokeStyle = 'rgba(255,120,60,0.95)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tp.x - 8, tp.y); ctx.lineTo(tp.x + 8, tp.y); ctx.moveTo(tp.x, tp.y - 8); ctx.lineTo(tp.x, tp.y + 8); ctx.stroke();
}

function drawGrenade(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, landed: boolean, clock: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3d4a2a';
  ctx.beginPath(); ctx.arc(x, y - 5 - z, 5, 0, Math.PI * 2); ctx.fill();
  if (landed && Math.sin(clock * 40) > 0) {
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath(); ctx.arc(x, y - 8 - z, 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawUnit(ctx: CanvasRenderingContext2D, u: Unit, game: Game) {
  const sq = u.team === 'squad';
  const helmet = sq ? COL.squadHelmet : COL.enemyHelmet;
  const body = sq ? COL.squadBody : COL.enemyBody;
  const { x, y } = u.pos;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(x, y + 1, 11, 5, 0, 0, Math.PI * 2); ctx.fill();

  if (u.state === 'downed' || u.state === 'kia') {
    const kia = u.state === 'kia';
    ctx.save();
    ctx.translate(x, y); ctx.scale(CHAR_SCALE, CHAR_SCALE); ctx.translate(-x, -y);
    if (kia) ctx.globalAlpha = 0.55;
    ctx.fillStyle = kia ? '#555' : body;
    ctx.fillRect(x - 12, y - 8, 20, 10);
    ctx.fillStyle = kia ? '#888' : COL.skin;
    ctx.beginPath(); ctx.arc(x + 12, y - 4, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = kia ? '#666' : helmet;
    ctx.beginPath(); ctx.arc(x + 13, y - 4, 8, -Math.PI / 2, Math.PI / 2); ctx.fill();
    ctx.restore();
    if (!kia) {
      const pulse = 0.5 + 0.5 * Math.sin(game.clock * 9);
      ctx.strokeStyle = `rgba(255,40,40,${0.5 + 0.5 * pulse})`;
      ctx.lineWidth = 3 + pulse * 3;
      ctx.beginPath(); ctx.ellipse(x, y - 4, 30 + pulse * 8, 20 + pulse * 5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    return;
  }

  if (u.suppressing) {
    // Suppressive Fire: pulsing orange ring on the ground
    const p = 0.5 + 0.5 * Math.sin(game.clock * 14);
    ctx.strokeStyle = `rgba(255,160,50,${0.55 + 0.4 * p})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y, 22 + p * 4, 10 + p * 2, 0, 0, Math.PI * 2); ctx.stroke();
  }
  const sc = CHAR_SCALE * (u.classDef?.id === 'heavy' ? 1.06 : 1);
  ctx.save();
  ctx.translate(x, y); ctx.scale(sc, sc); ctx.translate(-x, -y);
  drawStanding(ctx, u, x, y, helmet, body);
  ctx.restore();
}

const GREEN_CROSS = '#2fb158';
/** Generic first-aid mark: green cross on white (deliberately not the red-on-white emblem). */
function medMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#f4f4f4';
  roundRect(ctx, cx - s, cy - s, s * 2, s * 2, s * 0.4); ctx.fill();
  ctx.fillStyle = GREEN_CROSS;
  ctx.fillRect(cx - s * 0.28, cy - s * 0.75, s * 0.56, s * 1.5);
  ctx.fillRect(cx - s * 0.75, cy - s * 0.28, s * 1.5, s * 0.56);
}

function drawStanding(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, helmet: string, body: string) {
  const moving = u.moveFrac > 0.08;
  const bob = moving ? Math.sin(u.walkPhase) : 0;
  const lift = moving ? Math.abs(Math.cos(u.walkPhase)) * 1.5 : 0;
  // legs
  ctx.fillStyle = '#2c2c2c';
  ctx.fillRect(x - 6, y - 7 + bob * 2.5, 4, 7 - bob * 2);
  ctx.fillRect(x + 2, y - 7 - bob * 2.5, 4, 7 + bob * 2);

  const by = y - 8 - lift;
  const ax = Math.cos(u.aim), ay = Math.sin(u.aim);
  const vis = u.classDef?.visual;
  const weapon = vis?.weapon ?? 'rifle';
  const bw = vis?.bodyW ?? 14;
  const gunBehind = ay < -0.2;
  const muzzle = (dist: number, big: number) => {
    if (u.muzzle <= 0) return;
    const gx = x + ax * 4, gy = by - 6 + ay * 2;
    const mx = gx + ax * dist, my = gy + ay * dist * 0.77;
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath(); ctx.arc(mx, my, 6 * big, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = u.suppressing ? '#ff7a20' : '#ffb030';
    ctx.beginPath(); ctx.arc(mx + ax * 3, my + ay * 3, 4 * big, 0, Math.PI * 2); ctx.fill();
  };
  const drawGun = () => {
    const gx = x + ax * 4, gy = by - 6 + ay * 2;
    ctx.lineCap = 'round';
    if (weapon === 'mg') {
      // big machine gun: chunky receiver, long barrel, drum/box magazine
      ctx.strokeStyle = '#1f1f1f'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(gx - ax * 3, gy - ay * 2); ctx.lineTo(gx + ax * 13, gy + ay * 10); ctx.stroke();
      ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(gx + ax * 13, gy + ay * 10); ctx.lineTo(gx + ax * 27, gy + ay * 21); ctx.stroke();
      ctx.fillStyle = '#4a5a32';
      ctx.fillRect(gx + ax * 6 - 4, gy + ay * 5 + 1, 8, 7);
      ctx.strokeStyle = '#d9b23a'; ctx.lineWidth = 2; // ammo belt feeding the gun
      ctx.beginPath(); ctx.moveTo(gx + ax * 6, gy + ay * 5 + 4); ctx.quadraticCurveTo(x - 2, by - 2, x - ax * 6, by - 8); ctx.stroke();
      muzzle(31, u.suppressing ? 1.35 : 1.1);
    } else if (weapon === 'smg') {
      // compact SMG
      ctx.strokeStyle = COL.gun; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + ax * 12, gy + ay * 9); ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(gx + ax * 5, gy + ay * 4); ctx.lineTo(gx + ax * 5, gy + ay * 4 + 5); ctx.stroke();
      muzzle(16, 0.8);
    } else {
      ctx.strokeStyle = COL.gun; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + ax * 17, gy + ay * 13); ctx.stroke();
      muzzle(22, 1);
    }
  };
  const drawPack = () => {
    if (!vis || vis.pack === 'none') return;
    const px = x - ax * 7, py = by - 6;
    if (vis.pack === 'ammo') {
      ctx.fillStyle = '#3f4a2c';
      roundRect(ctx, px - 8, py - 8, 16, 14, 3); ctx.fill();
      ctx.fillStyle = '#2c3420'; ctx.fillRect(px - 8, py - 3, 16, 3);
    } else {
      ctx.fillStyle = '#e9e9e4';
      roundRect(ctx, px - 7, py - 7, 14, 12, 3); ctx.fill();
      ctx.strokeStyle = '#9a9a92'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = GREEN_CROSS;
      ctx.fillRect(px - 1.5, py - 5, 3, 8); ctx.fillRect(px - 4, py - 2.5, 8, 3);
    }
  };
  const packInFront = ay < -0.2; // facing away: the backpack is the nearest thing to the camera
  if (!packInFront) drawPack();
  if (gunBehind) drawGun();
  // body
  ctx.fillStyle = body;
  roundRect(ctx, x - bw / 2, by - 12, bw, 13, 4); ctx.fill();
  if (vis?.pack === 'ammo') {
    // armour plate + ammo bandolier across the chest
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    roundRect(ctx, x - bw / 2 + 3, by - 10, bw - 6, 8, 2); ctx.fill();
    ctx.strokeStyle = '#d9b23a'; ctx.lineWidth = 2.5; ctx.setLineDash([2.5, 1.5]);
    ctx.beginPath(); ctx.moveTo(x - bw / 2 + 1, by - 11); ctx.lineTo(x + bw / 2 - 1, by); ctx.stroke();
    ctx.setLineDash([]);
  } else if (vis?.pack === 'medical') {
    // white armband + hip pouch with the green cross
    ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x - bw / 2 - 1, by - 9, 3, 4);
    medMark(ctx, x + bw / 2 - 1, by - 2, 3.2);
  }
  if (packInFront) drawPack();
  if (!gunBehind) drawGun();
  // head (oversized)
  const hx = x, hy = by - 20;
  ctx.fillStyle = COL.skin;
  ctx.beginPath(); ctx.arc(hx, hy, 10, 0, Math.PI * 2); ctx.fill();
  // eyes look along aim (hidden when facing away)
  if (ay > -0.6) {
    ctx.fillStyle = '#1a1a1a';
    const ex = hx + ax * 4.5, ey = hy + 1 + ay * 2.5;
    const px = -ay * 3.2, py = ax * 1.2;
    ctx.beginPath(); ctx.arc(ex + px, ey + py, 1.7, 0, Math.PI * 2); ctx.arc(ex - px, ey - py, 1.7, 0, Math.PI * 2); ctx.fill();
  }
  // helmet
  ctx.fillStyle = helmet;
  const hs = vis?.helmet ?? 'standard';
  if (hs === 'heavy') {
    // heavier, wider helmet with a dark brim and side flaps
    ctx.beginPath(); ctx.arc(hx, hy - 1, 12, Math.PI * 1.0, Math.PI * 2.0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a3a6e'; ctx.fillRect(hx - 14, hy - 2, 28, 4);
    ctx.fillRect(hx - 13, hy - 2, 3, 8); ctx.fillRect(hx + 10, hy - 2, 3, 8);
  } else {
    ctx.beginPath(); ctx.arc(hx, hy - 1, 11, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
    ctx.fillRect(hx - 11, hy - 3, 22, 3);
    if (hs === 'medic') {
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(hx - 11, hy - 6, 22, 3); // white band
      if (ay > -0.6) medMark(ctx, hx + ax * 3, hy - 7, 3.4);
    }
  }
  if (u.rapidFire > 0) {
    ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx, hy, 13, 0, Math.PI * 2); ctx.stroke();
  }
  // hit flash
  if (u.hitFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, u.hitFlash / CFG.feel.hitFlash) * 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(hx, hy, 11.5, 0, Math.PI * 2); ctx.fill();
    roundRect(ctx, x - 8, by - 13, 16, 15, 4); ctx.fill();
    ctx.restore();
  }
}

function drawProjectiles(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.lineCap = 'round';
  for (const p of game.projectiles) {
    const sq = p.team === 'squad';
    const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
    const L = p.len ?? (sq ? 20 : 16);
    const tx = p.pos.x - (p.vel.x / sp) * L, ty = p.pos.y - (p.vel.y / sp) * L;
    ctx.strokeStyle = sq ? (p.hot ? '#ffc070' : COL.squadBullet) : COL.enemyBullet;
    ctx.lineWidth = (p.width ?? (sq ? 3.5 : 4)) + (p.hot ? 0.5 : 0);
    ctx.beginPath(); ctx.moveTo(tx, ty - 18); ctx.lineTo(p.pos.x, p.pos.y - 18); ctx.stroke();
  }
}

function drawFx(ctx: CanvasRenderingContext2D, game: Game) {
  for (const p of game.fx.pulses) {
    const k = clamp(p.life / p.maxLife, 0, 1);
    // true circle: exactly the heal radius on the ground
    const r = p.r * (0.85 + 0.15 * (1 - k));
    ctx.fillStyle = `rgba(110,255,150,${0.25 * k})`;
    ctx.strokeStyle = `rgba(140,255,170,${0.9 * k})`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  for (const p of game.fx.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.pos.x - p.size / 2, p.pos.y - 16 - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  for (const r of game.fx.rings) {
    ctx.globalAlpha = clamp(r.life / r.maxLife, 0, 1);
    ctx.strokeStyle = r.color; ctx.lineWidth = r.width;
    ctx.beginPath(); ctx.ellipse(r.pos.x, r.pos.y, r.r, r.r * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of game.fx.texts) {
    ctx.globalAlpha = clamp(t.life / 0.4, 0, 1);
    ctx.fillStyle = '#000'; ctx.fillText(t.text, t.pos.x + 1, t.pos.y + 1);
    ctx.fillStyle = t.color; ctx.fillText(t.text, t.pos.x, t.pos.y);
  }
  ctx.globalAlpha = 1;
}

function drawOverheads(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const e of game.enemies) {
    if (!e.active) continue;
    const w = e.structure ? 64 : 24, f = clamp(e.hp / e.maxHp, 0, 1);
    const bx = e.pos.x - w / 2, byy = e.pos.y - (e.structure ? 62 : 60);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 1, byy - 1, w + 2, 5);
    ctx.fillStyle = f > 0.5 ? '#ff5a4a' : '#ff9a3a'; ctx.fillRect(bx, byy, w * f, 3);
  }
  ctx.font = 'bold 10px sans-serif';
  for (const n of game.npcs) {
    if (n.state === 'downed') { drawDownedMarker(ctx, n, game); continue; }
    if (n.state !== 'active') continue;
    const w = 32, f = clamp(n.hp / n.maxHp, 0, 1), bx = n.pos.x - w / 2, byy = n.pos.y - 60;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(bx - 1, byy - 1, w + 2, 7);
    ctx.fillStyle = '#7dd3ff'; ctx.fillRect(bx, byy, w * f, 5);
    ctx.fillStyle = '#000'; ctx.fillText(n.escorting ? 'CAPTIVE' : 'CAPTIVE (HELD)', n.pos.x + 1, n.pos.y - 69);
    ctx.fillStyle = '#7dd3ff'; ctx.fillText(n.escorting ? 'CAPTIVE' : 'CAPTIVE (HELD)', n.pos.x, n.pos.y - 70);
  }
  for (const s of game.soldiers) {
    if (s.state === 'active') {
      // green health bar (enemies' bars are red), name tag just above it
      const w = 32, f = clamp(s.hp / s.maxHp, 0, 1);
      const bx = s.pos.x - w / 2, byy = s.pos.y - 60;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(bx - 1, byy - 1, w + 2, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, byy, w, 5);
      ctx.fillStyle = s.hitFlash > 0 ? '#ffffff' : f > 0.3 ? '#46d65a' : '#2fa040'; ctx.fillRect(bx, byy, w * f, 5);
      if (s.healFlash > 0) {
        ctx.globalAlpha = clamp(s.healFlash / 0.8, 0, 1);
        ctx.strokeStyle = '#9dff9a'; ctx.lineWidth = 2; ctx.strokeRect(bx - 2.5, byy - 2.5, w + 5, 10);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(s.name, s.pos.x + 1, s.pos.y - 70 + 1);
      ctx.fillStyle = '#cfe6ff'; ctx.fillText(s.name, s.pos.x, s.pos.y - 70);
    } else if (s.state === 'downed') {
      drawDownedMarker(ctx, s, game);
    } else if (s.state === 'kia') {
      ctx.fillStyle = '#bbb'; ctx.fillText(`${s.name} KIA`, s.pos.x, s.pos.y - 24);
    }
  }
}

/**
 * Downed soldier / captive: bleed-out ring (shrinks as time runs out) with the seconds left,
 * revive progress arc (green) while a valid revive runs, name + DOWN, and a flashing
 * CRITICAL warning in the last CFG.revive.criticalTime seconds.
 */
function drawDownedMarker(ctx: CanvasRenderingContext2D, s: Unit, game: Game) {
  const R = CFG.revive;
  const cx = s.pos.x, cy = s.pos.y - 44;
  const critical = !s.reviving && s.bleed <= R.criticalTime;
  const blink = critical && Math.sin(game.clock * 16) > 0;
  ctx.fillStyle = critical ? (blink ? 'rgba(160,0,0,0.85)' : 'rgba(0,0,0,0.7)') : 'rgba(0,0,0,0.62)';
  ctx.beginPath(); ctx.arc(cx, cy, 19, 0, Math.PI * 2); ctx.fill();
  // bleed-out remaining (red) and revive progress (green, inner)
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = critical ? '#ff2020' : '#ff6a6a';
  ctx.beginPath(); ctx.arc(cx, cy, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(s.bleed / R.bleedOut, 0, 1)); ctx.stroke();
  if (s.reviveProgress > 0) {
    ctx.strokeStyle = '#7dff8a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.reviveProgress)); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = s.reviving ? '#7dff8a' : '#fff';
  ctx.fillText(s.reviving ? `${Math.floor(s.reviveProgress * 100)}%` : String(Math.ceil(s.bleed)), cx, cy + 1);
  const label = s.reviving ? `${s.name} — REVIVING` : critical ? `${s.name} — CRITICAL` : `${s.name} DOWN`;
  ctx.font = `bold ${critical ? 14 : 12}px sans-serif`;
  ctx.fillStyle = '#000'; ctx.fillText(label, cx + 1, cy - 29 + 1);
  ctx.fillStyle = s.reviving ? '#7dff8a' : critical ? (blink ? '#ffffff' : '#ff3030') : '#ff5050';
  ctx.fillText(label, cx, cy - 29);
  ctx.font = 'bold 10px sans-serif';
}

/** Objective structure (supply depot): stacked crates under a tarp with a radio mast. */
function drawStructure(ctx: CanvasRenderingContext2D, u: Unit, game: Game) {
  const { x, y } = u.pos;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + 4, 34, 14, 0, 0, Math.PI * 2); ctx.fill();
  const flash = u.hitFlash > 0;
  ctx.fillStyle = flash ? '#fff' : '#6b5a3a'; ctx.fillRect(x - 30, y - 30, 60, 32);
  ctx.fillStyle = flash ? '#eee' : '#8a7448'; ctx.fillRect(x - 30, y - 42, 60, 14);
  ctx.fillStyle = flash ? '#ddd' : '#3f5a2c'; ctx.fillRect(x - 33, y - 48, 66, 10); // tarp
  ctx.strokeStyle = '#2b2416'; ctx.lineWidth = 2; ctx.strokeRect(x - 30, y - 42, 60, 44);
  ctx.beginPath(); ctx.moveTo(x - 30, y - 15); ctx.lineTo(x + 30, y - 15); ctx.stroke();
  ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 18, y - 48); ctx.lineTo(x + 18, y - 92); ctx.stroke();
  ctx.fillStyle = Math.sin(game.clock * 6) > 0 ? '#ff3b3b' : '#661111';
  ctx.beginPath(); ctx.arc(x + 18, y - 94, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(u.label, x, y - 105);
}

/** Captive / escorted NPC: no helmet, orange jumpsuit; tied hands while held. */
function drawCaptive(ctx: CanvasRenderingContext2D, u: Unit, game: Game) {
  const { x, y } = u.pos;
  if (u.state !== 'active') { drawUnit(ctx, u, game); return; }
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(x, y + 1, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(x, y); ctx.scale(CHAR_SCALE, CHAR_SCALE); ctx.translate(-x, -y);
  const moving = u.moveFrac > 0.08, bob = moving ? Math.sin(u.walkPhase) : 0;
  ctx.fillStyle = '#2c2c2c';
  ctx.fillRect(x - 6, y - 7 + bob * 2.5, 4, 7 - bob * 2); ctx.fillRect(x + 2, y - 7 - bob * 2.5, 4, 7 + bob * 2);
  ctx.fillStyle = u.hitFlash > 0 ? '#fff' : '#e8892b';
  roundRect(ctx, x - 7, y - 20, 14, 13, 4); ctx.fill();
  ctx.fillStyle = COL.skin;
  ctx.beginPath(); ctx.arc(x, y - 28, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3020';
  ctx.beginPath(); ctx.arc(x, y - 31, 9, Math.PI, Math.PI * 2); ctx.fill();
  if (!u.escorting) { ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 6, y - 12); ctx.lineTo(x + 6, y - 12); ctx.stroke(); }
  ctx.restore();
}

function drawOffscreenArrows(ctx: CanvasRenderingContext2D, game: Game) {
  if (game.phase !== 'playing') return;
  const targets: { x: number; y: number; label: string; color: string }[] = [];
  for (const s of [...game.soldiers, ...game.npcs]) {
    if (s.state === 'downed') targets.push({ ...s.pos, label: `${s.name} ${Math.ceil(s.bleed)}s`, color: '#ff4040' });
  }
  const obj = game.mission.objectivePoint(game);
  if (obj) targets.push({ ...obj.pos, label: obj.label, color: obj.color });
  const m = 46;
  for (const t of targets) {
    const sp = game.worldToScreen(t);
    if (sp.x > 0 && sp.x < VIEW_W && sp.y > 0 && sp.y < VIEW_H) continue;
    const cx = VIEW_W / 2, cy = VIEW_H / 2;
    const dx = sp.x - cx, dy = sp.y - cy;
    const k = Math.min((VIEW_W / 2 - m) / Math.abs(dx || 1e-6), (VIEW_H / 2 - m) / Math.abs(dy || 1e-6));
    const ax = cx + dx * k, ay = cy + dy * k;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = t.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-8, -14); ctx.lineTo(-8, 14); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lx = ax - Math.cos(ang) * 30, ly = ay - Math.sin(ang) * 26;
    ctx.fillStyle = '#000'; ctx.fillText(t.label, lx + 1, ly + 1);
    ctx.fillStyle = t.color; ctx.fillText(t.label, lx, ly);
  }
}

function drawBanners(ctx: CanvasRenderingContext2D, game: Game) {
  let y = 170;
  for (const b of game.banners) {
    const age = b.maxLife - b.life;
    const scale = age < 0.15 ? 1.4 - (age / 0.15) * 0.4 : 1;
    const alpha = clamp(b.life / 0.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(VIEW_W / 2, y);
    ctx.scale(scale, scale);
    bigText(ctx, b.text, 0, 0, b.text.length > 24 ? 30 : 46, b.color);
    ctx.restore();
    y += 58;
  }
}

function bigText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
  ctx.font = `900 ${size}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = size / 6; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Barracks portrait: the same in-game class drawing (helmet, weapon, pack), standing still,
 * drawn into a small canvas. Pure presentation; no Unit or game state involved.
 */
export function drawClassPortrait(canvas: HTMLCanvasElement, classId: SoldierClassId, aim = 0.55) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const fake = { moveFrac: 0, walkPhase: 0, aim, classDef: CLASSES[classId], muzzle: 0, suppressing: false, rapidFire: 0, hitFlash: 0 } as unknown as Unit;
  const s = (h / 62) * (classId === 'heavy' ? 1.06 : 1);
  const x = w / 2, y = h * 0.86;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(x, y + 1, 12 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y);
  drawStanding(ctx, fake, x, y, COL.squadHelmet, COL.squadBody);
  ctx.restore();
}
