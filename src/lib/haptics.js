// haptics.js — named vibration patterns in one place.
//
// Replaces scattered `navigator.vibrate?.(...)` call sites with named,
// documented patterns, a single user preference (`preferences.haptics`, mirroring
// the soundCues/voiceCoach pattern), and a pure decision core so the policy is
// unit-testable. iOS Safari has no Vibration API — hapticEnabled() reports that
// honestly and call sites degrade to silence.

let cachedPref = null;

/** Read the user preference once per page (test hook can reset). */
export function setHapticsSource(fn){ getHapticsPref = fn; cachedPref = null; }
let getHapticsPref = () => true;

export function resetHapticsForTests(){ getHapticsPref = () => true; cachedPref = null; }

/** Named patterns (ms or [ms, pause, ms…]) — durations are guesses refined on real devices. */
export const HAPTIC_PATTERNS = Object.freeze({
  tap: 15,               // button feedback, nav taps — barely there, just confirmation
  setComplete: 45,       // a set is logged
  restComplete: 180,     // rest finished — must cut through a pocket
  failedSet: [80, 40, 80],   // marked failed/skipped — distinct double-pulse
  guidedStep: 30,        // guided mode advances to next step
  guidedFinish: [140, 60, 140], // guided workout finished — celebratory
  swipe: 20,             // swipe gesture crossed the threshold
  warning: [60, 50, 60, 50, 120], // destructive/danger confirmation
});

export function hapticSupported(){
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Effective enabled state: preference AND platform capability. */
export function hapticsEnabled(){
  if(!hapticSupported()) return false;
  return getHapticsPref() !== false;
}

/** Fire a named pattern. Safe everywhere; no-op without support/consent. */
export function haptic(name){
  if(!hapticsEnabled()) return false;
  const pattern = HAPTIC_PATTERNS[name] ?? HAPTIC_PATTERNS.tap;
  try{ return Boolean(navigator.vibrate(pattern)); }
  catch{ return false; }
}

// ── Pure core (unit-tested): which pattern, given a user event? ─────────────
// Keeps the mapping declarative and honest — call sites state the EVENT, this
// module decides the FEEL.

export function patternForEvent(event){
  const map = {
    'set-complete': 'setComplete',
    'rest-complete': 'restComplete',
    'set-failed': 'failedSet',
    'guided-step': 'guidedStep',
    'guided-finish': 'guidedFinish',
    'swipe-threshold': 'swipe',
    'danger-confirm': 'warning',
    'button-tap': 'tap',
  };
  return map[event] || 'tap';
}

export function vibrateForEvent(event){
  return haptic(patternForEvent(event));
}
