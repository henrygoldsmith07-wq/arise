// studyExport.js — the study-export serializers, SPLIT OUT of export.js so
// they never bloat the boot chunk: MoreView loads this module on demand
// (dynamic import) when the participant taps Export study data. Operators
// consume the same module through scripts/ and tests/ — one definition,
// no duplicate allowlist.

import { STORE_SCHEMA_VERSION } from './store.js';
import { buildEnvelope, EXPORT_VERSION } from './exportPolicy.js';
import { getEventHistory } from './telemetry.js';
import { loadEvaluationLedger } from './longitudinal.js';
import { ensureStudyParticipantId } from './studyIdentity.js';
export { EXPORT_VERSION };


// ── Study allowlists ────────────────────────────────────────────────────
// SCHEMA-VERSION INVARIANT: the study export is a recursively closed,
// versioned schema. EVERY nested structure (sessions, blocks, sets,
// prescriptions, ledger rows, enrollment, schedule adaptations) is rebuilt
// field-by-field here — never passed through by spread — and EVERY scalar
// field is type-locked at this boundary (string / number / boolean / fixed
// vocabulary only): a hostile or future object, array or unknown string in a
// scalar slot fails closed to null. It can never ride along. An intentional
// schema change therefore REQUIRES all of:
//   1. an explicit serializer change in this block;
//   2. a matching update to tests/study-export.test.js (key-set, privacy and
//      malicious-shape regression assertions);
//   3. a STUDY_EXPORT_VERSION bump when the material payload changes.
// Free text (session note, session title), note-tag LABELS, UI metadata,
// engine-facing prose and any unknown/extra field stay on the device.
export const STUDY_EXPORT_VERSION = 4; // v4: scalars type-locked; audit/band confidence is a string; engine objects rebuilt; prescription uncertainty stays local

// Compact typed pickers for the serializers: null/unknown → null (never a
// smuggled object/array or a coerced 0), a non-conforming value never travels.
const pickNum = (v)=> (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const pickStr = (v)=> typeof v === 'string' ? v : null;
const pickBoolOr = (v, fallback = null)=> typeof v === 'boolean' ? v : fallback;
// Integers only (counts, indexes, versions): 1.5 or "3" (string-encoded) or
// an object never passes. "3"→3 is the documented canonical form.
const pickInt = (v)=>{
  const n = pickNum(v);
  return n != null && Number.isInteger(n) ? n : null;
};
// Seed is the deterministic-enrollment string ('base::participant::vN'); a
// legacy numeric seed still travels, anything else (object/array) → null.
const pickSeed = (v)=> (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v)) ? v : null;
const pickArrOfStr = (v)=> Array.isArray(v) ? v.filter(x => typeof x === 'string') : null;
const pickArrOfInt = (v)=> Array.isArray(v) ? v.filter(x => Number.isInteger(x)) : null;

// Fixed structured vocabularies. Unknown strings are DROPPED, not passed
// through: only these ids may ever appear in a study export. Kept in sync
// with the UI sources by tests/study-export.test.js (drift guard).
const NOTE_TAG_IDS = new Set(['felt-strong', 'felt-heavy', 'poor-sleep', 'short-on-time', 'form-focus', 'pain-discomfort']); // NOTE_PROMPTS
const QUALITY_IDS = new Set(['great', 'good', 'ok', 'rough']); // SESSION_QUALITY_OPTIONS
const MODE_IDS = new Set(['guided', 'gym', 'standard', 'short']);
const ARM_IDS = new Set(['arise', 'double-progression', 'linear-progression', 'fixed-rules', 'flat']);
// participation.js lifecycle — the only study statuses the cohort reports read.
const STUDY_STATUS_IDS = new Set(['enrolled', 'withdrawn']);
// domain.js PROVENANCE_ORIGINS — the trust-ranked decision origins.
const RESULT_ORIGIN_IDS = new Set(['live-engine', 'imported', 'replayed', 'seed']);
// evidenceMetrics bands — audit.confidence reduced to its band string only.
const BAND_IDS = new Set(['high', 'medium', 'low', 'low-thin']);
// progression.js PRESCRIPTION_SNAPSHOT `source` — who authored the shown target.
const RX_SOURCE_IDS = new Set(['engine', 'schedule']);
// longitudinal.js classifyRecommendedAction — the frozen graded action.
const RECOMMENDED_ACTION_IDS = new Set(['unknown', 'hold', 'add_reps', 'add_load', 'reduce_assistance']);
// longitudinalCore.js RECOMMENDATION_OUTCOME_LABELS — the five named,
// conservative grades (labelReason PROSE never travels).
const OUTCOME_LABEL_IDS = new Set(['successful', 'neutral', 'too-aggressive', 'too-conservative', 'insufficient-evidence']);
const vocabOne = (value, vocab)=> typeof value === 'string' && vocab.has(value) ? value : null;
// Confidence arrives in two shapes (live engine object { band, … } vs the
// reduced export string): both collapse to the band string here.
const bandOf = (c)=> typeof c === 'string' ? vocabOne(c, BAND_IDS) : (c && typeof c === 'object' ? vocabOne(c.band, BAND_IDS) : null);

