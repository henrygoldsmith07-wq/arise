// progression.js — deterministic progression engine.
// Pure: takes only the history visible to the caller plus explicit priors and
// returns next-load advice, plateau/deload signals, and explanations. Offline,
// no AI.

import { DEFAULT_ARISE_PRIORS, resolveArisePriors, clamp } from './priors.js';
import { nearestLoadToPlates, nearestAchievableLoad } from './plates.js';
import { EXERCISE_BY_ID } from './data.js';
import { trainingAgeInfo, trainingBreakInfo, shortBreakInfo } from './progressionTrainingAge.js';
import { e1rm, epleyToLoad, parseReps } from './trainingMath.js';

export * from './progressionTrainingAge.js';
// The Epley pair and rep parsing live in trainingMath.js so every module reads
// the same formula; these re-exports keep the engine's public surface (and its
// tests) unchanged. Callers should prefer importing from trainingMath directly.
export { e1rm, epleyToLoad, parseReps };

// These aliases are kept for existing consumers. The values now come from the
// explicit, versioned priors object rather than a decision-local constant.
export const PROGRESSION_STRATEGY = DEFAULT_ARISE_PRIORS.progression.strategies;

export function strategyForExercise(exerciseId, { config = null } = {}){
  const cfg = resolveArisePriors(config).progression;
  if(!exerciseId) return 'hypertrophy';
  if(cfg.strategyByExercise[exerciseId]) return cfg.strategyByExercise[exerciseId];
  // fallback by name/muscle heuristic — keep deterministic
  if(new RegExp(cfg.fallback.strengthPattern).test(exerciseId) && !new RegExp(cfg.fallback.strengthExcludePattern).test(exerciseId)) return 'strength';
  return 'hypertrophy';
}

// Personalised progression rate: learned weekly rep/load deltas per exercise.
// Returns { weeklyLoadPct, weeklyRepGain, n, spanDays } or null if insufficient data.
export function personalisedRate(history, exerciseId, { config = null, asOfDateISO = null } = {}){
  const cfg = resolveArisePriors(config).progression.personalisedRate;
  // Per-session best e1RM: judging progress off individual sets lets one
  // drop-set or a varying set count fake a trend. Prior-only: the cut applies
  // here too, so a learned rate can never be fitted on future sessions.
  const logs = sessionBestSummaries(history, exerciseId, asOfDateISO);
  if(logs.length < cfg.minSessions) return null;
  const pts = logs.map(l=> ({ t: Date.parse(l.dateISO || '2026-01-01'), y: e1rm(l.weightKg||0,l.reps)||l.reps }));
  pts.sort((a,b)=> a.t - b.t);
  const spanDays = Math.max(1, (pts[pts.length-1].t - pts[0].t)/86400000);
  if(spanDays < cfg.minSpanDays) return null;
  const k = Math.max(1, Math.ceil(pts.length/cfg.trimParts));
  const first = pts.slice(0,k).reduce((a,b)=> a+b.y,0)/k;
  const last = pts.slice(-k).reduce((a,b)=> a+b.y,0)/k;
  const weeks = spanDays/7;
  const weeklyLoadPct = clamp((last/Math.max(1,first) - 1)/weeks, cfg.weeklyLoadPctMin, cfg.weeklyLoadPctMax);
  const weeklyRepGain = (last - first)/weeks;
  return { weeklyLoadPct: Math.round(weeklyLoadPct*1000)/1000, weeklyRepGain: Math.round(weeklyRepGain*10)/10, n: logs.length, spanDays: Math.round(spanDays) };
}

// Training-age and break policy lives in progressionTrainingAge.js.

// Longitudinal validation: how well would recommendNext have predicted the next logged set?
// Returns { n, meanAbsErrorKg, meanAbsErrorReps, hitRate }
export function validateProgression(history, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const ordered = orderedHistory(history);
  const byEx = new Map();
  for(let orderIndex = 0; orderIndex < ordered.length; orderIndex++){
    const h = ordered[orderIndex];
    for(const b of h.blocks||[]) {
      if(!byEx.has(b.exerciseId)) byEx.set(b.exerciseId, []);
      // flatten to session-level best e1RM per exercise
      const sets = b.sets||[];
      const best = sets.map(s=> ({ w:Number(s.weightKg)||0, r:Number(String(s.reps).match(/\d+/)?.[0]||s.reps)||0 })).filter(x=> x.w>0||x.r>0);
      if(best.length) byEx.get(b.exerciseId).push({ dateISO:h.dateISO, sets: best, orderIndex });
    }
  }
  let errsKg=[], errsReps=[], hits=0, total=0;
  for(const [exId, sessions] of byEx){
    if(sessions.length < cfg.progression.validation.minimumSessions) continue;
    for(let i=1;i<sessions.length;i++){
      const historySlice = ordered.slice(0, sessions[i].orderIndex);
      // need at least 1 prior session for this exercise
      if(!historySlice.some(h=> (h.blocks||[]).some(b=> b.exerciseId===exId))) continue;
      const rec = recommendNext({ exerciseId: exId, history: historySlice, asOfDateISO: sessions[i].dateISO, config: cfg });
      // Score against the session's best set, not its first: the recommendation
      // describes what to achieve next exposure, and first-set ordering (warm-up
      // effects) is noise, not prediction error.
      const actualBest = sessions[i].sets
        .map(s=> ({ ...s, e1rm: e1rm(s.w, s.r) || s.r }))
        .sort((a,b)=> b.e1rm - a.e1rm)[0];
      if(!actualBest) continue;
      const actual = actualBest;
      if(rec.load!=null && actual.w) errsKg.push(Math.abs((rec.load||actual.w) - actual.w));
      if(rec.reps!=null && actual.r) errsReps.push(Math.abs(rec.reps - actual.r));
      total++;
      // hit if within 1 rep or 5% load. A bodyweight/null-load recommendation
      // only counts as a hit when the logged set was actually unweighted —
      // crediting it against weighted work inflates the hit rate.
      const loadOk = rec.load>0
        ? Math.abs((rec.load||actual.w)-actual.w)/Math.max(1,actual.w) < cfg.progression.validation.loadTolerancePct
        : !(actual.w > 0);
      const repOk = Math.abs((rec.reps||actual.r)-actual.r) <= cfg.progression.validation.repTolerance;
      if(loadOk && repOk) hits++;
    }
  }
  const mean = arr=> arr.length? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  return {
    n: total,
    meanAbsErrorKg: mean(errsKg)!=null? Math.round(mean(errsKg)*10)/10 : null,
    meanAbsErrorReps: mean(errsReps)!=null? Math.round(mean(errsReps)*10)/10 : null,
    hitRate: total? Math.round(hits/total*100)/100 : null,
    leakageSafe: true,
    priorsVersion: cfg.version,
  };
}

