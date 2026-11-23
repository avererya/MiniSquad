# MiniSquad system map

Feature → files → tests, for finding where to work without reading the repository. All paths are relative to the repo root and were checked against v0.8B.1 (`601dbc2`); v0.8B.2 changes are noted in their rows. For how the pieces fit together see [ARCHITECTURE.md](ARCHITECTURE.md); for the rules and numbers players see, the [README](../README.md).

How to use it: find the row, open the main file, then `grep -n` the named symbol instead of reading the whole file. Every number lives in `src/config.ts` (`CFG.<group>`) unless a row says otherwise. Tests are `tools/<name>.cjs`, run with `npm test -- <name>` (see [Which tests to run](#which-tests-to-run)).

## Combat and projectiles

| | |
|---|---|
| Main | `src/combat.ts` (`updateWeapon`, `updateOffhand`, `updateEnemySniper`, `updateProjectiles`, `explode`, `blastDamage` (Phase 3 shared area damage), `modifyDamage`); `Game.damage` in `src/game.ts` |
| Supporting | `src/config.ts` (class groups `CFG.infantry/heavy/medic/sniper/commando`, enemies `CFG.enemy/enemySniper/armored/tower/boss`), `src/targeting.ts`, `src/classes.ts` (`effectiveStats`), `src/elite.ts` (`onFire`, `onHit`, `incomingMul`, caps), `src/world.ts` (line of sight, walls) |
| Tests | `logic` (projectile speeds, spread, walls, damage stats), `accuracy` (spread floor), `balance` (`MODE=accuracy` hit-rate experiments, report only), `elite` (passive damage), `squads` (damage ledger, report) |
| Watch | All damage must go through `Game.damage` (Elite caps ≤40% reduction / ≤×2 per shot, support floors, awareness, stats). Rounds are not led (target leading is an open design item). |

Player Sniper damage: `CFG.sniper` (`damage`, `fireRate`, `aimTime`…). Enemy Sniper damage: `CFG.enemySniper` (`damage`, `projectileSpeed`, `aimTime`, `lockTime`), fired in `updateEnemySniper`, laser telegraph drawn in `src/render.ts` (grep `enemySniper`), standoff in `src/awareness.ts`. Tests: `chapter2` (aim, lock, shot, cover), `chapter2-mobile` (laser on phones), `v082` A (v0.8B.2: 65 damage, 935 px/s, two-hit lethality, cadence, dodge window per range, Elite mitigation, friendly Sniper unchanged).

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
| Main | `src/squad.ts` (`updateSquad`, v0.9D.1 march formation `marchSlots` / `ROLE_RANK` / `MARCH_TEMPLATES` with `Game.march` (`newMarch`, reset per mission), `ringAngles` escort ring, `updateEscort`, `updateAllies`), collision block in `Game.update` (`src/game.ts`) |
| Supporting | `src/world.ts` (nav grid, A*, `resolveCircle`), `src/input.ts` (joystick), `src/escort.ts` (`makeWay`, `clearOf`, `around`, `sweep`, `pinned`), `pushOut` at the bottom of `src/game.ts` (assets push bodies out), `CFG.squad`, `CFG.formation` (turn hysteresis, rotation rate, march catch-up) |
| Tests | `v09d1` D (role order per direction, hysteresis, stable slots, 1-6 soldiers, route walks and mined trails vs v0.9D), `logic` (no snapping, mixed-speed squads), `v081-collision` (12 truck stress scenarios), `chapter2` (hostage ring), `chapter3b` A (six-soldier spacing), `touch`, `mobile` (joystick) |
| Watch | The march offset is only the default goal: escort ring, revive assist, truck `makeWay` / `clearOf` and `clearGoal` still override it. Nobody is ever teleported; the truck never moves through a friendly. Allies, NPCs and assets are not in `Game.soldiers`. |

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
| Tests | `logic` (Grenade, Suppressive, Field Treatment, traits), `chapter2` (Sniper, Focus), `chapter3a` (Commando, Bullet Storm), `v08c` E (Demolitions Expert, rocket, Inferno, Siege Breaker / Pyrotechnic), `v081` (Ability Capacity), `classes` / `lineup` (screenshots only) |
| Watch | A new class touches ~12 files; follow the Commando (`grep -n -i commando src/*.ts`) and the recipe in [ARCHITECTURE.md](ARCHITECTURE.md#recipes). |

**Demolitions Expert** (v0.8C, `grep -n -i 'demolitions\|inferno\|rocket' src/*.ts`): class row in `src/classes.ts` / `CFG.demolitions`; rocket impact and splash `rocketImpact` / `rocketMul` / `rocketRadius` in `src/combat.ts` (`CFG.rocket`); `InfernoAbility` and the afterburn `updateBurns` in `src/abilities.ts` (`CFG.inferno`); Siege Breaker / Pyrotechnic in `src/elite.ts`; recruit pool, price 1,500 / refund 350 and the guaranteed introduction in `src/recruitment.ts`; unlock by the first clear of Mission 15 (`src/campaign.ts`); unearned-class guard in `src/save.ts`; flames / rocket / burn drawing in `src/render.ts` (`drawFlames`). Tests: `v08c` E.

**Ability Capacity** (uses per mission): tables `ABILITY_CAPACITY`, `abilityUses` in `src/progression.ts`; charges in `src/abilities.ts`; purchase `buyAbilityCapacity` in `src/economy.ts`; save clamp in `mergeSoldier` (`src/save.ts`); HUD counter in `src/hud.ts`; Training row in `src/menus.ts`. Tests: `v081` (rules, HUD, keys, saves), `v081-e2e` (bought through the UI), `training-rebalance` F (row fits), `mobile` (NO USES LEFT), `progression` (13 Training controls).

## Training and Elite progression

| | |
|---|---|
| Main | `src/progression.ts` (XP curve, `missionXp`, mission rewards `computeMissionRewards` / `victoryCredits` (v0.9D.2 Credits by mission number, `PROGRESSION.credits.perMission`), `TRAINING`, `SQUAD_BONUS` / `SQUAD_TRAINING`, `rankBonus`, `softFloor`), `src/elite.ts` (`ELITE_SPECS`, `ELITE_PROGRESSION`, passives, `promotionReady`) |
| Supporting | `src/economy.ts` (`buyTraining`, `buySquadTraining`, `promote`, Elite XP in `settleMission`), `src/classes.ts` (`ProgressionRecord`, `effectiveStats` pipeline), `CFG.elite`, `src/menus.ts` (Training / Squad Training tabs, promotion, ceremony), `src/render.ts` (Elite looks) |
| Tests | `progression`, `progression-balance` (report), `training-rebalance`, `squad-training`, `accuracy`, `elite`, `elite-progression`, `v09d2` (Credit scaling: formula, bonus lines, first-time bonus once, failures 0, XP / prices unchanged, a real Mission 20 end, fixtures) |
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
| Watch | Missions are never unlocked without the previous clear; stars never go down. Mission 15 (`last-stand`, v0.8C) is the last mission: no Chapter 4 rows exist yet. |

## Missions and objectives

| | |
|---|---|
| Main | `src/missions.ts` (one `MissionScript` per mission: `FIRST_CONTACT` … `SUPPLY_LINE`, `MISSION_SCRIPTS`), `src/mission.ts` (`Mission`, `MissionScript` fields, extraction, `pressureGroups`), `src/objectives.ts` (base `Objective`, reusable objectives, `MissionEvent`) |
| Supporting | `src/map.ts` (maps, zones), `src/chapter3.ts` (M11–12), `src/artillery.ts` (M12), `src/convoy.ts` (M8), `src/boss.ts` (M10), `CFG.mission`, `CFG.extractionPressure` |
| Tests | `maps` (reachability on every map), chapter suites (`chapter2`, `chapter3a`, `chapter3b`, `v081`, `v08c`), sims (`chapter2-sim`, `chapter3b-sim`, `v081-sim`, `v08c-sim`, reports only), `play` |
| Watch | Objectives never pay rewards; a mission has a scripted final wave or extraction pressure, never both. |

## Extension points for Chapters 4–5 (Phase 3)

| | |
|---|---|
| Main | `src/mission.ts` (`MissionMechanic`: `start` / `step` / `onEvent` / `draw` / `tap` (v0.9A); `MissionScript.mechanics`; `Mission.mechanics`, `Mission.mechanic(id)`), `src/combat.ts` (`blastDamage`, `BlastSpec`) |
| Supporting | `src/main.ts` (`window.__missions`, `window.__combat` for tests), `tools/lib.cjs` (`openPage`, `seedRandom`, `installPageHelpers` → `window.T`, `missionSnapshot`), recipes in [ARCHITECTURE.md](ARCHITECTURE.md#recipes) (mission mechanic, area damage, enemy kind, mission suite) |
| Tests | `arch` (hooks, blast, helpers; Missions 1–15 data and a seeded grenade / rocket firefight identical to v0.8C.1), `fps-parity` (`MISSIONS=` every mission with `--base 924dc13` = bit-identical to v0.8C.1) |
| Watch | Missions 1–15 declare no mechanics; their convoy / boss / general / artillery / escort stay hard-wired. Mechanic hooks run in the fixed step only and stop when the mission ends. `blastDamage` draws nothing (callers own their effects) and keeps the grenade / rocket arithmetic order. |

Chapter 4–5 feature → where it plugs in: **land mines** done in v0.9A (`src/mines.ts`, table below; reuse with `mechanics: () => [new MineField({ mines })]`); **fuel tanks** done in v0.9B (`src/fuel.ts`, `new FuelDepot({ tanks })`); **urban ambushes, rooftop snipers, supply caches** done in v0.9B (`src/urban.ts`, `new AmbushDirector(defs)`, `new SupplyCaches(defs)`; the streets are map data: `building` obstacles, `roof` perches); **Scouts / Engineers / armored vehicles** a new `EnemyKind` (recipe), Engineer repairs and vehicle patrols steered by a mechanic; **prisoner rescue (19)** `FreeCaptiveObjective` patterns; **chapter boss (20)** follow `src/general.ts` (a boss bar branch in `src/hud.ts`).

## Land mines and Mission 16 (v0.9A)

| | |
|---|---|
| Main | `src/mines.ts` (`MineField` mechanic, id `mines`: `Mine` states hidden / revealed / detonated, `step` order fuses → reveal → triggers → order expiry → warn cue, `reveal` (a `'mine'` structure unit in `Game.enemies`), `detonate` (`blastDamage` both teams, cover, chains), `onEvent` (`structureDestroyed` → fuse 0), `tap` / `orderMine` / `clearOrder` (`Unit.order`), `draw`, `MineLog`), `src/chapter4.ts` (`MineKillsOptional`) |
| Supporting | `CFG.mine` (`src/config.ts`), `src/unit.ts` (`Unit.order`, `isMine`), `src/combat.ts` (`updateWeapon`: a valid `order` wins, a mine is dropped as an automatic target; `updateProjectiles`: rounds pass over a mine unless it is the shooter's target), `src/game.ts` (mines left out of every squad / ally / turret candidate list and the push-out loop; `onTap`), `src/input.ts` (`onTap`: plain tap / click, `TAP_SLOP` 18, `TAP_TIME` 0.35 s, a quick tap on the joystick half), `src/mission.ts` (`MissionMechanic.tap`, `Mission.tap`, `GroupSpec.hold`, cue `start:<objective id>`), `src/render.ts` (mines skip the depth pass and HP bars; `drawCanopy` for 'tree' obstacles, the jungle theme), `src/map.ts` (`Tr`, `jungleCanopy`, `inOpen`, `JUNGLE_*`), `src/missions.ts` (`JUNGLE_SWEEP`), `src/campaign.ts` (`jungle-sweep` row, Chapter 4, `minefield` type), `src/story.ts` (`m16-mines`, `m16-checkpoint`, `m16-extract`), `src/save.ts` (`expected` id) |
| Tests | `v09a` (A–K: campaign / unlock, map safety, states, triggers, blast, tap orders by `Game.onTap` / mouse / touch, chains, flow, rewards, Retry / reload, fixtures, Missions 1–15 vs v0.8C.1, phones), `fps-parity` (`jungle-sweep`, `jungle-sweep@field`: the pilot taps revealed mines), `v09a-sim` (report: SCEN, RUNS, POLICY aware / naive, LEVEL) |
| Watch | A revealed mine is an enemy-team structure but must never be an automatic target: any new candidate list (a new turret, ally, ability) has to filter `isMine`. Mines trigger on centres within `triggerRadius`; nothing paths around them (by design). Chains light a fuse once per mine; a fuse lit in a step starts counting next step. `fx.text` draws `Math.random`, so mine labels push `fx.texts` directly. v0.9B: Tactical Support sets mines off through `MissionMechanic.supportStrike` (airstrike: armed mines in the circle, nuke: all), and hazards (`isHazard`: mines, fuel tanks) get no objective floor in `supportDamageFor`. |

## Fuel tanks and Mission 17 (v0.9B)

| | |
|---|---|
| Main | `src/fuel.ts` (`FuelDepot` mechanic, id `fuel`: `FuelTank` states intact / burning / exploded, `start` spawns a `'fuel'` structure unit per tank into `Game.enemies`, `step` fuses → explode → order expiry → warn cue, `ignite` (once), `explode` (two `blastDamage` calls: enemies credited to the soldier who set it off, the squad side with no source; cover; chains to intact tanks within `chainRadius` in sight), `onEvent` (`structureDestroyed` → fuse 0 with `Unit.lastHitBy`), `supportStrike`, `tap` / `orderTank` / `clearOrder`, `draw`, `FuelLog`; `fuelSafe`, `drawFuelTank`), `src/chapter4.ts` (`FuelInstallationsObjective`, `FuelKillsOptional`, `ResponseObjective` / `ResponseWave`, `safeSpawnPoint` / `spawnSafe`) |
| Supporting | `CFG.fuel` (`src/config.ts`), `src/unit.ts` (`isHazard`, `radiusOverride`, `lastHitBy`), `src/game.ts` (`damage` records `lastHitBy` on structures; tanks join the automatic candidate lists only while `fuelSafe`), `src/combat.ts` (`updateWeapon` drops an unsafe hazard target, `updateProjectiles` lets rounds pass over hazards unless aimed at them), `src/support.ts` (`supportStrike` hook before the airstrike / nuke damage; no floor for hazards), `src/mines.ts` (`supportStrike`, cause `support`), `src/mission.ts` (`MissionMechanic.supportStrike`), `src/render.ts` (`drawStructure` → `drawFuelTank`), `src/map.ts` (`FUEL_*`), `src/missions.ts` (`FUEL_FOR_THE_FIRE`, `FUEL_RESPONSE_WAVES`), `src/campaign.ts` (`fuel-for-the-fire` row), `src/story.ts` (`m17-*`, `cue:<name>` cues), `src/save.ts` (`expected` id), `src/main.ts` (`window.__fuelDepot`) |
| Tests | `v09b` (A campaign / chapter names / unlock chain, B support vs mines, C tanks: blast, falloff, cover, chains, sources, targeting, taps, credit, D Mission 17 flow / map / cue / rewards, F saves, G Missions 1–16 and CFG vs v0.9A, H phones), `fps-parity` (`fuel-for-the-fire`, `fuel-for-the-fire@reserve`: the pilot taps safe tanks) |
| Watch | A tank is an enemy-team structure that is only an automatic target while `fuelSafe` (nobody friendly within `safeDist`); any new candidate list must use the same filter (`isHazard`). The push-out loop treats tanks as obstacles (only mines are skipped). A chain lights each tank once; a fuse lit in a step counts from the next step. Blast kills are credited to `lastHitBy` of the first tank of the chain. |

## Urban ambushes and Mission 18 (v0.9B)

| | |
|---|---|
| Main | `src/urban.ts` (`AmbushDirector` mechanic, id `ambush`: `StreetAmbushDef` (zone / after / onObjective / delay / cue / banner / groups / minDist), `StreetAmbushGroup` (`from` + `posts` for ground groups, `roof` for rooftop snipers), arm → cue → `delay` → `spring` (ground: `safeSpawnPoint`, `holdPos` posts or pursue; roof: fixed snipers on perches, `Unit.rooftop`), the first-aim glint, `log`; `AmbushObjective`; `SupplyCaches` mechanic, id `caches`, and `CachesOptional`) |
| Supporting | `src/map.ts` (`roof` obstacle kind: a low obstacle, blocks walking, never sight or rounds; `urban` theme; `ALLEY_*`: buildings, cover, roofs, points, zones, caches, extraction), `src/render.ts` (`drawRoofPerch`, `urban` theme), `src/unit.ts` (`rooftop`), `src/missions.ts` (`AMBUSH_ALLEY`, `ALLEY_AMBUSHES`, `ALLEY_CACHE_LOOT`), `src/campaign.ts` (`ambush-alley` row, `urban` type), `src/story.ts` (`m18-*`), `src/save.ts` (`expected` id), `src/main.ts` (`window.__alley`), `src/chapter4.ts` (`safeSpawnPoint`) |
| Tests | `v09b` E (flow: quiet entry, first ambush, crossfire posts, rooftop warning / perches / telegraph / kill from the street, rear ambush distance, courtyard, final intersection, extraction; caches; map safety and a second route; rewards), `fps-parity` (`ambush-alley`, `ambush-alley@rooftops`) |
| Watch | Ambushes fire once per attempt and are counted in `Mission.spawned`; an `after` ambush waits until the named ones are sprung and cleared. Rooftop snipers are normal enemy Snipers (global numbers untouched): the glint subtracts from `aimHeld` on the first target only. Perches are ground-level art (no elevation); a sniper that loses its target re-aims with the normal telegraph. `escort.ts` has its own, truck-progress `AmbushDef` (Mission 14); do not confuse the two. |

## Fortress assault and General Voss (Mission 15)

| | |
|---|---|
| Main | `src/fortress.ts` (`ClearGroupsObjective`, `GeneratorObjective`, `FortressRelaysObjective`, `GeneralObjective`, `ClearRemainingObjective`, `ResistanceSurvivesOptional`, `LAST_STAND_BUDGET`), `src/general.ts` (`GeneralFight`: phases, Rally, radioed reinforcements `VOSS_CALLS`, allies, shooting, leash) |
| Supporting | `src/missions.ts` (`LAST_STAND` groups), `src/map.ts` (`FORTRESS_*`: map, gates, lockdown worlds, generator / relays / arena / call points), `src/mission.ts` (`MissionScript.general` / `lockdown`, `openGate`, `startGeneral`), `src/campaign.ts` (`last-stand` row, Demolitions unlock), `src/hud.ts` (boss bar: name, phase ticks, state), `src/render.ts` (`drawGeneral`, `drawGenerator`, gates, Rally chevrons), `CFG.general` |
| Tests | `v08c` A–D, F–H (campaign, fortress, gates, Voss, unlock, saves, Missions 1–14 vs v0.8B.2, phones), `fps-parity` (`last-stand@voss`), `v08c-sim` (report: SCEN, RUNS, LEVEL, TWEAK) |
| Watch | Gates are 'gate' obstacles in lockdown worlds (`game.swapWorld`), so they block movement, not fire. Phases only go forward and fire once; a reload restarts the mission (no checkpoint). Voss's range must stay at or below every soldier's (`v08c` C2). No medkit past the inner gate. |

## Story and cinematics (v0.8C.1)

| | |
|---|---|
| Main | `src/story.ts` (`SPEAKERS`, `SCENES`, `StoryDirector`: blocking `cinematic` panels and non-blocking `radio` lines, `readTime`, `TAP_GUARD`), `src/storyview.ts` (`StoryView`: `#cine` comic panel, SKIP, pips, timer bar, optional artwork; `#radio` strip) |
| Supporting | `src/mission.ts` (`MissionScript.story` cue → scene map, `Mission.cue` once per attempt via `storyCues`, `bossIntro` in `startGeneral`, `victory` when the last primary completes in `objectiveDone`), `src/general.ts` (`enterPhase` cues `bossPhase2` / `bossPhase3`), `src/game.ts` (`story`, `modal: 'story'`, ticked in `update` while playing and not paused, keys in `onKey`, reset in `startMission` / `leaveMission` / `end`; banners do not age under a cinematic), `src/hud.ts` (calls `StoryView.update`), `src/missions.ts` (`LAST_STAND.story`), `src/style.css` ("v0.8C.1 story"), `src/main.ts` (`window.__story`) |
| Tests | `story` (A–G: data, pre-boss blocking / auto / tap / keys / skip / pause, phase lines and the double-threshold queue, victory waits for the clear-up, extraction, rewards vs skip and vs v0.8C, restart / reload, saves, phones), `fps-parity` (`last-stand@story`), `v08c` (skips the pre-boss cinematic in its Voss helpers) |
| Watch | A cinematic suspends the simulation like the gunner prompt: anything new in `Game.update` before the `modal` return must not change gameplay. Auto-advance uses simulation time (30 / 60 FPS identical); only the tap guard is real time (input only). Lines never name a recruit. No save fields: cues are per `Mission` (per attempt). Tests that start Voss directly must call `game.story.skip(game)` to get past the intro. |

## Combat pacing, concealed rooftop snipers and extraction pressure (v0.9B.1)

| | |
|---|---|
| Main | `src/mission.ts` (`PressureTier` intro / light / standard / intense / restrained, `pressureGroups`, `PressureGroup.at` = fraction of the countdown, `updatePressure`, the FINAL ASSAULT banner; `MissionMechanic.drawAbove` / `Mission.drawAbove`), `src/urban.ts` (`AmbushDirector`: `hidden` rooftop snipers kept out of `Game.enemies` until revealed, `reveal` (why: sight / timer / cleared / support), `revealAfter` 30 s, `revealGap` 1.5 s, decoy nests, `drawAbove` nests + revealed snipers on the parapet, `roofPerch`, `isHidden` / `hiddenOf`), `src/chapter4.ts` (`InstallationCounterattack`, `CounterattackDef`) |
| Supporting | `CFG.extractionPressure` (`src/config.ts`, tuning sliders in `src/tuning.ts`), `src/unit.ts` (`roofLift` render height, `aimBonus` extra first-shot telegraph), `src/combat.ts` (`updateEnemySniper` uses `aimTime + aimBonus`; rooftop rounds carry `lift`), `src/render.ts` (rooftop units skipped by the depth pass and drawn by `drawAbove`; laser, "!" and HP bar raised by `roofLift`; `projectileLift`), `src/map.ts` (`FUEL_PRESSURE`, `FUEL_PICKETS`, `FUEL_COUNTER_FROM`, `ALLEY_ROOFS`, `ALLEY_ROOF_DECOYS`, `ALLEY_PRESSURE`, new `ALLEY_POINTS`, `JUNGLE_PRESSURE` points), `src/missions.ts` (per-mission tiers and countdowns, `FUEL_COUNTERATTACK`, `ALLEY_AMBUSHES`), `src/story.ts` (`m17-counter`, reworded `m18-rooftops`) |
| Tests | `v09b1` (A pressure tiers / staggering / directions / safe spawns / immediate extraction / exemptions, B concealed snipers: hidden, untargetable, reveal + laser, first shot timing, stays revealed, own building never blocks, decoys, iPhone SE render, C Mission 17 pickets / counterattack / skip, D Mission 18 totals, E vs v0.9B), `v09b` D / E (updated flows), `chapter3a` B (tier sizes), `fps-parity` (`*@extract` scenarios), `tools/lib.cjs` `V09B1` (older suites set aside exactly the `extractionPressure` group and the changed countdowns) |
| Watch | A hidden sniper is not in `Game.enemies`: anything counting enemies (objectives, `alive()`) must ask the director (`AmbushObjective` completes only after hidden snipers are revealed and killed). Pressure groups are never required kills; extraction completes when the countdown ends. A mission gets either `finalWave` or `pressure`, never both. |

## Mission 18 rooftop threats and extraction assault (v0.9B.2)

| | |
|---|---|
| Main | `src/mission.ts` (`'assault'` tier in `pressureGroups(tier, squad)`: six groups with a `route` each, scaled by `Mission.pressureSquad` = soldiers not KIA as the countdown starts; `PressureGroup.route`, `ExtractionSpec.pressure.routes`; `updatePressure` fires every group due in a step and names all their directions in one banner; `pressurePoint(game, points, route)`), `src/missions.ts` (`ALLEY_AMBUSHES` `avenue-roof` / `cache-roof`, `AMBUSH_ALLEY.extraction`) |
| Supporting | `CFG.extractionPressure.assault*` (`src/config.ts`; no tuning sliders), `src/map.ts` (`ALLEY_ASSAULT` routes, `ALLEY_ROOFS.avenue` / `.cache`, two `roof` strips, `ALLEY_ZONES.southAvenue` / `.cacheAvenue`) |
| Tests | `v09b2` (A the two new snipers: count, Main Street never arms them, isolation, hidden → reveal → first shot → stays → killed from the street; B assault: tier, 26 / kinds, timing, directions + one banner, safe spawns with a straggler, immediate extraction, scaling for 4-5 soldiers; C engagement vs v0.9B.1 with a level-14 squad; D everything else identical to v0.9B.1; E version, iPhone SE frames), `v09b1` A (M18 `assault` row), D1 (67 enemies, 7 roofs), `v09b` E2, `fps-parity` (`ambush-alley@extract`), `v09b2-sim` (report: reached range / fired / alive / damage per scenario) |
| Watch | The new snipers belong to no `AmbushObjective`: they never block a stretch and only spring if the squad walks into their avenue (the 30 s timer reveal still applies once sprung). The `assault` tier is the only tier that reads the squad size; every other tier ignores it. |

## The Warlord and Mission 20 (v0.9D)

| | |
|---|---|
| Main | `src/warlord.ts`: `WarlordHQ` mechanic (id `warlord`: `startFight`, the Extraction Alpha timeline `beginAlpha` / `updateAlpha` / `heliPos` / `rocketPos`, Bravo's push `pushWave` from `bravoRoutes` when `Mission.phase` turns `countdown`, `start()` thins the `cmd-*` Riflemen for squads under six, `log`; `draw` the Alpha pad, `drawAbove` the mortar circle, helicopter, ridge shooter, rocket and crash), `WarlordFight` (stages intro / fight / dead, phases via `enterPhase` (forward only), `WARLORD_CALLS` + `CALL_STAGGER` cut by `callScale`, `flushCalls` via `spawnGroupOffscreen`, mortar `mortarTarget` / `escapes` / `updateMortar` / `impact` (blastDamage), rifle `shoot`, movement `relocate` / `steerTo` / `move` with the arena leash, `defeated` (cancel mortar, rout, `bossDefeated`)); objectives `HqInstallationsObjective`, `WarlordObjective`, `AlphaObjective`, optionals `HazardKillsOptional`, `TowersOptional` |
| v0.9D.1 | `WarlordFight.underFire` / `firingSpot` (phase-1 answer to unanswered damage, `respondGoal`, `responses` counters, `respond:*` log), `CFG.warlordResponse`; the mortar warning is the boss bar's state line (`hud.ts`), no banner. Tests: `v09d1` E / F |
| Supporting | `src/missions.ts` (`WARLORD_HQ`, `HQ_INSTALLATIONS`, `HQ_RETREAT` (AmbushDirector defs armed on the `bravo` objective), `HQ_BRAVO_WAVES`), `src/map.ts` (`HQ_*`: map, open shapes, posts, arena, call points, gate, Alpha / Bravo zones, ridge / heli / crash points, mines, tanks, retreat zones and spawns, Bravo routes), `src/config.ts` (`warlord`, `mortar`, `hq`), `src/unit.ts` (`'warlord'` kind, `isBoss`), `src/mission.ts` (`Mission.camFocus`, the `'warlord'` wreck), `src/game.ts` (camera midpoint toward `camFocus`), `src/hud.ts` (boss bar branch for the Warlord), `src/render.ts` (`drawWarlord`, `drawVehicleDepot`), `src/campaign.ts` (`'warlord'` type, `CampaignMission.epilogue`, Chapter 4 `to: 20`), `src/menus.ts` + `src/style.css` (Results epilogue card), `src/story.ts` (`m20-*` scenes, speakers `warlord`, `pilot`), `src/save.ts` (`expected` gains `warlord-hq`) |
| Tests | `v09d` (A campaign / unlock / epilogue / save load, B map and approaches, C installations in both orders, D Warlord phases / calls / relocation / arena / scaling, E mortar warning / fixed circle / dodge / cadence / fairness, F death and rout, G Alpha ambush safeguards, H retreat sizes and bypass, I Bravo countdown and push, J stars and story, K BASE v0.9C, L version and iPhone SE), `v09d-sim` (report: `MODE=boss` / `full`, `DODGE=0`, `BYPASS=1`, `ROUTE=`), `fps-parity` (`warlord-hq`, `@boss`, `@retreat`), `perf` (`warlord-hq@boss`, `@retreat`) |
| Watch | The Alpha ambush is presentation plus a timeline: it must never call `Game.damage`, `Game.win` / `fail` or the support code. The mortar only fires in the `fight` stage and is cancelled by `defeated`. The retreat and Bravo groups are Riflemen only; Bravo has no `pressureGroups` tier. Moving a post, call point or tower: re-run `v09d` B / D (reachability after `openGate`). |

## Prison break and Mission 19 (v0.9C)

| | |
|---|---|
| Main | `src/prison.ts` (`PrisonBreak` mechanic, id `prison`: held prisoners as `Game.npcs`, `free()` turns one into a `Game.allies` specialist with `Unit.special`, rescue `responses` by count with `reduced` when the alarm tower fell first, the last stand `assault` waves from `routes` at the countdown, `forceScale` + `carried` scaling, `log`; objectives `RescuePrisonersObjective`, `AlarmTowerOptional`, `SpecialistsAliveOptional`) |
| Supporting | `src/missions.ts` (`PRISON_CAMP`, `CAMP_PRISONERS`, `CAMP_RESPONSES`, `CAMP_ASSAULT_WAVES`), `src/map.ts` (`CAMP_*`: map, cells, alarm, staging, assault routes, extraction, infiltrate zone), `src/config.ts` (`prison`, `prisonRocket`, `prisonFlame`, `prisonStar`), `src/unit.ts` (`SpecialistKind`, `Unit.special`, ally stats / speed), `src/combat.ts` (`flameBurst`, rocket / star projectiles for specialists), `src/abilities.ts` (`ignite`, exported), `src/squad.ts` (`flameRush`), `src/render.ts` (`SPECIAL_VIS` / `SPECIAL_COL`, bazooka / flamer / stars weapons, specialist bars and rings, flame cone), `src/story.ts` (`m19-*` scenes, speakers `specialist` / `camp`), `src/campaign.ts` (row 19, Mission 7 name, Mission 18 unlock), `src/save.ts` (`expected` list), `src/main.ts` (`__camp`) |
| Tests | `v09c` (A campaign / unlocks / save load, B map, C rescue in all six orders, D specialists' weapons / follow / downs / no permadeath / no XP / not saved, E responses and the alarm tower, F last stand timing / routes / safety / scaling, G engagement, H stars and story, I BASE v0.9B.2, J version and iPhone SE), `v09c-sim` (report: `MODE=stand` last stand, `MODE=full` autopilot), `fps-parity` (`jungle-prison`, `jungle-prison@stand`), `perf-lib` (`jungle-prison@stand`) |
| Watch | Specialists are allies: never push them into `Game.soldiers`, the roster or rewards. Freeing needs a standing soldier (allies cannot free). Responses and assault groups use `safeSpawnPoint` / off-screen checks; the scale is fixed once at the countdown start. |

## Escort / truck mechanics (Mission 14)

| | |
|---|---|
| Main | `src/escort.ts` (`EscortVehicle`, `MountedGun`, `CaptureVehicleObjective`, `ProgressAmbushes`, `EscortObjective`, `CountDestroyObjective`) |
| Supporting | `src/missions.ts` (`SUPPLY_LINE`, `SUPPLY_AMBUSHES`), `src/map.ts` (`SUPPLY_ROUTE`, `SUPPLY_ROUTE_V08B`, `SUPPLY_DEPOTS`), `src/game.ts` (gunner modal `openGunnerSelect` / `chooseGunner`, `pushOut`, pinned check, ceasefire), `src/squad.ts`, `src/targeting.ts` (`RoadblockTargeting`, `VehicleHunterTargeting`), `src/render.ts` (`drawEscortTruck`), `src/hud.ts`, `CFG.escortTruck` / `CFG.mountedGun` |
| Tests | `chapter3b` C, `v081` (route, Ambushes 4–5), `v081-collision`, `v081-e2e`, `v082` B (no route progress / ambush count on the HUD, route identical to v0.8B.1), `v081-sim` (report), `perf-lib` (answers the gunner selection) |
| Watch | `chapter3b-e2e` is superseded since v0.8B.1 (its autopilot loses the harder missions). Mission 5/7 captive escort is a different system (`updateEscort`, `FreeCaptiveObjective`). Since v0.8B.2 `EscortObjective.hud` shows no progress bar, distance or ambush count (truck HP meter and unnumbered AMBUSH chips only); keep it that way. |

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
| Main | `src/hud.ts` (in-mission DOM HUD, portraits, chips, meters, support buttons, extraction warning; v0.9D.1 `#objdock`: collapsible `#objective` (`setObjOpen`, `updatePrimaries`, closes on `squadMoving`) and the separate `#bossbar`), `src/menus.ts` (all screens; v0.9D.1 `missionDetailHtml` summary + Mission Details expander, `briefingHtml` Ready to Deploy? check, `deploy()` guard, `deployReturn` from Edit Squad), `src/campaign.ts` (`MISSION_SUMMARY`), `src/style.css` |
| Supporting | `src/main.ts` (`resize`, safe areas, `--t44`), `src/input.ts`, `src/tuning.ts` (⚙ Settings: frame cap, overlay, version; with `?dev=1` also `devTuningEnabled` sliders, debug, config JSON), `src/version.ts` (label + commit in Settings) |
| Tests | `v09d1` A-C (mission panel, deploy check, objectives HUD on three phones), `mobile`, `chapter2-mobile`, `permadeath-mobile`, `failure-recruit-mobile`, `recruit-mobile`, `touch`, plus phone sections in `chapter3a`, `chapter3b`, `squad-training`, `progression` |
| Watch | Landscape on iPhone SE (667×375), iPhone 14 (844×390), Pixel 7 (915×412); touch targets ≥ 44 CSS px via `var(--t44)`; joystick zone (left half) stays free. Since v0.8B.2 the tuning sliders and debug actions exist only with `?dev=1` (`v082` C). |

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
| Supporting | `tools/lib.cjs` (`createChecks`, `runSuite`, `serveDir`, `loadPlaywright`, result line; Phase 3 page helpers `openPage`, `seedRandom`, `installPageHelpers`, `missionSnapshot`), `.gitignore` (`test-results/`), `package.json` `test` script |
| Tests | the runner itself: `npm test -- --help`, `--list`, an unknown name (exit 2), `maps barracks recruit-mobile` (migrated suites) |
| Watch | Register every new `tools/*.cjs` in `test-suites.cjs`. Never count a suite as PASS without checks; keep suites runnable standalone (`node tools/<suite>.cjs`). |

## Which tests to run

`npm test -- <group|suite>...` builds, serves and runs them (see [CLAUDE.md](../CLAUDE.md#tests)); `npm test -- --list` prints this table from `tools/test-suites.cjs`. Suite names in the rows above are runnable directly (`npm test -- chapter2`).

| Group | Suites | Use for |
|---|---|---|
| `smoke` (bare `npm test`) | `logic`, `maps`, `campaign-rules`, `barracks` | quick check while working |
| `combat` | `logic`, `accuracy`, `elite`, `support`, `v082`, `v08c`, `arch`, `v09a`, `v09b` | weapons, damage, classes, Tactical Support, Demolitions |
| `movement` | `logic`, `v081-collision`, `mobile`, `v09d1` | squad movement, collisions, joystick |
| `recruitment` | `recruitment`, `recruit-mobile`, `failure-recruit`, `failure-recruit-mobile`, `barracks`, `v08c` | Recruitment Office, roster |
| `progression` | `progression`, `training-rebalance`, `squad-training`, `accuracy`, `elite`, `elite-progression`, `v09d2` | XP, training, Elite |
| `permadeath` | `permadeath`, `permadeath-mobile`, `failure-recruit` | KIA, resurrection, failed missions |
| `missions` | `maps`, `campaign-rules`, `chapter2`, `chapter3a`, `chapter3b`, `v081`, `v081-collision`, `v081-e2e`, `v082`, `v08c`, `story`, `arch`, `v09a`, `v09b`, `v09b1`, `v09b2`, `v09c`, `v09d`, `v09d1` | missions, campaign, escort, defense, mechanic hooks, mines, fuel tanks, ambushes, prison break, the Warlord |
| `persistence` | `barracks`, `progression`, `permadeath`, `recruitment`, `failure-recruit`, `elite`, `elite-progression`, `support`, `v081-e2e`, `v082`, `v08c`, `v09a`, `v09b`, `v09c`, `v09d`, `v09d2` | saves, fixtures, economy |
| `ui` | `mobile`, `chapter2-mobile`, `permadeath-mobile`, `failure-recruit-mobile`, `recruit-mobile`, `story`, `v09d1` | HUD, menus, phone layouts |
| `fps` | `fps-default`, `fps-parity` | frame cap, 30 / 60 FPS parity |
| `all` | every rule suite (38) | full regression before a release |
| `reports` | `campaign`, `balance`, `progression-balance`, `squads`, `chapter2-sim`, `chapter3b-sim`, `v081-sim`, `v08c-sim`, `v09a-sim`, `v09b2-sim`, `v09c-sim`, `perf` | balance / perf numbers (slow, no PASS/FAIL) |
| `screens` | `shot`, `visual`, `fight`, `classes`, `lineup`, `touch`, `play` | screenshots judged by eye |

| Change | Run at least |
|---|---|
| Any gameplay change | `npm test -- <feature group> logic fps-parity` |
| Combat numbers / classes | `combat progression` + the chapter suite that uses the class |
| Missions / campaign | `missions` |
| Saves / economy | `persistence` |
| HUD / menus / layout | `ui` |
| Release | `all` |

**BASE**: `accuracy`, `elite-progression`, `support`, `squad-training`, `training-rebalance`, `v081`, `v081-collision` compare against the previous gameplay release, v0.8B (`c3cae3d`, `PREV` in `tools/test-suites.cjs`), which the runner builds and serves automatically; `accuracy` and `support` fail without it. `v082` compares against v0.8B.1 (`V081`) and `v08c` against v0.8B.2 (`V082`, `3199529`: every pre-v0.8C CFG group and Missions 1–14 identical); `story` against v0.8C (`V08C`, `1acc610`: every CFG group, Missions 1–15 and the Mission 15 rewards identical); `arch` and `v09a` against v0.8C.1 (`V08C1`, `924dc13`; `v09a` J: every CFG group but `mine` and Missions 1–15 identical, only Mission 15's unlock list names Mission 16); `v09b` against v0.9A (`V09A`, `550fcb8`; G: every CFG group but `fuel` identical, Missions 1–15 identical, Mission 16 identical but for its unlock list); `v09b2` against v0.9B.1 (`V09B1`, `f4cf5e0`: every CFG group but `extractionPressure`, whose old keys are unchanged, and Missions 1-17 identical; the engagement check C3 replays the same seeded extraction on it); `v09d` against v0.9C (`V09C`, `82e10ca`: every CFG group but `warlord` / `mortar` / `hq`, Missions 1-18 identical, Mission 19 identical but its unlock list; `V09D` in `tools/lib.cjs`, and `V09C.cfgDiff` also sets the v0.9D groups aside for older suites); `v09d1` against v0.9D (`V09D`, `53d2762`: every CFG group but `formation` / `warlordResponse` (`V09D1` in `tools/lib.cjs`; `V09D.cfgDiff` chains it for older suites) and Missions 1-20 identical; D8 / D9 route walks and E1 replay the same seeded scenes on it); `v09c` against v0.9B.2 (`V09B2`, `4199686`: every CFG group but the new `prison*` groups, Missions 1-17 identical but Mission 7's name, Mission 18 identical but its unlock list); `v09b1` against v0.9B (`V09B`, `2d09342`: every CFG group but `extractionPressure` identical, Missions 1-16 identical but for the pressure tier / countdown, which `V09B1` in `tools/lib.cjs` lists). Move `PREV` forward when a release ships. `fps-parity` takes an optional `BASE` (`--base <ref>`; it differs from older builds by design). Manual: `npx vite preview --port 4174 --outDir <older dist>` and `BASE=http://localhost:4174/ node tools/<name>.cjs`.

Known failures and test notes: [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md#test-status). `maps` only covers the Mission 1–10 maps; `chapter3b-e2e` is superseded (run by name only).

**Coverage gaps** (no direct suite): `src/audio.ts`; rendering correctness (screenshots only, judged by eye); Mission 5/7 captive escort beyond the `chapter2` / `logic` checks; the truck back-up rescue (`pinBackAfter` / `pinBackMax`, never triggered in sims); real-device performance.

## Questions this map answers

- **Sniper damage**: player `CFG.sniper.damage`, enemy `CFG.enemySniper.damage` (and `projectileSpeed`, `aimTime`, `lockTime`) in `src/config.ts`; enemy shot in `updateEnemySniper` (`src/combat.ts`). Run `chapter2` (enemy Sniper aim / lock / shot), `chapter2-mobile` (laser), `chapter3a` (sniper standoff), `chapter3b`, `v081`, `fps-parity`, plus `chapter3b-sim` / `v081-sim` for balance. `support` with `BASE=` compares enemy config against the base build, so an intended change shows up there as an expected difference.
- **Mission 14 escort**: `src/escort.ts` + `SUPPLY_LINE` / `SUPPLY_AMBUSHES` (`src/missions.ts`) + `SUPPLY_ROUTE` (`src/map.ts`); tests in the escort table above.
- **New soldier class**: classes table above and the recipe in [ARCHITECTURE.md](ARCHITECTURE.md#recipes).
- **Ability Capacity tests**: `v081`, `v081-e2e`, `training-rebalance` F, `mobile`, `progression`.
- **Save migrations**: `parseSave` in `src/save.ts` (version flags `v5`…`v8`, `clean*`, backups).
- **A story scene for a new finale** (or comic artwork): add lines to `SCENES` in `src/story.ts` (speaker from `SPEAKERS`, collective address only), map cues in the mission's `MissionScript.story`; a new kind of moment needs a `StoryCue` and one `mission.cue(game, …)` call where it happens. Artwork: put the file in `public/story/` and set `portrait` on the line or the speaker; nothing else changes. Test in `story`.
- **Mines in another mission**: `mechanics: () => [new MineField({ mines: MY_MINES, warnCue?, warnRadius?, tuning? })]` in its `MissionScript` (positions on open ground, none near the start); `tuning` overrides any `CFG.mine` number for that field only. Map checks like `v09a` B (open ground, reachability, a mine-free route with blast rings closed).
- **Fuel tanks in another mission**: `mechanics: () => [new FuelDepot({ tanks: [{ x, y, group }], warnCue?, warnRadius?, tuning? })]`; an objective counts groups from `m.mechanic<FuelDepot>('fuel').tanks` (see `FuelInstallationsObjective`). Keep tanks on open ground, reachable within weapon range and outside the start zone's blast reach (`v09b` D7).
- **An urban ambush mission**: street grid as `building` obstacles (`src/map.ts` `ALLEY_*`), `roof` perches for snipers, then `mechanics: () => [new AmbushDirector([...defs])]` with `AmbushObjective`s for each stretch; spawn fairness comes from `from` points + `minDist` (`safeSpawnPoint`). Check reachability and a second route like `v09b` E12.
- **Adding Mission 15**: campaign row (`mission-15` in `src/campaign.ts`), map, script, objectives (likely `src/defense.ts` patterns for a last stand), `expected` ids in `parseSave`, chapter suite, `campaign-rules` (chapter star totals), `maps`, `fps-parity`.
