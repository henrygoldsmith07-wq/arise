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

function studyLifecycleActive(store){
  return Boolean(store?.studyEnrollment) || store?.studyStatus === 'enrolled' || store?.studyStatus === 'withdrawn';
}

function enrollmentSignature(enrollment){
  if(!enrollment) return null;
  const assignments = Object.fromEntries(
    Object.entries(enrollment.assignments || {})
      .sort(([a],[b])=> a.localeCompare(b))
      .map(([id, value])=> [id, value?.arm || null]),
  );
  return JSON.stringify({
    participantId:enrollment.participantId || null,
    studyVersion:enrollment.studyVersion || null,
    seed:enrollment.seed || null,
    assignments,
  });
}

function resolveStudySyncState(current, imported){
  const currentId = current?.studyParticipantId || null;
  const importedId = imported?.studyParticipantId || null;
  const currentActive = studyLifecycleActive(current);
  const importedActive = studyLifecycleActive(imported);

  if(currentId && importedId && currentId !== importedId && currentActive && importedActive){
    throw new Error('Sync study-profile conflict: these devices belong to different enrolled/withdrawn study participants. Use separate WebDAV paths or restore the intended profile before syncing.');
  }

  let participantId = currentId || importedId || null;
  if(currentId && importedId && currentId !== importedId){
    if(currentActive) participantId = currentId;
    else if(importedActive) participantId = importedId;
    else participantId = [currentId, importedId].sort()[0];
  }

  const matches = [current, imported].filter(s=> !s?.studyParticipantId || !participantId || s.studyParticipantId === participantId);
  const enrollments = matches.map(s=> s?.studyEnrollment).filter(Boolean);
  if(enrollments.length > 1 && enrollmentSignature(enrollments[0]) !== enrollmentSignature(enrollments[1])){
    throw new Error('Sync study-enrollment conflict: the same participant has incompatible frozen arm assignments.');
  }

  const statusCandidates = matches
    .filter(s=> s?.studyStatus)
    .sort((a,b)=> (Date.parse(a.studyStatusChangedAtISO || '') || 0) - (Date.parse(b.studyStatusChangedAtISO || '') || 0));
  const statusSource = statusCandidates.at(-1) || null;
  const studyStatus = statusSource?.studyStatus || (enrollments.length ? 'enrolled' : null);
  const studyStatusChangedAtISO = statusSource?.studyStatusChangedAtISO || null;
  const studyEnrollment = studyStatus === 'withdrawn' ? null : (enrollments[0] || null);

  return { studyParticipantId:participantId, studyEnrollment, studyStatus, studyStatusChangedAtISO };
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
