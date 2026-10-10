// idb.js — minimal IndexedDB wrapper with the canonical Arise object stores.
//
// Layout (v2; v1 as shipped, v2 adds 'quarantine' for validated-boot repairs):
//   profile         id:'profile'   version/onboarding/preferences/healthSummary
//   sessions        id             one record per completed session (sets embedded;
//                                  the sets store mirrors them flattened for queries)
//   sets            auto           flattened {sessionId,dateISO,exerciseId,index,reps,weightKg,rpe}
//   programme       id:'active'    activeSchedule + programHistory
//   adaptations     id             mirrored adaptation-history rows (queryable)
//   recommendations id              evaluation-ledger rows awaiting outcomes
//   outcomes        id             evaluation-ledger rows with attached outcomes
//   events          auto           durable event measurements
//   readiness       id:'log'       readiness log entries
//   templates       id             user-created templates
//   experiments     id             training experiments (trainingExperiments.js)
//
// When IndexedDB is unavailable (node tests / very old browsers) the wrapper
// transparently falls back to an in-memory backend with identical semantics,
// so every caller stays testable and fail-soft.

const DB_NAME = 'arise-idb-v1';
const DB_VERSION = 6; // v2 'quarantine'; v3 snapshots+indexes; v4 'archive'; v5 'tombstones'; v6 'experiments'.

export const STORES = ['profile','sessions','sets','programme','adaptations','recommendations','outcomes','events','readiness','templates','quarantine','snapshots','archive','tombstones','experiments'];

let dbPromise = null;

function memoryBackend(){
  const data = new Map();
  let auto = 0;
  return {
    __memory: true,
    // get/getAll must unwrap the internal wrapper exactly like real
    // IndexedDB resolves the stored value — otherwise the fallback backend
    // diverges from production semantics (programme/readiness reads came
    // back as {__store,id,value} envelopes and hydration lost fields).
    get: (store, key)=> Promise.resolve(data.get(`${store}::${key}`)?.value ?? null),
    getAll: (store)=> Promise.resolve([...data.values()].filter(r => r.__store === store).map(r => r.value)),
    put: (store, value, key)=>{
      const k = key ?? value?.id ?? ++auto;
      data.set(`${store}::${k}`, { __store: store, id: k, value });
      return Promise.resolve(k);
    },
    delete: (store, key)=> { data.delete(`${store}::${key}`); return Promise.resolve(); },
    clearStore: (store)=> { for(const k of [...data.keys()]) if(k.startsWith(`${store}::`)) data.delete(k); return Promise.resolve(); },
  };
}

// Why indexedDB.open failed, if it did. Recorded the moment it happens, so it
// is available to callers before the first read/write settles. Deliberately
// never cleared: dbPromise is cached, so within one page session a failed open
// cannot become a successful one — the recovery is a reload, which resets this
// module. Environments with no indexedDB at all are NOT failures (see
// getFallbackError).
let openError = null;

function openDb(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject)=>{
    try{
      if(typeof indexedDB === 'undefined'){ resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onblocked = ()=> { /* older tab still open on a previous version; upgrade waits */ };
      req.onupgradeneeded = ()=> {
        const db = req.result;
        const autoStores = new Set(['sets', 'events']);
        for(const name of STORES){
          if(!db.objectStoreNames.contains(name)){
            // sets/events rows always carry an `id` field (splitSets, event
            // normalisation); keying on it keeps delete-by-id consistent with
            // the memory fallback, while autoIncrement still covers id-less
            // legacy rows by assigning into the record.
            db.createObjectStore(name, autoStores.has(name) ? { keyPath: 'id', autoIncrement: true } : { keyPath: 'id' });
          }
        }
        // v3: indexes backing queries.js (date / exercise / session lookups)
        // and the automatic-snapshot store (snapshots.js).
        const up = req.transaction;
        const idx = (storeName, indexName, keyPath)=> {
          if(!db.objectStoreNames.contains(storeName)) return;
          const os = up.objectStore(storeName);
          if(os && !os.indexNames.contains(indexName)) os.createIndex(indexName, keyPath);
        };
        idx('sets', 'by_date', 'dateISO');
        idx('sets', 'by_exercise', 'exerciseId');
        idx('sets', 'by_session', 'sessionId');
        idx('sessions', 'by_date', 'dateISO');
        idx('events', 'by_at', 'at');
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> { openError = req.error; reject(req.error); };
    }catch(err){ openError = err; reject(err); }
  });
  return dbPromise;
}

