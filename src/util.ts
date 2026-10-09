export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const v = (x = 0, y = 0): Vec => ({ x, y });
export const len = (x: number, y: number) => Math.hypot(x, y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Vec, b: Vec) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
export const DEG = Math.PI / 180;

export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(cur: number, target: number, maxStep: number) {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

export function pointInRect(p: Vec, r: Rect, pad = 0) {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

// Segment vs AABB (inflated by pad). Returns entry t in [0,1] or -1.
export function segRect(x1: number, y1: number, x2: number, y2: number, r: Rect, pad = 0): number {
  const minX = r.x - pad, maxX = r.x + r.w + pad, minY = r.y - pad, maxY = r.y + r.h + pad;
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < minX || x1 > maxX) return -1;
  } else {
    let a = (minX - x1) / dx, b = (maxX - x1) / dx;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y1 < minY || y1 > maxY) return -1;
  } else {
    let a = (minY - y1) / dy, b = (maxY - y1) / dy;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

// Segment vs circle. Returns entry t in [0,1] or -1.
export function segCircle(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// Push a circle out of a rect. Mutates p. Returns true if pushed.
export function pushOutOfRect(p: Vec, r: number, rect: Rect): boolean {
  const cx = clamp(p.x, rect.x, rect.x + rect.w);
  const cy = clamp(p.y, rect.y, rect.y + rect.h);
  let dx = p.x - cx, dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.y = cy + (dy / d) * r;
  } else {
    // centre inside rect: push along the smallest axis
    const left = p.x - rect.x, right = rect.x + rect.w - p.x;
    const top = p.y - rect.y, bottom = rect.y + rect.h - p.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) p.x = rect.x - r;
    else if (m === right) p.x = rect.x + rect.w + r;
    else if (m === top) p.y = rect.y - r;
    else p.y = rect.y + rect.h + r;
  }
  return true;
}
