// substitutions.js — equipment/muscle/pattern/difficulty-aware substitution.
// Uses movement pattern + muscle + difficulty, plus history-driven performance.
// When history is supplied, prefers variants user has progressed on.

import { EXERCISES, EXERCISE_BY_ID } from "./data.js";

const PATTERN = {
  "push-up": "horizontal-push", "bench-press-barbell": "horizontal-push", "bench-press-dumbbell": "horizontal-push", "chest-press-machine": "horizontal-push", "incline-push-up": "horizontal-push", "incline-dumbbell-press": "horizontal-push",
  "pull-up": "vertical-pull", "lat-pulldown": "vertical-pull", "cable-row": "horizontal-pull", "band-row": "horizontal-pull", "dumbbell-row": "horizontal-pull",
  "bodyweight-squat": "squat", "goblet-squat": "squat", "barbell-squat": "squat", "split-squat": "squat", "bulgarian-split-squat": "squat", "lunge": "lunge",
  "romanian-deadlift": "hinge", "hip-thrust": "hip-extension", "glute-bridge": "hip-extension", "kettlebell-swing": "hinge",
  "overhead-press-dumbbell": "vertical-push", "pike-push-up": "vertical-push", "lateral-raise": "isolation-shoulder", "band-lateral-raise": "isolation-shoulder",
  "bicep-curl": "isolation-arm", "band-curl": "isolation-arm", "tricep-dip-bench": "isolation-arm", "face-pull": "isolation-shoulder",
  "plank": "core-isometric", "dead-bug": "core-control", "hanging-knee-raise": "core-flexion", "leg-raise": "core-flexion", "farmer-carry": "carry",
  "run-easy": "cardio", "brisk-walk": "cardio", "cycle": "cardio", "jump-rope": "cardio", "burpee": "conditioning",
};
const DIFF = { Beginner: 1, Intermediate: 2, Advanced: 3 };

// Public read-only access to the movement-pattern map (e.g. for longitudinal
// segmentation). Returns null for unknown exercises.
export function movementPatternFor(exerciseId){
  return PATTERN[exerciseId] || null;
}

// Exported so the real-world validation layer can audit pattern preservation
// without duplicating the mapping. Read-only consumers; keep keys in sync.
export const MOVEMENT_PATTERNS = PATTERN;

function patternScore(a, b){
  if(!a || !b) return 0;
  if(a===b) return 3;
  const near = new Set(["squat|lunge","horizontal-push|vertical-push","horizontal-pull|vertical-pull","hinge|hip-extension","core-isometric|core-control"]);
  const key = [a,b].sort().join("|");
  if(near.has(key)) return 1.5;
  return 0;
}

export function scoreSubstitution(target, candidate, opts={}){
  let s=0;
  if(target.muscle===candidate.muscle) s+=3;
  const overlap = target.equipment.filter(e=> candidate.equipment.includes(e)).length;
  s += overlap * 0.6;
  s += patternScore(PATTERN[target.id], PATTERN[candidate.id]);
  const d = Math.abs((DIFF[target.level]||2) - (DIFF[candidate.level]||2)); if(d===0) s+=1; else if(d===1) s+=0.3;
  // unilateral match
  const tUni = !!(target.unilateral || isUnilateral(target.id));
  const cUni = !!(candidate.unilateral || isUnilateral(candidate.id));
  if(tUni === cUni) s+=0.5;
  // prefer candidates user has performed well on
  if(opts.historyCounts && opts.historyCounts[candidate.id]) s += Math.min(1, opts.historyCounts[candidate.id]/5);
  if(opts.declared) s += 2;
  // user preference
  if(opts.preferred && opts.preferred.has(candidate.id)) s += 1.2;
  if(opts.disliked && opts.disliked.has(candidate.id)) s -= 5;
  // loadability: can we progress this candidate with available plates?
  if(opts.loadability && opts.loadability[candidate.id] != null) {
    s += opts.loadability[candidate.id] ? 0.6 : -0.8;
  }
  // session duration bias: short sessions prefer efficient compounds
  if(opts.shortSession) {
    const compound = ['Chest','Back','Legs','Glutes','Shoulders'].includes(candidate.muscle) && candidate.equipment.length <= 2;
    s += compound ? 0.4 : -0.2;
  }
  // achievable progression: candidates with known personalised rate slightly preferred
  if(opts.progressionAchievable && opts.progressionAchievable[candidate.id]) s += 0.3;
  if(target.id===candidate.id) s-=10;
  return s;
}

