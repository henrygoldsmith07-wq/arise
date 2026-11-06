// dayNotes.js — a note on a programme day (Hevy's routine notes): "use the far
// cable stack", "superset the curls". Keyed by programme + day number, so it
// follows that day every week. Stored as gymPrefs.dayNotes[key] = { text,
// updatedAt }; clearing keeps an empty, stamped entry so sync cannot bring
// the old note back. Per-key merge, newest edit wins.
const MAX = 200;
const clean = (v) => String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, MAX);
const stamp = (e) => Date.parse(e?.updatedAt || "") || 0;

/** Key for a scheduled session's programme day, or null when it has none. */
export function dayNoteKey(session) {
  const p = session?.programId, d = session?.day;
  return p && (Number.isInteger(d) || /^\d+$/.test(String(d ?? ""))) ? `${p}:${d}` : null;
}

export function getDayNote(gymPrefs, session) {
  const key = dayNoteKey(session);
  return (key && clean(gymPrefs?.dayNotes?.[key]?.text)) || "";
}

/** gymPrefs patch setting (or, with blank text, clearing) the day's note. */
export function setDayNote(gymPrefs, session, text, nowISO = new Date().toISOString()) {
  const key = dayNoteKey(session);
  if (!key) return null;
  const prev = gymPrefs?.dayNotes || {};
  if (clean(prev[key]?.text) === clean(text)) return null;
  return { dayNotes: { ...prev, [key]: { text: clean(text), updatedAt: nowISO } }, updatedAt: nowISO };
}

export function mergeDayNotes(a, b) {
  const x = a && typeof a === "object" ? a : {}, y = b && typeof b === "object" ? b : {}, out = {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = x[k], q = y[k];
    out[k] = !p || !q ? p || q : stamp(p) !== stamp(q) ? (stamp(p) > stamp(q) ? p : q) : clean(p.text) >= clean(q.text) ? p : q;
  }
  return out;
}
