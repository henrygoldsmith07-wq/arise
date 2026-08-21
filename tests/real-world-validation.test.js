import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  datasetFromPortableExport, realWorldValidationReport, classifyOutcome,
  outcomeDistribution, validateNoisySessionDetection, validateLoadRounding,
  substitutionPairQuality, substitutionSwapEvents, longitudinalEffectiveness,
} from '../src/lib/realWorldValidation.js';
import { backtestHistory, validateBenchmarkDataset } from '../src/lib/backtesting.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const synthetic = JSON.parse(fs.readFileSync(path.join(here, '..', 'benchmark', 'fixtures', 'synthetic-history.json'), 'utf8'));
const realExample = JSON.parse(fs.readFileSync(path.join(here, '..', 'benchmark', 'fixtures', 'real-history.example.json'), 'utf8'));

const portablePayload = {
  app: 'arise',
  version: 3,
  exportedAt: '2026-08-01T10:00:00.000Z',
  data: {
    history: [
      { id: 'h1', dateISO: '2026-07-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20' }] }] },
    ],
    readinessLog: [{ dateISO: '2026-07-01', score: 70 }],
    onboarding: { equipment: ['dumbbells', 'bench'], goal: 'strength', level: 'Intermediate', daysPerWeek: 3 },
    activeSchedule: { id: 'sched-1', sessions: [{ id: 's1', dateISO: '2026-07-03', blocks: [{ exerciseId: 'push-up' }] }] },
  },
};

describe('collecting real workout histories', ()=>{
  it('converts a portable export into a valid benchmark dataset', ()=>{
    const dataset = datasetFromPortableExport(portablePayload);
    assert.equal(dataset.formatVersion, 1);
    assert.equal(dataset.kind, 'real-history');
    assert.equal(validateBenchmarkDataset(dataset).valid, true);
    assert.deepEqual(dataset.profile.availableEquipment, ['dumbbells', 'bench']);
    assert.equal(dataset.profile.goal, 'strength');
    assert.equal(dataset.schedule.id, 'sched-1');
    assert.equal(dataset.readinessLog.length, 1);
    assert.equal(dataset.metadata.consent, false);
  });

  it('records consent explicitly instead of assuming it', ()=>{
    const consented = datasetFromPortableExport(portablePayload, { consent: true });
    assert.equal(consented.metadata.consent, true);
    const unconsented = datasetFromPortableExport(portablePayload);
    assert.match(unconsented.metadata.note, /No consent recorded/);
  });

  it('never turns the empty example into evidence', ()=>{
    const report = realWorldValidationReport(realExample);
    assert.equal(report.status, 'insufficient');
    assert.equal(report.comparisons, 0);
    assert.equal(report.outcomes.evaluable, 0);
    assert.match(report.note, /collect more history/i);
    assert.equal(report.provenance.coverage.minimumComparisons > 0, true);
  });
});

describe('success, failure, stagnation, regression', ()=>{
  const row = (actualE1rm, previousE1rm, completed)=> ({
    actual: { e1rm: actualE1rm },
    previousBest: { e1rm: previousE1rm },
    completed,
  });

  it('labels each comparison row with exactly one outcome class', ()=>{
    assert.equal(classifyOutcome(row(44, 40, true)), 'success');
    assert.equal(classifyOutcome(row(42, 40, false)), 'failure');
    assert.equal(classifyOutcome(row(40.1, 40, true)), 'stagnation');
    assert.equal(classifyOutcome(row(38, 40, false)), 'regression');
    assert.equal(classifyOutcome(row(44, 0, true)), 'unknown');
  });

  it('aggregates the four classes over a replayed history', ()=>{
    const result = backtestHistory(synthetic);
    const distribution = outcomeDistribution(result.observations);
    assert.equal(distribution.n, result.comparisons);
    const counted = Object.values(distribution.counts).reduce((a, b)=> a + b, 0);
    assert.equal(counted, distribution.n);
    assert.ok(distribution.evaluable >= 1);
    for(const cls of ['success', 'failure', 'stagnation', 'regression']){
      assert.equal(distribution.rates[cls] == null || (distribution.rates[cls] >= 0 && distribution.rates[cls] <= 1), true);
    }
  });

  it('carries the previous exposure on every observation row', ()=>{
    const result = backtestHistory(synthetic);
    for(const observation of result.observations){
      assert.ok(observation.previousBest.e1rm > 0);
    }
  });
});

