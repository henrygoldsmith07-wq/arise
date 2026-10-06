// plateauInvestigation.js — automatic plateau investigation, cross-exercise.
//
// sessionQuality.plateauAttribution answers "is this a real plateau?" for ONE
// movement. This module answers the next question a coach is asked: WHY is it
// stalled, and what should change — by investigating the candidate causes a
// human coach would check, in order:
//
//   1. Volume: has weekly set count for this movement actually been rising?
//   2. Effort: is RIR/RPE drifting (trying harder but going nowhere, or
//      sandbagging)?
//   3. Frequency: is the exercise even being trained often enough to adapt?
//   4. Recovery: has readiness/soreness deteriorated over the plateau window?
//   5. Neighbours: are other exercises sharing the muscle ALSO stalled
//      (systemic) or still improving (movement-specific)?
//
// Every check returns { id, label, finding, verdict, evidence }. The verdicts
// aggregate into a diagnosis and ONE actionable recommendation, with the
// evidence trail attached so the UI can show why — never a bare instruction.
//
// Pure, deterministic, offline. Reads only logged history + readiness.

import { EXERCISE_BY_ID } from "./data.js";
import { e1rm } from "./progression.js";
import { plateauAttribution } from "./sessionQuality.js";
import { patternFor } from "./exerciseTaxonomy.js";
import { resolveArisePriors } from "./priors.js";

export const CHECK_IDS = ['volume-trend', 'effort-drift', 'frequency', 'recovery', 'neighbour-progress'];

/**
 * Investigate a stalled exercise. `plateauDetection(history, exerciseId)`
 * must have returned detected=true (or pass `status='plateau'|'genuine'`).
 *
 * Returns {
 *   exerciseId, windowWeeks, checks:[…], diagnosis, recommendation,
 *   evidence:[…], confidence
 * } — or { status:'insufficient', reason } when there is not enough data,
 * which the UI states plainly instead of guessing.
 */
export function investigatePlateau(history = [], exerciseId, { readinessLog = [], weeks = null, config = null } = {}){
  const cfg = resolveArisePriors(config);
  const windowWeeks = Math.max(2, Math.round(weeks ?? cfg.sessionQuality.plateau.window));
  const sessions = (history || [])
    .filter(h => (h.blocks || []).some(b => b.exerciseId === exerciseId))
    .sort((a, b) => String(a.dateISO || '').localeCompare(String(b.dateISO || '')));
  if(sessions.length < 4) return { exerciseId, status: 'insufficient', reason: `Need 4+ sessions of this exercise to investigate (have ${sessions.length}).` };

  const windowSessions = sessions.slice(-windowWeeks * 2); // ~2 sessions/week ceiling; slicing more is harmless
  const firstDate = windowSessions[0]?.dateISO;

  const checks = [
    volumeCheck(history, exerciseId, windowWeeks, { config }),
    effortCheck(windowSessions, { config }),
    frequencyCheck(sessions, windowWeeks, { config }),
    recoveryCheck(history, windowSessions, readinessLog, { config }),
    neighbourCheck(history, exerciseId, windowWeeks, { config }),
  ];

  // Aggregate the verdicts. A cause is only named when the evidence is there;
  // when several are plausible the diagnosis says so and ranks the fix.
  const flagged = checks.filter(c => c.verdict === 'cause');
  const clean = checks.filter(c => c.verdict === 'clear');
  const evidence = checks.flatMap(c => c.evidence);
  const confidence = flagged.length >= 1 && clean.length >= 2 ? 'medium' : flagged.length >= 2 ? 'medium' : 'low';

  const recommendation = recommendFix(flagged, exerciseId, { history, readinessLog, config });
  const diagnosis = buildDiagnosis(flagged, exerciseId, windowWeeks);

  return {
    exerciseId,
    status: 'investigated',
    windowWeeks,
    firstDate,
    checks,
    flagged: flagged.map(c => c.id),
    diagnosis,
    recommendation,
    evidence,
    confidence,
    checkedAtISO: sessions[sessions.length - 1]?.dateISO || null,
  };
}

