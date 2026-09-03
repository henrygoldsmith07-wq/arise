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

// ── Aggregation ─────────────────────────────────────────────────────────

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
  // resolved assigned transition counts, compliant or not.
  const PRIMARY = ['arise', 'double-progression'];
  const primaryRows = resolvedWithArms.filter(row => PRIMARY.includes(row.assignedArm) && row.outcome.assignedMet != null);
  const participantsInPrimary = new Set(primaryRows.map(r => r.participantId || r.exerciseId + '::anonymous'));
  const armStatsFor = (arm)=>{
    const rows = primaryRows.filter(r => r.assignedArm === arm);
    const n = rows.length;
    const metCount = rows.filter(r => r.outcome.assignedMet).length;
    const stats = {
      key: arm, n, participants: new Set(rows.map(r => r.participantId || 'anonymous')).size,
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
    participant: r.participantId || 'anonymous',
    group: r.assignedArm,
    met: r.outcome.assignedMet === true,
  }));
  const clusteredDifference = clusteredBootstrapDifference(bootPairs, { seed: `primary-diff-v${STUDY_VERSION}` });
  const primaryComparison = {
    designVersion: STUDY_DESIGN.designVersion,
    studyVersion: STUDY_VERSION,
    unitOfAssignment: STUDY_DESIGN.unitOfAssignment,
    participants: participantsInPrimary.size,
    transitions: primaryRows.length,
    conclusive: ariseStats.conclusive && dpStats.conclusive && participantsInPrimary.size >= 2,
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
    const entry = { key: arm, n, conclusive: false, targetAchievementRate: null, progressionSuccessRate: null, stallRate: null, regressionRate: null, conservatismRate: null, meanLoadErrorKg: null };
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
export function clusteredBootstrapDifference(pairs, { seed = 'primary-diff-v1', iterations = 500 } = {}){
  if(!Array.isArray(pairs) || !pairs.length) return null;
  const acc = new Map(); // participant -> { arise:{n,met}, dp:{n,met} }
  for(const p of pairs){
    const code = p?.participant ?? 'anonymous';
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
  const diffs = [];
  for(let i = 0; i < iterations; i++){
    let sum = 0, count = 0;
    for(let j = 0; j < participants.length; j++){
      const e = acc.get(participants[Math.floor(rng() * participants.length)]);
      const a = rate(e.arise), d = rate(e.dp);
      if(a != null && d != null){ sum += a - d; count++; }
    }
    if(count) diffs.push(sum / count);
  }
  diffs.sort((a,b)=> a-b);
  const overallArise = rate(aggregate(acc, 'arise'));
  const overallDp = rate(aggregate(acc, 'dp'));
  return {
    participants: participants.length,
    ariseMetRate: overallArise,
    doubleProgressionMetRate: overallDp,
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
    const code = p?.participant ?? 'single';
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
