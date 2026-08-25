import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReadiness, READINESS_RECOMMENDATIONS } from '../src/lib/readinessClassifier.js';
import { reviewCompletedWeek, applyWeeklyReview } from '../src/lib/mesocycle.js';
import { deriveProgressionModel, recommendNextWithModel, assessCapabilities } from '../src/lib/progressionModel.js';
import { DEFAULT_ARISE_PRIORS } from '../src/lib/priors.js';

const TODAY = '2026-06-20';

function sess(dateISO, blocks, extra = {}){ return { id: `s-${dateISO}`, dateISO, blocks, ...extra }; }
function block(exerciseId, sets){ return { exerciseId, sets }; }
function set(reps, weightKg, rpe){ return { reps: String(reps), weightKg: String(weightKg), rpe: rpe == null ? '' : String(rpe) }; }

function readinessEntries(scores, { startDay = 13, soreness = null } = {}){
  return scores.map((score, i)=> ({
    dateISO: `2026-06-${String(startDay + i).padStart(2, '0')}`,
    score,
    ...(soreness != null ? { soreness } : {}),
  }));
}

// Rising dumbbell bench — healthy, progressing, comfortable RPE.
function risingBench({ startDay = 1, baseKg = 20, rpe = 7, days = 6 } = {}){
  const out = [];
  for(let i = 0; i < days; i++){
    out.push(sess(`2026-06-${String(startDay + i * 2).padStart(2, '0')}`, [block('bench-press-dumbbell', [set(8, baseKg + i, rpe)])]));
  }
  return out;
}

