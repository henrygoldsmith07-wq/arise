// Migration and longitudinal depth tests: the gaps the existing suites
// (store.test.js, longitudinal.test.js) don't cover —
//   migrations: edge inputs (null, non-object, future version), every historical
//               hop v1→9, idempotence, and payload preservation;
//   longitudinal: wilsonInterval bounds, mergeEvaluationLedgers semantics, and
//               the two clustered bootstrap resamplers (determinism, ranges,
//               degenerate inputs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runMigrations, STORE_SCHEMA_VERSION, normaliseHistory,
} from '../src/lib/store.js';
import {
  wilsonInterval, mergeEvaluationLedgers,
} from '../src/lib/longitudinal.js';
import { parseReps, e1rm } from '../src/lib/longitudinalCore.js';
import {
  clusteredBootstrapDifference, clusteredBootstrapWinRate,
} from '../src/lib/evaluation.js';

describe('runMigrations — hostile and edge inputs', () => {
  it('returns a valid default store for null', () => {
    const out = runMigrations(null);
    assert.equal(out.version, STORE_SCHEMA_VERSION);
    assert.ok(out.preferences && typeof out.preferences === 'object');
    assert.deepEqual(out.history, []);
    assert.equal(out.activeWorkout, null);
  });

  it('returns a valid store for undefined and for primitives', () => {
    for (const input of [undefined, 42, 'a string', true]) {
      const out = runMigrations(input);
      assert.equal(out.version, STORE_SCHEMA_VERSION, `input ${JSON.stringify(input)}`);
      assert.deepEqual(out.history, []);
    }
  });

  it('passes a future version through untouched — the import gate owns rejection', () => {
    // Documented contract: runMigrations never drops data it doesn't recognise;
    // a *file* carrying a newer schema is rejected earlier, in export.js
    // ("newer than this app supports"), before migration is ever reached.
    const out = runMigrations({ version: 999, preferences: { units: 'lb' } });
    assert.equal(out.version, 999, 'in-memory payload keeps its own version');
    assert.equal(out.preferences.units, 'lb', 'user data preserved');
  });

  it('does not mutate nested entries (top-level reassignment is the documented contract)', () => {
    // Callers (export.js, migrationLog.js) pass a clone — the contract is that
    // the store OBJECT is fair game, but the user's history ENTRIES must come
    // through untouched so a failed save never loses the original rows.
    const entry = { id: 'h1', version: 3, blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '8', weightKg: '80' }] }] };
    const entrySnapshot = JSON.stringify(entry);
    const out = runMigrations({ version: 6, preferences: {}, history: [entry] });
    assert.equal(JSON.stringify(entry), entrySnapshot, 'history entry not mutated');
    assert.equal(out.history[0].blocks[0].sets[0].side, null, 'output is normalised independently');
  });
});

describe('runMigrations — every hop, forward only', () => {
  it('v1 lands on current with all cumulative preference defaults', () => {
    const out = runMigrations({ version: 1, preferences: { units: 'kg' } });
    assert.equal(out.version, STORE_SCHEMA_VERSION);
    for (const k of ['syncEnabled', 'autoRest', 'soundCues', 'voiceCoach', 'voiceRate', 'healthSummaryEnabled', 'pulseEnabled']) {
      assert.ok(k in out.preferences, `missing ${k}`);
    }
    assert.equal(out.preferences.telemetryEnabled, null, 'telemetry stays unset → fail-closed');
    assert.equal(out.preferences.voiceCoach, false);
    assert.deepEqual(out.readinessLog, []);
    assert.deepEqual(out.programHistory, []);
  });

  it('v2 backfills set shapes without touching real values', () => {
    const out = runMigrations({
      version: 2,
      history: [{
        id: 's1', dateISO: '2026-01-01',
        blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '8', weightKg: '80', rpe: 8 }] }],
      }],
    });
    const set = out.history[0].blocks[0].sets[0];
    assert.equal(set.reps, '8');
    assert.equal(set.weightKg, '80');
    assert.equal(set.rpe, 8);
    assert.equal(set.side, null);
    assert.equal(set.tempo, null);
    assert.equal(set.completed, true, 'unset completed on a non-skipped set defaults complete');
  });

  it('v3 creates event/health fields explicitly', () => {
    const out = runMigrations({ version: 3, preferences: {} });
    assert.equal(out.activeWorkout, null);
    assert.deepEqual(out.eventHistory, []);
    assert.equal(out.healthSummary, null);
  });

  it('v4 history rows gain the durable fields from normaliseHistoryEntry', () => {
    const out = runMigrations({
      version: 4,
      history: [{ id: 's1', savedAt: '2026-01-01T10:00:00Z', blocks: [{ exerciseId: 'x' }] }],
    });
    const h = out.history[0];
    assert.equal(h.mode, 'standard');
    assert.deepEqual(h.noteTags, []);
    assert.equal(h.programVersion, null);
    assert.deepEqual(h.substitutions, []);
    assert.equal(h.skippedSetsCount, 0);
  });

  it('v5, v6, v7, v8 each add their preference default', () => {
    assert.equal(runMigrations({ version: 5, preferences: {} }).preferences.autoRest, true);
    assert.equal(runMigrations({ version: 6, preferences: {} }).preferences.soundCues, true);
    assert.equal(runMigrations({ version: 7, preferences: {} }).preferences.voiceCoach, false);
    assert.equal(runMigrations({ version: 8, preferences: {} }).preferences.voiceRate, 1);
  });

  it('is idempotent: migrating an already-current store is a no-op', () => {
    const once = runMigrations({ version: 8, preferences: { voiceRate: 1.5 }, history: [{ id: 'a' }] });
    const twice = runMigrations(JSON.parse(JSON.stringify(once)));
    assert.deepEqual(twice, once);
  });

  it('preserves an explicit user choice against the default backfill', () => {
    assert.equal(runMigrations({ version: 6, preferences: { autoRest: false } }).preferences.autoRest, false);
    assert.equal(runMigrations({ version: 7, preferences: { voiceCoach: true } }).preferences.voiceCoach, true);
    assert.equal(runMigrations({ version: 8, preferences: { voiceRate: 0.75 } }).preferences.voiceRate, 0.75);
  });

  it('clamps a corrupt accessibility object to strict booleans', () => {
    const out = runMigrations({ version: 8, preferences: { accessibility: { largeText: 'yes', reduceMotion: true } } });
    assert.equal(out.preferences.accessibility.largeText, false, 'any non-true value clamps to false');
    assert.equal(out.preferences.accessibility.reduceMotion, true);
    assert.equal(out.preferences.accessibility.highContrast, false);
  });

  it('repairs non-array customTemplates and non-array history', () => {
    const out = runMigrations({ version: 8, customTemplates: 'oops', history: null });
    assert.deepEqual(out.customTemplates, []);
    assert.deepEqual(out.history, []);
  });
});

