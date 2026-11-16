import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { planRestTick, restActiveState, adjustRestEndsAt } from '../src/hooks/useRestTimer.js';

// The shared rest-timer core, tested pure: both workout presentations run
// this exact logic, so the contracts (3-2-1 ticks fire once per second,
// expiry state is wall-clock anchored) are pinned here rather than in two
// React trees.

describe('rest timer core', ()=>{
  it('cues each 3-2-1 tick exactly once per remaining second', ()=>{
    const endsAt = 10_000;
    // 3.2s left → left rounds to 4: no cue yet
    assert.deepEqual(planRestTick(endsAt, 6_800, null, true), { cue:false, lastTick:null });
    // 2.4s left → left is 3: cue, remember 3
    assert.deepEqual(planRestTick(endsAt, 7_600, null, true), { cue:true, lastTick:3 });
    // same second re-render: no second cue
    assert.deepEqual(planRestTick(endsAt, 7_700, 3, true), { cue:false, lastTick:3 });
    // next second: cue again
    assert.deepEqual(planRestTick(endsAt, 8_600, 3, true), { cue:true, lastTick:2 });
    assert.deepEqual(planRestTick(endsAt, 9_600, 2, true), { cue:true, lastTick:1 });
  });

  it('never cues when sound is off, but still tracks the second', ()=>{
    assert.deepEqual(planRestTick(10_000, 7_600, null, false), { cue:false, lastTick:3 });
  });

  it('resets the tick memory when no rest is active', ()=>{
    assert.deepEqual(planRestTick(null, 5_000, 2, true), { cue:false, lastTick:null });
    // after the window passes (left < 1) the memory clears to avoid replay
    assert.deepEqual(planRestTick(10_000, 9_700, 1, true), { cue:false, lastTick:1 });
  });

  it('anchors countdown state to the wall clock', ()=>{
    const endsAt = 10_000;
    assert.deepEqual(restActiveState(endsAt, 4_000), { active:true, left:6, expired:false });
    assert.deepEqual(restActiveState(endsAt, 10_000), { active:false, left:0, expired:true });
    assert.deepEqual(restActiveState(endsAt, 12_500), { active:false, left:0, expired:true });
    assert.deepEqual(restActiveState(null, 12_500), { active:false, left:null, expired:false });
  });

  it('counts remaining whole seconds without going negative', ()=>{
    assert.equal(restActiveState(10_000, 9_400).left, 1);
    assert.equal(restActiveState(10_000, 8_100).left, 2);
    assert.equal(restActiveState(10_000, 11_000).left, 0);
  });

  it('does not start a rest when adjusting a dock with no active timer', ()=>{
    // The old fallback anchored to now, so -15s on a settled dock started a
    // surprise five-second rest instead of doing nothing.
    assert.equal(adjustRestEndsAt(null, -15, 1_000), null);
    assert.equal(adjustRestEndsAt(0, -15, 1_000), null);
    assert.equal(adjustRestEndsAt(900, -15, 1_000), null); // already expired
    assert.equal(adjustRestEndsAt(NaN, 30, 1_000), null);
  });

  it('adjusts a running timer from its existing end, not from now', ()=>{
    assert.equal(adjustRestEndsAt(91_000, -15, 1_000), 76_000);
    assert.equal(adjustRestEndsAt(91_000, 30, 1_000), 121_000);
  });

  it('keeps the five-second floor when shrinking a running timer', ()=>{
    assert.equal(adjustRestEndsAt(4_000, -60, 1_000), 6_000);
  });
});
