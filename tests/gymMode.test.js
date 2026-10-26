// Gym Mode unit tests: equipment-aware load jumps, rest presets and
// skip-to navigation — the pure logic the runners rely on.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  quickJumps,
  applyQuickJump,
  warmupsSkipped,
  setWarmupSkip,
  effectiveWarmups,
  adjacentLoad,
  equipmentIncrement,
  REST_PRESET_CHOICES,
  defaultRestPreset,
  restPresetFor,
  setRestPreset,
  skipTo,
  SESSION_QUALITY_OPTIONS,
  sessionQualityLabel,
} from '../src/lib/gymMode.js';

describe('gym mode — equipment-aware load jumps', () => {
  it('derives increments from the equipment class', () => {
    // Barbell: smallest plate × 2 (default 1.25 → 2.5 total).
    assert.equal(equipmentIncrement({ equipment: 'barbell' }), 2.5);
    // Machine: pin increment default.
    assert.equal(equipmentIncrement({ equipment: 'machine' }), 2.5);
    // Dumbbells: smallest gap in the printed rack.
    const inc = equipmentIncrement({ equipment: 'dumbbells' });
    assert.ok(inc > 0 && Number.isFinite(inc));
  });

  it('labels quick jumps in real kilos for each equipment class', () => {
    const barbell = quickJumps({ equipment: ['barbell'], supportsWeighted: true });
    assert.deepEqual(barbell.map(j=> j.label), ['−5', '−2.5', '+2.5', '+5']);
    assert.deepEqual(barbell.map(j=> j.delta), [-5, -2.5, 2.5, 5]);

    const dumbbell = quickJumps({ equipment: ['dumbbells'], supportsWeighted: true });
    // Default dumbbell rack's smallest gap is 2 kg.
    assert.ok(dumbbell.some(j=> j.label === '+2'));
    assert.ok(dumbbell.every(j=> Math.abs(j.delta) <= 4));

    const machine = quickJumps({ equipment: ['machine'], supportsWeighted: true });
    assert.ok(machine.every(j=> Math.abs(j.delta) % 2.5 === 0));
  });

  it('offers no quick jumps for bodyweight movements', () => {
    assert.deepEqual(quickJumps({ equipment: ['bodyweight'], supportsWeighted: false }), []);
    assert.deepEqual(quickJumps({ equipment: ['dumbbells'], supportsWeighted: false }), []);
  });

  it('snaps quick jumps onto achievable loads', () => {
    // 20 kg + 5 kg is a clean barbell load.
    assert.equal(applyQuickJump('20', { delta: 5 }, { equipment: 'barbell' }), '25');
    // 21 kg + 2.5 kg = 23.5, which is NOT plate-achievable (1.25 plates give
    // 2.5 kg steps off the 20 kg bar) — snaps to the nearest real load, 22.5.
    assert.equal(applyQuickJump('21', { delta: 2.5 }, { equipment: 'barbell' }), '22.5');
    // Jumps never go negative.
    assert.equal(Number(applyQuickJump('1', { delta: -5 }, { equipment: 'barbell' })) >= 0, true);
  });

  it('steps to the next achievable load with adjacentLoad', () => {
    assert.equal(adjacentLoad('20', 1, { equipment: 'barbell' }), '22.5');
    // A standard 20 kg bar can't get lighter — the empty bar is the floor.
    assert.equal(adjacentLoad('20', -1, { equipment: 'barbell' }), '20');
    // Dumbbells step through the real rack: 12 → 14 up, 12 → 10 down.
    assert.equal(adjacentLoad('12', -1, { equipment: 'dumbbells' }), '10');
    assert.equal(adjacentLoad('12', 1, { equipment: 'dumbbells' }), '14');
    // Machines step by their 2.5 kg pin increment.
    assert.equal(adjacentLoad('40', 1, { equipment: 'cable machine' }), '42.5');
  });

  it('respects a custom plate configuration', () => {
    const config = { platesKg: [5, 10] };
    assert.equal(equipmentIncrement({ equipment: 'barbell', config }), 10);
    // 22.5 kg is NOT achievable with 5/10 plates (needs a 1.25/side); the
    // engine snaps to the nearest achievable load — 20, not up to 30.
    assert.equal(applyQuickJump('20', { delta: 2.5 }, { equipment: 'barbell', config }), '20');
  });
});

