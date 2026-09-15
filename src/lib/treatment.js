// treatment.js — the one recommendation resolver the STUDY enforces.
//
// Shared verbatim by SessionRunner and GuidedRunner so the randomised
// treatment follows the exercise and participant, never the workout mode:
//   assignedArm 'double-progression' → the frozen double-progression
//     prescription IS the treatment shown, executed and recorded;
//   otherwise → the normal product engine (evidence-gated model, then the
//     policy-wrapped engine with personal calibration);
//   an UNASSIGNED exercise is simply the normal engine — the arm label the
//     caller resolved (studyArmFor → null for never-randomised exercises)
//     decides study inclusion, never this function.
// Pure: same inputs, same prescription. Prior-only by construction — the DP
// branch filters history to <= asOfDateISO itself.

import { recommendNextWithPolicy } from './progressionPolicies.js';
import { personalCalibrationFromHistory } from './progression.js';
import { doubleProgressionRec } from './study.js';
import { recommendNextWithModel } from './progressionModel.js';

export function treatmentRecommendation({ block, history, asOfDateISO, plateConfig = null, study = null, assignedArm = null, policy = 'standard' } = {}){
  try{
    if(assignedArm === 'double-progression'){
      const visible = (history || []).filter(h=> String(h?.dateISO || '') <= String(asOfDateISO || '9999'));
      const rec = doubleProgressionRec({ history: visible, exerciseId: block.exerciseId, targetReps: block.reps || '8–12' });
      return {
        load: rec.load ?? null,
        reps: rec.reps,
        assistKg: null,
        reason: 'Study policy — double progression (randomised).',
        __studyArm: 'double-progression',
      };
    }
    if(study){
      const modelled = recommendNextWithModel({ exerciseId: block.exerciseId, history, targetReps: block.reps || '8–12', asOfDateISO, plateConfig, study });
      if(modelled) return modelled;
    }
    const personalCalibration = personalCalibrationFromHistory(history, { exerciseId: block.exerciseId, asOfDateISO });
    return recommendNextWithPolicy({ exerciseId: block.exerciseId, history, targetReps: block.reps || '8–12', asOfDateISO, plateConfig, study, policy, personalCalibration: personalCalibration.active ? personalCalibration : null });
  }catch{ return null; }
}
