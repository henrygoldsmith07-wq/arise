// idb.js — minimal IndexedDB wrapper with the canonical Arise object stores.
//
// Layout (v1):
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
//
// When IndexedDB is unavailable (node tests / very old browsers) the wrapper
// transparently falls back to an in-memory backend with identical semantics,
// so every caller stays testable and fail-soft.

const DB_NAME = 'arise-idb-v1';
const DB_VERSION = 1;

export const STORES = ['profile','sessions','sets','programme','adaptations','recommendations','outcomes','events','readiness','templates'];

let dbPromise = null;

function memoryBackend(){
  const data = new Map();
  let auto = 0;
  return {
    __memory: true,
    get: (store, key)=> Promise.resolve(data.get(`${store}::${key}`)),
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

function openDb(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject)=>{
    try{
      if(typeof indexedDB === 'undefined'){ resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = ()=> {
        const db = req.result;
        for(const name of STORES){
          if(!db.objectStoreNames.contains(name)){
            db.createObjectStore(name, name === 'sets' || name === 'events' ? { autoIncrement: true } : { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    }catch(err){ reject(err); }
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
function fallback(){
  // One shared in-memory instance whenever a real DB is unavailable or fails
  // to open — per-call construction silently loses every write.
  return sharedFallback ||= memoryBackend();
}

async function backend(){
  try{
    const db = await openDb();
    if(db){
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
          const hasKP = store !== 'sets' && store !== 'events';
          return tx(db, store, 'readwrite', os => hasKP ? os.put(value) : os.put(value, key));
        },
        delete: (store, key)=> tx(db, store, 'readwrite', os => os.delete(key)),
        clearStore: (store)=> tx(db, store, 'readwrite', os => os.clear()),
      };
    }
  }catch{}
  return fallback();
}

// In environments without IndexedDB every operation routes through the
// shared in-memory fallback; otherwise we go straight to the real backend.
function usingFallback(){ return typeof indexedDB === 'undefined'; }

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
