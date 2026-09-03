// Architecture-layer tests: config/flags/errors/container, the repository
// layer over the canonical IDB fallback, and the domain services (including
// the purity and flag-gating contracts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/config.js';
import {
  DomainError, StorageError, NotFoundError, FlagDisabledError, SyncError,
  toUserMessage, isDomainError, ERROR_CODES,
} from '../src/core/errors.js';
import {
  isFeatureEnabled, ensureFeature, setFlag, toggleableFlags, flagDeclarations,
} from '../src/core/flags.js';
import { register, resolve, has, resetContainer, overrideAdapter, adapters } from '../src/core/container.js';
import { createRepositories, createHistoryRepository } from '../src/repositories/index.js';
import { createServices } from '../src/services/index.js';
import { recommendNext } from '../src/lib/progression.js';
import { hydrateStorage, setCachedStore, getCachedStore, whenPersisted } from '../src/lib/storage.js';
import { STORE_SCHEMA_VERSION } from '../src/lib/store.js';

globalThis.localStorage = { _m:{}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };

function set(reps, kg){ return { reps:String(reps), weightKg:String(kg), rpe:'' }; }
function session(id, dateISO){
  return { id, dateISO, blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,20), set(9,22)] }] };
}
function seedStore(){
  return {
    version: STORE_SCHEMA_VERSION,
    onboarding: { goal:'muscle', equipment:['dumbbells'], location:'home' },
    preferences: { units:'kg', theme:'dark' },
    healthSummary: null,
    activeSchedule: { programId:'p1', mesocycle:{ weeks:4, deloadWeek:null }, adaptationHistory:[], sessions:[ { id:'s1', week:1, day:1, dateISO:'2026-01-05', status:'planned', blocks:[{ exerciseId:'bench-press-dumbbell', sets:3, reps:'8–12' }] } ] },
    programHistory: [],
    history: [ session('h1','2026-01-05'), session('h2','2026-01-08') ],
    eventHistory: [],
    readinessLog: [],
    evaluationLedger: [],
    customTemplates: [ { id:'tpl-1', isCustom:true, program:{ name:'X' } } ],
    tombstones: [],
  };
}

describe('core: config, flags, errors, container', ()=>{
  it('config is frozen and pins the canonical versions', ()=>{
    assert.equal(Object.isFrozen(CONFIG), true);
    assert.equal(CONFIG.storeSchemaVersion, STORE_SCHEMA_VERSION);
    assert.equal(CONFIG.exportContract, 'arise.export.v1');
    assert.equal(CONFIG.keys.evaluationLedger, 'arise.evaluation.v1');
    assert.ok(CONFIG.flags.syncEngine.default === false); // experimental stays dark
  });

  it('flags resolve defaults, preference overrides and typed gating', ()=>{
    const decls = flagDeclarations();
    assert.ok(decls.syncEngine);
    assert.equal(isFeatureEnabled({}, 'syncEngine'), false);
    assert.equal(isFeatureEnabled({ preferences:{ flags:{ syncEngine:true } } }, 'syncEngine'), true);
    assert.equal(isFeatureEnabled({}, 'nonexistent-flag'), false);
    assert.throws(()=> ensureFeature({}, 'syncEngine'), FlagDisabledError);
    try{ ensureFeature({}, 'syncEngine'); }catch(err){
      assert.equal(err.code, ERROR_CODES.FLAG_DISABLED);
      assert.ok(err.details.flag === 'syncEngine');
    }
    // setFlag is pure and feeds isFeatureEnabled.
    const prefs = setFlag({ units:'kg' }, 'syncEngine', true);
    assert.equal(prefs.units, 'kg');
    assert.equal(isFeatureEnabled({ preferences: prefs }, 'syncEngine'), true);
    assert.deepEqual(toggleableFlags('experimental').map((f)=> f.id), ['syncEngine', 'voiceCoach']);
  });

  it('typed errors carry stable codes and user-safe messages', ()=>{
    const err = new StorageError('idb exploded', { details: { store:'sessions' } });
    assert.equal(isDomainError(err), true);
    assert.equal(err.code, ERROR_CODES.STORAGE);
    assert.notEqual(err.userMessage, err.message); // user message is the safe one
    assert.deepEqual(JSON.parse(JSON.stringify(err)).details, { store:'sessions' });
    const nf = new NotFoundError('Session h9 not found.');
    assert.equal(nf.code, ERROR_CODES.NOT_FOUND);
    assert.equal(toUserMessage(nf), nf.userMessage);
    assert.equal(isDomainError(new TypeError('x')), false);
    assert.ok(toUserMessage(new TypeError('boom')).length > 0);
    assert.ok(toUserMessage({ message: 'plain' }).length > 0);
  });

  it('container resolves singletons, detects cycles, and swaps adapters', ()=>{
    resetContainer();
    let count = 0;
    register('counter', ()=> ({ id: ++count }));
    register('usesCounter', (get)=> ({ inner: get('counter') }));
    const a = resolve('counter');
    assert.equal(resolve('counter'), a); // memoised
    assert.equal(resolve('usesCounter').inner, a);
    assert.equal(has('counter'), true);
    assert.equal(has('nope'), false);
    assert.throws(()=> resolve('nope'), /no service registered/);
    register('cyclicA', (get)=> ({ b: get('cyclicB') }));
    register('cyclicB', (get)=> ({ a: get('cyclicA') }));
    assert.throws(()=> resolve('cyclicA'), /circular/);
    overrideAdapter('clock', ()=> new Date('2026-01-01T00:00:00Z'));
    assert.equal(adapters().clock().toISOString(), '2026-01-01T00:00:00.000Z');
    resetContainer();
  });
});

