// study.js — the actual longitudinal study: does Arise's progression engine
// beat honest baselines on real training outcomes?
//
// Structure mirrors longitudinal.js (prospective ledger) and backtesting.js
// (retrospective replay), but adds what neither had: COMPARISON ARMS. The same
// point-in-time history is shown to several prescribing strategies and each is
// scored against the same real outcome, so differences are attributable.
//
// Arms:
//   arise                — recommendNext (plateau/noise/RPE-aware engine)
//   double-progression   — textbook: add a rep until the top of range, then a
//                          small load step back to the bottom. No guards.
//   linear-progression   — add a fixed increment every session regardless of
//                          performance (falls back to flat for bodyweight).
//   coach                — optional human prescriptions, scored where supplied.
//   flat                 — never change anything (floor baseline).
//
// Rules inherited from the evaluation layer:
//   - Prior-only: every arm sees exactly the sessions before the outcome date.
//   - Sample gates: segment rates stay null below minimumSamples.
//   - No algorithm changes live here. This file measures; it does not tune.

import { recommendNext, e1rm, trainingAgeInfo, strategyForExercise } from './progression.js';
import { resolveArisePriors } from './priors.js';
import { EXERCISE_BY_ID } from './data.js';
import { equipmentClassFor } from './longitudinal.js';

export const STUDY_ARMS = ['arise', 'double-progression', 'linear-progression', 'flat'];

const LINEAR_STEP_KG = 2.5;

// ── Exposure extraction ─────────────────────────────────────────────────

