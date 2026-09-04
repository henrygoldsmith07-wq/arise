// pwa.js — small PWA shell helpers shared by App.jsx.
//
//   ensureStandaloneBodyClass — keeps `body.standalone` in sync with the real
//     display mode. CSS keys off it for status-bar padding (iOS
//     black-translucent draws under the notch) and any standalone-only styling.
//     React-free on purpose: it must also work on the very first paint after
//     cold launch, before hydration.
//   consumeShortcut — home-screen shortcuts land on "/?shortcut=…"; map them
//     to the right tab once, then clean the URL so a reload doesn't re-trigger.

import { isStandalone } from './install.js';

export function ensureStandaloneBodyClass(){
  if(typeof document === 'undefined') return false;
  const apply = () => {
    const standalone = isStandalone();
    document.body.classList.toggle('standalone', standalone);
    return standalone;
  };
  apply();
  // Display mode can change (installed mid-session); keep watching.
  try{
    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', apply);
  }catch{}
  return isStandalone();
}

/** Pure: which tab does a shortcut query demand? */
export function tabForShortcut(shortcut){
  switch(shortcut){
    case 'start-workout': return 'today';
    case 'quick-log': return 'train';
    default: return null;
  }
}

/** Consume ?shortcut=… once: navigate, then scrub the URL (history-replace). */
export function consumeShortcut(setTab){
  if(typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const shortcut = params.get('shortcut');
  const tab = tabForShortcut(shortcut);
  if(tab && typeof setTab === 'function'){
    setTab(tab);
    params.delete('shortcut');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }
  return tab;
}
