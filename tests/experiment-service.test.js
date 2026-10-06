import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startExperiment, concludeExperimentById, cancelExperimentById, deleteExperiment, restoreExperiment, suggestNextExperiment } from '../src/services/experimentService.js';

const EX = 'bench-press-dumbbell';
const BASE = '2026-01-01'; // fixed "today"; all fixture dates derive by real calendar math

/** BASE + n days — real calendar math, no hand-written impossible dates. */
function isoAfter(n){
  const t = Date.parse(`${BASE}T00:00:00`) + n * 86400000;
  const d = new Date(t);
  const pad = (x)=> String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function makeSession(dateISO, weightKg){
  return {
    id: `s-${dateISO}`,
    dateISO,
    title: 'Test day',
    week: 1,
    day: 1,
    blocks: [{ exerciseId: EX, sets: [{ reps: 5, weightKg, completed: true }] }],
  };
}

/** [[offsetDays, weightKg], ...] → history array. */
function makeHistory(entries){
  return entries.map(([offset, w])=> makeSession(isoAfter(offset), w));
}

function emptyStore(){
  return { experiments: [], history: [], tombstones: [] };
}

const PINNED_TODAY = { todayISO: BASE };

// Baseline: two identical flat sessions (~116.7 e1RM each week). Intervention:
// six identical stronger sessions across later weeks. Zero per-phase variance
// makes diff-vs-MDE deterministic — the +15 kg jump cannot be noise.
const IMPROVED_HISTORY = makeHistory([
  [3, 100], [9, 100],            // baseline-phase weeks
  [15, 115], [17, 115],          // intervention weeks
  [22, 115], [24, 115],
  [29, 115], [31, 115],
]);

describe('experiment application service', ()=>{
  it('starts an experiment with a deterministic id and does not mutate the input store', ()=>{
    const store = emptyStore();
    const before = JSON.stringify(store);
    const result = startExperiment(store, { name: 'Bench: 5–8 vs 8–12', exerciseId: EX, metric: 'strength' }, PINNED_TODAY);
    assert.equal(result.experiment.status, 'active');
    assert.equal(result.experiment.id, 'exp:2026-01-01:1');
    assert.equal(result.experiment.exerciseId, EX);
    assert.equal(result.store.experiments.length, 1);
    assert.equal(JSON.stringify(store), before);
  });

  it('caps concurrent active experiments at two', ()=>{
    let store = emptyStore();
    store = startExperiment(store, { name: 'A', exerciseId: EX, metric: 'strength' }, PINNED_TODAY).store;
    store = startExperiment(store, { name: 'B', exerciseId: EX, metric: 'strength' }, PINNED_TODAY).store;
    assert.throws(()=> startExperiment(store, { name: 'C', exerciseId: EX, metric: 'strength' }, PINNED_TODAY), /Only 2 experiments/);
    // A terminal row frees the slot.
    store = cancelExperimentById(store, store.experiments[0].id).store;
    const third = startExperiment(store, { name: 'C', exerciseId: EX, metric: 'strength' }, PINNED_TODAY);
    assert.equal(third.experiment.status, 'active');
  });

  it('concludes a clearly improved experiment and never persists the evaluation', ()=>{
    const base = { ...emptyStore(), history: IMPROVED_HISTORY };
    const { store: withExp } = startExperiment(base, { name: 'Bench reps', exerciseId: EX, metric: 'strength' }, PINNED_TODAY);
    const result = concludeExperimentById(withExp, withExp.experiments[0].id);
    assert.equal(result.concluded, true);
    assert.equal(result.result, 'improved');
    assert.equal(result.store.experiments[0].status, 'completed');
    assert.equal(result.store.experiments[0].result, 'improved');
    assert.ok(result.store.experiments[0].conclusionNote);
    assert.ok(result.evaluation); // returned for display…
    assert.equal(result.store.experiments[0].evaluation, undefined); // …but never stored
  });

  it('stays inconclusive when intervention sessions are missing', ()=>{
    // Only the two baseline-phase sessions exist: the minimum-sessions gate
    // (4 intervention sessions) fails, so the honest call is inconclusive.
    const base = { ...emptyStore(), history: IMPROVED_HISTORY.slice(0, 2) };
    const { store: withExp } = startExperiment(base, { name: 'Bench reps', exerciseId: EX, metric: 'strength' }, PINNED_TODAY);
    const result = concludeExperimentById(withExp, withExp.experiments[0].id);
    assert.equal(result.concluded, true);
    assert.equal(result.result, 'inconclusive');
    assert.match(result.conclusion, /Not enough data/);
  });

  it('refuses to conclude or cancel a non-active experiment', ()=>{
    let store = emptyStore();
    store = startExperiment(store, { name: 'X', exerciseId: EX, metric: 'strength' }, PINNED_TODAY).store;
    store = cancelExperimentById(store, store.experiments[0].id).store;
    assert.equal(store.experiments[0].status, 'cancelled');
    const again = cancelExperimentById(store, store.experiments[0].id);
    assert.equal(again.cancelled, false);
    const concludeAgain = concludeExperimentById(store, store.experiments[0].id);
    assert.equal(concludeAgain.concluded, false);
  });

  it('soft-deletes with a tombstone and restores cleanly', ()=>{
    let store = emptyStore();
    store = startExperiment(store, { name: 'X', exerciseId: EX, metric: 'strength' }, PINNED_TODAY).store;
    const id = store.experiments[0].id;
    const deleted = deleteExperiment(store, id);
    assert.equal(deleted.deleted, true);
    assert.ok(deleted.store.experiments[0].deletedAt);
    assert.equal(deleted.store.tombstones[0].refId, id);
    const restored = restoreExperiment(deleted.store, id);
    assert.equal(restored.restored, true);
    assert.equal(restored.store.experiments[0].deletedAt, null);
    assert.equal(restored.store.tombstones.length, 0);
    assert.equal(deleteExperiment(store, 'nope').deleted, false);
  });

  it('suggests the rep-range experiment from a detected plateau and the sleep experiment from history alone', ()=>{
    const plateaued = suggestNextExperiment({ store: { history: makeHistory([[1, 100]]) }, plateau: { detected: true }, exerciseId: EX });
    assert.equal(plateaued.presetId, 'rep-range');
    assert.equal(plateaued.exerciseId, EX);
    const fromHistory = suggestNextExperiment({ store: { history: makeHistory(Array.from({ length: 12 }, (_, i)=> [i, 100])) } });
    assert.equal(fromHistory.presetId, 'sleep-readiness');
    assert.equal(suggestNextExperiment({ store: { history: [] } }), null);
  });
});
