import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECOMMENDATION_OUTCOME_LABELS,
  isProspectiveRecord,
  confidenceBandOf,
  recommendationTypeOf,
  shrinkRate,
  classifyRecommendationOutcome,
} from '../src/lib/longitudinalCore.js';
import { calibrateRecommendations } from '../src/lib/evaluation.js';
import { personalCalibrationFromHistory } from '../src/lib/progression.js';
import { coachingCalibration } from '../src/lib/product.js';
import { recordRecommendation, attachOutcome, loadEvaluationLedger, markRecommendationOverride } from '../src/lib/longitudinal.js';
import { recommendNext } from '../src/lib/progression.js';
import { recommendNextWithPolicy } from '../src/lib/progressionPolicies.js';
import { withProvenance } from '../src/lib/domain.js';

function memoryStorage(){
  const map = new Map();
  return {
    getItem: key=> map.has(key) ? map.get(key) : null,
    setItem: (key, value)=> map.set(key, String(value)),
    removeItem: key=> map.delete(key),
  };
}
const CONSENT = { telemetryEnabled: true };

// A minimal, controllable ledger row (already-resolved or open) for the pure
// classifier + calibration tests. Mirrors the real record/outcome shape.
function row(o = {}){
  const outcome = o.outcome === null ? null : {
    followed: o.followed === null ? null : (o.followed !== false),
    metTarget: !!o.met,
    changePct: o.changePct ?? 0.03,
    failedSets: o.failed ?? 0,
    rpe: o.rpe ?? '8.5',
    pain: o.pain || false,
    techniqueWarning: o.technique || false,
  };
  return {
    id: o.id || 'row',
    exerciseId: o.exerciseId || 'bench-press-dumbbell',
    movementPattern: o.movement || 'horizontal-push',
    recommendedAction: o.action || 'add_load',
    basis: { previousBest: o.prev || { reps: 12, weightKg: 20, assistedKg: 0, e1rm: 28 }, trainingAgePhase: o.phase || 'intermediate' },
    recommendation: { load: o.load ?? 25, reps: o.reps ?? 8, assistKg: null },
    prescription: { arm: 'arise', load: o.load ?? 25, reps: o.reps ?? 8, assistKg: null },
    audit: { confidence: o.band ? { band: o.band } : null, policy: o.policy || 'standard' },
    provenance: { origin: o.origin || 'live-engine' },
    outcome,
  };
}

const T = { meaningfulGainPct: 0.02, regressionCutPct: 0.05, easyRpeThreshold: 7, aggressiveLoadPct: 1.1 };

describe('recommendation outcome labels', ()=>{
  it('exposes the five conservative labels', ()=>{
    assert.deepEqual(RECOMMENDATION_OUTCOME_LABELS, ['successful', 'neutral', 'too-aggressive', 'too-conservative', 'insufficient-evidence']);
  });

  it('a met, non-easy increase that was followed is successful', ()=>{
    const c = classifyRecommendationOutcome(row({ met: true, changePct: 0.03, rpe: '8.5', load: 22, prev: { weightKg: 20, reps: 12, assistedKg: 0 } }), T);
    assert.equal(c.label, 'successful');
    assert.equal(c.attempted, true);
  });

  it('a missed target after an attempted increase is too-aggressive', ()=>{
    assert.equal(classifyRecommendationOutcome(row({ met: false }), T).label, 'too-aggressive');
  });

  it('a regression after an increase is too-aggressive', ()=>{
    assert.equal(classifyRecommendationOutcome(row({ met: true, changePct: -0.08 }), T).label, 'too-aggressive');
  });

  it('a failed set on a progression attempt is too-aggressive', ()=>{
    assert.equal(classifyRecommendationOutcome(row({ met: true, failed: 1, changePct: 0 }), T).label, 'too-aggressive');
  });

  it('an easy, unaggressive gain is too-conservative', ()=>{
    const c = classifyRecommendationOutcome(row({ met: true, changePct: 0.04, rpe: '6', load: 21, prev: { weightKg: 20, reps: 12, assistedKg: 0 } }), T);
    assert.equal(c.label, 'too-conservative');
  });

  it('a hold that still gained is too-conservative', ()=>{
    const c = classifyRecommendationOutcome(row({ action: 'hold', met: true, changePct: 0.05 }), T);
    assert.equal(c.label, 'too-conservative');
  });

  it('an unfollowed or unknown-adherence prescription is NOT punished', ()=>{
    const notFollowed = classifyRecommendationOutcome(row({ followed: false, met: false }), T);
    assert.equal(notFollowed.label, 'insufficient-evidence');
    assert.equal(notFollowed.attempted, false);
    const unknown = classifyRecommendationOutcome(row({ followed: null }), T);
    assert.equal(unknown.label, 'insufficient-evidence');
    assert.equal(unknown.attempted, false);
    // A followed increase that was missed IS attempted and IS graded as too-aggressive.
    assert.equal(classifyRecommendationOutcome(row({ action: 'add_load', met: false }), T).attempted, true);
  });

  it('a pain or technique session is neutral and not attempted (engine not graded)', ()=>{
    assert.equal(classifyRecommendationOutcome(row({ met: false, pain: true }), T).label, 'neutral');
    assert.equal(classifyRecommendationOutcome(row({ met: false, technique: true }), T).attempted, true);
  });

  it('an unresolved record is insufficient-evidence', ()=>{
    assert.equal(classifyRecommendationOutcome(row({ outcome: null }), T).label, 'insufficient-evidence');
  });
});

