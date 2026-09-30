// archive.js — archive mode for very old training history + event pruning.
//
// Years of training must not make every hydration and analytics pass pay for
// sessions the user hasn't opened in a year. Archived sessions move out of
// the `sessions` store into `archive` (atomically, in one transaction) and
// stay queryable/inspectable — and fully restorable. Pruning applies the same
// discipline to event telemetry: it exists to power recent-behaviour models,
// so a rolling window plus a hard cap is the honest retention policy.

import { idbGetAll } from './idb.js';
import { idbTransaction } from './idb-tx.js';
import { splitSets } from './storageRecords.js';
import { isValidTombstone, rowTimestamp } from './domain.js';

export const ARCHIVE_META_ID = 'archive:meta';

function cutoffISO(days){
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function tombstoneFor(tombstones, entity, refId){
  let best = null;
  for(const t of tombstones || []){
    if(!isValidTombstone(t) || t.entity !== entity || t.refId !== refId) continue;
    if(!best || Date.parse(t.deletedAt) >= Date.parse(best.deletedAt)) best = t;
  }
  return best;
}

/** True when a newer tombstone covers this row (deletion wins over the row). */
export function isCoveredByTombstone(row, tombstones, entity){
  const t = tombstoneFor(tombstones, entity, row?.id);
  if(!t) return false;
  return Date.parse(t.deletedAt) >= rowTimestamp(row);
}

/**
 * Move sessions strictly older than `olderThanDays` into the archive store.
 * Sessions covered by a newer deletion tombstone are never archived (a
 * delete → archive attempt keeps the deletion). Ids already archived stay
 * archived (no duplicates).
 * @returns {{ archived: number, remaining: number }} counts, and meta is
 * persisted so the diagnostics screen can show what happened and when.
 */
export async function archiveOldSessions(olderThanDays = 365, { dryRun = false } = {}){
  const cutoff = cutoffISO(olderThanDays);
  const [sessions, archiveRows, tombstones] = await Promise.all([
    idbGetAll('sessions'), idbGetAll('archive'), idbGetAll('tombstones'),
  ]);
  const archivedIds = new Set((archiveRows || []).map((r) => r?.id).filter(Boolean));
  const stale = (sessions || []).filter((s) => s?.id && String(s?.dateISO || '') < cutoff
    && !archivedIds.has(s.id) && !isCoveredByTombstone(s, tombstones, 'sessions'));
  if(!stale.length || dryRun){
    return { archived: 0, remaining: (sessions || []).length, dryRun, cutoff };
  }
  await idbTransaction(['sessions', 'archive'], (ops)=> {
    for(const s of stale) ops.put('archive', s);
    for(const s of stale) ops.delete('sessions', s.id);
  });
  const meta = { id: ARCHIVE_META_ID, lastArchivedAt: new Date().toISOString(), cutoff, archivedTotal: stale.length };
  await idbTransaction(['archive'], (ops)=> ops.put('archive', meta));
  return { archived: stale.length, remaining: (sessions || []).length - stale.length, cutoff };
}

/** True when old history exists but hasn't been archived yet (nudge-able). */
export async function archiveCandidateCount(olderThanDays = 365){
  const cutoff = cutoffISO(olderThanDays);
  const [sessions, tombstones] = await Promise.all([idbGetAll('sessions'), idbGetAll('tombstones')]);
  return (sessions || []).filter((s) => String(s?.dateISO || '') < cutoff && !isCoveredByTombstone(s, tombstones, 'sessions')).length;
}

/**
 * Restore everything from the archive back into live history. Rows covered
 * by a newer tombstone stay deleted (an archive restored after a newer
 * deletion respects the deletion). Per-id last-write-wins against live rows
 * so an archived session updated on another device converges instead of
 * clobbering newer live work; live wins timestamp ties.
 */
export async function restoreArchive(){
  const [rows, live, tombstones] = await Promise.all([
    idbGetAll('archive'), idbGetAll('sessions'), idbGetAll('tombstones'),
  ]);
  const sessions = (rows || []).filter((r) => r?.id && r.id !== ARCHIVE_META_ID);
  if(!sessions.length) return 0;
  const liveById = new Map((live || []).map((s) => [s?.id, s]));
  const restorable = [];
  for(const s of sessions){
    if(isCoveredByTombstone(s, tombstones, 'sessions')) continue;
    const existing = liveById.get(s.id);
    if(existing && rowTimestamp(existing) > rowTimestamp(s)) continue;
    restorable.push(s);
  }
  // Tombstoned rows are dropped from the archive even when unrestorable so a
  // newer deletion can never be revived by a later restore.
  const tombstonedIds = sessions.filter((s) => isCoveredByTombstone(s, tombstones, 'sessions')).map((s) => s.id);
  if(!restorable.length && !tombstonedIds.length) return 0;
  const setRows = splitSets(restorable);
  await idbTransaction(['sessions', 'archive', 'sets'], (ops)=> {
    for(const s of restorable) ops.put('sessions', s);
    for(const row of setRows) ops.put('sets', row);
    for(const s of restorable) ops.delete('archive', s.id);
    for(const id of tombstonedIds) ops.delete('archive', id);
  });
  return restorable.length;
}

export async function archivedSessionCount(){
  const rows = (await idbGetAll('archive')) || [];
  return rows.filter((r) => r?.id && r.id !== ARCHIVE_META_ID).length;
}


/**
 * Prune event telemetry: drop events older than the rolling window, then
 * enforce a hard cap (newest survive). Events power recent-behaviour models;
 * they are non-essential and this is the retention policy, not data loss.
 */
export async function pruneEvents({ maxAgeDays = 180, maxCount = 2000, dryRun = false } = {}){
  const events = (await idbGetAll('events')) || [];
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const byAt = (e) => String(e?.at || e?.ts || e?.dateISO || '');
  // Migration logs are diagnostics, not telemetry — they survive pruning.
  const essential = (e) => String(e?.type || '') === 'migration';
  const stale = events.filter((e) => !essential(e) && byAt(e) && byAt(e) < cutoff);
  const keep = events.filter((e) => !stale.includes(e));
  // Hard cap, newest first — protects stores that predate clean timestamps.
  // Only prunable telemetry is capped; essential diagnostic records (migration
  // logs — a handful per install) always survive.
  const prunable = keep.filter((e) => !essential(e));
  const ordered = [...prunable].sort((a, b) => byAt(b).localeCompare(byAt(a)));
  const excess = ordered.slice(maxCount);
  const doomed = [...stale, ...excess];
  if(doomed.length && !dryRun){
    await idbTransaction(['events'], (ops)=> {
      for(const e of doomed) if(e?.id != null) ops.delete('events', e.id);
    });
  }
  return { pruned: doomed.length, remaining: events.length - doomed.length, dryRun };
}
