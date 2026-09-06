// exerciseTaxonomy.js — derived classification for the exercise library.
//
// 350 hand-curated entries already carry muscle/equipment/tags/level; this
// module derives the *training-science* dimensions on top of that structure,
// deterministically and with full coverage:
//
//   patternFor(id)        → movement pattern (substitutions.js curated map
//                           wins; name/muscle/tag rules fill the rest)
//   stabilityDemandFor()  → high | moderate | low   (balance + trunk demand)
//   fatigueCostFor()      → high | moderate | low   (systemic cost per set)
//   jointStressFor()      → high | moderate | low   (compressive/shear load)
//   alternativesFor()     → grouped alternative views over the substitution
//                           graph (joint-friendly, bodyweight, dumbbell,
//                           machine, cable, barbell, unilateral, assisted)
//   resolveExerciseId()   → follows `supersededBy` deprecation chains
//
// Everything is pure and offline. Curation beats derivation where they
// disagree: any explicit field on the exercise row (pattern overrides live in
// substitutions.js) wins over these rules, and the rules exist so the
// remaining library is never silently unclassified.

import { EXERCISE_BY_ID, EQUIPMENT } from './data.js';
import * as substitutions from './substitutions.js';

// ── Movement pattern derivation ───────────────────────────────────────────
// Ordered fragments: first match wins, so specific beats generic. `key`
// includes id AND lowercased name so aliases/naming variants classify alike.
const PATTERN_RULES = [
  { pattern: 'cardio',          test: (e, k) => e.muscle === 'Cardio' || /swim|skierg|rower|rowing|assault bike/.test(k) },
  { pattern: 'horizontal-push', test: (e, k) => e.muscle === 'Chest' || /push-up|push up/.test(k) },
  { pattern: 'vertical-pull',   test: (e, k) => /pull-up|chin-up|pulldown|active-hang|dead-hang|scapular-pull/.test(k) },
  { pattern: 'conditioning',    test: (e, k) => /burpee|thruster|squat-thrust|mountain-climber|fast-feet|jumping jack|seal jack|star jump/.test(k) },
  { pattern: 'vertical-push',   test: (e, k) => /overhead|pike|handstand|shoulder press/.test(k) || (e.muscle === 'Shoulders' && e.tags.includes('push') && !/lateral|rear|fly|face/.test(k)) },
  { pattern: 'horizontal-push', test: (e, k) => e.muscle === 'Chest' },
  { pattern: 'horizontal-pull', test: (e, k) => (/row|face-pull|rear delt|reverse fly|pull-apart|shrug|y-raise|t-raise|snow-angel/.test(k)) || ((e.muscle === 'Back' || e.muscle === 'Shoulders') && e.tags.includes('pull')) },
  { pattern: 'hip-extension',   test: (e, k) => /hip thrust|glute bridge|kickback|abduction|frog pump|donkey kick|fire hydrant|clamshell|hyperextension|back extension|reverse lunge|curtsy/.test(k) },
  { pattern: 'hinge',           test: (e, k) => /deadlift|good.?morning|swing|pull-through|romanian|rdl|rack.?pull/.test(k) || (e.muscle === 'Glutes' && /hinge|nordic|hamstring/.test(k)) },
  { pattern: 'squat',           test: (e, k) => /squat|leg press|hack|wall sit|sissy|pistol|cossack|skater/.test(k) },
  { pattern: 'lunge',           test: (e, k) => /lunge|step-up|step up|split squat/.test(k) },
  { pattern: 'carry',           test: (e, k) => /carry|suitcase/.test(k) },
  { pattern: 'core-isometric',  test: (e, k) => /plank|hold|wall sit|l-sit|hollow|hang(?! )/.test(k) },
  { pattern: 'core-flexion',    test: (e, k) => /crunch|sit-up|knee raise|leg raise|v-up|toe touch|flutter|heel tap|tuck|russian.?twist/.test(k) },
  { pattern: 'core-control',    test: (e, k) => /dead bug|bird dog|pallof|woodchop|ab ?wheel|rollout|hollow|superman|side.?bend|bear.?crawl|inchworm|dragon|crawl/.test(k) },
  { pattern: 'isolation-arm',   test: (e, k) => e.muscle === 'Arms' },
  { pattern: 'isolation-shoulder', test: (e, k) => e.muscle === 'Shoulders' },
  { pattern: 'isolation-leg',   test: (e, k) => e.muscle === 'Legs' || e.muscle === 'Glutes' },
  { pattern: 'mobility',        test: (e, k) => e.tags.includes('mobility') || /stretch|pose/.test(k) },
];

