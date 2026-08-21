// sessionQuality.js — session-quality & recovery helpers.
// Pure, deterministic, offline. Answers three questions:
//   1. Was this session good/ok/bad, and why?
//   2. Is a flat stretch a real plateau or just a run of bad sessions?
//   3. Is a "PR" actually a PR (not technique/ROM change or one-day noise)?
// Reuses the existing readiness EMA (progression.js) so one-day dips never
// get treated as a trend.

import { e1rm, readinessEMA, isPlateauV2 } from "./progression.js";
import { resolveArisePriors } from "./priors.js";

// ── Workout-note signals ───────────────────────────────────────────────
// Turns free-text notes into structured signals: sentiment (−1..1), tags, and
// whether the note implies a technique/ROM change (which invalidates PRs).
export function noteSignals(note, noteTags = [], { config = null } = {}){
  const cfg = resolveArisePriors(config).sessionQuality.noteWords;
  const tagText = Array.isArray(noteTags) ? noteTags.join(' ') : '';
  if((!note || !String(note).trim()) && !tagText.trim()) return { sentiment: 0, tags: [], techniqueChange: false };
  const text = `${String(note||'')} ${tagText}`.toLowerCase();
  const tags = [];
  for(const [word, tag] of Object.entries(cfg.negative)) if(text.includes(word)) tags.push("negative:"+tag);
  for(const [word, tag] of Object.entries(cfg.positive)) if(text.includes(word)) tags.push("positive:"+tag);
  const techniqueChange = cfg.techniqueWords.some(w=> text.includes(w));
  if(techniqueChange) tags.push("technique-change");
  const scored = tags.filter(t=> t.startsWith("positive") || t.startsWith("negative"));
  let sentiment = 0;
  for(const t of scored) sentiment += t.startsWith("positive") ? 1 : -1;
  sentiment = scored.length ? sentiment / scored.length : 0;
  return { sentiment: Math.round(sentiment*100)/100, tags: [...new Set(tags)], techniqueChange };
}

// ── Per-session quality classification ─────────────────────────────────
// 'bad' means underperformance (low readiness, failed reps, negative note, or
// near-failure effort on a day that should have been manageable). Effort alone
// (high RPE on a high-readiness day with a positive note) stays 'ok'.
export function sessionQuality(h, { readinessLog = [], config = null } = {}){
  const cfg = resolveArisePriors(config).sessionQuality.score;
  const rpes = [], failed = [];
  for(const b of h.blocks||[]) for(const s of b.sets||[]){
    const r = Number(String(s.reps).match(/\d+/)?.[0] || s.reps)||0;
    const rpe = s.rpe != null && String(s.rpe).trim() !== "" ? Number(s.rpe) : null;
    if(rpe != null && Number.isFinite(rpe)) rpes.push(rpe);
    if(r === 0 || s.failed) failed.push(true);
  }
  const avgRpe = rpes.length ? rpes.reduce((a,b)=> a+b,0)/rpes.length : null;
  const ns = noteSignals(h.note, h.noteTags, { config });
  const readinessScore = readinessFor(h.dateISO, readinessLog, config);
  const reasons = [];
  let score = cfg.start;
  if(readinessScore != null && readinessScore < cfg.readinessLow){ score -= cfg.lowReadinessPenalty; reasons.push(`low readiness ${readinessScore}`); }
  else if(readinessScore != null && readinessScore >= cfg.readinessHigh){ score += cfg.highReadinessBonus; reasons.push("high readiness"); }
  if(failed.length){ score -= cfg.failedPenalty; reasons.push("failed/missed reps"); }
  if(ns.sentiment < 0){ score -= cfg.negativeNotePenalty; reasons.push("negative note"); }
  if(avgRpe != null && avgRpe >= cfg.nearFailureRpe && readinessScore != null && readinessScore >= cfg.nearFailureReadinessMin){
    score -= cfg.nearFailurePenalty; reasons.push(`near-failure RPE ${avgRpe.toFixed(1)} despite good readiness`);
  } else if(avgRpe != null && avgRpe <= cfg.comfortableRpe && rpes.length >= cfg.comfortableMinObservations){
    score += cfg.comfortableBonus; reasons.push(`comfortable RPE ${avgRpe.toFixed(1)}`);
  }
  if(ns.sentiment > 0) score += cfg.positiveNoteBonus;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    quality: score >= cfg.goodCutoff ? "good" : score >= cfg.badCutoff ? "ok" : "bad",
    score, reasons, avgRpe: avgRpe != null ? Math.round(avgRpe*10)/10 : null,
    readinessScore, noteTags: ns.tags, techniqueChange: ns.techniqueChange,
  };
}

