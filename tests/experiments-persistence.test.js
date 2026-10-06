import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createExperiment, concludeExperiment, mergeExperiments } from '../src/lib/trainingExperiments.js';
import { mergeStores } from '../src/lib/export.js';
import { mergeStoresWithConflicts } from '../src/lib/sync.js';

const base = () => ({
  version: 9,
  history: [],
  archivedHistory: [],
  eventHistory: [],
  evaluationLedger: [],
  readinessLog: [],
  programHistory: [],
  customTemplates: [],
  tombstones: [],
});

const mkSet = (reps, weightKg) => ({ reps: String(reps), weightKg: String(weightKg), completed: true });

describe('experiments persistence contract', () => {
  it('mergeStores carries experiments through a merge import', () => {
    const current = base();
    const exp = createExperiment({ name: 'Chest test', metric: 'strength', muscle: 'Chest' }, [], { createdAtISO: '2026-01-05' });
    const imported = { ...base(), experiments: [exp] };
    const merged = mergeStores(current, imported);
    assert.equal(merged.experiments.length, 1);
    assert.equal(merged.experiments[0].id, exp.id);
    assert.equal(merged.experiments[0].name, 'Chest test');
  });

  it('mergeStoresWithConflicts unions experiments from both sides', () => {
    const a = createExperiment({ name: 'A', metric: 'strength', exerciseId: 'bench-press-dumbbell' }, [], { createdAtISO: '2026-01-05' });
    const b = createExperiment({ name: 'B', metric: 'strength', exerciseId: 'bench-press-dumbbell' }, [], { createdAtISO: '2026-01-06' });
    const cur = { ...base(), experiments: [a] };
    const imp = { ...base(), experiments: [b] };
    const merged = mergeStoresWithConflicts(cur, imp);
    assert.equal(merged.experiments.length, 2);
    assert.deepEqual(merged.experiments.map(e => e.id).sort(), [a.id, b.id].sort());
  });

  it('concluded status wins over an older active copy (terminal-state merge)', () => {
    const exp = createExperiment({ name: 'C', metric: 'strength', exerciseId: 'bench-press-dumbbell' }, [], { createdAtISO: '2026-01-05' });
    const concluded = concludeExperiment(exp, [], { today: '2026-03-01' });
    const cur = { ...base(), experiments: [exp] };
    const imp = { ...base(), experiments: [{ ...concluded, updatedAtISO: '2026-03-01T00:00:00Z' }] };
    const merged = mergeStores(cur, imp);
    assert.equal(merged.experiments.length, 1);
    assert.equal(merged.experiments[0].status, 'completed');
    assert.equal(merged.experiments[0].result, 'inconclusive');
  });

  it('mergeExperiments is idempotent and order-independent', () => {
    const a = createExperiment({ name: 'A', metric: 'strength', exerciseId: 'x' }, [], { createdAtISO: '2026-01-05' });
    const b = createExperiment({ name: 'B', metric: 'strength', exerciseId: 'x' }, [], { createdAtISO: '2026-01-06' });
    const one = mergeExperiments([a, b], [a, b]);
    const two = mergeExperiments([b, a], [b, a]);
    assert.deepEqual(one.map(e => e.id).sort(), two.map(e => e.id).sort());
  });

  it('import allow-list admits the experiments key via field policy', async () => {
    const { applyFieldPolicy } = await import('../src/lib/exportPolicy.js');
    const out = applyFieldPolicy({ experiments: [{ id: 'exp:1' }], mystery: 'dropped' });
    assert.ok(out.experiments);
    assert.equal(out.mystery, undefined);
  });
});
