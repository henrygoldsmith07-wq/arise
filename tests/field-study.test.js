import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measureParticipant, computeFieldStudy, renderFieldReport, loadParticipantFile } from '../src/lib/fieldStudy.js';

const LOOSE = { longitudinal: { minimumSegmentSamples: 1 } };

function sess(id, dateISO, exerciseId, sets){ return { id, dateISO, blocks: [{ exerciseId, sets }] }; }
function set(reps, kg){ return { reps:String(reps), weightKg:String(kg), rpe:'' }; }

function participantFixture(code){
  const history = [];
  const weights = [20,20,21,21,22,23];
  weights.forEach((w, i)=>{
    history.push({ id:`h-${i}`, dateISO:`2026-01-${String(1 + i*5).padStart(2,'0')}`, blocks:[
      { exerciseId:'bench-press-dumbbell', sets:[set(8,w), set(8,w)] },
    ]});
  });
  history.push(
    { id:'h-6', dateISO:'2026-02-02', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(9,23)] }] },
    { id:'h-7', dateISO:'2026-02-05', blocks:[{ exerciseId:'dumbbell-row', sets:[set(10,20)] }] },
    // Performed version of the adapted scheduled block — user swapped it out.
    { id:'w1d1', dateISO:'2026-01-05', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5)] }] },
  );
  const schedule = {
    programId: 'test',
    mesocycle: { weeks:4, deloadWeek:null },
    availableEquipment: ['dumbbells','bench','bodyweight'],
    adaptationHistory: [],
    lastWeeklyReviewBasis: null,
    sessions: [
      { id:'w1d1', week:1, day:1, dateISO:'2026-01-05', status:'done', blocks:[
        { exerciseId:'barbell-squat', sets:3, substitutionFrom:'front-squat', substitutionReason:'no rack' },
      ]},
      { id:'w2d1', week:2, day:1, dateISO:'2026-01-19', status:'planned', blocks:[
        { exerciseId:'bench-press-dumbbell', sets:3, adaptation:{ kind:'weekly-add-sets' } },
      ]},
    ],
  };
  return {
    code,
    store: {
      version: 6,
      onboarding: null,
      activeSchedule: schedule,
      history,
      preferences: {},
      eventHistory: [
        { id:'e1', type:'recommendation:shown', sessionId:'x' },
        { id:'e2', type:'recommendation:shown', sessionId:'y' },
        { id:'e3', type:'recommendation:accepted', sessionId:'x' },
        { id:'e4', type:'set:complete', elapsedMs: 4200 },
      ],
      evaluationLedger: [
        { id:'l1', recommendation:{ load:22.5, reps:9 }, outcome:{ metTarget:true, classification:'progression-success', changePct:.06, loadErrorKg:0, repError:0 }, exerciseId:'bench-press-dumbbell', basis:{ trainingAgePhase:'novice' } },
      ],
      readinessLog: [ { score:75 }, { score:81 } ],
      customTemplates: [],
    },
  };
}

describe('field study measurements (per participant)', ()=>{
  const m = measureParticipant(participantFixture('P01'), { config: LOOSE });

  it('computes adherence, completion and missed sessions', ()=>{
    assert.equal(m.adherence.scheduled, 2);
    assert.equal(m.adherence.done, 1);
    assert.ok(m.weeksObserved >= 2);
  });

  it('measures acceptance and logging time from telemetry events', ()=>{
    assert.equal(m.acceptance.shown, 2);
    assert.equal(m.acceptance.accepted, 1);
    assert.equal(m.acceptance.acceptanceRate, 0.5);
    assert.equal(m.loggingTime.medianMs, 4200);
  });

  it('resolves ledger outcome metrics', ()=>{
    assert.ok(m.ledger.resolved >= 1);
    assert.ok(Number.isFinite(Number(m.ledger.progressionSuccessRate)));
  });

  it('detects programme-change overrides by users', ()=>{
    assert.ok(m.overrides.adaptedBlocks >= 2);
    assert.ok(m.overrides.overridden >= 1);
    assert.ok(m.overrides.overrideRate > 0);
  });

  it('replays comparative arms with arise transitions present', ()=>{
    assert.ok(m.comparative.arise.n > 0);
    assert.equal(m.comparative['double-progression'].n, m.comparative.arise.n);
  });
});

describe('pooled field study + headline gates', ()=>{
  const participants = [participantFixture('P01'), participantFixture('P02'), participantFixture('P03')];

  it('withholds the claim below sample gates but still reports honestly', ()=>{
    const result = computeFieldStudy(participants, { config: LOOSE, minParticipants: 10, minTransitions: 1000 });
    assert.equal(result.status, 'insufficient-evidence');
    assert.equal(result.claim, null);
    const md = renderFieldReport(result);
    assert.match(md, /Headline claim withheld/);
  });

  it('produces the headline sentence when gates pass, arithmetic intact', ()=>{
    const result = computeFieldStudy(participants, { config: LOOSE, minParticipants: 3, minTransitions: 3 });
    assert.equal(result.status, 'sufficient-evidence');
    const p = result.pooled;
    const perSum = participants.reduce((a,p)=> a + measureParticipant(p, { config: LOOSE }).comparative.arise.met, 0);
    assert.equal(p.arise.met, perSum);
    const h = result.headline['double-progression'];
    assert.notEqual(h.targetAchievementDeltaPct, null);
    assert.match(result.claim.text, /real exercise transitions from 3 consenting participants/);
    const md = renderFieldReport(result);
    assert.match(md, /\*\*sufficient-evidence\*\*/);
  });

  it('loads participant packages through the import validator', ()=>{
    const pkg = JSON.stringify({ app:'arise', data: participantFixture('P09').store });
    const loaded = loadParticipantFile(pkg, 8);
    assert.equal(loaded.code, 'P09');
    assert.ok(Array.isArray(loaded.store.history));
  });
});
