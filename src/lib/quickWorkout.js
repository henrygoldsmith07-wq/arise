// quickWorkout.js — an unplanned session ("Quick workout") built from the
// lifts the lifter picks, run by the normal runner with normal progression
// targets, saved to history WITHOUT touching the programme: its id matches no
// scheduled session, so nothing is marked done, skipped or shifted.
import { EXERCISES, EXERCISE_BY_ID, exerciseFitsEquipment } from './data.js';
import { isDeprecated } from './exerciseTaxonomy.js';
import { filterExercises } from './exercisePicker.js';
import { localDateISO } from './dateOnly.js';

export const QUICK_MAX = 10;
export const QUICK_PROGRAM_ID = 'quick';
const UPPER = ['Chest', 'Back', 'Shoulders', 'Arms'];
const SKIP_FRESH = new Set(['Cardio', 'Full body', 'Core']);

export const isQuickSession = (s) => Boolean(s && (s.quick || s.programId === QUICK_PROGRAM_ID));

function completedSets(block){
  return (block?.sets || []).filter((s) => s && (s.completed || s.done || Number(s.reps) > 0));
}

function sessionsNewestFirst(history){
  return [...(history || [])].filter((h) => h && h.dateISO && Array.isArray(h.blocks))
    .sort((a, b) => String(b.dateISO).localeCompare(String(a.dateISO)));
}

/** Lifts a lifter can pick right now: kit-fit, not avoided, not deprecated, liked first. */
export function quickCandidates({ query = '', muscle = null, equipment = null, preferred = [], disliked = [], exclude = [], limit = 40 } = {}){
  const has = equipment && equipment.length ? new Set(equipment) : null;
  const skip = new Set([...(disliked || []), ...(exclude || [])]);
  const liked = new Set(preferred || []);
  return filterExercises(EXERCISES, { query, muscle })
    .filter((ex) => !skip.has(ex.id) && !isDeprecated(ex) && (!has || exerciseFitsEquipment(ex, has)))
    .sort((a, b) => Number(liked.has(b.id)) - Number(liked.has(a.id)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The lifts of the most recent finished session that still exist in the library. */
export function sameAsLastTime(history){
  for(const h of sessionsNewestFirst(history)){
    const ids = [];
    for(const b of h.blocks){
      const id = EXERCISE_BY_ID[b.exerciseId] && !isDeprecated(b.exerciseId) ? b.exerciseId : null;
      if(id && completedSets(b).length && !ids.includes(id)) ids.push(id);
    }
    if(ids.length) return { ids: ids.slice(0, QUICK_MAX), title: h.title || 'Last session', dateISO: h.dateISO };
  }
  return null;
}

/** Whole days since each muscle last had a logged set (null when never). */
export function daysSinceByMuscle(history, todayISO = localDateISO()){
  const out = {};
  const today = Date.parse(`${todayISO}T00:00:00Z`);
  for(const h of history || []){
    if(!h || !h.dateISO) continue;
    const days = Math.round((today - Date.parse(`${String(h.dateISO).slice(0, 10)}T00:00:00Z`)) / 864e5);
    if(!Number.isFinite(days)) continue;
    for(const b of h.blocks || []){
      const m = EXERCISE_BY_ID[b.exerciseId]?.muscle;
      if(m && completedSets(b).length && (out[m] == null || days < out[m])) out[m] = Math.max(0, days);
    }
  }
  return out;
}

function timesLogged(history){
  const n = {};
  for(const h of history || []) for(const b of h.blocks || []) if(completedSets(b).length) n[b.exerciseId] = (n[b.exerciseId] || 0) + 1;
  return n;
}

/**
 * Two lifts for each of the muscles that have rested longest (never trained
 * counts as longest), favouring lifts the user has logged, then liked ones,
 * then compounds. `muscles` limits the pool (e.g. upper body for a rider).
 */
export function restedMuscleLifts({ history, equipment, preferred = [], disliked = [], muscles = null, todayISO = localDateISO(), muscleCount = 3, perMuscle = 2 } = {}){
  const since = daysSinceByMuscle(history, todayISO);
  const counts = timesLogged(history);
  const liked = new Set(preferred || []);
  const pool = quickCandidates({ equipment, preferred, disliked, limit: 400 });
  const wanted = [...new Set(pool.map((e) => e.muscle))]
    .filter((m) => !SKIP_FRESH.has(m) && (!muscles || muscles.includes(m)))
    .sort((a, b) => (since[b] ?? 999) - (since[a] ?? 999) || a.localeCompare(b))
    .slice(0, muscleCount);
  const ids = [];
  const reasons = {};
  for(const m of wanted){
    const score = (e) => (counts[e.id] || 0) * 4 + (liked.has(e.id) ? 2 : 0) + ((e.tags || []).includes('compound') ? 1 : 0);
    const picks = pool.filter((e) => e.muscle === m).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)).slice(0, perMuscle);
    for(const p of picks) if(ids.length < QUICK_MAX) ids.push(p.id);
    reasons[m] = since[m] == null ? 'not logged yet' : since[m] === 0 ? 'trained today' : `${since[m]} day${since[m] === 1 ? '' : 's'} rest`;
  }
  return { ids, muscles: wanted, reasons };
}

export const upperBodyLifts = (opts) => restedMuscleLifts({ ...opts, muscles: UPPER, muscleCount: 2, perMuscle: 2 });

function lastPrescription(history, exerciseId){
  for(const h of sessionsNewestFirst(history)){
    const b = (h.blocks || []).find((x) => x.exerciseId === exerciseId && completedSets(x).length);
    if(!b) continue;
    const done = completedSets(b);
    const reps = done.map((s) => Number(s.reps)).filter((n) => n > 0);
    return { sets: Math.min(5, Math.max(2, done.length)), reps: reps.length ? Math.max(...reps) : null };
  }
  return null;
}

function repsFor(ex, prev){
  if(ex.progression === 'time') return '30–45s';
  if(!prev?.reps) return '8–12';
  const top = Math.max(prev.reps, 6);
  return `${Math.max(5, top - 2)}–${Math.min(20, top + 2)}`;
}

/**
 * Build the runnable session. Sets and rep range follow the last time each lift
 * was logged (3 × 8–12 for a new lift); the runner's own progression supplies
 * the load target from history exactly as it does for a scheduled session.
 */
export function buildQuickSession({ exerciseIds, history = [], now = new Date(), title = 'Quick workout' } = {}){
  const ids = [...new Set(exerciseIds || [])].filter((id) => EXERCISE_BY_ID[id]).slice(0, QUICK_MAX);
  if(!ids.length) return null;
  const dateISO = localDateISO(now);
  const blocks = ids.map((exerciseId) => {
    const ex = EXERCISE_BY_ID[exerciseId];
    const prev = lastPrescription(history, exerciseId);
    return {
      exerciseId,
      sets: prev?.sets || 3,
      reps: repsFor(ex, prev),
      restSec: ex.muscle === 'Cardio' ? 0 : 90,
    };
  });
  return {
    id: `quick-${dateISO}-${now.getTime().toString(36)}`,
    programId: QUICK_PROGRAM_ID,
    quick: true,
    title,
    dateISO,
    blocks,
    status: 'planned',
  };
}

/** Reorder helper for the picked list. */
export function moveId(ids, from, to){
  if(from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
