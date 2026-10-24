// Onboarding exercise-preference picker: pure search/filter/grouping module
// plus source contracts for the component (the repo has no DOM renderer in
// unit tests, so the a11y/touch-target contract is pinned on source and the
// behaviour end-to-end in e2e/exercise-picker.spec.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXERCISES, exerciseAvailable } from '../src/lib/data.js';
import {
  normaliseQuery, matchesQuery, filterExercises, groupByMuscle, musclesIn, togglePreferenceIds, MUSCLE_ORDER,
} from '../src/lib/exercisePicker.js';

const FULL_GYM = ['bodyweight', 'dumbbells', 'barbell', 'bench', 'pullup-bar', 'cable', 'machine', 'kettlebell'];
const gym = EXERCISES.filter((ex)=> exerciseAvailable(ex.id, FULL_GYM));
const names = (list)=> list.map((ex)=> ex.name);

describe('exercisePicker: normaliseQuery', ()=>{
  it('lowercases, strips diacritics and collapses punctuation', ()=>{
    assert.equal(normaliseQuery('  Lat   PULL-down '), 'lat pull down');
    assert.equal(normaliseQuery('Développé Couché'), 'developpe couche');
    assert.equal(normaliseQuery(null), '');
    assert.equal(normaliseQuery(undefined), '');
  });
});

describe('exercisePicker: search', ()=>{
  it('finds pulldowns by name, case-insensitively', ()=>{
    const hits = names(filterExercises(gym, { query: 'PULLDOWN' }));
    assert.ok(hits.includes('Lat Pulldown'), hits.join());
    assert.ok(hits.every((n)=> /pulldown/i.test(n)), hits.join());
  });

  it('ignores diacritics in the query', ()=>{
    assert.ok(names(filterExercises(gym, { query: 'pülldöwn' })).includes('Lat Pulldown'));
  });

  it('matches multi-word queries in any order', ()=>{
    assert.ok(names(filterExercises(gym, { query: 'pulldown lat' })).includes('Lat Pulldown'));
  });

  it('matches muscle and equipment as well as name', ()=>{
    const back = filterExercises(gym, { query: 'back' });
    assert.ok(back.length > 3 && back.every((ex)=> ex.muscle === 'Back' || /back/i.test(ex.name + ex.id)));
    const cable = filterExercises(gym, { query: 'cable' });
    assert.ok(cable.length > 0 && cable.every((ex)=> ex.equipment.includes('cable') || /cable/i.test(ex.name)));
  });

  it('expands gym shorthand aliases', ()=>{
    const rdl = names(filterExercises(gym, { query: 'rdl' }));
    assert.ok(rdl.includes('Romanian Deadlift'), rdl.join());
    const db = filterExercises(gym, { query: 'db' });
    assert.ok(db.length > 0 && db.every((ex)=> ex.equipment.includes('dumbbells') || /dumbbell/i.test(ex.name)));
    const lat = names(filterExercises(gym, { query: 'lat' }));
    assert.ok(lat.includes('Lat Pulldown'));
    const chest = names(filterExercises(gym, { query: 'pec' }));
    assert.ok(chest.includes('Barbell Bench Press'), 'pec → chest alias should include chest lifts');
    assert.ok(names(filterExercises(gym, { query: 'chest' })).some((n)=> /pec deck/i.test(n)));
  });

  it('empty query matches everything; nonsense matches nothing', ()=>{
    assert.equal(filterExercises(gym, { query: '' }).length, gym.length);
    assert.equal(filterExercises(gym, { query: '   ' }).length, gym.length);
    assert.equal(filterExercises(gym, { query: 'zzqxv' }).length, 0);
    assert.equal(matchesQuery(gym[0], ''), true);
  });
});

describe('exercisePicker: filters', ()=>{
  it('filters by muscle and by equipment', ()=>{
    const legs = filterExercises(gym, { muscle: 'Legs' });
    assert.ok(legs.length > 0 && legs.every((ex)=> ex.muscle === 'Legs'));
    assert.equal(filterExercises(gym, { muscle: 'all' }).length, gym.length);
    const machine = filterExercises(gym, { equipment: 'machine' });
    assert.ok(machine.length > 0 && machine.every((ex)=> ex.equipment.includes('machine')));
  });

  it('onlyChosen keeps exactly the liked and avoided exercises', ()=>{
    const preferred = ['lat-pulldown'];
    const disliked = ['romanian-deadlift'];
    const picks = filterExercises(gym, { onlyChosen: true, preferred, disliked });
    assert.deepEqual(picks.map((ex)=> ex.id).sort(), ['lat-pulldown', 'romanian-deadlift']);
    assert.equal(filterExercises(gym, { onlyChosen: true }).length, 0);
    // Combined with a query.
    assert.deepEqual(filterExercises(gym, { onlyChosen: true, preferred, disliked, query: 'pulldown' }).map((ex)=> ex.id), ['lat-pulldown']);
  });
});

