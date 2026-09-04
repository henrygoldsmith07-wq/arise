// progressionPolicies.js — recommendation POLICY, separate from recommendation
// EXECUTION (ADR 0008).
//
// `progression.js` / `progressionModel.js` decide the next prescription from
// priors, evidence and the learned model — that is execution. This module is
// the accountable layer on top:
//   - versioned policies (conservative / standard / aggressive / maintenance)
//     that shape, clamp or veto what execution produced
//   - a confidence score, an evidence count and an uncertainty estimate on
//     every recommendation
//   - multi-window trend analysis (1 / 3 / 6 / 12 weeks)
//   - sustained-trend deload triggers (multi-session, never single-dip) with
//     effectiveness tracking, and plateau confidence / false-plateau detection
//   - guardrails: repeated-failure hold, aggressive overshoot protection,
//     pain suppression (pain-aware holds already come from the engine)
//   - explanation strings in simple / standard / advanced modes
//
// Everything here is pure: history, logs, events and config go in, enriched
// recommendations and verdicts come out. No React, no storage, no I/O.

import { resolveArisePriors } from './priors.js';
import {
  e1rm,
  strengthTrendWithConfidence,
  sessionBestSummaries,
  rirFromRpe,
  readinessEMA,
  noisyFlagsForLastSession,
  recommendNext,
  snapLoad,
} from './progression.js';
import { recommendNextWithModel } from './progressionModel.js';

// ── Versioned policies ───────────────────────────────────────────────────────
// `standard` is deliberately a pure passthrough: the engine's own conservative
// defaults ARE the standard policy, so its behaviour is identical to a run
// without this layer. The other three are explicit transforms on top.

export const POLICY_VERSION = 1;

export const PROGRESSION_POLICIES = Object.freeze({
  standard: Object.freeze({
    version: POLICY_VERSION,
    label: 'Standard',
    description: 'The engine as designed — double progression, evidence-gated, conservative by default.',
    passthrough: true,
    loadScale: 1,
    maxLoadJumpPct: 0.1,      // cap on a single session's load increase
    maxRepGain: 3,            // cap on a single session's rep increase
    minConfidence: 0,         // never veto on confidence alone
    deloadSensitivity: 'standard', // standard | high | low
    allowLoadIncrease: true,
  }),
  conservative: Object.freeze({
    version: POLICY_VERSION,
    label: 'Conservative',
    description: 'Smaller jumps, higher proof required before progressing, deloads trigger earlier.',
    passthrough: false,
    loadScale: 0.7,
    maxLoadJumpPct: 0.05,
    maxRepGain: 1,
    minConfidence: 0.45,
    deloadSensitivity: 'high',
    allowLoadIncrease: true,
  }),
  aggressive: Object.freeze({
    version: POLICY_VERSION,
    label: 'Aggressive',
    description: 'Larger jumps when evidence is strong — but never into a failing or painful pattern.',
    passthrough: false,
    loadScale: 1.25,
    maxLoadJumpPct: 0.05,     // aggressive ≠ reckless: overshoot protection caps jumps
    maxRepGain: 2,
    minConfidence: 0.35,
    deloadSensitivity: 'low',
    allowLoadIncrease: true,
  }),
  maintenance: Object.freeze({
    version: POLICY_VERSION,
    label: 'Maintenance',
    description: 'Hold current work capacity: no load increases, deload pressure absorbed.',
    passthrough: false,
    loadScale: 1,
    maxLoadJumpPct: 0,
    maxRepGain: 0,
    minConfidence: 0,
    deloadSensitivity: 'low',
    allowLoadIncrease: false,
  }),
});

export const POLICY_ORDER = ['standard', 'conservative', 'aggressive', 'maintenance'];

export function resolvePolicy(name, { config = null } = {}){
  const cfg = config?.progression?.policy?.policies?.[name] || null;
  const base = PROGRESSION_POLICIES[name] || PROGRESSION_POLICIES.standard;
  return cfg ? { ...base, ...cfg } : base;
}

