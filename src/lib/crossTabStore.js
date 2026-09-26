// Cross-tab store invalidation.
//
// IndexedDB is canonical after hydration, so tabs exchange *invalidation*
// messages rather than full store payloads. BroadcastChannel is the primary
// transport; a tiny localStorage pulse is the conservative fallback for
// browsers without BroadcastChannel support.

export const STORE_CHANNEL = 'arise.store.changes.v1';
export const STORE_FALLBACK_KEY = 'arise.store.change-pulse.v1';

function makeSourceId(){
  try{ return crypto.randomUUID(); }catch{ return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function validMessage(value){
  return value && value.type === 'store-invalidated' && typeof value.sourceId === 'string' && typeof value.revision === 'string';
}

export function createStoreInvalidationBus({
  sourceId = makeSourceId(),
  channelFactory = typeof window !== 'undefined' && typeof BroadcastChannel === 'function' ? (name)=> new BroadcastChannel(name) : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  storageRef = typeof localStorage !== 'undefined' ? localStorage : null,
  now = ()=> Date.now(),
} = {}){
  const listeners = new Set();
  let sequence = 0;
  let channel = null;
  let closed = false;

  const deliver = (message)=>{
    if(closed || !validMessage(message) || message.sourceId === sourceId) return;
    for(const listener of [...listeners]){
      try{ listener(message); }catch{}
    }
  };

  const onChannelMessage = (event)=> deliver(event?.data);
  const onStorage = (event)=>{
    if(event?.key !== STORE_FALLBACK_KEY || !event.newValue) return;
    try{ deliver(JSON.parse(event.newValue)); }catch{}
  };

  if(channelFactory){
    try{
      channel = channelFactory(STORE_CHANNEL);
      channel?.addEventListener?.('message', onChannelMessage);
    }catch{ channel = null; }
  }
  if(!channel) windowRef?.addEventListener?.('storage', onStorage);

  return {
    sourceId,
    mode: channel ? 'broadcast' : (windowRef && storageRef ? 'storage' : 'none'),
    subscribe(listener){
      if(typeof listener !== 'function' || closed) return ()=>{};
      listeners.add(listener);
      return ()=> listeners.delete(listener);
    },
    publish(reason = 'store-write'){
      if(closed) return null;
      const message = {
        type: 'store-invalidated',
        sourceId,
        revision: `${now()}-${++sequence}`,
        reason,
      };
      if(channel){
        try{ channel.postMessage(message); }catch{}
      } else if(storageRef){
        try{ storageRef.setItem(STORE_FALLBACK_KEY, JSON.stringify(message)); }catch{}
      }
      return message;
    },
    close(){
      if(closed) return;
      closed = true;
      listeners.clear();
      if(channel){
        try{ channel.removeEventListener?.('message', onChannelMessage); }catch{}
        try{ channel.close?.(); }catch{}
      } else {
        windowRef?.removeEventListener?.('storage', onStorage);
      }
    },
  };
}

// Coalesces bursts and defers refresh while a protected local draft/session is
// active. The caller owns how canonical state is read and applied.
export function createStoreRefreshCoordinator({ subscribe, readCanonical, applyCanonical, isProtected = ()=> false } = {}){
  let closed = false;
  let deferred = false;
  let running = null;
  let rerun = false;

  const refresh = ()=>{
    if(closed) return Promise.resolve({ closed:true });
    if(isProtected()){
      deferred = true;
      return Promise.resolve({ deferred:true });
    }
    if(running){ rerun = true; return running; }
    running = (async()=>{
      do{
        rerun = false;
        const next = await readCanonical();
        if(closed) return { closed:true };
        if(isProtected()){
          deferred = true;
          return { deferred:true };
        }
        if(next) applyCanonical(next);
      }while(rerun);
      deferred = false;
      return { applied:true };
    })().finally(()=> { running = null; });
    return running;
  };

  const unsubscribe = typeof subscribe === 'function' ? subscribe(()=> { void refresh(); }) : ()=>{};
  return {
    refresh,
    flushDeferred(){
      if(!deferred || isProtected()) return Promise.resolve({ deferred });
      return refresh();
    },
    hasDeferred(){ return deferred; },
    close(){ closed = true; deferred = false; try{ unsubscribe?.(); }catch{} },
  };
}
