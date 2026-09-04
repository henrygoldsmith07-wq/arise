// exportPolicy.js — the versioned export file contract, the dangerous-field
// policy for imports, the import preview/conflict builder, and the
// backward-compatible adapters that pre-contract files come through.
//
// The contract lives in two layers:
//   envelope:  { app, contract, contractMin, payloadVersion, schemaVersion,
//                exportedAt, device, appVersion, data }
//   payload:   the store snapshot `data` (same shape as every arise export)
// Pre-contract files (v1–v3 plain JSON, the v1 gzip envelope, encrypted
// .arisebak) are adapted to the current envelope before validation, so an
// export from 2024 still imports in 2030.

import { z } from 'zod';
import { EXPORT_CONTRACT, EXPORT_CONTRACT_MIN } from './domain.js';

const APP_NAME = 'arise';

// ── Device id (export metadata + tombstone provenance) ──────────────────────
let deviceId = null;
export function getDeviceId(){
  if(deviceId) return deviceId;
  try{ deviceId = localStorage.getItem('arise.deviceId'); }catch{}
  if(!deviceId){
    deviceId = `dev_${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try{ localStorage.setItem('arise.deviceId', deviceId); }catch{}
  }
  return deviceId;
}

export function getAppVersion(){
  try{ return globalThis.__ARISE_APP_VERSION__ || null; }
  catch{ return null; }
}

// ── Contract envelope schema ────────────────────────────────────────────────
const timestampSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Expected a parseable timestamp');

export const exportEnvelopeSchema = z.object({
  app: z.literal(APP_NAME),
  contract: z.string().min(1),
  contractMin: z.number().int().positive(),
  payloadVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive().optional(),
  exportedAt: timestampSchema,
  device: z.string().min(1),
  appVersion: z.string().nullable().optional(),
  data: z.object({}).passthrough(),
});

/** Validate an envelope against the contract; returns { ok, errors }. */
export function validateEnvelope(envelope){
  const parsed = exportEnvelopeSchema.safeParse(envelope);
  return parsed.success ? { ok: true, errors: [] } : { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'envelope'}: ${i.message}`) };
}

// ── Building exports ────────────────────────────────────────────────────────
export function buildEnvelope({ payload, payloadVersion, schemaVersion }){
  return {
    app: APP_NAME,
    contract: EXPORT_CONTRACT,          // 'arise.export.v1'
    contractMin: EXPORT_CONTRACT_MIN,
    payloadVersion,
    schemaVersion,
    exportedAt: new Date().toISOString(),
    device: getDeviceId(),
    appVersion: getAppVersion(),
    data: payload,
  };
}

/** True when the object already carries the current contract marker. */
export function isCurrentContract(envelope){
  return envelope?.contract === EXPORT_CONTRACT;
}

// ── Backward-compatible import adapters (oldest first) ──────────────────────
/**
 * Bring any historical arise export shape up to the current envelope.
 * @returns {{ envelope: object|null, adapter: string|null }}
 */
