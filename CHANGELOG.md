# Changelog

All notable changes are recorded per release in the tag's release notes
(generated from conventional commits by `scripts/changelog.cjs`).

At the first tagged release, bootstrap this file from the tag history:

    node scripts/changelog.cjs --init

Each release section is derived from the commit log since the previous tag —
the history is the changelog; this file is its human-readable index.

## Unreleased

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
