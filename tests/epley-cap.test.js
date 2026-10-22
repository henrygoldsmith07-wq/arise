// epley-cap.test.js — item 4 acceptance: e1rm caps high-rep optimism and
// epleyToLoad remains the exact inverse for r in 1..15.
import test from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, epleyToLoad, EPLEY_CAP_REPS } from '../src/lib/trainingMath.js';

test('e1rm caps at EPLEY_CAP_REPS', ()=>{
  assert.equal(EPLEY_CAP_REPS, 12);
  assert.equal(e1rm(100, 20), e1rm(100, 12), '20-rep estimate must saturate at the 12-rep value');
  assert.ok(e1rm(100, 20) < 100 * (1 + 20 / 30), 'capped estimate must sit below uncapped Epley');
});

test('e1rm(w, 20) no longer implies an unliftable load', ()=>{
  // 100kg × 20 capped at 12 reps → 140kg, not the uncapped ~167kg.
  assert.ok(e1rm(100, 20) <= 100 * (1 + 12 / 30) + 1e-9);
});

test('epleyToLoad round-trips for r in 1..15', ()=>{
  for(let r = 1; r <= 15; r++){
    const est = e1rm(80, r);
    const back = epleyToLoad(est, r);
    assert.ok(Math.abs(back - 80) < 1e-9, `round-trip failed at r=${r}: got ${back}`);
  }
});

test('low-rep estimates are unchanged by the cap', ()=>{
  assert.equal(e1rm(100, 5), 100 * (1 + 5 / 30));
  assert.equal(e1rm(60, 8), 60 * (1 + 8 / 30));
});
