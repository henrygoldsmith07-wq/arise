// readinessLog.js — the input side of the recovery channel.
//
// Until now the engine had a recovery layer with no way to feed it:
// `readinessScore()` has existed in progression.js since the beginning, and
// `readinessClassifier.js` consumes it, but no code path ever WROTE a row.
// ~20 modules read, persist, merge, sync, export and display `store.readinessLog`
// — so the Weekly Review rendered a Readiness figure that was permanently an
// em dash, More offered to export a collection nothing could collect, and the
// study screen told participants it was recording check-ins it never received.
// Demo mode was the only producer, which meant the app demonstrated a
// capability it did not have.
//
// This module is deliberately the WHOLE of the new logic, kept pure so it can
// be tested without React, IndexedDB or a store. The component layer only
// collects three numbers and calls `upsertReadinessEntry`.
//
// Shape note: rows are `{ dateISO, at, score, sleep, soreness, motivation }`.
// `at` is an ISO timestamp and exists because the merge/dedupe keys in
// storeReconcile.js:89 and export.js:379 are `${dateISO}|${at}` — a same-day
// edit must replace the earlier row rather than append beside it.

import { readinessScore } from './progression.js';

/** The three signals, in the order the UI asks for them. */
export const READINESS_SIGNALS = [
  { id: 'sleep', label: 'Sleep', low: 'Rough', high: 'Solid' },
  { id: 'soreness', label: 'Soreness', low: 'None', high: 'Sore' },
  { id: 'motivation', label: 'Motivation', low: 'Low', high: 'High' },
];

export const READINESS_SCALE_MIN = 1;
export const READINESS_SCALE_MAX = 5;

/** Neutral starting point. Also the fallback when nothing is known yet. */
export const READINESS_NEUTRAL = 3;

/** Clamp anything user-entered onto the 1..5 scale the scoring expects. */
export function clampSignal(value){
  const n = Math.round(Number(value));
  if(!Number.isFinite(n)) return READINESS_NEUTRAL;
  return Math.max(READINESS_SCALE_MIN, Math.min(READINESS_SCALE_MAX, n));
}

/** Today's row, or null. Comparison is on the date string only. */
export function readinessOn(log, dateISO){
  const rows = Array.isArray(log) ? log : [];
  return rows.find(r=> r?.dateISO === dateISO) || null;
}

/**
 * The values to open the check-in with.
 *
 * Prefilled from today's existing row if there is one, otherwise from the most
 * recent row, otherwise neutral. This is what makes the common case one tap:
 * most mornings nothing has changed, so the user confirms rather than enters.
 */
export function readinessFormDefaults(log, dateISO){
  const rows = (Array.isArray(log) ? log : [])
    .filter(r=> r?.dateISO && (!dateISO || String(r.dateISO) <= String(dateISO)))
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  const source = readinessOn(log, dateISO) || rows.at(-1) || null;
  return {
    sleep: clampSignal(source?.sleep),
    soreness: clampSignal(source?.soreness),
    motivation: clampSignal(source?.motivation),
  };
}

/** Score the three inputs using the engine's own function — not a copy of it. */
export function scoreReadinessInputs({ sleep, soreness, motivation }){
  return readinessScore({
    sleep: clampSignal(sleep),
    soreness: clampSignal(soreness),
    motivation: clampSignal(motivation),
  });
}

/**
 * Insert or replace one row for `dateISO`, keeping the log ascending.
 *
 * Same-day edits REPLACE rather than append: two rows for one date would make
 * the EMA and the "latest score" reads disagree about which morning is which.
 */
export function upsertReadinessEntry(log, { dateISO, sleep, soreness, motivation, at = null } = {}){
  const rows = Array.isArray(log) ? log.filter(r=> r?.dateISO !== dateISO) : [];
  const entry = {
    dateISO,
    at: at || `${dateISO}T12:00:00.000Z`,
    score: scoreReadinessInputs({ sleep, soreness, motivation }),
    sleep: clampSignal(sleep),
    soreness: clampSignal(soreness),
    motivation: clampSignal(motivation),
  };
  rows.push(entry);
  rows.sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  return rows;
}

/** Remove the row for a date (no-op if absent). */
export function removeReadinessEntry(log, dateISO){
  if(!Array.isArray(log)) return [];
  return log.filter(r=> r?.dateISO !== dateISO);
}

/** Plain-language reading of a score, for the confirmation line. */
export function readinessBand(score){
  // `Number(null)` is 0 and `Number('')` is 0, both of which would otherwise
  // read as a confirmed "Rough" morning. An absent score is unknown, not zero.
  if(score == null || score === '') return { id:'unknown', label:'—' };
  const n = Number(score);
  if(!Number.isFinite(n)) return { id:'unknown', label:'—' };
  if(n < 40) return { id:'low', label:'Rough' };
  if(n < 60) return { id:'fair', label:'Okay' };
  if(n < 80) return { id:'good', label:'Good' };
  return { id:'high', label:'Ready' };
}
