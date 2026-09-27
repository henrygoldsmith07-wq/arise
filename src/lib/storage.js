// storage.js — canonical persistence on IndexedDB.
//
// The monolithic store shape (history[], activeSchedule, evaluationLedger, …)
// remains the in-memory contract every module consumes. This module decomposes
// it into the IDB object stores on write and recomposes it on boot:
//
//   profile      <- version/onboarding/preferences/healthSummary
//   sessions     <- history[]            (sets embedded + mirrored flattened)
//   programme    <- activeSchedule + programHistory
//   adaptations  <- schedule.adaptationHistory (mirrored rows)
//   recommendations <- ledger rows without outcomes
//   outcomes     <- ledger rows with outcomes
//   events       <- store.eventHistory snapshot
//   readiness    <- readinessLog
//   templates    <- customTemplates
//
// localStorage is demoted to a LEGACY IMPORT SOURCE: on first run after this
// migration its payload is decomposed into IDB and replaced by a tiny pointer
// ({ __ariseIdb: true }) plus a minimal preferences copy so index.html can
// still theme before first paint. Rollback = delete DB; old data pointer kept.

import { idbGet, idbGetAll, idbPut, idbDelete, idbClearStore, STORES } from './idb.js';
import { idbTransaction } from './idb-tx.js';
import { enforceIntegrity, quarantineBrokenStore } from './integrity.js';
import { normalizeHistoryForWrite, makeTombstone } from './domain.js';
import { reconcileStoreSnapshots } from './storeReconcile.js';
import { splitSets } from './storageRecords.js';
import { bindEvaluationLedgerAdapter } from './evaluationLedgerBridge.js';

const LS_KEY = 'arise.store.v1';
const POINTER_KEY = 'arise.store.v1.pointer';
const PROFILE_ID = 'profile';
const PROGRAMME_ID = 'active';
const READINESS_ID = 'log';

let cache = null;          // hydrated monolithic store
let lastDurableStore = null; // most recent snapshot known to have committed to IndexedDB
let hydratePromise = null;
const LEGACY_EVALUATION_KEY = 'arise.evaluation.v1';
const LEGACY_EVALUATION_ARCHIVE_KEY = `${LEGACY_EVALUATION_KEY}.archive`;

