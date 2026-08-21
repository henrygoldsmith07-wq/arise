import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backtestHistory } from '../src/lib/backtesting.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = process.argv[2] || path.join(here, 'fixtures', 'synthetic-history.json');
const dataset = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const result = backtestHistory(dataset);

console.log(`Arise point-in-time backtest (${dataset.kind})`);
console.log(`  status: ${result.status}`);
console.log(`  comparisons: ${result.comparisons}`);
console.log(`  leakage-safe replay: ${result.leakageSafe}`);
console.log(`  load MAE: ${result.metrics.loadRecommendationError?.meanAbsKg ?? '—'}kg (${result.metrics.loadRecommendationError?.meanAbsPct ?? '—'} relative)`);
console.log(`  rep MAE: ${result.metrics.repRecommendationError?.meanAbsReps ?? '—'}`);
console.log(`  completion Brier: ${result.metrics.completionProbability?.brier ?? '—'}`);
console.log(`  plateau accuracy: ${result.metrics.plateauClassification?.accuracy ?? '—'}`);
console.log(`  fatigue Brier: ${result.metrics.fatigueClassification?.brier ?? '—'}`);
console.log(`  deload observed cuts: ${result.metrics.deloadRecommendation?.observedCuts ?? '—'}`);
console.log(`  missed-session recovery: ${result.metrics.missedSessionRecovery?.sequenceAdherence ?? '—'}`);
console.log(`  empirical replacements: ${result.calibration?.empiricalReplacementCount ?? 0}`);

if(result.status === 'invalid') process.exitCode = 1;
