// Friction-validation tests: the executable baseline artifact, regression
// thresholds, timing-consent gating, value-free telemetry, and the real-user
// measurement mapping. Nothing here asserts wall-clock human performance.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadBaselines, validateBaselines, deriveMetric, checkLive, formatReport,
} from '../benchmark/friction-baselines.js';

class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}
globalThis.localStorage = new MemoryStorage();

const { KEY: STORE_KEY } = await import('../src/lib/store.js');
const { recordEvent, getEventHistory, loggingFrictionStats } = await import('../src/lib/telemetry.js');

function setConsent(enabled, options = {}){
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    version: 9,
    preferences: { telemetryEnabled: enabled, telemetryOptions: options },
  }));
}
beforeEach(()=> { globalThis.localStorage = new MemoryStorage(); });

const ROOT = path.resolve(import.meta.dirname, '..');
const VALUE_KEYS = ['target', 'suggestedTarget', 'load', 'loadKg', 'reps', 'repTarget', 'rir', 'assistKg', 'assistedKg', 'weightKg', 'weight'];

describe('baseline artifact is executable source data', ()=>{
  it('the shipped docs/friction-baseline.json validates clean', ()=>{
    const doc = loadBaselines();
    assert.ok(Object.keys(doc.flows).length >= 4);
    assert.ok(doc.layers.synthetic && doc.layers.observed && doc.layers.conclusion);
  });

  it('tampered derived statistics fail loudly', ()=>{
    const doc = loadBaselines();
    const tampered = (flow, metric, patch)=>{
      const copy = structuredClone(doc);
      Object.assign(copy.flows[flow].metrics[metric], patch);
      return copy;
    };
    assert.throws(()=> validateBaselines(tampered('standard-two-set', 'inputFocus', { deltaAbs: -2 })), /deltaAbs/);
    assert.throws(()=> validateBaselines(tampered('standard-two-set', 'inputFocus', { deltaPct: -99 })), /deltaPct/);
    assert.throws(()=> validateBaselines(tampered('standard-two-set', 'inputFocus', { direction: 'regression' })), /direction/);
    assert.throws(()=> validateBaselines(tampered('guided-two-step', 'loadCommits', { direction: 'held' })), /direction/);
  });

  it('malformed documents fail with clear errors, never silent defaults', ()=>{
    const doc = loadBaselines();
    assert.throws(()=> validateBaselines(null), /must be an object/);
    assert.throws(()=> validateBaselines({}), /flows/);
    const noFlows = structuredClone(doc); delete noFlows.flows['guided-two-step'].metrics;
    assert.throws(()=> validateBaselines(noFlows), /metrics/);
    const badNum = structuredClone(doc); badNum.flows['gym-two-set'].metrics.inputFocus.baseline = 'four';
    assert.throws(()=> validateBaselines(badNum), /finite number or null/);
    const noCurrent = structuredClone(doc); delete noCurrent.flows['gym-two-set'].metrics.inputFocus.current;
    assert.throws(()=> validateBaselines(noCurrent), /finite number/);
    // A null baseline with invented deltas is malformed, not "new".
    const fakeNew = structuredClone(doc);
    fakeNew.flows['swap-resume'].metrics.swapOpens = { baseline: null, current: 1, deltaAbs: 0, deltaPct: 0, direction: 'held', maxAllowed: 1 };
    assert.throws(()=> validateBaselines(fakeNew), /deltaAbs/);
  });

  it('deriveMetric handles first-measured and zero baselines without inventing numbers', ()=>{
    assert.deepEqual(deriveMetric(null, 3), { deltaAbs: null, deltaPct: null, direction: 'new' });
    assert.deepEqual(deriveMetric(0, 0), { deltaAbs: 0, deltaPct: null, direction: 'held' });
    assert.deepEqual(deriveMetric(8, 7), { deltaAbs: -1, deltaPct: -12, direction: 'improvement' });
    assert.deepEqual(deriveMetric(2, 3), { deltaAbs: 1, deltaPct: 50, direction: 'regression' });
  });
});