// Fraction of the last N sessions classified 'bad' (0..1).
export function badSessionRatio(history, { window = null, readinessLog = [], config = null } = {}){
  const cfg = resolveArisePriors(config).sessionQuality.badSession;
  const recent = (history||[]).slice(-(window == null ? cfg.window : window));
  if(!recent.length) return { ratio: 0, bad: 0, total: 0, quality: [] };
  const quality = recent.map(h=> sessionQuality(h, { readinessLog, config }));
  const bad = quality.filter(q=> q.quality === "bad").length;
  return { ratio: Math.round(bad/recent.length*100)/100, bad, total: recent.length, quality };
}

// Explains whether a rough patch is isolated or a repeatable recovery signal.
// This deliberately reports evidence separately from the recommendation so the
// user can disagree with the classification without losing the raw context.
export function badSessionAttribution(history, { window = null, readinessLog = [], config = null } = {}){
  const rootCfg = resolveArisePriors(config);
  const cfg = resolveArisePriors(config).sessionQuality.badSession;
  const summary = badSessionRatio(history, { window, readinessLog, config });
  if(!summary.total) return {
    ...summary, kind: 'insufficient', confidence: 'low', evidence: [],
    reason: 'No completed sessions to compare yet.',
    action: 'Log a few sessions with RPE and a short note before changing the plan.',
  };
  const lowReadiness = summary.quality.filter(q=> q.readinessScore != null && q.readinessScore < rootCfg.recovery.readinessLowEma).length;
  const highRpe = summary.quality.filter(q=> q.avgRpe != null && q.avgRpe >= rootCfg.recovery.highRpe).length;
  const negativeNotes = summary.quality.filter(q=> q.noteTags?.some(t=> t.startsWith('negative:'))).length;
  const evidence = [];
  if(summary.bad) evidence.push(`${summary.bad}/${summary.total} sessions classified as underperforming`);
  if(lowReadiness) evidence.push(`${lowReadiness} low-readiness day${lowReadiness===1?'':'s'}`);
  if(highRpe) evidence.push(`${highRpe} near-failure effort${highRpe===1?'':'s'}`);
  if(negativeNotes) evidence.push(`${negativeNotes} negative note${negativeNotes===1?'':'s'}`);
  if(summary.ratio >= cfg.ratio && summary.total >= cfg.minSessionsForCluster) return {
    ...summary, kind: 'cluster', confidence: summary.total >= cfg.window - 1 ? 'high' : 'medium', evidence,
    reason: 'The recent dip is a pattern, not just one bad day.',
    action: 'Recover first: keep the next session easy, then consider a short deload if the pattern continues.',
  };
  if(summary.bad) return {
    ...summary, kind: 'isolated', confidence: 'low', evidence,
    reason: 'There is a rough session, but not enough repeated evidence to change the plan.',
    action: 'Keep the next target conservative and re-check after sleep and recovery.',
  };
  return {
    ...summary, kind: 'stable', confidence: 'medium', evidence,
    reason: 'Recent sessions do not show a bad-session pattern.',
    action: 'Continue the current progression while logging RPE and notes.',
  };
}

