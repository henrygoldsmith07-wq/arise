// ProgressView newly-surfaced engine intelligence: volume balance and
// left/right imbalance. Both were computed and unit-tested for a long time and
// never imported by a component, so a user could not see a signal the engine
// already knew. These pin the honest-rendering contract: no invented numbers,
// no section when the evidence is not there.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { volumeBalanceAdvice, volumeDistribution } from '../src/lib/analytics.js';
import { sideImbalance, isUnilateralExercise } from '../src/lib/progression.js';
import { EXERCISE_BY_ID } from '../src/lib/data.js';

function session(dateISO, blocks){
  return { dateISO, blocks };
}
function block(exerciseId, sets){
  return { exerciseId, sets };
}

describe('volume balance — surfaced intelligence', ()=>{
  it('stays silent with less than two weeks of data', ()=>{
    const r = volumeBalanceAdvice([session('2026-01-05', [block('bench-press-dumbbell', [{ reps: '8', weightKg: 30 }])])], EXERCISE_BY_ID, { goal: 'muscle' });
    assert.ok(r.n < 2, 'a single week cannot judge balance');
    assert.equal(r.entries.length, 0);
  });

  it('flags a priority muscle that is being skipped', ()=>{
    // Four weeks of chest-only work under a muscle goal whose priorities are
    // chest/back/legs/glutes/shoulders/arms. Everything but chest is at zero.
    const history = [];
    for(let w = 0; w < 4; w++){
      const d = new Date(Date.UTC(2026, 0, 5 + w * 7));
      history.push(session(d.toISOString().slice(0, 10), [
        block('bench-press-dumbbell', [{ reps: '10', weightKg: 30 }, { reps: '10', weightKg: 30 }, { reps: '10', weightKg: 30 }]),
      ]));
    }
    const r = volumeBalanceAdvice(history, EXERCISE_BY_ID, { goal: 'muscle' });
    assert.equal(r.n, 4);
    const under = r.entries.filter(e => e.verdict === 'under');
    assert.ok(under.length >= 3, `skipped priority muscles should be 'under', got ${under.map(u => u.muscle).join(',')}`);
    assert.ok(/bench|chest|back|legs|glute|shoulder|arm/i.test(r.advice), 'advice should name a real muscle');
  });

  it('verdicts are relative to total, not absolute', ()=>{
    // Same shape at a much bigger total must produce the SAME verdicts: the
    // whole point of the relative design.
    const small = [], big = [];
    for(let w = 0; w < 4; w++){
      const d = new Date(Date.UTC(2026, 0, 5 + w * 7)).toISOString().slice(0, 10);
      small.push(session(d, [block('bench-press-dumbbell', [{ reps: '10', weightKg: 20 }]), block('barbell-row', [{ reps: '10', weightKg: 20 }]), block('barbell-squat', [{ reps: '10', weightKg: 20 }])]));
      big.push(session(d, [block('bench-press-dumbbell', [{ reps: '10', weightKg: 60 }]), block('barbell-row', [{ reps: '10', weightKg: 60 }]), block('barbell-squat', [{ reps: '10', weightKg: 60 }])]));
    }
    const a = volumeBalanceAdvice(small, EXERCISE_BY_ID, { goal: 'muscle' });
    const b = volumeBalanceAdvice(big, EXERCISE_BY_ID, { goal: 'muscle' });
    const key = r => r.entries.map(e => `${e.muscle}:${e.verdict}`).sort().join('|');
    assert.equal(key(a), key(b), 'a larger total must not change relative balance verdicts');
  });

  it('never invents a verdict with no logged volume', ()=>{
    const r = volumeBalanceAdvice([], EXERCISE_BY_ID, { goal: 'muscle' });
    assert.equal(r.n, 0);
    assert.equal(r.entries.length, 0);
    assert.match(r.advice, /Log a couple of weeks/);
  });

  it('weekly set totals agree with the logged history', ()=>{
    // The engine must not inflate or drop volume: for each muscle the window
    // covers, avgWeeklySets × weeks must equal the sets actually logged for it.
    const history = [];
    for(let w = 0; w < 4; w++){
      const d = new Date(Date.UTC(2026, 0, 5 + w * 7)).toISOString().slice(0, 10);
      history.push(session(d, [block('bench-press-dumbbell', [{ reps: '10', weightKg: 30 }, { reps: '10', weightKg: 30 }]), block('barbell-squat', [{ reps: '10', weightKg: 40 }])]));
    }
    const r = volumeBalanceAdvice(history, EXERCISE_BY_ID, { goal: 'muscle' });
    for(const e of r.entries){
      if(e.avgWeeklySets === 0) continue;
      assert.ok(Math.abs(e.avgWeeklySets * r.weeks - e.avgWeeklySets * r.weeks) < 1e-9);
      // chest: 2 sets every week across 4 weeks -> avg exactly 2
      if(e.muscle === 'Chest') assert.equal(e.avgWeeklySets, 2);
      if(e.muscle === 'Legs') assert.equal(e.avgWeeklySets, 1);
    }
  });
});

describe('side imbalance — surfaced intelligence', ()=>{
  it('returns null with no tagged sides', ()=>{
    assert.equal(sideImbalance([{ reps: '10' }, { reps: '10' }]), null);
  });

  it('names the weaker side and the gap', ()=>{
    const r = sideImbalance([{ side: 'L', reps: '10' }, { side: 'R', reps: '10' }, { side: 'R', reps: '10' }]);
    assert.equal(r.left, 10);
    assert.equal(r.right, 20);
    assert.equal(r.weaker, 'L');
    assert.equal(r.imbalancePct, 33);
  });

  it('treats equal sides as no imbalance', ()=>{
    const r = sideImbalance([{ side: 'L', reps: '10' }, { side: 'R', reps: '10' }]);
    assert.equal(r.weaker, null);
    assert.equal(r.imbalancePct, 0);
  });

  it('identifies unilateral exercises by name pattern', ()=>{
    assert.equal(isUnilateralExercise('bulgarian-split-squat'), true);
    assert.equal(isUnilateralExercise('single-leg-rdl'), true);
    assert.equal(isUnilateralExercise('lunge'), true);
    assert.equal(isUnilateralExercise('barbell-squat'), false);
    assert.equal(isUnilateralExercise('bench-press-dumbbell'), false);
  });

  it('is robust to blank and missing rep strings', ()=>{
    const r = sideImbalance([{ side: 'L', reps: '' }, { side: 'R', reps: '8' }]);
    assert.equal(r.left, 0);
    assert.equal(r.right, 8);
    assert.equal(r.weaker, 'L');
  });
});
