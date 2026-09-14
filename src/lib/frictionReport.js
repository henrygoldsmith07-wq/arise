// frictionReport.js — hierarchical real-user friction reporting.
//
// Reads ONLY value-free telemetry event arrays (the same stream
// loggingFrictionStats aggregates) and rolls them up:
//
//   interval → session → participant → cohort
//
// Why the hierarchy matters: a user who switches modes six times must not
// get 6× the statistical influence of another user. Raw interval metrics
// are reported, but every comparison that could move a conclusion uses
// participant-balanced values (one vote per participant), with medians and
// dispersion instead of naive pooled rates.
//
// Pure and deterministic. No collection, no UX, no storage — and no raw
// event streams, histories, or workout values ever appear in the output,
// only aggregates and counts.

import { loggingFrictionStats, modeIntervalFirstSets } from './telemetry.js';

// Prespecified sample-quality gates for cohort conclusions. Conservative by
// design: below any of these the report says "Insufficient real-user
// evidence" instead of ranking modes.
export const FRICTION_COHORT_GATES = Object.freeze({
  minParticipants: 5,
  minSessions: 10,
  minSessionsPerParticipant: 2, // median across participants
  minModeNetSets: 10, // net completed sets behind any ranked mode
});

function median(values){
  const list=(values||[]).filter(v=> Number.isFinite(v)).sort((a,b)=> a-b);
  if(!list.length) return null;
  const mid=Math.floor(list.length/2);
  return list.length % 2 ? list[mid] : (list[mid-1] + list[mid]) / 2;
}

function quartiles(values){
  const list=(values||[]).filter(v=> Number.isFinite(v)).sort((a,b)=> a-b);
  if(!list.length) return { q1: null, median: null, q3: null, min: null, max: null };
  const medianOf=(arr)=>{
    if(!arr.length) return null;
    const m=Math.floor(arr.length/2);
    return arr.length % 2 ? arr[m] : (arr[m-1] + arr[m]) / 2;
  };
  const mid=Math.floor(list.length/2);
  const lower=list.slice(0, list.length % 2 ? mid : mid);
  const upper=list.slice(list.length % 2 ? mid + 1 : mid);
  return { q1: medianOf(lower), median: medianOf(list), q3: medianOf(upper), min: list[0], max: list[list.length-1] };
}

function eventsOfSession(events, sessionId){
  return (events||[]).filter(e=> e && typeof e==='object' && e.sessionId === sessionId);
}

function hasDuration(e){
  return ['elapsedMs', 'durationMs', 'sessionElapsedMs'].some(k=> Number.isFinite(Number(e?.[k])) && Number(e[k]) >= 0);
}

// ── Session level ─────────────────────────────────────────────────────
// One session's aggregates. No raw events leave this function — only the
// shared summary shape plus three terminal flags.
export function summariseSession(sessionId, events){
  const own=eventsOfSession(events, sessionId);
  const stats=loggingFrictionStats(own);
  const completed=own.some(e=> e.type === 'session:complete');
  const abandoned=own.some(e=> e.type === 'session:abandon');
  return {
    sessionId,
    completed,
    abandoned,
    // Timing data is absent when timing consent is off (or legacy flows):
    // reported as missing, never reconstructed.
    timingObserved: own.some(hasDuration),
    netSets: stats.completedSets ?? 0,
    interactions: stats.interactions ?? 0,
    corrections: stats.undos ?? 0,
    modes: modesPresent(own),
    stats,
  };
}

function modesPresent(own){
  const modes=new Set();
  for(const e of own){
    if(e.mode === 'gym' || e.mode === 'standard' || e.mode === 'guided') modes.add(e.mode);
  }
  return [...modes].sort();
}

