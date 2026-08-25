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

import { idbGet, idbGetAll, idbPut, idbDelete, STORES } from './idb.js';

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
  return {
    profile: { id: PROFILE_ID, version: store.version || 6, onboarding: store.onboarding || null, preferences: store.preferences || {}, healthSummary: store.healthSummary || null },
    sessions: historyOf(store),
    sets: splitSets(historyOf(store)),
    programme: { id: PROGRAMME_ID, activeSchedule: schedule, programHistory: store.programHistory || [] },
    adaptations: (schedule?.adaptationHistory || []).map(row => ({ ...row, id: row.basisKey || `${row.dateISO}` })),
    recommendations: ledger.filter(r => !r.outcome).map(r => ({ ...r, id: r.id })),
    outcomes: ledger.filter(r => r.outcome).map(r => ({ ...r, id: r.id })),
    events: store.eventHistory || [],
    readiness: { id: READINESS_ID, log: store.readinessLog || [] },
    templates: store.customTemplates || [],
  };
}

function historyOf(store){
  // history may live at store.history (canonical in-memory contract).
  return store.history || [];
}

export async function persistStore(store){
  const d = decompose(store);
  await Promise.all([
    idbPut('profile', d.profile),
    idbDelete('sessions').then(()=> Promise.all(d.sessions.map(s => idbPut('sessions', s)))),
    idbDelete('sets').then(()=> Promise.all(d.sets.map(s => idbPut('sets', s)))),
    idbPut('programme', d.programme),
    idbDelete('adaptations').then(()=> Promise.all(d.adaptations.map(a => idbPut('adaptations', a)))),
    idbDelete('recommendations').then(()=> Promise.all(d.recommendations.map(r => idbPut('recommendations', r)))),
    idbDelete('outcomes').then(()=> Promise.all(d.outcomes.map(o => idbPut('outcomes', o)))),
    idbDelete('events').then(()=> Promise.all(d.events.map(e => idbPut('events', e)))),
    idbPut('readiness', d.readiness),
    idbDelete('templates').then(()=> Promise.all(d.templates.map(t => idbPut('templates', t)))),
  ]);
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
  const [profile, sessions, programme, adaptations, recs, outs, events, readiness, templates] = await Promise.all([
    idbGet('profile', PROFILE_ID),
    idbGetAll('sessions'),
    idbGet('programme', PROGRAMME_ID),
    idbGetAll('adaptations'),
    idbGetAll('recommendations'),
    idbGetAll('outcomes'),
    idbGetAll('events'),
    idbGet('readiness', READINESS_ID),
    idbGetAll('templates'),
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
    history: sessions || [],
    activeSchedule: schedule,
    programHistory: programme?.programHistory || [],
    eventHistory: events || [],
    readinessLog: readiness?.log || [],
    customTemplates: templates || [],
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
    await migrateLegacy();
    let store = await loadStoreFromIdb();
    if(!store){
      // Nothing in IDB yet — fall back to legacy localStorage content (or defaults)
      // so a brand-new device boots cleanly.
      const legacy = lsRead();
      store = legacy && !legacy.__ariseIdb ? legacy : null;
      if(store) await persistStore(store);
    }
    cache = store || undefined;
    return cache || null;
  })();
  return hydratePromise;
}

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
  const run = writeQueue.then(fn);
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
