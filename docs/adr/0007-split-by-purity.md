# ADR 0007 — Split oversized library files by purity, not size

Date: 2026-09-03 · Status: accepted

## Context
`longitudinal.js` (841 lines) mixed three concerns: shared ledger constants and
helpers, consent-gated recording/storage, and pure statistical aggregation
(segment summaries, Wilson intervals, participant-clustered bootstraps). The
pure half is needed inside the analytics Web Worker; the recording half must
never run there (it touches localStorage and consent). Line-count alone is a
bad splitting criterion — cohesion matters more.

## Decision
Split by **purity and runtime**:

- `longitudinalCore.js` — constants + tiny helpers (no storage, no consent);
- `evaluation.js` — pure aggregation over ledger rows (worker-safe);
- `longitudinal.js` — consent-gated recording; re-exports the moved names so
  all existing import sites keep working unchanged.

Future splits follow the same rule: cut along purity/runtime seams, keep a
re-export shim behind the old name, migrate import sites opportunistically —
never in the same commit as the move.

`exerciseImages.js` (~5.6k lines) is intentionally exempt: it is generated
data with a single consumer, not logic.

## Consequences
The analytics worker pulls only pure code; recording stays audit-able; existing
imports and tests keep passing through the re-export surface.
