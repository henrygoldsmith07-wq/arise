// Provenance-preservation tests: study loading may PRESERVE exported
// provenance but must never UPGRADE it. Evidence can lose trust through
// import or ambiguity; it can never regain trust through inference.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withProvenance, withOutcomeProvenance, importLedgerProvenance, PROVENANCE_ORIGINS } from '../src/lib/domain.js';
import { isProspectiveRecord } from '../src/lib/longitudinalCore.js';
import { loadParticipantFile, pooledAssignedComparison } from '../src/lib/fieldStudy.js';
import { evaluateLongitudinal } from '../src/lib/evaluation.js';
import { parseImportFile } from '../src/lib/export.js';

class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}
globalThis.localStorage = new MemoryStorage();
const { KEY: STORE_KEY } = await import('../src/lib/store.js');
const { recordRecommendation } = await import('../src/lib/longitudinal.js');
function setConsent(enabled){ globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({ version: 9, preferences: { telemetryEnabled: enabled } })); }
beforeEach(()=> { globalThis.localStorage = new MemoryStorage(); setConsent(true); });

// ── Row builders ─────────────────────────────────────────────────────────
// A study-export ledger row carrying EXACT provenance blocks the caller
// controls. loadParticipantFile must copy these verbatim.
function ledgerRow({ id = 'l1', recOrigin, outOrigin, recAt, outAt, resolved = true } = {}){
  const row = {
    id,
    schemaVersion: 2,
    recordedAtISO: recAt ?? '2026-03-01T10:00:00.000Z',
    dueDateISO: '2026-03-08',
    exerciseId: 'bench-press-dumbbell',
    participantId: null,
    assignedArm: 'arise',
    recommendation: { load: 22.5, reps: 9 },
    recommendedAction: 'add_load',
    prescription: { arm: 'arise', load: 22.5, reps: 9 },
    policy: { id: 'arise-engine', priorsVersion: 1, modelVersion: 1 },
    basis: { visibleSessions: 2, previousBest: { reps: 8, weightKg: 20, assistedKg: null, e1rm: 25.3 }, trainingAgePhase: 'novice', priorsVersion: 1 },
    outcome: resolved ? {
      sessionId: 's2', dateISO: '2026-03-08', followed: true, metTarget: true, assignedMet: true, gradeable: true,
      e1rm: 30, changePct: 0.18, load: 22.5, reps: 9, sets: 1, failedSets: 0, volumeKg: 202,
      userOverride: false, pain: false, techniqueWarning: false,
      classification: 'progression-success', label: 'successful', attempted: true,
      arms: { arise: { metTarget: true } },
    } : null,
  };
  if(recOrigin !== undefined) row.provenance = recOrigin === null ? null : (typeof recOrigin === 'object' ? recOrigin : { origin: recOrigin, capturedAt: '2026-03-01T10:00:00.000Z', deviceId: 'dev_a' });
  if(outOrigin !== undefined) row.outcomeProvenance = outOrigin === null ? null : (typeof outOrigin === 'object' ? outOrigin : { origin: outOrigin, capturedAt: '2026-03-08T10:00:00.000Z', deviceId: 'dev_a' });
  return row;
}

function exportPackage(ledger, { id = 'a'.repeat(16), consented = true } = {}){
  return JSON.stringify({
    app: 'arise',
    data: {
      version: 9,
      studyParticipantId: id,
      preferences: { telemetryEnabled: consented },
      history: [{ id: 's2', dateISO: '2026-03-08', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '9', weightKg: '22.5' }] }] }],
      evaluationLedger: ledger,
    },
  });
}

