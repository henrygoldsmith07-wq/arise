# ADR 0002 — Repository layer between UI/services and storage

Date: 2026-09-03 · Status: accepted

## Context
The canonical store is a recomposition of IndexedDB object stores with
non-obvious invariants: write-time schema normalisation, atomic multi-store
transactions, soft-delete flags, tombstones, provenance stamps. Consumers were
starting to re-implement pieces of these invariants, and every call site
imported `storage.js` directly.

## Decision
Six repositories (`HistoryRepository`, `ProgramRepository`, `TemplateRepository`,
`PreferencesRepository`, `EventRepository`, `RecommendationLedgerRepository`) in
`src/repositories/` are the ONLY data-access API above storage. They:

- translate app intent into storage operations (paged queries, upserts);
- guarantee invariants at the boundary (normalisation on write, tombstones on
  delete, `NotFoundError`/`StorageError` typed failures);
- hide the store recomposition so its shape can evolve without touching callers.

The hydrated store cache remains a read-through singleton underneath; when the
store graduates to per-entity transactions, only the repositories change.

## Consequences
One place to audit data invariants; tests substitute the whole backend, not
mocked pieces; components and services never import `storage.js`/`idb.js`.
