import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dateISOAtOffset, localDateISO } from '../src/lib/dateOnly.js';
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