// ── Plateau attribution ────────────────────────────────────────────────
// When strength is flat, is it a real plateau (consistent effort, decent
// readiness) or a run of bad sessions (low readiness / near-failure RPE /
// negative notes)? Different advice follows — recover first, then deload.
export function plateauAttribution(history, exerciseId, { readinessLog = [], window = null, config = null } = {}){
  const cfg = resolveArisePriors(config);
  const plateauCfg = cfg.sessionQuality.plateau;
  const progressionCfg = cfg.progression.plateau;
  const sessions = (history||[])
    .filter(h=> (h.blocks||[]).some(b=> b.exerciseId === exerciseId))
    .sort((a,b)=> a.dateISO.localeCompare(b.dateISO));
  if(sessions.length < plateauCfg.minimumSessions) return { kind: "insufficient", reason: `Need ${plateauCfg.minimumSessions}+ sessions for this exercise to judge (have ${sessions.length}).`, action: "Keep logging like-for-like sets.", confidence: "low", n: sessions.length };
  const last = sessions.slice(-(window == null ? plateauCfg.window : window));
  const logs = last.map(h=> bestSetFor(h, exerciseId)).filter(Boolean);
  if(logs.length < plateauCfg.minimumLoggedSets) return { kind: "insufficient", reason: `Need ${plateauCfg.minimumLoggedSets}+ logged sets for this exercise to judge.`, action: "Keep logging like-for-like sets.", confidence: "low", n: sessions.length };
  // Flatness trigger (same formula isPlateauV2 uses): <1.5% best-gain across
  // the window. Attribution below decides whether that flatness is fatigue or
  // a genuine ceiling — isPlateauV2's noise exemption would pre-empt that.
  const vals = logs.map(l=> e1rm(l.weightKg||0, l.reps) || l.reps);
  const recentHalfWindow = progressionCfg.recentHalfWindow;
  const bestRecent = Math.max(...vals.slice(-recentHalfWindow));
  const bestPrior = Math.max(...vals.slice(0,recentHalfWindow));
  const gain = (bestRecent - bestPrior)/Math.max(1,bestPrior);
  if(gain >= progressionCfg.gainPct) return { kind: "progressing", reason: "Still progressing.", action: "Keep the current progression while form and recovery hold.", confidence: "medium", n: sessions.length };
  const quality = last.map(h=> sessionQuality(h, { readinessLog, config }));
  const bad = quality.filter(q=> q.quality === "bad").length;
  const highRpe = quality.filter(q=> q.avgRpe != null && q.avgRpe >= cfg.recovery.highRpe).length;
  const lowReadiness = quality.filter(q=> q.readinessScore != null && q.readinessScore < cfg.recovery.readinessLowEma).length;
  if(bad >= Math.ceil(last.length*plateauCfg.badFraction) || (lowReadiness >= plateauCfg.minLowReadiness && highRpe >= plateauCfg.minHighRpe)){
    return { kind: "bad-sessions", reason: `Flat performance driven by poor sessions (${bad}/${last.length} bad, ${lowReadiness} low-readiness, ${highRpe} near-failure) — recover first; this isn't a real plateau yet.`, action: "Recover first, then reassess before changing the exercise or load target.", confidence: "high", n: sessions.length, bad, highRpe, lowReadiness };
  }
  if(highRpe >= plateauCfg.minHighRpe){
    return { kind: "mixed", reason: "Flat with several near-failure sessions — fatigue may be a factor, but effort was high. A short deload could help.", action: "Reduce effort or volume briefly, then test the same movement again.", confidence: "medium", n: sessions.length, bad, highRpe };
  }
  return { kind: "genuine", reason: "Flat with consistent effort and decent readiness — real plateau; consider a deload or exercise variation.", action: "Try a short deload or a closely matched variation, then rebuild gradually.", confidence: "medium", n: sessions.length, bad, highRpe };
}