describe('loadParticipantFile preserves exact exported provenance', ()=>{
  it('raw live-engine rows stay live-engine (eligible)', ()=>{
    const row = ledgerRow({ recOrigin: 'live-engine', outOrigin: 'live-engine' });
    const { store } = loadParticipantFile(exportPackage([row]), 0);
    const [r] = store.evaluationLedger;
    assert.equal(r.provenance.origin, 'live-engine');
    assert.equal(r.provenance.capturedAt, '2026-03-01T10:00:00.000Z');
    assert.equal(r.outcomeProvenance.origin, 'live-engine');
    assert.equal(r.outcomeProvenance.capturedAt, '2026-03-08T10:00:00.000Z');
    assert.ok(isProspectiveRecord(r));
  });

  it('raw imported rows stay imported (excluded)', ()=>{
    const row = ledgerRow({ recOrigin: 'imported', outOrigin: 'imported' });
    const { store } = loadParticipantFile(exportPackage([row]), 0);
    const [r] = store.evaluationLedger;
    assert.equal(r.provenance.origin, 'imported');
    assert.equal(r.outcomeProvenance.origin, 'imported');
    assert.ok(!isProspectiveRecord(r));
  });

  it('raw replayed rows stay replayed (excluded)', ()=>{
    const row = ledgerRow({ recOrigin: 'replayed', outOrigin: 'replayed' });
    const { store } = loadParticipantFile(exportPackage([row]), 0);
    assert.equal(store.evaluationLedger[0].provenance.origin, 'replayed');
    assert.equal(store.evaluationLedger[0].outcomeProvenance.origin, 'replayed');
    assert.ok(!isProspectiveRecord(store.evaluationLedger[0]));
  });

  it('raw seed rows stay seed (excluded)', ()=>{
    const row = ledgerRow({ recOrigin: 'seed', outOrigin: 'seed' });
    const { store } = loadParticipantFile(exportPackage([row]), 0);
    assert.equal(store.evaluationLedger[0].provenance.origin, 'seed');
    assert.equal(store.evaluationLedger[0].outcomeProvenance.origin, 'seed');
    assert.ok(!isProspectiveRecord(store.evaluationLedger[0]));
  });

  it('missing recommendation provenance is excluded, never trusted by default', ()=>{
    const row = ledgerRow({ recOrigin: undefined, outOrigin: 'live-engine' });
    const { store } = loadParticipantFile(exportPackage([row]), 0);
    assert.ok(!('provenance' in store.evaluationLedger[0]) || store.evaluationLedger[0].provenance == null);
    assert.ok(!isProspectiveRecord(store.evaluationLedger[0]));
  });

  it('missing outcome provenance is excluded from resolved prospective evidence', ()=>{
    const row = ledgerRow({ recOrigin: 'live-engine', outOrigin: undefined });
    const { store } = loadParticipantFile(exportPackage([row]), 0);
    const [r] = store.evaluationLedger;
    assert.equal(r.provenance.origin, 'live-engine'); // recommendation side preserved exactly
    assert.ok(!('outcomeProvenance' in r) || r.outcomeProvenance == null);
    assert.ok(!isProspectiveRecord(r), 'live rec + missing outcome origin must not be prospective');
  });

  it('malformed provenance never becomes trusted', ()=>{
    const row = ledgerRow({ recOrigin: { origin: 'garbage-origin', capturedAt: 'x' }, outOrigin: { origin: 42 } });
    const { store } = loadParticipantFile(exportPackage([row]), 0);
    const [r] = store.evaluationLedger;
    assert.deepEqual(r.provenance, { origin: 'garbage-origin', capturedAt: 'x' }); // verbatim, not laundered
    assert.deepEqual(r.outcomeProvenance, { origin: 42 });
    assert.ok(!isProspectiveRecord(r));
    // isProspectiveRecord fails closed for every non-live shape:
    for(const origin of [undefined, null, 'imported', 'replayed', 'seed', 'weird']){
      assert.equal(isProspectiveRecord({ provenance: { origin }, outcomeProvenance: { origin: 'live-engine' } }), false);
      assert.equal(isProspectiveRecord({ provenance: { origin: 'live-engine' }, outcomeProvenance: { origin } }), false);
    }
  });

  it('consumer import → re-export → study load stays imported (never regains live-engine)', ()=>{
    // 1. A genuine live row on device A.
    const live = ledgerRow({ recOrigin: 'live-engine', outOrigin: 'live-engine' });
    // 2. Consumer import onto device B downgrades BOTH sides to imported.
    const imported = parseImportFile(exportPackage([live]));
    assert.equal(imported.evaluationLedger[0].provenance.origin, 'imported');
    assert.equal(imported.evaluationLedger[0].outcomeProvenance.origin, 'imported');
    assert.ok(!isProspectiveRecord(imported.evaluationLedger[0]));
    // 3. Device B re-exports for study analysis.
    const reExport = JSON.stringify({ app: 'arise', data: imported });
    // 4. The study loader restores the EXACT (already imported) provenance —
    //    which is 'imported', so the row stays excluded forever.
    const { store } = loadParticipantFile(reExport, 0);
    const [r] = store.evaluationLedger;
    assert.equal(r.provenance.origin, 'imported');
    assert.equal(r.outcomeProvenance.origin, 'imported');
    assert.ok(!isProspectiveRecord(r));
  });

  it('valid untouched live export remains eligible end to end', ()=>{
    // Distinct due dates/outcome sessions so each row is a distinct
    // transition (identical target+session rows would legitimately dedupe).
    const rows = [0, 1, 2, 3].map((i)=> {
      const row = ledgerRow({ id: `l${i}`, recOrigin: 'live-engine', outOrigin: 'live-engine' });
      row.dueDateISO = `2026-03-${String(8 + i * 7).padStart(2, '0')}`;
      row.outcome = { ...row.outcome, sessionId: `s2-${i}`, dateISO: row.dueDateISO };
      return row;
    });
    const { store, studyParticipantId } = loadParticipantFile(exportPackage(rows), 0);
    assert.equal(studyParticipantId, 'a'.repeat(16));
    assert.ok(store.evaluationLedger.every(isProspectiveRecord));
    const c = pooledAssignedComparison([{ code: 'p1', studyParticipantId, store }], { config: { longitudinal: { minimumSegmentSamples: 1 } }, minParticipants: 1, minTransitions: 4 });
    assert.equal(c.transitions, 4);
    assert.equal(c.arise.n, 4);
  });
});

