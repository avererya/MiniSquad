// Settings panel (⚙ / backtick). Players see only the normal settings (Performance) and the version.
// v0.8B.2: the developer tuning (live CFG sliders incl. class / enemy HP and damage, JSON export / import, reset,
// debug actions) is built only with `?dev=1` in the URL. It is never stored: CFG lives in memory, so a reload
// without `?dev=1` always plays the shipped defaults, and normal play resets CFG to them explicitly at start-up.
import { DEFAULT_FPS_CAP, fpsCapChosen, fpsCapFromUrl, isMobileDevice, perfSettings, setPerfSettings } from './perf';
import { VERSION_LABEL } from './version';
import { CFG, DEFAULTS, applyConfigJSON, getPath, resetConfig, setPath } from './config';
import type { Game } from './game';
import { CLASS_IDS, PRESETS } from './classes';
import { CAMPAIGN } from './campaign';

type S = [label: string, path: string, min: number, max: number, step: number];

/** v0.8B.2: developer tuning only with `?dev=1` (or `?dev`) in the URL, read once per page load, never saved. */
export function devTuningEnabled(search = location.search): boolean {
  const v = new URLSearchParams(search).get('dev');
  return v !== null && v !== '0' && v !== 'false';
}

const classSliders = (c: string): S[] => [
  ['HP', `${c}.hp`, 20, 400, 5],
  ['Damage', `${c}.damage`, 1, 60, 1],
  ['Fire rate (/s)', `${c}.fireRate`, 0.5, 15, 0.1],
  ['Spread still (° full cone)', `${c}.accuracy`, 0, 45, 0.5],
  ['Moving penalty (+° at full speed)', `${c}.movePenalty`, 0, 60, 0.5],
  ['Move speed (px/s; 150 = 100%)', `${c}.moveSpeed`, 40, 350, 2.5],
  ['Projectile speed', `${c}.projectileSpeed`, 200, 2000, 10],
  ['Revive time (s, as reviver)', `${c}.reviveTime`, 0.5, 30, 0.5],
  ['Range', `${c}.range`, 100, 640, 5],
  ['Aim turn rate', `${c}.turnRate`, 1, 40, 0.5],
];

