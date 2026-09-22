// feedbackClassifier.test.js — conservative classifier.dev adapter tests.
// Proves: opt-in gating, redaction, thresholds, timeout/failure fallback,
// and that deterministic training systems never touch the network.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}
globalThis.localStorage = new MemoryStorage();
const M = await import('../src/lib/feedbackClassifier.js');
beforeEach(() => { globalThis.localStorage = new MemoryStorage(); });
function enable(){ M.saveFeedbackClassifierSettings({ enabled: true }); }
function cloudFetch(label, confidence = 0.92){
  return async () => ({ ok: true, json: async () => ({ results: [{ label, confidence, scores: { [label]: confidence } }] }) });
}
describe('classifier settings default off', () => {
  it('disabled by default and round-trips', () => {
    assert.equal(M.isClassifierEnabled(), false);
    assert.deepEqual(M.getClassifierSettings(), { enabled: false });
    assert.deepEqual(M.getClassifierConsentSettings(), { feedbackEnabled: false, coachRoutingEnabled: false });
    assert.equal(M.saveClassifierSettings({ enabled: true }), true);
    assert.equal(M.isClassifierEnabled(), true);
    assert.equal(M.isCoachRoutingEnabled(), false);
    assert.equal(M.saveCoachRoutingSettings({ enabled: true }), true);
    assert.equal(M.isClassifierEnabled(), true);
    assert.equal(M.isCoachRoutingEnabled(), true);
    M.clearClassifierSettings();
    assert.equal(M.isClassifierEnabled(), false);
    assert.equal(M.isCoachRoutingEnabled(), false);
  });
  it('legacy feedback consent never grants new coach-routing consent', () => {
    globalThis.localStorage.setItem(M.CLASSIFIER_SETTINGS_KEY, JSON.stringify({ enabled: true }));
    assert.equal(M.isFeedbackClassifierEnabled(), true);
    assert.equal(M.isCoachRoutingEnabled(), false);
  });
});
describe('redaction and taxonomy', () => {
  it('redacts emails phones secrets and truncates', () => {
    const out = M.redactTextForClassification('Contact me at sam@example.com or +1 555 123 4567 api-key: SECRET bear xyz');
    assert.ok(!out.includes('sam@example.com'));
    assert.ok(!out.includes('SECRET'));
    assert.ok(out.length <= M.MAX_INPUT_CHARS);
  });
  it('taxonomy pins the required labels with other last', () => {
    assert.deepEqual([...M.FEEDBACK_LABELS], ['bug', 'exercise-request', 'program-request', 'usability', 'content-error', 'accessibility', 'performance', 'import-data', 'other']);
    assert.equal(M.FEEDBACK_LABELS[M.FEEDBACK_LABELS.length - 1], 'other');
  });
});
describe('opt-in gating and local fallback', () => {
  it('disabled path never fetches and uses local keywords', async () => {
    let called = false;
    const r = await M.classifyText('The app crashes on export', { fetchImpl: () => { called = true; return {}; } });
    assert.equal(called, false);
    assert.equal(r.cloudAttempted, false);
    assert.equal(r.label, 'bug');
    assert.equal(r.source, 'local-keywords');
    assert.equal(r.needsReview, true);
  });
  it('empty text collapses to other without network', async () => {
    enable();
    let called = false;
    const r = await M.classifyText('   ', { fetchImpl: () => { called = true; return {}; } });
    assert.equal(called, false);
    assert.equal(r.label, 'other');
  });
});
describe('cloud path thresholds and failures', () => {
  it('high confidence cloud label passes through', async () => {
    enable();
    const r = await M.classifyText('crash on save', { fetchImpl: cloudFetch('bug', 0.95) });
    assert.equal(r.label, 'bug');
    assert.equal(r.source, 'cloud');
    assert.equal(r.needsReview, false);
  });
  it('keeps the category for the review band', async () => {
    enable();
    const review = await M.classifyText('unclear button', { fetchImpl: cloudFetch('usability', 0.79) });
    assert.equal(review.label, 'usability');
    assert.equal(review.needsReview, true);
    const boundary = await M.classifyText('unclear button', { fetchImpl: cloudFetch('usability', 0.6) });
    assert.equal(boundary.label, 'usability');
    assert.equal(boundary.needsReview, true);
  });
  it('low confidence collapses to other', async () => {
    enable();
    const r = await M.classifyText('weird thing', { fetchImpl: cloudFetch('usability', 0.2) });
    assert.equal(r.label, 'other');
    assert.equal(r.needsReview, true);
  });
  it('sends semantic descriptions and maps them back to stable ids', async () => {
    enable();
    let sent = null;
    const description = M.FEEDBACK_LABEL_DESCRIPTIONS['exercise-request'];
    const r = await M.classifyFeedback('please add a movement', {
      fetchImpl: async (url, options) => {
        sent = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            results: [{
              label: description,
              confidence: 0.86,
              scores: { [description]: 0.86, unknown: 99, other: 'bad' },
            }],
          }),
        };
      },
    });
    assert.deepEqual(sent.labels, M.FEEDBACK_LABELS.map((label) => M.FEEDBACK_LABEL_DESCRIPTIONS[label]));
    assert.equal(r.label, 'exercise-request');
    assert.deepEqual(r.scores, { 'exercise-request': 0.86 });
  });
  it('rejects malformed responses and non-finite scores', async () => {
    enable();
    const malformed = await M.classifyText('unclear thing', {
      fetchImpl: async () => ({ ok: true, json: async () => ({ results: [{ nope: true }] }) }),
    });
    assert.equal(malformed.label, 'other');
    assert.equal(malformed.needsReview, true);

    const finiteOnly = await M.classifyText('unclear thing', {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ results: [{ label: 'usability', confidence: 0.9, scores: { usability: 0.9, bug: Infinity, unknown: 4 } }] }),
      }),
    });
    assert.deepEqual(finiteOnly.scores, { usability: 0.9 });
  });
  it('redacts and truncates dynamic instructions', async () => {
    enable();
    let sent = null;
    await M.classifyFeedback('broken export', {
      instructions: 'Contact sam@example.com token: SECRET ' + 'x'.repeat(1000),
      fetchImpl: async (url, options) => {
        sent = JSON.parse(options.body);
        return { ok: true, json: async () => ({ results: [{ label: 'bug', confidence: 0.9 }] }) };
      },
    });
    assert.ok(sent.instructions.length <= M.MAX_INPUT_CHARS);
    assert.ok(!sent.instructions.includes('sam@example.com'));
    assert.ok(!sent.instructions.includes('SECRET'));
  });
  it('http error and throw fall back to other', async () => {
    enable();
    const e500 = await M.classifyText('x', { fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }) });
    assert.equal(e500.label, 'other');
    assert.match(e500.error, /500/);
    const threw = await M.classifyText('x', { fetchImpl: async () => { throw new Error('down'); } });
    assert.equal(threw.label, 'other');
    assert.equal(threw.source, 'fallback-other');
  });
  it('timeout falls back to other', async () => {
    enable();
    const r = await M.classifyText('hello', { timeoutMs: 5, fetchImpl: (u, o) => new Promise((res, rej) => o.signal.addEventListener('abort', () => { const e = new Error('x'); e.name = 'AbortError'; rej(e); })) });
    assert.equal(r.label, 'other');
    assert.match(r.error, /timed out/);
  });
  it('never sends raw sensitive text', async () => {
    enable();
    let sent = null;
    const fetchImpl = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ results: [{ label: 'bug', confidence: 0.9 }] }) }; };
    await M.classifyText('mail me at sam@example.com please fix crash', { fetchImpl });
    assert.equal(sent.inputs.length, 1);
    assert.ok(!sent.inputs[0].includes('sam@example.com'));
    assert.ok(sent.inputs[0].includes('[redacted-email]'));
  });
  it('batch keeps order and per-item fallback', async () => {
    enable();
    const fetchImpl = async (u, o) => { const b = JSON.parse(o.body); return { ok: true, json: async () => ({ results: b.inputs.map((t, i) => ({ label: i === 0 ? 'bug' : 'usability', confidence: i === 0 ? 0.95 : 0.1 })) }) }; };
    const out = await M.classifyFeedbackBatch(['crash now', 'meh'], { fetchImpl });
    assert.equal(out.results.length, 2);
    assert.equal(out.results[0].label, 'bug');
    assert.equal(out.results[1].label, 'other');
  });
  it('batch skips empty items and preserves non-empty output order', async () => {
    enable();
    let sent = null;
    const out = await M.classifyFeedbackBatch(['  ', 'crash now', '', 'button confusing'], {
      fetchImpl: async (url, options) => {
        sent = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            results: [
              { label: 'bug', confidence: 0.9 },
              { label: 'usability', confidence: 0.9 },
            ],
          }),
        };
      },
    });
    assert.deepEqual(sent.inputs, ['crash now', 'button confusing']);
    assert.equal(sent.inputs.includes('(empty)'), false);
    assert.equal(out.results[0].label, 'other');
    assert.equal(out.results[0].cloudAttempted, false);
    assert.equal(out.results[0].needsReview, true);
    assert.equal(out.results[1].label, 'bug');
    assert.equal(out.results[2].label, 'other');
    assert.equal(out.results[2].cloudAttempted, false);
    assert.equal(out.results[3].label, 'usability');
  });
  it('coach routing returns lanes not prescriptions', async () => {
    M.saveCoachRoutingSettings({ enabled: true });
    const q = await M.routeCoachRequest('how should I progress my squat', { fetchImpl: cloudFetch('training-question', 0.95) });
    assert.equal(q.route, 'local-engine');
    const b = await M.routeCoachRequest('app crashed', { fetchImpl: cloudFetch('feedback-or-bug', 0.95) });
    assert.equal(b.route, 'feedback-pipeline');
    const uncertain = await M.routeCoachRequest('maybe this is a training question', { fetchImpl: cloudFetch('training-question', 0.7) });
    assert.equal(uncertain.label, 'training-question');
    assert.equal(uncertain.needsReview, true);
    assert.equal(uncertain.route, 'clarify');
    const o = await M.routeCoachRequest('the sky is blue', { fetchImpl: cloudFetch('other', 0.95) });
    assert.equal(o.route, 'clarify');
  });
  it('coach routing is local-first and tightens add/missing intent', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({ results: [{ label: 'feedback-or-bug', confidence: 0.99 }] }) }; };
    assert.equal((await M.routeCoachRequest('Can I add another set?', { fetchImpl })).route, 'local-engine');
    assert.equal((await M.routeCoachRequest('Should I add weight?', { fetchImpl })).route, 'local-engine');
    assert.equal((await M.routeCoachRequest('What exercise should I add?', { fetchImpl })).route, 'local-engine');
    assert.equal((await M.routeCoachRequest('Please add a new exercise', { fetchImpl })).route, 'feedback-pipeline');
    assert.equal(called, false);
    M.saveCoachRoutingSettings({ enabled: true });
    const ambiguous = await M.routeCoachRequest('maybe this is a training question', { fetchImpl: cloudFetch('training-question', 0.7) });
    assert.equal(ambiguous.route, 'clarify');
    assert.equal(ambiguous.needsReview, true);
  });
  it('separate consents gate only their own cloud path', async () => {
    let feedbackCalls = 0;
    let coachCalls = 0;
    const feedbackFetch = async () => { feedbackCalls += 1; return { ok: true, json: async () => ({ results: [{ label: 'bug', confidence: 0.95 }] }) }; };
    const coachFetch = async () => { coachCalls += 1; return { ok: true, json: async () => ({ results: [{ label: 'training-question', confidence: 0.95 }] }) }; };
    M.saveCoachRoutingSettings({ enabled: true });
    await M.classifyFeedback('unrecognised feedback', { fetchImpl: feedbackFetch });
    assert.equal(feedbackCalls, 0);
    await M.routeCoachRequest('maybe ambiguous', { fetchImpl: coachFetch });
    assert.equal(coachCalls, 1);
    M.clearClassifierSettings();
    M.saveFeedbackClassifierSettings({ enabled: true });
    await M.routeCoachRequest('maybe ambiguous again', { fetchImpl: coachFetch });
    assert.equal(coachCalls, 1);
    await M.classifyFeedback('unrecognised feedback', { fetchImpl: feedbackFetch });
    assert.equal(feedbackCalls, 1);
  });
});
