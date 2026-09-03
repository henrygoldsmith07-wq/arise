// migrationLog.js — migration dry-run, logs, and failure recovery.
//
// Schema migrations used to be an unobservable step: if one threw, the boot
// crashed or data silently stayed stale. This wrapper makes the chain
// accountable:
//   - dry-run: report what a payload WOULD become, touching nothing
//   - logs: every real migration appends an immutable `migration` event
//     (exempt from telemetry pruning — archive.js treats it as essential)
//   - failure recovery: a throwing migration is recorded, the payload is
//     left untouched, and the caller gets a clear signal instead of a crash
//     or silent staleness. The raw payload stays in the boot gate's
//     quarantine so a support flow can still recover it.

import { runMigrations, STORE_SCHEMA_VERSION } from './store.js';
import { idbGetAll, idbPut } from './idb.js';

/** What would this payload become? Deep-cloned in, nothing persisted. */
export function dryRunMigration(raw){
  const clone = typeof structuredClone === 'function'
    ? structuredClone(raw)
    : JSON.parse(JSON.stringify(raw));
  const from = Number(clone?.version) || 1;
  try{
    const migrated = runMigrations(clone);
    return {
      ok: true,
      from,
      to: Number(migrated?.version) || STORE_SCHEMA_VERSION,
      steps: Math.max(0, (Number(migrated?.version) || STORE_SCHEMA_VERSION) - from),
      preview: migrated,
    };
  }catch(err){
    return { ok: false, from, to: null, steps: 0, error: String(err?.message || err) };
  }
}

/** Append a durable migration log row (id makes replays collapse to one). */
export async function logMigration({ from, to, dryRun = false, error = null }){
  try{
    await idbPut('events', {
      id: `migration:${from}->${to}:${dryRun ? 'dry' : 'real'}`,
      type: 'migration',
      at: new Date().toISOString(),
      from,
      to,
      dryRun,
      error,
    });
  }catch{ /* logging must never break migration itself */ }
}

export async function listMigrationLogs(){
  const events = (await idbGetAll('events')) || [];
  return events.filter((e) => e?.type === 'migration')
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

/**
 * Migrate with accountability: success appends a log row; a thrown migration
 * is recorded with its error and re-raised as a typed Error the boot gate
 * already knows how to quarantine.
 */
export async function migrateWithLogging(raw){
  const clone = typeof structuredClone === 'function'
    ? structuredClone(raw)
    : JSON.parse(JSON.stringify(raw));
  const from = Number(clone?.version) || 1;
  try{
    const migrated = runMigrations(clone);
    const to = Number(migrated?.version) || STORE_SCHEMA_VERSION;
    if(to !== from) await logMigration({ from, to });
    return migrated;
  }catch(err){
    await logMigration({ from, to: null, error: String(err?.message || err) });
    const wrapped = new Error(`Migration failed from schema v${from}: ${err?.message || err}`);
    wrapped.migrationFailed = true;
    wrapped.from = from;
    throw wrapped;
  }
}
