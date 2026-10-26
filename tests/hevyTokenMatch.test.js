import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHevyExercise, exerciseTokenKey, parseHevyCsv } from '../src/lib/hevyCsvImport.js';
import { EXERCISE_BY_ID } from '../src/lib/data.js';

describe('Hevy order-free name matching', () => {
  it('keys ignore order, punctuation, plurals and equipment parentheses', () => {
    assert.equal(exerciseTokenKey('Bench Press (Dumbbell)'), exerciseTokenKey('Dumbbell Bench Press'));
    assert.equal(exerciseTokenKey('Pull-up'), exerciseTokenKey('Pull Up'));
  });
  it('maps un-curated Hevy names to a unique library exercise', () => {
    assert.equal(resolveHevyExercise('Hammer Curl', EXERCISE_BY_ID), 'hammer-curl');
    assert.equal(resolveHevyExercise('Leg Extension', EXERCISE_BY_ID), 'leg-extension');
    assert.equal(resolveHevyExercise('Decline Dumbbell Press', EXERCISE_BY_ID), 'decline-dumbbell-press');
    assert.equal(resolveHevyExercise('Dumbbell Fly', EXERCISE_BY_ID), 'dumbbell-fly');
    assert.equal(resolveHevyExercise('Pendlay Row (Barbell)', EXERCISE_BY_ID), 'pendlay-row');
  });
  it('never guesses: unknown or different-equipment lifts stay unmapped', () => {
    assert.equal(resolveHevyExercise('Zercher Mystery Lift', EXERCISE_BY_ID), null);
    assert.equal(resolveHevyExercise('Hammer Curl (Cable)', EXERCISE_BY_ID), null);
    assert.equal(resolveHevyExercise('Pendlay Row', null), null);
  });
  it('curated map still wins and import reports fewer unmapped', () => {
    assert.equal(resolveHevyExercise('Chest Press (Machine)', EXERCISE_BY_ID), 'chest-press-machine');
    const head = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
    const csv = [head, '"A","23 Oct 2026, 18:30","","","Pendlay Row (Barbell)",,"",0,normal,40,8,,,'].join('\n');
    const r = parseHevyCsv(csv, { byId: EXERCISE_BY_ID });
    assert.equal(r.rows.length, 1);
    assert.deepEqual(r.unmappedExercises, []);
  });
});
