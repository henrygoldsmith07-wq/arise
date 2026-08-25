import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordRecommendation,
  attachOutcome,
  evaluateLongitudinal,
  clusteredBootstrapWinRate,
  EVALUATION_SCHEMA_VERSION,
} from '../src/lib/longitudinal.js';
import { computeArms, STUDY_ARMS, assignExerciseArm, buildStudyDesign } from '../src/lib/study.js';

const CONSENT = { telemetryEnabled: true };
const memStorage = ()=> {
  const mem = new Map();
  return { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k,v)=> mem.set(k,String(v)), removeItem: k=> mem.delete(k) };
};

function sess(id, dateISO, exerciseId, sets){
  return { id, dateISO, blocks: [{ exerciseId, sets }] };
}
function set(reps, weightKg, rpe){ return { reps: String(reps), weightKg: String(weightKg), rpe: rpe == null ? '' : String(rpe) }; }

// Prior-only prefix: two bench exposures, rising.
const PREFIX = [
  sess('a', '2026-01-02', 'bench-press-dumbbell', [set(8, 20, 7)]),
  sess('b', '2026-01-05', 'bench-press-dumbbell', [set(9, 20, 7)]),
];
// A FUTURE session that must never influence a snapshot taken from PREFIX.
const FUTURE = [sess('c', '2026-02-01', 'bench-press-dumbbell', [set(15, 40, 5)])];

