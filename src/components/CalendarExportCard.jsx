// CalendarExportCard — export upcoming planned sessions as an .ics file so
// they show next to work and rides. Nothing is uploaded: the file is built on
// this device and handed to the share sheet or downloaded.
import { useState } from 'react';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { todayISO } from '../lib/schedule.js';
import { buildIcs, normaliseTime, upcomingSessions } from '../lib/calendarExport.js';
import { canShareFiles, shareFile } from '../lib/nativeShare.js';

const REMINDERS = [[0, 'No reminder'], [30, '30 min before'], [60, '1 hour before'], [120, '2 hours before']];

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CalendarExportCard({ store, setStore }) {
  const schedule = store.activeSchedule;
  const prefs = store.preferences || {};
  const [msg, setMsg] = useState('');
  const today = todayISO();
  const count = upcomingSessions(schedule, today).length;
  if (!count) return null;
  const time = normaliseTime(prefs.calendarTime);
  const reminder = Number.isFinite(Number(prefs.calendarReminderMin)) ? Number(prefs.calendarReminderMin) : 60;
  const setPref = (patch) => setStore({ ...store, preferences: { ...prefs, ...patch } });

  async function exportIcs() {
    const { text, filename, count: n } = buildIcs(schedule, {
      fromISO: today, startTime: time, reminderMin: reminder,
      nameOf: (id) => EXERCISE_BY_ID[id]?.name || id,
    });
    const file = new File([text], filename, { type: 'text/calendar' });
    if (canShareFiles({ mimeType: 'text/calendar', filename })) {
      const r = await shareFile({ file, title: 'Arise training plan' });
      if (r === 'shared') { setMsg(`Sent ${n} sessions to your calendar.`); return; }
      if (r === 'cancelled') return;
    }
    download(file);
    setMsg(`Downloaded ${n} sessions. Open the file to add them.`);
  }

  return (
    <section className="rounded-2xl border border-line bg-surface2 p-3 space-y-2" aria-label="Add to calendar" data-testid="calendar-export">
      <p className="text-xs font-bold">Add to calendar</p>
      <p className="text-[11px] text-ink3">Your next {count} planned sessions as a calendar file. Moved a session? Export again and your calendar updates the same events.</p>
      <div className="flex flex-wrap gap-2">
        <label className="text-[11px] text-ink3">Start time
          <input type="time" value={time} onChange={(e) => setPref({ calendarTime: normaliseTime(e.target.value, time) })}
            className="ml-1 min-h-11 rounded-lg border border-line bg-surface px-2 text-xs" aria-label="Session start time" />
        </label>
        <label className="text-[11px] text-ink3">Reminder
          <select value={reminder} onChange={(e) => setPref({ calendarReminderMin: Number(e.target.value) })}
            className="ml-1 min-h-11 rounded-lg border border-line bg-surface px-2 text-xs" aria-label="Reminder">
            {REMINDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <button type="button" onClick={exportIcs} className="btn btn-secondary w-full min-h-11 rounded-xl text-xs" data-testid="calendar-export-btn">Add to calendar (.ics)</button>
      {msg && <p role="status" className="text-[11px] text-ink2" data-testid="calendar-msg">{msg}</p>}
    </section>
  );
}
