import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordRecommendation,
  attachOutcome,
  evaluateLongitudinal,
  loadEvaluationLedger,
  saveEvaluationLedger,
  clearEvaluationLedger,
  equipmentClassFor,
  EVALUATION_KEY,
} from '../src/lib/longitudinal.js';
import { recommendNext } from '../src/lib/progression.js';

function memoryStorage(){
  const map = new Map();
  return {
    getItem: key=> map.has(key) ? map.get(key) : null,
    setItem: (key, value)=> map.set(key, String(value)),
    removeItem: key=> map.delete(key),
    _map: map,
  };
}

const CONSENT = { telemetryEnabled: true };
const NO_CONSENT = { telemetryEnabled: false };

// Rising history for bench-press-dumbbell (free-weights, horizontal-push).
function benchHistory(n = 4, startWeight = 20){
  const sessions = [];
  let weight = startWeight;
  for(let i = 0; i < n; i++){
    sessions.push({
      id: `h${i}`,
      dateISO: `2026-01-0${i + 1}`,
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: String(weight), rpe: '7' }] }],
    });
    weight += 2.5;
  }
  return sessions;
}

function chestMachineHistory(n = 4){
  const sessions = [];
  for(let i = 0; i < n; i++){
    sessions.push({
      id: `cm${i}`,
      dateISO: `2026-01-0${i + 1}`,
      blocks: [{ exerciseId: 'chest-press-machine', sets: [{ reps: '10', weightKg: String(30 + i * 2.5), rpe: '7' }] }],
    });
  }
  return sessions;
}

describe('longitudinal validation — consent and separation', ()=>{
  it('records nothing without explicit consent', ()=>{
    const storage = memoryStorage();
    const record = recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 25, reps: 8, reason: 'test' },
      history: benchHistory(),
      dueDateISO: '2026-01-05',
      preferences: NO_CONSENT,
      storage,
    });
    assert.equal(record, null);
    assert.equal(loadEvaluationLedger(storage).length, 0);
    const resolved = attachOutcome({ sessionId: 's1', dateISO: '2026-01-05', blocks: [], preferences: NO_CONSENT, storage });
    assert.deepEqual(resolved, []);
  });

  it('keeps the evaluation ledger in its own key, separate from training data', ()=>{
    const storage = memoryStorage();
    recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 27.5, reps: 8, reason: 'Hit top of range' },
      history: benchHistory(),
      dueDateISO: '2026-01-05',
      preferences: CONSENT,
      storage,
    });
    assert.ok(storage._map.has(EVALUATION_KEY));
    // The training store key must never be touched by the evaluation layer.
    assert.ok(!storage._map.has('arise.store.v1'));
  });

  it('ledger contents never influence recommendations (training/eval separation)', ()=>{
    const storage = memoryStorage();
    const history = benchHistory();
    const before = recommendNext({ exerciseId: 'bench-press-dumbbell', history, targetReps: '8–12' });
    // Fabricate a pile of "perfect" outcomes in the ledger.
    const fabricated = Array.from({ length: 20 }, (_, i)=> ({
      id: `fake-${i}`, exerciseId: 'bench-press-dumbbell', movementPattern: 'horizontal-push', equipmentClass: 'free-weights',
      recommendation: { load: 999, reps: 30 },
      recommendedAction: 'add_load',
      basis: { visibleSessions: 4, previousBest: null, trainingAgePhase: 'novice', priorsVersion: 1 },
      outcome: { metTarget: true, classification: 'progression-success', changePct: 0.2, loadErrorKg: 0, repError: 0 },
    }));
    saveEvaluationLedger(fabricated, storage);
    const after = recommendNext({ exerciseId: 'bench-press-dumbbell', history, targetReps: '8–12' });
    assert.deepEqual(before.load, after.load);
    assert.deepEqual(before.reps, after.reps);
    clearEvaluationLedger(storage);
  });
});

