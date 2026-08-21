import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptScheduleForEquipment,
  adaptActiveSchedule,
  exerciseHistorySummary,
  missedWorkoutRecovery,
  plateauDetection,
  programAdherence,
  progressionExplanation,
  recommendationCalibration,
  recordProgramStart,
  replanSchedule,
  shortWorkoutMode,
  validateDeloadLogic,
} from '../src/lib/programming.js';

const session = (id, dateISO, exerciseId = 'bench-press-dumbbell', reps = '8', weightKg = '20', extra = {}) => ({
  id, dateISO, ...extra,
  blocks: [{ exerciseId, sets: [{ reps, weightKg, rpe: '7' }] }],
});

describe('programming layer', ()=>{
  it('returns a transparent progression decision with evidence and a rule', ()=>{
    const result = progressionExplanation({
      exerciseId: 'bench-press-dumbbell',
      targetReps: '8–12',
      history: [session('a', '2026-01-01')],
    });
    assert.equal(result.exerciseName, 'Dumbbell Bench Press');
    assert.equal(result.confidence, 'low');
    assert.ok(result.evidence.some(line=> line.includes('20kg')));
    assert.ok(result.rule.length > 10);
  });

  it('detects a genuine plateau but attributes a fatigue run separately', ()=>{
    const flat = ['2026-01-01', '2026-01-05', '2026-01-09', '2026-01-13'].map((dateISO, i)=> session(`f${i}`, dateISO, 'barbell-squat', '8', '40'));
    const genuine = plateauDetection(flat, 'barbell-squat', { readinessLog: flat.map(h=> ({ dateISO: h.dateISO, score: 75 })) });
    assert.equal(genuine.detected, true);
    assert.equal(genuine.status, 'plateau');

    const tired = flat.map((h, i)=> ({ ...h, id: `t${i}`, note: i > 1 ? 'sore and tired' : '', blocks: [{ exerciseId: 'barbell-squat', sets: [{ reps: '8', weightKg: '40', rpe: i > 1 ? '10' : '7' }] }] }));
    const fatigue = plateauDetection(tired, 'barbell-squat', { readinessLog: tired.map(h=> ({ dateISO: h.dateISO, score: h.id === 't2' || h.id === 't3' ? 20 : 75 })) });
    assert.equal(fatigue.detected, false);
    assert.equal(fatigue.status, 'fatigue');
  });

  it('measures adherence and moves missed sessions forward in order', ()=>{
    const schedule = {
      programId: 'starter-3x',
      sessions: [
        { id: 's1', dateISO: '2026-08-15', week: 1, title: 'A', blocks: [] },
        { id: 's2', dateISO: '2026-08-17', week: 1, title: 'B', blocks: [] },
        { id: 's3', dateISO: '2026-08-19', week: 1, title: 'C', blocks: [] },
      ],
    };
    const history = [{ id: 's2', dateISO: '2026-08-17', blocks: [] }];
    const adherence = programAdherence(schedule, history, { today: '2026-08-19' });
    assert.equal(adherence.completed, 1);
    assert.equal(adherence.missed, 1);
    assert.equal(adherence.due, 2);
    assert.equal(missedWorkoutRecovery(schedule, history, { today: '2026-08-19' }).needed, true);

    const replanned = replanSchedule(schedule, history, { today: '2026-08-19' });
    assert.equal(replanned.changed, true);
    assert.deepEqual(Object.fromEntries(replanned.schedule.sessions.map(s=> [s.id, s.dateISO])), { s1: '2026-08-19', s2: '2026-08-17', s3: '2026-08-21' });
  });

  it('creates a short workout without mutating the planned session', ()=>{
    const planned = {
      id: 's1',
      title: 'Full body',
      blocks: [
        { exerciseId: 'bodyweight-squat', sets: 3, reps: '8–12', restSec: 90 },
        { exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12', restSec: 90 },
        { exerciseId: 'dumbbell-row', sets: 3, reps: '8–12', restSec: 90 },
        { exerciseId: 'plank', sets: 3, reps: '30–45s', restSec: 60 },
      ],
    };
    const result = shortWorkoutMode(planned, { minutes: 12 });
    assert.equal(result.changed, true);
    assert.equal(result.session.mode, 'short');
    assert.ok(result.omittedExerciseIds.length > 0);
    assert.equal(planned.blocks.length, 4);
  });

  it('adapts an active schedule when kit changes', ()=>{
    const schedule = { sessions: [{ id: 's1', blocks: [{ exerciseId: 'barbell-squat', sets: 3, reps: '5' }] }] };
    const result = adaptScheduleForEquipment(schedule, ['bodyweight'], []);
    assert.equal(result.changed, true);
    assert.equal(result.substitutions.length, 1);
    assert.notEqual(result.schedule.sessions[0].blocks[0].exerciseId, 'barbell-squat');
  });

  it('feeds repeated performance into the next programme session and is idempotent', ()=>{
    const schedule = {
      programId: 'starter-3x',
      startDateISO: '2026-01-01',
      sessions: [
        { id: 'p1', dateISO: '2026-01-01', status: 'done', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' }] },
        { id: 'p2', dateISO: '2026-01-08', status: 'done', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' }] },
        { id: 'p3', dateISO: '2026-01-15', status: 'planned', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' }] },
      ],
    };
    const history = [
      { id: 'p1', dateISO: '2026-01-01', programId: 'starter-3x', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '20', rpe: '7' }, { reps: '12', weightKg: '20', rpe: '7' }, { reps: '12', weightKg: '20', rpe: '7' }] }] },
      { id: 'p2', dateISO: '2026-01-08', programId: 'starter-3x', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '20', rpe: '7' }, { reps: '12', weightKg: '20', rpe: '7' }, { reps: '12', weightKg: '20', rpe: '7' }] }] },
    ];
    const result = adaptActiveSchedule(schedule, history, { availableEquipment: ['dumbbells', 'bench'] });
    assert.equal(result.changed, true);
    assert.equal(result.schedule.sessions.find(s=> s.id === 'p3').blocks[0].sets, 4);
    assert.equal(result.changes[0].kind, 'volume');
    assert.match(result.changes[0].reason, /two sessions/i);
    const replay = adaptActiveSchedule(result.schedule, history, { availableEquipment: ['dumbbells', 'bench'] });
    assert.equal(replay.changed, false);
  });

  it('reduces the next block after repeated high-effort difficulty', ()=>{
    const schedule = {
      programId: 'starter-3x',
      startDateISO: '2026-01-01',
      sessions: [
        { id: 'p1', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' }] },
        { id: 'p2', dateISO: '2026-01-08', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' }] },
        { id: 'p3', dateISO: '2026-01-15', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12' }] },
      ],
    };
    const history = [
      { id: 'p1', dateISO: '2026-01-01', programId: 'starter-3x', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '8', failed: true }, { reps: '8', weightKg: '20', rpe: '8' }] }] },
      { id: 'p2', dateISO: '2026-01-08', programId: 'starter-3x', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '8', failed: true }, { reps: '8', weightKg: '20', rpe: '8' }] }] },
    ];
    const result = adaptActiveSchedule(schedule, history);
    assert.equal(result.changed, true);
    assert.equal(result.schedule.sessions.find(s=> s.id === 'p3').blocks[0].sets, 2);
    assert.equal(result.changes[0].kind, 'repeated-difficulty');
  });

  it('summarises exercise history and keeps programme runs separate', ()=>{
    const history = [session('a', '2026-01-01'), session('b', '2026-01-08')];
    const summary = exerciseHistorySummary(history, 'bench-press-dumbbell');
    assert.equal(summary.sessions, 2);
    assert.equal(summary.last.dateISO, '2026-01-08');

    const entries = recordProgramStart([{ programId: 'starter-3x', version: 1, startDateISO: '2026-01-01', endDateISO: null }], {
      programId: 'strength-4x', version: 2, startDateISO: '2026-02-01',
    });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].endDateISO, '2026-01-31');
    assert.equal(entries[1].programId, 'strength-4x');
  });

  it('reports deload evidence and recommendation calibration limits', ()=>{
    const deload = validateDeloadLogic({ history: [], readinessLog: [] });
    assert.equal(deload.decision.yes, false);
    assert.equal(deload.confidence, 'low');
    const calibration = recommendationCalibration([]);
    assert.equal(calibration.status, 'insufficient');
    assert.equal(calibration.samples, 0);
  });
});
