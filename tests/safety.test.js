// Tests for the training-safety layer: volume/load/PR jump detection, pain
// trends and aftercare, failed-rep patterns, recovery deficit, fatigue
// stacking, deload prompts, conservative restarts, cautious-mode thresholds,
// technique/ROM prompts and the maximum-effort warning toggle.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SAFETY_CONFIG,
  sessionVolumeKg, sessionBestE1rm, weeklyVolumes,
  painTrendWarnings, painAftercareFor,
  volumeJumpWarnings, loadJumpWarnings, unrealisticPrWarnings,
  failedRepWarnings, recoveryDeficitWarnings, excessiveFatigueWarnings,
  deloadSafetyPrompt, restartAdvice, safetyPanel,
  techniquePromptFor, maxEffortWarning,
} from '../src/lib/safety.js';

const set = (weightKg, reps, extra = {}) => ({ weightKg, reps, completed: true, ...extra });
const block = (exerciseId, sets) => ({ exerciseId, sets });
const sess = (dateISO, blocks, extra = {}) => ({ dateISO, savedAt: `${dateISO}T10:00:00Z`, blocks, ...extra });

describe('safety — volume and e1RM primitives', () => {
  it('computes session volume with assisted credit', () => {
    const h = sess('2026-09-01', [block('pull-up', [set(0, 0), set(40, 10, { assistedKg: 10 })])]);
    assert.equal(Math.round(sessionVolumeKg(h)), 300);
  });

  it('best e1RM ignores empty sets', () => {
    const h = sess('2026-09-01', [block('bench-press', [set(0, 0), set(80, 6)])]);
    assert.ok(Math.abs(sessionBestE1rm(h) - 96) < 1e-9);
  });

  it('weekly volumes bucket sessions into Monday-based ISO weeks', () => {
    const history = [
      sess('2026-08-31', [block('bench-press', [set(20, 10)])]), // Monday
      sess('2026-09-02', [block('bench-press', [set(20, 10)])]), // same week
      sess('2026-09-07', [block('bench-press', [set(20, 10)])]), // next week
    ];
    const weeks = weeklyVolumes(history);
    assert.equal(weeks.length, 2);
    assert.equal(Math.round(weeks[0].vol), 400);
    assert.equal(Math.round(weeks[1].vol), 200);
  });
});

describe('safety — pain trends and aftercare', () => {
  const painful = [
    sess('2026-08-25', [block('split-squat', [set(10, 8, { pain: true })])], { painDiscomfort: true }),
    sess('2026-09-01', [block('split-squat', [set(10, 8, { pain: true })])], { painDiscomfort: true }),
  ];

  it('escalates two painful exposures of one exercise within the window', () => {
    const out = painTrendWarnings(painful);
    assert.equal(out.length, 1);
    assert.equal(out[0].exerciseId, 'split-squat');
    assert.equal(out[0].severity, 'caution');
  });

  it('stays quiet when exposures are far apart or singular', () => {
    const spread = [
      sess('2026-07-20', [block('split-squat', [set(10, 8, { pain: true })])], { painDiscomfort: true }),
      sess('2026-09-01', [block('split-squat', [set(10, 8, { pain: true })])], { painDiscomfort: true }),
    ];
    assert.equal(painTrendWarnings(spread).length, 0);
    assert.equal(painTrendWarnings([painful[0]]).length, 0);
  });

  it('offers aftercare inside 14 days of the painful exposure, then stops', () => {
    assert.ok(painAftercareFor('split-squat', painful, { today: '2026-09-06' }));
    assert.equal(painAftercareFor('split-squat', painful, { today: '2026-09-20' }), null);
    assert.equal(painAftercareFor('bench-press', painful, { today: '2026-09-06' }), null);
  });
});

