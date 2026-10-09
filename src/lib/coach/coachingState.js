// coachingState.js — the Adaptive Coach layer.
//
// Arise's intelligence lives in deterministic engines: progression,
// programming, scheduling, safety, quality, plateau, experiments. Each is
// authoritative for its own domain. This module is the thin orchestration
// layer ABOVE them: it consumes their outputs and produces one structured,
// user-facing training state so the UI never has to re-derive the coaching
// decision itself.
//
// Rules this layer lives by:
//   - Deterministic engines remain authoritative. Nothing here invents a
//     prescription; every recommendation carries the engine output that made
//     it, verbatim, plus a `source` naming the function it came from.
//   - Every claim is traceable: each item exposes { source, evidence,
//     confidence } so the UI can progressively disclose the working.
//   - Pure and offline: no network, no storage writes, no randomness, no
//     clock reads beyond the `today` argument (defaults to isoToday()).
//   - Cheap enough to run on every Today render: it recomputes exactly what
//     TodayView used to memoise itself — no duplicate analytics.
//
// Output shape (stable contract for the UI):
//   {
//     summary, currentState, changes, recommendations, focus, evidence,
//     confidence, risks, nextSession, nextWeek, learnings, postWorkout,
//     programmeWhy, nextBestAction,
//   }

import { PROGRAM_BY_ID, GOALS } from '../data.js';
import { sessionForToday, nextSession, progress } from '../schedule.js';
import {
  blockDurationMinutes,
  isoToday,
  missedWorkoutRecovery,
  plateauDetection,
  programAdherence,
  progressionExplanation,
} from '../programming.js';
import { weekPhaseFor } from '../mesocycle.js';
import { safetyPanel } from '../safety.js';
import {
  nextBestAction,
  trainingAgeDisplay,
  typicalDurationFor,
  whatChangedSummary,
} from '../product.js';

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

function weakest(confidences){
  const usable = confidences.filter(c => CONFIDENCE_RANK[c] != null);
  if(!usable.length) return null;
  return usable.reduce((a, b) => CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b);
}

function goalLabel(goalId){
  return GOALS.find(g => g.id === goalId)?.label || null;
}

