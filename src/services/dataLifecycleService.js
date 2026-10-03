// Device-data lifecycle boundary for UI surfaces such as More.
// Components ask for user-level operations; this service owns the persistence
// sequencing and browser-storage details.
//
// There is exactly one destructive user operation: eraseDeviceData — "Erase
// all Arise data from this device". Everything the app stores on this device
// (canonical IDB stores, legacy localStorage payloads, telemetry, error
// diagnostics, sync/consent/AI-keyside settings) is covered by it. The
// presentation layer shows a reviewable confirmation with current counts
// before calling this; the service never asks again — it performs the
// verified wipe and reports success or a precise failure.

import {
  clearAllStoredData,
  clearIntegrityNotice,
  getIntegrityNotice,
  whenPersisted,
} from '../lib/storage.js';
import { clearErrorEvents, clearTelemetry } from '../lib/telemetry.js';
import { requestPersistentStorage, storageHealth } from '../lib/storageQuota.js';

export function createDataLifecycleService({
  awaitPersistence = whenPersisted,
  clearAll = clearAllStoredData,
  clearTelemetryEvents = clearTelemetry,
  clearErrors = clearErrorEvents,
  readIntegrityNotice = getIntegrityNotice,
  dismissIntegrityNotice = clearIntegrityNotice,
  readStorageHealth = storageHealth,
  requestPersistence = requestPersistentStorage,
} = {}){
  return {
    // Already-confirmed destructive erase. The durable wipe (verified inside
    // clearAll, which throws if anything survives) is the source of truth;
    // telemetry/error clearing afterwards is belt-and-braces for the keys the
    // canonical wipe covers and the isolated error store it may not. A failed
    // persistence drain never blocks deletion; a failed wipe throws and the
    // caller keeps the current state so the user can export before retrying.
    async eraseDeviceData(){
      try{ await awaitPersistence(); }catch{}
      await clearAll();
      try{ clearTelemetryEvents(); }catch{}
      try{ clearErrors(); }catch{}
    },

    integrityNotice(){
      return readIntegrityNotice();
    },

    dismissIntegrityNotice(){
      dismissIntegrityNotice();
    },

    storageHealth(){
      return readStorageHealth();
    },

    async requestPersistentStorage(){
      const granted = await requestPersistence();
      return { granted, health: await readStorageHealth() };
    },
  };
}

export const dataLifecycleService = createDataLifecycleService();
