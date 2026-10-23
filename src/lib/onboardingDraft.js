// onboardingDraft.js — keeps in-progress onboarding answers so an accidental
// Esc / outside tap / ✕ never wipes them. Stored in sessionStorage only: it
// stays on the device, lives for the browser session, and is cleared on save.

export const ONBOARDING_DRAFT_KEY = 'arise.onboardingDraft.v1';
export const ONBOARDING_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const STRING_FIELDS = ['goal', 'location', 'level', 'dumbbellsInput', 'machineIncrementInput'];
const ARRAY_FIELDS = ['equipment', 'preferredExerciseIds', 'dislikedExerciseIds'];
const NUMBER_FIELDS = ['days', 'minutes', 'barWeightKg', 'step'];

function defaultStorage(){
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

/** Validate/sanitise an untrusted object into a draft, or null if unusable. */
export function sanitizeDraft(raw){
  if(!raw || typeof raw !== 'object') return null;
  const out = {};
  for(const f of STRING_FIELDS) if(typeof raw[f] === 'string') out[f] = raw[f].slice(0, 200);
  for(const f of ARRAY_FIELDS){
    if(Array.isArray(raw[f])) out[f] = raw[f].filter(v=> typeof v === 'string').slice(0, 200);
  }
  if(Array.isArray(raw.plateDenominationsKg)){
    out.plateDenominationsKg = raw.plateDenominationsKg.filter(v=> Number.isFinite(v) && v > 0).slice(0, 30);
  }
  for(const f of NUMBER_FIELDS) if(Number.isFinite(raw[f])) out[f] = raw[f];
  return Object.keys(out).length ? out : null;
}

export function saveDraft(draft, { storage = defaultStorage(), now = Date.now() } = {}){
  const clean = sanitizeDraft(draft);
  if(!storage || !clean) return false;
  try { storage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ savedAt: now, draft: clean })); return true; }
  catch { return false; }
}

export function loadDraft({ storage = defaultStorage(), now = Date.now() } = {}){
  if(!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(ONBOARDING_DRAFT_KEY) || 'null');
    if(!parsed || !Number.isFinite(parsed.savedAt)) return null;
    if(now - parsed.savedAt > ONBOARDING_DRAFT_MAX_AGE_MS || parsed.savedAt > now + 60_000) return null;
    return sanitizeDraft(parsed.draft);
  } catch { return null; }
}

export function clearDraft({ storage = defaultStorage() } = {}){
  try { storage?.removeItem(ONBOARDING_DRAFT_KEY); } catch { /* ignore */ }
}

/** True when the draft differs from the baseline answers (worth restoring). */
export function draftDiffers(draft, baseline){
  if(!draft) return false;
  return Object.keys(draft).some(k=> k !== 'step' && JSON.stringify(draft[k]) !== JSON.stringify(baseline?.[k]));
}
