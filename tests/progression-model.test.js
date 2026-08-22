import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  exerciseResponseEstimates,
  movementResponseEstimates,
  repRangeResponseEstimates,
  volumeToleranceEstimate,
  fatigueCarryoverEstimate,
  frequencyEffectEstimate,
  orderEffectEstimate,
  substitutionEquivalenceEstimate,
  autoregulationShiftEstimate,
  assessCapabilities,
  deriveProgressionModel,
  recommendNextWithModel,
} from '../src/lib/progressionModel.js';
import { DEFAULT_ARISE_PRIORS } from '../src/lib/priors.js';

function sess(dateISO, blocks){ return { id: `s-${dateISO}`, dateISO, blocks }; }
function block(exerciseId, sets){ return { exerciseId, sets }; }
function set(reps, weightKg, rpe){ return { reps: String(reps), weightKg: String(weightKg), rpe: rpe == null ? '' : String(rpe) }; }

// Rising dumbbell bench: 20kg → 23kg over six weekly sessions.
function risingBench(startDay = 1, baseKg = 20){
  const out = [];
  const weights = [baseKg, baseKg, baseKg + 1, baseKg + 1, baseKg + 2, baseKg + 3];
  weights.forEach((w, i)=>{
    const day = startDay + i * 5;
    out.push(sess(`2026-01-${String(day).padStart(2, '0')}`, [block('bench-press-dumbbell', [set(8, w, 7)])]));
  });
  return out;
}
// Looser gates so small fixtures can pass their own thresholds deterministically.
const LOOSE = { progressionModel: {
  minExposuresPerExercise: 4,
  minExposuresPerMovement: 6,
  minExposuresPerRepRange: 6,
  minSessionsForResponseShift: 8,
  minPairsFatigue: 3,
  minPerBucketFrequency: 3,
  volumeMinWeeks: 5,
  equivalenceMinPairs: 3,
  maxIncPctDelta: 0.02,
  autoregulationShiftMax: 0.01,
} };

