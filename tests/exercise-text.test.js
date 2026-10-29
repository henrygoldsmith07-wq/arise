import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXERCISES, EXERCISE_BY_ID } from '../src/lib/data.js';
import { setExerciseText, exerciseText, exerciseTextLoaded, validateExerciseText } from '../src/lib/exerciseText.js';
import { teachingFor } from '../src/lib/exerciseTeaching.js';

const TEXT = JSON.parse(readFileSync(new URL('../src/lib/data/exercise-text.json', import.meta.url), 'utf8'));

describe('exercise text ships as an on-demand asset, not catalogue JS', ()=>{
  it('the catalogue rows no longer carry instructions/mistakes', ()=>{
    assert.ok(EXERCISES.every(e => e.instructions === undefined && e.mistakes === undefined));
  });

  it('the JSON covers the core library and is well formed', ()=>{
    assert.ok(Object.keys(TEXT).length >= 50, 'core lifts keep their setup steps');
    assert.deepEqual(validateExerciseText(TEXT, new Set(Object.keys(EXERCISE_BY_ID))), []);
    for(const lift of ['push-up', 'bench-press-barbell', 'squat-barbell', 'deadlift-barbell'].filter(id => EXERCISE_BY_ID[id])){
      assert.ok(TEXT[lift]?.instructions?.length >= 2, `${lift} has setup steps`);
    }
  });

  it('the catalogue keeps exactly the first cue; the JSON keeps the full list', ()=>{
    for(const e of EXERCISES){
      assert.ok(!e.cues || e.cues.length <= 1, `${e.id} cues trimmed`);
      if(TEXT[e.id]?.cues) assert.equal(TEXT[e.id].cues[0], e.cues[0], `${e.id} first cue kept in sync`);
    }
    assert.ok(Object.values(TEXT).filter(t => t.cues).length > 300);
  });

  it('validateExerciseText flags junk and unknown ids', ()=>{
    const errs = validateExerciseText({ 'push-up': { instructions: ['x'] }, nope: { mistakes: ['A real sentence here'] } }, new Set(['push-up']));
    assert.equal(errs.length, 2);
  });

  it('teaching falls back to cue wording before the text loads, then uses the real sentences', ()=>{
    setExerciseText(null);
    assert.equal(exerciseTextLoaded(), false);
    const before = teachingFor('push-up');
    assert.ok(before.setup.trim().length > 0);
    assert.ok(before.mistakes.length > 0, 'cue-derived mistakes, never blank');
    setExerciseText(TEXT);
    assert.equal(exerciseTextLoaded(), true);
    const after = teachingFor('push-up');
    assert.equal(after.setup, TEXT['push-up'].instructions[0]);
    assert.deepEqual(after.mistakes, TEXT['push-up'].mistakes);
    assert.deepEqual(after.execution, TEXT['push-up'].instructions.slice(1));
    assert.equal(exerciseText('not-real'), null);
  });
});
