// readinessClassifier.js — longitudinal, graduated readiness recommendation.
//
// The legacy deloadReadinessAssessment answers one binary question ("is
// fatigue accumulating enough to cut volume?"). Real programming needs a
// GRADUATED answer that also uses the days around the session. This module
// combines eight longitudinal inputs —
//   1. today's readiness            5. performance trend
//   2. 3-day readiness EMA          6. session completion (adherence)
//   3. 7-day readiness EMA          7. soreness
//   4. recent RPE cluster           8. previous adaptation response
// plus the existing deloadReadinessAssessment verdict itself (a ninth, heavily
// weighted input), into exactly one of four recommendations:
//   as-planned | small-adjustment | recovery-session | genuine-deload
//
// Rules inherited from the rest of the engine:
//   - Pure and deterministic: point-in-time inputs only, nothing recomputed
//     from future rows.
//   - Evidence travels with the decision: every factor reports its points and
//     detail so the user can disagree without losing context.
//   - Sample gates: escalation requires DISTINCT contributing factors, and
//     confidence degrades honestly when inputs are missing.
//   - Existing machinery is reused, not rebuilt: readinessEMA (windows),
//     strengthTrendWithConfidence (trend), noisySessionContext (noise gate),
//     validateDeloadDecisions/collectDeloadDecisions (adaptation response),
//     deloadReadinessAssessment (fatigue verdict).

import { resolveArisePriors } from './priors.js';
import { readinessEMA, strengthTrendWithConfidence } from './progression.js';
import { deloadReadinessAssessment, noisySessionContext } from './sessionQuality.js';
import { collectDeloadDecisions, validateDeloadDecisions } from './study.js';

export const READINESS_RECOMMENDATIONS = ['as-planned', 'small-adjustment', 'recovery-session', 'genuine-deload'];

