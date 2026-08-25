// mesocycle.js — week-level adaptive programming.
//
// The engine advises per set (progression.js) and adaptation reacts per
// completed session (programming.js). What was missing is the layer real
// programming actually runs on: the WEEK. reviewCompletedWeek() rolls up a
// finished ISO week of training and issues explicit, audited directives for
// next week's blocks; applyWeeklyReview() writes them into the schedule with
// full provenance and idempotency.
//
// Directive priority (highest first):
//   1. fatigue deload        — graduated classifier says genuine-deload, or the
//                              legacy deloadReadinessAssessment fires (it is one
//                              input to the classifier and keeps veto power)
//   1b. recovery session     — classifier says recovery-session (one set down,
//                              no volume added)
//   2. mesocycle deload      — the programme's own deload week has arrived
//   3. genuine plateau       — rotate to a kit-compatible variation
//   4. repeated difficulty   — reduce sets one step
//   5. earned progress       — add a set / carry the engine's load-rep advice
//                              (suppressed while the classifier advises any
//                              adjustment below as-planned)
//
// Every directive carries its reason and evidence; nothing silently changes.

import { resolveArisePriors } from './priors.js';
import { PROGRAM_BY_ID, EXERCISE_BY_ID, exerciseAvailable } from './data.js';
import { recommendNext, recommendSets } from './progression.js';
import { rankedSubstitutions } from './substitutions.js';
import { deloadReadinessAssessment } from './sessionQuality.js';
import { classifyReadiness } from './readinessClassifier.js';

