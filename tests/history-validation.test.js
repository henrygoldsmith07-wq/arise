import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestLoadToPlates,
  nearestDumbbellLoad,
  nearestMachineLoad,
  nearestAchievableLoad,
  minimumAchievableJump,
  isLoadAchievable,
  DEFAULT_DUMBBELL_WEIGHTS_KG,
} from '../src/lib/plates.js';
import { recommendNext } from '../src/lib/progression.js';
import { rankedSubstitutions, substitutionOptions, validateSubstitutionChain, scoreSubstitution } from '../src/lib/substitutions.js';
import { noisySessionContext, shouldDeferProgressionForNoisy } from '../src/lib/sessionQuality.js';
import { normaliseHistoryEntry } from '../src/lib/store.js';
import { longitudinalOutcomes, weeklyVolume } from '../src/lib/analytics.js';
import { backtestHistory } from '../src/lib/backtesting.js';

describe('real-history data model', ()=>{
  it('normalises a legacy history entry into the full real-history shape', ()=>{
    const entry = normaliseHistoryEntry({
      id: 's1',
      dateISO: '2026-01-05',
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20' }] }],
      savedAt: '2026-01-05T18:00:00Z',
    });
    assert.equal(entry.durationMinutes, null);
    assert.equal(entry.startedAt, null);
    assert.equal(entry.finishedAt, entry.savedAt);
    assert.equal(entry.programVersion, null);
    assert.deepEqual(entry.substitutions, []);
    assert.deepEqual(entry.exerciseOrder, ['bench-press-dumbbell']);
    assert.equal(entry.blocks[0].exerciseOrder, 0);
    assert.equal(entry.blocks[0].sets[0].failed, false);
    assert.equal(entry.blocks[0].sets[0].skipped, false);
    assert.equal(entry.blocks[0].sets[0].pain, false);
    assert.equal(entry.painDiscomfort, false);
    assert.equal(entry.skippedSetsCount, 0);
  });

  it('captures pain flags, skipped sets and substitutions when present', ()=>{
    const entry = normaliseHistoryEntry({
      id: 's2',
      dateISO: '2026-01-07',
      noteTags: ['pain-discomfort'],
      blocks: [{
        exerciseId: 'push-up',
        substitutionFrom: 'bench-press-dumbbell',
        substitutionReason: 'kit unavailable',
        sets: [{ reps: '10', weightKg: '', completed: true }, { reps: '6', weightKg: '', failed: true }],
      }],
    });
    assert.equal(entry.painDiscomfort, true);
    assert.equal(entry.skippedSetsCount, 1);
    assert.equal(entry.substitutions.length, 1);
    assert.equal(entry.substitutions[0].to, 'push-up');
  });
});

describe('noisy session handling', ()=>{
  const base = { id: 'x', dateISO: '2026-01-08', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '22.5', rpe: '7', completed: true }] }] };

  it('flags a short session and pain but not a normal one', ()=>{
    const short = noisySessionContext({ ...base, durationMinutes: 8 });
    assert.ok(short.flags.includes('shortSession'));
    const painful = noisySessionContext({ ...base, painDiscomfort: true });
    assert.ok(painful.flags.includes('painDiscomfort'));
    const clean = noisySessionContext(base);
    assert.equal(clean.isNoisy, false);
  });

  it('flags a long training gap against prior history', ()=>{
    const before = [{ ...base, dateISO: '2025-12-01' }];
    const ctx = noisySessionContext(base, before);
    assert.ok(ctx.flags.includes('longGap'));
  });

  it('flags unusual performance drop vs prior best', ()=>{
    const before = [
      { id: 'p1', dateISO: '2026-01-02', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '40', rpe: '7' }] }] },
    ];
    const weak = { id: 'w1', dateISO: '2026-01-05', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '6', weightKg: '25', rpe: '9' }] }] };
    const ctx = noisySessionContext(weak, before);
    assert.ok(ctx.flags.includes('unusualPerformance'));
  });

  it('holds progression after a noisy session instead of overreacting to one bad day', ()=>{
    // A clean rising history would normally progress; a flagged last session should hold.
    const cleanHistory = [
      { id: 'a', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '20', rpe: '6' }] }] },
      { id: 'b', dateISO: '2026-01-03', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '22.5', rpe: '7' }] }] },
    ];
    const noisyLast = { id: 'c', dateISO: '2026-01-05', painDiscomfort: true, blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '22.5', rpe: '9' }] }] };
    const rec = recommendNext({ exerciseId: 'bench-press-dumbbell', history: [...cleanHistory, noisyLast], targetReps: '8–12' });
    assert.match(rec.reason, /[Hh]old|[Nn]oisy|noisy context/i);
  });

  it('does not hold a clean session after a clean streak', ()=>{
    const history = [
      { id: 'a', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '11', weightKg: '20', rpe: '7' }] }] },
      { id: 'b', dateISO: '2026-01-03', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '11', weightKg: '20', rpe: '7' }] }] },
    ];
    const rec = recommendNext({ exerciseId: 'bench-press-dumbbell', history, targetReps: '8–12' });
    assert.doesNotMatch(rec.reason || '', /[Nn]oisy context/);
  });

  it('requires multiple observations via shouldDeferProgressionForNoisy', ()=>{
    const sessions = [
      { id: 'n1', dateISO: '2026-01-01', durationMinutes: 10, blocks: [] },
      { id: 'n2', dateISO: '2026-01-03', durationMinutes: 12, blocks: [] },
    ];
    const verdict = shouldDeferProgressionForNoisy(sessions, 'bench-press-dumbbell');
    assert.equal(verdict.defer, true);
  });
});

