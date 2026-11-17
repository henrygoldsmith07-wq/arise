// gymPrefsMemory.js — tiny, dependency-free memory helpers for gym preferences.
//
// Kept separate from gymMode.js so the boot path (App.jsx) can update a rest
// preset or warm-up skip without importing the equipment/progression engine.
// Both functions are pure: they return the next map, never mutate their input.

export function setRestPreset(gymPrefs, exerciseId, seconds){
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  const next = { ...(gymPrefs?.restPresets || {}) };
  if(sec <= 0) delete next[exerciseId];
  else next[exerciseId] = sec;
  return next;
}

export function setWarmupSkip(gymPrefs, exerciseId, skip){
  const next = { ...(gymPrefs?.skipWarmups || {}) };
  if(skip) next[exerciseId] = true;
  else delete next[exerciseId];
  return next;
}
