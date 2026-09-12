// Assigned-arm evidence tests (§6 of the validation fix): Coaching evidence
// reads trained-under arms only, shadow analysis can never headline, pooled
// aggregation clusters by participant, timing/target privacy holds at write,
// and legacy telemetry degrades safely.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLongitudinal, prospectiveFieldComparison, SHADOW_EVIDENCE_LABEL, clusteredBootstrapDifference } from '../src/lib/evaluation.js';
import { pooledAssignedComparison } from '../src/lib/fieldStudy.js';
import { coachingEvidence, shadowAgreement } from '../src/lib/product.js';

class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}
globalThis.localStorage = new MemoryStorage();

const { KEY: STORE_KEY } = await import('../src/lib/store.js');
const { recordEvent, getEventHistory, loggingFrictionStats, trackFieldFocus, fieldCommitted } = await import('../src/lib/telemetry.js');

function setConsent(enabled, options = {}){
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    version: 9,
    preferences: { telemetryEnabled: enabled, telemetryOptions: options },
  }));
}
beforeEach(()=> { globalThis.localStorage = new MemoryStorage(); });

const LIVE = { origin: 'live-engine' };

// A resolved assigned-arm ledger row: trained under `arm`, scored assignedMet.
function assignedRow({ user = 'u1', session = 's1', arm = 'arise', met = true, exercise = 'bench-press-dumbbell' } = {}){
  return {
    id: `${user}-${session}`,
    recommendation: { load: 22.5, reps: 9 },
    recommendedAction: 'add_load',
    provenance: { ...LIVE },
    exerciseId: exercise,
    participantId: user,
    assignedArm: arm,
    prescription: { arm, load: 22.5, reps: 9 },
    outcome: {
      followed: true, metTarget: met, assignedMet: met, gradeable: true,
      sessionId: session, dateISO: '2026-03-01', e1rm: 30,
      arms: { arise: { metTarget: met }, 'double-progression': { metTarget: !met } },
    },
    outcomeProvenance: { ...LIVE },
  };
}

describe('primary Coaching Evidence uses assigned arms only', ()=>{
  it('counts trained-under transitions per arm with ITT adherence', ()=>{
    const rows = [
      assignedRow({ user: 'u1', session: 's1', arm: 'arise', met: true }),
      assignedRow({ user: 'u1', session: 's2', arm: 'arise', met: false }),
      assignedRow({ user: 'u2', session: 's3', arm: 'double-progression', met: true }),
      // Unassigned / shadow-only rows never enter the primary read.
      { ...assignedRow({ user: 'u2', session: 's4' }), assignedArm: null, outcome: { ...assignedRow({}).outcome, assignedMet: null } },
      { ...assignedRow({ user: 'u2', session: 's5' }), assignedArm: 'fixed-rules' },
    ];
    const primary = evaluateLongitudinal(rows).primaryComparison;
    assert.equal(primary.transitions, 3);
    assert.equal(primary.participants, 2);
    assert.equal(primary.arise.n, 2);
    assert.equal(primary['double-progression'].n, 1);
    const e = coachingEvidence(primary);
    assert.equal(e.causal, true);
    assert.equal(e.observed, 3);
    assert.equal(e.users, 2);
    assert.match(e.lines[0], /Arise-assigned: 2 transitions/);
    assert.match(e.lines[1], /Double-progression-assigned: 1 transitions/);
  });
});

describe('shadow analysis cannot produce a causal headline', ()=>{
  it('tags every shadow output causal:false with the exact label', ()=>{
    const rows = [assignedRow({}), assignedRow({ user: 'u2', session: 's2', met: false })];
    const ev = evaluateLongitudinal(rows);
    for(const arm of Object.values(ev.byArm)) assert.equal(arm.causal, false);
    for(const p of Object.values(ev.pairedVsArise)) assert.equal(p.causal, false);
    const shadow = prospectiveFieldComparison(rows);
    assert.equal(shadow.causal, false);
    assert.equal(shadow.evidenceKind, 'shadow-decision-agreement');
    assert.equal(shadow.evidenceLabel, SHADOW_EVIDENCE_LABEL);
    assert.equal(
      SHADOW_EVIDENCE_LABEL,
      'Counterfactual target comparison on the same realised workout — not a treatment-effect estimate.',
    );
    const diag = shadowAgreement(shadow);
    assert.equal(diag.causal, false);
    assert.ok(diag.lines.length > 0);
    // And the coaching model refuses shadow-shaped input outright.
    const refused = coachingEvidence(shadow);
    assert.equal(refused.status, 'insufficient');
  });
});

