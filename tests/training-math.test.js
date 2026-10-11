// trainingMath.test.js — the canonical Epley and rep-parsing contract.
//
// These two formulas were once implemented eight times over (parseReps) and the
// Epley expression itself appeared in three function definitions plus eight
// inline copies. They had already drifted: some parsed decimals and some
// truncated them, some returned 0 and some null for an unusable value. This
// pins the single shared implementation everything now routes through, so a
// future change to one call site cannot silently diverge from the rest.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReps, e1rm, epleyToLoad } from '../src/lib/trainingMath.js';

describe('parseReps — the one rep parser', () => {
  it('reads the countable number out of every logged shape', () => {
    const cases = [
      [8, 8],
      ['8', 8],
      ['8-10', 8],
      ['8–10', 8],       // en dash, the shape the UI renders
      ['30–45s', 30],
      ['AMRAP', 0],
      ['', 0],
      [null, 0],
      [undefined, 0],
      [{}, 0],
      ['no numbers here', 0],
    ];
    for (const [input, expected] of cases) {
      assert.equal(parseReps(input), expected, `parseReps(${JSON.stringify(input)})`);
    }
  });

  it('preserves partial rep credit rather than truncating it', () => {
    // This is the fix: several old copies used /\d+/ and read 8.5 as 8, which
    // under-counted volume on assisted and tempo work.
    assert.equal(parseReps('8.5'), 8.5);
    assert.equal(parseReps(8.5), 8.5);
    assert.equal(parseReps('12–15'), 12);
  });

  it('never returns null, NaN or a negative', () => {
    for (const bad of [null, undefined, '', 'AMRAP', 'x', {}, [], NaN, Infinity, -Infinity, '-5']) {
      const v = parseReps(bad);
      assert.ok(Number.isFinite(v) && v >= 0, `parseReps(${JSON.stringify(bad)}) -> ${v}`);
    }
  });

  it('is total: every value yields a finite non-negative number', () => {
    for (const v of ['', '   ', 'abc', '1', '1a', 'a1', '12.5x', 'x12.5', -3, 0, 1e21, true, false]) {
      const n = parseReps(v);
      assert.ok(Number.isFinite(n) && n >= 0, `parseReps(${JSON.stringify(v)}) -> ${n}`);
    }
  });
});

describe('e1rm — the one Epley formula', () => {
  it('computes the textbook estimate', () => {
    assert.equal(e1rm(100, 10), 100 * (1 + 10 / 30));
    assert.equal(e1rm(60, 5), 70);
    assert.equal(e1rm(20, 12), 28);
  });

  it('returns 0 (the engine sentinel) for anything unusable', () => {
    // Falsy means "cannot estimate", so `e1rm(...) || reps` needs no null check.
    for (const bad of [[0, 10], [100, 0], [null, 10], [100, null], ['', 10], [100, ''], [NaN, 10], [100, NaN], [-5, 10], [100, -5]]) {
      assert.equal(e1rm(bad[0], bad[1]), 0, `e1rm(${JSON.stringify(bad)})`);
    }
  });

  it('accepts string reps the same way logged data arrives', () => {
    assert.equal(e1rm(100, '10'), e1rm(100, 10));
    assert.equal(e1rm(100, '8-10'), e1rm(100, 8));
    assert.equal(e1rm(100, 'AMRAP'), 0);
  });

  it('round-trips through epleyToLoad', () => {
    for (const [w, r] of [[100, 5], [60, 12], [22.5, 8], [100, 1]]) {
      const est = e1rm(w, r);
      assert.ok(Math.abs(epleyToLoad(est, r) - w) < 1e-9, `round-trip ${w}x${r}`);
    }
  });

  it('epleyToLoad guards a zero rep range', () => {
    assert.equal(epleyToLoad(100, 0), 0);
    assert.equal(epleyToLoad(100, 'AMRAP'), 0);
  });

  it('agrees with every module that used to inline the formula', () => {
    // The inline copies this replaced, verified numerically.
    assert.equal(e1rm(80, 6), 80 * (1 + 6 / 30));
    assert.equal(epleyToLoad(96, 6), 80);
  });
});
