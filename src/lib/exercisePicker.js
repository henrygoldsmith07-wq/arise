// exercisePicker.js — pure search / filter / grouping for the onboarding
// exercise-preference picker (ExercisePreferencePicker.jsx).
//
// The picker used to be one flat ~60-row list; finding "Lat Pulldown" meant
// scrolling past every chest and leg movement. This module keeps the logic
// testable without a DOM: a forgiving search (case/diacritic-insensitive,
// gym shorthand like "db" or "rdl"), muscle / equipment / "my picks"
// filters, and stable muscle grouping with liked/avoided counts.

// Display order for muscle groups. Anything not listed (future data) sorts
// after these, alphabetically, so the order never depends on input order.
export const MUSCLE_ORDER = Object.freeze(['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core', 'Full body', 'Cardio']);

// Gym shorthand → words that appear in exercise names, muscles or kit.
// A query token matches when it OR any of its expansions matches.
export const QUERY_ALIASES = Object.freeze({
  db: ['dumbbell'],
  bb: ['barbell'],
  kb: ['kettlebell'],
  rdl: ['romanian deadlift'],
  ohp: ['overhead press'],
  lat: ['pulldown'],
  lats: ['pulldown'],
  chest: ['pec'],
  pec: ['chest'],
  delts: ['shoulders'],
  tris: ['tricep'],
  bis: ['bicep', 'curl'],
  quads: ['legs'],
  abs: ['core'],
});

/** Lowercase, strip diacritics, collapse punctuation/whitespace to single spaces. */
export function normaliseQuery(value){
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function haystackFor(ex){
  const parts = [ex?.name, ex?.muscle, ...(ex?.equipment || []), String(ex?.id || '').replace(/-/g, ' ')];
  const text = normaliseQuery(parts.join(' '));
  return { text, words: text.split(' ').filter(Boolean), compact: text.replace(/ /g, '') };
}

// One term (a word or an alias phrase) matches when every one of its words is
// a prefix of some haystack word, or — for run-together input like
// "pulldown" vs "pull down" — when the compact forms contain each other.
function termMatches(term, hay){
  const words = term.split(' ').filter(Boolean);
  if(!words.length) return true;
  if(words.every((w)=> hay.words.some((hw)=> hw.startsWith(w)))) return true;
  const compact = words.join('');
  return compact.length >= 4 && hay.compact.includes(compact);
}

/** Does `ex` match the free-text query? Empty query matches everything. */
export function matchesQuery(ex, query){
  const q = normaliseQuery(query);
  if(!q) return true;
  const hay = haystackFor(ex);
  return q.split(' ').every((token)=> termMatches(token, hay) || (QUERY_ALIASES[token] || []).some((alias)=> termMatches(alias, hay)));
}

/**
 * Filter exercises for the picker.
 * @param {Array<{id:string,name:string,muscle:string,equipment:string[]}>} exercises
 * @param {{query?:string, muscle?:string|null, equipment?:string|null, onlyChosen?:boolean, preferred?:string[], disliked?:string[]}} [opts]
 */
export function filterExercises(exercises, { query = '', muscle = null, equipment = null, onlyChosen = false, preferred = [], disliked = [] } = {}){
  const chosen = new Set([...(preferred || []), ...(disliked || [])]);
  return (exercises || []).filter((ex)=> {
    if(!ex) return false;
    if(muscle && muscle !== 'all' && ex.muscle !== muscle) return false;
    if(equipment && equipment !== 'all' && !(ex.equipment || []).includes(equipment)) return false;
    if(onlyChosen && !chosen.has(ex.id)) return false;
    return matchesQuery(ex, query);
  });
}

function muscleRank(muscle){
  const at = MUSCLE_ORDER.indexOf(muscle);
  return at === -1 ? MUSCLE_ORDER.length : at;
}

/** Muscles present in `exercises`, in display order. */
export function musclesIn(exercises){
  const seen = [...new Set((exercises || []).map((ex)=> ex?.muscle || 'Other'))];
  return seen.sort((a, b)=> muscleRank(a) - muscleRank(b) || a.localeCompare(b));
}

/**
 * Group exercises by muscle in a stable display order. Within a group the
 * input order is kept. Each group carries its total and liked/avoided counts.
 * @returns {Array<{muscle:string, exercises:any[], count:number, liked:number, avoided:number}>}
 */
export function groupByMuscle(exercises, { preferred = [], disliked = [] } = {}){
  const liked = new Set(preferred || []);
  const avoided = new Set(disliked || []);
  const byMuscle = new Map();
  for(const ex of exercises || []){
    if(!ex) continue;
    const key = ex.muscle || 'Other';
    if(!byMuscle.has(key)) byMuscle.set(key, []);
    byMuscle.get(key).push(ex);
  }
  return musclesIn(exercises).map((muscle)=> {
    const list = byMuscle.get(muscle) || [];
    return {
      muscle,
      exercises: list,
      count: list.length,
      liked: list.filter((ex)=> liked.has(ex.id)).length,
      avoided: list.filter((ex)=> avoided.has(ex.id)).length,
    };
  });
}

/**
 * Like/Avoid toggle, mutually exclusive — the exact semantics onboarding has
 * always had: toggling one kind on removes the id from the other list.
 * @returns {{preferred:string[], disliked:string[]}}
 */
export function togglePreferenceIds({ preferred = [], disliked = [] }, id, kind){
  if(kind === 'preferred'){
    return {
      preferred: preferred.includes(id) ? preferred.filter((x)=> x !== id) : [...preferred, id],
      disliked: disliked.filter((x)=> x !== id),
    };
  }
  return {
    disliked: disliked.includes(id) ? disliked.filter((x)=> x !== id) : [...disliked, id],
    preferred: preferred.filter((x)=> x !== id),
  };
}