describe('safety — volume, load and PR jumps', () => {
  it('flags week-over-week volume spikes beyond the threshold', () => {
    const history = [
      sess('2026-08-17', [block('bench-press', [set(50, 10)])]),   // 500
      sess('2026-08-19', [block('bench-press', [set(50, 10)])]),   // 500 → 1000
      sess('2026-08-24', [block('bench-press', [set(70, 10), set(70, 10)])]), // 1400
    ];
    const out = volumeJumpWarnings(history);
    assert.equal(out.length, 1);
    assert.match(out[0].title, /40%/);
  });

  it('does not flag steady volume', () => {
    const history = [
      sess('2026-08-17', [block('bench-press', [set(50, 10)])]),
      sess('2026-08-24', [block('bench-press', [set(50, 10)])]),
    ];
    assert.equal(volumeJumpWarnings(history).length, 0);
  });

  it('flags per-exercise e1RM load jumps', () => {
    const history = [
      sess('2026-08-17', [block('bench-press', [set(80, 6)])]),  // e1RM 96
      sess('2026-08-24', [block('bench-press', [set(100, 6)])]), // e1RM 120 (+25%)
    ];
    const out = loadJumpWarnings(history);
    assert.equal(out.length, 1);
    assert.equal(out[0].exerciseId, 'bench-press');
  });

  it('flags implausible PRs but not normal progress', () => {
    const jumpy = [
      sess('2026-08-17', [block('deadlift', [set(80, 3)])]),  // e1RM 88
      sess('2026-08-24', [block('deadlift', [set(100, 3)])]), // e1RM 110 (+25%)
    ];
    const normal = [
      sess('2026-08-17', [block('deadlift', [set(80, 5)])]),   // e1RM 93.3
      sess('2026-08-24', [block('deadlift', [set(84, 5)])]),   // +5%
    ];
    assert.equal(unrealisticPrWarnings(jumpy).length, 1);
    assert.equal(unrealisticPrWarnings(normal).length, 0);
  });
});

describe('safety — failed reps and recovery', () => {
  it('flags repeated failed sets of one exercise within the window', () => {
    const history = ['2026-08-17', '2026-08-24', '2026-08-31'].map(d =>
      sess(d, [block('bench-press', [set(100, 5, { failed: true, completed: false })])])
    );
    const out = failedRepWarnings(history);
    assert.equal(out.length, 1);
    assert.equal(out[0].exerciseId, 'bench-press');
  });

  it('stays quiet on two failures or a spread-out pattern', () => {
    const two = ['2026-08-24', '2026-08-31'].map(d =>
      sess(d, [block('bench-press', [set(100, 5, { failed: true })])])
    );
    const spread = ['2026-07-01', '2026-07-20', '2026-08-31'].map(d =>
      sess(d, [block('bench-press', [set(100, 5, { failed: true })])])
    );
    assert.equal(failedRepWarnings(two).length, 0);
    assert.equal(failedRepWarnings(spread).length, 0);
  });

  it('flags a recovery deficit only after sustained low readiness', () => {
    const low = [
      { dateISO: '2026-09-04', score: 3 },
      { dateISO: '2026-09-05', score: 4 },
      { dateISO: '2026-09-06', score: 2 },
    ];
    const mixed = [{ dateISO: '2026-09-04', score: 8 }, ...low.slice(1)];
    assert.equal(recoveryDeficitWarnings([], low).length, 1);
    assert.equal(recoveryDeficitWarnings([], mixed).length, 0);
    assert.equal(recoveryDeficitWarnings([], low.slice(0, 2)).length, 0);
  });

  it('escalates to a stop-severity warning only when deficit AND high RPE stack', () => {
    const low = [
      { dateISO: '2026-09-04', score: 3 },
      { dateISO: '2026-09-05', score: 3 },
      { dateISO: '2026-09-06', score: 3 },
    ];
    const grinding = [
      sess('2026-09-05', [block('bench-press', [set(90, 6, { rpe: 9 })])]),
      sess('2026-09-06', [block('bench-press', [set(90, 6, { rpe: 9.5 })])]),
    ];
    const out = excessiveFatigueWarnings(grinding, low);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, 'stop');
    assert.equal(excessiveFatigueWarnings(grinding, []).length, 0);
    const easy = [sess('2026-09-05', [block('bench-press', [set(50, 8, { rpe: 6 })])])];
    assert.equal(excessiveFatigueWarnings(easy, low).length, 0);
  });
});

