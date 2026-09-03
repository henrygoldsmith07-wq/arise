# ADR 0003 — Import is a two-step, policy-gated flow

Date: 2026-09-03 · Status: accepted (implemented in PR #18; this ADR records it)

## Context
Imports were applied immediately on file pick. A malformed or hostile file
could mutate the store before the user saw what it contained.

## Decision
Import always runs as **preview → confirm**:

1. `buildImportPreview(rawFile, currentStore)` is read-only: it adapts the file
   to the current contract, validates the envelope, computes counts, per-session
   conflicts and the denied fields present, and returns metadata — it never
   mutates state.
2. Only an explicit user confirm calls `applyPreview`, which re-validates and
   merges through the normal merge paths.

The **field policy** gates what a file may change: an allow-list of top-level
store keys (default-deny for anything new), consent toggles
(`telemetryEnabled`, `pulseEnabled`, `healthSummaryEnabled`, `syncEnabled`)
are never file-supplied, and prototype-pollution keys are stripped.
Study identity and health summaries travel deliberately (device portability,
study folding) — that choice is codified here so it is not "fixed" back.

## Consequences
Users see exactly what an import will do before it happens; hostile or
hand-edited files fail typed (`ImportRejectedError`) instead of half-applying.
