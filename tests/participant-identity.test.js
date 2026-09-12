// Participant-identity integrity tests: one person must never become
// multiple statistical participants simply because they performed multiple
// exercises. Canonical identity comes from participantOf/participantOfStore;
// every count, gate, CI and cluster must route through them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { participantOf, participantOfStore, ANONYMOUS_LOCAL_PARTICIPANT } from '../src/lib/longitudinalCore.js';
import { evaluateLongitudinal, clusteredBootstrapDifference, prospectiveFieldComparison } from '../src/lib/evaluation.js';
import { pooledAssignedComparison } from '../src/lib/fieldStudy.js';
import { coachingEvidence } from '../src/lib/product.js';

const LIVE = { origin: 'live-engine' };

// A resolved assigned-arm row on one exercise, for one person.
function assignedRow({ user = null, session = 's1', arm = 'arise', met = true, exercise = 'bench-press-dumbbell', id } = {}){
  return {
    id: id ?? `${user ?? 'anon'}-${session}-${exercise}`,
    recommendation: { load: 22.5, reps: 9 },
    recommendedAction: 'add_load',
    provenance: { ...LIVE },
    outcomeProvenance: { ...LIVE },
    exerciseId: exercise,
    participantId: user,
    assignedArm: arm,
    prescription: { arm, load: 22.5, reps: 9 },
    outcome: {
      followed: true, metTarget: met, assignedMet: met, gradeable: true,
      sessionId: session, dateISO: '2026-03-01', e1rm: 30,
      arms: { arise: { metTarget: met }, 'double-progression': { metTarget: !met } },
    },
  };
}

const EXERCISES = [
  'bench-press-dumbbell', 'goblet-squat', 'romanian-deadlift',
  'lat-pulldown', 'dumbbell-row', 'barbell-hip-thrust',
  'incline-dumbbell-press', 'seated-cable-row', 'leg-press', 'cable-curl',
];

describe('canonical participant identity', ()=>{
  it('one anonymous user across 10 exercises = 1 participant', ()=>{
    const rows = EXERCISES.map((ex, i)=> assignedRow({ user: null, exercise: ex, session: `s${i}` }));
    const primary = evaluateLongitudinal(rows).primaryComparison;
    assert.equal(primary.transitions, 10);
    assert.equal(primary.participants, 1);
    assert.ok(!primary.conclusive, 'a lone anonymous store must never satisfy a ≥2-participant requirement');
  });

  it('one identified user across many exercises = 1 participant', ()=>{
    const rows = EXERCISES.map((ex, i)=> assignedRow({ user: 'abc123', exercise: ex, session: `s${i}`, met: i % 2 === 0 }));
    const primary = evaluateLongitudinal(rows).primaryComparison;
    assert.equal(primary.transitions, 10);
    assert.equal(primary.participants, 1);
    assert.equal(primary.arise.participants, 1);
    assert.ok(!primary.conclusive);
  });

  it('multiple identified users remain distinct', ()=>{
    const rows = ['u1', 'u2', 'u3'].flatMap((u, ui)=> EXERCISES.slice(0, 4).map((ex, i)=>
      assignedRow({ user: u, exercise: ex, session: `s${ui}-${i}`, arm: ui % 2 ? 'double-progression' : 'arise', met: (ui + i) % 2 === 0 })));
    const primary = evaluateLongitudinal(rows).primaryComparison;
    assert.equal(primary.participants, 3);
    assert.equal(primary.arise.participants, 2);
    assert.equal(primary['double-progression'].participants, 1);
  });

  it('participantOf: id, blank id and bootstrap-pair shapes', ()=>{
    assert.equal(participantOf({ participantId: 'abc' }), 'abc');
    assert.equal(participantOf({ participantId: '  spaced  ' }), 'spaced');
    assert.equal(participantOf({ participantId: null }), ANONYMOUS_LOCAL_PARTICIPANT);
    assert.equal(participantOf({}), ANONYMOUS_LOCAL_PARTICIPANT);
    assert.equal(participantOf(null), ANONYMOUS_LOCAL_PARTICIPANT);
    // Bootstrap pairs carry identity under `participant`.
    assert.equal(participantOf({ participant: 'p9' }), 'p9');
    assert.equal(participantOf({ participant: '' }), ANONYMOUS_LOCAL_PARTICIPANT);
    // participantId wins over a stray participant field.
    assert.equal(participantOf({ participantId: 'first', participant: 'second' }), 'first');
  });

  it('participantOfStore: study id, else store-scoped fallback', ()=>{
    assert.equal(participantOfStore({ studyParticipantId: 'aaaabbbbccccdddd' }), 'aaaabbbbccccdddd');
    assert.equal(participantOfStore({ participantId: 'pp' }), 'pp');
    assert.equal(participantOfStore({}, 'anon-03'), 'anon-03');
    assert.equal(participantOfStore(null, 'anon-03'), 'anon-03');
    assert.equal(participantOfStore({}), 'store-anonymous');
  });
});

