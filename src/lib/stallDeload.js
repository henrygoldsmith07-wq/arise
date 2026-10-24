// stallDeload.js — "Stalled 3 sessions" → one concrete deload target.
// Pure + offline. A lift is stalled when each of its last `window` sessions
// failed to beat the best e1RM that came before them. The suggestion is the
// same reps at ~10% less load, snapped to a load the kit can really produce.
import { e1rm } from "./progression.js";
import { nearestAchievableLoad } from "./plates.js";

export const STALL_WINDOW = 3;
export const DELOAD_FACTOR = 0.9;

function topSet(session, exerciseId) {
  let best = null;
  for (const block of session.blocks || []) {
    if (block.exerciseId !== exerciseId) continue;
    for (const set of block.sets || []) {
      const reps = parseInt(set.reps, 10),
        kg = Number(set.weightKg);
      if (!(reps > 0) || !(kg > 0)) continue;
      const score = e1rm(kg, reps);
      if (!best || score > best.score) best = { reps, kg, score };
    }
  }
  return best;
}

export function stallDeloadSuggestion(
  history = [],
  exerciseId,
  { equipment = "machine", config = null, window = STALL_WINDOW } = {},
) {
  const rows = [...history]
    .sort((a, b) =>
      String(a.dateISO || "").localeCompare(String(b.dateISO || "")),
    )
    .map((s) => topSet(s, exerciseId))
    .filter(Boolean);
  if (rows.length < window + 1)
    return { stalled: false, reason: "not-enough-history" };
  const before = Math.max(...rows.slice(0, -window).map((r) => r.score));
  const recent = rows.slice(-window);
  if (recent.some((r) => r.score > before * 1.01))
    return { stalled: false, reason: "still-progressing" };
  const last = recent[recent.length - 1];
  const raw = last.kg * DELOAD_FACTOR;
  const snapped = Number(
    nearestAchievableLoad(raw, { equipment, config: config || {} })?.loadKg,
  );
  const loadKg = snapped > 0 ? snapped : Math.round(raw * 100) / 100;
  if (loadKg >= last.kg) return { stalled: false, reason: "no-lighter-load" };
  return {
    stalled: true,
    sessions: window,
    fromKg: last.kg,
    loadKg,
    reps: last.reps,
  };
}

// ── Accept → next target ────────────────────────────────────────────────────
// Accepting pins ONE deload target per lift in gymPrefs.deloadTargets. It
// governs the next session only: once a newer session logs that lift, the pin
// is spent and the engine resumes. Passing no suggestion clears the pin.
export const acceptDeloadTarget = (gymPrefs, id, s, acceptedISO) => {
  const { [id]: _drop, ...rest } = gymPrefs?.deloadTargets || {};
  return {
    ...gymPrefs,
    deloadTargets: s?.stalled ? { ...rest, [id]: { ...s, acceptedISO } } : rest,
  };
};

export const clearDeloadTarget = (gymPrefs, id) =>
  acceptDeloadTarget(gymPrefs, id);

export function activeDeloadTarget(targets, id, history = []) {
  const t = targets?.[id];
  const day = String(t?.acceptedISO).slice(0, 10);
  return t?.loadKg > 0 &&
    !history.some(
      (s) =>
        String(s.dateISO).slice(0, 10) > day &&
        s.blocks?.some((b) => b.exerciseId === id),
    )
    ? t
    : null;
}

export function applyDeloadTarget(rec, targets, id, history = []) {
  const t = activeDeloadTarget(targets, id, history);
  return t && rec
    ? {
        ...rec,
        load: t.loadKg,
        reps: t.reps || rec.reps,
        deload: true,
        reason: `Deload you accepted (from ${t.fromKg} kg).`,
      }
    : rec;
}
