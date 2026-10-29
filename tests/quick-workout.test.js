import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_MAX, QUICK_PROGRAM_ID, isQuickSession, buildQuickSession, quickCandidates, sameAsLastTime,
  daysSinceByMuscle, restedMuscleLifts, upperBodyLifts, moveId,
} from '../src/lib/quickWorkout.js';
import { completeWorkout } from '../src/services/workoutService.js';
import { EXERCISES, EXERCISE_BY_ID, scheduleProgram } from '../src/lib/data.js';

const set = (reps, weightKg = 40) => ({ reps: String(reps), weightKg: String(weightKg), completed: true });
const entry = (id, dateISO, blocks) => ({ id, dateISO, title: `S ${id}`, blocks });
const CHEST = 'chest-press-machine';
const ROW = 'machine-row';
const LEGS = 'leg-press';
const NOW = new Date(2026, 9, 29, 12, 0, 0);

describe('buildQuickSession', () => {
  it('builds an unscheduled, runnable session', () => {
    const s = buildQuickSession({ exerciseIds: [CHEST, ROW], history: [], now: NOW });
    assert.equal(s.programId, QUICK_PROGRAM_ID);
    assert.equal(s.quick, true);
    assert.equal(s.dateISO, '2026-10-29');
    assert.match(s.id, /^quick-2026-10-29-/);
    assert.deepEqual(s.blocks.map((b) => b.exerciseId), [CHEST, ROW]);
    assert.deepEqual(s.blocks.map((b) => [b.sets, b.reps, b.restSec]), [[3, '8–12', 90], [3, '8–12', 90]]);
    assert.equal(isQuickSession(s), true);
    assert.equal(isQuickSession({ programId: 'starter-3x' }), false);
  });

  it('gives each session its own id so two quick sessions on one day never collide', () => {
    const a = buildQuickSession({ exerciseIds: [CHEST], now: new Date(2026, 9, 29, 12, 0, 0) });
    const b = buildQuickSession({ exerciseIds: [CHEST], now: new Date(2026, 9, 29, 18, 30, 0) });
    assert.notEqual(a.id, b.id);
  });

  it('drops unknown and duplicate ids, caps the length, and returns null when empty', () => {
    assert.equal(buildQuickSession({ exerciseIds: ['nope'] }), null);
    assert.equal(buildQuickSession({ exerciseIds: [] }), null);
    const s = buildQuickSession({ exerciseIds: [CHEST, CHEST, 'nope', ROW] });
    assert.deepEqual(s.blocks.map((b) => b.exerciseId), [CHEST, ROW]);
    const many = EXERCISES.filter((e) => !e.supersededBy).slice(0, 30).map((e) => e.id);
    assert.equal(buildQuickSession({ exerciseIds: many }).blocks.length, QUICK_MAX);
  });

  it('follows what was logged last time for sets and a rep range around the top reps', () => {
    const history = [
      entry('old', '2026-10-01', [{ exerciseId: CHEST, sets: [set(12), set(12), set(12), set(12)] }]),
      entry('new', '2026-10-20', [{ exerciseId: CHEST, sets: [set(8), set(8), set(7), set(6), set(6), set(6)] }]),
    ];
    const b = buildQuickSession({ exerciseIds: [CHEST], history, now: NOW }).blocks[0];
    assert.equal(b.sets, 5, 'newest session wins, capped at 5');
    assert.equal(b.reps, '6–10');
  });

  it('uses a time range for hold exercises and no rest for cardio', () => {
    const s = buildQuickSession({ exerciseIds: ['plank'], now: NOW });
    assert.equal(s.blocks[0].reps, '30–45s');
    const cardio = EXERCISES.find((e) => e.muscle === 'Cardio' && !e.supersededBy);
    if (cardio) assert.equal(buildQuickSession({ exerciseIds: [cardio.id], now: NOW }).blocks[0].restSec, 0);
  });
});

describe('saving a quick session leaves the programme alone', () => {
  it('adds history but marks no scheduled session done and keeps the schedule rev', () => {
    const schedule = scheduleProgram({ programId: 'starter-3x', startDateISO: '2026-10-26' });
    const store = { activeSchedule: schedule, history: [], onboarding: { equipment: ['bodyweight', 'dumbbells', 'bench', 'bands'] } };
    const session = buildQuickSession({ exerciseIds: [CHEST], now: NOW });
    const payload = { ...session, blocks: [{ exerciseId: CHEST, sets: [set(10), set(10)] }], durationMinutes: 20 };
    const out = completeWorkout({ store, payload }).store;
    assert.equal(out.history.length, 1);
    assert.equal(out.history[0].programId, QUICK_PROGRAM_ID);
    assert.equal(out.activeSchedule.sessions.filter((s) => s.status === 'done').length, 0);
    assert.deepEqual(out.activeSchedule.sessions.map((s) => s.dateISO), schedule.sessions.map((s) => s.dateISO));
  });
});

