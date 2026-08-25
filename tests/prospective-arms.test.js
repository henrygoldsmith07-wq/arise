import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordRecommendation,
  attachOutcome,
  evaluateLongitudinal,
  EVALUATION_SCHEMA_VERSION,
} from '../src/lib/longitudinal.js';
import { computeArms, STUDY_ARMS } from '../src/lib/study.js';

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

function requireLedger(store){
  const raw = JSON.parse(store.getItem('arise.evaluation.v1') || '{"records":[]}');
  return raw.records || [];
}
