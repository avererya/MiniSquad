// Suite registry for the test runner (tools/test.cjs, `npm test`). One entry per tools/*.cjs script.
//
//   kind     rules   prints one PASS / FAIL line per check, exits 1 on any failure (counted; part of `all`)
//            report  simulation / balance / perf report, no PASS/FAIL contract (status = exit code only)
//            screens screenshots for review by eye (status = exit code only)
//            legacy  kept for history, not in any group
//   base     { ref, label }: the build served as BASE. The runner builds that commit into node_modules/.cache/minisquad-tests
//            (`--base none` skips it, `--base <ref>` overrides it). Every BASE suite uses PREV, the previous gameplay
//            release: their "identical to BASE" checks only hold against it (the suites were first written against
//            v0.7A-v0.7D, whose numbers later releases changed on purpose). Move PREV forward when a release ships.
//   out      true when the script writes screenshots by default (OUT defaults to the working directory or a
//            fixed path), so the runner always points OUT at the run's log folder.
//   needs    extra setup the suite needs beyond a served build (shown in --list).
//
// Groups are unions of suite names; `all` is every `rules` suite (full regression). Keep SYSTEM_MAP.md's
// "Which tests to run" table in step with this file.
const PREV = { ref: 'c3cae3d', label: 'v0.8B' };
// v0.8B.2's own suite compares against the release it changes (the older suites stay on PREV, see above).
const V081 = { ref: 'c6ae985', label: 'v0.8B.1' };
// v0.8C's suite compares against v0.8B.2 (Missions 1-14 and every class must be unchanged).
const V082 = { ref: '3199529', label: 'v0.8B.2' };
// v0.8C.1's story suite compares against v0.8C (every number, Missions 1-15 and the Mission 15 rewards unchanged).
const V08C = { ref: '1acc610', label: 'v0.8C' };
// Phase 3's suite compares against v0.8C.1 (the architecture changes must not change a single number or outcome).
const V08C1 = { ref: '924dc13', label: 'v0.8C.1' };
// v0.9B's suite compares against v0.9A (every number and Missions 1-16 unchanged; Mission 16 only gains its unlock).
const V09A = { ref: '550fcb8', label: 'v0.9A' };
// v0.9B.1's suite compares against v0.9B (only the extraction pressure, its countdowns and Missions 17-18 change).
const V09B = { ref: '2d09342', label: 'v0.9B' };
// v0.9B.2's suite compares against v0.9B.1 (only Mission 18's rooftop snipers and extraction assault change).
const V09B1 = { ref: 'f4cf5e0', label: 'v0.9B.1' };
// v0.9C's suite compares against v0.9B.2 (only Mission 19 is new; Mission 7's name and Mission 18's unlock change).
const V09B2 = { ref: '4199686', label: 'v0.9B.2' };
const V09C = { ref: '82e10ca', label: 'v0.9C' };
const V09D = { ref: '53d2762', label: 'v0.9D' };

