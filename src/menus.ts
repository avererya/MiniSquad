// Full-viewport menu screens (outside the scaled 1280x720 stage, so text stays readable on
// phones): the Campaign screen (v0.4: mission list + details, launch screen), the Barracks
// (tabs: Roster / Training / Squad Training, plus a details panel) and the mission Results
// screen (stats, stars, optional objectives, XP and level-ups, Credits, unlocks).
// Flow: Campaign -> Barracks (squad for the selected mission) -> Deploy -> Mission -> Results
// -> Retry / Campaign / Barracks. Campaign can also deploy the saved squad directly.
import type { Game } from './game';
import { ABILITY_NAMES, CLASSES, CLASS_IDS, classStats, effectiveStats, type SoldierIdentity } from './classes';
import { CFG } from './config';
import { TRAITS } from './traits';
import { SQUAD_SLOTS } from './roster';
import { drawClassPortrait } from './render';
import { unlockAudio } from './audio';
import { VERSION_LABEL } from './version';
import { CAMPAIGN, MISSION_TYPE_LABEL, STAR_TEXT, campaignMission, capacityFor, type CampaignMission } from './campaign';
import {
  PROGRESSION, SQUAD_TRAINING, SQUAD_TRAINING_IDS, TRAINING, TRAINING_IDS, getAccount, grownStats, levelProgress, maxRank, nextCost,
  type SquadTrainingStat, type TrainingStat,
} from './progression';
import { buySquadTraining, buyTraining } from './economy';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const num = (v: number) => String(Math.round(v * 100) / 100);
const cr = (v: number) => v.toLocaleString('en-US');
const pct = (f: number) => (Math.abs(f) < 1e-9 ? '0%' : `${f > 0 ? '+' : '−'}${num(Math.abs(f * 100))}%`);

type Screen = 'none' | 'campaign' | 'barracks' | 'results';
const stars = (n: number, of = 3) => `<span class="stars" title="${n}/${of} stars">${'★'.repeat(n)}<i>${'★'.repeat(Math.max(0, of - n))}</i></span>`;
export type BarracksTab = 'roster' | 'training' | 'squad';
const TABS: [BarracksTab, string][] = [['roster', 'ROSTER'], ['training', 'TRAINING'], ['squad', 'SQUAD TRAINING']];

/** How a training row shows its stat. */
const STAT_VIEW: Record<TrainingStat, { get: (s: ReturnType<typeof effectiveStats>) => string }> = {
  accuracy: { get: (s) => `${num(s.accuracy)}°/${num(s.accuracy + s.movePenalty)}°` },
  damage: { get: (s) => num(s.damage) },
  hp: { get: (s) => num(Math.round(s.hp * 10) / 10) },
  fireRate: { get: (s) => `${num(s.fireRate)}/s` },
  moveSpeed: { get: (s) => num(Math.round(s.moveSpeed * 10) / 10) },
};

export class Menus {
  screen: Screen = 'none';
  tab: BarracksTab = 'roster';
  /** Soldier shown in the details panel (null = closed). */
  detailsId: string | null = null;
  /** Soldier selected in the Training tab. */
  trainId = 'ace';
  /** Slot chosen for "replace" (tap a slot, then a soldier). */
  targetSlot: number | null = null;
  private noticeTimer = 0;
  private resizeTimer = 0;
  /** Double-tap guard for purchases (ms timestamp of the last accepted purchase tap). */
  private lastBuy = { key: '', t: -1e9 };
  /** Mission highlighted on the Campaign screen. */
  campaignSel = '';
  /** Soldiers unlocked since the Barracks was last opened ("NEW" badge). */
  newSoldiers = new Set<string>();

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

  // ---------------- Campaign ----------------
  showCampaign(notice?: string) {
    if (this.screen === 'barracks') this.newSoldiers.clear();
    this.screen = 'campaign';
    this.root.className = 'campaign';
    const acc = getAccount();
    const sel = acc.campaign.selectedMission;
    this.game.selectMission(sel);
    this.campaignSel = this.game.missionId;
    this.renderCampaign();
    if (notice) this.notice(notice);
  }

  private missionState(m: CampaignMission): 'locked' | 'available' | 'completed' | 'soon' {
    if (!m.playable) return 'soon';
    const acc = getAccount();
    if (!acc.campaign.unlockedMissions.includes(m.id)) return 'locked';
    return (acc.missions[m.id]?.completions ?? 0) > 0 ? 'completed' : 'available';
  }