function mondayKey(dateISO){
  const d = new Date(`${dateISO}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return null;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}
export function weekOf(dateISO){ return mondayKey(dateISO); }
function addDaysISO(dateISO, days){
  const d = new Date(`${dateISO}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Review ──────────────────────────────────────────────────────────────

// Reviews the most recently COMPLETED scheduled week and returns directives
// for the following week's sessions. Pure: reads only, never mutates.
export function reviewCompletedWeek({ schedule, history = [], readinessLog = [], availableEquipment = null, config = null, todayISO = null } = {}){
  const cfg = resolveArisePriors(config);
  if(!schedule?.sessions?.length) return { ready: false, reason: 'No active schedule.' };
  const todayStr = todayISO || new Date().toISOString().slice(0, 10);
  const program = PROGRAM_BY_ID[schedule.programId];

  const doneIds = new Set((history || []).map(h => h.id));
  const ordered = [...schedule.sessions].sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));

  // Group scheduled sessions by their Monday-start week.
  const byWeek = new Map();
  for(const s of ordered){
    const key = mondayKey(s.dateISO);
    if(!key) continue;
    if(!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(s);
  }

  // The reviewed week = latest week that contains at least one DONE session
  // and no still-pending sessions dated today or earlier.
  const todayKey = mondayKey(todayStr);
  let reviewedWeek = null;
  for(const [key, sessions] of [...byWeek.entries()].sort((a, b)=> a[0].localeCompare(b[0]))){
    const anyDone = sessions.some(s=> doneIds.has(s.id) || s.status === 'done');
    const pendingPast = sessions.some(s=> !(doneIds.has(s.id) || s.status === 'done') && String(s.dateISO) < todayStr);
    if(anyDone && !pendingPast && key <= todayKey) reviewedWeek = { key, sessions };
  }
  if(!reviewedWeek) return { ready: false, reason: 'No completed week to review yet.' };

  // Next week's sessions are the directives' targets.
  const nextKey = addDaysISO(reviewedWeek.key, 7);
  const upcoming = (byWeek.get(nextKey) || []).filter(s => !(doneIds.has(s.id) || s.status === 'done'));
  if(!upcoming.length) return { ready: false, reason: 'No unfinished sessions in the following week to direct.', reviewedWeekKey: reviewedWeek.key };

  const weekHistory = reviewedWeek.sessions
    .map(s => (history || []).find(h => h.id === s.id))
    .filter(Boolean);

  // Signal 1: fatigue deload across the whole week.
  const logs = [];
  for(const h of weekHistory) for(const b of h.blocks || []) for(const s of b.sets || []){
    const reps = Number(String(s.reps).match(/\d+/)?.[0] ?? s.reps) || 0;
    if(reps) logs.push({ reps, weightKg: Number(s.weightKg) || 0, rpe: s.rpe ?? null });
  }
  const volumeByWeekMap = new Map();
  for(const h of history || []){
    const key = mondayKey(h.dateISO);
    let vol = 0;
    for(const b of h.blocks || []) vol += (b.sets || []).length;
    volumeByWeekMap.set(key, (volumeByWeekMap.get(key) || 0) + vol);
  }
  const sortedWeeks = [...volumeByWeekMap.keys()].sort();
  const idx = sortedWeeks.indexOf(reviewedWeek.key);
  const prevVol = idx > 0 ? (volumeByWeekMap.get(sortedWeeks[idx - 1]) || 0) : 0;
  const thisVol = volumeByWeekMap.get(reviewedWeek.key) || 0;
  const weeklyVolumeTrend = prevVol > 0 ? [thisVol / Math.max(1, prevVol)] : [];

  const recentRpes = logs.map(l => l.rpe).filter(r => r != null && String(r).trim() !== '').slice(-cfg.recovery.recentSetWindow);
  // The legacy fatigue verdict stays scoped to the reviewed week, exactly as
  // before — it is now ONE input to the graduated readiness classifier, which
  // adds the longitudinal context (today vs 3-/7-day EMAs, recent RPE,
  // performance trend, session completion, soreness, prior adaptation
  // response) and picks as-planned / small-adjustment / recovery-session /
  // genuine-deload.
  const deload = deloadReadinessAssessment({ logs, recentRpes, weeklyVolumeTrend, readinessHistory: readinessLog, history: weekHistory, config: cfg });
  const readiness = classifyReadiness({
    history, readinessLog, logs, recentRpes, weeklyVolumeTrend,
    schedule, todayISO: todayStr, deloadAssessment: deload, config: cfg,
  });

  // Signal 2: the programme's own mesocycle deload week. A schedule may carry
  // its own mesocycle (adapted/generated plans); otherwise fall back to the
  // programme definition.
  const upcomingWeekNumber = upcoming[0]?.week ?? null;
  const meso = schedule.mesocycle || program?.mesocycle || null;
  const mesoDeloadDue = Boolean(meso?.deloadWeek && upcomingWeekNumber != null && upcomingWeekNumber >= meso.deloadWeek);

  const kit = [...new Set([...(availableEquipment || schedule.availableEquipment || []), 'bodyweight'])];
  // Point-in-time prior history: everything logged before the target week.
  // The engine consumes real set arrays here — planned blocks carry a count,
  // not sets, so schedule data must never feed logsFor().
  const prefix = (history || []).filter(h => String(h.dateISO || '') < String(nextKey));

  const directives = [];
  const seenExercises = new Set();
  for(const session of upcoming){
    for(const block of session.blocks || []){
      const exerciseId = block.exerciseId;
      if(seenExercises.has(exerciseId)) continue; // first occurrence per exercise per review
      seenExercises.add(exerciseId);

      // Tier 1: genuine deload — classifier graduation or the legacy verdict.
      if(readiness.recommendation === 'genuine-deload' || deload.yes || mesoDeloadDue){
        const originalSets = Math.max(1, Number(block.sets) || 1);
        const nextSets = Math.max(1, Math.round(originalSets * cfg.recovery.deloadVolumeCut));
        if(nextSets < originalSets){
          directives.push({
            exerciseId, kind: 'deload',
            sets: nextSets,
            reason: readiness.recommendation === 'genuine-deload' && !deload.yes
              ? `Graduated readiness (${readiness.score} pts, ${readiness.confidence} confidence): ${readiness.reason}`
              : deload.yes
                ? `Fatigue signals (${deload.signals.join('; ')}) — volume cut ~${Math.round((1 - cfg.recovery.deloadVolumeCut) * 100)}%.`
                : `Programmed deload week ${upcomingWeekNumber} — planned volume reduction.`,
            evidence: readiness.recommendation === 'genuine-deload' && !deload.yes
              ? readiness.factors.filter(f => f.points >= 1).map(f => f.label)
              : deload.yes ? deload.signals : [`mesocycle deloadWeek ${meso.deloadWeek}`],
          });
        }
        continue;
      }

      // Tier 1b: recovery session — graduated middle band. One set down, and
      // no volume is added anywhere this week.
      if(readiness.recommendation === 'recovery-session'){
        const originalSets = Math.max(1, Number(block.sets) || 1);
        const nextSets = Math.max(1, Math.round(originalSets * (readiness.volumeScale || 0.75)));
        if(nextSets < originalSets){
          directives.push({
            exerciseId, kind: 'recovery-session',
            sets: nextSets,
            reason: `Recovery session advised (readiness ${readiness.score} pts, ${readiness.confidence} confidence): ${readiness.reason}`,
            evidence: readiness.factors.filter(f => f.points >= 1).map(f => f.label),
          });
        }
        continue;
      }

      const rec = recommendNext({ exerciseId, history: prefix, targetReps: block.reps || undefined, config: cfg });

      // Genuine plateau with a viable variation → rotate.
      const plateaued = rec.plateau?.isPlateau;
      if(plateaued && kit.length){
        const [candidate] = rankedSubstitutions(exerciseId, kit, 1, prefix);
        if(candidate && candidate.id !== exerciseId){
          directives.push({
            exerciseId, kind: 'rotate', toExerciseId: candidate.id,
            reason: `${cfg.progression.plateau.minSessions}+ flat exposures — rotating to ${candidate.name} for a fresh stimulus.`,
            evidence: [rec.reason],
          });
          continue;
        }
      }

      // Repeated difficulty handled at week level: one set down.
      const hardWeeks = weekHistory.filter(h => (h.blocks || []).some(b => b.exerciseId === exerciseId) &&
        (h.blocks || []).some(b => b.exerciseId === exerciseId && (b.sets || []).some(s => Number(s.rpe) >= 9)));
      const originalSets = Math.max(1, Number(block.sets) || 1);
      if(hardWeeks.length >= 2 && originalSets > 1){
        directives.push({
          exerciseId, kind: 'reduce-sets', sets: originalSets - 1,
          reason: 'Two or more near-failure exposures this week — recovering before adding more.',
          evidence: hardWeeks.map(h => `${h.dateISO}: RPE≥9`),
        });
        continue;
      }

      // Earned progress: add a set when the evidence supports it — but never
      // while the graduated classifier advises holding volume back.
      const setDecision = recommendSets(prefix, exerciseId, { targetReps: block.reps || '8–12', maxSets: cfg.progression.sets.defaultMaxSets, config: cfg });
      if(setDecision.add && setDecision.sets > originalSets && readiness.recommendation === 'as-planned'){
        directives.push({
          exerciseId, kind: 'add-sets', sets: setDecision.sets,
          reason: setDecision.reason, evidence: [rec.reason],
        });
        continue;
      }

      // Default: hold structure, carry the engine's load/rep advice as text.
      if(rec.load != null || rec.reps != null){
        directives.push({
          exerciseId, kind: 'hold',
          reason: rec.reason || 'Hold prescription.',
          evidence: [],
        });
      }
    }
  }

  return {
    ready: true,
    reviewedWeekKey: reviewedWeek.key,
    targetWeekKey: nextKey,
    targetWeekNumber: upcomingWeekNumber,
    directives,
    summary: directives.length
      ? directives.map(d => `${EXERCISE_BY_ID[d.exerciseId]?.name || d.exerciseId}: ${d.kind}`).join(' · ')
      : 'No changes needed for next week.',
    deloadDecision: { yes: deload.yes, signals: deload.signals },
    readinessDecision: {
      recommendation: readiness.recommendation,
      score: readiness.score,
      confidence: readiness.confidence,
      factors: readiness.factors.filter(f => f.points >= 1).map(f => f.label),
      guards: readiness.guards,
      action: readiness.action,
    },
    mesoDeloadDue,
  };
}

// ── Application ─────────────────────────────────────────────────────────

// Applies weekly directives to the NEXT week's blocks. Idempotent via
// schedule.lastWeeklyReviewBasis; every touched block gets an audit entry.
export function applyWeeklyReview(schedule, review, { config = null } = {}){
  if(!review?.ready || !schedule?.sessions?.length) return { schedule, changed: false };
  const basisKey = `week:${review.reviewedWeekKey}`;
  if(schedule.lastWeeklyReviewBasis === basisKey) return { schedule, changed: false, alreadyApplied: true };

  const cfg = resolveArisePriors(config);
  const maxChanges = cfg.programming.adaptation.maxChangesPerSave;
  const updatedById = new Map();
  const changes = [];
  outer:
  for(const session of schedule.sessions){
    if(mondayKey(session.dateISO) !== review.targetWeekKey) continue;
    if(doneIdsOf(schedule).has(session.id)) continue;
    for(const [blockIndex, block] of (session.blocks || []).entries()){
      const directive = review.directives.find(d => d.exerciseId === block.exerciseId);
      if(!directive || directive.kind === 'hold') continue;
      if(changes.length >= maxChanges) break outer;

      const current = updatedById.get(session.id) || session;
      let nextBlock = block;
      if(directive.kind === 'rotate'){
        nextBlock = {
          ...block,
          exerciseId: directive.toExerciseId,
          substitutionFrom: block.substitutionFrom || block.exerciseId,
          substitutionReason: directive.reason,
        };
      }else if(directive.kind === 'deload' || directive.kind === 'reduce-sets' || directive.kind === 'add-sets' || directive.kind === 'recovery-session'){
        nextBlock = { ...block, sets: directive.sets };
      }else{
        continue;
      }
      nextBlock = {
        ...nextBlock,
        why: directive.reason,
        adaptation: { kind: `weekly-${directive.kind}`, reason: directive.reason, basisKey },
      };
      updatedById.set(session.id, { ...current, blocks: (current.blocks || []).map((b, i)=> i === blockIndex ? nextBlock : b) });
      changes.push({
        sessionId: session.id, dateISO: session.dateISO,
        exerciseId: block.exerciseId,
        ...(directive.toExerciseId ? { toExerciseId: directive.toExerciseId } : {}),
        kind: `weekly-${directive.kind}`,
        reason: directive.reason,
        evidence: directive.evidence || [],
      });
    }
  }

  if(!changes.length) return { schedule, changed: false, alreadyApplied: true };

  const sessions = schedule.sessions.map(s => updatedById.get(s.id) || s);
  const entry = { basisKey, dateISO: addDaysISO(review.targetWeekKey, 0), decision: { weeklyReview: true }, changes };
  const nextSchedule = {
    ...schedule,
    sessions,
    adaptationHistory: [...(schedule.adaptationHistory || []), entry].slice(-30),
    lastWeeklyReviewBasis: basisKey,
    lastWeeklyReview: entry,
  };
  return { schedule: nextSchedule, changed: true, changes, entry };
}

function doneIdsOf(schedule){
  return new Set((schedule.sessions || []).filter(s => s.status === 'done').map(s => s.id));
}