describe('prospective-only evidence gate', ()=>{
  it('live-engine records with a live outcome count; reconstructed ones never do', ()=>{
    assert.equal(isProspectiveRecord(row()), true);
    assert.equal(isProspectiveRecord(row({ origin: 'imported' })), false);
    assert.equal(isProspectiveRecord(row({ origin: 'replayed' })), false);
    assert.equal(isProspectiveRecord(row({ origin: 'seed' })), false);
    assert.equal(isProspectiveRecord({ provenance: { origin: 'live-engine' }, outcomeProvenance: { origin: 'replayed' } }), false);
  });
  it('confidence band and recommendation type read from the frozen audit', ()=>{
    assert.equal(confidenceBandOf(row({ band: 'high' })), 'high');
    assert.equal(confidenceBandOf(row()), null);
    assert.equal(recommendationTypeOf(row({ action: 'add_reps' })), 'add_reps');
  });
});

describe('shrinkage toward safe defaults', ()=>{
  it('a single success barely moves off the default prior', ()=>{
    const one = shrinkRate({ successes: 1, samples: 1, prior: 0.6, pseudoCount: 5 });
    assert.ok(one.rate === 1);
    assert.ok(one.shrunk < 0.9 && one.shrunk > 0.6, `expected near prior, got ${one.shrunk}`);
    assert.ok(one.weight < 0.2);
  });
  it('a large sample converges to the empirical rate', ()=>{
    const many = shrinkRate({ successes: 90, samples: 100, prior: 0.6, pseudoCount: 5 });
    assert.equal(many.rate, 0.9);
    assert.ok(many.shrunk >= 0.85 && many.shrunk <= 0.9);
    assert.ok(many.weight > 0.9);
  });
  it('zero samples returns the prior with no weight', ()=>{
    const none = shrinkRate({ successes: 0, samples: 0, prior: 0.6, pseudoCount: 5 });
    assert.equal(none.rate, null);
    assert.equal(none.shrunk, 0.6);
    assert.equal(none.weight, 0);
  });
});

