import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderWeeklyReviewMarkdown } from '../src/lib/weeklyReviewExport.js';

describe('weekly review Markdown export', () => {
  it('renders the review basis, metrics, narrative and queued changes', () => {
    const text = renderWeeklyReviewMarkdown({
      weekKey: '2026-09-14',
      weekNumber: 3,
      completion: { done: 2, total: 3 },
      strength: 2.5,
      volume: -8,
      readiness: 74,
      prs: 1,
      narrative: ['Improved: Bench press (+3%)'],
      changes: [{ summary: 'Bench press: sets → 4', reason: 'Repeated successful exposures.' }],
    });

    assert.match(text, /Week of 2026-09-14 · programme week 3/);
    assert.match(text, /Completion: 2\/3/);
    assert.match(text, /Strength change: \+2.5%/);
    assert.match(text, /Volume change: -8%/);
    assert.match(text, /Improved: Bench press/);
    assert.match(text, /Why: Repeated successful exposures/);
  });

  it('states when no structural changes are queued', () => {
    const text = renderWeeklyReviewMarkdown({ weekKey: '2026-09-14' });
    assert.match(text, /No structural changes queued/);
  });

  it('marks a deload explicitly', () => {
    const text = renderWeeklyReviewMarkdown({ weekKey: '2026-09-14', deload: true });
    assert.match(text, /Next week: deload/);
  });
});
