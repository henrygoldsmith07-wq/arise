import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateCustomTemplate, generateProgrammeFromProfile, installSharedTemplate, restoreCustomTemplate, saveCustomTemplate, softDeleteCustomTemplate } from '../src/services/programmeService.js';
import { encodeShareCode } from '../src/lib/shareCodes.js';

describe('programme application service', ()=>{
  it('generates and records a programme from the stored profile without mutating input', ()=>{
    const store = {
      onboarding:{ goal:'general', level:'Beginner', daysPerWeek:3, availableMinutes:45, equipment:['dumbbells','bench'], preferredExerciseIds:[], dislikedExerciseIds:[] },
      history:[], customTemplates:[], programHistory:[],
    };
    const before = JSON.stringify(store);
    const result = generateProgrammeFromProfile(store);
    assert.ok(result.programId);
    assert.ok(result.store.activeSchedule?.sessions?.length);
    assert.equal(result.store.programHistory.length, 1);
    assert.equal(JSON.stringify(store), before);
  });

  it('owns custom-template save, soft-delete, restore and duplicate transitions', ()=>{
    const form = { name:'My plan', description:'', level:'Beginner', goal:'general', days:[{ title:'Day 1', exercises:[{ exerciseId:'bench-press-dumbbell', sets:3, reps:'8–12', restSec:90 }] }] };
    const initial = { customTemplates:[], tombstones:[] };
    const saved = saveCustomTemplate({ store:initial, form });
    assert.equal(saved.store.customTemplates.length, 1);
    const id = saved.template.id;
    const deleted = softDeleteCustomTemplate(saved.store, id);
    assert.ok(deleted.customTemplates[0].deletedAt);
    assert.equal(deleted.tombstones[0].refId, id);
    const restored = restoreCustomTemplate(deleted, id);
    assert.equal(restored.customTemplates[0].deletedAt, undefined);
    assert.equal(restored.tombstones.length, 0);
    const duplicated = duplicateCustomTemplate(restored, restored.customTemplates[0]);
    assert.ok(duplicated.copy);
    assert.notEqual(duplicated.copy.id, id);
  });

  it('installs a share code once and rejects a duplicate name', ()=>{
    const form = { name:'Shared plan', description:'', level:'Beginner', goal:'general', days:[{ title:'Day', exercises:[{ exerciseId:'bench-press-dumbbell', sets:3, reps:'8–12', restSec:90 }] }] };
    const template = saveCustomTemplate({ store:{ customTemplates:[] }, form }).template;
    const code = encodeShareCode(template);
    const installed = installSharedTemplate({ customTemplates:[] }, code);
    assert.equal(installed.store.customTemplates.length, 1);
    assert.throws(()=> installSharedTemplate(installed.store, code), /already exists/);
  });
});
