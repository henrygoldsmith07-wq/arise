// Entity-storage suite: indexed queries + pagination + lazy loading, archive
// mode, event pruning, automatic snapshots + rollback, data-hygiene audit and
// repair, migration dry-run/logs, compressed exports. Runs against the shared
// in-memory IDB fallback (same semantics as the browser backend).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateStorage, persistStore, whenPersisted, loadStoreFromIdb } from '../src/lib/storage.js';
import { idbTransaction } from '../src/lib/idb-tx.js';
import { idbGetAll } from '../src/lib/idb.js';
import { querySessionsPage, queryMoreSessions, querySetsByExercise, querySetsBySession, querySetsByDate } from '../src/lib/queries.js';
import { archiveOldSessions, archiveCandidateCount, archivedSessionCount, restoreArchive, pruneEvents } from '../src/lib/archive.js';
import { captureSnapshot, listSnapshots, rollbackToSnapshot } from '../src/lib/snapshots.js';
import { auditStore, repairFindings } from '../src/lib/audit.js';
import { dryRunMigration, migrateWithLogging, logMigration, listMigrationLogs } from '../src/lib/migrationLog.js';
import { compressPayload, decompressPayload, BACKUP_FORMAT } from '../src/lib/export.js';
import { STORE_SCHEMA_VERSION } from '../src/lib/store.js';

function set(reps, kg){ return { reps:String(reps), weightKg:String(kg), rpe:'' }; }
function session(id, dateISO, exerciseId = 'bench-press-dumbbell'){
  return { id, dateISO, blocks:[{ exerciseId, sets:[set(8,20), set(9,22)] }] };
}
function seedStore(){
  return {
    version: STORE_SCHEMA_VERSION,
    onboarding: { goal:'muscle', equipment:['dumbbells'], location:'home' },
    preferences: { units:'kg', theme:'dark', telemetryEnabled:true },
    healthSummary: null,
    activeSchedule: { programId:'p1', mesocycle:{ weeks:4, deloadWeek:null }, adaptationHistory:[], sessions:[] },
    programHistory: [ { programId:'p1', version:1, startDateISO:'2026-01-05' } ],
    history: [
      session('h1', '2026-01-05'),
      session('h2', '2026-01-08', 'dumbbell-row'),
      session('h-old', '2020-06-01', 'dumbbell-row'),
    ],
    eventHistory: [
      { id:'e1', type:'session:complete', at:'2026-01-05T10:00:00Z' },
      { id:'e-old', type:'session:complete', at:'2020-01-01T10:00:00Z' },
    ],
    readinessLog: [ { dateISO:'2026-01-05', score:75 } ],
    evaluationLedger: [],
    customTemplates: [],
  };
}

await hydrateStorage();

describe('indexed queries, pagination and lazy loading', ()=>{
  it('a save decomposes history into queryable stores', async ()=>{
    await persistStore(seedStore());
    await whenPersisted();
    const sets = await idbGetAll('sets');
    assert.equal(sets.length, 6); // 3 sessions x 2 sets
  });

  it('pages sessions newest-first with a lazy-loading cursor', async ()=>{
    const page1 = await querySessionsPage({ offset:0, limit:2 });
    assert.equal(page1.sessions.length, 2);
    assert.equal(page1.total, 3);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.sessions[0].id, 'h2'); // newest first
    const page2 = await queryMoreSessions(page1);
    assert.equal(page2.sessions.length, 1);
    assert.equal(page2.hasMore, false);
    assert.equal(page2.sessions[0].id, 'h-old');
  });

  it('answers by exercise, session and date without loading history wholesale', async ()=>{
    const bench = await querySetsByExercise('bench-press-dumbbell');
    assert.equal(bench.length, 2);
    assert.ok(bench.every((r)=> r.exerciseId === 'bench-press-dumbbell'));
    const h1 = await querySetsBySession('h1');
    assert.equal(h1.length, 2);
    assert.deepEqual(h1.map((r)=> [r.blockIndex, r.setIndex]), [[0,0],[0,1]]);
    const day = await querySetsByDate('2026-01-08');
    assert.equal(day.length, 2);
  });
});

describe('archive mode and event pruning', ()=>{
  it('archives sessions older than the cutoff and restores them', async ()=>{
    assert.equal(await archiveCandidateCount(365), 1);
    const result = await archiveOldSessions(365);
    assert.equal(result.archived, 1);
    assert.equal((await loadStoreFromIdb()).history.length, 2);
    assert.equal(await archivedSessionCount(), 1);
    const restored = await restoreArchive();
    assert.equal(restored, 1);
    assert.equal((await loadStoreFromIdb()).history.length, 3);
  });

  it('prunes stale telemetry but keeps migration logs', async ()=>{
    await logMigration({ from:1, to:STORE_SCHEMA_VERSION });
    // Both seeded events (2020 and Jan 2026) are older than the 180-day window.
    const preview = await pruneEvents({ maxAgeDays:180, dryRun:true });
    assert.equal(preview.pruned, 2);
    const real = await pruneEvents({ maxAgeDays:180 });
    assert.equal(real.pruned, 2);
    const events = await idbGetAll('events');
    assert.ok(events.some((e)=> e.type === 'migration'));
    assert.ok(!events.some((e)=> e.id === 'e-old'));
    assert.ok(!events.some((e)=> e.id === 'e1'));
  });
});

