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

import { z } from './schema.js';
import { isDateOnly } from './dateOnly.js';

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
const dateISOSchema = z.string().refine(isDateOnly, 'Expected a valid ISO calendar date (YYYY-MM-DD)');

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

// Trust ordering for the write-once rule: evidence can LOSE trust (import,
// ambiguity) but can never REGAIN it through inference. A malformed or
// unknown origin ranks below everything, so no stamp may lift it to trusted.
export const PROVENANCE_TRUST_RANK = Object.freeze({ 'live-engine': 3, replayed: 2, seed: 1, imported: 0 });

// Stamp ONE provenance field of a record with write-once semantics:
//   - first write (no existing origin): the requested origin is applied;
//   - requested rank ≤ existing rank (equal or downgrade): applied;
//   - requested rank > existing rank (upgrade): DENIED — the recorded origin
//     stays exactly as it was and only non-trust metadata merges.
// A malformed provenance block is never parsed into a trusted origin; it is
// preserved verbatim so downstream gates exclude it.
function stampProvenanceField(record, field, origin, meta = {}){
  if(!record || typeof record !== 'object') return record;
  const { origin: _dropped, ...safeMeta } = meta || {};
  const existing = record[field];
  const existingIsObject = existing != null && typeof existing === 'object' && !Array.isArray(existing);
  const existingOrigin = existingIsObject ? existing.origin : undefined;
  const hasExisting = existingOrigin !== undefined && existingOrigin !== null;
  const requestedRank = PROVENANCE_TRUST_RANK[origin] ?? -1;
  const existingRank = PROVENANCE_TRUST_RANK[existingOrigin] ?? -1;
  if(hasExisting && requestedRank > existingRank){
    // Upgrade attempt on a recorded origin: denied. Preserve the block
    // verbatim (malformed stays malformed); merge only safe metadata.
    if(!existingIsObject) return record;
    return { ...record, [field]: { ...existing, ...safeMeta, origin: existingOrigin } };
  }
  const parsed = provenanceSchema.safeParse({ ...(existingIsObject ? existing : {}), origin, capturedAt: safeMeta.capturedAt || new Date().toISOString(), ...safeMeta });
  return { ...record, [field]: parsed.success ? parsed.data : { origin: hasExisting ? existingOrigin : origin, capturedAt: safeMeta.capturedAt || new Date().toISOString() } };
}

/** Attach/refresh a ledger record's recommendation provenance (write-once). */
export function withProvenance(record, origin, meta = {}){
  return stampProvenanceField(record, 'provenance', origin, meta);
}

/** Attach/refresh a ledger record's outcome provenance (write-once). */
export function withOutcomeProvenance(record, origin, meta = {}){
  return stampProvenanceField(record, 'outcomeProvenance', origin, meta);
}

/**
 * Import stamp for ledger rows: BOTH sides downgrade to 'imported' (or stay
 * lower). This is the import → re-export chain guarantee — a row that landed
 * on another device keeps 'imported' through every later export and can never
 * re-enter study analysis as live-engine evidence.
 */
export function importLedgerProvenance(record){
  return withOutcomeProvenance(withProvenance(record, 'imported'), 'imported');
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

/** A tombstone is usable only when its identity and timestamp are well-formed. */
export function isValidTombstone(record){
  if(!isTombstone(record)) return false;
  if(typeof record.entity !== 'string' || !record.entity) return false;
  if(typeof record.refId !== 'string' || !record.refId) return false;
  return Number.isFinite(Date.parse(record.deletedAt));
}

/**
 * Recursively key-sorted serialisation for deterministic tie-breaks. A
 * shallow replacer array would drop nested keys (e.g. session ids), making
 * equal-timestamp conflict resolution order-dependent (non-commutative).
 */
export function canonicalJson(value){
  try{
    const stable = (v)=>{
      if(Array.isArray(v)) return v.map(stable);
      if(v && typeof v === 'object'){
        const out = {};
        for(const k of Object.keys(v).sort()) out[k] = stable(v[k]);
        return out;
      }
      return v;
    };
    return JSON.stringify(stable(value));
  }catch{ return String(value); }
}

function tombstoneKey(entity, refId){
  return `${entity}:${refId}`;
}

/**
 * Canonical tombstone union: identity is `entity + refId`. For conflicting
 * tombstones for the same entity, the newest valid `deletedAt` wins.
 * Malformed tombstones are dropped. Deterministic: sorted by id.
 */
export function mergeTombstones(current = [], incoming = []){
  const byId = new Map();
  for(const t of [...(current || []), ...(incoming || [])]){
    if(!isValidTombstone(t)) continue;
    const key = tombstoneKey(t.entity, t.refId);
    const id = typeof t.id === 'string' && t.id ? t.id : key;
    const existing = byId.get(key);
    if(!existing || Date.parse(t.deletedAt) >= Date.parse(existing.deletedAt)){
      byId.set(key, { ...t, id });
    }
  }
  return [...byId.values()].sort((a, b)=> String(a.id).localeCompare(String(b.id)));
}

/**
 * Canonical row recency for conflict resolution (sessions, templates,
 * tombstone-adjacent rows): first parseable timestamp wins, else 0.
 * One definition shared by sync, storage, archive and export merges so
 * equal-timestamp tie-breaks agree everywhere.
 */
export function rowTimestamp(row){
  const candidates = [row?.savedAt, row?.updatedAtISO, row?.updatedAt, row?.finishedAt, row?.dateISO ? `${row.dateISO}T00:00:00Z` : null];
  for(const c of candidates){
    const t = Date.parse(c || '');
    if(Number.isFinite(t)) return t;
  }
  return 0;
}

/**
 * Apply tombstones to a row set: drop rows the tombstones cover.
 * (Sync replays this after a pull so deletions propagate.)
 * `entity` makes application entity-aware: a session and a template sharing
 * the same refId must not affect each other. When `entity` is omitted the
 * legacy refId-only behaviour applies.
 */
export function applyTombstones(rows, tombstones, entity = null){
  const valid = (tombstones || []).filter(isValidTombstone).filter((t) => !entity || t.entity === entity);
  const byRef = new Map();
  for(const t of valid){
    const existing = byRef.get(t.refId);
    if(!existing || Date.parse(t.deletedAt) >= Date.parse(existing.deletedAt)) byRef.set(t.refId, t);
  }
  return (rows || []).filter((row) => {
    if(!row?.id) return true;
    const t = byRef.get(row.id);
    if(!t) return true;
    // An offline edit written after the deletion wins; a deletion newer than
    // (or equal to) the row wins. Equal favours deletion (deterministic).
    return rowTimestamp(row) > Date.parse(t.deletedAt);
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
