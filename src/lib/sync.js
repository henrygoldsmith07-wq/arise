// sync.js — optional cross-device sync layer (offline-first preserved).
// IndexedDB remains canonical locally; sync mirrors the portable store over a
// user-owned provider. Provider is a pluggable { pull, push } pair so tests stay pure.
// WebDAV ingestion is trusted Arise-to-Arise transport: it preserves recorded
// evidence provenance while still stripping device-local consent/credentials.

import { buildExportPayload, parseImportFile, parseTrustedSyncFile, mergeStores } from "./export.js";
import { STORE_SCHEMA_VERSION, mergeCustomTemplates } from "./store.js";
import { mergeEvaluationLedgers } from "./longitudinal.js";
import { applyTombstones, isTombstone } from "./domain.js";

export function makeSyncAdapter({ pull, push }){ return { pull, push }; }

export async function syncUp(store, adapter){
  const payload = buildExportPayload(store);
  if(adapter?.push) await adapter.push(payload);
  return payload;
}

export async function syncDown(currentStore, adapter, strategy="merge"){
  if(!adapter?.pull) return currentStore;
  const remoteRaw = await adapter.pull();
  if(!remoteRaw) return currentStore;
  // The transport is byte-native; sealed payloads are decrypted upstream in
  // runSync. A raw byte pull that reaches syncDown is plaintext JSON.
  const text = typeof remoteRaw === "string" ? remoteRaw
    : remoteRaw instanceof Uint8Array ? new TextDecoder().decode(remoteRaw)
    : JSON.stringify(remoteRaw);
  const imported = parseTrustedSyncFile(text);
  if(strategy==='replace') return mergeStores(currentStore, imported, 'replace');
  return mergeStoresWithConflicts(currentStore, imported);
}

const studyActive = store => Boolean(store?.studyEnrollment) || ['enrolled','withdrawn'].includes(store?.studyStatus);
const enrollmentSignature = e => e ? JSON.stringify([
  e.studyVersion || null,
  e.seed || null,
  Object.entries(e.assignments || {}).sort(([a],[b])=> a.localeCompare(b)).map(([id,v])=> [id,v?.arm || null]),
]) : null;

function resolveStudySyncState(current, imported){
  const aId=current?.studyParticipantId||null, bId=imported?.studyParticipantId||null;
  const aActive=studyActive(current), bActive=studyActive(imported);
  if(aId && bId && aId!==bId && aActive && bActive){
    throw new Error('Sync study-profile conflict: these devices belong to different enrolled/withdrawn study participants. Use separate WebDAV paths or restore the intended profile before syncing.');
  }
  const studyParticipantId = aId===bId ? aId
    : aActive ? aId
    : bActive ? bId
    : [aId,bId].filter(Boolean).sort()[0] || null;
  const matches=[current,imported].filter(s=> !s?.studyParticipantId || s.studyParticipantId===studyParticipantId);
  const enrollments=matches.map(s=>s?.studyEnrollment).filter(Boolean);
  if(enrollments.length>1 && enrollmentSignature(enrollments[0])!==enrollmentSignature(enrollments[1])){
    throw new Error('Sync study-enrollment conflict: the same participant has incompatible frozen arm assignments.');
  }
  const statusSource=matches.filter(s=>s?.studyStatus).sort((a,b)=>
    (Date.parse(a.studyStatusChangedAtISO||'')||0)-(Date.parse(b.studyStatusChangedAtISO||'')||0)).at(-1);
  const studyStatus=statusSource?.studyStatus || (enrollments.length ? 'enrolled' : null);
  return {
    studyParticipantId,
    studyEnrollment:studyStatus==='withdrawn' ? null : (enrollments[0]||null),
    studyStatus,
    studyStatusChangedAtISO:statusSource?.studyStatusChangedAtISO||null,
  };
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
  // Deletions propagate: a tombstone removes the row from BOTH sides unless
  // the local copy was written after the deletion (an offline edit wins).
  const tombstones = [...(current.tombstones||[]), ...(imported.tombstones||[])
    .filter((t) => isTombstone(t) && !(current.tombstones||[]).some((c) => c.id === t.id))];
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
  const study = resolveStudySyncState(current, imported);
  return {
    version: Math.max(STORE_SCHEMA_VERSION, current.version||1, imported.version||1),
    ...current,
    onboarding,
    activeSchedule,
    activeWorkout: current.activeWorkout || imported.activeWorkout || null,
    // Guarded comparator: an entry missing dateISO must not crash the sync.
    history: applyTombstones([...byId.values()].sort((a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''))), tombstones),
    preferences,
    gymPrefs: {
      ...(imported.gymPrefs || {}),
      ...(current.gymPrefs || {}),
      restPresets:{
        ...(imported.gymPrefs?.restPresets || {}),
        ...(current.gymPrefs?.restPresets || {}),
      },
    },
    ...study,
    eventHistory: [...eventById.values()].sort((a,b)=> String(a.at||'').localeCompare(String(b.at||''))),
    healthSummary: current.healthSummary || imported.healthSummary || null,
    readinessLog: [...rByKey.values()].sort((a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''))),
    evaluationLedger: mergeEvaluationLedgers(current.evaluationLedger, imported.evaluationLedger),
    customTemplates: applyTombstones(mergeCustomTemplates(current.customTemplates, imported.customTemplates), tombstones),
    programHistory: [...(current.programHistory||[]), ...(imported.programHistory||[])].filter((v,i,a)=> a.findIndex(x=> x.programId===v.programId && x.version===v.version)===i),
    tombstones: [...(current.tombstones||[]), ...(imported.tombstones||[])].filter((v,i,a)=> a.findIndex(x=> x.id===v.id)===i),
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