// ── Check 1: volume ─────────────────────────────────────────────────────
// "Your incline dumbbell press has stalled" means little if weekly sets also
// collapsed. Compares hard sets/week in the plateau window vs the same length
// of time before it.
function volumeCheck(history, exerciseId, windowWeeks, { config } = {}){
  const sets = weeklyHardSets(history, exerciseId);
  const nowWeeks = sets.slice(-windowWeeks);
  const beforeWeeks = sets.slice(Math.max(0, sets.length - windowWeeks * 2), sets.length - windowWeeks);
  const nowMean = mean(nowWeeks.map(w => w.hardSets));
  const beforeMean = mean(beforeWeeks.map(w => w.hardSets));
  const evidence = [];
  if(beforeMean != null) evidence.push(`~${round1(beforeMean)} hard sets/week before the window vs ${round1(nowMean) ?? 0} in it.`);
  if(nowMean != null && beforeMean != null && nowMean < beforeMean * 0.8){
    return { id: 'volume-trend', label: 'Volume', verdict: 'cause', finding: 'Volume dropped', evidence: [...evidence, 'Weekly hard sets fell by 20%+ during the stall — the plateau may just be less work.'] };
  }
  // Volume already climbing 25%+: adding MORE volume is not the missing lever.
  if(nowMean != null && beforeMean != null && nowMean >= beforeMean * 1.25 && beforeMean >= 1){
    return { id: 'volume-trend', label: 'Volume', verdict: 'clear', finding: 'Volume already rising', evidence: [...evidence, 'Weekly hard sets are already climbing 25%+ — more volume is not the missing lever.'] };
  }
  // Persistently very low exposure: the volume base itself is insufficient.
  if(nowMean != null && nowMean < 4){
    return { id: 'volume-trend', label: 'Volume', verdict: 'cause', finding: 'Volume very low', evidence: [...evidence, `Only ~${round1(nowMean)} hard sets/week — below the range where progress is normally visible.`] };
  }
  return { id: 'volume-trend', label: 'Volume', verdict: 'clear', finding: 'Volume steady', evidence };
}

// ── Check 2: effort drift ───────────────────────────────────────────────
// Rising RPE with flat output = genuinely grinding; falling RPE with flat
// output = the weight is now easy and the target range is stale.
function effortCheck(windowSessions, { config } = {}){
  const cfg = resolveArisePriors(config);
  const rpes = [];
  for(const s of windowSessions) for(const b of s.blocks || []) for(const set of b.sets || []){
    const rpe = set.rpe != null && String(set.rpe).trim() !== '' ? Number(set.rpe) : null;
    if(rpe != null && Number.isFinite(rpe)) rpes.push(rpe);
  }
  const evidence = rpes.length ? [`${rpes.length} sets carried RPE in the window (mean ${round1(mean(rpes))}).`] : ['No RPE logged in the window — effort cannot be judged.'];
  if(!rpes.length) return { id: 'effort-drift', label: 'Effort (RPE)', verdict: 'unclear', finding: 'No RPE data', evidence };
  const half = Math.max(2, Math.floor(rpes.length / 2));
  const early = mean(rpes.slice(0, half));
  const late = mean(rpes.slice(-half));
  const drift = late - early;
  if(Math.abs(drift) < 0.75) return { id: 'effort-drift', label: 'Effort (RPE)', verdict: 'clear', finding: 'Effort steady', evidence };
  if(drift >= 0.75){
    return { id: 'effort-drift', label: 'Effort (RPE)', verdict: 'cause', finding: 'Effort climbing', evidence: [...evidence, `RPE drifted up from ~${round1(early)} to ~${round1(late)} while output stayed flat — approaching overreach.`] };
  }
  return { id: 'effort-drift', label: 'Effort (RPE)', verdict: 'cause', finding: 'Effort falling', evidence: [...evidence, `RPE drifted down from ~${round1(early)} to ~${round1(late)} — the current loads have become easy; the prescription is stale.`] };
}

