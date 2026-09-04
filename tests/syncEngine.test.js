// Sync engine tests: config normalisation, credential sanitisation, offline
// queue with backoff, and the pull→merge→push cycle (plain + end-to-end
// encrypted). Merge semantics themselves are covered elsewhere — these cover
// the runtime that drives them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultSyncConfig, normalizeSyncConfig, sanitizeSyncConfig,
  pushLog, enqueueOffline, drainQueue, backoffDelayMs,
  runSync, syncStatusLabel, SYNC_QUEUE_LIMIT, SYNC_LOG_LIMIT, MAX_BACKOFF_MS,
} from '../src/lib/syncEngine.js';
import { buildExportPayload, parseImportFile } from '../src/lib/export.js';

function fakeStore(overrides = {}){
  return {
    version: 9,
    preferences: { units: 'kg' },
    history: [{ id: 's-1', dateISO: '2026-01-01', savedAt: '2026-01-01T10:00:00Z', blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '5', weightKg: '80' }] }] }],
    tombstones: [],
    ...overrides,
  };
}

describe('sync config', () => {
  it('defaults are privacy-first: no url, no password, encryption on', () => {
    const cfg = defaultSyncConfig();
    assert.equal(cfg.url, '');
    assert.equal(cfg.password, '');
    assert.equal(cfg.encryption, true);
    assert.deepEqual(cfg.queue, []);
    assert.deepEqual(cfg.logs, []);
  });

  it('normalizeSyncConfig keeps persisted fields and caps queue/log growth', () => {
    const raw = {
      ...defaultSyncConfig(),
      url: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
      queue: Array.from({ length: SYNC_QUEUE_LIMIT + 10 }, () => ({ at: 'x', reason: 'r', attempts: 0, nextAttemptAt: null })),
      logs: Array.from({ length: SYNC_LOG_LIMIT + 10 }, () => ({ at: 'x', kind: 'k' })),
    };
    const cfg = normalizeSyncConfig(raw);
    assert.equal(cfg.url, 'https://dav.example.com');
    assert.equal(cfg.queue.length, SYNC_QUEUE_LIMIT);
    assert.equal(cfg.logs.length, SYNC_LOG_LIMIT);
  });

  it('sanitizeSyncConfig never exposes the password, states that it is set', () => {
    const cfg = normalizeSyncConfig({ password: 'secret', username: 'me' });
    const view = sanitizeSyncConfig(cfg);
    assert.equal('password' in view, false);
    assert.equal(view.passwordSet, true);
    assert.equal(view.username, 'me');
  });

  it('pushLog caps at the log limit', () => {
    let logs = [];
    for(let i = 0; i < SYNC_LOG_LIMIT + 5; i++) logs = pushLog(logs, { kind: 'k' + i });
    assert.equal(logs.length, SYNC_LOG_LIMIT);
    assert.equal(logs.at(-1).kind, 'k' + (SYNC_LOG_LIMIT + 4));
  });
});

describe('offline queue + backoff', () => {
  it('backoff doubles and caps at MAX_BACKOFF_MS', () => {
    assert.equal(backoffDelayMs(0), 1000);
    assert.equal(backoffDelayMs(1), 2000);
    assert.equal(backoffDelayMs(2), 4000);
    assert.equal(backoffDelayMs(20), MAX_BACKOFF_MS);
  });

  it('enqueueOffline appends with the reason and caps the queue', () => {
    let cfg = defaultSyncConfig();
    for(let i = 0; i < SYNC_QUEUE_LIMIT + 3; i++) cfg = enqueueOffline(cfg, 'offline');
    assert.equal(cfg.queue.length, SYNC_QUEUE_LIMIT);
    assert.equal(cfg.queue[0].reason, 'offline');
  });

  it('drainQueue removes succeeded items and schedules failed ones with backoff', async () => {
    const cfg = enqueueOffline(enqueueOffline(defaultSyncConfig(), 'a'), 'b');
    const calls = [];
    const next = await drainQueue(cfg, async (item) => {
      calls.push(item.reason);
      if(item.reason === 'b') throw new Error('network down');
    });
    assert.deepEqual(calls.sort(), ['a', 'b']);
    assert.equal(next.queue.length, 1);
    assert.equal(next.queue[0].reason, 'b');
    assert.equal(next.queue[0].attempts, 1);
    assert.ok(next.queue[0].nextAttemptAt);
    assert.equal(next.lastError, 'network down');
    // and a later drain honours nextAttemptAt (not due yet)
    const again = await drainQueue(next, async () => { throw new Error('should not run'); });
    assert.equal(again.queue.length, 1);
  });

  it('drainQueue on an empty queue is a no-op', async () => {
    const cfg = await drainQueue(defaultSyncConfig(), async () => { throw new Error('nope'); });
    assert.equal(cfg.queue.length, 0);
  });
});

