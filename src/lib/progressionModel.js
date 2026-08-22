// progressionModel.js — evidence-gated progression model.
//
// Philosophy (locked in with the user): every capability is INERT until
//   (a) its own sample gate opens (enough observations in that stratum), and
//   (b) where a comparator exists, the study shows arise LOSING to that
//       baseline in the stratum (a demonstrated weakness).
//
// The model therefore never invents new decision trees. It estimates, gates,
// and emits a bounded priors-overlay consumed exclusively through knobs the
// deterministic engine already reads (strategies.<key>.incPct,
// strategyByExercise, personalisedRate bands). Everything stays explainable:
// each overlay entry traces back to samples + measured weakness.

import { resolveArisePriors, clamp } from './priors.js';
import { personalisedRate, e1rm, strategyForExercise, recommendNext } from './progression.js';
import { movementPatternFor } from './substitutions.js';

// ── Small shared helpers ────────────────────────────────────────────────

function mean(values){
  return values.length ? values.reduce((a, b)=> a + b, 0) / values.length : null;
}
function round(value, digits = 3){
  if(!Number.isFinite(Number(value))) return null;
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
}
function parseReps(value){
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}
function dayDiff(fromISO, toISO){
  const a = Date.parse(`${fromISO}T00:00:00Z`), b = Date.parse(`${toISO}T00:00:00Z`);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}
function orderedSessions(history){
  return [...(history || [])]
    .filter(s=> s?.dateISO)
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
}
function sessionMeanRpe(session){
  const rpes = [];
  for(const b of session.blocks || []) for(const s of b.sets || []){
    const rpe = Number(s.rpe);
    if(Number.isFinite(rpe)) rpes.push(rpe);
  }
  return rpes.length ? mean(rpes) : null;
}
function sessionMeanE1rm(session){
  const vals = [];
  for(const b of session.blocks || []) for(const s of b.sets || []){
    const v = e1rm(Number(s.weightKg) || 0, parseReps(s.reps));
    if(v > 0) vals.push(v);
  }
  return vals.length ? mean(vals) : null;
}
function uniqueExercises(history){
  const ids = new Set();
  for(const s of history || []) for(const b of s.blocks || []) if(b?.exerciseId) ids.add(b.exerciseId);
  return [...ids];
}

// ── Estimators (pure, history-only) ─────────────────────────────────────

export function exerciseResponseEstimates(history, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const gate = cfg.progressionModel.minExposuresPerExercise;
  const out = {};
  for(const exerciseId of uniqueExercises(history)){
    const rate = personalisedRate(history, exerciseId, { config });
    if(rate && rate.n >= gate){
      out[exerciseId] = { weeklyLoadPct: rate.weeklyLoadPct, n: rate.n, spanDays: rate.spanDays };
    }
  }
  return out;
}

export function movementResponseEstimates(history, exerciseRates = {}, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const gate = cfg.progressionModel.minExposuresPerMovement;
  const groups = new Map();
  for(const [exerciseId, rate] of Object.entries(exerciseRates)){
    const pattern = movementPatternFor(exerciseId) || 'unpatterned';
    if(!groups.has(pattern)) groups.set(pattern, { exercises: [], n: 0, weighted: 0 });
    const g = groups.get(pattern);
    g.exercises.push(exerciseId);
    g.n += rate.n;
    g.weighted += rate.weeklyLoadPct * rate.n;
  }
  const out = {};
  for(const [pattern, g] of groups){
    if(g.n >= gate) out[pattern] = { weeklyLoadPct: round(g.weighted / g.n), n: g.n };
  }
  return out;
}

