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
export type StoryCue = 'bossIntro' | 'bossPhase2' | 'bossPhase3' | 'victory';

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
