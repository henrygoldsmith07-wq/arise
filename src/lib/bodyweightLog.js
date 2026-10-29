// bodyweightLog.js — an optional body-weight log and what it unlocks:
// a trend, and strength relative to body weight.
//
// Local-first and canonical in kg (units.ts only localises the UI boundary).
// One row per calendar day: { dateISO, kg, updatedAt, deleted? }. A removed
// day stays as a tombstone row (`deleted: true`) so a sync or backup import
// cannot resurrect it; every reader goes through liveBodyweights().
//
// Honesty notes
//   • Relative strength = e1RM ÷ body weight. Machine/cable stacks differ
//     between gyms, so those ratios are for comparing YOU with YOU over time,
//     never with other people.
//   • Pull-ups, chin-ups and dips lift your body: their effective load is
//     body weight + added load − assistance, so an assisted pull-up and a
//     weighted one land on the same scale.

import { parseReps, e1rm } from "./trainingMath.js";
import { sparklinePoints } from "./exerciseHistory.js";

export const BODYWEIGHT_MIN_KG = 20;
export const BODYWEIGHT_MAX_KG = 300;
const DAY_MS = 86400000;
const STEADY_BAND_KG = 0.5;

const dayNumber = (iso) =>
  Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY_MS;
const validDate = (iso) =>
  /^\d{4}-\d{2}-\d{2}/.test(String(iso || "")) &&
  Number.isFinite(dayNumber(iso));
const round1 = (n) => Math.round(n * 10) / 10;

/** Canonical kg (one decimal) from user text/number, or null when out of range. */
export function parseBodyweightKg(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(",", ".");
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < BODYWEIGHT_MIN_KG || n > BODYWEIGHT_MAX_KG)
    return null;
  return round1(n);
}

