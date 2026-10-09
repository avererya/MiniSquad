// The Barracks roster: six fixed soldiers, which of them are unlocked (v0.4 campaign), and the
// squad selection (up to 6 slots; each mission allows its own number, see campaign.ts).
// Pure state + rules; persistence lives in save.ts, the UI in menus.ts.
//
// OVER-LIMIT RULE: the saved selection is never trimmed behind the player's back. If it holds
// more soldiers than the selected mission allows (e.g. a v0.3 squad of 3 for Mission 1, cap 2),
// the extra slots are shown as OVER LIMIT and Deploy is blocked until the player removes
// someone (or taps "Keep first N"). The selection is a packed, ordered list (deploy order).
import { CLASSES, effectiveStats, newProgression, newService, type SoldierClassId, type SoldierIdentity } from './classes';
import { newTraining } from './progression';
import { TRAITS, type TraitId } from './traits';
import { MAX_DEPLOY_ENGINE, SOLDIER_UNLOCK, STARTING_SOLDIERS } from './campaign';

/** Selection slots kept in the save (the engine maximum). */
export const SQUAD_SLOTS = MAX_DEPLOY_ENGINE;

const def = (id: string, name: string, classId: SoldierClassId, traitId: TraitId): SoldierIdentity =>
  ({ id, name, classId, traitId, mods: {}, progression: newProgression(), training: newTraining(), status: 'active', resurrections: 0, service: newService() });

/** The full roster (unchanged since v0.2.2). Ids are stable: saves and mission stats refer to them. */
export function defaultRoster(): SoldierIdentity[] {
  return [
    def('ace', 'Ace', 'infantry', 'sharpshooter'),
    def('ranger', 'Ranger', 'infantry', 'quickReflexes'),
    def('tank', 'Tank', 'heavy', 'tough'),
    def('havoc', 'Havoc', 'heavy', 'triggerHappy'),
    def('doc', 'Doc', 'medic', 'firstResponder'),
    def('patch', 'Patch', 'medic', 'healer'),
  ];
}
export const ALL_SOLDIER_IDS = defaultRoster().map((s) => s.id);
/** First launch (v0.4): the two starting soldiers. */
export const DEFAULT_SQUAD: (string | null)[] = ['ace', 'ranger'];
/** v0.2.2 / v0.3 default selection (legacy saves that lost their squad field). */
export const LEGACY_DEFAULT_SQUAD: (string | null)[] = ['ace', 'tank', 'doc'];

export type SelectResult = { ok: true; slot: number } | { ok: false; reason: string };

export class Roster {
  soldiers: SoldierIdentity[];
  /** Deployment slots in order; null = empty. Same soldier can never be in two slots. */
  slots: (string | null)[];
  /** Soldiers the player owns (campaign unlocks). Locked soldiers can't be selected or deployed. */
  unlocked: Set<string>;
  /** Called after any selection change (save.ts hooks persistence here). */
  onChange: (() => void) | null = null;

  constructor(soldiers = defaultRoster(), slots: (string | null)[] = DEFAULT_SQUAD, unlocked: Iterable<string> = STARTING_SOLDIERS) {
    this.soldiers = soldiers;
    this.unlocked = new Set([...unlocked].filter((id) => soldiers.some((s) => s.id === id)));
    this.slots = Roster.pack(Roster.normalizeSlots(slots, soldiers, this.unlocked));
  }

  /** Keep known, unlocked ids only, drop duplicates, exactly SQUAD_SLOTS entries. */
  static normalizeSlots(slots: unknown, soldiers: SoldierIdentity[], unlocked?: Set<string>): (string | null)[] {
    const out: (string | null)[] = Array(SQUAD_SLOTS).fill(null);
    if (!Array.isArray(slots)) return out;
    const seen = new Set<string>();
    for (let i = 0; i < SQUAD_SLOTS; i++) {
      const id = slots[i];
      if (typeof id === 'string' && !seen.has(id) && soldiers.some((s) => s.id === id) && (!unlocked || unlocked.has(id))) { out[i] = id; seen.add(id); }
    }
    return out;
  }

