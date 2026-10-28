// Weekday-based scheduling: re-date upcoming sessions onto the weekdays a
// lifter actually trains (0=Sun..6=Sat), and move one session to another day.
// Pure functions; done sessions and past dates are never touched.
const DAY = 86400000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
export const weekdayOf = (iso) => new Date(toMs(iso)).getUTCDay();

export function normaliseWeekdays(days) {
  const set = [...new Set((days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  return set.sort((a, b) => a - b);
}

// Next date >= fromISO whose weekday is allowed and not in `taken`/`blocked`.
export function nextAllowedDate(fromISO, weekdays, blocked = new Set()) {
  const wd = normaliseWeekdays(weekdays);
  if (!wd.length) return fromISO;
  let ms = toMs(fromISO);
  for (let i = 0; i < 400; i += 1, ms += DAY) {
    const iso = toISO(ms);
    if (wd.includes(weekdayOf(iso)) && !blocked.has(iso)) return iso;
  }
  return fromISO;
}

// Re-date every not-done session dated >= fromISO onto the chosen weekdays,
// in order, one session per day. rideDates (ISO) are skipped when possible.
export function replanToWeekdays(schedule, weekdays, fromISO, { rideDates = [] } = {}) {
  const wd = normaliseWeekdays(weekdays);
  if (!schedule?.sessions?.length || !wd.length) return schedule;
  const blocked = new Set(rideDates);
  const fixed = schedule.sessions.filter((s) => s.status === 'done' || s.dateISO < fromISO);
  const lastFixed = fixed.reduce((m, s) => (s.dateISO > m ? s.dateISO : m), '');
  let cursor = fromISO > lastFixed ? fromISO : toISO(toMs(lastFixed) + DAY);
  const moved = new Map();
  for (const s of schedule.sessions) {
    if (fixed.includes(s)) continue;
    let d = nextAllowedDate(cursor, wd, blocked);
    if (blocked.has(d)) d = nextAllowedDate(cursor, wd);
    moved.set(s.id, d);
    cursor = toISO(toMs(d) + DAY);
  }
  return {
    ...schedule,
    weekdays: wd,
    rev: (schedule.rev || 1) + 1,
    updatedAt: new Date().toISOString(),
    sessions: schedule.sessions.map((s) => (moved.has(s.id) ? { ...s, dateISO: moved.get(s.id) } : s)),
  };
}

// Move one planned session to newISO. If another planned session already sits
// there the two swap, so order is kept and nothing double-books.
export function moveSession(schedule, sessionId, newISO, todayISO) {
  const sessions = schedule?.sessions || [];
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) return { schedule, error: 'not-found' };
  if (s.status === 'done') return { schedule, error: 'done' };
  if (todayISO && newISO < todayISO) return { schedule, error: 'past' };
  if (s.dateISO === newISO) return { schedule, error: 'same' };
  const clash = sessions.find((x) => x.id !== sessionId && x.dateISO === newISO);
  if (clash && clash.status === 'done') return { schedule, error: 'taken' };
  const next = sessions.map((x) => {
    if (x.id === sessionId) return { ...x, dateISO: newISO };
    if (clash && x.id === clash.id) return { ...x, dateISO: s.dateISO };
    return x;
  });
  next.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
  return { schedule: { ...schedule, rev: (schedule.rev || 1) + 1, updatedAt: new Date().toISOString(), sessions: next }, error: null, swapped: clash?.id || null };
}

export const weekdayLabel = (d) => 'Sun Mon Tue Wed Thu Fri Sat'.split(' ')[d] || '';
