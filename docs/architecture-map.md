# Architecture map — module boundaries

Date: 2026-09-03 · Companion to the ADRs in this directory.

## Layers (import direction points downward)

```
src/components/*.jsx      UI — React only; talks to services/store hooks, never storage/IDB
        │
src/services/index.js     Domain services — orchestration; injected repos + adapters
        │
src/repositories/*        Repositories — the ONLY data-access API; store invariants live here
        │
src/lib/storage.js        Canonical persistence: IDB decomposition/recomposition, hydration
src/lib/idb.js/idb-tx.js  IndexedDB wrapper + atomic multi-store transactions
        ▲
src/lib/*.js              Engine (pure): progression, analytics, study, evaluation, …
        ▲
src/core/*                Cross-cutting: config, flags, errors, DI container
```

## Boundary rules

1. **UI never imports** `storage.js`, `idb.js`, `queries.js`, or repositories.
2. **Engine never imports** React, storage, repositories, or the DI container;
   purity means no clock, no storage, no randomness without a seed.
3. **Services never import each other**; they receive collaborators
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
| Orchestration verbs | `src/services/index.js` |
| Export contract & import policy | `src/lib/exportPolicy.js` (ADR 0003) |
| Domain model & tombstones | `src/lib/domain.js` |
| Ledger recording / aggregation | `src/lib/longitudinal.js` / `evaluation.js` (ADR 0007) |