describe('safety — deload prompts and restarts', () => {
  it('prompts a deload when weekly volume runs hot vs the 3-week average', () => {
    const hot = [
      sess('2026-08-03', [block('bench-press', [set(50, 9)])]),
      sess('2026-08-10', [block('bench-press', [set(50, 9)])]),
      sess('2026-08-17', [block('bench-press', [set(50, 9)])]),
      sess('2026-08-24', [block('bench-press', [set(50, 9), set(50, 9), set(50, 9), set(50, 2)])]),
    ];
    const flat = [0, 1, 2, 3].map(i => sess(`2026-08-0${i + 3}`, [block('bench-press', [set(50, 9)])]));
    assert.ok(deloadSafetyPrompt(hot));
    assert.equal(deloadSafetyPrompt(flat), null);
  });

  it('restarts conservatively after a long break, harder after illness', () => {
    const history = [sess('2026-08-13', [block('bench-press', [set(60, 8)])])];
    const byBreak = restartAdvice(history, { today: '2026-09-06' });
    assert.equal(byBreak.gapDays, 24);
    assert.equal(byBreak.loadFactor, 0.85);
    const byIllness = restartAdvice(history, { today: '2026-08-21', reason: 'illness' });
    assert.equal(byIllness.loadFactor, 0.75);
    assert.equal(restartAdvice(history, { today: '2026-08-17' }), null);
  });
});

describe('safety — panel aggregation and cautious mode', () => {
  it('aggregates signals with stop first, then caution, then info', () => {
    const low = [
      { dateISO: '2026-09-04', score: 3 },
      { dateISO: '2026-09-05', score: 3 },
      { dateISO: '2026-09-06', score: 3 },
    ];
    const history = [
      sess('2026-09-05', [block('bench-press', [set(90, 6, { rpe: 9 })])]),
      sess('2026-09-06', [block('bench-press', [set(50, 10, { rpe: 9 }), set(50, 10)])]),
      sess('2026-08-29', [block('bench-press', [set(50, 10)])]),
      sess('2026-08-22', [block('bench-press', [set(50, 10)])]),
    ];
    const panel = safetyPanel(history, low, { today: '2026-09-06' });
    const severities = panel.warnings.map(w => w.severity);
    const stopIdx = severities.indexOf('stop');
    assert.ok(stopIdx !== -1, 'expected a stop-severity fatigue warning');
    assert.ok(severities.slice(0, stopIdx).every(s => s === 'stop'));
  });

  it('cautious mode lowers thresholds so earlier signals appear', () => {
    const history = [
      sess('2026-08-17', [block('bench-press', [set(50, 10)])]), // 500
      sess('2026-08-24', [block('bench-press', [set(50, 10), set(50, 2)])]), // 610 (+22%)
    ];
    const standard = safetyPanel(history, [], { today: '2026-09-06' });
    const cautious = safetyPanel(history, [], { today: '2026-09-06', cautious: true });
    assert.equal(standard.warnings.some(w => w.id.startsWith('volume-jump')), false);
    assert.equal(cautious.warnings.some(w => w.id.startsWith('volume-jump')), true);
  });

  it('exposes restart advice through the panel', () => {
    const history = [sess('2026-08-13', [block('bench-press', [set(60, 8)])])];
    const panel = safetyPanel(history, [], { today: '2026-09-06' });
    assert.equal(panel.restart.gapDays, 24);
  });
});

describe('safety — technique prompts and max-effort toggle', () => {
  it('prompts technique when the last exposure noted shallow ROM', () => {
    const history = [sess('2026-09-01', [block('goblet-squat', [set(20, 10), set(20, 8, { rom: 'shallow' })])])];
    const p = techniquePromptFor('goblet-squat', history);
    assert.match(p.message, /range: shallow/);
    assert.match(p.message, /2026-09-01/);
  });

  it('stays quiet on clean full-range logs or silence', () => {
    const clean = [sess('2026-09-01', [block('goblet-squat', [set(20, 10, { rom: 'full' })])])];
    const silent = [sess('2026-09-01', [block('goblet-squat', [set(20, 10)])])];
    assert.equal(techniquePromptFor('goblet-squat', clean), null);
    assert.equal(techniquePromptFor('goblet-squat', silent), null);
  });

  it('max-effort warning honours the toggle and RIR', () => {
    assert.equal(maxEffortWarning(0).severity, 'caution');
    assert.equal(maxEffortWarning(1, { enabled: false }), null);
    assert.equal(maxEffortWarning(3), null);
    assert.equal(maxEffortWarning(''), null);
  });
});

describe('safety — configuration surface', () => {
  it('keeps every tunable finite and positive', () => {
    for(const [key, value] of Object.entries(SAFETY_CONFIG)){
      assert.ok(Number.isFinite(value), `${key} must be finite`);
      assert.ok(value > 0, `${key} must be positive`);
    }
  });
});
