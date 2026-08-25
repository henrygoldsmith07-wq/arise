// programming.js — the user-facing programming layer.
//
// The lower-level progression, scheduling and quality modules are deliberately
// small. This module composes them into decisions the UI can explain and the
// user can act on: what changed, why it changed, and what to do after a missed
// session or a change in available equipment.

import { EXERCISE_BY_ID, exerciseAvailable } from './data.js';
import { rankedSubstitutions } from './substitutions.js';
import { applyEquipmentSubstitutions } from './templates.js';
import {
  e1rm,
  recommendSets,
  recommendNext,
  strengthTrendWithConfidence,
  trainingAgeInfo,
  isPlateauV2,
  validateProgression,
} from './progression.js';
import { plateauAttribution, deloadReadinessAssessment } from './sessionQuality.js';
import { weeklyVolume, deloadOutcomes, recommendationFollowThrough } from './analytics.js';
import { resolveArisePriors } from './priors.js';
import { backtestHistory } from './backtesting.js';

const DAY_MS = 86400000;

export function isoToday(){
  return toISO(new Date());
}

function dateAt(iso){
  return new Date(`${iso}T00:00:00Z`);
}

function toISO(date){
  const pad = value=> String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
}

function addDays(iso, days){
  const date = dateAt(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

function parseReps(value){
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function parseTimeMinutes(value){
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)\s*min/i);
  return match ? Number(match[1]) : null;
}

function numeric(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sessionDateSort(a, b){
  return String(a.dateISO || '').localeCompare(String(b.dateISO || ''));
}

function isDone(session, historyIds){
  return session.status === 'done' || historyIds.has(session.id);
}

function bestSet(block){
  let best = null;
  for(const set of block?.sets || []){
    const reps = parseReps(set.reps);
    const weightKg = numeric(set.weightKg);
    const assistedKg = numeric(set.assistedKg);
    const score = e1rm(weightKg, reps) || reps;
    if(reps > 0 && (!best || score > best.score)) best = { reps, weightKg, assistedKg, rpe: set.rpe ?? null, score };
  }
  return best;
}

function exerciseLogs(history, exerciseId){
  const logs = [];
  for(const session of history || []){
    for(const block of session.blocks || []){
      if(block.exerciseId !== exerciseId) continue;
      const best = bestSet(block);
      if(best) logs.push({ ...best, dateISO: session.dateISO, sessionId: session.id, title: session.title, programId: session.programId });
    }
  }
  return logs.sort((a, b)=> String(a.dateISO || '').localeCompare(String(b.dateISO || '')));
}

// A machine-readable explanation for every next-load decision. The UI can
// show this without exposing implementation details or inventing a reason.
export function transparentProgressionDecision({ exerciseId, history = [], targetReps = '8–12', recommendation = null, config = null, asOfDateISO = null, calibration = null, plateConfig = null } = {}){
  // plateConfig is safe to pass for every equipment type: the engine's plate
  // dispatcher rounds barbells via plates and dumbbells/machines via their own
  // achievable increments, so non-barbell users get loadable targets too.
  const rec = recommendation || recommendNext({ exerciseId, history, targetReps, config, asOfDateISO, calibration, plateConfig });
  const logs = exerciseLogs(history, exerciseId);
  const last = logs[logs.length - 1] || null;
  const ex = EXERCISE_BY_ID[exerciseId];
  const age = rec.trainingAge || trainingAgeInfo(history, { asOfDateISO, config });
  const evidence = [];
  if(last){
    evidence.push(`Last best logged set: ${last.weightKg > 0 ? `${last.weightKg}kg × ` : ''}${last.reps} reps${last.rpe != null && String(last.rpe).trim() ? ` at RPE ${last.rpe}` : ''}.`);
  } else {
    evidence.push('No prior logged set for this exercise.');
  }
  evidence.push(`${logs.length} exercise session${logs.length === 1 ? '' : 's'} inform this decision.`);
  if(rec.trainingBreak?.hasBreak) evidence.push(`The last logged exposure was ${rec.trainingBreak.daysSinceLast} days ago, so the return target is deliberately reduced.`);
  if(rec.noisy && rec.noisy.length) evidence.push(`Last session had noisy context (${rec.noisy.join(', ')}) — holding load requires a clean exposure before progressing.`);
  if(history.length && history[history.length-1]?.durationMinutes != null) evidence.push(`Last session duration was ${history[history.length-1].durationMinutes}min; short or interrupted sessions are treated conservatively.`);
  if(history.length && history[history.length-1]?.equipmentSnapshot) evidence.push(`Last session used kit: ${history[history.length-1].equipmentSnapshot.join(', ')}; kit changes adjust substitution evidence.`);
  if(history.length && Number(history[history.length-1]?.skippedSetsCount)) evidence.push(`${history[history.length-1].skippedSetsCount} skipped/failed sets in last session — incomplete exposures do not count as evidence to progress.`);
  if(history.length && history[history.length-1]?.painDiscomfort) evidence.push('Pain/discomfort was flagged last session — hold load and check form before progressing.');
  if(history.length && history[history.length-1]?.exerciseOrder) evidence.push(`Exercise order last time: ${history[history.length-1].exerciseOrder.slice(0,4).join(' → ')}; order changes affect fatigue and are noted.`);
  if(rec.plateLoad && !rec.plateLoad.exact) evidence.push(`The selected plate setup makes ${rec.plateLoad.loadKg}kg achievable instead of the raw ${rec.plateLoad.targetKg}kg target (${rec.plateLoad.direction}); target is always physically achievable.`);
  if(rec.plateLoad && rec.plateLoad.exact) evidence.push(`Plate check: ${rec.plateLoad.loadKg}kg is exactly buildable with your ${rec.plateEquipment || 'available'} kit.`);
  if(rec.personalised) evidence.push(`Your observed rate is ${Math.round(rec.personalised.weeklyLoadPct * 1000) / 10}% load per week across ${rec.personalised.n} logged sets.`);
  if(age.phase !== 'unknown') evidence.push(`Training age is treated as ${age.phase}; the default rate is scaled accordingly.`);

  let rule = 'Use the programme prescription until enough evidence is logged.';
  if(rec.trainingBreak?.hasBreak) rule = 'Return-after-break rule: restart below the last logged load, then rebuild only after the first session is comfortable.';
  else if(rec.noisy && rec.noisy.length) rule = 'Noisy-session guard: hold the current prescription until a clean session without pain, missed sets, or unusual performance confirms readiness.';
  else if(rec.plateau?.isPlateau || /plateau/i.test(rec.reason || '')) rule = 'Plateau guard: hold the current prescription and recover or vary the movement before adding load.';
  else if(/Hold load because/.test(rec.reason||'')) rule = 'Conservatism guard: insufficient evidence or unstable recent performance — hold load and collect another observation.';
  else if(rec.assistKg != null) rule = 'Assistance rule: add reps through the range, then reduce assistance in a small step.';
  else if(rec.suggestWeighted) rule = 'Bodyweight rule: after the top of the rep range, use a harder variation or add load if the movement supports it.';
  else if(rec.reps != null && rec.load != null) rule = 'Double-progression rule: build reps within the target range, then add a small load step and reset to the lower bound.';
  else if(rec.reps != null) rule = 'Reps-first rule: add one controlled rep while the target range is not full.';

  const confidenceCfg = resolveArisePriors(config).progression.confidence;
  const confidence = logs.length >= confidenceCfg.highSessions ? 'high' : logs.length >= confidenceCfg.mediumSessions ? 'medium' : 'low';
  const name = ex?.name || exerciseId || 'this exercise';
  return {
    ...rec,
    exerciseId,
    exerciseName: name,
    targetReps,
    evidence,
    rule,
    confidence,
    summary: `${name}: ${rec.reason || 'follow the programme prescription.'}`,
  };
}

export const progressionExplanation = transparentProgressionDecision;

// One row per completed exposure to an exercise. This is intentionally
// session-level rather than set-level so the history is readable and trends do
// not overweight sessions with more sets.
export function exerciseHistory(history = [], exerciseId){
  const rows = [];
  for(const session of history){
    const blocks = (session.blocks || []).filter(block=> block.exerciseId === exerciseId);
    if(!blocks.length) continue;
    const sets = blocks.flatMap(block=> block.sets || []);
    const best = blocks.map(bestSet).filter(Boolean).sort((a, b)=> b.score - a.score)[0] || null;
    const volumeKg = sets.reduce((total, set)=> total + parseReps(set.reps) * Math.max(0, numeric(set.weightKg) - numeric(set.assistedKg)), 0);
    rows.push({
      sessionId: session.id,
      dateISO: session.dateISO,
      title: session.title,
      programId: session.programId,
      week: session.week,
      day: session.day,
      sets: sets.length,
      volumeKg: Math.round(volumeKg),
      best: best ? { reps: best.reps, weightKg: best.weightKg, assistedKg: best.assistedKg, rpe: best.rpe, e1rm: Math.round(best.score * 10) / 10 } : null,
    });
  }
  return rows.sort((a, b)=> String(a.dateISO || '').localeCompare(String(b.dateISO || '')));
}

export function exerciseHistorySummary(history = [], exerciseId){
  const rows = exerciseHistory(history, exerciseId);
  const logs = exerciseLogs(history, exerciseId);
  const trend = strengthTrendWithConfidence(logs);
  return {
    exerciseId,
    sessions: rows.length,
    rows,
    last: rows[rows.length - 1] || null,
    best: rows.flatMap(row=> row.best ? [{ ...row.best, dateISO: row.dateISO }] : []).sort((a, b)=> b.e1rm - a.e1rm)[0] || null,
    trend,
    recommendation: transparentProgressionDecision({ exerciseId, history }),
  };
}

// Plateau detection with attribution. A flat line after consistently good
// sessions is treated differently from a flat line caused by fatigue or noise.
export function plateauDetection(history = [], exerciseId, { readinessLog = [], window = null, config = null } = {}){
  const plateauWindow = window == null ? resolveArisePriors(config).sessionQuality.plateau.window : window;
  const attribution = plateauAttribution(history, exerciseId, { readinessLog, window, config });
  const logs = exerciseLogs(history, exerciseId).slice(-plateauWindow);
  const v2 = isPlateauV2(logs, { config });
  const detected = attribution.kind === 'genuine' || (v2.isPlateau && attribution.kind !== 'bad-sessions');
  const status = detected ? 'plateau' : attribution.kind === 'bad-sessions' ? 'fatigue' : attribution.kind;
  const confidence = attribution.kind === 'genuine' ? 'high' : attribution.kind === 'insufficient' ? 'low' : 'medium';
  return {
    exerciseId,
    detected,
    status,
    confidence,
    n: logs.length,
    attribution,
    plateau: v2,
    reason: detected ? attribution.reason : attribution.reason || v2.reason,
  };
}

export function programAdherence(schedule, history = [], { today = isoToday() } = {}){
  const historyIds = new Set(history.map(session=> session.id));
  const sessions = (schedule?.sessions || []).slice().sort(sessionDateSort).map(session=> {
    const completed = isDone(session, historyIds);
    const missed = !completed && session.dateISO < today;
    const due = !completed && session.dateISO <= today;
    return { session, completed, missed, due, upcoming: !completed && session.dateISO > today };
  });
  const dueSessions = sessions.filter(row=> row.due);
  const missedSessions = sessions.filter(row=> row.missed);
  const completedSessions = sessions.filter(row=> row.completed);
  const plannedToDate = sessions.filter(row=> row.session.dateISO <= today);
  const byWeek = new Map();
  for(const row of sessions){
    const key = row.session.week ?? '—';
    const current = byWeek.get(key) || { week: key, total: 0, done: 0, missed: 0 };
    current.total += 1;
    if(row.completed) current.done += 1;
    if(row.missed) current.missed += 1;
    byWeek.set(key, current);
  }
  return {
    total: sessions.length,
    completed: completedSessions.length,
    due: dueSessions.length,
    missed: missedSessions.length,
    upcoming: sessions.filter(row=> row.upcoming).length,
    rate: sessions.length ? Math.round(completedSessions.length / sessions.length * 100) / 100 : null,
    toDateRate: plannedToDate.length ? Math.round(plannedToDate.filter(row=> row.completed).length / plannedToDate.length * 100) / 100 : null,
    sessions,
    byWeek: [...byWeek.values()],
  };
}

export function missedWorkoutRecovery(schedule, history = [], { today = isoToday() } = {}){
  const adherence = programAdherence(schedule, history, { today });
  const missedSessions = adherence.sessions.filter(row=> row.missed).map(row=> row.session);
  if(!missedSessions.length){
    return { needed: false, adherence, missedSessions: [], recommendation: 'No missed sessions — keep the next planned session.' };
  }
  const oldest = missedSessions[0];
  const recommendation = missedSessions.length === 1
    ? `Recover ${oldest.title} next, then continue the programme order. Do not double the next workout.`
    : `${missedSessions.length} sessions are overdue. Re-plan them in order and keep at least one recovery day between sessions.`;
  return {
    needed: true,
    adherence,
    missedSessions,
    recommendation,
    options: ['replan', 'skip'],
  };
}

function scheduleSpacing(schedule, config = null){
  const defaultSpacingDays = resolveArisePriors(config).programming.defaultSpacingDays;
  const dates = (schedule?.sessions || []).map(session=> Date.parse(`${session.dateISO}T00:00:00`)).filter(Number.isFinite).sort((a, b)=> a - b);
  const gaps = [];
  for(let i = 1; i < dates.length; i++){
    const days = Math.round((dates[i] - dates[i - 1]) / DAY_MS);
    if(days > 0) gaps.push(days);
  }
  if(!gaps.length) return defaultSpacingDays;
  const sorted = gaps.sort((a, b)=> a - b);
  return Math.max(1, sorted[Math.floor(sorted.length / 2)] || defaultSpacingDays);
}

// Shift unfinished sessions forward as a sequence. Completed sessions keep
// their original IDs and dates, so history remains attached to the right work.
export function replanSchedule(schedule, history = [], { today = isoToday(), spacingDays = null, config = null } = {}){
  if(!schedule?.sessions?.length) return { schedule, changed: false, moved: [], reason: 'No active schedule.' };
  const historyIds = new Set(history.map(session=> session.id));
  const original = schedule.sessions.slice().sort(sessionDateSort);
  const pending = original.filter(session=> !isDone(session, historyIds));
  const missed = pending.filter(session=> session.dateISO < today);
  if(!missed.length) return { schedule, changed: false, moved: [], reason: 'No overdue sessions to re-plan.' };
  const step = Math.max(1, Number(spacingDays) || scheduleSpacing(schedule, config));
  let cursor = today;
  const moved = [];
  const pendingById = new Map();
  for(const session of pending){
    const nextDate = cursor;
    if(nextDate !== session.dateISO) moved.push({ id: session.id, title: session.title, from: session.dateISO, to: nextDate });
    pendingById.set(session.id, { ...session, dateISO: nextDate, status: 'planned', rescheduledFrom: session.dateISO === nextDate ? session.rescheduledFrom : session.dateISO });
    cursor = addDays(cursor, step);
  }
  const nextSessions = original.map(session=> pendingById.get(session.id) || session).sort(sessionDateSort);
  return {
    schedule: { ...schedule, sessions: nextSessions, lastReplannedISO: today, replannedAt: new Date(`${today}T00:00:00`).toISOString() },
    changed: moved.length > 0,
    moved,
    spacingDays: step,
    reason: moved.length ? `Moved ${moved.length} unfinished session${moved.length === 1 ? '' : 's'} forward in programme order.` : 'No dates changed.',
  };
}

export function blockDurationMinutes(block, config = null){
  const cfg = resolveArisePriors(config).programming.shortWorkout;
  const timed = parseTimeMinutes(block.reps);
  if(timed != null) return Math.max(cfg.minimumBlockMinutes, timed);
  const sets = Math.max(1, numeric(block.sets));
  const rest = Math.max(0, numeric(block.restSec)) / 60;
  return sets * cfg.minutesPerSet + Math.max(0, sets - 1) * rest;
}

function blockPriority(block, index, config = null){
  const cfg = resolveArisePriors(config).programming.shortWorkout;
  const ex = EXERCISE_BY_ID[block.exerciseId];
  const muscle = ex?.muscle || '';
  const compound = ['Legs', 'Back', 'Chest', 'Glutes', 'Full body'].includes(muscle);
  const cardio = muscle === 'Cardio';
  return (compound ? cfg.compoundPriority : cardio ? cfg.cardioPriority : cfg.isolationPriority) + (index === 0 ? cfg.firstBlockBonus : 0);
}

function shortenBlock(block, ratio, targetMinutes, config = null){
  const cfg = resolveArisePriors(config).programming.shortWorkout;
  const timed = parseTimeMinutes(block.reps);
  if(timed != null){
    const minutes = Math.max(cfg.timedBlockMinimumMinutes, Math.min(timed, Math.round(timed * ratio), targetMinutes));
    return { ...block, reps: `${minutes} min`, shortOriginalReps: block.reps };
  }
  const originalSets = Math.max(1, numeric(block.sets));
  const sets = Math.max(1, Math.min(originalSets, Math.ceil(originalSets * ratio)));
  return { ...block, sets, shortOriginalSets: originalSets };
}

export function shortWorkoutMode(session, { minutes = null, config = null } = {}){
  const cfg = resolveArisePriors(config).programming.shortWorkout;
  if(!session?.blocks?.length) return { session, changed: false, reason: 'No workout blocks to shorten.' };
  const target = Math.max(cfg.minimumMinutes, Number(minutes) || cfg.defaultMinutes);
  const originalDurationMin = Math.ceil(session.blocks.reduce((total, block)=> total + blockDurationMinutes(block, config), 0));
  if(originalDurationMin <= target){
    return { session: { ...session, mode: 'standard', estimatedDurationMin: originalDurationMin }, changed: false, originalDurationMin, estimatedDurationMin: originalDurationMin, omittedExerciseIds: [], reason: 'The planned session already fits the requested time.' };
  }
  const ranked = session.blocks.map((block, index)=> ({ block, index, duration: blockDurationMinutes(block, config), priority: blockPriority(block, index, config) }))
    .sort((a, b)=> b.priority - a.priority || a.index - b.index);
  const selected = [];
  let selectedDuration = 0;
  for(const candidate of ranked){
    if(!selected.length || selectedDuration + candidate.duration <= target){
      selected.push(candidate);
      selectedDuration += candidate.duration;
    }
  }
  if(!selected.length) selected.push(ranked[0]);
  const ratio = Math.min(1, target / Math.max(originalDurationMin, 1));
  const selectedIds = new Set(selected.map(item=> item.index));
  const blocks = session.blocks.filter((_, index)=> selectedIds.has(index)).map(block=> shortenBlock(block, ratio, target, config));
  const estimatedDurationMin = Math.max(cfg.minimumBlockMinutes, Math.ceil(blocks.reduce((total, block)=> total + blockDurationMinutes(block, config), 0)));
  return {
    session: { ...session, blocks, mode: 'short', targetMinutes: target, estimatedDurationMin, originalDurationMin },
    changed: true,
    originalDurationMin,
    estimatedDurationMin,
    omittedExerciseIds: session.blocks.filter((_, index)=> !selectedIds.has(index)).map(block=> block.exerciseId),
    reason: `Kept ${blocks.length} high-value block${blocks.length === 1 ? '' : 's'} and reduced volume to fit about ${target} minutes.`,
  };
}

export function adaptScheduleForEquipment(schedule, availableEquipment = [], history = []){
  if(!schedule?.sessions?.length) return { schedule, substitutions: [], changed: false, unavailable: [] };
  if(!availableEquipment?.length) return { schedule, substitutions: [], changed: false, unavailable: [], reason: 'Kit is not set — keeping the original programme until onboarding is complete.' };
  const kit = [...new Set([...(availableEquipment || []), 'bodyweight'])];
  const unavailable = [];
  for(const session of schedule.sessions){
    for(const block of session.blocks || []){
      if(!exerciseAvailable(block.exerciseId, kit)) unavailable.push({ sessionId: session.id, exerciseId: block.exerciseId, alternatives: rankedSubstitutions(block.exerciseId, kit, 3, history).map(ex=> ex.id) });
    }
  }
  const applied = applyEquipmentSubstitutions(schedule.sessions, kit, history);
  const changed = applied.substitutions.length > 0;
  return {
    schedule: { ...schedule, sessions: applied.sessions, availableEquipment: kit, equipmentAdaptedAt: changed ? new Date().toISOString() : schedule.equipmentAdaptedAt, equipmentSubstitutions: applied.substitutions },
    substitutions: applied.substitutions,
    unavailable,
    changed,
    reason: changed ? `Adapted ${applied.substitutions.length} block${applied.substitutions.length === 1 ? '' : 's'} to the available kit.` : 'Every scheduled exercise fits the available kit.',
  };
}

// Programme-level adaptation closes the loop between a completed session and
// the next prescription. It is deliberately conservative: a single rough
// workout can hold a target, but it cannot rewrite the programme. Volume is
// changed only after repeated evidence, a deload is limited to the next
// recovery window, and an exercise swap requires a genuine plateau plus a
// kit-compatible alternative.
function sortedSessions(history){
  return (history || []).map((session, index)=> ({ session, index }))
    .sort((a, b)=> sessionDateSort(a.session, b.session) || a.index - b.index)
    .map(item=> item.session);
}

function scheduleHistory(schedule, history){
  const sessionIds = new Set((schedule?.sessions || []).map(session=> session.id));
  const startDateISO = schedule?.startDateISO || '';
  return sortedSessions(history).filter(session=> {
    if(sessionIds.has(session.id)) return true;
    return session.programId === schedule?.programId && (!startDateISO || String(session.dateISO || '') >= startDateISO);
  });
}

function repeatedDifficulty(history, exerciseId, config = null){
  const cfg = resolveArisePriors(config).programming.adaptation;
  const sessions = sortedSessions(history).filter(session=> (session.blocks || []).some(block=> block.exerciseId === exerciseId)).slice(-cfg.difficultySessions);
  if(sessions.length < cfg.difficultySessions) return null;
  const evidence = sessions.map(session=> {
    const sets = (session.blocks || []).filter(block=> block.exerciseId === exerciseId).flatMap(block=> block.sets || []);
    const rpes = sets.map(set=> Number(set.rpe)).filter(value=> Number.isFinite(value));
    const failed = sets.some(set=> set.failed === true || set.incomplete === true || parseReps(set.reps) <= 0);
    const avgRpe = rpes.length ? rpes.reduce((sum, value)=> sum + value, 0) / rpes.length : null;
    return { sessionId: session.id, dateISO: session.dateISO, failed, avgRpe: avgRpe == null ? null : Math.round(avgRpe * 10) / 10 };
  });
  const repeated = evidence.every(row=> row.failed || (row.avgRpe != null && row.avgRpe >= 9));
  if(!repeated) return null;
  return {
    kind: 'repeated-difficulty',
    evidence,
    reason: `Held volume because the last ${evidence.length} ${exerciseId} exposures included failed sets or average RPE ≥9.`,
  };
}

function addBlockAdaptation(block, { kind, reason, basisKey }){
  return {
    ...block,
    why: reason,
    adaptation: { kind, reason, basisKey },
  };
}

function adaptationNoop(schedule, reason, { basisKey = null, decision = null } = {}){
  return { schedule, changed: false, changes: [], decision, basisKey, reason };
}

// Use actual history to adapt only unfinished schedule sessions. The returned
// schedule is safe to apply on every save: lastAdaptationBasis makes the same
// completed session idempotent, while savedAt/history count lets edited or
// duplicated history be treated as a new observation.
export function adaptActiveSchedule(schedule, history = [], { readinessLog = [], availableEquipment = null, config = null } = {}){
  if(!schedule?.sessions?.length) return adaptationNoop(schedule, 'No active schedule to adapt.');
  const cfg = resolveArisePriors(config);
  const activeHistory = scheduleHistory(schedule, history);
  if(!activeHistory.length) return adaptationNoop(schedule, 'No completed sessions from this programme yet.');
  const last = activeHistory[activeHistory.length - 1];
  const basisKey = `${last.id || last.dateISO}|${last.savedAt || last.dateISO}|${activeHistory.length}`;
  if(schedule.lastAdaptationBasis === basisKey) return adaptationNoop(schedule, 'This completed session has already informed the programme.', { basisKey, decision: schedule.lastAdaptation?.decision || null });

  const completedIds = new Set(activeHistory.map(session=> session.id).filter(Boolean));
  const ordered = schedule.sessions.slice().sort(sessionDateSort);
  const lastIndex = ordered.findIndex(session=> session.id === last.id);
  const future = ordered.filter((session, index)=> index > lastIndex && !isDone(session, completedIds));
  if(!future.length) return adaptationNoop(schedule, 'The programme has no unfinished sessions after the latest completed session.', { basisKey });

  const logs = allSetLogs(activeHistory);
  const volume = weeklyVolume(activeHistory);
  const weeklyVolumeTrend = volume.slice(1).map((week, index)=> week.vol / Math.max(1, volume[index].vol));
  const recentRpes = logs.slice(-cfg.recovery.recentSetWindow).map(log=> log.rpe).filter(value=> value != null && String(value).trim() !== '');
  const deload = deloadReadinessAssessment({
    logs,
    recentRpes,
    weeklyVolumeTrend,
    readinessHistory: readinessLog,
    history: activeHistory,
    config: cfg,
  });

  const kit = [...new Set([...(availableEquipment || schedule.availableEquipment || []), 'bodyweight'])];
  const changes = [];
  const updatedById = new Map();
  const touchedExercises = new Set();
  const maxChanges = cfg.programming.adaptation.maxChangesPerSave;
  const updateBlock = (session, blockIndex, nextBlock)=> {
    const current = updatedById.get(session.id) || session;
    const blocks = (current.blocks || []).map((block, index)=> index === blockIndex ? nextBlock : block);
    updatedById.set(session.id, { ...current, blocks });
  };
  const canChange = ()=> changes.length < maxChanges;

  if(deload.yes){
    const horizonEnd = addDays(last.dateISO, cfg.programming.adaptation.deloadHorizonDays);
    for(const session of future){
      if(String(session.dateISO || '') > horizonEnd || !canChange()) continue;
      for(const [blockIndex, block] of (session.blocks || []).entries()){
        const originalSets = Math.max(1, Number(block.sets) || 1);
        const nextSets = Math.max(1, Math.min(originalSets, Math.round(originalSets * deload.cut)));
        if(nextSets >= originalSets) continue;
        const reason = `Reduced to ${nextSets} set${nextSets === 1 ? '' : 's'} for the next recovery window because ${deload.signals.join('; ')}.`;
        updateBlock(session, blockIndex, addBlockAdaptation({ ...block, sets: nextSets }, { kind: 'deload', reason, basisKey }));
        changes.push({ sessionId: session.id, dateISO: session.dateISO, exerciseId: block.exerciseId, kind: 'deload', from: { sets: originalSets }, to: { sets: nextSets }, reason, evidence: deload.signals.slice() });
        if(!canChange()) break;
      }
    }
  } else {
    // Only the next occurrence of an exercise is changed. This prevents one
    // observation from silently inflating an entire mesocycle.
    for(const session of future){
      for(const [blockIndex, block] of (session.blocks || []).entries()){
        if(!canChange() || touchedExercises.has(block.exerciseId)) continue;
        touchedExercises.add(block.exerciseId);

        const plateau = plateauAttribution(activeHistory, block.exerciseId, { readinessLog, config: cfg });
        if(plateau.kind === 'genuine' && plateau.n >= cfg.programming.adaptation.plateauMinimumSessions && kit.length){
          const [candidate] = rankedSubstitutions(block.exerciseId, kit, 1, activeHistory);
          if(candidate){
            const reason = `Changed to ${candidate.name} after ${plateau.n} exposures with a genuine plateau: ${plateau.reason}`;
            const nextBlock = addBlockAdaptation({
              ...block,
              exerciseId: candidate.id,
              substitutionFrom: block.substitutionFrom || block.exerciseId,
              substitutionReason: reason,
            }, { kind: 'plateau-substitution', reason, basisKey });
            updateBlock(session, blockIndex, nextBlock);
            changes.push({ sessionId: session.id, dateISO: session.dateISO, exerciseId: block.exerciseId, kind: 'plateau-substitution', from: block.exerciseId, to: candidate.id, reason, evidence: [plateau.reason] });
            continue;
          }
        }

        const difficulty = repeatedDifficulty(activeHistory, block.exerciseId, cfg);
        const originalSets = Math.max(1, Number(block.sets) || 1);
        if(difficulty && originalSets > 1){
          const nextSets = Math.max(1, originalSets - cfg.programming.adaptation.setReduction);
          const reason = `Reduced volume from ${originalSets} to ${nextSets} sets; repeated difficulty is evidence to recover before adding more.`;
          updateBlock(session, blockIndex, addBlockAdaptation({ ...block, sets: nextSets }, { kind: 'repeated-difficulty', reason, basisKey }));
          changes.push({ sessionId: session.id, dateISO: session.dateISO, exerciseId: block.exerciseId, kind: 'repeated-difficulty', from: { sets: originalSets }, to: { sets: nextSets }, reason, evidence: difficulty.evidence });
          continue;
        }

        const setDecision = recommendSets(activeHistory, block.exerciseId, { targetReps: block.reps, maxSets: cfg.progression.sets.defaultMaxSets, config: cfg });
        if(setDecision.add && setDecision.sets > originalSets){
          const reason = `${setDecision.reason} Applied to the next ${block.exerciseId} session only; future volume will wait for more evidence.`;
          updateBlock(session, blockIndex, addBlockAdaptation({ ...block, sets: setDecision.sets }, { kind: 'volume', reason, basisKey }));
          changes.push({ sessionId: session.id, dateISO: session.dateISO, exerciseId: block.exerciseId, kind: 'volume', from: { sets: originalSets }, to: { sets: setDecision.sets }, reason, evidence: [setDecision.reason] });
        }
      }
    }
  }

  const decision = {
    deload: deload.yes,
    deloadSignals: deload.signals || [],
    confidence: deload.confidence || 'low',
  };
  if(!changes.length) return adaptationNoop(schedule, deload.yes ? 'Recovery signals were present, but unfinished blocks were already at the minimum volume.' : 'No repeated evidence supports a programme-level change yet.', { basisKey, decision });

  const entry = { basisKey, basisSessionId: last.id || null, dateISO: last.dateISO, decision, changes };
  const adaptationHistory = [...(schedule.adaptationHistory || []), entry].slice(-30);
  const sessions = schedule.sessions.map(session=> updatedById.get(session.id) || session);
  const nextSchedule = {
    ...schedule,
    sessions,
    adaptationHistory,
    lastAdaptation: entry,
    lastAdaptationBasis: basisKey,
  };
  return {
    schedule: nextSchedule,
    changed: true,
    changes,
    decision,
    basisKey,
    reason: changes.map(change=> change.reason).join(' '),
  };
}

export const adaptProgramme = adaptActiveSchedule;

export function recordProgramStart(entries = [], { programId, version = 1, startDateISO } = {}){
  const next = entries.map(entry=> entry.endDateISO ? entry : { ...entry, endDateISO: addDays(startDateISO, -1) });
  return [...next, { programId, version, startDateISO, endDateISO: null }];
}

export function userProgramHistory(entries = [], activeSchedule = null, history = []){
  return entries.slice().sort((a, b)=> String(b.startDateISO || '').localeCompare(String(a.startDateISO || ''))).map(entry=>{
    const sessions = history.filter(session=> session.programId === entry.programId && (!entry.startDateISO || session.dateISO >= entry.startDateISO) && (!entry.endDateISO || session.dateISO <= entry.endDateISO));
    const active = activeSchedule?.programId === entry.programId && activeSchedule?.startDateISO === entry.startDateISO;
    return { ...entry, active, completedSessions: sessions.length, status: active ? 'active' : entry.endDateISO ? 'ended' : 'paused' };
  });
}

function allSetLogs(history){
  const logs = [];
  for(const session of history || []) for(const block of session.blocks || []) for(const set of block.sets || []){
    const reps = parseReps(set.reps);
    if(reps) logs.push({ reps, weightKg: numeric(set.weightKg), rpe: set.rpe ?? null, dateISO: session.dateISO });
  }
  return logs;
}

export function validateDeloadLogic({ history = [], readinessLog = [], config = null } = {}){
  const cfg = resolveArisePriors(config);
  const volume = weeklyVolume(history);
  const weeklyVolumeTrend = volume.slice(1).map((week, index)=> week.vol / Math.max(1, volume[index].vol));
  const logs = allSetLogs(history);
  const recentRpes = logs.slice(-cfg.recovery.recentSetWindow).map(log=> log.rpe).filter(value=> value != null && String(value).trim() !== '');
  const decision = deloadReadinessAssessment({ logs, recentRpes, weeklyVolumeTrend, readinessHistory: readinessLog, history, config: cfg });
  const outcomes = deloadOutcomes(history);
  const sample = outcomes.n;
  return {
    decision,
    outcomes,
    weeks: volume.length,
    sample,
    confidence: sample >= cfg.recovery.validationHighOutcomes ? 'high' : sample >= cfg.recovery.validationMediumOutcomes ? 'medium' : 'low',
    note: sample ? `Validated against ${sample} observed volume-cut week${sample === 1 ? '' : 's'}.` : 'No observed deload outcomes yet — treat the trigger as a conservative rule, not proof.',
  };
}

export function recommendationCalibration(history = [], { minimumSamples = null, config = null, readinessLog = [], schedule = null, profile = null } = {}){
  const cfg = resolveArisePriors(config);
  const minimum = minimumSamples == null ? cfg.backtest.minimumComparisons : minimumSamples;
  const backtest = backtestHistory({ kind: 'real-history', history, readinessLog, schedule, profile, config: cfg });
  const rawValidation = backtest.metrics?.recommendation || validateProgression(history, { config: cfg });
  const validation = {
    ...rawValidation,
    meanAbsErrorKg: rawValidation.loadRecommendationError?.meanAbsKg ?? rawValidation.meanAbsErrorKg ?? null,
    meanAbsErrorReps: rawValidation.repRecommendationError?.meanAbsReps ?? rawValidation.meanAbsErrorReps ?? null,
  };
  const followThrough = recommendationFollowThrough(history);
  const samples = backtest.comparisons ?? validation.n;
  const status = samples >= minimum ? 'calibrated' : samples > 0 ? 'warming' : 'insufficient';
  const confidence = samples >= minimum * 2 ? 'high' : samples >= minimum ? 'medium' : 'low';
  return {
    ...validation,
    samples,
    minimumSamples: minimum,
    status,
    confidence,
    followThrough,
    backtest,
    note: status === 'calibrated'
      ? `Calibration is based on ${samples} point-in-time next-session comparisons.`
      : `Need ${Math.max(0, minimum - samples)} more next-session comparison${minimum - samples === 1 ? '' : 's'} before tuning the rule.`,
  };
}
