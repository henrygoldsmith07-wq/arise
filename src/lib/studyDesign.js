// Frozen prospective-study design metadata shared by browser evaluation and
// the heavier retrospective study engine. Keeping this tiny contract separate
// prevents the analytics worker from importing the entire study/recommendation
// graph just to label evidence correctly.

export const STUDY_DESIGN = Object.freeze({
  designVersion:1,
  unitOfAssignment:'exercise',
  arms:{ arise:'adaptive engine', 'double-progression':'evidence-based simple baseline' },
  secondaryArms:['linear-progression'],
  excludedFromPrimary:['flat', 'fixed-rules'],
  primaryEndpoint:'appropriately achieved progression targets over repeated exposures (metTarget AND changePct > meaningful gain)',
  secondaryEndpoints:['targetAchievementRate','avoidable target misses','regression rate','stall rate','unnecessary conservatism','failed-set rate','adherence','programme continuation'],
  analysis:'intention-to-treat by assigned arm; participant-clustered bootstrap for uncertainty; minimum sample gates; subgroups prespecified only (readiness low/high, equipment class)',
  contaminationNote:'both arms train within the same participant; whole-body fatigue carryover is shared and cannot be removed — exercise-level balance mitigates movement-specific drift.',
});
