// backup-sync-recovery.test.js — production-grade guarantees for backup,
// rollback, archive and multi-device sync.
//
// Covers the required regression scenarios:
//   1. archive → full backup → wipe → restore
//   2. archive → WebDAV sync → fresh device
//   3. atomic snapshot capture during concurrent save
//   4. corrupted snapshot refused before mutation
//   5. valid snapshot restores all canonical stores
//   6. active workout newer peer wins
//   7. active schedule revision converges
//   8. gymPrefs converge regardless of sync direction
//   9. newest tombstone wins
//  10. tombstone entity isolation
//  11. edit-after-delete vs delete-after-edit
//  12. two-device repeated sync reaches a fixed point
//  13. study participant/enrollment state remains coherent (fail-closed)
//  14. credentials/consent remain device-local
// Plus snapshot specifics: profile/readiness/session-date/programme
// corruption, archived sessions, ledger restoration and rollback after
// subsequent mutations; algebraic sync properties (commutativity where
// permitted, idempotence, convergence over A→B→A and A→B→C→A);
// archive+tombstone interaction; deletion preview and salvage coverage.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { persistStore, loadStoreFromIdb } from '../src/lib/storage.js';
import { idbGet, idbGetAll, idbPut, STORES } from '../src/lib/idb.js';
import { idbReadTransaction, idbTransaction } from '../src/lib/idb-tx.js';
import { captureSnapshot, rollbackToSnapshot, recomposeSnapshotPayload, listSnapshots } from '../src/lib/snapshots.js';
import { archiveOldSessions, restoreArchive } from '../src/lib/archive.js';
import { buildExportPayload, parseImportFile, mergeStores, deletionPreview } from '../src/lib/export.js';
import { buildSalvagePayload } from '../src/lib/salvageExport.js';
import {
  mergeStoresWithConflicts, mergeActiveWorkout, mergeActiveSchedule,
  mergeGymPrefs, mergePortablePreferences, DEVICE_LOCAL_PREF_KEYS,
} from '../src/lib/sync.js';
import { mergeTombstones, applyTombstones, makeTombstone, isValidTombstone } from '../src/lib/domain.js';
import { runSync, defaultSyncConfig } from '../src/lib/syncEngine.js';
import { STORE_SCHEMA_VERSION } from '../src/lib/store.js';

function set(reps, kg){ return { reps: String(reps), weightKg: String(kg), rpe: '' }; }
function session(id, dateISO, savedAt = null, weightKg = 20){
  return {
    id, dateISO,
    savedAt: savedAt || `${dateISO}T10:00:00Z`,
    blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(8, weightKg)] }],
  };
}
function baseStore(overrides = {}){
  return {
    version: STORE_SCHEMA_VERSION,
    onboarding: { goal: 'muscle', equipment: ['dumbbells'], location: 'home' },
    preferences: { units: 'kg' },
    healthSummary: null,
    activeSchedule: { programId: 'p1', startDateISO: '2026-01-05', sessions: [], rev: 1, updatedAt: '2026-01-05T10:00:00Z' },
    programHistory: [{ programId: 'p1', version: 1, startDateISO: '2026-01-05' }],
    history: [session('h-live', '2026-06-01')],
    archivedHistory: [],
    eventHistory: [{ id: 'e1', type: 'session:complete', at: '2026-06-01T10:00:00Z' }],
    readinessLog: [{ dateISO: '2026-06-01', score: 75 }],
    evaluationLedger: [{ id: 'r-open', recommendation: { load: 22, reps: 8 }, outcome: null, exerciseId: 'bench-press-dumbbell' }],
    customTemplates: [],
    tombstones: [],
    gymPrefs: null,
    activeWorkout: null,
    studyParticipantId: 'abcdef1234567890',
    studyEnrollment: null,
    studyStatus: null,
    studyStatusChangedAtISO: null,
    ...overrides,
  };
}

async function freshDb(){
  // Direct store wipe without the storage.js `cleared` latch (which is meant
  // for deliberate user wipes, not test isolation).
  try{ await idbTransaction([...STORES], (ops)=>{ for(const s of STORES) ops.clearStore(s); }); }catch{}
}

function portableOf(store){
  // Portable convergent subset: everything that must converge, minus
  // deliberately device-local fields.
  const prefs = { ...(store.preferences || {}) };
  for(const k of DEVICE_LOCAL_PREF_KEYS) delete prefs[k];
  return {
    history: store.history, archivedHistory: store.archivedHistory,
    activeWorkout: store.activeWorkout, activeSchedule: store.activeSchedule,
    gymPrefs: store.gymPrefs, preferences: prefs,
    readinessLog: store.readinessLog, eventHistory: store.eventHistory,
    evaluationLedger: store.evaluationLedger, programHistory: store.programHistory,
    tombstones: store.tombstones, customTemplates: store.customTemplates,
  };
}

