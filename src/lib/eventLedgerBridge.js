// eventLedgerBridge.js — cycle-safe bridge between synchronous telemetry
// helpers and the hydrated IndexedDB-backed store. storage.js binds the live
// adapter after module initialisation; telemetry.js can stay synchronous for
// render-time callers and unit tests without importing storage.js directly.

let adapter = null;

export function bindEventLedgerAdapter(next){
  adapter = next && typeof next === 'object' ? next : null;
}

export function readCanonicalEventHistory(){
  try{
    const rows = adapter?.read?.();
    return Array.isArray(rows) ? rows : null;
  }catch{ return null; }
}

export function replaceCanonicalEventHistory(events){
  try{ return adapter?.replace?.(Array.isArray(events) ? events : []) === true; }
  catch{ return false; }
}

export function clearCanonicalEventHistory(){
  try{ return adapter?.clear?.() === true; }
  catch{ return false; }
}