describe('sameAsLastTime', () => {
  it('returns the lifts of the newest session that had logged sets', () => {
    const history = [
      entry('a', '2026-10-10', [{ exerciseId: CHEST, sets: [set(10)] }]),
      entry('b', '2026-10-20', [{ exerciseId: ROW, sets: [set(10)] }, { exerciseId: CHEST, sets: [{ reps: '', completed: false }] }, { exerciseId: 'bench-press', sets: [set(5)] }]),
    ];
    const last = sameAsLastTime(history);
    assert.deepEqual(last.ids, [ROW], 'skips unlogged blocks and deprecated ids');
    assert.equal(last.dateISO, '2026-10-20');
  });
  it('is null without history', () => {
    assert.equal(sameAsLastTime([]), null);
    assert.equal(sameAsLastTime(undefined), null);
  });
});

describe('rested muscles', () => {
  const history = [
    entry('c', '2026-10-28', [{ exerciseId: CHEST, sets: [set(10)] }]),
    entry('r', '2026-10-24', [{ exerciseId: ROW, sets: [set(10)] }]),
    entry('l', '2026-10-20', [{ exerciseId: LEGS, sets: [set(10)] }]),
  ];
  it('counts whole days since each muscle was logged', () => {
    const d = daysSinceByMuscle(history, '2026-10-29');
    assert.equal(d.Chest, 1);
    assert.equal(d.Back, 5);
    assert.equal(d.Legs, 9);
  });
  it('suggests the longest-rested muscles first with a reason', () => {
    const f = restedMuscleLifts({ history, equipment: ['machine', 'cable', 'bodyweight'], todayISO: '2026-10-29', muscleCount: 2 });
    assert.ok(f.muscles.length === 2);
    assert.ok(!f.muscles.includes('Chest'), 'chest was trained yesterday');
    assert.ok(f.ids.length > 0 && f.ids.every((id) => EXERCISE_BY_ID[id]));
    assert.match(Object.values(f.reasons)[0], /day|not logged/);
  });
  it('upper body only never suggests legs, for a rider who wants fresh legs', () => {
    const f = upperBodyLifts({ history, equipment: ['machine', 'cable', 'bodyweight'], todayISO: '2026-10-29' });
    assert.ok(f.ids.length > 0);
    for (const id of f.ids) assert.ok(['Chest', 'Back', 'Shoulders', 'Arms'].includes(EXERCISE_BY_ID[id].muscle), id);
  });
  it('never suggests an avoided lift', () => {
    const f = upperBodyLifts({ history, equipment: ['machine'], disliked: [ROW, CHEST], todayISO: '2026-10-29' });
    assert.ok(!f.ids.includes(ROW) && !f.ids.includes(CHEST));
  });
});

describe('quickCandidates', () => {
  it('respects kit, avoided lifts, picked lifts and deprecated ids', () => {
    const list = quickCandidates({ equipment: ['machine'], disliked: [ROW], exclude: [CHEST], limit: 500 });
    assert.ok(list.length > 0);
    assert.ok(list.every((e) => e.equipment.includes('machine') || e.equipment.includes('bodyweight')));
    assert.ok(!list.some((e) => e.id === ROW || e.id === CHEST || e.supersededBy));
  });
  it('searches by name and puts liked lifts first', () => {
    const list = quickCandidates({ query: 'row', preferred: ['t-bar-row'], limit: 50 });
    assert.equal(list[0].id, 't-bar-row');
    assert.ok(list.every((e) => /row/i.test(`${e.name} ${e.id}`)));
  });
});

describe('moveId and data trim', () => {
  it('moves within bounds only', () => {
    assert.deepEqual(moveId(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
    assert.deepEqual(moveId(['a', 'b'], 0, 5), ['a', 'b']);
  });
  it('coverage fills still derive weighted/assisted from the id', () => {
    assert.equal(EXERCISE_BY_ID['weighted-dip'].supportsWeighted, true);
    assert.equal(EXERCISE_BY_ID['assisted-pull-up'].supportsAssisted, true);
    assert.equal(EXERCISE_BY_ID['machine-row'].supportsWeighted, false);
  });
});
