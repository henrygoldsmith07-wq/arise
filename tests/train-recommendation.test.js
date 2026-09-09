import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trainRecommendation } from '../src/lib/trainRecommendation.js';
import { recommendTemplate } from '../src/lib/templates.js';
import { PROGRAM_BY_ID } from '../src/lib/data.js';
import { blockDurationMinutes } from '../src/lib/programming.js';
import { generateProgramme } from '../src/lib/programmeGenerator.js';

const PROFILE = { onboarding: { goal: 'muscle', level: 'Beginner', equipment: ['bodyweight','bands'], daysPerWeek: 3, availableMinutes: 45 }, customTemplates: [], history: [] };

describe('trainRecommendation — explanation integrity', () => {
  it('returns null without a profile (nothing to recommend from)', () => {
    assert.equal(trainRecommendation({ onboarding: null, customTemplates: [], history: [] }), null);
    assert.equal(trainRecommendation({}), null);
    assert.equal(trainRecommendation(), null);
  });

  it('surfaces the engine’s top template — same pick as recommendTemplate (output unchanged)', () => {
    const hero = trainRecommendation(PROFILE);
    const engine = recommendTemplate({ goal: 'muscle', level: 'Beginner', availableEquipment: ['bodyweight','bands'], daysPerWeek: 3 });
    assert.equal(hero.templateId, engine.top.id);
    assert.equal(hero.programId, engine.top.programId);
    assert.equal(hero.name, PROGRAM_BY_ID[engine.top.programId].name);
    assert.deepEqual(hero.reasons, engine.top.reasons);
    assert.equal(hero.score, engine.top.score);
  });

  it('every "Used to choose" factor is exactly what reaches the scorer — and nothing else', () => {
    const hero = trainRecommendation(PROFILE);
    // Exactly the four ranking inputs, in order.
    assert.deepEqual(hero.selectionInputs.map(f => f.id), ['goal', 'equipment', 'level', 'days']);
    // Their values echo the profile.
    const byId = Object.fromEntries(hero.selectionInputs.map(f => [f.id, f.value]));
    assert.equal(byId.goal, 'Build muscle');
    assert.equal(byId.equipment, 'bodyweight, bands');
    assert.equal(byId.level, 'Beginner');
    assert.equal(byId.days, '3×/week');
    // Preferred minutes and history are NOT selection inputs even though the
    // profile carries both.
    const withEverything = trainRecommendation({ ...PROFILE, history: [{ id: 'h1', dateISO: '2026-09-01', blocks: [] }] });
    assert.deepEqual(withEverything.selectionInputs.map(f => f.id), ['goal', 'equipment', 'level', 'days']);
  });

  it('history is never described as a ranking input — it lives in adaptation inputs', () => {
    const history = [{ id: 'h1', dateISO: '2026-09-01', blocks: [] }, { id: 'h2', dateISO: '2026-09-03', blocks: [] }];
    const hero = trainRecommendation({ ...PROFILE, history });
    // Selection side stays history-free.
    assert.ok(!hero.selectionInputs.some(f => f.id === 'history'));
    assert.ok(!JSON.stringify(hero.selectionInputs).match(/history/i));
    // Adaptation side mentions it, phrased around session building.
    const historyFactor = hero.adaptationInputs.find(f => f.id === 'history');
    assert.ok(historyFactor);
    assert.match(historyFactor.value, /2 logged sessions/);
    assert.match(historyFactor.value, /prefill|cap|swap|preset/);
  });

  it('no history → no history factor anywhere (never claims absent evidence)', () => {
    const hero = trainRecommendation(PROFILE);
    assert.ok(!hero.adaptationInputs.some(f => f.id === 'history'));
  });

  it('preferred duration is a labelled preference — never presented as the programme’s measured duration', () => {
    const hero = trainRecommendation(PROFILE); // onboarding says 45 min
    // The headline duration is MEASURED from the programme's blocks.
    assert.equal(hero.estimatedMinutes != null, true);
    const expected = (()=> {
      const workouts = PROGRAM_BY_ID[hero.programId].weeks[0].workouts;
      const perWorkout = workouts.map(w => Math.ceil(w.blocks.reduce((s, b) => s + blockDurationMinutes(b), 0)));
      return Math.round(perWorkout.reduce((a, b) => a + b, 0) / perWorkout.length);
    })();
    assert.equal(hero.estimatedMinutes, expected);
    // The onboarding value appears only as an explicitly-labelled preference.
    assert.ok(!hero.selectionInputs.some(f => f.id === 'minutes'));
    const preferred = hero.adaptationInputs.find(f => f.id === 'minutes');
    assert.ok(preferred);
    assert.equal(preferred.label, 'Preferred session length');
    assert.match(preferred.value, /45 min/);
    // The measured estimate never echoes the onboarding number by construction.
    assert.notEqual(preferred.value, String(hero.estimatedMinutes));
  });

  it('a measured estimate that fits inside the preference is not flagged as capped', () => {
    const hero = trainRecommendation({ onboarding: { goal: 'general', level: 'Beginner', equipment: [], daysPerWeek: 3, availableMinutes: 999 }, customTemplates: [], history: [] });
    assert.equal(hero.cappedByPreference, false);
    assert.equal(hero.estimatedMinutes > 0, true);
  });

  it('a measured estimate over the preference is honestly flagged as capped', () => {
    const hero = trainRecommendation({ onboarding: { goal: 'general', level: 'Beginner', equipment: [], daysPerWeek: 3, availableMinutes: 10 }, customTemplates: [], history: [] });
    // The preview measures the schedule that will actually be built —
    // post-cap it can be at or under the preference, so the estimate itself
    // must never exceed it…
    assert.ok(hero.estimatedMinutes <= 10, `post-cap estimate ${hero.estimatedMinutes} should fit the 10-minute preference`);
    // …while the un-capped programme is genuinely longer, which is what the
    // capped flag must report.
    assert.equal(hero.cappedByPreference, true);
  });

  it('absent/invalid preferred minutes disappear entirely', () => {
    const noMinutes = trainRecommendation({ onboarding: { goal: 'general', level: 'Beginner', equipment: [], daysPerWeek: 3 }, customTemplates: [], history: [] });
    assert.equal(noMinutes.preferredLengthLabel, null);
    assert.ok(!noMinutes.adaptationInputs.some(f => f.id === 'minutes'));
    const junk = trainRecommendation({ onboarding: { goal: 'general', level: 'Beginner', equipment: [], daysPerWeek: 3, availableMinutes: -5 }, customTemplates: [], history: [] });
    assert.equal(junk.preferredLengthLabel, null);
    assert.ok(!junk.adaptationInputs.some(f => f.id === 'minutes'));
  });

  it('equipment substitutions appear as adaptation, not as a ranking claim', () => {
    // Bands-only kit: the engine must report missing kit.
    const hero = trainRecommendation({ onboarding: { goal: 'muscle', level: 'Beginner', equipment: ['bands'], daysPerWeek: 3 }, customTemplates: [], history: [] });
    assert.ok(hero.reasons.some(r => /swap|kit you don.t have/i.test(r)));
    const subs = hero.adaptationInputs.find(f => f.id === 'substitutions');
    assert.ok(subs, 'substitution note must appear as an adaptation input');
    // …but the selection side never mentions substitution as a factor row.
    assert.ok(!hero.selectionInputs.some(f => f.id === 'substitutions'));
  });

  it('a full-kit gym profile recommends a gym split, not the bodyweight default', () => {
    const hero = trainRecommendation({ onboarding: { goal: 'muscle', level: 'Intermediate', equipment: ['barbell','dumbbells','bench','machine','cable','pullup-bar'], daysPerWeek: 4 }, customTemplates: [], history: [] });
    assert.notEqual(hero.programId, 'starter-3x');
    assert.notEqual(hero.programId, 'move-anywhere');
    assert.equal(hero.daysPerWeek, 4);
    assert.ok(hero.reasons.some(r => /equipment fit|doable/.test(r)));
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
    const hero = trainRecommendation({ onboarding: { goal: 'strength', level: 'Intermediate', equipment: ['barbell'], daysPerWeek: 4 }, customTemplates: [custom], history: [] });
    assert.equal(hero.isCustom, true);
    assert.equal(hero.templateId, 'custom-1');
    assert.equal(hero.name, 'My Split');
    assert.equal(hero.programId, 'custom-1');
    // Customs measure duration from their own blocks too.
    assert.equal(hero.estimatedMinutes > 0, true);
  });

  it('the previewed schedule is exactly what generateProgramme builds from Start', () => {
    // Explanation integrity: the card's numbers must come from the SAME code
    // path Start runs. If the hero showed a different programme than Start
    // builds (e.g. customs not reaching the generator), the card lies.
    const onboarding = { goal: 'muscle', level: 'Beginner', equipment: ['bodyweight','bands'], daysPerWeek: 3, availableMinutes: 45 };
    const custom = {
      id: 'custom-x', isCustom: true, name: 'Band Split', level: 'Beginner', goal: 'muscle', daysPerWeek: 3, version: 1,
      program: { id: 'custom-x', name: 'Band Split', level: 'Beginner', daysPerWeek: 3, version: 1, mesocycle: { weeks: 4, deloadWeek: null, progression: 'double-progression' }, equipment: ['bands'], weeks: [{ week: 1, workouts: [{ day: 1, title: 'Pull', blocks: [{ exerciseId: 'band-row', sets: 3, reps: '12–15', restSec: 60 }] }] }] },
    };
    const hero = trainRecommendation({ onboarding, customTemplates: [custom], history: [] });
    const built = generateProgramme({ ...onboarding, availableEquipment: onboarding.equipment, history: [], customTemplates: [custom], startDateISO: '2026-09-09' });
    assert.equal(hero.templateId, built.templateId);
    assert.equal(hero.programId, built.programId);
    assert.equal(hero.name, built.name);
    // The displayed estimate matches the average the built schedule produces.
    const avg = Math.round(built.sessions.reduce((sum, s)=> sum + (s.estimatedDurationMin != null ? s.estimatedDurationMin : 0), 0) / built.sessions.length);
    assert.equal(hero.estimatedMinutes, avg);
    // Reported swaps/warnings are the real ones from the built schedule.
    assert.equal(hero.substitutionCount, built.substitutions.length);
    assert.equal(hero.warningCount, built.generationWarnings.length);
  });

  it('soft-deleted templates never win the recommendation', () => {
    const custom = {
      id: 'custom-2', isCustom: true, name: 'Deleted', level: 'Intermediate', goal: 'strength', daysPerWeek: 4,
      deletedAt: '2026-09-01T00:00:00Z',
      program: { id: 'custom-2', name: 'Deleted', level: 'Intermediate', daysPerWeek: 4, equipment: ['barbell'], weeks: [{ week: 1, workouts: [{ day: 1, title: 'A', blocks: [] }] }] },
    };
    const hero = trainRecommendation({ onboarding: { goal: 'strength', level: 'Intermediate', equipment: ['barbell'], daysPerWeek: 4 }, customTemplates: [custom], history: [] });
    assert.notEqual(hero.templateId, 'custom-2');
  });

  it('legacy onboarding shapes (missing optional fields) still recommend', () => {
    const hero = trainRecommendation({ onboarding: { goal: 'endurance', equipment: ['bands'] }, customTemplates: [], history: [] });
    assert.ok(hero);
    assert.deepEqual(hero.selectionInputs.map(f => f.id), ['goal', 'equipment', 'level', 'days']);
    const byId = Object.fromEntries(hero.selectionInputs.map(f => [f.id, f.value]));
    assert.equal(byId.level, 'Beginner'); // defaulted, still an honest scorer input
    assert.equal(byId.days, 'flexible');
  });
});
