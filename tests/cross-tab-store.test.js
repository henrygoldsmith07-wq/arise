import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStoreInvalidationBus, createStoreRefreshCoordinator, STORE_FALLBACK_KEY } from '../src/lib/crossTabStore.js';
import { reconcileStoreSnapshots } from '../src/lib/storeReconcile.js';

function fakeBroadcastNetwork(){
  const rooms = new Map();
  class FakeChannel {
    constructor(name){ this.name = name; this.listeners = new Set(); (rooms.get(name) || rooms.set(name, new Set()).get(name)).add(this); }
    addEventListener(type, fn){ if(type === 'message') this.listeners.add(fn); }
    removeEventListener(type, fn){ if(type === 'message') this.listeners.delete(fn); }
    postMessage(data){
      for(const peer of rooms.get(this.name) || []) if(peer !== this) for(const fn of [...peer.listeners]) fn({ data });
    }
    close(){ rooms.get(this.name)?.delete(this); this.listeners.clear(); }
  }
  return (name)=> new FakeChannel(name);
}

function fakeStorageNetwork(){
  const windows = new Set();
  const values = new Map();
  function makeWindow(){
    const listeners = new Set();
    const win = {
      addEventListener(type, fn){ if(type === 'storage') listeners.add(fn); },
      removeEventListener(type, fn){ if(type === 'storage') listeners.delete(fn); },
      dispatch(event){ for(const fn of [...listeners]) fn(event); },
    };
    windows.add(win);
    return win;
  }
  function storageFor(owner){
    return {
      setItem(key, value){
        values.set(key, String(value));
        for(const win of windows) if(win !== owner) win.dispatch({ key, newValue:String(value) });
      },
      getItem(key){ return values.get(key) ?? null; },
    };
  }
  return { makeWindow, storageFor, values };
}

describe('cross-tab invalidation transport', ()=>{
  it('BroadcastChannel sends only small invalidation messages between tabs', ()=>{
    const factory = fakeBroadcastNetwork();
    const a = createStoreInvalidationBus({ sourceId:'A', channelFactory:factory, windowRef:null, storageRef:null, now:()=>100 });
    const b = createStoreInvalidationBus({ sourceId:'B', channelFactory:factory, windowRef:null, storageRef:null, now:()=>100 });
    let seen = null;
    b.subscribe(message=> { seen = message; });
    const sent = a.publish('workout-complete');
    assert.equal(a.mode, 'broadcast');
    assert.deepEqual(seen, sent);
    assert.equal('store' in seen, false);
    assert.equal(seen.reason, 'workout-complete');
    a.close(); b.close();
  });

  it('falls back to storage pulses when BroadcastChannel is unavailable', ()=>{
    const network = fakeStorageNetwork();
    const wa = network.makeWindow(), wb = network.makeWindow();
    const a = createStoreInvalidationBus({ sourceId:'A', channelFactory:null, windowRef:wa, storageRef:network.storageFor(wa), now:()=>200 });
    const b = createStoreInvalidationBus({ sourceId:'B', channelFactory:null, windowRef:wb, storageRef:network.storageFor(wb), now:()=>200 });
    let seen = null;
    b.subscribe(message=> { seen = message; });
    a.publish('preferences');
    assert.equal(a.mode, 'storage');
    assert.equal(seen?.reason, 'preferences');
    assert.ok(network.values.has(STORE_FALLBACK_KEY));
    a.close(); b.close();
  });

  it('close detaches a tab and reopen receives later changes', ()=>{
    const factory = fakeBroadcastNetwork();
    const a = createStoreInvalidationBus({ sourceId:'A', channelFactory:factory, windowRef:null, storageRef:null });
    const first = createStoreInvalidationBus({ sourceId:'B1', channelFactory:factory, windowRef:null, storageRef:null });
    let oldCount = 0;
    first.subscribe(()=> oldCount++);
    first.close();
    a.publish();
    assert.equal(oldCount, 0);
    const reopened = createStoreInvalidationBus({ sourceId:'B2', channelFactory:factory, windowRef:null, storageRef:null });
    let newCount = 0;
    reopened.subscribe(()=> newCount++);
    a.publish();
    assert.equal(newCount, 1);
    a.close(); reopened.close();
  });
});

