# MiniSquad development handoff (current state)

> **Snapshot as of Phase 3 Architecture Optimization (internal, on v0.8C.1 `924dc13`), written 2026-10-24.** Before relying on it, check `git log --oneline -5 origin/main` and `package.json`. If `main` has moved on, the newer commits and their reports win; update this file at the end of your milestone.

Replace this file's sections in place when a milestone ships; do not append release logs. Release history goes in [CHANGELOG.md](CHANGELOG.md), the previous append-only handoff is in [archive/DEVELOPMENT_HANDOFF_HISTORY.md](archive/DEVELOPMENT_HANDOFF_HISTORY.md).

Related: [CLAUDE.md](../CLAUDE.md) (how to work) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SYSTEM_MAP.md](SYSTEM_MAP.md) · [README](../README.md) (player rules and numbers).

## Version

| | |
|---|---|
| Release | v0.8C.1, Story & Cinematic Presentation (Mission 15 story, reusable dialogue system; on v0.8C General's Last Stand) |
| `package.json` | `version` 0.8.5, `versionLabel` "0.8C.1" |
| Commit | the v0.8C.1 commit on `main` (see `git log`; v0.8C was `1acc610`) |
| Save | v9 (`SAVE_VERSION` in `src/save.ts`), key `minisquad.save` |
| Deploy | push to `main` → Cloudflare Workers serves `./dist` (`wrangler.jsonc`); production https://minisquad.ryanaverett1996.workers.dev (check Settings for the label and commit) |

## What is in the game

**Missions** (all playable, sequential unlocks, `src/campaign.ts`):

| Chapter | Missions |
|---|---|
| 1 | 1 First Contact · 2 Heavy Support · 3 Field Medicine · 4 Red Canyon Ambush · 5 Bring Them Home |
| 2 Behind Enemy Lines | 6 Bridgehead · 7 Prison Break · 8 Convoy Crusher · 9 Blackout (night) · 10 Operation Iron Fist (Iron Warden boss) |
| 3 The Resistance | 11 Resistance Rising · 12 Artillery Hunt (night) · 13 Hold the Line (defense) · 14 Supply Line Sabotage (escort) · 15 General's Last Stand (fortress assault, General Voss) |

Squad caps: M1–2 → 2, M3–5 → 3, M6 → 4, M7–12 → 5, M13+ → 6. Roster cap 12.

**Classes** (`src/classes.ts`): Infantry (Grenade), Heavy Gunner (Suppressive Fire), Medic (Field Treatment), Sniper (Focus; unlocked by the first clear of M9), Commando (dual pistols, Bullet Storm; unlocked by the first clear of M12), Demolitions Expert (rocket launcher with splash, Inferno; unlocked by the first clear of M15, 1,500 CR). Each class has two Elite specializations.

**Campaign progression**: a new campaign owns Ace and Ranger. First clears unlock the next mission, named recruit offers (Tank M1, Doc M2, Havoc M5, Patch M7; 1,000 CR each, never free) and classes (Sniper M9, Commando M12, Demolitions Expert M15). Mission 15 is the last mission; no Chapter 4 rows exist. Stars are kept per mission and never go down; replays pay 75% XP.

**Systems shipped**:
- Real-time squad combat: auto-targeting, physical projectiles, spread cones, cover, downed / revive / bleed-out (20 s), helicopter extraction with the left-behind warning and extraction pressure.
- Enemies: Riflemen, Snipers (laser telegraph; v0.8B.2: 65 damage, 935 px/s round), Armored Troopers, Watchtowers, convoy trucks, Iron Warden boss, General Voss (M15: three phases, Rally, radioed reinforcements); group awareness (v0.8A).
- Fortress mechanics (v0.8C): lockdown gates that open when an objective falls (`MissionScript.lockdown`, `Mission.openGate`), live-count group objectives, generator / relay objectives.
- Recruitment Office (three offers, refresh, rename, dismiss), named campaign recruits, class unlocks.
- Permanent death: KIA, resurrection prices, Memorial, Operation Phoenix, interrupted-mission recovery.
- Progression: Recruit Levels 1–25, individual training (10 ranks), Squad Training (10 ranks), accuracy soft floor, mission XP by mission number.
- Elite: promotion at Recruit 25 for 3,000 CR, 10 specializations with passives, Elite Levels 1–30.
- Ability Capacity: 1 / 2 / 3 uses per mission per soldier (0 / 1,500 / 3,000 CR); revives unlimited.
- Tactical Support: free airstrike with 3 deployed Elites, Nuclear Strike (3,000 CR, stock) with 6.
- Friendly assets (command center, turrets, escort truck), mounted gun, resistance allies, gunner selection.
- Settings (⚙) for players: frame cap, performance overlay, version. Developer tuning (CFG sliders, debug actions, config JSON) only with `?dev=1`, memory only, never saved (v0.8B.2).
- Mission 14 hides route progress, distance and the ambush count during the escort (v0.8B.2).
- Story (v0.8C.1, `src/story.ts`, `src/storyview.ts`): data-driven scenes at mission cues (`MissionScript.story`, `Mission.cue`, once per attempt). Mission 15: a blocking pre-boss cinematic when Voss enters (simulation suspended via `Game.modal = 'story'`), non-blocking radio lines at his 70% / 35% phases, a blocking victory cinematic once the defenders are cleared, then the normal extraction. Tap / Enter / Space next, SKIP / Esc skip, auto-advance in simulation time (~10 s each). OVERWATCH is Command's callsign; lines never name a recruit. Text-only comic panels; `portrait` fields take artwork later (`public/story/`).
- Mobile: landscape layout on a scaled 1280×720 stage, safe areas, rotation re-layout, ≥ 44 CSS px touch areas, 30 FPS default on phones with identical simulation at 60.

## Save compatibility requirements

- Every fixture in `tools/fixtures/` (v0.2.2 → v0.7C) and `tools/fixtures-v08b/v0.8B-m12-cleared.json` must load with no unexpected repair notes and keep every soldier, Credit and rank.
- New optional fields are preferred over a version bump (`abilityCapacity`, `account.support` stayed on v9). A version bump needs a `pre-*` backup key, a migration in `parseSave`, a main-menu notice in `src/main.ts` and a fixture from the previous build.
- Store stable ids (soldier, mission, spec), never display names. Paid items need a ledger and a repair rule (`account.promotions`, `support.purchased/launched`).
- Never lower something a player paid for: training ranks never get weaker than in an earlier release, prices and Squad Training tables are locked, a load never lowers a stored Elite level.
- Missions are never unlocked without the previous clear; new mission ids that an older save could not list go in the `expected` list in `parseSave`.

## Rules that must hold

Condensed from the 30 invariants in the [archived handoff](archive/DEVELOPMENT_HANDOFF_HISTORY.md#invariants-to-keep); read that list before touching Elite, training, support, awareness, assets or Mission 13–14.
- Fixed 1/60 s step for all gameplay timers; 30 and 60 FPS must play identically (`fps-parity`).
- All damage goes through `Game.damage`: Elite caps (≤ 40% reduction, ≤ ×2 per shot), support floors (boss ≥ 10%, objectives ≥ 1 HP).
- `activateAbility` is the only path that spends a charge; capacity is capped at 3; charges reset only at deployment / Retry.
- Allies, captives and assets are never in `Game.soldiers` and never touch the account.
- Enemy budgets are finite (M13 ≤ 79, M14 ≤ 81, M15 = 48 + Voss); waves, ambushes and Voss's phases fire once.
- Mission 15: Voss's range ≤ every soldier's; no medkit past the inner gate; no checkpoint (a reload restarts the mission); the gates cannot be bypassed.
- The truck never moves through a friendly and nobody is teleported.
- Story cinematics never change gameplay: anything added to `Game.update` before the `modal` return must be presentation only; auto-advance runs on the fixed step; no save fields for cues.
- Settlement happens once per run id; a failed mission makes downed soldiers KIA; quitting mid-mission brings downed soldiers home (known, accepted).

## Test status

**Phase 3 run (2026-10-24, on v0.8C.1 + Phase 3):** `npm test -- all` (31 rule suites incl. the new `arch`, 28 min): 29 passed on the first pass. `support` C5 / C7 (airstrike falloff "exact values": an enemy drifted 15.5-22 px off the strike centre before impact, so the `dist[0] < 15` precondition fails; values themselves match) failed 1 of 7 reruns here and **3 of 8 on the untouched v0.8C.1 build** (`--url`), so pre-existing timing flakiness, not Phase 3 (`src/support.ts` untouched). `chapter2` "captive-centred formation" (inside-ring 0.72 vs 0.75 with 2 soldiers) failed once and passed 7 reruns here and 8 of 8 on v0.8C.1; the captive code is untouched and `fps-parity` shows Missions 5 / 7 bit-identical, so it is unseeded randomness (flaky, watch). Equivalence proof: `fps-parity --base 924dc13` with `MISSIONS` = all 15 missions plus `last-stand@voss` / `@story`: 90 / 90 (30 / 60 / 90 / 120 Hz and every mission's 60 s simulation identical to v0.8C.1); `arch` D1 / D2 (CFG, Missions 1-15 data, a seeded grenade + rocket firefight) identical; a deliberate 1% blast change makes `arch` fail (B1, B3, B4, D2), so the suite has teeth.

Run with `npm test -- all` (30 rule suites, ~29 min headless; `BASE` = v0.8B built automatically, v0.8B.1 for `v082`, v0.8B.2 for `v08c`). v0.8C.1 run (2026-10-21, groups `logic missions ui persistence fps` = 27 suites incl. the new `story`, 56 checks): 24 passed on the first pass. `v08c` B10 needed the pre-boss cinematic skipped (test change, below) and is green 2/2. `v082` A12 (enemy Sniper behind cover, 8 s) failed once and passed 10 reruns on this build and 8 on the v0.8C build (`--url`; there only C2 fails, by design, since it reads the label from the current `package.json`); `elite` D23 (Perfect Aim charge while moving) failed once in the 28-minute run and passed on rerun; neither touches Mission 15 or the story code. tsc and build clean. Not run this release: `combat`, `progression`, `permadeath`, `recruitment` groups outside those listed (no code there changed); last full `all` was v0.8C. Earlier (v0.8C, 2026-10-18): 27 of 29 passed on the first pass; `chapter3a` C1 / C2 and `v082` C2 were test expectations, fixed and rerun green.

**Known failures:** none. Flaky: `chapter3a` A5 (alerted enemies walk to the last known position) failed once in 6 runs in v0.8C and 1 in 12 on the v0.8B.2 build; v0.8C.1: 11 of 11 runs passed (not reproduced, not investigated further). `v082` A12 and `elite` D23 each failed once in a long combined run (see above), not reproduced.

**v0.8C.1 test changes (behaviour changed on purpose, assertions kept):** the pre-boss cinematic now suspends the mission when Voss enters, so the Voss setup helpers in `v08c` (`T.voss`, C20, the D chain) and `tools/perf-lib.cjs` (`last-stand@voss`) call `game.story.skip(game)` right after starting his objective; `fps-parity` adds `last-stand@story` (the cinematic plays out, then the fight) and hashes the story state. New `story` suite (BASE v0.8C).

**v0.8C test changes (behaviour changed on purpose, assertions kept):** Mission 15 is playable and unlocked by Mission 14, so `campaign-rules` (Chapter 3 tab: 5 missions, 15 stars), `chapter2` / `chapter3b` (M15 playable, chain ends `last-stand`), `v081-e2e` 12 / 13 and the legacy `chapter3b-e2e` now expect `last-stand` instead of the `mission-15` placeholder; `barracks` (unlock-all opens 15 missions); `recruitment` (Demolitions 1,500 / 350 added to the price list); `elite` A1 (12 specializations); `support` A2 (three six-soldier missions); `chapter3a` C1 (15 briefings) and C2 (no briefing before Mission 15 names Voss); `v082` C2 reads the label from `package.json`. BASE comparisons in `training-rebalance` E5 and `squad-training` C4 skip only the new v0.8C groups (`demolitions`, `general`, `rocket`, `inferno`, the Demolitions Elite 30 extra); `v08c` G1 compares every older CFG group and Missions 1-14 with v0.8B.2.

**v0.8B.2 test changes (behaviour changed on purpose, assertions kept):** `support` E8, `training-rebalance` E5 and `squad-training` F1 compare enemy numbers with the v0.8B BASE; they now accept exactly the enemy Sniper delta (30 → 65 damage, 1100 → 935 px/s) and still require every other number to match. `barracks` opens the dev panel with `?dev=1` (unlock-all, dev squad preset). New `v082` suite (36 checks; BASE v0.8B.1).

**Resolved in the Phase 2 follow-up:**
- `squad-training` E1 (Squad Training buy buttons 32 px on phones since `601dbc2`): CSS fix. The phone-landscape `min-height: 32px` rule in `src/style.css` now targets `.t-panel:not(.q-panel) .t-buy` (Individual Training only); Squad Training and the Support shop are back to 36 px on iPhone SE / iPhone 14 / Pixel 7, desktop unchanged.
- `chapter3a` D7 "allies join and fight" (0 shots in 2 of 10 runs): timing, not an ally bug. The first wave spawns ~850 px out and walks in; allies first acquire a target at ~7–7.5 s, so the old fixed 8 s window often closed before or just after contact. The check now counts shots over 6 s from the moment an attacker is inside an ally's weapon range (reached at 5.1–6.1 s): 12–20 shots in 10 of 10 runs, assertion `shots > 0` kept.

**Resolved in Phase 2 (test-only, assertions kept):**
- `logic` "Quick Reflexes in combat": 5 of 20 old runs failed (ratio 1.008–1.098 vs a 1.03–1.07 window). Cause: the measured walk included the random wander wobble (`unit.wander = Math.random() * 100`, ±6 px on the goal) and bumps into randomly spawned Mission 3 enemies. Both soldiers now start at the same wobble phase with the lane kept clear: ratio 1.051 in every run. Class speeds (150 / 157.5) were always right; not a gameplay bug.
- `squad-training` C6b and `training-rebalance` E2: release-delta checks that compared against `BASE` and so only passed with BASE = v0.7D / v0.7B, while the same suites' "identical to BASE" checks need the latest release (against v0.7B / v0.7C, D9, E5, C4, F1 fail by design). Their v0.7D / v0.7B side is now the recorded output of the real 4edf546 / 095bba2 builds, so they pass against the v0.8B base. Not gameplay bugs.

**Other notes:** `accuracy` and `support` fail without `BASE` (the runner always provides it). `chapter3b-e2e` is superseded (run by name only); use `v081-e2e`. `fps-parity --base <v0.8B>` differs on Missions 1–12 by design (one ability use per mission). Under heavy parallel load `elite` D5 and some `progression` double-tap checks have flaked; the runner runs suites one at a time. `maps` covers only the Mission 1–10 maps.

## Known issues

- **Mission 15 balance is autopilot-only (open decision).** Headless `v08c-sim` (RUNS=4): Elite squad with a Siege Breaker 4/4 wins, level-18 trained squad 3/4, the same without a Demolitions Expert 2/4 (winnable without the class), level-12 untrained squads 0/4 (all lost at Voss, mostly to his rifle and Rally-boosted guards). The autopilot uses no cover and dodges crudely; it also loses Mission 10 at level 12. Headless runs last 150-230 s against the 7-10 minute human target. Levers if playtests find it too hard: `CFG.general` (accuracy 10, projectileSpeed 430, fireRate), `CALL_STAGGER` (6 s) in `src/general.ts`, `arena-guard` aggro and composition, generator / relay HP (1,200 / 1,000), the courtyard medkit.
- Off-screen "ENEMIES" / objective arrows at the top edge can sit over the objective panel (and the boss bar) on phones; pre-existing in every mission, more visible with the Voss bar. Not changed (render-only, all missions).
- v0.8B.2 enemy Sniper buff vs Mission 13 (autopilot, which never or only crudely dodges lasers): level-12 "mod" squad with both caches won 4/10 vs 8/10 on v0.8B.1, with sniper-caused downs up 2-5×; trained ("well") squads unchanged (4/4). Mission 14 win rates unchanged within noise. Waves were left as approved; see the v0.8B.2 report for the open decision.
- Mission 14 with an untrained level 12 squad wins about 60% with a gunner and loses without one (autopilot); trained / Elite squads win reliably. Levers: `RoadblockTargeting` and Ambush 4–5 `after` staggers in `src/missions.ts`.
- Mission 14's map is 6,300 × 2,000 (~50 MB ground, kept as 2,048 px strips). Watch memory on older iPhones.
- Mission lengths are measured with the autopilot only; human timings on phones are still needed.
- Rounds are not led, so tight accuracy can lower hit chance against crossing targets (design item, not scheduled).
- Mission 5's "captive takes no damage" optional is strict. Mission 4 should not get harder (permadeath).

## Outstanding work and approved priorities

**Next gameplay milestones (not started):**
0. Comic artwork for the Mission 15 cinematics (v0.8C.1 left `portrait` slots; files go in `public/story/`). Human check of the cinematic pacing on phones.
1. **Human playtest of Mission 15 on phones** (length, Voss difficulty for level 12-18 squads, Rally readability, Inferno use). See the known issue above for the levers.
2. Chapter 4 (Missions 16+): not started; needs new `CHAPTERS` / `CAMPAIGN` rows. Done in v0.8C: Mission 15 General's Last Stand and the Demolitions Expert.

**Approved playtest feedback:**
- Mission 13's harder difficulty: approved, keep.
- Mission 14's extended route and difficulty: approved, keep.
- Done in v0.8B.2: Mission 14 route-progress hidden; player-facing tuning sliders moved behind `?dev=1`; enemy Sniper 65 damage / 935 px/s (`lockTime` unchanged: the measured dodge window was already enough).
- Open: human playtest of the sniper buff in Missions 13-14 on phones (autopilot shows Mission 13 harder for level-12 squads).

**Investigations:**
- None open from Phase 2.

**Efficiency programme:**
- Phase 1, navigation docs (this file, CLAUDE.md, ARCHITECTURE, SYSTEM_MAP, archives): done.
- Phase 2, centralized test runner (`npm test`, `tools/test.cjs`, `tools/test-suites.cjs`, `tools/lib.cjs`): done. Follow-ups: move more suites onto `tools/lib.cjs` (only `maps`, `barracks`, `recruit-mobile` so far; the rest still hard-code the `/opt/node22` Playwright path), widen `maps` to Missions 11–14, optional parallel jobs.
- Phase 3, architecture optimization for Chapters 4–5: done (2026-10-24, on v0.8C.1; no gameplay change, package 0.8.5, label still v0.8C.1, save v9). See [Phase 3](#phase-3-architecture-optimization) below.
- Follow-ups (not scheduled): move older suites onto `tools/lib.cjs` and its page helpers when they are next edited; widen `maps` to Missions 11–15 (and 16+ as they land); optional parallel jobs.

**Roadmap:** Missions 16–25 (Chapters 4–5); land mines provisionally planned for Chapter 4, enemy vehicles for Chapter 5. Missions 16+ would raise recruit starting levels (`RECRUIT_LEVELS`) and mission XP automatically.

## Phase 3 architecture optimization

Plan written before editing, then implemented as planned: three small extension points, nothing moved, Missions 1–15 and every number unchanged (proven against v0.8C.1 `924dc13`, see Test status).

**Audit (how Chapter 4–5 content would be added on v0.8C.1):**
- Missions / objectives: good. Objectives are self-contained state machines fed by `MissionEvent`s; triggers, dormant `guard` groups and lockdown worlds already cover ambushes and gating. Friction: every mechanic module (convoy, boss, general, artillery, escort) is a hard-wired `Mission` field with its own lines in `start`, `unitStep`, `emit` and `draw`, so mines / fuel depots / engineers would each have edited `src/mission.ts` in four places.
- Environment: adequate. `building` obstacles already block movement, line of sight and rounds; Mission 18's streets are map data. Destructible things are `structure` units (targeting, `structureDestroyed`, support floor already work).
- Damage: `Game.damage` is the single, well-guarded path. Friction: area damage was duplicated (grenade `explode`, rocket splash; support has its own per-class rules) and only ever hurt one team, while mines, fuel tanks and wrecks need a blast that can hurt both teams with wall cover.
- Enemies: kind-specific behaviour is spread over about eight files (`spawnEnemy`, `enemy.ts`, `awareness.ts`, `targeting.ts`, `combat.ts` armor / `rocketMul`, `support.ts`, `render.ts`); `KIND_CFG` is a typed `Record`, so the compiler finds the first step. The `vehicle` flag means "convoy truck" (never shoots, never pursues, not a kill), so Chapter 5 combat vehicles must be a new kind.
- HUD: objective lines / chips / meters cover mission information; the boss bar is a two-branch special case (Iron Warden, Voss).
- Saves: no change needed for in-mission mechanics (per attempt); new missions need campaign rows and the `expected` list in `parseSave` (recipe).
- Tests: strong regression suites, but every chapter suite re-implements the same page helpers and data snapshot; `fps-parity` with `BASE` is the bit-exact equivalence check.

**Ranked improvements** (value for Chapters 4–5 vs complexity / risk):
1. Done: `MissionScript.mechanics` / `MissionMechanic` (`src/mission.ts`, +34 lines). A mechanic is one module plus one script line; Mission calls `start` / `step` / `onEvent` / `draw`. Missions 1–15 declare none.
2. Done: `blastDamage` (`src/combat.ts`). One area-damage loop (falloff, optional wall cover, skip, per-victim multiplier, either or both teams) through `Game.damage`; `explode` and `rocketImpact` call it with the same arithmetic.
3. Done: shared test page helpers (`tools/lib.cjs`: `openPage`, `seedRandom`, `window.T`, `missionSnapshot`) and the `arch` suite (BASE v0.8C.1).
4. Deferred: an enemy-kind profile table (targeting / flags / "heavy" in one row). Saves two or three edits per kind but touches eight files to centralise; documented as the "Add an enemy kind" recipe instead.
5. Deferred: splitting `vehicle` into "convoy truck" and "combat vehicle". Belongs to the Chapter 5 vehicle design; documented in the recipe.
6. Deferred: a generic boss bar. One `src/hud.ts` branch when Mission 20 is built; generalising now would be speculative.
7. Deferred: migrating the ~40 older suites onto `tools/lib.cjs` (large churn, no gameplay value now).
8. Rejected: decomposing `Game.update` / the `Game` hub (high risk, no measurable benefit for the planned content).

**Before / after:** a Chapter 4 mine field before Phase 3 = a `mines` field on `Mission`, a `MissionScript` field, lines in `Mission.start`, `unitStep`, `emit` and `draw`, and a copied blast loop with its own falloff / cover rules. After: `class MineField implements MissionMechanic` in its own file calling `blastDamage(..., { victims: [...g.enemies, ...g.enemyVictims()], cover: true })`, plus `mechanics: () => [new MineField(...)]` in the Mission 16 script; its suite starts from `tools/arch.cjs` with `openPage` / `T` / `missionSnapshot` instead of ~60 copied helper lines. Recipes with code sketches: [ARCHITECTURE.md](ARCHITECTURE.md#recipes).

**Recommended Chapter 4 sequence:** (1) Chapter 4 `CHAPTERS` / `CAMPAIGN` rows, the `expected` id and Mission 16 with the `MineField` mechanic (decide how a detected mine is targeted: structures are only shot when no enemy is in sight); (2) the Scout enemy kind (recipe; flanking in `src/enemy.ts`); (3) Mission 17 fuel infrastructure (structures + a chain-blast mechanic); (4) Mission 18 Ambush Alley (map data, dormant groups, triggers; extend `maps` for reachability); (5) Mission 19 prisoner rescue (captive / escort patterns); (6) Mission 20 boss (`src/general.ts` pattern plus a boss-bar branch). Each mission: a chapter suite on the shared helpers, `fps-parity` with the mission added to `MISSIONS`, and `arch` D1 style "Missions 1–15 unchanged" against the previous release.