# Arise — point-in-time backtest smoke result

This is a deterministic **synthetic** fixture result, not real training
validation. It exists to make the replay contract and metric shape reviewable;
replace it with a consented export before making claims about actual users.

Fixture: `benchmark/fixtures/synthetic-history.json`
Command: `npm run benchmark:backtest`
Replay: future sessions and same-date readiness entries are excluded from each
recommendation input.

| Metric | Result |
|---|---:|
| Comparisons | 8 |
| Load MAE | 0.625 kg |
| Rep MAE | 1.125 reps |
| Completion Brier score | 0.240 |
| Plateau classification accuracy | 0% |
| Fatigue classification Brier score | 0.257 |
| Observed volume cuts evaluable | 0 |
| Missed-session recovery sequence adherence | 0% |
| Empirical replacement estimates | 3 |

The low/empty metrics are retained rather than smoothed or replaced with a
claim. They show why this fixture is a regression smoke test, not evidence that
the progression policy is valid in real training.
