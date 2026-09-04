// SyncPanel.jsx — the cross-device sync status screen and configuration form.
//
// There is no Arise server: the user brings their own WebDAV storage
// (Nextcloud, Fastmail, Synology, …) and Arise keeps one versioned —
// optionally end-to-end encrypted — backup file there. This panel owns:
//   - enable/disable + credentials (stored on this device ONLY, never exported)
//   - connection test, manual "Sync now", status line, logs and offline queue
//   - the privacy explanation and key-recovery instructions
//
// State shape: this component is controlled by the parent (MoreView) through
// { store, setStore, msg, setMsg } — sync config lives at
// store.preferences.sync and is stripped from every export by export.js.

import { useState } from 'react';
import { runSync, drainQueue, sanitizeSyncConfig, syncStatusLabel, enqueueOffline } from '../lib/syncEngine.js';
import { makeWebdavAdapter, webdavCheck } from '../lib/webdav.js';
import { buildExportPayload } from '../lib/export.js';

function StatusPill({ label }){
  const tone = label === 'error' ? 'border-danger/40 bg-dangersoft'
    : label === 'queued' ? 'border-review/40 bg-reviewsoft'
    : 'border-line bg-surface2';
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

export default function SyncPanel({ store, setStore, setMsg }){
  const prefs = store?.preferences || {};
  const sync = prefs.sync || null;
  const enabled = prefs.syncEnabled === true;
  const sanitized = sync ? sanitizeSyncConfig(sync) : null;
  const [form, setForm] = useState(() => ({
    url: sanitized?.url || '',
    username: sanitized?.username || '',
    password: '',
    passphrase: '',
    encryption: sanitized?.encryption !== false,
  }));
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  const patchSync = (patch) => {
    const next = { ...store, preferences: { ...prefs, sync: { ...(prefs.sync || {}), ...patch } } };
    setStore(next);
  };

  const status = sync ? syncStatusLabel(sync) : null;

  const persistAndMaybeSync = async (cfgPatch, thenSync = false) => {
    const nextSync = { ...(prefs.sync || {}), ...cfgPatch };
    const nextStore = { ...store, preferences: { ...prefs, sync: nextSync } };
    setStore(nextStore);
    if(thenSync) await syncNow(nextStore, nextSync);
  };

  const syncNow = async (storeArg = store, syncArg = prefs.sync) => {
    if(!enabled){ setMsg('Enable sync first — nothing leaves this device until you do.'); setTimeout(() => setMsg(null), 4000); return; }
    setBusy(true);
    try{
      const adapter = makeWebdavAdapter({ url: syncArg?.url, username: syncArg?.username, password: syncArg?.password });
      const { merged, config, error } = await runSync({ store: storeArg, config: syncArg, adapter });
      // Persist runtime state (timestamps, logs, queue) and the merged store in
      // one write; merged.preferences keeps the local sync config, which we
      // refresh with the runtime config so status stays truthful.
      setStore({ ...storeArg, ...merged, preferences: { ...(merged.preferences || {}), sync: config } });
      setMsg(error ? `Sync failed: ${error}` : 'Sync complete — both devices now match.');
      setTimeout(() => setMsg(null), 5000);
    }catch(err){
      setMsg(String(err?.message || err));
      setTimeout(() => setMsg(null), 5000);
    }finally{
      setBusy(false);
    }
  };

  const pushNow = async () => {
    if(!enabled){ setMsg('Enable sync first.'); setTimeout(() => setMsg(null), 3000); return; }
    setBusy(true);
    try{
      const adapter = makeWebdavAdapter({ url: sync?.url, username: sync?.username, password: sync?.password });
      const payload = buildExportPayload(store);
      const outgoing = sync?.encryption !== false
        ? await import('../lib/cryptoBackup.js').then((m) => m.encryptBackup(payload, sync?.passphrase))
        : JSON.stringify(payload);
      await adapter.push(outgoing);
      patchSync({ lastPushAt: new Date().toISOString(), lastError: null });
      setMsg('Pushed a backup to your storage.');
      setTimeout(() => setMsg(null), 4000);
    }catch(err){
      patchSync(enqueueOffline(sync, String(err?.message || err)));
      setMsg(`Push failed — queued for retry: ${String(err?.message || err)}`);
      setTimeout(() => setMsg(null), 5000);
    }finally{
      setBusy(false);
    }
  };

  const retryQueued = async () => {
    setBusy(true);
    try{
      const adapter = makeWebdavAdapter({ url: sync?.url, username: sync?.username, password: sync?.password });
      const next = await drainQueue(sync, async () => {
        const payload = buildExportPayload(store);
        const outgoing = sync?.encryption !== false
          ? await import('../lib/cryptoBackup.js').then((m) => m.encryptBackup(payload, sync?.passphrase))
          : JSON.stringify(payload);
        await adapter.push(outgoing);
      });
      patchSync(next);
      setMsg(next.queue.length ? `Some items still queued (${next.queue.length}).` : 'Queue drained — everything is uploaded.');
    }catch(err){
      setMsg(String(err?.message || err));
    }finally{
      setBusy(false);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  const testConnection = async () => {
    setChecking(true);
    try{
      const result = await webdavCheck({ url: form.url, username: form.username, password: form.password || sync?.password });
      setMsg(result.dav
        ? 'Connection OK — the server advertises WebDAV support.'
        : 'Connection OK — but the server did not advertise WebDAV; syncing may still work.');
    }catch(err){
      setMsg(String(err?.message || err));
    }finally{
      setChecking(false);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-bold">Cross-device sync</p>
        {status && <StatusPill label={status} />}
        <label className="ml-auto flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={() => {
              const next = { ...store, preferences: { ...prefs, syncEnabled: !enabled } };
              setStore(next);
              setMsg(!enabled
                ? 'Sync enabled. Your credentials stay on this device; data goes only to the storage you configure.'
                : 'Sync disabled — nothing will leave this device.');
              setTimeout(() => setMsg(null), 5000);
            }}
          />
          Enabled
        </label>
      </div>
      <p className="text-xs text-ink3">
        No Arise account, no Arise server: you bring your own WebDAV storage
        (Nextcloud, Fastmail, Synology, …) and Arise keeps one backup file there.
        Credentials and the encryption passphrase live on this device only and are
        never included in exports or backups.
      </p>

      <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
        <label className="block">
          <span className="text-[11px] font-bold">WebDAV URL (https)</span>
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://cloud.example.com/remote.php/dav/files/me/" autoComplete="off" spellCheck={false}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold">Username</span>
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold">{sanitized?.passwordSet ? 'App password (saved — type to replace)' : 'App password'}</span>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={sanitized?.passwordSet ? '•••• saved' : 'app password'} autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={form.encryption} onChange={(e) => setForm({ ...form, encryption: e.target.checked })} />
          End-to-end encrypt the synced file (recommended)
        </label>
        {form.encryption && (
          <div className="space-y-1.5">
            <label className="block">
              <span className="text-[11px] font-bold">{sanitized?.passphraseSet ? 'Encryption passphrase (saved — type to replace)' : 'Encryption passphrase'}</span>
              <input type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} placeholder={sanitized?.passphraseSet ? '•••• saved' : 'long and unique — this is your recovery key'} autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
            </label>
            <p className="text-[11px] text-ink3">
              The passphrase derives the encryption key on this device — the storage server never
              sees it and cannot read your data. <span className="font-semibold text-ink">If you lose it,
              the synced file cannot be decrypted.</span> Store it in your password manager and use
              the same one on every device. This is different from the app password above.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={testConnection} disabled={checking || !form.url} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] disabled:opacity-40">Test connection</button>
          <button
            onClick={() => persistAndMaybeSync({
              url: form.url.trim(),
              username: form.username.trim(),
              password: form.password || sync?.password,
              passphrase: form.passphrase || sync?.passphrase,
              encryption: form.encryption,
            }, true)}
            disabled={busy || !form.url}
            className="btn btn-primary min-h-8 rounded-lg px-2.5 text-[11px] disabled:opacity-40"
          >Save &amp; sync now</button>
          <button onClick={pushNow} disabled={busy || !enabled} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] disabled:opacity-40">Push backup</button>
        </div>
      </div>

      {sync && (
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 text-xs space-y-1">
          <p className="font-bold">Status</p>
          <p className="text-ink3">
            {sync.lastPushAt ? `Last push ${new Date(sync.lastPushAt).toLocaleString()}` : 'Never pushed'}
            {sync.lastPullAt ? ` · last pull ${new Date(sync.lastPullAt).toLocaleString()}` : ''}
            {sanitized?.passphraseSet ? '' : sanitized?.encryption !== false ? ' · no passphrase set yet (required for encrypted sync)' : ''}
          </p>
          {sync.lastError && <p role="alert" className="text-danger font-semibold">Last error: {sync.lastError}</p>}
          {sync.queue?.length > 0 && (
            <p>
              {sync.queue.length} change(s) queued offline
              <button onClick={retryQueued} disabled={busy} className="ml-2 underline font-semibold">Retry now</button>
            </p>
          )}
          {sync.logs?.length > 0 && (
            <details>
              <summary className="font-semibold cursor-pointer">Sync log (last {Math.min(sync.logs.length, 10)})</summary>
              <ul className="mt-1 space-y-0.5 text-[11px] text-ink3">
                {[...sync.logs].slice(-10).reverse().map((l, i) => (
                  <li key={`${l.at}-${i}`}>{new Date(l.at).toLocaleString()} — {l.kind}{l.error ? `: ${l.error}` : ''}{l.direction ? ` (${l.direction})` : ''}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
