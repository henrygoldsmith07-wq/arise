# Security & privacy threat model

What Arise defends against, what it explicitly does not, and why the
residual risks are accepted. Written for reviewers and the security-minded;
the implementation is documented in ADR 0011 and enforced by tests.

## Assets

1. **Training history** — sessions, sets, loads, notes, pain tags.
2. **Health summary** — the optional minimised adapter payload.
3. **Consent state** — which integrations are allowed.
4. **Sync credentials** — WebDAV app password + E2E passphrase.
5. **AI-coach credential** — user-supplied API key, session-only by default.
6. **Integrity of recommendations** — the prior-only guarantee and the
   ledger firewall.

## Adversaries and defences

**A hostile backup file (malicious import).**
*Defence:* every import runs through schema validation (Zod), the
dangerous-field policy (credentials, consents, device identity denied), the
fuzz-tested parser (prototype-pollution keys, deep nesting, absurd sizes),
and a preview that shows what will change before anything is applied.
Partial application is structurally impossible — validate-then-commit.

**A compromised or malicious WebDAV host.**
*Defence:* HTTPS enforced; with E2E encryption on, the host holds
AES-GCM ciphertext it cannot read. Without encryption, the host can read
the backup — the UI says so plainly at setup; that is the user's informed
choice. The host cannot inject credentials into your app (import policy
denies them).

**Credential theft through browser storage.**
*Defence:* the NVIDIA API key is kept in `sessionStorage` by default and only
moves to durable browser storage after an explicit “Remember” opt-in. Legacy
durably stored keys are demoted to the current session. Clear key removes both
copies; exports, sync payloads and diagnostics do not include it. This reduces
exposure duration but cannot defend against code already executing with the
origin's browser-storage privileges.

**Optional cloud integrations receive more data than the user expects.**
*Defence:* each path has a narrow adapter and independent control. NVIDIA gets
aggregated training context + deterministic findings, not raw history/notes;
classifier.dev gets redacted text only after its relevant consent; Pulse gets
the documented summary payload through an injected adapter. CSP `connect-src`
allowlists the built-in remote endpoints. Arise cannot guarantee how an
external provider retains a request after receiving it.

**Local malware / another site in the same browser profile.**
*Not defended.* Any code running in your browser with access to the origin
can read IndexedDB. The app's mitigations are hygiene, not guarantees: no
third-party script tags, CSP headers restricting connect/script sources,
same-origin service worker. Site-data isolation is the browser's job.

**A curious co-user of the same device profile.**
*Not defended.* Local-first storage is unencrypted at rest (browser-level
profile encryption aside). If a shared computer is a threat, use the
encrypted export + a private browser profile, and clear site data after.

**Storage pressure (browser eviction).**
*Defence:* quota monitoring with warnings before it matters, snapshots,
and exports as the durable path. Documented honestly — browsers can evict,
`docs/BACKUP_RECOVERY.md` is the answer.

**Engine integrity (data leakage into decisions).**
*Defence:* prior-only slicing enforced and leak-tested; evaluation ledger
stored separately and structurally prevented from feeding recommendations;
deterministic, versioned policies so any recommendation can be audited
against the inputs it was allowed to see.

## Accepted residual risks

- Browser-profile compromise (no app can defend it from inside); a remembered
  AI key is readable by code with origin storage access.
- Unencrypted at-rest data on the device.
- A hostile *first* install (malicious mirror of the app) — mitigated by
  installing from the official URL; there is no code-signing story for
  plain PWAs.
- WebDAV host availability (no SLA on someone else's NAS).
- Retention/security policies of optional NVIDIA/classifier.dev/Pulse
  destinations after a user-authorised request leaves Arise.

## Dependency and supply-chain posture

Minimal runtime dependencies (react, react-dom, zod), prod-only
vulnerability audit at `high+` in CI, a production license allowlist, and a
lockfile-committed npm tree. Adding a dependency is a reviewable event by
policy.
