// Prospective prescription tracking: immutable snapshots, observed
// follow-through, engine-version stability, replay separation and legacy
// compatibility. Stored snapshots are the audit source — the current engine
// must never be re-run to score them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrescriptionSnapshot, recommendNext, attachPrescription, carryPrescription, freezePrescriptionBlock, supersedePrescription, deepFreezePrescription, PRESCRIPTION_CHANGE_REASONS } from '../src/lib/progression.js';
import { observedPrescriptionFollowThrough } from '../src/lib/analytics.js';
import { progressAssessment } from '../src/lib/product.js';
import { initGuidedBlocks, buildGuidedPayload, withGuidedStepPrescription } from '../src/lib/guidedMode.js';
import { visiblePrescriptionIndexes } from '../src/lib/gymMode.js';
import { normaliseHistoryEntry } from '../src/lib/store.js';
import { parseImportFile } from '../src/lib/export.js';

globalThis.localStorage = { _m: {}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k, v){ this._m[k] = String(v); }, removeItem(k){ delete this._m[k]; } };

const block = (exerciseId, sets) => ({ exerciseId, sets });
const set = (reps, weightKg, extra = {}) => ({ reps: String(reps), weightKg: String(weightKg), completed: true, ...extra });

function snapshot(sessionId, dateISO, exerciseId, prescribedSets, prescribedReps, prescribedLoadKg, prescribedAt){
  return buildPrescriptionSnapshot({
    session: { id: sessionId, dateISO },
    block: { exerciseId, sets: prescribedSets, reps: `8–${prescribedReps}` },
    blockIndex: 0,
    recommendation: { reps: prescribedReps, load: prescribedLoadKg, reason: 'test prescription', priorsVersion: 1, policy: 'standard', policyVersion: 3 },
    prescribedAt,
    policy: 'standard',
  });
}

function observedHistory(){
  // Four workouts, eight prescribed sets, six complete targets: 75%.
  const rows = [
    { id: 'o1', dateISO: '2026-08-10', actual: [set(8, 20), set(8, 20)] },
    { id: 'o2', dateISO: '2026-08-13', actual: [set(9, 20), { reps: '9', weightKg: '20', completed: false, skipped: true }] },
    { id: 'o3', dateISO: '2026-08-16', actual: [set(10, 20), set(10, 20)] },
    { id: 'o4', dateISO: '2026-08-19', actual: [set(11, 20), { reps: '11', weightKg: '15', completed: true, failed: true }] },
  ];
  return rows.map((row, index) => ({
    id: row.id,
    dateISO: row.dateISO,
    blocks: [{
      exerciseId: 'bench-press-dumbbell',
      prescription: snapshot(row.id, row.dateISO, 'bench-press-dumbbell', 2, 8 + index, 20, `${row.dateISO}T09:00:00.000Z`),
      sets: row.actual,
    }],
  }));
}