// ── Check 3: frequency ──────────────────────────────────────────────────
// Sessions of this exercise per week across the WHOLE logged span (not only
// the window) — a 1×/week slot can legitimately be enough; the check just
// reports the exposure rate and flags near-zero exposure.
function frequencyCheck(sessions, windowWeeks, { config } = {}){
  const dates = sessions.map(s => s.dateISO).filter(Boolean).sort();
  if(dates.length < 2) return { id: 'frequency', label: 'Frequency', verdict: 'unclear', finding: 'Too few exposures', evidence: ['Fewer than two exposures logged.'] };
  const spanDays = Math.max(1, Math.round((Date.parse(`${dates[dates.length-1]}T00:00:00`) - Date.parse(`${dates[0]}T00:00:00`)) / 86400000));
  const perWeek = (dates.length / spanDays) * 7;
  const recentGapDays = Math.round((Date.parse(`${dates[dates.length-1]}T00:00:00`) - Date.parse(`${dates[Math.max(0, dates.length-2)]}T00:00:00`)) / 86400000);
  const evidence = [`${round1(perWeek)} sessions/week across the logged span; latest gap ${recentGapDays} days.`];
  if(perWeek < 1){
    return { id: 'frequency', label: 'Frequency', verdict: 'cause', finding: 'Frequency low', evidence: [...evidence, 'Less than one exposure a week of this movement can cap progress — a second weekly slot is the cheapest lever.'] };
  }
  return { id: 'frequency', label: 'Frequency', verdict: 'clear', finding: 'Frequency adequate', evidence };
}

// ── Check 4: recovery ───────────────────────────────────────────────────
// Readiness during the window vs before it; also negative note tags. A
// deteriorating recovery context reclassifies the plateau as fatigue first.
function recoveryCheck(history, windowSessions, readinessLog, { config } = {}){
  const cfg = resolveArisePriors(config);
  const byDate = new Map((readinessLog || []).map(r => [r.dateISO, Number(r.score)]));
  const readinessOn = dateISO => {
    if(byDate.has(dateISO)) return byDate.get(dateISO);
    const t = Date.parse(`${dateISO}T00:00:00`);
    let best = null, bestD = cfg.sessionQuality.readinessLookbackDays * 86400000;
    for(const [d, s] of byDate){
      const diff = t - Date.parse(`${d}T00:00:00`);
      if(diff >= 0 && diff <= bestD){ bestD = diff; best = s; }
    }
    return best;
  };
  const windowStart = windowSessions[0]?.dateISO;
  const beforeScores = (history || []).filter(h => h.dateISO < windowStart).map(h => readinessOn(h.dateISO)).filter(Number.isFinite);
  const windowScores = (windowSessions || []).map(h => readinessOn(h.dateISO)).filter(Number.isFinite);
  const negativeNotes = (windowSessions || []).filter(h => (h.noteTags || []).some(t => String(t).startsWith('negative:'))).length;
  const evidence = [];
  if(windowScores.length) evidence.push(`Readiness in the window: mean ${round1(mean(windowScores))} across ${windowScores.length} sessions.`);
  if(beforeScores.length) evidence.push(`Before the window: mean ${round1(mean(beforeScores))}.`);
  if(negativeNotes) evidence.push(`${negativeNotes} session note${negativeNotes === 1 ? '' : 's'} flagged negative in the window.`);
  const beforeMean = mean(beforeScores), windowMean = mean(windowScores);
  if(windowMean != null && windowMean < cfg.recovery.readinessLowEma){
    return { id: 'recovery', label: 'Recovery', verdict: 'cause', finding: 'Recovery poor', evidence: [...evidence, `Window readiness sits below the sustained-low threshold (${cfg.recovery.readinessLowEma}).`] };
  }
  if(windowMean != null && beforeMean != null && windowMean < beforeMean - 10){
    return { id: 'recovery', label: 'Recovery', verdict: 'cause', finding: 'Recovery declining', evidence: [...evidence, `Readiness fell 10+ points since before the window.`] };
  }
  return { id: 'recovery', label: 'Recovery', verdict: 'clear', finding: 'Recovery holding', evidence };
}

