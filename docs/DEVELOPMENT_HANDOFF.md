# MiniSquad development handoff (after v0.8B.1)

Current release: **v0.8B.1 — Difficulty, Extended Escort & Ability Capacity** (package 0.8.2, label `versionLabel: "0.8B.1"`), on top of v0.8B Chapter 3B: Hold the Line & Supply Line Sabotage, v0.8A Chapter 3A: The Resistance Begins, v0.7D.1 Accuracy Soft Floor & HUD Touch Areas, v0.7D Squad Training Expansion & Mobile Polish, v0.7C Tactical Support, v0.7B.1 Progression & Training Rebalance, v0.7B Elite Progression and v0.7A Elite Promotions.
Rules and numbers: README → "Difficulty, Extended Escort & Ability Capacity (v0.8B.1)", "Chapter 3B: Hold the Line & Supply Line Sabotage (v0.8B)", "Chapter 3A: The Resistance Begins (v0.8A)", "Elite Promotions (v0.7A)", "Elite Progression (v0.7B)", "Progression & Training Rebalance (v0.7B.1)", "Tactical Support (v0.7C)", "Squad Training Expansion & Mobile Polish (v0.7D)" and "Accuracy Soft Floor & HUD Touch Areas (v0.7D.1)". This file is what the next step (Chapter 3C: Mission 15, the Demolitions Expert) needs.

## Workflow

- Repo `avererya/MiniSquad`. A push to `main` deploys to Cloudflare Workers. Never touch the `prototype-v0.1` tag (the git proxy refuses tag pushes anyway).
- Serve a build and run the headless suites: `npm run build && npx vite preview --port 4173`, then `node tools/<suite>.cjs` (`URL=` to point elsewhere, `OUT=` for screenshots).
- Regression set used for v0.8B.1: `v081` (new; `BASE=<v0.8B build>` compares the untouched v0.8B content), `v081-collision` (new; `BASE=` prints the v0.8B numbers for the same scripts), `v081-e2e` (new; real menus from `tools/fixtures-v08b/v0.8B-m12-cleared.json`, a save written by the v0.8B build), `chapter3b` (wave / ambush expectations updated), then the v0.8B set below against `BASE=<v0.8B build>`. Balance: `node tools/v081-sim.cjs` (squad profiles mod / well / elite, Ability Capacity `cap`, M13 policies hold / aggressive / slow; `THROTTLE=4` for perf).
- Regression set used for v0.8B: `chapter3b` and `chapter3b-e2e` (new) and `fps-parity` (`MISSIONS=hold-the-line,supply-line` too), then the v0.8A set below against `BASE=<v0.8A build>`. Outdated v0.8A expectations were updated in `campaign-rules` (CH 3 = 4 missions / 12 stars, M15 placeholder), `chapter2` (M13 playable) and `support` A2 (two playable missions at 6). Balance: `node tools/chapter3b-sim.cjs` (autopilot, `SCEN=`, `RUNS=`, `THROTTLE=4` renders every step for perf).
- Regression set used for v0.8A: `chapter3a` (new), `elite elite-progression logic permadeath recruitment failure-recruit progression campaign-rules barracks chapter2 support (BASE=) squad-training training-rebalance accuracy (BASE=)`, `fps-default`, `fps-parity` (30 / 60 FPS within this build), and the phone suites `mobile chapter2-mobile permadeath-mobile failure-recruit-mobile recruit-mobile`. `fps-parity BASE=<v0.7D.1>` now differs from 5-10 s into prison-break / blackout / iron-fist by design: enemy group awareness changes how guards react (approved in the v0.8A brief). Use the v0.8A build as the new simulation baseline.
- Regression set used for v0.7D.1: `accuracy` (with `BASE=<v0.7D build>`), `progression`, `training-rebalance` and `squad-training` (with `BASE=`), `fps-parity` (with `BASE=`), `elite-progression` and `support` (with `BASE=`), then the v0.7B set below. Serve the v0.7D base from a worktree on port 4174 as described below.
- Regression set used for v0.7D: `squad-training` (with `BASE=<v0.7C build>`; `QUICK=1` skips the long runs), `training-rebalance`, `progression`, `support` (with `BASE=`), `elite-progression` and `fps-parity` (with `BASE=`), then the v0.7B set below.
- Regression set used for v0.7C: `support` (with `BASE=<v0.7B.1 build>`), `fps-parity` (with `BASE=`), `training-rebalance` and `elite-progression` (with `BASE=`), then the v0.7B set below.
- Regression set used for v0.7B.1: `training-rebalance` (with `BASE=<v0.7B build>`), then the v0.7B set below. `progression.cjs` expectations follow the v0.7B.1 XP / training values.
- Regression set used for v0.7B: `elite-progression` (with `BASE=<v0.7A build>`), `elite logic permadeath recruitment failure-recruit progression campaign-rules barracks chapter2 fps-default` and `fps-parity` (with `BASE=<previous build>` to prove a change leaves the Recruit-only simulation bit-identical). The suites that check the save version expect v9.
- To serve a previous build for `BASE=`: `git worktree add /tmp/base <commit> && (cd /tmp/base && npm ci && npm run build)`, then `npx vite preview --port 4174 --outDir /tmp/base/dist`.
- Known pre-existing flakes (v0.8A: `elite.cjs` D5 Ironclad-in-the-field failed once with 0 hits while 16 suites ran in parallel, then passed alone 3 of 3; `progression.cjs` UI double-tap checks fail only under that parallel load): `logic.cjs` Ranger Quick Reflexes move-speed check and the escort-formation timing check fail intermittently on unchanged builds. `support.cjs` F2 (detonation frame < 33 ms under a 4x throttle) is timing-noisy: it also fails on the unchanged v0.7C build (2 of 3 runs passed there in the v0.7D session).
- Headless perf: never render hundreds of frames in one synchronous `page.evaluate`; the rasterizer stalls 1-2.5 s every ~35 frames on any build. `squad-training.cjs` F4 yields between frames.

