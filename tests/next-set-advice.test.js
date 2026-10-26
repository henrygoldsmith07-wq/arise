import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextSetAdvice, parseRepRange } from '../src/lib/gymMode.js';

const blk = (reps, sets) => ({ reps, sets: sets.map(s => ({ completed: false, failed: false, weightKg: '', reps: '', rir: '', ...s })) });

describe('nextSetAdvice', () => {
  it('parses ranges', () => {
    assert.deepEqual(parseRepRange('8–12'), { min: 8, max: 12 });
    assert.deepEqual(parseRepRange('10'), { min: 10, max: 10 });
    assert.equal(parseRepRange('AMRAP'), null);
  });
  it('suggests lighter after a set under the range floor', () => {
    const a = nextSetAdvice(blk('8-12', [{ completed: true, weightKg: 40, reps: 5 }, { weightKg: 40 }]), { equipment: 'machine' });
    assert.equal(a.direction, 'down');
    assert.ok(a.loadKg < 40);
    assert.equal(a.setIndex, 1);
  });
  it('treats a failed set as a drop', () => {
    const a = nextSetAdvice(blk('8-12', [{ failed: true, weightKg: 40 }, { weightKg: 40 }]), { equipment: 'machine' });
    assert.equal(a.direction, 'down');
  });
  it('suggests heavier at ceiling with room, never without RIR', () => {
    assert.equal(nextSetAdvice(blk('8-12', [{ completed: true, weightKg: 40, reps: 12, rir: 3 }, { weightKg: 40 }]), { equipment: 'machine' }).direction, 'up');
    assert.equal(nextSetAdvice(blk('8-12', [{ completed: true, weightKg: 40, reps: 12 }, { weightKg: 40 }]), { equipment: 'machine' }), null);
  });
  it('stays quiet in range, on first set, or once the user changed the load', () => {
    assert.equal(nextSetAdvice(blk('8-12', [{ completed: true, weightKg: 40, reps: 10 }, { weightKg: 40 }])), null);
    assert.equal(nextSetAdvice(blk('8-12', [{ weightKg: 40 }, { weightKg: 40 }])), null);
    assert.equal(nextSetAdvice(blk('8-12', [{ completed: true, weightKg: 40, reps: 5 }, { weightKg: 35 }])), null);
  });
});
