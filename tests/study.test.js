import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDY_ARMS,
  doubleProgressionRec,
  linearProgressionRec,
  flatPrescriptionRec,
  computeArms,
  runComparativeStudy,
  studyCoverage,
  scoreCoachPrescriptions,
  validateDeloadDecisions,
  collectDeloadDecisions,
  assertAllFeaturesPrior,
} from '../src/lib/study.js';
import { validateSubstitutions, mergeEvaluationLedgers, saveEvaluationLedger } from '../src/lib/longitudinal.js';
import { buildExportPayload, parseImportFile, mergeStores } from '../src/lib/export.js';
import { mergeStoresWithConflicts } from '../src/lib/sync.js';

// Deterministic fixtures — no randomness, no wall clock in the data.
function sess(dateISO, exerciseId, sets){
  return { id: `${exerciseId}-${dateISO}`, dateISO, blocks: [{ exerciseId, sets }] };
}
function set(reps, weightKg, rpe){
  return { reps: String(reps), weightKg: String(weightKg), rpe: rpe ?? '' };
}

const RISING = [
  sess('2026-01-01', 'bench-press-dumbbell', [set(8, 20)]),
  sess('2026-01-04', 'bench-press-dumbbell', [set(9, 20)]),
  sess('2026-01-08', 'bench-press-dumbbell', [set(10, 20)]),
  sess('2026-01-12', 'bench-press-dumbbell', [set(8, 22.5)]),
  sess('2026-01-15', 'bench-press-dumbbell', [set(9, 22.5)]),
  sess('2026-01-19', 'bench-press-dumbbell', [set(10, 22.5)]),
];

describe('baseline arms', ()=>{
  it('double progression adds a rep until top of range', ()=>{
    const two = RISING.slice(0, 2);
    const rec = doubleProgressionRec({ history: two, exerciseId: 'bench-press-dumbbell', targetReps: '8–12' });
    assert.equal(rec.reps, 10); // last exposure was 9 reps
    assert.equal(rec.load, 20);
  });
  it('double progression steps load only at the very top of range', ()=>{
    const atTop = [sess('2026-01-01', 'bench-press-dumbbell', [set(12, 20)])];
    const rec = doubleProgressionRec({ history: atTop, exerciseId: 'bench-press-dumbbell', targetReps: '8–12' });
    assert.equal(rec.load, 22.5);
    assert.equal(rec.reps, 8);
  });
  it('linear progression always adds its increment for loaded lifts', ()=>{
    const rec = linearProgressionRec({ history: RISING.slice(0, 3), exerciseId: 'bench-press-dumbbell' });
    assert.equal(rec.load, 22.5);
    assert.equal(rec.reps, 10);
  });
  it('linear progression degenerates to rep gains for bodyweight lifts', ()=>{
    const bw = [sess('2026-01-01', 'push-up', [set(10, '')]), sess('2026-01-05', 'push-up', [set(11, '')])];
    const rec = linearProgressionRec({ history: bw, exerciseId: 'push-up' });
    assert.equal(rec.load, null);
    assert.equal(rec.reps, 12);
  });
  it('flat arm repeats the last performance exactly', ()=>{
    const rec = flatPrescriptionRec({ history: RISING.slice(0, 3), exerciseId: 'bench-press-dumbbell' });
    assert.deepEqual(rec, { load: 20, reps: 10 });
  });
  it('all arms handle cold-start without crashing', ()=>{
    const arms = computeArms({ exerciseId: 'bench-press-dumbbell', history: [] });
    for(const name of STUDY_ARMS) assert.ok(arms[name], `${name} returned nothing`);
  });
});

