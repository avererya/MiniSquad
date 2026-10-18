# README release notes archive

Moved unchanged from the README in the documentation cleanup after v0.8B.1. Each block is labelled with the README section it came from. These notes describe the state at the time of each release (test counts, autopilot timings, open questions); for the current state see [../DEVELOPMENT_HANDOFF.md](../DEVELOPMENT_HANDOFF.md). Links into the README were repointed to `../../README.md`.

## Chapter 2: Behind Enemy Lines (v0.6.2): tests

- **Tests**:
  - `tools/chapter2.cjs`: spec section 13, 94 checks.
  - `tools/chapter2-mobile.cjs`: iPhone SE, iPhone 14 and Pixel 7 landscape HUD and menus, rotation, and screenshots.
  - `tools/maps.cjs`: reachability on all 10 maps.
  - `tools/chapter2-sim.cjs`: spec section 14. These are automated simulations with a scripted player, **not** human playtests.

## Chapter 2: Behind Enemy Lines (v0.6.2): judgment calls and known issues

### Judgment calls (v0.6.2)

- Water blocks movement but not line of sight, so you can shoot across the river.
- On M6 and M10 the optional "No soldier KIA" replaces the global whole-squad line in the stars, the same overlap rule as Mission 3.
- Campaign chapter tabs instead of one long list, so 10+ missions fit a phone without scrolling.
- Snipers roll only the three Sniper traits, and generic traits are no longer rolled for Snipers.
- The first boss rocket fires at 20 s, the bottom of the spec's 20-30 s range. The interval after that is 24 ± 3 s, so it stays within 20-30 s.
- Tuning was set during development with the automated sims:
  - boss MG damage 4 per bullet
  - truck HP 1,000
  - relay HP 900
  - convoy gap 14 s
- Mission 11 is a "Coming soon" placeholder in the Chapter 3 tab.

### Known issues (v0.6.2)

- The automated sims finish missions faster than the spec's target durations (see the simulation results). A scripted bot that never hesitates is faster than people, so human timings are still needed before re-tuning.
- Mission 5's optional (captive takes no damage) is still strict: one grazing hit fails it. In automated sims the scripted bot met it in a minority of runs (see the simulation results). Human skill (clearing pursuers before moving) should do better, but this is unverified.
- A freshly recruited level 3 Sniper (75 HP) is the soldier most often downed on Mission 10 in the sims. A level-matched Sniper clearly helps (see the simulation results). Recommend humans test whether new Snipers need positioning help (for example, holding at the back of the formation) before any HP change.
- `tools/logic.cjs`: the Ranger Quick Reflexes move-speed check is still intermittent. This is pre-existing and also fails on the v0.6.1 baseline.

## Difficulty, Extended Escort & Ability Capacity (v0.8B.1): tests

**Tests**: `tools/v081.cjs` (the new rules, with `BASE=` against an unchanged v0.8B build), `tools/v081-collision.cjs` (12 collision stress scripts), `tools/v081-e2e.cjs` (real menus from a v0.8B save through Missions 13 and 14 and both failure paths), `tools/v081-sim.cjs` (autopilot balance with mod / well / elite squads and Ability Capacity ranks).

## Chapter 3B (v0.8B): tests and tuning notes

**Tests**: `tools/chapter3b.cjs` (98 checks: sixth slot, M13, M14, saves, phones), `tools/chapter3b-sim.cjs` (autopilot balance runs; `THROTTLE=4` for perf), `tools/chapter3b-e2e.cjs` (real menus from a Mission 12 save through Missions 13 and 14, gunner picked by tapping), `fps-parity.cjs` hashes assets and the escort.

**Known issues / tuning notes (v0.8B)**:
- The autopilot (level 12, six soldiers) clears Mission 13 in about 3-3.8 minutes and Mission 14 in about 2.3 minutes; human players should take roughly 5-7 and 4 minutes, but check on phones. Levers: wave sizes and `CFG.defense` gaps (M13), ambush sizes, depot HP 800 and `CFG.escortTruck.moveSpeed` 72 (M14).
- M13 autopilot: the command center ends at about 550-900 HP without turrets and 970+ with both. M14: the truck ends at about 330-500 HP with a gunner (the gun deals ~280-450 damage, 5-11 kills) and 280-470 HP with No Gunner.
- Roadblocks rarely trigger when the squad clears the road ahead of the truck, which is the intended way to play.

## Chapter 3A (v0.8A): tuning notes

