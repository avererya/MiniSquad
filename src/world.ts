// World geometry: obstacles, line of sight, collision and a nav grid with
// A* (for squad soldiers) and a multi-source flow field (for enemy riflemen).
import { isLowObstacle, type Obstacle } from './map';
import { pushOutOfRect, segRect, clamp, type Vec } from './util';

const CELL = 16;
const NAV_PAD = 14; // obstacles inflated by roughly a unit radius so paths keep clearance
const SQ2 = Math.SQRT2;
const NB = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2],
];

class Heap {
  ids: number[] = [];
  keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

export class World {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  readonly flow: Float32Array;
  /**
   * v0.6.2: obstacles that block bullets and line of sight. Low obstacles (river water) block
   * movement and navigation only: you can shoot across a river but not walk through it.
   */
  readonly solid: Obstacle[];

  constructor(public obstacles: Obstacle[], readonly w: number, readonly h: number) {
    this.solid = obstacles.filter((o) => !isLowObstacle(o));
    const WORLD_W = w, WORLD_H = h;
    this.cols = Math.ceil(w / CELL);
    this.rows = Math.ceil(h / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.flow = new Float32Array(this.cols * this.rows).fill(Infinity);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
        let b = x < NAV_PAD || y < NAV_PAD || x > WORLD_W - NAV_PAD || y > WORLD_H - NAV_PAD;
        if (!b) {
          for (const o of obstacles) {
            if (x > o.x - NAV_PAD && x < o.x + o.w + NAV_PAD && y > o.y - NAV_PAD && y < o.y + o.h + NAV_PAD) { b = true; break; }
          }
        }
        this.blocked[r * this.cols + c] = b ? 1 : 0;
      }
    }
  }

  // ---------- geometry ----------
  /** Line of sight / bullets: true when nothing solid lies between a and b (water does not block). */
  clear(a: Vec, b: Vec, pad = 0): boolean {
    for (const o of this.solid) if (segRect(a.x, a.y, b.x, b.y, o, pad) >= 0) return false;
    return true;
  }
  /** Movement: true when a body of half-width `pad` can walk straight from a to b (water blocks). */
  passable(a: Vec, b: Vec, pad = 0): boolean {
    for (const o of this.obstacles) if (segRect(a.x, a.y, b.x, b.y, o, pad) >= 0) return false;
    return true;
  }

