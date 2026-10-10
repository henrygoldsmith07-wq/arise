# Network boundary

Every outbound endpoint Arise can reach, where it is decided, and how you can
check the claim. Companion to [`PRIVACY.md`](./PRIVACY.md), which states the
same boundary in user-facing terms.

## The complete endpoint inventory

This is exhaustive: every `http(s)://` literal in `src/`, plus every URL the
app can construct at runtime.

| # | Origin | Source | Default | Reachable in the shipped build? |
|---|---|---|---|---|
| 1 | `http://127.0.0.1:11434/v1/chat/completions` | `lib/aiCoach.js:36` | **On** (loopback) | Yes, but only after explicit opt-in and a key |
| 2 | `https://classifier.dev` | `lib/feedbackClassifier.js:13` | Off | **No** — compiled out |
| 3 | Pulse connector | `lib/pulse.js` (dependency-injected adapter) | Off | **No** — compiled out |
| 4 | `https://bryllim.github.io/workout-guide/frames` | `lib/exerciseImages.js:12` | **On** | Yes — the one documented exception |
| 5 | User's own WebDAV host | `lib/webdav.js:31` | Off | Yes, but only after the user configures a host and consents |
| 6 | `<your origin>/…` (service-worker probe) | `components/OfflineBanner.jsx:14` | On | Yes — same-origin HEAD only |
| 7 | `https://github.com/henrygoldsmith07-wq/arise/…` | `aiCoach.js:30`, `MoreView.jsx:766` | Links | Not a fetch — an `<a href>` the user clicks |

There is no other `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or
`EventSource` in `src/`.

## Why rows 1–3 are different from rows 4–5

Rows 4 and 5 are gated by **user consent**, which is appropriate for a feature
the user asked for.

Rows 1–3 were previously gated by consent *alone*. That means a hosted build
could make outbound requests for anyone who had ever opted in — with the
decision buried in a `localStorage` key, and nothing in the build recording
that the capability existed at all. A user who opted in once, months ago, on a
different device image, would have had their training summary sent to a third
party with no further prompt and no way to see it happen.

So the gate moved to build time for rows 2–3 (classifier.dev, Pulse). Row 1
(the AI coach) is now **local-first by default**: the out-of-box endpoint is a
loopback URL (`127.0.0.1:11434`), so no third-party is contacted unless the
user explicitly configures a remote endpoint — and even then, the request
requires both a configured URL and a key the user pasted.

## `VITE_ARISE_INTEGRATIONS`

```
npm run build                 # default: integrations compiled out
npm run build:integrations    # opt in: integrations compiled in, CSP widened
```

- **Off (default, and therefore every hosted deploy).** `isFeedbackClassifierEnabled()`
  and `isCoachRoutingEnabled()` return `false` regardless of stored consent;
  the Pulse push never fires. The AI coach defaults to a loopback endpoint
  and requires explicit user-configured URL + key, so no third-party is
  contacted in the default build. The CSP omits the integration origins, so
  the browser blocks them independently.
- **On.** The existing code path runs, still behind the per-user consent key.
  Both gates must pass.

It is deliberately **compile-time**. A URL parameter, a hidden toggle or a
`localStorage` key could all be set by anything running on the origin, which
would defeat the point — an integration the build does not contain must not be
reachable by a user action. `tests/security-csp.test.js` fails the build if the
flag ever becomes readable from runtime state.

### What the tests do with the flag

Every gate runs the suites **twice**:

| Command | Flag | Proves |
|---|---|---|
| `npm test` | off | The shipped default is fail-closed |
| `npm run test:integrations` | on | The integration code still works |
| `npm run e2e` | off | Default settings contact no undeclared origin |
| `npm run e2e:integrations` | on | The cloud-backed specs still work end to end |

Specs that drive the cloud paths `skip` — with a reason naming the command that
runs them — rather than passing vacuously. Neither configuration alone is
sufficient: without the second, the integration code would only ever be
*preserved*, never *checked*.

`e2e:integrations` deliberately does **not** regenerate the CSP. The policy
files on disk always describe the shipped default; the two affected specs opt
into `bypassCSP` instead. That way a crashed test run can never leave the
repository holding a wider policy than the one it ships.

## One source of truth for the CSP

The policy used to exist as two hand-maintained copies — a `<meta>` tag in
`index.html` and a header in `vercel.json` — free to drift apart, and carrying
`https://api.github.com` in `connect-src` with no caller anywhere in `src/`.

`scripts/gen-csp.cjs` now generates both from `buildCsp(integrationsOn)`, runs
as the first step of `npm run build`, and throws if it cannot find the
declaration it is replacing (which is how drift gets caught instead of
accumulating). `tests/security-csp.test.js` asserts the two files are identical
and match the generated value.

## How to check the claim yourself

```bash
# Does the shipped bundle contain the integration origins?
grep -r "integrate.api.nvidia.com\|classifier.dev" dist/assets/ || echo "absent"

# What does the shipped policy permit?
node -e "console.log(require('./scripts/gen-csp.cjs').buildCsp(false))"

# Prove it end to end (onboarding → session → export → every tab):
npm exec playwright test e2e/network-boundary.spec.js

# Prove the integrations still work when a maintainer builds them in:
npm run e2e:integrations
```

## Known limits of this boundary

Stated rather than papered over:

1. **WebDAV sync is now permitted for user-configured hosts.** The CSP allowlists
   loopback origins for the local-first AI coach default.
   only `'self'`, the illustration CDN and (when enabled) the two integration
   hosts. A user-supplied WebDAV domain is therefore blocked by the shipped
   policy. `e2e/sync.spec.js` passes only because it sets `bypassCSP: true`.
   Fixing this needs a decision about the CSP (an explicit, narrow relaxation
   is not expressible in CSP for arbitrary hosts) — raised in the final report.
2. **The illustration CDN is genuinely third-party.** It is the one origin a
   user reaches without opting in. It is documented above and in `PRIVACY.md`
   precisely because it is the exception, not because it is fine.
3. **The e2e covers default settings only.** A user who configures WebDAV
   chooses to leave the device; that path is tested separately.