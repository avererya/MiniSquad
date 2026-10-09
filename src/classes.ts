// Soldier classes as data. Three layers:
//   1. SoldierClassDef  (this file): what a class IS. Base stats live in CFG[class id]
//      so the tuning panel edits them live; the def adds the weapon, ability and look.
//   2. SoldierIdentity  (this file): WHO a soldier is (id, name, class). Plain data that
//      can outlive a mission later (roster, progression); nothing is saved yet.
//   3. Unit             (unit.ts):   the runtime body in a mission (position, HP, state,
//      ability state, targeting, revive progress), created from an identity.
// Adding a class (Sniper, Commando...) = a CFG group + an entry in CLASSES + an ability
// factory. No class checks are scattered through gameplay code: it reads the def.
import { CFG, type SoldierStats } from './config';
import { FieldTreatmentAbility, GrenadeAbility, SuppressiveFireAbility, type Ability } from './abilities';

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

/** Live stats for a class (CFG group of the same name). */
export function classStats(id: SoldierClassId): SoldierStats { return CFG[id]; }

/** Persistent-ish soldier identity. HP/status/cooldown are runtime and read via snapshot(). */
export interface SoldierIdentity {
  id: string; // unique per created soldier: "S1", "S2", ...
  name: string;
  classId: SoldierClassId;
  /** Reserved for future progression (rank, XP, perks). Intentionally empty in v0.2.1. */
  progression: null;
}

let identitySeq = 0;
export function createIdentity(name: string, classId: SoldierClassId): SoldierIdentity {
  return { id: `S${++identitySeq}`, name, classId, progression: null };
}

// ---------------- squad presets (dev control) ----------------
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