function mergeEvaluationRows(current = [], incoming = []){
  const byId = new Map();
  for(const row of current || []) if(row?.id) byId.set(row.id, row);
  for(const row of incoming || []){
    if(!row?.id) continue;
    const existing = byId.get(row.id);
    if(!existing || (!existing.outcome && row.outcome) || (!!existing.outcome === !!row.outcome)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function legacyEvaluationRows(){
  try{
    const raw = localStorage.getItem(LEGACY_EVALUATION_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
    return rows.filter(row=> row && typeof row === 'object');
  }catch{ return []; }
}

const commitListeners = new Set();
export function subscribeStoreCommits(listener){
  if(typeof listener !== 'function') return ()=>{};
  commitListeners.add(listener);
  return ()=> commitListeners.delete(listener);
}
function notifyStoreCommitted(reason){
  for(const listener of [...commitListeners]){ try{ listener(reason); }catch{} }
}

function lsRead(){
  try{ const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }catch{ return null; }
}
function lsWrite(value){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(value)); }catch{}
}


export function decompose(store){
  const schedule = store.activeSchedule || null;
  const ledger = store.evaluationLedger || [];
  // Write-time normalisation: every save passes its history through the
  // canonical schema (coercions, source tags, dropped-unreadable reporting).
  const { history: canonicalHistory } = normalizeHistoryForWrite(historyOf(store), { source: 'manual' });
  const tombstones = (store.tombstones || []).map((t) => ({ ...makeTombstone(t.entity, t.refId, { at: t.deletedAt, deviceId: t.deviceId }), id: t.id || makeTombstone(t.entity, t.refId, { at: t.deletedAt, deviceId: t.deviceId }).id }));
  return {
    // activeWorkout rides on the profile row: the crashed-session draft must
    // survive restart or the recovery dialog can never be offered (it is the
    // whole point of the draft — losing it on a save defeats crash recovery).
    profile: { id: PROFILE_ID, version: store.version || 6, onboarding: store.onboarding || null, preferences: store.preferences || {}, healthSummary: store.healthSummary || null, studyParticipantId: store.studyParticipantId || null, studyEnrollment: store.studyEnrollment || null, studyStatus: store.studyStatus || null, studyStatusChangedAtISO: store.studyStatusChangedAtISO || null, activeWorkout: store.activeWorkout ?? null },
    sessions: canonicalHistory,
    sets: splitSets(canonicalHistory),
    programme: { id: PROGRAMME_ID, activeSchedule: schedule, programHistory: store.programHistory || [] },
    adaptations: (schedule?.adaptationHistory || []).map(row => ({ ...row, id: row.basisKey || `${row.dateISO}` })),
    recommendations: ledger.filter(r => !r.outcome).map(r => ({ ...r, id: r.id })),
    outcomes: ledger.filter(r => r.outcome).map(r => ({ ...r, id: r.id })),
    events: store.eventHistory || [],
    readiness: { id: READINESS_ID, log: store.readinessLog || [] },
    // Soft-deleted templates stay in the store (deletedAt on the row) so the
    // deletion is recoverable locally; consumers filter on deletedAt, and
    // tombstones carry the deletion to other devices at sync time.
    templates: store.customTemplates || [],
    tombstones,
  };
}

function historyOf(store){
  // history may live at store.history (canonical in-memory contract).
  return store.history || [];
}

export async function persistStore(store, { baseStore = null } = {}){
  let committedStore = store;
  if(baseStore){
    try{
      const canonical = await loadStoreFromIdb();
      committedStore = reconcileStoreSnapshots(baseStore, store, canonical);
    }catch{}
  }
  const d = decompose(committedStore);
  // One transaction across every touched store: a save is all-or-nothing.
  // The previous clear-then-put-per-store storm could leave stores from
  // different points in time after a mid-save crash, and recomposition then
  // silently produced a half-saved world (history without its programme,
  // ledger rows split across two stores).
  await idbTransaction(
    ['profile','sessions','sets','programme','adaptations','recommendations','outcomes','events','readiness','templates','tombstones'],
    (ops)=> {
      ops.put('profile', d.profile);
      ops.clearStore('sessions');
      for(const s of d.sessions) ops.put('sessions', s);
      ops.clearStore('sets');
      for(const s of d.sets) ops.put('sets', s);
      ops.put('programme', d.programme);
      ops.clearStore('adaptations');
      for(const a of d.adaptations) ops.put('adaptations', a);
      ops.clearStore('recommendations');
      for(const r of d.recommendations) ops.put('recommendations', r);
      ops.clearStore('outcomes');
      for(const o of d.outcomes) ops.put('outcomes', o);
      ops.clearStore('events');
      for(const e of d.events) ops.put('events', e);
      ops.put('readiness', d.readiness);
      ops.clearStore('templates');
      for(const t of d.templates) ops.put('templates', t);
      ops.clearStore('tombstones');
      for(const t of d.tombstones) ops.put('tombstones', t);
    },
  );
  // Demote localStorage to a pointer + paint-critical prefs.
  try{
    const legacy = lsRead();
    if(legacy && !legacy.__ariseIdb){
      try{ localStorage.setItem('arise.store.v1.pre-idb-backup', JSON.stringify(legacy)); }catch{}
    }
    lsWrite({ __ariseIdb: true, version: committedStore.version || 6, preferences: committedStore.preferences || {} });
  }catch{}
  return committedStore;
}

export async function loadStoreFromIdb(){
  const [profile, sessions, programme, adaptations, recs, outs, events, readiness, templates, tombstones] = await Promise.all([
    idbGet('profile', PROFILE_ID),
    idbGetAll('sessions'),
    idbGet('programme', PROGRAMME_ID),
    idbGetAll('adaptations'),
    idbGetAll('recommendations'),
    idbGetAll('outcomes'),
    idbGetAll('events'),
    idbGet('readiness', READINESS_ID),
    idbGetAll('templates'),
    idbGetAll('tombstones'),
  ]);
  if(!profile && !(sessions || []).length) return null;
  const schedule = programme?.activeSchedule || null;
  if(schedule){
    schedule.adaptationHistory = adaptations || [];
  }
  const ledgerMap = new Map();
  for(const r of [...(recs || []), ...(outs || [])]){
    const existing = ledgerMap.get(r.id);
    if(!existing || (!existing.outcome && r.outcome)) ledgerMap.set(r.id, r);
  }
  return {
    version: profile?.version || 6,
    onboarding: profile?.onboarding ?? null,
    preferences: profile?.preferences ?? {},
    healthSummary: profile?.healthSummary ?? null,
    studyParticipantId: profile?.studyParticipantId ?? null,
    studyEnrollment: profile?.studyEnrollment ?? null,
    studyStatus: profile?.studyStatus ?? null,
    studyStatusChangedAtISO: profile?.studyStatusChangedAtISO ?? null,
    activeWorkout: profile?.activeWorkout ?? null,
    history: sessions || [],
    activeSchedule: schedule,
    programHistory: programme?.programHistory || [],
    eventHistory: events || [],
    readinessLog: readiness?.log || [],
    customTemplates: templates || [],
    tombstones: tombstones || [],
    evaluationLedger: [...ledgerMap.values()],
  };
}

// True canonical refresh for another-tab invalidation. Unlike loadStore(),
// this bypasses the hydrated process cache and replaces it with a fresh IDB
// recomposition without writing anything back.
export async function refreshCachedStoreFromIdb(){
  const fresh = await loadStoreFromIdb();
  cache = fresh || undefined;
  lastDurableStore = fresh || null;
  return fresh || null;
}

// One-time import from the legacy localStorage payload.
async function migrateLegacy(){
  const pointer = (()=> { try{ return JSON.parse(localStorage.getItem(POINTER_KEY) || 'null'); }catch{ return null; } })();
  if(pointer?.migrated) return;
  const legacy = lsRead();
  if(legacy && !legacy.__ariseIdb){
    await persistStore(legacy);
  }
  try{ localStorage.setItem(POINTER_KEY, JSON.stringify({ migrated: true, at: new Date().toISOString() })); }catch{}
}


// Hydrate the process-wide cache exactly once, before first render.
export function hydrateStorage(){
  if(hydratePromise) return hydratePromise;
  hydratePromise = (async ()=>{
    cleared = false; // a re-hydrate after deliberate clearing starts fresh
    await migrateLegacy();
    let store = await loadStoreFromIdb();
    if(!store){
      // Nothing in IDB yet — fall back to legacy localStorage content (or defaults)
      // so a brand-new device boots cleanly.
      const legacy = lsRead();
      store = legacy && !legacy.__ariseIdb ? legacy : null;
      if(store) await persistStore(store);
    }
    if(store){
      // One-time evidence migration: older builds kept the live evaluation
      // ledger in localStorage. Merge it into the IndexedDB-backed store, then
      // remove the legacy live key only after the canonical write succeeds.
      const legacyLedger = legacyEvaluationRows();
      if(legacyLedger.length){
        const mergedLedger = mergeEvaluationRows(store.evaluationLedger || [], legacyLedger);
        store = { ...store, evaluationLedger: mergedLedger };
        await persistStore(store);
        try{ localStorage.removeItem(LEGACY_EVALUATION_KEY); }catch{}
      }
      // Boot gate: the recomposed whole must satisfy the same strict schema
      // imported backups do. A failed check is quarantined (recoverable) and
      // repaired (defaults + per-row salvage) rather than handed to the app.
      const checked = enforceIntegrity(store);
      if(checked.repaired){
        await quarantineBrokenStore(store, checked.errors);
        store = checked.store;
        // Persist the repair immediately so the broken shape cannot hydrate
        // again on the next boot.
        try{ await persistStore(store); }catch{}
        integrityNotice = {
          at: new Date().toISOString(),
          errors: checked.errors.slice(0, 5),
        };
      }
      // Automatic local backup: a last-known-good snapshot at every boot
      // (rate-limited by snapshots.js), forced past the rate limit right
      // after a repair so the repaired state itself becomes recoverable.
      try{
        const { captureSnapshot } = await import('./snapshots.js');
        await captureSnapshot({ force: Boolean(integrityNotice), reason: integrityNotice ? 'post-repair' : 'boot' });
      }catch{}
    }
    cache = store || undefined;
    lastDurableStore = store || null;
    return cache || null;
  })();
  return hydratePromise;
}

// Set when boot validation had to quarantine + repair; the app surfaces it
// once (More → Data) so recovery is visible instead of silent.
let integrityNotice = null;
export function getIntegrityNotice(){ return integrityNotice; }
export function clearIntegrityNotice(){ integrityNotice = null; }

// Full reset (account deletion, restore-from-scratch): forget the hydrated
// cache and the one-time migration marker so the next boot starts clean.
export function resetHydratedCache(){
  cache = undefined;
  lastDurableStore = null;
  hydratePromise = null;
  integrityNotice = null;
  persistenceError = null;
}

// Deletion across every canonical location. `cleared` makes queued (not yet
// started) persist writes no-op, so a save in flight at tap time cannot
// resurrect the data a moment after the stores were cleared. A write already
// executing is harmless: IndexedDB serializes overlapping transactions, so
// the clear below commits after it and wins. Demo transitions may preserve the
// snapshot store so the explicitly captured pre-demo safety copy survives the
// wipe; full deletion keeps the default and removes snapshots too.
let cleared = false;
export async function clearAllStoredData({
  preserveSnapshots = false,
  transaction = idbTransaction,
  clearStore = idbClearStore,
  readAll = idbGetAll,
} = {}){
  cleared = true;
  resetHydratedCache();
  const storesToClear = preserveSnapshots ? STORES.filter((name)=> name !== 'snapshots') : [...STORES];
  let transactionError = null;
  try{
    await transaction(storesToClear, (ops)=> { for(const s of storesToClear) ops.clearStore(s); });
  }catch(err){
    transactionError = err;
    const failures = [];
    for(const s of storesToClear){
      try{ await clearStore(s); }catch(clearErr){ failures.push({ store:s, error:clearErr }); }
    }
    const remaining = [];
    for(const s of storesToClear){
      try{
        const rows = await readAll(s);
        if((rows || []).length) remaining.push(s);
      }catch(readErr){
        failures.push({ store:s, error:readErr });
      }
    }
    if(failures.length || remaining.length){
      const detail = [
        transactionError ? `transaction: ${String(transactionError?.message || transactionError)}` : null,
        failures.length ? `fallback failures: ${failures.map(item=> item.store).join(', ')}` : null,
        remaining.length ? `not empty: ${remaining.join(', ')}` : null,
      ].filter(Boolean).join('; ');
      throw new Error(`Could not verify that all requested device data was cleared (${detail}).`);
    }
  }
  // The legacy localStorage payload is a live import source at every boot
  // until the pointer marks the migration done — leaving it here would
  // resurrect the wiped data on the very next boot (the demo-exit bug).
  try{ localStorage.removeItem(LS_KEY); }catch{}
  try{ localStorage.removeItem('arise.store.v1.pre-idb-backup'); }catch{}
  try{ localStorage.removeItem('arise.store.v1.corrupt'); }catch{}
  try{ localStorage.removeItem(POINTER_KEY); }catch{}
  // Legacy evaluation data predates IndexedDB-canonical evidence. It must be
  // removed on deletion/demo reset or a later hydration could re-import it.
  try{ localStorage.removeItem(LEGACY_EVALUATION_KEY); }catch{}
  try{ localStorage.removeItem(LEGACY_EVALUATION_ARCHIVE_KEY); }catch{}
  try{ localStorage.removeItem('arise.feedback.v1'); }catch{}
  try{ localStorage.removeItem('arise.classifier.settings.v1'); }catch{}
  try{ localStorage.removeItem('arise.classifier.feedback.settings.v1'); }catch{}
  try{ localStorage.removeItem('arise.classifier.coach-routing.settings.v1'); }catch{}
}

export function isCleared(){ return cleared; }

// ── Sync-facing surface backed by the cache ─────────────────────────────

export function getCachedStore(){
  return cache ?? null;
}

// Writes are serialized (a clear-then-put storm from a fast save must never
// interleave with the next save's) and tracked, so callers — and tests — can
// await durability instead of racing fire-and-forget puts. The app can also
// flush on visibilitychange/beforeunload to shrink the data-loss window.
let writeQueue = Promise.resolve();
const pendingWrites = new Set();
let persistenceError = null;
function enqueueWrite(fn){
  if(cleared) return Promise.resolve();
  const run = writeQueue.then(async()=> {
    if(cleared) return undefined;
    try{
      const result = await fn();
      persistenceError = null;
      return result;
    }catch(err){
      persistenceError = err instanceof Error ? err : new Error(String(err || 'Storage write failed.'));
      throw persistenceError;
    }
  });
  // Keep the serialization chain alive after a failed write so a later retry
  // can still commit. The original promise remains rejecting for callers that
  // explicitly await durability.
  writeQueue = run.catch(()=>{});
  pendingWrites.add(run);
  void run.finally(()=> pendingWrites.delete(run)).catch(()=>{});
  return run;
}
export async function whenPersisted(){
  // A caller may enqueue another write while the current queue is draining.
  // Follow the queue until it is stable, then surface the latest durable-write
  // failure instead of converting it into a false success.
  let observed;
  do{
    observed = writeQueue;
    await observed;
  }while(observed !== writeQueue);
  if(persistenceError) throw persistenceError;
}
export function setCachedStore(store, { persist = persistStore, evaluationLedgerMode = 'preserve' } = {}){
  const optimisticBase = cache;
  // Evidence is owned by the canonical ledger path, not ordinary React state
  // snapshots. Preserve newer cached rows across generic UI saves so a stale
  // component tree cannot erase a recommendation recorded moments earlier.
  const submittedStore = evaluationLedgerMode === 'replace'
    ? store
    : {
        ...store,
        evaluationLedger: mergeEvaluationRows(cache?.evaluationLedger || [], store?.evaluationLedger || []),
      };
  cache = submittedStore;
  const run = enqueueWrite(async()=> {
    // Resolve the three-way merge base at EXECUTION time. A previously queued
    // write may have succeeded or failed since this write was submitted.
    const durableBase = lastDurableStore;
    try{
      const committed = await persist(submittedStore, { baseStore: durableBase });
      lastDurableStore = committed;
      if(cache === submittedStore) cache = committed;
      notifyStoreCommitted('store-write');
      return committed;
    }catch(err){
      // Roll back only when this failed snapshot is still the optimistic head.
      // A newer local submission remains visible and will reconcile against
      // lastDurableStore when its turn arrives.
      if(cache === submittedStore) cache = lastDurableStore || optimisticBase;
      throw err;
    }
  });
  void run.catch(()=>{});
  return run;
}

bindEvaluationLedgerAdapter({
  read(){
    return cache ? [...(cache.evaluationLedger || [])] : null;
  },
  replace(records){
    if(!cache) return false;
    setCachedStore({ ...cache, evaluationLedger:[...(records || [])] }, { evaluationLedgerMode:'replace' });
    return true;
  },
  clear(){
    if(!cache) return false;
    setCachedStore({ ...cache, evaluationLedger:[] }, { evaluationLedgerMode:'replace' });
    return true;
  },
});

// Shrink the data-loss window: a save is async and a user can close the tab
// the moment a set is logged. Flush pending writes when the page hides or is
// being unloaded — the transaction makes each flush all-or-nothing.
if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
  const flush = ()=> { void whenPersisted().catch(()=>{}); };
  const flushWhenHidden = ()=> { if(document.visibilityState === 'hidden') flush(); };
  window.addEventListener('pagehide', flush);
  window.addEventListener('visibilitychange', flushWhenHidden);
}
