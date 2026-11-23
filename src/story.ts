// v0.8C.1 STORY: a small, data-driven dialogue system for chapter finales and the occasional story beat.
//
// Two presentations, one data format (StoryScene):
//  - 'cinematic': blocking comic-style panels. While one is open Game.modal is 'story', so the simulation is
//    suspended exactly like the Mission 14 gunner prompt (nothing moves, fires, bleeds out or takes damage; the
//    mission timer stops). Tap / click / Enter / Space advances, SKIP / Esc closes it, and each panel advances on
//    its own after a reading interval (readTime) in SIMULATION time, so 30 and 60 FPS behave identically.
//  - 'radio': short non-blocking lines (boss phase taunts) in a small strip clear of the boss bar, the banners
//    and the controls. Combat keeps running. Lines queue and play one after the other, never overlapping.
//
// Missions opt in with MissionScript.story ({ cue: scene id }) and fire a cue through Mission.cue, which plays each
// cue at most once per attempt (Mission is rebuilt on every deploy / Retry, so a restart or reload replays them).
// No save fields: nothing here is persisted.
//
// ARTWORK: every line can name a portrait (`StoryLine.portrait`, falling back to the speaker's). It is an image URL
// relative to the site root (e.g. 'story/voss-1.webp' for public/story/voss-1.webp). Without one, or if it fails to
// load, the panel uses the text-only layout. Adding comic art later = drop the files in public/story/ and set the
// fields below; the director and the view need no changes.
//
// NARRATIVE RULE: scripted lines never name a recruit (soldiers can die, be dismissed or replaced). Address the
// player's soldiers collectively ("Squad", "your unit").
import type { Game } from './game';

export type StoryTone = 'command' | 'enemy';
export interface StorySpeaker {
  /** Bold label on the panel. */
  name: string;
  /** Small line under the name (channel / role). */
  role: string;
  tone: StoryTone;
  /** Optional default portrait (see ARTWORK above). */
  portrait?: string;
}

export const SPEAKERS = {
  overwatch: { name: 'OVERWATCH', role: 'COMMAND · SECURE CHANNEL', tone: 'command' },
  voss: { name: 'GENERAL VOSS', role: 'ENEMY COMMANDER · INTERCEPTED', tone: 'enemy' },
  // v0.9C Mission 19: a freed specialist on the squad's channel, and the prison camp's intercepted radio
  specialist: { name: 'RESCUED SPECIALIST', role: 'FRIENDLY · ON YOUR CHANNEL', tone: 'command' },
  camp: { name: 'CAMP COMMAND', role: 'ENEMY RADIO · INTERCEPTED', tone: 'enemy' },
  // v0.9D Mission 20: the Warlord on his own radio, and the extraction pilots
  warlord: { name: 'THE WARLORD', role: 'ENEMY COMMANDER · INTERCEPTED', tone: 'enemy' },
  pilot: { name: 'PILOT', role: 'EXTRACTION FLIGHT', tone: 'command' },
} satisfies Record<string, StorySpeaker>;
export type SpeakerId = keyof typeof SPEAKERS;

export interface StoryLine {
  speaker: SpeakerId;
  text: string;
  /** Optional artwork for this panel (overrides the speaker's). */
  portrait?: string;
  /** Seconds before auto-advance (default: readTime(text)). */
  hold?: number;
}
export interface StoryScene {
  id: string;
  mode: 'cinematic' | 'radio';
  lines: StoryLine[];
}

/** Mission hooks that can play a scene (MissionScript.story maps them to scene ids). */
export type StoryCue = 'bossIntro' | 'bossPhase2' | 'bossPhase3' | 'victory'
  /** v0.9A: a mine field's first warning (MineFieldSpec.warnCue) / a primary objective with this id starts (Mission.activateCurrent). */
  | 'minesAhead' | `start:${string}`
  /** v0.9B: a named mission moment (a fuel depot's first warning, an ambush springing, a rooftop sighting). */
  | `cue:${string}`;

