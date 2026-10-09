// The Barracks roster: six fixed soldiers plus the 3-slot squad selection.
// Pure state + rules; persistence lives in save.ts, the UI in menus.ts.
import { CLASSES, effectiveStats, newProgression, type SoldierClassId, type SoldierIdentity } from './classes';
import { TRAITS, type TraitId } from './traits';

export const SQUAD_SLOTS = 3;

const def = (id: string, name: string, classId: SoldierClassId, traitId: TraitId): SoldierIdentity =>
  ({ id, name, classId, traitId, mods: {}, progression: newProgression() });

/** The v0.2.2 starting roster. Ids are stable: saves and mission stats refer to them. */
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
/** First launch: one of each class, so the loop works straight away. */
export const DEFAULT_SQUAD: (string | null)[] = ['ace', 'tank', 'doc'];

export type SelectResult = { ok: true; slot: number } | { ok: false; reason: string };

export class Roster {
  soldiers: SoldierIdentity[];
  /** Deployment slots in order; null = empty. Same soldier can never be in two slots. */
  slots: (string | null)[];
  /** Called after any selection change (save.ts hooks persistence here). */
  onChange: (() => void) | null = null;

  constructor(soldiers = defaultRoster(), slots: (string | null)[] = DEFAULT_SQUAD) {
    this.soldiers = soldiers;
    this.slots = Roster.normalizeSlots(slots, soldiers);
  }

  /** Keep known ids only, drop duplicates, exactly SQUAD_SLOTS entries. */
  static normalizeSlots(slots: unknown, soldiers: SoldierIdentity[]): (string | null)[] {
    const out: (string | null)[] = Array(SQUAD_SLOTS).fill(null);
    if (!Array.isArray(slots)) return out;
    const seen = new Set<string>();
    for (let i = 0; i < SQUAD_SLOTS; i++) {
      const id = slots[i];
      if (typeof id === 'string' && !seen.has(id) && soldiers.some((s) => s.id === id)) { out[i] = id; seen.add(id); }
    }
    return out;
  }

  get(id: string) { return this.soldiers.find((s) => s.id === id); }
  slotOf(id: string): number { return this.slots.indexOf(id); }
  isSelected(id: string) { return this.slotOf(id) >= 0; }
  /** Selected soldiers in deployment order (empty slots skipped). */
  squad(): SoldierIdentity[] { return this.slots.filter((x): x is string => !!x).map((id) => this.get(id)!); }
  canDeploy() { return this.squad().length >= 1; }

  /**
   * Put a soldier into a slot. Without a slot: the first empty one. With a slot: that slot,
   * replacing whoever is there (a soldier already in another slot moves, never duplicates).
   */
  select(id: string, slot?: number): SelectResult {
    if (!this.get(id)) return { ok: false, reason: 'unknown soldier' };
    let target = slot ?? this.slots.indexOf(null);
    if (slot === undefined && this.isSelected(id)) return { ok: true, slot: this.slotOf(id) };
    if (target < 0) return { ok: false, reason: 'Squad full: remove someone or tap a slot to replace' };
    if (target >= SQUAD_SLOTS) return { ok: false, reason: 'no such slot' };
    const prev = this.slotOf(id);
    if (prev >= 0) this.slots[prev] = null;
    this.slots[target] = id;
    this.onChange?.();
    return { ok: true, slot: target };
  }

  deselect(id: string) {
    const i = this.slotOf(id);
    if (i < 0) return false;
    this.slots[i] = null;
    this.onChange?.();
    return true;
  }

  clearSlot(slot: number) {
    if (!this.slots[slot]) return false;
    this.slots[slot] = null;
    this.onChange?.();
    return true;
  }

  /** Display helpers. */
  static describe(s: SoldierIdentity) {
    const t = s.traitId ? TRAITS[s.traitId] : null;
    return { classLabel: CLASSES[s.classId].label, trait: t, stats: effectiveStats(s) };
  }
}
