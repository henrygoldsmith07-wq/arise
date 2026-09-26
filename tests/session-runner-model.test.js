import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  addUserSetToBlock,
  applyAllRecommendations,
  applyRecommendationToBlock,
  buildSessionHistoryPayload,
  carryForwardPlan,
  duplicateUnilateralSetInBlock,
  isManualLoadOverride,
  nextActionableBlockIndex,
  patchRunnerSet,
  rirFromRpe,
  rpeFromRir,
  sessionSaveState,
  stepRir,
} from '../src/lib/sessionRunnerModel.js';

function set(overrides = {}){
  return {
    reps:'8',
    weightKg:'20',
    rpe:'8',
    completed:false,
    failed:false,
    ...overrides,
  };
}

function block(overrides = {}){
  return {
    exerciseId:'bench-press-dumbbell',
    reps:'8-10',
    restSec:120,
    unilateral:false,
    sets:[set(), set({ reps:'', weightKg:'', rpe:'' })],
    ...overrides,
  };
}

describe('SessionRunner model — effort conversion', ()=>{
  it('round-trips RPE/RIR and clamps deliberate suggestion steps', ()=>{
    assert.equal(rirFromRpe('8'), '2');
    assert.equal(rpeFromRir('2'), '8');
    assert.equal(rirFromRpe(''), '');
    assert.equal(stepRir('9.5', 1), '10');
    assert.equal(stepRir('0.5', -1), '0');
  });
});

describe('SessionRunner model — set transitions', ()=>{
  it('patches one set immutably and carries the block override flag', ()=>{
    const original = [block()];
    const next = patchRunnerSet(original, 0, 1, { reps:'9' }, { prescriptionOverridden:true });
    assert.notEqual(next, original);
    assert.notEqual(next[0], original[0]);
    assert.equal(original[0].sets[1].reps, '');
    assert.equal(next[0].sets[1].reps, '9');
    assert.equal(next[0].prescriptionOverridden, true);
  });

  it('detects a meaningful load override but ignores rounding noise', ()=>{
    const rec = { load:20 };
    assert.equal(isManualLoadOverride('20.25', rec), false);
    assert.equal(isManualLoadOverride('21', rec), true);
    assert.equal(isManualLoadOverride('25 lb', rec), true);
    assert.equal(isManualLoadOverride('10', { reps:8 }), false);
  });

  it('plans reps/load carry-forward without silently copying RIR', ()=>{
    const current = block({ sets:[set({ reps:'10', weightKg:'22.5', rpe:'8' }), set({ reps:'', weightKg:'', rpe:'' })] });
    const plan = carryForwardPlan(current, 0);
    assert.equal(plan.nextIndex, 1);
    assert.deepEqual(plan.carry, { reps:'10', weightKg:'22.5' });
    assert.equal(plan.rirSuggestion, '2');
    assert.ok(!('rpe' in plan.carry));
  });

  it('adds and duplicates user sets with stable user-added identity', ()=>{
    let seq = 0;
    const makeId = ()=> `set-${++seq}`;
    const added = addUserSetToBlock(block({ sets:[set()] }), makeId);
    assert.equal(added.sets.length, 2);
    assert.equal(added.sets[1].origin, 'user-added');
    assert.equal(added.sets[1].setId, 'set-1');

    const unilateral = duplicateUnilateralSetInBlock(block({ unilateral:true, sets:[set({ side:'L' })] }), makeId);
    assert.equal(unilateral.sets[1].side, 'R');
    assert.equal(unilateral.sets[1].origin, 'user-added');
    assert.equal(unilateral.sets[1].completed, false);
  });

  it('finds the next actionable focus block and wraps', ()=>{
    const blocks = [
      block({ sets:[set({ completed:true })] }),
      block({ exerciseId:'lat-pulldown', sets:[set({ failed:true })] }),
      block({ exerciseId:'leg-press', sets:[set({ completed:false })] }),
    ];
    assert.equal(nextActionableBlockIndex(blocks, 0), 2);
    assert.equal(nextActionableBlockIndex(blocks, 2), 2);
  });
});

