// Study-export regression suite: the file a participant produces by following
// docs/PARTICIPANT_GUIDE.md EXACTLY must ingest through the real pilot
// pipeline with no manual conversion — and every warning/wording contract
// must mean what the docs say.
//
//   §1 dedicated study export (payload shape, identity, exportedAt, privacy)
//   §2 missing-export-timestamp semantics (not a "never exported" detector)
//   §3 abandonment warning on the true terminal denominator
//   §4/§5 guidance + privacy wording enforced against the actual artifacts
//   §6 numeric boundary — strict parsing: coercion truth tables + real-field injection
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildStudyExportPayload, buildStudyHistoryExport, buildStudyReadinessExport, STUDY_EXPORT_VERSION,
} from '../src/lib/studyExport.js';
import { ingestParticipantFiles } from '../src/lib/cohortOps.js';
import { buildPilotRoster } from '../src/lib/pilotHealth.js';
import { recordEvent } from '../src/lib/telemetry.js';
import { recordRecommendation, attachOutcome } from '../src/lib/longitudinal.js';
import { computeFieldStudy } from '../src/lib/fieldStudy.js';
import { measureProductSuccess } from '../src/lib/productSuccess.js';
import { isValidStudyParticipantId } from '../src/lib/studyIdentity.js';
import { KEY as STORE_KEY } from '../src/lib/store.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = (...parts) => join(HERE, '..', ...parts);

class Mem { constructor(){ this.map = new Map(); } getItem(k){ return this.map.has(k) ? this.map.get(k) : null; } setItem(k, v){ this.map.set(k, String(v)); } removeItem(k){ this.map.delete(k); } }
globalThis.localStorage = new Mem();

const ID = 'a1b2c3d4e5f60718'; // valid 16-hex pseudonymous id
const EXPORT_AT = '2026-03-09T08:00:00.000Z';
const NOW = '2026-03-09T12:00:00Z';

// A consented, joined participant's store, as it presents on-device.
function baseStore(){
  return {
    version: 9,
    studyParticipantId: ID,
    studyStatus: 'enrolled',
    studyEnrollment: { studyVersion: 1, enrolledAtISO: '2026-03-01T00:00:00.000Z', assignments: {} },
    preferences: { telemetryEnabled: true },
    history: [],
    activeSchedule: { programId: 'p1', startDateISO: '2026-03-01', sessions: [] },
    readinessLog: [],
  };
}

function session(n, dayISO){
  return { id: 's' + n, dateISO: dayISO, mode: 'guided', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '40', rpe: '' }] }] };
}

// One resolved arise-arm transition through the REAL pipeline (the same
// recordRecommendation → attachOutcome flow a training participant's device
// runs), persisted in the ledger storage the export builder reads.
function oneResolvedRow(storage, day = '2026-03-08'){
  const history = [{ id: 'h0', dateISO: '2026-03-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '40', rpe: '' }] }] }];
  recordRecommendation({
    exerciseId: 'bench-press-dumbbell',
    recommendation: { load: 42.5, reps: 8, reason: 'suite' },
    history,
    dueDateISO: day,
    preferences: { telemetryEnabled: true },
    nowISO: '2026-03-01T10:00:00.000Z',
    assignedArm: 'arise',
    participantId: ID,
    storage,
  });
  attachOutcome({
    sessionId: 'sess-' + day,
    dateISO: day,
    blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '42.5', rpe: '' }] }],
    preferences: { telemetryEnabled: true },
    nowISO: `${day}T10:00:00.000Z`,
    storage,
  });
}

// The file exactly as downloadJson produces it: stringified envelope.
function participantFile(envelope, name = 'arise-study-2026-03-09.json'){
  return { name, text: JSON.stringify(envelope) };
}

// Operator-side fixture (ingest-format package with a pinned export stamp).
function pkg(store, exportedAt = EXPORT_AT){
  return { name: (store.studyParticipantId || 'x').slice(0, 8) + '.json', text: JSON.stringify({ app: 'arise', exportedAt, data: { ...store, exportedAt } }) };
}

const stripTimestamps = (s) => s.replace(/"\d{4}-\d{2}-\d{2}T\d{2}:[^"]*"/g, '"<ts>"');

// ── §1 The dedicated study export ────────────────────────────────────────────
describe('§1 dedicated study export — the participant file IS the ingest file', ()=>{
  let storage;
  beforeEach(()=>{ storage = new Mem(); globalThis.localStorage = storage; });

  it('imports through real pilot ingestion with identity, metadata and evidence intact', ()=>{
    const store = baseStore();
    store.history.push(session(0, '2026-03-08'));
    oneResolvedRow(storage);

    const envelope = buildStudyExportPayload(store);
    const ingest = ingestParticipantFiles([participantFile(envelope)]);
    const kinds = ingest.warnings.map(w => w.kind);
    assert.equal(kinds.includes('conflicting-record'), false, JSON.stringify(ingest.warnings));
    assert.equal(kinds.includes('import-error'), false, JSON.stringify(ingest.warnings));

    assert.equal(ingest.participants.length, 1, 'one person, one participant');
    const p = ingest.participants[0];
    assert.equal(isValidStudyParticipantId(p.studyParticipantId), true, 'pseudonymous id survives');
    assert.equal(p.store.studyStatus, 'enrolled', 'lifecycle travels');
    assert.ok(p.store.studyEnrollment, 'frozen enrollment travels');
    assert.equal(p.store.preferences.telemetryEnabled, true, 'consent FACT restored');
    assert.equal(p.store.history.length, 1, 'training history travels');
    const rows = p.store.evaluationLedger.filter(r => r.assignedArm === 'arise');
    assert.equal(rows.length, 1, 'the resolved transition arrives ingestible');
    assert.ok(rows[0].outcome, 'row is resolved');
    assert.equal(p.firstExportedAtISO, envelope.data.exportedAt, 'export age derives from the export stamp');
  });

  it('carries exportedAt at both envelope layers plus a versioned schema', ()=>{
    const envelope = buildStudyExportPayload(baseStore());
    assert.ok(envelope.exportedAt, 'envelope-level exportedAt present');
    assert.equal(envelope.data.exportedAt, envelope.exportedAt, 'inner exportedAt in lockstep (ingest reads data.exportedAt)');
    assert.equal(envelope.data.studyExportVersion, STUDY_EXPORT_VERSION, 'schema is versioned');
    assert.ok(isValidStudyParticipantId(envelope.data.studyParticipantId), 'id is pinned before snapshot');
  });

  it('excludes backup-only private data (profile, templates, credentials, health)', ()=>{
    const store = {
      ...baseStore(),
      onboarding: { name: 'P', goal: 'muscle' },
      preferences: { telemetryEnabled: true, sync: { url: 'https://dav.example', username: 'u', password: 'p' } },
      customTemplates: [{ id: 't1', title: 'Peaking' }],
      healthSummary: { restingHr: 51 },
    };
    const data = buildStudyExportPayload(store).data;
    assert.equal('onboarding' in data, false, 'onboarding profile excluded');
    assert.equal('customTemplates' in data, false, 'custom templates excluded');
    assert.equal('healthSummary' in data, false, 'health summary excluded');
    assert.equal('sync' in data.preferences, false, 'credentials never travel');
    assert.equal(JSON.stringify(data).includes('https://dav.example'), false);
  });

  it('carries product events but never crash/error diagnostics', ()=>{
    const store = baseStore();
    globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({ version: 9, preferences: { telemetryEnabled: true, telemetryOptions: { errorDiagnostics: true, sessionTimings: true } } }));
    recordEvent('error', { message: 'boom' });
    recordEvent('set:complete', { sessionId: 'x1' });
    const text = JSON.stringify(buildStudyExportPayload(store));
    assert.equal(/"type":"error"/.test(text), false, 'error diagnostics excluded');
    assert.equal(text.includes('boom'), false, 'error payloads excluded');
    assert.equal(/"type":"set:complete"/.test(text), true, 'product measurements travel');
  });

  it('is deterministic for the same logical content', ()=>{
    const a = JSON.stringify(buildStudyExportPayload(baseStore()));
    const b = JSON.stringify(buildStudyExportPayload(baseStore()));
    assert.equal(stripTimestamps(a), stripTimestamps(b), 'two exports differ only in timestamps');
  });

  it('repeated study exports fold into ONE participant', ()=>{
    const store = baseStore();
    store.history.push(session(0, '2026-03-08'));
    const env2 = buildStudyExportPayload(store);
    // A week later: distinct stamps (two exports in the same millisecond are
    // byte-identical and correctly treated as a duplicate FILE, not a fold).
    env2.exportedAt = '2026-03-16T08:00:00.000Z';
    env2.data.exportedAt = env2.exportedAt;
    const ingest = ingestParticipantFiles([
      participantFile(buildStudyExportPayload(store), 'arise-study-2026-03-09.json'),
      participantFile(env2, 'arise-study-2026-03-16.json'),
    ]);
    assert.equal(ingest.participants.length, 1, 'same id → one participant, never two');
    assert.equal(ingest.participants[0].sourceFiles.length, 2, 'both files folded');
  });
});

