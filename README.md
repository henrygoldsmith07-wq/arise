# Arise — Training, levelled up

A game-like, offline-first training companion. Not a nutrition app.

**Stack:** Vite + React + Tailwind v4 + `le-studio.css` design tokens. Local-first (`localStorage`), no backend, no account. PWA-ready. **Progression engine** in `progression.js` + `substitutions.js`, **template engine** in `templates.js`, **analytics** in `analytics.js`, **session generator** in `sessionGenerator.js` (fatigue-aware ordering in `warmup.js`).

## What it does — in order

1. **Wires `data.js`** — single source of truth: `EQUIPMENT` / `LOCATIONS` / `MUSCLES` / `LEVELS` / `EXERCISES` + `PROGRAMS`. Every exercise declares `equipment[]` and `substitution[]`; validation is runnable (`npm run lint:content`).
2. **Exercise browser** — search + filters (muscle / equipment / level) plus an **Only my kit** toggle gated by onboarding. Always shows a substitution when kit is missing; never pretends a barbell lift is “recommended” to a bodyweight-only user.
3. **Export / restore / import** — validated, schema-versioned JSON backup (`{ app:'arise', version, schemaVersion, exportedAt, data }`) plus CSV and event-history export. `Merge` de-dupes by session `id` and event id; `Replace` overwrites. No cloud sync — the user owns the file.
4. **Programs are scheduled training** — picking a program in **Train** creates dated sessions (`activeSchedule.sessions[]`) via `scheduleProgram()`. Today shows the session for today (or up next); progress is `done/total`.
5. **Onboarding shapes recommendations** — goal + location + equipment + level/days/time + optional liked/avoided movements + barbell plate setup. `recommendExercises()` and `availablePrograms()` are deterministic and re-sort visibly when onboarding changes (minimal kit → beginner-friendly first; location biases conditioning).
6. **Resistance / load tracking** — every logged set is `{ reps, weightKg, rpe }`. Leave weight blank for bodyweight. Session volume (`kg`) is derived live; `SessionRunner` enforces reps-filled before save.
7. **Attributes derive from history** — `deriveAttributes(history)` computes Strength / Endurance / Consistency / Technique from logged volume, loads (Epley 1RM), variety, cardio minutes, streak and logging discipline. Level is `avg/7`. Nothing derives from program labels.
8. **PWA** — `manifest.webmanifest` + `sw.js` (cache-first navigations, stale-while-revalidate assets, same-origin only). Icons use the Arise rising-A mark. Install → airplane mode → reload keeps Today / Exercises / schedule from cache.
9. **Mobile tested (guide)** — see below. Touch targets ≥44px, safe-area insets, standalone display.
10. **Accessibility** — landmarks (`header`/`main`/`nav` with `aria-label`), skip link, `aria-current="page"`, `aria-live="polite"` on result counts, `role="status"` on import messages, labelled inputs, visible `:focus-visible` ring from `le-studio.css`, `Esc` + overlay-click to dismiss dialogs, `prefers-reduced-motion` respected, OS theme respected.
11. **No nutrition system** — intentionally out of scope. Adding one recreates Forq and distracts from the training/level-up proposition.
12. **Progression engine (`progression.js`) —** `recommendNext()` (conservative double-progression: reps then load, bodyweight-aware, RIR-aware), `isPlateau`/`shouldDeload` (3-flat sessions + RPE/volume signals, conservative 40% deload), `rirFromRpe`/Epley 1RM as single source of truth, `isMeaningfulPR` (>2% filter), `strengthTrend` + `readinessScore` (sleep/soreness/motivation → 0..100). Every adjustment explains why.
13. **SessionRunner extras ported from Life OS:** auto rest timer (tap Rest to start a countdown per `restSec`, with vibrate on finish), **previous session comparison (“Last: 20kg×8 on 2026-02-01” per exercise via `store.lastExerciseSets`), and a **post-workout summary** in Progress (last session volume/sets/exercises + note). Life OS's eval-based Web Worker was **not** ported — intentionally replaced with safe helpers.
14. **Programme template engine (`templates.js`)** — templates are versioned blueprints over programs. `instantiateTemplate()` turns one into a dated schedule and **honestly swaps any exercise the user's kit can't do** (bodyweight is always available; swaps are logged and explained). `recommendTemplate()` scores templates by equipment fit (dominant), level/goal match, and days-per-week; `templateVersionInfo()` reports template + linked-program changelogs.
15. **Volume balance advice (`analytics.js`)** — `volumeBalanceAdvice()` compares each goal-priority muscle's weekly sets against an even share and flags under/over-trained muscles *relatively* (rough context, not a prescription), with a concrete rebalance suggestion.
16. **Better fatigue-aware ordering (`warmup.js`)** — `fatigueAwareOrder()` is now greedy: heavy compounds first, **least-trained muscles early while fresh** (`weakPointMuscles()` from history), same-muscle/family exercises kept apart (`muscleOverlap()`), cardio last. `sessionGenerator` uses it automatically.
17. **Session quality & recovery (`sessionQuality.js`)** — `noteSignals()` extracts sentiment/technique signals from workout notes; `sessionQuality()` classifies each session good/ok/bad (readiness, RPE, failed reps, notes); `plateauAttribution()` tells a **real plateau from a run of bad sessions**; `deloadReadinessAssessment()` adds deload triggers that never fire on a **single-day readiness dip** (only a sustained EMA trend + other fatigue signals); `scanPRs()` walks history and flags **fake PRs** — technique/ROM changes, sub-2% jitter, low-readiness days.
18. **Programme-level adaptation (`programming.js`)** — after a completed session, repeated evidence can add one set to the next exposure, reduce the next block after repeated difficulty, apply a bounded recovery/deload window, or select a kit-compatible variation after a genuine plateau. Each change stores its basis, evidence and reason; the same history is idempotent.
19. **Long-break recovery and duplicate-safe history** — recommendations restart conservatively after an explicit six-week gap, without erasing training age. Session saves upsert by ID and prefer newer edited records so adherence and progression are not inflated by duplicate rows.
20. **Profile-to-programme generation** — `programmeGenerator.js` turns the captured profile plus prior history into a dated, equipment-honest schedule. It resamples weekly frequency, applies the time cap, ranks substitutions, preserves liked movements when they are viable, excludes avoided movements and returns every reason and swap.
21. **Plate-aware loadability** — `plates.js` finds the nearest achievable barbell load and per-side stack. When onboarding includes a barbell setup, `recommendNext()` rounds only barbell recommendations and explains any under/overshoot in the runner.
22. **Durable measurements & consent** — local event history records set logging time, session abandonment and recommendation acceptance only after explicit local-measurement consent. More provides event export/clear, Pulse sharing consent, optional health-summary consent and validated import feedback.
23. **Pulse and health adapters** — `runPulseIntegrationE2E()` exercises workout/volume writes plus metric reads against an injected adapter; `health.js` supports an optional small summary adapter without requiring a platform SDK or raw health history.
24. **Field validation** — deterministic progression and logging benchmarks are runnable; the real-gym protocol is in [`e2e/REAL_GYM_FIELD_TESTS.md`](e2e/REAL_GYM_FIELD_TESTS.md).
25. **Real longitudinal validation (`longitudinal.js`)** — with local-measurement consent, every recommendation is snapshotted *before* the workout it targets (with a prior-only basis: visible session count, previous best, training-age phase, priors version), and the real outcome is attached when that workout completes. Pairs are aggregated into progression-success / regression / stagnation / adherence rates segmented by training age, exercise, movement pattern and equipment class (free weights / machines / cables / bodyweight). Segment conclusions are withheld below a minimum sample size; the evaluation ledger lives under its own storage key, never feeds back into recommendations, and no recommendation is ever recomputed from later sessions.
26. **History visualisation (`charts.js` + `Charts.jsx`)** — Progress draws rather than describes: a per-lift estimated-1RM sparkline with its confidence band shaded (±1.96 residual standard errors, never drawn below the engine's three-point floor, and labelled as the spread of logged sessions rather than a forecast), weekly sets by muscle as a stacked bar that outlines any muscle in the high landmark band, and a planned-vs-completed adherence strip where a future session is never counted as missed. Inline SVG only — no chart library — painted with `currentColor` so the OS theme needs no second palette, with each chart's text equivalent as its accessible name.
27. **Before any public/commercial release — rename franchise-adjacent terminology.** The codebase is already neutral fitness language (no hero/avenger/marvel/power-level terms). Audit app name, copy, icon and store listing for any remaining franchise-adjacent branding before publishing.

## Roadmap

Planned improvements — prioritised, with the PWA/local-first constraints that
gate each one — are in [`docs/IMPROVEMENTS.md`](docs/IMPROVEMENTS.md).

## Consolidation

Arise is the canonical training app. `vendor/life-os-scrape` is an **archived, read-only mirror** of the old standalone Life OS production build (scraped 2026-07-03) and is no longer developed. Its strongest fitness practices have been ported into Arise — see `vendor/life-os-scrape/README.md` for the porting log — and its one known engineering issue (`eval()` in the analytics Web Worker) is documented there and **not** carried forward (Arise uses safe in-thread helpers).

## Run

```bash
cd apps/arise
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/
npm run lint:content
npm run type-check # tsc --noEmit (jsconfig.json, src + scripts)
npm test           # node:test (data / attributes / export / store / validation)
npm run benchmark  # seeded progression-validation harness → benchmark/results.md (also in CI)
npm run benchmark:logging # deterministic logging-time metric smoke benchmark
npm run verify     # lint:content && type-check && test && build  (also in CI)
npm run e2e        # Playwright browser E2E (new-user journey + mobile layout)
```

No env vars. Data is local — clear via **More → Clear local data** (or export first). Cross-device sync is an optional `sync.js` layer (`syncUp`/`syncDown` + pluggable `pull/push`) — offline-first preserved, sync is Merge/Replace over export JSON.

## Data model (localStorage `arise.store.v1`)

```js
{
  version: 5,
  onboarding: { goal, equipment:[], location, level, daysPerWeek, availableMinutes, preferredExerciseIds:[], dislikedExerciseIds:[], plateConfig?: { barWeightKg, platesKg:[], dumbbellsKg?:[], machineIncrementKg? } } | null,
  activeSchedule: { programId, startDateISO, sessions:[{ id, dateISO, week, day, title, blocks, status }] } | null,
  activeWorkout: { session, blocks, note, noteTags, restEndsAt, startedAt, updatedAt } | null,
  // v5 real-history fields (added by normaliseHistoryEntry on read/migration):
  history: [{ id, dateISO, programId, programVersion?, templateVersion?, week, day, title,
              durationMinutes?, startedAt?, finishedAt?, savedAt,
              equipmentSnapshot?: [], substitutions?: [{ from, to, reason }],
              exerciseOrder?: [exerciseId], painDiscomfort?, skippedSetsCount?,
              blocks:[{ exerciseId, exerciseOrder?, substitutionFrom?, substitutionReason?, equipment?,
                        sets:[{ reps, weightKg, rpe, side, rom, assistedKg, tempo, completed?, skipped?, failed?, pain? }] }], note?, noteTags? }],
  eventHistory: [{ id, schemaVersion, type, at, ...payload }],
  healthSummary: { source, asOf, steps?, sleepHours?, weightKg?, restingHeartRate? } | null,
  preferences: { units:'kg', theme: null, syncEnabled: false, telemetryEnabled: null, pulseEnabled: false, healthSummaryEnabled: false }
}
```

## Test on a real phone (30s checklist)

1. Open on phone (same Wi-Fi `vite --host` URL or preview deploy).
2. **Add to Home Screen** — verify standalone display, monochrome icon, splash.
3. **Airplane mode → reload** — Today + Exercises + schedule render from cache.
4. Log a session with varied loads — Progress attributes + PRs update immediately and survive reload.
5. **Export →** airplane off → **Import on a second device (Merge)** → history appears.
6. **Consent:** choose local measurement consent; verify the local event summary changes only when enabled and export contains event history.
7. **Keyboard-only:** Tab Today → Train → Exercises; focus ring visible everywhere, no trap.
8. **VoiceOver / TalkBack:** headings, session rows and form fields announced; result counts live-polite.

## Franchise note

This app shares the Le Studio monochrome design system and has no franchise, hero or “academy” branding in code. Before any serious public/commercial release, do a full copy/brand sweep (name, screenshots, store copy, icons) — if anything was franchise-adjacent under an earlier codename, rename it first.

## Project layout

```
src/lib/data.js        single source of truth + schedule helpers + programme/template versioning
src/lib/attributes.js  history-derived attributes + level
src/lib/store.js       localStorage + streak/volume + lastExerciseSets / prsHitBySession
src/lib/export.js      versioned backup
src/lib/telemetry.js   consent-gated durable events + abandonment/acceptance/logging metrics
src/lib/health.js      optional health-platform summary adapter
src/lib/pulse.js       Pulse payloads + push/pull + integration E2E helper
src/lib/schedule.js    today/next/progress + startProgram
src/lib/progression.js progression + plateau/deload + RIR/RPE + bodyweight/unilateral + readiness
src/lib/substitutions.js pattern/muscle/equipment/difficulty scoring + rankedSubstitutions
src/lib/templates.js   template engine: equipment-honest instantiation + profile recommendation + versions
src/lib/programmeGenerator.js profile → dated schedule generation with time, frequency, preference and history-aware substitutions
src/lib/backtesting.js point-in-time replay validation of recommendations against later outcomes
src/lib/longitudinal.js consent-gated prospective recommendation→outcome ledger + segmented real-world validation
src/lib/plates.js       nearest achievable barbell load + per-side plate stack
src/lib/analytics.js   weekly volume + frequency + strength series + volume-balance advice + actionable advice
src/lib/warmup.js      warm-ups + rest/duration + supersets + fatigue-aware ordering + weak points
src/lib/sessionGenerator.js equipment-aware, history-aware session builder + superset hints
src/lib/sync.js        optional cross-device sync (pluggable pull/push, offline-first)
src/components/*       Today / Train+SessionRunner(warmups/supersets/notes→next load) / Exercises / Progress(volume spark + advice) / More + Onboarding + AppShell
public/                manifest.webmanifest + sw.js + icons
scripts/lint-content.mjs  validates exercises/programs
e2e/REAL_GYM_FIELD_TESTS.md  real gym, offline, recovery and connector protocol
tsconfig.json + jsconfig.json  real type-check (noEmit)
```
