// progression.js — deterministic progression engine.
// Pure: takes only the history visible to the caller plus explicit priors and
// returns next-load advice, plateau/deload signals, and explanations. Offline,
// no AI.

import { DEFAULT_ARISE_PRIORS, resolveArisePriors, clamp } from './priors.js';
import { nearestLoadToPlates, nearestAchievableLoad } from './plates.js';
import { EXERCISE_BY_ID } from './data.js';

export function e1rm(weightKg, reps){ if(!(weightKg>0 && reps>0)) return 0; return weightKg * (1 + reps/30); }
export function epleyToLoad(e1rmVal, reps){ return e1rmVal / (1 + reps/30); }

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

// Training age: months since the user's first logged session. Personalises cold-start
// progression rates — novices adapt faster, advanced lifters slower (rate-limiting factor
// shifts from adaptation to recovery/technique).
export function trainingAgeMonths(history, { asOfDateISO = null, config = null } = {}){
  if(!history || !history.length) return 0;
  // Both boundaries parse as UTC calendar days: history dateISO values are UTC
  // midnights, so a local-midnight as-of date would exclude same-day sessions
  // in UTC+ timezones and include them in UTC− ones.
  const end = asOfDateISO ? Date.parse(`${asOfDateISO}T00:00:00Z`) : Date.now();
  if(!Number.isFinite(end)) return 0;
  const dates = history.map(h=> Date.parse(h.dateISO)).filter(value=> Number.isFinite(value) && value <= end).sort((a,b)=> a-b);
  if(!dates.length) return 0;
  return Math.max(0, (end - dates[0]) / (resolveArisePriors(config).progression.daysPerMonth * 86400000));
}
export function trainingPhase(months, { config = null } = {}){
  const cfg = resolveArisePriors(config).progression.trainingAge;
  if(months <= 0) return 'unknown';
  if(months < cfg.noviceMaxMonths) return 'novice';
  if(months < cfg.intermediateMaxMonths) return 'intermediate';
  return 'advanced';
}
export function ageRateMultiplier(months, { config = null } = {}){
  const cfg = resolveArisePriors(config).progression.trainingAge;
  if(months <= 0) return 1;
  if(months < cfg.noviceMaxMonths) return cfg.noviceMultiplier;
  if(months < cfg.intermediateMaxMonths) return cfg.intermediateMultiplier;
  return cfg.advancedMultiplier;
}
export function trainingAgeInfo(history, { asOfDateISO = null, config = null } = {}){
  const months = trainingAgeMonths(history, { asOfDateISO, config });
  return { months: Math.round(months*10)/10, phase: trainingPhase(months, { config }), multiplier: ageRateMultiplier(months, { config }) };
}

// A long gap is not a diagnosis and does not erase training age, but it is a
// reason to restart the next exposure conservatively. The caller supplies the
// point-in-time date so historical replay cannot look into the future.
export function trainingBreakInfo(history, { asOfDateISO = null, config = null } = {}){
  const cfg = resolveArisePriors(config).progression.trainingAge;
  // Without an explicit as-of date there is no stable point-in-time boundary;
  // leave the legacy recommendation path unchanged rather than using the
  // wall-clock and making historical results drift.
  if(!asOfDateISO) return { hasBreak: false, daysSinceLast: null, longBreakDays: cfg.longBreakDays };
  const end = Date.parse(`${asOfDateISO}T00:00:00Z`);
  const dates = (history || []).map(session=> Date.parse(`${session?.dateISO || ''}T00:00:00Z`))
    .filter(value=> Number.isFinite(value) && value <= end)
    .sort((a, b)=> a - b);
  if(!dates.length || !Number.isFinite(end)) return { hasBreak: false, daysSinceLast: null, longBreakDays: cfg.longBreakDays };
  const daysSinceLast = Math.max(0, Math.floor((end - dates[dates.length - 1]) / 86400000));
  return {
    hasBreak: daysSinceLast >= cfg.longBreakDays,
    daysSinceLast,
    longBreakDays: cfg.longBreakDays,
    lastSessionDateISO: new Date(dates[dates.length - 1]).toISOString().slice(0, 10),
  };
}

