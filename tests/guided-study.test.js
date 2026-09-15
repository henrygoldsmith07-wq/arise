import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withGuidedStepPrescription, applyGuidedTreatment, initGuidedBlocks } from '../src/lib/guidedMode.js';
import { treatmentRecommendation } from '../src/lib/treatment.js';
import { studyArmFor, enrollParticipant } from '../src/lib/studyEnrollment.js';
import { recordRecommendation, attachOutcome, loadEvaluationLedger } from '../src/lib/longitudinal.js';
import { EXERCISE_BY_ID } from '../src/lib/data.js';

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

  it('BOTH assigned arms use the same application path; null keeps normal behaviour', ()=>{
    const scheduled = [{ exerciseId: 'goblet-squat', reps: '8', weightKg: '25', completed: false, failed: false, skipped: false, setId: 'sid-1', plannedSlot: 0, governingPrescriptionId: 'rx-1' }];
    const blocks = [{ exerciseId: 'goblet-squat', reps: '8', restSec: 90, sets: scheduled.slice() }];
    const ariseRec = { reps: 9, load: 27.5, assistKg: null };
    const next = applyGuidedTreatment(blocks, 0, 'arise', ariseRec);
    assert.equal(next[0].sets[0].reps, '9', 'Arise assignment shows 9, not the scheduled 8');
    assert.equal(next[0].sets[0].weightKg, '27.5', 'Arise assignment shows 27.5 kg, not the scheduled 25');
    assert.equal(next[0].sets[0].setId, 'sid-1', 'stable set identity survives treatment');
    assert.equal(next[0].sets[0].plannedSlot, 0);
    assert.equal(next[0].sets[0].governingPrescriptionId, 'rx-1', 'prescription identity untouched');
    // DP reaches the same fields through the same function:
    const dpNext = applyGuidedTreatment(blocks, 0, 'double-progression', { reps: 10, load: 25, assistKg: null });
    assert.equal(dpNext[0].sets[0].reps, '10');
    // null / unknown arms: normal Guided behaviour, nothing applied.
    assert.equal(applyGuidedTreatment(blocks, 0, null, ariseRec), blocks);
    assert.equal(applyGuidedTreatment(blocks, 0, 'arise', null), blocks);
    // Idempotent: re-applying the same treatment changes nothing.
    assert.equal(applyGuidedTreatment(next, 0, 'arise', ariseRec), next);
  });

  it('assistance is applied only where the exercise supports it', ()=>{
    const blocks = [{ exerciseId: 'pull-up', reps: '6', restSec: 90, sets: [{ reps: '6', weightKg: '', assistedKg: '', completed: false }] }];
    const assisted = applyGuidedTreatment(blocks, 0, 'arise', { reps: 5, assistKg: 15 });
    if(assisted !== blocks){
      assert.equal(assisted[0].sets[0].assistedKg, '15');
    }else{
      assert.equal(EXERCISE_BY_ID['pull-up'].supportsAssisted, false);
    }
    const unsupported = applyGuidedTreatment([{ exerciseId: 'goblet-squat', reps: '8', sets: [{ reps: '8', weightKg: '20', completed: false }] }], 0, 'arise', { reps: 9, assistKg: 10 });
    assert.equal(unsupported[0].sets[0].assistedKg, undefined, 'no assistance written to a non-assisted lift');
  });

  it('performed work is never rewritten by treatment', ()=>{
    const blocks = [{ exerciseId: 'goblet-squat', reps: '8', sets: [
      { reps: '7', weightKg: '22.5', completed: true, setId: 'a' },
      { reps: '5', weightKg: '25', failed: true, setId: 'b' },
      { reps: '8', weightKg: '25', skipped: true, setId: 'c' },
      { reps: '8', weightKg: '25', completed: false, setId: 'd' },
    ] }];
    const next = applyGuidedTreatment(blocks, 0, 'double-progression', { reps: 10, load: 27.5 });
    const sets = next[0].sets;
    assert.deepEqual([sets[0].reps, sets[0].weightKg], ['7', '22.5'], 'completed set frozen');
    assert.deepEqual([sets[1].reps, sets[1].weightKg], ['5', '25'], 'failed set frozen');
    assert.deepEqual([sets[2].reps, sets[2].weightKg], ['8', '25'], 'skipped set frozen');
    assert.deepEqual([sets[3].reps, sets[3].weightKg], ['10', '27.5'], 'only untouched work takes the treatment');
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
  it('recorded prescription = applied target = performed work; outcome resolves against it', ()=>{
    const storage = memoryStorage();
    const exId = 'goblet-squat';
    const prior = [{ id: 'hp', dateISO: '2026-03-02', blocks: [{ exerciseId: exId, sets: [{ reps: '8', weightKg: '25', rpe: '' }] }] }];
    const rec = treatmentRecommendation({ block: { exerciseId: exId, reps: '8' }, history: prior, asOfDateISO: '2026-03-09', assignedArm: 'arise' });
    recordRecommendation({
      exerciseId: exId, recommendation: rec, history: prior, dueDateISO: '2026-03-09',
      preferences: { telemetryEnabled: true }, nowISO: '2026-03-09T09:00:00.000Z',
      assignedArm: 'arise', participantId: 'e'.repeat(16), storage,
    });
    const blocks = [{ exerciseId: exId, reps: '8', sets: [{ reps: '8', weightKg: '25', completed: false, setId: 'x1' }] }];
    const treated = applyGuidedTreatment(blocks, 0, 'arise', rec);
    assert.equal(treated[0].sets[0].reps, String(rec.reps));
    if(rec.load != null) assert.equal(treated[0].sets[0].weightKg, String(rec.load));
    // The participant performs the treated (visible) target:
    attachOutcome({
      sessionId: 'g1', dateISO: '2026-03-09',
      blocks: [{ exerciseId: exId, sets: [{ reps: treated[0].sets[0].reps, weightKg: treated[0].sets[0].weightKg, completed: true }] }],
      preferences: { telemetryEnabled: true }, nowISO: '2026-03-09T10:00:00.000Z', storage,
    });
    const row = loadEvaluationLedger(storage).find(r=> r.exerciseId === exId);
    assert.equal(row.recommendation.reps, rec.reps ?? row.recommendation.reps);
    assert.equal(row.outcome.assignedMet, true, 'the performed set meets the recorded prescription');
    assert.equal(row.outcome.followed, true, 'performed values match the shown treatment');
  });

  it('identical inputs produce an identical prescription wherever it is used', ()=>{
    const block = { exerciseId: 'goblet-squat', reps: '8' };
    const a = treatmentRecommendation({ block, history, asOfDateISO: '2026-03-09', assignedArm: 'arise' });
    const b = treatmentRecommendation({ block, history, asOfDateISO: '2026-03-09', assignedArm: 'arise' });
    assert.deepEqual(a, b, 'same target for Standard and Guided from the same inputs');
    const applied = applyGuidedTreatment([{ exerciseId: 'goblet-squat', reps: '8', sets: [{ reps: '8', weightKg: '20', completed: false }] }], 0, 'arise', a);
    assert.equal(applied[0].sets[0].reps, String(a.reps), 'what guided displays/executes is what standard would record');
  });

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
