// sync.js — optional cross-device sync layer (offline-first preserved).
// IndexedDB remains canonical locally; sync mirrors the portable store over a
// user-owned provider. Provider is a pluggable { pull, push } pair so tests stay pure.
// WebDAV ingestion is trusted Arise-to-Arise transport: it preserves recorded
// evidence provenance while still stripping device-local consent/credentials.
//
// Portable conflict semantics (deterministic convergence):
//   history (+archivedHistory)  per-id last-write-wins; equal timestamps break
//                               by canonical JSON (commutative). Live wins over
//                               archived for the same id (a restore is explicit
//                               and never silently re-archived).
//   tombstones                  canonical newest-wins union (mergeTombstones),
//                               applied per entity ('sessions' vs 'templates').
//   activeWorkout               newest legitimate updatedAt wins; different
//                               session ids still resolve to the newest draft
//                               (singleton); ties break deterministically.
//   activeSchedule              explicit rev/updatedAt wins (newest updatedAt,
//                               then highest rev); legacy schedules without
//                               metadata fall back to a deterministic JSON
//                               tie-break — never inferred from content.
//   gymPrefs                    per-exercise rest presets merge independently by
//                               per-exercise recency, then deterministic value
//                               tie-break (never receiving-device-wins, which
//                               oscillates: A→B ≠ B→A).
//   preferences                 device-local consent/credential keys stay local;
//                               portable keys merge deterministically.
//   study                       fail-closed via resolveStudySyncState: conflicting
//                               identities/enrollments throw before anything
//                               merges, so no sync ever reassigns arms.
// Consent, credentials and other deliberately device-local fields never travel
// (exportPolicy allow/deny lists) and never merge from the remote.

import { buildExportPayload, parseImportFile, mergeStores, mergePortableHistories } from "./export.js";
import { STORE_SCHEMA_VERSION, mergeCustomTemplates } from "./store.js";
import { mergeEvaluationLedgers } from "./longitudinal.js";
import { mergeTombstones, applyTombstones, canonicalJson } from "./domain.js";



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

// Deterministic union by key: first-seen wins, except same-key-different-
// content resolves by larger canonical JSON (order-independent), so the merge
// is commutative where the domain semantics permit it.
const unionBy=(rows,key)=>{
  const m=new Map();
  for(const v of rows||[]){
    const k=key(v);
    const e=m.get(k);
    if(!e || (canonicalJson(v)!==canonicalJson(e) && canonicalJson(v)>canonicalJson(e))) m.set(k,v);
  }
  return [...m.values()];
};
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

function tsOfWorkout(w){
  const t = Date.parse(w?.updatedAt || '');
  return Number.isFinite(t) ? t : 0;
}

/**
 * Newest legitimate updatedAt wins. Different session ids still resolve to
 * the newest draft (the runner holds one draft singleton); equal timestamps
 * break deterministically so merge(A,B) == merge(B,A).
 */
export function mergeActiveWorkout(current, imported){
  if(!current) return imported || null;
  if(!imported) return current;
  const a = tsOfWorkout(current), b = tsOfWorkout(imported);
  if(a !== b) return a > b ? current : imported;
  const aId = current?.session?.id || current?.id || '';
  const bId = imported?.session?.id || imported?.id || '';
  if(aId !== bId) return aId > bId ? current : imported;
  return canonicalJson(current) >= canonicalJson(imported) ? current : imported;
}

function tsOfSchedule(s){
  const t = Date.parse(s?.updatedAt || '');
  return Number.isFinite(t) ? t : 0;
}
function revOfSchedule(s){
  const r = Number(s?.rev);
  return Number.isFinite(r) && r >= 0 ? r : 0;
}

/**
 * Explicit revision/recency metadata wins: newest updatedAt, then highest
 * rev. Schedules without metadata (legacy) fall back to a deterministic JSON
 * tie-break — recency is never inferred from nested session content.
 */
export function mergeActiveSchedule(current, imported){
  if(!current) return imported || null;
  if(!imported) return current;
  const aT = tsOfSchedule(current), bT = tsOfSchedule(imported);
  if(aT !== bT) return aT > bT ? current : imported;
  const aR = revOfSchedule(current), bR = revOfSchedule(imported);
  if(aR !== bR) return aR > bR ? current : imported;
  return canonicalJson(current) >= canonicalJson(imported) ? current : imported;
}

/** Per-exercise timestamp for a rest preset (per-field recency). */
function presetTs(prefs, exId){
  const t = Date.parse(prefs?.restPresetUpdatedAt?.[exId] || prefs?.updatedAt || '');
  return Number.isFinite(t) ? t : 0;
}

/**
 * Deterministic Gym Mode merge: per-exercise rest presets are independently
 * mergeable by per-exercise recency (newer timestamp wins); equal/missing
 * timestamps break by larger seconds (commutative). Top-level scalar fields
 * resolve by updatedAt recency, then deterministic tie-break.
 */
