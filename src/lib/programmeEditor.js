// programmeEditor.js — "My Programme": a user override layer on the ACTIVE
// programme.
//
// Programmes arrive from a template or the generator as a materialised list
// of dated sessions (activeSchedule.sessions). Until now the only way to
// change one exercise was to rebuild a whole custom template and restart.
// This module lets the lifter edit the programme they are already running:
// swap / add / remove / reorder exercises, change sets and the rep range,
// rename a day, reset a day or everything, and undo the last change.
//
// Data model (lives ON the schedule, so it rides every existing path for
// free — IndexedDB "programme" store, JSON export/backup/import, sync and
// cross-tab refresh all already carry activeSchedule verbatim):
//
//   activeSchedule.programmeEdits = {
//     version: 1,
//     days:     { [dayKey]: { title, blocks:[{ exerciseId, sets, reps, restSec, swappedFrom? }] } },
//     original: { [sessionId]: { title, blocks } },  // pre-edit snapshot per touched session
//     undo:     { days, label, at } | null,          // one level, persisted
//     updatedAt: ISO,
//   }
//
// A day is the template day number (session.day), so "Day 2" means every
// upcoming session generated from template day 2, across all weeks. Edits are
// MATERIALISED into each not-yet-done session of that day, so Today, Gym Mode,
// the session runner, adaptation and progression read the edited programme
// with no extra code path. Completed sessions are never rewritten.
//
// Progression stays keyed by exercise id: a swap changes which id a slot
// points at and nothing else, so swapping back resumes the old history.
// Resetting restores each session from its own `original` snapshot, so
// week-to-week template differences come back exactly.
//
// Every operation is pure: (schedule, …) → { schedule, error }. On a
// validation error the input schedule is returned unchanged.

import { EXERCISES, EXERCISE_BY_ID, exerciseFitsEquipment } from './data.js';
import { substitutionOptions } from './substitutions.js';
import { isDeprecated } from './exerciseTaxonomy.js';

export const EDITS_VERSION = 1;
export const MIN_SETS = 1;
export const MAX_SETS = 8;
export const MAX_EXERCISES_PER_DAY = 12;
export const MAX_DAY_TITLE = 40;

// Rep-range bounds per unit. Reps stay human-sized; seconds cover holds and
// carries; minutes cover conditioning blocks the templates already ship.
export const REP_BOUNDS = Object.freeze({
  reps: { min: 1, max: 50, step: 1 },
  seconds: { min: 5, max: 300, step: 5 },
  minutes: { min: 1, max: 90, step: 1 },
});

const DASH = '–';

// ── Rep ranges ──────────────────────────────────────────────────────────
// Template grammar: "8–12", "5", "8–12 each", "30–45s", "30s each", "20 min".
export function parseRepRange(reps){
  const text = String(reps ?? '').trim();
  const m = text.match(/^(\d+)\s*(?:[-–—]\s*(\d+))?\s*(s|sec|min)?\s*(each)?$/i);
  if(!m) return null;
  const min = Number(m[1]);
  const max = m[2] != null ? Number(m[2]) : min;
  const raw = (m[3] || '').toLowerCase();
  const unit = raw === 'min' ? 'minutes' : raw ? 'seconds' : 'reps';
  return { min, max, unit, each: Boolean(m[4]) };
}

export function formatRepRange({ min, max, unit = 'reps', each = false }){
  const lo = Math.round(Number(min));
  const hi = Math.round(Number(max ?? min));
  const core = lo === hi ? `${lo}` : `${lo}${DASH}${hi}`;
  const suffix = unit === 'seconds' ? 's' : unit === 'minutes' ? ' min' : '';
  return `${core}${suffix}${each ? ' each' : ''}`;
}

export function validateRepRange(range){
  if(!range) return 'Rep range is not readable.';
  const bounds = REP_BOUNDS[range.unit] || REP_BOUNDS.reps;
  const { min, max } = range;
  if(!Number.isInteger(min) || !Number.isInteger(max)) return 'Rep range must be whole numbers.';
  if(min < bounds.min || max > bounds.max) return `Keep the range between ${bounds.min} and ${bounds.max}.`;
  if(min > max) return 'The bottom of the range must not be above the top.';
  return null;
}

function defaultRepsFor(exerciseId){
  const ex = EXERCISE_BY_ID[exerciseId];
  if(ex?.progression === 'time') return `30${DASH}45s`;
  return `8${DASH}12`;
}

