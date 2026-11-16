// data-integrity-fixes.test.js — regressions for the evidence-backed correctness pass.
// Covers: canonical-history clamp on repair, archive tie-breaking, no double
// booking on move, UTC week bucketing, unchanged-event save short-circuit, and
// duplicate-tombstone prevention on repeated experiment soft-delete.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hydrateStorage, loadStoreFromIdb, persistStore, setCachedStore, getCachedStore, whenPersisted,
} from '../src/lib/storage.js';
import { idbGetAll } from '../src/lib/idb.js';
import { idbTransaction } from '../src/lib/idb-tx.js';
import { auditStore, repairFindings } from '../src/lib/audit.js';
import { restoreArchive } from '../src/lib/archive.js';
import { moveSession } from '../src/lib/weekdaySchedule.js';
import { weeklyVolume } from '../src/lib/analytics.js';
import { createExperimentRepository } from '../src/repositories/index.js';

await hydrateStorage();

describe('repairFindings clamps canonical history as well as the flattened mirror', ()=>{
  it('rewrites sessions[].blocks[].sets[].reps/weightKg for a clamped set', async ()=>{
    await idbTransaction(['sessions', 'sets'], (ops)=> {
      ops.put('sessions', {
        id: 'integrity-s1',
        dateISO: '2026-02-02',
        blocks: [{ exerciseId: 'bench', sets: [
          { reps: '9999', weightKg: '9999', rpe: '' },
          { reps: '8', weightKg: '20', rpe: '' },
        ] }],
      });
      ops.put('sets', {
        id: 'integrity-s1:0:0', sessionId: 'integrity-s1', dateISO: '2026-02-02',
        exerciseId: 'bench', blockIndex: 0, setIndex: 0, reps: '9999', weightKg: '9999', rpe: '',
      });
    });

    const { findings } = await auditStore();
    const impossible = findings.find((f) => f.type === 'impossible-value');
    assert.ok(impossible && impossible.ids.includes('integrity-s1:0:0'), 'the clone is detected');

    await repairFindings([impossible]);

    const mirror = (await idbGetAll('sets')).find((r) => r.id === 'integrity-s1:0:0');
    assert.equal(mirror.reps, '100');
    assert.equal(mirror.weightKg, '500');
    assert.equal(mirror.audited, true);

    const canonical = (await idbGetAll('sessions')).find((s) => s.id === 'integrity-s1');
    assert.equal(canonical.blocks[0].sets[0].reps, '100', 'canonical reps clamped');
    assert.equal(canonical.blocks[0].sets[0].weightKg, '500', 'canonical weight clamped');
    assert.equal(canonical.blocks[0].sets[1].reps, '8', 'unaffected set preserved');

    // A subsequent save re-splits canonical sets back into the mirror. It must
    // stay repaired instead of reverting to the impossible numbers.
    await persistStore(await loadStoreFromIdb());
    const rebuilt = (await idbGetAll('sets')).find((r) => r.id === 'integrity-s1:0:0');
    assert.equal(rebuilt.reps, '100', 'repair survives a save/hydration round trip');
    assert.equal(rebuilt.weightKg, '500');
  });
});

describe('restoreArchive honours live-wins on timestamp ties', ()=>{
  it('does not overwrite an equally-timestamped live session', async ()=>{
    const id = 'tie-session';
    await idbTransaction(['sessions', 'archive'], (ops)=> {
      ops.put('sessions', { id, dateISO: '2026-01-10', marker: 'live', blocks: [] });
      ops.put('archive', { id, dateISO: '2026-01-10', marker: 'archived', blocks: [] });
    });
    const restored = await restoreArchive();
    assert.equal(restored, 0, 'a tie is not a restore');
    const live = (await idbGetAll('sessions')).find((s) => s.id === id);
    assert.equal(live.marker, 'live', 'live copy survives the tie');
  });
});

