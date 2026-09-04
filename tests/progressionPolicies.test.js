// Tests for the progression policy layer: versioned policies, confidence /
// evidence / uncertainty, multi-window trends, sustained-trend deloads, deload
// effectiveness, plateau confidence / false-plateau detection, guardrails and
// explanation modes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROGRESSION_POLICIES,
  POLICY_ORDER,
  POLICY_VERSION,
  resolvePolicy,
  recommendNextWithPolicy,
  multiWindowTrend,
  sustainedDeloadCheck,
  deloadEffectiveness,
  plateauConfidence,
} from '../src/lib/progressionPolicies.js';

// A clean ascending bench history: weekly sessions, +2.5 kg each at RPE 7.
function benchHistory({ sessions = 5, start = 80, step = 2.5, rpe = 7 } = {}){
  const now = Date.now();
  return Array.from({ length: sessions }, (_, i)=> ({
    dateISO: new Date(now - (sessions - 1 - i) * 7 * 86400000).toISOString().slice(0, 10),
    blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: start + i * step, reps: 8, rpe }] }],
  }));
}

describe('progression policies — registry and versioning', () => {
  it('exposes exactly four versioned policies', () => {
    assert.deepEqual(POLICY_ORDER, ['standard', 'conservative', 'aggressive', 'maintenance']);
    for(const id of POLICY_ORDER){
      const p = PROGRESSION_POLICIES[id];
      assert.equal(p.version, POLICY_VERSION);
      assert.ok(p.label && p.description);
      assert.equal(typeof p.loadScale, 'number');
      assert.equal(typeof p.minConfidence, 'number');
    }
  });

  it('resolvePolicy honours overrides and falls back to standard', () => {
    assert.equal(resolvePolicy('standard').passthrough, true);
    assert.equal(resolvePolicy('maintenance').allowLoadIncrease, false);
    assert.equal(resolvePolicy('no-such-thing').label, 'Standard');
    const custom = resolvePolicy('conservative', { config: { progression: { policy: { policies: { conservative: { loadScale: 0.5 } } } } } });
    assert.equal(custom.loadScale, 0.5);
    assert.equal(custom.maxLoadJumpPct, PROGRESSION_POLICIES.conservative.maxLoadJumpPct, 'override keeps untouched fields');
  });
});

describe('progression policies — enriched recommendations', () => {
  it('standard is behaviour-preserving and carries confidence/evidence/uncertainty', () => {
    const history = benchHistory();
    const rec = recommendNextWithPolicy({ exerciseId: 'bench-press', history });
    assert.ok(rec);
    assert.equal(rec.policy, 'standard');
    assert.ok(rec.confidence.score > 0.7, `expected high confidence, got ${rec.confidence.score}`);
    assert.equal(rec.confidence.band, 'high');
    assert.ok(rec.evidence.sessions >= 5);
    assert.ok(rec.uncertainty.pct >= 2);
    assert.ok(rec.explanation.advanced.includes('policy v'));
  });

  it('maintenance never raises load or reps', () => {
    const history = benchHistory();
    const rec = recommendNextWithPolicy({ exerciseId: 'bench-press', history, policy: 'maintenance' });
    assert.ok(rec.load <= rec.__prevLoad);
    // The maintenance override freezes the prescription; the rep-cap flag may
    // also be set (the engine's rep-first advice is the thing being frozen).
    assert.ok(['maintenance-hold', 'rep-cap'].includes(rec.guard), `guard was ${rec.guard}`);
    const lastReps = Number(String(history[4].blocks[0].sets[0].reps).match(/\d+/)[0]);
    assert.ok(Number(rec.reps) <= lastReps, `reps ${rec.reps} vs last ${lastReps}`);
  });

  it('conservative never exceeds the plain-engine load and stays on-grid', () => {
    const history = benchHistory();
    const rec = recommendNextWithPolicy({ exerciseId: 'bench-press', history, policy: 'conservative' });
    const engine = recommendNextWithPolicy({ exerciseId: 'bench-press', history });
    assert.ok(rec.load <= engine.load);
    assert.ok((rec.load * 4) % 1 === 0 || rec.load <= rec.__prevLoad, 'on a 0.25 kg grid or held');
  });

  it('aggressive respects its jump cap', () => {
    const history = benchHistory();
    const rec = recommendNextWithPolicy({ exerciseId: 'bench-press', history, policy: 'aggressive' });
    assert.ok(rec.load <= rec.__prevLoad * (1 + PROGRESSION_POLICIES.aggressive.maxLoadJumpPct) + 0.01);
  });

  it('confidence veto fires below the policy floor (deterministic via override)', () => {
    // Top-of-range sessions force the engine down its LOAD-increase path; a
    // policy configured with a 0.99 confidence floor then holds the load. (A
    // merely erratic short series can't reach this branch: the engine's own
    // noise gates hold first — defence in depth.)
    const now = Date.now();
    const history = Array.from({ length: 5 }, (_, i)=> ({
      dateISO: new Date(now - (4 - i) * 7 * 86400000).toISOString().slice(0, 10),
      blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: 88 + i, reps: 12, rpe: 7 }] }],
    }));
    const rec = recommendNextWithPolicy({
      exerciseId: 'bench-press', history, policy: 'conservative',
      policyConfig: { progression: { policy: { policies: { conservative: { minConfidence: 0.99 } } } } },
    });
    assert.ok(rec.load <= rec.__prevLoad, `load ${rec.load} vs prev ${rec.__prevLoad}`);
    assert.equal(rec.guard, 'confidence');
    assert.ok(rec.reason.includes('confidence'));
  });
});

