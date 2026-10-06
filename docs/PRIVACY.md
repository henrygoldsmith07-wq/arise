# Privacy guide

Short version: **Arise is local-first. The version you download cannot phone
home at all** — not by default, not by configuration, and not by a setting
someone else left switched on. This page lists every app pathway that can send
data away from the current browser profile and what each pathway actually sends.

## The default build has no third-party destination

The NVIDIA coach, classifier.dev and the Pulse connector are **compiled out of
the hosted build**. This is a build-time decision (`VITE_ARISE_INTEGRATIONS`,
default `off`), not a settings toggle:

- the code cannot reach those hosts;
- the Content-Security-Policy shipped with the build does not list them, so the
  browser blocks them even if some future code tried.

Nothing you do in the app — including granting consent on an older build and
then upgrading — can re-enable an integration that this build does not contain.
To ship them, a maintainer must deliberately build with
`npm run build:integrations`.

### What this is checked by

`e2e/network-boundary.spec.js` drives a first-run user through onboarding, logs
a real session, exports a backup and visits every tab, with a hard interceptor
on every request. **Any** request to an origin the build did not declare fails
the test and is blocked, so it cannot pass by accident. The same spec proves:

- the default build reports the integrations as compiled out, and the AI coach
  refuses with "not available in this build" rather than "no API key";
- a **stale consent grant** from an earlier build does not open the network.

### The one exception, stated plainly

Exercise illustrations are loaded from `bryllim.github.io` — public, static
animation frames from a CC BY-SA exercise guide, cached by the service worker.
That host receives **no user data**: no identifiers, no training data, no
cookies, no referrer (`Referrer-Policy: no-referrer`). It is the only
third-party origin any Arise user can reach, and it is the only non-`self`
entry in the shipped `connect-src`.

The test covers **default settings**. It says nothing about WebDAV sync, which
is off unless you configure a host yourself, and nothing about what your
browser extensions, your OS or your network do.

## What is stored, and where

- Training history, programs, preferences, readiness and the optional
  evaluation ledger live in **IndexedDB in your browser, on your device**.
  Field-by-field: `docs/DATA_DICTIONARY.md`.
- `localStorage` holds paint-critical preferences/migration pointers, the
  anonymous per-device merge id, local measurement ledgers and settings for
  optional integrations. The AI-coach key is **not** durable by default: it is
  held in `sessionStorage` unless you explicitly choose “Remember API key on
  this device”.
- No account, no login, no analytics SDK, no third-party trackers. The
  bundle contains none by construction (reviewable, and the license gate
  keeps the dependency surface tiny).

## What can leave the browser profile

**In the default build, none of the rows below are reachable.** They describe
what the integration-enabled build (`npm run build:integrations`) can do, and
are kept because that build exists, is tested, and may be shipped separately.

| Channel | What Arise sends | Destination / remote persistence | Control |
|---|---|---|---|
| Export/share | The file or summary you explicitly choose to save/share; credentials are stripped | Wherever you save/share it; persistence is controlled by that destination | Manual, per action |
| WebDAV sync | One versioned backup payload. With E2E encryption enabled, the host receives ciphertext | Your configured WebDAV host; the remote backup persists there until you remove/replace it | Explicit opt-in; HTTPS required; disable any time |
| NVIDIA AI coach | Aggregated training numbers + deterministic engine findings; the API key is sent as the request credential. No raw set-by-set history, notes or health summary. The coach only explains — the deterministic engine remains authoritative and the AI never creates training prescriptions | `integrate.api.nvidia.com`; Arise does not control the provider's server-side retention | Off by default; requires a pasted API key and an explicit coach request |
| classifier.dev feedback categorisation | Redacted feedback text | `classifier.dev`; Arise does not control the service's server-side retention | Separate opt-in; off by default |
| classifier.dev coach routing | Only an ambiguous coach question after local redaction; returns a route/lane, never a prescription | `classifier.dev`; Arise does not control the service's server-side retention | Separate opt-in; local rules run first; off by default |
| Pulse connector | Completed-workout metadata plus aggregate volume/trends as defined in `src/lib/pulse.js` | The user/integrator-provided Pulse adapter; persistence depends on that adapter | Separate opt-in and an injected adapter |
| Telemetry/events | Nothing automatically. Measurement records stay local | Local browser storage unless you explicitly export them | **Off by default** |

The optional health-summary adapter is an **import into Arise**, not an
outbound sharing channel by itself. It stores a minimized local summary only
after its separate consent is enabled.

Consents are independent and revocable. WebDAV credentials and AI credentials
are device/browser-local policy data and are excluded from Arise exports,
backups, sync payloads, support diagnostics and telemetry. The AI-coach key
is session-only by default and never enters any of them.

## Data ownership statement

Your training data is yours. The MIT license governs the *code*; it grants
nothing over *your logs*. Export is always available, always free, always
in an open format — there is no lock-in mechanism to escape.

## What is never collected

- No identity, email, or account data — there is nowhere to collect it.
- No plaintext health data in logs; support/diagnostic exports are designed to
  omit credentials and raw health payloads.
- No location, no contacts, no advertising identifiers.

## Medical and safety disclaimer

Arise is a logging and planning tool. It does not diagnose, treat, or advise
on medical conditions; readiness and pain signals only soften training
prescriptions. Consult a qualified professional for medical or injury
decisions, and treat high-intensity recommendations with the caution any
training program deserves — individual response varies.

## Public release note

Before any public/commercial distribution: publish this page plus the
privacy policy it implies, complete the franchise-branding sweep the README
documents, and verify the CSP/dependency posture hasn't drifted (CI gates
cover the technical half).
