import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prospectiveFieldComparison, isGradeableOutcome, prospectiveTransitionKey } from '../src/lib/evaluation.js';
import { pooledProspectiveComparison, fieldStudyStatus } from '../src/lib/fieldStudy.js';
import { loggingFrictionStats } from '../src/lib/telemetry.js';
import { coachingEvidence } from '../src/lib/product.js';

const LIVE = { origin: 'live-engine' };

function gradeRow({
  user = 'u1', exercise = 'bench-press-dumbbell', session = 's1', date = '2026-03-01',
  target = { load: 22.5, reps: 9 }, ariseMet = true, baseMet = false,
  baselines = ['double-progression'], gradeable = true,
} = {}){
  const arms = { arise: { metTarget: ariseMet } };
  for(const b of baselines) arms[b] = { metTarget: baseMet };
  return {
    recommendation: { ...target },
    recommendedAction: 'add_load',
    provenance: { ...LIVE },
    exerciseId: exercise,
    participantId: user,
    outcome: { followed: true, metTarget: ariseMet, gradeable, sessionId: session, dateISO: date, arms },
  };
}

describe('prospectiveFieldComparison — gradeable prospective evidence only', ()=>{
  it('scores only gradeable pairs and accounts every exclusion exactly once', ()=>{
    const rows = [
      gradeRow({ user: 'u1', session: 's1' }),
      gradeRow({ user: 'u2', session: 's2' }),
      { ...gradeRow({ user: 'u1', session: 's3' }), outcome: undefined }, // unresolved → open
      { ...gradeRow({ user: 'u1', session: 's4' }), provenance: { origin: 'replay' } }, // reconstructed
      { ...gradeRow({ user: 'u2', session: 's5' }), outcome: { ...gradeRow().outcome, followed: false, gradeable: undefined, sessionId: 's5', arms: undefined } }, // unfollowed
      { ...gradeRow({ user: 'u2', session: 's6' }), outcome: { ...gradeRow().outcome, userOverride: true, gradeable: undefined, sessionId: 's6', arms: undefined } }, // override
      { ...gradeRow({ user: 'u1', session: 's7' }), outcome: { ...gradeRow().outcome, pain: true, gradeable: undefined, sessionId: 's7', arms: undefined } }, // flagged
      { ...gradeRow({ user: 'u1', session: 's8' }), outcome: { ...gradeRow().outcome, gradeable: false, sessionId: 's8', arms: undefined } }, // stored not-gradeable, followed, unflagged → other
    ];
    const c = prospectiveFieldComparison(rows);
    assert.equal(c.prospective, 7);
    assert.equal(c.resolved, 6);
    assert.equal(c.gradeable, 2);
    assert.equal(c.open, 1);
    assert.equal(c.excluded.nonProspective, 1);
    assert.equal(c.excluded.unresolved, 1);
    assert.deepEqual(c.excluded.nonGradeable, { unfollowed: 1, override: 1, flagged: 1, other: 1 });
    assert.equal(c.maturity, 'insufficient');
  });

  it('withholds any read below the sample gates', ()=>{
    const oneUser = [1, 2, 3, 4, 5, 6].map(i=> gradeRow({ user: 'u1', session: `s${i}`, date: `2026-03-${String(i).padStart(2, '0')}` }));
    const c = prospectiveFieldComparison(oneUser);
    assert.equal(c.gradeable, 6);
    assert.equal(c.users, 1);
    assert.equal(c.maturity, 'insufficient');
    assert.ok(c.sampleSufficiency.reasons.some(r=> r.includes('user')));
    assert.equal(c.byBaseline['double-progression'].pairs, 6);
    assert.ok(c.note.includes('insufficient'));
  });

  it('counts the same user/exercise/baseline repeated pair once', ()=>{
    const dup = gradeRow({ user: 'u1', session: 's1' });
    const rows = [
      dup,
      { ...structuredClone(dup) }, // identical re-recording: same transition
      gradeRow({ user: 'u1', session: 's2', date: '2026-03-08' }), // same target, different week → separate
      gradeRow({ user: 'u2', session: 's3' }),
      gradeRow({ user: 'u2', session: 's4', date: '2026-03-08' }),
      gradeRow({ user: 'u1', session: 's5', date: '2026-03-15' }),
    ];
    const c = prospectiveFieldComparison(rows);
    assert.equal(c.gradeable, 5);
    assert.equal(c.duplicatePairs, 1);
    const arm = c.byBaseline['double-progression'];
    assert.equal(arm.pairs, 5);
    assert.equal(arm.duplicatePairs, 1);
    assert.equal(prospectiveTransitionKey(dup), prospectiveTransitionKey(structuredClone(dup)));
  });

  it('compares against presented baselines only, never fabricated arms', ()=>{
    const rows = [
      gradeRow({ user: 'u1', session: 's1', baselines: ['flat'] }),
      gradeRow({ user: 'u2', session: 's2', baselines: ['flat'] }),
    ];
    const c = prospectiveFieldComparison(rows);
    assert.ok(c.byBaseline.flat);
    assert.equal(c.byBaseline['double-progression'], undefined);
    assert.equal(c.byBaseline['fixed-rules'], undefined);
  });

  it('aggregates as a mean of per-user effects, never a naive pooled rate', ()=>{
    const rows = [
      ...[1, 2, 3, 4].map(i=> gradeRow({ user: 'u1', session: `a${i}`, date: `2026-03-${String(i).padStart(2, '0')}`, ariseMet: true, baseMet: false })),
      gradeRow({ user: 'u2', session: 'b1', ariseMet: false, baseMet: true }),
    ];
    const c = prospectiveFieldComparison(rows);
    assert.equal(c.maturity, 'early');
    const arm = c.byBaseline['double-progression'];
    assert.equal(arm.ariseRate, 0.8); // pooled rate would say +60pp for arise…
    assert.equal(arm.effectMean, 0); // …but the mean of user effects (+1 and −1) is flat
    assert.deepEqual(arm.effectBand, [-1, 1]);
    assert.equal(arm.users, 2);
  });

  it('re-derives gradeability for legacy rows without the stored flag', ()=>{
    const legacy = gradeRow({ user: 'u1', session: 's1', gradeable: undefined });
    delete legacy.outcome.gradeable;
    assert.equal(isGradeableOutcome(legacy), true);
    const unfollowed = structuredClone(legacy);
    unfollowed.outcome.followed = false;
    assert.equal(isGradeableOutcome(unfollowed), false);
  });
});

