// StorageDiagnostics.jsx — the "storage health" screen: data hygiene findings,
// archive/prune maintenance, automatic snapshots and rollback, migration logs.
// Everything here reads the canonical IndexedDB stores directly, so the panel
// shows what is actually persisted, not just the hydrated in-memory view.

import { useCallback, useEffect, useState } from 'react';
import { auditStore, repairFindings } from '../lib/audit.js';
import { archiveOldSessions, pruneEvents, archiveCandidateCount, archivedSessionCount, restoreArchive } from '../lib/archive.js';
import { listSnapshots, rollbackToSnapshot, captureSnapshot } from '../lib/snapshots.js';
import { listMigrationLogs } from '../lib/migrationLog.js';
import { whenPersisted } from '../lib/storage.js';

const FINDING_LABELS = {
  'duplicate-session': 'Duplicate sessions',
  'duplicate-set': 'Duplicate set entries',
  'orphaned-set': 'Orphaned set entries',
  'invalid-date': 'Unparseable dates',
  'impossible-value': 'Impossible values',
  'schema-drift': 'Schema drift',
};

const RELOAD_AFTER_MS = 1400;

export default function StorageDiagnostics({ setMsg }){
  const [diag, setDiag] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async ()=>{
    const [audit, archiveCandidates, archived, snapshots, migrationLogs, prunePreview] = await Promise.all([
      auditStore(),
      archiveCandidateCount(365),
      archivedSessionCount(),
      listSnapshots(),
      listMigrationLogs(),
      pruneEvents({ dryRun: true }),
    ]);
    setDiag({ audit, archiveCandidates, archived, snapshots, migrationLogs, prunePreview });
  }, []);

  useEffect(()=> { refresh(); }, [refresh]);

  const run = (fn, message, { reload = false } = {})=> async ()=>{
    setBusy(true);
    try{
      const result = await fn();
      await whenPersisted();
      setMsg(typeof message === 'function' ? message(result) : message);
      if(reload) setTimeout(()=> location.reload(), RELOAD_AFTER_MS);
      else await refresh();
    }catch(err){
      setMsg(String(err?.message || err));
    }finally{
      setBusy(false);
      setTimeout(()=> setMsg(null), 6000);
    }
  };

  const findings = diag?.audit?.findings || [];

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-bold">Storage health & maintenance</h3>
      {!diag && <p className="text-xs text-ink3">Checking stored data…</p>}
      {diag && (
        <>
          <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs space-y-1">
            <p>
              {findings.length === 0
                ? 'No data problems found.'
                : <span className="font-bold">{findings.length} issue{findings.length === 1 ? '' : 's'} found in stored data.</span>}
            </p>
            {findings.map((f, i)=> (
              <p key={i} className="text-ink3">
                <span className="font-semibold">{FINDING_LABELS[f.type] || f.type}:</span> {f.detail}
              </p>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {findings.length > 0 && (
              <button disabled={busy} onClick={run(()=> repairFindings(findings), (r)=> `Repaired: ${r.deletedSessions} sessions and ${r.deletedSets} set rows removed, ${r.neutralisedSets} values corrected.`, { reload: true })} className="btn btn-primary min-h-10 rounded-xl px-4 disabled:opacity-50">Repair issues</button>
            )}
            <button disabled={busy || !diag.archiveCandidates} onClick={run(()=> archiveOldSessions(365), (r)=> `Archived ${r.archived} session${r.archived === 1 ? '' : 's'} older than a year. They stay on this device and can be restored.`, { reload: true })} className="btn btn-secondary min-h-10 rounded-xl px-4 disabled:opacity-50">Archive old sessions</button>
            <button disabled={busy || !diag.prunePreview.pruned} onClick={run(()=> pruneEvents({}), (r)=> `Pruned ${r.pruned} old event${r.pruned === 1 ? '' : 's'} (telemetry only — training data untouched).`, { reload: true })} className="btn btn-secondary min-h-10 rounded-xl px-4 disabled:opacity-50">Prune old events</button>
            <button disabled={busy} onClick={run(()=> captureSnapshot({ force: true, reason: 'manual' }), 'Snapshot captured — a restorable copy of everything stored.')} className="btn btn-secondary min-h-10 rounded-xl px-4 disabled:opacity-50">Snapshot now</button>
            {diag.snapshots.length > 0 && (
              <button disabled={busy} onClick={()=> { if(confirm(`Roll back to the snapshot from ${new Date(diag.snapshots[0].at).toLocaleString()}?\n\nEverything stored since then is replaced. Exports are unaffected.`)) run(()=> rollbackToSnapshot(diag.snapshots[0].id), 'Rolled back — reloading…', { reload: true })(); }} className="btn btn-secondary min-h-10 rounded-xl px-4 disabled:opacity-50">Roll back to snapshot</button>
            )}
            {diag.archived > 0 && (
              <button disabled={busy} onClick={run(()=> restoreArchive(), (r)=> `Restored ${r} archived session${r === 1 ? '' : 's'} to live history.`, { reload: true })} className="btn btn-secondary min-h-10 rounded-xl px-4 disabled:opacity-50">Restore archive</button>
            )}
          </div>
          <p className="text-xs text-ink3">
            {diag.archiveCandidates > 0 && <>{diag.archiveCandidates} session{diag.archiveCandidates === 1 ? '' : 's'} older than a year could be archived. </>}
            {diag.archived > 0 && <>{diag.archived} archived session{diag.archived === 1 ? '' : 's'} kept on this device — restore them any time. </>}
            Snapshots: {diag.snapshots.length ? `latest ${new Date(diag.snapshots[0].at).toLocaleString()}` : 'none yet — one is taken automatically at boot'}.
          </p>
          {!!diag.migrationLogs.length && (
            <details className="text-xs">
              <summary className="font-semibold cursor-pointer">Migration log ({diag.migrationLogs.length})</summary>
              <ul className="mt-2 space-y-1 text-ink3">
                {diag.migrationLogs.slice(0, 10).map((log)=> (
                  <li key={log.id}>
                    {new Date(log.at).toLocaleString()}: schema v{log.from} → {log.to == null ? 'failed' : `v${log.to}`}{log.dryRun ? ' (dry run)' : ''}{log.error ? ` — ${log.error}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
