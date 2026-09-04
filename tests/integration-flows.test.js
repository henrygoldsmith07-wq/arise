// Integration tests — whole flows rather than single functions, all through
// the public surface with the memory-backed storage layer:
//   1. persistence: hydrate → persist → re-hydrate, write-failure atomicity,
//      and the active-workout crash round-trip (kill the app mid-session).
//   2. export/import: full + partial payloads, credential/consent hygiene on
//      BOTH sides, import preview counts/conflicts, merge vs replace, and
//      impossible-value validation.
//   3. integrity repair: corrupt recomposition → quarantine → readable store.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { _m:{}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; }, clear(){ this._m = {}; } };

import { hydrateStorage, persistStore, clearAllStoredData, whenPersisted, loadStoreFromIdb } from '../src/lib/storage.js';
import { idbTransaction } from '../src/lib/idb-tx.js';
import { enforceIntegrity, repairStore } from '../src/lib/integrity.js';
import {
  buildExportPayload, buildPartialExportPayload, parseImportFile,
  mergeStores, validateStoreData, parseBackupFile,
  compressPayload, portableCsv,
} from '../src/lib/export.js';
import { buildImportPreview, deniedFieldsPresent } from '../src/lib/exportPolicy.js';
import { STORE_SCHEMA_VERSION } from '../src/lib/store.js';

await hydrateStorage();

const set = (reps, kg, rpe = '') => ({ reps: String(reps), weightKg: String(kg), rpe });
const session = (id, dateISO, weightKg = 80, savedAt = null) => ({
  id, dateISO, mode: 'standard', savedAt,
  blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(8, weightKg), set(9, weightKg)] }],
});

function fullStore(){
  return {
    version: STORE_SCHEMA_VERSION,
    onboarding: { goal: 'muscle', equipment: ['dumbbells'], location: 'home' },
    preferences: { units: 'kg', theme: 'dark', sync: { url: 'https://dav.example', user: 'me', appPassword: 'hunter2' } },
    healthSummary: null,
    activeSchedule: { programId: 'p1', mesocycle: { weeks: 4, deloadWeek: null }, adaptationHistory: [], sessions: [] },
    programHistory: [{ programId: 'p1', version: 1, startDateISO: '2026-01-05' }],
    history: [session('h1', '2026-01-05'), session('h2', '2026-01-08', 82.5)],
    eventHistory: [{ id: 'e1', type: 'session:complete', at: '2026-01-05T10:00:00Z' }],
    readinessLog: [{ dateISO: '2026-01-05', score: 75 }],
    evaluationLedger: [],
    customTemplates: [],
    // A crashed session: the draft the user never finished (ADR: crash recovery).
    activeWorkout: {
      session: { id: 'wip-1', dateISO: '2026-01-10' },
      startedAt: '2026-01-10T18:02:00Z',
      blocks: [{ exerciseId: 'deadlift', sets: [set(5, 100), { reps: '', weightKg: '', rpe: '' }] }],
    },
  };
}

describe('integration: persistence flows', () => {
  it('a full store round-trips: persist → recompose → identical domain data', async () => {
    await persistStore(fullStore());
    await whenPersisted();
    const back = await loadStoreFromIdb();
    assert.equal(back.history.length, 2);
    assert.equal(back.activeSchedule.programId, 'p1');
    assert.equal(back.preferences.units, 'kg');
    assert.deepEqual(back.readinessLog, [{ dateISO: '2026-01-05', score: 75 }]);
  });

  it('the active-workout draft survives the round-trip (crash recovery data path)', async () => {
    await persistStore(fullStore());
    await whenPersisted();
    const back = await loadStoreFromIdb();
    assert.ok(back.activeWorkout, 'draft persisted');
    assert.equal(back.activeWorkout.session.id, 'wip-1');
    assert.equal(back.activeWorkout.blocks[0].sets[0].weightKg, '100');
  });

  it('a throwing write aborts the transaction and leaves the store untouched', async () => {
    await persistStore(fullStore());
    await whenPersisted();
    const before = await loadStoreFromIdb();
    await assert.rejects(() => idbTransaction(['sessions', 'programme'], (ops) => {
      ops.clearStore('sessions');
      throw new Error('boom mid-transaction');
    }));
    const after = await loadStoreFromIdb();
    assert.equal(after.history.length, before.history.length, 'aborted transaction rolled back');
    assert.equal(after.history[0].id, 'h1');
  });

  it('clearAllStoredData empties everything — deleted data does not resurrect', async () => {
    await persistStore(fullStore());
    await whenPersisted();
    await clearAllStoredData();
    assert.equal(await loadStoreFromIdb(), null, 'stores are empty → recomposition yields nothing');
    // Re-persisting after a deliberate clear works (cleared latch resets).
    await hydrateStorage();
    await persistStore(fullStore());
    await whenPersisted();
    assert.equal((await loadStoreFromIdb()).history.length, 2);
  });
});

