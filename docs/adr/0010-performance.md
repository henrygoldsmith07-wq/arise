# ADR 0010 — Performance: route splitting, budgets, and safe updates

Date: 2026-09-04 · Status: accepted

## Context

The production bundle was a single 744 kB JS chunk (178 kB gzip): every view,
both session runners, the evidence dashboards and the analytics graph shipped
at boot, though a session is the only thing most visits need. History rendered
unbounded, exercise illustrations (cross-origin SVGs) were never cached, and a
service-worker update reloaded the page even mid-workout.

## Decision

1. **Route-level code splitting** (`App.jsx`): Train, Exercises, Progress,
   More and both runners are `React.lazy` chunks behind Suspense. Every chunk
   is warmed after first paint (`requestIdleCallback`), so splitting costs
   boot bytes, not navigation jank. Boot (index+vendor) fell 178 → 161 kB gz.

2. **Budgets as CI gates** (`scripts/bundle-budget.cjs`): boot ≤190 kB gz,
   largest lazy chunk ≤45 kB, total JS ≤300 kB gz (the analytics worker alone
   is 37 kB but runs off-thread on demand). The gate runs in CI after build;
   crossing a budget fails the build unless re-baselined deliberately.

3. **Perf smoke e2e** (`e2e/perf.spec.js`): shell paint under 2.5 s in a fresh
   context; the heavy Progress chunk may only be fetched *after* first paint;
   Progress renders on demand; the session runner emits named User Timing
   measures (`perfTrace.js`) and its open/save phases carry latency budgets.

4. **History pagination** (Progress): sessions render 15 at a time with an
   explicit "load older" control — a year of training no longer mounts 150+
   set-summary rows at once. (Virtualization is unnecessary at this page
   size; the scroll container is bounded.)

5. **Service worker, layered** (`sw.js` v5): network-first navigations (unchanged), cache-first for content-hashed `/assets/*`, and a dedicated
   cache-first store for the cross-origin exercise illustrations (previously
   the first thing lost offline). Everything else stays SWR.

6. **Safe updates**: an update banner tap during an active workout defers
   activation and auto-applies when the session ends; the banner says so.
   The draft also already persists per edit, so a hard reload can never lose
   more than the current keystroke.

7. **Deliberately NOT done**: lazy-loading `data.js` (180 kB catalogue) — it
   sits in the boot graph of the progression engine, schedule and today view;
   splitting it means an async-boundary refactor of pure engine code for
   ~60 kB gz of deferred bytes. Revisit if boot budget pressure demands it.
   True list virtualization likewise waits for page sizes that justify it.

## Consequences

New views should be added to the lazy list + warm-up, and any new
"expensive at boot" surface must fit the budgets or re-baseline them with a
reason. The perf e2e reads the same trace names the runner emits, so budget
failures point at the regressed phase directly.