function parseReps(value){
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function bestSetOfBlock(block){
  let best = null;
  for(const set of block?.sets || []){
    const reps = parseReps(set.reps);
    const weightKg = Number(set.weightKg) || 0;
    const score = e1rm(weightKg, reps) || reps;
    if(reps > 0 && (!best || score > best.score)){
      best = { reps, weightKg, assistedKg: Number(set.assistedKg) || 0, rpe: set.rpe ?? null, score };
    }
  }
  return best;
}

export function exposuresFor(history, exerciseId){
  return (history || [])
    .filter(session=> (session.blocks || []).some(b=> b.exerciseId === exerciseId))
    .map(session=> {
      let best = null;
      for(const block of session.blocks || []){
        if(block.exerciseId !== exerciseId) continue;
        const candidate = bestSetOfBlock(block);
        if(candidate && (!best || candidate.score > best.score)) best = candidate;
      }
      return { session, best };
    })
    .filter(row=> row.best && row.best.reps > 0);
}

// ── Baseline arms ───────────────────────────────────────────────────────

function repRange(targetReps){
  const nums = String(targetReps || '8–12').match(/\d+/g)?.map(Number) || [8, 12];
  return nums.length >= 2 ? [nums[0], nums[1]] : [nums[0] || 8, nums[0] || 12];
}

// Textbook double progression: reps first, then one small load step, reset.
// Deliberately ignores RPE, plateaus, noise and readiness — that is the point.
export function doubleProgressionRec({ history, exerciseId, targetReps = '8–12' }){
  const exposures = exposuresFor(history, exerciseId);
  if(!exposures.length) return { load: null, reps: repRange(targetReps)[0], reason: 'baseline: no history — prescription.' };
  const last = exposures[exposures.length - 1].best;
  const [lo, hi] = repRange(targetReps);
  if(last.weightKg > 0){
    if(last.reps < hi) return { load: last.weightKg, reps: last.reps + 1 };
    return { load: Math.round((last.weightKg + LINEAR_STEP_KG) * 10) / 10, reps: lo };
  }
  // Bodyweight: reps only, harder-variant advice is out of scope for the arm.
  if(last.reps < hi) return { load: null, reps: last.reps + 1 };
  return { load: null, reps: last.reps + 1 };
}

// Linear progression: fixed increment every session, forever.
export function linearProgressionRec({ history, exerciseId, targetReps = '8–12' }){
  const exposures = exposuresFor(history, exerciseId);
  if(!exposures.length) return { load: null, reps: repRange(targetReps)[0], reason: 'baseline: no history — prescription.' };
  const last = exposures[exposures.length - 1].best;
  const [, hi] = repRange(targetReps);
  if(!(last.weightKg > 0)) return { load: null, reps: Math.min(hi, last.reps + 1) }; // bodyweight → degenerates to reps
  return { load: Math.round((last.weightKg + LINEAR_STEP_KG) * 10) / 10, reps: last.reps };
}

// Flat floor: repeat the last performance forever.
export function flatPrescriptionRec({ history, exerciseId, targetReps = '8–12' }){
  const exposures = exposuresFor(history, exerciseId);
  if(!exposures.length) return { load: null, reps: repRange(targetReps)[0], reason: 'baseline: no history — prescription.' };
  const last = exposures[exposures.length - 1].best;
  return { load: last.weightKg > 0 ? last.weightKg : null, reps: last.reps };
}

// Compute every arm's prescription from the SAME prior-only slice.
export function computeArms({ exerciseId, history, targetReps = '8–12', asOfDateISO = null, config = null }){
  const arise = recommendNext({ exerciseId, history, targetReps, asOfDateISO, config });
  return {
    arise: { load: arise.load, reps: arise.reps, assistKg: arise.assistKg ?? null, reason: arise.reason || '', noisy: arise.noisy || [], held: /hold|plateau/i.test(arise.reason || '') },
    'double-progression': doubleProgressionRec({ history, exerciseId, targetReps }),
    'linear-progression': linearProgressionRec({ history, exerciseId, targetReps }),
    flat: flatPrescriptionRec({ history, exerciseId, targetReps }),
  };
}

// ── Scoring (mirrors longitudinal.attachOutcome semantics) ──────────────

function scoreArm(armName, rec, actual, previousBest, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const gainPct = cfg.sessionQuality.pr.meaningfulGainPct;
  const repTarget = rec?.reps != null ? Number(rec.reps) : null;
  const loadTarget = rec?.load != null && Number(rec.load) > 0 ? Number(rec.load) : null;
  const assistTarget = rec?.assistKg != null ? Number(rec.assistKg) : null;
  const repsMet = repTarget == null || actual.best.reps >= repTarget;
  const loadMet = loadTarget == null || actual.best.weightKg >= loadTarget;
  const assistMet = assistTarget == null || actual.best.assistedKg <= assistTarget;
  const metTarget = repsMet && loadMet && assistMet;
  const actualE1 = round2(e1rm(actual.best.weightKg, actual.best.reps));
  const prevE1 = previousBest ? round2(e1rm(previousBest.weightKg, previousBest.reps)) : null;
  const changePct = prevE1 ? round4((actualE1 - prevE1) / prevE1) : null;
  const prescribedHold = armName === 'arise'
    ? Boolean(rec.held)
    : false; // baselines never declare a hold; their conservatism shows up as missed targets instead
  const classification =
    metTarget && !prescribedHold && (changePct == null || changePct > gainPct) ? 'progression-success'
      : prescribedHold && (changePct == null || Math.abs(changePct) < gainPct) ? 'stagnation'
        : changePct != null && changePct <= -0.05 && !prescribedHold ? 'regression'
          : metTarget ? 'target-met-hold' : 'target-missed';
  return {
    metTarget,
    changePct,
    classification,
    loadErrorKg: loadTarget != null && actual.best.weightKg > 0 ? round2(Math.abs(loadTarget - actual.best.weightKg)) : null,
    repError: repTarget != null ? Math.abs(repTarget - actual.best.reps) : null,
    // Conservatism: we said hold/stay and the lifter still progressed.
    unnecessaryConservatism: (prescribedHold || armName === 'flat') && changePct != null && changePct >= gainPct,
    noisyHold: armName === 'arise' && Array.isArray(rec.noisy) && rec.noisy.length > 0,
  };
}

function round2(v){ return Math.round(Number(v) * 100) / 100; }
function round4(v){ return Math.round(Number(v) * 10000) / 10000; }

function emptySummary(key){
  return {
    key,
    n: 0,
    conclusive: false,
    progressionSuccessRate: null,
    targetAchievementRate: null,
    stagnationRate: null,
    regressionRate: null,
    unnecessaryConservatismRate: null,
    meanLoadErrorKg: null,
    meanRepError: null,
    meanChangePct: null,
    noisyHolds: { n: 0, followedByProgress: 0 },
  };
}

function summariseArm(scores, key){
  const summary = emptySummary(key);
  summary.n = scores.length;
  if(!scores.length) return summary;
  const rate = p=> Math.round(scores.filter(p).length / scores.length * 1000) / 1000;
  const loads = scores.map(s=> s.loadErrorKg).filter(Number.isFinite);
  const repsErr = scores.map(s=> s.repError).filter(Number.isFinite);
  const changes = scores.map(s=> s.changePct).filter(v=> v != null);
  summary.progressionSuccessRate = rate(s=> s.classification === 'progression-success');
  summary.targetAchievementRate = rate(s=> s.metTarget);
  summary.stagnationRate = rate(s=> s.classification === 'stagnation');
  summary.regressionRate = rate(s=> s.classification === 'regression');
  summary.unnecessaryConservatismRate = rate(s=> s.unnecessaryConservatism);
  summary.meanLoadErrorKg = loads.length ? round2(loads.reduce((a, b)=> a + b, 0) / loads.length) : null;
  summary.meanRepError = Math.round(repsErr.reduce((a, b)=> a + b, 0) / Math.max(1, repsErr.length) * 100) / 100;
  summary.meanChangePct = changes.length ? round4(changes.reduce((a, b)=> a + b, 0) / changes.length) : null;
  const noisy = scores.filter(s=> s.noisyHold);
  summary.noisyHolds = {
    n: noisy.length,
    followedByProgress: noisy.filter(s=> s.changePct != null && s.changePct >= 0.02).length,
  };
  return summary;
}

// ── Retrospective comparative replay ────────────────────────────────────

// Replay every exercise's history point-in-time and score each arm against the
// real next-exposure outcome. Deterministic, offline, prior-only by design.
export function runComparativeStudy(history, { config = null, targetRepsFor = null, minimumSamples = null, readinessLog = [] } = {}){
  const readinessLogArg = readinessLog;
  const cfg = resolveArisePriors(config);
  const minSamples = Math.max(2, minimumSamples ?? cfg.longitudinal.minimumSegmentSamples);
  const minExposures = Math.max(2, cfg.progression.validation.minimumSessions);
  const ordered = [...(history || [])]
    .filter(s=> s?.dateISO)
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));

  const exerciseIds = new Set();
  for(const session of ordered) for(const b of session.blocks || []) if(b?.exerciseId) exerciseIds.add(b.exerciseId);

  const byExerciseRows = new Map(); // exerciseId -> arm -> scores[]
  const segmentRows = new Map();    // `${dimension}|${key}` -> arm -> scores[]
  const rows = []; // { exerciseId, dateISO, phase, arm, score }
  const readinessByDate = new Map((readinessLogArg || []).map(r => [r.dateISO, Number(r.score)]));
  const nearestReadiness = (asOfDateISO)=>{
    let best = null, bestDist = Infinity;
    for(const [dateISO, score] of readinessByDate){
      if(!Number.isFinite(score)) continue;
      const dist = Math.abs(Date.parse(`${dateISO}T00:00:00Z`) - Date.parse(`${asOfDateISO}T00:00:00Z`));
      if(dist <= 3 * 86400000 && dist < bestDist){ best = score; bestDist = dist; }
    }
    return best;
  };

  for(const exerciseId of [...exerciseIds].sort()){
    const exposures = exposuresFor(ordered, exerciseId);
    if(exposures.length < minExposures) continue;
    const targetReps = targetRepsFor ? targetRepsFor(exerciseId) : undefined;
    for(let i = 1; i < exposures.length; i++){
      const cutoffIndex = ordered.indexOf(exposures[i].session);
      if(cutoffIndex <= 0) continue;
      const prefix = ordered.slice(0, cutoffIndex); // strictly prior sessions only
      if(!prefix.some(s=> (s.blocks || []).some(b=> b.exerciseId === exerciseId))) continue;
      const previousBest = exposures[i - 1].best;
      const phase = trainingAgeInfo(prefix, { asOfDateISO: exposures[i].session.dateISO, config }).phase || 'unknown';
      const exMeta = EXERCISE_BY_ID[exerciseId] || {};
      const structure = (exMeta.tags || []).includes('compound') ? 'compound'
        : (exMeta.tags || []).includes('isolation') ? 'isolation' : 'unknown';
      const equipClass = equipmentClassFor(exerciseId);
      const strategyName = strategyForExercise(exerciseId, { config });
      const medianReps = [...exposures.slice(0, i + 1).map(e => e.best.reps)].sort((a,b)=>a-b)[Math.floor(i / 2)];
      const repRange = medianReps <= 5 ? 'low(≤5)' : medianReps <= 8 ? 'mid(6–8)' : 'high(≥9)';
      const gapDays = Math.round((Date.parse(`${exposures[i].session.dateISO}T00:00:00Z`) - Date.parse(`${exposures[i-1].session.dateISO}T00:00:00Z`)) / 86400000);
      const freqBucket = gapDays <= 2 ? '≤2d' : gapDays <= 3 ? '3d' : gapDays <= 6 ? '4–6d' : '≥7d';
      const rScore = nearestReadiness(exposures[i].session.dateISO);
      const readinessBucket = rScore == null ? 'unknown' : rScore >= cfg.recovery.readinessLowLatest ? 'high' : 'low';

      const attrs = { phase, structure, equipClass, strategyName, repRange, freqBucket, readinessBucket };
      const arms = computeArms({ exerciseId, history: prefix, targetReps, asOfDateISO: exposures[i].session.dateISO, config });
      for(const [name, rec] of Object.entries(arms)){
        if(!rec) continue;
        const score = scoreArm(name, rec, exposures[i], previousBest, { config });
        rows.push({ exerciseId, dateISO: exposures[i].session.dateISO, ...attrs, arm: name, score });
        if(!byExerciseRows.has(exerciseId)) byExerciseRows.set(exerciseId, {});
        if(!byExerciseRows.get(exerciseId)[name]) byExerciseRows.get(exerciseId)[name] = [];
        byExerciseRows.get(exerciseId)[name].push(score);
        for(const key of [attrs.phase, attrs.structure, attrs.equipClass, attrs.strategyName, attrs.repRange, attrs.freqBucket, attrs.readinessBucket]){
          const dimKey = `${key}`;
          if(!segmentRows.has(dimKey)) segmentRows.set(dimKey, {});
          if(!segmentRows.get(dimKey)[name]) segmentRows.get(dimKey)[name] = [];
          segmentRows.get(dimKey)[name].push(score);
        }
      }
    }
  }

  const overall = {};
  for(const name of STUDY_ARMS){
    const armRows = rows.filter(r=> r.arm === name);
    overall[name] = summariseArm(armRows.map(r=> r.score), name);
    overall[name].conclusive = armRows.length >= minSamples;
  }
  const byExerciseOutput = {};
  for(const [exerciseId, armMap] of byExerciseRows){
    byExerciseOutput[exerciseId] = {};
    for(const name of STUDY_ARMS){
      const seg = armMap[name] || [];
      byExerciseOutput[exerciseId][name] = summariseArm(seg, name);
      byExerciseOutput[exerciseId][name].conclusive = seg.length >= minSamples;
    }
  }

  // Experience-level segmentation: the same replay grouped by the training age
  // phase visible at each transition. "Does the engine's edge depend on being
  // a novice?" becomes answerable.
  const byExperienceLevel = {};
  for(const row of rows){
    if(!byExperienceLevel[row.phase]) byExperienceLevel[row.phase] = {};
    if(!byExperienceLevel[row.phase][row.arm]) byExperienceLevel[row.phase][row.arm] = [];
    byExperienceLevel[row.phase][row.arm].push(row.score);
  }
  for(const phase of Object.keys(byExperienceLevel)){
    for(const name of STUDY_ARMS){
      const seg = byExperienceLevel[phase][name] || [];
      byExperienceLevel[phase][name] = summariseArm(seg, name);
      byExperienceLevel[phase][name].conclusive = seg.length >= minSamples;
    }
  }

  const DIMENSIONS = [['byStructure','structure'],['byEquipmentClass','equipClass'],['byStrategy','strategyName'],['byRepRange','repRange'],['byFrequency','freqBucket'],['byReadiness','readinessBucket']];
  const segments = {};
  for(const [outName, attr] of DIMENSIONS){
    segments[outName] = {};
    for(const row of rows){
      const key = row[attr];
      if(!segments[outName][key]) segments[outName][key] = {};
      if(!segments[outName][key][row.arm]) segments[outName][key][row.arm] = [];
      segments[outName][key][row.arm].push(row.score);
    }
    for(const key of Object.keys(segments[outName])){
      for(const name of STUDY_ARMS){
        const seg = segments[outName][key][name] || [];
        segments[outName][key][name] = summariseArm(seg, name);
        segments[outName][key][name].conclusive = seg.length >= minSamples;
      }
    }
  }

  // Paired comparison vs arise: every baseline is scored on the SAME
  // transitions, so win/loss counts are paired, not independent — a far more
  // honest comparison than two rates with different denominators.
  const transitions = new Map();
  for(const row of rows){
    const key = `${row.exerciseId}|${row.dateISO}`;
    if(!transitions.has(key)) transitions.set(key, {});
    transitions.get(key)[row.arm] = row.score;
  }
  const pairedVsArise = {};
  for(const arm of STUDY_ARMS.filter(a=> a !== 'arise')){
    let pairs = 0, ariseOnly = 0, baseOnly = 0, bothMet = 0, neitherMet = 0;
    let deltaSum = 0, deltaCount = 0;
    for(const t of transitions.values()){
      const ariseScore = t.arise, baseScore = t[arm];
      if(!ariseScore || !baseScore) continue;
      pairs++;
      if(ariseScore.metTarget && !baseScore.metTarget) ariseOnly++;
      else if(!ariseScore.metTarget && baseScore.metTarget) baseOnly++;
      else if(ariseScore.metTarget && baseScore.metTarget) bothMet++;
      else neitherMet++;
      if(ariseScore.changePct != null && baseScore.changePct != null){
        deltaSum += ariseScore.changePct - baseScore.changePct;
        deltaCount++;
      }
    }
    pairedVsArise[arm] = {
      pairs,
      ariseWins: ariseOnly,
      baselineWins: baseOnly,
      bothMetTarget: bothMet,
      neitherMetTarget: neitherMet,
      meanChangePctAdvantage: deltaCount ? round4(deltaSum / deltaCount) : null,
    };
  }

  segments.byExperienceLevel = byExperienceLevel;

  return {
    generatedAtISO: new Date().toISOString(),
    priorsVersion: cfg.version,
    minimumSamples: minSamples,
    transitions: rows.length / STUDY_ARMS.length,
    overall,
    byExercise: byExerciseOutput,
    byExperienceLevel,
    segments,
    pairedVsArise,
    note: `Every arm receives the identical prior-only history at each transition and is scored against the same real outcome. Segments below ${minSamples} transitions are labelled inconclusive.`,
  };
}