// ── Check 5: neighbours ─────────────────────────────────────────────────
// Are other exercises with the same movement pattern (or same muscle) still
// improving over the same window? Improving neighbours → movement-specific
// stall; stalled neighbours → systemic (muscle or recovery) stall.
function neighbourCheck(history, exerciseId, windowWeeks, { config } = {}){
  const target = EXERCISE_BY_ID[exerciseId];
  const targetPattern = patternFor(exerciseId);
  const candidates = new Set();
  for(const ex of Object.values(EXERCISE_BY_ID)){
    if(!ex?.id || ex.id === exerciseId) continue;
    if(ex.muscle === target?.muscle || (targetPattern && patternFor(ex.id) === targetPattern)) candidates.add(ex.id);
  }
  const neighbours = [];
  for(const id of candidates){
    const logs = bestPerSession(history, id);
    if(logs.length < 4) continue;
    const attr = plateauAttribution(history, id, { readinessLog: [], window: windowWeeks, config });
    neighbours.push({ exerciseId: id, name: EXERCISE_BY_ID[id]?.name || id, kind: attr.kind, n: logs.length });
  }
  const evidence = neighbours.length
    ? [`${neighbours.length} neighbouring movement${neighbours.length === 1 ? '' : 's'} compared: ${neighbours.filter(n => n.kind === 'progressing').length} still progressing.`]
    : ['No other logged movement shares this pattern or muscle closely enough to compare.'];
  if(!neighbours.length) return { id: 'neighbour-progress', label: 'Neighbouring movements', verdict: 'unclear', finding: 'No comparable movements', evidence };
  const progressing = neighbours.filter(n => n.kind === 'progressing');
  const stalled = neighbours.filter(n => n.kind === 'genuine' || n.kind === 'bad-sessions');
  if(stalled.length >= Math.max(1, Math.ceil(neighbours.length / 2))){
    return { id: 'neighbour-progress', label: 'Neighbouring movements', verdict: 'cause', finding: 'Stall is systemic', evidence: [...evidence, `Also stalled: ${stalled.slice(0, 3).map(n => n.name).join(', ')} — this looks like a shared (muscle/recovery) stall, not one bad movement.`] };
  }
  if(progressing.length){
    return { id: 'neighbour-progress', label: 'Neighbouring movements', verdict: 'clear', finding: 'Stall is movement-specific', evidence: [...evidence, `Still improving: ${progressing.slice(0, 3).map(n => n.name).join(', ')} — the pattern itself works; this movement is the outlier.`] };
  }
  return { id: 'neighbour-progress', label: 'Neighbouring movements', verdict: 'unclear', finding: 'Mixed signal', evidence };
}

// ── Diagnosis + recommendation ──────────────────────────────────────────

