// WeekdayPlanCard — choose the weekdays you train (upcoming sessions are re-dated
// onto them) and move any single planned session to another day.
import { useState } from 'react';
import { normaliseWeekdays, replanToWeekdays, moveSession, weekdayLabel } from '../lib/weekdaySchedule.js';
import { normaliseRideDays } from '../lib/rideAwareSchedule.js';
import { todayISO } from '../lib/schedule.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const MSG = { past: 'That day has passed.', taken: 'A finished session is on that day.' };

function rideDatesFor(schedule, rideDays, fromISO){
  if(!rideDays.length) return [];
  const out = [];
  const start = Date.parse(`${fromISO}T00:00:00Z`);
  for(let i = 0; i < 120; i += 1){
    const d = new Date(start + i * 86400000);
    if(rideDays.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function WeekdayPlanCard({ store, setStore }){
  const schedule = store.activeSchedule;
  const [msg, setMsg] = useState('');
  if(!schedule?.sessions?.length) return null;
  const today = todayISO();
  const chosen = normaliseWeekdays(schedule.weekdays);
  const upcoming = schedule.sessions.filter(s => s.status !== 'done' && s.dateISO >= today).slice(0, 6);
  const toggle = d => {
    const next = normaliseWeekdays(chosen.includes(d) ? chosen.filter(x => x !== d) : [...chosen, d]);
    if(!next.length){ setMsg('Pick a day.'); return; }
    const rideDays = normaliseRideDays(schedule.keyRideDays);
    const replanned = replanToWeekdays(schedule, next, today, { rideDates: rideDatesFor(schedule, rideDays, today) });
    setStore({ ...store, activeSchedule: replanned });
    setMsg('Sessions re-dated.');
  };
  const move = (id, iso) => {
    if(!iso) return;
    const r = moveSession(schedule, id, iso, today);
    if(r.error){ setMsg(MSG[r.error] || 'Cannot move there.'); return; }
    setStore({ ...store, activeSchedule: r.schedule });
    setMsg(r.swapped ? 'Swapped days.' : 'Session moved.');
  };
  return (
    <section className="rounded-2xl border border-line bg-surface2 p-3 space-y-2" aria-label="Training days" data-testid="weekday-plan">
      <p className="text-xs font-bold">Training days</p>
      <p className="text-[11px] text-ink3">Tap the weekdays you can lift. Upcoming sessions move onto them.</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Training weekdays">
        {ORDER.map(d => (
          <button key={d} type="button" aria-pressed={chosen.includes(d)} onClick={() => toggle(d)}
            className={`min-h-11 min-w-11 px-2 rounded-xl border text-xs font-bold ${chosen.includes(d) ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2'}`}>{weekdayLabel(d)}</button>
        ))}
      </div>
      <ul className="space-y-1.5">
        {upcoming.map(s => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate"><span className="font-semibold">{s.title || 'Session'}</span> · {weekdayLabel(new Date(`${s.dateISO}T00:00:00Z`).getUTCDay())} {s.dateISO.slice(5)}</span>
            <label className="shrink-0 text-[11px] text-ink3">Move to
              <input type="date" min={today} value={s.dateISO} aria-label={`Move ${s.title || 'session'} to another day`}
                onChange={e => move(s.id, e.target.value)} className="ml-1 min-h-11 rounded-lg border border-line bg-surface px-2 text-xs" />
            </label>
          </li>
        ))}
      </ul>
      {msg && <p role="status" className="text-[11px] text-ink2" data-testid="weekday-msg">{msg}</p>}
    </section>
  );
}
