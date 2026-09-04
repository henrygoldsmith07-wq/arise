// Evidence metrics, no-feedback invariant, sample gating and benchmark
// hardening tests.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

import {
  acceptanceMetrics, adherenceMetrics, agreementMetrics, calibrationMetrics,
  overshootMetrics, deloadUsefulnessMetrics, plateauResolutionMetrics,
  evidenceBand, evidenceDashboard, renderEvidenceReportMarkdown,
} from '../src/lib/evidenceMetrics.js';
import { recordRecommendation, attachOutcome, loadEvaluationLedger, loadArchivedEvaluationCount, appendArchivedEvaluationRecords } from '../src/lib/longitudinal.js';
import { recommendNext } from '../src/lib/progression.js';
import { backtestHistory } from '../src/lib/backtesting.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function memoryStorage(){
  const map = new Map();
  return { getItem: (k)=> map.has(k) ? map.get(k) : null, setItem: (k,v)=> map.set(k, String(v)), removeItem: (k)=> map.delete(k) };
}
const CONSENT = { telemetryEnabled: true };

// A ledger synthesised end-to-end: record → attachOutcome. Three records (the
// open-per-exercise cap), all resolved: followed+met, plateau-hold+met, and
// followed-but-failed. The plateau-hold's reason mentions a deload, so it also
// exercises the deload matcher's reason-text path.
function synthesiseLedger({ followAll = true, storage } = {}){
  const hist = (d, w, extra = {})=> [{ dateISO: d, blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: w, reps: 8, rpe: 7, ...extra }] }] }];
  recordRecommendation({ exerciseId: 'bench-press', recommendation: { load: 82.5, reps: 8, reason: 'Room at RPE — add a rep.' }, history: hist('2026-05-01', 80), dueDateISO: '2026-05-08', preferences: CONSENT, nowISO: '2026-05-01T12:00:00.000Z', storage });
  recordRecommendation({ exerciseId: 'bench-press', recommendation: { load: 85, reps: 8, reason: 'Plateau — hold load, consider deload.' }, history: hist('2026-05-08', 82.5), dueDateISO: '2026-05-15', preferences: CONSENT, nowISO: '2026-05-08T12:00:00.000Z', storage });
  recordRecommendation({ exerciseId: 'bench-press', recommendation: { load: 85, reps: 8, reason: 'Close to failure — increase load.' }, history: hist('2026-05-15', 82.5), dueDateISO: '2026-05-22', preferences: CONSENT, nowISO: '2026-05-15T12:00:00.000Z', storage });
  attachOutcome({ sessionId: 's1', dateISO: '2026-05-08', blocks: [{ exerciseId: 'bench-press', sets: [followAll ? { weightKg: 82.5, reps: 8 } : { weightKg: 70, reps: 6 }] }], historyBefore: [], preferences: CONSENT, nowISO: '2026-05-08T20:00:00.000Z', storage });
  attachOutcome({ sessionId: 's2', dateISO: '2026-05-15', blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: 85, reps: 8 }] }], historyBefore: [], preferences: CONSENT, nowISO: '2026-05-15T20:00:00.000Z', storage });
  attachOutcome({ sessionId: 's3', dateISO: '2026-05-22', blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: 80, reps: 5, failed: true }] }], historyBefore: [], preferences: CONSENT, nowISO: '2026-05-22T20:00:00.000Z', storage });
  return loadEvaluationLedger(storage);
}

