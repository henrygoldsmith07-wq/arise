// Study-export regression suite: the file a participant produces by following
// docs/PARTICIPANT_GUIDE.md EXACTLY must ingest through the real pilot
// pipeline with no manual conversion — and every warning/wording contract
// must mean what the docs say.
//
//   §1 dedicated study export (payload shape, identity, exportedAt, privacy)
//   §2 missing-export-timestamp semantics (not a "never exported" detector)
//   §3 abandonment warning on the true terminal denominator
//   §4/§5 guidance + privacy wording enforced against the actual artifacts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildStudyExportPayload, STUDY_EXPORT_VERSION,
} from '../src/lib/export.js';
import { ingestParticipantFiles } from '../src/lib/cohortOps.js';
import { buildPilotRoster } from '../src/lib/pilotHealth.js';
import { recordEvent } from '../src/lib/telemetry.js';
import { recordRecommendation, attachOutcome } from '../src/lib/longitudinal.js';
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
