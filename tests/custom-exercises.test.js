import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addCustomExercise, removeCustomExercise, mergeCustomExercises, registerCustomExercises, liveCustomExercises, sanitizeCustomExercises } from '../src/lib/customExercises.js';
import { EXERCISES, EXERCISE_BY_ID, searchExercises } from '../src/lib/data.js';
import { mergeGymPrefs } from '../src/lib/sync.js';

const T = (n) => `2026-11-0${n}T08:00:00.000Z`;

describe('custom exercises', () => {
  it('adds with a stable id; names are unique case-blind, built-ins included', () => {
    const r = addCustomExercise({}, { name: '  Zercher   squat ', muscle: 'Legs', equipment: 'machine' }, T(1));
    assert.equal(r.id, 'custom-zercher-squat');
    assert.deepEqual(r.patch.customExercises[r.id], { name: 'Zercher squat', muscle: 'Legs', equipment: 'machine', updatedAt: T(1) });
    assert.match(addCustomExercise(r.patch, { name: 'ZERCHER SQUAT', muscle: 'Legs', equipment: 'machine' }).error, /already exists/);
    assert.match(addCustomExercise({}, { name: 'Goblet Squat', muscle: 'Legs', equipment: 'dumbbells' }).error, /already exists/);
    assert.match(addCustomExercise({}, { name: 'x' }).error, /name/);
  });

  it('unknown muscle/kit fall back safely; bad ids and rows are dropped', () => {
    const m = sanitizeCustomExercises({ 'custom-a': { name: 'A lift', muscle: 'Toes', equipment: 'laser' }, 'evil id': { name: 'x' }, 'custom-b': { name: '' } });
    assert.deepEqual(Object.keys(m), ['custom-a']);
    assert.equal(m['custom-a'].muscle, 'Full body');
    assert.equal(m['custom-a'].equipment, 'bodyweight');
  });

  it('registers into the catalogue; removal leaves pickers but keeps the name for history', () => {
    const { patch } = addCustomExercise({}, { name: 'Zercher squat', muscle: 'Legs', equipment: 'machine' }, T(1));
    registerCustomExercises(patch);
    assert.equal(EXERCISE_BY_ID['custom-zercher-squat'].name, 'Zercher squat');
    assert.equal(EXERCISE_BY_ID['custom-zercher-squat'].progression, 'load');
    assert.ok(searchExercises({ q: 'zercher' }).some((e) => e.id === 'custom-zercher-squat'));
    const gone = { ...patch, ...removeCustomExercise(patch, 'custom-zercher-squat', T(2)) };
    registerCustomExercises(gone);
    assert.equal(liveCustomExercises(gone).length, 0);
    assert.ok(!EXERCISES.some((e) => e.id === 'custom-zercher-squat'), 'not offered any more');
    assert.equal(EXERCISE_BY_ID['custom-zercher-squat'].name, 'Zercher squat', 'old history still reads as the lift');
    registerCustomExercises({});
    assert.ok(!EXERCISES.some((e) => e.custom));
  });

  it('merge: per lift, newest wins, a tie prefers the deletion, order-independent', () => {
    const a = { 'custom-x': { name: 'X lift', muscle: 'Back', equipment: 'cable', updatedAt: T(1) } };
    const b = { 'custom-x': { name: 'X lift', deleted: true, updatedAt: T(2) }, 'custom-y': { name: 'Y lift', muscle: 'Arms', equipment: 'cable', updatedAt: T(1) } };
    assert.deepEqual(mergeCustomExercises(a, b), mergeCustomExercises(b, a));
    assert.equal(mergeCustomExercises(a, b)['custom-x'].deleted, true);
    const tie = { 'custom-x': { name: 'X lift', deleted: true, updatedAt: T(1) } };
    assert.equal(mergeCustomExercises(a, tie)['custom-x'].deleted, true);
  });

  it('sync keeps lifts made on two devices, whichever gymPrefs is newer', () => {
    const phone = { updatedAt: T(3), customExercises: { 'custom-x': { name: 'X lift', muscle: 'Back', equipment: 'cable', updatedAt: T(1) } } };
    const laptop = { updatedAt: T(2), customExercises: { 'custom-y': { name: 'Y lift', muscle: 'Arms', equipment: 'cable', updatedAt: T(2) } } };
    assert.deepEqual(Object.keys(mergeGymPrefs(phone, laptop).customExercises).sort(), ['custom-x', 'custom-y']);
    assert.deepEqual(Object.keys(mergeGymPrefs(laptop, phone).customExercises).sort(), ['custom-x', 'custom-y']);
  });
});