describe('write-once provenance (withProvenance / withOutcomeProvenance)', ()=>{
  it('first write records the origin; equal writes refresh metadata; upgrades are denied', ()=>{
    const first = withProvenance({ id: 'x' }, 'live-engine', { deviceId: 'd1' });
    assert.equal(first.provenance.origin, 'live-engine');
    // Same-trust refresh: allowed, metadata merges.
    const refreshed = withProvenance(first, 'live-engine', { deviceId: 'd2' });
    assert.equal(refreshed.provenance.origin, 'live-engine');
    assert.equal(refreshed.provenance.deviceId, 'd2');
    // UPGRADE attempt (imported → live-engine): denied, origin preserved.
    const importedRow = withProvenance({ id: 'y' }, 'imported');
    const laundered = withProvenance(importedRow, 'live-engine');
    assert.equal(laundered.provenance.origin, 'imported');
    // Downgrade (live-engine → imported): applied.
    const downgraded = withProvenance(first, 'imported');
    assert.equal(downgraded.provenance.origin, 'imported');
  });

  it('outcome provenance follows the same write-once rule', ()=>{
    const rec = withOutcomeProvenance({ id: 'z' }, 'live-engine');
    assert.equal(rec.outcomeProvenance.origin, 'live-engine');
    const denied = withOutcomeProvenance(withOutcomeProvenance({ id: 'z2' }, 'imported'), 'live-engine');
    assert.equal(denied.outcomeProvenance.origin, 'imported');
  });

  it('importLedgerProvenance downgrades both sides and never upgrades after', ()=>{
    const live = ledgerRow({ recOrigin: 'live-engine', outOrigin: 'live-engine' });
    const afterImport = importLedgerProvenance(live);
    assert.equal(afterImport.provenance.origin, 'imported');
    assert.equal(afterImport.outcomeProvenance.origin, 'imported');
    // Any later attempt to upgrade back is denied by the stamp itself.
    const relive = withOutcomeProvenance(withProvenance(afterImport, 'live-engine'), 'live-engine');
    assert.equal(relive.provenance.origin, 'imported');
    assert.equal(relive.outcomeProvenance.origin, 'imported');
  });

  it('PROVENANCE_ORIGINS enumerates exactly the four known origins', ()=>{
    assert.deepEqual([...PROVENANCE_ORIGINS].sort(), ['imported', 'live-engine', 'replayed', 'seed']);
  });
});

