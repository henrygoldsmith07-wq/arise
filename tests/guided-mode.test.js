import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_PROMPTS,
  fmtRest,
  newGuidedSet,
  initGuidedBlocks,
  nextGuidedStep,
  guidedProgress,
  guidedVolumeKg,
  sessionElapsedMs,
  formatElapsed,
  buildGuidedPayload,
} from '../src/lib/guidedMode.js';

const session = {
  id: 's1',
  dateISO: '2026-09-01',
  title: 'Day 1 — Push',
  week: 1,
  day: 1,
  programId: 'starter-3x',
  blocks: [
    { exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8–12', restSec: 90, loadHint: '20kg' },
    { exerciseId: 'bodyweight-squat', sets: 2, reps: '12', restSec: 0 },
  ],
};

const history = [
  {
    id: 'h0', dateISO: '2026-08-30', title: 'Push',
    blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: '20' }] }],
  },
];

describe('guidedMode — init', () => {
  it('flattens session blocks into per-set guided blocks with history prefill', () => {
    const blocks = initGuidedBlocks(session, history);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].sets.length, 2);
    assert.equal(blocks[0].sets[0].reps, '10');
    assert.equal(blocks[0].sets[0].weightKg, '20');
    assert.equal(blocks[0].sets[0].completed, false);
    assert.equal(blocks[1].sets[0].reps, '12');
  });

  it('prefers draft blocks over fresh init (crash recovery)', () => {
    const draftBlocks = [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '7', weightKg: '22', completed: true }], reps: '8–12', restSec: 90 }];
    const blocks = initGuidedBlocks(session, history, draftBlocks);
    assert.equal(blocks[0].sets.length, 1);
    assert.equal(blocks[0].sets[0].reps, '7');
    assert.equal(blocks[0].sets[0].weightKg, '22');
    assert.equal(blocks[0].sets[0].completed, true);
  });

  it('marks unilateral exercises from the exercise catalogue', () => {
    const uniSession = { id: 'u', dateISO: '2026-09-01', blocks: [{ exerciseId: 'bulgarian-split-squat', sets: 2, reps: '10', restSec: 60 }] };
    const blocks = initGuidedBlocks(uniSession, []);
    assert.equal(blocks[0].unilateral, true);
    assert.equal(blocks[0].sets[0].side, 'L');
  });
});

describe('guidedMode — steps and progress', () => {
  const blocks = initGuidedBlocks(session, history);

  it('returns the first unfinished set as the current step', () => {
    assert.deepEqual(nextGuidedStep(blocks), { blockIndex: 0, setIndex: 0 });
  });

  it('advances across block boundaries', () => {
    blocks[0].sets[0].completed = true;
    blocks[0].sets[1].completed = true;
    assert.deepEqual(nextGuidedStep(blocks), { blockIndex: 1, setIndex: 0 });
  });

  it('returns null when every set is resolved', () => {
    for(const b of blocks) for(const s of b.sets) s.completed = true;
    assert.equal(nextGuidedStep(blocks), null);
  });

  it('counts completed, skipped and pending correctly', () => {
    for(const b of blocks) for(const s of b.sets) s.completed = true;
    blocks[1].sets[1].completed = false;
    blocks[1].sets[1].skipped = true;
    const p = guidedProgress(blocks);
    assert.equal(p.total, 4);
    assert.equal(p.completed, 3);
    assert.equal(p.skipped, 1);
    assert.equal(p.pending, 0);
    assert.equal(p.pct, 100);
  });

  it('computes volume only over completed sets, honouring assisted subtraction', () => {
    const vol = guidedVolumeKg([
      { sets: [{ reps: '10', weightKg: '20', assistedKg: '', completed: true }, { reps: '10', weightKg: '20', completed: false }] },
      { sets: [{ reps: '12', weightKg: '', completed: true }] },
    ]);
    assert.equal(vol, 200);
  });
});

describe('guidedMode — timers', () => {
  it('formats rest times as m:ss or Ns', () => {
    assert.equal(fmtRest(90), '1:30');
    assert.equal(fmtRest(45), '45s');
    assert.equal(fmtRest(0), '0s');
  });

  it('formats elapsed milliseconds as m:ss', () => {
    assert.equal(formatElapsed(0), '0:00');
    assert.equal(formatElapsed(65000), '1:05');
    assert.equal(formatElapsed(3600000), '60:00');
  });

  it('clamps negative elapsed to zero and handles invalid input', () => {
    assert.equal(sessionElapsedMs('not-a-date'), 0);
    const now = Date.now();
    assert.equal(sessionElapsedMs(new Date(now + 60000).toISOString(), now), 0);
    assert.ok(sessionElapsedMs(new Date(now - 5000).toISOString(), now) >= 4900);
  });
});

describe('guidedMode — save payload', () => {
  it('builds a history payload matching the standard schema with mode guided', () => {
    const blocks = initGuidedBlocks(session, history);
    blocks[0].sets[0].completed = true;
    blocks[0].sets[1].completed = true;
    blocks[1].sets[0].skipped = true;
    blocks[1].sets[1].completed = true;
    const payload = buildGuidedPayload({
      session,
      blocks,
      note: 'felt good',
      noteTags: ['felt-strong'],
      startedAtISO: new Date(Date.now() - 10 * 60000).toISOString(),
      availableEquipment: ['dumbbells'],
    });
    assert.equal(payload.id, 's1');
    assert.equal(payload.mode, 'guided');
    assert.equal(payload.durationMinutes, 10);
    assert.equal(payload.exerciseOrder.length, 2);
    assert.equal(payload.blocks[0].sets[0].completed, true);
    assert.equal(payload.blocks[1].sets[0].skipped, true);
    assert.equal(payload.skippedSetsCount, 1);
    assert.equal(payload.note, 'felt good');
    assert.deepEqual(payload.noteTags, ['felt-strong']);
    assert.deepEqual(payload.equipmentSnapshot, ['dumbbells']);
  });

  it('marks pain flag when the pain tag is selected', () => {
    const blocks = initGuidedBlocks(session, []);
    blocks[0].sets[0].completed = true;
    const payload = buildGuidedPayload({
      session, blocks, noteTags: ['pain-discomfort'],
      startedAtISO: new Date().toISOString(),
    });
    assert.equal(payload.painDiscomfort, true);
    assert.equal(payload.blocks[0].sets[0].pain, true);
  });

  it('omits note fields when empty', () => {
    const blocks = initGuidedBlocks(session, []);
    blocks[0].sets[0].completed = true;
    const payload = buildGuidedPayload({ session, blocks, startedAtISO: new Date().toISOString() });
    assert.equal(payload.note, undefined);
    assert.equal(payload.noteTags, undefined);
  });

  it('keeps note tag vocabulary aligned with the standard runner', () => {
    const ids = NOTE_PROMPTS.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('pain-discomfort'));
  });
});
