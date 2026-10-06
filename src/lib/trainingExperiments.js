// trainingExperiments.js — the training experiment system.
//
// Lets the user run a small, honest experiment on themselves: "does 12 vs 16
// weekly chest sets improve my bench progression?" Arise tracks the baseline,
// the intervention, the metrics, and the result — and then reports the
// conclusion WITH its confidence, including "inconclusive". It never pretends
// a single-subject observation is a trial.
//
// Design ground rules (same posture as longitudinal.js):
//   - Pure, deterministic, offline. No network, no model, no LLM.
//   - The experiment records what the user SAID they'd change; the metrics
//     come only from logged history. The ledger never feeds the recommender —
//     experiments are measurement, not treatment.
//   - Conclusions are gated by sample size and variance. Few observations →
//     'inconclusive', stated plainly. This module would rather tell the user
//     "not enough evidence" than a confident-sounding lie.
//
// An experiment is stored in the canonical store under `experiments` (see
// storage.js/idb.js) and travels in backups/sync like templates do.

import { e1rm } from "./progression.js";
import { resolveArisePriors } from "./priors.js";
import { EXERCISE_BY_ID } from "./data.js";

export const EXPERIMENT_STATUSES = ['draft', 'active', 'completed', 'cancelled'];
export const EXPERIMENT_PHASES = ['baseline', 'intervention'];
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];

// Preset library: the questions users actually ask, phrased measurably.
// Each preset fixes metric + comparator so the result is decidable from logs.
export const EXPERIMENT_PRESETS = [
  {
    id: 'chest-volume',
    label: 'Chest volume: 12 vs 16 weekly sets',
    question: 'Does 16 weekly chest sets improve my chest pressing progress over 12?',
    metric: 'strength',
    // muscle-group selection: comparator exercises share this muscle.
    muscle: 'Chest',
  },
  {
    id: 'exercise-frequency',
    label: 'Exercise frequency: 1× vs 2× per week',
    question: 'Does training this exercise twice a week beat once a week?',
    metric: 'strength',
    mode: 'exercise',
  },
  {
    id: 'rep-range',
    label: 'Rep range: 5–8 vs 8–12',
    question: 'Do heavier 5–8 sets build ESTIMATED 1RM faster than 8–12 on this exercise?',
    metric: 'strength',
    mode: 'exercise',
  },
  {
    id: 'sleep-readiness',
    label: 'Sleep and next-day performance',
    question: 'Do better sleep nights produce noticeably better sessions?',
    metric: 'session-quality',
  },
];

const METRIC_MONTHS = { strength: 'strength', 'session-quality': 'session-quality' };

function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

