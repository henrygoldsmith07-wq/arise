import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isProspectiveRecommendation, isResolvedProspectiveEvidence, isProspectiveRecord } from '../src/lib/longitudinalCore.js';
import { calibrateRecommendations, prospectiveFieldComparison } from '../src/lib/evaluation.js';
import { recordRecommendation, attachOutcome, longitudinalSummary } from '../src/lib/longitudinal.js';
import { loadParticipantFile } from '../src/lib/fieldStudy.js';
import { parseImportFile } from '../src/lib/export.js';
import { loggingFrictionStats } from '../src/lib/telemetry.js';

const LIVE = { origin: 'live-engine' };
const CONSENT = { telemetryEnabled: true };

function memoryStorage(){
  const map = new Map();
  return {
    getItem: key=> map.has(key) ? map.get(key) : null,
    setItem: (key, value)=> map.set(key, String(value)),
    removeItem: key=> map.delete(key),
  };
}

// Open live recommendation: recorded live, outcome not yet arrived — the real
// recordRecommendation shape (no outcome, no outcome provenance).
function openRow({ id = 'o1', user = 'u1', recOrigin = 'live-engine' } = {}){
  const row = {
    id, exerciseId: 'bench-press-dumbbell', participantId: user,
    assignedArm: 'arise',
    recommendation: { load: 20, reps: 8 },
    recommendedAction: 'add_load',
    outcome: null,
  };
  if(recOrigin !== undefined) row.provenance = { origin: recOrigin };
  return row;
}

function resolvedRow({ id = 'r1', user = 'u1', recOrigin = 'live-engine', outOrigin = 'live-engine' } = {}){
  const row = openRow({ id, user });
  row.outcome = { followed: true, metTarget: true, gradeable: true, sessionId: 's9', dateISO: '2026-03-09', arms: { arise: { metTarget: true }, 'double-progression': { metTarget: false } } };
  if(recOrigin !== undefined) row.provenance = { origin: recOrigin };
  else delete row.provenance;
  if(outOrigin !== undefined) row.outcomeProvenance = { origin: outOrigin };
  return row;
}

describe('prospective/open/resolved-evidence helpers', ()=>{
  it('live open recommendation is prospective but not resolved evidence', ()=>{
    const row = openRow();
    assert.equal(isProspectiveRecommendation(row), true);
    assert.equal(isResolvedProspectiveEvidence(row), false);
    assert.equal(isProspectiveRecord(row), false);
  });
  it('imported open recommendation is not prospective at all', ()=>{
    const row = openRow({ recOrigin: 'imported' });
    assert.equal(isProspectiveRecommendation(row), false);
    assert.equal(isProspectiveRecord(row), false);
  });
  it('live resolved + live outcome is eligible resolved evidence', ()=>{
    assert.equal(isProspectiveRecord(resolvedRow()), true);
  });
  it('live resolved + missing outcome provenance is excluded', ()=>{
    const row = resolvedRow({ outOrigin: null }); // null origin = absent provenance
    assert.equal(row.outcomeProvenance?.origin ?? null, null);
    assert.equal(isProspectiveRecommendation(row), true);
    assert.equal(isProspectiveRecord(row), false);
  });
  it('live resolved + imported/replayed outcome is excluded', ()=>{
    for(const outOrigin of ['imported', 'replayed', 'seed']){
      assert.equal(isProspectiveRecord(resolvedRow({ outOrigin })), false);
    }
  });
});

describe('open prospective accounting', ()=>{
  it('live open rows appear in prospective + open, never in exclusion buckets', ()=>{
    const c = prospectiveFieldComparison([openRow({ id: 'o1' }), openRow({ id: 'o2', user: 'u2' })]);
    assert.equal(c.prospective, 2);
    assert.equal(c.open, 2);
    assert.equal(c.resolved, 0);
    assert.equal(c.excluded.nonProspective, 0);
    assert.equal(c.excluded.unprovenOutcome, 0);
    assert.equal(c.maturity, 'insufficient');
  });
  it('imported open rows are excluded as non-prospective, never open', ()=>{
    const c = prospectiveFieldComparison([openRow({ recOrigin: 'imported' })]);
    assert.equal(c.prospective, 0);
    assert.equal(c.open, 0);
    assert.equal(c.excluded.nonProspective, 1);
  });
  it('calibration counts open live rows as prospective+open and mislabels nothing as reconstructed', ()=>{
    const cal = calibrateRecommendations([openRow(), resolvedRow(), openRow({ id: 'o2', recOrigin: 'imported' })]);
    assert.equal(cal.prospective, 2);
    assert.equal(cal.open, 1);
    assert.equal(cal.resolved, 1);
    assert.equal(cal.excludedReconstructed, 1); // the imported row only — never the live open row
    assert.equal(cal.excludedUnprovenOutcome, 0);
  });
  it('calibration excludes resolved rows with unproven outcomes from every rate', ()=>{
    const cal = calibrateRecommendations([resolvedRow(), resolvedRow({ id: 'r2', outOrigin: 'imported' })]);
    assert.equal(cal.prospective, 2);
    assert.equal(cal.resolved, 1);
    assert.equal(cal.open, 0);
    assert.equal(cal.excludedUnprovenOutcome, 1);
    assert.equal(cal.overall.resolved, 1);
  });
});