/** Comfortable reading time for a cinematic panel: 1.5 s + 0.17 s per word, 2.8-5 s. */
export function readTime(text: string) {
  const words = text.trim().split(/\s+/).length;
  return Math.min(5, Math.max(2.8, 1.5 + 0.17 * words));
}
/** A radio line stays up 3-4 s. */
export function radioTime(text: string) {
  const words = text.trim().split(/\s+/).length;
  return Math.min(4, Math.max(3, 1.6 + 0.3 * words));
}
/**
 * Taps / keys within this long (real seconds) of a panel appearing are ignored, so a tap meant for the game as the
 * cinematic opens (or a double tap) does not skip a line. Input only: the simulation never reads it.
 */
export const TAP_GUARD = 0.25;
const realNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

const O = 'overwatch', V = 'voss';
export const SCENES: Record<string, StoryScene> = {
  // Mission 15 General's Last Stand (Chapter 3 finale)
  'm15-intro': {
    id: 'm15-intro', mode: 'cinematic', lines: [
      { speaker: O, text: 'Squad, you’ve reached the command bunker. General Voss is inside. Finish this.' },
      { speaker: V, text: 'You’ve destroyed my supply lines, my defenses… but you won’t leave this fortress alive.' },
      { speaker: O, text: 'He’s all yours, Squad. Make it count.' },
    ],
  },
  'm15-phase2': { id: 'm15-phase2', mode: 'radio', lines: [{ speaker: V, text: 'Reinforcements! Defend your general!' }] },
  'm15-phase3': { id: 'm15-phase3', mode: 'radio', lines: [{ speaker: V, text: 'I will not surrender this fortress!' }] },
  'm15-victory': {
    id: 'm15-victory', mode: 'cinematic', lines: [
      { speaker: O, text: 'Voss is down. Fortress secured. Outstanding work, Squad.' },
      { speaker: O, text: 'We’ve recovered his communications. Turns out the General was taking orders from someone else.' },
      { speaker: O, text: 'Get to extraction. We’re going behind enemy lines.' },
    ],
  },
  // v0.9A Mission 16 Jungle Sweep (Chapter 4 opener): radio only, nothing blocks the fight
  'm16-mines': {
    id: 'm16-mines', mode: 'radio', lines: [
      { speaker: O, text: 'Squad, recon reports mines on these trails. Watch your step.' },
      { speaker: O, text: 'Spotted mines can be shot from range. Stay clear of the blast.' },
    ],
  },
  'm16-checkpoint': {
    id: 'm16-checkpoint', mode: 'radio', lines: [
      { speaker: O, text: 'That checkpoint guards the road north. Expect mines on the west road.' },
      { speaker: O, text: 'The south path looks clean. Your call, Squad.' },
    ],
  },
  'm16-extract': { id: 'm16-extract', mode: 'radio', lines: [{ speaker: O, text: 'Checkpoint is ours. Helicopter inbound, north-east clearing.' }] },
  // v0.9B Mission 17: Fuel for the Fire
  'm17-fuel': {
    id: 'm17-fuel', mode: 'radio', lines: [
      { speaker: O, text: 'Squad, those red tanks are full of fuel. One good burst and they go up.' },
      { speaker: O, text: 'Tap one and your squad will shoot it. Catch the guards beside it, and keep your own people clear.' },
    ],
  },
  'm17-depot': {
    id: 'm17-depot', mode: 'radio', lines: [
      { speaker: O, text: 'Three installations: open storage here, a fortified depot to the north, the main reserve to the east.' },
      { speaker: O, text: 'Burn them all. Tanks packed close together will set each other off.' },
    ],
  },
  'm17-response': {
    id: 'm17-response', mode: 'radio', lines: [
      { speaker: O, text: 'That got their attention. Enemy response inbound from the jungle edges.' },
      { speaker: O, text: 'They are sending everything they have left. Hold together and finish them.' },
    ],
  },
  'm17-counter': {
    id: 'm17-counter', mode: 'radio', lines: [
      { speaker: O, text: 'They are pulling troops back to the last installation. Expect a counterattack.' },
      { speaker: O, text: 'If they bunch up around the tanks, you know what to do.' },
    ],
  },
  'm17-extract': { id: 'm17-extract', mode: 'radio', lines: [{ speaker: O, text: 'The depot is burning. Helicopter inbound, north-east clearing. They will try to stop you: hold the clearing.' }] },
  // v0.9B Mission 18: Ambush Alley
  'm18-quiet': {
    id: 'm18-quiet', mode: 'radio', lines: [
      { speaker: O, text: 'Main Street is empty. No traffic, no civilians, nobody at the windows.' },
      { speaker: O, text: 'That is never a good sign. Keep your spacing and watch the side alleys.' },
    ],
  },
  'm18-first': { id: 'm18-first', mode: 'radio', lines: [{ speaker: O, text: 'Contact! They were waiting in the alley. Get behind the cars!' }] },
  'm18-crossfire': {
    id: 'm18-crossfire', mode: 'radio', lines: [
      { speaker: O, text: 'Movement on the cross street, north and south. You are walking into a crossfire.' },
      { speaker: O, text: 'Take cover and deal with one side at a time.' },
    ],
  },
  'm18-rooftops': {
    id: 'm18-rooftops', mode: 'radio', lines: [
      { speaker: O, text: 'Snipers on the rooftops above Main Street. They stay hidden until they have a shot.' },
      { speaker: O, text: 'A red laser gives one away: shoot back or get that soldier behind cover.' },
    ],
  },
  'm18-rear': { id: 'm18-rear', mode: 'radio', lines: [{ speaker: O, text: 'Behind you! A squad has circled round through the back streets.' }] },
  'm18-courtyard': {
    id: 'm18-courtyard', mode: 'radio', lines: [
      { speaker: O, text: 'The courtyard is their strongpoint. Gates north and south, and an alley from the west.' },
      { speaker: O, text: 'Pick your way in. Do not all push through the same gate.' },
    ],
  },
  'm18-final': {
    id: 'm18-final', mode: 'radio', lines: [
      { speaker: O, text: 'Last intersection before the landing zone. They are dug in behind the sandbags.' },
      { speaker: O, text: 'Break them and the plaza is yours. Expect company.' },
    ],
  },
  'm18-extract': { id: 'm18-extract', mode: 'radio', lines: [{ speaker: O, text: 'The street is ours. Helicopter inbound to the plaza. Every patrol in the district heard that: hold until it lands.' }] },
  // v0.9C Mission 19 "Prison Break" (radio only: the fights are never interrupted). Rescue lines go by COUNT, never by
  // cell, so any order reads right.
  'm19-intro': {
    id: 'm19-intro', mode: 'radio', lines: [
      { speaker: O, text: 'Intel confirms it: three of our best are locked up in that camp. A rocket gunner, a flamethrower and a shadow operative.' },
      { speaker: O, text: 'Get inside, open those cells and they will fight beside you. Watch the towers at the gate.' },
    ],
  },
  'm19-rescue1': { id: 'm19-rescue1', mode: 'radio', lines: [{ speaker: 'specialist', text: 'About time! They still have two more of us in here. Nobody leaves without them.' }] },
  'm19-rescue2': {
    id: 'm19-rescue2', mode: 'radio', lines: [
      { speaker: 'camp', text: 'Cells are open! Breakout in progress! Every guard to the yard!' },
      { speaker: O, text: 'They know you are there. More of them coming out of the barracks.' },
    ],
  },
  'm19-rescue3': { id: 'm19-rescue3', mode: 'radio', lines: [{ speaker: 'camp', text: 'Lock down the camp! Nobody leaves this jungle!' }] },
  'm19-extract': { id: 'm19-extract', mode: 'radio', lines: [{ speaker: O, text: 'All three are out! The helicopter is heading for the clearing east of the camp. Move!' }] },
  'm19-assault': {
    id: 'm19-assault', mode: 'radio', lines: [
      { speaker: O, text: 'Squad, I count dozens of hostiles closing on that clearing from every direction. This is the whole garrison.' },
      { speaker: O, text: 'Thirty seconds to the helicopter. Hold the zone!' },
    ],
  },
  'm19-intel': { id: 'm19-intel', mode: 'radio', lines: [{ speaker: 'specialist', text: "I grabbed their maps on the way out. These orders come straight from the Warlord's headquarters, and now we know where it is." }] },
  // v0.9D Mission 20 "The Warlord" (Chapter 4 finale). Radio for the fights; two short cinematics: the Warlord's
  // entrance and the MAYDAY after Alpha is lost (the mission state is already applied when it opens, so SKIP is safe).
  // Installation lines are written so either order reads right.
  'm20-intro': {
    id: 'm20-intro', mode: 'radio', lines: [
      { speaker: O, text: 'That is the Warlord\'s headquarters. Main gate, jungle flank or supply route: all three lead inside.' },
      { speaker: O, text: 'Knock out his Communications Array and his Vehicle Depot and he has no way out.' },
    ],
  },
  'm20-mines': { id: 'm20-mines', mode: 'radio', lines: [{ speaker: O, text: 'This jungle trail is mined, Squad. Spotted mines can be shot from range.' }] },
  'm20-fuel': { id: 'm20-fuel', mode: 'radio', lines: [{ speaker: O, text: 'Fuel tanks in the supply yard. Catch his guards standing beside them.' }] },
  'm20-comms': { id: 'm20-comms', mode: 'radio', lines: [{ speaker: O, text: 'Array down. He cannot call in his evacuation now.' }] },
  'm20-depot': { id: 'm20-depot', mode: 'radio', lines: [{ speaker: O, text: 'Depot destroyed. His escape convoy is not going anywhere.' }] },
  'm20-boss': {
    id: 'm20-boss', mode: 'cinematic', lines: [
      { speaker: O, text: 'Both installations are down. The command area is open. He is trapped in there.' },
      { speaker: 'warlord', text: 'You burned my convoy and silenced my radios. Now this jungle will be your grave.' },
      { speaker: O, text: 'He has mortars, Squad. When you see red on the ground, move.' },
    ],
  },
  'm20-phase2': { id: 'm20-phase2', mode: 'radio', lines: [{ speaker: 'warlord', text: 'Fall back! Every unit to the command area!' }] },
  'm20-phase3': { id: 'm20-phase3', mode: 'radio', lines: [{ speaker: 'warlord', text: 'I built this army. You will not take it from me!' }] },
  'm20-down': { id: 'm20-down', mode: 'radio', lines: [{ speaker: O, text: 'The Warlord is down! Outstanding work. Extraction Alpha is north-east of the command area. Move!' }] },
  'm20-alpha': {
    id: 'm20-alpha', mode: 'radio', lines: [
      { speaker: O, text: 'Extraction Alpha in sight. Stand by for pickup.', hold: 3.2 },
      { speaker: 'pilot', text: 'Approaching landing zone. We have visual on your squad.', hold: 3.4 },
    ],
  },
  'm20-mayday': {
    id: 'm20-mayday', mode: 'cinematic', lines: [
      { speaker: O, text: 'MAYDAY! MAYDAY! Bird One is down!' },
      { speaker: O, text: 'Squad, fall back! We are redirecting extraction to Bravo, the clearing where you landed. Go!' },
    ],
  },
  'm20-fall': { id: 'm20-fall', mode: 'radio', lines: [{ speaker: O, text: 'Hostiles moving to cut you off. You do not have to fight them all: keep moving to Bravo.' }] },
  'm20-bravo': { id: 'm20-bravo', mode: 'radio', lines: [{ speaker: 'pilot', text: 'Bird Two inbound to Bravo. Twelve seconds, hold that clearing!' }] },
  'm20-intel': { id: 'm20-intel', mode: 'radio', lines: [{ speaker: O, text: 'His files are coming through: armored vehicles, heavy weapons, whole factories. This was never just one warlord.' }] },
};

