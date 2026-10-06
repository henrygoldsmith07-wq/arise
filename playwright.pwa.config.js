import { defineConfig, devices } from '@playwright/test';

// PWA e2e runs against a PRODUCTION build (vite preview): the service worker
// is PROD-only, so offline/install checks are meaningless against the dev
// server. Run with: npx playwright test --config playwright.pwa.config.js
// (the `build` script must have produced ./dist first).

export default defineConfig({
  testDir: './e2e',
  testMatch: 'pwa.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4187',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx vite preview --port 4187 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4187',
    // Never reuse an arbitrary process on the test port (same rule as the dev
    // suite). Startup allowance matches the main config's 120s: a cold prod
    // preview on a loaded machine can exceed 60s without anything being wrong.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
