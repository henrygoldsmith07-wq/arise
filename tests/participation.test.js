import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { studyEligibility, joinStudy, rejoinStudy, withdrawFromStudy, participationStatus, participationCopy, deleteStudyObservations } from '../src/lib/participation.js';
import { studyArmFor } from '../src/lib/studyEnrollment.js';
import { buildExportPayload, parseImportFile } from '../src/lib/export.js';

const schedule = {
  programId: 'p', startDateISO: '2026-03-01',
  sessions: [{ id: 'w1d1', week: 1, day: 1, dateISO: '2026-03-02', status: 'planned', blocks: [
    { exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12', restSec: 90, loadHint: '' },
    { exerciseId: 'goblet-squat', sets: 3, reps: '10', restSec: 90, loadHint: '' },
    { exerciseId: 'romanian-deadlift', sets: 3, reps: '8', restSec: 90, loadHint: '' },
  ] }],
};

const eligibleStore = ()=> ({
  version: 9,
  preferences: { telemetryEnabled: true },
  history: [{ id: 's1', dateISO: '2026-03-01', blocks: [] }, { id: 's2', dateISO: '2026-03-02', blocks: [] }, { id: 's3', dateISO: '2026-03-03', blocks: [] }],
  activeSchedule: schedule,
});

describe('study lifecycle: eligibility', ()=>{
  it('checks consent, workout history and something to assign', ()=>{
    assert.equal(studyEligibility(eligibleStore()).eligible, true);
    const noConsent = eligibleStore();
    noConsent.preferences = { telemetryEnabled: false };
    const r1 = studyEligibility(noConsent);
    assert.equal(r1.eligible, false);
    assert.ok(r1.problems[0].match(/measurements/i));
    const few = eligibleStore();
    few.history = few.history.slice(0, 2);
    const r2 = studyEligibility(few);
    assert.equal(r2.eligible, false);
    assert.match(r2.problems[0], /at least 3 workouts/);
    assert.match(r2.problems[0], /2\/3 so far/);
  });
});

describe('study lifecycle: join and withdraw', ()=>{
  it('joining freezes a balanced enrollment and stamps the status', ()=>{
    const joined = joinStudy(eligibleStore(), { nowISO: '2026-03-05T00:00:00Z' });
    assert.equal(participationStatus(joined), 'enrolled');
    assert.ok(isValid(joined.studyParticipantId));
    assert.equal(Object.keys(joined.studyEnrollment.assignments).length, 3);
    assert.equal(joined.studyStatus, 'enrolled');
  });

  it('withdrawal stops treatment but preserves every observed record', ()=>{
    const joined = joinStudy(eligibleStore(), { nowISO: '2026-03-05T00:00:00Z' });
    const store = {
      ...joined,
      history: [{ id: 'done-1', dateISO: '2026-03-06', blocks: [] }],
      evaluationLedger: [{ id: 'l1', recommendation: { load: 40, reps: 8 }, outcome: { assignedMet: true } }],
      eventHistory: [{ id: 'e1', type: 'session:complete' }],
      readinessLog: [{ dateISO: '2026-03-06', score: 70 }],
    };
    const withdrawn = withdrawFromStudy(store, { nowISO: '2026-03-10T00:00:00Z' });
    assert.equal(participationStatus(withdrawn), 'withdrawn');
    assert.equal(withdrawn.studyEnrollment, null, 'no enrollment → no new arm assignments');
    assert.equal(withdrawn.studyStatus, 'withdrawn');
    // Treatment stops: no exercise resolves to an arm any more.
    assert.equal(studyArmFor(withdrawn.studyEnrollment, 'bench-press-dumbbell'), null);
    // History preserved — withdrawal is not deletion.
    assert.equal(withdrawn.history.length, 1);
    assert.equal(withdrawn.evaluationLedger.length, 1);
    assert.equal(withdrawn.eventHistory.length, 1);
    assert.equal(withdrawn.readinessLog.length, 1);
    assert.equal(withdrawn.studyParticipantId, store.studyParticipantId, 'pseudonymous id persists for cohort folding');
    // The input store was never mutated.
    assert.ok(store.studyEnrollment);
  });

  it('withdrawal without enrollment is still recorded as a status change', ()=>{
    const s = eligibleStore();
    s.studyStatus = 'enrolled';
    const withdrawn = withdrawFromStudy(s, { nowISO: '2026-03-10T00:00:00Z' });
    assert.equal(withdrawn.studyStatus, 'withdrawn');
    assert.ok(withdrawn.studyStatusChangedAtISO);
  });

  it('rejoining regenerates the same deterministic assignment — no re-randomisation', ()=>{
    const joined = joinStudy(eligibleStore(), { nowISO: '2026-03-05T00:00:00Z' });
    const armsBefore = Object.fromEntries(Object.entries(joined.studyEnrollment.assignments).map(([k, v]) => [k, v.arm]));
    const withdrawn = withdrawFromStudy(joined);
    const rejoined = rejoinStudy(withdrawn, { nowISO: '2026-04-01T00:00:00Z' });
    assert.equal(participationStatus(rejoined), 'enrolled');
    const armsAfter = Object.fromEntries(Object.entries(rejoined.studyEnrollment.assignments).map(([k, v]) => [k, v.arm]));
    assert.deepEqual(armsAfter, armsBefore, 'same participant + same seed ⇒ same arms');
    assert.equal(rejoined.studyStatus, 'enrolled');
  });

  it('deleting observations is a separate action and is destructive only when called', ()=>{
    const s = eligibleStore();
    s.history = [{ id: 'h1', dateISO: '2026-03-01', blocks: [] }];
    s.evaluationLedger = [{ id: 'l1' }];
    const deleted = deleteStudyObservations(s);
    assert.equal(deleted.history.length, 0);
    assert.equal(deleted.evaluationLedger.length, 0);
    assert.equal(s.history.length, 1, 'original untouched');
    assert.notEqual(deleted, s, 'returns a new store');
  });

  it('plain-language copy exists for every state', ()=>{
    for(const store of [eligibleStore(), joinStudy(eligibleStore()), { ...withdrawFromStudy(joinStudy(eligibleStore())), studyEnrollment: null }]){
      assert.ok(participationCopy(store).length > 20);
    }
  });
});

describe('study lifecycle: export/import round trip', ()=>{
  it('studyStatus travels inside the export envelope', ()=>{
    globalThis.localStorage = { getItem: ()=> null, setItem: ()=> {}, removeItem: ()=> {} };
    try{
      const store = withdrawFromStudy(joinStudy(eligibleStore(), { nowISO: '2026-03-05T00:00:00Z' }), { nowISO: '2026-03-10T00:00:00Z' });
      const parsed = parseImportFile(JSON.stringify(buildExportPayload(store)));
      assert.equal(parsed.studyStatus, 'withdrawn');
      assert.equal(parsed.studyStatusChangedAtISO, store.studyStatusChangedAtISO);
      assert.equal(parsed.studyParticipantId, store.studyParticipantId);
    }finally{
      delete globalThis.localStorage;
    }
  });
});

function isValid(id){ return typeof id === 'string' && /^[0-9a-f]{16}$/.test(id); }
