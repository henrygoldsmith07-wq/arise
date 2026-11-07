import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trainedDays, monthGrid, shiftMonth } from '../src/lib/trainingCalendar.js';

describe('training calendar', () => {
  it('counts sessions per day, skipping deleted and undated ones', () => {
    const m = trainedDays([{ dateISO: '2026-11-02' }, { dateISO: '2026-11-02T18:00' }, { dateISO: '2026-11-03', deletedAt: 'x' }, {}, null]);
    assert.deepEqual([...m], [['2026-11-02', 2]]);
  });
  it('lays a month out in Monday-first weeks', () => {
    const nov = monthGrid(2026, 11); // 1 Nov 2026 is a Sunday
    assert.equal(nov[0][6], '2026-11-01');
    assert.deepEqual(nov[0].slice(0, 6), [null, null, null, null, null, null]);
    assert.equal(nov.flat().filter(Boolean).length, 30);
    assert.ok(nov.every((w) => w.length === 7));
    assert.equal(monthGrid(2026, 2).flat().filter(Boolean).length, 28);
    assert.equal(monthGrid(2028, 2).flat().filter(Boolean).length, 29, 'leap year');
  });
  it('shifts months across year ends', () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  });
});
