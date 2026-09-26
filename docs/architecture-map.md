# Architecture map — module boundaries

Date: 2026-09-26 · Companion to the ADRs in this directory.

## Layers (import direction points downward)

```
src/components/*.jsx      UI — React/presentation state; invokes application operations
src/hooks/*.js            Shared UI/runtime controllers (drafts, timers, wake lock, a11y)
        │
src/services/*.js         Application/domain orchestration; workflow boundaries
        │
src/repositories/*        Repositories — the ONLY data-access API; store invariants live here
        │
src/lib/storage.js        Canonical persistence: IDB decomposition/recomposition, hydration/reconciliation
src/lib/idb.js/idb-tx.js  IndexedDB wrapper + atomic multi-store transactions
src/lib/crossTabStore.js  Small invalidations + protected/deferred cross-tab refresh
        ▲
src/lib/*.js              Engine/utilities: mostly pure; explicit browser adapters are named I/O edges
        ▲
src/core/*                Cross-cutting: config, flags, errors, DI container
```

## Boundary rules

1. **Feature UI does not import** `storage.js`, `idb.js`, `queries.js`, or
   repositories. `App.jsx` is the deliberate shell exception: it owns hydration,
   persistence failure state and cross-tab rehydration. Feature components may
   still consume pure engine selectors/formatters directly; multi-step
   write/adaptation workflows belong in services.
2. **Pure engine modules never import** React, repositories or the DI container;
   browser-I/O modules (`telemetry`, sync/AI adapters, storage) are explicit
   exceptions rather than being described as pure engine code.
3. **Repository-backed services do not import each other**; they receive collaborators
   (ADR 0004). One assembly point: `createServices()` / `createRepositories()`.
4. **Adapters** (sync provider, health, telemetry storage) are injected through
   the container's adapter bag — the only I/O edges.
5. **Generated data** (`exerciseImages.js`) is exempt from size guidance; it is
   a build artifact, not logic.

## Where things live

| Concern | Home |
| --- | --- |
| App constants, keys, retention limits | `src/core/config.js` |
| Feature flags & gating | `src/core/flags.js` (+ CONFIG.flags) |
| Typed errors & strategy | `src/core/errors.js` (ADR 0005) |
| DI & adapter overrides | `src/core/container.js` (ADR 0004) |
| Data access & store invariants | `src/repositories/index.js` (ADR 0002) |
| Repository-backed orchestration verbs | `src/services/index.js` |
| Workout save/cancel/adaptation/integration workflow | `src/services/workoutService.js` |
| Programme generation/scheduling/template mutation | `src/services/programmeService.js` |
| Settings object transitions | `src/services/settingsService.js` |
| Device-data lifecycle / storage health | `src/services/dataLifecycleService.js` |
| Storage diagnostics / maintenance | `src/services/storageDiagnosticsService.js` |
| Cloud-coach routing/explanation lifecycle | `src/services/coachService.js` |
| Feedback classification/review/share lifecycle | `src/services/feedbackService.js` |
| Evidence snapshot/study/export workflow | `src/services/evidenceService.js` |
| Shared runner clock/wake-lock/draft lifecycle | `src/hooks/useWorkoutRuntime.js` |
| Standard runner deterministic set/recommendation/save transitions | `src/lib/sessionRunnerModel.js` |
| Cross-tab invalidation/reconciliation | `src/lib/crossTabStore.js` |
| Export contract & import policy | `src/lib/exportPolicy.js` (ADR 0003) |
| Domain model & tombstones | `src/lib/domain.js` |
| Ledger recording / aggregation | `src/lib/longitudinal.js` / `evaluation.js` (ADR 0007) |

## IndexedDB and multi-tab state

IndexedDB is canonical once hydration completes. Each tab keeps its own
in-memory cache for synchronous React reads, so a cache hit is **not** a valid
cross-tab refresh. The live-tab protocol is therefore:

1. a local React change is queued for durable persistence;
2. immediately before writing, the tab performs a fresh IndexedDB read and
   three-way reconciles `base → local` against the current canonical snapshot;
3. the atomic IndexedDB transaction commits;
4. the writer publishes a small `store-invalidated` revision message over
   `BroadcastChannel` (or a localStorage pulse when BroadcastChannel is absent);
5. an idle peer waits for its own pending write queue, re-reads canonical IDB,
   replaces its tab-local cache, and applies the snapshot without re-persisting
   it;
6. a tab that locally owns an active workout defers the refresh until that
   protected runner/draft ends. Merely observing another tab's canonical draft
   does not claim local ownership or block future invalidations.

The broadcast never contains training data. Concurrent entity collections are
merged by stable identity and unchanged local domains inherit remote changes,
so a draft autosave cannot silently roll back an unrelated preference or a
session completed in another tab.

## Current migration status

The service boundary is intentionally incremental rather than fictional.
Workout completion/cancellation, programme/template workflows, cloud-coach
routing, feedback handling and evidence/study actions now leave React through
application services. Device-data deletion, integrity notices, browser storage
health and persisted-state diagnostics now also cross explicit lifecycle service
boundaries; feature components no longer import the canonical storage/IDB
modules directly. `MoreView` remains the composition/search container while
AI, feedback, appearance/accessibility, guided settings, policy and evidence
sections own their local interaction state. Standard and Guided runners remain
separate presentations but share runtime ownership for clocks, wake lock and
crash-draft persistence. `SessionRunner.jsx` keeps UI/event orchestration while
its deterministic set editing, carry-forward, recommendation application,
save eligibility and history-payload construction live in
`sessionRunnerModel.js`, where those invariants are directly unit-tested.

Large components may still call pure recommendation/safety/selectors directly;
future extraction should continue to target cohesive workflows (for example
prescription/substitution lifecycle) rather than split files merely to reduce
line counts. The rule remains **workflow orchestration out of React; cheap
deterministic derivations may stay direct imports.**
