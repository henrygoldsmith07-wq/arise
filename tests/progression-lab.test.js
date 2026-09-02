import test from 'node:test';
import assert from 'node:assert/strict';
import { runComparativeStudy } from '../src/lib/study.js';
import { runMigrations } from '../src/lib/store.js';
import { mergeStores } from '../src/lib/export.js';

function historyWithExposures(count){
  return Array.from({ length: count }, (_, i) => ({
    id: `lab-${i}`,
    dateISO: `2026-01-${String(i + 1).padStart(2, '0')}`,
    blocks: [{
      exerciseId: 'barbell-bench-press',
      sets: [{ reps: String(8 + (i % 3)), weightKg: String(60 + i), rpe: '8', completed: true }],
    }],
  }));
}

test('progression lab keeps sparse replay inconclusive and gates a winner', ()=>{
  const sparse = runComparativeStudy(historyWithExposures(5));
  const sparseExercise = sparse.byExercise['barbell-bench-press'];
  assert.ok(sparseExercise);
  assert.equal(sparseExercise.arise.n, 4);
  assert.equal(sparseExercise.arise.conclusive, false);
  assert.equal(sparseExercise['double-progression'].conclusive, false);

  const ready = runComparativeStudy(historyWithExposures(7));
  const exercise = ready.byExercise['barbell-bench-press'];
  assert.equal(exercise.arise.n, 6);
  assert.equal(exercise.arise.conclusive, true);
  assert.equal(exercise['double-progression'].conclusive, true);
  assert.equal(typeof exercise.arise.targetAchievementRate, 'number');
  assert.equal(typeof exercise['double-progression'].targetAchievementRate, 'number');
});

test('progression policy choices survive migrations and merged backups', ()=>{
  const migrated = runMigrations({ version: 6, progressionOverrides: null });
  assert.deepEqual(migrated.progressionOverrides, {});

  const merged = mergeStores(
    { version: 6, history: [], progressionOverrides: { 'barbell-bench-press': 'arise' } },
    { version: 6, history: [], progressionOverrides: { 'lateral-raise': 'double-progression' } },
  );
  assert.deepEqual(merged.progressionOverrides, {
    'barbell-bench-press': 'arise',
    'lateral-raise': 'double-progression',
  });
});

