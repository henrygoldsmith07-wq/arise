import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrollParticipant,
  assignmentFor,
  enrollmentAudit,
  scheduledExerciseIds,
  STUDY_VERSION,
  DP_POLICY_VERSION,
} from '../src/lib/studyEnrollment.js';
import { buildExportPayload, parseImportFile } from '../src/lib/export.js';
import { recordRecommendation, attachOutcome, evaluateLongitudinal } from '../src/lib/longitudinal.js';

const CONSENT = { telemetryEnabled: true };
const mem = ()=>{ const m=new Map(); return { getItem:k=>(m.has(k)?m.get(k):null), setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k) }; };
function sess(id,dateISO,sets){ return { id, dateISO, blocks:[{exerciseId:'bench-press-dumbbell',sets}] }; }
function set(r,w,rpe){ return { reps:String(r), weightKg:String(w), rpe:rpe==null?'':String(rpe) }; }
const PREFIX=[sess('a','2026-01-02',[set(8,20,7)]), sess('b','2026-01-05',[set(9,20,7)])];

const IDS = ['bench-press','goblet-squat','romanian-deadlift','lat-pulldown','bicep-curl','leg-press','push-up','deadlift','hip-thrust','plank'];

describe('randomised assignment (participant × exercise)', ()=>{
  it('balances arms EXACTLY per participant (#P0 stratified)', ()=>{
    const e = enrollParticipant({ participantId:'aaaa1111', exerciseIds: IDS });
    const audit = enrollmentAudit(e);
    assert.equal(audit.balanced, true);
    assert.equal(audit.arise, 5);
    assert.equal(audit.doubleProgression, 5);
  });

  it('varies lift↔arm pairing across participants (no exercise confound)', ()=>{
    const ids = ['bench-press','squat','deadlift'];
    const maps = new Set();
    for(let p = 0; p < 12; p++){
      const e = enrollParticipant({ participantId:`part${p}`, exerciseIds: ids });
      maps.add(JSON.stringify(e.assignments));
    }
    assert.ok(maps.size > 1, 'every participant got the identical mapping — exercise identity is confounded with treatment');
  });

  it('is deterministic and persists before treatment', ()=>{
    const stripStamps = e => Object.fromEntries(Object.entries(e.assignments).map(([id, v]) => [id, { arm: v.arm, assignmentVersion: v.assignmentVersion }]));
    const a = enrollParticipant({ participantId:'zzzz9999', exerciseIds: IDS });
    const b = enrollParticipant({ participantId:'zzzz9999', exerciseIds: IDS });
    // Same participant + seed ⇒ identical ARMS forever; enrolledAtISO/assignedAtISO
    // are wall-clock stamps and may differ between calls.
    assert.deepEqual(stripStamps(a), stripStamps(b));
    assert.equal(a.studyVersion, STUDY_VERSION);
    assert.equal(Object.values(a.assignments)[0].assignmentVersion, STUDY_VERSION);
    for(const v of Object.values(a.assignments)) assert.ok(v.assignedAtISO);
  });

  it('round-trips through export/import allowlist', ()=>{
    const enrollment = enrollParticipant({ participantId:'feed0000', exerciseIds:['bench-press'], nowISO:'2026-01-01T00:00:00Z' });
    const store = { version:6, history:[], studyParticipantId:'feed0000feed0000', studyEnrollment: enrollment };
    const parsed = parseImportFile(JSON.stringify(buildExportPayload(store)));
    assert.equal(parsed.studyEnrollment.studyVersion, STUDY_VERSION);
    assert.equal(parsed.studyParticipantId, 'feed0000feed0000');
    assert.ok(parsed.studyEnrollment.assignments['bench-press']);
  });

  it('scheduledExerciseIds reads the active schedule', ()=>{
    const schedule = { sessions:[ { blocks:[{exerciseId:'b'},{exerciseId:'a'}] }, { blocks:[{exerciseId:'c'}] }, { blocks:[{exerciseId:'a'}] } ] };
    assert.deepEqual(scheduledExerciseIds(schedule), ['a','b','c']);
  });
});

