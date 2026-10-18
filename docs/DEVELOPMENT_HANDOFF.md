# MiniSquad development handoff (current state)

> **Snapshot as of v0.8B.2 Gameplay Polish (on top of v0.8B.1 `601dbc2` and test infrastructure Phase 2), written 2026-10-18.** Before relying on it, check `git log --oneline -5 origin/main` and `package.json`. If `main` has moved on, the newer commits and their reports win; update this file at the end of your milestone.

Replace this file's sections in place when a milestone ships; do not append release logs. Release history goes in [CHANGELOG.md](CHANGELOG.md), the previous append-only handoff is in [archive/DEVELOPMENT_HANDOFF_HISTORY.md](archive/DEVELOPMENT_HANDOFF_HISTORY.md).

Related: [CLAUDE.md](../CLAUDE.md) (how to work) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SYSTEM_MAP.md](SYSTEM_MAP.md) · [README](../README.md) (player rules and numbers).

## Version

| | |
|---|---|
| Release | v0.8B.2, Gameplay Polish (on v0.8B.1 Difficulty, Extended Escort & Ability Capacity) |
| `package.json` | `version` 0.8.3, `versionLabel` "0.8B.2" |
| Commit | the v0.8B.2 commit on `main` (see `git log`; v0.8B.1 gameplay was `601dbc2`) |
| Save | v9 (`SAVE_VERSION` in `src/save.ts`), key `minisquad.save` |
| Deploy | push to `main` → Cloudflare Workers serves `./dist` (`wrangler.jsonc`) |

## What is in the game

**Missions** (all playable, sequential unlocks, `src/campaign.ts`):

| Chapter | Missions |
|---|---|
| 1 | 1 First Contact · 2 Heavy Support · 3 Field Medicine · 4 Red Canyon Ambush · 5 Bring Them Home |
| 2 Behind Enemy Lines | 6 Bridgehead · 7 Prison Break · 8 Convoy Crusher · 9 Blackout (night) · 10 Operation Iron Fist (Iron Warden boss) |
| 3 The Resistance | 11 Resistance Rising · 12 Artillery Hunt (night) · 13 Hold the Line (defense) · 14 Supply Line Sabotage (escort) · 15 placeholder, not playable |

Squad caps: M1–2 → 2, M3–5 → 3, M6 → 4, M7–12 → 5, M13+ → 6. Roster cap 12.

**Classes** (`src/classes.ts`): Infantry (Grenade), Heavy Gunner (Suppressive Fire), Medic (Field Treatment), Sniper (Focus; unlocked by the first clear of M9), Commando (dual pistols, Bullet Storm; unlocked by the first clear of M12). Each class has two Elite specializations.

**Campaign progression**: a new campaign owns Ace and Ranger. First clears unlock the next mission, named recruit offers (Tank M1, Doc M2, Havoc M5, Patch M7; 1,000 CR each, never free) and classes (Sniper M9, Commando M12). Stars are kept per mission and never go down; replays pay 75% XP.

**Systems shipped**:
- Real-time squad combat: auto-targeting, physical projectiles, spread cones, cover, downed / revive / bleed-out (20 s), helicopter extraction with the left-behind warning and extraction pressure.
- Enemies: Riflemen, Snipers (laser telegraph; v0.8B.2: 65 damage, 935 px/s round), Armored Troopers, Watchtowers, convoy trucks, Iron Warden boss; group awareness (v0.8A).
- Recruitment Office (three offers, refresh, rename, dismiss), named campaign recruits, class unlocks.
- Permanent death: KIA, resurrection prices, Memorial, Operation Phoenix, interrupted-mission recovery.
- Progression: Recruit Levels 1–25, individual training (10 ranks), Squad Training (10 ranks), accuracy soft floor, mission XP by mission number.
- Elite: promotion at Recruit 25 for 3,000 CR, 10 specializations with passives, Elite Levels 1–30.
- Ability Capacity: 1 / 2 / 3 uses per mission per soldier (0 / 1,500 / 3,000 CR); revives unlimited.
- Tactical Support: free airstrike with 3 deployed Elites, Nuclear Strike (3,000 CR, stock) with 6.
- Friendly assets (command center, turrets, escort truck), mounted gun, resistance allies, gunner selection.
- Settings (⚙) for players: frame cap, performance overlay, version. Developer tuning (CFG sliders, debug actions, config JSON) only with `?dev=1`, memory only, never saved (v0.8B.2).
- Mission 14 hides route progress, distance and the ambush count during the escort (v0.8B.2).
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
- Enemy budgets are finite (M13 ≤ 79, M14 ≤ 81); waves and ambushes fire once.
- The truck never moves through a friendly and nobody is teleported.
- Settlement happens once per run id; a failed mission makes downed soldiers KIA; quitting mid-mission brings downed soldiers home (known, accepted).

## Test status