const SUITES = [
  // ---- rule suites (PASS / FAIL per check) ----
  { name: 'logic', kind: 'rules', about: 'core combat / movement / revive / pickups / traits rules (Mission 3 map)' },
  { name: 'maps', kind: 'rules', about: 'A* reachability of every spawn / objective / extraction on the Mission 1-10 maps' },
  { name: 'accuracy', kind: 'rules', base: PREV, about: 'spread soft floor, cones per rank, touch areas on three phones' },
  { name: 'barracks', kind: 'rules', about: 'Barracks / save / reload flow through the real UI, invalid-save recovery' },
  { name: 'campaign-rules', kind: 'rules', about: 'unlocks, stars, squad caps, chapter totals' },
  { name: 'recruitment', kind: 'rules', about: 'Recruitment Office offers, prices, rename, dismiss, rollback' },
  { name: 'recruit-mobile', kind: 'rules', about: 'Recruitment Office on three phones' },
  { name: 'failure-recruit', kind: 'rules', about: 'failed missions, named recruits, v6 saves' },
  { name: 'failure-recruit-mobile', kind: 'rules', about: 'failure / named-recruit screens on three phones' },
  { name: 'permadeath', kind: 'rules', about: 'KIA, resurrection, Memorial, Operation Phoenix, interrupted runs, v5 saves' },
  { name: 'permadeath-mobile', kind: 'rules', out: true, about: 'permadeath screens on three phones' },
  { name: 'progression', kind: 'rules', about: 'XP curve, training, Training tab controls, v2 migration' },
  { name: 'training-rebalance', kind: 'rules', base: PREV, about: 'training tables never weaker than v0.7B, rewards, saves, Training tab on phones' },
  { name: 'squad-training', kind: 'rules', base: PREV, about: 'Squad Training tables, prices, passives, floor, saves, phones' },
  { name: 'elite', kind: 'rules', about: 'Elite promotion, specializations, passives, caps, v8 saves' },
  { name: 'elite-progression', kind: 'rules', base: PREV, about: 'Elite Levels 1-30, Elite XP, v9 saves' },
  { name: 'support', kind: 'rules', base: PREV, about: 'Tactical Support: airstrike, Nuclear Strike, shop, floors' },
  { name: 'mobile', kind: 'rules', out: true, about: 'landscape HUD, joystick, touch areas on three phones' },
  { name: 'chapter2', kind: 'rules', about: 'Missions 6-10: enemy Sniper, Armored, towers, convoy, boss, captives, v7 saves' },
  { name: 'chapter2-mobile', kind: 'rules', about: 'Chapter 2 HUD and sniper laser on phones' },
  { name: 'chapter3a', kind: 'rules', about: 'Missions 11-12: awareness, Commando, artillery, safehouse' },
  { name: 'chapter3b', kind: 'rules', about: 'Missions 13-14: defense waves, assets, escort truck, six-soldier squads' },
  { name: 'v081', kind: 'rules', base: PREV, about: 'v0.8B.1 difficulty, extended escort, Ability Capacity' },
  { name: 'v081-collision', kind: 'rules', base: PREV, about: 'truck / squad collision stress (12 scenarios)' },
  { name: 'v081-e2e', kind: 'rules', about: 'Missions 13-14 end to end through the menus from a v0.8B save' },
  { name: 'v082', kind: 'rules', base: V081, about: 'v0.8B.2 enemy Sniper rebalance, Mission 14 suspense HUD, Settings without tuning sliders' },
  { name: 'v08c', kind: 'rules', base: V082, about: 'v0.8C Mission 15 (gates, relays, General Voss, allies), Demolitions Expert, Inferno, unlock, saves' },
  { name: 'story', kind: 'rules', base: V08C, out: true, about: 'v0.8C.1 story cinematics: Mission 15 pre-boss / phase / victory dialogue, blocking, skip, auto-advance, extraction, rewards, phones' },
  { name: 'arch', kind: 'rules', base: V08C1, about: 'Phase 3 extension points: MissionScript.mechanics hooks, blastDamage, shared page helpers; Missions 1-15 and a seeded grenade / rocket firefight identical to v0.8C.1' },
  { name: 'v09a', kind: 'rules', base: V08C1, about: 'v0.9A Chapter 4 / Mission 16 Jungle Sweep: MineField (reveal, triggers, blast, tap orders, chains), map safety, flow, rewards, saves, phones; Missions 1-15 identical to v0.8C.1' },
  { name: 'v09b', kind: 'rules', base: V09A, about: 'v0.9B chapter rename, airstrike / nuke vs mines, Mission 17 Fuel for the Fire (FuelDepot: blasts, chains, targeting, credit), Mission 18 Ambush Alley (ambushes, rooftop snipers, caches), saves, phones; Missions 1-16 identical to v0.9A' },
  { name: 'v09b1', kind: 'rules', base: V09B, about: 'v0.9B.1 extraction pressure (staggered light / standard / intense tiers per mission, immediate extraction), concealed rooftop snipers (reveal, telegraph, geometry), Mission 17 pickets + counterattack, Mission 18 swarms; everything else identical to v0.9B' },
  { name: 'v09b2', kind: 'rules', base: V09B1, out: true, about: 'v0.9B.2 Mission 18: two isolated concealed rooftop snipers (springing, reveal, isolation, kill from the street), the 26-strong three-direction extraction assault (timing, safety, engagement vs v0.9B.1); everything else identical to v0.9B.1' },
  { name: 'fps-default', kind: 'rules', about: 'default frame cap (30 phone / 60 desktop) and Settings' },
  { name: 'fps-parity', kind: 'rules', about: '30 / 60 FPS play identically (seeded autopilot, Missions 7, 9, 10, the Mission 15 Voss fight, Mission 16 and its minefield)' },

  // ---- reports (no PASS / FAIL contract) ----
  { name: 'campaign', kind: 'report', about: 'campaign autopilot balance report (MODE, MISSIONS, RUNS, CAMPAIGNS)' },
  { name: 'balance', kind: 'report', about: 'hit-rate / autopilot experiments (MODE=accuracy|missions)' },
  { name: 'progression-balance', kind: 'report', about: 'roster autopilot runs, XP and Credits pacing (RUNS)' },
  { name: 'squads', kind: 'report', about: 'roster squads autopilot with a damage ledger (exit 1 if the ledger disagrees)' },
  { name: 'chapter2-sim', kind: 'report', about: 'Chapter 2 autopilot simulations (SCEN, RUNS)' },
  { name: 'chapter3b-sim', kind: 'report', about: 'Missions 13-14 autopilot simulations (SCEN, RUNS, LEVEL)' },
  { name: 'v09c', kind: 'rules', base: V09B2, out: true, about: 'v0.9C Mission 19 Prison Break: map, rescue in any order, the three specialist allies (weapons, follow, downs, no permadeath / XP / save), escalation and the alarm tower, the 30 s last stand (60 Riflemen, timing, safety, scaling, engagement), stars; everything else identical to v0.9B.2 but Mission 7\'s name and Mission 18\'s unlock' },
  { name: 'v09d', kind: 'rules', base: V09C, out: true, about: 'v0.9D Mission 20 The Warlord: campaign row + Chapter 4 epilogue, map and the three approaches, installations in any order, the Warlord (HP, phases, relocation, calls, arena), the telegraphed mortar (fixed circle, warning, cadence, fairness, none after death), the scripted Extraction Alpha ambush (no damage / failure / victory / support / stars), the retreat (Riflemen, groups, bypass), Bravo (12 s, push, immediate extraction), stars; everything else identical to v0.9C' },
  { name: 'v09d1', kind: 'rules', base: V09D, out: true, about: 'v0.9D.1 UI polish & squad intelligence: Campaign summaries + MISSION DETAILS, READY TO DEPLOY? (caps, empty slots, edit and back, double tap), collapsible objectives HUD, role-based formation (bands, hysteresis, reassignment, route walks vs v0.9D), the Warlord\'s phase 1 under-fire response, the compact mortar warning, phones' },
  { name: 'bootcamp', kind: 'rules', about: 'v0.9E Boot Camp: the offer (new saves only), Field Training steps, headquarters tour, no rewards / casualties / save changes, replay and exit from Settings, reload safety, phone layouts' },
  { name: 'v09d2', kind: 'rules', about: 'v0.9D.2 credit scaling: Victory credits 500 / 400 + 25 per mission after Mission 1, bonus lines, overlap rule, first-time bonus once, failures 0, XP and prices unchanged, a real Mission 20 end, fixtures' },
  { name: 'v09d-sim', kind: 'report', about: 'v0.9D Mission 20 (MODE=boss|full, SCEN=strong,weak,four,worn, DODGE=0 stationary, BYPASS=1, ROUTE=gate|flank|supply)' },
  { name: 'v09c-sim', kind: 'report', about: 'v0.9C Mission 19 last stand (MODE=stand SCEN=strong,weak,four,worn,nospec,fourone) or the whole mission with the autopilot (MODE=full)' },
  { name: 'v09b2-sim', kind: 'report', about: 'v0.9B.2 Mission 18 extraction effectiveness (SCEN=strong,weak,four RUNS): reached range, fired, alive, damage, extracted' },
  { name: 'v081-sim', kind: 'report', about: 'v0.8B.1 Missions 13-14 balance simulations (SCEN, RUNS)' },
  { name: 'v09a-sim', kind: 'report', about: 'Mission 16 autopilot simulations: duration, mine reveals / blasts, naive vs aware play (SCEN, RUNS, POLICY)' },
  { name: 'v08c-sim', kind: 'report', about: 'Mission 15 autopilot simulations (SCEN, RUNS, LEVEL)' },
  { name: 'perf', kind: 'report', out: false, needs: 'headless profile only, not a phone measurement; compare builds with URL= / LABEL= runs', about: 'headless performance profile (MODES, MISSIONS, HZ, THROTTLE)' },

  // ---- screenshots ----
  { name: 'shot', kind: 'screens', out: true, about: 'smoke: load, play a bit, screenshot, report page errors' },
  { name: 'visual', kind: 'screens', out: true, about: 'real-time play screenshots of key states' },
  { name: 'fight', kind: 'screens', out: true, about: 'live firefight, moving vs standing' },
  { name: 'classes', kind: 'screens', out: true, about: 'each class, abilities and the landscape HUD' },
  { name: 'lineup', kind: 'screens', out: true, about: 'class lineup close-ups' },
  { name: 'touch', kind: 'screens', out: true, about: 'joystick drag, ability tap, ground tap via CDP touch' },
  { name: 'play', kind: 'screens', out: true, about: 'accelerated autopilot playthrough log (SQUAD, SIZE, INVULN)' },

  // ---- legacy ----
  { name: 'chapter3b-e2e', kind: 'legacy', about: 'superseded by v081-e2e since v0.8B.1 (its autopilot loses the harder missions)' },
];

