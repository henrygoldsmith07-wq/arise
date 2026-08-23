import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAiSettings, saveAiSettings, clearAiSettings,
  buildTrainingContext, requestCoachInsight, DEFAULT_MODEL,
} from '../src/lib/aiCoach.js';

function withStorage(fn){
  const mem = {};
  globalThis.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k,v)=> { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
  };
  try{ fn(mem); }finally{ delete globalThis.localStorage; }
}

function sess(dateISO, blocks){ return { id:`s-${dateISO}`, dateISO, blocks }; }
function set(reps, kg){ return { reps:String(reps), weightKg:String(kg), rpe:'' }; }

describe('ai settings storage', ()=>{
  it('round-trips and clears; never enabled by default', ()=>{
    withStorage(()=>{
      const fresh = getAiSettings();
      assert.equal(fresh.enabled, false);
      assert.equal(fresh.apiKey, '');
      assert.equal(fresh.model, DEFAULT_MODEL);

      saveAiSettings({ apiKey:'nvapi-test', model:'meta/llama-3.1-70b-instruct', enabled:true });
      const saved = getAiSettings();
      assert.equal(saved.apiKey, 'nvapi-test');
      assert.equal(saved.model, 'meta/llama-3.1-70b-instruct');
      assert.equal(saved.enabled, true);

      // Partial update keeps the key.
      saveAiSettings({ enabled:false });
      assert.equal(getAiSettings().apiKey, 'nvapi-test');
      assert.equal(getAiSettings().enabled, false);

      clearAiSettings();
      assert.deepEqual(getAiSettings(), { enabled:false, apiKey:'', model: DEFAULT_MODEL });
    });
  });
});

describe('training context builder', ()=>{
  it('emits aggregated numbers only — no keys, no notes, no identifiers beyond ids', ()=>{
    const store = {
      history: [
        sess('2026-08-03', [{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5), set(8,22.5)] }]),
        sess('2026-08-10', [{ exerciseId:'dumbbell-row', sets:[set(10,20)] }]),
      ],
      schedule: { sessions:[ { id:'s-2026-08-03', status:'done' }, { id:'x', status:'planned' } ] },
      readinessLog: [ { score: 72 }, { score: 80 } ],
      customTemplates: [ { id:'custom-a' } ],
    };
    const ctx = JSON.stringify(buildTrainingContext(store));
    assert.doesNotMatch(ctx, /nvapi|apiKey|note\b/i);
    assert.match(ctx, /"sessionsLogged":2/);
    assert.match(ctx, /"totalSets":3/);
    assert.match(ctx, /"programmeSessionsDone":1/);
    assert.match(ctx, /"customTemplates":1/);
    assert.ok(JSON.parse(ctx).averageReadiness === 76);
  });

  it('handles empty history without crashing', ()=>{
    const ctx = buildTrainingContext({ history: [], schedule: null, readinessLog: [] });
    assert.equal(ctx.totals.sessionsLogged, 0);
    assert.equal(ctx.averageReadiness, null);
  });
});

describe('requestCoachInsight', ()=>{
  const ctx = buildTrainingContext({ history: [] });

  it('refuses without a key or context before any network call', async ()=>{
    let called = false;
    const fake = ()=> { called = true; return Promise.resolve({ ok:false }); };
    const noKey = await requestCoachInsight({ context: ctx, apiKey:'', fetchImpl: fake });
    assert.equal(noKey.ok, false);
    const noCtx = await requestCoachInsight({ context:null, apiKey:'k', fetchImpl: fake });
    assert.equal(noCtx.ok, false);
    assert.equal(called, false);
  });

  it('parses a successful completion', async ()=>{
    const fake = async (url, opts)=>{
      assert.match(url, /integrate\.api\.nvidia\.com/);
      assert.match(opts.headers.Authorization, /^Bearer k$/);
      const body = JSON.parse(opts.body);
      assert.equal(body.model, DEFAULT_MODEL);
      return { ok:true, json: async()=> ({ choices:[{ message:{ content:'Looks solid.\n- add pulling volume' } }] }) };
    };
    const r = await requestCoachInsight({ context: ctx, apiKey:'k', fetchImpl: fake });
    assert.equal(r.ok, true);
    assert.match(r.text, /pulling volume/);
  });

  it('surfaces API errors and timeouts as soft failures', async ()=>{
    const err500 = await requestCoachInsight({ context: ctx, apiKey:'k', fetchImpl: async()=> ({ ok:false, status:500, text: async()=> 'boom' }) });
    assert.equal(err500.ok, false);
    assert.match(err500.error, /API 500/);

    const aborter = await requestCoachInsight({
      context: ctx, apiKey:'k', timeoutMs: 5,
      fetchImpl: (url, opts)=> new Promise((_, rej)=> opts.signal.addEventListener('abort', ()=> { const e = new Error('aborted'); e.name='AbortError'; rej(e); })),
    });
    assert.equal(aborter.ok, false);
    assert.match(aborter.error, /timed out/);
  });
});
