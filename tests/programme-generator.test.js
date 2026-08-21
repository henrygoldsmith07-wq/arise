import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES } from '../src/lib/data.js';
import { generateProgramme } from '../src/lib/programmeGenerator.js';

describe('profile programme generator', ()=>{
  it('applies frequency, time and disliked-exercise constraints to the schedule', ()=>{
    const generated = generateProgramme({
      goal: 'general',
      level: 'Beginner',
      daysPerWeek: 2,
      availableMinutes: 25,
      availableEquipment: ['bodyweight'],
      dislikedExerciseIds: ['push-up'],
      startDateISO: '2026-01-05',
    });
    assert.equal(generated.startDateISO, '2026-01-05');
    assert.ok(generated.sessions.length > 0);
    const weeks = new Map();
    for(const session of generated.sessions) weeks.set(session.week, (weeks.get(session.week) || 0) + 1);
    assert.ok([...weeks.values()].every(count=> count <= 2));
    assert.ok(generated.sessions.every(session=> session.blocks.every(block=> block.exerciseId !== 'push-up')));
    assert.ok(generated.sessions.every(session=> new Set(session.blocks.map(block=> block.exerciseId)).size === session.blocks.length));
    assert.ok(generated.sessions.every(session=> session.estimatedDurationMin <= 25));
    assert.ok(generated.generationReasons.some(reason=> /25 minutes/i.test(reason)));
    assert.equal(generated.generationWarnings.length, 0);
  });

  it('uses recent history when choosing an equipment-honest alternative', ()=>{
    const generated = generateProgramme({
      goal: 'strength',
      level: 'Intermediate',
      daysPerWeek: 4,
      availableEquipment: ['dumbbells', 'bench', 'bodyweight'],
      preferredExerciseIds: ['bench-press-dumbbell'],
      history: [{ id: 'old', dateISO: '2026-01-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: '20', rpe: '7' }] }] }],
      startDateISO: '2026-01-05',
    });
    assert.equal(generated.templateId, 'tpl-strength');
    assert.ok(generated.sessions.every(session=> session.blocks.every(block=> block.exerciseId !== 'bench-press-barbell')));
    assert.ok(generated.substitutions.some(substitution=> substitution.from === 'bench-press-barbell'));
    assert.ok(generated.sessions.some(session=> session.blocks.some(block=> block.exerciseId === 'bench-press-dumbbell')));
  });

  it('reports an unsatisfied preference constraint instead of hiding it', ()=>{
    const allBodyweight = EXERCISES.filter(ex=> ex.equipment.length === 1 && ex.equipment[0] === 'bodyweight').map(ex=> ex.id);
    const generated = generateProgramme({
      goal: 'general',
      level: 'Beginner',
      daysPerWeek: 2,
      availableEquipment: ['bodyweight'],
      dislikedExerciseIds: allBodyweight,
      startDateISO: '2026-01-05',
    });
    assert.ok(generated.generationWarnings.length > 0);
    assert.ok(generated.generationReasons.some(reason=> /could not be fully satisfied/i.test(reason)));
  });
});