describe('progression policies — deloads and plateaus', () => {
  it('multiWindowTrend sees a rising series across the 6-week window', () => {
    const history = benchHistory({ sessions: 6 });
    const logs = history.flatMap(h=> h.blocks[0].sets.map(s=> ({ ...s, dateISO: h.dateISO })));
    const trends = multiWindowTrend(logs);
    assert.equal(trends.w6.direction, 'up');
    assert.ok(trends.w6.n >= 5);
  });

  it('single bad session never triggers a deload (noise, not signal)', () => {
    const history = benchHistory({ sessions: 6 });
    history[5].blocks[0].sets[0].weightKg = 60; // one ugly session
    history[5].painDiscomfort = true;
    const pol = resolvePolicy('conservative');
    const logs = history.flatMap(h=> h.blocks[0].sets.map(s=> ({ ...s, dateISO: h.dateISO })));
    const check = sustainedDeloadCheck({ logs, readinessLog: [], policy: pol });
    assert.equal(check.yes, false);
  });

  it('sustained decline + low readiness triggers under conservative policy', () => {
    const history = benchHistory({ sessions: 8, step: -2 });
    const pol = resolvePolicy('conservative');
    const logs = history.flatMap(h=> h.blocks[0].sets.map(s=> ({ ...s, dateISO: h.dateISO })));
    const check = sustainedDeloadCheck({ logs, readinessLog: [1.5, 1.6, 1.4], policy: pol });
    assert.equal(check.yes, true);
    assert.ok(check.confidence === 'high' || check.confidence === 'medium');
  });

  it('deload effectiveness measures recovery against pre-deload best', () => {
    const now = Date.now();
    const events = [{ type: 'deload:prescribed', at: new Date(now - 30 * 86400000).toISOString(), scope: 'week' }];
    const history = [
      { dateISO: new Date(now - 40 * 86400000).toISOString().slice(0, 10), blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: 100, reps: 8 }] }] },
      { dateISO: new Date(now - 12 * 86400000).toISOString().slice(0, 10), blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: 101, reps: 8 }] }] },
    ];
    const eff = deloadEffectiveness({ events, history });
    assert.equal(eff.tracked, true);
    assert.equal(eff.recovered, true);
    assert.ok(eff.verdict.includes('job'));
  });

  it('plateau confidence: noisy flat series is a false plateau, clean flat is genuine', () => {
    // Weak-fit flat series (r² ≈ 0): looks flat, but the fit is noise.
    const noisy = [
      { weightKg: 82, reps: 8 }, { weightKg: 78, reps: 8 }, { weightKg: 85, reps: 8 }, { weightKg: 79, reps: 8 },
    ];
    const noisyVerdict = plateauConfidence(noisy);
    assert.equal(noisyVerdict.isPlateau, false);
    assert.equal(noisyVerdict.falsePlateauLikely, true);
    const clean = [
      { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 },
    ];
    const cleanVerdict = plateauConfidence(clean);
    assert.equal(cleanVerdict.isPlateau, true);
    assert.ok(cleanVerdict.confidence !== 'none');
  });
});

describe('progression policies — explanation modes', () => {
  it('simple mode strips the detail; advanced mode adds policy, confidence and trends', () => {
    const history = benchHistory();
    const rec = recommendNextWithPolicy({ exerciseId: 'bench-press', history });
    assert.ok(rec.explanation.simple.length < rec.explanation.standard.length);
    assert.ok(rec.explanation.advanced.includes('Confidence'));
    assert.ok(rec.explanation.advanced.includes('Uncertainty'));
    assert.ok(rec.explanation.advanced.includes('Trends'));
    assert.ok(rec.explanation.advanced.includes('Evidence'));
  });
});
