# Roadmap & public backlog

Arise is deliberately stable in shape: local-first, no account, offline,
evidence-honest. The roadmap below is the living plan; the historical
analysis of *why* each item is gated the way it is remains in
`docs/IMPROVEMENTS.md` (note: its baseline numbers date from 2026-08-14 and
the "today" columns are stale — the architecture gate is still accurate).

## Shipped recently

- Guided workout mode with audio/haptics/voice coaching and its own settings
- Entity-based IndexedDB persistence, integrity gate, snapshots, recovery
- Repository/service layer, DI container, typed errors, ADR record
- Progression policy layer with confidence/evidence/uncertainty and
  explanation modes
- Evidence metrics, calibration and dashboards over the evaluation ledger
- Gym Mode (focus, gestures, equipment-aware load controls), a11y pass
- Performance: code splitting, budgets, service-worker layering
- Security/privacy: CSP, hostile-import hardening, consent center
- WebDAV sync with E2E encryption, partial + coach exports
- PWA: install onboarding, shortcuts, splashes, safe areas, haptics module
- Testing: 600+ unit, property/fuzz suites, resilience e2e, device matrix
- CI/CD: format gate, bundle-diff reporting, license gate, release
  automation

## Next (planned)

| Item | Why now | Gate |
|---|---|---|
| Screenshot gallery automation | docs ship with real captures | none — local-only tooling |
| Mutation testing on the core engine | raise confidence in progression invariants | CI-time cost; run nightly, not per-PR |
| Visual regression gate | screenshots already collected as artifacts | needs a baselining policy (device-dependent pixel noise) |
| Public field-study onboarding | the five-arm study exists; needs consented participants | privacy review + participant docs |
| Multi-peer sync registry | per-device registry over the single remote payload | sync already ships; this is the documented extension |

## Public backlog (unclaimed, roughly ordered)

1. **Charts: screen-reader-explored data views** (beyond text alternatives)
2. **lb-first unit UX** (store kg internally; full display unit audit)
3. **Template editor UI** (templates are engine-complete; editing is
   file-level today)
4. **History archive browser** (archive store exists; needs a viewer)
5. **Widget/shortcuts deep links** on native wrappers (needs Capacitor —
   documented, optional)
6. **Workout notes: richer templates** (templates exist; a picker UI is
   missing)
7. **Weekly Review: export as Markdown**
8. **Onboarding re-edit flow polish** (re-editable today; flow is clunky)

## Not planned (and why)

- **Nutrition** — out of scope by charter.
- **Hosted accounts/server sync** — breaks the no-server guarantee;
  user-owned WebDAV is the supported path.
- **Notifications** — the first feature that proactively interrupts users;
  conflicts with the consent posture. Revisit only as explicit opt-in.
- **Social features** — identity/graph requirements contradict the
  local-first, no-account posture.

## How to propose

Open an issue with the use case, not the solution. Anything touching the
ground rules (local-first, prior-only, evidence posture) needs an ADR —
see `CONTRIBUTING.md`.