// ── Multi-window trend analysis ──────────────────────────────────────────────
// One regression over the whole window is how engines overreact to a hot or
// cold streak. Windows make the shape visible: rising weekly but flat over 6
// weeks is a different story from rising over both.

const TREND_WINDOWS_DAYS = { w1: 7, w3: 21, w6: 42, w12: 84 };

function logsInWindow(logs, days, asOfISO){
  if(!days) return logs;
  const end = asOfISO ? Date.parse(asOfISO) : Date.now();
  const floor = end - days * 86400000;
  return logs.filter(l=> (Date.parse(l.dateISO) || 0) >= floor);
}

export function multiWindowTrend(logs, { asOfDateISO = null } = {}){
  const out = {};
  for(const [key, days] of Object.entries(TREND_WINDOWS_DAYS)){
    const slice = logsInWindow(logs, days, asOfDateISO);
    const t = strengthTrendWithConfidence(slice);
    out[key] = { slope: t.slope, r2: t.r2, n: t.n, confidence: t.confidence, direction: t.slope > 0 ? 'up' : t.slope < 0 ? 'down' : 'flat' };
  }
  return out;
}

// ── Confidence / evidence / uncertainty ─────────────────────────────────────
// Confidence answers "how much do we trust the direction of this call",
// from evidence volume (sessions), fit (r2 of the trend) and spread
// (consistency of recent e1rm). Uncertainty is its complement plus a noise
// term, so a recommendation can be high-confidence but still carry a wide
// error bar (small n with a perfect fit).

function e1rmSeries(logs){
  return logs.map(l=> ({ date: l.date, val: e1rm(l.weightKg||0, l.reps) || l.reps || 0 }));
}

function spreadPct(series){
  const vals = series.map(s=> s.val).filter(v=> v > 0);
  if(vals.length < 2) return 0;
  const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
  if(!mean) return 0;
  const min = Math.min(...vals), max = Math.max(...vals);
  return (max - min)/mean;
}

export function recommendationConfidence({ logs, trend, minObservations = 3 }){
  const n = logs.length;
  if(n === 0) return { score: 0, band: 'none', factors: { n: 0, r2: 0, spread: 1 } };
  const series = e1rmSeries(logs);
  const r2 = trend?.w6?.r2 ?? trend?.w3?.r2 ?? 0;
  const spread = spreadPct(series);
  // Volume: 0→0.45 over 6 sessions. Fit: r2 linear weight. Spread: penalties
  // above 15% swing, since consistent e1rm means the trend is trustworthy.
  const volume = Math.min(0.45, (n / 6) * 0.45);
  const fit = Math.max(0, r2) * 0.35;
  const stability = Math.max(0, 0.2 - Math.max(0, spread - 0.15) * 0.8);
  const score = Math.min(1, Math.round((volume + fit + stability) * 100) / 100);
  const band = score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : n >= minObservations ? 'low' : 'low-thin';
  return { score, band, factors: { n, r2: Math.round(Math.max(0, r2) * 100) / 100, spread: Math.round(spread * 100) / 100 } };
}

export function uncertaintyEstimate({ confidence, logs }){
  const n = logs.length;
  // Base bar: ±2.5% per missing session until 6, floored at ±2%.
  let pct = Math.max(2, 2.5 * Math.max(0, 6 - n) + 2);
  if(confidence.band === 'low' || confidence.band === 'low-thin') pct += 3;
  if(confidence.factors.spread > 0.25) pct += 2;
  return { pct: Math.round(pct), label: `±${Math.round(pct)}%` };
}

function evidenceCount({ logs, trend }){
  const windows = Object.entries(trend).filter(([, t])=> t.n > 0);
  return { sessions: logs.length, trendWindows: windows.length, minWindowN: windows.length ? Math.min(...windows.map(([, t])=> t.n)) : 0 };
}