// ── Prospective coverage ────────────────────────────────────────────────
// How close is the real evaluation ledger to answerable questions? Reports
// resolved pairs per exercise and per experience level with explicit deficits,
// so "collect hundreds of pairs" becomes a measurable target.
export function studyCoverage(ledger, { config = null } = {}){
  const cfg = resolveArisePriors(config).longitudinal;
  const min = Math.max(1, Number(cfg.minimumSegmentSamples) || 1);
  const records = (ledger || []).filter(r=> r && r.recommendation);
  const byExercise = new Map();
  const byPhase = new Map();
  for(const record of records){
    if(!record.outcome) continue;
    byExercise.set(record.exerciseId, (byExercise.get(record.exerciseId) || 0) + 1);
    const phase = record.basis?.trainingAgePhase || 'unknown';
    byPhase.set(phase, (byPhase.get(phase) || 0) + 1);
  }
  const segment = (map, dimension)=> [...map.entries()]
    .sort((a, b)=> a[0].localeCompare(b[0]))
    .map(([key, n])=> ({ dimension, key, n, conclusive: n >= min, deficit: Math.max(0, min - n) }));
  const exercises = segment(byExercise, 'exercise');
  const phases = segment(byPhase, 'experience');
  return {
    minimumSamples: min,
    totalResolved: [...byExercise.values()].reduce((a, b)=> a + b, 0),
    openRecords: records.filter(r=> !r.outcome).length,
    exercisesTracked: byExercise.size,
    byExercise: exercises,
    byExperienceLevel: phases,
    readySegments: [...exercises, ...phases].filter(s=> s.conclusive),
    gaps: [...exercises, ...phases].filter(s=> !s.conclusive).sort((a, b)=> b.deficit - a.deficit),
  };
}

