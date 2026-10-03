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

  it('keeps evidence rows monotonic across tabs and prefers resolved outcomes', ()=>{
    const open = {
      id:'eval-1',
      recordedAtISO:'2026-09-20T10:00:00Z',
      exerciseId:'push-up',
      recommendation:{ reps:10 },
      outcome:null,
    };
    const resolved = {
      ...open,
      outcomeProvenance:{ capturedAt:'2026-09-20T12:00:00Z' },
      outcome:{ sessionId:'s1', recordedAtISO:'2026-09-20T12:00:00Z', metTarget:true },
    };
    const base = { version:13, evaluationLedger:[open] };
    const local = { ...base, evaluationLedger:[open] };
    const remote = { ...base, evaluationLedger:[resolved, { id:'eval-remote', recordedAtISO:'2026-09-20T11:00:00Z', outcome:null }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.evaluationLedger.find(row=> row.id === 'eval-1').outcome.sessionId, 's1');
    assert.ok(merged.evaluationLedger.some(row=> row.id === 'eval-remote'));
  });

  it('merges entity collections even when there was no prior durable base', ()=>{
    const local = { version:13, history:[{ id:'local', dateISO:'2026-09-20' }], evaluationLedger:[{ id:'eval-local', recordedAtISO:'2026-09-20T10:00:00Z' }] };
    const remote = { version:13, history:[{ id:'remote', dateISO:'2026-09-21' }], evaluationLedger:[{ id:'eval-remote', recordedAtISO:'2026-09-21T10:00:00Z' }] };
    const merged = reconcileStoreSnapshots(null, local, remote);
    assert.deepEqual(new Set(merged.history.map(row=> row.id)), new Set(['local','remote']));
    assert.deepEqual(new Set(merged.evaluationLedger.map(row=> row.id)), new Set(['eval-local','eval-remote']));
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

  it('reconciles malformed rows without crashing and keeps the intact copies', ()=>{
    // A row that lost its payload to corruption (id present, fields absent)
    // must never throw during reconciliation: identity access is defensive
    // across every collection, and the intact side's copy still wins the merge.
    const base = { version:1, history:[], eventHistory:[], customTemplates:[], tombstones:[], readinessLog:[], programHistory:[], evaluationLedger:[] };
    const goodHistory = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'intact' };
    const goodTemplate = { id:'t1', updatedAt:'2026-09-20T10:00:00Z', name:'intact' };
    const goodTombstone = { id:'sessions:h9', deletedAt:'2026-09-20T10:00:00Z' };
    const goodProgramme = { programId:'p1', version:2, startDateISO:'2026-09-01', savedAt:'2026-09-20T10:00:00Z' };
    const local = {
      ...base,
      history:[{ id:'h1' }],
      eventHistory:[{ id:'e1' }],
      customTemplates:[{ id:'t1' }],
      tombstones:[{ id:'sessions:h9' }],
      readinessLog:[{ id:'r1' }],
      programHistory:[{ programId:'p1' }],
      evaluationLedger:[{ id:'v1' }],
    };
    const remote = {
      ...base,
      history:[goodHistory],
      customTemplates:[goodTemplate],
      tombstones:[goodTombstone],
      programHistory:[goodProgramme],
    };
    const merged = reconcileStoreSnapshots(base, local, remote);
    // same-identity rows: the intact (newer) remote copy wins over the
    // payload-less local copy in every collection that shares a key
    assert.deepEqual(merged.history, [goodHistory]);
    assert.deepEqual(merged.customTemplates, [goodTemplate]);
    assert.deepEqual(merged.tombstones, [goodTombstone]);
    // programme history identifies by composite key, so the payload-less row
    // is its own identity — it coexists with the intact copy, no crash
    assert.deepEqual(merged.programHistory, [{ programId:'p1' }, goodProgramme]);
    // and malformed-only rows survive as their own identity, not a crash
    assert.deepEqual(merged.eventHistory.map(r=> r.id), ['e1']);
    assert.deepEqual(merged.readinessLog.map(r=> r.id), ['r1']);
    assert.deepEqual(merged.evaluationLedger.map(r=> r.id), ['v1']);
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

  it('merges simultaneous edits to unrelated domains without losing either side', ()=>{
    const base = {
      version:13,
      preferences:{ theme:'light', units:'kg' },
      history:[{ id:'h1', dateISO:'2026-09-20', note:'base' }],
      eventHistory:[{ id:'e1', at:'2026-09-20T10:00:00Z', value:'base' }],
    };
    const local = structuredClone(base);
    local.preferences.units = 'lb';
    local.history = [{ ...base.history[0], note:'local workout note' }];
    const remote = structuredClone(base);
    remote.preferences.theme = 'dark';
    remote.eventHistory = [{ ...base.eventHistory[0], value:'remote event' }];
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.preferences.units, 'lb');
    assert.equal(merged.preferences.theme, 'dark');
    assert.equal(merged.history[0].note, 'local workout note');
    assert.equal(merged.eventHistory[0].value, 'remote event');
  });

  it('resolves same-entity concurrent edits by stamp priority chain and strict recency', ()=>{
    const baseRow = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[baseRow] };
    // savedAt is checked before updatedAt before at before dateISO
    const localBySavedAt = { ...baseRow, savedAt:'2026-09-20T13:00:00Z', updatedAt:'2026-09-20T09:00:00Z', note:'local savedAt' };
    const remoteByUpdatedAt = { ...baseRow, updatedAt:'2026-09-20T12:00:00Z', note:'remote updatedAt' };
    assert.equal(reconcileStoreSnapshots(base, { ...base, history:[localBySavedAt] }, { ...base, history:[remoteByUpdatedAt] }).history[0].note, 'local savedAt');

    const localByAt = { ...baseRow, at:'2026-09-20T14:00:00Z', dateISO:'2026-09-19', note:'local at' };
    const remoteByDateISO = { ...baseRow, dateISO:'2026-09-21', note:'remote dateISO' };
    assert.equal(reconcileStoreSnapshots(base, { ...base, history:[localByAt] }, { ...base, history:[remoteByDateISO] }).history[0].note, 'local at');

    // remote wins only when strictly newer, by a single millisecond
    const localStamp = { ...baseRow, savedAt:'2026-09-20T11:00:00.000Z', note:'local' };
    const remoteOneMsNewer = { ...baseRow, savedAt:'2026-09-20T11:00:00.001Z', note:'remote' };
    assert.equal(reconcileStoreSnapshots(base, { ...base, history:[localStamp] }, { ...base, history:[remoteOneMsNewer] }).history[0].note, 'remote');
  });

  it('resolves delete-vs-modify in both directions and drops rows deleted on both sides', ()=>{
    const baseRow = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[baseRow] };
    // local deletes, remote edits -> the edit survives
    const remoteEdit = { ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'remote edit' };
    const deletedWhileRemoteEdited = reconcileStoreSnapshots(base, { ...base, history:[] }, { ...base, history:[remoteEdit] });
    assert.deepEqual(deletedWhileRemoteEdited.history.map(row=> row.note), ['remote edit']);
    // remote deletes, local edits -> the edit survives
    const localEdit = { ...baseRow, savedAt:'2026-09-20T11:00:00Z', note:'local edit' };
    const deletedWhileLocalEdited = reconcileStoreSnapshots(base, { ...base, history:[localEdit] }, { ...base, history:[] });
    assert.deepEqual(deletedWhileLocalEdited.history.map(row=> row.note), ['local edit']);
    // both sides delete -> stays deleted
    const deletedBoth = reconcileStoreSnapshots(base, { ...base, history:[] }, { ...base, history:[] });
    assert.deepEqual(deletedBoth.history, []);
    // a row absent everywhere except base never resurfaces
    const removedEverywhere = reconcileStoreSnapshots(
      { version:1, history:[baseRow], archivedHistory:[baseRow] },
      { version:1, history:[], archivedHistory:[] },
      { version:1, history:[], archivedHistory:[] },
    );
    assert.deepEqual(removedEverywhere.history, []);
    assert.deepEqual(removedEverywhere.archivedHistory, []);
  });

  it('merges tombstones additively and resolves same-id tombstone conflicts', ()=>{
    const base = { version:13, tombstones:[{ id:'sessions:h0', entity:'sessions', refId:'h0', deletedAt:'2026-09-01T00:00:00Z' }] };
    const local = { ...base, tombstones:[...base.tombstones, { id:'sessions:h1', entity:'sessions', refId:'h1', deletedAt:'2026-09-20T10:00:00Z', by:'local' }] };
    const remote = { ...base, tombstones:[...base.tombstones, { id:'sessions:h2', entity:'sessions', refId:'h2', deletedAt:'2026-09-20T11:00:00Z' }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.deepEqual(new Set(merged.tombstones.map(row=> row.id)), new Set(['sessions:h0','sessions:h1','sessions:h2']));

    // conflicting tombstone copies of the same id collapse to one row, and
    // recency of the deletion itself (deletedAt) decides which
    const conflictBase = { version:1, tombstones:[{ id:'sessions:h1', deletedAt:'2026-09-01T00:00:00Z' }] };
    const conflictLocal = { ...conflictBase, tombstones:[{ id:'sessions:h1', deletedAt:'2026-09-02T00:00:00Z', by:'local' }] };
    const conflictRemote = { ...conflictBase, tombstones:[{ id:'sessions:h1', deletedAt:'2026-09-03T00:00:00Z', by:'remote' }] };
    const conflictMerged = reconcileStoreSnapshots(conflictBase, conflictLocal, conflictRemote);
    assert.equal(conflictMerged.tombstones.length, 1);
    assert.equal(conflictMerged.tombstones[0].by, 'remote');
    // the older deletion winning is only a slot property, never content: with
    // the newer deletedAt in the local slot it still wins
    const flipped = reconcileStoreSnapshots(conflictBase, conflictRemote, conflictLocal);
    assert.equal(flipped.tombstones[0].by, 'remote');
    assert.deepEqual(
      reconcileStoreSnapshots(conflictBase, conflictLocal, conflictRemote),
      reconcileStoreSnapshots(conflictBase, conflictLocal, conflictRemote),
    );
  });

  it('keeps live and archived session history reconciling independently across tabs', ()=>{
    const session = { id:'s1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[session], archivedHistory:[] };
    // local archives the session while remote edits it in place
    const local = { version:13, history:[], archivedHistory:[{ ...session, savedAt:'2026-09-20T11:00:00Z', note:'local archive copy' }] };
    const remote = { version:13, history:[{ ...session, savedAt:'2026-09-20T12:00:00Z', note:'remote edit' }], archivedHistory:[] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.deepEqual(merged.history.map(row=> row.note), ['remote edit']);
    assert.deepEqual(merged.archivedHistory.map(row=> row.note), ['local archive copy']);

    // independent recency resolution per collection
    const archivedBase = { version:13, history:[], archivedHistory:[{ id:'s2', dateISO:'2026-09-19', savedAt:'2026-09-19T10:00:00Z', note:'base' }] };
    const localArchivedEdit = { ...archivedBase, archivedHistory:[{ id:'s2', dateISO:'2026-09-19', savedAt:'2026-09-19T11:00:00Z', note:'local archived edit' }] };
    const remoteArchivedEdit = { ...archivedBase, archivedHistory:[{ id:'s2', dateISO:'2026-09-19', savedAt:'2026-09-19T12:00:00Z', note:'remote archived edit' }] };
    const archivedMerged = reconcileStoreSnapshots(archivedBase, localArchivedEdit, remoteArchivedEdit);
    assert.equal(archivedMerged.archivedHistory[0].note, 'remote archived edit');
    assert.deepEqual(archivedMerged.history, []);
  });

  it('keeps equal-timestamp conflicts on local and makes invalid stamps deterministic', ()=>{
    const baseRow = { id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' };
    const base = { version:13, history:[baseRow] };
    const at = '2026-09-20T11:00:00Z';
    const localEqual = { ...baseRow, savedAt:at, note:'local equal' };
    const remoteEqual = { ...baseRow, savedAt:at, note:'remote equal' };
    const equalMerged = reconcileStoreSnapshots(base, { ...base, history:[localEqual] }, { ...base, history:[remoteEqual] });
    assert.equal(equalMerged.history[0].note, 'local equal');

    // Date.parse failures fall back to 0 on both sides -> deterministic local
    for(const badStamp of ['not-a-date', '', undefined]){
      const localBad = { ...baseRow, savedAt:badStamp, note:'local bad' };
      const remoteBad = { ...baseRow, savedAt:badStamp, note:'remote bad' };
      const badMerged = reconcileStoreSnapshots(base, { ...base, history:[localBad] }, { ...base, history:[remoteBad] });
      assert.equal(badMerged.history[0].note, 'local bad');
      assert.deepEqual(badMerged, reconcileStoreSnapshots(base, { ...base, history:[localBad] }, { ...base, history:[remoteBad] }));
    }
    // a usable stamp on one side still beats an unusable one on the other
    const localUnusable = { ...baseRow, savedAt:'garbage', note:'local' };
    const remoteUsable = { ...baseRow, savedAt:'1970-01-01T00:00:00.001Z', note:'remote' };
    assert.equal(reconcileStoreSnapshots(base, { ...base, history:[localUnusable] }, { ...base, history:[remoteUsable] }).history[0].note, 'remote');
  });

  it('merges eventHistory rows by id with recency resolution', ()=>{
    const base = { version:13, eventHistory:[{ id:'e1', at:'2026-09-20T10:00:00Z', value:'base' }] };
    const local = { ...base, eventHistory:[...base.eventHistory, { id:'e-local', at:'2026-09-20T11:00:00Z', value:'local only' }] };
    const remote = { ...base, eventHistory:[{ id:'e1', at:'2026-09-20T12:00:00Z', value:'remote edit' }, { id:'e-remote', at:'2026-09-20T13:00:00Z', value:'remote only' }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    const byId = new Map(merged.eventHistory.map(row=> [row.id, row]));
    assert.equal(byId.size, 3);
    assert.equal(byId.get('e1').value, 'remote edit');
    assert.equal(byId.get('e-local').value, 'local only');
    assert.equal(byId.get('e-remote').value, 'remote only');
  });

  it('never reopens an evidence row that already carries an outcome', ()=>{
    const open = id=>({ id, recordedAtISO:'2026-09-20T12:00:00Z', rec:'open', outcome:null });
    const resolved = (id, when)=>({ id, recordedAtISO:'2026-09-20T08:00:00Z', rec:'resolved', outcome:{ metTarget:true, recordedAtISO:when } });
    // newer open copy on the remote must not reopen an older local outcome
    const remoteOpen = reconcileStoreSnapshots({ version:1 }, { version:1, evaluationLedger:[resolved('e1','2026-09-20T09:00:00Z')] }, { version:1, evaluationLedger:[open('e1')] });
    assert.equal(remoteOpen.evaluationLedger[0].rec, 'resolved');
    // symmetric: newer open copy locally must not reopen a remote outcome
    const localOpen = reconcileStoreSnapshots({ version:1 }, { version:1, evaluationLedger:[open('e1')] }, { version:1, evaluationLedger:[resolved('e1','2026-09-20T09:00:00Z')] });
    assert.equal(localOpen.evaluationLedger[0].rec, 'resolved');
    // two outcome-bearing copies resolve by stamp, newest wins
    const bothResolved = reconcileStoreSnapshots({ version:1 }, { version:1, evaluationLedger:[resolved('e1','2026-09-20T09:00:00Z')] }, { version:1, evaluationLedger:[{ ...resolved('e1','2026-09-20T10:00:00Z'), rec:'resolved newer' }] });
    assert.equal(bothResolved.evaluationLedger[0].rec, 'resolved newer');
  });

  it('resolves evidence stamps by documented priority order', ()=>{
    // Within a row the stamp is its first populated rung:
    // outcome.recordedAtISO > outcomeProvenance.capturedAt > recordedAtISO > provenance.capturedAt.
    // Each case below proves the rung is read by making the lower rung disagree.

    // outcome.recordedAtISO is read before outcomeProvenance.capturedAt
    const byOutcomeStamp = reconcileStoreSnapshots({ version:1 },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'local', recordedAtISO:'2026-09-20T11:00:00Z' }, outcomeProvenance:{ capturedAt:'2026-09-20T08:00:00Z' } }] },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'remote' }, recordedAtISO:'2026-09-20T10:00:00Z' }] });
    assert.equal(byOutcomeStamp.evaluationLedger[0].outcome.metTarget, 'local');

    // outcomeProvenance.capturedAt is read before recordedAtISO
    const byProvenance = reconcileStoreSnapshots({ version:1 },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'local' }, outcomeProvenance:{ capturedAt:'2026-09-20T11:00:00Z' }, recordedAtISO:'2026-09-20T08:00:00Z' }] },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'remote' }, recordedAtISO:'2026-09-20T10:00:00Z' }] });
    assert.equal(byProvenance.evaluationLedger[0].outcome.metTarget, 'local');

    // recordedAtISO is read before provenance.capturedAt
    const byRecordedAt = reconcileStoreSnapshots({ version:1 },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'local' }, recordedAtISO:'2026-09-20T11:00:00Z', provenance:{ capturedAt:'2026-09-20T08:00:00Z' } }] },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'remote' }, provenance:{ capturedAt:'2026-09-20T10:00:00Z' } }] });
    assert.equal(byRecordedAt.evaluationLedger[0].outcome.metTarget, 'local');

    // provenance.capturedAt is the last rung before falling back to 0
    const byProvenanceFallback = reconcileStoreSnapshots({ version:1 },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'local' }, provenance:{ capturedAt:'2026-09-20T11:00:00Z' } }] },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'remote' } }] });
    assert.equal(byProvenanceFallback.evaluationLedger[0].outcome.metTarget, 'local');

    // invalid stamps fall back to 0 like row stamps do
    const invalidStamps = reconcileStoreSnapshots({ version:1 },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'local' }, recordedAtISO:'not-a-date' }] },
      { version:1, evaluationLedger:[{ id:'e1', outcome:{ metTarget:'remote' }, recordedAtISO:'also-not-a-date' }] });
    assert.equal(invalidStamps.evaluationLedger[0].outcome.metTarget, 'local');
  });

  it('merges custom templates by id with updatedAt recency', ()=>{
    const base = { version:13, customTemplates:[{ id:'t1', updatedAt:'2026-09-20T10:00:00Z', name:'base' }] };
    const local = { ...base, customTemplates:[...base.customTemplates, { id:'t-local', updatedAt:'2026-09-20T11:00:00Z', name:'local new' }] };
    const remote = { ...base, customTemplates:[{ id:'t1', updatedAt:'2026-09-20T12:00:00Z', name:'remote edit' }, { id:'t-remote', updatedAt:'2026-09-20T13:00:00Z', name:'remote new' }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    const byId = new Map(merged.customTemplates.map(row=> [row.id, row]));
    assert.equal(byId.size, 3);
    assert.equal(byId.get('t1').name, 'remote edit');
    assert.equal(byId.get('t-local').name, 'local new');
    assert.equal(byId.get('t-remote').name, 'remote new');
  });

  it('treats readiness and programme history entries as composite-key entities', ()=>{
    const base = {
      version:13,
      readinessLog:[
        { dateISO:'2026-09-20', at:'2026-09-20T08:00:00Z', score:70 },
        { dateISO:'2026-09-20', score:55 },
      ],
      programHistory:[{ programId:'p1', version:1, startDateISO:'2026-09-01', note:'base' }],
    };
    const local = {
      ...base,
      readinessLog:[
        { dateISO:'2026-09-20', at:'2026-09-20T08:00:00Z', score:70, note:'local edit' },
        { dateISO:'2026-09-20', score:55 },
      ],
      programHistory:[{ programId:'p1', version:1, startDateISO:'2026-09-01', note:'base', savedAt:'2026-09-20T11:00:00Z' }],
    };
    const remote = {
      ...base,
      readinessLog:[
        { dateISO:'2026-09-20', at:'2026-09-20T08:00:00Z', score:70, note:'remote edit' },
        { dateISO:'2026-09-20', score:55 },
      ],
      programHistory:[{ programId:'p1', version:1, startDateISO:'2026-09-01', note:'base', savedAt:'2026-09-20T12:00:00Z' }],
    };
    // readiness conflict under identical composite key: both copies stampless -> deterministic local
    const merged = reconcileStoreSnapshots(base, local, remote);
    const readinessByKey = new Map(merged.readinessLog.map(row=> [`${row.dateISO}|${row.at || row.score || ''}`, row]));
    assert.equal(readinessByKey.size, 2);
    assert.equal(readinessByKey.get('2026-09-20|2026-09-20T08:00:00Z').note, 'local edit');
    // programme history resolves by recency under the composite key
    assert.equal(merged.programHistory.length, 1);
    assert.equal(merged.programHistory[0].savedAt, '2026-09-20T12:00:00Z');
  });

  it('three-way merge yields to the changed side in both directions', ()=>{
    const base = { version:13, preferences:{ theme:'light', soundCues:true }, history:[{ id:'h1', dateISO:'2026-09-20', note:'base' }] };
    const localChanged = { ...base, preferences:{ ...base.preferences, soundCues:false }, history:[{ ...base.history[0], note:'local edit' }] };
    const remoteChanged = { ...base, preferences:{ ...base.preferences, theme:'dark' }, history:[{ ...base.history[0], note:'remote edit' }] };

    // base == local -> remote wins everywhere it changed
    const baseIsLocal = reconcileStoreSnapshots(base, structuredClone(base), structuredClone(remoteChanged));
    assert.equal(baseIsLocal.preferences.theme, 'dark');
    assert.equal(baseIsLocal.preferences.soundCues, true);
    assert.equal(baseIsLocal.history[0].note, 'remote edit');

    // base == remote -> local wins everywhere it changed
    const baseIsRemote = reconcileStoreSnapshots(base, structuredClone(localChanged), structuredClone(base));
    assert.equal(baseIsRemote.preferences.theme, 'light');
    assert.equal(baseIsRemote.preferences.soundCues, false);
    assert.equal(baseIsRemote.history[0].note, 'local edit');

    // swapping local and remote preserves one-sided per-key changes in both
    // directions, while an equal-stamp row conflict always resolves to the
    // local slot (so the swap flips which row wins)
    const swapped = reconcileStoreSnapshots(base, structuredClone(remoteChanged), structuredClone(localChanged));
    assert.equal(swapped.preferences.soundCues, false);
    assert.equal(swapped.preferences.theme, 'dark');
    assert.equal(swapped.history[0].note, 'remote edit');
  });

  it('is deterministic and idempotent under repeated reconciliation', ()=>{
    const base = { version:13, preferences:{ theme:'light' }, history:[{ id:'h1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z', note:'base' }] };
    const local = { ...base, preferences:{ theme:'dark' }, history:[{ ...base.history[0], savedAt:'2026-09-20T11:00:00Z', note:'local' }, { id:'l1', dateISO:'2026-09-21', savedAt:'2026-09-21T10:00:00Z' }] };
    const remote = { ...base, history:[{ ...base.history[0], savedAt:'2026-09-20T12:00:00Z', note:'remote' }, { id:'r1', dateISO:'2026-09-22', savedAt:'2026-09-22T10:00:00Z' }] };
    const first = reconcileStoreSnapshots(structuredClone(base), structuredClone(local), structuredClone(remote));
    const second = reconcileStoreSnapshots(structuredClone(base), structuredClone(local), structuredClone(remote));
    assert.deepEqual(second, first);
    // re-reconciling an already-merged local against the same remote converges to the same state
    const converged = reconcileStoreSnapshots(structuredClone(base), structuredClone(first), structuredClone(remote));
    assert.deepEqual(converged, first);
    // stable row order regardless of input row order
    const shuffled = reconcileStoreSnapshots(
      structuredClone(base),
      { ...local, history:[...local.history].reverse() },
      { ...remote, history:[...remote.history].reverse() },
    );
    assert.deepEqual(shuffled.history.map(row=> row.id), first.history.map(row=> row.id));
  });

  it('never mutates or aliases an input snapshot', ()=>{
    const base = { version:1, preferences:{ theme:'light' }, history:[{ id:'h1', dateISO:'2026-09-20', note:'base' }] };
    const local = structuredClone(base);
    const remote = { version:2, preferences:{ theme:'dark' }, history:[{ id:'h1', dateISO:'2026-09-20', note:'base' }, { id:'h2', dateISO:'2026-09-21' }] };
    const localBefore = structuredClone(local);
    const baseBefore = structuredClone(base);
    const merged = reconcileStoreSnapshots(base, local, remote);
    // the caller's local snapshot is untouched: no version bump, no injected
    // collection keys, no row mutation
    assert.deepEqual(local, localBefore);
    assert.deepEqual(base, baseBefore);
    assert.notEqual(merged, local);
    assert.equal(merged.version, 2);
    // merged rows are fresh copies, not references into the remote snapshot
    for(const row of merged.history){
      const source = remote.history.find(r=> r.id === row.id);
      if(source) assert.notEqual(row, source);
    }
    // mutating merged output must not leak back into either input
    merged.history[0].note = 'mutated';
    assert.equal(local.history[0].note, 'base');
    assert.equal(remote.history[0].note, 'base');
  });

  it('compares rows content-wise regardless of key order', ()=>{
    const base = { version:1, history:[{ id:'h1', dateISO:'2026-09-20', note:'base', savedAt:'2026-09-20T10:00:00Z' }] };
    // local merely reordered the keys of an unchanged row (e.g. a round-trip
    // through IndexedDB) — it must not look like a conflicting edit
    const local = { ...base, history:[{ savedAt:'2026-09-20T10:00:00Z', note:'base', dateISO:'2026-09-20', id:'h1' }] };
    const remote = { version:1, history:[{ id:'h1', dateISO:'2026-09-20', note:'remote edit', savedAt:'2026-09-20T12:00:00Z' }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.history[0].note, 'remote edit');
    // and a re-serialised unchanged row must not resurrect a locally deleted one
    const localDeleted = { ...base, history:[] };
    const remoteReserialised = { version:1, history:[{ savedAt:'2026-09-20T10:00:00Z', note:'base', dateISO:'2026-09-20', id:'h1' }] };
    const afterDelete = reconcileStoreSnapshots(base, localDeleted, remoteReserialised);
    assert.deepEqual(afterDelete.history, []);
  });

  it('never leaves an enumerable undefined key from a deleted-then-edited branch', ()=>{
    const base = { version:1, preferences:{ theme:'light', soundCues:true } };
    // local removes `soundCues`; remote removes `theme`: each key is deleted on
    // one side and untouched on the other, so both removals win cleanly
    const local = { version:1, preferences:{ theme:'light' } };
    const remote = { version:1, preferences:{ soundCues:true } };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.deepEqual(merged.preferences, {});
    for(const key of Object.keys(merged.preferences)){
      assert.notEqual(merged.preferences[key], undefined, `phantom undefined at ${key}`);
    }
    assert.equal('soundCues' in merged.preferences, false);
  });

  it('lets a stale local copy equal to base inherit every remote change', ()=>{
    const base = {
      version:7,
      preferences:{ theme:'light', units:'kg' },
      history:[{ id:'h1', dateISO:'2026-09-20', note:'base' }],
      eventHistory:[{ id:'e1', at:'2026-09-20T10:00:00Z' }],
      evaluationLedger:[{ id:'ev1', recordedAtISO:'2026-09-20T10:00:00Z' }],
    };
    const remote = {
      version:8,
      preferences:{ theme:'dark', units:'kg', soundCues:true },
      history:[{ id:'h1', dateISO:'2026-09-20', note:'remote edit' }, { id:'h2', dateISO:'2026-09-21' }],
      eventHistory:[{ id:'e1', at:'2026-09-20T11:00:00Z' }, { id:'e2', at:'2026-09-20T12:00:00Z' }],
      evaluationLedger:[{ id:'ev1', recordedAtISO:'2026-09-20T10:00:00Z' }, { id:'ev2', recordedAtISO:'2026-09-20T11:00:00Z' }],
    };
    const merged = reconcileStoreSnapshots(structuredClone(base), structuredClone(base), structuredClone(remote));
    assert.equal(merged.version, 8);
    assert.deepEqual(merged.preferences, remote.preferences);
    assert.deepEqual(merged.history, remote.history);
    assert.deepEqual(merged.eventHistory, remote.eventHistory);
    assert.deepEqual(merged.evaluationLedger, remote.evaluationLedger);
    // collections absent from the remote materialize as empty arrays in the canonical shape
    for(const key of ['archivedHistory','customTemplates','tombstones','readinessLog','programHistory']){
      assert.deepEqual(merged[key], []);
    }
  });

  it('converges when a stale tab folds in successive remotes', ()=>{
    const stale = { version:1, history:[{ id:'h0', dateISO:'2026-09-18', note:'b' }] };
    const remote1 = { version:2, history:[{ id:'h0', dateISO:'2026-09-18', note:'b' }, { id:'h1', dateISO:'2026-09-19', savedAt:'2026-09-19T10:00:00Z' }] };
    const remote2 = { version:3, history:[{ id:'h0', dateISO:'2026-09-18', note:'b' }, { id:'h1', dateISO:'2026-09-19', savedAt:'2026-09-19T10:00:00Z' }, { id:'h2', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z' }] };
    const fold1 = reconcileStoreSnapshots(structuredClone(stale), structuredClone(stale), structuredClone(remote1));
    const fold2 = reconcileStoreSnapshots(structuredClone(remote1), structuredClone(fold1), structuredClone(remote2));
    assert.deepEqual(fold2.history.map(row=> row.id).sort(), ['h0','h1','h2']);
    assert.equal(fold2.version, 3);
    // the folded state is a fixed point against the last remote
    const settled = reconcileStoreSnapshots(structuredClone(remote2), structuredClone(fold2), structuredClone(remote2));
    assert.deepEqual(settled, fold2);
  });

  it('produces the canonical persistence shape with version = max of the three', ()=>{
    const base = { version:'7', preferences:{ theme:'light' }, history:[], customTemplates:[] };
    const local = { version:11, preferences:{ theme:'dark' }, history:[{ id:'l1', dateISO:'2026-09-20', savedAt:'2026-09-20T10:00:00Z' }] };
    const remote = { version:9, preferences:{ theme:'light' }, history:[{ id:'r1', dateISO:'2026-09-21', savedAt:'2026-09-21T10:00:00Z' }] };
    const merged = reconcileStoreSnapshots(base, local, remote);
    assert.equal(merged.version, 11);
    // every documented collection exists on the canonical shape
    for(const key of ['history','archivedHistory','eventHistory','evaluationLedger','customTemplates','tombstones','readinessLog','programHistory']){
      assert.ok(Array.isArray(merged[key]), `expected ${key} to be an array`);
    }
    // base can outrank both copies, numeric strings coerce, junk falls back to 0
    assert.equal(reconcileStoreSnapshots({ version:20 }, { version:'11' }, { version:9 }).version, 20);
    assert.equal(reconcileStoreSnapshots({ version:'junk' }, { version:undefined }, { version:null }).version, 0);
    // merged collections survive alongside the coerced version
    assert.equal(merged.history.map(row=> row.id).length, 2);
    assert.equal(merged.customTemplates.length, 0);
  });

  it('resolves nested preference keys per-key through three-way reconciliation', ()=>{
    const base = { version:13, preferences:{ a:1, b:2, nested:{ x:1, y:2 } } };
    // remote removes a key while local leaves it untouched: the removal wins
    const localUntouched = { version:13, preferences:{ a:1, b:2, nested:{ x:1, y:2 } } };
    const remoteRemoved = { version:13, preferences:{ b:2, nested:{ x:1, y:2 } } };
    const mergedRemoval = reconcileStoreSnapshots(base, localUntouched, remoteRemoved);
    assert.equal('a' in mergedRemoval.preferences, false);

    // local adds a brand-new nested object while remote edits a leaf: both survive
    const localAdded = { version:13, preferences:{ a:1, b:2, nested:{ x:1, y:2 }, added:{ deep:{ flag:true } } } };
    const remoteLeaf = { version:13, preferences:{ a:1, b:2, nested:{ x:5, y:2 } } };
    const mergedAdd = reconcileStoreSnapshots(base, localAdded, remoteLeaf);
    assert.deepEqual(mergedAdd.preferences.added, { deep:{ flag:true } });
    assert.equal(mergedAdd.preferences.nested.x, 5);

    // array conflicts and leaf-vs-object conflicts resolve to local
    const baseLists = { version:13, preferences:{ list:[1,2,3], mixed:{ k:1 } } };
    const localLists = { version:13, preferences:{ list:[1,2,3,4], mixed:'local-leaf' } };
    const remoteLists = { version:13, preferences:{ list:[9], mixed:{ k:2 } } };
    const mergedLists = reconcileStoreSnapshots(baseLists, localLists, remoteLists);
    assert.deepEqual(mergedLists.preferences.list, [1,2,3,4]);
    assert.equal(mergedLists.preferences.mixed, 'local-leaf');
  });

  it('holds merge invariants over seeded pseudo-random snapshots', ()=>{
    function mulberry32(seed){
      let a = seed >>> 0;
      return function(){
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    const rand = mulberry32(0xC0FFEE);
    const sameRow = (a, b)=> JSON.stringify(a) === JSON.stringify(b);
    const pick = arr=> arr[Math.floor(rand() * arr.length)];
    const int = n=> Math.floor(rand() * n);
    const timestamp = ()=> {
      if(rand() < 0.15) return pick(['not-a-date', '', undefined, 'garbage']);
      return `2026-09-${String(10 + int(20)).padStart(2,'0')}T${String(int(24)).padStart(2,'0')}:${String(int(60)).padStart(2,'0')}:00Z`;
    };
    const rowFor = (id, stampField)=> {
      const row = { id, note:`note-${int(4)}` };
      if(stampField !== 'none' && rand() < 0.8) row[stampField] = timestamp();
      return row;
    };
    const evidenceRowFor = id=> {
      const row = { id, note:`note-${int(4)}` };
      if(rand() < 0.7) row.recordedAtISO = timestamp();
      if(rand() < 0.4) row.outcomeProvenance = { capturedAt: timestamp() };
      if(rand() < 0.3) row.outcome = { metTarget: rand() < 0.5, recordedAtISO: timestamp() };
      return row;
    };
    const collection = (ids, stampField)=> ids.map(id=> rowFor(id, stampField)).filter(()=> rand() < 0.85);
    const buildSnapshot = (ids, stampField, version)=>({
      version,
      history: collection(ids, stampField),
      archivedHistory: collection(ids, stampField),
      eventHistory: collection(ids, stampField),
      customTemplates: collection(ids, stampField),
      tombstones: collection(ids, stampField),
      evaluationLedger: ids.map(evidenceRowFor).filter(()=> rand() < 0.85),
      preferences:{ theme:pick(['light','dark']), units:pick(['kg','lb']), nested:{ x:int(3), y:int(3) } },
    });

    for(let round = 0; round < 150; round++){
      const ids = Array.from({ length: 3 + int(4) }, (_, i)=> `row-${i}`);
      const stampField = pick(['savedAt','updatedAt','at','dateISO','none']);
      const base = buildSnapshot(ids, stampField, 1 + int(10));
      const local = buildSnapshot(ids, stampField, 1 + int(10));
      const remote = buildSnapshot(ids, stampField, 1 + int(10));
      const merged = reconcileStoreSnapshots(structuredClone(base), structuredClone(local), structuredClone(remote));
      const rerun = reconcileStoreSnapshots(structuredClone(base), structuredClone(local), structuredClone(remote));

      // determinism: identical inputs, deep-equal outputs
      assert.deepEqual(rerun, merged, `round ${round}: non-deterministic merge`);
      // idempotence: merging the merged state again with the same remote is a fixed point
      const settled = reconcileStoreSnapshots(structuredClone(base), structuredClone(merged), structuredClone(remote));
      assert.deepEqual(settled, merged, `round ${round}: merge is not idempotent`);

      // version is the maximum of the three numeric versions
      const numericVersions = [base, local, remote].map(s=> Number(s.version) || 0);
      assert.equal(merged.version, Math.max(...numericVersions), `round ${round}: version is not max`);

      // swapping local and remote preserves the symmetric resolve paths: a row
      // changed on exactly one side is inherited unchanged from that side
      const swapped = reconcileStoreSnapshots(structuredClone(base), structuredClone(remote), structuredClone(local));
      for(const [name, keyOf] of Object.entries({ history: row=> row.id, eventHistory: row=> row.id, tombstones: row=> row.id })){
        const baseByKey = new Map(base[name].map(row=> [keyOf(row), row]));
        const localOnly = new Map(local[name].map(row=> [keyOf(row), row]).filter(([key, row])=> !baseByKey.has(key) || !sameRow(row, baseByKey.get(key))));
        const remoteOnly = new Map(remote[name].map(row=> [keyOf(row), row]).filter(([key, row])=> !baseByKey.has(key) || !sameRow(row, baseByKey.get(key))));
        const mergedByKey = new Map(merged[name].map(row=> [keyOf(row), row]));
        const swappedByKey = new Map(swapped[name].map(row=> [keyOf(row), row]));
        for(const [key, row] of localOnly){
          if(!remoteOnly.has(key)) assert.deepEqual(mergedByKey.get(key), row, `round ${round}: ${name} local-only change ${key} not inherited`);
        }
        for(const [key, row] of remoteOnly){
          if(!localOnly.has(key)) assert.deepEqual(swappedByKey.get(key), row, `round ${round}: ${name} remote-only change ${key} not inherited after swap`);
        }
      }

      // no collection loses a row that exists on either side and is absent from base,
      // and a collection never contains duplicate identities
      const collections = {
        history: row=> row.id,
        archivedHistory: row=> row.id,
        eventHistory: row=> row.id,
        customTemplates: row=> row.id,
        tombstones: row=> row.id,
      };
      for(const [name, keyOf] of Object.entries(collections)){
        const mergedKeys = merged[name].map(keyOf);
        assert.equal(new Set(mergedKeys).size, mergedKeys.length, `round ${round}: duplicate identity in ${name}`);
        const baseKeys = new Set(base[name].map(keyOf));
        const survivorKeys = new Set([...local[name].map(keyOf), ...remote[name].map(keyOf)]);
        for(const key of survivorKeys){
          if(!baseKeys.has(key)){
            assert.ok(mergedKeys.includes(key), `round ${round}: ${name} lost side-only row ${key}`);
          }
        }
      }

      // evaluation ledger is a union by id with monotonic outcomes
      const ledgerKeys = merged.evaluationLedger.map(row=> row.id);
      assert.equal(new Set(ledgerKeys).size, ledgerKeys.length, `round ${round}: duplicate id in evaluationLedger`);
      const localLedger = new Map(local.evaluationLedger.map(row=> [row.id, row]));
      const remoteLedger = new Map(remote.evaluationLedger.map(row=> [row.id, row]));
      for(const row of merged.evaluationLedger){
        const l = localLedger.get(row.id), r = remoteLedger.get(row.id);
        if(Boolean(l?.outcome) !== Boolean(r?.outcome)){
          assert.ok(row.outcome, `round ${round}: outcome-bearing row ${row.id} was reopened`);
        }
      }
    }
  });
});
