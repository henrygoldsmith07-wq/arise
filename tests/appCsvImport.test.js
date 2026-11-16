// App-CSV import: dates are a trust boundary. An impossible date emitted here
// is rejected later at the store's date-only gate, silently losing the row.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAppCsv, rowsToHistory } from '../src/lib/appCsvImport.js';

const byId = { squat: true, 'bench-press': true };
const csv = (date, extra = '') => `Date,Exercise,Weight,Reps${extra}\n${date},Squat,100,5\n`;
const dates = (text) => parseAppCsv(text, { byId }).rows.map((r) => r.dateISO);

describe('app CSV import — date-only trust boundary', () => {
  it('keeps a real ISO date', () => {
    assert.deepEqual(dates(csv('2026-11-16')), ['2026-11-16']);
  });

  it('refuses an impossible ISO date instead of emitting it', () => {
    const parsed = parseAppCsv(csv('2026-02-31'), { byId });
    assert.deepEqual(parsed.rows, []);
    assert.equal(parsed.skipped, 1);
  });

  it('resolves a component above 12 as the day, not the month', () => {
    assert.deepEqual(dates(csv('10/23/2026')), ['2026-10-23']);
    assert.deepEqual(dates(csv('23/10/2026')), ['2026-10-23']);
  });

  it('keeps the historical day-first reading when both components are ambiguous', () => {
    assert.deepEqual(dates(csv('10/11/2026')), ['2026-11-10']);
  });

  it('skips an impossible calendar date rather than normalising it elsewhere', () => {
    const parsed = parseAppCsv(csv('31/02/2026'), { byId });
    assert.deepEqual(parsed.rows, []);
    assert.equal(parsed.skipped, 1);
  });

  it('reports skip count when good and bad rows arrive together', () => {
    const text = 'Date,Exercise,Weight,Reps\n2026-11-16,Squat,100,5\n10/23/2026,Squat,100,5\n31/02/2026,Squat,100,5\n';
    const parsed = parseAppCsv(text, { byId });
    assert.deepEqual(parsed.rows.map((r) => r.dateISO), ['2026-11-16', '2026-10-23']);
    assert.equal(parsed.skipped, 1);
    assert.deepEqual(rowsToHistory(parsed.rows).map((h) => h.dateISO), ['2026-10-23', '2026-11-16']);
  });
});