describe('pooledProspectiveComparison — one user, one unit; consent enforced', ()=>{
  function participant({ id, code, consented, sessions }){
    return {
      code,
      studyParticipantId: id,
      store: {
        preferences: consented ? { telemetryEnabled: true } : {},
        history: [],
        // Ledger merge keys on record id — mirror production record shape.
        evaluationLedger: sessions.map((s, i)=> ({ id: `${code}-ledger-${s}`, ...gradeRow({ session: `${code}-${s}`, date: `2026-03-${String(i + 1).padStart(2, '0')}` }) })),
      },
    };
  }
  it('folds repeated exports, excludes unconsented and unidentified packages', ()=>{
    const p1a = participant({ id: 'aaaabbbbccccdddd', code: 'p1', consented: true, sessions: ['s1', 's2'] });
    const p1b = participant({ id: 'aaaabbbbccccdddd', code: 'p1', consented: true, sessions: ['s3'] });
    const p2 = participant({ id: '1111222233334444', code: 'p2', consented: false, sessions: ['s1', 's2', 's3', 's4'] });
    const anon = { code: 'anon-01', store: { preferences: { telemetryEnabled: true }, history: [], evaluationLedger: [gradeRow({ session: 'x1' })] } };
    const c = pooledProspectiveComparison([p1a, p1b, p2, anon]);
    assert.equal(c.unidentifiedExports, 1);
    assert.equal(c.unconsentedExports, 1);
    assert.equal(c.users, 1); // only p1's folded identity
    assert.equal(c.gradeable, 3); // p1's three sessions; p2 and anon contribute zero rows
    assert.ok(c.note.includes('unconsented'));
  });
});

describe('fieldStudyStatus — local contribution, static facts only', ()=>{
  it('reports off / observing / enrolled modes honestly', ()=>{
    const off = fieldStudyStatus({ store: { preferences: {} }, ledger: [] });
    assert.equal(off.mode, 'off');
    assert.equal(off.maturity, 'insufficient');
    const observing = fieldStudyStatus({ store: { preferences: { telemetryEnabled: true } }, ledger: [gradeRow({})] });
    assert.equal(observing.mode, 'observing');
    assert.equal(observing.samples.gradeable, 1);
    const enrolled = fieldStudyStatus({
      store: {
        preferences: { telemetryEnabled: true },
        studyEnrollment: {
          enrolledAtISO: '2026-01-01T00:00:00.000Z',
          assignments: { ex1: { arm: 'arise' }, ex2: { arm: 'double-progression' } },
          policyVersions: { arise: 'priors-v1', doubleProgression: 'dp-1' },
        },
      },
      ledger: [gradeRow({})],
    });
    assert.equal(enrolled.mode, 'enrolled');
    assert.equal(enrolled.enrollmentOk, true);
  });
});

