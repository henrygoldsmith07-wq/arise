# Data dictionary

Every field Arise stores and what it means. The canonical store is
recomposed from fourteen IndexedDB object stores (see
`docs/STORAGE_SCHEMA.md` for the storage mechanics); this page is the
vocabulary.

## Identity and IDs

IDs are branded strings (`exerciseId`, `sessionId`, `programId`,
`templateId`) validated by Zod schemas on every write. Records also carry
provenance metadata:

| Field | Meaning |
|---|---|
| `id` | stable identifier; upserts de-duplicate on it |
| `savedAt` | ISO timestamp of the last write to the record; the LWW tie-breaker in merges and sync |
| `dataSource` | where the record came from: `manual`, `import`, `adapter`, `generator` |
| `provenance` | for recommendation/outcome pairs: policy version, priors version, snapshot basis |
| `deletedAt` / tombstones | soft-delete flag; tombstone records carry deletions into merges/sync |

## Onboarding (profile store)

| Field | Meaning |
|---|---|
| `goal` | strength / hypertrophy / endurance / general — drives rep ranges, policy defaults, volume advice priority |
| `location` | gym / home / outdoors — biases conditioning and equipment honesty |
| `equipment[]` | the honest kit list; the hard gate on recommendations |
| `level` | training experience tier; sets priors until history takes over |
| `daysPerWeek`, `availableMinutes` | schedule resampling and time-cap enforcement |
| `preferredExerciseIds[]` / `dislikedExerciseIds[]` | ranking biases (likes float, dislikes excluded) |
| `plateConfig` | bar weight, per-side plate inventory, dumbbell pairs, machine increment — makes barbell/dumbbell/machine targets achievable-by-construction |

## Schedule (programme store)

| Field | Meaning |
|---|---|
| `programId`, `startDateISO` | what was started and when |
| `sessions[]` | dated sessions: `id`, `dateISO`, `week`, `day`, `title`, `blocks[]`, `status` (`planned` / `done` / `missed` / `skipped`) |
| `blocks[]` | exercise blocks: `exerciseId`, `sets` prescription, optional `substitutionFrom` + `substitutionReason` |

## History (sessions + sets stores)

| Field | Meaning |
|---|---|
| `dateISO` | local training date (UTC-midnight normalised); the primary index |
| `startedAt` / `finishedAt` / `savedAt` / `durationMinutes` | timing; `savedAt` is the merge tie-breaker |
| `programId` / `templateVersion` / `week` / `day` | what prescribed this session |
| `equipmentSnapshot[]` | kit at training time — old sessions stay interpretable after onboarding changes |
| `substitutions[]` | `{ from, to, reason }` audit trail |
| `exerciseOrder[]` | actual order performed |
| `blocks[].sets[]` | `{ reps, weightKg, rpe, side, rom, assistedKg, tempo, completed, skipped, failed, pain }` — all optional beyond reps; blanks are legitimate (bodyweight) |
| `note` / `noteTags[]` | free-text note plus structured quick tags (pain, soreness, quality) |
| `painDiscomfort?`, `skippedSetsCount?` | session-level signals feeding quality weighting and guardrails |

## Events (events store)

Consent-gated measurement records: `{ id, schemaVersion, type, at, …payload }`.
Types include set-logging time, session abandonment, recommendation
acceptance/rejection. Exportable and clearable independently; the events
ledger never feeds the engine.

## Readiness

Per-entry `{ dateISO, sleep, soreness, motivation }` (plus derived score
0–100). Dated at or before the session to count; future entries cannot
classify past sessions.

## Evaluation ledger (recommendations / outcomes / adaptations)

- `recommendations`: the frozen pre-workout snapshot — basis (visible
  session count, previous best, training-age phase, priors version,
  policy version), the prescription, confidence/uncertainty/evidence.
- `outcomes`: what actually happened for the targeted session.
- `adaptations`: programme-level changes with their basis and evidence.
- All three live in stores that dashboards read and the engine never does.

## Preferences (profile store)

| Field | Meaning |
|---|---|
| `units` | `kg` / `lb` display |
| `theme` | null (system) / light / dark |
| `soundCues`, `voiceCoach`, `voiceRate` | rest audio + speech settings |
| `haptics` | vibration patterns on/off |
| `gymMode` | focus mode / rest / numpad preferences |
| `syncEnabled` + `sync` | sync toggle + WebDAV config — **device-local by policy: stripped from exports, denied on import** |
| `telemetryEnabled`, `pulseEnabled`, `healthSummaryEnabled` | independent, revocable consents (null = never asked) |
| `accessibility` | `largeText`, `highContrast`, `reduceMotion` |

## Health summary (optional adapter)

`{ source, asOf, steps?, sleepHours?, weightKg?, restingHeartRate? }` — a
small derived summary only, never raw health history. Consent-gated,
minimised by design.

## Quarantine / snapshots / archive / tombstones

Support stores: boot-failure quarantine payloads, rolling local backup
snapshots, archived old history, and deletion tombstones for merge/sync.
See `docs/STORAGE_SCHEMA.md`.
