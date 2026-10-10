// DOM HUD over the canvas (lives inside the scaled 1280x720 stage):
// objective (+ optional objectives), timer, soldier panels with ability buttons.
// SCALING (v0.4): squads of 1-3 use the full panels (portrait button + name, class, HP,
// state). Squads of 4-6 switch to compact tiles: the same 74 px ability button (tap target
// unchanged) with the name, a thin HP bar and a short state under it, in one row of 4 or two
// rows of 3, bottom right. Keys 1-6 map to the tiles in order.
import type { Game, GameUI } from './game';
import type { Unit } from './unit';
import { CFG } from './config';
import { isMuted, setMuted, unlockAudio } from './audio';
import { Tuning } from './tuning';
import { Menus } from './menus';
import { TRAITS } from './traits';

interface PanelRefs { root: HTMLElement; btn: HTMLElement; cd: HTMLElement; act: HTMLElement; fill: HTMLElement; hpnum: HTMLElement; cls: HTMLElement; state: HTMLElement; unit: Unit }

const SHORT_ABILITY: Record<string, string> = { grenade: 'GRENADE', suppressive: 'SUPPRESS', fieldTreatment: 'TREAT', focus: 'FOCUS' };

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class Hud implements GameUI {
  private objText: HTMLElement;
  private objSub: HTMLElement;
  private objBar: HTMLElement;
  private objBarFill: HTMLElement;
  private objOpt: HTMLElement;
  private optKey = '';
  private objChips!: HTMLElement;
  private chipsKey = '';
  private objMeter!: HTMLElement;
  private objBoss!: HTMLElement;
  private timer: HTMLElement;
  private hint: HTMLElement;
  private panelsEl: HTMLElement;
  private overlay: HTMLElement;
  private muteBtn: HTMLElement;
  private panels: PanelRefs[] = [];
  private xwarn: HTMLElement;
  private xwarnKey = '';
  private tuning: Tuning;
  readonly menus: Menus;

  constructor(private root: HTMLElement, tuningRoot: HTMLElement, menuRoot: HTMLElement, private game: Game) {
    root.innerHTML = `
      <div id="objective"><div class="obj-text"></div><div class="obj-sub"></div><div class="obj-bar"><div></div></div><div class="obj-chips"></div><div class="obj-meter"><span class="om-l"></span><div class="om-bar"><div></div></div><span class="om-v"></span></div><div class="obj-boss"><div class="ob-name">IRON WARDEN</div><div class="ob-bar"><div class="ob-fill"></div><i style="left:65%"></i><i style="left:30%"></i></div><div class="ob-state"></div></div><div class="obj-opt"></div></div>
      <div id="timer"></div>
      <div id="topbtns"><button data-a="mute">🔊</button><button data-a="pause">⏸</button><button data-a="tune">⚙</button></div>
      <div id="hint"></div>
      <div id="panels"></div>
      <div id="xwarn" role="alert" style="display:none"><div class="xw-title"></div><div class="xw-body"></div><div class="xw-btns"><button data-x="stay">STAY AND RESCUE</button><button data-x="go">CONFIRM EXTRACTION</button></div></div>
      <div id="overlay"></div>`;
    this.objText = root.querySelector('.obj-text')!;
    this.objSub = root.querySelector('.obj-sub')!;
    this.objBar = root.querySelector('.obj-bar')!;
    this.objBarFill = root.querySelector('.obj-bar div')!;
    this.objOpt = root.querySelector('.obj-opt')!;
    this.objChips = root.querySelector('.obj-chips')!;
    this.objMeter = root.querySelector('.obj-meter')!;
    this.objBoss = root.querySelector('.obj-boss')!;
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
    // v0.6 abandonment warning: never pauses anything; only its two buttons take touches (the
    // rest of the box lets touches through to the joystick / canvas)
    this.xwarn = root.querySelector('#xwarn')!;
    this.xwarn.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); unlockAudio();
        if (b.disabled) return;
        const done = b.dataset.x === 'go' ? game.confirmExtraction() : game.stayAndRescue();
        if (done) { this.xwarn.style.display = 'none'; this.xwarnKey = ''; } // closes at once (and can reopen on a new attempt)
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
    const n = this.game.soldiers.length;
    this.panelsEl.className = n >= 4 ? `compact rows${n >= 5 ? 2 : 1}` : '';
    this.root.classList.toggle('hud-compact2', n >= 5);
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
    this.updateWidgets();
    this.timer.textContent = g.phase === 'start' ? '' : fmtTime(g.time) + (g.invuln ? '  [INVULN]' : '');
    // optional objectives: one line each, re-rendered only when something changes
    const m = g.mission;
    const opt = g.phase === 'start' ? [] : m.optionals.map((o) => ({ s: o.state, t: `${o.state === 'complete' ? '✓' : o.state === 'failed' ? '✗' : '◇'} ${o.label}${o.status(m) && o.state === 'active' ? ` — ${o.status(m)}` : ''}` }));
    const key = opt.map((x) => x.s + x.t).join('|');
    if (key !== this.optKey) {
      this.optKey = key;
      this.objOpt.innerHTML = opt.map((x) => `<div class="${x.s}">${x.t.replace(/[<>&]/g, '')}</div>`).join('');
      this.objOpt.style.display = opt.length ? '' : 'none';
    }

    if (g.targeting) {
      this.hint.textContent = `${g.targeting.name}: GRENADE — click/tap the ground · right-click / Esc / tap button to cancel`;
      this.hint.className = '';
      this.hint.style.display = '';
    } else if (g.notice) {
      this.hint.textContent = g.notice.text;
      this.hint.className = 'deny';
      this.hint.style.display = '';
    } else this.hint.style.display = 'none';

    this.updateWarning();

    const compact = this.panels.length >= 4;
    const crit = CFG.revive.criticalTime;
    for (const p of this.panels) {
      const u = p.unit;
      const ab = u.ability!;
      const def = u.classDef!;
      p.fill.style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
      p.hpnum.textContent = `${Math.ceil(Math.max(0, u.hp))}/${Math.round(u.maxHp)}`;
      p.cls.textContent = u.rapidFire > 0 && u.active ? `${def.label} · RAPID ${Math.ceil(u.rapidFire)}s` : def.label;
      const abName = compact ? '' : `${SHORT_ABILITY[ab.id] ?? ab.name.toUpperCase()} `;
      let state: string, cls = 'ok';
      if (u.state === 'downed') {
        cls = u.reviving ? 'downed reviving' : u.bleed <= crit ? 'downed critical' : 'downed';
        state = u.reviving
          ? compact ? `REV ${Math.floor(u.reviveProgress * 100)}% ⏸` : `REVIVING ${Math.floor(u.reviveProgress * 100)}% · ${Math.ceil(u.bleed)}s ⏸`
          : u.bleed <= crit ? `CRITICAL ${Math.ceil(u.bleed)}s` : compact ? `DOWN ${Math.ceil(u.bleed)}s` : `DOWN — ${Math.ceil(u.bleed)}s`;
      } else if (u.state === 'kia') { cls = 'kia'; state = 'KIA'; }
      else if (ab.activeLeft > 0) { cls = 'ok active'; state = `${abName}ON ${Math.ceil(ab.activeLeft)}s`; }
      else if (ab.cooldownLeft > 0) { cls = 'ok cooling'; state = `${abName}${Math.ceil(ab.cooldownLeft)}s`; }
      else state = `${abName}READY`;
      p.state.textContent = state;
      p.root.className = `panel ${cls}`;
      const cdFrac = u.active ? ab.cooldownLeft / ab.cooldown() : 1;
      // while an effect runs, the button shows its remaining duration instead of the cooldown
      const running = u.active && ab.activeLeft > 0;
      p.cd.style.height = running ? '0%' : `${Math.min(100, cdFrac * 100)}%`;
      const dur = ab.id === 'focus' ? CFG.focus.duration : CFG.suppressive.duration;
      p.act.style.width = running ? `${Math.min(100, (ab.activeLeft / dur) * 100)}%` : '0%';
      p.btn.classList.toggle('disabled', !u.active);
      p.btn.classList.toggle('ready', ab.ready(u));
      p.btn.classList.toggle('running', running);
      p.btn.classList.toggle('targeting', g.targeting === u);
    }
  }

  /**
   * v0.6.2 objective widgets: chips (truck / relay / installation HP, compact), the ALARM meter
   * (Mission 9) and the boss HP bar with its 65% / 30% reinforcement ticks (Mission 10).
   */
  private updateWidgets() {
    const g = this.game, o = g.objective;
    const chips = g.phase === 'start' ? undefined : o.chips;
    const key = chips ? chips.map((c) => `${c.label}${c.state}${Math.round(c.frac * 20)}`).join('|') : '';
    if (key !== this.chipsKey) {
      this.chipsKey = key;
      this.objChips.innerHTML = chips ? chips.map((c) => `<span class="oc ${c.state}"><b>${c.label.replace(/[<>&]/g, '')}</b><i><i style="width:${Math.round(c.frac * 100)}%"></i></i></span>`).join('') : '';
      this.objChips.style.display = chips?.length ? '' : 'none';
    }
    const m = g.phase === 'start' ? undefined : o.meter;
    this.objMeter.style.display = m ? '' : 'none';
    if (m) {
      this.objMeter.classList.toggle('hot', m.hot);
      this.objMeter.querySelector<HTMLElement>('.om-l')!.textContent = m.label;
      this.objMeter.querySelector<HTMLElement>('.om-bar div')!.style.width = `${Math.min(100, m.frac * 100)}%`;
      this.objMeter.querySelector<HTMLElement>('.om-v')!.textContent = `${Math.floor(m.frac * 100)}%`;
    }
    const b = g.phase === 'playing' ? g.mission.boss : null;
    const show = !!b && b.unit.active;
    this.objBoss.style.display = show ? '' : 'none';
    if (show && b) {
      this.objBoss.querySelector<HTMLElement>('.ob-fill')!.style.width = `${Math.max(0, (b.unit.hp / b.unit.maxHp) * 100)}%`;
      const st = b.rocket ? 'ROCKET!' : b.phase === 'windup' ? 'MG WINDING UP' : b.phase === 'burst' ? 'FIRING' : '';
      const el = this.objBoss.querySelector<HTMLElement>('.ob-state')!;
      if (el.textContent !== st) el.textContent = st;
    }
  }

  /**
   * "SOLDIER LEFT BEHIND!" (v0.6): compact, non-pausing, live countdown. Re-rendered only when its
   * text changes (once per second), so it never flickers or re-appears per frame.
   */
  private updateWarning() {
    const g = this.game;
    const w = g.phase === 'playing' ? g.mission.extractWarning(g) : null;
    if (!w) {
      if (this.xwarnKey !== '') { this.xwarn.style.display = 'none'; this.xwarnKey = ''; }
      return;
    }
    const n = w.downed.length;
    const title = n === 1 ? 'SOLDIER LEFT BEHIND!' : `${n} SOLDIERS LEFT BEHIND!`;
    const nm = (s: Unit) => (s.identity?.name ?? s.name).replace(/[&<>"']/g, '');
    const body = n === 1
      ? `${nm(w.downed[0])} is downed — ${Math.ceil(w.downed[0].bleed)} second${Math.ceil(w.downed[0].bleed) === 1 ? '' : 's'} remaining.${w.downed[0].reviving ? ' Revive in progress.' : ''}<br>Extracting now will mark ${nm(w.downed[0])} as KIA.`
      : `${w.downed.map((s) => `${nm(s)} ${Math.ceil(s.bleed)}s${s.reviving ? ' ⏸' : ''}`).join(' · ')}<br>Extracting now will mark them KIA.`;
    const key = `${title}|${body}|${w.armed}`;
    if (key === this.xwarnKey) return;
    this.xwarnKey = key;
    this.xwarn.style.display = '';
    this.xwarn.querySelector('.xw-title')!.textContent = title;
    this.xwarn.querySelector('.xw-body')!.innerHTML = body;
    this.xwarn.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = !w.armed; });
  }

  hideOverlay() { this.overlay.style.display = 'none'; this.overlay.innerHTML = ''; this.menus.hide(); }

  /** Barracks ("Return to Barracks", Campaign -> Squad). */
  showStart(notice?: string) { this.hideOverlay(); this.menus.showBarracks(notice); }
  /** Campaign screen (launch screen, Results -> Campaign). */
  showCampaign(notice?: string) { this.hideOverlay(); this.menus.showCampaign(notice); }

  /** Mission Results (victory or defeat). */
  showEnd() { this.menus.showResults(); }
  /** v0.6 casualty decisions / Operation Phoenix (blocking). */
  showDecisions(notice?: string) { this.hideOverlay(); this.menus.showDecisions(notice); }

  /** The roster object was replaced (dev save reset): redraw the Barracks if it is open. */
  rosterChanged(notice = 'Roster reset to defaults.') {
    if (this.menus.screen === 'barracks') this.menus.showBarracks(notice);
    else if (this.menus.screen === 'campaign') this.menus.showCampaign(notice);
  }

  get rootEl() { return this.root; }
}