describe('1. archive → full backup → wipe → restore', ()=>{
  it('live history → archive old sessions → export → clear device → restore → all sessions present', async ()=>{
    await freshDb();
    const store = baseStore({
      history: [session('h-old', '2020-01-05'), session('h-new', '2026-06-01')],
    });
    await persistStore(store);
    const res = await archiveOldSessions(365);
    assert.equal(res.archived, 1);
    const composed = await loadStoreFromIdb();
    assert.equal(composed.history.length, 1);
    assert.equal(composed.history[0].id, 'h-new');
    assert.equal(composed.archivedHistory.length, 1);
    assert.equal(composed.archivedHistory[0].id, 'h-old');
    // Full JSON backup includes archived sessions.
    const payload = buildExportPayload({ ...store, history: composed.history, archivedHistory: composed.archivedHistory }, true);
    assert.equal(payload.data.history.length, 1);
    assert.equal(payload.data.archivedHistory.length, 1);
    assert.equal(payload.data.archivedHistory[0].id, 'h-old');
    // Wipe the device, then restore with replace semantics.
    await freshDb();
    assert.equal((await loadStoreFromIdb()), null);
    const imported = parseImportFile(JSON.stringify(payload));
    assert.equal(imported.archivedHistory.length, 1);
    const restored = mergeStores({ version: STORE_SCHEMA_VERSION }, imported, 'replace');
    await persistStore(restored);
    const after = await loadStoreFromIdb();
    const allIds = [...after.history.map((s) => s.id), ...after.archivedHistory.map((s) => s.id)].sort();
    assert.deepEqual(allIds, ['h-new', 'h-old']);
    // No duplicate across live/archived.
    const overlap = after.history.filter((s) => after.archivedHistory.some((a) => a.id === s.id));
    assert.equal(overlap.length, 0);
  });

  it('encrypted backup path carries the same complete payload shape', async ()=>{
    const store = baseStore({ archivedHistory: [session('h-old', '2020-01-05')] });
    const payload = buildExportPayload(store, true);
    // The encrypted envelope seals the already-built payload; the shape
    // guarantee lives in buildExportPayload (covered above + webdav E2E).
    assert.equal(payload.data.archivedHistory[0].id, 'h-old');
    const roundTripped = parseImportFile(JSON.stringify(payload));
    assert.equal(roundTripped.archivedHistory[0].id, 'h-old');
  });
});

describe('2. archive → sync → fresh device', ()=>{
  it('WebDAV-style pull/push carries archived sessions to a fresh device', async ()=>{
    const deviceA = baseStore({
      history: [session('h-new', '2026-06-01')],
      archivedHistory: [session('h-old', '2020-01-05')],
    });
    let remote = null;
    const adapter = { pull: async ()=> remote, push: async (body)=> { remote = body; } };
    const pushed = await runSync({ store: deviceA, config: defaultSyncConfig(), adapter, encryption: null });
    assert.equal(pushed.error, undefined);
    const freshB = baseStore({ history: [], archivedHistory: [], eventHistory: [], readinessLog: [], evaluationLedger: [] });
    const pulled = await runSync({ store: freshB, config: defaultSyncConfig(), adapter, encryption: null });
    assert.equal(pulled.error, undefined);
    const ids = [...pulled.merged.history.map((s) => s.id), ...pulled.merged.archivedHistory.map((s) => s.id)].sort();
    assert.deepEqual(ids, ['h-new', 'h-old']);
  });
});

