import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { muscleFreshness, RECOVERY_HOURS } from '../src/lib/muscleVolumeHistory.js';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const hard = (n, o = {}) => Array.from({ length: n }, () => ({ reps: '8', weightKg: '20', rpe: '8', completed: true, ...o }));
const session = (h, blocks, extra = {}) => ({ id: `s${h}`, finishedAt: hoursAgo(h), blocks, ...extra });
const pct = (rows, m) => rows.find((r) => r.muscle === m).pct;

describe('muscleFreshness', () => {
  it('nothing recent → every muscle fresh', () => {
    const rows = muscleFreshness([session(RECOVERY_HOURS + 1, [{ exerciseId: 'bench-press-dumbbell', sets: hard(10) }])], NOW);
    assert.ok(rows.every((r) => r.pct === 100));
  });
  it('ten hard sets just now empties the muscle; fatigue fades linearly', () => {
    assert.equal(pct(muscleFreshness([session(0, [{ exerciseId: 'bench-press-dumbbell', sets: hard(10) }])], NOW), 'Chest'), 0);
    assert.equal(pct(muscleFreshness([session(RECOVERY_HOURS / 2, [{ exerciseId: 'bench-press-dumbbell', sets: hard(10) }])], NOW), 'Chest'), 50);
  });
  it('feel-out sets, skipped sets, deleted and future sessions do not count', () => {
    const rows = muscleFreshness([
      session(1, [{ exerciseId: 'bench-press-dumbbell', sets: [...hard(4, { rpe: '4' }), ...hard(4, { skipped: true })] }]),
      session(1, [{ exerciseId: 'bench-press-dumbbell', sets: hard(10) }], { deleted: true }),
      session(-5, [{ exerciseId: 'bench-press-dumbbell', sets: hard(10) }]),
    ], NOW);
    assert.equal(pct(rows, 'Chest'), 100);
  });
  it('sorted least-recovered first; date-only sessions still count', () => {
    const rows = muscleFreshness([{ id: 'x', dateISO: '2026-11-05', blocks: [{ exerciseId: 'goblet-squat', sets: hard(5) }] }], NOW);
    assert.equal(rows[0].muscle, 'Legs');
    assert.ok(rows[0].pct < 100);
  });
});
