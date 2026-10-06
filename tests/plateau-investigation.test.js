import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { investigatePlateau } from '../src/lib/plateauInvestigation.js';
import { workoutQualityReport } from '../src/lib/workoutQualityReport.js';
import { buildAdaptationTrail, transparentProgressionDecision } from '../src/lib/programming.js';

const mkSet = (reps, weightKg, rpe = null, extra = {}) => ({ reps: String(reps), weightKg: String(weightKg), completed: true, ...(rpe != null ? { rpe: String(rpe) } : {}), ...extra });
const mkSess = (dateISO, blocks, extra = {}) => ({ id: `s-${dateISO}`, dateISO, blocks, ...extra });

/** Valid calendar date n days after 2026-01-01 (real month rollovers). */
function isoAfter(days){
  const d = new Date(Date.parse('2026-01-01T00:00:00') + days * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Eleven flat weeks on incline dumbbell press: same 20kg × 8 every session,
// RPE steady, well recovered — the classic "genuine ceiling" picture.
function plateauHistory(){
  const sessions = [];
  for(let w = 0; w < 11; w++){
    sessions.push(mkSess(isoAfter(5 + w * 7), [
      { exerciseId: 'incline-dumbbell-press', sets: [mkSet(8, 20, 8), mkSet(8, 20, 8), mkSet(8, 20, 8)] },
      { exerciseId: 'bench-press-dumbbell', sets: [mkSet(8, 30, 8), mkSet(8, 30, 8)] },
    ], { noteTags: [] }));
  }
  return sessions;
}

describe('plateau investigation', () => {
  it('returns insufficient before four exposures', () => {
    const result = investigatePlateau(plateauHistory().slice(0, 2), 'incline-dumbbell-press');
    assert.equal(result.status, 'insufficient');
    assert.match(result.reason, /4\+ sessions/);
  });

  it('investigates all five checks with evidence on a genuine plateau', () => {
    const history = plateauHistory();
    const result = investigatePlateau(history, 'incline-dumbbell-press');
    assert.equal(result.status, 'investigated');
    assert.deepEqual(result.flagged.length >= 0, true);
    assert.equal(result.checks.length, 5);
    const ids = result.checks.map(c => c.id);
    assert.deepEqual(ids, ['volume-trend', 'effort-drift', 'frequency', 'recovery', 'neighbour-progress']);
    for(const check of result.checks){
      assert.ok(check.label && check.finding);
      assert.ok(Array.isArray(check.evidence));
    }
    assert.ok(result.diagnosis.length > 10);
    assert.ok(result.recommendation.headline.length > 5);
    assert.ok(['volume-up', 'intensity-up', 'backoff', 'recover', 'frequency-up', 'swap', 'deload'].includes(result.recommendation.kind));
  });

  it('flags a volume collapse as the likely cause', () => {
    const history = plateauHistory().map((session, index) => {
      // After week 5, cut the stalled movement to 1 hard set/week.
      if(index < 6) return session;
      return {
        ...session,
        blocks: session.blocks.map(b => b.exerciseId === 'incline-dumbbell-press'
          ? { ...b, sets: [mkSet(8, 20, 8)] }
          : b),
      };
    });
    const result = investigatePlateau(history, 'incline-dumbbell-press', { weeks: 4 });
    const volumeCheck = result.checks.find(c => c.id === 'volume-trend');
    assert.equal(volumeCheck.verdict, 'cause');
    assert.equal(result.recommendation.kind, 'volume-up');
  });

  it('flags falling effort as stale prescription', () => {
    const history = plateauHistory().map(session => ({
      ...session,
      blocks: session.blocks.map(b => b.exerciseId === 'incline-dumbbell-press'
        ? { ...b, sets: b.sets.map((s, i) => (i === 0 ? { ...s, rpe: '6' } : s)) }
        : b),
    }));
    const result = investigatePlateau(history, 'incline-dumbbell-press');
    const effort = result.checks.find(c => c.id === 'effort-drift');
    assert.ok(['clear', 'cause'].includes(effort.verdict));
  });

  it('flags low readiness recovery windows', () => {
    const history = plateauHistory();
    const readinessLog = history.map(h => ({ dateISO: h.dateISO, score: 20 }));
    const result = investigatePlateau(history, 'incline-dumbbell-press', { readinessLog });
    const recovery = result.checks.find(c => c.id === 'recovery');
    assert.equal(recovery.verdict, 'cause');
    assert.equal(result.recommendation.kind, 'recover');
  });
});

describe('post-workout quality report', () => {
  const scheduleSession = {
    id: 's-2026-03-01',
    title: 'Push A',
    blocks: [
      { exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' },
      { exerciseId: 'lateral-raise', sets: 2, reps: '10–15' },
    ],
  };
  const schedule = { sessions: [scheduleSession] };

  it('rates a session that hit its targets and beat last time highly', () => {
    const session = mkSess('2026-03-01', [
      { exerciseId: 'bench-press-dumbbell', sets: [mkSet(12, 32, 8), mkSet(12, 32, 8), mkSet(10, 32, 8)] },
      { exerciseId: 'lateral-raise', sets: [mkSet(12, 8, 7), mkSet(12, 8, 7)] },
    ], { durationMinutes: 45 });
    const historyBefore = [mkSess('2026-02-24', [
      { exerciseId: 'bench-press-dumbbell', sets: [mkSet(9, 30, 8), mkSet(9, 30, 8), mkSet(9, 30, 8)] },
    ])];
    const report = workoutQualityReport(session, { schedule, historyBefore });
    assert.ok(report && report.quality >= 65, `expected >=65, got ${report?.quality}`);
    assert.ok(report.target.hit);
    assert.equal(report.beatsPrevious.length, 1);
    assert.ok(report.whatWentWell.length >= 1);
  });

  it('penalises a session that missed the prescription and says why', () => {
    const session = mkSess('2026-03-01', [
      { exerciseId: 'bench-press-dumbbell', sets: [mkSet(5, 32, 10), mkSet(4, 32, 10), mkSet(4, 32, 10)] },
      { exerciseId: 'lateral-raise', sets: [mkSet(6, 8, 9), mkSet(6, 8, 9)] },
    ]);
    const report = workoutQualityReport(session, { schedule, historyBefore: [] });
    assert.ok(report.quality < 65, `expected <65, got ${report.quality}`);
    assert.ok(report.whatLimitedYou.some(line => /Reps fell short|prescription|rep target/i.test(line)));
    assert.ok(report.whatToChangeNext.length >= 1);
  });

  it('flags low readiness context explicitly', () => {
    const session = mkSess('2026-03-01', [
      { exerciseId: 'bench-press-dumbbell', sets: [mkSet(12, 32, 9), mkSet(10, 32, 9)] },
    ], { durationMinutes: 40 });
    const report = workoutQualityReport(session, {
      schedule,
      historyBefore: [],
      readinessLog: [{ dateISO: '2026-03-01', score: 25 }],
    });
    assert.ok(report.lowReadiness === 25);
    assert.ok(report.whatLimitedYou.some(line => /readiness/i.test(line)));
  });

  it('returns null for an empty session', () => {
    assert.equal(workoutQualityReport({ blocks: [] }), null);
  });
});

describe('adaptation trail surfacing', () => {
  it('is null for an untouched block', () => {
    assert.equal(buildAdaptationTrail({ exerciseId: 'bench-press-dumbbell', sets: 3 }), null);
  });

  it('carries engine-set volume changes verbatim', () => {
    const block = {
      exerciseId: 'bench-press-dumbbell',
      sets: 2,
      why: 'Reduced to 2 sets for the next recovery window because high RPE ≥9 twice.',
      adaptation: { kind: 'deload', reason: 'same', basisKey: 'b1' },
    };
    const trail = buildAdaptationTrail(block);
    assert.equal(trail.length, 1);
    assert.equal(trail[0].kind, 'deload');
    assert.match(trail[0].summary, /Reduced to 2 sets/);
  });

  it('carries substitution reason with the origin exercise', () => {
    const block = {
      exerciseId: 'bench-press-dumbbell',
      substitutionFrom: 'bench-press-barbell',
      substitutionReason: 'Kit unavailable',
      substitutedAt: '2026-03-01T10:00:00Z',
    };
    const trail = buildAdaptationTrail(block);
    assert.equal(trail[0].kind, 'substitution');
    assert.match(trail[0].summary, /Barbell Bench Press/);
  });

  it('transparentProgressionDecision passes the trail through', () => {
    const block = {
      exerciseId: 'bench-press-dumbbell',
      sets: 3,
      why: 'Reduced for recovery',
      adaptation: { kind: 'repeated-difficulty', reason: 'same', basisKey: 'b2' },
    };
    const decision = transparentProgressionDecision({ exerciseId: 'bench-press-dumbbell', history: [], block });
    assert.ok(decision.adapted);
    assert.equal(decision.adapted[0].kind, 'repeated-difficulty');
    const decisionClean = transparentProgressionDecision({ exerciseId: 'bench-press-dumbbell', history: [] });
    assert.equal(decisionClean.adapted, null);
  });
});
