import WeeklyReviewCard from './WeeklyReviewCard.jsx';
import { useMemo, useRef, useState } from 'react';
import { PROGRAM_BY_ID } from '../lib/data.js';
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
import { weekPhaseFor } from '../lib/mesocycle.js';
import { nextBestAction, whatChangedSummary } from '../lib/product.js';
import { isSimpleView } from '../lib/experienceMode.js';
import { safetyPanel } from '../lib/safety.js';
import { storedWorkoutMode, workoutModePatch, workoutModeLabel } from '../lib/workoutMode.js';

function estimatedMinutes(session, config = null){
  if(session?.estimatedDurationMin != null) return session.estimatedDurationMin;
  const total = (session?.blocks || []).reduce((sum, b)=> sum + blockDurationMinutes(b, config), 0);
  return Math.max(1, Math.ceil(total));
}

export default function TodayView({ store, setStore, onStartSession, onOpenTrain, onOpenProgress, plateConfig = null }){
  const sched = store.activeSchedule;
  const prog = sched ? PROGRAM_BY_ID[sched.programId] : null;
  const today = sessionForToday(sched);
  const nxt = nextSession(sched);
  const heroSession = today || nxt || null;
  const progProgress = progress(sched, store.history);
  const adherence = useMemo(()=> programAdherence(sched, store.history || [], { today: isoToday() }), [sched, store.history]);
  const recovery = useMemo(()=> missedWorkoutRecovery(sched, store.history || [], { today: isoToday() }), [sched, store.history]);
  // Safety signals: pain trends, volume/load jumps, implausible PRs, failed-rep
  // patterns, recovery deficit, fatigue stacking. Cautious mode lowers the
  // thresholds so cautious users see signals earlier (see safety.js).
  const safety = useMemo(
    ()=> safetyPanel(store.history || [], store.readinessLog || [], { today: isoToday(), cautious: store.preferences?.cautiousMode === true }),
    [store.history, store.readinessLog, store.preferences?.cautiousMode]
  );
  const simple = isSimpleView(store.preferences);
  // Week phase (ADR: deload as a first-class state). Derived from the schedule's
  // own adaptation stamps — no new persisted state. Week 1 of a fresh program is
  // naturally a 'build' week.
  const weekPhase = useMemo(()=> weekPhaseFor(sched, isoToday()), [sched]);
  const nba = useMemo(()=> nextBestAction({ store, today: isoToday(), todaySession: today, nextSess: nxt, recovery }), [store, today, nxt, recovery]);
  const changes = useMemo(()=> whatChangedSummary({ schedule: sched, history: store.history || [] }), [sched, store.history]);
  const explanations = useMemo(()=> heroSession ? heroSession.blocks.map(block=> progressionExplanation({ exerciseId: block.exerciseId, targetReps: block.reps, asOfDateISO: heroSession.dateISO, history: store.history || [], plateConfig })) : [], [heroSession, store.history, plateConfig]);

  const applyReplan = ()=>{
    const result = replanSchedule(sched, store.history || [], { today: isoToday() });
    if(result.changed) setStore({ ...store, activeSchedule: result.schedule });
  };

  // ── Hero start actions ────────────────────────────────────────────────
  // One dominant CTA (standard session) + a collapsed Options disclosure
  // holding the alternates. The main button never changes mode; Options just
  // records the pick as the "last used" hint and starts that mode directly.
  const optionsBtnRef = useRef(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const lastMode = storedWorkoutMode(store.preferences);

  const rememberMode = (mode)=>{
    setStore(prev=> ({ ...prev, preferences: workoutModePatch(prev.preferences, mode) }));
  };

  const startStandard = ()=>{
    if(!heroSession) return;
    rememberMode('standard');
    onStartSession(heroSession);
  };

  const startShort = ()=>{
    if(!today) return;
    const result = shortWorkoutMode(today, { minutes: 20 });
    rememberMode('short');
    onStartSession(result.session);
  };

  const startGuided = ()=>{
    if(!today) return;
    rememberMode('guided');
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

          {/* Deload as a first-class state: when the week's prescriptions are
              cuts, the whole week is named as one — no guessing from block
              reason strings. Build/recovery weeks are stated plainly too. */}
          {weekPhase && (
            <div className={`rounded-xl px-3 py-2 text-xs font-bold ${weekPhase.kind === 'deload' ? 'bg-reviewsoft text-review' : weekPhase.kind === 'recovery' ? 'bg-surface2 text-ink2' : 'bg-surface2 text-ink2'}`} role="status">
              {weekPhase.kind === 'deload'
                ? `🔄 Deload week — planned volume reduction${weekPhase.detail ? ` · ${weekPhase.detail}` : ''}`
                : weekPhase.kind === 'recovery'
                  ? `🧘 Recovery week — lighter prescriptions${weekPhase.detail ? ` · ${weekPhase.detail}` : ''}`
                  : `Build week ${weekPhase.week ?? ''} — full prescriptions`.trim()}
            </div>
          )}

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
              {explanations.map((explanation, index) => (
                <li key={`${explanation.exerciseId}-${index}`} className="text-[11px] text-ink3">
                  <span className="font-bold text-ink">{explanation.exerciseName}</span> — {explanation.summary}
                  <span className="block mt-0.5">{explanation.rule} <span className="font-semibold">{explanation.confidence} confidence</span></span>
                </li>
              ))}
            </ul>
          </details>

          {/* One dominant CTA. The standard session is the default action —
              short and guided stay one interaction away under Options. */}
          <div className="space-y-1.5 pt-1">
            <button onClick={startStandard} className="btn btn-primary w-full min-h-14 rounded-xl text-base font-extrabold uppercase tracking-wide">
              {today ? 'Start workout' : 'Start this session'}
            </button>
            {today && (
              <div>
                <button
                  ref={optionsBtnRef}
                  onClick={()=> setOptionsOpen(v=> !v)}
                  onKeyDown={(e)=> {
                    // Escape collapses Options and keeps focus on the toggle,
                    // so keyboard users are never stranded inside the panel.
                    if(e.key === 'Escape' && optionsOpen){
                      e.stopPropagation();
                      setOptionsOpen(false);
                      optionsBtnRef.current?.focus();
                    }
                  }}
                  aria-expanded={optionsOpen}
                  aria-controls="today-workout-options"
                  className="btn btn-ghost w-full min-h-11 rounded-xl text-xs font-bold"
                >
                  Options <span aria-hidden>{optionsOpen ? '▴' : '▾'}</span>
                </button>
                {optionsOpen && (
                  <div id="today-workout-options" className="mt-1.5 rounded-xl border border-line bg-surface2 p-2 space-y-1.5">
                    <p className="text-[11px] text-ink3 px-1">Last used: {workoutModeLabel(lastMode)}</p>
                    <button onClick={startShort} className="btn btn-secondary w-full min-h-12 rounded-xl text-sm">
                      20-minute workout
                    </button>
                    <button onClick={startGuided} className="btn btn-secondary w-full min-h-12 rounded-xl text-sm">
                      Guided mode
                    </button>
                  </div>
                )}
              </div>
            )}
            {!today && onOpenTrain && <button onClick={onOpenTrain} className="btn btn-secondary w-full min-h-12 rounded-xl px-4 text-xs">Schedule</button>}
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
          <p className="text-xs font-bold text-review">Life happened — the schedule adapts</p>
          <p className="text-xs text-ink2">{recovery.recommendation}</p>
          <p className="text-[11px] text-ink3">Missing sessions is data, not failure. Re-planning folds them forward in order — nothing doubles up, nothing is “made up” with a brutal workout.</p>
          <button onClick={applyReplan} className="btn btn-primary min-h-10 rounded-xl px-3 text-xs">Re-plan schedule</button>
        </div>
      )}

      {/* ── Next best action: ONLY when the cards above haven't answered it.
          When today's session exists the hero IS the next best action, and
          when recovery is needed the recovery card carries the guidance —
          showing it again here would be duplicated advice. This card earns
          its place on rest days and programme-complete states only. ── */}
      {!today && !recovery.needed && (
        <section className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-3" aria-label="Suggested next step">
          <span aria-hidden className="text-base">🧭</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Next best action</p>
            <p className="text-sm font-bold truncate">{nba.title}</p>
            <p className="text-xs text-ink3">{nba.detail}</p>
          </div>
        </section>
      )}

      {(safety.warnings.length > 0 || safety.deloadPrompt || safety.restart) && (
        <SafetyPanelCard safety={safety} byId={EXERCISE_BY_ID} />
      )}

      <WeeklyReviewCard store={store} setStore={setStore} />

      {/* ── Secondary: programme progress & audit trail — collapsed by default.
          On Today this is reference material, not decision material; the
          hero card answers the decision. Adherence stays visible in the
          summary; the audit trail lives one tap in. ── */}
      <details className="rounded-2xl border border-line bg-surface">
        <summary className="cursor-pointer p-4 flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-ink3">Scheduled training</span>
            {prog && <span className="block text-sm font-semibold truncate">{prog.tagline}</span>}
            {sched && (
              <span className="block text-[11px] text-ink3 mt-0.5">{adherence.toDateRate == null ? 'No sessions due yet' : `${Math.round(adherence.toDateRate * 100)}% adherence so far`} • {adherence.missed} missed • {adherence.upcoming} upcoming</span>
            )}
          </span>
          <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums">{progProgress.done}/{progProgress.total} • {progProgress.pct}%</span>
        </summary>
        <div className="px-4 pb-4 space-y-3">
          {/* ── What changed and why: the audit trail, in plain language ── */}
          {!simple && !!changes.length && changes.map((c) => (
            <details key={`${c.kind}-${c.when}`} className="rounded-xl border border-line bg-surface2 px-3 py-2">
              <summary className="text-xs font-bold cursor-pointer">What changed &amp; why — {c.when} ({c.kind})</summary>
              <ul className="mt-2 space-y-1">
                {c.lines.map((line, i) => <li key={i} className="text-[11px] text-ink3">• {line}</li>)}
              </ul>
            </details>
          ))}
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
        </div>
      </details>

      {/* ── Secondary: attributes one tap back — the full breakdown lives in Progress. */}
      <section className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-4">
        <button onClick={onOpenProgress} className="flex items-center gap-4 text-left flex-1 min-w-0" aria-label="View attributes and level in Progress">
          <span aria-hidden className="text-xl">📊</span>
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-ink3">Attributes</span>
            <span className="block text-sm font-semibold">Strength · Conditioning · Mobility · Consistency</span>
            <span className="block text-[11px] text-ink3">See your levels and how they move — one tap away in Progress.</span>
          </span>
        </button>
      </section>
      <p className="text-[11px] text-ink3 px-1">Attributes are derived from your logged history — volume, loads, variety and consistency — not from program names.</p>
    </div>
    </>
  );
}