describe('runSync cycle', () => {
  it('pushes the merged payload and stamps the config', async () => {
    const local = fakeStore();
    let pushed = null;
    const adapter = {
      pull: async () => null, // first sync: no remote
      push: async (text) => { pushed = JSON.parse(text); },
    };
    const { merged, config, error } = await runSync({ store: local, config: defaultSyncConfig(), adapter, encryption: null });
    assert.equal(error, undefined);
    assert.equal(pushed.data.history.length, 1);
    assert.ok(config.lastPushAt);
    assert.equal(config.lastError, null);
    assert.equal(merged, local); // no remote → merged === store
  });

  it('merges a remote payload and pushes the converged result', async () => {
    const local = fakeStore();
    const remoteEnvelope = buildExportPayload(fakeStore({
      history: [
        { id: 's-1', dateISO: '2026-01-01', savedAt: '2026-01-02T10:00:00Z', blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '8', weightKg: '85' }] }] },
        { id: 's-2', dateISO: '2026-01-03', savedAt: '2026-01-03T10:00:00Z', blocks: [{ exerciseId: 'deadlift', sets: [{ reps: '5', weightKg: '120' }] }] },
      ],
    }));
    const pushes = [];
    const adapter = {
      pull: async () => JSON.stringify(remoteEnvelope),
      push: async (text) => pushes.push(JSON.parse(text)),
    };
    const { merged, config } = await runSync({ store: local, config: defaultSyncConfig(), adapter, encryption: null });
    // remote s-1 is newer → wins; s-2 is new → added
    assert.equal(merged.history.find((h) => h.id === 's-1').blocks[0].sets[0].weightKg, '85');
    assert.ok(merged.history.some((h) => h.id === 's-2'));
    // converged push carries BOTH sessions
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].data.history.length, 2);
    assert.ok(config.lastPullAt);
  });

  it('treats a 404-style pull as a first sync, not an error', async () => {
    const adapter = { pull: async () => { throw new Error('HTTP 404 not found'); }, push: async () => {} };
    const { merged, error } = await runSync({ store: fakeStore(), config: defaultSyncConfig(), adapter, encryption: null });
    assert.equal(error, undefined);
    assert.ok(merged.history.length === 1);
  });

  it('records a sync error in config without throwing', async () => {
    const adapter = { pull: async () => { throw new Error('HTTP 500'); }, push: async () => {} };
    const { config, error } = await runSync({ store: fakeStore(), config: defaultSyncConfig(), adapter, encryption: null });
    assert.match(error, /HTTP 500/);
    assert.equal(config.lastError, error);
    assert.ok(config.logs.some((l) => l.kind === 'sync-error'));
  });

  it('never writes sync credentials into the pushed payload', async () => {
    const local = fakeStore({ preferences: { units: 'kg', sync: { url: 'https://x', username: 'me', password: 'TOPSECRET' } } });
    let pushed = null;
    const adapter = { pull: async () => null, push: async (text) => { pushed = JSON.parse(text); } };
    await runSync({ store: local, config: defaultSyncConfig(), adapter, encryption: null });
    assert.equal(pushed.data.preferences?.sync, undefined);
    assert.equal(JSON.stringify(pushed).includes('TOPSECRET'), false);
  });

  it('round-trips through parseImportFile (the remote is a valid backup)', async () => {
    const envelope = buildExportPayload(fakeStore());
    let pushed = null;
    const adapter = { pull: async () => JSON.stringify(envelope), push: async (t) => { pushed = t; } };
    await runSync({ store: fakeStore(), config: defaultSyncConfig(), adapter, encryption: null });
    const parsed = parseImportFile(pushed);
    assert.equal(parsed.history.length, 1);
  });
});

describe('status label', () => {
  it('reflects error > queued > synced > never', () => {
    assert.equal(syncStatusLabel({ lastError: 'x' }), 'error');
    assert.equal(syncStatusLabel({ queue: [{}] }), 'queued');
    assert.equal(syncStatusLabel({ lastPushAt: '2026-01-01' }), 'up to date');
    assert.equal(syncStatusLabel({}), 'never synced');
  });
});
