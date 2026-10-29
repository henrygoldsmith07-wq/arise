import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, EXERCISE_BY_ID } from '../src/lib/data.js';
import { EXERCISES_PRIMARY } from '../src/lib/data/exercises-primary.js';
import { EXERCISES_COVERAGE } from '../src/lib/data/exercises-coverage.js';

test('substitution edges are stored once in the catalogue source', () => {
  const raw = new Map([...EXERCISES_PRIMARY, ...EXERCISES_COVERAGE].map(e => [e.id, e.substitution || []]));
  for (const [id, list] of raw) {
    for (const other of list) {
      if (other === id) continue; // legacy self-edge on 'cycle'
      assert.ok(!(raw.get(other) || []).includes(id), `${id} <-> ${other} is stored in both directions`);
    }
  }
});

test('the loaded catalogue is reciprocal and every exercise keeps an alternative', () => {
  for (const e of EXERCISES) {
    assert.ok(e.substitution.length > 0, `${e.id} has no substitutions`);
    for (const t of e.substitution) {
      assert.ok(EXERCISE_BY_ID[t], `${e.id} -> unknown ${t}`);
      assert.ok(EXERCISE_BY_ID[t].substitution.includes(e.id), `${t} does not list ${e.id}`);
    }
    assert.equal(new Set(e.substitution).size, e.substitution.length, `${e.id} lists a duplicate`);
  }
});
