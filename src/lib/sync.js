// sync.js — optional cross-device sync layer (offline-first preserved).
// Default: localStorage only. When sync is enabled, this mirrors export/import over a sync provider.
// Provider is a pluggable { pull, push } pair so tests stay pure.
// Conflict resolution: per-session last-write-wins via savedAt; onboarding last-write-wins via exportedAt.

import { buildExportPayload, parseImportFile, mergeStores } from "./export.js";
import { STORE_SCHEMA_VERSION } from "./store.js";
import { mergeEvaluationLedgers } from "./longitudinal.js";

export function makeSyncAdapter({ pull, push }){ return { pull, push }; }

export async function syncUp(store, adapter){
  const payload = buildExportPayload(store);
  if(adapter?.push) await adapter.push(payload);
  return payload;
}

export async function syncDown(currentStore, adapter, strategy="merge"){
  if(!adapter?.pull) return currentStore;
  const remoteText = await adapter.pull();
  if(!remoteText) return currentStore;
  const text = typeof remoteText === "string" ? remoteText : JSON.stringify(remoteText);
  const imported = parseImportFile(text);
  if(strategy==='replace') return mergeStores(currentStore, imported, 'replace');
  return mergeStoresWithConflicts(currentStore, imported);
}

// Merge with per-session conflict resolution (savedAt) and onboarding recency
export function mergeStoresWithConflicts(current, imported){
  // history: last-write-wins per id via savedAt (or dateISO fallback)
  const byId = new Map();
  const tsOf = (h)=> Date.parse(h.savedAt || h.dateISO || '1970-01-01');
  for(const h of (current.history||[])) byId.set(h.id, h);
  for(const h of (imported.history||[])){
    const existing = byId.get(h.id);
    if(!existing) byId.set(h.id, h);
    else {
      if(tsOf(h) >= tsOf(existing)) byId.set(h.id, h);
    }
  }
  // onboarding: keep current unless missing; if both present, prefer newer by presence of programHistory length or activeSchedule recency
  let onboarding = current.onboarding || imported.onboarding || null;
  // if imported has strictly newer schedule, prefer it when current has no schedule
  const activeSchedule = current.activeSchedule || imported.activeSchedule || null;
  // preferences: merge, current wins on explicit keys
  const preferences = { ...(imported.preferences||{}), ...(current.preferences||{}) };
  const eventById = new Map();
  for(const e of [...(current.eventHistory||[]), ...(imported.eventHistory||[])]) if(e?.id) eventById.set(e.id,e);
  // readinessLog: merge by dateISO+at
  const rByKey = new Map();
  for(const r of [...(current.readinessLog||[]), ...(imported.readinessLog||[])]) {
    const k = `${r.dateISO}|${r.at||r.score}`;
    if(!rByKey.has(k)) rByKey.set(k, r);
  }
  return {
    version: Math.max(STORE_SCHEMA_VERSION, current.version||1, imported.version||1),
    ...current,
    onboarding,
    activeSchedule,
    activeWorkout: current.activeWorkout || imported.activeWorkout || null,
    // Guarded comparator: an entry missing dateISO must not crash the sync.
    history: [...byId.values()].sort((a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''))),
    preferences,
    eventHistory: [...eventById.values()].sort((a,b)=> String(a.at||'').localeCompare(String(b.at||''))),
    healthSummary: current.healthSummary || imported.healthSummary || null,
    readinessLog: [...rByKey.values()].sort((a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''))),
    evaluationLedger: mergeEvaluationLedgers(current.evaluationLedger, imported.evaluationLedger),
    programHistory: [...(current.programHistory||[]), ...(imported.programHistory||[])].filter((v,i,a)=> a.findIndex(x=> x.programId===v.programId && x.version===v.version)===i),
  };
}

// Account portability: export for moving to another device/account
export function portableExport(store){
  return buildExportPayload(store);
}
export function portableImport(text, currentStore, strategy='merge'){
  const imported = parseImportFile(text);
  return strategy==='replace' ? mergeStores(currentStore, imported, 'replace') : mergeStoresWithConflicts(currentStore, imported);
}
