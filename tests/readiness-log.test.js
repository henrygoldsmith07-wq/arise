import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readinessScore } from '../src/lib/progression.js';
import {
  READINESS_SCALE_MAX, READINESS_SCALE_MIN, clampSignal, readinessBand,
  readinessFormDefaults, readinessOn, removeReadinessEntry,
  scoreReadinessInputs, upsertReadinessEntry,
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