// ── Guardrails ───────────────────────────────────────────────────────────────

// Repeated failure: two consecutive exposures with failed/skipped sets at this
// exercise is a pattern, not noise — hold load regardless of policy. Scans the
// raw history blocks (set rows carry `failed`/`skipped`; best-set summaries
// deliberately do not).
export function repeatedFailureGuard(history, exerciseId, { minSessions = 2, asOfDateISO = null } = {}){
  const sessions = [];
  for(const entry of history || []){
    if(asOfDateISO && String(entry?.dateISO || '') > String(asOfDateISO)) continue;
    const rows = (entry.blocks||[]).filter(b=> b.exerciseId === exerciseId).flatMap(b=> b.sets||[]);
    if(rows.length) sessions.push(rows);
  }
  const last = sessions.slice(-minSessions);
  if(last.length < minSessions) return { trip: false };
  const failing = last.filter(rows=> rows.some(s=> s.failed || s.skipped));
  if(failing.length >= minSessions){
    return { trip: true, reason: `${failing.length} consecutive sessions with failed or skipped sets — holding load until a clean session lands.`, n: failing.length };
  }
  return { trip: false };
}

// Aggressive overshoot: a big jump is only allowed when the last exposure had
// room to spare (RIR ≥ 2) AND no noisy flags. Returns a clamp directive.
export function overshootGuard({ rec, lastLog, noisy, policy }){
  if(!rec || policy.passthrough) return { clamped: false };
  if(typeof rec.load !== 'number' || typeof rec.__prevLoad !== 'number' || rec.load <= rec.__prevLoad) return { clamped: false };
  const rir = lastLog?.rpe != null ? rirFromRpe(Number(lastLog.rpe)) : null;
  const jumpPct = rec.__prevLoad > 0 ? (rec.load - rec.__prevLoad) / rec.__prevLoad : 0;
  if(rir != null && rir < 2){
    return { clamped: true, load: rec.__prevLoad, reason: `Overshoot protection: last set was near failure (RIR ~${rir}) — ${policy.label} policy holds the load this week.` };
  }
  if((noisy || []).includes('pain')){
    return { clamped: true, load: rec.__prevLoad, reason: 'Pain flagged last session — load held regardless of policy until a pain-free session.' };
  }
  if(policy.maxLoadJumpPct > 0 && jumpPct > policy.maxLoadJumpPct){
    return { clamped: true, load: Math.round(rec.__prevLoad * (1 + policy.maxLoadJumpPct) * 10) / 10, reason: `Jump capped at ${Math.round(policy.maxLoadJumpPct * 100)}% by ${policy.label} policy.` };
  }
  return { clamped: false };
}

// ── Deload: sustained-trend trigger + effectiveness ─────────────────────────
// A single bad session never triggers a deload here — that is the engine's
// noisy-session hold. A deload requires a sustained pattern: decline across
// the 3-week AND 6-week windows, plus corroboration (readiness EMA below
// floor, or repeated failures). Sensitivity shifts the corroboration bar.

