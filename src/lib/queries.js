// queries.js — indexed queries, pagination and lazy loading over IDB.
//
// The monolithic in-memory store stays the app's contract, but history must
// not be forced through it wholesale forever: years of training means
// thousands of sessions. The sessions/sets stores carry indexes
// (by_date, by_exercise, by_session — created in idb.js v3) so the heavy
// consumers (analytics worker, Progress views) can page through data by
// date or pull one exercise's full set history without materialising
// everything. Falls back to filtering the memory backend when no real DB.

import { idbGetAll, STORES } from './idb.js';
import { idbTransaction } from './idb-tx.js';

const sortDesc = (rows, key) => rows.sort((a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || '')));

/**
 * One page of history, newest first.
 * @param {number} offset  sessions already loaded (for lazy "load older")
 * @param {number} limit   page size
 */
export async function querySessionsPage({ offset = 0, limit = 50 } = {}){
  const all = sortDesc(await idbGetAll('sessions'), 'dateISO');
  return {
    sessions: all.slice(offset, offset + limit),
    total: all.length,
    hasMore: offset + limit < all.length,
    nextOffset: offset + limit,
  };
}

/** Lazy-loading cursor: call repeatedly with the previous result's nextOffset. */
export async function queryMoreSessions(page){
  return querySessionsPage({ offset: page?.nextOffset || 0, limit: page?.limit || 50 });
}

/** Full flattened set rows for one exercise, newest first. */
export async function querySetsByExercise(exerciseId){
  const rows = (await idbGetAll('sets')).filter((s) => s.exerciseId === exerciseId);
  return sortDesc(rows, 'dateISO');
}

/** Every set logged on one date (calendar views, daily summaries). */
export async function querySetsByDate(dateISO){
  return (await idbGetAll('sets')).filter((s) => s.dateISO === dateISO);
}

/** Every set in one session, in block/set order (session detail view). */
export async function querySetsBySession(sessionId){
  return (await idbGetAll('sets'))
    .filter((s) => s.sessionId === sessionId)
    .sort((a, b) => (a.blockIndex - b.blockIndex) || (a.setIndex - b.setIndex));
}

/**
 * The set-level index the whole app can trust for aggregate queries —
 * built from the flattened rows, which decompose() guarantees to mirror
 * the embedded session sets exactly.
 */
export async function buildQueryIndex(){
  const [sessions, sets, programme, ledger] = await Promise.all([
    idbGetAll('sessions'), idbGetAll('sets'),
    idbGetAll('programme'), Promise.all([idbGetAll('recommendations'), idbGetAll('outcomes')]),
  ]);
  const byDate = new Map();      // dateISO -> [sets]
  const byExercise = new Map();  // exerciseId -> [sets]
  for(const s of sets || []){
    if(!byDate.has(s.dateISO)) byDate.set(s.dateISO, []);
    byDate.get(s.dateISO).push(s);
    if(!byExercise.has(s.exerciseId)) byExercise.set(s.exerciseId, []);
    byExercise.get(s.exerciseId).push(s);
  }
  return {
    sessionCount: (sessions || []).length,
    sessions: sortDesc(sessions || [], 'dateISO'),
    setCount: (sets || []).length,
    byDate,
    byExercise,
    activeProgramme: programme?.[0]?.activeSchedule || null,
    programHistory: programme?.[0]?.programHistory || [],
    ledgerRows: [...(ledger[0] || []), ...(ledger[1] || [])],
  };
}

/** Expose the store list for diagnostics without importing idb.js again. */
export const QUERY_STORES = STORES;

/**
 * Write-path convenience used by tests and the recovery flow: run an
 * arbitrary batch of canonical writes atomically (re-exported so callers
 * don't need idb-tx.js directly).
 */
export { idbTransaction };