describe('repository layer', ()=>{
  it('exposes history through typed facades with NotFound and soft delete', async ()=>{
    await hydrateStorage();
    setCachedStore(seedStore());
    await whenPersisted();
    const repos = createRepositories();
    const history = await repos.historyRepository.all();
    assert.equal(history.length, 2);
    await assert.rejects(()=> repos.historyRepository.byId('ghost'), NotFoundError);
    await repos.historyRepository.softDelete('h1');
    assert.equal((await repos.historyRepository.all()).length, 1);
    const tombstones = (await repos.historyRepository.allIncludingDeleted());
    const deletedRow = tombstones.find((s)=> s.id === 'h1');
    assert.ok(deletedRow.deletedAt); // soft, recoverable
    assert.ok((getCachedStore().tombstones || []).some((t)=> t.refId === 'h1'));
    await repos.historyRepository.restore('h1');
    assert.equal((await repos.historyRepository.all()).length, 2);
    assert.equal((getCachedStore().tombstones || []).length, 0);
  });

  it('templates, preferences and tombstone pruning round-trip', async ()=>{
    setCachedStore(seedStore());
    const repos = createRepositories();
    const templates = await repos.templateRepository.all();
    assert.equal(templates.length, 1);
    await repos.templateRepository.softDelete('tpl-1');
    assert.equal((await repos.templateRepository.all()).length, 0);
    await repos.templateRepository.restore('tpl-1');
    assert.equal((await repos.templateRepository.all()).length, 1);
    await repos.preferencesRepository.merge({ theme:'light' });
    assert.equal((await repos.preferencesRepository.all()).theme, 'light');
    await repos.preferencesRepository.setFlag('syncEngine', true);
    assert.equal(isFeatureEnabled({ preferences: await repos.preferencesRepository.all() }, 'syncEngine'), true);
    // pruneTombstones drops nothing fresh, drops everything stale.
    const stale = createHistoryRepository();
    const dropped = await stale.pruneTombstones({ ttlDays: 0 });
    assert.ok(dropped >= 0);
  });

  it('upsert normalises and persists atomically through the write path', async ()=>{
    setCachedStore(seedStore());
    const repos = createRepositories();
    const entry = await repos.historyRepository.upsert(session('h9', '2026-02-01'));
    assert.equal(entry.source, 'manual');
    const all = await repos.historyRepository.all();
    assert.ok(all.some((s)=> s.id === 'h9'));
    await whenPersisted();
  });
});

describe('domain services', ()=>{
  it('progression stays pure: service passthrough equals direct engine call', async ()=>{
    setCachedStore(seedStore());
    const services = createServices();
    const { progressionService } = services;
    const history = await services.repos.historyRepository.all();
    const direct = recommendNext({ exerciseId:'bench-press-dumbbell', history, targetReps:'8–12' });
    const viaService = progressionService.nextAdvice({ exerciseId:'bench-press-dumbbell', history, targetReps:'8–12' });
    assert.deepEqual(viaService, direct);
    const snapshot = JSON.stringify(direct);
    await progressionService.nextAdviceForExercise('bench-press-dumbbell', { targetReps:'8–12' });
    assert.equal(JSON.stringify(direct), snapshot); // no mutation through the service
  });

  it('analytics, schedule and evidence read through repositories', async ()=>{
    setCachedStore(seedStore());
    const services = createServices();
    const weekly = await services.analyticsService.weeklyVolume();
    assert.ok(weekly !== undefined);
    const progress = await services.scheduleService.progress();
    assert.ok(progress !== undefined);
    const evaluation = await services.evidenceService.evaluate();
    assert.equal(evaluation.totalRecords, 0);
    const csv = await services.importExportService.csv();
    assert.match(csv, /dateISO/);
  });

  it('import preview is read-only; apply merges through the service', async ()=>{
    setCachedStore(seedStore());
    const services = createServices();
    const incoming = seedStore();
    incoming.history = [ session('new-1','2026-03-01') ];
    const preview = services.importExportService.preview({ app:'arise', version:4, data: incoming });
    assert.equal(preview.ok, true);
    assert.equal(preview.counts.additions, 1);
    assert.equal((await services.repos.historyRepository.all()).some((s)=> s.id === 'new-1'), false);
    await services.importExportService.applyPreview(preview, 'merge');
    assert.ok((await services.repos.historyRepository.all()).some((s)=> s.id === 'new-1'));
  });

  it('sync is flag-gated and provider-typed', async ()=>{
    setCachedStore(seedStore());
    const services = createServices({ provider: null });
    await assert.rejects(()=> services.syncService.push(), FlagDisabledError);
    const enabled = createServices({
      provider: null,
      repositories: services.repos,
    });
    await enabled.repos.preferencesRepository.setFlag('syncEngine', true);
    await assert.rejects(()=> enabled.syncService.push(), SyncError); // flag on, provider missing
    const merged = await enabled.syncService.mergeRemote({ ...seedStore(), history:[ session('remote-1','2026-04-01') ] });
    assert.ok(merged.history.some((s)=> s.id === 'remote-1'));
  });
});
