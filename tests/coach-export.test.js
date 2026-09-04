// Coach export tests: aggregation correctness, section gating, markdown
// rendering, and the privacy properties that make it shareable (no device id,
// no study id, no credentials, readiness only when explicitly ticked).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCoachExport, renderCoachMarkdown, exerciseSummaries, weeklyVolume } from '../src/lib/coachExport.js';
import { buildPartialExportPayload, parseImportFile } from '../src/lib/export.js';

function sess(id, dateISO, blocks){ return { id, dateISO, blocks }; }
const set = (reps, kg) => ({ reps: String(reps), weightKg: String(kg) });

const store = {
  version: 9,
  preferences: { units: 'kg', sync: { url: 'https://secret', password: 'TOPSECRET' } },
  history: [
    sess('s-1', '2026-01-05', [{ exerciseId: 'bench-press', sets: [set(5, 80), set(5, 80), set(5, 82.5)] }]),
    sess('s-2', '2026-01-08', [{ exerciseId: 'deadlift', sets: [set(5, 120)] }]),
    sess('s-3', '2026-01-12', [{ exerciseId: 'bench-press', sets: [set(5, 85)] }]),
  ],
  readinessLog: [
    { dateISO: '2026-01-05', score: 72 },
    { dateISO: '2026-01-12', score: 81 },
    { dateISO: '2026-01-13', score: 'bad' },
  ],
  tombstones: [],
};

describe('aggregation', () => {
  it('exerciseSummaries computes best sets and volume per exercise', () => {
    const rows = exerciseSummaries(store.history);
    const bench = rows.find((r) => r.exerciseId === 'bench-press');
    assert.equal(bench.sessions, 2);
    assert.equal(bench.topSetKg, 85);
    assert.equal(bench.topReps, 5);
    assert.equal(bench.volumeKg, Math.round(80*5 + 80*5 + 82.5*5 + 85*5)); // volume is reported in whole kg
    assert.equal(rows[0].exerciseId, 'bench-press'); // sorted by volume
  });

  it('sinceISO limits the window', () => {
    const rows = exerciseSummaries(store.history, { sinceISO: '2026-01-10' });
    assert.deepEqual(rows.map((r) => r.exerciseId), ['bench-press']);
  });

  it('weeklyVolume buckets Monday-based weeks, oldest last', () => {
    const weeks = weeklyVolume(store.history, { weeks: 8 });
    // 2026-01-05 (Mon), 2026-01-08 (Thu → same week), 2026-01-12 (Mon)
    assert.equal(weeks.length, 2);
    assert.equal(weeks[0].weekStart, '2026-01-05');
    assert.equal(weeks[0].sessions, 2);
    assert.equal(weeks[1].weekStart, '2026-01-12');
  });
});

describe('section gating', () => {
  it('default export carries summary + no sensitive sections', () => {
    const data = buildCoachExport(store, { sections: {} });
    assert.ok(data.summary);
    assert.equal(data.exercises, undefined);
    assert.equal(data.readiness, undefined);
    assert.equal(data.sessions, undefined);
  });

  it('readiness only travels when explicitly ticked, scores only', () => {
    const data = buildCoachExport(store, { sections: { readiness: true } });
    assert.deepEqual(data.readiness, [
      { dateISO: '2026-01-05', score: 72 },
      { dateISO: '2026-01-12', score: 81 },
    ]);
  });

  it('full detail includes per-session sets only when ticked', () => {
    const data = buildCoachExport(store, { sections: { detail: true } });
    assert.equal(data.sessions.length, 3);
    assert.equal(data.sessions[0].blocks[0].sets[0].reps, '5');
  });
});

describe('privacy properties', () => {
  it('coach export never carries credentials, device or study ids', () => {
    const data = buildCoachExport(store, { sections: { performance: true, weekly: true, readiness: true, detail: true } });
    const text = JSON.stringify(data);
    assert.equal(text.includes('TOPSECRET'), false);
    assert.equal(text.includes('https://secret'), false);
    assert.equal(data.device, undefined);
    assert.equal(data.studyParticipantId, undefined);
  });
});

describe('markdown rendering', () => {
  it('renders a readable summary of the picked sections', () => {
    const data = buildCoachExport(store, { sections: { performance: true, weekly: true } });
    const md = renderCoachMarkdown(data);
    assert.match(md, /# Training summary/);
    assert.match(md, /## Weekly volume/);
    assert.match(md, /bench-press: best set 85 kg × 5/);
    assert.equal(md.includes('TOPSECRET'), false);
  });

  it('omits unticked sections from the markdown too', () => {
    const md = renderCoachMarkdown(buildCoachExport(store, { sections: {} }));
    assert.doesNotMatch(md, /## Weekly volume/);
    assert.doesNotMatch(md, /## Session detail/);
  });
});

describe('partial exports', () => {
  it('history-only export parses and carries no preferences', () => {
    const envelope = buildPartialExportPayload(store, 'history');
    const parsed = parseImportFile(JSON.stringify(envelope));
    assert.equal(parsed.history.length, 3);
    // parseImportFile normalises the store, so preferences come back as the
    // defaulted object — what matters is that no sync credentials survive.
    assert.equal(parsed.preferences?.sync, undefined);
    assert.equal(parsed.eventHistory?.length || 0, 0); // no events traveled
  });

  it('settings-only export carries preferences (minus device-local sync) but no history', () => {
    const envelope = buildPartialExportPayload(store, 'settings');
    const parsed = parseImportFile(JSON.stringify(envelope));
    assert.equal(parsed.history?.length || 0, 0); // no sessions traveled
    assert.equal(parsed.preferences.units, 'kg');
    // A hostile file cannot inject sync credentials — policy denies them.
    assert.equal(parsed.preferences.sync, undefined);
  });

  it('unknown kind is rejected loudly', () => {
    assert.throws(() => buildPartialExportPayload(store, 'everything'), /Unknown partial export kind/);
  });
});
