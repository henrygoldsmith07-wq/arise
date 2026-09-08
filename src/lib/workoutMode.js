// workoutMode.js — the Today hero's session-mode preference.
//
// The hero's single dominant CTA always starts the standard session; short and
// guided live behind an Options disclosure. The most recently selected mode is
// remembered in the existing preferences object (`workoutMode`), but it is a
// "last used" hint only — nothing ever auto-launches from it.
//
// Values: 'standard' | 'short' | 'guided'. Legacy/missing/invalid values all
// resolve to 'standard' so a store written before this preference existed (or
// a hand-edited backup) never breaks the hero.

export const WORKOUT_MODES = ['standard', 'short', 'guided'];

/** Resolve any stored value (including legacy/missing) to a valid mode. */
export function normaliseWorkoutMode(value){
  return WORKOUT_MODES.includes(value) ? value : 'standard';
}

/** Read the stored preference; legacy/missing falls back to 'standard'. */
export function storedWorkoutMode(preferences){
  return normaliseWorkoutMode(preferences?.workoutMode);
}

/** Pure preference patch for a mode pick — callers own the setStore call. */
export function workoutModePatch(preferences, mode){
  return { ...(preferences || {}), workoutMode: normaliseWorkoutMode(mode) };
}

/** Human label for the Options "Last used" hint. */
export function workoutModeLabel(mode){
  return { standard: 'Standard workout', short: '20-minute workout', guided: 'Guided mode' }[normaliseWorkoutMode(mode)] || 'Standard workout';
}
