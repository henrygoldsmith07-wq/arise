// OfflineBanner.jsx — honest connection state.
//
// navigator.onLine alone lies in captive portals and some VMs, so it is only
// half the story here: the banner appears when the browser reports offline OR
// a real fetch probe fails while online is claimed. Re-checks on every
// online/offline event and on a 30s interval while hidden.

import { useEffect, useState } from 'react';

async function probe(){
  try{
    // Cache-buster: the SW caches same-origin GETs, so bounce off a URL the
    // SW will pass through (mode:'no-store' also defeats any HTTP cache).
    const res = await fetch(`./favicon.svg?probe=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    return res.ok || res.type === 'opaque';
  }catch{ return false; }
}

export default function OfflineBanner(){
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    let alive = true;
    const recheck = async () => {
      const browserSaysOffline = navigator.onLine === false;
      const really = browserSaysOffline ? true : !(await probe());
      if(alive) setOffline(really);
    };
    const onOnline = () => recheck();
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const interval = setInterval(recheck, 30_000);
    return () => {
      alive = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  if(!offline) return null;
  return (
    <div role="status" className="rounded-xl border border-review/40 bg-reviewsoft px-3 py-2 text-xs text-center mx-4 mt-2">
      <span className="font-bold">Offline</span> <span className="text-ink3">— everything still works. Logging, history and programs are all local; sync resumes when you reconnect.</span>
    </div>
  );
}
