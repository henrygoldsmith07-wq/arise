// Export / restore / import — versioned JSON backup for local-first data.
// No cloud sync; the user owns the file.

import { runMigrations, STORE_SCHEMA_VERSION, mergeCustomTemplates, normaliseHistory } from './store.js';
import { getEventHistory } from './telemetry.js';
import { loadEvaluationLedger, mergeEvaluationLedgers } from './longitudinal.js';
import { ensureStudyParticipantId } from './studyIdentity.js';
import { buildEnvelope, applyFieldPolicy, EXPORT_VERSION } from './exportPolicy.js';
import { withProvenance, ensureSourceTags, importLedgerProvenance, mergeTombstones, applyTombstones, canonicalJson, rowTimestamp } from './domain.js';
import { isDateOnly } from './dateOnly.js';
import { readCanonicalLedger } from './evaluationLedgerBridge.js';

export { EXPORT_VERSION };

// preferences.sync carries the user's WebDAV/backup credentials and is
// DEVICE-LOCAL, same policy class as consent toggles: it must never appear in
// any export, backup, coach file or sync payload. (Imports already deny it.)
export function stripDeviceLocalPrefs(preferences){
  if(!preferences || typeof preferences !== 'object') return preferences;
  const { sync, ...rest } = preferences;
  return rest;
}

export function storeWithLiveCollections(store){
  const events=readCanonicalLedger('events'), ledger=readCanonicalLedger('evaluation');
  if(events===null && ledger===null) return store;
  return { ...store, eventHistory:events??store.eventHistory, evaluationLedger:ledger??store.evaluationLedger };
}

export function buildExportPayload(store, useStoreCollections = false){
  const eventHistory=useStoreCollections ? (store?.eventHistory||[]) : getEventHistory();
  const evaluationLedger=useStoreCollections ? (store?.evaluationLedger||[]) : loadEvaluationLedger();
  // A portable full backup preserves ALL training history: live `history`
  // PLUS `archivedHistory` (sessions moved to the IndexedDB archive store).
  // Older in-memory stores predate the field — default to [] so every backup
  // carries the complete collection explicitly.
  const archivedHistory = Array.isArray(store?.archivedHistory) ? store.archivedHistory : [];
  const data={ ...store, archivedHistory, version:store.version || STORE_SCHEMA_VERSION, eventHistory, evaluationLedger };
  // Credential hygiene: never let device-local sync config ride along.
  if(data.preferences) data.preferences = stripDeviceLocalPrefs(data.preferences);
  // A full backup also contributes to the study: carry the exportedAt FACT
  // inside the payload too, so study ingestion (which reads data.exportedAt)
  // can age every export without depending on the envelope layer.
  // Every export also carries the pseudonymous study id so repeated weekly
  // exports from one person can be folded back into ONE participant downstream.
  ensureStudyParticipantId(data);
  data.exportedAt = new Date().toISOString();
  return buildEnvelope({
    payload: data,
    payloadVersion: EXPORT_VERSION,
    schemaVersion: STORE_SCHEMA_VERSION,
  });
}

// ── Partial exports ─────────────────────────────────────────────────────────
// Same versioned envelope contract as a full backup, but carrying one slice.
// 'history'  = training sessions only (no preferences, no events)
// 'settings' = onboarding profile + preferences (no history, no events)
// 'events'   = the local event ledger (product measurements)
const PARTIAL_KEYS = {
  history:  ['history'],
  settings: ['onboarding', 'preferences', 'gymPrefs'],
  events:   ['eventHistory'],
};

export function buildPartialExportPayload(store, kind){
  const keys = PARTIAL_KEYS[kind];
  if(!keys) throw new Error(`Unknown partial export kind: ${kind}`);
  const slice = {};
  for(const key of keys) slice[key] = key==='eventHistory' ? getEventHistory() : store?.[key] ?? null;
  if(slice.preferences) slice.preferences = stripDeviceLocalPrefs(slice.preferences);
  return buildEnvelope({
    payload: slice,
    payloadVersion: EXPORT_VERSION,
    schemaVersion: STORE_SCHEMA_VERSION,
  });
}

export function downloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
}

