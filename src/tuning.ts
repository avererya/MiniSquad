// In-game tuning panel: live sliders on CFG, JSON export/import, reset, debug actions.
import { CFG, DEFAULTS, applyConfigJSON, getPath, resetConfig, setPath } from './config';
import type { Game } from './game';

type S = [label: string, path: string, min: number, max: number, step: number];

const SECTIONS: [string, S[]][] = [
  ['Infantry', [
    ['HP', 'infantry.hp', 20, 400, 5],
    ['Damage', 'infantry.damage', 1, 60, 1],
    ['Bullet spread, still (°)', 'infantry.accuracy', 0, 45, 0.5],
    ['Moving spread penalty (°)', 'infantry.movePenalty', 0, 60, 0.5],
    ['Fire rate (/s)', 'infantry.fireRate', 0.5, 15, 0.1],
    ['Range', 'infantry.range', 100, 640, 5],
    ['Move speed', 'infantry.moveSpeed', 40, 350, 5],
    ['Projectile speed', 'infantry.projectileSpeed', 200, 2000, 10],
    ['Grenade cooldown', 'infantry.abilityCooldown', 0.5, 30, 0.5],
    ['Aim turn rate', 'infantry.turnRate', 1, 40, 0.5],
  ]],
  ['Enemy Rifleman', [
    ['HP', 'enemy.hp', 5, 300, 5],
    ['Damage', 'enemy.damage', 1, 60, 1],
    ['Bullet spread, still (°)', 'enemy.accuracy', 0, 45, 0.5],
    ['Moving spread penalty (°)', 'enemy.movePenalty', 0, 60, 0.5],
    ['Fire rate (/s)', 'enemy.fireRate', 0.2, 10, 0.1],
    ['Range', 'enemy.range', 100, 640, 5],
    ['Move speed', 'enemy.moveSpeed', 20, 300, 5],
    ['Projectile speed', 'enemy.projectileSpeed', 150, 2000, 10],
    ['Advance-while-firing chance', 'enemy.advanceChance', 0, 1, 0.05],
    ['Reaction min (s)', 'enemy.reactionMin', 0, 2, 0.05],
    ['Reaction max (s)', 'enemy.reactionMax', 0, 3, 0.05],
  ]],
  ['Squad follow', [
    ['Looseness', 'squad.looseness', 0, 1, 0.05],
    ['Slot spacing', 'squad.slotSpacing', 10, 90, 1],
    ['Spread moving', 'squad.spreadMoving', 0.3, 3, 0.05],
    ['Spread idle', 'squad.spreadIdle', 0.3, 3, 0.05],
    ['Follow accel', 'squad.followAccel', 200, 5000, 50],
    ['Separation radius', 'squad.separationRadius', 10, 80, 1],
    ['Separation strength', 'squad.separationStrength', 0, 3000, 50],
    ['Leash', 'squad.leash', 40, 300, 5],
  ]],
  ['Grenade', [
    ['Range', 'grenade.range', 80, 600, 5],
    ['Blast radius', 'grenade.radius', 20, 250, 5],
    ['Damage', 'grenade.damage', 5, 300, 5],
    ['Fuse (s)', 'grenade.fuse', 0, 2, 0.05],
    ['Flight time (s)', 'grenade.flightTime', 0.1, 2, 0.05],
    ['Screen shake', 'grenade.shake', 0, 40, 1],
  ]],
  ['Downed / Revive', [
    ['Revive time (s)', 'revive.time', 0.5, 30, 0.5],
    ['Bleed-out (s)', 'revive.bleedOut', 3, 90, 1],
    ['Revive radius', 'revive.radius', 20, 150, 5],
    ['Revive HP fraction', 'revive.hpFrac', 0.05, 1, 0.05],
  ]],
  ['Mission & pickups', [
    ['Outpost hold (s)', 'mission.outpostHold', 1, 30, 0.5],
    ['Extraction countdown (s)', 'mission.extractionCountdown', 3, 90, 1],
    ['Wave 1 size', 'mission.wave1Size', 0, 15, 1],
    ['Wave 2 size', 'mission.wave2Size', 0, 15, 1],
    ['Wave 3 size', 'mission.wave3Size', 0, 15, 1],
    ['Defenders (restart)', 'mission.defenders', 0, 7, 1],
    ['Final wave size', 'mission.finalWaveSize', 0, 20, 1],
    ['Medkit squad heal (× max HP)', 'pickups.medkitHealFrac', 0, 1, 0.05],
  ]],
  ['Feel', [
    ['Camera smoothing', 'feel.cameraSmoothing', 1, 20, 0.5],
    ['Show accuracy cones', 'feel.showCones', 0, 1, 1],
  ]],
];

export class Tuning {
  private inputs: { path: string; input: HTMLInputElement; val: HTMLElement }[] = [];
  private jsonBox!: HTMLTextAreaElement;
  private invulnBtn!: HTMLButtonElement;
  private sizeSel!: HTMLSelectElement;

