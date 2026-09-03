// domain.js — the canonical domain model: Zod schemas, branded IDs,
// provenance/source tags, soft-delete and tombstones.
//
// Every entity the app persists (sessions, blocks, sets, programmes,
// templates, recommendation/outcome records) gets one schema here. Storage,
// import, sync and export all validate against THE definition instead of
// hand-rolled per-module checks that drift apart. IDs are branded so an
// exercise id can never be passed where a session id is expected in typed
// call sites, and every persisted record carries a `source` tag so analytics
// can always answer "where did this row come from".

import { z } from 'zod';

// ── Branded IDs ─────────────────────────────────────────────────────────────
// Brands are compile-time only (zero runtime cost); the schemas below are the
// runtime enforcement. Non-empty strings everywhere — ids are load-bearing
// for dedupe, merge and tombstones.
export const exerciseIdSchema = z.string().min(1).brand('ExerciseId');
export const sessionIdSchema = z.string().min(1).brand('SessionId');
export const programIdSchema = z.string().min(1).brand('ProgramId');
export const templateIdSchema = z.string().min(1).brand('TemplateId');
export const recordIdSchema = z.string().min(1).brand('RecordId');

// Date strings: ISO calendar dates and timestamps. Kept as branded strings —
// new Date(...) round-trips would silently re-localise user data.
const dateISOSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Expected an ISO date (YYYY-MM-DD…)');

// ── Sets, blocks, sessions ──────────────────────────────────────────────────
// Set fields are user-typed strings at the UI boundary ('' = not logged);
// numbers from imported/synced files are coerced back to the canonical string
// form so downstream consumers never see both shapes.
export const setSchema = z.object({
  reps: z.coerce.string(),
  weightKg: z.coerce.string(),
  rpe: z.coerce.string().optional().default(''),
  side: z.string().nullable().optional(),
  rom: z.coerce.string().nullable().optional(),
  assistedKg: z.coerce.string().nullable().optional(),
  tempo: z.string().nullable().optional(),
  failed: z.boolean().optional(),
  skipped: z.boolean().optional(),
}).passthrough();

export const blockSchema = z.object({
  exerciseId: exerciseIdSchema,
  sets: z.array(setSchema),
}).passthrough();

export const sessionSchema = z.object({
  id: sessionIdSchema,
  dateISO: dateISOSchema,
  blocks: z.array(blockSchema),
}).passthrough();

export const sessionArraySchema = z.array(sessionSchema);

// ── Programmes & templates ──────────────────────────────────────────────────
export const activeScheduleSchema = z.object({
  programId: programIdSchema,
}).passthrough(); // sessions, mesocycle, adaptationHistory — validated by owners

export const customTemplateSchema = z.object({
  id: templateIdSchema,
  program: z.object({}).passthrough(), // full programme shape owned by templates.js
}).passthrough();

export const programHistoryEntrySchema = z.object({
  programId: programIdSchema,
  version: z.number().int().positive(),
}).passthrough();

// ── Evaluation ledger (recommendation + outcome pairs) ──────────────────────
export const recommendationPayloadSchema = z.object({
  load: z.coerce.number().nullable().optional(),
  reps: z.coerce.number().nullable().optional(),
  assistKg: z.coerce.number().nullable().optional(),
  reason: z.string().optional(),
  strategy: z.string().nullable().optional(),
}).passthrough();

export const outcomePayloadSchema = z.object({
  metTarget: z.boolean().nullable().optional(),
}).passthrough();

// ── Data source tags ────────────────────────────────────────────────────────
// Every persisted row knows where it came from. 'adapter' rows (health
// platforms) never count as user-observed training data; provenance rollups
// and the study pipeline filter on this.
export const DATA_SOURCES = ['manual', 'import', 'sync', 'adapter', 'seed'];
export const dataSourceSchema = z.enum(DATA_SOURCES);

/** Stamp source tags onto a record without clobbering existing tags. */
export function tagRecord(record, source){
  if(!record || typeof record !== 'object') return record;
  const s = dataSourceSchema.safeParse(source).success ? source : 'manual';
  return { ...record, source: record.source ?? s, sourceTaggedAt: record.sourceTaggedAt ?? new Date().toISOString() };
}

export function ensureSourceTags(record, source = 'manual'){
  return tagRecord(record, source);
}

