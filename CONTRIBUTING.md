# Contributing to Arise

Thanks for helping. Arise is small on purpose: local-first, no backend, no
account, and an evidence posture that refuses to overclaim. These rules keep
it that way.

## Ground rules

1. **Local-first is not negotiable.** The app must work fully offline, with
   no account, forever. Anything that needs a server goes behind an explicit
   user-provided adapter (see WebDAV sync) — never a hosted default.
2. **Prior-only decisions.** No recommendation may ever see data from after
   the workout it prescribes. `tests/` contains leak-detector tests; they
   fail the PR, no exceptions.
3. **The evaluation ledger never feeds back.** Evidence, metrics and
   dashboards read the ledger; the engine must not.
4. **Every engine decision explains itself.** If you change progression,
   substitution or programming logic, the explanation strings travel with
   the change.
5. **No new runtime dependencies** without a written reason in the PR —
   the budget gate (190 kB boot) and the license allowlist both have to agree.

## The verify pipeline (all of it runs in CI)

```bash
npm run verify        # lint:content + type-check + unit tests + build
npm run format:check  # LF, no tabs, no trailing whitespace, final newline
npm run license:check # production deps stay on the allowlist
npm run bundle:budget # boot 190 kB / lazy 45 kB / total 300 kB gz
npm run benchmark     # engine gates + artifact comparator (re-baseline consciously)
npm run e2e           # Playwright, dev server
npm run e2e:pwa       # Playwright, production build (service worker paths)
```

Formatting fixes are mechanical: `npm run format:fix`.

## How to work

- **Branches:** short-lived `feat/…`, `fix/…`, `docs/…`, `ci/…` off `main`;
  squash-merged with a conventional-commit subject (`feat:`, `fix:`,
  `test:`, `docs:`, `perf:`, `refactor:`, `ci:`) — the release notes are
  generated from these subjects.
- **Commits:** one intent per commit; the subject completes
  "this commit will …".
- **Tests travel with the change.** Pure logic gets `node:test` unit tests;
  user journeys get Playwright specs. If you fix a bug, the regression test
  comes in the same PR.
- **Docs are code.** A user-facing behaviour change updates the relevant
  guide in `docs/` in the same PR.
- **ADRs:** any architectural decision (a new boundary, a new adapter
  surface, a durability or privacy guarantee) gets a numbered ADR in
  `docs/adr/` — see 0001 for the format and the existing decisions.

## Issues and pull requests

Use the templates under `.github/ISSUE_TEMPLATE/`. Bug reports: what you did,
what happened, what you expected — plus the console output. Never paste
training history, health summaries or backup files into an issue: they are
your data, and issues are public. Diagnose first, share a minimal
reproduction second.

**Open PRs and branches:** none. The numbered PR series (#17–#35) is fully
merged, and PRs #13–#16 were reviewed and closed on 2026-09-17 — #13 as
stale-completed (its substance already landed on main), #14 and #16 as
stale/out-of-scope against the current roadmap, and #15 (hosted Google-account
sync) as explicitly REJECTED by the product charter: Arise keeps training
data on-device with explicit exports and no account layer (see
`docs/PRODUCT.md`). If you are about to propose hosted accounts or sync, read
that charter note first — a PR will not change it, only a charter change will.
A PR touching progression logic, study randomisation or the treatment
pipeline additionally needs a reviewer who is not its author, and any change
to the ground rules needs an ADR first.

## Code style

Plain modern JavaScript (ESM), 2-space indent, LF endings, single quotes,
semicolons. The format gate enforces the mechanical subset so review can
spend its attention on the substance. Comments explain *why*, especially in
the engine modules where the training logic is non-obvious — when you add
logic, add the reasoning next to it.
