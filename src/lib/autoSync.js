// autoSync.js — background sync trigger for App.jsx.
//
// Deliberately tiny and dependency-free: given the freshly saved store, run
// one full sync cycle when (and only when) sync is enabled AND configured.
// Never throws — failures are written into the sync config for the status
// screen. The whole point is that a workout ends, the data lands locally,
// and the remote converges without the user thinking about it.

import { runSync } from './syncEngine.js';
import { makeWebdavAdapter } from './webdav.js';

/**
 * @returns {Promise<void>} — fire-and-forget from the caller.
 */
export async function autoSyncAfterSave({ store, setStore }){
  try{
    const prefs = store?.preferences || {};
    if(prefs.syncEnabled !== true) return;
    const sync = prefs.sync || {};
    if(!sync.url || !sync.password) return; // not configured yet
    const adapter = makeWebdavAdapter({ url: sync.url, username: sync.username, password: sync.password });
    const { merged, config } = await runSync({ store, config: sync, adapter });
    // Persist runtime state + merged store; keep credentials device-local
    // (config already IS the local config — runSync never strips it).
    setStore({
      ...store,
      ...merged,
      preferences: { ...(merged.preferences || {}), sync: config },
    });
  }catch{
    // Absolutely never block a saved workout on a sync problem.
  }
}