## Where Elite lives

| Concern | File |
|---|---|
| Spec data (stable ids `inf-trooper` … `snp-deadeye`), promotion constants, passives | `src/elite.ts` |
| Passive numbers (live-tunable) | `src/config.ts` → `CFG.elite`, `CFG.boss.plating` |
| Persisted fields: `tier`, `elitePath`, `specialization` (mirror), `eliteLevel` (1..30, derived), `eliteXp` (cumulative) | `src/classes.ts` (`ProgressionRecord`) |
| v0.7B Elite XP curve + level bonuses (`ELITE_PROGRESSION`, `eliteXpToNext` / `eliteXpForLevel` / `eliteLevelForXp` / `eliteProgress`, `eliteLevelModifiers`) | `src/elite.ts` |
| Elite XP / level-up at settlement (`eliteBefore` / `eliteAfter` / `eliteLevelsGained` on `SoldierReward`) | `src/economy.ts` `settleMission`, `src/progression.ts` |
| Promotion ledger `account.promotions` (`PromotionRecord`) | `src/progression.ts` |
| Atomic promotion `promote()` / `promotionBlock()`; Elite XP banking in `settleMission` | `src/economy.ts` |
| Save v9 (v8 + derived Elite levels), `cleanElite` repairs, backups `minisquad.save.pre-v0.7` / `pre-v0.7b` | `src/save.ts` |
| Combat hooks: `onFire` (updateWeapon), `onHit` + `pen` (updateProjectiles / modifyDamage), `incomingMul` (Game.damage), `eliteAuras` / `eliteTick` (Game.update), `reviveHpFrac` (updateDowned) | `src/combat.ts`, `src/game.ts`, `src/unit.ts`, `src/squad.ts` |
| Uniforms and per-spec shapes, ground effects, portraits | `src/render.ts` (`drawEliteBody/Back/Head`, `drawEliteGround`, `drawClassPortrait(…, spec)`) |
| Screens: promotion box, confirmation, ceremony, Elite profile (XP / bonus lines `eliteXpText` / `eliteBonusText`), Results (ELITE LEVEL UP!) | `src/menus.ts`, `src/style.css` (v0.7A / v0.7B sections) |
| HUD panel labels (AIM READY / OVERDRIVE / ADRENALINE) | `src/hud.ts` |
| Resurrection price x2 for Elites | `src/casualties.ts` |

## Where the v0.7B.1 rebalance lives

| Concern | File |
|---|---|
| Training tables: `acceleratingBonus(first, last, ranks)`, `TrainingDef.first / last / bonus`, `rankBonus(def, rank)`; prices `INDIVIDUAL_COSTS` / `SQUAD_COSTS` | `src/progression.ts` |
| Pipeline (unchanged order; `bonusFractions` reads `rankBonus`) | `src/progression.ts`, `src/classes.ts` `effectiveStats` |
| Mission XP curve `PROGRESSION.missionXp`, `missionXp(n)`, `victoryXp(missionId)` (used by `computeMissionRewards`) | `src/progression.ts` |
| Training tab preview (`STAT_VIEW[k].gain`, `.t-gain`) and squad tab (`rankBonus`) | `src/menus.ts`, `src/style.css` |
| Suite | `tools/training-rebalance.cjs` |

## Where the v0.7D squad training lives

