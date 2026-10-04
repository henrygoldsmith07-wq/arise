# Baseline — 2026 workstreams

Recorded on branch `chore/usefulness-and-maintenance-hardening`, at `main` @
`ce8b3e0`, before any workstream change. Commands are the repo's own scripts;
raw output is committed next to this file.

| Metric | Baseline | Source |
|---|---|---|
| Unit/integration tests | **1389 pass / 0 fail** (390 suites, 104 test files) | `npm test` → `test-baseline.txt` |
| Boot chunk (gzip) | **113.8 kB** / 120 kB budget | `npm run bundle:budget` |
| Largest lazy chunk (gzip) | **26.4 kB** (`catalogue`) / 34 kB budget | `npm run bundle:budget` |
| Total JS (gzip) | **348.6 kB** / 349 kB budget (**0.4 kB headroom**) | `npm run bundle:budget` |
| Exercises | **324** | derived from `src/lib/data.js` |
| Programs | **5** | derived from `src/lib/data.js` |
| Muscles / equipment types / levels | 9 / 9 / 3 | derived from `src/lib/data.js` |
| Bodyweight-only exercises | 126 | derived from `src/lib/data.js` |
| `src/lib/data.js` length | 1000 lines | `Get-Content \| Measure-Object` |
| Outdated packages | 7 (react 18.3.1→19.3.0, vite 6.4.3→8.3.2, @vitejs/plugin-react 4.7.0→6.1.1, zod 3.25.76→4.6.5, typescript 5.9.3→7.0.2, @playwright/test 1.62.1→1.63.0) | `npm outdated` → `npm-outdated.txt` |
| Audit | **2 moderate** (transitive `qs` via `typed-rest-client`, dev-only), 0 high/critical | `npm audit` → `npm-audit.txt` |

## Notes

- **README claims "600+ tests"**; the measured figure is 1389. Workstream 6
  replaces that hand-written number with a generated value.
- **README claims 39 exercises and 3 programs** in `docs/IMPROVEMENTS.md`; the
  library is now 324 exercises / 5 programs. The `IMPROVEMENTS.md` baseline is
  dated 2026-08-14 and is stale by design (it is archived in workstream 6).
- Total bundle headroom is **0.4 kB**, i.e. effectively zero. Any new client
  code in workstreams 1–4 must free at least as much as it spends.
- `docs/perf.md` is referenced by `docs/IMPROVEMENTS.md` but does not exist in
  the tree.
- `npm audit` findings are **dev-only** (devDependency chain); `npm run
  audit:deps` (`--omit=dev`) is clean at baseline.

## Environment

Windows, Node v24.19.0, npm 11.17.0. Bundle numbers are Windows-local; CI
(Linux) measures slightly differently — `scripts/bundle-budget.cjs` documents
the CI-authoritative figure.