describe('longitudinal validation — prospective recording and outcomes', ()=>{
  it('snapshots the recommendation with prior-only basis; later sessions cannot alter it', ()=>{
    const storage = memoryStorage();
    const history = benchHistory(4);
    const record = recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 30, reps: 8, reason: 'Hit top of 8–12' },
      history,
      dueDateISO: '2026-01-05',
      preferences: CONSENT,
      storage,
    });
    assert.equal(record.basis.visibleSessions, 4);
    assert.equal(record.basis.previousBest.weightKg, 27.5);
    assert.equal(record.recommendedAction, 'add_load');
    // Simulate future sessions appearing afterwards; the stored record is immutable.
    const futureHistory = [...history, { id: 'future', dateISO: '2026-02-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '20', weightKg: '90' }] }] }];
    const stored = loadEvaluationLedger(storage)[0];
    assert.equal(stored.basis.visibleSessions, 4);
    assert.equal(stored.recommendation.load, 30);
    assert.notEqual(stored.basis.visibleSessions, futureHistory.length);
  });

  it('attaches the real outcome and classifies progression success', ()=>{
    const storage = memoryStorage();
    const history = benchHistory(4); // last best 27.5 × 12
    recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 30, reps: 8, reason: 'Hit top of range — nudge load' },
      history,
      dueDateISO: '2026-01-06',
      preferences: CONSENT,
      storage,
    });
    const resolved = attachOutcome({
      sessionId: 'next-1',
      dateISO: '2026-01-06',
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '30', rpe: '8' }] }],
      preferences: CONSENT,
      storage,
    });
    assert.equal(resolved.length, 1);
    const outcome = resolved[0].outcome;
    assert.equal(outcome.metTarget, true);
    assert.equal(outcome.classification, 'progression-success');
    assert.equal(outcome.e1rm, 38); // 30 × (1 + 8/30)
    assert.equal(outcome.previousE1rm, 38.5); // 27.5 × (1 + 12/30)
  });

  it('does not resolve a record from a session earlier than its due date', ()=>{
    const storage = memoryStorage();
    recordRecommendation({
      exerciseId: 'push-up',
      recommendation: { reps: 11, reason: 'Bodyweight: add a rep' },
      history: [],
      dueDateISO: '2026-01-10',
      preferences: CONSENT,
      storage,
    });
    attachOutcome({
      sessionId: 'early', dateISO: '2026-01-08',
      blocks: [{ exerciseId: 'push-up', sets: [{ reps: '15' }] }],
      preferences: CONSENT, storage,
    });
    const ledger = loadEvaluationLedger(storage);
    assert.equal(ledger[0].outcome, null);
  });

  it('classifies regression when a progression is followed by a drop', ()=>{
    const storage = memoryStorage();
    const history = benchHistory(4); // best e1rm 38.5
    recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 30, reps: 8, reason: 'progression' },
      history,
      dueDateISO: '2026-01-06',
      preferences: CONSENT,
      storage,
    });
    const [resolved] = attachOutcome({
      sessionId: 'drop', dateISO: '2026-01-06',
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '5', weightKg: '22.5', rpe: '10' }] }],
      preferences: CONSENT, storage,
    });
    assert.equal(resolved.outcome.metTarget, false);
    // A followed progression that precedes a performance drop is a regression.
    assert.equal(resolved.outcome.classification, 'regression');
    assert.ok(resolved.outcome.changePct < -0.05);
  });

  it('caps open records per exercise so skipped sessions do not pile up', ()=>{
    const storage = memoryStorage();
    for(let i = 0; i < 6; i++){
      recordRecommendation({
        exerciseId: 'plank',
        recommendation: { reps: 40, reason: 'endurance add' },
        history: [],
        dueDateISO: `2026-01-${String(i + 1).padStart(2, '0')}`,
        preferences: CONSENT,
        storage,
      });
    }
    const ledger = loadEvaluationLedger(storage).filter(row=> row.exerciseId === 'plank');
    assert.ok(ledger.length <= 3, `expected open records capped at 3, got ${ledger.length}`);
  });
});