export function patternFor(exercise){
  const ex = typeof exercise === 'string' ? EXERCISE_BY_ID[exercise] : exercise;
  if(!ex) return null;
  // Namespace access (not a top-level binding) so the substitutions ⇄
  // taxonomy import cycle never touches a not-yet-initialized const.
  const curated = substitutions.MOVEMENT_PATTERNS?.[ex.id];
  if(curated) return curated;
  const key = `${ex.id} ${String(ex.name || '').toLowerCase()}`;
  for(const rule of PATTERN_RULES){
    if(rule.test(ex, key)) return rule.pattern;
  }
  return null;
}

// ── Stability demand ──────────────────────────────────────────────────────
// How much balance/trunk control the exercise demands of the lifter.
// Machines and bench-supported setups remove it; free-weight standing and
// unilateral work create it; gymnastic-style bodyweight maximises it.
const STABILITY_HIGH = /plank|hollow|l-sit|handstand|pistol|dragon|copenhagen|pistol|single.?leg|skater|cossack|wobble|bear/;
export function stabilityDemandFor(exercise){
  const ex = typeof exercise === 'string' ? EXERCISE_BY_ID[exercise] : exercise;
  if(!ex) return null;
  const key = `${ex.id} ${String(ex.name || '').toLowerCase()}`;
  if(STABILITY_HIGH.test(key) || ex.tags.includes('core-stability')) return 'high';
  const eq = ex.equipment;
  const supported = eq.includes('machine') || eq.includes('cable') ||
    (eq.includes('bench') && !/step-up|step up|dip/.test(key)) || eq.includes('bands') === true && !/curl|raise|row|pull/.test(key) === false;
  if(supported && !ex.unilateral) return 'low';
  if(ex.unilateral || eq.includes('bodyweight') || eq.includes('pullup-bar') || eq.includes('kettlebell')) return 'moderate';
  return ex.level === 'Advanced' ? 'high' : 'moderate';
}

// ── Fatigue cost ──────────────────────────────────────────────────────────
// Systemic cost per working set — drives scheduling (what can share a day)
// and substitution scoring (a tired lifter should not swap a squat for
// another max-effort squat).
export function fatigueCostFor(exercise){
  const ex = typeof exercise === 'string' ? EXERCISE_BY_ID[exercise] : exercise;
  if(!ex) return null;
  const key = `${ex.id} ${String(ex.name || '').toLowerCase()}`;
  if(ex.muscle === 'Cardio' || /burpee|thruster|deadlift|squat|swing|clean|snatch/.test(key) && ex.tags.includes('compound')) return 'high';
  if(ex.tags.includes('compound') && ['Legs','Glutes','Back','Chest'].includes(ex.muscle)) {
    return ex.equipment.includes('barbell') ? 'high' : 'moderate';
  }
  if(ex.tags.includes('conditioning')) return 'high';
  if(ex.tags.includes('isolation') || ['Arms','Shoulders'].includes(ex.muscle)) return 'low';
  return 'moderate';
}

// ── Joint stress ──────────────────────────────────────────────────────────
// Approximate compressive/shear/joint loading. Explicit 'low-impact' tags and
// machine/band paths reduce it; explosive and loaded-spine work raise it.
const JOINT_HIGH = /jump|sprint|explosive|plyo|clean|snatch|burpee/;
export function jointStressFor(exercise){
  const ex = typeof exercise === 'string' ? EXERCISE_BY_ID[exercise] : exercise;
  if(!ex) return null;
  const key = `${ex.id} ${String(ex.name || '').toLowerCase()}`;
  if(ex.tags.includes('low-impact')) return 'low';
  if(JOINT_HIGH.test(key) || ex.tags.includes('explosive')) return 'high';
  if(ex.equipment.includes('machine') || ex.equipment.includes('bands')) return 'low';
  if(ex.equipment.includes('barbell') && ex.tags.includes('compound')) return 'moderate';
  return 'moderate';
}