Run with `npm test -- all` (28 rule suites, ~27 min headless; `BASE` = v0.8B built automatically, v0.8B.1 for `v082`). Last full run (v0.8B.2, 2026-10-18): 26 of 28 passed on the first pass; `barracks` (dev panel now needs `?dev=1`) and `squad-training` F1 (enemy Sniper delta) were test expectations, fixed and rerun green. tsc and build clean. Per-suite checks as below plus `v082` 36. Phase 2 per-suite checks: `logic` 86, `maps` 10, `accuracy` 31, `barracks` 41, `campaign-rules` 77, `recruitment` 76, `recruit-mobile` 51, `failure-recruit` 56, `failure-recruit-mobile` 36, `permadeath` 107, `permadeath-mobile` 63, `progression` 115, `training-rebalance` 42, `squad-training` 61, `elite` 79, `elite-progression` 63, `support` 81, `mobile` 117, `chapter2` 95, `chapter2-mobile` 36, `chapter3a` 91, `chapter3b` 98, `v081` 67, `v081-collision` 12, `v081-e2e` 15, `fps-default` 15, `fps-parity` 17.

**Known failures:** none.

**v0.8B.2 test changes (behaviour changed on purpose, assertions kept):** `support` E8, `training-rebalance` E5 and `squad-training` F1 compare enemy numbers with the v0.8B BASE; they now accept exactly the enemy Sniper delta (30 → 65 damage, 1100 → 935 px/s) and still require every other number to match. `barracks` opens the dev panel with `?dev=1` (unlock-all, dev squad preset). New `v082` suite (36 checks; BASE v0.8B.1).

**Resolved in the Phase 2 follow-up:**
- `squad-training` E1 (Squad Training buy buttons 32 px on phones since `601dbc2`): CSS fix. The phone-landscape `min-height: 32px` rule in `src/style.css` now targets `.t-panel:not(.q-panel) .t-buy` (Individual Training only); Squad Training and the Support shop are back to 36 px on iPhone SE / iPhone 14 / Pixel 7, desktop unchanged.
- `chapter3a` D7 "allies join and fight" (0 shots in 2 of 10 runs): timing, not an ally bug. The first wave spawns ~850 px out and walks in; allies first acquire a target at ~7–7.5 s, so the old fixed 8 s window often closed before or just after contact. The check now counts shots over 6 s from the moment an attacker is inside an ally's weapon range (reached at 5.1–6.1 s): 12–20 shots in 10 of 10 runs, assertion `shots > 0` kept.

**Resolved in Phase 2 (test-only, assertions kept):**
- `logic` "Quick Reflexes in combat": 5 of 20 old runs failed (ratio 1.008–1.098 vs a 1.03–1.07 window). Cause: the measured walk included the random wander wobble (`unit.wander = Math.random() * 100`, ±6 px on the goal) and bumps into randomly spawned Mission 3 enemies. Both soldiers now start at the same wobble phase with the lane kept clear: ratio 1.051 in every run. Class speeds (150 / 157.5) were always right; not a gameplay bug.
- `squad-training` C6b and `training-rebalance` E2: release-delta checks that compared against `BASE` and so only passed with BASE = v0.7D / v0.7B, while the same suites' "identical to BASE" checks need the latest release (against v0.7B / v0.7C, D9, E5, C4, F1 fail by design). Their v0.7D / v0.7B side is now the recorded output of the real 4edf546 / 095bba2 builds, so they pass against the v0.8B base. Not gameplay bugs.

**Other notes:** `accuracy` and `support` fail without `BASE` (the runner always provides it). `chapter3b-e2e` is superseded (run by name only); use `v081-e2e`. `fps-parity --base <v0.8B>` differs on Missions 1–12 by design (one ability use per mission). Under heavy parallel load `elite` D5 and some `progression` double-tap checks have flaked; the runner runs suites one at a time. `maps` covers only the Mission 1–10 maps.

## Known issues

- v0.8B.2 enemy Sniper buff vs Mission 13 (autopilot, which never or only crudely dodges lasers): level-12 "mod" squad with both caches won 4/10 vs 8/10 on v0.8B.1, with sniper-caused downs up 2-5×; trained ("well") squads unchanged (4/4). Mission 14 win rates unchanged within noise. Waves were left as approved; see the v0.8B.2 report for the open decision.
- Mission 14 with an untrained level 12 squad wins about 60% with a gunner and loses without one (autopilot); trained / Elite squads win reliably. Levers: `RoadblockTargeting` and Ambush 4–5 `after` staggers in `src/missions.ts`.
- Mission 14's map is 6,300 × 2,000 (~50 MB ground, kept as 2,048 px strips). Watch memory on older iPhones.
- Mission lengths are measured with the autopilot only; human timings on phones are still needed.
- Rounds are not led, so tight accuracy can lower hit chance against crossing targets (design item, not scheduled).
- Mission 5's "captive takes no damage" optional is strict. Mission 4 should not get harder (permadeath).

## Outstanding work and approved priorities

**Next gameplay milestones (not started):**
1. **Mission 15: General's Last Stand** (end of Chapter 3; the `mission-15` row in `src/campaign.ts` is a placeholder). Earlier notes also mention Inferno and General Voss for Chapter 3.
2. **Recruitable Demolitions Expert** class (must extend `BaseAbility` so Ability Capacity applies; reuse `--t44` for new HUD controls).

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
- Phase 3, mission-mechanic architecture improvements (reduce `Game` hub coupling): not started, separate assignment.

**Roadmap:** Missions 16–25 (Chapters 4–5); land mines provisionally planned for Chapter 4, enemy vehicles for Chapter 5. Missions 16+ would raise recruit starting levels (`RECRUIT_LEVELS`) and mission XP automatically.
