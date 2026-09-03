# ADR 0001 — Layered architecture: engine, storage, repositories/services, UI

Date: 2026-09-03 · Status: accepted

## Context
Engine modules (progression, programming, substitutions) had accreted direct
storage access and UI-adjacent helpers, making the pure logic hard to test and
React components load-bearing for data plumbing.

## Decision
Four boundaries, enforced by review and import direction:

    adapters (sync/health/telemetry providers) — the only I/O edge
         ▲
    repositories (data access, store invariants) + services (orchestration)
         ▲
    engine (pure logic in src/lib: progression, analytics, study, …)
         ▲
    UI (React components — never import storage or IDB directly)

- `src/core/` holds cross-cutting concerns: config, flags, errors, DI container.
- Import direction only points downward/into the layers above; the engine never
  imports React, storage, or repositories.
- Engine modules stay pure: same inputs → same outputs, no clock, no storage.

## Consequences
Pure logic is testable without React or IndexedDB (the whole node test suite
runs on the in-memory IDB fallback). UI refactors cannot silently corrupt data
invariants. New code that reaches around a layer is rejected in review.
