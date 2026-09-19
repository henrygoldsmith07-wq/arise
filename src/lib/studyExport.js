// studyExport.js — the study-export serializers, SPLIT OUT of export.js so
// they never bloat the boot chunk: MoreView loads this module on demand
// (dynamic import) when the participant taps Export study data. Operators
// consume the same module through scripts/ and tests/ — one definition,
// no duplicate allowlist.

import { STORE_SCHEMA_VERSION } from './store.js';
import { buildEnvelope } from './exportPolicy.js';
import { getEventHistory } from './telemetry.js';
import { loadEvaluationLedger } from './longitudinal.js';
import { ensureStudyParticipantId } from './studyIdentity.js';
import { EXPORT_VERSION } from './export.js';
export { EXPORT_VERSION } from './export.js';


// ── Study allowlists ────────────────────────────────────────────────────
// SCHEMA-VERSION INVARIANT: the study export is a recursively closed,
// versioned schema. EVERY nested structure (sessions, blocks, sets,
// prescriptions, ledger rows, enrollment, schedule adaptations) is rebuilt
// field-by-field here — never passed through by spread — so a future app
// feature cannot silently start riding in study exports. An intentional
// schema change therefore REQUIRES all of:
//   1. an explicit allowlist/serializer change in this block;
//   2. a matching update to tests/study-export.test.js (key-set + privacy
//      regression assertions);
//   3. a STUDY_EXPORT_VERSION bump when the material payload changes.
// Free text (session note, session title), note-tag LABELS, UI metadata,
// engine-facing prose and any unknown/extra field stay on the device.
export const STUDY_EXPORT_VERSION = 3; // v3: every nested slice recursively allowlisted

