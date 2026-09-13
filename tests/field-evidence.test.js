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
    outcomeProvenance: { ...LIVE },
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
      { ...gradeRow({ user: 'u1', session: 's3' }), outcome: undefined, outcomeProvenance: undefined }, // live open: prospective + open, never excluded
      { ...gradeRow({ user: 'u1', session: 's4' }), provenance: { origin: 'replay' } }, // reconstructed
      { ...gradeRow({ user: 'u2', session: 's5' }), outcome: { ...gradeRow().outcome, followed: false, gradeable: undefined, sessionId: 's5', arms: undefined } }, // unfollowed
      { ...gradeRow({ user: 'u2', session: 's6' }), outcome: { ...gradeRow().outcome, userOverride: true, gradeable: undefined, sessionId: 's6', arms: undefined } }, // override
      { ...gradeRow({ user: 'u1', session: 's7' }), outcome: { ...gradeRow().outcome, pain: true, gradeable: undefined, sessionId: 's7', arms: undefined } }, // flagged
      { ...gradeRow({ user: 'u1', session: 's8' }), outcome: { ...gradeRow().outcome, gradeable: false, sessionId: 's8', arms: undefined } }, // stored not-gradeable, followed, unflagged → other
      { ...gradeRow({ user: 'u2', session: 's9' }), outcomeProvenance: { origin: 'imported' } }, // live rec, imported outcome → excluded once resolved
    ];
    const c = prospectiveFieldComparison(rows);
    assert.equal(c.prospective, 8);
    assert.equal(c.resolved, 6);
    assert.equal(c.gradeable, 2);
    assert.equal(c.open, 1);
    assert.equal(c.excluded.nonProspective, 1);
    assert.equal(c.excluded.unprovenOutcome, 1);
    assert.ok(!('unresolved' in c.excluded), 'open rows are prospective, never an exclusion bucket');
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
  const assignedRow = (user, session, arm, met)=> ({
    ...gradeRow({ user, session }),
    assignedArm: arm,
    outcome: { ...gradeRow({ user, session }).outcome, assignedMet: met },
  });
  it('reports off / observing / enrolled modes honestly', ()=>{
    const off = fieldStudyStatus({ store: { preferences: {} }, ledger: [] });
    assert.equal(off.mode, 'off');
    assert.equal(off.maturity, 'insufficient');
    // Unassigned shadow rows do not count toward effectiveness samples.
    const observing = fieldStudyStatus({ store: { preferences: { telemetryEnabled: true } }, ledger: [gradeRow({})] });
    assert.equal(observing.mode, 'observing');
    assert.equal(observing.samples.assigned, 0);
    assert.equal(observing.maturity, 'insufficient');
    const enrolled = fieldStudyStatus({
      store: {
        preferences: { telemetryEnabled: true },
        studyEnrollment: {
          enrolledAtISO: '2026-01-01T00:00:00.000Z',
          assignments: { ex1: { arm: 'arise' }, ex2: { arm: 'double-progression' } },
          policyVersions: { arise: 'priors-v1', doubleProgression: 'dp-1' },
        },
      },
      ledger: [assignedRow('u1', 's1', 'arise', true), assignedRow('u2', 's2', 'double-progression', false)],
    });
    assert.equal(enrolled.mode, 'enrolled');
    assert.equal(enrolled.enrollmentOk, true);
    assert.equal(enrolled.samples.assigned, 2);
    assert.equal(enrolled.samples.arise, 1);
    assert.equal(enrolled.samples.doubleProgression, 1);
    assert.equal(enrolled.maturity, 'early');
    assert.ok(enrolled.reasons.length > 0);
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
    assert.equal(s.loggingMsMedian, 6000);
    assert.equal(s.swap.msMedian, 12000);
    assert.equal(s.swap.commits, 1);
    assert.equal(s.saveMsMedian, 37);
    assert.equal(s.degraded, false);
    assert.equal(s.byMode.gym.completedSets, 2);
    assert.equal(s.byMode.standard.completedSets, 0);
    assert.equal(s.byMode.standard.degraded, true);
  });

  it('aggregates the canonical value-free taxonomy', ()=>{
    const t0 = '2026-03-01T10:00:00.000Z';
    const events = [
      { type: 'session:start', sessionId: 's1', at: t0 },
      { type: 'load-field-commit', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'standard', at: at(t0, 10000) },
      { type: 'reps-field-commit', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'standard', at: at(t0, 20000) },
      { type: 'complete-set', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'standard', elapsedMs: 5000, at: at(t0, 60000) },
      { type: 'undo-set', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'standard', at: at(t0, 70000) },
      { type: 'add-set', sessionId: 's1', exerciseId: 'e1', mode: 'standard', at: at(t0, 80000) },
      { type: 'remove-set', sessionId: 's1', exerciseId: 'e1', setIndex: 1, mode: 'standard', kind: 'user-added', at: at(t0, 90000) },
      { type: 'swap-open', sessionId: 's1', exerciseId: 'e1', mode: 'standard', at: at(t0, 100000) },
      { type: 'swap-commit', sessionId: 's1', from: 'e1', to: 'e2', mode: 'standard', elapsedMs: 9000, at: at(t0, 110000) },
      { type: 'apply-all', sessionId: 's1', exerciseId: 'e2', mode: 'standard', at: at(t0, 120000) },
    ];
    const s = loggingFrictionStats(events);
    assert.equal(s.completedSets, 1);
    assert.deepEqual(s.fieldCommits, { total: 2, load: 1, reps: 1, rir: 0 });
    assert.equal(s.undos, 1);
    assert.equal(s.correctionsPerSession, 1);
    assert.equal(s.addedSets, 1);
    assert.equal(s.removedSets, 1);
    assert.equal(s.swap.opens, 1);
    assert.equal(s.swap.commits, 1);
    // 9 value-free actions over 1 completed set.
    assert.equal(s.actionsPerCompletedSet, 9);
    assert.equal(s.loggingMsMedian, 5000);
    assert.equal(s.startToFirstSetMs, 60000);
  });

  it('marks legacy sessionComplete-only flows degraded without inventing times', ()=>{
    const events = [{ type: 'set:complete', sessionId: 'legacy-1', exerciseId: 'e1', setIndex: 0 }];
    const s = loggingFrictionStats(events);
    assert.equal(s.completedSets, 1);
    assert.equal(s.loggingMsMedian, null);
    assert.equal(s.startToFirstSetMs, null);
    assert.equal(s.degraded, true);
    assert.equal(s.byMode.gym.completedSets, 0); // untagged legacy counts to overall only
  });

  it('logs a commit-without-open swap without a time', ()=>{
    const events = [{ type: 'exercise:swapped', sessionId: 's9', from: 'e1', to: 'e2', mode: 'standard' }];
    const s = loggingFrictionStats(events);
    assert.equal(s.swap.msMedian, null);
    assert.equal(s.swap.commits, 1);
    assert.equal(s.degraded, true);
  });
});

