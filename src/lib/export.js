// Export / restore / import â€” versioned JSON backup for local-first data.
// No cloud sync; the user owns the file.

import { runMigrations, STORE_SCHEMA_VERSION, mergeCustomTemplates, normaliseHistory } from './store.js';
import { getEventHistory } from './telemetry.js';
import { loadEvaluationLedger, mergeEvaluationLedgers } from './longitudinal.js';
import { ensureStudyParticipantId } from './studyIdentity.js';
import { buildEnvelope, applyFieldPolicy } from './exportPolicy.js';
import { withProvenance, ensureSourceTags } from './domain.js';

export const EXPORT_VERSION = 4;

export function buildExportPayload(store){
  const eventHistory=getEventHistory();
  // The evaluation ledger travels with the backup: a longitudinal study must
  // survive reinstalls and move between devices like any other user data.
  const evaluationLedger=loadEvaluationLedger();
  const data={ ...store, version: store.version || STORE_SCHEMA_VERSION, eventHistory, evaluationLedger };
  // Every export carries the pseudonymous study id so repeated weekly exports
  // from one person can be folded back into ONE participant downstream.
  ensureStudyParticipantId(data);
  return buildEnvelope({
    payload: data,
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

// ── Compressed backups ──────────────────────────────────────────────────────
// A decade of sessions is megabytes of JSON. Exports are gzip-compressed when
// the browser exposes CompressionStream, and written as a versioned envelope
// `{ app:'arise', format:'arise+gzip', v:1, encoding:'base64', data }` so an
// import can tell compressed from plain without guessing. Old browsers fall
// back to the plain JSON path — every existing file still imports.

export const BACKUP_FORMAT = 'arise+gzip';

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

async function gzipBytes(text){
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipBytes(bytes){
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
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
const STORE_KEYS = ['version','onboarding','activeSchedule','activeWorkout','eventHistory','healthSummary','history','preferences','readinessLog','programHistory','evaluationLedger','customTemplates','studyParticipantId','studyEnrollment','tombstones'];

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

export function parseImportFile(text){
  const parsed = sanitiseImportText(text);
  const data = parsed?.data ? parsed.data : parsed;
  if(!data || typeof data !== 'object') throw new Error('Import file is empty or malformed.');
  if(parsed?.app && parsed.app !== 'arise') throw new Error('This backup is not for Arise.');
  if(!('history' in data) && !('onboarding' in data) && !('activeSchedule' in data) && !('eventHistory' in data) && !('evaluationLedger' in data)){
    throw new Error('Unrecognised backup shape â€” missing history/onboarding/schedule/event history.');
  }
  const validation=validateStoreData(data);
  if(!validation.ok) throw new Error(`Backup validation failed: ${validation.errors.join(' ')}`);
  const clean = {};
  for(const key of STORE_KEYS) if(key in data) clean[key]=data[key];
  const migrated = runMigrations(typeof structuredClone==='function' ? structuredClone(clean) : JSON.parse(JSON.stringify(clean)));
  // Dangerous-field policy runs AFTER migrations (which can rename keys) and
  // BEFORE the payload is merged: consent, study identity and health data are
  // device-local and never file-supplied. Imported sessions get honest
  // provenance: source 'import', ledger origin 'imported'.
  const safe = applyFieldPolicy(migrated);
  if(Array.isArray(safe.history)) safe.history = safe.history.map((s)=> ensureSourceTags(s, 'import'));
  if(Array.isArray(safe.evaluationLedger)) safe.evaluationLedger = safe.evaluationLedger.map((r)=> withProvenance(r, 'imported'));
  return safe;
}

export function validateStoreData(data){
  const errors=[];
  if(!data || typeof data!=='object' || Array.isArray(data)) return { ok:false, errors:['Expected an object.'] };
  if(data.version!=null && (!Number.isInteger(Number(data.version)) || Number(data.version)<1)) errors.push('Schema version must be a positive integer.');
  if(Number(data.version) > STORE_SCHEMA_VERSION) errors.push(`Schema version ${data.version} is newer than this app supports (${STORE_SCHEMA_VERSION}).`);
  if(data.history!=null && !Array.isArray(data.history)) errors.push('History must be an array.');
  // Iterate only when actually an array — a string/object history must
  // produce a clean validation error, not a TypeError that escapes the gate.
  const historyRows = Array.isArray(data.history) ? data.history : [];
  for(const [i,session] of historyRows.entries()){
    if(!session || typeof session!=='object') { errors.push(`History item ${i+1} is not an object.`); continue; }
    if(!session.id) errors.push(`History item ${i+1} is missing an id.`);
    // dateISO is load-bearing: sorting, week bucketing and training age all key
    // off it, so an entry without a parseable date would poison analytics.
    if(typeof session.dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(session.dateISO) || Number.isNaN(Date.parse(session.dateISO))) errors.push(`History item ${i+1} has an invalid or missing dateISO.`);
    if(session.blocks!=null && !Array.isArray(session.blocks)) errors.push(`History item ${i+1} blocks must be an array.`);
    for(const block of session.blocks||[]){
      if(!block?.exerciseId || !Array.isArray(block.sets)){ errors.push(`History item ${i+1} contains an invalid exercise block.`); continue; }
      for(const [si,set] of block.sets.entries()){
        if(!set || typeof set!=='object') continue;
        // Impossible values would corrupt e1RM, volume and progression priors.
        // Numeric fields legitimately arrive as numeric strings (the app's own
        // normalisation accepts both); '' means unset. Coerce, then bound-check
        // — reject only true garbage, negatives and implausible magnitudes.
        for(const [field,label] of [['weightKg','weight'],['reps','reps'],['rpe','RPE'],['assistedKg','assistance']]){
          const raw = set[field];
          if(raw == null || raw === '') continue;
          const v = typeof raw === 'number' ? raw : Number(raw);
          if(!Number.isFinite(v)){ errors.push(`History item ${i+1} set ${si+1} has a non-numeric ${label}.`); continue; }
          if(v < 0){ errors.push(`History item ${i+1} set ${si+1} has negative ${label}.`); }
          if(field==='reps' && v > 1000) errors.push(`History item ${i+1} set ${si+1} has implausible reps (>1000).`);
          if((field==='weightKg'||field==='assistedKg') && v > 1000) errors.push(`History item ${i+1} set ${si+1} has implausible ${label} (>1000 kg).`);
          if(field==='rpe' && (v < 1 || v > 10)) errors.push(`History item ${i+1} set ${si+1} has RPE outside 1-10.`);
        }
      }
    }
  }
  if(data.activeSchedule!=null && typeof data.activeSchedule!=='object') errors.push('Active schedule must be an object or null.');
  if(data.eventHistory!=null && !Array.isArray(data.eventHistory)) errors.push('Event history must be an array.');
  if(data.evaluationLedger!=null && !Array.isArray(data.evaluationLedger)) errors.push('Evaluation ledger must be an array.');
  if(data.healthSummary!=null && typeof data.healthSummary!=='object') errors.push('Health summary must be an object or null.');
  // Collections mergeStores/readiness consumers iterate unconditionally — a
  // non-array here would crash import/boot rather than fail validation.
  if(data.readinessLog!=null && !Array.isArray(data.readinessLog)) errors.push('Readiness log must be an array.');
  if(data.programHistory!=null && !Array.isArray(data.programHistory)) errors.push('Program history must be an array.');
  if(data.customTemplates!=null && !Array.isArray(data.customTemplates)) errors.push('Custom templates must be an array.');
  return { ok: errors.length===0, errors };
}

export function mergeStores(current, imported, strategy='merge'){
  const currentStore=runMigrations(typeof structuredClone==='function' ? structuredClone(current||{}) : JSON.parse(JSON.stringify(current||{})));
  const importedStore=runMigrations(typeof structuredClone==='function' ? structuredClone(imported||{}) : JSON.parse(JSON.stringify(imported||{})));
  if(strategy==='replace') return { ...importedStore, version: STORE_SCHEMA_VERSION };
  const byId = new Map();
  for(const h of (currentStore.history||[])) byId.set(h.id, h);
  for(const h of (importedStore.history||[])) if(!byId.has(h.id)) byId.set(h.id, h);
  const eventById=new Map();
  for(const e of [...(currentStore.eventHistory||[]), ...(importedStore.eventHistory||[])]) if(e?.id) eventById.set(e.id,e);
  return {
    ...currentStore,
    version: STORE_SCHEMA_VERSION,
    onboarding: currentStore.onboarding || importedStore.onboarding || null,
    activeSchedule: currentStore.activeSchedule || importedStore.activeSchedule || null,
    activeWorkout: currentStore.activeWorkout || importedStore.activeWorkout || null,
    // Guarded comparator: an entry missing dateISO must not crash the whole import.
    history: [...byId.values()].sort((a,b)=> String(a?.dateISO||'').localeCompare(String(b?.dateISO||''))),
    eventHistory: [...eventById.values()].sort((a,b)=> String(a.at||'').localeCompare(String(b.at||''))),
    healthSummary: currentStore.healthSummary || importedStore.healthSummary || null,
    preferences: { ...(importedStore.preferences||{}), ...(currentStore.preferences||{}) },
    readinessLog: [...(currentStore.readinessLog||[]), ...(importedStore.readinessLog||[])].filter((v,i,a)=> a.findIndex(x=> x.dateISO===v.dateISO && x.at===v.at)===i),
    evaluationLedger: mergeEvaluationLedgers(currentStore.evaluationLedger, importedStore.evaluationLedger),
    customTemplates: mergeCustomTemplates(currentStore.customTemplates, importedStore.customTemplates),
    programHistory: [...(currentStore.programHistory||[]), ...(importedStore.programHistory||[])].filter((v,i,a)=> a.findIndex(x=> x.programId===v.programId && x.version===v.version)===i),
    // Deletions must propagate: incoming tombstones union with local ones.
    tombstones: [...(currentStore.tombstones||[]), ...(importedStore.tombstones||[])].filter((v,i,a)=> a.findIndex(x=> x.id===v.id)===i),
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
    schedulePresent: !!store.activeSchedule,
    onboardingPresent: !!store.onboarding,
    readinessCount: (store.readinessLog||[]).length,
    eventCount: getEventHistory().length,
    healthSummaryPresent: !!store.healthSummary,
  };
}
