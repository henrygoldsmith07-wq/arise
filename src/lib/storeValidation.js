// storeValidation.js — the strict store/backup shape gate.
//
// Lives apart from export.js on purpose: boot-time integrity checking
// (integrity.js, reached from storage.js) only needs this validator, and
// importing it from export.js dragged the whole export/sync/evaluation/study
// graph (~25 kB gz) into the first-paint chunk. export.js re-exports it.
import { isDateOnly } from './dateOnly.js';

export const VALIDATION_SCHEMA_VERSION = 9; // must equal STORE_SCHEMA_VERSION (asserted in tests)

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
  if(Number(data.version) > VALIDATION_SCHEMA_VERSION) errors.push(`Schema version ${data.version} is newer than this app supports (${VALIDATION_SCHEMA_VERSION}).`);
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
  if(data.experiments!=null && !Array.isArray(data.experiments)) errors.push('Experiments must be an array.');
  return { ok: errors.length===0, errors };
}
