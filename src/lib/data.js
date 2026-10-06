// data.js — single source of truth for Arise.
//
// The bulk data lives beside this file, split by behaviour:
//   data/exercises-primary.js   — the core library, sectioned by muscle
//   data/exercises-coverage.js  — coverage-matrix fills (muscle × equipment)
//   data/programs.js            — built-in programmes + version history
// data.js assembles EXERCISES in the original order and re-exports every
// public name unchanged, so all existing imports keep working.
// Franchise-adjacent terminology has been removed; neutral fitness language only.
// Level and XP derive from observable training behaviour (see xp.js);
// evidence-based metrics live in performance.js.

export const EQUIPMENT = [
  { id: 'bodyweight', label: 'Bodyweight only', icon: '🤸' },
  { id: 'dumbbells', label: 'Dumbbells', icon: '🏋️' },
  { id: 'barbell', label: 'Barbell & rack', icon: '🏗️' },
  { id: 'bands', label: 'Resistance bands', icon: '〰️' },
  { id: 'kettlebell', label: 'Kettlebell', icon: '🔔' },
  { id: 'pullup-bar', label: 'Pull-up bar', icon: '🧱' },
  { id: 'bench', label: 'Bench', icon: '🪑' },
  { id: 'cable', label: 'Cable machine', icon: '🔗' },
  { id: 'machine', label: 'Machines', icon: '⚙️' },
];

// One-tap equipment profiles for the onboarding kit step. Each preset maps to
// real EQUIPMENT ids (lint-checked) and stays editable afterwards — it fills
// the checkboxes, it does not replace the user's judgment.
export const EQUIPMENT_PRESETS = [
  { id: 'home-starter',   label: 'Home starter',   icon: '🏠', hint: 'Bodyweight + dumbbells', equipment: ['bodyweight', 'dumbbells'] },
  { id: 'home-gym',       label: 'Home gym',       icon: '🛠️', hint: 'Barbell, bench, pull-up bar, dumbbells', equipment: ['bodyweight', 'dumbbells', 'barbell', 'bench', 'pullup-bar'] },
  { id: 'bodyweight-only',label: 'Bodyweight only',icon: '🤸', hint: 'No equipment at all', equipment: ['bodyweight'] },
  { id: 'barbell-only',   label: 'Barbell only',   icon: '🏗️', hint: 'Barbell & rack, no bench', equipment: ['bodyweight', 'barbell'] },
  { id: 'dumbbell-only',  label: 'Dumbbells only', icon: '🏋️', hint: 'A pair of adjustable dumbbells', equipment: ['bodyweight', 'dumbbells'] },
  { id: 'machine-floor',  label: 'Machine floor',  icon: '⚙️', hint: 'Machines + cables, minimal free weight', equipment: ['bodyweight', 'machine', 'cable'] },
  { id: 'full-gym',       label: 'Full gym',       icon: '🏢', hint: 'Everything: racks, cables, machines, bench', equipment: ['bodyweight', 'dumbbells', 'barbell', 'bench', 'pullup-bar', 'cable', 'machine', 'kettlebell'] },
];

export const LOCATIONS = [
  { id: 'home', label: 'Home', hint: 'No commute, minimal kit' },
  { id: 'gym', label: 'Gym', hint: 'Full equipment access' },
  { id: 'outdoor', label: 'Outdoors', hint: 'Park, track, street' },
  { id: 'limited', label: 'Small space / travel', hint: 'Hotel room, tight flat' },
];

export const MUSCLES = ['Chest','Back','Legs','Glutes','Shoulders','Arms','Core','Full body','Cardio'];
export const LEVELS = ['Beginner','Intermediate','Advanced'];
export const GOALS = [
  { id: 'strength', label: 'Get stronger', hint: 'Progressive overload, heavier lifts' },
  { id: 'muscle', label: 'Build muscle', hint: 'Volume + hypertrophy' },
  { id: 'endurance', label: 'Move longer', hint: 'Conditioning & stamina' },
  { id: 'fat-loss', label: 'Lean out', hint: 'Consistency + conditioning' },
  { id: 'general', label: 'Feel better', hint: 'Balanced, sustainable' },
];

