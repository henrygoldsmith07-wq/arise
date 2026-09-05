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

## Data

**Where exactly is my data?** In IndexedDB in your browser, on this device,
under this browser profile. See `docs/STORAGE_SCHEMA.md` for every store and
field.

**What happens if I clear browser data?** Your training history goes with it
(that is what "local-first" means). That is why automatic local snapshots,
the export habit and `docs/BACKUP_RECOVERY.md` exist. Export before clearing.

**How do I move to a new phone or laptop?** Export a backup on the old
device, import (Merge) on the new one. For continuous two-way sync, configure
your own WebDAV storage: `docs/SYNC_GUIDE.md`.

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
gates, Playwright e2e for user journeys, resilience, PWA/offline. See
`docs/TESTING.md` and `docs/device-test-matrix.md` for what still needs
physical devices.

**How do I report a bug?** GitHub Issues — but never attach training history,
health data or backup files. See `CONTRIBUTING.md`.
