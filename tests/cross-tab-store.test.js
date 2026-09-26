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
});