describe('recommendation calibration aggregation', ()=>{
  it('counts only prospective, resolved pairs and reports withheld segments honestly', ()=>{
    const ledger = [
      row({ id: 'a', met: true }), row({ id: 'b', met: true }), row({ id: 'c', met: false }),
      row({ id: 'imp', met: false, origin: 'imported' }),
      row({ id: 'open', outcome: null }),
    ];
    const cal = calibrateRecommendations(ledger, { config: null });
    assert.equal(cal.prospective, 4);
    assert.equal(cal.resolved, 3);
    assert.equal(cal.open, 1);
    assert.equal(cal.excludedReconstructed, 1);
    assert.equal(cal.overall.conclusive, false);           // 3 < minimumSamples(5)
    assert.equal(cal.overall.successRate, null);           // withheld
    assert.ok(cal.overall.shrunkSuccessRate > 0.4 && cal.overall.shrunkSuccessRate < 0.8); // pulled to default
    assert.equal(cal.tendency, 'learning');
    assert.equal(cal.confidenceQuality, 'unknown');
  });
  it('a conclusive segment reports success + over/under rates and a bounded calibration error', ()=>{
    const ledger = [];
    for(let i = 0; i < 6; i++) ledger.push(row({ id: `s${i}`, met: true, band: 'high' }));
    for(let i = 0; i < 4; i++) ledger.push(row({ id: `o${i}`, met: false, band: 'high' }));
    const cal = calibrateRecommendations(ledger, { config: null });
    assert.equal(cal.overall.conclusive, true);
    assert.equal(cal.overall.successful, 6);
    assert.equal(cal.overall.tooAggressive, 4);
    assert.equal(cal.overall.successRate, 0.6);
    assert.equal(cal.overall.overPrescriptionRate, 0.4);
    assert.ok(cal.overall.calibrationError >= 0 && cal.overall.calibrationError <= 1);
    assert.equal(cal.byConfidenceBand.high.conclusive, true);
    assert.equal(cal.tendency, 'over-prescribing');
  });
  it('segments by exercise, category, policy, experience, type and band', ()=>{
    const cal = calibrateRecommendations([
      row({ band: 'medium', policy: 'conservative', exerciseId: 'bench-press-dumbbell' }),
      row({ band: 'high', policy: 'aggressive', exerciseId: 'pull-up' }),
    ], { config: null });
    for(const key of ['byExercise', 'byCategory', 'byPolicy', 'byExperience', 'byType', 'byConfidenceBand']){
      assert.ok(cal[key] && typeof cal[key] === 'object', `${key} present`);
    }
    assert.ok(cal.byPolicy.conservative);
    assert.ok('medium' in cal.byConfidenceBand);
  });
  it('empty ledger yields an honest "not yet" state, not a fabricated 0%', ()=>{
    const cal = calibrateRecommendations([], { config: null });
    assert.equal(cal.prospective, 0);
    assert.equal(cal.overall.successRate, null);
    assert.match(cal.note, /Need .* more prospective/);
  });
  it('is deterministic across repeated aggregation', ()=>{
    const ledger = [row({ id: 'a', met: true }), row({ id: 'b', met: false }), row({ id: 'c', band: 'low' })];
    assert.deepEqual(calibrateRecommendations(ledger, { config: null }).overall, calibrateRecommendations(ledger, { config: null }).overall);
  });
});

