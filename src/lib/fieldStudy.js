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
import { prospectiveFieldComparison, isGradeableOutcome, prospectiveTransitionKey, clusteredBootstrapDifference, SHADOW_EVIDENCE_LABEL } from './evaluation.js';
import { isProspectiveRecord, isProspectiveRecommendation, isResolvedProspectiveEvidence, bestSetOfBlock, participantOf, participantOfStore } from './longitudinalCore.js';
import { enrollmentAudit } from './studyEnrollment.js';
import { runComparativeStudy, collectDeloadDecisions, validateDeloadDecisions } from './study.js';
import { recommendationAcceptanceStats, loggingTimeStats } from './telemetry.js';
import { isValidAssignedStudyTransition, evaluateStudyReadiness, STUDY_GATES } from './studyReadiness.js';

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

// ── Pooled prospective comparison (gradeable, repeated-user-aware) ──────
// One prospective ledger row is one row; one USER is one unit of evidence.
// Rows are tagged with their participant code, then scored once through
// prospectiveFieldComparison, which groups by user, pairs arise against each
// baseline on identical gradeable transitions, and reports a mean-of-users
// effect with an observed user band. Unidentified exports cannot be proven
// distinct people, so they are reported separately and never feed the breadth
// gate. Retrospective replays are never an input here — this path only ever
// sees first-visible ledger rows.
function nextExposureDelta(history, exerciseId, afterISO, excludeSessionId){
  const ordered = [...(history || [])].sort((a, b)=> String(a?.dateISO || '').localeCompare(String(b?.dateISO || '')));
  for(const session of ordered){
    if(excludeSessionId && session?.id === excludeSessionId) continue;
    if(String(session?.dateISO || '') <= String(afterISO || '')) continue;
    for(const block of session?.blocks || []){
      if(block?.exerciseId !== exerciseId) continue;
      const best = bestSetOfBlock(block);
      if(best && best.reps > 0) return { e1rm: round(best.score, 2), dateISO: session.dateISO };
    }
  }
  return null;
}

export function pooledProspectiveComparison(participants, { config = null } = {}){
  const { groups: deduped, unidentified } = groupParticipantsByIdentity(participants);
  // Consent is enforced HERE, not assumed upstream: a participant package
  // whose preferences do not show measurement consent contributes zero rows
  // and is counted honestly instead of silently vanishing.
  const consented = deduped.filter(p=> p?.store?.preferences?.telemetryEnabled === true);
  const unconsentedExports = deduped.length - consented.length;
  const rows = [];
  const historiesByCode = {};
  for(const p of consented){
    // Canonical store-scoped identity: one STORE is one participant. Rows
    // without their own id cluster under the store's identity, so store
    // boundaries — the only honest independence unit in pooled data — stay
    // distinct while rows within a store always cluster together.
    const code = participantOfStore(p.store, p.code || 'store-anonymous');
    historiesByCode[code] = p.store?.history || [];
    for(const row of p.store?.evaluationLedger || []){
      rows.push({ ...row, participantId: row.participantId ?? code });
    }
  }
  const comparison = prospectiveFieldComparison(rows, { config });
  // Next-exposure performance: the best-set e1RM on the same exercise at the
  // user's next logged session strictly after the resolved one, per gradeable row.
  let nextN = 0, nextSum = 0;
  const nextPerExercise = {};
  const seenNext = new Set();
  for(const row of rows){
    if(!row?.outcome || !isResolvedProspectiveEvidence(row) || !isGradeableOutcome(row, resolveArisePriors(config).longitudinal.outcomeLabels)) continue;
    // Same de-duplication as the comparison itself: a re-recorded transition
    // contributes one next-exposure delta, never two.
    const key = prospectiveTransitionKey(row);
    if(seenNext.has(key)) continue;
    seenNext.add(key);
    const history = historiesByCode[row.participantId ?? 'anonymous-local'] || [];
    const next = nextExposureDelta(history, row.exerciseId, row.outcome.dateISO, row.outcome.sessionId);
    if(next == null || !(next.e1rm > 0) || !(row.outcome.e1rm > 0)) continue;
    const delta = (next.e1rm - row.outcome.e1rm) / row.outcome.e1rm;
    if(!Number.isFinite(delta)) continue;
    nextN++;
    nextSum += delta;
    const ex = row.exerciseId;
    if(!nextPerExercise[ex]) nextPerExercise[ex] = { n: 0, sum: 0 };
    nextPerExercise[ex].n++;
    nextPerExercise[ex].sum += delta;
  }
  const nextExposure = {
    n: nextN,
    meanDeltaPct: nextN ? round(nextSum / nextN, 4) : null,
    byExercise: Object.fromEntries(Object.entries(nextPerExercise).map(([ex, e])=> [ex, { n: e.n, meanDeltaPct: round(e.sum / e.n, 4) }])),
  };
  return {
    ...comparison,
    users: comparison.users,
    unidentifiedExports: unidentified.length,
    unconsentedExports,
    nextExposure,
    note: `${comparison.note} Pooled across ${comparison.users} identified consenting ${comparison.users === 1 ? 'user' : 'users'} (${unidentified.length} unidentified export${unidentified.length === 1 ? '' : 's'} excluded from breadth; ${unconsentedExports} unconsented export${unconsentedExports === 1 ? '' : 's'} excluded entirely).`,
  };
}

