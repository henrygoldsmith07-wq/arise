// Local 4-week progression preview: replays the real engine forward from the
// user's history. Contract under test: engine-faithful (same recommendNext
// behaviour), plate-legal loads, no invention for exercises without history,
// pure (input history is never mutated), deterministic.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { plannedExercises, previewProgramProgression, simulateExerciseWeeks } from '../src/lib/progressionPreview.js';

const PROGRAM = {
  id:'p1',
  name:'Test Split',
  weeks:[{
    week:1,
    workouts:[{
      day:1, title:'Upper',
      blocks:[
        { exerciseId:'bench-press-dumbbell', sets:3, reps:'8–12', restSec:90 },
        { exerciseId:'push-up', sets:3, reps:'8–12', restSec:60 },
        { exerciseId:'cable-row', sets:3, reps:'8–12', restSec:90 },
      ],
    }],
  }],
};

const BARBELL_ONLY_HISTORY = [
  { id:'s1', dateISO:'2026-09-07', blocks:[{ exerciseId:'barbell-squat', sets:[{ reps:'8', weightKg:'80', completed:true }] }] },
  { id:'s2', dateISO:'2026-09-14', blocks:[{ exerciseId:'barbell-squat', sets:[{ reps:'8', weightKg:'80', completed:true }] }] },
];

const DUMBBELL_BENCH_HISTORY = [
  { id:'s1', dateISO:'2026-09-07', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'8', weightKg:'40', completed:true }] }] },
  { id:'s2', dateISO:'2026-09-14', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'8', weightKg:'40', completed:true }] }] },
];

describe('progression preview — planned exercises', () => {
  it('collects unique first-week exercises in first-appearance order', () => {
    const { exercises, omitted } = plannedExercises(PROGRAM, { limit:2 });
    assert.deepEqual(exercises.map(e=> e.exerciseId), ['bench-press-dumbbell', 'push-up']);
    assert.equal(omitted, 1);
  });
});

describe('progression preview — simulation', () => {
  it('adds reps first, exactly like double progression', () => {
    const entries = simulateExerciseWeeks({
      exerciseId:'bench-press-dumbbell',
      targetReps:'8–12',
      history:DUMBBELL_BENCH_HISTORY,
      todayISO:'2026-10-05',
      weeks:3,
    });
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map(e=> e.reps), [9, 10, 11]);
    assert.deepEqual(entries.map(e=> e.loadKg), [40, 40, 40]);
  });

  it('starts an untracked exercise at the plan’s low target, honestly labelled', () => {
    const entries = simulateExerciseWeeks({
      exerciseId:'bench-press-dumbbell',
      targetReps:'8–12',
      history:BARBELL_ONLY_HISTORY,
      todayISO:'2026-10-05',
      weeks:2,
    });
    assert.equal(entries[0].hasHistory, false);
    assert.equal(entries[0].reps, 8);
    assert.equal(entries[1].reps, 9);
  });

  it('rounds the load bump to owned increments when the range tops out', () => {
    const history = [
      { id:'s1', dateISO:'2026-09-07', blocks:[{ exerciseId:'barbell-squat', sets:[{ reps:'12', weightKg:'80', completed:true }] }] },
    ];
    const entries = simulateExerciseWeeks({
      exerciseId:'barbell-squat',
      targetReps:'8–12',
      history,
      plateConfig:{ barWeightKg:20, platesKg:[1.25, 2.5, 5, 10, 15, 20, 25] },
      todayISO:'2026-10-05',
      weeks:1,
    });
    // snapLoad 80 × 1.05 = 84 → per side 32 → 30 exact → 80? No: (84-20)/2 = 32
    // → nearest stack 30 (25+5) = 80. Rounding keeps the load plate-legal.
    assert.equal(entries[0].loadKg % 2.5, 0);
    assert.ok(entries[0].loadKg >= 80);
  });

  it('keeps bodyweight work bodyweight and progresses reps', () => {
    const history = [
      { id:'s1', dateISO:'2026-09-07', blocks:[{ exerciseId:'push-up', sets:[{ reps:'10', weightKg:'0', completed:true }] }] },
    ];
    const entries = simulateExerciseWeeks({
      exerciseId:'push-up',
      targetReps:'8–12',
      history,
      todayISO:'2026-10-05',
      weeks:2,
    });
    assert.equal(entries[0].loadKg, null);
    assert.equal(entries[0].reps, 11);
    assert.equal(entries[1].reps, 12);
  });

  it('never invents numbers for an exercise without history', () => {
    const entries = simulateExerciseWeeks({
      exerciseId:'cable-row',
      targetReps:'8–12',
      history:[],
      todayISO:'2026-10-05',
      weeks:2,
    });
    assert.equal(entries[0].hasHistory, false);
    assert.match(entries[0].reason, /No history/);
  });

  it('is pure — the caller’s history is never mutated', () => {
    const history = BARBELL_ONLY_HISTORY.map(s=> JSON.parse(JSON.stringify(s)));
    const snapshot = JSON.stringify(history);
    simulateExerciseWeeks({ exerciseId:'bench-press-dumbbell', history, todayISO:'2026-10-05', weeks:4 });
    assert.equal(JSON.stringify(history), snapshot);
  });

  it('is deterministic — same inputs, same preview', () => {
    const a = previewProgramProgression({ program:PROGRAM, history:BARBELL_ONLY_HISTORY, todayISO:'2026-10-05' });
    const b = previewProgramProgression({ program:PROGRAM, history:BARBELL_ONLY_HISTORY, todayISO:'2026-10-05' });
    assert.deepEqual(a, b);
  });
});

describe('progression preview — programme shape', () => {
  it('groups one entry per planned exercise per week', () => {
    const preview = previewProgramProgression({ program:PROGRAM, history:BARBELL_ONLY_HISTORY, todayISO:'2026-10-05' });
    assert.equal(preview.weeks.length, 4);
    for(const week of preview.weeks){
      assert.equal(week.entries.length, 3);
      assert.equal(new Set(week.entries.map(e=> e.exerciseId)).size, 3);
    }
    assert.equal(preview.exerciseCount, 3);
    // Equipment dispatch mirrors the prescription path so rounding is explainable.
    assert.equal(preview.equipmentDispatch['bench-press-dumbbell'], 'dumbbell');
    // Bodyweight rows dispatch to the generic fallback (never barbell).
    assert.equal(preview.equipmentDispatch['push-up'], 'dumbbell');
  });

  it('returns null for a program without weeks', () => {
    assert.equal(previewProgramProgression({ program:{ id:'empty' }, history:[], todayISO:'2026-10-05' }), null);
  });
});