export function repRangeResponseEstimates(history, exerciseRates = {}, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const gate = cfg.progressionModel.minExposuresPerRepRange;
  const buckets = new Map();
  for(const [exerciseId, rate] of Object.entries(exerciseRates)){
    const exposures = exposuresForSafe(history, exerciseId);
    if(!exposures.length) continue;
    const repsValues = exposures.map(e=> e.best.reps).sort((a, b)=> a - b);
    const median = repsValues[Math.floor(repsValues.length / 2)];
    const bucket = median <= 5 ? 'low(≤5)' : median <= 8 ? 'mid(6–8)' : 'high(≥9)';
    if(!buckets.has(bucket)) buckets.set(bucket, { exercises: [], n: 0, weighted: 0 });
    const b = buckets.get(bucket);
    b.exercises.push(exerciseId);
    b.n += rate.n;
    b.weighted += rate.weeklyLoadPct * rate.n;
  }
  const out = {};
  for(const [bucket, b] of buckets){
    if(b.n >= gate) out[bucket] = { weeklyLoadPct: round(b.weighted / b.n), n: b.n };
  }
  return out;
}
function exposuresForSafe(history, exerciseId){
  try{
    // Local minimal reimplementation to avoid a hard dependency cycle at import time.
    const rows = [];
    for(const session of orderedSessions(history)){
      let best = null;
      for(const block of session.blocks || []){
        if(block.exerciseId !== exerciseId) continue;
        for(const set of block.sets || []){
          const reps = parseReps(set.reps);
          const weightKg = Number(set.weightKg) || 0;
          const score = e1rm(weightKg, reps) || reps;
          if(reps > 0 && (!best || score > best.score)) best = { reps, weightKg, score };
        }
      }
      if(best) rows.push({ session, best });
    }
    return rows;
  }catch{ return []; }
}

export function volumeToleranceEstimate(history, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const sessions = orderedSessions(history);
  const weeks = new Map(); // mondayKey -> { sets }
  const perf = new Map();  // mondayKey -> mean e1rm across that week's sessions
  for(const s of sessions){
    const d = new Date(`${s.dateISO}T00:00:00Z`);
    if(Number.isNaN(d.getTime())) continue;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    let sets = 0;
    for(const b of s.blocks || []) sets += (b.sets || []).length;
    const w = weeks.get(key) || { sets: 0 };
    w.sets += sets;
    weeks.set(key, w);
    const m = sessionMeanE1rm(s);
    if(m != null) perf.set(key, m); // last wins within a week — good enough for a coarse signal
  }
  const keys = [...weeks.keys()].sort();
  const deltas = [];
  for(let i = 0; i < keys.length - 1; i++){
    const nextPerf = perf.get(keys[i + 1]), curPerf = perf.get(keys[i]);
    if(nextPerf == null || curPerf == null) continue;
    deltas.push({ sets: weeks.get(keys[i]).sets, delta: nextPerf / Math.max(1e-9, curPerf) - 1 });
  }
  if(deltas.length < cfg.progressionModel.volumeMinWeeks) return { ready: false, pairedWeeks: deltas.length };
  const positive = deltas.filter(d => d.delta > 0);
  const sortedSets = positive.map(d => d.sets).sort((a, b)=> a - b);
  return {
    ready: true,
    pairedWeeks: deltas.length,
    positiveFraction: round(positive.length / deltas.length),
    estimatedTolerableWeeklySets: sortedSets.length ? sortedSets[Math.floor(sortedSets.length / 2)] : null,
  };
}

export function fatigueCarryoverEstimate(history, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const sessions = orderedSessions(history);
  const afterHigh = [], afterNormal = [];
  for(let i = 1; i < sessions.length; i++){
    const prevRpe = sessionMeanRpe(sessions[i - 1]);
    const curPerf = sessionMeanE1rm(sessions[i]), prevPerf = sessionMeanE1rm(sessions[i - 1]);
    if(prevRpe == null || curPerf == null || prevPerf == null) continue;
    const delta = curPerf / Math.max(1e-9, prevPerf) - 1;
    if(prevRpe >= cfg.recovery.highRpe) afterHigh.push(delta);
    else afterNormal.push(delta);
  }
  if(afterHigh.length < cfg.progressionModel.minPairsFatigue || afterNormal.length < cfg.progressionModel.minPairsFatigue){
    return { ready: false, pairs: { high: afterHigh.length, normal: afterNormal.length } };
  }
  const high = mean(afterHigh), normal = mean(afterNormal);
  return {
    ready: true,
    pairs: { high: afterHigh.length, normal: afterNormal.length },
    meanChangeAfterHighRpe: round(high, 4),
    meanChangeAfterNormalRpe: round(normal, 4),
    carryoverDelta: round(high - normal, 4),
  };
}