describe('response estimators', ()=>{
  it('estimates a positive individual response for a consistently rising lift', ()=>{
    const rates = exerciseResponseEstimates(risingBench(), { config: LOOSE });
    const r = rates['bench-press-dumbbell'];
    assert.ok(r, 'expected an estimate for bench');
    assert.ok(r.weeklyLoadPct > 0);
    assert.ok(r.n >= 4);
  });

  it('groups responses by movement pattern and rep-range bucket', ()=>{
    const rates = exerciseResponseEstimates(risingBench(), { config: LOOSE });
    const movements = movementResponseEstimates(risingBench(), rates, { config: LOOSE });
    const ranges = repRangeResponseEstimates(risingBench(), rates, { config: LOOSE });
    assert.ok(Object.keys(movements).length >= 1, 'expected at least one movement group');
    for(const v of Object.values(movements)) assert.ok(v.n >= 6 && Number.isFinite(v.weeklyLoadPct));
    assert.ok(Object.keys(ranges).some(k => /^(low|mid|high)/.test(k)), `unexpected buckets: ${Object.keys(ranges)}`);
  });

  it('measures volume tolerance over paired weeks', ()=>{
    // Eight sessions spaced exactly one week apart (each a fresh Monday week).
    const weekStarts = ['2026-02-02','2026-02-09','2026-02-16','2026-02-23','2026-03-02','2026-03-09','2026-03-16','2026-03-23'];
    const history = [];
    let kg = 40;
    for(let i = 0; i < weekStarts.length; i++){
      history.push(sess(weekStarts[i], [
        block('barbell-squat', [set(5, kg, 7), set(5, kg, 7)]),
        block('bench-press-dumbbell', [set(8, kg / 2, 7)]),
      ]));
      kg += 2;
    }
    const v = volumeToleranceEstimate(history, { config: LOOSE });
    assert.equal(v.ready, true);
    assert.ok(v.pairedWeeks >= 5);
    assert.equal(v.positiveFraction, 1);
    assert.ok(v.estimatedTolerableWeeklySets >= 1);
  });

  it('detects fatigue carry-over after high-RPE sessions', ()=>{
    const days = [1,2,3,4,5,8,9,10,11,15,16,17,18];
    const plan = ['N','H','X','N','N','H','X','N','N','H','X','N','N'];
    const weights = { N: [100,102,104,105], H: null, X: [85,88,90] };
    let ni = 0, xi = 0;
    const history = days.map((day, i)=>{
      const kind = plan[i];
      if(kind === 'N') return sess(`2026-03-${String(day).padStart(2,'0')}`, [block('bench-press-dumbbell', [set(5, weights.N[ni++ % 4], 7)])]);
      if(kind === 'H') return sess(`2026-03-${String(day).padStart(2,'0')}`, [block('bench-press-dumbbell', [set(5, 110, 9), set(5, 110, 9)])]);
      return sess(`2026-03-${String(day).padStart(2,'0')}`, [block('bench-press-dumbbell', [set(5, weights.X[xi++ % 3], 8)])]);
    });
    const f = fatigueCarryoverEstimate(history, { config: LOOSE });
    assert.equal(f.ready, true);
    assert.ok(f.pairs.high >= 3 && f.pairs.normal >= 3);
    assert.ok(f.carryoverDelta < 0, `expected negative carry-over, got ${f.carryoverDelta}`);
  });

  it('buckets frequency effects by inter-session gap', ()=>{
    const dates = ['2026-04-01','2026-04-02','2026-04-10','2026-04-11','2026-04-19','2026-04-20','2026-04-28'];
    const weights = [20,21,18,19,17,18,16];
    const history = dates.map((d, i)=> sess(d, [block('bench-press-dumbbell', [set(5, weights[i], '')])]));
    const f = frequencyEffectEstimate(history, { config: LOOSE });
    assert.equal(f.ready, true);
    assert.ok(f.buckets['≤2d'].meanChange > 0);
    assert.ok(f.buckets['≥7d'].meanChange < 0);
  });

  it('quantifies the later-slot penalty for order effects', ()=>{
    const history = [];
    for(let i = 0; i < 6; i++){
      history.push(sess(`2026-05-0${i + 1}`, [
        block('bench-press-dumbbell', [set(5, 60, '')]),
        block('barbell-squat', [set(5, 80, '')]),
        block('bicep-curl', [set(10, 12, '')]),
      ]));
      history.push(sess(`2026-05-1${i + 1}`, [
        block('barbell-squat', [set(5, 80, '')]),
        block('bicep-curl', [set(10, 12, '')]),
        block('bench-press-dumbbell', [set(5, 50, '')]),
      ]));
    }
    const o = orderEffectEstimate(history, { config: LOOSE });
    assert.equal(o.ready, true);
    assert.ok(o.n.first >= 5 && o.n.later >= 5);
    assert.ok(o.laterPenalty < 0);
  });

  it('models substitute equivalence from recorded swaps', ()=>{
    const history = [
      sess('2026-06-01', [{ exerciseId: 'barbell-squat', sets: [set(5, 40, '')] }]),
      sess('2026-06-03', [{ exerciseId: 'goblet-squat', substitutionFrom: 'barbell-squat', sets: [set(8, 36, '')] }]),
      sess('2026-06-05', [{ exerciseId: 'barbell-squat', sets: [set(5, 42, '')] }]),
      sess('2026-06-08', [{ exerciseId: 'goblet-squat', substitutionFrom: 'barbell-squat', sets: [set(8, 38, '')] }]),
      sess('2026-06-10', [{ exerciseId: 'goblet-squat', substitutionFrom: 'barbell-squat', sets: [set(8, 40, '')] }]),
    ];
    const e = substitutionEquivalenceEstimate(history, { config: LOOSE });
    assert.equal(e.ready, true);
    assert.ok(e.n >= 3);
    assert.ok(Number.isFinite(e.meanEquivalenceRatio));
    assert.equal(e.within90Pct, 1);
  });
});

