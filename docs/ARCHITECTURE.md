# MiniSquad architecture

How the game is put together, for developers. Verified against v0.8B.1 (`601dbc2`); if `src/` has moved on, trust the code.
Feature → file → test lookups are in [SYSTEM_MAP.md](SYSTEM_MAP.md). Player-facing rules and numbers are in the [README](../README.md).

## Stack and layout

TypeScript (strict) + Vite, plain 2D canvas, no framework, no runtime dependencies. 47 files / ~16,300 lines in `src/` (flat, no subfolders), 45 headless Playwright scripts in `tools/`.

```
index.html  → #stage (canvas #game + #hud), #menu, #tuning  → src/main.ts
src/        game code (one flat folder)        tools/    headless checks, sims, fixtures
docs/       developer docs                      dist/     build output (deployed)
```

## Startup and runtime ownership

`src/main.ts` is the only entry point. In order it:
1. creates `Game` (`src/game.ts`) and `Hud` (`src/hud.ts`, which owns `Menus` from `src/menus.ts` and `Tuning` from `src/tuning.ts`);
2. loads the save (`loadSave` in `src/save.ts`) into `game.roster` and the account singleton (`setAccount` in `src/progression.ts`), then `economy.recoverInterruptedRun` resolves a mission that was closed mid-run;
3. fits the 1280×720 stage to the viewport (`resize`: safe areas, `--t44` touch-size variable, rotation re-layout);
4. handles dev URLs (`?squad=`), then opens the Campaign screen or the pending casualty decisions;
5. starts the frame loop and exposes `window.game` and `__*` hooks that the `tools/` scripts drive.

Ownership: **`Game` is the state hub.** It holds the current `Mission`, `World`, all units (`soldiers`, `npcs`, `allies`, `assets`, `enemies`), projectiles, grenades, pickups, effects, `support`, `stats`, `roster`, `phase` (`start | playing | failed | won`), `paused` and `modal`. Almost every system receives `game` and reads or writes it directly.

The account (`AccountData` in `src/progression.ts`: credits, squad training, mission records, campaign unlocks, recruitment, casualties, Memorial, named recruits, class unlocks, promotion ledger, support stock) is a module-level singleton read through `getAccount()`.

## Main loop and fixed-step simulation

```
requestAnimationFrame(frame)                                   src/main.ts
  FramePacer.due(now, fpsCap)   30 FPS default on phones, 60 desktop     src/perf.ts
  SimClock.advance(now)         n × 1/60 s steps, frame delta clamped 0.1 s   src/clock.ts
  for n: game.update(1/60)                                     src/game.ts
  render(ctx, game)                                            src/render.ts
  hud.update()                                                 src/hud.ts
```

The simulation **always** steps 1/60 s. The frame cap only changes how many steps run per drawn frame, so 30 and 60 FPS play identically (checked by `tools/fps-parity.cjs`). Hiding the page or losing focus pauses a mission; nothing catches up afterwards.

`Game.update(dt)` order (`src/game.ts`): effects/banners → (stop if not playing, paused or modal) → Elite auras → squad, escort and ally movement (`src/squad.ts`) → enemy flow field every 0.3 s (`World.computeFlow`) → enemy movement (`src/enemy.ts`) → `mission.unitStep` (convoy, boss, escort truck) → integrate and push-apart collision, structures, `pushOut` for assets, `World.resolveCircle` → weapons (soldiers, offhand pistols, allies, turrets, mounted gun, enemies, enemy snipers) → `eliteTick` → projectiles, grenades, `support.update`, pickups → ability ticks and cooldowns → cleanup → `updateDowned` (bleed-out, revive) → `mission.update` (objectives, triggers, extraction) → squad-wipe check → camera.

**Determinism rule:** gameplay code that runs in the step must not depend on frame rate. Newer systems (Elite passives, awareness, support, waves) also avoid `Math.random` so builds can be compared bit for bit with `BASE=`. Weapon spread does use `rand` (`Math.random`); `tools/fps-parity.cjs` seeds `Math.random` before boot so runs stay comparable, so keep every random draw inside the fixed step and in a stable order.

## Systems

