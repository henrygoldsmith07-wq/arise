// Export / restore / import â€” versioned JSON backup for local-first data.
// No cloud sync; the user owns the file.

import { runMigrations, STORE_SCHEMA_VERSION, mergeCustomTemplates } from './store.js';
import { getEventHistory } from './telemetry.js';
import { loadEvaluationLedger, mergeEvaluationLedgers } from './longitudinal.js';
import { ensureStudyParticipantId } from './studyIdentity.js';

export const EXPORT_VERSION = 3;

export function buildExportPayload(store){
  const eventHistory=getEventHistory();
  // The evaluation ledger travels with the backup: a longitudinal study must
  // survive reinstalls and move between devices like any other user data.
  const evaluationLedger=loadEvaluationLedger();
  const data={ ...store, version: store.version || STORE_SCHEMA_VERSION, eventHistory, evaluationLedger };
  // Every export carries the pseudonymous study id so repeated weekly exports
  // from one person can be folded back into ONE participant downstream.
  ensureStudyParticipantId(data);
  return {
    app: 'arise',
    version: EXPORT_VERSION,
    schemaVersion: STORE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function downloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
}

// Only these top-level keys may enter the store from an imported file.
// Anything else in a hand-edited backup is dropped rather than persisted forever.
// studyParticipantId is the pseudonymous study identity (studyIdentity.js) —
// preserved so repeated exports fold into ONE field-study participant.
const STORE_KEYS = ['version','onboarding','activeSchedule','activeWorkout','eventHistory','healthSummary','history','preferences','readinessLog','programHistory','evaluationLedger','customTemplates','studyParticipantId','studyEnrollment','progressionOverrides'];

export function parseImportFile(text){
  let parsed;
  try{ parsed = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
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
  return runMigrations(typeof structuredClone==='function' ? structuredClone(clean) : JSON.parse(JSON.stringify(clean)));
}

export function validateStoreData(data){
  const errors=[];
  if(!data || typeof data!=='object' || Array.isArray(data)) return { ok:false, errors:['Expected an object.'] };
  if(data.version!=null && (!Number.isInteger(Number(data.version)) || Number(data.version)<1)) errors.push('Schema version must be a positive integer.');
  if(Number(data.version) > STORE_SCHEMA_VERSION) errors.push(`Schema version ${data.version} is newer than this app supports (${STORE_SCHEMA_VERSION}).`);
  if(data.history!=null && !Array.isArray(data.history)) errors.push('History must be an array.');
  for(const [i,session] of (data.history||[]).entries()){
    if(!session || typeof session!=='object') { errors.push(`History item ${i+1} is not an object.`); continue; }
    if(!session.id) errors.push(`History item ${i+1} is missing an id.`);
    // dateISO is load-bearing: sorting, week bucketing and training age all key
    // off it, so an entry without a parseable date would poison analytics.
    if(typeof session.dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(session.dateISO) || Number.isNaN(Date.parse(session.dateISO))) errors.push(`History item ${i+1} has an invalid or missing dateISO.`);
    if(session.blocks!=null && !Array.isArray(session.blocks)) errors.push(`History item ${i+1} blocks must be an array.`);
    for(const block of session.blocks||[]) if(!block?.exerciseId || !Array.isArray(block.sets)) errors.push(`History item ${i+1} contains an invalid exercise block.`);
  }
  if(data.activeSchedule!=null && typeof data.activeSchedule!=='object') errors.push('Active schedule must be an object or null.');
  if(data.eventHistory!=null && !Array.isArray(data.eventHistory)) errors.push('Event history must be an array.');
  if(data.evaluationLedger!=null && !Array.isArray(data.evaluationLedger)) errors.push('Evaluation ledger must be an array.');
  if(data.healthSummary!=null && typeof data.healthSummary!=='object') errors.push('Health summary must be an object or null.');
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
    progressionOverrides: { ...(importedStore.progressionOverrides||{}), ...(currentStore.progressionOverrides||{}) },
    readinessLog: [...(currentStore.readinessLog||[]), ...(importedStore.readinessLog||[])].filter((v,i,a)=> a.findIndex(x=> x.dateISO===v.dateISO && x.at===v.at)===i),
    evaluationLedger: mergeEvaluationLedgers(currentStore.evaluationLedger, importedStore.evaluationLedger),
    customTemplates: mergeCustomTemplates(currentStore.customTemplates, importedStore.customTemplates),
    programHistory: [...(currentStore.programHistory||[]), ...(importedStore.programHistory||[])].filter((v,i,a)=> a.findIndex(x=> x.programId===v.programId && x.version===v.version)===i),
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