// A swap keeps the slot's prescription unless the unit no longer makes sense
// (a plank slot swapped to a row must not ask for "30–45s" of rows).
function repsForSwap(currentReps, toId){
  const range = parseRepRange(currentReps);
  const toTime = EXERCISE_BY_ID[toId]?.progression === 'time';
  if(!range) return defaultRepsFor(toId);
  if(toTime && range.unit === 'reps') return defaultRepsFor(toId);
  if(!toTime && range.unit !== 'reps') return defaultRepsFor(toId);
  return currentReps;
}

// ── Reading the programme ───────────────────────────────────────────────
export function dayKeyOf(session){
  if(session?.day != null && session.day !== '') return String(session.day);
  return `t:${session?.title || 'Session'}`;
}

function isDone(session){ return session?.status === 'done'; }

function sessionsForDay(schedule, key){
  return (schedule?.sessions || []).filter(s=> dayKeyOf(s) === key);
}

function cleanBlock(block){
  const out = {
    exerciseId: block.exerciseId,
    sets: clampSets(block.sets),
    reps: String(block.reps ?? defaultRepsFor(block.exerciseId)),
    restSec: Number.isFinite(Number(block.restSec)) ? Math.max(0, Math.min(600, Math.round(Number(block.restSec)))) : 90,
  };
  if(block.swappedFrom) out.swappedFrom = block.swappedFrom;
  return out;
}

function clampSets(sets){
  const n = Math.round(Number(sets));
  if(!Number.isFinite(n)) return 3;
  return Math.max(MIN_SETS, Math.min(MAX_SETS, n));
}

function representative(schedule, key){
  const list = sessionsForDay(schedule, key);
  return list.find(s=> !isDone(s)) || list[list.length - 1] || null;
}

function edits(schedule){
  const e = schedule?.programmeEdits;
  if(!e || typeof e !== 'object') return { version: EDITS_VERSION, days: {}, original: {}, undo: null, updatedAt: null };
  return {
    version: EDITS_VERSION,
    days: e.days && typeof e.days === 'object' ? e.days : {},
    original: e.original && typeof e.original === 'object' ? e.original : {},
    undo: e.undo || null,
    updatedAt: e.updatedAt || null,
  };
}

// The template (pre-edit) version of a day, for badges and reset previews.
export function templateDay(schedule, key){
  const rep = representative(schedule, key);
  if(!rep) return null;
  const snap = edits(schedule).original[rep.id];
  const src = snap || rep;
  return { title: src.title || 'Session', blocks: (src.blocks || []).map(cleanBlock) };
}

function currentDay(schedule, key){
  const e = edits(schedule);
  if(e.days[key]) return { title: e.days[key].title, blocks: (e.days[key].blocks || []).map(cleanBlock) };
  const rep = representative(schedule, key);
  if(!rep) return null;
  return { title: rep.title || 'Session', blocks: (rep.blocks || []).map(cleanBlock) };
}

export function hasProgrammeEdits(schedule){
  return Object.keys(edits(schedule).days).length > 0;
}

function blockEdited(block, templateBlocks){
  const orig = templateBlocks.find(b=> b.exerciseId === block.exerciseId);
  if(!orig) return true;
  return orig.sets !== block.sets || String(orig.reps) !== String(block.reps);
}

// Editor view-model: every day that still has an upcoming session.
export function editableDays(schedule){
  const keys = [];
  for(const s of schedule?.sessions || []){
    const key = dayKeyOf(s);
    if(!keys.includes(key)) keys.push(key);
  }
  const e = edits(schedule);
  return keys
    .map(key=> {
      const list = sessionsForDay(schedule, key);
      const upcoming = list.filter(s=> !isDone(s)).length;
      const day = currentDay(schedule, key);
      const tpl = templateDay(schedule, key) || { title: day?.title, blocks: [] };
      const edited = Boolean(e.days[key]);
      return {
        key,
        title: day?.title || 'Session',
        templateTitle: tpl.title,
        upcoming,
        edited,
        renamed: edited && day.title !== tpl.title,
        blocks: (day?.blocks || []).map(b=> ({
          ...b,
          name: EXERCISE_BY_ID[b.exerciseId]?.name || b.exerciseId,
          muscle: EXERCISE_BY_ID[b.exerciseId]?.muscle || '',
          edited: edited && blockEdited(b, tpl.blocks),
        })),
      };
    })
    .filter(d=> d.upcoming > 0)
    .sort((a, b)=> (Number(a.key) || 999) - (Number(b.key) || 999));
}

