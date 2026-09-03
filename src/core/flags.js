// core/flags.js — feature flags for experimental capabilities.
//
// A flag is declared once in CONFIG.flags and read through this module.
// Default value comes from the declaration; the user can override a flag in
// preferences (`preferences.flags[flag] = true|false`), which is how
// experimental capabilities ship dark and get enabled per-user before a
// wide release. FlagDisabledError makes call sites honest: a disabled
// capability throws a typed, catchable error instead of silently no-op'ing.

import { CONFIG } from './config.js';
import { FlagDisabledError } from './errors.js';

/** All flag ids with their declaration (label, default, stage). */
export function flagDeclarations(){
  return { ...CONFIG.flags };
}

/** Effective value for a flag: explicit preference override > declared default. */
export function isFeatureEnabled(store, flag){
  const declaration = CONFIG.flags[flag];
  if(!declaration) return false;
  const override = store?.preferences?.flags?.[flag];
  if(typeof override === 'boolean') return override;
  return declaration.default;
}

/** Only flags the settings UI should offer for this build stage. */
export function toggleableFlags(stage = 'experimental'){
  return Object.entries(CONFIG.flags)
    .filter(([, d]) => d.stage === stage)
    .map(([id, d]) => ({ id, ...d }));
}

/**
 * Gate a capability: throws FlagDisabledError when the flag is off.
 * Call sites: `ensureFeature(store, 'syncEngine')` at the entry of the
 * code path, so disabled capabilities fail typed and loudly.
 */
export function ensureFeature(store, flag){
  if(!isFeatureEnabled(store, flag)) throw new FlagDisabledError(flag);
  return true;
}

/** Flip a flag in a (store, preferences) shape — pure, returns new prefs. */
export function setFlag(preferences = {}, flag, value){
  const declaration = CONFIG.flags[flag];
  if(!declaration) return preferences;
  return { ...preferences, flags: { ...(preferences.flags || {}), [flag]: value } };
}
