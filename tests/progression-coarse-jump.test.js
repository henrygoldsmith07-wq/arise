import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendNext, COARSE_JUMP_PCT } from '../src/lib/progression.js';

const mk = (d, w, r, rpe = 8) => ({ dateISO: d, blocks: [{ exerciseId: 'lat-pulldown', sets: [{ weightKg: w, reps: r, rpe }] }] });
const rec = (w, reps, plateConfig) => recommendNext({
  exerciseId: 'lat-pulldown', history: [mk('2026-10-01', w, reps)], targetReps: '8–12', asOfDateISO: '2026-10-06', plateConfig,
});
const stack = (inc) => ({ machineIncrementKg: inc, machineMinKg: inc, machineMaxKg: 100 });

test('a 5 kg stack on 20 kg (+25%) adds reps past the range before stepping up', () => {
  const r = rec(20, 12, stack(5));
  assert.equal(r.load, 20, r.reason);
  assert.equal(r.reps, 13);
  assert.ok(r.coarseJump && r.coarseJump.jumpPct > COARSE_JUMP_PCT * 100);
  assert.match(r.reason, /stay at 20 kg/);
});

test('reps stretch up to hi+3, then the jump is taken', () => {
  assert.equal(rec(20, 14, stack(5)).load, 20);
  const done = rec(20, 15, stack(5));
  assert.ok(done.load > 20, done.reason);
  assert.equal(done.reps, 8);
});

test('fine stacks and heavy loads are unaffected', () => {
  assert.ok(rec(20, 12, stack(1)).load > 20);
  const heavy = rec(80, 12, stack(5));
  assert.ok(heavy.load > 80 && !heavy.coarseJump, heavy.reason);
});

test('without a plate config nothing changes', () => {
  assert.ok(rec(20, 12, null).load > 20);
});
