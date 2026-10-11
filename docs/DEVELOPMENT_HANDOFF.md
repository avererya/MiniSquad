# MiniSquad development handoff (after v0.7A)

Current release: **v0.7A — Elite Promotions & Specializations** (package 0.7.0, label `versionLabel: "0.7A"`).
Rules and numbers: README → "Elite Promotions (v0.7A)". This file is what the next step (v0.7B) needs.

## Workflow

- Repo `avererya/MiniSquad`. A push to `main` deploys to Cloudflare Workers. Never touch the `prototype-v0.1` tag (the git proxy refuses tag pushes anyway).
- Serve a build and run the headless suites: `npm run build && npx vite preview --port 4173`, then `node tools/<suite>.cjs` (`URL=` to point elsewhere, `OUT=` for screenshots).
- Regression set used for v0.7A: `logic permadeath recruitment failure-recruit progression campaign-rules barracks chapter2 fps-default elite` and `fps-parity` (with `BASE=<previous build>` to prove a change leaves the Recruit-only simulation bit-identical).
- Known pre-existing flakes: `logic.cjs` Ranger Quick Reflexes move-speed check and the escort-formation timing check fail intermittently on unchanged builds.

## Where Elite lives

| Concern | File |
|---|---|
| Spec data (stable ids `inf-trooper` … `snp-deadeye`), promotion constants, passives | `src/elite.ts` |
| Passive numbers (live-tunable) | `src/config.ts` → `CFG.elite`, `CFG.boss.plating` |
| Persisted fields: `tier`, `elitePath`, `specialization` (mirror), `eliteLevel` (1..30), `eliteXp` | `src/classes.ts` (`ProgressionRecord`) |
| Promotion ledger `account.promotions` (`PromotionRecord`) | `src/progression.ts` |
| Atomic promotion `promote()` / `promotionBlock()`; Elite XP banking in `settleMission` | `src/economy.ts` |
| Save v8, `cleanElite` repairs, `minisquad.save.pre-v0.7` backup | `src/save.ts` |
| Combat hooks: `onFire` (updateWeapon), `onHit` + `pen` (updateProjectiles / modifyDamage), `incomingMul` (Game.damage), `eliteAuras` / `eliteTick` (Game.update), `reviveHpFrac` (updateDowned) | `src/combat.ts`, `src/game.ts`, `src/unit.ts`, `src/squad.ts` |
| Uniforms and per-spec shapes, ground effects, portraits | `src/render.ts` (`drawEliteBody/Back/Head`, `drawEliteGround`, `drawClassPortrait(…, spec)`) |
| Screens: promotion box, confirmation, ceremony, Elite profile, Results | `src/menus.ts`, `src/style.css` (v0.7A section) |
| HUD panel labels (AIM READY / OVERDRIVE / ADRENALINE) | `src/hud.ts` |
| Resurrection price x2 for Elites | `src/casualties.ts` |

## Invariants to keep

1. **Elite Level 1 is never weaker than Recruit Level 25.** The stat pipeline still reads the Recruit level (25) for Elites. Any Elite level growth must be added on top, never replace it.
2. **No randomness, fixed step.** Passives run only in the 1/60 s simulation step and never call `Math.random`. Recruit-only squads must stay bit-identical to the previous build (`fps-parity.cjs BASE=`).
3. **Stable ids.** Saves store spec ids, never titles; display names can change freely.
4. **The ledger is the source of truth for a paid promotion.** `cleanElite` restores tier / path from it. If v0.7B adds anything bought (e.g. Elite perks), give it a ledger and a repair rule the same way.
5. **Caps**: incoming reduction ≤ 40% (`maxDamageReduction`), per-shot multiplier ≤ x2 (`maxShotMul`). New Elite bonuses must go through these.
6. Elite XP is **banked**, not spent: `eliteXp` already holds every XP point earned after promotion (Results label "(banked)").

## v0.7B: what is open

- **Elite levels 2-30**: an XP curve over `eliteXp` (banked XP must convert on the first v0.7B load without loss), what each Elite level gives (keep it additive to the Recruit-25 base and within the caps), the Results / profile level-up display (`levelTag` already prints "ELITE n"), and save v9 with a migration that keeps `eliteXp`.
- Balance after playtests. Measured gains (tools/elite.cjs): Deadeye about +10% sustained damage (the spec's "+50% every 5th hit"); Overdrive +25% fire rate; Perfect Aim about +31% when holding position (the autopilot, which moves every few seconds, rarely charges it: worth watching in human play); Phantom Shot about +28% average vs front armor; Ironclad / Adrenaline exactly 20% / 25%; Rally +10%; Miracle Worker 3.85 s revive with 50% HP.
- Phantom Shot vs the Iron Warden is x1.6 → x2.12 on a precision hit (60% of the boss's 35% plating ignored).
- Overdrive and Rally have no button and no HUD meter beyond the panel label and ground effects; consider a small meter if players miss them.
