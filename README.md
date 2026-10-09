# MiniSquad

MiniSquad is a real-time squad action game for mobile (landscape), inspired by Tiny Troopers, with original art. You move a small squad of auto-firing cartoon soldiers through real-time combat, use abilities like grenades, revive downed squadmates, and complete objectives.

This repository holds **Combat Prototype v0.1**, a disposable web feel prototype. It exists to answer one question: is moving a small squad of auto-firing soldiers through real-time combat fun? The final game will be native mobile. What carries forward is the design and the tuned numbers in `src/config.ts`, not this code.

## Status

`v0.2.1` (soldier classes and combat refinement; the original build is tagged `prototype-v0.1`).

- v0.2.1: three soldier classes (Infantry, Heavy Gunner, Medic) built on a class registry, each with its own stats, look and ability (Grenade, Suppressive Fire, Field Treatment); revive speed depends on the reviver's class; friendly bullets slowed to 700 px/s (from 950); Infantry spread widened to 12° still / 30° moving (from 7° / 25°, full cone); Infantry fire rate set to 3/s (from 4/s); squad presets in the tuning panel (or `?squad=ihm` in the URL); slower soldiers catch up when they fall behind

- v0.1.2: layout recomputes on rotation and viewport changes (no more shifted game or cut-off ability buttons after portrait to landscape); respects safe areas; Settings panel shows the version and commit hash

- v0.1.1: green overhead health bars on friendly soldiers; medkits heal every standing soldier by 20% of max HP; enemy bullets slowed to 390 px/s (from 600) so they can be dodged; Infantry spread widened to 7° (from 4°)

- Squads of 1 to 3 soldiers from three classes, with loose squad following and pathing around obstacles
- Auto-targeting with line of sight, physical projectiles, an accuracy cone that widens while moving
- Physical cover; Enemy Riflemen with flow-field pursuit and two temperaments
- Class abilities: Grenade (Infantry), Suppressive Fire (Heavy Gunner), Field Treatment (Medic); downed, revive and KIA states; medkit and Rapid Fire pickups
- Full mission: Secure the Communications Outpost, then extract by helicopter
- Keyboard and touch controls (virtual joystick)
- In-game tuning panel with live sliders and JSON export/import

See [REPORT.md](REPORT.md) for the full build report, technical concerns and playtest questions.

## Run it

Requires Node.js 18 or newer.

```
npm install
npm run dev            # http://localhost:5173
npm run build          # production build in dist/
npm run build:single   # one self-contained file: dist-single/index.html
```

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Move squad | WASD / arrow keys | Drag on the left side |
| Ability | 1 / 2 / 3 or click a portrait | Tap a portrait |
| Grenade target | Click the ground (right-click / Esc cancels) | Tap the ground (tap the portrait again to cancel) |
| Squad preset | Tuning panel → Squad preset, or `?squad=ii\|ih\|im\|ihm\|hh\|mm` | same |
| Tuning panel | ` (backtick) or ⚙ | ⚙ |
| Mute / Pause | M / P | 🔊 / ⏸ |

Debug keys: F spawn friendly · G spawn enemy group · K down a soldier · I invulnerable · Shift+R restart.

## Code map

TypeScript + Vite + plain 2D canvas, no framework.

- `src/config.ts`: every gameplay number, including per-class stats (the tuning panel edits it live)
- `src/classes.ts`: class registry (stats group, ability, look), soldier identity, squad presets
- `src/game.ts`: game state, fixed-step update, damage, downed/revive/KIA
- `src/squad.ts`: squad anchor and loose following
- `src/enemy.ts`: Rifleman AI
- `src/combat.ts`: aiming, spread, projectiles, explosions, effects
- `src/targeting.ts`: swappable target-selection strategy
- `src/abilities.ts`: ability interface, Grenade, Suppressive Fire, Field Treatment
- `src/pickups.ts`: pickup interface, Medkit, Rapid Fire
- `src/mission.ts`: mission flow and extraction interface
- `src/world.ts`, `src/map.ts`: collision, line of sight, pathfinding, level data
- `src/render.ts`, `src/hud.ts`, `src/tuning.ts`, `src/input.ts`, `src/audio.ts`: presentation and input
- `tools/*.cjs`: headless Playwright checks: `logic.cjs` (rule checks, PASS/FAIL), `mobile.cjs` (touch, rotation, HUD), `balance.cjs` (accuracy and mission experiments), `play.cjs` (autopilot), `classes.cjs` / `lineup.cjs` (screenshots), plus the older smoke/touch/visual scripts. Serve a build first: `npm run build && npx vite preview --port 4173`
