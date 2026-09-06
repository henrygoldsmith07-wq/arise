// supportDiagnostics.js — a user-initiated, privacy-minimal support bundle.
//
// When something is wrong and the user asks for help, this assembles a single
// JSON file that answers the common questions WITHOUT the training data:
//   - app version, platform, when it was exported
//   - storage health (estimate, persistence, quota level) from storageQuota.js
//   - last migration log entries (from migrationLog.js, best-effort)
//   - store shape summary: counts and date RANGES only, never set contents
//   - recent local error diagnostics (already sanitized by telemetry.js)
//   - service worker / cache version when available
//
// Explicitly excluded: sessions, sets, weights, notes, readiness values,
// consent flags beyond on/off booleans, sync credentials (never read here),
// and anything from the evaluation ledger. A support bundle diagnoses the
// environment, not the person.

import { storageHealth } from './storageQuota.js';
import { listMigrationLogs } from './migrationLog.js';
import { getEventHistory, getErrorEvents } from './telemetry.js';

/** Shape summary: counts + min/max dates per collection. No records. */
export function storeShapeSummary(store){
  const history = Array.isArray(store?.history) ? store.history : [];
  const dates = history.map(h => String(h?.dateISO || '')).filter(Boolean).sort();
  const eventCount = (() => {
    try { const e = getEventHistory(); return Array.isArray(e) ? e.length : 0; } catch { return 0; }
  })();
  return {
    historyCount: history.length,
    historyFirstDate: dates[0] || null,
    historyLastDate: dates[dates.length - 1] || null,
    scheduledSessionCount: Array.isArray(store?.activeSchedule?.sessions) ? store.activeSchedule.sessions.length : 0,
    customTemplateCount: Array.isArray(store?.customTemplates) ? store.customTemplates.length : 0,
    readinessLogCount: Array.isArray(store?.readinessLog) ? store.readinessLog.length : 0,
    eventHistoryCount: eventCount,
    onboardingComplete: store?.onboarding != null,
    schemaVersion: store?.version ?? null,
  };
}

function getEventHistorySafe(){
  // Retained for API compatibility with earlier internal callers; the real
  // probe now lives in the imports above.
  return getEventHistory();
}

/** Build the full support bundle. Async because storage health is async. */
export async function buildSupportBundle({ store, appVersion = null } = {}){
  const [storage, migrations] = await Promise.all([
    storageHealth().catch(() => null),
    listMigrationLogs().catch(() => null),
  ]);
  let swVersion = null;
  try {
    const reg = await navigator?.serviceWorker?.getRegistration?.();
    if(reg?.active){
      swVersion = await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => resolve(e.data?.version || null);
        const timer = setTimeout(() => resolve(null), 1500);
        reg.active.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
        setTimeout(() => { clearTimeout(timer); resolve(swVersion); }, 1600);
      });
    }
  } catch { /* SW not registered — fine */ }

  return {
    app: 'arise-support-bundle',
    bundleVersion: 1,
    appVersion: appVersion ?? (typeof __ARISE_APP_VERSION__ !== 'undefined' ? __ARISE_APP_VERSION__ : null),
    exportedAt: new Date().toISOString(),
    platform: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      language: typeof navigator !== 'undefined' ? navigator.language : null,
      standalone: typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(display-mode: standalone)').matches
        : null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    },
    storage,
    migrations: Array.isArray(migrations) ? migrations.slice(-20) : null,
    storeShape: storeShapeSummary(store),
    recentErrors: (() => {
      try { return getErrorEvents().slice(-10); } catch { return []; }
    })(),
    swVersion,
  };
}