export function adaptImportEnvelope(parsed){
  // The current contract, verbatim.
  if(parsed?.app === APP_NAME && parsed?.contract === EXPORT_CONTRACT){
    return { envelope: parsed, adapter: null };
  }
  // The v1 gzip envelope: { app:'arise', format:'arise+gzip', v:1, encoding, data }
  if(parsed?.format === 'arise+gzip'){
    return {
      envelope: {
        app: APP_NAME,
        contract: EXPORT_CONTRACT,
        contractMin: EXPORT_CONTRACT_MIN,
        payloadVersion: 1,
        schemaVersion: Number(parsed?.data?.version) || undefined,
        exportedAt: parsed?.data?.exportedAt || new Date(0).toISOString(),
        device: 'unknown-pre-contract',
        appVersion: null,
        data: parsed.data,
      },
      adapter: 'gzip-v1',
    };
  }
  // Plain pre-contract exports: { app:'arise', version:1..3, exportedAt, data }
  if(parsed?.app === APP_NAME && !parsed?.contract){
    return {
      envelope: {
        app: APP_NAME,
        contract: `arise.pre-contract.v${Number(parsed?.version) || 1}`,
        contractMin: 1,
        payloadVersion: Number(parsed?.version) || 1,
        schemaVersion: Number(parsed?.schemaVersion ?? parsed?.data?.version) || undefined,
        exportedAt: parsed?.exportedAt || new Date(0).toISOString(),
        device: 'unknown-pre-contract',
        appVersion: null,
        data: parsed.data,
      },
      adapter: 'pre-contract',
    };
  }
  // Unbranded snapshot with a data envelope: { data: {...} }.
  if(parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object'){
    return {
      envelope: {
        app: APP_NAME,
        contract: 'unbranded',
        contractMin: 1,
        payloadVersion: 1,
        schemaVersion: Number(parsed?.schemaVersion ?? parsed?.data?.version) || undefined,
        exportedAt: parsed?.exportedAt || new Date(0).toISOString(),
        device: 'unknown',
        appVersion: null,
        data: parsed.data,
      },
      adapter: 'unbranded',
    };
  }
  // The bare store snapshot itself: { history, onboarding, … }.
  if(parsed && typeof parsed === 'object'){
    return {
      envelope: {
        app: APP_NAME,
        contract: 'bare-store',
        contractMin: 1,
        payloadVersion: 1,
        schemaVersion: Number(parsed?.version) || undefined,
        exportedAt: new Date(0).toISOString(),
        device: 'unknown',
        appVersion: null,
        data: parsed,
      },
      adapter: 'bare-store',
    };
  }
  return { envelope: null, adapter: null };
}

// ── Dangerous-field policy ──────────────────────────────────────────────────
// Importing is trust. Consent toggles are device-local decisions and are
// NEVER file-supplied: a backup must not be able to switch measurement or
// sharing on. Prototype-pollution vectors are structural denials. The study
// identity and health summary DO travel deliberately (studyIdentity.js folds
// repeated exports into one participant; summaries port between a user's own
// devices), so they stay allowed — matching the established export tests.
// Top-level keys are allow-listed (default-deny): anything the store grows
// later is not silently importable until it is explicitly permitted here.
export const DENY_FIELDS = [
  'preferences.telemetryEnabled',          // consent is device-local
  'preferences.pulseEnabled',
  'preferences.healthSummaryEnabled',
  'preferences.syncEnabled',
  'preferences.sync',                     // WebDAV credentials + passphrase: device-local
  '__proto__', 'constructor', 'prototype', // pollution vectors
];

// Top-level keys that may enter the store from an import. studyParticipantId
// and healthSummary travel deliberately (study folding / device portability);
// the device-local CONSENT toggles inside preferences are denied above.
export const IMPORT_ALLOW_KEYS = [
  'onboarding', 'activeSchedule', 'activeWorkout', 'history', 'preferences',
  'readinessLog', 'programHistory', 'evaluationLedger', 'customTemplates',
  'eventHistory', 'studyEnrollment', 'tombstones',
  'studyParticipantId', 'healthSummary',
];

const NESTED_DENY = DENY_FIELDS.filter((f) => f.includes('.')).map((f) => f.split('.')[1]);
const TOP_DENY = DENY_FIELDS.filter((f) => !f.includes('.'));

/** Apply the policy: allow-list keys, strip denied fields (incl. nested). */
export function applyFieldPolicy(data){
  const out = {};
  for(const key of Object.keys(data || {})){
    if(!IMPORT_ALLOW_KEYS.includes(key) || TOP_DENY.includes(key)) continue;
    if(key === 'preferences' && data.preferences && typeof data.preferences === 'object'){
      const prefs = { ...data.preferences };
      for(const k of Object.keys(prefs)) if(NESTED_DENY.includes(k)) delete prefs[k];
      out[key] = prefs;
      continue;
    }
    out[key] = data[key];
  }
  // version is required by every downstream consumer but is contract
  // metadata, not user content — carried from the source payload.
  if(data?.version != null && out.version === undefined) out.version = data.version;
  return out;
}

