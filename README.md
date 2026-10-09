# MiniSquad

MiniSquad is a real-time squad action game for mobile (landscape), inspired by Tiny Troopers, with original art. You move a small squad of auto-firing cartoon soldiers through real-time combat, use abilities like grenades, revive downed squadmates, and complete objectives.

This repository holds **Combat Prototype v0.1**, a disposable web feel prototype. It exists to answer one question: is moving a small squad of auto-firing soldiers through real-time combat fun? The final game will be native mobile. What carries forward is the design and the tuned numbers in `src/config.ts`, not this code.

## Status

`v0.4` (campaign foundations; the original build is tagged `prototype-v0.1`).

- v0.4: a five-mission campaign with sequential unlocks, stars and soldiers who join as you progress. The game now opens on the **Campaign** screen (Campaign → Squad/Barracks → Deploy → Mission → Results → Campaign or Retry). See [Campaign](#campaign) below. Rescue rules changed for every mission: bleed-out is 20 s (was 30 s), a valid revive (reviver in range with line of sight) pauses the timer, an interrupted revive resumes from the remaining time, and a revive restores 30% HP (was 40%). The extraction helicopter waits while a revive is in progress. Downed soldiers show their name, a bleed-out ring, revive progress and a blinking CRITICAL warning for the last 5 s. The engine supports squads of up to 6 (up to 4 in v0.4 play); the HUD switches to compact tiles from 4 soldiers. Save v3 (migrates v2 and v1 in place).

- v0.3: soldiers earn XP from completed missions (same XP for every soldier who extracts; none for KIA, none on defeat; replays pay 75%) and level up automatically from 1 to 25, gaining a little HP, damage and fire rate per level. Credits are one account-wide currency earned once per mission (victory, whole-squad extraction, nobody downed, first-time completion; replays pay less). The Barracks has three tabs: Roster (squad selection, now with level and XP bars), Training (per-soldier Accuracy, Damage, Max HP, Fire Rate and Move Speed, 10 ranks each) and Squad Training (HP, Damage, Accuracy and Fire Rate for every soldier, 5 ranks each). Results show XP per soldier, level-ups and the Credits breakdown; rewards are paid exactly once per mission run. The save moves to v2; v0.2.2 saves are migrated in place (soldiers and squad kept). All numbers live in `src/progression.ts`.

- v0.2.2: first full loop, Barracks → select squad → deploy → mission → Results → Barracks. A fixed roster of six soldiers (Ace, Ranger, Tank, Havoc, Doc, Patch), each with a class, one natural trait and a progression record (level 1, no XP or upgrades yet). Traits (Sharpshooter, Quick Reflexes, Tough, Trigger Happy, First Responder, Healer) modify computed effective stats and never change class defaults. Pick 1 to 3 soldiers (duplicate classes allowed). Roster and selection are saved locally (versioned, validated). The Results screen shows kills, damage, healing, revives and final status per soldier, with Retry and Return to Barracks. KIA lasts only for the mission.

- v0.2.1: three soldier classes (Infantry, Heavy Gunner, Medic) built on a class registry, each with its own stats, look and ability (Grenade, Suppressive Fire, Field Treatment); revive speed depends on the reviver's class; friendly bullets slowed to 700 px/s (from 950); Infantry spread widened to 12° still / 30° moving (from 7° / 25°, full cone); Infantry fire rate set to 3/s (from 4/s); squad presets in the tuning panel (or `?squad=ihm` in the URL); slower soldiers catch up when they fall behind

- v0.1.2: layout recomputes on rotation and viewport changes (no more shifted game or cut-off ability buttons after portrait to landscape); respects safe areas; Settings panel shows the version and commit hash

- v0.1.1: green overhead health bars on friendly soldiers; medkits heal every standing soldier by 20% of max HP; enemy bullets slowed to 390 px/s (from 600) so they can be dodged; Infantry spread widened to 7° (from 4°)

- Barracks with six named soldiers, natural traits, per-soldier details (base vs effective stats) and squad selection up to each mission's cap, saved in localStorage
- Results screen after every mission with per-soldier kills, damage, healing, revives and final status
- Squads of 1 to 6 soldiers (engine; up to 4 in the v0.4 campaign) from three classes, with loose squad following and pathing around obstacles
- Auto-targeting with line of sight, physical projectiles, an accuracy cone that widens while moving
- Physical cover; Enemy Riflemen with flow-field pursuit and two temperaments
- Class abilities: Grenade (Infantry), Suppressive Fire (Heavy Gunner), Field Treatment (Medic); downed, revive and KIA states; medkit and Rapid Fire pickups
- Five campaign missions (Elimination, Sabotage, Capture & Hold, Survival, Rescue / Escort), each ending with a helicopter extraction
- Keyboard and touch controls (virtual joystick)
- In-game tuning panel with live sliders and JSON export/import

See [REPORT.md](REPORT.md) for the full build report, technical concerns and playtest questions.

## Campaign

Mission data (names, types, objectives, caps, star rules, unlocks) lives in `src/campaign.ts`; maps in `src/map.ts`; enemy groups, triggers and objective chains in `src/missions.ts`; reusable objective modules in `src/objectives.ts`.

| # | Mission | Type | Squad cap | Primary | Optional (+25 XP / +150 CR) | ★★ / ★★★ | First clear unlocks |
|---|---|---|---|---|---|---|---|
| 1 | First Contact | Elimination | 2 | Eliminate three patrols, extract | none | whole squad extracted / nobody downed | Mission 2, **Tank** |
| 2 | Heavy Support | Sabotage | 2 | Destroy the supply depot, extract (hold 12 s) | Eliminate the guarded MG nest | all optionals / no KIA | Mission 3, **Doc** |
| 3 | Field Medicine | Capture & Hold | 3 | Take and hold the comms outpost, extract | Extract every soldier | all optionals / nobody downed | Mission 4 |
| 4 | Red Canyon Ambush | Survival / Extraction | 3 | Advance into the canyon, survive a 50 s ambush, extract | none | whole squad extracted / nobody downed | Mission 5 |
| 5 | Bring Them Home | Rescue / Escort | 3 | Clear the compound, free the captive, escort them to extraction | The captive takes no damage | all optionals / no KIA | **Havoc**, squad size 4 for Mission 6 |

- Stars: 0 on defeat, ★ = primary objectives complete. Best stars are saved per mission and never go down. Missions can be replayed forever (replay rewards as in v0.3).
- Squad caps by mission number: 1-2 → 2, 3-5 → 3, 6 → 4, 7-12 → 5, 13+ → 6. You may deploy fewer. If the saved squad is larger than the selected mission allows (for example a v0.3 squad of 3 on Mission 1), the extra slots are marked OVER LIMIT and Deploy is disabled until you remove someone or tap **Keep first N**. The saved squad is never trimmed automatically.
- Soldiers: a new save starts with Ace and Ranger. Tank joins on the first clear of Mission 1, Doc on Mission 2, Havoc on Mission 5. Patch is reserved for the Mission 7 milestone (future update). Locked soldiers are shown with how to unlock them.
- Overlap rule: Mission 3's optional objective *is* "whole squad extracted", so on Mission 3 it pays once, as the optional (+25 XP / +150 CR), and the global whole-squad line is left out. The totals are the same as before.
- The v0.1-v0.3 comms-outpost mission is now Mission 3 (Field Medicine, new id `field-medicine`). Its old record (`comms-outpost`) is kept in the save as history. A player who already cleared it in v0.3 does not get the one-time +250 CR first-clear bonus again on Mission 3 (no double grant); unlocks and XP work normally.
- v0.3 / v0.2.2 saves: everything is kept (soldiers, XP, levels, training, Credits, squad), all six soldiers stay unlocked, and the campaign starts at Mission 1. The original save text is kept once under `minisquad.save.pre-v0.4`.

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
| Ability | 1-6 or click a portrait | Tap a portrait |
| Grenade target | Click the ground (right-click / Esc cancels) | Tap the ground (tap the portrait again to cancel) |
| Campaign | click a mission (↑ / ↓), Enter deploys, B opens the Barracks | tap |
| Pick squad | Barracks: click a soldier's ADD / ✕, click a slot then a soldier to replace; Enter deploys; Esc / C back to Campaign | tap |
| Results | Enter retry · C Campaign · B / Esc Barracks | buttons |
| Dev squad | Tuning panel → Squad preset (generic soldiers), `?squad=ii\|ih\|im\|ihm\|hh\|mm`, or `?squad=ace,doc` (roster soldiers, temporary). None of these change the saved squad | same |
| Tuning panel | ` (backtick) or ⚙ | ⚙ |
| Mute / Pause | M / P | 🔊 / ⏸ |

Reset all progress (roster, squad, XP, Credits, training, campaign): tuning panel → Debug → "Reset save…" (tap twice to confirm). "Unlock all missions + soldiers (modifies save)…" (tap twice) unlocks everything in your save for testing. The tuning panel's Mission picker starts any mission; a mission started while still locked pays no rewards and unlocks nothing.

Debug keys: F spawn friendly · G spawn enemy group · K down a soldier · I invulnerable · Shift+R restart.

## Code map

TypeScript + Vite + plain 2D canvas, no framework.

- `src/config.ts`: every gameplay number, including per-class stats (the tuning panel edits it live)
- `src/classes.ts`: class registry (stats group, ability, look), soldier identity, effective stats, squad presets
- `src/traits.ts`: natural trait registry and the stat modifier math (class base → trait → individual modifiers)
- `src/progression.ts`: XP curve, level growth, Credits rules, training tables, the account, and the effective-stat pipeline (class base → level + training + squad training, additive % of base → trait → temporary effects)
- `src/economy.ts`: mission settlement (once per run id) and atomic training purchases
- `src/campaign.ts`: campaign data (missions, capacity table, star rules, unlocks)
- `src/missions.ts`, `src/objectives.ts`: per-mission scripts and the reusable objective modules (eliminate, destroy, capture & hold, reach, survive, free captive, optional objectives)
- `src/roster.ts`, `src/save.ts`: the six-soldier roster, unlocks, squad selection rules, versioned local save (`minisquad.save`, v3, migrates v2 and v1) with per-field validation and recovery
- `src/missionstats.ts`: per-soldier mission statistics and attribution rules
- `src/menus.ts`: Campaign, Barracks, soldier details and Results screens
- `src/game.ts`: game state, fixed-step update, damage, downed/revive/KIA
- `src/squad.ts`: squad anchor and loose following
- `src/enemy.ts`: Rifleman AI
- `src/combat.ts`: aiming, spread, projectiles, explosions, effects
- `src/targeting.ts`: swappable target-selection strategy
- `src/abilities.ts`: ability interface, Grenade, Suppressive Fire, Field Treatment
- `src/pickups.ts`: pickup interface, Medkit, Rapid Fire
- `src/mission.ts`: mission flow (objective chain, reinforcement triggers, escort NPC) and extraction interface
- `src/world.ts`, `src/map.ts`: collision, line of sight, pathfinding, the five maps
- `src/render.ts`, `src/hud.ts`, `src/tuning.ts`, `src/input.ts`, `src/audio.ts`: presentation and input
- `tools/*.cjs`: headless Playwright checks: `campaign-rules.cjs` (v0.4 unlocks, caps, over-limit, stars, optionals, objectives, escort, rescue rules, squad scaling, v0.3 save), `campaign.cjs` (campaign autopilot: `MODE=new` new-player campaigns, `MODE=legacy` upgraded v0.3 roster, `MODE=fixed SQUAD=...`), `maps.cjs` (navigability + overview images), `progression.cjs` (v0.3 XP / Credits / training / save migration / phone tabs), `progression-balance.cjs` (playthroughs at different levels + economy pacing), `logic.cjs` (rule checks, PASS/FAIL), `barracks.cjs` (selection, save/reload, invalid saves, results flow), `squads.cjs` (roster squad playthroughs + stat attribution ledger), `mobile.cjs` (Barracks/Results/HUD on phones, touch, rotation), `balance.cjs` (accuracy and mission experiments), `play.cjs` (autopilot), `classes.cjs` / `lineup.cjs` (screenshots), plus the older smoke/touch/visual scripts. Serve a build first: `npm run build && npx vite preview --port 4173`
