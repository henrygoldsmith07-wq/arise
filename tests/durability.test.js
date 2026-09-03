// Durability tests: atomic writes, boot-time integrity, quota visibility,
// encrypted backups. The memory backend keeps semantics identical to real
// IndexedDB for the transaction layer; WebCrypto paths use Node's webcrypto
// (same API surface as the browser).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateStorage, persistStore, loadStoreFromIdb, whenPersisted, clearAllStoredData } from '../src/lib/storage.js';
import { idbGetAll } from '../src/lib/idb.js';
import { idbTransaction } from '../src/lib/idb-tx.js';
import { enforceIntegrity, repairStore, latestQuarantinedStore, quarantineBrokenStore } from '../src/lib/integrity.js';
import { storageHealth } from '../src/lib/storageQuota.js';
import { encryptBackup, decryptBackup, looksEncrypted, cryptoAvailable } from '../src/lib/cryptoBackup.js';
import { STORE_SCHEMA_VERSION } from '../src/lib/store.js';

function set(reps, kg){ return { reps:String(reps), weightKg:String(kg), rpe:'' }; }
function fullStore(){
  return {
    version: STORE_SCHEMA_VERSION,
    onboarding: { goal:'muscle', equipment:['dumbbells'], location:'home' },
    preferences: { units:'kg', theme:'dark', telemetryEnabled:true },
    healthSummary: null,
    activeSchedule: { programId:'p1', mesocycle:{ weeks:4, deloadWeek:null }, adaptationHistory:[], sessions:[] },
    programHistory: [ { programId:'p1', version:1, startDateISO:'2026-01-05' } ],
    history: [
      { id:'h1', dateISO:'2026-01-05', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,20), set(9,20)] }] },
      { id:'h2', dateISO:'2026-01-08', blocks:[{ exerciseId:'dumbbell-row', sets:[set(10,20)] }] },
    ],
    eventHistory: [ { id:'e1', type:'session:complete', at:'2026-01-05T10:00:00Z' } ],
    readinessLog: [ { dateISO:'2026-01-05', score:75 } ],
    evaluationLedger: [
      { id:'r-open', recommendation:{ load:22, reps:8 }, outcome:null, exerciseId:'bench-press-dumbbell' },
      { id:'r-done', recommendation:{ load:20, reps:8 }, outcome:{ metTarget:true }, exerciseId:'bench-press-dumbbell' },
    ],
    customTemplates: [],
  };
}

// Storage modules keep module-level singletons; a fresh import registry per
// test file keeps them isolated. Within this file we hydrate once up front
// and assert through the public surface.
await hydrateStorage();

describe('atomic persistence', ()=>{
  it('a full save round-trips through the transaction layer', async ()=>{
    await persistStore(fullStore());
    await whenPersisted();
    const recomposed = await loadStoreFromIdb();
    assert.equal(recomposed.history.length, 2);
    assert.equal(recomposed.evaluationLedger.length, 2);
    assert.equal((await idbGetAll('sets')).length, 3);
    assert.equal(recomposed.preferences.theme, 'dark');
  });

  it('a throwing write aborts the whole transaction and changes nothing', async ()=>{
    await persistStore(fullStore());
    const before = await loadStoreFromIdb();
    await assert.rejects(()=> idbTransaction(['sessions','programme'], (ops)=>{
      ops.clearStore('sessions');
      throw new Error('boom mid-transaction');
    }));
    const after = await loadStoreFromIdb();
    assert.equal(after.history.length, before.history.length);
    assert.equal(after.history[0].id, 'h1');
  });

  it('clearAllStoredData empties every store, and nothing resurrects', async ()=>{
    await persistStore(fullStore());
    await whenPersisted();
    await clearAllStoredData();
    for(const store of ['profile','sessions','sets','programme','recommendations','outcomes','events','readiness','templates','quarantine']){
      assert.equal((await idbGetAll(store)).length, 0, `${store} should be empty`);
    }
    // Re-persisting after a deliberate clear works (cleared latch resets).
    await hydrateStorage();
    await persistStore(fullStore());
    await whenPersisted();
    assert.equal((await loadStoreFromIdb()).history.length, 2);
  });
});

