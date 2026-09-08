// trainRecommendation.js — the Train screen's recommendation-first hero.
//
// Pure presentation-layer helper: it does NOT recommend anything itself. It
// wraps the existing deterministic engine (recommendTemplate, the same one
// generateProgramme uses) and formats its output plus the user's real profile
// into the card the top of Train renders. Starting the recommendation goes
// through the exact same generateProgramme path the old "Generate from
// profile" button used.
//
// Explanation integrity ("a coach that shows its work"): the card NEVER
// implies an input influenced programme ranking when it did not.
//   - selectionInputs  — exactly the four factors recommendTemplate() scores
//     on (goal, equipment, level, days-per-week). Nothing else may appear.
//   - adaptationInputs — things generateProgramme()/scheduling use when
//     BUILDING sessions (history, preferred duration), shown in a separate
//     "used when building sessions" group, never as ranking claims.
// Duration is MEASURED from the recommended programme's blocks via
// blockDurationMinutes (the same utility Today's estimate uses) — the
// onboarding preferred length is labelled as a preference, never displayed
// as the programme's estimated duration.

import { recommendTemplate } from './templates.js';
import { GOALS, PROGRAM_BY_ID } from './data.js';
import { blockDurationMinutes } from './programming.js';

function goalLabel(goalId){
  return GOALS.find(g => g.id === goalId)?.label || goalId || 'General fitness';
}

/** Preferred length label — explicitly a preference, never a measurement. */
function preferredLengthLabel(availableMinutes){
  if(availableMinutes == null) return null;
  const minutes = Number(availableMinutes);
  if(!Number.isFinite(minutes) || minutes <= 0) return null;
  return `${minutes} min`;
}

/** Measured duration from the programme's own blocks (sets × time + rest). */
function measuredSessionMinutes(program){
  const workouts = (program?.weeks || [])[0]?.workouts || [];
  if(!workouts.length) return null;
  const perWorkout = workouts.map(workout=>
    Math.max(1, Math.ceil((workout.blocks || []).reduce((sum, block)=> sum + blockDurationMinutes(block), 0)))
  );
  const total = perWorkout.reduce((a, b)=> a + b, 0);
  const avg = Math.round(total / perWorkout.length);
  return avg > 0 ? avg : null;
}

/**
 * Build the Train hero recommendation from the profile.
 * Returns null when there is no profile (nothing to recommend from).
 */
export function trainRecommendation({ onboarding = null, customTemplates = [], history = [] } = {}){
  if(!onboarding) return null;

  // ── The ONLY inputs that reach the ranking engine ────────────────────
  const equipment = onboarding.equipment || [];
  const level = onboarding.level || 'Beginner';
  const goal = onboarding.goal || 'general';
  const days = onboarding.daysPerWeek || null;
  const minutes = onboarding.availableMinutes ?? null;

  const recommendation = recommendTemplate({
    goal,
    level,
    availableEquipment: equipment,
    daysPerWeek: days,
    extraTemplates: (customTemplates || []).filter(t => t && !t.deletedAt),
  });
  const top = recommendation.top;
  if(!top) return null;
  // recommendTemplate ranks raw template rows: built-ins carry programId,
  // customs carry the embedded program. Resolve program metadata either way.
  const program = top.isCustom ? top.program : PROGRAM_BY_ID[top.programId];
  if(!program) return null;

  // Factors that actually chose this programme — the exact arguments the
  // scorer received. Anything else (history, preferred minutes) must never
  // appear in this list.
  const selectionInputs = [
    { id: 'goal', label: 'Goal', value: goalLabel(goal) },
    { id: 'equipment', label: 'Available equipment', value: equipment.length ? [...new Set([...equipment])].join(', ') : 'bodyweight only' },
    { id: 'level', label: 'Training level', value: level },
    { id: 'days', label: 'Available days', value: days ? `${days}×/week` : 'flexible' },
  ];

  // Inputs that shape the sessions AFTER the programme is chosen — shown
  // separately so the user can audit what chose vs what adapts.
  const adaptationInputs = [];
  if(history?.length){
    adaptationInputs.push({ id: 'history', label: 'Training history', value: `${history.length} logged session${history.length === 1 ? '' : 's'} prefill loads and rest presets` });
  }
  const preferred = preferredLengthLabel(minutes);
  if(preferred){
    adaptationInputs.push({ id: 'minutes', label: 'Preferred session length', value: `${preferred} — sessions are capped to fit` });
  }
  // Equipment substitutions are part of session building, not ranking: the
  // engine's own reasons already state how kit coverage scored.
  const kitMissing = (top.reasons || []).some(r => /kit you don.t have|swap/i.test(r));
  if(kitMissing){
    adaptationInputs.push({ id: 'substitutions', label: 'Equipment substitutions', value: 'exercises your kit can’t support are swapped when sessions are built' });
  }

  const estimatedMinutes = measuredSessionMinutes(program);
  const cappedByPreference = preferred != null && estimatedMinutes != null && estimatedMinutes > Number(minutes);

  return {
    templateId: top.id,
    programId: top.isCustom ? top.id : top.programId,
    isCustom: !!top.isCustom,
    name: program.name || top.name,
    daysPerWeek: program.daysPerWeek || top.daysPerWeek || null,
    level: top.level || program.level || level,
    // Measured from the programme itself; null only when it can't be computed.
    estimatedMinutes,
    // Preferred length is a preference — the card renders it as such.
    preferredLengthLabel: preferred,
    cappedByPreference,
    // engine reasons — verbatim from the deterministic scorer
    reasons: top.reasons || [],
    selectionInputs,
    adaptationInputs,
    score: top.score,
    // Carried so the caller can route Start through the exact same
    // generateProgramme path (id + days metadata is all it needs).
    template: top,
  };
}