describe('prescription snapshots', ()=>{
  it('freezes every required field at prescription time', ()=>{
    const rx = snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 3, 9, 22.5, '2026-08-10T09:00:00.000Z');
    assert.equal(rx.schemaVersion, 1);
    assert.equal(rx.source, 'engine');
    assert.equal(rx.sessionId, 's1');
    assert.equal(rx.exerciseId, 'bench-press-dumbbell');
    assert.equal(rx.prescribedSets, 3);
    assert.equal(rx.prescribedReps, 9);
    assert.equal(rx.prescribedLoadKg, 22.5);
    assert.equal(rx.prescribedAt, '2026-08-10T09:00:00.000Z');
    assert.equal(rx.priorCutoffDateISO, '2026-08-10');
    assert.equal(rx.engine.name, 'arise-engine');
    assert.equal(rx.engine.priorsVersion, 1);
    assert.equal(rx.engine.policy, 'standard');
    assert.ok(rx.reason.length > 0);
    assert.ok(Object.isFrozen(rx));
    assert.equal(rx.firstShownAt, '2026-08-10T09:00:00.000Z');
    assert.equal(rx.shownAt, '2026-08-10T09:00:00.000Z');
    assert.equal(rx.createdAt, '2026-08-10T09:00:00.000Z');
    assert.equal(rx.prescribedAt, rx.firstShownAt);
    assert.ok(Object.isFrozen(rx.engine), 'nested engine metadata must be deeply frozen');
  });

  it('captures schedule prescriptions without inventing engine fields', ()=>{
    const rx = buildPrescriptionSnapshot({
      session: { id: 'g1', dateISO: '2026-08-10' },
      block: { exerciseId: 'push-up', sets: 3, reps: '8–12' },
      blockIndex: 0,
      recommendation: null,
      prescribedAt: '2026-08-10T09:00:00.000Z',
    });
    assert.equal(rx.source, 'schedule');
    assert.equal(rx.prescribedSets, 3);
    assert.equal(rx.prescribedRepRange, '8–12');
    assert.equal(rx.engine, null);
  });

  it('refuses to build without identity, planned sets or a timestamp', ()=>{
    assert.equal(buildPrescriptionSnapshot({ session: { dateISO: '2026-08-10' }, block: { exerciseId: 'push-up', sets: 3 }, prescribedAt: '2026-08-10T09:00:00.000Z' }), null);
    assert.equal(buildPrescriptionSnapshot({ session: { id: 's1', dateISO: '2026-08-10' }, block: { exerciseId: 'push-up', sets: 0 }, prescribedAt: '2026-08-10T09:00:00.000Z' }), null);
    assert.equal(buildPrescriptionSnapshot({ session: { id: 's1', dateISO: '2026-08-10' }, block: { exerciseId: 'push-up', sets: 3 } }), null);
  });

  it('survives normalisation unchanged and is never regenerated there', ()=>{
    const history = observedHistory();
    const normalised = normaliseHistoryEntry(history[0]);
    assert.deepEqual(normalised.blocks[0].prescription, history[0].blocks[0].prescription);
    const legacy = normaliseHistoryEntry({ id: 'legacy', dateISO: '2026-01-01', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '10', weightKg: '0' }] }] });
    assert.ok(!('prescription' in legacy.blocks[0]), 'legacy blocks must not gain fabricated snapshots');
  });
});