export function sustainedDeloadCheck({ logs, failureHistory = null, exerciseId = null, readinessLog = [], policy, config = null }){
  const cfg = resolveArisePriors(config);
  const floor = cfg.sessionQuality?.readiness?.deloadEmaFloor ?? 2.2;
  const trends = multiWindowTrend(logs);
  const w3 = trends.w3, w6 = trends.w6;
  const sessionsWithFailures = (summaries)=> (failureHistory && exerciseId)
    ? repeatedFailureGuard(failureHistory, exerciseId, { minSessions: 2 })
    : { trip: false };
  if(w3.n < 3 || w6.n < 4){
    return { yes: false, confidence: 'none', reason: `Not enough history for a deload call (${w3.n} sessions in 3 weeks, need ≥3; ${w6.n} in 6, need ≥4).` };
  }
  const declining = w3.direction === 'down' && (w6.direction === 'down' || w6.direction === 'flat');
  if(!declining){
    return { yes: false, confidence: 'none', reason: `Trend is ${w3.direction}/3wk and ${w6.direction}/6wk — no sustained decline.` };
  }
  // Corroboration. High sensitivity needs any one; standard needs one strong;
  // low needs both. Readiness entries are 0–100 scores (the app's own scale —
  // see sessionQuality.js); accept raw numbers or {score}/{value} records.
  const ema = readinessEMA((readinessLog || []).map(r=> (r && typeof r === 'object') ? (r.score ?? r.value ?? null) : r).filter(v=> v != null), { config });
  const lowReadiness = ema?.value != null && ema.value < (cfg.recovery?.readinessLowEma ?? 35);
  const failGuard = sessionsWithFailures(logs.slice(-3));
  const failureStreak = failGuard.trip;
  const corroboration = [lowReadiness && 'readiness below floor', failureStreak && 'repeated failures'].filter(Boolean);
  const need = policy.deloadSensitivity === 'high' ? 1 : policy.deloadSensitivity === 'low' ? 2 : 1;
  const strong = corroboration.length >= need;
  if(!strong){
    return { yes: false, confidence: 'low', reason: `3-week trend is down but corroboration is thin (${corroboration.join(', ') || 'none'}) — watching, not acting.` };
  }
  const confidence = w6.r2 >= 0.5 ? 'high' : 'medium';
  return {
    yes: true,
    confidence,
    contributing: corroboration,
    reason: `Sustained decline: ${w3.direction} over 3 weeks and ${w6.direction} over 6 (r² ${w6.r2})${corroboration.length ? `, with ${corroboration.join(' + ')}` : ''} — deload recommended.`,
  };
}

// Effectiveness: did performance recover after the last deload? Compares the
// best e1rm in the 10 days before the deload against the best after it,
// within the return window. Pure over (events, history).
export function deloadEffectiveness({ events = [], history = [], exerciseId = null, returnWindowDays = 21 }){
  const deloadStart = [...(events||[])].reverse().find(e=> e.type === 'deload:prescribed' && (!exerciseId || e.exerciseId === exerciseId || e.scope === 'week'));
  if(!deloadStart) return { tracked: false, reason: 'No recorded deload to evaluate.' };
  const start = Date.parse(deloadStart.at || deloadStart.date || deloadStart.atISO);
  if(!Number.isFinite(start)) return { tracked: false, reason: 'Deload event has no parsable date.' };
  const pre = [], post = [];
  for(const entry of history){
    // History entries are day-granular; the deload event is a timestamp. Compare
    // at END OF DAY so a session ON the deload start date or within the return
    // window counts regardless of intra-day ordering.
    const t = Date.parse(entry.dateISO);
    if(!Number.isFinite(t)) continue;
    const entryEnd = t + 86400000;
    const logs = exerciseId
      ? (entry.blocks||[]).filter(b=> b.exerciseId === exerciseId).flatMap(b=> b.sets||[])
      : (entry.blocks||[]).flatMap(b=> b.sets||[]);
    for(const s of logs){
      const v = e1rm(s.weightKg||0, s.reps) || 0;
      if(v <= 0) continue;
      if(entryEnd <= start && entryEnd >= start - 10*86400000) pre.push(v);
      if(entryEnd > start && entryEnd <= start + returnWindowDays*86400000) post.push(v);
    }
  }
  if(!pre.length || !post.length) return { tracked: false, reason: 'Not enough performance data around the deload yet.' };
  const preBest = Math.max(...pre), postBest = Math.max(...post);
  const deltaPct = Math.round(((postBest - preBest) / preBest) * 1000) / 10;
  return {
    tracked: true,
    preBest: Math.round(preBest * 10) / 10,
    postBest: Math.round(postBest * 10) / 10,
    deltaPct,
    recovered: deltaPct >= -1,
    verdict: deltaPct >= -1 ? `Recovered${deltaPct > 0 ? ` and +${deltaPct}%` : ''} — deload did its job.` : `Still ${deltaPct}% under pre-deload best — recover longer before pushing.`,
  };
}

