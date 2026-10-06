import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { whyChoseBullets, programmeExerciseIds, programmeUsageFor, recentExerciseSessions } from '../src/lib/trainSurface.js';

const REC = {
  reasons: ['full equipment fit — no swaps needed', 'matches Beginner level'],
  adaptationInputs: [{ id: 'history', label: 'Training history', value: '2 logged sessions inform substitution ranking when sessions are built' }],
};

describe('trainSurface — whyChoseBullets', () => {
  it('surfaces the scorer’s own reasons verbatim, sentence-cased', () => {
    const bullets = whyChoseBullets(REC, 0);
    assert.equal(bullets.length, 2);
    assert.equal(bullets[0], 'Full equipment fit — no swaps needed');
    assert.equal(bullets[1], 'Matches Beginner level');
  });

  it('adds a history bullet only when history exists AND the recommendation recorded it as an adaptation input', () => {
    assert.equal(whyChoseBullets(REC, 2).length, 3);
    assert.match(whyChoseBullets(REC, 2)[2], /2 logged sessions shape the sessions it builds/);
    assert.match(whyChoseBullets(REC, 1)[2], /1 logged session shapes the sessions it builds/);
    assert.equal(whyChoseBullets(REC, 0).length, 2);
    // History exists but the recommendation never recorded it adapting — no claim.
    assert.equal(whyChoseBullets({ reasons: REC.reasons, adaptationInputs: [] }, 5).length, 2);
  });

  it('returns nothing for a missing recommendation', () => {
    assert.deepEqual(whyChoseBullets(null, 3), []);
    assert.deepEqual(whyChoseBullets(undefined), []);
  });
});

const ACTIVE = {
  sessions: [
    { dateISO: '2026-10-01', title: 'Full body A', blocks: [{ exerciseId: 'push-up', sets: 3, reps: '8–12' }, { exerciseId: 'goblet-squat', sets: 3, reps: '10' }] },
    { dateISO: '2026-10-03', title: 'Full body B', blocks: [{ exerciseId: 'push-up', sets: 2, reps: 'AMRAP' }] },
  ],
};
const TEMPLATES = [
  { id: 'tpl-1', name: 'My split', program: { weeks: [{ workouts: [{ title: 'Day 1', blocks: [{ exerciseId: 'pull-up', sets: 4, reps: '6' }, { exerciseId: 'push-up', sets: 3, reps: '8' }] }] }] } },
  { id: 'tpl-2', name: 'Deleted one', deletedAt: '2026-09-01', program: { weeks: [{ workouts: [{ blocks: [{ exerciseId: 'plank', sets: 1, reps: '60s' }] }] }] } },
];

describe('trainSurface — programme exercise usage', () => {
  it('collects ids from the active schedule and live templates only', () => {
    const ids = programmeExerciseIds({ activeSchedule: ACTIVE, customTemplates: TEMPLATES });
    assert.deepEqual([...ids].sort(), ['goblet-squat', 'pull-up', 'push-up']);
  });

  it('lists where each exercise is used, with the planned sets, ignoring deleted templates', () => {
    const rows = programmeUsageFor('push-up', { activeSchedule: ACTIVE, customTemplates: TEMPLATES });
    assert.deepEqual(rows.map(r => r.kind), ['schedule', 'schedule', 'template']);
    assert.equal(rows[0].name, 'Full body A');
    assert.equal(rows[0].detail, '3×8–12');
    assert.equal(rows[1].name, 'Full body B');
    assert.equal(rows[1].detail, '2×AMRAP');
    assert.equal(rows[2].name, 'My split');
    assert.deepEqual(programmeUsageFor('plank', { activeSchedule: ACTIVE, customTemplates: TEMPLATES }), []);
    assert.deepEqual(programmeUsageFor('push-up', {}), []);
  });

  it('handles empty inputs without throwing', () => {
    assert.deepEqual(programmeExerciseIds({}), new Set());
    assert.deepEqual(programmeUsageFor('push-up', { activeSchedule: null, customTemplates: null }), []);
  });
});

const HISTORY = [
  { id: 'h1', dateISO: '2026-09-01', title: 'Full body A', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '8', weightKg: '' }, { reps: '8', weightKg: '' }] }] },
  { id: 'h2', dateISO: '2026-09-03', title: 'Full body B', blocks: [{ exerciseId: 'plank', sets: [{ reps: '60', weightKg: '' }] }] },
  { id: 'h3', dateISO: '2026-09-05', title: 'Full body A', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '9', weightKg: '' }, { reps: '7', weightKg: '', failed: true }] }] },
  { id: 'h4', dateISO: '2026-09-08', title: 'Full body A', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '10', weightKg: '' }] }] },
];

describe('trainSurface — recentExerciseSessions', () => {
  it('returns the last 3 logged sessions with that exercise, newest first, with their sets', () => {
    const rows = recentExerciseSessions(HISTORY, 'push-up');
    assert.deepEqual(rows.map(r => r.dateISO), ['2026-09-08', '2026-09-05', '2026-09-01']);
    assert.deepEqual(rows[1].sets, [{ reps: '9', weightKg: '', failed: false }, { reps: '7', weightKg: '', failed: true }]);
  });

  it('skips skipped sets and sessions without the exercise', () => {
    const history = [...HISTORY, { id: 'h5', dateISO: '2026-09-10', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '5', weightKg: '', skipped: true }] }] }];
    assert.deepEqual(recentExerciseSessions(history, 'push-up').map(r => r.dateISO), ['2026-09-08', '2026-09-05', '2026-09-01']);
    assert.deepEqual(recentExerciseSessions(HISTORY, 'chin-up'), []);
  });

  it('honours the limit and tolerates bad rows', () => {
    assert.equal(recentExerciseSessions(HISTORY, 'push-up', 1).length, 1);
    assert.equal(recentExerciseSessions([...HISTORY, null, { blocks: null }], 'push-up', 2).length, 2);
    assert.deepEqual(recentExerciseSessions(null, 'push-up'), []);
  });
});