describe('3. atomic snapshot capture during concurrent save', ()=>{
  it('a snapshot is one coherent point-in-time, never a mix of two saves', async ()=>{
    await freshDb();
    const gen1 = baseStore({
      history: [session('h-gen1', '2026-01-05')],
      activeSchedule: { programId: 'p1', startDateISO: '2026-01-05', sessions: [], rev: 1, updatedAt: '2026-01-05T10:00:00Z' },
    });
    await persistStore(gen1);
    // Old hazard, demonstrated explicitly: two separate reads with a save
    // between them mix generations.
    const sessionsFirst = await idbGetAll('sessions');
    const gen2 = baseStore({
      history: [session('h-gen2', '2026-02-05')],
      activeSchedule: { programId: 'p1', startDateISO: '2026-02-05', sessions: [], rev: 2, updatedAt: '2026-02-05T10:00:00Z' },
    });
    await persistStore(gen2);
    const programmeSecond = await idbGet('programme', 'active');
    assert.equal(sessionsFirst[0]?.id, 'h-gen1');
    assert.equal(programmeSecond?.activeSchedule?.rev, 2);
    // New guarantee: one readonly transaction cannot interleave.
    await persistStore(gen1);
    const readP = idbReadTransaction(['sessions', 'programme']);
    const writeP = persistStore(gen2);
    const [read] = await Promise.all([readP, writeP]);
    const coherentGen1 = read.sessions?.[0]?.id === 'h-gen1' && read.programme?.[0]?.activeSchedule?.rev === 1;
    const coherentGen2 = read.sessions?.[0]?.id === 'h-gen2' && read.programme?.[0]?.activeSchedule?.rev === 2;
    assert.ok(coherentGen1 || coherentGen2, `snapshot must be fully one generation, got ${read.sessions?.[0]?.id}/rev${read.programme?.[0]?.activeSchedule?.rev}`);
    // And captureSnapshot itself round-trips through the same helper.
    await persistStore(gen1);
    const id = await captureSnapshot({ force: true, reason: 'test' });
    assert.ok(id);
    const listed = await listSnapshots();
    assert.ok(listed.some((s) => s.id === id));
  });
});

describe('4-5. snapshot rollback validation and restoration', ()=>{
  it('4. corrupted snapshots are refused before any live store is modified', async ()=>{
    await freshDb();
    const healthy = baseStore({ history: [session('h-keep', '2026-06-01')] });
    await persistStore(healthy);
    const snapId = await captureSnapshot({ force: true, reason: 'test' });
    const before = await loadStoreFromIdb();
    const pristine = JSON.parse(JSON.stringify((await idbGetAll('snapshots')).find((r) => r.id === snapId)));
    assert.ok(pristine?.payload);
    const corruptions = {
      'profile corruption': (p)=> { p.profile = [{ id: 'profile', version: 'bogus', preferences: [] }]; },
      'readiness corruption': (p)=> { p.readiness = [{ id: 'log', log: 'not-an-array' }]; },
      'broken session dates': (p)=> { p.sessions = [{ id: 'h-bad', dateISO: 'not-a-date', blocks: [] }]; },
      'corrupted programme data': (p)=> { p.programme = [{ id: 'active', activeSchedule: 42 }]; },
    };
    for(const [name, corrupt] of Object.entries(corruptions)){
      const working = JSON.parse(JSON.stringify(pristine));
      corrupt(working.payload);
      await idbPut('snapshots', working, working.id);
      await assert.rejects(rollbackToSnapshot(snapId), /integrity gate|Snapshot/i, name);
      const after = await loadStoreFromIdb();
      assert.equal(after.history.length, before.history.length, `${name}: live history untouched`);
      assert.equal(after.history[0]?.id, 'h-keep', `${name}: live row untouched`);
      // Restore the pristine payload for the next iteration.
      await idbPut('snapshots', JSON.parse(JSON.stringify(pristine)), pristine.id);
    }
  });

  it('5. a valid snapshot restores every canonical store (incl. archive/ledger/events)', async ()=>{
    await freshDb();
    const full = baseStore({
      history: [session('h-live', '2026-06-01')],
      archivedHistory: [session('h-arch', '2020-01-05')],
      gymPrefs: { restPresets: { squat: 120 }, updatedAt: '2026-06-01T10:00:00Z' },
      activeWorkout: { session: { id: 's-draft' }, blocks: [], updatedAt: '2026-06-01T10:00:00Z' },
      activeSchedule: { programId: 'p1', startDateISO: '2026-06-01', sessions: [{ id: 's1' }], rev: 3, updatedAt: '2026-06-01T10:00:00Z' },
      readinessLog: [{ dateISO: '2026-06-01', score: 80 }],
      customTemplates: [{ id: 'tpl-1', program: {} }],
      tombstones: [makeTombstone('sessions', 'h-gone')],
      evaluationLedger: [
        { id: 'r-open', recommendation: { load: 22, reps: 8 }, outcome: null, exerciseId: 'x' },
        { id: 'r-done', recommendation: { load: 20, reps: 8 }, outcome: { metTarget: true }, exerciseId: 'x' },
      ],
      eventHistory: [{ id: 'e9', type: 'session:complete', at: '2026-06-01T10:00:00Z' }],
    });
    await persistStore(full);
    const snapId = await captureSnapshot({ force: true, reason: 'test' });
    // Mutate everything afterwards.
    await persistStore(baseStore({ history: [session('h-other', '2026-07-01')], archivedHistory: [] }));
    const mutated = await loadStoreFromIdb();
    assert.equal(mutated.history[0].id, 'h-other');
    const result = await rollbackToSnapshot(snapId);
    assert.equal(result.id, snapId);
    const restored = await loadStoreFromIdb();
    assert.equal(restored.history[0].id, 'h-live');
    assert.equal(restored.archivedHistory[0].id, 'h-arch');
    assert.equal(restored.activeWorkout.session.id, 's-draft');
    assert.equal(restored.activeSchedule.rev, 3);
    assert.deepEqual(restored.gymPrefs.restPresets, { squat: 120 });
    assert.equal(restored.readinessLog[0].score, 80);
    assert.equal(restored.customTemplates[0].id, 'tpl-1');
    assert.ok(restored.tombstones.some((t) => t.refId === 'h-gone'));
    assert.equal(restored.evaluationLedger.length, 2);
    assert.ok(restored.eventHistory.some((e) => e.id === 'e9'));
  });

  it('recomposeSnapshotPayload mirrors hydration exactly', ()=>{
    const payload = {
      profile: [{ id: 'profile', version: 9, onboarding: { goal: 'x' }, preferences: { units: 'kg' }, activeWorkout: { session: { id: 'd' } }, gymPrefs: { restPresets: {} }, studyParticipantId: 'p', studyEnrollment: { a: 1 }, studyStatus: 'enrolled', studyStatusChangedAtISO: '2026-01-01T00:00:00Z' }],
      sessions: [session('h1', '2026-01-01')],
      programme: [{ id: 'active', activeSchedule: { programId: 'p1', sessions: [] }, programHistory: [{ programId: 'p1', version: 1 }] }],
      adaptations: [{ id: 'k', basisKey: 'k' }],
      recommendations: [{ id: 'r1', outcome: null }],
      outcomes: [{ id: 'r1', outcome: { metTarget: true } }],
      events: [{ id: 'e1' }],
      readiness: [{ id: 'log', log: [{ dateISO: '2026-01-01', score: 1 }] }],
      templates: [{ id: 't1' }],
      tombstones: [makeTombstone('sessions', 'x')],
      archive: [{ id: 'h-arch', dateISO: '2020-01-01', blocks: [] }, { id: 'archive:meta' }],
    };
    const store = recomposeSnapshotPayload(payload);
    assert.equal(store.version, 9);
    assert.equal(store.history.length, 1);
    assert.equal(store.archivedHistory.length, 1);
    assert.equal(store.activeSchedule.programId, 'p1');
    assert.equal(store.activeSchedule.adaptationHistory.length, 1);
    assert.equal(store.evaluationLedger.length, 1);
    assert.equal(store.evaluationLedger[0].outcome.metTarget, true);
    assert.equal(store.readinessLog.length, 1);
    assert.equal(store.gymPrefs.restPresets && typeof store.gymPrefs.restPresets === 'object', true);
  });
});

