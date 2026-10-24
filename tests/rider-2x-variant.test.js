// Fails on old code: no rider-upper-2x programme, no riderPlanIdFor, shelf never picked a 2-day rider plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAM_BY_ID, EXERCISE_BY_ID } from '../src/lib/data.js';
import { RIDER_UPPER_2X, RIDER_LEG_SETS_CAP, RIDER_WHY_LEGS_CAPPED, riderPlanIdFor } from '../src/lib/data/programs-rider.js';
import { programShelf } from '../src/lib/programShelf.js';

test('variant selection: 2 gym days or 4+ ride days picks the 2-day plan', ()=>{
  assert.equal(riderPlanIdFor({ daysPerWeek:3 }), 'rider-upper-3x');
  assert.equal(riderPlanIdFor({ daysPerWeek:2 }), 'rider-upper-2x');
  assert.equal(riderPlanIdFor({ daysPerWeek:3, rideDays:[1,2,4,6] }), 'rider-upper-2x');
  assert.equal(riderPlanIdFor({ daysPerWeek:3, rideDays:[1,1,2,2,3] }), 'rider-upper-3x', 'duplicates count once');
  assert.equal(riderPlanIdFor(), 'rider-upper-3x');
});

test('2-day plan is registered, has 2 sessions a week and caps leg work', ()=>{
  assert.equal(PROGRAM_BY_ID['rider-upper-2x'], RIDER_UPPER_2X);
  const lower = new Set(['Legs', 'Glutes']);
  for(const w of RIDER_UPPER_2X.weeks){
    assert.equal(w.workouts.length, 2);
    for(const s of w.workouts){
      let legSets = 0;
      for(const b of s.blocks){
        assert.ok(EXERCISE_BY_ID[b.exerciseId], b.exerciseId);
        if(lower.has(EXERCISE_BY_ID[b.exerciseId].muscle)) legSets += b.sets;
      }
      assert.ok(legSets <= RIDER_LEG_SETS_CAP, `${s.title} leg sets ${legSets}`);
    }
  }
});

test('shelf offers the 2-day plan first with the why-legs-capped reason', ()=>{
  const shelf = programShelf({ onboarding:{ sport:'cycling', goal:'muscle', level:'Beginner', daysPerWeek:2 }, availableEquipment:['machine','cable'] });
  assert.equal(shelf.items[0].programId, 'rider-upper-2x');
  assert.ok(shelf.items[0].reasons.includes(RIDER_WHY_LEGS_CAPPED));
});
