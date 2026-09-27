import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dateISOAtOffset, daysBetweenDateOnly, isDateOnly, localDateISO, parseDateOnlyUTC } from '../src/lib/dateOnly.js';
import { linearRegressionIntervals } from '../src/lib/statistics.js';
import { strengthSeries } from '../src/lib/analytics.js';

describe('date-only utilities', ()=>{
  it('formats a local calendar date without converting through UTC', ()=>{
    const d = new Date(2026, 8, 26, 0, 5, 0);
    assert.equal(localDateISO(d), '2026-09-26');
  });

  it('handles positive UTC offsets across local midnight', ()=>{
    const instant = new Date('2026-09-25T23:30:00Z');
    assert.equal(dateISOAtOffset(instant, 120), '2026-09-26');
  });

  it('handles negative UTC offsets across local midnight', ()=>{
    const instant = new Date('2026-09-26T01:30:00Z');
    assert.equal(dateISOAtOffset(instant, -240), '2026-09-25');
  });

  it('keeps date-only arithmetic stable across DST boundary dates', ()=>{
    assert.equal(daysBetweenDateOnly('2026-03-28', '2026-03-29'), 1);
    assert.equal(daysBetweenDateOnly('2026-03-29', '2026-03-30'), 1);
    assert.equal(daysBetweenDateOnly('2026-10-24', '2026-10-25'), 1);
    assert.equal(daysBetweenDateOnly('2026-10-25', '2026-10-26'), 1);
    assert.equal(parseDateOnlyUTC('2026-03-29') % 86400000, 0);
  });

  it('rejects timestamps where a date-only domain value is required', ()=>{
    assert.equal(Number.isNaN(parseDateOnlyUTC('2026-03-29T23:00:00+01:00')), true);
    assert.equal(daysBetweenDateOnly('bad', '2026-03-30'), null);
  });

  it('fails closed for invalid local-date and offset inputs', ()=>{
    assert.equal(localDateISO('not-a-date'), '');
    assert.equal(dateISOAtOffset('not-a-date', 60), '');
    assert.equal(dateISOAtOffset('2026-01-01T00:00:00Z', Number.NaN), '');
  });

  it('requires the complete YYYY-MM-DD shape, not a matching substring', ()=>{
    assert.equal(Number.isNaN(parseDateOnlyUTC(null)), true);
    assert.equal(Number.isNaN(parseDateOnlyUTC('x2026-01-01')), true);
    assert.equal(Number.isNaN(parseDateOnlyUTC('2026-01-01x')), true);
    assert.equal(Number.isNaN(parseDateOnlyUTC('2026-13-01')), true);
  });

  it('rejects impossible calendar dates instead of accepting Date.parse normalisation', ()=>{
    for(const value of ['2026-02-29', '2026-02-30', '2026-02-31', '2026-04-31', '2026-11-31']){
      assert.equal(isDateOnly(value), false, value);
      assert.equal(Number.isNaN(parseDateOnlyUTC(value)), true, value);
    }
    for(const value of ['2024-02-29', '2026-01-31', '2026-04-30', '2026-12-31']){
      assert.equal(isDateOnly(value), true, value);
    }
  });
});

describe('linear regression intervals', ()=>{
  it('flat series has a flat fitted trend and zero-width confidence interval', ()=>{
    const result = linearRegressionIntervals([100, 100, 100, 100, 100]);
    assert.equal(result.slope, 0);
    assert.equal(result.intervalAvailable, true);
    assert.equal(result.residualStdError, 0);
    assert.ok(result.points.every(p=> p.confidenceLow === 100 && p.confidenceHigh === 100));
  });

  it('perfect linear growth fits exactly', ()=>{
    const result = linearRegressionIntervals([10, 12, 14, 16, 18]);
    assert.equal(result.slope, 2);
    assert.equal(result.residualStdError, 0);
    assert.ok(result.points.every(p=> Math.abs(p.fitted - p.observed) < 1e-12));
  });

  it('noisy linear growth has finite confidence intervals', ()=>{
    const result = linearRegressionIntervals([10, 13, 13, 17, 19, 20, 24]);
    assert.ok(result.slope > 1);
    assert.ok(result.residualStdError > 0);
    assert.equal(result.intervalAvailable, true);
    for(const p of result.points){
      assert.ok(Number.isFinite(p.confidenceLow) && Number.isFinite(p.confidenceHigh));
      assert.ok(p.confidenceLow <= p.fitted && p.fitted <= p.confidenceHigh);
    }
  });

  it('does not invent intervals for very small samples', ()=>{
    const one = linearRegressionIntervals([10]);
    const two = linearRegressionIntervals([10, 12]);
    assert.equal(one.intervalAvailable, false);
    assert.equal(two.intervalAvailable, false);
  });

  it('outliers expand residual uncertainty instead of being hidden', ()=>{
    const clean = linearRegressionIntervals([10, 11, 12, 13, 14, 15]);
    const outlier = linearRegressionIntervals([10, 11, 12, 40, 14, 15]);
    assert.ok(outlier.residualStdError > clean.residualStdError);
  });

  it('malformed workout rows are ignored by the e1RM series', ()=>{
    const history = [
      { dateISO:'2026-01-01', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ weightKg:'20', reps:'8' }] }] },
      { dateISO:'2026-01-08', blocks:null },
      { dateISO:'2026-01-15', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ weightKg:'bad', reps:'x' }] }] },
      { dateISO:'2026-01-22', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ weightKg:'22', reps:'8' }] }] },
    ];
    const series = strengthSeries(history, 'bench-press-dumbbell');
    const result = linearRegressionIntervals(series.map(p=> p.e1rm));
    assert.equal(series.length, 2);
    assert.equal(result.n, 2);
    assert.equal(result.intervalAvailable, false);
  });
});
