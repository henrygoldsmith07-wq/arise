# FAQ

## The basics

**Do I need an account?** No. Arise has no account, no server and no login.
Your data lives in your browser's storage on your device.

**Does it work offline?** Yes — fully. Install it as an app (see
`docs/INSTALL.md`) and every screen, including logging workouts, works with
the network off.

**Is my training data private?** It never leaves the device unless you
export it, enable the optional WebDAV sync to *your own* storage, or turn on
a consent-gated integration. Telemetry is off by default. Details:
`docs/PRIVACY.md`.

**Does it cost anything?** The code is MIT-licensed. The exercise
illustrations are CC BY-SA 4.0 (attribution required).

## Training

**Why did my next load go *down*?** The engine is conservative on purpose: a
failed or shaky session, a readiness dip that is part of a sustained trend,
or a deload window will lower the target rather than push through. Every
number shows its reason — tap the explanation line in the runner.

**Why is the app telling me to deload?** Sustained fatigue signals — repeated
hard sessions, declining readiness trend, plateau with high RPE — not a
single bad day. Deloads are one conservative step and the weekly review tells
you whether they worked.

**What is a "fake PR"?** A +0.5 kg "record" that is really measurement jitter,
or a PR that came from changing technique/ROM. `scanPRs()` flags these so
your PR list means something. See `docs/CANNOT_PROVE.md`.

**Can I swap an exercise?** Yes — substitutions are ranked by movement
pattern, muscle overlap, equipment fit, fatigue cost and skill demand, each
with a reason. Painful movements are never substituted into similar stress.

**I took two weeks off. Will the app crush me on return?** No — there is an
explicit return-from-break path that restarts conservatively while keeping
your training age.

**Where are the diet features?** Nowhere, deliberately. Arise is a training
companion; nutrition is out of scope.

## The study

**What is the "real-world study"?** With your consent, Arise records what it
recommended before each workout and what you actually did, and compares that
against simple textbook baselines on the same sessions. Aggregate results
tell the developers (and you) whether the engine's advice actually helps.
Nothing is automatic: your data leaves the device only when YOU export it.

**How do I take part?** More → Progression evidence → *Join the study*.
You need measurement consent on and at least 3 logged workouts. You get a
pseudonymous participant id — never a name or email.

**How do I contribute data?** From the study card (More → Progression
evidence), tap **Export study data** and send the downloaded
`arise-study-<date>.json` to whoever runs the study. Weekly is ideal.
Repeated exports are expected — they fold back into one participant, never
two. Your regular backup is a different file for moving your own data
between devices — it is not the study contribution. Duplicate, conflicting
or damaged files are reported as warnings, never
silently merged.

**What if I want to leave?** Withdraw from the study card in More. New
workouts immediately run on the normal engine with no study assignments.
Everything you already logged stays on your device — withdrawing never
deletes observations. Deleting data is a separate action (More → Privacy &
data) that you perform explicitly and confirm.

**Does joining change my workouts?** Each assigned exercise follows one of
two honest progression policies for the duration of the study. Both are real
training prescriptions; neither is a placebo and neither is deliberately bad.
You can leave at any time, for any reason, without losing your history.

## Data

**Where exactly is my data?** In IndexedDB in your browser, on this device,
under this browser profile. See `docs/STORAGE_SCHEMA.md` for every store and
field.

**What happens if I clear browser data?** Your training history goes with it
(that is what "local-first" means). That is why automatic local snapshots,
the export habit and `docs/BACKUP_RECOVERY.md` exist. Export before clearing.

**How do I move to a new phone or laptop?** Export a backup on the old
device, import (Merge) on the new one. For continuous two-way sync, configure
your own WebDAV storage: `docs/SYNC_GUIDE.md`. There is no hosted account
sync — including Google-account sync — by charter: see `docs/PRODUCT.md`.

**Can I use it on two devices at once?** Yes, with sync enabled; edits merge
per-session by newest save, and deletions win over stale edits. Without sync,
devices simply have independent histories until you merge.

**I imported a backup and something looks wrong.** Import always shows a
preview before applying; use Replace only when you mean total replacement.
Corrupt or partial files are quarantined, not half-applied — see
`docs/IMPORT_EXPORT.md`.

## Platform

**iOS won't let me install.** iOS installs via Safari's Share → Add to Home
Screen only (Chrome on iOS can't install PWAs). Steps and edge cases:
`docs/INSTALL.md`.

**Why no vibration on iPhone?** iOS Safari does not expose the Vibration
API. Haptics work on Android and desktop browsers that support it; the
setting reports honestly when the platform can't.

**Why does the rest timer stop announcing in the background?** Browsers
throttle background tabs. Keep the screen on (Gym mode wake lock) or the tab
in the foreground during rest; a native wrapper is documented but optional.

**Something broke and my data looks odd.** Start here:
`docs/TROUBLESHOOTING.md` — boot failure, quarantine, snapshot restore.

## Project

**Is there a changelog?** Release notes are generated from conventional
commits per tag (`scripts/changelog.cjs`); `CHANGELOG.md` indexes releases.

**How is this tested?** 600+ unit tests, engine benchmarks with regression
gates, Playwright e2e for user journeys, resilience, PWA/offline, plus the
study/field-study harnesses. See
`docs/TESTING.md` and `docs/device-test-matrix.md` for what still needs
physical devices.

**How do I report a bug?** GitHub Issues — but never attach training history,
health data or backup files. See `CONTRIBUTING.md`.