function recommendFix(flagged, exerciseId, { history, readinessLog, config }){
  const name = EXERCISE_BY_ID[exerciseId]?.name || exerciseId;
  const ids = new Set(flagged.map(c => c.id));
  // Recovery outranks levers: a poor-recovery stall responds to rest, not to
  // more/less work — pushing volume on a bad-recovery athlete makes it worse.
  if(ids.has('recovery')){
    return {
      headline: 'Recover first, then re-test',
      detail: 'Readiness deteriorated across the stall window. Hold the prescription, protect sleep and add an easy day; re-test this movement after readiness rebounds.',
      kind: 'recover',
    };
  }
  if(ids.has('volume-trend')){
    return {
      headline: `Restore volume on ${name}`,
      detail: 'Weekly hard sets dropped during the stall. Bring them back to the pre-stall level (or slightly above) for 2–3 weeks before changing anything else.',
      kind: 'volume-up',
    };
  }
  if(ids.has('effort-drift')){
    const driftCheck = flagged.find(c => c.id === 'effort-drift');
    if(driftCheck?.finding === 'Effort falling'){
      return {
        headline: `Raise the load target on ${name}`,
        detail: 'The same work now feels easier — progress the prescription (load or reps) rather than the exercise.',
        kind: 'intensity-up',
      };
    }
    return {
      headline: `Back off on ${name} for one week`,
      detail: 'Effort has been climbing while output stayed flat. One deliberately easy week (−1 set per exercise, loads at RPE 7) often restarts progress.',
      kind: 'backoff',
    };
  }
  if(ids.has('frequency')){
    return {
      headline: `Train ${name} twice weekly`,
      detail: 'Exposure is currently too sparse to drive progress. Add one smaller session with this pattern before considering harder changes.',
      kind: 'frequency-up',
    };
  }
  if(ids.has('neighbour-progress')){
    return {
      headline: `Swap ${name} for a close variation`,
      detail: 'The pattern still responds elsewhere — this specific movement is the outlier. Swap to the highest-ranked close variation for one block, then optionally return.',
      kind: 'swap',
    };
  }
  return {
    headline: `Deload, then re-test ${name}`,
    detail: 'No single cause stands out. Run a short deload (volume −30–50%, loads moderate) and re-test; a genuine ceiling responds to a reset more often than to a swap.',
    kind: 'deload',
  };
}

function buildDiagnosis(flagged, exerciseId, windowWeeks){
  const name = EXERCISE_BY_ID[exerciseId]?.name || exerciseId;
  if(!flagged.length) return `${name} has been flat for ~${windowWeeks} weeks with volume, effort, frequency and recovery all looking normal — the classic picture of a genuine ceiling.`;
  const causes = flagged.map(c => c.finding.toLowerCase()).join(', ');
  return `${name} has been flat for ~${windowWeeks} weeks while ${causes} — that is where the investigation points.`;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Hard sets/week for one exercise: sets with reps>0 and weight>0, or RPE ≥ 8 bodyweight. */
function weeklyHardSets(history, exerciseId){
  const byWeek = new Map();
  for(const session of history || []){
    for(const block of session.blocks || []){
      if(block.exerciseId !== exerciseId) continue;
      let hard = 0;
      for(const set of block.sets || []){
        const reps = Number(String(set.reps).match(/\d+/)?.[0] || set.reps) || 0;
        const weight = Number(set.weightKg) || 0;
        const rpe = set.rpe != null ? Number(set.rpe) : null;
        if(reps > 0 && (weight > 0 || (Number.isFinite(rpe) && rpe >= 8))) hard++;
      }
      if(hard > 0 && session.dateISO){
        const key = weekStartISO(session.dateISO);
        byWeek.set(key, (byWeek.get(key) || 0) + hard);
      }
    }
  }
  return [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, hardSets]) => ({ week, hardSets }));
}

function weekStartISO(dateISO){
  const t = Date.parse(`${dateISO}T00:00:00`);
  if(!Number.isFinite(t)) return dateISO;
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(t - day * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth()+1)}-${pad(monday.getDate())}`;
}

function mean(arr){
  const v = (arr || []).filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function round1(n){ return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; }

/** One row per session: the exercise's best set (e1RM score), date-ordered.
 * Mirrors programming.js exerciseLogs (kept local — that helper is not exported). */
function bestPerSession(history, exerciseId){
  const bySession = new Map();
  for(const session of history || []){
    let best = null;
    for(const block of session.blocks || []){
      if(block.exerciseId !== exerciseId) continue;
      for(const set of block.sets || []){
        const reps = Number(String(set.reps).match(/\d+/)?.[0] || set.reps) || 0;
        const weightKg = Number(set.weightKg) || 0;
        const score = e1rm(weightKg, reps) || reps;
        if(reps > 0 && (!best || score > best.score)) best = { score, dateISO: session.dateISO };
      }
    }
    if(best && !bySession.has(session.dateISO)) bySession.set(session.dateISO, best);
  }
  return [...bySession.values()].sort((a, b) => String(a.dateISO || '').localeCompare(String(b.dateISO || '')));
}
