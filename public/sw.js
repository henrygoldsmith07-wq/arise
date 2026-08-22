// Minimal offline shell: cache the app shell on install, offline-first for assets.
// Navigations are network-first so a deploy reaches users immediately; the cache
// copy keeps the app usable offline (falling back to ./index.html).
// PWA lifecycle: versioned cache, skipWaiting + controllerchange, offline-first preserved.

const CACHE = 'arise-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(()=> self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Network-first: fresh HTML when online, cached shell when offline.
    // (Cache-first navigations pinned stale HTML after every deploy.)
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(async ()=> (await caches.match(req)) || (await caches.match('./index.html')) || Response.error())
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(()=> hit);
      return hit || fetchPromise;
    })
  );
});

self.addEventListener('message', (e)=>{
  if(e.data==='SKIP_WAITING') self.skipWaiting();
  if(e.data && e.data.type==='GET_VERSION') e.ports?.[0]?.postMessage({ version: CACHE });
});
