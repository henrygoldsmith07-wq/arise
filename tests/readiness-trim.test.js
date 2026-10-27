import test from 'node:test';
import assert from 'node:assert/strict';
import { readinessTrimPlan } from '../src/lib/programming.js';
const session = { title: 'Upper', blocks: [
  { exerciseId: 'a', sets: 3, reps: '8-12' },
  { exerciseId: 'b', sets: 2, reps: '10' },
  { exerciseId: 'c', sets: 4, reps: '6-8' },
  { exerciseId: 'd', sets: 3, reps: '20 min' },
] };
test('low readiness trims one set from 3+ set resistance blocks only', ()=>{
  const r = readinessTrimPlan(session, { score: 30 });
  assert.equal(r.changed, true);
  assert.deepEqual(r.session.blocks.map(b=> b.sets), [2, 2, 3, 3]);
  assert.equal(r.setsRemoved, 2);
  assert.equal(r.session.blocks[0].readinessOriginalSets, 3);
  assert.equal(session.blocks[0].sets, 3);
  assert.match(r.reason, /30\/100/);
});
test('ok or missing readiness changes nothing', ()=>{
  assert.equal(readinessTrimPlan(session, { score: 70 }).changed, false);
  assert.equal(readinessTrimPlan(session, null).changed, false);
  assert.equal(readinessTrimPlan({ blocks: [{ sets: 2, reps: '8' }] }, { score: 10 }).changed, false);
});
