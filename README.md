# Arise — Training, levelled up

A game-like, offline-first training companion. Not a nutrition app.

**Stack:** Vite + React + Tailwind v4 + `le-studio.css` design tokens. Local-first — the canonical store is **IndexedDB on your device**, no backend, no account. PWA-ready (installable, offline, shortcuts). **Progression engine** in `progression.js` + `substitutions.js`, **template engine** in `templates.js`, **analytics** in `analytics.js`, **session generator** in `sessionGenerator.js` (fatigue-aware ordering in `warmup.js`).

## Quickstart

```bash
npm install
npm run dev        # http://localhost:5173
```

Open it on your phone, **Add to Home Screen** (`docs/INSTALL.md`), and you
have a full offline training app in under a minute. First run walks you
through onboarding (goal → location → equipment → level → schedule); then
**Train → pick a program** and today's session appears on **Today**.

Full walkthrough: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) · Screenshots: [`docs/screenshots/`](docs/screenshots/README.md)

## Documentation

| | |
|---|---|
| **Using the app** | [User guide](docs/USER_GUIDE.md) · [FAQ](docs/FAQ.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Install (PWA)](docs/INSTALL.md) |
| **How it thinks** | [Methodology](docs/METHODOLOGY.md) · [Evidence tiers](docs/EVIDENCE.md) · [What Arise cannot prove](docs/CANNOT_PROVE.md) |
| **Your data** | [Data dictionary](docs/DATA_DICTIONARY.md) · [Storage schema](docs/STORAGE_SCHEMA.md) · [Import & export](docs/IMPORT_EXPORT.md) · [Backup & recovery](docs/BACKUP_RECOVERY.md) · [Sync guide](docs/SYNC_GUIDE.md) |
| **Trust** | [Privacy guide](docs/PRIVACY.md) · [Threat model](docs/THREAT_MODEL.md) · [Accessibility statement](docs/ACCESSIBILITY.md) · [Support](docs/SUPPORT.md) |
| **Project** | [Roadmap & backlog](docs/ROADMAP.md) · [Testing](docs/TESTING.md) · [Mobile testing checklist](docs/mobile-testing.md) · [Contributing](CONTRIBUTING.md) · [License (MIT)](LICENSE) |
| **Architecture** | [Architecture map](docs/architecture-map.md) · [ADRs](docs/adr/) · [Native wrapper (optional)](docs/capacitor-wrapper.md) · [Device test matrix](docs/device-test-matrix.md) |

Your training data is yours: export is always available in open formats,
and there is no account to delete. See the [privacy guide](docs/PRIVACY.md).

## What it does — in order

