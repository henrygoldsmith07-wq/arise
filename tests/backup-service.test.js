import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_OVERDUE_DAYS,
  BACKUP_REMINDER_INTERVAL_MS,
  LAST_FULL_BACKUP_AT_KEY,
  SESSIONS_SINCE_BACKUP_WARN,
  backupRecency,
  backupRecencyLabel,
  backupReminderDue,
  dismissBackupReminder,
  markSuccessfulFullBackup,
  readBackupState,
  sessionsSinceBackup,
} from '../src/lib/backupState.js';
import { downloadEncryptedFullBackup, downloadFullBackup, exportFullBackup } from '../src/services/backupService.js';

function memoryStorage(){
  const values = new Map();
  return {
    getItem:key=> values.has(key) ? values.get(key) : null,
    setItem:(key,value)=> values.set(key, String(value)),
    removeItem:key=> values.delete(key),
  };
}

describe('full-backup state', ()=>{
  it('uses a clean full-backup key instead of the historically contaminated export key', ()=>{
    assert.equal(LAST_FULL_BACKUP_AT_KEY, 'arise.lastFullBackupAt.v1');
  });

  it('records only explicit successful full backups and reminder dismissal separately', ()=>{
    const storage = memoryStorage();
    markSuccessfulFullBackup({ storage, atISO:'2026-09-20T12:00:00.000Z' });
    dismissBackupReminder({ storage, atISO:'2026-09-21T12:00:00.000Z' });
    assert.deepEqual(readBackupState(storage), {
      lastBackupAt:'2026-09-20T12:00:00.000Z',
      dismissedAt:'2026-09-21T12:00:00.000Z',
    });
  });

  it('nudges after a week of training without a full backup', ()=>{
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    assert.equal(backupReminderDue({
      history:[{ dateISO:'2026-09-18' }],
      nowMs:now,
    }), true);
    assert.equal(backupReminderDue({
      history:[{ dateISO:'2026-09-25' }],
      nowMs:now,
    }), false);
  });

  it('honours a recent full backup or reminder dismissal', ()=>{
    const now = Date.parse('2026-09-26T12:00:00.000Z');
    assert.equal(backupReminderDue({
      history:[{ dateISO:'2026-09-01' }],
      lastBackupAt:'2026-09-25T12:00:00.000Z',
      nowMs:now,
    }), false);
    assert.equal(backupReminderDue({
      history:[{ dateISO:'2026-09-01' }],
      dismissedAt:'2026-09-25T12:00:00.000Z',
      nowMs:now,
    }), false);
    assert.equal(backupReminderDue({
      history:[{ dateISO:'2026-09-01' }],
      dismissedAt:new Date(now - BACKUP_REMINDER_INTERVAL_MS - 1).toISOString(),
      nowMs:now,
    }), true);
  });
});

describe('backup download lifecycle', ()=>{
  it('marks a plain backup only after download initiation succeeds', async ()=>{
    const storage = memoryStorage();
    const calls = [];
    await downloadFullBackup({ history:[] }, {
      atISO:'2026-09-26T12:00:00.000Z',
      storage,
      buildPayload:store=> ({ app:'test', count:store.history.length }),
      download:async (payload, filename)=> { calls.push({ payload, filename }); },
    });
    assert.equal(calls[0].filename, 'arise-backup-2026-09-26.arise');
    assert.equal(readBackupState(storage).lastBackupAt, '2026-09-26T12:00:00.000Z');
  });

  it('does not mark a failed plain backup', async ()=>{
    const storage = memoryStorage();
    await assert.rejects(()=> downloadFullBackup({}, {
      storage,
      buildPayload:()=> ({ app:'test' }),
      download:async ()=> { throw new Error('download failed'); },
    }), /download failed/);
    assert.equal(readBackupState(storage).lastBackupAt, null);
  });

  it('does not mark cancelled/invalid or failed encrypted backup attempts', async ()=>{
    const storage = memoryStorage();
    await assert.rejects(()=> downloadEncryptedFullBackup({}, 'short', {
      storage,
      buildPayload:()=> ({ app:'test' }),
      encrypt:async ()=> new Uint8Array([1]),
      triggerDownload:async ()=> {},
    }), /at least 8/);
    assert.equal(readBackupState(storage).lastBackupAt, null);

    await assert.rejects(()=> downloadEncryptedFullBackup({}, 'long-enough-pass', {
      storage,
      buildPayload:()=> ({ app:'test' }),
      encrypt:async ()=> { throw new Error('encrypt failed'); },
      triggerDownload:async ()=> {},
    }), /encrypt failed/);
    assert.equal(readBackupState(storage).lastBackupAt, null);
  });

  it('marks an encrypted backup only after the encrypted file trigger succeeds', async ()=>{
    const storage = memoryStorage();
    let triggered = false;
    await downloadEncryptedFullBackup({}, 'long-enough-pass', {
      atISO:'2026-09-26T13:00:00.000Z',
      storage,
      buildPayload:()=> ({ app:'test' }),
      encrypt:async ()=> new Uint8Array([1,2,3]),
      triggerDownload:async (bytes, filename)=> {
        triggered = true;
        assert.deepEqual([...bytes], [1,2,3]);
        assert.equal(filename, 'arise-backup-2026-09-26.arisebak');
      },
    });
    assert.equal(triggered, true);
    assert.equal(readBackupState(storage).lastBackupAt, '2026-09-26T13:00:00.000Z');
  });
});

