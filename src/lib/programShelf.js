// programShelf.js — the first-run programme shelf on Train.
//
// Boostcamp-style shortlist under Arise rules: at most 5 generated or curated
// templates that SURVIVE the user's kit, with every required swap visible
// BEFORE start. Ranked by the existing deterministic scorer (recommendTemplate);
// the swap preview is the scheduler's own engine (applyEquipmentSubstitutions),
// so what the card shows is exactly what Start will build — preview and reality
// cannot drift.
//
// Shelf rules:
//   - Empty kit is bodyweight kit: normalised to ['bodyweight'] so the swap
//     engine actually runs (it must never see an empty array and skip swaps).
//   - Empty kit is never marketed a barbell lift: a programme whose own
//     declaration includes barbell is dropped from the shelf entirely (it
//     stays findable in Browse with its honest "Needs:" badge).
//   - A template with a post-swap dead-end exercise (no honest substitute for
//     the kit — e.g. the known battle-ropes hole) is excluded, not faked.
//   - Custom templates compete on the same terms; their swaps show too.
// Pure + deterministic; no network.

import { recommendTemplate, applyEquipmentSubstitutions, equipmentCoverage } from './templates.js';
import { PROGRAM_BY_ID, scheduleProgram, exerciseAvailable } from './data.js';
import { blockDurationMinutes } from './programming.js';

function kitWithBodyweight(availableEquipment){
  const raw = Array.isArray(availableEquipment) ? availableEquipment : [];
  const kit = raw.length ? [...new Set(raw)] : ['bodyweight'];
  if(!kit.includes('bodyweight')) kit.push('bodyweight');
  return kit;
}

// Average per-session minutes measured from the programme's own blocks — the
// same measurement Train's preview uses (blockDurationMinutes), no guessing.
function measuredSessionMinutes(program){
  const workouts = (program?.weeks || [])[0]?.workouts || [];
  if(!workouts.length) return null;
  const perWorkout = workouts.map(workout=>
    Math.max(1, Math.ceil((workout.blocks || []).reduce((sum, block)=> sum + blockDurationMinutes(block), 0)))
  );
  const avg = Math.round(perWorkout.reduce((a, b)=> a + b, 0) / perWorkout.length);
  return avg > 0 ? avg : null;
}

export function programShelf({ onboarding = null, customTemplates = [], history = [], availableEquipment = [], limit = 5 } = {}){
  if(!onboarding) return null;
  const kit = kitWithBodyweight(availableEquipment);
  const emptyKit = !kit.some(eq=> eq !== 'bodyweight');
  const liveCustoms = (Array.isArray(customTemplates) ? customTemplates : []).filter(t=> t && !t.deletedAt && t.program);

  const { ranked } = recommendTemplate({
    goal:onboarding.goal || 'general',
    level:onboarding.level || 'Beginner',
    availableEquipment:kit,
    daysPerWeek:onboarding.daysPerWeek || null,
    extraTemplates:liveCustoms,
  });

  const items = [];
  for(const template of ranked){
    if(items.length >= limit) break;
    const program = template.isCustom ? template.program : PROGRAM_BY_ID[template.programId];
    if(!program?.weeks?.length) continue;
    // Empty kit never gets a barbell programme marketed as a pick.
    if(emptyKit && (program.equipment || []).includes('barbell')) continue;

    // Preview the schedule Start would build: same scheduler, same swaps.
    let swaps = [];
    let deadEnds = 0;
    try{
      const base = scheduleProgram({
        programId:template.isCustom ? template.id : template.programId,
        startDateISO:'2026-01-01',
        program:template.isCustom ? program : null,
      });
      const { sessions, substitutions } = applyEquipmentSubstitutions(base.sessions, kit, history || []);
      swaps = substitutions || [];
      for(const s of sessions){
        for(const b of s.blocks || []){
          if(!exerciseAvailable(b.exerciseId, kit)) deadEnds += 1;
        }
      }
    }catch{
      // An unpreviewable template is not shelf material — it cannot keep the
      // "swaps visible before start" promise.
      continue;
    }
    if(deadEnds > 0) continue;

    items.push({
      templateId:template.id,
      programId:template.isCustom ? template.id : template.programId,
      isCustom:!!template.isCustom,
      name:program.name || template.name,
      tagline:program.tagline || template.description || '',
      level:template.level || program.level || onboarding.level || 'Beginner',
      daysPerWeek:program.daysPerWeek || template.daysPerWeek || null,
      weeks:(program.weeks || []).length,
      mesocycle:program.mesocycle || null,
      estimatedMinutes:measuredSessionMinutes(program),
      coverage:equipmentCoverage(program, kit),
      swaps,
      swapCount:swaps.length,
      reasons:template.reasons || [],
      score:template.score,
    });
  }
  return { items, emptyKit };
}
