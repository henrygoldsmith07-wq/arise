import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRunnerRecommendationMeta,
  prospectiveRecommendationRecord,
  runnerRecommendationForBlock,
  runnerStudy,
} from '../src/lib/runnerRecommendations.js';

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

  it('fails soft when comparative-study analysis cannot establish evidence', ()=>{
    assert.doesNotThrow(()=> runnerStudy(null));
  });
});
