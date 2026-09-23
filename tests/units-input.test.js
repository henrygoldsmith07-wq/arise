import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  asUnit,
  fmtWeight,
  weightInputToKg,
  weightInputValue,
} from '../src/lib/units.ts';

describe('weight unit input boundary', () => {
  it('round-trips pound input through canonical kg storage', () => {
    const storedKg = weightInputToKg('135', 'lb');
    assert.ok(Math.abs(Number(storedKg) - 61.235) < 0.001);
    assert.equal(weightInputValue(storedKg, 'lb'), '135');
  });

  it('preserves kg input text without an unnecessary conversion', () => {
    assert.equal(weightInputToKg('22.5', 'kg'), '22.5');
    assert.equal(weightInputValue('22.5', 'kg'), '22.5');
  });

  it('keeps blank and invalid input safe', () => {
    assert.equal(weightInputToKg('', 'lb'), '');
    assert.equal(weightInputValue('', 'lb'), '');
    assert.equal(weightInputToKg('not-a-number', 'lb'), '');
  });

  it('formats canonical kg in the selected display unit', () => {
    assert.equal(fmtWeight(20, 'kg'), '20 kg');
    assert.equal(fmtWeight(20, 'lb'), '44.1 lb');
    assert.equal(asUnit('lb'), 'lb');
    assert.equal(asUnit('stones'), 'kg');
  });

  it('round-trips common imperial equipment values exactly enough for setup', () => {
    for (const lb of ['2.5', '5', '10', '25', '35', '45']) {
      const kg = weightInputToKg(lb, 'lb');
      assert.equal(weightInputValue(kg, 'lb'), lb);
    }
  });
});
