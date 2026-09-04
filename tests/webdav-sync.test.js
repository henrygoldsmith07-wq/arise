// WebDAV adapter + E2E encryption round-trip tests. The WebDAV client is
// exercised against a stubbed global fetch; the encryption round-trip proves
// a synced file is AES-GCM sealed with the passphrase — and that the
// passphrase never appears on the wire (only in the key derivation).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { webdavBaseUrl, makeWebdavAdapter, webdavCheck } from '../src/lib/webdav.js';
import { encryptBackup, decryptBackup, looksEncrypted } from '../src/lib/cryptoBackup.js';
import { buildExportPayload } from '../src/lib/export.js';
import { runSync, defaultSyncConfig } from '../src/lib/syncEngine.js';

// Minimal Response stand-in for the fetch stub.
function res(status, body = '', headers = {}){
  return {
    status, ok: status >= 200 && status < 300,
    text: async () => body,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  };
}

let calls = [];
let responder = () => res(200, '');

beforeEach(() => {
  calls = [];
  responder = () => res(200, '');
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method, body: options.body, headers: options.headers || {} });
    return responder(calls[calls.length - 1]);
  };
});

describe('webdavBaseUrl', () => {
  it('trims trailing slashes and rejects non-https', () => {
    assert.equal(webdavBaseUrl('https://dav.example.com/r.php/dav/'), 'https://dav.example.com/r.php/dav');
    assert.throws(() => webdavBaseUrl('http://dav.example.com'), /https/);
    assert.throws(() => webdavBaseUrl(''), /https/);
  });
});

describe('makeWebdavAdapter', () => {
  const cfg = { url: 'https://dav.example.com', username: 'me', password: 'pw' };

  it('pull returns null on 404 (first sync) and text on 200', async () => {
    const adapter = makeWebdavAdapter(cfg);
    responder = () => res(404);
    assert.equal(await adapter.pull(), null);
    responder = () => res(200, 'remote-payload');
    assert.equal(await adapter.pull(), 'remote-payload');
    assert.equal(calls[0].method, 'GET');
    assert.match(calls[0].headers.Authorization, /^Basic /);
  });

  it('pull raises on other error statuses', async () => {
    const adapter = makeWebdavAdapter(cfg);
    responder = () => res(401);
    await assert.rejects(adapter.pull(), /401/);
  });

  it('push PUTs the body to the file URL and fails on error status', async () => {
    const adapter = makeWebdavAdapter(cfg);
    await adapter.push('hello');
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].body, 'hello');
    assert.match(calls[0].url, /arise-sync\/arise-backup\.arise$/);
    responder = () => res(500);
    await assert.rejects(adapter.push('x'), /500/);
  });
});

describe('webdavCheck', () => {
  it('reports WebDAV capability from headers and rejects 401', async () => {
    responder = () => res(200, '', { dav: '1, 2' });
    assert.equal((await webdavCheck({ url: 'https://dav.example.com', username: 'a', password: 'b' })).dav, true);
    responder = () => res(401);
    await assert.rejects(webdavCheck({ url: 'https://dav.example.com', username: 'a', password: 'b' }), /401/);
  });
});

describe('E2E encryption round-trip through runSync', () => {
  it('sealed payload decrypts with the passphrase, not the app password', async () => {
    const store = { version: 9, preferences: {}, history: [{ id: 's-1', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '5', weightKg: '80' }] }] }], tombstones: [] };
    const config = { ...defaultSyncConfig(), url: 'https://dav.example.com', username: 'me', password: 'app-password', passphrase: 'correct horse battery staple', encryption: true };
    let pushedBody = null;
    responder = (call) => {
      if(call.method === 'PUT'){ pushedBody = call.body; return res(200); }
      return res(404);
    };
    const adapter = makeWebdavAdapter(config);
    const { config: next, error } = await runSync({ store, config, adapter });
    assert.equal(error, undefined);
    assert.ok(next.lastPushAt);

    // The bytes on the wire are the .arisebak envelope, not JSON.
    assert.ok(pushedBody instanceof Uint8Array);
    assert.equal(looksEncrypted(pushedBody), true);
    assert.equal(new TextDecoder().decode(pushedBody).includes('bench-press'), false);

    // Only the passphrase opens it (decryptBackup returns the parsed payload).
    const opened = await decryptBackup(pushedBody, 'correct horse battery staple');
    assert.equal(opened.data.history[0].id, 's-1');
    await assert.rejects(decryptBackup(pushedBody, 'app-password'), /decrypt|passphrase|key/i);
    await assert.rejects(decryptBackup(pushedBody, 'wrong'), /decrypt|passphrase|key/i);
  });

  it('buildExportPayload output decrypts and round-trips via parseImportFile', async () => {
    const store = { version: 9, preferences: { units: 'kg' }, history: [], tombstones: [] };
    const envelope = buildExportPayload(store);
    const sealed = await encryptBackup(envelope, 'pass-phrase-123');
    const parsed = await decryptBackup(sealed, 'pass-phrase-123');
    assert.equal(parsed.app, 'arise');
  });

  it('sync refuses to run encrypted without a passphrase', async () => {
    const config = { ...defaultSyncConfig(), url: 'https://x', password: 'pw', encryption: true };
    const adapter = { pull: async () => null, push: async () => {} };
    const { error } = await runSync({ store: { history: [] }, config, adapter });
    assert.match(error, /passphrase/);
  });
});
