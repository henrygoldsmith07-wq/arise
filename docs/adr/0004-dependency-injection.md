# ADR 0004 — Dependency injection through a minimal container

Date: 2026-09-03 · Status: accepted

## Context
Services need collaborators (repositories, clock, logger, sync provider) and
tests need to substitute them. Class-based DI frameworks are overkill for a
codebase with zero runtime dependencies beyond React, and module singletons
made tests order-dependent.

## Decision
`core/container.js` is a ~60-line registry:

- `register(name, factory)` / `resolve(name)` — lazy, memoised singletons with
  cycle detection;
- an **adapter bag** (`clock`, `nowISO`, `uuid`, `log`, `reportError`) that
  every service receives; `overrideAdapter(name, fn)` swaps any edge in tests.

Services are plain factories: `createProgressionService({ repos })`. They never
import each other or reach for module singletons; they receive everything.
React consumes services through one assembly point (`createServices()`), so a
component tree can be tested against fakes without module mocking.

## Consequences
Every side-effecting edge is swappable; no hidden global state; the cost is
one tiny module and the discipline to pass dependencies instead of importing
them.