// The reference set a NEXT prescription is built from: the best working set of
// the most recent session, e1RM-selected by sessionBestSummaries. That is the
// same exposure the plateau checks, the learned rate and the progression model
// read, so all four now agree on "what my last session proved I can do".
//
// Falls back to the last set-level log only when no session has a usable set
// (e.g. history rows that carry reps but no matching blocks), so a degenerate
// history still produces a prescription rather than a hard stop.
function lastWorkingSet(history, exerciseId, asOfDateISO){
  const best = sessionBestSummaries(history, exerciseId, asOfDateISO);
  if(best.length) return best[best.length - 1];
  const logs = logsFor(history, exerciseId, asOfDateISO);
  return logs.length ? logs[logs.length - 1] : null;
}

// Recommend next load/reps from last N sessions for an exercise.
// Conservative double-progression: first add reps, then add load.
// Now strategy-aware + personalised + plateau-aware.
export function recommendNext({ exerciseId, history, targetReps = null, conservative = true, strategy, config = null, asOfDateISO = null, calibration = null, plateConfig = null }){
  const cfg = resolveArisePriors(config);
  targetReps = targetReps || cfg.progression.defaultTargetReps;
  // PRIOR-ONLY INVARIANT: with asOfDateISO set, every decision input is sliced
  // to sessions on or before that date. The engine never sees the future.
  //
  // PRESCRIPTION REFERENCE SET — session-level, not set-level.
  // This used to read `logsFor(...)[last]`, i.e. the LAST SET of the last
  // session: a 4-set squat that ends in a backoff set, or a final set that
  // failed, would set tomorrow's load from that smaller/failed exposure. Every
  // other input in this function already reads SESSION-LEVEL best sets — the
  // plateau v2 check below states it outright ("set-level logs mistake two sets
  // of one workout for two exposures"), as do the learned rate and the
  // progression model. Align the prescription with them.
  const last = lastWorkingSet(history, exerciseId, asOfDateISO);
  if(!last) {
    const strat = strategy || strategyForExercise(exerciseId, { config: cfg });
    return { load: null, reps: parseLow(targetReps, cfg), reason: "No history — use program prescription.", strategy: strat, trainingAge: trainingAgeInfo(history, { asOfDateISO, config: cfg }), priorsVersion: cfg.version };
  }
  const reps = last.reps, load = last.weightKg || 0;
  const [lo, hi] = parseRange(targetReps);
  const strat = strategy || strategyForExercise(exerciseId, { config: cfg });
  const sCfg = cfg.progression.strategies[strat] || cfg.progression.strategies.hypertrophy;
  const prate = personalisedRate(history, exerciseId, { config: cfg, asOfDateISO });
  const trainingAge = trainingAgeInfo(history, { asOfDateISO, config: cfg });
  const trainingBreak = trainingBreakInfo(history, { asOfDateISO, config: cfg });
  if(trainingBreak.hasBreak){
    const returnLoad = load > 0 ? snapLoad(load * cfg.progression.trainingAge.returnLoadMultiplier, cfg) : null;
    return plateAware({
      load: returnLoad,
      reps: lo,
      reason: `After a ${trainingBreak.daysSinceLast}-day break, restart at ${lo} reps and ${returnLoad != null ? `${returnLoad}kg` : 'a conservative bodyweight target'} before rebuilding.`,
      trainingBreak,
      strategy: strat,
      personalised: prate,
      trainingAge,
      priorsVersion: cfg.version,
    }, plateConfig, exerciseId);
  }
  // Evidence-gated short-break easing: inert unless the progression model
  // opened cfg.progression.shortBreakPolicy after proving that multi-day gaps
  // don't actually hurt performance and that arise is over-conservative.
  if(cfg.progression.shortBreakPolicy?.enabled && load > 0){
    const sb = shortBreakInfo(history, exerciseId, { asOfDateISO, config: cfg });
    if(sb.hasShortBreak){
      const returnLoad = snapLoad(load * sb.multiplier, cfg);
      const underPct = Math.round((1 - sb.multiplier) * 100);
      return plateAware({
        load: returnLoad,
        reps: lo,
        reason: `${sb.daysSince} days since this lift's last session — ease back to ${returnLoad}kg (~${underPct}% under last time) for one clean exposure, then rebuild.`,
        shortBreak: sb,
        strategy: strat,
        personalised: prate,
        trainingAge,
        priorsVersion: cfg.version,
      }, plateConfig, exerciseId);
    }
  }
  // Plateau v2 check (real vs noise) — if true, hold. Fed session-level best
  // sets: set-level logs mistake two sets of one workout for two exposures.
  const sessions = sessionBestSummaries(history, exerciseId, asOfDateISO).slice(-cfg.progression.historyWindow);
  const plat = isPlateauV2(sessions, { config: cfg });
  if(plat.isPlateau) return plateAware({ load, reps, reason: plat.reason, plateau: plat, strategy: strat, personalised: prate, trainingAge, priorsVersion: cfg.version }, plateConfig, exerciseId);
  // also keep original 3-session plateau as conservative fallback
  if(!plat.isPlateau && isPlateau(sessions, { config: cfg })) return plateAware({ load, reps, reason: "Plateau — hold load, consider deload.", plateau: plat, strategy: strat, personalised: prate, trainingAge, priorsVersion: cfg.version }, plateConfig, exerciseId);
  // Noisy session conservatism: a flagged last session (short, painful, missed
  // sets, unusual drop, kit/order change) holds the prescription. Holding is
  // deliberately the mildest response — heavier changes (deload, programme
  // rewrite) still require multiple independent signals elsewhere.
  const noisy = noisyFlagsForLastSession(history, exerciseId, cfg, asOfDateISO);
  if(noisy.length >= 2 || noisy.includes('unusualPerformance') || noisy.includes('pain')){
    return plateAware({ load, reps, reason: `Hold load because last session had noisy context (${noisy.join(', ')}) — need a clean exposure before progressing.`, noisy, strategy: strat, personalised: prate, trainingAge, priorsVersion: cfg.version }, plateConfig, exerciseId);
  }

  // Assisted progression (e.g. pull-up with band/assist): add reps first, then REDUCE assist.
  const assist = last.assistedKg != null && last.assistedKg !== '' ? Number(last.assistedKg) : null;
  if(assist != null && assist > 0){
    if(reps < hi) return { load: null, reps: reps + 1, assistKg: assist, reason: `Assisted — add a rep (${reps}→${reps+1}) before cutting assist.`, strategy: strat, personalised: prate, trainingAge, priorsVersion: cfg.version };
    const nextAssist = Math.max(0, snapLoad(assist - cfg.progression.assistedStepKg, cfg));
    return { load: null, reps: lo, assistKg: nextAssist, reason: nextAssist===0 ? `Top of ${lo}–${hi} at ${assist}kg assist — drop the assist, you're ready.` : `Top of ${lo}–${hi} — reduce assist ${assist}→${nextAssist}kg.`, strategy: strat, personalised: prate, trainingAge, priorsVersion: cfg.version };
  }
  if(load === 0 && isBodyweight(exerciseId, cfg)){
    if(reps < hi) return { load: null, reps: reps + 1, reason: `Bodyweight: add a rep (${reps}→${reps+1}).`, strategy: strat, personalised: prate, trainingAge, priorsVersion: cfg.version };
    // Top of range: name the exercise's own harder variant instead of a generic hint.
    const bwLadder = bodyweightVariantLadder(exerciseId, cfg, history);
    if(bwLadder.next){
      const ladderMeta = bwLadder.ladder
        ? { variantLadder: { from: exerciseId, to: bwLadder.next.id, ...bwLadder.ladder } }
        : {};
      return { load: null, reps: lo, variant: bwLadder.next.id, ...ladderMeta, reason: bwLadder.reason, strategy: strat, personalised: prate, suggestWeighted: true, trainingAge, priorsVersion: cfg.version };
    }
    return { load: null, reps, reason: "Top of range — try harder variant (decline/weighted/tempo).", strategy: strat, personalised: prate, suggestWeighted: true, trainingAge, priorsVersion: cfg.version };
  }
  const rpe = last.rpe != null && String(last.rpe).trim()!=='' ? Number(last.rpe) : null;
  const rir = rpe !== null && Number.isFinite(rpe) ? Math.max(0, 10 - rpe) : null;
  // Missing RPE must not mean "assume room to spare" (old default RIR 2).
  // Unknown effort stays unknown: below the top of the range, hold at the same
  // prescription instead of adding a rep on an assumed RIR. Failed / skipped
  // sets already returned above. Reaching the TOP of the range is itself
  // evidence (the top-of-range load step below never read RPE), so a lifter
  // who never logs RPE still progresses by double progression — otherwise
  // they would be held at the same load forever.
  if(rir === null && reps < hi){
    return plateAware({ load, reps, reason: `No effort (RPE) logged last time, so Arise can't tell how close you were — repeat ${reps} reps at this load, or log RPE to let it progress.`, effortUnknown: true, strategy: strat, personalised: prate, trainingAge, priorsVersion: cfg.version }, plateConfig, exerciseId);
  }
  const effortRir = rir;
  // Personalised rate when learned; otherwise strategy base rate scaled by training age.
  const empiricalRate = calibration?.progressionRatePct;
  const incPct = empiricalRate != null && Number.isFinite(Number(empiricalRate))
    ? clamp(Number(empiricalRate), cfg.progression.personalisedRate.appliedLoadPctMin, cfg.progression.personalisedRate.appliedLoadPctMax)
    : prate
      ? clamp(prate.weeklyLoadPct || sCfg.incPct, cfg.progression.personalisedRate.appliedLoadPctMin, cfg.progression.personalisedRate.appliedLoadPctMax)
      : clamp(sCfg.incPct * trainingAge.multiplier, cfg.progression.coldLoadPctFloor, cfg.progression.personalisedRate.appliedLoadPctMax);

  // Strategy-aware
  if(sCfg.prefer === 'reps'){
    if(reps < hi) return plateAware({ load, reps: Math.min(hi, reps+1), reason: `Endurance — add a rep (${reps}→${Math.min(hi, reps+1)}).`, strategy: strat, personalised: prate, trainingAge, priorsVersion: cfg.version }, plateConfig, exerciseId);
  }
  // Double progression (default for hypertrophy, and fallback)
  // Unknown RPE below the top returns above, so effortRir is explicit here;
  // at the top, unknown RPE takes the conservative load step only.
  if(reps < hi) {
    if(effortRir >= 2) return plateAware({ load, reps: Math.min(hi, reps + 1), reason: `Room at RPE ${rpe ?? "/"} — add a rep (${reps}→${Math.min(hi, reps+1)}).`, strategy: strat, personalised: prate, trainingAge }, plateConfig, exerciseId);
    const nextLoad = bumpLoad(load, load * (1 + incPct), cfg, trainingAge);
    return plateAware({ load: nextLoad, reps: lo, reason: `Close to failure (RIR ~${effortRir}) — increase ${load} → ${nextLoad} kg and reset to ${lo} reps.`, strategy: strat, personalised: prate, trainingAge }, plateConfig, exerciseId);
  }
  const nextLoad = load > 0 ? bumpLoad(load, load * ((conservative || rir === null) ? (1 + incPct) : (1 + incPct*cfg.progression.nonConservativeMultiplier)), cfg, trainingAge) : 0;
  return plateAware({ load: nextLoad || load, reps: lo, reason: `You hit the top of ${lo}–${hi} at ${load > 0 ? `${load} kg` : `${reps} reps`} — increase ${load > 0 ? `${load} → ${nextLoad} kg` : `the difficulty`} and reset to ${lo} reps.`, strategy: strat, personalised: prate, trainingAge }, plateConfig, exerciseId);
}

