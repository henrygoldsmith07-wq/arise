// repositories/index.js — the repository layer between UI/services and storage.
//
// Every consumer talks to repositories, never to IndexedDB or localStorage
// directly (ADR 0002). Repositories translate the app's intent
// ("recent sessions", "open recommendations") into storage operations and
// guarantee the store's invariants: write-time normalisation, atomic saves,
// provenance stamps. Repositories are plain objects assembled with injected
// adapters, so tests swap the whole storage backend, not just pieces.

import {
  hydrateStorage, whenPersisted, setCachedStore, getCachedStore, resetHydratedCache,
  clearAllStoredData, isCleared, getIntegrityNotice, clearIntegrityNotice,
} from '../lib/storage.js';
import { querySessionsPage, queryMoreSessions, querySetsByExercise, querySetsByDate, querySetsBySession } from '../lib/queries.js';
import { getEventHistory, recordEvent as telemetryRecordEvent, mergeEventHistory, replaceEventHistory, telemetrySummary, clearTelemetry } from '../lib/telemetry.js';
import { loadEvaluationLedger, saveEvaluationLedger, mergeEvaluationLedgers } from '../lib/longitudinal.js';
import { normalizeHistoryForWrite, tagRecord, withProvenance, markSoftDeleted, unDelete, makeTombstone, isSoftDeleted, applyTombstones } from '../lib/domain.js';
import { NotFoundError, StorageError } from '../core/errors.js';
import { CONFIG } from '../core/config.js';

function requireStore(){
  const store = getCachedStore();
  if(!store){
    throw new StorageError('Read attempted before hydration completed.', { userMessage: 'Your data is still loading — try again in a moment.' });
  }
  return store;
}

function defaultStoreFactory(){
  // The minimal shape every repository method needs; mirrors store.js DEFAULT.
  return {
    version: CONFIG.storeSchemaVersion, onboarding: null, activeSchedule: null,
    activeWorkout: null, eventHistory: [], healthSummary: null, history: [],
    preferences: {}, readinessLog: [], programHistory: [], customTemplates: [],
    evaluationLedger: [], tombstones: [],
  };
}