describe('6-8. deterministic singleton sync', ()=>{
  it('6. active workout: newest legitimate updatedAt wins, both directions', ()=>{
    const older = { session: { id: 's-1' }, blocks: [], updatedAt: '2026-01-01T10:00:00Z' };
    const newer = { session: { id: 's-1' }, blocks: [{ x: 1 }], updatedAt: '2026-02-01T10:00:00Z' };
    assert.deepEqual(mergeActiveWorkout(older, newer), newer);
    assert.deepEqual(mergeActiveWorkout(newer, older), newer);
    // Different session ids: still deterministic — newest wins.
    const draftA = { session: { id: 's-a' }, blocks: [], updatedAt: '2026-01-01T10:00:00Z' };
    const draftB = { session: { id: 's-b' }, blocks: [], updatedAt: '2026-03-01T10:00:00Z' };
    assert.deepEqual(mergeActiveWorkout(draftA, draftB), draftB);
    assert.deepEqual(mergeActiveWorkout(draftB, draftA), draftB);
    // Missing timestamps never crash and stay commutative.
    assert.deepEqual(mergeActiveWorkout({ session: { id: 's-a' } }, { session: { id: 's-b' } }), mergeActiveWorkout({ session: { id: 's-b' } }, { session: { id: 's-a' } }));
  });

  it('7. active schedule: explicit revision converges; adaptations bump it', ()=>{
    const v1 = { programId: 'p1', sessions: [], rev: 1, updatedAt: '2026-01-01T10:00:00Z' };
    const v2 = { programId: 'p1', sessions: [{ id: 's1' }], rev: 2, updatedAt: '2026-02-01T10:00:00Z' };
    assert.deepEqual(mergeActiveSchedule(v1, v2), v2);
    assert.deepEqual(mergeActiveSchedule(v2, v1), v2);
    // Legacy schedules without metadata still converge deterministically.
    const legacyA = { programId: 'p1', sessions: [{ id: 'a' }] };
    const legacyB = { programId: 'p1', sessions: [{ id: 'b' }] };
    assert.deepEqual(mergeActiveSchedule(legacyA, legacyB), mergeActiveSchedule(legacyB, legacyA));
  });

  it('8. gymPrefs converge regardless of sync direction; presets merge per exercise', ()=>{
    const a = { restPresets: { squat: 90, bench: 60 }, restPresetUpdatedAt: { squat: '2026-01-01T10:00:00Z', bench: '2026-01-01T10:00:00Z' }, updatedAt: '2026-01-01T10:00:00Z' };
    const b = { restPresets: { squat: 120, deadlift: 180 }, restPresetUpdatedAt: { squat: '2026-02-01T10:00:00Z', deadlift: '2026-02-01T10:00:00Z' }, updatedAt: '2026-02-01T10:00:00Z' };
    const ab = mergeGymPrefs(a, b);
    const ba = mergeGymPrefs(b, a);
    assert.deepEqual(ab, ba);
    // Per-exercise independence: squat takes B (newer), bench survives from A, deadlift from B.
    assert.equal(ab.restPresets.squat, 120);
    assert.equal(ab.restPresets.bench, 60);
    assert.equal(ab.restPresets.deadlift, 180);
    // No timestamps at all: still commutative (larger seconds wins).
    const c = { restPresets: { squat: 90 } };
    const d = { restPresets: { squat: 120 } };
    assert.deepEqual(mergeGymPrefs(c, d), mergeGymPrefs(d, c));
    assert.equal(mergeGymPrefs(c, d).restPresets.squat, 120);
  });
});