// Set progression: add a set only after 2 consecutive sessions at the top of the rep
// range with room at the end (RIR ≥2). Conservative cap so volume never balloons.
export function recommendSets(history, exerciseId, { targetReps = '8–12', maxSets = null, config = null } = {}){
  const cfg = resolveArisePriors(config).progression.sets;
  const cap = maxSets == null ? cfg.defaultMaxSets : maxSets;
  const exposures = sessionSetSummaries(history, exerciseId).slice(-cfg.historyWindow);
  const current = exposures[exposures.length - 1]?.sets || lastSessionSetCount(history, exerciseId, cfg.defaultSets);
  if(!exposures.length) return { sets: cfg.defaultSets, reason: `No history — start with ${cfg.defaultSets} sets.`, add: false };
  const [lo, hi] = parseRange(targetReps, cfg);
  if(exposures.length < cfg.minimumSessions) return { sets: current, reason: 'Log another session before judging set count.', add: false };
  const recent = exposures.slice(-cfg.topSessionsRequired);
  const atTop = recent.every(l=> l.reps >= hi);
  // Missing RPE is unknown effort, not room: every recent session must carry
  // an explicit RPE at or below the cap before a set is added.
  const room = recent.every(l=> l.rpe != null && String(l.rpe).trim()!=='' && Number.isFinite(Number(l.rpe)) && Number(l.rpe) <= cfg.roomRpeMax);
  if(atTop && room && current < cap) return { sets: current + 1, reason: `Two sessions at top of ${lo}–${hi} with reps in tank — add a set (${current}→${current+1}).`, add: true };
  if(atTop) return { sets: current, reason: current >= cap ? `At ${cap} sets — cap reached; progress load or reps instead.` : 'At top of rep range but RPE was high — hold sets, add load first.', add: false };
  return { sets: current, reason: `Not at the top of ${lo}–${hi} yet — keep building reps before adding sets.`, add: false };
}

