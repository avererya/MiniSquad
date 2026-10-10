// Full-viewport menu screens (outside the scaled 1280x720 stage, so text stays readable on
// phones): the Campaign screen (v0.4: mission list + details, launch screen), the Barracks
// (tabs: Roster / Training / Squad Training / Recruit (v0.5), plus a details panel with
// Rename / Dismiss and their confirmation dialogs) and the mission Results
// screen (stats, stars, optional objectives, XP and level-ups, Credits, unlocks).
// Flow: Campaign -> Barracks (squad for the selected mission) -> Deploy -> Mission -> Results
// -> Retry / Campaign / Barracks. Campaign can also deploy the saved squad directly.
// v0.6: when soldiers fell, Results -> the casualty DECISIONS screen (one fallen soldier at a time:
// Resurrect / Manage Roster (restricted: dismissals only) / Honor in Memorial with a separate,
// delayed confirmation), then Operation Phoenix when the squad collapsed. While decisions are
// pending every other screen redirects there (also on launch). The Memorial screen lists the
// honored soldiers (Barracks / Campaign).
import type { Game } from './game';
import { ABILITY_NAMES, CLASSES, CLASS_IDS, classStats, effectiveStats, newProgression, type SoldierIdentity } from './classes';
import { CFG } from './config';
import { TRAITS } from './traits';
import { SQUAD_SLOTS, defaultRoster } from './roster';
import { drawClassPortrait } from './render';
import { unlockAudio } from './audio';
import { VERSION_LABEL } from './version';
import { CAMPAIGN, MISSION_TYPE_LABEL, SOLDIER_UNLOCK, STARTING_SOLDIERS, STAR_TEXT, campaignMission, capacityFor, type CampaignMission } from './campaign';
import {
  PROGRESSION, SQUAD_TRAINING, SQUAD_TRAINING_IDS, TRAINING, TRAINING_IDS, getAccount, grownStats, levelProgress, maxRank, newTraining, nextCost, xpForLevel,
  type CandidateRecord, type SquadTrainingStat, type TrainingStat,
} from './progression';
import { buySquadTraining, buyTraining, dismiss, dismissBlock, dismissRefund, enlistPhoenix, lineupKey, memorialize, openOffice, recruit, recruitBlock, refreshOffers, rename, resurrect } from './economy';
import { MEMORIAL_ARM_MS, PHOENIX_RECRUITS, casualtyPosition, costFor, decisionBlock, pendingCasualties } from './casualties';
import { NAME_MAX, RECRUIT_CLASSES, RECRUIT_LOCK_MS, REFRESH_ARM_MS, REFRESH_COST, campaignProgress, priceOf, startingLevelFor } from './recruitment';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const num = (v: number) => String(Math.round(v * 100) / 100);
const cr = (v: number) => v.toLocaleString('en-US');
const pct = (f: number) => (Math.abs(f) < 1e-9 ? '0%' : `${f > 0 ? '+' : '−'}${num(Math.abs(f * 100))}%`);

