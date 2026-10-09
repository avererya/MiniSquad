// Full-viewport menu screens (outside the scaled 1280x720 stage, so text stays readable on
// phones): Barracks with soldier details + squad selection, and the mission Results screen.
import type { Game } from './game';
import { ABILITY_NAMES, CLASSES, classStats, effectiveStats, type SoldierIdentity } from './classes';
import { CFG } from './config';
import { TRAITS } from './traits';
import { SQUAD_SLOTS } from './roster';
import { drawClassPortrait } from './render';
import { unlockAudio } from './audio';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const num = (v: number) => String(Math.round(v * 100) / 100);

type Screen = 'none' | 'barracks' | 'results';

export class Menus {
  screen: Screen = 'none';
  /** Soldier shown in the details panel (null = closed). */
  detailsId: string | null = null;
  /** Slot chosen for "replace" (tap a slot, then a soldier). */
  targetSlot: number | null = null;
  private noticeTimer = 0;
  private resizeTimer = 0;

  constructor(private root: HTMLElement, private game: Game, private openSettings: () => void) {
    root.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.drawPortraits(), 120);
    });
  }

  get visible() { return this.screen !== 'none'; }

  hide() {
    this.screen = 'none'; this.detailsId = null; this.targetSlot = null;
    this.root.className = 'hidden';
    this.root.innerHTML = '';
  }

  // ---------------- Barracks ----------------
  showBarracks(notice?: string) {
    this.screen = 'barracks';
    this.root.className = 'barracks';
    this.renderBarracks();
    if (notice) this.notice(notice);
  }

  private renderBarracks() {
    const r = this.game.roster;
    const cards = r.soldiers.map((s) => this.cardHtml(s)).join('');
    const slots = r.slots.map((id, i) => this.slotHtml(id, i)).join('');
    const squad = r.squad();
    const order = squad.length ? squad.map((s, i) => `${i + 1}. ${esc(s.name)}`).join(' · ') : 'No soldiers selected';
    const hint = this.targetSlot !== null ? `Choose a soldier for slot ${this.targetSlot + 1}` : 'Tap a soldier for details · pick up to 3';
    this.root.innerHTML = `
      <div class="m-wrap">
        <header class="m-head">
          <div class="m-title">BARRACKS</div>
          <div class="m-hint">${hint}</div>
          <div class="m-notice"></div>
          <div class="m-ver">MiniSquad v${__APP_VERSION__} · ${__APP_COMMIT__}</div>
          <button class="m-icon" data-a="settings" title="Settings (\`)">⚙</button>
        </header>
        <div class="b-main">
          <section class="b-roster">${cards}</section>
          <aside class="b-squad">
            <div class="b-squad-title">SQUAD <span>${squad.length}/${SQUAD_SLOTS}</span></div>
            ${slots}
            <div class="b-order">Deploy order: ${order}</div>
            <button class="m-big" data-a="deploy" ${r.canDeploy() ? '' : 'disabled'}>DEPLOY</button>
            <div class="b-mission">Mission: Secure the Communications Outpost</div>
          </aside>
        </div>
      </div>
      ${this.detailsId ? this.detailsHtml(r.get(this.detailsId)!) : ''}`;
    this.drawPortraits();
  }

  private cardHtml(s: SoldierIdentity) {
    const r = this.game.roster;
    const slot = r.slotOf(s.id);
    const t = s.traitId ? TRAITS[s.traitId] : null;
    const st = effectiveStats(s);
    let btn: string;
    if (slot >= 0) btn = `<button class="pick out" data-a="deselect" data-id="${s.id}">✕ REMOVE</button>`;
    else if (this.targetSlot !== null) btn = `<button class="pick in" data-a="select" data-id="${s.id}">→ SLOT ${this.targetSlot + 1}</button>`;
    else if (r.slots.includes(null)) btn = `<button class="pick in" data-a="select" data-id="${s.id}">+ ADD</button>`;
    else btn = `<button class="pick full" data-a="select" data-id="${s.id}">SQUAD FULL</button>`;
    return `
      <div class="s-card ${slot >= 0 ? 'sel' : ''}" data-a="details" data-id="${s.id}" data-cls="${s.classId}">
        <div class="s-top">
          <canvas class="s-port" data-cls="${s.classId}"></canvas>
          <div class="s-id">
            <div class="s-name">${esc(s.name)}</div>
            <div class="s-cls">${CLASSES[s.classId].label}</div>
            <div class="s-lv">LV ${s.progression?.level ?? 1}</div>
          </div>
          ${slot >= 0 ? `<div class="s-slot">${slot + 1}</div>` : ''}
        </div>
        <div class="s-trait"><b>${t ? t.name : 'No trait'}</b><span>${t ? t.desc : ''}</span></div>
        <div class="s-bot">
          <span class="s-hp">HP ${num(st.hp)}</span>
          <span class="s-status ${slot >= 0 ? 'on' : ''}">${slot >= 0 ? `IN SQUAD #${slot + 1}` : 'AVAILABLE'}</span>
        </div>
        ${btn}
      </div>`;
  }

  private slotHtml(id: string | null, i: number) {
    const s = id ? this.game.roster.get(id)! : null;
    const tgt = this.targetSlot === i ? 'target' : '';
    if (!s) return `<div class="slot empty ${tgt}" data-a="slot" data-slot="${i}"><span class="slot-n">${i + 1}</span><span class="slot-empty">${tgt ? 'Pick a soldier' : 'Empty slot'}</span></div>`;
    const t = s.traitId ? TRAITS[s.traitId].name : '';
    return `<div class="slot ${tgt}" data-a="slot" data-slot="${i}"><span class="slot-n">${i + 1}</span><canvas class="slot-port" data-cls="${s.classId}"></canvas>
      <span class="slot-id"><b>${esc(s.name)}</b><span>${CLASSES[s.classId].label} · ${t}</span></span>
      <button class="slot-x" data-a="clear" data-slot="${i}" title="Remove">✕</button></div>`;
  }

  private detailsHtml(s: SoldierIdentity) {
    const base = classStats(s.classId), eff = effectiveStats(s);
    const t = s.traitId ? TRAITS[s.traitId] : null;
    const ability = ABILITY_NAMES[CLASSES[s.classId].abilityId];
    const rows: [string, number, number, string][] = [
      ['Max HP', base.hp, eff.hp, ''],
      ['Damage per shot', base.damage, eff.damage, ''],
      ['Fire rate', base.fireRate, eff.fireRate, '/s'],
      ['Spread, standing', base.accuracy, eff.accuracy, '°'],
      ['Spread, moving', base.accuracy + base.movePenalty, eff.accuracy + eff.movePenalty, '°'],
      ['Move speed', base.moveSpeed, eff.moveSpeed, ' px/s'],
      ['Revive time (as reviver)', base.reviveTime, eff.reviveTime, ' s'],
      ['Range', base.range, eff.range, ' px'],
    ];
    if (s.classId === 'medic') {
      const h = CFG.fieldTreatment.healFrac * 100;
      rows.push(['Field Treatment heal', h, h * eff.healMul, '% max HP']);
    }
    const lower = new Set(['Spread, standing', 'Spread, moving', 'Revive time (as reviver)']); // smaller is better
    const tr = rows.map(([label, b, e, u]) => {
      const changed = Math.abs(b - e) > 1e-9;
      const better = changed && (lower.has(label) ? e < b : e > b);
      return `<tr class="${changed ? (better ? 'up' : 'down') : ''}"><td>${label}</td><td>${num(b)}${u}</td><td>${num(e)}${u}${changed ? ` <i>${t ? t.name : ''}</i>` : ''}</td></tr>`;
    }).join('');
    const p = s.progression;
    const sel = this.game.roster.isSelected(s.id);
    const full = !this.game.roster.slots.includes(null);
    return `
      <div class="m-modal" data-a="close-bg">
        <div class="d-card" data-id="${s.id}">
          <div class="d-head">
            <canvas class="d-port" data-cls="${s.classId}"></canvas>
            <div class="d-id">
              <div class="d-name">${esc(s.name)} <span class="s-lv">LV ${p?.level ?? 1}</span></div>
              <div class="d-cls">${CLASSES[s.classId].label} · Ability: ${ability}</div>
              <div class="d-trait"><b>${t ? t.name : 'No trait'}</b> ${t ? `— ${t.desc}` : ''}</div>
            </div>
            <button class="m-icon" data-a="close" title="Close (Esc)">✕</button>
          </div>
          <table class="d-stats"><thead><tr><th>Stat</th><th>Class base</th><th>Effective</th></tr></thead><tbody>${tr}</tbody></table>
          ${!sel && full && this.targetSlot === null ? '<div class="d-full">Squad full: remove someone, or tap a squad slot first to replace its soldier.</div>' : ''}
          <div class="d-prog">Level ${p?.level ?? 1} · XP ${p?.xp ?? 0} · Upgrades: ${p?.upgrades.length ? p.upgrades.join(', ') : 'none'} · Specialization: ${p?.specialization ?? 'none'}</div>
          <div class="d-btns">
            ${sel ? `<button class="m-big alt" data-a="deselect" data-id="${s.id}">REMOVE FROM SQUAD</button>`
              : this.targetSlot !== null ? `<button class="m-big" data-a="select" data-id="${s.id}">PUT IN SLOT ${this.targetSlot + 1}</button>`
              : full ? `<button class="m-big" disabled title="Squad full">SQUAD FULL</button>`
              : `<button class="m-big" data-a="select" data-id="${s.id}">ADD TO SQUAD</button>`}
            <button class="m-big alt" data-a="close">CLOSE</button>
          </div>
        </div>
      </div>`;
  }

  private drawPortraits() {
    if (!this.visible) return;
    this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-cls]').forEach((c) => {
      drawClassPortrait(c, c.dataset.cls as SoldierIdentity['classId'], c.classList.contains('slot-port') ? 0.3 : 0.55);
    });
  }

  notice(text: string) {
    const n = this.root.querySelector<HTMLElement>('.m-notice');
    if (!n) return;
    n.textContent = text;
    n.classList.add('on');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => n.classList.remove('on'), 3500);
  }

  // ---------------- Results ----------------
  showResults() {
    const g = this.game;
    const won = g.phase === 'won';
    this.screen = 'results';
    this.root.className = 'results';
    const rows = g.stats.rows(g.soldiers).map((r) => `
      <tr class="st-${r.status.toLowerCase()}">
        <td class="r-name"><b>${esc(r.name)}</b><span>${CLASSES[r.classId].label}${r.traitId ? ` · ${TRAITS[r.traitId].name}` : ''}</span></td>
        <td>${r.kills}</td><td>${Math.round(r.damage)}</td><td>${Math.round(r.healing)}</td><td>${r.revives}</td>
        <td class="r-status">${r.status}</td>
      </tr>`).join('');
    const dev = g.deployment.kind === 'generic' ? '<div class="r-dev">Dev preset squad (generic soldiers, not from the roster)</div>' : '';
    this.root.innerHTML = `
      <div class="m-wrap r-wrap">
        <div class="r-card ${won ? 'won' : 'lost'}">
          <div class="r-title">${won ? 'MISSION COMPLETE' : 'MISSION FAILED'}</div>
          <div class="r-sub">${won ? 'The squad made it out.' : 'The whole squad is down.'} · Mission time <b>${fmtTime(g.time)}</b></div>
          ${dev}
          <table class="r-table">
            <thead><tr><th>Soldier</th><th>Kills</th><th>Damage</th><th>Healing</th><th>Revives</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="r-btns">
            <button class="m-big" data-a="retry">RETRY MISSION</button>
            <button class="m-big alt" data-a="barracks">RETURN TO BARRACKS</button>
          </div>
          <div class="r-note">Enter retry · B barracks · KIA only lasts for the mission: everyone is back in the Barracks.</div>
        </div>
      </div>`;
  }

  // ---------------- input ----------------
  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!el || !this.root.contains(el)) return;
    unlockAudio();
    const a = el.dataset.a, id = el.dataset.id, g = this.game, r = g.roster;
    switch (a) {
      case 'settings': this.openSettings(); return;
      case 'deploy': this.deploy(); return;
      case 'retry': g.reset(); return;
      case 'barracks': g.toBarracks(); return;
      case 'details': this.detailsId = id!; break;
      case 'close': this.detailsId = null; break;
      case 'close-bg': if (e.target === el) this.detailsId = null; else return; break;
      case 'select': {
        const res = r.select(id!, this.targetSlot ?? undefined);
        if (!res.ok) { this.renderBarracks(); this.notice(res.reason); return; }
        this.targetSlot = null;
        break;
      }
      case 'deselect': r.deselect(id!); break;
      case 'clear': r.clearSlot(+el.dataset.slot!); if (this.targetSlot === +el.dataset.slot!) this.targetSlot = null; break;
      case 'slot': { const i = +el.dataset.slot!; this.targetSlot = this.targetSlot === i ? null : i; break; }
      default: return;
    }
    e.stopPropagation();
    if (this.screen === 'barracks') this.renderBarracks();
  }

  private deploy() {
    if (!this.game.deploySelected()) this.notice('Select at least one soldier to deploy.');
  }

  private onKey(e: KeyboardEvent) {
    if (!this.visible || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (this.screen === 'barracks') {
      if (e.code === 'Escape') {
        if (this.detailsId) this.detailsId = null; else this.targetSlot = null;
        this.renderBarracks();
      } else if (e.code === 'Enter' && !this.detailsId) { e.preventDefault(); this.deploy(); }
    }
    // Results keys (Enter retry, B/Esc barracks) are handled by Game.onKey
  }
}
