import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearAllStoredData, getCachedStore, hydrateStorage, loadStoreFromIdb, persistStore, setCachedStore, whenPersisted } from '../src/lib/storage.js';
import { idbGetAll } from '../src/lib/idb.js';
import { loadStore, saveStore, STORE_SCHEMA_VERSION } from '../src/lib/store.js';
import { loadEvaluationLedger, saveEvaluationLedger } from '../src/lib/longitudinal.js';
import { clearTelemetry, getEventHistory, recordEvent } from '../src/lib/telemetry.js';

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
    await whenPersisted(); // durability: the write is awaited, not raced
    const sessions = await idbGetAll('sessions');
    assert.equal(sessions.length, 3);
    const reloaded = loadStore();
    assert.equal(reloaded.history.length, 3);
    assert.ok(reloaded.history.find(h => h.id === 'h3'));
  });

  it('round-trips demo and gym preference state through the IndexedDB profile row', async ()=>{
    await hydrateStorage();
    const base = getCachedStore();
    const next = {
      ...base,
      demo:true,
      gymPrefs:{ focusDefault:true, restPresets:{ 'bench-press-dumbbell':90 } },
    };
    await setCachedStore(next);
    await whenPersisted();
    const recomposed = await loadStoreFromIdb();
    assert.equal(recomposed.demo, true);
    assert.equal(recomposed.gymPrefs.focusDefault, true);
    assert.equal(recomposed.gymPrefs.restPresets['bench-press-dumbbell'], 90);

    await setCachedStore(base, { evaluationLedgerMode:'replace' });
    await whenPersisted();
  });

  it('keeps the durable merge base isolated from nested live-state mutation', async ()=>{
    await hydrateStorage();
    const original = getCachedStore();
    const durableAdaptationDate = original?.activeSchedule?.lastAdaptation?.dateISO ?? null;
    const live = loadStore();
    live.activeSchedule = live.activeSchedule || { sessions:[] };
    live.activeSchedule.lastAdaptation = { dateISO:'2026-01-20', changes:[{ reason:'new local edit' }] };

    let seenBase = null;
    await setCachedStore(live, {
      persist:async(store, { baseStore })=> {
        seenBase = baseStore;
        return store;
      },
    });
    await whenPersisted();

    assert.notEqual(seenBase, original);
    assert.equal(seenBase?.activeSchedule?.lastAdaptation?.dateISO ?? null, durableAdaptationDate);
    assert.notEqual(seenBase?.activeSchedule?.lastAdaptation?.dateISO, '2026-01-20');

    await setCachedStore(original, { persist:async(store)=> store, evaluationLedgerMode:'replace' });
    await whenPersisted();
  });

  it('mirrors the latest preferences synchronously before the IndexedDB write resolves', async ()=>{
    globalThis.localStorage = globalThis.localStorage || { _m:{}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
    await hydrateStorage();
    const base = getCachedStore();
    let release;
    const gate = new Promise(resolve=> { release = resolve; });
    const pending = setCachedStore({
      ...base,
      preferences:{ ...(base.preferences || {}), voiceCoach:true, soundCues:false, voiceRate:1.2 },
    }, {
      persist:async(store)=> { await gate; return store; },
    });

    const pointer = JSON.parse(globalThis.localStorage.getItem('arise.store.v1'));
    assert.equal(pointer.__ariseIdb, true);
    assert.equal(pointer.preferences.voiceCoach, true);
    assert.equal(pointer.preferences.soundCues, false);
    assert.equal(pointer.preferences.voiceRate, 1.2);

    release();
    await pending;
    await whenPersisted();
    await setCachedStore(base, { persist:async(store)=> store, evaluationLedgerMode:'replace' });
    await whenPersisted();
  });

  it('surfaces durable-write failures, rolls back the cache, and permits a retry', async ()=>{
    await hydrateStorage();
    const base = getCachedStore();
    const next = { ...base, preferences:{ ...(base.preferences || {}), theme:'light' } };
    const failed = setCachedStore(next, { persist:async()=> { throw new Error('simulated quota failure'); } });
    await assert.rejects(failed, /simulated quota failure/);
    await assert.rejects(whenPersisted(), /simulated quota failure/);
    assert.deepEqual(getCachedStore(), base, 'failed write restores the last durable cache snapshot');

    const retry = setCachedStore(next, { persist:async(store)=> store });
    await retry;
    await whenPersisted();
    assert.equal(getCachedStore().preferences.theme, 'light');

    // Leave the shared in-memory backend in the durable baseline state for
    // later tests in this process.
    setCachedStore(base);
    await whenPersisted();
  });

  it('bases a queued recovery write on the last durable snapshot after the previous write fails', async ()=>{
    await hydrateStorage();
    const durable = getCachedStore();
    const firstSnapshot = { ...durable, preferences:{ ...(durable.preferences || {}), theme:'light' } };
    let rejectFirst;
    const firstGate = new Promise((_, reject)=> { rejectFirst = reject; });
    const first = setCachedStore(firstSnapshot, { persist:async()=> firstGate });

    const secondSnapshot = {
      ...firstSnapshot,
      onboarding:{ ...(firstSnapshot.onboarding || {}), goal:'strength' },
    };
    let seenBase = null;
    const second = setCachedStore(secondSnapshot, {
      persist:async(store, { baseStore })=> {
        seenBase = baseStore;
        return store;
      },
    });

    rejectFirst(new Error('first write failed'));
    await assert.rejects(first, /first write failed/);
    const committed = await second;
    await whenPersisted();

    assert.deepEqual(seenBase, durable, 'the failed optimistic snapshot must never become the next merge base');
    assert.notEqual(seenBase, firstSnapshot);
    assert.equal(committed.preferences.theme, 'light');
    assert.equal(committed.onboarding.goal, 'strength');

    await setCachedStore(durable, { persist:async(store)=> store, evaluationLedgerMode:'replace' });
    await whenPersisted();
  });

  it('uses the hydrated IndexedDB-backed store as the live event ledger', async ()=>{
    await hydrateStorage();
    const base = getCachedStore();
    const event = recordEvent('session:start', { sessionId:'canonical-event' }, { essential:true });
    assert.ok(event);
    await whenPersisted();

    assert.ok(getEventHistory().some(row=> row.id === event.id));
    const events = await idbGetAll('events');
    assert.ok(events.some(row=> row.id === event.id));

    clearTelemetry();
    await whenPersisted();
    assert.deepEqual(getEventHistory(), []);
    assert.deepEqual(await idbGetAll('events'), []);

    await setCachedStore(base, { eventHistoryMode:'replace', evaluationLedgerMode:'replace' });
    await whenPersisted();
  });

  it('preserves newer events during ordinary saves but permits an explicit replacement', async ()=>{
    await hydrateStorage();
    const base = getCachedStore();
    const newer = [...(base.eventHistory || []), { id:'sticky-event', type:'session:start', at:'2026-01-20T10:00:00Z' }];
    await setCachedStore({ ...base, eventHistory:newer }, { persist:async(store)=> store, eventHistoryMode:'replace' });

    const staleUiSnapshot = { ...base, preferences:{ ...(base.preferences || {}), theme:'light' } };
    await setCachedStore(staleUiSnapshot, { persist:async(store)=> store });
    assert.ok(getCachedStore().eventHistory.some(row=> row.id === 'sticky-event'));

    await setCachedStore({ ...getCachedStore(), eventHistory:[] }, { persist:async(store)=> store, eventHistoryMode:'replace' });
    assert.deepEqual(getCachedStore().eventHistory, []);

    await setCachedStore(base, { persist:async(store)=> store, eventHistoryMode:'replace', evaluationLedgerMode:'replace' });
    await whenPersisted();
  });

  it('uses the hydrated IndexedDB-backed ledger as the default live evidence store', async ()=>{
    await hydrateStorage();
    const base = getCachedStore();
    const row = { id:'canonical-evidence', exerciseId:'push-up', recommendation:{ reps:10 }, outcome:null };
    saveEvaluationLedger([row]);
    await whenPersisted();

    assert.equal(loadEvaluationLedger()[0].id, 'canonical-evidence');
    const recommendations = await idbGetAll('recommendations');
    assert.ok(recommendations.some(record=> record.id === 'canonical-evidence'));

    saveEvaluationLedger(base.evaluationLedger || []);
    await whenPersisted();
  });

  it('preserves newer evidence during ordinary saves but permits an explicit replacement', async ()=>{
    await hydrateStorage();
    const base = getCachedStore();
    const evidence = [...(base.evaluationLedger || []), { id:'sticky-evidence', exerciseId:'plank', recommendation:{ reps:30 }, outcome:null }];
    await setCachedStore({ ...base, evaluationLedger:evidence }, { persist:async(store)=> store, evaluationLedgerMode:'replace' });

    const staleUiSnapshot = { ...base, preferences:{ ...(base.preferences || {}), theme:'dark' } };
    await setCachedStore(staleUiSnapshot, { persist:async(store)=> store });
    assert.ok(getCachedStore().evaluationLedger.some(row=> row.id === 'sticky-evidence'));

    await setCachedStore({ ...getCachedStore(), evaluationLedger:[] }, { persist:async(store)=> store, evaluationLedgerMode:'replace' });
    assert.equal(getCachedStore().evaluationLedger.length, 0);

    await setCachedStore(base, { persist:async(store)=> store, evaluationLedgerMode:'replace' });
    await whenPersisted();
  });

  it('without hydration, store.js keeps its legacy synchronous path', async ()=>{
    delete globalThis.localStorage;
    const s = loadStore(); // falls back to DEFAULT — no crash
    assert.equal(s.version, STORE_SCHEMA_VERSION);
    assert.equal(saveStore({ version:6 }), true);
    await whenPersisted();
    const recomposed = await loadStoreFromIdb();
    assert.ok(recomposed, 'the {version:6} shell persisted through the memory backend');
  });

  it('removes legacy live and archived evidence keys during a verified clear', async ()=>{
    globalThis.localStorage = { _m:{}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
    globalThis.localStorage.setItem('arise.evaluation.v1', 'legacy');
    globalThis.localStorage.setItem('arise.evaluation.v1.archive', 'legacy-archive');
    await clearAllStoredData({ transaction:async()=>{} });
    assert.equal(globalThis.localStorage.getItem('arise.evaluation.v1'), null);
    assert.equal(globalThis.localStorage.getItem('arise.evaluation.v1.archive'), null);
  });

  it('rejects a destructive clear when fallback clearing cannot be verified', async ()=>{
    await assert.rejects(
      clearAllStoredData({
        transaction:async()=> { throw new Error('transaction failed'); },
        clearStore:async()=>{},
        readAll:async(store)=> store === 'sessions' ? [{ id:'still-here' }] : [],
      }),
      /Could not verify.*not empty: sessions/,
    );
    delete globalThis.localStorage;
  });
});
