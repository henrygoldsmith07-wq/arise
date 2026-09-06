// idb-tx.js — atomic multi-store writes for the canonical IDB layout.
//
// The canonical save decomposes the store across ten object stores. Doing
// that as ten independent readwrite transactions means a crash (tab closed,
// battery gone, process killed) mid-save leaves stores from different points
// in time: recomposition then yields a history that disagrees with its
// programme, or a ledger half-moved between recommendations and outcomes.
// One transaction over all touched stores makes a save all-or-nothing —
// IndexedDB aborts the whole transaction if anything throws or the page dies
// mid-commit, leaving the previous consistent state on disk.
//
// The in-memory fallback keeps identical semantics (it is already atomic by
// construction), so tests exercise the same call shape without a browser.

const SUPPORTED_STORES = new Set([
  'profile','sessions','sets','programme','adaptations',
  'recommendations','outcomes','events','readiness','templates','quarantine','snapshots','archive','tombstones',
]);

let dbRef = null;          // shared open handle, set by idb.js on first use
let fallbackRef = null;    // shared in-memory backend, same lifecycle
let pendingBinding = null; // resolves when the shared open settles

/** Wired up by idb.js so this module never opens its own connection. */
export function bindTransactionSources({ db, fallback }){
  dbRef = db || null;
  fallbackRef = fallback || null;
  if(pendingBinding){ pendingBinding.resolve(); pendingBinding = null; }
}

/**
 * Awaitable handle for callers that might race the shared open.
 */
export function transactionSourcesBound(){
  if(!pendingBinding){
    let resolve;
    const promise = new Promise((r)=> { resolve = r; });
    pendingBinding = { promise, resolve };
    // Already bound (tests bind synchronously): retire the wait immediately.
    if(dbRef || fallbackRef){ pendingBinding.resolve(); pendingBinding = null; }
    return promise;
  }
  return pendingBinding.promise;
}

/**
 * Run `fn(ops)` inside ONE transaction across the given stores.
 *
 * `ops` exposes queueable writes only — put/delete/clear — because a
 * transaction commits when the microtask queue drains and awaiting a read
 * mid-write would close it. Reads belong before the transaction (hydration)
 * or after it (verification).
 *
 * Returns a promise that resolves when the transaction has durably committed
 * (real IndexedDB) or immediately (memory fallback). Rejects on any abort,
 * and the caller's exception aborts the transaction rather than partially
 * committing it.
 */
export async function idbTransaction(storeNames, fn){
  const names = [...new Set(storeNames)];
  for(const name of names){
    if(!SUPPORTED_STORES.has(name)) throw new Error(`Unknown object store: ${name}`);
  }
  // Memory fallback (node tests / old browsers). The shared backend mutates
  // synchronously, so a bare fn() would leak partial writes on a mid-batch
  // throw — real IndexedDB aborts the WHOLE transaction. Snapshot every
  // touched store first and roll back on any throw so the fallback matches
  // production abort semantics exactly.
  //
  // The fallback is only "final" once the shared open has settled; if the
  // caller races that open, wait for it instead of throwing unbound.
  if(typeof indexedDB === 'undefined' || !dbRef){
    if(pendingBinding){ await transactionSourcesBound(); }
    else if(!fallbackRef && typeof indexedDB !== 'undefined'){
      // Racing the shared open (idb.js binds async at module load): wait for
      // the real outcome instead of throwing "No storage backend bound".
      try{ const { idbOpenPromise } = await import('./idb.js'); await idbOpenPromise; }catch{}
    }
  }
  if(!dbRef){
    const fb = fallbackRef;
    if(!fb) throw new Error('No storage backend bound.');
    const snapshot = new Map();
    for(const name of names) snapshot.set(name, await fb.getAll(name));
    try{
      const ops = {
        put: (store, value, key)=> { fb.put(store, value, key); },
        delete: (store, key)=> { fb.delete(store, key); },
        clearStore: (store)=> { fb.clearStore(store); },
      };
      fn(ops);
      return;
    }catch(err){
      for(const name of names){
        fb.clearStore(name);
        for(const row of snapshot.get(name) || []) fb.put(name, row, row?.id ?? undefined);
      }
      throw err;
    }
  }
  const db = dbRef;
  await new Promise((resolve, reject)=>{
    let result;
    const t = db.transaction(names, 'readwrite');
    const stores = new Map(names.map((name)=> [name, t.objectStore(name)]));
    const ops = {
      put: (store, value, key)=>{
        const os = stores.get(store);
        if(!os) throw new Error(`Store ${store} is not part of this transaction.`);
        return key != null ? os.put(value, key) : os.put(value);
      },
      delete: (store, key)=>{
        const os = stores.get(store);
        if(!os) throw new Error(`Store ${store} is not part of this transaction.`);
        os.delete(key);
      },
      clearStore: (store)=>{
        const os = stores.get(store);
        if(!os) throw new Error(`Store ${store} is not part of this transaction.`);
        os.clear();
      },
    };
    try{ result = fn(ops); }
    catch(err){ try{ t.abort(); }catch{} reject(err); return; }
    t.oncomplete = ()=> resolve(result);
    t.onerror = ()=> reject(t.error || new Error('Transaction failed.'));
    t.onabort = ()=> reject(t.error || new Error('Transaction aborted.'));
  });
}
