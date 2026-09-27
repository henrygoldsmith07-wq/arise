// evaluationLedgerBridge.js — tiny cycle-safe bridge between the synchronous
// longitudinal evidence API and the hydrated IndexedDB-backed store.
//
// storage.js binds the live adapter after module initialisation. longitudinal.js
// can therefore remain synchronous for render-time callers and pure tests,
// without importing storage.js and creating the storage → integrity → export →
// longitudinal → storage cycle.

let adapter = null;

export function bindEvaluationLedgerAdapter(next){
  adapter = next && typeof next === 'object' ? next : null;
}

export function readCanonicalEvaluationLedger(){
  try{
    const rows = adapter?.read?.();
    return Array.isArray(rows) ? rows : null;
  }catch{ return null; }
}

export function replaceCanonicalEvaluationLedger(records){
  try{ return adapter?.replace?.(Array.isArray(records) ? records : []) === true; }
  catch{ return false; }
}

export function clearCanonicalEvaluationLedger(){
  try{ return adapter?.clear?.() === true; }
  catch{ return false; }
}
