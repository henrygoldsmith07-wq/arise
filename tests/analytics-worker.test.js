import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EVALUATION_KEY } from '../src/lib/longitudinalCore.js';

describe('longitudinalSummaryAsync (no dedicated worker)', ()=>{
  it('evaluates the real ledger inline and never spawns a Worker', async ()=>{
    const originalWorker = globalThis.Worker;
    const originalStorage = globalThis.localStorage;
    const ledger = [{ id:'open-1', recommendation:{ load:20 }, provenance:{ recommendationSource:'live-engine' } }];
    const storage = new Map([[EVALUATION_KEY, JSON.stringify({ schemaVersion:2, records:ledger })]]);
    let spawned = 0;
    globalThis.localStorage = { getItem:k=> storage.get(k) ?? null, setItem:(k,v)=> storage.set(k,String(v)), removeItem:k=> storage.delete(k) };
    globalThis.Worker = class { constructor(){ spawned++; } };
    try{
      const { longitudinalSummaryAsync } = await import(`../src/lib/analyticsWorker.js?t=${Date.now()}`);
      const result = await longitudinalSummaryAsync({ preferences:{ telemetryEnabled:true } });
      assert.equal(spawned, 0);
      assert.equal(result.consented, true);
      assert.equal(result.evaluation.totalRecords, 1);
    }finally{
      if(originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker;
      if(originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
    }
  });
});
