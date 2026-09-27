// analytics-worker.js — the inside of the analytics Web Worker.
//
// Deliberately tiny: it imports the pure evaluation summary and answers
// messages. The main thread sends the ledger explicitly because Web Workers
// cannot read localStorage.

import { summarizeEvaluationLedger } from './evaluationSummary.js';

self.onmessage = (event)=>{
  const { id, payload } = event.data || {};
  try{
    const result = summarizeEvaluationLedger(payload || {});
    self.postMessage({ id, ok: true, result });
  }catch(error){
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