1. **Wires `data.js`** — single source of truth: `EQUIPMENT` / `LOCATIONS` / `MUSCLES` / `LEVELS` / `EXERCISES` + `PROGRAMS`. Every exercise declares `equipment[]` and `substitution[]`; validation is runnable (`npm run lint:content`).
2. **Exercise browser** — search + filters (muscle / equipment / level) plus an **Only my kit** toggle gated by onboarding. Always shows a substitution when kit is missing; never pretends a barbell lift is “recommended” to a bodyweight-only user.
3. **Export / restore / import** — validated, versioned, optionally encrypted backups (see [import & export](docs/IMPORT_EXPORT.md)) plus CSV and event-history export. `Merge` de-dupes by session `id` and event id; `Replace` overwrites with explicit confirmation.
4. **Programs are scheduled training** — picking a program in **Train** creates dated sessions via `scheduleProgram()`. Today shows the session for today (or up next); progress is `done/total`.
5. **Onboarding shapes recommendations** — goal + location + equipment + level/days/time + optional liked/avoided movements + barbell plate setup. `recommendExercises()` and `availablePrograms()` are deterministic and re-sort visibly when onboarding changes.
6. **Resistance / load tracking** — every logged set is `{ reps, weightKg, rpe }`. Leave weight blank for bodyweight. Session volume (`kg`) is derived live; `SessionRunner` enforces reps-filled before save.
7. **Attributes derive from history** — `deriveAttributes(history)` computes Strength / Endurance / Consistency / Technique from logged volume, loads (Epley 1RM), variety, cardio minutes, streak and logging discipline. Level is `avg/7`. Nothing derives from program labels.
8. **PWA** — `manifest.webmanifest` + `sw.js` (cache-first navigations, stale-while-revalidate assets, same-origin only), install onboarding, home-screen shortcuts, offline fallback UI. Install → airplane mode → reload keeps Today / Exercises / schedule from cache.
9. **Gym Mode** — one-thumb session runner: focus mode, large targets, swipe to complete/fail, equipment-aware load numpad, persistent rest dock.
10. **Accessibility** — landmarks, skip link, visible focus, throttled live announcements, dialog focus management, reduced motion, high-contrast/large-text modes. Statement: [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md).
11. **No nutrition system** — intentionally out of scope.
12. **Progression engine (`progression.js`)** — policy layer (conservative → aggressive → maintenance) with confidence/evidence/uncertainty on every recommendation, multi-window trends, sustained-trend deloads, plateau confidence, guardrails, and an explanation string for every decision. Methodology: [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).
13. **SessionRunner extras** — auto rest timer with sound cues/haptics/voice coach and per-exercise presets, wake lock, previous-session comparison, post-workout summary, crash-recovery draft restore.
14. **Programme template engine (`templates.js`)** — versioned blueprints over programs; `instantiateTemplate()` honestly swaps anything the user's kit can't do, with logged reasons.
15. **Volume balance advice (`analytics.js`)** — under/over-trained muscles flagged relatively with concrete rebalance suggestions.
16. **Fatigue-aware ordering (`warmup.js`)** — heavy compounds first, weak points early, same-muscle separation, cardio last.
17. **Session quality & recovery (`sessionQuality.js`)** — note signals, session quality classification, plateau attribution, deload readiness that never fires on a single-day dip, fake-PR scanning.
18. **Programme-level adaptation (`programming.js`)** — bounded, idempotent, evidence-storing changes per exposure.
19. **Long-break recovery and duplicate-safe history** — conservative restarts after a six-week gap; upsert-by-ID with newest-wins edits.
20. **Profile-to-programme generation** — `programmeGenerator.js` turns the captured profile into a dated, equipment-honest schedule with every reason and swap returned.
21. **Plate-aware loadability** — `plates.js` rounds barbell targets to your actual inventory and explains under/overshoot.
22. **Durable measurements & consent** — consent-gated local event history (logging time, abandonment, acceptance), exportable and clearable independently.
23. **Health adapters** — optional minimised health-summary adapter; no platform SDK, no raw history.
24. **Real longitudinal validation (`longitudinal.js`)** — with consent, recommendations are frozen before the workout and scored against outcomes; segment conclusions are sample-size-gated; the ledger never feeds back. See [`docs/EVIDENCE.md`](docs/EVIDENCE.md).
25. **Sync (optional)** — bring your own WebDAV storage, end-to-end encrypted: [sync guide](docs/SYNC_GUIDE.md).
26. **Before any public/commercial release — rename franchise-adjacent terminology.** The codebase is already neutral fitness language. Audit app name, copy, icon and store listing before publishing.

## Roadmap

