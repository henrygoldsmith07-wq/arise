import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResponseFingerprint } from '../src/lib/responseFingerprint.js';

function historyFromWeights(weights){
  return weights.map((weightKg, i) => ({
    id: `fingerprint-${i}`,
    dateISO: `2026-02-${String(i + 1).padStart(2, '0')}`,
    blocks: [{
      exerciseId: 'barbell-bench-press',
      sets: [{ reps: '8', weightKg: String(weightKg), rpe: '8', completed: true }],
    }],
  }));
}

test('response fingerprint stays gated until it has enough transitions', ()=>{
  const fingerprint = buildResponseFingerprint(historyFromWeights([60, 61, 62, 63]), 'barbell-bench-press');
  assert.equal(fingerprint.transitions, 3);
  assert.equal(fingerprint.status, 'collecting');
  assert.equal(fingerprint.cue, 'collecting');
});

test('response fingerprint surfaces readiness-linked push or hold cues', ()=>{
  const readinessLog = [
    { dateISO: '2026-02-01', score: 70 },
    { dateISO: '2026-02-02', score: 70 },
    { dateISO: '2026-02-03', score: 25 },
    { dateISO: '2026-02-04', score: 25 },
    { dateISO: '2026-02-05', score: 25 },
    { dateISO: '2026-02-06', score: 25 },
  ];
  const fingerprint = buildResponseFingerprint(
    historyFromWeights([60, 62, 64, 63, 63, 65]),
    'barbell-bench-press',
    readinessLog,
  );
  assert.equal(fingerprint.status, 'ready');
  assert.equal(fingerprint.bestReadiness.key, 'ready');
  assert.equal(fingerprint.latest.readinessBand, 'under-recovered');
  assert.equal(fingerprint.cue, 'hold');
  assert.ok(fingerprint.bestReadiness.meanChangePct > 0);
});

