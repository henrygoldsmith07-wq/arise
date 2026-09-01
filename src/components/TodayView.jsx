import WeeklyReviewCard from './WeeklyReviewCard.jsx';
import { useMemo, useState } from 'react';
import { PROGRAM_BY_ID } from '../lib/data.js';
import { deriveAttributes, levelFromAttributes } from '../lib/attributes.js';
import { sessionForToday, nextSession, progress } from '../lib/schedule.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import {
  blockDurationMinutes,
  isoToday,
  missedWorkoutRecovery,
  programAdherence,
  progressionExplanation,
  replanSchedule,
  shortWorkoutMode,
} from '../lib/programming.js';

function estimatedMinutes(session, config = null){
  if(session?.estimatedDurationMin != null) return session.estimatedDurationMin;
  const total = (session?.blocks || []).reduce((sum, b)=> sum + blockDurationMinutes(b, config), 0);
  return Math.max(1, Math.ceil(total));
}

export default function TodayView({ store, setStore, onStartSession, onOpenTrain, plateConfig = null }){
  const attrs = useMemo(()=> deriveAttributes(store.history||[]), [store.history]);
  const lvl = useMemo(()=> levelFromAttributes(attrs), [attrs]);
  const sched = store.activeSchedule;
  const prog = sched ? PROGRAM_BY_ID[sched.programId] : null;
  const today = sessionForToday(sched);
  const nxt = nextSession(sched);
  const heroSession = today || nxt || null;
  const progProgress = progress(sched, store.history);
  const adherence = useMemo(()=> programAdherence(sched, store.history || [], { today: isoToday() }), [sched, store.history]);
  const recovery = useMemo(()=> missedWorkoutRecovery(sched, store.history || [], { today: isoToday() }), [sched, store.history]);
  const explanations = useMemo(()=> heroSession ? heroSession.blocks.map(block=> progressionExplanation({ exerciseId: block.exerciseId, targetReps: block.reps, asOfDateISO: heroSession.dateISO, history: store.history || [], plateConfig })) : [], [heroSession, store.history, plateConfig]);

  const applyReplan = ()=>{
    const result = replanSchedule(sched, store.history || [], { today: isoToday() });
    if(result.changed) setStore({ ...store, activeSchedule: result.schedule });
  };

  const startShort = ()=>{
    if(!today) return;
    const result = shortWorkoutMode(today, { minutes: 20 });
    onStartSession(result.session);
  };

  const startGuided = ()=>{
    if(!today) return;
    onStartSession({ ...today, mode: 'guided' });
  };

  return (
    <>
    {heroSession ? (
      // ── Hero: today's workout dominates the page ──
      <section className="px-4 pt-5" aria-label="Today's workout">
        <div className="rounded-3xl border border-line bg-surface p-4 sm:p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">{today ? 'Today' : 'Up next'}{prog ? ` — ${prog.name}` : ''}</p>
              <h2 className="text-2xl font-black tracking-tight truncate">{heroSession.title}</h2>
              <p className="text-xs text-ink3">{heroSession.dateISO}{sched ? ` · Week ${sched.sessions.find(s=> s.status!=='done')?.week || '?'}` : ''}</p>
            </div>
            <span className="shrink-0 text-xs font-bold px-2.5 py-1.5 rounded-full bg-surface2 border border-line tabular-nums">≈{estimatedMinutes(heroSession)} min</span>
          </div>

          <ul className="divide-y divide-line/60 rounded-xl border border-line bg-surface2 overflow-hidden">
            {heroSession.blocks.map((b,i)=>{
              const ex = EXERCISE_BY_ID[b.exerciseId];
              return (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-ink3 tabular-nums w-14 shrink-0 text-xs">{b.sets}× {b.reps}</span>
                  <span className="font-medium truncate">{ex?.name || b.exerciseId}</span>
                  <span className="ml-auto text-xs text-ink3 shrink-0">{b.loadHint}</span>
                </li>
              );
            })}
          </ul>

          <details className="rounded-xl border border-line bg-surface px-3 py-2">
            <summary className="text-xs font-bold cursor-pointer">Why these prescriptions?</summary>
            <ul className="mt-2 space-y-2">
              {explanations.map(explanation => (
                <li key={explanation.exerciseId} className="text-[11px] text-ink3">
                  <span className="font-bold text-ink">{explanation.exerciseName}</span> — {explanation.summary}
                  <span className="block mt-0.5">{explanation.rule} <span className="font-semibold">{explanation.confidence} confidence</span></span>
                </li>
              ))}
            </ul>
          </details>

          <div className="flex gap-2 pt-1">
            <button onClick={()=> onStartSession(heroSession)} className="btn btn-primary flex-1 min-h-12 rounded-xl text-base">
              {today ? "Start today's session" : 'Start this session'}
            </button>
            {today && <button onClick={startShort} className="btn btn-secondary min-h-12 rounded-xl px-3 text-xs">Short<br/>20 min</button>}
            {today && <button onClick={startGuided} className="btn btn-secondary min-h-12 rounded-xl px-3 text-xs">Guided<br/>step-by-step</button>}
            {!today && onOpenTrain && <button onClick={onOpenTrain} className="btn btn-secondary min-h-12 rounded-xl px-4 text-xs">Schedule</button>}
          </div>
        </div>
      </section>
    ) : (
      <section className="px-4 pt-5" aria-label="No program scheduled">
        <div className="rounded-3xl border border-line bg-surface p-5 space-y-3">
          <h2 className="text-2xl font-black tracking-tight">{prog ? 'Program complete' : 'No program scheduled'}</h2>
          <p className="text-sm text-ink3">{prog ? 'You finished every scheduled session — pick your next program in Train.' : 'Pick a program in Train — it becomes a dated schedule so you always know what’s next.'}</p>
          <button onClick={onOpenTrain} className="btn btn-primary w-full min-h-12 rounded-xl">Choose a program</button>
        </div>
      </section>
    )}

    <div className="px-4 py-5 space-y-4">
      {/* ── Actionable recovery notice stays near the top ── */}
      {recovery.needed && (
        <div className="rounded-2xl border border-review/30 bg-reviewsoft px-3 py-3 space-y-2">
          <p className="text-xs font-bold text-review">Missed-workout recovery</p>
          <p className="text-xs text-ink2">{recovery.recommendation}</p>
          <button onClick={applyReplan} className="btn btn-primary min-h-10 rounded-xl px-3 text-xs">Re-plan schedule</button>
        </div>
      )}

      <WeeklyReviewCard store={store} setStore={setStore} />

      {/* ── Secondary: programme progress & audit trail ── */}
      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Scheduled training</p>
            {prog && <p className="text-sm font-semibold">{prog.tagline}</p>}
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums">{progProgress.done}/{progProgress.total} • {progProgress.pct}%</span>
        </div>
        {sched && (
          <p className="text-[11px] text-ink3">{adherence.toDateRate == null ? 'No sessions due yet' : `${Math.round(adherence.toDateRate * 100)}% adherence so far`} • {adherence.missed} missed • {adherence.upcoming} upcoming</p>
        )}
        {sched?.lastAdaptation?.changes?.length ? (
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-xs font-bold cursor-pointer">Programme adjusted from your last session ({sched.lastAdaptation.changes.length})</summary>
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
      </section>

      {/* ── Secondary: attributes ── */}
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
    </div>
    </>
  );
}