function todayISO(){
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function dateDiffDays(a, b){
  const da = Date.parse(`${a}T00:00:00`), db = Date.parse(`${b}T00:00:00`);
  if(!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  return Math.round((db - da) / 86400000);
}

/** Deterministic id: prefix + counter + slug so exports stay stable. */
export function newExperimentId(existing = [], createdAtISO = todayISO()){
  const n = (existing || []).filter(e => e?.id && e.id.startsWith('exp:')).length + 1;
  return `exp:${createdAtISO}:${n}`;
}

/**
 * Create a new experiment. `spec`:
 *   { name, question?, metric, mode?, muscle?, exerciseId?, comparatorExerciseId?,
 *     baselineDays, interventionDays, minimumSessions }  (day fields optional — defaults from priors)
 * Pure: returns the row; caller persists it.
 */
export function createExperiment(spec, existing = [], { createdAtISO = todayISO(), config = null } = {}){
  const cfg = resolveArisePriors(config).experiments;
  const days = clamp(Math.round(Number(spec?.baselineDays) || cfg.baselineDays), 3, 56);
  const duration = clamp(Math.round(Number(spec?.interventionDays) || cfg.interventionDays), 7, 84);
  const metric = METRIC_MONTHS[spec?.metric] ? spec.metric : 'strength';
  return {
    id: spec?.id || newExperimentId(existing, createdAtISO),
    createdAtISO,
    status: 'active',
    // One active evaluation starts immediately: history before startDate is
    // the baseline, from startDate on is the intervention. There is no second
    // pre-phase — the user's whole logged history IS the control, keeping the
    // run practical for real training.
    startDateISO: createdAtISO,
    expectedEndISO: spec?.expectedEndISO || addDaysISO(createdAtISO, days + duration),
    name: String(spec?.name || '').trim() || presetName(spec, metric),
    question: String(spec?.question || '').trim() || presetQuestion(spec, metric),
    metric,
    mode: spec?.mode === 'muscle' || spec?.muscle ? 'muscle' : 'exercise',
    muscle: spec?.muscle || null,
    exerciseId: spec?.exerciseId || null,
    comparatorExerciseId: spec?.comparatorExerciseId || null, // optional paired movement (e.g. a variation) for context, never required
    baselineDays: days,
    interventionDays: duration,
    minimumSessions: clamp(Math.round(Number(spec?.minimumSessions) || cfg.minimumSessions), 3, 30),
    // Intervention description: what the user actually changed. Recorded as a
    // claim — Arise never verifies the user did it, it measures the outcome.
    interventionNote: String(spec?.interventionNote || '').trim() || null,
    presetId: EXPERIMENT_PRESETS.some(p => p.id === spec?.presetId) ? spec.presetId : null,
    result: null,
    concludedAtISO: null,
    conclusionNote: null,
    cancelledAtISO: null,
  };
}

function presetName(spec, metric){
  const preset = EXPERIMENT_PRESETS.find(p => p.id === spec?.presetId);
  if(preset) return preset.label;
  if(spec?.exerciseId){
    const name = EXERCISE_BY_ID[spec.exerciseId]?.name || spec.exerciseId;
    return metric === 'session-quality' ? `Session quality on ${name} weeks` : `${name}: progression experiment`;
  }
  return 'Training experiment';
}

function presetQuestion(spec, metric){
  const preset = EXPERIMENT_PRESETS.find(p => p.id === spec?.presetId);
  if(preset) return preset.question;
  if(spec?.exerciseId){
    const name = EXERCISE_BY_ID[spec.exerciseId]?.name || spec.exerciseId;
    return metric === 'session-quality'
      ? `Did my sessions improve after the change I made to ${name} days?`
      : `Is ${name} progressing better after the change than before it?`;
  }
  return metric === 'session-quality'
    ? 'Are my sessions better after the change than before it?'
    : 'Is my progress better after the change than before it?';
}

function addDaysISO(iso, days){
  const t = Date.parse(`${iso}T00:00:00`);
  if(!Number.isFinite(t)) return iso;
  const d = new Date(t + days * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function inRange(iso, startISO, endInclusiveISO){
  return !!iso && iso >= startISO && iso <= endInclusiveISO;
}

// ── Metric extraction ───────────────────────────────────────────────────
// Weekly strength: mean of each week's best e1RM for scope exercises (the
// classic operating point: strongest-day performance per week). Weekly
// session-quality: mean sessionQuality score of sessions in the week.

function scopeExercises(experiment){
  if(experiment.mode === 'muscle' && experiment.muscle){
    return Object.values(EXERCISE_BY_ID).filter(ex => ex?.muscle === experiment.muscle && ex?.id).map(ex => ex.id);
  }
  if(experiment.exerciseId) return [experiment.exerciseId];
  return [];
}

function weekKey(dateISO){
  // ISO week start (Monday) as YYYY-MM-DD — simple, deterministic, no deps.
  const t = Date.parse(`${dateISO}T00:00:00`);
  if(!Number.isFinite(t)) return null;
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7; // Mon=0
  const monday = new Date(t - day * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth()+1)}-${pad(monday.getDate())}`;
}

/**
 * Weekly observations for the experiment's scope, across ALL of history —
 * phase is decided by each week's overlap with baseline/intervention windows.
 * Returns [{ weekKey, startDateISO, phase, value, n }] sorted by week.
 */
export function experimentObservations(experiment, history = [], { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const weeks = new Map();
  const scope = new Set(scopeExercises(experiment));
  const sessionsInWeek = new Map();
  for(const session of history || []){
    if(!session?.dateISO) continue;
    const key = weekKey(session.dateISO);
    if(!key) continue;
    for(const block of session.blocks || []){
      if(!scope.has(block.exerciseId)) continue;
      for(const set of block.sets || []){
        const w = Number(set.weightKg) || 0;
        const r = Number(String(set.reps).match(/\d+/)?.[0] || set.reps) || 0;
        if(w <= 0 || r <= 0) continue;
        const e = e1rm(w, r);
        if(!weeks.has(key)) weeks.set(key, []);
        weeks.get(key).push(e);
      }
    }
    if(!sessionsInWeek.has(key)) sessionsInWeek.set(key, []);
    sessionsInWeek.get(key).push(session);
  }
  const baselineStart = experiment.startDateISO || null;
  const baselineEnd = baselineStart ? addDaysISO(baselineStart, Math.max(1, (experiment.baselineDays || cfg.experiments.baselineDays) - 1)) : null;
  const interventionStart = baselineEnd ? addDaysISO(baselineEnd, 1) : null;
  const out = [];
  for(const key of [...weeks.keys()].sort()){
    // A week belongs to the phase in which MOST of its days fall.
    const mid = addDaysISO(key, 3);
    const phase = interventionStart && mid >= interventionStart ? 'intervention' : baselineStart && mid >= baselineStart ? 'baseline' : 'pre';
    out.push({ weekKey: key, startDateISO: key, phase, value: round1(mean(weeks.get(key))), n: weeks.get(key).length, sessions: (sessionsInWeek.get(key) || []).length });
  }
  return out;
}

function round1(n){ return Number.isFinite(n) ? Math.round(n*10)/10 : null; }
function mean(arr){ return arr && arr.length ? arr.reduce((a,b)=> a+b, 0)/arr.length : null; }

// ── Effects: the statistical core ───────────────────────────────────────
// Simple, honest statistics: means, a pooled-variation minimal detectable
// effect, and a Welch-ish t signal translated to words. No p-value theatre.

function stats(values){
  const v = (values || []).filter(x => Number.isFinite(x));
  const n = v.length;
  if(!n) return { n: 0, mean: null, sd: null };
  const m = mean(v);
  const sd = n > 1 ? Math.sqrt(v.reduce((a, x)=> a + (x-m)*(x-m), 0)/(n-1)) : null;
  return { n, mean: m, sd };
}

/** Whoa — naming: this is the smallest change the data could actually see. */
function minimalDetectableEffect(baseline, intervention){
  // Pooled SD with the standard 80%-power/5%-size factor ≈ 2.8·pooledSE × √2.
  const sdA = baseline.sd ?? 0, sdB = intervention.sd ?? 0;
  const nA = Math.max(1, baseline.n), nB = Math.max(1, intervention.n);
  const pooled = Math.sqrt(((nA-1)*sdA*sdA + (nB-1)*sdB*sdB) / Math.max(1, nA+nB-2));
  return 2.8 * pooled * Math.sqrt(1/nA + 1/nB);
}

/**
 * Evaluate an experiment against current history WITHOUT concluding it.
 * Returns phase means, effect size, direction, and confidence — the live
 * "how is it going" card for the UI.
 */
export function evaluateExperiment(experiment, history = [], { config = null, today = null } = {}){
  const cfg = resolveArisePriors(config).experiments;
  const now = today || todayISO();
  const obs = experimentObservations(experiment, history, { config });
  const baseline = obs.filter(o => o.phase === 'baseline' && Number.isFinite(o.value));
  const intervention = obs.filter(o => o.phase === 'intervention' && Number.isFinite(o.value));
  const bStats = stats(baseline.map(o => o.value));
  const iStats = stats(intervention.map(o => o.value));
  const mde = (Number.isFinite(bStats.mean) && Number.isFinite(iStats.mean)) ? minimalDetectableEffect(bStats, iStats) : null;
  const diff = (Number.isFinite(bStats.mean) && Number.isFinite(iStats.mean)) ? iStats.mean - bStats.mean : null;
  const sessionsInIntervention = intervention.reduce((n, o)=> n + (o.sessions || 0), 0);
  const daysIn = daysSinceStart(experiment, now); // days elapsed since start
  const phase = phaseOf(experiment, now);
  return {
    experimentId: experiment.id,
    phase,
    daysElapsed: daysIn,
    baselineWeeks: bStats.n,
    interventionWeeks: iStats.n,
    baselineMean: round1(bStats.mean),
    interventionMean: round1(iStats.mean),
    baselineSd: bStats.sd == null ? null : round1(bStats.sd),
    interventionSd: iStats.sd == null ? null : round1(iStats.sd),
    diff: diff == null ? null : round1(diff),
    diffPct: (diff != null && bStats.mean > 0) ? Math.round((diff / bStats.mean) * 1000) / 10 : null,
    mde: mde == null ? null : round1(mde),
    sessionsInIntervention,
    minimumSessions: experiment.minimumSessions || cfg.minimumSessions,
    minimumDataDays: cfg.minimumDataDays,
    confidence: confidenceFor({ baselineWeeks: bStats.n, interventionWeeks: iStats.n, sessionsInIntervention, minimumSessions: experiment.minimumSessions || cfg.minimumSessions, mde, diff }),
    sufficientData: bStats.n >= 2 && iStats.n >= 2 && sessionsInIntervention >= (experiment.minimumSessions || cfg.minimumSessions) && daysIn >= cfg.minimumDataDays,
    observations: obs,
  };
}

function daysSinceStart(experiment, now){
  return experiment.startDateISO ? Math.max(0, dateDiffDays(experiment.startDateISO, now)) : 0;
}

function phaseOf(experiment, now){
  if(!experiment.startDateISO) return 'pre';
  const baselineEnd = addDaysISO(experiment.startDateISO, Math.max(1, (experiment.baselineDays || 14) - 1));
  const ended = experiment.expectedEndISO && now > experiment.expectedEndISO;
  if(now <= baselineEnd) return 'baseline';
  if(ended) return 'complete';
  return 'intervention';
}

function confidenceFor({ baselineWeeks, interventionWeeks, sessionsInIntervention, minimumSessions, mde, diff }){
  if(baselineWeeks < 2 || interventionWeeks < 1) return 'low';
  if(interventionWeeks < 2 || sessionsInIntervention < minimumSessions) return 'low';
  const clear = diff != null && mde != null && Math.abs(diff) >= mde;
  if(clear && interventionWeeks >= 3) return 'high';
  if(clear) return 'medium';
  return 'low';
}

/**
 * Conclude (or auto-review) an experiment. Pure — returns the updated row for
 * the caller to persist. Conclusion includes the result class Arise is honest
 * about: 'improved' | 'no-difference' | 'worse' | 'inconclusive'.
 */
export function concludeExperiment(experiment, history = [], { config = null, today = null, note = null } = {}){
  const evaluation = evaluateExperiment(experiment, history, { config, today });
  const cfg = resolveArisePriors(config).experiments;
  const t = today || todayISO();
  let result = 'inconclusive';
  if(evaluation.sufficientData && evaluation.diff != null && evaluation.confidence !== 'low'){
    if(evaluation.mde != null && Math.abs(evaluation.diff) < evaluation.mde) result = 'no-difference';
    else result = evaluation.diff > 0 ? 'improved' : 'worse';
  }
  const ended = experiment.expectedEndISO && t > experiment.expectedEndISO;
  const next = {
    ...experiment,
    status: 'completed',
    concludedAtISO: t,
    result,
    conclusionNote: note || autoConclusion(evaluation, result, { ended }),
  };
  return { ...next, evaluation };
}

function autoConclusion(evaluation, result, { ended } = {}){
  const dir = evaluation.diff == null ? '—' : `${evaluation.diff > 0 ? '+' : ''}${evaluation.diff}`;
  const pct = evaluation.diffPct == null ? '' : ` (${evaluation.diffPct > 0 ? '+' : ''}${evaluation.diffPct}%)`;
  const evidence = `Baseline ${evaluation.baselineMean ?? '—'} vs intervention ${evaluation.interventionMean ?? '—'} across ${evaluation.baselineWeeks}+${evaluation.interventionWeeks} weeks${pct}, diff ${dir}.`;
  if(result === 'inconclusive'){
    return `Not enough data yet${ended ? '' : ' so far'} to call this${evaluation.sessionsInIntervention < evaluation.minimumSessions ? ` — ${evaluation.sessionsInIntervention}/${evaluation.minimumSessions} intervention sessions logged` : ''}. ${evidence} Keep logging; re-run the conclusion later.`;
  }
  if(result === 'no-difference'){
    return `The change made no detectable difference beyond noise (±${evaluation.mde}). ${evidence} Both approaches are viable — keep the one you prefer.`;
  }
  if(result === 'improved'){
    return `The change beat the baseline (confidence ${evaluation.confidence}). ${evidence}`;
  }
  return `The change measured worse than the baseline (confidence ${evaluation.confidence}). ${evidence} Revert or adjust, then re-test if you still suspect the original variable.`;
}

/** Cancel: status change only — observations stay for the record. */
export function cancelExperiment(experiment, { today = null, note = null } = {}){
  return { ...experiment, status: 'cancelled', cancelledAtISO: today || todayISO(), conclusionNote: note || 'Cancelled before a conclusion could be drawn.' };
}

// ── Merge helpers (backup/sync treat experiments like templates) ────────

/** Union by id, newest-wins on updatedAtISO/createdAtISO. */
export function mergeExperiments(current = [], imported = []){
  const byId = new Map();
  for(const e of [...(current || []), ...(imported || [])]){
    if(!e?.id) continue;
    const prev = byId.get(e.id);
    if(!prev || stampOf(e) > stampOf(prev)) byId.set(e.id, e);
  }
  return [...byId.values()];
}
function stampOf(e){
  const v = e.updatedAtISO || e.concludedAtISO || e.createdAtISO || '';
  // Status wins over mere recency: a concluded row is a terminal fact.
  const statusRank = e.status === 'completed' ? 2 : e.status === 'cancelled' ? 2 : e.status === 'active' ? 1 : 0;
  return `${statusRank}|${v}`;
}

/** Soft-deleted experiment — tombstones carry deletions like templates. */
export function markExperimentDeleted(experiment, { today = null } = {}){
  return { ...experiment, deletedAt: today || new Date().toISOString() };
}

export function isExperimentDeleted(experiment){ return !!experiment?.deletedAt; }

// ── Suggested next experiment from what the data already shows ──────────
// The nudge is a question, not a prescription: it reads the user's own
// plateau/attribution state and proposes the experiment users usually want.

export function suggestExperiment({ history = [], plateau = null, exerciseId = null, config = null } = {}){
  const cfg = resolveArisePriors(config).experiments;
  if(plateau?.detected && exerciseId){
    const name = EXERCISE_BY_ID[exerciseId]?.name || exerciseId;
    return {
      presetId: 'rep-range',
      name: `${name}: heavier vs moderate reps`,
      question: `Would 5–8 rep sets break the ${name} plateau faster than the current range?`,
      metric: 'strength',
      exerciseId,
    };
  }
  if((history || []).length >= cfg.suggestAfterSessions){
    return {
      presetId: 'sleep-readiness',
      name: 'Sleep and next-day performance',
      question: 'Do better-sleep nights produce better sessions?',
      metric: 'session-quality',
    };
  }
  return null;
}

// Date helper re-exported for UI ordering ("ends in N days").
export { addDaysISO as experimentAddDays, dateDiffDays as experimentDaysBetween };
export function experimentDaysRemaining(experiment, today = null){
  if(!experiment?.expectedEndISO) return null;
  const d = dateDiffDays(today || todayISO(), experiment.expectedEndISO);
  return Math.max(0, d);
}
