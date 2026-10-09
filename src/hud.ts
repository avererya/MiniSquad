// DOM HUD over the canvas (lives inside the scaled 1280x720 stage):
// objective, timer, soldier panels with ability buttons, start/end screens.
import type { Game, GameUI } from './game';
import type { Unit } from './unit';
import { CFG } from './config';
import { isMuted, setMuted, unlockAudio } from './audio';
import { Tuning } from './tuning';
import { Menus } from './menus';
import { TRAITS } from './traits';

interface PanelRefs { root: HTMLElement; btn: HTMLElement; cd: HTMLElement; act: HTMLElement; fill: HTMLElement; hpnum: HTMLElement; cls: HTMLElement; state: HTMLElement; unit: Unit }

const SHORT_ABILITY: Record<string, string> = { grenade: 'GRENADE', suppressive: 'SUPPRESS', fieldTreatment: 'TREAT' };

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
  readonly menus: Menus;

  constructor(private root: HTMLElement, tuningRoot: HTMLElement, menuRoot: HTMLElement, private game: Game) {
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
    this.menus = new Menus(menuRoot, game, () => this.toggleTuning());
  }

  toggleTuning() { this.tuning.toggle(); }
  refreshTuning() { this.tuning.refresh(); }

  rebuildPanels() {
    this.muteBtn.textContent = isMuted() ? '🔇' : '🔊';
    this.panelsEl.innerHTML = '';
    this.panels = this.game.soldiers.map((u, i) => {
      const root = document.createElement('div');
      const def = u.classDef!;
      const ab = u.ability!;
      root.className = 'panel';
      root.title = `${u.name} · ${def.label}${u.identity?.traitId ? ' · ' + TRAITS[u.identity.traitId].name : ''}`;
      root.dataset.cls = def.id;
      root.innerHTML = `
        <button class="ability cls-${def.id}" title="${ab.name} (${i + 1})" data-ability="${ab.id}">
          <div class="portrait"><div class="face"></div><div class="helmet"></div><div class="badge"></div></div>
          <div class="cd"></div><div class="act"></div><span class="key">${i + 1}</span><span class="icon">${ab.icon}</span>
        </button>
        <div class="info"><div class="name">${u.name}</div><div class="cls">${def.label}</div><div class="hp"><div class="fill"></div><span class="hpnum"></span></div><div class="state"></div></div>`;
      const btn = root.querySelector<HTMLElement>('.ability')!;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); unlockAudio();
        this.game.useAbility(u);
      });
      this.panelsEl.appendChild(root);
      return {
        root, btn, unit: u, cd: root.querySelector('.cd')!, act: root.querySelector('.act')!, fill: root.querySelector('.fill')!,
        hpnum: root.querySelector('.hpnum')!, cls: root.querySelector('.cls')!, state: root.querySelector('.state')!,
      };
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
      this.hint.className = '';
      this.hint.style.display = '';
    } else if (g.notice) {
      this.hint.textContent = g.notice.text;
      this.hint.className = 'deny';
      this.hint.style.display = '';
    } else this.hint.style.display = 'none';

    for (const p of this.panels) {
      const u = p.unit;
      const ab = u.ability!;
      const def = u.classDef!;
      p.fill.style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
      p.hpnum.textContent = `${Math.ceil(Math.max(0, u.hp))}/${u.maxHp}`;
      p.cls.textContent = u.rapidFire > 0 && u.active ? `${def.label} · RAPID ${Math.ceil(u.rapidFire)}s` : def.label;
      const abName = SHORT_ABILITY[ab.id] ?? ab.name.toUpperCase();
      let state: string, cls = 'ok';
      if (u.state === 'downed') {
        cls = 'downed';
        state = u.reviving
          ? `REVIVING ${Math.floor(u.reviveProgress * 100)}%${u.reviver ? ` · ${u.reviver.name}` : ''}`
          : `DOWN — ${Math.ceil(u.bleed)}s`;
      } else if (u.state === 'kia') { cls = 'kia'; state = 'KIA'; }
      else if (ab.activeLeft > 0) { cls = 'ok active'; state = `${abName} ON ${Math.ceil(ab.activeLeft)}s`; }
      else if (ab.cooldownLeft > 0) { cls = 'ok cooling'; state = `${abName} ${Math.ceil(ab.cooldownLeft)}s`; }
      else state = `${abName} READY`;
      p.state.textContent = state;
      p.root.className = `panel ${cls}`;
      const cdFrac = u.active ? ab.cooldownLeft / ab.cooldown() : 1;
      // while an effect runs, the button shows its remaining duration instead of the cooldown
      const running = u.active && ab.activeLeft > 0;
      p.cd.style.height = running ? '0%' : `${Math.min(100, cdFrac * 100)}%`;
      p.act.style.width = running ? `${Math.min(100, (ab.activeLeft / CFG.suppressive.duration) * 100)}%` : '0%';
      p.btn.classList.toggle('disabled', !u.active);
      p.btn.classList.toggle('ready', ab.ready(u));
      p.btn.classList.toggle('running', running);
      p.btn.classList.toggle('targeting', g.targeting === u);
    }
  }

  hideOverlay() { this.overlay.style.display = 'none'; this.overlay.innerHTML = ''; this.menus.hide(); }

  /** Barracks (launch screen and "Return to Barracks"). */
  showStart(notice?: string) { this.hideOverlay(); this.menus.showBarracks(notice); }

  /** Mission Results (victory or defeat). */
  showEnd() { this.menus.showResults(); }

  /** The roster object was replaced (dev save reset): redraw the Barracks if it is open. */
  rosterChanged() { if (this.menus.screen === 'barracks') this.menus.showBarracks('Roster reset to defaults.'); }

  get rootEl() { return this.root; }
}
