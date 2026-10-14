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
import { localDateISO, mondayKeyISO } from './dateOnly.js';

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

// ── Week coverage + trend (bounded reads) ───────────────────────────────
// Every readiness read elsewhere in the app answers "what is the data telling
// us NOW"; these helpers make the *window* explicit. The Weekly Review's
// coverage lines, the Today zero-coverage nudge and the Progress trend row
// all use the same Monday-start grouping (mondayKeyISO), so their week
// buckets can never drift apart.

/**
 * How many check-ins the CURRENT week (the one containing `todayISO` or the
 * device clock) has recorded. The zero-coverage case is the one the Today
 * nudge is built to close: a week with no check-ins produces a recovery read
 * leaning on increasingly stale rows.
 */
export function readinessWeekCoverage(log, todayISO = null){
  const t = String(todayISO || localDateISO());
  const key = mondayKeyISO(t);
  if(!key) return { inWeek: 0, weekKey: null };
  const rows = Array.isArray(log) ? log : [];
  const inWeek = rows.filter(r => r?.dateISO && mondayKeyISO(String(r.dateISO).slice(0, 10)) === key).length;
  return { inWeek, weekKey: key };
}

/**
 * How many of the LAST `weeks` Monday-start weeks (ending with the week that
 * contains `todayISO`) have at least one check-in. This is the streak-style
 * framing the review wanted — coverage as a run across recent weeks, not a
 * single reviewed week — without ever guilting: it counts weeks touched,
 * never days missed. Bounds `weeks` to 1..26 so a corrupt input cannot walk
 * the logs backward indefinitely.
 */
export function readinessCoverageTrend(log, { todayISO = null, weeks = 4 } = {}){
  const n = Math.max(1, Math.min(26, Math.round(Number(weeks) || 4)));
  const t = String(todayISO || localDateISO());
  const baseKey = mondayKeyISO(t);
  if(!baseKey) return { covered: 0, weeks: n, counts: [], weekKeys: [] };
  const base = new Date(`${baseKey}T00:00:00Z`);
  const rows = Array.isArray(log) ? log : [];
  const weekKeys = [];
  const counts = [];
  for(let i = 0; i < n; i++){
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    weekKeys.push(key);
    counts.push(rows.filter(r => r?.dateISO && mondayKeyISO(String(r.dateISO).slice(0, 10)) === key).length);
  }
  return { covered: counts.filter(c => c > 0).length, weeks: n, counts, weekKeys };
}

/**
 * One honest sentence about coverage across recent weeks — the single phrase
 * source for the Weekly Review's cross-week evidence line (and therefore the
 * Markdown export, which renders `noticed` verbatim). Sparse coverage is
 * framed as what sharpens the read, never as failure.
 */
export function readinessCoverageLine(coverage){
  if(!coverage || !Number.isFinite(Number(coverage.weeks)) || coverage.weeks < 1 || coverage.covered == null) return null;
  const { covered, weeks } = coverage;
  if(covered >= weeks) return `Check-in coverage: ${covered} of the last ${weeks} weeks had check-ins — the recovery read stands on steady evidence.`;
  if(covered >= 2) return `Check-in coverage: ${covered} of the last ${weeks} weeks had check-ins.`;
  return `Check-in coverage: ${covered} of the last ${weeks} weeks had check-ins — a few check-ins most weeks is what keeps the recovery read honest.`;
}

/**
 * Direction of the check-in series over a bounded window (default 14 days):
 * the recent half of entries versus the half before it, both halves inside
 * the window. Returns available:false rather than guessing a trend from
 * sparse data — an honest "not enough" is the same posture every other read
 * in the app takes. The recent average is still returned when unavailable so
 * callers can show what IS known ("averaging X over N check-ins").
 */
export function readinessTrend(log, { todayISO = null, windowDays = 14, directionThreshold = 5 } = {}){
  const t = String(todayISO || localDateISO());
  const base = new Date(`${t}T00:00:00Z`);
  if(Number.isNaN(base.getTime())) return { available: false, entries: 0, recentAvg: null, windowDays };
  const min = new Date(base);
  min.setUTCDate(min.getUTCDate() - (Math.max(1, Number(windowDays) || 14) - 1));
  const minISO = min.toISOString().slice(0, 10);
  const rows = (Array.isArray(log) ? log : [])
    .filter(r => r?.dateISO && r?.score != null && Number.isFinite(Number(r.score)))
    .filter(r => String(r.dateISO) >= minISO && String(r.dateISO) <= t)
    .sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
  const scores = rows.map(r => Number(r.score));
  const avgOf = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const entries = scores.length;
  const recentHalf = Math.ceil(entries / 2);
  if(entries < 6 || recentHalf === entries){
    return { available: false, entries, recentAvg: avgOf(scores.slice(-Math.min(entries, 5))), windowDays, firstDate: rows[0]?.dateISO || null, lastDate: rows.at(-1)?.dateISO || null };
  }
  const recentAvg = avgOf(scores.slice(-recentHalf));
  const prevAvg = avgOf(scores.slice(0, entries - recentHalf));
  const delta = recentAvg - prevAvg;
  const direction = delta >= directionThreshold ? 'improving' : delta <= -directionThreshold ? 'declining' : 'steady';
  return { available: true, direction, delta, recentAvg, prevAvg, entries, windowDays, firstDate: rows[0]?.dateISO || null, lastDate: rows.at(-1)?.dateISO || null };
}
