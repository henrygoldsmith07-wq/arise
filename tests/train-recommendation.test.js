import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trainRecommendation } from '../src/lib/trainRecommendation.js';
import { recommendTemplate } from '../src/lib/templates.js';
import { PROGRAM_BY_ID } from '../src/lib/data.js';

describe('trainRecommendation — the Train hero card', () => {
  it('returns null without a profile (nothing to recommend from)', () => {
    assert.equal(trainRecommendation({ onboarding: null, customTemplates: [], history: [] }), null);
    assert.equal(trainRecommendation({}), null);
    assert.equal(trainRecommendation(), null);
  });

  it('surfaces the engine’s top template — same pick as recommendTemplate', () => {
    const profile = { onboarding: { goal: 'strength', level: 'Intermediate', equipment: ['barbell','bench','pullup-bar'], daysPerWeek: 4, availableMinutes: 55 }, customTemplates: [], history: [] };
    const hero = trainRecommendation(profile);
    const engine = recommendTemplate({ goal: 'strength', level: 'Intermediate', availableEquipment: ['barbell','bench','pullup-bar'], daysPerWeek: 4 });
    assert.equal(hero.templateId, engine.top.id);
    assert.equal(hero.programId, engine.top.programId);
    assert.equal(hero.isCustom, false);
    assert.equal(hero.name, PROGRAM_BY_ID[engine.top.programId].name);
    assert.equal(hero.daysPerWeek, engine.top.daysPerWeek);
    assert.deepEqual(hero.reasons, engine.top.reasons);
  });

  it('explanation reflects the real recommendation inputs', () => {
    const hero = trainRecommendation({ onboarding: { goal: 'muscle', level: 'Beginner', equipment: ['bodyweight','bands'], daysPerWeek: 3, availableMinutes: 45 }, customTemplates: [], history: [] });
    const labels = hero.factors.map(f => f.label);
    assert.ok(labels.includes('Goal'));
    assert.ok(labels.includes('Equipment'));
    assert.ok(labels.includes('Training level'));
    assert.ok(labels.includes('Available days'));
    assert.ok(labels.includes('Session length'));
    // values echo the profile, not generic filler
    const byId = Object.fromEntries(hero.factors.map(f => [f.id, f.value]));
    assert.equal(byId.goal, 'Build muscle');
    assert.match(byId.equipment, /bodyweight/);
    assert.equal(byId.level, 'Beginner');
    assert.equal(byId.days, '3×/week');
    assert.match(byId.minutes, /min/);
    // no history → no history factor
    assert.ok(!hero.factors.some(f => f.id === 'history'));
  });

  it('mentions relevant history when there is some', () => {
    const history = [{ id: 'h1', dateISO: '2026-09-01', blocks: [] }];
    const hero = trainRecommendation({ onboarding: { goal: 'general', level: 'Beginner', equipment: [], daysPerWeek: null }, customTemplates: [], history });
    const historyFactor = hero.factors.find(f => f.id === 'history');
    assert.ok(historyFactor);
    assert.match(historyFactor.value, /1 logged session/);
  });

  it('a full-kit gym profile recommends a gym split, not the bodyweight default', () => {
    const hero = trainRecommendation({ onboarding: { goal: 'muscle', level: 'Intermediate', equipment: ['barbell','dumbbells','bench','machine','cable','pullup-bar'], daysPerWeek: 4 }, customTemplates: [], history: [] });
    // equipment coverage dominates the score: full-kit profiles must not get
    // a bodyweight/minimal-kit plan.
    assert.notEqual(hero.programId, 'starter-3x');
    assert.notEqual(hero.programId, 'move-anywhere');
    assert.equal(hero.daysPerWeek, 4);
    assert.ok(hero.reasons.some(r => /equipment fit|doable/.test(r)));
  });

  it('session length window tracks the profile cap; absent stays absent', () => {
    const withCap = trainRecommendation({ onboarding: { goal: 'general', equipment: [], level: 'Beginner', daysPerWeek: 3, availableMinutes: 20 }, customTemplates: [], history: [] });
    assert.match(withCap.sessionLength, /^18–22 min$/);
    const noCap = trainRecommendation({ onboarding: { goal: 'general', equipment: [], level: 'Beginner', daysPerWeek: 3 }, customTemplates: [], history: [] });
    assert.equal(noCap.sessionLength, null);
    assert.ok(!noCap.factors.some(f => f.id === 'minutes'));
    // invalid caps fall back to no window rather than nonsense
    const junk = trainRecommendation({ onboarding: { goal: 'general', equipment: [], level: 'Beginner', availableMinutes: -5 }, customTemplates: [], history: [] });
    assert.equal(junk.sessionLength, null);
  });

  it('ranks custom templates alongside built-ins (legacy custom data still works)', () => {
    const custom = {
      id: 'custom-1', isCustom: true, name: 'My Split', level: 'Intermediate', goal: 'strength', daysPerWeek: 4, version: 1,
      program: {
        id: 'custom-1', name: 'My Split', level: 'Intermediate', daysPerWeek: 4, version: 1,
        mesocycle: { weeks: 4, deloadWeek: null, progression: 'linear' },
        equipment: ['barbell'],
        weeks: [{ week: 1, workouts: [{ day: 1, title: 'A', blocks: [{ exerciseId: 'barbell-row', sets: 5, reps: '5' }] }] }],
      },
    };
    // Only kit = exactly the custom's barbell: full coverage + exact
    // level/goal/days match beats every built-in (all declare missing kit).
    const hero = trainRecommendation({ onboarding: { goal: 'strength', level: 'Intermediate', equipment: ['barbell'], daysPerWeek: 4 }, customTemplates: [custom], history: [] });
    assert.equal(hero.isCustom, true);
    assert.equal(hero.templateId, 'custom-1');
    assert.equal(hero.name, 'My Split');
    assert.equal(hero.programId, 'custom-1');
  });

  it('soft-deleted templates never win the recommendation', () => {
    const custom = {
      id: 'custom-2', isCustom: true, name: 'Deleted', level: 'Intermediate', goal: 'strength', daysPerWeek: 4,
      deletedAt: '2026-09-01T00:00:00Z',
      program: { id: 'custom-2', name: 'Deleted', level: 'Intermediate', daysPerWeek: 4, equipment: ['barbell','bench'], weeks: [{ week: 1, workouts: [{ day: 1, title: 'A', blocks: [] }] }] },
    };
    const hero = trainRecommendation({ onboarding: { goal: 'strength', level: 'Intermediate', equipment: ['barbell','bench'], daysPerWeek: 4 }, customTemplates: [custom], history: [] });
    assert.notEqual(hero.templateId, 'custom-2');
  });

  it('legacy onboarding shapes (missing optional fields) still recommend', () => {
    // oldest profiles: goal/equipment only
    const hero = trainRecommendation({ onboarding: { goal: 'endurance', equipment: ['bands'] }, customTemplates: [], history: [] });
    assert.ok(hero);
    assert.ok(hero.factors.length >= 3);
    assert.equal(byId(hero, 'days'), 'flexible');
    function byId(h, id){ return h.factors.find(f => f.id === id)?.value; }
  });
});
