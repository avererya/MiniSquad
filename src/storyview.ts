// v0.8C.1 DOM view of the story director (story.ts): the blocking comic-panel cinematic (#cine) and the
// non-blocking radio strip (#radio). Lives in the HUD root; Hud.update() calls update() every drawn frame and
// writes the DOM only when something changed. The look is CSS only (style.css "v0.8C.1 story"), no images
// unless a line names a portrait.
import type { Game } from './game';
import { portraitOf, speakerOf, type StoryLine } from './story';
import { unlockAudio } from './audio';

// Small inline marks for the speaker plates: a radio mast for Command, a chevron insignia for the enemy.
const ICONS = {
  command: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v13M8 22h8M12 9l-4 13M12 9l4 13" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="7" r="2" fill="currentColor"/><path d="M7.5 3.5a6.5 6.5 0 0 0 0 7M16.5 3.5a6.5 6.5 0 0 1 0 7M4.5 1a10 10 0 0 0 0 12M19.5 1a10 10 0 0 1 0 12" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
  enemy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l9 6 9-6M3 12l9 6 9-6" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linejoin="miter"/><path d="M12 1.5l1.4 2.9 3.1.4-2.3 2.1.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.1 3.1-.4z" fill="currentColor"/></svg>',
};

export class StoryView {
  private cine: HTMLElement;
  private panel: HTMLElement;
  private art: HTMLElement;
  private img: HTMLImageElement;
  private icon: HTMLElement;
  private name: HTMLElement;
  private role: HTMLElement;
  private text: HTMLElement;
  private pips: HTMLElement;
  private bar: HTMLElement;
  private radio: HTMLElement;
  private key = '';
  private radioKey = '';
  private barPct = -1;

  constructor(root: HTMLElement, private game: Game) {
    root.insertAdjacentHTML('beforeend', `
      <div id="radio" aria-live="polite" style="display:none"><span class="rd-icon"></span><div class="rd-body"><b class="rd-name"></b><span class="rd-text"></span></div></div>
      <div id="cine" role="dialog" aria-modal="true" aria-label="Mission briefing" style="display:none">
        <div class="cine-bar cine-top"></div><div class="cine-bar cine-bot"></div>
        <button class="cine-skip" type="button" data-c="skip">SKIP ▸▸</button>
        <div class="cine-panel">
          <div class="cine-art"><img alt="" decoding="async"></div>
          <div class="cine-body">
            <div class="cine-who"><span class="cine-icon"></span><b class="cine-name"></b><span class="cine-role"></span></div>
            <div class="cine-text"></div>
            <div class="cine-foot"><span class="cine-pips"></span><span class="cine-next">TAP / ENTER ▸</span></div>
          </div>
          <div class="cine-timer"><i></i></div>
        </div>
      </div>`);
    this.cine = root.querySelector('#cine')!;
    this.panel = this.cine.querySelector('.cine-panel')!;
    this.art = this.cine.querySelector('.cine-art')!;
    this.img = this.art.querySelector('img')!;
    this.icon = this.cine.querySelector('.cine-icon')!;
    this.name = this.cine.querySelector('.cine-name')!;
    this.role = this.cine.querySelector('.cine-role')!;
    this.text = this.cine.querySelector('.cine-text')!;
    this.pips = this.cine.querySelector('.cine-pips')!;
    this.bar = this.cine.querySelector('.cine-timer i')!;
    this.radio = root.querySelector('#radio')!;
    // missing / broken artwork falls back to the text-only panel
    this.img.addEventListener('error', () => { this.panel.classList.remove('has-art'); });
    // a tap anywhere on the cinematic advances; SKIP closes it. Nothing reaches the joystick / canvas underneath.
    this.cine.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); unlockAudio();
      const g = this.game;
      if ((e.target as HTMLElement).closest('[data-c="skip"]')) g.story.skip(g);
      else g.story.advance(g);
      this.update();
    });
  }

  update() {
    const g = this.game, st = g.story;
    const line = g.phase === 'playing' ? st.line : null;
    // ---- cinematic ----
    const key = line && st.scene ? `${st.scene.id}:${st.index}` : '';
    if (key !== this.key) {
      this.key = key;
      if (!line || !st.scene) this.cine.style.display = 'none';
      else this.show(line, st.index, st.scene.lines.length);
    }
    if (line) {
      const pct = Math.min(100, Math.floor((st.t / Math.max(0.1, st.hold)) * 100));
      if (pct !== this.barPct) { this.barPct = pct; this.bar.style.width = `${pct}%`; }
    }
    // ---- radio strip ----
    const r = g.phase === 'playing' && !st.scene ? st.radio : null;
    const rk = r ? `${r.line.speaker}:${r.line.text}:${st.log.length}` : '';
    if (rk !== this.radioKey) {
      this.radioKey = rk;
      if (!r) this.radio.style.display = 'none';
      else {
        const sp = speakerOf(r.line);
        this.radio.className = `rd-${sp.tone}`;
        this.radio.querySelector('.rd-icon')!.innerHTML = ICONS[sp.tone];
        this.radio.querySelector('.rd-name')!.textContent = sp.name;
        this.radio.querySelector('.rd-text')!.textContent = `“${r.line.text}”`;
        this.radio.style.display = '';
        this.replay(this.radio);
      }
    }
  }

  private show(line: StoryLine, i: number, n: number) {
    const sp = speakerOf(line);
    this.cine.className = `cine-${sp.tone}`;
    this.icon.innerHTML = ICONS[sp.tone];
    this.name.textContent = sp.name;
    this.role.textContent = sp.role;
    this.text.textContent = line.text;
    this.pips.innerHTML = Array.from({ length: n }, (_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('');
    const art = portraitOf(line);
    if (art) { this.img.src = art; this.img.alt = sp.name; }
    else this.img.removeAttribute('src');
    this.panel.classList.toggle('has-art', !!art);
    this.barPct = -1;
    this.cine.style.display = '';
    this.replay(this.panel);
  }

  /** Restart the entry animation (one class toggle; transform / opacity only). */
  private replay(el: HTMLElement) {
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
  }
}