export function frequencyEffectEstimate(history, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const buckets = { '≤2d': [], '3d': [], '4–6d': [], '≥7d': [] };
  for(const exerciseId of uniqueExercises(history)){
    const rows = exposuresForSafe(history, exerciseId);
    for(let i = 1; i < rows.length; i++){
      const gap = dayDiff(rows[i - 1].session.dateISO, rows[i].session.dateISO);
      const prevScore = rows[i - 1].best.score, curScore = rows[i].best.score;
      if(gap == null || !prevScore || !curScore) continue;
      const delta = curScore / Math.max(1e-9, prevScore) - 1;
      const key = gap <= 2 ? '≤2d' : gap === 3 ? '3d' : gap <= 6 ? '4–6d' : '≥7d';
      buckets[key].push(delta);
    }
  }
  const out = {};
  for(const [key, arr] of Object.entries(buckets)){
    if(arr.length >= cfg.progressionModel.minPerBucketFrequency){
      out[key] = { n: arr.length, meanChange: round(mean(arr), 4) };
    }
  }
  return Object.keys(out).length ? { ready: true, buckets: out } : { ready: false, buckets: out };
}

export function orderEffectEstimate(history, { config = null } = {}){
  const sessions = orderedSessions(history);
  const bestByExercise = new Map();
  for(const s of sessions) for(const b of s.blocks || []) for(const st of b.sets || []){
    const v = e1rm(Number(st.weightKg) || 0, parseReps(st.reps));
    if(v > 0 && (!bestByExercise.has(b.exerciseId) || v > bestByExercise.get(b.exerciseId))){
      bestByExercise.set(b.exerciseId, v);
    }
  }
  const first = [], later = [];
  for(const s of sessions){
    const blocks = (s.blocks || []);
    if(blocks.length < 3) continue;
    for(let i = 0; i < blocks.length; i++){
      let bestVal = 0;
      for(const st of blocks[i].sets || []){
        const v = e1rm(Number(st.weightKg) || 0, parseReps(st.reps));
        if(v > bestVal) bestVal = v;
      }
      const norm = bestByExercise.get(blocks[i].exerciseId);
      if(!bestVal || !norm) continue;
      (i === 0 ? first : later).push(bestVal / norm);
    }
  }
  if(first.length < 5 || later.length < 5) return { ready: false, n: { first: first.length, later: later.length } };
  const f = mean(first), l = mean(later);
  return {
    ready: true,
    n: { first: first.length, later: later.length },
    firstSlotMeanRatio: round(f, 4),
    laterSlotMeanRatio: round(l, 4),
    laterPenalty: round(l - f, 4),
  };
}

export function substitutionEquivalenceEstimate(history, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const sessions = orderedSessions(history);
  const bestBefore = new Map(); // exerciseId -> best e1rm so far
  const ratios = [], perPair = new Map();
  for(const s of sessions){
    for(const b of s.blocks || []){
      if(!b.substitutionFrom) continue;
      let bestVal = 0;
      for(const st of b.sets || []){
        const v = e1rm(Number(st.weightKg) || 0, parseReps(st.reps));
        if(v > bestVal) bestVal = v;
      }
      const preFrom = bestBefore.get(b.substitutionFrom) || 0;
      if(bestVal > 0 && preFrom > 0){
        const ratio = bestVal / preFrom;
        ratios.push(ratio);
        const pairKey = `${b.substitutionFrom}→${b.exerciseId}`;
        if(!perPair.has(pairKey)) perPair.set(pairKey, []);
        perPair.get(pairKey).push(ratio);
      }
    }
    for(const b of s.blocks || []) for(const st of b.sets || []){
      const v = e1rm(Number(st.weightKg) || 0, parseReps(st.reps));
      if(v > 0 && (!bestBefore.has(b.exerciseId) || v > bestBefore.get(b.exerciseId))){
        bestBefore.set(b.exerciseId, v);
      }
    }
  }
  if(ratios.length < cfg.progressionModel.equivalenceMinPairs){
    return { ready: false, n: ratios.length };
  }
  const pairs = {};
  for(const [pair, arr] of perPair){
    if(arr.length >= 2) pairs[pair] = { n: arr.length, meanRatio: round(mean(arr)) };
  }
  return { ready: true, n: ratios.length, meanEquivalenceRatio: round(mean(ratios)), within90Pct: round(ratios.filter(r => r >= 0.9).length / ratios.length), pairs };
}