const SECTIONS: [string, S[]][] = [
  ['Infantry', classSliders('infantry')],
  ['Heavy Gunner', classSliders('heavy')],
  ['Medic', classSliders('medic')],
  ['Commando (v0.8A)', classSliders('commando')],
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
    ['Anchor speed: slowest→average', 'squad.anchorSpeedBlend', 0, 1, 0.05],
    ['Anchor speed factor', 'squad.anchorSpeedFactor', 0.5, 1.2, 0.01],
    ['Catch-up starts (px behind)', 'squad.catchUpDist', 0, 300, 5],
    ['Catch-up ramp (px)', 'squad.catchUpRange', 10, 400, 5],
    ['Catch-up max boost (×)', 'squad.catchUpBoost', 0, 1, 0.05],
  ]],
  ['Grenade (Infantry)', [
    ['Cooldown (s)', 'grenade.cooldown', 0.5, 30, 0.5],
    ['Range', 'grenade.range', 80, 600, 5],
    ['Blast radius', 'grenade.radius', 20, 250, 5],
    ['Damage', 'grenade.damage', 5, 300, 5],
    ['Fuse (s)', 'grenade.fuse', 0, 2, 0.05],
    ['Flight time (s)', 'grenade.flightTime', 0.1, 2, 0.05],
    ['Screen shake', 'grenade.shake', 0, 40, 1],
  ]],
  ['Suppressive Fire (Heavy)', [
    ['Fire-rate multiplier', 'suppressive.fireRateMul', 1, 4, 0.05],
    ['Duration (s)', 'suppressive.duration', 0.5, 20, 0.5],
    ['Cooldown (s)', 'suppressive.cooldown', 1, 60, 0.5],
  ]],
  ['Bullet Storm (Commando)', [
    ['Fire-rate multiplier', 'bulletStorm.fireRateMul', 1, 4, 0.05],
    ['Gunslinger multiplier', 'bulletStorm.gunslingerMul', 1, 4, 0.05],
    ['Duration (s)', 'bulletStorm.duration', 1, 20, 0.5],
    ['Cooldown after it ends (s)', 'bulletStorm.cooldown', 1, 90, 1],
    ['Moving penalty while active (×)', 'bulletStorm.movePenaltyMul', 0, 1, 0.05],
  ]],
  ['Enemy awareness (v0.8A)', [
    ['Alert radius (px)', 'awareness.radius', 0, 800, 10],
    ['Reaction min (s)', 'awareness.reactMin', 0, 2, 0.05],
    ['Reaction max (s)', 'awareness.reactMax', 0, 3, 0.05],
    ['Sight range (px)', 'awareness.sightRange', 100, 800, 10],
    ['Search time (s)', 'awareness.searchTime', 0, 60, 1],
  ]],
  ['Extraction pressure (v0.8A)', [
    ['Min spawn distance (px)', 'extractionPressure.minDist', 200, 1200, 20],
    ['Light group', 'extractionPressure.light', 0, 10, 1],
    ['Small group', 'extractionPressure.small', 0, 10, 1],
    ['Moderate: first group', 'extractionPressure.moderateA', 0, 10, 1],
    ['Moderate: second group', 'extractionPressure.moderateB', 0, 10, 1],
    ['Strong: first group', 'extractionPressure.strongA', 0, 10, 1],
    ['Strong: second group', 'extractionPressure.strongB', 0, 10, 1],
  ]],
  ['Artillery (Mission 12)', [
    ['Spotlight exposure to alert (s)', 'artillery.exposure', 0.2, 5, 0.1],
    ['Warning before impact (s)', 'artillery.warn', 0.5, 6, 0.1],
    ['Shell interval (s)', 'artillery.interval', 3, 30, 0.5],
    ['Shell damage (exposed)', 'artillery.damage', 0, 150, 5],
    ['Cover multiplier', 'artillery.coverMul', 0, 1, 0.05],
    ['Alert clears after (s)', 'artillery.clearAfter', 5, 60, 1],
  ]],
  ['Field Treatment (Medic)', [
    ['Heal (× max HP)', 'fieldTreatment.healFrac', 0, 1, 0.05],
    ['Radius (px)', 'fieldTreatment.radius', 20, 400, 5],
    ['Cooldown (s)', 'fieldTreatment.cooldown', 1, 60, 0.5],
  ]],
  ['Downed / Revive', [
    ['Bleed-out (s)', 'revive.bleedOut', 3, 90, 1],
    ['Critical warning (last s)', 'revive.criticalTime', 0, 15, 1],
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
  ['Elite passives (v0.7A)', [
    ['Adrenaline Rush: HP threshold', 'elite.adrenalineThreshold', 0.1, 0.8, 0.05],
    ['Adrenaline Rush: damage cut', 'elite.adrenalineReduction', 0, 0.6, 0.05],
    ['Deadeye: every Nth hit', 'elite.deadeyeEvery', 2, 10, 1],
    ['Deadeye: bonus damage', 'elite.deadeyeBonus', 0, 1.5, 0.05],
    ['Ironclad: damage cut', 'elite.ironcladReduction', 0, 0.6, 0.05],
    ['Overdrive: max fire-rate bonus', 'elite.overdriveMax', 0, 1, 0.05],
    ['Overdrive: build-up (s)', 'elite.overdriveBuild', 0.5, 15, 0.5],
    ['Miracle Worker: revive speed ×', 'elite.miracleReviveSpeed', 1, 3, 0.05],
    ['Miracle Worker: revive HP', 'elite.miracleHpFrac', 0.1, 1, 0.05],
    ['Rally: radius (px)', 'elite.rallyRadius', 40, 400, 5],
    ['Rally: damage bonus', 'elite.rallyDamage', 0, 0.5, 0.01],
    ['Rally: speed bonus', 'elite.rallySpeed', 0, 0.5, 0.01],
    ['Phantom Shot: every Nth hit', 'elite.phantomEvery', 2, 10, 1],
    ['Phantom Shot: armor ignored', 'elite.phantomPen', 0, 1, 0.05],
    ['Perfect Aim: charge (s)', 'elite.perfectAimCharge', 0.5, 10, 0.25],
    ['Perfect Aim: bonus damage', 'elite.perfectAimBonus', 0, 2, 0.05],
  ]],
  ['Tactical Support (v0.7C)', [
    ['Airstrike: blast radius (px)', 'airstrike.radius', 40, 300, 5],
    ['Airstrike: delay (s)', 'airstrike.delay', 0.5, 6, 0.25],
    ['Airstrike: damage (centre)', 'airstrike.damage', 20, 800, 10],
    ['Airstrike: rim share', 'airstrike.edgeFrac', 0, 1, 0.05],
    ['Airstrike: boss (× max HP)', 'airstrike.bossFrac', 0, 0.5, 0.01],
    ['Nuke: countdown (s)', 'nuke.countdown', 5, 60, 1],
    ['Nuke: damage', 'nuke.damage', 50, 3000, 50],
    ['Nuke: boss (× max HP)', 'nuke.bossFrac', 0, 0.9, 0.01],
    ['Support: boss HP floor', 'support.bossFloor', 0.01, 0.5, 0.01],
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
  private presetSel!: HTMLSelectElement;
  private missionSel!: HTMLSelectElement;
  private fpsSel!: HTMLSelectElement;
  private ovBox!: HTMLInputElement;
  private fpsNote!: HTMLElement;

  /** v0.8B.2: true when this page load shows the developer tuning (`?dev=1`). */
  readonly dev: boolean;

  constructor(private root: HTMLElement, private game: Game, dev = devTuningEnabled()) {
    this.dev = dev;
    // normal play always runs the shipped numbers (CFG is never persisted; this makes it explicit)
    if (!dev) resetConfig();
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
    head.innerHTML = this.dev
      ? `<b>SETTINGS · DEV TUNING</b> <span class="dim">(\` to toggle · live, this page load only, never saved)</span><button class="x">✕</button>`
      : `<b>SETTINGS</b><button class="x">✕</button>`;
    head.querySelector('.x')!.addEventListener('click', () => this.toggle());
    r.appendChild(head);
    if (this.dev) this.buildDebug(r);
    this.buildPerf(r);
    if (this.dev) this.buildDev(r);

    const ver = document.createElement('div');
    ver.className = 'tune-version';
    ver.textContent = VERSION_LABEL;
    r.appendChild(ver);
    this.refresh();
  }

  private buildDebug(r: HTMLElement) {

    // debug actions
    const dbg = document.createElement('div');
    dbg.className = 'tune-sec';
    dbg.innerHTML = `<div class="tune-title">Debug</div>
      <div class="tune-btns">
        <label title="Dev presets deploy anonymous generic soldiers (class stats only, no traits). They never change the saved roster or squad.">Squad preset <select><option value="" disabled>(Barracks squad)</option>${PRESETS.map((p) => `<option value="${p.id}">${p.label} (generic)</option>`).join('')}</select></label>
        <button data-a="restart">Restart mission</button>
        <button data-a="barracks">Barracks</button>
        <button data-a="spawnF">Spawn friendly</button>
        <button data-a="spawnE">Spawn enemy group</button>
        <button data-a="down">Down a soldier</button>
        <button data-a="invuln">Invulnerable: off</button>
        <button data-a="resetSave" class="danger">Reset save (roster, credits, training)…</button>
        <button data-a="unlockAll" class="danger" title="Marks every playable mission and every soldier as unlocked IN YOUR SAVE (XP, credits, training untouched). Cannot be undone except by Reset save.">Unlock all missions + soldiers (modifies save)…</button>
        <button data-a="promoReady" class="danger" title="Every owned Recruit jumps to Recruit Level 25 and Credits are topped up to 25,000, IN YOUR SAVE (for testing Elite promotions).">Promotion test: Recruits to LV 25 + 25,000 CR (modifies save)…</button>
        <label title="Dev: start any mission (locked missions pay no rewards and unlock nothing)">Mission <select data-k="mission">${CAMPAIGN.filter((m) => m.playable).map((m) => `<option value="${m.id}">${m.number}. ${m.name}</option>`).join('')}</select></label>
      </div>`;
    this.presetSel = dbg.querySelector('select')!;
    this.missionSel = dbg.querySelector('select[data-k="mission"]')!;
    this.missionSel.addEventListener('change', () => {
      const g = this.game;
      g.selectMission(this.missionSel.value, true);
      if (g.phase !== 'start') g.reset(); // same squad, chosen mission
      this.refresh();
    });
    // picking a preset restarts the mission right away with that squad
    this.presetSel.addEventListener('change', () => {
      const p = PRESETS.find((x) => x.id === this.presetSel.value);
      if (p) this.game.reset(p.classes);
      this.refresh();
    });
    this.invulnBtn = dbg.querySelector('[data-a="invuln"]')!;
    dbg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      const g = this.game;
      switch (b.dataset.a) {
        case 'restart': g.reset(); break;
        case 'barracks': if (g.phase !== 'start') g.toBarracks(); break;
        case 'resetSave':
          // two-step confirmation: first tap arms it for 4 s, second tap wipes the save
          if (b.dataset.armed) {
            delete b.dataset.armed; b.textContent = 'Reset save (roster, credits, training)…';
            g.resetRosterSave?.();
          } else {
            b.dataset.armed = '1'; b.textContent = 'Tap again to reset ALL progress';
            window.setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Reset save (roster, credits, training)…'; } }, 4000);
          }
          break;
        case 'unlockAll':
          if (b.dataset.armed) {
            delete b.dataset.armed; b.textContent = 'Unlock all missions + soldiers (modifies save)…';
            g.debugUnlockAll?.();
          } else {
            b.dataset.armed = '1'; b.textContent = 'Tap again: unlock everything IN THE SAVE';
            window.setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Unlock all missions + soldiers (modifies save)…'; } }, 4000);
          }
          break;
        case 'promoReady':
          if (b.dataset.armed) {
            delete b.dataset.armed; b.textContent = 'Promotion test: Recruits to LV 25 + 25,000 CR (modifies save)…';
            if (g.phase === 'start') g.debugPromotionReady?.();
          } else {
            b.dataset.armed = '1'; b.textContent = 'Tap again: LV 25 + Credits IN THE SAVE';
            window.setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Promotion test: Recruits to LV 25 + 25,000 CR (modifies save)…'; } }, 4000);
          }
          break;
        case 'spawnF': if (g.phase === 'playing') g.spawnSoldier(); break;
        case 'spawnE': if (g.phase === 'playing') g.debugSpawnGroup(); break;
        case 'down': if (g.phase === 'playing') g.debugDownSoldier(); break;
        case 'invuln': g.invuln = !g.invuln; break;
      }
      this.refresh();
    }));
    r.appendChild(dbg);
  }

  private buildPerf(r: HTMLElement) {
    // Performance (v0.6.3; v0.6.4: 30 FPS default on mobile, 60 on desktop), stored apart from the save
    const pf = document.createElement('div');
    pf.className = 'tune-sec';
    const dflt = (c: number) => (c === DEFAULT_FPS_CAP ? ' (default)' : '');
    pf.innerHTML = `<div class="tune-title">Performance</div>
      <div class="tune-btns">
        <label title="Render frame-rate cap. The simulation always runs fixed 1/60 s steps, so gameplay is identical at 30 and 60.">Frame cap <select data-k="fps"><option value="30">30 FPS${dflt(30)}</option><option value="60">60 FPS${dflt(60)}</option></select></label>
        <label><input type="checkbox" data-k="perfov"> Performance overlay</label>
      </div>
      <div class="dim tune-note" data-k="fpsnote"></div>`;
    this.fpsSel = pf.querySelector<HTMLSelectElement>('select[data-k="fps"]')!;
    this.ovBox = pf.querySelector<HTMLInputElement>('input[data-k="perfov"]')!;
    this.fpsNote = pf.querySelector<HTMLElement>('[data-k="fpsnote"]')!;
    this.fpsSel.addEventListener('change', () => { setPerfSettings({ fpsCap: this.fpsSel.value === '30' ? 30 : 60 }); this.refreshPerf(); });
    this.ovBox.addEventListener('change', () => { setPerfSettings({ overlay: this.ovBox.checked }); this.refreshPerf(); });
    this.refreshPerf();
    r.appendChild(pf);
  }

  /** Developer tuning: every CFG slider section and the JSON export / import / reset (`?dev=1` only). */
  private buildDev(r: HTMLElement) {
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
          // enemies must never out-range the squad (they'd fire from off screen)
          // (v0.8A: the Commando is a deliberately short-range class and is left out of this rule)
          const minRange = Math.min(...CLASS_IDS.filter((c) => c !== 'commando').map((c) => CFG[c].range));
          if (CFG.enemy.range > minRange) CFG.enemy.range = minRange;
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
          try {
            const notes = applyConfigJSON(this.jsonBox.value);
            note.textContent = `Applied.${notes.length ? ' ' + notes.join('; ') + '.' : ''}`;
          } catch (e) { note.textContent = `Invalid JSON: ${(e as Error).message}`; }
          break;
        case 'reset': resetConfig(); note.textContent = 'Defaults restored.'; break;
      }
      this.refresh();
    }));
    r.appendChild(io);
  }

  /** Shows the ACTIVE frame cap and overlay state (explicit pick, device default or URL override). */
  private refreshPerf() {
    const p = perfSettings();
    this.fpsSel.value = String(p.fpsCap);
    this.ovBox.checked = p.overlay;
    this.fpsNote.textContent = fpsCapFromUrl() ? `Active: ${p.fpsCap} FPS (?fps= in the URL, not saved)` : fpsCapChosen() ? `Active: ${p.fpsCap} FPS (your choice)` : `Active: ${p.fpsCap} FPS (${isMobileDevice() ? 'mobile' : 'desktop'} default)`;
  }

  refresh() {
    if (this.fpsSel) this.refreshPerf();
    for (const { path, input, val } of this.inputs) {
      const v = getPath(path);
      if (document.activeElement !== input) input.value = String(v);
      const def = getDefault(path);
      val.textContent = String(Math.round(v * 100) / 100);
      val.classList.toggle('changed', v !== def);
    }
    if (this.invulnBtn) this.invulnBtn.textContent = `Invulnerable: ${this.game.invuln ? 'ON' : 'off'}`;
    if (this.missionSel) this.missionSel.value = this.game.missionId;
    if (this.presetSel) {
      const cur = this.game.composition.join(',');
      const p = this.game.deployment.kind === 'generic' ? PRESETS.find((x) => x.classes.join(',') === cur) : undefined;
      this.presetSel.value = p ? p.id : '';
    }
  }
}

function getDefault(path: string): number {
  const [g, k] = path.split('.');
  return (DEFAULTS as any)[g][k];
}
