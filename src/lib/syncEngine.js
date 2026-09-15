// syncEngine.js — the sync runtime: config, offline queue, retry/backoff, and
// the pull→merge→push cycle.
//
// Design (extends ADR 0006 / ADR 0011):
//   - Provider is user-supplied storage (WebDAV today, others later) — there is
//     NO Arise server. The user's credentials live in `preferences.sync` on
//     this device only and are stripped from every export (exportPolicy).
//   - Payload is the standard versioned export envelope, optionally encrypted
//     end-to-end with the existing cryptoBackup format (passphrase-derived
//     key, AES-GCM). The passphrase never leaves the device; recovery is the
//     passphrase itself (instructions in the UI).
//   - Merge semantics are the tested ones in sync.js: per-session LWW via
//     savedAt, "resolved beats unresolved" (a newer resolved edit beats an
//     older unresolved copy of the same session), tombstone-aware deletions
//     where an offline edit newer than the deletion wins.
//   - Failures never block the app: pushes go to a bounded offline queue and
//     drain with exponential backoff.

import { syncUp, syncDown } from './sync.js';
import { buildExportPayload } from './export.js';
import { encryptBackup, decryptBackup } from './cryptoBackup.js';

export const SYNC_QUEUE_LIMIT = 20;
export const SYNC_LOG_LIMIT = 50;
export const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Deterministic exponential backoff: 1s, 2s, 4s … capped at 5 minutes. */
export function backoffDelayMs(attempt){
  const n = Math.max(0, Number(attempt) || 0);
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** n);
}

/** Fresh sync config; stored under preferences.sync (device-local). */
export function defaultSyncConfig(){
  return {
    provider: 'webdav',
    url: '',
    username: '',
    password: '',       // WebDAV app password — proves identity to the storage
    passphrase: '',     // E2E key material — NEVER sent to the storage server
    encryption: true,
    autoPush: true,
    lastPushAt: null,
    lastPullAt: null,
    lastError: null,
    queue: [],
    logs: [],
    devices: {},   // peer device ids seen on the synced file → last-seen times
  };
}

/** Merge persisted sync config over defaults so upgrades never lose fields. */
export function normalizeSyncConfig(raw){
  const base = defaultSyncConfig();
  if(!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    queue: Array.isArray(raw.queue) ? raw.queue.slice(-SYNC_QUEUE_LIMIT) : [],
    logs: Array.isArray(raw.logs) ? raw.logs.slice(-SYNC_LOG_LIMIT) : [],
    devices: raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices) ? raw.devices : {},
  };
}

/** What the status screen may show — never the password or the passphrase. */
export function sanitizeSyncConfig(config){
  const { password, passphrase, ...rest } = normalizeSyncConfig(config);
  return { ...rest, passwordSet: Boolean(password), passphraseSet: Boolean(passphrase) };
}

/** Append a capped log entry; returns the new logs array (pure). */
export function pushLog(logs, entry){
  const next = [...(logs || []), { at: new Date().toISOString(), ...entry }];
  return next.slice(-SYNC_LOG_LIMIT);
}

/** Queue an item for later push (offline, or a failed cycle). Pure. */
export function enqueueOffline(config, reason){
  const cfg = normalizeSyncConfig(config);
  const queue = [...cfg.queue, { at: new Date().toISOString(), reason, attempts: 0, nextAttemptAt: null }].slice(-SYNC_QUEUE_LIMIT);
  return { ...cfg, queue };
}

const PEER_DEVICE_LIMIT = 10;

/**
 * Note a peer device from a pulled remote payload. Export envelopes carry
 * `device` (the writing device's id) and `exportedAt`; recording who last
 * wrote the synced file gives the cross-device registry. Pure + best-effort:
 * unparseable or anonymous payloads change nothing.
 */
export function observePeerDevice(config, remoteText){
  const cfg = normalizeSyncConfig(config);
  if(!remoteText) return cfg;
  let envelope = null;
  try{ envelope = JSON.parse(remoteText); }catch{ return cfg; }
  const deviceId = typeof envelope?.device === 'string' ? envelope.device.slice(0, 64) : null;
  if(!deviceId) return cfg;
  const devices = { ...cfg.devices, [deviceId]: { lastSeenAt: new Date().toISOString(), wroteAt: typeof envelope?.exportedAt === 'string' ? envelope.exportedAt : null } };
  const sorted = Object.entries(devices)
    .sort((a, b) => String(b[1]?.lastSeenAt || '').localeCompare(String(a[1]?.lastSeenAt || '')))
    .slice(0, PEER_DEVICE_LIMIT);
  const trimmed = Object.fromEntries(sorted);
  return { ...cfg, devices: trimmed };
}

/**
 * Drain the offline queue through `pushOne`. `pushOne(item)` should throw on
 * failure; a failure schedules the next attempt via backoff. Pure w.r.t. the
 * config — returns the updated config; the caller persists it.
 */
