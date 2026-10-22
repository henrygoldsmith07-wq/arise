// programmeGenerator.js — deterministic profile-to-schedule generation.
// The output is still ordinary Arise schedule data: no opaque coach layer,
// no future history, and every material choice is returned as a reason.

import { EXERCISE_BY_ID, exerciseAvailable, PROGRAM_BY_ID } from './data.js';
import { recommendTemplate, instantiateTemplate } from './templates.js';
import { rankedSubstitutions } from './substitutions.js';
import { shortWorkoutMode } from './programming.js';
import { localDateISO } from './dateOnly.js';

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
// Fewer training days than the template has sessions: ROTATE through the
// week's sessions instead of picking a fixed subset. A fixed pick (the old
// evenly-spaced index choice) dropped the SAME session every week — a 3-day
// user on a 4-day upper/lower got Lower A, Lower B, Upper B forever, so one
// upper day (and every movement only it contains) never appeared and lower
// body was trained twice as often as upper. Rotating carries the cursor
// across weeks (week 1: L-A U-A L-B, week 2: U-B L-A U-A, …), so every
// session recurs, the upper/lower alternation is kept, and each template
// week's own progression (+reps, +load) still applies to the sessions drawn
// from it.
function resampleFrequency(sessions, startDateISO, daysPerWeek){
  const byWeek = new Map();
  for(const session of sessions || []){
    const list = byWeek.get(session.week) || [];
    list.push(session);
    byWeek.set(session.week, list);
  }
  const output = [];
  let cursor = 0;
  const weeks = [...byWeek.keys()].sort((a, b)=> (Number(a) || 0) - (Number(b) || 0));
  for(const week of weeks){
    const weekSessions = byWeek.get(week);
    const length = weekSessions.length;
    const count = Math.max(1, Math.min(length, Number(daysPerWeek) || length));
    const picks = [];
    if(count >= length){
      for(let index = 0; index < length; index++) picks.push(index);
    } else {
      for(let k = 0; k < count; k++) picks.push((cursor + k) % length);
      cursor = (cursor + count) % length;
    }
    const weekNumber = Math.max(1, Number(week) || 1);
    picks.forEach((sourceIndex, position)=> {
      const source = weekSessions[sourceIndex];
      const offset = (weekNumber - 1) * 7 + Math.round(position * 7 / Math.max(1, picks.length));
      output.push({ ...source, dateISO: addDays(startDateISO, offset), frequencyAdjusted: picks.length !== length });
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
  customTemplates = [],
  startDateISO,
} = {}){
  const start = startDateISO || localDateISO();
  // The scorer must see the same pool the Train hero recommends from —
  // otherwise "Start" could build a DIFFERENT programme than the card showed.
  const extraTemplates = (customTemplates || []).filter(t => t && !t.deletedAt && t.isCustom && t.program);
  const recommendation = recommendTemplate({ goal, level, availableEquipment, daysPerWeek, extraTemplates });
  const template = recommendation.top;
  if(!template) throw new Error('No programme template is available for this profile.');

  // Start from the template's original exercise IDs and perform one
  // profile-aware substitution pass. This keeps the final log truthful when a
  // missing-equipment fallback is also disliked or collides with another row.
  const instantiated = instantiateTemplate({ templateId: template.id, startDateISO: start, availableEquipment: null, history, extraTemplates });
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
    // The schedule record carries the PROGRAMME's name — the same name the
    // Train hero shows. The template's display name ("Anywhere Template")
    // is builder vocabulary, not what the user picked.
    name: (template.isCustom ? template.program?.name : PROGRAM_BY_ID[instantiated.programId]?.name) || instantiated.name,
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
