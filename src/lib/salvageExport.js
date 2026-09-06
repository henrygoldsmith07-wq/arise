// salvageExport.js — partial-data export when the store is untrusted.
//
// Recovery mode exists because boot-time integrity failed: the store on disk
// may be truncated, field-corrupted, or from a divergent point in time. The
// user still owns every intact row in it, so before they repair from a
// snapshot or start fresh, they can download what survived.
//
// Difference from the normal history-only export:
//   - runs on a possibly-broken store and NEVER throws
//   - re-normalises every entry defensively (one bad row is dropped, not fatal)
//   - marks the envelope `salvage: true` so an import of this file records
//     its provenance (see exportPolicy.js source tagging)

import { normaliseHistory } from './store.js';

export const SALVAGE_CONTRACT = 'arise-history-partial-v1';

/**
 * Extract every recoverable history entry. Tolerant by contract: invalid
 * rows are counted and skipped, never propagated.
 */
export function salvageHistory(rawHistory){
  const out = [];
  let dropped = 0;
  const list = Array.isArray(rawHistory) ? rawHistory : [];
  for(const entry of list){
    try {
      const [norm] = normaliseHistory([entry]);
      if(norm && norm.dateISO && Array.isArray(norm.blocks) && norm.blocks.some(b => b?.sets?.length)){
        out.push(norm);
      } else {
        dropped += 1;
      }
    } catch {
      dropped += 1;
    }
  }
  return { entries: out, dropped };
}

/** Build the download payload. Returns null only when nothing survived. */
export function buildSalvagePayload(store, { exportedAt = new Date().toISOString(), appVersion = null } = {}){
  const { entries, dropped } = salvageHistory(store?.history);
  if(!entries.length) return null;
  return {
    app: 'arise',
    contract: SALVAGE_CONTRACT,
    salvage: true,
    payloadVersion: 1,
    exportedAt,
    appVersion: appVersion ?? (typeof __ARISE_APP_VERSION__ !== 'undefined' ? __ARISE_APP_VERSION__ : null),
    droppedMalformed: dropped,
    data: { history: entries },
  };
}
