# Privacy guide

Short version: **Arise is local-first. Network sharing is opt-in or initiated
by an explicit export/share action.** This page lists every app pathway that
can send data away from the current browser profile and what each pathway
actually sends.

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

| Channel | What Arise sends | Destination / remote persistence | Control |
|---|---|---|---|
| Export/share | The file or summary you explicitly choose to save/share; credentials are stripped | Wherever you save/share it; persistence is controlled by that destination | Manual, per action |
| WebDAV sync | One versioned backup payload. With E2E encryption enabled, the host receives ciphertext | Your configured WebDAV host; the remote backup persists there until you remove/replace it | Explicit opt-in; HTTPS required; disable any time |
| NVIDIA AI coach | Aggregated training numbers + deterministic engine findings; the API key is sent as the request credential. No raw set-by-set history, notes or health summary | `integrate.api.nvidia.com`; Arise does not control the provider's server-side retention | Requires a pasted API key and an explicit coach request |
| classifier.dev feedback categorisation | Redacted feedback text | `classifier.dev`; Arise does not control the service's server-side retention | Separate opt-in; off by default |
| classifier.dev coach routing | Only an ambiguous coach question after local redaction; returns a route/lane, never a prescription | `classifier.dev`; Arise does not control the service's server-side retention | Separate opt-in; local rules run first; off by default |
| Pulse connector | Completed-workout metadata plus aggregate volume/trends as defined in `src/lib/pulse.js` | The user/integrator-provided Pulse adapter; persistence depends on that adapter | Separate opt-in and an injected adapter |
| Telemetry/events | Nothing automatically. Measurement records stay local | Local browser storage unless you explicitly export them | **Off by default** |

The optional health-summary adapter is an **import into Arise**, not an
outbound sharing channel by itself. It stores a minimized local summary only
after its separate consent is enabled.

Consents are independent and revocable. WebDAV credentials and AI credentials
are device/browser-local policy data and are excluded from Arise exports,
diagnostics and sync payloads.

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