  constructor(private root: HTMLElement, private game: Game) {
    this.build();
  }

  toggle() {
    this.root.classList.toggle('hidden');
    this.refresh();
  }

  private build() {
    const r = this.root;
    r.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'tune-head';
    head.innerHTML = `<b>TUNING</b> <span class="dim">(\` to toggle · changes apply live)</span><button class="x">✕</button>`;
    head.querySelector('.x')!.addEventListener('click', () => this.toggle());
    r.appendChild(head);

    // debug actions
    const dbg = document.createElement('div');
    dbg.className = 'tune-sec';
    dbg.innerHTML = `<div class="tune-title">Debug</div>
      <div class="tune-btns">
        <label>Squad size <select><option>1</option><option>2</option><option>3</option></select></label>
        <button data-a="restart">Restart mission</button>
        <button data-a="spawnF">Spawn friendly</button>
        <button data-a="spawnE">Spawn enemy group</button>
        <button data-a="down">Down a soldier</button>
        <button data-a="invuln">Invulnerable: off</button>
      </div>`;
    this.sizeSel = dbg.querySelector('select')!;
    this.sizeSel.value = String(CFG.squad.startSize);
    this.sizeSel.addEventListener('change', () => { CFG.squad.startSize = +this.sizeSel.value; });
    this.invulnBtn = dbg.querySelector('[data-a="invuln"]')!;
    dbg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      const g = this.game;
      switch (b.dataset.a) {
        case 'restart': g.reset(+this.sizeSel.value); break;
        case 'spawnF': if (g.phase === 'playing') g.spawnSoldier(); break;
        case 'spawnE': if (g.phase === 'playing') g.debugSpawnGroup(); break;
        case 'down': if (g.phase === 'playing') g.debugDownSoldier(); break;
        case 'invuln': g.invuln = !g.invuln; break;
      }
      this.refresh();
    }));
    r.appendChild(dbg);

    // sliders
    for (const [title, sliders] of SECTIONS) {
      const sec = document.createElement('div');
      sec.className = 'tune-sec';
      sec.innerHTML = `<div class="tune-title">${title}</div>`;
      for (const [label, path, min, max, step] of sliders) {
        const row = document.createElement('div');
        row.className = 'tune-row';
        const def = getDefault(path);
        row.innerHTML = `<span class="lbl" title="${path} (default ${def})">${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span>`;
        const input = row.querySelector('input')!;
        const val = row.querySelector<HTMLElement>('.val')!;
        input.addEventListener('input', () => {
          setPath(path, +input.value);
          if (path === 'enemy.range' && CFG.enemy.range > CFG.infantry.range) CFG.enemy.range = CFG.infantry.range;
          if (path === 'infantry.range' && CFG.enemy.range > CFG.infantry.range) CFG.enemy.range = CFG.infantry.range;
          this.refresh();
        });
        this.inputs.push({ path, input, val });
        sec.appendChild(row);
      }
      r.appendChild(sec);
    }

    // export / import / reset
    const io = document.createElement('div');
    io.className = 'tune-sec';
    io.innerHTML = `<div class="tune-title">Config</div>
      <div class="tune-btns">
        <button data-a="export">Export JSON</button>
        <button data-a="import">Apply JSON below</button>
        <button data-a="reset">Reset to defaults</button>
      </div>
      <textarea spellcheck="false" placeholder="Exported JSON appears here. Paste JSON and press Apply to import."></textarea>
      <div class="dim tune-note"></div>`;
    this.jsonBox = io.querySelector('textarea')!;
    const note = io.querySelector<HTMLElement>('.tune-note')!;
    io.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      const json = JSON.stringify(CFG, null, 2);
      switch (b.dataset.a) {
        case 'export':
          this.jsonBox.value = json;
          navigator.clipboard?.writeText(json).then(() => (note.textContent = 'Copied to clipboard.'), () => (note.textContent = 'Select the text above to copy.'));
          break;
        case 'import':
          try { applyConfigJSON(this.jsonBox.value); note.textContent = 'Applied.'; } catch (e) { note.textContent = `Invalid JSON: ${(e as Error).message}`; }
          break;
        case 'reset': resetConfig(); note.textContent = 'Defaults restored.'; break;
      }
      this.refresh();
    }));
    r.appendChild(io);
    this.refresh();
  }

  refresh() {
    for (const { path, input, val } of this.inputs) {
      const v = getPath(path);
      if (document.activeElement !== input) input.value = String(v);
      const def = getDefault(path);
      val.textContent = String(Math.round(v * 100) / 100);
      val.classList.toggle('changed', v !== def);
    }
    if (this.invulnBtn) this.invulnBtn.textContent = `Invulnerable: ${this.game.invuln ? 'ON' : 'off'}`;
    if (this.sizeSel) this.sizeSel.value = String(CFG.squad.startSize);
  }
}

function getDefault(path: string): number {
  const [g, k] = path.split('.');
  return (DEFAULTS as any)[g][k];
}