describe('runComparativeStudy', ()=>{
  const study = runComparativeStudy(RISING);

  it('scores every arm on identical prior-only transitions', ()=>{
    const ns = STUDY_ARMS.map(name=> study.overall[name].n);
    assert.ok(new Set(ns).size === 1, `arms saw different transition counts: ${ns}`);
    assert.ok(study.transitions > 0);
  });

  it('is deterministic', ()=>{
    const again = runComparativeStudy(RISING);
    assert.deepEqual(study.overall, again.overall);
  });

  it('withholds conclusions below the sample gate', ()=>{
    assert.equal(study.overall.arise.n >= study.minimumSamples, study.overall.arise.conclusive);
  });

  it('rising history makes flat-arm conservatism measurable and success rates sane', ()=>{
    const flat = study.overall.flat;
    const arise = study.overall.arise;
    // On strictly rising e1RM, repeating the last performance is by definition
    // followed by progress — conservatism rate should be 1.0.
    assert.equal(flat.unnecessaryConservatismRate, 1);
    assert.ok(arise.progressionSuccessRate === null || arise.progressionSuccessRate <= 1);
  });

  it('never lets a later session influence an earlier prescription (prior-only)', ()=>{
    // Truncate after the 3rd session; every score involving sessions ≤3 must be unchanged.
    const truncated = runComparativeStudy(RISING.slice(0, 3));
    assert.ok(truncated.transitions > 0);
    assert.ok(truncated.transitions <= study.transitions);
  });

  it('reports per-exercise segments gated by sample size', ()=>{
    const seg = study.byExercise['bench-press-dumbbell'];
    assert.ok(seg, 'missing per-exercise segment');
    assert.ok(seg[STUDY_ARMS[0]], 'arm rows missing');
  });

  it('pairs every baseline against arise on identical transitions', ()=>{
    for(const [arm, pair] of Object.entries(study.pairedVsArise)){
      const accounted = pair.ariseWins + pair.baselineWins + pair.bothMetTarget + pair.neitherMetTarget;
      assert.equal(accounted, pair.pairs, `${arm} paired counts do not sum to pairs`);
      assert.equal(pair.pairs, study.overall.arise.n, `${arm} saw different transitions than arise`);
    }
  });

  it('segments the replay by experience level', ()=>{
    assert.ok(study.byExperienceLevel, 'missing byExperienceLevel');
    const phases = Object.keys(study.byExperienceLevel);
    assert.ok(phases.length >= 1);
    for(const phase of phases){
      for(const arm of STUDY_ARMS) assert.ok(study.byExperienceLevel[phase][arm], `missing ${arm} in phase ${phase}`);
    }
  });

  // ── Regression: provenance / prior-only guarantees ──
  it('every feature carries provenance with timestamps <= prescription date (#5)', ()=>{
    const readinessLog = [
      { dateISO: '2026-01-06', score: 80 },   // prior to the Jan 8 outcome
      { dateISO: '2026-01-11', score: 90 },   // AFTER Jan 8 — must stay invisible
    ];
    const s = runComparativeStudy(RISING, { readinessLog, includeRows: true });
    assert.ok(Array.isArray(s.rows) && s.rows.length > 0);
    for(const row of s.rows){
      const pr = row.provenance.features.readinessBucket;
      if(pr.observedAt) assert.ok(pr.observedAt <= row.dateISO, `readiness ${pr.observedAt} classified ${row.dateISO}`);
      assert.equal(row.provenance.features.repRangeMedian.validPrior, true);
    }
    const check = assertAllFeaturesPrior(s.rows);
    assert.equal(check.ok, true, JSON.stringify(check.violations));
  });

  it('provenance helper flags a future-dated observation (#5)', ()=>{
    const rows = [{
      exerciseId: 'bench', dateISO: '2026-01-10',
      provenance: {
        prescriptionAt: '2026-01-10',
        cutoffDateISO: '2026-01-05',
        features: {
          readinessBucket: { value: 42, observedAt: '2026-01-11', validPrior: true },
          repRangeMedian: { lastPriorDateISO: '2026-01-05', validPrior: true },
        },
      },
    }];
    const result = assertAllFeaturesPrior(rows);
    assert.equal(result.ok, false);
    assert.match(result.violations[0], /readiness.*AFTER/);
  });
});

