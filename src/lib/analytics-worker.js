// analytics-worker.js — the inside of the analytics Web Worker.
//
// Deliberately tiny: it imports the pure evaluation and answers messages.
// Bundled as a module worker via `new URL('./analytics-worker.js',
// import.meta.url)`, so Vite builds it as its own chunk with the whole
// evaluation graph (longitudinal.js and its imports) — the main bundle only
// carries this thin shell plus the spawn call.
//
// One request at a time is fine: the evaluation is CPU-bound and the spawn
// is per-page, so a queue would only reorder work, not speed it up.

import { longitudinalSummary } from './longitudinal.js';

self.onmessage = (event)=>{
  const { id, payload } = event.data || {};
  try{
    const result = longitudinalSummary(payload || {});
    self.postMessage({ id, ok: true, result });
  }catch(error){
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
