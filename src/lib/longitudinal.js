// longitudinal.js — prospective real-world validation of Arise's recommendations.
//
// This is deliberately separate from backtesting.js:
//   - backtesting replays an existing history retrospectively;
//   - this module records each recommendation BEFORE the workout it targets,
//     attaches the real outcome afterwards, and aggregates the pairs.
//
// Hard rules enforced here:
//   1. Consent: nothing is recorded unless the user enabled local measurements
//      (preferences.telemetryEnabled === true).
//   2. Separation: the evaluation ledger lives under its own storage key and is
//      NEVER fed into recommendNext or any training-history consumer. Training
//      history (store.history) and evaluation history stay apart.
//   3. No future leakage: a record snapshots the recommendation and the basis
//      (visible session count, priors version) at record time. Analysis reads
//      the stored recommendation; it never recomputes one from later data.
//   4. Sample gates: segment-level conclusions are withheld (null rates,
//      conclusive:false) until the configured minimum sample size is met.

import { resolveArisePriors } from './priors.js';
import { EXERCISE_BY_ID, equipmentClassFor } from './data.js';
import { movementPatternFor } from './substitutions.js';
import { computeArms, STUDY_DESIGN } from './study.js';
import { STUDY_VERSION } from './studyEnrollment.js';
import { EVALUATION_SCHEMA_VERSION, EVALUATION_KEY, round, parseReps, e1rm, bestSetOfBlock, hasConsent } from './longitudinalCore.js';
export { EVALUATION_SCHEMA_VERSION, wilsonInterval, EVALUATION_KEY, hasConsent } from './longitudinalCore.js';
import { withProvenance } from './domain.js';
import { getDeviceId } from './exportPolicy.js';
import { evaluateLongitudinal } from './evaluation.js';
export { evaluateLongitudinal, clusteredBootstrapDifference, clusteredBootstrapWinRate } from './evaluation.js';
export function markRecommendationOverride({ exerciseId, dueDateISO = null, storage = defaultStorage() } = {}){
  const ledger = loadEvaluationLedger(storage);
  let changed = false;
  const next = ledger.map(row=>{
    if(row.outcome) return row;
    if(exerciseId && row.exerciseId !== exerciseId) return row;
    if(dueDateISO && row.dueDateISO !== dueDateISO) return row;
    changed = true;
    return { ...row, userOverride: true, overriddenAtISO: new Date().toISOString() };
  });
  if(changed) saveEvaluationLedger(next, storage);
  return changed;
}


// ── Storage (separate key; never the training store) ────────────────────

function defaultStorage(){
  try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch{ return null; }
}