// typedFields: the allowlist primitive. For each spec key, if the input
// carried the field, write the MAPPED value (null when the type is wrong);
// fields the input lacked stay absent, so no phantom keys appear.
function typedFields(src, spec){
  const out = {};
  for(const key of Object.keys(spec)){
    if(src[key] !== undefined) out[key] = spec[key](src[key]);
  }
  return out;
}

// ── Evaluation-ledger serializers ─────────────────────────────────────
// Exactly the fields the frozen analysis consumes: assigned-arm analysis,
// recommendation/outcome scoring, provenance, participant clustering,
// overrides, protocol/audit checks. Everything else (future fields, human-
// readable free prose) is excluded — analysis recomputes grades from the
// numbers, so equivalence with the raw store is preserved (tested).
const studyProvenance = (p)=> p && typeof p === 'object'
  ? { origin: vocabOne(p.origin, RESULT_ORIGIN_IDS), capturedAt: pickStr(p.capturedAt), deviceId: pickStr(p.deviceId) }
  : null;
const studyRecPayload = (r)=> r && typeof r === 'object'
  ? { load: pickNum(r.load), reps: pickInt(r.reps), assistKg: pickNum(r.assistKg), reason: pickStr(r.reason) }
  : null;
const studyBasis = (b)=> b && typeof b === 'object'
  ? { visibleSessions: pickInt(b.visibleSessions),
      previousBest: b.previousBest && typeof b.previousBest === 'object'
        ? { reps: pickInt(b.previousBest.reps), weightKg: pickNum(b.previousBest.weightKg), assistedKg: pickNum(b.previousBest.assistedKg), e1rm: pickNum(b.previousBest.e1rm) }
        : null,
      trainingAgePhase: pickStr(b.trainingAgePhase), priorsVersion: pickInt(b.priorsVersion) }
  : null;
const studyPolicy = (p)=> p && typeof p === 'object'
  ? { id: pickStr(p.id), priorsVersion: pickInt(p.priorsVersion), modelVersion: pickInt(p.modelVersion) }
  : null;
// Audit block: policy identity, guard and confidence band — the fields the
// frozen analysis reads (evidenceMetrics bands, policy rollups). uncertainty/
// evidence have no consumers and personalCalibration carries UI prose; all
// three stay local. audit.confidence travels as the BAND STRING ONLY ('high'):
// the object form (score/slope/factors/personalCalibration) is local engine
// state and must never ride along — both analysis readers (confidenceBandOf,
// calibrationMetrics) accept the string form.
const studyAudit = (a)=> a && typeof a === 'object'
  ? { policy: pickStr(a.policy), policyVersion: pickInt(a.policyVersion),
      guard: pickStr(a.guard),
      confidence: bandOf(a.confidence) }
  : null;
const studyArmRec = (a)=> a && typeof a === 'object'
  ? { load: pickNum(a.load), reps: pickInt(a.reps), assistKg: pickNum(a.assistKg) }
  : null;