  private renderCampaign() {
    const acc = getAccount();
    const total = CAMPAIGN.filter((m) => m.playable).length * 3;
    const got = CAMPAIGN.reduce((a, m) => a + (acc.missions[m.id]?.bestStars ?? 0), 0);
    const list = CAMPAIGN.map((m) => {
      const st = this.missionState(m), best = acc.missions[m.id]?.bestStars ?? 0;
      return `<button class="c-row ${st} ${m.id === this.campaignSel ? 'on' : ''}" data-a="csel" data-id="${m.id}">
        <span class="c-num">${m.playable ? m.number : '…'}</span>
        <span class="c-name"><b>${esc(m.name)}</b><small>${m.playable ? MISSION_TYPE_LABEL[m.type] : 'Future update'}</small></span>
        <span class="c-state">${st === 'locked' ? '🔒' : st === 'soon' ? '' : stars(best)}</span>
      </button>`;
    }).join('');
    const m = campaignMission(this.campaignSel) ?? CAMPAIGN[0];
    this.root.innerHTML = `
      <div class="m-wrap">
        <header class="m-head">
          <div class="m-title">CAMPAIGN</div>
          <div class="c-total" title="Best stars, all missions">★ ${got}/${total}</div>
          <div class="m-spacer"></div>
          <div class="m-credits" title="Credits (account-wide)"><span>CREDITS</span> <b class="m-cr">${cr(acc.credits)}</b></div>
          <button class="m-nav" data-a="to-barracks" title="Barracks: soldiers, training (B)">BARRACKS</button>
          <button class="m-icon" data-a="settings" title="Settings (\`)">⚙</button>
          <div class="m-notice"></div>
        </header>
        <div class="c-main">
          <nav class="c-list">${list}<div class="m-ver">${VERSION_LABEL}</div></nav>
          ${this.missionDetailHtml(m)}
        </div>
      </div>`;
  }

  private missionDetailHtml(m: CampaignMission) {
    const acc = getAccount(), st = this.missionState(m), rec = acc.missions[m.id];
    const cap = capacityFor(m.number), r = this.game.roster, n = r.count();
    const chip = { locked: 'LOCKED', available: 'AVAILABLE', completed: `COMPLETED ×${rec?.completions ?? 0}`, soon: 'COMING SOON' }[st];
    const prev = CAMPAIGN.find((x) => x.number === m.number - 1);
    const unl = [
      ...m.unlocks.missions.map((id) => `Mission ${campaignMission(id)!.number} unlocks`),
      ...m.unlocks.soldiers.map((id) => `${esc(r.get(id)?.name ?? id)} joins (${CLASSES[r.get(id)!.classId].label})`),
      ...(m.unlocks.capacityNote ? [m.unlocks.capacityNote] : []),
    ];
    const first = rec && rec.completions > 0 ? '<span class="dim">First-clear rewards collected</span>'
      : m.legacyId && acc.missions[m.legacyId]?.firstClearRun
        ? `<span class="dim">First-clear Credit bonus already earned on this map in v0.3</span>${unl.length ? ' · ' + unl.join(' · ') : ''}`
        : `+${cr(PROGRESSION.credits.firstClear)} CR first-clear bonus${unl.length ? ' · ' + unl.join(' · ') : ''}`;
    const best = rec?.bestStars ?? 0;
    const starRows = [STAR_TEXT.one, STAR_TEXT[m.stars.two], STAR_TEXT[m.stars.three]]
      .map((t, i) => `<li class="${best > i ? 'got' : ''}"><b>${'★'.repeat(i + 1)}</b> ${i ? '+ ' : ''}${t}</li>`).join('');
    const squadNow = n === 0 ? 'none selected' : `${n} selected${n > cap ? ` <b class="warn">— over the limit, remove ${n - cap}</b>` : ''}`;
    const block = st === 'locked' || st === 'soon' ? 'Mission locked' : this.game.roster.deployBlock(cap);
    return `
      <section class="c-detail ${st}">
        <div class="c-kicker">MISSION ${m.playable ? m.number : '—'} · ${m.playable ? MISSION_TYPE_LABEL[m.type].toUpperCase() : 'FUTURE'} <span class="c-chip ${st}">${chip}</span></div>
        <div class="c-title">${esc(m.name)} ${m.playable ? stars(best) : ''}</div>
        <div class="c-brief">${esc(m.briefing)}</div>
        <div class="c-grid">
          <div><h4>OBJECTIVES</h4><ul>${m.primary.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div><h4>OPTIONAL <small>+${PROGRESSION.xp.perOptionalObjective} XP · +${PROGRESSION.credits.perOptionalObjective} CR each</small></h4><ul>${m.optional.length ? m.optional.map((x) => `<li>${esc(x.label)}</li>`).join('') : '<li class="dim">None</li>'}</ul></div>
          <div><h4>STARS</h4><ul class="c-stars">${starRows}</ul></div>
          <div><h4>SQUAD</h4><ul><li>Up to <b>${cap}</b> soldiers</li><li>Selected: ${squadNow}</li><li class="dim">${esc(m.teaches)}</li></ul></div>
        </div>
        <div class="c-first"><b>FIRST CLEAR</b> ${first}</div>
        ${st === 'locked' ? `<div class="c-lock">🔒 Clear Mission ${prev?.number ?? 1} (${esc(prev?.name ?? '')}) to unlock.</div>` : ''}
        <div class="c-btns">
          <button class="m-big alt" data-a="to-barracks" ${st === 'locked' || st === 'soon' ? 'disabled' : ''}>SQUAD ▸</button>
          <button class="m-big" data-a="deploy" ${block ? 'disabled' : ''} title="${block ? esc(block) : 'Deploy the selected squad (Enter)'}">DEPLOY</button>
        </div>
      </section>`;
  }