describe('normaliseHistory — duplicate and corrupt rows', () => {
  const mk = (id, dateISO, weightKg, extra = {}) => ({
    id, dateISO, blocks: [{ exerciseId: 'bench-press', sets: [{ reps: '8', weightKg, ...extra }] }], ...extra.top,
  });

  it('deduplicates by id keeping the newer save', () => {
    const merged = normaliseHistory([
      mk('s1', '2026-01-01', '80'),
      { ...mk('s1', '2026-01-01', '82.5'), savedAt: '2026-01-02T09:00:00Z' },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].blocks[0].sets[0].weightKg, '82.5');
  });

  it('drops a malformed entry without losing its siblings', () => {
    const merged = normaliseHistory([
      null,
      mk('ok1', '2026-01-01', '80'),
      mk('ok2', '2026-01-03', '85'),
    ]);
    assert.deepEqual(merged.map((h) => h.id), ['ok1', 'ok2'], 'null rows are skipped, not echoed');
  });

  it('sorts chronologically by date regardless of input order', () => {
    const merged = normaliseHistory([mk('b', '2026-02-01', '80'), mk('a', '2026-01-01', '80')]);
    assert.deepEqual(merged.map((h) => h.id), ['a', 'b']);
  });
});

describe('wilsonInterval', () => {
  it('never reports a degenerate 100% at small n', () => {
    const [threeOfThree, hundredOfHundred] = [wilsonInterval(3, 3), wilsonInterval(100, 100)];
    assert.ok(threeOfThree.high <= 1);
    assert.ok(threeOfThree.low > 0.4, '3/3 low bound stays well above luck (≈0.438)');
    assert.ok(hundredOfHundred.low > 0.95, 'more data tightens the interval');
    assert.ok(hundredOfHundred.low > threeOfThree.low);
  });

  it('rejects impossible inputs with null', () => {
    assert.equal(wilsonInterval(0, 0), null);
    assert.equal(wilsonInterval(5, 3), null);
    assert.equal(wilsonInterval(-1, 10), null);
    assert.equal(wilsonInterval(2, -5), null);
  });

  it('is symmetric at p=0.5 and inside [0,1] everywhere', () => {
    const mid = wilsonInterval(50, 100);
    assert.ok(Math.abs(mid.low - (1 - mid.high)) < 0.01);
    for (const [s, n] of [[0, 10], [1, 10], [7, 8], [999, 1000]]) {
      const iv = wilsonInterval(s, n);
      assert.ok(iv.low >= 0 && iv.high <= 1);
    }
  });
});

describe('parseReps / e1rm', () => {
  it('parses the first integer out of messy human input', () => {
    assert.equal(parseReps('8'), 8);
    assert.equal(parseReps('8-10'), 8);
    assert.equal(parseReps('8+2 forced'), 8);
    assert.equal(parseReps('AMRAP'), 0);
    assert.equal(parseReps(null), 0);
  });

  it('e1rm follows Epley and rejects zeros', () => {
    assert.ok(Math.abs(e1rm(100, 1) - 100 * (1 + 1 / 30)) < 1e-9, '1-rep set still gains the Epley factor');
    assert.ok(Math.abs(e1rm(100, 10) - 133.333) < 0.01);
    assert.equal(e1rm(0, 10), 0);
    assert.equal(e1rm(100, 0), 0);
    assert.equal(e1rm('junk', 5), 0);
  });
});

