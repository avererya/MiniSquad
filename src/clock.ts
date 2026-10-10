// v0.6 simulation clock: turns real frame timestamps into a whole number of fixed simulation
// steps. Every timer in the game (bleed-out, revives, extraction, waves) runs on these steps,
// so it is identical at 30, 60 or 144 fps:
//  - a frame's real delta is clamped to `maxFrame` (0.1 s): after a frame drop, a stall or a
//    slow device the simulation runs SLOWER than real time, never faster (no catch-up burst);
//  - while suspended (page hidden) nothing accumulates, and resume() restarts from "now", so the
//    hidden time is never simulated;
//  - leftover time below one step is carried to the next frame (no drift, no double steps).
export class SimClock {
  private acc = 0;
  private last: number | null = null;
  private suspended = false;
  constructor(readonly step = 1 / 60, readonly maxFrame = 0.1) {}

  /** Steps to simulate for the frame at `now` (ms). `hidden` = document.hidden. */
  advance(now: number, hidden = false): number {
    if (hidden || this.suspended) { this.last = now; this.acc = 0; return 0; }
    if (this.last === null) { this.last = now; return 0; }
    const dt = Math.max(0, Math.min(this.maxFrame, (now - this.last) / 1000));
    this.last = now;
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.step - 1e-9) { this.acc -= this.step; n++; }
    return n;
  }
  suspend() { this.suspended = true; this.acc = 0; }
  resume(now: number) { this.suspended = false; this.last = now; this.acc = 0; }
}