// ── Coach comparator ────────────────────────────────────────────────────
// Optional arm: score human/coach prescriptions against the same outcomes.
// prescriptions: [{ dateISO, exerciseId, loadKg?, reps? }] — scored at the
// first exposure strictly after the prescription date.
export function scoreCoachPrescriptions(history, prescriptions, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const minExposures = Math.max(2, cfg.progression.validation.minimumSessions);
  const ordered = [...(history || [])]
    .filter(s=> s?.dateISO)
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  const rows = [];
  for(const rx of prescriptions || []){
    if(!rx?.exerciseId) continue;
    const exposures = exposuresFor(ordered, rx.exerciseId);
    if(exposures.length < minExposures) continue;
    const index = exposures.findIndex(e=> String(e.session.dateISO) > String(rx.dateISO || ''));
    if(index <= 0) continue; // need a prior exposure to measure change against
    const actual = exposures[index];
    const prefix = ordered.slice(0, Math.max(0, ordered.indexOf(actual.session)));
    if(!prefix.some(s=> (s.blocks || []).some(b=> b.exerciseId === rx.exerciseId))) continue;
    const previousBest = exposures[index - 1].best;
    const rec = { load: rx.loadKg ?? null, reps: rx.reps ?? null, assistKg: null };
    rows.push({ exerciseId: rx.exerciseId, dateISO: actual.session.dateISO, ...scoreArm('coach', rec, actual, previousBest, { config }) });
  }
  const summary = summariseArm(rows, 'coach');
  summary.conclusive = rows.length >= Math.max(1, Number(cfg.longitudinal.minimumSegmentSamples) || 1);
  return summary;
}