// ROM progression: depth ladders for squat/hinge/push families. Nudge deeper only when
// reps have been at the top of the range for 2 sessions at the current depth.
function romLadderFor(exerciseId, config = null){
  const cfg = resolveArisePriors(config).progression.rom;
  if(new RegExp(cfg.squatPattern).test(exerciseId||'')) return cfg.ladders.squat;
  if(new RegExp(cfg.hingePattern).test(exerciseId||'')) return cfg.ladders.hinge;
  if(new RegExp(cfg.pushPattern).test(exerciseId||'')) return cfg.ladders.push;
  return null;
}
export function romProgression(history, exerciseId, { targetReps = '8–12', config = null } = {}){
  const cfg = resolveArisePriors(config).progression.rom;
  const ladder = romLadderFor(exerciseId, config);
  if(!ladder) return { supported: false, next: null, reason: 'No ROM ladder defined for this exercise — progress load/reps instead.' };
  const logs = logsFor(history, exerciseId).slice(-cfg.historyWindow);
  const withRom = logs.filter(l=> l.rom != null && String(l.rom).trim()!=='');
  if(!withRom.length) return { supported: true, next: null, reason: 'Log depth (partial / parallel / full) to get ROM advice.' };
  const [lo, hi] = parseRange(targetReps);
  const cur = String(withRom[withRom.length-1].rom).toLowerCase();
  const idx = ladder.indexOf(cur);
  if(idx === -1) return { supported: true, next: null, reason: `Unrecognised depth "${withRom[withRom.length-1].rom}" — use ${ladder.join(' / ')}.` };
  if(idx === ladder.length - 1) return { supported: true, next: null, reason: 'Already at full ROM — progress load or reps instead.' };
  if(logs.length < cfg.topSessionsRequired || !logs.slice(-cfg.topSessionsRequired).every(l=> l.reps >= hi)) return { supported: true, next: null, reason: `Hit ${lo}–${hi} reps at ${cur} depth first, then aim deeper.` };
  const next = ladder[idx+1];
  return { supported: true, next, reason: `Reps at top of ${lo}–${hi} at ${cur} depth — aim for ${next} next session.` };
}

// Plateau: last 3 sessions no meaningful e1RM gain (<1%) and >=3 sessions (kept for backwards compat)
export function isPlateau(logs, { config = null } = {}){
  const cfg = resolveArisePriors(config).progression.plateau;
  if(!logs || logs.length < cfg.legacyMinSessions) return false;
  const last3 = logs.slice(-cfg.legacyMinSessions).map(l=> e1rm(l.weightKg||0,l.reps)|| l.reps);
  const best = Math.max(...last3.slice(0,-1).map(v=>v));
  const last = last3[last3.length-1];
  return (last - best)/Math.max(1,best) < cfg.legacyGainPct;
}

// Plateau v2: distinguishes real plateau from poor sessions/noise.
// Requires >=4 sessions, flat best-gain + flat trend, and not explained by high RPE variance or single bad session.
export function isPlateauV2(logs, { config = null } = {}){
  const cfg = resolveArisePriors(config).progression.plateau;
  if(!logs || logs.length < cfg.minSessions) return { isPlateau: false, reason: logs?.length < cfg.minSessions ? `Need ${cfg.minSessions}+ sessions to judge plateau.` : '', gain: 0, trend: strengthTrend(logs||[], { config }) };
  const vals = logs.slice(-cfg.minSessions).map(l=> e1rm(l.weightKg||0,l.reps)|| l.reps);
  const bestRecent = Math.max(...vals.slice(-cfg.recentHalfWindow));
  const bestPrior = Math.max(...vals.slice(0,cfg.recentHalfWindow));
  const gain = (bestRecent - bestPrior)/Math.max(1,bestPrior);
  const trend = strengthTrend(logs.slice(-cfg.trendWindow), { config });
  const rpes = logs.slice(-cfg.minSessions).map(l=> Number(l.rpe)).filter(n=> Number.isFinite(n));
  const highVariance = rpes.length>=cfg.rpeMinObservations ? (Math.max(...rpes)-Math.min(...rpes) >= cfg.rpeSpread) : false;
  const minVal = Math.min(...vals), maxVal = Math.max(...vals);
  const singleBad = vals.length>=3 ? (minVal < maxVal*cfg.badSessionDropPct && vals[vals.length-1] > maxVal*cfg.recoveryReboundPct) : false;
  // need both flat gain and flat/negative trend to call plateau
  if(gain < cfg.gainPct && Math.abs(trend) < cfg.trendAbsMax){
    if(highVariance || singleBad) return { isPlateau: false, reason: 'Flat on average but sessions are noisy — not a real plateau yet.', gain: Math.round(gain*1000)/1000, trend: Math.round(trend*100)/100, noisy: true };
    return { isPlateau: true, reason: `${cfg.minSessions} sessions with <${cfg.gainPct*100}% gain and flat trend — real plateau.`, gain: Math.round(gain*1000)/1000, trend: Math.round(trend*100)/100 };
  }
  return { isPlateau: false, reason: 'Still progressing.', gain: Math.round(gain*1000)/1000, trend: Math.round(trend*100)/100 };
}

// Deload decisions live in deloadReadinessAssessment (programming.js) — the
// single implementation, validated by backtesting.deloadOutcomes.

// Strength trend (linear slope over e1RM series)
export function strengthTrend(logs, { config = null } = {}){
  const minimum = resolveArisePriors(config).progression.trend.minimumObservations;
  if(!logs || logs.length < minimum) return 0;
  const ys = logs.map(l=> e1rm(l.weightKg||0, l.reps) || l.reps);
  const n = ys.length; const xs = ys.map((_,i)=>i);
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0; for(let i=0;i<n;i++){ num += (xs[i]-mx)*(ys[i]-my); den += (xs[i]-mx)**2; }
  return den ? num/den : 0;
}
export function strengthTrendWithConfidence(logs, { config = null } = {}){
  const cfg = resolveArisePriors(config).progression.trend;
  if(!logs || logs.length < cfg.minimumObservations) return { slope: 0, r2: 0, confidence: 'low', n: logs?.length||0 };
  const ys = logs.map(l=> e1rm(l.weightKg||0,l.reps)||l.reps);
  const slope = strengthTrend(logs, { config });
  const mean = ys.reduce((a,b)=>a+b,0)/ys.length;
  const ssTot = ys.reduce((a,y)=> a + (y-mean)**2, 0);
  if(ssTot===0) return { slope: Math.round(slope*100)/100, r2: 1, confidence: 'high', n: logs.length };
  const xs = ys.map((_,i)=>i);
  const mx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const b = slope;
  const yhat = xs.map(x=> mean + b*(x - mx));
  const ssRes = ys.reduce((a,y,i)=> a + (y - yhat[i])**2, 0);
  const r2 = Math.max(0, 1 - ssRes/ssTot);
  const confidence = r2 > cfg.highR2 ? 'high' : r2 > cfg.mediumR2 ? 'medium' : 'low';
  return { slope: Math.round(slope*100)/100, r2: Math.round(r2*100)/100, confidence, n: logs.length };
}

