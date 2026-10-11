# MiniSquad development handoff (after v0.7D)

Current release: **v0.7D — Squad Training Expansion & Mobile Polish** (package 0.7.4, label `versionLabel: "0.7D"`), on top of v0.7C Tactical Support, v0.7B.1 Progression & Training Rebalance, v0.7B Elite Progression and v0.7A Elite Promotions.
Rules and numbers: README → "Elite Promotions (v0.7A)", "Elite Progression (v0.7B)", "Progression & Training Rebalance (v0.7B.1)", "Tactical Support (v0.7C)" and "Squad Training Expansion & Mobile Polish (v0.7D)". This file is what the next step (Chapter 3: Missions 11-15, Commando, Demolitions Expert) needs.

## Workflow

- Repo `avererya/MiniSquad`. A push to `main` deploys to Cloudflare Workers. Never touch the `prototype-v0.1` tag (the git proxy refuses tag pushes anyway).
- Serve a build and run the headless suites: `npm run build && npx vite preview --port 4173`, then `node tools/<suite>.cjs` (`URL=` to point elsewhere, `OUT=` for screenshots).
- Regression set used for v0.7D: `squad-training` (with `BASE=<v0.7C build>`; `QUICK=1` skips the long runs), `training-rebalance`, `progression`, `support` (with `BASE=`), `elite-progression` and `fps-parity` (with `BASE=`), then the v0.7B set below.
- Regression set used for v0.7C: `support` (with `BASE=<v0.7B.1 build>`), `fps-parity` (with `BASE=`), `training-rebalance` and `elite-progression` (with `BASE=`), then the v0.7B set below.
- Regression set used for v0.7B.1: `training-rebalance` (with `BASE=<v0.7B build>`), then the v0.7B set below. `progression.cjs` expectations follow the v0.7B.1 XP / training values.
- Regression set used for v0.7B: `elite-progression` (with `BASE=<v0.7A build>`), `elite logic permadeath recruitment failure-recruit progression campaign-rules barracks chapter2 fps-default` and `fps-parity` (with `BASE=<previous build>` to prove a change leaves the Recruit-only simulation bit-identical). The suites that check the save version expect v9.
- To serve a previous build for `BASE=`: `git worktree add /tmp/base <commit> && (cd /tmp/base && npm ci && npm run build)`, then `npx vite preview --port 4174 --outDir /tmp/base/dist`.
- Known pre-existing flakes: `logic.cjs` Ranger Quick Reflexes move-speed check and the escort-formation timing check fail intermittently on unchanged builds. `support.cjs` F2 (detonation frame < 33 ms under a 4x throttle) is timing-noisy: it also fails on the unchanged v0.7C build (2 of 3 runs passed there in the v0.7D session).
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

## v0.7D: what is open

- **Accuracy saturates** for fully trained soldiers: with individual Accuracy 10, squad Accuracy reaches the 1° floor at rank 8 (Infantry / Heavy / Medic) and rank 2 (Sniper), so later ranks only help partially trained soldiers and new recruits. The tables are locked; if this bothers players, the lever is the floor or the individual table, not the squad table.
- **Pause / mute / settings (top right) are still 44 stage px** (~23 CSS px on an iPhone SE). Not in the v0.7D brief; the same `--t44` pattern would work, but the three buttons sit 8 px apart, so their touch areas would need a layout change (e.g. one menu button).
- **Squad Training at 185,000 CR** is designed for a 50-mission economy; with Chapter 1-2 Credits (~500-1,150 per mission) ranks 6-10 are a long goal. Watch the pace once Chapter 3 Credits exist.
- Nuke still unreachable in the live campaign until Mission 13 (six-soldier squads); performance with six Elites is measured only in the dev harness (headless, CPU-throttled), not on a phone.
- Chapter 3 enemy scaling (see v0.7C notes): fully upgraded Elite Heavy Gunners now do ~31% more sustained damage than the v0.7C maximum (172.8 vs 131.8 damage/s per Weapons Specialist before passives), so Missions 11-15 should grow encounter size and mix.
