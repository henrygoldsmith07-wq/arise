// First-paint preferences. Kept as an external same-origin script so the CSP
// does not need script-src 'unsafe-inline'. This runs synchronously in <head>.
try {
  var raw = localStorage.getItem('arise.store.v1');
  var prefs = raw ? (JSON.parse(raw).preferences || {}) : {};
  var t = prefs.theme;
  if (!t) { try { t = JSON.parse(localStorage.getItem('arise.settings') || '{}').theme; } catch(e){} }
  var dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
  var a11y = prefs.accessibility || {};
  if (a11y.largeText) document.documentElement.classList.add('large-text');
  if (a11y.highContrast) document.documentElement.classList.add('high-contrast');
  if (a11y.reduceMotion) document.documentElement.classList.add('reduce-motion');
} catch(e) {}
