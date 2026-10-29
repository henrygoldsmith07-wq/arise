// exerciseText.js — long-form setup steps, common mistakes and the full cue
// lists for the library, kept OUT of the JS bundle (the catalogue keeps only
// each exercise's first cue, which the runners show inline).
//
// The sentences live in data/exercise-text.json, which Vite emits as a plain
// asset (precached by the service worker like every other file in assets/, so
// it works offline after the first visit). Only the teaching surfaces (the
// exercise detail sheet and the in-session "How to" panel) read them, so the
// catalogue chunk no longer pays ~6 kB gz for text lifters rarely open.
//
// This module is pure (no fetch, no Vite specifiers) so node tests and
// scripts can install the map directly; the browser loader lives in
// exerciseTextLoader.js. Until the map arrives, teachingFor() falls back to
// its cue-derived wording — never blank.

let TEXT = null;

export function setExerciseText(map){
  TEXT = map && typeof map === 'object' ? map : null;
}

export function exerciseTextLoaded(){
  return TEXT !== null;
}

/** @returns {{instructions?: string[], mistakes?: string[], cues?: string[]} | null} */
export function exerciseText(id){
  return (TEXT && TEXT[id]) || null;
}

// Strict shape check (moved from data.validateContent with the text itself):
// the detail view renders these as sentences, so free-form junk would show.
export function validateExerciseText(map, knownIds){
  const errors = [];
  for(const [id, entry] of Object.entries(map || {})){
    if(knownIds && !knownIds.has(id)) errors.push(`Exercise text for unknown exercise ${id}`);
    for(const [field, min] of [['instructions', 2], ['mistakes', 1]]){
      const v = entry?.[field];
      if(v === undefined) continue;
      if(!Array.isArray(v) || v.length < min || v.some(s => typeof s !== 'string' || s.trim().length < 8)){
        errors.push(`Exercise ${id} has a malformed ${field} array (need ${min}+ meaningful sentences)`);
      }
    }
    const cues = entry?.cues;
    if(cues !== undefined && (!Array.isArray(cues) || !cues.length || cues.some(c => typeof c !== 'string' || !c.trim()))){
      errors.push(`Exercise ${id} has a malformed cues array`);
    }
  }
  return errors;
}