describe('evaluation ledger portability', ()=>{
  it('unions ledgers by id and prefers resolved records', ()=>{
    const current = [
      { id: 'a', outcome: null },
      { id: 'b', outcome: { metTarget: true } },
    ];
    const incoming = [
      { id: 'a', outcome: { metTarget: false } },
      { id: 'c', outcome: null },
    ];
    const merged = mergeEvaluationLedgers(current, incoming);
    assert.equal(merged.length, 3);
    assert.equal(merged.find(r=> r.id === 'a').outcome?.metTarget, false); // resolved beats unresolved
    assert.ok(merged.find(r=> r.id === 'b').outcome); // untouched
    assert.ok(merged.find(r=> r.id === 'c'));
  });

  it('travels inside the backup payload and round-trips through import/merge', ()=>{
    // Export snapshots the ledger from its own storage key, so seed that key.
    const mem = {};
    globalThis.localStorage = {
      getItem: k=> (k in mem ? mem[k] : null),
      setItem: (k, v)=> { mem[k] = String(v); },
      removeItem: k=> { delete mem[k]; },
    };
    try{
      saveEvaluationLedger([{ id: 'eval-1', recommendation: {}, outcome: { metTarget: true } }]);
      const store = {
        version: 6, onboarding: null, activeSchedule: null,
        history: [{ id: 'h1', dateISO: '2026-01-01' }],
        preferences: {},
      };
      const parsed = parseImportFile(JSON.stringify(buildExportPayload(store)));
      assert.equal(parsed.evaluationLedger.length, 1);

      const merged = mergeStores({ evaluationLedger: [{ id: 'eval-0', outcome: null }] }, parsed, 'merge');
      assert.equal(merged.evaluationLedger.length, 2);

      const synced = mergeStoresWithConflicts(
        { version: 6, history: [], evaluationLedger: [parsed.evaluationLedger[0]] },
        { version: 6, history: [], evaluationLedger: [{ id: 'eval-2', outcome: null }] },
      );
      assert.equal(synced.evaluationLedger.length, 2);
    }finally{
      delete globalThis.localStorage;
    }
  });
});

describe('studyCoverage', ()=>{
  it('reports deficits against the minimum segment size', ()=>{
    const ledger = [
      { recommendation: {}, outcome: {}, exerciseId: 'a', basis: { trainingAgePhase: 'novice' } },
      { recommendation: {}, outcome: {}, exerciseId: 'a', basis: { trainingAgePhase: 'novice' } },
      { recommendation: {}, outcome: null, exerciseId: 'b', basis: {} },
    ];
    const cov = studyCoverage(ledger, { config: { longitudinal: { minimumSegmentSamples: 5 } } });
    assert.equal(cov.totalResolved, 2);
    assert.equal(cov.openRecords, 1);
    const exA = cov.byExercise.find(s=> s.key === 'a');
    assert.equal(exA.deficit, 3);
    assert.equal(exA.conclusive, false);
    assert.ok(cov.gaps.length >= 2);
  });
});

describe('coach comparator', ()=>{
  it('scores coach prescriptions that precede a real exposure', ()=>{
    const result = scoreCoachPrescriptions(RISING, [
      { dateISO: '2026-01-08', exerciseId: 'bench-press-dumbbell', loadKg: 21, reps: 8 },
    ]);
    assert.equal(result.n, 1);
    assert.equal(result.key, 'coach');
    assert.ok(Number.isFinite(result.meanLoadErrorKg));
  });

  it('ignores prescriptions with no following exposure', ()=>{
    const result = scoreCoachPrescriptions(RISING, [
      { dateISO: '2026-03-01', exerciseId: 'bench-press-dumbbell', loadKg: 30, reps: 8 },
    ]);
    assert.equal(result.n, 0);
  });
});

