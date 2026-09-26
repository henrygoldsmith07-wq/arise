export default {
  mutate: [
    'src/lib/storeReconcile.js',
    'src/lib/runnerRecommendations.js',
  ],
  testRunner: 'command',
  commandRunner: {
    command: 'node --test tests/cross-tab-store.test.js tests/runner-recommendations.test.js',
  },
  coverageAnalysis: 'off',
  concurrency: 2,
  timeoutMS: 10_000,
  dryRunTimeoutMinutes: 2,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  thresholds: {
    high: 85,
    // Baseline 2026-09-27: 82.58% (218 killed / 46 survived, 0 uncovered).
    // Fail the nightly if the core invariant suite regresses below 80%.
    low: 80,
    break: 80,
  },
};