describe('graduated readiness classifier', ()=>{
  it('orders the four graduated recommendations', ()=>{
    assert.deepEqual(READINESS_RECOMMENDATIONS, ['as-planned', 'small-adjustment', 'recovery-session', 'genuine-deload']);
  });

  it('returns as-planned on healthy longitudinal data', ()=>{
    const history = risingBench();
    const readinessLog = readinessEntries([72, 78, 70, 75, 74], { soreness: 2 });
    const result = classifyReadiness({ history, readinessLog, todayISO: TODAY });
    assert.equal(result.recommendation, 'as-planned');
    assert.ok(result.score < DEFAULT_ARISE_PRIORS.readinessClassifier.thresholds.smallAdjustment, `score ${result.score} too high`);
    assert.equal(result.deloadAssessment.yes, false);
    assert.ok(result.factors.every(f => Number.isFinite(f.points)));
  });

  it('treats a one-day readiness dip as a non-event', ()=>{
    const history = risingBench();
    const readinessLog = readinessEntries([70, 72, 68, 71, 20], { soreness: 2 });
    const result = classifyReadiness({ history, readinessLog, todayISO: TODAY });
    // The dip contributes today-points but the 3-day EMA absorbs it: no deload.
    assert.notEqual(result.recommendation, 'genuine-deload');
    assert.equal(result.recommendation, 'as-planned');
    const ema3 = result.factors.find(f=> f.id === 'shortEmaLow');
    assert.equal(ema3.points, 0);
  });

  it('escalates to genuine-deload only on many distinct sustained signals', ()=>{
    const declining = [];
    for(let i = 0; i < 6; i++){
      declining.push(sess(`2026-06-${String(1 + i * 2).padStart(2, '0')}`, [block('bench-press-dumbbell', [set(8, 30 - i, 9)])]));
    }
    const readinessLog = readinessEntries([30, 28, 26, 24, 25], { soreness: 5 });
    const result = classifyReadiness({
      history: declining,
      readinessLog,
      recentRpes: [9, 9, 9],
      todayISO: TODAY,
      deloadAssessment: { yes: true, confidence: 'high', signals: ['high RPE ≥9 twice'] },
    });
    assert.equal(result.recommendation, 'genuine-deload');
    assert.ok(result.score >= DEFAULT_ARISE_PRIORS.readinessClassifier.thresholds.genuineDeload, `score ${result.score}`);
    assert.ok(result.distinctFactors >= DEFAULT_ARISE_PRIORS.readinessClassifier.minimumDistinctFactors.genuineDeload);
    assert.ok(result.coverage.observed >= 3);
  });

  it('keeps a strong-but-lonely fatigue verdict below genuine-deload (distinct-factor gate)', ()=>{
    // Deload assessment fires at HIGH confidence, and one EMA is low: enough
    // for a recovery-session band, not for a full deload on its own.
    const history = risingBench();
    const readinessLog = readinessEntries([34, 33, 32, 31], { soreness: 2 });
    const result = classifyReadiness({
      history, readinessLog, todayISO: TODAY,
      deloadAssessment: { yes: true, confidence: 'high', signals: ['test signal'] },
    });
    assert.notEqual(result.recommendation, 'genuine-deload');
    assert.ok(['recovery-session', 'small-adjustment'].includes(result.recommendation));
  });

  it('caps escalation when the final session is noisy and confidence is not high', ()=>{
    const declining = [];
    for(let i = 0; i < 6; i++){
      declining.push(sess(`2026-06-${String(1 + i * 2).padStart(2, '0')}`, [block('bench-press-dumbbell', [set(8, 30 - i, 9)])]));
    }
    // Pain-flagged final session → noisy context.
    declining[declining.length - 1] = {
      ...declining[declining.length - 1],
      durationMinutes: 10,
      painDiscomfort: true,
    };
    const readinessLog = readinessEntries([30, 28, 26, 24, 25], { soreness: 5 });
    const result = classifyReadiness({
      history: declining,
      readinessLog,
      recentRpes: [9, 9, 9],
      todayISO: TODAY,
      // medium-confidence verdict: noise gate refuses to trust it fully
      deloadAssessment: { yes: true, confidence: 'medium', signals: ['high RPE ≥9 twice'] },
    });
    assert.notEqual(result.recommendation, 'genuine-deload');
    assert.ok(result.guards.length >= 1, 'expected an explicit guard note');
  });

  it('adds weight when a previous cut never normalised, and guards fresh successful deloads', ()=>{
    const schedule = {
      programId: 'p',
      sessions: [],
      adaptationHistory: [
        { dateISO: '2026-06-10', decision: { deload: true, deloadSignals: ['test'] } },
      ],
    };
    // Volume before the cut: 3000kg. During: 1000kg (cut applied).
    // After: failing rebound 1200kg (<80% of before).
    const history = [
      sess('2026-06-03', [block('bench-press-dumbbell', [set(10, 100, ''), set(10, 100, ''), set(10, 100, '')])]),
      sess('2026-06-11', [block('bench-press-dumbbell', [set(10, 60, '')])]),
      sess('2026-06-19', [block('bench-press-dumbbell', [set(10, 40, '')])]),
    ];
    const failed = classifyReadiness({
      history, schedule, todayISO: TODAY,
      deloadAssessment: { yes: false, confidence: 'low', signals: [] },
    });
    const factor = failed.factors.find(f=> f.id === 'failedAdaptation');
    assert.equal(factor.points, DEFAULT_ARISE_PRIORS.readinessClassifier.weights.failedAdaptation);
    assert.match(factor.detail, /did NOT rebound/);

    // Now a healthy rebound within the repeat-guard window caps re-escalation:
    // same inputs but the after-week volume recovers to 90% of baseline.
    const recoveredHistory = [
      sess('2026-06-03', [block('bench-press-dumbbell', [set(10, 100, ''), set(10, 100, ''), set(10, 100, '')])]),
      sess('2026-06-11', [block('bench-press-dumbbell', [set(10, 60, '')])]),
      sess('2026-06-19', [block('bench-press-dumbbell', [set(10, 90, ''), set(10, 90, ''), set(10, 90, '')])]),
    ];
    const guarded = classifyReadiness({
      history: recoveredHistory, schedule, todayISO: TODAY,
      readinessLog: readinessEntries([30, 28, 26, 24, 25], { soreness: 5 }),
      recentRpes: [9, 9, 9],
      deloadAssessment: { yes: true, confidence: 'medium', signals: ['test'] },
    });
    assert.notEqual(guarded.recommendation, 'genuine-deload');
    assert.ok(guarded.guards.some(g=> /normalised/.test(g)), `guards: ${guarded.guards.join('; ')}`);
    assert.equal(guarded.adaptationResponse.normalised, true);
  });

  it('degrades honestly with no data at all', ()=>{
    const result = classifyReadiness({ history: [], readinessLog: [], todayISO: TODAY });
    assert.equal(result.recommendation, 'as-planned');
    assert.equal(result.confidence, 'low');
    assert.equal(result.coverage.observed, 1); // only the always-available verdict slot
    assert.equal(result.score, 0);
  });

  it('reports soreness as its own factor', ()=>{
    const history = risingBench();
    const readinessLog = readinessEntries([70, 71, 69, 72, 68], { soreness: 5 });
    const result = classifyReadiness({ history, readinessLog, todayISO: TODAY });
    const factor = result.factors.find(f=> f.id === 'highSoreness');
    assert.ok(factor.available && factor.points > 0);
  });

  it('uses session completion when a schedule with planned sessions exists', ()=>{
    const history = [
      ...risingBench(),
      sess('2026-06-08', [block('goblet-squat', [set(10, 24, 7)])]),
      sess('2026-06-10', [block('goblet-squat', [set(10, 24, 7)])]),
      sess('2026-06-12', [block('goblet-squat', [set(10, 24, 7)])]),
    ];
    // Three planned sessions in the lookback, only one with matching history.
    const schedule = {
      programId: 'p',
      sessions: [
        { id: 'planned-a', dateISO: '2026-06-08', status: 'planned', blocks: [] },
        { id: 'planned-b', dateISO: '2026-06-10', status: 'planned', blocks: [] },
        { id: 's-2026-06-12', dateISO: '2026-06-12', status: 'planned', blocks: [] },
      ],
    };
    const result = classifyReadiness({ history, schedule, todayISO: TODAY });
    const factor = result.factors.find(f=> f.id === 'poorCompletion');
    assert.equal(factor.available, true);
    assert.ok(factor.points > 0);

    const complete = classifyReadiness({
      history,
      schedule: { ...schedule, sessions: schedule.sessions.map(s=> ({ ...s, status: 'done' })) },
      todayISO: TODAY,
    });
    assert.equal(complete.factors.find(f=> f.id === 'poorCompletion').points, 0);
  });
});