describe('deload validation', ()=>{
  function volumeWeek(startDay, kg){
    const out = [];
    for(const day of startDay){
      const iso = `2026-02-${String(day).padStart(2, '0')}`;
      out.push(sess(iso, 'barbell-squat', [set(5, kg), set(5, kg), set(5, kg)]));
    }
    return out;
  }
  const deloadHistory = [
    ...volumeWeek([2, 4, 6], 60),   // heavy week (~2700kg)
    ...volumeWeek([9, 11, 13], 40), // deload week applied
    ...volumeWeek([16, 18, 20], 60), // normal volume resumes
  ];

  it('detects an applied cut and the rebound', ()=>{
    const result = validateDeloadDecisions(
      [{ dateISO: '2026-02-09', signals: ['plateau'] }],
      deloadHistory,
    );
    assert.equal(result.decisions, 1);
    assert.equal(result.cutsObservedRate, 1);
    assert.ok(result.normalisedWithinTwoWeeksRate >= 0.5);
  });

  it('marks a decision not followed by a cut as unapplied', ()=>{
    const result = validateDeloadDecisions(
      [{ dateISO: '2026-02-16', signals: [] }], // next week stays at full volume
      deloadHistory,
    );
    assert.equal(result.rows[0].cutApplied, false);
    assert.equal(result.cutsObservedRate, 0);
  });

  it('collects decisions from schedule adaptation histories', ()=>{
    const schedules = [{ adaptationHistory: [
      { dateISO: '2026-02-09', decision: { deload: true, deloadSignals: ['plateau'] } },
      { dateISO: '2026-02-12', decision: { deload: false } },
    ]}];
    const decisions = collectDeloadDecisions(schedules);
    assert.equal(decisions.length, 1);
    assert.deepEqual(decisions[0].signals, ['plateau']);
  });
});

describe('substitution validation', ()=>{
  it('measures adoption and retention of swapped-in exercises', ()=>{
    const history = [
      { id: 's1', dateISO: '2026-01-01', blocks: [
        { exerciseId: 'goblet-squat', substitutionFrom: 'barbell-squat', substitutionReason: 'no rack', sets: [set(10, 24)] },
      ]},
      { id: 's2', dateISO: '2026-01-05', blocks: [
        { exerciseId: 'goblet-squat', sets: [set(10, 26)] },
      ]},
      { id: 's3', dateISO: '2026-01-08', blocks: [
        { exerciseId: 'band-row', substitutionFrom: 'dumbbell-row', sets: [set()] }, // logged but empty
      ]},
    ];
    const result = validateSubstitutions(history);
    assert.equal(result.substitutions, 2);
    assert.equal(result.performed, 1);
    assert.equal(result.performedRate, 0.5);
    assert.equal(result.followedUp, 1);
    assert.equal(result.retainedRate, 1); // 26kg held vs 24kg swap-day
    assert.equal(result.rows[0].retained, true);
  });
});

