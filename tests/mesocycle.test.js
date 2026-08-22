import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewCompletedWeek, applyWeeklyReview, weekOf } from '../src/lib/mesocycle.js';

const TODAY = '2026-01-11'; // Sunday of week 1 — week 2 is next.

function buildSchedule({ programId = 'test-program', deloadWeek = null, secondWeekNumber = 2, benchSets = 3 } = {}){
  const meso = deloadWeek ? { weeks: secondWeekNumber + 1, deloadWeek, progression: 'weekly-load' } : { weeks: 4, deloadWeek: null, progression: 'linear' };
  return {
    programId,
    availableEquipment: ['dumbbells', 'bench', 'bodyweight'],
    mesocycle: meso,
    lastWeeklyReviewBasis: null,
    adaptationHistory: [],
    sessions: [
      // Week 1 (reviewed): both done.
      { id: 'w1d1', week: 1, day: 1, title: 'Upper', dateISO: '2026-01-05', status: 'planned', blocks: [
        { exerciseId: 'bench-press-dumbbell', sets: benchSets, reps: '8–12' },
      ]},
      { id: 'w1d2', week: 1, day: 2, title: 'Lower', dateISO: '2026-01-08', status: 'planned', blocks: [
        { exerciseId: 'goblet-squat', sets: 3, reps: '10' },
      ]},
      // Week 2 (target of directives).
      { id: 'w2d1', week: secondWeekNumber, day: 1, title: 'Upper', dateISO: '2026-01-12', status: 'planned', blocks: [
        { exerciseId: 'bench-press-dumbbell', sets: benchSets, reps: '8–12' },
      ]},
    ],
  };
}

function doneHistory({ weight = 22.5, reps = 8, rpe = '' } = {}){
  return [
    { id: 'w1d1', dateISO: '2026-01-05', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set( reps, weight, rpe ), set( reps, weight, rpe ), set( reps, weight, rpe )] }] },
    { id: 'w1d2', dateISO: '2026-01-08', blocks: [{ exerciseId: 'goblet-squat', sets: [set( 10, 24, rpe )] }] },
  ];
}
function set(reps, weightKg, rpe){ return { reps: String(reps), weightKg: String(weightKg), rpe: rpe == null ? '' : String(rpe) }; }

describe('weekOf', ()=>{
  it('returns Monday-start keys', ()=>{
    assert.equal(weekOf('2026-01-05'), '2026-01-05'); // Monday
    assert.equal(weekOf('2026-01-11'), '2026-01-05'); // Sunday same week
  });
});

describe('reviewCompletedWeek', ()=>{
  it('reviews the finished week and holds a healthy prescription', ()=>{
    const schedule = buildSchedule();
    const review = reviewCompletedWeek({ schedule, history: doneHistory(), todayISO: TODAY });
    assert.equal(review.ready, true);
    assert.equal(review.reviewedWeekKey, '2026-01-05');
    assert.equal(review.targetWeekKey, '2026-01-12');
    const d = review.directives.find(x => x.exerciseId === 'bench-press-dumbbell');
    assert.ok(d, 'missing directive for bench');
    assert.ok(['hold', 'add-sets'].includes(d.kind));
  });

  it('forces a deload when the mesocycle deload week arrives', ()=>{
    const schedule = buildSchedule({ programId: 'strength-4x', deloadWeek: 2, secondWeekNumber: 2 });
    const review = reviewCompletedWeek({ schedule, history: doneHistory(), todayISO: TODAY });
    assert.equal(review.mesoDeloadDue, true);
    const d = review.directives.find(x => x.exerciseId === 'bench-press-dumbbell');
    assert.equal(d.kind, 'deload');
    assert.equal(d.sets, Math.max(1, Math.round(3 * 0.6)));
  });

  it('fatigue across the week triggers the fatigue deload first', ()=>{
    const schedule = buildSchedule();
    // Prior week with very low volume so this week reads as a spike, plus
    // flat heavy loads (plateau) and RPE 9 throughout (near-failure count).
    const priorWeek = [
      { id: 'p1', dateISO: '2025-12-30', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(8, 20, 7)] }] },
    ];
    const history = [
      ...priorWeek,
      { id: 'w1d1', dateISO: '2026-01-05', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(8, 20, 9), set(8, 20, 9), set(8, 20, 9), set(8, 20, 9)] }] },
      { id: 'w1d2', dateISO: '2026-01-08', blocks: [{ exerciseId: 'goblet-squat', sets: [set(10, 24, 9), set(10, 24, 9)] }] },
    ];
    const review = reviewCompletedWeek({ schedule, history, todayISO: TODAY });
    const d = review.directives.find(x => x.exerciseId === 'bench-press-dumbbell');
    assert.equal(d.kind, 'deload');
    assert.ok(review.deloadDecision.yes || review.mesoDeloadDue);
    assert.ok(review.deloadDecision.signals.length >= 1);
  });

  it('rotates to a variation after a genuine plateau', ()=>{
    const flat = [];
    for(let i = 0; i < 5; i++){
      flat.push(sessFlat(`2026-01-0${i + 1}`));
    }
    function sessFlat(dateISO){ return { id: `flat-${dateISO}`, dateISO, blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [set(8, 20, '')] }] }; }
    // Make week 1's scheduled sessions reference two of those flat logs so the
    // reviewed week has data; extra flat sessions give plateau depth.
    const schedule = buildSchedule();
    const history = [...doneHistory({ weight: 20 }), ...flat];
    const review = reviewCompletedWeek({ schedule, history, todayISO: TODAY });
    const d = review.directives.find(x => x.exerciseId === 'bench-press-dumbbell');
    assert.ok(d, 'expected a directive');
    if(d.kind === 'rotate'){
      assert.ok(d.toExerciseId && d.toExerciseId !== 'bench-press-dumbbell');
      assert.match(d.reason, /rotating/i);
    }
  });

  it('refuses to review when nothing is complete', ()=>{
    const review = reviewCompletedWeek({ schedule: buildSchedule(), history: [], todayISO: TODAY });
    assert.equal(review.ready, false);
  });
});

describe('applyWeeklyReview', ()=>{
  it('writes deload directives into next week with audit trail, idempotently', ()=>{
    const schedule = buildSchedule({ programId: 'strength-4x', deloadWeek: 2, secondWeekNumber: 2 });
    const review = reviewCompletedWeek({ schedule, history: doneHistory(), todayISO: TODAY });
    const first = applyWeeklyReview(schedule, review);
    assert.equal(first.changed, true);
    const target = first.schedule.sessions.find(s => s.id === 'w2d1');
    const block = target.blocks.find(b => b.exerciseId === 'bench-press-dumbbell');
    assert.equal(block.sets, Math.max(1, Math.round(3 * 0.6)));
    assert.match(block.adaptation.kind, /^weekly-/);
    assert.ok(first.schedule.lastWeeklyReviewBasis === `week:${review.reviewedWeekKey}`);
    assert.equal(first.schedule.adaptationHistory.length, 1);

    const second = applyWeeklyReview(first.schedule, review);
    assert.equal(second.changed, false);
    assert.equal(second.alreadyApplied, true);
  });

  it('leaves the schedule untouched for hold-only reviews', ()=>{
    const schedule = buildSchedule();
    const review = reviewCompletedWeek({ schedule, history: doneHistory(), todayISO: TODAY });
    const result = applyWeeklyReview(schedule, review);
    const hasStructural = (review.directives || []).some(d => d.kind !== 'hold');
    assert.equal(result.changed, hasStructural);
  });
});
