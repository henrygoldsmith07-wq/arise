# Known issues

Honest, current list of known limitations and open bugs. Each entry says what
a user actually experiences, the workaround, and the tracking state. Items
move off this list by being fixed (and noted in release notes) or by being
accepted as documented behaviour in the appropriate doc.

## Current

1. **Band-kit exercises can lack a same-equipment substitution.** The
   substitution graph spans equipment families by design, but a few
   bands-only lifts (e.g. band row) have no reachable fallback when bands are
   the user's only kit. **Experience:** the swap sheet can offer nothing for
   those exercises. **Workaround:** pick a different exercise for the day or
   note the swap manually. **Tracked:** the content lint reports all such
   gaps via `validateContentWarnings()` (currently ~34 entries).

2. **Offline fallback page is static.** `public/offline.html` is a friendly
   dead end by design — the real app keeps working from its cached shell, so
   this page appears only when even the shell is missing. **Experience:**
   first-ever visit with no network shows a simple "you're offline" page.
   **Workaround:** none needed; reconnect and reload.

3. **Voice input needs Chrome/Edge or a compatible engine.** Web Speech API
   dictation (More → Gym mode → *Voice logging*) degrades to a disabled
   control on engines without `SpeechRecognition`. **Experience:** button
   greyed with a hint; all logging stays manual. **Workaround:** the load
   keypad and steppers are fully keyboard/screen-reader accessible.

4. **Migration rollback is snapshot-based.** `migrateWithLogging()` records
   every migration and boot captures a snapshot *before* migrating, but there
   is no per-migration undo that re-writes an older schema version forward
   again. **Experience:** rollback = restore the pre-migration snapshot
   (Storage & diagnostics → Roll back). **Workaround:** exports remain the
   durable copy.

5. **e2e tabs can be click-intercepted under heavy CI load.** Rare, CI-only
   (2-core runners): a sticky-nav tap retries through a transient
   interception. **Experience:** none in the app. **Tracked:** the specs use
   a retry helper; upstream Chromium hit-testing under load.

6. **iOS Safari PWA edge cases remain unverified on real devices.** The
   device-test matrix (`docs/device-test-matrix.md`) lists exactly which
   flows (wake lock re-acquire after backgrounding, rest-timer audio during
   screen lock) still need physical-device confirmation. **Experience:**
   potentially unreliable rest-timer audio on locked-screen iOS.
   **Workaround:** keep the screen on (Gym mode's wake lock) where possible.

## Accepted as documented behaviour

- Kg is the storage and engine unit; lb is display-only (`src/lib/units.js`).
- The evaluation ledger never feeds recommendations (ADR 0008) — evidence
  views are retrospective, never causal.
- Demo mode starts from a wiped slate and exits to a wiped slate; it never
  mixes with real data.