**Known issues / tuning notes (v0.8A)**:
- Autopilot runs finish Mission 11 in about 2.5 minutes and Mission 12 in about 1.5-1.7 minutes at level 12; a human playing carefully should take longer, but phone playtests should check whether the missions feel long enough.
- The awareness broadcast counter used by the tools also counts hits on enemies outside awareness (waves, structures). It is a diagnostic only.

## Elite Progression (v0.7B): tests

**Tests**: `tools/elite-progression.cjs` (curve, stats vs the v0.7A build with `BASE=`, settlement, passives at Elite 1 / 15 / 30, caps, save v9 / v8 migration with the genuine v0.7A fixture `tools/fixtures/v0.7A-save.json`, KIA / resurrection / Memorial, Results / profile / Barracks on three phones, Elite 30 squads in Missions 1-10, 30 / 60 FPS parity).

## Progression & Training Rebalance (v0.7B.1): tests

**Tests**: `tools/training-rebalance.cjs` (with `BASE=<v0.7B build>`: prices and limits, accelerating ranks, never weaker than v0.7B, Sniper path, max damage / HP, caps, pipeline order and no double application, Elite 30 bonus and combat caps, preview = post-purchase in the real UI, mission XP 1-50, replays, Credits / thresholds / enemies identical to v0.7B, v0.7B save with training loads unchanged and gets the new benefits, save / reload, KIA + resurrection, Training tab on three phones, fully trained Elite 30 squads in Missions 1-10 and at 30 / 60 FPS). `tools/progression.cjs` expectations moved to the new XP and training values.

## Tactical Support (v0.7C): tests

**Tests**: `tools/support.cjs` (brief items 1-44: data, eligibility, airstrike targeting / delay / falloff / friendly fire / floors, shop and stock, launch / countdown / pause / detonation / floors / failure / reload, v0.7B.1 save, rewards / XP / KIA / training / enemy numbers identical to v0.7B.1 with `BASE=`, 30 / 60 FPS parity with both strikes, detonation cost under a 4x CPU throttle, touch flows and layout on iPhone SE / iPhone 14 / Pixel 7; screenshots to `$OUT`).

## Accuracy Soft Floor & HUD Touch Areas (v0.7D.1): tests

**Tests**: `tools/accuracy.cjs` (every rank narrows both cones for every class / trait / Elite 30 combination; floor never crossed; bit-identical above 1.5° and no-loss bounds vs v0.7D with `BASE=`; tables / prices / bases unchanged; tuned bases under the floor; genuine v0.7C save; preview text; combat cone; touch areas ≥ 44 × 44 on three phones, no overlap with the objective box in all ten missions, timer, support buttons, panels or warnings; edge taps; desktop layout identical). `squad-training.cjs` C6 / C6b and `progression.cjs` expectations moved to the soft floor.

## Squad Training Expansion & Mobile Polish (v0.7D): tests and performance measurements

**Tests**: `tools/squad-training.cjs` (brief items 1-38: tables, prices and totals, purchases and refusals, Credit rewards / individual training / XP curves / enemies / missions / support numbers identical to v0.7C with `BASE=`, bonus on every soldier and new recruits applied once, passives / buffs / caps, spread floor, Heavy Gunner fire rate and projectiles, preview = post-purchase, genuine v0.7C save, ranks 6-10 and a fully upgraded account through reload, repair clamps, KIA / resurrection / Memorial, Squad Training tab and HUD touch areas on iPhone SE / iPhone 14 / Pixel 7 / desktop, airstrike and nuke flows by touch, Missions 1-10 won by fully upgraded squads, 30 / 60 FPS parity with six fully upgraded Elites, and a performance pass; screenshots to `$OUT`).

**Performance** (headless Chromium, iPhone 14 landscape viewport at DPR 3, 4x CPU throttle; not a real phone): six fully upgraded Elites (Elite 30, all individual training, Squad Training 10/10/10/10, three Weapons Specialist Heavy Gunners at 12.0-12.6 shots/s each) against 40 enemies, then abilities, an airstrike impact and a nuke detonation. One 30 FPS frame = 2 fixed simulation steps + 1 render; median of three runs:

| Phase | v0.7D p50 / p95 / max (ms) | v0.7C, same scenario |
|---|---|---|
| Firefight (120 frames) | 14.2 / 36.0 / 53.3 | 15.9 / 40.1 / 68.3 |
| Abilities active (45) | 12.4 / 23.4 / 38.9 | 12.6 / 29.6 / 55.8 |
| Airstrike impact (20) | 11.5 / 37.1 / 37.1 | 12.3 / 24.6 / 24.6 |
| Nuke detonation (30) | 7.4 / 35.2 / 45.5 | 7.2 / 28.9 / 33.0 |