// Explicit allowlist pick: only named fields travel, only when present.
function pickFields(value, keys){
  if(!value || typeof value !== 'object') return value ?? null;
  const out = {};
  for(const key of keys){
    if(value[key] !== undefined) out[key] = value[key];
  }
  return out;
}
// Compact typed pickers for the recursive serializers: null/unknown → null
// (never a smuggled object or a coerced 0), a non-string never travels.
const pickNum = (v)=> (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const pickStr = (v)=> typeof v === 'string' ? v : null;
const pickBoolOr = (v, fallback = null)=> typeof v === 'boolean' ? v : fallback;
function pickArr(value, keys){
  return (Array.isArray(value) ? value : []).filter(x => x && typeof x === 'object').map(x => pickFields(x, keys));
}

// Fixed structured vocabularies. Unknown strings are DROPPED, not passed
// through: only these ids may ever appear in a study export. Kept in sync
// with the UI sources by tests/study-export.test.js (drift guard).
const NOTE_TAG_IDS = new Set(['felt-strong', 'felt-heavy', 'poor-sleep', 'short-on-time', 'form-focus', 'pain-discomfort']); // NOTE_PROMPTS
const QUALITY_IDS = new Set(['great', 'good', 'ok', 'rough']); // SESSION_QUALITY_OPTIONS
const MODE_IDS = new Set(['guided', 'gym', 'standard', 'short']);
const ARM_IDS = new Set(['arise', 'double-progression', 'linear-progression', 'fixed-rules', 'flat']);
const vocabList = (value, vocab)=> Array.isArray(value) ? value.filter(t => typeof t === 'string' && vocab.has(t)) : undefined;
const vocabOne = (value, vocab)=> typeof value === 'string' && vocab.has(value) ? value : null;

const STUDY_SET_KEYS = [
  // What was lifted (the app's canonical string-encoded numbers, '' = unset).
  'reps', 'weightKg', 'rpe', 'rom', 'assistedKg', 'tempo',
  // How the set resolved, plus per-set identity/provenance for analysis.
  'completed', 'skipped', 'failed', 'pain',
  'setId', 'origin', 'plannedSlot', 'governingPrescriptionId', 'side',
];

const STUDY_BLOCK_KEYS = [
  'exerciseId', 'exerciseOrder', 'sets',
  // Substitution + prescription audit metadata (engine-written).
  'substitutionFrom', 'substitutionReason', 'governedSlots', 'removedSlots',
  'prescription', 'prescriptionHistory', 'prescriptionOverridden', 'equipment',
];

const STUDY_SESSION_KEYS = [
  'id', 'dateISO', 'programId', 'programVersion', 'templateVersion',
  'week', 'day', 'status',
  'durationMinutes', 'startedAt', 'finishedAt', 'savedAt',
  'targetMinutes', 'originalDurationMin', 'rescheduledFrom',
  'equipmentSnapshot', 'exerciseOrder', 'substitutions',
  'painDiscomfort', 'skippedSetsCount', 'sessionDuration',
  'noteTags', 'blocks',
];

const STUDY_EVENT_KEYS = [
  'id', 'schemaVersion', 'type', 'at', 'ts',
  // Product-measurement payload fields the pilot reports read.
  'sessionId', 'mode', 'elapsedMs', 'setIndex', 'interactions', 'corrections',
  'startedAtISO', 'completedAtISO', 'durMs',
];

const STUDY_READINESS_KEYS = ['dateISO', 'score', 'sleep', 'soreness', 'motivation'];

const STUDY_SCHEDULE_KEYS = ['programId', 'startDateISO', 'week', 'day', 'mesocycle', 'lastAdaptationBasis'];
const STUDY_SCHEDULE_SESSION_KEYS = [
  'id', 'dateISO', 'programId', 'programVersion', 'templateVersion',
  'week', 'day', 'status', 'blocks',
]; // scheduled-session `mode` is vocabulary-checked separately
const STUDY_SCHEDULE_BLOCK_KEYS = ['exerciseId', 'sets', 'reps', 'restSec', 'loadHint', 'substitutionFrom', 'substitutionReason'];

// Prescription snapshots (progression.js buildPrescriptionSnapshot): the
// complete shown-target audit trail — every field is engine-written analysis
// input, so all of it travels; unknown additions do not.
const STUDY_PRESCRIPTION_KEYS = [
  'schemaVersion', 'prescriptionId', 'revision', 'supersedesPrescriptionId',
  'previousExerciseId', 'changeReason', 'source', 'sessionId', 'exerciseId',
  'blockIndex', 'prescribedSets', 'prescribedReps', 'prescribedRepRange',
  'prescribedLoadKg', 'prescribedAssistKg', 'rpeTarget', 'rirTarget',
  'shownAt', 'firstShownAt', 'createdAt', 'prescribedAt', 'priorCutoffDateISO',
  'engine', 'reason', 'confidence', 'uncertainty',
];

// ── Evaluation-ledger serializer ──────────────────────────────────────
// Exactly the fields the frozen analysis consumes: assigned-arm analysis,
// recommendation/outcome scoring, provenance, participant clustering,
// overrides, protocol/audit checks. Everything else (future fields, human-
// readable labelReason prose) is excluded — analysis recomputes grades from
// the numbers, so equivalence with the raw store is preserved (tested).
const studyProvenance = (p)=> {
  if(!p || typeof p !== 'object') return null;
  const out = { origin: vocabOne(p.origin, new Set(['live-engine', 'imported', 'replayed', 'seed'])), capturedAt: pickStr(p.capturedAt), deviceId: pickStr(p.deviceId) };
  if(p.exportVersion != null) out.exportVersion = pickNum(p.exportVersion);
  return out;
};
const studyRecPayload = (r)=> r && typeof r === 'object'
  ? { load: pickNum(r.load), reps: pickNum(r.reps), assistKg: pickNum(r.assistKg), reason: pickStr(r.reason) }
  : null;
const studyBasis = (b)=> b && typeof b === 'object'
  ? { visibleSessions: pickNum(b.visibleSessions),
      previousBest: b.previousBest && typeof b.previousBest === 'object'
        ? { reps: pickNum(b.previousBest.reps), weightKg: pickNum(b.previousBest.weightKg), assistedKg: pickNum(b.previousBest.assistedKg), e1rm: pickNum(b.previousBest.e1rm) }
        : null,
      trainingAgePhase: pickStr(b.trainingAgePhase), priorsVersion: pickNum(b.priorsVersion) }
  : null;
const studyPolicy = (p)=> p && typeof p === 'object'
  ? { id: pickStr(p.id), priorsVersion: pickNum(p.priorsVersion), modelVersion: pickNum(p.modelVersion) }
  : null;
// Audit block: policy identity, guard and confidence band — the fields the
// frozen analysis reads (evidenceMetrics bands, policy rollups). uncertainty/
// evidence have no consumers and personalCalibration carries UI prose; all
// three stay local. audit.confidence travels as the BAND STRING ONLY ('high'):
// the object form (score/slope/factors/personalCalibration) is local engine
// state and must never ride along — both analysis readers (confidenceBandOf,
// calibrationMetrics) accept the string form.
const studyAudit = (a)=> a && typeof a === 'object'
  ? { policy: pickStr(a.policy), policyVersion: pickNum(a.policyVersion),
      guard: pickStr(a.guard),
      confidence: vocabOne(a.confidence?.band, new Set(['high', 'medium', 'low', 'low-thin'])) }
  : null;
const studyArmRec = (a)=> a && typeof a === 'object'
  ? { load: pickNum(a.load), reps: pickNum(a.reps), assistKg: pickNum(a.assistKg) }
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
    load: pickNum(o.load), reps: pickNum(o.reps), assistedKg: pickNum(o.assistedKg), rpe: pickStr(o.rpe),
    sets: pickNum(o.sets), failedSets: pickNum(o.failedSets), volumeKg: pickNum(o.volumeKg),
    e1rm: pickNum(o.e1rm), previousE1rm: pickNum(o.previousE1rm), changePct: pickNum(o.changePct),
    metTarget: pickBoolOr(o.metTarget), followed: pickBoolOr(o.followed), deviationKg: pickNum(o.deviationKg),
    assignedMet: pickBoolOr(o.assignedMet), assignedArm: pickStr(o.assignedArm), userOverride: pickBoolOr(o.userOverride, false),
    pain: pickBoolOr(o.pain, false), techniqueWarning: pickBoolOr(o.techniqueWarning, false),
    repsMet: pickBoolOr(o.repsMet), loadMet: pickBoolOr(o.loadMet), assistMet: pickBoolOr(o.assistMet),
    loadErrorKg: pickNum(o.loadErrorKg), repError: pickNum(o.repError),
    classification: pickStr(o.classification), label: pickStr(o.label), attempted: pickBoolOr(o.attempted), gradeable: pickBoolOr(o.gradeable),
    // Shadow (counterfactual) baseline outcomes: { metTarget, loadErrorKg, repError } per known arm.
    arms: (()=>{ if(!o.arms || typeof o.arms !== 'object') return null; const out = {}; for(const arm of ARM_IDS){ if(o.arms[arm] !== undefined) out[arm] = { metTarget: pickBoolOr(o.arms[arm].metTarget), loadErrorKg: pickNum(o.arms[arm].loadErrorKg), repError: pickNum(o.arms[arm].repError) }; } return out; })(),
  };
}
function studyLedgerRow(row){
  if(!row || typeof row !== 'object') return null;
  return {
    id: pickStr(row.id), schemaVersion: pickNum(row.schemaVersion),
    recordedAtISO: pickStr(row.recordedAtISO), dueDateISO: pickStr(row.dueDateISO),
    exerciseId: pickStr(row.exerciseId), movementPattern: pickStr(row.movementPattern), equipmentClass: pickStr(row.equipmentClass),
    programId: pickStr(row.programId), programVersion: pickNum(row.programVersion),
    recommendation: studyRecPayload(row.recommendation), audit: studyAudit(row.audit),
    participantId: pickStr(row.participantId), assignedArm: pickStr(row.assignedArm), studyVersion: pickNum(row.studyVersion),
    // The arm's frozen prescription (what was actually enforced).
    prescription: row.prescription && typeof row.prescription === 'object'
      ? { arm: pickStr(row.prescription.arm), load: pickNum(row.prescription.load), reps: pickNum(row.prescription.reps), assistKg: pickNum(row.prescription.assistKg) }
      : null,
    prescriptionCreatedAt: pickStr(row.prescriptionCreatedAt),
    // Frozen prior-only baseline prescriptions (SHADOW analysis).
    arms: studyArms(row.arms), policy: studyPolicy(row.policy),
    recommendedAction: pickStr(row.recommendedAction), basis: studyBasis(row.basis),
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
        ? { arm: pickStr(a.arm), assignmentVersion: pickNum(a.assignmentVersion), assignedAtISO: pickStr(a.assignedAtISO) }
        : null;
    }
  }
  return {
    studyVersion: pickNum(e.studyVersion),
    participantId: pickStr(e.participantId), seed: e.seed != null ? e.seed : null,
    enrolledAtISO: pickStr(e.enrolledAtISO), startArm: pickStr(e.startArm),
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
    .map(s => ({ from: pickStr(s.from), to: pickStr(s.to), reason: pickStr(s.reason) }));
}
export function buildStudyHistoryExport(history){
  const out = [];
  for(const s of (Array.isArray(history) ? history : [])){
    if(!s || typeof s !== 'object') continue;
    const session = pickFields(s, STUDY_SESSION_KEYS);
    session.blocks = (Array.isArray(s.blocks) ? s.blocks : []).map(b => {
      if(!b || typeof b !== 'object') return null;
      const block = pickFields(b, STUDY_BLOCK_KEYS);
      block.sets = (Array.isArray(b.sets) ? b.sets : []).map(set => pickFields(set, STUDY_SET_KEYS));
      // Recursively closed prescription snapshots + history revisions.
      if(block.prescription !== undefined) block.prescription = pickFields(block.prescription, STUDY_PRESCRIPTION_KEYS);
      if(block.prescriptionHistory !== undefined) block.prescriptionHistory = pickArr(block.prescriptionHistory, STUDY_PRESCRIPTION_KEYS);
      return block;
    }).filter(Boolean);
    // Vocabulary-checked values are only written when the input carried them,
    // so exports stay minimal and no phantom keys appear. An invalid value
    // becomes null ("unknown"), never the raw string.
    if(s.mode !== undefined) session.mode = vocabOne(s.mode, MODE_IDS);
    if(s.quality !== undefined) session.quality = vocabOne(s.quality, QUALITY_IDS);
    if(s.noteTags !== undefined) session.noteTags = vocabList(s.noteTags, NOTE_TAG_IDS) || [];
    if(s.substitutions !== undefined) session.substitutions = studySubstitutions(s.substitutions);
    if(Array.isArray(session.equipmentSnapshot)) session.equipmentSnapshot = session.equipmentSnapshot.filter(x => typeof x === 'string');
    out.push(session);
  }
  return out;
}

