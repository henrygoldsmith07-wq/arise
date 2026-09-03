// audit.js — data hygiene: detect and repair the damage integrity.js can't.
//
// integrity.js validates the *shape* of the recomposed store. This module
// audits its *content*: two sessions sharing an id, one set logged twice
// (double-tap or an offline replay), set rows whose session no longer
// exists, unparseable dates, impossible values (negative/absurd weights and
// reps), and a schema version that has drifted past sanity. Detection is
// read-only and surfaced on the diagnostics screen; repair is atomic per
// problem class.

import { idbGetAll, idbGet } from './idb.js';
import { idbTransaction } from './idb-tx.js';

export const IMPOSSIBLE = { maxWeightKg: 500, maxReps: 100, minWeightKg: -50 };

const validDateISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

// A value is only judged when the user actually entered one: '' / null mean
// "not logged", which is normal, not impossible.
function entered(v){ return v !== '' && v !== null && v !== undefined; }

/**
 * Read-only audit of the canonical stores. Every finding is one of:
 *   duplicate-session | duplicate-set | orphaned-set | invalid-date |
 *   impossible-value | schema-drift
 * @returns {{ findings: Array<{type, ids: string[], detail}>, ok: boolean }}
 */
export async function auditStore(){
  const [sessions, sets, profile] = await Promise.all([
    idbGetAll('sessions'), idbGetAll('sets'), idbGet('profile', 'profile'),
  ]);
  const findings = [];
  const find = (type, ids, detail) => findings.push({ type, ids, detail });

  // duplicate sessions: same id appearing more than once
  const byId = new Map();
  for(const s of sessions || []){
    if(!byId.has(s.id)) byId.set(s.id, []);
    byId.get(s.id).push(s);
  }
  for(const group of [...byId.values()].filter((g) => g.length > 1)){
    find('duplicate-session', group.slice(1).map((s) => s.id), `${group.length} sessions share id "${group[0].id}"`);
  }

  // duplicate sets: same session + block + set index logged more than once
  const setKeys = new Map();
  for(const row of sets || []){
    const key = `${row?.sessionId || ''}:${row?.blockIndex ?? ''}:${row?.setIndex ?? ''}`;
    if(!setKeys.has(key)) setKeys.set(key, []);
    setKeys.get(key).push(row);
  }
  for(const group of [...setKeys.values()].filter((g) => g.length > 1)){
    find('duplicate-set', group.map((r) => r.id),
      `${group.length} sets duplicate session ${group[0]?.sessionId} position ${group[0]?.blockIndex}.${group[0]?.setIndex}`);
  }

  // orphaned sets: rows whose parent session no longer exists
  const known = new Set((sessions || []).map((s) => s.id));
  const orphans = (sets || []).filter((r) => r?.sessionId && !known.has(r.sessionId));
  if(orphans.length) find('orphaned-set', orphans.map((r) => r.id), `${orphans.length} set rows have no parent session`);

  // invalid dates: dateISO is load-bearing (sorting, week buckets, training age)
  const badDates = (sessions || []).filter((s) => !validDateISO(s?.dateISO));
  if(badDates.length) find('invalid-date', badDates.map((s) => s.id), `${badDates.length} sessions have unparseable dates`);

  // impossible values: entered numbers outside plausible human bounds
  const bad = (sets || []).filter((r) => {
    if(entered(r?.reps)){
      const reps = Number(r.reps);
      if(!Number.isNaN(reps) && (reps < 0 || reps > IMPOSSIBLE.maxReps)) return true;
    }
    if(entered(r?.weightKg)){
      const kg = Number(r.weightKg);
      if(!Number.isNaN(kg) && (kg < IMPOSSIBLE.minWeightKg || kg > IMPOSSIBLE.maxWeightKg)) return true;
    }
    return false;
  });
  if(bad.length) find('impossible-value', bad.map((r) => r.id), `${bad.length} set rows have impossible values`);

  // schema drift: profile version must be a positive integer
  const version = Number(profile?.version);
  if(profile && (!Number.isInteger(version) || version < 1)){
    find('schema-drift', ['profile'], `Profile schema version "${profile.version}" is not a positive integer.`);
  }

  return { findings, ok: findings.length === 0 };
}

/**
 * Atomic repair per problem class:
 *  - duplicate-session: drop the extras (first occurrence survives)
 *  - duplicate-set / orphaned-set: drop the rows
 *  - invalid-date: drop the session (dates are load-bearing; the row is
 *    quarantined upstream by the boot gate when the whole store fails)
 *  - impossible-value: neutralise in place (clamp + flag) — the row is a
 *    real training entry, just with an impossible number
 *  - schema-drift: not repairable here; migration failure recovery owns it
 */
export async function repairFindings(findings = []){
  const sessions = await idbGetAll('sessions');
  const sets = await idbGetAll('sets');

  const dropSessions = new Set();
  const dropSets = new Set();
  const neutralise = new Set();
  for(const f of findings){
    for(const id of f.ids || []){
      if(f.type === 'duplicate-session' || f.type === 'invalid-date') dropSessions.add(id);
      else if(f.type === 'duplicate-set' || f.type === 'orphaned-set') dropSets.add(id);
      else if(f.type === 'impossible-value') neutralise.add(id);
    }
  }

  const clamp = (v, min, max) => Math.min(Math.max(Number(v) || 0, min), max);
  await idbTransaction(['sessions', 'sets'], (ops)=> {
    for(const id of dropSessions) ops.delete('sessions', id);
    for(const id of dropSets) ops.delete('sets', id);
    for(const id of neutralise){
      const row = (sets || []).find((r) => r.id === id);
      if(row) ops.put('sets', {
        ...row,
        reps: entered(row.reps) ? String(clamp(row.reps, 0, IMPOSSIBLE.maxReps)) : row.reps,
        weightKg: entered(row.weightKg) ? String(clamp(row.weightKg, IMPOSSIBLE.minWeightKg, IMPOSSIBLE.maxWeightKg)) : row.weightKg,
        audited: true,
      });
    }
  });
  return {
    deletedSessions: dropSessions.size,
    deletedSets: dropSets.size,
    neutralisedSets: neutralise.size,
  };
}