  // ---------------- Barracks ----------------
  showBarracks(notice?: string) {
    if (this.screen === 'barracks') this.newSoldiers.clear(); // badges last for one Barracks visit
    this.screen = 'barracks';
    this.root.className = 'barracks';
    if (!this.game.roster.get(this.trainId)) this.trainId = this.game.roster.soldiers[0]?.id ?? 'ace';
    this.renderBarracks();
    if (notice) this.notice(notice);
  }

  private renderBarracks() {
    const scroll = this.root.querySelector('.t-scroll')?.scrollTop ?? 0;
    const acc = getAccount();
    const tabs = TABS.map(([id, label]) => `<button class="m-tab ${this.tab === id ? 'on' : ''}" data-a="tab" data-tab="${id}">${label}</button>`).join('');
    const body = this.tab === 'training' ? this.trainingHtml() : this.tab === 'squad' ? this.squadTrainingHtml() : this.rosterHtml();
    this.root.innerHTML = `
      <div class="m-wrap">
        <header class="m-head">
          <button class="m-nav back" data-a="to-campaign" title="Campaign (C)">◂ CAMPAIGN</button>
          <div class="m-title">BARRACKS</div>
          <nav class="m-tabs">${tabs}</nav>
          <div class="m-credits" title="Credits (account-wide)"><span>CREDITS</span> <b class="m-cr">${cr(acc.credits)}</b></div>
          ${this.tab !== 'roster' ? `<button class="m-deploy" data-a="deploy" ${this.game.deployBlock() ? 'disabled' : ''} title="Deploy the selected squad (Enter)">DEPLOY ▸</button>` : ''}
          <button class="m-icon" data-a="settings" title="Settings (\`)">⚙</button>
          <div class="m-notice"></div>
        </header>
        ${body}
      </div>
      ${this.detailsId && this.tab === 'roster' ? this.detailsHtml(this.game.roster.get(this.detailsId)!) : ''}`;
    const sc = this.root.querySelector('.t-scroll');
    if (sc) sc.scrollTop = scroll;
    this.drawPortraits();
  }

  // ----- Roster tab (squad selection; unchanged flow) -----
  private rosterHtml() {
    const r = this.game.roster, g = this.game;
    const cap = g.capacity;
    const cards = r.soldiers.map((s) => this.cardHtml(s)).join('');
    const n = r.count();
    const shown = Math.min(SQUAD_SLOTS, Math.max(cap, n));
    const slots = r.slots.slice(0, shown).map((id, i) => this.slotHtml(id, i, cap)).join('');
    const squad = r.squad();
    const over = n > cap;
    const order = squad.length ? squad.map((s, i) => `${i + 1}. ${esc(s.name)}`).join(' · ') : 'No soldiers selected';
    const hint = this.targetSlot !== null ? `Choose a soldier for slot ${this.targetSlot + 1}` : `Tap a soldier for details · pick up to ${cap}`;
    const m = campaignMission(g.missionId)!;
    return `
        <div class="b-main">
          <section class="b-roster">${cards}</section>
          <aside class="b-squad">
            <div class="b-mission" data-a="to-campaign" title="${MISSION_TYPE_LABEL[m.type]} · tap to change mission"><b>M${m.number} ${esc(m.name)}</b><span>max ${cap}</span></div>
            <div class="b-squad-title">SQUAD <span class="${over ? 'warn' : ''}">${n}/${cap}</span></div>
            <div class="m-hint ${this.targetSlot !== null ? 'tgt' : ''}">${hint}</div>
            ${slots}
            ${over ? `<div class="b-over">Too many for this mission (max ${cap}). <button class="pick in" data-a="trim">KEEP FIRST ${cap}</button></div>` : `<div class="b-order">Deploy order: ${order}</div>`}
            <button class="m-big" data-a="deploy" ${g.deployBlock() ? 'disabled' : ''}>DEPLOY</button>
            <div class="m-ver">${VERSION_LABEL}</div>
          </aside>
        </div>`;
  }

  private xpBar(s: SoldierIdentity, cls = 'xp') {
    const lp = levelProgress(s.progression?.xp ?? 0);
    const title = lp.max ? 'Max level' : `XP ${lp.into}/${lp.need} to LV ${lp.level + 1}`;
    return `<span class="${cls}" title="${title}"><i style="width:${Math.round(lp.frac * 100)}%"></i></span>`;
  }