// Not suites: helpers loaded by other scripts.
const HELPERS = ['lib.cjs', 'perf-lib.cjs', 'test.cjs', 'test-suites.cjs', 'artifact.cjs'];

const RULES = SUITES.filter((s) => s.kind === 'rules').map((s) => s.name);

const GROUPS = {
  smoke: { about: 'fast routine check (default for a bare `npm test`)', suites: ['logic', 'maps', 'campaign-rules', 'barracks'] },
  combat: { about: 'weapons, damage, accuracy, Elite passives, Tactical Support, Demolitions', suites: ['logic', 'accuracy', 'elite', 'support', 'v082', 'v08c', 'arch', 'v09a', 'v09b'] },
  movement: { about: 'squad movement, collisions, joystick', suites: ['logic', 'v081-collision', 'mobile', 'v09d1'] },
  recruitment: { about: 'Recruitment Office, named recruits, roster', suites: ['recruitment', 'recruit-mobile', 'failure-recruit', 'failure-recruit-mobile', 'barracks', 'v08c'] },
  progression: { about: 'XP, training, Squad Training, Elite', suites: ['progression', 'training-rebalance', 'squad-training', 'accuracy', 'elite', 'elite-progression', 'v09d2'] },
  permadeath: { about: 'KIA, resurrection, Memorial, failed missions', suites: ['permadeath', 'permadeath-mobile', 'failure-recruit'] },
  missions: { about: 'maps, campaign rules, chapter suites, Missions 13-20', suites: ['maps', 'campaign-rules', 'chapter2', 'chapter3a', 'chapter3b', 'v081', 'v081-collision', 'v081-e2e', 'v082', 'v08c', 'story', 'arch', 'v09a', 'v09b', 'v09b1', 'v09b2', 'v09c', 'v09d', 'v09d1'] },
  persistence: { about: 'saves, fixtures, economy (SYSTEM_MAP "Saves / economy")', suites: ['bootcamp', 'barracks', 'progression', 'permadeath', 'recruitment', 'failure-recruit', 'elite', 'elite-progression', 'support', 'v081-e2e', 'v082', 'v08c', 'v09a', 'v09b', 'v09c', 'v09d', 'v09d2'] },
  ui: { about: 'phone layouts and touch (HUD / menus)', suites: ['bootcamp', 'mobile', 'chapter2-mobile', 'permadeath-mobile', 'failure-recruit-mobile', 'recruit-mobile', 'story', 'v09d1'] },
  fps: { about: '30 / 60 FPS parity and default frame cap', suites: ['fps-default', 'fps-parity'] },
  all: { about: 'full regression: every rule suite', suites: RULES },
  reports: { about: 'simulations and perf reports (slow, no PASS/FAIL)', suites: SUITES.filter((s) => s.kind === 'report').map((s) => s.name) },
  screens: { about: 'screenshot scripts (judged by eye)', suites: SUITES.filter((s) => s.kind === 'screens').map((s) => s.name) },
};

module.exports = { SUITES, GROUPS, HELPERS };
