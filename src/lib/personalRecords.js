// personalRecords.js — the Records wall: all-time bests per lift, derived from
// the logged history (nothing is stored, so editing or deleting a set updates
// the wall at once).
//
// Rep bands: for each band N in REP_BANDS the record is the HEAVIEST load
// lifted for at least N reps ("5+ reps: 62.5 kg"). A heavier set for more reps
// therefore also fills the lower bands, as lifters read a rep-max table.
// A PR event needs an earlier like-for-like set on the same lift (the first
// time you ever log a lift is a baseline, never a "PR"), must beat the earlier
// best by MIN_STEP_KG (ties and 0.5 kg jitter are not PRs), and never comes
// from a set in a session noted as a technique/ROM change, an assisted set, a
// skipped/failed set, or a deleted session. Pure; no storage, no DOM.
import { EXERCISE_BY_ID } from "./data.js";
import { e1rm, parseReps } from "./trainingMath.js";

export const REP_BANDS = Object.freeze([1, 3, 5, 8, 12]);
export const MIN_STEP_KG = 0.99; // a PR is at least ~1 kg heavier than the old best
export const RECENT_DAYS = 30;
const DAY_MS = 86400000;
const NOT_LIKE_FOR_LIKE =
  /\b(rom|range of motion|depth|technique|paused|pause|tempo|partial|banded|band|assisted|cheat)\b/i;

const round = (n) => Math.round(n * 100) / 100;

/** The countable loaded sets of one session block, with their reps. */
function loadedSets(block, sessionNote) {
  if (NOT_LIKE_FOR_LIKE.test(sessionNote || "")) return [];
  const out = [];
  for (const s of block?.sets || []) {
    if (!s || s.skipped || s.completed === false) continue;
    if (Number(s.assistedKg) > 0) continue;
    if (NOT_LIKE_FOR_LIKE.test(String(s.rom || ""))) continue;
    const kg = Number(s.weightKg);
    const reps = Math.floor(parseReps(s.reps));
    if (kg > 0 && reps >= 1) out.push({ kg: round(kg), reps });
  }
  return out;
}

/** Sessions in date order (then id), deleted/unusable ones removed. */
function ordered(history) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => h && !h.deletedAt && Array.isArray(h.blocks) && h.dateISO)
    .map((h, i) => ({ h, i }))
    .sort(
      (a, b) =>
        String(a.h.dateISO).localeCompare(String(b.h.dateISO)) || a.i - b.i,
    )
    .map((x) => x.h);
}

/** Heaviest kg for ≥ each band within a set list: { band: kg }. */
function bandBests(sets) {
  const out = {};
  for (const band of REP_BANDS) {
    let best = 0;
    for (const s of sets) if (s.reps >= band && s.kg > best) best = s.kg;
    if (best) out[band] = best;
  }
  return out;
}

/**
 * Chronological PR events across the whole history.
 * One event per lift, per session, per band; newest-first not applied here.
 * @returns {{exerciseId, sessionId, dateISO, band, kg, reps, previousKg}[]}
 */
export function prEvents(history) {
  const running = new Map(); // exerciseId -> { band: kg }
  const events = [];
  for (const h of ordered(history)) {
    for (const block of h.blocks) {
      const id = block?.exerciseId;
      if (!id) continue;
      const sets = loadedSets(block, h.note);
      if (!sets.length) continue;
      const seen = running.get(id);
      const today = bandBests(sets);
      if (seen) {
        for (const band of REP_BANDS) {
          const now = today[band];
          const before = seen[band] || 0;
          if (now && before && now >= before + MIN_STEP_KG) {
            const set = sets
              .filter((s) => s.reps >= band && s.kg === now)
              .sort((a, b) => a.reps - b.reps)[0];
            events.push({
              exerciseId: id,
              sessionId: h.id,
              dateISO: h.dateISO,
              band,
              kg: now,
              reps: set.reps,
              previousKg: before,
            });
          }
        }
      }
      const merged = { ...(seen || {}) };
      for (const band of REP_BANDS)
        if ((today[band] || 0) > (merged[band] || 0)) merged[band] = today[band];
      running.set(id, merged);
    }
  }
  return events;
}

/** Of the bands a session broke for one lift, keep the most telling one: the heaviest band. */
function headline(list) {
  return [...list].sort((a, b) => b.band - a.band)[0];
}

/** PRs set in one session — one headline per lift. */
export function sessionPrs(history, sessionId) {
  const byLift = new Map();
  for (const e of prEvents(history)) {
    if (e.sessionId !== sessionId) continue;
    (byLift.get(e.exerciseId) || byLift.set(e.exerciseId, []).get(e.exerciseId)).push(e);
  }
  return [...byLift.values()].map((list) => ({
    ...headline(list),
    bands: list.map((x) => x.band).sort((a, b) => a - b),
  }));
}

