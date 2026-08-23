// fieldStudy.js — the real-world longitudinal study aggregator.
//
// Consumes CONSENTED participant export packages (standard Arise backups),
// resolves every measurement the project promised, pools them, and produces
// the headline comparison against baseline arms — but ONLY above pre-set
// sample gates. Below the gates it says so plainly. This module is how Arise
// eventually earns (or honestly withholds) a claim like:
//   "Across N real transitions, arise beat double progression by X% on
//    next-session targets with no increase in regression."

import { resolveArisePriors } from './priors.js';
import { parseImportFile } from './export.js';
import { evaluateLongitudinal } from './longitudinal.js';
import { runComparativeStudy, collectDeloadDecisions, validateDeloadDecisions } from './study.js';
import { recommendationAcceptanceStats, loggingTimeStats } from './telemetry.js';

const round = (v, d = 3)=> Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : null;
const pct = (part, whole)=> whole ? round(part / whole) : null;

function mondayKey(dateISO){
  const d = new Date(`${dateISO}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return null;
  const m = new Date(d); m.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return m.toISOString().slice(0, 10);
}

// ── Per-participant measurements ────────────────────────────────────────

export function measureParticipant({ code, store }, { config = null } = {}){
  const cfg = resolveArisePriors(config);
  const history = store.history || [];
  const schedule = store.activeSchedule || null;
  const events = Array.isArray(store.eventHistory) ? store.eventHistory : [];

  // Prospective ledger outcomes (consent captured at record time on-device).
  const evaluation = evaluateLongitudinal(store.evaluationLedger || [], { config });

  // Retrospective comparative replay (prior-only, all arms).
  const study = runComparativeStudy(history, { config });
  const o = study.overall || {};
  const countsFrom = seg => ({
    n: seg?.n || 0,
    met: Math.round((seg?.targetAchievementRate ?? 0) * (seg?.n || 0)),
    success: Math.round((seg?.progressionSuccessRate ?? 0) * (seg?.n || 0)),
    stagnation: Math.round((seg?.stagnationRate ?? 0) * (seg?.n || 0)),
    regression: Math.round((seg?.regressionRate ?? 0) * (seg?.n || 0)),
  });

  // Plateau false positives: holds followed by >= meaningfulGain progress.
  let plateauHolds = 0, plateauFalsePositives = 0;
  try{
    // Re-derive cheaply from the study rows embedded in overall noise stats is
    // not possible; use per-exercise segments where noisyHolds live.
    for(const exSeg of Object.values(study.byExercise || {})){
      const nh = exSeg?.arise?.noisyHolds || { n:0, followedByProgress:0 };
      plateauHolds += nh.n; plateauFalsePositives += nh.followedByProgress;
    }
  }catch{}

  // Adherence / completion / missed sessions.
  const sessions = schedule?.sessions || [];
  const histIds = new Set(history.map(h => h.id));
  const todayStr = new Date().toISOString().slice(0, 10);
  const done = sessions.filter(s => histIds.has(s.id) || s.status === 'done').length;
  const missed = sessions.filter(s => !(histIds.has(s.id) || s.status === 'done') && String(s.dateISO) < todayStr).length;

  // Deload outcomes from recorded programme adaptations.
  const deloadDecisions = collectDeloadDecisions([schedule]);
  const deloadOutcomes = validateDeloadDecisions(deloadDecisions, history, { config });

  // Programme changes overridden by the user: adapted/substituted blocks whose
  // exercise never appears in the corresponding completed session.
  let adaptedBlocks = 0, overridden = 0;
  for(const s of sessions){
    for(const b of (s.blocks || [])){
      if(!(b.adaptation || b.substitutionFrom)) continue;
      adaptedBlocks++;
      const performed = (history || []).find(h => h.id === s.id);
      if(!performed) continue; // scheduled but not yet done — cannot judge
      const usedElsewhere = (performed.blocks || []).some(pb => pb.exerciseId === b.exerciseId);
      if(!usedElsewhere) overridden++;
    }
  }

  return {
    code,
    weeksObserved: new Set(history.map(h => mondayKey(h.dateISO)).filter(Boolean)).size,
    sessionsLogged: history.length,
    acceptance: recommendationAcceptanceStats(events),
    loggingTime: loggingTimeStats(events),
    ledger: {
      resolved: evaluation.overall.resolved,
      progressionSuccessRate: evaluation.overall.progressionSuccessRate,
      targetAchievementRate: evaluation.overall.targetAchievementRate,
      regressionRate: evaluation.overall.regressionRate,
      stagnationRate: evaluation.overall.stagnationRate,
      adherenceRate: evaluation.overall.adherenceRate,
      conclusive: evaluation.overall.conclusive,
    },
    comparative: {
      transitions: o.arise?.n || 0,
      arise: countsFrom(o.arise),
      'double-progression': countsFrom(o['double-progression']),
      'linear-progression': countsFrom(o['linear-progression']),
      flat: countsFrom(o.flat),
      paired: study.pairedVsArise || {},
    },
    plateau: { holds: plateauHolds, falsePositives: plateauFalsePositives, falsePositiveRate: pct(plateauFalsePositives, plateauHolds) },
    adherence: { scheduled: sessions.length, done, missed, completionRate: pct(done, sessions.length) },
    deload: { decisions: deloadOutcomes.decisions, cutsObservedRate: deloadOutcomes.cutsObservedRate, normalisedWithinTwoWeeksRate: deloadOutcomes.normalisedWithinTwoWeeksRate },
    overrides: { adaptedBlocks, overridden, overrideRate: pct(overridden, adaptedBlocks) },
  };
}

// ── Pooling + headline ──────────────────────────────────────────────────

export function computeFieldStudy(participants, { config = null, minParticipants = 10, minTransitions = 1000 } = {}){
  const cfg = resolveArisePriors(config);
  void cfg;
  const measures = participants.map(p => measureParticipant(p, { config }));

  const sum = (arr, f)=> arr.reduce((acc, m)=> acc + (f(m) || 0), 0);
  const pooledArise = {
    n: sum(measures, m => m.comparative.arise.n),
    met: sum(measures, m => m.comparative.arise.met),
    success: sum(measures, m => m.comparative.arise.success),
    regression: sum(measures, m => m.comparative.arise.regression),
    stagnation: sum(measures, m => m.comparative.arise.stagnation),
  };
  const poolArm = name => ({
    n: sum(measures, m => m.comparative[name]?.n || 0),
    met: sum(measures, m => m.comparative[name]?.met || 0),
    success: sum(measures, m => m.comparative[name]?.success || 0),
    regression: sum(measures, m => m.comparative[name]?.regression || 0),
  });
  const pooled = { arise: pooledArise, 'double-progression': poolArm('double-progression'), 'linear-progression': poolArm('linear-progression'), flat: poolArm('flat') };

  const transitions = pooledArise.n;
  const gatesPassed = measures.length >= minParticipants && transitions >= minTransitions;

  const headline = {};
  for(const arm of ['double-progression','linear-progression','flat']){
    const base = pooled[arm];
    const targetDelta = base.met ? round((pooledArise.met - base.met) / base.met * 100, 1) : null;
    const successDelta = base.success ? round((pooledArise.success - base.success) / base.success * 100, 1) : null;
    const regressionAbsoluteDelta = base.n ? round((pooledArise.regression / pooledArise.n - base.regression / base.n) * 100, 2) : null;
    headline[arm] = { targetAchievementDeltaPct: targetDelta, successRateDeltaPct: successDelta, regressionDeltaPctPoints: regressionAbsoluteDelta };
  }

  const claimReady = gatesPassed
    && pooled['double-progression'].met > 0
    && headline['double-progression'].targetAchievementDeltaPct != null;

  const claim = claimReady
    ? {
        text: `Across ${transitions} real exercise transitions from ${measures.length} consenting participants, Arise produced ${headline['double-progression'].targetAchievementDeltaPct}% more successful next-session targets than standard double progression (regression ${(pooledArise.regression / Math.max(1, pooledArise.n) * 100).toFixed(1)}% vs ${(pooled['double-progression'].regression / Math.max(1, pooled['double-progression'].n) * 100).toFixed(1)}%).`,
        gates: { minParticipants, minTransitions },
      }
    : null;

  return {
    status: gatesPassed ? 'sufficient-evidence' : 'insufficient-evidence',
    gates: { minParticipants, minTransitions, participants: measures.length, transitions },
    totals: {
      sessionsLogged: sum(measures, m => m.sessionsLogged),
      ledgerResolvedPairs: sum(measures, m => m.ledger.resolved),
      missedSessions: sum(measures, m => m.adherence.missed),
      workoutsCompleted: sum(measures, m => m.adherence.done),
      deloadDecisions: sum(measures, m => m.deload.decisions),
      adaptedBlocksOverridden: sum(measures, m => m.overrides.overridden),
      medianLoggingTimeMs: medianOf(measures.map(m => m.loggingTime.medianMs).filter(Number.isFinite)),
      acceptanceRatePooled: acceptancePooled(measures),
      plateauFalsePositiveRate: pct(sum(measures, m => m.plateau.falsePositives), sum(measures, m => m.plateau.holds)),
      deloadNormalisedRate: avgNonNull(measures.map(m => m.deload.normalisedWithinTwoWeeksRate)),
    },
    pooled,
    headline,
    claim,
    participants: measures.map(m => ({ ...m, comparative: undefined })),
  };
}
function medianOf(values){ if(!values.length) return null; const s=[...values].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }
function avgNonNull(values){ const v=values.filter(x=>x!=null); return v.length? round(v.reduce((a,b)=>a+b,0)/v.length) : null; }
function acceptancePooled(measures){
  let shown=0, accepted=0;
  for(const m of measures){ shown+=m.acceptance.shown||0; accepted+=m.acceptance.accepted||0; }
  return pct(accepted, shown);
}

// ── Loading + markdown ──────────────────────────────────────────────────

export function loadParticipantFile(text, index){
  const parsed = parseImportFile(text);
  const code = parsed?.data?.participantCode || parsed?.participantCode || `P${String(index + 1).padStart(2,'0')}`;
  return { code, store: parsed };
}

export function renderFieldReport(result){
  const L = [];
  L.push(`# Real-world longitudinal study`);
  L.push('');
  L.push(`Status: **${result.status}** · participants ${result.gates.participants}/${result.gates.minParticipants} · transitions ${result.gates.transitions}/${result.gates.minTransitions}`);
  if(result.claim) { L.push(''); L.push(`> ${result.claim.text}`); }
  else { L.push(''); L.push('> Headline claim withheld until sample gates are met.'); }
  L.push('');
  L.push('| Metric | Value |');
  L.push('|---|---|');
  const t = result.totals;
  const rows = [
    ['Workouts completed', t.workoutsCompleted],
    ['Missed sessions', t.missedSessions],
    ['Ledger-resolved pairs', t.ledgerResolvedPairs],
    ['Recommendation acceptance', t.acceptanceRatePooled == null ? '—' : `${Math.round(t.acceptanceRatePooled*100)}%`],
    ['Median logging time', t.medianLoggingTimeMs == null ? '—' : `${t.medianLoggingTimeMs} ms`],
    ['Plateau false-positive rate', t.plateauFalsePositiveRate == null ? '—' : `${Math.round(t.plateauFalsePositiveRate*100)}%`],
    ['Deload decisions', t.deloadDecisions],
    ['Deload normalisation ≤2wks', t.deloadNormalisedRate == null ? '—' : `${Math.round(t.deloadNormalisedRate*100)}%`],
    ['Programme changes overridden', t.adaptedBlocksOverridden],
  ];
  for(const [k,v] of rows) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('## Pooled comparison (next-session targets)');
  L.push('');
  L.push('| Arm | n | met % | success % | regression % | Δtargets vs arise |');
  L.push('|---|---|---|---|---|---|');
  const p = result.pooled;
  const r = v => v.n ? `${Math.round(v.met/v.n*100)}%` : '—';
  const s = v => v.n ? `${Math.round(v.success/v.n*100)}%` : '—';
  const rg = v => v.n ? `${Math.round(v.regression/v.n*100)}%` : '—';
  for(const arm of Object.keys(p)){
    const h = result.headline[arm];
    L.push(`| ${arm}${arm==='arise'?' (engine)':''} | ${p[arm].n} | ${r(p[arm])} | ${s(p[arm])} | ${rg(p[arm])} | ${arm==='arise'?'—':`${h.targetAchievementDeltaPct ?? '—'}%`} |`);
  }
  L.push('');
  L.push('## Participants');
  L.push('');
  for(const m of result.participants){
    L.push(`- ${m.code}: ${m.sessionsLogged} sessions · ${m.weeksObserved}w · ledger ${m.ledger.resolved} pairs${m.ledger.conclusive?' (conclusive)':''} · adherence ${m.adherence.completionRate == null ? '—' : Math.round(m.adherence.completionRate*100)+'%'} · overrides ${m.overrides.overridden}/${m.overrides.adaptedBlocks}`);
  }
  L.push('');
  return L.join('\n');
}
