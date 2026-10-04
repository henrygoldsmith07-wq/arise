// storageQuota.js — visibility into a finite resource.
//
// Everything Arise keeps now lives in IndexedDB, which browsers treat as
// best-effort storage: under pressure an origin that never calls
// navigator.storage.persist() can be evicted, and a user who never sees a
// quota warning loses data without ever knowing there was a risk. This module
// makes the situation observable — estimate, persistence status, a request
// for persistence, and a stable health label the UI can render.
//
// Fail-soft everywhere: unsupported browsers report 'unknown' and the UI
// simply shows nothing rather than nagging.

const BYTES_PER_MB = 1024 * 1024;

// Once-per-device latch for the automatic request. Asking on every launch
// would re-prompt a user who already declined; More keeps a manual retry.
export const PERSIST_REQUESTED_KEY = 'arise.persistRequested.v1';

function safeStorage(storage){
  if(storage) return storage;
  try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch{ return null; }
}

export async function storageEstimate(){
  try{
    if(typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usageBytes: usage, quotaBytes: quota, usageMb: Math.round(usage / BYTES_PER_MB * 10) / 10, quotaMb: Math.round(quota / BYTES_PER_MB) };
  }catch{ return null; }
}

/** Whether the browser has marked this origin's storage as persistent. */
export async function isStoragePersisted(){
  try{
    if(typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  }catch{ return null; }
}

/**
 * Ask the browser to make storage persistent (no eviction without user
 * action). Chrome grants this automatically for installed PWAs and for
 * origins with meaningful engagement; elsewhere it may show a prompt.
 * Returns the granted status, or null when unsupported.
 */
export async function requestPersistentStorage(){
  try{
    if(typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
    return await navigator.storage.persist();
  }catch{ return null; }
}

/**
 * The automatic data-loss-protection path: called once the user has logged a
 * real session, because that is the first moment there is anything worth
 * losing. No-ops when the origin is already persistent or when this device was
 * asked before, so the browser prompt is never repeated.
 *
 * Returns true/false for a granted/declined request, or null when the request
 * was skipped (already persistent, already asked, or unsupported).
 */
export async function requestPersistentStorageOnce({
  storage = null,
  atISO = new Date().toISOString(),
  persist = requestPersistentStorage,
  alreadyPersisted = isStoragePersisted,
} = {}){
  if(await alreadyPersisted() === true) return true;
  const target = safeStorage(storage);
  try{ if(target?.getItem(PERSIST_REQUESTED_KEY)) return null; }catch{}
  try{ target?.setItem(PERSIST_REQUESTED_KEY, atISO); }catch{}
  return await persist();
}

/**
 * A single health label for the UI.
 *   'ok'         — plenty of headroom (or unknown)
 *   'warning'    — usage crossed 80% of the estimated quota
 *   'critical'   — usage crossed 95%; writes may start failing
 *
 * Eviction risk is NOT encoded as a level: it is a function of `persisted`
 * (see storageHealth's return), not of how full the quota is, and conflating
 * the two would let a 2% full-but-evictable store read as 'ok'.
 */
export async function storageHealth(){
  const persisted = await isStoragePersisted();
  const estimate = await storageEstimate();
  const ratio = estimate && estimate.quotaBytes > 0 ? estimate.usageBytes / estimate.quotaBytes : 0;
  const level = ratio >= 0.95 ? 'critical' : ratio >= 0.8 ? 'warning' : 'ok';
  return { estimate, persisted, level, ratio };
}
