// wakeLock.js — keep the screen awake during a workout.
//
// Gym phones dim and lock mid-rest; unlocking between sets is exactly the
// friction Gym Mode exists to remove. The Screen Wake Lock API is opted into
// per preference, re-acquired automatically when the tab becomes visible
// again (the browser releases the lock on hide), and always released when the
// session ends. No-op everywhere the API is missing.

export function wakeLockSupported(){
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function createWakeLock(){
  let sentinel = null;
  let released = true;
  let listeners = [];

  const emit = (held)=>{ for(const fn of listeners){ try{ fn(held); }catch{} } };

  const reacquire = async ()=>{
    if(released || sentinel) return;
    try{
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener?.('release', ()=>{ sentinel = null; emit(false); });
      emit(true);
    }catch{ sentinel = null; emit(false); }
  };

  // Browsers release the lock when the tab is hidden. Re-request on return —
  // this is the entire reason the handle exists instead of a raw request.
  const onVisibility = ()=>{
    if(document.visibilityState === 'visible' && !sentinel && !released) reacquire();
  };

  return {
    supported: wakeLockSupported(),
    async acquire(){
      if(!wakeLockSupported()) return false;
      released = false;
      document.addEventListener('visibilitychange', onVisibility);
      await reacquire();
      return sentinel != null;
    },
    async release(){
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      try{ await sentinel?.release?.(); }catch{}
      sentinel = null;
      emit(false);
    },
    isHeld(){ return sentinel != null; },
    onChange(fn){ listeners.push(fn); return ()=> { listeners = listeners.filter(l=> l !== fn); }; },
  };
}
