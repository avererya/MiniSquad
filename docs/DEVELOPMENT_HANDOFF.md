# MiniSquad development handoff (current state)

> **Snapshot as of v0.8B.1, commit `601dbc2`, written 2026-10-18.** Before relying on it, check `git log --oneline -5 origin/main` and `package.json`. If `main` has moved on, the newer commits and their reports win; update this file at the end of your milestone.

Replace this file's sections in place when a milestone ships; do not append release logs. Release history goes in [CHANGELOG.md](CHANGELOG.md), the previous append-only handoff is in [archive/DEVELOPMENT_HANDOFF_HISTORY.md](archive/DEVELOPMENT_HANDOFF_HISTORY.md).

Related: [CLAUDE.md](../CLAUDE.md) (how to work) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SYSTEM_MAP.md](SYSTEM_MAP.md) · [README](../README.md) (player rules and numbers).

## Version

| | |
|---|---|
| Release | v0.8B.1, Difficulty, Extended Escort & Ability Capacity |
| `package.json` | `version` 0.8.2, `versionLabel` "0.8B.1" |
| Commit | `601dbc2` on `main` (gameplay); docs-only commits may follow |
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
- Enemies: Riflemen, Snipers (laser telegraph), Armored Troopers, Watchtowers, convoy trucks, Iron Warden boss; group awareness (v0.8A).
- Recruitment Office (three offers, refresh, rename, dismiss), named campaign recruits, class unlocks.
- Permanent death: KIA, resurrection prices, Memorial, Operation Phoenix, interrupted-mission recovery.
- Progression: Recruit Levels 1–25, individual training (10 ranks), Squad Training (10 ranks), accuracy soft floor, mission XP by mission number.
- Elite: promotion at Recruit 25 for 3,000 CR, 10 specializations with passives, Elite Levels 1–30.
- Ability Capacity: 1 / 2 / 3 uses per mission per soldier (0 / 1,500 / 3,000 CR); revives unlimited.
- Tactical Support: free airstrike with 3 deployed Elites, Nuclear Strike (3,000 CR, stock) with 6.
- Friendly assets (command center, turrets, escort truck), mounted gun, resistance allies, gunner selection.
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

## Test status at v0.8B.1

From the v0.8B.1 report (`/mnt/project-files/minisquad-reports/v0.8B.1-report.md` in the project files): `tsc` and build clean; `v081` 67/67, `v081-collision` 12/12, `v081-e2e`, `chapter3b` 98/98, `chapter3a` 91/91, `elite` 79/79, `elite-progression` 63/63, `support` 81/81, `accuracy` 31/31, `progression`, `permadeath`, `recruitment`, `failure-recruit`, `campaign-rules`, `barracks`, `chapter2`, all five phone suites, `fps-default` and `fps-parity` pass.

**Known failures (pre-existing, also fail on v0.8B):**
- `squad-training` C6b (57/58): squad accuracy rank 0 with max individual training versus the v0.7D expectation.
- `training-rebalance` E2 (41/42): "previously trained soldiers get the new benefits automatically".
- `logic` "Quick Reflexes in combat" (85–86/86): intermittent speed-ratio check, flaky since v0.6.1.

**Other notes:** `chapter3b-e2e` is superseded (its v0.8B autopilot now loses the harder missions); use `v081-e2e`. `fps-parity BASE=<v0.8B>` differs on Missions 1–12 by design (one ability use per mission). Under heavy parallel load `elite` D5 and some `progression` double-tap checks have flaked.

## Known issues

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
- *Planned, not implemented:* hide Mission 14's route-progress indicator, keeping truck health and objective information.
- *Planned, not implemented:* hide the player-facing damage / HP tuning sliders while keeping developer tuning (`src/tuning.ts`).
- *Planned, not implemented:* enemy sniper rebalance: significantly more damage, slightly slower and more dodgeable projectiles (`CFG.enemySniper` `damage` / `projectileSpeed`, possibly `lockTime`). Final values need verification and testing.

**Investigations:**
- The three pre-existing failures above (`squad-training` C6b, `training-rebalance` E2, `logic` Quick Reflexes): decide for each whether the test or the expectation is stale. Do not weaken assertions to pass.

**Efficiency programme:**
- Phase 1, navigation docs (this file, CLAUDE.md, ARCHITECTURE, SYSTEM_MAP, archives): done.
- Phase 2, centralized test runner: not started, separate assignment.
- Phase 3, mission-mechanic architecture improvements (reduce `Game` hub coupling): not started, separate assignment.

**Roadmap:** Missions 16–25 (Chapters 4–5); land mines provisionally planned for Chapter 4, enemy vehicles for Chapter 5. Missions 16+ would raise recruit starting levels (`RECRUIT_LEVELS`) and mission XP automatically.