describe('observed prescription follow-through', ()=>{
  it('scores stored prescriptions across workouts', ()=>{
    const result = observedPrescriptionFollowThrough(observedHistory());
    assert.equal(result.source, 'observed');
    assert.equal(result.workouts, 4);
    assert.equal(result.exercises, 1);
    assert.equal(result.attempted, 1);
    assert.equal(result.prescribedSets, 8);
    assert.equal(result.setsCompleted, 6);
    assert.equal(result.repTargetsMet, 6);
    assert.equal(result.loadTargetsMet, 6);
    assert.equal(result.completeTargets, 6);
    assert.equal(result.skippedSets, 1);
    assert.equal(result.failedSets, 1);
    assert.equal(result.followThroughPct, 75);
  });

  it('counts extra sets as modified work, not as prescription success', ()=>{
    const history = [{
      id: 'x1', dateISO: '2026-08-10',
      blocks: [{
        exerciseId: 'push-up',
        prescription: snapshot('x1', '2026-08-10', 'push-up', 2, 10, 0, '2026-08-10T09:00:00.000Z'),
        sets: [set(10, 0), set(10, 0), set(10, 0)],
      }],
    }];
    const result = observedPrescriptionFollowThrough(history);
    assert.equal(result.prescribedSets, 2);
    assert.equal(result.completeTargets, 2);
    assert.equal(result.extraSets, 1);
    assert.equal(result.followThroughPct, 100);
  });

  it('scores only the active revision, never a superseded prescription in the denominator', ()=>{
    const superseded = snapshot('x2', '2026-08-10', 'bench-press-dumbbell', 9, 8, 20, '2026-08-10T09:00:00.000Z');
    const active = buildPrescriptionSnapshot({
      session: { id: 'x2', dateISO: '2026-08-10' },
      block: { exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8–12' },
      blockIndex: 0,
      recommendation: { reps: 8, load: 20, reason: 'swap', priorsVersion: 1 },
      prescribedAt: '2026-08-10T09:10:00.000Z',
      previous: superseded,
      changeReason: 'exercise-substituted',
    });
    const history = [{
      id: 'x2', dateISO: '2026-08-10',
      blocks: [{ exerciseId: 'bench-press-dumbbell', prescription: active, prescriptionHistory: [superseded], sets: [set(8, 20), set(8, 20)] }],
    }];
    const result = observedPrescriptionFollowThrough(history);
    assert.equal(result.prescribedSets, 2, 'only the active revision feeds the denominator');
    assert.equal(result.completeTargets, 2);
    assert.equal(result.followThroughPct, 100);
  });

  it('ignores legacy sessions instead of reconstructing them', ()=>{
    const result = observedPrescriptionFollowThrough([{ id: 'old', dateISO: '2026-01-01', blocks: [{ exerciseId: 'push-up', sets: [set(10, 0)] }] }]);
    assert.equal(result.prescribedSets, 0);
    assert.equal(result.followThroughPct, null);
    assert.match(result.note, /legacy sessions are excluded/);
  });

  it('does not let a changed engine rewrite a stored outcome', ()=>{
    const history = observedHistory();
    const before = observedPrescriptionFollowThrough(history);
    // A newer engine would now demand more — the stored audit must not move.
    const current = recommendNext({ exerciseId: 'bench-press-dumbbell', history, targetReps: '8–12', conservative: false });
    assert.ok(current);
    const after = observedPrescriptionFollowThrough(history);
    assert.deepEqual(after, before);
    assert.equal(history[0].blocks[0].prescription.engine.priorsVersion, 1);
  });
});

describe('assessment source separation', ()=>{
  it('prefers stored prescriptions and keeps replay out of the verdict', ()=>{
    // Six rising sessions with stored snapshots: 10 of 12 targets met (83%).
    const rows = [
      { id: 'p1', dateISO: '2026-08-10', rxReps: 8, actual: [set(8, 20), set(8, 20)] },
      { id: 'p2', dateISO: '2026-08-13', rxReps: 9, actual: [set(9, 20), { reps: '9', weightKg: '20', completed: false, skipped: true }] },
      { id: 'p3', dateISO: '2026-08-16', rxReps: 10, actual: [set(10, 20), set(10, 20)] },
      { id: 'p4', dateISO: '2026-08-19', rxReps: 11, actual: [set(11, 20), { reps: '11', weightKg: '15', completed: true, failed: true }] },
      { id: 'p5', dateISO: '2026-08-22', rxReps: 12, actual: [set(12, 20), set(12, 20)] },
      { id: 'p6', dateISO: '2026-08-25', rxReps: 8, actual: [set(8, 22.5), set(8, 22.5)] },
    ];
    const history = rows.map((row) => ({
      id: row.id,
      dateISO: row.dateISO,
      blocks: [{
        exerciseId: 'bench-press-dumbbell',
        prescription: snapshot(row.id, row.dateISO, 'bench-press-dumbbell', 2, row.rxReps, row.id === 'p6' ? 22.5 : 20, `${row.dateISO}T09:00:00.000Z`),
        sets: row.actual,
      }],
    }));
    const assessment = progressAssessment({ history, today: '2026-08-26' });
    assert.equal(assessment.targets.source, 'observed');
    assert.equal(assessment.verdict, 'likely-improving');
    assert.ok(assessment.signals.some((signal) => signal.label.startsWith('Actual prescription follow-through')));
    assert.ok(!assessment.signals.some((signal) => signal.label.startsWith('Retrospective engine replay')));
    assert.ok(!assessment.signals.some((signal) => signal.id === 'prescription-early'), 'established observed must not also show an early signal');
    assert.ok(!assessment.reasons.some((reason) => /reconstructed|replay/i.test(reason)));
  });

  it('falls back to labelled replay for legacy histories at reduced coverage', ()=>{
    const history = [
      { id: 'a', dateISO: '2026-08-10', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(8, 20)] }] },
      { id: 'b', dateISO: '2026-08-13', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(9, 20)] }] },
      { id: 'c', dateISO: '2026-08-16', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(10, 20)] }] },
      { id: 'd', dateISO: '2026-08-19', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(11, 20)] }] },
      { id: 'e', dateISO: '2026-08-22', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(12, 20)] }] },
      { id: 'f', dateISO: '2026-08-25', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(8, 22.5)] }] },
      { id: 'g', dateISO: '2026-08-28', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(9, 22.5)] }] },
    ];
    const assessment = progressAssessment({ history, today: '2026-08-29' });
    assert.equal(assessment.targets.source, 'replay');
    assert.ok(assessment.signals.some((signal) => signal.label.startsWith('Retrospective engine replay')));
    assert.equal(assessment.coverage, 'Low');
  });
});

describe('prescription export compatibility', ()=>{
  it('round-trips stored snapshots without fabricating legacy ones', ()=>{
    const history = observedHistory();
    const envelope = JSON.stringify({ app: 'arise', data: { history } });
    const imported = parseImportFile(envelope);
    assert.deepEqual(imported.history[0].blocks[0].prescription, history[0].blocks[0].prescription);
    const legacyEnvelope = JSON.stringify({ app: 'arise', data: { history: [{ id: 'old', dateISO: '2026-01-01', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '10', weightKg: '0' }] }] }] } });
    const legacy = parseImportFile(legacyEnvelope);
    assert.ok(!('prescription' in legacy.history[0].blocks[0]));
  });
});

