// evaluation.js — pure aggregation of recommendation/outcome pairs.
//
// Split from longitudinal.js (ADR 0007): the recording half (consent,
// storage, engine snapshotting) stays there; this module only reads ledger
// rows and computes statistics — fully pure, trivially testable, and safe
// to run inside the analytics Web Worker.

import { resolveArisePriors } from './priors.js';
import { STUDY_VERSION } from './studyEnrollment.js';
import { STUDY_DESIGN } from './study.js';
import { EVALUATION_SCHEMA_VERSION, round, wilsonInterval } from './longitudinalCore.js';
import { isProspectiveRecord, realisedSuccess, confidenceBandOf, recommendationTypeOf, shrinkRate, classifyRecommendationOutcome, participantOf, ANONYMOUS_LOCAL_PARTICIPANT } from './longitudinalCore.js';

// ── Aggregation ─────────────────────────────────────────────────────────

// Shadow-evidence labelling: frozen shadow-arm analysis (byArm,
// pairedVsArise, prospectiveFieldComparison) is a SECONDARY diagnostic only —
// prescription difficulty and decision agreement. It must never be presented
// as causal effectiveness evidence: shadow prescriptions were never trained
// under, so "would have fit the workout" cannot become "produced better
// outcomes". Every shadow result carries causal:false plus this exact label
// for display surfaces.
export const SHADOW_EVIDENCE_LABEL = 'Counterfactual target comparison on the same realised workout — not a treatment-effect estimate.';

function emptySegment(key){
  return { key, n: 0, resolved: 0, conclusive: false, progressionSuccessRate: null, regressionRate: null, stagnationRate: null, adherenceRate: null, meanLoadErrorKg: null, meanRepError: null, failedSetRate: null, totalVolumeKg: 0 };
}

function summarise(records, minimumSamples){
  const segment = emptySegment('all');
  segment.n = records.length;
  const outcomes = records.filter(row=> row.outcome);
  segment.resolved = outcomes.length;
  let failed = 0, planned = 0;
  for(const row of outcomes){
    failed += row.outcome.failedSets || 0;
    planned += row.outcome.sets || 0;
    segment.totalVolumeKg += row.outcome.volumeKg || 0;
  }
  if(planned) segment.failedSetRate = round(failed / planned, 3);
  if(outcomes.length < minimumSamples) return segment;
  segment.conclusive = true;
  const rate = predicate=> round(outcomes.filter(predicate).length / outcomes.length, 3);
  segment.progressionSuccessRate = rate(row=> row.outcome.classification === 'progression-success');
  segment.regressionRate = rate(row=> row.outcome.classification === 'regression');
  segment.stagnationRate = rate(row=> row.outcome.classification === 'stagnation');
  segment.adherenceRate = rate(row=> row.outcome.metTarget);
  const loadErrors = outcomes.map(row=> row.outcome.loadErrorKg).filter(Number.isFinite);
  const repErrors = outcomes.map(row=> row.outcome.repError).filter(Number.isFinite);
  segment.meanLoadErrorKg = loadErrors.length ? round(loadErrors.reduce((a, b)=> a + b, 0) / loadErrors.length, 2) : null;
  segment.meanRepError = repErrors.length ? round(repErrors.reduce((a, b)=> a + b, 0) / repErrors.length, 2) : null;
  return segment;
}

function groupBy(records, keyFn){
  const groups = new Map();
  for(const record of records){
    const key = keyFn(record) || 'unknown';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()].sort(([a], [b])=> a.localeCompare(b));
}

