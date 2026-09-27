import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EVALUATION_KEY } from '../src/lib/longitudinalCore.js';
import { summarizeEvaluationLedger } from '../src/lib/evaluationSummary.js';

describe('analytics worker boundary', ()=>{
  it('passes the real evaluation ledger into the worker', async ()=>{
    const originalWorker = globalThis.Worker;
    const originalStorage = globalThis.localStorage;
    const ledger = [{ id:'open-1', recommendation:{ load:20 }, provenance:{ recommendationSource:'live-engine' } }];
    const storage = new Map([[EVALUATION_KEY, JSON.stringify({ schemaVersion:2, records:ledger })]]);
    let postedLedger = null;

    globalThis.localStorage = {
      getItem:key=> storage.get(key) ?? null,
      setItem:(key,value)=> storage.set(key, String(value)),
      removeItem:key=> storage.delete(key),
    };
    globalThis.Worker = class FakeWorker {
      postMessage(message){
        postedLedger = message.payload?.ledger;
        const result = summarizeEvaluationLedger(message.payload);
        queueMicrotask(()=> this.onmessage?.({ data:{ id:message.id, ok:true, result } }));
      }
      terminate(){}
    };

    try{
      const { longitudinalSummaryAsync } = await import(`../src/lib/analyticsWorker.js?worker-test=${Date.now()}`);
      const result = await longitudinalSummaryAsync({ preferences:{ telemetryEnabled:true } });
      assert.deepEqual(postedLedger, ledger);
      assert.equal(result.consented, true);
      assert.equal(result.evaluation.totalRecords, 1);
      assert.equal(result.evaluation.openRecords, 1);
    }finally{
      if(originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker;
      if(originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
    }
  });
});