  private cardHtml(s: SoldierIdentity) {
    const r = this.game.roster;
    const slot = r.slotOf(s.id);
    const t = s.traitId ? TRAITS[s.traitId] : null;
    const st = effectiveStats(s);
    const lv = s.progression?.level ?? 1;
    if (!r.isUnlocked(s.id)) {
      return `
      <div class="s-card locked" data-a="details" data-id="${s.id}" data-cls="${s.classId}">
        <div class="s-top">
          <canvas class="s-port" data-cls="${s.classId}"></canvas>
          <div class="s-id">
            <div class="s-name">${esc(s.name)}</div>
            <div class="s-cls">${CLASSES[s.classId].label}</div>
          </div>
          <div class="s-lock">🔒</div>
        </div>
        <div class="s-trait"><b>LOCKED</b><span>${esc(r.unlockText(s.id))}</span></div>
        <div class="s-bot"><span class="s-status">NOT IN YOUR SQUAD YET</span></div>
        <button class="pick full" data-a="select" data-id="${s.id}">🔒 LOCKED</button>
      </div>`;
    }
    const cap = this.game.capacity;
    let btn: string;
    if (slot >= 0) btn = `<button class="pick out" data-a="deselect" data-id="${s.id}">✕ REMOVE</button>`;
    else if (this.targetSlot !== null) btn = `<button class="pick in" data-a="select" data-id="${s.id}">→ SLOT ${this.targetSlot + 1}</button>`;
    else if (r.count() < cap) btn = `<button class="pick in" data-a="select" data-id="${s.id}">+ ADD</button>`;
    else btn = `<button class="pick full" data-a="select" data-id="${s.id}">SQUAD FULL</button>`;
    const trained = TRAINING_IDS.reduce((a, k) => a + s.training[k], 0);
    const isNew = this.newSoldiers.has(s.id);
    return `
      <div class="s-card ${slot >= 0 ? 'sel' : ''} ${isNew ? 'new' : ''}" data-a="details" data-id="${s.id}" data-cls="${s.classId}">${isNew ? '<span class="s-new">NEW</span>' : ''}
        <div class="s-top">
          <canvas class="s-port" data-cls="${s.classId}"></canvas>
          <div class="s-id">
            <div class="s-name">${esc(s.name)}</div>
            <div class="s-cls">${CLASSES[s.classId].label}</div>
            <div class="s-lvrow"><span class="s-lv">LV ${lv}</span>${this.xpBar(s)}</div>
          </div>
          ${slot >= 0 ? `<div class="s-slot">${slot + 1}</div>` : ''}
        </div>
        <div class="s-trait"><b>${t ? t.name : 'No trait'}</b><span>${t ? t.desc : ''}</span></div>
        <div class="s-bot">
          <span class="s-hp">HP ${num(Math.round(st.hp))}<span class="s-dmg"> · DMG ${num(Math.round(st.damage * 10) / 10)}</span></span>
          <span class="s-status ${slot >= 0 ? 'on' : ''}">${slot >= 0 ? `IN SQUAD #${slot + 1}` : trained ? `TRAINED ${trained}` : 'AVAILABLE'}</span>
        </div>
        ${btn}
      </div>`;
  }

  private slotHtml(id: string | null, i: number, cap: number) {
    const s = id ? this.game.roster.get(id)! : null;
    const tgt = this.targetSlot === i ? 'target' : '';
    if (!s) return `<div class="slot empty ${tgt}" data-a="slot" data-slot="${i}"><span class="slot-n">${i + 1}</span><span class="slot-empty">${tgt ? 'Pick a soldier' : 'Empty slot'}</span></div>`;
    const t = s.traitId ? TRAITS[s.traitId].name : '';
    const over = i >= cap;
    return `<div class="slot ${tgt} ${over ? 'over' : ''}" data-a="slot" data-slot="${i}"><span class="slot-n">${i + 1}</span><canvas class="slot-port" data-cls="${s.classId}"></canvas>
      <span class="slot-id"><b>${esc(s.name)} <small>LV ${s.progression?.level ?? 1}</small></b><span>${over ? 'OVER LIMIT — remove to deploy' : `${CLASSES[s.classId].short} · ${t}`}</span></span>
      <button class="slot-x" data-a="clear" data-slot="${i}" title="Remove">✕</button></div>`;
  }

  /** Which pipeline layers change a stat for this soldier (details table tag). */
  private sources(s: SoldierIdentity, key: 'hp' | 'damage' | 'fireRate' | 'spread' | 'moveSpeed' | 'reviveTime' | 'healMul' | 'range') {
    const out: string[] = [];
    const lv = s.progression?.level ?? 1, acc = getAccount();
    if (lv > 1 && (key === 'hp' || key === 'damage' || key === 'fireRate')) out.push(`LV ${lv}`);
    const tKey = key === 'spread' ? 'accuracy' : key;
    if ((TRAINING_IDS as string[]).includes(tKey) && s.training[tKey as TrainingStat] > 0) out.push('Training');
    if (s.progression && (SQUAD_TRAINING_IDS as string[]).includes(tKey) && acc.squadTraining[tKey as SquadTrainingStat] > 0) out.push('Squad');
    const t = s.traitId ? TRAITS[s.traitId] : null;
    const tm = t?.mods as Record<string, number> | undefined;
    const mk = key === 'spread' ? 'spreadMul' : key === 'healMul' ? 'healMul' : `${key}Mul`;
    if (tm && tm[mk] !== undefined) out.push(t!.name);
    return out.join(' + ');
  }

  private detailsHtml(s: SoldierIdentity) {
    const base = classStats(s.classId), eff = effectiveStats(s);
    const t = s.traitId ? TRAITS[s.traitId] : null;
    const ability = ABILITY_NAMES[CLASSES[s.classId].abilityId];
    type Row = [string, number, number, string, Parameters<Menus['sources']>[1]];
    const rows: Row[] = [
      ['Max HP', base.hp, eff.hp, '', 'hp'],
      ['Damage per shot', base.damage, eff.damage, '', 'damage'],
      ['Fire rate', base.fireRate, eff.fireRate, '/s', 'fireRate'],
      ['Spread, standing', base.accuracy, eff.accuracy, '°', 'spread'],
      ['Spread, moving', base.accuracy + base.movePenalty, eff.accuracy + eff.movePenalty, '°', 'spread'],
      ['Move speed', base.moveSpeed, eff.moveSpeed, ' px/s', 'moveSpeed'],
      ['Revive time (as reviver)', base.reviveTime, eff.reviveTime, ' s', 'reviveTime'],
      ['Range', base.range, eff.range, ' px', 'range'],
    ];
    if (s.classId === 'medic') {
      const h = CFG.fieldTreatment.healFrac * 100;
      rows.push(['Field Treatment heal', h, h * eff.healMul, '% max HP', 'healMul']);
    }
    const lower = new Set(['Spread, standing', 'Spread, moving', 'Revive time (as reviver)']); // smaller is better
    const tr = rows.map(([label, b, e, u, key]) => {
      const changed = Math.abs(b - e) > 1e-9;
      const better = changed && (lower.has(label) ? e < b : e > b);
      return `<tr class="${changed ? (better ? 'up' : 'down') : ''}"><td>${label}</td><td>${num(b)}${u}</td><td>${num(e)}${u}${changed ? ` <i>${this.sources(s, key)}</i>` : ''}</td></tr>`;
    }).join('');
    const p = s.progression;
    const lp = levelProgress(p?.xp ?? 0);
    const sel = this.game.roster.isSelected(s.id);
    const locked = !this.game.roster.isUnlocked(s.id);
    const full = this.game.roster.count() >= this.game.capacity;
    const ranks = TRAINING_IDS.map((k) => `${TRAINING[k].label} ${s.training[k]}/${maxRank(TRAINING[k])}`).join(' · ');
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
          <div class="d-xp">${this.xpBar(s, 'xp big')}<span>${lp.max ? `LV ${lp.level} · MAX LEVEL` : `LV ${lp.level} · XP ${lp.into}/${lp.need} to LV ${lp.level + 1}`}</span></div>
          <table class="d-stats"><thead><tr><th>Stat</th><th>Class base</th><th>Effective</th></tr></thead><tbody>${tr}</tbody></table>
          ${!locked && !sel && full && this.targetSlot === null ? '<div class="d-full">Squad full for this mission: remove someone, or tap a squad slot first to replace its soldier.</div>' : ''}
          <div class="d-prog">Training: ${ranks} · Missions ${s.service.missions} (won ${s.service.victories}) · Kills ${s.service.kills}</div>
          ${locked ? `<div class="d-full">🔒 ${esc(this.game.roster.unlockText(s.id))}</div>` : ''}
          <div class="d-btns">
            ${locked ? '<button class="m-big" disabled>LOCKED</button>' : sel ? `<button class="m-big alt" data-a="deselect" data-id="${s.id}">REMOVE FROM SQUAD</button>`
              : this.targetSlot !== null ? `<button class="m-big" data-a="select" data-id="${s.id}">PUT IN SLOT ${this.targetSlot + 1}</button>`
              : full ? `<button class="m-big" disabled title="Squad full">SQUAD FULL</button>`
              : `<button class="m-big" data-a="select" data-id="${s.id}">ADD TO SQUAD</button>`}
            <button class="m-big alt" data-a="train" data-id="${s.id}" ${locked ? 'disabled' : ''}>TRAIN</button>
            <button class="m-big alt" data-a="close">CLOSE</button>
          </div>
        </div>
      </div>`;
  }

