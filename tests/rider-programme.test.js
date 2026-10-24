// rider-programme.test.js — the cyclist/triathlete plan stays upper-body-first.
// Fails on the old code (no 'rider-upper-3x' programme existed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMS, PROGRAM_BY_ID, PROGRAM_TEMPLATES, EXERCISE_BY_ID, exerciseAvailable, programHistory, scheduleProgram } from '../src/lib/data.js';
import { RIDER_LEG_SETS_CAP } from '../src/lib/data/programs-rider.js';
import { recommendTemplate } from '../src/lib/templates.js';

const LOWER = new Set(['Legs', 'Glutes']);
const rider = ()=> PROGRAM_BY_ID['rider-upper-3x'];

test('the rider plan is a selectable built-in, appended after the originals', ()=>{
  assert.ok(rider(), 'rider-upper-3x exists');
  assert.equal(PROGRAMS[PROGRAMS.length - 2].id, 'rider-upper-3x');
  assert.equal(PROGRAMS.filter(p=> p.id === 'rider-upper-3x').length, 1, 'appended exactly once');
  assert.equal(PROGRAMS[0].id, 'starter-3x', 'original order unchanged');
  assert.equal(rider().daysPerWeek, 3);
  assert.equal(programHistory('rider-upper-3x').length, 1);
});

test('every exercise exists and runs on machines, cables or bodyweight only', ()=>{
  const kit = ['machine', 'cable', 'bodyweight', 'bands'];
  for(const week of rider().weeks) for(const w of week.workouts) for(const b of w.blocks){
    assert.ok(EXERCISE_BY_ID[b.exerciseId], `${b.exerciseId} is in the catalogue`);
    assert.ok(exerciseAvailable(b.exerciseId, kit), `${b.exerciseId} needs only machine/cable/bodyweight`);
  }
});

test('leg work is capped: at most one short lower-body block per session', ()=>{
  let upper = 0, lower = 0;
  for(const week of rider().weeks) for(const w of week.workouts){
    const legBlocks = w.blocks.filter(b=> LOWER.has(EXERCISE_BY_ID[b.exerciseId].muscle));
    assert.ok(legBlocks.length <= 1, `${w.title} week ${week.week}: ${legBlocks.length} leg blocks`);
    for(const b of legBlocks) assert.ok(b.sets <= RIDER_LEG_SETS_CAP, `${b.exerciseId}: ${b.sets} sets`);
    for(const b of w.blocks){
      const m = EXERCISE_BY_ID[b.exerciseId].muscle;
      if(LOWER.has(m)) lower += b.sets;
      else if(m !== 'Core') upper += b.sets;
    }
  }
  assert.ok(upper >= lower * 5, `upper ${upper} sets vs lower ${lower}`);
  assert.doesNotMatch(JSON.stringify(rider()), /barbell-squat|deadlift/);
});

test('it schedules like any other programme', ()=>{
  const sched = scheduleProgram({ programId: 'rider-upper-3x', startDateISO: '2026-10-26' });
  assert.ok(sched.sessions.length >= 6);
  assert.ok(sched.sessions.every(s=> s.blocks.length));
});

test('profile recommendation is unchanged (no template entry)', ()=>{
  assert.ok(!PROGRAM_TEMPLATES.some(t=> t.programId === 'rider-upper-3x'));
  const top = recommendTemplate({ goal: 'muscle', level: 'Beginner', availableEquipment: ['machine', 'cable', 'bodyweight'], daysPerWeek: 3 }).top;
  assert.notEqual(top.programId, 'rider-upper-3x');
});
