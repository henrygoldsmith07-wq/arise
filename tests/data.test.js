import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchExercises, recommendExercises, validateContent, availablePrograms, scheduleProgram, EXERCISES, PROGRAMS, EXERCISE_TAG_IDS } from '../src/lib/data.js';

describe('arise data', ()=>{
  it('validates', ()=>{
    const errs = validateContent();
    assert.equal(errs.length, 0, errs.join('\n'));
  });

  it('library has grown past the starter set and every exercise carries tags', ()=>{
    assert.ok(EXERCISES.length >= 60, `expected a large library, got ${EXERCISES.length}`);
    for(const e of EXERCISES){
      assert.ok(Array.isArray(e.tags) && e.tags.length >= 1, `${e.id} has no tags`);
      for(const t of e.tags) assert.ok(EXERCISE_TAG_IDS.includes(t), `${e.id} has unknown tag ${t}`);
    }
  });

  it('tag vocabulary covers real browsing needs', ()=>{
    for(const required of ['compound','isolation','unilateral','low-impact','conditioning']){
      assert.ok(EXERCISE_TAG_IDS.includes(required));
      assert.ok(searchExercises({ tag: required }).length > 0, `no exercises tagged ${required}`);
    }
  });

  it('searchExercises filters by single tag and by tag combinations', ()=>{
    const compound = searchExercises({ tag: 'compound' });
    assert.ok(compound.length > 0);
    assert.ok(compound.every(e => e.tags.includes('compound')));
    // Isolation-only moves must not appear under compound
    assert.equal(compound.some(e => e.id === 'cable-fly'), false);

    const both = searchExercises({ tag: ['compound','grip'] });
    assert.ok(both.length > 0);
    assert.ok(both.every(e => e.tags.includes('compound') && e.tags.includes('grip')));
    assert.ok(both.some(e => e.id === 'farmer-carry'));

    const grip = searchExercises({ tag: 'grip' });
    assert.ok(grip.every(e => (e.tags || []).includes('grip')));
  });

  it('searchExercises filters by muscle', ()=>{
    const res = searchExercises({ muscle: 'Chest' });
    assert.ok(res.length>0);
    assert.ok(res.every(r=> r.muscle==='Chest'));
  });

  it('only-my-kit gates correctly', ()=>{
    const res = searchExercises({ availableEquipment: ['bodyweight'] });
    // bodyweight moves should remain, barbell bench should not without barbell
    const hasPushup = res.some(r=> r.id==='push-up');
    const hasBarbellBench = res.some(r=> r.id==='bench-press-barbell');
    assert.ok(hasPushup);
    assert.equal(hasBarbellBench, false);
  });

  it('recommendations change with equipment', ()=>{
    const a = recommendExercises({ goal:'strength', availableEquipment:['bodyweight'], limit: 8 }).map(x=>x.id);
    const b = recommendExercises({ goal:'strength', availableEquipment:['barbell','dumbbells','bench','pullup-bar'], limit: 8 }).map(x=>x.id);
    assert.notDeepEqual(a,b);
  });

  it('availablePrograms filters by kit', ()=>{
    const onlyBody = availablePrograms(['bodyweight','bands']).map(p=>p.id);
    assert.ok(onlyBody.includes('move-anywhere'));
    assert.equal(onlyBody.includes('strength-4x'), false);
  });

  it('scheduleProgram creates dated sessions', ()=>{
    const sched = scheduleProgram({ programId: PROGRAMS[0].id, startDateISO: '2026-01-05' });
    assert.ok(sched.sessions.length>0);
    assert.ok(sched.sessions[0].dateISO==='2026-01-05');
    assert.ok(sched.sessions.every(s=> s.status==='planned'));
  });
});