// Meaningful PR vs noise: require >2% above prior best and not a one-rep jitter
// opts.techniqueChange — if true, PR is invalid (ROM/technique change)
export function isMeaningfulPR(priorBestE1rm, newE1rm, opts={}){
  const cfg = resolveArisePriors(opts.config).sessionQuality.pr;
  if(opts && opts.techniqueChange) return false;
  return newE1rm >= priorBestE1rm * (1 + cfg.meaningfulGainPct) && newE1rm >= priorBestE1rm + cfg.minimumAbsoluteKg;
}
export function classifyPR({ priorBestE1rm, newE1rm, note, priorNote, config = null }){
  const text = `${note||''} ${priorNote||''}`.toLowerCase();
  const techniqueChange = /rom|depth|range|technique|form|paused|tempo|assisted|band|partial/.test(text);
  const meaningful = isMeaningfulPR(priorBestE1rm, newE1rm, { techniqueChange, config });
  return { meaningful, techniqueChange, reason: techniqueChange ? 'Technique/ROM change — not a like-for-like PR.' : meaningful ? 'Genuine overload.' : 'Within noise (<2%).' };
}

// RIR from RPE; single source of truth
// NOTE — this is NOT the same function as sessionRunnerModel.rirFromRpe, and
// must not be consolidated with it. This is the ENGINE layer: callers do
// numeric comparisons on the result (`rir < 2` in progressionPolicies) and use
// null as their "no RPE logged" sentinel. The runner layer returns a rounded
// STRING because it fills a text field. Same input, two contracts, one per
// layer — see sessionRunnerModel.js for that half.
export function rirFromRpe(rpe){ if(rpe==null || rpe==="") return null; const n=Number(rpe); if(!Number.isFinite(n)) return null; return Math.max(0, Math.min(10, 10 - n)); }
export function proximityLabel(rir){
  if(rir==null) return "";
  if(rir===0) return "Failure";
  if(rir<=1) return "~1 in tank";
  if(rir<=2) return "~2 in tank";
  if(rir<=3) return "~3 in tank";
  return "Easy";
}

// Recovery/readiness: 3 light signals (sleep, soreness, motivation) → readiness 0..100
export function readinessScore({ sleep=3, soreness=3, motivation=3, config = null }={}){
  const cfg = resolveArisePriors(config).sessionQuality.readiness;
  const range = Math.max(1, cfg.scaleMax - cfg.scaleMin);
  const s = ((Number(sleep)-cfg.scaleMin)/range), so=((cfg.scaleMax-Number(soreness))/range), m=((Number(motivation)-cfg.scaleMin)/range);
  return Math.round(Math.max(0, Math.min(100, (s*cfg.sleepWeight + so*cfg.sorenessWeight + m*cfg.motivationWeight)*100)));
}
export function readinessEMA(scores, { config = null } = {}){
  const cfg = resolveArisePriors(config).recovery;
  if(!scores || !scores.length) return { value: 50, confidence: 'low' };
  if(scores.length === 1) return { value: scores[0], confidence: 'low' };
  let ema = scores[0];
  const alpha = cfg.readinessEmaAlpha;
  for(let i=1;i<scores.length;i++) ema = alpha*scores[i] + (1-alpha)*ema;
  const v = Math.round(ema);
  const slice = scores.slice(-cfg.readinessHistoryWindow);
  const spread = Math.max(...slice) - Math.min(...slice);
  const confidence = spread > cfg.readinessSpreadLow ? 'low' : spread > cfg.readinessSpreadMedium ? 'medium' : 'high';
  const last = scores[scores.length-1];
  if(Math.abs(last - v) > cfg.readinessDampThreshold && confidence==='high' && scores.length>=cfg.readinessMinimumForDamping){
    const damped = Math.round(ema*cfg.readinessDampWeight + last*(1-cfg.readinessDampWeight));
    return { value: damped, confidence: 'medium', dampened: true, raw: last };
  }
  return { value: v, confidence };
}
// Unilateral helpers: per-side tracking
export function isUnilateralExercise(exerciseId){ return /lunge|split|single|bulgarian|pistol|unilateral/i.test(exerciseId||''); }
export function sideImbalance(sets){
  const l = sets.filter(s=> s.side==='L').reduce((a,s)=> a + (Number(s.reps)||0),0);
  const r = sets.filter(s=> s.side==='R').reduce((a,s)=> a + (Number(s.reps)||0),0);
  if(!l && !r) return null;
  const total = l+r || 1;
  const weaker = l<r ? 'L' : l>r ? 'R' : null;
  return { left: l, right: r, imbalancePct: Math.round(Math.abs(l-r)/total*100), weaker };
}