describe('prescription identity and provenance', ()=>{
  const ts = '2026-08-10T09:00:00.000Z';
  it('stamps a deterministic id, revision and initial reason on first freeze', ()=>{
    const rx = snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 3, 9, 22.5, ts);
    assert.equal(rx.revision, 1);
    assert.equal(rx.prescriptionId, 's1:0:bench-press-dumbbell:r1');
    assert.equal(rx.changeReason, 'initial-prescription');
    assert.equal(rx.supersedesPrescriptionId, null);
    assert.equal(rx.previousExerciseId, null);
    assert.equal(buildPrescriptionSnapshot({ session: { id: 's1', dateISO: '2026-08-10' }, block: { exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–9' }, blockIndex: 0, recommendation: { reps: 9, load: 22.5, reason: 'x', priorsVersion: 1 }, prescribedAt: ts }).prescriptionId, rx.prescriptionId);
  });
});

describe('a shown prescription is immutable — policy changes cannot mutate it', ()=>{
  const ts = '2026-08-10T09:00:00.000Z';
  it('refuses to overwrite an existing snapshot even if a rebuild would differ', ()=>{
    const rx = snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 2, 8, 20, ts);
    const block = { exerciseId: 'bench-press-dumbbell', sets: [set(8, 20)], prescription: rx };
    const aggressive = buildPrescriptionSnapshot({
      session: { id: 's1', dateISO: '2026-08-10' },
      block: { exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8–12' },
      blockIndex: 0,
      recommendation: { reps: 15, load: 99, reason: 'aggressive', priorsVersion: 9, policy: 'aggressive' },
      prescribedAt: '2026-08-10T09:30:00.000Z',
      policy: 'aggressive',
    });
    assert.equal(aggressive.prescriptionId, rx.prescriptionId);
    assert.notEqual(aggressive.prescribedLoadKg, rx.prescribedLoadKg);
    const after = attachPrescription(block, aggressive);
    assert.equal(after.prescription, rx);
    assert.equal(after.prescription.prescribedLoadKg, 20);
    assert.ok(!('prescriptionHistory' in after));
    assert.throws(()=>{ after.prescription.prescribedReps = 999; }, TypeError);
  });
});

describe('draft, refresh and crash recovery preserve the snapshot', ()=>{
  const ts = '2026-08-10T09:00:00.000Z';
  it('re-freezes a prescription returning from storage and rebuilds nothing', ()=>{
    const rx = snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 2, 8, 20, ts);
    const fromStorage = JSON.parse(JSON.stringify({ ...rx }));
    assert.ok(!Object.isFrozen(fromStorage), 'storage round-trip yields a plain object');
    const restored = freezePrescriptionBlock({ exerciseId: 'bench-press-dumbbell', sets: [set(8, 20)], prescription: fromStorage, prescriptionHistory: [fromStorage] });
    assert.ok(Object.isFrozen(restored.prescription));
    assert.deepEqual(restored.prescription, rx);
    assert.ok(restored.prescriptionHistory.every((item)=> Object.isFrozen(item)));
  });
  it('drops a null/absent prescription so legacy drafts gain none', ()=>{
    const restored = freezePrescriptionBlock({ exerciseId: 'push-up', sets: [set(10, 0)] });
    assert.ok(!('prescription' in restored));
    assert.ok(!('prescriptionHistory' in restored));
  });
});

describe('final save copies the exact snapshot and never re-runs the engine', ()=>{
  const ts = '2026-08-10T09:00:00.000Z';
  it('carryPrescription returns the identical frozen object (plus history)', ()=>{
    const prev = snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 2, 8, 20, ts);
    const after = buildPrescriptionSnapshot({
      session: { id: 's1', dateISO: '2026-08-10' },
      block: { exerciseId: 'push-up', sets: 2, reps: '8–12' },
      blockIndex: 0,
      recommendation: null,
      prescribedAt: '2026-08-10T09:05:00.000Z',
      previous: prev,
      changeReason: 'exercise-substituted',
    });
    const attached = attachPrescription({ exerciseId: 'push-up', sets: [set(8, 0)], prescription: prev }, after);
    const carried = carryPrescription(attached);
    assert.equal(carried.prescription, attached.prescription);
    assert.deepEqual(carried.prescription, after);
    assert.ok(Object.isFrozen(carried.prescription));
    assert.equal(carried.prescriptionHistory.length, 1);
    assert.equal(carried.prescriptionHistory[0], prev);
    assert.equal(carried.prescription.prescribedLoadKg, null);
    assert.ok(!('prescription' in carryPrescription({ exerciseId: 'x', sets: [] })));
  });
  it('a stored priors version is not silently restamped by a newer engine', ()=>{
    const rx = snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 2, 8, 20, ts);
    assert.equal(rx.engine.priorsVersion, 1);
    recommendNext({ exerciseId: 'bench-press-dumbbell', history: observedHistory(), targetReps: '8–12' });
    const carried = carryPrescription({ exerciseId: 'bench-press-dumbbell', prescription: rx });
    assert.equal(carried.prescription.engine.priorsVersion, 1);
  });
});

