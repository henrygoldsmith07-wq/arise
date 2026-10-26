// Onboarding sport answer → rider plan pinned first on the programme shelf.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { programShelf, wantsRiderPlan } from '../src/lib/programShelf.js';

const BASE = { goal:'general', level:'Beginner', daysPerWeek:3, availableMinutes:45, equipment:['machine','cable'] };
const GYM = ['machine', 'cable', 'bodyweight'];

describe('rider plan on the shelf', () => {
  for(const sport of ['cycling', 'running', 'triathlon']){
    it(`pins Rider Upper first for ${sport} with machines/cables`, () => {
      const shelf = programShelf({ onboarding:{ ...BASE, sport }, availableEquipment:GYM });
      assert.equal(shelf.items[0].programId, 'rider-upper-3x');
      assert.match(shelf.items[0].reasons[0], new RegExp(sport));
      assert.ok(shelf.items.length <= 5);
      assert.equal(shelf.items.filter(i=> i.programId === 'rider-upper-3x').length, 1);
    });
  }
  it('does nothing without a sport or with an unknown one', () => {
    for(const sport of [undefined, 'none', 'chess']){
      const shelf = programShelf({ onboarding:{ ...BASE, sport }, availableEquipment:GYM });
      assert.notEqual(shelf.items[0]?.programId, 'rider-upper-3x');
    }
  });
  it('does not offer it without machines or cables', () => {
    assert.equal(wantsRiderPlan({ sport:'cycling' }, ['dumbbells', 'bodyweight']), false);
    const shelf = programShelf({ onboarding:{ ...BASE, sport:'cycling' }, availableEquipment:['dumbbells', 'bench'] });
    assert.ok(!shelf.items.some(i=> i.programId === 'rider-upper-3x'));
  });
});

import { saveDraft as _sd, loadDraft as _ld } from '../src/lib/onboardingDraft.js';
it('onboarding draft keeps the sport answer', ()=>{
  const m = new Map(); const storage = { getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v), removeItem:k=>m.delete(k) };
  _sd({ goal:'general', sport:'cycling' }, { storage });
  assert.equal(_ld({ storage }).sport, 'cycling');
});

describe('stated ride days per week picks the variant', () => {
  it('4+ stated ride days pins the 2-day plan', () => {
    const shelf = programShelf({ onboarding:{ ...BASE, sport:'cycling', rideDaysPerWeek:5 }, availableEquipment:GYM });
    assert.equal(shelf.items[0].programId, 'rider-upper-2x');
  });
  it('2-3 stated ride days keeps the 3-day plan, junk values ignored', () => {
    for(const r of [2, 3, 'x', -4, null]){
      const shelf = programShelf({ onboarding:{ ...BASE, sport:'cycling', rideDaysPerWeek:r }, availableEquipment:GYM });
      assert.equal(shelf.items[0].programId, 'rider-upper-3x');
    }
  });
});