export function editSummary(schedule){
  const days = editableDays(schedule);
  const editedDays = days.filter(d=> d.edited);
  return {
    days: editedDays.length,
    exercises: editedDays.reduce((n, d)=> n + d.blocks.filter(b=> b.edited).length, 0),
    canUndo: Boolean(edits(schedule).undo),
    undoLabel: edits(schedule).undo?.label || null,
  };
}

// ── Validation ──────────────────────────────────────────────────────────
export function validateDay(day){
  const errors = [];
  if(!day || !Array.isArray(day.blocks)) return ['Day is missing.'];
  if(!String(day.title || '').trim()) errors.push('Give the day a name.');
  if(String(day.title || '').length > MAX_DAY_TITLE) errors.push(`Keep the day name under ${MAX_DAY_TITLE} characters.`);
  if(day.blocks.length === 0) errors.push('A day needs at least one exercise.');
  if(day.blocks.length > MAX_EXERCISES_PER_DAY) errors.push(`A day can hold at most ${MAX_EXERCISES_PER_DAY} exercises.`);
  const seen = new Set();
  for(const block of day.blocks){
    if(!EXERCISE_BY_ID[block.exerciseId]){ errors.push(`Unknown exercise: ${block.exerciseId}.`); continue; }
    if(seen.has(block.exerciseId)) errors.push(`${EXERCISE_BY_ID[block.exerciseId].name} is already in this day.`);
    seen.add(block.exerciseId);
    if(!Number.isInteger(block.sets) || block.sets < MIN_SETS || block.sets > MAX_SETS) errors.push(`Sets must be ${MIN_SETS}–${MAX_SETS}.`);
    const repError = validateRepRange(parseRepRange(block.reps));
    if(repError) errors.push(repError);
  }
  return errors;
}

// ── Materialisation ─────────────────────────────────────────────────────
// Rewrite one session from a day definition, keeping per-session engine
// fields (load hints, adaptation notes, warm-ups) for exercises that stay.
// A prescription the user did NOT touch (same as the template day's value)
// keeps the session's own template value, so week-to-week progression baked
// into the template (week 2 "+reps") survives an unrelated edit to the day.
function materialiseSession(session, day, version, tpl, snapshot){
  const tplBlocks = tpl?.blocks || [];
  const own = snapshot?.blocks || session.blocks || [];
  const blocks = day.blocks.map(dayBlock=> {
    const existing = (session.blocks || []).find(b=> b.exerciseId === dayBlock.exerciseId);
    const base = existing ? { ...existing } : { exerciseId: dayBlock.exerciseId, loadHint: '', version };
    const tplBlock = tplBlocks.find(b=> b.exerciseId === dayBlock.exerciseId);
    const ownBlock = own.find(b=> b.exerciseId === dayBlock.exerciseId);
    const sets = tplBlock && ownBlock && tplBlock.sets === dayBlock.sets ? ownBlock.sets : dayBlock.sets;
    const reps = tplBlock && ownBlock && String(tplBlock.reps) === String(dayBlock.reps) ? ownBlock.reps : dayBlock.reps;
    const out = { ...base, exerciseId: dayBlock.exerciseId, sets, reps, restSec: dayBlock.restSec };
    if(!existing){
      delete out.substitutionFrom;
      delete out.substitutionReason;
      delete out.why;
      delete out.adaptation;
    }
    if(dayBlock.swappedFrom) out.userSwapFrom = dayBlock.swappedFrom; else delete out.userSwapFrom;
    out.userEdited = true;
    return out;
  });
  const title = tpl && day.title === tpl.title && snapshot ? snapshot.title : day.title;
  return { ...session, title, blocks, userEdited: true };
}

function restoreSession(session, snapshot){
  if(!snapshot) return session;
  const out = { ...session, title: snapshot.title, blocks: snapshot.blocks.map(b=> ({ ...b })) };
  delete out.userEdited;
  return out;
}

function snapshotOf(session){
  return { title: session.title, blocks: (session.blocks || []).map(b=> ({ ...b })) };
}

