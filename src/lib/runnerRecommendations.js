// Shared recommendation + prospective-evidence lifecycle for every workout
// presentation. Standard, Gym and Guided modes must resolve the same treatment
// from the same prior-only inputs, then record exactly what was shown.

import { recordRecommendation } from './longitudinal.js';
import { runComparativeStudy } from './study.js';
import { studyArmFor } from './studyEnrollment.js';
import { treatmentRecommendation } from './treatment.js';

export function runnerStudy(history){
  try{ return runComparativeStudy(history); }catch{ return null; }
}

export function runnerRecommendationForBlock({
  block,
  history = [],
  dateISO,
  plateConfig = null,
  study = null,
  studyEnrollment = null,
  policy = 'standard',
} = {}){
  if(!block?.exerciseId) return { arm:null, recommendation:null };
  const arm = studyArmFor(studyEnrollment, block.exerciseId);
  const recommendation = treatmentRecommendation({
    block,
    history,
    asOfDateISO:dateISO,
    plateConfig,
    study,
    assignedArm:arm,
    policy,
  });
  return { arm, recommendation };
}

export function buildRunnerRecommendationMeta({
  blocks = [],
  history = [],
  dateISO,
  plateConfig = null,
  study = null,
  studyEnrollment = null,
  policy = 'standard',
  previousForExercise = null,
} = {}){
  const arms = new Map();
  const recs = new Map();
  const prevs = new Map();
  for(const block of blocks){
    if(!block?.exerciseId || arms.has(block.exerciseId)) continue;
    const { arm, recommendation } = runnerRecommendationForBlock({
      block,
      history,
      dateISO,
      plateConfig,
      study,
      studyEnrollment,
      policy,
    });
    arms.set(block.exerciseId, arm);
    recs.set(block.exerciseId, recommendation);
    if(typeof previousForExercise === 'function') prevs.set(block.exerciseId, previousForExercise(block.exerciseId));
  }
  return { arms, assigned:arms, recs, prevs };
}

export function prospectiveRecommendationRecord({
  block,
  recommendation,
  arm = null,
  history = [],
  session,
  participantId = null,
  measurementConsent = false,
} = {}){
  return {
    exerciseId:block.exerciseId,
    recommendation,
    history,
    dueDateISO:session.dateISO,
    programId:session.programId || null,
    programVersion:session.programVersion ?? null,
    targetReps:block.reps || undefined,
    assignedArm:arm ?? null,
    participantId,
    preferences:measurementConsent === true ? { telemetryEnabled:true } : null,
  };
}

export function recordProspectiveRecommendation(args){
  return recordRecommendation(prospectiveRecommendationRecord(args));
}
