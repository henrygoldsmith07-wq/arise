import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionPace } from '../src/lib/warmup.js';

const T0 = Date.parse('2026-03-01T10:00:00.000Z');
const min = (m)=> T0 + m * 60 * 1000;

describe('sessionPace — live ETA from actual logging speed', ()=>{
  it('projects remaining time and finish clock time', ()=>{
    // 20 min in, 4 of 10 sets done → 5 min/set → 30 min left, done ~10:50.
    const p = sessionPace({ startedAtMs: T0, nowMs: min(20), completedSets: 4, totalSets: 10, plannedMin: 50 });
    assert.equal(p.remainingSets, 6);
    assert.equal(p.remainingMin, 30);
    assert.equal(p.etaMs, min(50));
    assert.equal(p.aheadBehind, 'on-track');
    assert.equal(p.deltaMin, 0);
  });

  it('flags ahead and behind outside the ±5 min dead band', ()=>{
    const behind = sessionPace({ startedAtMs: T0, nowMs: min(40), completedSets: 4, totalSets: 10, plannedMin: 50 });
    assert.equal(behind.aheadBehind, 'behind');
    assert.ok(behind.deltaMin >= 5);
    const ahead = sessionPace({ startedAtMs: T0, nowMs: min(10), completedSets: 4, totalSets: 10, plannedMin: 50 });
    assert.equal(ahead.aheadBehind, 'ahead');
    assert.ok(ahead.deltaMin <= -5);
  });

  it('works without a plan and returns null when there is no pace', ()=>{
    const noPlan = sessionPace({ startedAtMs: T0, nowMs: min(20), completedSets: 4, totalSets: 10 });
    assert.equal(noPlan.aheadBehind, null);
    assert.equal(noPlan.remainingMin, 30);
    assert.equal(sessionPace({ startedAtMs: T0, nowMs: min(5), completedSets: 0, totalSets: 10 }), null);
    assert.equal(sessionPace({ startedAtMs: T0, nowMs: min(50), completedSets: 10, totalSets: 10 }), null);
    assert.equal(sessionPace({ startedAtMs: T0, nowMs: T0, completedSets: 0, totalSets: 0 }), null);
    assert.equal(sessionPace({ startedAtMs: min(10), nowMs: T0, completedSets: 2, totalSets: 10 }), null);
  });
});
