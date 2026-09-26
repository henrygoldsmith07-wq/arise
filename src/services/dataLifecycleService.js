// Device-data lifecycle boundary for UI surfaces such as More.
// Components ask for user-level operations; this service owns the persistence
// sequencing and browser-storage details.

import {
  clearAllStoredData,
  clearIntegrityNotice,
  getIntegrityNotice,
  whenPersisted,
} from '../lib/storage.js';
import { requestPersistentStorage, storageHealth } from '../lib/storageQuota.js';

export function createDataLifecycleService({
  awaitPersistence = whenPersisted,
  clearAll = clearAllStoredData,
  readIntegrityNotice = getIntegrityNotice,
  dismissIntegrityNotice = clearIntegrityNotice,
  readStorageHealth = storageHealth,
  requestPersistence = requestPersistentStorage,
} = {}){
  return {
    async clearDeviceData(){
      await awaitPersistence();
      await clearAll();
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
