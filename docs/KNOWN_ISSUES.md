# Known issues

Honest, current list of known limitations and open bugs. Each entry says what
a user actually experiences, the workaround, and the tracking state. Items
move off this list by being fixed (and noted in release notes) or by being
accepted as documented behaviour in the appropriate doc.

## Current

1. **Some exercises lack a curated same-kit substitution edge.** The
   substitution graph spans equipment families by design, and the soft
   content lint still reports rows without a declared fallback reachable
   using only the source exercise's kit. **Experience:** the runtime swap
   engine still widens to kit-compatible alternatives; exact movement-pattern
   matches are now ranked above near-pattern and unrelated fallbacks using the
   full exercise taxonomy. The remaining warning is therefore a curation
   quality issue, not a dead-end in the swap sheet. **Tracked:**
   `validateContentWarnings()` remains the work queue for adding explicit
   graph edges over time.

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

7. **Stale merged branches linger on the remote.** Every pre-0.1.0 feature
   branch (gym-mode, indexdb-storage, segmented-comparisons,
   adaptive-mesocycle-review, weekly-review-card, custom-workout-templates,
   exercise-library-tags, field-study-benchmark, and the rest of the
   numbered PR series #17–#35) is MERGED into main — none carries unmerged
   work, and none should be treated as an open proposal. They are listed
   here as the documentation of record until a remote-side prune deletes
   them; after that prune this entry moves to "accepted as documented
   behaviour". **Experience:** none in the app. **Tracked:** repo hygiene
   only, safe to close/prune at any time.

8. **PRs #13–#16 were closed (not merged) on 2026-09-17.** #13 was
   stale-completed (its content already on main); #14 (N-of-1 lab) and #16
   (history-visualisation rework) were stale/out-of-scope against the current
   roadmap; #15 (hosted Google-account sync) was REJECTED by the product
   charter — Arise stays on-device with explicit exports and no account layer
   (`docs/PRODUCT.md`). These closures are documented decisions, not
   oversights; do not re-open the branches as "open proposals".
   **Experience:** none in the app. **Tracked:** repo documentation of
   record.

## Accepted as documented behaviour

- Kg is the storage and engine unit; workout UI may display and accept lb, converting only at the UI boundary (`src/lib/units.ts`).
- The evaluation ledger never feeds recommendations (ADR 0008) — evidence
  views are retrospective, never causal.
- Demo mode starts from a wiped slate and exits to a wiped slate; it never
  mixes with real data.
