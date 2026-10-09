# MiniSquad Combat Prototype v0.1: build report

## How to run
- **No setup:** open the Artifact link from the thread, or open `index-single.html` from this folder in any browser.
- **Locally:** `npm install && npm run dev`, then open http://localhost:5173. `npm run build:single` rebuilds the single file.
- **In the embedded Artifact:** click inside the game once (the Start button does this) so it receives keyboard input. The tuning panel's Export button fills the text box and copies the JSON to the clipboard. File downloads are blocked in the embed, so the build has no download button.

## Controls
| Action | Desktop | Touch |
|---|---|---|
| Move squad | WASD / arrow keys | Drag on the left side (virtual joystick, analog) |
| Grenade | 1 / 2 / 3, or click a portrait, then click the ground | Tap a portrait, then tap the ground |
| Cancel a grenade | Right-click, Esc, or the same key again | Tap the portrait again |
| Tuning panel | ` (backtick) or ⚙ | ⚙ |
| Mute / Pause | M / P | 🔊 / ⏸ buttons |
| Restart from the end screen | Enter | Restart button |

**Debug keys:** F spawns a friendly, G spawns an enemy group, K downs a soldier, I toggles invulnerability, Shift+R restarts. The same actions, plus a squad-size picker (1 to 3), are in the tuning panel.

## Implemented, by tier
**Must (all done)**
- **Squad:** 2 Infantry by default; 1 to 3 at mission start from the tuning panel; spawning mid-mission is supported. Each soldier has a name, a speed multiplier and a preferred offset. They follow a virtual anchor loosely, using separation, wander, a formation that spreads while moving and tightens when stopped, an A* fallback when the straight line to their slot is blocked, and a sideways nudge at obstacle corners.
- **Auto-targeting:** each soldier fires at the nearest enemy that is in range and has line of sight. Selection is a swappable strategy (`targeting.ts`). Aim is independent of movement.
- **Gunfire:** physical projectiles fired inside a randomized cone. Movement widens the cone, scaled by actual speed. A translucent cone is drawn for soldiers who have a target: white while still, orange and wider while moving. It can be turned off in the panel.
- **Physical cover:** obstacles are solid rectangles that block bullets and line of sight in both directions. There's no friendly fire, and grenades only damage enemies.
- **Riflemen:** they pursue along a flow field. Each is randomly a "stop and shoot" or an "advance while firing" type, with random speed and reaction time. They aim at the target's current position with no leading, and have health bars. Outpost defenders stay dormant until the squad approaches or they get shot.
- **Grenade:** built on an ability interface. It shows a range ring and a blast preview, clamps the target to max range, flies in a visible arc with a short fuse, explodes with screen shake, then goes on cooldown. Time keeps running while you aim.
- **Health and downed states:** HP, hit flashes, enemy death pops and a red screen-edge flash when a soldier is hit. A downed soldier triggers a big "NAME DOWN!" banner, a pulsing outline, a countdown over the soldier, a HUD panel state change and an off-screen arrow. Revive takes 10 s; progress pauses and is kept if the reviver leaves, and the bleed-out timer pauses while reviving. A revived soldier returns at 40% HP. Bleed-out is 30 s, then KIA. If everyone is down or KIA at once, the mission fails immediately.
- **Pickups:** medkits, built on a pickup interface with an on-collect effect.
- **Config and tuning panel:** every number lives in `config.ts`. The panel has about 50 live sliders (changed values are highlighted), Export JSON (copies it), Apply JSON (import), Reset to defaults, and the debug actions.

**Should (all done)**
- **Full mission flow:** triggered waves spawn off screen → outpost defenders → 5 s hold → "OBJECTIVE COMPLETE" → extraction zone highlighted with an arrow → final wave and 20 s countdown → extract with every standing soldier in the zone. Anyone still downed at that point becomes KIA, and a warning shows while someone is down. The end screen shows the result, mission time and each soldier's state.
- **Touch:** virtual joystick, plus tap-to-target for grenades.
- **Off-screen arrows:** for downed soldiers (with their countdown) and for the current objective.

**Only if cheap (done):** a helicopter that flies in and lands as the countdown ends, a Rapid Fire pickup and synthesized sound effects with mute.

## Deferred or not done
- Parachute arrivals for reinforcements.
- A slow-motion or zoom option for grenade aiming on small phones. The brief said no time slow, so none was built.

## Technical concerns
- **The squad anchor is a virtual point.** It's leashed to the squad centre so it can't run away, and it slides along walls. Pushing straight into a long wall stops you, and pushing near a corner slides you around it. Watch for this in playtests.
- **Range vs screen height:** riflemen have 380 range but the view is only 720 tall, so range alone can't stop off-screen fire vertically. I added an explicit rule that enemies only shoot while on screen. Soldiers (420 range) can still hit enemies just above or below the screen edge.
- **Pathing:** riflemen follow one shared flow field toward the nearest soldier, recomputed every 0.3 s. They clump at times despite separation.
- **Depth effect:** buildings draw a raised roof, so soldiers north of a building are hidden behind it. A blue outline then shows where they are.
- **Pace:** an automated rush through the mission finishes in about 55 to 60 s with 2 soldiers. A careful human run will take longer but may still come in under 3 minutes. If it's short, raise wave sizes or enemy HP in the panel.
- **Balance:** the automated run with 2 soldiers survived with one at 2 HP. With 1 soldier it was downed at the first wave because it never dodges. Real players dodge, but tune the 1-soldier case specifically.
- **Code scope:** the code is a prototype. It has no tests beyond the headless scripts in `tools/`: a smoke test, an autopilot playthrough at sizes 1 to 3, 8 rule checks (medkit, revive, KIA, LOS both ways, wall stops bullets, grenade spares friendlies, extraction KIA) and touch input. All pass.

## Top things to evaluate in playtesting
1. Does strafing and retreating while the squad keeps firing feel good? Is the moving vs standing accuracy difference obvious? Try Move penalty from 10 to 30.
2. Squad follow feel: does it feel loose and organic or floaty? Try Looseness, Follow accel and the spread values.
3. Can you dodge enemy bullets, and does it feel fair? Try enemy Projectile speed (500 to 700) and Accuracy.
4. Time to kill on both sides (HP, damage, fire rate). Do fights last long enough to use movement and cover?
5. Is downed/revive tense but recoverable? Is 10 s to revive too long under fire?
6. Grenade usefulness and cooldown, especially on touch.
7. The 1-soldier vs 2-soldier experience.
