// First-run programme shelf: ≤5 kit-surviving templates, swaps visible before
// start, empty kit never marketed a barbell lift.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { programShelf } from '../src/lib/programShelf.js';
import { programShelf as shelfDefault } from '../src/lib/programShelf.js';

const ONBOARDING = {
  goal:'general',
  level:'Beginner',
  daysPerWeek:3,
  availableMinutes:45,
  equipment:['bodyweight'],
};

describe('program shelf', () => {
  it('offers at most 5 templates and puts the ranked top pick first', () => {
    const shelf = programShelf({ onboarding:ONBOARDING, availableEquipment:['dumbbells', 'bench', 'barbell', 'pullup-bar'] });
    assert.ok(shelf.items.length >= 1);
    assert.ok(shelf.items.length <= 5);
  });

  it('normalises an empty kit to bodyweight and survives it', () => {
    const shelf = programShelf({ onboarding:ONBOARDING, availableEquipment:[] });
    assert.equal(shelf.emptyKit, true);
    assert.ok(shelf.items.length >= 1);
    // Every surviving template is fully doable after its own swaps.
    for(const item of shelf.items){
      assert.equal(item.deadEnds ?? 0, 0);
    }
  });

  it('never markets a barbell programme to an empty kit', () => {
    const shelf = programShelf({ onboarding:ONBOARDING, availableEquipment:['bodyweight'] });
    for(const item of shelf.items){
      const isBarbellBrand = ['strength-4x', 'gym-full-4x'].includes(item.programId);
      assert.equal(isBarbellBrand, false);
    }
  });

  it('shows the actual swaps before start — and they are the scheduler’s own', () => {
    // starter-3x needs swaps on a bodyweight-only kit; the card must carry them.
    const shelf = programShelf({ onboarding:ONBOARDING, availableEquipment:['bodyweight'] });
    const starter = shelf.items.find(i=> i.programId === 'starter-3x');
    if(starter){
      assert.ok(starter.swapCount > 0);
      for(const swap of starter.swaps){
        assert.ok(swap.from, 'swap has a source exercise');
        assert.ok(swap.reason, 'swap has a visible reason');
      }
    }
  });

  it('preserves the deterministic scorer’s ranking order', () => {
    const shelf = programShelf({ onboarding:ONBOARDING, availableEquipment:['bodyweight'] });
    assert.ok(shelf.items.length >= 2);
    const scores = shelf.items.map(i=> i.score);
    for(let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] >= scores[i]);
  });

  it('returns null without an onboarding profile', () => {
    assert.equal(programShelf({ onboarding:null, availableEquipment:[] }), null);
  });
});

describe('program shelf — imports', () => {
  it('exports a single shelf implementation', () => {
    assert.equal(shelfDefault, programShelf);
  });
});
