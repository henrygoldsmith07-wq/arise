import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EXERCISES, EXERCISE_BY_ID } from '../src/lib/data.js';
import {
  IMAGE_BASE,
  getExerciseImage,
  getExerciseMeta,
  getImageFrames,
  hasExerciseImage,
} from '../src/lib/exerciseImages.js';

describe('compact exercise illustration registry', ()=>{
  it('keeps the complete mapped coverage with a fixed three-frame contract', ()=>{
    const mapped = EXERCISES.filter(exercise=> hasExerciseImage(exercise.id));
    assert.equal(mapped.length, 295);
    for(const exercise of mapped){
      assert.deepEqual(getImageFrames(exercise.id), [1, 2, 3]);
      const image = getExerciseImage(exercise.id, 99);
      assert.ok(image.url.startsWith(`${IMAGE_BASE}/`));
      assert.ok(image.url.endsWith('/frame-3.svg'));
      assert.equal(image.name, exercise.name);
      assert.equal(image.primaryMuscle, exercise.muscle);
      assert.equal(image.equipment, exercise.equipment.join(', '));
      assert.equal(image.license, 'CC BY-SA 4.0');
      assert.equal(image.creator, 'Bryl Lim');
    }
  });

  it('preserves curated aliases while using canonical Arise metadata', ()=>{
    const image = getExerciseImage('cable-row', 1);
    assert.match(image.url, /\/seated-row\/frame-1\.svg$/);
    assert.equal(image.name, EXERCISE_BY_ID['cable-row'].name);
    assert.equal(image.primaryMuscle, EXERCISE_BY_ID['cable-row'].muscle);
  });

  it('retains upstream-only metadata needed by the exercise browser', ()=>{
    const meta = getExerciseMeta('push-up');
    assert.equal(meta.frames, 3);
    assert.equal(meta.exerciseType, 'bodyweight_reps');
    assert.ok(meta.secondaryMuscles.length > 0);
    assert.equal(typeof meta.isStretch, 'boolean');
  });

  it('returns null/empty metadata for unmapped Arise exercises', ()=>{
    const unmapped = EXERCISES.find(exercise=> !hasExerciseImage(exercise.id));
    assert.ok(unmapped);
    assert.equal(getExerciseImage(unmapped.id), null);
    assert.equal(getExerciseMeta(unmapped.id), null);
    assert.deepEqual(getImageFrames(unmapped.id), []);
  });
});
