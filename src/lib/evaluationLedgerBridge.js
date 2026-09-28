// Cycle-safe synchronous adapters for canonical ledgers. storage.js binds
// them after module initialisation so consumers never import storage.js back.
const adapters = Object.create(null);

export function bindCanonicalLedger(key, next){
  adapters[key] = next && typeof next === 'object' ? next : null;
}
export function readCanonicalLedger(key){
  try{
    const rows = adapters[key]?.read?.();
    return Array.isArray(rows) ? rows : null;
  }catch{ return null; }
}
export function replaceCanonicalLedger(key, rows){
  try{ return adapters[key]?.replace?.(Array.isArray(rows) ? rows : []) === true; }
  catch{ return false; }
}
export function clearCanonicalLedger(key){
  try{ return adapters[key]?.clear?.() === true; }
  catch{ return false; }
}
