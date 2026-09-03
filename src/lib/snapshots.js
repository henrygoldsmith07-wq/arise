// snapshots.js — automatic local backup snapshots and rollback.
//
// IndexedDB survives most things, but not every thing: a corrupted
// recomposition, a bad import, a browser profile reset, a bug shipped in a
// release. The quarantine covers structural damage at boot; snapshots cover
// the *good* state itself. A rolling set of last-known-good store payloads is
// written automatically (after saves, rate-limited), and the user can roll
// back to the previous snapshot from the diagnostics screen. Snapshots are
// stored inside IndexedDB itself, so they inherit its durability; the oldest
// are evicted to keep the footprint bounded.

import { idbGet, idbGetAll, idbPut, idbDelete, STORES } from './idb.js';
import { idbTransaction } from './idb-tx.js';
import { enforceIntegrity } from './integrity.js';

const SNAPSHOT_META_ID = 'snapshots:meta';
export const MAX_SNAPSHOTS = 7;
const MIN_INTERVAL_MS = 30 * 60 * 1000; // don't snapshot more often than hourly

function snapshotId(now = Date.now()){
  const d = new Date(now);
  return `snap:${d.toISOString().replace(/[:.]/g, '-')}`;
}

/** Capture every canonical store's rows as one restorable payload. */
export async function captureSnapshot({ force = false, reason = 'automatic' } = {}){
  const meta = (await idbGet('snapshots', SNAPSHOT_META_ID)) || null;
  const last = meta?.lastAt ? Date.parse(meta.lastAt) : 0;
  const now = Date.now();
  if(!force && now - last < MIN_INTERVAL_MS) return null;

  const stores = STORES.filter((s) => s !== 'snapshots');
  const payload = {};
  for(const s of stores) payload[s] = await idbGetAll(s);

  const record = {
    id: snapshotId(now),
    at: new Date(now).toISOString(),
    reason,
    payload,
  };
  await idbPut('snapshots', record, record.id);
  const all = (await idbGetAll('snapshots')) || [];
  const records = all.filter((r) => r?.id && r.id !== SNAPSHOT_META_ID)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  for(const stale of records.slice(MAX_SNAPSHOTS)) await idbDelete('snapshots', stale.id);
  await idbPut('snapshots', { id: SNAPSHOT_META_ID, lastAt: record.at, count: Math.min(records.length, MAX_SNAPSHOTS) }, SNAPSHOT_META_ID);
  return record.id;
}

/** List snapshots, newest first (diagnostics screen). */
export async function listSnapshots(){
  const all = (await idbGetAll('snapshots')) || [];
  return all.filter((r) => r?.id && r.id !== SNAPSHOT_META_ID)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((r) => ({ id: r.id, at: r.at, reason: r.reason || 'automatic' }));
}

/**
 * Roll the world back to a snapshot (default: the newest one, i.e. the state
 * just before whatever went wrong). The restore runs as ONE atomic
 * transaction — a rollback that fails halfway must not leave a chimera.
 * The restored payload is integrity-checked first; a snapshot that fails the
 * gate is refused rather than multiplied into the live stores.
 */
export async function rollbackToSnapshot(id){
  const records = (await idbGetAll('snapshots')) || [];
  const target = id
    ? records.find((r) => r?.id === id)
    : records.filter((r) => r?.id && r.id !== SNAPSHOT_META_ID).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  if(!target?.payload) throw new Error('Snapshot not found.');
  const payload = target.payload;

  const probe = { history: payload.sessions || [], eventHistory: payload.events || [], readinessLog: payload.readiness?.log || [], programHistory: payload.programme?.[0]?.programHistory || [], ...payload.profile, version: payload.profile?.version };
  const checked = enforceIntegrity(probe);
  if(checked.repaired) throw new Error('Snapshot failed the integrity gate; refusing to restore.');

  const stores = STORES.filter((s) => s !== 'snapshots');
  await idbTransaction(stores, (ops)=> {
    for(const s of stores){
      ops.clearStore(s);
      for(const row of payload[s] || []) ops.put(s, row, row?.id ?? undefined);
    }
  });
  return { restoredAt: new Date().toISOString(), snapshotAt: target.at, id: target.id };
}
