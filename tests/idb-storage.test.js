import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateStorage, loadStoreFromIdb, persistStore } from '../src/lib/storage.js';
import { idbGetAll } from '../src/lib/idb.js';
import { loadStore, saveStore, STORE_SCHEMA_VERSION } from '../src/lib/store.js';

function set(reps, kg){ return { reps:String(reps), weightKg:String(kg), rpe:'' }; }
function fullStore(){
  return {
    version: STORE_SCHEMA_VERSION,
    onboarding: { goal:'muscle', equipment:['dumbbells'], location:'home' },
    preferences: { units:'kg', theme:'dark', telemetryEnabled:true },
    healthSummary: null,
    activeSchedule: {
      programId:'p1', mesocycle:{ weeks:4, deloadWeek:null },
      adaptationHistory: [ { basisKey:'week:2026-01-05', dateISO:'2026-01-12', changes:[{ exerciseId:'bench-press-dumbbell', kind:'weekly-add-sets' }] } ],
      sessions: [ { id:'s1', week:1, day:1, dateISO:'2026-01-05', status:'done', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,20), set(9,20)] }] } ],
    },
    programHistory: [ { programId:'p1', version:1, startDateISO:'2026-01-05' } ],
    history: [
      { id:'h1', dateISO:'2026-01-05', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,20), set(9,20)] }] },
      { id:'h2', dateISO:'2026-01-08', blocks:[{ exerciseId:'dumbbell-row', sets:[set(10,20)] }] },
    ],
    eventHistory: [ { id:'e1', type:'session:complete', at:'2026-01-05T10:00:00Z' } ],
    readinessLog: [ { dateISO:'2026-01-05', score:75 } ],
    evaluationLedger: [
      { id:'r-open', recommendation:{ load:22, reps:8 }, outcome:null, exerciseId:'bench-press-dumbbell' },
      { id:'r-done', recommendation:{ load:20, reps:8 }, outcome:{ metTarget:true }, exerciseId:'bench-press-dumbbell' },
    ],
    customTemplates: [ { id:'custom-x', isCustom:true, version:1, program:{ id:'custom-x', weeks:[{ week:1, workouts:[] }] } } ],
  };
}

describe('indexeddb canonical storage', ()=>{
  it('migrates a legacy localStorage payload into the object stores', async ()=>{
    globalThis.localStorage = { _m:{}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
    try{
      globalThis.localStorage.setItem('arise.store.v1', JSON.stringify(fullStore()));
      await hydrateStorage();
      const sessions = await idbGetAll('sessions');
      assert.equal(sessions.length, 2);
      const sets = await idbGetAll('sets');
      assert.equal(sets.length, 3); // 2 + 1 embedded sets mirrored flat
      const recs = await idbGetAll('recommendations');
      const outs = await idbGetAll('outcomes');
      assert.equal(recs.length, 1);
      assert.equal(outs.length, 1);
      assert.equal((await idbGetAll('templates')).length, 1);
      // localStorage demoted to a pointer + paint-critical prefs.
      const pointer = JSON.parse(globalThis.localStorage.getItem('arise.store.v1'));
      assert.equal(pointer.__ariseIdb, true);
      assert.equal(pointer.preferences.theme, 'dark');
      assert.ok(globalThis.localStorage.getItem('arise.store.v1.pre-idb-backup'));
    }finally{ delete globalThis.localStorage; }
  });

  it('recomposes the exact monolithic shape from the stores', async ()=>{
    const composed = await loadStoreFromIdb();
    assert.equal(composed.history.length, 2);
    assert.equal(composed.history[0].blocks[0].sets.length, 2);
    assert.ok(composed.activeSchedule.adaptationHistory.length >= 1, 'adaptation rows survive');
    assert.equal(composed.evaluationLedger.length, 2); // open + resolved unioned by id
    assert.equal(composed.customTemplates[0].id, 'custom-x');
    assert.equal(composed.readinessLog.length, 1);
    assert.equal(composed.eventHistory.length, 1);
    assert.deepEqual(composed.onboarding, { goal:'muscle', equipment:['dumbbells'], location:'home' });
  });

  it('saveStore writes through the cache into IDB after hydration', async ()=>{
    await hydrateStorage();
    const s = loadStore();
    s.history.push({ id:'h3', dateISO:'2026-01-12', blocks:[{ exerciseId:'lunge', sets:[set(8,'')] }] });
    assert.equal(saveStore(s), true);
    const sessions = await idbGetAll('sessions');
    assert.equal(sessions.length, 3);
    const reloaded = loadStore();
    assert.equal(reloaded.history.length, 3);
    assert.ok(reloaded.history.find(h => h.id === 'h3'));
  });

  it('without hydration, store.js keeps its legacy synchronous path', ()=>{
    delete globalThis.localStorage;
    const s = loadStore(); // falls back to DEFAULT — no crash
    assert.equal(s.version, STORE_SCHEMA_VERSION);
    assert.equal(saveStore({ version:6 }), true);
  });
});