// ── Plateau confidence / false-plateau detection ────────────────────────────
// isPlateauV2 says flat-or-not; this adds how much we believe it. A "plateau"
// over 3 wide-spread sessions with low r² is often just noise — the verdict
// there is "extend observation", not "hold forever".

export function plateauConfidence(sessions, { config = null } = {}){
  const n = sessions.length;
  if(n < 3) return { isPlateau: false, confidence: 'none', falsePlateauLikely: false, reason: `Only ${n} sessions — plateau rules need ≥3.` };
  const vals = sessions.map(s=> e1rm(s.weightKg||0, s.reps) || s.reps || 0).filter(v=> v > 0);
  if(vals.length < 3) return { isPlateau: false, confidence: 'none', falsePlateauLikely: false, reason: 'Not enough scored sets.' };
  const spread = spreadPct(vals.map(v=> ({ val: v })));
  const trend = strengthTrendWithConfidence(sessions.map(s=> ({ weightKg: s.weightKg, reps: s.reps })));
  // "Flat" is scale-relative: 0.5% of mean e1rm per session. An absolute floor
  // (0.01 kg/session) would call a noisy but sideways series "rising".
  const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
  const flatEps = Math.max(0.01, mean * 0.005);
  const flat = Math.abs(trend.slope) < flatEps;
  if(!flat){
    return { isPlateau: false, confidence: 'high', falsePlateauLikely: false, reason: `Trend slope ${trend.slope > 0 ? '+' : ''}${trend.slope}/session — not flat.` };
  }
  const noisy = spread > 0.2 || trend.r2 < 0.3;
  if(noisy){
    return { isPlateau: false, confidence: 'low', falsePlateauLikely: true, reason: `Looks flat but the data is noisy (spread ${Math.round(spread*100)}%, r² ${trend.r2}) — likely a false plateau; log more sessions before holding.` };
  }
  return { isPlateau: true, confidence: n >= 5 && trend.r2 >= 0.6 ? 'high' : 'medium', falsePlateauLikely: false, reason: `Flat across ${n} consistent sessions (r² ${trend.r2}) — genuine plateau.` };
}

// ── Explanation strings ──────────────────────────────────────────────────────
// Every enriched recommendation carries all three modes; the UI picks.

export function buildExplanation({ rec, policy, confidence, uncertainty, evidence, trends, exerciseName }){
  const name = exerciseName || 'this lift';
  const loadPart = rec.load != null && rec.load > 0 ? `${rec.load} kg` : 'bodyweight';
  const repsPart = rec.reps != null ? ` × ${rec.reps}` : '';
  const guardText = {
    'maintenance-hold': 'maintenance',
    'confidence': 'confidence still low',
    'jump-cap': 'policy cap',
    'overshoot': 'near failure last set',
    'repeated-failure': 'repeat failures',
    'rep-cap': 'rep cap',
  }[rec.guard] || (rec.guard || '').replace(/-/g, ' ');
  const trendLine = trends ? `1wk ${trends.w1.direction}, 3wk ${trends.w3.direction}, 6wk ${trends.w6.direction}` : 'no trend data';
  return {
    // Simple = the action. Standard = the why. Advanced = the whole ledger.
    simple: rec.guard
      ? `${name}: hold${rec.load != null && rec.load > 0 ? ` ${rec.load} kg` : ''}${repsPart} — ${guardText}.`
      : `${name}: ${loadPart}${repsPart}.`,
    standard: rec.reason,
    advanced: `${rec.reason} | ${policy.label} policy v${policy.version}: load scale ×${policy.loadScale}, jump cap ${Math.round(policy.maxLoadJumpPct * 100)}%. Confidence ${confidence.band} (${confidence.score}) from ${evidence.sessions} sessions, spread ${Math.round((confidence.factors.spread||0) * 100)}%, 6wk r² ${confidence.factors.r2}. Uncertainty ${uncertainty.label}. Trends: ${trendLine}. Evidence: ${evidence.trendWindows}/4 windows populated.`,
  };
}

