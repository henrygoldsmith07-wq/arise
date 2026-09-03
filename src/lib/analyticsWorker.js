// analyticsWorker.js — move heavy longitudinal evaluation off the main thread.
//
// `longitudinalSummary` walks the whole evaluation ledger with clustering and
// segment statistics. On a phone with a year of training data that is real
// work, and it runs inside a render path (ProgressView's useMemo) — the main
// thread stutters exactly when the user opens their progress screen.
//
// The work itself is pure: same inputs, same output, no DOM. That makes it
// safe to evaluate inside a Web Worker with the module imported directly.
// Vite rewrites `new Worker(new URL(...), { type: 'module' })` into its own
// build chunk, so the evaluation graph ships separately from the main
// bundle and loads only when first needed. When workers are unavailable
// (tests, old browsers) the same function runs inline — the caller's
// contract is identical, only the timing differs (promise vs sync).

import { longitudinalSummary } from './longitudinal.js';

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker(){
  if(worker !== null) return worker;
  try{
    if(typeof Worker === 'undefined') worker = false;
    else worker = new Worker(new URL('./analytics-worker.js', import.meta.url), { type: 'module' });
  }catch{ worker = false; }
  if(worker){
    worker.onmessage = (event)=>{
      const { id, ok, result, error } = event.data || {};
      const entry = pending.get(id);
      if(!entry) return;
      pending.delete(id);
      if(ok) entry.resolve(result);
      else entry.reject(new Error(error || 'Worker evaluation failed.'));
    };
    worker.onerror = ()=>{
      // Any worker-level failure demotes everything to inline evaluation —
      // correctness first, responsiveness second.
      for(const entry of pending.values()) entry.reject(new Error('Worker failed.'));
      pending.clear();
      try{ worker.terminate(); }catch{}
      worker = false;
    };
  }
  return worker;
}

/**
 * Same contract as `longitudinalSummary({ preferences, config })`, but the
 * evaluation happens off the main thread when possible. Always resolves
 * (never throws for environmental reasons) so a caller can treat the result
 * as "best available evaluation" without try/catch.
 */
export async function longitudinalSummaryAsync({ preferences = null, config = null } = {}){
  const w = getWorker();
  if(w){
    const id = ++seq;
    try{
      const result = await new Promise((resolve, reject)=> {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, payload: { preferences, config } });
      });
      return result;
    }catch{
      try{ w.terminate(); }catch{}
      worker = false;
    }
  }
  try{ return longitudinalSummary({ preferences, config }); }
  catch{ return { consented: false, evaluation: null }; }
}
