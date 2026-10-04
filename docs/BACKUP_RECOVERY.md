# Backup & recovery

Arise keeps your data alive with three redundant local mechanisms plus the
export habit. This page is the recovery playbook.

## The three safety nets

1. **Rolling local snapshots.** Bounded automatic backups taken before
   risky operations (imports, migrations, clears) and periodically between
   them. Free, instant, on-device. The rollback for "I did something and
   now it's wrong".
2. **Backup files.** The versioned JSON export (optionally encrypted).
   Off-device, survives browser clears and device loss. The authoritative
   long-term backup.
3. **Quarantine.** When boot-time validation fails, the broken payload is
   preserved — never auto-deleted — so nothing is silently destroyed even
   in the worst case.

## How Arise tells you where you stand

Both signals are local-only — no notification permission, no server, no
account. Nothing here ever leaves the device.

- **Persistent storage.** After your first logged session — the first moment
  there is something worth losing — Arise asks the browser to make this
  origin's storage persistent, so it is not evicted silently under storage
  pressure. It asks **once per device**; a user who declines is not nagged.
  More → Backup & portability shows the live status and a manual retry button.
  If the browser declines or does not support it, regular exports are the
  safety net.
- **Backup recency.** More shows "Last backup: *N* days ago" (or "never") and
  how many sessions are logged since. A backup counts as **overdue** at
  **more than 14 days** without one, or **10 or more sessions** since one —
  whichever comes first. Today shows a quiet nudge only while it is overdue;
  the weekly reminder in More is the softer, earlier signal.

## One-tap export

**Export JSON** hands the real backup file to the platform share sheet
("Save to Files", AirDrop, mail) on platforms that support sharing files, and
falls back to an ordinary download everywhere else. Either path marks the
backup as taken. A share you swipe away is not a backup, and is not counted.

## The playbook

**"I imported something and everything's wrong."**
More → Storage & diagnostics → restore the pre-import snapshot. Imports
take a snapshot first precisely for this. No snapshot? Re-import your other
backup with Merge (not Replace).

**"The app boots to a recovery screen."**
Accept **repair from last snapshot**. If that fails, use **import a backup**
from your export file. Only start empty if you accept losing history — and
even then the quarantined payload is kept for a future deeper repair.

**"I'm switching devices."**
Old device: export (encrypt if the file will travel through shared
storage). New device: install, import, choose Merge. Verify a couple of
sessions and your PR list look right before clearing anything.

**"My browser cleared its data."**
This is the one hole local-first cannot close from inside the browser —
site data clears are total. Restore: import your latest backup file. If
your last export is old, the snapshots died with the site data too. Hence:
**export after meaningful milestones** (weekly is a good rhythm; the app
nudges you).

**"Sync is on — am I safe?"**
The remote WebDAV file is a real backup of the last successful sync. But it
is one versioned payload, not versioned history — treat it as a
convenience copy, keep exporting if the history matters to you.

## Import is refuse-first

Importing is a two-step flow: the file is parsed and previewed, and **nothing
is applied until you confirm**. Files are refused before anything is shown:

- a file that names a **different app** is rejected outright — the unbranded
  adapter accepts anonymous snapshots, but never another product's backup;
- non-JSON, oversized, deeply nested or prototype-polluting payloads are
  stripped or rejected;
- impossible values (negative or implausible weights, reps, RPE) fail
  validation.

A refused file leaves your existing data untouched. This is covered end-to-end
in `e2e/backup-roundtrip.spec.js`, which logs sessions, exports, **deletes
IndexedDB entirely**, restores, and asserts history, derived attributes and
level are identical — plus that a hostile file changes nothing.

## Habits that make recovery boring

- Export after each Weekly Review.
- Encrypt backups that live in cloud drives.
- One backup per device label, dated. Two minutes a month.
- Check the diagnostics screen's storage-health line once in a while —
  quota warnings come before evictions.
