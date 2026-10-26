import test from 'node:test';
import assert from 'node:assert/strict';
import { rideLiftOverlay } from '../src/lib/rideAwareSchedule.js';

const sess = (dateISO, ex, n=3) => ({ dateISO, blocks:[{ exerciseId: ex, sets: Array.from({length:n},()=>({reps:10,weightKg:20})) }] });

test('rideLiftOverlay: empty without ride days or history', ()=>{
  assert.deepEqual(rideLiftOverlay([sess('2026-10-20','leg-press')], []), []);
  assert.deepEqual(rideLiftOverlay([], [6]), []);
});

test('rideLiftOverlay counts leg sets on ride day / day before only', ()=>{
  const h = [sess('2026-10-23','leg-press',3), sess('2026-10-19','leg-press',2), sess('2026-10-21','lat-pulldown',4)];
  const r = rideLiftOverlay(h, [6], { weeks: 2, todayISO: '2026-10-25' });
  assert.equal(r.length, 2);
  assert.equal(r[0].liftDays, 0);
  const w = r[1];
  assert.equal(w.weekStart, '2026-10-19');
  assert.equal(w.liftDays, 3);
  assert.equal(w.legSets, 5);
  assert.equal(w.clashLegSets, 3);
});
