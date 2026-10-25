import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendNext, increaseLoad } from '../src/lib/progression.js';

const mk = (d, w, r, rpe)=> ({ dateISO: d, blocks: [{ exerciseId: 'lat-pulldown', sets: [{ weightKg: w, reps: r, rpe }] }] });
const next = (w, rpe = 8, plateConfig = null)=> recommendNext({
  exerciseId: 'lat-pulldown',
  history: [mk('2026-10-01', w, 10, rpe), mk('2026-10-04', w, 12, rpe)],
  targetReps: '8–12', asOfDateISO: '2026-10-06', plateConfig,
});

test('top of range on a light load always goes up, never "20 → 20 kg"', ()=>{
  for(const w of [10, 12, 15, 20, 25, 30, 35, 40, 45, 55, 70]){
    const r = next(w);
    assert.ok(r.load > w, `${w} kg stayed at ${r.load}: ${r.reason}`);
  }
});

test('hard set inside the range holds the load and asks for one more rep', ()=>{
  const r = recommendNext({
    exerciseId: 'lat-pulldown',
    history: [mk('2026-10-01', 30, 8, 9), mk('2026-10-04', 30, 9, 9)],
    targetReps: '8–12', asOfDateISO: '2026-10-06',
  });
  assert.equal(r.load, 30, r.reason);
  assert.equal(r.reps, 10);
});

test('failing below the range never adds weight; far below eases off', ()=>{
  const run = (reps, rpe)=> recommendNext({ exerciseId: 'lat-pulldown', history: [mk('2026-10-01', 40, reps, rpe)], targetReps: '8–12', asOfDateISO: '2026-10-06' });
  const near = run(6, 9.5);
  assert.equal(near.load, 40); assert.equal(near.reps, 8);
  const far = run(5, 10);
  assert.ok(far.load < 40, far.reason);
});

test('increaseLoad takes one grid step when the percentage rounds away', ()=>{
  assert.equal(increaseLoad(30, 30.75), 32.5);
  assert.equal(increaseLoad(12, 12.3), 13);
  assert.equal(increaseLoad(70, 71), 75);
  assert.equal(increaseLoad(40, 42.5), 42.5);
});
