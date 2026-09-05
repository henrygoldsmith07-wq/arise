# Testing in Arise

What the automated suites cover, what they deliberately do not, and what
still needs a human with a real device.

## Layers

| Layer | Runner | Covers |
|---|---|---|
| Unit (600+) | `npm test` (`node --test`) | engine logic, policies, substitutions, longitudinal statistics, migrations, storage, import/export policy, sync engine, domain model, data generators |
| Integration | within the suite | storage flows (decompose/recompose round-trips), import/export, active-workout save/edit/restore |
| Property-based | seeded RNG, reproducible | progression engine invariants (prior-only, determinism, sane outputs), substitution ranking, upsert dedupe, schedule generation |
| Fuzz | seeded hostile inputs | import files must throw descriptive errors or produce a safe, validated store — never a partial write |
| Benchmarks | `npm run benchmark` | engine regression gates, artifact determinism across commits, study/field-study/logging-time harnesses |
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
bundle-diff comment → e2e → e2e:pwa, aggregated into one required
`ci-summary` check. See `.github/workflows/arise.yml`.