describe('conservative personalisation learned from logged history only', ()=>{
  // History blocks carry a frozen first-visible prescription + the performed set.
  const presc = load => Object.freeze({ prescriptionId: 'x:r1', prescribedReps: 8, prescribedLoadKg: load, prescribedAssistKg: null });
  const perf = (weightKg, rpe, reps = '8') => ({ reps: String(reps), weightKg: String(weightKg), rpe: String(rpe), completed: true, skipped: false, failed: false, assistedKg: 0 });

  function sessionsWith(exposure){ // exposure: [{prescribe, performed, rpe?, reps?}] with rising dates
    return exposure.map((e, i)=> ({ id: `d${i}`, dateISO: `2026-02-0${i + 1}`, blocks: [{ exerciseId: 'bench-press-dumbbell', prescription: presc(e.prescribe), sets: [perf(e.performed, e.rpe ?? 8.5, e.reps ?? '8')] }] }));
  }

  it('sparse history keeps the default stance (never learns from a couple sessions)', ()=>{
    const pc = personalCalibrationFromHistory(sessionsWith([{ prescribe: 25, performed: 25 }]), { exerciseId: 'bench-press-dumbbell' });
    assert.equal(pc.active, false);
    assert.equal(pc.jumpMultiplier, 1);
    assert.equal(pc.samples, 1);
  });
  it('repeated over-prescription shrinks future jumps', ()=>{
    // Genuine misses AT the shown setup (25×6 vs 25×8): the prescription was
    // attempted, so it is graded — unlike a deliberate back-off to a lighter load.
    const history = sessionsWith([
      { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' },
      { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' },
    ]);
    const pc = personalCalibrationFromHistory(history, { exerciseId: 'bench-press-dumbbell' });
    assert.equal(pc.active, true);
    assert.equal(pc.direction, -1);
    assert.ok(pc.jumpMultiplier < 1 && pc.jumpMultiplier >= 0.85, `multiplier ${pc.jumpMultiplier}`);
    assert.match(pc.note, /more cautiously/);
    assert.match(pc.headline, /Smaller increase/);
  });
  it('repeated easy, successful gains nudge progression slightly bolder (bounded)', ()=>{
    // Performed load MATCHES the shown load each time; gains came easy.
    const history = sessionsWith([
      { prescribe: 20, performed: 20, rpe: 5 }, { prescribe: 22, performed: 22, rpe: 5 }, { prescribe: 24, performed: 24, rpe: 5 },
      { prescribe: 26, performed: 26, rpe: 5 }, { prescribe: 28, performed: 28, rpe: 5 },
    ]);
    const pc = personalCalibrationFromHistory(history, { exerciseId: 'bench-press-dumbbell' });
    assert.equal(pc.active, true);
    assert.equal(pc.direction, 1);
    assert.ok(pc.jumpMultiplier > 1 && pc.jumpMultiplier <= 1.08, `multiplier ${pc.jumpMultiplier}`);
    assert.match(pc.headline, /assertive/);
  });
  it('pain/technique exposures are not used to personalise', ()=>{
    const painy = [
      { id: 'd0', dateISO: '2026-02-01', painDiscomfort: true, blocks: [{ exerciseId: 'bench-press-dumbbell', prescription: presc(25), sets: [perf(20, 8.5)] }] },
      { id: 'd1', dateISO: '2026-02-02', painDiscomfort: true, blocks: [{ exerciseId: 'bench-press-dumbbell', prescription: presc(25), sets: [perf(20, 8.5)] }] },
      { id: 'd2', dateISO: '2026-02-03', blocks: [{ exerciseId: 'bench-press-dumbbell', prescription: presc(25), sets: [{ reps: '8', weightKg: '20', rpe: '8.5', completed: true, pain: true, assistedKg: 0 }] }] },
    ];
    const pc = personalCalibrationFromHistory(painy, { exerciseId: 'bench-press-dumbbell' });
    assert.equal(pc.samples, 0);
    assert.equal(pc.active, false);
  });
  it('respects the prior-only cut (asOfDateISO)', ()=>{
    const history = sessionsWith([{ prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }]);
    const pc = personalCalibrationFromHistory(history, { exerciseId: 'bench-press-dumbbell', asOfDateISO: '2026-02-02' });
    assert.equal(pc.samples, 2);
    assert.equal(pc.active, false);
  });
  it('is deterministic', ()=>{
    const history = sessionsWith([{ prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }]);
    assert.deepEqual(personalCalibrationFromHistory(history, { exerciseId: 'bench-press-dumbbell' }), personalCalibrationFromHistory(history, { exerciseId: 'bench-press-dumbbell' }));
  });
});

describe('prospective → outcome end-to-end through the real recorder', ()=>{
  it('a met increase attaches label=successful and flows into calibration', ()=>{
    const storage = memoryStorage();
    const history = [
      { id: 'h0', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '20', rpe: '7' }] }] },
    ];
    recordRecommendation({ exerciseId: 'bench-press-dumbbell', recommendation: { load: 22, reps: 8, reason: 'test' }, history, dueDateISO: '2026-01-05', preferences: CONSENT, targetReps: '8', storage });
    const [resolved] = attachOutcome({
      sessionId: 's1', dateISO: '2026-01-05',
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '22', rpe: '8.5', completed: true, skipped: false, failed: false }] }],
      sessionMeta: { dateISO: '2026-01-05', note: '' },
      preferences: CONSENT, storage,
    });
    assert.equal(resolved.outcome.label, 'successful');
    assert.equal(resolved.outcome.attempted, true);
    assert.equal(isProspectiveRecord(resolved), true);
    const cal = calibrateRecommendations(loadEvaluationLedger(storage), { config: null });
    assert.equal(cal.prospective, 1);
    assert.equal(cal.resolved, 1);
    assert.equal(cal.overall.successful, 1);
  });

  it('an imported recommendation is excluded from prospective calibration', ()=>{
    const storage = memoryStorage();
    const history = [{ id: 'h0', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '20', rpe: '7' }] }] }];
    const rec = recordRecommendation({ exerciseId: 'bench-press-dumbbell', recommendation: { load: 22, reps: 8 }, history, dueDateISO: '2026-01-05', preferences: CONSENT, targetReps: '8', storage });
    // Simulate a re-import re-stamping provenance.
    saveLedgerImported(storage, rec.id);
    const cal = calibrateRecommendations(loadEvaluationLedger(storage), { config: null });
    assert.equal(cal.prospective, 0);
    assert.equal(cal.excludedReconstructed >= 1, true);
  });

  it('legacy rows without provenance are not counted as prospective', ()=>{
    const legacy = [{ id: 'l', exerciseId: 'bench-press-dumbbell', recommendation: { load: 25, reps: 8 }, outcome: { followed: true, metTarget: true, changePct: 0.03 } }];
    assert.equal(isProspectiveRecord(legacy[0]), false);
    assert.equal(calibrateRecommendations(legacy, { config: null }).prospective, 0);
  });
});