// ── The enriched recommendation entry point ─────────────────────────────────
// Same inputs as recommendNextWithModel plus policy + explanation mode. The
// returned recommendation keeps every field the UI already reads (load, reps,
// reason, assistKg, …) and adds: policy, confidence, uncertainty, evidence,
// trends, explanation, guard (when a guardrail fired), loadability.

export function recommendNextWithPolicy({
  exerciseId, history, targetReps = null, policy = 'standard', policyConfig = null,
  config = null, asOfDateISO = null, plateConfig = null, study = null, readinessLog = [],
} = {}){
  const pol = resolvePolicy(policy, { config: policyConfig || config });
  const base = recommendNextWithModel({ exerciseId, history, targetReps, config, asOfDateISO, plateConfig, study })
    || recommendNext({ exerciseId, history, targetReps, config, asOfDateISO, plateConfig });
  if(!base) return null;

  const cfg = resolveArisePriors(config);
  // PRIOR-ONLY INVARIANT: every graded input is sliced to sessions on or
  // before asOfDateISO, matching the engine's own cut underneath.
  const logs = sessionBestSummaries(history, exerciseId)
    .filter(s=> !asOfDateISO || String(s.dateISO || '') <= String(asOfDateISO))
    .slice(-cfg.progression.historyWindow);
  const trends = multiWindowTrend(logs, { asOfDateISO });
  const confidence = recommendationConfidence({ logs, trend: trends });
  const uncertainty = uncertaintyEstimate({ confidence, logs });
  const evidence = evidenceCount({ logs, trend: trends });

  const rec = { ...base, policy: pol.passthrough ? 'standard' : policy, policyVersion: pol.version };
  rec.__prevLoad = logs.length ? (logs[logs.length - 1].weightKg || 0) : null;

  // Policy transforms on a progressing recommendation. Every scaled or capped
  // load is snapped back onto the engine's increment grid so a policy can
  // never recommend a load the user cannot actually load.
  const lastLog = logs.length ? logs[logs.length - 1] : null;
  const lastRepsVal = lastLog?.reps != null ? (Number(String(lastLog.reps).match(/\d+/)?.[0] || lastLog.reps) || null) : null;
  const recRepsVal = rec.reps != null ? (Number(String(rec.reps).match(/\d+/)?.[0] || rec.reps) || null) : null;
  if(!pol.passthrough){
    if(!pol.allowLoadIncrease){
      // Maintenance: freeze at current work capacity — load AND reps.
      let held = false;
      if(rec.load != null && rec.__prevLoad != null && rec.load > rec.__prevLoad){ rec.load = rec.__prevLoad; held = true; }
      if(rec.reps != null && lastRepsVal != null && recRepsVal != null && recRepsVal > lastRepsVal){ rec.reps = lastRepsVal; held = true; }
      if(held){ rec.reason = `${rec.reason} (Maintenance policy: held at current work capacity.)`; rec.guard = 'maintenance-hold'; }
    } else if(pol.loadScale !== 1 && rec.load != null && rec.__prevLoad > 0 && rec.load > rec.__prevLoad){
      const scaled = rec.__prevLoad + (rec.load - rec.__prevLoad) * pol.loadScale;
      rec.load = snapLoad(scaled, config);
      rec.reason = `${rec.reason} (Scaled ×${pol.loadScale} by ${pol.label} policy.)`;
    }
    if(pol.maxLoadJumpPct > 0 && rec.load != null && rec.__prevLoad > 0){
      const cap = rec.__prevLoad * (1 + pol.maxLoadJumpPct);
      if(rec.load > cap){
        // Snap to the grid, but never back above the cap: if rounding rounds
        // up past it, drop one step instead.
        const snapped = snapLoad(cap, config);
        rec.load = snapped > cap ? snapLoad(cap - 0.01, config) : snapped;
        rec.guard = 'jump-cap';
      }
    }
    // Aggressive jumps must still respect the target's rep range: an extra
    // load increment never comes with an extra rep on top. (Maintenance already
    // froze reps above; this caps the other policies.)
    if(pol.allowLoadIncrease && pol.maxRepGain != null && rec.reps != null && lastRepsVal != null && recRepsVal != null){
      if(recRepsVal > lastRepsVal + pol.maxRepGain){
        rec.reps = lastRepsVal + pol.maxRepGain;
        rec.reason = `${rec.reason} Rep jump capped to +${pol.maxRepGain} by ${pol.label} policy.`;
        rec.guard = rec.guard || 'rep-cap';
      }
    }
  }

  // Confidence veto: below the policy floor, a "progress" call is downgraded
  // to a hold unless the engine already had an overriding safety reason
  // (plateau, noisy session, short break) — those carries their own evidence.
  const overrideKinds = ['plateau', 'noisy', 'shortBreak', 'ease-back'];
  const overriding = overrideKinds.some(k=> (rec.plateau && k === 'plateau') || (rec.noisy && k === 'noisy') || (rec.shortBreak && k === 'shortBreak') || (rec.reason || '').toLowerCase().includes(k));
  if(!pol.passthrough && confidence.score < pol.minConfidence && !overriding && rec.load != null && rec.__prevLoad != null && rec.load > rec.__prevLoad){
    rec.load = rec.__prevLoad;
    rec.guard = 'confidence';
    rec.reason = `${rec.reason} Held instead: confidence ${Math.round(confidence.score * 100)}% is below the ${pol.label} floor (${Math.round(pol.minConfidence * 100)}%) with ${evidence.sessions} sessions of evidence.`;
  }

  // Guardrails (any policy, aggressive most exposed). Pain/noise flags come
  // from the engine's own classifier so both layers agree on what "noisy" means.
  const noisy = noisyFlagsForLastSession(history, exerciseId, config, asOfDateISO);
  const guard = overshootGuard({ rec, lastLog, noisy, policy: pol });
  if(guard.clamped){ rec.load = guard.load; rec.guard = rec.guard || 'overshoot'; rec.reason = `${rec.reason} ${guard.reason}`; }
  const failGuard = repeatedFailureGuard(history, exerciseId, { asOfDateISO });
  if(failGuard.trip && rec.load != null && rec.__prevLoad != null && rec.load > rec.__prevLoad){
    rec.load = rec.__prevLoad;
    rec.guard = 'repeated-failure';
    rec.reason = `${rec.reason} ${failGuard.reason}`;
  }

  // Loadability: when plate rounding changed the target, surface it instead of
  // letting the engine's suffix be the only hint. plateLoad comes from the
  // engine's plateAware step, so this stays consistent with it.
  if(rec.plateLoad && !rec.plateLoad.exact && rec.load != null && rec.load > (rec.__prevLoad || 0)){
    rec.loadability = { achievable: rec.plateLoad.loadKg, requested: rec.plateLoad.targetKg, warning: `Exact ${rec.plateLoad.targetKg} kg isn't achievable with your plates — nearest is ${rec.plateLoad.loadKg} kg.` };
  }

  rec.confidence = confidence;
  rec.uncertainty = uncertainty;
  rec.evidence = evidence;
  rec.trends = trends;
  rec.explanation = buildExplanation({ rec, policy: pol, confidence, uncertainty, evidence, trends, exerciseName: null });
  return rec;
}

// Deload effectiveness and sustained checks are exported for the advisor UI
// and tests; recommendation execution stays in progression.js.