export function rankedSubstitutions(targetId, availableEquipment=null, limit=4, history=null){
  // Backwards-compatible: 2nd arg may be options object, history may be object with preferences
  let opts = {};
  if(availableEquipment && typeof availableEquipment === 'object' && !Array.isArray(availableEquipment) && !(availableEquipment instanceof Set)){
    opts = availableEquipment;
    availableEquipment = opts.availableEquipment ?? opts.equipment ?? null;
    history = opts.history ?? history;
    limit = opts.limit ?? limit;
  } else if(history && typeof history === 'object' && !Array.isArray(history) && history.preferredExerciseIds){
    opts = { preferredExerciseIds: history.preferredExerciseIds, dislikedExerciseIds: history.dislikedExerciseIds, plateConfig: history.plateConfig, targetMinutes: history.targetMinutes, history: history.history };
    history = opts.history;
  }
  const target = EXERCISE_BY_ID[targetId]; if(!target) return [];
  const has = availableEquipment ? new Set(availableEquipment) : null;
  let pool = EXERCISES.filter(e=> e.id!==targetId);
  if(has) pool = pool.filter(e=> e.equipment.every(eq=> has.has(eq)) || (e.equipment.length===1 && e.equipment[0]==="bodyweight"));
  let historyCounts=null;
  if(history){
    const histArray = Array.isArray(history) ? history : (history.history || []);
    historyCounts={};
    for(const h of histArray) for(const b of h.blocks||[]) historyCounts[b.exerciseId]=(historyCounts[b.exerciseId]||0)+1;
  }
  // preference
  const preferred = opts.preferredExerciseIds ? new Set(opts.preferredExerciseIds) : (opts.preferred ? opts.preferred : null);
  const disliked = opts.dislikedExerciseIds ? new Set(opts.dislikedExerciseIds) : (opts.disliked ? opts.disliked : null);
  // loadability heuristic: if plateConfig supplied, check if progression load would be achievable
  const loadability = {};
  if(opts.plateConfig && has) {
    for(const ex of pool){
      const equip = (ex.equipment||[]).join(' ');
      if(equip.includes('dumbbell') || equip.includes('barbell') || equip.includes('machine') || equip.includes('cable')){
        loadability[ex.id] = true;
      }
    }
  }
  const shortSession = opts.targetMinutes != null && Number(opts.targetMinutes) < 20;
  const progressionAchievable = historyCounts ? Object.fromEntries(Object.keys(historyCounts).map(id=> [id, true])) : null;

  const ranked = pool
    .filter(candidate=> !(disliked && disliked.has(candidate.id)))
    .map(c=> ({ ex: c, score: scoreSubstitution(target, c, { historyCounts, preferred, disliked, loadability, shortSession, progressionAchievable }) }))
    .sort((a,b)=> b.score - a.score).map(r=> r.ex);
  const declaredRaw = (target.substitution||[]).map(id=> EXERCISE_BY_ID[id]).filter(Boolean)
    .filter(c=> !has || c.equipment.every(eq=> has.has(eq)) || (c.equipment.length===1 && c.equipment[0]==="bodyweight"))
    .filter(c=> !(disliked && disliked.has(c.id)));
  // Prefer declared that matches user preference
  const declared = declaredRaw.sort((a,b)=>{
    const aPref = preferred && preferred.has(a.id) ? 1 : 0;
    const bPref = preferred && preferred.has(b.id) ? 1 : 0;
    return bPref - aPref;
  });
  const merged = [...declared];
  for(const ex of ranked) if(!merged.some(m=> m.id===ex.id)) merged.push(ex);
  // Preferred movements float to the top of the final list (stable), so a liked
  // exercise is surfaced even when a non-preferred declared alternative exists.
  // Float BEFORE limiting: slicing first would drop liked movements entirely
  // whenever the exercise pool grows.
  const ordered = preferred
    ? [...merged.filter(ex=> preferred.has(ex.id)), ...merged.filter(ex=> !preferred.has(ex.id))]
    : merged;
  // Chain validation: ensure result does not require missing equipment after substitution
  const validated = ordered.filter(ex=> !has || ex.equipment.every(eq=> has.has(eq)) || (ex.equipment.length===1 && ex.equipment[0]==='bodyweight'));
  return validated.slice(0, limit);
}