describe('exercise swaps create explicit new provenance', ()=>{
  const ts = '2026-08-10T09:00:00.000Z';
  it('supersede records previous exercise + id and preserves the old snapshot', ()=>{
    const prev = snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 2, 8, 20, ts);
    const after = buildPrescriptionSnapshot({
      session: { id: 's1', dateISO: '2026-08-10' },
      block: { exerciseId: 'push-up', sets: 3, reps: '8–12' },
      blockIndex: 0,
      recommendation: null,
      prescribedAt: '2026-08-10T09:05:00.000Z',
      previous: prev,
      changeReason: 'exercise-substituted',
    });
    assert.equal(after.previousExerciseId, 'bench-press-dumbbell');
    assert.equal(after.supersedesPrescriptionId, prev.prescriptionId);
    assert.equal(after.revision, 2);
    assert.equal(after.changeReason, 'exercise-substituted');
    assert.notEqual(after.prescriptionId, prev.prescriptionId);
    const attached = attachPrescription({ exerciseId: 'push-up', sets: [set(8, 0)], prescription: prev }, after);
    assert.equal(attached.prescription, after);
    assert.deepEqual(attached.prescriptionHistory, [prev]);
    assert.ok(Object.isFrozen(prev));
    assert.equal(prev.prescriptionId, 's1:0:bench-press-dumbbell:r1');
  });
});

describe('guided mode freezes the schedule prescription on first-visible step', ()=>{
  const started = '2026-08-10T09:00:00.000Z';
  const session = { id: 'g1', dateISO: '2026-08-10', blocks: [
    { exerciseId: 'push-up', sets: 3, reps: '8–12' },
    { exerciseId: 'plank', sets: 2, reps: '45s' },
  ] };
  it('init does NOT fabricate a snapshot — capture waits for the active step', ()=>{
    const blocks = initGuidedBlocks(session, [], null);
    assert.ok(!('prescription' in blocks[0]) || blocks[0].prescription == null, 'nothing is frozen before any step is shown');
  });
  it('captures only the active block when its step is first shown', ()=>{
    const fresh = initGuidedBlocks(session, [], null);
    const afterStep0 = withGuidedStepPrescription(session, fresh, 0, started);
    assert.ok(afterStep0[0].prescription, 'active block is captured');
    assert.equal(afterStep0[0].prescription.source, 'schedule');
    assert.equal(afterStep0[0].prescription.prescriptionId, 'g1:0:push-up:r1');
    assert.ok(afterStep0[0].prescription.firstShownAt === started);
    assert.ok(!afterStep0[1].prescription, 'a not-yet-visible block is never captured');
    assert.ok(Object.isFrozen(afterStep0[0].prescription));
  });
  it('a later step is captured only when it becomes active; earlier ones are untouched', ()=>{
    let blocks = withGuidedStepPrescription(session, initGuidedBlocks(session, [], null), 0, started);
    const firstId = blocks[0].prescription.prescriptionId;
    blocks = withGuidedStepPrescription(session, blocks, 1, '2026-08-10T09:20:00.000Z');
    assert.equal(blocks[0].prescription.prescriptionId, firstId, 'block 0 snapshot is not re-stamped');
    assert.ok(blocks[1].prescription);
    assert.equal(blocks[1].prescription.firstShownAt, '2026-08-10T09:20:00.000Z');
  });
  it('re-capturing an already-shown step is a no-op (stable array, no loop)', ()=>{
    const captured = withGuidedStepPrescription(session, initGuidedBlocks(session, [], null), 0, started);
    assert.equal(withGuidedStepPrescription(session, captured, 0, '2026-08-10T10:00:00.000Z'), captured);
  });
  it('a restored draft keeps its snapshot and save carries it unchanged', ()=>{
    const captured = withGuidedStepPrescription(session, initGuidedBlocks(session, [], null), 0, started);
    const restored = initGuidedBlocks(session, [], captured);
    assert.equal(restored[0].prescription.prescriptionId, captured[0].prescription.prescriptionId);
    assert.equal(restored[0].prescription.firstShownAt, started);
    const payload = buildGuidedPayload({ session, blocks: restored, startedAtISO: started });
    assert.deepEqual(payload.blocks[0].prescription, captured[0].prescription);
    assert.equal(payload.blocks[0].prescription.source, 'schedule');
  });
});

