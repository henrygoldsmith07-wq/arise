// services/index.js — domain services: the engine boundary React never crosses.
//
// Services own orchestration. They depend on repositories and adapters
// (injected), call the pure engine modules in src/lib, and expose the verbs
// the UI needs. Components never import storage, IDB, or the engine modules
// directly (ADR 0001/0002). Every service here is framework-free and
// constructible in tests with fakes.

import { createRepositories } from '../repositories/index.js';
import { recommendNext, recommendSets, romProgression, trainingAgeInfo, validateProgression } from '../lib/progression.js';
import { substitutionOptions, rankedSubstitutions } from '../lib/substitutions.js';
import { weeklyVolume, strengthSeries, volumeDistribution } from '../lib/analytics.js';
import { sessionForToday, nextSession, progress as scheduleProgress, markSessionDone } from '../lib/schedule.js';
import { evaluateLongitudinal } from '../lib/longitudinal.js';
import { recordRecommendation } from '../lib/longitudinal.js';
import { buildExportPayload, parseImportFile, mergeStores, portableCsv } from '../lib/export.js';
import { buildImportPreview } from '../lib/exportPolicy.js';
import { syncUp, syncDown, mergeStoresWithConflicts } from '../lib/sync.js';
import { ensureFeature } from '../core/flags.js';
import { ImportRejectedError, SyncError } from '../core/errors.js';
import { CONFIG } from '../core/config.js';

// ── ProgressionService (pure logic — no I/O anywhere behind these calls) ────
export function createProgressionService({ repos }){
  return {
    name: 'progressionService',

    /** Pure next-load advice from the caller-visible history slice. */
    nextAdvice({ exerciseId, history, targetReps, conservative = true, config, asOfDateISO }){
      return recommendNext({ exerciseId, history, targetReps, conservative, config, asOfDateISO });
    },

    setAdvice(history, exerciseId, opts){
      return recommendSets(history, exerciseId, opts);
    },

    romAdvice(history, exerciseId, opts){
      return romProgression(history, exerciseId, opts);
    },

    trainingAge(history, opts){
      return trainingAgeInfo(history, opts);
    },

    /** Full progression validation snapshot for a history (pure). */
    validate(history, opts){
      return validateProgression(history, opts);
    },

    /** History-backed variant that reads through the repository first. */
    async nextAdviceForExercise(exerciseId, opts = {}){
      const history = await repos.historyRepository.all();
      return recommendNext({ exerciseId, history, ...opts });
    },
  };
}

// ── SubstitutionService ─────────────────────────────────────────────────────
export function createSubstitutionService(){
  return {
    name: 'substitutionService',

    options(exerciseId, constraints){
      return substitutionOptions(exerciseId, constraints || {});
    },

    ranked(exerciseId, equipment, limit, history){
      return rankedSubstitutions(exerciseId, equipment, limit, history);
    },
  };
}

// ── AnalyticsService (offload to the worker is the caller's choice) ────────
export function createAnalyticsService({ repos }){
  return {
    name: 'analyticsService',

    async weeklyVolume(){
      const history = await repos.historyRepository.all();
      return weeklyVolume(history);
    },

    async strengthSeries(exerciseId){
      const history = await repos.historyRepository.all();
      return strengthSeries(history, exerciseId);
    },

    async volumeDistribution(){
      const [history] = await Promise.all([repos.historyRepository.all()]);
      return volumeDistribution(history, null);
    },
  };
}

// ── ScheduleService ─────────────────────────────────────────────────────────
export function createScheduleService({ repos }){
  return {
    name: 'scheduleService',

    async today(){
      const schedule = await repos.programRepository.active();
      return sessionForToday(schedule);
    },

    async upcoming(){
      const schedule = await repos.programRepository.active();
      return nextSession(schedule);
    },

    async progress(){
      const [schedule, history] = await Promise.all([
        repos.programRepository.active(),
        repos.historyRepository.all(),
      ]);
      return scheduleProgress(schedule, history);
    },

    async markDone(session){
      // markSessionDone is pure (store in, store out): it updates the schedule
      // AND upserts the completed session into history. Persist the whole
      // result atomically through the repository layer.
      const store = await repos.getCachedStore();
      if(!store?.activeSchedule) return null;
      const updated = markSessionDone(store, session);
      await repos.setCachedStore(updated);
      return updated.activeSchedule;
    },
  };
}