describe('treatment enforcement + adherence vs assigned arm', ()=>{

  function runAssigned({ assignedArm, actual }){
    const store = mem();
    const enrollment = enrollParticipant({ participantId:'e1e1e1e1', exerciseIds:['bench-press-dumbbell'], config:{ longitudinal:{ minimumSegmentSamples:1 } } });
    // Force the fixture's arm regardless of hash.
    enrollment.assignments['bench-press-dumbbell'] = { arm: assignedArm, assignmentVersion: STUDY_VERSION, assignedAtISO:'2026-01-01T00:00:00Z' };
    // Prescription the product would display for that arm:
    const dp = { load:20, reps:10 };
    const arise = { load:22.5, reps:8 };
    const prescription = assignedArm === 'double-progression' ? dp : arise;
    recordRecommendation({
      exerciseId:'bench-press-dumbbell',
      recommendation: prescription,
      history: PREFIX, dueDateISO:'2026-01-08', targetReps:'8–12',
      assignedArm, participantId: enrollment.participantId,
      preferences: CONSENT, storage: store,
    });
    const resolved = attachOutcome({ sessionId:'s', dateISO:'2026-01-09', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[actual] }], preferences: CONSENT, storage: store });
    return resolved[0];
  }

  it('adherence measures against the ASSIGNED prescription (#10)', ()=>{
    // DP-assigned demanded 20 kg × 10; lifter did 22.5 × 8 → load followed,
    // reps short ⇒ NOT followed, even though an arise target of 22.5 × 8
    // would have been met by the same performance.
    const row = runAssigned({ assignedArm:'double-progression', actual:set(8, 22.5, 9) });
    assert.equal(row.outcome.followed, false);
    assert.ok(row.outcome.deviationKg != null || row.outcome.repsMet === false);
    assert.equal(row.outcome.assignedArm, 'double-progression');
    assert.equal(row.outcome.assignedMet, false);
    assert.equal(row.outcome.userOverride, false);
  });

  it('primary comparison counts only ASSIGNED transitions and separates shadow (#11-adjacent)', ()=>{
    const store = mem();
    const mk = ({ assignedArm, prescription })=>{
      recordRecommendation({
        exerciseId:'bench-press-dumbbell', recommendation: prescription,
        history: PREFIX, dueDateISO:'2026-01-08', targetReps:'8–12',
        assignedArm, participantId:'p-pool',
        preferences: CONSENT, storage: store,
      });
    };
    // Two arise-assigned hits, two DP-assigned misses.
    mk({ assignedArm:'arise', prescription:{ load:22.5, reps:8 } });
    attachOutcome({ sessionId:'x1', dateISO:'2026-01-09', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5,8)] }], preferences: CONSENT, storage: store });
    // Second transition needs distinct due dates; reuse same ledger.
    mk2(store, { assignedArm:'arise', prescription:{ load:22.5, reps:8 } }, '2026-01-12');
    attachOutcome({ sessionId:'x2', dateISO:'2026-01-13', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5,8)] }], preferences: CONSENT, storage: store });
    mk2(store, { assignedArm:'double-progression', prescription:{ load:20, reps:10 } }, '2026-01-15');
    attachOutcome({ sessionId:'x3', dateISO:'2026-01-16', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5,8)] }], preferences: CONSENT, storage: store });
    mk2(store, { assignedArm:'double-progression', prescription:{ load:20, reps:10 } }, '2026-01-18');
    attachOutcome({ sessionId:'x4', dateISO:'2026-01-19', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8,22.5,8)] }], preferences: CONSENT, storage: store });

    const ev = evaluateLongitudinal(requireLedger(store), { config:{ longitudinal:{ minimumSegmentSamples:1 } } });
    const pc = ev.primaryComparison;
    assert.ok(pc && pc.arise.n >= 2, 'arise-assigned rows present');
    assert.ok(pc['double-progression'].n >= 2, 'dp-assigned rows present');
    assert.ok(pc.arise.targetAchievementRate > pc['double-progression'].targetAchievementRate);
    assert.equal(pc.arise.shadow, undefined, 'primary rows are never shadow');
    for(const [arm, entry] of Object.entries(ev.byArm)) assert.equal(entry.shadow, true, `${arm} must be labelled shadow`);
    assert.match(ev.note, /SHADOW/);
  });

  function mk2(store, { assignedArm, prescription }, dueDateISO){
    recordRecommendation({
      exerciseId:'bench-press-dumbbell', recommendation: prescription,
      history: PREFIX, dueDateISO, targetReps:'8–12',
      assignedArm, participantId:'p-pool',
      preferences: CONSENT, storage: store,
    });
  }

  function requireLedger(store){
    const raw = JSON.parse(store.getItem('arise.evaluation.v1') || '{"records":[]}');
    return raw.records || [];
  }
});
