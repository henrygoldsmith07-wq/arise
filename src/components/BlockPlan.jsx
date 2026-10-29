// BlockPlan.jsx — the block, week by week. Reads the active schedule through
// blockPlan.js: weeks × sessions, weekly hard sets per muscle against a rough
// guide, a deload switch per week, and "add a week" when the block runs out.
// Everything stays on this device; the schedule it writes is the same one
// Today, Gym Mode and the weekly review read.
import { useMemo, useState } from 'react';
import { useDialogA11y } from '../lib/a11y.js';
import { planWeeks, volumeFlags, muscleTone, setWeekDeload, extendBlock, removeExtendedWeek, canRemoveWeek, MAX_BLOCK_WEEKS, VOLUME_GUIDE } from '../lib/blockPlan.js';
import { localDateISO } from '../lib/dateOnly.js';

const TONE = { ok: 'bg-success', high: 'bg-danger', neutral: 'bg-ink3' };
const dayLabel = (iso)=> new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const CHIP = 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border';

export default function BlockPlan({ store, setStore, onClose }){
  const schedule = store.activeSchedule;
  const [status, setStatus] = useState('');
  const a11y = useDialogA11y({ active: true, onClose });
  const today = localDateISO();
  const weeks = useMemo(()=> planWeeks(schedule, today), [schedule, today]);
  const flags = useMemo(()=> volumeFlags(weeks), [weeks]);

  const run = (result, msg)=> {
    if(result.error){ setStatus(result.error); return; }
    if(result.unchanged){ setStatus('Already set.'); return; }
    setStore({ ...store, activeSchedule: result.schedule });
    setStatus(msg);
  };

  return (
    <div ref={a11y.rootRef} onKeyDown={a11y.trapTab} className="fixed inset-0 z-40 bg-black/40 p-3 sm:p-4 overflow-auto" role="dialog" aria-modal="true" aria-label="Block plan">
      <div className="max-w-xl mx-auto my-4 rounded-3xl bg-surface border border-line p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-black tracking-tight">Block plan</h3>
            <p className="text-[11px] text-ink3">{weeks.length} weeks · hard sets per muscle</p>
          </div>
          <button ref={a11y.closeRef} type="button" onClick={onClose} aria-label="Close block plan" className="ml-auto min-h-11 min-w-11 grid place-items-center rounded-full border border-line">✕</button>
        </div>
        <p role="status" aria-live="polite" className="text-xs text-ink3 min-h-4">{status}</p>

        {flags.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-danger/40 bg-dangersoft px-3 py-2">
            {flags.map(f=> <li key={`${f.week}-${f.muscle}`} className="text-xs text-danger">{f.message}</li>)}
          </ul>
        )}

        {weeks.map(w=> (
          <section key={w.week} className={`rounded-2xl border p-3 space-y-2 bg-surface2 ${w.current ? 'border-success/50' : 'border-line'}`} aria-label={`Week ${w.week}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="text-sm font-black">Week {w.week}</h4>
              {w.current && <span className={`${CHIP} border-success/40 text-success`}>This week</span>}
              {w.deload && <span className={`${CHIP} border-accent text-accent`}>Deload</span>}
              {w.extended && <span className={`${CHIP} border-line text-ink3`}>Added</span>}
              <span className="ml-auto text-[11px] tabular-nums text-ink3">{w.totalSets} sets</span>
            </div>
            <ul className="space-y-1">
              {w.sessions.map(s=> (
                <li key={s.id} className="flex items-baseline gap-2 text-xs">
                  <span className="w-24 shrink-0 tabular-nums text-ink3">{dayLabel(s.dateISO)}</span>
                  <span className="min-w-0 truncate font-medium">{s.title}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-ink3">{s.status === 'done' ? 'done' : `${s.sets} sets`}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1">
              {Object.entries(w.byMuscle).sort((a, b)=> b[1] - a[1]).map(([muscle, n])=> (
                <li key={muscle} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 shrink-0">{muscle}</span>
                  <span className="h-2 flex-1 rounded-full bg-line overflow-hidden" aria-hidden="true"><span className={`block h-full rounded-full ${TONE[w.deload ? 'neutral' : muscleTone(muscle, n)]}`} style={{ width: `${Math.min(100, Math.max(4, n * 3))}%` }} /></span>
                  <span className="w-7 shrink-0 text-right tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={w.locked}
              onClick={()=> run(setWeekDeload(schedule, w.week, !w.deload), `Week ${w.week} updated.`)}
              className="btn btn-secondary w-full min-h-11 rounded-xl text-xs"
              aria-label={w.deload ? `Make week ${w.week} a normal week` : `Make week ${w.week} a deload week`}
            >
              {w.locked ? 'Finished' : w.deload ? 'Make normal week' : 'Make deload week'}
            </button>
          </section>
        ))}

        <div className="grid grid-cols-1 gap-2">
          <button type="button" disabled={weeks.length >= MAX_BLOCK_WEEKS} onClick={()=> run(extendBlock(schedule), `Added week ${weeks.length + 1}.`)} className="btn btn-primary w-full min-h-11 rounded-xl text-sm">
            Add a week
          </button>
          {canRemoveWeek(schedule) && (
            <button type="button" onClick={()=> run(removeExtendedWeek(schedule), 'Removed the week you added.')} className="btn btn-secondary w-full min-h-11 rounded-xl text-xs">
              Remove added week
            </button>
          )}
        </div>
        <p className="text-[11px] text-ink3 leading-snug">
          Main muscle of each exercise only. {VOLUME_GUIDE.low}–{VOLUME_GUIDE.high} sets is a rough range, not a rule; fewer is fine on purpose (legs around cycling).
        </p>
      </div>
    </div>
  );
}
