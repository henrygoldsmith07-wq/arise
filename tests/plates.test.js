import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nearestLoadToPlates } from '../src/lib/plates.js';
import { recommendNext } from '../src/lib/progression.js';

describe('plate-aware loadability', ()=>{
  it('returns an exact per-side stack when the target is loadable', ()=>{
    const result = nearestLoadToPlates(62.5, { barWeightKg: 20, platesKg: [1.25, 2.5, 5, 10] });
    assert.equal(result.loadKg, 62.5);
    assert.equal(result.exact, true);
    assert.deepEqual(result.platesPerSide, [10, 10, 1.25]);
  });

  it('chooses the nearest lower load on a tie', ()=>{
    const result = nearestLoadToPlates(105, { barWeightKg: 20, platesKg: [5] });
    assert.equal(result.loadKg, 100);
    assert.equal(result.direction, 'under');
    assert.equal(result.deltaKg, -5);
    assert.deepEqual(result.platesPerSide, [5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it('respects an explicitly empty plate inventory', ()=>{
    const result = nearestLoadToPlates(60, { barWeightKg: 20, platesKg: [] });
    assert.equal(result.loadKg, 20);
    assert.deepEqual(result.platesPerSide, []);
  });

  it('rounds only when an explicit plate setup is supplied to progression', ()=>{
    const history = [{
      id: 'bench-1',
      dateISO: '2026-01-01',
      blocks: [{ exerciseId: 'bench-press-barbell', sets: [{ reps: 12, weightKg: 100, rpe: 7 }] }],
    }];
    const rounded = recommendNext({ exerciseId: 'bench-press-barbell', history, targetReps: '8–12', plateConfig: { barWeightKg: 20, platesKg: [5] } });
    const generic = recommendNext({ exerciseId: 'bench-press-barbell', history, targetReps: '8–12' });
    assert.equal(generic.load, 105);
    assert.equal(rounded.load, 100);
    assert.equal(rounded.plateLoad.direction, 'under');
    assert.match(rounded.reason, /Plate setup rounds/);
  });
});

import { nearestAchievableLoad } from '../src/lib/plates.js';

describe('equipment profiles from onboarding', ()=>{
  it('rounds dumbbell targets to pairs the user actually owns', ()=>{
    const owned = { dumbbellsKg: [5, 10, 15] };
    const result = nearestAchievableLoad(12.5, { equipment: 'dumbbell', config: owned });
    assert.equal(result.loadKg, 10); // documented tie-break: nearest, lighter on a tie
  });
  it('snaps machine targets to the configured stack increment', ()=>{
    const result = nearestAchievableLoad(31, { equipment: 'machine', config: { machineIncrementKg: 2.5 } });
    assert.equal(result.loadKg % 2.5, 0);
    assert.ok(Math.abs(result.loadKg - 31) <= 1.25);
  });
});