| System | Primary files | Key dependencies / notes |
|---|---|---|
| Input and touch | `src/input.ts` (`Input`: keys, left-half virtual joystick, taps, airstrike aiming) | Calls `Game` through `InputHandler` (`onKey`, `onTargetConfirm`). HUD buttons (portraits, support, extraction warning) are DOM in `src/hud.ts`. |
| Squad movement, formation, revive | `src/squad.ts` (`updateSquad`, `ringAngles`, `updateEscort`, `updateAllies`), `src/game.ts` (`updateDowned`, `downSoldier`, `kia`) | `src/world.ts` (nav grid, A*, line of sight, `resolveCircle`), `CFG.squad` / `CFG.revive`. Escort-truck avoidance (`makeWay`, `clearOf`, `around`, `sweep`) comes from `src/escort.ts`. |
| Units and stats | `src/unit.ts` (`Unit`, `EnemyKind`, per-step `StatBlock`) | Stats from `src/classes.ts` `effectiveStats` (soldiers) or `CFG.<enemy kind>`. |
| Enemy AI | `src/enemy.ts` (`updateEnemyMovement`), `src/awareness.ts` (alerts, investigation, search), `src/targeting.ts` (strategies) | Flow field in `src/world.ts`; boss in `src/boss.ts`; convoy in `src/convoy.ts`; numbers in `CFG.enemy`, `enemySniper`, `armored`, `tower`, `awareness`. |
| Combat and projectiles | `src/combat.ts` (`updateWeapon`, `updateOffhand`, `updateEnemySniper`, `updateProjectiles`, `explode`, `modifyDamage`), `Game.damage` in `src/game.ts` | Every hit goes through `Game.damage(u, amount, source, opts)`: Elite reduction caps, support floors, awareness alerts, mission events, stats. |
| Abilities and charges | `src/abilities.ts` (`BaseAbility`, `activateAbility`, `resetCharges`, Grenade, Suppressive Fire, Field Treatment, Focus, Bullet Storm, Inferno with its afterburn `updateBurns`) | `ABILITY_FACTORIES` in `src/classes.ts`; capacity tables in `src/progression.ts` (`ABILITY_CAPACITY`, `abilityUses`). `activateAbility` is the only path that spends a charge. |
| Missions and objectives | `src/mission.ts` (`Mission`, `MissionScript`, extraction, pressure), `src/missions.ts` (one `MissionScript` per mission, `MISSION_SCRIPTS`, `scriptFor`), `src/objectives.ts` (`Objective` base and reusable objectives) | Mechanic modules: `src/convoy.ts` (M8), `src/boss.ts` (M10), `src/chapter3.ts` (M11–12 objectives), `src/artillery.ts` (M12), `src/defense.ts` (M13), `src/escort.ts` (M14), `src/fortress.ts` + `src/general.ts` (M15: gate objectives, General Voss). Lockdown gates swap the collision world (`MissionScript.lockdown`, `Mission.openGate`). Maps and zones in `src/map.ts`. |
| Campaign and unlocks | `src/campaign.ts` (`CAMPAIGN` rows, `CAPACITY_TABLE`, stars, unlocks, named recruits, class unlock text, briefings) | Unlocks applied once in `economy.settleMission`, re-derived on load in `src/save.ts`. |
| Roster, recruitment, classes, traits | `src/roster.ts`, `src/recruitment.ts`, `src/classes.ts`, `src/traits.ts` | Money moves only in `src/economy.ts` (`recruit`, `recruitNamed`, `refreshOffers`, `dismiss`, `rename`). |
| Progression, training, Elite | `src/progression.ts` (XP, levels, training tables, account types), `src/elite.ts` (specializations, Elite XP, passives) | Purchases and promotion in `src/economy.ts`; passives hook into `src/combat.ts`, `src/game.ts`, `src/squad.ts`. |
| Permanent death | `src/casualties.ts` (prices, decision rules, Phoenix), `src/economy.ts` (settlement, resurrect, Memorial), `src/game.ts` (timers), `src/mission.ts` (extraction attempt) | KIA journal (`account.activeRun`) survives reloads. |
| Economy and settlement | `src/economy.ts` (`settleMission` once per run id), `src/progression.ts` (`computeMissionRewards`), `src/missionstats.ts` | Called from `Game.settle` at mission end; only roster deployments pay. |
| Tactical Support | `src/support.ts` (eligibility, airstrike, nuke, damage, floors, shop catalog) | Wired in `Game` (`useAirstrike`, `launchNuke`…), damage via `Game.damage` with `opts.support`; purchase `economy.buySupport`. |
| Save / load | `src/save.ts` (`SAVE_VERSION = 9`, `parseSave`, `mergeSoldier`, `clean*` repairs, backups) | Types in `src/progression.ts` and `src/classes.ts` (`SoldierIdentity`, `ProgressionRecord`). Key `minisquad.save`. |
| Rendering | `src/render.ts` (`render(ctx, game)`: ground strips, units, class and Elite looks, effects, mission drawings) | Mission modules also draw through `Objective.draw` and module `draw*` methods. |
| HUD, menus, tuning | `src/hud.ts` (in-mission DOM HUD), `src/menus.ts` (Campaign, Barracks, Results, briefings, decisions, Memorial), `src/tuning.ts` (⚙ Settings: performance + version; sliders, debug and config JSON only with `?dev=1`), `src/style.css` | HUD writes are skipped when values are unchanged. Layout is a scaled 1280×720 stage. |
| Story and cinematics (v0.8C.1) | `src/story.ts` (`StoryDirector`, `SCENES`, `SPEAKERS`), `src/storyview.ts` (`#cine` panels, `#radio` strip) | Cues from `Mission.cue` (`MissionScript.story`); a cinematic is `Game.modal = 'story'`. Data-driven; artwork optional. |
| Config | `src/config.ts` (`CFG`, `DEFAULTS`, `applyConfigJSON`) | Every gameplay number lives here; the `?dev=1` tuning panel edits it live (memory only, never saved). |
| Performance | `src/perf.ts`, `src/perfoverlay.ts`, `src/clock.ts` | `?fps=30|60`, `?perf=1`; settings stored in `minisquad.dev.perf`, never in the save. |
| Audio | `src/audio.ts` | Generated sounds, suspended while hidden. |