describe('moveSession keeps the no-double-booking contract', ()=>{
  it('rejects a move when two other sessions already occupy the target date', ()=>{
    const schedule = { rev: 1, sessions: [
      { id: 'mover', dateISO: '2026-03-02', status: 'planned' },
      { id: 'x', dateISO: '2026-03-09', status: 'planned' },
      { id: 'y', dateISO: '2026-03-09', status: 'planned' },
    ] };
    const result = moveSession(schedule, 'mover', '2026-03-09');
    assert.equal(result.error, 'taken');
    assert.equal(result.schedule, schedule, 'original schedule is untouched');
  });

  it('still swaps with a single planned occupant', ()=>{
    const schedule = { rev: 1, sessions: [
      { id: 'mover', dateISO: '2026-03-02', status: 'planned' },
      { id: 'x', dateISO: '2026-03-09', status: 'planned' },
    ] };
    const result = moveSession(schedule, 'mover', '2026-03-09');
    assert.equal(result.error, null);
    assert.equal(result.swapped, 'x');
    assert.equal(result.schedule.sessions.find((s) => s.id === 'mover').dateISO, '2026-03-09');
    assert.equal(result.schedule.sessions.find((s) => s.id === 'x').dateISO, '2026-03-02');
  });

  it('still refuses to move into the past when todayISO is supplied', ()=>{
    const schedule = { rev: 1, sessions: [{ id: 'mover', dateISO: '2026-03-02', status: 'planned' }] };
    assert.equal(moveSession(schedule, 'mover', '2026-03-01', '2026-03-02').error, 'past');
  });
});

describe('analytics week buckets do not depend on the device timezone', ()=>{
  it('buckets a post-DST date into the same UTC week in every timezone', ()=>{
    const history = [{ id: 'dst-1', dateISO: '2024-03-11', blocks: [
      { exerciseId: 'bench', sets: [{ reps: '10', weightKg: '100' }] },
    ] }];
    const originalTZ = process.env.TZ;
    try{
      process.env.TZ = 'UTC';
      const utc = weeklyVolume(history);
      process.env.TZ = 'America/New_York';
      const ny = weeklyVolume(history);
      assert.deepEqual(ny, utc, 'week bucketing must be timezone independent');
      assert.deepEqual(ny, [{ week: '2024-W11', vol: 1000 }]);
    }finally{
      if(originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    }
  });
});

describe('setCachedStore does not rebuild an unchanged event history', ()=>{
  it('reuses the same array when incoming events are empty and current is settled', async ()=>{
    const persistSame = async (store) => store;
    const events = [
      { id: 'stable-e1', type: 'x', at: '2026-01-01T00:00:00Z' },
      { id: 'stable-e2', type: 'x', at: '2026-01-02T00:00:00Z' },
    ];
    setCachedStore({ history: [], evaluationLedger: [], eventHistory: events }, { persist: persistSame });
    await whenPersisted();
    const before = getCachedStore().eventHistory;
    assert.notEqual(before, events, 'the first save normalises the incoming list');

    // Next keystroke: identical store, no new events.
    setCachedStore({ ...getCachedStore(), eventHistory: [] }, { persist: persistSame });
    await whenPersisted();
    assert.equal(getCachedStore().eventHistory, before, 'unchanged events must not be rebuilt');

    // A genuinely new, out-of-order event still takes the full merge path.
    setCachedStore({ ...getCachedStore(), eventHistory: [{ id: 'stable-e0', type: 'x', at: '2025-12-31T00:00:00Z' }] }, { persist: persistSame });
    await whenPersisted();
    assert.deepEqual(getCachedStore().eventHistory.map((e) => e.id), ['stable-e0', 'stable-e1', 'stable-e2']);
  });
});

describe('experiment soft-delete does not append duplicate tombstones', ()=>{
  it('replaces any existing tombstone for the same entity + refId', async ()=>{
    // A synced/pre-existing tombstone for this experiment may carry a different
    // row id; the soft-delete must replace it, not append a second one.
    setCachedStore({
      history: [], evaluationLedger: [], eventHistory: [],
      experiments: [{ id: 'exp-1', name: 'test' }],
      tombstones: [{ id: 'synced-exp-1', entity: 'experiments', refId: 'exp-1', deletedAt: '2020-01-01T00:00:00.000Z', source: 'sync' }],
    });
    await whenPersisted();
    const repo = createExperimentRepository();
    await repo.softDelete('exp-1');
    const tombstones = (getCachedStore().tombstones || []).filter((t) => t.entity === 'experiments' && t.refId === 'exp-1');
    assert.equal(tombstones.length, 1, 'exactly one experiment tombstone survives');
    assert.notEqual(tombstones[0].id, 'synced-exp-1', 'the fresh tombstone replaced the old one');

    // A repeated delete keeps the single-tombstone invariant.
    await repo.softDelete('exp-1');
    const afterRepeat = (getCachedStore().tombstones || []).filter((t) => t.entity === 'experiments' && t.refId === 'exp-1');
    assert.equal(afterRepeat.length, 1, 'repeated delete still leaves one tombstone');
  });
});
