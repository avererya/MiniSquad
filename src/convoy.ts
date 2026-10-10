// v0.6.2 Mission 8 convoy: supply trucks that drive a fixed road route (waypoints chosen to be
// clear of every obstacle; tools/chapter2.cjs checks it), as kinematic enemy units with persistent
// HP. They never path-find, so they can't get stuck; they push soldiers / enemies out of the way
// like a structure. A truck that reaches the end of the route has ESCAPED (removed, no wreck).
// Escorts (riflemen / Armored Troopers) walk with each truck until the squad comes close.
import { CFG } from './config';
import type { Game } from './game';
import type { Unit, EnemyKind } from './unit';
import type { Vec } from './util';
import { sfx } from './audio';

export interface Truck {
  unit: Unit | null;
  /** Distance travelled along the route (px). */
  s: number;
  state: 'waiting' | 'moving' | 'destroyed' | 'escaped';
  /** Mission time (s since launch) at which it starts driving. */
  launchAt: number;
  escorts: EnemyKind[];
}

export class Convoy {
  trucks: Truck[];
  readonly len: number[];
  readonly total: number;
  t = 0;
  launched = false;
  destroyed = 0;
  escaped = 0;
  constructor(readonly route: Vec[], escorts: EnemyKind[][], readonly gap: number, readonly delay: number) {
    this.trucks = escorts.map((e, i) => ({ unit: null, s: 0, state: 'waiting', launchAt: delay + i * gap, escorts: e }));
    this.len = [0];
    for (let i = 1; i < route.length; i++) this.len.push(this.len[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y));
    this.total = this.len[this.len.length - 1];
  }

  /** Point and heading at distance s along the route. */
  at(s: number): { p: Vec; a: number } {
    const R = this.route;
    s = Math.max(0, Math.min(this.total, s));
    let i = 1;
    while (i < R.length - 1 && this.len[i] < s) i++;
    const a = R[i - 1], b = R[i], seg = this.len[i] - this.len[i - 1] || 1, k = (s - this.len[i - 1]) / seg;
    return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  launch(game: Game) {
    if (this.launched) return;
    this.launched = true;
    this.t = 0;
    game.banner('ENEMY CONVOY INBOUND — STOP THE TRUCKS', '#ffb347', 3.2);
  }

  /** Seconds until a truck at distance s reaches the end at full speed. */
  timeToEscape(s: number) { return (this.total - s) / CFG.truck.moveSpeed; }

  update(game: Game, dt: number) {
    if (!this.launched) return;
    this.t += dt;
    for (const [i, tr] of this.trucks.entries()) {
      if (tr.state === 'waiting' && this.t >= tr.launchAt) {
        const { p, a } = this.at(0);
        const u = game.spawnEnemy(p, 'truck');
        u.aim = a; u.label = `TRUCK ${i + 1}`; u.tag = 'convoy';
        tr.unit = u; tr.state = 'moving';
        tr.escorts.forEach((k, j) => {
          const side = j % 2 ? 1 : -1, back = 70 + Math.floor(j / 2) * 60;
          // offsets relative to the route start heading (they re-form behind the truck as it drives)
          game.spawnEscort(u, { x: -Math.cos(a) * back - Math.sin(a) * side * 46, y: -Math.sin(a) * back + Math.cos(a) * side * 46 }, k);
        });
      }
      if (tr.state !== 'moving' || !tr.unit) continue;
      const u = tr.unit;
      if (!u.active) continue; // destroyed this step (event handled below)
      // a heavily damaged truck limps (readable feedback; never stops)
      const sp = CFG.truck.moveSpeed * (u.hp < u.maxHp * 0.34 ? 0.8 : 1);
      tr.s += sp * dt;
      const { p, a } = this.at(tr.s);
      u.vel = { x: (p.x - u.pos.x) / Math.max(dt, 1e-6), y: (p.y - u.pos.y) / Math.max(dt, 1e-6) };
      u.pos = p;
      u.aim = a;
      if (tr.s >= this.total) {
        tr.state = 'escaped'; this.escaped++;
        u.state = 'dead';
        game.banner(`TRUCK ${i + 1} ESCAPED`, '#ff6040', 2.6);
        sfx('deny');
        game.mission.emit(game, { type: 'vehicleEscaped', unit: u });
      }
    }
  }

  /** A truck was destroyed (game.damage -> vehicleDestroyed). */
  onDestroyed(game: Game, u: Unit) {
    const tr = this.trucks.find((t) => t.unit === u);
    if (!tr || tr.state !== 'moving') return;
    tr.state = 'destroyed'; this.destroyed++;
    const p = u.pos;
    game.mission.wrecks.push({ id: `truck-${this.trucks.indexOf(tr)}`, pos: { ...p }, kind: 'truck' });
    game.fx.ring(p, 130, 'rgba(255,190,80,0.95)', 0.55, 8);
    game.fx.burst(p, 48, '#ffb347', 440, 0.8, 6);
    game.fx.burst(p, 24, '#444', 200, 1.3, 9);
    game.fx.shake = Math.max(game.fx.shake, 18);
    game.scorches.push({ ...p, r: 70 });
    sfx('boom');
    const left = this.trucks.filter((t) => t.state === 'moving' || t.state === 'waiting').length;
    game.banner(`TRUCK ${this.trucks.indexOf(tr) + 1} DESTROYED${left ? ` — ${left} STILL ROLLING` : ''}`, '#7dff8a', 2.6);
    // its escorts stop walking along and fight
    for (const e of game.enemies) if (e.escortOf === u) e.escortOf = null;
  }
}