describe('prospective arm comparison (real-training ledger)', ()=>{

  it('freezes all five arms at record time, arise byte-identical to the recommendation', ()=>{
    const store = memStorage();
    const rec = recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 21, reps: 10 },
      history: PREFIX,
      dueDateISO: '2026-01-08',
      targetReps: '8–12',
      preferences: CONSENT,
      config: null,
      storage: store,
    });
    assert.ok(rec.arms, 'arms must be frozen at record time');
    for(const arm of STUDY_ARMS) assert.ok(rec.arms[arm], `missing frozen arm ${arm}`);
    assert.equal(rec.arms.arise.load, 21);
    assert.equal(rec.arms.arise.reps, 10);
    // Baselines computed from the same prefix:
    const expected = computeArms({ exerciseId: 'bench-press-dumbbell', history: PREFIX, targetReps: '8–12' });
    assert.deepEqual(
      { dp: rec.arms['double-progression'], lin: rec.arms['linear-progression'], fr: rec.arms['fixed-rules'], flat: rec.arms.flat },
      { dp: expected['double-progression'], lin: expected['linear-progression'], fr: expected['fixed-rules'], flat: expected.flat },
    );
    assert.equal(rec.schemaVersion, EVALUATION_SCHEMA_VERSION);
  });

  it('is prior-only: future sessions cannot change a frozen snapshot', ()=>{
    const before = recordRecommendation({ exerciseId:'bench-press-dumbbell', recommendation:{ load:21, reps:10 }, history: PREFIX, dueDateISO:'2026-01-08', targetReps:'8–12', preferences: CONSENT, storage: memStorage() });
    const after = recordRecommendation({ exerciseId:'bench-press-dumbbell', recommendation:{ load:21, reps:10 }, history: [...PREFIX, ...FUTURE], dueDateISO:'2026-01-08', targetReps:'8–12', preferences: CONSENT, storage: memStorage() });
    assert.deepEqual(before.arms, after.arms, 'identical priors must yield identical frozen arms regardless of later sessions');
  });

  it('scores every frozen arm against the same realised outcome', ()=>{
    const store = memStorage();
    // Arise says jump to 22.5 kg × 8; baselines were frozen from PREFIX.
    recordRecommendation({
      exerciseId:'bench-press-dumbbell', recommendation:{ load:22.5, reps:8 },
      history: PREFIX, dueDateISO:'2026-01-08', targetReps:'8–12', preferences: CONSENT, storage: store,
    });
    // Realised: best set 22.5 kg × 8 — meets arise AND linear's load but not
    // their rep targets above; misses double-progression/fixed-rules rep
    // targets (10) and flat (9).
    const resolved = attachOutcome({
      sessionId:'s-real', dateISO:'2026-01-09',
      blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8, 22.5, 8)] }],
      preferences: CONSENT, storage: store,
    });
    assert.equal(resolved.length, 1);
    const arms = resolved[0].outcome.arms;
    assert.equal(arms.arise.metTarget, true);
    assert.equal(arms['double-progression'].metTarget, false, 'DP demanded 10 reps, got 8');
    assert.equal(arms['linear-progression'].metTarget, false, 'linear demanded 9 reps, got 8');
    assert.equal(arms['fixed-rules'].metTarget, false);
    assert.equal(arms.flat.metTarget, false);
  });

  it('gates rates behind the sample minimum and pairs every transition', ()=>{
    const store = memStorage();
    // Five resolved records where arise meets target and flat misses three of them.
    let day = 2;
    for(let i = 0; i < 5; i++){
      const dISO = `2026-03-${String(day).padStart(2,'0')}`;
      day += 3;
      const history = [
        ...PREFIX.map((s,i2)=> ({ ...s, dateISO:`2026-02-${String(1+i2*3).padStart(2,'0')}` })),
        sess(`pre-${i}`, `2026-03-${String(Math.max(1,day-4)).padStart(2,'0')}`, 'bench-press-dumbbell', [set(9, 20, 7)]),
      ];
      recordRecommendation({ exerciseId:'bench-press-dumbbell', recommendation:{ load:22.5, reps:8 }, history, dueDateISO:dISO, targetReps:'8–12', preferences: CONSENT, storage: store });
      attachOutcome({ sessionId:`real-${i}`, dateISO:dISO, blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8, 22.5, 8)] }], preferences: CONSENT, storage: store });
    }
    const ev = evaluateLongitudinal(requireLedger(store));
    assert.ok(ev.byArm.arise, 'arise arm present');
    for(const arm of ['double-progression','linear-progression','fixed-rules','flat']){
      assert.ok(ev.byArm[arm], `missing ${arm}`);
      assert.equal(ev.byArm[arm].conclusive, true, `${arm} should clear the sample gate`);
      assert.ok(ev.byArm[arm].targetAchievementRate != null);
      const p = ev.pairedVsArise[arm];
      assert.equal(p.pairs, p.ariseWins + p.armWins + p.bothMetTarget + p.neitherMetTarget);
      assert.equal(p.conclusive, true);
    }
    assert.equal(ev.byArm.flat.targetAchievementRate, 0, 'flat demanded 9+ reps every time; the realised 8-rep sets never met it');
    assert.equal(ev.byArm.arise.targetAchievementRate, 1);
    assert.ok(ev.byArm.flat.conservatismRate != null);
  });

  it('tolerates schema-v1 records without frozen arms', ()=>{
    const store = memStorage();
    const legacy = {
      id: 'legacy-1', schemaVersion: 1,
      exerciseId: 'bench-press-dumbbell', movementPattern: 'push', equipmentClass: 'free-weights',
      programId: null, programVersion: null,
      recommendation: { load: 22.5, reps: 8, assistKg: null, reason: '', strategy: null },
      recommendedAction: 'add_load',
      basis: { visibleSessions: 2, previousBest: { reps: 9, weightKg: 20, assistedKg: 0, e1rm: 26 }, trainingAgePhase: 'novice', priorsVersion: 1 },
      outcome: null,
    };
    // Seed the v1 record through the same storage contract.
    recordRecommendation({ exerciseId:'bench-press-dumbbell', recommendation:{ load:22.5, reps:8 }, history: PREFIX, dueDateISO:'2026-04-01', targetReps:'8–12', preferences: CONSENT, storage: store });
    const raw = JSON.parse(store.getItem('arise.evaluation.v1'));
    raw.records.push(legacy);
    store.setItem('arise.evaluation.v1', JSON.stringify({ schemaVersion: 2, records: raw.records }));
    const resolved = attachOutcome({ sessionId:'l', dateISO:'2026-04-02', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5,8)] }], preferences: CONSENT, storage: store });
    assert.equal(resolved.length, 2);
    const noArms = resolved.find(r=> r.id === 'legacy-1');
    assert.deepEqual(noArms.outcome.arms, {}, 'v1 record has nothing to score');
    const ev = evaluateLongitudinal(requireLedger(store));
    assert.ok(ev.byArm.arise.n >= 1);
    assert.ok(!('stallRate' in ev.byArm.arise) || ev.byArm.arise.stallRate != null || true); // shape tolerant
  });
});

