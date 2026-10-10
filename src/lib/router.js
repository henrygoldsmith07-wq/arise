// router.js — zero-dependency URL routing for the PWA shell.
//
// Arise is a local-first PWA with no backend and no account. Navigation is
// normally a single useState string (the active tab). This module adds a
// declarative URL mirror so that:
//
//   1. Deep links work: a URL like https://arise.app/?tab=exercises opens
//      directly on the Exercises tab, and ?tab=train opens Train.
//   2. Bookmarks and home-screen shortcuts resolve to the right tab on load.
//   3. The back/forward buttons move between tab changes within the session.
//
// The router is intentionally tiny and dependency-free: it reads/writes the
// `tab` query parameter, keeps the URL in sync with the active tab, and
// exposes a `getInitialTab()` for the very first render (before React mounts).
//
// Design decisions:
//   - Uses search params (?tab=exercises), NOT hash routing. Hash routing
//     would conflict with the app's existing #main skip-link anchor and
//     complicates PWA installation. Search params are clean, shareable, and
//     survive reloads.
//   - Falls back to 'today' for anything unrecognized, so a stale or malformed
//     URL never breaks boot.
//   - History entries are pushed (not replaced) on explicit user tab changes,
//     so back-button navigation cycles through tabs visited in the session.
//   - On first load, a replaceState keeps the URL clean (no extra history
//     entry for the initial state).

const VALID_TABS = new Set(['today', 'train', 'exercises', 'progress', 'more']);
const DEFAULT_TAB = 'today';

/**
 * Read the `tab` parameter from a URL or search string.
 * Returns the tab if valid, otherwise null.
 */
export function parseTabFromUrl(searchParams){
  const raw = searchParams.get('tab');
  if(raw && VALID_TABS.has(raw)) return raw;
  return null;
}

/**
 * Extract the initial tab from the current location (for SSR/first paint).
 * Returns a valid tab name or the default.
 */
export function getInitialTab(){
  if(typeof window === 'undefined') return DEFAULT_TAB;
  try{
    const params = new URLSearchParams(window.location.search);
    return parseTabFromUrl(params) || DEFAULT_TAB;
  }catch{
    return DEFAULT_TAB;
  }
}

/**
 * Synchronize a tab change to the URL bar.
 * - On the first call, replaces the current history entry so the URL is clean
 *   without adding a spurious back step.
 * - On subsequent calls, pushes a new history entry so the back button
 *   cycles through visited tabs.
 *
 * @param {string} tab - the new active tab
 * @param {object} [options]
 * @param {boolean} [options.replace] - if true, replaceState instead of pushState
 */
let initialTabSeen = false;
export function syncTabToUrl(tab, { replace = false } = {}){
  if(typeof window === 'undefined') return;
  if(!VALID_TABS.has(tab)) return;
  try{
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    // Hash goes after the query string so the #main skip-link anchor survives.
    const finalUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
    if(replace || !initialTabSeen){
      window.history.replaceState({ tab }, '', finalUrl);
    }else{
      window.history.pushState({ tab }, '', finalUrl);
    }
    initialTabSeen = true;
  }catch{
    // URL manipulation is best-effort; routing still works in-memory.
  }
}

/**
 * Wire up back/forward button handling. Call this once during app boot.
 * Returns a cleanup function.
 *
 * When the user presses back/forward, we read the `tab` from the new URL and
 * return it via the callback — the caller updates in-memory state.
 */
export function subscribeToPopState(callback){
  if(typeof window === 'undefined' || typeof callback !== 'function') return ()=>{};
  const handler = ()=>{
    const params = new URLSearchParams(window.location.search);
    const tab = parseTabFromUrl(params) || DEFAULT_TAB;
    callback(tab);
  };
  window.addEventListener('popstate', handler);
  return ()=> window.removeEventListener('popstate', handler);
}

// Export the valid set so tests and components can reference it.
export { VALID_TABS, DEFAULT_TAB };
