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
import { captureSnapshot } from './snapshots.js';
import { normalizeHistoryForWrite, makeTombstone } from './domain.js';

const LS_KEY = 'arise.store.v1';
const POINTER_KEY = 'arise.store.v1.pointer';
const PROFILE_ID = 'profile';
const PROGRAMME_ID = 'active';
const READINESS_ID = 'log';

let cache = null;          // hydrated monolithic store
let hydratePromise = null;

function lsRead(){
  try{ const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }catch{ return null; }
}
function lsWrite(value){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(value)); }catch{}
}

function splitSets(history){
  const out = [];
  for(const h of history || []){
    for(const [bi, b] of (h.blocks || []).entries()){
      for(const [si, s] of (b.sets || []).entries()){
        out.push({
          id: `${h.id}:${bi}:${si}`,
          sessionId: h.id,
          dateISO: h.dateISO,
          exerciseId: b.exerciseId,
          blockIndex: bi,
          setIndex: si,
          reps: s.reps ?? '',
          weightKg: s.weightKg ?? '',
          rpe: s.rpe ?? '',
        });
      }
    }
  }
  return out;
}

export function decompose(store){
  const schedule = store.activeSchedule || null;
  const ledger = store.evaluationLedger || [];
  // Write-time normalisation: every save passes its history through the
  // canonical schema (coercions, source tags, dropped-unreadable reporting).
  const { history: canonicalHistory } = normalizeHistoryForWrite(historyOf(store), { source: 'manual' });
  const tombstones = (store.tombstones || []).map((t) => ({ ...makeTombstone(t.entity, t.refId, { at: t.deletedAt, deviceId: t.deviceId }), id: t.id || makeTombstone(t.entity, t.refId, { at: t.deletedAt, deviceId: t.deviceId }).id }));
  return {
    profile: { id: PROFILE_ID, version: store.version || 6, onboarding: store.onboarding || null, preferences: store.preferences || {}, healthSummary: store.healthSummary || null, studyParticipantId: store.studyParticipantId || null, studyEnrollment: store.studyEnrollment || null },
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

export async function persistStore(store){
  const d = decompose(store);
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
    lsWrite({ __ariseIdb: true, version: store.version || 6, preferences: store.preferences || {} });
  }catch{}
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
      try{ await captureSnapshot({ force: Boolean(integrityNotice), reason: integrityNotice ? 'post-repair' : 'boot' }); }catch{}
    }
    cache = store || undefined;
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
  hydratePromise = null;
  integrityNotice = null;
}

// Deletion across every canonical location. `cleared` makes queued (not yet
// started) persist writes no-op, so a save in flight at tap time cannot
// resurrect the data a moment after the stores were cleared. A write already
// executing is harmless: IndexedDB serializes overlapping transactions, so
// the clear below commits after it and wins.
let cleared = false;
export async function clearAllStoredData(){
  cleared = true;
  resetHydratedCache();
  try{
    await idbTransaction([...STORES], (ops)=> { for(const s of STORES) ops.clearStore(s); });
  }catch{
    for(const s of STORES){ try{ await idbClearStore(s); }catch{} }
  }
  try{ localStorage.removeItem(POINTER_KEY); }catch{}
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
function enqueueWrite(fn){
  if(cleared) return Promise.resolve();
  const run = writeQueue.then(()=> { if(cleared) return undefined; return fn(); });
  const tracked = run.catch(()=>{});
  pendingWrites.add(tracked);
  void tracked.finally(()=> pendingWrites.delete(tracked));
  writeQueue = tracked;
  return run;
}
export function whenPersisted(){
  return Promise.all([...pendingWrites]).then(()=>{});
}
export function setCachedStore(store){
  cache = store;
  void enqueueWrite(()=> persistStore(store));
}

// Shrink the data-loss window: a save is async and a user can close the tab
// the moment a set is logged. Flush pending writes when the page hides or is
// being unloaded — the transaction makes each flush all-or-nothing.
if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
  const flush = ()=> { void whenPersisted(); };
  window.addEventListener('pagehide', flush);
  window.addEventListener('visibilitychange', ()=> { if(document.visibilityState === 'hidden') flush(); });
}
