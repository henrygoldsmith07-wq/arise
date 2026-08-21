// programmeGenerator.js — deterministic profile-to-schedule generation.
// The output is still ordinary Arise schedule data: no opaque coach layer,
// no future history, and every material choice is returned as a reason.

import { EXERCISE_BY_ID, exerciseAvailable } from './data.js';
import { recommendTemplate, instantiateTemplate } from './templates.js';
import { rankedSubstitutions } from './substitutions.js';
import { shortWorkoutMode } from './programming.js';

function dateAt(dateISO){ return new Date(`${dateISO}T00:00:00Z`); }
function toISO(date){
  const pad = value=> String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
}
function addDays(dateISO, days){
  const date = dateAt(dateISO);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}
function fitExercise(exerciseId, kit){
  return !kit || exerciseAvailable(exerciseId, kit);
}
function chooseIndexes(length, desired){
  const count = Math.max(1, Math.min(length, Number(desired) || length));
  if(count >= length) return Array.from({ length }, (_, index)=> index);
  const indexes = [];
  for(let index = 0; index < count; index++){
    const candidate = Math.round(index * (length - 1) / Math.max(1, count - 1));
    if(!indexes.includes(candidate)) indexes.push(candidate);
  }
  for(let index = 0; indexes.length < count && index < length; index++) if(!indexes.includes(index)) indexes.push(index);
  return indexes.sort((a, b)=> a - b);
}

function resampleFrequency(sessions, startDateISO, daysPerWeek){
  const byWeek = new Map();
  for(const session of sessions || []){
    const list = byWeek.get(session.week) || [];
    list.push(session);
    byWeek.set(session.week, list);
  }
  const output = [];
  for(const [week, weekSessions] of byWeek){
    const indexes = chooseIndexes(weekSessions.length, daysPerWeek);
    indexes.forEach((sourceIndex, position)=> {
      const source = weekSessions[sourceIndex];
      const weekNumber = Math.max(1, Number(week) || 1);
      const offset = (weekNumber - 1) * 7 + Math.round(position * 7 / Math.max(1, indexes.length));
      output.push({ ...source, dateISO: addDays(startDateISO, offset), frequencyAdjusted: indexes.length !== weekSessions.length });
    });
  }
  return output.sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
}

function preferenceSubstitutions(sessions, { availableEquipment = null, preferredExerciseIds = [], dislikedExerciseIds = [], history = [] } = {}){
  const preferred = new Set(preferredExerciseIds || []);
  const disliked = new Set(dislikedExerciseIds || []);
  const kit = Array.isArray(availableEquipment)
    ? [...new Set([...availableEquipment, 'bodyweight'])]
    : null;
  const substitutions = [];
  const warnings = [];
  const out = (sessions || []).map(session=> {
    // A constrained kit can collapse several template rows onto the same
    // fallback. Keep each session varied when a viable alternative exists.
    const used = new Set();
    return {
      ...session,
      blocks: (session.blocks || []).map(block=> {
        const duplicate = used.has(block.exerciseId);
        const needsSwap = disliked.has(block.exerciseId) || !fitExercise(block.exerciseId, kit) || duplicate;
        if(!needsSwap){
          used.add(block.exerciseId);
          return block;
        }
        const candidates = rankedSubstitutions(block.exerciseId, kit, 12, history)
          .filter(candidate=> !disliked.has(candidate.id) && !used.has(candidate.id));
        const preferredCandidate = candidates.find(candidate=> preferred.has(candidate.id));
        const candidate = preferredCandidate || candidates[0];
        if(!candidate){
          const source = EXERCISE_BY_ID[block.exerciseId];
          const constraint = disliked.has(block.exerciseId)
            ? 'no non-disliked alternative fits the selected kit'
            : duplicate
              ? 'no unused alternative was available in this session'
              : 'no equipment-compatible alternative was found';
          warnings.push({ sessionId: session.id, exerciseId: block.exerciseId, reason: `Kept ${source?.name || block.exerciseId}: ${constraint}.` });
          used.add(block.exerciseId);
          return block;
        }
        const source = EXERCISE_BY_ID[block.exerciseId];
        const reason = disliked.has(block.exerciseId)
          ? `Replaced ${source?.name || block.exerciseId} because it is marked as disliked${preferredCandidate ? `; chose preferred ${candidate.name}` : ''}.`
          : duplicate
            ? `Replaced repeated ${source?.name || block.exerciseId} fallback to keep the session varied.`
            : `Replaced ${source?.name || block.exerciseId} because it does not fit the available kit.`;
        substitutions.push({ sessionId: session.id, from: block.exerciseId, to: candidate.id, reason });
        used.add(candidate.id);
        return { ...block, exerciseId: candidate.id, substitutionFrom: block.exerciseId, substitutionReason: reason };
      }),
    };
  });
  return { sessions: out, substitutions, warnings };
}

