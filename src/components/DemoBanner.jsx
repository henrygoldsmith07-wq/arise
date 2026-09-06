import { useState } from 'react';
import { captureSnapshot } from '../lib/snapshots.js';
import { clearAllStoredData } from '../lib/storage.js';

/**
 * The demo-mode banner: fixed under the app header while `store.demo` is
 * true. Two jobs, both honesty:
 *   1. LABEL — nothing on screen pretends to be the user's data; every
 *      session in a demo store carries a `demo-` id and this banner says
 *      "sample data" in words, not just vibes.
 *   2. EXIT — one tap wipes the demo and boots a genuinely empty app,
 *      guarded by a confirm and preceded by a forced snapshot (so even the
 *      demo itself is recoverable via More → diagnostics if someone exits
 *      by accident and changes their mind before the wipe completes).
 */
export default function DemoBanner(){
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const exitDemo = async () => {
    if(!window.confirm('Exit demo mode? All sample data is erased and Arise starts empty.')) return;
    setBusy(true); setErr(null);
    try{
      await captureSnapshot({ force: true, reason: 'pre-exit-demo' });
      await clearAllStoredData();
      window.location.reload();
    }catch(e){
      setErr(e?.message || 'Exit failed — try More → Clear local data.');
      setBusy(false);
    }
  };

  return (
    <div role="region" aria-label="Demo mode banner" className="px-4 pt-2">
      <div className="rounded-2xl border border-line bg-surface2 px-3 py-2.5 flex items-center gap-3">
        <span aria-hidden className="text-base">🧪</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">Demo mode — sample data</p>
          <p className="text-[11px] text-ink3 leading-snug">
            Everything here is generated for exploration. Nothing syncs or exports as yours.
          </p>
          {err && <p className="text-[11px] text-review mt-1">{err}</p>}
        </div>
        <button onClick={exitDemo} disabled={busy} className="btn btn-secondary min-h-10 shrink-0 rounded-xl px-3 text-xs disabled:opacity-40">
          {busy ? 'Erasing…' : 'Start fresh'}
        </button>
      </div>
    </div>
  );
}