describe('longitudinal validation — segmentation and sample gates', ()=>{
  function buildLedgerWithPairs(storage, { phase, pattern, equipmentClass, exerciseId, n, met }){
    const records = loadEvaluationLedger(storage);
    for(let i = 0; i < n; i++){
      records.push({
        id: `${exerciseId}-${i}`, schemaVersion: 1,
        recordedAtISO: '2026-01-01T00:00:00Z', dueDateISO: '2026-01-02',
        exerciseId, movementPattern: pattern, equipmentClass,
        recommendation: { load: 30, reps: 8, assistKg: null, reason: 'test', strategy: 'hypertrophy' },
        recommendedAction: met ? 'add_load' : 'hold',
        basis: { visibleSessions: 5, previousBest: { reps: 8, weightKg: 27.5, assistedKg: 0, e1rm: 33 }, trainingAgePhase: phase, priorsVersion: 1 },
        outcome: {
          sessionId: `s-${i}`, dateISO: '2026-01-02', load: met ? 30 : 25, reps: met ? 8 : 5,
          assistedKg: 0, rpe: 8, sets: 3, e1rm: met ? 38 : 29.17, previousE1rm: 33,
          changePct: met ? 0.15 : -0.12, metTarget: !!met, repsMet: !!met, loadMet: !!met, assistMet: true,
          loadErrorKg: 0, repError: met ? 0 : 3,
          classification: met ? 'progression-success' : 'regression',
        },
      });
    }
    saveEvaluationLedger(records, storage);
    return records;
  }

  it('withholds segment conclusions below the minimum sample size', ()=>{
    const storage = memoryStorage();
    buildLedgerWithPairs(storage, { phase: 'novice', pattern: 'horizontal-push', equipmentClass: 'free-weights', exerciseId: 'bench-press-dumbbell', n: 3, met: true });
    const result = evaluateLongitudinal(loadEvaluationLedger(storage));
    assert.equal(result.overall.resolved, 3);
    assert.equal(result.overall.conclusive, false);
    assert.equal(result.overall.progressionSuccessRate, null);
    assert.equal(result.byTrainingAge.novice.conclusive, false);
  });

  it('reports conclusive rates at or above the minimum sample size', ()=>{
    const storage = memoryStorage();
    buildLedgerWithPairs(storage, { phase: 'novice', pattern: 'horizontal-push', equipmentClass: 'free-weights', exerciseId: 'bench-press-dumbbell', n: 5, met: true });
    buildLedgerWithPairs(storage, { phase: 'advanced', pattern: 'squat', equipmentClass: 'machines', exerciseId: 'chest-press-machine', n: 6, met: false });
    const result = evaluateLongitudinal(loadEvaluationLedger(storage), {});
    assert.equal(result.overall.conclusive, true);
    assert.equal(result.overall.progressionSuccessRate, Math.round(5 / 11 * 1000) / 1000);
    assert.equal(result.byTrainingAge.novice.conclusive, true);
    assert.equal(result.byTrainingAge.novice.progressionSuccessRate, 1);
    assert.equal(result.byTrainingAge.advanced.conclusive, true);
    assert.equal(result.byTrainingAge.advanced.regressionRate, 1);
    assert.equal(result.byEquipmentClass['free-weights'].adherenceRate, 1);
    assert.equal(result.byEquipmentClass.machines.adherenceRate, 0);
    assert.equal(result.byMovementPattern['horizontal-push'].n, 5);
    assert.equal(result.byExercise['chest-press-machine'].resolved, 6);
  });

  it('segments by all four equipment classes including bodyweight and cables', ()=>{
    assert.equal(equipmentClassFor('barbell-squat'), 'free-weights');
    assert.equal(equipmentClassFor('dumbbell-row'), 'free-weights');
    assert.equal(equipmentClassFor('kettlebell-swing'), 'free-weights');
    assert.equal(equipmentClassFor('chest-press-machine'), 'machines');
    assert.equal(equipmentClassFor('lat-pulldown'), 'cables');
    assert.equal(equipmentClassFor('cable-row'), 'cables');
    assert.equal(equipmentClassFor('push-up'), 'bodyweight');
    assert.equal(equipmentClassFor('plank'), 'bodyweight');
  });

  it('separates movement categories', ()=>{
    const storage = memoryStorage();
    buildLedgerWithPairs(storage, { phase: 'novice', pattern: 'horizontal-push', equipmentClass: 'free-weights', exerciseId: 'bench-press-dumbbell', n: 5, met: true });
    buildLedgerWithPairs(storage, { phase: 'novice', pattern: 'squat', equipmentClass: 'free-weights', exerciseId: 'barbell-squat', n: 5, met: false });
    const result = evaluateLongitudinal(loadEvaluationLedger(storage));
    assert.equal(result.byMovementPattern['horizontal-push'].progressionSuccessRate, 1);
    assert.equal(result.byMovementPattern.squat.progressionSuccessRate, 0);
    assert.equal(result.byMovementPattern['horizontal-push'].n, 5);
    assert.equal(result.byMovementPattern.squat.n, 5);
  });

  it('derives training-age phases from visible history at record time', ()=>{
    const storage = memoryStorage();
    // 10 days of history → novice
    const noviceRecord = recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 25, reps: 8, reason: 'x' },
      history: benchHistory(2),
      dueDateISO: '2026-01-03',
      preferences: CONSENT,
      storage,
    });
    assert.equal(noviceRecord.basis.trainingAgePhase, 'novice');
    // 8 months of history → intermediate
    const longHistory = [];
    for(let week = 0; week < 32; week++){
      longHistory.push({ id: `w${week}`, dateISO: `2026-0${Math.min(8, 1 + Math.floor(week / 4))}-${String((week % 4) * 7 + 1).padStart(2, '0')}`, blocks: [] });
    }
    const intermediateRecord = recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 25, reps: 8, reason: 'x' },
      history: longHistory,
      dueDateISO: '2026-08-15',
      preferences: CONSENT,
      storage,
    });
    assert.equal(intermediateRecord.basis.trainingAgePhase, 'intermediate');
  });
});
