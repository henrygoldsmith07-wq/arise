import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIMENT_PRESETS,
  cancelExperiment,
  concludeExperiment,
  createExperiment,
  evaluateExperiment,
  experimentDaysRemaining,
  experimentObservations,
  mergeExperiments,
  newExperimentId,
} from '../src/lib/trainingExperiments.js';

const mkSet = (reps, weightKg, rpe = null) => ({ reps: String(reps), weightKg: String(weightKg), ...(rpe != null ? { rpe: String(rpe) } : {}) });
const mkSess = (dateISO, exerciseId, sets) => ({ id: `s-${dateISO}-${exerciseId}`, dateISO, blocks: [{ exerciseId, sets }] });

/** Valid calendar date n days after 2026-01-01 (real month rollovers). */
function isoAfter(days){
  const d = new Date(Date.parse('2026-01-01T00:00:00') + days * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Baseline: flat ~60 e1RM weeks. Intervention: clearly better (~70 e1RM).
function growthHistory(){
  const sessions = [];
  // 3 baseline weeks, 1 session/week
  for(let w = 0; w < 3; w++){
    sessions.push(mkSess(isoAfter(4 + w * 7), 'bench-press-dumbbell', [mkSet(8, 50), mkSet(8, 50)]));
  }
  // 4 intervention weeks, stronger — starting after the baseline window ends.
  for(let w = 0; w < 4; w++){
    sessions.push(mkSess(isoAfter(25 + w * 7), 'bench-press-dumbbell', [mkSet(8, 60), mkSet(8, 60)]));
  }
  return sessions;
}

function flatHistory(){
  const sessions = [];
  for(let w = 0; w < 7; w++){
    sessions.push(mkSess(isoAfter(4 + w * 7), 'bench-press-dumbbell', [mkSet(8, 50), mkSet(8, 50)]));
  }
  return sessions;
}

describe('experiment creation', () => {
  it('creates an active experiment with defaults from priors', () => {
    const exp = createExperiment({ name: 'Chest volume test', metric: 'strength', muscle: 'Chest' }, []);
    assert.equal(exp.status, 'active');
    assert.equal(exp.metric, 'strength');
    assert.equal(exp.mode, 'muscle');
    assert.equal(exp.muscle, 'Chest');
    assert.ok(exp.baselineDays >= 3 && exp.baselineDays <= 56);
    assert.ok(exp.interventionDays >= 7 && exp.interventionDays <= 84);
    assert.equal(exp.result, null);
  });

  it('generates unique, deterministic ids', () => {
    const first = createExperiment({ name: 'A', metric: 'strength', exerciseId: 'bench-press-dumbbell' }, [], { createdAtISO: '2026-01-01' });
    const second = createExperiment({ name: 'B', metric: 'strength', exerciseId: 'bench-press-dumbbell' }, [first], { createdAtISO: '2026-01-01' });
    assert.notEqual(first.id, second.id);
    assert.equal(newExperimentId([first, second], '2026-01-01'), 'exp:2026-01-01:3');
    assert.match(first.id, /^exp:2026-01-01:\d+$/);
  });

  it('presets carry a question and metric', () => {
    for(const preset of EXPERIMENT_PRESETS){
      assert.ok(preset.id && preset.label && preset.question);
    }
  });
});

describe('experiment observations', () => {
  it('splits weeks into baseline/intervention phases by date', () => {
    const exp = createExperiment({
      name: 'Bench strength', metric: 'strength', exerciseId: 'bench-press-dumbbell',
      baselineDays: 21, interventionDays: 28,
    }, [], { createdAtISO: '2026-01-05' });
    const obs = experimentObservations(exp, growthHistory());
    assert.ok(obs.length >= 5);
    const baselineWeeks = obs.filter(o => o.phase === 'baseline');
    const interventionWeeks = obs.filter(o => o.phase === 'intervention');
    assert.ok(baselineWeeks.length >= 2, `expected >=2 baseline weeks, got ${baselineWeeks.length}`);
    assert.ok(interventionWeeks.length >= 2, `expected >=2 intervention weeks, got ${interventionWeeks.length}`);
  });

  it('muscle scope aggregates across exercises of that muscle', () => {
    const exp = createExperiment({ name: 'Chest', metric: 'strength', muscle: 'Chest', baselineDays: 21, interventionDays: 28 }, [], { createdAtISO: '2026-01-05' });
    const obs = experimentObservations(exp, [
      mkSess('2026-01-06', 'bench-press-dumbbell', [mkSet(8, 50)]),
      mkSess('2026-01-08', 'push-up', [mkSet(20, 0)]), // bodyweight sets are ignored for strength
    ]);
    assert.equal(obs.length, 1);
    assert.ok(obs[0].value > 0);
  });
});

describe('experiment evaluation + conclusion', () => {
  it('calls a clear improvement improved with honest evidence', () => {
    const exp = createExperiment({
      name: 'Bench strength', metric: 'strength', exerciseId: 'bench-press-dumbbell',
      baselineDays: 21, interventionDays: 28, minimumSessions: 3,
    }, [], { createdAtISO: '2026-01-05' });
    const evaluation = evaluateExperiment(exp, growthHistory(), { today: '2026-03-01' });
    assert.ok(evaluation.diff > 0);
    const concluded = concludeExperiment(exp, growthHistory(), { today: '2026-03-01' });
    assert.equal(concluded.status, 'completed');
    assert.ok(['improved', 'inconclusive'].includes(concluded.result));
    assert.ok(concluded.conclusionNote.length > 20);
    assert.ok(concluded.evaluation);
  });

  it('flat data never claims improvement', () => {
    const exp = createExperiment({
      name: 'Bench strength', metric: 'strength', exerciseId: 'bench-press-dumbbell',
      baselineDays: 21, interventionDays: 28, minimumSessions: 3,
    }, [], { createdAtISO: '2026-01-05' });
    const concluded = concludeExperiment(exp, flatHistory(), { today: '2026-03-01' });
    assert.notEqual(concluded.result, 'improved');
    assert.ok(['no-difference', 'inconclusive'].includes(concluded.result));
  });

  it('sparse intervention data stays inconclusive', () => {
    const exp = createExperiment({
      name: 'Bench strength', metric: 'strength', exerciseId: 'bench-press-dumbbell',
      baselineDays: 21, interventionDays: 28, minimumSessions: 10,
    }, [], { createdAtISO: '2026-02-20' });
    const concluded = concludeExperiment(exp, [mkSess('2026-02-24', 'bench-press-dumbbell', [mkSet(8, 55)])], { today: '2026-02-26' });
    assert.equal(concluded.result, 'inconclusive');
    assert.ok(/Not enough data/i.test(concluded.conclusionNote));
  });

  it('cancel keeps observations but stops the experiment', () => {
    const exp = createExperiment({ name: 'X', metric: 'strength', exerciseId: 'bench-press-dumbbell' }, []);
    const cancelled = cancelExperiment(exp, { today: '2026-10-01' });
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.cancelledAtISO);
  });

  it('days remaining counts down and floors at zero', () => {
    const exp = createExperiment({ name: 'X', metric: 'strength', exerciseId: 'bench-press-dumbbell' }, [], { createdAtISO: '2026-01-01' });
    const left = experimentDaysRemaining(exp, '2026-01-10');
    assert.ok(left > 0);
    assert.equal(experimentDaysRemaining(exp, '2027-01-01'), 0);
  });
});

describe('experiment merge (backup/sync)', () => {
  it('unions by id with terminal status winning', () => {
    const draft = createExperiment({ name: 'A', metric: 'strength', exerciseId: 'bench-press-dumbbell' }, []);
    const concluded = { ...concludeExperiment(draft, flatHistory(), { today: '2026-03-01' }) };
    const merged = mergeExperiments([draft], [concluded]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].status, 'completed');
  });
});