describe('noisy-session detection validation', ()=>{
  it('computes precision/recall/specificity from known forecast outcomes', ()=>{
    const observations = [
      { probability: 0.8, actualBad: true, brier: 0.04 },
      { probability: 0.9, actualBad: true, brier: 0.01 },
      { probability: 0.2, actualBad: false, brier: 0.04 },
      { probability: 0.6, actualBad: false, brier: 0.36 },
      { probability: 0.3, actualBad: true, brier: 0.49 },
    ];
    const quality = validateNoisySessionDetection({ fatigueObservations: observations });
    assert.equal(quality.truePositives, 2);
    assert.equal(quality.falsePositives, 1);
    assert.equal(quality.trueNegatives, 1);
    assert.equal(quality.falseNegatives, 1);
    assert.equal(quality.precision, 0.667);
    assert.equal(quality.recall, 0.667);
    assert.equal(quality.specificity, 0.5);
    assert.equal(quality.accuracy, 0.6);
    assert.deepEqual(quality.confusion.predictedBad, { bad: 2, good: 1 });
  });

  it('reports why nothing was evaluable rather than zeros that look like skill', ()=>{
    const quality = validateNoisySessionDetection({ fatigueObservations: [] });
    assert.equal(quality.n, 0);
    assert.match(quality.note, /prior history/);
  });
});

function datedSessions(entries){
  return entries.map(([dateISO, id, blocks])=> ({ id, dateISO, blocks }));
}

const sharedKitHistory = datedSessions([
  ['2026-05-04', 'a1', [
    { exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20' }] },
    { exerciseId: 'push-up', sets: [{ reps: '10', weightKg: '' }] },
  ]],
  ['2026-05-11', 'a2', [
    { exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '21' }] },
    { exerciseId: 'push-up', sets: [{ reps: '12', weightKg: '' }] },
  ]],
  ['2026-05-18', 'a3', [
    { exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '22' }] },
    { exerciseId: 'push-up', sets: [{ reps: '13', weightKg: '' }] },
  ]],
  ['2026-05-25', 'a4', [
    { exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '23' }] },
    { exerciseId: 'push-up', sets: [{ reps: '14', weightKg: '' }] },
  ]],
]);

describe('substitution quality validation', ()=>{
  const kit = { formatVersion: 1, kind: 'real-history', profile: { availableEquipment: ['dumbbells', 'bench'] }, history: sharedKitHistory };

  it('audits engine-proposed substitutes against co-logged performance', ()=>{
    const pairs = substitutionPairQuality(kit);
    assert.equal(pairs.available, true);
    const pair = pairs.pairs.find(p=> p.targetId === 'bench-press-dumbbell' && p.substituteId === 'push-up');
    assert.ok(pair, 'expected the declared bench ↔ push-up pair to be audited');
    assert.equal(pair.declared, true);
    assert.equal(pair.sameMuscle, true);
    assert.equal(pair.alignment, 'aligned');
    assert.equal(pair.targetGainPct > 0 && pair.substituteGainPct > 0, true);
    assert.equal(pairs.musclePreservationRate, 1);
  });

  it('flags substitutes whose progression diverges from the target', ()=>{
    const divergent = datedSessions([
      ['2026-06-01', 'd1', [
        { exerciseId: 'dumbbell-row', sets: [{ reps: '8', weightKg: '18' }] },
        { exerciseId: 'band-row', sets: [{ reps: '12', weightKg: '' }] },
      ]],
      ['2026-06-08', 'd2', [
        { exerciseId: 'dumbbell-row', sets: [{ reps: '8', weightKg: '17' }] },
        { exerciseId: 'band-row', sets: [{ reps: '14', weightKg: '' }] },
      ]],
      ['2026-06-15', 'd3', [
        { exerciseId: 'dumbbell-row', sets: [{ reps: '8', weightKg: '16' }] },
        { exerciseId: 'band-row', sets: [{ reps: '16', weightKg: '' }] },
      ]],
      ['2026-06-22', 'd4', [
        { exerciseId: 'dumbbell-row', sets: [{ reps: '8', weightKg: '15' }] },
        { exerciseId: 'band-row', sets: [{ reps: '18', weightKg: '' }] },
      ]],
    ]);
    const dataset = { formatVersion: 1, kind: 'real-history', profile: { availableEquipment: ['dumbbells', 'bench', 'bands'] }, history: divergent };
    const pairs = substitutionPairQuality(dataset);
    const pair = pairs.pairs.find(p=> p.targetId === 'dumbbell-row' && p.substituteId === 'band-row');
    assert.ok(pair, 'expected the dumbbell-row ↔ band-row pair to be audited');
    assert.equal(pair.alignment, 'divergent');
    assert.equal(pairs.progressionAlignmentRate, 0);
  });

  it('detects swap events against the planned schedule', ()=>{
    const dataset = {
      formatVersion: 1,
      kind: 'real-history',
      profile: { availableEquipment: ['dumbbells', 'bench'] },
      history: [{ id: 's1', dateISO: '2026-07-03', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '12', weightKg: '' }] }] }],
      schedule: { sessions: [{ id: 's1', dateISO: '2026-07-03', blocks: [{ exerciseId: 'bench-press-dumbbell' }, { exerciseId: 'dumbbell-row' }] }] },
    };
    const swaps = substitutionSwapEvents(dataset);
    assert.equal(swaps.available, true);
    assert.equal(swaps.n, 1);
    assert.equal(swaps.events[0].performedExerciseId, 'push-up');
    assert.equal(swaps.events[0].preservedMuscle, true);
    assert.deepEqual(swaps.events[0].declaredForSwapped, ['bench-press-dumbbell']);
  });

  it('says what is missing instead of inventing swap events', ()=>{
    const swaps = substitutionSwapEvents({ formatVersion: 1, kind: 'real-history', history: sharedKitHistory });
    assert.equal(swaps.available, false);
    assert.match(swaps.note, /schedule/);
  });
});

