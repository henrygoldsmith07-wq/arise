// experimentService.js — application-service wrapper for training experiments.
//
// Same shape as programmeService: pure functions that take the canonical
// store and return the NEXT store (the view does setStore(result.store)).
// All heavy lifting lives in trainingExperiments.js; this layer only wires
// store state and the tombstone ledger. The live evaluation is computed on
// demand by the UI and is never persisted — the row records the claim, the
// history provides the measurement.

import { createExperiment, concludeExperiment, cancelExperiment, suggestExperiment, markExperimentDeleted } from '../lib/trainingExperiments.js';
import { localDateISO } from '../lib/dateOnly.js';
import { makeTombstone } from '../lib/domain.js';

const MAX_ACTIVE = 2;

/** The one suggestion the data already supports, or null. */
export function suggestNextExperiment({ store = null, exerciseId = null, plateau = null } = {}){
  return suggestExperiment({
    history: store?.history || [],
    plateau,
    exerciseId,
  });
}

export function startExperiment(store, spec, { todayISO = null } = {}){
  const existing = store.experiments || [];
  const activeCount = existing.filter(e=> !e.deletedAt && e.status === 'active').length;
  if(activeCount >= MAX_ACTIVE){
    throw new Error(`Only ${MAX_ACTIVE} experiments can run at once — conclude or cancel one first.`);
  }
  // todayISO is a test/determinism seam (mirrors concludeExperiment's `today`):
  // production always starts an experiment today.
  const row = createExperiment(spec, existing, { createdAtISO: todayISO || localDateISO() });
  return { experiment: row, store:{ ...store, experiments:[...existing, row] } };
}

export function concludeExperimentById(store, id, { note = null } = {}){
  const target = (store.experiments || []).find(e=> e?.id === id && !e.deletedAt);
  if(!target) return { store, concluded:false };
  if(target.status !== 'active') return { store, concluded:false };
  const concluded = concludeExperiment(target, store.history || [], { today: localDateISO(), note });
  const { evaluation, ...row } = concluded;
  return {
    concluded:true,
    result: row.result,
    conclusion: row.conclusionNote,
    // evaluation is displayed by the caller but stays out of the store.
    evaluation,
    store:{ ...store, experiments:(store.experiments || []).map(e=> e?.id === id ? row : e) },
  };
}

export function cancelExperimentById(store, id, { note = null } = {}){
  const target = (store.experiments || []).find(e=> e?.id === id && !e.deletedAt);
  if(!target) return { store, cancelled:false };
  if(target.status !== 'active') return { store, cancelled:false };
  const cancelled = cancelExperiment(target, { today: localDateISO(), note });
  return {
    cancelled:true,
    conclusion: cancelled.conclusionNote,
    store:{ ...store, experiments:(store.experiments || []).map(e=> e?.id === id ? cancelled : e) },
  };
}

// Soft delete mirrors customTemplates: the row stays recoverable (the UI can
// offer undo) and a tombstone records the deletion for future sync.
export function deleteExperiment(store, id){
  const target = (store.experiments || []).find(e=> e?.id === id);
  if(!target || target.deletedAt) return { store, deleted:false };
  const tombstone = makeTombstone('experiments', id, { deviceId:undefined });
  return {
    deleted:true,
    store:{
      ...store,
      experiments:(store.experiments || []).map(e=> e?.id === id ? markExperimentDeleted(e) : e),
      tombstones:[...(store.tombstones || []).filter(t=> t.refId !== id), tombstone],
    },
  };
}

export function restoreExperiment(store, id){
  if(!(store.experiments || []).some(e=> e?.id === id && e.deletedAt)) return { store, restored:false };
  return {
    restored:true,
    store:{
      ...store,
      experiments:(store.experiments || []).map(e=> e?.id === id ? { ...e, deletedAt:null } : e),
      tombstones:(store.tombstones || []).filter(t=> t.refId !== id),
    },
  };
}
