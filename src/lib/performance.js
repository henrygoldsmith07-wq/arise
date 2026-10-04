// performance.js — evidence-based performance metrics.
//
// Everything here answers a training question with the evidence that supports
// it, or says plainly that the evidence is not there yet. Nothing accumulates
// lifetime totals into a "score": improvement is only claimed when comparable
// sessions support it (same exercise, comparable sets). The gamified layer
// lives in xp.js and is labelled as motivation; these numbers are the honest
// measurements.
//
// Confidence is human-readable at every level of the result: each metric
// carries { status, confidence, explanation } where confidence is one of
// 'low' | 'medium' | 'high' with a plain-English reason.

import { classifyPR } from './progression.js';

const E1RM_MIN_COMPARABLE = 3;

function parseReps(value){
  const n = Number(String(value ?? '').match(/\d+/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function e1rm(weightKg, reps){
  const w = Number(weightKg), r = parseReps(reps);
  return w > 0 && r > 0 ? w * (1 + r / 30) : null;
}

export function confidenceLanguage(confidence, reason){
  return {
    low: `Low confidence — ${reason || 'Arise only has a couple of comparable sessions.'}`,
    medium: `Medium confidence — ${reason || 'Your last few sessions show a consistent pattern.'}`,
    high: `High confidence — ${reason || 'Repeated performance supports this.'}`,
  }[confidence] || reason || '';
}

function sessionsFor(history, exerciseId){
  return (history || [])
    .filter((s)=> s?.dateISO && !s.deletedAt && (s.blocks || []).some((b)=> b.exerciseId === exerciseId))
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
}

function bestE1rmPerSession(history, exerciseId){
  return sessionsFor(history, exerciseId).map((session)=>{
    let best = null, bestSet = null;
    for(const block of session.blocks || []){
      if(block.exerciseId !== exerciseId) continue;
      for(const set of block.sets || []){
        if(set.failed || set.skipped) continue;
        const value = e1rm(set.weightKg, set.reps);
        if(value != null && (best == null || value > best)){ best = value; bestSet = set; }
      }
    }
    return { dateISO: session.dateISO, e1rm: best, set: bestSet };
  }).filter((row)=> row.e1rm != null);
}

// Strength trend per exercise: e1RM across comparable sessions. Improvement
// is claimed only with enough exposures and a meaningful move (≥1% or ≥1 kg),
// and the explanation names the actual sets the claim rests on.
export function strengthTrends({ history = [], exerciseIds = [], minSessions = E1RM_MIN_COMPARABLE } = {}){
  return exerciseIds.map((exerciseId)=>{
    const rows = bestE1rmPerSession(history, exerciseId);
    const trend = { exerciseId, status: 'insufficient', confidence: 'low', rows, explanation: '' };
    if(rows.length < minSessions){
      trend.explanation = `Arise needs at least ${minSessions} comparable sessions before calling a trend — ${rows.length} so far.`;
      return trend;
    }
    const early = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)));
    const recent = rows.slice(-Math.max(1, Math.floor(rows.length / 2)));
    const avg = (list)=> list.reduce((n, r)=> n + r.e1rm, 0) / list.length;
    const earlyAvg = avg(early), recentAvg = avg(recent);
    const deltaKg = recentAvg - earlyAvg;
    const deltaPct = earlyAvg ? (deltaKg / earlyAvg) * 100 : 0;
    const best = rows.reduce((a, b)=> (b.e1rm > a.e1rm ? b : a), rows[0]);
    trend.bestE1rm = Math.round(best.e1rm);
    trend.bestDateISO = best.dateISO;
    trend.deltaKg = Math.round(deltaKg * 10) / 10;

    if(deltaPct >= 1 || deltaKg >= 1){
      trend.status = 'improving';
    } else if(deltaPct <= -1 || deltaKg <= -1){
      trend.status = 'declining';
    } else {
      trend.status = 'stable';
    }
    trend.confidence = rows.length >= 6 ? 'high' : rows.length >= 4 ? 'medium' : 'low';
    trend.explanation = {
      improving: `Estimated 1RM rose ${Math.round(deltaKg * 10) / 10} kg across ${rows.length} comparable sessions (best ${Math.round(best.e1rm)} kg on ${best.dateISO}).`,
      stable: `Estimated 1RM has been level across ${rows.length} sessions (within ~1%).`,
      declining: `Estimated 1RM slipped ${Math.abs(Math.round(deltaKg * 10) / 10)} kg over ${rows.length} sessions — fatigue or a change in style can explain this before strength does.`,
      insufficient: '',
    }[trend.status];
    return trend;
  });
}

// Work capacity: recent comparable volume per session for one exercise or the
// whole log. Averages recent sessions instead of accumulating lifetime totals.
export function workCapacity({ history = [], exerciseIds = [], window = 6 } = {}){
  const sessions = (history || []).filter((s)=> s?.dateISO && !s.deletedAt).sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  const scoped = exerciseIds.length
    ? sessions.filter((s)=> (s.blocks || []).some((b)=> exerciseIds.includes(b.exerciseId)))
    : sessions;
  const recent = scoped.slice(-window);
  const volumes = recent.map((session)=>{
    let vol = 0;
    for(const block of session.blocks || []){
      if(exerciseIds.length && !exerciseIds.includes(block.exerciseId)) continue;
      for(const set of block.sets || []){
        if(set.failed || set.skipped) continue;
        const reps = parseReps(set.reps), w = Number(set.weightKg) || 0;
        if(reps != null) vol += reps * Math.max(0, w - (Number(set.assistedKg) || 0));
      }
    }
    return { dateISO: session.dateISO, volumeKg: Math.round(vol) };
  });
  const withVolume = volumes.filter((v)=> v.volumeKg > 0);
  const avg = withVolume.length ? Math.round(withVolume.reduce((n, v)=> n + v.volumeKg, 0) / withVolume.length) : null;
  return {
    avgVolumeKg: avg,
    sessionsMeasured: withVolume.length,
    rows: volumes,
    confidence: withVolume.length >= 5 ? 'high' : withVolume.length >= 3 ? 'medium' : 'low',
    explanation: avg == null
      ? 'Not enough logged volume yet to describe work capacity.'
      : `Your last ${withVolume.length} comparable sessions average ${avg.toLocaleString()} kg of completed work.`,
  };
}