// User-facing tag vocabulary for browsing/filtering. Orthogonal to muscle,
// equipment and level: structure (compound/isolation), direction (push/pull),
// character (explosive/conditioning/core-stability) and joint load (low-impact).
export const EXERCISE_TAGS = [
  { id: 'compound', label: 'Compound' },
  { id: 'isolation', label: 'Isolation' },
  { id: 'unilateral', label: 'Unilateral' },
  { id: 'push', label: 'Push' },
  { id: 'pull', label: 'Pull' },
  { id: 'explosive', label: 'Explosive' },
  { id: 'conditioning', label: 'Conditioning' },
  { id: 'core-stability', label: 'Core stability' },
  { id: 'low-impact', label: 'Low impact' },
  { id: 'grip', label: 'Grip' },
  { id: 'mobility', label: 'Mobility' },
];
export const EXERCISE_TAG_IDS = EXERCISE_TAGS.map(t => t.id);

// Hand-curated exercise library. Each entry declares equipment so onboarding can
// gate recommendations honestly, and tags so the browser can slice by intent.
// Substitution edges must stay reciprocal (A lists B ⇒ B lists A) — enforced by validateContent().
import { EXERCISES_PRIMARY } from './data/exercises-primary.js';
import { EXERCISES_COVERAGE } from './data/exercises-coverage.js';
import { PROGRAMS as BUILTIN_PROGRAMS, PROGRAM_VERSION_HISTORY as BUILTIN_PROGRAM_VERSION_HISTORY } from './data/programs.js';
export const EXERCISES = [
  ...EXERCISES_PRIMARY,
  ...EXERCISES_COVERAGE,
];

export const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map(e => [e.id, e]));

// Equipment class for segmentation (free weights / machines / cables / bodyweight)
// — from the exercise's declared kit. Lives here so the study and ledger
// modules can share it without an import cycle.
export function equipmentClassFor(exerciseId){
  const ex = EXERCISE_BY_ID[exerciseId];
  if(!ex) return 'unknown';
  const equipment = ex.equipment || [];
  if(equipment.includes('machine')) return 'machines';
  if(equipment.includes('cable')) return 'cables';
  if(equipment.some(eq=> ['barbell', 'dumbbells', 'kettlebell'].includes(eq))) return 'free-weights';
  if(equipment.length === 1 && equipment[0] === 'bodyweight') return 'bodyweight';
  return 'other';
}

// Programme templates — reusable blueprints that can be instantiated with different start dates / tweaks.
// level/goal/daysPerWeek drive template recommendation; version drives template versioning.
export const PROGRAM_TEMPLATES = [
  { id: 'tpl-starter', programId: 'starter-3x', name: 'Starter Template', description: '3× full-body, minimal kit — good default for most users.', level: 'Beginner', goal: 'general', daysPerWeek: 3, version: 1 },
  { id: 'tpl-strength', programId: 'strength-4x', name: 'Strength Template', description: 'Upper/lower 4×, heavier compounds first.', level: 'Intermediate', goal: 'strength', daysPerWeek: 4, version: 1 },
  { id: 'tpl-anywhere', programId: 'move-anywhere', name: 'Anywhere Template', description: 'Bodyweight + bands only.', level: 'Beginner', goal: 'endurance', daysPerWeek: 3, version: 1 },
  { id: 'tpl-gym-full', programId: 'gym-full-4x', name: 'Full Gym Split', description: '4× upper/lower on machines, cables and free weights — full-kit gyms.', level: 'Intermediate', goal: 'muscle', daysPerWeek: 4, version: 1 },
  { id: 'tpl-home-db', programId: 'home-dumbbell-3x', name: 'Home Dumbbell Builder', description: '3× full-body around a dumbbell pair and bench.', level: 'Beginner', goal: 'muscle', daysPerWeek: 3, version: 1 },
];

// Template version history (append-only). Program-level versions live in PROGRAM_VERSION_HISTORY.
export const TEMPLATE_VERSION_HISTORY = [
  { templateId: 'tpl-starter', version: 1, date: '2026-08-13', changes: 'Template engine: equipment-aware instantiation with substitution, profile-based recommendation.' },
  { templateId: 'tpl-strength', version: 1, date: '2026-08-13', changes: 'Template engine: equipment-aware instantiation with substitution, profile-based recommendation.' },
  { templateId: 'tpl-anywhere', version: 1, date: '2026-08-13', changes: 'Template engine: equipment-aware instantiation with substitution, profile-based recommendation.' },
];

export function templateHistory(templateId){
  return TEMPLATE_VERSION_HISTORY.filter(h=> h.templateId===templateId).sort((a,b)=> a.version - b.version);
}