// ── EvidenceService (longitudinal evaluation boundary) ─────────────────────
export function createEvidenceService({ repos }){
  return {
    name: 'evidenceService',

    /** Record a recommendation pre-workout (provenance-stamped upstream). */
    async recordRecommendation(input){
      return recordRecommendation(input);
    },

    /** Aggregate evaluation over the ledger (pure — takes rows, not storage). */
    async evaluate(config){
      const records = await repos.recommendationLedgerRepository.all();
      return evaluateLongitudinal(records, { config });
    },
  };
}

// ── ImportExportService ─────────────────────────────────────────────────────
export function createImportExportService({ repos, adapters }){
  return {
    name: 'importExportService',

    async buildExport(){
      const store = await repos.getCachedStore();
      return buildExportPayload(store);
    },

    async csv(){
      const store = await repos.getCachedStore();
      return portableCsv(store.history || []);
    },

    /** Preview only — read-only, nothing persisted (ADR 0003 two-step import). */
    preview(rawFile){
      const store = repos.getCachedStore();
      return buildImportPreview(rawFile, store);
    },

    async applyPreview(preview, strategy = 'merge'){
      if(!preview?.ok || !preview.envelope){
        throw new ImportRejectedError('Import applied without a valid preview.', { userMessage: 'Preview the backup before applying it.' });
      }
      const store = await repos.getCachedStore();
      const imported = parseImportFile(JSON.stringify(preview.envelope));
      const merged = mergeStores(store, imported, strategy);
      await repos.setCachedStore(merged);
      return merged;
    },
  };
}

// ── SyncService abstraction (flag-gated; provider injected) ────────────────
export function createSyncService({ repos, adapters, provider = null }){
  return {
    name: 'syncService',

    /**
     * Push local state upstream. Requires the syncEngine flag and a provider
     * adapter { pull, push } — the abstraction exists now so the future
     * provider slots in without touching call sites (ADR 0006).
     */
    async push(storeOverride){
      ensureFeature({ preferences: (await repos.preferencesRepository.all()) }, 'syncEngine');
      if(!provider?.push) throw new SyncError('No sync provider configured.');
      const store = storeOverride || await repos.getCachedStore();
      const payload = await syncUp(store, provider);
      adapters?.log?.('sync:pushed', { at: payload.exportedAt });
      return payload;
    },

    async pull(strategy = 'merge'){
      ensureFeature({ preferences: (await repos.preferencesRepository.all()) }, 'syncEngine');
      if(!provider?.pull) throw new SyncError('No sync provider configured.');
      const store = await repos.getCachedStore();
      const merged = await syncDown(store, provider, strategy);
      if(merged !== store){
        await repos.setCachedStore(merged);
      }
      return merged;
    },

    /** Offline merge of a remote payload without any provider (dry path). */
    async mergeRemote(remoteStore, strategy = 'merge'){
      const store = await repos.getCachedStore();
      return strategy === 'replace'
        ? mergeStores(store, remoteStore, 'replace')
        : mergeStoresWithConflicts(store, remoteStore);
    },
  };
}

/** Assemble every service against the shared repository set. */
export function createServices({ provider = null, repositories = null } = {}){
  const repos = repositories || createRepositories();
  return {
    repos,
    progressionService: createProgressionService({ repos }),
    substitutionService: createSubstitutionService(),
    analyticsService: createAnalyticsService({ repos }),
    scheduleService: createScheduleService({ repos }),
    evidenceService: createEvidenceService({ repos }),
    importExportService: createImportExportService({ repos }),
    syncService: createSyncService({ repos, provider }),
  };
}

export { CONFIG };
