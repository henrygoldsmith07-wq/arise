import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestLiftDays } from '../src/lib/rideAwareSchedule.js';

test('no rides: three days', () => {
  assert.equal(suggestLiftDays([], 3).length, 3);
});
test('never picks a ride day when avoidable', () => {
  const d = suggestLiftDays([6, 0], 3);
  assert.ok(!d.includes(6) && !d.includes(0));
});
test('avoids the day before a ride and adjacent lifts', () => {
  const d = suggestLiftDays([6], 2);
  assert.ok(!d.includes(6) && !d.includes(5));
  assert.notEqual(Math.abs(d[0] - d[1]), 1);
});
test('clamps count and ignores junk', () => {
  assert.deepEqual(suggestLiftDays(['x', 9], 0), []);
  assert.equal(suggestLiftDays([], 20).length, 7);
});
