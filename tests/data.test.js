import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchExercises, recommendExercises, validateContent, availablePrograms, scheduleProgram, EXERCISES, PROGRAMS } from '../src/lib/data.js';

describe('arise data', ()=>{
  it('validates', ()=>{
    const errs = validateContent();
    assert.equal(errs.length, 0, errs.join('\n'));
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