describe('open counts through reload/export', ()=>{
  const exportText = (ledger)=> JSON.stringify({
    app: 'arise',
    data: { version: 9, history: [], preferences: { telemetryEnabled: true }, evaluationLedger: ledger },
  });
  it('live open export stays prospective+open through study loading', ()=>{
    const { store } = loadParticipantFile(exportText([openRow()]), 0);
    assert.equal(store.evaluationLedger[0].provenance.origin, 'live-engine');
    const c = prospectiveFieldComparison(store.evaluationLedger);
    assert.equal(c.prospective, 1);
    assert.equal(c.open, 1);
    assert.equal(c.excluded.nonProspective, 0);
  });
  it('consumer import downgrades live open rows to non-prospective (fail closed)', ()=>{
    const imported = parseImportFile(exportText([openRow()]));
    assert.equal(imported.evaluationLedger[0].provenance.origin, 'imported');
    const c = prospectiveFieldComparison(imported.evaluationLedger);
    assert.equal(c.prospective, 0);
    assert.equal(c.open, 0);
    assert.equal(c.excluded.nonProspective, 1);
  });
});

describe('open → resolved lifecycle keeps measurement semantics', ()=>{
  it('record → resolve: open counts, then eligible; empty RIR stays unobserved', ()=>{
    const storage = memoryStorage();
    const rec = recordRecommendation({
      exerciseId: 'bench-press-dumbbell',
      recommendation: { load: 20, reps: 8, reason: 'test' },
      history: [], dueDateISO: '2026-03-09', preferences: CONSENT,
      nowISO: '2026-03-01T10:00:00.000Z', storage,
    });
    assert.ok(rec && rec.outcome == null);
    let summary = longitudinalSummary({ preferences: CONSENT, storage });
    assert.equal(summary.evaluation.primaryComparison.transitions, 0);
    assert.equal(summary.fieldComparison.prospective, 1);
    assert.equal(summary.fieldComparison.open, 1);
    assert.equal(summary.calibration.prospective, 1);
    assert.equal(summary.calibration.open, 1);

    // Resolve with a set that carries NO rpe (unconfirmed suggestion left empty).
    const resolved = attachOutcome({
      sessionId: 's9', dateISO: '2026-03-09',
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '' }] }],
      historyBefore: [], preferences: CONSENT, nowISO: '2026-03-09T10:00:00.000Z', storage,
    });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].outcome.rpe, '');
    // Effort-based grading sees nothing unconfirmed: met target + no RPE
    // cannot take the easy-RPE too-conservative path.
    assert.equal(resolved[0].outcome.label, 'successful');
    summary = longitudinalSummary({ preferences: CONSENT, storage });
    assert.equal(summary.fieldComparison.prospective, 1);
    assert.equal(summary.fieldComparison.open, 0);
    assert.equal(summary.fieldComparison.resolved, 1);
  });
});

describe('RIR suggestion friction telemetry (value-free)', ()=>{
  it('shown is display; confirmed is one counted action; neither carries a value', ()=>{
    const events = [
      { type: 'session:start', sessionId: 's1', at: '2026-03-01T10:00:00.000Z' },
      { type: 'complete-set', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', elapsedMs: 4000, at: '2026-03-01T10:01:00.000Z' },
      { type: 'rir-suggestion-shown', sessionId: 's1', exerciseId: 'e1', setIndex: 1, mode: 'gym', at: '2026-03-01T10:01:01.000Z' },
      { type: 'rir-suggestion-confirmed', sessionId: 's1', exerciseId: 'e1', setIndex: 1, mode: 'gym', at: '2026-03-01T10:01:05.000Z' },
    ];
    const s = loggingFrictionStats(events);
    assert.deepEqual(s.rirSuggestions, { shown: 1, confirmed: 1 });
    // complete + confirm = 2 interactions over 1 completed set; the shown
    // event is display and never inflates the action count.
    assert.equal(s.actionsPerCompletedSet, 2);
    for(const e of events){
      assert.ok(!('rpe' in e || 'rir' in e || 'value' in e), 'suggestion events carry ids only');
    }
  });
});
