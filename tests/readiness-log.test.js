import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readinessScore } from '../src/lib/progression.js';
import {
  READINESS_SCALE_MAX, READINESS_SCALE_MIN, clampSignal, readinessBand,
  readinessFormDefaults, readinessOn, readinessTrend, readinessWeekCoverage,
  removeReadinessEntry, scoreReadinessInputs, upsertReadinessEntry,
} from '../src/lib/readinessLog.js';

const T = '2026-09-28';

describe('readiness log — the input the recovery channel never had', ()=>{
  it('writes a row nothing else in the codebase writes', ()=>{
    const log = upsertReadinessEntry([], { dateISO:T, sleep:4, soreness:2, motivation:5 });
    assert.equal(log.length, 1);
    assert.equal(log[0].dateISO, T);
    assert.equal(log[0].sleep, 4);
    assert.equal(log[0].soreness, 2);
    assert.equal(log[0].motivation, 5);
    assert.ok(Number.isFinite(log[0].score));
    assert.ok(log[0].at, 'dedupe keys in export.js/storeReconcile.js require `at`');
  });

  it('scores through the engine own function, not a copy of it', ()=>{
    const score = scoreReadinessInputs({ sleep:5, soreness:1, motivation:4 });
    assert.equal(score, readinessScore({ sleep:5, soreness:1, motivation:4 }));
  });

  it('keeps the log ascending regardless of write order', ()=>{
    let log = [];
    log = upsertReadinessEntry(log, { dateISO:'2026-09-30', sleep:3, soreness:3, motivation:3 });
    log = upsertReadinessEntry(log, { dateISO:'2026-09-28', sleep:3, soreness:3, motivation:3 });
    log = upsertReadinessEntry(log, { dateISO:'2026-09-29', sleep:3, soreness:3, motivation:3 });
    assert.deepEqual(log.map(r=> r.dateISO), ['2026-09-28','2026-09-29','2026-09-30']);
  });

  it('replaces rather than appends on a same-day edit', ()=>{
    // Two rows for one date would make the EMA and the "latest score" reads
    // disagree about which morning is which.
    let log = upsertReadinessEntry([], { dateISO:T, sleep:3, soreness:3, motivation:3 });
    log = upsertReadinessEntry(log, { dateISO:T, sleep:5, soreness:1, motivation:5 });
    assert.equal(log.length, 1, 'a same-day edit must replace, not append');
    assert.equal(log[0].sleep, 5);
    assert.equal(readinessOn(log, T).sleep, 5);
  });

  it('clears a day and survives clearing an absent one', ()=>{
    const log = upsertReadinessEntry([], { dateISO:T, sleep:4, soreness:2, motivation:4 });
    assert.equal(removeReadinessEntry(log, T).length, 0);
    assert.equal(removeReadinessEntry([], T).length, 0);
  });

  it('tolerates a corrupt or absent log rather than throwing', ()=>{
    for(const bad of [null, undefined, 'nonsense', 42, {}]){
      assert.doesNotThrow(()=> upsertReadinessEntry(bad, { dateISO:T, sleep:3, soreness:3, motivation:3 }));
      assert.doesNotThrow(()=> readinessFormDefaults(bad, T));
      assert.equal(removeReadinessEntry(bad, T).length, 0);
    }
  });

  it('clamps anything to the 1..5 scale the scorer expects', ()=>{
    assert.equal(clampSignal(0), READINESS_SCALE_MIN);
    assert.equal(clampSignal(99), READINESS_SCALE_MAX);
    assert.equal(clampSignal(3.4), 3);
    assert.equal(clampSignal('4'), 4);
    assert.equal(clampSignal('abc'), 3, 'garbage is neutral, not zero');
    assert.ok(scoreReadinessInputs({ sleep:99, soreness:-5, motivation:'x' }) >= 0);
  });
});

describe('readiness check-in defaults (why the common case is one tap)', ()=>{
  it('opens neutral on a first-ever check-in', ()=>{
    assert.deepEqual(readinessFormDefaults([], T), { sleep:3, soreness:3, motivation:3 });
  });

  it('opens on today entry when one exists, so an edit is an edit', ()=>{
    const log = [
      { dateISO:'2026-09-27', score:80, sleep:5, soreness:1, motivation:5 },
      { dateISO:T, score:20, sleep:1, soreness:5, motivation:1 },
    ];
    assert.deepEqual(readinessFormDefaults(log, T), { sleep:1, soreness:5, motivation:1 });
  });

  it('carries the most recent earlier entry forward, never a future one', ()=>{
    // Point-in-time discipline: today's check-in must not be prefilled from a
    // later date, or a backdated week would inherit information from the future.
    const log = [
      { dateISO:'2026-09-20', score:70, sleep:4, soreness:2, motivation:4 },
      { dateISO:'2026-09-30', score:10, sleep:1, soreness:5, motivation:1 },
    ];
    assert.deepEqual(readinessFormDefaults(log, T), { sleep:4, soreness:2, motivation:4 });
  });
});