// ── Deload trigger, one-day-safe ───────────────────────────────────────
// Same conservative signals as shouldDeload, plus:
//  - readiness only counts when the LOW is a sustained EMA trend, not one bad
//    day (a single dip is reported but never triggers by itself);
//  - a run of bad-quality sessions counts as its own fatigue signal.
export function deloadReadinessAssessment({ logs, recentRpes, weeklyVolumeTrend, readinessHistory, history, window = null, config = null } = {}){
  const cfg = resolveArisePriors(config);
  const recovery = cfg.recovery;
  const signals = [];
  let flags = 0;
  if((recentRpes||[]).filter(r=> Number(r) >= recovery.highRpe).length >= recovery.highRpeCount){ flags++; signals.push(`high RPE ≥${recovery.highRpe} twice`); }
  const plat = isPlateauV2(logs||[], { config: cfg });
  if(plat.isPlateau){ flags++; signals.push("plateau"); }
  if((weeklyVolumeTrend||[]).slice(-recovery.signalWindow).some(v=> v > recovery.volumeSpikeRatio)){ flags++; signals.push(`volume +${Math.round((recovery.volumeSpikeRatio-1)*100)}% spike`); }
  let oneDayDip = false;
  const nums = (readinessHistory||[]).map(r=> typeof r === "object" ? Number(r.score) : Number(r)).filter(n=> Number.isFinite(n));
  if(nums.length >= recovery.readinessHistoryMin){
    const ema = readinessEMA(nums, { config: cfg });
    const last = nums[nums.length-1];
    if(ema.value < recovery.readinessLowEma && last < recovery.readinessLowLatest && ema.confidence !== "low"){
      flags++; signals.push(`readiness sustained low (EMA ${ema.value})`);
    } else if(last < recovery.oneDayDip){
      oneDayDip = true; signals.push("readiness dipped today only — not a trend");
    }
  }
  if(history && history.length >= cfg.sessionQuality.badSession.minSessionsForCluster){
    const br = badSessionRatio(history, { window, readinessLog: null, config: cfg });
    if(br.ratio >= cfg.sessionQuality.badSession.ratio){ flags++; signals.push(`${br.bad}/${br.total} recent sessions bad quality`); }
  }
  const confidence = flags >= recovery.highConfidenceFlags ? "high" : flags >= recovery.mediumConfidenceFlags ? "medium" : "low";
  if(flags >= recovery.minimumFlags){
    return { yes: true, cut: recovery.deloadVolumeCut, reason: `Fatigue accumulating (${signals.join("; ")}) — cut volume ~${Math.round((1-recovery.deloadVolumeCut)*100)}% next week, keep loads moderate.`, signals, confidence, oneDayDip };
  }
  return { yes: false, signals, confidence, oneDayDip, reason: oneDayDip ? "One-day readiness dip only — no deload; re-check after recovery." : "Not enough fatigue signals for a deload." };
}

