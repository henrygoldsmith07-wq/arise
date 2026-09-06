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