// ── Pooled assigned-arm comparison (the causal pooled read) ───────────
// Aggregates ONLY genuine assigned-arm prospective outcomes: live-engine
// provenance on both sides, an assigned arm in the primary pair
// (arise/double-progression), and a scored assignedMet. ITT is preserved —
// compliance and follow-through never filter. Participant is the clustering
// unit: pooled rates sum transitions, uncertainty resamples participants via
// the same clustered bootstrap as the single-device primary. Conclusions stay
// descriptive until the prespecified participant/transition gates are met.
// Pure and deterministic.
// Aggregates ONLY genuine assigned-arm prospective outcomes: live-engine
// provenance on both sides, resolved, assigned to a primary arm, with a
// graded assignedMet. The result is descriptive until the prespecified
// participant/transition gates are met.
//
// CONTRIBUTOR DEFINITION (single source of truth — cohortOps and
// computeFieldStudy read the counts exposed here): a participant contributes
// when they are identified (a real study id, grouped before this call),
// consented (telemetry on, enforced below), and produce at least one row that
// satisfies the canonical predicate (studyReadiness.isValidAssignedStudy
// Transition) — i.e. at least one valid resolved assigned-arm transition.
// Enrolled-but-empty participants never satisfy the breadth gate: no usable
// assigned evidence → no participant credit.
const ASSIGNED_PRIMARY_ARMS = ['arise', 'double-progression'];

