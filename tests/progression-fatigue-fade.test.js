import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendNext, fatigueFadeInLastSession } from '../src/lib/progression.js';

const sess = (d, sets)=> ({ dateISO: d, blocks: [{ exerciseId: 'lat-pulldown', sets: sets.map(([w, r, rpe, extra])=> ({ weightKg: w, reps: r, rpe, ...(extra||{}) })) }] });
const rec = history=> recommendNext({ exerciseId: 'lat-pulldown', history, targetReps: '8–12', asOfDateISO: '2026-10-20' });

test('top-of-range best set does not add load when the last two sets collapsed', ()=>{
  const r = rec([sess('2026-10-15', [[40, 12, 8], [40, 7, 9], [40, 6, 10]])]);
  assert.equal(r.load, 40, r.reason);
  assert.ok(r.fatigueFade, 'fade flag set');
  assert.match(r.reason, /last two sets/i);
});

test('a single weak final set still progresses', ()=>{
  const r = rec([sess('2026-10-15', [[40, 12, 8], [40, 12, 8], [40, 6, 10]])]);
  assert.ok(r.load > 40, r.reason);
});

test('two failed sets count as a fade; skipped sets are ignored', ()=>{
  assert.ok(fatigueFadeInLastSession([sess('2026-10-15', [[40, 12], [40, 9, null, { failed: true }], [40, 9, null, { failed: true }]])], 'lat-pulldown', 8));
  assert.equal(fatigueFadeInLastSession([sess('2026-10-15', [[40, 12], [40, 6, null, { skipped: true }], [40, 6, null, { skipped: true }]])], 'lat-pulldown', 8), null);
});

test('two-set sessions never trigger', ()=>{
  assert.equal(fatigueFadeInLastSession([sess('2026-10-15', [[40, 6], [40, 6]])], 'lat-pulldown', 8), null);
});

test('two fades in a row at the same load step the load down ~10%', ()=>{
  const h = [sess('2026-10-10', [[40, 10, 8], [40, 7, 9], [40, 6, 10]]), sess('2026-10-15', [[40, 10, 8], [40, 7, 9], [40, 6, 10]])];
  const r = rec(h);
  assert.ok(r.load < 40 && r.load >= 34, String(r.load));
  assert.equal(r.fadeStreak, 2);
  assert.match(r.reason, /last two sessions/i);
});

test('fades at different loads do not chain, and one fade still just holds', ()=>{
  const h = [sess('2026-10-10', [[37.5, 10, 8], [37.5, 7, 9], [37.5, 6, 10]]), sess('2026-10-15', [[40, 10, 8], [40, 7, 9], [40, 6, 10]])];
  assert.equal(rec(h).load, 40);
});