export function speakerOf(line: StoryLine): StorySpeaker { return SPEAKERS[line.speaker]; }
export function portraitOf(line: StoryLine): string | undefined { return line.portrait ?? (SPEAKERS[line.speaker] as StorySpeaker).portrait; }

/** Plays scenes for the current mission. Owned by Game (`game.story`); reset on every mission start / exit. */
export class StoryDirector {
  /** The open cinematic (null = none). */
  scene: StoryScene | null = null;
  index = 0;
  /** Simulation seconds the current panel has been up (auto-advance). */
  t = 0;
  /** Real time (s) when the current panel appeared (tap guard). */
  shownAt = 0;
  /** Radio lines: the one showing and the ones waiting. */
  radio: { line: StoryLine; t: number; dur: number } | null = null;
  queue: StoryLine[] = [];
  /** Log for tools: what was shown / how it ended. */
  log: string[] = [];
  /** Off = cues are ignored (dev / tests only; never set by gameplay). */
  enabled = true;

  get line(): StoryLine | null { return this.scene ? this.scene.lines[this.index] ?? null : null; }
  get blocking() { return !!this.scene; }
  get hold() { const l = this.line; return l ? l.hold ?? readTime(l.text) : 0; }

  reset() { this.scene = null; this.index = 0; this.t = 0; this.radio = null; this.queue = []; this.log = []; }

