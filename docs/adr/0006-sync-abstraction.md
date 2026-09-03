# ADR 0006 — SyncService abstraction before a sync provider exists

Date: 2026-09-03 · Status: accepted

## Context
Cross-device sync is on the roadmap but no provider is chosen. Meanwhile the
merge semantics (per-session last-write-wins via savedAt, tombstone-aware
deletions, consent-respecting field policy) are implemented and tested in
`sync.js`. Waiting for a provider would keep those semantics locked inside
export/import code paths.

## Decision
`SyncService` exists now with a provider seam: `{ pull, push }` injected at
construction. The capability is gated behind the `syncEngine` feature flag
(throwing the typed `FlagDisabledError` when off), so call sites can be written
today and the provider can arrive later without touching them. Until a real
provider lands, `mergeRemote` exposes the offline merge path for tests and for
manual payload imports.

## Consequences
Sync semantics are testable now; no call-site churn when a provider is chosen;
the flag keeps half-finished sync UI out of user hands.