// Aggregate the ledger. Reads only stored recommendation/outcome pairs — it
// never recomputes a recommendation, so later sessions cannot influence past
// evaluations.
export function evaluateLongitudinal(ledger, { config = null } = {}){
  const cfg = resolveArisePriors(config).longitudinal;
  const gainPct = resolveArisePriors(config).sessionQuality.pr.meaningfulGainPct;
  const minimum = Math.max(1, Number(cfg.minimumSegmentSamples) || 1);
  const records = (ledger || []).filter(row=> row && row.recommendation);
  const overall = summarise(records, minimum);
  const dimension = keyFn=> {
    const output = {};
    for(const [key, group] of groupBy(records, keyFn)){
      const summary = summarise(group, minimum);
      summary.key = key;
      // Subgroup slices are EXPLORATORY: with dozens of them, some will look
      // significant by chance. They inform hypothesis generation only.
      summary.exploratory = true;
      output[key] = summary;
    }
    return output;
  };

  const resolvedWithArms = records.filter(row=> row.outcome?.arms && row.outcome.arms.arise);
  const armNames = [...new Set(resolvedWithArms.flatMap(row=> Object.keys(row.outcome.arms)))].sort();

  // ── PRIMARY comparison: randomised assigned arms only ──────────────────
  // arise-assigned vs double-progression-assigned transitions, scored by
  // assignedMet (the prescription the product actually enforced). ITT: every
  // resolved assigned transition counts, compliant or not. Fail closed on
  // provenance: only live-engine recommendations resolved by live-engine
  // outcomes are first-party evidence — imported, replayed, seeded, missing
  // or ambiguous provenance is excluded and can never be promoted.
  const PRIMARY = ['arise', 'double-progression'];
  const primaryRows = resolvedWithArms.filter(row => PRIMARY.includes(row.assignedArm)
    && row.outcome.assignedMet != null
    && isProspectiveRecord(row));
  // Canonical identity: one person/store — never an exercise-derived key. A
  // lone anonymous local store therefore contributes at most ONE participant.
  const participantsInPrimary = new Set(primaryRows.map(participantOf));
  const armStatsFor = (arm)=>{
    const rows = primaryRows.filter(r => r.assignedArm === arm);
    const n = rows.length;
    const metCount = rows.filter(r => r.outcome.assignedMet).length;
    const stats = {
      key: arm, n, participants: new Set(rows.map(participantOf)).size,
      metCount,
      conclusive: false,
      targetAchievementRate: n ? round(metCount / n, 3) : null,
      confidenceInterval: n ? wilsonInterval(metCount, n) : null,
      stallRate: null, regressionRate: null, meanLoadErrorKg: null,
    };
    if(n >= minimum){
      stats.conclusive = true;
      let stalls = 0, regressions = 0; const errs = [];
      for(const row of rows){
        const rx = row.prescription || {};
        const prev = row.basis?.previousBest || null;
        const loadTarget = Number(rx.load) > 0 ? Number(rx.load) : null;
        const demandedMore = loadTarget != null && prev && loadTarget > Number(prev.weightKg || 0);
        if(row.outcome.changePct != null && row.outcome.changePct <= -0.05) regressions++;
        if(demandedMore && row.outcome.changePct != null && row.outcome.changePct <= 0) stalls++;
        if(Number.isFinite(row.outcome.loadErrorKg)) errs.push(row.outcome.loadErrorKg);
      }
      stats.stallRate = round(stalls / n, 3);
      stats.regressionRate = round(regressions / n, 3);
      stats.meanLoadErrorKg = errs.length ? round(errs.reduce((a,b)=> a+b, 0) / errs.length, 2) : null;
    }
    return stats;
  };
  const ariseStats = armStatsFor('arise');
  const dpStats = armStatsFor('double-progression');
  // Participant-clustered bootstrap on the difference of met rates between
  // assigned arms — the prespecified uncertainty analysis.
  const bootPairs = primaryRows.map(r => ({
    participant: participantOf(r),
    group: r.assignedArm,
    met: r.outcome.assignedMet === true,
  }));
  const clusteredDifference = clusteredBootstrapDifference(bootPairs, { seed: `primary-diff-v${STUDY_VERSION}` });
  // Conclusive-evidence hardening: an anonymous LOCAL store can contribute at
  // most ONE independent participant — canonical identity already collapses
  // it — so a requirement for multiple participants can never be satisfied by
  // exercise count, session count or any other store-internal multiplication.
  const independentParticipants = [...participantsInPrimary].filter(id => id !== ANONYMOUS_LOCAL_PARTICIPANT).length
    + (participantsInPrimary.has(ANONYMOUS_LOCAL_PARTICIPANT) ? 1 : 0);
  const primaryComparison = {
    designVersion: STUDY_DESIGN.designVersion,
    studyVersion: STUDY_VERSION,
    unitOfAssignment: STUDY_DESIGN.unitOfAssignment,
    participants: independentParticipants,
    transitions: primaryRows.length,
    conclusive: ariseStats.conclusive && dpStats.conclusive && independentParticipants >= 2,
    arise: ariseStats,
    'double-progression': dpStats,
    difference: {
      metRateDelta: (ariseStats.targetAchievementRate != null && dpStats.targetAchievementRate != null)
        ? round(ariseStats.targetAchievementRate - dpStats.targetAchievementRate, 3) : null,
      clusteredBootstrap: clusteredDifference,
    },
    adherence: {
      followedRate: primaryRows.length ? round(primaryRows.filter(r => r.outcome.followed === true).length / primaryRows.length, 3) : null,
      unknownAdherence: primaryRows.filter(r => r.outcome.followed == null).length,
      userOverrides: primaryRows.filter(r => r.outcome.userOverride).length,
    },
  };

  const policyKeyOf = row => row.policy ? `priors-v${row.policy.priorsVersion}/model-v${row.policy.modelVersion}` : 'unversioned';
  const byPolicyVersion = {};
  for(const [key, group] of groupBy(records, policyKeyOf)){
    const s = summarise(group, minimum);
    s.key = key;
    s.exploratory = false; // primary split, prespecified
    byPolicyVersion[key] = s;
  }
  const mixedPolicyVersions = Object.keys(byPolicyVersion);
  const byArm = {};
  for(const arm of armNames){
    const rows = resolvedWithArms.filter(row=> row.outcome.arms[arm]);
    const n = rows.length;
    const entry = { key: arm, n, conclusive: false, causal: false, evidenceLabel: SHADOW_EVIDENCE_LABEL, targetAchievementRate: null, progressionSuccessRate: null, stallRate: null, regressionRate: null, conservatismRate: null, meanLoadErrorKg: null };
    if(!n){ byArm[arm] = entry; continue; }
    entry.targetAchievementRate = round(rows.filter(r=> r.outcome.arms[arm].metTarget).length / n, 3);
    entry.progressionSuccessRate = round(rows.filter(r=> r.outcome.arms[arm].metTarget && (r.outcome.changePct == null || r.outcome.changePct > gainPct)).length / n, 3);
    byArm[arm] = entry;
  }
  // Stall/conservatism need each arm's prescribed demand vs previous best.
  for(const arm of armNames){
    const rows = resolvedWithArms.filter(row=> row.outcome.arms[arm]);
    let stalls = 0, regressions = 0, conservativeWins = 0, overshoots = 0, loadErrs = [];
    for(const row of rows){
      const { demandedMore, aggressive } = findFrozenArm(row, arm);
      const changePct = row.outcome.changePct;
      const met = row.outcome.arms[arm].metTarget;
      if(changePct != null && changePct <= -0.05) regressions++;
      if(demandedMore && changePct != null && changePct <= 0) stalls++;
      if(aggressive && !met) overshoots++;
      if(!demandedMore && changePct != null && changePct >= gainPct) conservativeWins++;
      if(Number.isFinite(row.outcome.arms[arm].loadErrorKg)) loadErrs.push(row.outcome.arms[arm].loadErrorKg);
    }
    const n = rows.length;
    if(n >= minimum && n){
      byArm[arm].conclusive = true;
      byArm[arm].shadow = true;
      byArm[arm].stallRate = round(stalls / n, 3);
      byArm[arm].regressionRate = round(regressions / n, 3);
      byArm[arm].conservatismRate = round(conservativeWins / n, 3);
      byArm[arm].meanLoadErrorKg = loadErrs.length ? round(loadErrs.reduce((a,b)=> a+b, 0) / loadErrs.length, 2) : null;
      byArm[arm].confidenceInterval = wilsonInterval(rows.filter(r=> r.outcome.arms[arm].metTarget).length, n);
      byArm[arm].aggressiveOvershootRate = round(overshoots / Math.max(1, rows.filter(r=> findFrozenArm(r, arm).aggressive).length), 3);
    } else {
      byArm[arm].shadow = true;
    }
  }

  // Paired arise-vs-baseline on identical transitions (stronger than two
  // independent rates): win = arise's target met while the baseline's missed.
  const pairedVsArise = {};
  for(const arm of armNames){
    if(arm === 'arise') continue;
    let pairs=0, ariseWin=0, armWin=0, both=0, neither=0;
    for(const row of resolvedWithArms){
      const a = row.outcome.arms.arise.metTarget, b = row.outcome.arms[arm]?.metTarget;
      if(b == null) continue;
      pairs++;
      if(a && !b) ariseWin++;
      else if(!a && b) armWin++;
      else if(a && b) both++;
      else neither++;
    }
    pairedVsArise[arm] = {
      pairs, ariseWins: ariseWin, armWins: armWin, bothMetTarget: both, neitherMetTarget: neither,
      ariseWinRate: pairs >= minimum ? round(ariseWin / pairs, 3) : null,
      confidenceInterval: pairs >= minimum ? wilsonInterval(ariseWin, pairs) : null,
      conclusive: pairs >= minimum,
      shadow: true,
      causal: false,
      evidenceLabel: SHADOW_EVIDENCE_LABEL,
    };
  }

  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    minimumSegmentSamples: minimum,
    totalRecords: records.length,
    openRecords: records.filter(row=> !row.outcome).length,
    overall,
    byArm,
    pairedVsArise,
    primaryComparison,
    byPolicyVersion,
    mixedPolicyVersions,
    byTrainingAge: dimension(row=> row.basis?.trainingAgePhase),
    byExercise: dimension(row=> row.exerciseId),
    byMovementPattern: dimension(row=> row.movementPattern),
    byEquipmentClass: dimension(row=> row.equipmentClass),
    byProgramme: dimension(row=> row.programId ? `${row.programId}@v${row.programVersion == null ? '?' : row.programVersion}` : null),
    note: records.length
      ? `Segments with fewer than ${minimum} resolved recommendation→outcome pairs withhold their rates (conclusive:false). All arms were frozen at record time from the same prior-only history. byArm/pairedVsArise are SHADOW decision-agreement analyses; causal comparison lives in primaryComparison (assigned arms, ITT). Evaluation data is stored separately from training history and never calibrates recommendations from future sessions.${mixedPolicyVersions.length > 1 ? ` WARNING: ${mixedPolicyVersions.length} engine versions present (${mixedPolicyVersions.join(' vs ')}) — analyse each separately; never merge treatments across versions.` : ''}`
      : 'No consented recommendation→outcome pairs recorded yet.',
  };
}

