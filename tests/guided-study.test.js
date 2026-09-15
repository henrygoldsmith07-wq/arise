import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withGuidedStepPrescription, applyGuidedTreatment, initGuidedBlocks } from '../src/lib/guidedMode.js';
import { treatmentRecommendation } from '../src/lib/treatment.js';
import { studyArmFor, enrollParticipant } from '../src/lib/studyEnrollment.js';
import { recordRecommendation } from '../src/lib/longitudinal.js';

function memoryStorage(){
  const map = new Map();
  return { getItem: k=> map.has(k) ? map.get(k) : null, setItem: (k, v)=> map.set(k, String(v)), removeItem: k=> map.delete(k) };
}

const session = {
  id: 'gx1', title: 'A', dateISO: '2026-03-09', programId: 'prog', programVersion: 2, startedAt: '2026-03-09T09:00:00.000Z',
  blocks: [
    { exerciseId: 'goblet-squat', sets: 3, reps: '10', restSec: 90 },
    { exerciseId: 'romanian-deadlift', sets: 3, reps: '8', restSec: 90 },
  ],
};
const history = [
  { id: 'h1', dateISO: '2026-03-02', blocks: [{ exerciseId: 'goblet-squat', sets: [{ reps: '9', weightKg: '24' }] }] },
  { id: 'h2', dateISO: '2026-03-05', blocks: [{ exerciseId: 'romanian-deadlift', sets: [{ reps: '8', weightKg: '60' }] }] },
  // AFTER the due date: must never inform a shown prescription (prior-only).
  { id: 'h3', dateISO: '2026-03-16', blocks: [{ exerciseId: 'goblet-squat', sets: [{ reps: '12', weightKg: '40' }] }] },
];
const enrollment = {
  participantId: 'e'.repeat(16),
  assignments: {
    'goblet-squat': { arm: 'double-progression' },
    // romanian-deadlift deliberately ABSENT: never randomised → never 'arise'.
  },
  policyVersions: { arise: 'p', doubleProgression: 'q' },
};

const guidedBlocks = ()=> initGuidedBlocks(session, history, null);

describe('guided mode enforces the frozen assignment', ()=>{
  it('studyArmFor drives the same arms as the standard runner', ()=>{
    assert.equal(studyArmFor(enrollment, 'goblet-squat'), 'double-progression');
    assert.equal(studyArmFor(enrollment, 'romanian-deadlift'), null);
  });

  it('DP-assigned step: treatment fills unfinished sets, skips performed work', ()=>{
    const rec = treatmentRecommendation({ block: { exerciseId: 'goblet-squat', reps: '10' }, history, asOfDateISO: '2026-03-09', assignedArm: 'double-progression' });
    assert.ok(rec && rec.reps != null);
    const fresh = guidedBlocks();
    const blocks = fresh.map((b, i)=> i===0 ? { ...b, sets: b.sets.map((s, j)=> j===0 ? { ...s, completed: true } : s) } : b);
    const next = applyGuidedTreatment(blocks, 0, 'double-progression', rec);
    const sets = next[0].sets;
    assert.equal(sets[0].reps, fresh[0].sets[0].reps, 'completed set untouched — history stays what happened');
    assert.equal(sets[1].reps, String(rec.reps), 'DP treatment lands on the shown target');
    assert.notEqual(next, blocks);
  });

  it('arise or unassigned exercise: guided behaviour is unchanged', ()=>{
    const blocks = guidedBlocks();
    assert.equal(applyGuidedTreatment(blocks, 0, 'arise', { reps: 12, load: 30 }), blocks);
    assert.equal(applyGuidedTreatment(blocks, 0, null, { reps: 12, load: 30 }), blocks);
    assert.equal(applyGuidedTreatment(blocks, 0, 'double-progression', null), blocks);
  });

  it('prior-only: the 40 kg future session never reaches the DP treatment', ()=>{
    const dp = treatmentRecommendation({ block: { exerciseId: 'goblet-squat', reps: '10' }, history, asOfDateISO: '2026-03-09', assignedArm: 'double-progression' });
    const dpBlind = treatmentRecommendation({ block: { exerciseId: 'goblet-squat', reps: '10' }, history: history.filter(h=> h.dateISO <= '2026-03-09'), asOfDateISO: '2026-03-09', assignedArm: 'double-progression' });
    assert.deepEqual(dp, dpBlind);
    assert.ok(Number(dp.load) < 40);
  });
});

