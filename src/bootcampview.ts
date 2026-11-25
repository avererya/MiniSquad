// v0.9E Boot Camp coach (bootcamp.ts decides the words): one short card and a highlight on the control to use.
//  - Field Training: a card in the HUD (stage px, right half under the objectives dock) plus a ghost joystick in the left half
//    while the squad hasn't moved yet. Neither takes a touch except the card's EXIT button, so the joystick, the
//    ability buttons and the battlefield work exactly as in a mission.
//  - Headquarters tour: a card over the Campaign / Barracks screens (CSS px, under the header) and a pulsing outline
//    on the real navigation button. The tour advances when the player opens the screen (polled here); the card body
//    lets taps through, only EXIT TOUR / DONE take them.
import type { Game } from './game';
import type { Menus } from './menus';
import { fieldCoach, tourAdvance, tourCoach, type CoachCard } from './bootcamp';
import { unlockAudio } from './audio';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class BootCampView {
  private field: HTMLElement;
  private stick: HTMLElement;
  private tour: HTMLElement;
  private key = '';
  private lit: Element[] = [];

  constructor(hudRoot: HTMLElement, private game: Game, private menus: Menus) {
    this.field = document.createElement('div');
    this.field.id = 'bc-coach'; this.field.style.display = 'none';
    this.field.setAttribute('role', 'status');
    hudRoot.appendChild(this.field);
    this.stick = document.createElement('div');
    this.stick.id = 'bc-stick'; this.stick.style.display = 'none';
    this.stick.innerHTML = '<i class="bc-knob"></i><b>DRAG</b>';
    hudRoot.appendChild(this.stick);
    this.tour = document.createElement('div');
    this.tour.id = 'bc-tour'; this.tour.style.display = 'none';
    this.tour.setAttribute('role', 'status');
    document.body.appendChild(this.tour);
    const onBtn = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bc]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation(); unlockAudio();
      if (b.dataset.bc === 'done') { this.game.bootCamp.tour = null; this.update(); return; }
      this.game.exitBootCamp();
      this.update();
    };
    // the HUD card answers on pointerdown like the other HUD buttons (never starts the joystick); the tour card on click
    this.field.addEventListener('pointerdown', onBtn);
    this.tour.addEventListener('click', onBtn);
  }

  /** Called every HUD update (menus poll at MENU_FPS): advances the tour, shows the card, moves the highlight. */
  update() {
    const g = this.game, bc = g.bootCamp, mn = this.menus;
    let card: CoachCard | null = fieldCoach(g);
    let where: 'field' | 'tour' | null = card ? 'field' : null;
    if (!card && bc.tour && g.phase === 'start' && mn.visible) {
      bc.tour = tourAdvance(bc.tour, mn.screen, mn.tab);
      card = tourCoach(bc.tour, mn.screen, mn.tab);
      if (card) where = 'tour';
    }
    const key = card ? `${where}:${card.key}` : '';
    if (key !== this.key) {
      this.key = key;
      this.field.style.display = where === 'field' ? '' : 'none';
      this.tour.style.display = where === 'tour' ? '' : 'none';
      const el = where === 'field' ? this.field : this.tour;
      if (card) {
        const btn = card.final ? '<button data-bc="done" class="bc-btn bc-done">DONE</button>'
          : `<button data-bc="exit" class="bc-btn">${where === 'field' ? 'EXIT BOOT CAMP' : 'EXIT TOUR'}</button>`;
        el.dataset.step = card.key;
        el.innerHTML = `<div class="bc-top"><b class="bc-title">${esc(card.title)}</b>${btn}</div>${card.lines.map((l) => `<div class="bc-line">${esc(l)}</div>`).join('')}`;
      }
    }
    const move = where === 'field' && card?.key === 'move' && !g.squadMoving;
    if ((this.stick.style.display !== 'none') !== move) this.stick.style.display = move ? '' : 'none';
    this.highlight(card?.target && card.target !== '#bc-stick' ? card.target : null);
  }

  /** Pulsing outline on the target control(s) (re-found every update: the menus re-render their HTML). */
  private highlight(sel: string | null) {
    const els = sel ? [...document.querySelectorAll(sel)] : [];
    if (els.length === this.lit.length && els.every((e, i) => e === this.lit[i])) return;
    for (const e of this.lit) e.classList.remove('bc-hl');
    for (const e of els) e.classList.add('bc-hl');
    this.lit = els;
  }
}