Peak 37 squad projectiles in flight and ~480 particles. Every phase's median frame fits the 33 ms budget at 30 FPS, with occasional single frames over it in both builds (about 6% of firefight frames); v0.7D is within run-to-run noise of v0.7C. No optimization was needed. The simulation is bit-identical at 30 / 60 FPS caps on 60 and 120 Hz displays with this squad, both strikes included. Caveat: the headless rasterizer stalls for 1-2.5 s when hundreds of frames are rendered in one synchronous call (any build), so the measurement yields between frames like a real frame loop.

## Planned cleanup (playtest notes from v0.6 / v0.6.1)


- Mission 4 (Red Canyon Ambush) is challenging but manageable in human play. In the v0.5 autopilot, L1-recruit squads won it 5 times in 11 attempts. With permanent death, **do not increase its difficulty**.
- ~~Mission 5 (Bring Them Home): the captive trails at the back of the squad~~ done in v0.6.2: the protective ring formation (Missions 5 and 7), see Chapter 2.
- Mission 5's optional "The captive takes no damage" is hard to get (same cause).
- `tools/logic.cjs`: the Ranger Quick Reflexes move-speed check fails intermittently (timing-sensitive measurement, pre-existing).
- ~~Design question (v0.6): a failed mission brings downed soldiers home~~ resolved in v0.6.1: downed soldiers are KIA when a mission fails.
- Design question (v0.6.1): closing / reloading the app mid-mission still brings downed (not yet KIA) soldiers home without rewards, so quitting is a possible exploit. Kept as is on purpose; a separate decision (no retreat mechanic exists).
- Broader campaign difficulty tuning after more human playtesting. v0.6.1 changed no mission difficulty, but failed missions now cost lives, so deaths will rise naturally.

## Code map (as of v0.8B.1)


TypeScript + Vite + plain 2D canvas, no framework.

