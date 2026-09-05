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

## Habits that make recovery boring

- Export after each Weekly Review.
- Encrypt backups that live in cloud drives.
- One backup per device label, dated. Two minutes a month.
- Check the diagnostics screen's storage-health line once in a while —
  quota warnings come before evictions.
