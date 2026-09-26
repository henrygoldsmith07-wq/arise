import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_REMINDER_INTERVAL_MS,
  LAST_FULL_BACKUP_AT_KEY,
  backupReminderDue,
  dismissBackupReminder,
  markSuccessfulFullBackup,
  readBackupState,
} from '../src/lib/backupState.js';
import { downloadEncryptedFullBackup, downloadFullBackup } from '../src/services/backupService.js';

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
