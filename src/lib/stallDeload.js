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