// ── Longitudinal PR scan ───────────────────────────────────────────────
// Walks all history in date order and classifies every new best e1RM:
//  - meaningful: ≥2% over the prior best AND no technique/ROM change in the note;
//  - flagged: technique/ROM change (invalid), sub-2% jitter, or set on a
//    low-readiness day (caution — could be a false PR from effort, not gains).
export function scanPRs(history, { readinessLog = [], config = null } = {}){
  const cfg = resolveArisePriors(config).sessionQuality.pr;
  const bestByEx = new Map();
  const prs = [];
  for(const h of (history||[]).slice().sort((a,b)=> a.dateISO.localeCompare(b.dateISO))){
    for(const b of h.blocks||[]){
      for(const s of b.sets||[]){
        const w = Number(s.weightKg)||0, r = Number(String(s.reps).match(/\d+/)?.[0] || s.reps)||0;
        if(!w || !r) continue;
        const e = e1rm(w, r);
        const st = bestByEx.get(b.exerciseId) || { best: 0 };
        if(e > st.best){
          if(st.best > 0){
            const ns = noteSignals(h.note, h.noteTags, { config });
            const flags = [];
            if(ns.techniqueChange) flags.push("technique/ROM change");
            const rd = readinessFor(h.dateISO, readinessLog, config);
            if(rd != null && rd < cfg.lowReadiness) flags.push(`low readiness ${rd}`);
            const meaningful = (e >= st.best*(1+cfg.meaningfulGainPct)) && e >= st.best + cfg.minimumAbsoluteKg && !ns.techniqueChange;
            prs.push({
              exerciseId: b.exerciseId, dateISO: h.dateISO,
              e1rm: Math.round(e), prevBest: Math.round(st.best),
              gainPct: Math.round((e/st.best - 1)*1000)/10,
              meaningful, flags, note: h.note || "",
            });
          }
          st.best = e; bestByEx.set(b.exerciseId, st);
        }
      }
    }
  }
  const flagged = prs.filter(p=> !p.meaningful);
  return {
    n: prs.length, flagged: flagged.length, prs,
    note: flagged.length ? `${flagged.length} of ${prs.length} records not like-for-like PRs — technique change, sub-2% jitter, or low-readiness days.` : `${prs.length} like-for-like PRs recorded.`,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────
// Best set (by e1RM) for an exercise inside a session — same log shape the
// progression engine uses (reps/weightKg/rpe).
function bestSetFor(h, exerciseId){
  let best = null;
  for(const b of h.blocks||[]) if(b.exerciseId === exerciseId) for(const s of b.sets||[]){
    const r = Number(String(s.reps).match(/\d+/)?.[0] || s.reps)||0;
    const w = Number(s.weightKg)||0;
    const rpe = s.rpe != null && String(s.rpe).trim() !== "" ? Number(s.rpe) : null;
    const e = e1rm(w, r) || r;
    if(!best || e > best.e) best = { e, reps: r, weightKg: w, rpe };
  }
  return best;
}

// ── Noisy session handling ───────────────────────────────────────────────
// A single odd session (short, long gap, different kit, missed sets, unusual
// drop, poor adherence, pain) should not drive a major programme change.
// This helper surfaces contextual flags; callers should require multiple
// observations before acting.
export function noisySessionContext(session, historyBefore = [], { readinessLog = [], schedule = null, config = null } = {}){
  const cfg = resolveArisePriors(config).programming.noisySession;
  const flags = [];
  const details = {};
  if(session?.durationMinutes != null && Number(session.durationMinutes) < cfg.shortDurationMinutes){
    flags.push('shortSession');
    details.shortSession = `${session.durationMinutes}min vs ${cfg.shortDurationMinutes}min threshold`;
  }
  if(session?.painDiscomfort || session?.noteTags?.includes('pain-discomfort') || (session?.blocks||[]).some(b=> (b.sets||[]).some(s=> s.pain))){
    flags.push('painDiscomfort');
    details.painDiscomfort = 'pain/discomfort flagged';
  }
  if(historyBefore && historyBefore.length){
    const last = historyBefore[historyBefore.length - 1];
    if(last?.dateISO && session?.dateISO){
      const gap = (Date.parse(`${session.dateISO}T00:00:00`) - Date.parse(`${last.dateISO}T00:00:00`)) / 86400000;
      if(Number.isFinite(gap) && gap >= cfg.longGapDays){
        flags.push('longGap');
        details.longGap = `${Math.round(gap)} days since last session`;
      }
    }
    const prevEquipment = Array.isArray(last?.equipmentSnapshot) ? [...last.equipmentSnapshot].sort().join('|') : '';
    const curEquipment = Array.isArray(session.equipmentSnapshot) ? [...session.equipmentSnapshot].sort().join('|') : '';
    if(cfg.equipmentChangeFlag && prevEquipment && curEquipment && prevEquipment !== curEquipment){
      flags.push('equipmentChange');
      details.equipmentChange = `${prevEquipment} → ${curEquipment}`;
    }
    const prevOrder = Array.isArray(last?.exerciseOrder) ? last.exerciseOrder.join(',') : (last?.blocks||[]).map(b=> b.exerciseId).join(',');
    const curOrder = Array.isArray(session.exerciseOrder) ? session.exerciseOrder.join(',') : (session.blocks||[]).map(b=> b.exerciseId).join(',');
    if(cfg.orderChangeFlag && prevOrder && curOrder && prevOrder !== curOrder){
      flags.push('changedOrder');
      details.changedOrder = 'exercise order differed from previous session';
    }
    // unusual performance: e1rm drop > threshold vs prior best for any exercise
    for(const block of session.blocks||[]){
      const best = bestSetFor(session, block.exerciseId);
      if(!best) continue;
      const priorBest = Math.max(0, ...historyBefore.flatMap(h=> (h.blocks||[]).filter(b=> b.exerciseId===block.exerciseId).flatMap(b=> (b.sets||[]).map(s=> {
        const w=Number(s.weightKg)||0, r=Number(String(s.reps).match(/\d+/)?.[0]||s.reps)||0;
        return w>0 && r>0 ? e1rm(w,r) : 0;
      }))));
      if(priorBest > 0){
        const drop = (priorBest - best.e) / priorBest;
        if(drop >= cfg.unusualDropPct){
          flags.push('unusualPerformance');
          details.unusualPerformance = `${block.exerciseId} e1rm ${Math.round(best.e)} vs prior ${Math.round(priorBest)} (${Math.round(drop*100)}% drop)`;
          break;
        }
      }
    }
  }
  const skipped = Number(session.skippedSetsCount) || (session.blocks||[]).reduce((n,b)=> n + (b.sets||[]).filter(s=> s.skipped || s.failed).length, 0);
  if(skipped >= cfg.missedSetsThreshold){
    flags.push('missedSets');
    details.missedSets = `${skipped} skipped/failed sets`;
  }
  // poor adherence period: adherence over last 5 planned sessions < threshold
  if(schedule && historyBefore){
    const planned = (schedule.sessions||[]).filter(s=> s.dateISO <= session.dateISO).length;
    const completed = historyBefore.filter(h=> h.dateISO <= session.dateISO).length;
    const adherence = planned ? completed / planned : 1;
    if(adherence < cfg.poorAdherenceThreshold && planned >= 3){
      flags.push('poorAdherence');
      details.poorAdherence = `adherence ${(adherence*100).toFixed(0)}% over last ${planned} planned sessions`;
    }
  }
  return { isNoisy: flags.length > 0, flags, details, requiresConfirmation: flags.length >= 1 };
}

export function shouldDeferProgressionForNoisy(history, exerciseId, { window = 3, config = null } = {}){
  const cfg = resolveArisePriors(config).programming.noisySession;
  const recent = (history||[]).slice(-window);
  if(recent.length < 2) return { defer: false, reason: 'Not enough history to judge noisy context' };
  const noisyCount = recent.filter(session=> noisySessionContext(session, history.slice(0, history.indexOf(session))).isNoisy).length;
  if(noisyCount >= 2) return { defer: true, reason: `${noisyCount}/${recent.length} recent sessions have noisy context — defer progression, collect a clean exposure` };
  return { defer: false, reason: 'Recent sessions are not consistently noisy' };
}

// Readiness for a date: exact match, else nearest prior log within 3 days.
function readinessFor(dateISO, readinessLog, config = null){
  const lookbackDays = resolveArisePriors(config).sessionQuality.readinessLookbackDays;
  const byDate = new Map((readinessLog||[]).map(r=> [r.dateISO, Number(r.score)]));
  if(byDate.has(dateISO)) return byDate.get(dateISO);
  const t = Date.parse(dateISO + "T00:00:00");
  if(!Number.isFinite(t)) return null;
  let best = null, bestD = lookbackDays*86400000;
  for(const [d, s] of byDate){
    const diff = t - Date.parse(d + "T00:00:00");
    if(diff >= 0 && diff <= bestD){ bestD = diff; best = s; }
  }
  return best;
}
