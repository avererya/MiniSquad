# MiniSquad system map

Feature → files → tests, for finding where to work without reading the repository. All paths are relative to the repo root and were checked against v0.8B.1 (`601dbc2`). For how the pieces fit together see [ARCHITECTURE.md](ARCHITECTURE.md); for the rules and numbers players see, the [README](../README.md).

How to use it: find the row, open the main file, then `grep -n` the named symbol instead of reading the whole file. Every number lives in `src/config.ts` (`CFG.<group>`) unless a row says otherwise. Tests are `tools/<name>.cjs`, run with `npm test -- <name>` (see [Which tests to run](#which-tests-to-run)).

## Combat and projectiles

| | |
|---|---|
| Main | `src/combat.ts` (`updateWeapon`, `updateOffhand`, `updateEnemySniper`, `updateProjectiles`, `explode`, `modifyDamage`); `Game.damage` in `src/game.ts` |
| Supporting | `src/config.ts` (class groups `CFG.infantry/heavy/medic/sniper/commando`, enemies `CFG.enemy/enemySniper/armored/tower/boss`), `src/targeting.ts`, `src/classes.ts` (`effectiveStats`), `src/elite.ts` (`onFire`, `onHit`, `incomingMul`, caps), `src/world.ts` (line of sight, walls) |
| Tests | `logic` (projectile speeds, spread, walls, damage stats), `accuracy` (spread floor), `balance` (`MODE=accuracy` hit-rate experiments, report only), `elite` (passive damage), `squads` (damage ledger, report) |
| Watch | All damage must go through `Game.damage` (Elite caps ≤40% reduction / ≤×2 per shot, support floors, awareness, stats). Rounds are not led (target leading is an open design item). |

Player Sniper damage: `CFG.sniper` (`damage`, `fireRate`, `aimTime`…). Enemy Sniper damage: `CFG.enemySniper` (`damage`, `projectileSpeed`, `aimTime`, `lockTime`), fired in `updateEnemySniper`, laser telegraph drawn in `src/render.ts` (grep `enemySniper`), standoff in `src/awareness.ts`. Tests: `chapter2` (aim, lock, shot, cover), `chapter2-mobile` (laser on phones).

## Enemy AI and awareness

| | |
|---|---|
| Main | `src/enemy.ts` (`updateEnemyMovement`: flow-field pursuit, temperaments, guards), `src/awareness.ts` (`raiseAlert`, `alertUnit`, `alertSteer`) |
| Supporting | `src/targeting.ts` (`NearestVisible`, `SniperTargeting`, `ExposedTargeting`, `VehicleHunterTargeting`, `RoadblockTargeting`, `SiegeTargeting`), `src/world.ts` (`computeFlow`), `src/boss.ts` (Iron Warden), `src/convoy.ts` (trucks + escorts), `src/unit.ts` (`EnemyKind`), `CFG.awareness` |
| Tests | `chapter3a` A (awareness), `chapter2` (sniper, armored, tower, boss), `logic` (rifleman spread), `perf` (flow-field cost) |
| Watch | Awareness is event-driven and bounded (no rebroadcast, no per-frame scans, no `Math.random`). Only searchlights raise the artillery alert (`src/artillery.ts`). |

## Squad movement and collisions

| | |
|---|---|
| Main | `src/squad.ts` (`updateSquad`, `ringAngles` escort ring, `updateEscort`, `updateAllies`), collision block in `Game.update` (`src/game.ts`) |
| Supporting | `src/world.ts` (nav grid, A*, `resolveCircle`), `src/input.ts` (joystick), `src/escort.ts` (`makeWay`, `clearOf`, `around`, `sweep`, `pinned`), `pushOut` at the bottom of `src/game.ts` (assets push bodies out), `CFG.squad` |
| Tests | `logic` (no snapping, mixed-speed squads), `v081-collision` (12 truck stress scenarios), `chapter2` (hostage ring), `chapter3b` A (six-soldier spacing), `touch`, `mobile` (joystick) |
| Watch | Nobody is ever teleported; the truck never moves through a friendly. Allies, NPCs and assets are not in `Game.soldiers`. |

## Recruitment and roster

| | |
|---|---|
| Main | `src/recruitment.ts` (classes, prices, refunds, trait pool, starting levels, names, candidate generation), `src/roster.ts` (`Roster`, squad selection) |
| Supporting | `src/economy.ts` (`recruit`, `recruitNamed`, `refreshOffers`, `dismiss`, `rename`), `src/campaign.ts` (`NAMED_RECRUITS`, `STARTING_SOLDIERS`), `src/menus.ts` (Barracks RECRUIT tab), `src/progression.ts` (`RecruitmentState`, `ROSTER_CAP` 12) |
| Tests | `recruitment`, `recruit-mobile`, `failure-recruit` (named recruits), `failure-recruit-mobile`, `barracks` |
| Watch | Transactions are atomic with rollback; names are unique against the used-name registry; class pools follow campaign flags, not roster contents. |

## Classes and abilities

| | |
|---|---|
| Main | `src/classes.ts` (`SoldierClassId`, `CLASSES`, `ABILITY_FACTORIES`, `effectiveStats`), `src/abilities.ts` (`BaseAbility`, `activateAbility`, `resetCharges`, each ability) |
| Supporting | `src/config.ts` (class stats, `CFG.grenade/suppressive/fieldTreatment/focus/bulletStorm`), `src/traits.ts`, `src/recruitment.ts` (`RECRUIT_CLASSES`, `RECRUIT_TRAITS`), `src/elite.ts` (`CLASS_BRANCHES`), `src/campaign.ts` (`CLASS_UNLOCK_TEXT`), `src/render.ts` (class visuals), `src/hud.ts` (portrait buttons), `src/tuning.ts` (sliders), `src/save.ts` (unearned-class guard) |
| Tests | `logic` (Grenade, Suppressive, Field Treatment, traits), `chapter2` (Sniper, Focus), `chapter3a` (Commando, Bullet Storm), `v081` (Ability Capacity), `classes` / `lineup` (screenshots only) |
| Watch | A new class touches ~12 files; follow the Commando (`grep -n -i commando src/*.ts`) and the recipe in [ARCHITECTURE.md](ARCHITECTURE.md#recipes). |

**Ability Capacity** (uses per mission): tables `ABILITY_CAPACITY`, `abilityUses` in `src/progression.ts`; charges in `src/abilities.ts`; purchase `buyAbilityCapacity` in `src/economy.ts`; save clamp in `mergeSoldier` (`src/save.ts`); HUD counter in `src/hud.ts`; Training row in `src/menus.ts`. Tests: `v081` (rules, HUD, keys, saves), `v081-e2e` (bought through the UI), `training-rebalance` F (row fits), `mobile` (NO USES LEFT), `progression` (13 Training controls).

## Training and Elite progression

| | |
|---|---|
| Main | `src/progression.ts` (XP curve, `missionXp`, `TRAINING`, `SQUAD_BONUS` / `SQUAD_TRAINING`, `rankBonus`, `softFloor`), `src/elite.ts` (`ELITE_SPECS`, `ELITE_PROGRESSION`, passives, `promotionReady`) |
| Supporting | `src/economy.ts` (`buyTraining`, `buySquadTraining`, `promote`, Elite XP in `settleMission`), `src/classes.ts` (`ProgressionRecord`, `effectiveStats` pipeline), `CFG.elite`, `src/menus.ts` (Training / Squad Training tabs, promotion, ceremony), `src/render.ts` (Elite looks) |
| Tests | `progression`, `progression-balance` (report), `training-rebalance`, `squad-training`, `accuracy`, `elite`, `elite-progression` |
| Watch | No rank may become weaker than in an earlier release; prices and Squad Training tables are locked. Elite 1 equals Recruit 25. Promotion ledger `account.promotions` is the source of truth. |

## Permanent death and resurrection

| | |
|---|---|
| Main | `src/casualties.ts` (resurrection prices, decision rules, Operation Phoenix), `src/economy.ts` (`settleMission`, `journalKia`, `recoverInterruptedRun`, `resurrect`, `memorialize`, `enlistPhoenix`) |
| Supporting | `src/game.ts` (`updateDowned`, `downSoldier`, `kia`, `downedFallOnFailure`), `src/mission.ts` (extraction attempt, left-behind warning), `src/clock.ts`, `src/menus.ts` (decisions, Memorial) |
| Tests | `permadeath`, `permadeath-mobile`, `failure-recruit` (failed missions), `logic` (bleed-out, revive) |
| Watch | Bleed-out is 20 s of simulation time; only a valid revive pauses it. A failed mission makes downed soldiers KIA. Settlement happens once per run id. |

## Campaign progression

| | |
|---|---|
| Main | `src/campaign.ts` (`CAMPAIGN`, `CHAPTERS`, `CAPACITY_TABLE`, `computeStars`, `unlocks`, `derived*Unlocks`) |
| Supporting | `src/economy.ts` (`settleMission` applies unlocks), `src/progression.ts` (`CampaignProgress`, `MissionRecord`), `src/save.ts` (re-derives unlocks), `src/menus.ts` (Campaign screen, chapter tabs, briefings) |
| Tests | `campaign-rules`, `campaign` (autopilot report), `chapter2`, `chapter3a`, `chapter3b`, `barracks` |
| Watch | Missions are never unlocked without the previous clear; stars never go down; `mission-15` is a non-playable placeholder row. |

## Missions and objectives

| | |
|---|---|
| Main | `src/missions.ts` (one `MissionScript` per mission: `FIRST_CONTACT` … `SUPPLY_LINE`, `MISSION_SCRIPTS`), `src/mission.ts` (`Mission`, `MissionScript` fields, extraction, `pressureGroups`), `src/objectives.ts` (base `Objective`, reusable objectives, `MissionEvent`) |
| Supporting | `src/map.ts` (maps, zones), `src/chapter3.ts` (M11–12), `src/artillery.ts` (M12), `src/convoy.ts` (M8), `src/boss.ts` (M10), `CFG.mission`, `CFG.extractionPressure` |
| Tests | `maps` (reachability on every map), chapter suites (`chapter2`, `chapter3a`, `chapter3b`, `v081`), sims (`chapter2-sim`, `chapter3b-sim`, `v081-sim`, reports only), `play` |
| Watch | Objectives never pay rewards; a mission has a scripted final wave or extraction pressure, never both. |

## Escort / truck mechanics (Mission 14)

| | |
|---|---|
| Main | `src/escort.ts` (`EscortVehicle`, `MountedGun`, `CaptureVehicleObjective`, `ProgressAmbushes`, `EscortObjective`, `CountDestroyObjective`) |
| Supporting | `src/missions.ts` (`SUPPLY_LINE`, `SUPPLY_AMBUSHES`), `src/map.ts` (`SUPPLY_ROUTE`, `SUPPLY_ROUTE_V08B`, `SUPPLY_DEPOTS`), `src/game.ts` (gunner modal `openGunnerSelect` / `chooseGunner`, `pushOut`, pinned check, ceasefire), `src/squad.ts`, `src/targeting.ts` (`RoadblockTargeting`, `VehicleHunterTargeting`), `src/render.ts` (`drawEscortTruck`), `src/hud.ts`, `CFG.escortTruck` / `CFG.mountedGun` |
| Tests | `chapter3b` C, `v081` (route, Ambushes 4–5), `v081-collision`, `v081-e2e`, `v081-sim` (report), `perf-lib` (answers the gunner selection) |
| Watch | `chapter3b-e2e` is superseded since v0.8B.1 (its autopilot loses the harder missions). Mission 5/7 captive escort is a different system (`updateEscort`, `FreeCaptiveObjective`). Planned: hide the route-progress indicator (not implemented). |

## Defense / wave mechanics (Missions 11 and 13)

| | |
|---|---|
| Main | `src/defense.ts` (`PrepareDefenseObjective`, `WaveController`, `WaveDefenseObjective`, `AssetHpOptional`, `siegeAnswer`), `src/chapter3.ts` (`SafehouseDefenseObjective`, M11) |
| Supporting | `src/missions.ts` (`HOLD_THE_LINE`, `HOLD_WAVES`, `HOLD_CACHE_DEFS`), `src/map.ts` (`HOLD_*`, `HOLD_GATED_MAP`), `src/mission.ts` (`closeGates`, `flowExtra`), `src/game.ts` (`assets`, `spawnAsset`), `src/unit.ts` (`asset`), `src/targeting.ts` (`SiegeTargeting`), `CFG.defense/turret/commandCenter/resistance` |
| Tests | `chapter3b` B, `v081` (wave sizes, timing, siege share), `chapter3a` (M11 safehouse), `chapter3b-sim` / `v081-sim` (reports) |
| Watch | Enemy budgets are finite (M13 ≤ 79); waves start once each, start to start. Assets are never soldiers and never repaired. |

## Tactical Support

| | |
|---|---|
| Main | `src/support.ts` (`Support`, `supportDamageFor`, `supportRoom`, `airstrikeImpact`, `nukeDetonate`, `SUPPORT_ITEMS`) |
| Supporting | `src/game.ts` (`useAirstrike`, `launchNuke`…, `Game.damage` `opts.support`), `src/input.ts` (aiming), `src/hud.ts`, `src/render.ts` (`drawSupportGround`, `drawSupportScreen`), `src/economy.ts` (`buySupport`), `src/save.ts` (`cleanSupport`), `CFG.airstrike/nuke/support` |
| Tests | `support`, `chapter3b` A (six-Elite support) |
| Watch | Support never takes a boss below 10% or an objective below 1 HP; a launched nuke is spent and saved before the countdown. |

## Save / load and fixtures

| | |
|---|---|
| Main | `src/save.ts` (`SAVE_VERSION` 9, `parseSave`, `mergeSoldier`, `clean*`, backup keys, `resetSave`) |
| Supporting | `src/progression.ts` (`AccountData` and sub-types), `src/classes.ts` (`SoldierIdentity`, `ProgressionRecord`), `src/main.ts` (migration notices), `tools/fixtures/*.json` (real saves v0.2.2 → v0.7C), `tools/fixtures-v08b/v0.8B-m12-cleared.json` |
| Tests | `barracks` (invalid save recovery), `progression` (v2 migration), `permadeath` (v5), `failure-recruit` (v6), `chapter2` (v7), `elite` (v8), `elite-progression` (v9), `support`, `squad-training`, `chapter3a`, `chapter3b`, `v081`, `v081-e2e` |
| Watch | Prefer optional fields over a version bump; every fixture must load unchanged; store stable ids; paid items need a ledger and a repair rule. |

## HUD and mobile UI

| | |
|---|---|
| Main | `src/hud.ts` (in-mission DOM HUD, portraits, chips, meters, support buttons, extraction warning), `src/menus.ts` (all screens), `src/style.css` |
| Supporting | `src/main.ts` (`resize`, safe areas, `--t44`), `src/input.ts`, `src/tuning.ts` (⚙ panel, sliders, debug), `src/version.ts` (label + commit in Settings) |
| Tests | `mobile`, `chapter2-mobile`, `permadeath-mobile`, `failure-recruit-mobile`, `recruit-mobile`, `touch`, plus phone sections in `chapter3a`, `chapter3b`, `squad-training`, `progression` |
| Watch | Landscape on iPhone SE (667×375), iPhone 14 (844×390), Pixel 7 (915×412); touch targets ≥ 44 CSS px via `var(--t44)`; joystick zone (left half) stays free. Planned: hide player-facing damage/HP sliders in `src/tuning.ts` while keeping developer tuning (not implemented). |

## Rendering and performance

| | |
|---|---|
| Main | `src/render.ts` (`render`, ground strips, units, effects), `src/perf.ts` (`FramePacer`, `perfSettings`, `DEFAULT_FPS_CAP`), `src/clock.ts` (`SimClock`) |
| Supporting | `src/perfoverlay.ts` (`?perf=1`), `src/world.ts` (flow-field cost), `src/hud.ts` (skip unchanged writes) |
| Tests | `fps-parity` (30/60 FPS identical; `BASE=` compares builds), `fps-default`, `perf` (headless profile), `shot` / `visual` / `fight` (screenshots) |
| Watch | Headless numbers are not phone measurements. Mission 14's 6,300×2,000 ground is kept as 2,048 px strips. Never render hundreds of frames in one synchronous `page.evaluate`. |

## Test infrastructure

| | |
|---|---|
| Main | `tools/test.cjs` (`npm test`: args, build, serve, baselines, run, classify, summary), `tools/test-suites.cjs` (suite registry, groups, `PREV` baseline) |
| Supporting | `tools/lib.cjs` (`createChecks`, `runSuite`, `serveDir`, `loadPlaywright`, result line), `.gitignore` (`test-results/`), `package.json` `test` script |
| Tests | the runner itself: `npm test -- --help`, `--list`, an unknown name (exit 2), `maps barracks recruit-mobile` (migrated suites) |
| Watch | Register every new `tools/*.cjs` in `test-suites.cjs`. Never count a suite as PASS without checks; keep suites runnable standalone (`node tools/<suite>.cjs`). |

## Which tests to run

`npm test -- <group|suite>...` builds, serves and runs them (see [CLAUDE.md](../CLAUDE.md#tests)); `npm test -- --list` prints this table from `tools/test-suites.cjs`. Suite names in the rows above are runnable directly (`npm test -- chapter2`).

| Group | Suites | Use for |
|---|---|---|
| `smoke` (bare `npm test`) | `logic`, `maps`, `campaign-rules`, `barracks` | quick check while working |
| `combat` | `logic`, `accuracy`, `elite`, `support` | weapons, damage, classes, Tactical Support |
| `movement` | `logic`, `v081-collision`, `mobile` | squad movement, collisions, joystick |
| `recruitment` | `recruitment`, `recruit-mobile`, `failure-recruit`, `failure-recruit-mobile`, `barracks` | Recruitment Office, roster |
| `progression` | `progression`, `training-rebalance`, `squad-training`, `accuracy`, `elite`, `elite-progression` | XP, training, Elite |
| `permadeath` | `permadeath`, `permadeath-mobile`, `failure-recruit` | KIA, resurrection, failed missions |
| `missions` | `maps`, `campaign-rules`, `chapter2`, `chapter3a`, `chapter3b`, `v081`, `v081-collision`, `v081-e2e` | missions, campaign, escort, defense |
| `persistence` | `barracks`, `progression`, `permadeath`, `recruitment`, `failure-recruit`, `elite`, `elite-progression`, `support`, `v081-e2e` | saves, fixtures, economy |
| `ui` | `mobile`, `chapter2-mobile`, `permadeath-mobile`, `failure-recruit-mobile`, `recruit-mobile` | HUD, menus, phone layouts |
| `fps` | `fps-default`, `fps-parity` | frame cap, 30 / 60 FPS parity |
| `all` | every rule suite (27) | full regression before a release |
| `reports` | `campaign`, `balance`, `progression-balance`, `squads`, `chapter2-sim`, `chapter3b-sim`, `v081-sim`, `perf` | balance / perf numbers (slow, no PASS/FAIL) |
| `screens` | `shot`, `visual`, `fight`, `classes`, `lineup`, `touch`, `play` | screenshots judged by eye |

| Change | Run at least |
|---|---|
| Any gameplay change | `npm test -- <feature group> logic fps-parity` |
| Combat numbers / classes | `combat progression` + the chapter suite that uses the class |
| Missions / campaign | `missions` |
| Saves / economy | `persistence` |
| HUD / menus / layout | `ui` |
| Release | `all` |

**BASE**: `accuracy`, `elite-progression`, `support`, `squad-training`, `training-rebalance`, `v081`, `v081-collision` compare against the previous gameplay release, v0.8B (`c3cae3d`, `PREV` in `tools/test-suites.cjs`), which the runner builds and serves automatically; `accuracy` and `support` fail without it. Move `PREV` forward when a release ships. `fps-parity` takes an optional `BASE` (`--base <ref>`; it differs from older builds by design). Manual: `npx vite preview --port 4174 --outDir <older dist>` and `BASE=http://localhost:4174/ node tools/<name>.cjs`.

Known failures and test notes: [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md#test-status). `maps` only covers the Mission 1–10 maps; `chapter3b-e2e` is superseded (run by name only).

**Coverage gaps** (no direct suite): `src/audio.ts`; rendering correctness (screenshots only, judged by eye); Mission 5/7 captive escort beyond the `chapter2` / `logic` checks; the truck back-up rescue (`pinBackAfter` / `pinBackMax`, never triggered in sims); real-device performance.

## Questions this map answers

- **Sniper damage**: player `CFG.sniper.damage`, enemy `CFG.enemySniper.damage` (and `projectileSpeed`, `aimTime`, `lockTime`) in `src/config.ts`; enemy shot in `updateEnemySniper` (`src/combat.ts`). Run `chapter2` (enemy Sniper aim / lock / shot), `chapter2-mobile` (laser), `chapter3a` (sniper standoff), `chapter3b`, `v081`, `fps-parity`, plus `chapter3b-sim` / `v081-sim` for balance. `support` with `BASE=` compares enemy config against the base build, so an intended change shows up there as an expected difference.
- **Mission 14 escort**: `src/escort.ts` + `SUPPLY_LINE` / `SUPPLY_AMBUSHES` (`src/missions.ts`) + `SUPPLY_ROUTE` (`src/map.ts`); tests in the escort table above.
- **New soldier class**: classes table above and the recipe in [ARCHITECTURE.md](ARCHITECTURE.md#recipes).
- **Ability Capacity tests**: `v081`, `v081-e2e`, `training-rebalance` F, `mobile`, `progression`.
- **Save migrations**: `parseSave` in `src/save.ts` (version flags `v5`…`v8`, `clean*`, backups).
- **Adding Mission 15**: campaign row (`mission-15` in `src/campaign.ts`), map, script, objectives (likely `src/defense.ts` patterns for a last stand), `expected` ids in `parseSave`, chapter suite, `campaign-rules` (chapter star totals), `maps`, `fps-parity`.