describe('regression thresholds on live probe results', ()=>{
  it('live values within guardrails pass and report derives from validated claims', ()=>{
    const doc = loadBaselines();
    const report = checkLive(doc, 'standard-two-set', { inputFocus: 3, focusin: 7, loadCommits: 1, rirCommits: 1, completes: 2 });
    assert.equal(report.flow, 'standard-two-set');
    assert.equal(report.metrics.inputFocus.direction, 'improvement');
    const text = formatReport(report);
    assert.match(text, /inputFocus: baseline=4 current=3 delta=-1 \(-25%\) improvement/);
  });

  it('regressions past maxAllowed fail CI loudly', ()=>{
    const doc = loadBaselines();
    assert.throws(
      ()=> checkLive(doc, 'standard-two-set', { inputFocus: 4, focusin: 8, loadCommits: 1, rirCommits: 2, completes: 2 }),
      /inputFocus.*exceeds maxAllowed 3/,
    );
    assert.throws(
      ()=> checkLive(doc, 'guided-two-step', { inputFocus: 1, focusin: 6, loadCommits: 2, completes: 2 }),
      /loadCommits.*exceeds maxAllowed 1/,
    );
  });

  it('completions below minAllowed fail (a flow that logs less proves nothing)', ()=>{
    const doc = loadBaselines();
    assert.throws(
      ()=> checkLive(doc, 'guided-two-step', { inputFocus: 1, focusin: 6, loadCommits: 1, rirCommits: 0, completes: 1 }),
      /below minAllowed 2/,
    );
  });

  it('stale and unbaselined metrics fail instead of drifting silently', ()=>{
    const doc = loadBaselines();
    assert.throws(
      ()=> checkLive(doc, 'standard-two-set', { inputFocus: 3, focusin: 7, loadCommits: 1, rirCommits: 1, completes: 2, brandNewMetric: 1 }),
      /unbaselined live metric/,
    );
    assert.throws(
      ()=> checkLive(doc, 'standard-two-set', { inputFocus: 3, focusin: 7, loadCommits: 1, completes: 2 }),
      /stale entry.*rirCommits/,
    );
    assert.throws(()=> checkLive(doc, 'no-such-flow', {}), /unknown flow/);
  });
});