describe('participant thresholds cannot be inflated by exercise count', ()=>{
  it('gate reads people, not transitions — 10 exercises ≠ 10 participants', ()=>{
    const anonymous = EXERCISES.map((ex, i)=> assignedRow({ user: null, exercise: ex, session: `s${i}` }));
    const identified = EXERCISES.map((ex, i)=> assignedRow({ user: 'u1', exercise: ex, session: `s${i}` }));
    for(const rows of [anonymous, identified]){
      const primary = evaluateLongitudinal(rows).primaryComparison;
      const e = coachingEvidence(primary);
      assert.equal(e.users, 1);
      assert.equal(e.status, 'early');
      assert.match(e.lines[3], /needs ≥2 participants/);
    }
  });

  it('shadow comparison clusters the same rows as one user', ()=>{
    const rows = EXERCISES.map((ex, i)=> ({ ...assignedRow({ exercise: ex, session: `s${i}` }), assignedArm: null }));
    const shadow = prospectiveFieldComparison(rows);
    assert.equal(shadow.users, 1);
    assert.equal(shadow.gradeable, 10);
  });
});

describe('pooled store-scoped clustering', ()=>{
  function store({ id, ledger, consented = true }){
    return {
      code: id.slice(0, 8),
      studyParticipantId: id,
      store: {
        preferences: consented ? { telemetryEnabled: true } : {},
        history: [],
        evaluationLedger: ledger,
      },
    };
  }
  it('multiple anonymous imported stores remain distinct only when store boundaries represent independent participants', ()=>{
    // Unidentified file arrivals cannot be proven distinct people, so the
    // pooled gate excludes them entirely (reported honestly, never merged
    // into the one local anonymous identity either).
    const anon1 = { code: 'anon-01', store: { preferences: { telemetryEnabled: true }, history: [], evaluationLedger: EXERCISES.slice(0, 5).map((ex, i)=> assignedRow({ user: null, exercise: ex, session: `p1-s${i}` })) } };
    const anon2 = { code: 'anon-02', store: { preferences: { telemetryEnabled: true }, history: [], evaluationLedger: EXERCISES.slice(0, 5).map((ex, i)=> assignedRow({ user: null, exercise: ex, session: `p2-s${i}`, met: false })) } };
    const c = pooledAssignedComparison([anon1, anon2], { config: { longitudinal: { minimumSegmentSamples: 1 } }, minParticipants: 2, minTransitions: 5 });
    assert.equal(c.participants, 0);
    assert.equal(c.transitions, 0);
    assert.equal(c.excluded.unidentifiedExports, 2);
    assert.equal(c.maturity, 'insufficient');
    // IDENTIFIED stores are the honest independence unit: same shape, but
    // each carries a valid study id — distinct people, clustered per store,
    // and rows within one store never split by exercise.
    const identified = ['a'.repeat(16), 'b'.repeat(16)].map((id, si)=>
      store({ id, ledger: EXERCISES.slice(0, 5).map((ex, i)=> assignedRow({ user: null, exercise: ex, session: `s${si}-${i}`, met: (si + i) % 2 === 0 })) }));
    const c2 = pooledAssignedComparison(identified, { config: { longitudinal: { minimumSegmentSamples: 1 } }, minParticipants: 2, minTransitions: 5 });
    assert.equal(c2.participants, 2, 'two identified stores = two participants');
    assert.equal(c2.transitions, 10);
    assert.equal(c2.arise.participants, 2);
  });

  it('identified multi-user pooling still counts people once each', ()=>{
    const participants = ['a'.repeat(16), 'b'.repeat(16), 'c'.repeat(16)].map((id, ui)=>
      store({ id, ledger: EXERCISES.slice(0, 4).map((ex, i)=> assignedRow({ user: null, exercise: ex, session: `s${ui}-${i}`, arm: ui % 2 ? 'double-progression' : 'arise', met: (ui + i) % 2 === 0 })) }));
    const c = pooledAssignedComparison(participants, { config: { longitudinal: { minimumSegmentSamples: 1 } }, minParticipants: 3, minTransitions: 12 });
    assert.equal(c.participants, 3);
    assert.equal(c.transitions, 12);
    assert.equal(c['double-progression'].n, 4);
  });
});

