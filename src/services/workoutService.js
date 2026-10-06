// Application-level workout orchestration. React owns presentation state;
// this module owns the deterministic store transition after a workout save.

import { upsertHistory } from '../lib/store.js';
import { adaptActiveSchedule } from '../lib/programming.js';
import { reviewCompletedWeek, applyWeeklyReview } from '../lib/mesocycle.js';
import { attachOutcome } from '../lib/longitudinal.js';
import { recordEvent } from '../lib/telemetry.js';
import { pushToPulse } from '../lib/pulse.js';
import { integrationEnabledByBuild } from '../lib/integrations.js';
import { workoutQualityReport } from '../lib/workoutQualityReport.js';
export { cancellationPlan } from './workoutCancellationService.js';

export function completeWorkout({ store, payload }){
  const current = store || {};
  const historyBefore = current.history || [];
  const history = upsertHistory(historyBefore, payload);

  let activeSchedule = current.activeSchedule || null;
  if(activeSchedule){
    // Marking a session done is a schedule write: bump explicit revision
    // metadata so multi-device sync converges on recency, not content.
    activeSchedule = {
      ...activeSchedule,
      sessions: activeSchedule.sessions.map(session=> session.id === payload.id ? { ...session, status:'done' } : session),
      rev: (Number(activeSchedule.rev) >= 0 ? Number(activeSchedule.rev) : 0) + 1,
      updatedAt: new Date().toISOString(),
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

  // Post-workout debrief: quality vs target + recovery context, computed from
  // the SAME data the save already touched. Never throws — a debrief failure
  // must not fail the save.
  let qualityReport = null;
  try{
    qualityReport = workoutQualityReport(payload, {
      readinessLog: current.readinessLog || [],
      schedule: activeSchedule,
      historyBefore,
    });
  }catch{}

  return {
    store: { ...current, history, activeSchedule, activeWorkout: null },
    historyBefore,
    history,
    adaptation,
    weeklyReview,
    qualityReport,
    summary: { savedSets },
  };
}

export function completeWorkoutWorkflow({ store, payload, saveStartedAt = null, performanceNow = null }){
  const result = completeWorkout({ store, payload });
  const { store:next, historyBefore, history, adaptation, weeklyReview, qualityReport, summary } = result;
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
  if(qualityReport) events.push(['session:quality-computed', { sessionId:payload.id, quality:qualityReport.quality, band:qualityReport.band }]);
  return {
    ...result,
    events,
    toast:{
      title:`${payload.title} saved`,
      detail:[
        `${summary.savedSets} set${summary.savedSets===1?'':'s'}`,
        `${payload.durationMinutes} min`,
        qualityReport ? `quality ${qualityReport.quality}/100 (${qualityReport.band})` : null,
      ].filter(Boolean).join(' · '),
      note:adaptation?.changed ? 'Your next sessions were adjusted from this result.' : (qualityReport ? qualityReport.whatToChangeNext[0] : null),
    },
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
    // Three gates: the build contains the integration, the user consented,
    // and an adapter is actually injected. Any one missing means no request.
    if(integrationEnabledByBuild() && store?.preferences?.pulseEnabled && adapter){
      Promise.resolve(pushToPulse(payload, history, adapter)).then(result=>{
        const ok = result?.ok ?? Object.values(result || {}).every(value=> value?.ok !== false);
        recordEvent('pulse:sync', { sessionId:payload.id, ok, result }, { essential:false });
      }).catch(error=> recordEvent('pulse:sync', { sessionId:payload.id, ok:false, error:String(error?.message || error) }, { essential:false }));
    }
  }catch{}
}
