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
import { parseImportFile, mergeStores } from './export.js';
import { isValidStudyParticipantId } from './studyIdentity.js';
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

  // Retrospective comparative replay (prior-only, all arms). The participant's
  // own readiness log feeds the byReadiness segmentation — the study engine
  // only accepts measurements logged at or before each workout, so future
  // entries cannot leak backwards.
  const study = runComparativeStudy(history, { config, readinessLog: store.readinessLog || [] });
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
    // Readiness-stratified arise performance (prior-only buckets from the
    // participant's own log). Kept alongside the pooled arms so the field
    // report can show whether targets hold on low-readiness days.
    readiness: {
      high: countsFrom(study.segments?.byReadiness?.high?.arise),
      low: countsFrom(study.segments?.byReadiness?.low?.arise),
      unknown: countsFrom(study.segments?.byReadiness?.unknown?.arise),
    },
    // PROSPECTIVE arm comparison from the consented on-device ledger: all arms
    // were frozen at record time and scored against the same realised session.
    // This is the real-training answer to "does adaptive programming decide
    // better?", as opposed to the retrospective replay in `comparative`.
    ledgerArms: {
      resolved: evaluation.overall.resolved,
      byArm: evaluation.byArm || {},
      pairedVsArise: evaluation.pairedVsArise || {},
      primaryComparison: evaluation.primaryComparison || null,
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
  // Repeated exports of the same person collapse into one participant BEFORE
  // any measurement, so neither the gate nor the pooled rates can be inflated
  // by export frequency.
  const { groups: deduped, unidentified: unidentifiedRaw } = groupParticipantsByIdentity(participants);
  const measures = deduped.map(p => measureParticipant(p, { config }));
  const unidentifiedMeasures = unidentifiedRaw.map(p => measureParticipant(p, { config }));
  const identifiedCount = measures.length;
  const unidentifiedCount = unidentifiedRaw.length;

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
  // Breadth is measured in IDENTIFIED PEOPLE, not file arrivals. Legacy
  // exports without a study id are reported separately and never satisfy the
  // participant gate — they cannot be proven distinct from each other.
  const gatesPassed = identifiedCount >= minParticipants && transitions >= minTransitions;

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
        text: `Across ${transitions} real exercise transitions from ${identifiedCount} consenting participants, Arise produced ${headline['double-progression'].targetAchievementDeltaPct}% more successful next-session targets than standard double progression (regression ${(pooledArise.regression / Math.max(1, pooledArise.n) * 100).toFixed(1)}% vs ${(pooled['double-progression'].regression / Math.max(1, pooled['double-progression'].n) * 100).toFixed(1)}%).`,
        gates: { minParticipants, minTransitions },
      }
    : null;

  const poolReadinessBucket = key => {
    let n = 0, met = 0;
    for(const m of measures){
      const b = m.readiness?.[key];
      n += b?.n || 0;
      met += b?.met || 0;
    }
    return { n, met, rate: n ? round(met / n) : null };
  };

  // Pooled prospective arm ledger: sum each arm's resolved pairs and met
  // counts across participants; conclusive once pooled n clears the gate.
  function poolLedgerArms(measures){
    const arms = {};
    for(const m of measures){
      for(const [arm, entry] of Object.entries(m.ledgerArms?.byArm || {})){
        if(!arms[arm]) arms[arm] = { n: 0, targetAchievementSum: 0, conclusive: false };
        arms[arm].n += entry.n || 0;
        arms[arm].targetAchievementSum += (entry.targetAchievementRate ?? 0) * (entry.n || 0);
      }
    }
    for(const arm of Object.keys(arms)){
      arms[arm].conclusive = arms[arm].n >= resolveArisePriors(config).longitudinal.minimumSegmentSamples;
      arms[arm].targetAchievementRate = arms[arm].n ? round(arms[arm].targetAchievementSum / arms[arm].n) : null;
    }
    const pairedVsArise = {};
    for(const m of measures){
      for(const [arm, p] of Object.entries(m.ledgerArms?.pairedVsArise || {})){
        if(!pairedVsArise[arm]) pairedVsArise[arm] = { pairs: 0, ariseWins: 0, armWins: 0, bothMetTarget: 0, neitherMetTarget: 0 };
        pairedVsArise[arm].pairs += p.pairs || 0;
        pairedVsArise[arm].ariseWins += p.ariseWins || 0;
        pairedVsArise[arm].armWins += p.armWins || 0;
        pairedVsArise[arm].bothMetTarget += p.bothMetTarget || 0;
        pairedVsArise[arm].neitherMetTarget += p.neitherMetTarget || 0;
      }
    }
    for(const arm of Object.keys(pairedVsArise)){
      const p = pairedVsArise[arm];
      p.conclusive = p.pairs >= resolveArisePriors(config).longitudinal.minimumSegmentSamples;
      p.ariseWinRate = p.pairs ? round(p.ariseWins / p.pairs) : null;
    }
    return { arms, pairedVsArise };
  }

  return {
    status: gatesPassed ? 'sufficient-evidence' : 'insufficient-evidence',
    gates: {
      minParticipants,
      minTransitions,
      participants: identifiedCount,
      transitions,
      unidentifiedExports: unidentifiedCount,
    },
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
      readinessBuckets: { high: poolReadinessBucket('high'), low: poolReadinessBucket('low'), unknown: poolReadinessBucket('unknown') },
      ledgerArms: poolLedgerArms(measures),
    },
    pooled,
    headline,
    claim,
    protocol: buildStudyProtocol({ config }),
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

