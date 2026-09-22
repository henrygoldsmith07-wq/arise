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
import { splitSets } from './storage.js';

export const ARCHIVE_META_ID = 'archive:meta';

function cutoffISO(days){
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Move sessions strictly older than `olderThanDays` into the archive store.
 * @returns {{ archived: number, remaining: number }} counts, and meta is
 * persisted so the diagnostics screen can show what happened and when.
 */
export async function archiveOldSessions(olderThanDays = 365, { dryRun = false } = {}){
  const cutoff = cutoffISO(olderThanDays);
  const sessions = await idbGetAll('sessions');
  const stale = (sessions || []).filter((s) => String(s?.dateISO || '') < cutoff);
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
  const sessions = await idbGetAll('sessions');
  return (sessions || []).filter((s) => String(s?.dateISO || '') < cutoff).length;
}

/** Restore everything from the archive back into live history. */
export async function restoreArchive(){
  const rows = (await idbGetAll('archive')) || [];
  const sessions = rows.filter((r) => r?.id && r.id !== ARCHIVE_META_ID);
  if(!sessions.length) return 0;
  const setRows = splitSets(sessions);
  await idbTransaction(['sessions', 'archive', 'sets'], (ops)=> {
    for(const s of sessions) ops.put('sessions', s);
    for(const row of setRows) ops.put('sets', row);
    for(const s of sessions) ops.delete('archive', s.id);
  });
  return sessions.length;
}

export async function archivedSessionCount(){
  const rows = (await idbGetAll('archive')) || [];
  return rows.filter((r) => r?.id && r.id !== ARCHIVE_META_ID).length;
}


/**
 * Read archived sessions without moving them back into live history.
 * Newest-first keeps the browser useful even when years of sessions exist.
 */
export async function listArchivedSessions(){
  const rows = (await idbGetAll('archive')) || [];
  return rows
    .filter((r) => r?.id && r.id !== ARCHIVE_META_ID)
    .sort((a, b) => String(b?.dateISO || '').localeCompare(String(a?.dateISO || '')));
}

/**
 * Restore one archived session atomically. If the id is not present, return
 * false rather than creating or deleting anything.
 */
export async function restoreArchivedSession(sessionId){
  const id = String(sessionId || '').trim();
  if(!id || id === ARCHIVE_META_ID) return false;
  const rows = (await idbGetAll('archive')) || [];
  const session = rows.find((r) => r?.id === id);
  if(!session) return false;
  const setRows = splitSets([session]);
  await idbTransaction(['sessions', 'archive', 'sets'], (ops)=> {
    ops.put('sessions', session);
    for(const row of setRows) ops.put('sets', row);
    ops.delete('archive', id);
  });
  return true;
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