// Learn, conservatively, whether this exercise's own prospective prescriptions
// have been hitting, overshooting, or undershooting — purely from the user's
// logged history (which carries the frozen first-visible `block.prescription`
// snapshots). This NEVER reads the separate evaluation ledger: the training
// engine may consume training history, and nothing else. Sparse or noisy
// evidence keeps the default stance; a single session can never flip it.
export function personalCalibrationFromHistory(history, { exerciseId = null, config = null, asOfDateISO = null } = {}){
  const cfg = resolveArisePriors(config);
  const cal = cfg.calibration;
  const regCut = cfg.longitudinal.outcomeLabels.regressionCutPct;
  const gainPct = cfg.longitudinal.outcomeLabels.meaningfulGainPct;
  const easyRpe = cfg.longitudinal.outcomeLabels.easyRpeThreshold;
  const aggro = cfg.longitudinal.outcomeLabels.aggressiveLoadPct;
  if(!exerciseId) return { active: false, jumpMultiplier: 1, samples: 0 };
  const TECH = /rom|depth|form|technique|paused|tempo|partial|shallow|assisted|band/i;
  const sessions = (history || [])
    .filter(h=> h?.dateISO && (!asOfDateISO || String(h.dateISO) <= String(asOfDateISO)))
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  let previousBest = null;
  let samples = 0, over = 0, under = 0, success = 0;
  for(const session of sessions){
    for(const block of session.blocks || []){
      if(block.exerciseId !== exerciseId) continue;
      const rx = block.prescription;
      if(!rx || typeof rx !== 'object') continue;
      const sets = block.sets || [];
      // The SHOWN prescription only governs its own slots — user-added rows
      // stay user data and can neither confirm nor refute the engine's target.
      const governedSets = sets.filter(s=> s && s.origin !== 'user-added');
      // Not attempted at all → grade nothing (never blame, never learn).
      if(!governedSets.some(s=> s && (s.completed || s.failed || Number(String(s.reps).match(/\d+/)?.[0] || s.reps) > 0))) continue;
      // Pain or a technique change makes this exposure unfit to calibrate on.
      if(session.painDiscomfort || (session.noteTags||[]).includes('pain-discomfort')
        || sets.some(s=> s && s.pain) || sets.some(s=> s && s.rom && TECH.test(String(s.rom)))) continue;
      let best = null;
      for(const s of governedSets){
        const reps = Number(String(s.reps).match(/\d+/)?.[0] || s.reps) || 0;
        const weightKg = Number(s.weightKg) || 0;
        const assistedKg = Number(s.assistedKg) || 0;
        if(!reps && !weightKg) continue;
        const val = e1rm(weightKg, reps) || reps;
        if(!best || val > best.val) best = { reps, weightKg, assistedKg, rpe: s.rpe, val, failed: !!s.failed };
      }
      if(!best) continue;
      const repsTarget = rx.prescribedReps != null ? Number(rx.prescribedReps)
        : (String(rx.prescribedRepRange || '').match(/\d+/)?.map(Number)?.[0] ?? null);
      const loadTarget = rx.prescribedLoadKg != null && Number(rx.prescribedLoadKg) > 0 ? Number(rx.prescribedLoadKg) : null;
      const assistTarget = rx.prescribedAssistKg != null ? Number(rx.prescribedAssistKg) : null;
      // §4: never learn from an exposure the user explicitly overrode, or where
      // adherence cannot be established at all (no frozen target). A missed
      // target is NOT an override — it is the primary "too aggressive" signal
      // and must still be graded, so it is never dropped here.
      const establishedTargets = repsTarget != null || loadTarget != null || assistTarget != null;
      if(!establishedTargets || rx.userOverride === true || block.prescriptionOverridden === true) continue;
      // Attempt adherence ≠ achievement (same rule as the ledger): the exposure
      // only teaches the engine when the SHOWN setup was genuinely tried — a
      // non-skipped set at the prescribed load (and assistance) with real reps
      // logged. Skipped rows are never attempts; rows with no flags at all
      // (legacy imports) are judged on their values. A deliberate back-off is
      // an override: skip it without moving the sample count or any rate, so
      // it can be neither blamed nor learned from.
      const loadTol = loadTarget != null ? Math.max(0.5, loadTarget * 0.02) : null;
      const attemptedSetup = governedSets.some(s=> s && s.skipped !== true
        && (loadTarget == null || (Number(s.weightKg) > 0 && Math.abs(Number(s.weightKg) - loadTarget) <= loadTol))
        && (assistTarget == null || Math.abs(Number(s.assistedKg || 0) - assistTarget) <= 1)
        && Number(String(s.reps).match(/\d+/)?.[0] || s.reps) > 0);
      if(!attemptedSetup) continue;
      samples++;
      const repsMet = repsTarget == null || best.reps >= repsTarget;
      const loadMet = loadTarget == null || best.weightKg >= loadTarget;
      const assistMet = assistTarget == null || best.assistedKg <= assistTarget;
      const met = repsMet && loadMet && assistMet;
      const changePct = previousBest && previousBest > 0 ? (best.val - previousBest) / previousBest : null;
      const regressed = changePct != null && changePct <= -regCut;
      const gained = changePct != null && changePct >= gainPct;
      const aggressive = loadTarget != null && previousBest != null && loadTarget > previousBest * aggro;
      const easy = best.rpe != null && String(best.rpe).trim() !== '' && Number(best.rpe) <= easyRpe;
      if(!met || regressed || best.failed) over++;
      else if(!aggressive && easy && gained) under++;
      else if(met) success++;
      previousBest = best.val;
    }
  }
  const weight = samples / (samples + cal.pseudoCount);
  const overRate = samples ? over / samples : 0;
  const underRate = samples ? under / samples : 0;
  let dir = 0;
  if(samples >= cal.minExerciseSessions){
    if(overRate >= cal.overRateCutoff) dir = -1;
    else if(underRate >= cal.underRateCutoff) dir = 1;
  }
  const step = cal.jumpDeltaStep * weight * dir;
  const raw = 1 + step;
  const jumpMultiplier = Math.round(Math.max(cal.jumpMultiplierMin, Math.min(cal.jumpMultiplierMax, raw)) * 1e4) / 1e4;
  const active = dir !== 0 && samples >= cal.minExerciseSessions && Math.abs(jumpMultiplier - 1) > 1e-6;
  const successRate = samples ? Math.round(success / samples * 1000) / 1000 : null;
  const shrunkSuccessRate = Math.round(((success + cal.defaultSuccessRate * cal.pseudoCount) / (samples + cal.pseudoCount)) * 1000) / 1000;
  let note = null, headline = null;
  if(active && dir < 0){
    headline = 'Smaller increase recommended.';
    note = `Your last ${samples} increases at this exercise were completed ${success}/${samples} times, so Arise is progressing more cautiously.`;
  }else if(active && dir > 0){
    headline = 'Slightly more assertive progression.';
    note = `Your last ${samples} targets at this exercise were met easily ${under} times, so Arise is stepping up a little more confidently.`;
  }
  return {
    active, jumpMultiplier, direction: dir,
    samples, successRate, overRate: Math.round(overRate * 1000) / 1000, underRate: Math.round(underRate * 1000) / 1000,
    shrunkSuccessRate, evidenceWeight: Math.round(weight * 1000) / 1000,
    minExerciseSessions: cal.minExerciseSessions,
    headline, note,
  };
}

// Helpers
function lastSessionSetCount(history, exerciseId, fallback = 3){
  for(let i = (history||[]).length - 1; i >= 0; i--){
    const b = (history[i].blocks||[]).find(b=> b.exerciseId===exerciseId);
    if(b?.sets?.length) return b.sets.length;
  }
  return fallback;
}
function logsFor(history, exerciseId, asOfDateISO = null){
  const out=[];
  for(const h of history||[]) for(const b of h.blocks||[]) if(b.exerciseId===exerciseId) for(const s of b.sets||[]){
    const reps = Number(String(s.reps).match(/\d+/)?.[0] || s.reps)||0; const w = Number(s.weightKg)||0; const rpe = s.rpe ?? null;
    // Impossible values (negative weight) never inform a prescription — the
    // boot-time audit repairs them, but the engine also refuses them here.
    if(reps && w >= 0) out.push({ reps, weightKg: w, rpe, dateISO: h.dateISO, savedAt: h.savedAt || null, side: s.side||null, rom: s.rom||null, assistedKg: s.assistedKg ?? null });
  }
  // Chronological order: "the last log" must mean the most recent session,
  // not whatever row happened to come last in the array. Every caller passes
  // store-normalised (sorted) history today, but this is a public engine
  // contract — an unsorted import must not change the prescription.
  // Same-day ties resolve on savedAt (the store's own recency convention),
  // so an edited session re-save correctly becomes the reference exposure.
  out.sort((a,b)=> String(a.dateISO||'').localeCompare(String(b.dateISO||'')) || String(a.savedAt||'').localeCompare(String(b.savedAt||'')));
  return asOfDateISO ? out.filter(l=> String(l.dateISO || '') <= String(asOfDateISO)) : out;
}

