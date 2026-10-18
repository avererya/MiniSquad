# MiniSquad: start here

MiniSquad is a browser-based, mobile-first (landscape), real-time squad tactics game. The player steers a small squad of auto-firing soldiers through a mission campaign with class abilities, revives, extraction, recruitment, permanent death, training and Elite promotions. TypeScript + Vite + plain 2D canvas, no framework, no runtime dependencies.

## Read in this order

1. This file (conventions and validation).
2. [docs/DEVELOPMENT_HANDOFF.md](docs/DEVELOPMENT_HANDOFF.md): current state, known failures, approved next work.
3. [docs/SYSTEM_MAP.md](docs/SYSTEM_MAP.md): find the files and tests for your feature.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): only the sections you need (loop, mission lifecycle, save flow, recipes).
5. [README.md](README.md): player-facing rules and numbers. Jump to the section with `grep -n '^## ' README.md`; do not read it end to end.

Do not read [docs/CHANGELOG.md](docs/CHANGELOG.md) or `docs/archive/` unless you need history (why a rule exists, an old test note, the full 30-invariant list).

## Repository and branches

- Repo `avererya/MiniSquad`, production branch `main`. A push to `main` auto-deploys to Cloudflare Workers (static `./dist`, `wrangler.jsonc`).
- Push with a normal fast-forward. Never force-push, rewrite history, or create, move or push tags; never touch `prototype-v0.1`.
- Before editing: `git status`, `git fetch origin main`, compare `HEAD` with `origin/main`. If someone else's uncommitted work or a newer `main` is in the way, stop and report rather than overwrite.

## Current version: verify, don't trust

The handoff names the last known release (v0.8B.1, package 0.8.2, save v9 at the time of writing). Always confirm:

```
git log --oneline -5 origin/main
grep -E '"version"|"versionLabel"' package.json
grep -n 'SAVE_VERSION =' src/save.ts
```

The visible label is `versionLabel` in `package.json`; `vite.config.ts` injects it and the commit hash (`src/version.ts`, shown in Settings). Bump both `version` and `versionLabel` for a release.

## How the game runs (one paragraph)

`index.html` loads `src/main.ts`, which builds `Game` (`src/game.ts`, the state hub) and `Hud` (`src/hud.ts`, owning `Menus` and `Tuning`), loads the save (`src/save.ts`), and runs a `requestAnimationFrame` loop: `FramePacer` caps drawing (30 FPS phones / 60 desktop), `SimClock` advances fixed 1/60 s steps, each step calls `game.update`, then `render` (`src/render.ts`) and `hud.update`. A mission is a `Mission` (`src/mission.ts`) built from a `MissionScript` (`src/missions.ts`) whose objectives (`src/objectives.ts` plus mechanic modules) react to `MissionEvent`s. At the end `economy.settleMission` (`src/economy.ts`) pays XP / Credits, applies unlocks and KIA, and saves once per run id. All numbers live in `src/config.ts` (`CFG`). Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Finding code without rereading the repo

- Look the feature up in [docs/SYSTEM_MAP.md](docs/SYSTEM_MAP.md) first. It names files, symbols and tests.
- `src/` is flat. Big files: `menus.ts` and `render.ts` (~1,660 lines each), `game.ts` (~960), `save.ts` (~810), `economy.ts` (~660). Never read these whole; `grep -n` the symbol and read 40–80 lines around it.
- Useful searches: `grep -n '^export' src/<file>.ts` (a file's API), `grep -n -i '<feature>' src/*.ts` (all touchpoints, e.g. `commando`), `grep -n '<group>:' src/config.ts` (a `CFG` group), `grep -n "check('" tools/<suite>.cjs` (what a suite asserts).
- Code comments carry the release that added a rule (`// v0.8B.1 …`); they are reliable context.
- Prefer the code over older reports or project-file snapshots when they disagree.

## Tests

No unit-test framework: `tools/*.cjs` are standalone headless-Chromium scripts (Playwright at `/opt/node22/lib/node_modules/playwright`) that drive `window.game` against a served build.

```
npm ci                                       # once per checkout
npx tsc --noEmit && npm run build            # always
npx vite preview --port 4173 &               # serve dist/ for the suites
node tools/<suite>.cjs                       # URL=… OUT=dir BASE=<older build url>
```

Pick suites from the "Which tests to run" table in [docs/SYSTEM_MAP.md](docs/SYSTEM_MAP.md#which-tests-to-run). `BASE=` comparisons need a second build served on another port (recipe there). Sims (`*-sim.cjs`, `campaign.cjs`, `balance.cjs`) and perf tools print reports, not PASS/FAIL. There is no central runner yet.

## Required validation for gameplay changes

1. `npx tsc --noEmit` and `npm run build` clean.
2. The feature's suites plus `logic` and `fps-parity`; saves / economy changes also run the save suites; UI changes run the phone suites.
3. Compare against the known failures in the handoff (C6b, E2, Quick Reflexes). For any other failure, rerun it on the previous commit (`BASE=` or a worktree) before calling it pre-existing.
4. Update test expectations only when behaviour changed on purpose, and say so in the report. Never weaken or delete an assertion just to get green; never skip a test.
5. `git diff --check` before committing.

## Non-negotiables

- Preserve existing gameplay unless the task asks for a change. Preserve permadeath, recruitment, progression, mission-unlock and save rules.
- **Mobile landscape** is the target: iPhone SE 667×375, iPhone 14 844×390, Pixel 7 915×412. New HUD controls need ≥ 44 CSS px touch areas (`var(--t44)`) and must keep the left-half joystick zone free.
- **30 / 60 FPS consistency**: gameplay timers use simulation time in the fixed step; no frame-rate-dependent logic; keep random draws inside the step in a stable order. Prove it with `fps-parity`.
- **Save compatibility**: prefer optional fields over a `SAVE_VERSION` bump; clamp new fields in `src/save.ts`; every fixture in `tools/fixtures*` must still load; never lower anything a player paid for. Rules: [handoff](docs/DEVELOPMENT_HANDOFF.md#save-compatibility-requirements).
- All damage through `Game.damage`; ability charges only through `activateAbility`; allies / assets never in `Game.soldiers`.
- No large refactors or new dependencies inside a feature task. Note the opportunity in the report instead.
- Never claim a production deploy was verified unless you actually loaded the live site and checked the Settings version / commit. A successful push only means the deploy was triggered.

## Finishing a milestone

1. Review the whole diff; keep it to the task.
2. Update `docs/DEVELOPMENT_HANDOFF.md` in place (version, commit, status, open work), add a line to `docs/CHANGELOG.md`, update the README rules section for player-visible changes, and add a [SYSTEM_MAP](docs/SYSTEM_MAP.md) row for any new file or cross-file touchpoint.
3. Commit with a descriptive message, fast-forward push to `main`, report the hash.
4. Post the report below. Keep it short: results and decisions, not a transcript.

### Handoff report template

```
## <version> <title>: handoff
Version / commit: <label> (package x.y.z), <hash> on main. Save vN (changed? how migrated?)
Files changed: <paths, grouped>
Implemented: <bullets, player-visible first>
Tests: <suite: result> … ; new failures: <none | list>; pre-existing: <list, how confirmed>
Performance / mobile: <what was measured and how (headless or device), phones checked>
Save compatibility: <fixtures loaded, new fields, repairs>
Deployment: <pushed / triggered / verified live at <url> showing <version, commit> | not verified>
Known issues / follow-up: <bullets>
```
