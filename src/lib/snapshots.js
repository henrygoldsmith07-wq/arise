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
import { idbTransaction, idbReadTransaction } from './idb-tx.js';
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

  // One readonly transaction across all snapshot stores: the payload is a
  // single coherent database point-in-time. Sequential per-store reads could
  // interleave with an atomic save committing between two reads (mixed
  // snapshot: history from t+1 with programme from t).
  const stores = STORES.filter((s) => s !== 'snapshots');
  const payload = await idbReadTransaction(stores);

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

const ARCHIVE_META_ID = 'archive:meta';
const PROFILE_ID = 'profile';
const PROGRAMME_ID = 'active';
const READINESS_ID = 'log';

function firstRow(rows, id){
  if(!Array.isArray(rows)) return null;
  if(id) return rows.find((r) => r?.id === id) || null;
  return rows[0] || null;
}

/**
 * Reconstruct exactly the same logical store shape as normal IndexedDB
 * hydration (storage.js loadStoreFromIdb) from a snapshot payload whose
 * per-store values are row arrays. Every canonical domain is covered:
 * profile, sessions, sets (derived — validated via history), programme,
 * recommendations/outcomes, events, readiness, templates, tombstones,
 * archived history, study fields, Gym Mode prefs, active workout/schedule.
 */
export function recomposeSnapshotPayload(payload){
  const p = payload && typeof payload === 'object' ? payload : {};
  const profile = firstRow(p.profile, PROFILE_ID) || firstRow(p.profile, null) || {};
  const programme = firstRow(p.programme, PROGRAMME_ID) || firstRow(p.programme, null) || null;
  const readiness = firstRow(p.readiness, READINESS_ID) || firstRow(p.readiness, null) || null;
  // Defensive: corrupt rows flow to the integrity gate as validation
  // failures, never throw here (rollback maps any recompose failure to a
  // pre-mutation refusal anyway).
  const rawSchedule = programme?.activeSchedule ?? null;
  const schedule = rawSchedule && typeof rawSchedule === 'object' && !Array.isArray(rawSchedule) ? rawSchedule : rawSchedule;
  if(schedule && typeof schedule === 'object' && Array.isArray(p.adaptations)){
    try{ schedule.adaptationHistory = p.adaptations; }catch{}
  }
  const ledgerMap = new Map();
  for(const r of [...(Array.isArray(p.recommendations) ? p.recommendations : []), ...(Array.isArray(p.outcomes) ? p.outcomes : [])]){
    if(r && typeof r === 'object' && (!ledgerMap.get(r.id) || (!ledgerMap.get(r.id).outcome && r.outcome))) ledgerMap.set(r.id, r);
  }
  const sessions = Array.isArray(p.sessions) ? p.sessions : [];
  const liveIds = new Set(sessions.map((s) => s?.id).filter(Boolean));
  const archivedHistory = (Array.isArray(p.archive) ? p.archive : []).filter((r) => r?.id && r.id !== ARCHIVE_META_ID && !liveIds.has(r.id));
  return {
    version: profile?.version ?? null,
    onboarding: profile?.onboarding ?? null,
    preferences: profile?.preferences ?? {},
    gymPrefs: profile?.gymPrefs ?? null,
    demo: profile?.demo === true,
    healthSummary: profile?.healthSummary ?? null,
    studyParticipantId: profile?.studyParticipantId ?? null,
    studyEnrollment: profile?.studyEnrollment ?? null,
    studyStatus: profile?.studyStatus ?? null,
    studyStatusChangedAtISO: profile?.studyStatusChangedAtISO ?? null,
    activeWorkout: profile?.activeWorkout ?? null,
    history: sessions,
    archivedHistory,
    activeSchedule: schedule,
    programHistory: programme?.programHistory || [],
    eventHistory: Array.isArray(p.events) ? p.events : [],
    readinessLog: readiness?.log ?? [],
    customTemplates: Array.isArray(p.templates) ? p.templates : [],
    tombstones: Array.isArray(p.tombstones) ? p.tombstones : [],
    evaluationLedger: [...ledgerMap.values()],
  };
}

/**
 * Roll the world back to a snapshot (default: the newest one, i.e. the state
 * just before whatever went wrong). The restore runs as ONE atomic
 * transaction — a rollback that fails halfway must not leave a chimera.
 * The restored payload is integrity-checked first via the canonical gate;
 * a snapshot that fails is refused BEFORE any live store is modified.
 */
export async function rollbackToSnapshot(id){
  const records = (await idbGetAll('snapshots')) || [];
  const target = id
    ? records.find((r) => r?.id === id)
    : records.filter((r) => r?.id && r.id !== SNAPSHOT_META_ID).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  if(!target?.payload) throw new Error('Snapshot not found.');
  const payload = target.payload;

  // Canonical gate: snapshot → logical store → enforceIntegrity → restore.
  // recompose mirrors hydration exactly (the old probe spread the profile ROW
  // ARRAY into the store, so corrupt profiles and readiness passed or failed
  // for the wrong reasons). Any recompose failure is itself a gate failure:
  // refuse before mutating.
  let recomposed;
  try{ recomposed = recomposeSnapshotPayload(payload); }
  catch{ throw new Error('Snapshot failed the integrity gate; refusing to restore. No data was changed.'); }
  const checked = enforceIntegrity(recomposed);
  if(checked.repaired) throw new Error('Snapshot failed the integrity gate; refusing to restore. No data was changed.');

  const stores = STORES.filter((s) => s !== 'snapshots');
  await idbTransaction(stores, (ops)=> {
    for(const s of stores){
      ops.clearStore(s);
      for(const row of payload[s] || []) ops.put(s, row, row?.id ?? undefined);
    }
  });
  return { restoredAt: new Date().toISOString(), snapshotAt: target.at, id: target.id };
}