// ── HistoryRepository ───────────────────────────────────────────────────────
export function createHistoryRepository({ adapters } = {}){
  return {
    name: 'historyRepository',

    async all(){
      const store = requireStore();
      return (store.history || []).filter((s) => !isSoftDeleted(s));
    },

    async allIncludingDeleted(){
      const store = requireStore();
      return store.history || [];
    },

    async byId(id){
      const store = requireStore();
      const row = (store.history || []).find((s) => s.id === id);
      if(!row) throw new NotFoundError(`Session ${id} not found.`, { details: { sessionId: id } });
      return row;
    },

    async byDate(dateISO){
      const store = requireStore();
      return (store.history || []).filter((s) => s.dateISO === dateISO && !isSoftDeleted(s));
    },

    /** Newest-first page with a lazy-loading cursor (queries.js underneath). */
    async page({ offset = 0, limit = CONFIG.queries.defaultPageSize } = {}){
      await requireStore();
      return querySessionsPage({ offset, limit });
    },

    async more(page){
      return queryMoreSessions(page);
    },

    async setsByExercise(exerciseId){
      await requireStore();
      return querySetsByExercise(exerciseId);
    },

    async setsByDate(dateISO){
      await requireStore();
      return querySetsByDate(dateISO);
    },

    async setsBySession(sessionId){
      await requireStore();
      return querySetsBySession(sessionId);
    },

    /** Upsert a session: normalised, tagged, written atomically. */
    async upsert(session){
      const store = requireStore();
      const stamped = tagRecord(session, session.source || 'manual');
      const { history, dropped } = normalizeHistoryForWrite([stamped]);
      if(dropped) throw new StorageError('Session failed schema validation on write.', { details: { sessionId: session?.id } });
      const entry = history[0];
      const existing = (store.history || []).filter((s) => s.id !== entry.id);
      const next = {
        ...store,
        history: [...existing, entry].sort((a, b) => String(a?.dateISO || '').localeCompare(String(b?.dateISO || ''))),
      };
      setCachedStore(next);
      await whenPersisted();
      return entry;
    },

    /** Soft delete: recoverable locally, tombstoned for sync propagation. */
    async softDelete(sessionId, { by = 'user' } = {}){
      const store = requireStore();
      const row = (store.history || []).find((s) => s.id === sessionId);
      if(!row) throw new NotFoundError(`Session ${sessionId} not found.`);
      const tombstone = makeTombstone('sessions', sessionId);
      const next = {
        ...store,
        history: (store.history || []).map((s) => s.id === sessionId ? markSoftDeleted(s, { by }) : s),
        tombstones: [...(store.tombstones || []).filter((t) => t.refId !== sessionId), tombstone],
      };
      setCachedStore(next);
      await whenPersisted();
      return tombstone;
    },

    async restore(sessionId){
      const store = requireStore();
      const row = (store.history || []).find((s) => s.id === sessionId);
      if(!row) throw new NotFoundError(`Session ${sessionId} not found.`);
      const next = {
        ...store,
        history: (store.history || []).map((s) => s.id === sessionId ? unDelete(s) : s),
        tombstones: (store.tombstones || []).filter((t) => t.refId !== sessionId),
      };
      setCachedStore(next);
      await whenPersisted();
      return unDelete(row);
    },

    /** Drop tombstones past their TTL (retention policy, run at boot/maintenance). */
    async pruneTombstones({ ttlDays = CONFIG.limits.tombstoneTtlDays, now = (adapters?.nowISO ? adapters.nowISO() : new Date().toISOString()) } = {}){
      const store = requireStore();
      const cutoff = new Date(Date.parse(now) - ttlDays * 24 * 60 * 60 * 1000).toISOString();
      const kept = (store.tombstones || []).filter((t) => String(t.deletedAt || '') >= cutoff);
      if(kept.length === (store.tombstones || []).length) return 0;
      const next = { ...store, tombstones: kept };
      setCachedStore(next);
      await whenPersisted();
      return (store.tombstones || []).length - kept.length;
    },
  };
}

// ── ProgramRepository ───────────────────────────────────────────────────────
export function createProgramRepository(){
  return {
    name: 'programRepository',

    async active(){
      return requireStore().activeSchedule || null;
    },

    async programHistory(){
      return requireStore().programHistory || [];
    },

    async setActive(schedule){
      const store = requireStore();
      const next = { ...store, activeSchedule: schedule || null };
      setCachedStore(next);
      await whenPersisted();
      return schedule || null;
    },

    async appendProgramHistory(entry){
      const store = requireStore();
      const history = store.programHistory || [];
      const next = {
        ...store,
        programHistory: [...history, entry].filter((v, i, a) => a.findIndex((x) => x.programId === v.programId && x.version === v.version) === i),
      };
      setCachedStore(next);
      await whenPersisted();
      return entry;
    },
  };
}

// ── TemplateRepository ──────────────────────────────────────────────────────
export function createTemplateRepository(){
  return {
    name: 'templateRepository',

    async all(){
      const store = requireStore();
      return (store.customTemplates || []).filter((t) => !t.deletedAt);
    },

    async byId(id){
      const store = requireStore();
      const row = (store.customTemplates || []).find((t) => t.id === id && !t.deletedAt);
      if(!row) throw new NotFoundError(`Template ${id} not found.`);
      return row;
    },

    async upsert(template){
      const store = requireStore();
      const stamped = tagRecord(template, 'manual');
      const list = store.customTemplates || [];
      const exists = list.some((t) => t.id === stamped.id);
      const next = {
        ...store,
        customTemplates: exists ? list.map((t) => t.id === stamped.id ? stamped : t) : [...list, stamped],
      };
      setCachedStore(next);
      await whenPersisted();
      return stamped;
    },

    async softDelete(id){
      const store = requireStore();
      const row = (store.customTemplates || []).find((t) => t.id === id);
      if(!row) throw new NotFoundError(`Template ${id} not found.`);
      const tombstone = makeTombstone('templates', id);
      const next = {
        ...store,
        customTemplates: (store.customTemplates || []).map((t) => t.id === id ? markSoftDeleted(t) : t),
        tombstones: [...(store.tombstones || []).filter((t) => t.refId !== id), tombstone],
      };
      setCachedStore(next);
      await whenPersisted();
      return tombstone;
    },

    async restore(id){
      const store = requireStore();
      const next = {
        ...store,
        customTemplates: (store.customTemplates || []).map((t) => t.id === id ? unDelete(t) : t),
        tombstones: (store.tombstones || []).filter((t) => t.refId !== id),
      };
      setCachedStore(next);
      await whenPersisted();
      return true;
    },
  };
}

