import { defineConfig, devices } from '@playwright/test';

// pwa.spec.js needs the PRODUCTION build (service worker is PROD-only);
// it runs via `npm run e2e:pwa` (playwright.pwa.config.js, vite preview).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  testIgnore: '**/pwa.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5187',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --port 5187 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5187',
    // Never reuse an arbitrary process on the test port. Local multi-project
    // workspaces can otherwise point Arise's E2E suite at a different Vite app.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
