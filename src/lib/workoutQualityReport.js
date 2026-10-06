// workoutQualityReport.js — the post-workout debrief, in words.
//
// sessionQuality.sessionQuality already computes a 0–100 score per session
// (readiness, failed reps, notes, near-failure patterns). This module wraps
// it into the thing the user actually sees after a workout:
//
//   Workout quality 82/100
//   What went well …
//   What limited you …
//   What to change next session …
//
// It answers against TARGET, not against the average session: "good" means
// the prescription was met or beaten, not merely that nothing went wrong.
// Also compares vs the same exercise's previous performance and reads the
// recovery context, so the debrief can say "you performed well ON PAPER" and
// still flag the sleep debt behind it.
//
// Pure, deterministic, offline.

import { e1rm } from "./progression.js";
import { EXERCISE_BY_ID } from "./data.js";
import { sessionQuality } from "./sessionQuality.js";
import { resolveArisePriors } from "./priors.js";

const QUALITY_BANDS = [
  { min: 80, label: 'Excellent' },
  { min: 65, label: 'Solid' },
  { min: 45, label: 'Mixed' },
  { min: 0, label: 'Rough' },
];

/**
 * Build the post-workout report for a SAVED session payload (the same shape
 `upsertHistory` receives): { dateISO, blocks:[{exerciseId, sets:[{reps,
 * weightKg, rpe, completed, failed}]}], note?, noteTags?, durationMinutes? }.
 *
 * @param targetSession optional scheduled session for target sets/reps.
 * @param previousSessionsForExercise fn(exerciseId) -> previous session payload (optional).
 */
