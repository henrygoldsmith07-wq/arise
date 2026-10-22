# Sync guide

Optional cross-device sync with **no Arise server**: you bring your own
WebDAV storage (Nextcloud, ownCloud, Fastmail, Synology, many NAS boxes,
many hosts). Arise keeps one versioned — optionally end-to-end encrypted —
backup file there.

## Setup

1. More → **Sync**.
2. Enable sync; enter your WebDAV base URL, username and app password.
   - HTTPS is enforced. App passwords (Nextcloud: Settings → Security →
     Devices & sessions) are better than account passwords.
3. Choose a **passphrase** if you want end-to-end encryption (recommended).
   - The passphrase is *not* your WebDAV password; the app refuses to run
     one as the other. It derives the encryption key on-device and is never
     sent anywhere.
4. **Test connection**, then **Sync now**. The first sync creates the
   `arise-sync/` folder on your storage if it does not exist.

### Browser access (CORS)

Arise runs in your browser, so your WebDAV server must accept requests from
the app's origin. Many hosted providers and a default Nextcloud install do not
send the CORS headers a browser needs; the request then fails with "Could not
reach <host> … (CORS)". The server (or a reverse proxy in front of it) has to:

- answer `OPTIONS` preflights without requiring a login;
- send `Access-Control-Allow-Origin: <the app's origin>`;
- allow the methods `GET, PUT, MKCOL, OPTIONS` and the request headers
  `Authorization, Content-Type, If-Match`;
- expose the `ETag` response header (optional — without it sync still works,
  but loses the overwrite protection described below).

## What a sync cycle does

`pull → merge → push`:

- **Pull** the remote file (a 404 just means "first sync").
- **Merge** with deterministic semantics: per-session last-write-wins on
  `savedAt`, recommendation outcomes stay monotonic, product events union by
  stable id, and deletions travel as tombstones so they survive the round trip.
  WebDAV is a trusted Arise-to-Arise transport: existing evidence provenance
  is preserved rather than being downgraded like an arbitrary backup import.
- **Push** the converged payload back.

The status line shows: never synced / up to date / queued / error, plus a
capped log. Auto-sync runs after session saves — fire-and-forget, never
blocking a workout.

## Offline and conflicts

Offline pushes queue (bounded at 20) and drain with exponential backoff.
Every upload — **Sync now**, **Push backup** and queue retries — is a full
pull → merge → push cycle; there is no blind overwrite of the remote file.

When the server exposes a strong `ETag`, the push is conditional
(`If-Match`). If another device wrote the file between this device's pull and
push, the server refuses the write (412) and Arise re-pulls, re-merges and
retries (up to three times) instead of overwriting the other device's sync.
Two devices editing the same session converge to the newest save; edits
you made on a third copy that lost the race are visible in the merged
history rather than silently dropped — per-record provenance shows which
device last touched what.

## Privacy model

- Your storage, your credentials, your file. No third party is introduced
  by syncing — syncing itself only ever talks to your own WebDAV host. The
  separate, opt-in AI-coach and classifier.dev integrations described
  in `docs/PRIVACY.md` are not sync channels and never travel over it.
  The AI coach defaults to a local loopback endpoint; see
  `docs/NETWORK_BOUNDARY.md` for the CSP allowlist.
- With encryption on, the host stores ciphertext only; it cannot read your
  training data.
- Credentials, passphrase and consent choices stay device-local —
  stripped/denied at the transport boundary and never logged. Portable Gym
  Mode settings, training history, events and evidence do sync.
- Study identity/enrollment follows the same participant across trusted sync,
  but measurement consent does not. If two different active study participants
  point at the same remote path, Arise refuses the merge instead of combining
  their study records.

## Recovery and pitfalls

- **Forgot the passphrase?** The remote file is unreadable without it — by
  design. Delete the remote file and push a fresh one to start over.
- **Rotating the app password:** update it in More → Sync and test.
- **Switching encryption on or off** is safe: the pulled file is read as
  whatever it actually is (sealed or plain), and the next push follows this
  device's setting. Opening a sealed file still needs the passphrase, so keep
  it set on every device even if you turn encryption off.
- **Don't point unrelated Arise profiles at the same remote path.** Different
  encryption passphrases already fail to decrypt; different active study
  participant identities are also refused explicitly rather than merged.
  Use separate remote paths for separate people.
- There is no multi-peer version history: the remote holds the latest
  converged payload. Keep periodic file exports for deep history.
