// StorageDiagnostics.jsx — the "storage health" screen: data hygiene findings,
// archive/prune maintenance, automatic snapshots and rollback, migration logs.
// Everything here reads the canonical IndexedDB stores directly, so the panel
// shows what is actually persisted, not just the hydrated in-memory view.

import { useCallback, useEffect, useState } from 'react';
import { auditStore, repairFindings } from '../lib/audit.js';
import { archiveOldSessions, pruneEvents, archiveCandidateCount, archivedSessionCount, listArchivedSessions, restoreArchivedSession, restoreArchive } from '../lib/archive.js';
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveRows, setArchiveRows] = useState([]);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archivePage, setArchivePage] = useState(0);

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

  const refreshArchive = useCallback(async ()=>{
    const rows = await listArchivedSessions();
    setArchiveRows(rows);
  }, []);

  useEffect(()=>{
    if(!archiveOpen) return;
    refreshArchive();
  }, [archiveOpen, refreshArchive]);

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
  const archiveNeedle = archiveQuery.trim().toLowerCase();
  const archiveFiltered = archiveNeedle
    ? archiveRows.filter((session)=> {
        const haystack = [
          session?.dateISO,
          session?.title,
          session?.name,
          ...(session?.blocks || []).map((block)=> block?.exerciseId),
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(archiveNeedle);
      })
    : archiveRows;
  const ARCHIVE_PAGE_SIZE = 10;
  const archivePages = Math.max(1, Math.ceil(archiveFiltered.length / ARCHIVE_PAGE_SIZE));
  const safeArchivePage = Math.min(archivePage, archivePages - 1);
  const archivePageRows = archiveFiltered.slice(safeArchivePage * ARCHIVE_PAGE_SIZE, (safeArchivePage + 1) * ARCHIVE_PAGE_SIZE);
  const sessionSetCount = (session)=> (session?.blocks || []).reduce((sum, block)=> sum + (block?.sets || []).length, 0);

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
              <>
                <button
                  disabled={busy}
                  onClick={()=> { setArchiveOpen(v=> !v); setArchivePage(0); }}
                  aria-expanded={archiveOpen}
                  className="btn btn-secondary min-h-10 rounded-xl px-4 disabled:opacity-50"
                >
                  {archiveOpen ? 'Hide archive' : `Browse archive (${diag.archived})`}
                </button>
                <button disabled={busy} onClick={run(()=> restoreArchive(), (r)=> `Restored ${r} archived session${r === 1 ? '' : 's'} to live history.`, { reload: true })} className="btn btn-secondary min-h-10 rounded-xl px-4 disabled:opacity-50">Restore all</button>
              </>
            )}
          </div>
          <p className="text-xs text-ink3">
            {diag.archiveCandidates > 0 && <>{diag.archiveCandidates} session{diag.archiveCandidates === 1 ? '' : 's'} older than a year could be archived. </>}
            {diag.archived > 0 && <>{diag.archived} archived session{diag.archived === 1 ? '' : 's'} kept on this device — browse or restore them any time. </>}
            Snapshots: {diag.snapshots.length ? `latest ${new Date(diag.snapshots[0].at).toLocaleString()}` : 'none yet — one is taken automatically at boot'}.
          </p>
          {archiveOpen && (
            <div className="rounded-xl border border-line bg-surface2 p-3 space-y-2" aria-label="Archived training sessions">
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold">Archived history</p>
                <span className="ml-auto text-[11px] text-ink3">{archiveFiltered.length} session{archiveFiltered.length === 1 ? '' : 's'}</span>
              </div>
              <label className="block text-[11px] text-ink3">
                Search archive
                <input
                  type="search"
                  value={archiveQuery}
                  onChange={(e)=> { setArchiveQuery(e.target.value); setArchivePage(0); }}
                  placeholder="Date, session or exercise id"
                  className="mt-1 w-full min-h-10 rounded-xl border border-line bg-surface px-3 text-xs text-ink"
                />
              </label>
              {archivePageRows.length ? (
                <ul className="space-y-1.5">
                  {archivePageRows.map((session)=> (
                    <li key={session.id} className="rounded-xl border border-line bg-surface px-3 py-2 text-xs">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate">{session.title || session.name || 'Training session'}</p>
                          <p className="text-ink3">
                            {session.dateISO || 'Unknown date'} · {(session.blocks || []).length} exercise{(session.blocks || []).length === 1 ? '' : 's'} · {sessionSetCount(session)} sets
                          </p>
                        </div>
                        <button
                          disabled={busy}
                          onClick={run(
                            async ()=> {
                              const restored = await restoreArchivedSession(session.id);
                              if(restored){
                                await refreshArchive();
                                await refresh();
                              }
                              return restored;
                            },
                            (restored)=> restored ? 'Session restored to live history.' : 'That archived session was no longer available.'
                          )}
                          className="shrink-0 min-h-8 rounded-lg border border-line px-2.5 text-[11px] font-bold disabled:opacity-50"
                        >
                          Restore
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink3">{archiveRows.length ? 'No archived sessions match that search.' : 'No archived sessions found.'}</p>
              )}
              {archivePages > 1 && (
                <div className="flex items-center gap-2 text-[11px]">
                  <button disabled={safeArchivePage === 0} onClick={()=> setArchivePage(p=> Math.max(0, p - 1))} className="min-h-8 rounded-lg border border-line px-2.5 disabled:opacity-40">Previous</button>
                  <span className="mx-auto text-ink3">Page {safeArchivePage + 1} of {archivePages}</span>
                  <button disabled={safeArchivePage >= archivePages - 1} onClick={()=> setArchivePage(p=> Math.min(archivePages - 1, p + 1))} className="min-h-8 rounded-lg border border-line px-2.5 disabled:opacity-40">Next</button>
                </div>
              )}
              <p className="text-[11px] text-ink3">Browsing is read-only. Restoring moves only the selected session back into live history; “Restore all” remains available above.</p>
            </div>
          )}
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
