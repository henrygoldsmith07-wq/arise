# Arise real-gym field test protocol

Run this protocol with consenting testers in a normal gym, using at least one
iOS device and one Android device. Record device, browser, connection state,
kit profile and whether a Pulse/health adapter was enabled. Do not collect
names, raw health records or exported files outside the test owner’s storage.

## Scenarios

1. **Fast logging** — start a scheduled workout, edit the prefilled reps/load,
   tap `Done` for ten sets, use the automatic rest timer, then export event
   history. Record median and p90 set logging time from `set:complete` events.
2. **Recovery** — complete at least one set, refresh during rest, close/reopen
   the tab, and simulate an interrupted session. Confirm the recovery card,
   completed set count, edited values and timer expiry are correct.
3. **Abandonment** — start, complete 0/25/50% of a workout, cancel, and repeat
   after a resume. Confirm `session:abandon` contains the session id, elapsed
   time and completed-set count.
4. **Recommendation choice** — view a suggested target, accept it once and
   manually edit it once. Confirm one `recommendation:shown`, one accepted and
   one dismissed event per decision path.
5. **Substitution** — run with a restricted kit, swap an exercise, complete it,
   and export. Confirm the saved block contains the replacement and rationale.
6. **Data portability** — export a full JSON backup, clear a test profile,
   import with Merge and Replace, and confirm sessions, event history, schema
   migration and optional health summary behaviour.
7. **Pulse E2E** — run the mock/staging adapter through
   `runPulseIntegrationE2E()`. Confirm workout and volume writes, metric pull,
   partial failure reporting and no calls when Pulse consent is disabled.
8. **Offline gym path** — enable airplane mode after the app is cached, log a
   workout, recover after reload, and verify no UI action blocks on network.

## Acceptance record

| Field | Result |
|---|---|
| Device / OS / browser | |
| Connection / gym location | |
| Equipment profile | |
| Median set logging time | |
| P90 set logging time | |
| Abandonment count / denominator | |
| Recommendation acceptance rate | |
| Refresh/crash recovery | pass / fail |
| Import/export round trip | pass / fail |
| Pulse E2E | pass / fail / not configured |
| Health summary consent/revoke | pass / fail / not configured |
| Issues and follow-up | |

## Flagship benchmark: real-world longitudinal study

Simulated corpora only validate harness mechanics. The evidence that matters
comes from consented participants running the app for 8-16 weeks.

Protocol:
1. Participant enables local measurements (More -> Privacy & data).
2. After each week (or at study end) they export a backup (More -> Export)
   and share the JSON under an anonymous filename.
3. Collect packages in `benchmark/field/` (git-ignored directory).
4. Run `npm run benchmark:field -- --min-participants=N --min-transitions=M`.

The runner validates every package through the import layer, resolves ledger
outcomes, replays arise vs double/linear/flat baselines point-in-time per
participant, pools transitions, and writes `benchmark/results.field.md`.

Measurements collected: recommendation acceptance, target achievement,
progression success/regression/stagnation, adherence + missed sessions,
workout completion, deload outcomes (cut applied / normalised), plateau
false-positive rate, load & rep recommendation error, logging time, and
programme changes overridden by users.

The headline sentence is printed ONLY when participant and transition gates
pass; below them the report says so plainly. Exit code 2 signals insufficient
evidence so CI cannot mistake absence of data for success.