describe('pooled assigned-arm aggregation', ()=>{
  function participant({ id, code, consented, rows }){
    return {
      code,
      studyParticipantId: id,
      store: {
        preferences: consented ? { telemetryEnabled: true } : {},
        history: [],
        evaluationLedger: rows,
      },
    };
  }
  const rowsFor = (code, arm, sessions, met)=> sessions.map((s, i)=> ({
    ...assignedRow({ user: code, session: `${code}-${s}`, arm, met }),
    id: `${code}-ledger-${s}`,
  }));
  it('pools genuine assigned outcomes, folds repeats, excludes unconsented', ()=>{
    const p1a = participant({ id: 'a'.repeat(16), code: 'p1', consented: true, rows: rowsFor('p1', 'arise', ['s1', 's2'], true) });
    const p1b = participant({ id: 'a'.repeat(16), code: 'p1', consented: true, rows: rowsFor('p1', 'arise', ['s3'], true) });
    const p2 = participant({ id: 'b'.repeat(16), code: 'p2', consented: true, rows: rowsFor('p2', 'double-progression', ['s1', 's2'], false) });
    const p3 = participant({ id: 'c'.repeat(16), code: 'p3', consented: false, rows: rowsFor('p3', 'arise', ['s1', 's2', 's3'], true) });
    const c = pooledAssignedComparison([p1a, p1b, p2, p3], { config: { longitudinal: { minimumSegmentSamples: 1 } }, minParticipants: 2, minTransitions: 5 });
    assert.equal(c.causal, true);
    assert.equal(c.participants, 2);
    assert.equal(c.transitions, 5);
    assert.equal(c.arise.n, 3);
    assert.equal(c['double-progression'].n, 2);
    assert.equal(c.excluded.unconsentedExports, 1);
    assert.equal(c.maturity, 'descriptive');
    assert.ok(c.note.includes('Descriptive pooled read'));
  });

  it('withholds the read below gates and counts every exclusion', ()=>{
    const p1 = participant({ id: 'a'.repeat(16), code: 'p1', consented: true, rows: rowsFor('p1', 'arise', ['s1'], true) });
    const c = pooledAssignedComparison([p1], { minParticipants: 2, minTransitions: 5 });
    assert.equal(c.maturity, 'early');
    assert.ok(c.gates.reasons.length > 0);
    assert.equal(c.difference.clusteredBootstrap.conclusive, false);
  });
});

describe('clustered uncertainty', ()=>{
  it('is deterministic and needs ≥2 participants', ()=>{
    const pairs = [
      { participant: 'u1', group: 'arise', met: true },
      { participant: 'u1', group: 'arise', met: true },
      { participant: 'u2', group: 'double-progression', met: false },
      { participant: 'u2', group: 'arise', met: true },
    ];
    const a = clusteredBootstrapDifference(pairs, { seed: 'test-seed' });
    const b = clusteredBootstrapDifference(pairs, { seed: 'test-seed' });
    assert.deepEqual(a, b);
    assert.equal(a.participants, 2);
    assert.equal(a.conclusive, true);
    assert.ok(Number.isFinite(a.low) && Number.isFinite(a.high));
    const solo = clusteredBootstrapDifference([{ participant: 'u1', group: 'arise', met: true }], { seed: 'test-seed' });
    assert.equal(solo.conclusive, false);
    assert.equal(solo.low, null);
  });
});

describe('next-exposure comparison by treatment', ()=>{
  it('splits follow-up performance by assigned arm', ()=>{
    const history = [
      { id: 'h1', dateISO: '2026-03-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '9', weightKg: '22.5' }] }] },
      { id: 'h2', dateISO: '2026-03-08', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '9', weightKg: '25' }] }] },
    ];
    const p1 = {
      code: 'p1',
      studyParticipantId: 'd'.repeat(16),
      store: {
        preferences: { telemetryEnabled: true },
        history,
        evaluationLedger: [{
          ...assignedRow({ user: 'p1', session: 'h1', arm: 'arise', met: true }),
          id: 'p1-ledger-h1',
          outcome: { ...assignedRow({}).outcome, sessionId: 'h1', dateISO: '2026-03-01', e1rm: 28 },
        }],
      },
    };
    const c = pooledAssignedComparison([p1], { minParticipants: 1, minTransitions: 1 });
    assert.equal(c.nextExposureByArm.arise.n, 1);
    assert.ok(Number.isFinite(c.nextExposureByArm.arise.meanDeltaPct));
    assert.equal(c.nextExposureByArm['double-progression'].n, 0);
    assert.equal(c.nextExposureByArm['double-progression'].meanDeltaPct, null);
  });
});

