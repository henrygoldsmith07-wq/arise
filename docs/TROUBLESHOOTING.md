# Troubleshooting

Arise is offline-first and local-storage-backed, so almost every failure is
diagnosable from the app itself. Start with **More → Storage & diagnostics**
— it shows store health, last-persist time, snapshot state and any
quarantined records.

## The app won't boot / shows a recovery screen

- A boot-time integrity failure triggers **recovery mode**: the broken
  payload is quarantined (never half-loaded) and you are offered **repair
  from the last automatic snapshot**. Accept it — snapshots are rolling
  local backups taken before risky operations.
- If you declined snapshots or they are also damaged, recovery offers
  **import a backup file**. Any export from any version is accepted through
  the backward-compatible adapters.
- Nothing to recover? The final option starts empty; the quarantined bytes
  stay in the quarantine store so a future version can attempt deeper
  repair. Nothing is silently destroyed.

## Data looks wrong after an import

- Import always shows a **preview** first — totals per entity, conflicts,
  and policy-blocked fields. Re-do the import and read the preview.
- **Merge** de-dupes by session/event id (newest save wins); **Replace**
  overwrites everything. If you wanted merge but picked replace, restore
  from a snapshot (diagnostics screen) or re-import your other backup.
- A file that fails validation is rejected whole, with the reason shown —
  it is never half-applied.

## Sessions or sets disappeared

- Check Progress → history first; filters hide more than people expect.
- If a crash interrupted a save, the **active workout draft** is restored on
  next boot with a recovery prompt — complete or discard it there.
- Duplicate-looking sessions are de-duplicated by id; edited duplicates
  resolve newest-wins. If two entries genuinely differ, both survive —
  nothing is auto-merged away silently.

## Sync problems

- "Sync failed" first steps: check the status line in More → Sync (never
  synced / up to date / queued / error), then **Test connection**.
- HTTPS is enforced: your WebDAV endpoint must be `https://`. A 404 on pull
  means "no remote backup yet", not an error — the first push creates it.
- Offline pushes queue (bounded) and drain with backoff; leave sync enabled
  and they send themselves.
- Forgot the encryption passphrase? The remote file cannot be decrypted
  without it — by design there is no recovery. Re-sync from scratch by
  deleting the remote file and pushing a fresh one.

## Install / PWA issues

- iOS: Safari → Share → **Add to Home Screen** only. Chrome/Firefox on iOS
  cannot install PWAs — that is a platform limit.
- Android/desktop Chromium: the install card's **Install app** button, or
  the browser's install menu. If the button is missing, check you're not in
  an in-app browser (Instagram/Facebook shells block installation).
- Offline boot broken? The service worker only runs on the production
  build — dev-server pages have no offline guarantee.

## Platform quirks

- **No vibration on iOS** — Safari exposes no Vibration API; the setting
  reports this honestly rather than pretending.
- **Rest announcements stop in background tabs** — browser throttling. Use
  Gym mode's wake lock, or keep the tab foregrounded.
- **Storage pressure** — the diagnostics screen shows usage against quota
  and warns before evictions matter. Exports are the off-device safety net.

## Still stuck

Open a GitHub issue (see `CONTRIBUTING.md`) with: what you did, what
happened, expected vs actual, browser + platform. Never attach backup
files, history dumps or health data — describe the symptom, share the
minimal reproduction.