describe('cross-tab refresh coordinator', ()=>{
  it('tab A workout completion updates idle tab B without reload', async ()=>{
    let canonical = { history:[] };
    let applied = null;
    let listener;
    const coordinator = createStoreRefreshCoordinator({
      subscribe: fn=> { listener = fn; return ()=> { listener = null; }; },
      readCanonical: async()=> structuredClone(canonical),
      applyCanonical: next=> { applied = next; },
      isProtected: ()=> false,
    });
    canonical = { history:[{ id:'session-1' }] };
    listener();
    await new Promise(resolve=> setTimeout(resolve, 0));
    assert.deepEqual(applied.history.map(x=>x.id), ['session-1']);
    coordinator.close();
  });

  it('preference changes refresh an idle peer', async ()=>{
    let canonical = { preferences:{ theme:'light' } };
    let applied;
    let listener;
    const coordinator = createStoreRefreshCoordinator({
      subscribe: fn=> { listener = fn; return ()=>{}; },
      readCanonical: async()=> structuredClone(canonical),
      applyCanonical: next=> { applied = next; },
    });
    canonical.preferences.theme = 'dark';
    listener();
    await new Promise(resolve=> setTimeout(resolve, 0));
    assert.equal(applied.preferences.theme, 'dark');
    coordinator.close();
  });

  it('protects an active workout and applies the deferred refresh after it ends', async ()=>{
    let protectedNow = true;
    let canonical = { preferences:{ theme:'dark' }, activeWorkout:null };
    let applied = null;
    let listener;
    const coordinator = createStoreRefreshCoordinator({
      subscribe: fn=> { listener = fn; return ()=>{}; },
      readCanonical: async()=> structuredClone(canonical),
      applyCanonical: next=> { applied = next; },
      isProtected: ()=> protectedNow,
    });
    listener();
    await new Promise(resolve=> setTimeout(resolve, 0));
    assert.equal(applied, null);
    assert.equal(coordinator.hasDeferred(), true);
    protectedNow = false;
    await coordinator.flushDeferred();
    assert.equal(applied.preferences.theme, 'dark');
    assert.equal(coordinator.hasDeferred(), false);
    coordinator.close();
  });

  it('coalesces rapid consecutive updates and finishes on the latest canonical state', async ()=>{
    let canonical = { revision:1 };
    let release;
    let reads = 0;
    let applied = null;
    let listener;
    const firstRead = new Promise(resolve=> { release = resolve; });
    const coordinator = createStoreRefreshCoordinator({
      subscribe: fn=> { listener = fn; return ()=>{}; },
      readCanonical: async()=> {
        reads += 1;
        if(reads === 1) await firstRead;
        return structuredClone(canonical);
      },
      applyCanonical: next=> { applied = next; },
    });
    listener();
    canonical = { revision:2 };
    listener();
    canonical = { revision:3 };
    listener();
    release();
    await new Promise(resolve=> setTimeout(resolve, 0));
    await new Promise(resolve=> setTimeout(resolve, 0));
    assert.equal(applied.revision, 3);
    assert.ok(reads <= 2, `expected coalescing, got ${reads} reads`);
    coordinator.close();
  });
});

