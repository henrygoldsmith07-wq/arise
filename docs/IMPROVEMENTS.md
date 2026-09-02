# Arise — improvements roadmap

Sixteen requested improvements, sorted by what the current architecture can
actually ship. Arise today is local-first: Vite + React, `localStorage`, no
backend, no account, PWA-only. Six of the sixteen asks cannot be built without
breaking one of those constraints — that gate is applied first, before priority.

## Baseline (measured 2026-08-14)

| Thing | Today |
|-------|-------|
| Exercise library | **39** exercises, 9 muscles, 9 equipment types |
| Programs | **3** |
| Engine | `progression.js` 283 lines, `analytics.js` 143, `substitutions.js` 67 |
| UI | 8 components, 997 lines total |
| Bundle | ~268K (`docs/perf.md`) |
| Rest timer | Exists, **manual start** (`SessionRunner.jsx:125` — tap "Rest") |
| Substitutions | `rankedSubstitutions()` exists but is **only** called by `sessionGenerator.js`; not reachable mid-session |
| Progression models | `PROGRESSION_STRATEGY` (strength/hypertrophy/endurance) with an 11-exercise hardcoded map + regex fallback |
| Plate calculator | None |
| Strength standards | None |
| Videos, wearables, Health sync, watch app, marketplace, coach sharing | None |

## The architecture gate

| Tier | Constraint | Asks in this tier |
|------|------------|-------------------|
| **A — ships as-is** | Pure local, no new platform | Library size, progression models, substitution speed, auto rest timer, plate calculator, history visualisation, strength standards, plateau/deload validation, volume response |
| **B — needs a native shell** | Capacitor or native wrapper; kills "PWA-only" | Apple Health / Health Connect, watch interface, most wearables |
| **C — needs a backend** | Server + accounts; kills "no account, you own the file" | Programme marketplace, coach sharing |

Tier A is 10 of 16 and is where the session-by-session experience actually
improves. Tiers B and C are product decisions, not backlog items — each one
trades away a property the README currently sells.

---

## P0 — Session speed (Tier A, ~1 week total)

These three are the "better session logging speed" ask, decomposed. Every one
is local, small, and removes taps from the set-logging loop.

### 1. Automatic rest timer — **S**

The timer exists; it just doesn't start itself. Today the user saves a set,
then taps `Rest {time}` as a second action.

- Start the countdown automatically when a set's reps field is committed.
- Keep the manual button as an override, keep Skip.
- Preference: `preferences.autoRest: true` (default on), so the current
  behaviour is still reachable.
- Edge case worth handling: don't auto-start on the last set of the last block.

**Files:** `SessionRunner.jsx` (`startRest`, the reps `onChange` commit),
`store.js` migration for the new preference.

### 2. Faster exercise substitution — **M** — *shipped*

`SessionRunner` has a per-block Swap sheet backed by `substitutionOptions()`;
it honours liked/disliked movements and refuses a swap back to the original
lift. This entry is kept for the record.


`rankedSubstitutions(targetId, availableEquipment, limit, history)` already
scores by pattern, muscle, equipment and difficulty — and already accepts
history. It's dead code outside session generation.

- Add a "Swap" affordance per block in `SessionRunner`.
- Show top 4 ranked alternatives with the reason (`same pattern, your kit`).
- Swap in place for this session only; do not mutate `activeSchedule`.
- Carry the previous exercise's load hint across via `e1rm` equivalence rather
  than starting the user at zero.

**Files:** `SessionRunner.jsx`, `substitutions.js` (expose reason strings).

### 3. Plate calculator — **S**

Nothing exists today. Scope it tightly:

- Input: target load + bar weight (20kg/15kg/none) + available plate set.
- Output: per-side plate stack, plus the nearest achievable load when the
  target isn't loadable.
- That last part matters more than the arithmetic — `recommendNext()` currently
  returns loads no plate set can make. Feed the rounding back into the
  recommendation so "next: 62.5kg" only appears when 62.5kg is loadable.
- Plate inventory belongs in onboarding equipment, not a separate settings page.

**Files:** new `src/lib/plates.js` (pure, testable), `SessionRunner.jsx`,
`progression.js` (round recommendations through it), `Onboarding.jsx`.

---

## P1 — Content depth (Tier A, ~2–3 weeks)

### 4. Significantly larger exercise library — **L**

39 → target **150–200**. The constraint is not authoring, it's the invariant
that every exercise declares `equipment[]` **and** a valid `substitution[]`
chain — `npm run lint:content` enforces it, and a bulk import will break it.

Sequence:
1. Extend `lint:content` first: assert substitution reciprocity, assert every
   `(muscle, equipment)` pair has at least one exercise at each level.
2. Expand by coverage gap, not by count — the browser's "Only my kit" toggle is
   worthless if bodyweight-only users still hit dead ends.
3. Keep `data.js` under 500 lines by splitting to `data/exercises/*.js` per
   muscle group, re-exported from `data.js`. It's at 420 now; 200 exercises
   will not fit.