describe('readiness band', ()=>{
  it('describes a score without over-claiming what it measures', ()=>{
    assert.equal(readinessBand(0).id, 'low');
    assert.equal(readinessBand(50).id, 'fair');
    assert.equal(readinessBand(75).id, 'good');
    assert.equal(readinessBand(100).id, 'high');
    assert.equal(readinessBand('nope').id, 'unknown');
    assert.equal(readinessBand(null).label, '—');
  });
});

// The bounded reads behind the Today zero-coverage nudge, the Weekly Review's
// evidence line and the Progress trend row: coverage groupings and a
// direction call that refuses to be made from thin data.
describe('readiness week coverage (Monday-start, same buckets as the review)', ()=>{
  it('counts rows inside the week containing the reference day only', ()=>{
    // 2026-09-28 is a Monday; 2026-09-27 (Sunday) belongs to the previous week.
    const log = [
      { dateISO:'2026-09-27', score:70 },
      { dateISO:'2026-09-28', score:70 },
      { dateISO:'2026-09-29', score:70 },
      { dateISO:'2026-10-05', score:70 },
    ];
    assert.equal(readinessWeekCoverage(log, '2026-09-29').inWeek, 2);
    assert.equal(readinessWeekCoverage(log, '2026-09-27').inWeek, 1, 'a Sunday rows-bucket boundary is the previous week');
    assert.equal(readinessWeekCoverage([], '2026-09-29').inWeek, 0);
    assert.equal(readinessWeekCoverage('nonsense', '2026-09-29').inWeek, 0);
  });
});

describe('readiness trend (bounded window, honest direction)', ()=>{
  const row = (dateISO, score)=> ({ dateISO, score });

  it('declining: recent half reads clearly below the half before it', ()=>{
    const log = [
      row('2026-09-14', 78), row('2026-09-16', 76),
      row('2026-09-19', 74), row('2026-09-22', 72),
      row('2026-09-25', 50), row('2026-09-26', 48),
    ];
    const t = readinessTrend(log, { todayISO: '2026-09-27' });
    assert.equal(t.available, true);
    assert.equal(t.direction, 'declining');
    assert.ok(t.prevAvg - t.recentAvg >= 5);
    assert.equal(t.entries, 6);
  });

  it('improving mirrors declining', ()=>{
    const log = [
      row('2026-09-14', 40), row('2026-09-16', 44),
      row('2026-09-19', 46), row('2026-09-22', 48),
      row('2026-09-25', 75), row('2026-09-26', 80),
    ];
    const t = readinessTrend(log, { todayISO: '2026-09-27' });
    assert.equal(t.available, true);
    assert.equal(t.direction, 'improving');
  });

  it('steady holds inside the deadband; boundary fires beyond it', ()=>{
    const dates = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'];
    const steady = [62, 64, 62, 64, 62, 63].map((s, i)=> row(dates[i], s)); // ±2 swing
    const t = readinessTrend(steady, { todayISO: '2026-09-27' });
    assert.equal(t.available, true);
    assert.equal(t.direction, 'steady');
    const edge = [70, 70, 70, 70, 62, 60].map((s, i)=> row(dates[i], s)); // recent-vs-prev swing ≈10
    assert.equal(readinessTrend(edge, { todayISO: '2026-09-27' }).direction, 'declining');
  });

  it('never calls a direction from sparse data, but still reports what is known', ()=>{
    const t = readinessTrend([row('2026-09-20', 62), row('2026-09-24', 58)], { todayISO: '2026-09-27' });
    assert.equal(t.available, false);
    assert.ok(Number.isFinite(t.recentAvg), 'the irrelevant average still exists for honest wording');
  });

  it('ignores rows outside the 14-day window and future rows', ()=>{
    const log = [
      row('2026-08-30', 30), row('2026-08-31', 30), // outside the window
      row('2026-09-15', 80), row('2026-09-17', 80), row('2026-09-19', 80),
      row('2026-09-22', 80), row('2026-09-25', 80), row('2026-09-26', 80),
      row('2026-09-30', 20), // after today — must not leak in
    ];
    const t = readinessTrend(log, { todayISO: '2026-09-27' });
    assert.equal(t.available, true);
    assert.equal(t.direction, 'steady');
    assert.equal(t.entries, 6, 'exactly the in-window rows');
    assert.equal(t.lastDate, '2026-09-26');
  });

  it('tolerates corrupt logs and dates without throwing', ()=>{
    for(const bad of [null, undefined, 'nonsense', 42, {}]){
      assert.doesNotThrow(()=> readinessTrend(bad, { todayISO: '2026-09-27' }));
      assert.doesNotThrow(()=> readinessWeekCoverage(bad, '2026-09-27'));
    }
  });
});
