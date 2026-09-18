# Running the pilot — operator guide

You are the study operator. Your job is to keep participants participating and the data trustworthy — **not** to interpret results. This page is the weekly loop.

## The freeze rule

> **Study-system changes now require either a correctness bug, a privacy issue, a data-loss risk, or evidence from actual pilot participants.**

The architecture is frozen. No readiness logic, evidence predicates, randomisation, arms, progression, cohort gates, or causal-analysis changes during the pilot. Operational warnings are operational — they never trigger product changes by themselves. Only pilot-participant evidence (a real blocker, a real failure mode) or a correctness/privacy/data-loss bug reopens study code.

## Participants get

- **`docs/PARTICIPANT_GUIDE.md`** — send or print this. It covers eligibility, consent, what stays local, exporting, and withdrawing. It deliberately does not coach anyone to train differently.

## The weekly loop

1. **Collect exports.** Participants send the file produced by the study card's **Export study data** button (`arise-study-<date>.json`; weekly is ideal; the app folds repeats automatically). Drop every file into one directory, e.g. `field/`. A generic `.arise` backup is NOT the study contribution — if one arrives, ask the participant to use the study card's button instead (ingestion may still accept it, but it carries personal fields the study file deliberately omits).
2. **Run the pilot report:**

   ```bash
   npm run pilot:report -- field/
   ```

   This writes `pilot-report.md` next to the directory and prints the headline. For a pinned "today" (tests/CI): `node scripts/pilot-report.mjs field/ --now=2026-04-03T00:00:00Z`.
3. **Read it in this order:**
   - **Pilot pulse** — retention, workouts/week, completion, friction, acceptance/override, valid transitions. Every rate carries n and missingness.
   - **Participant roster** — one row per participant: status, last export age, sessions, arm split, unresolved starts, warnings.
   - **Participants needing attention** — enrolled people with no export in 21 days (or none ever). This is your nudge list.
   - **Study-gate progress** — how far the cohort is from the canonical gates. Until it says *Gates met*, **no treatment comparison exists anywhere in the pipeline.**
   - **Data quality** — ingest warnings: import errors, duplicate files (byte-identical repeats, folded), conflicting records, malformed IDs, version mismatches, impossible arm changes. Conflicts are disclosed, never auto-resolved — contact the participant only if a conflict looks like a real-world discrepancy rather than a double export.
4. **Act on people, not numbers.** Nudge stale exporters, ask consent-lost participants to re-enable measurement, flag repeated conflicts. That is the whole operational job.

## Health warnings (what each means)

| Warning | Meaning |
|---|---|
| `stale-export-Nd` / `missing-export-timestamp` | Enrolled, but no export in N days (21d threshold) — or a file arrived without a usable export timestamp. There is no enrollment registry, so a true never-exporter (someone who joined but never sent anything) is invisible to this tooling; the flag covers stamp-less files only. |
| `no-workouts` | Enrolled with zero logged sessions. |
| `consent-lost` | Joined the study, then turned local measurements off — evidence stops until re-consent. |
| `conflicting-records` / `import-error` | One of their files disagreed with a prior export or failed validation — see data quality. |
| `single-arm-evidence` | ≥8 valid transitions all from one arm; worth an operator look, not a bug report. |
| `high-abandonment-Npct` | >50% of ≥4 terminal workouts abandoned (terminal = completed + explicitly abandoned; unresolved starts never satisfy the volume floor). |
| `override-heavy-Npct` | >50% of ≥8 resolved recommendations overridden. |
| `logging-time-outlier` | Median logging time >2× the cohort median with ≥5 timing events — friction is creeping up for them. |

None of these change product behaviour. They are the pilot's early-warning system.

## Privacy

The report is keyed by pseudonymous participant codes. Keep the exports directory and the generated report out of public repos and shared drives; treat them like the private operational data they are.

## Reporting upward

The weekly artefacts are `pilot-report.md` plus the study-ops and product-success reports it appends. If a participant reveals a **blocking** problem in actual use, that — not a metric dip — is the trigger to revisit code under the freeze rule above.
