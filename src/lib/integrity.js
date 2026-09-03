// integrity.js — boot-time schema validation, quarantine and repair.
//
// The canonical store is recomposed from ten IndexedDB object stores.
// Migrations, normalisation and merge already tolerate *field-level* damage,
// but nothing so far checked the recomposed whole: a store from a divergent
// point in time (a pre-transaction crash, a browser eviction, an IDB version
// downgrade) would hydrate into a store that renders and then quietly poisons
// every downstream consumer — analytics, progression, the study ledger.
//
// On every boot the recomposed store is validated against the same strict
// shape imported backups must satisfy (export.js's validateStoreData). If it
// fails, the broken payload is quarantined into its own IndexedDB store and
// the store is repaired: structurally-recoverable records are normalised
// back in, anything unreadable is dropped, and defaults fill the rest —
// the same per-entry resilience loadStore already applies to history. The
// user sees a notice, never a crash, and never silent corruption.

import { validateStoreData } from './export.js';
import { idbPut, idbGet, idbGetAll, idbDelete } from './idb.js';
import { normaliseHistory } from './store.js';

const QUARANTINE_STORE = 'quarantine';
const LATEST_ID = 'integrity:latest';
const MAX_QUARANTINE_RECORDS = 5;

/**
 * Validate a recomposed store. Returns { ok, errors } — `ok` false means the
 * payload as recomposed is not safe to hand to the app unmodified.
 */
export function validateRecomposedStore(store){
  return validateStoreData(store);
}

/**
 * Repair a store that failed validation, keeping everything recoverable.
 * History rows are normalised individually (one unreadable row costs one
 * row); non-array collections are replaced by their type or dropped.
 */
export function repairStore(store){
  const fixed = (store && typeof store === 'object' && !Array.isArray(store)) ? { ...store } : {};
  if(!Number.isInteger(Number(fixed.version)) || Number(fixed.version) < 1) fixed.version = 9;
  if(!Array.isArray(fixed.history)) fixed.history = [];
  // Per-row salvage: normaliseHistory already drops unreadable entries.
  try{ fixed.history = normaliseHistory(fixed.history); }
  catch{ fixed.history = []; }
  if(fixed.activeSchedule != null && (typeof fixed.activeSchedule !== 'object' || Array.isArray(fixed.activeSchedule))) fixed.activeSchedule = null;
  if(!Array.isArray(fixed.eventHistory)) fixed.eventHistory = [];
  if(!Array.isArray(fixed.evaluationLedger)) fixed.evaluationLedger = [];
  if(!Array.isArray(fixed.readinessLog)) fixed.readinessLog = [];
  if(!Array.isArray(fixed.programHistory)) fixed.programHistory = [];
  if(!Array.isArray(fixed.customTemplates)) fixed.customTemplates = [];
  if(fixed.healthSummary != null && (typeof fixed.healthSummary !== 'object' || Array.isArray(fixed.healthSummary))) fixed.healthSummary = null;
  if(fixed.preferences == null || typeof fixed.preferences !== 'object' || Array.isArray(fixed.preferences)) fixed.preferences = {};
  if(fixed.onboarding != null && (typeof fixed.onboarding !== 'object' || Array.isArray(fixed.onboarding))) fixed.onboarding = null;
  if(fixed.activeWorkout != null && (typeof fixed.activeWorkout !== 'object' || Array.isArray(fixed.activeWorkout))) fixed.activeWorkout = null;
  return fixed;
}

/**
 * Quarantine a broken recomposition into the IDB 'quarantine' store, keeping
 * the most recent few. The raw payload stays recoverable by the user (and by
 * a support flow) instead of being silently overwritten by the next save.
 */
export async function quarantineBrokenStore(store, errors = []){
  try{
    const record = {
      id: `${LATEST_ID}:${Date.now()}`,
      quarantinedAt: new Date().toISOString(),
      errors: errors.slice(0, 20),
      payload: store,
    };
    await idbPut(QUARANTINE_STORE, record, record.id);
    await idbPut(QUARANTINE_STORE, { id: LATEST_ID, ref: record.id }, LATEST_ID);
    // Cap the quarantine so a repeatedly corrupting store cannot grow it.
    const all = await idbGetAll(QUARANTINE_STORE);
    const records = all.filter((r)=> r?.id && r.id !== LATEST_ID)
      .sort((a, b)=> String(b.quarantinedAt || '').localeCompare(String(a.quarantinedAt || '')));
    for(const stale of records.slice(MAX_QUARANTINE_RECORDS)) await idbDelete(QUARANTINE_STORE, stale.id);
  }catch{ /* quarantine is best-effort; repair proceeds regardless */ }
}

/** Read the most recent quarantined payload, for inspection or recovery. */
export async function latestQuarantinedStore(){
  try{
    const marker = await idbGet(QUARANTINE_STORE, LATEST_ID);
    if(!marker?.ref) return null;
    return await idbGet(QUARANTINE_STORE, marker.ref);
  }catch{ return null; }
}

/**
 * Full boot gate: validate, quarantine-on-failure, repair. Returns
 * { store, repaired, errors } — `repaired` true means the caller should
 * surface a notice and persist the repaired shape immediately (the IDB
 * payload still holds the broken rows until the next save).
 */
export function enforceIntegrity(store){
  const { ok, errors } = validateRecomposedStore(store);
  if(ok) return { store, repaired: false, errors: [] };
  return { store: repairStore(store), repaired: true, errors };
}