describe('timing consent disabled degrades measurement without losing counts', ()=>{
  it('durations are stripped at write; actions still aggregate; timings degrade to null', ()=>{
    setConsent(true, {}); // master consent on, sessionTimings off
    recordEvent('session:start', { sessionId: 's1' });
    recordEvent('complete-set', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', elapsedMs: 4000, sessionElapsedMs: 90000 });
    recordEvent('swap-commit', { sessionId: 's1', from: 'e1', to: 'e2', mode: 'gym', elapsedMs: 12000 });
    recordEvent('session:save', { sessionId: 's1', blocks: 3, durationMs: 37 });
    const events = getEventHistory();
    assert.equal(events.length, 4);
    for(const e of events){
      assert.equal('elapsedMs' in e, false, `${e.type} must not persist elapsedMs without timing consent`);
      assert.equal('durationMs' in e, false, `${e.type} must not persist durationMs without timing consent`);
      assert.equal('sessionElapsedMs' in e, false);
    }
    const s = loggingFrictionStats(events);
    assert.equal(s.completedSets, 1);
    assert.equal(s.swap.commits, 1);
    assert.equal(s.degraded, true, 'no invented times — medians stay null');
    assert.equal(s.loggingMsMedian, null);
    assert.equal(s.startToFirstSetMs, null);
  });
});

describe('telemetry stays workout-content free across all logging event types', ()=>{
  it('smuggled loads, reps, RIR and targets are stripped at write', ()=>{
    setConsent(true, { sessionTimings: true });
    const smuggled = { load: 22.5, reps: 9, rir: 2, weightKg: '22.5', target: '9 reps @ 22.5kg', suggestedTarget: 'x', assistKg: '0' };
    recordEvent('complete-set', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', ...smuggled });
    recordEvent('rir-suggestion-shown', { sessionId: 's1', exerciseId: 'e1', setIndex: 1, mode: 'gym', ...smuggled });
    recordEvent('rir-suggestion-confirmed', { sessionId: 's1', exerciseId: 'e1', setIndex: 1, mode: 'gym', ...smuggled });
    recordEvent('load-field-commit', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', ...smuggled });
    recordEvent('swap-open', { sessionId: 's1', exerciseId: 'e1', mode: 'gym', ...smuggled });
    recordEvent('swap-commit', { sessionId: 's1', from: 'e1', to: 'e2', mode: 'gym', ...smuggled });
    recordEvent('apply-all', { sessionId: 's1', exerciseId: 'e1', mode: 'gym', ...smuggled });
    recordEvent('add-set', { sessionId: 's1', exerciseId: 'e1', mode: 'gym', ...smuggled });
    const events = getEventHistory();
    assert.equal(events.length, 8);
    for(const e of events){
      for(const k of VALUE_KEYS) assert.equal(k in e, false, `${e.type} must not persist .${k}`);
    }
    // ...but the value-free facts (ids, modes, action types) survive intact.
    const kinds = events.map(e=> e.type).sort();
    assert.deepEqual(kinds, ['add-set', 'apply-all', 'complete-set', 'load-field-commit', 'rir-suggestion-confirmed', 'rir-suggestion-shown', 'swap-commit', 'swap-open']);
  });
});

describe('real-user measurement mapping (synthetic → observed → conclusion)', ()=>{
  const t0 = '2026-03-01T10:00:00.000Z';
  const at = (ms)=> new Date(Date.parse(t0) + ms).toISOString();
  function syntheticSession(){
    return [
      { type: 'session:start', sessionId: 's1', at: t0 },
      { type: 'complete-set', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', elapsedMs: 5000, at: at(90000) },
      { type: 'undo-set', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', at: at(95000) },
      { type: 'complete-set', sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', elapsedMs: 7000, at: at(160000) },
      { type: 'swap-open', sessionId: 's1', exerciseId: 'e1', mode: 'gym', at: at(170000) },
      { type: 'swap-commit', sessionId: 's1', from: 'e1', to: 'e2', mode: 'gym', elapsedMs: 9000, at: at(180000) },
      { type: 'apply-all', sessionId: 's1', exerciseId: 'e2', mode: 'gym', at: at(190000) },
      { type: 'session:save', sessionId: 's1', durationMs: 40, at: at(200000) },
    ];
  }
  it('one aggregate exposes every listed measurement, segmented by mode', ()=>{
    const s = loggingFrictionStats(syntheticSession());
    assert.equal(s.completionEvents, 2); // both completion actions count
    assert.equal(s.completedSets, 1); // ...but the undone-then-redone set is one net set
    assert.equal(s.actionsPerCompletedSet, 6); // 6 actions / 1 net set: corrections raise friction, never work
    assert.equal(s.correctionsPerSession, 1);
    assert.equal(s.startToFirstSetMs, 90000);
    assert.equal(s.loggingMsMedian, 6000); // set-to-set interval
    assert.deepEqual([s.swap.opens, s.swap.commits, s.swap.msMedian], [1, 1, 9000]);
    assert.equal(s.applyAll.viaApplyAll, 1);
    assert.equal(s.byMode.gym.completedSets, 1);
    assert.equal(s.byMode.standard.completedSets, 0);
    assert.equal(s.byMode.guided.completedSets, 0);
    assert.equal(s.saveMsMedian, 40);
  });
  it('apply-previous usage is honestly zero until a control emits it', ()=>{
    const s = loggingFrictionStats(syntheticSession());
    assert.deepEqual(s.applyPrevious, { count: 0 });
  });
});