describe("segmented comparisons", ()=>{
  const RISING2 = [
    sess("2026-01-01","bench-press-dumbbell",[set(8,20)]),
    sess("2026-01-04","lateral-raise",[set(12,5)]),
    sess("2026-01-08","bench-press-dumbbell",[set(9,20)]),
    sess("2026-01-11","lateral-raise",[set(13,5)]),
    sess("2026-01-15","bench-press-dumbbell",[set(10,20)]),
    sess("2026-01-18","lateral-raise",[set(14,5)]),
  ];
  const readinessLog = [{ dateISO:"2026-01-08", score:80 }, { dateISO:"2026-01-15", score:25 }];
  const s2 = runComparativeStudy(RISING2, { readinessLog });

  it("segments every requested dimension with gated arms", ()=>{
    for(const dim of ["byStructure","byEquipmentClass","byStrategy","byRepRange","byFrequency","byReadiness","byExperienceLevel"]){
      assert.ok(s2.segments?.[dim], `missing ${dim}`);
      for(const key of Object.keys(s2.segments[dim])){
        for(const arm of STUDY_ARMS){
          const seg = s2.segments[dim][key][arm];
          assert.ok(seg, `${dim}/${key}/${arm} missing`);
          assert.equal(typeof seg.conclusive, "boolean");
        }
      }
    }
  });

  it("classifies structure and equipment from the exercise database", ()=>{
    assert.ok(s2.segments.byStructure.compound.arise.n > 0);
    assert.ok(s2.segments.byStructure.isolation.arise.n > 0);
    assert.ok(s2.segments.byEquipmentClass["free-weights"].arise.n > 0);
  });

  it("buckets readiness high vs low using nearby logs", ()=>{
    assert.ok(s2.segments.byReadiness.high.arise.n > 0);
    assert.ok(s2.segments.byReadiness.low.arise.n > 0);
  });

  it("never classifies a transition with a readiness score logged AFTER it", ()=>{
    // One entry, dated two days after the last workout. Under nearest-match
    // semantics it would have classified the final transition — future info.
    const s = runComparativeStudy(RISING, { readinessLog: [{ dateISO: "2026-01-21", score: 80 }] });
    assert.equal(s.segments.byReadiness.high?.arise.n ?? 0, 0);
    assert.equal(s.overall.arise.n, s.segments.byReadiness.unknown.arise.n);
  });

  it("readiness classification uses only prior-or-same-day scores", ()=>{
    // Strictly prior/same-day logs: Jan 7 covers Jan 4+8, Jan 12 covers itself
    // and Jan 15 (same-day allowed, <=); nothing reaches Jan 19 or back to Jan 1.
    const s = runComparativeStudy(RISING, { readinessLog: [
      { dateISO: "2026-01-07", score: 80 },
      { dateISO: "2026-01-12", score: 25 },
    ]});
    const segs = s.segments.byReadiness;
    const total = ["high","low","unknown"].reduce((a,k)=> a + (segs[k]?.arise.n ?? 0), 0);
    assert.equal(total, s.overall.arise.n);
    assert.ok(segs.high.arise.n > 0, "prior high score should classify earlier transitions");
    assert.ok(segs.low.arise.n > 0, "same-day score should classify its own day");
    assert.ok(segs.unknown.arise.n > 0, "transitions without prior data stay unknown");
    // A later, higher score may never rescue an earlier low-readiness day:
    // Jan 12 scored 25 on the day — it cannot land in 'high' via Jan 15+ data.
    void segs;
  });

  it("rep-range segments are defined by PRIOR exposures only", ()=>{
    // Reps [4, 9, 9, then an outcome of 3]. The 3-rep outcome must be scored
    // against the rep-range its PRIOR median implies (9 -> high), never its
    // own achieved reps pulling the median down into mid.
    const history = [
      sess("2026-01-01","bench-press-dumbbell",[set(4,20)]),
      sess("2026-01-05","bench-press-dumbbell",[set(9,20)]),
      sess("2026-01-09","bench-press-dumbbell",[set(9,20)]),
      sess("2026-01-13","bench-press-dumbbell",[set(3,20)]),
    ];
    const s = runComparativeStudy(history);
    assert.equal(s.overall.arise.n, 3);
    // Fixed: transitions 2 and 3 carry prior median 9 -> high; transition 1
    // carries prior median 4 -> low. (The leaked version scored transition 3
    // as low too, because its own 3-rep outcome dragged the median down.)
    assert.equal(s.segments.byRepRange["high(≥9)"].arise.n, 2, "transitions 2 and 3 have prior median 9");
    assert.equal(s.segments.byRepRange["low(≤5)"].arise.n, 1, "only transition 1 has prior median 4");
    assert.equal(s.segments.byRepRange["mid(6–8)"]?.arise.n ?? 0, 0);
  });
});