function studyArms(arms){
  if(!arms || typeof arms !== 'object') return null;
  const out = {};
  for(const arm of ARM_IDS){
    if(arms[arm] !== undefined) out[arm] = studyArmRec(arms[arm]);
  }
  return out;
}
function studyOutcome(o){
  if(!o || typeof o !== 'object') return null;
  return {
    sessionId: pickStr(o.sessionId), dateISO: pickStr(o.dateISO), recordedAtISO: pickStr(o.recordedAtISO),
    load: pickNum(o.load), reps: pickInt(o.reps), assistedKg: pickNum(o.assistedKg), rpe: pickStr(o.rpe),
    sets: pickInt(o.sets), failedSets: pickInt(o.failedSets), volumeKg: pickNum(o.volumeKg),
    e1rm: pickNum(o.e1rm), previousE1rm: pickNum(o.previousE1rm), changePct: pickNum(o.changePct),
    metTarget: pickBoolOr(o.metTarget), followed: pickBoolOr(o.followed), deviationKg: pickNum(o.deviationKg),
    assignedMet: pickBoolOr(o.assignedMet), assignedArm: vocabOne(o.assignedArm, ARM_IDS), userOverride: pickBoolOr(o.userOverride, false),
    pain: pickBoolOr(o.pain, false), techniqueWarning: pickBoolOr(o.techniqueWarning, false),
    repsMet: pickBoolOr(o.repsMet), loadMet: pickBoolOr(o.loadMet), assistMet: pickBoolOr(o.assistMet),
    loadErrorKg: pickNum(o.loadErrorKg), repError: pickNum(o.repError),
    classification: pickStr(o.classification), // engine taxonomy id (longitudinal.js), not free text
    label: vocabOne(o.label, OUTCOME_LABEL_IDS), // named grade only; labelReason prose stays local
    attempted: pickBoolOr(o.attempted), gradeable: pickBoolOr(o.gradeable),
    // Shadow (counterfactual) baseline outcomes: { metTarget, loadErrorKg, repError } per known arm.
    arms: (()=>{ if(!o.arms || typeof o.arms !== 'object') return null; const out = {}; for(const arm of ARM_IDS){ if(o.arms[arm] !== undefined) out[arm] = { metTarget: pickBoolOr(o.arms[arm].metTarget), loadErrorKg: pickNum(o.arms[arm].loadErrorKg), repError: pickNum(o.arms[arm].repError) }; } return out; })(),
  };
}
function studyLedgerRow(row){
  if(!row || typeof row !== 'object') return null;
  return {
    id: pickStr(row.id), schemaVersion: pickInt(row.schemaVersion),
    recordedAtISO: pickStr(row.recordedAtISO), dueDateISO: pickStr(row.dueDateISO),
    exerciseId: pickStr(row.exerciseId), movementPattern: pickStr(row.movementPattern), equipmentClass: pickStr(row.equipmentClass),
    programId: pickStr(row.programId), programVersion: pickInt(row.programVersion),
    recommendation: studyRecPayload(row.recommendation), audit: studyAudit(row.audit),
    participantId: pickStr(row.participantId),
    // Arm fields are lifecycle vocabulary only — a hostile object/array/unknown
    // string fails closed to null, never rides along.
    assignedArm: vocabOne(row.assignedArm, ARM_IDS), studyVersion: pickInt(row.studyVersion),
    // The arm's frozen prescription (what was actually enforced).
    prescription: row.prescription && typeof row.prescription === 'object'
      ? { arm: vocabOne(row.prescription.arm, ARM_IDS), load: pickNum(row.prescription.load), reps: pickInt(row.prescription.reps), assistKg: pickNum(row.prescription.assistKg) }
      : null,
    prescriptionCreatedAt: pickStr(row.prescriptionCreatedAt),
    // Frozen prior-only baseline prescriptions (SHADOW analysis).
    arms: studyArms(row.arms), policy: studyPolicy(row.policy),
    recommendedAction: vocabOne(row.recommendedAction, RECOMMENDED_ACTION_IDS), basis: studyBasis(row.basis),
    userOverride: pickBoolOr(row.userOverride, false),
    provenance: studyProvenance(row.provenance), outcomeProvenance: studyProvenance(row.outcomeProvenance),
    outcome: studyOutcome(row.outcome),
  };
}