describe('9-11. tombstone semantics', ()=>{
  it('9. newest tombstone wins in the canonical union', ()=>{
    const older = makeTombstone('sessions', 'h1', { at: '2026-01-01T10:00:00Z' });
    const newer = makeTombstone('sessions', 'h1', { at: '2026-03-01T10:00:00Z' });
    assert.equal(mergeTombstones([older], [newer])[0].deletedAt, newer.deletedAt);
    assert.equal(mergeTombstones([newer], [older])[0].deletedAt, newer.deletedAt);
    assert.ok(mergeTombstones([older], [{ id: 'bogus' }]).every(isValidTombstone));
  });

  it('10. tombstone entity isolation: same refId across two entity types', ()=>{
    const rows = [{ id: 'same', savedAt: '2026-01-01T10:00:00Z' }];
    const sessionDel = makeTombstone('sessions', 'same', { at: '2026-02-01T10:00:00Z' });
    // Sessions drop; templates with the same refId do not.
    assert.equal(applyTombstones(rows, [sessionDel], 'sessions').length, 0);
    assert.equal(applyTombstones(rows, [sessionDel], 'templates').length, 1);
    // Merged sync state respects the isolation too.
    const cur = baseStore({ history: [{ id: 'same', dateISO: '2026-01-01', savedAt: '2026-01-01T10:00:00Z', blocks: [] }], customTemplates: [{ id: 'same', program: {} }] });
    const imp = baseStore({ history: [], archivedHistory: [], customTemplates: [], tombstones: [sessionDel] });
    const merged = mergeStoresWithConflicts(cur, imp);
    assert.equal(merged.history.some((h) => h.id === 'same'), false);
    assert.equal(merged.customTemplates.some((t) => t.id === 'same'), true);
  });

  it('11. edit-after-delete vs delete-after-edit', ()=>{
    const del = makeTombstone('sessions', 'h1', { at: '2026-02-01T10:00:00Z' });
    const editedAfter = [{ id: 'h1', savedAt: '2026-03-01T10:00:00Z' }];
    const editedBefore = [{ id: 'h1', savedAt: '2026-01-01T10:00:00Z' }];
    assert.equal(applyTombstones(editedAfter, [del], 'sessions').length, 1, 'offline edit newer than deletion wins');
    assert.equal(applyTombstones(editedBefore, [del], 'sessions').length, 0, 'deletion newer than row wins');
    // Malformed tombstones never delete.
    assert.equal(applyTombstones(editedBefore, [{ id: 'x' }], 'sessions').length, 1);
    // Repeated sync cycles are stable.
    const once = applyTombstones(editedBefore, [del], 'sessions');
    assert.deepEqual(applyTombstones(once, [del], 'sessions'), once);
  });
});

