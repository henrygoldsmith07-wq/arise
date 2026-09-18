# Testing in Arise

What the automated suites cover, what they deliberately do not, and what
still needs a human with a real device.

## Layers

| Layer | Runner | Covers |
|---|---|---|
| Unit (600+) | `npm test` (`node --test`) | engine logic, policies, substitutions, longitudinal statistics, migrations, storage, import/export policy, sync engine, domain model, data generators, cohort operations, product-success metrics, participant lifecycle |
| Integration | within the suite | storage flows (decompose/recompose round-trips), import/export, active-workout save/edit/restore, study export/import round trips |
| Property-based | seeded RNG, reproducible | progression engine invariants (prior-only, determinism, sane outputs), substitution ranking, upsert dedupe, schedule generation |
| Fuzz | seeded hostile inputs | import files must throw descriptive errors or produce a safe, validated store — never a partial write |
| Benchmarks | `npm run benchmark` | engine regression gates, artifact determinism across commits, study/field-study/logging-time harnesses |
| Study operations | `npm run study:report` + `benchmark:field` / `benchmark:field:fixture` | participant-export ingestion (repeated exports fold into one participant), anomaly detection (duplicates, conflicting records, malformed ids, arm flips), cohort totals, arm balance, gate eligibility — fixture mode in CI, real directories by operators |
| Report canary | `npm run study:report:fixture` (add `-- --check` for CI mode) | regenerates the committed example reports in `benchmark/fixtures/` from the deterministic synthetic cohort through the real ingestion path — byte-identical or CI fails; a render/schema change without regeneration is caught |
| Pilot operations | `npm run pilot:report <exports-dir>` (+ `docs/PILOT.md`) | weekly operator report over real participant exports: roster with per-participant health warnings (stale exports, consent loss, conflicts, abandonment, overrides, friction), pulse metrics with n/missingness, gate progress, data quality — deterministic under `--now=`; operational warnings never change product or gate behaviour |
| E2E | `npm run e2e` (Playwright, dev server) | user journeys, guided mode, resilience (interruption, resume, cross-tab, a11y, light/dark screenshots), performance smoke |
| E2E (PWA) | `npm run e2e:pwa` (production build) | service-worker offline boot, install surface, shortcuts |

## Invariants with dedicated tests

- **Prior-only enforcement:** leak-detector tests inject future sessions and
  assert every engine output is unchanged.
- **Ledger firewall:** the evaluation ledger can inform dashboards but any
  attempt to feed it into recommendations fails.
- **Determinism:** same seed → byte-identical dataset; benchmark artifacts
  must match across commits or the change is a conscious re-baseline.
- **Recovery:** corrupted-but-recoverable stores quarantine instead of
  booting; duplicate detection and impossible-value detection each have
  suites.
- **One person is one participant:** repeated exports fold by pseudonymous
  study id; unidentified exports never satisfy breadth gates; arm-flips
  across one person's exports are flagged, never applied.
- **Withdrawal stops treatment, never erases history:** dropping the
  enrollment must leave every recorded observation intact; deletion is a
  separate, explicit action.
- **No ranking below the gates:** the cohort report counts, audits and warns
  but never compares arms until the participant/session gates clear.

## What is deliberately not automated

- **Physical-device checks:** iOS standalone/splash behaviour, TalkBack and
  VoiceOver passthrough, low-end Android performance, in-app-browser
  edge cases. The checklist lives in `docs/device-test-matrix.md`.
- **Real-gym field protocol:** logging a session under gym conditions
  (network off, screen off between sets, gloves on) —
  `e2e/REAL_GYM_FIELD_TESTS.md`.
- **Visual regression:** screenshots upload as CI artifacts for human
  comparison; there is no pixel-diff gate yet.

## Local error tracking and traces

- Playwright retains traces and reports on failure
  (`playwright-report/`, uploaded as CI artifacts).
- Test failures print the failing seed for the seeded suites — rerun with
  the same seed to reproduce exactly.

## CI gates

Every PR runs: verify (lint, types, unit, build) → format → license →
bundle budget → dependency audit → benchmarks → artifact comparison →
field-study fixture → bundle-diff comment → e2e → e2e:pwa, aggregated into
one required `ci-summary` check. See `.github/workflows/arise.yml`.

The field-study fixture run exercises the exact ingestion → validation →
aggregation path real participant exports take, with deterministic synthetic
participants — including one repeat export to prove repeated files fold into
one person. Synthetic data never appears as real-world evidence.
