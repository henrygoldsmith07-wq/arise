// scripts/e2e-with-integrations.mjs — run the Playwright suite against a dev
// server that actually contains the optional cloud integrations.
//
// `npm run e2e` runs with VITE_ARISE_INTEGRATIONS unset, which is the shipped
// default: specs that drive the NVIDIA coach or classifier.dev correctly skip
// themselves rather than passing vacuously. This pass re-runs them for real.
//
// The env var reaches BOTH the Playwright runner (so it decides which specs
// skip) and the Vite dev server it starts (so the module compiles the
// integrations in). playwright.config.js forwards process.env into webServer.env
// for exactly that reason.
//
// It deliberately does NOT regenerate the CSP. The policy files on disk always
// describe the shipped default; the two affected specs opt into `bypassCSP` so
// a test run can never widen the policy the repository actually ships.
import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test'],
  {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, VITE_ARISE_INTEGRATIONS: 'on' },
  },
);

child.on('close', (code)=> process.exit(code ?? 1));