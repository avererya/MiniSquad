// v0.6.3 developer-only performance overlay (⚙ tuning panel -> Performance, or ?perf=1).
// Hidden by default; when hidden it costs nothing. Text refreshes 4x a second.
import type { Game } from './game';
import { counters, perfSettings, type PerfStats } from './perf';

export class PerfOverlay {
  private el: HTMLElement;
  private nextAt = 0;
  private shown = false;
  private last = { los: 0, paths: 0, flows: 0, t: 0 };

  constructor(parent: HTMLElement, private game: Game, private stats: PerfStats) {
    this.el = document.createElement('pre');
    this.el.id = 'perfov';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  update(now: number) {
    const on = perfSettings().overlay;
    if (on !== this.shown) { this.shown = on; this.el.style.display = on ? '' : 'none'; this.nextAt = 0; }
    if (!on || now < this.nextAt) return;
    this.nextAt = now + 250;
    const s = this.stats.summary(now), g = this.game, fx = g.fx;
    const dt = Math.max(0.001, (now - this.last.t) / 1000);
    const rate = (k: 'los' | 'paths' | 'flows') => Math.round((counters[k] - this.last[k]) / dt);
    const los = rate('los'), paths = rate('paths'), flows = rate('flows');
    this.last = { ...counters, t: now };
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const busy = s.fps * (s.simMs + s.renderMs);
    this.el.textContent = [
      `FPS ${s.fps} / cap ${perfSettings().fpsCap}  (display ${s.rafHz} Hz)`,
      `frame ${s.frameMs.toFixed(1)} ms  max ${s.frameMax.toFixed(0)}  slow ${s.slow}`,
      `sim ${s.simMs.toFixed(2)} ms  max ${s.simMax.toFixed(1)}  steps/s ${s.steps}`,
      `draw ${s.renderMs.toFixed(2)} ms  max ${s.renderMax.toFixed(1)}`,
      `busy ${busy.toFixed(0)} ms/s (${(busy / 10).toFixed(0)}%)`,
      `enemies ${g.enemies.filter((e) => e.active).length}  squad ${g.soldiers.filter((u) => u.active).length}`,
      `bullets ${g.projectiles.length}  grenades ${g.grenades.length}`,
      `fx ${fx.particles.length}p ${fx.rings.length}r ${fx.texts.length}t ${fx.pulses.length}f`,
      `LOS ${los}/s  A* ${paths}/s  flow ${flows}/s`,
      mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB` : '',
    ].filter(Boolean).join('\n');
  }
}