export function generateProgramme({
  goal = 'general',
  location = null,
  daysPerWeek = null,
  availableMinutes = null,
  availableEquipment = null,
  level = 'Beginner',
  preferredExerciseIds = [],
  dislikedExerciseIds = [],
  plateConfig = null,
  history = [],
  startDateISO,
} = {}){
  const start = startDateISO || new Date().toISOString().slice(0, 10);
  const recommendation = recommendTemplate({ goal, level, availableEquipment, daysPerWeek });
  const template = recommendation.top;
  if(!template) throw new Error('No programme template is available for this profile.');

  // Start from the template's original exercise IDs and perform one
  // profile-aware substitution pass. This keeps the final log truthful when a
  // missing-equipment fallback is also disliked or collides with another row.
  const instantiated = instantiateTemplate({ templateId: template.id, startDateISO: start, availableEquipment: null, history });
  const preferred = preferenceSubstitutions(instantiated.sessions, { availableEquipment, preferredExerciseIds, dislikedExerciseIds, history });
  const frequency = resampleFrequency(preferred.sessions, start, daysPerWeek || template.program?.daysPerWeek || null);
  const timed = frequency.map(session=> {
    if(availableMinutes == null) return session;
    return shortWorkoutMode(session, { minutes: availableMinutes }).session;
  });
  const reasons = [
    ...((recommendation.top?.reasons || []).slice(0, 3)),
    daysPerWeek && daysPerWeek !== template.program?.daysPerWeek ? `Resampled each week to ${daysPerWeek} session${daysPerWeek === 1 ? '' : 's'} from the selected template.` : `Kept the template's ${template.program?.daysPerWeek || daysPerWeek || 'planned'}-session weekly rhythm.`,
    availableMinutes != null ? `Capped each session at about ${Math.max(10, Number(availableMinutes) || 20)} minutes and preserved the highest-value blocks first.` : 'No time cap supplied; kept the full template sessions.',
  ];
  if(preferred.substitutions.length) reasons.push(`${preferred.substitutions.length} exercise preference/kit substitution${preferred.substitutions.length === 1 ? '' : 's'} applied.`);
  if(preferred.warnings.length) reasons.push(`${preferred.warnings.length} constraint${preferred.warnings.length === 1 ? '' : 's'} could not be fully satisfied; review the warning details before training.`);
  return {
    programId: instantiated.programId,
    templateId: instantiated.templateId,
    name: instantiated.name,
    startDateISO: start,
    sessions: timed,
    substitutions: preferred.substitutions,
    generationWarnings: preferred.warnings,
    generationReasons: reasons,
    profile: { goal, location, daysPerWeek, availableMinutes, availableEquipment: availableEquipment ? [...availableEquipment] : null, level, preferredExerciseIds: [...preferredExerciseIds], dislikedExerciseIds: [...dislikedExerciseIds], plateConfig: plateConfig ? { ...plateConfig, platesKg: [...(plateConfig.platesKg || [])] } : null },
    templateVersion: instantiated.templateVersion,
    programVersion: instantiated.programVersion,
  };
}
