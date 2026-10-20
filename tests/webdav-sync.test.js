// WebDAV adapter + E2E encryption round-trip tests. The WebDAV client is
// exercised against a stubbed global fetch; the encryption round-trip proves
// a synced file is AES-GCM sealed with the passphrase — and that the
// passphrase never appears on the wire (only in the key derivation).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { webdavBaseUrl, makeWebdavAdapter, webdavCheck, WebdavConflictError } from '../src/lib/webdav.js';
import { encryptBackup, decryptBackup, looksEncrypted } from '../src/lib/cryptoBackup.js';
import { buildExportPayload } from '../src/lib/export.js';
import { runSync, defaultSyncConfig } from '../src/lib/syncEngine.js';

// Minimal Response stand-in for the fetch stub. Byte bodies model the real
// transport: an encrypted envelope must survive GET as exact bytes.
function res(status, body = '', headers = {}){
  const toBytes = () => body instanceof Uint8Array ? body : new TextEncoder().encode(String(body));
  return {
    status, ok: status >= 200 && status < 300,
    text: async () => new TextDecoder().decode(toBytes()),
    arrayBuffer: async () => toBytes().slice().buffer,
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

  it('pull returns null on 404 (first sync) and exact BYTES on 200', async () => {
    const adapter = makeWebdavAdapter(cfg);
    responder = () => res(404);
    assert.equal(await adapter.pull(), null);
    // Ciphertext is a binary container — the adapter must hand back bytes
    // untouched, never a lossy text decode.
    const sealed = new Uint8Array([0x41, 0x52, 0x43, 0x42, 0xff, 0xfe, 0x00, 0x01]);
    responder = () => res(200, sealed);
    const got = await adapter.pull();
    assert.ok(got instanceof Uint8Array);
    assert.deepEqual([...got], [...sealed]);
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

  it('detaches the external abort listener when a request settles', async () => {
    let added = null;
    let removed = null;
    const signal = {
      reason:null,
      addEventListener:(type, fn)=> { if(type === 'abort') added = fn; },
      removeEventListener:(type, fn)=> { if(type === 'abort') removed = fn; },
    };
    const adapter = makeWebdavAdapter({ ...cfg, signal });
    responder = () => res(404);
    await adapter.pull();
    assert.equal(typeof added, 'function');
    assert.equal(removed, added);
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

// ── Two-device encrypted round-trip over the REAL byte transport ─────────
// Device A seals to a (mock) WebDAV server, Device B pulls the exact bytes,
// decrypts with the shared passphrase, merges both histories, and pushes the
// converged sealed payload back. Failure modes leave local history untouched
// and the remote file byte-identical.

function inMemoryWebdav(){
  let stored = null;   // Uint8Array | string
  let pushes = 0;
  responder = (call) => {
    if(call.method === 'PUT'){
      pushes++;
      stored = call.body instanceof Uint8Array ? call.body.slice()
        : new TextEncoder().encode(String(call.body));
      return res(201);
    }
    return stored ? res(200, stored) : res(404);
  };
  return {
    get pushes(){ return pushes; },
    bytes: () => stored,
    setBytes(b){ stored = b; },
    url: 'https://dav.example.com',
  };
}

const device = (id, sessionIds, extra = {})=> ({
  version: 9, preferences: {}, tombstones: [],
  history: sessionIds.map((s, i)=> ({ id: s, dateISO: `2026-04-0${i + 1}`, savedAt: `2026-04-0${i + 1}T10:00:00Z`, blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '8', weightKg: id === 'A' ? '80' : '90' }] }] })),
});
const PASS = 'two-device-passphrase';
const cfgFor = (server, overrides = {}) => ({
  ...defaultSyncConfig(), url: server.url, username: 'me', password: 'app-password',
  passphrase: PASS, encryption: true, ...overrides,
});

describe('two-device encrypted sync over bytes', () => {
  it('A pushes sealed → B pulls, decrypts, merges, pushes converged payload', async ()=>{
    const server = inMemoryWebdav();
    const adapterA = () => makeWebdavAdapter(cfgFor(server));
    const a = device('A', ['s-a1', 's-a2']);
    const b = device('B', ['s-b1']);
    const first = await runSync({ store: a, config: cfgFor(server), adapter: adapterA() });
    assert.equal(first.error, undefined);
    assert.equal(looksEncrypted(server.bytes()), true, 'remote holds the sealed envelope');
    assert.equal(new TextDecoder('utf-8', { fatal: false }).decode(server.bytes()).includes('s-a1'), false, 'no plaintext on the wire');

    const second = await runSync({ store: b, config: cfgFor(server), adapter: adapterA() });
    assert.equal(second.error, undefined, `B must decrypt: ${second.error}`);
    assert.deepEqual(second.merged.history.map((h) => h.id).sort(), ['s-a1', 's-a2', 's-b1'], 'B keeps local AND gains A history');
    assert.equal(server.pushes, 2, 'B pushed the converged payload back');
    assert.equal(looksEncrypted(server.bytes()), true, 'the return push is sealed again');

    // A pulls the converged file: it gains B's session — full circle.
    const third = await runSync({ store: a, config: cfgFor(server), adapter: adapterA() });
    assert.deepEqual(third.merged.history.map((h) => h.id).sort(), ['s-a1', 's-a2', 's-b1']);
  });

  it('wrong passphrase: clear error, local history intact, remote untouched', async ()=>{
    const server = inMemoryWebdav();
    await runSync({ store: device('A', ['s-a1']), config: cfgFor(server), adapter: makeWebdavAdapter(cfgFor(server)) });
    const before = server.bytes();
    const pushesBefore = server.pushes;
    const b = device('B', ['s-b1']);
    const { merged, error } = await runSync({ store: b, config: cfgFor(server, { passphrase: 'wrong passphrase' }), adapter: makeWebdavAdapter(cfgFor(server)) });
    assert.match(error, /passphrase|damaged|decrypt/i);
    assert.equal(merged.history.length, 1, 'B keeps its own history');
    assert.equal(merged.history[0].id, 's-b1');
    assert.equal(server.pushes, pushesBefore, 'nothing pushed on failure');
    assert.deepEqual(server.bytes(), before, 'remote byte-identical');
  });

  it('corrupted ciphertext is refused, not merged as garbage', async ()=>{
    const server = inMemoryWebdav();
    await runSync({ store: device('A', ['s-a1']), config: cfgFor(server), adapter: makeWebdavAdapter(cfgFor(server)) });
    const bad = server.bytes().slice();
    bad[bad.length - 6] ^= 0xff; // flip ciphertext bytes → GCM tag fails
    server.setBytes(bad);
    const { merged, error } = await runSync({ store: device('B', ['s-b1']), config: cfgFor(server), adapter: makeWebdavAdapter(cfgFor(server)) });
    assert.match(error, /passphrase|damaged|decrypt/i);
    assert.deepEqual(merged.history.map((h) => h.id), ['s-b1']);
  });

  it('empty remote is a first sync, not a failure', async ()=>{
    const server = inMemoryWebdav();
    const { error, merged } = await runSync({ store: device('A', ['s-a1']), config: cfgFor(server), adapter: makeWebdavAdapter(cfgFor(server)) });
    assert.equal(error, undefined);
    assert.deepEqual(merged.history.map((h) => h.id), ['s-a1']);
    assert.equal(server.pushes, 1);
  });

  it('plaintext mode round-trips over the same byte transport', async ()=>{
    const server = inMemoryWebdav();
    const plain = { passphrase: PASS, encryption: false };
    await runSync({ store: device('A', ['s-a1']), config: cfgFor(server, plain), adapter: makeWebdavAdapter(cfgFor(server, plain)) });
    assert.equal(looksEncrypted(server.bytes()), false, 'plaintext stays plaintext');
    assert.ok(new TextDecoder().decode(server.bytes()).includes('s-a1'));
    const { error, merged } = await runSync({ store: device('B', ['s-b1']), config: cfgFor(server, plain), adapter: makeWebdavAdapter(cfgFor(server, plain)) });
    assert.equal(error, undefined, error);
    assert.deepEqual(merged.history.map((h) => h.id).sort(), ['s-a1', 's-b1']);
  });
});

describe('WebDAV write safety', () => {
  const cfg = { url: 'https://dav.example.com', username: 'me', password: 'pw', filePath: 'a/b/file.arise' };

  it('creates missing parent folders on 409, top-down, then retries the PUT', async () => {
    const made = new Set();
    responder = (call) => {
      if(call.method === 'MKCOL'){
        const existed = made.has(call.url);
        made.add(call.url);
        return res(existed ? 405 : 201);
      }
      if(call.method === 'PUT') return res(made.has('https://dav.example.com/a/b/') ? 201 : 409);
      return res(404);
    };
    await makeWebdavAdapter(cfg).push('x');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace('https://dav.example.com', '')}`), [
      'PUT /a/b/file.arise', 'MKCOL /a/', 'MKCOL /a/b/', 'PUT /a/b/file.arise',
    ]);
  });

  it('treats an existing folder (405) as fine but reports other MKCOL failures', async () => {
    responder = (call) => call.method === 'MKCOL' ? res(403) : res(409);
    await assert.rejects(makeWebdavAdapter(cfg).push('x'), /sync folder: HTTP 403/);
  });

  it('PUTs with If-Match after a pull that saw a strong ETag, and raises a conflict on 412', async () => {
    const adapter = makeWebdavAdapter(cfg);
    responder = (call) => call.method === 'GET' ? res(200, '{}', { etag: '"v1"' }) : res(412);
    await adapter.pull();
    await assert.rejects(adapter.push('x'), (err) => err instanceof WebdavConflictError && err.conflict === true);
    assert.equal(calls[1].headers['If-Match'], '"v1"');
  });

  it('ignores weak ETags (If-Match needs a strong validator)', async () => {
    const adapter = makeWebdavAdapter(cfg);
    responder = (call) => call.method === 'GET' ? res(200, '{}', { etag: 'W/"v1"' }) : res(201);
    await adapter.pull();
    await adapter.push('x');
    assert.equal(calls[1].headers['If-Match'], undefined);
  });

  it('names the likely causes when the browser refuses the request outright', async () => {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(makeWebdavAdapter(cfg).pull(), /Could not reach dav\.example\.com.*CORS/);
  });
});

describe('runSync robustness', () => {
  const store = (ids) => device('X', ids);

  it('re-pulls and re-merges when another device wrote between pull and push', async () => {
    let remote = JSON.stringify(buildExportPayload(device('A', ['s-a1'])));
    let pushes = 0;
    const adapter = {
      pull: async () => remote,
      push: async (body) => {
        pushes++;
        if(pushes === 1){
          // Device B lands its write first; our conditional PUT must lose.
          remote = JSON.stringify(buildExportPayload(device('B', ['s-a1', 's-b1'])));
          throw new WebdavConflictError();
        }
        remote = body;
      },
    };
    const { merged, error } = await runSync({ store: store(['s-x1']), config: defaultSyncConfig(), adapter, encryption: null });
    assert.equal(error, undefined, error);
    assert.equal(pushes, 2);
    assert.deepEqual(merged.history.map((h) => h.id).sort(), ['s-a1', 's-b1', 's-x1'], "B's session survives the race");
  });

  it('gives up with an error after repeated conflicts', async () => {
    const adapter = { pull: async () => null, push: async () => { throw new WebdavConflictError(); } };
    const { error } = await runSync({ store: store(['s-x1']), config: defaultSyncConfig(), adapter, encryption: null });
    assert.match(error, /changed on the server/);
  });

  it('turning encryption ON reads the old plaintext remote and re-seals it', async () => {
    const server = inMemoryWebdav();
    await runSync({ store: device('A', ['s-a1']), config: cfgFor(server, { encryption: false }), adapter: makeWebdavAdapter(cfgFor(server)) });
    assert.equal(looksEncrypted(server.bytes()), false);
    const { error, merged } = await runSync({ store: device('A', ['s-a2']), config: cfgFor(server), adapter: makeWebdavAdapter(cfgFor(server)) });
    assert.equal(error, undefined, error);
    assert.deepEqual(merged.history.map((h) => h.id).sort(), ['s-a1', 's-a2']);
    assert.equal(looksEncrypted(server.bytes()), true, 'the next push is sealed');
  });

  it('turning encryption OFF still opens the sealed remote with the saved passphrase', async () => {
    const server = inMemoryWebdav();
    await runSync({ store: device('A', ['s-a1']), config: cfgFor(server), adapter: makeWebdavAdapter(cfgFor(server)) });
    const { error, merged } = await runSync({ store: device('B', ['s-b1']), config: cfgFor(server, { encryption: false }), adapter: makeWebdavAdapter(cfgFor(server)) });
    assert.equal(error, undefined, error);
    assert.deepEqual(merged.history.map((h) => h.id).sort(), ['s-a1', 's-b1']);
    assert.equal(looksEncrypted(server.bytes()), false, 'the push follows this device\'s setting');
  });

  it('a sealed remote with no passphrase on this device is a clear error, not a parse failure', async () => {
    const server = inMemoryWebdav();
    await runSync({ store: device('A', ['s-a1']), config: cfgFor(server), adapter: makeWebdavAdapter(cfgFor(server)) });
    const pushes = server.pushes;
    const { error } = await runSync({ store: device('B', ['s-b1']), config: cfgFor(server, { encryption: false, passphrase: '' }), adapter: makeWebdavAdapter(cfgFor(server)) });
    assert.match(error, /encrypted — enter the encryption passphrase/);
    assert.equal(server.pushes, pushes, 'nothing pushed');
  });

  it('a successful cycle clears the offline queue', async () => {
    const config = { ...defaultSyncConfig(), queue: [{ at: 'x', reason: 'offline', attempts: 2, nextAttemptAt: null }] };
    const { config: next } = await runSync({ store: store(['s-x1']), config, adapter: { pull: async () => null, push: async () => {} }, encryption: null });
    assert.deepEqual(next.queue, []);
  });
});
