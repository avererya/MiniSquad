# MiniSquad

MiniSquad is a real-time squad action game for mobile (landscape), inspired by Tiny Troopers, with original art. You move a small squad of auto-firing cartoon soldiers through real-time combat, use abilities like grenades, revive downed squadmates, and complete objectives.

This repository holds **Combat Prototype v0.1**, a disposable web feel prototype. It exists to answer one question: is moving a small squad of auto-firing soldiers through real-time combat fun? The final game will be native mobile. What carries forward is the design and the tuned numbers in `src/config.ts`, not this code.

## Status

`v0.6.1` (permanent death, resurrection & the Memorial, plus a Barracks UI pass; the original build is tagged `prototype-v0.1`).

- v0.6.1: the Barracks **Roster** shows the selected squad as six square slots along the bottom of the screen (deploy order; tap a square to remove that soldier). Slots above the current mission's squad size are shown locked with the mission that opens them (M6+, M7+, M13+). Roster cards use the full width. **Deploy happens only from the Campaign screen**: the Barracks has no Deploy buttons; the squad bar's MISSION ▸ button (and ◂ CAMPAIGN) return to the briefing, which lists the selected soldiers, offers EDIT SQUAD ▸ and DEPLOY. The Barracks header keeps the tabs in their own strip (two-line labels on phones) so Credits can never overlap them.

