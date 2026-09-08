import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WORKOUT_MODES, normaliseWorkoutMode, storedWorkoutMode, workoutModePatch, workoutModeLabel } from '../src/lib/workoutMode.js';
import { runMigrations } from '../src/lib/store.js';

describe('workoutMode — preference resolution', () => {
  it('accepts exactly the three contract modes', () => {
    assert.deepEqual(WORKOUT_MODES, ['standard', 'short', 'guided']);
  });

  it('keeps valid stored modes', () => {
    for(const mode of WORKOUT_MODES){
      assert.equal(normaliseWorkoutMode(mode), mode);
      assert.equal(storedWorkoutMode({ workoutMode: mode }), mode);
    }
  });

  it('falls back to standard for legacy/missing/invalid values', () => {
    assert.equal(storedWorkoutMode(null), 'standard');
    assert.equal(storedWorkoutMode({}), 'standard');
    assert.equal(storedWorkoutMode({ workoutMode: undefined }), 'standard');
    assert.equal(storedWorkoutMode({ workoutMode: null }), 'standard');
    // legacy pre-feature stores never carried the key at all
    assert.equal(storedWorkoutMode({ units: 'kg', theme: null }), 'standard');
    // hostile/hand-edited values never reach the hero
    assert.equal(normaliseWorkoutMode('fast'), 'standard');
    assert.equal(normaliseWorkoutMode(''), 'standard');
    assert.equal(normaliseWorkoutMode(42), 'standard');
    assert.equal(normaliseWorkoutMode({}), 'standard');
    assert.equal(normaliseWorkoutMode(null), 'standard');
  });

  it('patch persists the pick without clobbering sibling preferences', () => {
    const prefs = { units: 'kg', theme: 'dark', soundCues: false };
    const patched = workoutModePatch(prefs, 'guided');
    assert.equal(patched.workoutMode, 'guided');
    assert.equal(patched.units, 'kg');
    assert.equal(patched.theme, 'dark');
    assert.equal(patched.soundCues, false);
    assert.equal(prefs.workoutMode, undefined); // pure — source untouched
  });

  it('patch normalises an invalid pick instead of persisting it', () => {
    assert.equal(workoutModePatch({}, 'brutal').workoutMode, 'standard');
    assert.equal(workoutModePatch({ workoutMode: 'short' }, null).workoutMode, 'standard');
  });

  it('labels every mode for the "Last used" hint', () => {
    assert.equal(workoutModeLabel('standard'), 'Standard workout');
    assert.equal(workoutModeLabel('short'), '20-minute workout');
    assert.equal(workoutModeLabel('guided'), 'Guided mode');
    assert.equal(workoutModeLabel('nonsense'), 'Standard workout');
  });
});

describe('workoutMode — store migration', () => {
  it('keeps a valid stored mode through migrations', () => {
    const migrated = runMigrations({ version: 9, preferences: { workoutMode: 'short' } });
    assert.equal(migrated.preferences.workoutMode, 'short');
  });

  it('defaults legacy stores (no key) to standard', () => {
    const migrated = runMigrations({ version: 1, preferences: { units: 'kg', theme: null } });
    assert.equal(migrated.preferences.workoutMode, 'standard');
    assert.equal(migrated.preferences.units, 'kg');
  });

  it('resets an invalid hand-edited value to standard', () => {
    const migrated = runMigrations({ version: 9, preferences: { workoutMode: 'turbo' } });
    assert.equal(migrated.preferences.workoutMode, 'standard');
  });

  it('never invents preferences on a hostile/empty payload', () => {
    const migrated = runMigrations(null);
    assert.equal(migrated.preferences.workoutMode, 'standard');
  });
});
