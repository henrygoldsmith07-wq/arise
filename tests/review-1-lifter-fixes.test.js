// Regression tests for the hark/arise-review-1 pass: bugs a real lifter feels
// on day one — loaded lifts treated as bodyweight, a fewer-days schedule that
// silently drops the same session every week, and a gym pick that left the
// kit at bodyweight.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EXERCISES, EXERCISE_BY_ID, EQUIPMENT_PRESETS, defaultKitForLocation, isLoadedKitLift, takesExternalLoad } from '../src/lib/data.js';
import { generateProgramme } from '../src/lib/programmeGenerator.js';
import { swapCarryPlan } from '../src/lib/sessionRunnerModel.js';
import { generateProgrammeFromProfile } from '../src/services/programmeService.js';

const FULL_GYM = EQUIPMENT_PRESETS.find(p=> p.id === 'full-gym').equipment;
const PLATES = { barWeightKg:20, platesKg:[1.25, 2.5, 5, 10, 15, 20, 25] };

describe('takesExternalLoad / isLoadedKitLift', ()=>{
  it('treats barbell, dumbbell, machine and cable lifts as loaded even though supportsWeighted is false', ()=>{
    for(const id of ['barbell-squat', 'leg-press', 'machine-chest-press', 'goblet-squat', 'front-squat']){
      const ex = EXERCISE_BY_ID[id];
      assert.ok(ex, `${id} exists in the catalogue`);
      assert.notEqual(ex.supportsWeighted, true, `${id} is a case the old supportsWeighted gate missed`);
      assert.equal(takesExternalLoad(id), true, `${id} takes a logged load`);
      assert.equal(isLoadedKitLift(id), true);
    }
  });

  it('keeps plain bodyweight and cardio-machine work unloaded, and weightable bodyweight moves loadable but not kit-loaded', ()=>{
    assert.equal(takesExternalLoad('dead-bug'), false);
    assert.equal(takesExternalLoad('plank'), false);
    assert.equal(takesExternalLoad('indoor-row'), false, 'a rowing erg is not a weight stack');
    const weightableBodyweight = EXERCISES.find(ex=> ex.supportsWeighted === true && ex.equipment.every(eq=> eq === 'bodyweight'));
    assert.ok(weightableBodyweight);
    assert.equal(takesExternalLoad(weightableBodyweight), true);
    assert.equal(isLoadedKitLift(weightableBodyweight), false);
  });

  it('resolves a partial swap option ({ id, reason }) through the catalogue', ()=>{
    assert.equal(takesExternalLoad({ id:'leg-press', reason:'equipment' }), true);
    assert.equal(takesExternalLoad({ id:'plank', reason:'equipment' }), false);
    assert.equal(takesExternalLoad(null), false);
    assert.equal(takesExternalLoad('no-such-exercise'), false);
  });

  it('every catalogue lift on loaded kit (bar cardio) takes a load', ()=>{
    const misses = EXERCISES.filter(ex=> ex.muscle !== 'Cardio'
      && ex.equipment.some(eq=> ['barbell', 'machine', 'cable'].includes(eq))
      && !takesExternalLoad(ex)).map(ex=> ex.id);
    assert.deepEqual(misses, []);
  });
});

describe('swap carry onto real catalogue options', ()=>{
  const target = {
    exerciseId:'barbell-squat', reps:'8', restSec:120, unilateral:false, warmups:[], loadHint:'',
    sets:[{ reps:'8', weightKg:'100', rpe:'', completed:true, failed:false }],
  };

  it('carries a squat e1RM onto a machine replacement exactly as the swap sheet passes it (no supportsWeighted flag)', ()=>{
    const option = { ...EXERCISE_BY_ID['leg-press'], reason:'equipment' };
    assert.notEqual(option.supportsWeighted, true);
    const plan = swapCarryPlan({ target, option, history:[], plateConfig:PLATES });
    assert.ok(plan.fromE1rmKg > 100, 'the original work is the carry source');
    assert.ok(plan.loadKg > 0, 'a loaded replacement gets a starting load, not a blank row');
  });

  it('never carries a barbell load onto a weightable bodyweight move', ()=>{
    const option = { ...EXERCISE_BY_ID['bodyweight-squat'], reason:'equipment' };
    assert.equal(option.supportsWeighted, true);
    const plan = swapCarryPlan({ target, option, history:[], plateConfig:PLATES });
    assert.equal(plan.loadKg, 0, '100 kg back squat must not become a 100 kg-loaded bodyweight squat');
  });
});