describe('12. algebraic sync properties', ()=>{
  function deviceA(){
    return baseStore({
      history: [session('h-a', '2026-01-01', '2026-01-01T10:00:00Z', 80)],
      archivedHistory: [session('h-arch-a', '2020-01-01')],
      activeWorkout: { session: { id: 's-a' }, blocks: [], updatedAt: '2026-01-01T10:00:00Z' },
      activeSchedule: { programId: 'p1', sessions: [], rev: 1, updatedAt: '2026-01-01T10:00:00Z' },
      gymPrefs: { restPresets: { squat: 90 }, restPresetUpdatedAt: { squat: '2026-01-01T10:00:00Z' }, updatedAt: '2026-01-01T10:00:00Z' },
      readinessLog: [{ dateISO: '2026-01-01', score: 70 }],
      eventHistory: [{ id: 'e-a', type: 'session:complete', at: '2026-01-01T10:00:00Z' }],
      tombstones: [],
    });
  }
  function deviceB(){
    return baseStore({
      history: [session('h-b', '2026-02-01', '2026-02-01T10:00:00Z', 90)],
      archivedHistory: [session('h-arch-b', '2020-02-01')],
      activeWorkout: { session: { id: 's-a' }, blocks: [{ x: 1 }], updatedAt: '2026-02-01T10:00:00Z' },
      activeSchedule: { programId: 'p1', sessions: [{ id: 's1' }], rev: 2, updatedAt: '2026-02-01T10:00:00Z' },
      gymPrefs: { restPresets: { squat: 120, bench: 60 }, restPresetUpdatedAt: { squat: '2026-02-01T10:00:00Z', bench: '2026-02-01T10:00:00Z' }, updatedAt: '2026-02-01T10:00:00Z' },
      readinessLog: [{ dateISO: '2026-02-01', score: 80 }],
      eventHistory: [{ id: 'e-b', type: 'session:complete', at: '2026-02-01T10:00:00Z' }],
      tombstones: [makeTombstone('sessions', 'h-gone', { at: '2026-02-01T10:00:00Z' })],
    });
  }

  it('idempotence: merge(A, A) == A over the portable subset', ()=>{
    const a = deviceA();
    const merged = mergeStoresWithConflicts(a, JSON.parse(JSON.stringify(a)));
    assert.deepEqual(portableOf(merged), portableOf(a));
  });

  it('commutativity: merge(A, B) == merge(B, A) over the portable subset', ()=>{
    const ab = portableOf(mergeStoresWithConflicts(deviceA(), deviceB()));
    const ba = portableOf(mergeStoresWithConflicts(deviceB(), deviceA()));
    assert.deepEqual(ab, ba);
  });

  it('convergence: A→B→A reaches a fixed point', ()=>{
    let a = deviceA(), b = deviceB();
    b = mergeStoresWithConflicts(b, a);
    a = mergeStoresWithConflicts(a, b);
    const a2 = mergeStoresWithConflicts(a, b);
    const b2 = mergeStoresWithConflicts(b, a);
    assert.deepEqual(portableOf(a), portableOf(a2), 'A is at a fixed point');
    assert.deepEqual(portableOf(b), portableOf(b2), 'B is at a fixed point');
    assert.deepEqual(portableOf(a), portableOf(b), 'both devices resolve identically');
  });

  it('convergence: A→B→C→A repeated cycles reach one fixed point', ()=>{
    const c = baseStore({
      history: [session('h-c', '2026-03-01', '2026-03-01T10:00:00Z', 100)],
      archivedHistory: [],
      activeWorkout: { session: { id: 's-a' }, blocks: [{ x: 1 }, { x: 2 }], updatedAt: '2026-03-01T10:00:00Z' },
      activeSchedule: { programId: 'p1', sessions: [{ id: 's1' }, { id: 's2' }], rev: 3, updatedAt: '2026-03-01T10:00:00Z' },
      gymPrefs: { restPresets: { row: 75 }, restPresetUpdatedAt: { row: '2026-03-01T10:00:00Z' }, updatedAt: '2026-03-01T10:00:00Z' },
      readinessLog: [{ dateISO: '2026-03-01', score: 90 }],
      eventHistory: [{ id: 'e-c', type: 'session:complete', at: '2026-03-01T10:00:00Z' }],
      tombstones: [],
    });
    let a = deviceA(), b = deviceB(), cc = c;
    // Cycle the ring until nothing changes (bounded: each round can only add
    // information, and the merge is inflationary + idempotent).
    for(let round = 0; round < 6; round++){
      const nb = mergeStoresWithConflicts(b, a);
      const nc = mergeStoresWithConflicts(cc, nb);
      const na = mergeStoresWithConflicts(a, nc);
      const settled = JSON.stringify(portableOf(na)) === JSON.stringify(portableOf(a))
        && JSON.stringify(portableOf(nb)) === JSON.stringify(portableOf(b))
        && JSON.stringify(portableOf(nc)) === JSON.stringify(portableOf(cc));
      a = na; b = nb; cc = nc;
      if(settled) break;
    }
    assert.deepEqual(portableOf(a), portableOf(b), 'A and B resolve identically');
    assert.deepEqual(portableOf(b), portableOf(cc), 'B and C resolve identically');
    // A further full cycle changes nothing (fixed point).
    const b2 = mergeStoresWithConflicts(b, a);
    const c2 = mergeStoresWithConflicts(cc, b2);
    const a2 = mergeStoresWithConflicts(a, c2);
    assert.deepEqual(portableOf(a), portableOf(a2));
    assert.deepEqual(portableOf(b), portableOf(b2));
    assert.deepEqual(portableOf(cc), portableOf(c2));
  });
});

