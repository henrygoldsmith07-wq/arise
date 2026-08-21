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
