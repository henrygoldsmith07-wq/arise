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
//
// BASIS NOTES (item 5): every numeric block below carries a `basis` note naming
// the source AND its uncertainty. Where the literature genuinely disagrees the
// note states the range and the dispute instead of one authoritative number.
// Weekly volume, RPE-vs-RIR, deload frequency and proximity-to-failure are all
// live disputes — the notes say so. ACSM's March 2026 position stand found
// complex periodisation did not consistently beat simpler programming for the
// average healthy adult, and that adherence dominates: nothing here hardens
// claims the field just softened. A test fails if a new constant is added
// without a basis note (see tests/priors-basis.test.js).
export const DEFAULT_ARISE_PRIORS = deepFreeze({
  version: 1,
  progression: {
    basis: 'Design guardrail, not a literature value: 6 exposures ≈ 2–3 weeks at 2–3×/wk per lift — the smallest window that smooths one bad session without freezing adaptation. Confidence: low; dispute: none (engineering choice, stated as such).',
    historyWindow: 6,
    defaultTargetReps: '8–12',
    defaultLowReps: 8,
    daysPerMonth: 30.44,
    assistedStepKg: 2.5,
    nonConservativeMultiplier: 1.6,
    coldLoadPctFloor: 0.01,
    confidence: {
      basis: 'Design guardrail: 3 sessions to notice a pattern, 6 to trust it. Confidence: low; dispute: none (engineering choice).',
      highSessions: 6,
      mediumSessions: 3,
    },
    validation: {
      basis: 'Measurement tolerance: ±5% load / ±1 rep absorbs plate-rounding and rep-count noise. Confidence: medium; dispute: none (metrology choice).',
      minimumSessions: 3,
      loadTolerancePct: 0.05,
      repTolerance: 1,
    },
    strategies: {
      basis: 'Rep ranges follow ACSM resistance-training guidance (strength 1–6, hypertrophy 6–12, endurance ≥12) and weekly load steps are conservative coaching defaults (strength ~5%/wk, hypertrophy ~2.5%, endurance ~2% via reps). Uncertainty: weekly rates vary widely by lifter and study; proximity-to-failure and volume are live disputes (see docs/METHODOLOGY.md). Confidence: medium for ranges, low for exact weekly percentages. ACSM March 2026: adherence dominates outcomes; simple programming is competitive with complex periodisation for average healthy adults.',
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
      basis: 'Design guardrail: ≥4 sessions over ≥7 days before fitting a personal rate; weekly load change clamped to −2%…+10% with applied jumps 1.5%…6%. Uncertainty: high — individual progression is noisy and context-dependent. Confidence: low; dispute: the level of personalisation that beats simple programming is itself disputed (see ACSM March 2026 note above).',
      minSessions: 4,
      minSpanDays: 7,
      trimParts: 3,
      weeklyLoadPctMin: -0.02,
      weeklyLoadPctMax: 0.10,
      appliedLoadPctMin: 0.015,
      appliedLoadPctMax: 0.06,
    },
    trainingAge: {
      basis: 'Coaching heuristic: novices progress faster than intermediates, advanced lifters slowest (multipliers 1.5 / 1.0 / 0.5 with 6- and 18-month cuts); ≥42 days off halves the return load (×0.8). Uncertainty: high — detraining/retraining rates vary widely. Confidence: low; stated as a safety-biased heuristic, not a physiological model.',
      noviceMaxMonths: 6,
      intermediateMaxMonths: 18,
      noviceMultiplier: 1.5,
      intermediateMultiplier: 1,
      advancedMultiplier: 0.5,
      longBreakDays: 42,
      returnLoadMultiplier: 0.8,
    },
    plateau: {
      basis: 'Design guardrail: 4+ sessions with <1.5% gain flags a plateau; RPE/volume corroboration required so one bad session never triggers it. Uncertainty: plateau definitions vary across studies. Confidence: low; dispute: none on the guardrail shape (engineering choice).',
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
      basis: 'Equipment reality: standard plate/stack increments (1 / 2.5 / 5 kg steps). Confidence: high; dispute: none.',
      under20KgStep: 1,
      under60KgStep: 2.5,
      defaultStep: 5,
    },
    trend: {
      basis: 'Design guardrail: ≥3 observations before quoting a trend; R² 0.3/0.6 bands for medium/high confidence. Confidence: low; dispute: none (engineering choice).',
      minimumObservations: 3,
      highR2: 0.6,
      mediumR2: 0.3,
    },
    sets: {
      basis: 'Volume heuristic: start at 3 sets, cap at 5, add one only after 2 sessions at the top of the range with explicit RPE ≤8. Uncertainty: weekly volume is a live dispute — optimal sets vary widely and adherence dominates (ACSM March 2026). Confidence: low; stated as a conservative starting point, not an optimum.',
      historyWindow: 4,
      minimumSessions: 2,
      defaultSets: 3,
      defaultMaxSets: 5,
      roomRpeMax: 8,
      topSessionsRequired: 2,
    },
    rom: {
      basis: 'Design guardrail: ROM depth advances only after 2 sessions at the top of the range. Confidence: low; dispute: none (engineering choice).',
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
    // Bodyweight progression ladders (progression.js bodyweightVariantLadder).
    // When a bodyweight lift tops out on reps at zero load, the honest overload
    // is a harder variant of the SAME movement — so each head lists its own
    // ordered ladder. Entries must (a) exist in EXERCISE_BY_ID and (b) be no
    // harder to kit than the head exercise; both are asserted in
    // tests/bodyweight-progression.test.js. The `fallback` key arms whatever the
    // head's own substitution list offers when no ladder covers it.
    //
    // A ladder may list on-ramps AND step-ups: only entries whose level field
    // is above the head's are ever recommended, so an on-ramp listed here (for
    // scaling DOWN) can never surface as a step-up.
    bodyweightVariants: {
      'push-up': ['knee-push-up', 'wide-push-up', 'diamond-push-up', 'decline-push-up', 'archer-push-up', 'weighted-push-up'],
      'incline-push-up': ['push-up'],
      'bodyweight-squat': ['banded-squat', 'jump-squat', 'split-squat', 'bulgarian-split-squat', 'pistol-squat'],
      'glute-bridge': ['single-leg-glute-bridge', 'hip-thrust', 'barbell-glute-bridge'],
      'pull-up': ['negative-pull-up', 'scapular-pull-up', 'chin-up', 'weighted-pull-up'],
      'plank': ['side-plank'],
      'pike-push-up': ['wall-walk', 'wall-handstand-push-up', 'handstand-push-up'],
      'lunge': ['bulgarian-split-squat', 'pistol-squat'],
      fallback: true,
    },
  },
  sessionQuality: {
    basis: 'Heuristic scoring: readiness weights (sleep 0.4 / soreness 0.3 / motivation 0.3) and session-score adjustments are design choices that keep scores explainable, not psychometric findings. Readiness-as-proxy is a standing limit (docs/CANNOT_PROVE.md). Confidence: low; dispute: self-report weighting schemes vary widely.',
    readiness: {
      basis: 'Heuristic weights: sleep 0.4 / soreness 0.3 / motivation 0.3 on a 1–5 scale — explainability choices, not psychometric findings. Readiness is a self-report proxy (docs/CANNOT_PROVE.md). Confidence: low; dispute: weighting schemes vary widely.',
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
      basis: 'Design guardrail: score adjustments (failed −18, low-readiness −22, high-readiness +6, note ±10–12, near-failure −12, comfortable +8) keep one bad day from dominating. Confidence: low; dispute: none (engineering choice).',
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
      basis: 'Design guardrail: ≥50% bad sessions in a 5-session window (min 3) flags a cluster. Confidence: low; dispute: none (engineering choice).',
      window: 5,
      minSessionsForCluster: 3,
      ratio: 0.5,
    },
    plateau: {
      basis: 'Design guardrail: 4-session window with ≥50% bad sessions plus corroborating low-readiness/high-RPE signals. Confidence: low; dispute: none (engineering choice).',
      window: 4,
      minimumSessions: 4,
      minimumLoggedSets: 3,
      badFraction: 0.5,
      minLowReadiness: 2,
      minHighRpe: 2,
    },
    pr: {
      basis: 'Measurement tolerance: a PR needs ≥2% gain and ≥0.5 kg so plate-rounding and rep-count noise cannot mint records. Confidence: medium; dispute: none (metrology choice).',
      meaningfulGainPct: 0.02,
      minimumAbsoluteKg: 0.5,
      lowReadiness: 40,
    },
  },
  recovery: {
    basis: 'Design guardrails: EMA smoothing (α 0.35), volume-spike ratio 1.15, and multi-flag deload triggers (≥2 flags, ≥3 for high confidence) with a −40% volume cut. Uncertainty: deload frequency and magnitude are live disputes; some lifters need none, others need planned ones. Confidence: low; ACSM March 2026: adherence dominates — the cut is conservative by design, not optimal by evidence.',
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
  // Graduated readiness classifier (readinessClassifier.js). Combines today's
  // readiness, short/long EMAs, recent RPE, performance trend, session
  // completion, soreness, previous adaptation response, and the legacy
  // deloadReadinessAssessment into one of four graduated recommendations.
  // Points are additive and capped by the thresholds below; escalation beyond a
  // band additionally requires the stated number of DISTINCT contributing
  // factors so no single input can force a big call alone.
  readinessClassifier: {
    basis: 'Design guardrail: additive points capped per band (15/32/50) with distinct-factor requirements so no single input forces a deload. Readiness is a self-report proxy (docs/CANNOT_PROVE.md). Uncertainty: RPE-vs-RIR mapping and self-report weighting are live disputes. Confidence: low.',
    version: 1,
    emaShortEntries: 3,   // "3-day EMA" window (entries ≈ training days)
    emaLongEntries: 7,    // "7-day EMA" window
    sorenessWindow: 3,
    sorenessHigh: 4,             // mean soreness at/above this counts (1–5 scale)
    completionLookbackDays: 21,
    completionPlannedMinimum: 3,
    completionLowThreshold: 0.6, // completed/planned below this scores
    trendWindowSessions: 6,
    trendDeclineSlope: 0.3,      // e1RM points/session slope read as declining
    repeatGuardDays: 21,         // fresh successful deload dampens re-escalation
    normalisedReboundRatio: 0.8, // matches validateDeloadDecisions' normalised bar
    weights: {
      basis: 'Point weights sum to the band caps above; relative ordering (today > short EMA > long EMA, failed-adaptation and assessment high) reflects recency and specificity. Confidence: low; dispute: none (engineering choice within the classifier guardrail).',
      lowToday: 18,             // proportional below recovery.oneDayDip
      shortEmaLow: 16,          // proportional below recovery.readinessLowEma
      longEmaLow: 14,
      highRpeCluster: 14,       // ≥ recovery.highRpeCount near-failure sets
      negativeTrend: 10,
      poorCompletion: 8,        // planned-but-not-done sessions in lookback
      highSoreness: 10,         // mean soreness ≥ sorenessHigh (1–5 scale)
      failedAdaptation: 12,     // prior cut applied but volume never rebounded
      deloadAssessmentYes: 22,  // scaled by the assessment's own confidence
    },
    thresholds: { basis: 'Escalation bands: 15/32/50 points for small-adjustment / recovery-session / genuine-deload. Confidence: low; dispute: none (engineering choice).', smallAdjustment: 15, recoverySession: 32, genuineDeload: 50 },
    minimumDistinctFactors: { basis: 'Distinct-factor gate: 1/2/3 independent signals per band so no single input forces a big call. Confidence: low; dispute: none (engineering choice).', smallAdjustment: 1, recoverySession: 2, genuineDeload: 3 },
  },
  programming: {
    basis: 'Design guardrails: one adaptation per exposure, ≤6 changes per save, short-session defaults (20 min, ≥10 min minimum). Uncertainty: program-level prescriptions vary widely; adherence dominates (ACSM March 2026). Confidence: low; stated as guardrails, not optima.',
    defaultSpacingDays: 2,
    adaptation: {
      basis: 'Design guardrail: difficulty after 2 sessions, plateau after 4, deload horizon 7 days, one set per change. Confidence: low; dispute: none (engineering choice).',
      difficultySessions: 2,
      plateauMinimumSessions: 4,
      deloadHorizonDays: 7,
      maxChangesPerSave: 6,
      setReduction: 1,
    },
    shortWorkout: {
      basis: 'Time-budget heuristic: ~1.4 min/set with compound → isolation → cardio priority. Confidence: low; dispute: none (scheduling choice).',
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
      basis: 'Design guardrail: short <15 min, long gap >14 days, ≥2 missed sets, ≥15% e1RM drop flags noise. Confidence: low; dispute: none (engineering choice).',
      shortDurationMinutes: 15,
      longGapDays: 14,
      missedSetsThreshold: 2,
      unusualDropPct: 0.15,
      poorAdherenceThreshold: 0.5,
      orderChangeFlag: true,
      equipmentChangeFlag: true,
    },
  },
  // Training experiment system (trainingExperiments.js). Phase lengths and
  // data gates for the user's own self-experiments; conclusions stay
  // 'inconclusive' until the minimums are met — the honest default.
  experiments: {
    basis: 'Self-experiment guardrail: 14-day baseline, 28-day intervention, ≥4 sessions before concluding; inconclusive is the honest default. Confidence: low; dispute: none (methodology choice).',
    baselineDays: 14,
    interventionDays: 28,
    // Intervention sessions needed before a conclusion is even attempted.
    minimumSessions: 4,
    minimumDataDays: 21,
    suggestAfterSessions: 12,
  },
  // Post-workout debrief adjustments (workoutQualityReport.js). The session
  // quality engine score is the base; the target lens shifts it by a bounded
  // amount so "met the plan" and "met the plan AND beat last time" read
  // differently without double-penalising a rough day.
  workoutQuality: {
    basis: 'Design guardrail: bounded ±6–10 point adjustments so meeting/missing the plan reads differently without double-penalising a rough day. Confidence: low; dispute: none (engineering choice).',
    targetHitBonus: 8,
    targetMissPenalty: 10,
    prBeatBonus: 6,
    // All sets completed at a sub-grind average effort (RPE ≤ max): the
    // sustainable-work signal — good, repeatable training, not a lucky day.
    sustainableEffortBonus: 8,
    sustainableEffortMaxRpe: 8,
  },
  longitudinal: {
    basis: 'Evidence-honesty guardrail: ≥5 resolved pairs per segment and ≥10pp rate gaps before reporting an observed weakness; the retrospective replay cannot prove causation (docs/CANNOT_PROVE.md). Confidence: medium for the guardrail logic; the underlying rates remain observational.',
    // Segment-level conclusions (rates) are withheld until a segment has this
    // many resolved recommendation→outcome pairs.
    minimumSegmentSamples: 5,
    // A segment difference below this rate gap is NOT treated as an observed
    // weakness. Rates here are point estimates over `minimumSegmentSamples`
    // transitions; a 5-sample segment cannot distinguish a 5% gap from noise,
    // so calling one an observed weakness would overclaim. The capability layer
    // (progressionModel.assessCapabilities) requires this much separation
    // before it reports a weakness at all, and describes the result as
    // "observed", never "proven".
    minimumObservedWeaknessRate: 0.1,
    maxOpenRecordsPerExercise: 3,
    retentionLimit: 500,
    // Outcome-label decision constants for the named classifier (see
    // classifyRecommendationOutcome). Meaningful gain reuses the session-quality
    // prior; regression + easy-effort are the conservative cuts for grading a
    // prescription — never to punish the engine for an unattempted session.
    outcomeLabels: {
      basis: 'Grading cuts: ≥2% gain is meaningful (matches the PR prior), −5% is regression, RPE ≤7 is easy, +10% load is aggressive. Confidence: low; dispute: none (engineering choice).',
      meaningfulGainPct: 0.02,
      regressionCutPct: 0.05,
      easyRpeThreshold: 7,
      aggressiveLoadPct: 1.1,
    },
  },
  // Prospective recommendation calibration: how well the engine's frozen
  // predictions match what the user actually achieved, segmented honestly and
  // shrunk hard toward safe defaults when evidence is sparse. Distinct from the
  // retrospective `backtest` block — this only ever reads first-visible
  // prospective ledger rows, never a reconstructed recommendation.
  calibration: {
    basis: 'Evidence-honesty guardrail: Jeffreys-style shrinkage (pseudo-count 5) with rates withheld below 5 resolved pairs; expected band rates (0.8/0.6/0.45) are starting beliefs, not findings. Confidence: low; dispute: none (methodology choice).',
    // Jeffreys-style prior mass that pulls a small-n empirical rate toward the
    // safe default success rate. weight = n / (n + pseudoCount).
    pseudoCount: 5,
    // Below this many resolved pairs in a segment, rates stay `null` (withheld).
    minSamplesToTrust: 5,
    // Neutral prior for the shrunk rate + a missing confidence band.
    defaultSuccessRate: 0.6,
    // Expected target-achievement probability per confidence band, for the
    // calibration-error (expected-vs-realised) estimate.
    bandExpected: {
      basis: 'Starting beliefs for expected target-achievement per confidence band (0.8/0.6/0.45/0.45/0.5) — used for calibration-error estimates, not as findings. Confidence: low; dispute: none (methodology choice).',
      high: 0.8,
      medium: 0.6,
      low: 0.45,
      'low-thin': 0.45,
      none: 0.5,
    },
    // Conservative personalisation of future jumps, bounded to stay safe.
    jumpMultiplierMin: 0.85,
    jumpMultiplierMax: 1.08,
    minExerciseSessions: 5,
    // Shrink-to-default so a single odd session cannot flip the stance.
    overRateCutoff: 0.34,   // ≥ this fraction too-aggressive → smaller jumps
    underRateCutoff: 0.5,  // ≥ this fraction too-conservative (easy gains) → slightly bolder
    jumpDeltaStep: 0.1,    // max multiplier move per calibration pass (bounded)
  },
  // Evidence gates for the progression model. Every capability is inert until
  // its own sample threshold AND a demonstrated weakness (arise losing to a
  // baseline comparator in that stratum) opens it.
  progressionModel: {
    basis: 'Evidence-gating guardrail: capabilities stay inert until per-stratum sample gates open AND an observed weakness appears; overlay shifts bounded to ±2pp (readiness/autoregulation ≤1pp). Confidence: medium for the gating logic; the estimates themselves remain observational. See docs/CANNOT_PROVE.md.',
    version: 1,
    minExposuresPerExercise: 6,
    minExposuresPerMovement: 12,
    minExposuresPerRepRange: 10,
    minSessionsForResponseShift: 8,
    minPairsFatigue: 3,
    minPerBucketFrequency: 3,
    volumeMinWeeks: 6,
    equivalenceMinPairs: 3,
    maxIncPctDelta: 0.02,        // tuned incPct stays within ±2pp of strategy default
    autoregulationShiftMax: 0.01,
    // Graduated readiness graduation gate + overlay bound. The classifier only
    // becomes a model capability once enough sessions AND enough of its inputs
    // have data; when active it shifts the personalisedRate band by at most
    // readinessShiftMax (the same knobs autoregulation uses).
    readinessMinSessions: 6,
    readinessMinInputs: 3,
    readinessShiftMax: 0.008,
  },
  backtest: {
    basis: 'Validation-harness guardrail: minimum samples per stratum/comparison and tight tolerances (±0.5% progression, ±0.1 kg assistance, ±5% load, ±1 rep) so the harness proves mechanics, not training science (docs/CANNOT_PROVE.md). Confidence: high for the harness logic; the corpora are synthetic.',
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
      basis: 'History bands: cold ≤3, developing ≤8 sessions. Confidence: low; dispute: none (engineering choice).',
      coldMax: 3,
      developingMax: 8,
    },
    completion: {
      basis: 'Completion prior 0.7 with 0.5 decision cutoff. Confidence: low; dispute: none (methodology choice).',
      priorProbability: 0.7,
      decisionCutoff: 0.5,
    },
    fatigue: {
      basis: 'Fatigue prior 0.2 with 0.5 risk cutoff; readiness/cluster deltas 0.25. Confidence: low; dispute: none (methodology choice).',
      priorProbability: 0.2,
      riskCutoff: 0.5,
      readinessRiskDelta: 0.25,
      clusterRiskDelta: 0.25,
    },
    consistency: {
      basis: 'Consistency window 56 days; high ≤7d / medium ≤14d median gaps. Confidence: low; dispute: none (engineering choice).',
      windowDays: 56,
      highMedianGapDays: 7,
      mediumMedianGapDays: 14,
    },
  },
});

export const PROGRESSION_PRIORS = DEFAULT_ARISE_PRIORS.progression;

export function resolveArisePriors(overrides = null){
  return deepMerge(DEFAULT_ARISE_PRIORS, overrides || {});
}

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
