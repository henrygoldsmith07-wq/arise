import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendNext } from '../src/lib/progression.js';

const rec = (w, reps, rpe) => recommendNext({
  exerciseId: 'lat-pulldown',
  history: [{ dateISO: '2026-10-01', blocks: [{ exerciseId: 'lat-pulldown', sets: [{ weightKg: w, reps, rpe }] }] }],
  targetReps: '8–12', asOfDateISO: '2026-10-06',
});

test('top of range at RPE 10 holds the load instead of adding weight', () => {
  const r = rec(40, 12, 10);
  assert.equal(r.load, 40, r.reason);
  assert.equal(r.reps, 12);
  assert.equal(r.grindHold, true);
  assert.match(r.reason, /grind/);
});

test('top of range at RPE 8 still progresses', () => {
  const r = rec(40, 12, 8);
  assert.ok(r.load > 40, r.reason);
  assert.ok(!r.grindHold);
});
