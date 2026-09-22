// ai-coach-routing.integration.test.js — proves the user-facing AI coach
// workflow routes through the classifier while the fitness engine stays
// fully independent of any cloud/network code.
//
// Contract under test:
//   deterministic intent rules -> classifier.dev semantic fallback -> existing
//   coach system. The classifier (routeCoachRequest) is the only cloud path,
//   and only when the user has explicitly opted in. The deterministic fitness
//   engine modules never import it.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiCoachRoute, COACH_FEEDBACK_URL } from '../src/lib/aiCoach.js';
import {
  isCoachRoutingEnabled, saveCoachRoutingSettings,
  clearClassifierSettings,
} from '../src/lib/feedbackClassifier.js';

class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}

function withStorage(fn){
  const prev = globalThis.localStorage;
  globalThis.localStorage = new MemoryStorage();
  try{ return fn(globalThis.localStorage); }finally{ globalThis.localStorage = prev; }
}
function cloudFetch(label, confidence = 0.92){
  return async () => ({
    ok: true,
    json: async () => ({ results: [{ label, confidence, scores: { [label]: confidence } }] }),
  });
}

describe('aiCoachRoute uses the classifier only as semantic fallback', () => {
  it('deterministic keyword rules fire without any network call', async () => {
    let called = false;
    const res = await aiCoachRoute('how should I progress my squat', {
      fetchImpl: () => { called = true; return {}; },
    });
    assert.equal(called, false);
    assert.equal(res.source, 'deterministic-keyword');
    assert.equal(res.classified, false);
    assert.equal(res.lane, 'local-engine');
  });

  it('feedback-or-bug intent is routed to the feedback pipeline by keywords', async () => {
    const res = await aiCoachRoute('the app crashes when I export my backup', {
      fetchImpl: () => { throw new Error('must not fetch'); },
    });
    assert.equal(res.lane, 'feedback-pipeline');
    assert.equal(res.source, 'deterministic-keyword');
  });

  it('production router resolves the training, feedback, and explanation examples locally', async () => {
    const cases = [
      ['Can I add another set?', 'local-engine'],
      ['Should I add weight?', 'local-engine'],
      ['What exercise should I add?', 'local-engine'],
      ['Can I increase my reps?', 'local-engine'],
      ['Please add a new exercise', 'feedback-pipeline'],
      ['Feature request: add dark-mode scheduling', 'feedback-pipeline'],
      ['The app crashes when I export', 'feedback-pipeline'],
      ['Could you summarise my last week?', 'coach-cloud'],
    ];
    let calls = 0;
    for(const [prompt, lane] of cases){
      const result = await aiCoachRoute(prompt, {
        fetchImpl: () => { calls += 1; throw new Error('deterministic prompts must not fetch'); },
      });
      assert.equal(result.lane, lane, prompt);
      assert.equal(result.prescription, undefined, prompt);
    }
    assert.equal(calls, 0);
  });

  it('classifier.dev is consulted only when keywords are silent (and not opted in)', async () => {
    const ls = new MemoryStorage();
    const prev = globalThis.localStorage;
    globalThis.localStorage = ls;
    try{
      let called = false;
      const res = await aiCoachRoute('the sky is blue', {
        fetchImpl: () => { called = true; return cloudFetch('other', 0.95)(); },
      });
      // Without opt-in, routeCoachRequest resolves locally and never fetches.
      assert.equal(called, false);
      assert.equal(res.lane, 'clarify');
      assert.equal(res.source, 'deterministic-keyword');
    }finally{ globalThis.localStorage = prev; }
  });

  it('when opted in, classifier.dev is consulted for an ambiguous prompt', async () => {
    const ls = new MemoryStorage();
    const prev = globalThis.localStorage;
    globalThis.localStorage = ls;
    try{
      saveCoachRoutingSettings({ enabled: true });
      assert.equal(isCoachRoutingEnabled(), true);
      let called = false;
      const res = await aiCoachRoute('the sky is blue', {
        fetchImpl: () => { called = true; return cloudFetch('other', 0.95)(); },
      });
      assert.equal(called, true);
      assert.equal(res.classified, true);
      assert.equal(res.lane, 'clarify');
      assert.equal(res.source, 'cloud');
    }finally{
      globalThis.localStorage = prev;
      clearClassifierSettings();
    }
  });

  it('cloud training-question routes to the deterministic engine lane, not a prescription', async () => {
    const ls = new MemoryStorage();
    const prev = globalThis.localStorage;
    globalThis.localStorage = ls;
    try{
      saveCoachRoutingSettings({ enabled: true });
      // This prompt is intentionally unresolved locally so the opted-in cloud
      // fallback can label it as a training question. The engine still owns
      // prescriptions after the lane is selected.
      const res = await aiCoachRoute('please interpret this request', {
        fetchImpl: () => cloudFetch('training-question', 0.95)(),
      });
      assert.equal(res.classified, true);
      assert.equal(res.lane, 'local-engine');
      // The router never returns a prescription — only a lane + provenance.
      assert.equal(res.prescription, undefined);
      assert.equal(res.label, 'training-question');
    }finally{
      globalThis.localStorage = prev;
      clearClassifierSettings();
    }
  });

  it('cloud failure falls back to clarify, never throws', async () => {
    const ls = new MemoryStorage();
    const prev = globalThis.localStorage;
    globalThis.localStorage = ls;
    try{
      saveCoachRoutingSettings({ enabled: true });
      const res = await aiCoachRoute('a thing i cannot name', {
        fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
      });
      assert.equal(res.lane, 'clarify');
      assert.equal(res.source, 'fallback-other');
    }finally{
      globalThis.localStorage = prev;
      clearClassifierSettings();
    }
  });

  it('exposes a constant feedback URL for the feedback-pipeline lane', () => {
    assert.ok(typeof COACH_FEEDBACK_URL === 'string');
    assert.match(COACH_FEEDBACK_URL, /^https:\/\/github\.com\//);
  });
});

describe('fitness engine modules never depend on the classifier', () => {
  const ENGINE_MODULES = [
    'src/lib/readinessClassifier.js',
    'src/lib/trainRecommendation.js',
    'src/lib/sessionGenerator.js',
    'src/lib/progression.js',
    'src/lib/substitutions.js',
    'src/lib/safety.js',
    'src/lib/progressionModel.js',
    'src/lib/programming.js',
    'src/lib/mesocycle.js',
  ];
  const BANNED = /feedbackClassifier|classifier\.dev|routeCoachRequest|aiCoachRoute|\bfetch\s*\(/;
  for(const mod of ENGINE_MODULES){
    it(`${mod} is free of classifier/cloud coupling`, () => {
      const text = readFileSync(new URL(`../${mod}`, import.meta.url), 'utf8');
      assert.ok(!BANNED.test(text), `${mod} must not couple to the classifier or fetch`);
    });
  }
});