// FROZEN study protocol: policy identity, inclusion criteria, outcomes and
// analysis are declared up front so an export can be analysed independently
// without post-hoc choices. Deterministic — no timestamps inside.
export function buildStudyProtocol({ config = null } = {}){
  const cfg = resolveArisePriors(config);
  return {
    protocolVersion: 1,
    policyId: 'arise-engine',
    enginePriorsVersion: cfg.version,
    progressionModelVersion: cfg.progressionModel.version,
    arms: ['arise', 'double-progression', 'linear-progression', 'fixed-rules', 'flat'],
    inclusionCriteria: [
      'consented export (preferences.telemetryEnabled)',
      'ledger record resolved by a logged session at/after its due date',
      'arm snapshots clamped to the due date (prior-only)',
    ],
    outcomes: ['targetAchievementRate','progressionSuccessRate','stallRate','regressionRate','conservatismRate','meanLoadErrorKg','pairedAriseWinRate','failedSetRate','completedVolumeKg'],
    statistics: `Wilson 95% CIs on proportions; minimumSegmentSamples gate (${cfg.longitudinal.minimumSegmentSamples}); paired win counts on identical transitions; subgroup dimensions marked exploratory`,
    analysis: 'Intention-to-treat on realised sessions. All arms receive the same prior-only information and are scored against the same realised performance — comparisons measure decision quality, not counterfactual body outcomes. Absence of a significant difference is NOT evidence of equivalence.',
  };
}

export function loadParticipantFile(text, index){
  const parsed = parseImportFile(text);
  // Identity comes ONLY from the pseudonymous study id inside the package.
  // Filename order must never become identity: repeated weekly exports from
  // one person would otherwise look like several participants.
  const studyParticipantId = isValidStudyParticipantId(parsed?.studyParticipantId) ? parsed.studyParticipantId : null;
  const code = studyParticipantId ? studyParticipantId.slice(0, 8) : `anon-${String(index + 1).padStart(2, '0')}`;
  return { code, studyParticipantId, store: parsed };
}

// Fold every export carrying the same studyParticipantId into ONE participant.
// Repeated weekly exports are cumulative snapshots of the same training log,
// so naive concatenation would double-count transitions; mergeStores unions
// history/events/readiness by their own ids instead.
function groupParticipantsByIdentity(participants){
  const identified = new Map();
  const unidentified = [];
  for(const p of participants || []){
    const id = p?.studyParticipantId ?? (isValidStudyParticipantId(p?.store?.studyParticipantId) ? p.store.studyParticipantId : null);
    if(!id){ unidentified.push(p); continue; }
    if(!identified.has(id)) identified.set(id, p);
    else{
      const kept = identified.get(id);
      identified.set(id, { ...kept, store: mergeStores(kept.store, p.store, 'merge') });
    }
  }
  return { groups: [...identified.values()], unidentified };
}