describe('fewer days than the template: rotate, never drop a session', ()=>{
  const sessionsFor = (daysPerWeek)=> generateProgramme({
    goal:'muscle', location:'gym', level:'Intermediate', daysPerWeek, availableMinutes:60,
    availableEquipment:FULL_GYM, startDateISO:'2026-10-22',
  });

  it('a 3-day user on the 4-day upper/lower sees every session and alternates upper/lower', ()=>{
    const generated = sessionsFor(3);
    assert.equal(generated.programId, 'gym-full-4x');
    const titles = generated.sessions.map(s=> s.title.replace(/\s*\+.*$/, '').trim());
    for(const title of ['Lower A', 'Upper A', 'Lower B', 'Upper B']){
      assert.ok(titles.includes(title), `${title} is scheduled (got ${titles.join(', ')})`);
    }
    for(let i = 1; i < titles.length; i++){
      assert.notEqual(titles[i].split(' ')[0], titles[i - 1].split(' ')[0], `no back-to-back ${titles[i]} (got ${titles.join(', ')})`);
    }
    const perWeek = new Map();
    for(const s of generated.sessions) perWeek.set(s.week, (perWeek.get(s.week) || 0) + 1);
    assert.ok([...perWeek.values()].every(count=> count === 3));
  });

  it('a 2-day user is not stuck on the same two sessions forever', ()=>{
    const titles = sessionsFor(2).sessions.map(s=> s.title.replace(/\s*\+.*$/, '').trim());
    assert.equal(new Set(titles).size, 4, `all four sessions recur (got ${titles.join(', ')})`);
  });

  it('a full-frequency user keeps the template order untouched', ()=>{
    const generated = sessionsFor(4);
    assert.ok(generated.sessions.every(s=> !s.frequencyAdjusted));
    assert.deepEqual(generated.sessions.slice(0, 4).map(s=> s.title), ['Lower A', 'Upper A', 'Lower B', 'Upper B']);
  });

  it('is deterministic', ()=>{
    assert.deepEqual(sessionsFor(3).sessions.map(s=> [s.dateISO, s.id]), sessionsFor(3).sessions.map(s=> [s.dateISO, s.id]));
  });
});

describe('onboarding kit follows the location until the user picks kit', ()=>{
  it('gym → full gym kit; everywhere else → bodyweight', ()=>{
    assert.deepEqual(defaultKitForLocation('gym'), FULL_GYM);
    for(const id of ['home', 'outdoors', 'small-space', 'anything']) assert.deepEqual(defaultKitForLocation(id), ['bodyweight']);
  });
  it('returns a fresh array (callers may mutate it)', ()=>{
    const kit = defaultKitForLocation('gym');
    kit.push('x');
    assert.ok(!defaultKitForLocation('gym').includes('x'));
  });
});

describe('first plan from onboarding honours the answers (generateProgrammeFromProfile)', ()=>{
  it('applies days/week, session length and avoided movements to the started schedule', ()=>{
    const onboarding = {
      goal:'muscle', location:'gym', equipment:FULL_GYM, level:'Intermediate',
      daysPerWeek:3, availableMinutes:45, preferredExerciseIds:[], dislikedExerciseIds:['barbell-squat'],
    };
    const { programId, store } = generateProgrammeFromProfile({ onboarding, history:[], customTemplates:[] });
    assert.ok(programId);
    const sessions = store.activeSchedule.sessions;
    const perWeek = new Map();
    for(const s of sessions) perWeek.set(s.week, (perWeek.get(s.week) || 0) + 1);
    assert.ok([...perWeek.values()].every(count=> count <= 3), 'never more sessions a week than the user said');
    assert.ok(sessions.every(s=> s.blocks.every(b=> b.exerciseId !== 'barbell-squat')), 'an avoided lift is never prescribed');
    assert.ok(sessions.every(s=> s.estimatedDurationMin == null || s.estimatedDurationMin <= 45));
    assert.equal(store.programHistory.length, 1);
  });
});