describe('first-visible timing in the standard runner', ()=>{
  it('Gym Mode freezes only the focused block; standard mode all rendered blocks', ()=>{
    assert.deepEqual(visiblePrescriptionIndexes({ gymMode: true, focusIdx: 1, blockCount: 3 }), [1]);
    assert.deepEqual(visiblePrescriptionIndexes({ gymMode: true, focusIdx: 5, blockCount: 3 }), [], 'an out-of-range focus shows nothing');
    assert.deepEqual(visiblePrescriptionIndexes({ gymMode: false, focusIdx: 0, blockCount: 3 }), [0, 1, 2]);
  });
  it('a first-visible snapshot records createdAt and firstShownAt at the show moment, not session start', ()=>{
    const session = { id: 's1', dateISO: '2026-08-10', startedAt: '2026-08-10T09:00:00.000Z' };
    const rx = buildPrescriptionSnapshot({
      session,
      block: { exerciseId: 'bench-press-dumbbell', sets: 2 },
      blockIndex: 0,
      recommendation: { reps: 8, load: 20, reason: 'x', priorsVersion: 1 },
      shownAt: '2026-08-10T09:00:07.000Z',
    });
    assert.equal(rx.firstShownAt, '2026-08-10T09:00:07.000Z');
    assert.equal(rx.createdAt, '2026-08-10T09:00:07.000Z');
    assert.notEqual(rx.firstShownAt, session.startedAt, 'first-visible is not the session-start stamp');
  });
});

describe('deep prescription immutability', ()=>{
  const ts = '2026-08-10T09:00:00.000Z';
  it('nested mutation attempts throw, at every level', ()=>{
    const rx = buildPrescriptionSnapshot({
      session: { id: 's1', dateISO: '2026-08-10' },
      block: { exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8–12' },
      blockIndex: 0,
      recommendation: { reps: 8, load: 20, reason: 'x', priorsVersion: 1, confidence: { level: 'medium', components: { n: 4, r2: 0.8 } } },
      shownAt: ts,
    });
    assert.ok(Object.isFrozen(rx));
    assert.ok(Object.isFrozen(rx.engine));
    assert.ok(Object.isFrozen(rx.confidence));
    assert.ok(Object.isFrozen(rx.confidence.components));
    assert.throws(()=>{ rx.prescribedReps = 999; }, TypeError);
    assert.throws(()=>{ rx.engine.policy = 'aggressive'; }, TypeError);
    assert.throws(()=>{ rx.confidence.components.n = 999; }, TypeError);
    assert.throws(()=>{ rx.prescriptionId = 'tampered'; }, TypeError);
  });
  it('deepFreezePrescription freezes a plain restored object deeply and is idempotent', ()=>{
    const plain = JSON.parse(JSON.stringify(snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 2, 8, 20, ts)));
    assert.ok(!Object.isFrozen(plain.engine));
    const frozen = deepFreezePrescription(plain);
    assert.ok(Object.isFrozen(frozen));
    assert.ok(Object.isFrozen(frozen.engine));
    assert.equal(deepFreezePrescription(frozen), frozen);
  });
  it('a restored draft block re-freezes its nested snapshot and history', ()=>{
    const prev = snapshot('s1', '2026-08-10', 'bench-press-dumbbell', 2, 8, 20, ts);
    const after = buildPrescriptionSnapshot({
      session: { id: 's1', dateISO: '2026-08-10' },
      block: { exerciseId: 'push-up', sets: 2 },
      blockIndex: 0, recommendation: null, shownAt: '2026-08-10T09:05:00.000Z',
      previous: prev, changeReason: 'exercise-substituted',
    });
    const attached = attachPrescription({ exerciseId: 'push-up', sets: [set(8, 0)], prescription: prev }, after);
    const fromStorage = JSON.parse(JSON.stringify({ prescription: attached.prescription, prescriptionHistory: attached.prescriptionHistory }));
    assert.ok(!Object.isFrozen(fromStorage.prescriptionHistory[0].engine), 'storage yields plain objects');
    const restored = freezePrescriptionBlock({ exerciseId: 'push-up', prescription: fromStorage.prescription, prescriptionHistory: fromStorage.prescriptionHistory });
    assert.ok(Object.isFrozen(restored.prescription.engine));
    assert.ok(Object.isFrozen(restored.prescriptionHistory[0]));
    assert.ok(Object.isFrozen(restored.prescriptionHistory[0].engine), 'history is deeply frozen too');
  });
});

