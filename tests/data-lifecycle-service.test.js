import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDataLifecycleService } from '../src/services/dataLifecycleService.js';
import { createStorageDiagnosticsService } from '../src/services/storageDiagnosticsService.js';

describe('data lifecycle service', ()=>{
  it('erases device data after draining queued persistence, including telemetry and error stores', async ()=>{
    const calls = [];
    const service = createDataLifecycleService({
      awaitPersistence: async ()=> { calls.push('persisted'); },
      clearAll: async ()=> { calls.push('cleared'); },
      clearTelemetryEvents: ()=> { calls.push('telemetry'); },
      clearErrors: ()=> { calls.push('errors'); },
    });

    await service.eraseDeviceData();
    assert.deepEqual(calls, ['persisted', 'cleared', 'telemetry', 'errors']);
  });

  it('still erases device data when the prior persistence queue already failed', async ()=>{
    const calls = [];
    const service = createDataLifecycleService({
      awaitPersistence: async ()=> { calls.push('persist-failed'); throw new Error('quota'); },
      clearAll: async ()=> { calls.push('cleared'); },
      clearTelemetryEvents: ()=> { calls.push('telemetry'); },
      clearErrors: ()=> { calls.push('errors'); },
    });

    await service.eraseDeviceData();
    assert.deepEqual(calls, ['persist-failed', 'cleared', 'telemetry', 'errors']);
  });

  it('reports a failed wipe and never claims success', async ()=>{
    const calls = [];
    const service = createDataLifecycleService({
      awaitPersistence: async ()=> { calls.push('persisted'); },
      clearAll: async ()=> { calls.push('cleared'); throw new Error('could not verify wipe'); },
      clearTelemetryEvents: ()=> { calls.push('telemetry'); },
      clearErrors: ()=> { calls.push('errors'); },
    });

    await assert.rejects(()=> service.eraseDeviceData(), /could not verify wipe/);
    // local integration cleanup runs only after the durable wipe succeeded
    assert.deepEqual(calls, ['persisted', 'cleared']);
  });

  it('still reports success when local integration cleanup fails', async ()=>{
    const calls = [];
    const service = createDataLifecycleService({
      awaitPersistence: async ()=> {},
      clearAll: async ()=> { calls.push('cleared'); },
      clearTelemetryEvents: ()=> { throw new Error('telemetry store unavailable'); },
      clearErrors: ()=> { calls.push('errors'); },
    });

    await service.eraseDeviceData();
    assert.deepEqual(calls, ['cleared', 'errors']);
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