// Consistency: adherence against the user's own programme (planned vs done),
// a sustainable streak measure, and honest recovery after misses — never
// lifetime session counts and never guilt. A catch-up workout within a week of
// the planned day counts as completed work: the brief is the unit of honesty,
// not the calendar slot. The explanation always says how many ran on time.
export function consistencyReport({ history = [], schedule = null, today = null } = {}){
  const logged = (history || []).filter((s)=> s?.dateISO && !s.deletedAt);
  const done = new Set(logged.map((s)=> s.dateISO));
  const planned = (schedule?.sessions || []).filter((s)=> s.dateISO && s.dateISO <= (today || new Date().toISOString().slice(0, 10)));
  const onTime = planned.filter((s)=> s.status === 'done' || done.has(s.dateISO));
  const completed = planned.filter((p)=>
    onTime.includes(p)
    || logged.some((s)=> s.title === p.title && dayDelta(s.dateISO, p.dateISO) <= 7 && s.dateISO >= p.dateISO)
  );
  const missed = planned.filter((s)=> !completed.includes(s) && s.dateISO < (today || new Date().toISOString().slice(0, 10)));
  const adherencePct = planned.length ? Math.round((completed.length / planned.length) * 100) : null;

  const dates = [...done].sort();
  let run = 0, best = 0, last = null;
  for(const d of dates){
    const gap = last ? (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000 : Infinity;
    run = gap <= 10 ? run + 1 : 1;
    best = Math.max(best, run);
    last = d;
  }
  // Recovery: did the user return after the most recent miss within a week?
  const lastMiss = missed[missed.length - 1];
  const returnedAfterMiss = lastMiss
    ? dates.some((d)=> d > lastMiss.dateISO && dayDelta(d, lastMiss.dateISO) <= 7)
    : null;

  return {
    adherencePct,
    planned: planned.length,
    completed: completed.length,
    onTime: onTime.length,
    missed: missed.length,
    streak: run,
    bestStreak: best,
    returnedAfterMiss,
    confidence: planned.length >= 6 ? 'high' : planned.length >= 3 ? 'medium' : 'low',
    explanation: planned.length
      ? `You completed ${completed.length} of ${planned.length} planned sessions (${adherencePct}%)${completed.length > onTime.length ? `, including ${completed.length - onTime.length} made up within a week` : ''}.`
      : 'Consistency compares against your own programme once one is scheduled.',
  };
}

function dayDelta(aISO, bISO){
  return Math.abs(Date.parse(`${aISO}T00:00:00Z`) - Date.parse(`${bISO}T00:00:00Z`)) / 86400000;
}

// Personal bests that mean something. Every PR passes the same gate the
// engine uses (classifyPR: >2% above prior best, not a one-rep jitter, not a
// technique/ROM change), and every PR carries the reason it counts — the
// user should never have to reverse-engineer why a number is a record.
export function personalBests({ history = [], limit = 5 } = {}){
  const sessions = (history || [])
    .filter((s)=> s?.dateISO && !s.deletedAt)
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  const bestByExercise = new Map();
  const prs = [];
  for(const session of sessions){
    for(const block of session.blocks || []){
      for(const set of block.sets || []){
        if(set.failed || set.skipped) continue;
        const value = e1rm(set.weightKg, set.reps);
        if(value == null) continue;
        const prior = bestByExercise.get(block.exerciseId) || null;
        if(prior == null || value > prior.e1rm){
          const verdict = prior == null
            ? { meaningful:true, techniqueChange:false, reason:'First comparable performance on this exercise.' }
            : classifyPR({ priorBestE1rm: prior.e1rm, newE1rm: value, note: set.note, priorNote: prior.note });
          bestByExercise.set(block.exerciseId, { e1rm:value, note:set.note || null, dateISO: session.dateISO });
          if(verdict.meaningful && prior != null){
            prs.push({
              exerciseId: block.exerciseId,
              dateISO: session.dateISO,
              e1rmKg: Math.round(value),
              priorE1rmKg: Math.round(prior.e1rm),
              kind: compareSets(set, prior.set),
              why: verdict.reason,
            });
          }
        }
      }
    }
  }
  return prs.slice(-limit).reverse();
}

// Which comparable dimension moved: same-load rep PR, comparable-rep load PR,
// or the combined estimate.
function compareSets(set, priorSet){
  const reps = parseReps(set.reps), priorReps = priorSet ? parseReps(priorSet.reps) : null;
  const load = Number(set.weightKg) || 0, priorLoad = priorSet ? (Number(priorSet.weightKg) || 0) : 0;
  if(priorReps != null && reps != null && load === priorLoad && reps > priorReps) return 'Rep PR at same load';
  if(priorReps != null && reps != null && load > priorLoad && reps >= priorReps) return 'Load PR at comparable reps';
  return 'Estimated 1RM PR';
}
