// backtesting.js — point-in-time validation for Arise's deterministic rules.
//
// A backtest is an ordered replay. At each historical point it exposes only
// prior completed sessions and prior readiness entries, generates the same
// deterministic recommendation used by the app, then scores that recommendation
// against later observed data. Future rows are used only as outcomes, never as
// inputs. No LLM or fabricated validation is involved.

import {
  e1rm,
  recommendNext,
  strategyForExercise,
  trainingAgeInfo,
} from './progression.js';
import {
  badSessionAttribution,
  deloadReadinessAssessment,
  sessionQuality,
  plateauAttribution,
  noisySessionContext,
} from './sessionQuality.js';
import { empiricalOrPrior, resolveArisePriors, clamp } from './priors.js';
import { EXERCISE_BY_ID } from './data.js';

export const BENCHMARK_FORMAT_VERSION = 1;

function number(value, fallback = 0){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseReps(value){
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function dateMs(dateISO){
  const value = Date.parse(`${dateISO || ''}T00:00:00`);
  return Number.isFinite(value) ? value : NaN;
}

function round(value, digits = 3){
  if(!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function mean(values){
  return values.length ? values.reduce((sum, value)=> sum + value, 0) / values.length : null;
}

function median(values){
  if(!values.length) return null;
  const sorted = values.slice().sort((a, b)=> a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stableTimeline(history){
  return (history || []).map((session, originalIndex)=> ({ session, originalIndex }))
    .sort((a, b)=> dateMs(a.session?.dateISO) - dateMs(b.session?.dateISO) || a.originalIndex - b.originalIndex)
    .map((item, orderIndex)=> ({ ...item, orderIndex }));
}

function visibleReadiness(readinessLog, asOfDateISO){
  const cutoff = dateMs(asOfDateISO);
  return (readinessLog || [])
    .map((entry, originalIndex)=> ({ entry, originalIndex, time: entry.at ? Date.parse(entry.at) : dateMs(entry.dateISO) }))
    .filter(item=> {
      // A same-day readiness entry has no trustworthy ordering unless both
      // sides carry timestamps. The conservative date-only rule excludes it.
      if(entryHasComparableTimestamp(item.entry, asOfDateISO)) return item.time < Date.parse(`${asOfDateISO}T00:00:00`);
      return Number.isFinite(cutoff) && dateMs(item.entry.dateISO) < cutoff;
    })
    .sort((a, b)=> itemTime(a) - itemTime(b) || a.originalIndex - b.originalIndex)
    .map(item=> item.entry);
}

function entryHasComparableTimestamp(entry, asOfDateISO){
  return !!entry?.at && Number.isFinite(Date.parse(entry.at)) && Number.isFinite(Date.parse(`${asOfDateISO || ''}T00:00:00`));
}

function itemTime(item){
  return Number.isFinite(item.time) ? item.time : dateMs(item.entry?.dateISO);
}

function allBlocks(session, exerciseId = null){
  return (session?.blocks || []).filter(block=> exerciseId == null || block.exerciseId === exerciseId);
}

function setPoint(set){
  const reps = parseReps(set?.reps);
  const weightKg = number(set?.weightKg);
  const assistedKg = number(set?.assistedKg);
  if(!(reps > 0)) return null;
  return {
    reps,
    weightKg,
    assistedKg,
    rpe: set?.rpe ?? null,
    e1rm: e1rm(weightKg, reps) || reps,
    failed: !!set?.failed,
  };
}

function bestSet(block){
  const sets = (block?.sets || []).map(setPoint).filter(Boolean);
  if(!sets.length) return null;
  return sets.slice().sort((a, b)=> b.e1rm - a.e1rm)[0];
}

function firstSet(block){
  return (block?.sets || []).map(setPoint).find(Boolean) || null;
}

function exposures(history, exerciseId){
  const rows = [];
  for(const session of history || []){
    for(const block of allBlocks(session, exerciseId)){
      const first = firstSet(block);
      const best = bestSet(block);
      if(first || best) rows.push({ session, block, first, best: best || first });
    }
  }
  return rows;
}

function lastExposure(history, exerciseId){
  const rows = exposures(history, exerciseId);
  return rows[rows.length - 1] || null;
}

function priorExerciseCount(history, exerciseId){
  return exposures(history, exerciseId).length;
}

function historyBand(count, config){
  const bands = config.backtest.historyBands;
  if(count < bands.coldMax) return 'cold';
  if(count < bands.developingMax) return 'developing';
  return 'established';
}

function medianGapDays(history){
  const dates = [...new Set((history || []).map(session=> session.dateISO).filter(Boolean))]
    .map(dateMs).filter(Number.isFinite).sort((a, b)=> a - b);
  if(dates.length < 2) return null;
  const gaps = [];
  for(let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
  return median(gaps);
}

function consistencyBand(history, config){
  const gap = medianGapDays(history);
  if(gap == null) return 'unknown';
  const thresholds = config.backtest.consistency;
  if(gap <= thresholds.highMedianGapDays) return 'high';
  if(gap <= thresholds.mediumMedianGapDays) return 'medium';
  return 'low';
}

function equipmentBand(profile, session, exerciseId){
  const equipment = profile?.availableEquipment || profile?.equipment || session?.availableEquipment || session?.equipment || session?.equipmentSnapshot || [];
  if(!Array.isArray(equipment) || !equipment.length) return 'unknown';
  return [...new Set(equipment.map(value=> String(value).trim()).filter(Boolean))].sort().join('+') || 'unknown';
}

function repRangeBand(targetReps){
  const nums = (String(targetReps||'').match(/\d+/g)||[]).map(Number);
  const lo = nums[0] || 8;
  const hi = nums[1] || lo;
  const avg = (lo + hi) / 2;
  if(avg <= 5) return 'low (1-5)';
  if(avg <= 12) return 'mid (6-12)';
  return 'high (13+)';
}

function movementTypeFor(exerciseId){
  const ex = EXERCISE_BY_ID[exerciseId];
  if(!ex) return 'unknown';
  const muscle = ex.muscle || 'unknown';
  const patternMap = {
    'push-up': 'push', 'bench-press-barbell': 'push', 'bench-press-dumbbell': 'push', 'chest-press-machine': 'push', 'incline-push-up': 'push',
    'pull-up': 'pull', 'band-row': 'pull', 'dumbbell-row': 'pull', 'lat-pulldown': 'pull', 'cable-row': 'pull',
    'bodyweight-squat': 'squat', 'goblet-squat': 'squat', 'barbell-squat': 'squat', 'split-squat': 'squat', 'bulgarian-split-squat': 'squat', 'lunge': 'lunge',
    'romanian-deadlift': 'hinge', 'hip-thrust': 'hinge', 'glute-bridge': 'hinge',
  };
  const pattern = patternMap[exerciseId] || ex.muscle?.toLowerCase() || 'general';
  return `${muscle}:${pattern}`;
}

function profileAtPoint(baseProfile, profileHistory, asOfDateISO){
  const visible = (profileHistory || [])
    .filter(entry=> entry?.dateISO && entry.dateISO < asOfDateISO)
    .sort((a, b)=> a.dateISO.localeCompare(b.dateISO));
  return visible.length ? { ...(baseProfile || {}), ...visible[visible.length - 1] } : (baseProfile || {});
}

function stratumFor({ exerciseId, history, profile, session, asOfDateISO, config, targetReps = null }){
  const age = trainingAgeInfo(history, { asOfDateISO, config });
  const count = priorExerciseCount(history, exerciseId);
  const repRange = repRangeBand(targetReps || session?.blocks?.find(b=> b.exerciseId===exerciseId)?.reps || '8-12');
  const movementType = movementTypeFor(exerciseId);
  const stratum = {
    exercise: exerciseId || 'unknown',
    availableHistory: historyBand(count, config),
    trainingAge: age.phase,
    equipment: equipmentBand(profile, session, exerciseId),
    consistency: consistencyBand(history, config),
    repRange,
    movementType,
  };
  return { ...stratum, key: [stratum.exercise, stratum.availableHistory, stratum.trainingAge, stratum.equipment, stratum.consistency, stratum.repRange, stratum.movementType].join('|') };
}

function stratumKeys(stratum){
  return [
    `exact:${stratum.key}`,
    `exercise-history:${stratum.exercise}|${stratum.availableHistory}`,
    `exercise-age:${stratum.exercise}|${stratum.trainingAge}`,
    `repRange:${stratum.repRange}`,
    `movementType:${stratum.movementType}`,
    `exercise-rep:${stratum.exercise}|${stratum.repRange}`,
    `exercise:${stratum.exercise}`,
    'global',
  ];
}

function rowMetricKey(metric, key){
  return `${metric}::${key}`;
}

function makeStat(){
  return { n: 0, sum: 0, values: [] };
}

function addStat(map, metric, key, value){
  if(!Number.isFinite(Number(value))) return;
  const statKey = rowMetricKey(metric, key);
  const stat = map.get(statKey) || makeStat();
  stat.n += 1;
  stat.sum += Number(value);
  stat.values.push(Number(value));
  map.set(statKey, stat);
}

function fitEmpiricalModel(rows, config){
  const stats = new Map();
  for(const row of rows || []){
    const keys = [
      ...stratumKeys(row.stratum),
    ];
    for(const key of keys){
      if(row.completed != null) addStat(stats, 'completionProbability', key, row.completed ? 1 : 0);
      if(row.observedLoadPct != null) addStat(stats, 'progressionRatePct', key, row.observedLoadPct);
    }
  }
  const minimumSamples = config.backtest.minimumStratumSamples;
  function lookup(metric, stratum, prior){
    for(const key of stratumKeys(stratum)){
      const stat = stats.get(rowMetricKey(metric, key));
      if(stat && stat.n >= minimumSamples){
        return { ...empiricalOrPrior({ prior, estimate: stat.sum / stat.n, samples: stat.n, minimumSamples }), key };
      }
    }
    return empiricalOrPrior({ prior, estimate: null, samples: 0, minimumSamples });
  }
  return { lookup, stats, minimumSamples };
}

function targetMet(recommendation, actual){
  if(!recommendation || !actual) return false;
  const repsMet = recommendation.reps == null || actual.reps >= Number(recommendation.reps);
  const loadMet = recommendation.load == null || recommendation.load <= 0 || actual.weightKg >= Number(recommendation.load);
  const assistMet = recommendation.assistKg == null || actual.assistedKg <= Number(recommendation.assistKg);
  return repsMet && loadMet && assistMet;
}

function progressionAction(recommendation, previous, config){
  if(!recommendation || !previous) return 'unknown';
  if(recommendation.plateau?.isPlateau || /plateau|hold/i.test(recommendation.reason || '')) return 'hold';
  if(recommendation.assistKg != null && recommendation.assistKg < previous.assistedKg) return 'reduce_assistance';
  if(recommendation.reps != null && recommendation.reps > previous.reps) return 'add_reps';
  if(recommendation.load != null && recommendation.load > previous.weightKg * (1 + config.backtest.progressionTolerancePct)) return 'add_load';
  return 'hold';
}

function observedAction(actual, previous, config){
  if(!actual || !previous) return 'unknown';
  if(actual.assistedKg < previous.assistedKg - config.backtest.assistanceToleranceKg) return 'reduce_assistance';
  if(actual.weightKg > previous.weightKg * (1 + config.backtest.progressionTolerancePct)) return 'add_load';
  if(actual.reps > previous.reps) return 'add_reps';
  return 'hold';
}

function isProgressionAction(action){
  return ['add_load', 'add_reps', 'reduce_assistance'].includes(action);
}

function volumeKg(history){
  let volume = 0;
  for(const session of history || []) for(const block of session.blocks || []) for(const set of block.sets || []){
    const reps = parseReps(set.reps);
    const load = Math.max(0, number(set.weightKg) - number(set.assistedKg));
    volume += reps * load;
  }
  return volume;
}

function volumeBetween(history, startMs, endMs){
  return volumeKg((history || []).filter(session=> {
    const t = dateMs(session.dateISO);
    return Number.isFinite(t) && t >= startMs && t < endMs;
  }));
}

function weeklyRatios(history){
  const dates = (history || []).map(session=> dateMs(session.dateISO)).filter(Number.isFinite);
  if(!dates.length) return [];
  const first = Math.min(...dates), last = Math.max(...dates);
  const ratios = [];
  for(let start = first; start <= last; start += 7 * 86400000){
    const current = volumeBetween(history, start, start + 7 * 86400000);
    const previous = volumeBetween(history, start - 7 * 86400000, start);
    if(previous > 0) ratios.push(current / previous);
  }
  return ratios;
}

function futureExposures(timeline, currentOrderIndex, exerciseId, horizon){
  const future = [];
  for(const item of timeline){
    if(item.orderIndex <= currentOrderIndex) continue;
    for(const block of allBlocks(item.session, exerciseId)){
      const first = firstSet(block);
      const best = bestSet(block);
      if(first || best) future.push({ ...item, block, first, best: best || first });
    }
  }
  return future.slice(0, horizon);
}

function plateauOutcome({ timeline, orderIndex, exerciseId, historyBefore, readinessLog, config }){
  const prior = exposures(historyBefore, exerciseId);
  const future = futureExposures(timeline, orderIndex, exerciseId, config.backtest.maxOutcomeHorizonExposures);
  if(prior.length < config.progression.plateau.minSessions || future.length < config.backtest.maxOutcomeHorizonExposures) return null;
  const window = prior.slice(-config.sessionQuality.plateau.window);
  const priorBest = Math.max(...window.map(row=> row.best.e1rm));
  const futureBest = Math.max(...future.map(row=> row.best.e1rm));
  if(futureBest >= priorBest * (1 + config.backtest.plateauFutureGainPct)) return 'progressing';
  const quality = window.map(row=> sessionQuality(row.session, { readinessLog, config }));
  const bad = quality.filter(row=> row.quality === 'bad').length;
  const rebound = futureBest >= Math.max(...window.map(row=> row.best.e1rm)) * (1 + config.backtest.recoveryReboundPct);
  if(rebound && bad >= Math.ceil(window.length * config.sessionQuality.plateau.badFraction)) return 'bad-sessions';
  return 'genuine';
}

function plateauLabel(kind){
  if(kind === 'mixed') return 'bad-sessions';
  return kind;
}

function confusion(rows, predictedKey, actualKey){
  const matrix = {};
  let correct = 0;
  for(const row of rows || []){
    const predicted = String(row[predictedKey]);
    const actual = String(row[actualKey]);
    if(predicted === actual) correct += 1;
    if(!matrix[predicted]) matrix[predicted] = {};
    matrix[predicted][actual] = (matrix[predicted][actual] || 0) + 1;
  }
  return { n: rows?.length || 0, accuracy: rows?.length ? round(correct / rows.length, 3) : null, matrix };
}

function calibrationBins(rows){
  const bins = [0, 0.2, 0.4, 0.6, 0.8].map(lower=> ({ lower, upper: lower + 0.2, n: 0, predicted: [], observed: [] }));
  for(const row of rows || []){
    const p = clamp(number(row.probability), 0, 1);
    const index = Math.min(bins.length - 1, Math.floor(p * bins.length));
    bins[index].n += 1;
    bins[index].predicted.push(p);
    bins[index].observed.push(row.completed ? 1 : 0);
  }
  return bins.filter(bin=> bin.n).map(bin=> ({ lower: bin.lower, upper: bin.upper, n: bin.n, meanPredicted: round(mean(bin.predicted), 3), observedRate: round(mean(bin.observed), 3) }));
}

function metricForRows(rows){
  const loadKg = rows.map(row=> row.loadErrorKg).filter(Number.isFinite);
  const loadPct = rows.map(row=> row.loadErrorPct).filter(Number.isFinite);
  const reps = rows.map(row=> row.repError).filter(Number.isFinite);
  const hits = rows.filter(row=> row.loadHit && row.repHit);
  return {
    n: rows.length,
    loadRecommendationError: { n: loadKg.length, meanAbsKg: round(mean(loadKg), 3), medianAbsKg: round(median(loadKg), 3), meanAbsPct: round(mean(loadPct), 3) },
    repRecommendationError: { n: reps.length, meanAbsReps: round(mean(reps), 3), medianAbsReps: round(median(reps), 3) },
    hitRate: rows.length ? round(hits.length / rows.length, 3) : null,
  };
}

function buildStrata(rows){
  const dimensions = ['exercise', 'availableHistory', 'trainingAge', 'equipment', 'consistency', 'repRange', 'movementType'];
  const output = {};
  for(const dimension of dimensions){
    const groups = new Map();
    for(const row of rows || []){
      const key = row.stratum?.[dimension] || 'unknown';
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    output[dimension] = Object.fromEntries([...groups.entries()].sort(([a], [b])=> a.localeCompare(b)).map(([key, group])=> {
      const metric = metricForRows(group);
      const brier = group.map(row=> row.completionBrier).filter(Number.isFinite);
      return [key, {
        n: group.length,
        loadMaeKg: metric.loadRecommendationError.meanAbsKg,
        repMae: metric.repRecommendationError.meanAbsReps,
        hitRate: metric.hitRate,
        completionBrier: round(mean(brier), 3),
      }];
    }));
  }
  return output;
}

function nextCompletedSession(timeline, orderIndex){
  return timeline.find(item=> item.orderIndex > orderIndex)?.session || null;
}

function scheduleRows(schedule){
  const sessions = Array.isArray(schedule) ? schedule : schedule?.sessions || [];
  return sessions.slice().sort((a, b)=> dateMs(a.dateISO) - dateMs(b.dateISO));
}

function plannedTargetReps(schedule, session, exerciseId, fallbackTargetReps){
  const scheduleId = session?.scheduleSessionId || session?.plannedSessionId || session?.id;
  const planned = scheduleRows(schedule).find(candidate=> candidate.id === scheduleId);
  const plannedBlock = (planned?.blocks || []).find(block=> block.exerciseId === exerciseId);
  return plannedBlock?.reps || fallbackTargetReps;
}

function completedScheduleId(session){
  return session?.scheduleSessionId || session?.plannedSessionId || session?.id || null;
}

function missedRecoveryAtPoint(schedule, historyBefore, asOfDateISO){
  const completed = new Set((historyBefore || []).map(completedScheduleId).filter(Boolean));
  const missed = scheduleRows(schedule).filter(session=> session.dateISO < asOfDateISO && !completed.has(session.id));
  if(!missed.length) return { needed: false, missed: [], oldest: null };
  const oldest = missed[0];
  return {
    needed: true,
    missed,
    oldest,
    recommendation: missed.length === 1 ? `Recover ${oldest.title || 'the missed session'} next, then continue the programme order. Do not double the next workout.` : `${missed.length} sessions are overdue. Re-plan them in order and keep at least one recovery day between sessions.`,
  };
}

function classificationMetrics(rows){
  const base = confusion(rows, 'predictedBad', 'actualBad');
  const positives = rows.filter(row=> row.predictedBad).length;
  const actual = rows.filter(row=> row.actualBad).length;
  const truePositive = rows.filter(row=> row.predictedBad && row.actualBad).length;
  return {
    ...base,
    predictedBad: positives,
    actualBad: actual,
    precision: positives ? round(truePositive / positives, 3) : null,
    recall: actual ? round(truePositive / actual, 3) : null,
    brier: round(mean(rows.map(row=> row.brier).filter(Number.isFinite)), 3),
  };
}

function normaliseInput(input, options){
  if(Array.isArray(input)) return { formatVersion: BENCHMARK_FORMAT_VERSION, kind: 'real-history', history: input, ...options };
  return { formatVersion: BENCHMARK_FORMAT_VERSION, kind: 'real-history', ...(input || {}), ...options, history: input?.history || options.history || [] };
}

export function validateBenchmarkDataset(dataset){
  const issues = [];
  if(!dataset || typeof dataset !== 'object') issues.push('Dataset must be an object.');
  if(dataset?.formatVersion !== BENCHMARK_FORMAT_VERSION) issues.push(`formatVersion must be ${BENCHMARK_FORMAT_VERSION}.`);
  if(!Array.isArray(dataset?.history)) issues.push('history must be an array.');
  for(const [index, session] of (dataset?.history || []).entries()){
    if(!session?.dateISO || !Number.isFinite(dateMs(session.dateISO))) issues.push(`history[${index}].dateISO must be YYYY-MM-DD.`);
    if(!Array.isArray(session?.blocks)) issues.push(`history[${index}].blocks must be an array.`);
    for(const [blockIndex, block] of (session?.blocks || []).entries()){
      if(!block?.exerciseId) issues.push(`history[${index}].blocks[${blockIndex}].exerciseId is required.`);
      if(!Array.isArray(block?.sets)) issues.push(`history[${index}].blocks[${blockIndex}].sets must be an array.`);
    }
  }
  const kind = dataset?.kind || dataset?.metadata?.kind || 'real-history';
  if(!['synthetic', 'real-history'].includes(kind)) issues.push(`kind must be synthetic or real-history (received ${kind}).`);
  return { valid: issues.length === 0, issues, kind, formatVersion: BENCHMARK_FORMAT_VERSION };
}

export function backtestHistory(input = [], options = {}){
  const dataset = normaliseInput(input, options);
  const config = resolveArisePriors(dataset.config || options.config || null);
  const validation = validateBenchmarkDataset({ ...dataset, history: dataset.history || [] });
  if(!validation.valid) return { status: 'invalid', leakageSafe: true, validation, comparisons: 0, metrics: {}, strata: {}, observations: [] };

  const history = dataset.history || [];
  const readinessLog = dataset.readinessLog || [];
  const profile = dataset.profile || {};
  const schedule = dataset.schedule || dataset.activeSchedule || null;
  const timeline = stableTimeline(history);
  const comparisonRows = [];
  const fatigueRows = [];
  const plateauRows = [];
  const deloadRows = [];
  const recoveryRows = [];

  for(const item of timeline){
    const historyBefore = timeline.filter(other=> other.orderIndex < item.orderIndex).map(other=> other.session);
    const readinessBefore = visibleReadiness(readinessLog, item.session.dateISO);
    const pointProfile = profileAtPoint(profile, dataset.profileHistory, item.session.dateISO);
    const model = fitEmpiricalModel(comparisonRows, config);
    const stratumCache = new Map();

    const getStratum = (exerciseId, targetReps = null)=> {
      const cacheKey = `${exerciseId}|${targetReps||''}`;
      if(!stratumCache.has(cacheKey)) stratumCache.set(cacheKey, stratumFor({ exerciseId, history: historyBefore, profile: pointProfile, session: item.session, asOfDateISO: item.session.dateISO, config, targetReps }));
      return stratumCache.get(cacheKey);
    };

    // Fatigue/bad-session forecast: its input is prior quality only. The
    // current session's actual quality is scored after the forecast is built.
    if(historyBefore.length){
      const priorQuality = fatigueRows;
      const priorRate = empiricalOrPrior({
        prior: config.backtest.fatigue.priorProbability,
        estimate: mean(priorQuality.map(row=> row.actualBad ? 1 : 0)),
        samples: priorQuality.length,
        minimumSamples: config.backtest.minimumStratumSamples,
      });
      let probability = priorRate.value;
      const attribution = badSessionAttribution(historyBefore, { readinessLog: readinessBefore, config });
      if(attribution.kind === 'cluster') probability += config.backtest.fatigue.clusterRiskDelta;
      const lastReadiness = readinessBefore[readinessBefore.length - 1]?.score;
      if(Number.isFinite(Number(lastReadiness)) && Number(lastReadiness) < config.recovery.readinessLowEma) probability += config.backtest.fatigue.readinessRiskDelta;
      probability = clamp(probability, 0, 1);
      const actualQuality = sessionQuality(item.session, { readinessLog, config });
      const actualBad = actualQuality.quality === 'bad';
      fatigueRows.push({
        asOfDateISO: item.session.dateISO,
        probability,
        predictedBad: probability >= config.backtest.fatigue.riskCutoff,
        actualBad,
        brier: (probability - (actualBad ? 1 : 0)) ** 2,
        stratum: getStratum(item.session.blocks?.[0]?.exerciseId || 'session'),
      });
    }

    // Deload recommendation is evaluated against an observed future volume
    // cut, not presented as a causal "need" label. This distinguishes user
    // behaviour/adherence from physiological truth.
    if(historyBefore.length){
      const logs = historyBefore.flatMap(session=> (session.blocks || []).flatMap(block=> (block.sets || []).map(set=> ({ reps: parseReps(set.reps), weightKg: number(set.weightKg), rpe: set.rpe ?? null, dateISO: session.dateISO })))).filter(log=> log.reps > 0);
      const ratios = weeklyRatios(historyBefore);
      const recentRpes = logs.slice(-config.recovery.recentSetWindow).map(log=> log.rpe).filter(value=> value != null && String(value).trim() !== '');
      const decision = deloadReadinessAssessment({ logs, recentRpes, weeklyVolumeTrend: ratios, readinessHistory: readinessBefore, history: historyBefore, config });
      const currentTime = dateMs(item.session.dateISO);
      const priorVolume = volumeBetween(history, currentTime - 7 * 86400000, currentTime);
      const nextVolume = volumeBetween(history, currentTime, currentTime + config.backtest.observedDeloadWindowDays * 86400000);
      const horizonComplete = history.some(session=> {
        const t = dateMs(session.dateISO);
        return Number.isFinite(t) && t >= currentTime + config.backtest.observedDeloadWindowDays * 86400000;
      });
      const observedCut = priorVolume > 0 && horizonComplete ? nextVolume <= priorVolume * config.backtest.observedDeloadCutRatio : null;
      const futureAfterWindow = volumeBetween(history, currentTime + config.backtest.observedDeloadWindowDays * 86400000, currentTime + 2 * config.backtest.observedDeloadWindowDays * 86400000);
      deloadRows.push({
        asOfDateISO: item.session.dateISO,
        recommended: !!decision.yes,
        observedCut,
        effectiveAfterCut: observedCut === true ? futureAfterWindow > nextVolume : null,
        decision,
      });
    }

    if(schedule){
      const recovery = missedRecoveryAtPoint(schedule, historyBefore, item.session.dateISO);
      if(recovery.needed){
        const next = nextCompletedSession(timeline, item.orderIndex);
        const nextId = completedScheduleId(next);
        recoveryRows.push({
          asOfDateISO: item.session.dateISO,
          oldestId: recovery.oldest.id,
          predictedNextId: recovery.oldest.id,
          actualNextId: nextId,
          followed: !!nextId && nextId === recovery.oldest.id,
          recommendation: recovery.recommendation,
        });
      }
    }

    const sessionRows = [];
    for(const block of item.session.blocks || []){
      const exerciseId = block.exerciseId;
      const actual = firstSet(block);
      const best = bestSet(block) || actual;
      if(!exerciseId || !actual) continue;
      const previous = lastExposure(historyBefore, exerciseId);
      if(!previous?.best) continue; // A first exposure has no next-session target to score.
      const targetReps = plannedTargetReps(schedule, item.session, exerciseId, config.progression.defaultTargetReps) || config.progression.defaultTargetReps;
      const stratum = getStratum(exerciseId, targetReps);
      const strategy = config.progression.strategies[strategyForExercise(exerciseId, { config })] || config.progression.strategies.hypertrophy;
      const completionPrior = config.backtest.completion.priorProbability;
      const progressionPrior = strategy.incPct;
      const completionEstimate = model.lookup('completionProbability', stratum, completionPrior);
      const progressionEstimate = model.lookup('progressionRatePct', stratum, progressionPrior);
      const recommendation = recommendNext({
        exerciseId,
        history: historyBefore,
        targetReps,
        config,
        asOfDateISO: item.session.dateISO,
        calibration: progressionEstimate.source === 'empirical' ? { progressionRatePct: progressionEstimate.value } : null,
      });
      const loadErrorKg = recommendation.load != null && actual.weightKg > 0 ? Math.abs(Number(recommendation.load) - actual.weightKg) : null;
      const loadErrorPct = loadErrorKg != null ? loadErrorKg / Math.max(1, actual.weightKg) : null;
      const repError = recommendation.reps != null ? Math.abs(Number(recommendation.reps) - actual.reps) : null;
      const loadHit = recommendation.load == null || recommendation.load <= 0 || (loadErrorPct != null && loadErrorPct <= config.backtest.loadTolerancePct);
      const repHit = recommendation.reps == null || (repError != null && repError <= config.backtest.repTolerance);
      const completed = targetMet(recommendation, actual);
      const previousAction = previous.best;
      const predictedAction = progressionAction(recommendation, previousAction, config);
      const actualAction = observedAction(best, previousAction, config);
      const futureForTiming = futureExposures(timeline, item.orderIndex, exerciseId, config.backtest.maxOutcomeHorizonExposures);
      const observedProgressionOffset = futureForTiming.findIndex(future=> isProgressionAction(observedAction(future.best, previousAction, config)));
      const observedLoadPct = previous.best.weightKg > 0 && best.weightKg > previous.best.weightKg ? best.weightKg / previous.best.weightKg - 1 : null;
      const noisy = noisySessionContext(item.session, historyBefore, { readinessLog: readinessBefore, schedule, config });
      const probability = completionEstimate.value;
      const row = {
        asOfDateISO: item.session.dateISO,
        sessionId: item.session.id || null,
        exerciseId,
        stratum,
        noisyFlags: noisy.flags,
        noisyContext: noisy.details,
        recommendation: { load: recommendation.load, reps: recommendation.reps, assistKg: recommendation.assistKg, reason: recommendation.reason },
        actual: { load: actual.weightKg, reps: actual.reps, e1rm: best.e1rm },
        previousBest: { reps: previousAction.reps, weightKg: previousAction.weightKg, assistedKg: previousAction.assistedKg, e1rm: previousAction.e1rm },
        loadErrorKg,
        loadErrorPct,
        repError,
        loadHit,
        repHit,
        completed,
        probability,
        predictedCompleted: probability >= config.backtest.completion.decisionCutoff,
        completionBrier: (probability - (completed ? 1 : 0)) ** 2,
        completionLogLoss: -(completed ? Math.log(Math.max(1e-12, probability)) : Math.log(Math.max(1e-12, 1 - probability))),
        predictedAction,
        actualAction,
        actionMatch: predictedAction === actualAction,
        predictedProgression: isProgressionAction(predictedAction),
        actualProgression: isProgressionAction(actualAction),
        observedProgressionOffset: observedProgressionOffset >= 0 ? observedProgressionOffset : null,
        progressionTimingErrorSessions: isProgressionAction(predictedAction) && observedProgressionOffset >= 0 ? Math.abs(observedProgressionOffset) : null,
        observedLoadPct,
        calibration: {
          completionProbability: completionEstimate,
          progressionRatePct: progressionEstimate,
        },
        reconstruction: {
          visibleSessions: historyBefore.length,
          visibleReadinessEntries: readinessBefore.length,
          hiddenFutureSessions: timeline.length - historyBefore.length,
          priorsVersion: config.version,
          leakageSafe: true,
        },
      };
      sessionRows.push(row);
      const outcome = plateauOutcome({ timeline, orderIndex: item.orderIndex, exerciseId, historyBefore, readinessLog, config });
      const attribution = plateauAttribution(historyBefore, exerciseId, { readinessLog: readinessBefore, config });
      if(outcome && attribution.kind !== 'insufficient') plateauRows.push({ predicted: plateauLabel(attribution.kind), actual: outcome, exerciseId, asOfDateISO: item.session.dateISO });
    }
    // Commit current outcomes only after every block in the session has been
    // generated. This prevents a second block on the same date from learning
    // the first block's outcome.
    comparisonRows.push(...sessionRows);
  }

  const recommendation = metricForRows(comparisonRows);
  const progressionRows = comparisonRows.filter(row=> row.predictedAction !== 'unknown');
  const timing = {
    n: progressionRows.length,
    actionAgreement: round(mean(progressionRows.map(row=> row.actionMatch ? 1 : 0)), 3),
    predictedAdvances: progressionRows.filter(row=> row.predictedProgression).length,
    observedAdvances: progressionRows.filter(row=> row.actualProgression).length,
    progressionAgreement: round(mean(progressionRows.map(row=> row.predictedProgression === row.actualProgression ? 1 : 0)), 3),
    predictedAdvancesOnNextExposure: (()=> { const rows = progressionRows.filter(row=> row.predictedProgression && row.observedProgressionOffset != null); return rows.length ? round(mean(rows.map(row=> row.observedProgressionOffset === 0 ? 1 : 0)), 3) : null; })(),
    meanAbsoluteTimingErrorSessions: round(mean(progressionRows.map(row=> row.progressionTimingErrorSessions).filter(Number.isFinite)), 3),
    meanObservedLoadPct: round(mean(progressionRows.map(row=> row.observedLoadPct).filter(Number.isFinite)), 3),
  };
  const completionRows = comparisonRows;
  const completion = {
    n: completionRows.length,
    observedRate: round(mean(completionRows.map(row=> row.completed ? 1 : 0)), 3),
    meanPredicted: round(mean(completionRows.map(row=> row.probability)), 3),
    brier: round(mean(completionRows.map(row=> row.completionBrier)), 3),
    logLoss: round(mean(completionRows.map(row=> row.completionLogLoss)), 3),
    classificationAccuracy: completionRows.length ? round(mean(completionRows.map(row=> row.predictedCompleted === row.completed ? 1 : 0)), 3) : null,
    calibrationBins: calibrationBins(completionRows),
  };
  // Progression validation breakdown: success, failed, regression, stagnation, conservatism
  const progressionValidation = (()=> {
    const predicted = progressionRows.filter(r=> r.predictedProgression);
    const successful = predicted.filter(r=> r.actualProgression && r.loadHit && r.repHit);
    const failed = predicted.filter(r=> !r.actualProgression || !r.loadHit);
    const holdRows = progressionRows.filter(r=> !r.predictedProgression);
    const regressions = predicted.filter(r=> {
      const future = timeline.find(item=> item.session.dateISO > r.asOfDateISO);
      if(!future) return false;
      const futureBlocks = (future.session.blocks||[]).filter(b=> b.exerciseId===r.exerciseId);
      if(!futureBlocks.length) return false;
      const futureBest = Math.max(...futureBlocks.flatMap(b=> (b.sets||[]).map(s=> e1rm(Number(s.weightKg)||0, parseReps(s.reps))||0)));
      return futureBest < (r.actual?.e1rm || 0) * 0.95;
    });
    const stagnation = holdRows.filter(r=> !r.actualProgression && r.observedProgressionOffset == null).length;
    const unnecessary = holdRows.filter(r=> r.actualProgression).length;
    return {
      n: progressionRows.length,
      predictedProgressions: predicted.length,
      successfulProgressions: successful.length,
      failedProgressions: failed.length,
      successfulProgressionRate: predicted.length ? round(successful.length / predicted.length, 3) : null,
      failedProgressionRate: predicted.length ? round(failed.length / predicted.length, 3) : null,
      regressionFollowingProgression: predicted.length ? round(regressions.length / predicted.length, 3) : null,
      regressionFollowingProgressionCount: regressions.length,
      stagnationRate: holdRows.length ? round(stagnation / holdRows.length, 3) : null,
      stagnationCount: stagnation,
      unnecessaryConservatismRate: holdRows.length ? round(unnecessary / holdRows.length, 3) : null,
      unnecessaryConservatismCount: unnecessary,
      note: 'Rates are descriptive; sparse strata remain on priors and are not presented as calibrated evidence.',
    };
  })();
  // Noisy session handling: multiple observations before progression
  const noisyHandling = (()=> {
    const rowsWithNoise = comparisonRows.filter(r=> r.noisyFlags && r.noisyFlags.length);
    const heldDueToNoise = rowsWithNoise.filter(r=> !r.predictedProgression && /noisy|Hold load/i.test(r.recommendation?.reason||''));
    return {
      n: comparisonRows.length,
      noisySessions: rowsWithNoise.length,
      heldDueToNoise: heldDueToNoise.length,
      holdRateWhenNoisy: rowsWithNoise.length ? round(heldDueToNoise.length / rowsWithNoise.length, 3) : null,
      note: 'Conservative holds after noisy context require multiple observations, not a single bad session.',
    };
  })();
  const deloadEvaluable = deloadRows.filter(row=> row.observedCut != null);
  const deload = {
    n: deloadRows.length,
    evaluable: deloadEvaluable.length,
    recommended: deloadRows.filter(row=> row.recommended).length,
    observedCuts: deloadEvaluable.filter(row=> row.observedCut).length,
    agreement: deloadEvaluable.length ? round(mean(deloadEvaluable.map(row=> row.recommended === row.observedCut ? 1 : 0)), 3) : null,
    effectiveAfterCutPct: (()=> { const rows = deloadEvaluable.filter(row=> row.observedCut && row.effectiveAfterCut != null); return rows.length ? round(mean(rows.map(row=> row.effectiveAfterCut ? 1 : 0)) * 100, 1) : null; })(),
    note: 'Observed volume cuts are behaviour/adherence outcomes, not proof that a deload was physiologically required.',
  };
  const recovery = {
    n: recoveryRows.length,
    followed: recoveryRows.filter(row=> row.followed).length,
    sequenceAdherence: recoveryRows.length ? round(mean(recoveryRows.map(row=> row.followed ? 1 : 0)), 3) : null,
    evaluable: recoveryRows.filter(row=> row.actualNextId != null).length,
    available: !!schedule,
    note: schedule ? 'A recovery recommendation is counted as followed only when the next logged session matches the oldest missed schedule session.' : 'Provide a schedule with stable session IDs to evaluate missed-session recovery.',
  };

  const metrics = {
    recommendation,
    loadRecommendationError: recommendation.loadRecommendationError,
    repRecommendationError: recommendation.repRecommendationError,
    progressionTiming: timing,
    progressionValidation,
    noiseHandling: noisyHandling,
    completionProbability: completion,
    plateauClassification: { ...confusion(plateauRows, 'predicted', 'actual'), rows: plateauRows.length },
    fatigueClassification: classificationMetrics(fatigueRows),
    deloadRecommendation: deload,
    deloadFatigueValidation: {
      ...deload,
      validationNote: 'Evaluate whether deload decisions precede persistent decline, repeated missed targets, fatigue trends and adherence drops; single bad workout never triggers deload alone (requires 2+ signals).',
      noisyHandling,
    },
    missedSessionRecovery: recovery,
  };

  const model = fitEmpiricalModel(comparisonRows, config);
  const calibration = calibrationSummary(model, comparisonRows, config);
  const minimum = config.backtest.minimumComparisons;
  return {
    status: comparisonRows.length >= minimum ? 'calibrated' : comparisonRows.length ? 'warming' : 'insufficient',
    leakageSafe: true,
    validation,
    comparisons: comparisonRows.length,
    candidatePoints: timeline.reduce((count, item)=> count + (item.session.blocks || []).filter(block=> firstSet(block)).length, 0),
    metrics,
    strata: buildStrata(comparisonRows),
    calibration,
    observations: comparisonRows,
    fatigueObservations: fatigueRows,
    plateauObservations: plateauRows,
    deloadObservations: deloadRows,
    recoveryObservations: recoveryRows,
    coverage: {
      sessions: history.length,
      dates: [...new Set(history.map(session=> session.dateISO).filter(Boolean))].sort(),
      exercises: [...new Set(history.flatMap(session=> (session.blocks || []).map(block=> block.exerciseId)).filter(Boolean))].sort(),
      readinessEntries: readinessLog.length,
      profileHistoryEntries: (dataset.profileHistory || []).length,
      scheduleProvided: !!schedule,
      minimumComparisons: minimum,
      priorsVersion: config.version,
    },
  };
}

function calibrationSummary(model, rows, config){
  const estimates = [];
  for(const [key, stat] of model.stats.entries()){
    const [metric, bucket] = key.split('::');
    if(!bucket || stat.n < model.minimumSamples) continue;
    estimates.push({ metric, bucket, n: stat.n, estimate: round(stat.sum / stat.n, 4), source: 'empirical', minimumSamples: model.minimumSamples });
  }
  return {
    source: estimates.length ? 'mixed' : 'priors',
    minimumSamples: model.minimumSamples,
    comparisonsUsed: rows.length,
    empiricalEstimates: estimates,
    empiricalReplacementCount: estimates.length,
    note: estimates.length ? 'Empirical estimates replace priors only in strata meeting the minimum sample count; all other decisions retain priors.' : 'No stratum has enough comparable observations to replace a prior.',
    priorsVersion: config.version,
  };
}

export function calibrateHistory(input = [], options = {}){
  return backtestHistory(input, options).calibration || { source: 'priors', empiricalEstimates: [] };
}

export const benchmarkHistory = backtestHistory;