describe('mergeEvaluationLedgers', () => {
  const rec = (id, outcome = undefined, extra = {}) => ({ id, outcome, ...extra });

  it('unions by id without duplicating', () => {
    const a = [rec('r1', undefined), rec('r2', { met: true })];
    const b = [rec('r1', { met: false }), rec('r3', { met: true })];
    const merged = mergeEvaluationLedgers(a, b);
    assert.equal(merged.length, 3);
    assert.deepEqual(merged.map((r) => r.id).sort(), ['r1', 'r2', 'r3']);
  });

  it('resolved beats unresolved regardless of side', () => {
    const currentWins = mergeEvaluationLedgers(
      [rec('r1', { met: true })],
      [rec('r1', undefined)],
    );
    assert.ok(currentWins.find((r) => r.id === 'r1').outcome);

    const incomingWins = mergeEvaluationLedgers(
      [rec('r1', undefined)],
      [rec('r1', { met: false })],
    );
    assert.ok(incomingWins.find((r) => r.id === 'r1').outcome);
  });

  it('first outcome wins over later conflicting outcomes (append-only ledger)', () => {
    const merged = mergeEvaluationLedgers([rec('r1', { met: true })], [rec('r1', { met: false })]);
    assert.equal(merged.find((r) => r.id === 'r1').outcome.met, true);
  });

  it('drops records without an id and tolerates null sides', () => {
    const merged = mergeEvaluationLedgers([rec(null), null, rec('r1', undefined)], [undefined, [1, 2]]);
    assert.deepEqual(merged.map((r) => r.id), ['r1']);
  });

  it('is stable on empty inputs', () => {
    assert.deepEqual(mergeEvaluationLedgers([], []), []);
    assert.deepEqual(mergeEvaluationLedgers(undefined, undefined), []);
  });
});

describe('clustered bootstraps — determinism and degenerate inputs', () => {
  const pairs = [
    { participant: 'p1', group: 'arise', met: true },
    { participant: 'p1', group: 'arise', met: true },
    { participant: 'p1', group: 'double-progression', met: false },
    { participant: 'p2', group: 'arise', met: true },
    { participant: 'p2', group: 'double-progression', met: false },
    { participant: 'p2', group: 'double-progression', met: true },
    { participant: 'p3', group: 'arise', met: false },
    { participant: 'p3', group: 'double-progression', met: false },
  ];

  it('returns null/unfinished shapes for degenerate inputs', () => {
    assert.equal(clusteredBootstrapDifference([]), null);
    assert.equal(clusteredBootstrapWinRate([]), null);
    const single = clusteredBootstrapDifference([{ participant: 'p1', group: 'arise', met: true }]);
    assert.equal(single.participants, 1);
    assert.equal(single.mean, null);
    assert.equal(single.conclusive, false);
  });

  it('is deterministic for the same seed', () => {
    const a = clusteredBootstrapDifference(pairs, { seed: 'fixed', iterations: 120 });
    const b = clusteredBootstrapDifference(pairs, { seed: 'fixed', iterations: 120 });
    assert.deepEqual(a, b);
  });

  it('different seeds vary within a plausible range, same rate anchor', () => {
    const a = clusteredBootstrapDifference(pairs, { seed: 'seed-a', iterations: 200 });
    const b = clusteredBootstrapDifference(pairs, { seed: 'seed-b', iterations: 200 });
    assert.notDeepEqual(a, b);
    assert.equal(a.ariseMetRate, b.ariseMetRate, 'point estimate is seed-independent');
    assert.equal(a.doubleProgressionMetRate, b.doubleProgressionMetRate);
    assert.ok(a.mean >= a.low && a.mean <= a.high);
  });

  it('win rate counts only arise-met / arm-not-met pairs, participants only', () => {
    const wr = clusteredBootstrapWinRate(pairs, { iterations: 100 });
    assert.ok(wr);
    assert.equal(wr.participants, 3);
    assert.ok(wr.mean >= 0 && wr.mean <= 1);
  });

  it('a strongly separated fixture produces a positive interval that excludes zero', () => {
    const clean = [];
    for (let i = 0; i < 6; i++) {
      clean.push({ participant: `p${i}`, group: 'arise', met: true });
      clean.push({ participant: `p${i}`, group: 'double-progression', met: false });
    }
    const boot = clusteredBootstrapDifference(clean, { iterations: 300 });
    assert.equal(boot.low, 1, 'every resample sees a perfect gap');
    assert.equal(boot.ariseMetRate, 1);
    assert.equal(boot.doubleProgressionMetRate, 0);
  });
});