  get(id: string) { return this.soldiers.find((s) => s.id === id); }
  isUnlocked(id: string) { return this.unlocked.has(id); }
  unlockText(id: string) { return SOLDIER_UNLOCK[id]?.text ?? 'Locked'; }
  /** Unlock a soldier; true if it was locked before. */
  unlock(id: string): boolean {
    if (!this.get(id) || this.unlocked.has(id)) return false;
    this.unlocked.add(id);
    return true;
  }
  slotOf(id: string): number { return this.slots.indexOf(id); }
  isSelected(id: string) { return this.slotOf(id) >= 0; }
  /** Selected soldiers in deployment order (empty slots skipped). */
  squad(): SoldierIdentity[] { return this.slots.filter((x): x is string => !!x).map((id) => this.get(id)!); }
  count() { return this.slots.filter(Boolean).length; }
  /** Why this selection can't deploy into a mission allowing `limit` soldiers (null = OK). */
  deployBlock(limit = SQUAD_SLOTS): string | null {
    const n = this.count();
    if (n < 1) return 'Select at least one soldier to deploy.';
    if (n > limit) return `Too many soldiers: this mission allows ${limit}. Remove ${n - limit}.`;
    const locked = this.squad().find((s) => !this.isUnlocked(s.id));
    if (locked) return `${locked.name} is locked.`;
    return null;
  }
  canDeploy(limit = SQUAD_SLOTS) { return this.deployBlock(limit) === null; }

  /**
   * Put a soldier into a slot. Without a slot: the first empty one within `limit` (the
   * mission's capacity). With a slot: that slot, replacing whoever is there (a soldier already
   * in another slot moves, never duplicates).
   */
  select(id: string, slot?: number, limit = SQUAD_SLOTS): SelectResult {
    if (!this.get(id)) return { ok: false, reason: 'unknown soldier' };
    if (!this.isUnlocked(id)) return { ok: false, reason: `${this.get(id)!.name} is locked: ${this.unlockText(id)}` };
    if (slot === undefined && this.isSelected(id)) return { ok: true, slot: this.slotOf(id) };
    let target = slot ?? -1;
    if (slot === undefined) {
      if (this.count() >= limit) return { ok: false, reason: `Squad full (this mission allows ${limit}): remove someone or tap a slot to replace` };
      target = this.slots.indexOf(null);
    }
    if (target < 0) return { ok: false, reason: 'Squad full: remove someone or tap a slot to replace' };
    if (target >= SQUAD_SLOTS) return { ok: false, reason: 'no such slot' };
    const prev = this.slotOf(id);
    if (prev >= 0) this.slots[prev] = null;
    this.slots[target] = id;
    this.compact();
    this.onChange?.();
    return { ok: true, slot: this.slotOf(id) };
  }

  deselect(id: string) {
    const i = this.slotOf(id);
    if (i < 0) return false;
    this.slots[i] = null;
    this.compact();
    this.onChange?.();
    return true;
  }

  clearSlot(slot: number) {
    if (!this.slots[slot]) return false;
    this.slots[slot] = null;
    this.compact();
    this.onChange?.();
    return true;
  }

  /** "Keep first N": drop selected soldiers beyond `n` (explicit player action only). */
  trimTo(n: number) {
    let kept = 0, changed = false;
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) continue;
      if (kept < n) kept++; else { this.slots[i] = null; changed = true; }
    }
    this.compact();
    if (changed) this.onChange?.();
    return changed;
  }

  /** Selection is a packed list: soldiers in deploy order first, empty slots after (v0.4). */
  private compact() { this.slots = Roster.pack(this.slots); }
  static pack(slots: (string | null)[]): (string | null)[] {
    const ids = slots.filter((x): x is string => !!x);
    return [...ids, ...Array(SQUAD_SLOTS - ids.length).fill(null)].slice(0, SQUAD_SLOTS);
  }

  /** Display helpers. */
  static describe(s: SoldierIdentity) {
    const t = s.traitId ? TRAITS[s.traitId] : null;
    return { classLabel: CLASSES[s.classId].label, trait: t, stats: effectiveStats(s) };
  }
}