describe('archive + tombstone interaction', ()=>{
  it('archive → delete propagates; delete → archive attempt keeps the deletion', async ()=>{
    await freshDb();
    await persistStore(baseStore({ history: [session('h-old', '2020-01-05', '2020-01-05T10:00:00Z')] }));
    await archiveOldSessions(365);
    let composed = await loadStoreFromIdb();
    assert.equal(composed.archivedHistory.length, 1);
    // Archive → delete: tombstone the archived session via the merged store.
    const tomb = makeTombstone('sessions', 'h-old', { at: '2026-06-01T10:00:00Z' });
    const withDelete = mergeStoresWithConflicts(
      { ...composed, tombstones: [...composed.tombstones, tomb] },
      baseStore({ history: [], archivedHistory: [] }),
    );
    await persistStore(withDelete);
    composed = await loadStoreFromIdb();
    assert.equal(composed.archivedHistory.length, 0, 'archived deletion removes the row');
    assert.ok(composed.tombstones.some((t) => t.refId === 'h-old'));
    // Delete → archive attempt: a tombstoned live row is never archived.
    await persistStore(baseStore({ history: [session('h-old2', '2020-01-05', '2020-01-05T10:00:00Z')], tombstones: [makeTombstone('sessions', 'h-old2', { at: '2026-06-01T10:00:00Z' })] }));
    const res = await archiveOldSessions(365);
    assert.equal(res.archived, 0, 'tombstoned rows are not archived');
  });

  it('archive restored after a newer deletion respects the deletion', async ()=>{
    await freshDb();
    await persistStore(baseStore({ history: [session('h-old', '2020-01-05', '2020-01-05T10:00:00Z')] }));
    await archiveOldSessions(365);
    // Newer deletion lands while the session is archived.
    const composed = await loadStoreFromIdb();
    await persistStore({ ...composed, tombstones: [makeTombstone('sessions', 'h-old', { at: '2026-06-01T10:00:00Z' })] });
    const restored = await restoreArchive();
    assert.equal(restored, 0, 'tombstoned archive rows are not revived');
    const after = await loadStoreFromIdb();
    assert.equal(after.history.filter((s) => s.id === 'h-old').length, 0);
  });

  it('archived session updated on another device converges to live (no silent loss)', ()=>{
    const archivedSide = baseStore({ history: [], archivedHistory: [session('h1', '2026-01-01', '2026-01-01T10:00:00Z', 80)] });
    const editedSide = baseStore({ history: [session('h1', '2026-01-01', '2026-03-01T10:00:00Z', 100)], archivedHistory: [] });
    const merged = mergeStoresWithConflicts(archivedSide, editedSide);
    const all = [...merged.history, ...merged.archivedHistory];
    assert.equal(all.length, 1);
    assert.equal(String(all[0].blocks[0].sets[0].weightKg), '100');
    assert.equal(merged.history.length, 1, 'the updated copy is live');
  });
});

