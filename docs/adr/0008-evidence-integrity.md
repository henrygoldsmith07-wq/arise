# ADR 0008 — Evidence integrity: prior-only decisions, a no-feedback ledger, and the synthetic/real firewall

Date: 2026-09-04 · Status: accepted

## Context

Every evidence feature (metrics, dashboards, calibration reports) is only as
trustworthy as the pipeline underneath it. Three failure modes kept recurring:

1. **Future-data leakage.** The engine accepted an `asOfDateISO` cut, but
   several helpers (`logsFor`, `sessionBestSummaries`, `personalisedRate`,
   `noisyFlagsForLastSession`, the model estimator, the study baselines)
   silently used the full history. A replay asking "what would you prescribe
   on Jan 20?" could see Jan 25 data — inflating every backtest metric.
2. **Feedback loops.** The evaluation ledger stores graded outcomes next to
   the recommendation code; any accidental read of it inside recommendation
   generation would make "evidence" self-confirming.
3. **Synthetic/real contamination.** Benchmark corpora are synthetic by
   design; if they ever mix with user-ledger-derived numbers in a report or
   artifact, every figure becomes untrustworthy.

## Decision

1. **Prior-only is a hard invariant.** With an `asOfDateISO` cut, *every*
   decision input — logs, best-set summaries, learned rates, noisy flags,
   model estimators, baseline arms — is sliced to sessions on or before the
   cut. `tests/evidence-integrity.test.js` proves identical output between a
   full history and its own prior-only slice, with a high future "tell" a
   leak would betray. Any engine change that violates this fails CI.
2. **The ledger never feeds back.** Recommendation generation reads history,
   priors and config only. The no-feedback test asserts identical
   recommendations with an empty vs a populated evaluation ledger.
3. **The synthetic/real firewall.** Benchmark scripts consume
   `benchmark/fixtures/*` only and label themselves "NOT external evidence";
   the on-device evidence dashboard consumes the evaluation ledger only and
   carries a "correlation, not causation" disclaimer. No code path mixes the
   two corpora.
4. **Uncertainty is shown, not hidden.** Proportions carry Wilson 95%
   intervals in UI and reports; sample-size bands gate the dashboard
   (insufficient < 3 < emerging < 8 < consistent < 20 = high confidence).
5. **Benchmarks are pinned and reproducible.** Determinism is asserted
   (two identical runs), thresholds gate CI, and a hashed artifact
   (fixture sha256 + priors/policy versions + metrics) is compared across
   commits — drift on an unchanged corpus+version fails, and any deliberate
   re-baseline must land with its reason.

## Consequences

- Point-in-time replays now measure real decision quality (they used to be
  flattered by leakage; e.g. the synthetic plateau row flipped verdict once
  the cut was enforced).
- Legacy ledger rows predate the audit block: rollups treat missing fields as
  unknown, never zero.
- Re-baselining is a conscious act: change the fixture/versions → artifact
  compare warns; regenerate the artifact in the same PR with the reason.
