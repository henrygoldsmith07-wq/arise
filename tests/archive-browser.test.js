import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { idbClearStore, idbGetAll, idbPut } from '../src/lib/idb.js';
import { auditStore } from '../src/lib/audit.js';
import {
  ARCHIVE_META_ID,
  listArchivedSessions,
  restoreArchivedSession,
} from '../src/lib/archive.js';

beforeEach(async () => {
  await idbClearStore('archive');
  await idbClearStore('sessions');
  await idbClearStore('sets');
});

describe('archive browser queries', () => {
  it('lists only sessions, newest first, excluding archive metadata', async () => {
    await idbPut('archive', { id: ARCHIVE_META_ID, lastArchivedAt: '2026-01-01T00:00:00Z' });
    await idbPut('archive', { id: 'old-1', dateISO: '2024-01-10', title: 'Older', blocks: [] });
    await idbPut('archive', { id: 'old-2', dateISO: '2025-06-20', title: 'Newer', blocks: [] });

    const rows = await listArchivedSessions();

    assert.deepEqual(rows.map((row) => row.id), ['old-2', 'old-1']);
  });

  it('restores one archived session without moving the others', async () => {
    await idbPut('archive', { id: 'session-a', dateISO: '2024-01-10', blocks: [] });
    await idbPut('archive', { id: 'session-b', dateISO: '2024-02-10', blocks: [] });

    assert.equal(await restoreArchivedSession('session-a'), true);

    const archived = await listArchivedSessions();
    const live = await idbGetAll('sessions');
    assert.deepEqual(archived.map((row) => row.id), ['session-b']);
    assert.deepEqual(live.map((row) => row.id), ['session-a']);
  });

  it('does nothing for missing or metadata ids', async () => {
    await idbPut('archive', { id: 'session-a', dateISO: '2024-01-10', blocks: [] });

    assert.equal(await restoreArchivedSession('missing'), false);
    assert.equal(await restoreArchivedSession(ARCHIVE_META_ID), false);
    assert.deepEqual((await listArchivedSessions()).map((row) => row.id), ['session-a']);
  });


  it('does not report set rows owned by archived sessions as orphaned', async () => {
    await idbPut('archive', { id: 'session-a', dateISO: '2024-01-10', blocks: [] });
    await idbPut('sets', {
      id: 'set-a',
      sessionId: 'session-a',
      blockIndex: 0,
      setIndex: 0,
      reps: '8',
      weightKg: '60',
      dateISO: '2024-01-10',
    });

    const audit = await auditStore();

    assert.equal(audit.findings.some((finding) => finding.type === 'orphaned-set'), false);
  });
});