describe('loggingFrictionStats — instrumented where possible, degraded never invented', ()=>{
  const at = (base, ms)=> new Date(Date.parse(base) + ms).toISOString();
  it('segments by mode and records swap/save timings', ()=>{
    const t0 = '2026-03-01T10:00:00.000Z';
    const events = [
      { type: 'session:start', sessionId: 's1', at: t0 },
      { type: 'set:complete', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', elapsedMs: 4000, at: at(t0, 90000) },
      { type: 'set:complete', sessionId: 's1', exerciseId: 'e1', setIndex: 1, mode: 'gym', elapsedMs: 8000, at: at(t0, 200000) },
      { type: 'exercise:swapped', sessionId: 's1', from: 'e1', to: 'e2', mode: 'gym', elapsedMs: 12000, at: at(t0, 210000) },
      { type: 'session:save', sessionId: 's1', durationMs: 37, at: at(t0, 220000) },
    ];
    const s = loggingFrictionStats(events);
    assert.equal(s.sessions, 1);
    assert.equal(s.completedSets, 2);
    assert.equal(s.completionMsMedian, 6000);
    assert.equal(s.swapMsMedian, 12000);
    assert.equal(s.saveMsMedian, 37);
    assert.equal(s.degraded, false);
    assert.equal(s.byMode.gym.completedSets, 2);
    assert.equal(s.byMode.standard.completedSets, 0);
    assert.equal(s.byMode.standard.degraded, true);
  });

  it('marks legacy sessionComplete-only flows degraded without inventing times', ()=>{
    const events = [{ type: 'set:complete', sessionId: 'legacy-1', exerciseId: 'e1', setIndex: 0 }];
    const s = loggingFrictionStats(events);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionMsMedian, null);
    assert.equal(s.startToFirstSetMs, null);
    assert.equal(s.degraded, true);
    assert.equal(s.byMode.gym.completedSets, 0); // untagged legacy counts to overall only
  });

  it('logs a commit-without-open swap without a time', ()=>{
    const events = [{ type: 'exercise:swapped', sessionId: 's9', from: 'e1', to: 'e2', mode: 'standard' }];
    const s = loggingFrictionStats(events);
    assert.equal(s.swapMsMedian, null);
    assert.equal(s.degraded, true);
  });
});

describe('coachingEvidence — the five-line display contract', ()=>{
  it('renders arise success, baseline equivalent, difference and early maturity', ()=>{
    const e = coachingEvidence({
      prospective: 9, resolved: 8, gradeable: 7, users: 2, exercises: ['bench-press-dumbbell'],
      maturity: 'early',
      byBaseline: {
        flat: { label: 'hold', pairs: 2, users: 1, ariseRate: 0.5, baseRate: 0.5, effectPp: 0 },
        'double-progression': { label: 'double progression', pairs: 5, users: 2, ariseRate: 0.8, baseRate: 0.2, effectPp: 60 },
      },
    });
    assert.equal(e.status, 'early');
    assert.deepEqual(e.lines, [
      'Prospective gradeable recommendations: 7',
      'Arise target success: 80%',
      'Baseline equivalent: 20%',
      'Difference: +60 percentage points',
      'Evidence: early / insufficient for a firm conclusion',
    ]);
    assert.equal(e.headlineArm.id, 'double-progression'); // most shared transitions
    assert.ok(e.evidenceKinds.personal && e.evidenceKinds.replay && e.evidenceKinds.prospective && e.evidenceKinds.external);
  });

  it('withholds firmly below the gates', ()=>{
    const e = coachingEvidence(null);
    assert.equal(e.status, 'insufficient');
    assert.deepEqual(e.lines, [
      'Prospective gradeable recommendations: 0',
      'Arise target success: —',
      'Baseline equivalent: —',
      'Difference: —',
      'Evidence: insufficient for a firm conclusion',
    ]);
  });
});
