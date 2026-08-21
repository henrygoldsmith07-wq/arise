// priors.js — explicit, versioned assumptions used by deterministic logic.
//
// These values are deliberately ordinary data rather than constants hidden in
// decision functions. A backtest can therefore record which assumptions were
// active at each historical point and replace a prior only after the configured
// amount of comparable evidence has accumulated.

function deepClone(value){
  if(Array.isArray(value)) return value.map(deepClone);
  if(value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v])=> [k, deepClone(v)]));
  return value;
}

function deepMerge(base, override){
  if(override == null) return deepClone(base);
  if(Array.isArray(base) || Array.isArray(override)) return deepClone(override);
  if(base && typeof base === 'object' && override && typeof override === 'object'){
    const out = deepClone(base);
    for(const [key, value] of Object.entries(override)) out[key] = key in out ? deepMerge(out[key], value) : deepClone(value);
    return out;
  }
  return deepClone(override);
}

function deepFreeze(value){
  if(value && typeof value === 'object' && !Object.isFrozen(value)){
    for(const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// The default policy is intentionally conservative. It is the baseline for
// cold starts and for strata that do not have enough observations to estimate a
// replacement. Keep changes here versioned so benchmark artifacts remain
// reproducible.
export const DEFAULT_ARISE_PRIORS = deepFreeze({
  version: 1,
  progression: {
    historyWindow: 6,
    defaultTargetReps: '8–12',
    defaultLowReps: 8,
    daysPerMonth: 30.44,
    assistedStepKg: 2.5,
    nonConservativeMultiplier: 1.6,
    coldLoadPctFloor: 0.01,
    confidence: {
      highSessions: 6,
      mediumSessions: 3,
    },
    validation: {
      minimumSessions: 3,
      loadTolerancePct: 0.05,
      repTolerance: 1,
    },
    strategies: {
      strength: { repRange: '3–6', incPct: 0.05, prefer: 'load' },
      hypertrophy: { repRange: '8–12', incPct: 0.025, prefer: 'double' },
      endurance: { repRange: '12–20', incPct: 0.02, prefer: 'reps' },
    },
    strategyByExercise: {
      'barbell-squat': 'strength',
      'bench-press-barbell': 'strength',
      'romanian-deadlift': 'strength',
      'barbell-bench-press': 'strength',
      'plank': 'endurance',
      'run-easy': 'endurance',
      'brisk-walk': 'endurance',
      'cycle': 'endurance',
      'jump-rope': 'endurance',
      'burpee': 'endurance',
      'dead-bug': 'endurance',
    },
    fallback: {
      strengthPattern: 'squat|deadlift|bench|press',
      strengthExcludePattern: 'lateral|band',
    },
    personalisedRate: {
      minSessions: 4,
      minSpanDays: 7,
      trimParts: 3,
      weeklyLoadPctMin: -0.02,
      weeklyLoadPctMax: 0.10,
      appliedLoadPctMin: 0.015,
      appliedLoadPctMax: 0.06,
    },
    trainingAge: {
      noviceMaxMonths: 6,
      intermediateMaxMonths: 18,
      noviceMultiplier: 1.5,
      intermediateMultiplier: 1,
      advancedMultiplier: 0.5,
      longBreakDays: 42,
      returnLoadMultiplier: 0.8,
    },
    plateau: {
      legacyMinSessions: 3,
      legacyGainPct: 0.01,
      minSessions: 4,
      trendWindow: 6,
      recentHalfWindow: 2,
      gainPct: 0.015,
      trendAbsMax: 0.6,
      rpeMinObservations: 3,
      rpeSpread: 3,
      badSessionDropPct: 0.85,
      recoveryReboundPct: 0.88,
    },
    loadRounding: {
      under20KgStep: 1,
      under60KgStep: 2.5,
      defaultStep: 5,
    },
    trend: {
      minimumObservations: 3,
      highR2: 0.6,
      mediumR2: 0.3,
    },
    sets: {
      historyWindow: 4,
      minimumSessions: 2,
      defaultSets: 3,
      defaultMaxSets: 5,
      roomRpeMax: 8,
      topSessionsRequired: 2,
    },
    rom: {
      historyWindow: 2,
      topSessionsRequired: 2,
      ladders: {
        squat: ['partial', 'parallel', 'full'],
        hinge: ['partial', 'full'],
        push: ['partial', 'full'],
      },
      squatPattern: 'squat|split|lunge',
      hingePattern: 'deadlift|rdl|hinge|swing',
      pushPattern: 'push-up|press|dip',
    },
    bodyweightPattern: 'bodyweight|push-up|plank|dead-bug|glute-bridge|lunge|burpee|pull-up|pike-push-up|incline-push-up',
  },
  sessionQuality: {
    readiness: {
      sleepWeight: 0.4,
      sorenessWeight: 0.3,
      motivationWeight: 0.3,
      scaleMin: 1,
      scaleMax: 5,
    },
    readinessLookbackDays: 3,
    noteWords: {
      negative: {
        sore: 'soreness', tired: 'fatigue', fatigue: 'fatigue', exhausted: 'fatigue', drained: 'fatigue',
        sick: 'illness', ill: 'illness', nauseous: 'illness', dizzy: 'illness',
        pain: 'pain', hurt: 'pain', injured: 'pain',
        failed: 'missed', miss: 'missed', skipped: 'missed',
        poor: 'underperformed', weak: 'underperformed', struggled: 'underperformed', awful: 'underperformed', bad: 'underperformed', heavy: 'fatigue',
      },
      positive: {
        great: 'strong', easy: 'strong', strong: 'strong', fresh: 'strong', awesome: 'strong',
        best: 'pr', pr: 'pr', pb: 'pr', good: 'positive', solid: 'positive',
        energized: 'recovered', recovered: 'recovered',
      },
      techniqueWords: ['rom', 'depth', 'form', 'technique', 'paused', 'tempo', 'assisted', 'band', 'partial', 'shallow'],
    },
    score: {
      start: 50,
      readinessLow: 35,
      readinessHigh: 70,
      failedPenalty: 18,
      lowReadinessPenalty: 22,
      highReadinessBonus: 6,
      negativeNotePenalty: 12,
      nearFailureRpe: 9,
      nearFailureReadinessMin: 60,
      nearFailurePenalty: 12,
      comfortableRpe: 6,
      comfortableMinObservations: 2,
      comfortableBonus: 8,
      positiveNoteBonus: 10,
      badCutoff: 40,
      goodCutoff: 60,
    },
    badSession: {
      window: 5,
      minSessionsForCluster: 3,
      ratio: 0.5,
    },
    plateau: {
      window: 4,
      minimumSessions: 4,
      minimumLoggedSets: 3,
      badFraction: 0.5,
      minLowReadiness: 2,
      minHighRpe: 2,
    },
    pr: {
      meaningfulGainPct: 0.02,
      minimumAbsoluteKg: 0.5,
      lowReadiness: 40,
    },
  },
  recovery: {
    readinessEmaAlpha: 0.35,
    readinessSpreadLow: 40,
    readinessSpreadMedium: 20,
    readinessDampThreshold: 30,
    readinessDampWeight: 0.8,
    readinessHistoryWindow: 5,
    readinessMinimumForDamping: 4,
    readinessMinimumForUncertainty: 2,
    highRpe: 9,
    highRpeCount: 2,
    signalWindow: 2,
    volumeSpikeRatio: 1.15,
    readinessHistoryMin: 3,
    readinessLowEma: 35,
    readinessLowLatest: 40,
    oneDayDip: 35,
    recentSetWindow: 12,
    minimumFlags: 2,
    highConfidenceFlags: 3,
    mediumConfidenceFlags: 2,
    deloadVolumeCut: 0.6,
    validationHighOutcomes: 3,
    validationMediumOutcomes: 1,
  },
  programming: {
    defaultSpacingDays: 2,
    adaptation: {
      difficultySessions: 2,
      plateauMinimumSessions: 4,
      deloadHorizonDays: 7,
      maxChangesPerSave: 6,
      setReduction: 1,
    },
    shortWorkout: {
      defaultMinutes: 20,
      minimumMinutes: 10,
      minimumBlockMinutes: 1,
      timedBlockMinimumMinutes: 5,
      minutesPerSet: 1.4,
      compoundPriority: 4,
      isolationPriority: 3,
      cardioPriority: 2,
      firstBlockBonus: 0.5,
    },
    noisySession: {
      shortDurationMinutes: 15,
      longGapDays: 14,
      missedSetsThreshold: 2,
      unusualDropPct: 0.15,
      poorAdherenceThreshold: 0.5,
      orderChangeFlag: true,
      equipmentChangeFlag: true,
    },
  },
  longitudinal: {
    // Segment-level conclusions (rates) are withheld until a segment has this
    // many resolved recommendation→outcome pairs.
    minimumSegmentSamples: 5,
    maxOpenRecordsPerExercise: 3,
    retentionLimit: 500,
  },
  backtest: {
    minimumComparisons: 5,
    minimumStratumSamples: 8,
    maxOutcomeHorizonExposures: 2,
    progressionTolerancePct: 0.005,
    assistanceToleranceKg: 0.1,
    loadTolerancePct: 0.05,
    repTolerance: 1,
    plateauFutureGainPct: 0.015,
    recoveryReboundPct: 0.02,
    observedDeloadCutRatio: 0.75,
    observedDeloadWindowDays: 7,
    historyBands: {
      coldMax: 3,
      developingMax: 8,
    },
    completion: {
      priorProbability: 0.7,
      decisionCutoff: 0.5,
    },
    fatigue: {
      priorProbability: 0.2,
      riskCutoff: 0.5,
      readinessRiskDelta: 0.25,
      clusterRiskDelta: 0.25,
    },
    consistency: {
      windowDays: 56,
      highMedianGapDays: 7,
      mediumMedianGapDays: 14,
    },
  },
});

// Public aliases make the intent clear to callers that only need the default
// progression policy, while keeping one source of truth.
export const DEFAULT_CALIBRATION_PRIORS = DEFAULT_ARISE_PRIORS;
export const PROGRESSION_PRIORS = DEFAULT_ARISE_PRIORS.progression;

export function resolveArisePriors(overrides = null){
  return deepMerge(DEFAULT_ARISE_PRIORS, overrides || {});
}

export const resolveCalibrationConfig = resolveArisePriors;

// Empirical estimates are allowed to replace a prior only after the caller's
// explicit minimum sample count is met. This is intentionally not a shrinkage
// estimate: sparse data remains visibly a prior instead of being presented as
// learned precision.
export function empiricalOrPrior({ prior, estimate, samples = 0, minimumSamples = 1 } = {}){
  const n = Number(samples) || 0;
  const min = Math.max(1, Number(minimumSamples) || 1);
  const usable = n >= min && Number.isFinite(Number(estimate));
  return {
    value: usable ? Number(estimate) : prior,
    source: usable ? 'empirical' : 'prior',
    samples: n,
    minimumSamples: min,
  };
}

export function clamp(value, min, max){
  return Math.max(min, Math.min(max, value));
}
