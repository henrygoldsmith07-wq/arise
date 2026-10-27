import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSetPatch, editSet, deleteSet, deleteSession, changedEvidence, describeSet } from '../src/lib/historyEditor.js';

const mk = () => ({
  history: [{ id: 's1', dateISO: '2026-10-01', savedAt: '2026-10-01T10:00:00Z', blocks: [
    { exerciseId: 'row', sets: [{ weightKg: 100, reps: 10, rpe: 8 }, { weightKg: 10, reps: 10, rpe: 8 }] },
    { exerciseId: 'press', sets: [{ weightKg: 20, reps: 8, rpe: 7 }] },
  ] }, { id: 's2', dateISO: '2026-10-03', savedAt: '2026-10-03T10:00:00Z', blocks: [{ exerciseId: 'row', sets: [{ weightKg: 12, reps: 10 }] }] }],
  activeSchedule: { rev: 1, sessions: [{ id: 's1', status: 'done' }, { id: 's2', status: 'done' }] },
  tombstones: [],
});

test('validateSetPatch rejects nonsense and normalises commas', () => {
  assert.equal(validateSetPatch({ weightKg: '600' }).ok, false);
  assert.equal(validateSetPatch({ reps: '2.5' }).ok, false);
  assert.equal(validateSetPatch({ rpe: '11' }).ok, false);
  assert.deepEqual(validateSetPatch({ weightKg: '12,5', reps: '8', rpe: '' }).clean, { weightKg: 12.5, reps: 8, rpe: '' });
});

test('editSet fixes a typo and stamps edited', () => {
  const s = mk();
  const r = editSet(s, { sessionId: 's1', blockIndex: 0, setIndex: 0, patch: { weightKg: '10' }, now: '2026-10-05T00:00:00Z' });
  assert.equal(r.store.history.find((x) => x.id === 's1').blocks[0].sets[0].weightKg, 10);
  assert.equal(r.session.blocks[0].sets[0].edited, true);
  assert.equal(changedEvidence(s.history[0], r.session), true);
  assert.equal(s.history[0].blocks[0].sets[0].weightKg, 100, 'input not mutated');
});

test('editSet errors on bad input', () => {
  assert.ok(editSet(mk(), { sessionId: 'x', blockIndex: 0, setIndex: 0, patch: {} }).error);
  assert.ok(editSet(mk(), { sessionId: 's1', blockIndex: 0, setIndex: 0, patch: { weightKg: '999' } }).error);
  assert.ok(editSet(mk(), { sessionId: 's1', blockIndex: 5, setIndex: 0, patch: {} }).error);
});

test('deleteSet removes empty blocks and whole session when last', () => {
  const r = deleteSet(mk(), { sessionId: 's1', blockIndex: 1, setIndex: 0 });
  assert.equal(r.store.history[0].blocks.length, 1);
  const last = deleteSet(mk(), { sessionId: 's2', blockIndex: 0, setIndex: 0 });
  assert.equal(last.store.history.some((x) => x.id === 's2'), false);
  assert.equal(last.store.tombstones[0].refId, 's2');
});

test('deleteSession tombstones and reopens the schedule slot', () => {
  const r = deleteSession(mk(), { sessionId: 's1', now: '2026-10-05T00:00:00Z' });
  assert.equal(r.store.history.length, 1);
  assert.equal(r.store.tombstones[0].id, 'sessions:s1');
  assert.equal(r.store.activeSchedule.sessions[0].status, 'planned');
  assert.equal(r.store.activeSchedule.rev, 2);
  assert.equal(deleteSession(r.store, { sessionId: 's1' }).error, 'Session not found.');
});

test('describeSet', () => {
  assert.equal(describeSet({ weightKg: 10, reps: 8 }), '10 kg × 8');
  assert.equal(describeSet({ weightKg: '', reps: 8 }), 'bodyweight × 8');
});