describe('cross-tab three-way persistence reconciliation', ()=>{
  it('returns local unchanged when no remote snapshot exists', ()=>{
    const local = { version:13, preferences:{ theme:'dark' }, history:[] };
    assert.equal(reconcileStoreSnapshots({ version:12 }, local, null), local);
  });

  it('merges from an empty base without dropping independent nested fields', ()=>{
    const local = { version:2, preferences:{ theme:'dark', soundCues:true }, history:[] };
    const remote = { version:3, preferences:{ units:'lb' }, history:[] };
    const merged = reconcileStoreSnapshots(null, local, remote);
    assert.equal(merged.preferences.theme, 'dark');
    assert.equal(merged.preferences.soundCues, true);
    assert.equal(merged.preferences.units, 'lb');
  });

  it('draft autosave preserves a preference changed by another tab', ()=>{
    const base = { version:13, preferences:{ theme:'light', soundCues:true }, activeWorkout:null, history:[] };
    const local = { ...base, activeWorkout:{ session:{ id:'s1' }, blocks:[] } };
    const remote = { ...base, preferences:{ ...base.preferences, theme:'dark' } };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.preferences.theme, 'dark');
    assert.equal(merged.activeWorkout.session.id, 's1');
  });

  it('preserves concurrent history additions from both tabs', ()=>{
    const base = { version:13, history:[], preferences:{} };
    const local = { ...base, history:[{ id:'local', dateISO:'2026-09-26', savedAt:'2026-09-26T10:01:00Z' }] };
    const remote = { ...base, history:[{ id:'remote', dateISO:'2026-09-26', savedAt:'2026-09-26T10:02:00Z' }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.deepEqual(new Set(merged.history.map(row=> row.id)), new Set(['local','remote']));
  });

  it('keeps a local preference edit when remote did not change that field', ()=>{
    const base = { version:13, preferences:{ theme:'light', soundCues:true }, history:[] };
    const local = { ...base, preferences:{ ...base.preferences, soundCues:false } };
    const remote = { ...base, preferences:{ ...base.preferences, theme:'dark' } };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.preferences.theme, 'dark');
    assert.equal(merged.preferences.soundCues, false);
  });

  it('preserves an intentional local collection deletion when remote is unchanged', ()=>{
    const tombstone = { id:'sessions:h1', entity:'sessions', refId:'h1', deletedAt:'2026-09-26T10:00:00Z' };
    const base = { version:13, preferences:{}, history:[], tombstones:[tombstone] };
    const local = { ...base, tombstones:[] };
    const remote = structuredClone(base);
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.deepEqual(merged.tombstones, []);
  });

  it('keeps a remote edit when local deletes a row that changed remotely', ()=>{
    const baseRow = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[baseRow] };
    const local = { ...base, history:[] };
    const remote = { ...base, history:[{ ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'remote edit' }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.history.length, 1);
    assert.equal(merged.history[0].note, 'remote edit');
  });

  it('keeps a local edit when remote deletes a row that changed locally', ()=>{
    const baseRow = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[baseRow] };
    const local = { ...base, history:[{ ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'local edit' }] };
    const remote = { ...base, history:[] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.history.length, 1);
    assert.equal(merged.history[0].note, 'local edit');
  });

  it('lets an unchanged side yield to a changed side for the same row', ()=>{
    const baseRow = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[baseRow] };
    const remoteEdit = { ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'remote' };
    assert.equal(reconcileStoreSnapshots(base, structuredClone(base), { ...base, history:[remoteEdit] }).history[0].note, 'remote');
    const localEdit = { ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'local' };
    assert.equal(reconcileStoreSnapshots(base, { ...base, history:[localEdit] }, structuredClone(base)).history[0].note, 'local');
  });

  it('uses the newer timestamp when both tabs edit the same entity', ()=>{
    const baseRow = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[baseRow] };
    const local = { ...base, history:[{ ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'local' }] };
    const remote = { ...base, history:[{ ...baseRow, savedAt:'2026-09-20T12:00:00Z', note:'remote' }] };
    assert.equal(reconcileStoreSnapshots(base, local, remote).history[0].note, 'remote');
    assert.equal(reconcileStoreSnapshots(base, remote, local).history[0].note, 'remote');
  });

  it('keeps local deterministically when conflicting edits have equal or unusable timestamps', ()=>{
    const baseRow = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[baseRow] };
    const localEqual = { ...base, history:[{ ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'local equal' }] };
    const remoteEqual = { ...base, history:[{ ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'remote equal' }] };
    assert.equal(reconcileStoreSnapshots(base, localEqual, remoteEqual).history[0].note, 'local equal');

    const localInvalid = { ...base, history:[{ id:'h1', note:'local invalid' }] };
    const remoteInvalid = { ...base, history:[{ id:'h1', note:'remote invalid' }] };
    assert.equal(reconcileStoreSnapshots(base, localInvalid, remoteInvalid).history[0].note, 'local invalid');
  });

  it('honours one-sided unchanged deletions in either direction', ()=>{
    const row = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z' };
    const base = { version:13, history:[row] };
    assert.deepEqual(reconcileStoreSnapshots(base, { ...base, history:[] }, structuredClone(base)).history, []);
    assert.deepEqual(reconcileStoreSnapshots(base, structuredClone(base), { ...base, history:[] }).history, []);
  });

  it('uses updatedAt, at, and dateISO fallbacks when savedAt is absent', ()=>{
    const base = { version:1, customTemplates:[], eventHistory:[], history:[] };
    const localTemplate = { id:'t1', updatedAt:'2026-09-20T11:00:00Z', name:'local' };
    const remoteTemplate = { id:'t1', updatedAt:'2026-09-20T12:00:00Z', name:'remote' };
    const mergedTemplate = reconcileStoreSnapshots(base, { ...base, customTemplates:[localTemplate] }, { ...base, customTemplates:[remoteTemplate] });
    assert.equal(mergedTemplate.customTemplates[0].name, 'remote');

    const localEvent = { id:'e1', at:'2026-09-20T13:00:00Z', value:'local' };
    const remoteEvent = { id:'e1', at:'2026-09-20T12:00:00Z', value:'remote' };
    const mergedEvent = reconcileStoreSnapshots(base, { ...base, eventHistory:[localEvent] }, { ...base, eventHistory:[remoteEvent] });
    assert.equal(mergedEvent.eventHistory[0].value, 'local');

    const baseHistory = { version:1, history:[{ id:'h1', dateISO:'2026-09-18', value:'base' }] };
    const localHistory = { ...baseHistory, history:[{ id:'h1', dateISO:'2026-09-19', value:'local' }] };
    const remoteHistory = { ...baseHistory, history:[{ id:'h1', dateISO:'2026-09-20', value:'remote' }] };
    assert.equal(reconcileStoreSnapshots(baseHistory, localHistory, remoteHistory).history[0].value, 'remote');
  });

  it('takes the highest schema version while preserving merged collections', ()=>{
    const base = { version:9, history:[], eventHistory:[], evaluationLedger:[], customTemplates:[], tombstones:[], readinessLog:[], programHistory:[] };
    const local = { ...base, version:11, eventHistory:[{ id:'local-event', at:'2026-09-20T10:00:00Z' }] };
    const remote = { ...base, version:15, evaluationLedger:[{ id:'remote-ledger', at:'2026-09-20T10:00:00Z' }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.version, 15);
    assert.equal(merged.eventHistory[0].id, 'local-event');
    assert.equal(merged.evaluationLedger[0].id, 'remote-ledger');

    assert.equal(reconcileStoreSnapshots({ ...base, version:20 }, local, remote).version, 20);
    assert.equal(reconcileStoreSnapshots(base, { ...local, version:21 }, remote).version, 21);
  });

  it('treats absent collections as empty and ignores rows without a stable identity', ()=>{
    const remoteHistory = { id:'remote', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z' };
    const base = { version:1 };
    const local = { version:1, history:[null, undefined] };
    const remote = { version:1, history:[null, remoteHistory] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.deepEqual(merged.history, [remoteHistory]);
    assert.deepEqual(merged.eventHistory, []);
    assert.deepEqual(merged.evaluationLedger, []);
    assert.deepEqual(merged.customTemplates, []);
    assert.deepEqual(merged.tombstones, []);
    assert.deepEqual(merged.readinessLog, []);
    assert.deepEqual(merged.programHistory, []);
  });

  it('uses every composite identity field for readiness and programme history', ()=>{
    const base = { version:1, readinessLog:[], programHistory:[] };
    const local = {
      ...base,
      readinessLog:[
        { dateISO:'2026-09-20', at:'2026-09-20T08:00:00Z', score:70 },
        { dateISO:'2026-09-20', score:70 },
      ],
      programHistory:[
        { programId:'p1', version:1, startDateISO:'2026-09-01' },
        { programId:'p1', version:2, startDateISO:'2026-09-01' },
      ],
    };
    const remote = {
      ...base,
      readinessLog:[
        { dateISO:'2026-09-20', at:'2026-09-20T09:00:00Z', score:70 },
        { dateISO:'2026-09-21', score:70 },
      ],
      programHistory:[
        { programId:'p1', version:1, startDateISO:'2026-09-02' },
        { programId:'p2', version:1, startDateISO:'2026-09-01' },
      ],
    };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.readinessLog.length, 4);
    assert.equal(merged.programHistory.length, 4);
  });

  it('merges every entity collection by its documented stable identity', ()=>{
    const base = { version:13, history:[], eventHistory:[], evaluationLedger:[], customTemplates:[], tombstones:[], readinessLog:[], programHistory:[] };
    const local = {
      ...base,
      eventHistory:[{ id:'e-local', at:'2026-09-20T10:00:00Z' }],
      customTemplates:[{ id:'t-local', updatedAt:'2026-09-20T10:00:00Z' }],
      readinessLog:[{ dateISO:'2026-09-20', score:70 }],
      programHistory:[{ programId:'p1', version:1, startDateISO:'2026-09-01' }],
    };
    const remote = {
      ...base,
      evaluationLedger:[{ id:'l-remote', at:'2026-09-20T10:00:00Z' }],
      tombstones:[{ id:'sessions:h1', deletedAt:'2026-09-20T10:00:00Z' }],
      readinessLog:[{ dateISO:'2026-09-20', score:80 }],
      programHistory:[{ programId:'p2', version:1, startDateISO:'2026-09-02' }],
    };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.deepEqual(merged.eventHistory.map(row=>row.id), ['e-local']);
    assert.deepEqual(merged.evaluationLedger.map(row=>row.id), ['l-remote']);
    assert.deepEqual(merged.customTemplates.map(row=>row.id), ['t-local']);
    assert.deepEqual(merged.tombstones.map(row=>row.id), ['sessions:h1']);
    assert.equal(merged.readinessLog.length, 2);
    assert.equal(merged.programHistory.length, 2);
  });

  it('merges nested objects field-by-field but lets local win irreducible scalar conflicts', ()=>{
    const base = { version:1, preferences:{ accessibility:{ largeText:false, highContrast:false }, experience:'standard' }, history:[] };
    const local = { ...base, preferences:{ accessibility:{ largeText:true, highContrast:false }, experience:'expert' } };
    const remote = { ...base, preferences:{ accessibility:{ largeText:false, highContrast:true }, experience:'simple' } };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.deepEqual(merged.preferences.accessibility, { largeText:true, highContrast:true });
    assert.equal(merged.preferences.experience, 'expert');
  });
});
