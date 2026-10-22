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
  assert.match(unknown.reason || '', /no effort \(RPE\) logged/i, 'hold reason must name unknown RPE');
  assert.equal(unknown.effortUnknown, true);
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

test('unknown RPE at the top of the range still progresses load (never stuck forever)', ()=>{
  const top = [{ dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: 30, rpe: '' }] }] }];
  const r = recommendNext({ exerciseId: 'bench-press-dumbbell', history: top, targetReps: '8–12' });
  assert.ok(Number(r.load) > 30, `expected a load step from 30 kg, got ${r.load} (${r.reason})`);
  assert.equal(r.reps, 8);
  // Unknown effort takes the conservative step, never the larger one.
  const rpe7 = recommendNext({ exerciseId: 'bench-press-dumbbell', history: [{ dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: 30, rpe: '7' }] }] }], targetReps: '8–12' });
  assert.ok(Number(r.load) <= Number(rpe7.load));
});