/** Live (non-deleted, valid) weigh-ins, oldest first, one per day. */
export function liveBodyweights(log) {
  const byDay = new Map();
  for (const row of Array.isArray(log) ? log : []) {
    if (!row || row.deleted || !validDate(row.dateISO)) continue;
    const kg = parseBodyweightKg(row.kg);
    if (kg == null) continue;
    byDay.set(String(row.dateISO).slice(0, 10), {
      dateISO: String(row.dateISO).slice(0, 10),
      kg,
    });
  }
  return [...byDay.values()].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/** Add or replace the weigh-in for a day. Returns a new log, or the same log when kg is unusable. */
export function upsertBodyweight(
  log,
  { dateISO, kg, nowISO = new Date().toISOString() },
) {
  const value = parseBodyweightKg(kg);
  if (value == null || !validDate(dateISO))
    return Array.isArray(log) ? log : [];
  const day = String(dateISO).slice(0, 10);
  const rest = (Array.isArray(log) ? log : []).filter(
    (r) => String(r?.dateISO || "").slice(0, 10) !== day,
  );
  return [...rest, { dateISO: day, kg: value, updatedAt: nowISO }].sort(
    (a, b) => a.dateISO.localeCompare(b.dateISO),
  );
}

/** Remove a day's weigh-in, leaving a tombstone so sync/import cannot bring it back. */
export function removeBodyweight(
  log,
  dateISO,
  nowISO = new Date().toISOString(),
) {
  const day = String(dateISO || "").slice(0, 10);
  const rest = (Array.isArray(log) ? log : []).filter(
    (r) => String(r?.dateISO || "").slice(0, 10) !== day,
  );
  if (!validDate(day)) return rest;
  return [
    ...rest,
    { dateISO: day, kg: null, deleted: true, updatedAt: nowISO },
  ].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

export function bodyweightOn(log, dateISO) {
  const day = String(dateISO || "").slice(0, 10);
  return liveBodyweights(log).find((r) => r.dateISO === day) || null;
}

/**
 * The weigh-in that applies on a date: the latest one on or before it; when the
 * lifter only started weighing in later, the earliest one stands in. Null with an empty log.
 */
export function bodyweightAsOf(log, dateISO) {
  const rows = liveBodyweights(log);
  if (!rows.length) return null;
  const day = String(dateISO || "").slice(0, 10);
  let hit = null;
  for (const r of rows) {
    if (r.dateISO <= day) hit = r;
    else break;
  }
  return hit || rows[0];
}

/** Merge two logs (sync / backup import): per day the newest `updatedAt` wins, tombstones included. */
export function mergeBodyweightLogs(a, b) {
  const byDay = new Map();
  for (const row of [
    ...(Array.isArray(a) ? a : []),
    ...(Array.isArray(b) ? b : []),
  ]) {
    if (!row || !validDate(row.dateISO)) continue;
    const day = String(row.dateISO).slice(0, 10);
    const prev = byDay.get(day);
    if (!prev) {
      byDay.set(day, row);
      continue;
    }
    const t1 = Date.parse(prev.updatedAt || "") || 0,
      t2 = Date.parse(row.updatedAt || "") || 0;
    // Tie: a deletion wins, then the larger value, so the merge is order-independent.
    const rowWins =
      t2 > t1 ||
      (t2 === t1 &&
        ((row.deleted && !prev.deleted) ||
          (!!row.deleted === !!prev.deleted &&
            (Number(row.kg) || 0) > (Number(prev.kg) || 0))));
    if (rowWins) byDay.set(day, row);
  }
  return [...byDay.values()].sort((x, y) =>
    String(x.dateISO).localeCompare(String(y.dateISO)),
  );
}

/**
 * Trend over the last `windowDays`: compares the average of the newest 7 days
 * with the average of the oldest 7 days of the window. Needs entries at least a
 * week apart, otherwise it says it is too early rather than inventing a slope.
 */
export function bodyweightTrend(log, todayISO, windowDays = 28) {
  const today = dayNumber(todayISO);
  const all = liveBodyweights(log);
  const rows = all.filter(
    (r) =>
      dayNumber(r.dateISO) <= today &&
      today - dayNumber(r.dateISO) < windowDays,
  );
  const latest = all.filter((r) => dayNumber(r.dateISO) <= today).pop() || null;
  const out = {
    count: rows.length,
    latest,
    direction: "none",
    changeKg: null,
    recentAvgKg: null,
    note: "",
  };
  if (!latest) {
    out.note = "No weigh-ins yet.";
    return out;
  }
  const mean = (list) =>
    round1(list.reduce((s, r) => s + r.kg, 0) / list.length);
  const recent = rows.filter((r) => today - dayNumber(r.dateISO) < 7);
  out.recentAvgKg = recent.length ? mean(recent) : null;
  if (
    rows.length < 2 ||
    dayNumber(rows[rows.length - 1].dateISO) - dayNumber(rows[0].dateISO) < 7
  ) {
    out.direction = "early";
    out.note =
      "A trend needs weigh-ins at least a week apart. Day-to-day swings of 1–2 kg are water, not tissue.";
    return out;
  }
  const first = rows.filter(
    (r) => dayNumber(r.dateISO) - dayNumber(rows[0].dateISO) < 7,
  );
  const last = rows.filter(
    (r) => dayNumber(rows[rows.length - 1].dateISO) - dayNumber(r.dateISO) < 7,
  );
  out.changeKg = round1(mean(last) - mean(first));
  out.direction =
    out.changeKg > STEADY_BAND_KG
      ? "up"
      : out.changeKg < -STEADY_BAND_KG
        ? "down"
        : "steady";
  out.note =
    out.direction === "steady"
      ? "Holding steady."
      : `${out.direction === "up" ? "Up" : "Down"} ${Math.abs(out.changeKg)} kg across this window (week-average to week-average).`;
  return out;
}

/** SVG polyline points for the weigh-ins (oldest → newest), or null with fewer than 2. */
export function bodyweightSparkline(log, width = 120, height = 32) {
  const rows = liveBodyweights(log).slice(-30);
  return sparklinePoints(
    rows
      .slice()
      .reverse()
      .map((r) => ({ bestE1rm: r.kg })),
    width,
    height,
  );
}

// ── Strength relative to body weight ─────────────────────────────────────────

/** Lifts where you move your own body: pull-up/chin-up variants and dips. */
export function isBodyweightLift(exerciseId) {
  const id = String(exerciseId || "");
  if (
    /(^|-)(pull-up|chin-up)$/.test(id) &&
    !/^(scapular|negative|commando|l-sit)/.test(id)
  )
    return true;
  return /^(weighted-|assisted-)?(chest-)?dip$/.test(id);
}

/**
 * Load the muscles actually moved for one set: body weight + added − assistance
 * on bodyweight lifts, the plain load everywhere else. Null when it cannot be
 * known (a bodyweight lift with no body weight to anchor it).
 */
export function effectiveLoadKg(exerciseId, set, bodyKg) {
  const added = Number(set?.weightKg) || 0;
  if (!isBodyweightLift(exerciseId)) return added > 0 ? added : null;
  if (!(bodyKg > 0)) return null;
  const assisted = Number(set?.assistedKg) || 0;
  const load = bodyKg + added - assisted;
  return load > 0 ? load : null;
}

function sessionBestE1rm(exerciseId, block, bodyKg) {
  let best = 0;
  for (const s of block?.sets || []) {
    const reps = parseReps(s?.reps);
    if (!(reps > 0)) continue;
    const load = effectiveLoadKg(exerciseId, s, bodyKg);
    if (load == null) continue;
    const est = e1rm(load, reps);
    if (est > best) best = est;
  }
  return best;
}

/**
 * Relative strength per lift: the best session e1RM ÷ the body weight on that
 * day, over the last `windowDays` versus the `windowDays` before it. The lifts
 * you trained most in the recent window come first.
 */
export function relativeStrength(
  history,
  log,
  todayISO,
  { windowDays = 56, limit = 6 } = {},
) {
  if (!liveBodyweights(log).length) return [];
  const today = dayNumber(todayISO);
  const rows = new Map();
  for (const session of Array.isArray(history) ? history : []) {
    if (!session || !validDate(session.dateISO)) continue;
    const age = today - dayNumber(session.dateISO);
    if (age < 0 || age >= windowDays * 2) continue;
    const bw = bodyweightAsOf(log, session.dateISO)?.kg || null;
    if (!(bw > 0)) continue;
    for (const block of session.blocks || []) {
      const est = sessionBestE1rm(block.exerciseId, block, bw);
      if (!(est > 0)) continue;
      const row = rows.get(block.exerciseId) || {
        exerciseId: block.exerciseId,
        recent: null,
        before: null,
        recentSessions: 0,
      };
      const slot = age < windowDays ? "recent" : "before";
      if (slot === "recent") row.recentSessions += 1;
      if (!row[slot] || est / bw > row[slot].ratio)
        row[slot] = { ratio: est / bw, e1rmKg: est, bodyKg: bw };
      rows.set(block.exerciseId, row);
    }
  }
  return [...rows.values()]
    .filter((r) => r.recent)
    .sort(
      (a, b) =>
        b.recentSessions - a.recentSessions || b.recent.ratio - a.recent.ratio,
    )
    .slice(0, limit)
    .map((r) => {
      const ratio = Math.round(r.recent.ratio * 100) / 100;
      const beforeRatio = r.before
        ? Math.round(r.before.ratio * 100) / 100
        : null;
      const changePct = r.before
        ? Math.round((r.recent.ratio / r.before.ratio - 1) * 1000) / 10
        : null;
      const e1rmChangeKg = r.before
        ? round1(r.recent.e1rmKg - r.before.e1rmKg)
        : null;
      const bodyChangeKg = r.before
        ? round1(r.recent.bodyKg - r.before.bodyKg)
        : null;
      return {
        exerciseId: r.exerciseId,
        bodyweightLift: isBodyweightLift(r.exerciseId),
        e1rmKg: round1(r.recent.e1rmKg),
        ratio,
        beforeRatio,
        changePct,
        e1rmChangeKg,
        bodyChangeKg,
        sessions: r.recentSessions,
        verdict:
          changePct == null
            ? "new"
            : changePct > 2
              ? "up"
              : changePct < -2
                ? "down"
                : "flat",
      };
    });
}
