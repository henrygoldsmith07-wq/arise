import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { studyArmFor, assignmentFor, enrollParticipant } from '../src/lib/studyEnrollment.js';
import { recordRecommendation, attachOutcome, loadEvaluationLedger } from '../src/lib/longitudinal.js';
import { evaluateLongitudinal } from '../src/lib/evaluation.js';
import { pooledAssignedComparison } from '../src/lib/fieldStudy.js';
import { parseImportFile, buildExportPayload } from '../src/lib/export.js';
import { KEY as STORE_KEY } from '../src/lib/store.js';
import { EVALUATION_KEY } from '../src/lib/longitudinalCore.js';

class Mem { constructor(){ this.map = new Map(); } getItem(k){ return this.map.has(k) ? this.map.get(k) : null; } setItem(k, v){ this.map.set(k, String(v)); } removeItem(k){ this.map.delete(k); } }
function memoryStorage(){ return new Mem(); }

const enrollment = enrollParticipant({ participantId: 'f'.repeat(16), exerciseIds: ['pull-up', 'goblet-squat'] });
const mappedArms = Object.fromEntries(Object.entries(enrollment.assignments).map(([k, v])=> [k, v.arm]));
const dpExercise = Object.entries(mappedArms).find(([, arm])=> arm === 'double-progression')?.[0];
const ariseExercise = Object.entries(mappedArms).find(([, arm])=> arm === 'arise')?.[0];

describe('studyArmFor — only randomised exercises carry an arm', ()=>{
  it('enrolled exercises resolve to their frozen arm', ()=>{
    assert.equal(studyArmFor(enrollment, ariseExercise), 'arise');
    assert.equal(studyArmFor(enrollment, dpExercise), 'double-progression');
  });
  it('unseen swaps, adaptations and new exercises are excluded, never defaulted to Arise', ()=>{
    assert.equal(studyArmFor(enrollment, 'barbell-squat'), null, 'a swapped-in lift must NOT become arise');
    assert.equal(studyArmFor(enrollment, 'banded-face-pull'), null, 'a programme adaptation must NOT become arise');
  });
  it('no enrollment (or an empty one) means no study, not a free Arise label', ()=>{
    assert.equal(studyArmFor(null, ariseExercise), null);
    assert.equal(studyArmFor({ assignments: {} }, ariseExercise), null);
  });
  it('deterministic across reloads (same enrollment object → same answer)', ()=>{
    const reread = JSON.parse(JSON.stringify(enrollment)); // draft/session reload
    assert.equal(studyArmFor(reread, dpExercise), assignmentFor(reread, dpExercise));
    assert.equal(studyArmFor(reread, 'barbell-squat'), null);
  });
});

describe('ledger + export never carry a fake arm', ()=>{
  beforeEach(()=> { globalThis.localStorage = new Mem(); globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({ version: 9, preferences: { telemetryEnabled: true } })); });
  const hist = (id, w, d)=> [{ id, dateISO: d, blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: String(w), rpe: '' }] }] }];

  it('unassigned exercise records assignedArm null and is excluded from both analyses', ()=>{
    const storage = memoryStorage();
    recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 25, reps: 8, reason: 'test' },
      history: hist('h1', 22.5, '2026-03-01'), dueDateISO: '2026-03-08',
      preferences: { telemetryEnabled: true }, nowISO: '2026-03-01T10:00:00.000Z',
      assignedArm: studyArmFor(enrollment, 'bench-press-dumbbell'), // unmapped → null
      participantId: 'f'.repeat(16), storage,
    });
    let ledger = loadEvaluationLedger(storage);
    assert.equal(ledger[0].assignedArm, null);
    const ev = evaluateLongitudinal(ledger);
    assert.equal(ev.primaryComparison.transitions, 0, 'null arm never counts as assigned evidence');
    const poolOpts = { minParticipants: 1, minTransitions: 1 };
    const openPool = pooledAssignedComparison([{ code: 'p1', studyParticipantId: 'f'.repeat(16), store: { preferences: { telemetryEnabled: true }, history: [], evaluationLedger: ledger } }], poolOpts);
    assert.equal(openPool.open, 1, 'live open recommendation counts as prospective, never excluded');
    assert.equal(openPool.excluded.unassigned, 0);

    attachOutcome({ sessionId: 's9', dateISO: '2026-03-08', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '25' }] }], preferences: { telemetryEnabled: true }, nowISO: '2026-03-08T10:00:00.000Z', storage });
    ledger = loadEvaluationLedger(storage);
    assert.equal(ledger[0].assignedArm, null);
    const resolvedPool = pooledAssignedComparison([{ code: 'p1', studyParticipantId: 'f'.repeat(16), store: { preferences: { telemetryEnabled: true }, history: [], evaluationLedger: ledger } }], poolOpts);
    assert.equal(resolvedPool.excluded.unassigned, 1, 'once resolved, the never-randomised row is excluded');
    assert.equal(resolvedPool.transitions, 0);
    // Export → import keeps the honest null (and demotes provenance — the
    // row must still not become study evidence anywhere).
    globalThis.localStorage.setItem(EVALUATION_KEY, JSON.stringify(ledger));
    const text = JSON.stringify(buildExportPayload({ version: 9, history: [], preferences: { telemetryEnabled: true } }));
    const imported = parseImportFile(text);
    assert.equal(imported.evaluationLedger[0].assignedArm, null);
  });

  it('a genuinely randomised DP exercise keeps its arm end to end', ()=>{
    const storage = memoryStorage();
    recordRecommendation({
      exerciseId: 'pull-up', recommendation: { reps: 6, reason: 'test' },
      history: [], dueDateISO: '2026-03-08', preferences: { telemetryEnabled: true },
      nowISO: '2026-03-01T10:00:00.000Z', assignedArm: studyArmFor(enrollment, 'pull-up'),
      participantId: 'f'.repeat(16), storage,
    });
    if(studyArmFor(enrollment, 'pull-up') !== null){
      assert.equal(loadEvaluationLedger(storage)[0].assignedArm, mappedArms['pull-up']);
    }else{
      assert.equal(loadEvaluationLedger(storage)[0].assignedArm, null);
    }
  });
});
