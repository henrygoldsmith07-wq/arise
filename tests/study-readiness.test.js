// Canonical study-readiness tests: one predicate, one gate configuration, one
// readiness result everywhere. Whatever readiness surface a reader looks at —
// cohort.gate, fieldStudy status, assigned gates, claim readiness — they must
// agree, because they ARE one result.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidAssignedStudyTransition,
  evaluateTransitionEvidence,
  countStudyEvidence,
  evaluateStudyReadiness,
  STUDY_GATES,
} from '../src/lib/studyReadiness.js';
import { ingestParticipantFiles, summariseCohort, renderCohortReport } from '../src/lib/cohortOps.js';
import { computeFieldStudy, pooledAssignedComparison, renderFieldReport } from '../src/lib/fieldStudy.js';

const LIVE = { origin: 'live-engine' };

// A valid resolved assigned-arm transition, parameterised so each test can
// break exactly one requirement.
function validRow({ id = 'r1', arm = 'arise', met = true, sessionId = 's1', provenance = LIVE, outcomeProvenance = LIVE, assignedMet = met } = {}){
  return {
    id,
    recommendation: { load: 40, reps: 8 },
    assignedArm: arm,
    exerciseId: 'bench-press-dumbbell',
    provenance,
    outcomeProvenance,
    outcome: { assignedMet, metTarget: met, sessionId, dateISO: '2026-02-01', followed: true },
  };
}

function participantPackage(id, rows, { consent = true, code = null } = {}){
  return {
    code: code || id.slice(0, 8),
    studyParticipantId: id,
    store: {
      version: 9,
      studyParticipantId: id,
      preferences: { telemetryEnabled: consent },
      history: [],
      readinessLog: [],
      eventHistory: [],
      evaluationLedger: rows,
    },
  };
}

// `n` contributors each carrying `rowsPer` DISTINCT valid arise rows and the
// same number of distinct double-progression rows.
function cohortWith({ contributors = 10, rowsPer = 50, consent = true } = {}){
  const packages = [];
  for(let i = 0; i < contributors; i++){
    const id = (i + 1).toString(16).padStart(16, '0');
    const rows = [];
    for(let t = 0; t < rowsPer; t++){
      rows.push(validRow({ id: `a${i}-${t}`, arm: 'arise', met: t % 3 !== 0, sessionId: `sa${i}-${t}` }));
      rows.push(validRow({ id: `d${i}-${t}`, arm: 'double-progression', met: t % 4 !== 0, sessionId: `sd${i}-${t}` }));
    }
    packages.push(participantPackage(id, rows, { consent }));
  }
  return packages;
}

describe('canonical transition predicate', ()=>{
  it('accepts exactly the rows that meet every requirement', ()=>{
    assert.equal(isValidAssignedStudyTransition(validRow({})), true);
    assert.equal(isValidAssignedStudyTransition(validRow({ provenance: { origin: 'import' } })), false, 'imported recommendation provenance is not evidence');
    assert.equal(isValidAssignedStudyTransition(validRow({ outcomeProvenance: null })), false, 'missing outcome provenance is not evidence');
    assert.equal(isValidAssignedStudyTransition(validRow({ arm: 'linear-progression' })), false, 'non-primary arms never count');
    assert.equal(isValidAssignedStudyTransition(validRow({ assignedMet: null })), false, 'ungraded outcomes never count');
    assert.equal(isValidAssignedStudyTransition({ recommendation: { load: 40 }, assignedArm: 'arise' }), false, 'unresolved rows never count');
    assert.equal(isValidAssignedStudyTransition(null), false);
    assert.equal(isValidAssignedStudyTransition({ assignedArm: 'arise' }), false, 'no recommendation → not a ledger row at all');
  });

  it('evaluateTransitionEvidence buckets every rejection reason separately', ()=>{
    const rows = [
      validRow({ id: 'ok1', arm: 'arise' }),
      validRow({ id: 'ok2', arm: 'double-progression' }),
      { assignedArm: 'arise' },                                    // no recommendation
      { ...validRow({ id: 'open' }), outcome: undefined },         // open
      validRow({ id: 'shadow', arm: 'linear-progression' }),       // unassigned arm
      validRow({ id: 'unproven', provenance: { origin: 'replay' } }),
      validRow({ id: 'ungraded', assignedMet: null }),
    ];
    const { valid, invalid } = evaluateTransitionEvidence(rows);
    assert.equal(valid.arise.length, 1);
    assert.equal(valid['double-progression'].length, 1);
    assert.deepEqual(invalid, { noRecommendation: 1, open: 1, unassigned: 1, unproven: 1, ungraded: 1 });
  });
});

