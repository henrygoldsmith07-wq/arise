// integrations.js — the hosted build's network boundary, expressed once.
//
// Arise's charter is local-first: no account, no server, no sync you did not
// start. Three optional integrations could still leave the device — the
// user-configured AI coach endpoint, classifier.dev routing/feedback, and the
// Pulse connector. Each was previously gated only by per-user consent stored
// in localStorage, which means a hosted build *could* make outbound requests
// for anyone who had ever opted in, and nothing in the build said so.
//
// This module turns that into a BUILD-TIME decision:
//
//   VITE_ARISE_INTEGRATIONS = 'off'   (default) — integrations are compiled
//                                          out of the request path entirely.
//   VITE_ARISE_INTEGRATIONS = 'on'    — integrations are available, still
//                                          behind their existing per-user consent.
//
// The code is NOT deleted in the 'on' build, the tests run against the 'on'
// build, and the consent keys keep working. Only the hosted default changes.
//
// This is deliberately a compile-time constant rather than a runtime setting:
// an end user must not be able to turn the network on for a build that was
// shipped without it. `?integrations=1` in the URL, a localStorage key, or a
// hidden toggle would all defeat the purpose.

// Vite replaces `import.meta.env.VITE_ARISE_INTEGRATIONS` with a string
// literal at build time, so in the browser this is a constant that the bundler
// folds away. Under `node --test` there is no import.meta.env, so the flag is
// read from the environment instead — that is how the test suite exercises the
// integration-enabled configuration (`npm run test:integrations`). `process`
// does not exist in a browser, so this branch can never run there.
const RAW = (
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ARISE_INTEGRATIONS)
  || (typeof process !== 'undefined' && process.env && process.env.VITE_ARISE_INTEGRATIONS)
  || 'off'
);

/** True when this build was compiled with the optional integrations enabled. */
export const INTEGRATIONS_COMPILED_IN = String(RAW).toLowerCase() === 'on';

/** Human-readable label for the UI and the privacy page. */
export const INTEGRATIONS_LABEL = INTEGRATIONS_COMPILED_IN
  ? 'Optional integrations are compiled into this build.'
  : 'This build ships with all optional integrations compiled out — it cannot contact an AI coach, a cloud classifier or Pulse.';

/**
 * Gate for a consent-gated integration. Returns the consent flag only when
 * the build actually contains the integration, so a caller can write
 * `if(integrationEnabledByBuild() && consent)`.
 *
 * Every integration call site funnels through here; nothing checks
 * import.meta.env directly.
 */
export function integrationEnabledByBuild(){
  return INTEGRATIONS_COMPILED_IN;
}
