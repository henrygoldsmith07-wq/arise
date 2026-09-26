// Application-level workout orchestration. React owns presentation state;
// this module owns the deterministic store transition after a workout save.

import { upsertHistory } from '../lib/store.js';
import { adaptActiveSchedule } from '../lib/programming.js';
import { reviewCompletedWeek, applyWeeklyReview } from '../lib/mesocycle.js';

export function completeWorkout({ store, payload }){
  const current = store || {};
  const historyBefore = current.history || [];
  const history = upsertHistory(historyBefore, payload);

  let activeSchedule = current.activeSchedule || null;
  if(activeSchedule){
    activeSchedule = {
      ...activeSchedule,
      sessions: activeSchedule.sessions.map(session=> session.id === payload.id ? { ...session, status:'done' } : session),
    };
  }

  const adaptation = activeSchedule ? adaptActiveSchedule(activeSchedule, history, {
    readinessLog: current.readinessLog || [],
    availableEquipment: current.onboarding?.equipment || [],
  }) : null;
  if(adaptation?.changed) activeSchedule = adaptation.schedule;

  let weeklyReview = null;
  try{
    const review = reviewCompletedWeek({
      schedule: activeSchedule,
      history,
      readinessLog: current.readinessLog || [],
      availableEquipment: current.onboarding?.equipment || [],
      policy: current.preferences?.progressionPolicy || 'standard',
    });
    if(review.ready && review.directives.some(d=> d.kind !== 'hold')){
      const applied = applyWeeklyReview(activeSchedule, review);
      if(applied.changed){
        activeSchedule = applied.schedule;
        weeklyReview = applied;
      }
    }
  }catch{}

  const savedSets = (payload.blocks || []).reduce((n,b)=> n + (b.sets || []).filter(s=> s.completed).length, 0);
  return {
    store: { ...current, history, activeSchedule, activeWorkout: null },
    historyBefore,
    history,
    adaptation,
    weeklyReview,
    summary: { savedSets },
  };
}
