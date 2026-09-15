import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEditorTemplate, moveItem, duplicateEditorTemplate, editorSubstitutionPreview } from '../src/lib/templateEditor.js';
import { EXERCISE_BY_ID } from '../src/lib/data.js';

const form = {
  name: 'My Day', description: 'test', level: 'Beginner', goal: 'general',
  days: [
    { title: 'A', exercises: [ { exerciseId: 'push-up', sets: '3', reps: '8–12', restSec: '90' }, { exerciseId: 'pull-up', sets: 4, reps: '6', restSec: 120 } ] },
    { title: 'B', exercises: [ { exerciseId: 'goblet-squat', sets: 3, reps: '10', restSec: 0 } ] },
  ],
};

describe('template editor: build with per-exercise rest', ()=>{
  it('carries rest seconds per block, clamped, and defaults when missing', ()=>{
    const tpl = buildEditorTemplate(form);
    const blocks = tpl.program.weeks[0].workouts[0].blocks;
    assert.equal(blocks[0].restSec, 90);
    assert.equal(blocks[1].restSec, 120);
    const g = tpl.program.weeks[0].workouts[1].blocks[0];
    assert.equal(g.restSec, 0, '0 is a legal value (no rest) — not forced to 90');
    const neg = buildEditorTemplate({ ...form, days: [{ title: 'x', exercises: [{ exerciseId: 'push-up', sets: 3, reps: '8', restSec: -40 }] }] });
    assert.equal(neg.program.weeks[0].workouts[0].blocks[0].restSec, 0);
    const huge = buildEditorTemplate({ ...form, days: [{ title: 'x', exercises: [{ exerciseId: 'push-up', sets: 3, reps: '8', restSec: 9999 }] }] });
    assert.equal(huge.program.weeks[0].workouts[0].blocks[0].restSec, 600);
  });

  it('editing an existing template bumps its version; creating starts at v1', ()=>{
    const created = buildEditorTemplate(form);
    assert.equal(created.version, 1);
    assert.equal(created.program.version, 1);
    const edited = buildEditorTemplate({ ...form, name: 'Renamed' }, created);
    assert.equal(edited.version, 2);
    assert.equal(edited.id, created.id, 'same id — this is an edit, not a new object');
    assert.ok(edited.updatedAtISO >= created.updatedAtISO);
  });

  it('daysPerWeek follows the day count (weekly frequency editing)', ()=>{
    const tpl = buildEditorTemplate({ ...form, days: [form.days[0]] });
    assert.equal(tpl.daysPerWeek, 1);
    assert.equal(tpl.program.daysPerWeek, 1);
    assert.equal(buildEditorTemplate(form).daysPerWeek, 2);
  });
});

describe('template editor: reordering is index-safe', ()=>{
  it('moves items and refuses illegal moves', ()=>{
    assert.deepEqual(moveItem(['a','b','c'], 0, 2), ['b','c','a']);
    assert.deepEqual(moveItem(['a','b','c'], 2, 0), ['c','a','b']);
    assert.deepEqual(moveItem(['a','b','c'], 0, -1), ['a','b','c']);
    assert.deepEqual(moveItem(['a','b','c'], 1, 5), ['a','b','c']);
    assert.deepEqual(moveItem(['a','b','c'], 9, 1), ['a','b','c']);
    assert.deepEqual(moveItem('nope', 0, 1), []);
  });
});

describe('template editor: duplication', ()=>{
  it('produces a fresh, independently versioned copy', ()=>{
    const tpl = buildEditorTemplate(form);
    const copy = duplicateEditorTemplate(tpl);
    assert.notEqual(copy.id, tpl.id);
    assert.equal(copy.version, 1);
    assert.equal(copy.program.version, 1);
    assert.equal(copy.name, `${tpl.name} copy`);
    assert.equal(copy.program.id, copy.id);
    assert.ok(copy.isCustom);
    assert.deepEqual(copy.program.weeks[0].workouts[1].blocks[0].sets, 3);
  });
});

describe('template editor: substitution preview matches the scheduler', ()=>{
  it('reports coverage and the honest kit swaps', ()=>{
    const tpl = buildEditorTemplate(form);
    const full = editorSubstitutionPreview(tpl, ['bodyweight','pullup-bar','dumbbells','kettlebell','bench']);
    assert.equal(full.coverage, 1);
    assert.equal(full.swaps.length, 0);
    const limited = editorSubstitutionPreview(tpl, ['bodyweight']);
    // Bodyweight-only kit: push-up stays, pull-up and goblet need swaps —
    // and coverage may still be 1 because honest substitutes exist.
    assert.deepEqual(limited.swaps.map(s=> s.from).sort(), ['goblet-squat', 'pull-up']);
    assert.ok(limited.coverage <= 1);
    for(const s of limited.swaps){
      assert.ok(EXERCISE_BY_ID[s.from]);
      if(s.to) assert.ok(EXERCISE_BY_ID[s.to.id], 'preview suggests real exercises only');
    }
  });

  it('null template returns an honest empty preview', ()=>{
    assert.deepEqual(editorSubstitutionPreview(null), { coverage: 1, swaps: [] });
  });
});
