import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { idbClearStore, idbGetAll, idbPut } from '../src/lib/idb.js';
import { auditStore } from '../src/lib/audit.js';
import { ARCHIVE_META_ID, archivedSessionCount, restoreArchive } from '../src/lib/archive.js';

beforeEach(async () => {
  await idbClearStore('archive');
  await idbClearStore('sessions');
  await idbClearStore('sets');
});

describe('archive integrity', () => {
  it('counts sessions without archive metadata', async () => {
    await idbPut('archive', { id: ARCHIVE_META_ID, lastArchivedAt: '2026-01-01T00:00:00Z' });
    await idbPut('archive', { id: 'old-1', dateISO: '2024-01-10', blocks: [] });
    assert.equal(await archivedSessionCount(), 1);
  });

  it('restores archived sessions and rebuilds flattened set mirrors', async () => {
    await idbPut('archive', {
      id: 'session-a',
      dateISO: '2024-01-10',
      blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '8', weightKg: '60', rpe: '8' }] }],
    });

    assert.equal(await restoreArchive(), 1);

    const live = await idbGetAll('sessions');
    const sets = await idbGetAll('sets');
    assert.deepEqual(live.map((row) => row.id), ['session-a']);
    assert.deepEqual(sets.map((row) => row.id), ['session-a:0:0']);
    assert.equal(sets[0].exerciseId, 'bench-press');
    assert.equal(sets[0].weightKg, '60');
  });

  it('does not report set rows owned by archived sessions as orphaned', async () => {
    await idbPut('archive', { id: 'session-a', dateISO: '2024-01-10', blocks: [] });
    await idbPut('sets', {
      id: 'set-a', sessionId: 'session-a', blockIndex: 0, setIndex: 0,
      reps: '8', weightKg: '60', dateISO: '2024-01-10',
    });
    const audit = await auditStore();
    assert.equal(audit.findings.some((finding) => finding.type === 'orphaned-set'), false);
  });
});