const SAFETY_STYLES = {
  stop: 'border-review/40 bg-reviewsoft',
  caution: 'border-review/40 bg-reviewsoft',
  info: 'border-line bg-surface2',
};

/** Renders safety.js signals verbatim: title, detail and one actionable step. */
function SafetyPanelCard({ safety, byId }){
  return (
    <section aria-label="Training safety" className="space-y-2">
      {safety.warnings.map(w => (
        <div key={w.id} className={`rounded-2xl border px-3 py-3 space-y-1 ${SAFETY_STYLES[w.severity] || SAFETY_STYLES.info}`}>
          <p className="text-xs font-bold">
            <span aria-hidden className="mr-1">{w.severity === 'stop' ? '🛑' : w.severity === 'caution' ? '⚠️' : 'ℹ️'}</span>{w.title}
          </p>
          <p className="text-xs text-ink2 leading-snug">{w.detail}</p>
          {w.action && <p className="text-[11px] text-ink3"><span className="font-bold text-ink">Try:</span> {w.action}</p>}
          {w.exerciseId && byId[w.exerciseId] && <p className="text-[10px] text-ink3">Exercise: {byId[w.exerciseId].name}</p>}
        </div>
      ))}
      {safety.deloadPrompt && (
        <div className="rounded-2xl border border-line bg-surface2 px-3 py-3 space-y-1">
          <p className="text-xs font-bold"><span aria-hidden className="mr-1">ℹ️</span>{safety.deloadPrompt.title}</p>
          <p className="text-xs text-ink2 leading-snug">{safety.deloadPrompt.detail}</p>
          {safety.deloadPrompt.action && <p className="text-[11px] text-ink3"><span className="font-bold text-ink">Try:</span> {safety.deloadPrompt.action}</p>}
        </div>
      )}
      {safety.restart && (
        <div className="rounded-2xl border border-line bg-surface2 px-3 py-3 space-y-1">
          <p className="text-xs font-bold"><span aria-hidden className="mr-1">🏃</span>{safety.restart.title}</p>
          <p className="text-xs text-ink2 leading-snug">{safety.restart.detail}</p>
          {safety.restart.action && <p className="text-[11px] text-ink3"><span className="font-bold text-ink">Try:</span> {safety.restart.action}</p>}
        </div>
      )}
    </section>
  );
}