- v0.6: **KIA is permanent.** A soldier who bleeds out (20 s) or is left behind at extraction stays dead after the mission. Before the next mission every fallen soldier needs a decision, one at a time: **Resurrect** (Credits, price by that soldier's own resurrection count, everything restored) or **Honor in Memorial** (permanent). A non-pausing "SOLDIER LEFT BEHIND!" warning appears before an extraction would abandon a downed soldier. Soldiers have a six-stat career record. If the whole roster is lost and no resurrection was affordable, **Operation Phoenix** grants three free recruits. Hiding the page (app switch, lock screen) pauses a running mission. Save v5 (migrates v4 and older). See [Permanent death](#permanent-death-v06) below.

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

## Permanent death (v0.6)

Rules and prices live in `src/casualties.ts`; the transactions (mission-end settlement, resurrect, Memorial, Operation Phoenix, dismissal) in `src/economy.ts`; the timers in `src/game.ts` (`updateDowned`) and `src/clock.ts`; the extraction attempt in `src/mission.ts`; the screens in `src/menus.ts` and `src/hud.ts`.

- **Lifecycle** (by soldier id): Active → Downed → Revived (active again) or KIA. KIA comes from a bleed-out, from being left behind when you confirm an extraction, or from a mission that was interrupted (app closed / reloaded) after the soldier had already fallen. A KIA soldier can't be revived in the mission. Death is not dismissal: no refund, and it may end in the Memorial.
- **Bleed-out**: exactly 20 s of simulation time (1,200 fixed 1/60 s steps). It keeps running through combat, movement, extraction and its warning, and other soldiers' revives. It pauses only while a **valid** revive of that soldier is progressing (a standing squad-mate within 55 px with a clear line of sight). Being near, or behind a wall, doesn't count. An interrupted revive keeps its progress and the remaining bleed-out time. Revive time depends on the reviver: Infantry 10 s, Heavy Gunner 12 s, Medic 5 s (First Responder −10%: Doc 4.5 s; several revivers don't stack, the fastest counts). A revive restores 30% of max HP. The HUD shows `DOWN — 14s`, `CRITICAL 4s`, and `REVIVING 60% · 14s ⏸` (⏸ = timer paused).
- **Timing**: every timer runs on fixed simulation steps (`SimClock`). Each frame is clamped to 0.1 s, so a frame drop or a slow device slows the game down and never fast-forwards it. Hiding the page (visibilitychange / pagehide) **pauses the mission**, nothing is simulated while hidden, and there is no catch-up burst on return; you resume with ⏸ / P. Rotation and resize don't touch the timers.
- **Extraction**: the helicopter waits until every standing soldier is in the zone, and keeps waiting while a valid revive runs (v0.4 rule). If everyone standing is in the zone and someone is still down, an **attempt** opens a compact, non-pausing warning: "SOLDIER LEFT BEHIND! / Tank is downed — 8 seconds remaining. / Extracting now will mark Tank as KIA." (several: names + seconds). Its buttons ignore taps for the first 0.6 s.
  - **Stay and Rescue** cancels this attempt. Timers are not touched and the warning won't come back while you stay in the zone. Extraction then completes on its own once the downed soldier is revived (or has bled out). Leaving the zone for 1.5 s and coming back starts a new attempt (a new warning).
  - **Confirm Extraction** marks every downed soldier KIA (left behind) and the squad extracts.
  - **If you ignore it** (default): the helicopter keeps waiting, the bleed-out keeps running and never gets extra time. The soldier is either revived (then everyone extracts) or bleeds out (then the rest extract).
  - The warning sits right of the joystick area and clear of the ability buttons, and only its buttons take touches, so you can keep moving and using abilities. A healthy soldier outside the zone is never marked KIA: extraction just waits for them.
- **Failed missions** don't kill everyone. Soldiers standing **or downed** when the mission fails come home. Only soldiers who had already bled out (or were left behind) stay KIA. There are no victory rewards on a defeat, as in v0.5.
- **Mission-end transaction** (exactly once per run id, saved before Results are shown): XP and Credits by the v0.5 rules are applied first (with a KIA, the whole-squad and nobody-downed bonuses don't apply), then the career record, KIA status and the pending decision batch. Each KIA is also journaled and saved the moment it happens, so a reload mid-mission can't undo a death. The next launch resolves an interrupted mission: the fallen stay KIA, everyone else comes home, and no rewards are paid.
- **Casualty decisions** are mandatory: "FALLEN SOLDIER 1 OF 2" shows portrait, name, class, level, trait, cause, previous resurrections, cost, your Credits and the shortfall. The actions are **RESURRECT NOW** (disabled when short), **MANAGE ROSTER** and **HONOR IN MEMORIAL…**. The Memorial choice opens its own confirmation screen ("This decision is permanent. This soldier cannot be resurrected later."), whose confirm button is armed after 1.5 s. Menu taps are ignored for 0.6 s after each decision. Pending decisions survive reloads and app restarts and reopen on launch. Campaign, Barracks, Retry and deploy all redirect to them. Recruiting, refreshing offers, training, squad training and renaming are blocked until every decision is made. Nothing is decided automatically, and running short of Credits never sends anyone to the Memorial.
- **Resurrection price** (by the soldier's own previous resurrections; level, class and training don't matter): 1st 1,000 · 2nd 2,000 · 3rd 3,500 · 4th 5,000 · 5th 7,000 · 6th 8,500 · 7th+ 10,000 (cap). Future Elite soldiers pay ×2, still capped at 10,000 (`resurrectionCost(n, 'elite')`). A resurrection restores everything (id, name, class, trait, level, XP, training, career, squad slot) with no penalty, adds 1 to resurrections, and keeps the death count. Save failure → full rollback.
- **Roster slots**: a KIA soldier awaiting a decision still occupies a roster slot (recruiting is blocked anyway). A Memorial record frees the slot and does not count toward the 12-soldier cap.
- **Manage Roster** (restricted Barracks during a decision) only lets you dismiss living soldiers for the v0.5 refunds (Infantry 200, Heavy Gunner 250, Medic 250; training not refunded), with the normal confirmation. Affordability updates after each dismissal (for example 1,650 + 2 × 200 = 2,050 ≥ 2,000). A fallen soldier can't be dismissed. **Last-soldier rule**: you can never dismiss your last living soldier, during a decision as well, so a collapse can't be caused by dismissals.
- **Memorial** (🕯 in the Campaign and Barracks headers): a grid of grayscale portraits with name, final level and class, lifetime kills and resurrections. It keeps the full final record, never pays anything, and nobody comes back from it. Dismissed soldiers never enter it. Memorial names stay reserved.
- **Career record** (soldier details): Missions (completed = victories taken part in), Kills (final blow), Times downed, Revives performed (completed revives only), Deaths, Resurrections. It is committed once by the mission-end transaction, so reopening Results or reloading never counts twice. v0.5 saves keep their tracked missions / victories / kills; downs, revives and deaths start at 0 (they were never recorded).
- **Operation Phoenix**: once a decision batch is fully resolved with **no living soldier left**, at least one soldier sent to the Memorial, and **every** Memorial confirmation in that batch made while that resurrection was unaffordable, the screen "OPERATION PHOENIX — Your squad has fallen. Command has authorized three emergency recruits. Rebuild. Regroup. Fight back." offers 6 generated level 1 Infantry. You pick exactly 3: free, unique names, Infantry-eligible traits, training 0, squad training applies, they count toward the cap, and they join the squad. Campaign, stars, Credits, squad training, Memorial and history are kept; earlier missions can be replayed. A persistent grant id (`px-<run id>`) prevents a second grant (reload, double tap). Dismissing a Phoenix recruit refunds 0 (shown in the dismissal confirmation). Note: because a failed mission brings the downed home, the last soldier standing can't die in combat, so this is currently a safety net (see Planned cleanup).
- **Save v5**: adds the career fields, `status: 'kia'`, `account.pendingDecision` (the decision batch), `memorial`, `phoenix` (grants + pending pick) and `activeRun` (the in-mission KIA journal). v4 saves upgrade with nothing dropped, and nobody is retroactively KIA: v0.5's temporary KIA was never saved. The original text is copied once to `minisquad.save.pre-v0.6`. Repairs: a decision that references a missing soldier is dropped; a KIA soldier with no decision is queued (never silently revived or lost); a Memorial id also found in the roster stays in the Memorial; duplicate Memorial records are merged; invalid career values reset to 0. **New Campaign** also clears decisions, Memorial, Phoenix and the journal (after the usual `minisquad.save.pre-reset` backup).

## Planned cleanup (playtest notes, not changed in v0.6)

- Mission 4 (Red Canyon Ambush) is challenging but manageable in human play. In the v0.5 autopilot, L1-recruit squads won it 5 times in 11 attempts. With permanent death, **do not increase its difficulty**.
- Mission 5 (Bring Them Home): the captive trails at the back of the squad and often gets shot by pursuers. Future: a protective perimeter formation around the captive (a triangle for 3 soldiers, a fuller ring for larger squads), oriented to where threats are.
- Mission 5's optional "The captive takes no damage" is hard to get (same cause).
- `tools/logic.cjs`: the Ranger Quick Reflexes move-speed check fails intermittently (timing-sensitive measurement, pre-existing).
- Design question (v0.6): a failed mission brings downed soldiers home, so deliberately wiping the rest of the squad would save a soldier who is about to bleed out, and Operation Phoenix can't trigger from combat. Options: count a full squad wipe's downed soldiers as KIA, or keep the generous rule.

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
- `src/economy.ts`: mission settlement (once per run id; v0.6 KIA, career, decision batch, KIA journal + interrupted-mission recovery), atomic training purchases, the v0.5 recruitment transactions (recruit, refresh, dismiss, rename) and the v0.6 resurrect / Memorial / Operation Phoenix transactions, all with rollback
- `src/casualties.ts`: v0.6 permanent-death rules (resurrection prices, arm delays, decision blocks, Operation Phoenix eligibility)
- `src/clock.ts`: v0.6 fixed-step simulation clock (frame clamp, nothing while hidden, no catch-up)
- `src/recruitment.ts`: v0.5 Recruitment Office tables and rules (classes, prices, refunds, trait pool, starting levels, names, rename rules, candidate generation, one-time class introductions)
- `src/campaign.ts`: campaign data (missions, capacity table, star rules, unlocks)
- `src/missions.ts`, `src/objectives.ts`: per-mission scripts and the reusable objective modules (eliminate, destroy, capture & hold, reach, survive, free captive, optional objectives)
- `src/roster.ts`, `src/save.ts`: the roster (six campaign soldiers + recruits), unlock flags and ownership, squad selection rules, versioned local save (`minisquad.save`, v5, migrates v4, v3, v2 and v1) with per-field validation and recovery
- `src/missionstats.ts`: per-soldier mission statistics and attribution rules
- `src/menus.ts`: Campaign, Barracks, soldier details (career record), Results, casualty decisions, Operation Phoenix and Memorial screens
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
- `tools/*.cjs`: headless Playwright checks: `permadeath.cjs` (v0.6: bleed-out / revive timing, extraction warning, SimClock and backgrounding, mission-end transaction, decisions, restricted dismissal, Memorial, Phoenix, v0.5 fixture migration `fixtures/v0.5-save.json`, repairs, the 12 end-to-end scenarios), `permadeath-mobile.cjs` (v0.6 HUD timers, warning, casualty / Memorial / Phoenix screens on iPhone SE / 14 / Pixel 7 with rotation; `campaign.cjs` now also resolves casualties and reports the KIA rate per mission), `recruitment.cjs` (v0.5 rules, generation statistics, offers persistence, class introductions, recruit / refresh / dismiss / rename transactions, double taps, save failures, roster cap, v0.4 / v0.3 / v0.2.2 migration, repair), `recruit-mobile.cjs` (Recruitment Office, dismissal, rename with keyboard, New Campaign on phones), `campaign.cjs MODE=roster` (playthroughs with recruits), `campaign-rules.cjs` (v0.4 unlocks, caps, over-limit, stars, optionals, objectives, escort, rescue rules, squad scaling, v0.3 save), `campaign.cjs` (campaign autopilot: `MODE=new` new-player campaigns, `MODE=legacy` upgraded v0.3 roster, `MODE=fixed SQUAD=...`), `maps.cjs` (navigability + overview images), `progression.cjs` (v0.3 XP / Credits / training / save migration / phone tabs), `progression-balance.cjs` (playthroughs at different levels + economy pacing), `logic.cjs` (rule checks, PASS/FAIL), `barracks.cjs` (selection, save/reload, invalid saves, results flow), `squads.cjs` (roster squad playthroughs + stat attribution ledger), `mobile.cjs` (Barracks/Results/HUD on phones, touch, rotation), `balance.cjs` (accuracy and mission experiments), `play.cjs` (autopilot), `classes.cjs` / `lineup.cjs` (screenshots), plus the older smoke/touch/visual scripts. Serve a build first: `npm run build && npx vite preview --port 4173`