function bump(schedule, programmeEdits){
  const now = new Date().toISOString();
  const next = { ...schedule, rev: (Number(schedule.rev) || 0) + 1, updatedAt: now };
  const clean = { ...programmeEdits, updatedAt: now };
  if(!Object.keys(clean.days).length && !clean.undo){
    delete next.programmeEdits;
  } else {
    next.programmeEdits = clean;
  }
  return next;
}

// Apply a day definition (or `null` = template) to every upcoming session of
// `key`, maintaining the per-session original snapshots.
function writeDay(schedule, e, key, day){
  const original = { ...e.original };
  const version = schedule.programVersion || 1;
  const tpl = templateDay(schedule, key);
  const sessions = (schedule.sessions || []).map(s=> {
    if(dayKeyOf(s) !== key || isDone(s)) return s;
    if(day){
      if(!original[s.id]) original[s.id] = snapshotOf(s);
      return materialiseSession(s, day, version, tpl, original[s.id]);
    }
    const snap = original[s.id];
    delete original[s.id];
    return restoreSession(s, snap);
  });
  const days = { ...e.days };
  if(day) days[key] = { title: day.title, blocks: day.blocks.map(cleanBlock) };
  else delete days[key];
  return { schedule: { ...schedule, sessions }, edits: { ...e, days, original } };
}

function sameDay(a, b){
  if(!a || !b || a.title !== b.title || a.blocks.length !== b.blocks.length) return false;
  return a.blocks.every((blk, i)=> blk.exerciseId === b.blocks[i].exerciseId && blk.sets === b.blocks[i].sets && String(blk.reps) === String(b.blocks[i].reps));
}

function commit(schedule, key, mutate, label){
  if(!schedule?.sessions?.length) return { schedule, error: 'No active programme to edit.' };
  const day = currentDay(schedule, key);
  if(!day || !sessionsForDay(schedule, key).some(s=> !isDone(s))) return { schedule, error: 'That day has no upcoming sessions.' };
  const draft = { title: day.title, blocks: day.blocks.map(b=> ({ ...b })) };
  const result = mutate(draft);
  if(typeof result === 'string') return { schedule, error: result };
  const next = { title: String(draft.title).trim(), blocks: draft.blocks.map(cleanBlock) };
  const errors = validateDay(next);
  if(errors.length) return { schedule, error: errors[0] };
  const e = edits(schedule);
  const undo = { days: e.days, label, at: new Date().toISOString() };
  // Editing a day back to exactly the template clears its override.
  const tpl = templateDay(schedule, key);
  const target = sameDay(next, tpl) ? null : next;
  const written = writeDay(schedule, e, key, target);
  return { schedule: bump(written.schedule, { ...written.edits, undo }), error: null };
}

function blockAt(draft, index){
  if(!Number.isInteger(index) || index < 0 || index >= draft.blocks.length) return null;
  return draft.blocks[index];
}

const nameOf = (id)=> EXERCISE_BY_ID[id]?.name || id;
const GONE = 'That exercise is no longer in this day.';

// ── Operations ──────────────────────────────────────────────────────────
export function swapExercise(schedule, key, index, toId){
  return commit(schedule, key, (draft)=> {
    const block = blockAt(draft, index);
    if(!block) return GONE;
    if(!EXERCISE_BY_ID[toId]) return 'Unknown exercise.';
    if(block.exerciseId === toId) return 'That is already the exercise in this slot.';
    if(draft.blocks.some(b=> b.exerciseId === toId)) return `${nameOf(toId)} is already in this day.`;
    const origin = block.swappedFrom || block.exerciseId;
    draft.blocks[index] = {
      ...block,
      exerciseId: toId,
      reps: repsForSwap(block.reps, toId),
      ...(origin === toId ? { swappedFrom: undefined } : { swappedFrom: origin }),
    };
    if(origin === toId) delete draft.blocks[index].swappedFrom;
  }, `Swap ${nameOf(blockAt(currentDay(schedule, key) || { blocks: [] }, index)?.exerciseId)} → ${nameOf(toId)}`);
}

