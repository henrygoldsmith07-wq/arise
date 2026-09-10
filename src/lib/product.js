// product.js — the pure product-insight layer.
//
// Everything here is deterministic arithmetic over the store the user already
// owns: milestone progress, consistency chains, the monthly digest, the next
// best action, and "what changed and why" summaries. No storage access, no
// React, no wall-clock reads (the caller supplies `today`) — the same purity
// contract as the engine, so all of it is unit-testable and demo-safe.
//
// Tone rules for every string that leaves this module:
//   - never guilt ("you missed", "you broke your streak" do not appear);
//   - lapsed is a restart, not a failure ("fresh start" framing);
//   - numbers are shown with their basis, never as verdicts;
//   - nothing here ranks the user against other people — there is no "them".

import { EXERCISE_BY_ID } from './data.js';
import { weeklyVolume, recommendationFollowThrough } from './analytics.js';
import { strengthTrendWithConfidence } from './progression.js';
import { programAdherence } from './programming.js';
import { weekPhaseFor } from './mesocycle.js';

/** Milestone ladder. Ordered; a milestone unlocks when its bar is reached. */
export const MILESTONES = [
  { id: 'first-session', sessions: 1, label: 'First session logged', emoji: '🎬' },
  { id: 'week-one', sessions: 3, label: 'Three sessions in', emoji: '🌱' },
  { id: 'ten', sessions: 10, label: 'Ten sessions — a habit forming', emoji: '🧗' },
  { id: 'twentyfive', sessions: 25, label: 'Twenty-five sessions', emoji: '⛰️' },
  { id: 'fifty', sessions: 50, label: 'Fifty sessions — half a year of showing up', emoji: '🏔️' },
  { id: 'hundred', sessions: 100, label: 'One hundred sessions', emoji: '🏛️' },
  { id: 'twohundred', sessions: 200, label: 'Two hundred sessions', emoji: '🌌' },
  { id: 'fivehundred', sessions: 500, label: 'Five hundred sessions', emoji: '🚀' },
];

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * Milestone state: which are reached, which is next, and how far away it is.
 * A history spanning months shows more reached milestones than a fresh one;
 * the ladder is deliberately session-count based (the one number that never
 * lies about showing up).
 */
export function milestoneState(history){
  const count = (history || []).length;
  const reached = MILESTONES.filter((m) => count >= m.sessions);
  const next = MILESTONES.find((m) => count < m.sessions) || null;
  const last = reached[reached.length - 1] || null;
  return {
    count,
    reached,
    last,
    next,
    toNext: next ? next.sessions - count : 0,
    pctToNext: next ? Math.min(100, Math.round((count / next.sessions) * 100)) : 100,
  };
}

/** Training age in months from the first logged session, with a phase label. */
export function trainingAgeDisplay(history, { today } = {}){
  const dates = (history || []).map((h) => h?.dateISO).filter(Boolean).sort();
  if(!dates.length || !today) return { months: null, started: null, phase: null };
  const months = daysBetween(dates[0], today) / 30.44;
  const phase = months < 3 ? 'New' : months < 12 ? 'Establishing' : months < 36 ? 'Committed' : 'Veteran';
  return { months: Math.max(0.1, Math.round(months * 10) / 10), started: dates[0], phase };
}

/**
 * Weekly consistency over the trailing `weeks` Monday-anchored weeks:
 * weeks with any session vs weeks elapsed. Designed for a "3 of the last
 * 4 weeks" display, never a guilt score. Ties to nothing, ranks against
 * nothing, compares to no one.
 */
