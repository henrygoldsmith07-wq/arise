// Domain-model tests: schemas + branded IDs, write-time normalisation,
// the versioned export contract and its adapters, the dangerous-field
// policy, import preview/conflicts, provenance and soft-delete/tombstones.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  exerciseIdSchema, sessionIdSchema, sessionSchema,
  normalizeHistoryForWrite, tagRecord, withProvenance,
  isSoftDeleted, markSoftDeleted, unDelete,
  makeTombstone, isTombstone, applyTombstones,
  EXPORT_CONTRACT, DATA_SOURCES,
} from '../src/lib/domain.js';
import {
  buildEnvelope, adaptImportEnvelope, validateEnvelope,
  applyFieldPolicy, deniedFieldsPresent, buildImportPreview,
  getDeviceId, IMPORT_ALLOW_KEYS,
} from '../src/lib/exportPolicy.js';
import { buildExportPayload, parseImportFile, mergeStores, validateStoreData } from '../src/lib/export.js';
import { mergeStoresWithConflicts } from '../src/lib/sync.js';

function set(reps, kg){ return { reps:String(reps), weightKg:String(kg), rpe:'' }; }
function session(id, dateISO){
  return { id, dateISO, blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,20), set(9,22)] }] };
}
function store(){
  return {
    version: 9,
    onboarding: { goal:'muscle', equipment:['dumbbells'], location:'home' },
    preferences: { units:'kg', theme:'dark', telemetryEnabled:true },
    healthSummary: null,
    activeSchedule: { programId:'p1', mesocycle:{ weeks:4, deloadWeek:null }, adaptationHistory:[], sessions:[] },
    programHistory: [ { programId:'p1', version:1, startDateISO:'2026-01-05' } ],
    history: [ session('h1','2026-01-05'), session('h2','2026-01-08') ],
    eventHistory: [ { id:'e1', type:'session:complete', at:'2026-01-05T10:00:00Z' } ],
    readinessLog: [ { dateISO:'2026-01-05', score:75 } ],
    evaluationLedger: [],
    customTemplates: [],
    tombstones: [],
  };
}