describe('loadability across equipment types', ()=>{
  it('snaps to nearest dumbbell pair including asymmetric increments', ()=>{
    const result = nearestDumbbellLoad(21, {});
    assert.equal(result.loadKg, 20); // tie between 20 and 22.5 → lower wins
    assert.equal(result.direction, 'under');
    const up = nearestDumbbellLoad(23, {});
    assert.equal(up.loadKg, 22.5);
    assert.equal(up.direction, 'under');
  });

  it('machine rounding clamps to the rack maximum', ()=>{
    const r = nearestMachineLoad(37, { machineIncrementKg: 2.5, machineMinKg: 5 });
    assert.equal(r.loadKg, 37.5);
    const over = nearestMachineLoad(500, { machineMaxKg: 120 });
    assert.equal(over.loadKg, 120);
    assert.equal(over.direction, 'under');
  });

  it('dispatches by equipment type', ()=>{
    assert.equal(nearestAchievableLoad(30, { equipment: 'dumbbells', config: {} }).loadKg, 30);
    assert.equal(nearestAchievableLoad(60, { equipment: 'barbell', config: { barWeightKg: 20, platesKg: [20] } }).loadKg, 60);
  });

  it('minimum jump reports achievable next load per equipment', ()=>{
    const db = minimumAchievableJump(20, { equipment: 'dumbbells', config: {} });
    assert.equal(db.nextLoadKg, 22.5);
    assert.equal(db.minimumJumpKg, 2);
    const bb = minimumAchievableJump(60, { equipment: 'barbell', config: { platesKg: [1.25, 2.5, 5] } });
    assert.equal(bb.minimumJumpKg, 2.5);
    const mc = minimumAchievableJump(50, { equipment: 'machine', config: {} });
    assert.equal(mc.jumpKg, 2.5);
  });

  it('isLoadAchievable is exact only on buildable loads', ()=>{
    assert.equal(isLoadAchievable(62.5, 'barbell', { platesKg: [1.25, 2.5, 5] }), true);
    assert.equal(isLoadAchievable(63, 'barbell', { platesKg: [1.25, 2.5, 5] }), false);
  });

  it('recommendNext rounds non-barbell exercises to real available loads when config supplied', ()=>{
    const history = [{
      id: 'd1', dateISO: '2026-01-01',
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: 20, rpe: 7 }] }],
    }];
    const rec = recommendNext({
      exerciseId: 'bench-press-dumbbell',
      history,
      targetReps: '8–12',
      plateConfig: { barWeightKg: 20, platesKg: [1.25], dumbbellsKg: DEFAULT_DUMBBELL_WEIGHTS_KG },
    });
    // raw nudge lands between pairs; must snap to an available dumbbell
    assert.ok(DEFAULT_DUMBBELL_WEIGHTS_KG.includes(rec.load));
    assert.equal(rec.plateEquipment, 'dumbbell');
  });
});