export function searchExercises({ q = '', muscle = '', equipment = '', level = '', tag = '', availableEquipment = null }) {
  const qq = q.trim().toLowerCase();
  const tagList = Array.isArray(tag) ? tag : (tag ? [tag] : []);
  return EXERCISES.filter(e => {
    // Query matches name, id, muscle — or any registered alias, so a user
    // typing what they call the lift still finds it.
    if (qq && !(e.name.toLowerCase().includes(qq) || e.muscle.toLowerCase().includes(qq) || e.id.includes(qq) || (e.aliases || []).some(a => a.toLowerCase().includes(qq)))) return false;
    if (muscle && e.muscle !== muscle) return false;
    if (level && e.level !== level) return false;
    // AND semantics: every selected tag must be present (chips narrow the set).
    if (tagList.length && !tagList.every(t => (e.tags || []).includes(t))) return false;
    if (equipment) {
      if (!e.equipment.includes(equipment)) return false;
    }
    if (availableEquipment && availableEquipment.length) {
      const has = new Set(availableEquipment);
      const doable = e.equipment.every(eq => has.has(eq));
      const bodyOnly = e.equipment.length === 1 && e.equipment[0] === 'bodyweight';
      if (!doable && !bodyOnly) return false;
    }
    return true;
  });
}

export function recommendExercises({ goal, availableEquipment, limit = 8 }) {
  let pool = searchExercises({ availableEquipment });
  const bias = {
    strength: ['Legs','Back','Chest','Shoulders'],
    muscle: ['Chest','Back','Legs','Glutes','Shoulders','Arms'],
    endurance: ['Cardio','Full body','Legs','Core'],
    'fat-loss': ['Full body','Cardio','Legs','Core'],
    general: MUSCLES,
  }[goal] || MUSCLES;
  pool.sort((a,b) => bias.indexOf(a.muscle) - bias.indexOf(b.muscle));
  const minimal = !availableEquipment || availableEquipment.length <= 2;
  if (minimal) pool.sort((a,b) => (a.level === 'Beginner' ? -1 : 1));
  return pool.slice(0, limit);
}

// Programmes are scheduled training: each program has weeks → workouts → blocks.
export const PROGRAMS = BUILTIN_PROGRAMS;
export const PROGRAM_VERSION_HISTORY = BUILTIN_PROGRAM_VERSION_HISTORY;

export function programHistory(programId){
  return PROGRAM_VERSION_HISTORY.filter(h=> h.programId===programId).sort((a,b)=> a.version - b.version);
}

// Equipment constraints: can this exercise be performed with the user's kit?
// Most rows list every required implement. equipmentAny marks the rare
// either/or rows where any listed implement is sufficient.
export function exerciseFitsEquipment(ex, availableEquipment){
  if(!ex) return false;
  if(!availableEquipment || availableEquipment.length===0) return true;
  const has = availableEquipment instanceof Set ? availableEquipment : new Set(availableEquipment);
  const equipment = ex.equipment || [];
  if(!equipment.length) return true;
  const owns = eq => eq === 'bodyweight' || has.has(eq);
  return ex.equipmentAny ? equipment.some(owns) : equipment.every(owns);
}
export function exerciseAvailable(exerciseId, availableEquipment){
  return exerciseFitsEquipment(EXERCISE_BY_ID[exerciseId], availableEquipment);
}

// Filter programs to those actually doable with user's equipment.
export function availablePrograms(availableEquipment) {
  if (!availableEquipment || !availableEquipment.length) return PROGRAMS;
  const has = new Set(availableEquipment);
  return PROGRAMS.filter(p => p.equipment.every(eq => has.has(eq) || eq === 'bodyweight'));
}

// Schedule helpers: turn a program into dated sessions so "programs = scheduled training".
// A caller may pass `program` directly (custom/user templates that live outside
// PROGRAMS); it must follow the same shape (id, weeks, mesocycle, version).
export function scheduleProgram({ programId, startDateISO, program = null }) {
  const prog = program || PROGRAM_BY_ID[programId];
  if (!prog) throw new Error(`Unknown program ${programId}`);
  // Use UTC date arithmetic so a schedule never shifts by a day on devices
  // west of UTC (the ISO date is a calendar date, not a local timestamp).
  const start = new Date(startDateISO + 'T00:00:00Z');
  const sessions = [];
  let cursor = new Date(start);
    for (const wk of prog.weeks) {
    for (const w of wk.workouts) {
      sessions.push({
        id: `${programId}-w${wk.week}-d${w.day}`,
        programId,
        week: wk.week,
        day: w.day,
        title: w.title,
        dateISO: toISO(cursor),
        blocks: w.blocks.map(b=> ({ ...b, version: prog.version || 1 })),
        status: 'planned',
      });
      cursor.setUTCDate(cursor.getUTCDate() + 2);
    }
    const nextWeekStart = new Date(start);
    nextWeekStart.setUTCDate(start.getUTCDate() + wk.week * 7);
    if (cursor < nextWeekStart) cursor = nextWeekStart;
  }
  // Explicit revision metadata: sync converges on newest updatedAt, then
  // highest rev — recency is never inferred from nested session content.
  return { programId, startDateISO, sessions, programVersion: prog.version || 1, rev: 1, updatedAt: new Date().toISOString() };
}

