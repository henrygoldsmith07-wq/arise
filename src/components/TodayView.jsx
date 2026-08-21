import { useMemo, useState } from 'react';
import { PROGRAM_BY_ID } from '../lib/data.js';
import { deriveAttributes, levelFromAttributes } from '../lib/attributes.js';
import { sessionForToday, nextSession, progress } from '../lib/schedule.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import {
  isoToday,
  missedWorkoutRecovery,
  programAdherence,
  progressionExplanation,
  replanSchedule,
  shortWorkoutMode,
} from '../lib/programming.js';

export default function TodayView({ store, setStore, onStartSession, onOpenTrain, plateConfig = null }){
  const attrs = useMemo(()=> deriveAttributes(store.history||[]), [store.history]);
  const lvl = useMemo(()=> levelFromAttributes(attrs), [attrs]);
  const sched = store.activeSchedule;
  const prog = sched ? PROGRAM_BY_ID[sched.programId] : null;
  const today = sessionForToday(sched);
  const nxt = nextSession(sched);
  const progProgress = progress(sched, store.history);
  const adherence = useMemo(()=> programAdherence(sched, store.history || [], { today: isoToday() }), [sched, store.history]);
  const recovery = useMemo(()=> missedWorkoutRecovery(sched, store.history || [], { today: isoToday() }), [sched, store.history]);
  const explanations = useMemo(()=> today ? today.blocks.map(block=> progressionExplanation({ exerciseId: block.exerciseId, targetReps: block.reps, asOfDateISO: today.dateISO, history: store.history || [], plateConfig })) : [], [today, store.history, plateConfig]);

  const applyReplan = ()=>{
    const result = replanSchedule(sched, store.history || [], { today: isoToday() });
    if(result.changed) setStore({ ...store, activeSchedule: result.schedule });
  };

  const startShort = ()=>{
    if(!today) return;
    const result = shortWorkoutMode(today, { minutes: 20 });
    onStartSession(result.session);
  };

  return (
    <div className="px-4 py-5 space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-ink text-bg grid place-items-center font-black text-lg">{lvl.level}</div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Level {lvl.level} — {lvl.title}</p>
          <p className="text-sm font-semibold truncate">Avg attribute {lvl.avg}/100</p>
          <div className="mt-2 h-1.5 rounded-full bg-surface2 overflow-hidden w-40">
            <div className="h-full bg-ink transition-all" style={{width: `${Math.min(100,lvl.avg)}%`}} />
          </div>
        </div>
        <div className="ml-auto hidden sm:block text-right text-xs text-ink3">{store.history.length} sessions • {store.history.length? 'Keep going' : 'Start your first session'}</div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        {attrs.map(a=> (
          <div key={a.id} className="rounded-2xl border border-line bg-surface p-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">{a.label}</p>
            <p className="text-lg font-black tabular-nums">{a.value}<span className="text-xs font-semibold text-ink3">/100</span></p>
            <div className="mt-1 h-1 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-ink" style={{width: `${a.value}%`}} /></div>
            <p className="text-[11px] text-ink3 mt-1.5 leading-snug">{a.blurb}</p>
          </div>
        ))}
      </section>
      <p className="text-[11px] text-ink3 px-1">Attributes are derived from your logged history — volume, loads, variety and consistency — not from program names.</p>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Scheduled training</p>
            {prog ? (
              <>
                <p className="font-bold">{prog.name} <span className="text-xs font-semibold text-ink3">— Week {sched.sessions.find(s=> s.status!=='done')?.week || prog.weeks[0].week}</span></p>
                <p className="text-xs text-ink3">{prog.tagline}</p>
              </>
            ) : (
              <><p className="font-bold">No program scheduled</p><p className="text-xs text-ink3">Pick a program in Train — it becomes a dated schedule so you always know what’s next.</p></>
            )}
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums">{progProgress.done}/{progProgress.total} • {progProgress.pct}%</span>
        </div>

        {sched && (
          <p className="text-[11px] text-ink3">{adherence.toDateRate == null ? 'No sessions due yet' : `${Math.round(adherence.toDateRate * 100)}% adherence so far`} • {adherence.missed} missed • {adherence.upcoming} upcoming</p>
        )}

        {sched?.lastAdaptation?.changes?.length ? (
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2" open>
            <summary className="text-xs font-bold cursor-pointer">Programme adjusted from your last session</summary>
            <p className="text-[11px] text-ink3 mt-1">{sched.lastAdaptation.dateISO} · deterministic rules, based on repeated performance evidence</p>
            <ul className="mt-2 space-y-1.5">
              {sched.lastAdaptation.changes.slice(0, 4).map((change, index)=> (
                <li key={`${change.sessionId}-${change.exerciseId}-${index}`} className="text-[11px] text-ink3">
                  <span className="font-bold text-ink">{change.exerciseId}</span> · {change.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {recovery.needed && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
            <p className="text-xs font-bold text-amber-900">Missed-workout recovery</p>
            <p className="text-xs text-amber-900">{recovery.recommendation}</p>
            <button onClick={applyReplan} className="btn btn-primary min-h-10 rounded-xl px-3 text-xs">Re-plan schedule</button>
          </div>
        )}

        {today ? (
          <div className="rounded-xl border border-line bg-surface2 p-3">
            <p className="text-xs font-bold">Today — {today.title} <span className="text-ink3 font-semibold">• {today.dateISO}</span></p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {today.blocks.map((b,i)=>{
                const ex = EXERCISE_BY_ID[b.exerciseId];
                return <li key={i} className="flex gap-2"><span className="text-ink3 tabular-nums w-14 shrink-0">{b.sets}× {b.reps}</span><span className="font-medium">{ex?.name || b.exerciseId}</span><span className="ml-auto text-xs text-ink3">{b.loadHint}</span></li>
              })}
            </ul>
            <details className="mt-3 rounded-xl border border-line bg-surface px-3 py-2">
              <summary className="text-xs font-bold cursor-pointer">Why these prescriptions?</summary>
              <ul className="mt-2 space-y-2">
                {explanations.map(explanation=> (
                  <li key={explanation.exerciseId} className="text-[11px] text-ink3">
                    <span className="font-bold text-ink">{explanation.exerciseName}</span> — {explanation.summary}
                    <span className="block mt-0.5">{explanation.rule} <span className="font-semibold">{explanation.confidence} confidence</span></span>
                  </li>
                ))}
              </ul>
            </details>
            <div className="flex gap-2 mt-3">
              <button onClick={()=> onStartSession(today)} className="btn btn-primary flex-1 min-h-11 rounded-xl">Start today’s session</button>
              <button onClick={startShort} className="btn btn-secondary min-h-11 rounded-xl px-3 text-xs">Short 20 min</button>
            </div>
          </div>
        ) : nxt ? (
          <div className="rounded-xl border border-line bg-surface2 p-3">
            <p className="text-xs font-bold">Up next — {nxt.title} <span className="text-ink3 font-semibold">• {nxt.dateISO}</span></p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {nxt.blocks.map((b,i)=>{
                const ex = EXERCISE_BY_ID[b.exerciseId];
                return <li key={i} className="flex gap-2"><span className="text-ink3 tabular-nums w-14 shrink-0">{b.sets}× {b.reps}</span><span className="font-medium">{ex?.name || b.exerciseId}</span></li>
              })}
            </ul>
            <div className="flex gap-2 mt-3">
              <button onClick={()=> onStartSession(nxt)} className="btn btn-primary flex-1 min-h-11 rounded-xl">Start this session</button>
              <button onClick={onOpenTrain} className="btn btn-secondary min-h-11 rounded-xl px-4">View schedule</button>
            </div>
          </div>
        ) : prog ? (
          <p className="text-sm text-ink3">Program complete — pick your next program in Train.</p>
        ) : (
          <button onClick={onOpenTrain} className="btn btn-primary w-full min-h-11 rounded-xl">Choose a program</button>
        )}
      </section>
    </div>
  );
}