describe('load rounding validation', ()=>{
  const dataset = { formatVersion: 1, kind: 'real-history', profile: {}, history: [] };

  it('checks recommendations against the priors rounding grid and plate stacks', ()=>{
    const backtestResult = {
      observations: [
        { exerciseId: 'barbell-squat', recommendation: { load: 47.5 }, actual: { load: 47.5 } },
        { exerciseId: 'barbell-squat', recommendation: { load: 47.3 }, actual: { load: 47.5 } },
        { exerciseId: 'bench-press-dumbbell', recommendation: { load: 22 }, actual: { load: 0 } },
      ],
    };
    const rounding = validateLoadRounding(dataset, backtestResult);
    assert.equal(rounding.n, 3);
    assert.equal(rounding.barbellProfile, true);
    assert.ok(rounding.onRoundingGridRate < 1, '47.3 must fail the grid check');
    assert.equal(rounding.maxPlateDeltaKg, 0.5);
    assert.equal(rounding.usableAgainstActualRate, 1);
    assert.equal(rounding.loggedLoadsPlateAchievableRate, 1);
  });

  it('skips plate checks honestly when the profile has no barbell', ()=>{
    const noBarbell = { formatVersion: 1, kind: 'real-history', profile: { availableEquipment: ['dumbbells'] }, history: [] };
    const rounding = validateLoadRounding(noBarbell, { observations: [{ exerciseId: 'bench-press-dumbbell', recommendation: { load: 22.5 }, actual: { load: 22.5 } }] });
    assert.equal(rounding.onRoundingGridRate, 1);
    assert.equal(rounding.plateAchievableRate, null);
    assert.match(rounding.note, /skipped/);
  });
});

describe('longitudinal programme effectiveness', ()=>{
  it('tracks weekly progress and cycle-over-cycle movement', ()=>{
    const long = longitudinalEffectiveness({ formatVersion: 1, kind: 'real-history', profile: {}, history: sharedKitHistory });
    assert.equal(long.sessions, 4);
    assert.ok(long.spanDays >= 21);
    assert.ok(long.sessionsPerWeek > 0 && long.sessionsPerWeek < 2);
    const bench = long.exercises.find(row=> row.exerciseId === 'bench-press-dumbbell');
    assert.equal(bench.trend, 'progressing');
    assert.equal(long.verdict, 'progressing');
    assert.equal(Array.isArray(long.cycles), true);
    assert.ok(long.exercises.every(row=> row.trend !== 'insufficient'));
  });

  it('refuses an effectiveness verdict without enough classified exercises', ()=>{
    const single = datedSessions([
      ['2026-05-04', 'x1', [{ exerciseId: 'plank', sets: [{ reps: '30', weightKg: '' }] }]],
    ]);
    const long = longitudinalEffectiveness({ formatVersion: 1, kind: 'real-history', profile: {}, history: single });
    assert.equal(long.verdict, 'insufficient-history');
  });
});

describe('full real-world validation report', ()=>{
  it('runs every requested evaluation family over the synthetic fixture', ()=>{
    const report = realWorldValidationReport(synthetic);
    assert.equal(['calibrated', 'warming'].includes(report.status), true);
    assert.ok(report.outcomes);
    assert.ok(report.noisySessionDetection);
    assert.ok(report.substitutions.pairs);
    assert.ok(report.substitutions.swaps);
    assert.ok(report.loadRounding);
    assert.ok(report.longitudinal);
    assert.equal(report.provenance.metadata.synthetic, true);
    assert.equal(report.provenance.metadata.realTrainingValidation, false);
  });

  it('propagates invalid datasets with their issues', ()=>{
    const report = realWorldValidationReport({ formatVersion: 99 });
    assert.equal(report.status, 'invalid');
    assert.ok(report.validation.issues.length >= 2);
    const guarded = realWorldValidationReport({ formatVersion: 1, history: 'nope' });
    assert.equal(guarded.status, 'invalid');
    assert.match(guarded.validation.issues[0], /history must be an array/);
  });
});