  /** First solid obstacle hit along the segment (bullets): returns t in [0,1], or 1 if none. */
  raycast(x1: number, y1: number, x2: number, y2: number): number {
    let best = 1;
    for (const o of this.solid) {
      const t = segRect(x1, y1, x2, y2, o, 0);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }

  insideObstacle(p: Vec, pad = 0): boolean {
    for (const o of this.obstacles) {
      if (p.x > o.x - pad && p.x < o.x + o.w + pad && p.y > o.y - pad && p.y < o.y + o.h + pad) return true;
    }
    return false;
  }

  resolveCircle(p: Vec, r: number) {
    for (let iter = 0; iter < 2; iter++) {
      for (const o of this.obstacles) pushOutOfRect(p, r, o);
    }
    p.x = clamp(p.x, r, this.w - r);
    p.y = clamp(p.y, r, this.h - r);
  }

  // ---------- grid ----------
  idx(x: number, y: number) {
    const c = clamp(Math.floor(x / CELL), 0, this.cols - 1);
    const r = clamp(Math.floor(y / CELL), 0, this.rows - 1);
    return r * this.cols + c;
  }
  center(i: number): Vec {
    return { x: (i % this.cols) * CELL + CELL / 2, y: Math.floor(i / this.cols) * CELL + CELL / 2 };
  }
  isOpen(x: number, y: number) { return !this.blocked[this.idx(x, y)]; }

  nearestOpen(i: number): number {
    if (!this.blocked[i]) return i;
    const c0 = i % this.cols, r0 = Math.floor(i / this.cols);
    for (let rad = 1; rad < 20; rad++) {
      let best = -1, bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const j = r * this.cols + c;
          if (!this.blocked[j] && dr * dr + dc * dc < bestD) { bestD = dr * dr + dc * dc; best = j; }
        }
      }
      if (best >= 0) return best;
    }
    return i;
  }

  private canStep(c: number, r: number, dc: number, dr: number): boolean {
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) return false;
    if (this.blocked[nr * this.cols + nc]) return false;
    if (dc !== 0 && dr !== 0) {
      // no corner cutting
      if (this.blocked[r * this.cols + nc] || this.blocked[nr * this.cols + c]) return false;
    }
    return true;
  }

  /** A* from a to b, string-pulled. Returns waypoints (excluding start), or null. */
  findPath(a: Vec, b: Vec, radius: number): Vec[] | null {
    const start = this.nearestOpen(this.idx(a.x, a.y));
    const goal = this.nearestOpen(this.idx(b.x, b.y));
    if (start === goal) return [{ x: b.x, y: b.y }];
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gc = goal % this.cols, gr = Math.floor(goal / this.cols);
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - gc), dy = Math.abs(Math.floor(i / this.cols) - gr);
      return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy);
    };
    const heap = new Heap();
    g[start] = 0;
    heap.push(start, h(start));
    let found = false, expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) { found = true; break; }
      if (++expanded > 6000) break;
      const c = cur % this.cols, r = Math.floor(cur / this.cols);
      for (const [dc, dr, cost] of NB) {
        if (!this.canStep(c, r, dc, dr)) continue;
        const j = (r + dr) * this.cols + (c + dc);
        const ng = g[cur] + cost;
        if (ng < g[j]) { g[j] = ng; from[j] = cur; heap.push(j, ng + h(j)); }
      }
    }
    if (!found) return null;
    const cells: Vec[] = [];
    for (let i = goal; i !== start && i >= 0; i = from[i]) cells.push(this.center(i));
    cells.reverse();
    cells[cells.length - 1] = { x: b.x, y: b.y };
    // string pulling
    const out: Vec[] = [];
    let anchor: Vec = a;
    let k = 0;
    while (k < cells.length) {
      let far = k;
      for (let j = cells.length - 1; j > k; j--) {
        if (this.passable(anchor, cells[j], radius - 2)) { far = j; break; }
      }
      out.push(cells[far]);
      anchor = cells[far];
      k = far + 1;
    }
    return out;
  }

  /** Multi-source Dijkstra: flow[i] = distance to the nearest source. */
  computeFlow(sources: Vec[]) {
    const f = this.flow;
    f.fill(Infinity);
    const heap = new Heap();
    for (const s of sources) {
      const i = this.nearestOpen(this.idx(s.x, s.y));
      f[i] = 0;
      heap.push(i, 0);
    }
    while (heap.size) {
      const cur = heap.pop();
      const d = f[cur];
      const c = cur % this.cols, r = Math.floor(cur / this.cols);
      for (const [dc, dr, cost] of NB) {
        if (!this.canStep(c, r, dc, dr)) continue;
        const j = (r + dr) * this.cols + (c + dc);
        const nd = d + cost;
        if (nd < f[j]) { f[j] = nd; heap.push(j, nd); }
      }
    }
  }

  /** Where to steer to follow the flow field downhill, with line-of-sight look-ahead. */
  flowTarget(p: Vec, radius: number): Vec | null {
    let i = this.nearestOpen(this.idx(p.x, p.y));
    if (!isFinite(this.flow[i])) return null;
    const chain: number[] = [];
    for (let step = 0; step < 8; step++) {
      const c = i % this.cols, r = Math.floor(i / this.cols);
      let best = -1, bestV = this.flow[i];
      for (const [dc, dr] of NB) {
        if (!this.canStep(c, r, dc, dr)) continue;
        const j = (r + dr) * this.cols + (c + dc);
        if (this.flow[j] < bestV) { bestV = this.flow[j]; best = j; }
      }
      if (best < 0) break;
      chain.push(best);
      i = best;
    }
    if (!chain.length) return null;
    for (let k = chain.length - 1; k > 0; k--) {
      const pt = this.center(chain[k]);
      if (this.passable(p, pt, radius - 2)) return pt;
    }
    return this.center(chain[0]);
  }
}
