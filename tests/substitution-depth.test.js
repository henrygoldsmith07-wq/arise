// Substitution logic — unit depth. `substitutions.js` previously had zero
// direct tests (its behaviour was only exercised via planning fixtures).
// These pin the scoring contract and the invariants that keep suggestions
// sane: determinism, self-exclusion, equipment filtering, preference effects.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreSubstitution, rankedSubstitutions, substitutionOptions,
  validateSubstitutionChain, substitutionByPerformance, movementPatternFor,
} from '../src/lib/substitutions.js';
import { EXERCISES, EXERCISE_BY_ID } from '../src/lib/data.js';

const target = EXERCISE_BY_ID['bench-press-barbell'] || EXERCISES.find((e) => e.id === 'bench-press-barbell');
assert.ok(target, 'bench-press-barbell must exist in the catalogue');

describe('movement pattern classification', () => {
  it('classifies known patterns and returns null for unknown ids', () => {
    assert.equal(movementPatternFor('bench-press-barbell'), 'horizontal-push');
    assert.equal(movementPatternFor('barbell-squat'), 'squat');
    assert.equal(movementPatternFor('not-an-exercise'), null);
  });
});

describe('scoreSubstitution invariants', () => {
  it('same muscle scores above different muscle, all else equal', () => {
    const chest = EXERCISES.find((e) => e.id !== 'bench-press' && e.muscle === 'Chest');
    const legs = EXERCISES.find((e) => e.muscle === 'Legs' || e.muscle === 'Glutes');
    assert.ok(chest && legs);
    const sChest = scoreSubstitution(target, chest);
    const sLegs = scoreSubstitution(target, legs);
    assert.ok(sChest > sLegs, `chest ${sChest} should outrank legs ${sLegs}`);
  });

  it('a candidate identical to the target is heavily penalised (self-exclusion)', () => {
    const self = scoreSubstitution(target, target);
    const other = scoreSubstitution(target, EXERCISES.find((e) => e.id !== target.id && e.muscle === target.muscle));
    assert.ok(self < other);
  });

  it('disliked exercises are penalised below neutral alternatives', () => {
    const a = EXERCISES.find((e) => e.id !== 'bench-press-barbell' && e.muscle === target.muscle);
    const dislikedSet = new Set([a.id]);
    const withDislike = scoreSubstitution(target, a, { disliked: dislikedSet });
    const without = scoreSubstitution(target, a);
    assert.ok(withDislike < without - 4);
  });

  it('preferred exercises gain over identical un-preferred candidates', () => {
    const a = EXERCISES.find((e) => e.id !== 'bench-press-barbell' && e.muscle === target.muscle);
    assert.ok(scoreSubstitution(target, a, { preferred: new Set([a.id]) }) > scoreSubstitution(target, a));
  });

  it('history familiarity adds diminishing returns (capped bonus)', () => {
    const a = EXERCISES.find((e) => e.id !== 'bench-press-barbell' && e.muscle === target.muscle);
    const base = scoreSubstitution(target, a);
    const few = scoreSubstitution(target, a, { historyCounts: { [a.id]: 1 } });
    const many = scoreSubstitution(target, a, { historyCounts: { [a.id]: 50 } });
    assert.ok(few > base);
    assert.ok(Math.abs(many - few) < 1, 'cap reached — 50 uses ≈ 5 uses');
  });

  it('declared manual substitutions get a strong boost', () => {
    const a = EXERCISES.find((e) => e.id !== 'bench-press-barbell' && e.muscle === target.muscle);
    assert.ok(scoreSubstitution(target, a, { declared: true }) - scoreSubstitution(target, a) >= 2);
  });

  it('loadability is rewarded, un-loadability punished', () => {
    const a = EXERCISES.find((e) => e.id !== 'bench-press-barbell' && e.muscle === target.muscle);
    const good = scoreSubstitution(target, a, { loadability: { [a.id]: true } });
    const bad = scoreSubstitution(target, a, { loadability: { [a.id]: false } });
    assert.ok(good - bad >= 1.2);
  });

  it('scoring is deterministic', () => {
    const a = EXERCISES[0], b = EXERCISES[1];
    assert.equal(scoreSubstitution(target, a), scoreSubstitution(target, a));
    assert.equal(scoreSubstitution(target, b), scoreSubstitution(target, b));
  });
});

