// The boot path imports these helpers from their dependency-free leaf module
// so App.jsx does not pull the progression engine into first paint. Pin that
// the extracted functions behave exactly as the gymMode.js originals did.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { setRestPreset, setWarmupSkip } from '../src/lib/gymPrefsMemory.js';
import { setRestPreset as fromGymMode, setWarmupSkip as skipFromGymMode } from '../src/lib/gymMode.js';

describe('gym preference memory helpers', () => {
  it('sets, updates and clears a per-exercise rest preset', () => {
    const first = setRestPreset(null, 'squat', 180);
    assert.deepEqual(first, { squat: 180 });
    assert.deepEqual(setRestPreset({ restPresets: first }, 'deadlift', 240), { squat: 180, deadlift: 240 });
    assert.deepEqual(setRestPreset({ restPresets: first }, 'squat', 0), {});
  });

  it('sets and clears a warm-up skip without mutating the input', () => {
    const prefs = { skipWarmups: { a: true } };
    assert.deepEqual(setWarmupSkip(prefs, 'b', true), { a: true, b: true });
    assert.deepEqual(setWarmupSkip(prefs, 'a', false), {});
    assert.deepEqual(prefs, { skipWarmups: { a: true } });
  });

  it('stays identical to the compatibility re-exports in gymMode.js', () => {
    assert.equal(setRestPreset, fromGymMode);
    assert.equal(setWarmupSkip, skipFromGymMode);
  });
});
