// ReadinessCheckIn.jsx — three questions, one tap.
//
// This is the input the recovery layer never had. It is deliberately NOT a
// form: there is no submit-validation dance, no modal, and no required field,
// because the entire value of a daily check-in is that it survives a bad week
// of adherence. If it is annoying enough to skip on the days you feel worst, it
// collects exactly the wrong data.
//
// Three signals on a 1..5 scale, prefilled from the last entry. Most mornings
// nothing has changed, so the common case is: look, tap Save. One tap.
//
// Not a training screen, so it stays out of the workout path entirely — the
// logger must never gain a tap because of this.

import { useMemo, useState } from 'react';
import {
  READINESS_SIGNALS, READINESS_SCALE_MIN, READINESS_SCALE_MAX,
  readinessBand, readinessFormDefaults, readinessOn, removeReadinessEntry,
  scoreReadinessInputs, upsertReadinessEntry,
} from '../lib/readinessLog.js';

const SCALE = Array.from(
  { length: READINESS_SCALE_MAX - READINESS_SCALE_MIN + 1 },
  (_, i)=> READINESS_SCALE_MIN + i,
);

export default function ReadinessCheckIn({ store, setStore, todayISO }){
  const log = store.readinessLog || [];
  const existing = readinessOn(log, todayISO);

  const [form, setForm] = useState(()=> readinessFormDefaults(log, todayISO));
  const [open, setOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const previewScore = useMemo(()=> scoreReadinessInputs(form), [form]);
  const band = readinessBand(previewScore);

  const save = ()=>{
    setStore({ ...store, readinessLog: upsertReadinessEntry(log, { dateISO: todayISO, ...form }) });
    setOpen(false);
    setJustSaved(true);
    setTimeout(()=> setJustSaved(false), 3000);
  };

  const clear = ()=>{
    setStore({ ...store, readinessLog: removeReadinessEntry(log, todayISO) });
    setForm(readinessFormDefaults(removeReadinessEntry(log, todayISO), todayISO));
  };

  const changed = form.sleep !== existing?.sleep
    || form.soreness !== existing?.soreness
    || form.motivation !== existing?.motivation;

  // Collapsed, this is one line — the resting state of the Today tab.
  if(!open){
    return (
      <div className="rounded-2xl border border-line bg-surface p-3">
        <button
          onClick={()=> setOpen(true)}
          aria-expanded={false}
          data-testid="readiness-open"
          className="w-full flex items-center gap-2 text-left min-h-11"
        >
          <span className="text-sm font-semibold">How are you today?</span>
          <span className={`ml-auto text-xs font-bold ${existing ? 'text-ink' : 'text-ink3'}`} data-testid="readiness-summary">
            {justSaved ? `Logged — ${band.label}` : (existing ? `${existing.score} · ${readinessBand(existing.score).label}` : 'Not logged')}
          </span>
        </button>
      </div>
    );
  }

  return (
    <section
      className="rounded-2xl border border-line bg-surface p-3 space-y-3"
      data-testid="readiness-checkin"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">How are you today?</h2>
        <button
          onClick={()=> setOpen(false)}
          className="w-11 h-11 -mr-2 -mt-2 grid place-items-center rounded-xl text-ink3"
          aria-label="Close readiness check-in"
        >✕</button>
      </div>

      <div className="space-y-2.5">
        {READINESS_SIGNALS.map(signal=> (
          <div key={signal.id} className="flex items-center gap-2">
            <span className="text-xs font-semibold w-20 shrink-0">{signal.label}</span>
            <div role="group" aria-label={signal.label} className="flex gap-1 flex-1">
              {SCALE.map(value=> {
                const active = form[signal.id] === value;
                return (
                  <button
                    key={value}
                    onClick={()=> setForm(f=> ({ ...f, [signal.id]: value }))}
                    aria-pressed={active}
                    aria-label={`${signal.label} ${value} of ${READINESS_SCALE_MAX}`}
                    data-testid={`readiness-${signal.id}-${value}`}
                    className={`flex-1 min-h-11 rounded-xl border text-sm font-bold ${
                      active ? 'bg-ink text-bg border-ink' : 'bg-surface2 border-line text-ink2'
                    }`}
                  >{value}</button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          data-testid="readiness-save"
          className="btn btn-primary flex-1 min-h-11 rounded-xl"
        >{existing ? 'Update' : 'Save'}</button>
        {existing && (
          <button
            onClick={clear}
            data-testid="readiness-clear"
            className="btn btn-secondary min-h-11 rounded-xl px-3"
          >Clear</button>
        )}
        <button
          onClick={()=> setOpen(false)}
          className="btn btn-secondary min-h-11 rounded-xl px-3"
        >Cancel</button>
      </div>

      <p className="text-[11px] text-ink3 leading-snug">
        Sleep, soreness and motivation become a readiness score of{' '}
        <span className="font-bold text-ink" data-testid="readiness-preview">{previewScore}</span>
        {changed && existing ? ' — changed from today’s entry.' : '.'}{' '}
        Stays on this device and feeds deload decisions. Optional — skip any day.
      </p>
    </section>
  );
}