describe('guided snapshots carry the treatment provenance', ()=>{
  it('DP step freezes an engine-source snapshot; plain step stays schedule-source; idempotent', ()=>{
    const rec = treatmentRecommendation({ block: { exerciseId: 'goblet-squat', reps: '10' }, history, asOfDateISO: '2026-03-09', assignedArm: 'double-progression' });
    const blocks = guidedBlocks();
    const stamped = withGuidedStepPrescription(session, blocks, 0, '2026-03-09T09:10:00.000Z', null, rec, 'standard');
    assert.equal(stamped[0].prescription.source, 'engine', 'treated exercise records the engine (DP) prescription');
    assert.equal(stamped[0].prescription.prescribedReps, rec.reps);
    assert.equal(stamped[0].prescription.prescribedLoadKg, rec.load);
    assert.equal(stamped[0].prescription.firstShownAt, '2026-03-09T09:10:00.000Z');
    assert.equal(withGuidedStepPrescription(session, stamped, 0, '2026-03-09T09:11:00.000Z', null, rec), stamped, 'second reveal must not re-stamp');
    const plain = withGuidedStepPrescription(session, blocks, 1, '2026-03-09T09:20:00.000Z', null, null);
    assert.equal(plain[1].prescription.source, 'schedule', 'no treatment → honest schedule snapshot');
  });
});

describe('guided prospective evidence records once with the true arm', ()=>{
  it('unassigned exercise records assignedArm null, never arise', ()=>{
    const storage = memoryStorage();
    const rec = treatmentRecommendation({ block: { exerciseId: 'romanian-deadlift', reps: '8' }, history, asOfDateISO: '2026-03-09', assignedArm: studyArmFor(enrollment, 'romanian-deadlift') });
    const row = recordRecommendation({
      exerciseId: 'romanian-deadlift', recommendation: rec, history, dueDateISO: '2026-03-09',
      preferences: { telemetryEnabled: true }, nowISO: '2026-03-09T09:00:00.000Z',
      assignedArm: studyArmFor(enrollment, 'romanian-deadlift'), participantId: 'e'.repeat(16), storage,
    });
    assert.equal(row.assignedArm, null);
  });
  it('DP exercise records the DP arm and the DP prescription verbatim', ()=>{
    const storage = memoryStorage();
    const rec = treatmentRecommendation({ block: { exerciseId: 'goblet-squat', reps: '10' }, history, asOfDateISO: '2026-03-09', assignedArm: 'double-progression' });
    const row = recordRecommendation({
      exerciseId: 'goblet-squat', recommendation: rec, history, dueDateISO: '2026-03-09',
      preferences: { telemetryEnabled: true }, nowISO: '2026-03-09T09:00:00.000Z',
      assignedArm: 'double-progression', participantId: 'e'.repeat(16), storage,
    });
    assert.equal(row.assignedArm, 'double-progression');
    assert.equal(row.recommendation.reps, rec.reps);
  });
  it('without measurement consent nothing is recorded at all', ()=>{
    const storage = memoryStorage();
    const row = recordRecommendation({
      exerciseId: 'goblet-squat', recommendation: { load: 25, reps: 10 }, history, dueDateISO: '2026-03-09',
      preferences: null, assignedArm: 'double-progression', participantId: 'e'.repeat(16), storage,
    });
    assert.equal(row, null);
  });
});

describe('enrollment parity across modes', ()=>{
  it('the same schedule yields the same arms whether run guided or standard', ()=>{
    const exIds = session.blocks.map(b=> b.exerciseId);
    const e1 = enrollParticipant({ participantId: 'a'.repeat(16), exerciseIds: exIds });
    const e2 = enrollParticipant({ participantId: 'a'.repeat(16), exerciseIds: exIds });
    for(const b of session.blocks) assert.equal(studyArmFor(e1, b.exerciseId), studyArmFor(e2, b.exerciseId));
  });
});