  /** Start a scene. A cinematic suspends the simulation (Game.modal = 'story'); a radio scene queues its lines. */
  play(game: Game, id: string): boolean {
    const s = SCENES[id];
    if (!s || !s.lines.length || !this.enabled || game.phase !== 'playing') return false;
    if (s.mode === 'radio') {
      this.queue.push(...s.lines);
      this.log.push(`radio:${id}`);
      return true;
    }
    if (this.scene || (game.modal && game.modal !== 'story')) return false; // never two blocking prompts at once
    game.targeting = null; game.support.cancelAirstrike(); game.support.cancelNuke();
    this.scene = s; this.index = 0; this.t = 0; this.shownAt = realNow();
    game.modal = 'story';
    this.log.push(`open:${id}`);
    return true;
  }

  /** Tap / click / Enter / Space: next panel (or close after the last). Returns false inside the tap guard. */
  advance(game: Game, force = false): boolean {
    if (!this.scene) return false;
    if (!force && realNow() - this.shownAt < TAP_GUARD) return false;
    this.next(game, 'tap');
    return true;
  }

  /** SKIP / Esc: close the cinematic now; the mission continues exactly where it was suspended. */
  skip(game: Game): boolean {
    if (!this.scene) return false;
    this.close(game, 'skip');
    return true;
  }