// One row per session: the best-e1RM set for this exercise. Plateau, trend and
// learned-rate logic need exposures (sessions), not raw sets — a single workout
// with 4 sets would otherwise count as 4 data points.
// Exported: the policy layer (progressionPolicies.js) builds its confidence
// and trend windows from the same best-set summaries the engine uses.
// Best set per session for an exercise. With asOfDateISO, sessions after the
// cut are invisible — every consumer (plateau checks, learned rates, policy
// confidence) must be able to ask for the prior-only view.
export function sessionBestSummaries(history, exerciseId, asOfDateISO = null){
  const out=[];
  for(const session of orderedHistory(history)){
    if(asOfDateISO && String(session?.dateISO || '') > String(asOfDateISO)) continue;
    let best=null;
    for(const block of (session.blocks||[])){
      if(block.exerciseId!==exerciseId) continue;
      for(const set of (block.sets||[])){
        const reps = Number(String(set.reps).match(/\d+/)?.[0] || set.reps)||0;
        const weightKg = Number(set.weightKg)||0;
        // Same impossibility filter logsFor applies, so a boot-time-repaired
        // negative can never become the reference set a prescription is built on.
        if(reps && weightKg >= 0){
          const value = e1rm(weightKg, reps)||reps;
          if(!best || value>best.value) best = { reps, weightKg, rpe: set.rpe ?? null, dateISO: session.dateISO, value, assistedKg: set.assistedKg ?? null };
        }
      }
    }
    if(best) out.push(best);
  }
  return out;
}

// Set progression is a session-level decision. Looking at the last two flat
// set logs would mistake two sets from one workout for two separate successful
// exposures, so summarise each session before applying the evidence threshold.
function sessionSetSummaries(history, exerciseId){
  const out=[];
  for(const session of orderedHistory(history)){
    const sets = (session.blocks||[])
      .filter(block=> block.exerciseId===exerciseId)
      .flatMap(block=> block.sets||[])
      .map(set=> ({ reps: Number(String(set.reps).match(/\d+/)?.[0] || set.reps)||0, rpe: set.rpe ?? null }))
      .filter(set=> set.reps > 0);
    if(!sets.length) continue;
    const rpes = sets.map(set=> Number(set.rpe)).filter(value=> Number.isFinite(value));
    out.push({
      dateISO: session.dateISO,
      sessionId: session.id,
      sets: sets.length,
      reps: Math.max(...sets.map(set=> set.reps)),
      rpe: rpes.length ? Math.max(...rpes) : null,
    });
  }
  return out;
}
// Exported for the policy layer's overshoot guard (progressionPolicies.js):
// pain/noise flags matter even when the engine's own decision is to progress.
export function noisyFlagsForLastSession(history, exerciseId, config = null, asOfDateISO = null){
  const cfg = resolveArisePriors(config).programming.noisySession;
  // Prior-only: evaluate the last session AS OF a date, never the true last
  // entry, when the caller supplies an as-of cut. The slice becomes the
  // "history" the rest of the classifier sees. "Last" means the most recent
  // session (date, then savedAt) — never whichever row the caller's array
  // happened to end with.
  const slice = (asOfDateISO ? (history||[]).filter(h=> String(h?.dateISO || '') <= String(asOfDateISO)) : (history||[]))
    .map((session, originalIndex)=> ({ session, originalIndex }))
    .sort((a, b)=> String(a.session?.dateISO || '').localeCompare(String(b.session?.dateISO || ''))
      || String(a.session?.savedAt || '').localeCompare(String(b.session?.savedAt || ''))
      || a.originalIndex - b.originalIndex)
    .map(item=> item.session);
  const last = slice.length ? slice[slice.length - 1] : null;
  if(!last) return [];
  history = slice;
  const flags = [];
  if(last.durationMinutes != null && Number(last.durationMinutes) < cfg.shortDurationMinutes) flags.push('shortSession');
  if(last.painDiscomfort) flags.push('pain');
  const skipped = Number(last.skippedSetsCount) || (last.blocks||[]).reduce((n,b)=> n + (b.sets||[]).filter(s=> s.skipped || s.failed).length, 0);
  if(skipped >= cfg.missedSetsThreshold) flags.push('missedSets');
  if(last.exerciseOrder && history.length >= 2){
    const prev = history[history.length - 2];
    const prevOrder = Array.isArray(prev.exerciseOrder) ? prev.exerciseOrder.join(',') : (prev.blocks||[]).map(b=> b.exerciseId).join(',');
    const curOrder = Array.isArray(last.exerciseOrder) ? last.exerciseOrder.join(',') : (last.blocks||[]).map(b=> b.exerciseId).join(',');
    if(prevOrder && curOrder && prevOrder !== curOrder) flags.push('changedOrder');
  }
  if(last.equipmentSnapshot && history.length >= 2){
    const prevEquip = history[history.length - 2]?.equipmentSnapshot;
    // Copy before sorting: prevEquip may be a live reference into persisted history.
    if(Array.isArray(prevEquip) && Array.isArray(last.equipmentSnapshot) && [...prevEquip].sort().join('|') !== [...last.equipmentSnapshot].sort().join('|')) flags.push('equipmentChange');
  }
  // unusual performance: compare last e1rm to prior best
  if(exerciseId){
    const logs = logsFor(history, exerciseId);
    if(logs.length >= 3){
      const lastLog = logs[logs.length - 1];
      const priorBest = Math.max(...logs.slice(0,-1).map(l=> e1rm(l.weightKg||0,l.reps)||l.reps));
      const lastE1 = e1rm(lastLog.weightKg||0,lastLog.reps)||lastLog.reps;
      if(priorBest > 0 && (priorBest - lastE1)/priorBest >= cfg.unusualDropPct) flags.push('unusualPerformance');
    }
  }
  return flags;
}

function parseLow(s, config = null){ const m=String(s).match(/\d+/); return m? Number(m[0]) : resolveArisePriors(config).progression.defaultLowReps; }
function parseRange(s, config = null){ const nums = (String(s).match(/\d+/g)||[]).map(Number); if(nums.length>=2) return [nums[0], nums[1]]; if(nums.length===1) return [nums[0], nums[0]]; const defaults = (String(resolveArisePriors(config).progression.defaultTargetReps).match(/\d+/g)||[]).map(Number); return defaults.length>=2 ? [defaults[0], defaults[1]] : [8,12]; }
// Exported: the policy layer snaps policy-scaled loads back onto the
// increment grid so a scaled jump never lands between achievable loads.
export function snapLoad(v, config = null){
  if(v<=0) return 0;
  const cfg = resolveArisePriors(config).progression.loadRounding;
  const step = v < 20 ? cfg.under20KgStep : v < 60 ? cfg.under60KgStep : cfg.defaultStep;
  return Math.round(v/step)*step;
}
// A "go up" decision must actually go up. A percentage step on a light load
// (2.5% of 30 kg = 0.75 kg) rounds back onto the same grid point, which used
// to print "increase 30 → 30 kg" and leave a lifter on the same weight forever
// (cable curls, lateral raises, machine presses in the 10–30 kg range). Take
// at least one grid step above the current load.
export function increaseLoad(load, rawNext, config = null){
  const snapped = snapLoad(rawNext, config);
  if(!(load > 0) || snapped > load) return snapped;
  const cfg = resolveArisePriors(config).progression.loadRounding;
  const step = load < 20 ? cfg.under20KgStep : load < 60 ? cfg.under60KgStep : cfg.defaultStep;
  return Math.round((load + step) * 100) / 100;
}
// Advanced lifters deliberately get a smaller step that may round to a hold
// (training-age policy), so only novice/intermediate "go up" decisions are
// forced to move.
function bumpLoad(load, rawNext, cfg, trainingAge){
  return trainingAge?.phase === 'advanced' ? snapLoad(rawNext, cfg) : increaseLoad(load, rawNext, cfg);
}
// Exported: the swap-time e1RM carry needs the same equipment dispatch the
// plate-aware prescription uses, so a carried load lands on the replacement's
// own achievable increments (never the original lift's).
export function equipmentForExercise(exerciseId){
  const ex = EXERCISE_BY_ID[exerciseId];
  if(!ex) return 'barbell';
  const eq = (ex.equipment || []).join(' ');
  if(eq.includes('dumbbell') || eq.includes('dumbbells')) return 'dumbbell';
  if(eq.includes('machine') || eq.includes('cable')) return 'machine';
  if(eq.includes('barbell')) return 'barbell';
  // Unknown-kit weighted movements (e.g. a bench-only hip thrust): round to
  // generic machine increments rather than assuming a barbell's bar weight.
  return ex.progression === 'load' ? 'machine' : 'dumbbell';
}