export function renderFieldReport(result){
  const L = [];
  L.push(`# Real-world longitudinal study`);
  L.push('');
  L.push(`Status: **${result.status}** · participants ${result.gates.participants}/${result.gates.minParticipants} · transitions ${result.gates.transitions}/${result.gates.minTransitions}`);
  if(result.gates.unidentifiedExports){
    L.push('');
    L.push(`${result.gates.unidentifiedExports} export${result.gates.unidentifiedExports === 1 ? '' : 's'} without a study id — counted in nothing; they cannot be proven distinct people. Re-export from the updated app to be identified.`);
  }
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
  const rb = t.readinessBuckets || {};
  const bucketCell = b => b && b.n ? `${b.met}/${b.n} targets (${Math.round((b.rate ?? 0) * 100)}%)` : '—';
  rows.push(
    ['Arise targets · high-readiness days', bucketCell(rb.high)],
    ['Arise targets · low-readiness days', bucketCell(rb.low)],
    ['Arise targets · readiness unknown', bucketCell(rb.unknown)],
  );
  // Prospective arm ledger (real training; all arms frozen at record time).
  const la = t.ledgerArms || { arms: {}, pairedVsArise: {} };
  const armNames = Object.keys(la.arms).sort();
  for(const arm of armNames){
    const a = la.arms[arm];
    const paired = la.pairedVsArise[arm];
    let cell = '—';
    if(a.n){
      cell = `${Math.round((a.targetAchievementRate ?? 0) * 100)}% of ${a.n}`;
      if(paired?.pairs) cell += ` · arise wins ${paired.ariseWins}/${paired.pairs}`;
      cell += a.conclusive ? '' : ' (below gate)';
    }
    rows.push([`Ledger arm: ${arm}`, cell]);
  }
  // PRIMARY randomised comparison (assigned arms, intention-to-treat).
  const prim = t.primaryComparison;
  if(prim){
    const cellFor = a => a.n
      ? `${Math.round((a.targetAchievementRate ?? 0) * 100)}% of ${a.n} transitions · ${a.participants} participant${a.participants === 1 ? '' : 's'}${a.conclusive ? '' : ' (below gate)'}`
      : '—';
    const diff = prim.difference || {};
    const boot = diff.clusteredBootstrap;
    let diffCell = '—';
    if(diff.metRateDelta != null && boot?.mean != null){
      diffCell = `${diff.metRateDelta > 0 ? '+' : ''}${Math.round(diff.metRateDelta * 100)}pp arise−DP`;
      if(boot.low != null) diffCell += ` · clustered 95% CI [${Math.round(boot.low*100)}%, ${Math.round(boot.high*100)}%] over ${boot.participants} participants`;
      else diffCell += ` · ${boot.participants} participant${boot.participants === 1 ? '' : 's'} — clustered CI needs ≥2`;
    }
    rows.push(
      ['PRIMARY · Arise-assigned', cellFor(prim.arise)],
      ['PRIMARY · Double-progression-assigned', cellFor(prim['double-progression'])],
      ['PRIMARY · Met-rate difference', diffCell],
      ['PRIMARY · Adherence', prim.adherence.followedRate != null ? `${Math.round(prim.adherence.followedRate*100)}% followed` + (prim.adherence.unknownAdherence ? ` (${prim.adherence.unknownAdherence} unknown)` : '') : '—'],
    );
  } else {
    rows.push(['PRIMARY randomised comparison', 'not yet collected']);
  }
  for(const [k,v] of rows) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('## Pooled comparison — retrospective replay (recommendation-outcome agreement, not causal effects)');
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
  const proto = result.protocol || {};
  if(proto.protocolVersion != null){
    L.push('## Study protocol (frozen)');
    L.push('');
    L.push(`- Protocol v${proto.protocolVersion} · policy ${proto.policyId} (priors v${proto.enginePriorsVersion}, model v${proto.progressionModelVersion})`);
    L.push(`- Arms: ${proto.arms.join(', ')}`);
    L.push(`- Outcomes: ${proto.outcomes.join(', ')}`);
    L.push(`- Statistics: ${proto.statistics}`);
    L.push(`- Inclusion: ${proto.inclusionCriteria.join('; ')}`);
    L.push(`- Analysis: ${proto.analysis}`);
    L.push('');
  }
  return L.join('\n');
}
