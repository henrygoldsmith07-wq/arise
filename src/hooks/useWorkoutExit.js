// useWorkoutExit.js — the one workout-exit/discard contract shared by Standard
// and Guided runners.
//
// Behavioural contract (identical in both modes):
//   - exit with no logged work leaves immediately, nothing to lose;
//   - exit with logged work asks exactly once, in-app, before anything is
//     destroyed — Cancel, ✕ and Escape all funnel through the same guard;
//   - confirming calls the caller's already-confirmed onCancel exactly once.
//
// The dialog itself is presentation (WorkoutDiscardDialog); this hook owns the
// decision of WHEN to show it. Durable discard, telemetry and cross-tab
// guarantees live in App's already-confirmed discard operation.

import { useCallback, useEffect, useState } from 'react';

// The shared "is this exit lossy" predicate. Plan prefill never counts: both
// runners initialise reps/load from the schedule or history, so treating
// prefilled values as work would guard exits of untouched sessions. What
// counts is real user work: any set resolved (completed/failed/skipped), any
// user edit (typed values, added/removed rows, swaps, notes), or a restored
// draft that already carried that flag.
export function runnerHasLoggedWork(blocks, userEdited = false){
  if(userEdited) return true;
  return (blocks || []).some(b=> (b?.sets || []).some(s=> s?.completed || s?.failed || s?.skipped));
}

export function useWorkoutExit({ hasLoggedWork, onCancel }){
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const requestExit = useCallback(()=>{
    if(hasLoggedWork){ setDiscardConfirmOpen(true); return; }
    onCancel();
  },[hasLoggedWork, onCancel]);
  const keepEditing = useCallback(()=> setDiscardConfirmOpen(false), []);
  const confirmDiscard = useCallback(()=>{
    setDiscardConfirmOpen(false);
    onCancel();
  },[onCancel]);
  return { discardConfirmOpen, requestExit, keepEditing, confirmDiscard };
}