function plateAware(result, plateConfig, exerciseId = null){
  if(!plateConfig || !(result?.load > 0)) return result;
  const equipment = exerciseId ? equipmentForExercise(exerciseId) : 'barbell';
  // Legacy barbell-only path uses nearestLoadToPlates directly; newer equipment types use dispatcher.
  const nearest = target=> equipment === 'barbell'
    ? nearestLoadToPlates(target, plateConfig)
    : nearestAchievableLoad(target, { equipment, config: plateConfig });
  const plateLoad = nearest(result.load);
  if(!plateLoad) return result;
  if(plateLoad.exact) return { ...result, plateLoad, plateEquipment: equipment };
  const suffix = equipment === 'barbell'
    ? ` Plate setup rounds ${plateLoad.targetKg}kg to ${plateLoad.loadKg}kg (${plateLoad.direction}).`
    : ` Available ${equipment} loads round ${plateLoad.targetKg}kg to ${plateLoad.loadKg}kg (${plateLoad.direction}).`;
  return {
    ...result,
    load: plateLoad.loadKg,
    plateLoad,
    plateEquipment: equipment,
    reason: `${result.reason}${suffix}`,
  };
}
function isBodyweight(id, config = null){
  const pattern = resolveArisePriors(config).progression.bodyweightPattern;
  return new RegExp(`(?:^|-)(${pattern})(?:-|$)`, 'i').test(id || '') || id === 'bodyweight-squat';
}

// Bodyweight variant ladders (priors: progression.bodyweightVariants).
//
// A bodyweight lift at the top of its rep range with no load cannot add kg —
// the honest next step is a harder variant of the SAME movement. The declared
// ladder resolves which one, honouring two constraints that make the
// recommendation trustworthy:
//
//   kit      — the variant may need no kit beyond the head exercise's own, so a
//              bodyweight-only user is never prescribed a barbell or a bench.
//   level    — a STEP-UP must be harder than the head, not merely different.
//              The library's own level field is the objective claim available
//              here. Without it the ladder's first entry is usually an on-ramp
//              or a regression (knee-push-up under push-up, negative-pull-up
//              under pull-up), and "step up" tells an intermediate to go
//              backwards.
//
// A declared ladder can legitimately hold both on-ramps and step-ups; the level
// filter is what makes only the step-ups reachable here.
//
// When no ladder covers the head, the declared `fallback` key reuses the head's
// own substitution list (still kit- and level-filtered), so an uncovered
// exercise recommends something specific rather than a generic hint.

const LEVEL_RANK = { Beginner: 0, Novice: 0, Intermediate: 1, Advanced: 2, Expert: 3 };
const levelRank = (level) => LEVEL_RANK[level] ?? 0;

function bodyweightVariantLadder(exerciseId, cfg, history = []){
  const vCfg = cfg.progression.bodyweightVariants || {};
  const head = EXERCISE_BY_ID[exerciseId];
  if(!head) return {};

  let ladder = Array.isArray(vCfg[exerciseId]) ? vCfg[exerciseId] : null;
  let source = 'ladder';
  if(!ladder && vCfg.fallback){
    ladder = Array.isArray(head.substitution) ? head.substitution.slice() : [];
    source = 'declared';
  }
  if(!ladder.length) return {};

  const headKit = new Set(head.equipment || ['bodyweight']);
  const headRank = levelRank(head.level);

  // Everything the user has already logged as an exercise id, so the ladder can
  // advance past rungs they have demonstrated rather than repeating one.
  const demonstrated = new Set(
    (Array.isArray(history) ? history : [])
      .flatMap((s) => (s.blocks || []).map((b) => b.exerciseId))
      .filter(Boolean)
  );

  // Kit, self and level filters, then smallest honest step first. Array#sort is
  // stable, so step-ups of equal level keep the declared order (the data file's
  // ordering is deliberate — closest match first).
  const candidates = ladder
    .map((id) => EXERCISE_BY_ID[id])
    .filter(Boolean)
    .filter((ex) => ex.id !== exerciseId)
    .filter((ex) => (ex.equipment || []).every((e) => headKit.has(e)))
    .filter((ex) => levelRank(ex.level) > headRank)
    .sort((a, b) => levelRank(a.level) - levelRank(b.level));
  if(!candidates.length) return {};

  // First rung not yet demonstrated. If every rung has been logged, hold at the
  // hardest rather than inventing something outside the declared knowledge.
  const next = candidates.find((c) => !demonstrated.has(c.id)) || candidates[candidates.length - 1];
  const name = next.name || next.id;
  const kitNote = source === 'declared' ? ` (listed alternative for ${head.name})` : '';
  return {
    next,
    reason: `Top of ${head.name} range — step up to ${name}${kitNote}.`,
    // Where the step sits in the honest set of achievable rungs, so a UI (and
    // the coach) can show the whole remaining path, not just the next rung.
    ladder: { total: candidates.length, step: candidates.indexOf(next) + 1 },
  };
}

// Stable chronology is part of the backtest contract. Dates are the only
// available event time in exported history; original order breaks ties so a
// later record on the same date can never become prior knowledge accidentally.
function orderedHistory(history){
  return (history || []).map((session, originalIndex)=> ({ session, originalIndex }))
    .sort((a, b)=> String(a.session?.dateISO || '').localeCompare(String(b.session?.dateISO || ''))
      || String(a.session?.savedAt || '').localeCompare(String(b.session?.savedAt || ''))
      || a.originalIndex - b.originalIndex)
    .map(item=> item.session);
}

export * from './progressionPrescription.js';
