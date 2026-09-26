# Architecture map — module boundaries

Date: 2026-09-26 · Companion to the ADRs in this directory.

## Layers (import direction points downward)

```
src/components/*.jsx      UI — React/presentation state; invokes application operations
        │
src/services/*.js         Application/domain orchestration; workflow boundaries
        │
src/repositories/*        Repositories — the ONLY data-access API; store invariants live here
        │
src/lib/storage.js        Canonical persistence: IDB decomposition/recomposition, hydration
src/lib/idb.js/idb-tx.js  IndexedDB wrapper + atomic multi-store transactions
        ▲
src/lib/*.js              Engine/utilities: mostly pure; explicit browser adapters are named I/O edges
        ▲
src/core/*                Cross-cutting: config, flags, errors, DI container
```

## Boundary rules

1. **UI does not import** `storage.js`, `idb.js`, `queries.js`, or repositories.
   Components may still consume pure engine selectors/formatters directly;
   multi-step write/adaptation workflows belong in services.
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
| Workout completion/adaptation transaction | `src/services/workoutService.js` |
| Export contract & import policy | `src/lib/exportPolicy.js` (ADR 0003) |
| Domain model & tombstones | `src/lib/domain.js` |
| Ledger recording / aggregation | `src/lib/longitudinal.js` / `evaluation.js` (ADR 0007) |

## Current migration status

The service boundary is intentionally incremental rather than fictional.
Workout completion now leaves `App.jsx` through `workoutService.js`, and the
repository-backed operations in `services/index.js` already isolate storage.
Large workout components still call pure recommendation/safety helpers
directly; future extraction should target cohesive workflows (draft state,
prescription lifecycle and persistence), not split files merely to reduce line
counts. The architectural rule is therefore **workflow orchestration out of
React**, while cheap deterministic derivations may remain direct imports.