describe('provenance chains record every legitimate revision', ()=>{
  const session = { id: 's1', dateISO: '2026-08-10' };
  const engine = { name: 'arise-engine' };
  it('policy, equipment and programme changes each add a link with reason + preserved history', ()=>{
    let block = { exerciseId: 'bench-press-dumbbell', sets: [set(8, 20)] };
    block = attachPrescription(block, buildPrescriptionSnapshot({ session, block: { ...block, sets: 2 }, blockIndex: 0, recommendation: { reps: 8, load: 20, reason: 'r', priorsVersion: 1 }, shownAt: '2026-08-10T09:00:00.000Z' }));
    const r1 = block.prescription;
    block = supersedePrescription(block, { session, block: { exerciseId: 'bench-press-dumbbell', sets: 2 }, blockIndex: 0, recommendation: { reps: 9, load: 20, reason: 'p', priorsVersion: 1, policy: 'aggressive' }, shownAt: '2026-08-10T09:01:00.000Z', changeReason: 'policy-changed' });
    const r2 = block.prescription;
    block = supersedePrescription(block, { session, block: { exerciseId: 'dumbbell-row', sets: 2 }, blockIndex: 0, recommendation: { reps: 10, load: 30, reason: 'e', priorsVersion: 1 }, shownAt: '2026-08-10T09:02:00.000Z', changeReason: 'equipment-changed' });
    const r3 = block.prescription;
    block = supersedePrescription(block, { session, block: { exerciseId: 'dumbbell-row', sets: 3 }, blockIndex: 0, recommendation: { reps: 10, load: 30, reason: 'a', priorsVersion: 1 }, shownAt: '2026-08-10T09:03:00.000Z', changeReason: 'programme-adjusted' });
    const r4 = block.prescription;

    assert.equal(r2.changeReason, 'policy-changed');
    assert.equal(r3.changeReason, 'equipment-changed');
    assert.equal(r4.changeReason, 'programme-adjusted');
    assert.deepEqual([r1.revision, r2.revision, r3.revision, r4.revision], [1, 2, 3, 4]);
    assert.equal(r2.supersedesPrescriptionId, r1.prescriptionId);
    assert.equal(r3.supersedesPrescriptionId, r2.prescriptionId);
    assert.equal(r3.previousExerciseId, 'bench-press-dumbbell');
    assert.equal(r4.supersedesPrescriptionId, r3.prescriptionId);
    assert.deepEqual(block.prescriptionHistory.map((rx)=> rx.revision), [1, 2, 3]);
    assert.equal(block.prescription, r4);
    assert.ok(block.prescriptionHistory.every((rx)=> Object.isFrozen(rx.engine ?? {})));
    assert.ok(PRESCRIPTION_CHANGE_REASONS.includes('user-requested-change'));
  });
  it('supersede never mutates the previous snapshot it preserves', ()=>{
    const block = attachPrescription({ exerciseId: 'bench-press-dumbbell', sets: [set(8, 20)] }, buildPrescriptionSnapshot({ session, block: { exerciseId: 'bench-press-dumbbell', sets: 2 }, blockIndex: 0, recommendation: { reps: 8, load: 20, reason: 'r', priorsVersion: 1 }, shownAt: '2026-08-10T09:00:00.000Z' }));
    const before = block.prescription;
    const snapshot = JSON.parse(JSON.stringify(before));
    supersedePrescription(block, { session, block: { exerciseId: 'push-up', sets: 2 }, blockIndex: 0, recommendation: { reps: 9, load: 21, reason: 'p', priorsVersion: 1 }, shownAt: '2026-08-10T09:01:00.000Z', changeReason: 'policy-changed' });
    assert.deepEqual({ ...before }, snapshot, 'the preserved snapshot is byte-for-byte unchanged');
  });
});

