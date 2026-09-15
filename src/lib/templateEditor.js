// templateEditor.js — pure helpers for the template builder UI.
//
// Kept out of templates.js so the boot chunk (which needs recommendTemplate
// and the scheduler) never pays for editor-only code: only the lazy Train
// route imports this module. Editing an existing template BUMPS ITS VERSION
// and refreshes updatedAtISO — schedules already started from it are
// untouched, and the edit stays traceable. Duplicating hands back a fresh
// version-1 copy under a new id. Rest is carried per exercise (seconds,
// clamped 0–600); reordering is index-safe (no-op outside bounds).

import { EXERCISE_BY_ID, exerciseAvailable } from './data.js';
import { rankedSubstitutions } from './substitutions.js';
import { equipmentCoverage } from './templates.js';

const EDITOR_REST_CLAMP = (v)=> Math.max(0, Math.min(600, Math.round(Number(v) || 0)));

export function buildEditorTemplate({ name, description, level, goal, days }, existing = null){
  const id = existing?.id || `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const usedEquipment = new Set(['bodyweight']);
  const workouts = (days || []).map((day, i)=> ({
    day: i + 1,
    title: day.title?.trim() || `Day ${i + 1}`,
    blocks: (day.exercises || [])
      .filter(e => e.exerciseId)
      .map(e => {
        for(const eq of (EXERCISE_BY_ID[e.exerciseId]?.equipment || [])) usedEquipment.add(eq);
        return { exerciseId: e.exerciseId, sets: Math.max(1, Number(e.sets) || 3), reps: e.reps?.trim() || '8–12', restSec: EDITOR_REST_CLAMP(e.restSec ?? 90), loadHint: '' };
      }),
  }));
  const nowISO = new Date().toISOString();
  const base = existing ? { ...existing, version: (existing.version || 1) + 1 } : { id, isCustom: true, version: 1, createdAtISO: nowISO };
  return {
    ...base,
    name: (name || '').trim(),
    description: (description || '').trim() || 'Your own template.',
    level, goal, daysPerWeek: (days || []).length,
    updatedAtISO: nowISO,
    program: {
      id, name: (name || '').trim(), tagline: (description || '').trim() || 'Your own template.',
      level, daysPerWeek: (days || []).length,
      mesocycle: { weeks: 4, deloadWeek: null, progression: 'double-progression' },
      version: base.version,
      equipment: [...usedEquipment],
      weeks: [{ week: 1, workouts }],
    },
  };
}

// Reorder helper: returns a NEW array with item `from` moved to `to`;
// out-of-bounds or invalid moves are no-ops (never a crash mid-edit).
export function moveItem(list, from, to){
  const arr = Array.isArray(list) ? [...list] : [];
  if(!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return arr;
}

// Duplicate for "save as copy": version resets to 1 under a fresh id.
export function duplicateEditorTemplate(tpl){
  if(!tpl || !tpl.program) return null;
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    ...tpl,
    id,
    version: 1,
    name: `${tpl.name || 'Template'} copy`,
    isCustom: true,
    createdAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
    program: { ...tpl.program, id, name: `${tpl.name || 'Template'} copy`, version: 1 },
  };
}

// Editor preview: which kit pieces the template asks for are missing on this
// device, and what the engine would honestly swap each into. Reuses the same
// rankedSubstitutions the scheduler uses — preview and reality can't drift.
export function editorSubstitutionPreview(tpl, availableEquipment = null, history = null){
  const prog = tpl?.program;
  if(!prog) return { coverage: 1, swaps: [] };
  const coverage = equipmentCoverage(prog, availableEquipment);
  const swaps = [];
  for(const workout of prog.weeks?.[0]?.workouts || []){
    for(const block of workout.blocks || []){
      const ex = EXERCISE_BY_ID[block.exerciseId];
      if(!ex) continue;
      if(exerciseAvailable(block.exerciseId, availableEquipment)) continue;
      const ranked = rankedSubstitutions(block.exerciseId, availableEquipment, 1, history);
      swaps.push({ from: block.exerciseId, fromName: ex.name, to: ranked[0] || null });
    }
  }
  return { coverage, swaps };
}
