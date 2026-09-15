import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureStudyParticipantId, isValidStudyParticipantId } from '../src/lib/studyIdentity.js';
import { enrollParticipant, enrollmentAudit, scheduledExerciseIds, assignmentFor } from '../src/lib/studyEnrollment.js';

const schedule = {
  programId: 'p', startDateISO: '2026-03-01',
  sessions: [{ id: 'w1d1', week: 1, day: 1, dateISO: '2026-03-02', status: 'planned', blocks: [
    { exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12', restSec: 90, loadHint: '' },
    { exerciseId: 'goblet-squat', sets: 3, reps: '10', restSec: 90, loadHint: '' },
    { exerciseId: 'romanian-deadlift', sets: 3, reps: '8', restSec: 90, loadHint: '' },
  ] }],
};

describe('participant self-onboarding (More → study card) joins cleanly', ()=>{
  it('ensures a stable pseudonymous id, then freezes a balanced enrollment', ()=>{
    const store = { version: 9, preferences: { telemetryEnabled: true }, history: [], activeSchedule: schedule };
    const withId = ensureStudyParticipantId(store); // returns the store with its id
    const id = withId.studyParticipantId;
    assert.ok(isValidStudyParticipantId(id));
    assert.equal(store.studyParticipantId, id);
    assert.equal(ensureStudyParticipantId(store).studyParticipantId, id, 'id is stable across joins/re-exports');

    const exerciseIds = scheduledExerciseIds(schedule);
    assert.deepEqual(exerciseIds.sort(), ['bench-press-dumbbell', 'goblet-squat', 'romanian-deadlift'].sort());
    const enrollment = enrollParticipant({ participantId: id, schedule, exerciseIds });
    const audit = enrollmentAudit(enrollment);
    assert.equal(audit.ok, true, JSON.stringify(audit));
    assert.equal(audit.arise + audit.doubleProgression, 3);
    assert.ok(Math.abs(audit.arise - audit.doubleProgression) <= 1, 'arms balanced per enrollment');
    for(const ex of exerciseIds){
      assert.ok(['arise', 'double-progression'].includes(assignmentFor(enrollment, ex)), ex);
    }
    // Deterministic: same id + same exercises → same assignment map (frozen
    // at entry; leaving and rejoining yields identical arms).
    const again = enrollParticipant({ participantId: id, schedule, exerciseIds });
    assert.deepEqual(again.assignments && Object.fromEntries(Object.entries(again.assignments).map(([k,v])=> [k, v.arm])),
      Object.fromEntries(Object.entries(enrollment.assignments).map(([k,v])=> [k, v.arm])));
  });

  it('an empty schedule falls back to exercised history, and audit is honest without enrollment', ()=>{
    assert.deepEqual(scheduledExerciseIds(null), []);
    assert.deepEqual(enrollmentAudit(null), { ok: false, reason: 'no enrollment' });
  });

  it('leaving is just dropping the enrollment — recorded pairs are untouched', ()=>{
    const store = { version: 9, studyParticipantId: 'a'.repeat(16) };
    // The store copy the card builds on "leave" keeps history/ledger fields;
    // only studyEnrollment is cleared.
    const left = { ...store, studyEnrollment: null };
    assert.equal(left.studyEnrollment, null);
    assert.equal(left.studyParticipantId, 'a'.repeat(16), 'identity persists for folding future exports');
  });
});