function buildStudyLedgerExport(rows){ return (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object').map(studyLedgerRow); }

function buildStudyEnrollmentExport(e){
  if(!e || typeof e !== 'object') return null;
  const assignments = {};
  if(e.assignments && typeof e.assignments === 'object'){
    for(const [exerciseId, a] of Object.entries(e.assignments)){
      assignments[exerciseId] = a && typeof a === 'object'
        ? { arm: vocabOne(a.arm, ARM_IDS), assignmentVersion: pickInt(a.assignmentVersion), assignedAtISO: pickStr(a.assignedAtISO) }
        : null;
    }
  }
  return {
    studyVersion: pickInt(e.studyVersion),
    participantId: pickStr(e.participantId),
    // Deterministic-enrollment seed: canonical string (studyEnrollment.js),
    // legacy number tolerated; an object/array/anything else → null.
    seed: pickSeed(e.seed),
    enrolledAtISO: pickStr(e.enrolledAtISO),
    // Fixed arm vocabulary — the balancing pair lives in ARM_IDS.
    startArm: vocabOne(e.startArm, ARM_IDS),
    policyVersions: e.policyVersions && typeof e.policyVersions === 'object'
      ? { arise: pickStr(e.policyVersions.arise), doubleProgression: pickStr(e.policyVersions.doubleProgression) }
      : null,
    targetDefinition: pickStr(e.targetDefinition),
    meaningfulGainThreshold: pickNum(e.meaningfulGainThreshold),
    analysisCodeVersion: pickStr(e.analysisCodeVersion),
    assignments,
  };
}

// ── History/schedule/event/readiness serializers ──────────────────────
// History rows: the per-session record of what was prescribed and what was
// done. Free text (note, title) and any unknown field never travel.
function studySubstitutions(subs){
  return (Array.isArray(subs) ? subs : [])
    .filter(s => s && typeof s === 'object')
    .map(s => ({ from: pickStr(s.from), to: pickStr(s.to), reason: pickStr(s.reason) })); // engine-written rationale, disclosed as programme metadata
}
// Prescription snapshots (progression.js buildPrescriptionSnapshot): the
// complete shown-target audit trail. Engine objects (confidence, engine) are
// REBUILT scalar-by-scalar — confidence collapses to its band string and
// `uncertainty` (engine-only numeric estimate with no study consumer) never
// travels — so a future snapshot field cannot silently ride along.
const studyPrescription = (p)=> p && typeof p === 'object' ? typedFields(p, {
  schemaVersion: pickInt,
  prescriptionId: pickStr,
  revision: pickInt,
  supersedesPrescriptionId: pickStr,
  previousExerciseId: pickStr,
  changeReason: pickStr,
  source: (v)=> vocabOne(v, RX_SOURCE_IDS),
  sessionId: pickStr,
  exerciseId: pickStr,
  blockIndex: pickInt,
  prescribedSets: pickInt,
  prescribedReps: pickNum,
  prescribedRepRange: pickStr,
  prescribedLoadKg: pickNum,
  prescribedAssistKg: pickNum,
  rpeTarget: pickNum,
  rirTarget: pickNum,
  shownAt: pickStr,
  firstShownAt: pickStr,
  createdAt: pickStr,
  prescribedAt: pickStr,
  priorCutoffDateISO: pickStr,
  engine: (v)=> v && typeof v === 'object'
    ? { name: pickStr(v.name), priorsVersion: pickInt(v.priorsVersion), policy: pickStr(v.policy),
        policyVersion: pickNum(v.policyVersion), modelVersion: pickNum(v.modelVersion),
        strategy: pickStr(v.strategy), guard: pickStr(v.guard) }
    : null,
  reason: pickStr,
  confidence: bandOf,
}) : null;
const studyPrescriptionHistory = (v)=> (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object').map(studyPrescription);

function studySets(sets){
  return (Array.isArray(sets) ? sets : [])
    .filter(s => s && typeof s === 'object')
    .map(s => typedFields(s, {
      // What was lifted (the app's canonical string-encoded numbers, '' = unset).
      reps: pickStr, weightKg: pickStr, rpe: pickStr, rom: pickStr, assistedKg: pickStr, tempo: pickStr,
      // How the set resolved, plus per-set identity/provenance for analysis.
      completed: pickBoolOr, skipped: pickBoolOr, failed: pickBoolOr, pain: pickBoolOr,
      setId: pickStr,
      origin: pickStr, // engine taxonomy id ('prescribed' | 'user-added' | …), not user text
      plannedSlot: pickInt, governingPrescriptionId: pickStr, side: pickStr,
    }));
}
function studyBlocks(blocks){
  return (Array.isArray(blocks) ? blocks : [])
    .filter(b => b && typeof b === 'object')
    .map(b => typedFields(b, {
      exerciseId: pickStr, exerciseOrder: pickInt, equipment: pickStr,
      prescriptionOverridden: pickBoolOr,
      // Substitution + prescription audit metadata (engine-written).
      substitutionFrom: pickStr,
      substitutionReason: pickStr, // engine-written rationale, disclosed as programme metadata
      governedSlots: pickArrOfInt, removedSlots: pickArrOfInt,
      prescription: studyPrescription,
      prescriptionHistory: studyPrescriptionHistory,
      sets: studySets,
    }));
}
export function buildStudyHistoryExport(history){
  const out = [];
  for(const s of (Array.isArray(history) ? history : [])){
    if(!s || typeof s !== 'object') continue;
    out.push(typedFields(s, {
      id: pickStr, dateISO: pickStr,
      programId: pickStr, programVersion: pickInt, templateVersion: pickInt,
      week: pickInt, day: pickInt, status: pickStr,
      durationMinutes: pickNum, startedAt: pickStr, finishedAt: pickStr, savedAt: pickStr,
      targetMinutes: pickNum, originalDurationMin: pickNum, rescheduledFrom: pickStr,
      equipmentSnapshot: pickArrOfStr, exerciseOrder: pickArrOfStr,
      painDiscomfort: pickBoolOr, skippedSetsCount: pickInt, sessionDuration: pickNum,
      blocks: studyBlocks,
      // Vocabulary-checked values are only written when the input carried them,
      // so exports stay minimal and no phantom keys appear. An invalid value
      // becomes null ("unknown"), never the raw string.
      mode: (v)=> vocabOne(v, MODE_IDS),
      quality: (v)=> vocabOne(v, QUALITY_IDS),
      noteTags: (v)=> (pickArrOfStr(v) || []).filter(t => NOTE_TAG_IDS.has(t)), // real NOTE_PROMPTS ids only
      substitutions: studySubstitutions,
    }));
  }
  return out;
}

// Readiness: only the protocol's structured signals travel — the derived
// score plus the three inputs it was computed from. No extra fields.
export function buildStudyReadinessExport(readinessLog){
  return (Array.isArray(readinessLog) ? readinessLog : [])
    .filter(r => r && typeof r === 'object')
    .map(r => typedFields(r, { dateISO: pickStr, score: pickNum, sleep: pickNum, soreness: pickNum, motivation: pickNum }));
}

// Schedule adaptation entries: decision metadata the audit trail needs,
// rebuilt field-by-field (from/to geometry included; vocabulary-checked
// engine `reason` kept — disclosed as programme adjustment metadata).
function studyAdaptationChange(c){
  // Geometry objects only: { sets, exerciseId }. A hostile scalar → null.
  const geometry = (g)=> g && typeof g === 'object' ? { sets: pickInt(g.sets), exerciseId: pickStr(g.exerciseId) } : null;
  return {
    sessionId: pickStr(c.sessionId), dateISO: pickStr(c.dateISO), exerciseId: pickStr(c.exerciseId),
    kind: pickStr(c.kind), // engine directive taxonomy ('deload' | 'weekly-*' | …), not free text
    from: geometry(c.from), to: geometry(c.to),
    reason: pickStr(c.reason), // engine-written rationale, disclosed as programme metadata
    evidence: pickArrOfStr(c.evidence),
  };
}
function studyAdaptationEntry(e){
  if(!e || typeof e !== 'object') return null;
  return {
    basisKey: pickStr(e.basisKey), basisSessionId: pickStr(e.basisSessionId), dateISO: pickStr(e.dateISO),
    decision: e.decision && typeof e.decision === 'object'
      ? { deload: pickBoolOr(e.decision.deload, false),
          deloadSignals: pickArrOfStr(e.decision.deloadSignals) || [],
          confidence: bandOf(e.decision.confidence) }
      : null,
    changes: (Array.isArray(e.changes) ? e.changes : []).filter(c => c && typeof c === 'object').map(studyAdaptationChange),
  };
}
function buildStudyScheduleExport(schedule){
  if(!schedule || typeof schedule !== 'object') return null;
  const out = typedFields(schedule, {
    programId: pickStr, startDateISO: pickStr, week: pickInt, day: pickInt,
    // Structured scalars only: a mesocycle OBJECT never travels (its internals
    // are UI state); scalars pass so the field stays honest.
    mesocycle: (v)=> (v == null || typeof v !== 'object') ? (v ?? null) : null,
    lastAdaptationBasis: pickStr,
  });
  out.sessions = (Array.isArray(schedule.sessions) ? schedule.sessions : [])
    .map(s => {
      if(!s || typeof s !== 'object') return null;
      const session = typedFields(s, {
        id: pickStr, dateISO: pickStr, programId: pickStr, programVersion: pickInt, templateVersion: pickInt,
        week: pickInt, day: pickInt, status: pickStr,
        mode: (v)=> vocabOne(v, MODE_IDS),
        blocks: (v)=> (Array.isArray(v) ? v : []).filter(b => b && typeof b === 'object').map(b => typedFields(b, {
          exerciseId: pickStr, sets: pickNum, reps: pickStr, restSec: pickInt, loadHint: pickStr,
          substitutionFrom: pickStr,
          substitutionReason: pickStr, // engine-written rationale, disclosed as programme metadata
        })),
      });
      return session;
    })
    .filter(Boolean);
  out.adaptationHistory = (Array.isArray(schedule.adaptationHistory) ? schedule.adaptationHistory : []).filter(a => a && typeof a === 'object').map(studyAdaptationEntry);
  out.lastAdaptation = schedule.lastAdaptation && typeof schedule.lastAdaptation === 'object' ? studyAdaptationEntry(schedule.lastAdaptation) : null;
  return out;
}
function buildStudyEventExport(events){
  // The privacy filter is the ERROR EXCLUSION, not the type list: `type` is
  // the app's own event taxonomy (recordEvent call sites, 30+ kinds — never
  // user-authored free text), so every product measurement travels and crash/
  // error diagnostics — plus any payload field outside the allowlist — stay
  // local.
  return (Array.isArray(events) ? events : [])
    .filter(e => e && typeof e === 'object' && e.type !== 'error')
    .map(e => typedFields(e, {
      id: pickStr, schemaVersion: pickInt,
      type: pickStr, // app event taxonomy id, never user-authored
      at: pickStr, ts: pickStr,
      sessionId: pickStr,
      mode: (v)=> vocabOne(v, MODE_IDS),
      elapsedMs: pickNum, setIndex: pickInt, durMs: pickNum,
      startedAtISO: pickStr, completedAtISO: pickStr,
    }));
}

export function buildStudyExportPayload(store){
  // Locks in the pseudonymous id (created at boot or on join) before the
  // snapshot is taken, so a study file can never lack an identity.
  ensureStudyParticipantId(store);
  const slice = {
    studyExportVersion: STUDY_EXPORT_VERSION,
    studyParticipantId: pickStr(store.studyParticipantId),
    // Lifecycle vocabulary only ('enrolled' | 'withdrawn'); anything else → null.
    studyStatus: vocabOne(store.studyStatus, STUDY_STATUS_IDS),
    // Timestamps: string or null — never an object/array.
    studyStatusChangedAtISO: pickStr(store.studyStatusChangedAtISO),
    studyEnrollment: buildStudyEnrollmentExport(store.studyEnrollment),
    // Recursively allowlisted, type-locked slices — never the raw stores.
    history: buildStudyHistoryExport(store.history),
    activeSchedule: buildStudyScheduleExport(store.activeSchedule),
    eventHistory: buildStudyEventExport(getEventHistory()),
    evaluationLedger: buildStudyLedgerExport(loadEvaluationLedger()),
    readinessLog: buildStudyReadinessExport(store.readinessLog),
    // The consent FACT only — never the toggles themselves (device-local).
    preferences: { telemetryEnabled: store?.preferences?.telemetryEnabled === true },
  };
  const envelope = buildEnvelope({
    payload: slice,
    payloadVersion: EXPORT_VERSION,
    schemaVersion: STORE_SCHEMA_VERSION,
  });
  // Keep the two timestamp layers in lockstep: ingestParticipantFiles derives
  // export ages from data.exportedAt, so a missing inner stamp would read as
  // "missing-export-timestamp" even though the envelope has one.
  envelope.data.exportedAt = envelope.exportedAt;
  return envelope;
}
