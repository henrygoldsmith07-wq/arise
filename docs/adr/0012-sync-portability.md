# ADR 0012 — Sync is user-owned storage, E2E-encrypted, with device-local secrets

Date: 2026-09-04 · Status: accepted

## Context

Sync was an abstraction without a runtime (ADR 0006): a pure merge engine and a
flag-gated service, but no way to actually move data between devices. The
design space is constrained by the app's core promise: local-first, no account,
no server, nothing leaves the device without explicit consent.

Meanwhile the export surface needed portability work: no partial exports (a
coach or a study tool needs a slice, not the whole store), no human-readable
coach format, no backup reminder, and no validation feedback on what an export
contains.

## Decision

1. **No Arise server, ever.** The sync provider is the user's own storage.
   WebDAV is the first adapter (`webdav.js`): PUT/GET of one versioned backup
   file, https enforced (credentials ride to that host), 20s timeout, 404 on
   GET = first sync. The production CSP allowlist already forces this to be
   explicit; the e2e uses `bypassCSP` for its mocked remote and says so.
2. **Two secrets, strictly separated.** The WebDAV *app password* proves
   identity to the storage server. The *passphrase* derives the end-to-end
   AES-GCM key (PBKDF2 310k via the existing cryptoBackup format). The engine
   refuses to use one for the other — a leaked server password must never be
   the end-to-end key, and the passphrase never leaves the device. Both live
   in `preferences.sync`, which is device-local by policy: stripped from every
   export (`stripDeviceLocalPrefs`) and denied on import (`exportPolicy`).
3. **Merge semantics unchanged.** One cycle = pull → merge (per-session LWW by
   savedAt, "resolved beats unresolved", tombstone-aware deletions) → push the
   converged payload. Offline pushes queue (bounded, 20) and drain with
   exponential backoff (1s→5min cap); every step logs to a capped status log.
4. **Sync never blocks training.** Auto-sync after a session save is
   fire-and-forget behind a dynamic import (keeps the sync stack out of the
   boot chunk). Failures surface only in the status screen.
5. **Portability slices.** Partial exports reuse the versioned envelope
   contract (`buildPartialExportPayload`): history-only, settings-only,
   events-only — each importable by the same preview/confirm flow. The coach
   export is a separate, human-readable Markdown summary with per-section
   consent; it never carries identity, credentials, or raw backups.

## Consequences

- Users must own storage and remember a second secret (passphrase); the UI
  states the recovery implications explicitly.
- The CSP becomes a functional dependency for sync: new providers mean a new
  explicit allowlist entry (a feature, per ADR 0011).
- Payload on the wire is opaque (encrypted) — server-side tooling cannot read
  it, which is the point.
- The e2e asserts the central guarantee: the remote stores `ARCB` bytes, not
  JSON, and neither secret ever renders in the DOM.