describe('attempt adherence is recorded separately from target achievement', ()=>{
  // Shared scaffolding: a prior 20×8 exposure; the engine truly shows the given
  // recommendation; then one performed session is attached and graded.
  function resolveShown({ rec, performed, due = '2026-01-05', rpe = '9' }){
    const storage = memoryStorage();
    const history = [
      { id: 'h0', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '7' }] }] },
    ];
    recordRecommendation({ exerciseId: 'bench-press-dumbbell', recommendation: rec, history, dueDateISO: due, preferences: CONSENT, targetReps: '8', storage });
    const [resolved] = attachOutcome({
      sessionId: 's1', dateISO: due,
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: String(performed.reps), weightKg: String(performed.weightKg), rpe, completed: true, skipped: false, failed: !!performed.failed }] }],
      sessionMeta: { dateISO: due, note: '' },
      preferences: CONSENT, storage,
    });
    return resolved;
  }
  it('correct load + missed reps → followed, gradeable, too-aggressive (25×8 shown, 25×6 done)', ()=>{
    const resolved = resolveShown({ rec: { load: 25, reps: 8, reason: 't' }, performed: { reps: 6, weightKg: 25 } });
    assert.equal(resolved.outcome.followed, true, 'attempting the shown setup counts as followed');
    assert.equal(resolved.outcome.metTarget, false, 'missing reps is still a miss');
    assert.equal(resolved.outcome.gradeable, true);
    assert.equal(resolved.outcome.label, 'too-aggressive');
  });
  it('correct assistance + missed reps → followed and gradeable', ()=>{
    const storage = memoryStorage();
    const history = [
      { id: 'h0', dateISO: '2026-01-01', blocks: [{ exerciseId: 'pull-up', sets: [{ reps: '8', weightKg: '0', assistedKg: '12', rpe: '8' }] }] },
    ];
    recordRecommendation({ exerciseId: 'pull-up', recommendation: { reps: 8, assistKg: 10, reason: 't' }, history, dueDateISO: '2026-01-05', preferences: CONSENT, targetReps: '8', storage });
    const [resolved] = attachOutcome({
      sessionId: 's1', dateISO: '2026-01-05',
      blocks: [{ exerciseId: 'pull-up', sets: [{ reps: '6', weightKg: '0', assistedKg: '10', rpe: '8', completed: true, skipped: false, failed: false }] }],
      sessionMeta: { dateISO: '2026-01-05', note: '' },
      preferences: CONSENT, storage,
    });
    assert.equal(resolved.outcome.followed, true, 'matched assistance + real reps counts as an attempt');
    assert.equal(resolved.outcome.metTarget, false);
    assert.equal(resolved.outcome.gradeable, true);
  });
  it('bodyweight rep miss → followed and gradeable (performing counts as an attempt)', ()=>{
    const storage = memoryStorage();
    const history = [
      { id: 'h0', dateISO: '2026-01-01', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '8', weightKg: '0', rpe: '7' }] }] },
    ];
    recordRecommendation({ exerciseId: 'push-up', recommendation: { reps: 10, reason: 't' }, history, dueDateISO: '2026-01-05', preferences: CONSENT, targetReps: '10', storage });
    const [resolved] = attachOutcome({
      sessionId: 's1', dateISO: '2026-01-05',
      blocks: [{ exerciseId: 'push-up', sets: [{ reps: '6', weightKg: '0', rpe: '8', completed: true, skipped: false, failed: false }] }],
      sessionMeta: { dateISO: '2026-01-05', note: '' },
      preferences: CONSENT, storage,
    });
    assert.equal(resolved.outcome.followed, true);
    assert.equal(resolved.outcome.metTarget, false);
    assert.equal(resolved.outcome.gradeable, true);
    assert.equal(resolved.outcome.label, 'too-aggressive');
  });
  it('wrong load (20×8 vs 25×8) → unfollowed and non-gradeable', ()=>{
    const resolved = resolveShown({ rec: { load: 25, reps: 8, reason: 't' }, performed: { reps: 8, weightKg: 20 } });
    assert.equal(resolved.outcome.followed, false, 'a deliberate lighter load is not the shown prescription');
    assert.equal(resolved.outcome.gradeable, false);
    assert.equal(resolved.outcome.label, 'insufficient-evidence');
  });
  it('an explicit manual override → followed=false, non-gradeable, never graded', ()=>{
    const storage = memoryStorage();
    const history = [
      { id: 'h0', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '7' }] }] },
    ];
    recordRecommendation({ exerciseId: 'bench-press-dumbbell', recommendation: { load: 25, reps: 8, reason: 't' }, history, dueDateISO: '2026-01-05', preferences: CONSENT, targetReps: '8', storage });
    markRecommendationOverride({ exerciseId: 'bench-press-dumbbell', dueDateISO: '2026-01-05', storage });
    const [resolved] = attachOutcome({
      sessionId: 's1', dateISO: '2026-01-05',
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '25', rpe: '8', completed: true, skipped: false, failed: false }] }],
      sessionMeta: { dateISO: '2026-01-05', note: '' },
      preferences: CONSENT, storage,
    });
    assert.equal(resolved.outcome.userOverride, true);
    assert.equal(resolved.outcome.followed, false);
    assert.equal(resolved.outcome.gradeable, false);
    assert.equal(resolved.outcome.label, 'insufficient-evidence');
  });
  it('a failed set at the prescribed setup is gradeable and counts in the denominator', ()=>{
    const resolved = resolveShown({ rec: { load: 25, reps: 8, reason: 't' }, performed: { reps: 6, weightKg: 25, failed: true } });
    assert.equal(resolved.outcome.followed, true);
    assert.equal(resolved.outcome.gradeable, true);
    assert.equal(resolved.outcome.label, 'too-aggressive');
    const storage = memoryStorage();
    const history = [
      { id: 'h0', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '7' }] }] },
    ];
    recordRecommendation({ exerciseId: 'bench-press-dumbbell', recommendation: { load: 25, reps: 8, reason: 't' }, history, dueDateISO: '2026-01-05', preferences: CONSENT, targetReps: '8', storage });
    attachOutcome({
      sessionId: 's1', dateISO: '2026-01-05',
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '6', weightKg: '25', rpe: '10', completed: false, skipped: false, failed: true }] }],
      sessionMeta: { dateISO: '2026-01-05', note: '' },
      preferences: CONSENT, storage,
    });
    const cal = calibrateRecommendations(loadEvaluationLedger(storage), { config: null });
    assert.equal(cal.resolved, 1);
    assert.equal(cal.gradeable, 1, 'a genuine failed attempt moves the denominator');
  });
  it('met target stays successful with the setup rule', ()=>{
    const resolved = resolveShown({ rec: { load: 22, reps: 8, reason: 't' }, performed: { reps: 8, weightKg: 22 } });
    assert.equal(resolved.outcome.followed, true);
    assert.equal(resolved.outcome.metTarget, true);
    assert.equal(resolved.outcome.gradeable, true);
    assert.equal(resolved.outcome.label, 'successful');
  });
});

