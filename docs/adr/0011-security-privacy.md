# ADR 0011 — Security & privacy: CSP allowlist, hostile-import hardening, and consent granularity

Date: 2026-09-04 · Status: accepted

## Context

A security & privacy audit found the local-first model sound (no account, no
trackers, consent-gated telemetry, encrypted backups with PBKDF2/AES-GCM) but
with unenforced promises and three exploitable edges:

1. Nothing *enforced* "no third-party requests" — a dependency or a supply-chain
   compromise could exfiltrate data and nothing would stop it.
2. `parseImportFile` treated JSON as structurally trustworthy: a `__proto__`
   key in a shared backup hijacks `Object.prototype`; a 500 MB or 100k-deep
   file freezes the tab before validation; negative/absurd set values pass
   validation and poison e1RM, volume and progression priors.
3. Telemetry consent was binary — crash diagnostics shared a gate with the
   product ledger, and `sanitizeEventPayload` defaulted to *no* key filtering
   unless the caller opted in (a future call site would silently log health
   data).

## Decision

1. **CSP as enforcement, not promise.** `vercel.json` (host) + `index.html`
   meta (any static host) pin `default-src 'self'`, allowlist the illustration
   host and the NVIDIA AI-coach endpoint in `connect-src` only, and set
   `frame-ancestors 'none'`, `object-src 'none'`, Referrer-Policy,
   X-Content-Type-Options and a restrictive Permissions-Policy. The service
   worker mirrors the policy: it refuses every cross-origin request except the
   sanctioned illustration host.
2. **Imports are hostile input.** `parseImportFile` now runs a structural
   sanitiser before validation: `__proto__`/`constructor`/`prototype` keys are
   stripped at every depth into null-prototype objects, nesting is capped at
   64, and files over 5 MB are rejected before parse. Set-level numeric fields
   are coerce-then-bound-checked (numeric strings are the app's own convention;
   `''` means unset) — negatives, non-finite values and implausible magnitudes
   fail validation with a per-item error instead of poisoning analytics.
3. **Granular, fail-closed consent.** `telemetryOptions` (`errorDiagnostics`,
   `sessionTimings`) gate their metric types; both default OFF and never travel
   in exports. Crash logs live in a separate, 50-event-capped store carrying
   only message/stack-head/source — never a caller payload — so even a bug that
   throws a health summary cannot persist it. The sanitizer defaults to the
   sensitive-key filter (health, identity, free-text), not to permissive.
4. **Transparency in the UI.** More → Privacy & data gains "What is stored on
   this device?", "What is shared?" and a short-form privacy policy with data-
   ownership, medical and high-intensity disclaimers, plus a quarterly consent
   review reminder (local-only).
5. **Supply chain.** `npm audit --omit=dev --audit-level=high` runs as a CI
   smoke gate (`audit:deps`).

## Consequences

- The CSP is an allowlist: any new external endpoint must be added explicitly
  in both `vercel.json` and `index.html` (a test-friendly friction).
- Imports of enormous or polluted files now fail loudly with actionable errors
  instead of half-importing.
- Numeric-string tolerance keeps the app's own export format valid; truly
  malformed values are rejected per item with a precise message.
- CI gains one network-dependent gate; a registry outage fails the audit step
  (accepted — the same outage would break installs anyway).
