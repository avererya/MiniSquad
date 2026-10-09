# MiniSquad

MiniSquad is a real-time squad action game for mobile (landscape), inspired by Tiny Troopers, with original art. You move a small squad of auto-firing cartoon soldiers through real-time combat, use abilities like grenades, revive downed squadmates, and complete objectives.

This repository holds **Combat Prototype v0.1**, a disposable web feel prototype. It exists to answer one question: is moving a small squad of auto-firing soldiers through real-time combat fun? The final game will be native mobile. What carries forward is the design and the tuned numbers in `src/config.ts`, not this code.

## Status

`prototype-v0.1`: playable, ready for feel playtesting.

- 1 to 3 Infantry with loose squad following and pathing around obstacles
- Auto-targeting with line of sight, physical projectiles, an accuracy cone that widens while moving
- Physical cover; Enemy Riflemen with flow-field pursuit and two temperaments
- Grenade ability; downed, revive and KIA states; medkit and Rapid Fire pickups
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
| Grenade | 1 / 2 / 3 or click a portrait, then click the ground | Tap a portrait, then tap the ground |
| Cancel grenade | Right-click / Esc | Tap the portrait again |
| Tuning panel | ` (backtick) or ⚙ | ⚙ |
| Mute / Pause | M / P | 🔊 / ⏸ |

Debug keys: F spawn friendly · G spawn enemy group · K down a soldier · I invulnerable · Shift+R restart.

## Code map

TypeScript + Vite + plain 2D canvas, no framework.

- `src/config.ts`: every gameplay number (the tuning panel edits it live)
- `src/game.ts`: game state, fixed-step update, damage, downed/revive/KIA
- `src/squad.ts`: squad anchor and loose following
- `src/enemy.ts`: Rifleman AI
- `src/combat.ts`: aiming, spread, projectiles, explosions, effects
- `src/targeting.ts`: swappable target-selection strategy
- `src/abilities.ts`: ability interface and Grenade
- `src/pickups.ts`: pickup interface, Medkit, Rapid Fire
- `src/mission.ts`: mission flow and extraction interface
- `src/world.ts`, `src/map.ts`: collision, line of sight, pathfinding, level data
- `src/render.ts`, `src/hud.ts`, `src/tuning.ts`, `src/input.ts`, `src/audio.ts`: presentation and input
- `tools/*.cjs`: headless Playwright checks (smoke test, autopilot playthrough, rule checks, touch)
