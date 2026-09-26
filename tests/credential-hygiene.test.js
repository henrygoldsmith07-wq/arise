import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { saveAiSettings, clearAiSettings } from '../src/lib/aiCoach.js';
import { buildExportPayload } from '../src/lib/export.js';
import { buildSupportBundle } from '../src/lib/supportDiagnostics.js';

function memoryStorage(){
  const mem = {};
  return {
    mem,
    api: {
      getItem:k=> k in mem ? mem[k] : null,
      setItem:(k,v)=> { mem[k] = String(v); },
      removeItem:k=> { delete mem[k]; },
    },
  };
}

describe('credential hygiene', ()=>{
  it('keeps AI and WebDAV credentials out of exports and support diagnostics', async ()=>{
    const local = memoryStorage();
    const session = memoryStorage();
    globalThis.localStorage = local.api;
    globalThis.sessionStorage = session.api;
    const secret = 'nvapi-super-secret-test-value';
    try{
      saveAiSettings({ apiKey:secret, enabled:true, persistKey:true });
      const store = {
        version:13,
        history:[], readinessLog:[], customTemplates:[], eventHistory:[], evaluationLedger:[],
        preferences:{ syncEnabled:true, sync:{ url:'https://example.test/dav', username:'henry', password:'webdav-secret', passphrase:'backup-secret' } },
      };
      const backupText = JSON.stringify(buildExportPayload(store));
      const supportText = JSON.stringify(await buildSupportBundle({ store, appVersion:'test' }));
      for(const text of [backupText, supportText]){
        assert.equal(text.includes(secret), false);
        assert.equal(text.includes('webdav-secret'), false);
        assert.equal(text.includes('backup-secret'), false);
      }
    }finally{
      clearAiSettings();
      delete globalThis.localStorage;
      delete globalThis.sessionStorage;
    }
  });
});