  // ----- Individual Training tab -----
  private trainingHtml() {
    const r = this.game.roster, acc = getAccount();
    const owned = r.soldiers.filter((x) => r.isUnlocked(x.id));
    const s = owned.find((x) => x.id === this.trainId) ?? owned[0] ?? r.soldiers[0];
    const list = owned.map((x) => `
      <button class="t-pick ${x.id === s.id ? 'on' : ''}" data-a="tsel" data-id="${x.id}">
        <b>${esc(x.name)}</b><span>${CLASSES[x.classId].short} · LV ${x.progression?.level ?? 1}</span>${this.xpBar(x)}
      </button>`).join('');
    const t = s.traitId ? TRAITS[s.traitId] : null;
    const lp = levelProgress(s.progression?.xp ?? 0);
    const cur = effectiveStats(s);
    const rows = TRAINING_IDS.map((k) => {
      const def = TRAINING[k], rank = s.training[k], max = maxRank(def), cost = nextCost(def, rank);
      const next = cost === null ? null : effectiveStats(s, { level: s.progression?.level ?? 1, training: { ...s.training, [k]: rank + 1 }, squad: acc.squadTraining });
      const afford = cost !== null && acc.credits >= cost;
      const btn = cost === null ? '<button class="t-buy max" disabled>MAX</button>'
        : `<button class="t-buy ${afford ? '' : 'poor'}" data-a="buy" data-id="${s.id}" data-stat="${k}" data-rank="${rank}" ${afford ? '' : 'disabled'} title="${afford ? 'Buy' : 'Not enough Credits'}">${cr(cost)} CR</button>`;
      return `
        <div class="t-row" data-stat="${k}">
          <div class="t-name"><b>${def.label}</b><span>${def.desc}</span></div>
          <div class="t-rank"><span class="pips">${this.pips(rank, max)}</span><span class="t-rk">RANK ${rank}/${max}</span></div>
          <div class="t-val">${STAT_VIEW[k].get(cur)}${next ? ` → <b>${STAT_VIEW[k].get(next)}</b>` : ' <b>MAX</b>'}</div>
          ${btn}
        </div>`;
    }).join('');
    return `
      <div class="t-main">
        <div class="t-list">${list}</div>
        <section class="t-panel t-scroll">
          <div class="t-head">
            <canvas class="d-port" data-cls="${s.classId}"></canvas>
            <div class="d-id">
              <div class="d-name">${esc(s.name)} <span class="s-lv">LV ${lp.level}</span></div>
              <div class="d-cls">${CLASSES[s.classId].label} · ${t ? t.name : 'No trait'}</div>
              <div class="d-xp">${this.xpBar(s, 'xp big')}<span>${lp.max ? 'MAX LEVEL' : `XP ${lp.into}/${lp.need} to LV ${lp.level + 1}`}</span></div>
            </div>
          </div>
          <div class="t-rows">${rows}</div>
          <div class="t-foot">Individual training stays with ${esc(s.name)} (levels, retries, squad changes). Percentages are of the class base and add up; the trait applies on top. Spread never goes below ${PROGRESSION.spreadFloorDeg}°.</div>
        </section>
      </div>`;
  }

