# MiniSquad

MiniSquad is a real-time squad action game for mobile (landscape), inspired by Tiny Troopers, with original art. You move a small squad of auto-firing cartoon soldiers through real-time combat, use abilities like grenades, revive downed squadmates, and complete objectives.

This repository holds **Combat Prototype v0.1**, a disposable web feel prototype. It exists to answer one question: is moving a small squad of auto-firing soldiers through real-time combat fun? The final game will be native mobile. What carries forward is the design and the tuned numbers in `src/config.ts`, not this code.

## Status

`v0.5` (Recruitment Office & roster management; the original build is tagged `prototype-v0.1`).

- v0.5: a **Recruitment Office** (Barracks → RECRUIT) offers three candidates to hire with Credits, plus Refresh, Dismiss (with refund) and Rename. The roster holds up to 12 soldiers; the Barracks shows only soldiers you own (upcoming campaign soldiers are previewed on the Campaign screen instead). A player-facing **New Campaign…** button on the Campaign screen wipes all progress after a confirmation (the old save is backed up first). Save v4 (migrates v3, v2, v1 in place). See [Recruitment](#recruitment-v05) below.

- v0.4: a five-mission campaign with sequential unlocks, stars and soldiers who join as you progress. The game now opens on the **Campaign** screen (Campaign → Squad/Barracks → Deploy → Mission → Results → Campaign or Retry). See [Campaign](#campaign) below. Rescue rules changed for every mission: bleed-out is 20 s (was 30 s), a valid revive (reviver in range with line of sight) pauses the timer, an interrupted revive resumes from the remaining time, and a revive restores 30% HP (was 40%). The extraction helicopter waits while a revive is in progress. Downed soldiers show their name, a bleed-out ring, revive progress and a blinking CRITICAL warning for the last 5 s. The engine supports squads of up to 6 (up to 4 in v0.4 play); the HUD switches to compact tiles from 4 soldiers. Save v3 (migrates v2 and v1 in place).

- v0.3: soldiers earn XP from completed missions (same XP for every soldier who extracts; none for KIA, none on defeat; replays pay 75%) and level up automatically from 1 to 25, gaining a little HP, damage and fire rate per level. Credits are one account-wide currency earned once per mission (victory, whole-squad extraction, nobody downed, first-time completion; replays pay less). The Barracks has three tabs: Roster (squad selection, now with level and XP bars), Training (per-soldier Accuracy, Damage, Max HP, Fire Rate and Move Speed, 10 ranks each) and Squad Training (HP, Damage, Accuracy and Fire Rate for every soldier, 5 ranks each). Results show XP per soldier, level-ups and the Credits breakdown; rewards are paid exactly once per mission run. The save moves to v2; v0.2.2 saves are migrated in place (soldiers and squad kept). All numbers live in `src/progression.ts`.

- v0.2.2: first full loop, Barracks → select squad → deploy → mission → Results → Barracks. A fixed roster of six soldiers (Ace, Ranger, Tank, Havoc, Doc, Patch), each with a class, one natural trait and a progression record (level 1, no XP or upgrades yet). Traits (Sharpshooter, Quick Reflexes, Tough, Trigger Happy, First Responder, Healer) modify computed effective stats and never change class defaults. Pick 1 to 3 soldiers (duplicate classes allowed). Roster and selection are saved locally (versioned, validated). The Results screen shows kills, damage, healing, revives and final status per soldier, with Retry and Return to Barracks. KIA lasts only for the mission.

- v0.2.1: three soldier classes (Infantry, Heavy Gunner, Medic) built on a class registry, each with its own stats, look and ability (Grenade, Suppressive Fire, Field Treatment); revive speed depends on the reviver's class; friendly bullets slowed to 700 px/s (from 950); Infantry spread widened to 12° still / 30° moving (from 7° / 25°, full cone); Infantry fire rate set to 3/s (from 4/s); squad presets in the tuning panel (or `?squad=ihm` in the URL); slower soldiers catch up when they fall behind

- v0.1.2: layout recomputes on rotation and viewport changes (no more shifted game or cut-off ability buttons after portrait to landscape); respects safe areas; Settings panel shows the version and commit hash

- v0.1.1: green overhead health bars on friendly soldiers; medkits heal every standing soldier by 20% of max HP; enemy bullets slowed to 390 px/s (from 600) so they can be dodged; Infantry spread widened to 7° (from 4°)

- Barracks with six named soldiers, natural traits, per-soldier details (base vs effective stats) and squad selection up to each mission's cap, saved in localStorage
- Results screen after every mission with per-soldier kills, damage, healing, revives and final status
- Squads of 1 to 6 soldiers (engine; up to 4 in the v0.4 campaign) from three classes, with loose squad following and pathing around obstacles
- Auto-targeting with line of sight, physical projectiles, an accuracy cone that widens while moving
- Physical cover; Enemy Riflemen with flow-field pursuit and two temperaments
- Class abilities: Grenade (Infantry), Suppressive Fire (Heavy Gunner), Field Treatment (Medic); downed, revive and KIA states; medkit and Rapid Fire pickups
- Five campaign missions (Elimination, Sabotage, Capture & Hold, Survival, Rescue / Escort), each ending with a helicopter extraction
- Keyboard and touch controls (virtual joystick)
- In-game tuning panel with live sliders and JSON export/import

See [REPORT.md](REPORT.md) for the full build report, technical concerns and playtest questions.

## Campaign

Mission data (names, types, objectives, caps, star rules, unlocks) lives in `src/campaign.ts`; maps in `src/map.ts`; enemy groups, triggers and objective chains in `src/missions.ts`; reusable objective modules in `src/objectives.ts`.

| # | Mission | Type | Squad cap | Primary | Optional (+25 XP / +150 CR) | ★★ / ★★★ | First clear unlocks |
|---|---|---|---|---|---|---|---|
| 1 | First Contact | Elimination | 2 | Eliminate three patrols, extract | none | whole squad extracted / nobody downed | Mission 2, **Tank** |
| 2 | Heavy Support | Sabotage | 2 | Destroy the supply depot, extract (hold 12 s) | Eliminate the guarded MG nest | all optionals / no KIA | Mission 3, **Doc** |
| 3 | Field Medicine | Capture & Hold | 3 | Take and hold the comms outpost, extract | Extract every soldier | all optionals / nobody downed | Mission 4 |
| 4 | Red Canyon Ambush | Survival / Extraction | 3 | Advance into the canyon, survive a 50 s ambush, extract | none | whole squad extracted / nobody downed | Mission 5 |
| 5 | Bring Them Home | Rescue / Escort | 3 | Clear the compound, free the captive, escort them to extraction | The captive takes no damage | all optionals / no KIA | **Havoc**, squad size 4 for Mission 6 |

- Stars: 0 on defeat, ★ = primary objectives complete. Best stars are saved per mission and never go down. Missions can be replayed forever (replay rewards as in v0.3).
- Squad caps by mission number: 1-2 → 2, 3-5 → 3, 6 → 4, 7-12 → 5, 13+ → 6. You may deploy fewer. If the saved squad is larger than the selected mission allows (for example a v0.3 squad of 3 on Mission 1), the extra slots are marked OVER LIMIT and Deploy is disabled until you remove someone or tap **Keep first N**. The saved squad is never trimmed automatically.
- Soldiers: a new save starts with Ace and Ranger. Tank joins on the first clear of Mission 1, Doc on Mission 2, Havoc on Mission 5. Patch is reserved for the Mission 7 milestone (future update). Since v0.5 the Barracks lists only soldiers you own; upcoming soldiers are previewed on the Campaign screen (each mission's FIRST CLEAR line, Patch on the "Coming soon" card).
- Overlap rule: Mission 3's optional objective *is* "whole squad extracted", so on Mission 3 it pays once, as the optional (+25 XP / +150 CR), and the global whole-squad line is left out. The totals are the same as before.
- The v0.1-v0.3 comms-outpost mission is now Mission 3 (Field Medicine, new id `field-medicine`). Its old record (`comms-outpost`) is kept in the save as history. A player who already cleared it in v0.3 does not get the one-time +250 CR first-clear bonus again on Mission 3 (no double grant); unlocks and XP work normally.
- v0.3 / v0.2.2 saves: everything is kept (soldiers, XP, levels, training, Credits, squad), all six soldiers stay unlocked, and the campaign starts at Mission 1. The original save text is kept once under `minisquad.save.pre-v0.4`.

## Recruitment (v0.5)

Rules and tables live in `src/recruitment.ts`; the money-moving transactions (recruit, refresh, dismiss, rename) in `src/economy.ts`; the UI in `src/menus.ts` (Barracks → RECRUIT tab, soldier details → ✎ RENAME / DISMISS…).

- **Offers**: always three cards (name, class, starting level, trait + effect, HP / damage / fire rate / move speed, price, Recruit). Stats are never rolled: class + level + trait, plus Squad Training exactly as on roster cards. Offers are saved; reopening the office, switching tabs or reloading never produces new candidates for free.
- **Prices** (Credits): Infantry 750, Heavy Gunner 1,000, Medic 1,000. **Refresh** (replace all three) 100. Refresh needs two taps: the first arms it ("TAP AGAIN — 100 CR") for 3 s, a second tap within the window refreshes (a quick double tap does not confirm; same idea as the two-tap save reset, no modal).
- **Recruit flow** (atomic): check Credits and roster space → deduct → soldier joins (training rank 0, cumulative XP for the starting level) → save → only that offer is replaced. If the save write fails, everything is rolled back. Repeats are refused by state (a recruited offer id no longer exists; a refresh carries the lineup it was drawn for) and every menu tap is ignored for 450 ms after a recruit / refresh / dismissal, so a double tap can never buy the replacement offer.
- **Classes**: Infantry from the start; Heavy Gunner once Tank has joined; Medic once Doc has joined (`RECRUIT_CLASSES`). Havoc and Patch add no class. Random class per offer, duplicates allowed, no guaranteed spread. Tank, Doc, Havoc, Patch (and Ace, Ranger) are unique campaign soldiers and are never generated.
- **One-time introduction**: when a class first becomes recruitable, the next lineup you see holds at least one offer of it. If offers already exist, the **last** offer is swapped for the new class for free (two new classes at once: the last two). After that, normal randomness. Saves from before v0.5 count the classes they can already recruit as introduced (their first lineup is random): a returning player was never shown a lineup without them.
- **Traits** (`RECRUIT_TRAITS`): a trait can be rolled once a named soldier carrying it has joined (Sharpshooter / Quick Reflexes from the start, Tough with Tank, First Responder with Doc, Trigger Happy with Havoc, Healer with Patch). Healer is Medic-only; the others work for every class. This uses the campaign unlock flags, so dismissing a named soldier never removes their trait from the pool.
- **Starting level** (`RECRUIT_LEVELS`), from the highest unlocked mission (never the selected mission or the strongest soldier): M1-5 → L1, 6-10 → L3, 11-15 → L5, 16-20 → L8, 21-30 → L10, 31-40 → L15, 41+ → L20. The level is fixed when the offer is generated (what the card shows is what you get); offers made before a campaign milestone keep their level.
- **Names**: 110 curated nicknames (`NAME_POOL`). Never equal (case-insensitive) to a campaign name (Ace, Ranger, Tank, Havoc, Doc, Patch), a roster soldier, a current offer, or any name in the used-name registry (every recruited name, dismissed soldiers' names, names given up by a rename). Names once used stay reserved. When the pool runs out: "Ghost II", "Ghost III", ..., then "Ghost 14" (always unique, at most 12 characters). Soldier ids (`rc-1`, `rc-2`, ...) are permanent and independent of names.
- **Rename** (recruits and campaign soldiers; everything refers to soldiers by id): trimmed, inner spaces collapsed, 1-12 characters, letters / digits / space / `-` / `'` / `.`, at least one letter or digit, unique as above. Keeping your own name or changing its capitalisation is allowed. The old name joins the registry.
- **Roster cap**: 12 owned soldiers (`ROSTER_CAP`); the mission squad cap is unchanged. At 12/12 the Recruit buttons read ROSTER FULL with an explanation; offers are kept. The Barracks shows `DEPLOYED n / cap` (selected mission) and `ROSTER n / 12`. A save that already holds more than 12 keeps everyone; recruiting stays blocked until it is below the cap.
- **Dismissal**: soldier details → DISMISS… → a confirmation screen (name, class, level, trait, refund, permanent-loss warning) → CANCEL / CONFIRM DISMISSAL. Refund by class only: Infantry 200, Heavy Gunner 250, Medic 250 (training is not refunded); every price is above the refund, so recruit/dismiss can't make Credits. Not possible during a mission; you must keep at least one soldier. The soldier leaves the roster and the saved squad; a minimal record (event id, id, final name, class, level, timestamp, refund, `restorable: false`) is kept so a future Memorial / resurrection can exclude them. Dismissing a named soldier keeps their campaign unlock flag: they never rejoin when their unlock mission is replayed, and their class and trait stay recruitable.
- **New Campaign…** (Campaign screen header): a confirmation lists everything that is wiped (roster incl. recruits, XP and levels, training, squad training, Credits, campaign progress and stars, offers and name history). CANCEL / WIPE & START OVER. The current save is first copied to `minisquad.save.pre-reset` as `{"at": <ms>, "save": "<text>"}` (one rotating backup, latest reset only); if that copy can't be written nothing is wiped. Then a genuine new save starts (Ace + Ranger, Mission 1, 0 Credits). The dev tuning panel's two-tap reset uses the same path.
- **Save v4**: recruits are stored in the roster array like the campaign soldiers (id, name, class, trait, XP, training, service record); `account.recruitment` holds offers, the id counter, the used-name registry, introduced classes, dismissal history, roster cap and counters; `account.pendingDecision` (always `null`) is reserved for a future blocking post-mission decision. v3 saves are upgraded in place with nothing dropped (the original text is copied once to `minisquad.save.pre-v0.5`); v2 / v1 go through the same path (all six campaign soldiers stay owned). Malformed recruitment fields are repaired on their own without touching soldiers, Credits or campaign progress.

## Planned cleanup (playtest notes, not changed in v0.5)

- Mission 4 (Red Canyon Ambush) could use a modest late-wave difficulty increase: one human playtest had a soldier downed, a second had none.
- Mission 5 (Bring Them Home): the captive trails at the back of the squad and often gets shot by pursuers. Future: the captive should seek a protected position inside the formation, relative to where threats are.
- Mission 5's optional "The captive takes no damage" is hard to get (same cause).
- `tools/logic.cjs`: the Ranger Quick Reflexes move-speed check fails intermittently (timing-sensitive measurement, pre-existing).

## Run it

Requires Node.js 18 or newer.

```
npm install
npm run dev            # http://localhost:5173
npm run build          # production build in dist/
npm run build:single   # one self-contained file: dist-single/index.html
```

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Move squad | WASD / arrow keys | Drag on the left side |
| Ability | 1-6 or click a portrait | Tap a portrait |
| Grenade target | Click the ground (right-click / Esc cancels) | Tap the ground (tap the portrait again to cancel) |
| Campaign | click a mission (↑ / ↓), Enter deploys, B opens the Barracks | tap |
| Pick squad | Barracks: click a soldier's ADD / ✕, click a slot then a soldier to replace; Enter deploys; Esc / C back to Campaign | tap |
| Results | Enter retry · C Campaign · B / Esc Barracks | buttons |
| Dev squad | Tuning panel → Squad preset (generic soldiers), `?squad=ii\|ih\|im\|ihm\|hh\|mm`, or `?squad=ace,doc` (roster soldiers, temporary). None of these change the saved squad | same |
| Tuning panel | ` (backtick) or ⚙ | ⚙ |
| Mute / Pause | M / P | 🔊 / ⏸ |

Reset all progress: Campaign screen → **NEW CAMPAIGN…** (confirmation screen; the old save is backed up to `minisquad.save.pre-reset`), or tuning panel → Debug → "Reset save…" (tap twice). "Unlock all missions + soldiers (modifies save)…" (tap twice) unlocks everything in your save for testing. The tuning panel's Mission picker starts any mission; a mission started while still locked pays no rewards and unlocks nothing.

Debug keys: F spawn friendly · G spawn enemy group · K down a soldier · I invulnerable · Shift+R restart.

## Code map

TypeScript + Vite + plain 2D canvas, no framework.

- `src/config.ts`: every gameplay number, including per-class stats (the tuning panel edits it live)
- `src/classes.ts`: class registry (stats group, ability, look), soldier identity, effective stats, squad presets
- `src/traits.ts`: natural trait registry and the stat modifier math (class base → trait → individual modifiers)
- `src/progression.ts`: XP curve, level growth, Credits rules, training tables, the account, and the effective-stat pipeline (class base → level + training + squad training, additive % of base → trait → temporary effects)
- `src/economy.ts`: mission settlement (once per run id), atomic training purchases, and the v0.5 recruitment transactions (recruit, refresh, dismiss, rename) with rollback
- `src/recruitment.ts`: v0.5 Recruitment Office tables and rules (classes, prices, refunds, trait pool, starting levels, names, rename rules, candidate generation, one-time class introductions)
- `src/campaign.ts`: campaign data (missions, capacity table, star rules, unlocks)
- `src/missions.ts`, `src/objectives.ts`: per-mission scripts and the reusable objective modules (eliminate, destroy, capture & hold, reach, survive, free captive, optional objectives)
- `src/roster.ts`, `src/save.ts`: the roster (six campaign soldiers + recruits), unlock flags and ownership, squad selection rules, versioned local save (`minisquad.save`, v4, migrates v3, v2 and v1) with per-field validation and recovery
- `src/missionstats.ts`: per-soldier mission statistics and attribution rules
- `src/menus.ts`: Campaign, Barracks, soldier details and Results screens
- `src/game.ts`: game state, fixed-step update, damage, downed/revive/KIA
- `src/squad.ts`: squad anchor and loose following
- `src/enemy.ts`: Rifleman AI
- `src/combat.ts`: aiming, spread, projectiles, explosions, effects
- `src/targeting.ts`: swappable target-selection strategy
- `src/abilities.ts`: ability interface, Grenade, Suppressive Fire, Field Treatment
- `src/pickups.ts`: pickup interface, Medkit, Rapid Fire
- `src/mission.ts`: mission flow (objective chain, reinforcement triggers, escort NPC) and extraction interface
- `src/world.ts`, `src/map.ts`: collision, line of sight, pathfinding, the five maps
- `src/render.ts`, `src/hud.ts`, `src/tuning.ts`, `src/input.ts`, `src/audio.ts`: presentation and input
- `tools/*.cjs`: headless Playwright checks: `recruitment.cjs` (v0.5 rules, generation statistics, offers persistence, class introductions, recruit / refresh / dismiss / rename transactions, double taps, save failures, roster cap, v0.4 / v0.3 / v0.2.2 migration, repair), `recruit-mobile.cjs` (Recruitment Office, dismissal, rename with keyboard, New Campaign on phones), `campaign.cjs MODE=roster` (playthroughs with recruits), `campaign-rules.cjs` (v0.4 unlocks, caps, over-limit, stars, optionals, objectives, escort, rescue rules, squad scaling, v0.3 save), `campaign.cjs` (campaign autopilot: `MODE=new` new-player campaigns, `MODE=legacy` upgraded v0.3 roster, `MODE=fixed SQUAD=...`), `maps.cjs` (navigability + overview images), `progression.cjs` (v0.3 XP / Credits / training / save migration / phone tabs), `progression-balance.cjs` (playthroughs at different levels + economy pacing), `logic.cjs` (rule checks, PASS/FAIL), `barracks.cjs` (selection, save/reload, invalid saves, results flow), `squads.cjs` (roster squad playthroughs + stat attribution ledger), `mobile.cjs` (Barracks/Results/HUD on phones, touch, rotation), `balance.cjs` (accuracy and mission experiments), `play.cjs` (autopilot), `classes.cjs` / `lineup.cjs` (screenshots), plus the older smoke/touch/visual scripts. Serve a build first: `npm run build && npx vite preview --port 4173`
