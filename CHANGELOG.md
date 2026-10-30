# Changelog

All notable changes are recorded per release in the tag's release notes
(generated from conventional commits by `scripts/changelog.cjs`).

At the first tagged release, bootstrap this file from the tag history:

    node scripts/changelog.cjs --init

Each release section is derived from the commit log since the previous tag —
the history is the changelog; this file is its human-readable index.

## Unreleased

### Training notes journal (MAJOR 45)
- More → Training notes: one search over every session note, tag chip and machine setup note, with kind and tag filters. Built on this device, nothing uploaded.
- Cut oversized exercise swap lists to eight entries each to pay for it within the 405 kB budget.


### Records wall: your best load at 1, 3, 5, 8 and 12+ reps (MAJOR 44)
- Progress → **Records** replaces the old best-estimated-max list. It shows your three most recent lifts and opens a full wall: for every lift you have logged with a load, the heaviest weight for 1, 3, 5, 8 and 12+ reps with the date, the best estimated max, how many PRs you have set and when the last one was. Search by name or filter by muscle.
- A PR needs an earlier like-for-like set to beat (the first time you log a lift is a baseline), and has to be about 1 kg heavier than the old best for that rep band, so ties and 0.5 kg jitter are never PRs. Assisted sets, skipped or failed sets, deleted sessions and sessions whose note says ROM, paused, tempo, partial, band or technique change are not counted.
- Today shows a **New PR** card for three days after the session that set it (heaviest rep band per lift, with the old best), dismissible.
- Nothing is stored: the wall is read from your history each time, so fixing a typo or deleting a session in Edit workouts changes the wall straight away.
- Bundle: each substitution edge in the exercise catalogue is stored once and made reciprocal when the app loads (-1 kB gz); the old PR list code is gone.

### Weekly volume: hard sets per muscle, week by week (MAJOR 43)
- Progress gets a **Weekly volume** card: the last eight weeks as tappable stacked bars (hard sets per muscle), with a muscle-by-muscle list and the sessions behind whichever week you tap. Muscles are compared with the same rough 6–20 sets guide the Block plan uses, with "Below guide / In range / Above guide" on finished weeks only.
- Counts what you actually logged: finished, non-skipped sets with reps or a load, and nothing logged under RPE 5. Each lift counts toward its main muscle; cardio, core and deleted sessions are left out.
- Today shows a quiet "Light week for chest (3)" note when an upper-body muscle you have been training got less than the guide last week, only after a real training week (two or more sessions, not a deload). It never nags about legs (they are capped around cycling on purpose) or muscles you have not been training, and "Got it" hides it for the week on this device.
- New `src/lib/muscleVolumeHistory.js`, `WeeklyVolumeCard.jsx` and `VolumeNudge.jsx` (all lazy), `tests/muscle-volume-history.test.js`, `e2e/weekly-volume.spec.js`. Chunking: the Block plan and volume view share one chunk, and four tiny lazy modules share another, so the 405 kB budget holds.


### Quick workout
- Today has a **Quick workout** button for sessions the programme did not plan. Pick up to 10 lifts by search and muscle, or tap a shortcut: Same as last time, Rested muscles (the muscles with the longest gap since a logged set, favouring lifts you log and like) or Upper body only (no leg work, for a rider keeping legs fresh).
- It runs in the normal workout screen. Sets and rep range follow what you last logged for each lift (3 × 8–12 for a new one) and the runner supplies the load target from your history. The saved session counts toward progression and Progress but marks, skips and moves nothing in the programme.
- Bundle: the weighted/assisted flags on 238 coverage-fill exercises are derived from the id instead of being written out (-2.5 kB gz).

### Send your workouts back to Hevy
- More → Data → **Export for Hevy** writes your Arise workouts as a CSV in Hevy's own export layout (one row per set, Hevy exercise names, RPE, failure sets, your weight unit), so a lifter who logs in both apps can keep the two logs in step. Built on your phone, never uploaded; shared through the share sheet or downloaded.
- Pick Since my last export, Last 30 / 90 days or Everything. Workouts that were imported from Hevy are held back by default so Hevy is not sent its own sessions as duplicates; deleted and fully skipped sessions never go out.
- Lifts Hevy has no mapped name for keep their Arise name and are listed before you export, because Hevy will treat them as custom exercises. Hevy's own importer may not accept its export; the file also opens in any spreadsheet and re-imports into Arise (the round trip is unit-tested).
- Bundle: exercise-illustration registry stores the upstream slug only when it differs from the Arise id, one shared file-download helper replaces six copies, and small rarely-opened chunks are grouped.

