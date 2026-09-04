// Offline shell + layered caching.
//
// Strategies (first match wins):
//   navigations      → network-first, cached-shell fallback (deploys land
//                      immediately; offline keeps working).
//   /assets/*        → cache-first, refresh-behind. Vite emits content-hashed
//                      filenames, so a hit is always the right version.
//   illustrations    → cache-first, refresh-behind, CORS-safe. Exercise
//                      illustrations are cross-origin SVGs from the
//                      workout-guide site; without caching here they are the
//                      first thing to vanish on a gym's dead Wi-Fi. Stored
//                      opaquely (cross-origin, no-cors) on first sight.
//   everything else  → cache-first with background refresh (SWR): instant,
//                      self-healing.
//
// Update lifecycle is unchanged: versioned cache, skipWaiting on
// 'SKIP_WAITING' message, clients.claim on activate; the app defers that
// activation while a workout is running.

const CACHE = 'arise-v5';
const ILLUSTRATION_CACHE = 'arise-illustrations-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest'];
const ILLUSTRATION_ORIGIN = 'https://bryllim.github.io';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(()=> self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ILLUSTRATION_CACHE).map((k) => caches.delete(k)))).then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Strict same-origin enforcement: the SW only ever answers for the app's own
  // origin. The single sanctioned cross-origin fetch is the exercise
  // illustration host — handled by its dedicated cache below and never by the
  // generic strategies. (Also matches the CSP connect-src allowlist.)
  const isIllustrationHost = url.origin === ILLUSTRATION_ORIGIN && url.hostname === 'bryllim.github.io' && url.pathname.includes('/frames');
  if (url.origin !== location.origin && !isIllustrationHost) return;
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
  const isAsset = url.origin === location.origin && url.pathname.includes('/assets/');
  const isIllustration = isIllustrationHost;
  if (isAsset || isIllustration) {
    // Cache-first + refresh-behind: content-hashed (or effectively immutable
    // SVG frames), so the cached copy is authoritative; the network copy
    // updates the cache for next time.
    const cacheName = isIllustration ? ILLUSTRATION_CACHE : CACHE;
    e.respondWith(
      caches.open(cacheName).then(async (cache) => {
        const hit = await cache.match(req);
        const refresh = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).catch(()=>{});
          }
          return res;
        }).catch(()=> null);
        return hit || (await refresh) || Response.error();
      })
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