describe('mesocycle wiring', ()=>{
  function buildSchedule(){
    return {
      programId: 'test-program',
      availableEquipment: ['dumbbells', 'bench', 'bodyweight'],
      mesocycle: { weeks: 4, deloadWeek: null, progression: 'linear' },
      lastWeeklyReviewBasis: null,
      adaptationHistory: [],
      sessions: [
        { id: 'w1d1', week: 1, day: 1, title: 'Upper', dateISO: '2026-06-15', status: 'planned', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' }] },
        { id: 'w1d2', week: 1, day: 2, title: 'Lower', dateISO: '2026-06-18', status: 'planned', blocks: [{ exerciseId: 'goblet-squat', sets: 3, reps: '10' }] },
        { id: 'w2d1', week: 2, day: 1, title: 'Upper', dateISO: '2026-06-22', status: 'planned', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' }] },
      ],
    };
  }
  const TODAY_SUN = '2026-06-21'; // Sunday ending the reviewed week

  it('emits and applies a recovery-session directive for mid-band fatigue', ()=>{
    const schedule = buildSchedule();
    // Two extra planned sessions inside the lookback were never logged.
    schedule.sessions.unshift(
      { id: 'w0y', week: 1, day: 0, title: 'Extra B', dateISO: '2026-06-11', status: 'planned', blocks: [] },
      { id: 'w0x', week: 1, day: 0, title: 'Extra A', dateISO: '2026-06-13', status: 'planned', blocks: [] },
    );
    // Clean linear decline across the last six exposures (high-confidence
    // trend), one near-failure set this week (below the legacy count gate),
    // a hard readiness dip today, high soreness, and two missed sessions.
    const history = [
      sess('2026-06-01', [block('bench-press-dumbbell', [set(8, 27, 7)])]),
      sess('2026-06-03', [block('bench-press-dumbbell', [set(8, 26, 7)])]),
      sess('2026-06-05', [block('bench-press-dumbbell', [set(8, 25, 7)])]),
      sess('2026-06-07', [block('bench-press-dumbbell', [set(8, 24, 7)])]),
      sess('2026-06-09', [block('bench-press-dumbbell', [set(8, 23, 7)])]),
      { id: 'w1d1', dateISO: '2026-06-15', blocks: [block('bench-press-dumbbell', [set(8, 22, 9)])] },
      { id: 'w1d2', dateISO: '2026-06-18', blocks: [block('goblet-squat', [set(8, 22, 7)])] },
    ];
    const readinessLog = [
      { dateISO: '2026-06-15', score: 62, soreness: 4 },
      { dateISO: '2026-06-18', score: 64, soreness: 5 },
      { dateISO: '2026-06-21', score: 15, soreness: 5 },
    ];

    const review = reviewCompletedWeek({ schedule, history, readinessLog, todayISO: TODAY_SUN });
    assert.equal(review.ready, true);
    assert.equal(review.deloadDecision.yes, false, 'legacy verdict must stay quiet for this band');
    assert.equal(review.readinessDecision.recommendation, 'recovery-session',
      `expected recovery-session, got ${review.readinessDecision.recommendation} at ${review.readinessDecision.score} pts`);

    const d = review.directives.find(x => x.exerciseId === 'bench-press-dumbbell');
    assert.ok(d, 'missing directive');
    assert.equal(d.kind, 'recovery-session');
    assert.equal(d.sets, Math.max(1, Math.round(3 * 0.75)));

    const applied = applyWeeklyReview(schedule, review);
    assert.equal(applied.changed, true);
    const targetBlock = applied.schedule.sessions.find(s=> s.id === 'w2d1').blocks[0];
    assert.equal(targetBlock.sets, 2);
    assert.match(targetBlock.adaptation.kind, /weekly-recovery-session/);
    const again = applyWeeklyReview(applied.schedule, review);
    assert.equal(again.changed, false);
    assert.equal(again.alreadyApplied, true);
  });

  it('suppresses add-sets while the classifier advises small-adjustment — and allows it when healthy', ()=>{
    const history = [
      sess('2026-06-09', [block('bench-press-dumbbell', [set(12, 22, 7)])]),
      sess('2026-06-11', [block('bench-press-dumbbell', [set(12, 22, 7)])]),
      { id: 'w1d1', dateISO: '2026-06-15', blocks: [block('bench-press-dumbbell', [set(12, 22, 7), set(12, 22, 7), set(12, 22, 7)])] },
      { id: 'w1d2', dateISO: '2026-06-18', blocks: [block('goblet-squat', [set(10, 24, 9)])] },
    ];
    const tiredLog = [
      { dateISO: '2026-06-15', score: 70, soreness: 4 },
      { dateISO: '2026-06-18', score: 68, soreness: 4 },
      { dateISO: '2026-06-21', score: 25, soreness: 4 },
    ];
    const healthyLog = [
      { dateISO: '2026-06-15', score: 75, soreness: 2 },
      { dateISO: '2026-06-18', score: 74, soreness: 2 },
      { dateISO: '2026-06-21', score: 76, soreness: 2 },
    ];

    const tired = reviewCompletedWeek({ schedule: buildSchedule(), history, readinessLog: tiredLog, todayISO: TODAY_SUN });
    assert.equal(tired.ready, true);
    assert.equal(tired.readinessDecision.recommendation, 'small-adjustment',
      `got ${tired.readinessDecision.recommendation} at ${tired.readinessDecision.score}`);
    assert.ok(!tired.directives.some(d=> d.kind === 'add-sets'), 'no volume should be added under small-adjustment');

    const healthy = reviewCompletedWeek({ schedule: buildSchedule(), history, readinessLog: healthyLog, todayISO: TODAY_SUN });
    assert.equal(healthy.deloadDecision.yes, false);
    assert.ok(healthy.directives.some(d=> d.kind === 'add-sets'), 'the same week earns a set on healthy readiness');
  });

  it('still reports readiness alongside a legacy deload', ()=>{
    const schedule = buildSchedule();
    const priorWeek = [
      { id: 'p1', dateISO: '2026-06-10', blocks: [block('bench-press-dumbbell', [set(8, 20, 7)])] },
    ];
    const history = [
      ...priorWeek,
      { id: 'w1d1', dateISO: '2026-06-15', blocks: [block('bench-press-dumbbell', [set(8, 20, 9), set(8, 20, 9), set(8, 20, 9), set(8, 20, 9)])] },
      { id: 'w1d2', dateISO: '2026-06-18', blocks: [block('goblet-squat', [set(10, 24, 9), set(10, 24, 9)])] },
    ];
    const review = reviewCompletedWeek({ schedule, history, todayISO: TODAY_SUN });
    assert.equal(review.deloadDecision.yes, true);
    const d = review.directives.find(x => x.exerciseId === 'bench-press-dumbbell');
    assert.equal(d.kind, 'deload');
    assert.ok(review.readinessDecision && typeof review.readinessDecision.score === 'number');
  });
});

describe('progression-model wiring', ()=>{
  // Looser estimator gates so fixtures pass deterministically.
  const LOOSE = { progressionModel: {
    minExposuresPerExercise: 4, minExposuresPerMovement: 6, minExposuresPerRepRange: 6,
    minSessionsForResponseShift: 12, minPairsFatigue: 99, minPerBucketFrequency: 99,
    volumeMinWeeks: 99, equivalenceMinPairs: 99, maxIncPctDelta: 0.02,
    autoregulationShiftMax: 0.01, readinessMinSessions: 6, readinessMinInputs: 3,
  } };

  it('stays inert below the escalation gate even with long history', ()=>{
    const model = deriveProgressionModel({ history: risingBench({ days: 6 }), config: LOOSE });
    const rg = model.estimates.readinessGraduation;
    // The data-coverage gate can be open, but with healthy inputs the
    // classifier says as-planned and NOTHING is applied.
    assert.equal(rg.recommendation, 'as-planned');
    assert.equal(model.readinessApplied, false);
    const cap = model.capabilities.find(c=> c.id === 'graduated-readiness');
    assert.notEqual(cap.status, 'active');
    assert.equal(model.overlayConfig.progression.personalisedRate, undefined);

    // And with too little data the capability is outright insufficient.
    const cold = deriveProgressionModel({ history: risingBench({ days: 2 }), config: LOOSE });
    assert.equal(cold.estimates.readinessGraduation.ready, false);
    assert.equal(cold.capabilities.find(c=> c.id === 'graduated-readiness').status, 'insufficient-data');
  });

  it('activates on gated evidence and shifts the personalisedRate band down, bounded', ()=>{
    const history = risingBench({ days: 8, baseKg: 20, rpe: 9 });
    const readinessLog = readinessEntries([24, 22, 25, 23, 21, 24, 22, 20], { startDay: 5, soreness: 5 });
    const model = deriveProgressionModel({ history, readinessLog, config: LOOSE });
    const rg = model.estimates.readinessGraduation;
    assert.equal(rg.ready, true);
    assert.equal(rg.recommendation, 'genuine-deload');
    const cap = model.capabilities.find(c=> c.id === 'graduated-readiness');
    assert.equal(cap.status, 'active');
    assert.equal(model.readinessApplied, true);

    const pr = model.overlayConfig.progression.personalisedRate;
    assert.ok(pr, 'expected a personalisedRate overlay');
    // Deterministic here: autoregulation is inert in this fixture, so the
    // shift is exactly −readinessShiftMax from the defaults.
    const base = DEFAULT_ARISE_PRIORS.progression.personalisedRate;
    const shift = DEFAULT_ARISE_PRIORS.progressionModel.readinessShiftMax;
    const expectedMax = Math.round((base.appliedLoadPctMax - shift) * 10000) / 10000;
    assert.ok(Math.abs(pr.appliedLoadPctMax - expectedMax) < 1e-9, `max ${pr.appliedLoadPctMax} vs ${expectedMax}`);
    assert.equal(pr.appliedLoadPctMin, 0.007); // 0.015 − 0.008, above the 0.005 floor
  });

  it('annotates recommendNextWithModel when readiness shaping applies', ()=>{
    const history = risingBench({ days: 8, baseKg: 20, rpe: 9 });
    const readinessLog = readinessEntries([24, 22, 25, 23, 21, 24, 22, 20], { startDay: 5, soreness: 5 });
    const rec = recommendNextWithModel({ exerciseId: 'bench-press-dumbbell', history, readinessLog, config: LOOSE });
    assert.ok(rec.__progressionModel.applied);
    const cold = recommendNextWithModel({ exerciseId: 'bench-press-dumbbell', history: [] });
    assert.equal(cold.__progressionModel.applied, false);
  });

  it('never mutates the frozen default priors', ()=>{
    const before = JSON.stringify(DEFAULT_ARISE_PRIORS);
    const history = risingBench({ days: 8, baseKg: 20, rpe: 9 });
    deriveProgressionModel({ history, readinessLog: readinessEntries([24, 22, 25], { soreness: 5 }), config: LOOSE });
    assert.equal(JSON.stringify(DEFAULT_ARISE_PRIORS), before);
  });
});
