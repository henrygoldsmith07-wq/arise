import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractNoteRecommendations } from '../src/lib/analytics.js';

describe('note recommendation extraction', () => {
  it('recognises loads written in kilograms or pounds', () => {
    const rows = extractNoteRecommendations([
      { dateISO: '2026-09-01', note: 'Next time try 22.5 kg' },
      { dateISO: '2026-09-02', note: 'Next time try 50 lb' },
    ]);
    assert.deepEqual(rows.map(r => r.hints[0]), ['suggested load 22.5 kg', 'suggested load 50 lb']);
  });

  it('uses structured form-focus tags even without free text', () => {
    const rows = extractNoteRecommendations([
      { dateISO: '2026-09-03', noteTags: ['form-focus'] },
    ]);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].hints.includes('form focus noted'));
  });
});