export function pooledAssignedComparison(participants, { config = null, minParticipants = 10, minTransitions = 1000 } = {}){
  const { groups: deduped, unidentified } = groupParticipantsByIdentity(participants);
  const consented = deduped.filter(p=> p?.store?.preferences?.telemetryEnabled === true);
  const unconsentedExports = deduped.length - consented.length;
  const rows = [];
  const historiesByCode = {};
  for(const p of consented){
    const code = participantOfStore(p.store, p.code || 'store-anonymous');
    historiesByCode[code] = p.store?.history || [];
    for(const row of p.store?.evaluationLedger || []){
      rows.push({ ...row, participantId: row.participantId ?? code });
    }
  }
  const excluded = { nonProspective: 0, unprovenOutcome: 0, unassigned: 0, noAssignedMet: 0 };
  const seen = new Set();
  const assigned = [];
  let duplicatePairs = 0;
  let openRows = 0;
  for(const row of rows){
    // THE canonical predicate (studyReadiness.isValidAssignedStudyTransition)
    // decides validity; the buckets only label WHY a row was rejected, for
    // reporting. No filter logic lives here any more.
    if(!(row && row.recommendation) || !isProspectiveRecommendation(row)){ excluded.nonProspective++; continue; }
    // Live open recommendations are prospective and awaiting — counted under
    // `open`, never under an exclusion bucket.
    if(!row.outcome){ openRows++; continue; }
    if(!isValidAssignedStudyTransition(row)){
      if(!isProspectiveRecord(row)) excluded.unprovenOutcome++;
      else if(!ASSIGNED_PRIMARY_ARMS.includes(row.assignedArm)) excluded.unassigned++;
      else excluded.noAssignedMet++;
      continue;
    }
    const key = `${prospectiveTransitionKey(row)}::${row.assignedArm}`;
    if(seen.has(key)){ duplicatePairs++; continue; }
    seen.add(key);
    assigned.push(row);
  }
  // Participant-clustered rollup: per-participant per-arm wins, pooled sums.
  const perParticipant = new Map();
  const contributorArms = new Map(); // participant → Set<arm> with ≥1 valid resolved transition
  for(const row of assigned){
    const code = participantOf(row);
    if(!contributorArms.has(code)) contributorArms.set(code, new Set());
    contributorArms.get(code).add(row.assignedArm);
    if(!perParticipant.has(code)) perParticipant.set(code, { arise: { n: 0, met: 0 }, dp: { n: 0, met: 0 } });
    const buckets = perParticipant.get(code);
    const bucket = row.assignedArm === 'double-progression' ? buckets.dp : buckets.arise;
    bucket.n++;
    if(row.outcome.assignedMet === true) bucket.met++;
  }
  const sumBucket = (kind)=> {
    let n = 0, met = 0, users = 0;
    for(const e of perParticipant.values()){ n += e[kind].n; met += e[kind].met; if(e[kind].n) users++; }
    return { n, met, users };
  };
  const ariseTot = sumBucket('arise');
  const dpTot = sumBucket('dp');
  const rate = ({ n, met })=> n ? round(met / n, 3) : null;
  const ariseRate = rate(ariseTot);
  const dpRate = rate(dpTot);
  const metRateDelta = ariseRate != null && dpRate != null ? round(ariseRate - dpRate, 3) : null;
  const bootPairs = assigned.map(r=> ({ participant: participantOf(r), group: r.assignedArm, met: r.outcome.assignedMet === true }));
  const clustered = clusteredBootstrapDifference(bootPairs, { seed: 'pooled-assigned-diff-v1' });
  const minimum = Math.max(1, Number(resolveArisePriors(config).longitudinal.minimumSegmentSamples) || 1);
  const ariseConclusive = ariseTot.n >= minimum;
  const dpConclusive = dpTot.n >= minimum;
  const participantCount = perParticipant.size;
  const transitions = assigned.length;
  let contributorsArise = 0;
  let contributorsDoubleProgression = 0;
  for(const arms of contributorArms.values()){
    if(arms.has('arise')) contributorsArise++;
    if(arms.has('double-progression')) contributorsDoubleProgression++;
  }
  const contributorCounts = {
    total: participantCount,
    arise: contributorsArise,
    'double-progression': contributorsDoubleProgression,
  };
  // THE canonical readiness result (studyReadiness.evaluateStudyReadiness):
  // cohort.gate.eligible, fieldStudy status, assigned.gates.sufficient and
  // claim readiness all derive from this single evaluation, so no two
  // surfaces can disagree. Metric-level conclusiveness (minimumSegment
  // Samples) never enters it — see the metricGate label below.
  const readiness = evaluateStudyReadiness(
    {
      transitionsArise: ariseTot.n,
      transitionsDoubleProgression: dpTot.n,
      transitionsTotal: transitions,
      contributors: contributorCounts,
    },
    // Canonical per-arm gate (400); evaluateStudyReadiness clamps it to
    // floor(minTransitions/2) when callers override the depth gate downward.
    { minContributors: minParticipants, minTransitions, minTransitionsPerArm: STUDY_GATES.minTransitionsPerArm },
  );
  // Reasons = THE canonical readiness reasons — nothing else. The per-arm
  // metric sample gate (priors' minimumSegmentSamples) is a per-METRIC
  // conclusiveness label below (arm.conclusive / gates.metricGate): it can
  // qualify an individual rate but must never change assigned.gates.sufficient,
  // fieldStudy status, claim eligibility or cohort readiness.
  const reasons = readiness.reasons;
  const sufficient = readiness.ready;
  const metricGate = {
    minSegmentSamples: minimum,
    ariseConclusive,
    dpConclusive,
    note: ariseConclusive && dpConclusive
      ? null
      : `an arm's rate is below the metric sample gate (${minimum}+ per arm) — that rate stays descriptive until it clears`,
  };
  // Next-exposure performance BY ASSIGNED TREATMENT: the best-set e1RM delta
  // at the user's next logged session after the resolved one, split by the
  // arm they trained under. Reported with n — thin arms stay descriptive.
  const nextSeen = new Set();
  const nextByArm = { arise: { n: 0, sum: 0 }, 'double-progression': { n: 0, sum: 0 } };
  for(const row of assigned){
    const key = `${prospectiveTransitionKey(row)}::${row.assignedArm}`;
    if(nextSeen.has(key)) continue;
    nextSeen.add(key);
    const history = historiesByCode[row.participantId ?? 'anonymous-local'] || [];
    const next = nextExposureDelta(history, row.exerciseId, row.outcome.dateISO, row.outcome.sessionId);
    if(next == null || !(next.e1rm > 0) || !(row.outcome.e1rm > 0)) continue;
    const delta = (next.e1rm - row.outcome.e1rm) / row.outcome.e1rm;
    if(!Number.isFinite(delta)) continue;
    const bucket = row.assignedArm === 'double-progression' ? nextByArm['double-progression'] : nextByArm.arise;
    bucket.n++;
    bucket.sum += delta;
  }
  const nextExposureByArm = Object.fromEntries(Object.entries(nextByArm).map(([arm, e])=> [arm, { n: e.n, meanDeltaPct: e.n ? round(e.sum / e.n, 4) : null }]));
  const followed = assigned.filter(r=> r.outcome.followed === true).length;
  return {
    causal: true,
    evidenceKind: 'assigned-arm-pooled',
    participants: participantCount,
    contributors: contributorCounts,
    transitions,
    open: openRows,
    arise: { key: 'arise', n: ariseTot.n, metCount: ariseTot.met, participants: ariseTot.users, targetAchievementRate: ariseRate, conclusive: ariseConclusive },
    'double-progression': { key: 'double-progression', n: dpTot.n, metCount: dpTot.met, participants: dpTot.users, targetAchievementRate: dpRate, conclusive: dpConclusive },
    difference: { metRateDelta, clusteredBootstrap: clustered },
    adherence: {
      followedRate: transitions ? round(followed / transitions, 3) : null,
      unknownAdherence: assigned.filter(r=> r.outcome.followed == null).length,
      userOverrides: assigned.filter(r=> r.outcome.userOverride).length,
    },
    nextExposureByArm,
    gates: { minParticipants, minTransitions, perArmMinimum: readiness.gates.minTransitionsPerArm, sufficient, reasons, readiness, metricGate },
    maturity: sufficient ? 'descriptive' : (transitions > 0 ? 'early' : 'insufficient'),
    excluded: { ...excluded, duplicatePairs, unidentifiedExports: unidentified.length, unconsentedExports },
    duplicatePairs,
    note: sufficient
      ? `Descriptive pooled read from ${transitions} assigned transitions across ${participantCount} participants: arise-assigned targets met ${ariseRate == null ? '—' : `${Math.round(ariseRate * 100)}%`} vs double-progression ${dpRate == null ? '—' : `${Math.round(dpRate * 100)}%`}. Descriptive only — never proof of superiority.`
      : `Pooled assigned evidence is insufficient (${reasons.join('; ')}). No comparison is claimed; shadow "would have fit" analyses are never substituted.`,
  };
}
// ── Local field-study status (opt-in, descriptive, never gamified) ─────────
// What this device is contributing to prospective evidence: enrollment state,
// gradeable samples, exercises covered, maturity, and exactly what was
// excluded and why. Static facts only — no streaks, goals, or pressure copy.
export function fieldStudyStatus({ store = {}, ledger = null, config = null } = {}){
  const enrollment = store?.studyEnrollment ?? null;
  const consented = store?.preferences?.telemetryEnabled === true;
  const rows = Array.isArray(ledger) ? ledger : [];
  // Assigned-arm primary on this device's own ledger: what was trained under
  // each arm, ITT, with the same conclusive gate as Coaching evidence.
  const primary = evaluateLongitudinal(rows, { config }).primaryComparison;
  const reasons = [];
  if(primary.transitions < 1) reasons.push('no assigned-arm transitions yet');
  else{
    if(primary.participants < 2) reasons.push('only 1 participant on this device (need 2+ for clustered uncertainty)');
    if(!primary.arise.conclusive || !primary['double-progression'].conclusive) reasons.push('an assigned arm is below the sample gate');
  }
  const maturity = primary.transitions < 1 ? 'insufficient' : primary.conclusive ? 'descriptive' : 'early';
  const audit = enrollment ? enrollmentAudit(enrollment) : { ok: false, reason: 'no enrollment' };
  return {
    mode: enrollment ? 'enrolled' : consented ? 'observing' : 'off',
    enrolled: !!enrollment,
    enrollmentOk: audit.ok === true,
    enrolledAtISO: enrollment?.enrolledAtISO ?? null,
    samples: { assigned: primary.transitions, arise: primary.arise.n, doubleProgression: primary['double-progression'].n, users: primary.participants },
    maturity,
    reasons,
    difference: primary.difference,
    note: enrollment
      ? 'Enrolled under a pseudonymous study id. Only assigned-arm recommendation→outcome pairs count toward effectiveness; everything else is excluded, never silently dropped.'
      : consented
        ? 'Observing: local measurements are on but this device has no study enrollment, so nothing here leaves the device as study evidence.'
        : 'Local measurements are off — no prospective evidence is being collected on this device.',
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

  // The causal pooled read: genuine assigned-arm prospective outcomes only,
  // participant-clustered. This — never the retrospective replay above —
  // drives the gates and the headline claim.
  const assigned = pooledAssignedComparison(participants, { config, minParticipants, minTransitions });
  const transitions = assigned.transitions;
  const contributors = assigned.contributors;
  // Physically THE SAME canonical readiness object pooledAssignedComparison
  // evaluated — not a recomputation. Status, claim readiness, cohort gate and
  // assigned gates all consume this one object, so they cannot disagree, even
  // when exploratory thresholds are overridden.
  const readiness = assigned.gates.readiness;
  const gatesPassed = readiness.ready;

  const headline = {};
  for(const arm of ['double-progression','linear-progression','flat']){
    const base = pooled[arm];
    const targetDelta = base.met ? round((pooledArise.met - base.met) / base.met * 100, 1) : null;
    const successDelta = base.success ? round((pooledArise.success - base.success) / base.success * 100, 1) : null;
    const regressionAbsoluteDelta = base.n ? round((pooledArise.regression / pooledArise.n - base.regression / base.n) * 100, 2) : null;
    headline[arm] = { targetAchievementDeltaPct: targetDelta, successRateDeltaPct: successDelta, regressionDeltaPctPoints: regressionAbsoluteDelta, agreementOnly: true };
  }

  // Headline claim from ASSIGNED arms only, descriptive even when the gates
  // pass: "training under Arise produced better outcomes" is earned by
  // assigned treatment, never by shadow "would have fit" agreement.
  const boot = assigned.difference.clusteredBootstrap || {};
  const claimReady = gatesPassed
    && assigned.maturity === 'descriptive'
    && assigned.arise.targetAchievementRate != null
    && assigned['double-progression'].targetAchievementRate != null;
  const claim = claimReady
    ? {
        text: `Across ${transitions} assigned transitions from ${assigned.participants} consenting participants, arise-assigned targets were met ${Math.round(assigned.arise.targetAchievementRate * 100)}% vs double-progression ${Math.round(assigned['double-progression'].targetAchievementRate * 100)}% (Δ ${assigned.difference.metRateDelta >= 0 ? '+' : ''}${Math.round(assigned.difference.metRateDelta * 100)}pp${Number.isFinite(boot.low) && Number.isFinite(boot.high) ? `; clustered 95% CI [${Math.round(boot.low * 100)}%, ${Math.round(boot.high * 100)}%] over ${boot.participants} participants` : ''}). Descriptive pooled read — not proof of superiority.`,
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
      participants: contributors.total,
      identifiedParticipants: identifiedCount,
      contributors,
      transitions,
      unidentifiedExports: unidentifiedCount,
      reasons: readiness.reasons,
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
      primaryComparison: assigned,
    },
    pooled,
    headline,
    claim,
    protocol: buildStudyProtocol({ config }),
    // Prospective gradeable arise-vs-baseline comparison on identical
    // transitions, repeated-user-aware (mean-of-users effect + user band).
    // Descriptive until pooled multi-user replication says otherwise.
    fieldComparison: pooledProspectiveComparison(participants, { config }),
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
  // STUDY LOADER RESTORATION (not a consumer import). Two things the consumer
  // import path deliberately changes, and only those two, are restored here:
  //   1. CONSENT (protocol fact, not evidence): the study's frozen inclusion
  //      criteria read the participant's exported measurement consent, which
  //      is device-local for consumers. Consent restoration is NEVER
  //      permission to touch evidence provenance.
  //   2. EXACT RAW PROVENANCE: the consumer path downgrades ledger rows to
  //      'imported' (correct there — imported data must never re-enter as
  //      first-party). The study loader re-attaches, row by row, the exact
  //      provenance blocks the export carried — matched by stable ledger
  //      record id, copied verbatim, origin and capturedAt untouched. It
  //      NEVER infers, never upgrades: a row exported as imported stays
  //      imported, replayed stays replayed, seed stays seed, malformed stays
  //      malformed and excluded, and only genuinely live-engine rows on BOTH
  //      sides remain eligible. An import → re-export chain can therefore
  //      never regain live-engine.
  const store = { ...parsed };
  try{
    const rawEnvelope = JSON.parse(text);
    const rawData = rawEnvelope?.data ?? rawEnvelope;
    // Consent: restore the participant's exported measurement preferences.
    if(rawData?.preferences && typeof rawData.preferences === 'object'){
      store.preferences = { ...store.preferences, ...rawData.preferences };
    }
    // Provenance: restore exact blocks by stable record id — verbatim.
    if(Array.isArray(rawData?.evaluationLedger) && Array.isArray(store.evaluationLedger)){
      const rawById = new Map();
      for(const row of rawData.evaluationLedger){
        if(row && typeof row === 'object' && row.id != null) rawById.set(String(row.id), row);
      }
      store.evaluationLedger = store.evaluationLedger.map((row)=>{
        if(!row || typeof row !== 'object' || row.id == null) return row;
        const rawRow = rawById.get(String(row.id));
        if(!rawRow) return row; // no raw match: keep the (downgraded) parsed row
        const restored = { ...row };
        if('provenance' in rawRow) restored.provenance = rawRow.provenance; // exact copy, never inferred
        else delete restored.provenance; // absent in the export: absent here
        if('outcomeProvenance' in rawRow) restored.outcomeProvenance = rawRow.outcomeProvenance;
        else delete restored.outcomeProvenance;
        return restored;
      });
    }
  }catch{ /* parseImportFile already validated the text — unreachable */ }
  return { code, studyParticipantId, store };
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
  L.push(`Status: **${result.status}** · contributing participants ${result.gates.participants}/${result.gates.minParticipants} (identified ${result.gates.identifiedParticipants ?? result.gates.participants}) · transitions ${result.gates.transitions}/${result.gates.minTransitions}`);
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
  // SHADOW diagnostic: frozen prescriptions never trained under.
  const la = t.ledgerArms || { arms: {}, pairedVsArise: {} };
  const armNames = Object.keys(la.arms).sort();
  rows.push(['Ledger arms (shadow diagnostic)', SHADOW_EVIDENCE_LABEL]);
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
      if(Number.isFinite(boot.low) && Number.isFinite(boot.high)) diffCell += ` · clustered 95% CI [${Math.round(boot.low*100)}%, ${Math.round(boot.high*100)}%] over ${boot.participants} participants`;
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
  // Shadow diagnostic: prescription difficulty / decision agreement on
  // identical transitions. Never a retrospective replay, never causal.
  const fc = result.fieldComparison;
  if(fc){
    L.push('## Prescription difficulty / decision agreement (shadow diagnostic)');
    L.push('');
    L.push(`> ${fc.evidenceLabel || SHADOW_EVIDENCE_LABEL}`);
    L.push('');
    L.push(`Gradeable pairs ${fc.gradeable} (resolved ${fc.resolved}, open ${fc.open}) · users ${fc.users} · exercises ${fc.exercises.length} · maturity **${fc.maturity}**.`);
    for(const [armId, arm] of Object.entries(fc.byBaseline || {})){
      L.push(`- ${arm.label}: ${arm.pairs} pairs · arise ${arm.ariseRate == null ? '—' : `${Math.round(arm.ariseRate*100)}%`} vs baseline ${arm.baseRate == null ? '—' : `${Math.round(arm.baseRate*100)}%`} · mean user effect ${arm.effectMean == null ? '—' : `${arm.effectMean > 0 ? '+' : ''}${Math.round(arm.effectMean*100)}pp`} (user band ${arm.effectBand[0] == null ? '—' : `${Math.round(arm.effectBand[0]*100)}…${Math.round(arm.effectBand[1]*100)}pp`})`);
    }
    L.push(`- Realised context: failed-set rate ${fc.realised.failedSetRate == null ? '—' : `${Math.round(fc.realised.failedSetRate*100)}%`} · mean e1RM change ${fc.realised.meanChangePct == null ? '—' : `${Math.round(fc.realised.meanChangePct*1000)/10}%`} · over ${fc.realised.overPrescriptionShare == null ? '—' : `${Math.round(fc.realised.overPrescriptionShare*100)}%`} / under ${fc.realised.underPrescriptionShare == null ? '—' : `${Math.round(fc.realised.underPrescriptionShare*100)}%`} · next-exposure ${fc.nextExposure.n ? `n=${fc.nextExposure.n}, mean Δ ${Math.round(fc.nextExposure.meanDeltaPct*1000)/10}%` : 'no follow-up exposures yet'}.`);
    L.push(`- Excluded: ${fc.excluded.nonProspective} non-prospective · ${fc.excluded.unprovenOutcome} resolved without a live outcome · ${fc.excluded.nonGradeable.unfollowed} unfollowed · ${fc.excluded.nonGradeable.override} overridden · ${fc.excluded.nonGradeable.flagged} pain/technique-flagged · ${fc.unidentifiedExports || 0} unidentified exports. Open live recommendations (${fc.open}) await their workout and are never excluded.`);
    L.push('');
  }
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