function round(value, digits = 1){
  if(!Number.isFinite(Number(value))) return null;
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
}
function clamp01(value){ return Math.max(0, Math.min(1, value)); }
function addDaysISO(dateISO, days){
  const d = new Date(`${dateISO}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDays(fromISO, toISO){
  const a = Date.parse(`${fromISO}T00:00:00Z`), b = Date.parse(`${toISO}T00:00:00Z`);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Normalise the readiness log to ascending [{dateISO, score, soreness}] rows,
// dropping entries dated after the point-in-time boundary. Entries may be raw
// numbers (legacy callers) or {dateISO, score, sleep, soreness, motivation}.
function normalisedReadiness(readinessLog, todayISO){
  const rows = [];
  for(const entry of readinessLog || []){
    if(typeof entry === 'object' && entry !== null){
      const dateISO = entry.dateISO || null;
      if(todayISO && dateISO && String(dateISO) > String(todayISO)) continue;
      rows.push({ dateISO, score: Number(entry.score), soreness: entry.soreness != null ? Number(entry.soreness) : null });
    }else{
      const score = Number(entry);
      if(Number.isFinite(score)) rows.push({ dateISO: null, score, soreness: null });
    }
  }
  rows.sort((a, b)=> String(a.dateISO || '').localeCompare(String(b.dateISO || '')));
  return rows;
}

// Session-mean e1RM series in date order — the trend input judges the BODY of
// training, not one exercise's best set.
function sessionPerformanceSeries(history){
  const out = [];
  const ordered = [...(history || [])]
    .filter(s=> s?.dateISO)
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  for(const session of ordered){
    let sum = 0, n = 0;
    for(const b of session.blocks || []) for(const s of b.sets || []){
      const reps = Number(String(s.reps).match(/\d+/)?.[0] ?? s.reps) || 0;
      const weightKg = Number(s.weightKg) || 0;
      const v = reps > 0 ? weightKg * (1 + reps / 30) || reps : 0;
      if(v > 0){ sum += v; n++; }
    }
    if(n) out.push(sum / n);
  }
  return out;
}

// Completed/planned sessions over the recent window. Needs a schedule to know
// what was planned; without one this input is simply absent (coverage gap),
// never guessed from gaps.
function completionInput(schedule, history, todayStr, cfg){
  if(!schedule?.sessions?.length || !todayStr) return { available: false };
  const cutoff = addDaysISO(todayStr, -cfg.completionLookbackDays);
  const planned = (schedule.sessions || [])
    .filter(s=> String(s.dateISO) >= cutoff && String(s.dateISO) <= todayStr && isISODate(s.dateISO));
  if(planned.length < cfg.completionPlannedMinimum) return { available: false };
  const doneIds = new Set((history || []).map(h=> h.id));
  const completed = planned.filter(s=> doneIds.has(s.id) || s.status === 'done').length;
  return { available: true, planned: planned.length, completed, ratio: completed / planned.length };
}
function isISODate(dateISO){ return /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO)); }

// Previous adaptation response: did the LAST applied deload actually normalise
// volume afterwards? Reuses study.validateDeloadDecisions rather than
// re-deriving cut/rebound arithmetic here. Callers must pass history bounded at
// the decision horizon; rows without enough future data report rebound null.
function adaptationResponseInput({ schedule, history, todayStr, config }){
  const decisions = collectDeloadDecisions([schedule]);
  if(!decisions.length) return { available: false };
  const validation = validateDeloadDecisions(decisions, history, { config });
  const applied = validation.rows.filter(r=> r.cutApplied && r.dateISO <= String(todayStr || '9999'));
  if(!applied.length) return { available: false };
  const last = applied[applied.length - 1];
  const normalised = last.reboundRatio != null && last.reboundRatio >= resolveArisePriors(config).readinessClassifier.normalisedReboundRatio;
  return {
    available: true,
    dateISO: last.dateISO,
    reboundRatio: last.reboundRatio,
    normalised,
    daysAgo: todayStr ? diffDays(last.dateISO, todayStr) : null,
  };
}

// Flattened set logs in history order — same shape the weekly review feeds the
// legacy assessment. Used when a caller does not pass logs/recentRpes itself.
function derivedSetLogs(history){
  const out = [];
  for(const h of history || []) for(const b of h.blocks || []) for(const s of b.sets || []){
    const reps = Number(String(s.reps).match(/\d+/)?.[0] ?? s.reps) || 0;
    if(reps) out.push({ reps, weightKg: Number(s.weightKg) || 0, rpe: s.rpe ?? null });
  }
  return out;
}

// ── Factor scoring ──────────────────────────────────────────────────────

// Proportional shortfall: full points when value hits 0, none at threshold.
function shortfallPoints(weight, value, threshold){
  if(value == null || !Number.isFinite(value)) return { points: 0, detail: 'no data' };
  const ratio = clamp01((threshold - value) / Math.max(1e-9, threshold));
  return { points: round(weight * ratio), detail: `value ${round(value)} vs threshold ${threshold}` };
}

function emaFactor(rows, windowEntries, id, label, weight, lowThreshold, cfg){
  const nums = rows.map(r=> r.score).filter(n=> Number.isFinite(n));
  if(nums.length < 2) return { id, label, points: 0, detail: `need 2+ readiness entries (${nums.length} have)`, available: false };
  const ema = readinessEMA(nums.slice(-windowEntries), { config: cfg });
  const { points, detail } = shortfallPoints(weight, ema.value, lowThreshold);
  const scaled = ema.confidence === 'low' ? round(points * 0.5) : points;
  return {
    id, label,
    points: scaled,
    detail: `${windowEntries}-entry EMA ${ema.value} (confidence ${ema.confidence}) vs threshold ${lowThreshold}${scaled < points ? ` — halved for noisy series` : ''}`,
    available: true,
  };
}

// ── Classifier ──────────────────────────────────────────────────────────

export function classifyReadiness({
  history = [],
  readinessLog = [],
  logs = null,
  recentRpes = null,
  weeklyVolumeTrend = null,
  schedule = null,
  todayISO = null,
  deloadAssessment = null,
  config = null,
} = {}){
  const cfg = resolveArisePriors(config);
  const rc = cfg.readinessClassifier;
  const recovery = cfg.recovery;
  const todayStr = todayISO || new Date().toISOString().slice(0, 10);
  const rows = normalisedReadiness(readinessLog, todayStr);
  const setLogs = logs != null ? logs : derivedSetLogs(history);
  if(recentRpes == null) recentRpes = setLogs.map(l=> l.rpe).filter(r=> r != null && String(r).trim() !== '');
  const factors = [];
  const push = f=> factors.push(f);

  // Input 1+2+3: today's readiness + short/long EMAs (reuses readinessEMA).
  const nums = rows.map(r=> r.score).filter(n=> Number.isFinite(n));
  const lastEntry = [...rows].reverse().find(r=> Number.isFinite(r.score)) || null;
  const today = shortfallPoints(rc.weights.lowToday, lastEntry?.score ?? null, recovery.oneDayDip);
  push({ id: 'lowToday', label: "today's readiness", points: today.points, detail: lastEntry ? `latest ${lastEntry.score} vs dip threshold ${recovery.oneDayDip}` : 'no readiness entries', available: lastEntry != null });
  push(emaFactor(rows, rc.emaShortEntries, 'shortEmaLow', '3-day readiness EMA', rc.weights.shortEmaLow, recovery.readinessLowEma, cfg));
  push(emaFactor(rows, rc.emaLongEntries, 'longEmaLow', '7-day readiness EMA', rc.weights.longEmaLow, recovery.readinessLowEma, cfg));

  // Input 4: recent RPE cluster — same near-failure definition as the legacy
  // assessment (≥ recovery.highRpe, ≥ highRpeCount occurrences).
  const rpeValues = (recentRpes || [])
    .map(r=> Number(r)).filter(n=> Number.isFinite(n)).slice(-recovery.recentSetWindow);
  const highRpeCount = rpeValues.filter(r=> r >= recovery.highRpe).length;
  const rpeRatio = clamp01(highRpeCount / Math.max(1, recovery.highRpeCount));
  push({
    id: 'highRpeCluster', label: 'recent RPE cluster',
    points: round(rc.weights.highRpeCluster * rpeRatio),
    detail: rpeValues.length ? `${highRpeCount} set${highRpeCount === 1 ? '' : 's'} at RPE ≥${recovery.highRpe} in last ${rpeValues.length}` : 'no RPE-tagged sets',
    available: rpeValues.length > 0,
  });

  // Input 5: performance trend across sessions (strengthTrendWithConfidence).
  const series = sessionPerformanceSeries(history).slice(-rc.trendWindowSessions);
  // strengthTrendWithConfidence consumes set-shaped rows ({weightKg, reps});
  // encode each session mean v as a single-rep row whose e1RM equals v.
  const shapedSeries = series.map(v=> ({ weightKg: v / (1 + 1 / 30), reps: 1 }));
  const trend = strengthTrendWithConfidence(shapedSeries, { config: cfg });
  let trendPoints = 0, trendDetail = `need ${cfg.progression.trend.minimumObservations}+ sessions (${series.length} have)`;
  if(series.length >= cfg.progression.trend.minimumObservations && trend.slope < 0){
    const magnitude = clamp01(Math.abs(trend.slope) / rc.trendDeclineSlope);
    trendPoints = round(rc.weights.negativeTrend * magnitude * (trend.confidence === 'low' ? 0.5 : 1));
    trendDetail = `slope ${trend.slope}/session (confidence ${trend.confidence})`;
  }else if(series.length >= cfg.progression.trend.minimumObservations){
    trendDetail = `slope ${trend.slope}/session (confidence ${trend.confidence}) — stable or rising`;
  }
  push({ id: 'negativeTrend', label: 'performance trend', points: trendPoints, detail: trendDetail, available: series.length >= cfg.progression.trend.minimumObservations });

  // Input 6: session completion over the lookback window.
  const completion = completionInput(schedule, history, todayStr, rc);
  let completionPoints = 0, completionDetail = completion.available
    ? `${completion.completed}/${completion.planned} planned sessions completed`
    : 'needs a schedule with 3+ planned sessions in lookback';
  if(completion.available && completion.ratio < rc.completionLowThreshold){
    completionPoints = round(rc.weights.poorCompletion * clamp01((rc.completionLowThreshold - completion.ratio) / rc.completionLowThreshold));
  }
  push({ id: 'poorCompletion', label: 'session completion', points: completionPoints, detail: completionDetail, available: completion.available });

  // Input 7: soreness (readiness log's own 1–5 soreness rating).
  const soreness = rows.filter(r=> Number.isFinite(r.soreness)).slice(-rc.sorenessWindow);
  let sorenessPoints = 0, sorenessDetail = soreness.length
    ? `mean soreness ${round(soreness.reduce((a, b)=> a + b.soreness, 0) / soreness.length)} over last ${soreness.length}`
    : 'no soreness ratings logged';
  const meanSoreness = soreness.length ? soreness.reduce((a, b)=> a + b.soreness, 0) / soreness.length : null;
  if(meanSoreness != null && meanSoreness >= rc.sorenessHigh){
    sorenessPoints = round(rc.weights.highSoreness * clamp01((meanSoreness - (rc.sorenessHigh - 1)) / (5 - (rc.sorenessHigh - 1))));
  }
  push({ id: 'highSoreness', label: 'soreness', points: sorenessPoints, detail: sorenessDetail, available: soreness.length > 0 });

  // Input 9 (heaviest single): the legacy deloadReadinessAssessment verdict.
  // Callers that already ran it (e.g. the weekly review, which scopes it to the
  // reviewed week) pass it in; otherwise it is computed here unchanged.
  const assessment = deloadAssessment || deloadReadinessAssessment({
    logs: setLogs, recentRpes,
    weeklyVolumeTrend: weeklyVolumeTrend || undefined,
    readinessHistory: readinessLog, history, config: cfg,
  });
  const confScale = { high: 1, medium: 0.7, low: 0.4 };
  const deloadPoints = assessment.yes ? round(rc.weights.deloadAssessmentYes * (confScale[assessment.confidence] ?? 0.4)) : 0;
  push({
    id: 'deloadAssessmentYes', label: 'deload assessment',
    points: deloadPoints,
    detail: assessment.yes
      ? `fatigue verdict YES (${assessment.signals.join('; ')}) at ${assessment.confidence} confidence`
      : `fatigue verdict no (${assessment.signals.join('; ') || 'no signals'})`,
    available: true,
  });

  // Input 8: previous adaptation response (validateDeloadDecisions).
  const adaptation = adaptationResponseInput({ schedule, history, todayStr, config: cfg });
  const failedAdaptation = adaptation.available && !adaptation.normalised && adaptation.reboundRatio != null;
  push({
    id: 'failedAdaptation', label: 'previous adaptation response',
    points: failedAdaptation ? rc.weights.failedAdaptation : 0,
    detail: !adaptation.available
      ? 'no prior applied deload to learn from'
      : failedAdaptation
        ? `deload ${adaptation.daysAgo != null ? `${adaptation.daysAgo}d ago` : ''} cut volume but volume did NOT rebound (ratio ${adaptation.reboundRatio}) — fatigue looks chronic`
        : `prior deload normalised within two weeks (ratio ${adaptation.reboundRatio})`,
    available: adaptation.available,
  });

  // ── Graduation ────────────────────────────────────────────────────────
  const score = round(factors.reduce((a, f)=> a + (Number(f.points) || 0), 0));
  const activeFactors = factors.filter(f=> (Number(f.points) || 0) >= 1);
  const distinct = activeFactors.length;

  const bandFor = s=> s >= rc.thresholds.genuineDeload ? 'genuine-deload'
    : s >= rc.thresholds.recoverySession ? 'recovery-session'
    : s >= rc.thresholds.smallAdjustment ? 'small-adjustment'
    : 'as-planned';

  // Noise gate: a flagged final session (pain, unusual drop, missed sets, long
  // gap…) means the recent data is untrustworthy — genuine-deload then needs
  // the legacy assessment's own HIGH confidence to stand.
  const lastDone = (history || []).length ? history[history.length - 1] : null;
  const noise = lastDone ? noisySessionContext(lastDone, (history || []).slice(0, -1), { readinessLog, schedule, config: cfg }) : { isNoisy: false, flags: [], details: {} };
  const guards = [];
  let band = bandFor(score);

  const minDistinct = rc.minimumDistinctFactors[band] ?? 1;
  while(band !== 'as-planned' && distinct < (rc.minimumDistinctFactors[band] ?? 1)){
    band = READINESS_RECOMMENDATIONS[READINESS_RECOMMENDATIONS.indexOf(band) - 1];
  }
  if(band !== bandFor(score) && bandFor(score) !== 'as-planned') guards.push(`downgraded from ${bandFor(score)}: only ${distinct} distinct factor${distinct === 1 ? '' : 's'} contributed`);
  if(noise.isNoisy && band === 'genuine-deload' && assessment.confidence !== 'high'){
    band = 'recovery-session';
    guards.push(`capped at recovery-session: noisy final session (${noise.flags.join(', ')}) and deload confidence is ${assessment.confidence}`);
  }
  // Repeat guard: a deload that worked within repeatGuardDays argues for
  // letting recovery finish before cutting again.
  if(adaptation.available && adaptation.normalised && adaptation.daysAgo != null && adaptation.daysAgo <= rc.repeatGuardDays && band === 'genuine-deload' && assessment.confidence !== 'high'){
    band = 'recovery-session';
    guards.push(`capped at recovery-session: a deload ${adaptation.daysAgo}d ago already normalised volume — let recovery finish first`);
  }

  // Coverage/confidence: how many of the nine inputs actually had data.
  const observedInputs = factors.filter(f=> f.available).map(f=> f.id);
  const coverage = { observed: observedInputs.length, total: factors.length, missing: factors.filter(f=> !f.available).map(f=> f.id) };
  const coverageRatio = coverage.observed / coverage.total;
  const confidence = coverageRatio >= 0.7 ? 'high' : coverageRatio >= 0.45 ? 'medium' : 'low';

  const actions = {
    'as-planned': 'Continue as planned.',
    'small-adjustment': 'Keep loads, hold off adding volume, and aim for the bottom of rep ranges; re-check tomorrow.',
    'recovery-session': 'Make the next session a recovery session — roughly a quarter fewer sets, loads left ~3 RIR.',
    'genuine-deload': 'Take a deload week — cut volume substantially while keeping loads moderate.',
  };
  const reasons = {
    'as-planned': 'No sustained fatigue pattern across readiness, effort, performance, or adherence.',
    'small-adjustment': 'Early fatigue signals — trim back slightly before they compound.',
    'recovery-session': 'Multiple fatigue signals without a full deload case — recover inside the next session.',
    'genuine-deload': 'Sustained multi-signal fatigue across readiness history, effort, and performance — take the deload.',
  };

  return {
    schemaVersion: rc.version,
    recommendation: band,
    score,
    thresholds: rc.thresholds,
    factors,
    guards,
    distinctFactors: distinct,
    confidence,
    coverage,
    volumeScale: { 'as-planned': null, 'small-adjustment': 1, 'recovery-session': 0.75, 'genuine-deload': recovery.deloadVolumeCut }[band],
    action: actions[band],
    reason: reasons[band],
    deloadAssessment: assessment,
    noisyContext: { isNoisy: noise.isNoisy, flags: noise.flags },
    adaptationResponse: adaptation.available ? { dateISO: adaptation.dateISO, reboundRatio: adaptation.reboundRatio, normalised: adaptation.normalised, daysAgo: adaptation.daysAgo } : null,
    priorsVersion: cfg.version,
  };
}
