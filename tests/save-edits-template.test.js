import test from 'node:test';
import assert from 'node:assert/strict';
import { editsAsTemplateInput, editableDays } from '../src/lib/programmeEditor.js';
import { buildEditorTemplate } from '../src/lib/templateEditor.js';

const sched = { programName: 'Upper', sessions: [
  { id: 'a', day: 1, title: 'Push', status: 'planned', blocks: [{ exerciseId: 'chest-press-machine', sets: 3, reps: '8–12', restSec: 120 }] },
  { id: 'b', day: 2, title: 'Pull', status: 'planned', blocks: [{ exerciseId: 'lat-pulldown', sets: 4, reps: '10–12', restSec: 90 }] },
]};

test('edited days round trip into a template with same sets/reps/rest', ()=> {
  const input = editsAsTemplateInput(sched, { name: 'Mine' });
  assert.equal(input.name, 'Mine');
  const tpl = buildEditorTemplate(input);
  const w = tpl.program.weeks[0].workouts;
  assert.equal(w.length, editableDays(sched).length);
  assert.equal(w[0].title, 'Push');
  assert.equal(w[0].blocks[0].restSec, 120);
  assert.equal(w[1].blocks[0].sets, 4);
});

test('default name falls back', ()=> {
  assert.match(editsAsTemplateInput(sched).name, /edits/);
});
