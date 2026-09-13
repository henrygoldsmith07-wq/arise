import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLongitudinal, calibrateRecommendations } from '../src/lib/evaluation.js';
import { evidenceDashboard, evidenceBand } from '../src/lib/evidenceMetrics.js';
import { allRecords, prospectiveRecommendations, trustedResolvedRecords } from '../src/lib/longitudinalCore.js';

const LIVE = { origin: 'live-engine' };

// A resolved row whose outcome values the caller controls; provenance is the
// only thing that varies between the trusted and the diagnostic copies.
function resolvedRow({ id = 'r1', user = 'u1', met = true, recOrigin = 'live-engine', outOrigin = 'live-engine', withArms = false } = {}){
  const row = {
    id, exerciseId: 'bench-press-dumbbell', movementPattern: 'horizontal-push',
    equipmentClass: 'free-weights', participantId: user,
    recommendation: { load: 22.5, reps: 9 },
    recommendedAction: 'add_load',
    basis: { trainingAgePhase: 'novice' },
    outcome: {
      followed: true, metTarget: met, gradeable: true, sessionId: `s-${id}`, dateISO: '2026-03-09',
      failedSets: 0, sets: 3, volumeKg: 540, loadErrorKg: 0, repError: 0,
      classification: met ? 'progression-success' : 'regression',
      changePct: met ? 0.06 : -0.08,
    },
  };
  if(withArms) row.outcome.arms = { arise: { metTarget: met }, 'double-progression': { metTarget: !met } };
  if(recOrigin !== undefined) row.provenance = { origin: recOrigin };
  if(outOrigin !== undefined) row.outcomeProvenance = { origin: outOrigin };
  return row;
}

function openRow({ id = 'o1', user = 'u1', recOrigin = 'live-engine' } = {}){
  const row = {
    id, exerciseId: 'bench-press-dumbbell', participantId: user,
    recommendation: { load: 22.5, reps: 9 },
    outcome: null,
  };
  if(recOrigin !== undefined) row.provenance = { origin: recOrigin };
  return row;
}

const live4 = [0, 1, 2, 3, 4, 5].map(i=> resolvedRow({ id: `live-${i}`, met: i % 2 === 0 }));
const imported4missed = [0, 1, 2, 3].map(i=> resolvedRow({ id: `imp-${i}`, met: false, recOrigin: 'imported', outOrigin: 'imported' }));
const replayed10 = Array.from({ length: 10 }, (_, i)=> resolvedRow({ id: `rep-${i}`, met: true, recOrigin: 'replayed', outOrigin: 'replayed' }));

describe('scope helpers partition the ledger', ()=>{
  it('trusted + open-prospective + diagnostic covers every record exactly once', ()=>{
    const ledger = [...live4, ...imported4missed, openRow(), openRow({ id: 'o2', recOrigin: 'imported' })];
    const trusted = trustedResolvedRecords(ledger).length;
    const open = prospectiveRecommendations(ledger).filter(r=> !r.outcome).length;
    const diagnostic = allRecords(ledger).length - trusted - open;
    assert.equal(trusted, 6);
    assert.equal(open, 1);
    assert.equal(diagnostic, 5); // 4 imported resolved + 1 imported open
    assert.equal(trusted + open + diagnostic, allRecords(ledger).length);
  });
});

