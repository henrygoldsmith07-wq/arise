// Working-set guide: the target · range · effort line every working set logs
// against. The effort text must always restate the engine's existing room rule
// — never invent a new prescription.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { workingSetGuide } from '../src/lib/sessionRunnerModel.js';

describe('working set guide', () => {
  it('extracts the plan range and the engine target reps', () => {
    const guide = workingSetGuide({ reps:'8–12' }, { reps:10, load:60 });
    assert.equal(guide.rangeText, '8–12');
    assert.equal(guide.recReps, '10');
  });

  it('handles hyphenated ranges and missing recommendations', () => {
    const guide = workingSetGuide({ reps:'8-10' }, null);
    assert.equal(guide.rangeText, '8-10');
    assert.equal(guide.recReps, null);
  });

  it('returns no range for a single-number plan', () => {
    const guide = workingSetGuide({ reps:'3×5' }, { reps:'5' });
    assert.equal(guide.rangeText, null);
    assert.equal(guide.recReps, '5');
  });

  it('always restates the engine’s room rule as the effort contract', () => {
    const guide = workingSetGuide({ reps:'8–12' }, { reps:10 });
    assert.match(guide.effortText, /2 in the tank/);
  });
});
