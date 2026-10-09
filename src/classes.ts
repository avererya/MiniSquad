// Soldier classes as data. Layers:
//   1. SoldierClassDef  (this file): what a class IS. Base stats live in CFG[class id]
//      so the tuning panel edits them live; the def adds the weapon, ability and look.
//   2. Traits           (traits.ts): natural trait modifiers, applied on top of the class.
//   3. SoldierIdentity  (this file): WHO a soldier is (id, name, class, trait, individual
//      modifiers, progression). Roster soldiers persist (roster.ts / save.ts); anonymous
//      dev generics (presets, debug spawns) have no trait and no progression.
//   4. Unit             (unit.ts):   the runtime body in a mission (position, HP, state,
//      ability state, targeting, revive progress), created from a COPY of an identity.
// Adding a class (Sniper, Commando...) = a CFG group + an entry in CLASSES + an ability
// factory. No class checks are scattered through gameplay code: it reads the def.
import { CFG, type SoldierStats } from './config';
import { FieldTreatmentAbility, GrenadeAbility, SuppressiveFireAbility, type Ability } from './abilities';
import { TRAITS, applyModifiers, combineModifiers, type EffectiveStats, type StatModifiers, type TraitId } from './traits';

export type SoldierClassId = 'infantry' | 'heavy' | 'medic';
export type AbilityId = 'grenade' | 'suppressive' | 'fieldTreatment';
export type WeaponKind = 'rifle' | 'mg' | 'smg';

export interface ClassVisual {
  bodyW: number; // torso width (Infantry 14)
  weapon: WeaponKind;
  pack: 'none' | 'ammo' | 'medical';
  helmet: 'standard' | 'heavy' | 'medic';
  tracerWidth: number; // bullet streak width
  tracerLen: number;
}

export interface SoldierClassDef {
  id: SoldierClassId;
  label: string; // "Heavy Gunner"
  short: string; // "HVY"
  abilityId: AbilityId;
  visual: ClassVisual;
}

export const ABILITY_FACTORIES: Record<AbilityId, () => Ability> = {
  grenade: () => new GrenadeAbility(),
  suppressive: () => new SuppressiveFireAbility(),
  fieldTreatment: () => new FieldTreatmentAbility(),
};

export const ABILITY_NAMES: Record<AbilityId, string> = { grenade: 'Grenade', suppressive: 'Suppressive Fire', fieldTreatment: 'Field Treatment' };

export const CLASSES: Record<SoldierClassId, SoldierClassDef> = {
  infantry: {
    id: 'infantry', label: 'Infantry', short: 'INF', abilityId: 'grenade',
    visual: { bodyW: 14, weapon: 'rifle', pack: 'none', helmet: 'standard', tracerWidth: 3.5, tracerLen: 20 },
  },
  heavy: {
    id: 'heavy', label: 'Heavy Gunner', short: 'HVY', abilityId: 'suppressive',
    visual: { bodyW: 19, weapon: 'mg', pack: 'ammo', helmet: 'heavy', tracerWidth: 3, tracerLen: 16 },
  },
  medic: {
    id: 'medic', label: 'Medic', short: 'MED', abilityId: 'fieldTreatment',
    visual: { bodyW: 13, weapon: 'smg', pack: 'medical', helmet: 'medic', tracerWidth: 3, tracerLen: 16 },
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as SoldierClassId[];

/** Live class BASE stats (CFG group of the same name; shared by every soldier of the class). */
export function classStats(id: SoldierClassId): SoldierStats { return CFG[id]; }

/** Per-soldier progression. v0.2.2 only stores the starting values; nothing earns or spends them yet. */
export interface ProgressionRecord {
  level: number; // 1
  xp: number; // 0
  upgrades: string[]; // none
  specialization: string | null; // none
}
export const newProgression = (): ProgressionRecord => ({ level: 1, xp: 0, upgrades: [], specialization: null });

/** Who a soldier is. HP/status/cooldown are runtime and read via Unit.snapshot(). */
export interface SoldierIdentity {
  id: string; // stable: roster ids ("ace"), dev generics "G1", "G2", ...
  name: string;
  classId: SoldierClassId;
  /** Natural trait (exactly one for roster soldiers; null for anonymous dev generics). */
  traitId: TraitId | null;
  /** Individual stat modifiers (future upgrades write here, per soldier). Empty in v0.2.2. */
  mods: StatModifiers;
  /** Individual progression record (null for anonymous dev generics). */
  progression: ProgressionRecord | null;
}

/** Effective stats: class base -> trait -> individual modifiers. Computed fresh; nothing is mutated. */
export function effectiveStats(id: Pick<SoldierIdentity, 'classId' | 'traitId' | 'mods'>): EffectiveStats {
  const trait = id.traitId ? TRAITS[id.traitId].mods : null;
  return applyModifiers(classStats(id.classId), combineModifiers(trait, id.mods));
}

/** Deep copy, so a mission's units never share objects with the saved roster. */
export function cloneIdentity(i: SoldierIdentity): SoldierIdentity {
  return { ...i, mods: { ...i.mods }, progression: i.progression ? { ...i.progression, upgrades: [...i.progression.upgrades] } : null };
}

let genericSeq = 0;
/** Anonymous dev soldier (presets, debug spawns): class base stats only, never saved. */
export function createGeneric(name: string, classId: SoldierClassId): SoldierIdentity {
  return { id: `G${++genericSeq}`, name, classId, traitId: null, mods: {}, progression: null };
}

// ---------------- squad presets (dev control) ----------------
// Presets deploy ANONYMOUS generics (no trait) so class balance can be tested in isolation.
// They never touch the saved roster or the saved squad selection.
export interface SquadPreset { id: string; label: string; classes: SoldierClassId[] }

export const PRESETS: SquadPreset[] = [
  { id: 'ii', label: '2 Infantry', classes: ['infantry', 'infantry'] },
  { id: 'ih', label: 'Infantry + Heavy', classes: ['infantry', 'heavy'] },
  { id: 'im', label: 'Infantry + Medic', classes: ['infantry', 'medic'] },
  { id: 'ihm', label: 'Infantry + Heavy + Medic', classes: ['infantry', 'heavy', 'medic'] },
  { id: 'hh', label: '2 Heavy', classes: ['heavy', 'heavy'] },
  { id: 'mm', label: '2 Medic', classes: ['medic', 'medic'] },
  // legacy squad-size options from v0.1
  { id: 'i', label: '1 Infantry', classes: ['infantry'] },
  { id: 'iii', label: '3 Infantry', classes: ['infantry', 'infantry', 'infantry'] },
];

export function findPreset(id: string | null | undefined): SquadPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