describe('rankedSubstitutions', () => {
  it('returns up to limit candidates, never the target itself', () => {
    const ranked = rankedSubstitutions('bench-press-barbell', null, 6);
    assert.ok(ranked.length > 0 && ranked.length <= 6);
    for(const r of ranked){
      const id = r.id || r.exerciseId || r;
      assert.notEqual(id, 'bench-press-barbell');
    }
  });

  it('respects equipment filtering when equipment is provided', () => {
    const ranked = rankedSubstitutions('bench-press-barbell', ['barbell', 'bench'], 8);
    for(const r of ranked){
      const id = r.id || r.exerciseId || r;
      const ex = EXERCISE_BY_ID[id] || EXERCISES.find((e) => e.id === id);
      if(ex && ex.equipment?.length){
        const ok = ex.equipment.every((e) => ['barbell', 'bench', 'bodyweight'].includes(e));
        assert.ok(ok, `${id} requires equipment outside the available set`);
      }
    }
  });

  it('is deterministic across calls', () => {
    const a = rankedSubstitutions('bench-press-barbell', null, 4).map((r) => r.id || r.exerciseId || r);
    const b = rankedSubstitutions('bench-press-barbell', null, 4).map((r) => r.id || r.exerciseId || r);
    assert.deepEqual(a, b);
  });
});

describe('substitutionOptions (full pipeline)', () => {
  it('honours disliked lists and limits', () => {
    const opts = substitutionOptions('bench-press-barbell', { limit: 3, dislikedExerciseIds: ['bench-press-dumbbell'] });
    const ids = opts.map((o) => o.id || o.exerciseId || o);
    assert.ok(opts.length <= 3);
    assert.equal(ids.includes('bench-press-dumbbell'), false);
  });

  it('boosts user-declared preferred exercises toward the top', () => {
    const plain = substitutionOptions('bench-press-barbell', { limit: 5 }).map((o) => o.id || o.exerciseId || o);
    assert.ok(plain.length >= 2);
    const preferredId = plain[plain.length - 1]; // take the weakest ranked candidate
    const boosted = substitutionOptions('bench-press-barbell', { limit: 5, preferredExerciseIds: [preferredId] })
      .map((o) => o.id || o.exerciseId || o);
    assert.ok(boosted.indexOf(preferredId) < plain.indexOf(preferredId), 'preference should climb the ranking');
  });
});

describe('validateSubstitutionChain', () => {
  it('passes a kit-compatible chain', () => {
    const sessions = [
      { id: 's1', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-barbell', sets: [{ reps: '5', weightKg: '80' }], substitutionFrom: null }] },
    ];
    const result = validateSubstitutionChain(sessions, ['barbell', 'bench']);
    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
  });

  it('returns the documented shape { valid, issues } even with unknown exercises', () => {
    const sessions = [
      { id: 's1', dateISO: '2026-01-01', blocks: [{ exerciseId: 'totally-unknown-exercise', sets: [] }] },
    ];
    const result = validateSubstitutionChain(sessions, []);
    assert.equal(typeof result.valid, 'boolean');
    assert.ok(Array.isArray(result.issues));
  });
});

describe('substitutionByPerformance', () => {
  it('ranks candidates the user has actually performed well on', () => {
    const history = [
      { id: 'h1', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: '30' }, { reps: '10', weightKg: '30' }] }] },
      { id: 'h2', dateISO: '2026-01-04', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: '32.5' }] }] },
    ];
    const ranked = substitutionByPerformance('bench-press-barbell', history, null);
    assert.ok(Array.isArray(ranked));
    const ids = ranked.map((r) => r.id || r.exerciseId || r);
    if(ids.includes('bench-press-dumbbell')){
      assert.ok(ids.indexOf('bench-press-dumbbell') <= 2, 'a well-performed substitute should rank high');
    }
  });
});