| Concern | File |
|---|---|
| Locked 10-rank tables `SQUAD_BONUS` (explicit, not `acceleratingBonus`), `tableDef`, prices `SQUAD_COSTS` (ranks 6-10 added) | `src/progression.ts` |
| Pipeline (unchanged: `bonusFractions` reads `rankBonus`, squad bonus added once to growth + individual training) | `src/progression.ts`, `src/classes.ts` `effectiveStats` |
| Spread floor when individual + squad accuracy pass -100% (closed-form moving penalty, was collapsing to 0) | `src/classes.ts` `effectiveStats` |
| Save: ranks clamp to `costs.length` (now 10); no migration, still v9 | `src/save.ts` `cleanRanks` |
| Squad Training tab: rank /10 with pips, Current → Next, "Upgrade gain: +x pts of class base … for every soldier", real-stat preview of one soldier (`squadPreviewSoldier`: the Training tab's selection, else the highest level), MAXED | `src/menus.ts` `squadTrainingHtml`, `src/style.css` (v0.7D section at the end) |
| HUD touch areas: `--t44` (44 CSS px in stage px, set in `resize()`), AIRSTRIKE / NUKE side by side with an invisible `::after` touch area ≥ 44 px tall, CONFIRM / CANCEL / LAUNCH heights `max(62/68px, var(--t44))` | `src/main.ts`, `src/style.css` |
| Suite (brief items 1-38), genuine v0.7C save | `tools/squad-training.cjs`, `tools/fixtures/v0.7C-save.json` |

## Where Tactical Support lives (v0.7C)

| Concern | File |
|---|---|
| Rules, constants (`AIRSTRIKE_ELITES` 3, `NUKE_ELITES` 6, `NUKE_COST` 3000), shop catalog `SUPPORT_ITEMS`, per-mission state `Support` (air: locked / ready / targeting / incoming / used; nuke: locked / ready / confirm / countdown / used), `spendNuke`, `supportDamageFor`, `supportRoom`, `airstrikeImpact`, `nukeDetonate` | `src/support.ts` |
| Numbers (live sliders) | `src/config.ts` → `CFG.airstrike`, `CFG.nuke`, `CFG.support` |
| Mission wiring: `Game.support` (new per attempt in `startMission`, counts `eliteCount` at deployment), `useAirstrike` / `confirmAirstrike` / `cancelAirstrike` / `useNuke` / `launchNuke` / `cancelNuke`, keys Q / N / Enter / Esc, floors in `Game.damage` (`opts.support`), `support.update` after grenades in the fixed step | `src/game.ts`, `src/combat.ts` (`DamageOpts.support` skips soldier modifiers) |
| Objective marking (`Unit.objective`, `protectedObjective` = objective, structure or vehicle) | `src/unit.ts`, `src/objectives.ts`, `src/convoy.ts` |
| Touch / mouse aiming (`isSupportAiming`, `onSupportAim`, `aimTouch`) | `src/input.ts` |
| HUD buttons `#support`, CONFIRM bar `#asbar`, nuke box `#nkbox` (LAUNCH arms after 0.5 s) | `src/hud.ts`, `src/style.css` |
| Aim circle, incoming marker, jet shadow (world); countdown warning, flash, shockwave, mushroom cloud (screen) | `src/render.ts` (`drawSupportGround`, `drawSupportScreen`) |
| Inventory `account.support = { nukes, purchased, launched }`, repair `cleanSupport` | `src/progression.ts`, `src/save.ts` |
| Purchase `buySupport` (atomic, refused in a mission / with a pending decision / stale stock) | `src/economy.ts` |
| Support Shop tab (Barracks → SUPPORT) | `src/menus.ts` (`supportHtml`, action `supbuy`) |
| Sounds `jet`, `strike`, `siren`, `beep`, `nuke` | `src/audio.ts` |
| Suite, genuine v0.7B.1 save | `tools/support.cjs`, `tools/fixtures/v0.7B.1-save.json` |

## Where Chapter 3A lives (v0.8A)

- **Briefings**: `briefingHtml` / `openBriefing` / `briefOpen` in `src/menus.ts`; text in `CampaignMission.brief` (`src/campaign.ts`); CSS `.brief*` at the end of `src/style.css`. Every tool that taps `[data-a="deploy"]` now also taps `[data-a="brief-deploy"]`.
- **Enemy awareness**: `src/awareness.ts` (`raiseAlert`, `alertUnit`, `alertSteer`, `awareEligible`), wired in `Game.damage` (any squad-sourced hit / kill on an enemy, origin = shooter position at fire time via `Projectile.from` / `DamageOpts.origin`) and the guard wake in `src/enemy.ts`. `Game.alertLog` counts broadcasts for tests. Numbers in `CFG.awareness`.
- **Extraction pressure**: `pressureGroups` + `Mission.updatePressure` / `pressurePoint` in `src/mission.ts`; per-mission tier and edge points in `ExtractionSpec.pressure` (`src/missions.ts`). Spawned units carry `reinforcement = true`. `Mission.incoming` feeds the off-screen "ENEMIES" arrows (`src/render.ts`).
- **Mission 11**: `LiberateZonesObjective`, `SafehouseDefenseObjective`, `AlliesAliveOptional` in `src/chapter3.ts`; map `RESISTANCE_MAP`, `VILLAGE_ZONES`, `SAFEHOUSE_*` in `src/map.ts`. Allies are `Unit`s with `team = 'squad'`, `ally = true`, stats `CFG.resistance`, in `Game.allies`; they move with `updateAllies` (`src/squad.ts`), fire through the normal `updateWeapon`, use `updateDowned` and emit `allyDowned` / `allyKia`. They are skipped by settlement, stats, the KIA journal and casualty decisions.
- **Mission 12**: `src/artillery.ts` (`Artillery`: spotlights, exposure, alert, markers, impact, `drawGround` / `drawLights`), created by `Mission.start` from `MissionScript.artillery`; guns are `structure = 'artillery'` targets of `ArtilleryObjective` (`src/chapter3.ts`); `NoArtilleryAlertOptional`. Numbers in `CFG.artillery`.
- **Commando**: class in `src/classes.ts`, stats `CFG.commando`, offhand pistol `updateOffhand` + `squadReaction` / `turnMul` in `src/combat.ts`, `BulletStormAbility` in `src/abilities.ts` (`CFG.bulletStorm`), specs `com-gunslinger` / `com-assault` in `src/elite.ts` (`CFG.elite.quickDraw*`, `cq*`, `closeQuartersMul`), recruitment row in `src/recruitment.ts`, unlock text `CLASS_UNLOCK_TEXT.commando`, drawing (`weapon: 'pistols'`, `pack: 'vest'`, `helmet: 'beret'`) in `src/render.ts`, save guard `noCommando` in `src/save.ts`.
- **Tests**: `tools/chapter3a.cjs` (91 checks: awareness, extraction, briefings, M11, M12, Commando, older saves, phones).

## Where Chapter 3B lives (v0.8B)

- **Sixth slot**: `CAPACITY_TABLE` / `capacityOf` in `src/campaign.ts` (6 from Mission 13); HUD rows of three in `src/hud.ts` (`compact rows2`); `Digit1-6` in `Game.onKey`.
- **Friendly assets**: `Unit.asset` (`'command' | 'turret' | 'truck'`), `Unit.live` (a parked truck is not `targetable`), stats from `ASSET_CFG` (`src/unit.ts`) → `CFG.commandCenter` / `CFG.turret` / `CFG.escortTruck`. Created by `Game.spawnAsset`, kept in `Game.assets` (never `soldiers`), included in `enemyVictims`, drawn by `drawCommandCenter` / `drawTurret` / `drawEscortTruck` (`src/render.ts`). Destruction emits the `assetDestroyed` MissionEvent (`Mission.emit` fails the mission for the protected asset, starts the truck aftermath). `combat.ts` lets an enemy fire from off screen only when its target is an asset.
- **Mission 13**: `PrepareDefenseObjective` (caches, turret install, response groups, 5 s command zone, `onBegin` → `Mission.closeGates` → `Game.swapWorld(HOLD_GATED_MAP)`), `WaveController` / `WaveDefenseObjective` (waves, `CFG.defense` gaps, `SiegeTargeting` from `assetHunter` in `src/targeting.ts`), `AssetHpOptional` — all in `src/defense.ts`. Map data `HOLD_*` in `src/map.ts`; waves / caches in `src/missions.ts`. Wire and gate obstacles block movement, not sight; gates are drawn by `drawGates`. Enemy `holdPos` (src/enemy.ts) parks a unit on a point.
- **Mission 14**: `src/escort.ts`: `EscortVehicle` (route progress `s`, follow / wait / off-road / yield / roadblock, `makeWay` lane avoidance used by `updateSquad`, `stepAside`, `onDestroyed` wreck), `MountedGun` (assign / release / update; `Projectile.mounted` rounds skip Elite on-hit, Close Quarters and healing), `CaptureVehicleObjective` (opens the gunner selection), `ProgressAmbushes` / `EscortObjective`, `CountDestroyObjective`. Gunner selection: `Game.modal = 'gunner'` halts the simulation and keys; `openGunnerSelect` / `gunnerCandidates` / `chooseGunner` in `src/game.ts`, `#gunsel` in `src/hud.ts` + `src/style.css`. Truck aftermath: `Mission.startAftermath` / `updateAftermath` (ceasefire, abilities and support locked). Route / depots / extraction in `src/map.ts` (`SUPPLY_*`).
- **v0.8B.1 Ability Capacity**: data `ABILITY_CAPACITY` / `capacityRank` / `abilityUses` (`src/progression.ts`), stored as the optional `abilityCapacity` on `SoldierIdentity` (absent = rank 0; `mergeSoldier` in `src/save.ts` clamps it), bought with `buyAbilityCapacity` (`src/economy.ts`). Charges live on the ability (`charges` / `capacity` on `BaseAbility`); `resetCharges` at `Game.spawnSoldier`, `activateAbility` (`src/abilities.ts`) is the one path that spends a charge (only when the ability actually took effect: its cooldown or duration started). HUD counter `.uses` / `spent` in `src/hud.ts` + `src/style.css`; Training row `capacityRowHtml` in `src/menus.ts`.
- **v0.8B.1 Mission 13 waves**: `WaveController` (`src/defense.ts`) runs overlapping waves (`starts[]`, `remaining(i)`, `liveWaves`), timing `CFG.defense` (`minGap` / `nextWhenLeft` / `maxGap`, start to start), siege share by cumulative rounding; `siegeAnswer` turns a siege attacker on a soldier / ally who shoots it.
- **v0.8B.1 Mission 14**: the extended `SUPPLY_ROUTE` (`SUPPLY_ROUTE_V08B` is the old length), Ambushes 4-5 in `SUPPLY_AMBUSHES` (`escortFirst` → `RoadblockTargeting`, staggered `after`), `ProgressAmbushes.drain` (groups on their way still land after the truck arrives, via `Objective.afterComplete`). Truck footprint helpers on `EscortVehicle`: `inBox` / `clearOf` / `around` / `sweep` (used by `updateSquad`), `pinned` / `pinnedT` / `backedUp` / `rescues` (wedge recovery), `ejectPoint` (gunner release). `pushOut` (`src/game.ts`) picks an open face. `combat.ts`: off-screen enemy fire only at the command center / turrets.
- **Tests**: `tools/chapter3b.cjs` (98 checks), `tools/chapter3b-sim.cjs` (autopilot balance and perf), `tools/chapter3b-e2e.cjs` (menus → M13 → M14 smoke; closing a Campaign notice locks taps for a moment, so it waits before the next tap), `tools/perf-lib.cjs` answers the gunner selection.

## Invariants to keep

1. **Elite Level 1 is never weaker than Recruit Level 25** and is exactly the v0.7A soldier. The stat pipeline still reads the Recruit level (25) for Elites; the v0.7B level bonus is one multiplier per stat in `eliteModifiers` (null at Elite 1), next to the trait.
2. **No randomness, fixed step.** Passives run only in the 1/60 s simulation step and never call `Math.random`. Recruit-only squads must stay bit-identical to the previous build (`fps-parity.cjs BASE=`).
3. **Stable ids.** Saves store spec ids, never titles; display names can change freely.
4. **The ledger is the source of truth for a paid promotion.** `cleanElite` restores tier / path from it. If a later release adds anything bought (e.g. Elite perks), give it a ledger and a repair rule the same way.
5. **Caps**: incoming reduction ≤ 40% (`maxDamageReduction`), per-shot multiplier ≤ x2 (`maxShotMul`). New Elite bonuses must go through these.
6. `eliteXp` is cumulative and never spent or reset; `eliteLevel` is derived from it (at settlement and on load). A load never lowers a stored v9 level (XP is raised to its threshold instead). If anything is ever bought with Elite XP, give it its own ledger instead of subtracting.
7. Elite levels touch only max HP, damage and one class stat (spread / heal / aim time). Keep fire rate and move speed out (perf + balance).
8. (v0.7B.1) **No training rank is ever weaker than an earlier release.** Each table's rank 1 equals the v0.7B flat value and increments only grow. A retune must keep `bonus[r]` ≥ the previous release's value at every rank (checked by `training-rebalance.cjs` A4 against `BASE=`), or it takes something players paid for.
9. (v0.7B.1) Training prices and rank limits are approved and fixed; tune `first` / `last`, not `costs`.
10. (v0.7B.1) Mission XP is by mission **number**, applied once on the Victory line; the replay multiplier scales the whole total. Credits do not scale with the mission number (yet).
11. (v0.7C) **Support never kills what the squad must finish**: every support hit goes through `Game.damage` with `opts.support`, which clamps to `supportRoom` (boss ≥ 10% max HP, protected objective ≥ 1 HP, squad / allies 0). New support kinds or new objective types must keep using that path; mark new objective units with `objective = true`.
12. (v0.7C) **Support adds no randomness and runs in the fixed step**: a mission without support used simulates bit-identically to v0.7B.1, and both strikes hash identically at 30 / 60 FPS (`support.cjs` F1). Timers are simulation time, so pause freezes them.
13. (v0.7C) **A launched nuke is spent before the countdown starts** (saved first; a failed write cancels the launch). Never refund on failure / quit / reload. `purchased` and `launched` are the ledger; `cleanSupport` rebuilds an unreadable stock as `purchased − launched`.
14. (v0.7C) Eligibility is counted once at deployment from deployed Elites; don't recount mid-mission. Deployment caps are unchanged (six from Mission 13).
15. (v0.7D) **Squad Training tables are locked** (`SQUAD_BONUS`, ranks 0-10) and prices are fixed (46,250 CR per category, 185,000 in all). Ranks are stored as numbers, so a retune changes the benefit of ranks already bought; keep every rank ≥ its previous value (invariant 8).
16. (v0.7D) Individual max accuracy (-55%) + squad max (-50%) exceed -100% of the class spread, so fully trained soldiers sit on the 1° floor (Infantry / Heavy / Medic from squad rank 8, Sniper from rank 2). Keep the floor branch in `effectiveStats` that scales the moving penalty in closed form; a new spread bonus must go through the same additive sum.
17. (v0.7D) HUD controls on small phones use `var(--t44)` for a ≥ 44 CSS px touch area; new HUD buttons should do the same (the stage scales everything by ~0.52 on an iPhone SE).
18. (v0.8A) **Only searchlights raise the artillery alert.** `src/artillery.ts` reads spotlights only; awareness never touches it, and it never alerts enemies. Keep the two systems separate.
19. (v0.8A) **Awareness is bounded and event-driven**: received alerts are never re-broadcast, a unit broadcasts at most once per `CFG.awareness.repeat` s, search ends in a dormant guard. No per-frame map scans; it uses no `Math.random` (reaction delay is derived from the unit id).
20. (v0.8A) **Extraction reinforcements are finite and never required**: a mission has either a scripted `finalWave` or `pressure`, never both; no per-kill rewards exist, so nothing can be farmed. The helicopter countdown is separate and unchanged.
21. (v0.8A) **Resistance allies never touch the account**: no XP, no stats, no casualty decision, no Memorial, nothing saved. Anything that iterates `Game.soldiers` for rewards must keep ignoring `Game.allies`.
22. (v0.8A) Spec id `inf-recon` is shown as "Recon Specialist"; titles can change, ids cannot (invariant 3).
23. (v0.8B) **Assets are never soldiers.** Anything that iterates `Game.soldiers` (rewards, stats, casualties, formation) must not see the command center, turrets or the truck; they live in `Game.assets`. No asset is ever healed or repaired.
24. (v0.8B) **The mounted gun has fixed stats** (`CFG.mountedGun`): no training, Elite, trait or Rally modifiers. A downed gunner never remounts; the gun stays silent for the rest of the mission.
25. (v0.8B, v0.8B.1) **The truck never moves through a friendly**: it yields to anyone in its lane (`blockers`), stops for anyone wedged against its body (`pinned`; it backs off at most `pinBackMax` px per incident), and the squad keeps off its body (`makeWay` for goals in its lane, `clearOf` for slots inside it, `around` for straight legs through it, `sweep` ahead of it). Nobody is ever teleported: `stepAside` sets a walked `clearGoal`. A destroyed truck downs the gunner, never kills them outright; the aftermath is bounded (40 s cap).
26. (v0.8B, v0.8B.1) **Enemy budgets are finite**: Mission 13 at most 79 (12 + 7 + 60), Mission 14 at most 81 (27 placed + 54 ambush); every response group, wave and ambush fires once, and a fired ambush always lands in full (never with a wreck).
27. (v0.8B.1) **One charge per successful activation, nothing else touches charges**: every class ability goes through `activateAbility`; charges never regenerate (time, medkits, healing, extraction) and reset only at deployment / Retry. Revives, ordinary weapons, the mounted gun, pickups and Tactical Support never read charges. New classes (Demolitions Expert) inherit this by extending `BaseAbility`.
28. (v0.8B.1) **Ability Capacity is capped at 3 uses** (rank 2): nothing (Elite, traits, support) may raise `capacity` beyond `ABILITY_CAPACITY.uses`; `resetCharges` clamps to 1..3.
29. (v0.8B.1) **Mission 13 waves start once each, start to start** (`minGap` 12 s, early at ≤ `nextWhenLeft` 4 left, `maxGap` 35 s) and overlap; the defense completes only after the last wave spawned in full and every attacker is down.
30. (v0.8B.1) **Off-screen enemies only shoot stationary assets** (command center, turrets); the escort truck is attacked from on screen only.

## v0.7B: shipped

- Elite Levels 2-30 on the curve 600 + 45 × (L − 1) (35,670 XP to ELITE 30), cumulative `eliteXp`, multi-level awards, cap.
- Elite 30 vs Elite 1: +25% max HP, +15% damage; Infantry / Heavy -10% spread, Medic +10% Field Treatment healing, Sniper -10% aim time. Linear per level.
- Results ELITE LEVEL UP! line, profile XP / next level / MAX LEVEL / bonus, Barracks ELITE n badge with Elite XP bar, squad slot ★n + spec.
- Save v9; genuine v0.7A save fixture `tools/fixtures/v0.7A-save.json`; suite `tools/elite-progression.cjs`.

## v0.7B.1: shipped

- Accelerating training (individual and squad), prices / limits / save unchanged, every rank ≥ v0.7B. Max: damage +50%, HP +57.5%, spread -55%, fire rate +35%, move speed +22.5% of class base; squad HP +12.5%, damage +10%, spread -12.5%, fire rate +6.25%.
- Training tab shows current → next value for the selected soldier, the exact gain and the rank bought.
- Mission XP by mission number: 125 (M1) … 150 (M5), then +10 per mission (M10 200, M40 500, M50 600). Bonuses and x0.75 replay unchanged; Credits unchanged.
- Deviation from the brief: HP keeps its 5% first rank (no nerf), so max HP training is +57.5% at Level 1 / +46% at Level 25, a little above the +35-45% target; damage lands at +50% / +42%.

## v0.7C: what is open

- Elite pace after v0.7B.1: Missions 1-10 now pay ~94-275 XP per soldier, so ELITE 30 is roughly 130-250 Chapter 1-2 missions, and faster once later chapters (400-600 XP) exist. Worth a playtest.
- Enemy scaling for Chapters 3-10 (see the v0.7B.1 completion report in the project thread): grow encounter size and mix rather than HP. Engine squad cap is 6; enemy count, flow-field rebuilds and projectile counts are the perf limits to watch (`?perf=1` overlay).

- Measured v0.7A passive gains (tools/elite.cjs): Ironclad / Adrenaline exactly 20% / 25%, Overdrive +25% fire rate, Rally +10%, Miracle Worker 3.85 s revive with 50% HP.
- **Pace** (v0.7B note, superseded by the v0.7B.1 mission XP above): the Elite curve is two numbers in `ELITE_PROGRESSION.xp`; a retune never lowers a stored level (save repair raises XP instead).
- Balance after playtests (unchanged in v0.7B on purpose): Recon Deadeye (~+10% sustained), Phantom Shot (~+28% vs front armor, x2.12 vs the Iron Warden), Perfect Aim (~+31% when holding; the autopilot rarely charges it).
- Overdrive and Rally have no button and no HUD meter beyond the panel label and ground effects; consider a small meter if players miss them.
- Not started (later releases): Tactical Airstrikes, Nuclear Strikes, Support Shop, Chapter 3, decorations / medals, new classes.

## v0.7C: shipped

- Tactical Airstrike: 3+ deployed Elites, free, once per attempt; aim (touch / drag / mouse, never moves the squad), CONFIRM / CANCEL, 2.0 s delay, 120 px radius, 260 damage with linear falloff to 50% (armored x0.6, objectives x0.5, boss 15% of max HP x falloff).
- Nuclear Strike: 6 deployed Elites, 3,000 CR each from Barracks → SUPPORT, persistent stock; confirm → LAUNCH (spent and saved at once) → 30 s simulation-time countdown → 1000 damage to every enemy on the map (objectives x0.5, boss 40% of max HP). One per attempt.
- Floors: boss 10% max HP, objectives 1 HP; no friendly fire; no XP / kill credit / stats for support kills.
- Save v9 unchanged (optional `account.support`); genuine v0.7B.1 fixture loads with stock 0 and no notes.
- Suite `tools/support.cjs` (81 checks).

## v0.7C → v0.7D: what was open (kept for reference)

- **The nuke is unreachable in the live campaign** until Mission 13 exists (six-soldier squads). It was tested through the dev harness; a real playtest needs Chapter 3.
- **Balance after playtests**: airstrike 260 / 120 px and nuke 1000 / 40% boss are first numbers. The airstrike at Mission 3+ with three Elites may make Chapter 1 trivial for veterans; the nuke at 3,000 CR may be too cheap once Chapter 3 Credits arrive. All live-tunable in `CFG.airstrike` / `CFG.nuke`.
- **HUD size on small phones**: the support buttons scale with the 1280×720 stage like the rest of the HUD (about 69×27 CSS px on an iPhone SE). They work, but are smaller than the 44 pt guideline; consider a minimum size for all HUD buttons.
- **Detonation frame**: about 10-22 ms (median of three warm runs, varies per run) / 37-39 ms (first, cold) for update + render under a 4x CPU throttle with ~47 enemies (headless, not a phone). One possible dropped frame at 30 FPS; watch with `?perf=1` once real six-Elite missions exist.
- `CFG.nuke.vehicleMul` / `CFG.airstrike.vehicleMul` apply only to non-objective vehicles, and every current vehicle is an objective; they matter once escort vehicles exist.
- Ideas not started: more Support Shop items, support cooldown upgrades, Chapter 3 content, decorations / medals, new classes.

## v0.7D: shipped

- Squad Training 5 → 10 ranks, locked cumulative tables: HP +3 / 7 / 12 / 18 / **25** / 29 / 33.5 / 38.5 / 44 / **50%**, Damage +2 / 5 / 9 / 14 / **20** / 23 / 26.5 / 30.5 / 35 / **40%**, Accuracy −3 / 7 / 12 / 18 / **25** / 29 / 33.5 / 38.5 / 44 / **50%** spread, Fire Rate +1.5 / 3.5 / 6 / 9 / **12.5** / 14.5 / 16.75 / 19.25 / 22 / **25%** (of the class base, added once to growth + individual training).
- Prices ranks 1-5 unchanged, 6-10 = 4,500 / 5,500 / 7,000 / 8,500 / 10,000 CR (46,250 per category, 185,000 for all four). Credit rewards unchanged.
- Existing ranks keep their number and get the new value automatically (v0.7C Squad Damage 5 = +10% → +20%); save v9, no migration (checked with the genuine v0.7C save fixture).
- Squad Training tab rebuilt (rank /10, current, next, gain in points of class base, one soldier's real stat preview, MAXED).
- AIRSTRIKE / NUKE side by side with ≥ 44 CSS px touch areas on phones; CONFIRM / CANCEL / LAUNCH ≥ 44 px tall.
- Spread-floor fix for > 100% combined spread reduction (moving penalty no longer collapses to 0).
- Suite `tools/squad-training.cjs`; `training-rebalance.cjs` / `progression.cjs` expectations moved to the 10-rank squad tables.

## v0.7D.1: what shipped and what is open

Shipped: Option D from `/mnt/project-files/minisquad/v0.7D.1/ACCURACY-PROPOSAL-v0.7D.1.md` (soft standing floor 0.5° wide, moving penalty floor share 0.5, additive training and base spreads untouched), previews of the standing + moving gain (`signedDeg` / `STAT_VIEW.accuracy.gain` in `src/menus.ts`), the `--t44` touch areas for mute / pause / settings (`src/style.css`, `#topbtns`), `tools/accuracy.cjs`. Code: `PROGRESSION.spreadSoftness` / `moveFloorShare` and `softFloor()` in `src/progression.ts`, the soft-floor block in `effectiveStats` (`src/classes.ts`).

Open:
- **Future combat improvement, separate review: target leading.** Rounds are not led, so accuracy training can lower the hit chance against *crossing* enemies (a tight cone lands behind a moving target: tightly trained Infantry / Heavy / Medic hit 13-15% of a rifleman advancing at 45° at 300-400 px, untrained 25-35%; the Sniper's 540 px shots too). Not changed; see the proposal section 8.
- Fully trained soldiers are effectively 100% accurate vs stationary targets while moving (accepted by design, no deliberate nerf).
- A band of Sniper builds (about 40-60% combined training) is up to 0.18° wider when moving than in v0.7D (worst hit loss 3.0 points, Dead Calm Sniper at 300 px); every fully trained Sniper is better.
- Both new constants are live in `PROGRESSION`; moving share 0.75 would soften the fully trained Sniper's gain (51% instead of 65% moving hits at 540 px).
- Pause / mute / settings: resolved by the `--t44` pattern. New HUD controls (Commando, Demolitions Expert abilities) should reuse it.

## v0.7D: what was open (accuracy saturation and the top buttons are resolved in v0.7D.1)

- **Accuracy saturates** for fully trained soldiers: with individual Accuracy 10, squad Accuracy reaches the 1° floor at rank 8 (Infantry / Heavy / Medic) and rank 2 (Sniper), so later ranks only help partially trained soldiers and new recruits. The tables are locked; if this bothers players, the lever is the floor or the individual table, not the squad table.
- **Pause / mute / settings (top right) are still 44 stage px** (~23 CSS px on an iPhone SE). Not in the v0.7D brief; the same `--t44` pattern would work, but the three buttons sit 8 px apart, so their touch areas would need a layout change (e.g. one menu button).
- **Squad Training at 185,000 CR** is designed for a 50-mission economy; with Chapter 1-2 Credits (~500-1,150 per mission) ranks 6-10 are a long goal. Watch the pace once Chapter 3 Credits exist.
- Nuke still unreachable in the live campaign until Mission 13 (six-soldier squads); performance with six Elites is measured only in the dev harness (headless, CPU-throttled), not on a phone.
- Chapter 3 enemy scaling (see v0.7C notes): fully upgraded Elite Heavy Gunners now do ~31% more sustained damage than the v0.7C maximum (172.8 vs 131.8 damage/s per Weapons Specialist before passives), so Missions 11-15 should grow encounter size and mix.

## v0.8B.1: what shipped and what is open

Shipped: Ability Capacity (training row per soldier, ranks 0/1/2 = 1/2/3 uses per mission, 0 / 1,500 / 3,000 CR, `x/y` on every portrait, charges reset per deployment, revives unlimited, Tactical Support untouched), Mission 13 waves 10/14/16/20 (60 attackers, ~80% siege, start-to-start 12-35 s with early start at <=4 left, overlapping, budget 79), Mission 14 route doubled (2,845 -> 5,865 px, Ambushes 1-3 unchanged, Ambush 4 = 5 R + 7 A, Ambush 5 = 7 R + 6 A + 2 SN, 54 ambushers, roadblock truck targeting 3x / half range), truck footprint collision (yield, back-up, side/corner steering, reachable gunner ejection, no teleports), off-screen enemies may only fire at stationary assets, pending ambush groups still spawn after the truck arrives. Tools: `tools/v081.cjs` (67 checks, `BASE=`), `tools/v081-collision.cjs` (12 stress scenarios, `BASE=` prints the v0.8B result: 4/12), `tools/v081-e2e.cjs` (starts from `tools/fixtures-v08b/v0.8B-m12-cleared.json`), `tools/v081-sim.cjs` (balance batches, `SCEN=`, `RUNS=`, `THROTTLE=`). Save v9 unchanged; `abilityCapacity` is an additive per-soldier field (absent = rank 0) clamped to 0-2.

Open:
- **M14 with a moderate (untrained L12) squad** wins about 60% with a gunner and loses without one; trained/Elite squads win reliably. If phones show it too hard, the levers are `RoadblockTargeting` (k 3, reach 0.5) and the Ambush 4/5 `after` staggers in `missions.ts`.
- **Ground bitmap** is now 6,300 x 2,000 (12.6 Mpx, ~50 MB). Under iOS's 16.7 Mpx canvas limit, but watch memory on older iPhones.
- The truck back-up rescue (`pinBackAfter` / `pinBackMax`) never triggers in sims; it is a safety net for players who park inside the truck's path.
- Mission 15, the Demolitions Expert and Chapters 4-5 are still not started.

## v0.8B: what shipped and what is open

Shipped: the sixth deployment slot (Missions 13 / 14), the friendly asset system (command center, turrets, truck), Mission 13 Hold the Line (caches, turrets, command zone start, gates, four waves, allies, siege attackers), Mission 14 Supply Line Sabotage (depots, capture, gunner selection, mounted gun, escort truck, three ambushes, wreck aftermath), exact briefings, `tools/chapter3b.cjs` and `tools/chapter3b-sim.cjs`. Save v9 unchanged.

Open:
- **Mission length**: the autopilot clears M13 in ~3-3.8 min and M14 in ~2.3 min (level 12, six soldiers). Check on phones; levers are listed in the README known issues.
- Mission 15, the Demolitions Expert and Chapters 4-5 are not started; `mission-15` is a non-playable placeholder row.
- `fps-parity BASE=<v0.8A>` is identical on Missions 1-12 (nothing changed there); Missions 13 / 14 have no base to compare against.

## v0.8A: what shipped and what is open

Shipped: mission briefings (M1-12), enemy group awareness, extraction pressure presets, Mission 11 Resistance Rising (zones in any order, safehouse defence, three resistance allies), Mission 12 Artillery Hunt (three guns, searchlights, artillery alert, markers, shells), the Commando class (dual independent pistols, Bullet Storm, Gunslinger / Assault Specialist), the Recon Specialist rename, 44 CSS px touch areas on every portrait ability button, `tools/chapter3a.cjs`. Red Canyon's pressure points sit at the canyon's west end (the only edge off screen from that extraction zone). Save v9 unchanged; every fixture saves byte-identically to v0.7D.1.

Open:
- **Mission length**: the autopilot clears M11 in ~2.5 min and M12 in ~1.5-1.7 min at level 12 (M10: ~2.5 min). Real players will be slower, but check on phones whether 4-6 minutes is reached; the levers are zone defender counts, wave sizes (`SafehouseDefenseObjective` waves) and gun HP (900).
- **Awareness tuning** wants phone playtests: radius 300, reaction 0.3-0.8 s, search 12 s, sniper standoff 0.72 (all live in ⚙).
- **Target leading** (from v0.7D.1) is still not implemented, by instruction.
- `fps-parity BASE=` against pre-0.8A builds differs by design (awareness). The 30 / 60 FPS parity within this build passes.
- Chapter 3B: done in v0.8B (Missions 13 / 14 and the sixth slot); Mission 15, Demolitions Expert, Inferno and General Voss remain.
- The `alertLog.broadcasts` counter used by the tools also counts hits on enemies outside awareness (waves, structures). Diagnostic only.