/**
 * The newest finished session's PRs, when that session is recent enough to be
 * news (default: the last 3 days). Used by the Today card.
 */
export function latestSessionPrs(history, { todayISO, withinDays = 3 } = {}) {
  const sessions = ordered(history);
  const last = sessions[sessions.length - 1];
  if (!last) return null;
  const age = daysBetween(last.dateISO, todayISO);
  if (age == null || age < 0 || age > withinDays) return null;
  const prs = sessionPrs(history, last.id);
  return prs.length
    ? { sessionId: last.id, dateISO: last.dateISO, title: last.title || "Session", prs }
    : null;
}

function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${String(fromISO).slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${String(toISO).slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : null;
}

/**
 * The wall: one row per lift ever logged with a loaded set.
 * @returns {{
 *   exerciseId, name, muscle, sessions, bands: {[band]: {kg, reps, dateISO}},
 *   bestE1rm: {kg, reps, e1rm, dateISO}|null, prCount, lastPrISO, recent
 * }[]} sorted by most recent PR, then name
 */
export function recordsWall(history, { todayISO, recentDays = RECENT_DAYS } = {}) {
  const lifts = new Map();
  for (const h of ordered(history)) {
    for (const block of h.blocks) {
      const id = block?.exerciseId;
      if (!id) continue;
      const sets = loadedSets(block, h.note);
      if (!sets.length) continue;
      const row =
        lifts.get(id) ||
        lifts
          .set(id, { exerciseId: id, sessions: 0, bands: {}, bestE1rm: null })
          .get(id);
      row.sessions++;
      for (const s of sets) {
        for (const band of REP_BANDS) {
          if (s.reps < band) continue;
          const cur = row.bands[band];
          // later date wins a tie only if heavier; first to reach a load keeps the date
          if (!cur || s.kg > cur.kg)
            row.bands[band] = { kg: s.kg, reps: s.reps, dateISO: h.dateISO };
          else if (s.kg === cur.kg && s.reps > cur.reps && h.dateISO === cur.dateISO)
            row.bands[band] = { kg: s.kg, reps: s.reps, dateISO: cur.dateISO };
        }
        const est = e1rm(s.kg, s.reps);
        if (est > 0 && (!row.bestE1rm || est > row.bestE1rm.e1rm + 1e-9))
          row.bestE1rm = {
            kg: s.kg,
            reps: s.reps,
            e1rm: round(est),
            dateISO: h.dateISO,
          };
      }
    }
  }
  const counts = new Map();
  const lastPr = new Map();
  for (const e of prEvents(history)) {
    counts.set(e.exerciseId, (counts.get(e.exerciseId) || 0) + 1);
    if (!lastPr.get(e.exerciseId) || e.dateISO > lastPr.get(e.exerciseId))
      lastPr.set(e.exerciseId, e.dateISO);
  }
  const rows = [...lifts.values()].map((r) => {
    const lastPrISO = lastPr.get(r.exerciseId) || null;
    const age = lastPrISO && todayISO ? daysBetween(lastPrISO, todayISO) : null;
    const meta = EXERCISE_BY_ID[r.exerciseId];
    return {
      ...r,
      name: meta?.name || r.exerciseId,
      muscle: meta?.muscle || "Other",
      prCount: counts.get(r.exerciseId) || 0,
      lastPrISO,
      recent: age != null && age >= 0 && age <= recentDays,
    };
  });
  rows.sort(
    (a, b) =>
      String(b.lastPrISO || "").localeCompare(String(a.lastPrISO || "")) ||
      a.name.localeCompare(b.name),
  );
  return rows;
}

/** Count of lifts that set a PR in the last `days` days (Progress card summary). */
export function recentPrCount(history, { todayISO, days = RECENT_DAYS } = {}) {
  return recordsWall(history, { todayISO, recentDays: days }).filter((r) => r.recent).length;
}

/** Filter wall rows by a free-text query and/or muscle. */
export function filterWall(rows, { query = "", muscle = "" } = {}) {
  const q = String(query).trim().toLowerCase();
  return rows.filter(
    (r) => (!muscle || r.muscle === muscle) && (!q || r.name.toLowerCase().includes(q)),
  );
}

/** "62.5 kg × 6" style text is the component's job (units pref); this is the band label. */
export function bandLabel(band) {
  return band === 1 ? "1 rep" : `${band}+ reps`;
}

const SEEN_KEY = "arise.prCardSeen";
/** Id of the session whose "New PR" card was dismissed on this device, or ''. */
export function readPrSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) || "";
  } catch {
    return "";
  }
}
/** Remember the dismissal (best effort: private mode just shows the card again). */
export function markPrSeen(sessionId) {
  try {
    localStorage.setItem(SEEN_KEY, String(sessionId));
  } catch {
    /* not persisted */
  }
}