describe('SessionRunner model — recommendations', ()=>{
  it('applies one recommendation only to unfinished sets', ()=>{
    const original = block({ sets:[set({ completed:true, reps:'7', weightKg:'18' }), set({ reps:'', weightKg:'', rpe:'' })] });
    const next = applyRecommendationToBlock(original, { reps:9, load:22.5, assistKg:5 });
    assert.equal(next.sets[0].reps, '7');
    assert.equal(next.sets[1].reps, '9');
    assert.equal(next.sets[1].weightKg, '22.5');
    assert.equal(next.sets[1].assistedKg, '5');
  });

  it('apply-all changes only pristine blocks and reports exact acceptances', ()=>{
    const blocks = [
      block({ exerciseId:'bench-press-dumbbell', sets:[set({ reps:'', weightKg:'', rpe:'' })] }),
      block({ exerciseId:'lat-pulldown', sets:[set({ reps:'8', weightKg:'40' })] }),
      block({ exerciseId:'leg-press', sets:[set({ reps:'', weightKg:'', rpe:'' })] }),
    ];
    const recommendations = new Map([
      ['bench-press-dumbbell', { reps:10, load:25 }],
      ['lat-pulldown', { reps:9, load:45 }],
      ['leg-press', { reps:12, load:80 }],
    ]);
    const result = applyAllRecommendations(blocks, recommendations);
    assert.deepEqual(result.applied, [
      { index:0, exerciseId:'bench-press-dumbbell' },
      { index:2, exerciseId:'leg-press' },
    ]);
    assert.equal(result.blocks[0].sets[0].weightKg, '25');
    assert.equal(result.blocks[1].sets[0].weightKg, '40');
    assert.equal(result.blocks[2].sets[0].reps, '12');
  });
});

describe('SessionRunner model — save boundary', ()=>{
  it('names the real save blocker and enables save after one completed set', ()=>{
    assert.match(sessionSaveState([block()]).blocker, /Enter reps/);
    const allFilled = block({ sets:[set({ completed:false }), set({ completed:false })] });
    assert.match(sessionSaveState([allFilled]).blocker, /Tap Done/);
    const ready = block({ sets:[set({ completed:true }), set({ completed:false })] });
    assert.equal(sessionSaveState([ready]).canSave, true);
  });

  it('builds the immutable history payload with identity, notes and substitutions', ()=>{
    const startedAt = '2026-09-26T10:00:00.000Z';
    const nowISO = '2026-09-26T10:42:00.000Z';
    const payload = buildSessionHistoryPayload({
      session:{
        id:'session-1', dateISO:'2026-09-26', programId:'p1', programVersion:2,
        templateVersion:3, week:1, day:2, title:'Upper A', mode:'standard', targetMinutes:45,
      },
      blocks:[block({
        substitutionFrom:'barbell-bench-press', substitutionReason:'equipment',
        sets:[set({ completed:true, setId:'s1', origin:'prescribed', plannedSlot:0, side:'' }), set({ reps:'9', completed:false, setId:'s2', origin:'user-added' })],
      })],
      availableEquipment:['dumbbells'],
      note:'Good session',
      noteTags:['felt-strong','pain-discomfort'],
      quality:'good',
      startedAt,
      nowISO,
    });

    assert.equal(payload.durationMinutes, 42);
    assert.equal(payload.sessionDuration, 42);
    assert.equal(payload.blocks[0].sets[0].setId, 's1');
    assert.equal(payload.blocks[0].sets[1].plannedSlot, null);
    assert.equal(payload.blocks[0].sets[1].skipped, true);
    assert.equal(payload.blocks[0].sets[0].pain, true);
    assert.match(payload.note, /Felt strong/);
    assert.match(payload.note, /Pain \/ discomfort/);
    assert.match(payload.note, /Good session/);
    assert.deepEqual(payload.substitutions, [{ from:'barbell-bench-press', to:'bench-press-dumbbell', reason:'equipment' }]);
  });
});
