# Arise — what it calculates, what it knows, and what it doesn't

This document states plainly what each layer of Arise produces, what
evidence supports it, and what has only been simulated. Read it before
trusting any number in the app.

## Evidence tiers

| Tier | Meaning | Examples |
|---|---|---|
| **Calculated** | Deterministic arithmetic over your logged data. Correct by construction; test-covered. | e1RM, weekly volume, adherence counts, readiness averages, estimated session minutes |
| **Engine decision** | Deterministic policy applied to your history (progression.js + priors). Reproducible: same inputs → same output, with a stated reason. | next load/reps, plateau holds, deload triggers, substitutions, weekly directives |
| **Simulated** | Outcomes computed on synthetic corpora to validate harness mechanics. Never external evidence. | backtest.js, benchmark/study.js comparative replay, fixture field-study runs |
| **Observed (yours)** | Your own prospective ledger: recommendations frozen before each workout, scored against what you actually did. Valid for you; sample sizes shown honestly. | evaluation ledger, byArm rates, paired win counts |
| **Validated externally** | Nothing yet. The prospective five-arm field study exists precisely to produce this — until enough consented participants accumulate real transitions, no superiority claim is made. | — |

## What the progression engine uses (inputs)

Only information available **before** the workout being prescribed:

- logged sets (reps / load / RPE / failures) per exercise;
- readiness entries dated at or before the session;
- schedule state (missed sessions, week number);
- declared equipment and exercise metadata.

Readiness timestamps after a session cannot classify it. Rep-range segments
are defined by strictly prior exposures. Baseline arms in the study receive
the identical prior-only slice.

## What is deliberately NOT claimed

- Muscle growth is not measurable from training logs; no outcome here
  pretends otherwise.
- **The retrospective replay cannot prove causation.** Scoring five arms'
  prescriptions against one realised stream of training measures agreement
  and prescription error — the outcome was generated under whatever policy
  the lifter actually followed. Causal claims belong to the prospective
  exercise-level randomised design (`STUDY_DESIGN` in study.js), frozen
  before any efficacy look.
- "No significant difference vs double progression" is not equivalence.
- Transitions are not independent observations: uncertainty in pooled
  analyses comes from participant-clustered bootstrap
  (`clusteredBootstrapWinRate` in longitudinal.js — deterministic,
  participant-level resampling), and participant counts are reported beside
  transition counts everywhere.
- Subgroup slices (by equipment, rep range, frequency, readiness) are
  marked exploratory — they generate hypotheses, they do not confirm them.
- Aggressive prescribing earns nothing: a frozen prescription more than
  10% above previous load that misses its target counts as an overshoot,
  never as progress.
- The AI coach explains engine decisions from engine findings. It cannot
  change programming; overrides are captured as user-decided transitions.

## Where the numbers live

- Retrospective replay: `benchmark/study.js` (five arms, synthetic corpus).
- Prospective ledger: on-device `arise.evaluation.v1` storage, exported in
  backups, pooled in the field-study report under "Ledger arm:" rows.
- Study protocol: frozen via `buildStudyProtocol()` and printed into every
  field report — policy version, arms, inclusion criteria, outcomes,
  statistics rules.