// Planned vs completed comparison
export function plannedVsCompleted(schedule, history){
  const byId = new Map((history||[]).map(h=> [h.id, h]));
  return (schedule?.sessions||[]).map(s=>{
    const actual = byId.get(s.id) || null;
    if(!actual) return { session: s, status: s.status, completed: false, delta: null };
    const plannedSets = s.blocks.reduce((a,b)=> a + (Number(b.sets)||0), 0);
    const actualSets = (actual.blocks||[]).reduce((a,b)=> a + (b.sets||[]).length, 0);
    // Planned volume is only computable when the hint states an explicit load
    // ("20kg"). Parsing any digit out of prose ("leave 2 in tank") produced noise.
    const plannedVol = s.blocks.reduce((a,b)=>{
      const kg = Number(String(b.loadHint||'').match(/(\d+(?:\.\d+)?)\s*kg/i)?.[1]);
      const reps = Number(String(b.reps).match(/\d+/)?.[0]||0)||0;
      return a + (Number.isFinite(kg) ? reps*kg : 0);
    }, 0);
    const hasPlannedLoad = s.blocks.some(b=> /(\d+(?:\.\d+)?)\s*kg/i.test(String(b.loadHint||'')));
    const actualVol = (actual.blocks||[]).reduce((a,b)=> a + b.sets.reduce((x,s)=> x + (Number(s.reps)||0)*(Number(s.weightKg)||0),0),0);
    return { session: s, status: 'done', completed: true, actual, delta: { sets: actualSets - plannedSets, volumeKg: hasPlannedLoad ? Math.round(actualVol - plannedVol) : null } };
  });
}

// Format the local calendar date instead of slicing toISOString(). The latter
// can move a midnight schedule back one day on devices west of UTC.
function toISO(d){
  const pad = value=> String(value).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}

