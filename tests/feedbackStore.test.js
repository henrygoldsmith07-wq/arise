import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(key){ return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value){ this.map.set(key, String(value)); }
  removeItem(key){ this.map.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
const M = await import('../src/lib/feedbackStore.js');

beforeEach(() => { globalThis.localStorage = new MemoryStorage(); });

describe('local feedback metadata store', () => {
  it('stores redacted text and structured metadata only', () => {
    const record = M.buildFeedbackRecord({
      text: 'Email sam@example.com; token: SECRET; the export is broken',
      submittedAt: '2026-09-21T12:00:00.000Z',
      classification: {
        label: 'bug',
        confidence: 0.82,
        needsReview: false,
        source: 'cloud',
        cloudAttempted: true,
        classifiedAt: '2026-09-21T12:00:01.000Z',
        taxonomyVersion: 1,
        scores: { bug: 0.82 },
        response: { raw: 'must not persist' },
      },
    });
    assert.ok(!record.redactedText.includes('sam@example.com'));
    assert.ok(!record.redactedText.includes('SECRET'));
    assert.equal(record.category, 'bug');
    assert.equal(record.confidence, 0.82);
    assert.equal(record.needsReview, false);
    assert.equal(record.source, 'cloud');
    assert.equal(record.classifiedAt, '2026-09-21T12:00:01.000Z');
    assert.equal(record.taxonomyVersion, 1);
    assert.equal('scores' in record, false);
    assert.equal('response' in record, false);
    assert.equal(M.saveFeedbackRecord({ ...record, scores: { bug: 0.82 }, response: { raw: 'must not persist' } }), true);
    assert.deepEqual(M.loadFeedbackRecords(), [record]);
  });

  it('marks an operator review without changing the classifier metadata', () => {
    const record = M.buildFeedbackRecord({
      text: 'unclear button',
      classification: { label: 'usability', confidence: 0.64, needsReview: true, source: 'cloud' },
    });
    M.saveFeedbackRecord(record);
    assert.equal(M.markFeedbackReviewed(record.id, '2026-09-21T12:01:00.000Z'), true);
    const [reviewed] = M.loadFeedbackRecords();
    assert.equal(reviewed.reviewedAt, '2026-09-21T12:01:00.000Z');
    assert.equal(reviewed.needsReview, true);
    assert.equal(reviewed.category, 'usability');
  });
});