// UI-ready alternatives. Keep rankedSubstitutions' small exercise-only return
// shape for existing callers, while exposing the evidence behind each choice
// to the in-session swap control.
export function substitutionOptions(targetId, { availableEquipment = null, history = null, limit = 4, preferredExerciseIds = [], dislikedExerciseIds = [], plateConfig = null, targetMinutes = null } = {}){
  const target = EXERCISE_BY_ID[targetId]; if(!target) return [];
  const has = availableEquipment ? new Set(availableEquipment) : null;
  const fits = ex => !has || ex.equipment.every(eq=> has.has(eq)) || (ex.equipment.length===1 && ex.equipment[0]==='bodyweight');
  const historyCounts = {};
  for(const h of history||[]) for(const b of h.blocks||[]) historyCounts[b.exerciseId]=(historyCounts[b.exerciseId]||0)+1;
  const declared = new Set(target.substitution||[]);
  const preferred = new Set(preferredExerciseIds || []);
  const disliked = new Set(dislikedExerciseIds || []);
  const shortSession = targetMinutes != null && Number(targetMinutes) < 20;
  return EXERCISES
    .filter(ex=> ex.id!==targetId && fits(ex) && !disliked.has(ex.id))
    .map(ex=> {
      const score = scoreSubstitution(target, ex, { historyCounts, declared: declared.has(ex.id), preferred, disliked, shortSession });
      const reasons = [];
      if(ex.muscle===target.muscle) reasons.push(`same ${target.muscle.toLowerCase()} focus`);
      if(PATTERN[target.id] && PATTERN[target.id]===PATTERN[ex.id]) reasons.push('same movement pattern');
      if(has) reasons.push('fits your available kit');
      if(historyCounts[ex.id]) reasons.push('you have logged it before');
      if(declared.has(ex.id)) reasons.push('listed programme alternative');
      if(preferred.has(ex.id)) reasons.push('preferred movement');
      if(shortSession && ['Chest','Back','Legs'].includes(ex.muscle)) reasons.push('efficient for short session');
      return {
        ...ex,
        score: Math.round(score*10)/10,
        reason: reasons.slice(0,2).join(' · ') || 'closest movement match',
        equipmentFit: !has || fits(ex),
      };
    })
    .sort((a,b)=> b.score-a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Validate a full substitution chain: every target with missing kit must resolve to an available exercise.
export function validateSubstitutionChain(sessions, availableEquipment){
  const has = new Set([...(availableEquipment||[]), 'bodyweight']);
  const fits = exId => {
    const ex = EXERCISE_BY_ID[exId];
    if(!ex) return false;
    return ex.equipment.every(eq=> has.has(eq)) || (ex.equipment.length===1 && ex.equipment[0]==='bodyweight');
  };
  const issues = [];
  for(const session of sessions||[]){
    for(const block of session.blocks||[]){
      if(!fits(block.exerciseId)){
        const alternatives = rankedSubstitutions(block.exerciseId, availableEquipment, 3, []);
        const resolvable = alternatives.some(ex=> fits(ex.id));
        if(!resolvable) issues.push({ sessionId: session.id, exerciseId: block.exerciseId, reason: 'No available substitution chain leads to kit-compatible exercise' });
      }
    }
  }
  return { valid: issues.length===0, issues };
}

// Convenience: substitution based on historical user performance (prefers high-volume variants)
export function substitutionByPerformance(targetId, history, availableEquipment=null){
  return rankedSubstitutions(targetId, availableEquipment, 4, history);
}

function isUnilateral(id){ return /lunge|split|single|unilateral|bulgarian/i.test(id || ""); }
