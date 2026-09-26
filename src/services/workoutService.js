// Application-level workout orchestration. React owns presentation state;
// this module owns the deterministic store transition after a workout save.

import { upsertHistory } from '../lib/store.js';
import { adaptActiveSchedule } from '../lib/programming.js';
import { reviewCompletedWeek, applyWeeklyReview } from '../lib/mesocycle.js';
import { attachOutcome } from '../lib/longitudinal.js';
import { recordEvent } from '../lib/telemetry.js';
import { pushToPulse } from '../lib/pulse.js';

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

export function completeWorkoutWorkflow({ store, payload, saveStartedAt = null, performanceNow = null }){
  const result = completeWorkout({ store, payload });
  const { store:next, historyBefore, history, adaptation, weeklyReview, summary } = result;
  try{
    attachOutcome({
      sessionId:payload.id,
      dateISO:payload.dateISO,
      blocks:payload.blocks,
      historyBefore,
      sessionMeta:payload,
      preferences:next.preferences?.telemetryEnabled === true ? { telemetryEnabled:true } : null,
    });
  }catch{}

  const events = [
    ['session:complete', { sessionId:payload.id, blocks:(payload.blocks || []).length }],
  ];
  const saveFinishedAt = typeof performanceNow === 'function' ? performanceNow() : performanceNow;
  if(saveStartedAt != null && typeof saveFinishedAt === 'number'){
    events.push(['session:save', { sessionId:payload.id, blocks:(payload.blocks || []).length, durationMs:Math.max(0, Math.round(saveFinishedAt - saveStartedAt)) }]);
  }
  if(adaptation?.changed) events.push(['programme:adapt', { sessionId:payload.id, changes:adaptation.changes, decision:adaptation.decision }]);
  if(weeklyReview?.changed) events.push(['programme:weekly-review', { basisWeek:weeklyReview.entry.basisKey, changes:weeklyReview.changes }]);
  return {
    ...result,
    events,
    toast:{
      title:`${payload.title} saved`,
      detail:[`${summary.savedSets} set${summary.savedSets===1?'':'s'}`, `${payload.durationMinutes} min`].join(' · '),
      note:adaptation?.changed ? 'Your next sessions were adjusted from this result.' : null,
    },
  };
}

export function cancellationPlan({ store, activeSession, now = Date.now() }){
  const draft = store?.activeWorkout || null;
  const sets = (draft?.blocks || []).flatMap(block=> block?.sets || []);
  const completedSets = sets.filter(set=> set?.completed).length;
  const totalSets = sets.length;
  const startedAt = draft?.startedAt ? Date.parse(draft.startedAt) : null;
  return {
    completedSets,
    totalSets,
    requiresConfirmation:Boolean(activeSession && completedSets > 0),
    nextStore:{ ...(store || {}), activeWorkout:null },
    event:activeSession ? {
      type:'session:abandon',
      payload:{
        sessionId:activeSession.id,
        totalSets,
        completedSets,
        elapsedMs:Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null,
      },
    } : null,
  };
}

export function recordWorkoutEvents(events){
  for(const [type,payload] of events || []){
    try{ recordEvent(type, payload); }catch{}
  }
}

export function runPostSaveIntegrations({ store, payload, history, setStore }){
  void import('../lib/autoSync.js')
    .then(({ autoSyncAfterSave })=> autoSyncAfterSave({ store, setStore }))
    .catch(()=>{});
  try{
    const adapter = typeof window !== 'undefined' ? window.__PULSE_ADAPTER__ : null;
    if(store?.preferences?.pulseEnabled && adapter){
      Promise.resolve(pushToPulse(payload, history, adapter)).then(result=>{
        const ok = result?.ok ?? Object.values(result || {}).every(value=> value?.ok !== false);
        recordEvent('pulse:sync', { sessionId:payload.id, ok, result }, { essential:false });
      }).catch(error=> recordEvent('pulse:sync', { sessionId:payload.id, ok:false, error:String(error?.message || error) }, { essential:false }));
    }
  }catch{}
}
