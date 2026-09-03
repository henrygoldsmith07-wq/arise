// core/config.js — centralized, dependency-free app configuration.
//
// Every cross-module constant lives here exactly once: storage keys, schema
// versions, retention limits, timings. Modules import from this file instead
// of re-declaring their own numbers, so a change is reviewable in one diff.
// The app version itself is injected at build time (vite `define`); tests and
// Node see `null` for it, which export metadata renders honestly.

export const APP_NAME = 'arise';

export const CONFIG = Object.freeze({
  app: APP_NAME,

  // ── Schema / contract versions (canonical owners noted) ──────────────────
  storeSchemaVersion: 9,            // store.js migrations
  exportContract: 'arise.export.v1',// domain.js / exportPolicy.js
  exportContractMin: 1,
  exportPayloadVersion: 4,          // export.js EXPORT_VERSION
  evaluationSchemaVersion: 2,       // longitudinal.js ledger records

  // ── Storage keys (localStorage: flags/prefs/paint-critical only) ─────────
  keys: Object.freeze({
    legacyStore: 'arise.store.v1',
    storePointer: 'arise.store.v1.pointer',
    preIdbBackup: 'arise.store.v1.pre-idb-backup',
    corruptStore: 'arise.store.v1.corrupt',
    evaluationLedger: 'arise.evaluation.v1',
    telemetry: 'arise.telemetry.v2',
    telemetryLegacy: 'arise.telemetry.v1',
    deviceId: 'arise.deviceId',
  }),

  // ── Retention & limits ───────────────────────────────────────────────────
  limits: Object.freeze({
    quarantineRecords: 5,           // integrity.js
    snapshotsKept: 7,               // snapshots.js
    snapshotMinIntervalMs: 30 * 60 * 1000,
    tombstoneTtlDays: 60,           // domain.js
    telemetryEventLimit: 2000,      // telemetry.js
    eventPruneMaxAgeDays: 180,      // archive.js
    eventPruneMaxCount: 2000,
    archiveOlderThanDays: 365,
    openLedgerRecordsDefault: 6,    // longitudinal.js default (priors may override)
    ledgerRetentionDefault: 600,
  }),

  // ── Query defaults (queries.js) ──────────────────────────────────────────
  queries: Object.freeze({
    defaultPageSize: 50,
  }),

  // ── Feature flags (single source of truth; see core/flags.js) ────────────
  flags: Object.freeze({
    syncEngine: { label: 'Cross-device sync engine', default: false, stage: 'experimental' },
    encryptedBackups: { label: 'Encrypted backup files', default: true, stage: 'stable' },
    archiveMode: { label: 'Archive & restore old sessions', default: true, stage: 'stable' },
    voiceCoach: { label: 'Voice coach in guided mode', default: false, stage: 'experimental' },
  }),
});

export default CONFIG;