// ── Participant level ─────────────────────────────────────────────────
// One participant = one store/device/code. Sessions roll up two ways:
// totals (for denominators) and per-session values (for medians, so a
// marathon session cannot dominate a participant's own summary).
export function summariseParticipant(code, sessions){
  const list=(sessions||[]).filter(s=> s && typeof s.sessionId === 'string');
  const byId=new Map();
  for(const s of list){
    if(byId.has(s.sessionId)){
      const kept=byId.get(s.sessionId);
      kept.events.push(...(Array.isArray(s.events) ? s.events : []));
    }else{
      byId.set(s.sessionId, { sessionId: s.sessionId, events: [...(Array.isArray(s.events) ? s.events : [])] });
    }
  }
  const sessionSummaries=[...byId.values()].map(({ sessionId, events })=> summariseSession(sessionId, events));
  // Per-mode participant values from the participant's pooled events (one
  // value per mode per participant — the unit the cohort median consumes).
  const pooled=[];
  for(const { events } of byId.values()) pooled.push(...events);
  const modeStats=loggingFrictionStats(pooled).byMode;
  const intervalsByMode={};
  for(const { sessionId, events } of byId.values()){
    for(const { mode, ms } of modeIntervalFirstSets(eventsOfSession(events, sessionId))){
      (intervalsByMode[mode] ??= []).push(ms);
    }
  }
  const totals={
    sessions: sessionSummaries.length,
    completedSessions: sessionSummaries.filter(s=> s.completed).length,
    abandonedSessions: sessionSummaries.filter(s=> s.abandoned).length,
    timingObservedSessions: sessionSummaries.filter(s=> s.timingObserved).length,
    netSets: sessionSummaries.reduce((n, s)=> n + s.netSets, 0),
    interactions: sessionSummaries.reduce((n, s)=> n + s.interactions, 0),
    corrections: sessionSummaries.reduce((n, s)=> n + (s.stats.undos ?? 0), 0),
  };
  const modes={};
  for(const m of ['gym', 'standard', 'guided']){
    const st=modeStats[m] || {};
    modes[m]={
      sessions: st.sessions ?? 0,
      netSets: st.completedSets ?? 0,
      completionEvents: st.completionEvents ?? 0,
      actionsPerNetSet: st.actionsPerCompletedSet ?? null,
      correctionsPerSession: st.correctionsPerSession ?? null,
      intervalsMs: intervalsByMode[m] || [],
      intervalMedianMs: median(intervalsByMode[m] || []),
      loggingMsMedian: st.loggingMsMedian ?? null,
      swaps: { opens: st.swap?.opens ?? 0, commits: st.swap?.commits ?? 0, msMedian: st.swap?.msMedian ?? null },
      applyAll: { accepted: st.applyAll?.accepted ?? 0, viaApplyAll: st.applyAll?.viaApplyAll ?? 0 },
    };
  }
  return {
    code,
    sessionCount: sessionSummaries.length,
    sessions: sessionSummaries.map(s=> ({
      sessionId: s.sessionId, completed: s.completed, abandoned: s.abandoned,
      timingObserved: s.timingObserved, netSets: s.netSets, interactions: s.interactions,
      corrections: s.corrections, modes: s.modes,
    })),
    totals,
    actionsPerNetSet: totals.netSets ? Math.round(totals.interactions / totals.netSets * 100) / 100 : null,
    correctionsPerSession: totals.sessions ? Math.round(totals.corrections / totals.sessions * 100) / 100 : null,
    modes,
  };
}