// Simple content validation used by scripts/lint-content.mjs
export function validateContent(){
  const errors=[];
  const ids = new Set();
  const names = new Map();
  for(const e of EXERCISES){
    if(ids.has(e.id)) errors.push(`Duplicate exercise id ${e.id}`);
    ids.add(e.id);
    // Display names must be unique: the browser, swap UI and history views all
    // identify exercises by name, and duplicate names fragment PR history.
    if(names.has(e.name)) errors.push(`Duplicate exercise name "${e.name}" (${e.id} and ${names.get(e.name)})`);
    names.set(e.name, e.id);
    if(!MUSCLES.includes(e.muscle)) errors.push(`Exercise ${e.id} has unknown muscle ${e.muscle}`);
    if(!LEVELS.includes(e.level)) errors.push(`Exercise ${e.id} has unknown level ${e.level}`);
    if(!Array.isArray(e.tags) || e.tags.length===0) errors.push(`Exercise ${e.id} declares no tags — every exercise needs at least one browsing tag`);
    else for(const tag of e.tags){
      if(!EXERCISE_TAG_IDS.includes(tag)) errors.push(`Exercise ${e.id} has unknown tag "${tag}"`);
    }
    for(const eq of e.equipment){
      if(!EQUIPMENT.some(x=>x.id===eq)) errors.push(`Exercise ${e.id} has unknown equipment ${eq}`);
    }
    if(e.videoUrl && !/^https:\/\//.test(e.videoUrl)) errors.push(`Exercise ${e.id} has non-https videoUrl`);
    if(!Array.isArray(e.substitution) || e.substitution.length===0) errors.push(`Exercise ${e.id} declares no substitutions — every exercise needs an alternative chain`);
    // Aliases: alternate display names for search/history imports. They must
    // be non-empty strings and must not collide with a real exercise name
    // (a colliding alias makes name→id resolution ambiguous).
    if(e.aliases !== undefined){
      if(!Array.isArray(e.aliases) || e.aliases.some(a => typeof a !== 'string' || !a.trim())) errors.push(`Exercise ${e.id} has a malformed aliases array`);
      else for(const alias of e.aliases){ if(names.has(alias)) errors.push(`Alias "${alias}" on ${e.id} collides with the name of ${names.get(alias)}`); }
    }
    // Instruction and mistake lists: optional but strictly shaped — the
    // detail view renders them as sentences, so free-form junk would show.
    for(const [field, min] of [['instructions', 2], ['mistakes', 1]]){
      if(e[field] !== undefined){
        if(!Array.isArray(e[field]) || e[field].length < min || e[field].some(s => typeof s !== 'string' || s.trim().length < 8)){
          errors.push(`Exercise ${e.id} has a malformed ${field} array (need ${min}+ meaningful sentences)`);
        }
      }
    }
    // Deprecation: supersededBy must point at a DIFFERENT, existing, active
    // exercise; chains must terminate (a cycle would make resolveExerciseId
    // loop) and deprecated rows must stay out of program definitions.
    if(e.supersededBy !== undefined){
      if(e.supersededBy === e.id) errors.push(`Exercise ${e.id} supersedes itself`);
      else if(!EXERCISE_BY_ID[e.supersededBy]) errors.push(`Exercise ${e.id} supersededBy unknown exercise ${e.supersededBy}`);
      else if(EXERCISE_BY_ID[e.supersededBy].supersededBy === e.id) errors.push(`Deprecation cycle: ${e.id} ↔ ${e.supersededBy}`);
    }
  }
  // Substitution graph integrity: every target must exist, and the relation is
  // reciprocal (A lists B ⇒ B lists A). A dangling or one-way edge silently
  // degrades the swap UI and generated-programme fallbacks.
  for(const e of EXERCISES){
    for(const targetId of e.substitution||[]){
      const target = EXERCISE_BY_ID[targetId];
      if(!target){ errors.push(`Exercise ${e.id} substitutes unknown exercise ${targetId}`); continue; }
      if(!(target.substitution||[]).includes(e.id)) errors.push(`Substitution not reciprocal: ${e.id} → ${targetId}, but ${targetId} does not list ${e.id}`);
      // Note: edges deliberately span equipment families ("no kit? use the
      // machine version") — cross-equipment edges are the point of the graph;
      // availability is filtered per-user at ranking time, so requiring the
      // target's kit to overlap the source's would be wrong here.
    }
  }
  // Equipment presets must reference real EQUIPMENT ids — a typo in a preset
  // silently deselects half the library at onboarding.
  for(const preset of EQUIPMENT_PRESETS){
    for(const eq of preset.equipment){
      if(!EQUIPMENT.some(x => x.id === eq)) errors.push(`Equipment preset ${preset.id} references unknown equipment ${eq}`);
    }
    if(!preset.equipment.includes('bodyweight')) errors.push(`Equipment preset ${preset.id} does not include bodyweight`);
  }
  for(const p of PROGRAMS){
    for(const w of p.weeks) for(const wk of w.workouts) for(const b of wk.blocks){
      if(!EXERCISE_BY_ID[b.exerciseId]) errors.push(`Program ${p.id} references unknown exercise ${b.exerciseId}`);
      else if(EXERCISE_BY_ID[b.exerciseId].supersededBy) errors.push(`Program ${p.id} schedules deprecated exercise ${b.exerciseId} — use ${EXERCISE_BY_ID[b.exerciseId].supersededBy}`);
    }
  }
  for(const t of PROGRAM_TEMPLATES){
    if(!PROGRAM_BY_ID[t.programId]) errors.push(`Template ${t.id} references unknown program ${t.programId}`);
    if(!LEVELS.includes(t.level)) errors.push(`Template ${t.id} has unknown level ${t.level}`);
    if(!GOALS.some(g=> g.id===t.goal)) errors.push(`Template ${t.id} has unknown goal ${t.goal}`);
  }
  return errors;
}

// Soft findings: the substitution graph should give every exercise at least
// one fallback doable with the exercise's OWN equipment (+ bodyweight). Rows
// flagged here still work — rankedSubstitutions falls back to the wider pool
// — but a user owning exactly that kit gets cross-equipment suggestions that
// may be useless to them. Genuinely missing edges are added over time; this
// list is the work queue, exported separately so it never blocks CI.
export function validateContentWarnings(){
  const warnings = [];
  for(const e of EXERCISES){
    const reachable = (e.substitution||[]).some(id => {
      const t = EXERCISE_BY_ID[id];
      return t && t.equipment.every(eq => eq === 'bodyweight' || (e.equipment||[]).includes(eq));
    });
    if(!reachable) warnings.push(`Exercise ${e.id} has no substitution reachable with its own equipment`);
  }
  return warnings;
}

export const PROGRAM_BY_ID = Object.fromEntries(PROGRAMS.map(p => [p.id, p]));