describe('canonical evidence counting', ()=>{
  it('total = valid arise + valid double-progression; invalid rows never count', ()=>{
    const packages = cohortWith({ contributors: 2, rowsPer: 3 });
    packages[0].store.evaluationLedger.push(
      validRow({ id: 'x1', arm: 'linear-progression' }),       // unassigned
      validRow({ id: 'x2', provenance: { origin: 'seed' } }),  // unproven
      validRow({ id: 'x3', assignedMet: null }),               // ungraded
      { ...validRow({ id: 'x4' }), outcome: undefined },       // open
    );
    const evidence = countStudyEvidence(packages);
    assert.equal(evidence.transitionsArise, 6);
    assert.equal(evidence.transitionsDoubleProgression, 6);
    assert.equal(evidence.transitionsTotal, 12);
    assert.equal(evidence.invalid.unassigned, 1);
    assert.equal(evidence.invalid.unproven, 1);
    assert.equal(evidence.invalid.ungraded, 1);
    assert.equal(evidence.invalid.open, 1);
  });

  it('unconsented participants contribute nothing', ()=>{
    const consented = cohortWith({ contributors: 1, rowsPer: 2 });
    const silent = cohortWith({ contributors: 1, rowsPer: 2, consent: false });
    const evidence = countStudyEvidence([...consented, ...silent]);
    assert.equal(evidence.contributors.total, 1, 'consent is part of contribution');
    assert.equal(evidence.transitionsTotal, 4);
  });

  it('unidentified exports earn no breadth credit', ()=>{
    const identified = cohortWith({ contributors: 1, rowsPer: 1 });
    const ghost = participantPackage('g'.repeat(16), [validRow({ id: 'g1' })]);
    delete ghost.studyParticipantId;
    delete ghost.store.studyParticipantId;
    const evidence = countStudyEvidence([...identified, ghost]);
    assert.equal(evidence.contributors.total, 1, 'an unidentified export is not a participant');
  });

  it('invalid provenance earns no transition credit and no contributor credit', ()=>{
    const packages = cohortWith({ contributors: 1, rowsPer: 1 });
    packages[0].store.evaluationLedger = packages[0].store.evaluationLedger.map(r => ({ ...r, provenance: { origin: 'import' } }));
    const evidence = countStudyEvidence(packages);
    assert.equal(evidence.transitionsTotal, 0);
    assert.equal(evidence.contributors.total, 0);
    assert.equal(evidence.invalid.unproven, 2, 'rowsPer: 1 builds one arise + one double-progression row');
  });

  it('cross-export duplicate rows fold instead of inflating depth', ()=>{
    const packages = cohortWith({ contributors: 1, rowsPer: 2 });
    // The same participant re-exports with the same rows (cumulative snapshot).
    const repeat = JSON.parse(JSON.stringify(packages[0]));
    repeat.store.evaluationLedger = repeat.store.evaluationLedger.map(r => ({ ...r, id: `${r.id}-dup` }));
    const evidence = countStudyEvidence([...packages, repeat]);
    assert.equal(evidence.transitionsTotal, 4, 'duplicates fold, never inflate');
    assert.equal(evidence.contributors.total, 1);
  });
});