export function consistencyInsights(history, { today, weeks = 6 } = {}){
  if(!today) return { weeksActive: 0, weeksElapsed: 0, rate: null, currentRunWeeks: 0 };
  const startMs = Date.parse(`${today}T00:00:00Z`);
  const monday = new Date(startMs - ((new Date(startMs).getUTCDay() + 6) % 7) * 86400000);
  const weekKeys = [];
  for(let i = weeks - 1; i >= 0; i--) weekKeys.push(new Date(monday.getTime() - i * 7 * 86400000).toISOString().slice(0, 10));
  const activeWeeks = new Set();
  for(const h of history || []){
    if(!h?.dateISO) continue;
    const d = Date.parse(`${h.dateISO}T00:00:00Z`);
    const wm = new Date(d - ((new Date(d).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    if(weekKeys.includes(wm)) activeWeeks.add(wm);
  }
  // Weeks the app could have known about: cap at the span since the first
  // session so a brand-new user is never shown a frightening denominator.
  const first = (history || []).map((h) => h?.dateISO).filter(Boolean).sort()[0] || today;
  const spanWeeks = Math.min(weeks, Math.max(1, Math.ceil(daysBetween(first, today) / 7) || 1));
  const counted = weekKeys.filter((w) => w >= new Date(Date.parse(`${first}T00:00:00Z`) - ((new Date(Date.parse(`${first}T00:00:00Z`)).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10));
  const weeksElapsed = Math.min(spanWeeks, counted.length);
  // Current run: consecutive active weeks ending this week or last week
  // (mid-week grace — Sunday does not "break" anything).
  let run = 0;
  for(let i = weekKeys.length - 1; i >= 0; i--){
    if(activeWeeks.has(weekKeys[i])) run++;
    else if(i === weekKeys.length - 1) continue; // this week still in progress
    else break;
  }
  return {
    weeksActive: activeWeeks.size,
    weeksElapsed,
    rate: weeksElapsed ? activeWeeks.size / weeksElapsed : null,
    currentRunWeeks: run,
  };
}

/**
 * The monthly digest: one calm paragraph of facts for the calendar month the
 * caller names (default: the month before the current one). Pure aggregation
 * over logged history; every line carries its basis.
 */
export function monthlyDigest(history, { today, byId = null, month = null } = {}){
  if(!today) return null;
  const anchor = month || (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const sessions = (history || [])
    .filter((h) => typeof h?.dateISO === 'string' && h.dateISO.startsWith(`${anchor}-`))
    .sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
  const volume = sessions.reduce((sum, s) => sum + (s.blocks || []).reduce((acc, b) => acc + (b.sets || []).reduce((a, st) => a + (Number(st.reps) || 0) * Math.max(0, (Number(st.weightKg) || 0) - (Number(st.assistedKg) || 0)), 0), 0), 0);
  const sets = sessions.reduce((a, s) => a + (s.blocks || []).reduce((acc, b) => acc + (b.sets || []).length, 0), 0);
  const muscles = {};
  if(byId){
    for(const s of sessions) for(const b of s.blocks || []){
      const m = byId[b.exerciseId]?.muscle;
      if(m) muscles[m] = (muscles[m] || 0) + 1;
    }
  }
  const topMuscle = Object.entries(muscles).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const minutes = sessions.reduce((a, s) => a + (Number(s.durationMinutes) || 0), 0);
  const notes = sessions.filter((s) => s.note).length;
  return {
    month: anchor,
    sessions: sessions.length,
    volume: Math.round(volume),
    sets,
    minutes,
    topMuscle,
    notes,
    first: sessions[0]?.dateISO || null,
    last: sessions[sessions.length - 1]?.dateISO || null,
  };
}

/**
 * Next best action: ONE recommendation for right now, deterministic, drawn
 * from the state the user already has. This is guidance, not a nag — the UI
 * renders it once and never counts down at anyone.
 */
export function nextBestAction({ store, today, todaySession, nextSess, recovery } = {}){
  const history = store?.history || [];
  if(!store?.onboarding) return { id: 'onboard', title: 'Set your goal and kit', detail: 'Two minutes of onboarding makes every recommendation honest — equipment, location, level.', tab: null };
  if(!store?.activeSchedule) return { id: 'choose-program', title: 'Choose a program', detail: 'A program becomes a dated schedule so you always know what is next.', tab: 'train' };
  if(todaySession) return { id: 'start-today', title: `Start ${todaySession.title}`, detail: 'Today’s session is ready — the runner walks you through every set.', tab: null };
  if(recovery?.needed) return { id: 'recover', title: 'Re-plan the schedule', detail: recovery.recommendation || 'The schedule can fold missed sessions forward — no debt, no guilt.', tab: null };
  if(nextSess) return { id: 'preview-next', title: `Up next: ${nextSess.title}`, detail: 'Skim the blocks now so the first set feels easy to start.', tab: null };
  const ms = milestoneState(history);
  if(ms.next) return { id: 'milestone', title: `${ms.toNext} sessions to “${ms.next.label}”`, detail: 'Every logged session moves the ladder.', tab: 'progress' };
  return { id: 'review', title: 'Review your week', detail: 'The Weekly Review turns your logs into next week’s plan.', tab: 'today' };
}

/**
 * "What changed and why": a human summary of the latest programme
 * adaptation plus the newest engine explanations. Pure formatting over
 * records the app already stores — it never invents a reason.
 */
export function whatChangedSummary({ schedule, history = [], limit = 3 } = {}){
  const out = [];
  const adaptation = schedule?.lastAdaptation;
  if(adaptation?.changes?.length){
    out.push({
      when: adaptation.dateISO,
      kind: 'programme',
      lines: adaptation.changes.slice(0, limit).map((c) => `${c.exerciseId}: ${c.reason}`),
    });
  }
  const latest = [...(history || [])].sort((a, b) => String(b.dateISO).localeCompare(String(a.dateISO)))[0];
  if(latest?.adaptationBasis?.length){
    out.push({ when: latest.dateISO, kind: 'session', lines: latest.adaptationBasis.slice(0, limit).map((b) => b.reason || String(b)) });
  }
  return out;
}

// ── Evidence-gated progress assessment ────────────────────────────────
// Total lifted volume is deliberately a supporting signal only: adding weight
// to the bar for no additional performance is not progress, and a planned
// deload can reduce volume while training is exactly on track. A verdict
// therefore needs repeated-exercise performance, prescription follow-through,
// enough recent exposures, and programme context.
//
// Every displayed string is built from the returned calculations; the UI only
// chooses how many of those strings each experience mode may show.
const PROGRESS_WINDOW_DAYS = 42;
const PROGRESS_RECENT_LIMIT = 8;
const PROGRESS_MIN_SESSIONS = 6;
const PROGRESS_MIN_EXERCISE_EXPOSURES = 4;
const PROGRESS_MIN_TARGET_CHECKS = 4;
const PROGRESS_TARGET_SUCCESS_PCT = 75;
const PROGRESS_MEANINGFUL_LOAD_PCT = 0.02;
const PROGRESS_MEANINGFUL_LOAD_KG = 0.5;
const PROGRESS_MEANINGFUL_REP_GAIN = 1;
const TECHNIQUE_CHANGE_PATTERN = /rom|depth|range|technique|form|paused|tempo|assisted|band|partial/i;

function parseProgressDate(value){
  const time = Date.parse(`${value || ''}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

function orderProgressSessions(history){
  return (history || [])
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => parseProgressDate(session?.dateISO) != null)
    .sort((a, b) => String(a.session.dateISO).localeCompare(String(b.session.dateISO))
      || String(a.session.savedAt || '').localeCompare(String(b.session.savedAt || ''))
      || a.index - b.index)
    .map(({ session }) => session);
}

function mondayKeyFor(dateISO){
  const time = parseProgressDate(dateISO);
  const monday = new Date(time - (((new Date(time)).getUTCDay() + 6) % 7) * 86400000);
  return monday.toISOString().slice(0, 10);
}

function parseProgressReps(value){
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function exerciseLabel(exerciseId){
  return EXERCISE_BY_ID[exerciseId]?.name || String(exerciseId || 'exercise');
}

function bestProgressSet(sets){
  let best = null;
  for(const set of sets || []){
    if(!set || set.skipped) continue;
    const reps = parseProgressReps(set.reps);
    const weightKg = Math.max(0, (Number(set.weightKg) || 0) - (Number(set.assistedKg) || 0));
    if(!(reps > 0 || weightKg > 0)) continue;
    const loaded = weightKg > 0;
    const value = loaded ? weightKg * (1 + reps / 30) : reps;
    if(!best || value > best.value || (value === best.value && reps > best.reps)){
      best = { reps, weightKg, loaded, value, rom: set.rom || null };
    }
  }
  return best;
}

function progressExposures(sessions){
  const byExercise = new Map();
  sessions.forEach((session, sessionIndex) => {
    const bestByExercise = new Map();
    for(const block of session.blocks || []){
      if(!block?.exerciseId) continue;
      const best = bestProgressSet(block.sets);
      if(!best) continue;
      const current = bestByExercise.get(block.exerciseId);
      if(!current || best.value > current.value) bestByExercise.set(block.exerciseId, best);
    }
    for(const [exerciseId, best] of bestByExercise){
      if(!byExercise.has(exerciseId)) byExercise.set(exerciseId, []);
      byExercise.get(exerciseId).push({ ...best, exerciseId, dateISO: session.dateISO, sessionIndex });
    }
  });
  return byExercise;
}

function progressTrend(exerciseId, exposures){
  const weighted = exposures.filter((exposure) => exposure.loaded);
  const bodyweight = exposures.filter((exposure) => !exposure.loaded);
  const useWeighted = weighted.length >= bodyweight.length && weighted.length > 0;
  const series = (useWeighted ? weighted : bodyweight).slice().sort((a, b) => a.sessionIndex - b.sessionIndex);
  if(series.length < PROGRESS_MIN_EXERCISE_EXPOSURES) return null;
  const trend = strengthTrendWithConfidence(series.map((exposure) => ({ reps: exposure.reps, weightKg: exposure.loaded ? exposure.weightKg : 0 })));
  const first = series[0].value;
  const last = series[series.length - 1].value;
  const gain = last - first;
  const relative = first > 0 ? gain / first : 0;
  let direction = 'flat';
  if(useWeighted){
    if(gain >= PROGRESS_MEANINGFUL_LOAD_KG && relative >= PROGRESS_MEANINGFUL_LOAD_PCT && trend.slope > 0) direction = 'up';
    else if(gain <= -PROGRESS_MEANINGFUL_LOAD_KG && relative <= -PROGRESS_MEANINGFUL_LOAD_PCT && trend.slope < 0) direction = 'down';
  }else if(gain >= PROGRESS_MEANINGFUL_REP_GAIN && trend.slope > 0){
    direction = 'up';
  }else if(gain <= -PROGRESS_MEANINGFUL_REP_GAIN && trend.slope < 0){
    direction = 'down';
  }
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  const unit = useWeighted ? 'e1RM' : 'reps';
  return {
    exerciseId,
    name: exerciseLabel(exerciseId),
    direction,
    loaded: useWeighted,
    exposures: series.length,
    first: Math.round(first * 10) / 10,
    last: Math.round(last * 10) / 10,
    changePct: first > 0 ? Math.round(relative * 1000) / 10 : null,
    slope: trend.slope,
    confidence: trend.confidence,
    label: `Strength trend ${arrow}`,
    detail: `${exerciseLabel(exerciseId)}: ${Math.round(first * 10) / 10} → ${Math.round(last * 10) / 10} ${unit} across ${series.length} sessions`,
  };
}

function techniqueChanged(session, best){
  return TECHNIQUE_CHANGE_PATTERN.test(`${session?.note || ''} ${best?.rom || ''}`);
}

function progressRecentBests(ordered, comparableDates){
  const comparable = new Set((comparableDates || []).map((session) => session.dateISO));
  const baselines = new Map();
  const bests = new Map();
  for(const session of ordered){
    const bestByExercise = new Map();
    for(const block of session.blocks || []){
      if(!block?.exerciseId) continue;
      const best = bestProgressSet(block.sets);
      if(!best || techniqueChanged(session, best)) continue;
      const key = `${block.exerciseId}:${best.loaded ? 'loaded' : 'bodyweight'}`;
      const baseline = baselines.get(key) || { count: 0, best: 0, exerciseId: block.exerciseId, loaded: best.loaded };
      if(baseline.count >= 3){
        const qualifies = best.loaded
          ? best.value > baseline.best * (1 + PROGRESS_MEANINGFUL_LOAD_PCT) && best.value > baseline.best + PROGRESS_MEANINGFUL_LOAD_KG
          : best.value >= baseline.best + PROGRESS_MEANINGFUL_REP_GAIN;
        if(qualifies && comparable.has(session.dateISO)){
          bests.set(block.exerciseId, {
            exerciseId: block.exerciseId,
            name: exerciseLabel(block.exerciseId),
            dateISO: session.dateISO,
            detail: best.loaded ? `${exerciseLabel(block.exerciseId)}: ${best.weightKg} × ${best.reps}` : `${exerciseLabel(block.exerciseId)}: ${best.reps} reps`,
          });
        }
      }
      baselines.set(key, {
        ...baseline,
        count: baseline.count + 1,
        best: Math.max(baseline.best, best.value),
      });
    }
  }
  return [...bests.values()].sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
}

function progressVolumeContext(history, comparable){
  const weeks = weeklyVolume(history || []);
  if(weeks.length < 2){
    return { status: 'insufficient', label: 'Training volume', detail: 'Need two weeks with logged training to describe volume context.' };
  }
  const previous = weeks[weeks.length - 2];
  const last = weeks[weeks.length - 1];
  if(previous.vol > 0 && last.vol > 0){
    const changePct = Math.round((last.vol / previous.vol - 1) * 100);
    const status = changePct > 10 ? 'up' : changePct < -10 ? 'down' : 'stable';
    return {
      status,
      label: `Training volume ${status}`,
      detail: `Training volume is ${status} (${previous.vol.toLocaleString()} → ${last.vol.toLocaleString()} kg). Context only — it does not decide the verdict.`,
      changePct,
      previous: previous.vol,
      last: last.vol,
    };
  }
  const recentLoaded = (comparable || []).some((session) => (session.blocks || []).some((block) => (block.sets || []).some((set) => Number(set.weightKg) > 0)));
  return {
    status: 'untracked',
    label: 'Training volume',
    detail: recentLoaded
      ? 'Volume mixes loaded and bodyweight-only weeks, so the kilogram totals are not comparable here.'
      : 'Bodyweight-only sessions track reps, not lifted kilograms, so volume is context only.',
  };
}

/**
 * Evidence-gated answer to “Am I improving?”.
 *
 * Volume can rise while performance stalls, and a deload can cut volume while
 * training stays on track. The verdict therefore requires repeated-exercise
 * performance plus prescription follow-through; volume, adherence and recent
 * bests can support but never decide it.
 */
export function progressAssessment({ history = [], schedule = null, today = null } = {}){
  const ordered = orderProgressSessions(history);
  const end = today ? parseProgressDate(today) : null;
  const phase = schedule && today ? weekPhaseFor(schedule, today) : null;
  const phaseWeek = today && (phase?.kind === 'deload' || phase?.kind === 'recovery') ? mondayKeyFor(today) : null;
  const recent = ordered
    .filter((session) => end == null || parseProgressDate(session.dateISO) <= end)
    .filter((session) => end == null || end - parseProgressDate(session.dateISO) <= PROGRESS_WINDOW_DAYS * 86400000)
    .slice(-PROGRESS_RECENT_LIMIT);
  // A planned deload or recovery week is intentionally easier. Judge progress
  // on comparable build-week work instead of letting that planned dip read as
  // regression.
  const comparable = phaseWeek ? recent.filter((session) => mondayKeyFor(session.dateISO) !== phaseWeek) : recent;
  const exposures = progressExposures(comparable);
  const trends = [...exposures.entries()]
    .map(([exerciseId, exerciseExposures]) => progressTrend(exerciseId, exerciseExposures))
    .filter(Boolean)
    .sort((a, b) => b.exposures - a.exposures || a.exerciseId.localeCompare(b.exerciseId));
  const targets = recommendationFollowThrough(comparable);
  const targetPct = Number.isFinite(targets.followedPct) ? targets.followedPct : null;
  const adherence = schedule && today ? programAdherence(schedule, history, { today }) : null;
  const adherenceSupport = adherence && adherence.due >= 3 && adherence.toDateRate != null;
  const phaseContext = phase?.kind === 'deload' || phase?.kind === 'recovery'
    ? `Programme context: a planned ${phase.kind} week. Lower volume here is intentional, not regression.`
    : null;
  const bests = progressRecentBests(ordered, comparable);
  const volume = progressVolumeContext(history, comparable);
  const sample = {
    sessions: comparable.length,
    exposures: trends.reduce((sum, trend) => sum + trend.exposures, 0),
    exercises: trends.length,
    targetChecks: targets.n || 0,
  };

  if(sample.sessions < PROGRESS_MIN_SESSIONS){
    const reason = `Not enough evidence yet — ${sample.sessions} comparable session${sample.sessions === 1 ? '' : 's'} logged. Keep training and Arise will assess the trend when there is enough data.`;
    return {
      verdict: 'insufficient-evidence',
      title: 'Not enough evidence yet',
      reason,
      primaryReason: reason,
      reasons: phaseContext ? [reason, phaseContext] : [reason],
      signals: [],
      evidence: 'Low',
      sample,
      phase,
      phaseContext,
      volume,
      basis: `Based on ${sample.sessions} recent sessions`,
    };
  }
  if(!trends.length){
    const reason = 'Not enough evidence yet — there are too few repeated-exercise comparisons. Repeat the same lifts before judging progress.';
    return {
      verdict: 'insufficient-evidence',
      title: 'Not enough evidence yet',
      reason,
      primaryReason: reason,
      reasons: phaseContext ? [reason, phaseContext] : [reason],
      signals: [],
      evidence: 'Low',
      sample,
      phase,
      phaseContext,
      volume,
      basis: `Based on ${sample.sessions} recent sessions`,
    };
  }
  if(targets.n < PROGRESS_MIN_TARGET_CHECKS || targetPct == null){
    const reason = `Not enough evidence yet — only ${targets.n || 0} prescription checks are available. Keep logging complete sessions so targets can be compared with performance.`;
    return {
      verdict: 'insufficient-evidence',
      title: 'Not enough evidence yet',
      reason,
      primaryReason: reason,
      reasons: phaseContext ? [reason, phaseContext] : [reason],
      signals: [],
      evidence: 'Low',
      sample,
      phase,
      phaseContext,
      volume,
      basis: `Based on ${sample.sessions} recent sessions`,
    };
  }

  const ups = trends.filter((trend) => trend.direction === 'up');
  const downs = trends.filter((trend) => trend.direction === 'down');
  const evidence = sample.sessions >= 8 && sample.exercises >= 2 && sample.targetChecks >= 8 ? 'High' : 'Moderate';
  const trendNames = (list) => list.map((trend) => trend.name).join(', ');
  const reasons = [];
  if(ups.length && !downs.length && targetPct >= PROGRESS_TARGET_SUCCESS_PCT){
    reasons.push(`Strength is rising on ${trendNames(ups)} and ${targetPct}% of recent prescriptions were met.`);
  }else if(!ups.length && !downs.length){
    reasons.push(`Repeated lifts are holding their recent range and ${targetPct}% of recent prescriptions were met.`);
  }else{
    if(ups.length && downs.length) reasons.push(`Some lifts are rising (${trendNames(ups)}) while others are falling (${trendNames(downs)}).`);
    else if(downs.length) reasons.push(`Recent comparable lifts are below their earlier range (${trendNames(downs)}).`);
    else reasons.push(`Strength is rising on ${trendNames(ups)}, but only ${targetPct}% of recent prescriptions were met.`);
    if(bests.length) reasons.push(`Recent bests: ${bests.map((best) => best.name).join(', ')}.`);
  }
  if(bests.length && reasons.length < 2 && (!ups.length || downs.length)) reasons.push(`Recent bests: ${bests.map((best) => best.name).join(', ')}.`);
  if(phaseContext) reasons.push(phaseContext);
  const verdict = ups.length && !downs.length && targetPct >= PROGRESS_TARGET_SUCCESS_PCT
    ? 'likely-improving'
    : !ups.length && !downs.length
      ? 'holding-steady'
      : 'mixed-signals';
  const title = verdict === 'likely-improving' ? 'Likely improving' : verdict === 'holding-steady' ? 'Holding steady' : 'Mixed signals';
  const signals = [
    ...trends.map((trend) => ({
      id: `strength-${trend.exerciseId}`,
      kind: 'strength',
      label: trend.label,
      detail: trend.detail,
      direction: trend.direction,
      basis: trend,
    })),
    {
      id: 'prescription-targets',
      kind: 'targets',
      label: `Targets completed ${targetPct}%`,
      detail: `${targetPct}% of recent prescriptions met (${targets.n} checks).`,
      basis: targets,
    },
    ...bests.map((best) => ({
      id: `recent-best-${best.exerciseId}`,
      kind: 'recent-best',
      label: `Recent best: ${best.name}`,
      detail: best.detail,
      basis: best,
    })),
  ];
  if(adherenceSupport){
    const adherencePct = Math.round(adherence.toDateRate * 100);
    signals.push({
      id: 'programme-adherence',
      kind: 'adherence',
      label: `Adherence ${adherencePct}%`,
      detail: `${adherencePct}% of due sessions completed. Supporting context — showing up is not itself proof of progress.`,
      basis: adherence,
    });
  }
  if(volume.status !== 'insufficient'){
    signals.push({
      id: 'training-volume',
      kind: 'volume',
      label: volume.label,
      detail: volume.detail,
      contextOnly: true,
      basis: volume,
    });
  }
  const primaryReason = reasons[0];
  return {
    verdict,
    title,
    reason: primaryReason,
    primaryReason,
    reasons,
    signals,
    evidence,
    sample,
    phase,
    phaseContext,
    targets,
    adherence: adherenceSupport ? adherence : null,
    recentBests: bests,
    volume,
    basis: `Based on ${sample.sessions} recent sessions`,
  };
}

/**
 * Session-count streak with honest, healthy framing. Day-level streaks
 * punish rest days; a "weeks with training" run does not. Returned shape
 * powers both the Progress counter and the "no guilt" copy: a lapsed run
 * is reported as "best" plus "fresh start", never as a loss.
 */
export function healthyStreak(history, { today, weeks = 8 } = {}){
  const ci = consistencyInsights(history, { today, weeks });
  const totalSessions = (history || []).length;
  const best = Math.max(ci.currentRunWeeks, 0);
  return {
    currentWeeks: ci.currentRunWeeks,
    bestWeeks: best, // conservative: run-vs-run needs more state than a pure function has
    totalSessions,
    lapsed: ci.weeksElapsed > 0 && ci.currentRunWeeks === 0,
    framing: ci.currentRunWeeks > 0
      ? `${ci.currentRunWeeks} week${ci.currentRunWeeks === 1 ? '' : 's'} in a row`
      : 'fresh start this week',
  };
}
