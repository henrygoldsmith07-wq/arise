// RideDaysCard — mark key ride days; leg sessions that would land on or the day
// before one can be moved with one tap. Stored on activeSchedule.keyRideDays.
import { useMemo } from 'react';
import { WEEKDAY_LABELS, normaliseRideDays, rideConflicts, applyRideAwareDates, suggestLiftDays } from '../lib/rideAwareSchedule.js';
import { todayISO } from '../lib/schedule.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function RideDaysCard({ store, setStore }){
  const schedule = store.activeSchedule;
  const days = normaliseRideDays(schedule?.keyRideDays);
  const conflicts = useMemo(() => rideConflicts(schedule, days), [schedule, days.join(',')]);
  if(!schedule?.sessions?.length) return null;
  const liftDays = days.length ? suggestLiftDays(days, 3) : [];
  const toggle = d => {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
    setStore({ ...store, activeSchedule: { ...schedule, keyRideDays: normaliseRideDays(next) } });
  };
  const move = () => {
    const r = applyRideAwareDates(schedule, days, { todayISO: todayISO() });
    if(r.moved.length) setStore({ ...store, activeSchedule: r.schedule });
  };
  return (
    <section className="rounded-2xl border border-line bg-surface2 p-3 space-y-2" aria-label="Key ride days">
      <p className="text-xs font-bold">Key ride days</p>
      <p className="text-[11px] text-ink3">Tap the days you race or ride hard. Leg work is kept off those days and the day before.</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Key ride weekdays">
        {ORDER.map(d => (
          <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)}
            className={`min-h-11 min-w-11 px-2 rounded-xl border text-xs font-bold ${days.includes(d) ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2'}`}>{WEEKDAY_LABELS[d]}</button>
        ))}
      </div>
      {liftDays.length > 0 && <p className="text-[11px] text-ink2" data-testid="lift-days-hint">Best lifting days around your rides: {liftDays.map(d => WEEKDAY_LABELS[d]).join(', ')}.</p>}
      {conflicts.length > 0 && (
        <div role="status" className="space-y-1.5">
          <p className="text-[11px] text-ink2">{conflicts.length} leg session{conflicts.length > 1 ? 's' : ''} clash with a ride: {conflicts.slice(0, 3).map(c => `${c.session.title} (${c.session.dateISO})`).join(', ')}{conflicts.length > 3 ? '…' : ''}.</p>
          <button type="button" onClick={move} className="btn btn-secondary min-h-11 rounded-xl text-xs w-full">Move them to clear days</button>
        </div>
      )}
    </section>
  );
}