The living plan and public backlog: [`docs/ROADMAP.md`](docs/ROADMAP.md).
(The historical tier analysis in [`docs/IMPROVEMENTS.md`](docs/IMPROVEMENTS.md)
keeps its 2026-08-14 baseline — the architecture gates are still accurate,
the "today" numbers are not.)

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
npm test           # node:test — 600+ unit/integration/property/fuzz tests
npm run benchmark  # seeded engine gates + determinism artifacts (also in CI)
npm run verify     # lint:content && type-check && test && build  (also in CI)
npm run e2e        # Playwright browser E2E (dev server)
npm run e2e:pwa    # Playwright E2E against the production build (service worker paths)
npm run screenshots # regenerate docs/screenshots/ from the real app
```

No env vars. Data is local — clear via **More → Clear local data** (export
first; see [backup & recovery](docs/BACKUP_RECOVERY.md)). Cross-device sync
is optional and user-owned (WebDAV, E2E-encrypted) — offline-first is
preserved either way.

## Test on a real phone (30s checklist)

1. Open on phone (same Wi-Fi `vite --host` URL or preview deploy).
2. **Add to Home Screen** — verify standalone display, icon, splash.
3. **Airplane mode → reload** — Today + Exercises + schedule render from cache.
4. Log a session with varied loads — Progress attributes + PRs update immediately and survive reload.
5. **Export →** airplane off → **Import on a second device (Merge)** → history appears.
6. **Consent:** choose local measurement consent; verify the local event summary changes only when enabled and export contains event history.
7. **Keyboard-only:** Tab Today → Train → Exercises; focus ring visible everywhere, no trap.
8. **VoiceOver / TalkBack:** headings, session rows and form fields announced; result counts live-polite.

The public, expanded checklist: [`docs/mobile-testing.md`](docs/mobile-testing.md).

## Franchise note

This app shares the Le Studio monochrome design system and has no franchise, hero or “academy” branding in code. Before any serious public/commercial release, do a full copy/brand sweep (name, screenshots, store copy, icons) — if anything was franchise-adjacent under an earlier codename, rename it first.

## Project layout

```
src/lib/data.js        single source of truth + schedule helpers + programme/template versioning
src/lib/attributes.js  history-derived attributes + level
src/lib/storage.js     IndexedDB persistence + integrity gate + snapshots + recovery
src/lib/idb.js         IndexedDB wrapper (14 object stores, transactional writes)
src/lib/export.js      versioned backup (+ exportPolicy.js: contract, adapters, dangerous-field policy)
src/lib/telemetry.js   consent-gated durable events + abandonment/acceptance/logging metrics
src/lib/health.js      optional health-platform summary adapter
src/lib/pulse.js       Pulse payloads + push/pull + integration E2E helper
src/lib/schedule.js    today/next/progress + startProgram
src/lib/progression.js progression + plateau/deload + RIR/RPE + bodyweight/unilateral + readiness (+ progressionPolicies.js)
src/lib/substitutions.js pattern/muscle/equipment/difficulty scoring + rankedSubstitutions
src/lib/templates.js   template engine: equipment-honest instantiation + profile recommendation + versions
src/lib/programmeGenerator.js profile → dated schedule generation with preference- and history-aware substitutions
src/lib/backtesting.js point-in-time replay validation of recommendations against later outcomes
src/lib/longitudinal.js consent-gated prospective recommendation→outcome ledger + segmented validation (+ longitudinalCore.js)
src/lib/plates.js      nearest achievable barbell load + per-side plate stack
src/lib/analytics.js   weekly volume + frequency + strength series + volume-balance advice
src/lib/warmup.js      warm-ups + rest/duration + supersets + fatigue-aware ordering + weak points
src/lib/sessionGenerator.js equipment-aware, history-aware session builder + superset hints
src/lib/sync.js + syncEngine.js + webdav.js  optional cross-device sync over user-owned WebDAV
src/components/*       Today / Train+SessionRunner(Gym Mode) / Exercises / Progress / More + Onboarding + AppShell
public/                manifest.webmanifest + sw.js + icons + splashes
scripts/lint-content.mjs  validates exercises/programs
scripts/screenshots.mjs   regenerates docs/screenshots/ from the real app
e2e/REAL_GYM_FIELD_TESTS.md  real gym, offline, recovery and connector protocol
tsconfig.json + jsconfig.json  real type-check (noEmit)
```