**Risk:** every new exercise needs a `progression` strategy and `rom` cues, or
it degrades `strategyForExercise()`'s regex fallback into guessing.

### 5. Exercise-specific progression models — **M**

`STRATEGY_BY_EXERCISE` hardcodes 11 ids and regex-guesses the rest. With 200
exercises the regex is the primary path, which is wrong.

- Move `progression: 'strength' | 'hypertrophy' | 'endurance'` onto the
  exercise record in `data.js` (the field name already exists in the schema).
- Make `lint:content` require it.
- Delete the regex fallback once coverage is 100% — keeping it hides gaps.
- Then add per-model load increments that respect the plate calculator (P0 #3):
  a 2.5% increment on a 20kg dumbbell press is unloadable.

### 6. Better strength standards — **M**

Needs a decision before code: **where does the reference data come from?**
Published standards (ExRx, Strength Level) are licensed datasets, not free
inputs. Options, in order of preference:

1. Derive percentiles from the user's own logged history (honest, no licensing,
   works offline, but says nothing on day one).
2. Ship a small hand-built table for the ~15 main lifts as bodyweight multiples
   with the source cited, and label it clearly as approximate.
3. License a dataset — cost + attribution obligations + kills offline-first if
   it's an API.

Recommendation: **2 + 1** — a bodyweight-multiple table for main lifts,
progressively replaced by the user's own distribution as history accumulates.
Standards must be sex/bodyweight/age-adjusted or they are misinformation; if
onboarding doesn't collect bodyweight, this ask can't be done accurately.

### 7. High-quality technique videos — **L**, blocked on a hosting decision

This one directly fights the PWA. 200 exercises × even a 300KB silent WebM loop
is ~60MB — against a 268KB bundle and a service worker that caches for airplane
mode. Three routes:

| Route | Offline | Cost | Verdict |
|-------|---------|------|---------|
| Bundle all | Yes | Bundle 200× | Not viable |
| Link out (YouTube) | No | Free | Cheap, but breaks the offline promise and hands the user to an ad feed mid-set |
| CDN + opt-in per-exercise cache | Partial | Hosting + production | **Recommended** |

Recommended shape: short silent loops (3–5s, AV1/WebM, ≤200KB), lazy-loaded,
with a "save for offline" toggle per exercise that writes to the Cache API.
Static `rom` cue text stays the offline fallback and ships first — it's already
in the schema and costs nothing.

**Production cost is the real blocker**, not engineering. 200 filmed exercises
is a content project, not a sprint.

---

## P2 — Make the engine honest (Tier A, ~1–2 weeks)

The engine already makes claims; almost none are validated against real logs.

### 8. Validate plateau/deload rules — **M**

`validateProgression()` back-tests load prediction only. `isPlateauV2()` and
`shouldDeload()` — the two functions that tell a user to cut 40% of their load —
have no validation at all.

- Back-test both over history: when the rule fired, did performance actually
  recover faster than when it didn't?
- Report precision/recall, not a pass/fail. A deload rule that fires on every
  bad night's sleep is worse than none.
- Surface the numbers in More → diagnostics so the rule is falsifiable.
- Add fixture histories to `tests/progression.test.js` covering: true plateau,
  noise-only flat spell, deliberate deload week, missed sessions.

**This should precede any further tuning of the constants.** They're currently
unfalsifiable.

### 9. Learn response to volume — **L**