// ── Cohort level ───────────────────────────────────────────────────────
// participants: [{ code, sessions: [{ sessionId, events }] }].
// Below any gate the report carries counts and reasons but ranks nothing.
export function summariseCohort(participants, { gates = FRICTION_COHORT_GATES, synthetic = null } = {}){
  const list=(participants||[]).filter(p=> p && typeof p.code === 'string');
  const summaries=list.map(p=> summariseParticipant(p.code, p.sessions));
  const totalSessions=summaries.reduce((n, p)=> n + p.sessionCount, 0);
  const sessionsPerParticipant=summaries.map(p=> p.sessionCount);
  const medianSessionsPerParticipant=median(sessionsPerParticipant) ?? 0;
  const reasons=[];
  if(summaries.length < (gates.minParticipants ?? 0)) reasons.push(`only ${summaries.length} participants (need ${gates.minParticipants}+)`);
  if(totalSessions < (gates.minSessions ?? 0)) reasons.push(`only ${totalSessions} sessions (need ${gates.minSessions}+)`);
  if(medianSessionsPerParticipant < (gates.minSessionsPerParticipant ?? 0)) reasons.push(`median ${medianSessionsPerParticipant} sessions per participant (need ${gates.minSessionsPerParticipant}+)`);
  const base={
    status: reasons.length ? 'insufficient' : 'sufficient',
    participants: summaries.length,
    sessions: totalSessions,
    medianSessionsPerParticipant,
    missingTimingRate: totalSessions ? Math.round(summaries.reduce((n, p)=> n + (p.sessionCount - p.totals.timingObservedSessions), 0) / totalSessions * 1000) / 1000 : null,
  };
  if(reasons.length){
    return { ...base, reasons, note: 'Insufficient real-user evidence — no mode ranking is made.' };
  }
  const modes={};
  for(const m of ['gym', 'standard', 'guided']){
    const withWork=summaries.filter(p=> (p.modes[m]?.netSets ?? 0) > 0);
    const withSessions=summaries.filter(p=> (p.modes[m]?.sessions ?? 0) > 0);
    const withIntervals=summaries.filter(p=> (p.modes[m]?.intervalsMs?.length ?? 0) > 0);
    const actionsValues=withWork.map(p=> p.modes[m].actionsPerNetSet).filter(v=> Number.isFinite(v));
    const corrValues=withSessions.map(p=> p.modes[m].correctionsPerSession).filter(v=> Number.isFinite(v));
    const netSets=withWork.reduce((n, p)=> n + p.modes[m].netSets, 0);
    modes[m]={
      participants: withWork.length,
      sessions: withSessions.reduce((n, p)=> n + p.modes[m].sessions, 0),
      netSets,
      actionsPerNetSet: { median: median(actionsValues), ...quartileSpread(actionsValues), n: actionsValues.length },
      correctionsPerSession: { median: median(corrValues), n: corrValues.length },
      firstSetMs: {
        // Raw pooled view (every interval equal weight) alongside the
        // participant-balanced view (one median per participant) — the
        // balanced view is the one conclusions may use.
        rawMedianMs: median(withIntervals.flatMap(p=> p.modes[m].intervalsMs)),
        balancedMedianMs: median(withIntervals.map(p=> median(p.modes[m].intervalsMs))),
        participants: withIntervals.length,
      },
      loggingMsMedian: median(withWork.map(p=> p.modes[m].loggingMsMedian).filter(v=> Number.isFinite(v))),
      swaps: {
        opens: withSessions.reduce((n, p)=> n + p.modes[m].swaps.opens, 0),
        commits: withSessions.reduce((n, p)=> n + p.modes[m].swaps.commits, 0),
      },
      applyAll: {
        accepted: withSessions.reduce((n, p)=> n + p.modes[m].applyAll.accepted, 0),
        viaApplyAll: withSessions.reduce((n, p)=> n + p.modes[m].applyAll.viaApplyAll, 0),
      },
      completionRate: totalSessions ? Math.round(summaries.reduce((n, p)=> n + p.totals.completedSessions, 0) / totalSessions * 1000) / 1000 : null,
      belowGate: netSets < (gates.minModeNetSets ?? 0),
    };
  }
  const comparison=synthetic != null ? compareWithSynthetic(modes, synthetic) : null;
  return { ...base, reasons: [], modes, comparison, note: 'Descriptive participant-balanced read — never a causal claim.' };
}

function quartileSpread(values){
  const q=quartiles(values);
  return { q1: q.q1, q3: q.q3, min: q.min, max: q.max };
}

// Directional agreement between observed mode costs and synthetic
// expectations. `synthetic` is { expectedCheapestMode, basis } as produced
// by syntheticModeExpectation() — observed cheapest = lowest median
// actions/set among gated modes. Agreement is descriptive only.
export function compareWithSynthetic(modes, synthetic){
  const ranked=Object.entries(modes || {})
    .filter(([, m])=> m && !m.belowGate && Number.isFinite(m.actionsPerNetSet?.median))
    .sort((a, b)=> a[1].actionsPerNetSet.median - b[1].actionsPerNetSet.median)
    .map(([mode])=> mode);
  if(!ranked.length || !synthetic?.expectedCheapestMode){
    return { verdict: 'insufficient', observedOrder: ranked, expectedCheapestMode: synthetic?.expectedCheapestMode ?? null };
  }
  const confirmed=ranked[0] === synthetic.expectedCheapestMode;
  return {
    verdict: confirmed ? 'direction-confirmed' : 'direction-contradicted',
    observedOrder: ranked,
    expectedCheapestMode: synthetic.expectedCheapestMode,
    basis: synthetic.basis || null,
    note: confirmed
      ? 'Direction confirmed, magnitude differs — descriptive only, never proof of superiority.'
      : 'Direction not confirmed — descriptive only, never proof of inferiority.',
  };
}