// ── §2 missing-export-timestamp semantics ────────────────────────────────────
describe('§2 missing-export-timestamp semantics', ()=>{
  it('flags a file without a usable export stamp as missing-export-timestamp, not never-exported', ()=>{
    const envelope = buildStudyExportPayload(baseStore());
    delete envelope.exportedAt;
    delete envelope.data.exportedAt;
    const ingest = ingestParticipantFiles([participantFile(envelope, 'arise-study-nostamp.json')]);
    const r = buildPilotRoster(ingest.participants, { nowISO: NOW }).roster[0];
    assert.equal(r.warnings.includes('missing-export-timestamp'), true, JSON.stringify(r.warnings));
    assert.equal(r.warnings.includes('never-exported'), false, 'the retired flag name must not reappear');
  });

  it('a normally stamped export never gets the missing-timestamp flag', ()=>{
    const store = baseStore();
    store.history.push(session(0, '2026-03-08'));
    const ingest = ingestParticipantFiles([participantFile(buildStudyExportPayload(store))]);
    const r = buildPilotRoster(ingest.participants, { nowISO: '2026-09-19T00:00:00Z' }).roster[0];
    assert.equal(r.warnings.includes('missing-export-timestamp'), false, JSON.stringify(r.warnings));
    assert.equal(r.warnings.includes('stale-export'), false, JSON.stringify(r.warnings));
  });
});

// ── §3 abandonment warning on the true terminal denominator ──────────────────
describe('§3 abandonment warning uses the terminal denominator', ()=>{
  it('1 abandoned + 3 unresolved starts does NOT trigger high-abandonment', ()=>{
    const store = baseStore();
    store.history.push(session(0, '2026-03-08'));
    const events = [];
    for(let i = 0; i < 3; i++) events.push({ id: 'st' + i, type: 'session:start', sessionId: 'u' + i });
    events.push({ id: 'sa', type: 'session:start', sessionId: 'a0' });
    events.push({ id: 'ab', type: 'session:abandon', sessionId: 'a0' });
    const ingest = ingestParticipantFiles([pkg(store)]);
    ingest.participants[0].store.eventHistory = events;
    const r = buildPilotRoster(ingest.participants, { nowISO: NOW }).roster[0];
    assert.equal(r.unresolvedStarts, 3, 'unresolved starts are surfaced, never hidden');
    assert.equal(r.warnings.some(w => w.startsWith('high-abandonment')), false,
      'unresolved starts must not satisfy the volume floor: ' + JSON.stringify(r.warnings));
  });

  it('3 abandoned + 1 completed DOES trigger high-abandonment-75pct', ()=>{
    const store = baseStore();
    store.history.push(session(0, '2026-03-08'));
    const events = [];
    for(let i = 0; i < 3; i++){
      events.push({ id: 'st' + i, type: 'session:start', sessionId: 'a' + i });
      events.push({ id: 'ab' + i, type: 'session:abandon', sessionId: 'a' + i });
    }
    events.push({ id: 'st9', type: 'session:start', sessionId: 'c9' });
    events.push({ id: 'sc9', type: 'session:complete', sessionId: 'c9' });
    const ingest = ingestParticipantFiles([pkg(store)]);
    ingest.participants[0].store.eventHistory = events;
    const r = buildPilotRoster(ingest.participants, { nowISO: NOW }).roster[0];
    assert.equal(r.warnings.includes('high-abandonment-75pct'), true, JSON.stringify(r.warnings));
  });
});

// ── §4/§5 guidance and privacy wording ───────────────────────────────────────
describe('§4/§5 guidance and privacy wording stay honest', ()=>{
  const guide = readFileSync(root('docs', 'PARTICIPANT_GUIDE.md'), 'utf8');
  const more = readFileSync(root('src', 'components', 'MoreView.jsx'), 'utf8');

  it('documents the exact eligibility gates', ()=>{
    assert.match(guide, /Local measurement consent is on/);
    assert.match(guide, /At least 3 logged workouts/);
    assert.match(guide, /Join the study/);
  });

  it('never describes the backup as the study export', ()=>{
    assert.match(more, /Export study data/, 'the UI exposes the dedicated action');
    assert.match(more, /arise-study-/, 'the UI downloads the documented filename');
    assert.match(guide, /Export study data/);
    assert.match(guide, /is a different file/, 'guide distinguishes backup from study export');
    assert.doesNotMatch(guide, /Backup & portability → Export.*study contribution/);
    assert.doesNotMatch(more, /backup[^]*?IS your study contribution/i);
  });

  it('withdrawal section: assignments stop, history preserved, shared files need operator-side deletion', ()=>{
    assert.match(guide, /Stops future study assignments/);
    assert.match(guide, /Preserves your local history/);
    assert.match(guide, /ask the study team to delete their files/, 'shared copies are deleted operator-side, not locally');
  });

  it('no local-deletion claim reaches copies already shared', ()=>{
    for(const [name, text] of [['PARTICIPANT_GUIDE.md', guide], ['MoreView.jsx', more]]){
      assert.doesNotMatch(text, /removes it everywhere/, name);
      assert.match(text, /outside the app|cannot reach/, name + ' states the shared-copy limit');
    }
  });
});

