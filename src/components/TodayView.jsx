import WeeklyReviewCard from './WeeklyReviewCard.jsx';
import { dayNoteKey, getDayNote, setDayNote } from '../lib/dayNotes.js';
import ReadinessCheckIn from './ReadinessCheckIn.jsx';
import ProgrammeLifecycle, { NextBlockFromEdits } from './ProgrammeLifecycle.jsx';
import WhyExplainer from './WhyExplainer.jsx';
import { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { PROGRAM_BY_ID, EXERCISE_BY_ID, LOCATIONS, EQUIPMENT } from '../lib/data.js';
import { isoToday, replanSchedule, shortWorkoutMode, readinessTrimPlan } from '../lib/programming.js';
import { readinessOn } from '../lib/readinessLog.js';
import { backupRecency as computeBackupRecency, backupRecencyLabel, readBackupState } from '../lib/backupState.js';
import WhatChangedPanel from './WhatChangedPanel.jsx';
import { isSimpleView } from '../lib/experienceMode.js';
import { buildCoachingState } from '../lib/coach/coachingState.js';
import { legRideWarning } from '../lib/rideAwareSchedule.js';
import { storedWorkoutMode, workoutModePatch, workoutModeLabel } from '../lib/workoutMode.js';

// Lazy: the panel pulls the full coaching-state graph, which must never
// inflate this route chunk or the boot bundle (see coach-panel.test.js).
const CoachPanel = lazy(() => import('./CoachPanel.jsx'));
const LiftGoalNudge = lazy(() => import('./LiftGoalNudge.jsx'));
const RecoveryMap = lazy(() => import('./RecoveryMap.jsx'));
const VolumeNudge = lazy(() => import('./VolumeNudge.jsx'));
const NewPrCard = lazy(() => import('./NewPrCard.jsx'));
const QuickWorkoutSheet = lazy(() => import('./QuickWorkoutSheet.jsx'));

export default function TodayView({ store, setStore, onStartSession, onOpenTrain, onOpenProgress, plateConfig = null }){
  const [quickOpen, setQuickOpen] = useState(false);
  const sched = store.activeSchedule;
  // ── The Adaptive Coach layer (P1): ONE structured coaching state computed
  //    from the deterministic engines (progression, scheduling, safety,
  //    adherence, product insights). Every decision surface below renders
  //    from this object — the view never re-derives engine output itself. ──
  const coach = useMemo(
    ()=> buildCoachingState({ store, today: isoToday(), plateConfig }),
    [store, plateConfig]
  );
  const prog = sched ? PROGRAM_BY_ID[sched.programId] : null;
  const heroSession = coach.nextSession?.session || null;
  const today = coach.nextSession?.isToday ? coach.nextSession.session : null;
  const prescriptions = coach.nextSession?.prescriptions || [];
  const progProgress = coach.currentState.programme?.progress || { done: 0, total: 0, pct: 0 };
  const adherence = coach.adherence;
  const recovery = coach.recovery;
  // Safety signals (pain trends, volume/load jumps, implausible PRs, failed
  // reps, recovery deficit) — normalised by the coach from safety.safetyPanel;
  // cautious mode lowers the thresholds (see safety.js).
  const safety = coach.safety;
  const weekPhase = coach.currentState.weekPhase;
  const nba = coach.nextBestAction;
  const simple = isSimpleView(store.preferences);
  // Backup recency — local-only nudge source. Read fresh each render so a
  // successful export in More clears it without needing a subscription.
  const backupRecency = useMemo(
    ()=> computeBackupRecency({ history:store.history || [], lastBackupAt:readBackupState().lastBackupAt }),
    [store.history]
  );

  const applyReplan = ()=>{
    const result = replanSchedule(sched, store.history || [], { today: isoToday() });
    if(result.changed) setStore({ ...store, activeSchedule: result.schedule });
  };

  // "Skip and continue": mark overdue rows done-with-skip so the programme
  // moves on. Explicit and reversible through a backup — never a silent
  // rearrangement, and the skipped rows keep their history link if one exists.
  const skipMissed = ()=>{
    if(!sched || !recovery.missedSessions.length) return;
    const skippedIds = new Set(recovery.missedSessions.map(s=> s.id));
    setStore({
      ...store,
      activeSchedule: {
        ...sched,
        sessions: sched.sessions.map(s=> skippedIds.has(s.id) ? { ...s, status: 'done', skipped: true } : s),
        rev: (Number(sched.rev) >= 0 ? Number(sched.rev) : 0) + 1,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  // ── Hero start actions ────────────────────────────────────────────────
  // One dominant CTA (standard session) + a collapsed Options disclosure
  // holding the alternates. The main button never changes mode; Options just
  // records the pick as the "last used" hint and starts that mode directly.
  const optionsBtnRef = useRef(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const lastMode = storedWorkoutMode(store.preferences);

  // ── Time budget (P2.5): "I have 25 minutes." Compression runs through the
  //    existing shortWorkoutMode engine — blocks ranked by the programme's own
  //    priority, volume scaled to fit, timed work trimmed instead of dropped
  //    (never "delete the last exercises"). The preview and the started
  //    session come from the same engine result, and the adaptation is
  //    recorded on the session it starts — explained before you commit. ──
  const [timeBudget, setTimeBudget] = useState(null);
  const timePlan = useMemo(
    ()=> (timeBudget && heroSession ? shortWorkoutMode(heroSession, { minutes: timeBudget }) : null),
    [timeBudget, heroSession]
  );
  const [trimOn, setTrimOn] = useState(false);
  const trimPlan = useMemo(
    ()=> (heroSession ? readinessTrimPlan(timePlan?.session || heroSession, readinessOn(store.readinessLog, isoToday())) : null),
    [heroSession, timePlan, store.readinessLog]
  );
  const trimApplied = Boolean(trimOn && trimPlan?.changed);
  const shownSession = trimApplied ? trimPlan.session : (timePlan?.session || heroSession);
  const shownIds = new Set((shownSession?.blocks || []).map(b=> b.exerciseId));
  const shownPrescriptions = prescriptions.filter(p=> shownIds.has(p.block.exerciseId));
  const fullMinutes = coach.nextSession?.estimatedDurationMin ?? null;
  const budgetChoices = fullMinutes ? [45, 30, 25, 20, 15].filter(m=> m < fullMinutes) : [];

  // ── Section derivations (presentation grouping only — all engine output
  //    already lives in `coach`; nothing is recomputed here) ──
  const blockAdapted = coach.changes.filter(c=> c.kind === 'block');
  const otherChanges = coach.changes.filter(c=> c.kind !== 'block' && c.kind !== 'recovery');
  const rxById = new Map(
    coach.recommendations.filter(r=> r.kind === 'prescription').map(r=> [r.exerciseId, r])
  );
  // Simple mode shows only the decisions that actually adapted (plus plateau
  // guards); standard shows every prescription's reasoning. Same engine data,
  // different depth — disclosure, not removal.
  const whyRows = simple
    ? shownPrescriptions.filter(p=> p.explanation.adapted?.length || p.explanation.plateau?.isPlateau)
    : shownPrescriptions;

  // ── Built for you (P2.7): the first plan's provenance as one scannable
  //    line — where/when/how long/level plus the kit restriction that shaped
  //    it. Same onboarding answers the scorer consumed; no new derivation.
  const ob = store.onboarding || null;
  const builtForYou = ob && coach.programmeWhy ? {
    line: [
      ob.location && (LOCATIONS.find(l=> l.id === ob.location)?.label || ob.location),
      ob.daysPerWeek ? `${ob.daysPerWeek} days/week` : null,
      ob.availableMinutes ? `up to ${ob.availableMinutes} min a session` : null,
      ob.level || null,
    ].filter(Boolean).join(' · '),
    kit: (()=> {
      const kit = ob.equipment || [];
      if(!kit.length) return 'Equipment restrictions have already been applied.';
      if(kit.length === 1 && kit[0] === 'bodyweight') return 'No equipment needed — bodyweight only.';
      // "Bodyweight only" reads as a standalone phrase — drop it from the
      // list when real kit is present, since the exclusions already imply it.
      const named = kit.filter(id=> id !== 'bodyweight');
      const shown = (named.length ? named : kit).map(id=> EQUIPMENT.find(e=> e.id === id)?.label || id).join(', ');
      return `Equipment restrictions have already been applied — ${shown}.`;
    })(),
  } : null;

  const rememberMode = (mode)=>{
    setStore(prev=> ({ ...prev, preferences: workoutModePatch(prev.preferences, mode) }));
  };

  // ── Data-privacy trust badge (first-run / evaluator flow): the moment
  //    onboarding completes — apo programme chosen, no sessions logged yet —
  //    one line states the local-first contract in the same breath as the
  //    plan it produced. It disappears on the first logged session (its job
  //    — setting the posture before data exists — is done) and never fires
  //    in demo, where there is no user data to keep anywhere.
  const showTrustBadge = Boolean(coach.programmeWhy) && !(store.history || []).length && !store.demo;

  const startStandard = ()=>{
    if(!heroSession) return;
    const target = trimApplied ? trimPlan.session : (timePlan?.session || heroSession);
    // A compressed start records WHY the session differs from the plan — the
    // adaptation travels with the session and its history entry, so a
    // shortened workout is never a silent truncation.
    const session = timePlan?.changed
      ? {
          ...target,
          timeAdaptation: {
            targetMinutes: timeBudget,
            originalDurationMin: timePlan.originalDurationMin,
            estimatedDurationMin: timePlan.estimatedDurationMin,
            omittedExerciseIds: timePlan.omittedExerciseIds,
            reason: timePlan.reason,
          },
        }
      : target;
    rememberMode(timePlan?.changed ? 'short' : 'standard');
    onStartSession(session);
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

  const rideWarning = heroSession ? legRideWarning(heroSession, heroSession.dateISO, sched?.keyRideDays) : null;
  return (
    <>
    {heroSession ? (
      // ── Hero: today's workout dominates the page ──
      <section className="px-4 pt-5" aria-label="Today's workout">
        <div className="rounded-2xl border border-line bg-surface p-3 sm:p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink3">{today ? 'Today' : 'Up next'}{prog ? ` — ${prog.name}` : ''}</p>
              <h2 className="text-2xl font-black tracking-tight truncate">{heroSession.title}</h2>
              <p className="text-xs text-ink3">{heroSession.dateISO}{sched ? ` · Week ${sched.sessions.find(s=> s.status!=='done')?.week || '?'}` : ''}</p>
              <p className="text-[11px] text-ink2 mt-0.5">{coach.nextSession.objective}</p>
              <DayNote store={store} setStore={setStore} session={heroSession} />
              {rideWarning && <p role="status" data-testid="leg-ride-warning" className="text-[11px] text-ink2 mt-1.5 rounded-lg bg-surface2 px-2 py-1.5">{rideWarning.message}</p>}
            </div>
            <span className="shrink-0 text-xs font-bold px-2.5 py-1.5 rounded-full bg-surface2 border border-line tabular-nums">≈{timePlan?.changed ? timePlan.estimatedDurationMin : coach.nextSession.estimatedDurationMin} min</span>
          </div>
          {coach.nextSession.typicalDuration && (
            <p className="text-[11px] text-ink3 -mt-1">Based on your last {coach.nextSession.typicalDuration.samples} sessions, you finish this workout in {coach.nextSession.typicalDuration.lo}–{coach.nextSession.typicalDuration.hi} minutes.</p>
          )}

          {/* First-plan provenance (P2.7): the five onboarding answers, one
              glance — so the first session feels chosen, not generated. */}
          {builtForYou && (
            <div className="rounded-lg bg-surface2 px-3 py-2 space-y-0.5" data-testid="today-built-for-you">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink3">Built for you</p>
              <p className="text-xs font-semibold">{builtForYou.line}</p>
              <p className="text-[11px] text-ink3">{builtForYou.kit}</p>
            </div>
          )}

          {/* Deload as a first-class state: when the week's prescriptions are
              cuts, the whole week is named as one — no guessing from block
              reason strings. Build/recovery weeks are stated plainly too. */}
          {weekPhase && (
            <div className={`rounded-lg px-3 py-2 text-xs font-bold ${weekPhase.kind === 'deload' ? 'bg-reviewsoft text-review' : weekPhase.kind === 'recovery' ? 'bg-surface2 text-ink2' : 'bg-surface2 text-ink2'}`} role="status">
              {weekPhase.kind === 'deload'
                ? `🔄 Deload week — planned volume reduction${weekPhase.detail ? ` · ${weekPhase.detail}` : ''}`
                : weekPhase.kind === 'recovery'
                  ? `🧘 Recovery week — lighter prescriptions${weekPhase.detail ? ` · ${weekPhase.detail}` : ''}`
                  : `Build week ${weekPhase.week ?? ''} — full prescriptions`.trim()}
            </div>
          )}

          {/* ── Time budget (P2.5): state the time you have; the compression
              engine does the rest, with the reason shown before you start. ── */}
          {today && budgetChoices.length > 0 && (
            <div className="flex items-center gap-1" role="group" aria-label="Time available today">
              <span className="text-[11px] text-ink3 mr-1 shrink-0">Time</span>
              <button
                onClick={()=> setTimeBudget(null)}
                aria-pressed={timeBudget === null}
                className={`flex-1 min-h-11 min-w-11 rounded-lg border text-xs font-bold ${timeBudget === null ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink3'}`}
              >Plan</button>
              {budgetChoices.map(minutes=> (
                <button
                  key={minutes}
                  onClick={()=> setTimeBudget(minutes)}
                  aria-pressed={timeBudget === minutes}
                  className={`flex-1 min-h-11 min-w-11 rounded-lg border text-xs font-bold tabular-nums ${timeBudget === minutes ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink3'}`}
                >{minutes} min</button>
              ))}
            </div>
          )}
          {timePlan?.changed && (
            <div className="rounded-lg bg-surface2 px-3 py-2 space-y-1" role="status" data-testid="today-time-fit">
              <p className="text-xs font-bold">⏱ Fitted to {timeBudget} minutes — {timePlan.reason}</p>
              <p className="text-[11px] text-ink3 leading-snug">
                {timePlan.originalDurationMin} min planned → {timePlan.estimatedDurationMin} min now.
                {timePlan.omittedExerciseIds.length > 0 && <> Set aside: {timePlan.omittedExerciseIds.map(id=> EXERCISE_BY_ID[id]?.name || id).join(', ')}.</>}
              </p>
              <WhyExplainer
                item={{
                  reason: timePlan.reason,
                  expectedOutcome: `About ${timePlan.estimatedDurationMin} minutes of the highest-value work within the time you gave.`,
                  evidence: [
                    `Planned duration: ${timePlan.originalDurationMin} min.`,
                    `Kept ${timePlan.session.blocks.length} of ${heroSession.blocks.length} blocks.`,
                    ...(timePlan.omittedExerciseIds.length ? [`Set aside: ${timePlan.omittedExerciseIds.map(id=> EXERCISE_BY_ID[id]?.name || id).join(', ')}.`] : []),
                  ],
                  expert: {
                    inputs: [
                      { label: 'Target', value: `${timeBudget} min` },
                      { label: 'Kept', value: `${timePlan.session.blocks.length}/${heroSession.blocks.length} blocks` },
                    ],
                    policy: 'programming.shortWorkoutMode — blockPriority ranking, then per-block volume scaling',
                    source: 'programming.shortWorkoutMode',
                  },
                }}
                label="Why keep these?"
              />
            </div>
          )}

          <ul className="divide-y divide-line/60 rounded-lg border border-line bg-surface2 overflow-hidden">
            {shownSession.blocks.slice(0, 4).map((b,i)=>{
              const ex = EXERCISE_BY_ID[b.exerciseId];
              return (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid="today-block">
                  <span className="text-ink3 tabular-nums w-14 shrink-0 text-xs">{b.sets}× {b.reps}</span>
                  <span className="font-medium truncate">{ex?.name || b.exerciseId}</span>
                  {b.userSwapFrom && <span className="text-[10px] font-bold uppercase text-success shrink-0">your swap</span>}
                  <span className="ml-auto text-xs text-ink3 shrink-0">{b.loadHint}</span>
                </li>
              );
            })}
          </ul>
          {/* Long plans stay scannable: the first four lifts answer "what is
              this session?"; the rest are one tap deep, never lost. */}
          {shownSession.blocks.length > 4 && (
            <details className="rounded-lg bg-surface2">
              <summary className="px-3 py-2.5 text-xs font-bold cursor-pointer min-h-11 flex items-center">All {shownSession.blocks.length} lifts</summary>
              <ul className="divide-y divide-line/60 border-t border-line">
                {shownSession.blocks.slice(4).map((b,i)=>{
                  const ex = EXERCISE_BY_ID[b.exerciseId];
                  return (
                    <li key={`rest-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="text-ink3 tabular-nums w-14 shrink-0 text-xs">{b.sets}× {b.reps}</span>
                      <span className="font-medium truncate">{ex?.name || b.exerciseId}</span>
                      <span className="ml-auto text-xs text-ink3 shrink-0">{b.loadHint}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          {/* One dominant CTA. The standard session is the default action —
              short and guided stay one interaction away under Options. */}
          <div className="space-y-1.5 pt-1">
            {trimPlan?.changed && (
              <div className="rounded-lg bg-surface2 px-3 py-2 space-y-1.5" role="status" data-testid="today-readiness-trim">
                <p className="text-xs font-bold">Low readiness today</p>
                <p className="text-[11px] text-ink3 leading-snug">{trimPlan.reason}</p>
                <button
                  onClick={()=> setTrimOn(v=> !v)}
                  aria-pressed={trimOn}
                  className={`min-h-11 px-3 rounded-full border text-xs font-bold ${trimOn ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink3'}`}
                >{trimOn ? 'Trimmed — tap to undo' : 'Trim one set per lift'}</button>
              </div>
            )}
            <button onClick={startStandard} className="btn btn-primary w-full min-h-12 rounded-lg font-bold">
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
                  className="btn btn-ghost w-full min-h-11 rounded-lg text-xs font-bold"
                >
                  Options <span aria-hidden>{optionsOpen ? '▴' : '▾'}</span>
                </button>
                {optionsOpen && (
                  <div id="today-workout-options" className="mt-1.5 rounded-lg bg-surface2 p-2 space-y-1.5">
                    <p className="text-[11px] text-ink3 px-1">Last used: {workoutModeLabel(lastMode)}</p>
                    <button onClick={startShort} className="btn btn-secondary w-full min-h-12 rounded-lg text-sm">
                      20-minute workout
                    </button>
                    <button onClick={startGuided} className="btn btn-secondary w-full min-h-12 rounded-lg text-sm">
                      Guided mode
                    </button>
                  </div>
                )}
              </div>
            )}
            {!today && onOpenTrain && <button onClick={onOpenTrain} className="btn btn-secondary w-full min-h-12 rounded-lg px-4 text-xs">Schedule</button>}
          </div>
        </div>
      </section>
    ) : (
      <section className="px-4 pt-5" aria-label="No program scheduled">
        <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <h2 className="text-2xl font-black tracking-tight">{prog ? 'Program complete' : 'No program scheduled'}</h2>
          <p className="text-sm text-ink3">{prog ? 'You finished every scheduled session — pick your next program in Train.' : 'Pick a program in Train — it becomes a dated schedule so you always know what’s next.'}</p>
          {sched && <NextBlockFromEdits schedule={sched} store={store} setStore={setStore} />}
          <button onClick={onOpenTrain} className="btn btn-primary w-full min-h-12 rounded-lg">Choose a program</button>
        </div>
      </section>
    )}

    <div className="px-4 py-5 space-y-3">
      <button type="button" onClick={()=> setQuickOpen(true)} data-testid="quick-workout-open"
        className="btn btn-ghost w-full min-h-11 rounded-lg text-xs font-bold">+ Quick workout — log something unplanned</button>
      {quickOpen && <Suspense fallback={null}><QuickWorkoutSheet store={store} onClose={()=> setQuickOpen(false)} onStart={(session)=> { setQuickOpen(false); onStartSession(session); }} /></Suspense>}
      {/* Recovery input. Collapsed it is one line, so it costs nothing on the
          days the user skips it — which is the property that decides whether a
          daily check-in gets collected at all. */}
      <ReadinessCheckIn store={store} setStore={setStore} todayISO={isoToday()} />

      {(store.history || []).length >= 2 && <Suspense fallback={null}><NewPrCard store={store} /></Suspense>}
      {(store.history || []).length >= 1 && <Suspense fallback={null}><RecoveryMap store={store} /></Suspense>}
      {(store.history || []).length >= 6 && <Suspense fallback={null}><VolumeNudge store={store} /></Suspense>}
      {store.gymPrefs?.liftGoals && <Suspense fallback={null}><LiftGoalNudge store={store} setStore={setStore} /></Suspense>}

      {showTrustBadge && (
        <p className="rounded-lg bg-surface2 px-3 py-2 text-[11px] text-ink2 leading-snug flex items-start gap-2" data-testid="today-trust-badge">
          <span aria-hidden>🔒</span>
          <span>Your data stays on this device — no account, nothing uploaded. Exporting or setting up sync is always your choice, from More.</span>
        </p>
      )}

      {/* ── Missed workout recovery: three clear choices, brief consequences,
          no guilt. "Do it today" simply surfaces the session to start now;
          "Skip" marks the row done-with-skip so the programme moves on;
          "Replan" folds missed sessions forward in order. Nothing silently
          rearranges the programme. ── */}
      {recovery.needed && (
        <div className="rounded-xl border border-review/30 bg-reviewsoft px-3 py-3 space-y-2">
          <p className="text-xs font-bold text-review">{recovery.missedSessions.length === 1 ? `You missed ${recovery.missedSessions[0].title}${recovery.missedSessions[0].dateISO ? ` (${recovery.missedSessions[0].dateISO})` : ''}.` : `${recovery.missedSessions.length} sessions are overdue.`}</p>
          <p className="text-[11px] text-ink3">Missing sessions is data, not failure. Choose how to move on — nothing doubles up and nothing is “made up” with a brutal workout.</p>
          <div className="flex flex-wrap gap-2">
            {recovery.missedSessions.length === 1 && (
              <button onClick={()=> onStartSession(recovery.missedSessions[0])} className="btn btn-primary min-h-10 rounded-lg px-3 text-xs">Do it today</button>
            )}
            <button onClick={applyReplan} className="btn btn-secondary min-h-10 rounded-lg px-3 text-xs">Replan this week</button>
            <button onClick={skipMissed} className="btn btn-secondary min-h-10 rounded-lg px-3 text-xs">Skip and continue</button>
          </div>
          <p className="text-[11px] text-ink3">{recovery.recommendation}</p>
        </div>
      )}

      {/* ── What's different / Why / After the workout: the coaching
          decision, in the order the spec asks for — what changed, why, and
          what happens next. Everything below renders `coach`; no new engine
          calls, no invented reasons. One card, divided — not four. ── */}
      {heroSession && <div className="rounded-xl border border-line bg-surface divide-y divide-line">
      {heroSession && (
        <section className="p-3 space-y-2" aria-label="What's different">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink3">What's different</p>
          {blockAdapted.length > 0 && (
            <div className="rounded-lg border border-review/30 bg-reviewsoft px-3 py-2" role="status" data-testid="today-adaptation-reasons">
              <p className="text-xs font-bold text-review">⚡ Adjusted from your training</p>
              <ul className="mt-1 space-y-1">
                {blockAdapted.map((c, i) => (
                  <li key={`${c.id}-${i}`} className="text-[11px] text-ink2 leading-snug">
                    <span className="font-bold text-ink">{c.title}</span> — {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {otherChanges.length > 0 && (
            <ul className="space-y-1.5">
              {otherChanges.map(c=> (
                <li key={c.id} className="text-xs text-ink2 leading-snug">
                  {c.title && <span className="font-bold text-ink">{c.title} — </span>}{c.detail}
                  {c.when && <span className="block text-[10px] text-ink3">{c.when}</span>}
                </li>
              ))}
            </ul>
          )}
          {/* Stable state (P1.3): an unchanged plan must read as a decision,
              not an absence — but never claim "stable performance" with zero
              history to support it. */}
          {(blockAdapted.length === 0 && otherChanges.length === 0) && (
            <p className="text-xs text-ink3">
              {(store.history || []).length
                ? 'Your plan is staying the same because your recent performance is stable — no rule has fired to change it.'
                : 'This is your starting plan — Arise adapts it once your sessions give it evidence.'}
            </p>
          )}
        </section>
      )}

      {heroSession && (
        <section className="p-3 space-y-2" aria-label="Why">
          {(coach.programmeWhy || whyRows.length === 0) && <p className="text-[11px] font-bold uppercase tracking-wider text-ink3">Why</p>}
          {/* First-run provenance: why THIS programme exists at all — the
              scorer's verbatim reasons, stored when the plan was generated. */}
          {coach.programmeWhy && (
            <div className="rounded-lg bg-surface2 px-3 py-2 space-y-1">
              <p className="text-xs font-bold">Why this programme</p>
              <p className="text-[11px] text-ink3 leading-snug">Arise generated “{coach.currentState.programme?.name}” from your answers — goal, kit, level and schedule:</p>
              <ul className="space-y-0.5">
                {(coach.programmeWhy.reasons || []).map((r, i)=> <li key={i} className="text-[11px] text-ink2 leading-snug">• {r}</li>)}
              </ul>
              <WhyExplainer
                item={{
                  evidence: (coach.programmeWhy.selectionInputs || []).map(l=> `${l.label}: ${l.value}`),
                  expert: {
                    inputs: (coach.programmeWhy.selectionInputs || []).map(l=> ({ label: l.label, value: l.value })),
                    policy: 'Ranking uses only goal, equipment, level and days — history never ranks, it only shapes sessions.',
                    source: 'templates.recommendTemplate (deterministic scorer)',
                  },
                }}
                label="Which answers chose it"
              />
            </div>
          )}
          {whyRows.length === 0 ? (
            <p className="text-xs text-ink3">The plan matches the programme as generated — no adjustments to explain yet.</p>
          ) : (
            <details>
            <summary className="min-h-11 -my-2 flex items-center text-[11px] font-bold uppercase tracking-wider text-ink3 cursor-pointer">Why these numbers · {whyRows.length} lift{whyRows.length === 1 ? '' : 's'}</summary>
            {/* Cold-start honesty (P2.12): no personalised signal yet means
                deterministic priors — say so once, not once per lift. */}
            {whyRows.some(p=> !p.explanation.personalised) && (
              <p className="text-[10px] text-ink3 mb-2">Initial estimates — set from programme defaults; they calibrate to your own logged sets as evidence accumulates.</p>
            )}
            <ul className="space-y-2">
              {whyRows.map(p=> {
                const rx = rxById.get(p.block.exerciseId);
                return (
                  <li key={`${p.block.exerciseId}-${p.index}`} className="space-y-1">
                    <p className="text-[11px] text-ink2 leading-snug">{rx?.reason || p.explanation.summary}</p>
                    <WhyExplainer item={rx || null} label="Evidence, inputs & policy" />
                  </li>
                );
              })}
            </ul>
            </details>
          )}
        </section>
      )}

      {/* ── Today's focus (P1.1): at most two cues, prioritised from the same
          prescriptions the Why section shows — guards first, else today's
          success condition. Nothing new is computed here. ── */}
      {heroSession && !!coach.focus?.length && (
        <section className="p-3 space-y-2" aria-label="Today's focus">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink3">{today ? 'Today’s focus' : 'Next session’s focus'}</p>
          <ul className="space-y-1.5">
            {coach.focus.map(f=> (
              <li key={f.id}>
                <p className="text-xs font-bold">{f.title}</p>
                <p className="text-[11px] text-ink3 mt-0.5 leading-snug">{f.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {heroSession && (
        <details className="px-3" aria-label="After your workout">
          <summary className="min-h-11 flex items-center text-[11px] font-bold uppercase tracking-wider text-ink3 cursor-pointer">After the workout</summary>
          <ul className="space-y-1 pb-3">
            {coach.postWorkout.map(row=> (
              <li key={row.label} className="text-[11px] text-ink3 leading-snug">
                <span className="font-semibold text-ink2">{row.label}</span> — {row.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
      </div>}

      {/* ── Next best action: ONLY when the cards above haven't answered it.
          When today's session exists the hero IS the next best action, and
          when recovery is needed the recovery card carries the guidance —
          showing it again here would be duplicated advice. This card earns
          its place on rest days and programme-complete states only. ── */}
      {!today && !recovery.needed && (
        <section className="rounded-xl border border-line bg-surface p-3 flex items-center gap-3" aria-label="Suggested next step">
          <span aria-hidden className="text-base">🧭</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink3">Next best action</p>
            <p className="text-sm font-bold truncate">{nba.title}</p>
            <p className="text-xs text-ink3">{nba.detail}</p>
          </div>
        </section>
      )}

      {/* Data-loss nudge: only when a backup is genuinely overdue. Quiet when
          healthy — the recency line lives in More, so this stays a signal, not
          a permanent banner. Local only; no notification is requested. */}
      {backupRecency.overdue && (
        <section className="rounded-xl border border-review/40 bg-reviewsoft p-3" aria-label="Backup overdue">
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-base">💾</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink3">Backup overdue</p>
              <p className="text-sm font-bold">{backupRecencyLabel(backupRecency)}</p>
              <p className="text-xs text-ink3">
                {backupRecency.sessions} session{backupRecency.sessions === 1 ? '' : 's'} on this device {backupRecency.sessions === 1 ? 'exists' : 'exist'} nowhere else. Export a copy you can restore from.
              </p>
            </div>
          </div>
        </section>
      )}

      {(safety.warnings.length > 0 || safety.deloadPrompt || safety.restart) && (
        <SafetyPanelCard safety={safety} />
      )}

      <WeeklyReviewCard store={store} setStore={setStore} />

      {/* ── On-device coach (lazy): the full local coach engine, one tap deep in
          the main loop instead of buried behind More → Settings. Renders its
          own collapsed trigger; the answer state is session-scoped. ── */}
      <Suspense fallback={null}><CoachPanel store={store} programmeWhy={coach.programmeWhy} /></Suspense>

      {/* ── Secondary: programme progress & audit trail — collapsed by default.
          On Today this is reference material, not decision material; the
          hero card answers the decision. Adherence stays visible in the
          summary; the audit trail lives one tap in. ── */}
      <details className="rounded-xl border border-line bg-surface">
        <summary className="cursor-pointer p-4 flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-ink3">Scheduled training</span>
            {prog && <span className="block text-sm font-semibold truncate">{prog.tagline}</span>}
            {sched && (
              <span className="block text-[11px] text-ink3 mt-0.5">{adherence.toDateRate == null ? 'No sessions due yet' : `${Math.round(adherence.toDateRate * 100)}% adherence so far`} • {adherence.missed} missed • {adherence.upcoming} upcoming</span>
            )}
          </span>
          <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums">{progProgress.done}/{progProgress.total} • {progProgress.pct}%</span>
        </summary>
        <div className="px-4 pb-4 space-y-3">
          {/* ── Programme as an adaptive object (P2.6): the START → TRAIN →
              ADAPT → REVIEW → COMPLETE → NEXT BLOCK loop, narrated from the
              records the schedule already keeps — one tap from Today instead
              of reconstructed across screens. */}
          <ProgrammeLifecycle schedule={sched} history={store.history || []} lastReviewAck={store.lastWeeklyReviewAck || null} store={store} setStore={setStore} />
          {/* ── What changed and why: one shared, inspectable audit trail ── */}
          <WhatChangedPanel schedule={sched} history={store.history || []} compact />
        </div>
      </details>

      {/* ── Secondary: level + performance one tap back — full breakdown in
          Progress. Hidden in simple mode (essentials-first display gate). */}
      {!simple && (
      <button onClick={onOpenProgress} className="w-full min-h-11 rounded-xl border border-line bg-surface px-3 flex items-center gap-2 text-left text-xs" aria-label="View attributes and level in Progress">
        <span aria-hidden>📊</span>
        <span className="min-w-0 flex-1 truncate"><span className="font-bold">Level & strength trends</span> <span className="text-ink3">— habits earn XP; strength only when sessions show it</span></span>
        <span aria-hidden className="text-ink3">›</span>
      </button>
      )}
    </div>
    </>
  );
}

/** Hevy-style routine note on this programme day: shown here and in the
 *  workout, edited in place. Blank + Save clears it. */
function DayNote({ store, setStore, session }){
  const gymPrefs = store.gymPrefs || {};
  const note = getDayNote(gymPrefs, session);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if(!dayNoteKey(session)) return null;
  const save = ()=>{
    const patch = setDayNote(gymPrefs, session, text);
    if(patch) setStore({ ...store, gymPrefs: { ...gymPrefs, ...patch } });
    setEditing(false);
  };
  if(editing) return (
    <div className="mt-1.5 space-y-1.5" data-testid="day-note-edit">
      <textarea value={text} onChange={e=> setText(e.target.value)} rows={2} maxLength={200} aria-label="Note for this programme day" placeholder="e.g. Use the far cable stack; superset the curls" className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-base" autoFocus />
      <div className="flex gap-1.5">
        <button type="button" onClick={save} className="btn btn-primary min-h-11 rounded-lg px-3 text-xs">Save note</button>
        <button type="button" onClick={()=> setEditing(false)} className="btn btn-ghost min-h-11 rounded-lg px-3 text-xs">Cancel</button>
      </div>
    </div>
  );
  return (
    <button type="button" onClick={()=> { setText(note); setEditing(true); }} data-testid="day-note" className="mt-1 min-h-11 -mx-1 px-1 flex items-start gap-1.5 text-left text-[11px] text-ink2 rounded-lg">
      <span aria-hidden>📝</span>
      <span className={note ? '' : 'text-ink3 underline underline-offset-2'}>{note || 'Add a note for this day'}</span>
    </button>
  );
}

/** Renders safety.js signals verbatim: title, detail and one actionable step.
 *  One card with divided rows; past the first two, the rest are one tap in. */
function SafetyPanelCard({ safety }){
  const rows = [
    ...safety.warnings.map(w => ({ ...w, icon: w.severity === 'stop' ? '🛑' : w.severity === 'caution' ? '⚠️' : 'ℹ️' })),
    ...(safety.deloadPrompt ? [{ id: 'deload', icon: 'ℹ️', ...safety.deloadPrompt }] : []),
    ...(safety.restart ? [{ id: 'restart', icon: '🏃', ...safety.restart }] : []),
  ];
  const urgent = rows.some(r => r.severity === 'stop' || r.severity === 'caution');
  const row = (w) => (
    <li key={w.id} className="px-3 py-2.5 space-y-0.5">
      <p className="text-xs font-bold"><span aria-hidden className="mr-1">{w.icon}</span>{w.title}</p>
      <p className="text-[11px] text-ink2 leading-snug">{w.detail}</p>
      {w.action && <p className="text-[11px] text-ink3"><span className="font-bold text-ink">Try:</span> {w.action}</p>}
    </li>
  );
  return (
    <section aria-label="Training safety" className={`rounded-xl border overflow-hidden ${urgent ? 'border-review/40' : 'border-line'} bg-surface`}>
      <p className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider ${urgent ? 'bg-reviewsoft text-review' : 'bg-surface2 text-ink3'}`}>Training safety · {rows.length}</p>
      <ul className="divide-y divide-line">{rows.slice(0, 2).map(row)}</ul>
      {rows.length > 2 && (
        <details className="border-t border-line">
          <summary className="min-h-11 px-3 flex items-center text-xs font-bold cursor-pointer">{rows.length - 2} more</summary>
          <ul className="divide-y divide-line border-t border-line">{rows.slice(2).map(row)}</ul>
        </details>
      )}
    </section>
  );
}