describe('timing values absent when sessionTimings=false', ()=>{
  it('strips durations at write but keeps the action facts', ()=>{
    setConsent(true, { sessionTimings: false });
    recordEvent('complete-set', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', elapsedMs: 5000, sessionElapsedMs: 90000 });
    recordEvent('swap-commit', { sessionId: 's1', from: 'e1', to: 'e2', mode: 'gym', elapsedMs: 12000 });
    recordEvent('session:save', { sessionId: 's1', blocks: 3, durationMs: 37 });
    const events = getEventHistory();
    assert.equal(events.length, 3);
    for(const e of events){
      assert.equal('elapsedMs' in e, false);
      assert.equal('durationMs' in e, false);
      assert.equal('sessionElapsedMs' in e, false);
    }
    const s = loggingFrictionStats(events);
    assert.equal(s.completedSets, 1);
    assert.equal(s.degraded, true);
  });

  it('persists durations when sessionTimings=true', ()=>{
    setConsent(true, { sessionTimings: true });
    recordEvent('complete-set', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', elapsedMs: 5000 });
    const [e] = getEventHistory();
    assert.equal(e.elapsedMs, 5000);
  });
});

describe('recommendation targets absent from telemetry', ()=>{
  it('drops target text/load/rep keys even if a call site sends them', ()=>{
    setConsent(true, { sessionTimings: true });
    recordEvent('recommendation:accepted', { sessionId: 's1', exerciseId: 'e1', target: '9 reps @ 22.5kg', load: 22.5, reps: 9, via: 'single' });
    recordEvent('recommendation:shown', { sessionId: 's1', exerciseId: 'e1', assignedArm: 'arise', suggestedTarget: '9 reps @ 22.5kg' });
    const events = getEventHistory();
    assert.equal(events.length, 2);
    for(const e of events){
      assert.equal('target' in e, false);
      assert.equal('suggestedTarget' in e, false);
      assert.equal('load' in e, false);
      assert.equal('reps' in e, false);
    }
    assert.equal(events[0].via, 'single');
    assert.equal(events[1].assignedArm, 'arise');
  });
});

describe('action telemetry contains no load/reps/RIR values', ()=>{
  it('commits only on blur-and-changed, never keystrokes', ()=>{
    const el = { value: '22.5', dataset: {} };
    const e = { target: el };
    trackFieldFocus(e);
    assert.equal(el.dataset.prevValue, '22.5');
    el.value = '22.5';
    assert.equal(fieldCommitted(e), false); // unchanged blur: no event
    trackFieldFocus(e);
    el.value = '25';
    assert.equal(fieldCommitted(e), true); // changed blur: one commit
    assert.equal(fieldCommitted(e), false); // marker consumed
    assert.equal(fieldCommitted({ target: { value: 'x', dataset: {} } }), false); // never focused: no event
  });

  it('strips smuggled values from field-commit payloads', ()=>{
    setConsent(true, { sessionTimings: true });
    recordEvent('load-field-commit', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', weightKg: '25', reps: '9' });
    const [evt] = getEventHistory();
    assert.equal('weightKg' in evt, false);
    assert.equal('reps' in evt, false);
    assert.equal(evt.exerciseId, 'e1');
  });
});

describe('legacy telemetry degrades safely', ()=>{
  it('aggregates old names into the same buckets with null timings', ()=>{
    const events = [
      { type: 'session:start', sessionId: 'old', at: '2026-01-01T10:00:00.000Z' },
      { type: 'set:complete', sessionId: 'old', exerciseId: 'e1', setIndex: 0, at: '2026-01-01T10:05:00.000Z' },
      { type: 'set:uncomplete', sessionId: 'old', exerciseId: 'e1', setIndex: 0 },
      { type: 'set:removed', sessionId: 'old', exerciseId: 'e1', setIndex: 1, kind: 'prescribed' },
      { type: 'exercise:swapped', sessionId: 'old', from: 'e1', to: 'e2' },
      { type: 'recommendation:accepted', sessionId: 'old', exerciseId: 'e1', via: 'apply-all' },
    ];
    const s = loggingFrictionStats(events);
    assert.equal(s.completedSets, 1);
    assert.equal(s.undos, 1);
    assert.equal(s.removedSets, 1);
    assert.equal(s.swap.commits, 1);
    assert.equal(s.applyAll.viaApplyAll, 1);
    assert.equal(s.degraded, true);
    assert.equal(s.loggingMsMedian, null);
    assert.equal(s.startToFirstSetMs, null);
  });
});
