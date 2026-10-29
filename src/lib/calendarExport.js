// calendarExport.js — turn upcoming planned sessions into an RFC 5545 .ics file.
// Pure: the caller supplies the schedule, the clock and the exercise-name
// lookup. Times are "floating" (no zone) so a 18:00 session lands at 18:00 on
// whatever clock the lifter's calendar uses, with no DST maths on our side.
import { predictSessionDuration } from './warmup.js';

const DAY = 86400000;
const PAD = (n) => String(n).padStart(2, '0');
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function normaliseTime(t, fallback = '18:00') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return fallback;
  return `${PAD(m[1])}:${m[2]}`;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
export function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets (UTF-8), never splitting a character. */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // continuation lines start with one space
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const local = (ms) => stamp(ms).slice(0, -1); // floating: same digits, no Z

/** "3×8–10" style label for one planned block. */
function blockLine(b, nameOf) {
  const name = nameOf(b.exerciseId) || b.exerciseId;
  const sets = Number(b.sets) || 0;
  const reps = String(b.reps ?? '').trim();
  const sr = sets && reps ? `${sets}×${reps}` : sets ? `${sets} sets` : reps;
  return sr ? `${name} — ${sr}` : name;
}

/** Sessions worth exporting: not done, dated today or later, within the horizon. */
export function upcomingSessions(schedule, fromISO, { horizonDays = 90, limit = 60 } = {}) {
  if (!ISO_DAY.test(fromISO || '')) return [];
  const end = Date.parse(`${fromISO}T00:00:00Z`) + horizonDays * DAY;
  return (schedule?.sessions || [])
    .filter((s) => s && s.id && ISO_DAY.test(s.dateISO || '') && s.status !== 'done' && s.dateISO >= fromISO && Date.parse(`${s.dateISO}T00:00:00Z`) <= end)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)))
    .slice(0, limit);
}

/**
 * Build the calendar text. The UID is derived only from the session id, so
 * importing again after moving a session UPDATES the event instead of adding a
 * duplicate; SEQUENCE rises with `nowMs` so calendars accept the newer copy.
 */
export function buildIcs(schedule, {
  fromISO,
  nowMs = Date.now(),
  startTime = '18:00',
  reminderMin = 60,
  nameOf = (id) => id,
  calendarName = 'Arise training',
} = {}) {
  const sessions = upcomingSessions(schedule, fromISO);
  const time = normaliseTime(startTime);
  const [hh, mm] = time.split(':').map(Number);
  const seq = Math.max(0, Math.floor((nowMs - Date.UTC(2026, 0, 1)) / 60000));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Arise//Training plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const s of sessions) {
    const startMs = Date.parse(`${s.dateISO}T00:00:00Z`) + (hh * 60 + mm) * 60000;
    const minutes = predictSessionDuration(s.blocks || []);
    const blocks = (s.blocks || []).map((b) => blockLine(b, nameOf));
    const desc = [`${minutes} min planned.`, ...blocks, '', 'Planned in Arise. Moving the session in the app and exporting again updates this event.'].join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:arise-${String(s.id).replace(/[^A-Za-z0-9_.-]/g, '-')}@arise.app`,
      `DTSTAMP:${stamp(nowMs)}`,
      `SEQUENCE:${seq}`,
      `DTSTART:${local(startMs)}`,
      `DTEND:${local(startMs + minutes * 60000)}`,
      `SUMMARY:${escapeText(`Arise: ${s.title || 'Training session'}`)}`,
      `DESCRIPTION:${escapeText(desc)}`,
      'TRANSP:OPAQUE',
    );
    if (reminderMin > 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Training soon', `TRIGGER:-PT${Math.min(1440, Math.round(reminderMin))}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return { text: lines.map(foldLine).join('\r\n') + '\r\n', count: sessions.length, filename: `arise-training-${fromISO || 'plan'}.ics` };
}