function saveLedgerImported(storage, id){
  const all = JSON.parse(storage.getItem('arise.evaluation.v1'));
  all.records = all.records.map(r=> r.id === id ? withProvenance(r, 'imported') : r);
  storage.setItem('arise.evaluation.v1', JSON.stringify(all));
}

describe('coachingCalibration presentation layer', ()=>{
  it('is honest and inactive before the prospective sample clears the gate', ()=>{
    const cal = calibrateRecommendations([row({ met: true }), row({ met: false })], { config: null });
    const s = coachingCalibration(cal);
    assert.equal(s.active, false);
    assert.equal(s.status, 'gathering');
    assert.equal(s.successRate, null);
    assert.match(s.headline, /Learning what works/i);
  });
  it('becomes active and states a tendency once conclusive', ()=>{
    const ledger = [];
    for(let i = 0; i < 6; i++) ledger.push(row({ id: `m${i}`, met: true }));
    for(let i = 0; i < 4; i++) ledger.push(row({ id: `o${i}`, met: false }));
    const s = coachingCalibration(calibrateRecommendations(ledger, { config: null }));
    assert.equal(s.active, true);
    assert.equal(s.status, 'calibrated');
    assert.equal(s.successRate, 0.6);
    assert.equal(s.tendency, 'over-prescribing');
    assert.match(s.headline, /cautiously/i);
  });
  it('survives reload/export round-trip identically (provenance + outcome labels ride through)', ()=>{
    const ledger = [row({ met: true, band: 'high' }), row({ met: false })];
    const json = JSON.parse(JSON.stringify(ledger));
    assert.deepEqual(calibrateRecommendations(json, { config: null }).overall, calibrateRecommendations(ledger, { config: null }).overall);
  });
});

