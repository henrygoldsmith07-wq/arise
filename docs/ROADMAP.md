# Roadmap & public backlog

Arise is deliberately stable in shape: local-first, no account, offline,
evidence-honest. The roadmap below is the living plan; the historical
analysis of *why* each item is gated the way it is remains in
`docs/IMPROVEMENTS.md` (note: its baseline numbers date from 2026-08-14 and
the "today" columns are stale — the architecture gate is still accurate).

## Shipped recently

- **Real-user validation layer, end to end**: pseudonymous participant
  identity (one person × many exports = one participant), self-service study
  onboarding with the full lifecycle (eligibility → plain-language consent →
  enrolled → withdrawn), withdrawal that stops treatment while preserving
  observed history, a cohort-operations report (`npm run study:report`)
  with data-quality warnings and analysis-gate eligibility, and
  product-success metrics (retention, adherence, acceptance, mode usage)
  computed from consented exports only
- Guided workout mode with audio/haptics/voice coaching and its own settings
- Entity-based IndexedDB persistence, integrity gate, snapshots, recovery
- Repository/service layer, DI container, typed errors, ADR record
- Progression policy layer with confidence/evidence/uncertainty and
  explanation modes
- Evidence metrics, calibration and dashboards over the evaluation ledger
- Gym Mode (focus, gestures, equipment-aware load controls), a11y pass
- **Programme template editing in the app** — create, edit, duplicate and
  reorder custom templates from the Train tab; editor swaps preview the same
  substitutions the scheduler would make
- Exercise teaching layer (how-to instructions per exercise)
- Performance: code splitting, budgets, service-worker layering
- Security/privacy: CSP, hostile-import hardening, consent center
- WebDAV sync with E2E encryption, partial + coach exports
- PWA: install onboarding, shortcuts, splashes, safe areas, haptics module
- Testing: 600+ unit, property/fuzz suites, resilience e2e, device matrix
- **History archive browser** — archived sessions can be searched, inspected
  at a glance and restored individually without restoring the whole archive
- **Unit-complete workout UX** — kg/lb now covers workout entry, summaries,
  recommendations and equipment setup while canonical storage remains kg
- **Explorable Progress charts** — visual charts expose a keyboard- and
  screen-reader-friendly data disclosure with the underlying values
- **Faster profile re-editing** — existing users reopen setup at kit and can
  save from any step instead of replaying the whole onboarding flow
- CI/CD: format gate, bundle-diff reporting, license gate, release
  automation

## Next (planned)

| Item | Why now | Gate |
|---|---|---|
| Screenshot gallery automation | docs ship with real captures | none — local-only tooling |
| Mutation testing on the core engine | raise confidence in progression invariants | CI-time cost; run nightly, not per-PR |
| Visual regression gate | screenshots already collected as artifacts | needs a baselining policy (device-dependent pixel noise) |
| First cohort of consented field-study participants | onboarding, lifecycle and the operations tooling all ship; the study now needs people | participant recruitment + the analysis gates in `docs/EVIDENCE.md` |
| Multi-peer sync registry | per-device registry over the single remote payload | sync already ships; this is the documented extension |

## Public backlog (unclaimed, roughly ordered)

1. **Widget/shortcuts deep links** on native wrappers (needs Capacitor —
   documented, optional)
2. **Workout note snippet picker** — useful convenience, deferred while the
   runtime bundle is at its product budget
3. **Weekly Review Markdown export** — useful convenience, deferred while the
   runtime bundle is at its product budget
4. **Cohort report scheduling helper** (the `npm run study:report` CLI is
   manual by design; a wrapper that reminds when exports are due could help
   operators — only if operators ask for it)

## Not planned (and why)

- **Nutrition** — out of scope by charter.
- **Hosted accounts/server sync — including hosted Google-account sync** —
  breaks the no-server guarantee, and a Google account cannot even be issued
  for a device-local, offline-first app without introducing exactly the
  hosted identity layer the charter forbids. Google Sign-In was evaluated
  for the app suite and rejected on this ground (see `docs/PRODUCT.md`):
  the local-first posture IS the product's trust model. If the product
  charter ever changes, that is an ADR and a strategy rewrite — not a
  feature request. User-owned WebDAV (E2E-encrypted) is the supported sync
  path.
- **Notifications** — the first feature that proactively interrupts users;
  conflicts with the consent posture. Revisit only as explicit opt-in.
- **Social features** — identity/graph requirements contradict the
  local-first, no-account posture.

## How to propose

Open an issue with the use case, not the solution. Anything touching the
ground rules (local-first, prior-only, evidence posture) needs an ADR —
see `CONTRIBUTING.md`.
