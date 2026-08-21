// Export / restore / import — versioned JSON backup for local-first data.
// No cloud sync; the user owns the file.

import { runMigrations, STORE_SCHEMA_VERSION } from './store.js';
import { getEventHistory } from './telemetry.js';

export const EXPORT_VERSION = 3;

export function buildExportPayload(store){
  const eventHistory=getEventHistory();
  const data={ ...store, version: store.version || STORE_SCHEMA_VERSION, eventHistory };
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

export function parseImportFile(text){
  let parsed;
  try{ parsed = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  const data = parsed?.data ? parsed.data : parsed;
  if(!data || typeof data !== 'object') throw new Error('Import file is empty or malformed.');
  if(parsed?.app && parsed.app !== 'arise') throw new Error('This backup is not for Arise.');
  if(!('history' in data) && !('onboarding' in data) && !('activeSchedule' in data) && !('eventHistory' in data)){
    throw new Error('Unrecognised backup shape — missing history/onboarding/schedule/event history.');
  }
  const validation=validateStoreData(data);
  if(!validation.ok) throw new Error(`Backup validation failed: ${validation.errors.join(' ')}`);
  return runMigrations(typeof structuredClone==='function' ? structuredClone(data) : JSON.parse(JSON.stringify(data)));
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
    if(session.blocks!=null && !Array.isArray(session.blocks)) errors.push(`History item ${i+1} blocks must be an array.`);
    for(const block of session.blocks||[]) if(!block.exerciseId || !Array.isArray(block.sets)) errors.push(`History item ${i+1} contains an invalid exercise block.`);
  }
  if(data.activeSchedule!=null && typeof data.activeSchedule!=='object') errors.push('Active schedule must be an object or null.');
  if(data.eventHistory!=null && !Array.isArray(data.eventHistory)) errors.push('Event history must be an array.');
  if(data.healthSummary!=null && typeof data.healthSummary!=='object') errors.push('Health summary must be an object or null.');
  return { ok: errors.length===0, errors };
}

export function mergeStrategyLabel(strategy){
  return strategy === 'replace' ? 'Replace (overwrite this device)' : 'Merge (keep both, de-dupe by session id)';
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
    history: [...byId.values()].sort((a,b)=> a.dateISO.localeCompare(b.dateISO)),
    eventHistory: [...eventById.values()].sort((a,b)=> String(a.at||'').localeCompare(String(b.at||''))),
    healthSummary: currentStore.healthSummary || importedStore.healthSummary || null,
    preferences: { ...(importedStore.preferences||{}), ...(currentStore.preferences||{}) },
    readinessLog: [...(currentStore.readinessLog||[]), ...(importedStore.readinessLog||[])].filter((v,i,a)=> a.findIndex(x=> x.dateISO===v.dateISO && x.at===v.at)===i),
    programHistory: [...(currentStore.programHistory||[]), ...(importedStore.programHistory||[])].filter((v,i,a)=> a.findIndex(x=> x.programId===v.programId && x.version===v.version)===i),
  };
}

// Data portability: full export in portable JSON + selective export
export function portableJson(store){
  return JSON.stringify(buildExportPayload(store), null, 2);
}
export function portableCsv(history){
  const rows = [['dateISO','exerciseId','reps','weightKg','rpe','side','rom','assistedKg','failed','skipped','durationMinutes','programVersion','equipmentSnapshot']];
  for(const h of history||[]) for(const b of h.blocks||[]) for(const s of b.sets||[]){
    rows.push([h.dateISO, b.exerciseId, s.reps||'', s.weightKg||'', s.rpe||'', s.side||'', s.rom||'', s.assistedKg||'', s.failed?'1':'', s.skipped?'1':'', h.durationMinutes||'', h.programVersion||'', Array.isArray(h.equipmentSnapshot)? h.equipmentSnapshot.join('|') : '']);
  }
  return rows.map(r=> r.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
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