describe('gym mode — rest presets', () => {
  it('offers the standard preset ladder', () => {
    assert.ok(REST_PRESET_CHOICES.includes(90));
    assert.ok(REST_PRESET_CHOICES.every(s=> s >= 45 && s <= 240));
  });

  it('defaults to the nearest preset below the programme rest', () => {
    assert.equal(defaultRestPreset(90), 90);
    assert.equal(defaultRestPreset(120), 120);
    assert.equal(defaultRestPreset(150), 120); // nearest match wins
    assert.equal(defaultRestPreset(0), null);
    assert.equal(defaultRestPreset(null), null);
  });

  it('stores, reads and clears per-exercise presets', () => {
    // setRestPreset takes the full gymPrefs object (reading .restPresets) and
    // returns the bare updated map; callers store it under gymPrefs.restPresets
    // (the contract App.jsx and MoreView call).
    let gymPrefs = { restPresets: setRestPreset(null, 'squat', 180) };
    assert.deepEqual(gymPrefs.restPresets, { squat: 180 });
    assert.equal(restPresetFor(gymPrefs, 'squat', 90), 180);
    // Other exercises fall back to the programme default's nearest preset.
    assert.equal(restPresetFor(gymPrefs, 'bench', 90), 90);
    // Clearing returns to the fallback.
    gymPrefs = { restPresets: setRestPreset(gymPrefs, 'squat', 0) };
    assert.deepEqual(gymPrefs.restPresets, {});
    assert.equal(restPresetFor(gymPrefs, 'squat', 90), 90);
    // Preserving unrelated presets while setting a new one.
    gymPrefs = { restPresets: setRestPreset(gymPrefs, 'deadlift', 240) };
    gymPrefs = { restPresets: setRestPreset(gymPrefs, 'row', 60) };
    assert.equal(gymPrefs.restPresets.deadlift, 240);
    assert.equal(gymPrefs.restPresets.row, 60);
  });
});

describe('gym mode — skip-to navigation', () => {
  const blocks = [
    { exerciseId: 'bench-press-barbell', name: 'Bench Press', sets: [{ completed: true }, { completed: true }] },
    { exerciseId: 'chest-press-machine', name: 'Chest Press', sets: [{ completed: true }, { completed: false }] },
    { exerciseId: 'barbell-row', name: 'Row', sets: [{ completed: false }] },
  ];

  it('finds a block by id or name, case-insensitively', () => {
    assert.deepEqual(skipTo(blocks, 'row'), { blockIndex: 2, setIndex: 0 });
    assert.deepEqual(skipTo(blocks, 'ROW'), { blockIndex: 2, setIndex: 0 });
    assert.deepEqual(skipTo(blocks, 'chest'), { blockIndex: 1, setIndex: 1 });
  });

  it('matches the first unfinished set inside the block', () => {
    assert.deepEqual(skipTo(blocks, 'chest'), { blockIndex: 1, setIndex: 1 });
  });

  it('falls back to the last set when the block is finished', () => {
    assert.deepEqual(skipTo(blocks, 'bench'), { blockIndex: 0, setIndex: 1 });
  });

  it('returns null for empty queries and misses', () => {
    assert.equal(skipTo(blocks, ''), null);
    assert.equal(skipTo(blocks, '   '), null);
    assert.equal(skipTo(blocks, 'leg-press'), null);
    assert.equal(skipTo([], 'bench'), null);
  });
});

