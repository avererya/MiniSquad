// DOM HUD over the canvas (lives inside the scaled 1280x720 stage):
// objective, timer, soldier panels with ability buttons, start/end screens.
import type { Game, GameUI } from './game';
import type { Unit } from './unit';
import { CFG } from './config';
import { isMuted, setMuted, unlockAudio } from './audio';
import { Tuning } from './tuning';

interface PanelRefs { root: HTMLElement; btn: HTMLElement; cd: HTMLElement; fill: HTMLElement; state: HTMLElement; unit: Unit }

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class Hud implements GameUI {
  private objText: HTMLElement;
  private objSub: HTMLElement;
  private objBar: HTMLElement;
  private objBarFill: HTMLElement;
  private timer: HTMLElement;
  private hint: HTMLElement;
  private panelsEl: HTMLElement;
  private overlay: HTMLElement;
  private muteBtn: HTMLElement;
  private panels: PanelRefs[] = [];
  private tuning: Tuning;

  constructor(private root: HTMLElement, tuningRoot: HTMLElement, private game: Game) {
    root.innerHTML = `
      <div id="objective"><div class="obj-text"></div><div class="obj-sub"></div><div class="obj-bar"><div></div></div></div>
      <div id="timer"></div>
      <div id="topbtns"><button data-a="mute">🔊</button><button data-a="pause">⏸</button><button data-a="tune">⚙</button></div>
      <div id="hint"></div>
      <div id="panels"></div>
      <div id="overlay"></div>`;
    this.objText = root.querySelector('.obj-text')!;
    this.objSub = root.querySelector('.obj-sub')!;
    this.objBar = root.querySelector('.obj-bar')!;
    this.objBarFill = root.querySelector('.obj-bar div')!;
    this.timer = root.querySelector('#timer')!;
    this.hint = root.querySelector('#hint')!;
    this.panelsEl = root.querySelector('#panels')!;
    this.overlay = root.querySelector('#overlay')!;
    this.muteBtn = root.querySelector('[data-a="mute"]')!;
    root.querySelectorAll<HTMLElement>('#topbtns button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); unlockAudio();
        const a = b.dataset.a;
        if (a === 'mute') { setMuted(!isMuted()); this.rebuildPanels(); }
        else if (a === 'pause') { if (game.phase === 'playing') game.paused = !game.paused; }
        else if (a === 'tune') this.toggleTuning();
      });
    });
    this.tuning = new Tuning(tuningRoot, game);
  }

  toggleTuning() { this.tuning.toggle(); }
  refreshTuning() { this.tuning.refresh(); }

  rebuildPanels() {
    this.muteBtn.textContent = isMuted() ? '🔇' : '🔊';
    this.panelsEl.innerHTML = '';
    this.panels = this.game.soldiers.map((u, i) => {
      const root = document.createElement('div');
      root.className = 'panel';
      root.innerHTML = `
        <button class="ability" title="Grenade (${i + 1})">
          <div class="portrait"><div class="face"></div><div class="helmet"></div></div>
          <div class="cd"></div><span class="key">${i + 1}</span><span class="icon">●</span>
        </button>
        <div class="info"><div class="name">${u.name}</div><div class="hp"><div class="fill"></div></div><div class="state"></div></div>`;
      const btn = root.querySelector<HTMLElement>('.ability')!;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); unlockAudio();
        this.game.beginTargeting(u);
      });
      this.panelsEl.appendChild(root);
      return { root, btn, unit: u, cd: root.querySelector('.cd')!, fill: root.querySelector('.fill')!, state: root.querySelector('.state')! };
    });
  }

  update() {
    const g = this.game;
    const o = g.objective;
    this.objText.textContent = o.text;
    this.objSub.textContent = o.sub ?? '';
    this.objSub.style.display = o.sub ? '' : 'none';
    this.objBar.style.display = o.progress !== undefined ? '' : 'none';
    if (o.progress !== undefined) this.objBarFill.style.width = `${Math.min(100, o.progress * 100)}%`;
    this.timer.textContent = g.phase === 'start' ? '' : fmtTime(g.time) + (g.invuln ? '  [INVULN]' : '');

    if (g.targeting) {
      this.hint.textContent = `${g.targeting.name}: GRENADE — click/tap the ground · right-click / Esc / tap button to cancel`;
      this.hint.style.display = '';
    } else this.hint.style.display = 'none';

    for (const p of this.panels) {
      const u = p.unit;
      const ab = u.ability!;
      p.fill.style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
      let state = 'OK', cls = 'ok';
      if (u.state === 'downed') {
        cls = 'downed';
        state = u.reviving
          ? `REVIVING ${Math.floor((u.reviveProgress / CFG.revive.time) * 100)}%`
          : `DOWN — ${Math.ceil(u.bleed)}s`;
      } else if (u.state === 'kia') { cls = 'kia'; state = 'KIA'; }
      else if (u.rapidFire > 0) state = `RAPID FIRE ${Math.ceil(u.rapidFire)}s`;
      p.state.textContent = state;
      p.root.className = `panel ${cls}`;
      const cdFrac = u.active ? ab.cooldownLeft / ab.cooldown() : 1;
      p.cd.style.height = `${Math.min(100, cdFrac * 100)}%`;
      p.btn.classList.toggle('disabled', !u.active);
      p.btn.classList.toggle('ready', ab.ready(u));
      p.btn.classList.toggle('targeting', g.targeting === u);
    }
  }

  hideOverlay() { this.overlay.style.display = 'none'; this.overlay.innerHTML = ''; }

  showStart() {
    this.overlay.style.display = 'flex';
    this.overlay.innerHTML = `
      <div class="card">
        <h1>MINISQUAD</h1>
        <div class="sub">Combat Prototype v0.1 — Secure the Communications Outpost</div>
        <div class="controls">
          <div><b>Move</b> WASD / arrows · touch: drag left side</div>
          <div><b>Grenade</b> 1 / 2 / 3 or tap portrait, then click/tap ground · right-click / Esc cancels</div>
          <div><b>Tuning panel</b> \` (backtick) or ⚙ · <b>Mute</b> M · <b>Pause</b> P</div>
          <div class="dim">Debug keys: F spawn friendly · G spawn enemies · K down a soldier · I invulnerable · Shift+R restart</div>
        </div>
        <button class="big" data-a="start">START MISSION</button>
      </div>`;
    this.overlay.querySelector('[data-a="start"]')!.addEventListener('click', () => { unlockAudio(); this.game.reset(); });
  }

  showEnd() {
    const g = this.game;
    const won = g.phase === 'won';
    const rows = g.soldiers.map((s) => {
      const st = s.state === 'active' ? 'OK' : s.state === 'downed' ? 'DOWNED' : 'KIA';
      return `<div class="row"><span>${s.name}</span><span class="${st === 'OK' ? 'okc' : 'kiac'}">${st}</span></div>`;
    }).join('');
    this.overlay.style.display = 'flex';
    this.overlay.innerHTML = `
      <div class="card ${won ? 'won' : 'lost'}">
        <h1>${won ? 'MISSION COMPLETE' : 'MISSION FAILED'}</h1>
        <div class="sub">${won ? 'The squad made it out.' : 'The whole squad is down.'}</div>
        <div class="row"><span>Mission time</span><span>${fmtTime(g.time)}</span></div>
        ${rows}
        <button class="big" data-a="restart">RESTART</button>
        <div class="dim">or press Enter</div>
      </div>`;
    this.overlay.querySelector('[data-a="restart"]')!.addEventListener('click', () => this.game.reset());
  }

  get rootEl() { return this.root; }
}
