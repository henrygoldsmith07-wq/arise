// Storage-diagnostics application boundary. The diagnostics UI deliberately
// reads persisted state rather than the React snapshot, but components should
// not know which IndexedDB helpers implement those operations.

import { archiveCandidateCount, archiveOldSessions, archivedSessionCount, pruneEvents, restoreArchive } from '../lib/archive.js';
import { auditStore, repairFindings } from '../lib/audit.js';
import { listMigrationLogs } from '../lib/migrationLog.js';
import { whenPersisted } from '../lib/storage.js';

async function snapshotApi(){
  return import('../lib/snapshots.js');
}

export function createStorageDiagnosticsService({
  audit = auditStore,
  repair = repairFindings,
  countArchiveCandidates = archiveCandidateCount,
  countArchived = archivedSessionCount,
  archive = archiveOldSessions,
  prune = pruneEvents,
  restore = restoreArchive,
  snapshots = async ()=> (await snapshotApi()).listSnapshots(),
  capture = async (options)=> (await snapshotApi()).captureSnapshot(options),
  rollback = async (id)=> (await snapshotApi()).rollbackToSnapshot(id),
  migrationLogs = listMigrationLogs,
  awaitPersistence = whenPersisted,
} = {}){
  const afterWrite = async (operation)=>{
    const result = await operation();
    await awaitPersistence();
    return result;
  };

  return {
    async inspect({ olderThanDays = 365 } = {}){
      const [auditResult, archiveCandidates, archived, snapshotRows, logs, prunePreview] = await Promise.all([
        audit(),
        countArchiveCandidates(olderThanDays),
        countArchived(),
        snapshots(),
        migrationLogs(),
        prune({ dryRun: true }),
      ]);
      return {
        audit: auditResult,
        archiveCandidates,
        archived,
        snapshots: snapshotRows,
        migrationLogs: logs,
        prunePreview,
      };
    },

    repair(findings){ return afterWrite(()=> repair(findings)); },
    archiveOld(olderThanDays = 365){ return afterWrite(()=> archive(olderThanDays)); },
    pruneEvents(options = {}){ return afterWrite(()=> prune(options)); },
    captureSnapshot(options = {}){ return afterWrite(()=> capture(options)); },
    rollbackToSnapshot(id){ return afterWrite(()=> rollback(id)); },
    restoreArchive(){ return afterWrite(()=> restore()); },
  };
}

export const storageDiagnosticsService = createStorageDiagnosticsService();
