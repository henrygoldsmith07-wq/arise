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
 * A single health label for the UI.
 *   'ok'         — plenty of headroom (or unknown)
 *   'warning'    — usage crossed 80% of the estimated quota
 *   'critical'   — usage crossed 95%; writes may start failing
 *   'evictable'  — the browser has NOT granted persistent storage, so data
 *                  can in principle be removed under pressure
 */
export async function storageHealth(){
  const persisted = await isStoragePersisted();
  const estimate = await storageEstimate();
  const ratio = estimate && estimate.quotaBytes > 0 ? estimate.usageBytes / estimate.quotaBytes : 0;
  const level = ratio >= 0.95 ? 'critical' : ratio >= 0.8 ? 'warning' : 'ok';
  return { estimate, persisted, level, ratio };
}