describe('shown recommendation == recorded prospective record (no recompute)', ()=>{
  const shownHistory = [{ id: 'h0', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '7' }] }] }];
  function recordShown(rec){
    const storage = memoryStorage();
    const stored = recordRecommendation({ exerciseId: 'bench-press-dumbbell', recommendation: rec, history: shownHistory, dueDateISO: '2026-01-05', preferences: CONSENT, targetReps: '8', policy: rec.policy, storage });
    return { stored, storage };
  }
  it('a conservative-policy target is stored exactly, not recomputed', ()=>{
    const shown = recommendNextWithPolicy({ exerciseId: 'bench-press-dumbbell', history: shownHistory, targetReps: '8–12', policy: 'conservative', asOfDateISO: '2026-01-05' });
    const { stored } = recordShown(shown);
    assert.equal(stored.recommendation.load, shown.load);
    assert.equal(stored.recommendation.reps, shown.reps);
    assert.equal(stored.prescription.load, shown.load);
    assert.equal(stored.audit.policy, shown.policy);
  });
  it('an aggressive-policy target is stored exactly (never re-derived by the engine)', ()=>{
    // Simulate the target the aggressive policy actually displayed, which is
    // deliberately above what a plain recompute would return. The recorder must
    // persist THIS, not silently recompute a different one.
    const recomputed = recommendNext({ exerciseId: 'bench-press-dumbbell', history: shownHistory, targetReps: '8–12', asOfDateISO: '2026-01-05' });
    const shown = { ...recomputed, load: recomputed.load + 5, policy: 'aggressive' };
    const { stored } = recordShown(shown);
    assert.equal(stored.recommendation.load, shown.load);
    assert.equal(stored.prescription.load, shown.load);
    assert.equal(stored.audit.policy, 'aggressive');
    assert.equal(stored.recommendation.load, recomputed.load + 5); // stored the shown, not the recompute
  });
  it('a personal-calibration adjustment is persisted on the record', ()=>{
    const shown = { ...recommendNext({ exerciseId: 'bench-press-dumbbell', history: shownHistory, targetReps: '8–12', asOfDateISO: '2026-01-05' }), policy: 'standard', personalCalibration: { active: true, jumpMultiplier: 0.92, direction: -1, samples: 6, headline: 'Smaller increase recommended.' } };
    const { stored } = recordShown(shown);
    assert.equal(stored.audit.personalCalibration.jumpMultiplier, 0.92);
    assert.equal(stored.audit.personalCalibration.active, true);
    assert.equal(stored.recommendation.load, shown.load);
  });
});