describe('canonical gate evaluation', ()=>{
  it('995 arise + 5 double-progression fails the per-arm gate', ()=>{
    const packages = [];
    for(let i = 0; i < 10; i++){
      const id = (i + 1).toString(16).padStart(16, '0');
      const rows = [];
      for(let t = 0; t < 99; t++) rows.push(validRow({ id: `a${i}-${t}`, arm: 'arise', sessionId: `sa${i}-${t}` }));
      rows.push(validRow({ id: `d${i}`, arm: 'double-progression', sessionId: `sd${i}` }));
      packages.push(participantPackage(id, rows));
    }
    const evidence = countStudyEvidence(packages);
    assert.equal(evidence.transitionsArise, 990);
    assert.equal(evidence.transitionsDoubleProgression, 10);
    const readiness = evaluateStudyReadiness(evidence);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reasons.some(r => /double-progression/.test(r)), JSON.stringify(readiness.reasons));
  });

  it('400 arise + 400 dp + 200 invalid rows fails the total-transition gate', ()=>{
    const packages = [];
    for(let i = 0; i < 10; i++){
      const id = (i + 1).toString(16).padStart(16, '0');
      const rows = [];
      for(let t = 0; t < 40; t++){
        rows.push(validRow({ id: `a${i}-${t}`, arm: 'arise', sessionId: `sa${i}-${t}` }));
        rows.push(validRow({ id: `d${i}-${t}`, arm: 'double-progression', sessionId: `sd${i}-${t}` }));
      }
      // 20 invalid rows per person: real-looking but unusable.
      for(let t = 0; t < 20; t++) rows.push(validRow({ id: `u${i}-${t}`, provenance: { origin: 'replay' }, sessionId: `su${i}-${t}` }));
      packages.push(participantPackage(id, rows));
    }
    const evidence = countStudyEvidence(packages);
    assert.equal(evidence.transitionsArise, 400);
    assert.equal(evidence.transitionsDoubleProgression, 400);
    assert.equal(evidence.transitionsTotal, 800);
    assert.equal(evidence.invalid.unproven, 200);
    const readiness = evaluateStudyReadiness(evidence);
    assert.equal(readiness.ready, false, '800 valid < 1000 required');
    assert.ok(readiness.reasons.some(r => /1000\+/.test(r)), JSON.stringify(readiness.reasons));
  });

  it('500 arise + 500 dp across 10 genuine contributors passes every gate', ()=>{
    const packages = [];
    for(let i = 0; i < 10; i++){
      const id = (i + 1).toString(16).padStart(16, '0');
      const rows = [];
      for(let t = 0; t < 50; t++){
        rows.push(validRow({ id: `a${i}-${t}`, arm: 'arise', met: t % 3 !== 0, sessionId: `sa${i}-${t}` }));
        rows.push(validRow({ id: `d${i}-${t}`, arm: 'double-progression', met: t % 4 !== 0, sessionId: `sd${i}-${t}` }));
      }
      packages.push(participantPackage(id, rows));
    }
    const evidence = countStudyEvidence(packages);
    assert.equal(evidence.transitionsArise, 500);
    assert.equal(evidence.transitionsDoubleProgression, 500);
    assert.equal(evidence.transitionsTotal, 1000);
    assert.equal(evidence.contributors.total, 10);
    assert.equal(evidence.contributors.arise, 10);
    assert.equal(evidence.contributors['double-progression'], 10);
    const readiness = evaluateStudyReadiness(evidence);
    assert.deepEqual(readiness.reasons, []);
    assert.equal(readiness.ready, true);
    assert.equal(readiness.status, 'sufficient-evidence');
  });

  it('identifies the exact deficits below the gates', ()=>{
    const evidence = countStudyEvidence(cohortWith({ contributors: 3, rowsPer: 5 }));
    const readiness = evaluateStudyReadiness(evidence);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.reasons.some(r => /3 contributing participants \(need 10\+\)/.test(r)));
    assert.ok(readiness.reasons.some(r => /30 valid assigned transitions \(need 1000\+\)/.test(r)));
  });
});