// ── Provenance for recommendation/outcome pairs ─────────────────────────────
// A pair is only as trustworthy as its origin: recommendations from the live
// engine differ from ones replayed from a backup, and outcomes measured on
// this device differ from ones merged in from elsewhere.
export const PROVENANCE_ORIGINS = ['live-engine', 'imported', 'replayed', 'seed'];
export const provenanceSchema = z.object({
  origin: z.enum(PROVENANCE_ORIGINS).optional(),
  capturedAt: z.string().optional(),
  deviceId: z.string().optional(),
  exportVersion: z.number().int().positive().optional(),
}).passthrough();

/** Attach/refresh provenance on a ledger record (origin defaults to imported). */
export function withProvenance(record, origin, meta = {}){
  if(!record || typeof record !== 'object') return record;
  const parsed = provenanceSchema.safeParse({ ...record.provenance, origin, capturedAt: meta.capturedAt || new Date().toISOString(), ...meta });
  return { ...record, provenance: parsed.success ? parsed.data : { origin, capturedAt: new Date().toISOString() } };
}

// ── Soft delete & tombstones ────────────────────────────────────────────────
// Deletion is a *state*, not an erasure: analytics exclude deleted rows, sync
// can propagate the deletion, and undo is possible until a purge is requested.
export const SOFT_DELETE_FIELDS = ['deletedAt', 'deletedBy'];
export const TOMBSTONE_TTL_DAYS = 60;

export function isSoftDeleted(record){
  return Boolean(record && typeof record === 'object' && record.deletedAt);
}

export function markSoftDeleted(record, { by = 'user', at = new Date().toISOString() } = {}){
  if(!record || typeof record !== 'object') return record;
  return { ...record, deletedAt: at, deletedBy: by };
}

export function unDelete(record){
  if(!record || typeof record !== 'object') return record;
  const { deletedAt, deletedBy, ...rest } = record;
  return rest;
}

export function tombstoneId(entity, id){
  return `${entity}:${id}`;
}

export function makeTombstone(entity, id, { at = new Date().toISOString(), deviceId = undefined } = {}){
  return {
    id: tombstoneId(entity, id),
    entity,          // which store the row lived in: 'sessions' | 'templates' | …
    refId: id,       // the deleted row's id
    deletedAt: at,
    deviceId,
    source: 'sync',
  };
}

export function isTombstone(record){
  return Boolean(record && typeof record === 'object' && record.refId && record.entity && record.deletedAt && !record.blocks);
}

/**
 * Apply tombstones to a row set: drop rows the tombstones cover.
 * (Sync replays this after a pull so deletions propagate.)
 */
export function applyTombstones(rows, tombstones){
  const byRef = new Map((tombstones || []).filter(isTombstone).map((t) => [t.refId, t]));
  return (rows || []).filter((row) => {
    if(!row?.id) return true;
    const t = byRef.get(row.id);
    if(!t) return true;
    return Date.parse(row.savedAt || row.updatedAtISO || '1970-01-01') > Date.parse(t.deletedAt);
  });
}

// ── Versioned export contract ───────────────────────────────────────────────
// Export files promise three things: `app` (which product), `contract`
// (which file format — independent of the store schema version) and
// `contractMin` (the oldest contract this file's semantics still honour).
// Import adapters key off `contract`, never off app version.
export const EXPORT_CONTRACT = 'arise.export.v1';
export const EXPORT_CONTRACT_MIN = 1;

// ── Write-time normalisation ────────────────────────────────────────────────
/**
 * Normalise history entries just before writing: coerce set fields to the
 * canonical string form, validate every session against the schema, drop
 * what cannot be salvaged (and report the drop), stamp source tags and
 * reset soft-delete flags on rows that are being rewritten live.
 * @returns {{ history: Array, dropped: number }}
 */
export function normalizeHistoryForWrite(history, { source = 'manual' } = {}){
  const out = [];
  let dropped = 0;
  for(const entry of history || []){
    const parsed = sessionSchema.safeParse(entry);
    if(!parsed.success){ dropped += 1; continue; }
    const session = parsed.data;
    out.push({
      ...session,
      ...ensureSourceTags(session, source),
      // A row being rewritten keeps its soft-delete state — normalisation
      // must never resurrect a deleted record.
      deletedAt: session.deletedAt ?? null,
      deletedBy: session.deletedAt ? (session.deletedBy ?? 'user') : undefined,
    });
  }
  return { history: out, dropped };
}
