import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runnerHasLoggedWork } from '../src/hooks/useWorkoutExit.js';

// Regression cover for the discard-guard contract shared by Standard and
// Guided runners. The bug this pins: both runners prefill reps/load from the
// schedule or history, so counting prefilled values as "logged work" made an
// untouched session ask for a discard confirmation (and E2E dead-ended on a
// dialog where the workout should just close). Only real user work is lossy.

function block(sets){ return [{ exerciseId:'bench', sets }]; }

describe('runner exit guard — what counts as logged work', ()=>{
  it('treats a prefilled untouched session as lossless', ()=>{
    // Plan prefill: reps arrive from the schedule, weight may be carried —
    // neither is user work.
    assert.equal(runnerHasLoggedWork(block([{ reps:'8', weightKg:'20', completed:false }])), false);
    assert.equal(runnerHasLoggedWork([{ exerciseId:'bench', sets:[{ reps:'8' }, { reps:'8', weightKg:'22.5' }] }]), false);
    assert.equal(runnerHasLoggedWork([]), false);
    assert.equal(runnerHasLoggedWork(null), false);
  });

  it('treats resolved sets as logged work', ()=>{
    for(const resolved of [{ completed:true }, { failed:true }, { skipped:true }]){
      assert.equal(runnerHasLoggedWork(block([{ reps:'8', ...resolved }])), true, `expected ${JSON.stringify(resolved)} to be lossy`);
    }
  });

  it('treats a user edit as logged work even before any set resolves', ()=>{
    // Typed edits, added/removed rows, swaps and notes all go through the
    // runner's userEdited flag — no set need be completed yet.
    assert.equal(runnerHasLoggedWork(block([{ reps:'8', completed:false }]), true), true);
    assert.equal(runnerHasLoggedWork([], true), true);
  });

  it('restores the lossy flag from a crash draft via the userEdited marker', ()=>{
    // A crash-recovery draft re-seeds userEdited, so resuming and exiting
    // still confirms rather than silently discarding typed-but-unresolved work.
    const draft = { userEdited: true, blocks: block([{ reps:'8' }]) };
    assert.equal(runnerHasLoggedWork(draft.blocks, draft.userEdited), true);
  });
});
