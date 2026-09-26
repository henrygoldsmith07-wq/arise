import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completeWorkout } from '../src/services/workoutService.js';

function payload(overrides = {}){
  return {
    id:'session-1', dateISO:'2026-09-26', title:'Upper A', durationMinutes:42,
    blocks:[{ exerciseId:'bench-press-dumbbell', sets:[
      { reps:'8', weightKg:'20', completed:true },
      { reps:'8', weightKg:'20', completed:false },
    ] }],
    ...overrides,
  };
}

describe('workout application service', ()=>{
  it('upserts history, marks schedule done, clears the draft, and returns save metrics', ()=>{
    const store = {
      history:[], readinessLog:[], onboarding:{ equipment:['dumbbells'] }, preferences:{ progressionPolicy:'standard' },
      activeWorkout:{ session:{ id:'session-1' } },
      activeSchedule:{ programId:'p', sessions:[{ id:'session-1', dateISO:'2026-09-26', week:1, status:'planned', blocks:[] }] },
    };
    const result = completeWorkout({ store, payload:payload() });
    assert.equal(result.store.history.length, 1);
    assert.equal(result.store.activeSchedule.sessions[0].status, 'done');
    assert.equal(result.store.activeWorkout, null);
    assert.equal(result.historyBefore.length, 0);
    assert.equal(result.summary.savedSets, 1);
  });

  it('does not mutate the input store or duplicate a re-saved session', ()=>{
    const original = payload({ blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'8', weightKg:'20', completed:true }] }] });
    const store = { history:[original], readinessLog:[], onboarding:{ equipment:['dumbbells'] }, preferences:{}, activeSchedule:null, activeWorkout:{ session:{ id:'session-1' } } };
    const snapshot = JSON.stringify(store);
    const revised = payload({ blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'9', weightKg:'20', completed:true }] }] });
    const result = completeWorkout({ store, payload:revised });
    assert.equal(JSON.stringify(store), snapshot);
    assert.equal(result.store.history.length, 1);
    assert.equal(result.store.history[0].blocks[0].sets[0].reps, '9');
  });
});