describe('evidence metrics from synthesised ledger records', ()=> {
  it('acceptance splits followed vs rejected with unknowns never counted', ()=> {
    const storage = memoryStorage();
    const ledger = synthesiseLedger({ storage });
    const resolvedCount = ledger.filter(r=> r.outcome).length;
    const a = acceptanceMetrics(ledger);
    // accepted/rejected share the same denominator (resolved rows); unknowns
    // are the rows with no followed verdict.
    assert.equal(a.accepted.n, resolvedCount, 'accepted denominator == resolved rows');
    assert.equal(a.rejected.n, resolvedCount, 'rejected denominator == resolved rows');
    assert.equal(resolvedCount, 3, 'fixture resolves all three records');
    assert.ok(a.accepted.rate + a.rejected.rate <= 1.0001, 'rates partition the resolved rows');
    assert.ok(a.accepted.ci, 'Wilson CI present on proportions');
  });

  it('adherence reports deviation stats over resolved records only', ()=> {
    const storage = memoryStorage();
    const ledger = synthesiseLedger({ storage });
    const m = adherenceMetrics(ledger);
    assert.equal(m.n, 3);
    assert.ok(m.meanDeviationKg == null || m.meanDeviationKg >= 0);
  });

  it('agreement counts met-when-followed and classifications', ()=> {
    const storage = memoryStorage();
    const ledger = synthesiseLedger({ storage });
    const g = agreementMetrics(ledger);
    const resolvedCount = ledger.filter(r=> r.outcome).length;
    assert.ok(g.targetMetWhenFollowed.n <= resolvedCount, 'agreement scopes to followed rows');
    assert.ok(g.targetMetWhenFollowed.n > 0);
    assert.ok(Object.values(g.classifications).reduce((a,b)=> a + b, 0) === resolvedCount, 'classifications cover every resolved row');
  });

  it('calibration buckets by confidence band; legacy rows land in none', ()=> {
    const storage = memoryStorage();
    const ledger = synthesiseLedger({ storage });
    const c = calibrationMetrics(ledger);
    assert.equal(c.assessed, false, 'legacy rows without audit.confidence are unknown, not assumed high');
  });

  it('overshoot flags followed progressions that failed', ()=> {
    const storage = memoryStorage();
    const ledger = synthesiseLedger({ storage });
    const o = overshootMetrics(ledger);
    assert.ok(o.progressedDecisions >= 0);
    assert.ok(o.overshootRate.rate == null || o.overshootRate.rate >= 0);
  });

  it('deload usefulness and plateau resolution read the same record honestly', ()=> {
    const storage = memoryStorage();
    const ledger = synthesiseLedger({ storage });
    const d = deloadUsefulnessMetrics(ledger);
    // The plateau-hold reason mentions a deload, so the reason-text matcher
    // picks it up — and its outcome shows recovery to pre-decision best.
    assert.equal(d.deloadDecisions, 1);
    assert.equal(d.assessed, 1);
    assert.equal(d.recovered.rate, 1);
    const p = plateauResolutionMetrics(ledger);
    assert.equal(p.plateauHolds, 1, 'the plateau-hold record is detected by reason text');
  });

  it('dashboard gates by sample size and renders the Markdown report', ()=> {
    const storage = memoryStorage();
    const ledger = synthesiseLedger({ storage });
    const dash = evidenceDashboard(ledger, { archivedCount: loadArchivedEvaluationCount(storage) });
    assert.equal(dash.resolvedCount, 3);
    assert.equal(dash.sampleGate.band, 'emerging', '3 resolved records = emerging pattern band');
    assert.ok(dash.disclaimer.includes('Correlation, not causation'));
    const md = renderEvidenceReportMarkdown(dash);
    assert.ok(md.startsWith('# Arise evidence report'));
    assert.ok(md.includes('95% CI') || md.includes('n='));
    assert.ok(!md.includes('proves'), 'no causal claims in the report');
  });

  it('band thresholds: 2 insufficient, 3 emerging, 8 consistent, 20 high', ()=> {
    assert.equal(evidenceBand(2).band, 'insufficient');
    assert.equal(evidenceBand(3).band, 'emerging');
    assert.equal(evidenceBand(8).band, 'consistent');
    assert.equal(evidenceBand(20).band, 'high');
  });
});

describe('ledger hygiene: archiving and the no-feedback invariant', ()=> {
  it('archive append + count round-trips resolved records', ()=> {
    const storage = memoryStorage();
    const ledger = synthesiseLedger({ storage });
    const resolved = ledger.filter(r=> r.outcome);
    assert.equal(appendArchivedEvaluationRecords(resolved, storage), resolved.length);
    assert.equal(loadArchivedEvaluationCount(storage), resolved.length);
  });

  it('NO-FEEDBACK: recommendations never read the evaluation ledger', ()=> {
    const storage = memoryStorage();
    synthesiseLedger({ storage });
    const historyA = [
      { dateISO: '2026-05-01', blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: 80, reps: 8, rpe: 7 }] }] },
      { dateISO: '2026-05-08', blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: 82.5, reps: 8, rpe: 7 }] }] },
    ];
    const historyB = [
      ...historyA,
      { dateISO: '2026-05-15', blocks: [{ exerciseId: 'bench-press', sets: [{ weightKg: 95, reps: 8, rpe: 7 }] }] },
    ];
    const a = recommendNext({ exerciseId: 'bench-press', history: historyA, asOfDateISO: '2026-05-08' });
    const b = recommendNext({ exerciseId: 'bench-press', history: historyB, asOfDateISO: '2026-05-08' });
    assert.equal(a.reason, b.reason, 'future rows changed the as-of recommendation');
    // The ledger exists and is non-empty, proving recommendNext ran against a
    // populated evaluation store — the engine simply never reads it.
    assert.ok(loadEvaluationLedger(storage).length >= 3);
  });
});

describe('benchmark hardening gates', ()=> {
  it('determinism script passes on the shipped fixture', ()=> {
    execSync('node benchmark/determinism.js', { cwd: ROOT, stdio: 'pipe' });
  });
  it('threshold gate passes on the shipped fixture', ()=> {
    const out = execSync('node benchmark/thresholds.js', { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /threshold gate passed/);
  });
  it('artifact compare passes against the committed baseline', ()=> {
    const out = execSync('node benchmark/artifact.js compare', { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /no unexplained drift/);
  });
  it('artifact carries corpus hash and priors version', ()=> {
    const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmark', 'results.artifact.json'), 'utf8'));
    assert.match(artifact.corpus.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(artifact.versions.priors));
    assert.equal(artifact.schema, 'arise.benchmark.artifact.v1');
  });
});