## Mission lifecycle

1. Campaign screen → briefing → DEPLOY (`src/menus.ts`) → `Game.deploySelected` → `Game.startMission`: new `Mission(scriptFor(id))`, `World` for the map, soldiers spawned (charges reset), `Support` counted from deployed Elites, new run id, then `mission.start(game)`.
2. `mission.start` spawns groups, the captive / allies / protected asset / escort truck / artillery from `MissionScript` fields and activates the first primary objective.
3. Each step `Mission.update` runs triggers, the current primary, optionals and extraction. `Game` and objectives report through `Mission.emit(game, MissionEvent)` (`enemyKilled`, `soldierDowned`, `assetDestroyed`…).
   v0.8C.1: a mission can play story scenes at cues (`MissionScript.story`, `Mission.cue`, `src/story.ts`). A cinematic sets `Game.modal = 'story'`, which suspends the step exactly like the Mission 14 gunner prompt; radio lines run alongside combat.
4. When the primaries are done, the helicopter extraction (with the left-behind warning and extraction pressure) ends the mission. `Game.end` → stars (`computeStars`) → `Game.settle` → `economy.settleMission` (XP, Credits, unlocks, KIA, casualty batch, saved once per run id) → Results.

Objectives are small state machines (`pending → active → complete | failed`) with hooks `onStart`, `update`, `afterComplete`, `onEvent`, `finalize`, `hud`, `status`, `point` and `draw`. They never pay rewards.

## Save / load flow

`loadSave` → `parseSave(raw)`: reads `version` (1–9), copies older versions once to a `minisquad.save.pre-*` backup key, rebuilds every field with a `clean*` function (clamps, repairs with notes, never trusts the file), re-derives unlocks from cleared missions, and returns `status` (`new | loaded | migrated | repaired | reset`). `writeSave` serializes roster + account. Optional fields (for example `abilityCapacity`, `account.support`) let new features stay on v9 without a migration. Stable ids are stored, never display names.

## Recipes

