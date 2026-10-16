// rpe-unknown.test.js — item 3 acceptance: a set with no RPE and a set at
// RPE 8 must not produce the same recommendation. Unknown effort holds at the
// same target; explicit RPE 8 (RIR 2) progresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendNext } from '../src/lib/progression.js';

function historyWith(rpe){
  return [{ dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: 30, rpe }] }] }];
}

test('unknown RPE holds while RPE 8 progresses', ()=>{
  const unknown = recommendNext({ exerciseId: 'bench-press-dumbbell', history: historyWith(null), targetReps: '8–12' });
  const known = recommendNext({ exerciseId: 'bench-press-dumbbell', history: historyWith('8'), targetReps: '8–12' });
  assert.match(unknown.reason || '', /rpe-unknown/i, 'hold reason must name unknown RPE');
  assert.notDeepEqual(
    { reps: unknown.reps, load: unknown.load },
    { reps: known.reps, load: known.load },
    'unknown RPE and RPE 8 must not produce the same recommendation',
  );
});

test('unknown RPE repeats the same target', ()=>{
  const r = recommendNext({ exerciseId: 'bench-press-dumbbell', history: historyWith(''), targetReps: '8–12' });
  assert.equal(r.reps, 10);
  assert.equal(r.load, 30);
});
