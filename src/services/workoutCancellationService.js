// Lightweight workout-cancel planning. Kept separate from workoutService so
// App's boot path does not need the programming/mesocycle/longitudinal graph
// that is only required when a workout is actually saved.

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
