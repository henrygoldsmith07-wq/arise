import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSyncConfig, normalizeSyncConfig, sanitizeSyncConfig, observePeerDevice, runSync,
} from '../src/lib/syncEngine.js';
import { buildExportPayload } from '../src/lib/export.js';

function fakeStore(id = 'h1'){
  return { version: 6, onboarding: null, activeSchedule: null, history: [{ id, dateISO: '2026-01-01', savedAt: '2026-01-01T10:00:00Z', blocks: [] }], preferences: {} };
}
// An export envelope as the writer's app produces one: the device id and
// export timestamp live at the envelope level.
const remoteEnvelope = (device)=> JSON.stringify({
  app: 'arise', contract: 'arise.export.v1', device, exportedAt: '2026-03-01T09:00:00.000Z',
  data: { history: [], preferences: {} },
});

describe('observePeerDevice', ()=>{
  it('records a peer device from a pulled payload envelope', ()=>{
    const cfg = observePeerDevice(defaultSyncConfig(), remoteEnvelope('dev_phone_a'));
    assert.ok(cfg.devices.dev_phone_a);
    assert.ok(cfg.devices.dev_phone_a.lastSeenAt);
    assert.equal(cfg.devices.dev_phone_a.wroteAt, '2026-03-01T09:00:00.000Z');
  });

  it('is best-effort: garbage, missing device, or no payload change nothing', ()=>{
    const base = defaultSyncConfig();
    assert.deepEqual(observePeerDevice(base, 'not json').devices, {});
    assert.deepEqual(observePeerDevice(base, JSON.stringify({ app: 'arise', data: {} })).devices, {});
    assert.deepEqual(observePeerDevice(base, null).devices, {});
  });

  it('keeps only the most recent entries (bounded registry)', ()=>{
    let cfg = defaultSyncConfig();
    for(let i = 0; i < 14; i++) cfg = observePeerDevice(cfg, remoteEnvelope(`dev_${i}`));
    const keys = Object.keys(cfg.devices);
    assert.ok(keys.length <= 10, `registry capped at 10, got ${keys.length}`);
    assert.ok(keys.length > 0);
  });

  it('normalize + sanitize carry devices without leaking secrets', ()=>{
    const cfg = observePeerDevice({ ...defaultSyncConfig(), password: 'app-pw', passphrase: 'secret' }, remoteEnvelope('dev_tab'));
    const san = sanitizeSyncConfig(cfg);
    assert.ok(san.devices.dev_tab);
    assert.ok(!('password' in san) && !('passphrase' in san));
    assert.ok('devices' in normalizeSyncConfig({ devices: { x: { lastSeenAt: 'a' } } }));
    assert.deepEqual(normalizeSyncConfig({ devices: 'garbage' }).devices, {});
  });
});

describe('runSync records peers through a real cycle', ()=>{
  it('pull of a device-stamped remote populates the registry and merges safely', async ()=>{
    const pulled = fakeStore('remote-1').history.concat([{ id: 'remote-2', dateISO: '2026-01-02', savedAt: '2026-01-02T10:00:00Z', blocks: [] }]);
    const remote = { ...fakeStore(), history: pulled };
    const remoteText = JSON.stringify(buildExportPayload(remote));
    let pushed = null;
    const adapter = { pull: async () => remoteText, push: async (p) => { pushed = p; } };
    const { merged, config, error } = await runSync({ store: fakeStore(), config: defaultSyncConfig(), adapter, encryption: null });
    assert.ok(!error, error);
    assert.ok(pushed, 'merged state pushed back');
    assert.ok(merged.history.some(h => h.id === 'remote-2'), 'remote session merged in');
    assert.ok(merged.history.some(h => h.id === 'h1'), 'local session kept');
    assert.ok(Object.keys(config.devices || {}).length >= 1, 'writing device recorded from the real envelope');
  });
});