describe('gradeable vs non-gradeable outcomes', ()=>{
  it('a manual override is never graded or used to personalise', ()=>{
    const storage = memoryStorage();
    recordRecommendation({ exerciseId: 'bench-press-dumbbell', recommendation: { load: 25, reps: 8 }, history: [{ id: 'h', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '7' }] }] }], dueDateISO: '2026-01-05', preferences: CONSENT, targetReps: '8', storage });
    markRecommendationOverride({ exerciseId: 'bench-press-dumbbell', dueDateISO: '2026-01-05', storage });
    const [resolved] = attachOutcome({ sessionId: 's', dateISO: '2026-01-05', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '25', rpe: '8', completed: true }] }], preferences: CONSENT, storage });
    assert.equal(resolved.outcome.userOverride, true);
    assert.equal(resolved.outcome.gradeable, false);
    assert.equal(resolved.outcome.followed, false);
    assert.equal(resolved.outcome.label, 'insufficient-evidence');
    const cal = calibrateRecommendations(loadEvaluationLedger(storage), { config: null });
    assert.equal(cal.prospective, 1);
    assert.equal(cal.resolved, 1);
    assert.equal(cal.gradeable, 0);
    assert.equal(cal.tendency, 'learning');
  });
  it('a skipped / unfollowed recommendation is resolved but not gradeable', ()=>{
    const skipped = row({ met: false, followed: false, changePct: null });
    assert.equal(classifyRecommendationOutcome(skipped, T).label, 'insufficient-evidence');
    const cal = calibrateRecommendations([skipped], { config: null });
    assert.equal(cal.resolved, 1);
    assert.equal(cal.gradeable, 0);
    assert.equal(cal.overall.successRate, null);
  });
  it('pain or technique makes a met attempt non-gradeable', ()=>{
    assert.equal(classifyRecommendationOutcome(row({ met: true, pain: true }), T).label, 'neutral');
    for(const r of [row({ met: true, pain: true }), row({ met: true, technique: true })]){
      assert.equal(calibrateRecommendations([r], { config: null }).gradeable, 0);
    }
  });
  it('5 resolved but only 1 gradeable keeps calibration inactive', ()=>{
    const ledger = [row({ id: 'g', met: true }), row({ id: 'u1', followed: false }), row({ id: 'u2', followed: false }), row({ id: 'p', met: true, pain: true }), row({ id: 't', met: true, technique: true })];
    const cal = calibrateRecommendations(ledger, { config: null });
    assert.equal(cal.resolved, 5);
    assert.equal(cal.gradeable, 1);
    assert.equal(cal.overall.conclusive, false);
    assert.equal(cal.overall.successRate, null);
    assert.equal(coachingCalibration(cal).active, false);
  });
  it('calibration error is computed from gradeable rows only', ()=>{
    const gradeable = Array.from({ length: 5 }, (_, i)=> row({ id: `h${i}`, met: true, band: 'high' })); // realised 1 vs expected 0.8 → error 0.2
    const noise = [row({ id: 'n1', met: false, followed: false, band: 'low' }), row({ id: 'n2', met: false, followed: false, band: 'low' })];
    const withNoise = calibrateRecommendations([...gradeable, ...noise], { config: null });
    assert.equal(withNoise.resolved, 7);
    assert.equal(withNoise.gradeable, 5);
    assert.equal(withNoise.overall.calibrationError, 0.2); // unfollowed low-band rows excluded
  });
});

describe('personalisation ignores overridden and ungradeable exposures', ()=>{
  const presc = load => ({ prescriptionId: 'pc:r1', prescribedReps: 8, prescribedLoadKg: load, prescribedAssistKg: null });
  const done = (weightKg, rpe, reps = '8') => ({ reps: String(reps), weightKg: String(weightKg), rpe: String(rpe), completed: true, skipped: false, failed: false, assistedKg: 0 });
  const exposures = rows => rows.map((e, i)=> ({ id: `d${i}`, dateISO: `2026-03-0${i + 1}`, blocks: [{ exerciseId: 'bench-press-dumbbell', prescription: presc(e.prescribe), sets: [done(e.performed, e.rpe ?? 8, e.reps ?? '8')] }] }));
  it('overridden exposures do not count toward the sample', ()=>{
    const base = exposures([{ prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }]);
    base[0].blocks[0].prescriptionOverridden = true;
    assert.equal(personalCalibrationFromHistory(base, { exerciseId: 'bench-press-dumbbell' }).samples, 1);
  });
  it('a run that is majority overridden never activates', ()=>{
    const h = exposures([{ prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }, { prescribe: 25, performed: 25, reps: '6' }]);
    h.slice(0, 4).forEach(b=> { b.blocks[0].prescriptionOverridden = true; });
    assert.equal(personalCalibrationFromHistory(h, { exerciseId: 'bench-press-dumbbell' }).active, false);
  });
  it('without overrides, 6 missed increases still activate caution (regression guard)', ()=>{
    const h = exposures(Array.from({ length: 6 }, ()=> ({ prescribe: 25, performed: 25, reps: '6' })));
    const pc = personalCalibrationFromHistory(h, { exerciseId: 'bench-press-dumbbell' });
    assert.equal(pc.samples, 6);
    assert.equal(pc.active, true);
    assert.ok(pc.jumpMultiplier < 1);
  });
  it('genuine failed attempts at the shown setup still teach (never silently dropped)', ()=>{
    const mk = (k)=> ({ id: `f${k}`, dateISO: `2026-03-0${k + 1}`, blocks: [{ exerciseId: 'bench-press-dumbbell', prescription: presc(25), sets: [{ reps: '6', weightKg: '25', rpe: '10', completed: false, skipped: false, failed: true, assistedKg: 0 }] }] });
    const h = Array.from({ length: 6 }, (_, k)=> mk(k));
    const pc = personalCalibrationFromHistory(h, { exerciseId: 'bench-press-dumbbell' });
    assert.equal(pc.samples, 6, 'failed-at-setup attempts are gradeable evidence');
    assert.equal(pc.active, true);
    assert.ok(pc.jumpMultiplier < 1);
  });
});