export function loadEvaluationLedger(storage = defaultStorage()){
  try{
    const raw = storage?.getItem?.(EVALUATION_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
    return records.filter(record=> record && typeof record === 'object');
  }catch{ return []; }
}

export function saveEvaluationLedger(records, storage = defaultStorage()){
  try{
    storage?.setItem?.(EVALUATION_KEY, JSON.stringify({ schemaVersion: EVALUATION_SCHEMA_VERSION, records }));
  }catch{}
}

export function clearEvaluationLedger(storage = defaultStorage()){
  try{ storage?.removeItem?.(EVALUATION_KEY); }catch{}
}

// Union two ledgers by record id. A resolved record (outcome attached) beats
// an unresolved duplicate; otherwise the current copy wins. Deterministic:
// current-side records keep their order.
export function mergeEvaluationLedgers(current = [], incoming = []){
  const byId = new Map();
  for(const record of [...(current || []), ...(incoming || [])]){
    if(!record?.id) continue;
    const existing = byId.get(record.id);
    if(!existing){ byId.set(record.id, record); continue; }
    if(!existing.outcome && record.outcome) byId.set(record.id, record);
  }
  return [...byId.values()];
}

// ── Segmentation helpers ────────────────────────────────────────────────

// equipmentClassFor moved to data.js (shared with study.js without a cycle);
// re-exported here for existing import sites.
export { equipmentClassFor };

function trainingAgePhase(history, asOfDateISO, config){
  // Local re-implementation to avoid importing progression.js (which would risk
  // pulling evaluation data into training logic — separation rule #2).
  const cfg = resolveArisePriors(config).progression.trainingAge;
  const end = asOfDateISO ? Date.parse(`${asOfDateISO}T00:00:00`) : Date.now();
  const dates = (history || []).map(h=> Date.parse(`${h?.dateISO || ''}T00:00:00`))
    .filter(t=> Number.isFinite(t) && t <= end).sort((a, b)=> a - b);
  if(!dates.length) return 'unknown';
  const months = Math.max(0, (end - dates[0]) / (resolveArisePriors(config).progression.daysPerMonth * 86400000));
  if(months < cfg.noviceMaxMonths) return 'novice';
  if(months < cfg.intermediateMaxMonths) return 'intermediate';
  return 'advanced';
}

// ── Recording (prospective) ─────────────────────────────────────────────


function lastExposureBest(history, exerciseId, beforeDateISO){
  let best = null;
  for(const session of history || []){
    if(beforeDateISO && String(session.dateISO || '') >= String(beforeDateISO)) continue;
    for(const block of session.blocks || []){
      if(block.exerciseId !== exerciseId) continue;
      const candidate = bestSetOfBlock(block);
      if(candidate && (!best || candidate.score > best.score)) best = candidate;
    }
  }
  return best;
}

function classifyRecommendedAction(recommendation, previous){
  if(!recommendation) return 'unknown';
  if(recommendation.plateau?.isPlateau || /plateau|hold/i.test(recommendation.reason || '')) return 'hold';
  if(recommendation.assistKg != null && previous && recommendation.assistKg < previous.assistedKg) return 'reduce_assistance';
  if(recommendation.reps != null && previous && recommendation.reps > previous.reps) return 'add_reps';
  if(recommendation.load != null && recommendation.load > 0 && previous && recommendation.load > previous.weightKg) return 'add_load';
  if(recommendation.load != null && recommendation.load > 0 && !previous) return 'add_load';
  return 'hold';
}

function makeRecordId(now = Date.now()){
  return `eval-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

// metTarget against an arbitrary prescription {reps, load, assistKg}.
function meetsPrescription(best, rx){
  const repsOk = rx.reps == null || best.reps >= Number(rx.reps);
  const loadOk = rx.load == null || !(Number(rx.load) > 0) || best.weightKg >= Number(rx.load);
  const assistOk = rx.assistKg == null || best.assistedKg <= Number(rx.assistKg);
  return repsOk && loadOk && assistOk;
}

// Snapshot a recommendation before the workout it targets. Only prior history
// may be passed in; the basis records how much was visible so audits can
// confirm no future rows were involved.
//
// Alongside arise's own prescription, the SAME point-in-time slice is shown
// to the baseline arms (double progression, linear progression, fixed rules,
// flat). Their prescriptions are frozen into the record so the prospective
// ledger can later score every arm against the same real outcome — the
// "does adaptive programming actually decide better?" question, answered on
// real training rather than replay.
export function recordRecommendation({ exerciseId, recommendation, history = [], dueDateISO = null, preferences = null, config = null, nowISO = null, programId = null, programVersion = null, targetReps = null, assignedArm = null, participantId = null, storage = defaultStorage() } = {}){
  if(!hasConsent(preferences)) return null;
  if(!exerciseId || !recommendation) return null;
  // Prior-only guarantee: nothing dated after the due session may inform the
  // snapshot, even if a caller hands us a longer history.
  const visibleHistory = dueDateISO
    ? (history || []).filter(h=> String(h?.dateISO || '') <= String(dueDateISO))
    : (history || []);
  const phase = trainingAgePhase(visibleHistory, dueDateISO, config);
  const previous = lastExposureBest(visibleHistory, exerciseId, dueDateISO);
  const priors = resolveArisePriors(config);
  let arms = null;
  try{
    // SHADOW snapshot: what every algorithm would prescribe from the same
    // prior-only slice. Pure — never overwritten by the assigned treatment.
    arms = computeArms({ exerciseId, history: visibleHistory, targetReps: targetReps || undefined, asOfDateISO: dueDateISO, config });
  }catch{ arms = null; }
  const recordedAtISO = nowISO || new Date().toISOString();
  const record = {
    id: makeRecordId(nowISO ? Date.parse(nowISO) || Date.now() : Date.now()),
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    recordedAtISO,
    dueDateISO,
    exerciseId,
    movementPattern: movementPatternFor(exerciseId) || 'unknown',
    equipmentClass: equipmentClassFor(exerciseId),
    // Programme identity lets effectiveness roll up per programme/version so
    // "did this programme work" is answerable from real outcomes.
    programId: programId || null,
    programVersion: programVersion ?? null,
    recommendation: {
      load: recommendation.load ?? null,
      reps: recommendation.reps ?? null,
      assistKg: recommendation.assistKg ?? null,
      reason: recommendation.reason || '',
      strategy: recommendation.strategy || null,
    },
    // Decision audit trail (PR #20 policy layer): the full graded context at
    // decision time, frozen. Legacy rows predate this field — rollups treat
    // missing audit blocks as unknown, never as zero.
    audit: {
      policy: recommendation.policy ?? null,
      policyVersion: recommendation.policyVersion ?? null,
      guard: recommendation.guard ?? null,
      confidence: recommendation.confidence ?? null,
      uncertainty: recommendation.uncertainty ?? null,
      evidence: recommendation.evidence ?? null,
    },
    // ── Randomised trial fields (immutable once written) ──
    // participantId: pseudonymous study id (studyIdentity.js)
    // assignedArm:    which policy the product actually enforced
    // prescription:   the treatment that was displayed/used
    // assignmentVersion / studyVersion / policy: frozen at entry
    participantId: participantId || null,
    assignedArm: assignedArm || null,
    studyVersion: STUDY_VERSION,
    prescription: {
      arm: assignedArm || null,
      load: recommendation.load ?? null,
      reps: recommendation.reps ?? null,
      assistKg: recommendation.assistKg ?? null,
    },
    prescriptionCreatedAt: recordedAtISO,
    // Frozen baseline prescriptions from the same prior-only history —
    // SHADOW analysis only (decision agreement), never causal observations.
    arms,
    // Policy identity: a study cannot fairly evaluate an engine that changes
    // silently halfway through — every record knows which policy made it.
    policy: { id: 'arise-engine', priorsVersion: priors.version, modelVersion: priors.progressionModel.version },
    recommendedAction: classifyRecommendedAction(recommendation, previous),
    basis: {
      visibleSessions: visibleHistory.length,
      previousBest: previous ? { reps: previous.reps, weightKg: previous.weightKg, assistedKg: previous.assistedKg, e1rm: round(previous.score, 2) } : null,
      trainingAgePhase: phase,
      priorsVersion: priors.version,
    },
    outcome: null,
  };
  // Provenance: this recommendation came from the live engine on this device —
  // distinguishable from imported/replayed records in every downstream rollup.
  const stamped = withProvenance(record, 'live-engine', { deviceId: getDeviceId() });
  const ledger = loadEvaluationLedger(storage);
  // Cap OPEN records per exercise so skipped sessions cannot pile up: keep the
  // newest (maxOpen - 1) and drop only the true EXCESS oldest. The previous
  // formula computed a negative slice index whenever fewer than maxOpen were
  // open — silently DELETING valid unresolved recommendations.
  const maxOpen = resolveArisePriors(config).longitudinal.maxOpenRecordsPerExercise;
  const openForExercise = ledger.filter(row=> row.exerciseId === exerciseId && !row.outcome);
  const excess = Math.max(0, openForExercise.length + 1 - maxOpen);
  const dropIds = new Set(openForExercise.slice(0, excess).map(row=> row.id));
  const next = [...ledger.filter(row=> !dropIds.has(row.id)), stamped];
  const retention = resolveArisePriors(config).longitudinal.retentionLimit;
  const archived = next.slice(0, Math.max(0, next.length - retention)).filter(row=> row.outcome); // only RESOLVED rows archive; open decisions are never dropped
  const trimmed = next.slice(-retention);
  if(archived.length) appendArchivedEvaluationRecords(archived, storage);
  saveEvaluationLedger(trimmed, storage);
  return stamped;
}

// ── Ledger archive ─────────────────────────────────────────────────────
// Resolved records beyond the retention limit move to a separate archive key
// instead of being destroyed: longitudinal history stays auditable without
// loading unbounded data at boot. Open (unresolved) decisions are NEVER
// archived — they are still waiting for their outcome.
export function appendArchivedEvaluationRecords(records, storage = defaultStorage()){
  if(!records?.length) return 0;
  try{
    const key = `${EVALUATION_KEY}.archive`;
    const prior = JSON.parse(storage?.getItem?.(key) || '[]');
    const merged = [...(Array.isArray(prior) ? prior : []), ...records];
    storage?.setItem?.(key, JSON.stringify(merged));
    return records.length;
  }catch{ return 0; }
}

export function loadArchivedEvaluationCount(storage = defaultStorage()){
  try{ return (JSON.parse(storage?.getItem?.(`${EVALUATION_KEY}.archive`) || '[]')).length; }catch{ return 0; }
}

// Attach the real outcome once the following workout completes. The outcome is
// taken from the saved session payload only — never from recommendations.
export function attachOutcome({ sessionId, dateISO, blocks = [], historyBefore = [], preferences = null, config = null, nowISO = null, storage = defaultStorage() } = {}){
  if(!hasConsent(preferences)) return [];
  const ledger = loadEvaluationLedger(storage);
  const resolved = [];
  const byExercise = new Map();
  for(const block of blocks || []){
    if(!block?.exerciseId) continue;
    const best = bestSetOfBlock(block);
    if(best && !byExercise.has(block.exerciseId)){
      const allSets = block.sets || [];
      let volumeKg = 0, failedSets = 0;
      for(const s of allSets){
        const reps = parseReps(s.reps), w = Number(s.weightKg) || 0;
        volumeKg += reps * Math.max(0, w - (Number(s.assistedKg) || 0));
        if(s.failed) failedSets++;
      }
      byExercise.set(block.exerciseId, { best, sets: allSets.length, failedSets, volumeKg: Math.round(volumeKg) });
    }
  }
  const next = ledger.map(record=>{
    if(record.outcome) return record;
    if(!byExercise.has(record.exerciseId)) return record;
    // A record is resolved by the first logged session at or after its due date.
    if(record.dueDateISO && dateISO && String(dateISO) < String(record.dueDateISO)) return record;
    const { best } = byExercise.get(record.exerciseId);
    const rec = record.recommendation || {};
    const previous = record.basis?.previousBest || null;
    const repTarget = rec.reps != null ? Number(rec.reps) : null;
    const loadTarget = rec.load != null && Number(rec.load) > 0 ? Number(rec.load) : null;
    const assistTarget = rec.assistKg != null ? Number(rec.assistKg) : null;
    const repsMet = repTarget == null || best.reps >= repTarget;
    const loadMet = loadTarget == null || best.weightKg >= loadTarget;
    const assistMet = assistTarget == null || best.assistedKg <= assistTarget;
    const metTarget = repsMet && loadMet && assistMet;
    const actualE1rm = round(e1rm(best.weightKg, best.reps), 2);
    const previousE1rm = previous?.e1rm ?? null;
    const changePct = previousE1rm ? round((actualE1rm - previousE1rm) / previousE1rm, 4) : null;
    const action = record.recommendedAction;
    const progressed = action !== 'hold' && metTarget;
    const regressed = changePct != null && changePct <= -0.05;
    const stagnated = action === 'hold' && (changePct == null || Math.abs(changePct) < 0.02);
    const errors = {
      loadErrorKg: loadTarget != null && best.weightKg > 0 ? round(Math.abs(loadTarget - best.weightKg), 2) : null,
      repError: repTarget != null ? Math.abs(repTarget - best.reps) : null,
    };
    // Prescription adherence measured against the ASSIGNED arm's frozen
    // prescription (falling back through arise-slot / record for legacy rows).
    // Missing prescription ⇒ followed stays null: unknown is never counted
    // as compliant.
    let followed = null, deviationKg = null, assignedMet = null;
    const rx = record.prescription?.arm
      ? record.prescription
      : (record.assignedArm && record.arms?.[record.assignedArm]
        ? { arm: record.assignedArm, ...record.arms[record.assignedArm] }
        : (rec.load != null || rec.reps != null ? { arm: 'arise', ...rec } : null));
    if(rx){
      const aLoad = Number(rx.load) > 0 ? Number(rx.load) : null;
      const aReps = rx.reps != null ? Number(rx.reps) : null;
      const aAssist = rx.assistKg != null ? Number(rx.assistKg) : null;
      deviationKg = aLoad != null && best.weightKg > 0 ? round(Math.abs(best.weightKg - aLoad), 2) : null;
      const loadOk = aLoad == null || (deviationKg != null && deviationKg <= Math.max(0.5, aLoad * 0.02));
      const repsOk = aReps == null || best.reps >= aReps;
      const assistOk = aAssist == null || best.assistedKg <= aAssist;
      followed = loadOk && repsOk && assistOk;
      assignedMet = meetsPrescription(best, { reps: aReps, load: aLoad, assistKg: aAssist });
    }
    // Score every FROZEN baseline arm against the same real outcome. All arms
    // saw the same prior history at record time; the realised training is
    // identical across arms, so differences are decision quality — would this
    // prescription have been met by the same performance?
    const armOutcomes = {};
    for(const [armName, armRec] of Object.entries(record.arms || {})){
      if(!armRec || typeof armRec !== 'object') continue;
      const aRepTarget = armRec.reps != null ? Number(armRec.reps) : null;
      const aLoadTarget = armRec.load != null && Number(armRec.load) > 0 ? Number(armRec.load) : null;
      const aAssistTarget = armRec.assistKg != null ? Number(armRec.assistKg) : null;
      const aRepsMet = aRepTarget == null || best.reps >= aRepTarget;
      const aLoadMet = aLoadTarget == null || best.weightKg >= aLoadTarget;
      const aAssistMet = aAssistTarget == null || best.assistedKg <= aAssistTarget;
      armOutcomes[armName] = {
        metTarget: aRepsMet && aLoadMet && aAssistMet,
        loadErrorKg: aLoadTarget != null && best.weightKg > 0 ? round(Math.abs(aLoadTarget - best.weightKg), 2) : null,
        repError: aRepTarget != null ? Math.abs(aRepTarget - best.reps) : null,
      };
    }
    const enriched = {
      ...record,
      outcome: {
        sessionId: sessionId || null,
        dateISO: dateISO || null,
        recordedAtISO: nowISO || new Date().toISOString(),
        load: best.weightKg,
        reps: best.reps,
        assistedKg: best.assistedKg,
        rpe: best.rpe,
        sets: byExercise.get(record.exerciseId).sets,
        failedSets: byExercise.get(record.exerciseId).failedSets,
        volumeKg: byExercise.get(record.exerciseId).volumeKg,
        e1rm: actualE1rm,
        previousE1rm,
        changePct,
        metTarget,
        followed,
        deviationKg,
        assignedMet,
        assignedArm: record.assignedArm || null,
        userOverride: record.userOverride === true,
        repsMet, loadMet, assistMet,
        loadErrorKg: errors.loadErrorKg,
        repError: errors.repError,
        classification: progressed ? 'progression-success'
          : regressed && action !== 'hold' ? 'regression'
          : stagnated ? 'stagnation'
          : metTarget ? 'target-met-hold'
          : 'target-missed',
        arms: armOutcomes,
      },
      // The outcome was measured on this device from the user's own log —
      // merged-in outcomes carry a different origin and never count as
      // first-party evidence in the study pipeline.
      outcomeProvenance: { origin: 'live-engine', capturedAt: nowISO || new Date().toISOString(), deviceId: getDeviceId() },
    };
    resolved.push(enriched);
    return enriched;
  });
  saveEvaluationLedger(next, storage);
  return resolved;
}


export function longitudinalSummary({ preferences = null, config = null, storage = defaultStorage() } = {}){
  if(!hasConsent(preferences)) return { consented: false, evaluation: null };
  return { consented: true, evaluation: evaluateLongitudinal(loadEvaluationLedger(storage), { config }) };
}

// ── Substitution quality validation ─────────────────────────────────────
// For every engine-recorded swap (block.substitutionFrom): was the swapped-in
// lift actually performed with real sets, and did its performance hold on the
// next exposure? Reads only saved history — no recommendations involved.
export function validateSubstitutions(history, { retentionRatio = 0.95 } = {}){
  const ordered = [...(history || [])].sort((a, b)=> String(a?.dateISO || '').localeCompare(String(b?.dateISO || '')));
  const rows = [];
  for(const session of ordered){
    for(const block of session.blocks || []){
      if(!block?.substitutionFrom) continue;
      const best = bestSetOfBlock(block);
      rows.push({
        sessionId: session.id || null,
        dateISO: session.dateISO || null,
        from: block.substitutionFrom,
        to: block.exerciseId,
        reason: block.substitutionReason || '',
        performed: !!(best && best.reps > 0),
        e1rm: best ? round(best.score, 2) : null,
        nextE1rm: null,
        nextDateISO: null,
        retained: null,
      });
    }
  }
  const nextExposureAfter = (exerciseId, dateISO, sessionId)=>{
    for(const session of ordered){
      if(sessionId && session.id === sessionId) continue;
      if(String(session.dateISO || '') <= String(dateISO || '')) continue;
      for(const block of session.blocks || []){
        if(block.exerciseId !== exerciseId) continue;
        const best = bestSetOfBlock(block);
        if(best && best.reps > 0) return { score: best.score, dateISO: session.dateISO };
      }
    }
    return null;
  };
  for(const row of rows){
    if(!row.performed || !row.e1rm) continue;
    const next = nextExposureAfter(row.to, row.dateISO, row.sessionId);
    if(next){
      row.nextE1rm = round(next.score, 2);
      row.nextDateISO = next.dateISO;
      row.retained = round(next.score / Math.max(1e-9, row.e1rm), 3) >= retentionRatio;
    }
  }
  const performedRows = rows.filter(row=> row.performed);
  const followUps = performedRows.filter(row=> row.retained != null);
  const pct = (part, whole)=> whole ? Math.round(part / whole * 100) / 100 : null;
  return {
    substitutions: rows.length,
    performed: performedRows.length,
    performedRate: pct(performedRows.length, rows.length),
    followedUp: followUps.length,
    retainedRate: pct(followUps.filter(row=> row.retained).length, followUps.length),
    rows,
  };
}