type Screen = 'none' | 'campaign' | 'barracks' | 'results' | 'decisions' | 'memorial';
const CAUSE_TEXT = { bleedout: 'Bled out', abandoned: 'Left behind at extraction', interrupted: 'Fell in an abandoned mission' } as const;
/** v0.6: taps are ignored this long after a resurrection / Memorial / Phoenix enlistment (the next card can't be hit by a double tap). */
const DECISION_LOCK_MS = 600;
const stars = (n: number, of = 3) => `<span class="stars" title="${n}/${of} stars">${'★'.repeat(n)}<i>${'★'.repeat(Math.max(0, of - n))}</i></span>`;
export type BarracksTab = 'roster' | 'training' | 'squad' | 'recruit';
const TABS: [BarracksTab, string][] = [['roster', 'ROSTER'], ['training', 'TRAINING'], ['squad', 'SQUAD TRAINING'], ['recruit', 'RECRUIT']];

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
  /** Campaign screen: the New Campaign confirmation is open. */
  resetOpen = false;
  /** Mission highlighted on the Campaign screen. */
  campaignSel = '';
  /** Soldiers unlocked since the Barracks was last opened ("NEW" badge). */
  newSoldiers = new Set<string>();
  /** v0.5: dismissal confirmation / rename dialog (soldier id, null = closed). */
  dismissId: string | null = null;
  renameId: string | null = null;
  renameDraft = '';
  renameError = '';
  /** Refresh is armed by a first tap until this time (ms); a second tap inside the window refreshes. */
  private refreshArmedUntil = 0;
  private refreshTimer = 0;
  /** After a recruitment transaction every tap is ignored briefly (a double tap can't hit the new offer / next card). */
  private txLockUntil = 0;
  /** v0.6 decisions screen: 'fallen' (current casualty) | 'confirm' (Memorial confirmation) | 'roster' (restricted dismissals). */
  decView: 'fallen' | 'confirm' | 'roster' = 'fallen';
  /** Memorial confirmation: performance.now() when it opened (the confirm button arms MEMORIAL_ARM_MS later). */
  private confirmAt = 0;
  private confirmTimer = 0;
  /** Operation Phoenix: candidate ids picked so far (not saved; the candidates are). */
  phoenixPicks: string[] = [];
  /** Where the Memorial screen returns to. */
  private memorialBack: 'campaign' | 'barracks' = 'barracks';

  constructor(private root: HTMLElement, private game: Game, private openSettings: () => void) {
    root.addEventListener('click', (e) => this.onClick(e));
    // rename dialog: typing never re-renders (focus and the phone keyboard stay up); Enter saves, Esc cancels
    root.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.id === 'rn-input') this.renameDraft = t.value; });
    root.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.id !== 'rn-input') return;
      if (e.key === 'Enter') { e.preventDefault(); this.submitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.renameId = null; this.renderBarracks(); }
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.drawPortraits(), 120);
    });
  }

  get visible() { return this.screen !== 'none'; }

  hide() {
    this.screen = 'none'; this.detailsId = null; this.targetSlot = null; this.dismissId = null; this.renameId = null;
    this.root.className = 'hidden';
    this.root.innerHTML = '';
  }

  // ---------------- Campaign ----------------
  showCampaign(notice?: string) {
    if (decisionBlock(getAccount())) { this.showDecisions(notice); return; }
    if (this.screen === 'barracks') this.newSoldiers.clear();
    if (this.screen !== 'campaign') this.resetOpen = false;
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
          <button class="m-nav c-reset" data-a="reset-open" title="Wipe all progress and start a new campaign">NEW CAMPAIGN…</button>
          <button class="m-nav" data-a="to-barracks" title="Barracks: soldiers, training (B)">BARRACKS</button>
          <button class="m-icon" data-a="memorial" data-from="campaign" title="Memorial (${acc.memorial.length} honored)" aria-label="Memorial">🕯️</button>
          <button class="m-icon" data-a="settings" title="Settings (\`)">⚙</button>
          <div class="m-notice"></div>
        </header>
        <div class="c-main">
          <nav class="c-list">${list}<div class="m-ver">${VERSION_LABEL}</div></nav>
          ${this.missionDetailHtml(m)}
        </div>
      </div>
      ${this.resetOpen ? this.resetHtml() : ''}`;
  }

  /** Player-facing "New Campaign" confirmation: says exactly what is wiped; Cancel / Confirm. */
  private resetHtml() {
    const a = getAccount(), r = this.game.roster;
    return `
      <div class="m-modal" data-a="reset-cancel-bg">
        <div class="d-card x-card" role="dialog" aria-label="Start a new campaign">
          <div class="x-title">START A NEW CAMPAIGN?</div>
          <div class="x-warn">⚠ This permanently wipes ALL progress on this device: your roster (${r.activeCount()} soldiers, including every recruit), all XP and levels, individual training, squad training, ${cr(a.credits)} Credits, campaign progress and stars, the Recruitment Office offers and name history.</div>
          <div class="rn-help">You restart with Ace and Ranger at Mission 1 and 0 Credits. A copy of the current save is kept on this device (latest reset only).</div>
          <div class="d-btns">
            <button class="m-big alt" data-a="reset-cancel">CANCEL</button>
            <button class="m-big danger" data-a="reset-confirm">WIPE &amp; START OVER</button>
          </div>
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
      ...m.unlocks.soldiers.map((id) => { const d = r.get(id) ?? defaultRoster().find((x) => x.id === id); return d ? `${esc(d.name)} joins (${CLASSES[d.classId].label})` : ''; }).filter(Boolean),
      ...(m.unlocks.capacityNote ? [m.unlocks.capacityNote] : []),
    ];
    if (!m.playable) {
      const upcoming = defaultRoster().filter((d) => !r.unlocked.has(d.id) && SOLDIER_UNLOCK[d.id] && !SOLDIER_UNLOCK[d.id].by && !STARTING_SOLDIERS.includes(d.id));
      if (upcoming.length) unl.push(...upcoming.map((d) => `${esc(d.name)} (${CLASSES[d.classId].label}) joins at the Mission 7 milestone`));
    }
    const first = rec && rec.completions > 0 ? '<span class="dim">First-clear rewards collected</span>'
      : m.legacyId && acc.missions[m.legacyId]?.firstClearRun
        ? `<span class="dim">First-clear Credit bonus already earned on this map in v0.3</span>${unl.length ? ' · ' + unl.join(' · ') : ''}`
        : `+${cr(PROGRESSION.credits.firstClear)} CR first-clear bonus${unl.length ? ' · ' + unl.join(' · ') : ''}`;
    const firstLine = m.playable ? first : `<span class="dim">Future update</span>${unl.length ? ' · ' + unl.join(' · ') : ''}`;
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
        <div class="c-first"><b>FIRST CLEAR</b> ${firstLine}</div>
        ${st === 'locked' ? `<div class="c-lock">🔒 Clear Mission ${prev?.number ?? 1} (${esc(prev?.name ?? '')}) to unlock.</div>` : ''}
        <div class="c-btns">
          <button class="m-big alt" data-a="to-barracks" ${st === 'locked' || st === 'soon' ? 'disabled' : ''}>SQUAD ▸</button>
          <button class="m-big" data-a="deploy" ${block ? 'disabled' : ''} title="${block ? esc(block) : 'Deploy the selected squad (Enter)'}">DEPLOY</button>
        </div>
      </section>`;
  }

  // ---------------- Barracks ----------------
  showBarracks(notice?: string) {
    if (decisionBlock(getAccount())) { this.showDecisions(notice); return; }
    if (this.screen === 'barracks') this.newSoldiers.clear(); // badges last for one Barracks visit
    this.screen = 'barracks';
    this.root.className = 'barracks';
    if (!this.game.roster.get(this.trainId)) this.trainId = this.game.roster.owned()[0]?.id ?? 'ace';
    if (this.tab === 'recruit') openOffice(this.game.roster, getAccount(), this.game.persist);
    this.renderBarracks();
    if (notice) this.notice(notice);
  }

  private renderBarracks() {
    const scroll = this.root.querySelector('.t-scroll')?.scrollTop ?? 0;
    const acc = getAccount();
    const tabs = TABS.map(([id, label]) => `<button class="m-tab ${this.tab === id ? 'on' : ''}" data-a="tab" data-tab="${id}">${label}</button>`).join('');
    const body = this.tab === 'training' ? this.trainingHtml() : this.tab === 'squad' ? this.squadTrainingHtml() : this.tab === 'recruit' ? this.recruitHtml() : this.rosterHtml();
    this.root.innerHTML = `
      <div class="m-wrap">
        <header class="m-head">
          <button class="m-nav back" data-a="to-campaign" title="Campaign (C)">◂ CAMPAIGN</button>
          <div class="m-title">BARRACKS</div>
          <nav class="m-tabs">${tabs}</nav>
          <div class="m-credits" title="Credits (account-wide)"><span>CREDITS</span> <b class="m-cr">${cr(acc.credits)}</b></div>
          ${this.tab !== 'roster' && this.tab !== 'recruit' ? `<button class="m-deploy" data-a="deploy" ${this.game.deployBlock() ? 'disabled' : ''} title="Deploy the selected squad (Enter)">DEPLOY ▸</button>` : ''}
          <button class="m-icon" data-a="memorial" data-from="barracks" title="Memorial (${acc.memorial.length} honored)" aria-label="Memorial">🕯️</button>
          <button class="m-icon" data-a="settings" title="Settings (\`)">⚙</button>
          <div class="m-notice"></div>
        </header>
        ${body}
      </div>
      ${this.modalHtml()}`;
    const sc = this.root.querySelector('.t-scroll');
    if (sc) sc.scrollTop = scroll;
    this.drawPortraits();
  }

  // ----- Roster tab (squad selection; unchanged flow) -----
  private rosterHtml() {
    const r = this.game.roster, g = this.game;
    const cap = g.capacity;
    // v0.5: only soldiers the player owns (joined campaign soldiers + recruits). Upcoming
    // campaign soldiers are previewed on the Campaign screen, not as roster cards.
    const cards = r.owned().map((s) => this.cardHtml(s)).join('');
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
            <div class="b-counts"><span class="b-count" title="Soldiers selected / this mission's limit">DEPLOYED <b class="${over ? 'warn' : ''}">${n} / ${cap}</b></span><span class="b-count" title="Soldiers in your roster / roster cap">ROSTER <b class="${r.activeCount() > getAccount().recruitment.rosterCap ? 'warn' : ''}">${r.activeCount()} / ${getAccount().recruitment.rosterCap}</b></span></div>
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
    const dBlock = dismissBlock(this.game.roster, s.id, this.game.phase !== 'start');
    return `
      <div class="m-modal" data-a="close-bg">
        <div class="d-card" data-id="${s.id}">
          <div class="d-head">
            <canvas class="d-port" data-cls="${s.classId}"></canvas>
            <div class="d-id">
              <div class="d-name">${esc(s.name)} <span class="s-lv">LV ${p?.level ?? 1}</span>${locked ? '' : ` <button class="d-rename" data-a="rename" data-id="${s.id}" title="Rename">✎ RENAME</button>`}</div>
              <div class="d-cls">${CLASSES[s.classId].label} · Ability: ${ability}</div>
              <div class="d-trait"><b>${t ? t.name : 'No trait'}</b> ${t ? `— ${t.desc}` : ''}</div>
            </div>
            <button class="m-icon" data-a="close" title="Close (Esc)">✕</button>
          </div>
          <div class="d-xp">${this.xpBar(s, 'xp big')}<span>${lp.max ? `LV ${lp.level} · MAX LEVEL` : `LV ${lp.level} · XP ${lp.into}/${lp.need} to LV ${lp.level + 1}`}</span></div>
          <table class="d-stats"><thead><tr><th>Stat</th><th>Class base</th><th>Effective</th></tr></thead><tbody>${tr}</tbody></table>
          ${!locked && !sel && full && this.targetSlot === null ? '<div class="d-full">Squad full for this mission: remove someone, or tap a squad slot first to replace its soldier.</div>' : ''}
          <div class="d-prog">Training: ${ranks}</div>
          ${this.careerHtml(s)}
          ${locked ? `<div class="d-full">🔒 ${esc(this.game.roster.unlockText(s.id))}</div>` : ''}
          <div class="d-btns">
            ${locked ? '<button class="m-big" disabled>LOCKED</button>' : sel ? `<button class="m-big alt" data-a="deselect" data-id="${s.id}">REMOVE FROM SQUAD</button>`
              : this.targetSlot !== null ? `<button class="m-big" data-a="select" data-id="${s.id}">PUT IN SLOT ${this.targetSlot + 1}</button>`
              : full ? `<button class="m-big" disabled title="Squad full">SQUAD FULL</button>`
              : `<button class="m-big" data-a="select" data-id="${s.id}">ADD TO SQUAD</button>`}
            <button class="m-big alt" data-a="train" data-id="${s.id}" ${locked ? 'disabled' : ''}>TRAIN</button>
            ${locked ? '' : `<button class="m-big danger" data-a="dismiss" data-id="${s.id}" ${dBlock ? 'disabled' : ''} title="${esc(dBlock ?? `Dismiss for +${dismissRefund(s)} CR`)}">DISMISS…</button>`}
            <button class="m-big alt" data-a="close">CLOSE</button>
          </div>
          ${!locked && dBlock && !/mission/i.test(dBlock) ? `<div class="d-note">${esc(dBlock)}</div>` : ''}
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

  // ----- v0.5: Recruitment Office -----
  /** Stats a candidate would have on joining: class + level + trait + current squad training (no individual training). */
  static candidateStats(c: CandidateRecord) {
    const p = { ...newProgression(), xp: xpForLevel(c.level), level: c.level };
    return effectiveStats({ classId: c.classId, traitId: c.traitId, mods: {}, progression: p, training: newTraining() });
  }

  private recruitHtml() {
    const r = this.game.roster, acc = getAccount(), rec = acc.recruitment;
    openOffice(r, acc, this.game.persist); // idempotent: only fills missing offers / owed introductions
    const block = recruitBlock(r, acc);
    const armed = performance.now() < this.refreshArmedUntil;
    const canRefresh = acc.credits >= REFRESH_COST;
    const cards = rec.offers.map((c) => {
      const t = TRAITS[c.traitId], st = Menus.candidateStats(c), price = priceOf(c.classId), afford = acc.credits >= price;
      const btn = block ? `<button class="rc-buy full" disabled title="${esc(block)}">ROSTER FULL</button>`
        : `<button class="rc-buy ${afford ? '' : 'poor'}" data-a="recruit" data-id="${c.id}" ${afford ? '' : 'disabled'} title="${afford ? `Recruit ${esc(c.name)}` : 'Not enough Credits'}">${afford ? 'RECRUIT · ' : ''}${cr(price)} CR</button>`;
      return `
        <div class="rc-card" data-id="${c.id}" data-cls="${c.classId}">
          <div class="s-top">
            <canvas class="s-port" data-cls="${c.classId}"></canvas>
            <div class="s-id">
              <div class="s-name">${esc(c.name)}</div>
              <div class="s-cls">${CLASSES[c.classId].label}</div>
              <span class="s-lv">LV ${c.level}</span>
            </div>
          </div>
          <div class="rc-trait"><b>${t.name}</b><span>${t.desc}</span></div>
          <div class="rc-stats">
            <span>HP <b>${num(Math.round(st.hp))}</b></span><span>DMG <b>${num(Math.round(st.damage * 10) / 10)}</b></span>
            <span>RATE <b>${num(Math.round(st.fireRate * 100) / 100)}/s</b></span><span>SPEED <b>${num(Math.round(st.moveSpeed))}</b></span>
          </div>
          ${btn}
        </div>`;
    }).join('');
    const lvl = startingLevelFor(campaignProgress(acc));
    const prices = RECRUIT_CLASSES.filter((x) => rec.introduced.includes(x.classId) || r.unlocked.has(x.requires ?? '')).map((x) => `${CLASSES[x.classId].label} ${cr(x.price)}`).join(' · ');
    return `
      <div class="rc-main">
        <div class="rc-bar">
          <span class="b-count">ROSTER <b class="${block ? 'warn' : ''}">${r.activeCount()} / ${rec.rosterCap}</b></span>
          <span class="rc-info">New recruits join at <b>LV ${lvl}</b> · squad training applies · ${prices} CR</span>
          <button class="rc-refresh ${armed ? 'armed' : ''}" data-a="refresh" data-key="${lineupKey(rec)}" ${canRefresh ? '' : 'disabled'} title="${canRefresh ? 'Replace all three candidates' : 'Not enough Credits'}">${armed ? `TAP AGAIN — ${REFRESH_COST} CR` : `↻ REFRESH · ${REFRESH_COST} CR`}</button>
        </div>
        ${block ? `<div class="rc-full">${esc(block)}</div>` : ''}
        <div class="rc-cards">${cards}</div>
      </div>`;
  }

  private modalHtml() {
    const r = this.game.roster;
    if (this.dismissId && r.get(this.dismissId)) return this.dismissHtml(r.get(this.dismissId)!);
    if (this.renameId && r.get(this.renameId)) return this.renameHtml(r.get(this.renameId)!);
    if (this.detailsId && this.tab === 'roster' && r.get(this.detailsId)) return this.detailsHtml(r.get(this.detailsId)!);
    return '';
  }

  private dismissHtml(s: SoldierIdentity) {
    const t = s.traitId ? TRAITS[s.traitId] : null;
    const block = dismissBlock(this.game.roster, s.id, this.game.phase !== 'start');
    return `
      <div class="m-modal" data-a="dismiss-cancel-bg">
        <div class="d-card x-card" role="dialog" aria-label="Dismiss soldier">
          <div class="x-title">DISMISS SOLDIER?</div>
          <div class="d-head">
            <canvas class="d-port" data-cls="${s.classId}"></canvas>
            <div class="d-id">
              <div class="d-name">${esc(s.name)} <span class="s-lv">LV ${s.progression?.level ?? 1}</span></div>
              <div class="d-cls">${CLASSES[s.classId].label}${t ? ` · ${t.name}` : ''}</div>
              <div class="x-refund">Refund <b>+${cr(dismissRefund(s))} CR</b>${s.origin === 'phoenix' ? ' <small>(Operation Phoenix recruit: no refund)</small>' : ''}</div>
            </div>
          </div>
          <div class="x-warn">⚠ ${esc(s.name)} leaves for good. Levels, XP and every training rank bought for them are permanently lost (training is not refunded). Dismissed soldiers are not honored in the Memorial. This cannot be undone.</div>
          ${block ? `<div class="d-full">${esc(block)}</div>` : ''}
          <div class="d-btns">
            <button class="m-big alt" data-a="dismiss-cancel">CANCEL</button>
            <button class="m-big danger" data-a="dismiss-confirm" data-id="${s.id}" ${block ? 'disabled' : ''}>CONFIRM DISMISSAL</button>
          </div>
        </div>
      </div>`;
  }

  private renameHtml(s: SoldierIdentity) {
    return `
      <div class="m-modal" data-a="rename-cancel-bg">
        <div class="d-card x-card" role="dialog" aria-label="Rename soldier">
          <div class="x-title">RENAME ${esc(s.name.toUpperCase())}</div>
          <input id="rn-input" class="rn-input" type="text" maxlength="${NAME_MAX}" value="${esc(this.renameDraft)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="New name">
          <div class="rn-help ${this.renameError ? 'err' : ''}">${this.renameError ? esc(this.renameError) : `1–${NAME_MAX} characters: letters, digits, space, - ' . · must be unique`}</div>
          <div class="d-btns">
            <button class="m-big alt" data-a="rename-cancel">CANCEL</button>
            <button class="m-big" data-a="rename-save" data-id="${s.id}">SAVE NAME</button>
          </div>
        </div>
      </div>`;
  }

  private submitRename() {
    const id = this.renameId;
    if (!id) return;
    const input = this.root.querySelector<HTMLInputElement>('#rn-input');
    if (input) this.renameDraft = input.value;
    const res = rename(this.game.roster, getAccount(), id, this.renameDraft, this.game.persist);
    if (!res.ok) {
      this.renameError = res.reason;
      this.renderBarracks();
      this.root.querySelector<HTMLInputElement>('#rn-input')?.focus();
      return;
    }
    this.renameId = null; this.renameError = '';
    this.renderBarracks();
    this.notice(res.name === res.old ? 'Name unchanged.' : `${res.old} is now ${res.name}.${res.saved ? '' : ' · not saved (no storage)'}`);
  }

  private doRecruit(id: string) {
    const g = this.game;
    const res = recruit(g.roster, getAccount(), id, g.persist, { inMission: g.phase !== 'start' });
    if (res.ok) this.newSoldiers.add(res.soldier.id);
    this.renderBarracks();
    this.notice(res.ok ? `${res.soldier.name} joined the roster (−${cr(res.cost)} CR).${res.saved ? '' : ' · not saved (no storage)'}` : res.reason);
  }

  private doRefresh(key: string) {
    const now = performance.now();
    if (now >= this.refreshArmedUntil) {
      // first tap only arms it (anti-accident; same idea as the two-tap save reset)
      this.refreshArmedUntil = now + REFRESH_ARM_MS;
      clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => { if (this.screen === 'barracks' && this.tab === 'recruit') this.renderBarracks(); }, REFRESH_ARM_MS + 30);
      this.renderBarracks();
      return;
    }
    this.refreshArmedUntil = 0;
    const g = this.game;
    const res = refreshOffers(g.roster, getAccount(), key, g.persist, { inMission: g.phase !== 'start' });
    this.renderBarracks();
    this.notice(res.ok ? `New candidates (−${cr(res.cost)} CR).${res.saved ? '' : ' · not saved (no storage)'}` : res.reason);
  }

  private doDismiss(id: string) {
    const g = this.game, s = g.roster.get(id);
    const res = dismiss(g.roster, getAccount(), id, g.persist, { inMission: g.phase !== 'start' });
    this.dismissId = null;
    if (res.ok) {
      this.detailsId = null; this.targetSlot = null; this.newSoldiers.delete(id);
      if (this.trainId === id) this.trainId = g.roster.owned()[0]?.id ?? '';
      g.forgetSoldier(id);
    }
    this.rerender();
    this.notice(res.ok ? `${s?.name ?? 'Soldier'} dismissed (+${cr(res.refund)} CR).${res.saved ? '' : ' · not saved (no storage)'}` : res.reason);
  }

  private drawPortraits() {
    if (!this.visible) return;
    this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-cls]').forEach((c) => {
      drawClassPortrait(c, c.dataset.cls as SoldierIdentity['classId'], c.classList.contains('slot-port') ? 0.3 : 0.55);
    });
  }

  /** Focus the rename field with the caret at the end (opens the phone keyboard). */
  private focusRename() {
    const i = this.root.querySelector<HTMLInputElement>('#rn-input');
    if (!i) return;
    i.focus({ preventScroll: true });
    try { i.setSelectionRange(i.value.length, i.value.length); } catch { /* some input types */ }
  }

  notice(text: string) {
    const n = this.root.querySelector<HTMLElement>('.m-notice');
    if (!n) return;
    n.textContent = text;
    n.classList.add('on');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => n.classList.remove('on'), 3500);
  }

  // ---------------- v0.6: career record ----------------
  /** Six lifetime stats, compact (soldier details). */
  private careerHtml(s: SoldierIdentity) {
    const c = s.service;
    const cells: [string, string, number][] = [['Missions completed', 'Missions', c.victories], ['Kills', 'Kills', c.kills], ['Times downed', 'Downed', c.downs], ['Revives performed', 'Revives', c.revives], ['Deaths', 'Deaths', c.deaths], ['Resurrections', 'Resurrected', s.resurrections]];
    return `<div class="d-career" title="Career record (lifetime)"><b>CAREER</b>${cells.map(([l, sh, v]) => `<span title="${l}"><i class="cl">${l}</i><i class="cs">${sh}</i> <em>${v}</em></span>`).join('')}</div>`;
  }

  /** Redraw whatever screen is open (after a transaction). */
  private rerender() {
    if (this.screen === 'decisions') this.renderDecisions();
    else if (this.screen === 'barracks') this.renderBarracks();
    else if (this.screen === 'campaign') this.renderCampaign();
    else if (this.screen === 'memorial') this.renderMemorial();
  }

  // ---------------- v0.6: casualty decisions + Operation Phoenix ----------------
  /**
   * The blocking post-mission flow. Shown on launch, after Results, and instead of any other
   * screen while a decision is pending. Nothing here is automatic: each fallen soldier needs an
   * explicit Resurrect or (confirmed) Memorial; Operation Phoenix needs three picks.
   */
  showDecisions(notice?: string) {
    const a = getAccount();
    if (!decisionBlock(a)) { this.decView = 'fallen'; this.showCampaign(notice); return; }
    if (this.screen !== 'decisions') { this.decView = 'fallen'; this.dismissId = null; this.phoenixPicks = []; }
    this.screen = 'decisions';
    this.detailsId = null; this.renameId = null; this.resetOpen = false;
    this.root.className = 'decisions';
    this.renderDecisions();
    if (notice) this.notice(notice);
  }

  private renderDecisions() {
    const a = getAccount();
    const d = pendingCasualties(a);
    if (!d && !a.phoenix.pending) { this.showCampaign(); return; }
    const head = (title: string, extra = '') => `
        <header class="m-head">
          <div class="m-title">${title}</div>${extra}
          <div class="m-spacer"></div>
          <div class="m-credits" title="Credits (account-wide)"><span>CREDITS</span> <b class="m-cr">${cr(a.credits)}</b></div>
          <button class="m-icon" data-a="settings" title="Settings (\`)">⚙</button>
          <div class="m-notice"></div>
        </header>`;
    let body = '';
    if (!d) body = head('OPERATION PHOENIX') + this.phoenixHtml();
    else {
      const s = this.game.roster.get(d.queue[0].id);
      if (!s) { body = head('FALLEN SOLDIERS') + '<div class="k-main"><div class="k-card">Missing soldier.</div></div>'; }
      else {
        const pos = casualtyPosition(d);
        const title = `FALLEN SOLDIER ${pos.index} OF ${pos.total}`;
        if (this.decView === 'roster') body = head('MANAGE ROSTER', `<span class="k-sub">${esc(title)}</span>`) + this.restrictedRosterHtml(s);
        else if (this.decView === 'confirm') body = head(title) + this.memorialConfirmHtml(s);
        else body = head(title) + this.fallenHtml(s, d.queue[0].cause);
      }
    }
    this.root.innerHTML = `<div class="m-wrap">${body}</div>${this.dismissId && this.game.roster.get(this.dismissId) ? this.dismissHtml(this.game.roster.get(this.dismissId)!) : ''}`;
    this.drawPortraits();
  }

  private fallenHtml(s: SoldierIdentity, cause: keyof typeof CAUSE_TEXT) {
    const a = getAccount(), cost = costFor(s), short = Math.max(0, cost - a.credits);
    const t = s.traitId ? TRAITS[s.traitId] : null;
    const prev = s.resurrections;
    return `
      <div class="k-main">
        <section class="k-card">
          <div class="k-who">
            <canvas class="d-port gray" data-cls="${s.classId}"></canvas>
            <div class="d-id">
              <div class="d-name">${esc(s.name)} <span class="s-lv">LV ${s.progression?.level ?? 1}</span> <span class="k-kia">KIA</span></div>
              <div class="d-cls">${CLASSES[s.classId].label}${t ? ` · ${t.name}` : ''}</div>
              <div class="k-cause">${CAUSE_TEXT[cause] ?? 'Fell in action'}</div>
            </div>
          </div>
          <div class="k-facts">
            <span><i>Resurrected before</i><b>${prev === 0 ? 'Never' : `${prev}×`}</b></span>
            <span><i>Resurrection cost</i><b>${cr(cost)} CR</b></span>
            <span><i>Your Credits</i><b>${cr(a.credits)} CR</b></span>
            <span class="${short ? 'short' : 'ok'}"><i>${short ? 'Shortfall' : 'Affordable'}</i><b>${short ? `${cr(short)} CR` : '✓'}</b></span>
          </div>
          <div class="k-note">Resurrection restores ${esc(s.name)} exactly as they were: level, XP, training and career record. ${short ? 'Not enough Credits: dismiss reserve soldiers in Manage Roster, or honor them in the Memorial.' : ''}</div>
        </section>
        <div class="k-btns">
          <button class="m-big" data-a="resurrect" data-id="${s.id}" ${short ? 'disabled' : ''} title="${short ? `Need ${cr(short)} more Credits` : `Resurrect for ${cr(cost)} CR`}">RESURRECT NOW · ${cr(cost)} CR</button>
          <button class="m-big alt" data-a="manage">MANAGE ROSTER</button>
          <button class="m-big danger" data-a="mem-open" data-id="${s.id}">HONOR IN MEMORIAL…</button>
        </div>
      </div>`;
  }

  /** The permanent-loss confirmation: its own screen, confirm button armed after MEMORIAL_ARM_MS. */
  private memorialConfirmHtml(s: SoldierIdentity) {
    const left = this.confirmAt + MEMORIAL_ARM_MS - performance.now();
    const armed = left <= 0;
    return `
      <div class="k-main">
        <section class="k-card k-confirm">
          <div class="x-title">HONOR ${esc(s.name.toUpperCase())} IN THE MEMORIAL?</div>
          <div class="k-who"><canvas class="d-port gray" data-cls="${s.classId}"></canvas>
            <div class="d-id"><div class="d-name">${esc(s.name)} <span class="s-lv">LV ${s.progression?.level ?? 1}</span></div><div class="d-cls">${CLASSES[s.classId].label} · ${s.service.kills} kills · resurrected ${s.resurrections}×</div></div></div>
          <div class="x-warn">⚠ This decision is permanent. This soldier cannot be resurrected later.</div>
          <div class="rn-help">${esc(s.name)} leaves the roster for good. Their final record is kept in the Memorial. No Credits are paid.</div>
        </section>
        <div class="k-btns">
          <button class="m-big alt" data-a="mem-back">◂ BACK</button>
          <button class="m-big danger" data-a="mem-confirm" data-id="${s.id}" ${armed ? '' : 'disabled'}>${armed ? 'CONFIRM — HONOR IN MEMORIAL' : `CONFIRM IN ${Math.ceil(left / 1000)}…`}</button>
        </div>
      </div>`;
  }

  /** Restricted Barracks: only dismissals (to raise Credits). No recruiting, training, renaming or deploying. */
  private restrictedRosterHtml(fallen: SoldierIdentity) {
    const a = getAccount(), r = this.game.roster, cost = costFor(fallen), short = Math.max(0, cost - a.credits);
    const rows = r.owned().map((s) => {
      const t = s.traitId ? TRAITS[s.traitId].name : '';
      if (s.status === 'kia') return `<div class="k-row fallen"><canvas class="slot-port gray" data-cls="${s.classId}"></canvas><span class="k-rid"><b>${esc(s.name)} <small>LV ${s.progression?.level ?? 1}</small></b><span>${CLASSES[s.classId].short} · ${t}</span></span><span class="k-tag">FALLEN</span></div>`;
      const block = dismissBlock(r, s.id);
      return `<div class="k-row"><canvas class="slot-port" data-cls="${s.classId}"></canvas><span class="k-rid"><b>${esc(s.name)} <small>LV ${s.progression?.level ?? 1}</small></b><span>${CLASSES[s.classId].short} · ${t}</span></span>
        <button class="pick out" data-a="dismiss" data-id="${s.id}" ${block ? 'disabled' : ''} title="${esc(block ?? 'Dismiss for good')}">${block ? 'KEEP' : `DISMISS · +${cr(dismissRefund(s))}`}</button></div>`;
    }).join('');
    const living = r.living().length;
    return `
      <div class="k-main k-roster">
        <div class="k-bar">
          <button class="m-nav back" data-a="manage-back">◂ BACK TO ${esc(fallen.name.toUpperCase())}</button>
          <span class="k-need">Resurrect ${esc(fallen.name)}: <b>${cr(cost)} CR</b> · ${short ? `<b class="warn">${cr(short)} CR short</b>` : '<b class="okc">affordable ✓</b>'}</span>
        </div>
        <div class="k-help">Dismiss reserve soldiers for their refund (Infantry 200 · Heavy Gunner 250 · Medic 250; training is not refunded). Dismissal is permanent. ${living <= 1 ? 'Your last living soldier can\'t be dismissed.' : ''}</div>
        <div class="k-list t-scroll">${rows}</div>
      </div>`;
  }

  private phoenixHtml() {
    const g = getAccount().phoenix.pending!;
    const picks = this.phoenixPicks.filter((id) => g.candidates.some((c) => c.id === id));
    const cards = g.candidates.map((c) => {
      const t = TRAITS[c.traitId], on = picks.includes(c.id), st = Menus.candidateStats(c);
      return `<button class="px-card ${on ? 'on' : ''}" data-a="px-pick" data-id="${c.id}" aria-pressed="${on}">
          <canvas class="slot-port" data-cls="infantry"></canvas>
          <span class="px-id"><b>${esc(c.name)}</b><span title="Infantry · level 1">LV 1 · HP ${num(Math.round(st.hp))}</span><span class="px-t">${t.name}</span></span>
          <span class="px-chk">${on ? '✓' : ''}</span>
        </button>`;
    }).join('');
    return `
      <div class="k-main px-main">
        <div class="px-text"><b>Your squad has fallen. Command has authorized three emergency recruits.</b><span>Rebuild. Regroup. Fight back.</span></div>
        <div class="px-grid">${cards}</div>
        <div class="k-btns px-btns">
          <span class="px-count">Selected <b>${picks.length} / ${PHOENIX_RECRUITS}</b> · free · level 1 Infantry · squad training applies · no dismissal refund</span>
          <button class="m-big" data-a="px-enlist" ${picks.length === PHOENIX_RECRUITS ? '' : 'disabled'}>ENLIST ${PHOENIX_RECRUITS} RECRUITS</button>
        </div>
      </div>`;
  }

  private doResurrect(id: string) {
    const g = this.game, name = g.roster.get(id)?.name ?? 'Soldier';
    const res = resurrect(g.roster, getAccount(), id, g.persist);
    this.decView = 'fallen';
    if (!decisionBlock(getAccount())) { this.showCampaign(res.ok ? `${name} is back on active duty (−${cr(res.cost)} CR).` : res.reason); return; }
    this.renderDecisions();
    this.notice(res.ok ? `${name} is back on active duty (−${cr(res.cost)} CR).${res.saved ? '' : ' · not saved (no storage)'}` : res.reason);
  }

  private doMemorial(id: string) {
    const g = this.game, name = g.roster.get(id)?.name ?? 'Soldier';
    if (performance.now() < this.confirmAt + MEMORIAL_ARM_MS) return; // not armed yet
    const res = memorialize(g.roster, getAccount(), id, g.persist);
    this.decView = 'fallen';
    if (res.ok) { g.forgetSoldier(id); this.newSoldiers.delete(id); if (this.trainId === id) this.trainId = g.roster.owned()[0]?.id ?? ''; }
    if (!decisionBlock(getAccount())) { this.showCampaign(res.ok ? `${name} was honored in the Memorial.` : res.reason); return; }
    this.renderDecisions();
    this.notice(res.ok ? `${name} was honored in the Memorial.` : res.reason);
  }

  private doEnlist() {
    const g = this.game;
    const res = enlistPhoenix(g.roster, getAccount(), this.phoenixPicks, g.persist, { cap: g.capacity });
    if (!res.ok) { this.renderDecisions(); this.notice(res.reason); return; }
    this.phoenixPicks = [];
    res.soldiers.forEach((x) => this.newSoldiers.add(x.id));
    this.tab = 'roster';
    this.showBarracks(`Operation Phoenix: ${res.soldiers.map((x) => x.name).join(', ')} joined. Earlier missions can be replayed from the Campaign screen.`);
  }

  // ---------------- v0.6: Memorial ----------------
  showMemorial(from: 'campaign' | 'barracks' = 'barracks') {
    if (decisionBlock(getAccount())) { this.showDecisions(); return; }
    this.memorialBack = from;
    this.screen = 'memorial';
    this.root.className = 'memorial';
    this.renderMemorial();
  }

  private renderMemorial() {
    const list = getAccount().memorial;
    const cards = list.map((m) => {
      const s = m.soldier;
      return `<div class="mm-card" data-id="${esc(s.id)}" title="${esc(CAUSE_TEXT[m.cause] ?? '')}">
          <canvas class="s-port gray" data-cls="${s.classId}"></canvas>
          <b class="mm-name">${esc(s.name)}</b>
          <span class="mm-lv">LV ${s.progression?.level ?? 1} · ${CLASSES[s.classId].short}</span>
          <span class="mm-st">${s.service.kills} kills · ${s.resurrections} res.</span>
        </div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="m-wrap">
        <header class="m-head">
          <button class="m-nav back" data-a="memorial-back">◂ ${this.memorialBack === 'campaign' ? 'CAMPAIGN' : 'BARRACKS'}</button>
          <div class="m-title">MEMORIAL</div>
          <div class="m-spacer"></div>
          <div class="m-notice"></div>
        </header>
        <div class="mm-main t-scroll">${list.length ? `<div class="mm-grid">${cards}</div>` : '<div class="mm-empty">No soldier has been lost for good. Keep it that way.</div>'}</div>
      </div>`;
    this.drawPortraits();
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
    else if (!rw || !won) rewards = `<div class="r-none">${won ? 'No rewards: this mission was not unlocked yet.' : 'No XP or Credits for a failed mission.'}</div><div class="r-total">Credits <b class="r-cr">${cr(getAccount().credits)}</b></div>`;
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
    // v0.6: fallen soldiers (permanent) and the pending decision
    const fallenRows = g.stats.rows(g.soldiers).filter((r) => r.status === 'KIA');
    const pending = g.deployment.kind === 'roster' && !!decisionBlock(getAccount());
    const fallenHtml = fallenRows.length ? `<div class="r-fallen"><b>FALLEN</b> ${fallenRows.map((r) => `<span>✝ ${esc(r.name)} <small>${CAUSE_TEXT[r.cause ?? 'bleedout']}</small></span>`).join('')}${g.deployment.kind === 'roster' ? '<em>Permanent: decide Resurrect or Memorial before the next mission.</em>' : ''}</div>` : '';
    this.root.innerHTML = `
      <div class="m-wrap r-wrap">
        <div class="r-card ${won ? 'won' : 'lost'}">
          <div class="r-mission">MISSION ${m.def.number} · ${esc(m.name.toUpperCase())}</div>
          <div class="r-title">${won ? 'MISSION COMPLETE' : 'MISSION FAILED'} ${tag}</div>
          <div class="r-stars">${stars(starN)}${newBest ? '<span class="r-tag first">NEW BEST</span>' : ''}<div class="r-crit">${crit}</div></div>
          <div class="r-sub">${why} · Mission time <b>${fmtTime(g.time)}</b></div>
          ${opts ? `<div class="r-opts"><b>OPTIONAL</b> ${opts}</div>` : ''}
          ${fallenHtml}
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
            ${pending ? `<button class="m-big danger" data-a="resolve">RESOLVE CASUALTIES ▸</button>` : `
            <button class="m-big ${won ? 'alt' : ''}" data-a="retry">RETRY</button>
            <button class="m-big ${won ? '' : 'alt'}" data-a="campaign">CAMPAIGN</button>
            <button class="m-big alt" data-a="barracks">BARRACKS</button>`}
          </div>
          <div class="r-note">${pending ? 'Fallen soldiers need a decision before anything else.' : 'Enter retry · C campaign · B barracks · KIA is permanent'}</div>
        </div>
      </div>`;
  }

  // ---------------- input ----------------
  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!el || !this.root.contains(el)) return;
    if (el instanceof HTMLButtonElement && el.disabled) return;
    if (performance.now() < this.txLockUntil) { e.stopPropagation(); return; } // double tap right after a recruit / refresh / dismissal
    unlockAudio();
    const a = el.dataset.a, id = el.dataset.id, g = this.game, r = g.roster;
    switch (a) {
      // ----- v0.6 decisions -----
      case 'resurrect': case 'mem-confirm': case 'px-enlist': {
        e.stopPropagation();
        const now = performance.now(), key = `${a}:${id ?? ''}`;
        if (key === this.lastBuy.key && now - this.lastBuy.t < DECISION_LOCK_MS) return;
        this.lastBuy = { key, t: now };
        if (a === 'mem-confirm' && now < this.confirmAt + MEMORIAL_ARM_MS) return;
        this.txLockUntil = now + DECISION_LOCK_MS;
        if (a === 'resurrect') this.doResurrect(id!); else if (a === 'mem-confirm') this.doMemorial(id!); else this.doEnlist();
        return;
      }
      case 'mem-open': {
        e.stopPropagation();
        this.decView = 'confirm'; this.confirmAt = performance.now();
        clearTimeout(this.confirmTimer);
        const tick = () => { if (this.screen === 'decisions' && this.decView === 'confirm') { this.renderDecisions(); if (performance.now() < this.confirmAt + MEMORIAL_ARM_MS) this.confirmTimer = window.setTimeout(tick, 250); } };
        this.confirmTimer = window.setTimeout(tick, 250);
        this.renderDecisions();
        return;
      }
      case 'mem-back': case 'manage-back': e.stopPropagation(); this.decView = 'fallen'; this.renderDecisions(); return;
      case 'manage': e.stopPropagation(); this.decView = 'roster'; this.renderDecisions(); return;
      case 'resolve': e.stopPropagation(); g.toCampaign(); return;
      case 'px-pick': {
        e.stopPropagation();
        const i = this.phoenixPicks.indexOf(id!);
        if (i >= 0) this.phoenixPicks.splice(i, 1);
        else if (this.phoenixPicks.length < PHOENIX_RECRUITS) this.phoenixPicks.push(id!);
        else { this.renderDecisions(); this.notice(`Choose exactly ${PHOENIX_RECRUITS}: tap a selected recruit to swap.`); return; }
        this.renderDecisions();
        return;
      }
      case 'memorial': e.stopPropagation(); this.showMemorial(el.dataset.from === 'campaign' ? 'campaign' : 'barracks'); return;
      case 'memorial-back': e.stopPropagation(); if (this.memorialBack === 'campaign') this.showCampaign(); else this.showBarracks(); return;
      case 'recruit': case 'refresh': case 'dismiss-confirm': {
        e.stopPropagation();
        const now = performance.now(), key = `${a}:${id ?? el.dataset.key ?? ''}`;
        if (key === this.lastBuy.key && now - this.lastBuy.t < PROGRESSION.purchaseLockMs) return;
        this.lastBuy = { key, t: now };
        if (a === 'refresh') { const wasArmed = now < this.refreshArmedUntil; this.doRefresh(el.dataset.key ?? ''); if (wasArmed) this.txLockUntil = performance.now() + RECRUIT_LOCK_MS; return; }
        this.txLockUntil = now + RECRUIT_LOCK_MS;
        if (a === 'recruit') this.doRecruit(id!); else this.doDismiss(id!);
        return;
      }
      case 'dismiss': this.dismissId = id!; if (this.screen === 'decisions') { e.stopPropagation(); this.renderDecisions(); return; } break;
      case 'dismiss-cancel': this.dismissId = null; if (this.screen === 'decisions') { e.stopPropagation(); this.renderDecisions(); return; } break;
      case 'dismiss-cancel-bg': if (e.target === el) this.dismissId = null; else return; if (this.screen === 'decisions') { e.stopPropagation(); this.renderDecisions(); return; } break;
      case 'rename': this.renameId = id!; this.renameDraft = r.get(id!)?.name ?? ''; this.renameError = ''; e.stopPropagation(); this.renderBarracks(); this.focusRename(); return;
      case 'rename-save': e.stopPropagation(); this.submitRename(); return;
      case 'rename-cancel': this.renameId = null; break;
      case 'rename-cancel-bg': if (e.target === el) this.renameId = null; else return; break;
      case 'settings': this.openSettings(); return;
      case 'deploy': this.deploy(); return;
      case 'retry': g.reset(); return;
      case 'barracks': g.toBarracks(); return;
      case 'campaign': g.toCampaign(); return;
      case 'to-barracks': this.showBarracks(); return;
      case 'to-campaign': this.showCampaign(); return;
      case 'reset-open': this.resetOpen = true; this.renderCampaign(); return;
      case 'reset-cancel': this.resetOpen = false; this.renderCampaign(); return;
      case 'reset-cancel-bg': if (e.target === el) { this.resetOpen = false; this.renderCampaign(); } return;
      case 'reset-confirm': {
        e.stopPropagation();
        if (!this.resetOpen) return;
        this.resetOpen = false;
        this.txLockUntil = performance.now() + RECRUIT_LOCK_MS; // a double tap can't hit the fresh screen
        this.newSoldiers.clear(); this.tab = 'roster'; this.detailsId = null; this.dismissId = null; this.renameId = null; this.targetSlot = null; this.trainId = 'ace';
        const ok = g.resetRosterSave?.('New campaign started: Ace and Ranger, Mission 1. Your previous save was backed up on this device.') ?? false;
        if (!ok) { this.renderCampaign(); this.notice('Could not back up the current save: nothing was wiped.'); }
        return;
      }
      case 'csel': {
        const m = campaignMission(id!);
        this.campaignSel = id!;
        if (m && this.missionState(m) !== 'locked' && m.playable) g.selectMission(id!);
        this.renderCampaign();
        return;
      }
      case 'trim': r.trimTo(g.capacity); break;
      case 'tab':
        this.tab = el.dataset.tab as BarracksTab; this.detailsId = null; this.targetSlot = null; this.refreshArmedUntil = 0;
        if (this.tab === 'recruit') openOffice(r, getAccount(), g.persist);
        break;
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
    if (this.screen === 'decisions') {
      // buttons only (no keyboard shortcut can resurrect or memorialize); Esc steps back
      if (e.code === 'Escape') {
        if (this.dismissId) this.dismissId = null; else this.decView = 'fallen';
        this.renderDecisions();
      }
      return;
    }
    if (this.screen === 'memorial') { if (e.code === 'Escape') { if (this.memorialBack === 'campaign') this.showCampaign(); else this.showBarracks(); } return; }
    if (this.screen === 'barracks') {
      if (e.code === 'Escape') {
        if (this.dismissId) this.dismissId = null;
        else if (this.renameId) this.renameId = null;
        else if (this.detailsId) this.detailsId = null;
        else if (this.targetSlot !== null) this.targetSlot = null;
        else { this.showCampaign(); return; }
        this.renderBarracks();
      } else if (this.dismissId || this.renameId) { /* dialogs: buttons only (no Enter shortcut for a dismissal) */ }
      else if (e.code === 'Enter' && !this.detailsId) { e.preventDefault(); this.deploy(); }
      else if (e.code === 'KeyC' && !this.detailsId) this.showCampaign();
    } else if (this.screen === 'campaign') {
      if (e.code === 'Enter' && !this.resetOpen) { e.preventDefault(); this.deploy(); }
      else if (this.resetOpen) { if (e.code === 'Escape') { this.resetOpen = false; this.renderCampaign(); } }
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