export function autoregulationShiftEstimate(history, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const recent = orderedSessions(history).slice(-cfg.progressionModel.minSessionsForResponseShift);
  let roomy = 0, grinding = 0, counted = 0;
  for(const s of recent) for(const b of s.blocks || []) for(const st of b.sets || []){
    const rpe = Number(st.rpe);
    if(!Number.isFinite(rpe)) continue;
    counted++;
    if(rpe <= 7) roomy++;
    else if(rpe >= cfg.recovery.highRpe) grinding++;
  }
  if(counted < 10) return { ready: false, setsCounted: counted };
  const shift = clamp(((roomy - grinding) / counted) * cfg.progressionModel.autoregulationShiftMax, -cfg.progressionModel.autoregulationShiftMax, cfg.progressionModel.autoregulationShiftMax);
  return { ready: true, setsCounted: counted, roomyFraction: round(roomy / counted), grindFraction: round(grinding / counted), shift: round(shift, 4) };
}

// ── Capability assessment ───────────────────────────────────────────────

// Weakness test against the double-progression arm inside a study segment.
function losesToDoubleProgression(segment, minimum){
  if(!segment?.arise || !segment?.['double-progression']) return false;
  if(!segment.arise.conclusive || segment.arise.n < minimum) return false;
  const a = segment.arise.targetAchievementRate, d = segment['double-progression'].targetAchievementRate;
  return a != null && d != null && a < d;
}

// Short-break easing opens only when BOTH hold:
//   1. ≥7-day gap transitions show no measurable performance detriment
//      (mean change above -1.5%), so easing back is provably unnecessary
//      conservatism rather than recovery prudence, and
//   2. arise stagnates more than double-progression overall (the engine's
//      default gap handling is demonstrably too timid).
function shortBreakOpen(estimates, study){
  const bucket = estimates.frequency?.buckets?.['≥7d'];
  if(!bucket || bucket.meanChange < -0.015) return false;
  const o = study?.overall;
  if(!o?.arise?.conclusive || !o?.['double-progression']?.conclusive) return false;
  return (o.arise.stagnationRate ?? 0) > (o['double-progression'].stagnationRate ?? 0);
}

