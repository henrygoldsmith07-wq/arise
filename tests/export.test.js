import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportPayload, parseImportFile, mergeStores, validateStoreData } from '../src/lib/export.js';
import { STORE_SCHEMA_VERSION } from '../src/lib/store.js';

describe('export / import', ()=>{
  it('round-trips and merges', ()=>{
    const store = { version:1, onboarding:{goal:'strength',equipment:['dumbbells'],location:'home'}, activeSchedule:null, history:[{id:'a',dateISO:'2026-01-01'}], preferences:{units:'kg'}};
    const payload = buildExportPayload(store);
    const parsed = parseImportFile(JSON.stringify(payload));
    assert.equal(parsed.version, STORE_SCHEMA_VERSION);
    assert.equal(parsed.history[0].id, store.history[0].id);
    assert.equal(parsed.history[0].dateISO, store.history[0].dateISO);
    assert.deepEqual(parsed.onboarding, store.onboarding);
    assert.equal(parsed.healthSummary, null);
    assert.deepEqual(parsed.eventHistory, []);

    const current = { version:1, onboarding:null, activeSchedule:null, history:[{id:'a',dateISO:'2026-01-01'},{id:'b',dateISO:'2026-01-02'}], preferences:{} };
    const imported = { version:1, onboarding:{goal:'general'}, activeSchedule:null, history:[{id:'a',dateISO:'2026-01-01'},{id:'c',dateISO:'2026-01-03'}], preferences:{} };
    const merged = mergeStores(current, imported, 'merge');
    assert.equal(merged.history.length, 3);
    const replaced = mergeStores(current, imported, 'replace');
    assert.equal(replaced.history.length, 2);
  });

  it('rejects non-json', ()=>{
    assert.throws(()=> parseImportFile('not json'));
  });

  it('validates malformed history before migration', ()=>{
    const result=validateStoreData({ version:1, history:[{ id:'broken', blocks:'not-an-array' }] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error=> error.includes('blocks')));
    assert.throws(()=> parseImportFile(JSON.stringify({ app:'arise', data:{ version:1, history:[{ id:'broken', blocks:'bad' }] } })), /validation failed/);
  });

  it('merges event history and optional health summary', ()=>{
    const current={ version:4, history:[], eventHistory:[{ id:'e1', type:'session:start', at:'2026-01-01T00:00:00Z' }], healthSummary:{ source:'phone', steps:1000 }, preferences:{} };
    const imported={ version:4, history:[], eventHistory:[{ id:'e2', type:'session:complete', at:'2026-01-02T00:00:00Z' }], healthSummary:{ source:'watch', steps:2000 }, preferences:{} };
    const merged=mergeStores(current, imported, 'merge');
    assert.equal(merged.eventHistory.length, 2);
    assert.equal(merged.healthSummary.steps, 1000);
  });
});
