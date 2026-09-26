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
// Duration is MEASURED by previewing the actual generation path
// (generateProgramme with the same inputs Start uses, discarded afterwards) —
// the displayed estimate is the schedule the user will really get, including
// time caps and substitutions. The onboarding preferred length is labelled
// as a preference, never displayed as the programme's estimated duration.

import { recommendTemplate } from './templates.js';
import { GOALS, PROGRAM_BY_ID } from './data.js';
import { blockDurationMinutes } from './programming.js';
import { generateProgramme } from './programmeGenerator.js';
import { localDateISO } from './dateOnly.js';

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

  const extraTemplates = (customTemplates || []).filter(t => t && !t.deletedAt);
  const recommendation = recommendTemplate({
    goal,
    level,
    availableEquipment: equipment,
    daysPerWeek: days,
    extraTemplates,
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
    adaptationInputs.push({ id: 'history', label: 'Training history', value: `${history.length} logged session${history.length === 1 ? '' : 's'} inform substitution ranking when sessions are built` });
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

  // Preview the ACTUAL schedule Start will build: same engine, same inputs,
  // discarded immediately. The displayed duration, day count and swaps are
  // then the truth, not an estimate from the raw template.
  let preview = null;
  try{
    preview = generateProgramme({
      ...onboarding,
      availableEquipment: equipment,
      history,
      customTemplates,
      startDateISO: localDateISO(),
    });
  }catch{ /* preview is best-effort; the card falls back to template measurement */ }

  // Per-session duration: capped sessions carry estimatedDurationMin; uncapped
  // ones are measured from their blocks — the same utility Today uses.
  const sessionMinutes = session => session.estimatedDurationMin != null
    ? session.estimatedDurationMin
    : Math.max(1, Math.ceil((session.blocks || []).reduce((sum, block)=> sum + blockDurationMinutes(block), 0)));
  const estimatedMinutes = preview && preview.sessions.length
    ? Math.round(preview.sessions.reduce((sum, s)=> sum + sessionMinutes(s), 0) / preview.sessions.length)
    : measuredSessionMinutes(program);
  const previewedSubstitutions = preview?.substitutions || [];
  const previewedWarnings = preview?.generationWarnings || [];
  // "Capped" is honest only when the schedule we would have built WITHOUT a
  // cap is longer than the preference — the post-cap estimate can never
  // exceed it, so compare against the preview's own original durations.
  const uncappedAverage = preview && preview.sessions.length
    ? Math.round(preview.sessions.reduce((sum, s)=> sum + (s.originalDurationMin != null
        ? s.originalDurationMin
        : sessionMinutes(s)), 0) / preview.sessions.length)
    : null;
  const cappedByPreference = preferred != null && uncappedAverage != null && uncappedAverage > Number(minutes);
  const previewedDaysPerWeek = preview
    ? new Set(preview.sessions.map(s => s.week)).size > 0
      ? Math.max(...Object.values(preview.sessions.reduce((acc, s)=> { acc[s.week] = (acc[s.week] || 0) + 1; return acc; }, {})))
      : null
    : null;

  return {
    templateId: top.id,
    programId: top.isCustom ? top.id : top.programId,
    isCustom: !!top.isCustom,
    name: program.name || top.name,
    daysPerWeek: previewedDaysPerWeek || program.daysPerWeek || top.daysPerWeek || null,
    level: top.level || program.level || level,
    // Measured from the actual generated schedule (post-cap, post-swap).
    estimatedMinutes,
    // Preferred length is a preference — the card renders it as such.
    preferredLengthLabel: preferred,
    cappedByPreference,
    // Real substitutions/warnings from the previewed schedule, if any.
    substitutionCount: previewedSubstitutions.length,
    warningCount: previewedWarnings.length,
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
