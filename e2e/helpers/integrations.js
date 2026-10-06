// e2e/helpers/integrations.js — mark specs that need the optional cloud
// integrations to be compiled in.
//
// The shipped default compiles the NVIDIA coach, classifier.dev and Pulse out
// of the build, so a spec that drives those code paths cannot pass against the
// default `npm run e2e` — the app correctly refuses to make the request.
//
// Those specs therefore:
//   * skip with a reason during the default run, so a skip is never mistaken
//     for a pass, and
//   * run for real under `npm run e2e:integrations`, which is part of the
//     pre-merge check alongside `npm run e2e`.
//
// A spec using these must ALSO call `test.use({ bypassCSP: true })`. The CSP
// on disk always describes the shipped default, so it does not permit the
// integration origins. Bypassing it per-spec is deliberate: regenerating
// index.html for a test run would leave the source tree holding a wider policy
// if anything crashed mid-run. The boundary itself is verified separately by
// e2e/network-boundary.spec.js.
//
// Call `test.skip(!INTEGRATIONS_ON, NEEDS_INTEGRATIONS)` as the FIRST line of
// the test body. An earlier version passed `skip` through `test.use()` or the
// `test(title, options, body)` options object; Playwright accepts the option
// but does not honour it there, so those specs silently ran and failed instead
// of skipping.

const ON = String(process.env.VITE_ARISE_INTEGRATIONS || 'off').toLowerCase() === 'on';

export const INTEGRATIONS_ON = ON;

export const NEEDS_INTEGRATIONS = 'drives the optional cloud integrations — run `npm run e2e:integrations`';
export const NEEDS_DEFAULT_BUILD = 'asserts the integrations-compiled-out build — covered by `npm run e2e`';