  private next(game: Game, how: string) {
    if (!this.scene) return;
    if (this.index + 1 >= this.scene.lines.length) { this.close(game, how); return; }
    this.index++; this.t = 0; this.shownAt = realNow();
  }

  private close(game: Game, how: string) {
    if (!this.scene) return;
    this.log.push(`close:${this.scene.id}:${how}@${this.index}`);
    this.scene = null; this.index = 0; this.t = 0;
    if (game.modal === 'story') game.modal = null;
  }

  /** Called every fixed step while the mission is playing and not paused. */
  update(game: Game, dt: number) {
    if (this.scene) {
      this.t += dt;
      if (this.t >= this.hold) this.next(game, 'auto');
      return; // radio lines wait while a cinematic is open
    }
    if (game.modal) return; // ... and while any other prompt suspends the mission
    if (this.radio) {
      this.radio.t += dt;
      if (this.radio.t >= this.radio.dur) this.radio = null;
    }
    if (!this.radio && this.queue.length) {
      const line = this.queue.shift()!;
      this.radio = { line, t: 0, dur: line.hold ?? radioTime(line.text) };
      this.log.push(`say:${line.speaker}`);
    }
  }

  /** Mission over / left: drop everything (the modal is cleared by the caller). */
  end(game: Game) {
    if (this.scene) this.close(game, 'end');
    this.radio = null; this.queue = [];
  }
}