describe('clustered uncertainty honours identity', ()=>{
  it('between-person assignment yields a conclusive clustered CI', ()=>{
    const pairs = [];
    for(let u = 0; u < 6; u++) for(let i = 0; i < 8; i++) pairs.push({ participant: `u${u}`, group: u % 2 ? 'double-progression' : 'arise', met: (u + i) % 3 !== 0 });
    const r = clusteredBootstrapDifference(pairs, { seed: 's' });
    assert.equal(r.participants, 6);
    assert.equal(r.design, 'between-person');
    assert.equal(r.conclusive, true);
    assert.ok(Number.isFinite(r.low) && Number.isFinite(r.high));
  });

  it('within-person crossover keeps the paired read and is deterministic', ()=>{
    const pairs = [];
    for(let u = 0; u < 3; u++){
      for(let i = 0; i < 5; i++) pairs.push({ participant: `u${u}`, group: 'arise', met: i % 2 === 0 });
      for(let i = 0; i < 5; i++) pairs.push({ participant: `u${u}`, group: 'double-progression', met: i % 3 === 0 });
    }
    const a = clusteredBootstrapDifference(pairs, { seed: 'd' });
    const b = clusteredBootstrapDifference(pairs, { seed: 'd' });
    assert.deepEqual(a, b);
    assert.equal(a.design, 'within-person');
    assert.equal(a.conclusive, true);
  });

  it('a single participant cluster cannot produce a clustered CI', ()=>{
    const solo = clusteredBootstrapDifference([{ participant: 'u1', group: 'arise', met: true }], { seed: 's' });
    assert.equal(solo.conclusive, false);
    assert.equal(solo.low, null);
  });
});

describe('assigned-arm treatment calculations unchanged otherwise', ()=>{
  it('rates, ITT adherence and next-exposure are the same arithmetic as before', ()=>{
    const rows = [
      assignedRow({ user: 'u1', session: 'a1', arm: 'arise', met: true }),
      assignedRow({ user: 'u1', session: 'a2', arm: 'arise', met: false }), // unfollowed transition still counts (ITT)
      assignedRow({ user: 'u2', session: 'b1', arm: 'double-progression', met: true }),
      assignedRow({ user: 'u2', session: 'b2', arm: 'double-progression', met: true }),
    ];
    const primary = evaluateLongitudinal(rows).primaryComparison;
    assert.equal(primary.arise.n, 2);
    assert.equal(primary.arise.metCount, 1);
    assert.equal(primary.arise.targetAchievementRate, 0.5);
    assert.equal(primary['double-progression'].n, 2);
    assert.equal(primary['double-progression'].targetAchievementRate, 1);
    assert.equal(primary.difference.metRateDelta, -0.5);
    assert.equal(primary.adherence.followedRate, 1); // ITT: scored whether or not targets were met
    const e = coachingEvidence(primary);
    assert.equal(e.observed, 4);
    assert.equal(e.users, 2);
    assert.equal(e.arise.targetAchievementRate, 0.5);
    assert.equal(e.doubleProgression.targetAchievementRate, 1);
  });
});