describe('one readiness result everywhere', ()=>{
  const packages = cohortWith({ contributors: 10, rowsPer: 50 });

  it('cohort.gate.eligible and fieldStudy status agree on an insufficient cohort', ()=>{
    // 10 × 20 = 400 valid transitions: below the canonical total gate (1000),
    // so every readiness surface must agree the gates are unmet.
    const insufficient = cohortWith({ contributors: 10, rowsPer: 20 });
    const ingest = ingestParticipantFiles(insufficient.map((p, i)=> ({ name: `p${i}.json`, text: JSON.stringify(p.store) })));
    const cohort = summariseCohort(ingest.participants, { nowISO: '2026-04-01T00:00:00Z' });
    const field = computeFieldStudy(ingest.participants, {});
    assert.equal(cohort.gate.eligible, false);
    assert.equal(field.status, 'insufficient-evidence');
    assert.equal(field.totals.primaryComparison.gates.sufficient, false);
    assert.equal(cohort.gate.eligible, field.status === 'sufficient-evidence', 'no report may disagree');
    const cohortMd = renderCohortReport(cohort);
    const fieldMd = renderFieldReport(field);
    assert.match(cohortMd, /Gates unmet/);
    // NB: "insufficient-evidence" contains "sufficient-evidence" — block on
    // the "in" boundary so only a standalone sufficient status can match.
    assert.doesNotMatch(fieldMd, /(?<!in)sufficient-evidence/);
  });

  it('cohort.gate.eligible and fieldStudy status agree on a ready cohort', ()=>{
    const ingest = ingestParticipantFiles(packages.map((p, i)=> ({ name: `p${i}.json`, text: JSON.stringify(p.store) })));
    const cohort = summariseCohort(ingest.participants, { nowISO: '2026-04-01T00:00:00Z' });
    const field = computeFieldStudy(ingest.participants, {});
    assert.equal(cohort.gate.eligible, true, JSON.stringify(cohort.gate.reasons || cohort.gate));
    assert.equal(field.status, 'sufficient-evidence', JSON.stringify(field.gates.reasons || field.gates));
    assert.equal(field.totals.primaryComparison.gates.sufficient, true);
    assert.equal(cohort.gate.eligible, field.status === 'sufficient-evidence');
    const fieldMd = renderFieldReport(field);
    assert.match(fieldMd, /sufficient-evidence/);
    const claim = field.claim;
    assert.ok(claim, 'claim readiness fires exactly when the gates pass');
    const assigned = pooledAssignedComparison(ingest.participants, {});
    assert.equal(assigned.gates.sufficient, true);
    assert.equal(assigned.gates.readiness.ready, true, 'assigned gates carry the canonical readiness result');
  });

  it('unconsented and unidentified participants move every surface identically', ()=>{
    // Drop consent from two contributors: every surface must flip to unmet
    // together (9 contributors < 10).
    const reduced = packages.map((p, i)=> (i < 2 ? { ...p, store: { ...p.store, preferences: { telemetryEnabled: false } } } : p));
    const ingest = ingestParticipantFiles(reduced.map((p, i)=> ({ name: `p${i}.json`, text: JSON.stringify(p.store) })));
    const cohort = summariseCohort(ingest.participants, { nowISO: '2026-04-01T00:00:00Z' });
    const field = computeFieldStudy(ingest.participants, {});
    assert.equal(cohort.gate.eligible, false);
    assert.equal(field.status, 'insufficient-evidence');
    assert.equal(cohort.gate.eligible, field.status === 'sufficient-evidence');
  });

  it('override: a lowered configuration moves every surface together', ()=>{
    // minContributors 2 · minTransitions 2 · effective per-arm minimum 1,
    // with one valid transition per arm for 2 contributors: exactly at the
    // lowered gates. The SAME override flows into every surface.
    const two = cohortWith({ contributors: 2, rowsPer: 1 });
    const lowered = { minContributors: 2, minTransitions: 2, minTransitionsPerArm: 400 };
    const ingest = ingestParticipantFiles(two.map((p, i)=> ({ name: `p${i}.json`, text: JSON.stringify(p.store) })));
    const cohort = summariseCohort(ingest.participants, { nowISO: '2026-04-01T00:00:00Z', gates: lowered });
    const assigned = pooledAssignedComparison(ingest.participants, { minParticipants: 2, minTransitions: 2 });
    const field = computeFieldStudy(ingest.participants, { minParticipants: 2, minTransitions: 2 });
    const md = renderCohortReport(cohort);
    assert.equal(assigned.gates.readiness.ready, true, 'canonical readiness = ready under the lowered gates');
    assert.equal(assigned.gates.readiness.gates.minTransitionsPerArm, 1, 'per-arm clamped to floor(minTransitions/2) = 1');
    assert.equal(assigned.gates.sufficient, true);
    assert.equal(field.status, 'sufficient-evidence');
    assert.equal(field.totals.primaryComparison.gates.sufficient, true);
    assert.equal(cohort.gate.eligible, true, JSON.stringify(cohort.gate.reasons));
    assert.match(md, /Gates met/);
  });

  it('override: minimumSegmentSamples labels metrics but never changes readiness', ()=>{
    // Same lowered-ready cohort, but the metric sample gate stays at 5: each
    // arm has only 1 valid transition, so both rates stay non-conclusive —
    // while readiness, status and gates are ALL ready/sufficient/eligible.
    const two = cohortWith({ contributors: 2, rowsPer: 1 });
    const ingest = ingestParticipantFiles(two.map((p, i)=> ({ name: `p${i}.json`, text: JSON.stringify(p.store) })));
    const assigned = pooledAssignedComparison(ingest.participants, { minParticipants: 2, minTransitions: 2 });
    const field = computeFieldStudy(ingest.participants, { minParticipants: 2, minTransitions: 2 });
    assert.equal(assigned.gates.sufficient, true);
    assert.equal(field.status, 'sufficient-evidence');
    const metricGate = field.totals.primaryComparison.gates.metricGate;
    assert.ok(metricGate, 'the metric gate is reported, separate from readiness');
    assert.equal(metricGate.ariseConclusive, false, '1 transition < minimumSegmentSamples');
    assert.equal(metricGate.dpConclusive, false);
    assert.match(metricGate.note, /below the metric sample gate/);
    assert.equal(field.totals.primaryComparison.arise.conclusive, false);
    assert.equal(field.totals.primaryComparison['double-progression'].conclusive, false);
    // And the claim still fires — metric conclusiveness is a label, not a gate.
    assert.ok(field.claim, 'claim eligibility derives from readiness, not the metric label');
  });

  it('inverse: readiness false blocks the claim even when metric-level sample gates pass', ()=>{
    // minimumSegmentSamples = 1, so every arm rate is conclusive; but 2
    // contributors × 1 transition/arm is far below the canonical gates with
    // NO override — readiness false must withhold status, gates and claim.
    const two = cohortWith({ contributors: 2, rowsPer: 1 });
    const LOOSE = { longitudinal: { minimumSegmentSamples: 1 } };
    const ingest = ingestParticipantFiles(two.map((p, i)=> ({ name: `p${i}.json`, text: JSON.stringify(p.store) })));
    const field = computeFieldStudy(ingest.participants, { config: LOOSE });
    const assigned = field.totals.primaryComparison;
    assert.equal(assigned.arise.conclusive, true, 'metric-level gate passes at this scale');
    assert.equal(assigned['double-progression'].conclusive, true);
    assert.equal(assigned.gates.sufficient, false, 'metric conclusiveness cannot substitute for readiness');
    assert.equal(field.status, 'insufficient-evidence');
    assert.equal(field.claim, null, 'readiness false prevents claims even when metrics clear their own gates');
    const cohort = summariseCohort(ingest.participants, { nowISO: '2026-04-01T00:00:00Z', config: LOOSE });
    assert.equal(cohort.gate.eligible, false);
  });
});