describe('automatic snapshots and rollback', ()=>{
  it('captures a restorable snapshot and rolls the stores back to it', async ()=>{
    const snapId = await captureSnapshot({ force:true, reason:'test' });
    assert.ok(snapId);
    assert.equal((await listSnapshots()).length, 1);
    // Damage the world: drop one session.
    const damaged = seedStore();
    damaged.history = damaged.history.filter((h)=> h.id !== 'h2');
    await persistStore(damaged);
    await whenPersisted();
    assert.equal((await loadStoreFromIdb()).history.length, 2);
    // Roll back: everything from the snapshot returns, atomically.
    await rollbackToSnapshot();
    const restored = await loadStoreFromIdb();
    assert.equal(restored.history.length, 3);
    assert.ok(restored.history.some((h)=> h.id === 'h2'));
  });
});

describe('data hygiene audit and repair', ()=>{
  it('detects duplicate sets, orphans, invalid dates and impossible values', async ()=>{
    const sets = await idbGetAll('sets');
    const bad = [
      { ...sets[0], id:'dup-1' },                              // duplicate position
      { ...sets[0], id:'orphan-1', sessionId:'ghost' },        // no parent session
      { ...sets[0], id:'impossible-1', reps:'9999', weightKg:'9999' },
    ];
    await idbTransaction(['sessions','sets'], (ops)=>{
      for(const row of bad) ops.put('sets', row);
      ops.put('sessions', { id:'bad-date', dateISO:'not-a-date', blocks:[] });
    });
    const { findings, ok } = await auditStore();
    assert.equal(ok, false);
    const types = new Set(findings.map((f)=> f.type));
    assert.ok(types.has('duplicate-set'));
    assert.ok(types.has('orphaned-set'));
    assert.ok(types.has('impossible-value'));
    assert.ok(types.has('invalid-date'));
  });

  it('repairs every detected class atomically and comes out clean', async ()=>{
    const { findings } = await auditStore();
    const result = await repairFindings(findings);
    assert.ok(result.deletedSets >= 2);
    assert.ok(result.deletedSessions >= 1);
    assert.equal(result.neutralisedSets, 1);
    const after = await auditStore();
    assert.equal(after.ok, true);
    const sets = await idbGetAll('sets');
    const fixed = sets.find((r)=> r.id === 'impossible-1');
    assert.equal(Number(fixed.reps), 100); // clamped, flagged, kept
    assert.equal(fixed.audited, true);
  });

  it('does not flag empty (unlogged) values as impossible', async ()=>{
    await idbTransaction(['sets'], (ops)=>{
      ops.put('sets', { id:'empty-1', sessionId:'h1', dateISO:'2026-01-05', exerciseId:'x', blockIndex:9, setIndex:0, reps:'', weightKg:null, rpe:'' });
    });
    const { ok } = await auditStore();
    assert.equal(ok, true);
    await idbTransaction(['sets'], (ops)=> ops.delete('sets', 'empty-1'));
  });
});

describe('migration dry-run, logs and failure recovery', ()=>{
  it('dry-run reports the destination version without touching the payload', ()=>{
    const raw = { version:1, history:[ { id:'a', dateISO:'2026-01-01', blocks:[] } ] };
    const result = dryRunMigration(raw);
    assert.equal(result.ok, true);
    assert.equal(result.from, 1);
    assert.equal(result.to, STORE_SCHEMA_VERSION);
    assert.equal(result.preview.version, STORE_SCHEMA_VERSION);
    assert.equal(raw.version, 1); // untouched
  });

  it('migrateWithLogging migrates and appends a durable log row', async ()=>{
    const migrated = await migrateWithLogging({ version:1, history:[] });
    assert.equal(migrated.version, STORE_SCHEMA_VERSION);
    const logs = await listMigrationLogs();
    assert.ok(logs.some((l)=> l.from === 1 && l.to === STORE_SCHEMA_VERSION && !l.dryRun));
  });
});

describe('compressed exports', ()=>{
  it('compresses large payloads into a versioned envelope and round-trips', async ()=>{
    const payload = { app:'arise', version:3, data:{ history: seedStore().history, notes:'x'.repeat(4000) } };
    const { envelope, compressed } = await compressPayload(payload);
    assert.equal(compressed, true);
    assert.equal(envelope.format, BACKUP_FORMAT);
    assert.equal(envelope.encoding, 'base64');
    const back = await decompressPayload(envelope);
    assert.deepEqual(back, payload);
  });

  it('passes small or incompressible payloads through as plain JSON', async ()=>{
    const payload = { app:'arise', version:3, data:{} };
    const { envelope, compressed } = await compressPayload(payload);
    assert.equal(compressed, false);
    assert.deepEqual(await decompressPayload(envelope), payload);
  });
});