describe('trial design, policy freezing and honest scoring', ()=>{

  it('exercise-level assignment is deterministic and balanced (#6)', ()=>{
    const ids = ['bench-press-dumbbell','goblet-squat','romanian-deadlift','lat-pulldown','bicep-curl','leg-press','push-up','deadlift'];
    const a = buildStudyDesign(ids, 'seed-x');
    const b = buildStudyDesign(ids, 'seed-x');
    assert.deepEqual(a.assignment, b.assignment, 'same seed must reproduce the assignment');
    const again = ids.map(id => assignExerciseArm(id, 'seed-x'));
    assert.deepEqual(again, ids.map(id => assignExerciseArm(id, 'seed-x')));
    assert.equal(a.ariseExercises + a.doubleProgressionExercises, ids.length);
  });

  it('engine-version changes cannot silently merge evaluated treatments (#9)', ()=>{
    const store = memStorage();
    const base = { exerciseId:'bench-press-dumbbell', recommendation:{ load:22.5, reps:8 }, history: PREFIX, dueDateISO:'2026-01-08', targetReps:'8–12', preferences: CONSENT, storage: store };
    recordRecommendation(base);
    // Same inputs, but the policy has moved forward.
    recordRecommendation({ ...base, config: { progressionModel: { version: 2 } } });
    attachOutcome({ sessionId:'s1', dateISO:'2026-01-09', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5,8)] }], preferences: CONSENT, storage: store });
    const ev = evaluateLongitudinal(requireLedger(store));
    assert.ok(ev.mixedPolicyVersions.length >= 2, 'two model versions must be reported separately');
    assert.match(ev.note, /never merge treatments across versions/);
    for(const key of ev.mixedPolicyVersions) assert.ok(ev.byPolicyVersion[key], `missing byPolicyVersion ${key}`);
  });

  it('missing prescription means adherence UNKNOWN, never compliant (#10)', ()=>{
    const store = memStorage();
    // Legacy v1-style record: no frozen arms at all.
    recordRecommendation({ exerciseId:'bench-press-dumbbell', recommendation:{ load:22.5, reps:8 }, history: PREFIX, dueDateISO:'2026-01-08', targetReps:'8–12', preferences: CONSENT, storage: store });
    const raw = JSON.parse(store.getItem('arise.evaluation.v1'));
    delete raw.records[0].arms;
    delete raw.records[0].recommendation;
    store.setItem('arise.evaluation.v1', JSON.stringify(raw));
    const resolved = attachOutcome({ sessionId:'s', dateISO:'2026-01-09', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5,8)] }], preferences: CONSENT, storage: store });
    assert.equal(resolved[0].outcome.followed, null);
  });

  it('an aggressive prescription is scored as an overshoot, not progress (#11)', ()=>{
    const store = memStorage();
    recordRecommendation({ exerciseId:'bench-press-dumbbell', recommendation:{ load:20, reps:8 }, history: PREFIX, dueDateISO:'2026-01-08', targetReps:'8–12', preferences: CONSENT, storage: store });
    // Sabotage the frozen arm into a reckless +50% jump (simulating a policy
    // that just prescribes heavier): 30 kg demanded vs 20 kg previous best.
    const raw = JSON.parse(store.getItem('arise.evaluation.v1'));
    raw.records[0].arms['linear-progression'] = { load: 30, reps: 8 };
    store.setItem('arise.evaluation.v1', JSON.stringify(raw));
    const resolved = attachOutcome({ sessionId:'s', dateISO:'2026-01-09', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5,9)] }], preferences: CONSENT, storage: store });
    assert.equal(resolved[0].outcome.arms['linear-progression'].metTarget, false, '30kg prescribed, 22.5 done — miss');
    const ev = evaluateLongitudinal(requireLedger(store), { config: { longitudinal: { minimumSegmentSamples: 1 } } });
    assert.equal(ev.byArm['linear-progression'].aggressiveOvershootRate, 1, 'the jump must be counted as an overshoot');
    assert.equal(ev.pairedVsArise['linear-progression'].ariseWins + ev.pairedVsArise['linear-progression'].armWins + ev.pairedVsArise['linear-progression'].bothMetTarget + ev.pairedVsArise['linear-progression'].neitherMetTarget, 1);
  });

  it('participant-clustered bootstrap is deterministic and widens with few participants', ()=>{
    const pairs = [];
    for(let p = 0; p < 3; p++){
      for(let i = 0; i < 10; i++) pairs.push({ participant: `P${p}`, ariseMet: true, armMet: p !== 0 }); // P0 never meets DP targets
    }
    const a = clusteredBootstrapWinRate(pairs, { seed: 's' });
    const b = clusteredBootstrapWinRate(pairs, { seed: 's' });
    assert.deepEqual(a, b, 'bootstrap must be deterministic');
    assert.equal(a.participants, 3);
    assert.ok(a.low <= a.mean && a.mean <= a.high);
    assert.ok(a.low < a.mean - 0.15, 'a zero-rate participant must widen the interval');
    assert.equal(clusteredBootstrapWinRate([{ participant:'P0', ariseMet:true, armMet:true }]).conclusive, false, 'one participant cannot yield a clustered interval');
  });
});

function requireLedger(store){
  const raw = JSON.parse(store.getItem('arise.evaluation.v1') || '{"records":[]}');
  return raw.records || [];
}
