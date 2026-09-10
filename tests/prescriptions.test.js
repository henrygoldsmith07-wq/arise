// Prospective prescription tracking: immutable snapshots, observed
// follow-through, engine-version stability, replay separation and legacy
// compatibility. Stored snapshots are the audit source — the current engine
// must never be re-run to score them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrescriptionSnapshot, recommendNext } from '../src/lib/progression.js';
import { observedPrescriptionFollowThrough } from '../src/lib/analytics.js';
import { progressAssessment } from '../src/lib/product.js';
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
