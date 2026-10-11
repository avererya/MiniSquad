# MiniSquad development handoff (after v0.7B)

Current release: **v0.7B — Elite Progression (Levels 2-30)** (package 0.7.1, label `versionLabel: "0.7B"`), on top of v0.7A Elite Promotions.
Rules and numbers: README → "Elite Promotions (v0.7A)" and "Elite Progression (v0.7B)". This file is what the next step (v0.7C) needs.

## Workflow

- Repo `avererya/MiniSquad`. A push to `main` deploys to Cloudflare Workers. Never touch the `prototype-v0.1` tag (the git proxy refuses tag pushes anyway).
- Serve a build and run the headless suites: `npm run build && npx vite preview --port 4173`, then `node tools/<suite>.cjs` (`URL=` to point elsewhere, `OUT=` for screenshots).
- Regression set used for v0.7B: `elite-progression` (with `BASE=<v0.7A build>`), `elite logic permadeath recruitment failure-recruit progression campaign-rules barracks chapter2 fps-default` and `fps-parity` (with `BASE=<previous build>` to prove a change leaves the Recruit-only simulation bit-identical). The suites that check the save version expect v9.
- To serve a previous build for `BASE=`: `git worktree add /tmp/base <commit> && (cd /tmp/base && npm ci && npm run build)`, then `npx vite preview --port 4174 --outDir /tmp/base/dist`.
- Known pre-existing flakes: `logic.cjs` Ranger Quick Reflexes move-speed check and the escort-formation timing check fail intermittently on unchanged builds.

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

## Invariants to keep

1. **Elite Level 1 is never weaker than Recruit Level 25** and is exactly the v0.7A soldier. The stat pipeline still reads the Recruit level (25) for Elites; the v0.7B level bonus is one multiplier per stat in `eliteModifiers` (null at Elite 1), next to the trait.
2. **No randomness, fixed step.** Passives run only in the 1/60 s simulation step and never call `Math.random`. Recruit-only squads must stay bit-identical to the previous build (`fps-parity.cjs BASE=`).
3. **Stable ids.** Saves store spec ids, never titles; display names can change freely.
4. **The ledger is the source of truth for a paid promotion.** `cleanElite` restores tier / path from it. If a later release adds anything bought (e.g. Elite perks), give it a ledger and a repair rule the same way.
5. **Caps**: incoming reduction ≤ 40% (`maxDamageReduction`), per-shot multiplier ≤ x2 (`maxShotMul`). New Elite bonuses must go through these.
6. `eliteXp` is cumulative and never spent or reset; `eliteLevel` is derived from it (at settlement and on load). A load never lowers a stored v9 level (XP is raised to its threshold instead). If anything is ever bought with Elite XP, give it its own ledger instead of subtracting.
7. Elite levels touch only max HP, damage and one class stat (spread / heal / aim time). Keep fire rate and move speed out (perf + balance).

## v0.7B: shipped

- Elite Levels 2-30 on the curve 600 + 45 × (L − 1) (35,670 XP to ELITE 30), cumulative `eliteXp`, multi-level awards, cap.
- Elite 30 vs Elite 1: +25% max HP, +15% damage; Infantry / Heavy -10% spread, Medic +10% Field Treatment healing, Sniper -10% aim time. Linear per level.
- Results ELITE LEVEL UP! line, profile XP / next level / MAX LEVEL / bonus, Barracks ELITE n badge with Elite XP bar, squad slot ★n + spec.
- Save v9; genuine v0.7A save fixture `tools/fixtures/v0.7A-save.json`; suite `tools/elite-progression.cjs`.

## v0.7C: what is open

- Measured v0.7A passive gains (tools/elite.cjs): Ironclad / Adrenaline exactly 20% / 25%, Overdrive +25% fire rate, Rally +10%, Miracle Worker 3.85 s revive with 50% HP.
- **Pace**: at 110-200 XP per mission, ELITE 30 takes roughly 180-320 missions per soldier. That follows the v0.7B spec; worth a human playtest before v0.7C content lands. The curve is two numbers in `ELITE_PROGRESSION.xp`; a retune never lowers a stored level (save repair raises XP instead).
- Balance after playtests (unchanged in v0.7B on purpose): Recon Deadeye (~+10% sustained), Phantom Shot (~+28% vs front armor, x2.12 vs the Iron Warden), Perfect Aim (~+31% when holding; the autopilot rarely charges it).
- Overdrive and Rally have no button and no HUD meter beyond the panel label and ground effects; consider a small meter if players miss them.
- Not started (later releases): Tactical Airstrikes, Nuclear Strikes, Support Shop, Chapter 3, decorations / medals, new classes.
