// programmeName.js — keep a programme's label truthful about its weekly days.
//
// Built-in programmes carry the day count in their name ("Strength 4×Week").
// When the generator resamples the template to the days a user actually picked
// (3 days), keeping the "4×Week" label tells them something false. This
// rewrites only a trailing "N×Week" token and leaves other names untouched.

const TOKEN = /(\d+)\s*[×x]\s*Week\b/i;

/** nameForDays('Strength 4×Week', 3) -> 'Strength 3×Week'. Unknown/invalid days keep the name. */
export function nameForDays(name, days) {
  if (typeof name !== "string") return name;
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > 7) return name;
  return TOKEN.test(name) ? name.replace(TOKEN, `${n}×Week`) : name;
}

/** Largest number of sessions in any single week of a generated schedule. */
export function sessionsPerWeek(sessions) {
  const per = {};
  for (const s of sessions || []) per[s.week] = (per[s.week] || 0) + 1;
  const counts = Object.values(per);
  return counts.length ? Math.max(...counts) : null;
}