export function workoutQualityReport(session, { readinessLog = [], schedule = null, historyBefore = [], previousSessionsForExercise = null, config = null } = {}){
  if(!session?.blocks?.length) return null;
  const cfg = resolveArisePriors(config);
  const sc = sessionQuality(session, { readinessLog, config });
  const parts = [];
  let cameFromScore = sc.score; // carried through so engine score + target lens both land in one number

  // ── Target lens: completion vs the prescription ──
  const scheduleSession = schedule?.sessions?.find(s => s.id === session.id) || null;
  const targetBlocks = scheduleSession?.blocks || [];
  const totalSets = (session.blocks || []).reduce((n, b) => n + (b.sets || []).length, 0);
  const completedSets = (session.blocks || []).reduce((n, b) => n + (b.sets || []).filter(s => s.completed).length, 0);
  let targetHit = null, targetDetail = null;
  if(targetBlocks.length){
    let planned = 0, achieved = 0;
    for(const block of session.blocks || []){
      const t = targetBlocks.find(b => b.exerciseId === block.exerciseId);
      if(!t) continue;
      const plannedSets = Math.max(1, Number(t.sets) || 1);
      planned += plannedSets;
      const doneSets = (block.sets || []).filter(s => s.completed && ((Number(String(s.reps).match(/\d+/)?.[0] || s.reps)) || 0) > 0);
      // A set meets its target when it reaches the BOTTOM of the rep range —
      // '8–12' means 8 to 12, so 10 clean reps at RPE 8 is a hit, not a miss.
      const targetRepsBottom = repBottom(t.reps);
      const need = targetRepsBottom != null ? targetRepsBottom : 1;
      const hit = doneSets.filter(s => (Number(String(s.reps).match(/\d+/)?.[0] || s.reps)) >= need).length;
      achieved += Math.min(plannedSets, hit);
    }
    if(planned){
      targetHit = achieved >= planned;
      targetDetail = `${achieved}/${planned} sets met their rep target`;
      if(!targetHit) cameFromScore -= cfg.workoutQuality.targetMissPenalty;
      else cameFromScore += cfg.workoutQuality.targetHitBonus;
    }
  }

  // ── Sustainable-effort bonus: everything done, nothing ground out. ──
  const allCompleted = totalSets > 0 && completedSets === totalSets;
  const sustainableEffort = allCompleted && sc.avgRpe != null && sc.avgRpe <= cfg.workoutQuality.sustainableEffortMaxRpe;
  if(sustainableEffort) cameFromScore += cfg.workoutQuality.sustainableEffortBonus;

  // ── Beats / matched previous performance ──
  const beatPrevious = [];
  for(const block of session.blocks || []){
    const prevSession = typeof previousSessionsForExercise === 'function' ? previousSessionsForExercise(block.exerciseId) :
      (historyBefore || []).slice().reverse().find(h => (h.blocks || []).some(b => b.exerciseId === block.exerciseId) && h.id !== session.id);
    if(!prevSession) continue;
    const prevBest = bestE1rm(prevSession, block.exerciseId);
    const curBest = bestE1rm(session, block.exerciseId);
    const name = EXERCISE_BY_ID[block.exerciseId]?.name || block.exerciseId;
    if(prevBest > 0 && curBest > prevBest * 1.005){
      beatPrevious.push({ exerciseId: block.exerciseId, name, pct: Math.round((curBest / prevBest - 1) * 1000) / 10 });
      cameFromScore += cfg.workoutQuality.prBeatBonus;
    }
  }

  // ── Recovery context ──
  const readiness = readinessOn(session.dateISO, readinessLog);
  if(readiness != null && readiness < cfg.sessionQuality.score.readinessLow) beatPrevious.push({ exerciseId: null, name: null, lowReadiness: readiness });
  cameFromScore = Math.max(0, Math.min(100, Math.round(cameFromScore)));

  // ── Compose ──
  const band = QUALITY_BANDS.find(b => cameFromScore >= b.min).label;
  const wentWell = [];
  const limitedBy = [];
  const nextFocus = [];

  if(targetHit) wentWell.push(`Session target hit — ${targetDetail}.`);
  if(beatPrevious.some(b => b.exerciseId)) wentWell.push(`Beat the previous best on ${beatPrevious.filter(b => b.exerciseId).map(b => b.name).join(' and ')}.`);
  if(sc.avgRpe != null && sc.avgRpe <= cfg.workoutQuality.sustainableEffortMaxRpe && totalSets >= 3) wentWell.push(`Substantial volume at a sustainable effort (avg RPE ${sc.avgRpe}).`);
  if(!wentWell.length) wentWell.push('You showed up and logged it — that is the base everything else builds on.');

  if(!targetHit && targetDetail && totalSets > completedSets) limitedBy.push(`Missing sets: only ${completedSets}/${totalSets} logged.`);
  if(!targetHit && targetDetail && totalSets === completedSets) limitedBy.push(targetDetail + ' — reps fell short of the prescription.');
  if(sc.reasons?.some(r => /failed|missed/.test(r))) limitedBy.push('Failed or skipped reps.');
  if(sc.avgRpe != null && sc.avgRpe >= 9 && (sc.readinessScore != null ? sc.readinessScore >= 60 : false)) limitedBy.push(`Grinding at RPE ${sc.avgRpe} on a good-readiness day — the target may be too hot.`);
  if(readiness != null && readiness < cfg.sessionQuality.score.readinessLow) limitedBy.push(`Low readiness (${readiness}) entering the session — sleep and soreness were already against you.`);
  if(sc.reasons?.some(r => /negative note/.test(r))) limitedBy.push('Session note flagged it yourself — worth trusting.');
  if(!limitedBy.length) limitedBy.push('Nothing material — keep the same prescribe-and-log loop going.');

  if(!targetHit) nextFocus.push('Next session: repeat the prescription rather than pushing load — one clean target hit outranks a forced PR.');
  if(sc.avgRpe != null && sc.avgRpe >= 9) nextFocus.push('If effort stays ≥9 for two sessions, hold load and collect a clean exposure first.');
  if(readiness != null && readiness < cfg.sessionQuality.score.readinessLow) nextFocus.push('Protect sleep this week; readiness was low before you started lifting.');
  if(targetHit && beatPrevious.length) nextFocus.push('Progression is landing — hold the plan and let repeated clean exposures accumulate.');
  if(!nextFocus.length) nextFocus.push('Keep logging RPE so the debrief can separate effort from outcome next time.');

  return {
    sessionId: session.id || null,
    dateISO: session.dateISO || null,
    quality: cameFromScore,
    band,
    engineQuality: sc.quality,
    engineReasons: sc.reasons,
    avgRpe: sc.avgRpe,
    target: targetDetail ? { hit: targetHit, detail: targetDetail } : null,
    sustainableEffort,
    beatsPrevious: beatPrevious.filter(b => b.exerciseId),
    lowReadiness: readiness != null && readiness < cfg.sessionQuality.score.readinessLow ? readiness : null,
    whatWentWell: wentWell,
    whatLimitedYou: limitedBy,
    whatToChangeNext: nextFocus,
    noteTags: sc.noteTags,
    techniqueChange: sc.techniqueChange,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function bestE1rm(session, exerciseId){
  let best = 0;
  for(const block of session.blocks || []){
    if(block.exerciseId !== exerciseId) continue;
    for(const set of block.sets || []){
      const reps = Number(String(set.reps).match(/\d+/)?.[0] || set.reps) || 0;
      const weight = Number(set.weightKg) || 0;
      if(reps <= 0 || weight <= 0) continue;
      best = Math.max(best, e1rm(weight, reps));
    }
  }
  return best;
}

/** "8–12" | "8" | "8-12" -> 8 (bottom of range), or null when unparseable. */
function repBottom(range){
  if(range == null) return null;
  const m = String(range).match(/(\d+)\s*[-–]\s*(\d+)/);
  if(m) return Number(m[1]);
  const single = String(range).match(/\d+/);
  return single ? Number(single[0]) : null;
}

function readinessOn(dateISO, readinessLog){
  let best = null, bestD = 3 * 86400000; // same 3-day lookback as sessionQuality
  for(const r of readinessLog || []){
    const diff = Date.parse(`${dateISO}T00:00:00`) - Date.parse(`${r.dateISO}T00:00:00`);
    if(Number.isFinite(diff) && diff >= 0 && diff <= bestD){ bestD = diff; best = Number(r.score); }
  }
  return best;
}