// ── Deload prospective validation ───────────────────────────────────────
// Deload decisions are captured prospectively as programme-adaptation events.
// This validates them: was volume actually cut the following week, and did
// performance/volume normalise afterwards?
function sessionVolumeKg(session){
  let vol = 0;
  for(const b of session.blocks || []) for(const s of b.sets || []) vol += (Number(s.reps) || 0) * (Number(s.weightKg) || 0);
  return vol;
}
function addDaysISO(dateISO, days){
  const d = new Date(`${dateISO}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Deload decisions are persisted on each schedule's adaptationHistory. Collect
// them across schedules so validateDeloadDecisions can audit them against what
// the lifter actually did next.
export function collectDeloadDecisions(schedules){
  const out = [];
  for(const schedule of schedules || []){
    for(const entry of schedule?.adaptationHistory || []){
      if(entry?.decision?.deload === true && entry?.dateISO){
        out.push({ dateISO: entry.dateISO, signals: entry.decision.deloadSignals || [] });
      }
    }
  }
  return out.sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
}

export function validateDeloadDecisions(decisions, history, { config = null } = {}){  const cfg = resolveArisePriors(config);
  const cutRatio = cfg.backtest.observedDeloadCutRatio;
  const ordered = [...(history || [])]
    .filter(s=> s?.dateISO)
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  const windowVolume = (fromIncl, toExcl)=>{
    let vol = 0;
    for(const s of ordered){
      const day = String(s.dateISO);
      if(day >= fromIncl && day < toExcl) vol += sessionVolumeKg(s);
    }
    return vol;
  };
  const rows = [];
  for(const decision of decisions || []){
    const base = decision?.dateISO || decision?.basisDateISO;
    if(!base || !/^\d{4}-\d{2}-\d{2}$/.test(base)) continue;
    const volBefore = windowVolume(addDaysISO(base, -7), base);
    const volDuring = windowVolume(base, addDaysISO(base, 7));
    const volAfter = windowVolume(addDaysISO(base, 7), addDaysISO(base, 14));
    const reboundRatio = volBefore > 0 && volAfter > 0 ? round4(volAfter / volBefore) : null;
    rows.push({
      dateISO: base,
      signals: decision.signals || [],
      volumeBeforeKg: Math.round(volBefore),
      volumeDuringKg: Math.round(volDuring),
      cutApplied: volBefore > 0 ? volDuring <= volBefore * cutRatio : false,
      volumeWeekAfterKg: Math.round(volAfter),
      reboundRatio,
    });
  }
  const pct = (part, whole)=> whole ? Math.round(part / whole * 1000) / 1000 : null;
  const rebounds = rows.filter(r=> r.reboundRatio != null);
  return {
    decisions: rows.length,
    cutsObservedRate: pct(rows.filter(r=> r.cutApplied).length, rows.length),
    normalisedWithinTwoWeeksRate: rebounds.length ? pct(rebounds.filter(r=> r.reboundRatio >= 0.8).length, rebounds.length) : null,
    rows,
  };
}
