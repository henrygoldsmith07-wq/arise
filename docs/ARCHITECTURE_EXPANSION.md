# Architecture: expansion paths

Where Arise can grow without breaking its invariants (local-first, no
account, engine purity, evidence honesty). This page records the evaluated
expansion candidates and the seams they would use. The machine-readable
summary lives in `src/lib/futureExpansion.js`.

## The seams that already exist

- **Adapter bag (`core/container.js`)** — clock, logger, storage, sync are
  injected, never imported. Any future integration (health platforms,
  wearables) enters here as an adapter with its own consent gate.
- **Health-summary isolation** — the optional health summary already has its
  own consent, minimisation, and storage separation. A HealthKit or Google Fit
  adapter is a new *producer* for that same summary, not a new data path.
- **Engine purity** — every engine module runs without React or storage
  access (enforced by ADR 0001 and the tests). White-labeling or packaging
  the engine separately is therefore a build task, not a rewrite.
- **Share codes (`shareCodes.js`)** — one-to-one program sharing with no
  server: checksummed, URI-safe payloads, IDs regenerated on install. A
  community library would be an optional *index* of such codes, which is a
  hosting decision, not an app feature.

## Evaluated and deferred

| Candidate | Why deferred | Revisit when |
|---|---|---|
| Read-only wearable integration | Needs platform APIs reachable only via the Capacitor wrapper; consent design is its own project | Wrapper ships (docs/capacitor-wrapper.md) |
| Watch companion rest timer | Native-only surface; PWA covers cues via audio/haptics/wake lock | After wrapper; demand evidence |
| Multi-profile local support | Every store surface and sync merge assume one owner; isolation is a storage-layer redesign | Own ADR with partitioned object stores |
| Plugin architecture | The adapter bag is the seam; plugins need a manifest + permission model | Own ADR; start with health adapters |
| Community program library | Implies moderation + hosting; share codes cover the honest use today | If there is real demand |
| White-label engine packaging | Engine is already import-clean | When an actual consumer appears |
| Full hands-free mode | Voice *logging* ships; voice *navigation* needs broader a11y validation | After accessibility re-audit |

## Shipped in this round

- **Voice input for set logging** — `voiceInput.js`; per-block mic in the
  runner; number-word parsing ("sixty for eight"); unsupported engines hide
  the control.
- **Program/template sharing** — `shareCodes.js` with install/rename guard.
- **Printable progress report** — `printReport.js`; same insight functions as
  the Progress view; aggregate by default, per-set detail opt-in.
- **CSV importers** — `appCsvImport.js` for other apps' documented exports:
  loose column matching, lb→kg conversion, unknown names reported, merged
  through the normal import path.
- **Experiment framework** — already existed (`study.js`,
  `studyEnrollment.js`): seeded balanced arm assignment, prior-only
  enforcement, evaluation ledger. Recommendation experiments run through it.