describe('imported resolved rows do not change observed rates', ()=>{
  it('evaluateLongitudinal overall and segments ignore non-live rows', ()=>{
    const base = evaluateLongitudinal(live4);
    const mixed = evaluateLongitudinal([...live4, ...imported4missed]);
    assert.deepEqual(mixed.overall, base.overall);
    assert.deepEqual(mixed.byExercise, base.byExercise);
    assert.deepEqual(mixed.byMovementPattern, base.byMovementPattern);
    assert.deepEqual(mixed.byEquipmentClass, base.byEquipmentClass);
    assert.deepEqual(mixed.evidenceScopes, { trustedObserved: 6, openProspective: 0, diagnosticRecords: 4 });
  });

  it('evidenceDashboard metrics are identical with imported rows present', ()=>{
    const base = evidenceDashboard(live4);
    const mixed = evidenceDashboard([...live4, ...imported4missed]);
    for(const key of ['adherence', 'agreement', 'calibration', 'overshoot', 'deloadUsefulness', 'plateauResolution']){
      assert.deepEqual(mixed[key], base[key], `${key} unchanged by imported rows`);
    }
    assert.equal(mixed.resolvedCount, 6);
    assert.equal(mixed.diagnosticRecords, 4);
    assert.equal(mixed.openProspective, 0);
  });
});

describe('replayed rows do not move evidence bands', ()=>{
  it('band thresholds read trusted resolved outcomes only', ()=>{
    const two = [resolvedRow({ id: 'a' }), resolvedRow({ id: 'b' })];
    assert.equal(evidenceDashboard(two).sampleGate.band, 'insufficient');
    const padded = evidenceDashboard([...two, ...replayed10]);
    assert.equal(padded.sampleGate.band, 'insufficient', '10 replayed rows must not reach the emerging band');
    assert.equal(padded.resolvedCount, 2);
    assert.equal(evidenceBand(padded.resolvedCount).band, 'insufficient');
  });
});

describe('live open rows count as awaiting, never resolved', ()=>{
  it('dashboard and evaluation agree: open is prospective, not evidence', ()=>{
    const ledger = [...live4, openRow(), openRow({ id: 'o2' })];
    const dash = evidenceDashboard(ledger);
    assert.equal(dash.resolvedCount, 6);
    assert.equal(dash.acceptance.openDecisions, 2);
    assert.equal(dash.openProspective, 2);
    assert.equal(dash.diagnosticRecords, 0);
    const ev = evaluateLongitudinal(ledger);
    assert.equal(ev.overall.resolved, 6);
    assert.equal(ev.evidenceScopes.openProspective, 2);
  });
});

describe('live/live rows count normally', ()=>{
  it('trusted observed rates reflect the genuine outcomes', ()=>{
    const ev = evaluateLongitudinal(live4);
    assert.equal(ev.overall.resolved, 6);
    assert.equal(ev.overall.progressionSuccessRate, 0.5);
    assert.equal(ev.evidenceScopes.trustedObserved, 6);
    const dash = evidenceDashboard(live4);
    assert.equal(dash.agreement.targetMetWhenFollowed.rate, 0.5);
  });
});

describe('shadow diagnostics exclude non-live outcomes', ()=>{
  it('byArm and paired wins count genuine resolved prospective transitions only', ()=>{
    const live = [0, 1].map(i=> resolvedRow({ id: `s-live-${i}`, met: i === 0, withArms: true }));
    const imported = [0, 1, 2].map(i=> resolvedRow({ id: `s-imp-${i}`, met: false, withArms: true, recOrigin: 'imported', outOrigin: 'imported' }));
    const ev = evaluateLongitudinal([...live, ...imported]);
    assert.equal(ev.byArm.arise.n, 2);
    assert.equal(ev.pairedVsArise['double-progression'].pairs, 2);
    assert.equal(ev.byArm.arise.causal, false);
  });
});

describe('primary comparison and calibration are unchanged by untrusted rows', ()=>{
  it('identical outputs with imported/replayed rows added', ()=>{
    const live = [0, 1, 2, 3].map(i=> resolvedRow({
      id: `c-live-${i}`, user: i % 2 ? 'u1' : 'u2', met: i % 2 === 0,
      withArms: true,
    }));
    const base = evaluateLongitudinal(live);
    const mixed = evaluateLongitudinal([...live, ...imported4missed, ...replayed10]);
    assert.deepEqual(mixed.primaryComparison, base.primaryComparison);
    assert.deepEqual(calibrateRecommendations([...live, ...imported4missed]).overall, calibrateRecommendations(live).overall);
  });
});