// Short-break detection (5–41 days since THIS lift's last exposure). The
// multipliers live in cfg.progression.shortBreakPolicy, which the progression
// model only supplies after its evidence gates open — without that policy the
// engine treats short gaps exactly like any other gap.
export function shortBreakInfo(history, exerciseId, { asOfDateISO = null, config = null } = {}){
  const all = resolveArisePriors(config);
  const policy = all.progression.shortBreakPolicy || {};
  const longDays = all.progression.trainingAge.longBreakDays;
  if(!asOfDateISO) return { hasShortBreak: false, daysSince: null, multiplier: 1 };
  // Without an opened policy there is no easing at all — detection stays
  // available for analysis, but application requires evidence.
  if(!policy.enabled) return { hasShortBreak: false, daysSince: null, multiplier: 1 };
  const end = Date.parse(`${asOfDateISO}T00:00:00Z`);
  if(!Number.isFinite(end)) return { hasShortBreak: false, daysSince: null, multiplier: 1 };
  const dates = orderedHistory(history)
    .filter(session=> (session.blocks||[]).some(b=> b.exerciseId===exerciseId))
    .map(session=> Date.parse(`${session?.dateISO || ''}T00:00:00Z`))
    .filter(value=> Number.isFinite(value) && value <= end)
    .sort((a, b)=> a - b);
  if(!dates.length) return { hasShortBreak: false, daysSince: null, multiplier: 1 };
  const daysSince = Math.max(0, Math.floor((end - dates[dates.length - 1]) / 86400000));
  const minDays = policy.minDays ?? 5;
  const moderateDays = policy.moderateDays ?? 14;
  if(daysSince >= longDays || daysSince < minDays) return { hasShortBreak: false, daysSince, multiplier: 1 };
  const multiplier = daysSince >= moderateDays ? (policy.moderateLoadMultiplier ?? 0.9) : (policy.lightLoadMultiplier ?? 0.95);
  return { hasShortBreak: true, daysSince, multiplier };
}

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

// Recommend next load/reps from last N sessions for an exercise.
// Conservative double-progression: first add reps, then add load.
// Now strategy-aware + personalised + plateau-aware.
export function recommendNext({ exerciseId, history, targetReps = null, conservative = true, strategy, config = null, asOfDateISO = null, calibration = null, plateConfig = null }){
  const cfg = resolveArisePriors(config);
  targetReps = targetReps || cfg.progression.defaultTargetReps;
  // PRIOR-ONLY INVARIANT: with asOfDateISO set, every decision input is sliced
  // to sessions on or before that date. The engine never sees the future.
  const logs = logsFor(history, exerciseId, asOfDateISO).slice(-cfg.progression.historyWindow);
  if(!logs.length) {
    const strat = strategy || strategyForExercise(exerciseId, { config: cfg });
    return { load: null, reps: parseLow(targetReps, cfg), reason: "No history — use program prescription.", strategy: strat, trainingAge: trainingAgeInfo(history, { asOfDateISO, config: cfg }), priorsVersion: cfg.version };
  }
  const last = logs[logs.length-1];
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
    return { load: null, reps, reason: "Top of range — try harder variant (decline/weighted/tempo).", strategy: strat, personalised: prate, suggestWeighted: true, trainingAge, priorsVersion: cfg.version };
  }
  const rpe = last.rpe != null && String(last.rpe).trim()!=='' ? Number(last.rpe) : null;
  const rir = rpe !== null && Number.isFinite(rpe) ? Math.max(0, 10 - rpe) : 2;
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
  if(reps < hi) {
    if(rir >= 2) return plateAware({ load, reps: Math.min(hi, reps + 1), reason: `Room at RPE ${rpe ?? "/"} — add a rep (${reps}→${Math.min(hi, reps+1)}).`, strategy: strat, personalised: prate, trainingAge }, plateConfig, exerciseId);
    const nextLoad = snapLoad(load * (1 + incPct), cfg);
    return plateAware({ load: nextLoad, reps: lo, reason: `Close to failure (RIR ~${rir}) — increase ${load} → ${nextLoad} kg and reset to ${lo} reps.`, strategy: strat, personalised: prate, trainingAge }, plateConfig, exerciseId);
  }
  const nextLoad = snapLoad(load > 0 ? load * (conservative ? (1 + incPct) : (1 + incPct*cfg.progression.nonConservativeMultiplier)) : 0, cfg);
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
  const room = recent.every(l=> l.rpe == null || String(l.rpe).trim()==='' || Number(l.rpe) <= cfg.roomRpeMax);
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
        if(!reps && !weightKg) continue;
        const value = e1rm(weightKg, reps)||reps;
        if(!best || value>best.value) best = { reps, weightKg, rpe: set.rpe ?? null, dateISO: session.dateISO, value };
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
function equipmentForExercise(exerciseId){
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
  const plateLoad = equipment === 'barbell'
    ? nearestLoadToPlates(result.load, plateConfig)
    : nearestAchievableLoad(result.load, { equipment, config: plateConfig });
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