**Add a mission** (Mission 15 `last-stand` is the most recent full example; Missions 16+ need new `CHAPTERS` rows):
1. `src/campaign.ts`: a playable row (number, type, objectives, optionals, star rule, unlocks, brief), unlocked by the previous mission's `unlocks.missions`; check `CAPACITY_TABLE` and `CHAPTERS`.
2. `src/map.ts`: `MapDef` plus zones and points; run `tools/maps.cjs` for reachability.
3. `src/missions.ts`: a `MissionScript` (groups, triggers, primaries, optionals, extraction) added to `MISSION_SCRIPTS`.
4. Reuse objectives from `src/objectives.ts`, `src/chapter3.ts`, `src/defense.ts` or `src/escort.ts`. A new mechanic goes in its own module; add a `MissionScript` field and wire it in `Mission.start` / `unitStep` / `update` only if objectives cannot own it.
5. Rendering in `Objective.draw` or the module, HUD via `hud()` lines, chips and meters. New units: team `squad` friendlies go in `Game.allies` or `Game.assets`, never `Game.soldiers`.
6. Save: add the id to the `expected` list passed to `cleanAccount` in `parseSave` (`src/save.ts`) so an older save that already cleared the previous mission opens it without a repair note; check that older fixtures still load unchanged.
7. Tests: extend the chapter suite, run the campaign, save and phone suites (see [SYSTEM_MAP.md](SYSTEM_MAP.md#which-tests-to-run)).

**Add a soldier class** (the Demolitions Expert, v0.8C, is the most recent full example: `grep -n -i demolitions src/*.ts`): `SoldierClassId` + `CLASSES` + `ABILITY_FACTORIES` in `src/classes.ts`; a `CFG.<class>` stats group and ability numbers in `src/config.ts`; an ability extending `BaseAbility` in `src/abilities.ts`; `RECRUIT_CLASSES` (price, refund, unlock flag) and class traits in `src/recruitment.ts` / `src/traits.ts`; unlock via `unlocks.classes` and `CLASS_UNLOCK_TEXT` in `src/campaign.ts`; two specializations in `ELITE_SPECS` / `CLASS_BRANCHES` and level extras in `src/elite.ts`; drawing in `src/render.ts`; sliders in `src/tuning.ts`; save guard for unearned classes in `src/save.ts`; recruit price and dismissal refund in `RECRUIT_CLASSES` (resurrection prices in `src/casualties.ts` are per soldier, not per class); class-specific text in `src/menus.ts` (stat labels, the dismissal refund help line).

**Add a story scene** (v0.8C.1, Mission 15 is the example): lines in `SCENES` (`src/story.ts`; `mode` 'cinematic' blocks, 'radio' does not), cue → scene ids in the mission's `MissionScript.story`, and for a new moment a `StoryCue` plus one `mission.cue(game, key)` call (once per attempt). Comic art later: files in `public/story/`, `portrait` on a line or a speaker; the view falls back to text when an image is missing.

**Add a per-soldier purchase**: optional field on `SoldierIdentity` (`src/classes.ts`), table in `src/progression.ts`, atomic purchase in `src/economy.ts`, clamp it in `mergeSoldier` (`src/save.ts`), UI in `src/menus.ts`. Follow `abilityCapacity` (v0.8B.1).

## Main architectural risk

`Game` is a central hub (≈960 lines) that every system reads and mutates, and mission mechanics are spread across several files: a new mechanic usually touches its module, `MissionScript` (`src/mission.ts`), `Mission.start` / `update`, `Game.update` (movement, collision, weapons), `Game.damage`, `src/render.ts` and `src/hud.ts`. Missions 13–14 show the cost (assets, gates, modal gunner selection, truck collision rules across `src/escort.ts`, `src/squad.ts` and `src/game.ts`). Keep new mechanics in their own module, prefer the `Objective` hooks and `MissionEvent`s over new `Game` fields, and add a line to [SYSTEM_MAP.md](SYSTEM_MAP.md) for every new cross-file touchpoint. A structural improvement is planned as a separate Phase 3; do not refactor during feature work.

## Tests and fixtures

No unit-test framework. Each `tools/*.cjs` is a standalone Node script that launches headless Chromium (Playwright from `/opt/node22/lib/node_modules/playwright`; `tools/lib.cjs` also accepts `PLAYWRIGHT_PATH` or a local install), opens a served build and drives `window.game` and the `__*` hooks with fixed 1/60 s steps. Rule suites print one `PASS  name  detail` / `FAIL  ...` line per check and exit 1 on any failure; sims and perf tools print reports. Environment variables: `URL` (default `http://localhost:4173/`), `BASE` (a second served build to compare against), `OUT` (screenshots), plus per-tool ones (`QUICK`, `THROTTLE`, `MISSIONS`). Save fixtures from real older builds are in `tools/fixtures/` (v0.2.2 → v0.7C) and `tools/fixtures-v08b/`.

**Runner** (`npm test` → `tools/test.cjs`, Phase 2):
- `tools/test-suites.cjs` is the registry: every script with its kind (`rules` / `report` / `screens` / `legacy`), its `BASE` build and whether it writes screenshots by default, plus the groups. A new suite needs a row there (`--list` names unregistered scripts) and in SYSTEM_MAP.
- Setup: `npm run build`, then an in-process static server for `dist/` on a free 127.0.0.1 port (no `vite preview`, no fixed port). Suites with a `base` get the previous gameplay release (`PREV` in the registry) built once from `git archive` into `node_modules/.cache/minisquad-tests/base-<sha>/` and served on another port. `--base none|<ref>|<url>` and `--url` override.
- Suites run one at a time (parallel load caused `elite` / `progression` flakes) as detached child processes; the runner kills the whole process group (the suite's Chromium included) after each suite, on timeout (20 min rules, 90 min reports) and on Ctrl-C, and closes only the servers it started.
- Status: a migrated suite prints `##minisquad-result {"checks":N,"failed":F,"errors":E}` (`tools/lib.cjs` `createChecks().finish()`), which the runner cross-checks with the PASS/FAIL lines; unmigrated suites are counted from those lines. Exit 0 with no checks, exit 0 with FAIL lines, or exit 1 with none, is ERROR, never PASS. Reports and screenshot scripts are DONE / ERROR by exit code only.
- Output: one line per suite plus FAIL lines on failure; full logs, `summary.json` and screenshots in `test-results/<run>/` (last 10 runs kept, gitignored). `-v` streams everything; `--json <file>` copies the summary.
- Shared helpers (`tools/lib.cjs`): `createChecks`, `runSuite` (a throw exits 2 = crash), `serveDir`, `loadPlaywright`. Migrated so far: `maps`, `barracks`, `recruit-mobile`; new suites should use it.