export function assessCapabilities({ history, study = null, estimates, config = null }){
  const cfg = resolveArisePriors(config);
  const minimum = Math.max(1, cfg.longitudinal.minimumSegmentSamples);
  const caps = [];
  const push = (id, label, status, detail)=> caps.push({ id, label, status, detail });

  const exEntries = Object.entries(estimates.exercises || {});
  // Exercise-specific logic: response estimate present AND study proves arise
  // underperforms double progression for THAT exercise.
  const eligibleExercises = exEntries.filter(([ex])=> losesToDoubleProgression(study?.byExercise?.[ex], minimum));
  push('individual-response', 'Individual response estimates',
    exEntries.length ? 'ready' : 'insufficient-data',
    exEntries.length ? `${exEntries.length} exercise${exEntries.length === 1 ? '' : 's'} with ≥${cfg.progressionModel.minExposuresPerExercise} exposures.` : 'No exercise has enough exposures yet.');
  push('exercise-specific', 'Exercise-specific progression logic',
    eligibleExercises.length ? 'active' : study ? 'dormant' : 'awaiting-study',
    eligibleExercises.length
      ? `Weakness proven vs double-progression for: ${eligibleExercises.map(([ex]) => ex).join(', ')}.`
      : study ? 'No conclusive exercise stratum where arise loses to double-progression.' : 'Run the comparative study (More → Progression evidence) to test for weaknesses.');

  // Movement-specific: group study segments by movement pattern.
  if(study?.byExercise){
    const byPattern = new Map();
    for(const [ex, seg] of Object.entries(study.byExercise)){
      const pattern = movementPatternFor(ex) || 'unpatterned';
      if(!byPattern.has(pattern)) byPattern.set(pattern, { n: 0, ariseMet: 0, dpMet: 0 });
      const g = byPattern.get(pattern);
      g.n += (seg.arise?.n || 0);
      g.ariseMet += (seg.arise?.targetAchievementRate ?? 0) * (seg.arise?.n || 0);
      g.dpMet += (seg['double-progression']?.targetAchievementRate ?? 0) * (seg['double-progression']?.n || 0);
    }
    const weakPatterns = [...byPattern.entries()]
      .filter(([, g]) => g.n >= minimum && (g.ariseMet / Math.max(1, g.n)) < (g.dpMet / Math.max(1, g.n)))
      .map(([pattern]) => pattern);
    push('movement-specific', 'Movement-specific logic',
      weakPatterns.length ? 'active' : 'dormant',
      weakPatterns.length ? `Weak patterns: ${weakPatterns.join(', ')}.` : 'No movement pattern shows a proven weakness yet.');
  }else{
    push('movement-specific', 'Movement-specific logic', 'awaiting-study', 'Requires comparative study output.');
  }

  if(study?.overall){
    const o = study.overall;
    const weak = o.arise?.conclusive && o['double-progression']?.conclusive &&
      (o.arise.stagnationRate ?? 0) > (o['double-progression'].stagnationRate ?? 0);
    push('rep-range-specific', 'Rep-range-specific logic',
      Object.keys(estimates.repRanges || {}).length ? (weak ? 'active' : 'dormant') : 'insufficient-data',
      Object.keys(estimates.repRanges || {}).length
        ? `Buckets measured: ${Object.keys(estimates.repRanges).join(', ')}.`
        : 'Not enough exposures per rep-range bucket.');
    push('autoregulation', 'Autoregulation',
      estimates.autoregulation?.ready ? (Math.abs(estimates.autoregulation.shift) > 0.0005 ? 'active' : 'neutral') : 'insufficient-data',
      estimates.autoregulation?.ready
        ? `Roomy ${estimates.autoregulation.roomyFraction} vs grinding ${estimates.autoregulation.grindFraction}; proposed band shift ${estimates.autoregulation.shift}.`
        : 'Fewer than 10 RPE-tagged sets.');
  }

  push('volume-tolerance', 'Volume tolerance estimates',
    estimates.volumeTolerance?.ready ? 'ready' : 'insufficient-data',
    estimates.volumeTolerance?.ready
      ? `${estimates.volumeTolerance.pairedWeeks} paired weeks · tolerable ≈ ${estimates.volumeTolerance.estimatedTolerableWeeklySets} sets/wk (${Math.round((estimates.volumeTolerance.positiveFraction ?? 0) * 100)}% weeks positive).`
      : 'Not enough paired weeks.');
  push('fatigue-carryover', 'Fatigue carryover',
    estimates.fatigueCarryover?.ready ? 'ready' : 'insufficient-data',
    estimates.fatigueCarryover?.ready
      ? `Δ after high-RPE sessions: ${estimates.fatigueCarryover.carryoverDelta} vs normal.`
      : 'Not enough RPE-labelled transitions.');
  push('frequency-effects', 'Training frequency effects',
    estimates.frequency?.ready ? 'ready' : 'insufficient-data',
    estimates.frequency?.ready
      ? Object.entries(estimates.frequency.buckets).map(([k, v]) => `${k}: ${v.meanChange} (n=${v.n})`).join(' · ')
      : 'Not enough per-bucket transitions.');
  push('order-effects', 'Session-order effects',
    estimates.orderEffects?.ready ? 'ready' : 'insufficient-data',
    estimates.orderEffects?.ready ? `Later-slot penalty ${estimates.orderEffects.laterPenalty}.` : 'Not enough multi-block sessions.');
  push('substitute-equivalence', 'Substitute-equivalence modelling',
    estimates.equivalence?.ready ? 'ready' : 'insufficient-data',
    estimates.equivalence?.ready
      ? `Mean equivalence ratio ${estimates.equivalence.meanEquivalenceRatio} across ${estimates.equivalence.n} swaps (${Math.round(estimates.equivalence.within90Pct * 100)}% within 90%).`
      : 'Fewer than the minimum recorded swap outcomes.');

  // Covered by existing, already-evidenced mechanisms.
  push('trend-smoothing', 'Performance trend smoothing', 'existing', 'strengthTrendWithConfidence already gates confidence in Progress view.');
  push('bad-session-detection', 'Temporary bad-session detection', 'existing', 'sessionQuality.noisySessionContext holds prescriptions on flagged sessions.');
  push('plateau-detection', 'Plateau detection', 'existing', 'isPlateauV2 distinguishes real plateaus from noisy sessions.');
  push('deload-timing', 'Deload timing', 'existing', 'deloadReadinessAssessment fires on sustained multi-signal fatigue.');
  push('deload-recovery-validation', 'Deload recovery validation', 'existing', 'study.validateDeloadDecisions audits observed cuts and rebound.');
  const sbOpen = shortBreakOpen(estimates, study);
  push('short-break-return', 'Short-break return easing',
    sbOpen ? 'active' : study ? 'dormant' : 'awaiting-study',
    sbOpen
      ? 'Gaps of 5–14 days show no measurable performance loss and arise stagnates more than double-progression — one eased exposure on return.'
      : 'Opens when ≥7-day-gap transitions show no detriment AND arise stagnates more than double-progression overall.');
  push('missed-week-recovery', 'Missed-week recovery', 'existing', 'programming.replanSchedule shifts pending sessions; adherence tracked.');
  push('return-from-break', 'Return-from-break logic', 'existing', 'trainingBreakInfo reduces return loads after long breaks.');

  return caps;
}