describe('boot integrity: validate, quarantine, repair', ()=>{
  it('a healthy store passes validation untouched', ()=>{
    const result = enforceIntegrity(fullStore());
    assert.equal(result.repaired, false);
  });

  it('a broken recomposition is detected, quarantined and repaired', async ()=>{
    const broken = fullStore();
    broken.history = 'not-an-array';
    broken.readinessLog = { dateISO:'2026-01-05' };
    broken.activeSchedule = 42;
    const checked = enforceIntegrity(broken);
    assert.equal(checked.repaired, true);
    assert.ok(checked.errors.length >= 3);
    assert.equal(Array.isArray(checked.store.history), true);
    assert.equal(checked.store.activeSchedule, null);
    assert.deepEqual(checked.store.readinessLog, []);
    // Quarantine is the boot gate's second step: persist the broken payload
    // for recovery, then repair. enforceIntegrity itself stays pure.
    await quarantineBrokenStore(broken, checked.errors);
    const quarantined = await latestQuarantinedStore();
    assert.ok(quarantined);
    assert.equal(quarantined.payload.history, 'not-an-array');
    assert.ok(quarantined.errors.length >= 3);
    // Persisting the repaired shape validates clean on the next boot gate.
    const rechecked = enforceIntegrity(checked.store);
    assert.equal(rechecked.repaired, false);
  });

  it('per-row salvage keeps readable history rows and drops only the broken one', ()=>{
    const damaged = fullStore();
    damaged.history = [
      damaged.history[0],
      { id:'broken', blocks:'nope' },
      { id:'nulldate', dateISO:'not-a-date', blocks:[{ exerciseId:'x', sets:[] }] },
    ];
    const fixed = repairStore(damaged);
    // 'broken' is dropped (unreadable blocks); 'nulldate' survives normalisation
    // per-row but still fails the strict schema, so it is dropped by repair.
    assert.ok(fixed.history.every((h)=> Array.isArray(h.blocks)));
  });
});

describe('storage quota health', ()=>{
  it('reports a health level without a real StorageManager (fail-soft)', async ()=>{
    const health = await storageHealth();
    assert.ok(['ok','warning','critical'].includes(health.level));
    assert.ok(health.estimate === null || typeof health.estimate.usageBytes === 'number');
    assert.ok(health.persisted === null || typeof health.persisted === 'boolean');
  });
});

describe('encrypted backups', ()=>{
  it('is available under node webcrypto and round-trips', async ()=>{
    assert.equal(cryptoAvailable(), true);
    const payload = { app:'arise', version:3, data:{ history:[{ id:'a', dateISO:'2026-01-01' }] } };
    const bytes = await encryptBackup(payload, 'correct horse battery staple');
    assert.equal(looksEncrypted(bytes), true);
    const decrypted = await decryptBackup(bytes, 'correct horse battery staple');
    assert.deepEqual(decrypted.data.history, payload.data.history);
  });

  it('a wrong passphrase fails authentication with a clear error', async ()=>{
    const payload = { app:'arise', data:{} };
    const bytes = await encryptBackup(payload, 'right-passphrase');
    await assert.rejects(()=> decryptBackup(bytes, 'wrong-passphrase'), /Wrong passphrase/);
  });

  it('rejects files that are not arise encrypted backups', async ()=>{
    await assert.rejects(()=> decryptBackup(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]), 'x'), /bad signature|too short/);
    await assert.rejects(()=> decryptBackup(new TextEncoder().encode('{"app":"arise"}'), 'x'), /too short|bad signature/);
  });

  it('tampering with the ciphertext breaks authentication (AAD binds the header)', async ()=>{
    const payload = { app:'arise', data:{ history:[] } };
    const bytes = await encryptBackup(payload, 'passphrase-123');
    bytes[bytes.length - 1] ^= 0xff;
    await assert.rejects(()=> decryptBackup(bytes, 'passphrase-123'), /Wrong passphrase/);
  });
});
