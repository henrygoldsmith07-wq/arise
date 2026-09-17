# Release notes

User-facing notes for each released version. Newest first. Written for the
person training with the app: what changed for them, in their words, not a
commit log.

## Process (maintainers)

1. Pick the version: **major** for a breaking data-contract change, **minor**
   for features, **patch** for fixes. The app's data contract is versioned
   separately (`exportPolicy.js`); a contract bump always needs a minor or
   major release and a line under *Data* below.
2. Copy the `Unreleased` section from `CHANGELOG.md` into a new section here,
   translated into user language. Keep it honest: "fewer redundant warnings"
   not "optimised heuristics".
3. Include a *Data* line whenever storage, export, sync or migrations
   changed — that is the line people actually scan for before updating.
4. Bump `version` in `package.json` (this feeds `__ARISE_APP_VERSION__` at
   build time, the support bundle, and the release tag). Bump `CACHE` in
   `public/sw.js` if any precached asset changed.
5. Tag `vX.Y.Z` on the merge commit; the tag message should equal the release
   notes summary.

## Unreleased

**Study & evidence**

- The real-user study is now operationally complete: join from More →
  Progression evidence, export weekly, and your contribution folds into one
  pseudonymous participant — repeated exports never create duplicate people.
- Withdrawing from the study stops study assignments on new workouts but
  keeps everything you already logged. Deleting that data remains a separate
  action you must perform explicitly.
- Study onboarding now states eligibility, plain-language consent, current
  status, participation and export instructions, and exactly what happens to
  previously collected observations when you leave.
- Cohort-operations and product-success reporting (for study operators, via
  `npm run study:report`): enrollment, activity, withdrawals, arm balance,
  missing observations, data-quality warnings and analysis-gate eligibility;
  product metrics (retention, adherence, acceptance, mode usage) from
  consented exports only, always with sample sizes. Treatments are never
  ranked until the prespecified participant/session gates are met.
- Example reports, committed: `npm run study:report:fixture` regenerates
  `benchmark/fixtures/study-ops-report.md` + `product-success.md` from a
  deterministic synthetic cohort through the real ingestion path (bannered as
  synthetic examples, pinned date, byte-stable); CI keeps them in sync with
  the pipeline via `--check`, and the harness refuses to overwrite real
  reports.

**Docs**

- Roadmap, product strategy and testing docs updated to match the shipped
  product (template editing is in the app, not "file-level today"); hosted
  Google-account sync explicitly rejected as incompatible with the
  local-first charter.

**Known issues** — see `docs/KNOWN_ISSUES.md`.

## 0.1.0 — initial public release

**Training**

- Guided workout mode with session timers, voice coach, audio cues and rest
  presets; a separate standard runner with Gym Mode (focus mode, swipe
  logging, load keypad).
- A progression engine with policy choice (conservative, standard,
  aggressive, maintenance), confidence scores, explanations, guardrails and
  deload handling.
- Substitution suggestions with reasons, alternatives grouped by need
  (joint-friendly, bodyweight, machine, …), and a 324-exercise library with
  how-to notes and classification chips.

**Insights**

- Progress view: PRs with context, trends with confidence bands, weekly
  volume, adherence, milestones, training age, monthly digest and a weekly
  review.
- Evidence dashboards for recommendation accuracy, adherence and calibration
  — including what the app cannot honestly claim (see `docs/CANNOT_PROVE.md`).

**Safety**

- Pain trends, volume/load jump warnings, implausible-PR checks, recovery
  deficit and fatigue detection, deload prompts and conservative restart
  advice after breaks or illness. Cautious mode lowers all thresholds.

**Data**

- Everything stored locally in IndexedDB with transactional writes,
  boot-time integrity repair, quarantine, automatic snapshots and one-click
  rollback. Exports: full, encrypted, partial, CSV, coach summary.
- Optional WebDAV sync (user-provided storage, optional end-to-end
  encryption). No Arise server exists; no account is required.
- Privacy: telemetry strictly opt-in, health-summary consent isolated, no
  third-party trackers. See `docs/PRIVACY.md`.

**Known issues** — see `docs/KNOWN_ISSUES.md`.
