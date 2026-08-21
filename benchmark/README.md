# Arise progression benchmarks

`src/lib/backtesting.js` replays history in chronological order. For every
exercise exposure it hides the current and future sessions, filters readiness to
entries already visible before that date, calls the same deterministic
`recommendNext` rule, and only then scores the next observed performance.
Logged outcome blocks never supply their own rep prescription; the replay uses a
known schedule block when one is supplied, otherwise the configured default
range.

The previously scattered manual choices are listed in the versioned
`src/lib/priors.js` object: strategy/range/rate defaults, training-age bands,
plateau and load-rounding gates, session-quality score weights, recovery/deload
signals, missed-session spacing, and backtest sample/tolerance thresholds.
`resolveArisePriors()` accepts explicit overrides for experiments. During a
replay, an empirical completion probability or progression rate can replace its
prior only after `minimumStratumSamples` comparable prior observations; sparse
strata retain the prior and expose `source: "prior"` in the observation.

The backtester reports:

- load and rep error, hit rate, and progression-action timing;
- progression validation: successful vs failed progression rates, regression
  following a progression, stagnation, and unnecessary conservatism — broken
  down by exercise, training age, rep range, movement type, equipment and
  consistency strata;
- noisy-session handling: how often noisy context (short session, long gap,
  kit/order change, missed sets, pain) results in a conservative hold rather
  than an overreaction to one bad day;
- completion-probability Brier/log loss and calibration bins;
- plateau classification against later progression/recovery outcomes;
- fatigue/bad-session classification against the next session;
- deload decisions against observed volume cuts, explicitly labelled as
  behaviour/adherence outcomes rather than physiological truth (a single bad
  workout never triggers a deload alone — two or more independent signals are
  required);
- missed-session recovery sequence adherence when a schedule with stable IDs is
  provided; and
- strata by exercise, available-history band, training age, equipment,
  consistency, rep range, and movement type.

## Dataset format

Use a JSON object with `formatVersion: 1`, `kind: "real-history"` or
`"synthetic"`, and a `history` array. Each history item has a `dateISO` and
`blocks`; each block has an `exerciseId` and `sets`. Optional fields are:

- `readinessLog`: `{ dateISO, score }` entries;
- `profile.availableEquipment`: the equipment known for the user;
- `profileHistory`: optional dated equipment snapshots; only snapshots before
  the replay point are visible;
- `schedule.sessions`: planned sessions with stable `id` and `dateISO`;
- `scheduleSessionId` on a completed history item when its log ID differs from
  the planned session ID; and
- `metadata` for provenance and consent information.

`benchmark/fixtures/real-history.example.json` is intentionally empty. Replace
it with a consented export before running a real benchmark. Do not fill it with
invented training data and do not describe a real benchmark as validated unless
the export has actually been evaluated.

`benchmark/fixtures/synthetic-history.json` is a labelled deterministic smoke
fixture. It is useful for regression tests only and is never evidence about real
training outcomes.

## Real-world validation

`benchmark/real-world.js` (`npm run benchmark:realworld`) runs the full
real-world battery from `src/lib/realWorldValidation.js`:

- **Collecting histories** — a portable app export is converted to a benchmark
  dataset with `datasetFromPortableExport()`. Consent is explicit: without
  `--consent` the metadata records no consent and the run is structural only.
- **Prediction vs performance** — every comparison row gets exactly one outcome
  class: success (progressed and met the prescription), failure (progressed but
  missed it), stagnation (flat vs previous exposure), regression (below it).
  First exposures stay unknown rather than guessed.
- **Noisy-session detection** — the fatigue forecast is graded with
  precision/recall/specificity plus Brier, so a detector that never fires
  cannot hide behind accuracy alone.
- **Substitution quality** — two views: engine-proposed substitute pairs are
  audited for muscle/pattern preservation and progression alignment against
  co-logged history; with a schedule, observed swap events are matched against
  the displaced planned work directly.
- **Load rounding** — recommendations are checked against the versioned
  rounding-grid bands in priors, against plate stacks via
  `nearestLoadToPlates` (barbell profiles only), and against the load the
  lifter actually used next session.
- **Longitudinal effectiveness** — ~28-day cycle comparison, per-exercise
  first-to-last e1RM trend, weekly adherence vs plan, and a deliberately
  coarse verdict (`insufficient-history` until exercises can be classified).

```bash
npm run benchmark:realworld                                # empty example fixture
node benchmark/real-world.js export.json --consent --write # consented real export
```

A run may be described as validated only when the input was a consented real
export (`metadata.consent: true`) with replay status `calibrated`. Synthetic
or unconsented runs are smoke tests regardless of how good the numbers look.
