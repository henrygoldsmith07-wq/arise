// realWorldValidation.js — real-world validation layer over the point-in-time
// backtest (see benchmark/README.md). Turns a portable export into a benchmark
// dataset, then measures what the raw backtest does not report: outcome classes
// (success / failure / stagnation / regression), noisy-session detection
// quality, substitution quality, load-rounding fidelity, and longitudinal
// programme effectiveness. Every function returns measured counts first and
// labels its assumptions; none upgrades a verdict beyond the data supplied.

import { BENCHMARK_FORMAT_VERSION, backtestHistory, validateBenchmarkDataset } from './backtesting.js';
import { resolveArisePriors } from './priors.js';
import { rankedSubstitutions, MOVEMENT_PATTERNS } from './substitutions.js';
import { EXERCISE_BY_ID } from './data.js';
import { nearestLoadToPlates, DEFAULT_PLATE_DENOMINATIONS_KG } from './plates.js';
import { mesocycleComparison } from './analytics.js';

const DAY_MS = 86400000;
const OUTCOME_CLASSES = ['success', 'failure', 'stagnation', 'regression'];

function number(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseReps(value){
  if(value == null) return 0;
  if(typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function round(value, digits = 3){
  if(!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values){
  const list = (values || []).filter(Number.isFinite);
  return list.length ? list.reduce((a, b)=> a + b, 0) / list.length : null;
}

function median(values){
  const list = (values || []).filter(Number.isFinite).sort((a, b)=> a - b);
  if(!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

function rate(count, total){
  return total ? round(count / total, 3) : null;
}

function dateMs(dateISO){
  const ms = Date.parse(`${dateISO}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

function setPoint(set){
  const reps = parseReps(set?.reps);
  const weightKg = number(set?.weightKg);
  if(!(reps > 0)) return null;
  return { reps, weightKg, e1rm: weightKg > 0 ? weightKg * (1 + reps / 30) : reps };
}

function bestSet(block){
  const sets = (block?.sets || []).map(setPoint).filter(Boolean);
  return sets.length ? sets.slice().sort((a, b)=> b.e1rm - a.e1rm)[0] : null;
}

function exposures(history, exerciseId){
  const rows = [];
  for(const session of history || []){
    for(const block of session?.blocks || []){
      if(block?.exerciseId !== exerciseId) continue;
      const best = bestSet(block);
      if(best) rows.push({ session, best });
    }
  }
  return rows.sort((a, b)=> {
    const ta = dateMs(a.session.dateISO), tb = dateMs(b.session.dateISO);
    return (Number.isFinite(ta) ? ta : Infinity) - (Number.isFinite(tb) ? tb : Infinity);
  });
}

function e1rmSeries(history, exerciseId){
  return exposures(history, exerciseId).map(row=> ({ dateISO: row.session.dateISO, e1rm: row.best.e1rm }));
}

function spanGainPct(series){
  if(!series || series.length < 2) return null;
  const first = series[0].e1rm, last = series[series.length - 1].e1rm;
  return first > 0 ? last / first - 1 : null;
}

// ── Collecting real workout histories ────────────────────────────────────
// Adapter from the app's portable backup (export.js payload shape) to the
// benchmark dataset format. Consent is explicit and recorded in metadata so an
// unconsented export can never be mistaken for evidence-grade input.

export function datasetFromPortableExport(payload, { consent = false } = {}){
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const onboarding = data.onboarding || {};
  const profile = {};
  if(Array.isArray(onboarding.equipment)) profile.availableEquipment = [...onboarding.equipment];
  else if(Array.isArray(data.profile?.availableEquipment)) profile.availableEquipment = [...data.profile.availableEquipment];
  if(onboarding.goal) profile.goal = onboarding.goal;
  if(onboarding.level) profile.level = onboarding.level;
  if(Number.isFinite(Number(onboarding.daysPerWeek))) profile.daysPerWeek = Number(onboarding.daysPerWeek);
  if(onboarding.plateConfig && typeof onboarding.plateConfig === 'object'){
    profile.plateConfig = { ...onboarding.plateConfig, platesKg: Array.isArray(onboarding.plateConfig.platesKg) ? [...onboarding.plateConfig.platesKg] : undefined };
  }
  return {
    formatVersion: BENCHMARK_FORMAT_VERSION,
    kind: 'real-history',
    history: Array.isArray(data.history) ? data.history : [],
    readinessLog: Array.isArray(data.readinessLog) ? data.readinessLog : [],
    profile,
    schedule: data.activeSchedule || null,
    metadata: {
      source: 'arise-portable-export',
      appExportVersion: payload?.version ?? null,
      exportedAt: payload?.exportedAt ?? null,
      consent: !!consent,
      note: consent ? 'Exporter consented to benchmark evaluation.' : 'No consent recorded — suitable for structural checks only, not for claims.',
    },
  };
}

// ── Success / failure / stagnation / regression ──────────────────────────
// One label per comparison row, evaluated in this order:
//   regression  actual e1RM fell below the previous exposure beyond tolerance
//   stagnation  actual e1RM matched the previous exposure within tolerance
//   failure     improved over last time but still missed today's prescription
//   success     improved over last time AND met today's prescription
// Rows without a previous exposure stay 'unknown' rather than being guessed.

export function classifyOutcome(row, config = null){
  const cfg = resolveArisePriors(config);
  const previous = number(row?.previousBest?.e1rm);
  const actual = number(row?.actual?.e1rm);
  if(!(previous > 0) || !(actual > 0)) return 'unknown';
  const tolerance = cfg.backtest.progressionTolerancePct;
  if(actual < previous * (1 - tolerance)) return 'regression';
  if(actual <= previous * (1 + tolerance)) return 'stagnation';
  return row.completed ? 'success' : 'failure';
}

export function outcomeDistribution(observations, config = null){
  const rows = observations || [];
  const labels = rows.map(row=> classifyOutcome(row, config));
  const counts = Object.fromEntries(OUTCOME_CLASSES.map(c=> [c, labels.filter(l=> l === c).length]));
  const unknown = labels.filter(l=> l === 'unknown').length;
  const evaluable = rows.length - unknown;
  return {
    n: rows.length,
    evaluable,
    counts: { ...counts, unknown },
    rates: Object.fromEntries(OUTCOME_CLASSES.map(c=> [c, rate(counts[c], evaluable)])),
    definition: 'success = progressed and met prescription; failure = progressed but missed prescription; stagnation = flat vs previous exposure; regression = below previous exposure. Tolerance from priors.backtest.progressionTolerancePct.',
  };
}

// ── Noisy-session detection quality ──────────────────────────────────────
// Scores the fatigue/bad-session forecast already produced by the backtest
// replay against observed session quality, with precision/recall so a detector
// that never fires cannot hide behind accuracy alone.

export function validateNoisySessionDetection(backtestResult, config = null){
  const cfg = resolveArisePriors(config);
  const cutoff = cfg.backtest.fatigue.riskCutoff;
  const rows = backtestResult?.fatigueObservations || [];
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for(const row of rows){
    const predictedBad = number(row.probability) >= cutoff;
    if(predictedBad && row.actualBad) tp += 1;
    else if(predictedBad && !row.actualBad) fp += 1;
    else if(!predictedBad && row.actualBad) fn += 1;
    else tn += 1;
  }
  return {
    n: rows.length,
    riskCutoff: cutoff,
    predictedBad: tp + fp,
    actualBad: tp + fn,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision: rate(tp, tp + fp),
    recall: rate(tp, tp + fn),
    specificity: rate(tn, tn + fp),
    accuracy: rate(tp + tn, rows.length),
    brier: round(mean(rows.map(row=> row.brier)), 3),
    confusion: { predictedBad: { bad: tp, good: fp }, predictedGood: { bad: fn, good: tn } },
    note: rows.length ? null : 'No fatigue forecasts were evaluable — each scored session needs prior history first.',
  };
}

// ── Substitution quality ─────────────────────────────────────────────────
// Two complementary views:
//  1. Pair view — where the user logged both an exercise and one of the
//     engine's proposed substitutes, do the two progress together, and does
//     the substitute preserve muscle/pattern? This audits what the ranker
//     would have chosen against what actually happened.
//  2. Swap events — with a schedule, blocks whose exerciseId differs from the
//     planned session are detected substitutions; their stimulus preservation
//     is measured directly against the displaced planned work.

function alignmentOf(gainA, gainB, tolerance){
  if(!Number.isFinite(gainA) || !Number.isFinite(gainB)) return 'unknown';
  const dirA = Math.abs(gainA) <= tolerance ? 0 : Math.sign(gainA);
  const dirB = Math.abs(gainB) <= tolerance ? 0 : Math.sign(gainB);
  if(dirA === 0 && dirB === 0) return 'both-flat';
  return dirA === dirB ? 'aligned' : 'divergent';
}

export function substitutionPairQuality(dataset, options = {}){
  const config = resolveArisePriors(dataset.config || options.config);
  const minSessions = Math.max(2, options.minSessions ?? 3);
  const kit = dataset.profile?.availableEquipment?.length ? dataset.profile.availableEquipment : null;
  const history = dataset.history || [];
  const counts = {};
  for(const session of history) for(const block of session?.blocks || []) counts[block.exerciseId] = (counts[block.exerciseId] || 0) + 1;
  const pairs = [];
  for(const target of Object.keys(counts)){
    if(!EXERCISE_BY_ID[target] || counts[target] < minSessions) continue;
    const rankedIds = rankedSubstitutions(target, kit, options.limit ?? 4, history).map(exercise=> exercise.id);
    const targetGain = spanGainPct(e1rmSeries(history, target));
    for(const substitute of Object.keys(counts)){
      if(substitute === target || !EXERCISE_BY_ID[substitute] || counts[substitute] < minSessions) continue;
      const declared = (EXERCISE_BY_ID[target]?.substitution || []).includes(substitute);
      const rankIndex = rankedIds.indexOf(substitute);
      if(!declared && rankIndex === -1) continue;
      const substituteGain = spanGainPct(e1rmSeries(history, substitute));
      pairs.push({
        targetId: target,
        substituteId: substitute,
        rank: rankIndex === -1 ? null : rankIndex + 1,
        declared,
        sameMuscle: EXERCISE_BY_ID[target].muscle === EXERCISE_BY_ID[substitute].muscle,
        samePattern: !!MOVEMENT_PATTERNS[target] && MOVEMENT_PATTERNS[target] === MOVEMENT_PATTERNS[substitute],
        targetGainPct: round(targetGain, 4),
        substituteGainPct: round(substituteGain, 4),
        alignment: alignmentOf(targetGain, substituteGain, config.backtest.progressionTolerancePct),
        sessionsLogged: { target: counts[target], substitute: counts[substitute] },
      });
    }
  }
  const directional = pairs.filter(pair=> pair.alignment === 'aligned' || pair.alignment === 'divergent');
  const rankedPairs = pairs.filter(pair=> pair.rank != null);
  return {
    available: pairs.length > 0,
    n: pairs.length,
    minimumSessionsPerExercise: minSessions,
    musclePreservationRate: rate(pairs.filter(pair=> pair.sameMuscle).length, pairs.length),
    patternPreservationRate: rate(pairs.filter(pair=> pair.samePattern).length, pairs.length),
    declaredRate: rate(pairs.filter(pair=> pair.declared).length, pairs.length),
    topRankedShare: rate(rankedPairs.filter(pair=> pair.rank === 1).length, rankedPairs.length),
    medianRankOfSubstitutes: median(rankedPairs.map(pair=> pair.rank)),
    alignedCount: pairs.filter(pair=> pair.alignment === 'aligned').length,
    divergentCount: pairs.filter(pair=> pair.alignment === 'divergent').length,
    bothFlatCount: pairs.filter(pair=> pair.alignment === 'both-flat').length,
    progressionAlignmentRate: rate(directional.filter(pair=> pair.alignment === 'aligned').length, directional.length),
    note: pairs.length ? 'Only substitutes the engine proposes (ranked or declared) are audited; alignment compares first-to-last e1RM change of both exercises.' : 'No exercise pair with enough shared history to audit yet.',
    pairs: pairs.sort((a, b)=> String(a.targetId).localeCompare(String(b.targetId)) || String(a.substituteId).localeCompare(String(b.substituteId))),
  };
}

export function substitutionSwapEvents(dataset){
  const schedule = dataset.schedule || dataset.activeSchedule;
  const history = dataset.history || [];
  if(!schedule?.sessions?.length){
    return { available: false, n: 0, events: [], note: 'Provide a schedule with planned sessions to detect substitution events directly.' };
  }
  const byId = new Map(schedule.sessions.filter(session=> session?.id).map(session=> [session.id, session]));
  const byDate = new Map(schedule.sessions.filter(session=> session?.dateISO).map(session=> [session.dateISO, session]));
  const events = [];
  for(const session of history){
    const planned = byId.get(session.scheduleSessionId || session.id) || byDate.get(session.dateISO);
    if(!planned) continue;
    const plannedBlocks = planned.blocks || [];
    const plannedIds = new Set(plannedBlocks.map(block=> block.exerciseId));
    for(const block of session.blocks || []){
      if(plannedIds.has(block.exerciseId)) continue;
      const performed = EXERCISE_BY_ID[block.exerciseId];
      if(!performed) continue;
      const preservingMuscle = plannedBlocks.some(plannedBlock=> EXERCISE_BY_ID[plannedBlock.exerciseId]?.muscle === performed.muscle);
      const preservingPattern = plannedBlocks.some(plannedBlock=> MOVEMENT_PATTERNS[plannedBlock.exerciseId] && MOVEMENT_PATTERNS[plannedBlock.exerciseId] === MOVEMENT_PATTERNS[block.exerciseId]);
      const declaredFor = plannedBlocks
        .filter(plannedBlock=> (EXERCISE_BY_ID[plannedBlock.exerciseId]?.substitution || []).includes(block.exerciseId))
        .map(plannedBlock=> plannedBlock.exerciseId);
      const laterSeries = e1rmSeries(history, block.exerciseId).filter(point=> point.dateISO >= session.dateISO);
      events.push({
        dateISO: session.dateISO,
        sessionId: session.id || null,
        performedExerciseId: block.exerciseId,
        plannedExerciseIds: plannedBlocks.map(plannedBlock=> plannedBlock.exerciseId),
        preservedMuscle: preservingMuscle,
        preservedPattern: preservingPattern,
        declaredForSwapped: declaredFor,
        subsequentGainPct: round(spanGainPct(laterSeries), 4),
      });
    }
  }
  return {
    available: true,
    n: events.length,
    musclePreservationRate: rate(events.filter(event=> event.preservedMuscle).length, events.length),
    patternPreservationRate: rate(events.filter(event=> event.preservedPattern).length, events.length),
    declaredShare: rate(events.filter(event=> event.declaredForSwapped.length).length, events.length),
    nonRegressionRate: rate(events.filter(event=> Number.isFinite(event.subsequentGainPct) && event.subsequentGainPct >= 0).length, events.filter(event=> Number.isFinite(event.subsequentGainPct)).length),
    events,
    note: events.length ? 'A swap counts as quality-preserving when it matches the displaced work on muscle or movement pattern; subsequentGainPct tracks the substitute afterwards.' : 'Every completed block matched its planned session — no substitutions observed.',
  };
}

// ── Load rounding fidelity ───────────────────────────────────────────────
// Checks recommendations land on increments a lifter can actually select:
//   onRoundingGrid  matches the versioned loadRounding step bands in priors
//   plateAchievable reachable with the configured plate denominations (only
//                   meaningful when the profile actually has a barbell)
//   usableVsActual  the rounded recommendation sits within load tolerance of
//                   the load the lifter really used next session

function roundingStepFor(loadKg, config){
  const steps = config.progression.loadRounding;
  if(!(loadKg > 0)) return null;
  if(loadKg < 20) return steps.under20KgStep;
  if(loadKg < 60) return steps.under60KgStep;
  return steps.defaultStep;
}

function plateConfigFor(dataset){
  const plateConfig = dataset.profile?.plateConfig;
  const config = {};
  if(plateConfig && Array.isArray(plateConfig.platesKg) && plateConfig.platesKg.length) config.platesKg = [...plateConfig.platesKg];
  if(Number.isFinite(Number(plateConfig?.barWeightKg))) config.barWeightKg = Number(plateConfig.barWeightKg);
  return config;
}

export function validateLoadRounding(dataset, backtestResult, options = {}){
  const config = resolveArisePriors(dataset.config || options.config);
  const epsilon = options.epsilonKg ?? 0.01;
  const rows = (backtestResult?.observations || []).filter(row=> row.recommendation?.load != null && Number(row.recommendation.load) > 0);
  const hasBarbell = !dataset.profile?.availableEquipment?.length || dataset.profile.availableEquipment.includes('barbell');
  const plateConfig = plateConfigFor(dataset);
  const details = rows.map(row=>{
    const recommended = Number(row.recommendation.load);
    const step = roundingStepFor(recommended, config);
    const onGrid = step != null && Math.abs(recommended / step - Math.round(recommended / step)) * step <= epsilon;
    const snap = hasBarbell ? nearestLoadToPlates(recommended, plateConfig) : null;
    const actualLoad = number(row.actual?.load);
    const usable = snap && actualLoad > 0 ? Math.abs(snap.loadKg - actualLoad) / actualLoad <= config.backtest.loadTolerancePct : null;
    const loggedSnap = actualLoad > 0 && hasBarbell ? nearestLoadToPlates(actualLoad, plateConfig) : null;
    return {
      exerciseId: row.exerciseId,
      recommendedKg: recommended,
      roundingStepKg: step,
      onRoundingGrid: !!onGrid,
      plateAchievable: snap ? snap.exact : null,
      plateDeltaKg: snap ? snap.deltaKg : null,
      roundedUsableVsActual: usable,
      loggedLoadPlateAchievable: loggedSnap ? loggedSnap.exact : null,
    };
  });
  const withActual = details.filter(detail=> detail.roundedUsableVsActual != null);
  return {
    n: details.length,
    barbellProfile: hasBarbell,
    plateDenominationsKg: plateConfig.platesKg || DEFAULT_PLATE_DENOMINATIONS_KG,
    onRoundingGridRate: rate(details.filter(detail=> detail.onRoundingGrid).length, details.length),
    plateAchievableRate: hasBarbell ? rate(details.filter(detail=> detail.plateAchievable).length, details.length) : null,
    meanPlateDeltaKg: hasBarbell ? round(mean(details.map(detail=> Math.abs(detail.plateDeltaKg))), 3) : null,
    maxPlateDeltaKg: hasBarbell ? round(Math.max(0, ...details.map(detail=> Math.abs(detail.plateDeltaKg))), 3) : null,
    usableAgainstActualRate: rate(withActual.filter(detail=> detail.roundedUsableVsActual).length, withActual.length),
    loggedLoadsPlateAchievableRate: hasBarbell ? rate(details.filter(detail=> detail.loggedLoadPlateAchievable === true).length, details.filter(detail=> detail.loggedLoadPlateAchievable != null).length || 1) : null,
    note: 'Grid check applies the priors load-rounding bands to every load recommendation. Plate checks assume barbell-style loading and are skipped (null) for profiles without a barbell.',
    details,
  };
}

// ── Longitudinal programme effectiveness ─────────────────────────────────
// Splits the whole history into ~28-day cycles, then measures per-exercise
// first-to-last progress, weekly adherence, and cycle-over-cycle volume/e1RM
// movement. Verdicts are deliberately coarse and labelled by data volume.

export function longitudinalEffectiveness(dataset, options = {}){
  const config = resolveArisePriors(dataset.config || options.config);
  const history = dataset.history || [];
  const tolerance = config.backtest.progressionTolerancePct;
  const dates = history.map(session=> dateMs(session.dateISO)).filter(Number.isFinite).sort((a, b)=> a - b);
  const spanDays = dates.length >= 2 ? (dates[dates.length - 1] - dates[0]) / DAY_MS : 0;
  const weeks = spanDays / 7;
  const counts = {};
  for(const session of history) for(const block of session?.blocks || []) counts[block.exerciseId] = (counts[block.exerciseId] || 0) + 1;

  const perExercise = Object.keys(counts).filter(id=> EXERCISE_BY_ID[id]).map(exerciseId=>{
    const series = e1rmSeries(history, exerciseId);
    const gain = spanGainPct(series);
    return {
      exerciseId,
      sessions: series.length,
      gainPct: round(gain, 4),
      weeklyGainPct: gain != null && weeks > 0 ? round(gain / weeks, 5) : null,
      trend: !Number.isFinite(gain) ? 'insufficient' : gain > tolerance ? 'progressing' : gain < -tolerance ? 'regressing' : 'flat',
    };
  }).sort((a, b)=> (b.weeklyGainPct ?? -Infinity) - (a.weeklyGainPct ?? -Infinity));

  const scheduledCount = dataset.schedule?.sessions?.length || null;
  const scheduledPerWeek = scheduledCount != null && weeks > 0 ? round(scheduledCount / weeks, 2) : null;
  const comparison = mesocycleComparison(history);
  const classified = perExercise.filter(row=> row.trend !== 'insufficient');
  const progressing = classified.filter(row=> row.trend === 'progressing').length;
  const regressing = classified.filter(row=> row.trend === 'regressing').length;
  let verdict = 'insufficient-history';
  if(classified.length){
    if(progressing > classified.length / 2) verdict = 'progressing';
    else if(regressing > classified.length / 2) verdict = 'regressing';
    else if(progressing > 0) verdict = 'mixed';
    else verdict = 'not-progressing';
  }
  return {
    sessions: history.length,
    spanDays: round(spanDays, 1),
    sessionsPerWeek: weeks > 0 ? round(history.length / weeks, 2) : null,
    scheduledSessions: scheduledCount,
    scheduledSessionsPerWeek: scheduledPerWeek,
    adherenceVsPlan: scheduledPerWeek && history.length ? round(history.length / Math.max(1, scheduledCount), 3) : null,
    cycles: comparison.cycles || [],
    cycleComparison: comparison.comparison || null,
    exercises: perExercise,
    progressingExercises: progressing,
    flatExercises: classified.filter(row=> row.trend === 'flat').length,
    regressingExercises: regressing,
    insufficientExercises: perExercise.length - classified.length,
    verdict,
    note: comparison.note || null,
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────────

export function realWorldValidationReport(input, options = {}){
  const dataset = input?.formatVersion != null ? input : datasetFromPortableExport(input, options);
  if(dataset.history != null && !Array.isArray(dataset.history)){
    return { status: 'invalid', validation: { valid: false, issues: ['history must be an array.'], kind: dataset.kind ?? null, formatVersion: BENCHMARK_FORMAT_VERSION } };
  }
  const validation = validateBenchmarkDataset(dataset);
  if(!validation.valid) return { status: 'invalid', validation };
  const backtest = backtestHistory(dataset);
  const report = {
    status: backtest.status,
    kind: dataset.kind,
    comparisons: backtest.comparisons,
    generatedAt: new Date().toISOString(),
    outcomes: outcomeDistribution(backtest.observations, dataset.config || options.config),
    noisySessionDetection: validateNoisySessionDetection(backtest, dataset.config || options.config),
    substitutions: {
      pairs: substitutionPairQuality(dataset, options),
      swaps: substitutionSwapEvents(dataset),
    },
    loadRounding: validateLoadRounding(dataset, backtest, options),
    longitudinal: longitudinalEffectiveness(dataset, options),
    provenance: {
      metadata: dataset.metadata || null,
      coverage: backtest.coverage,
      calibrationSource: backtest.calibration?.source ?? null,
    },
  };
  if(backtest.status !== 'calibrated'){
    report.note = backtest.status === 'insufficient'
      ? 'No comparable predictions yet — collect more history before treating any metric as evidence.'
      : 'Below the minimum comparison count — metrics are warming up, not validated.';
  }
  return report;
}