  private pips(rank: number, max: number) {
    return Array.from({ length: max }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
  }

  // ----- Squad Training tab -----
  private squadTrainingHtml() {
    const acc = getAccount();
    const rows = SQUAD_TRAINING_IDS.map((k) => {
      const def = SQUAD_TRAINING[k], rank = acc.squadTraining[k], max = maxRank(def), cost = nextCost(def, rank);
      const afford = cost !== null && acc.credits >= cost;
      const btn = cost === null ? '<button class="t-buy max" disabled>MAX</button>'
        : `<button class="t-buy ${afford ? '' : 'poor'}" data-a="sbuy" data-stat="${k}" data-rank="${rank}" ${afford ? '' : 'disabled'} title="${afford ? 'Buy' : 'Not enough Credits'}">${cr(cost)} CR</button>`;
      const now = def.perRank * rank, nxt = def.perRank * (rank + 1);
      const field = k === 'accuracy' ? 'accuracy' : k;
      const ex = CLASS_IDS.map((c) => {
        const b = classStats(c);
        const g = (r: number) => grownStats(b, { level: 1, training: { accuracy: 0, damage: 0, hp: 0, fireRate: 0, moveSpeed: 0 }, squad: { ...acc.squadTraining, [k]: r } })[field];
        return `${CLASSES[c].short} ${num(g(rank))}${cost !== null ? `→${num(g(rank + 1))}` : ''}`;
      }).join(' · ');
      return `
        <div class="t-row" data-stat="${k}">
          <div class="t-name"><b>${def.label}</b><span>${def.desc}</span></div>
          <div class="t-rank"><span class="pips">${this.pips(rank, max)}</span><span class="t-rk">RANK ${rank}/${max}</span></div>
          <div class="t-val">${pct(now)}${cost !== null ? ` → <b>${pct(nxt)}</b>` : ' <b>MAX</b>'}<small>${ex}</small></div>
          ${btn}
        </div>`;
    }).join('');
    return `
      <section class="t-panel q-panel t-scroll">
        <div class="q-note">Squad Training applies to <b>every soldier in the roster</b>, now and in the future (deployed or not). It adds to individual training and levels as a percentage of the class base; it never stacks with itself.</div>
        <div class="t-rows">${rows}</div>
        <div class="t-foot">Class-base examples shown as INF / HVY / MED values. ${VERSION_LABEL}</div>
      </section>`;
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
  /** Renders from the settled reward record only: re-rendering can never pay again. */
  showResults() {
    const g = this.game;
    const won = g.phase === 'won';
    const rw = g.lastReward;
    const m = g.mission;
    this.screen = 'results';
    this.root.className = 'results';
    if (rw) rw.unlockedSoldiers.forEach((id) => this.newSoldiers.add(id));
    const xpOf = new Map(rw?.soldiers.map((x) => [x.id, x]) ?? []);
    const rows = g.stats.rows(g.soldiers).map((r) => {
      const x = xpOf.get(r.id);
      let prog = '<span class="dim">—</span>';
      if (x) {
        const lv = x.levelsGained > 0 ? `<b class="up">LV ${x.before.level} → LV ${x.after.level}</b>` : `LV ${x.after.level}`;
        prog = x.eligible ? `${lv} · <b>+${x.xp} XP</b>${x.capped ? ' <span class="dim">(MAX)</span>' : ''}` : `${lv} · <span class="dim">no XP</span>`;
      }
      return `
      <tr class="st-${r.status.toLowerCase()} ${x && x.levelsGained > 0 ? 'lvup' : ''}">
        <td class="r-name"><b>${esc(r.name)}</b><span>${CLASSES[r.classId].short}${r.traitId ? ` · ${TRAITS[r.traitId].name}` : ''}</span></td>
        <td>${r.kills}</td><td>${Math.round(r.damage)}</td><td>${Math.round(r.healing)}</td><td>${r.revives}</td>
        <td class="r-status">${r.status}</td>
        <td class="r-xp">${prog}</td>
      </tr>`;
    }).join('');
    const levelUps = rw?.soldiers.filter((x) => x.levelsGained > 0).map((x) =>
      `<div class="r-lvl">▲ ${esc(x.name.toUpperCase())} — LV ${x.before.level} → LV ${x.after.level} — +${x.xp} XP</div>`).join('') ?? '';
    const unlocks = rw ? [
      ...rw.unlockedSoldiers.map((id) => { const s = g.roster.get(id)!; return `<div class="r-unl soldier">★ NEW SOLDIER JOINED: <b>${esc(s.name.toUpperCase())}</b> (${CLASSES[s.classId].label})</div>`; }),
      ...rw.unlockedMissions.map((id) => { const c = campaignMission(id)!; return `<div class="r-unl">▶ MISSION ${c.number} UNLOCKED: <b>${esc(c.name)}</b>${capacityFor(c.number) > capacityFor(m.def.number) ? ` · squad size ${capacityFor(c.number)}` : ''}</div>`; }),
      ...(rw.legacyFirstClearPaid ? ['<div class="r-unl dim">First-clear Credit bonus was already paid for this map in v0.3 (Comms Outpost)</div>'] : []),
      ...(rw.firstClear && m.def.unlocks.capacityNote ? [`<div class="r-unl">▲ ${esc(m.def.unlocks.capacityNote.toUpperCase())}</div>`] : []),
    ].join('') : '';
    let rewards: string;
    if (g.deployment.kind !== 'roster') rewards = `<div class="r-none">${g.deployment.kind === 'generic' ? 'Dev preset squad (generic soldiers)' : 'Temporary dev squad'}: no XP, Credits, stars or unlocks.</div>`;
    else if (!rw || !won) rewards = `<div class="r-none">No XP or Credits for a failed mission.</div><div class="r-total">Credits <b class="r-cr">${cr(getAccount().credits)}</b></div>`;
    else {
      const lines = rw.creditLines.map((l) => `<tr><td>${l.label}</td><td>+${cr(l.amount)}</td></tr>`).join('');
      const xpl = rw.xpLines.map((l) => `${l.amount}`).join(' + ');
      rewards = `
        <div class="r-rtitle">CREDITS <b>+${cr(rw.credits)}</b></div>
        <table class="r-lines">${lines}</table>
        <div class="r-total">Total <b class="r-cr">${cr(rw.creditsAfter)}</b> CR</div>
        <div class="r-xpline" title="Same XP for every soldier who extracted; none for KIA">XP per survivor: ${rw.xpMul !== 1 ? '(' : ''}${xpl}${rw.xpMul !== 1 ? `) × ${rw.xpMul} replay` : ''} = <b>${rw.xpEach}</b></div>`;
    }
    const st = g.lastStars;
    const starN = st?.stars ?? 0;
    const newBest = !!rw && won && rw.bestStars > rw.prevBest && rw.prevBest > 0;
    const crit = st ? st.criteria.map((c) => `<span class="${c.met ? 'ok' : 'no'}">${c.met ? '✓' : '✗'} ${c.label}</span>`).join('') : '';
    const opts = m.optionals.length ? m.optionals.map((o) => `<span class="${o.state === 'complete' ? 'ok' : 'no'}">${o.state === 'complete' ? '✓' : '✗'} ${esc(o.label)}${o.state === 'complete' ? ` <small>+${PROGRESSION.xp.perOptionalObjective} XP · +${PROGRESSION.credits.perOptionalObjective} CR</small>` : ''}</span>`).join('') : '';
    const tag = rw && won ? (rw.firstClear ? '<span class="r-tag first">FIRST CLEAR</span>' : '<span class="r-tag">REPLAY</span>') : '';
    const why = won ? 'The squad made it out.' : m.failReason || 'The whole squad is down.';
    this.root.innerHTML = `
      <div class="m-wrap r-wrap">
        <div class="r-card ${won ? 'won' : 'lost'}">
          <div class="r-mission">MISSION ${m.def.number} · ${esc(m.name.toUpperCase())}</div>
          <div class="r-title">${won ? 'MISSION COMPLETE' : 'MISSION FAILED'} ${tag}</div>
          <div class="r-stars">${stars(starN)}${newBest ? '<span class="r-tag first">NEW BEST</span>' : ''}<div class="r-crit">${crit}</div></div>
          <div class="r-sub">${why} · Mission time <b>${fmtTime(g.time)}</b></div>
          ${opts ? `<div class="r-opts"><b>OPTIONAL</b> ${opts}</div>` : ''}
          ${unlocks ? `<div class="r-unls">${unlocks}</div>` : ''}
          ${levelUps ? `<div class="r-lvls">${levelUps}</div>` : ''}
          <div class="r-body">
            <table class="r-table">
              <thead><tr><th>Soldier</th><th>Kills</th><th>Dmg</th><th>Heal</th><th>Rev</th><th>Status</th><th>XP</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
            <aside class="r-rewards">${rewards}</aside>
          </div>
          <div class="r-btns">
            <button class="m-big ${won ? 'alt' : ''}" data-a="retry">RETRY</button>
            <button class="m-big ${won ? '' : 'alt'}" data-a="campaign">CAMPAIGN</button>
            <button class="m-big alt" data-a="barracks">BARRACKS</button>
          </div>
          <div class="r-note">Enter retry · C campaign · B barracks · KIA only lasts for the mission: everyone is back in the Barracks.</div>
        </div>
      </div>`;
  }

  // ---------------- input ----------------
  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!el || !this.root.contains(el)) return;
    if (el instanceof HTMLButtonElement && el.disabled) return;
    unlockAudio();
    const a = el.dataset.a, id = el.dataset.id, g = this.game, r = g.roster;
    switch (a) {
      case 'settings': this.openSettings(); return;
      case 'deploy': this.deploy(); return;
      case 'retry': g.reset(); return;
      case 'barracks': g.toBarracks(); return;
      case 'campaign': g.toCampaign(); return;
      case 'to-barracks': this.showBarracks(); return;
      case 'to-campaign': this.showCampaign(); return;
      case 'csel': {
        const m = campaignMission(id!);
        this.campaignSel = id!;
        if (m && this.missionState(m) !== 'locked' && m.playable) g.selectMission(id!);
        this.renderCampaign();
        return;
      }
      case 'trim': r.trimTo(g.capacity); break;
      case 'tab': this.tab = el.dataset.tab as BarracksTab; this.detailsId = null; this.targetSlot = null; break;
      case 'tsel': this.trainId = id!; break;
      case 'train': this.trainId = id!; this.tab = 'training'; this.detailsId = null; break;
      case 'buy': case 'sbuy': {
        e.stopPropagation();
        this.buy(el);
        return;
      }
      case 'details': this.detailsId = id!; break;
      case 'close': this.detailsId = null; break;
      case 'close-bg': if (e.target === el) this.detailsId = null; else return; break;
      case 'select': {
        const res = r.select(id!, this.targetSlot ?? undefined, g.capacity);
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

  /** One purchase per tap: repeat taps on the same Buy button inside purchaseLockMs and stale buttons are ignored. */
  private buy(el: HTMLElement) {
    const now = performance.now(), key = `${el.dataset.a}:${el.dataset.id ?? ''}:${el.dataset.stat}`;
    if (key === this.lastBuy.key && now - this.lastBuy.t < PROGRESSION.purchaseLockMs) return; // same button, double tap
    this.lastBuy = { key, t: now };
    const g = this.game, stat = el.dataset.stat!, rank = Number(el.dataset.rank);
    const expected = Number.isInteger(rank) ? rank : null;
    const res = el.dataset.a === 'buy'
      ? buyTraining(g.roster, getAccount(), el.dataset.id!, stat as TrainingStat, expected, g.persist)
      : buySquadTraining(getAccount(), stat as SquadTrainingStat, expected, g.persist);
    this.renderBarracks();
    if (!res.ok) { this.notice(res.reason); return; }
    const label = el.dataset.a === 'buy' ? `${g.roster.get(el.dataset.id!)!.name}: ${TRAINING[stat as TrainingStat].label}` : SQUAD_TRAINING[stat as SquadTrainingStat].label;
    this.notice(`${label} rank ${res.rank} (−${cr(res.cost)} CR)${res.saved ? '' : ' · not saved (no storage)'}`);
  }

  private deploy() {
    if (this.screen === 'campaign' && this.campaignSel !== this.game.missionId) { this.notice('This mission is locked.'); return; }
    const res = this.game.deploySelected();
    if (!res.ok) this.notice(res.reason);
  }

  private onKey(e: KeyboardEvent) {
    if (!this.visible || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (this.screen === 'barracks') {
      if (e.code === 'Escape') {
        if (this.detailsId) this.detailsId = null;
        else if (this.targetSlot !== null) this.targetSlot = null;
        else { this.showCampaign(); return; }
        this.renderBarracks();
      } else if (e.code === 'Enter' && !this.detailsId) { e.preventDefault(); this.deploy(); }
      else if (e.code === 'KeyC' && !this.detailsId) this.showCampaign();
    } else if (this.screen === 'campaign') {
      if (e.code === 'Enter') { e.preventDefault(); this.deploy(); }
      else if (e.code === 'KeyB') this.showBarracks();
      else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const open = CAMPAIGN.filter((m) => m.playable && this.missionState(m) !== 'locked');
        const i = open.findIndex((m) => m.id === this.campaignSel);
        const next = open[Math.max(0, Math.min(open.length - 1, i + (e.code === 'ArrowDown' ? 1 : -1)))];
        if (next) { this.campaignSel = next.id; this.game.selectMission(next.id); this.renderCampaign(); }
      }
    }
    // Results keys (Enter retry, C campaign, B/Esc barracks) are handled by Game.onKey
  }
}
