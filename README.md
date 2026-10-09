# MiniSquad

MiniSquad is a real-time squad action game for mobile (landscape), inspired by Tiny Troopers, with original art. You move a small squad of auto-firing cartoon soldiers through real-time combat, use abilities like grenades, revive downed squadmates, and complete objectives.

This repository holds **Combat Prototype v0.1**, a disposable web feel prototype. It exists to answer one question: is moving a small squad of auto-firing soldiers through real-time combat fun? The final game will be native mobile. What carries forward is the design and the tuned numbers in `src/config.ts`, not this code.

## Status

`v0.3` (XP, Credits and soldier training; the original build is tagged `prototype-v0.1`).

- v0.3: soldiers earn XP from completed missions (same XP for every soldier who extracts; none for KIA, none on defeat; replays pay 75%) and level up automatically from 1 to 25, gaining a little HP, damage and fire rate per level. Credits are one account-wide currency earned once per mission (victory, whole-squad extraction, nobody downed, first-time completion; replays pay less). The Barracks has three tabs: Roster (squad selection, now with level and XP bars), Training (per-soldier Accuracy, Damage, Max HP, Fire Rate and Move Speed, 10 ranks each) and Squad Training (HP, Damage, Accuracy and Fire Rate for every soldier, 5 ranks each). Results show XP per soldier, level-ups and the Credits breakdown; rewards are paid exactly once per mission run. The save moves to v2; v0.2.2 saves are migrated in place (soldiers and squad kept). All numbers live in `src/progression.ts`.

- v0.2.2: first full loop, Barracks → select squad → deploy → mission → Results → Barracks. A fixed roster of six soldiers (Ace, Ranger, Tank, Havoc, Doc, Patch), each with a class, one natural trait and a progression record (level 1, no XP or upgrades yet). Traits (Sharpshooter, Quick Reflexes, Tough, Trigger Happy, First Responder, Healer) modify computed effective stats and never change class defaults. Pick 1 to 3 soldiers (duplicate classes allowed). Roster and selection are saved locally (versioned, validated). The Results screen shows kills, damage, healing, revives and final status per soldier, with Retry and Return to Barracks. KIA lasts only for the mission.

- v0.2.1: three soldier classes (Infantry, Heavy Gunner, Medic) built on a class registry, each with its own stats, look and ability (Grenade, Suppressive Fire, Field Treatment); revive speed depends on the reviver's class; friendly bullets slowed to 700 px/s (from 950); Infantry spread widened to 12° still / 30° moving (from 7° / 25°, full cone); Infantry fire rate set to 3/s (from 4/s); squad presets in the tuning panel (or `?squad=ihm` in the URL); slower soldiers catch up when they fall behind

- v0.1.2: layout recomputes on rotation and viewport changes (no more shifted game or cut-off ability buttons after portrait to landscape); respects safe areas; Settings panel shows the version and commit hash

- v0.1.1: green overhead health bars on friendly soldiers; medkits heal every standing soldier by 20% of max HP; enemy bullets slowed to 390 px/s (from 600) so they can be dodged; Infantry spread widened to 7° (from 4°)

- Barracks with six named soldiers, natural traits, per-soldier details (base vs effective stats) and 3-slot squad selection, saved in localStorage
- Results screen after every mission with per-soldier kills, damage, healing, revives and final status
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
| Pick squad | Barracks: click a soldier's ADD / ✕, click a slot then a soldier to replace; Enter deploys | tap |
| Results | Enter retry · B / Esc back to Barracks | buttons |
| Dev squad | Tuning panel → Squad preset (generic soldiers), `?squad=ii\|ih\|im\|ihm\|hh\|mm`, or `?squad=ace,doc` (roster soldiers, temporary). None of these change the saved squad | same |
| Tuning panel | ` (backtick) or ⚙ | ⚙ |
| Mute / Pause | M / P | 🔊 / ⏸ |

Reset all progress (roster, squad, XP, Credits, training): tuning panel → Debug → "Reset save…" (tap twice to confirm).

Debug keys: F spawn friendly · G spawn enemy group · K down a soldier · I invulnerable · Shift+R restart.

## Code map

TypeScript + Vite + plain 2D canvas, no framework.

- `src/config.ts`: every gameplay number, including per-class stats (the tuning panel edits it live)
- `src/classes.ts`: class registry (stats group, ability, look), soldier identity, effective stats, squad presets
- `src/traits.ts`: natural trait registry and the stat modifier math (class base → trait → individual modifiers)
- `src/progression.ts`: XP curve, level growth, Credits rules, training tables, the account, and the effective-stat pipeline (class base → level + training + squad training, additive % of base → trait → temporary effects)
- `src/economy.ts`: mission settlement (once per run id) and atomic training purchases
- `src/roster.ts`, `src/save.ts`: the six-soldier roster, squad selection rules, versioned local save (`minisquad.save`, v2, migrates v1) with validation and recovery
- `src/missionstats.ts`: per-soldier mission statistics and attribution rules
- `src/menus.ts`: Barracks, soldier details and Results screens
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
- `tools/*.cjs`: headless Playwright checks: `progression.cjs` (v0.3 XP / Credits / training / save migration / phone tabs), `progression-balance.cjs` (playthroughs at different levels + economy pacing), `logic.cjs` (rule checks, PASS/FAIL), `barracks.cjs` (selection, save/reload, invalid saves, results flow), `squads.cjs` (roster squad playthroughs + stat attribution ledger), `mobile.cjs` (Barracks/Results/HUD on phones, touch, rotation), `balance.cjs` (accuracy and mission experiments), `play.cjs` (autopilot), `classes.cjs` / `lineup.cjs` (screenshots), plus the older smoke/touch/visual scripts. Serve a build first: `npm run build && npx vite preview --port 4173`
