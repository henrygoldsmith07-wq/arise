# Security & privacy threat model

What Arise defends against, what it explicitly does not, and why the
residual risks are accepted. Written for reviewers and the security-minded;
the implementation is documented in ADR 0011 and enforced by tests.

## Assets

1. **Training history** — sessions, sets, loads, notes, pain tags.
2. **Health summary** — the optional minimised adapter payload.
3. **Consent state** — which integrations are allowed.
4. **Sync credentials** — WebDAV app password + E2E passphrase.
5. **Integrity of recommendations** — the prior-only guarantee and the
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

- Browser-profile compromise (no app can defend it from inside).
- Unencrypted at-rest data on the device.
- A hostile *first* install (malicious mirror of the app) — mitigated by
  installing from the official URL; there is no code-signing story for
  plain PWAs.
- WebDAV host availability (no SLA on someone else's NAS).

## Dependency and supply-chain posture

Minimal runtime dependencies (react, react-dom, zod), prod-only
vulnerability audit at `high+` in CI, a production license allowlist, and a
lockfile-committed npm tree. Adding a dependency is a reviewable event by
policy.
