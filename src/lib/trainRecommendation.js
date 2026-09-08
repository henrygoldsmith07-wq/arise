// trainRecommendation.js — the Train screen's recommendation-first hero.
//
// Pure presentation-layer helper: it does NOT recommend anything itself. It
// wraps the existing deterministic engine (recommendTemplate, the same one
// generateProgramme uses) and formats its output plus the user's real profile
// into the card the top of Train renders. Starting the recommendation goes
// through the exact same generateProgramme path the old "Generate from
// profile" button used.

import { recommendTemplate } from './templates.js';
import { GOALS, PROGRAM_BY_ID } from './data.js';

function goalLabel(goalId){
  return GOALS.find(g => g.id === goalId)?.label || goalId || 'General fitness';
}

function sessionLengthLabel(availableMinutes){
  if(availableMinutes == null) return null;
  const minutes = Number(availableMinutes);
  if(!Number.isFinite(minutes) || minutes <= 0) return null;
  // Show the honest window around the cap rather than fake precision.
  const low = Math.max(10, Math.floor(minutes * 0.9));
  const high = Math.ceil(minutes * 1.1);
  return low === high ? `${minutes} min` : `${low}–${high} min`;
}

/**
 * Build the Train hero recommendation from the profile.
 * Returns null when there is no profile (nothing to recommend from).
 */
export function trainRecommendation({ onboarding = null, customTemplates = [], history = [] } = {}){
  if(!onboarding) return null;

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
  const lengthLabel = sessionLengthLabel(minutes);

  // The explanation mirrors the real scoring inputs (templates.js):
  // equipment honesty first, then level, goal, and days-per-week fit — plus
  // history when there is any to lean on.
  const factors = [
    { id: 'goal', label: 'Goal', value: goalLabel(goal) },
    { id: 'equipment', label: 'Equipment', value: equipment.length ? [...new Set([...equipment])].join(', ') : 'bodyweight only' },
    { id: 'level', label: 'Training level', value: level },
    { id: 'days', label: 'Available days', value: days ? `${days}×/week` : 'flexible' },
    ...(lengthLabel ? [{ id: 'minutes', label: 'Session length', value: `about ${lengthLabel}` }] : []),
    ...(history?.length ? [{ id: 'history', label: 'Relevant history', value: `${history.length} logged session${history.length === 1 ? '' : 's'} inform the fit` }] : []),
  ];

  return {
    templateId: top.id,
    programId: top.isCustom ? top.id : top.programId,
    isCustom: !!top.isCustom,
    name: program.name || top.name,
    daysPerWeek: program.daysPerWeek || top.daysPerWeek || null,
    level: top.level || program.level || level,
    sessionLength: lengthLabel,
    // engine reasons — verbatim from the deterministic scorer
    reasons: top.reasons || [],
    factors,
    score: top.score,
    // Carried so the caller can route Start through the exact same
    // generateProgramme path (id + days metadata is all it needs).
    template: top,
  };
}
