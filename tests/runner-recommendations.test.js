import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRunnerRecommendationMeta,
  prospectiveRecommendationRecord,
  recordProspectiveRecommendation,
  runnerRecommendationForBlock,
  runnerStudy,
} from '../src/lib/runnerRecommendations.js';
import { treatmentRecommendation } from '../src/lib/treatment.js';

const block = { exerciseId:'bench-press-dumbbell', reps:'8-12', sets:[] };
const session = { id:'s1', dateISO:'2026-09-26', programId:'p1', programVersion:4 };

describe('shared runner recommendation lifecycle', ()=>{
  it('resolves the same recommendation for standard and guided callers', ()=>{
    const inputs = {
      block,
      history:[],
      dateISO:session.dateISO,
      plateConfig:null,
      study:null,
      studyEnrollment:null,
      policy:'standard',
    };
    const standard = runnerRecommendationForBlock(inputs);
    const guided = runnerRecommendationForBlock({ ...inputs });
    assert.deepEqual(guided, standard);
    assert.deepEqual(standard.recommendation, treatmentRecommendation({
      block,
      history:[],
      asOfDateISO:session.dateISO,
      plateConfig:null,
      study:null,
      assignedArm:standard.arm,
      policy:'standard',
    }));
  });

  it('returns an explicit null result for a block without an exercise identity', ()=>{
    assert.deepEqual(runnerRecommendationForBlock({ block:null }), { arm:null, recommendation:null });
    assert.deepEqual(runnerRecommendationForBlock({ block:{} }), { arm:null, recommendation:null });
  });

  it('deduplicates repeated exercises and can carry previous-performance lookup', ()=>{
    const meta = buildRunnerRecommendationMeta({
      blocks:[block, { ...block, sets:[{ reps:'9' }] }],
      history:[],
      dateISO:session.dateISO,
      previousForExercise:id=> ({ exerciseId:id, sets:[{ reps:'7' }] }),
    });
    assert.equal(meta.recs.size, 1);
    assert.equal(meta.arms.size, 1);
    assert.equal(meta.prevs.get(block.exerciseId).sets[0].reps, '7');
    assert.equal(meta.assigned, meta.arms);
    assert.deepEqual(meta.recs.get(block.exerciseId), runnerRecommendationForBlock({
      block,
      history:[],
      dateISO:session.dateISO,
    }).recommendation);
  });

  it('skips invalid blocks and does not invoke previous lookup when none was supplied', ()=>{
    const meta = buildRunnerRecommendationMeta({
      blocks:[null, {}, block],
      history:[],
      dateISO:session.dateISO,
    });
    assert.equal(meta.recs.size, 1);
    assert.equal(meta.arms.size, 1);
    assert.equal(meta.prevs.size, 0);
  });

  it('builds the prospective evidence record from one shared contract', ()=>{
    const recommendation = { load:20, reps:8, reason:'test' };
    const withoutConsent = prospectiveRecommendationRecord({
      block,
      recommendation,
      arm:'arise',
      history:[],
      session,
      participantId:'participant-1',
      measurementConsent:false,
    });
    assert.deepEqual(withoutConsent, {
      exerciseId:block.exerciseId,
      recommendation,
      history:[],
      dueDateISO:'2026-09-26',
      programId:'p1',
      programVersion:4,
      targetReps:'8-12',
      assignedArm:'arise',
      participantId:'participant-1',
      preferences:null,
    });

    const withConsent = prospectiveRecommendationRecord({
      block,
      recommendation,
      session,
      measurementConsent:true,
    });
    assert.deepEqual(withConsent.preferences, { telemetryEnabled:true });
  });

  it('uses null/default evidence fields when optional study context is absent', ()=>{
    const recommendation = { reps:8 };
    const record = prospectiveRecommendationRecord({ block, recommendation, session });
    assert.equal(record.exerciseId, block.exerciseId);
    assert.equal(record.assignedArm, null);
    assert.equal(record.participantId, null);
    assert.equal(record.preferences, null);
    assert.deepEqual(record.history, []);
  });

  it('returns a valid inconclusive study when no history exists', ()=>{
    const study = runnerStudy(null);
    assert.equal(study.transitions, 0);
    assert.equal(study.overall.arise.conclusive, false);
    assert.equal(study.scope.cannotEstablish.includes('causal superiority over baselines'), true);
  });

  it('fails soft to null when comparative-study evaluation itself throws', ()=>{
    const explosive = new Proxy([], {
      get(){ throw new Error('synthetic study failure'); },
    });
    assert.equal(runnerStudy(explosive), null);
  });

  it('records through the same prospective contract when measurement consent is enabled', ()=>{
    const recommendation = { load:20, reps:8, reason:'prospective wrapper test' };
    const recorded = recordProspectiveRecommendation({
      block,
      recommendation,
      history:[],
      session,
      measurementConsent:true,
      participantId:'participant-wrapper',
    });
    assert.ok(recorded);
    assert.equal(recorded.exerciseId, block.exerciseId);
    assert.equal(recorded.dueDateISO, session.dateISO);
    assert.equal(recorded.programId, session.programId);
    assert.equal(recorded.assignedArm, null);
  });
});
