import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDataLifecycleService } from '../src/services/dataLifecycleService.js';
import { createStorageDiagnosticsService } from '../src/services/storageDiagnosticsService.js';

describe('data lifecycle service', ()=>{
  it('waits for queued persistence before clearing canonical device data', async ()=>{
    const calls = [];
    const service = createDataLifecycleService({
      awaitPersistence: async ()=> { calls.push('persisted'); },
      clearAll: async ()=> { calls.push('cleared'); },
    });

    await service.clearDeviceData();
    assert.deepEqual(calls, ['persisted', 'cleared']);
  });

  it('owns integrity notice and persistent-storage browser operations', async ()=>{
    let notice = { errors:['bad row'] };
    const service = createDataLifecycleService({
      readIntegrityNotice: ()=> notice,
      dismissIntegrityNotice: ()=> { notice = null; },
      requestPersistence: async ()=> true,
      readStorageHealth: async ()=> ({ persisted:true, level:'ok' }),
    });

    assert.deepEqual(service.integrityNotice(), { errors:['bad row'] });
    service.dismissIntegrityNotice();
    assert.equal(service.integrityNotice(), null);
    assert.deepEqual(await service.requestPersistentStorage(), {
      granted:true,
      health:{ persisted:true, level:'ok' },
    });
  });
});

describe('storage diagnostics service', ()=>{
  it('builds one persisted-state inspection snapshot', async ()=>{
    const pruneCalls = [];
    const service = createStorageDiagnosticsService({
      audit: async ()=> ({ findings:[] }),
      countArchiveCandidates: async (days)=> days === 365 ? 2 : 0,
      countArchived: async ()=> 3,
      snapshots: async ()=> [{ id:'snap-1' }],
      migrationLogs: async ()=> [{ id:'migration-1' }],
      prune: async (options)=> { pruneCalls.push(options); return { pruned:4, dryRun:options?.dryRun === true }; },
    });

    const result = await service.inspect({ olderThanDays:365 });
    assert.deepEqual(result, {
      audit:{ findings:[] },
      archiveCandidates:2,
      archived:3,
      snapshots:[{ id:'snap-1' }],
      migrationLogs:[{ id:'migration-1' }],
      prunePreview:{ pruned:4, dryRun:true },
    });
    assert.deepEqual(pruneCalls, [{ dryRun:true }]);
  });

  it('awaits persistence after destructive maintenance operations', async ()=>{
    const calls = [];
    const service = createStorageDiagnosticsService({
      repair: async ()=> { calls.push('repair'); return { ok:true }; },
      awaitPersistence: async ()=> { calls.push('persisted'); },
    });

    assert.deepEqual(await service.repair([{ type:'orphaned-set' }]), { ok:true });
    assert.deepEqual(calls, ['repair', 'persisted']);
  });
});