// ── Grouped alternatives ──────────────────────────────────────────────────
// The substitution graph already holds every viable swap; these views slice
// it by what a user actually needs ("my shoulder hurts", "no barbell today").
// Every kind can be empty — the UI renders only non-empty groups.
export const ALTERNATIVE_KINDS = [
  { id: 'joint-friendly', label: 'Joint-friendly', test: (alt, target) => jointStressFor(alt) === 'low' && jointStressFor(target) !== 'low' },
  { id: 'bodyweight',     label: 'Bodyweight',     test: (alt) => alt.equipment.includes('bodyweight') },
  { id: 'dumbbell',       label: 'Dumbbell',       test: (alt) => alt.equipment.includes('dumbbells') },
  { id: 'barbell',        label: 'Barbell',        test: (alt) => alt.equipment.includes('barbell') },
  { id: 'machine',        label: 'Machine',        test: (alt) => alt.equipment.includes('machine') },
  { id: 'cable',          label: 'Cable',          test: (alt) => alt.equipment.includes('cable') },
  { id: 'bands',          label: 'Bands',          test: (alt) => alt.equipment.includes('bands') },
  { id: 'unilateral',     label: 'Unilateral',     test: (alt, target) => (alt.unilateral === true) && !(target.unilateral === true) },
  { id: 'assisted',       label: 'Assisted',       test: (alt) => alt.supportsAssisted === true || /assisted/.test(alt.id) },
];

export function alternativesFor(target, kindId){
  const ex = typeof target === 'string' ? EXERCISE_BY_ID[target] : target;
  if(!ex) return [];
  const kind = ALTERNATIVE_KINDS.find(k => k.id === kindId);
  if(!kind) return [];
  return (ex.substitution || [])
    .map(id => EXERCISE_BY_ID[id])
    .filter(Boolean)
    .filter(alt => kind.test(alt, ex));
}

// Equipment-class summary for display: which alternative equipment families
// the graph actually reaches from this exercise.
export function reachableEquipmentClasses(exercise){
  const ex = typeof exercise === 'string' ? EXERCISE_BY_ID[exercise] : exercise;
  if(!ex) return [];
  const classes = new Set();
  for(const id of ex.substitution || []){
    const alt = EXERCISE_BY_ID[id];
    if(!alt) continue;
    for(const family of ['bodyweight','dumbbells','barbell','machine','cable','bands']){
      if(alt.equipment.includes(family)) classes.add(family);
    }
  }
  return [...classes];
}

// ── Aliases & deprecation ─────────────────────────────────────────────────
// Aliases: alternate display names (history imports, CSV, human memory).
// Deprecation: an exercise row with `supersededBy` still resolves for old
// data but is hidden from browsing/recommendations and its id chains to the
// replacement — one hop or many, cycles are a lint error.
export function aliasesOf(exercise){
  const ex = typeof exercise === 'string' ? EXERCISE_BY_ID[exercise] : exercise;
  if(!ex) return [];
  return Array.isArray(ex.aliases) ? ex.aliases : [];
}

export function isDeprecated(exercise){
  const ex = typeof exercise === 'string' ? EXERCISE_BY_ID[exercise] : exercise;
  return Boolean(ex?.supersededBy);
}

export function resolveExerciseId(id, _seen = new Set()){
  const ex = EXERCISE_BY_ID[id];
  if(!ex || !ex.supersededBy) return id;
  if(_seen.has(id)) return id; // cycle: lint catches it; resolve to input
  _seen.add(id);
  return resolveExerciseId(ex.supersededBy, _seen);
}

// Active library: everything a browser/recommender may show.
export function activeExercises(exercises){
  return (exercises || []).filter(e => !isDeprecated(e));
}

// ── Classification summary (detail view) ──────────────────────────────────
export function classifyExercise(exercise){
  const ex = typeof exercise === 'string' ? EXERCISE_BY_ID[exercise] : exercise;
  if(!ex) return null;
  return {
    pattern: patternFor(ex),
    stability: stabilityDemandFor(ex),
    fatigue: fatigueCostFor(ex),
    jointStress: jointStressFor(ex),
  };
}