// ── PreferencesRepository ───────────────────────────────────────────────────
export function createPreferencesRepository(){
  return {
    name: 'preferencesRepository',

    async all(){
      return requireStore().preferences || {};
    },

    async merge(patch){
      const store = requireStore();
      const next = { ...store, preferences: { ...(store.preferences || {}), ...patch } };
      setCachedStore(next);
      await whenPersisted();
      return next.preferences;
    },

    /** Feature-flag override lives in preferences (core/flags.js reads it). */
    async setFlag(flag, value){
      return this.merge({ flags: { ...(requireStore().preferences?.flags || {}), [flag]: value } });
    },
  };
}

// ── EventRepository ─────────────────────────────────────────────────────────
export function createEventRepository(){
  return {
    name: 'eventRepository',

    async all(){
      await requireStore();
      return getEventHistory();
    },

    async record(type, payload, opts){
      await requireStore();
      return telemetryRecordEvent(type, payload, opts);
    },

    async mergeMany(events){
      await requireStore();
      mergeEventHistory(events);
      return true;
    },

    async replaceAll(events){
      await requireStore();
      replaceEventHistory(events);
      return true;
    },

    async summary(){
      await requireStore();
      return telemetrySummary();
    },

    async clear(){
      await requireStore();
      clearTelemetry();
      return true;
    },
  };
}

// ── RecommendationLedgerRepository ──────────────────────────────────────────
export function createRecommendationLedgerRepository(){
  return {
    name: 'recommendationLedgerRepository',

    async all(){
      await requireStore();
      return loadEvaluationLedger();
    },

    async save(records){
      await requireStore();
      saveEvaluationLedger(records);
      return true;
    },

    async mergeMany(incoming){
      await requireStore();
      const merged = mergeEvaluationLedgers(loadEvaluationLedger(), incoming);
      saveEvaluationLedger(merged);
      return merged;
    },

    async openForExercise(exerciseId){
      const ledger = await this.all();
      return ledger.filter((r) => r.exerciseId === exerciseId && !r.outcome && !r.deletedAt);
    },

    async resolvedForExercise(exerciseId){
      const ledger = await this.all();
      return ledger.filter((r) => r.exerciseId === exerciseId && r.outcome);
    },

    /** Stamp provenance on an incoming record before it enters the ledger. */
    withProvenance(record, origin, meta){
      return withProvenance(record, origin, meta);
    },
  };
}

/** Assemble the full repository set (shared cache; single hydration). */
export function createRepositories({ adapters: adapterBag } = {}){
  const historyRepository = createHistoryRepository({ adapters: adapterBag });
  return {
    historyRepository,
    programRepository: createProgramRepository(),
    templateRepository: createTemplateRepository(),
    preferencesRepository: createPreferencesRepository(),
    eventRepository: createEventRepository(),
    recommendationLedgerRepository: createRecommendationLedgerRepository(),
    // Lifecycle passthroughs the app shell needs without touching storage.js.
    hydrate: hydrateStorage,
    whenPersisted,
    getCachedStore,
    setCachedStore,
    resetCache: resetHydratedCache,
    clearAll: clearAllStoredData,
    isCleared,
    integrityNotice: { get: getIntegrityNotice, clear: clearIntegrityNotice },
  };
}