- `src/config.ts`: every gameplay number, including per-class stats (the tuning panel edits it live)
- `src/classes.ts`: class registry (stats group, ability, look), soldier identity, effective stats, squad presets
- `src/traits.ts`: natural trait registry and the stat modifier math (class base → trait → individual modifiers)
- `src/progression.ts`: XP curve, mission XP by mission number (v0.7B.1), level growth, Credits rules, accelerating training tables (v0.7B.1), the 10-rank Squad Training tables (v0.7D), the account, and the effective-stat pipeline (class base → level + training + squad training, additive % of base → trait → temporary effects)
- `src/economy.ts`: mission settlement (once per run id; v0.6 KIA, career, decision batch, KIA journal + interrupted-mission recovery), atomic training purchases, the v0.5 recruitment transactions (recruit, refresh, dismiss, rename) and the v0.6 resurrect / Memorial / Operation Phoenix transactions, all with rollback
- `src/elite.ts`: v0.7A specializations (stable ids, titles, passives), promotion rules, and the combat passives (Rally aura, Overdrive / Perfect Aim tick, per-shot and per-hit multipliers, incoming damage, revive HP)
- `src/casualties.ts`: v0.6 permanent-death rules (resurrection prices, arm delays, decision blocks, Operation Phoenix eligibility)
- `src/clock.ts`: v0.6 fixed-step simulation clock (frame clamp, nothing while hidden, no catch-up)
- `src/perf.ts`, `src/perfoverlay.ts`: v0.6.3 render frame cap and pacer, performance counters and the developer performance overlay
- `src/recruitment.ts`: v0.5 Recruitment Office tables and rules (classes, prices, refunds, trait pool, starting levels, names, rename rules, candidate generation, one-time class introductions)
- `src/support.ts`: v0.7C Tactical Support (eligibility, airstrike / nuke state, damage, floors, Support Shop catalog, `spendNuke`); the purchase is `buySupport` in `src/economy.ts`
- `src/campaign.ts`: campaign data (missions, capacity table, star rules, unlocks)
- `src/missions.ts`, `src/objectives.ts`: per-mission scripts and the reusable objective modules (eliminate, destroy, capture & hold, reach, survive, free captive, optional objectives)
- `src/roster.ts`, `src/save.ts`: the roster (six campaign soldiers + recruits), unlock flags and ownership, squad selection rules, versioned local save (`minisquad.save`, v9, migrates every older version) with per-field validation and recovery
- `src/missionstats.ts`: per-soldier mission statistics and attribution rules
- `src/menus.ts`: Campaign, Barracks, soldier details (career record), Results, casualty decisions, Operation Phoenix and Memorial screens
- `src/game.ts`: game state, fixed-step update, damage, downed/revive/KIA
- `src/squad.ts`: squad anchor and loose following
- `src/enemy.ts`: Rifleman AI
- `src/awareness.ts`: v0.8A enemy group awareness (alert broadcast, reaction delay, last-known-position investigation, bounded search)
- `src/artillery.ts`: v0.8A Mission 12 searchlights, exposure, artillery alert, danger markers and shells
- `src/chapter3.ts`: v0.8A Chapter 3 objectives (liberate zones, safehouse defence, artillery guns, ally / no-alert optionals)
- `src/combat.ts`: aiming, spread, projectiles, explosions, effects
- `src/targeting.ts`: swappable target-selection strategy
- `src/abilities.ts`: ability interface, Grenade, Suppressive Fire, Field Treatment, Focus, Bullet Storm (v0.8A)
- `src/pickups.ts`: pickup interface, Medkit, Rapid Fire
- `src/mission.ts`: mission flow (objective chain, reinforcement triggers, escort NPC), extraction interface and the v0.8A extraction pressure presets
- `src/world.ts`, `src/map.ts`: collision, line of sight, pathfinding, the five maps
- `src/render.ts`, `src/hud.ts`, `src/tuning.ts`, `src/input.ts`, `src/audio.ts`: presentation and input
- `tools/*.cjs`: headless Playwright checks: `chapter3a.cjs` (v0.8A Chapter 3A: awareness, extraction pressure, briefings, Missions 11-12, Commando, older saves, phones), `accuracy.cjs` (v0.7D.1 soft spread floor + top-button touch areas, see above), `squad-training.cjs` (v0.7D Squad Training Expansion & Mobile Polish, see above), `support.cjs` (v0.7C Tactical Support, see above), `training-rebalance.cjs` (v0.7B.1 training / mission XP rebalance, see above), `elite.cjs` (v0.7A: promotion rules, save v8 repairs and the genuine v0.6.4 save `fixtures/v0.6.4-save.json`, all eight passives measured in the simulation, caps, Elite permadeath, Elite squads at 30 / 60 FPS, Missions 1-10 with Elite squads, promotion UI on iPhone SE / 14 / Pixel 7; screenshots to `$OUT`), `failure-recruit.cjs` (v0.6.1: failure KIA rules [F1]-[F14] incl. Operation Phoenix from real combat, named recruit offers [R1]-[R25], v6 migration of the genuine v0.6 save `fixtures/v0.6-save.json` and older fixtures), `failure-recruit-mobile.cjs` (v0.6.1 failure Results, casualty flow, recruit notice, Campaign Recruits, Refresh, full roster on iPhone SE / 14 / Pixel 7; screenshots to `$OUT`), `permadeath.cjs` (v0.6: bleed-out / revive timing, extraction warning, SimClock and backgrounding, mission-end transaction, decisions, restricted dismissal, Memorial, Phoenix, v0.5 fixture migration `fixtures/v0.5-save.json`, repairs, the 12 end-to-end scenarios), `permadeath-mobile.cjs` (v0.6 HUD timers, warning, casualty / Memorial / Phoenix screens on iPhone SE / 14 / Pixel 7 with rotation; `campaign.cjs` now also resolves casualties and reports the KIA rate per mission), `recruitment.cjs` (v0.5 rules, generation statistics, offers persistence, class introductions, recruit / refresh / dismiss / rename transactions, double taps, save failures, roster cap, v0.4 / v0.3 / v0.2.2 migration, repair), `recruit-mobile.cjs` (Recruitment Office, dismissal, rename with keyboard, New Campaign on phones), `campaign.cjs MODE=roster` (playthroughs with recruits), `campaign-rules.cjs` (v0.4 unlocks, caps, over-limit, stars, optionals, objectives, escort, rescue rules, squad scaling, v0.3 save), `campaign.cjs` (campaign autopilot: `MODE=new` new-player campaigns, `MODE=legacy` upgraded v0.3 roster, `MODE=fixed SQUAD=...`), `maps.cjs` (navigability + overview images), `progression.cjs` (v0.3 XP / Credits / training / save migration / phone tabs), `progression-balance.cjs` (playthroughs at different levels + economy pacing), `logic.cjs` (rule checks, PASS/FAIL), `barracks.cjs` (selection, save/reload, invalid saves, results flow), `squads.cjs` (roster squad playthroughs + stat attribution ledger), `mobile.cjs` (Barracks/Results/HUD on phones, touch, rotation), `balance.cjs` (accuracy and mission experiments), `play.cjs` (autopilot), `classes.cjs` / `lineup.cjs` (screenshots), plus the older smoke/touch/visual scripts. Serve a build first: `npm run build && npx vite preview --port 4173`
