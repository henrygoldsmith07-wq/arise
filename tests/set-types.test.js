import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionHistoryPayload, nextSetType, SET_TYPES } from '../src/lib/sessionRunnerModel.js';
import { buildHevyExport } from '../src/lib/hevyCsvExport.js';

const set = (o = {}) => ({ reps: '8', weightKg: '20', rpe: '', completed: true, failed: false, ...o });
const save = (sets) => buildSessionHistoryPayload({
  session: { id: 's1', dateISO: '2026-11-01', programId: 'p', title: 'Upper' },
  blocks: [{ exerciseId: 'bench-press-dumbbell', reps: '8-10', restSec: 90, unilateral: false, sets }],
  startedAt: '2026-11-01T10:00:00.000Z',
  nowISO: '2026-11-01T10:40:00.000Z',
});

describe('set types', () => {
  it('cycles normal → warm-up → drop → failure → normal', () => {
    assert.deepEqual(SET_TYPES.map(nextSetType), ['warmup', 'drop', 'failure', '']);
    assert.equal(nextSetType(undefined), 'warmup');
  });

  it('logged warm-ups leave the work sets and ride along as warmupSets', () => {
    const p = save([set({ setType: 'warmup', weightKg: '10' }), set({ setType: 'warmup', completed: false }), set(), set()]);
    const b = p.blocks[0];
    assert.equal(b.sets.length, 2, 'only work sets count');
    assert.deepEqual(b.warmupSets, [{ reps: '8', weightKg: '10' }], 'only completed warm-ups are kept');
    assert.equal(p.skippedSetsCount, 0, 'an unfinished warm-up is not a skipped work set');
  });

  it('a failure set with no effort logged is saved as RPE 10; drop sets are marked', () => {
    const p = save([set({ setType: 'failure' }), set({ setType: 'failure', rpe: '9' }), set({ setType: 'drop', weightKg: '14' })]);
    const [f, f9, d] = p.blocks[0].sets;
    assert.equal(f.rpe, '10');
    assert.equal(f.setType, 'failure');
    assert.equal(f9.rpe, '9', 'an RPE the lifter typed is never overwritten');
    assert.equal(d.setType, 'drop');
    assert.equal(p.blocks[0].warmupSets, undefined);
  });

  it('Hevy export writes warmup / dropset / failure set types', () => {
    const p = save([set({ setType: 'warmup', weightKg: '10' }), set(), set({ setType: 'drop' }), set({ setType: 'failure' })]);
    const { csv } = buildHevyExport([p], { todayISO: '2026-11-05' });
    const types = csv.trim().split('\n').slice(1).map(l => l.match(/,"?(warmup|normal|dropset|failure)"?,/)?.[1]);
    assert.deepEqual(types, ['warmup', 'normal', 'dropset', 'failure']);
  });
});