export function addExercise(schedule, key, exerciseId, { sets = 3, reps = null, restSec = null } = {}){
  return commit(schedule, key, (draft)=> {
    if(!EXERCISE_BY_ID[exerciseId]) return 'Unknown exercise.';
    if(draft.blocks.some(b=> b.exerciseId === exerciseId)) return `${nameOf(exerciseId)} is already in this day.`;
    if(draft.blocks.length >= MAX_EXERCISES_PER_DAY) return `A day can hold at most ${MAX_EXERCISES_PER_DAY} exercises.`;
    const cardio = EXERCISE_BY_ID[exerciseId].muscle === 'Cardio';
    draft.blocks.push({ exerciseId, sets: clampSets(sets), reps: reps || defaultRepsFor(exerciseId), restSec: restSec ?? (cardio ? 0 : 90) });
  }, `Add ${nameOf(exerciseId)}`);
}

export function removeExercise(schedule, key, index){
  const id = currentDay(schedule, key)?.blocks?.[index]?.exerciseId;
  return commit(schedule, key, (draft)=> {
    if(!blockAt(draft, index)) return GONE;
    if(draft.blocks.length <= 1) return 'A day needs at least one exercise — swap it instead.';
    draft.blocks.splice(index, 1);
  }, `Remove ${nameOf(id)}`);
}

export function moveExercise(schedule, key, index, direction){
  const id = currentDay(schedule, key)?.blocks?.[index]?.exerciseId;
  return commit(schedule, key, (draft)=> {
    const to = index + (direction < 0 ? -1 : 1);
    if(!blockAt(draft, index) || to < 0 || to >= draft.blocks.length) return 'It cannot move further.';
    const [item] = draft.blocks.splice(index, 1);
    draft.blocks.splice(to, 0, item);
  }, `Move ${nameOf(id)} ${direction < 0 ? 'up' : 'down'}`);
}

export function setExerciseSets(schedule, key, index, sets){
  const id = currentDay(schedule, key)?.blocks?.[index]?.exerciseId;
  return commit(schedule, key, (draft)=> {
    const block = blockAt(draft, index);
    if(!block) return GONE;
    const n = Number(sets);
    if(!Number.isInteger(n) || n < MIN_SETS || n > MAX_SETS) return `Sets must be ${MIN_SETS}–${MAX_SETS}.`;
    block.sets = n;
  }, `${nameOf(id)}: ${sets} sets`);
}

export function setExerciseRepRange(schedule, key, index, { min, max }){
  // Unit and side marker come from the block being edited inside the commit,
  // so a batched/stale caller can never stamp another block's unit.
  const rangeFor = (block)=> {
    const parsed = parseRepRange(block?.reps);
    const unit = parsed?.unit || (EXERCISE_BY_ID[block?.exerciseId]?.progression === 'time' ? 'seconds' : 'reps');
    return { unit, each: parsed?.each || false, min: Number(min), max: Number(max) };
  };
  const block0 = currentDay(schedule, key)?.blocks?.[index];
  return commit(schedule, key, (draft)=> {
    const block = blockAt(draft, index);
    if(!block) return GONE;
    const range = rangeFor(block);
    const problem = validateRepRange(range);
    if(problem) return problem;
    block.reps = formatRepRange(range);
  }, `${nameOf(block0?.exerciseId)}: ${formatRepRange(rangeFor(block0))}`);
}

export function renameDay(schedule, key, title){
  return commit(schedule, key, (draft)=> {
    const clean = String(title ?? '').trim();
    if(!clean) return 'Give the day a name.';
    if(clean.length > MAX_DAY_TITLE) return `Keep the day name under ${MAX_DAY_TITLE} characters.`;
    draft.title = clean;
  }, `Rename to “${String(title ?? '').trim()}”`);
}

export function resetDay(schedule, key){
  if(!schedule?.sessions?.length) return { schedule, error: 'No active programme to edit.' };
  const e = edits(schedule);
  if(!e.days[key]) return { schedule, error: 'This day already matches the programme.' };
  const undo = { days: e.days, label: `Reset ${e.days[key].title}`, at: new Date().toISOString() };
  const written = writeDay(schedule, e, key, null);
  return { schedule: bump(written.schedule, { ...written.edits, undo }), error: null };
}

export function resetAllEdits(schedule){
  if(!schedule?.sessions?.length) return { schedule, error: 'No active programme to edit.' };
  const e = edits(schedule);
  if(!Object.keys(e.days).length) return { schedule, error: 'Your programme already matches the template.' };
  let cur = { schedule, edits: e };
  for(const key of Object.keys(e.days)) cur = writeDay(cur.schedule, cur.edits, key, null);
  const undo = { days: e.days, label: 'Reset all', at: new Date().toISOString() };
  return { schedule: bump(cur.schedule, { ...cur.edits, undo }), error: null };
}

