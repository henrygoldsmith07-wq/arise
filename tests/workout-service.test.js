import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cancellationPlan, completeWorkout, completeWorkoutWorkflow } from '../src/services/workoutService.js';

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

  it('builds save telemetry and toast after the workflow completes', ()=>{
    const store = { history:[], readinessLog:[], onboarding:{ equipment:['dumbbells'] }, preferences:{}, activeSchedule:null, activeWorkout:{ session:{ id:'session-1' } } };
    const result = completeWorkoutWorkflow({ store, payload:payload(), saveStartedAt:100, performanceNow:()=> 137 });
    assert.equal(result.toast.title, 'Upper A saved');
    assert.match(result.toast.detail, /1 set/);
    assert.deepEqual(result.events[0], ['session:complete', { sessionId:'session-1', blocks:1 }]);
    assert.deepEqual(result.events[1], ['session:save', { sessionId:'session-1', blocks:1, durationMs:37 }]);
  });

  it('cancellation planning protects completed work and owns abandon metrics', ()=>{
    const store = {
      activeWorkout:{ startedAt:'2026-09-26T10:00:00.000Z', blocks:[{ sets:[{ completed:true },{ completed:false }] }] },
      history:[],
    };
    const now = Date.parse('2026-09-26T10:05:00.000Z');
    const result = cancellationPlan({ store, activeSession:{ id:'session-1' }, now });
    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.completedSets, 1);
    assert.equal(result.totalSets, 2);
    assert.equal(result.nextStore.activeWorkout, null);
    assert.deepEqual(result.event, { type:'session:abandon', payload:{ sessionId:'session-1', totalSets:2, completedSets:1, elapsedMs:300000 } });
  });
});