describe('assigned-arm analysis excludes every non-live row', ()=>{
  const ARMS = ['arise', 'double-progression'];
  function participantsWith(arm, origins){
    return {
      code: 'p1',
      studyParticipantId: 'b'.repeat(16),
      store: {
        preferences: { telemetryEnabled: true },
        history: [{ id: 's2', dateISO: '2026-03-08', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '9', weightKg: '22.5' }] }] }],
        evaluationLedger: [ledgerRow({ id: 'l1', recOrigin: origins[0], outOrigin: origins[1] })],
      },
    };
  }
  it('live both sides count; every other combination is excluded', ()=>{
    const live = pooledAssignedComparison([participantsWith('arise', ['live-engine', 'live-engine'])], { config: { longitudinal: { minimumSegmentSamples: 1 } }, minParticipants: 1, minTransitions: 1 });
    assert.equal(live.transitions, 1);
    for(const origins of [['imported','imported'], ['replayed','replayed'], ['seed','seed'], ['live-engine','imported'], ['imported','live-engine'], [undefined, 'live-engine'], ['live-engine', undefined]]){
      const c = pooledAssignedComparison([participantsWith('arise', origins)], { config: { longitudinal: { minimumSegmentSamples: 1 } }, minParticipants: 1, minTransitions: 1 });
      assert.equal(c.transitions, 0, `${origins} must be excluded from assigned-arm evidence`);
      assert.equal(c.participants, 0);
    }
  });

  it('primary evaluation reaches the same exclusion via isProspectiveRecord', ()=>{
    // Fully-formed assigned rows (arms + assignedMet) that differ ONLY in
    // provenance: live counts, every non-live combination is excluded.
    const mk = (id, origins)=> {
      const row = ledgerRow({ id, recOrigin: origins[0], outOrigin: origins[1] });
      row.outcome = { ...row.outcome, assignedMet: true };
      return row;
    };
    const mixed = [
      mk('a', ['live-engine', 'live-engine']),
      mk('b', ['imported', 'imported']),
      mk('c', ['replayed', 'live-engine']),
      mk('d', ['seed', 'seed']),
    ];
    const primary = evaluateLongitudinal(mixed).primaryComparison;
    assert.equal(primary.transitions, 1, 'only the live-live row counts as assigned-arm evidence');
    assert.equal(primary.arise.n, 1);
    assert.equal(mixed.filter(isProspectiveRecord).length, 1);
  });
});

describe('recording path stamps live exactly once at write time', ()=>{
  it('recordRecommendation sets live-engine with the device id', ()=>{
    const rec = recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 22.5, reps: 9, reason: 'test' },
      history: [],
      dueDateISO: '2026-03-08',
      preferences: { telemetryEnabled: true },
      nowISO: '2026-03-01T10:00:00.000Z',
    });
    assert.equal(rec.provenance.origin, 'live-engine');
    assert.ok(rec.provenance.deviceId);
    assert.ok(isProspectiveRecord(rec) === false, 'no outcome yet — not resolved prospective evidence');
  });
});
