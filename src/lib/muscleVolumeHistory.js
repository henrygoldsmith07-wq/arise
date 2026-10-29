// muscleVolumeHistory.js — hard sets actually DONE per muscle per week.
// blockPlan.js shows what a block PLANS; this reads the logged history so a
// lifter can see which muscles really got work, against the same rough
// 6–20 sets/week guide (confidence: low, wide individual variation).
//
// A counted set is a finished, non-skipped set with reps or a load, and no
// logged RPE under 5 (those are warm-ups / feel-out sets, not hard sets).
// Deleted sessions are ignored. A set counts toward the exercise's MAIN
// muscle only (same rule as the Block plan). Cardio and core are not counted.
// Weeks are Monday-start calendar weeks in local date-only form.
import { EXERCISE_BY_ID } from "./data.js";
import { mondayKeyISO } from "./dateOnly.js";
import { VOLUME_GUIDE, GUIDED_MUSCLES, weekDeloadState } from "./blockPlan.js";

export const VOLUME_WEEKS = 8;
export const MIN_HARD_RPE = 5;
// Only upper-body muscles are nudged: leg/glute volume is deliberately capped
// around cycling and a nag there would be wrong.
export const NUDGE_MUSCLES = Object.freeze([
  "Chest",
  "Back",
  "Shoulders",
  "Arms",
]);
const DAY_MS = 86400000;
const COUNTED = new Set([...GUIDED_MUSCLES, "Full body"]);

const addDays = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** Is this one logged set a hard set? */
export function isHardSet(set) {
  if (!set || set.skipped || set.completed === false) return false;
  const reps = Number(set.reps),
    kg = Number(set.weightKg) || Number(set.assistedKg) || 0;
  if (!(reps > 0 || kg > 0)) return false;
  const rpe = set.rpe === "" || set.rpe == null ? NaN : Number(set.rpe);
  return !(Number.isFinite(rpe) && rpe < MIN_HARD_RPE);
}

/** Hard sets in one block, 0 for unknown / uncounted muscles. */
export function hardSetsIn(block) {
  const muscle = EXERCISE_BY_ID[block?.exerciseId]?.muscle;
  if (!COUNTED.has(muscle)) return { muscle: null, sets: 0 };
  return { muscle, sets: (block.sets || []).filter(isHardSet).length };
}

/**
 * The last `weeks` Monday-start weeks ending with the week of `todayISO`,
 * oldest first. Every week is present (empty ones too) so gaps show.
 * @returns {{ weekISO, current, deload, total, byMuscle, sessions }[]}
 */
export function weeklyMuscleVolume(
  history,
  { todayISO, weeks = VOLUME_WEEKS, schedule = null } = {},
) {
  const thisWeek = mondayKeyISO(todayISO);
  if (!thisWeek) return [];
  const n = Math.max(1, Math.min(52, Math.floor(weeks) || VOLUME_WEEKS));
  const rows = Array.from({ length: n }, (_, i) => ({
    weekISO: addDays(thisWeek, (i - n + 1) * 7),
    current: i === n - 1,
    deload: false,
    total: 0,
    byMuscle: {},
    sessions: [],
  }));
  const index = new Map(rows.map((r) => [r.weekISO, r]));
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || h.deletedAt || !Array.isArray(h.blocks)) continue;
    const row = index.get(mondayKeyISO(String(h.dateISO || "")));
    if (!row) continue;
    let sets = 0;
    for (const b of h.blocks) {
      const { muscle, sets: k } = hardSetsIn(b);
      if (!k) continue;
      row.byMuscle[muscle] = (row.byMuscle[muscle] || 0) + k;
      sets += k;
    }
    if (sets)
      row.sessions.push({
        id: h.id,
        title: h.title || "Session",
        dateISO: h.dateISO,
        sets,
      });
    row.total += sets;
  }
  for (const s of schedule?.sessions || []) {
    const row = index.get(mondayKeyISO(String(s.dateISO || "")));
    if (row && s.week != null && weekDeloadState(schedule, s.week).deload)
      row.deload = true;
  }
  for (const r of rows)
    r.sessions.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return rows;
}

/** 'under' | 'ok' | 'high' | 'none' for a muscle's weekly hard sets. */
export function volumeStatus(muscle, sets) {
  if (!GUIDED_MUSCLES.includes(muscle)) return "none";
  if (sets > VOLUME_GUIDE.high) return "high";
  return sets < VOLUME_GUIDE.low ? "under" : "ok";
}

/** Muscles present in the window, biggest total first (legend + colours). */
export function musclesInWindow(rows) {
  const sum = {};
  for (const r of rows)
    for (const [m, v] of Object.entries(r.byMuscle)) sum[m] = (sum[m] || 0) + v;
  return Object.entries(sum)
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m);
}

/**
 * Today nudge: upper-body muscles you trained in the 4 weeks before last week
 * that got fewer than the guide's low end LAST week, when last week was a real
 * training week (≥ 2 sessions, not a deload). Never nags about a muscle you
 * have not been training, or legs. Returns [{ muscle, sets }].
 */
export function underTrainedLastWeek(
  history,
  { todayISO, schedule = null } = {},
) {
  const rows = weeklyMuscleVolume(history, { todayISO, weeks: 6, schedule });
  if (rows.length < 6) return [];
  const last = rows[rows.length - 2];
  if (last.deload || last.sessions.length < 2) return [];
  const before = rows.slice(0, rows.length - 2).slice(-4);
  return NUDGE_MUSCLES.filter(
    (m) =>
      before.some((r) => (r.byMuscle[m] || 0) >= VOLUME_GUIDE.low) &&
      (last.byMuscle[m] || 0) < VOLUME_GUIDE.low,
  ).map((m) => ({ muscle: m, sets: last.byMuscle[m] || 0 }));
}

const SEEN_KEY = "arise.volumeNudgeSeen";
/** Monday (ISO) of the week whose nudge was dismissed on this device, or ''. */
export function readNudgeSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) || "";
  } catch {
    return "";
  }
}
/** Hide the nudge for `weekISO` on this device (best effort: private mode just skips it). */
export function markNudgeSeen(weekISO) {
  try {
    localStorage.setItem(SEEN_KEY, weekISO);
  } catch {
    /* not persisted */
  }
}