export function undoLastEdit(schedule){
  const e = edits(schedule);
  if(!e.undo) return { schedule, error: 'Nothing to undo.' };
  const target = e.undo.days || {};
  let cur = { schedule, edits: e };
  const keys = new Set([...Object.keys(e.days), ...Object.keys(target)]);
  for(const key of keys){
    const want = target[key] ? { title: target[key].title, blocks: target[key].blocks.map(cleanBlock) } : null;
    if(!want && !cur.edits.days[key]) continue;
    // Reset first so a re-applied day starts from the template snapshot.
    if(cur.edits.days[key]) cur = writeDay(cur.schedule, cur.edits, key, null);
    if(want) cur = writeDay(cur.schedule, cur.edits, key, want);
  }
  return { schedule: bump(cur.schedule, { ...cur.edits, undo: null }), error: null };
}

// ── Candidates ──────────────────────────────────────────────────────────
function kitOf(availableEquipment){
  if(!Array.isArray(availableEquipment) || !availableEquipment.length) return null;
  return [...new Set([...availableEquipment, 'bodyweight'])];
}

// Ranked swap alternatives for one slot: the same scorer the in-session swap
// uses (muscle, movement pattern, logged history, liked), filtered to the
// user's kit, never an avoided or deprecated movement, never one already in
// the day.
export function swapCandidates(schedule, key, index, { availableEquipment = null, history = [], preferredExerciseIds = [], dislikedExerciseIds = [], limit = 8 } = {}){
  const day = currentDay(schedule, key);
  const block = day?.blocks?.[index];
  if(!block) return [];
  const inDay = new Set(day.blocks.map(b=> b.exerciseId));
  const liked = new Set(preferredExerciseIds || []);
  const options = substitutionOptions(block.exerciseId, {
    availableEquipment: kitOf(availableEquipment),
    history,
    limit: limit + inDay.size + 8,
    preferredExerciseIds,
    dislikedExerciseIds,
  });
  const out = options
    .filter(ex=> !inDay.has(ex.id) && !isDeprecated(ex))
    .map(ex=> ({ id: ex.id, name: ex.name, muscle: ex.muscle, equipment: ex.equipment || [], reason: ex.reason, score: ex.score, liked: liked.has(ex.id), original: ex.id === block.swappedFrom }));
  // The slot's original exercise is always offered first when it was swapped
  // out, so "swap back" is one tap (and keeps its history).
  if(block.swappedFrom && !inDay.has(block.swappedFrom) && !out.some(o=> o.original) && EXERCISE_BY_ID[block.swappedFrom]){
    const ex = EXERCISE_BY_ID[block.swappedFrom];
    out.unshift({ id: ex.id, name: ex.name, muscle: ex.muscle, equipment: ex.equipment || [], reason: 'the programme’s original pick', score: Infinity, liked: liked.has(ex.id), original: true });
  }
  out.sort((a, b)=> Number(b.original) - Number(a.original));
  return out.slice(0, limit);
}

// Searchable list for "Add exercise": kit-filtered, avoided and deprecated
// movements removed, nothing already in the day, liked ones first.
export function addCandidates(schedule, key, { query = '', availableEquipment = null, preferredExerciseIds = [], dislikedExerciseIds = [], limit = 30 } = {}){
  const inDay = new Set((currentDay(schedule, key)?.blocks || []).map(b=> b.exerciseId));
  const kit = kitOf(availableEquipment);
  const has = kit && new Set(kit);
  const avoid = new Set(dislikedExerciseIds || []);
  const liked = new Set(preferredExerciseIds || []);
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return EXERCISES
    .filter(ex=> !inDay.has(ex.id) && !avoid.has(ex.id) && !isDeprecated(ex) && (!has || exerciseFitsEquipment(ex, has))
      && words.every(w=> `${ex.name} ${ex.muscle} ${(ex.equipment || []).join(' ')} ${ex.id}`.toLowerCase().includes(w)))
    .map(ex=> ({ id: ex.id, name: ex.name, muscle: ex.muscle, equipment: ex.equipment || [], liked: liked.has(ex.id) }))
    .sort((a, b)=> b.liked - a.liked || a.name.localeCompare(b.name))
    .slice(0, limit);
}