describe('gym mode — session quality', () => {
  it('offers a stable four-level rating', () => {
    assert.equal(SESSION_QUALITY_OPTIONS.length, 4);
    assert.deepEqual(SESSION_QUALITY_OPTIONS.map(o=> o.id), ['great', 'good', 'ok', 'rough']);
  });

  it('resolves labels for saved sessions', () => {
    assert.equal(sessionQualityLabel('great'), 'Great');
    assert.equal(sessionQualityLabel('rough'), 'Rough');
    assert.equal(sessionQualityLabel('unknown-id'), null);
    assert.equal(sessionQualityLabel(undefined), null);
  });
});

import { effortAdjustedRest, hasUserRestPreset } from '../src/lib/gymMode.js';
describe('effortAdjustedRest', () => {
  it('adds 30s after a grind (RIR 0 or RPE 10)', () => {
    assert.equal(effortAdjustedRest(90, { rir: 0 }), 120);
    assert.equal(effortAdjustedRest(90, { rpe: 10 }), 120);
  });
  it('trims 15s after an easy set but floors at 45', () => {
    assert.equal(effortAdjustedRest(90, { rir: 4 }), 75);
    assert.equal(effortAdjustedRest(50, { rir: 5 }), 45);
  });
  it('caps at 300s', () => assert.equal(effortAdjustedRest(290, { rir: 0 }), 300));
  it('never overrides a user preset or unknown effort', () => {
    assert.equal(effortAdjustedRest(90, { rir: 0 }, { hasUserPreset: true }), 90);
    assert.equal(effortAdjustedRest(90, {}), 90);
    assert.equal(effortAdjustedRest(90, { rir: '' }), 90);
    assert.equal(effortAdjustedRest(90, { rir: 2 }), 90);
    assert.equal(effortAdjustedRest(0, { rir: 0 }), 0);
  });
  it('adds 30s on a rep shortfall when effort was not logged', () => {
    assert.equal(effortAdjustedRest(90, { reps: 5, minReps: 8 }), 120);
    assert.equal(effortAdjustedRest(90, { reps: 8, minReps: 8 }), 90);
    assert.equal(effortAdjustedRest(90, { reps: 5, minReps: 8 }, { hasUserPreset: true }), 90);
    assert.equal(effortAdjustedRest(90, { reps: 5, minReps: 8, rir: 2 }), 90);
  });
  it('detects stored presets', () => {
    assert.equal(hasUserRestPreset({ restPresets: { a: 60 } }, 'a'), true);
    assert.equal(hasUserRestPreset({}, 'a'), false);
  });
});

describe('warm-up skip memory', () => {
  it('remembers and clears a skip per lift without mutating prefs', () => {
    const prefs = { skipWarmups: { a: true } };
    const on = setWarmupSkip(prefs, 'b', true);
    assert.deepEqual(on, { a: true, b: true });
    assert.deepEqual(prefs.skipWarmups, { a: true });
    assert.deepEqual(setWarmupSkip({ skipWarmups: on }, 'a', false), { b: true });
    assert.deepEqual(setWarmupSkip(null, 'a', false), {});
  });
  it('reports skip only for exact true', () => {
    assert.equal(warmupsSkipped({ skipWarmups: { a: true } }, 'a'), true);
    assert.equal(warmupsSkipped({ skipWarmups: { a: 'yes' } }, 'a'), false);
    assert.equal(warmupsSkipped(null, 'a'), false);
  });
  it('drops ramp sets for skipped lifts only', () => {
    const block = { exerciseId: 'a', warmups: [{ reps: 8, weightKg: 20 }] };
    assert.equal(effectiveWarmups(block, { skipWarmups: { a: true } }).length, 0);
    assert.equal(effectiveWarmups(block, { skipWarmups: { b: true } }).length, 1);
    assert.deepEqual(effectiveWarmups({ exerciseId: 'a' }, null), []);
  });
});
