// InstallCard.jsx — PWA install onboarding.
//
// Shows exactly one thing per platform:
//   - Chromium Android/desktop: a one-tap "Install app" button when the
//     browser's beforeinstallprompt is available.
//   - iOS/iPadOS Safari: the manual Share → Add to Home Screen steps (Apple
//     offers no prompt API).
//   - Android without the prompt event: Chrome menu → Install app fallback.
//   - In-app browsers (Instagram etc.): honest "open in your browser first".
//
// Hidden entirely once running standalone — an installed app must never
// advertise installing itself.

import { useEffect, useState } from 'react';
import { createInstallManager, isStandalone, platformNow } from '../lib/install.js';

const installManager = createInstallManager();

export function useCanInstall(){
  const [state, setState] = useState(() => ({ standalone: isStandalone(), promptable: installManager.isAvailable() }));
  useEffect(() => installManager.onChange((promptable) => setState((s) => ({ ...s, promptable }))), []);
  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const on = () => setState((s) => ({ ...s, standalone: isStandalone() }));
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);
  return state;
}

export default function InstallCard(){
  const { standalone, promptable } = useCanInstall();
  const [result, setResult] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const platform = platformNow();

  if(standalone || dismissed) return null;

  const accept = async () => {
    const outcome = await installManager.prompt();
    setResult(outcome);
  };

  const shared = "Everything stays on this device — install just adds the app shell.";

  return (
    <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 text-xs space-y-2" data-testid="install-card">
      <p className="font-bold">Install Arise as an app</p>
      {platform.isWebview ? (
        <p className="text-ink3">You are viewing this inside another app (social/browser-in-app). Open this page in your normal browser first, then install from there.</p>
      ) : platform.isIOS ? (
        <>
          <p className="text-ink3">On iPhone/iPad, installation is via Safari's share sheet:</p>
          <ol className="list-decimal list-inside text-ink3 space-y-0.5">
            <li>Tap the <span className="font-semibold text-ink">Share</span> button (□↑) in Safari's toolbar</li>
            <li>Scroll and choose <span className="font-semibold text-ink">Add to Home Screen</span></li>
            <li>Tap <span className="font-semibold text-ink">Add</span> — Arise opens fullscreen like a native app</li>
          </ol>
        </>
      ) : promptable ? (
        <>
          <p className="text-ink3">{shared}</p>
          <div className="flex gap-2">
            <button onClick={accept} className="btn btn-primary min-h-9 rounded-xl px-3">Install app</button>
            <button onClick={() => setDismissed(true)} className="underline text-ink3 font-semibold">Not now</button>
          </div>
          {result === 'dismissed' && <p className="text-ink3">You can install later from your browser's menu.</p>}
        </>
      ) : (
        <>
          <p className="text-ink3">Install from your browser menu for a fullscreen, offline-ready app:</p>
          <ol className="list-decimal list-inside text-ink3 space-y-0.5">
            <li>Open the browser menu (⋮ on Android, ⋯ / install icon on desktop)</li>
            <li>Choose <span className="font-semibold text-ink">Install app</span> (or <span className="font-semibold text-ink">Add to Home screen</span>)</li>
          </ol>
          <div className="flex gap-2">
            <button onClick={() => setDismissed(true)} className="underline text-ink3 font-semibold">Dismiss</button>
          </div>
        </>
      )}
    </div>
  );
}
