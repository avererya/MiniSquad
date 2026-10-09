// Soldier classes as data. Layers:
//   1. SoldierClassDef  (this file): what a class IS. Base stats live in CFG[class id]
//      so the tuning panel edits them live; the def adds the weapon, ability and look.
//   2. Progression      (progression.ts): level growth + training (additive % of class base).
//      Traits           (traits.ts): natural trait modifiers, applied on top of that.
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
import { NO_PROGRESSION, PROGRESSION, clean, getAccount, grownStats, newTraining, type ProgressionInputs, type TrainingRanks } from './progression';

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

/**
 * Per-soldier progression. XP is the TOTAL earned (capped at the level-cap threshold);
 * `level` is derived from it (stored for convenience, re-validated on load).
 * Future fields (data model only, unused in v0.3): tier 'elite' + elitePath + eliteLevel for
 * Elite Promotion at the level cap (keeps trait, training, identity and service record).
 */
export interface ProgressionRecord {
  level: number; // 1..25
  xp: number; // total XP, 0..xpForLevel(25)
  upgrades: string[]; // legacy v0.2.2 field, unused (training ranks live in SoldierIdentity.training)
  specialization: string | null; // none
  tier: 'recruit' | 'elite'; // always 'recruit' in v0.3
  elitePath: string | null; // future: one of two elite paths per class
  eliteLevel: number; // future: Elite L1..30 (0 = not elite)
}
export const newProgression = (): ProgressionRecord => ({ level: 1, xp: 0, upgrades: [], specialization: null, tier: 'recruit', elitePath: null, eliteLevel: 0 });

/** Lifetime service record (roster deployments only). */
export interface ServiceRecord { missions: number; victories: number; kills: number }
export const newService = (): ServiceRecord => ({ missions: 0, victories: 0, kills: 0 });

/** Who a soldier is. HP/status/cooldown are runtime and read via Unit.snapshot(). */
export interface SoldierIdentity {
  id: string; // stable: roster ids ("ace"), dev generics "G1", "G2", ...
  name: string;
  classId: SoldierClassId;
  /** Natural trait (exactly one for roster soldiers; null for anonymous dev generics). */
  traitId: TraitId | null;
  /** Legacy individual stat MULTIPLIERS (applied with the trait). Empty; kept for dev/tests. */
  mods: StatModifiers;
  /** Individual progression record (null for anonymous dev generics). */
  progression: ProgressionRecord | null;
  /** Individual training ranks (v0.3), bought with Credits. All 0 for generics. */
  training: TrainingRanks;
  /** Future: permanent KIA / resurrection. Always 'active' in v0.3 (KIA lasts one mission). */
  status: 'active' | 'kia';
  /** Future: resurrections bought so far (escalating cost). Always 0 in v0.3. */
  resurrections: number;
  service: ServiceRecord;
}

/** Progression inputs for the stat pipeline. Generics (no progression) get class base only. */
export function progressionInputs(id: Pick<SoldierIdentity, 'progression' | 'training'>): ProgressionInputs {
  if (!id.progression) return NO_PROGRESSION;
  return { level: id.progression.level, training: id.training, squad: getAccount().squadTraining };
}

/**
 * Effective stats, computed fresh (see the pipeline in progression.ts):
 * class base -> + level growth + individual training + squad training (additive % of base)
 * -> x trait (and legacy mods) -> spread floor. Nothing is mutated.
 */
export function effectiveStats(id: Pick<SoldierIdentity, 'classId' | 'traitId' | 'mods' | 'progression' | 'training'>, inputs?: ProgressionInputs): EffectiveStats {
  const base = classStats(id.classId);
  const trait = id.traitId ? TRAITS[id.traitId].mods : null;
  const m = combineModifiers(trait, id.mods);
  const out = applyModifiers(grownStats(base, inputs ?? progressionInputs(id)), m);
  // spread floor: upgrades can't push the standing cone below the floor (nor below what the
  // class + trait alone give, if a tuned base is already under the floor)
  const floor = Math.min(PROGRESSION.spreadFloorDeg, clean(base.accuracy * m.spreadMul));
  if (out.accuracy < floor) {
    const k = base.accuracy > 0 ? floor / out.accuracy : 1;
    out.accuracy = floor;
    out.movePenalty = clean(out.movePenalty * (Number.isFinite(k) ? k : 1));
  }
  return out;
}

/** Deep copy, so a mission's units never share objects with the saved roster. */
export function cloneIdentity(i: SoldierIdentity): SoldierIdentity {
  return {
    ...i, mods: { ...i.mods }, training: { ...i.training }, service: { ...i.service },
    progression: i.progression ? { ...i.progression, upgrades: [...i.progression.upgrades] } : null,
  };
}

let genericSeq = 0;
/** Anonymous dev soldier (presets, debug spawns): class base stats only, never saved. */
export function createGeneric(name: string, classId: SoldierClassId): SoldierIdentity {
  return { id: `G${++genericSeq}`, name, classId, traitId: null, mods: {}, progression: null, training: newTraining(), status: 'active', resurrections: 0, service: newService() };
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
  // v0.4 squad-scaling checks (engine supports 6; the campaign allows up to 4 so far)
  { id: 'ihmi', label: '4: Inf + Heavy + Medic + Inf', classes: ['infantry', 'heavy', 'medic', 'infantry'] },
  { id: 'ihmih', label: '5: Inf + Heavy + Medic + Inf + Heavy', classes: ['infantry', 'heavy', 'medic', 'infantry', 'heavy'] },
  { id: 'ihmihm', label: '6: two of each class', classes: ['infantry', 'heavy', 'medic', 'infantry', 'heavy', 'medic'] },
  { id: 'iiiiii', label: '6 Infantry', classes: ['infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry'] },
  { id: 'mmmm', label: '4 Medic', classes: ['medic', 'medic', 'medic', 'medic'] },
];

export function findPreset(id: string | null | undefined): SquadPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