function tx(db, store, mode, fn){
  return new Promise((resolve, reject)=>{
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    try{ result = fn(os); }
    catch(err){ reject(err); return; }
    t.oncomplete = ()=> resolve(result?._req ? result._req.result : result);
    t.onerror = ()=> reject(t.error);
    t.onabort = ()=> reject(t.error);
  });
}

let sharedFallback = null;
// Whether the most recent backend() resolution was the in-memory fallback.
// Distinct from usingFallback() (which asks whether indexedDB exists): this
// says whether writes are genuinely durable. Used by storage.js so a write
// that only reached memory cannot clear the failure banner — the promise
// resolves, but the data dies with the tab.
let memoryBackendActive = false;
function fallback(){
  // One shared in-memory instance whenever a real DB is unavailable or fails
  // to open — per-call construction silently loses every write.
  return sharedFallback ||= memoryBackend();
}

async function backend(){
  try{
    const db = await openDb();
    if(db){
      memoryBackendActive = false;
      return {
        get: (store, key)=> tx(db, store, 'readonly', os => {
          const req = os.get(key);
          req._req = req;
          return req;
        }).then(r => r),
        getAll: (store)=> tx(db, store, 'readonly', os => {
          const req = os.getAll();
          req._req = req;
          return req;
        }),
        put: (store, value, key)=>{
          // Every store now has keyPath 'id' (v4). Passing an explicit key to
          // a keyPath store throws, so route through it uniformly.
          return tx(db, store, 'readwrite', os => os.put(value));
        },
        delete: (store, key)=> tx(db, store, 'readwrite', os => os.delete(key)),
        clearStore: (store)=> tx(db, store, 'readwrite', os => os.clear()),
      };
    }
    // indexedDB is undefined (e.g. node tests / very old browsers) — a legitimate
    // environment, not a failure, and every store is memory by design.
    memoryBackendActive = false;
    return fallback();
  }catch(err){
    // indexedDB EXISTS but open failed: this is a real persistence failure.
    // Record the reason so storage.js can surface a clear message instead of
    // silently operating in throwaway memory mode (where every write is lost
    // on reload and the user has no idea).
    openError = openError || err;
    memoryBackendActive = true;
    return fallback();
  }
}

// True when this process has no indexedDB at all (node tests, ancient browsers)
// — in which case memory mode is the intended contract, not a failure.
export function isStorageEnvironmentBroken(){
  if(typeof indexedDB === 'undefined') return false;
  return Boolean(openError);
}

// Exposed so storage.js can detect "IDB exists but failed to open" and surface
// a clear, recoverable error instead of silently falling back to memory.
// Page-lifetime latched by design: dbPromise is cached, so a failed open cannot
// recover within this session. Recovery is a reload, which resets this module.
export function getFallbackError(){
  if(typeof indexedDB === 'undefined') return null;
  return openError || null;
}

// True when the most recent write only reached the in-memory fallback.
export function isMemoryBackendActive(){ return memoryBackendActive; }

// In environments without IndexedDB every operation routes through the
// shared in-memory fallback; otherwise we go straight to the real backend.
function usingFallback(){ return typeof indexedDB === 'undefined'; }

// The atomic-write layer (idb-tx.js) shares this module's single connection
// and fallback instance instead of opening its own — one upgrade path, one
// 'versionchange' owner, one shared in-memory backend for tests. The promise
// resolves even when no DB exists, so the binding learns the real outcome.
import { bindTransactionSources, transactionSourcesBound } from './idb-tx.js';
const openPromise = openDb()
  .then((db)=> {
    bindTransactionSources({ db, fallback: db ? null : fallback() });
  })
  .catch(()=> {
    bindTransactionSources({ db: null, fallback: fallback() });
  });
// Callers that reach the transaction layer before the shared open settles
// (demo exit racing boot) wait for this instead of throwing unbound.
export { openPromise as idbOpenPromise };

export async function idbGet(store, key){
  if(usingFallback()) return fallback().get(store, key);
  const b = await backend();
  return b.get(store, key);
}
export async function idbGetAll(store){
  if(usingFallback()) return fallback().getAll(store);
  const b = await backend();
  return b.getAll(store);
}
export async function idbPut(store, value, key){
  if(usingFallback()) return fallback().put(store, value, key);
  const b = await backend();
  return b.put(store, value, key);
}
export async function idbDelete(store, key){
  if(usingFallback()) return fallback().delete(store, key);
  const b = await backend();
  return b.delete(store, key);
}
export async function idbClearStore(store){
  if(usingFallback()) return fallback().clearStore(store);
  const b = await backend();
  return b.clearStore(store);
}
