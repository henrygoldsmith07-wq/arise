# Arise E2E coverage

- **browser (Playwright)**: full new-user journey — onboarding → equipment →
  programme generation → start session → log sets → complete session →
  progression update → next session — plus a mobile-viewport layout check.
  Run with `npm run e2e` (desktop Chromium + mobile Chrome projects; the dev
  server is started automatically). CI runs it after the build step.
- **a11y**: axe-core check on Today, Train and Exercises
- **perf**: Lighthouse budgets (LCP < 2.5s, JS < 200kB)
- **data**: JSON export/import, schema migration and event-history restore
- **Pulse**: adapter push/pull smoke path via `runPulseIntegrationE2E()`
- **field**: real-gym checklist in [`REAL_GYM_FIELD_TESTS.md`](./REAL_GYM_FIELD_TESTS.md)

Run the deterministic checks with `npm test`, `npm run benchmark` and
`npm run benchmark:logging`. Run Playwright with `npm run e2e`
(`npx playwright install chromium` once per machine first).
