// Tests that exercise the optional cloud integrations (NVIDIA coach,
// classifier.dev, Pulse) only make sense in a build that contains them.
//
// The shipped default compiles those out — see src/lib/integrations.js — so
// under a plain `npm test` these suites skip rather than fail, and say exactly
// what command runs them. `npm run test:integrations` re-runs the entire suite
// with VITE_ARISE_INTEGRATIONS=on, and `npm run verify` runs BOTH, so the
// integration code is never merely preserved and never actually checked.
//
// Neither configuration alone is sufficient, which is why verify runs both.

const FLAG = String(
  (typeof process !== 'undefined' && process.env && process.env.VITE_ARISE_INTEGRATIONS) || 'off'
).toLowerCase() === 'on';

export const INTEGRATIONS_ON = FLAG;

export const SKIP_WHEN_OFF = {
  skip: FLAG
    ? false
    : 'requires the optional integrations — run `npm run test:integrations`',
};

// The mirror image: assertions about the fail-closed default only mean
// anything when the default is actually in effect.
export const SKIP_WHEN_ON = {
  skip: FLAG
    ? 'describes the integrations-compiled-out build — covered by `npm test`'
    : false,
};