describe('backup recency', ()=>{
  const NOW = Date.parse('2026-10-01T12:00:00.000Z');

  it('counts sessions that exist only on this device', ()=>{
    const history = [
      { id:'a', savedAt:'2026-09-20T10:00:00.000Z' },
      { id:'b', savedAt:'2026-09-28T10:00:00.000Z' },
      { id:'c', savedAt:'2026-09-30T10:00:00.000Z' },
    ];
    assert.equal(sessionsSinceBackup({ history, lastBackupAt:'2026-09-25T00:00:00.000Z' }), 2);
  });

  it('treats a session with an unreadable timestamp as at risk, not as safe', ()=>{
    const history = [{ id:'good', savedAt:'2026-09-30T10:00:00.000Z' }, { id:'blank' }];
    assert.equal(sessionsSinceBackup({ history, lastBackupAt:'2026-09-25T00:00:00.000Z' }), 2);
  });

  it('never nags a user who has not logged anything', ()=>{
    const summary = backupRecency({ history:[], nowMs:NOW });
    assert.equal(summary.overdue, false);
    assert.equal(summary.sessions, 0);
  });

  it('goes overdue after the day threshold', ()=>{
    const history = [{ id:'a', savedAt:'2026-09-01T10:00:00.000Z' }];
    const justInside = backupRecency({ history, lastBackupAt:new Date(NOW - (BACKUP_OVERDUE_DAYS - 1) * 86400000).toISOString(), nowMs:NOW });
    const justOutside = backupRecency({ history, lastBackupAt:new Date(NOW - (BACKUP_OVERDUE_DAYS + 1) * 86400000).toISOString(), nowMs:NOW });
    assert.equal(justInside.overdue, false);
    assert.equal(justOutside.overdue, true);
  });

  it('goes overdue on session count even when the days are fresh', ()=>{
    const backupAt = new Date(NOW - 3600000).toISOString(); // 1h ago
    const history = Array.from({ length:SESSIONS_SINCE_BACKUP_WARN }, (_, i)=> ({
      id:`s${i}`,
      savedAt:new Date(NOW - (i + 1) * 1000).toISOString(), // all after the backup
    }));
    const summary = backupRecency({ history, lastBackupAt:backupAt, nowMs:NOW });
    assert.equal(summary.overdue, true);
    assert.equal(summary.sessions, SESSIONS_SINCE_BACKUP_WARN);
    assert.equal(summary.daysSince, 0);
  });

  it('reports never-backed-up separately from backed-up-but-old', ()=>{
    const history = [{ id:'a', savedAt:'2026-09-30T10:00:00.000Z' }];
    const summary = backupRecency({ history, nowMs:NOW });
    assert.equal(summary.never, true);
    assert.equal(backupRecencyLabel(summary), 'Last backup: never');
  });

  it('labels the recency in plain days', ()=>{
    assert.equal(backupRecencyLabel({ never:false, daysSince:0 }), 'Last backup: today');
    assert.equal(backupRecencyLabel({ never:false, daysSince:1 }), 'Last backup: 1 day ago');
    assert.equal(backupRecencyLabel({ never:false, daysSince:9 }), 'Last backup: 9 days ago');
  });
});

describe('one-tap export delivery', ()=>{
  it('marks a backup only once the share sheet actually took the file', async ()=>{
    const storage = memoryStorage();
    const built = [];
    const result = await exportFullBackup({ history:[] }, {
      atISO:'2026-09-26T12:00:00.000Z',
      storage,
      buildPayload:store=> ({ app:'test' }),
      buildFile:(payload, filename)=> ({ payload, filename }),
      canShare:()=> true,
      share:async ()=> 'shared',
      download:async ()=> { throw new Error('download must not run when the share sheet succeeds'); },
    });
    assert.equal(result.method, 'shared');
    assert.equal(readBackupState(storage).lastBackupAt, '2026-09-26T12:00:00.000Z');
  });

  it('does not mark a backup when the user swipes the share sheet away', async ()=>{
    const storage = memoryStorage();
    const result = await exportFullBackup({ history:[] }, {
      atISO:'2026-09-26T12:00:00.000Z',
      storage,
      buildPayload:()=> ({ app:'test' }),
      buildFile:(payload, filename)=> ({ payload, filename }),
      canShare:()=> true,
      share:async ()=> 'cancelled',
      download:async ()=> { throw new Error('a cancelled share must not silently download'); },
    });
    assert.equal(result.method, 'cancelled');
    assert.equal(readBackupState(storage).lastBackupAt, null);
  });

  it('falls back to a download when the platform cannot share files', async ()=>{
    const storage = memoryStorage();
    const downloads = [];
    const result = await exportFullBackup({ history:[] }, {
      atISO:'2026-09-26T12:00:00.000Z',
      storage,
      buildPayload:()=> ({ app:'test' }),
      // canShareFiles() is false under node:test (no navigator/File), so the
      // download fallback is the path exercised here.
      share:async ()=> { throw new Error('share must not be attempted when canShare is false'); },
      download:async (payload, filename)=> { downloads.push(filename); },
    });
    assert.equal(result.method, 'downloaded');
    assert.deepEqual(downloads, ['arise-backup-2026-09-26.arise']);
    assert.equal(readBackupState(storage).lastBackupAt, '2026-09-26T12:00:00.000Z');
  });
});