function daysBetween(fromISO, toISO){
  const a = Date.parse(`${String(fromISO).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toISO).slice(0, 10)}T00:00:00Z`);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Expected outcome of a progression decision — phrased only from fields the
 * engine actually returned. When the engine withheld a next value (hold,
 * plateau guard, insufficient evidence) this returns null so the UI shows the
 * rule instead of a fabricated expectation.
 */
function expectedOutcomeOf(exp){
  const rec = exp || {};
  if(rec.reps != null && rec.load != null && Number.isFinite(Number(rec.load))){
    return `Next exposure the engine expects ${rec.reps} reps at ${Number(rec.load)} kg — earned when the current range is full.`;
  }
  if(rec.reps != null){
    return `Next exposure the engine expects ${rec.reps} reps at the same load.`;
  }
  if(rec.assistKg != null){
    return `Next exposure: ${rec.assistKg} kg less assistance once the range is complete.`;
  }
  if(rec.suggestWeighted){
    return 'Next exposure: a harder variation once the top of the range is repeatable.';
  }
  return null; // hold / plateau / insufficient evidence — the rule says why.
}

/** Structured expert inputs: exactly what the engine consumed, labelled. */
function expertInputsFor(exp, block){
  const inputs = [];
  if(block) inputs.push({ label: 'Planned', value: `${block.sets} × ${block.reps}${block.loadHint ? ` @ ${block.loadHint}` : ''}` });
  inputs.push({ label: 'Target range', value: String(exp.targetReps ?? '—') });
  if(exp.personalised) inputs.push({ label: 'Observed rate', value: `${Math.round((exp.personalised.weeklyLoadPct || 0) * 1000) / 10}% load/week over ${exp.personalised.n} sets` });
  if(exp.plateLoad) inputs.push({ label: 'Plate check', value: `${exp.plateLoad.loadKg} kg (${exp.plateLoad.exact ? 'exact' : exp.plateLoad.direction})` });
  if(exp.trainingAge) inputs.push({ label: 'Training age', value: exp.trainingAge.phase || 'unknown' });
  if(exp.trainingBreak?.hasBreak) inputs.push({ label: 'Break', value: `${exp.trainingBreak.daysSinceLast} days since last exposure` });
  return inputs;
}

/**
 * Build the coaching state for "now".
 *
 * @param store      the canonical store (history, activeSchedule, readinessLog,
 *                   onboarding, preferences, experiments).
 * @param today      ISO date to evaluate against (defaults to isoToday()).
 * @param plateConfig onboarding plate config, passed to the progression engine.
 */
export function buildCoachingState({ store = {}, today = null, plateConfig = null } = {}){
  const now = today || isoToday();
  const history = store.history || [];
  const sched = store.activeSchedule || null;
  const prog = sched ? PROGRAM_BY_ID[sched.programId] : null;
  const todaySession = sessionForToday(sched);
  const upcoming = nextSession(sched);
  const hero = todaySession || upcoming || null;
  const progProgress = progress(sched, history);

  // ── Engines, called once each (these are Today's former memoised calls) ──
  const adherence = programAdherence(sched, history, { today: now });
  const recovery = missedWorkoutRecovery(sched, history, { today: now });
  const safety = safetyPanel(history, store.readinessLog || [], {
    today: now,
    cautious: store.preferences?.cautiousMode === true,
  });
  const weekPhase = weekPhaseFor(sched, now);
  const trainingAge = trainingAgeDisplay(history, { today: now });
  const typical = hero ? typicalDurationFor({ history, title: hero.title }) : null;
  const adaptationSummaries = whatChangedSummary({ schedule: sched, history });
  const nba = nextBestAction({ store, today: now, todaySession, nextSess: upcoming, recovery });

  // ── Today's prescriptions: the progression engine's own explanations ──
  const prescriptions = hero
    ? hero.blocks.map((block, index) => {
        const explanation = progressionExplanation({
          exerciseId: block.exerciseId,
          targetReps: block.reps,
          asOfDateISO: hero.dateISO,
          history,
          plateConfig,
          block,
        });
        return { block, index, explanation };
      })
    : [];

  // ── Recommendations: engine outputs, one object per user-facing decision ──
  const recommendations = [];

  for(const { block, explanation } of prescriptions){
    recommendations.push({
      id: `rx:${block.exerciseId}`,
      kind: 'prescription',
      exerciseId: block.exerciseId,
      action: `${explanation.exerciseName} — ${block.sets}×${block.reps}${block.loadHint ? ` @ ${block.loadHint}` : ''}`,
      reason: explanation.summary,
      confidence: explanation.confidence,
      previousState: explanation.evidence?.[0] || null,
      expectedOutcome: expectedOutcomeOf(explanation),
      evidence: explanation.evidence || [],
      rule: explanation.rule,
      expert: {
        inputs: expertInputsFor(explanation, block),
        policy: explanation.rule,
        source: 'programming.transparentProgressionDecision → progression.recommendNext',
      },
      adapted: explanation.adapted?.length ? explanation.adapted : null,
      // Cold-start honesty (P2.12): when no personalised signal curve exists
      // yet, the decision came from deterministic priors — labelled so the UI
      // can say "initial estimate" instead of implying personal calibration.
      basis: explanation.personalised ? 'personalised' : 'initial',
      asOf: hero?.dateISO || now,
    });
  }

  if(recovery.needed){
    recommendations.push({
      id: 'recovery',
      kind: 'recovery',
      action: recovery.recommendation || 'Choose how to move the overdue sessions forward.',
      reason: recovery.missedSessions.length === 1
        ? `“${recovery.missedSessions[0].title}” is overdue.`
        : `${recovery.missedSessions.length} sessions are overdue.`,
      confidence: 'high',
      previousState: null,
      expectedOutcome: 'The schedule folds forward in order — nothing doubles up and nothing is made up with a brutal session.',
      evidence: recovery.missedSessions.map(s => `${s.dateISO || 'undated'} · ${s.title}`),
      rule: 'Missed sessions are data, not debt. The user chooses: do today, replan, or skip.',
      expert: {
        inputs: [{ label: 'Overdue sessions', value: String(recovery.missedSessions.length) }],
        policy: 'programming.missedWorkoutRecovery',
        source: 'programming.missedWorkoutRecovery',
      },
    });
  }

  // Plateau signals on today's lifts — only when the attribution engine says
  // a plateau is genuine (never a single bad session).
  for(const { block, explanation } of prescriptions){
    if(explanation.plateau?.isPlateau) continue; // already carried in the rx rule
    const plateau = plateauDetection(history, block.exerciseId, { readinessLog: store.readinessLog || [] });
    if(plateau.detected && plateau.attribution?.kind === 'genuine'){
      recommendations.push({
        id: `plateau:${block.exerciseId}`,
        kind: 'plateau',
        exerciseId: block.exerciseId,
        action: plateau.reason || `Hold the current prescription on ${explanation.exerciseName}.`,
        reason: `Plateau attribution says this is a genuine plateau, not a bad day (${plateau.n} sessions examined).`,
        confidence: plateau.confidence,
        previousState: null,
        expectedOutcome: 'Load holds while recovery, volume and technique are checked; progression resumes when the signal clears.',
        evidence: [plateau.reason || 'genuine plateau across the recent window'].filter(Boolean),
        rule: 'Plateau guard: hold and investigate before adding load.',
        expert: {
          inputs: [
            { label: 'Sessions in window', value: String(plateau.n) },
            { label: 'Attribution', value: plateau.attribution?.kind || '—' },
          ],
          policy: 'plateau attribution (sessionQuality.plateauAttribution)',
          source: 'programming.plateauDetection',
        },
      });
    }
  }

  // ── Today's focus (P1.1): at most two at-a-glance cues chosen from the SAME
  //    prescription explanations the Why section shows — pure prioritisation,
  //    never a second decision system. Guards first (they change what you do);
  //    otherwise the clearest success condition on today's working lifts. ──
  const focus = [];
  const plateauRecIds = new Set(recommendations.filter(r => r.kind === 'plateau').map(r => r.exerciseId));
  for(const { block, explanation } of prescriptions){
    if(focus.length >= 2) break;
    if(block.kind === 'warmup') continue;
    const name = explanation.exerciseName;
    const ownRule = explanation.rule || '';
    const isReturn = /Return-after-break/.test(ownRule);
    if(/guard:/.test(ownRule) || isReturn){
      focus.push({
        id: `focus:${block.exerciseId}`,
        kind: 'guard',
        title: isReturn ? `Ease back into ${name}` : `Hold ${name}`,
        detail: ownRule,
        source: 'programming.transparentProgressionDecision',
      });
    } else if(plateauRecIds.has(block.exerciseId)){
      // A genuine plateau was detected separately from the prescription rule —
      // quote the plateau recommendation's own words, not the rx rule.
      const plateauRec = recommendations.find(r => r.kind === 'plateau' && r.exerciseId === block.exerciseId);
      focus.push({
        id: `focus:${block.exerciseId}`,
        kind: 'guard',
        title: `Hold ${name}`,
        detail: plateauRec?.rule || plateauRec?.action || explanation.rule,
        source: 'programming.plateauDetection',
      });
    }
  }
  if(!focus.length && !recovery.needed){
    const target = prescriptions.find(({ block, explanation }) =>
      block.kind !== 'warmup' && expectedOutcomeOf(explanation)
    );
    if(target){
      focus.push({
        id: `focus:${target.block.exerciseId}:target`,
        kind: 'target',
        title: `${target.explanation.exerciseName} — today’s target`,
        detail: expectedOutcomeOf(target.explanation),
        source: 'programming.transparentProgressionDecision',
      });
    }
  }

  // ── What's different ──
  const changes = [];
  for(const group of adaptationSummaries){
    for(const line of group.lines || []){
      changes.push({
        id: `change:${changes.length}`,
        kind: group.kind,
        title: null,
        detail: line,
        confidence: null,
        when: group.when || null,
        source: 'product.whatChangedSummary',
      });
    }
  }
  for(const { block, explanation } of prescriptions){
    for(const trail of explanation.adapted || []){
      changes.push({
        id: `block:${block.exerciseId}:${trail.kind}`,
        kind: 'block',
        title: explanation.exerciseName,
        detail: trail.summary || trail.reason || 'Adjusted from your training.',
        confidence: null,
        when: trail.when || null,
        source: 'programming.buildAdaptationTrail',
      });
    }
  }
  if(recovery.needed){
    changes.push({
      id: 'change:recovery',
      kind: 'recovery',
      title: null,
      detail: recovery.missedSessions.length === 1
        ? `“${recovery.missedSessions[0].title}” is overdue — choose how to move on.`
        : `${recovery.missedSessions.length} sessions are overdue — choose how to move on.`,
      confidence: null,
      when: null,
      source: 'programming.missedWorkoutRecovery',
    });
  }
  if(weekPhase?.kind === 'deload' || weekPhase?.kind === 'recovery'){
    changes.push({
      id: `change:${weekPhase.kind}-week`,
      kind: 'week-phase',
      title: null,
      detail: weekPhase.kind === 'deload'
        ? 'This is a deload week — prescriptions were cut on purpose.'
        : 'This is a recovery week — prescriptions are deliberately lighter.',
      confidence: 'high',
      when: null,
      source: 'mesocycle.weekPhaseFor',
    });
  }

  // ── Learnings: concluded experiments (the user's own A/B evidence) ──
  const learnings = (store.experiments || [])
    .filter(e => e?.id && !e.deletedAt && e.status === 'completed')
    .slice(0, 3)
    .map(e => ({
      id: `learn:${e.id}`,
      question: e.question || e.name || 'Training experiment',
      result: e.result || 'inconclusive',
      confidence: e.confidence || 'low',
      detail: e.conclusionNote || null,
      source: 'trainingExperiments.evaluateExperiment',
    }));

  // ── Risks: safety signals verbatim ──
  const risks = [
    ...safety.warnings.map(w => ({
      id: w.id, severity: w.severity, title: w.title, detail: w.detail,
      action: w.action || null, exerciseId: w.exerciseId || null, source: 'safety.safetyPanel',
    })),
    ...(safety.deloadPrompt ? [{
      id: 'deload-prompt', severity: 'info', title: safety.deloadPrompt.title,
      detail: safety.deloadPrompt.detail, action: safety.deloadPrompt.action || null,
      exerciseId: null, source: 'safety.safetyPanel',
    }] : []),
    ...(safety.restart ? [{
      id: 'restart', severity: 'info', title: safety.restart.title,
      detail: safety.restart.detail, action: safety.restart.action || null,
      exerciseId: null, source: 'safety.safetyPanel',
    }] : []),
  ];

  // ── Current state ──
  const readinessLogs = (store.readinessLog || []).filter(r => r?.dateISO);
  const latestReadiness = readinessLogs.length ? readinessLogs[readinessLogs.length - 1] : null;
  const readiness = latestReadiness ? {
    score: latestReadiness.score,
    dateISO: latestReadiness.dateISO,
    daysAgo: daysBetween(latestReadiness.dateISO, now),
  } : null;

  const phase = !sched
    ? 'no-programme'
    : progProgress.pct >= 100
      ? 'programme-complete'
      : todaySession
        ? 'session-due'
        : 'rest-day';

  const currentState = {
    phase,
    weekPhase,
    trainingAge,
    adherence: {
      due: adherence.due,
      missed: adherence.missed,
      upcoming: adherence.upcoming,
      rate: adherence.toDateRate,
    },
    readiness,
    programme: sched ? {
      programId: sched.programId,
      name: prog?.name || sched.programId,
      tagline: prog?.tagline || '',
      startedAt: sched.startDateISO || null,
      progress: progProgress,
    } : null,
    sessionCount: history.length,
  };

  // ── Next session ──
  const objective = weekPhase?.kind === 'deload'
    ? 'Deload — recover so the next block lands'
    : weekPhase?.kind === 'recovery'
      ? 'Recovery — lighter prescriptions on purpose'
      : goalLabel(store.onboarding?.goal) || prog?.tagline || 'Follow the plan';

  const nextSessionState = hero ? {
    session: hero,
    title: hero.title,
    dateISO: hero.dateISO,
    isToday: !!todaySession,
    estimatedDurationMin: Math.max(1, Math.ceil(
      (hero.estimatedDurationMin != null
        ? hero.estimatedDurationMin
        : hero.blocks.reduce((sum, b) => sum + blockDurationMinutes(b, null), 0))
    )),
    typicalDuration: typical,
    objective,
    keyBlocks: hero.blocks.slice(0, 4).map(b => ({
      exerciseId: b.exerciseId,
      sets: b.sets,
      reps: b.reps,
      loadHint: b.loadHint || '',
    })),
    blockCount: hero.blocks.length,
    prescriptions,
  } : null;

  // ── Next week (surface facts only — the deep weekly review lives in
  //    mesocycle.reviewCompletedWeek / WeeklyReviewCard and is NOT recomputed
  //    here to avoid duplicate expensive analytics) ──
  const nextWeek = {
    phase: weekPhase,
    upcoming: (sched?.sessions || [])
      .filter(s => s.status !== 'done')
      .slice(0, 3)
      .map(s => ({ title: s.title, dateISO: s.dateISO, week: s.week ?? null })),
    latestAdaptation: adaptationSummaries[0] || null,
    directives: (sched?.lastAdaptation?.changes || []).slice(0, 3),
  };

  // ── What happens after the workout (honest description of real pipelines) ──
  const postWorkout = [
    { label: 'Target vs plan', detail: 'Every set is compared against the prescription — met, beaten, or missed.', source: 'workoutQualityReport' },
    { label: 'Effort and recovery', detail: 'RPE, failed reps, notes and readiness decide how hard the session really was.', source: 'sessionQuality.sessionQuality' },
    { label: 'Next prescriptions', detail: 'The result feeds the next exposure’s progression decision — add load, add reps, or hold.', source: 'progression.recommendNext' },
    { label: 'Programme adaptation', detail: 'Repeated signals can adjust the schedule itself, with the reason stamped on the change.', source: 'programming.adaptActiveSchedule' },
  ];

  // ── Why this programme exists (first-run auto-start only) ──
  const firstPlan = store.onboarding?.firstPlan || null;
  const programmeWhy = firstPlan && (!sched || firstPlan.programId === sched.programId)
    ? firstPlan
    : null;

  // ── Overall confidence: the weakest prescription (honest floor) ──
  const confidence = weakest(recommendations.filter(r => r.kind === 'prescription').map(r => r.confidence));

  // ── One-line summary: what the user needs to know at a glance ──
  const summaryParts = [];
  if(!sched) summaryParts.push('No programme yet — pick one in Train and Today always knows what’s next.');
  else if(phase === 'programme-complete') summaryParts.push('Programme complete — choose what’s next in Train.');
  else if(hero){
    summaryParts.push(`${todaySession ? 'Today' : 'Up next'}: ${hero.title}, about ${nextSessionState.estimatedDurationMin} min.`);
    const adaptedCount = prescriptions.filter(p => p.explanation.adapted?.length).length;
    if(adaptedCount) summaryParts.push(`${adaptedCount} lift${adaptedCount === 1 ? '' : 's'} adjusted from your training.`);
    if(recovery.needed) summaryParts.push(`${recovery.missedSessions.length} session${recovery.missedSessions.length === 1 ? '' : 's'} overdue.`);
  } else summaryParts.push('Nothing scheduled — your programme has no remaining sessions.');

  return {
    summary: summaryParts.join(' '),
    currentState,
    changes,
    recommendations,
    evidence: recommendations.flatMap(r => (r.evidence || []).map(line => ({ claim: line, source: r.expert?.source || r.kind, confidence: r.confidence }))),
    confidence,
    risks,
    nextSession: nextSessionState,
    nextWeek,
    focus,
    learnings,
    postWorkout,
    programmeWhy,
    nextBestAction: nba,
    recovery,
    adherence,
    safety,
  };
}
