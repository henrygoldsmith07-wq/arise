import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAiSettings, saveAiSettings, clearAiSettings,
  buildTrainingContext, requestCoachInsight, DEFAULT_MODEL,
} from '../src/lib/aiCoach.js';

async function withStorage(fn){
  const mem = {};
  globalThis.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k,v)=> { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
  };
  try{ fn(mem); }finally{ delete globalThis.localStorage; }
}
function sess(id, dateISO, blocks){ return { id, dateISO, blocks }; }
function set(reps, kg){ return { reps:String(reps), weightKg:String(kg), rpe:'' }; }
function isoDaysAgo(days){
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe('ai settings storage', ()=>{
  it('round-trips and clears; never enabled by default', ()=>{
    withStorage(()=>{
      const fresh = getAiSettings();
      assert.equal(fresh.enabled, false);
      assert.equal(fresh.apiKey, '');
      assert.equal(fresh.model, DEFAULT_MODEL);
      saveAiSettings({ apiKey:'nvapi-test', enabled:true });
      assert.equal(getAiSettings().apiKey, 'nvapi-test');
      saveAiSettings({ enabled:false });
      assert.equal(getAiSettings().enabled, false);
      clearAiSettings();
      assert.deepEqual(getAiSettings(), { enabled:false, apiKey:'', model: DEFAULT_MODEL });
    });
  });
});

describe('training context builder', ()=>{
  it('averages only the recent readiness window (last-8 bug regression)', ()=>{
    // Ten entries: two very low old scores then eight high ones.
    const scores = [5, 10, 80, 80, 80, 80, 80, 80, 80, 80];
    const store = { history:[], schedule:null, readinessLog: scores.map(s=>({ score:s })) };
    const ctx = buildTrainingContext(store);
    // Old bug divided the last-8 sum by the full length → 64.
    assert.equal(ctx.averageReadiness, 80);
  });

  it('muscle balance uses the exercise database, not id prefixes', ()=>{
    const history = [
      sess('a','2026-08-03',[{ exerciseId:'bench-press-dumbbell', sets:[set(8,20), set(8,20)] }]),
      sess('b','2026-08-04',[{ exerciseId:'dumbbell-row', sets:[set(10,20)] }]),
      sess('c','2026-08-05',[{ exerciseId:'cable-row', sets:[set(10,25)] }]),
      sess('d','2026-08-06',[{ exerciseId:'bodyweight-squat', sets:[set(12,'')] }]),
    ];
    const ctx = buildTrainingContext({ history });
    const mb = ctx.muscleBalance;
    assert.equal(mb['Chest'], 2);
    assert.equal(mb['Back'], 2);
    assert.equal(mb['Legs'], 1);
    // The old prefix bug produced these bogus keys:
    assert.equal(mb['bench'], undefined);
    assert.equal(mb['dumbbell'], undefined);
    assert.equal(mb['bodyweight'], undefined);
  });

  it('carries engine findings as authoritative decisions', ()=>{
    const monday = (offsetWeeks, plusDays = 0)=>{
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offsetWeeks * 7 + plusDays);
      return d.toISOString().slice(0, 10);
    };
    const history = [ sess('done-1', monday(-1), [{ exerciseId:'bench-press-dumbbell', sets:[set(8,22)] }]) ];
    const schedule = {
      programId:'p', availableEquipment:['dumbbells','bench'], mesocycle:{ weeks:4, deloadWeek:null },
      sessions:[
        sess('done-1', monday(-1), [{ exerciseId:'bench-press-dumbbell', sets:[3] }]),
        sess('next-1', monday(0, 1), [{ exerciseId:'bench-press-dumbbell', sets:[3] }]),
      ],
    };
    const ctx = buildTrainingContext({ history, schedule });
    assert.equal(ctx.contextVersion, 2);
    assert.equal(ctx.engineFindings.weeklyReviewReady, true);
    const d = ctx.engineFindings.directives.find(x => x.exerciseId === 'bench-press-dumbbell');
    assert.ok(d, 'expected an engine directive');
    assert.ok(d.reason.length > 5);
  });
});

describe('requestCoachInsight', ()=>{
  function capture(){
    let captured = null;
    const fake = async (url, opts)=>{
      captured = { url, opts, body: JSON.parse(opts.body) };
      return { ok:true, json: async()=> ({ choices:[{ message:{ content:'Engine held your squat load because RPE hit 9 twice.' } }] }) };
    };
    return { fake, get: ()=> captured };
  }

  it('sends the explanation-layer system prompt and engine findings payload', async ()=>{
    withStorage(async ()=>{
      const ctx = buildTrainingContext({ history:[], schedule:null });
      const { fake, get } = capture();
      const r = await requestCoachInsight({ context: ctx, apiKey:'k', fetchImpl: fake });
      assert.equal(r.ok, true);
      const sent = get();
      assert.match(sent.url, /integrate\.api\.nvidia\.com/);
      assert.match(sent.body.messages[0].content, /NEVER invent/i);
      assert.match(JSON.stringify(sent.body.messages[1].content), /engineFindings/);
      assert.equal(sent.body.temperature, 0.3);
    });
  });

  it('refuses without key/context before any network call', async ()=>{
    let called = false;
    const fake = ()=> { called = true; return Promise.resolve({ ok:false }); };
    assert.equal((await requestCoachInsight({ context:{}, apiKey:'', fetchImpl: fake })).ok, false);
    assert.equal((await requestCoachInsight({ context:null, apiKey:'k', fetchImpl: fake })).ok, false);
    assert.equal(called, false);
  });

  it('surfaces API errors and timeouts as soft failures', async ()=>{
    const err500 = await requestCoachInsight({ context:{}, apiKey:'k', fetchImpl: async()=> ({ ok:false, status:500, text: async()=> 'boom' }) });
    assert.match(err500.error, /API 500/);
    const aborter = await requestCoachInsight({
      context:{}, apiKey:'k', timeoutMs: 5,
      fetchImpl: (url, opts)=> new Promise((_, rej)=> opts.signal.addEventListener('abort', ()=> { const e = new Error('aborted'); e.name='AbortError'; rej(e); })),
    });
    assert.match(aborter.error, /timed out/);
  });
});