// ── § recursive closure: nested allowlists + vocabularies + ledger lock ────
// The export is a recursively closed, versioned schema: every nested structure
// is rebuilt field-by-field. Injecting a private/future field at ANY nesting
// level must leave it stranded on the device.
describe('§ recursive closure — no nested passthrough, vocabularies locked', ()=>{
  // A store with private probes injected at EVERY documented nesting level.
  function deeplyPrivateStore(){
    const store = baseStore();
    store.history.push({
      id: 's-deep', dateISO: '2026-03-08', programId: 'p1', programVersion: 3, templateVersion: 2,
      week: 1, day: 1, title: 'PRIVATE TITLE', mode: 'guided', status: 'done',
      durationMinutes: 40, startedAt: '2026-03-08T09:00:00.000Z', finishedAt: '2026-03-08T09:40:00.000Z', savedAt: '2026-03-08T09:40:00.000Z',
      equipmentSnapshot: ['barbell'], exerciseOrder: ['bench-press-dumbbell'], painDiscomfort: false,
      skippedSetsCount: 0, sessionDuration: 40, quality: 'good',
      note: 'PRIVATE TEXT about my knee',
      noteTags: ['felt-strong', 'PRIVATE USER TEXT'],          // unknown tag dropped
      substitutions: [{ from: 'a', to: 'b', reason: 'engine', privateField: 'PRIVATE SUB' }],
      aFutureSessionField: 'PRIVATE SESSION FUTURE',
      blocks: [{
        exerciseId: 'bench-press-dumbbell', exerciseOrder: 0, equipment: 'barbell',
        substitutionFrom: null, substitutionReason: null, aFutureBlockField: 'PRIVATE BLOCK FUTURE',
        prescription: { prescriptionId: 'rx1', revision: 1, prescribedReps: 8, prescribedLoadKg: 40, shownAt: '2026-03-01T09:00:00.000Z', reason: 'engine', engine: { name: 'arise-engine', policy: 'standard' }, privateField: 'PRIVATE RX' },
        prescriptionHistory: [{ prescriptionId: 'rx0', revision: 0, shownAt: '2026-03-01T08:00:00.000Z', privateField: 'PRIVATE RXH' }],
        sets: [{ reps: '8', weightKg: '40', rpe: '7', completed: true, setId: 'set1', aFutureSetField: 'PRIVATE SET FUTURE' }],
      }],
    });
    store.readinessLog = [{ dateISO: '2026-03-08', score: 70, sleep: 4, soreness: 2, motivation: 4, moodFreeText: 'PRIVATE MOOD' }];
    store.studyEnrollment = {
      studyVersion: 1, participantId: ID, seed: 12345, enrolledAtISO: '2026-03-01T00:00:00.000Z', startArm: 'arise',
      policyVersions: { arise: 'priors-v7', doubleProgression: 'dp-v2' }, targetDefinition: 'meaningful-gain',
      meaningfulGainThreshold: 0.02, analysisCodeVersion: 'v1',
      assignments: { 'bench-press-dumbbell': { arm: 'arise', assignmentVersion: 1, assignedAtISO: '2026-03-01T00:00:00.000Z' } },
      privateField: 'PRIVATE ENROLLMENT',
    };
    store.evaluationLedger = [{
      id: 'r-deep', schemaVersion: 2, recordedAtISO: '2026-03-01T10:00:00.000Z', dueDateISO: '2026-03-08',
      exerciseId: 'bench-press-dumbbell', movementPattern: 'horizontal-push', equipmentClass: 'barbell',
      programId: 'p1', programVersion: 3,
      recommendation: { load: 40, reps: 8, reason: 'engine reason', strategy: 'progress', privateComment: 'PRIVATE REC' },
      audit: { policy: 'arise-engine', policyVersion: 3, guard: null, confidence: { band: 'high', slope: 0.5 }, uncertainty: null, evidence: null, personalCalibration: { active: false, direction: 'up', jumpMultiplier: 1, samples: 3, headline: 'PRIVATE HEADLINE' }, privateAuditField: 'PRIVATE AUDIT' },
      assignedArm: 'arise', participantId: ID, studyVersion: 1,
      prescription: { arm: 'arise', load: 40, reps: 8, privateField: 'PRIVATE PRESCRIP' },
      prescriptionCreatedAt: '2026-03-01T10:00:00.000Z',
      arms: { arise: { load: 40, reps: 8, assistKg: null, reason: 'engine', noisy: [], held: false }, 'double-progression': { load: 40, reps: 9, reason: 'baseline' }, rogueArm: { load: 1, reps: 1, reason: 'PRIVATE ROGUE' } },
      policy: { id: 'arise-engine', priorsVersion: 7, modelVersion: 2 },
      recommendedAction: 'progress',
      basis: { visibleSessions: 3, previousBest: { reps: 8, weightKg: 37.5, assistedKg: null, e1rm: 41.2 }, trainingAgePhase: 'novice', priorsVersion: 7, privateField: 'PRIVATE BASIS' },
      userOverride: false, privateField: 'PRIVATE ROW',
      provenance: { origin: 'live-engine', capturedAt: '2026-03-01T10:00:00.000Z', deviceId: 'dev-x' },
      outcomeProvenance: { origin: 'live-engine', capturedAt: '2026-03-02T10:00:00.000Z', deviceId: 'dev-x' },
      outcome: { sessionId: 's-deep', dateISO: '2026-03-08', recordedAtISO: '2026-03-08T10:00:00.000Z', load: 40, reps: 8, rpe: '7', sets: 1, failedSets: 0, volumeKg: 320, e1rm: 42.3, previousE1rm: 41.2, changePct: 0.0267, metTarget: true, followed: true, assignedMet: true, assignedArm: 'arise', userOverride: false, pain: false, techniqueWarning: false, classification: 'progression-success', label: 'met-target-progressed', labelReason: 'PRIVATE PROSE', attempted: true, gradeable: true, privateField: 'PRIVATE OUTCOME',
        arms: { arise: { metTarget: true, loadErrorKg: 0, repError: 0 }, rogue: { metTarget: true, privateField: 'PRIVATE ARMOUT' } } },
    }];
    store.activeSchedule = {
      programId: 'p1', startDateISO: '2026-03-01', week: 1, mesocycle: { weekIndex: 1 },
      sessions: [{ id: 'w1d1', dateISO: '2026-03-08', programId: 'p1', week: 1, day: 1, mode: 'guided', status: 'planned', title: 'PRIVATE SCHED TITLE', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12', restSec: 90, loadHint: 'barbell', privateField: 'PRIVATE SBLOCK' }] }],
      adaptationHistory: [{ basisKey: 'k1', basisSessionId: 's-deep', dateISO: '2026-03-08', decision: { deload: false, deloadSignals: [], confidence: 'low' }, changes: [{ sessionId: 'w1d1', dateISO: '2026-03-09', exerciseId: 'bench-press-dumbbell', kind: 'repeated-difficulty', from: { sets: 3 }, to: { sets: 2 }, reason: 'engine decided', evidence: ['difficulty'], privateField: 'PRIVATE CHANGE' }], privateField: 'PRIVATE ADAPT' }],
      lastAdaptation: { basisKey: 'k1', dateISO: '2026-03-08', decision: { deload: false }, changes: [] },
      lastAdaptationBasis: 'k1',
    };
    return store;
  }

  const PROBES = [
    'PRIVATE TEXT', 'PRIVATE TITLE', 'PRIVATE USER TEXT', 'PRIVATE SUB', 'PRIVATE SESSION FUTURE',
    'PRIVATE BLOCK FUTURE', 'PRIVATE RX', 'PRIVATE RXH', 'PRIVATE SET FUTURE', 'PRIVATE MOOD',
    'PRIVATE ENROLLMENT', 'PRIVATE REC', 'PRIVATE AUDIT', 'PRIVATE HEADLINE', 'PRIVATE PRESCRIP',
    'PRIVATE ROGUE', 'PRIVATE BASIS', 'PRIVATE ROW', 'PRIVATE OUTCOME', 'PRIVATE ARMOUT',
    'PRIVATE PROSE', 'PRIVATE SCHED TITLE', 'PRIVATE SBLOCK', 'PRIVATE ADAPT', 'PRIVATE CHANGE',
    'rogueArm',      'labelReason',           // outcome free-text reason — excluded
      '"confidence":{',   // audit.confidence OBJECT form never travels; the locked
                          // row carries only the band STRING under the same key
                          // (row.audit.confidence === 'high', see key-set test)
      '"evidence":{',     // audit.evidence OBJECT form never travels; the locked
                          // changes[].evidence is a string ARRAY (key-set test)
      'uncertainty', 'personalCalibration', 'privateAuditField',
      'privateField', 'privateComment', 'headline',
    ];
    // Structural probes ('"confidence":{', '"evidence":{') target the OBJECT
    // forms that must never ride along — the plain key names legitimately
    // appear in the locked schema as reduced string/scalar forms.

    it('private fields injected at every nesting level never appear in the exported JSON', ()=>{
      const store = deeplyPrivateStore();
      globalThis.localStorage.setItem('arise.evaluation.v1', JSON.stringify(store.evaluationLedger));
      const json = JSON.stringify(buildStudyExportPayload(store));
      for(const secret of PROBES){
        assert.equal(json.includes(secret), false, `"${secret}" leaked through a nested passthrough`);
      }
    });

  it('unknown vocabulary strings are dropped; valid ids and labels never travel', ()=>{
    const data = buildStudyExportPayload(deeplyPrivateStore()).data;
    assert.deepEqual(data.history[0].noteTags, ['felt-strong'], 'only real NOTE_PROMPTS ids survive');
    assert.equal(data.history[0].mode, 'guided');
    assert.equal(data.history[0].quality, 'good');
    assert.equal(data.history[0].note, undefined, 'free text stays local');
    assert.equal(data.history[0].title, undefined, 'title stays local');
  });

  it('evaluation ledger is locked to the analysis schema with exact key sets', ()=>{
    const store = deeplyPrivateStore();
    globalThis.localStorage.setItem('arise.evaluation.v1', JSON.stringify(store.evaluationLedger));
    const data = buildStudyExportPayload(store).data;
    const row = data.evaluationLedger[0];
    assert.deepEqual(Object.keys(row).sort(), [
      'assignedArm', 'arms', 'audit', 'basis', 'dueDateISO', 'equipmentClass', 'exerciseId', 'id',
      'movementPattern', 'outcome', 'outcomeProvenance', 'participantId',
      'policy', 'prescription', 'prescriptionCreatedAt', 'programId',
      'programVersion', 'provenance', 'recommendation', 'recordedAtISO',
      'recommendedAction', 'schemaVersion', 'studyVersion', 'userOverride',
    ].sort());
    assert.deepEqual(Object.keys(row.recommendation).sort(), ['assistKg', 'load', 'reason', 'reps']);
    assert.deepEqual(Object.keys(row.audit).sort(), ['confidence', 'guard', 'policy', 'policyVersion']);
    assert.deepEqual(row.audit.confidence, 'high', 'audit.confidence reduced to its band string form in the ledger row');
    // The full personalCalibration object (incl. its UI-prose headline) must NOT travel:
    assert.equal(row.audit.personalCalibration, undefined, 'personalCalibration stays local — only band string in audit');
    assert.deepEqual(Object.keys(row.prescription).sort(), ['arm', 'assistKg', 'load', 'reps']);
    assert.deepEqual(Object.keys(row.arms).sort(), ['arise', 'double-progression'], 'rogue baseline arms dropped, real arms kept');
    assert.deepEqual(Object.keys(row.arms.arise).sort(), ['assistKg', 'load', 'reps']);
    assert.deepEqual(Object.keys(row.basis).sort(), ['priorsVersion', 'previousBest', 'trainingAgePhase', 'visibleSessions'].sort());
    assert.deepEqual(Object.keys(row.outcome).sort(), [
      'assignedArm', 'assignedMet', 'assistMet', 'arms', 'attempted', 'classification',
      'changePct', 'dateISO', 'deviationKg', 'e1rm', 'failedSets', 'followed', 'gradeable',
      'label', 'load', 'loadErrorKg', 'loadMet', 'metTarget', 'pain', 'previousE1rm',
      'recordedAtISO', 'repError', 'reps', 'repsMet', 'sessionId', 'sets', 'techniqueWarning',
      'userOverride', 'volumeKg', 'rpe', 'assistedKg',
    ].sort(), 'outcome rebuilt, nothing extra');
    assert.deepEqual(row.outcome.arms.arise, { metTarget: true, loadErrorKg: 0, repError: 0 });
    assert.deepEqual(row.outcome.arms.arise, { metTarget: true, loadErrorKg: 0, repError: 0 });
    assert.deepEqual(Object.keys(row.provenance).sort(), ['capturedAt', 'deviceId', 'origin']);
    const enrollment = data.studyEnrollment;
    assert.deepEqual(Object.keys(enrollment).sort(), ['analysisCodeVersion', 'assignments', 'enrolledAtISO', 'meaningfulGainThreshold', 'participantId', 'policyVersions', 'seed', 'startArm', 'studyVersion', 'targetDefinition']);
    assert.deepEqual(Object.keys(enrollment.assignments['bench-press-dumbbell']).sort(), ['arm', 'assignedAtISO', 'assignmentVersion']);
  });

  it('schedule adaptations and nested scheduled blocks are rebuilt, not passed through', ()=>{
    const sched = buildStudyExportPayload(deeplyPrivateStore()).data.activeSchedule;
    assert.deepEqual(Object.keys(sched).sort(), ['adaptationHistory', 'lastAdaptation', 'lastAdaptationBasis', 'mesocycle', 'programId', 'sessions', 'startDateISO', 'week']);
    assert.equal(sched.mesocycle, null, 'structured scalars only');
    assert.equal('title' in sched.sessions[0], false);
    assert.deepEqual(Object.keys(sched.sessions[0].blocks[0]).sort(), ['exerciseId', 'loadHint', 'reps', 'restSec', 'sets']);
    const adapt = sched.adaptationHistory[0];
    assert.deepEqual(Object.keys(adapt).sort(), ['basisKey', 'basisSessionId', 'changes', 'dateISO', 'decision']);
    assert.deepEqual(Object.keys(adapt.changes[0]).sort(), ['dateISO', 'evidence', 'exerciseId', 'from', 'kind', 'reason', 'sessionId', 'to']);
    assert.deepEqual(Object.keys(adapt.decision).sort(), ['confidence', 'deload', 'deloadSignals']);
  });

  it('raw-store analysis equals study-export analysis for the frozen study outputs', ()=>{
    const store = deeplyPrivateStore();
    // The live builder reads the ledger from its storage key.
    globalThis.localStorage.setItem('arise.evaluation.v1', JSON.stringify(store.evaluationLedger));
    const json = JSON.stringify(buildStudyExportPayload(store));
    globalThis.localStorage.setItem('arise.evaluation.v1', '[]');
    const ingest = ingestParticipantFiles([{ name: 'deep.json', text: json }]);
    const p = ingest.participants[0];
    const gates = { minParticipants: 1, minTransitions: 1 };
    const raw = computeFieldStudy([{ code: 'a1b2c3d4', store }], gates);
    const san = computeFieldStudy([{ code: 'a1b2c3d4', store: p.store }], gates);
    const pc = r => r.totals.primaryComparison;
    assert.equal(san.status, raw.status);
    assert.equal(pc(san).transitions, pc(raw).transitions);
    assert.equal(san.gates.participants, raw.gates.participants);
    const m1 = measureProductSuccess(store, { nowISO: '2026-09-19' });
    const m2 = measureProductSuccess(p.store, { nowISO: '2026-09-19' });
    assert.equal(m2.sessionsLogged, m1.sessionsLogged);
    assert.deepEqual(m2.completion, m1.completion);
    assert.deepEqual(m2.overrideRate, m1.overrideRate);
    assert.equal(san.participants[0].weeksObserved, raw.participants[0].weeksObserved);
    assert.equal(ingest.warnings.length, 0, JSON.stringify(ingest.warnings));
  });

  it('schema-version invariant is documented next to the serializers', ()=>{
    const src = readFileSync(root('src', 'lib', 'studyExport.js'), 'utf8');
    assert.match(src, /SCHEMA-VERSION INVARIANT/, 'the invariant comment exists');
    assert.match(src, /STUDY_EXPORT_VERSION bump/, 'the invariant names the version bump');
    assert.match(src, /tests\/study-export\.test\.js/, 'the invariant names the test file');
  });
});

// ── § export minimisation: allowlists, disclosure contract ──────────────────
// Everything in the study file must be study-required AND disclosed. History,
// readiness, schedule and events travel as explicit allowlist slices — never
// object spreads — so free text, future app fields and whole store categories
// cannot silently start riding along.
describe('§ export minimisation — only disclosed, study-required data leaves', ()=>{
  function richPrivateStore(){
    const store = baseStore();
    store.history.push({
      id: 's-rich', dateISO: '2026-03-08', programId: 'p1', programVersion: 3, templateVersion: 2,
      week: 1, day: 1, title: 'PRIVATE TITLE heavy day', mode: 'guided', status: 'done',
      durationMinutes: 44, startedAt: '2026-03-08T09:00:00.000Z', finishedAt: '2026-03-08T09:44:00.000Z', savedAt: '2026-03-08T09:44:00.000Z',
      equipmentSnapshot: ['barbell'], exerciseOrder: ['bench-press-dumbbell'], painDiscomfort: true,
      skippedSetsCount: 0, sessionDuration: 44, quality: 'solid',
      note: 'PRIVATE TEXT about my knee', noteTags: ['pain-discomfort'],
      substitutions: [{ from: 'squat-rack-404', to: 'bench-press-dumbbell', reason: 'engine kept it' }],
      aFutureSessionField: 'PRIVATE SESSION FUTURE',
      blocks: [{
        exerciseId: 'bench-press-dumbbell', exerciseOrder: 0, substitutionFrom: null, substitutionReason: null,
        prescription: { prescriptionId: 'rx1', prescribedReps: 8, prescribedLoadKg: 40, shownAt: '2026-03-01T09:00:00.000Z', reason: 'engine reason', engine: { name: 'arise-engine', policy: 'standard' } },
        prescriptionOverridden: false, equipment: 'barbell', aFutureBlockField: 'PRIVATE BLOCK FUTURE',
        sets: [{ reps: '8', weightKg: '40', rpe: '7', completed: true, skipped: false, failed: false, pain: true, setId: 'set1', origin: 'prescribed', plannedSlot: 0, governingPrescriptionId: 'rx1', side: null, rom: null, assistedKg: null, tempo: null, aFutureSetField: 'PRIVATE SET FUTURE' }],
      }],
    });
    store.readinessLog = [{ dateISO: '2026-03-08', score: 70, sleep: 4, soreness: 2, motivation: 4, moodFreeText: 'PRIVATE MOOD', deviceStress: 3 }];
    store.activeSchedule = { programId: 'p1', startDateISO: '2026-03-01', week: 1,
      sessions: [{ id: 'w1d1', dateISO: '2026-03-08', programId: 'p1', week: 1, day: 1, mode: 'guided', status: 'planned', title: 'PRIVATE SCHEDULE TITLE', blocks: [] }] };
    store.onboarding = { name: 'PRIVATE NAME', goal: 'muscle' };
    store.customTemplates = [{ id: 't1', title: 'PRIVATE TEMPLATE' }];
    store.healthSummary = { restingHr: 50, sleepHours: 7 };
    store.preferences = { telemetryEnabled: true, sync: { url: 'https://dav.example', username: 'u', password: 'p' } };
    return store;
  }

  it('session.note "PRIVATE TEXT" and every free-text field never appear in the exported JSON', ()=>{
    const store = richPrivateStore();
    const json = JSON.stringify(buildStudyExportPayload(store));
    for(const secret of [
      'PRIVATE TEXT',        // the required probe: session.note
      'PRIVATE TITLE',       // session title
      'PRIVATE SCHEDULE TITLE',
      'PRIVATE MOOD',        // readiness free text
      'PRIVATE SESSION FUTURE', 'PRIVATE BLOCK FUTURE', 'PRIVATE SET FUTURE', // unknown future fields
      'PRIVATE NAME', 'PRIVATE TEMPLATE', 'https://dav.example', // profile/templates/credentials
    ]){
      assert.equal(json.includes(secret), false, `"${secret}" must never leave the device`);
    }
  });

  it('excludes onboarding, credentials, health summary, crash diagnostics and unknown fields; keeps required evidence', ()=>{
    const store = richPrivateStore();
    globalThis.localStorage.setItem('arise.telemetry.v2', JSON.stringify({ version: 2, events: [
      { id: 'e1', type: 'session:start', sessionId: 's-rich', at: '2026-03-08T09:00:00.000Z', moodNote: 'PRIVATE EVENT' },
      { id: 'e2', type: 'error', message: 'crash boom' },
      { id: 'e3', type: 'session:complete', sessionId: 's-rich', at: '2026-03-08T09:44:00.000Z' },
    ] }));
    const data = buildStudyExportPayload(store).data;
    // Excluded categories:
    assert.equal('onboarding' in data, false);
    assert.equal('customTemplates' in data, false);
    assert.equal('healthSummary' in data, false);
    const text = JSON.stringify(data);
    assert.equal(text.includes('crash boom'), false, 'error diagnostics excluded');
    assert.equal(text.includes('PRIVATE EVENT'), false, 'unknown event fields excluded');
    assert.equal(data.eventHistory.some(e => e.type === 'error'), false);
    // Required evidence survives the allowlist:
    const s = data.history[0];
    assert.equal(s.id, 's-rich');
    assert.equal(s.mode, 'guided');
    assert.equal(s.durationMinutes, 44);
    assert.deepEqual(s.noteTags, ['pain-discomfort'], 'structured tags travel; free text does not');
    assert.deepEqual(s.substitutions, [{ from: 'squat-rack-404', to: 'bench-press-dumbbell', reason: 'engine kept it' }]);
    const b = s.blocks[0], set = b.sets[0];
    assert.equal(b.exerciseId, 'bench-press-dumbbell');
    assert.equal(b.prescription.prescriptionId, 'rx1', 'prescription snapshot travels');
    assert.deepEqual({ reps: set.reps, weightKg: set.weightKg, rpe: set.rpe, completed: set.completed, skipped: set.skipped, failed: set.failed, pain: set.pain, setId: set.setId },
      { reps: '8', weightKg: '40', rpe: '7', completed: true, skipped: false, failed: false, pain: true, setId: 'set1' });
    const r = data.readinessLog[0];
    assert.deepEqual(Object.keys(r).sort(), ['dateISO', 'motivation', 'score', 'sleep', 'soreness'], 'readiness is exactly the protocol fields');
    assert.equal(data.eventHistory.some(e => e.type === 'session:complete'), true, 'product measurements travel');
  });

  it('serialisers are direct allowlists: unknown keys dropped, known keys kept', ()=>{
    const rows = buildStudyHistoryExport([{ id: 'h', dateISO: '2026-03-08', mode: 'guided', note: 'PRIVATE', blocks: [{ exerciseId: 'x', sets: [{ reps: '5', weightKg: '60', note2: 'PRIVATE2' }] }], futureField: 'F' }]);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['blocks', 'dateISO', 'id', 'mode']);
    assert.deepEqual(Object.keys(rows[0].blocks[0].sets[0]).sort(), ['reps', 'weightKg']);
    const r = buildStudyReadinessExport([{ dateISO: 'd', score: 1, sleep: 2, soreness: 3, motivation: 4, extra: 'PRIVATE' }]);
    assert.deepEqual(Object.keys(r[0]).sort(), ['dateISO', 'motivation', 'score', 'sleep', 'soreness']);
  });

  it('disclosure contract: every exported category is stated in participant-facing study copy', ()=>{
    const guide = readFileSync(root('docs', 'PARTICIPANT_GUIDE.md'), 'utf8');
    const more = readFileSync(root('src', 'components', 'MoreView.jsx'), 'utf8');
    // The five exported categories, each present in both surfaces:
    const categories = [
      [/Workout structure and performance/i, 'workout structure + performance'],
      [/Recommendation\/outcome evidence|recommendation evidence/i, 'recommendation/outcome evidence'],
      [/Readiness check-ins[^.]*structured/i, 'structured readiness inputs'],
      [/Logging\/timing measurements|timing of how long logging takes/i, 'logging/timing measurements'],
      [/Programme adjustment metadata|substituted or adapted/i, 'programme adjustment metadata'],
      [/Study lifecycle metadata|pseudonymous/i, 'study lifecycle metadata'],
    ];
    for(const [re, label] of categories){
      assert.match(guide, re, `PARTICIPANT_GUIDE.md must disclose: ${label}`);
      assert.match(more, re, `study card must disclose: ${label}`);
    }
    // The never-included list in both surfaces, incl. the readiness honesty fix:
    for(const [name, text] of [['PARTICIPANT_GUIDE.md', guide], ['MoreView.jsx', more]]){
      assert.match(text, /free-text notes|free text/i, name);
      assert.match(text, /health-platform/i, name + ' discloses health-platform data is not exported');
      assert.match(text, /crash diagnostics|crash/i, name);
      assert.match(text, /sleep, soreness, motivation/, name + ' names the readiness inputs that DO travel');
    }
  });
});

// ── § malicious shapes fail closed: scalars are type-locked at the boundary ─
// Every scalar slot must reject objects/arrays/unknown strings: a hostile or
// future value can never ride through a typed field into the study file.
describe('§ malicious shapes fail closed — scalars type-locked', ()=>{
  let storage;
  beforeEach(()=>{ storage = new Mem(); globalThis.localStorage = storage; });

  function hostileStore(){
    const store = baseStore();
    store.studyStatus = { privateField: 'PRIVATE' };
    store.studyStatusChangedAtISO = ['PRIVATE'];
    store.studyEnrollment = {
      studyVersion: 1, participantId: ID, seed: { privateField: 'PRIVATE' },
      enrolledAtISO: { privateField: 'PRIVATE' }, startArm: { privateField: 'PRIVATE' },
      targetDefinition: ['PRIVATE'], analysisCodeVersion: { privateField: 'PRIVATE' },
      meaningfulGainThreshold: 'not-a-number',
      policyVersions: { arise: { deep: 'PRIVATE' }, doubleProgression: 7 },
      assignments: { 'bench-press-dumbbell': { arm: { privateField: 'PRIVATE' }, assignmentVersion: 'x', assignedAtISO: 42 } },
      rogue: 'PRIVATE ENROLLMENT ROGUE',
    };
    store.history = [{
      id: { privateField: 'PRIVATE' }, dateISO: ['PRIVATE'], mode: { privateField: 'PRIVATE' },
      quality: 5, status: { s: 'PRIVATE' }, note: 'PRIVATE TEXT', title: 'PRIVATE TITLE',
      durationMinutes: { ms: 'PRIVATE' }, painDiscomfort: 'yes', skippedSetsCount: 1.5,
      equipmentSnapshot: ['barbell', { privateField: 'PRIVATE' }], exerciseOrder: [1, { privateField: 'PRIVATE' }],
      blocks: [{
        exerciseId: 9, equipment: ['PRIVATE'], exerciseOrder: 'two', prescriptionOverridden: 'nope',
        substitutionFrom: { privateField: 'PRIVATE' }, substitutionReason: ['PRIVATE'],
        governedSlots: [0, 'one', { privateField: 'PRIVATE' }], removedSlots: 'nope',
        prescription: { prescriptionId: 'rx1', revision: 1, shownAt: '2026-03-01T09:00:00.000Z', reason: 'engine reason', source: { privateField: 'PRIVATE' }, schemaVersion: 'nan', confidence: { band: 'high', slope: 0.5, privateField: 'PRIVATE' }, uncertainty: { pct: 3, privateField: 'PRIVATE' }, engine: { name: 'arise-engine', priorsVersion: 7, privateField: 'PRIVATE' }, rogue: 'PRIVATE RX ROGUE' },
        prescriptionHistory: [{ prescriptionId: 'rx0', revision: 0, privateField: 'PRIVATE' }, 'junk', 7],
        sets: [{ reps: '8', weightKg: '40', rpe: '7', completed: true, setId: 'set1', origin: 'prescribed', plannedSlot: 0, completed2: 'PRIVATE', aFutureSetField: 'PRIVATE SET FUTURE' }, 'junk', 9],
        aFutureBlockField: 'PRIVATE BLOCK FUTURE',
      }],
      substitutions: [{ from: 'a', to: 'b', reason: 'engine decided', rogue: 'PRIVATE SUB' }],
      aFutureSessionField: 'PRIVATE SESSION FUTURE',
    }];
    store.readinessLog = [{ dateISO: '2026-03-08', score: 70, sleep: 4, soreness: 2, motivation: 4, moodFreeText: 'PRIVATE MOOD' }];
    store.activeSchedule = {
      programId: { privateField: 'PRIVATE' }, startDateISO: 20260301, week: 'one', day: null,
      mesocycle: { weekIndex: 1, privateField: 'PRIVATE MESOCYCLE' },
      sessions: [{ id: 'w1d1', dateISO: '2026-03-08', mode: 'guided', status: { s: 'PRIVATE' }, title: 'PRIVATE SCHEDULE TITLE', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8-12', restSec: 90, loadHint: { privateField: 'PRIVATE' } }] }],
      adaptationHistory: [{ basisKey: 'k1', dateISO: '2026-03-08', decision: { deload: false, deloadSignals: ['difficulty'], confidence: { band: 'low', slope: 1 } }, changes: [{ sessionId: 'w1d1', dateISO: '2026-03-09', exerciseId: 'bench-press-dumbbell', kind: 'repeated-difficulty', from: { sets: 3 }, to: { sets: 2 }, reason: 'engine decided', evidence: ['difficulty', 5, { privateField: 'PRIVATE' }], rogue: 'PRIVATE CHANGE' }] }],
      lastAdaptation: 'not-an-object',
    };
    store.preferences = { telemetryEnabled: true, sync: { password: 'PRIVATE CREDENTIALS' } };
    return store;
  }

  function hostileLedger(){
    return [{
      id: 'r1', schemaVersion: 2, recordedAtISO: '2026-03-01T10:00:00.000Z', dueDateISO: '2026-03-08',
      exerciseId: 'bench-press-dumbbell', movementPattern: 'horizontal-push', equipmentClass: 'barbell',
      programId: 'p1', programVersion: 3,
      recommendation: { load: 40, reps: 8, reason: 'engine reason' },
      audit: { policy: 'arise-engine', policyVersion: 3, confidence: { band: 'high', slope: 0.5, personalCalibration: { headline: 'PRIVATE HEADLINE' } }, uncertainty: { pct: 3 }, rogue: 'PRIVATE AUDIT' },
      assignedArm: { privateField: 'PRIVATE' }, studyVersion: 1, participantId: ID,
      prescription: { arm: ['PRIVATE'], load: 40, reps: 8 },
      recommendedAction: { action: 'PRIVATE' },
      arms: { arise: { load: 40, reps: 8 }, rogueArm: { load: 1, privateField: 'PRIVATE ROGUE' } },
      basis: { visibleSessions: 3, previousBest: { reps: 8, weightKg: 37.5, e1rm: 41.2 }, trainingAgePhase: 'novice', priorsVersion: 7 },
      userOverride: false,
      provenance: { origin: 'live-engine', capturedAt: '2026-03-01T10:00:00.000Z', deviceId: 'dev-x' },
      outcomeProvenance: { origin: ['PRIVATE'] },
      outcome: { sessionId: 's1', dateISO: '2026-03-08', load: 40, reps: 8, rpe: '7', sets: 1, failedSets: 0, volumeKg: 320, e1rm: 42.3, previousE1rm: 41.2, changePct: 0.0267, metTarget: true, followed: true, assignedMet: true, assignedArm: { privateField: 'PRIVATE' }, userOverride: false, pain: false, techniqueWarning: false, classification: 'progression-success', label: 'successful', labelReason: 'PRIVATE PROSE', attempted: true, gradeable: true, rogue: 'PRIVATE OUTCOME',
        arms: { arise: { metTarget: true, loadErrorKg: 0, repError: 0 }, rogue: { metTarget: true, privateField: 'PRIVATE ARMOUT' } } },
    }];
  }

  function hostileEvents(){
    return [
      { id: 'e1', type: 'set:complete', sessionId: 's1', at: '2026-03-08T09:00:00.000Z', elapsedMs: 3000, setIndex: 0, mode: 'gym', moodNote: 'PRIVATE EVENT', interactions: { n: 'PRIVATE' }, corrections: ['PRIVATE'], durMs: { privateField: 'PRIVATE' }, setIndex2: undefined },
      { id: 'e2', type: 'error', message: 'crash boom PRIVATE' },
      { id: 'e3', type: 'never-seen-before', rogue: 'PRIVATE FUTURE EVENT' },
      'junk-string', 42, null,
    ];
  }

  it('hostile scalars, objects and arrays never reach the exported JSON; valid scalars survive', ()=>{
    const store = hostileStore();
    globalThis.localStorage.setItem('arise.evaluation.v1', JSON.stringify(hostileLedger()));
    globalThis.localStorage.setItem('arise.telemetry.v2', JSON.stringify({ version: 2, events: hostileEvents() }));
    const json = JSON.stringify(buildStudyExportPayload(store));
    // No private probe of any shape may appear anywhere:
    for(const secret of ['PRIVATE', 'privateField', 'rogue', 'labelReason', 'uncertainty', 'crash boom', 'headline']){
      assert.equal(json.includes(secret), false, `"${secret}" leaked through a hostile scalar`);
    }
    // Valid scalars in the SAME store are preserved (fail closed ≠ fail empty):
    const data = buildStudyExportPayload(store).data;
    assert.equal(data.studyParticipantId, ID);
    assert.equal(data.studyStatus, null, 'hostile studyStatus → null');
    assert.equal(data.studyStatusChangedAtISO, null, 'hostile timestamp → null');
    const e = data.studyEnrollment;
    assert.equal(e.seed, null, 'hostile seed object → null');
    assert.equal(e.startArm, null, 'hostile startArm object → null');
    assert.equal(e.participantId, ID, 'valid participantId survives beside hostile siblings');
    assert.equal(e.assignments['bench-press-dumbbell'].arm, null, 'hostile assignment arm → null');
    const s = data.history[0];
    assert.equal(s.mode, null, 'hostile mode object → null');
    assert.equal(s.durationMinutes, null, 'hostile number object → null');
    assert.equal(s.skippedSetsCount, null, 'non-integer count → null');
    assert.equal(s.equipmentSnapshot.length, 1, 'non-string array members dropped, strings kept');
    const b = s.blocks[0], rx = b.prescription;
    assert.equal(b.exerciseId, null, 'hostile block id → null');
    assert.equal(rx.prescriptionId, 'rx1', 'valid prescription fields survive');
    assert.equal(rx.confidence, 'high', 'engine confidence object → band string only');
    assert.equal(rx.engine.name, 'arise-engine', 'engine block rebuilt scalar-by-scalar');
    assert.equal('uncertainty' in rx, false, 'prescription uncertainty never travels');
    assert.equal(b.sets.length, 1, 'non-object set dropped');
    assert.equal(b.sets[0].reps, '8');
    assert.deepEqual(data.readinessLog[0], { dateISO: '2026-03-08', score: 70, sleep: 4, soreness: 2, motivation: 4 });
    assert.equal(data.activeSchedule.mesocycle, null, 'mesocycle object → null');
    assert.equal(data.activeSchedule.adaptationHistory[0].changes[0].from.sets, 3, 'valid geometry survives hostile siblings');
    const row = data.evaluationLedger[0];
    assert.equal(row.assignedArm, null, 'hostile ledger assignedArm object → null');
    assert.equal(row.prescription.arm, null, 'hostile prescription arm array → null');
    assert.equal(row.recommendedAction, null, 'hostile recommendedAction object → null');
    assert.equal(row.audit.confidence, 'high', 'audit confidence object → band string');
    assert.equal(row.outcome.assignedArm, null, 'hostile outcome assignedArm → null');
    assert.equal('rogueArm' in row.arms, false, 'unknown arm dropped');
    assert.equal(data.eventHistory.length, 2, 'error event dropped; product + unknown taxonomy types travel field-stripped');
    assert.equal(data.eventHistory[0].type, 'set:complete');
    assert.deepEqual(Object.keys(data.eventHistory[1]).sort(), ['id', 'schemaVersion', 'type'], 'unknown event type carries no payload fields (telemetry stamps its own schemaVersion)');
    assert.equal('interactions' in data.eventHistory[0], false, 'dead/unknown event payload keys dropped');
    assert.equal(data.preferences.telemetryEnabled, true, 'consent fact survives hostile prefs');
    assert.equal('sync' in data.preferences, false, 'credentials never travel');
  });

  it('valid scalars in a clean store round-trip exactly (no over-blocking)', ()=>{
    const store = baseStore();
    store.studyStatusChangedAtISO = '2026-03-01T00:00:00.000Z';
    store.studyEnrollment = {
      ...store.studyEnrollment,
      seed: 'priors-v7::a1b2c3d4e5f60718::v1',
      startArm: 'arise',
      assignments: { 'bench-press-dumbbell': { arm: 'arise', assignmentVersion: 1, assignedAtISO: '2026-03-01T00:00:00.000Z' } },
    };
    store.history.push({
      id: 's-clean', dateISO: '2026-03-08', programId: 'p1', programVersion: 3, week: 1, day: 1,
      status: 'done', mode: 'guided', quality: 'good', durationMinutes: 44, painDiscomfort: true,
      skippedSetsCount: 2, equipmentSnapshot: ['barbell'], noteTags: ['felt-strong', 'nope-not-real'],
      blocks: [{ exerciseId: 'bench-press-dumbbell', exerciseOrder: 0, governedSlots: [0, 2], equipment: 'barbell',
        prescription: { prescriptionId: 'rx1', revision: 1, source: 'engine', shownAt: '2026-03-01T09:00:00.000Z', reason: 'engine', confidence: { band: 'medium' }, engine: { name: 'arise-engine', priorsVersion: 7 } },
        sets: [{ reps: '8', weightKg: '40', rpe: '7', completed: true, setId: 'set1', origin: 'user-added', plannedSlot: null }] }],
      substitutions: [{ from: 'squat-rack-404', to: 'bench-press-dumbbell', reason: 'engine kept it' }],
    });
    store.evaluationLedger = [{
      id: 'r-clean', schemaVersion: 2, recordedAtISO: '2026-03-01T10:00:00.000Z', dueDateISO: '2026-03-08',
      exerciseId: 'bench-press-dumbbell', movementPattern: 'horizontal-push', equipmentClass: 'barbell',
      programId: 'p1', programVersion: 3,
      recommendation: { load: 42.5, reps: 8, reason: 'suite' },
      audit: { policy: 'arise-engine', policyVersion: 3, guard: null, confidence: { band: 'low-thin' } },
      assignedArm: 'arise', participantId: ID, studyVersion: 1,
      prescription: { arm: 'arise', load: 40, reps: 8, assistKg: null },
      recommendedAction: 'reduce_assistance',
      arms: { arise: { load: 40, reps: 8, assistKg: null }, 'double-progression': { load: 40, reps: 9 } },
      basis: { visibleSessions: 3, previousBest: { reps: 8, weightKg: 37.5, assistedKg: null, e1rm: 41.2 }, trainingAgePhase: 'novice', priorsVersion: 7 },
      userOverride: false,
      provenance: { origin: 'live-engine', capturedAt: '2026-03-01T10:00:00.000Z', deviceId: 'dev-x' },
      outcomeProvenance: { origin: 'live-engine', capturedAt: '2026-03-02T10:00:00.000Z', deviceId: 'dev-x' },
      outcome: { sessionId: 's-clean', dateISO: '2026-03-08', load: 40, reps: 8, rpe: '7', sets: 1, failedSets: 0, volumeKg: 320, e1rm: 42.3, previousE1rm: 41.2, changePct: 0.0267, metTarget: true, followed: true, assignedMet: true, assignedArm: 'arise', userOverride: false, pain: false, techniqueWarning: false, classification: 'progression-success', label: 'too-conservative', attempted: true, gradeable: true,
        arms: { arise: { metTarget: true, loadErrorKg: 0, repError: 0 } } },
    }];
    globalThis.localStorage.setItem('arise.evaluation.v1', JSON.stringify(store.evaluationLedger));
    const data = buildStudyExportPayload(store).data;
    assert.equal(data.studyStatus, 'enrolled');
    assert.equal(data.studyStatusChangedAtISO, '2026-03-01T00:00:00.000Z');
    const e = data.studyEnrollment;
    assert.equal(typeof e.seed, 'string', 'canonical string seed travels');
    assert.equal(e.startArm, 'arise');
    assert.equal(e.assignments['bench-press-dumbbell'].arm, 'arise');
    const s = data.history[0];
    assert.equal(s.mode, 'guided');
    assert.equal(s.quality, 'good');
    assert.equal(s.durationMinutes, 44);
    assert.equal(s.skippedSetsCount, 2);
    assert.deepEqual(s.noteTags, ['felt-strong'], 'unknown note tag dropped, real tag kept');
    const rx = s.blocks[0].prescription;
    assert.equal(rx.source, 'engine');
    assert.equal(rx.confidence, 'medium', 'engine confidence object → band string');
    assert.equal(rx.engine.priorsVersion, 7);
    assert.deepEqual(s.blocks[0].governedSlots, [0, 2]);
    assert.deepEqual(s.substitutions, [{ from: 'squat-rack-404', to: 'bench-press-dumbbell', reason: 'engine kept it' }]);
    const row = data.evaluationLedger[0];
    assert.equal(row.assignedArm, 'arise');
    assert.equal(row.prescription.arm, 'arise');
    assert.equal(row.recommendedAction, 'reduce_assistance');
    assert.equal(row.audit.confidence, 'low-thin');
    assert.equal(row.outcome.classification, 'progression-success');
    assert.equal(row.outcome.label, 'too-conservative');
    assert.equal(row.outcome.assignedArm, 'arise');
    assert.deepEqual(Object.keys(row.arms).sort(), ['arise', 'double-progression']);
  });
});

// ── §6 Numeric boundary — strict parsing, zero coercion ─────────────────────
// The numeric pickers in studyExport.js never call Number(v): the old coercion
// accepted [] → 0, ['3'] → 3, true → 1, false → 0, '   ' → 0, '3 ' → 3 and
// valueOf-thunks → their result. The contract now: a numeric export slot
// accepts only finite JS numbers (integer slots additionally Number.isInteger);
// every coercible value fails closed to null. Numeric strings are NOT accepted
// because no exported numeric field is written as a string by the app — the
// canonical string-encoded numbers are the SET-level reps/weightKg/rpe/rom/
// assistedKg/tempo, which travel as strings by design (re-pinned below). The
// pickers stay module-private on purpose; these tests exercise the real
// serializers — the boundary contract is what the serializers accept.
const HOSTILE = ['', '   ', '3 ', ' 3', '3x', 'e', '3', '3.5', '0x10', '1e3', [], ['3'], ['3', 'x'], {}, { valueOf(){ return 3; } }, true, false, NaN, Infinity, -Infinity];
const fmt = (v)=> Array.isArray(v) ? JSON.stringify(v) : (v && typeof v === 'object' ? '{object}' : String(v));
const NUM_SLOTS = ['durationMinutes', 'targetMinutes', 'originalDurationMin', 'sessionDuration'];
const INT_SLOTS = ['week', 'day', 'programVersion', 'templateVersion', 'skippedSetsCount'];

describe('§6 numeric boundary — coercible values fail closed to null', ()=>{
  let storage;
  beforeEach(()=>{ storage = new Mem(); globalThis.localStorage = storage; });

  describe('direct serializers (no JSON round-trip): the truth tables', ()=>{
    it('number fields reject every coercible value and every numeric string', ()=>{
      for(const v of HOSTILE){
        const s = { id: 'probe', dateISO: '2026-03-08', blocks: [] };
        for(const k of NUM_SLOTS) s[k] = v;
        const [out] = buildStudyHistoryExport([s]);
        for(const k of NUM_SLOTS) assert.equal(out[k], null, `${k}: ${fmt(v)} → null`);
      }
    });

    it('integer fields reject every coercible value; fractional and numeric strings never pass', ()=>{
      for(const v of HOSTILE){
        const s = { id: 'probe', dateISO: '2026-03-08', blocks: [] };
        for(const k of INT_SLOTS) s[k] = v;
        const [out] = buildStudyHistoryExport([s]);
        for(const k of INT_SLOTS) assert.equal(out[k], null, `${k}: ${fmt(v)} → null`);
      }
    });

    it('readiness numbers reject every coercible value', ()=>{
      for(const v of HOSTILE){
        const [out] = buildStudyReadinessExport([{ dateISO: '2026-03-08', score: v, sleep: v, soreness: v, motivation: v }]);
        assert.deepEqual(out, { dateISO: '2026-03-08', score: null, sleep: null, soreness: null, motivation: null }, `${fmt(v)} → null`);
      }
    });

    it('canonical numbers travel: 3 → 3, 3.5 → 3.5, 0 → 0, -2.25 → -2.25', ()=>{
      const [out] = buildStudyHistoryExport([{ id: 'probe', dateISO: '2026-03-08', blocks: [], week: 3, day: 0, programVersion: 2, templateVersion: 5, skippedSetsCount: 0, durationMinutes: 3, targetMinutes: 3.5, originalDurationMin: 0, sessionDuration: -2.25 }]);
      assert.equal(out.week, 3);
      assert.equal(out.day, 0);
      assert.equal(out.programVersion, 2);
      assert.equal(out.templateVersion, 5);
      assert.equal(out.skippedSetsCount, 0);
      assert.equal(out.durationMinutes, 3);
      assert.equal(out.targetMinutes, 3.5);
      assert.equal(out.originalDurationMin, 0);
      assert.equal(out.sessionDuration, -2.25);
      const [rdy] = buildStudyReadinessExport([{ dateISO: '2026-03-08', score: 3, sleep: 3.5, soreness: 0, motivation: -2.25 }]);
      assert.deepEqual(rdy, { dateISO: '2026-03-08', score: 3, sleep: 3.5, soreness: 0, motivation: -2.25 });
    });

    it('integer fields additionally require Number.isInteger: 3 → 3, 3.5 → null, "3.5" → null', ()=>{
      const [out] = buildStudyHistoryExport([{ id: 'probe', dateISO: '2026-03-08', blocks: [], week: 3, day: 3.5, programVersion: '3.5', templateVersion: '3' }]);
      assert.equal(out.week, 3);
      assert.equal(out.day, null);
      assert.equal(out.programVersion, null);
      assert.equal(out.templateVersion, null);
    });

    it('set-level canonical string numbers are untouched: "8"/"42.5"/"7.5" travel as strings', ()=>{
      const [out] = buildStudyHistoryExport([{ id: 'probe', dateISO: '2026-03-08', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '42.5', rpe: '7.5', rom: '95', assistedKg: '', tempo: '301' }] }] }]);
      const st = out.blocks[0].sets[0];
      assert.equal(st.reps, '8');
      assert.equal(st.weightKg, '42.5');
      assert.equal(st.rpe, '7.5');
      assert.equal(st.rom, '95');
      assert.equal(st.assistedKg, '', 'canonical unset form stays ""');
      assert.equal(st.tempo, '301');
    });
  });

  describe('real nested injection through buildStudyExportPayload', ()=>{
    // Poisons EVERY numeric export slot with one hostile value P and re-asserts
    // the full shape. Values that survive a JSON round-trip (a corrupted or
    // migrated store can only carry these through the real storage paths) are
    // seeded via localStorage; NaN/Infinity are included too — they arrive as
    // null through JSON and must still export null (their direct rejection is
    // proven above, where no round-trip intervenes).
    function poison(P){
      const store = baseStore();
      const rx = {
        prescriptionId: 'rx1', schemaVersion: P, revision: P, blockIndex: P, prescribedSets: P,
        prescribedReps: P, prescribedLoadKg: P, prescribedAssistKg: P, rpeTarget: P, rirTarget: P,
        source: 'engine', shownAt: '2026-03-01T09:00:00.000Z', reason: 'suite',
        confidence: { band: 'high' }, engine: { name: 'arise-engine', priorsVersion: P, policyVersion: P, modelVersion: P },
      };
      store.history.push({
        id: 'h-poison', dateISO: '2026-03-08', programId: 'p1', status: 'done', mode: 'guided',
        programVersion: P, templateVersion: P, week: P, day: P,
        durationMinutes: P, targetMinutes: P, originalDurationMin: P, sessionDuration: P, skippedSetsCount: P,
        blocks: [{ exerciseId: 'bench-press-dumbbell', exerciseOrder: P, governedSlots: [P], removedSlots: [P],
          prescription: rx, prescriptionHistory: [rx],
          sets: [{ reps: '8', weightKg: '40', rpe: '', completed: true, setId: 'set1', plannedSlot: P }] }],
      });
      store.activeSchedule = {
        programId: 'p1', startDateISO: '2026-03-01', week: P, day: P, mesocycle: null, lastAdaptation: null,
        sessions: [{ id: 'sc-poison', dateISO: '2026-03-09', programId: 'p1', programVersion: P, templateVersion: P, week: P, day: P, status: 'planned',
          blocks: [{ exerciseId: 'bench-press-dumbbell', sets: P, reps: '8-10', restSec: P, loadHint: '40' }] }],
        adaptationHistory: [{ basisKey: 'k', basisSessionId: 'h0', dateISO: '2026-03-08',
          decision: { deload: false, confidence: { band: 'medium' } },
          changes: [{ sessionId: 'h0', dateISO: '2026-03-08', exerciseId: 'bench-press-dumbbell', kind: 'weekly-sets',
            from: { sets: P, exerciseId: 'bench-press-dumbbell' }, to: { sets: 3, exerciseId: 'bench-press-dumbbell' }, reason: 'suite', evidence: ['x'] }] }],
      };
      store.readinessLog.push({ dateISO: '2026-03-08', score: P, sleep: P, soreness: P, motivation: P });
      store.studyEnrollment = {
        studyVersion: P, participantId: ID, seed: 'base::p::v1', enrolledAtISO: '2026-03-01T00:00:00.000Z',
        startArm: 'arise', targetDefinition: 'e1rm', analysisCodeVersion: 'a1', meaningfulGainThreshold: P,
        assignments: { 'bench-press-dumbbell': { arm: 'arise', assignmentVersion: P, assignedAtISO: '2026-03-01T00:00:00.000Z' } },
      };
      globalThis.localStorage.setItem('arise.telemetry.v2', JSON.stringify({ version: 2, events: [
        { id: 'ev-poison', schemaVersion: P, type: 'set:complete', at: '2026-03-08T10:00:00.000Z', sessionId: 'h-poison', elapsedMs: P, setIndex: P, durMs: P },
      ] }));
      globalThis.localStorage.setItem('arise.evaluation.v1', JSON.stringify({ schemaVersion: 2, records: [{
        id: 'r-poison', schemaVersion: P, recordedAtISO: '2026-03-01T10:00:00.000Z', dueDateISO: '2026-03-08',
        exerciseId: 'bench-press-dumbbell', movementPattern: 'horizontal-push', equipmentClass: 'barbell',
        programId: 'p1', programVersion: P, studyVersion: P,
        recommendation: { load: P, reps: P, assistKg: P, reason: 'suite' },
        audit: { policy: 'arise-engine', policyVersion: P, guard: null, confidence: { band: 'low' } },
        assignedArm: 'arise', participantId: ID, prescription: { arm: 'arise', load: P, reps: P, assistKg: P },
        prescriptionCreatedAt: '2026-03-01T10:00:00.000Z', recommendedAction: 'reduce_assistance',
        basis: { visibleSessions: P, trainingAgePhase: 'novice', priorsVersion: P, previousBest: { reps: P, weightKg: P, assistedKg: P, e1rm: P } },
        policy: { id: 'arise-engine', priorsVersion: P, modelVersion: P },
        arms: { arise: { load: P, reps: P, assistKg: P }, 'double-progression': { load: P, reps: P, assistKg: P } },
        provenance: { origin: 'live-engine', capturedAt: '2026-03-01T10:00:00.000Z', deviceId: 'dev-x' },
        outcomeProvenance: null,
        outcome: { sessionId: 'h-poison', dateISO: '2026-03-08', recordedAtISO: '2026-03-01T12:00:00.000Z',
          load: P, reps: P, assistedKg: P, rpe: '', sets: P, failedSets: P, volumeKg: P, e1rm: P, previousE1rm: P, changePct: P,
          deviationKg: P, loadErrorKg: P, repError: P, metTarget: true, followed: true, assignedArm: 'arise', userOverride: false, pain: false, techniqueWarning: false,
          classification: 'progression-success', label: 'successful', attempted: true, gradeable: true,
          arms: { arise: { metTarget: true, loadErrorKg: P, repError: P } } },
      }] }));
      return store;
    }

    it('every poisoned numeric slot exports null; canonical siblings survive; no malformed value reaches the JSON', ()=>{
      for(const P of HOSTILE){
        const data = buildStudyExportPayload(poison(P)).data;

        // Version unchanged: strict parsing is not a schema-meaning change.
        assert.equal(data.studyExportVersion, STUDY_EXPORT_VERSION);

        const s = data.history[0];
        for(const k of [...NUM_SLOTS, ...INT_SLOTS]) assert.equal(s[k], null, `history.${k}: ${fmt(P)}`);
        const b = s.blocks[0], rxOut = b.prescription;
        assert.equal(b.exerciseOrder, null);
        assert.deepEqual(b.governedSlots, [], 'non-integer array members filtered');
        assert.deepEqual(b.removedSlots, []);
        for(const k of ['schemaVersion', 'revision', 'blockIndex', 'prescribedSets', 'prescribedReps', 'prescribedLoadKg', 'prescribedAssistKg', 'rpeTarget', 'rirTarget']) assert.equal(rxOut[k], null, `prescription.${k}: ${fmt(P)}`);
        assert.equal(rxOut.engine.priorsVersion, null);
        assert.equal(rxOut.engine.policyVersion, null);
        assert.equal(rxOut.engine.modelVersion, null);
        assert.equal(rxOut.engine.name, 'arise-engine', 'sibling strings survive');
        assert.equal(b.prescriptionHistory[0].prescribedLoadKg, null);
        assert.equal(b.sets[0].plannedSlot, null);
        assert.equal(b.sets[0].reps, '8', 'set-level canonical strings survive poisoned numerics');

        const sched = data.activeSchedule, ss = sched.sessions[0];
        assert.equal(sched.week, null);
        assert.equal(sched.day, null);
        for(const k of ['programVersion', 'templateVersion', 'week', 'day']) assert.equal(ss[k], null, `schedule session.${k}: ${fmt(P)}`);
        assert.equal(ss.blocks[0].sets, null, 'schedule block.sets: poisoned → null');
        assert.equal(ss.blocks[0].restSec, null);
        assert.equal(ss.blocks[0].reps, '8-10', 'string sibling survives');
        assert.equal(sched.adaptationHistory[0].changes[0].from.sets, null);
        assert.equal(sched.adaptationHistory[0].changes[0].to.sets, 3, 'canonical geometry survives');

        assert.deepEqual(data.readinessLog[0], { dateISO: '2026-03-08', score: null, sleep: null, soreness: null, motivation: null });

        const en = data.studyEnrollment;
        assert.equal(en.studyVersion, null);
        assert.equal(en.meaningfulGainThreshold, null);
        assert.equal(en.assignments['bench-press-dumbbell'].assignmentVersion, null);
        assert.equal(en.assignments['bench-press-dumbbell'].arm, 'arise', 'vocabulary sibling survives');

        const ev = data.eventHistory[0];
        for(const k of ['schemaVersion', 'elapsedMs', 'setIndex', 'durMs']) assert.equal(ev[k], null, `event.${k}: ${fmt(P)}`);
        assert.equal(ev.type, 'set:complete');

        const row = data.evaluationLedger[0];
        for(const k of ['schemaVersion', 'programVersion', 'studyVersion']) assert.equal(row[k], null, `ledger row.${k}: ${fmt(P)}`);
        assert.equal(row.recommendation.load, null);
        assert.equal(row.recommendation.reps, null);
        assert.equal(row.recommendation.assistKg, null);
        assert.equal(row.recommendation.reason, 'suite', 'sibling string survives');
        assert.equal(row.audit.policyVersion, null);
        assert.equal(row.audit.confidence, 'low', 'band survives');
        assert.equal(row.basis.visibleSessions, null);
        assert.equal(row.basis.priorsVersion, null);
        assert.equal(row.basis.previousBest.reps, null);
        assert.equal(row.basis.previousBest.weightKg, null);
        assert.equal(row.basis.previousBest.e1rm, null);
        assert.equal(row.policy.priorsVersion, null);
        assert.equal(row.policy.modelVersion, null);
        assert.equal(row.policy.id, 'arise-engine');
        for(const arm of ['arise', 'double-progression']){
          assert.equal(row.arms[arm].load, null);
          assert.equal(row.arms[arm].reps, null);
        }
        assert.equal(row.prescription.load, null);
        assert.equal(row.prescription.reps, null);
        const o = row.outcome;
        for(const k of ['load', 'reps', 'assistedKg', 'sets', 'failedSets', 'volumeKg', 'e1rm', 'previousE1rm', 'changePct', 'deviationKg', 'loadErrorKg', 'repError']) assert.equal(o[k], null, `outcome.${k}: ${fmt(P)}`);
        assert.equal(o.metTarget, true, 'boolean siblings survive');
        assert.equal(o.label, 'successful');
        assert.equal(o.arms.arise.loadErrorKg, null);
        assert.equal(o.arms.arise.metTarget, true);

        // Global JSON sweep: no coercible residue of any shape reaches the file.
        const json = JSON.stringify(data);
        assert.equal(json.includes('NaN'), false);
        assert.equal(json.includes('Infinity'), false);
        assert.equal(json.includes('[object Object]'), false);

        // And the null-failed export still ingests cleanly through the real pipeline.
        const ingest = ingestParticipantFiles([participantFile(buildStudyExportPayload(poison(P)))]);
        assert.equal(ingest.warnings.some(w => w.kind === 'import-error'), false, JSON.stringify(ingest.warnings));
      }
    });
  });
});