// Readiness: only the protocol's structured signals travel — the derived
// score plus the three inputs it was computed from. No extra fields.
export function buildStudyReadinessExport(readinessLog){
  return (Array.isArray(readinessLog) ? readinessLog : [])
    .filter(r => r && typeof r === 'object')
    .map(r => pickFields(r, STUDY_READINESS_KEYS));
}

// Schedule adaptation entries: decision metadata the audit trail needs,
// rebuilt field-by-field (from/to geometry included; prose `reason` kept —
// engine-written substitution rationale, disclosed as programme metadata).
function studyAdaptationChange(c){
  const geometry = (g)=> g && typeof g === 'object' ? { sets: pickNum(g.sets), exerciseId: pickStr(g.exerciseId) } : (g == null ? null : g);
  return { sessionId: pickStr(c.sessionId), dateISO: pickStr(c.dateISO), exerciseId: pickStr(c.exerciseId), kind: pickStr(c.kind), from: geometry(c.from), to: geometry(c.to), reason: pickStr(c.reason), evidence: Array.isArray(c.evidence) ? c.evidence.filter(x => typeof x === 'string') : null };
}
function studyAdaptationEntry(e){
  if(!e || typeof e !== 'object') return null;
  return {
    basisKey: pickStr(e.basisKey), basisSessionId: pickStr(e.basisSessionId), dateISO: pickStr(e.dateISO),
    decision: e.decision && typeof e.decision === 'object'
      ? { deload: pickBoolOr(e.decision.deload, false), deloadSignals: Array.isArray(e.decision.deloadSignals) ? e.decision.deloadSignals.filter(x => typeof x === 'string') : [], confidence: pickStr(e.decision.confidence) }
      : null,
    changes: (Array.isArray(e.changes) ? e.changes : []).filter(c => c && typeof c === 'object').map(studyAdaptationChange),
  };
}
function buildStudyScheduleExport(schedule){
  if(!schedule || typeof schedule !== 'object') return null;
  const out = pickFields(schedule, STUDY_SCHEDULE_KEYS);
  if(out.mesocycle != null && typeof out.mesocycle === 'object') out.mesocycle = null; // structured scalars only
  out.sessions = (Array.isArray(schedule.sessions) ? schedule.sessions : [])
    .map(s => {
      if(!s || typeof s !== 'object') return null;
      const session = pickFields(s, STUDY_SCHEDULE_SESSION_KEYS);
      session.mode = vocabOne(s.mode, MODE_IDS);
      session.blocks = (Array.isArray(s.blocks) ? s.blocks : []).filter(b => b && typeof b === 'object').map(b => pickFields(b, STUDY_SCHEDULE_BLOCK_KEYS));
      return session;
    })
    .filter(Boolean);
  out.adaptationHistory = (Array.isArray(schedule.adaptationHistory) ? schedule.adaptationHistory : []).filter(a => a && typeof a === 'object').map(studyAdaptationEntry);
  out.lastAdaptation = schedule.lastAdaptation && typeof schedule.lastAdaptation === 'object' ? studyAdaptationEntry(schedule.lastAdaptation) : null;
  return out;
}
function buildStudyEventExport(events){
  return (Array.isArray(events) ? events : [])
    .filter(e => e && typeof e === 'object' && e.type !== 'error') // crash diagnostics stay local
    .map(e => pickFields(e, STUDY_EVENT_KEYS));
}

export function buildStudyExportPayload(store){
  // Locks in the pseudonymous id (created at boot or on join) before the
  // snapshot is taken, so a study file can never lack an identity.
  ensureStudyParticipantId(store);
  const slice = {
    studyExportVersion: STUDY_EXPORT_VERSION,
    studyParticipantId: store.studyParticipantId,
    studyStatus: store.studyStatus || null,
    studyStatusChangedAtISO: store.studyStatusChangedAtISO || null,
    studyEnrollment: buildStudyEnrollmentExport(store.studyEnrollment),
    // Recursively allowlisted slices — never the raw stores.
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



