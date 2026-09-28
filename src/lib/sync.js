// sync.js — optional cross-device sync layer (offline-first preserved).
// IndexedDB remains canonical locally; sync mirrors the portable store over a
// user-owned provider. Provider is a pluggable { pull, push } pair so tests stay pure.
// WebDAV ingestion is trusted Arise-to-Arise transport: it preserves recorded
// evidence provenance while still stripping device-local consent/credentials.

import { buildExportPayload, parseImportFile, mergeStores } from "./export.js";
import { STORE_SCHEMA_VERSION, mergeCustomTemplates } from "./store.js";
import { mergeEvaluationLedgers } from "./longitudinal.js";
import { applyTombstones, isTombstone } from "./domain.js";



export async function syncUp(store, adapter){
  const payload=buildExportPayload(store);
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
  const imported = parseImportFile(text, true);
  if(strategy==='replace') return mergeStores(currentStore, imported, 'replace');
  return mergeStoresWithConflicts(currentStore, imported);
}

const unionBy=(rows,key)=>[...new Map(rows.map(v=>[key(v),v])).values()];
const studyActive = s => Boolean(s?.studyEnrollment) || s?.studyStatus==='enrolled' || s?.studyStatus==='withdrawn';
const armSignature=e=>JSON.stringify([e?.studyVersion||null,e?.seed||null,...Object.keys(e?.assignments||{}).sort().map(id=>[id,e.assignments[id]?.arm])]);

function resolveStudySyncState(current, imported){
  const a=current?.studyParticipantId||null, b=imported?.studyParticipantId||null;
  const aa=studyActive(current), ba=studyActive(imported);
  if(a && b && a!==b && aa && ba) throw new Error('Sync study-profile conflict.');
  const id=a===b?a:aa?a:ba?b:a&&b?(a<b?a:b):a||b;
  const matches=[current,imported].filter(s=>!s?.studyParticipantId || s.studyParticipantId===id);
  const enrollments=matches.map(s=>s?.studyEnrollment).filter(Boolean);
  if(enrollments[1] && armSignature(enrollments[0])!==armSignature(enrollments[1])){
    throw new Error('Sync study-enrollment conflict.');
  }
  const statusSource=matches.filter(s=>s?.studyStatus).sort((a,b)=>String(a.studyStatusChangedAtISO||'').localeCompare(String(b.studyStatusChangedAtISO||''))).at(-1);
  const studyStatus=statusSource?.studyStatus || (enrollments.length ? 'enrolled' : null);
  return {
    studyParticipantId:id,
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
  const events=unionBy([...(current.eventHistory||[]), ...(imported.eventHistory||[])].filter(e=>e?.id), e=>e.id);
  const readiness=unionBy([...(imported.readinessLog||[]), ...(current.readinessLog||[])], r=>`${r.dateISO}|${r.at||r.score}`);
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
    gymPrefs:{ ...imported.gymPrefs, ...current.gymPrefs, restPresets:{ ...imported.gymPrefs?.restPresets, ...current.gymPrefs?.restPresets } },
    ...study,
    eventHistory: events.sort((a,b)=> String(a.at||'').localeCompare(String(b.at||''))),
    healthSummary: current.healthSummary || imported.healthSummary || null,
    readinessLog: readiness.sort((a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''))),
    evaluationLedger: mergeEvaluationLedgers(current.evaluationLedger, imported.evaluationLedger),
    customTemplates: applyTombstones(mergeCustomTemplates(current.customTemplates, imported.customTemplates), tombstones),
    programHistory: unionBy([...(imported.programHistory||[]), ...(current.programHistory||[])], v=>`${v.programId}|${v.version}`),
    tombstones,
  };
}