// ── Overlay construction (the only place the model touches the engine) ──

export function deriveProgressionModel({ history, study = null, config = null } = {}){
  const cfg = resolveArisePriors(config);
  const estimates = {};
  const safe = fn => { try{ return fn(); }catch{ return null; } };
  estimates.exercises = safe(() => exerciseResponseEstimates(history, { config })) || {};
  estimates.movements = safe(() => movementResponseEstimates(history, estimates.exercises, { config })) || {};
  estimates.repRanges = safe(() => repRangeResponseEstimates(history, estimates.exercises, { config })) || {};
  estimates.volumeTolerance = safe(() => volumeToleranceEstimate(history, { config }));
  estimates.fatigueCarryover = safe(() => fatigueCarryoverEstimate(history, { config }));
  estimates.frequency = safe(() => frequencyEffectEstimate(history, { config }));
  estimates.orderEffects = safe(() => orderEffectEstimate(history, { config }));
  estimates.equivalence = safe(() => substitutionEquivalenceEstimate(history, { config }));
  estimates.autoregulation = safe(() => autoregulationShiftEstimate(history, { config }));

  const capabilities = assessCapabilities({ history, study, estimates, config });

  const overlay = { progression: { strategies: {}, strategyByExercise: {} } };
  const pmCfg = cfg.progressionModel;
  const maxDelta = pmCfg.maxIncPctDelta;

  for(const [exerciseId, rate] of Object.entries(estimates.exercises)){
    const cap = capabilities.find(c => c.id === 'exercise-specific');
    if(cap.status !== 'active') break;
    const segment = study?.byExercise?.[exerciseId];
    if(!losesToDoubleProgression(segment, Math.max(1, cfg.longitudinal.minimumSegmentSamples))) continue;

    const baseName = strategyForExercise(exerciseId, { config: cfg });
    const base = cfg.progression.strategies[baseName] || cfg.progression.strategies.hypertrophy;
    let tuned = base.incPct * (1 + clamp(rate.weeklyLoadPct, -pmCfg.maxIncPctDelta * 4, pmCfg.maxIncPctDelta * 4));
    // Fatigue factor: if carry-over is measurably negative, dampen aggression.
    if(estimates.fatigueCarryover?.ready && estimates.fatigueCarryover.carryoverDelta < 0){
      tuned *= clamp(1 + estimates.fatigueCarryover.carryoverDelta, 0.85, 1);
    }
    // Frequency factor: chronically sparse exposures with worse outcomes.
    const freqBucket = estimates.frequency?.buckets?.['≥7d'];
    if(freqBucket && freqBucket.meanChange < 0){
      tuned *= 0.95;
    }
    tuned = clamp(round(tuned, 4), Math.max(0.005, base.incPct - maxDelta), base.incPct + maxDelta);
    const key = `__model:${exerciseId}`;
    overlay.progression.strategies[key] = { ...base, incPct: tuned };
    overlay.progression.strategyByExercise[exerciseId] = key;
  }

  if(estimates.autoregulation?.ready && Math.abs(estimates.autoregulation.shift) > 0.0005){
    const pr = cfg.progression.personalisedRate;
    overlay.progression.personalisedRate = {
      appliedLoadPctMin: round(clamp(pr.appliedLoadPctMin + estimates.autoregulation.shift, 0.005, pr.appliedLoadPctMin + pmCfg.autoregulationShiftMax), 4),
      appliedLoadPctMax: round(clamp(pr.appliedLoadPctMax + estimates.autoregulation.shift, pr.appliedLoadPctMax - pmCfg.autoregulationShiftMax, 0.09), 4),
    };
  }

  if(shortBreakOpen(estimates, study)){
    overlay.progression.shortBreakPolicy = {
      enabled: true,
      minDays: 5,
      moderateDays: 14,
      lightLoadMultiplier: 0.95,
      moderateLoadMultiplier: 0.9,
    };
  }

  return {
    modelVersion: pmCfg.version,
    generatedAtISO: new Date().toISOString(),
    capabilities,
    estimates,
    overlayConfig: overlay,
    activeOverrideCount: Object.keys(overlay.progression.strategies).length,
    autoregulationApplied: !!overlay.progression.personalisedRate,
    shortBreakEasing: !!overlay.progression.shortBreakPolicy,
  };
}