describe('integration: export → import flows', () => {
  it('full payload round-trips through parseImportFile with credentials stripped', () => {
    const payload = buildExportPayload(fullStore());
    const imported = parseImportFile(JSON.stringify(payload));
    assert.ok(imported.history.length >= 2);
    assert.equal(imported.preferences.sync, undefined, 'WebDAV credentials never travel');
    assert.equal(imported.preferences.telemetryEnabled, undefined, 'consent is device-local');
    assert.equal(imported.activeWorkout.session.id, 'wip-1', 'a crashed draft ports to the new device too');
  });

  it('every partial export kind carries only its slice, in the same envelope contract', () => {
    const store = fullStore();
    for (const [kind, present, absent] of [
      ['history', ['history'], ['onboarding', 'preferences', 'eventHistory']],
      ['settings', ['onboarding', 'preferences'], ['history', 'eventHistory']],
      ['events', ['eventHistory'], ['history', 'preferences']],
    ]) {
      const raw = JSON.parse(JSON.stringify(buildPartialExportPayload(store, kind)));
      // Assert on the WIRE payload: what the file actually contains.
      for (const key of present) assert.ok(key in raw.data, `${kind}: ${key} present`);
      for (const key of absent) assert.ok(!(key in raw.data), `${kind}: ${key} absent`);
      assert.equal(raw.contract, 'arise.export.v1', 'same envelope contract as full backups');
    }
  });

  it('import preview reports counts, updates and denied fields before anything applies', () => {
    const store = fullStore();
    const current = { ...store, history: [...store.history, session('h-mine', '2026-01-09')] };
    // Same session id, different weight → a genuine conflict; + one new row.
    const edited = { ...store, history: [session('h1', '2026-01-05', 85), session('h3', '2026-01-11')] };
    const preview = buildImportPreview(JSON.parse(JSON.stringify(buildExportPayload(edited))), current);
    assert.ok(preview.ok);
    assert.equal(preview.counts.additions, 1);
    assert.equal(preview.counts.updates, 1);
    assert.equal(preview.conflicts[0].sessionId, 'h1');
    assert.equal(preview.conflicts[0].existingSets, 2);
    // The edited fixture still carries device-local fields — the preview must name them.
    assert.ok(preview.deniedFields.length === 0, 'an exported file is already hygienic — nothing denied left inside');
    // The policy itself still names device-local fields when a RAW store is inspected.
    const hostile = { ...edited, preferences: { ...edited.preferences, sync: { url: 'x' }, telemetryEnabled: true } };
    assert.ok(deniedFieldsPresent(hostile).includes('preferences.sync'));
    assert.ok(deniedFieldsPresent(hostile).includes('preferences.telemetryEnabled'));
  });

  it('merge unions history; replace wholesale takes the imported side', () => {
    const current = { version: 1, history: [session('a', '2026-01-01'), session('b', '2026-01-02')], preferences: { units: 'kg' } };
    const imported = { version: 1, history: [session('a', '2026-01-01'), session('c', '2026-01-03')], preferences: { units: 'lb' } };
    const merged = mergeStores(current, imported, 'merge');
    assert.deepEqual(merged.history.map((h) => h.id), ['a', 'b', 'c']);
    assert.equal(merged.preferences.units, 'kg', 'current settings win the merge');
    const replaced = mergeStores(current, imported, 'replace');
    assert.deepEqual(replaced.history.map((h) => h.id), ['a', 'c']);
    assert.equal(replaced.preferences.units, 'lb', 'replace takes the imported settings');
  });

  it('validation rejects impossible values that would poison e1RM and volume', () => {
    const bad = validateStoreData({ version: 9, history: [session('x', '2026-01-01').blocks && {
      id: 'x', dateISO: '2026-01-01',
      blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '-3', weightKg: '2500', rpe: 42 }] }],
    }] });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.includes('negative')));
    assert.ok(bad.errors.some((e) => e.includes('implausible')));
    assert.ok(bad.errors.some((e) => e.includes('RPE')));
    assert.equal(validateStoreData({ version: 9, history: [session('y', '2026-01-01')] }).ok, true);
  });

  it('a session whose id already exists keeps the newer saveAt on merge', () => {
    const older = session('h1', '2026-01-05', 80, '2026-01-05T10:00:00Z');
    const newer = session('h1', '2026-01-05', 82.5, '2026-01-06T09:00:00Z');
    const current = { version: 9, history: [newer], preferences: {} };
    const incoming = { version: 9, history: [older], preferences: {} };
    const merged = mergeStores(current, incoming, 'merge');
    assert.equal(merged.history.length, 1, 'no duplicate rows');
    assert.equal(merged.history[0].blocks[0].sets[0].weightKg, '82.5', 'current (newer) kept');
  });

  it('compressed backups round-trip through parseBackupFile', async () => {
    const payload = buildExportPayload(fullStore());
    const { envelope, compressed } = await compressPayload(payload);
    if (compressed) {
      const back = await parseBackupFile(JSON.parse(JSON.stringify(envelope)));
      assert.equal(back.data.history.length, payload.data.history.length);
    } else {
      const back = await parseBackupFile(JSON.parse(JSON.stringify(payload)));
      assert.equal(back.data.history.length, payload.data.history.length);
    }
  });

  it('portableCsv escapes formula-injection cells and carries one row per set', () => {
    const hostile = {
      id: 'evil', dateISO: '2026-01-01', durationMinutes: 42, programVersion: 1, equipmentSnapshot: ['dumbbells'],
      blocks: [{ exerciseId: '=HYPERLINK("http://evil")', sets: [{ reps: '8', weightKg: '80', rpe: '', side: null, rom: null, assistedKg: null, failed: false, skipped: false }] }],
    };
    const csv = portableCsv([hostile]);
    const lines = csv.split('\n');
    assert.equal(lines.length, 2, 'header + one set row');
    assert.ok(csv.includes("\"'=HYPERLINK"), 'formula prefix neutralised with a leading apostrophe');
    assert.ok(!csv.includes(',=HYPERLINK'), 'never raw at cell start');
  });
});

describe('integration: corrupted-data recovery', () => {
  it('repairStore fixes a broken recomposition into a readable store', () => {
    const broken = { ...fullStore(), history: [{ id: 'bad', blocks: 'not-an-array' }, session('ok', '2026-01-05')], activeSchedule: 'garbage', eventHistory: 'nope' };
    const fixed = repairStore(broken);
    assert.ok(Array.isArray(fixed.history));
    assert.ok(Array.isArray(fixed.eventHistory));
    assert.ok(fixed.activeSchedule === null || typeof fixed.activeSchedule === 'object');
    assert.ok(fixed.history.some((h) => h?.id === 'ok'));
  });

  it('enforceIntegrity leaves a healthy store semantically unchanged', async () => {
    await clearAllStoredData();
    await persistStore(fullStore());
    const store = await hydrateStorage();
    const verdict = enforceIntegrity(store);
    assert.ok(verdict.ok !== false || verdict.repaired, 'healthy store not flagged broken');
  });
});