export function mergeGymPrefs(current, imported){
  if(!current) return imported || null;
  if(!imported) return current;
  const a = current, b = imported;
  const presetsOf = (p)=> p.restPresets && typeof p.restPresets === 'object' ? p.restPresets : {};
  const tsMapOf = (p)=> p.restPresetUpdatedAt && typeof p.restPresetUpdatedAt === 'object' ? p.restPresetUpdatedAt : {};
  const aPresets = presetsOf(a), bPresets = presetsOf(b), aTsMap = tsMapOf(a), bTsMap = tsMapOf(b);
  const mergedPresets = {}, mergedPresetTs = {};
  const take = (exId, side)=> {
    mergedPresets[exId] = side === 'a' ? aPresets[exId] : bPresets[exId];
    const ts = side === 'a' ? aTsMap[exId] : bTsMap[exId];
    if(ts) mergedPresetTs[exId] = ts;
  };
  for(const exId of new Set([...Object.keys(aPresets), ...Object.keys(bPresets)])){
    const hasA = exId in aPresets, hasB = exId in bPresets;
    if(hasA !== hasB){ take(exId, hasA ? 'a' : 'b'); continue; }
    if(aPresets[exId] === bPresets[exId]){ take(exId, presetTs(a, exId) >= presetTs(b, exId) ? 'a' : 'b'); continue; }
    const ta = presetTs(a, exId), tb = presetTs(b, exId);
    take(exId, ta !== tb ? (ta > tb ? 'a' : 'b') : (Number(bPresets[exId]) > Number(aPresets[exId]) ? 'b' : 'a'));
  }
  const out = {};
  const aT = Date.parse(a.updatedAt || '') || 0, bT = Date.parse(b.updatedAt || '') || 0;
  for(const k of new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'restPresets' && k !== 'restPresetUpdatedAt'))){
    const hasA = k in a, hasB = k in b;
    if(hasA !== hasB){ out[k] = hasA ? a[k] : b[k]; continue; }
    if(canonicalJson(a[k]) === canonicalJson(b[k])){ out[k] = a[k]; continue; }
    out[k] = aT !== bT ? (aT > bT ? a[k] : b[k]) : (canonicalJson(a[k]) >= canonicalJson(b[k]) ? a[k] : b[k]);
  }
  const merged = { ...out, restPresets: mergedPresets };
  if(Object.keys(mergedPresetTs).length) merged.restPresetUpdatedAt = mergedPresetTs;
  // Preserve the winner's timestamp verbatim: re-serialising through Date
  // would normalise equivalent instants and break idempotence.
  if(aT !== bT) merged.updatedAt = aT > bT ? a.updatedAt : b.updatedAt;
  else if(a.updatedAt || b.updatedAt) merged.updatedAt = canonicalJson(a.updatedAt) >= canonicalJson(b.updatedAt) ? (a.updatedAt || b.updatedAt) : (b.updatedAt || a.updatedAt);
  return merged;
}

// Device-local preference keys: consent toggles + credentials. They always
// stay local and are excluded from convergence requirements.
export const DEVICE_LOCAL_PREF_KEYS = ['sync', 'syncEnabled', 'telemetryEnabled', 'pulseEnabled', 'healthSummaryEnabled', 'telemetryOptions'];

/**
 * Portable preferences merge: device-local keys keep the local side;
 * every other key merges deterministically (larger canonical JSON wins on
 * conflict). Convergent by construction; no recency is invented.
 */
export function mergePortablePreferences(current = {}, imported = {}){
  const out = { ...(imported || {}), ...(current || {}) };
  for(const k of DEVICE_LOCAL_PREF_KEYS){
    if(k in (current || {})) out[k] = current[k];
    else delete out[k];
  }
  for(const k of new Set([...Object.keys(imported || {}), ...Object.keys(current || {})].filter((k) => !DEVICE_LOCAL_PREF_KEYS.includes(k)))){
    const hasA = current && k in current, hasB = imported && k in imported;
    if(hasA && hasB && canonicalJson(current[k]) !== canonicalJson(imported[k])){
      out[k] = canonicalJson(current[k]) >= canonicalJson(imported[k]) ? current[k] : imported[k];
    }
  }
  return out;
}

// Merge with per-session conflict resolution (savedAt) and onboarding recency
export function mergeStoresWithConflicts(current, imported){
  const cur = current || {};
  const imp = imported || {};
  // Deletions propagate canonically: newest tombstone per entity+refId wins.
  const tombstones = mergeTombstones(cur.tombstones, imp.tombstones);
  // Complete portable history (live + archived): LWW per id, live wins the
  // location, tombstones applied per entity afterwards.
  const portable = mergePortableHistories(cur.history, cur.archivedHistory, imp.history, imp.archivedHistory);
  // onboarding: keep current unless missing (directional import semantic, unchanged)
  const onboarding = cur.onboarding || imp.onboarding || null;
  const study = resolveStudySyncState(cur, imp);
  return {
    version: Math.max(STORE_SCHEMA_VERSION, cur.version||1, imp.version||1),
    ...cur,
    onboarding,
    activeSchedule: mergeActiveSchedule(cur.activeSchedule, imp.activeSchedule),
    activeWorkout: mergeActiveWorkout(cur.activeWorkout, imp.activeWorkout),
    gymPrefs: mergeGymPrefs(cur.gymPrefs, imp.gymPrefs),
    // Guarded comparator: an entry missing dateISO must not crash the sync.
    history: applyTombstones(portable.history, tombstones, 'sessions'),
    archivedHistory: applyTombstones(portable.archivedHistory, tombstones, 'sessions'),
    preferences: mergePortablePreferences(cur.preferences, imp.preferences),
    ...study,
    eventHistory: unionBy([...(cur.eventHistory||[]), ...(imp.eventHistory||[])].filter(e=>e?.id), e=>e.id).sort((a,b)=> String(a.at||'').localeCompare(String(b.at||''))),
    healthSummary: cur.healthSummary || imp.healthSummary || null,
    readinessLog: unionBy([...(imp.readinessLog||[]), ...(cur.readinessLog||[])], r=>`${r.dateISO}|${r.at||r.score}`).sort((a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''))),
    evaluationLedger: mergeEvaluationLedgers(cur.evaluationLedger, imp.evaluationLedger),
    customTemplates: applyTombstones(mergeCustomTemplates(cur.customTemplates, imp.customTemplates), tombstones, 'templates'),
    programHistory: unionBy([...(imp.programHistory||[]), ...(cur.programHistory||[])], v=>`${v.programId}|${v.version}`),
    tombstones,
  };
}