// Convenience wrapper used by callers that want recommendations shaped by the
// model when — and only when — evidence opened a capability.
export function recommendNextWithModel({ exerciseId, history, study = null, config = null, ...rest } = {}){
  const model = deriveProgressionModel({ history, study, config });
  const merged = resolveArisePriors(config);
  merged.progression.strategies = { ...merged.progression.strategies, ...(model.overlayConfig.progression.strategies || {}) };
  merged.progression.strategyByExercise = { ...(merged.progression.strategyByExercise || {}), ...(model.overlayConfig.progression.strategyByExercise || {}) };
  if(model.overlayConfig.progression.personalisedRate){
    merged.progression.personalisedRate = { ...merged.progression.personalisedRate, ...model.overlayConfig.progression.personalisedRate };
  }
  if(model.overlayConfig.progression.shortBreakPolicy){
    merged.progression.shortBreakPolicy = model.overlayConfig.progression.shortBreakPolicy;
  }
  const recommendation = recommendNext({ exerciseId, history, config: merged, ...rest });
  if(recommendation) recommendation.__progressionModel = { version: model.modelVersion, applied: model.activeOverrideCount > 0 || model.autoregulationApplied || model.shortBreakEasing, activeOverrideCount: model.activeOverrideCount };
  return recommendation;
}