describe('autoregulation shift', ()=>{
  it('proposes a positive shift when RPEs run roomy, none when sparse', ()=>{
    const roomy = [];
    for(let i = 1; i <= 12; i++){
      roomy.push(sess(`2026-07-${String(i).padStart(2,'0')}`, [block('bench-press-dumbbell', [set(8, 20, 6), set(8, 20, 6)])]));
    }
    const est = autoregulationShiftEstimate(roomy, { config: LOOSE });
    assert.equal(est.ready, true);
    assert.ok(est.shift > 0);

    const sparse = autoregulationShiftEstimate(roomy.slice(0, 2), { config: LOOSE });
    assert.equal(sparse.ready, false);
  });
});

describe('capability gating + overlay', ()=>{
  function weakStudy(){
    return { overall: {}, byExercise: {
      'bench-press-dumbbell': {
        arise: { n: 10, conclusive: true, targetAchievementRate: 0.3 },
        'double-progression': { n: 10, conclusive: true, targetAchievementRate: 0.6 },
      },
    } };
  }
  function strongStudy(){
    return { overall: {}, byExercise: {
      'bench-press-dumbbell': {
        arise: { n: 10, conclusive: true, targetAchievementRate: 0.7 },
        'double-progression': { n: 10, conclusive: true, targetAchievementRate: 0.4 },
      },
    } };
  }

  it('opens exercise-specific logic only under proven weakness', ()=>{
    const history = risingBench();
    const capsWeak = assessCapabilities({ history, study: weakStudy(), estimates: deriveProgressionModel({ history, study: weakStudy(), config: LOOSE }).estimates, config: LOOSE });
    assert.equal(capsWeak.find(c=> c.id === 'exercise-specific').status, 'active');

    const capsStrong = assessCapabilities({ history, study: strongStudy(), estimates: deriveProgressionModel({ history, study: strongStudy(), config: LOOSE }).estimates, config: LOOSE });
    assert.equal(capsStrong.find(c=> c.id === 'exercise-specific').status, 'dormant');
  });

  it('emits a bounded strategy override exactly for weak exercises', ()=>{
    const model = deriveProgressionModel({ history: risingBench(), study: weakStudy(), config: LOOSE });
    assert.equal(model.activeOverrideCount, 1);
    const key = '__model:bench-press-dumbbell';
    assert.ok(model.overlayConfig.progression.strategies[key], 'missing tuned strategy');
    assert.ok(model.overlayConfig.progression.strategyByExercise['bench-press-dumbbell'] === key);
    const tuned = model.overlayConfig.progression.strategies[key].incPct;
    // Bench maps to the strength strategy (incPct 0.05); tuning must stay
    // inside ±maxIncPctDelta of that default regardless of measured response.
    assert.ok(tuned > 0.005 && tuned <= 0.05 + LOOSE.progressionModel.maxIncPctDelta, `tuned ${tuned} out of bounds`);
  });

  it('never mutates the frozen default priors', ()=>{
    const before = JSON.stringify(DEFAULT_ARISE_PRIORS);
    deriveProgressionModel({ history: risingBench(), study: weakStudy(), config: LOOSE });
    recommendNextWithModel({ exerciseId: 'bench-press-dumbbell', history: risingBench(), study: weakStudy() });
    assert.equal(JSON.stringify(DEFAULT_ARISE_PRIORS), before);
  });

  it('recommendNextWithModel stays inert without evidence and annotates results', ()=>{
    const cold = recommendNextWithModel({ exerciseId: 'bench-press-dumbbell', history: [] });
    assert.match(cold.reason, /No history/);
    assert.equal(cold.__progressionModel.applied, false);

    const warm = recommendNextWithModel({ exerciseId: 'bench-press-dumbbell', history: risingBench(), study: weakStudy() });
    assert.ok(warm.__progressionModel.applied, 'expected model application under proven weakness');
    assert.ok(warm.reps != null || warm.load != null);
  });
});

import { shortBreakInfo } from '../src/lib/progression.js';
import { recommendNext } from '../src/lib/progression.js';

