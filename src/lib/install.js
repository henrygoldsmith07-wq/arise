// install.js — PWA install onboarding: capture the browser's own install
// prompt where offered, detect standalone mode, and classify the platform so
// the right instructions show (iOS needs manual Share → Add to Home Screen;
// Android/desktop can get a one-tap prompt; everything else gets honest
// "not available here" copy).
//
// Platform detection is pure and exported for tests: the UA strings cover the
// edge cases that matter — iPadOS 13+ masquerades as desktop macOS Safari
// (touch support is the tell), and Android Chrome must be distinguished from
// desktop Chrome.

export function isStandalone(){
  if(typeof window === 'undefined') return false;
  // Standard: manifest display-mode media query. iOS legacy: Safari's
  // standalone flag. Match both, since iOS ignores the media query pre-16.4
  // and Chrome honours both.
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator?.standalone === true;
}

/** Pure classification from (userAgent, maxTouchPoints). */
export function classifyPlatform(userAgent, maxTouchPoints = 0){
  const ua = String(userAgent || '');
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ masquerades as macOS Safari; touch is the honest tell.
    || (/Macintosh/.test(ua) && Number(maxTouchPoints) > 1);
  const isAndroid = /Android/.test(ua);
  return {
    isIOS,
    isAndroid,
    // In-app browsers (Instagram, Facebook, …) cannot install PWAs.
    isWebview: /Instagram|FBAN|FBAV|Line\//i.test(ua),
    isIOS,
    isDesktop: !isIOS && !isAndroid,
  };
}

export function platformNow(){
  if(typeof navigator === 'undefined') return { isIOS: false, isAndroid: false, isWebview: false, isDesktop: true };
  return classifyPlatform(navigator.userAgent, navigator.maxTouchPoints || 0);
}

/**
 * Install prompt manager. `beforeinstallprompt` fires on Chromium browsers
 * when installability criteria are met; iOS never fires it (manual flow).
 * The manager can only be armed once per page visit — the event is consumed
 * by calling prompt(), which is why it is stashed, not re-requestable.
 */
export function createInstallManager(){
  let deferred = null;
  const listeners = [];
  const emit = () => { for(const fn of listeners) fn(available()); };
  const available = () => deferred != null;

  if(typeof window !== 'undefined'){
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();          // keep Chrome from showing its own mini-infobar
      deferred = e;
      emit();
    });
    // The event can arrive before listeners attach in slow hydration paths —
    // also expose it if it already fired.
    window.addEventListener('appinstalled', () => { deferred = null; emit(); });
  }

  return {
    /** Subscribe to availability changes; returns an unsubscribe fn. */
    onChange(fn){ listeners.push(fn); return () => { const i = listeners.indexOf(fn); if(i >= 0) listeners.splice(i, 1); }; },
    isAvailable: available,
    /** Show the browser install UI. Resolves with 'accepted' | 'dismissed' | 'unavailable'. */
    async prompt(){
      if(!deferred) return 'unavailable';
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      return outcome === 'accepted' ? 'accepted' : 'dismissed';
    },
  };
}