`personalisedRate()` learns a per-exercise load trend. It doesn't relate that
trend to *volume* — the actual question ("do I grow faster at 12 or 18 sets a
week for this muscle?").

- Per muscle group, regress weekly e1RM change on weekly set count.
- Require a real sample bar (≥8 weeks, ≥2 distinct volume levels) and return
  `null` below it — the existing `null`-below-threshold pattern in
  `personalisedRate()` is the right precedent.
- Output a confidence band, never a point estimate. n=10 weeks of noisy home
  training does not support "your MEV is 9 sets."
- Feed into `volumeLandmarks()`, which currently uses population defaults.

**Risk:** this is the easiest place in the app to produce confident nonsense.
Ship it behind the same uncertainty treatment as
`strengthTrendWithConfidence()`.

### 10. Better history visualisation — **M** — *shipped*

Shipped as `src/lib/charts.js` (pure geometry, `tests/charts.test.js`) plus
`src/components/Charts.jsx` (inline SVG, no library):

- **Per-lift e1RM sparkline** with the confidence band *drawn* — ±1.96 residual
  standard errors around the fitted line, never below the engine's own
  three-point floor, and labelled as the spread of logged sessions rather than
  a forecast.
- **Weekly sets by muscle** as a stacked bar; muscles in the `high` landmark
  band carry a hairline outline (context, not a warning colour).
- **Planned vs completed** as an adherence strip — filled done, hollow missed,
  dashed upcoming. A future session is never counted as missed.

Charts paint with `currentColor` so OS theme needs no second palette, nothing
animates (`prefers-reduced-motion` is already clamped globally in
`le-studio.css`), and every model returns a `summary` used as the SVG's
accessible name and repeated as visible text.


`ProgressView` already computes `weeklyVolume`, `volumeDistribution`,
`strengthSeriesWithConfidence`, `plannedVsCompletedStats` — 183 lines rendering
mostly numbers.

- Per-lift e1RM sparkline with the confidence band drawn, not described.
- Weekly volume by muscle as a stacked bar; highlight landmark breaches.
- Planned-vs-completed as an adherence strip.
- Inline SVG only — no chart library. It would multiply the bundle for four
  chart types, and the design system already has the tokens.
- Must respect `prefers-reduced-motion` and OS theme, and carry text
  equivalents for screen readers (the a11y bar in this repo is already set).

---

## Tier B — needs a native shell

**None of these are possible in a PWA.** They require Capacitor or a native
app, an Apple Developer account, and app-store review — a different release
model from the current "deploy static, install from browser."

### 11. Apple Health / Health Connect — **XL**

HealthKit has no web API. Health Connect is an Android platform API. Neither is
reachable from Safari or Chrome. A Capacitor shell with
`@capacitor-community/health` (or platform plugins) is the only route.

Worth noting: the write direction (Arise → Health) is the easy, valuable half —
publishing completed workouts, volume and duration. The read direction (weight,
HR, sleep → readiness) is where the permission burden and privacy exposure
live. `readinessScore()` currently takes manual sleep/soreness/motivation
inputs and would take real data — that's the strongest argument for doing this.

### 12. Wearable integration — **L–XL**

Split by device class:

- **Heart-rate straps / some watches:** Web Bluetooth GATT Heart Rate Service
  works in Chrome on Android and desktop today — **no native shell needed**.
  Safari and iOS do not support Web Bluetooth at all, so this is Android-only.
- **Garmin / Whoop / Oura:** vendor cloud APIs, OAuth, a backend to hold tokens.
  That's Tier C as well as Tier B.
- **Apple Watch:** goes through HealthKit (see #11).

Recommendation: if wearables matter, ship Web Bluetooth HR first. It's real,
scoped, and needs no platform change — it just doesn't exist on iOS.

### 13. Watch interface — **XL**

watchOS and Wear OS both require native apps in their own toolchains. There is
no web path. This is the single largest item on the list and should not be
started before #11 establishes the native shell and the sync model.

If the goal is "log a set without pulling the phone out," a phone-side
large-touch-target session mode is 5% of the cost and covers most of it.

---

## Tier C — needs a backend

Both asks below trade away "no backend, no account, the user owns the file."
That's the README's stated position, so these are product decisions.

### 14. Programme marketplace / templates — **L** (with backend), **M** (without)

The cheap version needs no server: programs are data. Ship
**import/export of a program as JSON** over the existing versioned backup
format, and a curated in-repo set beyond the current 3. Users share files or
links; no accounts, no moderation, no hosting.

The full marketplace — browse, rate, publish — needs a backend, content
moderation, and someone to own abuse handling. Do the file version first and
see whether demand is real.

### 15. Optional coach sharing — **L**

Same shape. The minimum is a **read-only export** the user hands to a coach —
the versioned JSON already exists; it needs a rendered view rather than a raw
file. Live sharing (coach sees sessions as they're logged, writes back
programming) needs accounts, auth, and a permission model, plus a privacy
policy covering health data shared with a third party.

Recommendation: read-only shareable export first. Explicit, revocable,
user-initiated, no server.

---

## Suggested order

1. **P0** — auto rest timer, in-session substitution, plate calculator. One
   week, no architecture change, directly answers "logging is slow."
2. **P2 #8** — validate plateau/deload before tuning anything else. The rules
   currently make unfalsifiable claims.
3. **P1 #4 + #5** — library expansion with progression models as a hard lint
   requirement, split `data.js` before it grows.
4. **P2 #10** — history visualisation. Everything it needs is already computed.
5. **P1 #6** — strength standards, once bodyweight is collected.
6. **P2 #9** — volume response, once the library is broad enough to generate
   varied volume.
7. **Tier B/C** — only after an explicit decision to give up PWA-only or
   backend-free. Cheapest useful slices first: Web Bluetooth HR (Android),
   program JSON import/export, read-only coach export.
8. **P1 #7** — videos, gated on the hosting decision and content budget.

## Decisions needed before starting

- **Bodyweight in onboarding?** Blocks strength standards (#6).
- **Native shell — yes or no?** Blocks #11, #13, and half of #12. Also ends
  "install from the browser, no store."
- **Backend — yes or no?** Blocks the full versions of #14 and #15.
- **Video budget?** #7 is a production cost, not an engineering one.
- **Does the "no franchise branding" sweep in the README happen before any
  store submission?** Tier B forces that question.