describe('domain schemas and branded IDs', ()=>{
  it('accepts a valid session and exposes branded id schemas', ()=>{
    const parsed = sessionSchema.safeParse(session('h1','2026-01-05'));
    assert.equal(parsed.success, true);
    assert.equal(exerciseIdSchema.safeParse('bench-press-dumbbell').success, true);
    assert.equal(exerciseIdSchema.safeParse('').success, false);
    // Brands are compile-time only: runtime value is a plain string.
    assert.equal(typeof sessionIdSchema.parse('h1'), 'string');
  });

  it('rejects sessions with unparseable dates or broken blocks', ()=>{
    assert.equal(sessionSchema.safeParse({ id:'x', dateISO:'not-a-date', blocks:[] }).success, false);
    assert.equal(sessionSchema.safeParse({ id:'x', dateISO:'2026-01-05', blocks:[{ sets:[] }] }).success, false);
  });

  it('coerces numeric set fields from imported files to the canonical string form', ()=>{
    const parsed = sessionSchema.safeParse({
      id:'x', dateISO:'2026-01-05',
      blocks:[{ exerciseId:'row', sets:[{ reps:8, weightKg:22.5 }] }],
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.blocks[0].sets[0].reps, '8');
    assert.equal(parsed.data.blocks[0].sets[0].weightKg, '22.5');
  });
});

describe('write-time normalisation', ()=>{
  it('normalises, tags and drops unreadable entries with a count', ()=>{
    const { history, dropped } = normalizeHistoryForWrite([
      session('ok-1','2026-01-05'),
      { id:'bad', dateISO:'nope', blocks:'nope' },
      null,
    ]);
    assert.equal(history.length, 1);
    assert.equal(dropped, 2);
    assert.equal(history[0].source, 'manual');
    assert.ok(history[0].sourceTaggedAt);
    assert.equal(history[0].deletedAt, null);
  });

  it('never resurrects a soft-deleted row while normalising', ()=>{
    const deleted = markSoftDeleted(session('gone','2026-01-01'));
    const { history } = normalizeHistoryForWrite([deleted]);
    assert.equal(history[0].deletedAt, deleted.deletedAt);
  });
});

describe('versioned export contract', ()=>{
  it('builds an envelope with app, schema and device metadata', ()=>{
    globalThis.localStorage = { _m:{}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
    const envelope = buildEnvelope({ payload: store(), payloadVersion: 4, schemaVersion: 9 });
    assert.equal(envelope.app, 'arise');
    assert.equal(envelope.contract, EXPORT_CONTRACT);
    assert.equal(envelope.payloadVersion, 4);
    assert.ok(envelope.device.startsWith('dev_'));
    assert.ok(!Number.isNaN(Date.parse(envelope.exportedAt)));
    assert.equal(validateEnvelope(envelope).ok, true);
  });

  it('adapts pre-contract, gzip and bare-store files to the current envelope', ()=>{
    const preContract = { app:'arise', version:3, exportedAt:'2025-06-01T00:00:00Z', data: store() };
    const gzip = { app:'arise', format:'arise+gzip', v:1, encoding:'base64', data: store() };
    const bare = store();
    for(const [raw, expected] of [[preContract,'pre-contract'],[gzip,'gzip-v1'],[bare,'bare-store']]){
      const { envelope, adapter } = adaptImportEnvelope(raw);
      assert.equal(adapter, expected);
      assert.equal(envelope.app, 'arise');
      assert.equal(validateEnvelope({ ...envelope, schemaVersion: envelope.schemaVersion || 1 }).ok, true);
      assert.ok(envelope.data.history);
    }
  });

  it('the real export payload carries the contract and round-trips through parseImportFile', async ()=>{
    globalThis.localStorage = globalThis.localStorage || { _m:{}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
    const payload = buildExportPayload(store());
    assert.equal(payload.contract, EXPORT_CONTRACT);
    const imported = parseImportFile(JSON.stringify(payload));
    assert.equal(imported.history.length, 2);
    // Study identity travels deliberately (studyIdentity.js folds repeated
    // exports into one participant) — but consent toggles never do.
    assert.ok(imported.studyParticipantId);
    assert.equal(imported.preferences.telemetryEnabled, undefined);
    assert.equal(imported.history[0].source, 'import');
  });
});

describe('dangerous-field policy', ()=>{
  it('strips consent toggles and unknown keys, keeps study/health portability', ()=>{
    const data = store();
    data.studyParticipantId = 'study-123';
    data.healthSummary = { sleepHours: 7 };
    data.preferences.telemetryEnabled = true;
    data.preferences.pulseEnabled = true;
    data.someFutureKey = 'not-allow-listed';
    const clean = applyFieldPolicy(data);
    // Consent toggles are device-local: never file-supplied.
    assert.equal(clean.preferences.telemetryEnabled, undefined);
    assert.equal(clean.preferences.pulseEnabled, undefined);
    // Identity + health travel by design (study folding, device portability).
    assert.equal(clean.studyParticipantId, 'study-123');
    assert.deepEqual(clean.healthSummary, { sleepHours: 7 });
    // Default-deny for anything new.
    assert.equal(clean.someFutureKey, undefined);
    assert.ok(clean.history.length === 2); // allow-listed content survives
    assert.deepEqual(deniedFieldsPresent(data).sort(), ['preferences.pulseEnabled','preferences.telemetryEnabled'].sort());
  });

  it('keeps every allow-listed key available to imports', ()=>{
    for(const key of ['history','preferences','onboarding','customTemplates','tombstones']){
      assert.ok(IMPORT_ALLOW_KEYS.includes(key));
    }
  });
});

describe('import preview and conflicts', ()=>{
  it('previews counts, additions and conflicts without mutating anything', ()=>{
    const current = store();
    const changed = session('h1','2026-01-05');
    changed.blocks[0].sets[0] = set(12, 25); // conflict: same id, different content
    const raw = { app:'arise', version:4, data:{ ...store(), history:[ changed, session('new-1','2026-02-01') ] } };
    const before = JSON.stringify(current);
    const preview = buildImportPreview(raw, current);
    assert.equal(JSON.stringify(current), before); // read-only
    assert.equal(preview.ok, true);
    assert.equal(preview.counts.sessions, 2);
    assert.equal(preview.counts.sets, 4);
    assert.equal(preview.counts.additions, 1);
    assert.equal(preview.counts.updates, 1);
    assert.equal(preview.conflicts[0].sessionId, 'h1');
    assert.equal(preview.conflicts[0].incomingSets, 2);
  });

  it('flags contract-unrecognised files honestly but still previews them', ()=>{
    const raw = { app:'arise', version:2, data: store() };
    const preview = buildImportPreview(raw, store());
    assert.equal(preview.ok, true);
    assert.equal(preview.meta.contractRecognised, false);
    assert.equal(preview.meta.adapter, 'pre-contract');
  });

  it('merge keeps the current copy on conflicts and unions tombstones', ()=>{
    const current = store();
    current.history[0].blocks[0].sets[0] = set(10, 21);
    const incoming = store();
    incoming.history[0].blocks[0].sets[0] = set(12, 25);
    incoming.tombstones = [ makeTombstone('templates', 'tpl-9') ];
    const merged = mergeStores(current, incoming, 'merge');
    const kept = merged.history.find((h)=> h.id === 'h1');
    assert.equal(kept.blocks[0].sets[0].reps, '10'); // current wins (equal savedAt)
    assert.ok(merged.tombstones.some((t)=> t.refId === 'tpl-9'));
  });
});

describe('provenance and source tags', ()=>{
  it('stamps provenance with origin, time and device', ()=>{
    const rec = withProvenance({ id:'r1' }, 'live-engine', { deviceId:'dev_x' });
    assert.equal(rec.provenance.origin, 'live-engine');
    assert.equal(rec.provenance.deviceId, 'dev_x');
    assert.ok(rec.provenance.capturedAt);
    const invalid = withProvenance({ id:'r2' }, 'not-a-real-origin');
    assert.equal(invalid.provenance.origin, 'not-a-real-origin'); // passthrough schema keeps it
  });

  it('tags records with a valid data source without clobbering', ()=>{
    const tagged = tagRecord({ id:'x', source:'import' }, 'sync');
    assert.equal(tagged.source, 'import'); // existing tag wins
    assert.equal(DATA_SOURCES.includes('adapter'), true);
    const untagged = tagRecord({ id:'y' }, 'bogus');
    assert.equal(untagged.source, 'manual'); // invalid falls back
  });
});

describe('soft delete and tombstones', ()=>{
  it('marks, detects and un-deletes records', ()=>{
    const row = session('t1','2026-01-01');
    assert.equal(isSoftDeleted(row), false);
    const deleted = markSoftDeleted(row, { by:'user' });
    assert.equal(isSoftDeleted(deleted), true);
    assert.equal(deleted.deletedBy, 'user');
    const restored = unDelete(deleted);
    assert.equal(isSoftDeleted(restored), false);
    assert.equal(restored.deletedAt, undefined);
  });

  it('creates well-formed tombstones and applies them with edit-wins semantics', ()=>{
    const t = makeTombstone('templates', 'tpl-1');
    assert.equal(isTombstone(t), true);
    assert.equal(t.id, 'templates:tpl-1');
    const rows = [
      { id:'a', savedAt:'2026-01-01T00:00:00Z' },  // older than deletion → gone
      { id:'b', savedAt:'2027-01-01T00:00:00Z' },  // edited after deletion → stays
      { id:'c' },                                   // not tombstoned → stays
    ];
    const kept = applyTombstones(rows, [makeTombstone('templates','a'), makeTombstone('templates','b'), { id:'bogus' }, session('x','2026-01-01')]);
    assert.deepEqual(kept.map((r)=> r.id), ['b','c']);
  });

  it('sync merge applies tombstones to history and templates', ()=>{
    const current = store();
    current.customTemplates = [ { id:'tpl-1', isCustom:true, program:{ name:'X' } } ];
    current.history.push(session('h-old','2020-01-01'));
    const remote = store();
    remote.tombstones = [ makeTombstone('templates','tpl-1'), makeTombstone('sessions','h-old') ];
    const merged = mergeStoresWithConflicts(current, remote);
    assert.equal(merged.customTemplates.some((t)=> t.id === 'tpl-1'), false);
    assert.equal(merged.history.some((h)=> h.id === 'h-old'), false);
    assert.ok(merged.tombstones.some((t)=> t.refId === 'tpl-1'));
  });
});

describe('validator coheres with the schema', ()=>{
  it('validateStoreData accepts what sessionSchema accepts for canonical rows', ()=>{
    const data = store();
    const validation = validateStoreData(data);
    assert.equal(validation.ok, true);
    for(const s of data.history){
      assert.equal(sessionSchema.safeParse(s).success, true);
    }
  });
});