describe('short-break return easing (evidence-gated)', ()=>{
  // 4 exposures, then a 10-day gap, then judge the next recommendation.
  function gappedHistory(){
    const days = ['2026-08-03','2026-08-06','2026-08-10','2026-08-13'];
    const weights = [20,20,21,21];
    const history = days.map((d, i)=> sess(d, [block('bench-press-dumbbell', [set(8, weights[i], 7)])]));
    return history;
  }

  it('stays fully inert without the policy � engine treats gaps like any other gap', ()=>{
    const rec = recommendNext({ exerciseId:'bench-press-dumbbell', history: gappedHistory(), asOfDateISO: '2026-08-23' });
    assert.ok(!rec.shortBreak, 'policy absent but easing fired');
    const info = shortBreakInfo(gappedHistory(), 'bench-press-dumbbell', { asOfDateISO: '2026-08-23' });
    // Detection is inert without an opened policy — no easing, no multiplier.
    assert.equal(info.hasShortBreak, false);
    assert.equal(info.multiplier, 1);
    const eased = recommendNext({
      exerciseId:'bench-press-dumbbell', history: gappedHistory(), asOfDateISO: '2026-08-23',
      config: { progression: { shortBreakPolicy: { enabled:true, minDays:5, moderateDays:14, lightLoadMultiplier:0.95, moderateLoadMultiplier:0.9 } } },
    });
    assert.equal(eased.load, 20); // 21 * 0.95 = 19.95 ? snapped to 20
    assert.match(eased.reason, /ease back/);
  });

  it('model capability stays dormant until BOTH gates hold', ()=>{
    const history = risingBench();
    const model = deriveProgressionModel({ history, study: weakStudyGlobal(), config: LOOSE });
    const cap = model.capabilities.find(c=> c.id === 'short-break-return');
    // No frequency data in this fixture ? cannot open.
    assert.notEqual(cap.status, 'active');
    assert.equal(model.overlayConfig.progression?.shortBreakPolicy?.enabled, undefined);
  });

  it('opens when =7d gaps show no detriment AND arise stagnates vs double-progression', ()=>{
    // Frequency fixture: =7d transitions RISING (no detriment).
    const dates = ['2026-04-01','2026-04-10','2026-04-19','2026-04-28'];
    const weights = [20,22,24,26];
    const gapRising = dates.map((d,i)=> sess(d, [block('bench-press-dumbbell', [set(8, weights[i], '')])]));
    const study = {
      overall: {
        arise: { conclusive: true, stagnationRate: 0.5 },
        'double-progression': { conclusive: true, stagnationRate: 0.1 },
      },
      byExercise: {},
    };
    const estimates = deriveProgressionModel({ history: gapRising, study, config: LOOSE }).estimates;
    const model = deriveProgressionModel({ history: gapRising, study, config: LOOSE });
    const cap = model.capabilities.find(c=> c.id === 'short-break-return');
    assert.equal(cap.status, 'active');
    assert.equal(model.overlayConfig.progression.shortBreakPolicy.enabled, true);

    // And the engine honours the opened policy across a real 10-day gap.
    const withGap = [...gapRising.slice(0, 3), sess('2026-05-08', [block('bench-press-dumbbell', [set(8, 24, 7)])])];
    const rec = recommendNextWithModel({ exerciseId:'bench-press-dumbbell', history: withGap, asOfDateISO: '2026-05-18', study });
    assert.match(rec.reason, /ease back/);
  });

  it('refuses to open when =7d gaps actually hurt', ()=>{
    const dates = ['2026-04-01','2026-04-10','2026-04-19','2026-04-28'];
    const weights = [26,22,24,20]; // long gaps lose performance
    const gapFalling = dates.map((d,i)=> sess(d, [block('bench-press-dumbbell', [set(8, weights[i], '')])]));
    const study = { overall: { arise:{conclusive:true,stagnationRate:.5}, 'double-progression':{conclusive:true,stagnationRate:.1} }, byExercise:{} };
    const model = deriveProgressionModel({ history: gapFalling, study, config: LOOSE });
    const cap = model.capabilities.find(c=> c.id === 'short-break-return');
    assert.notEqual(cap.status, 'active');
    assert.equal(model.overlayConfig.progression?.shortBreakPolicy?.enabled, undefined);
  });
});

function weakStudyGlobal(){ return { overall: {}, byExercise: {} }; }
