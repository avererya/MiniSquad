# MiniSquad

MiniSquad is a real-time squad action game for mobile (landscape), inspired by Tiny Troopers, with original art. You move a small squad of auto-firing cartoon soldiers through real-time combat, use abilities like grenades, revive downed squadmates, and complete objectives.

This repository holds **Combat Prototype v0.1**, a disposable web feel prototype. It exists to answer one question: is moving a small squad of auto-firing soldiers through real-time combat fun? The final game will be native mobile. What carries forward is the design and the tuned numbers in `src/config.ts`, not this code.

## Status

`v0.8B` (Chapter 3B: Hold the Line & Supply Line Sabotage, on top of v0.8A Chapter 3A: The Resistance Begins, v0.7D.1 Accuracy Soft Floor & HUD Touch Areas, v0.7D Squad Training Expansion & Mobile Polish, v0.7C Tactical Support, v0.7B.1 Progression & Training Rebalance, v0.7B Elite Progression, Elite Levels 2-30, v0.7A Elite Promotions & Specializations, v0.6.4's 30 FPS phone default and v0.6.2 Chapter 2: Behind Enemy Lines; the original build is tagged `prototype-v0.1`). The visible label reads "MiniSquad v0.8B · <commit>" (package version 0.8.1, label from `versionLabel` in `package.json`).

- v0.8B: **Chapter 3B: Hold the Line & Supply Line Sabotage.** Two new missions with **six-soldier squads** (13 **Hold the Line**: secure optional turret caches, start the assault from the command zone, hold a 1000 HP command center through four waves with three resistance allies; 14 **Supply Line Sabotage**: destroy three depots, capture the enemy truck, pick its gunner, and escort it through three ambushes). Friendly assets (command center, turrets, the truck and its mounted gun) are a reusable system. Save v9 unchanged. See [Chapter 3B](#chapter-3b-hold-the-line--supply-line-sabotage-v08b).
- v0.8A: **Chapter 3A: The Resistance Begins.** Two new missions (11 **Resistance Rising**: liberate three village zones in any order, then hold the safehouse with three resistance allies; 12 **Artillery Hunt**: destroy three artillery guns at night while avoiding searchlights that call in shells), the **Commando** class (dual pistols, Bullet Storm, unlocked by the first clear of Mission 12, 1,250 CR in the Recruitment Office), **enemy group awareness** (nearby enemies react to a shot comrade and investigate where it came from), finite **extraction reinforcements** on most missions, and a **briefing** before every deployment. "Recon Commando" is now **Recon Specialist** (same id, nothing to migrate). Save v9 unchanged; older saves load byte-identically. See [Chapter 3A](#chapter-3a-the-resistance-begins-v08a).
- v0.7D.1: **Accuracy Soft Floor & HUD Touch Areas.** Fully trained soldiers no longer waste Squad Accuracy purchases: every Individual and Squad Accuracy rank now narrows both the standing and the moving cone up to rank 10, for every class, trait and Elite. Untrained, early and mid builds are exactly unchanged. Mute / pause / settings (top right) get 44 × 44 CSS px touch areas on phones. Training previews show the standing and the moving change. Training tables, prices, ranks and saves are untouched (save v9, no migration). See [Accuracy Soft Floor](#accuracy-soft-floor--hud-touch-areas-v07d1).
- v0.7D: **Squad Training Expansion & Mobile Polish.** Squad Training (HP, Damage, Accuracy, Fire Rate for every soldier) now has **10 ranks** instead of 5, and every rank is stronger: rank 5 is now **+25% HP, +20% damage, −25% spread, +12.5% fire rate** (double the old maximum) and rank 10 doubles that again (**+50% / +40% / −50% / +25%**). Ranks you already bought keep their number and get the new value at once (Squad Damage 3 was +5.25%, now +9%); nothing is refunded or charged. Ranks 1-5 keep their prices; ranks 6-10 cost 4,500 / 5,500 / 7,000 / 8,500 / 10,000 CR (46,250 per category). The Squad Training tab shows RANK n/10, the current and next bonus, the gain in points of class base, the real before → after stat of one of your soldiers, and MAXED at rank 10. On phones, AIRSTRIKE and NUKE now sit side by side with touch areas of at least 44 × 44 px, and the CONFIRM / CANCEL / LAUNCH buttons are at least 44 px tall. Missions, enemies, Credits, individual training, XP and Tactical Support are unchanged; save v9 is unchanged. See [Squad Training Expansion](#squad-training-expansion--mobile-polish-v07d).
- v0.7C: **Tactical Support.** Deploy **3 Elite soldiers** and a free **Tactical Airstrike** is available once per mission: tap AIRSTRIKE (top left, under the timer), tap or drag on the map to place the 120 px blast circle, then CONFIRM; about 2 s later it hits every enemy inside. Deploy **6 Elites** (six-soldier squads arrive with Mission 13) and you can launch a **Nuclear Strike**, bought for **3,000 CR** each in the new Barracks → **SUPPORT** shop and kept in stock between missions: NUKE → confirmation → LAUNCH spends one at once, and 30 s of mission time later it hits every enemy on the map. Neither ever hurts your squad or allies, neither can take a boss below 10% HP or destroy a mission objective (they stay at 1 HP or more), and support kills give no XP or kill credit. Save v9 is unchanged apart from a new Nuclear Strike stock (0 for existing saves). See [Tactical Support](#tactical-support-v07c).
- v0.7B.1: **Progression & Training Rebalance.** Training ranks now **accelerate**: each rank adds more than the one before (rank 1 is unchanged, so no purchase got weaker), and prices / rank limits are unchanged. Max Damage training is now +50% of the class base (was +30%; +42% on a Level 25 soldier), Max HP +57.5% (was +50%), Accuracy -55% spread, Fire Rate +35%, Move Speed +22.5%, and Squad Training accelerates the same way. Training already bought gets the new values automatically (no save change). The Training tab shows the soldier's real current value, the value after the next rank and the exact gain. Mission XP now scales with the mission number: Mission 1 pays 125 Victory XP, Mission 10 200, and the curve reaches 500 at Mission 40 and 600 at Mission 50; replays pay 75% of the replayed mission's own XP. Credits, Recruit and Elite XP thresholds are unchanged. See [Progression & Training Rebalance](#progression--training-rebalance-v07b1).
- v0.7B: **Elite Progression.** Elite soldiers now level from **ELITE 1 to ELITE 30** with the mission XP they earn (35,670 XP in total; XP banked in v0.7A counts). Each Elite level adds a small share of the Elite 30 bonus: **+25% max HP, +15% weapon damage** and a modest class extra (Infantry / Heavy -10% spread, Medic +10% Field Treatment healing, Sniper -10% aim time), on top of the soldier's own Elite 1 stats. Results announce **★ ELITE LEVEL UP!**; profiles show Elite XP, the next-level requirement (or MAX LEVEL) and the current bonus; squad slots show ★level. Save v9 (backup `minisquad.save.pre-v0.7b`). See [Elite Progression](#elite-progression-v07b).

- v0.7A: **Elite Promotions.** A living soldier at Recruit Level 25 can be promoted in their Barracks profile for **3,000 CR** into one of two specializations of their class, each with an automatic combat passive. Promotion is permanent (one per soldier, no respec, never automatic), keeps everything the soldier had, and makes them **Elite Level 1** with a black-and-blue uniform. Save v8 (backup `minisquad.save.pre-v0.7`). See [Elite Promotions](#elite-promotions-v07a).

- v0.6.4: **30 FPS by default on phones and tablets** (playtest: no visible difference, less heat); desktop stays at 60. Settings (⚙) → Performance offers 30 and 60, marks the device default, and shows the active cap and where it comes from (your choice, device default, or a `?fps=` test override). A cap the player picks is stored and always wins; gameplay is identical at both rates.

- v0.6.3: **Mobile performance.** The game draws at most 60 frames a second (it used to draw every display refresh, 90-120 a second on many phones), the enemy flow field is 5-8x cheaper to build, soldier stats are computed once per simulation step, the HUD only touches the page when a value changes, losing focus pauses a mission like backgrounding does, and audio is released while the page is hidden. Gameplay, balance, missions and the save are unchanged: the simulation produces bit-identical results to v0.6.2 and is identical at 30 and 60 FPS. Developer options in ⚙ → Performance: frame cap (60 / 30 for testing) and a performance overlay. See [Performance](#performance-v063).

- v0.6.2: **Chapter 2 — Behind Enemy Lines.** Five new missions (6 Bridgehead, 7 Prison Break, 8 Convoy Crusher, 9 Blackout, 10 Operation Iron Fist), new enemies (enemy Sniper with a laser telegraph, Watchtower, Armored Trooper with a weak rear, convoy trucks and escorts), the recruitable **Sniper** class (unlocked by clearing Mission 9), Patch's recruit offer at Mission 7, and the **Iron Warden** boss. The Campaign screen has chapter tabs (CH 1 / CH 2 / CH 3 soon). Hostage escorts (Missions 5 and 7) use a protective ring formation. Save v7 (backup `minisquad.save.pre-v0.6.2`). See [Chapter 2](#chapter-2-behind-enemy-lines-v062).

- v0.6.1: **A failed mission never rescues a downed soldier.** When a mission legitimately fails (whole squad down, captive lost, any objective failure) standing soldiers (revived ones too) come home, soldiers downed at that moment become **KIA** ("Downed when the mission failed"), soldiers already KIA stay KIA (one death each). Results show "MISSION FAILED · 1 Survivor · 2 KIA" and the normal casualty flow follows; Operation Phoenix can now open after a genuine combat collapse. Closing / reloading the app mid-mission is unchanged (only soldiers who had already fallen are lost). No rewards for failures (unchanged).
- v0.6.1: **Campaign milestones unlock recruits, not soldiers.** A new campaign owns only Ace and Ranger. Clearing Mission 1 / 2 / 5 / 7 opens a permanent **CAMPAIGN RECRUITS** offer in the Recruitment Office for Tank / Doc / Havoc / Patch (1,000 CR each, natural trait kept, joins at the current recruit level), shown above the three random candidates and never touched by Refresh. Each is bought at most once (claimed by the soldier's id, so renaming, dismissing or the Memorial can never reopen it), respects the 12-soldier cap, and is announced once by a "NEW RECRUIT AVAILABLE!" notice. Heavy Gunner / Medic recruitment and the Tough / First Responder / Trigger Happy / Healer traits unlock with the milestones whether or not the named soldier is bought. Save v6: older saves keep every soldier they were given (free, marked claimed, never offered again). See [Named campaign recruits](#named-campaign-recruits-v061).
- v0.6.1: the Barracks **Roster** shows the selected squad as six square slots along the bottom of the screen (deploy order; tap a square to remove that soldier). Slots above the current mission's squad size are shown locked with the mission that opens them (M6+, M7+, M13+). Roster cards use the full width. **Deploy happens only from the Campaign screen**: the Barracks has no Deploy buttons; the squad bar's MISSION ▸ button (and ◂ CAMPAIGN) return to the briefing, which lists the selected soldiers, offers EDIT SQUAD ▸ and DEPLOY. The Barracks header keeps the tabs in their own strip (two-line labels on phones) so Credits can never overlap them.

- v0.6: **KIA is permanent.** A soldier who bleeds out (20 s) or is left behind at extraction stays dead after the mission. Before the next mission every fallen soldier needs a decision, one at a time: **Resurrect** (Credits, price by that soldier's own resurrection count, everything restored) or **Honor in Memorial** (permanent). A non-pausing "SOLDIER LEFT BEHIND!" warning appears before an extraction would abandon a downed soldier. Soldiers have a six-stat career record. If the whole roster is lost and no resurrection was affordable, **Operation Phoenix** grants three free recruits. Hiding the page (app switch, lock screen) pauses a running mission. Save v5 (migrates v4 and older). See [Permanent death](#permanent-death-v06) below.

- v0.5: a **Recruitment Office** (Barracks → RECRUIT) offers three candidates to hire with Credits, plus Refresh, Dismiss (with refund) and Rename. The roster holds up to 12 soldiers; the Barracks shows only soldiers you own (upcoming campaign soldiers are previewed on the Campaign screen instead). A player-facing **New Campaign…** button on the Campaign screen wipes all progress after a confirmation (the old save is backed up first). Save v4 (migrates v3, v2, v1 in place). See [Recruitment](#recruitment-v05) below.

- v0.4: a five-mission campaign with sequential unlocks, stars and soldiers who join as you progress. The game now opens on the **Campaign** screen (Campaign → Squad/Barracks → Deploy → Mission → Results → Campaign or Retry). See [Campaign](#campaign) below. Rescue rules changed for every mission: bleed-out is 20 s (was 30 s), a valid revive (reviver in range with line of sight) pauses the timer, an interrupted revive resumes from the remaining time, and a revive restores 30% HP (was 40%). The extraction helicopter waits while a revive is in progress. Downed soldiers show their name, a bleed-out ring, revive progress and a blinking CRITICAL warning for the last 5 s. The engine supports squads of up to 6 (up to 4 in v0.4 play); the HUD switches to compact tiles from 4 soldiers. Save v3 (migrates v2 and v1 in place).

- v0.3: soldiers earn XP from completed missions (same XP for every soldier who extracts; none for KIA, none on defeat; replays pay 75%) and level up automatically from 1 to 25, gaining a little HP, damage and fire rate per level. Credits are one account-wide currency earned once per mission (victory, whole-squad extraction, nobody downed, first-time completion; replays pay less). The Barracks has three tabs: Roster (squad selection, now with level and XP bars), Training (per-soldier Accuracy, Damage, Max HP, Fire Rate and Move Speed, 10 ranks each) and Squad Training (HP, Damage, Accuracy and Fire Rate for every soldier, 5 ranks each; 10 since v0.7D). Results show XP per soldier, level-ups and the Credits breakdown; rewards are paid exactly once per mission run. The save moves to v2; v0.2.2 saves are migrated in place (soldiers and squad kept). All numbers live in `src/progression.ts`.

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
| 1 | First Contact | Elimination | 2 | Eliminate three patrols, extract | none | whole squad extracted / nobody downed | Mission 2, **Tank** recruit offer |
| 2 | Heavy Support | Sabotage | 2 | Destroy the supply depot, extract (hold 12 s) | Eliminate the guarded MG nest | all optionals / no KIA | Mission 3, **Doc** |
| 3 | Field Medicine | Capture & Hold | 3 | Take and hold the comms outpost, extract | Extract every soldier | all optionals / nobody downed | Mission 4 |
| 4 | Red Canyon Ambush | Survival / Extraction | 3 | Advance into the canyon, survive a 50 s ambush, extract | none | whole squad extracted / nobody downed | Mission 5 |
| 5 | Bring Them Home | Rescue / Escort | 3 | Clear the compound, free the captive, escort them to extraction | The captive takes no damage | all optionals / no KIA | **Havoc**, Mission 6 (squad size 4) |
| 6 | Bridgehead | Capture & Hold | 4 | Clear the bridge guards, hold the bridgehead 45 s, extract | No soldier KIA | all optionals / nobody downed | Mission 7 |
| 7 | Prison Break | Rescue / Escort | 5 | Eliminate the prison guards (4 watchtowers), free the POW medic, escort them out | The prisoner is never downed | all optionals / no KIA | Mission 8, **Patch** recruit offer |
| 8 | Convoy Crusher | Interception | 5 | Destroy at least 2 of 3 supply trucks, extract | Destroy all three trucks | all optionals / nobody downed | Mission 9 |
| 9 | Blackout | Night Sabotage | 5 | Destroy the 3 communication relays, extract | Destroy every relay before the alarm maxes out | all optionals / nobody downed | Mission 10, **Sniper class** |
| 10 | Operation Iron Fist | Assault / Boss | 5 | Destroy 2 installations, storm the stronghold, defeat the Iron Warden, extract | No soldier KIA | all optionals / nobody downed | Mission 11 (Chapter 3) |
| 11 | Resistance Rising | Liberation & Defense | 5 | Liberate 3 village zones (any order), return to the safehouse, hold it with 3 resistance allies, extract | All three resistance allies alive through extraction | all optionals / no KIA | Mission 12 |
| 12 | Artillery Hunt | Search & Destroy (night) | 5 | Destroy the 3 artillery guns (any order), extract | No artillery alert | all optionals / no KIA | **Commando class** |

- Stars: 0 on defeat, ★ = primary objectives complete. Best stars are saved per mission and never go down. Missions can be replayed forever (replay rewards as in v0.3).
- Squad caps by mission number: 1-2 → 2, 3-5 → 3, 6 → 4, 7-12 → 5, 13+ → 6. You may deploy fewer. If the saved squad is larger than the selected mission allows (for example a v0.3 squad of 3 on Mission 1), the extra slots are marked OVER LIMIT and Deploy is disabled until you remove someone or tap **Keep first N**. The saved squad is never trimmed automatically.
- Soldiers: a new save starts with Ace and Ranger only. Since v0.6.1 the first clear of Mission 1 / 2 / 5 opens a named recruit offer for Tank / Doc / Havoc in the Recruitment Office (bought for 1,000 CR, never awarded); Patch's offer opens with the Mission 7 milestone (v0.6.2). Since v0.5 the Barracks lists only soldiers you own; upcoming soldiers are previewed on the Campaign screen (each mission's FIRST CLEAR line, Patch on the "Coming soon" card).
- Overlap rule: Mission 3's optional objective *is* "whole squad extracted", so on Mission 3 it pays once, as the optional (+25 XP / +150 CR), and the global whole-squad line is left out. The totals are the same as before.
- The v0.1-v0.3 comms-outpost mission is now Mission 3 (Field Medicine, new id `field-medicine`). Its old record (`comms-outpost`) is kept in the save as history. A player who already cleared it in v0.3 does not get the one-time +250 CR first-clear bonus again on Mission 3 (no double grant); unlocks and XP work normally.
- v0.3 / v0.2.2 saves: everything is kept (soldiers, XP, levels, training, Credits, squad), all six soldiers stay unlocked, and the campaign starts at Mission 1. The original save text is kept once under `minisquad.save.pre-v0.4`.

## Recruitment (v0.5)

Rules and tables live in `src/recruitment.ts`; the money-moving transactions (recruit, refresh, dismiss, rename) in `src/economy.ts`; the UI in `src/menus.ts` (Barracks → RECRUIT tab, soldier details → ✎ RENAME / DISMISS…).

- **Offers**: always three cards (name, class, starting level, trait + effect, HP / damage / fire rate / move speed, price, Recruit). Stats are never rolled: class + level + trait, plus Squad Training exactly as on roster cards. Offers are saved; reopening the office, switching tabs or reloading never produces new candidates for free.
- **Prices** (Credits): Infantry 750, Heavy Gunner 1,000, Medic 1,000. **Refresh** (replace all three) 100. Refresh needs two taps: the first arms it ("TAP AGAIN — 100 CR") for 3 s, a second tap within the window refreshes (a quick double tap does not confirm; same idea as the two-tap save reset, no modal).
- **Recruit flow** (atomic): check Credits and roster space → deduct → soldier joins (training rank 0, cumulative XP for the starting level) → save → only that offer is replaced. If the save write fails, everything is rolled back. Repeats are refused by state (a recruited offer id no longer exists; a refresh carries the lineup it was drawn for) and every menu tap is ignored for 450 ms after a recruit / refresh / dismissal, so a double tap can never buy the replacement offer.
- **Classes**: Infantry from the start; Heavy Gunner after Tank's milestone (Mission 1); Medic after Doc's (Mission 2), bought or not (`RECRUIT_CLASSES`, v0.6.1). Havoc and Patch add no class. Sniper: from the Mission 9 milestone (v0.6.2, `class:sniper`), 1,250 CR, refund 300. Random class per offer, duplicates allowed, no guaranteed spread. Tank, Doc, Havoc, Patch (and Ace, Ranger) are unique campaign soldiers and are never generated.
- **One-time introduction**: when a class first becomes recruitable, the next lineup you see holds at least one offer of it. If offers already exist, the **last** offer is swapped for the new class for free (two new classes at once: the last two). After that, normal randomness. Saves from before v0.5 count the classes they can already recruit as introduced (their first lineup is random): a returning player was never shown a lineup without them.
- **Traits** (`RECRUIT_TRAITS`): a trait can be rolled once the milestone of the named soldier carrying it is reached, or that soldier was owned before v0.6.1 (Sharpshooter / Quick Reflexes from the start, Tough with Tank, First Responder with Doc, Trigger Happy with Havoc, Healer with Patch). Healer is Medic-only; the others work for every class. This uses the campaign flags (`campaignFlags`), so dismissing a named soldier never removes their trait from the pool.
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

## Named campaign recruits (v0.6.1)

- `NAMED_RECRUITS` (campaign.ts): Tank (Mission 1, Heavy Gunner), Doc (Mission 2, Medic), Havoc (Mission 5, Heavy Gunner), Patch (Mission 7, Medic; playable since v0.6.2). 1,000 CR each. Offer key = the named soldier's stable id.
- `account.named` (save v6): `unlocked` (milestone reached), `claimed` (offer used up for good: bought, or owned / dismissed / in the Memorial before v0.6.1), `notified` (notice shown), `history` (purchases; `legacy: true` with cost 0 for soldiers older versions awarded). `unlockedSoldiers` now means owned named soldiers and is never re-derived from mission records.
- Purchase (`economy.recruitNamed`, atomic with rollback): offer open, no pending casualty decision, roster below 12, enough Credits; otherwise refused with nothing charged. The soldier keeps id, name, class and trait and joins at the current recruit starting level.
- Class / trait pools use `campaignFlags` (starting soldiers + reached milestones + claimed offers), never who is in the roster. The one-time class introduction (a Heavy Gunner in the next random lineup after Mission 1) works without buying Tank; the named offer never counts toward it.
- Migration (v1-v5 -> v6, original text kept once in `minisquad.save.pre-v0.6.1`): every named soldier those versions awarded stays owned and uncharged; owned, KIA-awaiting-decision, dismissed and Memorial soldiers are all marked claimed (by id), so nobody is duplicated. Milestones already cleared are unlocked. Ambiguity: pre-v0.6.1 saves cannot show a "cleared but never acquired" state (those versions always awarded the soldier), so no offer is opened for them; a v6 save that lost its `named` block is rebuilt from mission records (milestone cleared + not owned = open offer).

## Chapter 2: Behind Enemy Lines (v0.6.2)

Missions: scripts in `src/missions.ts`, campaign data in `src/campaign.ts`, maps in `src/map.ts`. New code lives in `src/convoy.ts` (trucks and escorts), `src/boss.ts` (Iron Warden), `src/enemy.ts` (enemy kinds), `src/targeting.ts` (Sniper priorities) and `src/objectives.ts` (hold, relays, convoy, multi-destroy, boss, alarm and no-KIA optionals). The full spec is kept outside the repo, in the shared project folder.

- **Campaign screen**: three chapter tabs (CH 1 ★x/15, CH 2 Behind Enemy Lines ★x/15, CH 3 SOON). Only the selected chapter's missions are listed, so phones never scroll. Chapter 1 keeps its v0.6.1 look and has no name of its own.
- **M6 Bridgehead** (cap 4): cross the river, clear the bridge guards (two enemy Snipers), then hold the bridge zone for 45 s against waves from both banks. Optional: no soldier KIA. The card notes "Squad size 5 from Mission 7".
- **M7 Prison Break** (cap 5): four Watchtowers and the guard garrison, then free the POW medic and escort them to the helicopter. Optional: the prisoner is never downed. Clearing M7 opens **Patch** (Medic, Healer) in the Recruitment Office for 1,000 CR. Patch is not free.
- **M8 Convoy Crusher** (cap 5): three trucks (1,000 HP each, +30% grenade damage) drive a fixed road with escorts (rifles, then armored). Destroy at least 2, then extract. Optional: all three. The HUD shows T1-T3 chips with HP and "destroyed / escaped / on the road".
- **M9 Blackout** (night, cap 5): three relays (900 HP). The ALARM meter fills over time, faster while more relays are up (0.75 / 0.5 / 0.3 points per second with 3 / 2 / 1 relays up). While relays stand, the base calls reinforcement waves from six spawn points. Fewer relays means smaller, rarer waves, and none once all three are down. At most 12 living enemies at a time. Optional: every relay down before the alarm maxes out. Clearing M9 **unlocks the Sniper class**. The Results screen shows "NEW CLASS UNLOCKED: SNIPER", and the Campaign screen then shows the notice "NEW CLASS UNLOCKED! SNIPER — Long-range precision specialists are now available in the Recruitment Office." with LATER / VISIT RECRUITMENT OFFICE. The next lineup is guaranteed to hold a Sniper (one-time class introduction). No Sniper is given for free, and the unlock is saved permanently.
- **M10 Operation Iron Fist** (cap 5): destroy two installations (700 HP each), storm the stronghold arena, defeat the **Iron Warden**, then extract (8 s countdown). Optional: no soldier KIA. After the boss falls, the remaining garrison routs.
- **Enemies** (`CFG.enemySniper / armored / tower / truck / boss`):
  - **Sniper**: 45 HP, 30 damage, range 600. A red laser tracks its target, then freezes for 0.45 s before the shot, so you can step aside. Prefers exposed soldiers, meaning no solid cover within about 30 px.
  - **Watchtower**: static, 80 HP, range 520.
  - **Armored Trooper**: 140 HP. Takes 35% damage from the front (±65°) and 125% from behind.
  - **Trucks**: drive on rails and escape at the road's end. Escorts march with their truck and leave it to fight freely once it is destroyed.
- **Sniper class** (`CFG.classes.sniper`):
  - Stats: HP 75, damage 32, 0.8 shots/s, range 560, 0.45 s aim before each shot, revive time 10 s.
  - Cost: recruit 1,250 CR, dismissal refund 300.
  - Ability **Focus**: 5 s of 1.5× fire rate and 0.35× aim time, 20 s cooldown.
  - Traits (rolled only for Snipers):
    - Eagle Eye: −20% spread.
    - Steady Hands: −25% aim time.
    - Dead Calm: −30% extra spread while moving.
  - Target priority: enemy Snipers, then heavy targets (boss / tower / armored), then vehicles, then others, then structures; nearest first within a tier. It only switches to a higher tier before it has aimed for 0.15 s.
  - Elite branches are future work (`resurrectionCost(n, 'elite')` already exists).
- **Iron Warden** (`CFG.boss`, `src/boss.ts`):
  - HP 2,400.
  - **MG**: 0.9 s windup with a visible telegraph and the HUD reading "MG WINDING UP", then a 2.2 s burst that turns slowly, then a 1.5 s rest. Once the windup has started it is committed.
  - **Rocket**: the first fires at 20 s, then every 24 ± 3 s. A red circle (radius 95) follows its target for 1.0 s, then locks for the remaining 1.5 s of the 2.5 s warning. The HUD and a banner read "ROCKET! MOVE!". 55 damage at the centre; cover between the blast and a soldier blocks it.
  - **Reinforcements**: called at 65% HP (2 rifles, armored, sniper) and at 30% HP (2 rifles, armored) through three arena gates. He stops the MG for about 3.5 s while he calls (a telegraphed rocket still lands). The HUD boss bar has ticks at both thresholds.
  - When no soldier is in its line of sight, it closes in.
  - **Hidden damage modifiers**, never shown in game text: Infantry 75%, Heavy Gunner 65%, Medic 75%, grenades 100%, Sniper 160%. Players are meant to discover the Sniper weakness.
  - Defeat: "THE IRON WARDEN IS DOWN! — PROCEED TO EXTRACTION".
- **Hostage formation** (Missions 5 and 7, `escortRing` in `src/squad.ts`): the captive walks at the squad anchor and the soldiers hold a ring around them. The ring is a single point ahead for 1 soldier, two flanks for 2, and evenly spaced for 3 or more. It is oriented along the movement, or toward the nearest visible threat when standing still. Slots are reassigned only when the squad changes. A slot blocked by a wall is pulled in to half the radius. Enemies aim at the captive only when no guarding soldier is in view, and rounds aimed at a soldier only hit the escorted captive inside a 5 px "head down" radius (`CFG.escort.strayHitRadius`). Rounds aimed at the captive use the full body, so the captive stays vulnerable.
- **Save v7**: adds `account.classUnlocks` ({unlocked, notified}). Older saves (v1-v6) are copied once to `minisquad.save.pre-v0.6.2`, then upgraded in place. Everything is kept and the new chapter opens after Mission 5. Class unlocks are rebuilt from cleared milestones. A pre-v7 save has no Sniper class, so a "sniper" recruit or offer from a tampered save is repaired (recruit to Infantry, offer dropped) with a note. `tools/fixtures/v0.6.1-save.json` is a real v6 save produced by the v0.6.1 build and is used by `tools/chapter2.cjs`.
- **Tests**:
  - `tools/chapter2.cjs`: spec section 13, 94 checks.
  - `tools/chapter2-mobile.cjs`: iPhone SE, iPhone 14 and Pixel 7 landscape HUD and menus, rotation, and screenshots.
  - `tools/maps.cjs`: reachability on all 10 maps.
  - `tools/chapter2-sim.cjs`: spec section 14. These are automated simulations with a scripted player, **not** human playtests.

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

## Chapter 3B: Hold the Line & Supply Line Sabotage (v0.8B)

Chapter 3 continues with Missions 13 and 14. Mission 15 shows as "coming soon" (a non-playable `mission-15` row). The Demolitions Expert, Mission 15 and Chapters 4-5 are not part of this release.

**Sixth slot.** Missions 13 and 14 deploy **up to 6 soldiers** (`CAPACITY_TABLE` in `src/campaign.ts`); Missions 1-12 keep their caps. Nobody is forced to bring a sixth soldier (1-6 deploy), the roster cap stays 12, and a seventh is refused. Mission 12's first clear unlocks Mission 13 and its row says "Mission 13 deploys up to 6 soldiers". The Barracks squad bar shows six open slots for Missions 13 / 14; the in-mission HUD lays six portraits out as two rows of three, each ability button with a 44 x 44 CSS px touch area (`--t44`); key **6** uses the sixth soldier's ability. Six deployed Elites keep the v0.7C rule (airstrike and nuke both available).

**Friendly assets** (`src/unit.ts` `asset`, `Game.assets`, stats in `CFG.commandCenter`, `CFG.turret`, `CFG.escortTruck`). The command center, turrets and the supply truck are team `squad` units that are never soldiers: they have no XP, stats rows, casualty decisions or Memorial entries, cannot be healed (Field Treatment, medkits and time do nothing), take no friendly fire, and show a blue overhead bar plus a HUD meter (exact HP and %). Enemies attack them like any target, and an enemy shooting at an asset may fire from off screen (otherwise enemies still never fire from off screen).

**Mission 13: Hold the Line** (Defense, 3200 x 2200 compound map; `src/defense.ts`, `HOLD_THE_LINE` in `src/missions.ts`):
- **Command center**: 1000 HP, no repair. Destroyed = "The command center was destroyed." and the mission fails. Optional: **it finishes with at least 50% HP** (fails the moment it drops below 500).
- **Preparation is unlimited.** Two guarded turret caches are optional: **A** (south-west, 4 Riflemen + 1 Armored) and **B** (north-east ridge, 5 Riflemen + 2 Armored). Once a cache's guards are dead, a standing soldier spends 3 s in it (progress is kept when you step out). Securing it installs **one turret** at its fixed slot beside the command center and sends **one response group**, once (A: 3 Riflemen from the north-west; B: 2 Riflemen, 1 Armored and 1 more Rifleman from the south-east).
- **Turrets**: **300 HP, 9 damage, 4 shots/s, 420 px**, line of sight required, no repair. A destroyed turret leaves a wreck.
- **Starting the assault**: a standing soldier (allies and downed soldiers don't count) stays in the command zone south of the building for **5 continuous seconds** (HUD countdown and a START chip; stepping out resets it). The three compound gates then close for the rest of the mission (`HOLD_GATED_MAP`); anyone standing in a gate is moved to open ground. Caches lock.
- **Four waves** (`HOLD_WAVES`), each announced with a banner and edge markers. Groups inside a wave arrive a few seconds apart: W1 **north, 8 Riflemen**; W2 **west, 10** (7 Riflemen, 3 Armored); W3 **east, 12** (7 Riflemen, 2 Armored, 3 Snipers); W4 **north + west + east, 14** (8 Riflemen, 3 Armored, 3 Snipers). The next wave comes once at most 2 attackers of the current wave are left **and** at least 15 s have passed, or after 50 s at the latest. Two in three Riflemen / Armored per wave are **siege attackers**: they stop at range and shoot the command center (they still shoot soldiers in the way); the rest hunt the squad. The defense completes only when every wave has spawned and every attacker is down.
- **Budget**: 12 cache guards + 7 responders + 44 wave attackers = **63 enemies at most**, never all at once (the autopilot never saw more than about 27 alive).
- **Allies**: Mara, Elias and Tessa hold posts around the command center with the Mission 11 resistance stats (110 HP, 8 damage, 1.8 shots/s, 380 px). Same rules as in Mission 11 (downed / revive, no account effects).
- **Extraction**: helicopter south-east of the compound, 10 s countdown, **no extraction wave**. Stars: 2 for the optional, 3 for no KIA. First clear unlocks Mission 14.

**Mission 14: Supply Line Sabotage** (Sabotage + capture + escort, `src/escort.ts`, `SUPPLY_LINE` in `src/missions.ts`):
- **Depots**: three, 800 HP each, any order. HUD headline: "Destroy three depots · Depots destroyed: x/3".
- **Truck capture**: the parked truck in the yard can't be captured (or attacked) until all three depots are down. A standing soldier next to it for **3 continuous seconds** captures it (leaving resets).
- **Gunner selection**: the game pauses and a list opens with every standing soldier (name, class, HP) plus **NO GUNNER**. Nothing is preselected; CONFIRM needs an explicit pick. The choice is locked for the escort. Any class may take the gun.
- **Mounted gun** (`CFG.mountedGun`): **7 damage, 10 rounds/s, 450 px**, 25° cone standing, 34° while the truck moves, line of sight, no friendly fire. Training, Elite passives, Rally and class abilities do not apply: the gun is the same for everyone. The gunner rides the truck (gold ring, "· GUNNER" tag), keeps their status row and XP, and cannot use their own weapon or ability.
- **Gunner downed**: thrown clear to open ground beside the truck, the gun goes silent for the rest of the mission ("OFF THE GUN — THE TRUCK GUN IS SILENT"), normal bleed-out and revive, and the revived soldier rejoins the formation on foot (no remount). If the gunner is the last soldier standing, they jump down (gun lost) so the squad is never stuck.
- **Truck**: 600 HP, no repair. It follows the squad's progress along the road and waits about 200 px behind it; it waits when the squad leaves the road, stops for anyone standing in its lane (never runs anyone over; soldiers get nudged aside and formation slots bend out of its lane), and stops at a **roadblock** (an enemy on the road ahead; HUD and banner say so) while the gun keeps firing. Fire from the side never stops it. Near the end it rolls on into the extraction zone by itself. Optional: **it finishes with at least 50% HP**.
- **Truck destroyed** = "The supply truck was destroyed." It leaves a wreck; the gunner is thrown clear **downed, not killed**. A short ceasefire aftermath follows (enemies and squad hold fire, abilities and support are locked) so a revive can finish: it ends as soon as nobody is downed, after 15 s if no revive is running, 40 s at most; then the mission fails under the usual rules (anyone still downed becomes KIA).
- **Ambushes** (`SUPPLY_AMBUSHES`), keyed to the truck's progress, each once, with a banner and markers 2.5-3 s before they arrive: **A1 6** Riflemen (3 go for the truck), **A2 9** (a roadblock of 6 Riflemen / Armored that holds the road + 3 more), **A3 12** (both ridges with a Sniper and an Armored, plus 3 truck hunters behind). 27 in all; spawns never land within 240 px of a soldier or the truck. With 18 depot guards, 5 in the yard and two patrols of 2, the mission has **54 enemies at most**.
- **Extraction**: the truck reaching the end of the road completes the escort; the helicopter lands there (12 s countdown). Stars: 2 for the optional, 3 for no KIA. Mission 15 stays locked.

**Briefings**: the Mission 13 / 14 briefings use the exact story text from the v0.8B brief and list their objectives.

**Saves**: still **v9**, no migration. A save that cleared Mission 12 opens Mission 13 on load without a repair note; Missions 13 / 14 are never unlocked without the clear before them. Every fixture in `tools/fixtures` loads with no notes.

**Tests**: `tools/chapter3b.cjs` (98 checks: sixth slot, M13, M14, saves, phones), `tools/chapter3b-sim.cjs` (autopilot balance runs; `THROTTLE=4` for perf), `tools/chapter3b-e2e.cjs` (real menus from a Mission 12 save through Missions 13 and 14, gunner picked by tapping), `fps-parity.cjs` hashes assets and the escort.

**Known issues / tuning notes (v0.8B)**:
- The autopilot (level 12, six soldiers) clears Mission 13 in about 3-3.8 minutes and Mission 14 in about 2.3 minutes; human players should take roughly 5-7 and 4 minutes, but check on phones. Levers: wave sizes and `CFG.defense` gaps (M13), ambush sizes, depot HP 800 and `CFG.escortTruck.moveSpeed` 72 (M14).
- M13 autopilot: the command center ends at about 550-900 HP without turrets and 970+ with both. M14: the truck ends at about 330-500 HP with a gunner (the gun deals ~280-450 damage, 5-11 kills) and 280-470 HP with No Gunner.
- Roadblocks rarely trigger when the squad clears the road ahead of the truck, which is the intended way to play.

## Chapter 3A: The Resistance Begins (v0.8A)

Chapter 3 ("The Resistance") opens with Missions 11 and 12; Mission 13 shows as "coming soon". Deployment caps are unchanged: Missions 7-12 take 5 soldiers, there is no sixth slot yet.

**Mission briefings** (`src/menus.ts` → `briefingHtml`, text in `CampaignMission.brief` in `src/campaign.ts`). DEPLOY on the Campaign screen no longer starts the mission at once: it opens a briefing with the mission number, title and chapter, a one or two sentence story, the primary objective, the optional objectives ("None" on Missions 1 and 4), a tactical tip, and DEPLOY / BACK. BACK, a tap outside the card or Esc returns to the Campaign screen; Enter deploys. The briefing only opens when the squad could deploy right now, so locked missions, an over-limit squad or a pending casualty decision still block as before. Missions 1-10 describe what each mission actually plays like; nothing names the chapter's final antagonist.

**Enemy group awareness** (`src/awareness.ts`, numbers in `CFG.awareness`, ⚙ → "Enemy awareness (v0.8A)"):
- Triggers, all event-driven (no per-frame search): an enemy is hit by the squad (soldier, resistance ally, grenade, airstrike), an enemy is killed (one-shot kills included), a dormant guard detects the squad (its usual proximity rule), or an already alerted enemy *sees* a soldier.
- The hit / dead / spotting enemy alerts every eligible enemy within **300 px** (`radius`) **once**. Enemies that received an alert never pass it on, and the same enemy broadcasts at most once every 0.5 s, so an alert never cascades across the map.
- Each alerted enemy reacts after **0.3-0.8 s** (deterministic per enemy, no random numbers; Armored Troopers always 0.3 s).
- Knowledge is the threat's position **at the time** (where the shot came from). Alerted enemies walk to that point. They only learn where the squad is now by seeing it (clear line, 460 px, checked every 0.25 s) or by having a target in weapon range. There is no tracking through walls.
- Behaviour by kind: Riflemen detour through nearby cover on the way when there is some, then advance; Armored Troopers push straight in; enemy Snipers move to a firing post at 0.72 x their range from the last known position with a clear line, and hold it.
- Search is bounded: at the last known position an enemy searches three nearby points for 12 s and then settles as a dormant guard again. A leg that makes no progress for 3 s is dropped.
- Scope: placed guards and patrols in every mission. Scripted waves (they already advance on the squad), convoy escorts, towers, trucks and the Iron Warden keep their own behaviour.
- Measured: 40 alerted enemies cost about 0.4 ms per simulation step headless (`tools/chapter3a.cjs` A12).

**Extraction pressure** (`src/mission.ts` → `pressureGroups`, sizes in `CFG.extractionPressure`, ⚙ → "Extraction pressure (v0.8A)"). When the squad reaches the extraction zone and the helicopter countdown starts, a finite number of reinforcement groups enter from map-edge points that are off screen and at least 500 px from every soldier and ally (unused points first, nearest first). An edge arrow ("ENEMIES") and a banner with the compass direction announce each group. They are never required kills, give nothing extra when killed (no per-kill XP or Credits), and the helicopter countdown is unchanged. A mission uses either its scripted final wave or pressure, never both.

| Tier | Groups | Missions |
|---|---|---|
| none | - | 1 First Contact |
| light | 3 at once | 2 Heavy Support |
| scripted (unchanged) | 8 (Mission 3), 2 (Mission 10) | 3 Field Medicine, 10 Iron Fist |
| small | 4 at once | 4 Red Canyon, 5 Bring Them Home |
| moderate | 3 at once, 2 more after 6 s | 6 Bridgehead, 7 Prison Break, 8 Convoy Crusher, 9 Blackout |
| restrained | 3 after 2 s | 11 Resistance Rising |
| strong | 4 at once, then 3 (one Armored) after 7 s | 12 Artillery Hunt |

**Mission 11: Resistance Rising** (Liberation & Defense, farm village map 3000 x 1800; `src/chapter3.ts`, `RESISTANCE_RISING` in `src/missions.ts`):
- Liberate the farm, church and market zones in **any order**. A zone is liberated once its defenders (6 each) are dead and a standing soldier has spent 3 s inside it (progress is kept). HUD: "Zones liberated: x/3" with a chip per zone. After the first and second liberations a garrison group (3, then 4) comes in from the map edge.
- Then return to the resistance safehouse. **Mara, Elias and Tessa** join at their posts and the defence starts: waves of 5 / 6 / 6 at **0 / 20 / 40 s** from the north, east and west, each announced 3 s ahead with a banner and an edge marker. The defence completes at **60 s**, or earlier once all three waves have spawned and every attacker is down; never before the third wave has spawned.
- The allies fight with rifles (110 HP, 8 damage, 1.8 shots/s, range 380), can be downed and revived like soldiers, and follow the squad to the helicopter. They give and get no XP, carry nothing between missions, and an ally who bleeds out is just out of the fight: no casualty decision, no Memorial, no roster change.
- Optional: **all three allies alive through extraction**. Extraction pressure: restrained. Countdown 12 s.

**Mission 12: Artillery Hunt** (Search & Destroy at night, 3200 x 1900; `src/artillery.ts`, `ARTILLERY_HUNT` in `src/missions.ts`):
- Destroy the **three artillery guns** (900 HP each) in any order. HUD: "Artillery destroyed: x/3" plus the searchlight meter. Each destroyed gun brings a response group (3, then 4).
- Six **searchlights** sweep on fixed, deterministic arcs. A soldier or ally inside a beam with a clear line from the lamp is lit; exposure builds while anyone is lit and drains three times as fast when nobody is. About **1 s** of continuous light raises the **artillery alert**; a quick dash across a beam never does.
- While alerted: a red danger circle is placed on the **last detected position** (it never follows anyone) and the shell lands **2.5 s** later. **40 damage** at the centre, falling to half at the 105 px rim, **-60% behind solid cover**, soldiers and allies only (no friendly fire). A new shell every **10-12 s** (alternating), at most **2 circles** at once. The alert clears after **20 s** without detection.
- **Only searchlights** raise the alert. Enemy awareness, guards spotting the squad and firefights never touch it.
- Destroying all three guns disables the artillery for good: pending circles are cancelled and nothing fires again.
- Optional: **no artillery alert**. Extraction pressure: strong. Countdown 15 s. The **first successful clear unlocks the Commando class** (no free soldier; a failed attempt or a replay unlocks nothing).

**Commando** (class `commando`, `CFG.commando`, recruited in the Recruitment Office after the Mission 12 clear; the one-time class introduction guarantees an offer in the next lineup):
- **1,250 CR** (refund 300). **85 HP**, **7 damage and 2.5 shots/s per pistol** (two pistols: about 35 damage/s together), standing cone 10°, moving penalty +14°, **115% move speed** (172.5 px/s vs Infantry 150), **range 340 px** (Infantry / Heavy / Medic 420, Sniper 560), revive 10 s.
- **Dual independent pistols** (`src/combat.ts` → `updateOffhand`): the left pistol picks its own visible target, preferring a different enemy from the right pistol, within 75° of the body's aim; with one enemy in view both pistols fire at it. Each has its own cooldown, muzzle flash and tracer.
- **Bullet Storm** (portrait ability "STORM"): for **8 s** both pistols fire **x1.75**, the moving-fire spread penalty is cut to x0.6, and each pistol keeps choosing its own target. The **40 s cooldown starts when the effect ends** (also when it ends early because the Commando was downed). No targeting step: one tap, no grenade, nothing to aim. The portrait ability buttons of every class keep their look (about 39-42 CSS px drawn on an iPhone SE / 14 / Pixel 7) but now take touches in a 44 x 44 CSS px area (the v0.7D.1 `--t44` pattern; tiles stay 8 px apart, so neighbours never overlap).
- Elite specializations: **Gunslinger** (Quick Draw) and **Assault Specialist** (Close Quarters), see the table in [Elite Promotions](#elite-promotions-v07a).
- Look: blue uniform, black tactical vest with pouches, beret; two pistols in hand. Elite Gunslinger adds a holster belt and glasses, Assault Specialist shoulder pads, a chest plate and a half mask.
- Everything else is the shared system: Recruit XP and levels, Individual and Squad Training, Elite promotion at Recruit Level 25, downed / revive / KIA, resurrection (class price), Memorial, dismissal.

**Recon Specialist**: the Infantry specialization "Recon Commando" is now called **Recon Specialist**, so the name no longer clashes with the new class. The stable id stays `inf-recon`, so saved Elites, the promotion ledger and the Memorial need no migration.

**Saves**: still v9. Every fixture in `tools/fixtures` (v0.2.2 to v0.7C) loads to exactly the same saved JSON as on v0.7D.1. A player who already cleared Mission 10 finds Mission 11 open with no repair note. A Commando in a save that never unlocked the class (no Mission 12 clear) loads as a plain Infantry recruit.

**Known issues / tuning notes (v0.8A)**:
- Autopilot runs finish Mission 11 in about 2.5 minutes and Mission 12 in about 1.5-1.7 minutes at level 12; a human playing carefully should take longer, but phone playtests should check whether the missions feel long enough.
- The awareness broadcast counter used by the tools also counts hits on enemies outside awareness (waves, structures). It is a diagnostic only.

## Elite Promotions (v0.7A)

**Rules** (`src/elite.ts`, `src/economy.ts` → `promote`):
- Eligible: an owned, living soldier at Recruit Level 25 (the level cap), no casualty decision pending, not in a mission, 3,000 CR. The profile shows **★ ELITE PROMOTION AVAILABLE** (roster card: ★ PROMOTE ribbon; Results announce it the mission a soldier reaches level 25) with both specializations, their passives and a permanent-choice notice. Credits short or another block: the choices stay visible, the buttons are disabled with the reason.
- CHOOSE opens a confirmation (name, class, trait, specialization, passive, cost, Credits after, a permanent warning). CONFIRM arms after 0.7 s; CANCEL changes nothing. Confirming is one atomic transaction: Credits deducted, tier `elite`, `elitePath` = the stable spec id, Elite Level 1, a ledger entry in `account.promotions`, saved at once. A failed save write rolls everything back. A double tap, a stale button or a reload can't promote twice; nothing can change the specialization afterwards.
- A ceremony (portrait in the new uniform, name, title, specialization, passive) follows; it doesn't block anything else and closes with CONTINUE / tap outside / Esc.
- The soldier keeps id, name, class, trait, training, career, resurrections and Recruit XP (level 25). **Stats are those of Recruit Level 25 plus the passive**, so Elite Level 1 is never weaker. Everywhere a level is shown it reads **ELITE 1** (never "LV 1").
- Mission XP earned after the promotion goes to Elite XP (`progression.eliteXp`) and Elite levels (v0.7B, below).
- Permadeath unchanged: an Elite can be downed, revived, KIA, resurrected (**2x the Recruit price**, keeps the specialization) or honored in the Memorial (keeps the Elite identity). Dismissal refunds as before, with an extra warning.

**Specializations** (numbers in `CFG.elite`, tunable in ⚙ → "Elite passives (v0.7A)"):

| Class | Specialization | Passive | Effect |
|---|---|---|---|
| Infantry | Elite Trooper (Frontline Survivor) | Adrenaline Rush | Below 35% HP, takes 25% less damage (decided on HP before the hit; off again once healed above 35%) |
| Infantry | Recon Specialist (Mobile Precision Fighter) | Deadeye | Every 5th successful rifle hit +50% damage; misses don't count, grenades excluded |
| Heavy Gunner | Juggernaut (Defensive Tank) | Ironclad | Always takes 20% less damage |
| Heavy Gunner | Weapons Specialist (Sustained Firepower) | Overdrive | Fire rate builds to +25% over 4 s of sustained fire; holds 0.75 s after the last shot, then cools down over 2 s |
| Medic | Combat Surgeon (Emergency Specialist) | Miracle Worker | Revives 30% faster (5 s → 3.85 s; 3.46 s with First Responder) and the revived soldier gets 50% HP instead of 30% |
| Medic | Field Commander (Squad Support Leader) | Rally | Squadmates within 170 px: +10% weapon damage, +10% move speed. Not the Commander, two Commanders don't stack, off while the Commander is down |
| Sniper | Ghost (Armor-Piercing Precision) | Phantom Shot | Every 4th hit ignores 60% of enemy armor: Armored Trooper front plate x0.35 → x0.74; Iron Warden Sniper modifier x1.6 → x2.12 (its 35% plating, `CFG.boss.plating`) |
| Sniper | Deadeye (Deliberate Marksman) | Perfect Aim | Standing still with a target for 3 s charges the next shot: +75%. Moving resets it. Ready indicator on the soldier and the HUD (AIM READY). Charges on time, so Focus gives more ordinary shots but never more charged ones |
| Commando (v0.8A) | Gunslinger (Rapid Target Switching) | Quick Draw | Retargets faster (0.03 s from a new target to the first shot instead of 0.08), turns its aim 40% faster, moving-fire spread penalty x0.75. **Enhanced Bullet Storm**: x2.0 fire rate instead of x1.75 and instant retargeting while it runs |
| Commando (v0.8A) | Assault Specialist (Close-Quarters Brawler) | Close Quarters | Pistol hits on targets within 160 px deal +15% (inside the x2.0 per-shot cap). While Bullet Storm runs, every pistol hit on an enemy restores 1.5 HP, at most 30 HP per activation |

**Stacking control**: incoming damage reduction is capped at 40%; per-shot multipliers (Rally, Deadeye, Perfect Aim) multiply and are capped at x2.0; Phantom Shot only removes armor; Overdrive is added to the fire-rate multiplier (Suppressive Fire x1.75 → x2.0), never multiplied. Measured sustained gains in the specialty: Deadeye about +10% damage (+50% every 5th hit), Overdrive +25% fire rate, Perfect Aim about +31% damage when holding position, Rally +10% damage and speed for every squadmate in range, Phantom Shot about +28% on average against front armor, Miracle Worker 30% faster revives with 67% more HP.

**Look**: Elites wear black tactical uniforms with blue accents; every specialization adds its own shape so they read without colour: Trooper shoulder pauldrons, Recon goggles + antenna, Juggernaut visor + riveted chest plate, Weapons Specialist crossed ammo belts + glowing barrel shroud, Surgeon headlamp, Commander radio mast + chevrons, Ghost ghillie hood, Deadeye long scope + bipod and a ready glint. Elite name tags carry a ★; ground effects show Rally (dashed ring), Adrenaline (pulse), Overdrive (heat ellipse) and the Perfect Aim charge arc.

**Engine**: everything runs in the fixed 1/60 s step and draws no random numbers, so 30 and 60 FPS play identically and a squad without Elites simulates bit-identically to v0.6.4 (`tools/fps-parity.cjs BASE=`). Passive state lives on the mission unit (`EliteState`), so counters and charges reset every mission and Retry.

**Save v8**: adds `progression.eliteXp` and `account.promotions` (the ledger). Loading repairs, with notes: the ledger restores a stripped rank or an edited specialization (no respec through the save); stray Elite fields on a Recruit are cleared; an Elite with a specialization that doesn't fit the class and no ledger entry goes back to Recruit (and can be promoted again); Elite level outside 1..30 becomes 1; an Elite below Recruit Level 25 is raised to it. A pre-v0.7A save never carries Elite data in (no free promotion) and is backed up once under `minisquad.save.pre-v0.7`.

**Debug**: ⚙ → Debug → "Promotion test: Recruits to LV 25 + 25,000 CR (modifies save)…" (tap twice); console `__debugPromotionReady()`, `__elite`.

## Elite Progression (v0.7B)

**XP curve** (`src/elite.ts` → `ELITE_PROGRESSION`, one place to tune): Elite soldiers earn the normal mission XP (same rules as Recruits: survivors of a victory, replays 75%). `progression.eliteXp` is the **cumulative** Elite XP since the promotion and the source of truth; `eliteLevel` is derived from it once, at mission settlement (never per frame). XP to advance from Elite Level L = **600 + 45 × (L − 1)**: 600 for ELITE 1 → 2, 1,860 for ELITE 29 → 30, **35,670 XP** in total. One big award can give several levels; ELITE 30 is the permanent cap (XP earned there is still recorded, but grants nothing). A mission paid about 110-200 XP in v0.7B; since v0.7B.1 mission XP scales with the mission number (below), so Missions 1-10 pay about 94-275 and later missions more. ELITE 30 stays a long-term goal.

| Elite level | 1 | 2 | 5 | 10 | 15 | 20 | 25 | 30 |
|---|---|---|---|---|---|---|---|---|
| Cumulative Elite XP | 0 | 600 | 2,670 | 7,020 | 12,495 | 19,095 | 26,820 | 35,670 |
| Max HP / damage vs Elite 1 | +0 / +0 | +0.9% / +0.5% | +3.4% / +2.1% | +7.8% / +4.7% | +12.1% / +7.2% | +16.4% / +9.8% | +20.7% / +12.4% | **+25% / +15%** |

**Stats**: Elite 1 is exactly the v0.7A soldier (Recruit Level 25 stats with training, squad training, trait, plus the passive). Each Elite level above 1 adds 1/29 of the Elite 30 bonus, linearly: **+25% max HP, +15% weapon damage**, and one class extra: Infantry and Heavy Gunner **-10% weapon spread** (standing and moving; the 1° spread floor still applies), Medic **+10% Field Treatment healing**, Sniper **-10% held-aim time**. The bonus is one multiplier per stat on the soldier's own Elite 1 value (it sits next to the trait in the modifier set), so it never compounds per level and every soldier gets exactly +25% / +15% at the cap whatever their training. **No fire-rate, move-speed, range or revive-time growth.** The eight passives are unchanged; damage-reduction (40%) and per-shot multiplier (x2) caps apply as before, and the level bonus is not a per-shot multiplier (it raises the base damage the multipliers act on, like training does). Examples (no training): Tank (Juggernaut, Tough) 204.6 → 255.75 HP and 15° → 13.5° spread; Ace (Recon, Sharpshooter) 124 → 155 HP and 11.8 → 13.57 damage per shot; Doc (Surgeon) Field Treatment 25% → 27.5% of max HP.

**Feedback**: Results show each Elite's level (ELITE 7, or ELITE 3 → 7 on a level-up), the XP earned and progress to the next level (MAX at the cap), plus a **★ ELITE LEVEL UP! NAME — ELITE 7 (+4 levels)** line. No ceremony: the promotion ceremony stays reserved for promotions. The profile shows the specialization, ELITE n, "Elite XP x / y to ELITE n+1" (or **MAX LEVEL**), a progress bar, the current bonus ("Elite level bonus: +12.1% max HP · +7.2% damage · -4.8% spread"), the passive, and the stats table (with ELITE n as a source tag; Snipers also get an "Aim time" row). Barracks cards show the ELITE n badge with an Elite XP bar; squad slots show ★n + the spec tag (★12 JUG). Elites never show "LV n".

**Save v9**: no new field. A v8 (v0.7A) save keeps every point of banked Elite XP and converts it to the level it buys (status "migrated", no notes); everything else is unchanged. On a v9 load, `eliteLevel` must match `eliteXp`: a lower level is corrected up from the XP; a higher one (hand edit, or a later curve retune) keeps the level and raises the XP to its threshold, so a load never takes a level away. Invalid / missing XP counts as 0; v8 levels (always 1) give no free XP. KIA, resurrection and the Memorial keep the Elite level and XP. The pre-v9 text is backed up once under `minisquad.save.pre-v0.7b`. Settlement is still once per run id, so a reload can't grant XP twice.

**Tests**: `tools/elite-progression.cjs` (curve, stats vs the v0.7A build with `BASE=`, settlement, passives at Elite 1 / 15 / 30, caps, save v9 / v8 migration with the genuine v0.7A fixture `tools/fixtures/v0.7A-save.json`, KIA / resurrection / Memorial, Results / profile / Barracks on three phones, Elite 30 squads in Missions 1-10, 30 / 60 FPS parity).

## Progression & Training Rebalance (v0.7B.1)

**Training ranks** (`src/progression.ts` → `TRAINING` / `SQUAD_TRAINING`, built by `acceleratingBonus(first, last, ranks)`): rank 1 adds `first` (the old flat per-rank value, so no rank is weaker than in v0.7B) and each later rank adds a fixed step more, up to `last` at the final rank. The cumulative table is `TrainingDef.bonus` (`rankBonus(def, rank)`); it is still a percentage of the class base, summed with level growth and squad training, then multiplied by the trait and the Elite level bonus, exactly as before. Prices (250 … 2,500 individual, 1,000 … 3,500 squad), rank limits (10 / 5), the purchase flow and the save format are unchanged: soldiers keep their ranks and simply get the new values.

| Category | Per rank (first → last) | Max rank total | v0.7B total |
|---|---|---|---|
| Damage | +3.0% → +7.0% | **+50%** | +30% |
| Max HP | +5.0% → +6.5% | **+57.5%** | +50% |
| Accuracy (spread) | -5.0% → -6.0% | **-55%** (1° floor) | -50% |
| Fire Rate | +3.0% → +4.0% | **+35%** | +30% |
| Move Speed | +2.0% → +2.5% | **+22.5%** | +20% |
| Squad HP | +2.0% → +3.0% | +12.5% | +10% |
| Squad Damage | +1.5% → +2.5% | +10% | +7.5% |
| Squad Accuracy | -2.0% → -3.0% | -12.5% | -10% |
| Squad Fire Rate | +1.0% → +1.5% | +6.25% | +5% |

Measured against the same soldier without that training: max Damage is +50% at Level 1 and **+42%** at Level 25 (where full training is realistically bought); max HP is +57.5% at Level 1 and **+46%** at Level 25 (+42% with max Squad HP). HP keeps the old 5% first rank so nothing owned got weaker, which puts it a little above the +35-45% design target at low levels. Fire rate and move speed stay modest so DPS, projectile counts and formation movement stay in their v0.7B range. Healing has no training category (unchanged).

Sniper damage, Level 25, no trait (Damage training rank 0 → 10): 37.76 · 38.72 · 39.82 · 41.07 · 42.45 · 43.98 · 45.65 · 47.47 · 49.42 · 51.52 · **53.76** (the last rank adds +2.24; it added +0.96 in v0.7B). At Level 1 the same path runs 32 → 48.

Level 25, no trait, untrained → all 10 individual ranks (v0.7B → v0.7B.1), HP / damage per shot:

| Class | Untrained | Fully trained, v0.7B | Fully trained, v0.7B.1 | + max Squad Training + Elite 30 (v0.7B.1) |
|---|---|---|---|---|
| Infantry | 124 / 11.8 | 174 / 14.8 | **181.5 / 16.8** | 242.5 / 20.47 |
| Heavy Gunner | 186 / 7.08 | 261 / 8.88 | **272.25 / 10.08** | 363.75 / 12.28 |
| Medic | 99.2 / 8.26 | 139.2 / 10.36 | **145.2 / 11.76** | 194 / 14.33 |
| Sniper | 93 / 37.76 | 130.5 / 47.36 | **136.13 / 53.76** | 181.88 / 65.5 |

**Training tab**: each row shows the soldier's real current value → the value after the next rank (level, trait, squad training and Elite bonus included, computed by the same `effectiveStats` the game uses, so the preview always equals the stat after buying), the exact gain and the rank it buys ("+2.24 damage · rank 10"), and the price on the Buy button.

**Mission XP** (`PROGRESSION.missionXp`, `missionXp(n)`): the Victory line pays by mission **number**: 125 at Mission 1 rising to 150 at Mission 5, then +10 per mission, rounded to 5. Missions 11-50 use the same formula automatically when they are added (no placeholder missions). The bonus lines (+25 per optional objective, whole squad extracted, nobody downed), the replay multiplier (x0.75 of the total) and all Credit rewards are unchanged. A replay pays the replayed mission's own value (Mission 4 replay: 145 Victory, not the player's furthest mission). Unknown mission ids pay the Mission 1 value. `PROGRESSION.xp.victory` is now `null` (a number overrides the curve, for tests).

| Mission | 1 | 2 | 3 | 4 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Victory XP (first clear) | 125 | 130 | 140 | 145 | 150 | 200 | 250 | 300 | 350 | 400 | 450 | **500** | 550 | **600** |
| v0.7B | 100 | 100 | 100 | 100 | 100 | 100 | | | | | | | | |

With every bonus a Mission 10 first clear pays 275 XP per soldier (replay 206); Mission 1 pays 175 (replay 131). Recruit Levels 1-25 (10,500 XP), Elite Levels 1-30 (35,670 XP), the 3,000 CR promotion, the passives, KIA / resurrection / Memorial are untouched.

**Tests**: `tools/training-rebalance.cjs` (with `BASE=<v0.7B build>`: prices and limits, accelerating ranks, never weaker than v0.7B, Sniper path, max damage / HP, caps, pipeline order and no double application, Elite 30 bonus and combat caps, preview = post-purchase in the real UI, mission XP 1-50, replays, Credits / thresholds / enemies identical to v0.7B, v0.7B save with training loads unchanged and gets the new benefits, save / reload, KIA + resurrection, Training tab on three phones, fully trained Elite 30 squads in Missions 1-10 and at 30 / 60 FPS). `tools/progression.cjs` expectations moved to the new XP and training values.

## Tactical Support (v0.7C)

Code: `src/support.ts` (rules, state, damage), numbers in `src/config.ts` → `CFG.airstrike` / `CFG.nuke` / `CFG.support` (live sliders: tuning panel → "Tactical Support (v0.7C)").

**Eligibility** is counted once, at deployment: the number of Elite soldiers in the deployed squad (Elites left in the Barracks don't count; any class mix). 3 or more → airstrike; 6 → nuke. A soldier downed or KIA during the mission doesn't take the abilities away, and a soldier added mid-mission (dev key F) doesn't add them. Deployment caps are unchanged (M1-2: 2, M3-5: 3, M6: 4, M7-12: 5, M13+: 6), so in the current ten missions only the airstrike can appear; the nuke is reachable today only through the dev harness (six roster soldiers as a temporary squad).

**Tactical Airstrike** (free, once per mission attempt; a Retry is a new attempt):
1. AIRSTRIKE (or Q) → aiming. The squad keeps fighting. While aiming, any new touch (left half included) places the circle and dragging moves it; a joystick already held keeps moving the squad. Mouse: left click places. A grenade target and the airstrike cancel each other.
2. The circle drawn is the exact damage area (radius **120** world px, measured from each unit's centre).
3. CONFIRM (or Enter) → INCOMING with a jet pass; CANCEL / Esc / right click costs nothing.
4. **2.0 s** of simulation time later (pauses with the game): one damage pass, linear falloff from 100% at the centre to 50% at the rim.

**Nuclear Strike** (Barracks → SUPPORT, 3,000 CR each, stock kept between missions, any number):
1. NUKE (or N) → confirmation ("Uses 1 of your N Nuclear Strikes … can't be cancelled or refunded"). LAUNCH arms after 0.5 s so a double tap can't launch by accident.
2. LAUNCH spends one at once and saves it before the countdown starts (if the save write fails, the launch is cancelled and nothing is spent).
3. **30 s** countdown in simulation time: it pauses with the game, and the mission goes on (movement, combat, objectives). Beeps from 10 s, a siren and a full-screen warning for the last 5 s, then a white flash, shockwave and mushroom cloud.
4. Detonation: one pass over every active enemy on the map, on screen or not (off-screen kills skip their particles). One nuke per mission attempt; a failed mission, a quit or a reload during the countdown leaves it spent.

**Damage** (fixed numbers: soldier training, Elite levels, traits, Rally and passives don't apply; no XP, kill credit or damage stats for support):

| Target | Airstrike centre → rim | Nuke |
|---|---|---|
| Rifleman (40 HP), Sniper (45), Watchtower (80) | 260 → 130 (dies) | 1000 (dies) |
| Armored Trooper (140) | 156 → 78 (x0.6; dies inside ~24 px of the centre) | 1000 (dies) |
| Mission objectives: depot 600, relay 900, installation 700, convoy truck 1000 | 130 → 65 (x0.5) | 500 (x0.5) |
| Iron Warden (2,400) | 15% of max HP → 7.5% (360 → 180) | 40% of max HP (960) |
| Squad, captives, allies | 0 | 0 |

**Floors**: support never takes a boss below **10%** of its max HP and never takes a mission objective (structures, convoy trucks, anything marked `objective`) below **1 HP**; the squad finishes them. Vehicle and objective multipliers are separate settings, but every vehicle in the current missions is an objective, so the objective rule applies to all of them.

**Why these numbers**: the airstrike wipes a cluster of infantry and badly hurts armor, a strong but local tool that still leaves the boss and objectives to the squad. The nuke clears the map of everything but the boss and objectives, which keep work for the squad. At 3,000 CR (the same as a promotion) it is a real choice in a Chapter 2 economy.

**Saves**: still **v9**. `account.support = { nukes, purchased, launched }` is optional: a v0.7B.1 save without it loads with stock 0, no repair note and nothing else changed (checked with the genuine v0.7B.1 save `tools/fixtures/v0.7B.1-save.json`). An unreadable stock is restored as `purchased − launched` with a repair note; junk never touches Credits or soldiers. Purchases use the same atomic transaction as training (rolled back if the save write fails), are refused during a mission or while a casualty decision is pending, and a repeated tap for the same stock is refused.

**HUD**: AIRSTRIKE / NUKE buttons sit top left under the timer (the joystick zone stays free) and appear only when eligible (NUKE also shows when you own stock). The airstrike CONFIRM / CANCEL bar sits on the right above the soldier panels; the nuke confirmation is centred below the objective banner. Labels: READY / AIMING… / INCOMING 1.2s / USED; READY · 2 / 0 STOCK / 23s / USED.

**Tests**: `tools/support.cjs` (brief items 1-44: data, eligibility, airstrike targeting / delay / falloff / friendly fire / floors, shop and stock, launch / countdown / pause / detonation / floors / failure / reload, v0.7B.1 save, rewards / XP / KIA / training / enemy numbers identical to v0.7B.1 with `BASE=`, 30 / 60 FPS parity with both strikes, detonation cost under a 4x CPU throttle, touch flows and layout on iPhone SE / iPhone 14 / Pixel 7; screenshots to `$OUT`).

## Accuracy Soft Floor & HUD Touch Areas (v0.7D.1)

**The problem (v0.7D).** Individual and Squad Accuracy add up (−55% and −50% of the class base spread), and the sum passed −100%, so the hard 1° floor was reached early and the moving penalty froze with it. Squad ranks 9-10 did nothing for a fully trained Infantry / Heavy Gunner / Medic (18,500 CR), ranks 3-10 did nothing for a fully trained Sniper (43,750 CR). The audit and the option comparison (A additive, B multiplicative, C multiplicative with lower bases, D soft floors) are in `/mnt/project-files/minisquad/v0.7D.1/ACCURACY-PROPOSAL-v0.7D.1.md`; multiplicative stacking (B / C) would have cost top builds up to 58-65 hit-rate points when moving.

**The fix (Option D, `src/classes.ts` `effectiveStats`, `src/progression.ts` `softFloor`).** Training still adds up exactly as before (additive, base spreads and tables unchanged). Only the end of the curve changes:
- Standing cone: `raw = classCone × (1 + individual + squad)` (not clamped at 0). At `raw ≥ 1° + 0.5°` it is used as is (**bit-identical to v0.7D**); below that it eases into the floor, `1° + 0.5° × e^((raw − 1.5°) / 0.5°)`, so it never goes below 1° and never quite reaches it. Constant: `PROGRESSION.spreadSoftness = 0.5`.
- Moving penalty: as in v0.7D until it would freeze (the class's penalty at the floor); after that it keeps shrinking towards `PROGRESSION.moveFloorShare = 0.5` of that frozen value (never below it).
- Class base spreads, trait / Elite multipliers (Sharpshooter, Eagle Eye, Dead Calm, Elite level bonus), the 1° floor, prices, ranks and saved purchases are unchanged. Random numbers per shot, the fixed 1/60 s step and frame-rate parity are unaffected (one pure function; only values near the floor change).

| Build (Individual / Squad) | Infantry v0.7D → v0.7D.1 | Heavy Gunner | Medic | Sniper |
|---|---|---|---|---|
| 0 / 0, 5 / 5 | unchanged | unchanged | unchanged | unchanged |
| 10 / 0 | 5.40° / 13.50° (unchanged) | 6.75° / 18.00° (unchanged) | 4.50° / 12.60° (unchanged) | 1.13° / 8.32° → 1.24° / 8.44° |
| 10 / 2 | 4.56° / 11.40° (unchanged) | 5.70° / 15.20° (unchanged) | 3.80° / 10.64° (unchanged) | 1.00° / 7.40° → 1.17° / 7.26° |
| 10 / 5 | 2.40° / 6.00° (unchanged) | 3.00° / 8.00° (unchanged) | 2.00° / 5.60° (unchanged) | 1.00° / 7.40° → 1.07° / 5.44° |
| 10 / 8 | 1.00° / 2.50° → 1.12° / 2.35° | 1.00° / 2.67° → 1.17° / 2.80° | 1.00° / 2.80° → 1.09° / 2.44° | 1.00° / 7.40° → 1.03° / 4.83° |
| 10 / 10 | 1.00° / 2.50° → 1.01° / 1.79° | 1.00° / 2.67° → 1.01° / 1.86° | 1.00° / 2.80° → 1.01° / 1.95° | 1.00° / 7.40° → 1.02° / 4.56° |

(standing° / moving° at full speed.) The standing number of a build near the floor can read up to 0.18° higher than in v0.7D (cosmetic: those cones are far below every hit window, simulated hit chance vs a still Rifleman is unchanged for Infantry / Heavy / Medic). A band of Sniper builds with about 40-60% combined training is up to 0.18° wider when moving (worst hit-chance loss 3.0 points, a Dead Calm Sniper at 300 px); every Sniper above that band, including every fully trained one, hits more on the move (I10 / S10 at 540 px: 40% → 65%).

**Not done on purpose.** Fully trained soldiers are effectively 100% accurate against *stationary* targets while moving (a design decision: no deliberate nerf). **Future combat improvement, for separate review: target leading.** Rounds are not led, so a tight cone reliably lands behind a *crossing* enemy; against a rifleman advancing at 45° at 300-400 px, tightly trained Infantry / Heavy / Medic hit only 13-15% (untrained 25-35%), and the Sniper's 540 px shots suffer too. Accuracy training can therefore lower the hit chance against crossing targets. Not changed in this patch.

**Previews.** The individual Training row and the Squad Training example show the real standing and moving change of the next rank (`−0.022° / −0.11° moving spread`); both footers say the effect tapers off near the floor but never stops.

**HUD.** Mute / pause / settings keep their look; each gets an invisible touch area of `var(--t44)` (44 CSS px in stage px, as AIRSTRIKE / NUKE since v0.7D) and the row's gap and corner offsets grow with it so the areas tile without overlapping (iPhone SE: 22.9 → 44.5 × 45 CSS px; iPhone 14 23.8 → 45; Pixel 7 25.2 → 44.5). Desktop layout identical to v0.7D.

**Tests**: `tools/accuracy.cjs` (every rank narrows both cones for every class / trait / Elite 30 combination; floor never crossed; bit-identical above 1.5° and no-loss bounds vs v0.7D with `BASE=`; tables / prices / bases unchanged; tuned bases under the floor; genuine v0.7C save; preview text; combat cone; touch areas ≥ 44 × 44 on three phones, no overlap with the objective box in all ten missions, timer, support buttons, panels or warnings; edge taps; desktop layout identical). `squad-training.cjs` C6 / C6b and `progression.cjs` expectations moved to the soft floor.

## Squad Training Expansion & Mobile Polish (v0.7D)

**Squad Training** (`src/progression.ts` → `SQUAD_BONUS` / `SQUAD_TRAINING`): four categories, **10 ranks** each, from an explicit cumulative table (it no longer uses `acceleratingBonus`). The bonus is a percentage of each class's base stat, added once to level growth and individual training (`bonusFractions`), then multiplied by the trait and the Elite level bonus, exactly as before. Accuracy reduces weapon spread (standing and moving), never a hit chance; the 1° floor still applies.

| Rank | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Squad HP | +3% | +7% | +12% | +18% | **+25%** | +29% | +33.5% | +38.5% | +44% | **+50%** |
| Squad Damage | +2% | +5% | +9% | +14% | **+20%** | +23% | +26.5% | +30.5% | +35% | **+40%** |
| Squad Accuracy (spread) | −3% | −7% | −12% | −18% | **−25%** | −29% | −33.5% | −38.5% | −44% | **−50%** |
| Squad Fire Rate | +1.5% | +3.5% | +6% | +9% | **+12.5%** | +14.5% | +16.75% | +19.25% | +22% | **+25%** |
| Price (CR) | 1,000 | 1,500 | 2,000 | 2,750 | 3,500 | 4,500 | 5,500 | 7,000 | 8,500 | 10,000 |

v0.7C rank 5 was +12.5% / +10% / −12.5% / +6.25%. Each five-rank tier grows its step (Squad Damage ranks 6-10 add +3 / +3.5 / +4 / +4.5 / +5 points of class base damage). 46,250 CR per category, **185,000 CR** for all four. Credit rewards, individual training (prices, ranks, tables), Recruit / Elite XP curves, class base stats, enemies, missions and Tactical Support are unchanged.

**What it means in combat** (Level 25, all 10 individual ranks, no trait; HP / damage per shot / shots per second / standing spread / damage per second before passives):

| Class | No squad training | v0.7C squad max (rank 5) | v0.7D rank 5 | v0.7D rank 10 | Elite 30 + v0.7D rank 10 |
|---|---|---|---|---|---|
| Infantry | 181.5 / 16.8 / 4.41 / 5.4° / 74 | 194 / 17.8 / 4.6 / 3.9° / 82 | 206.5 / 18.8 / 4.79 / 2.4° / 90 | 231.5 / 20.8 / 5.16 / 1° / 107 | 289.4 / 23.92 / 5.16 / 1° / 123 |
| Heavy Gunner | 272.3 / 10.08 / 10.29 / 6.75° / 104 | 291 / 10.68 / 10.73 / 4.88° / 115 | 309.8 / 11.28 / 11.16 / 3° / 126 | 347.3 / 12.48 / 12.04 / 1° / 150 | 434.1 / 14.35 / 12.04 / 1° / 173 |
| Medic | 145.2 / 11.76 / 3.67 / 4.5° / 43 | 155.2 / 12.46 / 3.83 / 3.25° / 48 | 165.2 / 13.16 / 3.99 / 2° / 52 | 185.2 / 14.56 / 4.3 / 1° / 63 | 231.5 / 16.74 / 4.3 / 1° / 72 |
| Sniper | 136.1 / 53.76 / 1.18 / 1.13° / 63 | 145.5 / 56.96 / 1.23 / 1° / 70 | 154.9 / 60.16 / 1.28 / 1° / 77 | 173.6 / 66.56 / 1.38 / 1° / 92 | 217 / 76.54 / 1.38 / 1° / 105 |

Because the percentages are of the class base and add to the soldier's other bonuses, a "+4 pts" rank raises a trained soldier's final damage by less than 4% (Squad Damage 7 → 8 on a fully trained Level 25 Infantry: 19.45 → 19.85, +2%). **Accuracy saturates** for fully trained soldiers: individual Accuracy 10 (−55%) plus Squad Accuracy reaches the 1° floor at squad rank 8 for Infantry, Heavy and Medic (rank 2 for the Sniper); later ranks still help partially trained soldiers and new recruits. When the two together pass −100% the moving penalty is scaled to the floor in closed form (it used to collapse to 0, which never happened before v0.7D).

**Existing saves**: ranks are stored as numbers, so a v0.7C player keeps every rank and simply gets the new bonus (Squad Damage 5: +10% → +20%), with Credits unchanged and five more ranks to buy. Save **v9**, no migration; ranks are now validated to 0-10. Checked with a genuine v0.7C save (`tools/fixtures/v0.7C-save.json`).

**Squad Training tab**: each row shows the name, ten rank pips and RANK n/10; "Current +26.5% → Next +30.5%"; "Upgrade gain: +4 pts of class base damage for every soldier"; and one soldier's real stat before → after (the soldier selected in the Training tab, else your highest level soldier; computed with `effectiveStats`, so it equals the stat after buying). The button shows the price, or MAXED at rank 10. Fits iPhone SE landscape without horizontal scrolling.

**HUD touch targets**: the HUD is laid out on the 1280×720 stage and scaled to the screen (×0.52 on an iPhone SE), which made AIRSTRIKE / NUKE about 69 × 27 CSS px. They now sit side by side under the timer and each has an invisible touch area at least 44 CSS px tall (the visible button is unchanged), centred on the button so the two never overlap; `--t44` (44 CSS px in stage px) is set on the stage at every resize. CONFIRM / CANCEL (airstrike) and LAUNCH / CANCEL (nuke) grow to at least 44 CSS px tall on small phones. Measured (visible → touch area, CSS px): iPhone SE 69 × 27 → 70 × 45.5; iPhone 14 72 × 28 → 72 × 46; Pixel 7 76 × 30 → 76 × 45.5; CONFIRM / CANCEL 78-86 × 45, LAUNCH / CANCEL 125-137 × 45. Desktop is unchanged. Targeting, drag and the 0.5 s LAUNCH arm delay are unchanged.

**Tests**: `tools/squad-training.cjs` (brief items 1-38: tables, prices and totals, purchases and refusals, Credit rewards / individual training / XP curves / enemies / missions / support numbers identical to v0.7C with `BASE=`, bonus on every soldier and new recruits applied once, passives / buffs / caps, spread floor, Heavy Gunner fire rate and projectiles, preview = post-purchase, genuine v0.7C save, ranks 6-10 and a fully upgraded account through reload, repair clamps, KIA / resurrection / Memorial, Squad Training tab and HUD touch areas on iPhone SE / iPhone 14 / Pixel 7 / desktop, airstrike and nuke flows by touch, Missions 1-10 won by fully upgraded squads, 30 / 60 FPS parity with six fully upgraded Elites, and a performance pass; screenshots to `$OUT`).

**Performance** (headless Chromium, iPhone 14 landscape viewport at DPR 3, 4x CPU throttle; not a real phone): six fully upgraded Elites (Elite 30, all individual training, Squad Training 10/10/10/10, three Weapons Specialist Heavy Gunners at 12.0-12.6 shots/s each) against 40 enemies, then abilities, an airstrike impact and a nuke detonation. One 30 FPS frame = 2 fixed simulation steps + 1 render; median of three runs:

| Phase | v0.7D p50 / p95 / max (ms) | v0.7C, same scenario |
|---|---|---|
| Firefight (120 frames) | 14.2 / 36.0 / 53.3 | 15.9 / 40.1 / 68.3 |
| Abilities active (45) | 12.4 / 23.4 / 38.9 | 12.6 / 29.6 / 55.8 |
| Airstrike impact (20) | 11.5 / 37.1 / 37.1 | 12.3 / 24.6 / 24.6 |
| Nuke detonation (30) | 7.4 / 35.2 / 45.5 | 7.2 / 28.9 / 33.0 |

Peak 37 squad projectiles in flight and ~480 particles. Every phase's median frame fits the 33 ms budget at 30 FPS, with occasional single frames over it in both builds (about 6% of firefight frames); v0.7D is within run-to-run noise of v0.7C. No optimization was needed. The simulation is bit-identical at 30 / 60 FPS caps on 60 and 120 Hz displays with this squad, both strikes included. Caveat: the headless rasterizer stalls for 1-2.5 s when hundreds of frames are rendered in one synchronous call (any build), so the measurement yields between frames like a real frame loop.

## Performance (v0.6.3)

- **Frame loop** (`src/main.ts`, `src/perf.ts`): the simulation always runs fixed 1/60 s steps (SimClock). Drawing is capped at 60 FPS by a frame pacer; skipped display refreshes do no work, and the next drawn frame runs the steps for the elapsed time, so a 30 FPS cap is two steps per frame and plays identically. Paused / Results screens redraw at 15 FPS, menus poll at 10 FPS (they are plain DOM). Screen shake uses its own random source so the number of frames drawn can never change gameplay randomness (in v0.6.2 a 120 Hz display drew more frames than a 60 Hz one and so shifted the gameplay random sequence).
- **Hidden / inactive**: hiding the page pauses the mission and the clock (v0.6), and now also suspends audio; losing focus without being hidden (system overlay, call banner, another window) pauses the mission too. Pausing never runs bleed-out, so it cannot be used to dodge KIA, and closing the app mid-mission still resolves through the v0.6 journal.
- **Simulation** (`src/world.ts`, `src/unit.ts`): the multi-source flow field the enemies follow (rebuilt every 0.3 s over the whole map, 20,000-28,000 cells on Chapter 2 maps) was 50-65% of all simulation time and produced a 15-35 ms spike every 0.3 s on a desktop CPU. It now uses precomputed neighbour masks, a reusable typed heap, skips cells already expanded with the same value, and is not rebuilt when no soldier changed cell. Same algorithm and visiting order: the field is bit-identical (checked on 1,500 random fields across all 10 maps). Squad soldier stats were recomputed on every read (several times per unit per step); they are now cached for one step and still follow live tuning changes.
- **HUD** (`src/hud.ts`): every per-frame DOM write is skipped when the value hasn't changed.
- **Memory**: only the current map's ground bitmap is kept (each is 10-30 MB; v0.6.2 kept one per map visited).
- **Settings → Performance** (⚙, or `?fps=30|60` / `?perf=1` for testing; stored under `minisquad.dev.perf` as `{v: 2, fpsCap?, overlay}`, never in the save): frame cap 30 / 60 (v0.6.4 default: 30 on mobile, detected as a coarse primary pointer or a mobile browser, 60 on desktop; only an explicit pick is stored, and the v0.6.3 format's stored 30 counts as a pick while its 60, which it also wrote when only the overlay changed, does not) and an overlay with FPS, display rate, frame time, simulation and draw time per frame, busy ms per second, enemies, squad, bullets, grenades, effects, line-of-sight checks, A* searches and flow-field builds per second, and JS heap.
- **Tools**: `tools/perf.cjs` (headless profile: per-step update and render cost, real frame loop on an emulated 60 / 120 Hz display with main-thread busy time, menus), `tools/fps-default.cjs` (v0.6.4 default cap per device, stored picks, v0.6.3 preferences, Settings display, frames drawn), `tools/fps-parity.cjs` (seeded runs of the real frame loop at 60 / 90 / 120 Hz with caps 60 / 30 must hash identically; with `BASE=` the simulation must match another build; focus-loss pause and idle-screen checks). These are automated headless-browser measurements, not phone measurements: no battery, temperature or real-device data. Results: `minisquad/v0.6.3-perf/` in the project files.

## Planned cleanup (playtest notes, not changed in v0.6 / v0.6.1)

- Mission 4 (Red Canyon Ambush) is challenging but manageable in human play. In the v0.5 autopilot, L1-recruit squads won it 5 times in 11 attempts. With permanent death, **do not increase its difficulty**.
- ~~Mission 5 (Bring Them Home): the captive trails at the back of the squad~~ done in v0.6.2: the protective ring formation (Missions 5 and 7), see Chapter 2.
- Mission 5's optional "The captive takes no damage" is hard to get (same cause).
- `tools/logic.cjs`: the Ranger Quick Reflexes move-speed check fails intermittently (timing-sensitive measurement, pre-existing).
- ~~Design question (v0.6): a failed mission brings downed soldiers home~~ resolved in v0.6.1: downed soldiers are KIA when a mission fails.
- Design question (v0.6.1): closing / reloading the app mid-mission still brings downed (not yet KIA) soldiers home without rewards, so quitting is a possible exploit. Kept as is on purpose; a separate decision (no retreat mechanic exists).
- Broader campaign difficulty tuning after more human playtesting. v0.6.1 changed no mission difficulty, but failed missions now cost lives, so deaths will rise naturally.

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
| Airstrike (3 deployed Elites) | Q, click to place, Enter / CONFIRM (Esc / right-click cancels) | AIRSTRIKE, tap / drag to place, CONFIRM |
| Nuclear Strike (6 deployed Elites) | N, then LAUNCH (Esc cancels) | NUKE, then LAUNCH |
| Campaign | click a mission (↑ / ↓), Enter opens the briefing, Enter again deploys (Esc back), B opens the Barracks | tap a mission, DEPLOY, then DEPLOY / BACK in the briefing |
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