describe('substitution quality', ()=>{
  it('excludes disliked exercises and prefers preferred ones', ()=>{
    const opts = substitutionOptions('bench-press-barbell', {
      availableEquipment: ['bodyweight'],
      dislikedExerciseIds: ['push-up'],
      preferredExerciseIds: [],
      limit: 4,
    });
    assert.ok(opts.every(o=> o.id !== 'push-up'));
  });

  it('prefers a liked movement when both are viable', ()=>{
    // pike-push-up (bodyweight-only) is viable here and liked; it must outrank the
    // declared default push-up despite not being first in the declared list.
    const liked = rankedSubstitutions('bench-press-barbell', ['bodyweight'], 4, { preferredExerciseIds: ['pike-push-up'], dislikedExerciseIds: [], history: [] });
    assert.equal(liked[0]?.id, 'pike-push-up');
  });

  it('short-session bias ranks compounds higher', ()=>{
    const target = { id: 'x', muscle: 'Chest', equipment: ['bodyweight'], level: 'Beginner', unilateral: false };
    const compound = { id: 'y', muscle: 'Chest', equipment: ['bodyweight'], level: 'Beginner', unilateral: false };
    const isolation = { id: 'z', muscle: 'Arms', equipment: ['bands'], level: 'Beginner', unilateral: false };
    const shortScore = scoreSubstitution(target, compound, { shortSession: true });
    const isoScore = scoreSubstitution(target, isolation, { shortSession: true });
    assert.ok(shortScore >= isoScore);
  });

  it('validateSubstitutionChain catches impossible replacements', ()=>{
    const sessions = [{ id: 's1', blocks: [{ exerciseId: 'barbell-squat' }] }];
    const bodyOnly = validateSubstitutionChain(sessions, ['bodyweight']);
    assert.equal(bodyOnly.valid, true, 'squat should resolve to bodyweight alternative');
    // unknown exercise cannot resolve
    const broken = [{ id: 's1', blocks: [{ exerciseId: 'not-a-real-exercise' }] }];
    const invalid = validateSubstitutionChain(broken, ['bodyweight']);
    assert.equal(invalid.valid, false);
  });
});

describe('longitudinal outcome evaluation', ()=>{
  it('returns descriptive series without claiming superiority', ()=>{
    const history = [];
    let w = 20;
    for(let i = 0; i < 6; i++){
      history.push({
        id: `l${i}`,
        dateISO: `2026-01-0${i+1}`,
        programId: 'starter-3x',
        blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: String(w), rpe: '7' }] }],
      });
      w += 2.5;
    }
    const out = longitudinalOutcomes(history, null);
    assert.ok(out.strengthProgression.some(r=> r.exerciseId === 'bench-press-dumbbell'));
    assert.match(out.note, /do not claim superior/i);
    assert.ok(out.workoutCompletion.completed === 6);
    assert.ok(out.progressionFailures.n > 0);
  });
});

describe('backtesting progression validation breakdown', ()=>{
  const fixture = {
    formatVersion: 1,
    kind: 'synthetic',
    profile: { availableEquipment: ['dumbbells', 'bench'] },
    readinessLog: [],
    history: [
      { id: 'h1', dateISO: '2026-03-02', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '7' }] }] },
      { id: 'h2', dateISO: '2026-03-05', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: '20', rpe: '7' }] }] },
      { id: 'h3', dateISO: '2026-03-09', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '22.5', rpe: '7' }] }] },
      { id: 'h4', dateISO: '2026-03-12', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '25', rpe: '7' }] }] },
    ],
  };

  it('reports success/failure/regression/stagnation rates and noise handling', ()=>{
    const result = backtestHistory(fixture);
    const pv = result.metrics.progressionValidation;
    assert.ok(pv);
    assert.equal(typeof pv.successfulProgressions, 'number');
    assert.equal(typeof pv.failedProgressions, 'number');
    assert.equal(typeof pv.regressionFollowingProgression, 'number');
    assert.ok(pv.unnecessaryConservatismRate === null || typeof pv.unnecessaryConservatismRate === 'number');
    assert.ok(result.metrics.noiseHandling);
    assert.ok(result.metrics.deloadFatigueValidation.validationNote.includes('single bad workout never triggers deload alone'));
  });

  it('breaks strata down by rep range and movement type', ()=>{
    const result = backtestHistory(fixture);
    assert.ok(result.strata.repRange);
    assert.ok(result.strata.movementType);
    const row = result.observations[0];
    assert.ok(row.stratum.repRange);
    assert.ok(row.stratum.movementType);
    assert.ok(Array.isArray(row.noisyFlags));
  });

  it('never leaks future rows into recommendations (regression)', ()=>{
    const first = backtestHistory(fixture).observations[0];
    const extended = backtestHistory({
      ...fixture,
      history: [...fixture.history, { id: 'h9', dateISO: '2026-04-20', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '15', weightKg: '90', rpe: '5' }] }] }],
    }).observations[0];
    assert.deepEqual(first.recommendation, extended.recommendation);
    assert.equal(extended.reconstruction.leakageSafe, true);
  });
});