// Participant-clustered bootstrap: DIFFERENCE of met rates between the two
// assigned arms (arise − double-progression), resampling participants.
// Works for both designs honestly:
//   within-person (participant has both arms)  → paired per-person difference;
//   between-person (each person in ONE arm)    → resampled participant
//     contributes to its arm's rate; the iteration difference is
//     mean(arise resample) − mean(dp resample), still participant-clustered.
export function clusteredBootstrapDifference(pairs, { seed = 'primary-diff-v1', iterations = 500 } = {}){
  if(!Array.isArray(pairs) || !pairs.length) return null;
  const acc = new Map(); // participant -> { arise:{n,met}, dp:{n,met} }
  for(const p of pairs){
    const code = participantOf(p);
    if(!acc.has(code)) acc.set(code, { arise: { n:0, met:0 }, dp: { n:0, met:0 } });
    const e = acc.get(code);
    const bucket = p.group === 'double-progression' ? e.dp : e.arise;
    bucket.n++;
    if(p.met) bucket.met++;
  }
  const participants = [...acc.keys()];
  if(participants.length < 2) return { participants: participants.length, mean: null, low: null, high: null, conclusive: false };
  let h = hashSeedStr(seed);
  const rng = ()=> {
    h = (h + 0x6D2B79F5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rate = (e)=> e.n ? e.met / e.n : null;
  // Per-iteration clustered difference: resample participants WITH
  // replacement; a resampled participant contributes their arm rate to that
  // arm only (between-person) or both (within-person crossover).
  const diffs = [];
  let pairedMode = false;
  for(const e of acc.values()){ if(e.arise.n && e.dp.n){ pairedMode = true; break; } }
  for(let i = 0; i < iterations; i++){
    const seenIds = participants.map(()=> Math.floor(rng() * participants.length));
    const armRates = { arise: [], dp: [] };
    for(const idx of seenIds){
      const e = acc.get(participants[idx]);
      const a = rate(e.arise), d = rate(e.dp);
      if(a != null) armRates.arise.push(a);
      if(d != null) armRates.dp.push(d);
    }
    if(armRates.arise.length && armRates.dp.length){
      const mean = (arr)=> arr.reduce((s, v)=> s + v, 0) / arr.length;
      diffs.push(mean(armRates.arise) - mean(armRates.dp));
    }
  }
  diffs.sort((a,b)=> a-b);
  const overallArise = rate(aggregate(acc, 'arise'));
  const overallDp = rate(aggregate(acc, 'dp'));
  return {
    participants: participants.length,
    ariseMetRate: overallArise,
    doubleProgressionMetRate: overallDp,
    design: pairedMode ? 'within-person' : 'between-person',
    mean: round(diffs.reduce((a,b)=> a+b, 0) / Math.max(1, diffs.length), 3),
    low: round(diffs[Math.floor(diffs.length * 0.025)] ?? NaN, 3),
    high: round(diffs[Math.min(diffs.length - 1, Math.ceil(diffs.length * 0.975))] ?? NaN, 3),
    iterations,
    conclusive: participants.length >= 2 && diffs.length > 0,
  };
}
function aggregate(acc, kind){
  let n=0, met=0;
  for(const e of acc.values()){ n += e[kind].n; met += e[kind].met; }
  return { n, met };
}

// Participant-clustered bootstrap for the PRIMARY prospective comparison.
// Transitions within one participant are not independent; uncertainty comes
// from resampling PARTICIPANTS (their whole per-participant win rate),
// deterministically, so results are reproducible. Returns null below 2
// participants — a single lifter cannot yield a clustered interval.
export function clusteredBootstrapWinRate(pairs, { seed = 'arise-clustered-v1', iterations = 500 } = {}){
  if(!Array.isArray(pairs) || !pairs.length) return null;
  const byP = new Map();
  for(const p of pairs){
    const code = participantOf(p);
    if(!byP.has(code)) byP.set(code, { wins: 0, n: 0 });
    const e = byP.get(code);
    e.n++;
    if(p.ariseMet && p.armMet === false) e.wins++;
  }
  const participants = [...byP.keys()];
  const perParticipant = participants.map(c => ({ code: c, rate: byP.get(c).n ? byP.get(c).wins / byP.get(c).n : 0 }));
  if(participants.length < 2) return { participants: participants.length, mean: round(perParticipant[0]?.rate ?? 0, 3), low: null, high: null, conclusive: false };
  let h = hashSeedStr(seed);
  const rng = ()=> {
    h = (h + 0x6D2B79F5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const means = [];
  for(let i = 0; i < iterations; i++){
    let sum = 0;
    for(let j = 0; j < perParticipant.length; j++) sum += perParticipant[Math.floor(rng() * perParticipant.length)].rate;
    means.push(sum / perParticipant.length);
  }
  means.sort((a,b)=> a-b);
  return {
    participants: participants.length,
    mean: round(perParticipant.reduce((a,p)=> a+p.rate, 0) / participants.length, 3),
    low: round(means[Math.floor(iterations * 0.025)], 3),
    high: round(means[Math.min(iterations - 1, Math.ceil(iterations * 0.975))], 3),
    iterations,
    conclusive: true,
  };
}
function hashSeedStr(str){
  let h = 2166136261;
  for(const ch of String(str)){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Recover an arm's frozen prescription + two behavioural flags:
//   demandedMore — prescribed above previous best (a progression attempt)
//   aggressive   — demanded MORE than +10% over previous best load; a policy
//                  must not earn credit merely by prescribing heavier.
function findFrozenArm(row, arm){
  const frozen = row.arms?.[arm] || null;
  const prev = row.basis?.previousBest || null;
  let demandedMore = false;
  let aggressive = false;
  if(frozen && prev){
    const loadTarget = Number(frozen.load) > 0 ? Number(frozen.load) : null;
    const repTarget = frozen.reps != null ? Number(frozen.reps) : null;
    if(loadTarget != null && loadTarget > Number(prev.weightKg || 0)){
      demandedMore = true;
      aggressive = loadTarget > Number(prev.weightKg || 0) * 1.1;
    }else if(loadTarget == null && repTarget != null && repTarget > Number(prev.reps || 0)) demandedMore = true;
  }else if(frozen && !prev){
    demandedMore = Number(frozen.load) > 0;
  }
  return { frozen, demandedMore, aggressive };
}

// Baselines compared against the arise prescription on identical gradeable
// transitions. 'flat' is the hold/repeat baseline (the hold/default
// comparator); 'fixed-rules' is the fixed decision-list baseline. Arms absent
// from the data are skipped, never fabricated.
export const FIELD_BASELINES = [
  { id: 'double-progression', label: 'double progression' },
  { id: 'flat', label: 'hold' },
  { id: 'fixed-rules', label: 'fixed rules' },
];

// Stable identity of one realised transition for de-duplication: same user,
// same exercise, same shown prescription, same outcome session. Exported so
// pooled rollups fold the same repeats the same way. Pure and deterministic.
export function prospectiveTransitionKey(row){
  const t = row?.recommendation;
  let target;
  if(t && typeof t === 'object'){
    try{ target = JSON.stringify(t, Object.keys(t).sort()); }catch{ target = String(t); }
  } else target = String(t ?? '');
  return [participantOf(row), row?.exerciseId ?? '', target, row?.outcome?.sessionId ?? row?.outcome?.dateISO ?? ''].join('::');
}

// Gradeable-outcome predicate shared by every prospective rollup: a stored
// `outcome.gradeable` flag wins; legacy rows without the flag are re-derived
// with the same conservative rule the recorder applies (followed, no
// pain/technique/override, and a label that is not insufficient-evidence).
export function isGradeableOutcome(row, thresholds){
  const o = row?.outcome;
  if(!o) return false;
  if(o.gradeable != null) return o.gradeable === true;
  if(o.pain === true || o.techniqueWarning === true || o.userOverride === true) return false;
  if(o.followed !== true) return false;
  const cls = classifyRecommendationOutcome(row, thresholds);
  return cls.attempted && cls.label !== 'insufficient-evidence';
}

// ── Prospective recommendation calibration ───────────────────────────────
// "Did the recommendation actually work?" Answered only from genuine
// first-visible (live-engine) prospective records that have since resolved.
// A reconstructed/replayed/imported recommendation is NEVER treated as
// prospective evidence here. Rates are shrunk toward a safe default and
// withheld below the sample gate, so a lone session can never look learned.
export function calibrateRecommendations(ledger, { config = null } = {}){
  const priors = resolveArisePriors(config);
  const cal = priors.calibration;
  const thresholds = priors.longitudinal.outcomeLabels;
  const prospective = (ledger || []).filter(row=> row && row.recommendation && isProspectiveRecord(row));
  const resolvedRows = prospective.filter(row=> row.outcome);
  const minimum = Math.max(1, Number(cal.minSamplesToTrust) || 1);

  const isGradeable = (row)=> isGradeableOutcome(row, thresholds);

  const gradeSegment = (rows, key)=>{
    const resolved = rows.filter(row=> row.outcome);
    // Rates, sample gates and calibration error use GRADEABLE outcomes only —
    // a resolved-but-not-attempted pair must never move the denominator.
    const gradeableRows = resolved.filter(isGradeable);
    let successful = 0, tooAggressive = 0, tooConservative = 0, neutral = 0;
    let errSum = 0, errN = 0;
    for(const row of gradeableRows){
      const cls = classifyRecommendationOutcome(row, thresholds);
      if(cls.label === 'successful') successful++;
      else if(cls.label === 'too-aggressive') tooAggressive++;
      else if(cls.label === 'too-conservative') tooConservative++;
      else neutral++;
      const exp = cal.bandExpected[confidenceBandOf(row)] ?? cal.defaultSuccessRate;
      const realised = realisedSuccess(row);
      if(realised != null){ errSum += Math.abs(exp - realised); errN++; }
    }
    const n = gradeableRows.length;
    // Shrink the success rate toward the safe default; a tiny n stays near prior.
    const shrink = shrinkRate({ successes: successful, samples: n, prior: cal.defaultSuccessRate, pseudoCount: cal.pseudoCount });
    const conclusive = n >= minimum;
    return {
      key,
      records: rows.length,
      resolved: resolved.length,
      gradeable: n,
      excluded: resolved.length - n,
      conclusive,
      successful, tooAggressive, tooConservative, neutral,
      // Raw rates are withheld below the sample gate; the shrunk estimate is
      // always safe to show because it is already pulled toward the default.
      successRate: conclusive && n ? round(successful / n, 3) : null,
      overPrescriptionRate: conclusive && n ? round(tooAggressive / n, 3) : null,
      underPrescriptionRate: conclusive && n ? round(tooConservative / n, 3) : null,
      shrunkSuccessRate: shrink.shrunk,
      evidenceWeight: shrink.weight,
      calibrationError: errN ? round(errSum / errN, 3) : null,
      sampleSize: n,
    };
  };
  const dimension = (label, keyFn)=>{
    const out = {};
    for(const [groupKey, rows] of groupBy(prospective, keyFn)){
      const seg = gradeSegment(rows, groupKey);
      out[groupKey] = seg;
    }
    return out;
  };

  const overall = gradeSegment(prospective, 'all');
  const policyKey = row => row.audit?.policy || (row.policy ? `priors-v${row.policy.priorsVersion}` : 'unknown');
  const experienceKey = row => row.basis?.trainingAgePhase || 'unknown';

  // Confidence quality: how well the stated band matched what actually
  // happened, summarised from the overall calibration error. Withheld below the
  // sample gate so a thin slice never reads as "well-calibrated".
  const confidenceQuality = (!overall.conclusive || overall.calibrationError == null) ? 'unknown'
    : overall.calibrationError <= 0.15 ? 'well-calibrated'
    : overall.calibrationError <= 0.3 ? 'roughly-calibrated'
    : 'miscalibrated';

  // Which way the engine leans, only once there is enough evidence to say so.
  let tendency = 'learning';
  if(overall.conclusive){
    if((overall.overPrescriptionRate ?? 0) >= cal.overRateCutoff) tendency = 'over-prescribing';
    else if((overall.underPrescriptionRate ?? 0) >= cal.underRateCutoff) tendency = 'too-conservative';
    else tendency = 'balanced';
  }

  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    minimumSamples: minimum,
    prospective: prospective.length,
    resolved: resolvedRows.length,
    gradeable: overall.gradeable,
    open: prospective.length - resolvedRows.length,
    excludedReconstructed: (ledger || []).filter(row=> row && row.recommendation && !isProspectiveRecord(row)).length,
    overall,
    byConfidenceBand: dimension('band', row=> confidenceBandOf(row)),
    byExercise: dimension('exercise', row=> row.exerciseId),
    byCategory: dimension('category', row=> row.movementPattern),
    byPolicy: dimension('policy', policyKey),
    byExperience: dimension('experience', experienceKey),
    byType: dimension('type', recommendationTypeOf),
    confidenceQuality,
    tendency,
    note: overall.gradeable >= minimum
      ? `Calibrated on ${overall.gradeable} GRADEABLE prospective recommendation→outcome pairs (out of ${resolvedRows.length} resolved; unfollowed, overridden, and pain/technique sessions are excluded from every rate). Reconstructed or imported recommendations are excluded (${(ledger||[]).filter(r=>r&&r.recommendation&&!isProspectiveRecord(r)).length}). Sparse segments are shrunk toward a ${Math.round(cal.defaultSuccessRate*100)}% default and withheld below ${minimum} gradeable pairs.`
      : `Need ${Math.max(0, minimum - overall.gradeable)} more prospective GRADEABLE pairs before any rate is trustworthy (${overall.gradeable} gradeable of ${resolvedRows.length} resolved so far — unfollowed, overridden and pain/technique sessions never count). Reconstructed recommendations are not prospective evidence.`,
  };
}

// ── Prospective field comparison ─────────────────────────────────────────
// "Does Arise improve subsequent training outcomes?" — answered ONLY from
// genuine first-visible (live-engine) prospective records whose outcome is
// gradeable, comparing the arise prescription against each baseline's FROZEN
// arm prescription on the IDENTICAL realised transition. Workouts are not
// independent observations, so effects are computed per user and aggregated
// as a mean of user effects (never a naive pooled rate); uncertainty is the
// observed user band plus a Wilson interval on the pooled wins. Maturity is
// 'insufficient' or 'early' — this function never declares a firm cross-arm
// claim; that requires pooled multi-user replication (see fieldStudy.js).
// Pure and deterministic: same rows in, same result out.
export function prospectiveFieldComparison(rows, { config = null } = {}){
  const priors = resolveArisePriors(config);
  const cal = priors.calibration;
  const thresholds = priors.longitudinal.outcomeLabels;
  const gainPct = resolveArisePriors(config).sessionQuality.pr.meaningfulGainPct;
  const minPairs = Math.max(1, Number(cal.minSamplesToTrust) || 1);
  const minUsers = 2;

  const list = Array.isArray(rows) ? rows : [];
  const prospective = list.filter(row=> row && row.recommendation && isProspectiveRecord(row));
  const resolvedRows = prospective.filter(row=> row.outcome);
  const gradeableRows = resolvedRows.filter(row=> isGradeableOutcome(row, thresholds));

  // Identical re-recordings of the same realised transition (same user, same
  // exercise, same shown prescription, same outcome session) score ONCE —
  // repeats collapse here so neither the sample gates nor the paired wins can
  // be inflated by recording frequency. Genuinely different weeks have
  // different outcome sessions and still count separately. The folded count is
  // reported honestly as duplicatePairs, never silently dropped.
  const userOf = participantOf;
  const seenTransitions = new Set();
  const gradeable = [];
  const foldedDuplicates = [];
  for(const row of gradeableRows){
    const k = prospectiveTransitionKey(row);
    if(seenTransitions.has(k)){ foldedDuplicates.push(row); continue; }
    seenTransitions.add(k);
    gradeable.push(row);
  }
  const users = [...new Set(gradeable.map(userOf))].sort();
  const exercises = [...new Set(gradeable.map(row=> row.exerciseId).filter(Boolean))].sort();

  // Exclusion accounting: every non-counted row lands in exactly one bucket.
  const excluded = { nonProspective: 0, unresolved: 0, nonGradeable: { unfollowed: 0, override: 0, flagged: 0, other: 0 } };
  for(const row of list){
    if(!(row && row.recommendation) || !isProspectiveRecord(row)){ excluded.nonProspective++; continue; }
    if(!row.outcome){ excluded.unresolved++; continue; }
    if(isGradeableOutcome(row, thresholds)) continue;
    const o = row.outcome;
    if(o.pain === true || o.techniqueWarning === true) excluded.nonGradeable.flagged++;
    else if(o.userOverride === true || row.userOverride === true) excluded.nonGradeable.override++;
    else if(o.followed !== true) excluded.nonGradeable.unfollowed++;
    else excluded.nonGradeable.other++;
  }

  // Baselines actually present in the gradeable data — absent arms are
  // skipped, never fabricated.
  const presentArms = new Set();
  for(const row of gradeable) for(const arm of Object.keys(row.outcome?.arms || {})) presentArms.add(arm);
  const baselines = FIELD_BASELINES.filter(b=> presentArms.has(b.id));

  const byBaseline = {};
  for(const { id, label } of baselines){
    let pairs = 0, ariseWins = 0, armWins = 0, both = 0, neither = 0, ariseMet = 0, baseMet = 0;
    const perUser = new Map();
    for(const row of gradeable){
      const a = row.outcome.arms?.arise?.metTarget;
      const b = row.outcome.arms?.[id]?.metTarget;
      if(a == null || b == null) continue;
      pairs++;
      const u = userOf(row);
      if(!perUser.has(u)) perUser.set(u, { pairs: 0, ariseWins: 0, armWins: 0 });
      const e = perUser.get(u);
      e.pairs++;
      if(a) ariseMet++;
      if(b) baseMet++;
      if(a && !b){ ariseWins++; e.ariseWins++; }
      else if(!a && b){ armWins++; e.armWins++; }
      else if(a && b) both++;
      else neither++;
    }
    const usersArr = [...perUser.entries()]
      .map(([user, e])=> ({ user, pairs: e.pairs, ariseWins: e.ariseWins, armWins: e.armWins, effect: e.pairs ? round((e.ariseWins - e.armWins) / e.pairs, 3) : 0 }))
      .sort((x, y)=> x.user.localeCompare(y.user));
    const effectMean = usersArr.length ? round(usersArr.reduce((s, u)=> s + u.effect, 0) / usersArr.length, 3) : null;
    const effectBand = usersArr.length ? [Math.min(...usersArr.map(u=> u.effect)), Math.max(...usersArr.map(u=> u.effect))] : [null, null];
    byBaseline[id] = {
      label, pairs, users: usersArr.length,
      ariseWins, armWins, bothMetTarget: both, neitherMetTarget: neither,
      ariseRate: pairs ? round(ariseMet / pairs, 3) : null,
      baseRate: pairs ? round(baseMet / pairs, 3) : null,
      effectPp: effectMean != null ? round(effectMean * 100, 1) : null,
      effectMean, effectBand,
      winsInterval: wilsonInterval(ariseWins, pairs),
      perUser: usersArr,
      // Folded re-recordings that carried this arm's data — scored zero times.
      duplicatePairs: foldedDuplicates.filter(r=> r.outcome?.arms?.arise?.metTarget != null && r.outcome?.arms?.[id]?.metTarget != null).length,
    };
  }

  // Realised context over the SAME gradeable rows (properties of what actually
  // happened — identical for every arm, so reported once, never per arm).
  let failedSets = 0, plannedSets = 0, changeSum = 0, changeN = 0, gained = 0;
  let over = 0, under = 0, adhered = 0;
  for(const row of gradeable){
    failedSets += row.outcome.failedSets || 0;
    plannedSets += row.outcome.sets || 0;
    if(Number.isFinite(row.outcome.changePct)){ changeSum += row.outcome.changePct; changeN++; if(row.outcome.changePct >= gainPct) gained++; }
    const cls = classifyRecommendationOutcome(row, thresholds);
    if(cls.label === 'too-aggressive') over++;
    else if(cls.label === 'too-conservative') under++;
    if(row.outcome.followed === true) adhered++;
  }
  const realised = {
    failedSetRate: plannedSets ? round(failedSets / plannedSets, 3) : null,
    meanChangePct: changeN ? round(changeSum / changeN, 4) : null,
    meaningfulGainShare: changeN ? round(gained / changeN, 3) : null,
    overPrescriptionShare: gradeable.length ? round(over / gradeable.length, 3) : null,
    underPrescriptionShare: gradeable.length ? round(under / gradeable.length, 3) : null,
    adherenceRate: gradeable.length ? round(adhered / gradeable.length, 3) : null,
  };

  const reasons = [];
  if(users.length < minUsers) reasons.push(`only ${users.length} user${users.length === 1 ? '' : 's'} (need ${minUsers}+ for a user-aware read)`);
  if(gradeable.length < minPairs) reasons.push(`only ${gradeable.length} gradeable pairs (need ${minPairs}+)`);
  if(!baselines.length) reasons.push('no baseline prescriptions frozen alongside the arise targets');
  const maturity = reasons.length ? 'insufficient' : 'early';

  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    prospective: prospective.length,
    resolved: resolvedRows.length,
    gradeable: gradeable.length,
    open: prospective.length - resolvedRows.length,
    excluded,
    duplicatePairs: foldedDuplicates.length,
    // Shadow diagnostic, never causal: prescription difficulty and decision
    // agreement on identical transitions — not a treatment-effect estimate.
    causal: false,
    evidenceKind: 'shadow-decision-agreement',
    evidenceLabel: SHADOW_EVIDENCE_LABEL,
    users: users.length,
    userList: users,
    exercises,
    byBaseline,
    realised,
    sampleSufficiency: { users: users.length, gradeablePairs: gradeable.length, minUsers, minPairs, sufficient: maturity !== 'insufficient', reasons },
    maturity,
    note: maturity === 'insufficient'
      ? `Prospective gradeable evidence is insufficient (${reasons.join('; ')}). No comparison is claimed; retrospective replays and reconstructed recommendations are never presented as prospective proof.`
      : `Descriptive only, from ${gradeable.length} gradeable prospective transitions across ${users.length} users: paired arise-vs-baseline wins on identical transitions, aggregated as a mean of per-user effects. Firm cross-arm claims require pooled multi-user replication.`,
  };
}