// ── Study export ────────────────────────────────────────────────────────────
// The dedicated participant action for the real-world study lives in
// studyExport.js — the EXACT file cohortOps.ingestParticipantFiles accepts,
// deliberately NOT the backup: backups move a life between devices; the study
// file contributes evidence. It is a separate module (lazy-loaded from the
// More screen) so its serializers never bloat the boot chunk.
//
// ── Compressed backups ──────────────────────────────────────────────
// A decade of sessions is megabytes of JSON. Exports are gzip-compressed when
// the browser exposes CompressionStream, and written as a versioned envelope
// `{ app:'arise', format:'arise+gzip', v:1, encoding:'base64', data }` so an
// import can tell compressed from plain without guessing. Old browsers fall
// back to the plain JSON path — every existing file still imports.

export const BACKUP_FORMAT = 'arise+gzip';

async function gzipBytes(text){
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipBytes(bytes){
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}
function bytesToBase64(bytes){
  let bin = '';
  for(const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToBytes(b64){
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function compressionAvailable(){
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** Serialize + compress. Returns the same envelope shape either way. */
export async function compressPayload(payload){
  const json = JSON.stringify(payload);
  if(!compressionAvailable()) return { envelope: payload, compressed: false };
  const gz = await gzipBytes(json);
  // Only worth it when compression actually shrinks (tiny payloads can grow).
  if(gz.length >= json.length) return { envelope: payload, compressed: false };
  return {
    envelope: {
      app: 'arise',
      format: BACKUP_FORMAT,
      v: 1,
      encoding: 'base64',
      data: bytesToBase64(gz),
    },
    compressed: true,
  };
}

/** Reverse of compressPayload for compressed envelopes; passthrough otherwise. */
export async function decompressPayload(envelope){
  if(envelope?.format === BACKUP_FORMAT){
    if(envelope.encoding !== 'base64') throw new Error('Unsupported backup encoding.');
    const json = await gunzipBytes(base64ToBytes(String(envelope.data || '')));
    return JSON.parse(json);
  }
  return envelope;
}

/** Serialize (+compress when possible) and trigger a file download. */
export async function downloadBackup(payload, filename = 'arise-backup.arise'){
  const { envelope } = await compressPayload(payload);
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
}

/** Accepts plain JSON text or a compressed envelope object. */
export async function parseBackupFile(textOrEnvelope){
  const envelope = typeof textOrEnvelope === 'string' ? JSON.parse(textOrEnvelope) : textOrEnvelope;
  return decompressPayload(envelope);
}

// Only these top-level keys may enter the store from an imported file.
// Anything else in a hand-edited backup is dropped rather than persisted forever.
// studyParticipantId is the pseudonymous study identity (studyIdentity.js) —
// preserved so repeated exports fold into ONE field-study participant.
const STORE_KEYS = ['version','onboarding','activeSchedule','activeWorkout','eventHistory','healthSummary','history','archivedHistory','preferences','gymPrefs','readinessLog','programHistory','evaluationLedger','customTemplates','studyParticipantId','studyEnrollment','studyStatus','studyStatusChangedAtISO','tombstones'];

// ── Import hardening (malicious/hostile JSON) ───────────────────────────────
// Imports are untrusted input. Beyond schema validation, three structural
// attacks are neutralised before any value is read:
//   1. Prototype pollution — a "__proto__": {...} key in parsed JSON hijacks
//      Object.prototype for the whole session. Keys are stripped everywhere
//      (own + nested) and rebuilt into null-prototype objects.
//   2. Depth bombs — parser-stack exhaustion via 100k-deep nesting. Capped.
//   3. Size bombs — a 500 MB string freezes the tab before validation runs.
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB is ~15 years of daily sessions
const MAX_IMPORT_DEPTH = 64;

function stripDangerousKeys(value, depth = 0){
  if(depth > MAX_IMPORT_DEPTH) throw new Error('Import file nests more than ' + MAX_IMPORT_DEPTH + ' levels deep.');
  if(Array.isArray(value)) return value.map((v)=> stripDangerousKeys(v, depth + 1));
  if(value && typeof value === 'object'){
    const out = Object.create(null);
    for(const key of Object.keys(value)){
      if(key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = stripDangerousKeys(value[key], depth + 1);
    }
    return out;
  }
  return value;
}

function enforceImportSize(text){
  // Rough UTF-16 ceiling: 2 bytes per char. The 5 MB file cap catches the rest.
  if(typeof text === 'string' && text.length > MAX_IMPORT_BYTES / 2){
    throw new Error('Import file is too large (limit 5 MB of JSON).');
  }
}

function sanitiseImportText(text){
  enforceImportSize(text);
  let parsed;
  try{ parsed = JSON.parse(text); }
  catch { throw new Error('Not valid JSON.'); }
  return stripDangerousKeys(parsed);
}

export function parseImportFile(text, trusted = false){
  const parsed = sanitiseImportText(text);
  const data = parsed?.data ? parsed.data : parsed;
  if(!data || typeof data !== 'object') throw new Error('Import file is empty or malformed.');
  if(parsed?.app && parsed.app !== 'arise') throw new Error('This backup is not for Arise.');
  if(!('history' in data) && !('onboarding' in data) && !('activeSchedule' in data) && !('eventHistory' in data) && !('evaluationLedger' in data)){
    throw new Error('Unrecognised backup shape — missing history/onboarding/schedule/event history.');
  }
  const validation=validateStoreData(data);
  if(!validation.ok) throw new Error(`Backup validation failed: ${validation.errors.join(' ')}`);
  const clean = {};
  for(const key of STORE_KEYS) if(key in data) clean[key]=data[key];
  const migrated = runMigrations(typeof structuredClone==='function' ? structuredClone(clean) : JSON.parse(JSON.stringify(clean)));
  // Device-local consent and credentials are denied for BOTH backup imports
  // and trusted sync. The distinction is provenance: arbitrary user-supplied
  // files are downgraded to imported; the app's own WebDAV sync preserves the
  // already-recorded provenance blocks so same-participant evidence remains
  // auditable across the user's devices.
  const safe = applyFieldPolicy(migrated);
  if(Array.isArray(safe.history)) safe.history = safe.history.map((s)=> ensureSourceTags(s, trusted ? 'sync' : 'import'));
  if(Array.isArray(safe.archivedHistory)) safe.archivedHistory = safe.archivedHistory.map((s)=> ensureSourceTags(s, trusted ? 'sync' : 'import'));
  if(!trusted && Array.isArray(safe.evaluationLedger)){
    safe.evaluationLedger = safe.evaluationLedger.map((r)=> importLedgerProvenance(r));
  }
  return safe;
}


function validateHistoryRows(rows, label, errors){
  for(const [i,session] of rows.entries()){
    if(!session || typeof session!=='object') { errors.push(`${label} item ${i+1} is not an object.`); continue; }
    if(!session.id) errors.push(`${label} item ${i+1} is missing an id.`);
    // dateISO is load-bearing: sorting, week bucketing and training age all key
    // off it, so an entry without a parseable date would poison analytics.
    if(!isDateOnly(session.dateISO)) errors.push(`${label} item ${i+1} has an invalid or missing dateISO.`);
    if(session.blocks!=null && !Array.isArray(session.blocks)) errors.push(`${label} item ${i+1} blocks must be an array.`);
    for(const block of session.blocks||[]){
      if(!block?.exerciseId || !Array.isArray(block.sets)){ errors.push(`${label} item ${i+1} contains an invalid exercise block.`); continue; }
      for(const [si,set] of block.sets.entries()){
        if(!set || typeof set!=='object') continue;
        // Impossible values would corrupt e1RM, volume and progression priors.
        // Numeric fields legitimately arrive as numeric strings (the app's own
        // normalisation accepts both); '' means unset. Coerce, then bound-check
        // — reject only true garbage, negatives and implausible magnitudes.
        for(const [field,flabel] of [['weightKg','weight'],['reps','reps'],['rpe','RPE'],['assistedKg','assistance']]){
          const raw = set[field];
          if(raw == null || raw === '') continue;
          const v = typeof raw === 'number' ? raw : Number(raw);
          if(!Number.isFinite(v)){ errors.push(`${label} item ${i+1} set ${si+1} has a non-numeric ${flabel}.`); continue; }
          if(v < 0){ errors.push(`${label} item ${i+1} set ${si+1} has negative ${flabel}.`); }
          if(field==='reps' && v > 1000) errors.push(`${label} item ${i+1} set ${si+1} has implausible reps (>1000).`);
          if((field==='weightKg'||field==='assistedKg') && v > 1000) errors.push(`${label} item ${i+1} set ${si+1} has implausible ${flabel} (>1000 kg).`);
          if(field==='rpe' && (v < 1 || v > 10)) errors.push(`${label} item ${i+1} set ${si+1} has RPE outside 1-10.`);
        }
      }
    }
  }
}

export function validateStoreData(data){
  const errors=[];
  if(!data || typeof data!=='object' || Array.isArray(data)) return { ok:false, errors:['Expected an object.'] };
  if(data.version!=null && (!Number.isInteger(Number(data.version)) || Number(data.version)<1)) errors.push('Schema version must be a positive integer.');
  if(Number(data.version) > STORE_SCHEMA_VERSION) errors.push(`Schema version ${data.version} is newer than this app supports (${STORE_SCHEMA_VERSION}).`);
  if(data.history!=null && !Array.isArray(data.history)) errors.push('History must be an array.');
  // Iterate only when actually an array — a string/object history must
  // produce a clean validation error, not a TypeError that escapes the gate.
  validateHistoryRows(Array.isArray(data.history) ? data.history : [], 'History', errors);
  if(data.archivedHistory!=null && !Array.isArray(data.archivedHistory)) errors.push('Archived history must be an array.');
  else validateHistoryRows(Array.isArray(data.archivedHistory) ? data.archivedHistory : [], 'Archived history', errors);
  if(data.tombstones!=null && !Array.isArray(data.tombstones)) errors.push('Tombstones must be an array.');
  // Live/archived disjointness is structural: one id in both collections is
  // a restorable-state violation, never a silent double-count.
  if(Array.isArray(data.history) && Array.isArray(data.archivedHistory)){
    const liveIds = new Set(data.history.map((s) => s?.id).filter(Boolean));
    if(data.archivedHistory.some((s) => s?.id && liveIds.has(s.id))) errors.push('Archived history must not duplicate live history ids.');
  }
  if(data.activeSchedule!=null && typeof data.activeSchedule!=='object') errors.push('Active schedule must be an object or null.');
  if(data.eventHistory!=null && !Array.isArray(data.eventHistory)) errors.push('Event history must be an array.');
  if(data.evaluationLedger!=null && !Array.isArray(data.evaluationLedger)) errors.push('Evaluation ledger must be an array.');
  if(data.healthSummary!=null && typeof data.healthSummary!=='object') errors.push('Health summary must be an object or null.');
  if(data.gymPrefs!=null && (typeof data.gymPrefs!=='object' || Array.isArray(data.gymPrefs))) errors.push('Gym preferences must be an object or null.');
  // Collections mergeStores/readiness consumers iterate unconditionally — a
  // non-array here would crash import/boot rather than fail validation.
  if(data.readinessLog!=null && !Array.isArray(data.readinessLog)) errors.push('Readiness log must be an array.');
  if(data.programHistory!=null && !Array.isArray(data.programHistory)) errors.push('Program history must be an array.');
  if(data.customTemplates!=null && !Array.isArray(data.customTemplates)) errors.push('Custom templates must be an array.');
  return { ok: errors.length===0, errors };
}

function splitLiveArchived(byId, currentHistory = [], importedHistory = []){
  const liveIds = new Set([...(currentHistory || []), ...(importedHistory || [])].map((s) => s?.id).filter(Boolean));
  const byDate = (a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''));
  return {
    history: [...byId.values()].filter((s) => liveIds.has(s.id)).sort(byDate),
    archivedHistory: [...byId.values()].filter((s) => !liveIds.has(s.id)).sort(byDate),
  };
}

/**
 * Sync-path history union: per-id last-write-wins with a deterministic
 * equal-timestamp tie-break (larger canonical JSON), so the merge is
 * commutative. Location rule: live wins over archived for the same id (an
 * explicit restore is never silently re-archived).
 */
export function mergePortableHistories(currentHistory = [], currentArchived = [], importedHistory = [], importedArchived = []){
  const newest = new Map();
  for(const s of [...(currentHistory || []), ...(currentArchived || []), ...(importedHistory || []), ...(importedArchived || [])]){
    if(!s?.id) continue;
    const existing = newest.get(s.id);
    if(!existing) newest.set(s.id, s);
    else {
      const a = rowTimestamp(s), b = rowTimestamp(existing);
      if(a > b || (a === b && canonicalJson(s) > canonicalJson(existing))) newest.set(s.id, s);
    }
  }
  return splitLiveArchived(newest, currentHistory, importedHistory);
}

/**
 * Import-path history union: the current device keeps its copy on content
 * conflicts (the preview promises "your current copy is kept"); brand-new
 * ids union in. Archived history unions the same way. Deterministic and
 * directional — sync convergence uses mergePortableHistories (LWW).
 */
export function mergeImportHistories(currentHistory = [], currentArchived = [], importedHistory = [], importedArchived = []){
  const byId = new Map();
  for(const s of [...(currentHistory || []), ...(currentArchived || []), ...(importedHistory || []), ...(importedArchived || [])]) if(s?.id && !byId.has(s.id)) byId.set(s.id, s);
  return splitLiveArchived(byId, currentHistory, importedHistory);
}

export function mergeStores(current, imported, strategy='merge'){
  const currentStore=runMigrations(typeof structuredClone==='function' ? structuredClone(current||{}) : JSON.parse(JSON.stringify(current||{})));
  const importedStore=runMigrations(typeof structuredClone==='function' ? structuredClone(imported||{}) : JSON.parse(JSON.stringify(imported||{})));
  if(strategy==='replace') return { ...importedStore, version: STORE_SCHEMA_VERSION };
  // Canonical newest-wins union: an older retained deletion must not survive
  // alongside a newer tombstone for the same entity.
  const tombstones = mergeTombstones(currentStore.tombstones, importedStore.tombstones);
  const portable = mergeImportHistories(currentStore.history, currentStore.archivedHistory, importedStore.history, importedStore.archivedHistory);
  const eventById = new Map();
  for(const e of [...(currentStore.eventHistory||[]), ...(importedStore.eventHistory||[])]) if(e?.id) eventById.set(e.id,e);
  return {
    ...currentStore,
    version: STORE_SCHEMA_VERSION,
    onboarding: currentStore.onboarding || importedStore.onboarding || null,
    activeSchedule: currentStore.activeSchedule || importedStore.activeSchedule || null,
    activeWorkout: currentStore.activeWorkout || importedStore.activeWorkout || null,
    // Guarded comparator: an entry missing dateISO must not crash the whole import.
    history: applyTombstones(portable.history, tombstones, 'sessions'),
    archivedHistory: applyTombstones(portable.archivedHistory, tombstones, 'sessions'),
    eventHistory: [...eventById.values()].sort((a,b)=> String(a.at||'').localeCompare(String(b.at||''))),
    healthSummary: currentStore.healthSummary || importedStore.healthSummary || null,
    preferences: { ...(importedStore.preferences||{}), ...(currentStore.preferences||{}) },
    gymPrefs: {
      ...(importedStore.gymPrefs || {}),
      ...(currentStore.gymPrefs || {}),
      restPresets:{
        ...(importedStore.gymPrefs?.restPresets || {}),
        ...(currentStore.gymPrefs?.restPresets || {}),
      },
    },
    readinessLog: [...(currentStore.readinessLog||[]), ...(importedStore.readinessLog||[])].filter((v,i,a)=> a.findIndex(x=> x.dateISO===v.dateISO && x.at===v.at)===i),
    evaluationLedger: mergeEvaluationLedgers(currentStore.evaluationLedger, importedStore.evaluationLedger),
    customTemplates: applyTombstones(mergeCustomTemplates(currentStore.customTemplates, importedStore.customTemplates), tombstones, 'templates'),
    programHistory: [...(currentStore.programHistory||[]), ...(importedStore.programHistory||[])].filter((v,i,a)=> a.findIndex(x=> x.programId===v.programId && x.version===v.version)===i),
    // Deletions propagate through the canonical newest-wins union.
    tombstones,
  };
}

export function portableCsv(history){
  const rows = [['dateISO','exerciseId','reps','weightKg','rpe','side','rom','assistedKg','failed','skipped','durationMinutes','programVersion','equipmentSnapshot']];
  for(const h of history||[]) for(const b of h.blocks||[]) for(const s of b.sets||[]){
    rows.push([h.dateISO, b.exerciseId, s.reps||'', s.weightKg||'', s.rpe||'', s.side||'', s.rom||'', s.assistedKg||'', s.failed?'1':'', s.skipped?'1':'', h.durationMinutes||'', h.programVersion||'', Array.isArray(h.equipmentSnapshot)? h.equipmentSnapshot.join('|') : '']);
  }
  return rows.map(r=> r.map(csvCell).join(',')).join('\n');
}

// Neutralise spreadsheet formula injection: user-controlled strings starting
// with =, +, - or @ would execute as formulas when the CSV opens in Excel.
function csvCell(value){
  let text = String(value).replace(/"/g,'""').replace(/[\r\n]+/g,' ');
  if(/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return `"${text}"`;
}

// Deletion: remove all personal data but keep app shell
export function deletionPreview(store){
  return {
    historyCount: (store.history||[]).length,
    archivedHistoryCount: (store.archivedHistory||[]).length,
    schedulePresent: !!store.activeSchedule,
    onboardingPresent: !!store.onboarding,
    readinessCount: (store.readinessLog||[]).length,
    eventCount: getEventHistory().length,
    healthSummaryPresent: !!store.healthSummary,
  };
}
