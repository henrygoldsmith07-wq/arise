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
import { normalizeHistoryForWrite, makeTombstone, rowTimestamp } from './domain.js';
import { reconcileStoreSnapshots } from './storeReconcile.js';
import { splitSets } from './storageRecords.js';
import { bindCanonicalLedger } from './evaluationLedgerBridge.js';

const LS_KEY = 'arise.store.v1';
const POINTER_KEY = 'arise.store.v1.pointer';
const PROFILE_ID = 'profile';
const PROGRAMME_ID = 'active';
const READINESS_ID = 'log';

let cache = null;          // hydrated monolithic store
let lastDurableStore = null; // most recent snapshot known to have committed to IndexedDB
let hydrated = false;
let hydratePromise = null;
const LEGACY_EVALUATION_KEY = 'arise.evaluation.v1';
const LEGACY_EVALUATION_ARCHIVE_KEY = `${LEGACY_EVALUATION_KEY}.archive`;
const LEGACY_EVENT_KEY = 'arise.telemetry.v2';
const LEGACY_EVENT_OLD_KEY = 'arise.telemetry.v1';
const EVENT_LIMIT = 2000;

function mergeEvaluationRows(current = [], incoming = []){
  const byId = new Map();
  for(const row of current || []) if(row?.id) byId.set(row.id, row);
  for(const row of incoming || []){
    if(!row?.id) continue;
    const existing = byId.get(row.id);
    if(!existing || (!existing.outcome && row.outcome)) byId.set(row.id, row);
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

function mergeEventRows(current = [], incoming = []){
  const byId = new Map();
  for(const row of [...(current || []), ...(incoming || [])]){
    if(!row || typeof row !== 'object' || !row.id) continue;
    if(!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((a,b)=> String(a.at || '').localeCompare(String(b.at || '')))
    .slice(-EVENT_LIMIT);
}

function legacyEventRows(){
  try{
    const parse = (key)=>{
      const raw = localStorage.getItem(key);
      if(!raw) return [];
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.events) ? parsed.events : [];
      return rows.filter(row=> row && typeof row === 'object' && typeof row.type === 'string');
    };
    return mergeEventRows(parse(LEGACY_EVENT_OLD_KEY), parse(LEGACY_EVENT_KEY));
  }catch{ return []; }
}

function cloneSnapshot(value){
  if(value == null) return value;
  try{ return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  catch{ return value; }
}

function mirrorPreferencePointer(store){
  if(!store || !hydrated) return;
  try{
    const current = lsRead();
    lsWrite({
      __ariseIdb:true,
      version:store.version || current?.version || 6,
      preferences:{ ...(current?.preferences || {}), ...(store.preferences || {}) },
    });
  }catch{}
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


const ARCHIVE_META_ID = 'archive:meta';

function tombstoneCovers(tombstones, entity, row){
  let best = null;
  for(const t of tombstones || []){
    if(!t || t.entity !== entity || t.refId !== row?.id) continue;
    const deletedAt = Date.parse(t.deletedAt || '');
    if(!Number.isFinite(deletedAt)) continue;
    if(!best || deletedAt >= Date.parse(best.deletedAt)) best = t;
  }
  return best && Date.parse(best.deletedAt) >= rowTimestamp(row);
}

/**
 * Reconcile the save's live/archived split against the archive rows already
 * on disk (another tab may have archived or restored outside this save's
 * base snapshot — archive maintenance bypasses the monolithic cache):
 * - an incoming live row newer than its archived copy wins live (edit-after-
 *   archive restores it); otherwise the archived copy wins (no resurrection);
 * - incoming archived rows union with surviving on-disk rows (no silent loss);
 * - on-disk rows covered by a newer incoming tombstone are dropped (a newer
 *   deletion is never revived by a stale save);
 * - no id ever ends up in both collections (live wins ties).
 */
export function reconcileArchiveState(liveHistory, archivedHistory, existingArchiveRows, tombstones){
  const existing = (existingArchiveRows || []).filter((r) => r?.id && r.id !== ARCHIVE_META_ID);
  const incomingArchivedById = new Map((archivedHistory || []).filter((s) => s?.id).map((s) => [s.id, s]));
  const liveById = new Map((liveHistory || []).filter((s) => s?.id).map((s) => [s.id, s]));
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const finalLive = [];
  for(const s of liveById.values()){
    const archived = existingById.get(s.id);
    if(archived && !incomingArchivedById.has(s.id) && rowTimestamp(archived) >= rowTimestamp(s) && !tombstoneCovers(tombstones, 'sessions', archived)){
      continue; // a newer-or-equal archived copy wins; the stale live row stays archived
    }
    finalLive.push(s);
  }
  const finalLiveIds = new Set(finalLive.map((s) => s.id));
  const finalArchivedById = new Map();
  for(const s of incomingArchivedById.values()){
    if(!finalLiveIds.has(s.id)) finalArchivedById.set(s.id, s);
  }
  for(const s of existingById.values()){
    if(finalLiveIds.has(s.id) || finalArchivedById.has(s.id)) continue;
    if(tombstoneCovers(tombstones, 'sessions', s)) continue;
    finalArchivedById.set(s.id, s);
  }
  const byDate = (a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''));
  return { history: finalLive.sort(byDate), archivedHistory: [...finalArchivedById.values()].sort(byDate) };
}

export function decompose(store, { existingArchive = null } = {}){
  const schedule = store.activeSchedule || null;
  const ledger = store.evaluationLedger || [];
  // Write-time normalisation: every save passes its history through the
  // canonical schema (coercions, source tags, dropped-unreadable reporting).
  // Archived history is the same session shape, normalised identically so
  // backups, sync and snapshots treat both collections with one rule.
  const { history: canonicalHistory } = normalizeHistoryForWrite(historyOf(store), { source: 'manual' });
  const { history: canonicalArchived } = normalizeHistoryForWrite(Array.isArray(store.archivedHistory) ? store.archivedHistory : [], { source: 'manual' });
  const tombstones = (store.tombstones || []).map((t) => ({ ...makeTombstone(t.entity, t.refId, { at: t.deletedAt, deviceId: t.deviceId }), id: t.id || makeTombstone(t.entity, t.refId, { at: t.deletedAt, deviceId: t.deviceId }).id }));
  const portable = existingArchive
    ? reconcileArchiveState(canonicalHistory, canonicalArchived, existingArchive, tombstones)
    : (()=> {
        const liveIds = new Set(canonicalHistory.map((s) => s?.id).filter(Boolean));
        return { history: canonicalHistory, archivedHistory: canonicalArchived.filter((s) => s?.id && !liveIds.has(s.id)) };
      })();
  return {
    // activeWorkout rides on the profile row: the crashed-session draft must
    // survive restart or the recovery dialog can never be offered (it is the
    // whole point of the draft — losing it on a save defeats crash recovery).
    profile: { id: PROFILE_ID, version: store.version || 6, onboarding: store.onboarding || null, preferences: store.preferences || {}, gymPrefs: store.gymPrefs || null, demo: store.demo === true, healthSummary: store.healthSummary || null, studyParticipantId: store.studyParticipantId || null, studyEnrollment: store.studyEnrollment || null, studyStatus: store.studyStatus || null, studyStatusChangedAtISO: store.studyStatusChangedAtISO || null, activeWorkout: store.activeWorkout ?? null },
    sessions: portable.history,
    sets: splitSets(portable.history),
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
    experiments: (store.experiments || []).filter(e => e?.id),
    tombstones,
    archive: portable.archivedHistory,
  };
}

function historyOf(store){
  // history may live at store.history (canonical in-memory contract).
  return store.history || [];
}

export async function persistStore(store, { baseStore = null, collectionMode = 'preserve', reconcileWithoutBase = false } = {}){
  let committedStore = store;
  if(baseStore || reconcileWithoutBase){
    try{
      const canonical = await loadStoreFromIdb();
      if(canonical){
        committedStore = reconcileStoreSnapshots(baseStore, store, canonical);
        if(collectionMode === 'replace'){
          committedStore = {
            ...committedStore,
            evaluationLedger:[...(store.evaluationLedger || [])],
            eventHistory:[...(store.eventHistory || [])],
          };
        }
      }
    }catch{}
  }
  // The archive store is maintained both here (portable archivedHistory) and
  // by direct maintenance (archiveOldSessions/restoreArchive bypass the
  // cache): read its current rows first so a stale save can neither resurrect
  // restored sessions nor silently drop another tab's archived work. The
  // maintenance meta row is device-local diagnostics and is preserved.
  let existingArchive = null, archiveMeta = null;
  try{
    const rows = await idbGetAll('archive');
    archiveMeta = (rows || []).find((r) => r?.id === ARCHIVE_META_ID) || null;
    existingArchive = rows || [];
  }catch{}
  const d = decompose(committedStore, { existingArchive });
  // One transaction across every touched store: a save is all-or-nothing.
  // The previous clear-then-put-per-store storm could leave stores from
  // different points in time after a mid-save crash, and recomposition then
  // silently produced a half-saved world (history without its programme,
  // ledger rows split across two stores).
  await idbTransaction(
    ['profile','sessions','sets','programme','adaptations','recommendations','outcomes','events','readiness','templates','experiments','tombstones','archive'],
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
      ops.clearStore('experiments');
      for(const e of d.experiments) ops.put('experiments', e);
      ops.clearStore('tombstones');
      for(const t of d.tombstones) ops.put('tombstones', t);
      ops.clearStore('archive');
      for(const s of d.archive) ops.put('archive', s);
      if(archiveMeta) ops.put('archive', archiveMeta);
    },
  );
  // Demote localStorage to a pointer + paint-critical prefs.
  try{
    const legacy = lsRead();
    if(legacy && !legacy.__ariseIdb){
      try{ localStorage.setItem('arise.store.v1.pre-idb-backup', JSON.stringify(legacy)); }catch{}
    }
    const currentPointer = lsRead();
    lsWrite({
      __ariseIdb: true,
      version: committedStore.version || 6,
      preferences: currentPointer?.__ariseIdb
        ? { ...(committedStore.preferences || {}), ...(currentPointer.preferences || {}) }
        : (committedStore.preferences || {}),
    });
  }catch{}
  return committedStore;
}

export async function loadStoreFromIdb(){
  const [profile, sessions, programme, adaptations, recs, outs, events, readiness, templates, experiments, tombstones, archiveRows] = await Promise.all([
    idbGet('profile', PROFILE_ID),
    idbGetAll('sessions'),
    idbGet('programme', PROGRAMME_ID),
    idbGetAll('adaptations'),
    idbGetAll('recommendations'),
    idbGetAll('outcomes'),
    idbGetAll('events'),
    idbGet('readiness', READINESS_ID),
    idbGetAll('templates'),
    idbGetAll('experiments'),
    idbGetAll('tombstones'),
    idbGetAll('archive'),
  ]);
  const liveIds = new Set((sessions || []).map((s) => s?.id).filter(Boolean));
  // Live/archived disjointness is structural: an id in both is a restore —
  // live wins so an explicit restore can never be silently re-archived.
  const archivedHistory = (archiveRows || []).filter((r) => r?.id && r.id !== ARCHIVE_META_ID && !liveIds.has(r.id));
  if(!profile && !(sessions || []).length && !archivedHistory.length) return null;
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
    gymPrefs: profile?.gymPrefs ?? null,
    demo: profile?.demo === true,
    healthSummary: profile?.healthSummary ?? null,
    studyParticipantId: profile?.studyParticipantId ?? null,
    studyEnrollment: profile?.studyEnrollment ?? null,
    studyStatus: profile?.studyStatus ?? null,
    studyStatusChangedAtISO: profile?.studyStatusChangedAtISO ?? null,
    activeWorkout: profile?.activeWorkout ?? null,
    history: sessions || [],
    archivedHistory,
    activeSchedule: schedule,
    programHistory: programme?.programHistory || [],
    eventHistory: events || [],
    readinessLog: readiness?.log || [],
    customTemplates: templates || [],
    experiments: experiments || [],
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
  lastDurableStore = fresh ? cloneSnapshot(fresh) : null;
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
      // The pointer is the synchronous preference mirror used to survive an
      // immediate reload before the async IndexedDB transaction finishes.
      // Treat it as the latest local preference intent, then fold it back into
      // the canonical store.
      try{
        const pointer = lsRead();
        if(pointer?.__ariseIdb && pointer.preferences && typeof pointer.preferences === 'object'){
          const mergedPreferences = { ...(store.preferences || {}), ...pointer.preferences };
          if(JSON.stringify(mergedPreferences) !== JSON.stringify(store.preferences || {})){
            store = { ...store, preferences:mergedPreferences };
            try{ await persistStore(store); }catch{}
          }
        }
      }catch{}
      // One-time telemetry migration: older builds kept the live event
      // ledger in localStorage. Fold it into the canonical IndexedDB snapshot
      // before any consumer reads measurements, then retire both legacy keys.
      const legacyEvents = legacyEventRows();
      if(legacyEvents.length){
        store = { ...store, eventHistory:mergeEventRows(store.eventHistory || [], legacyEvents) };
        await persistStore(store);
        try{ localStorage.removeItem(LEGACY_EVENT_KEY); localStorage.removeItem(LEGACY_EVENT_OLD_KEY); }catch{}
      }
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
    lastDurableStore = store ? cloneSnapshot(store) : null;
    hydrated = true;
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
  hydrated = false;
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
  // Other device-local Arise records are part of "all data" too. Keeping them
  // through a delete/demo transition would preserve measurements, pseudonymous
  // identity or a persisted AI credential after the training store was wiped.
  for(const key of [
    'arise.telemetry.v2', 'arise.telemetry.v1', 'arise.errors.v1',
    'arise.ai.settings.v1', 'arise.lastExportAt',
    'arise.lastFullBackupAt.v1', 'arise.backupReminderDismissedAt',
    'arise.deviceId',
  ]){ try{ localStorage.removeItem(key); }catch{} }
  try{ sessionStorage.removeItem('arise.ai.session-key.v1'); }catch{}
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
export function isStorageHydrated(){ return hydrated; }

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
export function setCachedStore(store, { persist = persistStore, collectionMode = 'preserve' } = {}){
  const optimisticBase = cache;
  // Evidence is owned by the canonical ledger path, not ordinary React state
  // snapshots. Preserve newer cached rows across generic UI saves so a stale
  // component tree cannot erase a recommendation recorded moments earlier.
  const existingEvidence = cache?.evaluationLedger || (hydrated ? legacyEvaluationRows() : []);
  const existingEvents = cache?.eventHistory || (hydrated ? legacyEventRows() : []);
  const submittedStore = {
    ...store,
    ...(collectionMode === 'preserve'
      ? {
          evaluationLedger:mergeEvaluationRows(existingEvidence, store?.evaluationLedger || []),
          eventHistory:mergeEventRows(existingEvents, store?.eventHistory || []),
        }
      : {}),
  };
  cache = submittedStore;
  mirrorPreferencePointer(submittedStore);
  const run = enqueueWrite(async()=> {
    // Resolve the three-way merge base at EXECUTION time. A previously queued
    // write may have succeeded or failed since this write was submitted.
    const durableBase = lastDurableStore;
    try{
      const committed = await persist(submittedStore, { baseStore:durableBase, collectionMode, reconcileWithoutBase:true });
      lastDurableStore = cloneSnapshot(committed);
      if(cache === submittedStore) cache = committed;
      try{ localStorage.removeItem(LEGACY_EVALUATION_KEY); }catch{}
      try{ localStorage.removeItem(LEGACY_EVENT_KEY); localStorage.removeItem(LEGACY_EVENT_OLD_KEY); }catch{}
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

bindCanonicalLedger('evaluation', {
  read(){
    return cache ? [...(cache.evaluationLedger || [])] : null;
  },
  replace(records){
    if(!cache) return false;
    // Exact local ledger snapshot (retention/override edits included), while
    // persistence still reconciles unseen rows/outcomes from another tab.
    setCachedStore({ ...cache, evaluationLedger:[...(records || [])] }, { collectionMode:'ledger-write' });
    return true;
  },
  clear(){
    if(!cache) return false;
    setCachedStore({ ...cache, evaluationLedger:[] }, { collectionMode:'replace' });
    return true;
  },
});

bindCanonicalLedger('events', {
  read(){
    return cache ? [...(cache.eventHistory || [])] : null;
  },
  replace(events){
    if(!cache) return false;
    // A telemetry write owns the exact local event snapshot, while the durable
    // reconcile still unions unseen events from another tab.
    setCachedStore({ ...cache, eventHistory:[...(events || [])] }, { collectionMode:'ledger-write' });
    return true;
  },
  clear(){
    if(!cache) return false;
    setCachedStore({ ...cache, eventHistory:[] }, { collectionMode:'replace' });
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
