// restoreService.js — import/restore workflow logic, separated from the More
// surface so the parse-preview-apply sequence is testable and has one owner.
//
// Import is deliberately two-step and reviewable: a file is parsed and
// previewed (counts, conflicts, denied fields, origin metadata) and NOTHING is
// applied until the surface asks to apply. Apply itself is already-confirmed:
// any destructive "replace this device" confirmation happens in the UI, never
// here, so the operation can also be driven programmatically.

import { parseImportFile, parseBackupFile, mergeStores } from '../lib/export.js';
import { buildImportPreview } from '../lib/exportPolicy.js';
import { mergeEventHistory, replaceEventHistory, getEventHistory } from '../lib/telemetry.js';
import { normaliseHistoryEntry } from '../lib/store.js';

// Parse any accepted backup text (plain JSON or the compressed .arise
// envelope) and build the reviewable preview. Never applies anything.
export async function previewBackupFile(text, store){
  const inner = await parseBackupFile(text);
  const preview = buildImportPreview(inner, store);
  return preview;
}

// Preview an already-parsed payload (e.g. a decrypted encrypted backup):
// same reviewable preview contract as previewBackupFile.
export function previewBackupPayload(inner, store){
  return buildImportPreview(inner, store);
}

// Apply a reviewed preview. strategy 'merge' de-dupes by session id and keeps
// the current copy on conflicts; 'replace' overwrites the device and resets
// the event ledger to the backup's copy. Returns the next store and the
// persistence options for the caller's setStore.
export function applyImportPreview({ preview, store, strategy, importFile = parseImportFile }){
  const imported = importFile(JSON.stringify(preview.envelope));
  const merged = mergeStores(store, imported, strategy);
  if(strategy === 'replace') replaceEventHistory(imported.eventHistory || []);
  else if(imported.eventHistory?.length) mergeEventHistory(imported.eventHistory);
  return {
    store: { ...merged, eventHistory: getEventHistory() },
    persistenceOptions: strategy === 'replace' ? { collectionMode: 'replace' } : null,
    summary: strategy === 'replace'
      ? { kind: 'replaced' }
      : { kind: 'merged', additions: preview.counts.additions, updates: preview.counts.updates },
  };
}

// Import rows exported by other gym apps: mapped through the documented CSV
// schemas into portable sessions. Unmapped exercises are reported, never
// silently dropped.
export async function importAppCsv({ text, store, byId, parse, rowsToHistory }){
  const parsed = parse(text, { byId });
  if(!parsed.rows.length){
    return { ok: false, skipped: parsed.skipped, unmappedExercises: parsed.unmappedExercises || [] };
  }
  const entries = rowsToHistory(parsed.rows, { byId }).map((en)=> normaliseHistoryEntry(en));
  const merged = mergeStores(store, { history: entries, eventHistory: [] }, 'merge');
  return {
    ok: true,
    store: { ...merged },
    rowCount: parsed.rows.length,
    sessionCount: entries.length,
    unmappedExercises: parsed.unmappedExercises || [],
    skipped: parsed.skipped,
  };
}
