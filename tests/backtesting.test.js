import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backtestHistory, validateBenchmarkDataset } from '../src/lib/backtesting.js';
import { recommendNext, trainingAgeInfo } from '../src/lib/progression.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, '..', 'benchmark', 'fixtures', 'synthetic-history.json'), 'utf8'));
const realExample = JSON.parse(fs.readFileSync(path.join(here, '..', 'benchmark', 'fixtures', 'real-history.example.json'), 'utf8'));

describe('point-in-time progression backtesting', ()=>{
  it('validates the synthetic fixture and reports every requested evaluation family', ()=>{
    assert.equal(validateBenchmarkDataset(fixture).valid, true);
    const result = backtestHistory(fixture);
    assert.equal(result.leakageSafe, true);
    assert.ok(result.comparisons >= 5);
    assert.ok(result.metrics.loadRecommendationError);
    assert.ok(result.metrics.repRecommendationError);
    assert.ok(result.metrics.progressionTiming);
    assert.ok(result.metrics.completionProbability);
    assert.ok(result.metrics.plateauClassification);
    assert.ok(result.metrics.fatigueClassification);
    assert.ok(result.metrics.deloadRecommendation);
    assert.ok(result.metrics.missedSessionRecovery.available);
    assert.ok(result.metrics.missedSessionRecovery.n > 0);
    assert.ok(result.calibration.empiricalReplacementCount > 0);
    for(const dimension of ['exercise', 'availableHistory', 'trainingAge', 'equipment', 'consistency']){
      assert.ok(result.strata[dimension]);
    }
  });

  it('does not change an historical recommendation when future rows are appended', ()=>{
    const base = fixture.history.slice(0, 5);
    const future = fixture.history.slice(5);
    const first = backtestHistory({ ...fixture, history: base, schedule: null, readinessLog: fixture.readinessLog.slice(0, 4) });
    const replay = backtestHistory({ ...fixture, history: [...base, ...future], schedule: null });
    const firstRow = first.observations[0];
    const replayRow = replay.observations[0];
    assert.deepEqual(replayRow.recommendation, firstRow.recommendation);
    assert.equal(replayRow.reconstruction.visibleSessions, firstRow.reconstruction.visibleSessions);
    assert.equal(replayRow.reconstruction.visibleReadinessEntries, firstRow.reconstruction.visibleReadinessEntries);
    assert.equal(replayRow.reconstruction.leakageSafe, true);
  });

  it('does not use the future outcome row as the rep prescription', ()=>{
    const normal = backtestHistory({ ...fixture, schedule: null });
    const alteredHistory = fixture.history.map(session=> ({
      ...session,
      blocks: (session.blocks || []).map(block=> ({ ...block, reps: block.reps === '8–12' ? '1–2' : block.reps })),
    }));
    const altered = backtestHistory({ ...fixture, history: alteredHistory, schedule: null });
    const normalRow = normal.observations.find(row=> row.sessionId === 'log-05');
    const alteredRow = altered.observations.find(row=> row.sessionId === 'log-05');
    assert.deepEqual(alteredRow.recommendation, normalRow.recommendation);
  });

  it('uses as-of training age instead of wall-clock time', ()=>{
    const visible = fixture.history.slice(0, 4);
    const a = trainingAgeInfo(visible, { asOfDateISO: '2026-01-26' });
    const b = trainingAgeInfo([...visible, ...fixture.history.slice(4)], { asOfDateISO: '2026-01-26' });
    assert.deepEqual(a, b);
    const recommendationA = recommendNext({ exerciseId: 'bench-press-dumbbell', history: visible, asOfDateISO: '2026-01-26' });
    const recommendationB = recommendNext({ exerciseId: 'bench-press-dumbbell', history: [...visible, ...fixture.history.slice(4)], asOfDateISO: '2026-01-26' });
    assert.deepEqual(recommendationA.trainingAge, recommendationB.trainingAge);
  });

  it('keeps sparse strata on priors instead of fabricating calibration', ()=>{
    const result = backtestHistory({
      ...fixture,
      config: { backtest: { minimumComparisons: 1, minimumStratumSamples: 99 } },
    });
    assert.equal(result.status, 'calibrated');
    assert.equal(result.calibration.empiricalReplacementCount, 0);
    assert.ok(result.observations.every(row=> row.calibration.completionProbability.source === 'prior'));
  });

  it('does not turn the empty real-history template into evidence', ()=>{
    assert.equal(validateBenchmarkDataset(realExample).valid, true);
    const result = backtestHistory(realExample);
    assert.equal(result.status, 'insufficient');
    assert.equal(result.comparisons, 0);
    assert.equal(result.calibration.source, 'priors');
    assert.equal(result.calibration.empiricalReplacementCount, 0);
  });
});