/** Which denied fields were present in the file (for the preview UI). */
export function deniedFieldsPresent(data){
  const present = [];
  const has = (path) => path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), data) !== undefined;
  const own = (key) => Object.prototype.hasOwnProperty.call(data || {}, key);
  for(const field of DENY_FIELDS){
    // Pollution vectors are structural: only report them when actually OWN
    // keys (inherited Object.prototype must not false-positive).
    if(['__proto__','constructor','prototype'].includes(field)){ if(own(field)) present.push(field); }
    else if(field.includes('.')){ if(has(field)) present.push(field); }
    else if(data[field] !== undefined) present.push(field);
  }
  return present;
}

// ── Import preview & conflict detection ─────────────────────────────────────
const setCount = (s) => (s.blocks || []).reduce((n, b) => n + (b.sets || []).length, 0);
const tsOf = (s) => Date.parse(s?.savedAt || s?.dateISO || '1970-01-01') || 0;

/**
 * Build the preview the confirm-UI renders BEFORE anything is applied.
 * Read-only: nothing here mutates stores or state.
 * @returns {{ ok, reason?, envelope?, adapter?, meta?, counts?, conflicts?, conflictsTotal?, deniedFields? }}
 */
export function buildImportPreview(rawData, currentStore){
  let parsed;
  try{ parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData; }
  catch{ return { ok: false, reason: 'Not valid JSON.' }; }
  const { envelope, adapter } = adaptImportEnvelope(parsed);
  if(!envelope) return { ok: false, reason: 'Not a recogniseable arise backup.' };
  const gate = validateEnvelope({ ...envelope, schemaVersion: envelope.schemaVersion || 1 });
  if(!gate.ok) return { ok: false, reason: `Backup failed the contract check: ${gate.errors.join(' ')}` };

  const data = envelope.data;
  const history = Array.isArray(data?.history) ? data.history : [];
  const current = currentStore || {};
  const currentById = new Map((current.history || []).map((h) => [h.id, h]));
  const conflicts = [];
  let additions = 0;
  for(const s of history){
    const existing = currentById.get(s?.id);
    if(!existing) additions += 1;
    else if(JSON.stringify(s) !== JSON.stringify(existing)){
      conflicts.push({
        sessionId: s.id,
        dateISO: s.dateISO,
        existingSets: setCount(existing),
        incomingSets: setCount(s),
        existingAt: existing.savedAt || null,
        incomingAt: s.savedAt || null,
        incomingNewer: tsOf(s) >= tsOf(existing),
      });
    }
  }
  const counts = {
    sessions: history.length,
    sets: history.reduce((n, s) => n + setCount(s), 0),
    events: Array.isArray(data?.eventHistory) ? data.eventHistory.length : 0,
    ledger: Array.isArray(data?.evaluationLedger) ? data.evaluationLedger.length : 0,
    templates: Array.isArray(data?.customTemplates) ? data.customTemplates.length : 0,
    readiness: Array.isArray(data?.readinessLog) ? data.readinessLog.length : 0,
    additions,
    updates: conflicts.length,
  };
  const meta = {
    exportedAt: envelope.exportedAt,
    device: envelope.device,
    appVersion: envelope.appVersion ?? null,
    contract: envelope.contract,
    contractRecognised: envelope.contract === EXPORT_CONTRACT,
    payloadVersion: envelope.payloadVersion,
    schemaVersion: envelope.schemaVersion ?? null,
    adapter,
  };
  return {
    ok: true,
    envelope,
    adapter,
    meta,
    counts,
    conflicts: conflicts.slice(0, 20),
    conflictsTotal: conflicts.length,
    deniedFields: deniedFieldsPresent(data),
  };
}