describe('exercisePicker: groupByMuscle', ()=>{
  it('returns stable, display-ordered groups whose counts add up', ()=>{
    const groups = groupByMuscle(gym);
    const order = groups.map((g)=> g.muscle);
    const known = order.filter((m)=> MUSCLE_ORDER.includes(m));
    assert.deepEqual(known, MUSCLE_ORDER.filter((m)=> order.includes(m)));
    assert.equal(groups.reduce((n, g)=> n + g.count, 0), gym.length);
    for(const g of groups) assert.equal(g.count, g.exercises.length);
    // Input order does not change group order.
    assert.deepEqual(groupByMuscle([...gym].reverse()).map((g)=> g.muscle), order);
    assert.deepEqual(musclesIn(gym), order);
  });

  it('keeps input order within a group and counts liked/avoided per group', ()=>{
    const groups = groupByMuscle(gym, { preferred: ['lat-pulldown', 'push-up'], disliked: ['seated-cable-row'] });
    const back = groups.find((g)=> g.muscle === 'Back');
    const chest = groups.find((g)=> g.muscle === 'Chest');
    assert.equal(back.liked, 1);
    assert.equal(back.avoided, gym.some((ex)=> ex.id === 'seated-cable-row' && ex.muscle === 'Back') ? 1 : 0);
    assert.equal(chest.liked, 1);
    const backIds = gym.filter((ex)=> ex.muscle === 'Back').map((ex)=> ex.id);
    assert.deepEqual(back.exercises.map((ex)=> ex.id), backIds);
  });

  it('puts unknown muscles after the known ones', ()=>{
    const groups = groupByMuscle([{ id: 'x', name: 'X', muscle: 'Neck', equipment: [] }, { id: 'y', name: 'Y', muscle: 'Chest', equipment: [] }]);
    assert.deepEqual(groups.map((g)=> g.muscle), ['Chest', 'Neck']);
    assert.deepEqual(groupByMuscle([]), []);
  });
});

describe('exercisePicker: Like/Avoid stay mutually exclusive', ()=>{
  it('liking removes an avoid, avoiding removes a like, toggling twice clears', ()=>{
    let s = { preferred: [], disliked: ['a'] };
    s = togglePreferenceIds(s, 'a', 'preferred');
    assert.deepEqual(s, { preferred: ['a'], disliked: [] });
    s = togglePreferenceIds(s, 'a', 'disliked');
    assert.deepEqual(s, { preferred: [], disliked: ['a'] });
    s = togglePreferenceIds(s, 'a', 'disliked');
    assert.deepEqual(s, { preferred: [], disliked: [] });
  });
});

describe('ExercisePreferencePicker component contract', ()=>{
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'ExercisePreferencePicker.jsx'), 'utf8');
  const onboarding = readFileSync(join(process.cwd(), 'src', 'components', 'Onboarding.jsx'), 'utf8');

  it('onboarding uses the picker instead of the flat list', ()=>{
    assert.match(onboarding, /<ExercisePreferencePicker/);
    assert.doesNotMatch(onboarding, /preferenceExercises\.map/);
    // Old ~24px buttons are gone.
    assert.doesNotMatch(onboarding, /px-2 py-1 text-\[11px\] font-bold \$\{liked/);
  });

  it('Like/Avoid are 44px toggle buttons named after the exercise', ()=>{
    assert.match(src, /const CHIP = 'min-h-11 min-w-11 /);
    const likeAt = src.indexOf("onToggle(ex.id, 'preferred')");
    const avoidAt = src.indexOf("onToggle(ex.id, 'disliked')");
    assert.ok(likeAt > -1 && avoidAt > -1);
    for(const at of [likeAt, avoidAt]){
      const tag = src.slice(at, src.indexOf('</button>', at));
      assert.match(tag, /aria-pressed=/);
      assert.match(tag, /className=\{CHIP \+/);
      assert.match(tag, /sr-only"> \{ex\.name\}/);
    }
  });

  it('has a labelled search, clear action, picks toggle, collapsible groups, empty state and live count', ()=>{
    assert.match(src, /<label htmlFor="exercise-picker-search"[^>]*>Search exercises<\/label>/);
    assert.match(src, /aria-label="Clear search"/);
    assert.ok(src.includes("chip('Show my picks', onlyChosen"));
    assert.match(src, /aria-expanded=\{open\}/);
    assert.match(src, /No exercises match “\{query\.trim\(\)\}”/);
    assert.match(src, /aria-live="polite"/);
    assert.match(src, /\{group\.liked\} liked · \{group\.avoided\} avoided/);
  });
});
