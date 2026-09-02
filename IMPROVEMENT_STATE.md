# Improvement state — arise CI/hygiene slice (2026-08-26)

## Goal

Restore trust in `main` after consecutive red CI runs, using local
reproduction instead of guessing, and remove recurring repo-hygiene noise.

## Baseline evidence (captured 2026-08-26)

- GitHub Actions runs #46 and #47 on `main` failed within ~4 seconds with no
  step data or retained logs; last verifiable green was run #33 (2026-08-23).
- Run #43's commit message admitted 23 known lint failures from the pending
  246-exercise merge, but that merge was never landed in `src/lib/data.js`.
- Local reproduction of HEAD (`55ddceb`) with Node 22 / npm ci:
  - `npm run lint:content` — PASS ("Content lint OK")
  - `npm run type-check` — PASS
  - `npm test` — PASS, 314/314 across 83 suites
  - `npm run build` — PASS (2.61s; warning: main JS chunk 565 kB minified,
    130 kB gzip)
- Conclusion: the code on `main` is green. The GitHub failures are
  infrastructure-level (4-second failures with zero recorded steps are
  consistent with Actions minutes/billing being exhausted on the private
  repo), not a code regression.

## Changes shipped in this slice

1. `.gitignore` now excludes `playwright-report/` and `test-results/`.
2. Removed the committed ephemeral artifacts `playwright-report/index.html`
   and `test-results/.last-run.json` from the index (files stay on disk).

## Ranked opportunities considered

| Opportunity | Verdict | Why |
|---|---|---|
| Restore CI green | Blocked on account state | Code is green locally; reruns will keep failing until Actions minutes/billing is resolved |
| Ignore + untrack Playwright artifacts | Shipped here | Recurring noise, zero runtime risk, reversible |
| Split `data.js` per muscle group | Deferred | Lint/tests pass today; the 246-entry merge is still pending upstream. Do the split together with that merge, not before it |
| Code-split the 565 kB bundle | Proposed next | Vite itself warns; lazy-loading exercise data/images would cut initial payload for a PWA whose promise is speed/offline |
| LICENSE file | Needs owner decision | License choice is a legal/product decision, not an agent default |

## Verification

- Full pipeline: lint ✓ type-check ✓ tests 314/314 ✓ build ✓ (commands and
  output above).
- Artifact removal verified via `git status` showing only intended changes.

## Open questions / next actions

1. Owner: check GitHub Actions usage/billing for this private repo, then
   rerun workflow #47. If it fails again instantly, capture the runner error
   screenshot from the Actions UI (API logs are not retained for these runs).
2. Next code slice: dynamic-import the generated image map and/or exercise
   library to address the 565 kB chunk warning.
3. When resuming the 246-exercise expansion, split `data.js` first so the
   merge lands in reviewable pieces (per docs/IMPROVEMENTS.md P1 #4).
