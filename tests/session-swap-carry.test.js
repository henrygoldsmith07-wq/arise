// Swap-time e1RM-equivalent carry: swapping a lift must not throw away the
// load the session was built around. The replacement's fresh rows are seeded
// with the ORIGINAL movement's e1RM re-expressed at the planned reps and
// rounded to the REPLACEMENT's own achievable increments — unless the
// replacement has a real prior performance (that wins) or is bodyweight
// (nothing to carry).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildRunnerSwapTransition, swapCarryPlan } from '../src/lib/sessionRunnerModel.js';

function runnerSet(overrides = {}){
  return { reps:'8', weightKg:'20', rpe:'', completed:false, failed:false, ...overrides };
}
function runnerBlock(overrides = {}){
  return {
    exerciseId:'barbell-squat',
    reps:'8–12',
    restSec:120,
    unilateral:false,
    warmups:[],
    loadHint:'',
    why:'',
    substitutionFrom:'',
    substitutionReason:'',
    planIndex:0,
    prescription:null,
    sets:[runnerSet()],
    ...overrides,
  };
}

describe('swap e1RM-equivalent carry', () => {
  it('carries the block work as a plate-legal load on the replacement', () => {
    // 60 kg × 10 → e1RM 80; at planned 8 reps → 63.16 kg; nearest barbell
    // load with a 20 kg bar and standard plates → 62.5 kg.
    const plan = swapCarryPlan({
      target:runnerBlock({ exerciseId:'bench-press-barbell', reps:'8–12', sets:[runnerSet({ reps:'10', weightKg:'60' })] }),
      option:{ id:'barbell-squat', supportsWeighted:true },
      history:[],
      plateConfig:{ barWeightKg:20, platesKg:[1.25, 2.5, 5, 10, 15, 20, 25] },
    });
    assert.equal(plan.fromE1rmKg, 80);
    assert.equal(plan.loadKg, 62.5);
  });

  it('falls back to logged history when the block rows carry no load yet', () => {
    const plan = swapCarryPlan({
      target:runnerBlock({ exerciseId:'bench-press-barbell', sets:[runnerSet({ reps:'', weightKg:'' })] }),
      option:{ id:'barbell-squat', supportsWeighted:true },
      history:[{
        id:'h1', dateISO:'2026-09-20',
        blocks:[{ exerciseId:'bench-press-barbell', sets:[{ reps:'8', weightKg:'80', completed:true }] }],
      }],
      plateConfig:{ barWeightKg:20, platesKg:[1.25, 2.5, 5, 10, 15, 20, 25] },
    });
    // e1RM 101.33 at 8 reps → 80 kg, exact on the plates.
    assert.equal(plan.loadKg, 80);
  });

  it('rounds onto the replacement’s own equipment increments, not the bar’s', () => {
    // 40 kg × 10 → e1RM 53.33; at 8 reps → 42.1 kg; owned dumbbells only go
    // 10/20/40 — the honest suggestion is 40, not 42.5.
    const plan = swapCarryPlan({
      target:runnerBlock({ exerciseId:'barbell-squat', reps:'8–12', sets:[runnerSet({ reps:'10', weightKg:'40' })] }),
      option:{ id:'goblet-squat', supportsWeighted:true },
      history:[],
      plateConfig:{ barWeightKg:20, platesKg:[1.25, 2.5, 5, 10, 15, 20, 25], dumbbellsKg:[10, 20, 40] },
    });
    assert.equal(plan.loadKg, 40);
  });

  it('carries nothing for a bodyweight replacement or bodyweight-only work', () => {
    const bodyweight = swapCarryPlan({
      target:runnerBlock({ exerciseId:'barbell-squat', sets:[runnerSet({ reps:'10', weightKg:'60' })] }),
      option:{ id:'push-up', reason:'equipment' },
      history:[],
      plateConfig:{ barWeightKg:20, platesKg:[1.25, 2.5, 5, 10, 15, 20, 25] },
    });
    assert.equal(bodyweight.loadKg, 0);

    const nothingKnown = swapCarryPlan({
      target:runnerBlock({ exerciseId:'bench-press-barbell', sets:[runnerSet({ reps:'', weightKg:'' })] }),
      option:{ id:'barbell-squat', supportsWeighted:true },
      history:[],
      plateConfig:null,
    });
    assert.equal(nothingKnown.loadKg, 0);
  });

  it('seeds fresh replacement rows with the carried load via the swap transition', () => {
    const session = {
      id:'session-carry', dateISO:'2026-09-26', programId:'p1',
      blocks:[{ exerciseId:'bench-press-barbell', reps:'8–12', sets:2 }],
    };
    const transition = buildRunnerSwapTransition({
      blocks:[runnerBlock({ exerciseId:'bench-press-barbell', sets:[runnerSet({ reps:'10', weightKg:'60' }), runnerSet({ reps:'', weightKg:'', rpe:'' })] })],
      index:0,
      option:{ id:'barbell-squat', reason:'equipment', supportsWeighted:true },
      session,
      history:[],
      dateISO:session.dateISO,
      plateConfig:{ barWeightKg:20, platesKg:[1.25, 2.5, 5, 10, 15, 20, 25] },
      nowISO:'2026-09-26T10:15:00.000Z',
      makeId:(()=>{ let i = 0; return ()=> `swap-${++i}`; })(),
    });
    assert.equal(transition.changed, true);
    assert.equal(transition.blocks[0].exerciseId, 'barbell-squat');
    for(const fresh of transition.blocks[0].sets){
      assert.equal(fresh.weightKg, '62.5');
    }
  });

  it('prefers the replacement’s own prior performance over the carried e1RM', () => {
    const session = {
      id:'session-carry-2', dateISO:'2026-09-26', programId:'p1',
      blocks:[{ exerciseId:'bench-press-barbell', reps:'8–12', sets:2 }],
    };
    const transition = buildRunnerSwapTransition({
      blocks:[runnerBlock({ exerciseId:'bench-press-barbell', sets:[runnerSet({ reps:'10', weightKg:'60' })] })],
      index:0,
      option:{ id:'barbell-squat', reason:'equipment', supportsWeighted:true },
      session,
      history:[{
        id:'h1', dateISO:'2026-09-20',
        blocks:[{ exerciseId:'barbell-squat', sets:[{ reps:'5', weightKg:'100', completed:true }] }],
      }],
      dateISO:session.dateISO,
      plateConfig:{ barWeightKg:20, platesKg:[1.25, 2.5, 5, 10, 15, 20, 25] },
      nowISO:'2026-09-26T10:15:00.000Z',
      makeId:(()=>{ let i = 0; return ()=> `swap-${++i}`; })(),
    });
    // Prior sets win: the row carries the user's own 100, not a derived 62.5.
    assert.equal(transition.blocks[0].sets[0].weightKg, '100');
  });
});