export async function drainQueue(config, pushOne){
  const cfg = normalizeSyncConfig(config);
  if(!cfg.queue.length) return cfg;
  const now = Date.now();
  const due = cfg.queue.filter((q) => !q.nextAttemptAt || Date.parse(q.nextAttemptAt) <= now);
  if(!due.length) return cfg;
  const queue = [...cfg.queue];
  let logs = cfg.logs;
  let lastError = cfg.lastError;
  let allOk = true;
  for(const item of due){
    const idx = queue.indexOf(item);
    try{
      await pushOne(item);
      queue.splice(idx, 1);
      logs = pushLog(logs, { kind: 'queue-drained', reason: item.reason, attempts: item.attempts });
    }catch(err){
      allOk = false;
      const attempts = (item.attempts || 0) + 1;
      const nextAttemptAt = new Date(now + backoffDelayMs(attempts)).toISOString();
      queue[idx] = { ...item, attempts, nextAttemptAt };
      lastError = String(err?.message || err);
      logs = pushLog(logs, { kind: 'queue-retry', reason: item.reason, attempts, error: lastError });
    }
  }
  return { ...cfg, queue, logs, lastError, lastPushAt: allOk && queue.length === 0 ? new Date().toISOString() : cfg.lastPushAt };
}

/**
 * One full sync cycle against `adapter` ({ pull, push }). Read-modify-write:
 * pull remote → merge into local (tested LWW semantics) → push the merged
 * payload back. With `encryption`, the payload is sealed with the
 * passphrase-derived key before it touches the provider.
 *
 * Returns { merged, config } — the caller persists both.
 */
export async function runSync({ store, config, adapter, encryption } = {}){
  const cfg = normalizeSyncConfig(config);
  // encryption: undefined → follow the config toggle; null → explicitly off;
  // an object → custom seal implementation (tests/future providers).
  const seal = encryption === undefined
    ? (cfg.encryption ? { encrypt: encryptBackup, decrypt: decryptBackup } : null)
    : encryption;
  const logs0 = cfg.logs;
  try{
    // 1. Pull + merge (syncDown already handles "remote empty" → local).
    // The transport carries BYTES so sealed envelopes survive intact; a
    // sealed payload decrypts with the ENCRYPTION PASSPHRASE — the account
    // password authenticates to the storage and must never be used as key
    // material. Plain text stays plain text when encryption is off.
    let remoteText = null;
    try{
      const remoteRaw = await adapter.pull();
      if(remoteRaw != null){
        if(typeof remoteRaw === 'string'){
          remoteText = remoteRaw; // legacy/string adapters (tests, providers that expose text)
        }else if(remoteRaw instanceof Uint8Array){
          if(seal){
            remoteText = JSON.stringify(await seal.decrypt(remoteRaw, cfg.passphrase));
          }else{
            remoteText = new TextDecoder().decode(remoteRaw);
          }
        }
      }
    }catch(err){
      // A missing remote file is a first run, not an error. A wrong
      // passphrase or corrupt ciphertext IS an error — and nothing is
      // pushed, so neither the remote file nor local history changes.
      if(!/404|not found/i.test(String(err?.message || err))) throw err;
    }
    const merged = remoteText
      ? await syncDown(store, { pull: async () => remoteText }, 'merge')
      : store;
    // 2. Push the merged state so both devices converge on the same payload.
    const payload = buildExportPayload(merged);
    let outgoing = JSON.stringify(payload);
    if(seal){
      if(!cfg.passphrase) throw new Error('Sync encryption is on but no passphrase is set.');
      outgoing = await seal.encrypt(payload, cfg.passphrase);
    }
    await adapter.push(outgoing);
    // Record who last wrote the remote file (device registry), then stamp
    // this cycle's timestamps on top.
    const peered = observePeerDevice(cfg, remoteText);
    const next = {
      ...peered,
      lastPushAt: new Date().toISOString(),
      lastPullAt: remoteText ? new Date().toISOString() : cfg.lastPullAt,
      lastError: null,
      logs: pushLog(logs0, { kind: 'sync', direction: 'pull+push', encrypted: Boolean(seal) }),
    };
    return { merged, config: next };
  }catch(err){
    const message = String(err?.message || err);
    return {
      merged: store,
      config: { ...cfg, lastError: message, logs: pushLog(logs0, { kind: 'sync-error', error: message }) },
      error: message,
    };
  }
}

/** Device-local marker for the status screen ("this device" vs peers). */
export function syncStatusLabel(config){
  const cfg = normalizeSyncConfig(config);
  if(cfg.lastError) return 'error';
  if(cfg.queue.length) return 'queued';
  if(cfg.lastPushAt) return 'up to date';
  return 'never synced';
}