### Lift goals with a projected date
- Progress has a Lift goals card: pick a lift you have logged, set a target (for example 100 kg × 8) and an optional date, and Arise shows whether your last 12 weeks of e1RM gets you there. Status is ahead, on track, behind, flat or not enough data, with a milestone bar at 25/50/75%.
- A goal is only "hit" by a real logged set at the target load and reps, never by an estimate; Today shows a one-time "Goal hit" card.
- Goals are stored on this device, travel with backup/export and sync (newest edit wins per lift, removals stick).

### Add training to your calendar
- Train → **Add to calendar** exports your next planned sessions as an `.ics` file (shared through your phone's share sheet where available, otherwise downloaded). Choose a start time and a reminder; each event carries the exercises with sets and reps and an estimated length.
- Every event keeps a stable ID, so after you move a session (or change training weekdays) exporting again updates the same events in your calendar instead of duplicating them. The file is built on your device; nothing is uploaded.

### Body weight and strength for your size
- Progress → **Body weight**: log a weigh-in (kg or lb), see the latest value, a sparkline and a week-average trend that refuses to call a direction until entries are a week apart. Remove any day; removal syncs and survives restore. The Today check-in also takes an optional weight, so it is one tap with the rest of your morning.
- **Strength for your size** per lift: best estimated max ÷ body weight over the last 8 weeks against the 8 before, with the absolute change next to it ("max +4 kg, body +6 kg → about the same"). Pull-ups, chin-ups and dips count body weight + added − assistance, so an assisted and a weighted pull-up sit on one scale. Machine stacks differ between gyms, so it only compares you with you.
- `bodyweightLog` rides export, backup, sync and the three-way store reconcile (newest edit per day wins, deletions stick). Nothing leaves the device.
- Bundle: the expert-only **Historical recommendation check** on Progress now rebuilds each recommendation with the same leak-safe point-in-time replay but no longer ships the multi-metric replay engine (Brier scores, plateau accuracy). It shows samples, load/rep error and hit rate. That frees ~6.5 kB gz for this feature; `backtesting.js` stays in the repo for scripts and tests.

### Per-lift setup notes
- **Add setup** on any lift (Gym Mode, session runner, Guided mode): seat, pin/stack, grip, bench or back angle and one free note, saved per exercise and shown under the target next session so you stop re-finding the machine settings.
- Each logged block remembers the setup used; the lift's history sheet shows it per session, and the runner says "Changed since last time (was …)" when today's note differs from the last logged one.
- Notes live in `gymPrefs.setupNotes`, ride export/import and sync (newest edit per lift wins, clears keep a small tombstone), and are cleaned on load. Nothing leaves the device.

### Block plan
- Train → **Block plan** shows your whole block week by week: each session with its sets and estimated time, and weekly hard sets per muscle against a rough 6–20 guide (low volume is never nagged: fewer is fine on purpose, e.g. legs around cycling).
- **Make deload week / Make normal week** on any week that still has sessions to do. Deload cuts planned sets by the engine's deload factor and leaves loads alone; turning it off restores the exact original sets. The weekly review no longer re-decides a week you set.
- **Add a week** copies your latest normal week (same weekdays) when the block runs out, up to 12 weeks; a programme's own deload week arrives already cut. **Remove the week I added** undoes it while nothing in it is finished.
- Build weeks above ~20 sets for a muscle get a plain warning. Everything stays on the device and rides export, backup and sync inside the schedule.
- Once weeks are added, a programme's deload is that one week rather than every week after it.

### Supersets and per-exercise rest
- Programme editor: **Pair with next** / **Unpair** to superset two exercises, and a **rest stepper** on every exercise.
- Gym Mode, the session runner and Guided mode alternate a pair (A1 → B1 → rest → A2 …) with one rest per round, and the rest timer uses the rest you set. Session-length estimates account for supersets.

### Save My Programme edits as a template
- Programme editor: **Save as my template** keeps your swaps, sets, reps, rest and renamed days (every week of the block) as a template in My templates, with an optional share code.
- When a block ends with customised days, Today offers **Start next block from my edits**. Switching programme now offers to save your edits as a template before they are cleared.

### Onboarding finishes before it closes
- Save & continue now closes onboarding only once your first plan is in place, and the plan merges into whatever changed meanwhile instead of overwriting it (a programme started or restored in that moment is kept).

### Smaller app download
- Exercise how-to text (setup steps, common mistakes, full cue lists) now loads the first time you open a how-to guide instead of with every screen: about 7 kB less JavaScript. It is cached for offline use like the rest of the app; the first cue still shows inline during a session.

### Training days
- Pick the weekdays you train; upcoming sessions re-date onto them (ride days avoided). Move any single session to another day from Train; sessions swap if the day is taken.

### Edit or delete a logged workout
- **Progress → Edit logged workouts** lists your last 30 sessions. Correct a set's load, reps or RPE, delete one set, or delete a whole session (with confirmation).
- Corrections feed the next suggestion immediately; edited sets are marked. Deleting a session leaves a tombstone so a restore or sync cannot resurrect it, and re-opens its slot in your programme.

### My Programme: edit the programme you are running
- **Train → Edit programme** opens an editor for the active programme: swap an exercise (ranked alternatives that fit your kit, never an avoided one, liked ones first), add or remove exercises, move them up/down, change sets (1–8) and the rep range, rename a day.
- Edits apply to every upcoming session of that day, so Today, Gym Mode and the load engine run them immediately; completed sessions are never rewritten and history stays with each exercise, so swapping back resumes it.
- Edited days/exercises are badged, Undo reverses the last change, and Reset day / Reset all restore the programme exactly (with confirmation).
- Edits live on the programme in local storage and ride backup, export/import, sync and cross-tab refresh; a damaged edit layer is dropped by integrity repair without touching the sessions. Starting another programme or clearing the schedule warns that edits will be cleared.
- Bundle: the editor is its own lazy chunk. To stay inside the unchanged 405 kB total budget, ten dependency-free lazy helpers now share one chunk, and dynamic imports no longer embed per-chunk preload lists (boot keeps its HTML modulepreload tags; every lazy chunk is precached by the service worker).

### Gym Mode: step up after an easy opening set
- A first set with 4+ reps in reserve, even mid-range, now offers the next load step for the remaining sets instead of waiting for the top of the range.


- Gym Mode: when set 1 lands 3+ reps over the top of the range and no effort was logged, the next-set chip now offers the step up (previously it needed an RIR entry).


### Today: low-readiness trim
- When today's check-in scores 40/100 or lower, Today offers "Trim one set per lift" (one set off every lift with 3+ sets, never below 2; timed blocks untouched). You choose; undo is one tap.
### Gym Mode: apply next-set load advice to all remaining sets
- When the next-set chip suggests a heavier or lighter load, a second button, "Use for all N remaining", moves every untouched pending set at once instead of one tap per set.

### Next-time preview in the session runner
- Once every set of a lift is done, a chip shows what Arise will prescribe next session (load × reps and why), computed from your history plus the sets you just logged. Advice only.


- Gym Mode: after a failed or under-floor final set, offer one back-off set about 10% lighter (snapped to your kit).

### Added
- Progression: a top-of-range set logged at RPE 10 (a grind) now repeats the load instead of adding weight.
- Progress shows "Rest you actually took": median rest between sets per lift vs prescribed, flagged when under 60% over 4+ gaps (set completion times are now stored on the device as `doneAtMs`; `restTakenByExercise`).
- Gym Mode offers a shorter remembered rest (never under 90 s) when two sets held their reps with 3+ in reserve on a long rest you did not choose (`shorterRestAdvice`).
- Today shows a heads-up when the next session has leg work on a key ride day or the day before (`legRideWarning`, `withoutLegBlocks` in `rideAwareSchedule.js`).
### Gym Mode: longer-rest suggestion
- When reps fall by 3+ between two sets on a short rest you never chose, Gym Mode offers to remember a rest one step longer (up to 3 min) for that lift.

- Gym Mode: next-set advice now uses your own machine increment and, when the next step would be a jump over 15% of the load, says to keep the weight and add reps.

- Gym Mode: after every planned set hits the top of the range with 3+ reps left, an "Add 1 set" suggestion appears (max 4 sets).
### Gym Mode: step down after a grinder opening set
- When set 1 lands on the rep floor with nothing left (RIR 0) and two or more sets remain, the next-set advice offers one load step down so later sets stay in range instead of triggering stop-early.

### Progress: rides vs lifting overlay
- New "Rides vs lifting" card on Progress (needs key ride days set): per week, lift days vs ride days and how many leg sets landed on a ride day or the day before. `rideLiftOverlay` in rideAwareSchedule.js; tests/ride-lift-overlay.test.js.
### Engine: fatigue fade holds the load
- If the last two sets of a lift's previous session fell under the rep floor (or failed), the next-session prescription holds the load instead of progressing off the single best set. Matches the Gym Mode stop-early advice. `fatigueFadeInLastSession` in `src/lib/progression.js`; tests in `tests/progression-fatigue-fade.test.js`.

### Gym Mode: stop-early advice
- After two finished sets in a row under the rep floor (or failed) with sets still pending, a chip says it's fine to stop the lift and offers one tap to drop the remaining sets.

### Gym Mode: remember "skip warm-ups" per lift
- A lift's details now have "Always skip warm-ups for this lift"; the choice is stored in `gymPrefs.skipWarmups`, drops that lift's ramp sets and shortens the predicted session time.

### Gym Mode: rest after a rep shortfall
- When you log fewer reps than the bottom of the target and skip RIR/RPE, the auto rest adds 30 s (capped at 5 min). Your own saved rest preset still wins.
### Gym Mode: next-set advice
- After a set finishes under the rep range (or fails), the next set of a loaded lift offers a one-tap lighter load; at the top of the range with 2+ reps in reserve it offers a heavier one. Never auto-applied, hidden once you change the load yourself.

### Hevy import: fewer skipped exercises
- Hevy names that aren't in the curated map now match a library exercise when the words are the same in any order ("Bench Press (Dumbbell)" = "Dumbbell Bench Press") and the match is unique; ambiguous or different-equipment lifts stay in the "skipped" list, never guessed.

- Onboarding asks how many days a week you ride or train; 4+ pins the 2-day Rider Upper plan on the shelf (stored as rideDaysPerWeek on the device).

### Guided Mode: first-lift weight finder
- A guided step for a loaded lift you have never logged now offers "Not sure what weight? Find it": one easy trial set fills the load for every remaining set of that exercise and builds the warm-up ramp.

### Gym Mode: coarse-jump chip
- When the stack's next step is a >20% jump, the target row shows "Stay at 20 kg — add reps up to 15" as a 44px chip instead of leaving the held load unexplained.

- Onboarding warns when a machine/cable pin step is over 10% of a typical upper-body load (e.g. a 5 kg pin), suggesting micro-plates.

### Coarse weight stacks add reps before a big jump
When the next achievable machine/cable load would jump more than 20% (e.g. a 5 kg pin on 20 kg), the target stays at the current load and adds reps up to 3 past the range ceiling, then steps up.

### Best lifting days around key rides
Ride-days card now suggests the best three weekdays to lift (off ride days, away from the day before, not back-to-back).


### Jargon help where RIR/RPE appear
- Tap-to-explain "?" now sits on the set-list RIR header (and a one-line RIR note on phones), the Progress volume hint (RPE/RIR) and the per-lift history sheet.
### Tap-to-explain jargon in Progress and lift history
- Progress (best e1RM, trend table, PR cards) and the Gym Mode history sheet now have 44px “?” helpers explaining e1RM and PR; glossary gains Deload and PR plus a whole-word `jargonIn` helper.

### Per-lift history sheet + 13 kB smaller bundle
- Gym Mode shows a 44px “History” button under each lift that has logged sets: last five sessions (loads, reps, RIR, best e1RM) and an e1RM sparkline. Lazy-loaded, Esc/tap outside closes.
- Removed the dedicated analytics Web Worker, which shipped a second ~13 kB gz copy of the evaluation code; the Progress evaluation now runs inline after a yield so the screen paints first.

### Tap-to-explain RIR
- A 44px “?” beside the suggested-RIR row in Gym Mode explains RIR in plain words (Esc or tap outside closes). Glossary in `src/lib/glossary.js` also covers RPE, e1RM and double progression for wider rollout.

### Warm-up ramp from the working-weight finder
- Accepting the finder's load now also builds that lift's warm-up ramp (50/70/85%) from it, so a first-ever session no longer shows an empty warm-up list.

### Rider Upper 2×Week + why legs are capped
- New 2-day rider plan for heavy ride weeks (2 gym days or 4+ ride days); the programme shelf picks it automatically and explains why leg work is capped. Leg sets stay ≤2 per session.

### Stalled lift: accept the deload as your next target
- The Progress stalled-lift card now has **Use this as my next target** (with undo). The next session shows that lift at the deload load and reps instead of the engine's usual number; once you log the lift, normal progression resumes. Local only (gymPrefs.deloadTargets).


### Stalled-lift deload suggestion
- Progress now says "Stalled 3 sessions" when a lift's last three sessions haven't beaten its earlier best e1RM, and proposes the same reps at about 10% less load (snapped to a load your kit can make). New `src/lib/stallDeload.js` + tests; terser now runs two passes to keep the bundle inside budget.


### Onboarding exercise picker
- The "Fine-tune preferences" step no longer shows one flat ~60-row list. Exercises are grouped by muscle in collapsible sections (each header shows "N liked · M avoided"), with a labelled search box (case/accent-insensitive, gym shorthand such as `db`, `rdl`, `lat`, `pec`), muscle filter chips, a "Show my picks" toggle, a live "Showing N of M" count and a "No exercises match…" empty state with a clear-search action.
- Like/Avoid buttons are now 44px touch targets (were ~24px) with accessible names that include the exercise ("Like Lat Pulldown") and `aria-pressed` state. Like and Avoid stay mutually exclusive, and choices still persist in the onboarding draft.
- Build: four tiny dependency-free helper chunks (units, experienceMode, voiceCoach, trainSurface) now ship inside the shared `catalogue` chunk, which every importer already loads — about 0.9 kB gz less total JS, so the picker fits the unchanged 405 kB budget.

### Fixed
- Progression: a "go up" decision on a light load (e.g. 30 kg cable work, where 2.5% rounds to 0.75 kg) used to print "increase 30 → 30 kg" and keep the lifter on the same weight indefinitely. It now always takes at least one real step (1 kg under 20 kg, 2.5 kg to 60 kg, 5 kg above), and stays an increase after rounding onto the lifter's own plate/dumbbell/machine increments.

### Ride-aware leg scheduling
- Mark key ride days on the Train tab; leg sessions on a ride day or the day before are flagged and can be moved to the nearest clear day in one tap (never into the past, never onto another session).


### Fixed
- A built-in programme resampled to the days you chose now carries the real day count ("Full Gym 3×Week", not "4×Week") in the Train hero and the saved schedule.


### Onboarding asks if you ride, run or race
- New optional sport question on the goal step (No / Cycling / Running / Triathlon). Answering one pins Rider Upper 3×Week first on Train's programme shelf when your kit has machines or cables, with the reason shown. Stored on-device only.


### Hevy import that actually imports
- More → Import from another app now understands Hevy's own "Export workout data" CSV: sets are grouped into the real workouts (titled as in Hevy), warm-up sets are left out so they cannot fake a low working load, lbs exports convert to kg, and exercise names map through an explicit table. Lifts not in the table are listed, never guessed.
- Bug fix: every CSV import (generic or Hevy) silently produced zero sessions, because imported sessions had no `id` and the merge keys history by id. Imports now get a content-derived id, so re-importing the same file adds nothing twice.

### Onboarding keeps your answers
- Closing onboarding by accident (Esc, tapping outside, ✕) no longer wipes your answers: they are autosaved to this browser session only (sessionStorage, 24 h max, cleared on save) and restored on reopen with a "Start over" option.

### Session score no longer punishes skipped RPE
- A fully completed session that hit its rep targets scored 58 "Mixed" when RPE was skipped. RPE is now optional: completion earns the same credit, the debrief marks confidence as lower, and Progress has a "Why this score?" breakdown.

### Find your starting weight (first session on a loaded lift)
- A loaded exercise with no history and no prescribed load now offers "Not sure what weight? Find it" in the session runner (Standard and Gym Mode). Do one easy set, enter weight, reps and reps-in-reserve, and it suggests a starting load for the programme's rep range; "Use for all sets" fills the empty sets.
- The estimate is Epley-based, aimed at the bottom of the rep range with ~2 reps in reserve, and always rounded DOWN to a load your kit can make (machine stack step, dumbbell set, plates). Unknown reps-in-reserve is treated as 2 and flagged low-confidence; trials above 15 reps are flagged as a cautious start. It is an estimate, not a tested 1RM.
- Build now minifies with terser (2 passes): total JS 404.8 → ~399.5 kB gz with the feature included, so the budget (405 kB, unchanged) has real headroom again.
- New `tests/working-weight.test.js`.

### Faster first paint: boot bundle 114 kB → 60 kB gz
- The boot-time integrity gate imported the whole export/sync/evidence graph just to reuse one validator. The validator now lives in `src/lib/storeValidation.js` (re-exported from `export.js`, behaviour unchanged), so export, longitudinal evaluation, study, priors and progression load only with the screens that use them.
- Rollup groups that code into three shared lazy chunks (`evidence`, `engine`, `evidence-core`), each under the largest-lazy budget. Total stays at 404.8 / 405 kB (budget unchanged); boot drops 114.4 → 60.2 kB gz.
- New `tests/bootGraph.test.js` fails if the first-paint import graph regains any of those modules.


### First-session load guidance
- Guided Mode now tells you a first-weight hint ("No load yet: start light and build.") when a loaded set has no load yet, instead of showing only "log load".
### Docs
- CONTRIBUTING no longer claims there are no open PRs; it points to the live GitHub list.

### Fixed
- Today's "Built for you" line now says "up to 60 min a session" (your time ceiling) instead of "60-minute sessions", which contradicted the ~35 min plan beside it.

### Added

- **Rider Upper 3×Week programme** for cyclists, runners and triathletes who
  lift mainly for the upper body. Three machine/cable sessions a week; each
  session keeps leg/hip work to one short block (≤2 sets, stopped well short
  of failure) and there are no barbell squats or deadlifts. It is picked from
  the Train list and does not change profile recommendations.
  `tests/rider-programme.test.js` pins the leg cap, kit and upper-body share.

### Fixed

- **Loaded lifts were treated as bodyweight in the runner.** The load field
  showed `bw` and hid the plate/stack keypad on almost every barbell,
  dumbbell, machine and cable lift (the catalogue's `supportsWeighted` flag
  only marks weightable *bodyweight* moves). The guided runner said
  "bodyweight × 5" for a back squat. New `takesExternalLoad()` /
  `isLoadedKitLift()` in `src/lib/data.js` decide this from the kit.
- **Swapping a loaded lift lost its load.** The swap e1RM carry was gated on
  the same flag, so squat → leg press / goblet squat started blank, while
  squat → bodyweight squat could inherit the barbell load. The carry now
  lands only on kit-loaded replacements; swapped blocks no longer say
  "bodyweight" for a machine.
- **First plan ignored days/week, session length and avoided movements.**
  Onboarding started the raw template (a 3-day user got a 4-day schedule and
  was "missing" sessions in week one). It now builds with the same generator
  the Train card previews.
- **Fewer days than the template dropped the same session every week.** A
  3-day user on the 4-day upper/lower got Lower A, Lower B, Upper B forever —
  Upper A never appeared and legs were trained twice as often as upper.
  Sessions now rotate across weeks, keeping upper/lower alternation.

### Changed

- Onboarding's kit step warns a gym-goer who has only Bodyweight ticked and
  offers a one-tap "Tick everything".