describe('export/import preserves the full revision chain and deep fields', ()=>{
  it('round-trips active snapshot, history and provenance without fabricating legacy ones', ()=>{
    const session = { id: 's1', dateISO: '2026-08-10' };
    const first = buildPrescriptionSnapshot({ session, block: { exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8–12' }, blockIndex: 0, recommendation: { reps: 8, load: 20, reason: 'r', priorsVersion: 1 }, shownAt: '2026-08-10T09:00:00.000Z' });
    const second = buildPrescriptionSnapshot({ session, block: { exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8–12' }, blockIndex: 0, recommendation: { reps: 9, load: 20, reason: 'p', priorsVersion: 1 }, shownAt: '2026-08-10T09:01:00.000Z', previous: first, changeReason: 'policy-changed' });
    const history = [{ id: 's1', dateISO: '2026-08-10', blocks: [{ exerciseId: 'bench-press-dumbbell', prescription: second, prescriptionHistory: [first], sets: [set(9, 20), set(9, 20)] }] }];
    const imported = parseImportFile(JSON.stringify({ app: 'arise', data: { history } }));
    const block = imported.history[0].blocks[0];
    assert.deepEqual(block.prescription, second);
    assert.equal(block.prescription.changeReason, 'policy-changed');
    assert.equal(block.prescription.supersedesPrescriptionId, first.prescriptionId);
    assert.equal(block.prescription.firstShownAt, '2026-08-10T09:01:00.000Z');
    assert.equal(block.prescriptionHistory.length, 1);
    assert.deepEqual(block.prescriptionHistory[0], first);
  });
});

describe('early observed follow-through never decides the verdict', ()=>{
  const rows = [
    { id: 'e0', dateISO: '2026-08-10', reps: 8, load: 20 },
    { id: 'e1', dateISO: '2026-08-13', reps: 9, load: 20 },
    { id: 'e2', dateISO: '2026-08-16', reps: 10, load: 20 },
    { id: 'e3', dateISO: '2026-08-19', reps: 11, load: 20 },
    { id: 'e4', dateISO: '2026-08-22', reps: 12, load: 20 },
    { id: 'e5', dateISO: '2026-08-25', reps: 13, load: 20 },
  ];
  it('surfaces 1–3 observed workouts as a separate non-deciding signal while replay decides', ()=>{
    const rxIds = new Set(['e0', 'e1']);
    const history = rows.map((row)=> {
      const block = { exerciseId: 'bench-press-dumbbell', sets: [set(row.reps, row.load), set(row.reps, row.load)] };
      if(rxIds.has(row.id)) block.prescription = snapshot(row.id, row.dateISO, 'bench-press-dumbbell', 2, row.reps, row.load, `${row.dateISO}T09:00:00.000Z`);
      return { id: row.id, dateISO: row.dateISO, blocks: [block] };
    });
    const assessment = progressAssessment({ history, today: '2026-08-26' });
    assert.equal(assessment.targets.source, 'replay');
    assert.ok(assessment.signals.some((signal)=> signal.label.startsWith('Retrospective engine replay')));
    const early = assessment.signals.find((signal)=> signal.id === 'prescription-early');
    assert.ok(early, 'early observed follow-through should surface');
    assert.equal(early.deciding, false);
    assert.match(early.label, /^Early observed follow-through/);
    assert.equal(assessment.coverage, 'Low');
  });
  it('shows early observed follow-through even while the verdict is withheld', ()=>{
    const history = rows.slice(0, 3).map((row)=> ({
      id: row.id,
      dateISO: row.dateISO,
      blocks: [{
        exerciseId: 'bench-press-dumbbell',
        prescription: snapshot(row.id, row.dateISO, 'bench-press-dumbbell', 2, row.reps, row.load, `${row.dateISO}T09:00:00.000Z`),
        sets: [set(row.reps, row.load), set(row.reps, row.load)],
      }],
    }));
    const assessment = progressAssessment({ history, today: '2026-08-17' });
    assert.equal(assessment.verdict, 'insufficient-evidence');
    assert.equal(assessment.signals.length, 1);
    assert.match(assessment.signals[0].label, /^Early observed follow-through/);
    assert.equal(assessment.signals[0].deciding, false);
    assert.ok(!assessment.signals.some((signal)=> signal.label.startsWith('Actual prescription')));
    assert.ok(!assessment.signals.some((signal)=> signal.label.startsWith('Retrospective engine replay')));
  });
});
