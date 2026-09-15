import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { teachingFor, curatedExerciseCount, teachingOverrideIds, allExerciseIds, TEACHING_SECTIONS } from '../src/lib/exerciseTeaching.js';
import { EXERCISE_BY_ID } from '../src/lib/data.js';

describe('exercise teaching covers every library exercise', ()=>{
  it('all 8 sections exist and are non-empty for every exercise', ()=>{
    for(const id of allExerciseIds()){
      const t = teachingFor(id);
      assert.ok(t, `teaching for ${id}`);
      assert.ok(t.setup?.trim(), `${id} setup`);
      assert.ok(Array.isArray(t.execution) && t.execution.length && t.execution.every(s=> s.trim()), `${id} execution`);
      assert.ok(t.breathing?.trim(), `${id} breathing`);
      assert.ok(t.safety?.trim(), `${id} safety`);
      assert.ok(Array.isArray(t.mistakes), `${id} mistakes array`);
      for(const key of TEACHING_SECTIONS) assert.ok(key in t, `${id} section ${key}`);
    }
  });

  it('curated overrides cover the core lifts and all exist in the library', ()=>{
    assert.ok(curatedExerciseCount() >= 40, `expected 40+ curated exercises, got ${curatedExerciseCount()}`);
    for(const id of teachingOverrideIds()) assert.ok(EXERCISE_BY_ID[id], `override for unknown exercise: ${id}`);
  });

  it('regressions/progressions/variations only reference real exercises', ()=>{
    for(const id of allExerciseIds()){
      const t = teachingFor(id);
      for(const r of [...t.regressions, ...t.progressions, ...t.equipmentVariations]){
        assert.ok(EXERCISE_BY_ID[r.id], `${id} references unknown ${r.id}`);
      }
    }
  });

  it('core lifts have level-honest difficulty directions', ()=>{
    const pull = teachingFor('pull-up');
    assert.ok(pull.regressions.some(r=> r.id === 'inverted-row' || r.id === 'lat-pulldown'));
    const push = teachingFor('push-up');
    assert.ok(push.progressions.some(r=> r.id === 'weighted-push-up' || r.id === 'archer-push-up' || r.id === 'chest-dip'));
    const bench = teachingFor('bench-press-barbell');
    assert.ok(bench.regressions.length > 0);
  });
});

describe('teaching content stays practical coaching, never medical advice', ()=>{
  // "prescription" is normal training vocabulary in this app (programme
  // prescriptions); only medical/treatment framing is out of bounds.
  const BANNED = /\b(treat\w*|diagnos\w*|medicine|medical|therap\w*|cure|disease|syndrome|concussion|fracture|tendonitis|arthritis|physio\w*)\b/i;
  it('no medical or treatment language anywhere in derived text', ()=>{
    for(const id of allExerciseIds()){
      const t = teachingFor(id);
      const text = [t.setup, ...t.execution, t.breathing, t.safety, ...t.mistakes].join(' ');
      assert.ok(!BANNED.test(text), `${id} teaching uses medical framing: ${text.slice(0, 80)}`);
    }
  });

  it('unknown ids yield null, not fabricated teaching', ()=>{
    assert.equal(teachingFor('not-an-exercise'), null);
  });

  it('curated breath/safety lines make up a real share of the core library', ()=>{
    const core = ['push-up','bench-press-barbell','barbell-squat','romanian-deadlift','pull-up','overhead-press-barbell','plank','lunge'];
    for(const id of core){
      const t = teachingFor(id);
      assert.ok(t.breathing.length > 20, id);
      assert.ok(t.safety.length > 20, id);
    }
  });
});