describe('13-14. study safety and device-local fields', ()=>{
  it('13. conflicting study identities fail closed (refused, nothing merged)', ()=>{
    const enrolled = (pid)=> ({ studyVersion: 1, participantId: pid, seed: `s::${pid}::v1`, assignments: { bench: { arm: 'arise', assignmentVersion: 1, assignedAtISO: '2026-01-01T00:00:00Z' } } });
    const a = baseStore({ studyParticipantId: 'aaaaaaaaaaaaaaaa', studyEnrollment: enrolled('aaaaaaaaaaaaaaaa'), studyStatus: 'enrolled', studyStatusChangedAtISO: '2026-01-01T00:00:00Z' });
    const b = baseStore({ studyParticipantId: 'bbbbbbbbbbbbbbbb', studyEnrollment: enrolled('bbbbbbbbbbbbbbbb'), studyStatus: 'enrolled', studyStatusChangedAtISO: '2026-02-01T10:00:00Z' });
    // Two different ACTIVE study participants on one sync path: refused.
    assert.throws(()=> mergeStoresWithConflicts(a, b), /Sync study-profile conflict/);
    assert.throws(()=> mergeStoresWithConflicts(b, a), /Sync study-profile conflict/);
    // Conflicting frozen enrollment metadata is refused even for one identity.
    const c = baseStore({ studyParticipantId: 'aaaaaaaaaaaaaaaa', studyEnrollment: enrolled('aaaaaaaaaaaaaaaa'), studyStatus: 'enrolled', studyStatusChangedAtISO: '2026-01-01T00:00:00Z' });
    const d = baseStore({ studyParticipantId: 'aaaaaaaaaaaaaaaa', studyEnrollment: { ...enrolled('aaaaaaaaaaaaaaaa'), seed: 'different' }, studyStatus: 'enrolled', studyStatusChangedAtISO: '2026-02-01T10:00:00Z' });
    assert.throws(()=> mergeStoresWithConflicts(c, d), /Sync study-enrollment conflict/);
    // Matching inactive state merges fine.
    const merged = mergeStoresWithConflicts(baseStore({}), baseStore({}));
    assert.equal(merged.studyParticipantId, 'abcdef1234567890');
  });

  it('14. consent/credentials stay device-local through merge and push', async ()=>{
    const local = baseStore({ preferences: { units: 'kg', theme: 'dark', telemetryEnabled: true, sync: { url: 'https://x', password: 'SECRET' }, syncEnabled: true } });
    const remote = baseStore({ preferences: { units: 'lb', theme: 'light', telemetryEnabled: false, sync: { url: 'https://evil', password: 'EVIL' }, syncEnabled: false } });
    const merged = mergeStoresWithConflicts(local, remote);
    assert.equal(merged.preferences.sync, local.preferences.sync, 'sync credentials stay local');
    assert.equal(merged.preferences.syncEnabled, true, 'sync consent stays local');
    assert.equal(merged.preferences.telemetryEnabled, true, 'measurement consent stays local');
    let pushed = null;
    await runSync({ store: local, config: defaultSyncConfig(), adapter: { pull: async ()=> null, push: async (t)=> { pushed = t; } }, encryption: null });
    const text = typeof pushed === 'string' ? pushed : JSON.stringify(pushed);
    assert.equal(text.includes('SECRET'), false);
    assert.equal(JSON.parse(text).data.preferences?.sync, undefined);
  });

  it('portable preferences still converge on non-local keys', ()=>{
    const a = { units: 'kg', theme: 'dark' };
    const b = { units: 'lb', theme: 'dark' };
    assert.deepEqual(mergePortablePreferences(a, b), mergePortablePreferences(b, a));
    assert.deepEqual(mergePortablePreferences(a, a), a);
  });
});

describe('recovery honesty: deletion preview and salvage cover archives', ()=>{
  it('deletionPreview counts archived history; salvage rescues it', ()=>{
    const store = baseStore({
      history: [session('h-live', '2026-06-01')],
      archivedHistory: [session('h-arch', '2020-01-05')],
    });
    const preview = deletionPreview(store);
    assert.equal(preview.historyCount, 1);
    assert.equal(preview.archivedHistoryCount, 1);
    const payload = buildSalvagePayload(store);
    assert.ok(payload);
    assert.deepEqual(payload.data.history.map((s) => s.id).sort(), ['h-arch', 'h-live']);
  });
});

describe('import/replace determinism with archives', ()=>{
  it('replace reconstructs the exact archive/live split; merge never duplicates', ()=>{
    const cur = baseStore({ history: [session('h1', '2026-01-01')], archivedHistory: [session('h-arch', '2020-01-01')] });
    const imp = baseStore({ history: [session('h2', '2026-02-01')], archivedHistory: [session('h-arch2', '2020-02-01')] });
    const replaced = mergeStores(cur, imp, 'replace');
    assert.deepEqual(replaced.history.map((s) => s.id), ['h2']);
    assert.deepEqual(replaced.archivedHistory.map((s) => s.id), ['h-arch2']);
    const merged = mergeStores(cur, imp, 'merge');
    const ids = [...merged.history.map((s) => s.id), ...merged.archivedHistory.map((s) => s.id)].sort();
    assert.deepEqual(ids, ['h-arch', 'h-arch2', 'h1', 'h2']);
    const overlap = merged.history.filter((s) => merged.archivedHistory.some((x) => x.id === s.id));
    assert.equal(overlap.length, 0);
  });
});