describe('coachingEvidence — assigned arms only, never shadow', ()=>{
  const primaryFixture = ()=> ({
    participants: 2,
    transitions: 6,
    conclusive: false,
    arise: { key: 'arise', n: 4, participants: 1, metCount: 3, targetAchievementRate: 0.75, conclusive: false },
    'double-progression': { key: 'double-progression', n: 2, participants: 1, metCount: 1, targetAchievementRate: 0.5, conclusive: false },
    difference: { metRateDelta: 0.25, clusteredBootstrap: { participants: 2, mean: 0.25, low: -0.5, high: 1, conclusive: true } },
    adherence: { followedRate: 1, unknownAdherence: 0, userOverrides: 0 },
  });
  it('renders assigned users, transitions, achievement, difference and uncertainty', ()=>{
    const e = coachingEvidence(primaryFixture());
    assert.equal(e.status, 'early');
    assert.equal(e.causal, true);
    assert.equal(e.observed, 6);
    assert.equal(e.users, 2);
    assert.deepEqual(e.lines, [
      'Arise-assigned: 4 transitions · 1 users · 75% targets met',
      'Double-progression-assigned: 2 transitions · 1 users · 50% targets met',
      'Difference: +25pp',
      'Uncertainty: clustered 95% CI [-50pp, 100pp] over 2 participants',
      'Adherence: 100% followed (ITT — every assigned transition counts)',
      'Evidence: early / insufficient for a firm conclusion',
    ]);
  });

  it('marks a conclusive read descriptive, never proven', ()=>{
    const e = coachingEvidence({ ...primaryFixture(), conclusive: true, transitions: 12 });
    assert.equal(e.status, 'descriptive');
    assert.ok(e.lines[5].startsWith('Evidence: descriptive'));
    assert.ok(!e.lines.join('\n').match(/proof of superiority|proven/i));
  });

  it('refuses a causal headline from shadow-shaped input', ()=>{
    const e = coachingEvidence({
      prospective: 9, resolved: 8, gradeable: 7, users: 2,
      maturity: 'early',
      byBaseline: {
        'double-progression': { label: 'double progression', pairs: 5, users: 2, ariseRate: 0.8, baseRate: 0.2, effectPp: 60 },
      },
    });
    assert.equal(e.status, 'insufficient');
    assert.equal(e.causal, true);
    assert.ok(e.lines.every(l=> !l.includes('80%') && !l.includes('60')));
  });

  it('withholds firmly below the gates', ()=>{
    const e = coachingEvidence(null);
    assert.equal(e.status, 'insufficient');
    assert.deepEqual(e.lines, [
      'Arise-assigned: 0 transitions · 0 users · — targets met',
      'Double-progression-assigned: 0 transitions · 0 users · — targets met',
      'Difference: —',
      'Uncertainty: clustered 95% CI needs ≥2 participants',
      'Adherence: — (ITT — every assigned transition counts)',
      'Evidence: insufficient for a firm conclusion',
    ]);
  });
});
