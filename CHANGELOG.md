# Changelog

All notable changes are recorded per release in the tag's release notes
(generated from conventional commits by `scripts/changelog.cjs`).

At the first tagged release, bootstrap this file from the tag history:

    node scripts/changelog.cjs --init

Each release section is derived from the commit log since the previous tag —
the history is the changelog; this file is its human-readable index.

## Unreleased

### First-session load guidance
- Guided Mode now tells you how to pick a first weight ("start light, a weight you could lift 4–5 reps easier") when a loaded set has no load yet, instead of showing only "log load".
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
